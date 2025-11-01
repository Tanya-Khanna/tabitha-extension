// Chat with your Tabs - Main Entry Point
// Wires together all modules and handles message routing

import { Indexer } from './indexer.js';
import { ensureOffscreen, postToOffscreen, structuredLog, recordTelemetry, markActionStarted, markActionCompleted, isActionInFlight } from './utils.js';
import { getChatSessionId, addToConversationHistory, formatConversationForPrompt, addDisambiguationCandidates, getLastDisambiguationCandidates, addActionResult } from './conversation.js';
import { parseIntent, preprocessQuery, checkPromptApiAvailability } from './intent-parsing.js';
import { aiSemanticSearch, semanticRerank, processCandidates, filterCandidatesByConstraints, askSpecificClarifier, generateClarifyingQuestion, formatDisambiguationList } from './search.js';
import { executeOpenAction, executeCloseAction, executeFindOpenAction, executeReopenAction, executeSaveAction, executeShowAction, executeAskAction, executeMuteAction, executeUnmuteAction, executePinAction, executeUnpinAction, executeReloadAction, executeDiscardAction, undoLastCloseAction, setIndexerBooted, executeFocusGroup, executeCloseGroup, executeSaveGroup, executeMoveGroupToWindow, executeRenameGroup, executeCollapseGroup, executeUngroup } from './actions.js';
import { setIndexerBooted as setSearchIndexerBooted } from './search.js';
import { generateConversationalResponse, understandFollowUp, generateSuccessResponse, generateErrorResponse, generateDisambiguationList } from './conversation-responses.js';

const log = (...a) => console.log("[Tabitha::chat]", ...a);

// Global flag for indexer boot state
let __INDEXER_BOOTED__ = false;

// Chat user hints (short memory)
const chatUserHints = {
  phraseToDomain: new Map(),
  phraseToType: new Map()
};

// Load chat user hints on initialization
async function loadChatUserHints() {
  try {
    const stored = await chrome.storage.local.get(['chatUserHints']);
    if (stored.chatUserHints) {
      chatUserHints.phraseToDomain = new Map(stored.chatUserHints.phraseToDomain || []);
      chatUserHints.phraseToType = new Map(stored.chatUserHints.phraseToType || []);
    }
  } catch (err) {
    log('Failed to load chat user hints:', err);
  }
}

async function saveChatUserHint(phrase, domain, type, boost = 1) {
  const phraseLower = phrase.toLowerCase();
  
  if (domain) {
    if (!chatUserHints.phraseToDomain.has(phraseLower)) {
      chatUserHints.phraseToDomain.set(phraseLower, new Map());
    }
    const domainMap = chatUserHints.phraseToDomain.get(phraseLower);
    domainMap.set(domain, (domainMap.get(domain) || 0) + boost);
  }
  
  if (type) {
    if (!chatUserHints.phraseToType.has(phraseLower)) {
      chatUserHints.phraseToType.set(phraseLower, new Map());
    }
    const typeMap = chatUserHints.phraseToType.get(phraseLower);
    typeMap.set(type, (typeMap.get(type) || 0) + boost);
  }
  
  try {
    await chrome.storage.local.set({
      chatUserHints: {
        phraseToDomain: Array.from(chatUserHints.phraseToDomain.entries()).map(([k, v]) => [k, Array.from(v.entries())]),
        phraseToType: Array.from(chatUserHints.phraseToType.entries()).map(([k, v]) => [k, Array.from(v.entries())])
      }
    });
  } catch (err) {
    log('Failed to save chat user hint:', err);
  }
}

// Helper function for undoLastAction (wrapper for undoLastCloseAction)
async function undoLastAction() {
  return await undoLastCloseAction();
}

// Initialize chat module
export async function init() {
  await loadChatUserHints();
}

