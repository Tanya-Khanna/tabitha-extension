// Chat with your Tabs - Search and Ranking
// Includes: aiSemanticSearch, semanticRerank, processCandidates, filterCandidatesByConstraints
// Also includes: askSpecificClarifier, generateClarifyingQuestion, formatDisambiguationList

import { postToOffscreen, structuredLog, recordTelemetry, normalizeUrl } from './utils.js';
import { getChatSessionId, formatConversationForPrompt } from './conversation.js';
import { checkPromptApiAvailability } from './intent-parsing.js';
import { Indexer } from './indexer.js';

const log = (...a) => console.log("[Tabitha::chat]", ...a);

// Global flag (will be set by index.js)
let __INDEXER_BOOTED__ = false;
export function setIndexerBooted(flag) {
  __INDEXER_BOOTED__ = flag;
}

// ==== FILTER CANDIDATES BY CONSTRAINTS ====
export function filterCandidatesByConstraints(candidates, constraints) {
  if (!constraints) return candidates;
  
  const filtered = [];
  const now = Date.now();
  
  for (const candidate of candidates) {
    const card = candidate.card;
    
    // 1. Filter by dateRange (since on lastVisitedAt)
    if (constraints.dateRange?.since) {
      const lastVisited = card.lastVisitedAt || 0;
      // Handle both timestamp and ISO date string
      const sinceTime = typeof constraints.dateRange.since === 'string' 
        ? new Date(constraints.dateRange.since).getTime() 
        : constraints.dateRange.since;
      if (lastVisited < sinceTime) {
        continue; // Too old
      }
      if (constraints.dateRange.until) {
        const untilTime = typeof constraints.dateRange.until === 'string'
          ? new Date(constraints.dateRange.until).getTime()
          : constraints.dateRange.until;
        if (lastVisited > untilTime) {
          continue; // Too new
        }
      }
    }
    
    // 2. Filter by excludeApps constraint (e.g., "mute all except zoom")
    // Support both old "exclude" and new "excludeApps" for backward compatibility
    const excludeApps = constraints.excludeApps || constraints.exclude || [];
    if (Array.isArray(excludeApps) && excludeApps.length > 0) {
      const cardDomain = (card.domain || '').toLowerCase();
      const cardUrl = (card.url || '').toLowerCase();
      let shouldExclude = false;
      
      for (const excludeDomain of excludeApps) {
        const excludeLower = excludeDomain.toLowerCase().replace(/^www\./, '');
        
        // Check if card matches excluded domain
        if (cardDomain === excludeLower || cardDomain.includes(excludeLower) || excludeLower.includes(cardDomain)) {
          shouldExclude = true;
          break;
        }
        
        // URL contains excluded domain
        if (cardUrl.includes(excludeLower)) {
          shouldExclude = true;
          break;
        }
      }
      
      if (shouldExclude) {
        continue; // Skip this candidate
      }
    }
    
    // 3. Filter by includeApps constraint (migrated from "app")
    // ACCURACY: Strict domain matching - for single-word queries, require exact domain match
    // Support both old "app" and new "includeApps" for backward compatibility
    const includeApps = constraints.includeApps || constraints.app || [];
    if (Array.isArray(includeApps) && includeApps.length > 0) {
      const cardDomain = (card.domain || '').toLowerCase().replace(/^www\./, '');
      const cardUrl = (card.url || '').toLowerCase();
      let matches = false;
      
      for (const appDomain of includeApps) {
        const appLower = appDomain.toLowerCase().replace(/^www\./, '');
        const baseDomain = appLower.split('/')[0].split(':')[0]; // Remove path and port
        
        // ACCURACY: Exact domain match (highest priority)
        if (cardDomain === baseDomain) {
          matches = true;
          break;
        }
        
        // ACCURACY: Subdomain match (e.g., mail.google.com matches google.com)
        const cardBaseDomain = cardDomain.split('.');
        const appBaseParts = baseDomain.split('.');
        if (cardBaseDomain.length >= appBaseParts.length) {
          // Check if card domain ends with app domain (e.g., mail.google.com ends with google.com)
          const cardSuffix = cardBaseDomain.slice(-appBaseParts.length).join('.');
          if (cardSuffix === baseDomain) {
            matches = true;
            break;
          }
        }
        
        // ACCURACY: Reverse subdomain check (app domain contains card base)
        if (appBaseParts.length >= cardBaseDomain.length) {
          const appSuffix = appBaseParts.slice(-cardBaseDomain.length).join('.');
          if (appSuffix === cardDomain) {
            matches = true;
            break;
          }
        }
        
        // Fallback: URL contains domain (less strict, but sometimes needed)
        if (cardUrl.includes(baseDomain)) {
          matches = true;
          break;
        }
      }
      
      if (!matches) {
        continue;
      }
    }
    
    // 4. Filter by resultMustBeOpen
    if (constraints.resultMustBeOpen === true) {
      if (card.source !== 'tab') {
        continue;
      }
    }
    
    // 5. Filter by group constraint
    if (constraints.group) {
      const groupLower = (card.groupName || '').toLowerCase();
      const constraintLower = String(constraints.group).toLowerCase();
      if (groupLower !== constraintLower && 
          !groupLower.includes(constraintLower) && 
          !constraintLower.includes(groupLower)) {
        const groupTokens = groupLower.split(/\s+/);
        const constraintTokens = constraintLower.split(/\s+/);
        const hasTokenMatch = constraintTokens.some(t => groupTokens.includes(t));
        if (!hasTokenMatch) {
          continue;
        }
      }
    }
    
    // 6. Filter by scope (group vs tab)
    // If scope is 'group', we want to return tabs that belong to the specified group
    // This is already handled by the group constraint above, but we can add explicit scope validation
    if (constraints.scope === 'group' && constraints.group) {
      // Already filtered by group above, so continue
      // Scope 'group' is more about intent than filtering - the group constraint handles filtering
    }
    
    filtered.push(candidate);
  }
  
  return filtered;
}

