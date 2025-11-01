// Organize Tabs - By Intent
// AI-powered intent classification using Prompt API
// Supports fixed intent buckets + adaptive grouping for low-confidence tabs
// Uses URL canonicalization and deterministic intent caching to prevent duplicates

import { createGroupFor, moveGroupToIndex, snapshotCurrentLayout, pickColorForName, isHttpLike } from './utils.js';
import { getBaseDomain } from '../../shared/utils.js';
import { setLastLayoutSnapshot } from './state.js';
import { ensureOffscreen, postToOffscreen } from '../../features/chat-for-tabs/utils.js';
import { getTabMeta, minutesSince } from './metadata.js';
import { canonicalizeUrl, getUrlKey, getCachedIntentForUrl, cacheIntentForUrl, getDomainOverride } from './canonical.js';

const log = (...a) => console.log("[Tabitha::organize-intent]", ...a);

// Intent buckets definition
const INTENT_BUCKETS = {
  "Deep Work": {
    emoji: "🧠",
    color: "blue",
    domains: ["docs.google.com", "sheets.google.com", "notion.so", "github.com", "gitlab.com", "stackoverflow.com"],
    keywords: ["document", "code", "research", "writing", "development"]
  },
  "Comms": {
    emoji: "💬",
    color: "green",
    domains: ["mail.google.com", "gmail.com", "slack.com", "teams.microsoft.com", "zoom.us", "meet.google.com"],
    keywords: ["email", "chat", "message", "meeting", "zoom", "slack"]
  },
  "Reading & Reference": {
    emoji: "📚",
    color: "purple",
    domains: ["medium.com", "arxiv.org", "wikipedia.org", "stackoverflow.com", "reddit.com"],
    keywords: ["article", "paper", "wiki", "read", "reference", "documentation"]
  },
  "Tasks & Planning": {
    emoji: "📋",
    color: "yellow",
    domains: ["trello.com", "asana.com", "jira.atlassian.com", "calendar.google.com", "todoist.com"],
    keywords: ["task", "todo", "calendar", "plan", "project", "board"]
  },
  "Media": {
    emoji: "▶️",
    color: "red",
    domains: ["youtube.com", "spotify.com", "netflix.com", "twitch.tv", "vimeo.com"],
    keywords: ["video", "music", "stream", "watch", "listen", "podcast"]
  },
  "Shopping/Payments": {
    emoji: "🛒",
    color: "orange",
    domains: ["amazon.com", "paypal.com", "stripe.com", "shopify.com", "ebay.com"],
    keywords: ["buy", "cart", "checkout", "payment", "shopping", "purchase"]
  },
  "Social": {
    emoji: "👥",
    color: "pink",
    domains: ["twitter.com", "facebook.com", "instagram.com", "linkedin.com", "tiktok.com"],
    keywords: ["social", "feed", "profile", "timeline", "post", "share"]
  },
  "Dev Tools": {
    emoji: "⚙️",
    color: "cyan",
    domains: ["github.com", "gitlab.com", "docker.com", "kubernetes.io", "vercel.com", "localhost"],
    keywords: ["dashboard", "admin", "config", "deploy", "api", "dev"]
  },
  "Misc/Unsorted": {
    emoji: "📁",
    color: "grey",
    domains: [],
    keywords: []
  },
  "Unknown": {
    emoji: "❓",
    color: "grey",
    domains: [],
    keywords: []
  }
};

// Gist cache: tabId -> { gist, timestamp }
const gistCache = new Map();
const GIST_CACHE_TTL = 7 * 60 * 1000; // 7 minutes

// Confidence threshold
const CONFIDENCE_THRESHOLD = 0.7;
const ADAPTIVE_THRESHOLD = 0.7; // Below this triggers adaptive grouping
const LOW_CONFIDENCE_THRESHOLD = 0.55; // Below this → Misc (review)
const CACHE_UPDATE_THRESHOLD = 0.15; // Only update cache if score improves by this much

