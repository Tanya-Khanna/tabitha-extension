// ============================================================================
// TALK TO YOUR TABS - MAIN ENTRY POINT
// ============================================================================
// Voice pipeline integration with chat-for-tabs
// Handles VOICE_QUERY, VOICE_CONFIRM, VOICE_STOP_TTS messages
// ============================================================================

import { ensureOffscreen, postToOffscreen } from '../chat-for-tabs/utils.js';
import { preprocessQuery, parseIntent, checkPromptApiAvailability } from '../chat-for-tabs/intent-parsing.js';
import { Indexer } from '../chat-for-tabs/indexer.js';
import { processCandidates } from '../chat-for-tabs/search.js';
import { 
  executeOpenAction, 
  executeCloseAction, 
  executeFindOpenAction, 
  executeReopenAction,
  executeFocusGroup,
  executeCloseGroup
} from '../chat-for-tabs/actions.js';
import { getChatSessionId, formatConversationForPrompt } from '../chat-for-tabs/conversation.js';
import { 
  generateConversationalResponse, 
  generateErrorResponse, 
  generateSuccessResponse,
  generateDisambiguationList
} from '../chat-for-tabs/conversation-responses.js';

const log = (...a) => console.log("[Tabitha::voice]", ...a);

// Global flag for indexer boot state
let __INDEXER_BOOTED__ = false;

// Voice confirmation state (pending confirmations)
let pendingConfirmations = new Map(); // requestId -> { type, data, action }

/**
 * Initialize talk-to-tabs feature
 */
export async function init() {
  // Ensure indexer is ready (will be lazy-loaded on first voice query)
  try {
    if (!__INDEXER_BOOTED__) {
      __INDEXER_BOOTED__ = true;
      await Indexer.init();
      log('Indexer booted for voice');
    }
  } catch (err) {
    log('Indexer init error:', err);
    // Continue even if indexer init fails
  }
}

/**
 * Parse confirmation response (yes/no/which ones/etc.)
 * @param {string} text - User's confirmation response
 * @returns {Object} { confirmed, refinements?, listRequest? }
 */
function parseConfirmation(text) {
  const lower = String(text || '').trim().toLowerCase();
  
  // Affirmative responses
  const affirmative = ['yes', 'yep', 'ok', 'okay', 'sure', 'do it', 'go ahead', 'proceed', 'continue', 'confirm'];
  if (affirmative.some(a => lower.includes(a))) {
    return { confirmed: true };
  }
  
  // Negative responses
  const negative = ['no', 'nope', 'cancel', 'stop', 'abort', 'don\'t', 'don\'t do it'];
  if (negative.some(n => lower.includes(n))) {
    return { confirmed: false };
  }
  
  // List request
  if (lower.includes('which') || lower.includes('what') || lower.includes('list') || lower.includes('show')) {
    return { confirmed: false, listRequest: true };
  }
  
  // Refinement request (e.g., "only the music ones")
  if (lower.includes('only') || lower.includes('just') || lower.includes('except')) {
    return { confirmed: false, refinements: text };
  }
  
  // Default: treat as confirmation if unclear
  return { confirmed: true };
}

/**
 * Check if query is a greeting or conversational (not an action request)
 */
function isGreetingOrConversational(query) {
  const lower = String(query || '').trim().toLowerCase();
  const greetings = [
    'hi', 'hello', 'hey', 'hi there', 'hello there', 
    'how are you', 'what\'s up', 'how do you do',
    'good morning', 'good afternoon', 'good evening',
    'thanks', 'thank you', 'thanks tabitha', 'hi tabitha', 'hey tabitha'
  ];
  
  // Check if query starts with or contains only greeting words
  for (const greeting of greetings) {
    if (lower === greeting || lower.startsWith(greeting + ' ') || lower === greeting.replace(' ', '')) {
      return true;
    }
  }
  
  // Check for greeting patterns
  if (/^(hi|hello|hey)\s+(tabitha|davida|assistant)/i.test(query)) {
    return true;
  }
  
  return false;
}

/**
 * Generate conversational greeting response
 */
async function generateGreetingResponse(query) {
  try {
    const sessionId = getChatSessionId();
    const context = formatConversationForPrompt(sessionId);
    
    const greetingResponse = await generateConversationalResponse(
      { intent: 'ask', canonical_query: query },
      [],
      query,
      context
    );
    
    if (greetingResponse?.ok && greetingResponse.text) {
      return greetingResponse.text;
    }
    
    // Fallback greeting
    return 'Hi! How can I help you with your tabs today?';
  } catch (err) {
    log('Failed to generate greeting:', err);
    return 'Hi! How can I help you with your tabs today?';
  }
}

