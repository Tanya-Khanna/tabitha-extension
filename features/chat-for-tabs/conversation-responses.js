// Chat with your Tabs - Conversational Response Generation
// Uses Prompt API to generate all messages (replacing hardcoded text)
// Includes fallback templates for reliability

import { postToOffscreen } from './utils.js';
import { checkPromptApiAvailability } from './intent-parsing.js';
import { formatConversationForPrompt } from './conversation.js';

const log = (...a) => console.log("[Tabitha::conversation]", ...a);

// In-memory cache for responses (performance optimization)
const responseCache = new Map(); // cacheKey -> {response, timestamp}
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Generate cache key for responses
function getCacheKey(intent, candidateCount, domain) {
  const intentName = typeof intent === 'string' ? intent : intent?.intent || 'unknown';
  const count = candidateCount || 0;
  const dom = domain || 'any';
  return `${intentName}_${count}_${dom}`;
}

// Check if cached response is still valid
function getCachedResponse(cacheKey) {
  const cached = responseCache.get(cacheKey);
  if (!cached) return null;
  
  const age = Date.now() - cached.timestamp;
  if (age > CACHE_TTL) {
    responseCache.delete(cacheKey);
    return null;
  }
  
  return cached.response;
}

// Store response in cache
function cacheResponse(cacheKey, response) {
  responseCache.set(cacheKey, { response, timestamp: Date.now() });
}

// Invalidate cache (call on tab changes)
export function invalidateResponseCache() {
  responseCache.clear();
}

/**
 * Main conversational response generator
 * Generates friendly, natural messages using Prompt API
 */
export async function generateConversationalResponse(intent, candidates, query, context) {
  try {
    const candidateCount = candidates?.length || 0;
    const domain = candidates?.[0]?.card?.domain || '';
    const cacheKey = getCacheKey(intent, candidateCount, domain);
    
    // Check cache first
    const cached = getCachedResponse(cacheKey);
    if (cached) {
      return { ok: true, text: cached };
    }
    
    // Check Prompt API availability
    const apiAvailable = await checkPromptApiAvailability();
    if (!apiAvailable) {
      return { ok: true, text: generateFallbackResponse(intent, candidates, query) };
    }
    
    // Build prompt for conversational response
    const intentName = typeof intent === 'string' ? intent : intent?.intent || 'unknown';
    const intentQuery = typeof intent === 'object' ? intent.query : query;
    
    let prompt = `You are Tabitha, a friendly tab assistant. Generate a short, natural response (≤20 words).

User intent: ${intentName}
Query: "${intentQuery}"
Candidates found: ${candidateCount}
Domain: ${domain || 'various'}

Context:
${context || 'No previous conversation'}

Examples:
- Found 1 match: "Found it! Opening ${candidates?.[0]?.card?.title || 'that tab'}..."
- Found multiple: "I found ${candidateCount} matching tabs — which one would you like?"
- No matches: "I couldn't find any tabs matching "${intentQuery}". Should I search your history?"
- Error: "Sorry, something went wrong. Could you try again?"

Generate a friendly response:`;

    try {
      const result = await postToOffscreen('OFFSCREEN_RUN_PROMPT_LM', {
        prompt,
        options: { temperature: 0.3, topK: 1, outputLanguage: 'en' }
      });
      
      if (result?.ok && result.text) {
        const responseText = String(result.text).trim().slice(0, 150); // Cap length
        cacheResponse(cacheKey, responseText);
        return { ok: true, text: responseText };
      }
    } catch (err) {
      log('Prompt API call failed, using fallback:', err);
    }
    
    // Fallback to template
    const fallback = generateFallbackResponse(intent, candidates, query);
    return { ok: true, text: fallback };
    
  } catch (err) {
    log('generateConversationalResponse error:', err);
    return { ok: true, text: generateFallbackResponse(intent, candidates, query) };
  }
}

/**
 * Understand follow-up messages in context of previous disambiguation
 */
