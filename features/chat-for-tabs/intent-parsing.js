// Chat with your Tabs - Intent Parsing
// Uses Prompt API to parse user queries into structured actions
// Includes: checkPromptApiAvailability, parseIntentWithPrompt, parseIntent, preprocessQuery

import { ensureOffscreen, postToOffscreen, structuredLog, recordTelemetry } from './utils.js';
import { getChatSessionId, formatConversationForPrompt, getLastDisambiguationCandidates } from './conversation.js';

const log = (...a) => console.log("[Tabitha::chat]", ...a);

// ==== PHASE 3: CHECK PROMPT API AVAILABILITY ====
// SPEED: Cache Prompt API availability check
let apiAvailableCache = { value: null, timestamp: 0 };
const API_CACHE_TTL = 60000; // 1 minute

export async function checkPromptApiAvailability() {
  const now = Date.now();
  // Check cache first (saves 500ms-1s per check)
  if (apiAvailableCache.value !== null && (now - apiAvailableCache.timestamp) < API_CACHE_TTL) {
    return apiAvailableCache.value;
  }
  
  try {
    await ensureOffscreen();
    const res = await postToOffscreen('CHECK_PROMPT_AVAILABILITY', {});
    const result = res?.available === true;
    apiAvailableCache = { value: result, timestamp: now };
    return result;
  } catch (err) {
    log('Prompt API availability check failed:', err);
    apiAvailableCache = { value: false, timestamp: now };
    return false;
  }
}

