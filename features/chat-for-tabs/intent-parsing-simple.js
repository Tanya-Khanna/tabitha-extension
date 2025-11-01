// ==== SIMPLER INTENT PARSING: Understand first, structure second ====
// This is a more natural approach - understand what the user wants, then execute
// Less rigid JSON requirements, more reliable

import { postToOffscreen } from './utils.js';
import { formatConversationForPrompt } from './conversation.js';
import { getChatSessionId } from './conversation.js';

const log = (...a) => console.log("[Tabitha::simple-router]", ...a);

/**
 * Natural intent understanding - ask Tabitha what the user wants
 * Returns simple, structured intent without rigid JSON requirements
 */
export async function understandIntent(text, sessionId = null) {
  const sid = sessionId || getChatSessionId();
  const conversationContext = formatConversationForPrompt(sid);
  
  const prompt = `You are Tabitha, a helpful browser assistant. Understand what the user wants to do.

User says: "${text}"

${conversationContext ? `Previous conversation:\n${conversationContext}\n` : ''}

What do they want?
- If they want to OPEN/GO TO/SWITCH TO a tab → intent: "open"
- If they want to CLOSE/REMOVE tabs → intent: "close"  
- If they want to FIND/SEE where something is → intent: "find_open"
- If they want to SAVE/BOOKMARK tabs → intent: "save"
- If they're asking a QUESTION (what/how/when/where) → intent: "ask"
- If they want to LIST/SHOW tabs → intent: "list"
- Other actions: "mute", "unmute", "pin", "unpin", "reload", "discard", "reopen"

Extract:
1. Intent (one word: open, close, find_open, ask, list, save, etc.)
2. What they're looking for (keywords from their query)
3. Any apps/domains mentioned (gmail, docs, youtube, etc.)
4. Any time references (yesterday, last week, etc.)

Respond in a simple format:
intent: open
query: cover letter document
apps: docs.google.com
time: null

Or if unclear:
intent: find_open
query: [their words]
apps: []
time: null`;

  try {
    const res = await postToOffscreen('OFFSCREEN_RUN_PROMPT_LM', { 
      prompt,
      options: { temperature: 0.2, outputLanguage: 'en' }
    });
    
    if (!res?.ok || !res.text) {
      return parseSimpleFallback(text);
    }
    
    const response = res.text.toLowerCase().trim();
    
    // Parse natural language response (not strict JSON)
    const intent = extractIntent(response, text);
    const query = extractQuery(response, text);
    const apps = extractApps(response, text);
    const hasTimeRef = /\b(yesterday|last week|today|earlier|recently)\b/i.test(response + ' ' + text);
    
    return {
      ok: true,
      intent: {
        intent: intent,
        canonical_query: query,
        constraints: {
          scope: null,
          resultMustBeOpen: !hasTimeRef,
          dateRange: hasTimeRef ? { since: null, until: null } : null,
          includeApps: apps,
          excludeApps: [],
          group: null,
          limit: null
        },
        operation: null,
        operation_args: null,
        folderName: null,
        disambiguationNeeded: false, // Will be determined later when we see candidates
        hints: [],
        anaphora_of: null,
        time_reason: hasTimeRef ? 'time mentioned' : null,
        notes: 'natural language understanding'
      }
    };
    
  } catch (err) {
    log('Understanding failed, using fallback:', err);
    return parseSimpleFallback(text);
  }
}