// ==== AI SEMANTIC SEARCH ====
export async function aiSemanticSearch(query, intent, sessionId, limit = 30, lexicalResultCount = 0) {
  try {
    const shouldRunSemantic = lexicalResultCount <= 3 || 
                              /(vaguely|can'?t remember|don'?t remember|not sure|unsure|maybe)/i.test(query) ||
                              intent?.disambiguationNeeded === true;
    
    if (!shouldRunSemantic) {
      log(`Skipping semantic search: lexical returned ${lexicalResultCount} results (>3)`);
      return { ok: true, results: [] };
    }
    
    if (!__INDEXER_BOOTED__) {
      __INDEXER_BOOTED__ = true;
      await Indexer.init();
    }
    
    const filters = {};
    if (intent?.constraints?.resultMustBeOpen === true) {
      filters.source = 'tab';
    }
    
    const cardQuery = await Indexer.handleMessage({ 
      type: 'INDEX_QUERY', 
      query: '', 
      filters: filters, 
      limit: 10000
    });
    
    let allCards = cardQuery?.results || [];
    if (allCards.length === 0) {
      return { ok: true, results: [] };
    }
    
    allCards.sort((a, b) => (b.lastVisitedAt || 0) - (a.lastVisitedAt || 0));
    const maxCardsForAI = 50;
    const cardsForAI = allCards.slice(0, maxCardsForAI);
    
    const cardList = cardsForAI.map((c, idx) => {
      const title = (c.title || '').slice(0, 40);
      const url = (c.url || '').slice(0, 50);
      return `${idx + 1}. [${c.source}] ${title} | ${c.domain || ''} | ${url}`;
    }).join('\n');
    
    const conversationContext = formatConversationForPrompt(sessionId || getChatSessionId());
    
    const intentPow = intent?.intent || 'ask';
    const mustBeOpen = intent?.constraints?.resultMustBeOpen === true;
    const intentInstructions = {
      'open': mustBeOpen 
        ? 'Find OPEN TABS to OPEN. Only consider currently open tabs (source: "tab"). Prioritize exact domain matches and group hints.'
        : 'Find items to OPEN. Prioritize already-open tabs first (source: "tab"), then recent history/bookmarks.',
      'close': 'Find OPEN TABS to CLOSE. Only consider currently open tabs (source: "tab"). Match by domain, title, or URL.',
      'find_open': 'Find ALREADY-OPEN tabs to ACTIVATE. Only consider currently open tabs (source: "tab"). Prioritize exact matches.',
      'reopen': 'Find RECENTLY CLOSED tabs to RESTORE. Prioritize items from "closed" source. Consider recent visit history.',
      'save': mustBeOpen
        ? 'Find OPEN TABS to BOOKMARK. Only consider currently open tabs (source: "tab").'
        : 'Find tabs to BOOKMARK. Prioritize currently open tabs (source: "tab"), then frequently visited pages.',
      'show': mustBeOpen
        ? 'Find OPEN TABS to DISPLAY. Only consider currently open tabs (source: "tab"). Rank by relevance and recency.'
        : 'Find items to DISPLAY in a list. Include open tabs, history, and bookmarks. Rank by relevance and recency.',
      'list': mustBeOpen
        ? 'Find OPEN TABS to DISPLAY. Only consider currently open tabs (source: "tab"). Rank by relevance and recency.'
        : 'Find items to DISPLAY in a list. Include open tabs, history, and bookmarks. Rank by relevance and recency.',
      'ask': mustBeOpen
        ? 'Find OPEN TABS relevant to the user\'s QUESTION. Only consider currently open tabs (source: "tab").'
        : 'Find items relevant to the user\'s QUESTION. Include all sources. Focus on semantic relevance for answering.'
    };
    
    const instruction = intentInstructions[intentPow] || intentInstructions['ask'];
    const groupHint = intent?.constraints?.group ? `\nGroup hint: "${intent.constraints.group}" - prioritize tabs in this group.` : '';
    
    const prompt = `You are Tabitha. Find the most relevant tabs/bookmarks/history items.

${conversationContext ? `Previous conversation:\n${conversationContext}\n` : ''}

Query: "${query}"
Intent: ${intentPow}
${instruction}${groupHint}
Constraints: ${JSON.stringify(intent?.constraints || {})}

ITEMS (numbered 1-N):
${cardList}

Return a JSON array of item numbers (1-based) in order of relevance. Match by:
- EXACT domain match FIRST: "substack" → substack.com (NOT devpost.com or youtube.com)
- Domain substring: "git" → github.com/gitlab.com (only if domain contains the word)
- Title/content relevance
- Query intent (open/find/close/ask)
- Constraints (app, group, dateRange)

CRITICAL RULES:
1. Prioritize exact domain matches! If query is "substack", only match substack.com, not random sites.
2. If multiple tabs have the SAME title but different domains (e.g., "Cover Letter" in Google Docs vs Notion), include BOTH in results so user can choose.

Query: "${query}"
Items:
${cardList}

Output (JSON array of numbers only):`;

    const semanticSearchPromise = postToOffscreen('OFFSCREEN_RUN_PROMPT_LM', { prompt });
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('semantic_search_timeout')), 60000)
    );
    
    let res;
    try {
      res = await Promise.race([semanticSearchPromise, timeoutPromise]);
    } catch (timeoutErr) {
      if (timeoutErr.message === 'semantic_search_timeout') {
        log('Semantic search timeout (60s) - returning empty results');
        return { ok: true, results: [], timeout: true };
      }
      throw timeoutErr;
    }
    
    const jsonText = res?.text || '';
    const jsonMatch = jsonText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return { ok: true, results: [] };
    }
    
    const itemNumbers = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(itemNumbers)) {
      return { ok: true, results: [] };
    }
    
    const results = [];
    for (let i = 0; i < itemNumbers.length && results.length < limit; i++) {
      const idx = itemNumbers[i] - 1;
      if (idx >= 0 && idx < cardsForAI.length) {
        const cardFromAI = cardsForAI[idx];
        const card = allCards.find(c => c.cardId === cardFromAI.cardId);
        if (card) {
          const score = (limit - i) * 10;
          results.push({ card, score });
        }
      }
    }
    
    return { ok: true, results };
  } catch (err) {
    log('AI semantic search failed:', err);
    return { ok: false, error: String(err?.message || err) };
  }
}