// Main message handler for Chat with your Tabs
export async function handleChatMessage(msg) {
  const requestId = msg.requestId || null;
  
  try {
    switch (msg.type) {
      // ==== INDEXER MESSAGE HANDLERS ====
      case "CHAT_OPENED": {
        try {
          if (!__INDEXER_BOOTED__) {
            __INDEXER_BOOTED__ = true;
            await Indexer.init();
            setIndexerBooted(true);
            setSearchIndexerBooted(true);
            log('Indexer bootstrapped lazily (chat opened)');
          }
          
          await Indexer.handleMessage({ type: 'REFRESH_OPEN_TABS' });
          
          const counts = await Indexer.handleMessage({ type: 'INDEX_COUNTS' });
          log('Index counts by source:', counts.counts);
          return { ok: true, booted: true, counts: counts.counts };
        } catch (err) {
          return { ok: false, error: String(err?.message || err) };
        }
      }

      case "INDEX_COUNTS":
      case "INDEX_QUERY": {
        try {
          if (!__INDEXER_BOOTED__) {
            __INDEXER_BOOTED__ = true;
            await Indexer.init();
            setIndexerBooted(true);
            setSearchIndexerBooted(true);
          }
          const res = await Indexer.handleMessage(msg);
          return res || { ok: false, error: 'indexer_no_response' };
        } catch (err) {
          return { ok: false, error: String(err?.message || err) };
        }
      }

      case "INDEX_HEALTH": {
        try {
          if (!__INDEXER_BOOTED__) {
            __INDEXER_BOOTED__ = true;
            await Indexer.init();
            setIndexerBooted(true);
            setSearchIndexerBooted(true);
          }
          const res = await Indexer.handleMessage({ type: 'INDEX_HEALTH' });
          return res || { ok: false, error: 'health_check_failed' };
        } catch (err) {
          return { ok: false, error: String(err?.message || err) };
        }
      }

      // ==== PHASE 2: LEXICAL SEARCH ====
      case "LEXICAL_SEARCH": {
        try {
          if (!__INDEXER_BOOTED__) {
            __INDEXER_BOOTED__ = true;
            await Indexer.init();
            setIndexerBooted(true);
            setSearchIndexerBooted(true);
          }
          const res = await Indexer.handleMessage(msg);
          return res || { ok: false, error: 'lexical_search_failed' };
        } catch (err) {
          return { ok: false, error: String(err?.message || err) };
        }
      }

      // ==== CHAT-FOR-TABS: QUERY PREPROCESSING ====
      case "PREPROCESS_QUERY": {
        try {
          const userQuery = String(msg.query || '').trim();
          if (!userQuery) {
            return { ok: false, error: 'empty_query' };
          }
          const sessionId = msg.sessionId || getChatSessionId();
          const result = await preprocessQuery(userQuery, sessionId);
          return result;
        } catch (err) {
          return { ok: false, error: String(err?.message || err) };
        }
      }

      // ==== PHASE 3: INTENT + SLOT EXTRACTION ====
      case "PARSE_INTENT": {
        try {
          const text = String(msg.text || '').trim();
          if (!text) {
            return { ok: false, error: 'empty_text' };
          }
          const sessionId = msg.sessionId || getChatSessionId();
          const result = await parseIntent(text, sessionId);
          return result;
        } catch (err) {
          return { ok: false, error: String(err?.message || err) };
        }
      }

      // ==== CHAT-FOR-TABS: AI-POWERED SEMANTIC SEARCH ====
      case "AI_SEARCH": {
        try {
          if (!__INDEXER_BOOTED__) {
            __INDEXER_BOOTED__ = true;
            await Indexer.init();
            setIndexerBooted(true);
            setSearchIndexerBooted(true);
          }
          
          const query = msg.query || '';
          const intent = msg.intent;
          const sessionId = msg.sessionId || getChatSessionId();
          const limit = msg.limit || 30;
          
          if (!query) {
            return { ok: false, error: 'empty_query' };
          }
          
          const lexicalCount = msg.lexicalResultCount || 0;
          const result = await aiSemanticSearch(query, intent, sessionId, limit, lexicalCount);
          return result;
        } catch (err) {
          return { ok: false, error: String(err?.message || err) };
        }
      }

      // ==== CHAT-FOR-TABS: AI-POWERED SEMANTIC RANKING ====
      case "AI_RANK": {
        try {
          const candidates = msg.candidates || [];
          const query = msg.query || '';
          const sessionId = msg.sessionId || getChatSessionId();
          
          if (!candidates.length) {
            return { ok: true, ranked: [] };
          }
          
          const ranked = await semanticRerank(candidates, query, sessionId, null);
          return { ok: true, ranked };
        } catch (err) {
          return { ok: false, error: String(err?.message || err) };
        }
      }

      // ==== CHAT-FOR-TABS: EXECUTE ASK INTENT ====
      case "EXECUTE_ASK": {
        try {
          const query = msg.query || '';
          const intent = msg.intent;
          const sessionId = msg.sessionId || getChatSessionId();
          
          if (!query) {
            return { ok: false, error: 'empty_query' };
          }
          
          const result = await executeAskAction(query, intent, sessionId);
          return result;
        } catch (err) {
          return { ok: false, error: String(err?.message || err) };
        }
      }

      // ==== PHASE 4: CANDIDATE PIPELINE ====
      case "FILTER_AND_RANK": {
        try {
          if (!__INDEXER_BOOTED__) {
            __INDEXER_BOOTED__ = true;
            await Indexer.init();
            setIndexerBooted(true);
            setSearchIndexerBooted(true);
          }
          
          const intent = msg.intent;
          const lexicalResults = msg.lexicalResults || [];
          const query = msg.query || '';
          const sessionId = msg.sessionId || getChatSessionId();
          
          if (!intent || !intent.intent) {
            return { ok: false, error: 'invalid_intent' };
          }
          
          const result = await processCandidates(lexicalResults, intent, query, true, sessionId);
          
          // Auto-execute for group scope: if scope='group' and high confidence, focus group
          if (intent?.constraints?.scope === 'group' && intent?.constraints?.group && 
              result.candidates && result.candidates.length === 1 && 
              (result.confidence || result.candidates[0].score || 0) >= 0.80) {
            const groupName = intent.constraints.group;
            const focusResult = await executeFocusGroup(groupName);
            if (focusResult?.ok) {
              return {
                ok: true,
                autoExecute: true,
                groupFocused: true,
                groupName: groupName,
                metadata: result.metadata
              };
            }
          }
          
          if (result.autoExecute && result.candidate) {
            return {
              ok: true,
              autoExecute: true,
              candidate: result.candidate,
              confidence: result.confidence,
              metadata: result.metadata
            };
          } else if (result.ok && result.candidates) {
            return {
              ok: true,
              autoExecute: false,
              candidates: result.candidates.map(c => ({
                card: c.card,
                score: c.score || c.aiScore || 0,
                constraintBonus: c.constraintBonus || 0,
                aiScore: c.aiScore,
                aiReason: c.aiReason
              })),
              metadata: result.metadata,
              needsFollowup: result.needsFollowup,
              followupQuestion: result.followupQuestion
            };
          } else {
            return result;
          }
        } catch (err) {
          return { ok: false, error: String(err?.message || err) };
        }
      }

      // ==== PHASE 5: DISAMBIGUATION ====
      case "FORMAT_DISAMBIGUATION": {
        try {
          const shortlist = msg.shortlist || [];
          const formatted = formatDisambiguationList(shortlist);
          return { ok: true, formatted };
        } catch (err) {
          return { ok: false, error: String(err?.message || err) };
        }
      }

      case "GENERATE_CLARIFYING_QUESTION": {
        try {
          const intent = msg.intent;
          const shortlist = msg.shortlist || [];
          const question = await generateClarifyingQuestion(intent, shortlist);
          return { ok: true, question };
        } catch (err) {
          return { ok: false, error: String(err?.message || err) };
        }
      }

      case "SAVE_USER_HINT": {
        try {
          await saveChatUserHint(msg.phrase, msg.domain, msg.type, msg.boost || 1);
          return { ok: true };
        } catch (err) {
          return { ok: false, error: String(err?.message || err) };
        }
      }

      // ==== PHASE 6: ACTIONS ====
      case "EXECUTE_ACTION": {
        // Define variables outside try block so they're available in catch
        const intent = msg.intent; // This can be a string (intent name) or object (full intent with constraints)
        const intentName = typeof intent === 'string' ? intent : (typeof intent === 'object' ? intent?.intent : null) || msg.intent || 'unknown';
        const intentObj = typeof intent === 'object' ? intent : (msg.intent && typeof msg.intent === 'object' ? msg.intent : null);
        const cardId = msg.cardId;
        const nextToCurrent = !!msg.nextToCurrent;
        
        try {
          if (requestId && isActionInFlight(requestId)) {
            return { ok: false, error: 'action_already_in_flight', requestId };
          }
          
          markActionStarted(requestId, intentName);
          
          // Log action started (synchronous, non-blocking)
          structuredLog('Phase 6', 'action_started', {
            intent: intentName,
            requestId,
            cardId,
            nextToCurrent
          });
          
          let result;
          switch (intentName) {
            case 'open':
              result = await executeOpenAction(cardId, nextToCurrent, intentObj || intentName, requestId);
              break;
            case 'close':
              // Handle close action: convert cardId to tabId if needed
              let tabIdsForClose = null;
              if (msg.tabIds && Array.isArray(msg.tabIds)) {
                tabIdsForClose = msg.tabIds;
              } else if (msg.cardId || cardId) {
                // Extract tabId from cardId
                const targetCardId = msg.cardId || cardId;
                const targetCard = Indexer._get(targetCardId);
                if (targetCard && targetCard.tabId) {
                  tabIdsForClose = [targetCard.tabId];
                } else if (msg.cardIds && Array.isArray(msg.cardIds)) {
                  // Multiple cards - extract all tabIds
                  tabIdsForClose = msg.cardIds
                    .map(cid => Indexer._get(cid))
                    .filter(card => card && card.tabId)
                    .map(card => card.tabId);
                }
              } else if (msg.tabId) {
                tabIdsForClose = [msg.tabId];
              }
              
              if (msg.confirmed === true) {
                if (tabIdsForClose && tabIdsForClose.length > 0) {
                  result = await executeCloseAction(null, tabIdsForClose, true, requestId);
                } else if (msg.filters) {
                  result = await executeCloseAction(msg.filters, null, true, requestId);
                } else {
                  result = { ok: false, error: 'missing_filters_or_tabIds' };
                }
              } else {
                if (tabIdsForClose && tabIdsForClose.length > 0) {
                  result = await executeCloseAction(null, tabIdsForClose, false, requestId);
                } else if (msg.filters) {
                  result = await executeCloseAction(msg.filters, null, false, requestId);
                } else {
                  result = { ok: false, error: 'missing_filters_or_tabIds' };
                }
              }
              break;
            case 'find_open':
              result = await executeFindOpenAction(cardId);
              break;
            case 'reopen':
              result = await executeReopenAction(cardId);
              break;
            case 'save':
              const folderName = intentObj?.folderName || msg.folderName || null;
              const saveAs = msg.saveAs || 'bookmark';
              result = await executeSaveAction(
                Array.isArray(msg.cardIds) ? msg.cardIds : (cardId ? [cardId] : []),
                folderName,
                saveAs
              );
              break;
            case 'show':
            case 'list':
              // Handle group operations with operation field
              if (intentObj?.operation && intentObj?.constraints?.scope === 'group') {
                const groupName = intentObj.constraints.group || intentObj.canonical_query || '';
                const operation = intentObj.operation;
                const operationArgs = intentObj.operation_args || {};
                
                switch (operation) {
                  case 'move_to_window':
                    result = await executeMoveGroupToWindow(groupName);
                    break;
                  case 'rename':
                    const newName = operationArgs.rename_to || groupName;
                    result = await executeRenameGroup(groupName, newName);
                    // If collapse is also requested, do that too
                    if (operationArgs.collapse !== undefined) {
                      if (result.ok) {
                        await executeCollapseGroup(groupName, operationArgs.collapse);
                      }
                    }
                    break;
                  case 'collapse':
                    result = await executeCollapseGroup(groupName, operationArgs.collapse !== undefined ? operationArgs.collapse : true);
                    break;
                  case 'expand':
                    result = await executeCollapseGroup(groupName, false);
                    break;
                  default:
                    // Fallback to regular list/show
                    result = await executeShowAction(Array.isArray(msg.cardIds) ? msg.cardIds : [cardId]);
                }
              } else {
                // Regular list/show - display tabs
                result = await executeShowAction(Array.isArray(msg.cardIds) ? msg.cardIds : [cardId]);
              }
              break;
            case 'ask':
              const askQuery = msg.query || intentObj?.query || '';
              const askSessionId = msg.sessionId || getChatSessionId();
              result = await executeAskAction(askQuery, intentObj || intentName, askSessionId);
              break;
            case 'mute':
              result = await executeMuteAction(
                Array.isArray(msg.cardIds) ? msg.cardIds : (cardId ? [cardId] : []),
                intentObj || intentName
              );
              break;
            case 'unmute':
              result = await executeUnmuteAction(
                Array.isArray(msg.cardIds) ? msg.cardIds : (cardId ? [cardId] : []),
                intentObj || intentName
              );
              break;
            case 'pin':
              result = await executePinAction(
                Array.isArray(msg.cardIds) ? msg.cardIds : (cardId ? [cardId] : []),
                intentObj || intentName
              );
              break;
            case 'unpin':
              result = await executeUnpinAction(
                Array.isArray(msg.cardIds) ? msg.cardIds : (cardId ? [cardId] : []),
                intentObj || intentName
              );
              break;
            case 'reload':
              result = await executeReloadAction(
                Array.isArray(msg.cardIds) ? msg.cardIds : (cardId ? [cardId] : []),
                intentObj || intentName
              );
              break;
            case 'discard':
              result = await executeDiscardAction(
                Array.isArray(msg.cardIds) ? msg.cardIds : (cardId ? [cardId] : []),
                intentObj || intentName
              );
              break;
            default:
              result = { ok: false, error: 'unknown_intent' };
          }
          
          // ACCURACY: Store action result for richer context
          const sessionId = getChatSessionId();
          const candidate = msg.cardId ? Indexer._get(msg.cardId) : null;
          addActionResult(sessionId, intentName, result, candidate ? [candidate] : null);
          
          // Log action completed (synchronous, non-blocking)
          structuredLog('Phase 6', 'action_completed', {
            intent: intentName,
            requestId,
            success: result.ok === true,
            error: result.error || null
          });
          
          markActionCompleted(requestId);
          return result;
        } catch (err) {
          structuredLog('Phase 6', 'action_completed', {
            intent: intentName || msg.intent || 'unknown',
            requestId,
            success: false,
            error: String(err?.message || err)
          });
          
          markActionCompleted(requestId);
          return { ok: false, error: String(err?.message || err) };
        }
      }

      case "UNDO_CLOSE":
      case "UNDO_ACTION": {
        try {
          const result = await undoLastAction();
          return result;
        } catch (err) {
          return { ok: false, error: String(err?.message || err) };
        }
      }

      // ==== PHASE 8: PERMISSION CHECK ====
      case "CHECK_PERMISSIONS": {
        try {
          const required = ['tabs', 'history', 'bookmarks', 'sessions', 'storage'];
          const granted = [];
          const missing = [];
          
          for (const perm of required) {
            const hasPermission = await new Promise((resolve) => {
              chrome.permissions.contains({ permissions: [perm] }, resolve);
            });
            if (hasPermission) {
              granted.push(perm);
            } else {
              missing.push(perm);
            }
          }
          
          return { ok: true, granted, missing, allGranted: missing.length === 0 };
        } catch (err) {
          return { ok: false, error: String(err?.message || err) };
        }
      }

      // ==== OFFSCREEN PROMPT ====
      case "OFFSCREEN_PROMPT": {
        try {
          const res = await postToOffscreen('OFFSCREEN_RUN_PROMPT_LM', { prompt: msg.prompt });
          return { ok: true, text: res.text };
        } catch (err) {
          return { ok: false, error: String(err?.message || err) };
        }
      }

      // ==== GROUP ACTION HANDLERS ====
      case "FOCUS_GROUP": {
        try {
          const { groupName } = msg;
          const result = await executeFocusGroup(groupName);
          return result;
        } catch (err) {
          return { ok: false, error: String(err?.message || err) };
        }
      }

      case "CLOSE_GROUP_PREVIEW": {
        try {
          const { groupName } = msg;
          const result = await executeCloseGroup(groupName, false);
          return result;
        } catch (err) {
          return { ok: false, error: String(err?.message || err) };
        }
      }

      case "CLOSE_GROUP_EXEC": {
        try {
          const { groupName } = msg;
          const result = await executeCloseGroup(groupName, true);
          return result;
        } catch (err) {
          return { ok: false, error: String(err?.message || err) };
        }
      }

      case "SAVE_GROUP": {
        try {
          const { groupName, folderName = 'Chat Saves' } = msg;
          const result = await executeSaveGroup(groupName, folderName);
          return result;
        } catch (err) {
          return { ok: false, error: String(err?.message || err) };
        }
      }

      case "MOVE_GROUP_TO_WINDOW": {
        try {
          const { groupName } = msg;
          const result = await executeMoveGroupToWindow(groupName);
          return result;
        } catch (err) {
          return { ok: false, error: String(err?.message || err) };
        }
      }

      case "GROUP_RENAME": {
        try {
          const { groupName, newName } = msg;
          const result = await executeRenameGroup(groupName, newName);
          return result;
        } catch (err) {
          return { ok: false, error: String(err?.message || err) };
        }
      }

      case "GROUP_COLLAPSE": {
        try {
          const { groupName, collapsed } = msg;
          const result = await executeCollapseGroup(groupName, collapsed);
          return result;
        } catch (err) {
          return { ok: false, error: String(err?.message || err) };
        }
      }

      case "GROUP_UNGROUP": {
        try {
          const { groupName } = msg;
          const result = await executeUngroup(groupName);
          return result;
        } catch (err) {
          return { ok: false, error: String(err?.message || err) };
        }
      }

      // ==== CONVERSATIONAL RESPONSE GENERATION ====
      case "GENERATE_CONVERSATIONAL_RESPONSE": {
        try {
          const { intent, candidates, query, context } = msg;
          const sessionId = msg.sessionId || getChatSessionId();
          const formattedContext = context || formatConversationForPrompt(sessionId);
          const result = await generateConversationalResponse(intent, candidates, query, formattedContext);
          return result;
        } catch (err) {
          return { ok: false, error: String(err?.message || err) };
        }
      }

      case "UNDERSTAND_FOLLOWUP": {
        try {
          const { previousQuery, previousResponse, candidates, newMessage, sessionId } = msg;
          const actualSessionId = sessionId || getChatSessionId();
          const result = await understandFollowUp(previousQuery, previousResponse, candidates, newMessage, actualSessionId);
          return result;
        } catch (err) {
          return { ok: false, error: String(err?.message || err) };
        }
      }

      case "GENERATE_SUCCESS_RESPONSE": {
        try {
          const { intent, result, candidate } = msg;
          const response = await generateSuccessResponse(intent, result, candidate);
          return response;
        } catch (err) {
          return { ok: false, error: String(err?.message || err) };
        }
      }

      case "GENERATE_ERROR_RESPONSE": {
        try {
          const { intent, query, reason } = msg;
          const response = await generateErrorResponse(intent, query, reason);
          return response;
        } catch (err) {
          return { ok: false, error: String(err?.message || err) };
        }
      }

      case "GENERATE_DISAMBIGUATION_LIST": {
        try {
          const { intent, candidates, format } = msg;
          const response = await generateDisambiguationList(intent, candidates, format || 'chat');
          return response;
        } catch (err) {
          return { ok: false, error: String(err?.message || err) };
        }
      }

      // ACCURACY: Store and retrieve disambiguation candidates
      case "STORE_DISAMBIGUATION_CANDIDATES": {
        try {
          const { sessionId, candidates, intent } = msg;
          const actualSessionId = sessionId || getChatSessionId();
          addDisambiguationCandidates(actualSessionId, candidates, intent);
          return { ok: true };
        } catch (err) {
          return { ok: false, error: String(err?.message || err) };
        }
      }

      case "GET_LAST_DISAMBIGUATION_CANDIDATES": {
        try {
          const { sessionId } = msg;
          const actualSessionId = sessionId || getChatSessionId();
          const stored = getLastDisambiguationCandidates(actualSessionId);
          return { ok: true, ...(stored || {}) };
        } catch (err) {
          return { ok: false, error: String(err?.message || err) };
        }
      }

      default:
        return null; // Not handled by chat module
    }
  } catch (err) {
    log('[chat] handler error for', msg?.type, err);
    return { ok: false, error: String(err?.message || err) };
  }
}