/**
 * Generate spoken summary for action result (now uses conversational responses)
 * @param {Object} params - Summary parameters
 * @returns {Promise<string>} Spoken summary text
 */
async function generateSpokenSummary(params) {
  try {
    const intent = params.intent || { intent: params.action || 'unknown' };
    const result = params.result || 'success';
    const query = params.query || '';
    
    // Use conversational response functions instead of templates
    if (result === 'no_matches' || result === 'no_candidates') {
      const errorResponse = await generateErrorResponse(intent, query, 'no_matches');
      return errorResponse?.ok && errorResponse.text ? errorResponse.text : 'I couldn\'t find any matching tabs.';
    } else if (result === 'parse_failed' || result === 'failed') {
      const errorResponse = await generateErrorResponse(intent, query, 'parse_failed');
      return errorResponse?.ok && errorResponse.text ? errorResponse.text : 'Sorry, I didn\'t understand that.';
    } else if (result === 'success' && params.topCandidate && params.candidates?.length === 1) {
      const successResponse = await generateSuccessResponse(intent, { ok: true, count: 1 }, params.topCandidate);
      return successResponse?.ok && successResponse.text ? successResponse.text : 'Done!';
    } else if (params.candidates?.length > 1) {
      // Multiple matches - use conversational response
      const sessionId = getChatSessionId();
      const context = formatConversationForPrompt(sessionId);
      const convResponse = await generateConversationalResponse(intent, params.candidates, query, context);
      return convResponse?.ok && convResponse.text ? convResponse.text : `Found ${params.candidates.length} matches — which one?`;
    } else {
      // Generic success or other case
      if (params.action === 'close' && params.tabCount > 0) {
        const successResponse = await generateSuccessResponse(
          intent, 
          { ok: true, count: params.tabCount }, 
          null
        );
        return successResponse?.ok && successResponse.text ? successResponse.text : `Closed ${params.tabCount} tab${params.tabCount !== 1 ? 's' : ''}.`;
      } else if (params.action === 'focus' && params.groupName) {
        const successResponse = await generateSuccessResponse(
          intent,
          { ok: true, count: params.tabCount || 0 },
          null
        );
        return successResponse?.ok && successResponse.text ? successResponse.text : `Jumping to ${params.groupName}.`;
      }
      
      // Fallback
      return 'Done!';
    }
  } catch (err) {
    log('Failed to generate spoken summary:', err);
    return 'Done!';
  }
}

/**
 * Handle voice query - main pipeline
 * @param {Object} msg - Voice query message
 * @returns {Promise<Object>} Response with action result and spoken summary
 */