// ==== CHAT-FOR-TABS: UNIFIED ROUTER PROMPT (SINGLE SOURCE OF TRUTH) ====
export async function parseIntentWithPrompt(text, sessionId, preprocessed = null) {
  const sessionId_actual = sessionId || getChatSessionId();
  const conversationContext = formatConversationForPrompt(sessionId_actual);
  
  // ACCURACY: Include previous candidates if anaphora detected (for "those", "it", "that")
  let previousCandidatesContext = '';
  const lowerText = text.toLowerCase().trim();
  const anaphoraWords = ['those', 'them', 'it', 'that', 'these', 'this'];
  const isAnaphora = anaphoraWords.some(word => lowerText === word || lowerText.startsWith(word + ' '));
  if (isAnaphora) {
    const lastCandidates = getLastDisambiguationCandidates(sessionId_actual);
    if (lastCandidates?.candidates && lastCandidates.candidates.length > 0) {
      previousCandidatesContext = `\nPrevious candidates:\n${lastCandidates.candidates.map((c, i) => `${i + 1}. cardId: ${c.cardId}, title: "${c.title}", domain: ${c.domain}`).join('\n')}\n`;
    }
  }
  
  // Include preprocessed versions if available
  const preprocessInfo = preprocessed ? `
User input (raw): "${preprocessed.raw || text}"
User input (cleaned): "${preprocessed.cleaned || text}"
User input (rewritten): "${preprocessed.rewritten || text}"
` : '';
  
  const prompt = `You are Tabitha, a smart browser assistant. Parse user queries into structured actions.

${conversationContext ? `Previous conversation:\n${conversationContext}\n` : ''}
${previousCandidatesContext}
${preprocessInfo}

## Intent Selection Rules
**ACTION REQUESTS** (use action intents: open, close, save, etc.):
- "Can you open...", "Please open...", "Open...", "Show me...", "Jump to...", "Switch to..." → intent: "open"
- "Close...", "Remove...", "Delete..." → intent: "close"
- "Save...", "Bookmark..." → intent: "save"
- Imperative sentences (verbs at start) → action intents

**QUESTIONS** (use "ask" intent):
- "What...", "How...", "When...", "Where...", "Which..." → intent: "ask"
- "What tabs do I have?" → intent: "ask"
- "When did I visit...?" → intent: "ask"

**IMPORTANT**: "Can you open X" is an ACTION REQUEST → use "open", NOT "ask".
"Can you" is polite phrasing for a command, not a question.

## Intents (enum)
open | find_open | close | reopen | save | list | ask | mute | unmute | pin | unpin | reload | discard

- open: Activate/open a tab (defaults to OPEN TABS ONLY unless time mentioned)
- find_open: Locate open tabs without switching yet
- close: Close matching tabs (OPEN TABS ONLY)
- reopen: Restore recently closed tabs
- save: Bookmark tabs (optionally to named folder/group)
- list: List tabs with summaries (replaces "show")
- ask: Answer questions about browsing activity (only for "what/how/when/where/which" questions)
- mute: Mute matching tabs (set muted:true, uses excludeApps)
- unmute: Unmute matching tabs (set muted:false)
- pin: Pin matching tabs (set pinned:true)
- unpin: Unpin matching tabs (set pinned:false)
- reload: Reload/refresh matching tabs
- discard: Discard (sleep) matching tabs to save memory

## Output schema
{
  "intent": "<intent>",
  "canonical_query": "<normalized text>",

  "constraints": {
    "scope": "tab|group|null",
    "resultMustBeOpen": true|false,
    "dateRange": {"since": "YYYY-MM-DD"|null, "until": "YYYY-MM-DD"|null} | null,
    "includeApps": ["domain1", "domain2"] | [],
    "excludeApps": ["domainX"] | [],
    "group": "<group name>|null",
    "limit": 1|3|5|10|null
  },

  "operation": "<operation>|null",
  "operation_args": {"rename_to":"<name>", "collapse": true|false} | null,

  "folderName": "<bookmark folder>|null",
  "disambiguationNeeded": true|false,
  "hints": [{"title":"<short>", "domain":"<base-domain>"}] | [],

  "anaphora_of": "<previous_query_id>|null",
  "time_reason": "<why history allowed>|null",
  "notes": "<brief rationale>"
}

## Time gating
- Set constraints.resultMustBeOpen = true by default.
- Set it to false only if the user mentions time (yesterday, last night, 3pm, 2 days ago, last week, earlier today, etc.). Then fill dateRange.since with an ISO date (YYYY-MM-DD) and set time_reason.

## App mapping guidelines
- Extract domains: "gmail" → ["mail.google.com","gmail.com"], "calendar" → ["calendar.google.com"], "docs" → ["docs.google.com"], "zoom" → ["zoom.us"], "meet" → ["meet.google.com"], "youtube" → ["youtube.com","music.youtube.com"], "drive" → ["drive.google.com"], "notion" → ["notion.so"], "substack" → ["substack.com"], "github" → ["github.com"].
- Prefer includeApps array; leave empty if unknown.

## Disambiguation
- Set disambiguationNeeded = true when the request likely matches multiple tabs (e.g., "open google docs").
- Provide up to 5 hints (very short): title (6 words or less) + base domain.

## Operation field (for group actions)
- Use operation for group-level actions: move_to_window, rename, collapse, expand.
- Use operation_args for operation-specific parameters: {"rename_to": "...", "collapse": true}.
- For group operations, use intent: "list" with scope: "group".

EXAMPLES:

Input: "open substack"
Output: {"intent":"open","canonical_query":"substack","constraints":{"scope":null,"resultMustBeOpen":true,"dateRange":null,"includeApps":[],"excludeApps":[],"group":null,"limit":null},"operation":null,"operation_args":null,"folderName":null,"disambiguationNeeded":true,"hints":[],"anaphora_of":null,"time_reason":null,"notes":"generic app, may have multiple open tabs"}

Input: "close all youtube tabs"
Output: {"intent":"close","canonical_query":"youtube","constraints":{"scope":null,"resultMustBeOpen":true,"dateRange":null,"includeApps":["youtube.com","music.youtube.com"],"excludeApps":[],"group":null,"limit":null},"operation":null,"operation_args":null,"folderName":null,"disambiguationNeeded":true,"hints":[],"anaphora_of":null,"time_reason":null,"notes":"bulk close likely"}

Input: "jump to git"
Output: {"intent":"open","canonical_query":"github","constraints":{"scope":null,"resultMustBeOpen":true,"dateRange":null,"includeApps":["github.com"],"excludeApps":[],"group":null,"limit":null},"operation":null,"operation_args":null,"folderName":null,"disambiguationNeeded":false,"hints":[],"anaphora_of":null,"time_reason":null,"notes":"activate github tab"}

Input: "save these five as raise-research"
Output: {"intent":"save","canonical_query":"","constraints":{"scope":null,"resultMustBeOpen":true,"dateRange":null,"includeApps":[],"excludeApps":[],"group":null,"limit":5},"operation":null,"operation_args":null,"folderName":"raise-research","disambiguationNeeded":false,"hints":[],"anaphora_of":null,"time_reason":null,"notes":"bookmark selected set"}

Input: "mute all except zoom"
Output: {"intent":"mute","canonical_query":"","constraints":{"scope":null,"resultMustBeOpen":true,"dateRange":null,"includeApps":[],"excludeApps":["zoom.us"],"group":null,"limit":null},"operation":null,"operation_args":null,"folderName":null,"disambiguationNeeded":false,"hints":[],"anaphora_of":null,"time_reason":null,"notes":"exclude zoom from muting"}

Input: "what google doc was i working on yesterday?"
Output: {"intent":"ask","canonical_query":"google doc worked yesterday","constraints":{"scope":null,"resultMustBeOpen":false,"dateRange":{"since":"2025-01-14","until":null},"includeApps":["docs.google.com"],"excludeApps":[],"group":null,"limit":null},"operation":null,"operation_args":null,"folderName":null,"disambiguationNeeded":false,"hints":[],"anaphora_of":null,"time_reason":"user said 'yesterday'","notes":"history allowed due to explicit time"}

Input: "move the Design Sprint group to a new window"
Output: {"intent":"list","canonical_query":"design sprint","constraints":{"scope":"group","resultMustBeOpen":true,"dateRange":null,"includeApps":[],"excludeApps":[],"group":"design sprint","limit":null},"operation":"move_to_window","operation_args":null,"folderName":null,"disambiguationNeeded":false,"hints":[],"anaphora_of":null,"time_reason":null,"notes":"group operation move_to_window"}

Input: "rename 'Misc' group to 'Parking Lot' and collapse it"
Output: {"intent":"list","canonical_query":"misc","constraints":{"scope":"group","resultMustBeOpen":true,"dateRange":null,"includeApps":[],"excludeApps":[],"group":"misc","limit":null},"operation":"rename","operation_args":{"rename_to":"parking lot","collapse":true},"folderName":null,"disambiguationNeeded":false,"hints":[],"anaphora_of":null,"time_reason":null,"notes":"group rename and collapse"}

Input: "open tab from last night"
Output: {"intent":"open","canonical_query":"","constraints":{"scope":null,"resultMustBeOpen":false,"dateRange":{"since":"2025-01-14","until":null},"includeApps":[],"excludeApps":[],"group":null,"limit":null},"operation":null,"operation_args":null,"folderName":null,"disambiguationNeeded":false,"hints":[],"anaphora_of":null,"time_reason":"user said 'last night'","notes":"time mentioned, can search history"}

Input: "close those"
Output: {"intent":"close","canonical_query":"","constraints":{"scope":null,"resultMustBeOpen":true,"dateRange":null,"includeApps":[],"excludeApps":[],"group":null,"limit":null},"operation":null,"operation_args":null,"folderName":null,"disambiguationNeeded":true,"hints":[],"anaphora_of":"<previous_query_hash>","time_reason":null,"notes":"anaphoric reference to previous query"}

Input: "show notion tabs from last week"
Output: {"intent":"list","canonical_query":"notion","constraints":{"scope":null,"resultMustBeOpen":false,"dateRange":{"since":"2025-01-08","until":null},"includeApps":["notion.so"],"excludeApps":[],"group":null,"limit":null},"operation":null,"operation_args":null,"folderName":null,"disambiguationNeeded":false,"hints":[],"anaphora_of":null,"time_reason":"user said 'last week'","notes":"time mentioned, can search history"}

Input: "open calendar"
Output: {"intent":"open","canonical_query":"calendar","constraints":{"scope":null,"resultMustBeOpen":true,"dateRange":null,"includeApps":["calendar.google.com"],"excludeApps":[],"group":null,"limit":null},"operation":null,"operation_args":null,"folderName":null,"disambiguationNeeded":true,"hints":[],"anaphora_of":null,"time_reason":null,"notes":"may have multiple calendar tabs"}

Input: "open google docs"
Output: {"intent":"open","canonical_query":"google docs","constraints":{"scope":null,"resultMustBeOpen":true,"dateRange":null,"includeApps":["docs.google.com"],"excludeApps":[],"group":null,"limit":null},"operation":null,"operation_args":null,"folderName":null,"disambiguationNeeded":true,"hints":[],"anaphora_of":null,"time_reason":null,"notes":"likely multiple docs tabs"}

Input: "open the cover letter doc"
Output: {"intent":"open","canonical_query":"cover letter","constraints":{"scope":null,"resultMustBeOpen":true,"dateRange":null,"includeApps":["docs.google.com"],"excludeApps":[],"group":null,"limit":null},"operation":null,"operation_args":null,"folderName":null,"disambiguationNeeded":false,"hints":[],"anaphora_of":null,"time_reason":null,"notes":"specific document title, likely unique"}

Input: "Can you open the cover letter document for me"
Output: {"intent":"open","canonical_query":"cover letter document","constraints":{"scope":null,"resultMustBeOpen":true,"dateRange":null,"includeApps":["docs.google.com"],"excludeApps":[],"group":null,"limit":null},"operation":null,"operation_args":null,"folderName":null,"disambiguationNeeded":false,"hints":[],"anaphora_of":null,"time_reason":null,"notes":"polite action request, use 'open' intent"}

User text: "${preprocessed?.rewritten || preprocessed?.cleaned || text}"

JSON:`;

  try {
    const startTime = performance.now();
    // Timeout set to 60 seconds to allow complex queries to complete
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('intent_parse_timeout')), 60000)
    );
    
    const promptPromise = postToOffscreen('OFFSCREEN_RUN_PROMPT_LM', { prompt, isRouter: true });
    const res = await Promise.race([promptPromise, timeoutPromise]);
    const duration = performance.now() - startTime;
    
    // If router failed or timed out, return fast fallback
    if (!res.ok && (res.error === 'no_json_in_response' || res.error === 'invalid_json')) {
      structuredLog('router', 'json_parse_failed_after_reprompt', { error: res.error });
      return { ok: false, error: res.error, fallback: true };
    }
    
    const jsonText = res?.text || '';
    
    // SPEED: Faster JSON extraction (try most common first)
    let parsed = null;
    
    // Try direct JSON.parse first (most common case)
    try {
      parsed = JSON.parse(jsonText.trim());
    } catch {
      // Try extracting from code fences
      let jsonMatch = jsonText.match(/```json\s*(\{[\s\S]*?\})\s*```/);
      if (!jsonMatch) {
        jsonMatch = jsonText.match(/```\s*(\{[\s\S]*?\})\s*```/);
      }
      if (!jsonMatch) {
        jsonMatch = jsonText.match(/\{[\s\S]*\}/);
      }
      
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        } catch (parseErr) {
          structuredLog('router', 'json_parse_failed', { 
            reason: 'invalid_json', 
            error: String(parseErr),
            extracted: (jsonMatch[1] || jsonMatch[0] || '').slice(0, 200)
          });
          return { ok: false, error: 'invalid_json', fallback: true };
        }
      } else {
        structuredLog('router', 'json_parse_failed', { reason: 'no_json_found', text: jsonText.slice(0, 200) });
        return { ok: false, error: 'no_json_in_response', fallback: true };
      }
    }
    
    // Phase 11: Validate required fields
    // Accept either "query" (old) or "canonical_query" (new) during migration
    const hasQuery = typeof parsed.query === 'string' || typeof parsed.canonical_query === 'string';
    if (!parsed.intent || !hasQuery) {
      structuredLog('router', 'json_validation_failed', { parsed, reason: 'missing_intent_or_query' });
      // Return failure fallback instead of error
      return {
        ok: true,
        intent: {
          intent: 'find_open',
          canonical_query: (preprocessed?.rewritten || preprocessed?.cleaned || text || '').toLowerCase().replace(/[^\w\s]/g, '').trim(),
          constraints: {
            scope: null,
            resultMustBeOpen: true,
            dateRange: null,
            includeApps: [],
            excludeApps: [],
            group: null,
            limit: null
          },
          operation: null,
          operation_args: null,
          folderName: null,
          disambiguationNeeded: true,
          hints: [],
          anaphora_of: null,
          time_reason: null,
          notes: 'parse_uncertain'
        }
      };
    }
    
    // Validate intent (strict enum)
    const validIntents = ['open', 'close', 'find_open', 'reopen', 'save', 'list', 'ask', 'mute', 'unmute', 'pin', 'unpin', 'reload', 'discard'];
    if (!validIntents.includes(parsed.intent)) {
      // Failure fallback: return find_open with disambiguationNeeded
      return {
        ok: true,
        intent: {
          intent: 'find_open',
          canonical_query: (preprocessed?.rewritten || preprocessed?.cleaned || text || '').toLowerCase().replace(/[^\w\s]/g, '').trim(),
          constraints: {
            scope: null,
            resultMustBeOpen: true,
            dateRange: null,
            includeApps: [],
            excludeApps: [],
            group: null,
            limit: null
          },
          operation: null,
          operation_args: null,
          folderName: null,
          disambiguationNeeded: true,
          hints: [],
          anaphora_of: null,
          time_reason: null,
          notes: 'parse_uncertain'
        }
      };
    }
    
    // Ensure constraints object exists with all required fields
    if (!parsed.constraints) {
      parsed.constraints = {};
    }
    
    // Normalize constraints: migrate old "app" to "includeApps", ensure arrays
    if (parsed.constraints.app !== undefined) {
      if (!parsed.constraints.includeApps) {
        parsed.constraints.includeApps = Array.isArray(parsed.constraints.app) 
          ? parsed.constraints.app 
          : (parsed.constraints.app ? [parsed.constraints.app] : []);
      }
      delete parsed.constraints.app; // Deprecate
    }
    
    // Ensure includeApps and excludeApps are arrays
    if (!Array.isArray(parsed.constraints.includeApps)) {
      parsed.constraints.includeApps = parsed.constraints.includeApps ? [parsed.constraints.includeApps] : [];
    }
    if (!Array.isArray(parsed.constraints.excludeApps)) {
      parsed.constraints.excludeApps = parsed.constraints.excludeApps ? [parsed.constraints.excludeApps] : [];
    }
    
    // Migrate old "exclude" to "excludeApps"
    if (parsed.constraints.exclude && !parsed.constraints.excludeApps?.length) {
      parsed.constraints.excludeApps = Array.isArray(parsed.constraints.exclude) 
        ? parsed.constraints.exclude 
        : [parsed.constraints.exclude];
      delete parsed.constraints.exclude;
    }
    
    // Validate scope (strict enum)
    const validScopes = ['tab', 'group', null];
    if (parsed.constraints.scope !== null && !validScopes.includes(parsed.constraints.scope)) {
      parsed.constraints.scope = null;
    }
    
    // Validate operation (strict enum, if provided)
    if (parsed.operation !== null && parsed.operation !== undefined) {
      const validOperations = ['move_to_window', 'rename', 'collapse', 'expand'];
      if (!validOperations.includes(parsed.operation)) {
        parsed.operation = null;
      }
    }
    
    // Normalize canonical_query: lowercase, strip emojis, strip extra punctuation
    // Handle migration from "query" to "canonical_query"
    if (parsed.query !== undefined && parsed.canonical_query === undefined) {
      // Migrate old "query" to "canonical_query"
      parsed.canonical_query = (parsed.query || '').toLowerCase()
        .replace(/[\u{1F300}-\u{1F9FF}]/gu, '') // Remove emojis
        .replace(/[^\w\s]/g, ' ') // Replace punctuation with spaces
        .replace(/\s+/g, ' ') // Collapse whitespace
        .trim();
      delete parsed.query; // Deprecate
    } else if (parsed.canonical_query) {
      // Normalize existing canonical_query
      parsed.canonical_query = parsed.canonical_query.toLowerCase()
        .replace(/[\u{1F300}-\u{1F9FF}]/gu, '')
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    } else if (parsed.query) {
      // If only query exists (shouldn't happen after validation, but safety check)
      parsed.canonical_query = parsed.query.toLowerCase()
        .replace(/[\u{1F300}-\u{1F9FF}]/gu, '')
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      delete parsed.query;
    }
    
    // Migrate disambiguationOkay to disambiguationNeeded (invert boolean)
    if (parsed.disambiguationOkay !== undefined) {
      parsed.disambiguationNeeded = !!parsed.disambiguationOkay;
      delete parsed.disambiguationOkay;
    }
    if (parsed.disambiguationNeeded === undefined) {
      parsed.disambiguationNeeded = false;
    }
    
    // Ensure hints is an array
    if (!Array.isArray(parsed.hints)) {
      parsed.hints = [];
    }
    
    // Phase 2: Default resultMustBeOpen based on intent
    if (parsed.constraints.resultMustBeOpen === undefined) {
      if (['open', 'close', 'find_open'].includes(parsed.intent)) {
        parsed.constraints.resultMustBeOpen = true; // Default to open tabs only
      } else {
        parsed.constraints.resultMustBeOpen = false;
      }
    }
    
    // Normalize dateRange format (convert timestamps to ISO dates if needed)
    if (parsed.constraints.dateRange) {
      if (typeof parsed.constraints.dateRange.since === 'number') {
        parsed.constraints.dateRange.since = new Date(parsed.constraints.dateRange.since).toISOString().split('T')[0];
      }
      if (typeof parsed.constraints.dateRange.until === 'number') {
        parsed.constraints.dateRange.until = new Date(parsed.constraints.dateRange.until).toISOString().split('T')[0];
      }
    }
    
    structuredLog('Phase 3', 'parse_success', {
      intent: parsed.intent,
      durationMs: duration.toFixed(1),
      hasGroup: !!parsed.constraints.group,
      hasFolder: !!parsed.folderName,
      requestId: sessionId || null
    });
    
    return { ok: true, intent: parsed, usedFallback: false };
  } catch (err) {
    log('Router prompt failed:', err);
    structuredLog('router', 'prompt_api_error', { error: String(err?.message || err) });
    return { ok: false, error: String(err?.message || err), fallback: true };
  }
}