export async function understandFollowUp(previousQuery, previousResponse, candidates, newMessage, sessionId) {
  try {
    const apiAvailable = await checkPromptApiAvailability();
    if (!apiAvailable) {
      return parseFollowUpFallback(newMessage, candidates);
    }
    
    const context = formatConversationForPrompt(sessionId);
    
    // ACCURACY: Include cardIds in candidate list for better matching
    const candidateList = candidates?.slice(0, 5).map((c, i) => 
      `${i + 1}. cardId: ${c.card?.cardId || c.cardId || 'unknown'}, title: "${c.card?.title || c.title || 'Untitled'}", domain: ${c.card?.domain || c.domain || 'unknown'}`
    ).join('\n') || '';
    
    const prompt = `You are Tabitha. Parse the user's follow-up message and return ONLY a JSON object.

Previous query: "${previousQuery}"
Previous response: "${previousResponse}"
Available options (with cardIds):
${candidateList}

User's new message: "${newMessage}"

Return JSON:
{
  "action": "select" | "confirm" | "specify" | "cancel",
  "cardId": "<cardId from options above>",
  "tabNumber": 1-${candidates?.length || 5},
  "folderName": "string (if save intent)",
  "confirmation": true|false (if yes/no)
}

IMPORTANT: Use the cardId from the options above. If user says "the first one", use cardId from option 1. If "number 2", use cardId from option 2.

Examples:
- "the first one" → {"action": "select", "tabNumber": 1}
- "number 2" → {"action": "select", "tabNumber": 2}
- "yes" → {"action": "confirm", "confirmation": true}
- "the cover letter one" → {"action": "specify", "tabNumber": 2}
- "cancel" → {"action": "cancel"}

JSON only:`;

    try {
      const result = await postToOffscreen('OFFSCREEN_RUN_PROMPT_LM', {
        prompt,
        options: { temperature: 0, topK: 1, outputLanguage: 'en' }
      });
      
      if (result?.ok && result.text) {
        // Extract JSON from response
        const jsonMatch = String(result.text).match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return { ok: true, ...parsed };
        }
      }
    } catch (err) {
      log('Follow-up parsing failed, using fallback:', err);
    }
    
    // Fallback to regex parsing
    return parseFollowUpFallback(newMessage, candidates);
    
  } catch (err) {
    log('understandFollowUp error:', err);
    return parseFollowUpFallback(newMessage, candidates);
  }
}

/**
 * Generate success response after action execution
 */
export async function generateSuccessResponse(intent, result, candidate) {
  try {
    const apiAvailable = await checkPromptApiAvailability();
    if (!apiAvailable) {
      return { ok: true, text: generateSuccessFallback(intent, result, candidate) };
    }
    
    const intentName = typeof intent === 'string' ? intent : intent?.intent || 'unknown';
    const actionName = result?.action || intentName;
    const tabTitle = candidate?.card?.title || 'tab';
    const tabCount = result?.count || 1;
    
    const prompt = `You are Tabitha. Generate a short, friendly success message (≤15 words).

Action: ${actionName}
Result: ${result?.ok ? 'success' : 'completed'}
Tab title: ${tabTitle}
Count: ${tabCount}

Examples:
- Opened tab: "Opened ${tabTitle}!"
- Closed tabs: "Closed ${tabCount} tab${tabCount > 1 ? 's' : ''}."
- Found tab: "Jumped to ${tabTitle}!"
- Saved: "Saved to bookmarks!"
- Reopened: "Restored ${tabCount} tab${tabCount > 1 ? 's' : ''}!"

Generate response:`;

    try {
      const result = await postToOffscreen('OFFSCREEN_RUN_PROMPT_LM', {
        prompt,
        options: { temperature: 0.3, topK: 1, outputLanguage: 'en' }
      });
      
      if (result?.ok && result.text) {
        return { ok: true, text: String(result.text).trim().slice(0, 100) };
      }
    } catch (err) {
      log('Success response generation failed, using fallback:', err);
    }
    
    return { ok: true, text: generateSuccessFallback(intent, result, candidate) };
    
  } catch (err) {
    log('generateSuccessResponse error:', err);
    return { ok: true, text: generateSuccessFallback(intent, result, candidate) };
  }
}

/**
 * Generate error response
 */