// Prepare tab records with title, URL, domain, optional gist, last active time
// Canonicalizes URLs and adds urlKey for caching
async function prepareTabRecords(tabs) {
  const records = [];
  
  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    if (tab.pinned) continue;
    if (!isHttpLike(tab.url)) continue;
    
    const domain = getBaseDomain(tab.url);
    if (!domain) continue;
    
    // Canonicalize URL and generate key for caching
    const canonicalUrl = canonicalizeUrl(tab.url);
    const urlKey = getUrlKey(tab.url);
    
    // Get last active time
    const tabMetaMap = getTabMeta();
    const meta = tabMetaMap.get(tab.id) || {};
    const lastActive = meta.lastFocusedAt || tab.lastAccessed || 0;
    const lastActiveMins = lastActive > 0 ? Math.round(minutesSince(lastActive)) : null;
    
    // Get gist (optional, from cache or fetch)
    let gist = null;
    try {
      gist = await fetchGistForTab(tab);
    } catch (err) {
      log('Gist fetch failed for tab', tab.id, err);
    }
    
    records.push({
      index: i + 1,
      tabId: tab.id,
      title: tab.title || 'Untitled',
      url: tab.url,
      canonicalUrl: canonicalUrl,
      urlKey: urlKey,
      domain: domain,
      gist: gist,
      lastActive: lastActiveMins,
      lastActiveTimestamp: lastActive,
      windowId: tab.windowId
    });
  }
  
  return records;
}

// Fetch gist for a tab using Summarizer API (cached)
async function fetchGistForTab(tab) {
  // Check cache
  const cached = gistCache.get(tab.id);
  if (cached && (Date.now() - cached.timestamp) < GIST_CACHE_TTL) {
    return cached.gist;
  }
  
  // Check if URL/title changed (invalidate cache)
  if (cached && (cached.url !== tab.url || cached.title !== tab.title)) {
    gistCache.delete(tab.id);
  }
  
  try {
    // Prepare text for summarization (title + URL context)
    const textToSummarize = `${tab.title || 'Untitled'} - ${tab.url}`;
    
    // Call Summarizer API via offscreen
    const res = await postToOffscreen('SUMMARIZE_TEXT', {
      text: textToSummarize
    });
    
    if (res && res.ok && res.text) {
      const gist = String(res.text).trim();
      // Cache the result
      gistCache.set(tab.id, {
        gist: gist,
        timestamp: Date.now(),
        url: tab.url,
        title: tab.title
      });
      return gist;
    }
  } catch (err) {
    log('Summarizer API call failed:', err);
  }
  
  return null; // No gist available
}

// Build classification prompt
function buildClassificationPrompt(tabRecords, existingGroups = []) {
  const intentList = Object.keys(INTENT_BUCKETS).filter(name => name !== "Unknown").join(", ");
  
  const tabLines = tabRecords.map(t => {
    const parts = [
      `#${t.index}`,
      `[${t.domain}]`,
      `"${t.title}"`,
      t.gist ? `gist: ${t.gist.slice(0, 100)}` : '',
      t.lastActive !== null ? `lastActive=${t.lastActive}m` : ''
    ].filter(Boolean);
    return parts.join(' | ');
  }).join('\n');
  
  const existingGroupsText = existingGroups.length > 0
    ? `\nExisting groups (do not duplicate): ${existingGroups.join(", ")}\n`
    : '';
  
  const prompt = `You are Tabitha, a browser tab classifier. Assign each tab to exactly one intent bucket.

INTENT BUCKETS:
${intentList}
Unknown (low confidence)

OUTPUT FORMAT (JSON only, no prose):
[
  {"index": 1, "intent": "Deep Work", "confidence": 0.92},
  {"index": 2, "intent": "Comms", "confidence": 0.88}
]

RULES:
- Return ONLY a JSON array, no markdown, no code fences
- Each tab must have exactly one intent
- Confidence range: 0.0 to 1.0
- Use "Unknown" if confidence < 0.6
- Consider domain hints: docs.google.com → likely Deep Work, youtube.com → Media
- Consider keywords in title/URL
${existingGroupsText}
TABS TO CLASSIFY:
${tabLines}

Return JSON now:`;

  return prompt;
}

// Build adaptive grouping prompt for low-confidence tabs
function buildAdaptivePrompt(lowConfidenceTabs, existingGroups) {
  const tabLines = lowConfidenceTabs.map(t => {
    const parts = [
      `#${t.index} (tabId: ${t.tabId})`,
      `[${t.domain}]`,
      `"${t.title}"`,
      t.gist ? `gist: ${t.gist.slice(0, 100)}` : ''
    ].filter(Boolean);
    return parts.join(' | ');
  }).join('\n');
  
  const existingGroupsText = existingGroups.length > 0
    ? `\nExisting groups (do not duplicate): ${existingGroups.join(", ")}\n`
    : '';
  
  const prompt = `These tabs don't fit existing intent buckets well. Propose 1-2 new meaningful groups that capture their purpose.

OUTPUT FORMAT (JSON only):
{
  "newGroups": ["RAG Research", "Visa Sprint"],
  "assignments": {
    "RAG Research": [tabId1, tabId4],
    "Visa Sprint": [tabId6]
  }
}

RULES:
- Use clear, short names (≤3 words)
- Only create groups with ≥2 tabs
- Avoid duplicates of existing groups
- Return ONLY JSON, no prose
${existingGroupsText}
TABS TO GROUP:
${tabLines}

Return JSON now:`;

  return prompt;
}