// Check if a message type is handled by this module
export function handlesMessageType(type) {
  const chatMessageTypes = [
    'CHAT_OPENED',
    'INDEX_COUNTS',
    'INDEX_QUERY',
    'INDEX_HEALTH',
    'LEXICAL_SEARCH',
    'PREPROCESS_QUERY',
    'PARSE_INTENT',
    'AI_SEARCH',
    'AI_RANK',
    'EXECUTE_ASK',
    'FILTER_AND_RANK',
    'FORMAT_DISAMBIGUATION',
    'GENERATE_CLARIFYING_QUESTION',
    'SAVE_USER_HINT',
    'EXECUTE_ACTION',
    'UNDO_CLOSE',
    'UNDO_ACTION',
    'CHECK_PERMISSIONS',
    'OFFSCREEN_PROMPT',
    'FOCUS_GROUP',
    'CLOSE_GROUP_PREVIEW',
    'CLOSE_GROUP_EXEC',
    'SAVE_GROUP',
    'MOVE_GROUP_TO_WINDOW',
    'GROUP_RENAME',
    'GROUP_COLLAPSE',
    'GROUP_UNGROUP',
    'GENERATE_CONVERSATIONAL_RESPONSE',
    'UNDERSTAND_FOLLOWUP',
    'GENERATE_SUCCESS_RESPONSE',
    'GENERATE_ERROR_RESPONSE',
    'GENERATE_DISAMBIGUATION_LIST'
  ];
  return chatMessageTypes.includes(type);
}