export async function generateErrorResponse(intent, query, reason) {
  try {
    const apiAvailable = await checkPromptApiAvailability();
    if (!apiAvailable) {
      return { ok: true, text: generateErrorFallback(reason, query) };
    }
    
    const intentName = typeof intent === 'string' ? intent : intent?.intent || 'unknown';
    
    const prompt = `You are Tabitha. Generate a helpful error message with suggestions (≤20 words).

Intent: ${intentName}
Query: "${query}"
Reason: ${reason}

Examples:
- No tabs: "You don't have any tabs open right now."
- Parse failed: "Sorry, I didn't understand that. Could you rephrase?"
- No matches: "I couldn't find any tabs matching "${query}". Should I search your history?"
- Not found: "Couldn't find a tab like that. Want me to open it?"
- Unknown error: "Sorry, something went wrong. Could you try again?"

Generate helpful response:`;

    try {
      const result = await postToOffscreen('OFFSCREEN_RUN_PROMPT_LM', {
        prompt,
        options: { temperature: 0.3, topK: 1, outputLanguage: 'en' }
      });
      
      if (result?.ok && result.text) {
        return { ok: true, text: String(result.text).trim().slice(0, 150) };
      }
    } catch (err) {
      log('Error response generation failed, using fallback:', err);
    }
    
    return { ok: true, text: generateErrorFallback(reason, query) };
    
  } catch (err) {
    log('generateErrorResponse error:', err);
    return { ok: true, text: generateErrorFallback(reason, query) };
  }
}

/**
 * Generate disambiguation list (formatted for chat or voice)
 */
export async function generateDisambiguationList(intent, candidates, format = 'chat') {
  try {
    const apiAvailable = await checkPromptApiAvailability();
    if (!apiAvailable) {
      return { ok: true, text: generateDisambiguationFallback(intent, candidates, format) };
    }
    
    const intentName = typeof intent === 'string' ? intent : intent?.intent || 'unknown';
    const candidateCount = candidates?.length || 0;
    const domain = candidates?.[0]?.card?.domain || '';
    
    const candidateList = candidates?.slice(0, 5).map((c, i) => 
      `${i + 1}. ${c.card?.title || 'Untitled'} (${c.card?.domain || 'unknown'})`
    ).join('\n') || '';
    
    const formatHint = format === 'voice' 
      ? 'Format for speech: Use numbered list for 4+ items, descriptive for 2-3 items.'
      : 'Format for chat: Short, clear question asking which one.';
    
    const prompt = `You are Tabitha. Generate a disambiguation message (≤25 words).

Intent: ${intentName}
Candidates: ${candidateCount}
Domain: ${domain || 'various'}
${formatHint}

Candidates:
${candidateList}

Examples:
- Chat, 1 match: "I found 1 match — ${candidates?.[0]?.card?.title || 'Untitled'}?"
- Chat, multiple: "You have ${candidateCount} ${domain || 'matching tabs'} open — which one?"
- Voice, 2-3: "One is ${candidates?.[0]?.card?.title || 'first'}, another is ${candidates?.[1]?.card?.title || 'second'}."
- Voice, 4+: "Number 1: ${candidates?.[0]?.card?.title || 'first'}. Number 2: ${candidates?.[1]?.card?.title || 'second'}."

Generate ${format} response:`;

    try {
      const result = await postToOffscreen('OFFSCREEN_RUN_PROMPT_LM', {
        prompt,
        options: { temperature: 0.3, topK: 1, outputLanguage: 'en' }
      });
      
      if (result?.ok && result.text) {
        return { ok: true, text: String(result.text).trim().slice(0, 200) };
      }
    } catch (err) {
      log('Disambiguation list generation failed, using fallback:', err);
    }
    
    return { ok: true, text: generateDisambiguationFallback(intent, candidates, format) };
    
  } catch (err) {
    log('generateDisambiguationList error:', err);
    return { ok: true, text: generateDisambiguationFallback(intent, candidates, format) };
  }
}

// ==== FALLBACK TEMPLATES ====

function generateFallbackResponse(intent, candidates, query) {
  const intentName = typeof intent === 'string' ? intent : intent?.intent || 'unknown';
  const candidateCount = candidates?.length || 0;
  
  if (candidateCount === 0) {
    return `I couldn't find any tabs matching "${query}". Should I search your history?`;
  } else if (candidateCount === 1) {
    return `Found it! Opening ${candidates[0]?.card?.title || 'that tab'}...`;
  } else {
    return `I found ${candidateCount} matching tabs — which one would you like?`;
  }
}