async function handleVoiceQuery(msg) {
  const requestId = msg.requestId || `voice_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const query = String(msg.text || '').trim();
  
  if (!query) {
    return { ok: false, error: 'empty_query' };
  }
  
  // Step 0: Check if this is a greeting or conversational query (not an action)
  if (isGreetingOrConversational(query)) {
    log('Detected greeting, generating conversational response');
    const greetingText = await generateGreetingResponse(query);
    return {
      ok: true,
      isGreeting: true,
      spokenSummary: greetingText,
      metadata: { query, timestamp: Date.now() }
    };
  }
  
  // Boot indexer if needed
  if (!__INDEXER_BOOTED__) {
    __INDEXER_BOOTED__ = true;
    try {
      await Indexer.init();
      await Indexer.handleMessage({ type: 'REFRESH_OPEN_TABS' });
    } catch (err) {
      log('Indexer boot error:', err);
    }
  }
  
  const sessionId = getChatSessionId();
  const startTime = Date.now();
  
  try {
    // SPEED OPTIMIZATION: Run preprocessing, intent parsing, and lexical search in parallel
    const preprocessPromise = preprocessQuery(query);
    const intentPromise = parseIntent(query, sessionId);
    const lexicalPromise = Indexer.handleMessage({
      type: 'LEXICAL_SEARCH',
      query: query,
      filters: {}, // Will filter later
      limit: 30
    });
    
    const [preprocessed, intentResult, lexicalResult] = await Promise.all([
      preprocessPromise,
      intentPromise,
      lexicalPromise
    ]);
    
    const cleanedQuery = preprocessed?.cleaned || query;
    
    // Use intent if available, otherwise fast fallback
    let intent;
    if (!intentResult?.ok || !intentResult.intent) {
      // Fast fallback for voice
      const lower = query.toLowerCase();
      intent = { 
        intent: 'find_open', 
        canonical_query: query, 
        constraints: { resultMustBeOpen: true, includeApps: [], excludeApps: [], scope: null, group: null, limit: null, dateRange: null }, 
        operation: null, operation_args: null, folderName: null, disambiguationNeeded: false, hints: [], anaphora_of: null, time_reason: null, notes: 'fast_fallback' 
      };
      
      // ACCURACY: Check for question words FIRST (what/how/when/where/which) - these are questions, not actions
      if (/^(what|how|when|where|which|tell me about|describe)/.test(lower)) {
        intent.intent = 'ask';
      } else if (/^(open|go to|jump to|switch to|take me to)/.test(lower)) {
        intent.intent = 'open';
      } else if (/^(close|remove|delete)/.test(lower)) {
        intent.intent = 'close';
      } else if (/^(find|locate|where)/.test(lower)) {
        intent.intent = 'find_open';
      } else if (/^(list|show|display)/.test(lower)) {
        intent.intent = 'list';
      }
      
      log('Using fast fallback intent for voice:', intent.intent);
    } else {
      intent = intentResult.intent;
      log('Parsed intent:', intent);
    }
    
    // Filter lexical candidates based on intent
    let lexicalCandidates = lexicalResult?.results || [];
    if (intent.constraints?.resultMustBeOpen === true && lexicalCandidates.length > 0) {
      lexicalCandidates = lexicalCandidates.filter(c => c.card?.source === 'tab');
    }
    
    log(`Found ${lexicalCandidates.length} lexical candidates after filtering`);
    
    // Step 4: Filter and rank candidates (SAME PIPELINE AS CHAT, but with conditional semantic rerank)
    const processedResult = await processCandidates(
      lexicalCandidates,
      intent,
      intent.canonical_query || cleanedQuery,
      true, // enableSemanticRerank (but will skip if high confidence)
      sessionId
    );
    
    if (!processedResult?.ok) {
      const summary = await generateSpokenSummary({ 
        intent: intent,
        action: intent.intent,
        result: 'no_candidates',
        query: cleanedQuery,
        candidates: []
      });
      return { 
        ok: false, 
        error: 'no_candidates',
        spokenSummary: summary
      };
    }
    
    // Step 5: Auto-execute logic
    // Auto-execute if exactly 1 high-confidence candidate (≥0.8) for open/find_open intents
    const autoExecuteThreshold = 0.80;
    
    if ((intent.intent === 'open' || intent.intent === 'find_open') && 
        processedResult.autoExecute && 
        processedResult.candidate &&
        (processedResult.confidence || processedResult.candidate.score || 0) >= autoExecuteThreshold) {
      
      // Auto-execute: open/find the tab
      log('Auto-executing:', processedResult.candidate.card);
      
      let actionResult;
      if (intent.intent === 'open') {
        actionResult = await executeOpenAction(
          processedResult.candidate.card.cardId,
          true, // nextToCurrent
          intent,
          requestId
        );
      } else {
        actionResult = await executeFindOpenAction(processedResult.candidate.card.cardId);
      }
      
      // Generate spoken summary
      const summary = await generateSpokenSummary({
        intent: intent,
        action: 'open',
        result: actionResult?.ok ? 'success' : 'failed',
        query: cleanedQuery,
        candidates: [processedResult.candidate],
        topCandidate: processedResult.candidate,
        tabCount: 1
      });
      
      return {
        ok: actionResult?.ok || false,
        autoExecute: true,
        action: intent.intent,
        spokenSummary: summary,
        candidate: processedResult.candidate.card,
        metadata: processedResult.metadata
      };
    }
    
    // Step 6: Handle group scope auto-execute
    if (intent?.constraints?.scope === 'group' && 
        intent?.constraints?.group && 
        processedResult.candidates?.length === 1 && 
        (processedResult.confidence || processedResult.candidates[0].score || 0) >= autoExecuteThreshold) {
      
      const groupName = intent.constraints.group;
      log('Auto-executing group focus:', groupName);
      
      const focusResult = await executeFocusGroup(groupName);
      
      if (focusResult?.ok) {
        const summary = await generateSpokenSummary({
          intent: intent,
          action: 'focus',
          result: 'success',
          query: cleanedQuery,
          groupName: groupName,
          tabCount: focusResult.tabCount || 0
        });
        
        return {
          ok: true,
          autoExecute: true,
          groupFocused: true,
          groupName: groupName,
          spokenSummary: summary,
          tabCount: focusResult.tabCount || 0
        };
      }
    }
    
    // Step 7: Handle close actions (needs confirmation)
    if (intent.intent === 'close') {
      const candidates = processedResult.candidates || [];
      const tabIds = candidates
        .filter(c => c.card.source === 'tab' && c.card.tabId)
        .map(c => c.card.tabId);
      
      if (tabIds.length === 0) {
        const summary = await generateSpokenSummary({
          intent: intent,
          action: 'close',
          result: 'no_matches',
          query: cleanedQuery,
          candidates: []
        });
        return {
          ok: false,
          error: 'no_tabs_to_close',
          spokenSummary: summary
        };
      }
      
      // Store pending confirmation
      pendingConfirmations.set(requestId, {
        type: 'close',
        intent: intent,
        tabIds: tabIds,
        candidates: candidates,
        requestId: requestId
      });
      
      // Generate confirmation prompt using conversational response
      const sessionId = getChatSessionId();
      const context = formatConversationForPrompt(sessionId);
      const convResponse = await generateConversationalResponse(
        intent,
        candidates,
        cleanedQuery,
        context
      );
      const summary = convResponse?.ok && convResponse.text 
        ? convResponse.text 
        : `I found ${tabIds.length} tab${tabIds.length > 1 ? 's' : ''}. Close them?`;
      
      return {
        ok: true,
        needsConfirmation: true,
        confirmationType: 'close',
        requestId: requestId,
        tabCount: tabIds.length,
        candidates: candidates,
        spokenSummary: summary,
        metadata: processedResult.metadata
      };
    }
    
    // Step 8: Handle reopen actions (needs confirmation)
    if (intent.intent === 'reopen') {
      // Store pending confirmation
      pendingConfirmations.set(requestId, {
        type: 'reopen',
        intent: intent,
        requestId: requestId
      });
      
      // Get recently closed session count (simplified)
      // Use LEXICAL_SEARCH instead of INDEX_QUERY for consistency
      const sessionResult = await Indexer.handleMessage({
        type: 'LEXICAL_SEARCH',
        query: '',
        filters: { source: 'session' },
        limit: 1
      });
      
      // LEXICAL_SEARCH returns {card, score} objects - extract card
      const sessionCard = sessionResult?.results?.[0]?.card || sessionResult?.results?.[0];
      const sessionCount = sessionCard?.sessionItem?.tabs?.length || 0;
      
      // Generate conversational confirmation prompt
      const sessionId2 = getChatSessionId();
      const context2 = formatConversationForPrompt(sessionId2);
      const convResponse2 = await generateConversationalResponse(
        intent,
        [],
        cleanedQuery,
        context2
      );
      const summary = convResponse2?.ok && convResponse2.text
        ? convResponse2.text
        : `Your last session has ${sessionCount} tab${sessionCount !== 1 ? 's' : ''}. Reopen all or just the last window?`;
      
      return {
        ok: true,
        needsConfirmation: true,
        confirmationType: 'reopen',
        requestId: requestId,
        tabCount: sessionCount,
        spokenSummary: summary,
        metadata: processedResult.metadata
      };
    }
    
    // Step 9: Disambiguation needed (multiple candidates)
    const candidates = processedResult.candidates || [];
    if (candidates.length > 1) {
      // Use conversation-responses module for voice-formatted disambiguation
      const disambiguationResponse = await generateDisambiguationList(
        intent,
        candidates.slice(0, 5),
        'voice' // Voice format
      );
      
      const summary = disambiguationResponse?.ok && disambiguationResponse.text
        ? disambiguationResponse.text
        : await generateSpokenSummary({
            intent: intent,
            action: 'disambiguate',
            result: 'multiple_matches',
            query: cleanedQuery,
            candidates: candidates.slice(0, 5),
            topCandidate: candidates[0]
          });
      
      return {
        ok: true,
        needsDisambiguation: true,
        candidates: candidates.slice(0, 5), // Top 5 for disambiguation
        intent: intent, // Include intent for follow-up handling
        spokenSummary: summary,
        metadata: processedResult.metadata,
        followupQuestion: processedResult.followupQuestion
      };
    }
    
    // Step 10: No matches
    const summary = await generateSpokenSummary({
      intent: intent,
      action: intent.intent,
      result: 'no_matches',
      query: cleanedQuery,
      candidates: []
    });
    
    return {
      ok: false,
      error: 'no_matches',
      spokenSummary: summary,
      metadata: processedResult.metadata
    };
    
  } catch (err) {
    log('Voice query error:', err);
    const summary = await generateSpokenSummary({
      intent: { intent: 'unknown' },
      action: 'error',
      result: 'failed',
      query: query,
      candidates: []
    });
    return {
      ok: false,
      error: String(err?.message || err),
      spokenSummary: summary
    };
  }
}

/**
 * Handle voice confirmation
 * @param {Object} msg - Confirmation message
 * @returns {Promise<Object>} Response with action result
 */
async function handleVoiceConfirm(msg) {
  const requestId = msg.requestId;
  const confirmationText = String(msg.text || '').trim();
  
  if (!requestId || !pendingConfirmations.has(requestId)) {
    return { ok: false, error: 'invalid_confirmation_request' };
  }
  
  const pending = pendingConfirmations.get(requestId);
  const parsed = parseConfirmation(confirmationText);
  
  if (!parsed.confirmed) {
    // Cancel or refinements
    pendingConfirmations.delete(requestId);
    
    if (parsed.listRequest) {
      // List top 5 titles
      const candidates = pending.candidates || [];
      const titles = candidates.slice(0, 5).map((c, i) => 
        `${i + 1}. ${c.card.title || 'Untitled'}`
      ).join(', ');
      return {
        ok: true,
        cancelled: true,
        spokenSummary: titles || 'No tabs found'
      };
    } else if (parsed.refinements) {
      // Refine query and re-ask
      return {
        ok: true,
        needsRefinement: true,
        refinements: parsed.refinements
      };
    } else {
      // Cancel
      return {
        ok: true,
        cancelled: true,
        spokenSummary: 'Cancelled'
      };
    }
  }
  
  // Execute confirmed action
  pendingConfirmations.delete(requestId);
  
  try {
    let actionResult;
    let summary;
    
    if (pending.type === 'close') {
      actionResult = await executeCloseAction(
        null,
        pending.tabIds,
        true, // confirmed
        requestId
      );
      
      summary = await generateSpokenSummary({
        intent: pending.intent || { intent: 'close' },
        action: 'close',
        result: actionResult?.ok ? 'success' : 'failed',
        query: confirmationText,
        tabCount: pending.tabIds.length
      });
      
    } else if (pending.type === 'reopen') {
      actionResult = await executeReopenAction(null);
      summary = await generateSpokenSummary({
        intent: pending.intent || { intent: 'reopen' },
        action: 'reopen',
        result: actionResult?.ok ? 'success' : 'failed',
        query: confirmationText,
        tabCount: actionResult?.tabCount || 0
      });
      
    } else {
      return { ok: false, error: 'unknown_confirmation_type' };
    }
    
    return {
      ok: actionResult?.ok || false,
      action: pending.type,
      spokenSummary: summary,
      result: actionResult
    };
    
  } catch (err) {
    log('Confirmation execution error:', err);
    return {
      ok: false,
      error: String(err?.message || err),
      spokenSummary: 'Sorry, I couldn\'t complete that action'
    };
  }
}

/**
 * Handle stop TTS message
 * @param {Object} msg - Stop TTS message
 * @returns {Promise<Object>} Response
 */
async function handleStopTTS(msg) {
  try {
    const result = await postToOffscreen('STOP_TTS', {});
    return { ok: result?.ok || false };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

/**
 * Main message handler for Talk to Tabs
 * @param {Object} msg - Message from popup/background
 * @returns {Promise<Object|null>} Response or null if not handled
 */
export async function handleTalkToTabsMessage(msg) {
  if (!msg || !msg.type) {
    return null;
  }
  
  switch (msg.type) {
    case 'VOICE_QUERY':
      return await handleVoiceQuery(msg);
    
    case 'VOICE_CONFIRM':
      return await handleVoiceConfirm(msg);
    
    case 'VOICE_STOP_TTS':
      return await handleStopTTS(msg);
    
    default:
      return null; // Not handled
  }
}