// ==== CHAT-FOR-TABS: PARSE INTENT WITH PREPROCESSING ====
export async function parseIntent(text, sessionId = null) {
  const startTime = performance.now();
  const rawText = text;
  const sid = sessionId || getChatSessionId();

  try {
    // SPEED: Make preprocessing OPTIONAL - skip for simple English queries
    // Skip if: query is short (< 50 chars), no non-ASCII characters, common English words
    const needsPreprocessing = text.length > 50 || /[^\x00-\x7F]/.test(text) || 
                               /\b(translate|proofread|rewrite)\b/i.test(text);
    
    // Parallelize preprocessing check with Prompt API availability check
    const preprocessPromise = needsPreprocessing ? preprocessQuery(text, sid) : Promise.resolve({ ok: false });
    const apiCheckPromise = checkPromptApiAvailability();
    
    const [preprocessResult, available] = await Promise.all([preprocessPromise, apiCheckPromise]);
    
    if (!preprocessResult.ok && needsPreprocessing) {
      structuredLog('router', 'preprocess_failed', { error: preprocessResult.error });
    }
    
    const processedQuery = (preprocessResult.ok && needsPreprocessing) ? preprocessResult.query : text;
    const preprocessed = {
      raw: text,
      cleaned: processedQuery, // proofread/translated version
      rewritten: processedQuery // can add rewrite step here if needed
    };
    if (!available) {
      // Phase 20: Fallback to lexical-only with user-friendly message
      structuredLog('router', 'prompt_api_unavailable', { fallback: true });
      return { 
        ok: false, 
        error: 'Prompt API unavailable', 
        fallback: true,
        message: "I'll show likely matches while AI warms up."
      };
    }

    // Phase 1: Call unified router with preprocessed data
    const parsed = await parseIntentWithPrompt(text, sid, preprocessed);
    
    if (parsed.ok) {
      recordTelemetry('parsing', 'prompt_api', true);
      const duration = performance.now() - startTime;
      structuredLog('Phase 3', 'parse_intent_complete', {
        method: 'prompt_api',
        intent: parsed.intent.intent,
        durationMs: duration.toFixed(1),
        preprocessed: preprocessResult.ok
      });
      return parsed;
    }
    
    recordTelemetry('parsing', 'prompt_api', false);
    structuredLog('router', 'parse_error', { error: String(parsed.error || 'unknown') });
    return parsed;
  } catch (err) {
    recordTelemetry('parsing', 'prompt_api', false);
    structuredLog('router', 'parse_error', { error: String(err?.message || err) });
    return { 
      ok: false, 
      error: String(err?.message || err),
      fallback: true,
      message: "I'll show likely matches while AI warms up."
    };
  }
}