// ==== SEMANTIC RE-RANK ====
export async function semanticRerank(candidates, query, sessionId = null, intent = null) {
  if (candidates.length === 0) return candidates;
  
  try {
    const available = await checkPromptApiAvailability();
    if (!available) {
      log('Semantic re-rank skipped: Prompt API unavailable');
      return candidates;
    }
    
    const top10 = candidates.slice(0, 10);
    const conversationContext = formatConversationForPrompt(sessionId || getChatSessionId());
    
    const intentPow = intent?.intent || null;
    const rankingHints = {
      'open': 'Prioritize open tabs over history/bookmarks. Rank by recency and domain match.',
      'close': 'Only rank open tabs. Prioritize exact domain/title matches.',
      'find_open': 'Only rank open tabs. Exact matches first.',
      'reopen': 'Prioritize recently closed items. Rank by recency.',
      'save': 'Prioritize open tabs, then frequently visited pages.',
      'show': 'Rank by relevance and recency. Include all sources.',
      'ask': 'Rank by semantic relevance for answering the question.'
    };
    
    const hint = intentPow && rankingHints[intentPow] ? `\nIntent: ${intentPow}\nRanking guidance: ${rankingHints[intentPow]}` : '';
    
    const prompt = `You are Tabitha. Rank these candidates by relevance to the query.

${conversationContext ? `Previous conversation:\n${conversationContext}\n` : ''}

Query: "${query}"
Intent: ${intentPow || 'open'}${hint}

Candidates:
${top10.map((c, i) => `${i+1}. cardId: ${c.card.cardId}, title: "${c.card.title}", domain: ${c.card.domain}, type: ${c.card.type}, source: ${c.card.source}`).join('\n')}

CRITICAL RULES:
1. EXACT domain match FIRST: If query is single word like "substack", ONLY score exact domain matches (substack.com=1.0), score all others 0.0
2. If multiple tabs have the SAME title but different domains/types (e.g., "Cover Letter" in Google Docs vs Notion), give them SIMILAR scores (e.g., both 0.95) and set needsFollowup: true with a clarifying question. ALWAYS include both in results.
3. Domain validation: Reject domains that don't contain the query word. "git" → github.com OK, git-scm.com OK, but google.com NO.

Return JSON:
{
  "ranked": [
    {"cardId": "cardId", "score": 0.95, "reason": "brief reason"},
    ...
  ],
  "confidence": 0.90,
  "needsFollowup": false,
  "followupQuestion": null
}

Score: 0.0-1.0 (1.0 = perfect match).

CRITICAL RULES:
1. EXACT domain match FIRST: If query is "substack", ONLY match substack.com (score 1.0)
2. Domain substring: "git" → github.com/gitlab.com should rank HIGHER than git-scm.com
3. Do NOT include items that don't match the query domain!

Query: "${query}"
Candidates:
${top10.map((c, i) => `${i+1}. cardId: ${c.card.cardId}, title: "${c.card.title}", domain: ${c.card.domain}, type: ${c.card.type}, source: ${c.card.source}`).join('\n')}

Output:`;

    const res = await postToOffscreen('OFFSCREEN_RUN_PROMPT_LM', { prompt });
    const jsonText = res?.text || '';
    
    // Try multiple JSON extraction strategies
    let extractedJson = null;
    
    // Strategy 1: Code fences with json marker
    let match = jsonText.match(/```json\s*(\{[\s\S]*?\})\s*```/);
    if (match && match[1]) {
      extractedJson = match[1];
    }
    
    // Strategy 2: Code fences without json marker
    if (!extractedJson) {
      match = jsonText.match(/```\s*(\{[\s\S]*?\})\s*```/);
      if (match && match[1]) {
        extractedJson = match[1];
      }
    }
    
    // Strategy 3: Find complete JSON object (balanced braces)
    if (!extractedJson) {
      const braceMatch = jsonText.match(/\{[\s\S]*/);
      if (braceMatch) {
        let braceCount = 0;
        let inString = false;
        let escapeNext = false;
        let endPos = -1;
        
        for (let i = 0; i < braceMatch[0].length; i++) {
          const char = braceMatch[0][i];
          
          if (escapeNext) {
            escapeNext = false;
            continue;
          }
          
          if (char === '\\') {
            escapeNext = true;
            continue;
          }
          
          if (char === '"') {
            inString = !inString;
            continue;
          }
          
          if (!inString) {
            if (char === '{') braceCount++;
            if (char === '}') {
              braceCount--;
              if (braceCount === 0) {
                endPos = i + 1;
                break;
              }
            }
          }
        }
        
        if (endPos > 0) {
          extractedJson = braceMatch[0].substring(0, endPos);
        }
      }
    }
    
    // Strategy 4: Try to extract from any remaining JSON-like structure
    if (!extractedJson) {
      // Remove code fence markers if present
      let cleaned = jsonText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      const firstBrace = cleaned.indexOf('{');
      if (firstBrace >= 0) {
        cleaned = cleaned.substring(firstBrace);
        // Try to find end by counting braces
        let braceCount = 0;
        let endPos = -1;
        for (let i = 0; i < cleaned.length; i++) {
          if (cleaned[i] === '{') braceCount++;
          if (cleaned[i] === '}') {
            braceCount--;
            if (braceCount === 0) {
              endPos = i + 1;
              break;
            }
          }
        }
        if (endPos > 0) {
          extractedJson = cleaned.substring(0, endPos);
        }
      }
    }
    
    if (!extractedJson) {
      log('[Phase 4] Semantic re-rank failed: No JSON object in response');
      return candidates;
    }
    
    let rankingResult;
    try {
      // Clean up the JSON string - remove trailing commas, trim whitespace
      let cleanedJson = extractedJson.trim();
      // Remove any remaining code fence markers
      cleanedJson = cleanedJson.replace(/^```json\s*/gi, '').replace(/^```\s*/g, '').replace(/\s*```$/g, '').trim();
      // Remove trailing commas
      cleanedJson = cleanedJson.replace(/,\s*\]/g, ']').replace(/,\s*\}/g, '}');
      
      rankingResult = JSON.parse(cleanedJson);
    } catch (parseErr) {
      log('[Phase 4] Semantic re-rank failed: Invalid JSON', parseErr, 'Extracted:', extractedJson.slice(0, 200));
      return candidates;
    }
    
    let rankedItems = [];
    let confidence = 0.5;
    let needsFollowup = false;
    let followupQuestion = null;
    
    if (rankingResult.ranked && Array.isArray(rankingResult.ranked)) {
      rankedItems = rankingResult.ranked;
      confidence = rankingResult.confidence || 0.5;
      needsFollowup = rankingResult.needsFollowup || false;
      followupQuestion = rankingResult.followupQuestion || null;
    } else if (Array.isArray(rankingResult)) {
      rankedItems = rankingResult.map(cardId => ({ cardId, score: 0.7 }));
      confidence = 0.7;
    } else {
      log('[Phase 4] Semantic re-rank failed: Unexpected format');
      return candidates;
    }
    
    const cardIdToCandidate = new Map(top10.map(c => [c.card.cardId, c]));
    const reordered = [];
    const used = new Set();
    
    for (const item of rankedItems) {
      const cardId = typeof item === 'string' ? item : item.cardId;
      if (cardIdToCandidate.has(cardId) && !used.has(cardId)) {
        const candidate = cardIdToCandidate.get(cardId);
        candidate.aiScore = typeof item === 'object' ? (item.score || 0.5) : 0.7;
        candidate.aiReason = typeof item === 'object' ? (item.reason || '') : '';
        reordered.push(candidate);
        used.add(cardId);
      }
    }
    
    for (const candidate of top10) {
      if (!used.has(candidate.card.cardId)) {
        candidate.aiScore = 0.3;
        reordered.push(candidate);
      }
    }
    
    reordered._metadata = {
      confidence,
      needsFollowup,
      followupQuestion,
      topScore: rankedItems.length > 0 ? (typeof rankedItems[0] === 'object' ? rankedItems[0].score : 0.7) : 0,
      secondScore: rankedItems.length > 1 ? (typeof rankedItems[1] === 'object' ? rankedItems[1].score : 0.7) : 0
    };
    
    return [...reordered, ...candidates.slice(10)];
    
  } catch (err) {
    log('[Phase 4] Semantic re-rank error:', err);
    return candidates;
  }
}

// ==== PROCESS CANDIDATES (MAIN PIPELINE) ====
const AUTO_EXECUTE_MIN_SCORE = 0.80;
const AUTO_EXECUTE_MIN_SCORE_STRICT = 0.85;
const AUTO_EXECUTE_MIN_GAP = 0.05;

export async function processCandidates(lexicalResults, intent, query, useSemanticRerank = false, sessionId = null) {
  const startTime = performance.now();
  const beforeFilters = lexicalResults.length;
  
  let filteredLexical = lexicalResults;
  if (intent.constraints?.resultMustBeOpen === true) {
    filteredLexical = lexicalResults.filter(c => c.card.source === 'tab');
  }
  
  // Migrate old "app" to "includeApps" if needed (for backward compatibility)
  if (intent.constraints?.app && !intent.constraints?.includeApps) {
    const appValue = intent.constraints.app;
    intent.constraints.includeApps = Array.isArray(appValue) ? appValue : (appValue ? [appValue] : []);
  }
  
  structuredLog('Phase 4', 'process_candidates_start', {
    intent: intent.intent,
    query: query || intent.canonical_query || intent.query || '',
    beforeFilters,
    afterOpenTabsFilter: filteredLexical.length,
    hasConstraints: !!intent.constraints,
    resultMustBeOpen: intent.constraints?.resultMustBeOpen,
    includeApps: intent.constraints?.includeApps,
    excludeApps: intent.constraints?.excludeApps,
    requestId: sessionId || null
  });
  
  recordTelemetry('search', 'lexical');
  
  // SPEED OPTIMIZATION: Check for high-confidence single match BEFORE dedup
  // If top lexical result has score >= 0.9 and is unique, skip semantic rerank entirely
  if (filteredLexical.length === 1 && filteredLexical[0].score >= 0.90) {
    const topCandidate = filteredLexical[0];
    if (topCandidate.card.source === 'tab' && ['open', 'find_open'].includes(intent.intent)) {
      structuredLog('Phase 4', 'high_confidence_single_match', {
        score: topCandidate.score,
        cardId: topCandidate.card.cardId,
        skipSemanticRerank: true
      });
      return {
        ok: true,
        autoExecute: true,
        candidate: topCandidate,
        confidence: topCandidate.score,
        metadata: { skipSemanticRerank: true }
      };
    }
  }
  
  // DEDUP (order: tabId → url normalized → domain+title)
  const seenById = new Map();
  const seenByUrl = new Map();
  const seenByDomainTitle = new Map();
  
  for (const candidate of filteredLexical) {
    const cardId = candidate.card.cardId;
    const tabId = candidate.card.tabId;
    const urlNormalized = normalizeUrl(candidate.card.url || '');
    const domain = (candidate.card.domain || '').toLowerCase().trim();
    const title = (candidate.card.title || '').toLowerCase().trim();
    const domainTitleKey = domain && title ? `${domain}|${title}` : null;
    const score = candidate.score || 0;
    
    if (tabId) {
      const existingByTabId = Array.from(seenById.values()).find(c => c.card.tabId === tabId);
      if (existingByTabId && existingByTabId.score >= score) {
        continue;
      }
      if (existingByTabId && existingByTabId.score < score) {
        seenById.delete(existingByTabId.card.cardId);
        if (existingByTabId.card.url) {
          seenByUrl.delete(normalizeUrl(existingByTabId.card.url));
        }
      }
    }
    
    const existingById = seenById.get(cardId);
    if (existingById && existingById.score >= score) {
      continue;
    }
    
    // Skip URL deduplication for open tabs with different tabIds
    // (different docs.google.com documents can have same normalized URL base but different document IDs)
    // Only dedupe by URL if it's NOT an open tab, OR if both have same tabId (same tab)
    const existingByUrl = urlNormalized ? seenByUrl.get(urlNormalized) : null;
    if (existingByUrl) {
      // For open tabs: only dedupe if same tabId (same tab)
      if (candidate.card.source === 'tab' && existingByUrl.card.source === 'tab') {
        // Both are open tabs - only dedupe if same tabId
        if (tabId && existingByUrl.card.tabId && tabId === existingByUrl.card.tabId) {
          // Same tab - keep the one with higher score
          if (existingByUrl.score >= score) {
            continue;
          }
          seenById.delete(existingByUrl.card.cardId);
        } else {
          // Different tabs (even if same URL) - keep both
          // Don't dedupe, just continue to add this one too
        }
      } else {
        // Not both open tabs - use original logic
        const preferExisting = (existingByUrl.card.source === 'tab' && candidate.card.source !== 'tab') ||
                              (existingByUrl.score >= score && existingByUrl.card.source === candidate.card.source);
        if (preferExisting) {
          continue;
        }
        seenById.delete(existingByUrl.card.cardId);
      }
    }
    
    // Skip domain+title deduplication for open tabs - keep all tabs even if same domain+title
    // (different docs.google.com documents can have same title but different URLs)
    // Only dedupe by domain+title if it's NOT an open tab (e.g., history/bookmarks)
    if (domainTitleKey && candidate.card.source !== 'tab') {
      const existingByDomainTitle = seenByDomainTitle.get(domainTitleKey);
      if (existingByDomainTitle) {
        const preferExisting = (existingByDomainTitle.card.source === 'tab' && candidate.card.source !== 'tab') ||
                              (existingByDomainTitle.score >= score);
        if (preferExisting) {
          continue;
        }
        seenById.delete(existingByDomainTitle.card.cardId);
        if (existingByDomainTitle.card.url) {
          seenByUrl.delete(normalizeUrl(existingByDomainTitle.card.url));
        }
      }
      seenByDomainTitle.set(domainTitleKey, candidate);
    }
    
    seenById.set(cardId, candidate);
    if (urlNormalized) {
      seenByUrl.set(urlNormalized, candidate);
    }
  }
  const deduplicated = Array.from(seenById.values());
  
  const filtered = filterCandidatesByConstraints(deduplicated, intent.constraints);
  const afterFilters = filtered.length;
  
  // SPEED: Early exit for single candidate after filtering (saves semantic rerank time)
  // ACCURACY: If there's only one candidate and it's an open tab, auto-execute immediately (very low threshold)
  if (filtered.length === 1 && ['open', 'find_open'].includes(intent.intent)) {
    const singleCandidate = filtered[0];
    if (singleCandidate.card.source === 'tab' && singleCandidate.score >= 0.40) {
      structuredLog('Phase 4', 'single_candidate_early_exit', {
        score: singleCandidate.score,
        cardId: singleCandidate.card.cardId,
        skipSemanticRerank: true
      });
      return {
        ok: true,
        autoExecute: true,
        candidate: singleCandidate,
        confidence: singleCandidate.score,
        metadata: { skipSemanticRerank: true, earlyExit: true }
      };
    }
  }
  
  if (filtered.length === 0) {
    const allCandidates = lexicalResults.length > 0 ? lexicalResults : [];
    recordTelemetry('search', 'no_candidates', false);
    structuredLog('Phase 4', 'no_candidates', {
      intent: intent.intent,
      query: query || intent.query,
      lexicalMatches: allCandidates.length
    });
    return { 
      ok: false, 
      reason: 'no_candidates', 
      closestMatches: allCandidates.slice(0, 5)
    };
  }
  
  const candidatesForRerank = filtered.slice(0, 15);
  
  // SPEED OPTIMIZATION: Skip semantic rerank if:
  // 1. Only 1-2 candidates (lexical is good enough)
  // 2. Top score >= 0.85 and gap >= 0.15 (clear winner)
  // 3. User explicitly disabled it
  const topLexicalScore = candidatesForRerank[0]?.score || 0;
  const secondLexicalScore = candidatesForRerank[1]?.score || 0;
  const lexicalScoreGap = topLexicalScore - secondLexicalScore;
  const shouldSkipSemanticRerank = !useSemanticRerank || 
                                    candidatesForRerank.length <= 2 ||
                                    (topLexicalScore >= 0.85 && lexicalScoreGap >= 0.15);
  
  let finalCandidates = candidatesForRerank;
  if (candidatesForRerank.length > 0 && !shouldSkipSemanticRerank) {
    recordTelemetry('search', 'ai_semantic_rerank');
    
    // Timeout set to 60 seconds to allow complex semantic reranking to complete
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('semantic_rerank_timeout')), 60000)
    );
    
    let semanticResults;
    try {
      const semanticPromise = semanticRerank(candidatesForRerank, query || intent.canonical_query || intent.query || '', sessionId, intent);
      semanticResults = await Promise.race([semanticPromise, timeoutPromise]);
    } catch (timeoutErr) {
      // If semantic rerank times out or fails, just use lexical results
      log('Semantic rerank timeout/failed, using lexical results only');
      semanticResults = candidatesForRerank; // Fallback to lexical-only
    }
    
    if (!semanticResults || semanticResults.length === 0) {
      semanticResults = candidatesForRerank; // Safety fallback
    }
    
    const lexicalScores = new Map(candidatesForRerank.map(c => [c.card.cardId, c.score || 0]));
    const semanticScores = new Map();
    
    if (semanticResults && semanticResults.length > 0) {
      semanticResults.forEach((c, idx) => {
        const cardId = c.card.cardId;
        const aiScore = (c.aiScore || ((semanticResults.length - idx) / semanticResults.length) * 0.8) * 100;
        semanticScores.set(cardId, aiScore);
      });
    }
    
    // HYBRID SCORING: 0.4*lex + 0.6*sem + boosts
    finalCandidates = candidatesForRerank.map(candidate => {
      const cardId = candidate.card.cardId;
      const lexicalScoreRaw = lexicalScores.get(cardId) || 0;
      const semanticScoreRaw = semanticScores.get(cardId) || 0;
      
      const lex = Math.min(lexicalScoreRaw / 30, 1.0);
      const sem = semanticScoreRaw / 100;
      
      let hybridScore = (0.4 * lex) + (0.6 * sem);
      
      if (candidate.card.source === 'tab') {
        hybridScore += 0.10;
      }
      
      if (intent?.constraints?.group && candidate.card.groupName) {
        const groupLower = (candidate.card.groupName || '').toLowerCase();
        const constraintLower = String(intent.constraints.group).toLowerCase();
        if (groupLower === constraintLower) {
          hybridScore += 0.08;
        }
      }
      
      const queryText = (query || intent.canonical_query || intent.query || '').toLowerCase();
      const domainLower = (candidate.card.domain || '').toLowerCase();
      if (domainLower === queryText || domainLower.startsWith(queryText + '.')) {
        hybridScore += 0.08;
      }
      
      const now = Date.now();
      const ageDays = (now - (candidate.card.lastVisitedAt || 0)) / (24 * 60 * 60 * 1000);
      if (ageDays < 1) {
        hybridScore += 0.05;
      }
      
      hybridScore = Math.min(hybridScore, 1.0);
      
      return {
        ...candidate,
        score: hybridScore,
        lexicalScore: lex,
        semanticScore: sem,
        aiScore: sem,
        aiReason: candidate.aiReason || ''
      };
    });
    
    finalCandidates.sort((a, b) => b.score - a.score);
    
    if (finalCandidates.length > 0) {
      finalCandidates._metadata = {
        ...finalCandidates._metadata,
        topScore: finalCandidates[0].score,
        secondScore: finalCandidates[1] ? finalCandidates[1].score : 0,
        hybridSearch: true
      };
    }
  }
  
  // FINAL DEDUP
  const finalDeduplicated = [];
  const finalSeenById = new Set();
  const finalSeenByTabId = new Set();
  const finalSeenByUrl = new Set();
  const finalSeenByDomainTitle = new Map();
  
  for (const candidate of finalCandidates) {
    const cardId = candidate.card.cardId;
    const tabId = candidate.card.tabId;
    const urlNormalized = normalizeUrl(candidate.card.url || '');
    const domain = (candidate.card.domain || '').toLowerCase().trim();
    const title = (candidate.card.title || '').toLowerCase().trim();
    const domainTitleKey = domain && title ? `${domain}|${title}` : null;
    
    if (tabId && finalSeenByTabId.has(tabId)) {
      continue;
    }
    
    if (finalSeenById.has(cardId)) {
      continue;
    }
    
    // Skip URL deduplication for open tabs with different tabIds
    // Only dedupe by URL if it's NOT an open tab, OR if both have same tabId (same tab)
    if (urlNormalized && finalSeenByUrl.has(urlNormalized)) {
      const existingByUrlCard = finalDeduplicated.find(c => {
        const existingUrl = normalizeUrl(c.card.url || '');
        return existingUrl === urlNormalized;
      });
      
      if (existingByUrlCard) {
        // For open tabs: only dedupe if same tabId (same tab)
        if (candidate.card.source === 'tab' && existingByUrlCard.card.source === 'tab') {
          // Both are open tabs - only dedupe if same tabId
          if (tabId && existingByUrlCard.card.tabId && tabId === existingByUrlCard.card.tabId) {
            // Same tab - skip
            continue;
          } else {
            // Different tabs (even if same normalized URL) - keep both
            // Don't skip, continue to add this one too
          }
        } else {
          // Not both open tabs - dedupe normally
          continue;
        }
      } else {
        continue;
      }
    }
    
    // Skip domain+title deduplication for open tabs - keep all tabs even if same domain+title
    // (different docs.google.com documents can have same title but different URLs)
    // Only dedupe by domain+title if it's NOT an open tab (e.g., history/bookmarks)
    if (domainTitleKey && candidate.card.source !== 'tab') {
      const existing = finalSeenByDomainTitle.get(domainTitleKey);
      if (existing) {
        const candidateScore = candidate.score || candidate.aiScore || 0;
        const existingScore = existing.score || existing.aiScore || 0;
        
        const preferExisting = (existing.card.source === 'tab' && candidate.card.source !== 'tab') ||
                              (existingScore >= candidateScore);
        if (preferExisting) {
          continue;
        }
        
        const existingIndex = finalDeduplicated.findIndex(c => c.card.cardId === existing.card.cardId);
        if (existingIndex >= 0) {
          finalDeduplicated.splice(existingIndex, 1);
          finalSeenById.delete(existing.card.cardId);
          if (existing.card.tabId) {
            finalSeenByTabId.delete(existing.card.tabId);
          }
          if (existing.card.url) {
            finalSeenByUrl.delete(normalizeUrl(existing.card.url));
          }
        }
      }
      finalSeenByDomainTitle.set(domainTitleKey, candidate);
    }
    
    finalSeenById.add(cardId);
    if (tabId) {
      finalSeenByTabId.add(tabId);
    }
    if (urlNormalized) {
      finalSeenByUrl.add(urlNormalized);
    }
    finalDeduplicated.push(candidate);
  }
  
  if (finalCandidates.length !== finalDeduplicated.length) {
    structuredLog('Phase 12', 'deduplication_occurred', {
      before: finalCandidates.length,
      after: finalDeduplicated.length,
      removed: finalCandidates.length - finalDeduplicated.length
    });
  }
  
  const metadata = finalDeduplicated._metadata || finalCandidates._metadata || {};
  
  const normalizeScore = (score) => {
    if (!score && score !== 0) return 0;
    return score > 1 ? score / 100 : score;
  };
  
  const topScore = normalizeScore(metadata.topScore ?? finalDeduplicated[0]?.score ?? finalDeduplicated[0]?.aiScore ?? 0);
  const secondScore = normalizeScore(metadata.secondScore ?? finalDeduplicated[1]?.score ?? finalDeduplicated[1]?.aiScore ?? 0);
  const scoreGap = topScore - secondScore;
  
  const sameTitleDifferentDomains = finalDeduplicated.length > 1 && 
    finalDeduplicated.slice(0, 2).every((c, i, arr) => {
      if (i === 0) return true;
      const prev = arr[i - 1];
      const curr = c;
      const prevTitle = (prev.card.title || '').toLowerCase().trim();
      const currTitle = (curr.card.title || '').toLowerCase().trim();
      const prevDomain = (prev.card.domain || '').toLowerCase();
      const currDomain = (curr.card.domain || '').toLowerCase();
      return prevTitle === currTitle && prevTitle.length > 0 && prevDomain !== currDomain;
    });
  
  const domainsInResults = new Set(finalDeduplicated.slice(0, 5).map(c => c.card.domain));
  const hasManySameDomain = domainsInResults.size === 1 && finalDeduplicated.length >= 2;
  const autoExecuteThreshold = hasManySameDomain ? AUTO_EXECUTE_MIN_SCORE_STRICT : AUTO_EXECUTE_MIN_SCORE;
  
  const isSingleMatch = finalDeduplicated.length === 1;
  const isOpenTab = intent.constraints?.resultMustBeOpen !== true || finalDeduplicated[0]?.card?.source === 'tab';
  const scoreGapMeetsThreshold = scoreGap >= AUTO_EXECUTE_MIN_GAP || isSingleMatch;
  // For single match, auto-execute if score >= 0.50 (very lenient for single match)
  // SPEED: Lower thresholds for faster auto-execution
  // For single matches, be very aggressive (0.50 threshold) - if there's only one match, auto-execute
  // For multiple matches, require 0.75 (instead of 0.80) if gap is clear
  const singleMatchThreshold = isSingleMatch ? 0.50 : 0.75;
  const canAutoExecute = ['open', 'find_open'].includes(intent.intent) && 
                         isSingleMatch &&
                         isOpenTab &&
                         !sameTitleDifferentDomains &&
                         topScore >= singleMatchThreshold &&
                         scoreGapMeetsThreshold;
  
  const scoresClustered = finalDeduplicated.length > 1 && 
                         finalDeduplicated.length <= 5 &&
                         topScore > 0.5 &&
                         (scoreGap < AUTO_EXECUTE_MIN_GAP || sameTitleDifferentDomains);
  
  if (scoresClustered) {
    structuredLog('Phase 12', 'scores_clustered', {
      topScore,
      secondScore,
      gap: scoreGap,
      sameTitleDifferentDomains,
      forcingDisambiguation: true
    });
  }
  
  if (sameTitleDifferentDomains && canAutoExecute) {
    structuredLog('Phase 12', 'same_title_override', {
      reason: 'Multiple tabs with same title but different domains - showing disambiguation',
      titles: finalDeduplicated.slice(0, 2).map(c => c.card.title),
      domains: finalDeduplicated.slice(0, 2).map(c => c.card.domain)
    });
  }
  
  if (finalCandidates.length > 10 && !canAutoExecute) {
    const clarifier = await askSpecificClarifier(intent, finalCandidates.slice(0, 10));
    recordTelemetry('search', 'too_many_candidates', false);
    structuredLog('Phase 8', 'too_many_candidates', {
      intent: intent.intent,
      count: finalCandidates.length,
      clarifier
    });
    return { ok: false, reason: 'too_many_candidates', clarifier, candidates: finalCandidates.slice(0, 10) };
  }
  
  const topN = Math.min(5, Math.max(3, finalDeduplicated.length));
  const shortlist = finalDeduplicated.slice(0, topN);
  
  const duration = performance.now() - startTime;
  structuredLog('Phase 4', 'process_candidates_complete', {
    intent: intent.intent,
    beforeFilters,
    afterFilters,
    beforeDeduplication: finalCandidates.length,
    afterDeduplication: finalDeduplicated.length,
    shortlistSize: shortlist.length,
    autoExecute: canAutoExecute,
    topScore,
    secondScore,
    scoreGap,
    isSingleMatch,
    sameTitleDifferentDomains,
    durationMs: duration.toFixed(1),
    requestId: sessionId || null
  });
  
  if (canAutoExecute) {
    structuredLog('Phase 12', 'auto_execute_decision', {
      intent: intent.intent,
      isSingleMatch: true,
      topScore,
      cardId: shortlist[0]?.card?.cardId,
      cardTitle: shortlist[0]?.card?.title
    });
    return {
      ok: true,
      autoExecute: true,
      candidate: shortlist[0],
      confidence: topScore,
      metadata: metadata
    };
  }
  
  structuredLog('Phase 12', 'disambiguation_needed', {
    intent: intent.intent,
    candidateCount: shortlist.length,
    topScore,
    secondScore,
    scoreGap,
    scoresClustered
  });
  return {
    ok: true,
    autoExecute: false,
    candidates: shortlist,
    metadata: metadata,
    needsFollowup: metadata.needsFollowup || false,
    followupQuestion: metadata.followupQuestion || null
  };
}

// ==== ASK SPECIFIC CLARIFIER ====
export async function askSpecificClarifier(intent, shortlist) {
  const domains = new Set(shortlist.map(c => c.card.domain).filter(Boolean));
  const types = new Set(shortlist.map(c => c.card.type).filter(Boolean));
  
  if (domains.size >= 2) {
    const domainArray = Array.from(domains);
    return `Which site? ${domainArray.slice(0, 2).join(' or ')}?`;
  }
  
  if (types.size >= 2) {
    const typeArray = Array.from(types);
    return `Which type? ${typeArray.slice(0, 2).join(' or ')}?`;
  }
  
  if (intent.constraints?.dateRange) {
    return 'When roughly—this week or last month?';
  }
  
  return await generateClarifyingQuestion(intent, shortlist) || 'Which one did you mean?';
}

// ==== GENERATE CLARIFYING QUESTION ====
export async function generateClarifyingQuestion(intent, shortlist) {
  try {
    const available = await checkPromptApiAvailability();
    if (!available) return null;
    
    const prompt = `You are Tabitha. Generate a short clarifying question.

Query: "${intent.canonical_query || intent.query || ''}"
Intent: ${intent.intent}

Candidates:
${shortlist.map((c, i) => `${i+1}. ${c.card.title} (${c.card.domain}, ${c.card.type}, ${c.card.source})`).join('\n')}

Generate ONE concise clarifying question. Be specific based on differences.

Question:`;

    const res = await postToOffscreen('OFFSCREEN_RUN_PROMPT_LM', { prompt });
    const question = res?.text?.trim() || null;
    
    if (question) {
      log('[Phase 5] Generated clarifying question:', question);
    }
    
    return question;
  } catch (err) {
    log('[Phase 5] Failed to generate clarifying question:', err);
    return null;
  }
}

// ==== FORMAT DISAMBIGUATION LIST ====
export function formatDisambiguationList(shortlist) {
  return shortlist.map(c => {
    const card = c.card;
    const age = card.lastVisitedAt ? formatAge(Date.now() - card.lastVisitedAt) : 'unknown';
    const typeLabel = card.type || 'page';
    const sourceLabel = card.source === 'tab' ? 'Open tab' : 
                       card.source === 'bookmark' ? 'Bookmark' :
                       card.source === 'history' ? 'History' : 'Closed';
    
    return {
      cardId: card.cardId,
      title: card.title || card.url || 'Untitled',
      domain: card.domain || '',
      type: typeLabel,
      source: card.source,
      sourceLabel,
      age,
      score: c.score,
      url: card.url
    };
  });
}

// ==== FORMAT AGE ====
export function formatAge(ms) {
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  
  if (days === 0) return 'today';
  if (days === 1) return '1d';
  if (days < 7) return `${days}d`;
  if (weeks === 1) return '1w';
  if (weeks < 4) return `${weeks}w`;
  if (months === 1) return '1mo';
  if (months < 12) return `${months}mo`;
  return '1y+';
}