function extractIntent(response, originalText) {
  const lower = (response + ' ' + originalText).toLowerCase();
  
  // Check for action words first
  if (/intent:\s*(open|go|jump|switch|take me|show me|navigate|activate|launch)/.test(lower) || 
      /^(open|go to|jump to|switch to|take me to|show me|navigate to|activate|launch)/.test(originalText.toLowerCase())) {
    return 'open';
  }
  if (/intent:\s*close/.test(lower) || /^(close|remove|delete|get rid of|dismiss)/.test(originalText.toLowerCase())) {
    return 'close';
  }
  if (/intent:\s*(find|locate|where)/.test(lower) || /^(find|locate|where|where is|where's)/.test(originalText.toLowerCase())) {
    return 'find_open';
  }
  if (/intent:\s*(save|bookmark)/.test(lower) || /^(save|bookmark)/.test(originalText.toLowerCase())) {
    return 'save';
  }
  if (/intent:\s*(ask|question|what|how|when|where|which)/.test(lower) || 
      /^(what|how|when|where|which|tell me)/.test(originalText.toLowerCase())) {
    return 'ask';
  }
  if (/intent:\s*(list|show|display)/.test(lower) || /^(list|show|display|tell me about)/.test(originalText.toLowerCase())) {
    return 'list';
  }
  
  // Default to find_open (safe fallback)
  return 'find_open';
}

function extractQuery(response, originalText) {
  // Look for "query:" in response
  const queryMatch = response.match(/query:\s*([^\n]+)/i);
  if (queryMatch) {
    return queryMatch[1].trim().toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  
  // Extract key words from original (remove action words)
  const cleaned = originalText.toLowerCase()
    .replace(/^(can you|could you|please|i want to|i need to)\s+/i, '')
    .replace(/\b(open|close|find|show|list|save|bookmark|go to|jump to|switch to)\b/gi, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
    
  return cleaned || originalText.toLowerCase();
}

function extractApps(response, originalText) {
  const combined = (response + ' ' + originalText).toLowerCase();
  const apps = [];
  
  // Simple domain mapping
  if (/\b(gmail|mail)\b/.test(combined)) apps.push('gmail.com', 'mail.google.com');
  if (/\b(docs?|document)\b/.test(combined)) apps.push('docs.google.com');
  if (/\b(calendar)\b/.test(combined)) apps.push('calendar.google.com');
  if (/\b(youtube)\b/.test(combined)) apps.push('youtube.com', 'music.youtube.com');
  if (/\b(zoom)\b/.test(combined)) apps.push('zoom.us');
  if (/\b(meet)\b/.test(combined)) apps.push('meet.google.com');
  if (/\b(drive)\b/.test(combined)) apps.push('drive.google.com');
  if (/\b(notion)\b/.test(combined)) apps.push('notion.so');
  if (/\b(substack)\b/.test(combined)) apps.push('substack.com');
  if (/\b(github|git)\b/.test(combined)) apps.push('github.com');
  if (/\b(wikipedia|wiki)\b/.test(combined)) apps.push('wikipedia.org');
  
  // Also check for explicit domains in response
  const domainMatch = response.match(/apps?:\s*([^\n]+)/i);
  if (domainMatch) {
    const domains = domainMatch[1].split(',').map(d => d.trim());
    apps.push(...domains.filter(d => d && !apps.includes(d)));
  }
  
  return [...new Set(apps)]; // Remove duplicates
}

function parseSimpleFallback(text) {
  const lower = text.toLowerCase();
  
  let intent = 'find_open';
  if (/^(open|go to|jump to|switch to|take me|show me)/.test(lower)) intent = 'open';
  else if (/^(close|remove|delete)/.test(lower)) intent = 'close';
  else if (/^(find|locate|where)/.test(lower)) intent = 'find_open';
  else if (/^(save|bookmark)/.test(lower)) intent = 'save';
  else if (/^(what|how|when|where|which)/.test(lower)) intent = 'ask';
  else if (/^(list|show|display)/.test(lower)) intent = 'list';
  
  const query = text.toLowerCase()
    .replace(/^(can you|could you|please|i want to|i need to)\s+/i, '')
    .replace(/\b(open|close|find|show|list|save|bookmark|go to|jump to|switch to)\b/gi, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || text.toLowerCase();
  
  return {
    ok: true,
    intent: {
      intent: intent,
      canonical_query: query,
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
      disambiguationNeeded: false,
      hints: [],
      anaphora_of: null,
      time_reason: null,
      notes: 'fallback parsing'
    }
  };
}