// ==== PREPROCESS QUERY (Language detection, translation, proofreading) ====
export async function preprocessQuery(userQuery, sessionId) {
  try {
    let processedQuery = String(userQuery || '').trim();
    const metadata = {
      original: processedQuery,
      detectedLanguage: 'en',
      wasTranslated: false,
      wasProofread: false,
      wasRewritten: false
    };
    
    if (!processedQuery) {
      return { ok: false, error: 'empty_query', query: processedQuery, metadata };
    }
    
    // Step 1: Detect language (only if query length >= 6 words, as per guardrails)
    if (processedQuery.split(/\s+/).length >= 6) {
      try {
        const detectResult = await postToOffscreen('DETECT_LANGUAGE', { text: processedQuery });
        if (detectResult?.ok && detectResult.detected) {
          metadata.detectedLanguage = detectResult.detected;
          
          // Step 2: Translate if not English
          if (detectResult.detected !== 'en' && detectResult.confidence > 0.5) {
            try {
              const translateResult = await postToOffscreen('TRANSLATE_QUERY', {
                text: processedQuery,
                sourceLanguage: detectResult.detected,
                targetLanguage: 'en'
              });
              if (translateResult?.ok && translateResult.translated) {
                processedQuery = translateResult.translated;
                metadata.wasTranslated = true;
                log(`Translated query from ${detectResult.detected} to English`);
              }
            } catch (translateErr) {
              log('Translation failed, continuing with original query:', translateErr);
            }
          }
        }
      } catch (detectErr) {
        log('Language detection failed, assuming English:', detectErr);
      }
    }
    
    // Step 3: Proofread query (fix grammar/spelling) - only if query length >= 6 words
    if (processedQuery.split(/\s+/).length >= 6) {
      try {
        const proofreadResult = await postToOffscreen('PROOFREAD_QUERY', {
          text: processedQuery,
          expectedInputLanguages: [metadata.detectedLanguage === 'en' ? 'en' : 'en']
        });
        if (proofreadResult?.ok && proofreadResult.corrected && proofreadResult.hasCorrections) {
          processedQuery = proofreadResult.corrected;
          metadata.wasProofread = true;
          log('Query proofread, corrections made');
        }
      } catch (proofreadErr) {
        log('Proofreading failed, continuing:', proofreadErr);
      }
    }
    
    // Step 4: Optionally rewrite for clarity (only if query seems unclear)
    // Skip rewriting for now - can be enabled if needed
    
    return { ok: true, query: processedQuery, metadata };
  } catch (err) {
    log('Query preprocessing error:', err);
    return { ok: false, error: String(err?.message || err), query: String(userQuery || ''), metadata: {} };
  }
}