// Extract first JSON from text response
function extractFirstJSON(text) {
  const stripped = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(stripped);
  } catch {}
  
  const start = stripped.indexOf('[');
  if (start === -1) {
    const objStart = stripped.indexOf('{');
    if (objStart === -1) return null;
    let depth = 0;
    for (let i = objStart; i < stripped.length; i++) {
      const ch = stripped[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          const slice = stripped.slice(objStart, i + 1);
          try {
            return JSON.parse(slice);
          } catch {}
          break;
        }
      }
    }
    return null;
  }
  
  let depth = 0;
  for (let i = start; i < stripped.length; i++) {
    const ch = stripped[i];
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) {
        const slice = stripped.slice(start, i + 1);
        try {
          return JSON.parse(slice);
        } catch {}
        break;
      }
    }
  }
  return null;
}

// Classify tabs using Prompt API (batch mode)
async function classifyTabsWithPrompt(tabRecords, existingGroups = []) {
  try {
    // Batch tabs (10-20 at a time)
    const BATCH_SIZE = 15;
    const batches = [];
    for (let i = 0; i < tabRecords.length; i += BATCH_SIZE) {
      batches.push(tabRecords.slice(i, i + BATCH_SIZE));
    }
    
    const allClassifications = [];
    
    for (const batch of batches) {
      const prompt = buildClassificationPrompt(batch, existingGroups);
      
      try {
        const res = await postToOffscreen('OFFSCREEN_RUN_PROMPT_LM', { prompt });
        const text = res?.text || '';
        const json = extractFirstJSON(text);
        
        if (Array.isArray(json)) {
          // Map back to tabIds using index
          for (const item of json) {
            const record = batch.find(r => r.index === item.index);
            if (record) {
              allClassifications.push({
                tabId: record.tabId,
                intent: String(item.intent || 'Unknown'),
                confidence: Number(item.confidence) || 0.0
              });
            }
          }
        } else {
          log('Invalid JSON response from Prompt API:', json);
          // Fallback: classify by heuristics
          for (const record of batch) {
            const heuristic = classifyByHeuristics(record);
            allClassifications.push({
              tabId: record.tabId,
              intent: heuristic.intent,
              confidence: heuristic.confidence
            });
          }
        }
      } catch (err) {
        log('Prompt API failed for batch, using heuristics:', err);
        // Fallback to heuristics
        for (const record of batch) {
          const heuristic = classifyByHeuristics(record);
          allClassifications.push({
            tabId: record.tabId,
            intent: heuristic.intent,
            confidence: heuristic.confidence
          });
        }
      }
    }
    
    return allClassifications;
  } catch (err) {
    log('Classification failed, falling back to heuristics:', err);
    // Complete fallback
    return tabRecords.map(record => {
      const heuristic = classifyByHeuristics(record);
      return {
        tabId: record.tabId,
        intent: heuristic.intent,
        confidence: heuristic.confidence
      };
    });
  }
}

// Classify low-confidence tabs with adaptive grouping
async function classifyLowConfidenceTabs(lowConfidenceRecords, existingGroups) {
  if (lowConfidenceRecords.length === 0) return {};
  
  try {
    const prompt = buildAdaptivePrompt(lowConfidenceRecords, existingGroups);
    const res = await postToOffscreen('OFFSCREEN_RUN_PROMPT_LM', { prompt });
    const text = res?.text || '';
    const json = extractFirstJSON(text);
    
    if (json && json.newGroups && json.assignments) {
      // Apply guardrails
      const validGroups = {};
      const existingGroupNames = new Set(Object.keys(INTENT_BUCKETS).concat(existingGroups));
      
      for (const groupName of json.newGroups) {
        const tabIds = json.assignments[groupName] || [];
        
        // Guardrail: ≥2 tabs per group
        if (tabIds.length < 2) continue;
        
        // Guardrail: max 6 groups total (already have existing groups, so limit new ones)
        if (Object.keys(validGroups).length >= 6) break;
        
        // Guardrail: semantic dedup (simple name check)
        const similar = Array.from(existingGroupNames).some(existing =>
          groupName.toLowerCase().includes(existing.toLowerCase()) ||
          existing.toLowerCase().includes(groupName.toLowerCase())
        );
        if (similar) continue;
        
        validGroups[groupName] = tabIds;
      }
      
      return validGroups;
    }
    
    return {};
  } catch (err) {
    log('Adaptive grouping failed:', err);
    return {};
  }
}