function parseFollowUpFallback(newMessage, candidates) {
  const lower = String(newMessage || '').toLowerCase().trim();
  
  // Number extraction
  const numberMatch = lower.match(/\b(\d+)(?:st|nd|rd|th|one|two|three|four|five|first|second|third|fourth|fifth)?\b/);
  if (numberMatch) {
    let num = parseInt(numberMatch[1] || lower.match(/\b(one|two|three|four|five)\b/)?.index || '1');
    const wordNums = { 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5 };
    if (wordNums[lower]) num = wordNums[lower];
    
    if (num >= 1 && num <= (candidates?.length || 5)) {
      return { ok: true, action: 'select', tabNumber: num };
    }
  }
  
  // Yes/No
  if (lower.match(/\b(yes|yeah|yep|ok|okay|sure)\b/)) {
    return { ok: true, action: 'confirm', confirmation: true };
  }
  if (lower.match(/\b(no|nope|cancel|nevermind)\b/)) {
    return { ok: true, action: 'cancel', confirmation: false };
  }
  
  // Domain/title matching (basic)
  if (candidates) {
    for (let i = 0; i < candidates.length; i++) {
      const card = candidates[i]?.card;
      if (card) {
        const title = (card.title || '').toLowerCase();
        const domain = (card.domain || '').toLowerCase();
        if (title.includes(lower) || domain.includes(lower) || lower.includes(title) || lower.includes(domain)) {
          return { ok: true, action: 'specify', tabNumber: i + 1 };
        }
      }
    }
  }
  
  return { ok: false, action: 'unclear' };
}

function generateSuccessFallback(intent, result, candidate) {
  const intentName = typeof intent === 'string' ? intent : intent?.intent || 'unknown';
  const tabTitle = candidate?.card?.title || 'tab';
  const tabCount = result?.count || 1;
  
  switch (intentName) {
    case 'open':
      return `Opened ${tabTitle}!`;
    case 'close':
      return `Closed ${tabCount} tab${tabCount > 1 ? 's' : ''}.`;
    case 'find_open':
      return `Jumped to ${tabTitle}!`;
    case 'save':
      return `Saved to bookmarks!`;
    case 'reopen':
      return `Restored ${tabCount} tab${tabCount > 1 ? 's' : ''}!`;
    default:
      return 'Done!';
  }
}

function generateErrorFallback(reason, query) {
  switch (reason) {
    case 'no_tabs':
      return "You don't have any tabs open right now.";
    case 'parse_failed':
      return "Sorry, I didn't understand that. Could you rephrase?";
    case 'no_matches':
      return `I couldn't find any tabs matching "${query}". Should I search your history?`;
    case 'not_found':
      return `Couldn't find a tab like that. Want me to open it?`;
    case 'ask_failed':
      return "I couldn't answer that question right now. Try asking something else.";
    case 'unknown_error':
      return "Sorry, something went wrong. Could you try again?";
    case 'empty_group':
      return `Group '${query}' is empty.`;
    case 'undo_expired':
      return "Sorry, couldn't undo. The undo window may have expired.";
    default:
      return `Sorry, something went wrong: ${reason}. Could you try again?`;
  }
}

function generateDisambiguationFallback(intent, candidates, format) {
  const candidateCount = candidates?.length || 0;
  const domain = candidates?.[0]?.card?.domain || '';
  const intentName = typeof intent === 'string' ? intent : intent?.intent || 'unknown';
  
  if (candidateCount === 1) {
    return `I found 1 match — ${candidates[0]?.card?.title || 'Untitled'}?`;
  }
  
  if (format === 'voice') {
    if (candidateCount <= 3) {
      // Descriptive for 2-3
      return candidates.slice(0, 3).map((c, i) => 
        `${i === 0 ? 'One is' : i === 1 ? 'Another is' : 'The third is'} ${c.card?.title || 'Untitled'}.`
      ).join(' ');
    } else {
      // Numbered for 4+
      return candidates.slice(0, 5).map((c, i) => 
        `Number ${i + 1}: ${c.card?.title || 'Untitled'}.`
      ).join(' ');
    }
  } else {
    // Chat format
    return `You have ${candidateCount} ${domain || 'matching tabs'} open — which one?`;
  }
}