// Heuristic fallback classification
function classifyByHeuristics(record) {
  const domain = record.domain.toLowerCase();
  const title = (record.title || '').toLowerCase();
  const url = record.url.toLowerCase();
  
  // Domain-based matching
  for (const [intentName, bucket] of Object.entries(INTENT_BUCKETS)) {
    if (intentName === "Unknown" || intentName === "Misc/Unsorted") continue;
    
    // Check domain matches
    if (bucket.domains.some(d => domain.includes(d.replace(/^www\./, '')))) {
      return { intent: intentName, confidence: 0.6 };
    }
    
    // Check keyword matches
    const allText = `${title} ${url}`;
    if (bucket.keywords.some(kw => allText.includes(kw))) {
      return { intent: intentName, confidence: 0.55 };
    }
  }
  
  // Default fallback
  return { intent: "Unknown", confidence: 0.3 };
}

// Main organize function
export async function organizeByIntent(tabs = null) {
  try {
    // Get tabs if not provided
    let targetTabs = tabs;
    let win;
    
    if (!targetTabs) {
      win = await chrome.windows.getLastFocused({ populate: true });
      if (!win?.tabs?.length) return { ok: false, reason: "No tabs" };
      targetTabs = win.tabs;
    } else {
      win = await chrome.windows.get(tabs[0]?.windowId || (await chrome.windows.getCurrent()).id);
    }
    
    const windowId = win.id;
    
    // Save snapshot for undo
    const snapshot = await snapshotCurrentLayout(windowId);
    setLastLayoutSnapshot(snapshot);
    
    // Filter out pinned tabs
    const unpinnedTabs = targetTabs.filter(t => !t.pinned && isHttpLike(t.url));
    if (unpinnedTabs.length === 0) return { ok: false, reason: "No unpinned tabs" };
    
    // Prepare tab records
    log('Preparing tab records...');
    const tabRecords = await prepareTabRecords(unpinnedTabs);
    if (tabRecords.length === 0) return { ok: false, reason: "No valid tab records" };
    
    // Get existing group names for context
    const existingGroups = [];
    try {
      const groups = await chrome.tabGroups.query({ windowId });
      existingGroups.push(...groups.map(g => g.title || '').filter(Boolean));
    } catch (err) {
      log('Failed to get existing groups:', err);
    }
    
    // Classify tabs
    log('Classifying tabs with canonical URLs and deterministic cache...');
    let classifications = [];
    
    // Group tabs by canonical URL within this window to ensure consistency
    const urlKeyGroups = new Map(); // urlKey -> [records]
    for (const record of tabRecords) {
      if (!urlKeyGroups.has(record.urlKey)) {
        urlKeyGroups.set(record.urlKey, []);
      }
      urlKeyGroups.get(record.urlKey).push(record);
    }
    
    // Process each canonical URL group
    const toClassify = []; // Records that need AI classification
    const cachedClassifications = new Map(); // urlKey -> { intent, score, source }
    
    for (const [urlKey, records] of urlKeyGroups.entries()) {
      // Check cache/override for this URL key
      const firstRecord = records[0];
      const cached = await getCachedIntentForUrl(urlKey, firstRecord.domain);
      
      if (cached) {
        // Use cached/override intent for all tabs with this URL key
        cachedClassifications.set(urlKey, cached);
        for (const record of records) {
          classifications.push({
            tabId: record.tabId,
            intent: cached.intent,
            confidence: cached.score,
            source: cached.source, // 'override' | 'cache'
            urlKey: urlKey
          });
        }
        log(`${urlKey} → ${cached.intent} (${cached.score.toFixed(2)}) [${cached.source}] tabs=${records.length}`);
      } else {
        // Need AI classification - use first record as representative
        // All tabs with same urlKey will get same intent
        toClassify.push(firstRecord);
        // Track which records belong to this urlKey
        firstRecord._allRecords = records;
      }
    }
    
    // Classify uncached tabs with AI (only one per urlKey)
    if (toClassify.length > 0) {
      log(`Classifying ${toClassify.length} unique URLs with Prompt API...`);
      const aiClassifications = await classifyTabsWithPrompt(toClassify, existingGroups);
      
      // Apply AI results to all records with same urlKey
      for (const aiResult of aiClassifications) {
        const record = toClassify.find(r => r.tabId === aiResult.tabId);
        if (!record) continue;
        
        const urlKey = record.urlKey;
        let intent = String(aiResult.intent || 'Unknown');
        let score = Number(aiResult.confidence) || 0.0;
        let source = 'AI';
        
        // Apply low confidence guardrail
        if (score < LOW_CONFIDENCE_THRESHOLD) {
          intent = 'Misc/Unsorted';
          score = 0.5; // Neutral score for low confidence
          log(`${urlKey} → Low confidence (${aiResult.confidence.toFixed(2)}), placing in Misc/Unsorted`);
        }
        
        // Cache the result (if not already better cached)
        const wasUpdated = await cacheIntentForUrl(urlKey, intent, score);
        if (wasUpdated) {
          log(`${urlKey} → ${intent} (${score.toFixed(2)}) [AI→cache] tabs=${record._allRecords.length}`);
        } else {
          log(`${urlKey} → ${intent} (${score.toFixed(2)}) [AI] tabs=${record._allRecords.length} (cache kept prior)`);
        }
        
        // Apply to all tabs with this urlKey
        for (const r of record._allRecords || [record]) {
          classifications.push({
            tabId: r.tabId,
            intent: intent,
            confidence: score,
            source: source,
            urlKey: urlKey
          });
        }
      }
    }
    
    // Separate high-confidence and low-confidence
    const highConfidence = classifications.filter(c => c.confidence >= ADAPTIVE_THRESHOLD);
    const lowConfidenceRecords = tabRecords.filter(r =>
      classifications.find(c => c.tabId === r.tabId)?.confidence < ADAPTIVE_THRESHOLD
    );
    
    // Adaptive grouping for low-confidence tabs
    let adaptiveGroups = {};
    if (lowConfidenceRecords.length > 0) {
      log('Running adaptive grouping for low-confidence tabs...');
      const currentGroupNames = Array.from(new Set(highConfidence.map(c => c.intent)));
      adaptiveGroups = await classifyLowConfidenceTabs(lowConfidenceRecords, currentGroupNames);
    }
    
    // Build group assignments
    const groupAssignments = {}; // intent/groupName -> [tabIds]
    
    // High-confidence tabs → fixed intent buckets
    for (const cls of highConfidence) {
      if (cls.intent === "Unknown") continue; // Skip unknown
      if (!groupAssignments[cls.intent]) {
        groupAssignments[cls.intent] = [];
      }
      groupAssignments[cls.intent].push(cls.tabId);
    }
    
    // Adaptive groups
    for (const [groupName, tabIds] of Object.entries(adaptiveGroups)) {
      groupAssignments[groupName] = tabIds;
    }
    
    // Idempotent apply: compute diff (what actually needs moving)
    // Get current group assignments
    const currentTabs = await chrome.tabs.query({ windowId });
    const currentGroupMap = new Map(); // tabId -> currentGroupId
    
    for (const tab of currentTabs) {
      if (tab.groupId >= 0) {
        // Get group name
        try {
          const group = await chrome.tabGroups.get(tab.groupId);
          const groupName = (group.title || '').replace(/^[\w\s]*\s/, ''); // Remove emoji prefix
          currentGroupMap.set(tab.id, groupName);
        } catch (err) {
          // Group doesn't exist
        }
      } else {
        currentGroupMap.set(tab.id, null); // Ungrouped
      }
    }
    
    // Compute which tabs need to move
    const tabsToMove = new Map(); // groupName -> [tabIds]
    const tabsToUngroup = [];
    
    for (const [intentName, tabIds] of Object.entries(groupAssignments)) {
      for (const tabId of tabIds) {
        const currentGroup = currentGroupMap.get(tabId);
        // Only move if tab is not already in the correct group
        if (currentGroup !== intentName) {
          if (!tabsToMove.has(intentName)) {
            tabsToMove.set(intentName, []);
          }
          tabsToMove.get(intentName).push(tabId);
          
          // If tab is in a different group, ungroup it first
          if (currentGroup !== null && currentGroup !== intentName) {
            tabsToUngroup.push(tabId);
          }
        }
      }
    }
    
    // Ungroup tabs that need to move (batch)
    if (tabsToUngroup.length > 0) {
      await Promise.all(tabsToUngroup.map(id => chrome.tabs.ungroup(id).catch(() => {})));
    }
    
    // Create Chrome groups (only for tabs that need moving)
    const created = [];
    const lowConfidenceCount = classifications.filter(c => c.confidence < LOW_CONFIDENCE_THRESHOLD).length;
    
    // Also ensure we process all intended group assignments (even if no tabs need moving)
    // This handles cases where groups already exist but need to be created
    const allIntents = new Set([...tabsToMove.keys(), ...Object.keys(groupAssignments)]);
    
    for (const intentName of allIntents) {
      const tabIds = tabsToMove.has(intentName) 
        ? tabsToMove.get(intentName) 
        : groupAssignments[intentName] || [];
      
      // Skip if no tabs (shouldn't happen, but safety check)
      if (!tabIds || tabIds.length === 0) continue;
      
      // Guardrail: Skip singleton groups unless total groups ≤ 2
      if (tabIds.length === 1 && tabsToMove.size > 2) {
        // Add to Misc/Unsorted instead
        if (!tabsToMove.has('Misc/Unsorted')) {
          tabsToMove.set('Misc/Unsorted', []);
        }
        tabsToMove.get('Misc/Unsorted').push(...tabIds);
        continue;
      }
      
      // Get bucket config or use defaults
      const bucket = INTENT_BUCKETS[intentName] || {
        emoji: "📁",
        color: pickColorForName(intentName)
      };
      
      const groupTitle = bucket.emoji ? `${bucket.emoji} ${intentName}` : intentName;
      const color = bucket.color || 'blue';
      
      try {
        // Check if group already exists (reuse it)
        const existingGroups = await chrome.tabGroups.query({ windowId });
        let existingGroup = existingGroups.find(g => {
          const title = (g.title || '').replace(/^[\w\s]*\s/, ''); // Remove emoji
          return title === intentName;
        });
        
        let groupId;
        if (existingGroup) {
          // Reuse existing group
          groupId = existingGroup.id;
          // Add tabs to existing group
          const existingTabs = await chrome.tabs.query({ groupId });
          const existingTabIds = existingTabs.map(t => t.id);
          const newTabIds = tabIds.filter(id => !existingTabIds.includes(id));
          if (newTabIds.length > 0) {
            await chrome.tabs.group({ groupId, tabIds: newTabIds });
          }
        } else {
          // Create new group
          groupId = await createGroupFor(windowId, groupTitle, color, tabIds);
        }
        
        if (groupId) {
          created.push({ groupId, name: intentName, count: tabIds.length });
        }
      } catch (err) {
        log('Failed to create/update group:', intentName, err);
      }
    }
    
    // Show toast if low confidence tabs detected
    if (lowConfidenceCount > 0) {
      log(`⚠️ ${lowConfidenceCount} tab(s) with low confidence placed in Misc/Unsorted (review recommended)`);
    }
    
    // Position groups (optional - keep tabs in current order)
    const fresh = await chrome.tabs.query({ windowId });
    const involved = fresh.filter(t => allTabIds.includes(t.id));
    let anchor = involved.length > 0 ? Math.min(...involved.map(t => t.index)) : 0;
    
    for (const group of created) {
      if (group.groupId) {
        try {
          await moveGroupToIndex(group.groupId, anchor);
          const groupTabs = await chrome.tabs.query({ groupId: group.groupId });
          anchor += groupTabs.length;
        } catch (err) {
          log('Failed to position group:', err);
        }
      }
    }
    
    log('Intent grouping complete:', created.length, 'groups created');
    
    return {
      ok: true,
      groups: created.length,
      details: created
    };
  } catch (err) {
    log('organizeByIntent error:', err);
    return { ok: false, error: String(err?.message || err) };
  }
}

// Helper function for organizeTabs() compatibility
export async function groupByIntent(tabs) {
  // This function returns cluster structure for use in organizeTabs()
  // But we want to use the full organizeByIntent flow, so we'll just call it
  const result = await organizeByIntent(tabs);
  
  if (!result.ok) {
    return { "Unknown": { tabIds: tabs.map(t => t.id), color: 'grey', title: 'Unknown' } };
  }
  
  // Return a simplified structure (organizeByIntent already creates groups)
  // This is mainly for compatibility
  return {};
}
