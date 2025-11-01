// ============================================================================
// TABITHA EXTENSION - POPUP JAVASCRIPT
// ============================================================================
// This file contains all the interactive logic for the Tabitha Chrome extension popup.
// It's organized by feature with clear section headers for easy navigation.
// ============================================================================

const log = (msg, data) => console.log(`[Tabitha::popup] ${msg}`, data ?? "");

// Import ASR and TTS modules for voice functionality
import { createASRManager } from '../features/talk-to-tabs/asr.js';
import { createTTSManager } from '../features/talk-to-tabs/tts.js';

// ============================================================================
// 🎯 MAIN MENU SYSTEM
// ============================================================================
// Handles the main menu button clicks and routing to different features
// ============================================================================
document.querySelectorAll(".item").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const action = btn.dataset.action;
    log(`Clicked: ${action}`);

    // Show voice hub when Talk is clicked (override default send for this one)
    if (action === "talk") {
      openVoiceHub();
    } else if (action === "chat") {
      openChatInterface();
    } else if (action === "organize") {
      openOrganizeInterface();
    } else if (action === "mute") {
      openMuteInterface();
    } else {
      // Placeholder: send to background for future wiring
      chrome.runtime.sendMessage({ type: "UI_ACTION", action }, (res) => {
        log("BG response:", res);
      });
    }

    // Temporary UX feedback
    btn.classList.add("pulse");
    setTimeout(() => btn.classList.remove("pulse"), 250);
  });
});

// Demo keyboard focus - only when main menu is visible
window.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !menu?.classList.contains("hidden")) {
    document.querySelector(".item")?.click();
  }
});

// ============================================================================
// 🎙️ VOICE HUB FEATURE
// ============================================================================
// Handles the "Talk to your Tabs" functionality with voice interface simulation
// Includes: microphone button, live captions toggle, voice states, transcript
// ============================================================================
const menu        = document.querySelector(".menu");
const voiceHub    = document.getElementById("voiceHub");
const chatInterface = document.getElementById("chatInterface");
const switchToChatBtn = document.getElementById("switchToChatBtn");
const liveCaptionsToggle = document.getElementById("liveCaptionsToggle");
const micBtn      = document.getElementById("micBtn");
const thinkingBar = document.getElementById("thinkingBar");
const speakingEQ  = document.getElementById("speakingEQ");
const statusText  = document.getElementById("statusText");
const transcript  = document.getElementById("transcriptArea");

// ============================================================================
// 💬 CHAT INTERFACE FEATURE
// ============================================================================
// Handles the "Chat with your Tabs" functionality with AI-like conversation
// Includes: chat messages, typewriter effects, thinking indicators, input handling
// ============================================================================
const chatBackBtn = document.getElementById("chatBackBtn");
const chatStatusDot = document.getElementById("chatStatusDot");
const chatStatusText = document.getElementById("chatStatusText");
const chatMessages = document.getElementById("chatMessages");
const chatThinkingIndicator = document.getElementById("chatThinkingIndicator");
const chatInput = document.getElementById("chatInput");
const chatSendBtn = document.getElementById("chatSendBtn");
const chatStopBtn = document.getElementById("chatStopBtn");

// Cancellation flag for stopping operations
let isOperationCancelled = false;

// ============================================================================
// 🧩 ORGANIZE TAB BAR FEATURE
// ============================================================================
// Handles the "Organize Tab Bar" functionality with different organizing modes
// Includes: mode selection, organize controls, floating chip, settings
// ============================================================================
const organizeInterface = document.getElementById("organizeInterface");
const organizeBackBtn = document.getElementById("organizeBackBtn");
const organizeStatusDot = document.getElementById("organizeStatusDot");
const organizeStatusText = document.getElementById("organizeStatusText");
const organizeModes = document.getElementById("organizeModes");
const organizeNowBtn = document.getElementById("organizeNowBtn");
const floatingChip = document.getElementById("floatingChip");
const undoOrganizeBtn = document.getElementById("undoOrganizeBtn");

// Smart Suggestions feature has been removed

// ============================================================================
// 🔕 MUTE TABS FEATURE
// ============================================================================
// Handles the "Mute Tabs (Meeting-aware)" functionality with sound control
// Includes: sound indicators, meeting detection, mute controls, toast messages
// ============================================================================
const muteInterface = document.getElementById("muteInterface");
const muteBackBtn = document.getElementById("muteBackBtn");
const muteStatusDot = document.getElementById("muteStatusDot");
const muteStatusText = document.getElementById("muteStatusText");
const soundSummary = document.getElementById("soundSummary");
const soundingTabs = document.getElementById("soundingTabs");
const silentTabs = document.getElementById("silentTabs");
const autoMuteToggle = document.getElementById("autoMuteToggle");
const rememberMuteToggle = document.getElementById("rememberMuteToggle");
const meetingNudge = document.getElementById("meetingNudge");
const muteOthersBtn = document.getElementById("muteOthersBtn");
const ignoreMeetingBtn = document.getElementById("ignoreMeetingBtn");
const toastContainer = document.getElementById("toastContainer");

// ============================================================================
// 📊 STATE MANAGEMENT SYSTEM
// ============================================================================
// Defines all the different states for each feature and global state variables
// ============================================================================
const States = Object.freeze({
  IDLE: "idle",
  LISTENING: "listen",
  THINKING: "think",
  SPEAKING: "speak",
  ERROR: "error",
});

const ChatStates = Object.freeze({
  IDLE: "idle",
  THINKING: "thinking",
  RESPONDING: "responding",
  ERROR: "error",
});

const OrganizeStates = Object.freeze({
  IDLE: "idle",
  ORGANIZING: "organizing",
  COMPLETE: "complete",
  ERROR: "error",
});

const MuteStates = Object.freeze({
  IDLE: "idle",
  MUTING: "muting",
  MEETING_DETECTED: "meeting_detected",
  ERROR: "error",
});

let state = States.IDLE;
let chatState = ChatStates.IDLE;
let organizeState = OrganizeStates.IDLE;
let muteState = MuteStates.IDLE;
let selectedMode = null;
let isInMeeting = false;

// ============================================================================
// 🎙️ VOICE HUB FUNCTIONS
// ============================================================================
// Functions for opening/closing the voice hub and managing voice states
// ============================================================================
function openVoiceHub() {
  if (!voiceHub) return;
  menu?.classList.add("hidden");
  voiceHub.classList.remove("hidden");
  setState(States.IDLE);
  log("Voice hub opened");
}

function closeVoiceHub() {
  voiceHub?.classList.add("hidden");
  menu?.classList.remove("hidden");
  setState(States.IDLE);
  log("Voice hub closed");
}

// ============================================================================
// 💬 CHAT INTERFACE FUNCTIONS
// ============================================================================
// Functions for opening/closing chat interface and managing chat states
// ============================================================================

const WELCOME_MESSAGE = `Hi! 👋 I'm Tabitha, your local AI that helps you manage your tabs.
You can ask me to:
• Open tabs: "open cover letter doc"
• Close tabs: "close all Slack tabs"
• Find tabs: "find my Gmail tab"
• Reopen tabs: "reopen the pricing sheet from this morning"
• Save tabs: "save research tabs for later"
• Show tabs: "show my recent PDFs"
• Ask about tabs: "which notion page did I edit yesterday?"`;

function openChatInterface() {
  if (!chatInterface) return;
  menu?.classList.add("hidden");
  chatInterface.classList.remove("hidden");
  setChatState(ChatStates.IDLE);
  chatInput?.focus();
  log("Chat interface opened");
  
  // Show welcome message if chat only has example messages or is empty
  if (chatMessages) {
    const existingMessages = Array.from(chatMessages.children);
    // Check if we only have the example messages (user + tabitha pairs)
    const hasOnlyExamples = existingMessages.length === 2 && 
                            existingMessages[0].classList.contains('user') &&
                            existingMessages[1].classList.contains('tabitha');
    
    if (hasOnlyExamples || existingMessages.length === 0) {
      // Clear example messages
      chatMessages.innerHTML = '';
      appendMessage('system', WELCOME_MESSAGE);
    }
  }
  
  // Phase 0: Initialize indexer when chat opens (lazy boot)
  chrome.runtime.sendMessage({ type: 'CHAT_OPENED' }, (response) => {
    if (chrome.runtime.lastError) {
      log('Failed to initialize indexer:', chrome.runtime.lastError);
      return;
    }
    if (response?.ok && response.counts) {
      log('Indexer ready. Counts by source:', response.counts);
    }
  });
}

// Append message helper (for welcome/system messages with formatting)
function appendMessage(sender, text) {
  if (!chatMessages) return;
  
  const messageDiv = document.createElement("div");
  messageDiv.className = `message ${sender}`;
  
  const contentDiv = document.createElement("div");
  contentDiv.className = "message-content";
  
  // Format text with line breaks for the welcome message
  if (sender === 'system') {
    contentDiv.innerHTML = text.split('\n').map(line => {
      if (line.trim().startsWith('•')) {
        return `<div style="margin: 4px 0; padding-left: 8px;">${escapeHtml(line)}</div>`;
      }
      return `<div style="margin: 8px 0 4px 0;">${escapeHtml(line)}</div>`;
    }).join('');
  } else {
    contentDiv.textContent = text;
  }
  
  messageDiv.appendChild(contentDiv);
  chatMessages.appendChild(messageDiv);
  
  // Only auto-scroll if user is near bottom (within 100px) - keeps history visible
  const scrollThreshold = 100;
  const isNearBottom = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < scrollThreshold;
  
  if (isNearBottom) {
    // User is near bottom, scroll to show new message
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
  // Otherwise, keep current scroll position (history remains visible)
}

function closeChatInterface() {
  chatInterface?.classList.add("hidden");
  menu?.classList.remove("hidden");
  setChatState(ChatStates.IDLE);
  log("Chat interface closed");
}

// Helper function to generate and add conversational Tabitha messages
async function addConversationalMessage(intent, candidates, query, context, reason = null) {
  try {
    const response = await sendBackgroundMessage({
      type: reason ? 'GENERATE_ERROR_RESPONSE' : 'GENERATE_CONVERSATIONAL_RESPONSE',
      intent,
      candidates,
      query,
      context,
      reason
    });
    
    if (response?.ok && response.text) {
      addChatMessage(response.text, "tabitha");
      return response.text;
    }
  } catch (err) {
    log('Failed to generate conversational message, using fallback:', err);
  }
  
  // Fallback to template messages
  if (reason === 'no_tabs') {
    addChatMessage("You don't have any tabs open right now.", "tabitha");
  } else if (reason === 'parse_failed') {
    addChatMessage("Sorry, I didn't understand that. Could you rephrase?", "tabitha");
  } else if (reason === 'no_matches') {
    addChatMessage(`I couldn't find any tabs matching "${query}". Should I search your history?`, "tabitha");
  } else if (reason === 'not_found') {
    addChatMessage("Couldn't find a tab like that. Want me to open it?", "tabitha");
  } else if (reason === 'ask_failed') {
    addChatMessage("I couldn't answer that question. Could you rephrase?", "tabitha");
  } else if (reason === 'unknown_error') {
    addChatMessage("Sorry, something went wrong. Could you try again?", "tabitha");
  } else if (candidates?.length === 0) {
    addChatMessage(`I couldn't find any tabs matching "${query}". Should I search your history?`, "tabitha");
  } else if (candidates?.length === 1) {
    addChatMessage(`Found it! Opening ${candidates[0]?.card?.title || 'that tab'}...`, "tabitha");
  } else {
    addChatMessage(`I found ${candidates?.length || 0} matching tabs — which one would you like?`, "tabitha");
  }
}

// Helper function to generate and add success messages
async function addSuccessMessage(intent, result, candidate) {
  try {
    const response = await sendBackgroundMessage({
      type: 'GENERATE_SUCCESS_RESPONSE',
      intent,
      result,
      candidate
    });
    
    if (response?.ok && response.text) {
      addChatMessage(response.text, "tabitha");
      return response.text;
    }
  } catch (err) {
    log('Failed to generate success message, using fallback:', err);
  }
  
  // Fallback template
  const tabTitle = candidate?.card?.title || 'tab';
  const tabCount = result?.count || 1;
  const intentName = typeof intent === 'string' ? intent : intent?.intent || 'unknown';
  
  let fallback = '';
  switch (intentName) {
    case 'open':
      fallback = `Opened ${tabTitle}!`;
      break;
    case 'close':
      fallback = `Closed ${tabCount} tab${tabCount > 1 ? 's' : ''}.`;
      break;
    case 'find_open':
      fallback = `Jumped to ${tabTitle}!`;
      break;
    case 'save':
      fallback = `Saved to bookmarks!`;
      break;
    case 'reopen':
      fallback = `Restored ${tabCount} tab${tabCount > 1 ? 's' : ''}!`;
      break;
    default:
      fallback = 'Done!';
  }
  addChatMessage(fallback, "tabitha");
}

// ============================================================================
// 🧩 ORGANIZE INTERFACE FUNCTIONS
// ============================================================================
// Functions for opening/closing organize interface and managing organize states
// ============================================================================
function openOrganizeInterface() {
  if (!organizeInterface) return;
  menu?.classList.add("hidden");
  organizeInterface.classList.remove("hidden");
  setOrganizeState(OrganizeStates.IDLE);
  log("Organize interface opened");
}

function closeOrganizeInterface() {
  organizeInterface?.classList.add("hidden");
  menu?.classList.remove("hidden");
  setOrganizeState(OrganizeStates.IDLE);
  selectedMode = null;
  updateOrganizeButton();
  log("Organize interface closed");
}

// Smart Suggestions functions have been removed

// ============================================================================
// 🔕 MUTE TABS FUNCTIONS
// ============================================================================
// Functions for opening/closing mute interface and managing mute states
// ============================================================================
function openMuteInterface() {
  if (!muteInterface) return;
  menu?.classList.add("hidden");
  muteInterface.classList.remove("hidden");
  setMuteState(MuteStates.IDLE);
  
  // Load real data from background script
  refreshMuteDashboard();
  
  // Check for meeting detection snackbar (fallback if notifications blocked)
  chrome.storage.local.get(['__tabithaMeetingDetected', '__tabithaMeetingMutedCount'], (result) => {
    if (result.__tabithaMeetingDetected) {
      const age = Date.now() - result.__tabithaMeetingDetected;
      const fiveMinutes = 5 * 60 * 1000;
      if (age < fiveMinutes) {
        // Show snackbar
        showMeetingSnackbar(result.__tabithaMeetingMutedCount || 0);
      } else {
        // Expired, clean up
        chrome.storage.local.remove(['__tabithaMeetingDetected', '__tabithaMeetingMutedCount']);
      }
    }
  });
  
  log("Mute interface opened");
}

// Show meeting snackbar (fallback when notifications are blocked)
function showMeetingSnackbar(mutedCount) {
  if (!toastContainer) return;
  
  const snackbar = document.createElement('div');
  snackbar.className = 'meeting-snackbar';
  snackbar.innerHTML = `
    <span class="snackbar-text">🎙️ Meeting detected — Muted ${mutedCount} tab${mutedCount !== 1 ? 's' : ''} • <button class="snackbar-unmute">Unmute</button></span>
  `;
  
  toastContainer.appendChild(snackbar);
  
  // Auto-dismiss after 10 seconds
  setTimeout(() => {
    snackbar.remove();
  }, 10000);
  
  // Handle unmute button
  snackbar.querySelector('.snackbar-unmute')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'UNMUTE_ALL_AUTOMUTED' });
    chrome.storage.local.remove(['__tabithaMeetingDetected', '__tabithaMeetingMutedCount']);
    snackbar.remove();
  });
}

function closeMuteInterface() {
  muteInterface?.classList.add("hidden");
  menu?.classList.remove("hidden");
  setMuteState(MuteStates.IDLE);
  log("Mute interface closed");
}

// ============================================================================
// 📊 STATE MANAGEMENT FUNCTIONS
// ============================================================================
// Functions for updating UI states across all features
// ============================================================================
function setState(next) {
  state = next;

  // Only update voice hub elements if voice hub is visible
  if (voiceHub && !voiceHub.classList.contains("hidden")) {
    // reset classes/sections
    voiceHub?.classList.remove("state-idle", "state-listen", "state-think", "state-speak", "state-error");
    micBtn?.classList.remove("is-listening");
    thinkingBar?.classList.add("hidden");
    speakingEQ?.classList.add("hidden");

    switch (state) {
      case States.IDLE:
        voiceHub?.classList.add("state-idle");
        if (statusText) statusText.textContent = "Idle";
        break;

      case States.LISTENING:
        voiceHub?.classList.add("state-listen");
        if (statusText) statusText.textContent = "Listening";
        micBtn?.classList.add("is-listening");
        break;

      case States.THINKING:
        voiceHub?.classList.add("state-think");
        if (statusText) statusText.textContent = "Thinking";
        thinkingBar?.classList.remove("hidden");
        break;

      case States.SPEAKING:
        voiceHub?.classList.add("state-speak");
        if (statusText) statusText.textContent = "Speaking";
        speakingEQ?.classList.remove("hidden");
        break;

      case States.ERROR:
        voiceHub?.classList.add("state-error");
        if (statusText) statusText.textContent = "Error";
        break;
    }
  }
}

function setChatState(next) {
  chatState = next;

  // Only update chat interface elements if chat interface is visible
  if (chatInterface && !chatInterface.classList.contains("hidden")) {
    // reset classes/sections
    chatStatusDot?.classList.remove("state-idle", "state-thinking", "state-responding", "state-error");
    chatThinkingIndicator?.classList.add("hidden");
    chatSendBtn?.removeAttribute("disabled");

    switch (chatState) {
      case ChatStates.IDLE:
        chatStatusDot?.classList.add("state-idle");
        if (chatStatusText) chatStatusText.textContent = "Idle";
        chatSendBtn?.removeAttribute("disabled");
        chatSendBtn?.classList.remove("hidden");
        chatStopBtn?.classList.add("hidden");
        isOperationCancelled = false;
        break;

      case ChatStates.THINKING:
        chatStatusDot?.classList.add("state-thinking");
        if (chatStatusText) chatStatusText.textContent = "Thinking";
        chatThinkingIndicator?.classList.remove("hidden");
        chatSendBtn?.setAttribute("disabled", "true");
        chatSendBtn?.classList.add("hidden");
        chatStopBtn?.classList.remove("hidden");
        break;

      case ChatStates.RESPONDING:
        chatStatusDot?.classList.add("state-responding");
        if (chatStatusText) chatStatusText.textContent = "Responding";
        chatSendBtn?.setAttribute("disabled", "true");
        break;

    case ChatStates.ERROR:
      chatStatusDot?.classList.add("state-error");
      if (chatStatusText) chatStatusText.textContent = "Error";
      break;
    }
  }
}

function setOrganizeState(next) {
  organizeState = next;

  // Only update organize interface elements if organize interface is visible
  if (organizeInterface && !organizeInterface.classList.contains("hidden")) {
    // Update status dot and text
    if (organizeStatusDot) {
      organizeStatusDot.style.background = 
        next === OrganizeStates.IDLE ? "#53D3B0" :
        next === OrganizeStates.ORGANIZING ? "#C96676" :
        next === OrganizeStates.COMPLETE ? "#53D3B0" :
        "#E05B5B";
    }

    if (organizeStatusText) {
      organizeStatusText.textContent = 
        next === OrganizeStates.IDLE ? "Ready to organize" :
        next === OrganizeStates.ORGANIZING ? "Organizing tabs..." :
        next === OrganizeStates.COMPLETE ? "All organized! ✨" :
        "Something went wrong";
    }

    // Update organize button state
    if (organizeNowBtn) {
      organizeNowBtn.disabled = next === OrganizeStates.ORGANIZING || !selectedMode;
    }
  }
}

// setSuggestionState function has been removed

function setMuteState(next) {
  muteState = next;

  // Only update mute interface elements if mute interface is visible
  if (muteInterface && !muteInterface.classList.contains("hidden")) {
    // Update status dot and text
    if (muteStatusDot) {
      muteStatusDot.style.background = 
        next === MuteStates.IDLE ? "#53D3B0" :
        next === MuteStates.MUTING ? "#C96676" :
        next === MuteStates.MEETING_DETECTED ? "#7B61FF" :
        "#E05B5B";
    }

    if (muteStatusText) {
      muteStatusText.textContent = 
        next === MuteStates.IDLE ? "Sound control ready" :
        next === MuteStates.MUTING ? "Muting tabs..." :
        next === MuteStates.MEETING_DETECTED ? "Meeting detected" :
        "Something went wrong";
    }
  }
}

// ============================================================================
// 🎙️ VOICE HUB EVENT LISTENERS
// ============================================================================
// Event listeners for voice hub interactions
// ============================================================================
switchToChatBtn?.addEventListener("click", () => {
  // Close voice hub and trigger chat functionality
  closeVoiceHub();
  // Trigger the chat action
  const chatBtn = document.querySelector('[data-action="chat"]');
  if (chatBtn) {
    chatBtn.click();
  }
});

// ============================================================================
// 💬 CHAT INTERFACE EVENT LISTENERS
// ============================================================================
// Event listeners for chat interface interactions
// ============================================================================
chatBackBtn?.addEventListener("click", closeChatInterface);

// ============================================================================
// 💬 CHAT WORKFLOW: Full pipeline implementation
// ============================================================================

// Chat workflow state
let currentQuery = '';
let currentIntent = null;
let currentCandidates = [];
let pendingDisambiguation = null;
let lastTabithaResponse = null; // Store last Tabitha response for follow-up context

// Send message functionality - Full workflow
async function sendMessage() {
  const message = chatInput?.value.trim();
  if (!message || chatState !== ChatStates.IDLE) return;

  currentQuery = message;
  currentIntent = null;
  currentCandidates = [];

  // Add user message
  addChatMessage(message, "user");
  chatInput.value = "";

  // Check for greetings/conversational messages
  const lowerMessage = message.toLowerCase().trim();
  const greetings = ['hi', 'hello', 'hey', 'hi!', 'hello!', 'hey!', 'hii', 'hiii'];
  const conversational = greetings.includes(lowerMessage) || 
                         lowerMessage === 'how are you' || 
                         lowerMessage.startsWith('how are you');
  
  if (conversational || lowerMessage.length < 3) {
    // Handle greetings or very short messages
    showThinkingIndicator(true);
    setTimeout(() => {
      showThinkingIndicator(false);
      const responses = [
        "Hi! 👋 I can help you find, open, close, or organize your tabs. Try: \"open google docs\" or \"find my research tabs\"",
        "Hello! What can I help you with? Try asking me to open, close, or find tabs.",
        "Hey there! Tell me what you'd like to do with your tabs. For example: \"show tabs about AI\" or \"close youtube tabs\""
      ];
      const randomResponse = responses[Math.floor(Math.random() * responses.length)];
      addChatMessage(randomResponse, "tabitha");
      setChatState(ChatStates.IDLE);
    }, 500);
    return;
  }

  // ACCURACY: Check if this is a follow-up to previous disambiguation
  if (pendingDisambiguation) {
    const followUp = await sendBackgroundMessage({
      type: 'UNDERSTAND_FOLLOWUP',
      previousQuery: currentQuery || pendingDisambiguation.intent.query,
      previousResponse: lastTabithaResponse || '',
      candidates: pendingDisambiguation.candidates,
      newMessage: message,
      sessionId: 'default_chat_session'
    });
    
    // ACCURACY: Use cardId directly if provided, otherwise fallback to index
    if (followUp?.ok && followUp.action === 'select') {
      let selectedCardId = null;
      
      if (followUp.cardId) {
        // Use cardId directly (most accurate)
        selectedCardId = followUp.cardId;
      } else if (followUp.tabNumber) {
        // Fallback to index-based lookup
        const selectedCandidate = pendingDisambiguation.candidates[followUp.tabNumber - 1];
        selectedCardId = selectedCandidate?.card?.cardId;
      }
      
      if (selectedCardId) {
        await executeAction(
          pendingDisambiguation.intent.intent,
          selectedCardId
        );
        // Generate success message
        await addSuccessMessage(
          pendingDisambiguation.intent,
          { ok: true },
          selectedCandidate
        );
        pendingDisambiguation = null;
        lastTabithaResponse = null;
        setChatState(ChatStates.IDLE);
        showThinkingIndicator(false);
        return;
      }
    } else if (followUp?.ok && followUp.action === 'confirm' && followUp.confirmation) {
      // Handle confirmations (for close, save, etc.)
      // This will be handled per-intent in executeAction
    } else if (followUp?.ok && followUp.action === 'cancel') {
      // User cancelled
      await addConversationalMessage(null, null, message, null, 'unknown_error');
      pendingDisambiguation = null;
      lastTabithaResponse = null;
      setChatState(ChatStates.IDLE);
      showThinkingIndicator(false);
      return;
    }
    // If unclear, continue with normal flow (will re-disambiguate if needed)
    pendingDisambiguation = null;
    lastTabithaResponse = null;
  }

  // Reset cancellation flag
  isOperationCancelled = false;
  
  // Set thinking state
  setChatState(ChatStates.THINKING);
  showThinkingIndicator(true);

  // Generate unique requestId for this message flow
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  try {
    // SPEED OPTIMIZATION: Run intent parsing + lexical search IN PARALLEL
    // Step 0: Check if any tabs are open (early return)
    const allTabs = await chrome.tabs.query({});
    if (allTabs.length === 0) {
      await addConversationalMessage(null, [], message, null, 'no_tabs');
      setChatState(ChatStates.IDLE);
      showThinkingIndicator(false);
      return;
    }
    
    // Step 1: Run intent parsing and lexical search IN PARALLEL for speed
    const [intentResult, lexicalResult] = await Promise.all([
      sendBackgroundMessage({ 
        type: 'PARSE_INTENT', 
        text: message,
        sessionId: 'default_chat_session',
        requestId
      }),
      // Start lexical search immediately (doesn't need intent)
      sendBackgroundMessage({
        type: 'LEXICAL_SEARCH',
        query: message,
        limit: 20,
        filters: {}, // Will filter later based on intent
        requestId
      })
    ]);
    
    if (isOperationCancelled) {
      setChatState(ChatStates.IDLE);
      showThinkingIndicator(false);
      return;
    }
    
    // ACCURACY: Check for anaphora first (before intent parsing)
    const lowerMessage = message.toLowerCase().trim();
    const anaphoraWords = ['those', 'them', 'it', 'that', 'these', 'this'];
    const isAnaphora = anaphoraWords.some(word => lowerMessage === word || lowerMessage.startsWith(word + ' '));
    
    let currentIntent;
    if (isAnaphora) {
      // ACCURACY: Get previous candidates for anaphora resolution
      const lastCandidates = await sendBackgroundMessage({
        type: 'GET_LAST_DISAMBIGUATION_CANDIDATES',
        sessionId: 'default_chat_session'
      });
      
      if (lastCandidates?.candidates && lastCandidates.candidates.length > 0) {
        // Use previous intent and candidates
        currentIntent = {
          ...lastCandidates.intent,
          anaphora_of: 'previous',
          notes: 'anaphora_resolved'
        };
        log('Anaphora detected, using previous candidates:', lastCandidates.candidates.length);
      } else {
        // Fallback: assume close intent for "those/them"
        currentIntent = { intent: 'close', canonical_query: '', constraints: { resultMustBeOpen: true, includeApps: [], excludeApps: [], scope: null, group: null, limit: null, dateRange: null }, operation: null, operation_args: null, folderName: null, disambiguationNeeded: true, hints: [], anaphora_of: null, time_reason: null, notes: 'anaphora_fallback' };
      }
    } else if (!intentResult?.ok || !intentResult.intent) {
      // ACCURACY: Fast fallback with question word detection BEFORE action words
      const lower = message.toLowerCase();
      let fallbackIntent = { intent: 'find_open', canonical_query: message, constraints: { resultMustBeOpen: true, includeApps: [], excludeApps: [], scope: null, group: null, limit: null, dateRange: null }, operation: null, operation_args: null, folderName: null, disambiguationNeeded: false, hints: [], anaphora_of: null, time_reason: null, notes: 'fast_fallback' };
      
      // Check for question words FIRST (what/how/when/where/which) - these are questions, not actions
      if (/^(what|how|when|where|which|tell me about|describe)/.test(lower)) {
        fallbackIntent.intent = 'ask';
      } else if (/^(open|go to|jump to|switch to|take me to|show me)/.test(lower)) {
        fallbackIntent.intent = 'open';
      } else if (/^(close|remove|delete)/.test(lower)) {
        fallbackIntent.intent = 'close';
      } else if (/^(find|locate|where)/.test(lower)) {
        fallbackIntent.intent = 'find_open';
      } else if (/^(save|bookmark)/.test(lower)) {
        fallbackIntent.intent = 'save';
      } else if (/^(list|show|display)/.test(lower)) {
        fallbackIntent.intent = 'list';
      }
      
      currentIntent = fallbackIntent;
      log('Using fast fallback intent:', currentIntent.intent);
    } else {
      currentIntent = intentResult.intent;
      log('Parsed intent:', currentIntent);
    }
    
    // Filter lexical results based on intent (if we got results)
    let filteredLexicalResults = lexicalResult?.results || [];
    if (currentIntent.constraints?.resultMustBeOpen === true && filteredLexicalResults.length > 0) {
      filteredLexicalResults = filteredLexicalResults.filter(c => c.card?.source === 'tab');
    }
    
    if (isOperationCancelled) {
      setChatState(ChatStates.IDLE);
      showThinkingIndicator(false);
      return;
    }
    
    // Handle "ask" intent specially - use conversational AI
    if (currentIntent.intent === 'ask') {
      if (isOperationCancelled) {
        setChatState(ChatStates.IDLE);
        showThinkingIndicator(false);
        return;
      }
      
      const askResult = await sendBackgroundMessage({
        type: 'EXECUTE_ASK',
        query: currentIntent.query || message,
        intent: currentIntent,
        sessionId: 'default_chat_session',
        requestId
      });
      
      if (isOperationCancelled) {
        setChatState(ChatStates.IDLE);
        showThinkingIndicator(false);
        return;
      }
      
      if (askResult?.ok && askResult.answer) {
        addChatMessage(askResult.answer, "tabitha");
        setChatState(ChatStates.IDLE);
        showThinkingIndicator(false);
      } else {
        await addConversationalMessage(currentIntent, [], message, null, 'ask_failed');
        setChatState(ChatStates.IDLE);
        showThinkingIndicator(false);
      }
      return;
    }

    // Step 2: Use filtered lexical results if available, otherwise try AI search on small set
    let candidatesForFiltering = [];
    
    if (filteredLexicalResults.length > 0) {
      // Use filtered lexical results (fast - already narrowed down)
      candidatesForFiltering = filteredLexicalResults;
    } else {
      // No lexical matches - try AI search but only on open tabs if resultMustBeOpen
      if (isOperationCancelled) {
        setChatState(ChatStates.IDLE);
        showThinkingIndicator(false);
        return;
      }
      
      const searchResult = await sendBackgroundMessage({
        type: 'AI_SEARCH',
        query: currentIntent.query || message,
        intent: currentIntent,
        sessionId: 'default_chat_session',
        limit: 15, // Smaller limit for speed
        lexicalResultCount: lexicalResult?.results?.length || 0, // Pass lexical count for conditional semantic search
        requestId
      });

      if (isOperationCancelled) {
        setChatState(ChatStates.IDLE);
        showThinkingIndicator(false);
        return;
      }

      if (searchResult?.ok && searchResult.results?.length > 0) {
        candidatesForFiltering = searchResult.results;
      } else {
        // No matches at all - check if it's an open intent to offer opening
        if (currentIntent.intent === 'open' || currentIntent.intent === 'find_open') {
          showOpenConfirmation(currentIntent.query || message, currentIntent);
        } else {
          await addConversationalMessage(currentIntent, [], message, null, 'no_matches');
        }
        setChatState(ChatStates.IDLE);
        showThinkingIndicator(false);
        return;
      }
    }

    // Step 3: Filter and rank candidates (AI semantic ranking on narrowed set)
    if (isOperationCancelled) {
      setChatState(ChatStates.IDLE);
      showThinkingIndicator(false);
      return;
    }
    
    const filterResult = await sendBackgroundMessage({
      type: 'FILTER_AND_RANK',
      intent: currentIntent,
      lexicalResults: candidatesForFiltering,
      query: currentIntent.query || message,
      sessionId: 'default_chat_session',
      requestId
    });

      if (isOperationCancelled) {
        setChatState(ChatStates.IDLE);
        showThinkingIndicator(false);
        return;
      }

      if (!filterResult?.ok) {
        // Handle errors (no candidates, too many, etc.)
        if (filterResult.reason === 'no_candidates') {
          // Show closest matches if available
          if (filterResult.closestMatches && filterResult.closestMatches.length > 0) {
            await addConversationalMessage(currentIntent, filterResult.closestMatches, message, null);
            showDisambiguation(filterResult.closestMatches, currentIntent);
          } else {
            // No matches - offer to open if it's an open intent
            if (currentIntent.intent === 'open' || currentIntent.intent === 'find_open') {
              showOpenConfirmation(currentIntent.query || message, currentIntent);
            } else {
              await addConversationalMessage(currentIntent, [], message, null, 'not_found');
            }
          }
        } else if (filterResult.reason === 'too_many_candidates') {
          showClarifier(filterResult.clarifier, filterResult.candidates);
        }
        setChatState(ChatStates.IDLE);
        showThinkingIndicator(false);
        return;
      }
      
      // SPEED: Handle auto-execution for single strong match - execute immediately
      if (filterResult.autoExecute && filterResult.candidate) {
        showThinkingIndicator(false);
        
        // Generate conversational success message (non-blocking)
        const successMsgPromise = addSuccessMessage(currentIntent, { ok: true }, filterResult.candidate);
        
        // Execute action immediately (don't wait for message)
        executeAction(currentIntent.intent, filterResult.candidate.card.cardId, false, currentIntent);
        
        // Show success message when ready
        await successMsgPromise;
        
        setChatState(ChatStates.IDLE);
        return;
      }
      
      // Step 4: Show disambiguation or execute directly
      const candidates = filterResult.candidates || [];
      
      if (candidates.length === 0) {
        // No matches - offer to open if it's an open intent
        if (currentIntent.intent === 'open' || currentIntent.intent === 'find_open') {
          showOpenConfirmation(currentIntent.query || message, currentIntent);
        } else {
          addChatMessage("Couldn't find a tab like that. Want me to open it?", "tabitha");
        }
        setChatState(ChatStates.IDLE);
        showThinkingIndicator(false);
        return;
      }

      // Check for group intent - show all tabs in group as cards
      if ((currentIntent.constraints?.scope === 'group' || currentIntent.constraints?.group) && 
          currentIntent.intent === 'open') {
        const groupName = currentIntent.constraints?.group || '';
        handleGroupOpenIntent(groupName, candidates, currentIntent);
        setChatState(ChatStates.IDLE);
        showThinkingIndicator(false);
        return;
      }

      // Handle group operations with operation field (execute directly, no disambiguation)
      if (currentIntent.intent === 'list' && currentIntent.operation && currentIntent.constraints?.scope === 'group') {
        // Group operation - execute directly with the full intent object
        executeAction('list', null, false, currentIntent);
        setChatState(ChatStates.IDLE);
        showThinkingIndicator(false);
        return;
      }
      
      // For bulk actions (mute, unmute, pin, unpin, reload, discard, close), 
      // execute directly if we have matches (no disambiguation needed for these)
      const bulkActions = ['mute', 'unmute', 'pin', 'unpin', 'reload', 'discard', 'close'];
      
      if (candidates.length === 1 && currentIntent.intent !== 'show' && currentIntent.intent !== 'list') {
        // Single match - execute directly
        executeAction(currentIntent.intent, candidates[0].card.cardId);
      } else if (bulkActions.includes(currentIntent.intent) && candidates.length > 0) {
        // Bulk actions with multiple matches - execute on all (no disambiguation needed)
        const cardIds = candidates.map(c => c.card.cardId);
        executeAction(currentIntent.intent, cardIds);
      } else if (candidates.length > 1) {
        // Multiple matches - show disambiguation (for non-bulk actions, or list without operation)
        showDisambiguation(candidates, currentIntent);
      } else if (candidates.length === 0 && bulkActions.includes(currentIntent.intent)) {
        // No matches but bulk action - try executing with constraints (action executor will query tabs)
        executeAction(currentIntent.intent, [], false, currentIntent);
      } else if (candidates.length === 0) {
        // No matches - offer to open if it's an open intent
        if (currentIntent.intent === 'open' || currentIntent.intent === 'find_open') {
          showOpenConfirmation(currentIntent.query || message, currentIntent);
        } else if (currentIntent.intent === 'list' || currentIntent.intent === 'show') {
          // For list/show with no matches, just show empty list message
          await addConversationalMessage(currentIntent, [], message, null, 'no_matches');
        } else {
          await addConversationalMessage(currentIntent, [], message, null, 'no_matches');
        }
        setChatState(ChatStates.IDLE);
        showThinkingIndicator(false);
        return;
      } else if (candidates.length === 1 && (currentIntent.intent === 'list' || currentIntent.intent === 'show')) {
        // Single match for list/show - show it
        executeAction(currentIntent.intent, candidates[0].card.cardId);
      }

      setChatState(ChatStates.IDLE);
      showThinkingIndicator(false);

  } catch (err) {
    log('Chat workflow error:', err);
    await addConversationalMessage(null, [], null, null, 'unknown_error');
    setChatState(ChatStates.IDLE);
    showThinkingIndicator(false);
  }
}

// Helper: Send message to background and wait for response
function sendBackgroundMessage(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response) {
        reject(new Error('No response from background'));
        return;
      }
      resolve(response);
    });
  });
}

// Helper: Show thinking indicator
function showThinkingIndicator(show) {
  const indicator = document.getElementById('chatThinkingIndicator');
  if (indicator) {
    if (show) {
      indicator.classList.remove('hidden');
    } else {
      indicator.classList.add('hidden');
    }
  }
}

chatSendBtn?.addEventListener("click", sendMessage);

// Stop button handler
chatStopBtn?.addEventListener("click", async () => {
  isOperationCancelled = true;
  setChatState(ChatStates.IDLE);
  showThinkingIndicator(false);
  await addSuccessMessage('cancelled', { ok: true, action: 'cancelled' }, null);
});

// Chat input Enter key handler
chatInput?.addEventListener("keypress", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (chatState === ChatStates.IDLE) {
      sendMessage();
    }
  }
});

// Add message to chat
function addChatMessage(text, sender) {
  if (!chatMessages) return;
  
  const messageDiv = document.createElement("div");
  messageDiv.className = `message ${sender}`;
  
  const contentDiv = document.createElement("div");
  contentDiv.className = "message-content";
  contentDiv.textContent = text;
  
  messageDiv.appendChild(contentDiv);
  chatMessages.appendChild(messageDiv);
  
  // Scroll to bottom
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Add message with typewriter effect
function addChatMessageWithTypewriter(text, sender) {
  if (!chatMessages) return;
  
  const messageDiv = document.createElement("div");
  messageDiv.className = `message ${sender} typing`;
  
  const contentDiv = document.createElement("div");
  contentDiv.className = "message-content";
  
  messageDiv.appendChild(contentDiv);
  chatMessages.appendChild(messageDiv);
  
  // Only scroll if near bottom (keeps history visible)
  const scrollThreshold = 100;
  const isNearBottom = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < scrollThreshold;
  if (isNearBottom) {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
  
  // Typewriter effect
  let i = 0;
  const typeInterval = setInterval(() => {
    if (i < text.length) {
      contentDiv.textContent += text.charAt(i);
      i++;
      // Only scroll if near bottom
      const isNearBottomNow = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < scrollThreshold;
      if (isNearBottomNow) {
        chatMessages.scrollTop = chatMessages.scrollHeight;
      }
    } else {
      clearInterval(typeInterval);
      messageDiv.classList.remove("typing");
      setChatState(ChatStates.IDLE);
    }
  }, 30);
}

// ============================================================================
// 💬 DISAMBIGUATION UI
// ============================================================================

// Show disambiguation list with candidates
function showDisambiguation(candidates, intent) {
  // ACCURACY: Store disambiguation candidates for follow-up understanding
  sendBackgroundMessage({
    type: 'STORE_DISAMBIGUATION_CANDIDATES',
    sessionId: 'default_chat_session',
    candidates: candidates,
    intent: intent
  }).catch(() => {}); // Fire and forget
  
  // Update pending disambiguation state
  pendingDisambiguation = { candidates, intent };
  if (!chatMessages || !candidates?.length) return;

  const messageDiv = document.createElement("div");
  messageDiv.className = "message tabitha";
  
  const contentDiv = document.createElement("div");
  contentDiv.className = "message-content";
  
  // Track selected card
  let selectedCardId = null;
  
  // Helper to update button states
  const updateButtonStates = () => {
    if (selectedCardId) {
      primaryBtn.disabled = false;
      if (secondaryBtn) secondaryBtn.disabled = false;
    } else {
      primaryBtn.disabled = true;
      if (secondaryBtn) secondaryBtn.disabled = true;
    }
  };
  
  // Helper to handle card selection
  const handleCardSelect = (cardId, itemElement) => {
    // Remove selection from all cards
    list.querySelectorAll('.candidate-item').forEach(item => {
      item.classList.remove('selected');
    });
    
    // Add selection to clicked card
    itemElement.classList.add('selected');
    selectedCardId = cardId;
    
    // Enable buttons
    updateButtonStates();
  };
  
  // Header text - generate via Prompt API (async, show cards first)
  const header = document.createElement("div");
  header.className = "disambiguation-header";
  header.textContent = "Finding matches..."; // Placeholder while generating
  contentDiv.appendChild(header);
  
  // Generate conversational header asynchronously (don't block UI)
  (async () => {
    try {
      const headerResponse = await sendBackgroundMessage({
        type: 'GENERATE_DISAMBIGUATION_LIST',
        intent,
        candidates,
        format: 'chat'
      });
      
      if (headerResponse?.ok && headerResponse.text) {
        header.textContent = headerResponse.text;
        lastTabithaResponse = headerResponse.text; // Store for follow-up context
      } else {
        // Fallback to template
        const domain = candidates[0]?.card?.domain || '';
        if (intent.intent === 'open' || intent.intent === 'find_open') {
          if (candidates.length === 1) {
            header.textContent = `I found 1 match — ${candidates[0].card.title || 'Untitled'}?`;
          } else {
            header.textContent = `You have ${candidates.length} ${domain || 'matching tabs'} open — which one?`;
          }
        } else {
          header.textContent = candidates.length === 1 
            ? `I found 1 match — ${candidates[0].card.title || 'Untitled'}?`
            : `I found ${candidates.length} matches — which one did you mean?`;
        }
        lastTabithaResponse = header.textContent;
      }
    } catch (err) {
      log('Failed to generate disambiguation header, using fallback:', err);
      // Fallback template
      const domain = candidates[0]?.card?.domain || '';
      header.textContent = candidates.length === 1 
        ? `I found 1 match — ${candidates[0].card.title || 'Untitled'}?`
        : `You have ${candidates.length} ${domain || 'matching tabs'} open — which one?`;
      lastTabithaResponse = header.textContent;
    }
  })();
  
  // Candidate list
  const list = document.createElement("div");
  list.className = "disambiguation-list";
  
  candidates.forEach((candidate, index) => {
    const item = createCandidateItem(candidate, index, handleCardSelect);
    list.appendChild(item);
  });
  
  contentDiv.appendChild(list);
  
  // Action buttons block: Primary, Secondary
  const buttons = document.createElement("div");
  buttons.className = "disambiguation-actions";
  
  // Primary button
  const primaryBtn = document.createElement("button");
  primaryBtn.className = "action-btn primary";
  primaryBtn.disabled = true; // Disabled until card selected
  
  // Secondary button (for open intent)
  let secondaryBtn = null;
  
  // Set button text and actions based on intent
  if (intent.intent === 'open') {
    primaryBtn.textContent = "Open Tab";
    primaryBtn.onclick = () => {
      if (selectedCardId) {
        executeAction('open', selectedCardId);
      }
    };
    
    secondaryBtn = document.createElement("button");
    secondaryBtn.className = "action-btn primary"; // Same style as primary
    secondaryBtn.textContent = "Open Tab Next to Current";
    secondaryBtn.disabled = true; // Disabled until card selected
    secondaryBtn.onclick = () => {
      if (selectedCardId) {
        executeAction('open', selectedCardId, true);
      }
    };
    
    buttons.appendChild(primaryBtn);
    buttons.appendChild(secondaryBtn);
  } else if (intent.intent === 'show' || intent.intent === 'list') {
    primaryBtn.textContent = "Show All";
    primaryBtn.onclick = () => executeAction('show', candidates.map(c => c.card.cardId));
    
    buttons.appendChild(primaryBtn);
  } else if (intent.intent === 'close') {
    primaryBtn.textContent = `Close ${candidates.length} Tab${candidates.length > 1 ? 's' : ''}`;
    primaryBtn.onclick = () => {
      const tabIds = candidates.filter(c => c.card.source === 'tab' && c.card.tabId)
                               .map(c => c.card.tabId);
      if (tabIds.length > 0) {
        executeCloseAction({ tabIds });
      } else {
        const firstCard = candidates[0].card;
        executeCloseAction({ url: firstCard.url, domain: firstCard.domain });
      }
    };
    
    buttons.appendChild(primaryBtn);
  } else if (intent.intent === 'find_open') {
    primaryBtn.textContent = "Find";
    primaryBtn.onclick = () => {
      if (selectedCardId) {
        executeAction('find_open', selectedCardId);
      }
    };
    
    buttons.appendChild(primaryBtn);
  } else if (intent.intent === 'reopen') {
    primaryBtn.textContent = "Reopen";
    primaryBtn.onclick = () => {
      if (selectedCardId) {
        executeAction('reopen', selectedCardId);
      }
    };
    
    buttons.appendChild(primaryBtn);
  } else if (intent.intent === 'save') {
    primaryBtn.textContent = `Save ${candidates.length} Tab${candidates.length > 1 ? 's' : ''}`;
    primaryBtn.disabled = false; // Save doesn't need selection
    primaryBtn.onclick = () => executeAction('save', candidates.map(c => c.card.cardId));
    
    buttons.appendChild(primaryBtn);
  } else if (intent.intent === 'mute') {
    primaryBtn.textContent = `Mute ${candidates.length} Tab${candidates.length > 1 ? 's' : ''}`;
    primaryBtn.disabled = false; // Mute doesn't need selection
    primaryBtn.onclick = () => executeAction('mute', candidates.map(c => c.card.cardId));
    
    buttons.appendChild(primaryBtn);
  } else if (intent.intent === 'unmute') {
    primaryBtn.textContent = `Unmute ${candidates.length} Tab${candidates.length > 1 ? 's' : ''}`;
    primaryBtn.disabled = false; // Unmute doesn't need selection
    primaryBtn.onclick = () => executeAction('unmute', candidates.map(c => c.card.cardId));
    
    buttons.appendChild(primaryBtn);
  } else if (intent.intent === 'pin') {
    primaryBtn.textContent = `Pin ${candidates.length} Tab${candidates.length > 1 ? 's' : ''}`;
    primaryBtn.disabled = false; // Pin doesn't need selection
    primaryBtn.onclick = () => executeAction('pin', candidates.map(c => c.card.cardId));
    
    buttons.appendChild(primaryBtn);
  } else if (intent.intent === 'unpin') {
    primaryBtn.textContent = `Unpin ${candidates.length} Tab${candidates.length > 1 ? 's' : ''}`;
    primaryBtn.disabled = false; // Unpin doesn't need selection
    primaryBtn.onclick = () => executeAction('unpin', candidates.map(c => c.card.cardId));
    
    buttons.appendChild(primaryBtn);
  } else if (intent.intent === 'reload') {
    primaryBtn.textContent = `Reload ${candidates.length} Tab${candidates.length > 1 ? 's' : ''}`;
    primaryBtn.disabled = false; // Reload doesn't need selection
    primaryBtn.onclick = () => executeAction('reload', candidates.map(c => c.card.cardId));
    
    buttons.appendChild(primaryBtn);
  } else if (intent.intent === 'discard') {
    primaryBtn.textContent = `Discard ${candidates.length} Tab${candidates.length > 1 ? 's' : ''}`;
    primaryBtn.disabled = false; // Discard doesn't need selection
    primaryBtn.onclick = () => executeAction('discard', candidates.map(c => c.card.cardId));
    
    buttons.appendChild(primaryBtn);
  } else {
    // Default: open intent behavior
    primaryBtn.textContent = "Open Tab";
    primaryBtn.onclick = () => {
      if (selectedCardId) {
        executeAction('open', selectedCardId);
      }
    };
    
    buttons.appendChild(primaryBtn);
  }
  
  // Add group-level action buttons if scope is 'group' or candidates share a group
  const isGroupScope = intent?.constraints?.scope === 'group';
  const sharedGroup = candidates.length > 0 && candidates.every(c => 
    c.card.groupName && c.card.groupName === candidates[0].card.groupName
  ) ? candidates[0].card.groupName : null;
  
  if (isGroupScope || sharedGroup) {
    const groupName = intent?.constraints?.group || sharedGroup;
    
    // Group action buttons
    const groupActions = document.createElement("div");
    groupActions.className = "disambiguation-actions";
    groupActions.style.marginTop = "8px";
    
    // Focus group button
    if (intent.intent === 'find_open' || intent.intent === 'open') {
      const focusBtn = document.createElement("button");
      focusBtn.className = "action-btn secondary";
      focusBtn.textContent = "Focus Group";
      focusBtn.onclick = () => {
        chrome.runtime.sendMessage({ type: "FOCUS_GROUP", groupName }, async (res) => {
          if (res?.ok) {
            await addSuccessMessage('find_open', { ok: true, groupName }, null);
          } else {
            await addConversationalMessage('find_open', [], null, null, 'unknown_error');
          }
        });
      };
      groupActions.appendChild(focusBtn);
    }
    
    // Close group button
    if (intent.intent === 'close' || isGroupScope) {
      const closeGroupBtn = document.createElement("button");
      closeGroupBtn.className = "action-btn secondary";
      closeGroupBtn.textContent = "Close Group";
      closeGroupBtn.onclick = () => {
        chrome.runtime.sendMessage({ type: "CLOSE_GROUP_PREVIEW", groupName }, async (preview) => {
          if (preview?.ok && preview.preview) {
            showCloseGroupPreview(preview, groupName);
          } else {
            await addConversationalMessage('close', [], null, null, 'unknown_error');
          }
        });
      };
      groupActions.appendChild(closeGroupBtn);
    }
    
    // Save group button
    if (intent.intent === 'save' || isGroupScope) {
      const saveGroupBtn = document.createElement("button");
      saveGroupBtn.className = "action-btn secondary";
      saveGroupBtn.textContent = "Save Group";
      saveGroupBtn.onclick = () => {
        const folderName = intent?.folderName || 'Chat Saves';
        chrome.runtime.sendMessage({ type: "SAVE_GROUP", groupName, folderName }, async (res) => {
          if (res?.ok) {
            await addSuccessMessage('save', { ok: true, saved: res.saved, folderName }, null);
          } else {
            await addConversationalMessage('save', [], null, null, 'unknown_error');
          }
        });
      };
      groupActions.appendChild(saveGroupBtn);
    }
    
    // Other group actions
    const moveBtn = document.createElement("button");
    moveBtn.className = "action-btn tertiary";
    moveBtn.textContent = "Move to Window";
    moveBtn.onclick = () => {
      chrome.runtime.sendMessage({ type: "MOVE_GROUP_TO_WINDOW", groupName }, async (res) => {
        if (res?.ok) {
          await addSuccessMessage('show', { ok: true }, null);
        } else {
          await addConversationalMessage('show', [], null, null, 'unknown_error');
        }
      });
    };
    groupActions.appendChild(moveBtn);
    
    const collapseBtn = document.createElement("button");
    collapseBtn.className = "action-btn tertiary";
    collapseBtn.textContent = "Collapse";
    collapseBtn.onclick = () => {
      chrome.runtime.sendMessage({ type: "GROUP_COLLAPSE", groupName, collapsed: true }, async (res) => {
        if (res?.ok) {
          await addSuccessMessage('show', { ok: true }, null);
        } else {
          await addConversationalMessage('show', [], null, null, 'unknown_error');
        }
      });
    };
    groupActions.appendChild(collapseBtn);
    
    const ungroupBtn = document.createElement("button");
    ungroupBtn.className = "action-btn tertiary";
    ungroupBtn.textContent = "Ungroup";
    ungroupBtn.onclick = () => {
      chrome.runtime.sendMessage({ type: "GROUP_UNGROUP", groupName }, async (res) => {
        if (res?.ok) {
          await addSuccessMessage('show', { ok: true, count: res.count }, null);
        } else {
          await addConversationalMessage('show', [], null, null, 'unknown_error');
        }
      });
    };
    groupActions.appendChild(ungroupBtn);
    
    contentDiv.appendChild(groupActions);
  }
  
  // Add keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (!pendingDisambiguation) return;
    
    if (e.key === 'Enter' && !e.shiftKey && primaryBtn && !primaryBtn.disabled) {
      e.preventDefault();
      primaryBtn.click();
    } else if (e.key === 'Enter' && e.shiftKey && secondaryBtn && !secondaryBtn.disabled && intent.intent === 'open') {
      e.preventDefault();
      secondaryBtn.click();
    }
  }, { once: true });
  
  contentDiv.appendChild(buttons);
  messageDiv.appendChild(contentDiv);
  chatMessages.appendChild(messageDiv);
  
  // Only auto-scroll if user is near bottom (within 100px) - keeps history visible
  const scrollThreshold = 100;
  const isNearBottom = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < scrollThreshold;
  
  if (isNearBottom) {
    // User is near bottom, scroll to show new message
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
  // Otherwise, keep current scroll position (history remains visible)
  
  pendingDisambiguation = { candidates, intent };
}

// Create a candidate item in the disambiguation list
function createCandidateItem(candidate, index, onSelect) {
  const item = document.createElement("div");
  item.className = "candidate-item";
  item.dataset.cardId = candidate.card.cardId;
  
  const card = candidate.card;
  const title = card.title || card.url || 'Untitled';
  const domain = card.domain || '';
  const sourceLabel = card.source === 'tab' ? 'Open tab' : 
                     card.source === 'bookmark' ? 'Bookmark' :
                     card.source === 'history' ? 'History' : 'Closed';
  
  // Format age
  let ageText = '';
  if (card.lastVisitedAt) {
    const ageMs = Date.now() - card.lastVisitedAt;
    const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
    const weeks = Math.floor(days / 7);
    const months = Math.floor(days / 30);
    if (days === 0) ageText = 'today';
    else if (days === 1) ageText = '1d';
    else if (days < 7) ageText = `${days}d`;
    else if (weeks < 4) ageText = `${weeks}w`;
    else if (months < 12) ageText = `${months}mo`;
    else ageText = '1y+';
  }
  
  // New structure: title, meta row with domain • type • time • action chip (on right)
  const typeLabel = card.type ? (card.type.charAt(0).toUpperCase() + card.type.slice(1)) : 'Page';
  const timeLabel = ageText || 'recent';
  const actionChipText = card.source === 'tab' ? 'Open tab' : 'History';
  
  // Add group chip if card has groupName
  const groupChip = card.groupName ? `<span class="group-chip">Group: ${escapeHtml(card.groupName)}</span>` : '';
  
  item.innerHTML = `
    <div class="candidate-header">
      <span class="candidate-title">${escapeHtml(title)}</span>
    </div>
    <div class="candidate-meta">
      <span class="domain-badge">${escapeHtml(domain || 'unknown')}</span>
    </div>
  `;
  
  // Add accessibility attributes
  item.setAttribute('role', 'button');
  item.setAttribute('tabindex', '0');
  
  // Make clickable to select (not execute)
  item.onclick = () => {
    if (onSelect) {
      onSelect(candidate.card.cardId, item);
    }
  };
  
  return item;
}

// Handle group open intent - show all tabs in group as selectable cards
async function handleGroupOpenIntent(groupName, candidates, intent) {
  if (!chatMessages) return;
  
  try {
    // Get all groups
    const allGroups = await chrome.tabGroups.query({});
    const matchingGroup = allGroups.find(g => 
      g.title && g.title.toLowerCase().includes(groupName.toLowerCase())
    );
    
    if (!matchingGroup) {
      await addConversationalMessage(null, [], groupName, null, 'not_found');
      return;
    }
    
    // Get all tabs in the group
    const groupTabs = await chrome.tabs.query({ groupId: matchingGroup.id });
    
    if (groupTabs.length === 0) {
      await addConversationalMessage(null, [], groupName, null, 'empty_group');
      return;
    }
    
    // Get domain from first tab for message
    let domain = '';
    try {
      domain = new URL(groupTabs[0].url).hostname.replace('www.', '');
    } catch {}
    
    // Create a custom disambiguation UI for group tabs
    const messageDiv = document.createElement("div");
    messageDiv.className = "message tabitha";
    
    const contentDiv = document.createElement("div");
    contentDiv.className = "message-content";
    
    // Header
    const header = document.createElement("div");
    header.className = "disambiguation-header";
    header.textContent = `You have ${groupTabs.length} tab${groupTabs.length > 1 ? 's' : ''} in '${matchingGroup.title}' — which one?`;
    contentDiv.appendChild(header);
    
    // Candidate list
    const list = document.createElement("div");
    list.className = "disambiguation-list";
    
    let selectedTabId = null;
    
    const handleCardSelect = (tabId, itemElement) => {
      list.querySelectorAll('.candidate-item').forEach(item => {
        item.classList.remove('selected');
      });
      itemElement.classList.add('selected');
      selectedTabId = tabId;
      updateButtonStates();
    };
    
    groupTabs.forEach((tab, index) => {
      const item = document.createElement("div");
      item.className = "candidate-item";
      
      try {
        const url = new URL(tab.url);
        const hostname = url.hostname.replace(/^www\./, '');
        item.innerHTML = `
          <div class="candidate-header">
            <span class="candidate-title">${escapeHtml(tab.title || 'Untitled')}</span>
          </div>
          <div class="candidate-meta">
            <span class="domain-badge">${escapeHtml(hostname || 'unknown')}</span>
          </div>
        `;
      } catch {
        item.innerHTML = `
          <div class="candidate-header">
            <span class="candidate-title">${escapeHtml(tab.title || 'Untitled')}</span>
          </div>
        `;
      }
      
      item.onclick = () => handleCardSelect(tab.id, item);
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');
      list.appendChild(item);
    });
    
    contentDiv.appendChild(list);
    
    // Action buttons
    const buttons = document.createElement("div");
    buttons.className = "disambiguation-actions";
    
    const primaryBtn = document.createElement("button");
    primaryBtn.className = "action-btn primary";
    primaryBtn.textContent = "Open Tab";
    primaryBtn.disabled = true;
    
    const secondaryBtn = document.createElement("button");
    secondaryBtn.className = "action-btn primary";
    secondaryBtn.textContent = "Open Tab Next to Current";
    secondaryBtn.disabled = true;
    
    const updateButtonStates = () => {
      if (selectedTabId) {
        primaryBtn.disabled = false;
        secondaryBtn.disabled = false;
      } else {
        primaryBtn.disabled = true;
        secondaryBtn.disabled = true;
      }
    };
    
    primaryBtn.onclick = async () => {
      if (selectedTabId) {
        try {
          const tab = await chrome.tabs.get(selectedTabId);
          await chrome.windows.update(tab.windowId, { focused: true });
          await chrome.tabs.update(selectedTabId, { active: true });
          await addSuccessMessage('find_open', { ok: true, found: true }, { card: { title: tab.title } });
        } catch (err) {
          await addConversationalMessage('find_open', [], null, null, 'unknown_error');
        }
      }
    };
    
    secondaryBtn.onclick = async () => {
      if (selectedTabId) {
        try {
          const tab = await chrome.tabs.get(selectedTabId);
          const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
          if (activeTabs.length > 0) {
            const activeTab = activeTabs[0];
            const nextIndex = activeTab.index + 1;
            await chrome.tabs.move(selectedTabId, { index: nextIndex });
            await chrome.windows.update(tab.windowId, { focused: true });
            await chrome.tabs.update(selectedTabId, { active: true });
            await addSuccessMessage('open', { ok: true, activated: true }, { card: { title: tab.title } });
          }
        } catch (err) {
          await addConversationalMessage('open', [], null, null, 'unknown_error');
        }
      }
    };
    
    buttons.appendChild(primaryBtn);
    buttons.appendChild(secondaryBtn);
    contentDiv.appendChild(buttons);
    
    messageDiv.appendChild(contentDiv);
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  } catch (err) {
    log('Error handling group open intent:', err);
    await addConversationalMessage(null, [], null, null, 'unknown_error');
  }
}

// Show "Should I open it?" confirmation when no match found
function showOpenConfirmation(query, intent) {
  if (!chatMessages) return;
  
  const messageDiv = document.createElement("div");
  messageDiv.className = "message tabitha";
  
  const contentDiv = document.createElement("div");
  contentDiv.className = "message-content";
  
  // Extract domain/app from query if possible
  const queryLower = query.toLowerCase();
  let domainToOpen = null;
  
  // Try to map common app names to domains
  const appMap = {
    'gmail': 'gmail.com',
    'google docs': 'docs.google.com',
    'docs': 'docs.google.com',
    'google doc': 'docs.google.com',
    'google sheets': 'sheets.google.com',
    'sheets': 'sheets.google.com',
    'google calendar': 'calendar.google.com',
    'calendar': 'calendar.google.com',
    'youtube': 'youtube.com',
    'yt': 'youtube.com',
    'github': 'github.com',
    'git': 'github.com',
    'substack': 'substack.com',
    'notion': 'notion.so',
    'slack': 'slack.com',
    'twitter': 'twitter.com',
    'x.com': 'x.com',
    'linkedin': 'linkedin.com'
  };
  
  // Check if query matches an app name
  for (const [appName, domain] of Object.entries(appMap)) {
    if (queryLower.includes(appName)) {
      domainToOpen = domain;
      break;
    }
  }
  
  // If no match, try to extract domain from intent constraints
  if (!domainToOpen && intent?.constraints?.app) {
    const appValue = Array.isArray(intent.constraints.app) 
      ? intent.constraints.app[0] 
      : intent.constraints.app;
    domainToOpen = typeof appValue === 'string' ? appValue : null;
  }
  
  // Build URL to open
  let urlToOpen = domainToOpen ? `https://${domainToOpen}` : `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  
  const messageText = query.includes(' ') || query.length > 20
    ? `You don't have "${query}" open. Should I open it for you?`
    : `You don't have ${query} open. Should I open it for you?`;
  
  const header = document.createElement("div");
  header.className = "disambiguation-header";
  header.textContent = messageText;
  contentDiv.appendChild(header);
  
  // Confirmation button
  const buttons = document.createElement("div");
  buttons.className = "disambiguation-actions";
  
  const confirmBtn = document.createElement("button");
  confirmBtn.className = "action-btn primary";
  confirmBtn.textContent = "Yes, open it";
  confirmBtn.onclick = async () => {
    try {
      await chrome.tabs.create({ url: urlToOpen });
      await addSuccessMessage('open', { ok: true }, { card: { title: domainToOpen || query } });
    } catch (err) {
      await addConversationalMessage('open', [], query, null, 'unknown_error');
    }
  };
  
  buttons.appendChild(confirmBtn);
  contentDiv.appendChild(buttons);
  
  messageDiv.appendChild(contentDiv);
  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Show close group preview
function showCloseGroupPreview(preview, groupName) {
  if (!chatMessages) return;
  
  const messageDiv = document.createElement("div");
  messageDiv.className = "message tabitha";
  
  const contentDiv = document.createElement("div");
  contentDiv.className = "message-content";
  
  const header = document.createElement("div");
  header.className = "disambiguation-header";
  header.textContent = `Close ${preview.count} tab${preview.count > 1 ? 's' : ''} in "${groupName}"?`;
  contentDiv.appendChild(header);
  
  // Tab list
  if (preview.tabs && preview.tabs.length > 0) {
    const list = document.createElement("div");
    list.className = "disambiguation-list";
    list.style.maxHeight = "200px";
    
    preview.tabs.forEach((tab, index) => {
      const item = document.createElement("div");
      item.className = "candidate-item";
      item.style.cursor = "default";
      try {
        const url = new URL(tab.url);
        const hostname = url.hostname.replace(/^www\./, '');
        item.innerHTML = `
          <div class="candidate-header">
            <span class="candidate-title">${escapeHtml(tab.title || 'Untitled')}</span>
          </div>
          <div class="candidate-meta">
            <span class="domain-badge">${escapeHtml(hostname || 'unknown')}</span>
          </div>
        `;
      } catch {
        item.innerHTML = `
          <div class="candidate-header">
            <span class="candidate-title">${escapeHtml(tab.title || 'Untitled')}</span>
          </div>
        `;
      }
      list.appendChild(item);
    });
    
    contentDiv.appendChild(list);
  }
  
  // Action buttons
  const buttons = document.createElement("div");
  buttons.className = "disambiguation-actions";
  
  const confirmBtn = document.createElement("button");
  confirmBtn.className = "action-btn primary";
  confirmBtn.textContent = `Close ${preview.count} Tab${preview.count > 1 ? 's' : ''}`;
  confirmBtn.onclick = () => {
    chrome.runtime.sendMessage({ type: "CLOSE_GROUP_EXEC", groupName }, async (res) => {
      if (res?.ok) {
        await addSuccessMessage('close', res, null);
        if (res.canUndo) {
          setTimeout(() => {
            addUndoButton(res);
          }, 100);
        }
      } else {
        await addConversationalMessage('close', [], null, null, 'unknown_error');
      }
    });
    messageDiv.remove();
  };
  buttons.appendChild(confirmBtn);
  
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "action-btn secondary";
  cancelBtn.textContent = "Cancel";
  cancelBtn.onclick = () => messageDiv.remove();
  buttons.appendChild(cancelBtn);
  
  contentDiv.appendChild(buttons);
  messageDiv.appendChild(contentDiv);
  chatMessages.appendChild(messageDiv);
  
  // Auto-scroll
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Removed showBroadeners function - broadener buttons are no longer needed

// Show clarifying question
async function showClarifier(question, candidates) {
  if (!chatMessages) return;
  
  // Use provided question or generate one
  if (question) {
    addChatMessage(question, "tabitha");
  } else {
    // Generate clarifying question via Prompt API
    const result = await sendBackgroundMessage({
      type: 'GENERATE_CLARIFYING_QUESTION',
      intent: currentIntent,
      shortlist: candidates
    });
    if (result?.ok && result.question) {
      addChatMessage(result.question, "tabitha");
    } else {
      await addConversationalMessage(currentIntent, candidates, null, null);
    }
  }
  
  if (candidates && candidates.length > 0) {
    showDisambiguation(candidates, currentIntent);
  }
}

// Show refine question (generate clarifying question)
async function showRefineQuestion(candidates, intent) {
  try {
    const result = await sendBackgroundMessage({
      type: 'GENERATE_CLARIFYING_QUESTION',
      intent: intent,
      shortlist: candidates
    });
    
    if (result?.ok && result.question) {
      addChatMessage(result.question, "tabitha");
    } else {
      await addConversationalMessage(currentIntent, candidates, null, null);
    }
  } catch (err) {
    log('Failed to generate clarifying question:', err);
    await addConversationalMessage(currentIntent, candidates, null, null);
  }
}

// Execute action (open, close, find_open, reopen, save, show, list, mute, unmute, pin, unpin, reload, discard)
async function executeAction(intent, cardId, nextToCurrent = false, intentObj = null) {
  // For bulk actions and group operations, cardId can be empty/null - action executor will query tabs by constraints
  const allowsEmptyCardId = ['mute', 'unmute', 'pin', 'unpin', 'reload', 'discard', 'list'].includes(intent);
  // Also allow if it's a group operation (has operation field)
  const isGroupOperation = intentObj?.operation && intentObj?.constraints?.scope === 'group';
  
  if (!cardId && !Array.isArray(cardId) && !allowsEmptyCardId && !isGroupOperation) {
    return;
  }
  
  showThinkingIndicator(true);
  
  try {
    const result = await sendBackgroundMessage({
      type: 'EXECUTE_ACTION',
      intent: intentObj || intent, // Pass full intent object if available, otherwise just intent name
      cardId: Array.isArray(cardId) ? undefined : cardId,
      cardIds: Array.isArray(cardId) ? cardId : undefined,
      nextToCurrent: nextToCurrent,
      requestId: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    });
    
    if (result?.ok) {
      // SPEED: Generate success message non-blocking (don't await)
      const candidate = result.card ? { card: result.card } : null;
      addSuccessMessage(intent, result, candidate).catch(() => {}); // Fire and forget
      
      // For show/list action, display the cards
      if ((intent === 'show' || intent === 'list') && result.cards) {
        showCards(result.cards);
      }
    } else {
      await addConversationalMessage(intent, [], null, null, 'unknown_error');
    }
  } catch (err) {
    log('Action execution error:', err);
    await addConversationalMessage(intent, [], null, null, 'unknown_error');
  } finally {
    showThinkingIndicator(false);
    setChatState(ChatStates.IDLE);
  }
}

// Phase 8: Show close preview before executing
function showClosePreview(previewResult) {
  if (!chatMessages || !previewResult?.tabs?.length) return;
  
  const messageDiv = document.createElement("div");
  messageDiv.className = "message tabitha";
  
  const contentDiv = document.createElement("div");
  contentDiv.className = "message-content";
  
  const header = document.createElement("div");
  header.className = "disambiguation-header";
  header.textContent = `You're closing ${previewResult.count} tab${previewResult.count !== 1 ? 's' : ''}:`;
  contentDiv.appendChild(header);
  
  // Preview list
  const list = document.createElement("div");
  list.className = "disambiguation-list";
  
  previewResult.tabs.forEach((tab) => {
    const item = document.createElement("div");
    item.className = "candidate-item";
    item.innerHTML = `
      <div class="candidate-header">
        <span class="candidate-title">${escapeHtml(tab.title)}</span>
      </div>
      <div class="candidate-meta">
        <span class="candidate-domain">${escapeHtml(tab.domain)}</span>
      </div>
    `;
    list.appendChild(item);
  });
  
  contentDiv.appendChild(list);
  
  // Confirm/Cancel buttons
  const buttons = document.createElement("div");
  buttons.className = "disambiguation-actions";
  
  const confirmBtn = document.createElement("button");
  confirmBtn.className = "action-btn primary";
  confirmBtn.textContent = "Confirm";
  confirmBtn.onclick = async () => {
    showThinkingIndicator(true);
    const result = await sendBackgroundMessage({
      type: 'EXECUTE_ACTION',
      intent: 'close',
      confirmed: true,
      tabIds: previewResult.tabs.map(t => t.id),
      requestId: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    });
    
    showThinkingIndicator(false);
    if (result?.ok) {
      await addSuccessMessage('close', result, null);
      if (result.canUndo) {
        setTimeout(() => {
          addUndoButton(result);
        }, 100);
      }
    } else {
      await addConversationalMessage('close', [], null, null, 'unknown_error');
    }
    messageDiv.remove();
  };
  
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "action-btn";
  cancelBtn.textContent = "Cancel";
  cancelBtn.onclick = () => {
    messageDiv.remove();
  };
  
  buttons.appendChild(confirmBtn);
  buttons.appendChild(cancelBtn);
  contentDiv.appendChild(buttons);
  messageDiv.appendChild(contentDiv);
  chatMessages.appendChild(messageDiv);
  
  // Only auto-scroll if user is near bottom (within 100px) - keeps history visible
  const scrollThreshold = 100;
  const isNearBottom = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < scrollThreshold;
  
  if (isNearBottom) {
    // User is near bottom, scroll to show new message
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
  // Otherwise, keep current scroll position (history remains visible)
}

// Execute close action with filters (Phase 8: Returns preview first)
async function executeCloseAction(filters) {
  showThinkingIndicator(true);
  
  try {
    let result;
    
    // Phase 8: First get preview (not confirmed yet)
    if (filters.tabIds && Array.isArray(filters.tabIds) && filters.tabIds.length > 0) {
      result = await sendBackgroundMessage({
        type: 'EXECUTE_ACTION',
        intent: 'close',
        tabIds: filters.tabIds,
        confirmed: false,
        requestId: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      });
    } else {
      // Use filters (domain/url/title)
      result = await sendBackgroundMessage({
        type: 'EXECUTE_ACTION',
        intent: 'close',
        filters: filters,
        confirmed: false,
        requestId: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      });
    }
    
    showThinkingIndicator(false);
    
    if (result?.ok && result.preview) {
      // Phase 8: Show preview UI
      showClosePreview(result);
    } else if (result?.ok) {
      // Already closed (shouldn't happen with preview)
      await addSuccessMessage('close', result, null);
      if (result.canUndo) {
        setTimeout(() => {
          addUndoButton(result);
        }, 100);
      }
    } else {
      await addConversationalMessage('close', [], null, null, 'unknown_error');
    }
  } catch (err) {
    log('Close action error:', err);
    await addConversationalMessage('close', [], null, null, 'unknown_error');
  } finally {
    showThinkingIndicator(false);
    setChatState(ChatStates.IDLE);
  }
}

// Show cards (for show action)
function showCards(cards) {
  if (!chatMessages || !cards?.length) return;
  
  const messageDiv = document.createElement("div");
  messageDiv.className = "message tabitha";
  
  const contentDiv = document.createElement("div");
  contentDiv.className = "message-content cards-list";
  
  const list = document.createElement("div");
  list.className = "cards-list";
  
  cards.forEach(card => {
    const item = document.createElement("div");
    item.className = "card-item";
    item.innerHTML = `
      <div class="card-title">${escapeHtml(card.title || card.url || 'Untitled')}</div>
      <div class="card-meta">${escapeHtml(card.domain || '')} • ${card.type || 'page'}</div>
    `;
    
    // Click to open
    item.onclick = () => {
      if (card.tabId) {
        chrome.tabs.update(card.tabId, { active: true });
      } else if (card.url) {
        chrome.tabs.create({ url: card.url });
      }
    };
    
    list.appendChild(item);
  });
  
  contentDiv.appendChild(list);
  messageDiv.appendChild(contentDiv);
  chatMessages.appendChild(messageDiv);
  
  // Only auto-scroll if user is near bottom (within 100px) - keeps history visible
  const scrollThreshold = 100;
  const isNearBottom = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < scrollThreshold;
  
  if (isNearBottom) {
    // User is near bottom, scroll to show new message
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
  // Otherwise, keep current scroll position (history remains visible)
}

// Helper: Escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Add undo button for close actions
function addUndoButton(result) {
  if (!chatMessages) return;
  
  const lastMessage = chatMessages.lastElementChild;
  if (!lastMessage || !lastMessage.classList.contains('tabitha')) return;
  
  const undoBtn = document.createElement("button");
  undoBtn.className = "action-btn undo-btn";
  undoBtn.textContent = "↩ Undo";
  undoBtn.onclick = async () => {
    try {
      const undoResult = await sendBackgroundMessage({ type: 'UNDO_CLOSE' });
      if (undoResult?.ok) {
        await addSuccessMessage('reopen', { ok: true, restored: undoResult.restored || 0 }, null);
        undoBtn.remove();
      } else {
        await addConversationalMessage('reopen', [], null, null, 'undo_expired');
        undoBtn.remove();
      }
    } catch (err) {
      log('Undo error:', err);
      await addConversationalMessage('reopen', [], null, null, 'unknown_error');
      undoBtn.remove();
    }
  };
  
  // Add button to the last message
  const contentDiv = lastMessage.querySelector('.message-content');
  if (contentDiv) {
    const undoContainer = document.createElement("div");
    undoContainer.className = "undo-container";
    undoContainer.appendChild(undoBtn);
    contentDiv.appendChild(undoContainer);
  }
  
  // Auto-remove after 5 seconds
  setTimeout(() => {
    undoBtn.remove();
  }, 5000);
}

// ============================================================================
// 🧩 ORGANIZE INTERFACE EVENT LISTENERS
// ============================================================================
// Event listeners for organize interface interactions
// ============================================================================
organizeBackBtn?.addEventListener("click", closeOrganizeInterface);

// Mode selection
organizeModes?.addEventListener("click", (e) => {
  const modeCard = e.target.closest(".mode-card");
  if (!modeCard) return;

  const mode = modeCard.dataset.mode;
  if (!mode) return;

  // Remove previous selection
  organizeModes.querySelectorAll(".mode-card").forEach(card => {
    card.classList.remove("selected");
  });

  // Select new mode
  modeCard.classList.add("selected");
  selectedMode = mode;
  updateOrganizeButton();
  
  log(`Selected organize mode: ${mode}`);
});

// Update organize button state
function updateOrganizeButton() {
  if (organizeNowBtn) {
    organizeNowBtn.disabled = !selectedMode || organizeState === OrganizeStates.ORGANIZING;
  }
}

// Organize now button
organizeNowBtn?.addEventListener("click", async () => {
  if (!selectedMode || organizeState === OrganizeStates.ORGANIZING) return;

  // Regular flow for all modes
  setOrganizeState(OrganizeStates.ORGANIZING);
  floatingChip?.classList.remove("hidden");

  // 🔌 call background to do the real work
  const res = await new Promise((resolve) =>
    chrome.runtime.sendMessage({ type: "ORGANIZE_TABS", mode: selectedMode }, resolve)
  );

  // UI finish
  setOrganizeState(res?.ok ? OrganizeStates.COMPLETE : OrganizeStates.ERROR);

  // show a brief summary toast if provided
  if (res?.summary) showToast(res.summary);

  setTimeout(() => floatingChip?.classList.add("hidden"), 1800);
});


// Undo organize
undoOrganizeBtn?.addEventListener("click", () => {
  if (floatingChip) {
    floatingChip.classList.add("hidden");
  }
  setOrganizeState(OrganizeStates.IDLE);
  log("Undo organize clicked");
});


// Smart Suggestions event listeners and functions have been removed

// ============================================================================
// 🔕 MUTE TABS EVENT LISTENERS
// ============================================================================
// Event listeners for mute tabs interface interactions
// ============================================================================
muteBackBtn?.addEventListener("click", closeMuteInterface);

// Mute/unmute buttons
soundingTabs?.addEventListener("click", (e) => {
  if (e.target.classList.contains('mute-btn')) {
    const action = e.target.dataset.action;
    const tabItem = e.target.closest('.tab-item');
    const tabId = parseInt(tabItem.dataset.tabId);
    
    if (action === 'mute') {
      muteTabById(tabId, true); // true = by user
    } else if (action === 'unmute') {
      unmuteTabById(tabId);
    }
  }
});

silentTabs?.addEventListener("click", (e) => {
  if (e.target.classList.contains('mute-btn')) {
    const action = e.target.dataset.action;
    const tabItem = e.target.closest('.tab-item');
    const tabId = parseInt(tabItem.dataset.tabId);
    
    if (action === 'unmute') {
      unmuteTabById(tabId);
    }
  }
});

// Auto-mute toggle
autoMuteToggle?.addEventListener("change", (e) => {
  const isEnabled = e.target.checked;
  log(`Auto-mute during meetings ${isEnabled ? 'enabled' : 'disabled'}`);
  
  // Send to background script
  chrome.runtime.sendMessage({
    type: "TOGGLE_AUTOMUTE",
    enabled: isEnabled
  }, (response) => {
    if (response?.ok) {
      log("Auto-mute setting updated");
    }
  });
});

// Remember mute preferences toggle
rememberMuteToggle?.addEventListener("change", (e) => {
  const isEnabled = e.target.checked;
  log(`Remember mute preferences ${isEnabled ? 'enabled' : 'disabled'}`);
  chrome.storage.local.set({ rememberMute: isEnabled });
});

// Meeting nudge buttons
muteOthersBtn?.addEventListener("click", () => {
  // Trigger auto-mute for meeting
  chrome.runtime.sendMessage({
    type: "AUTO_MUTE_FOR_MEETING"
  }, (response) => {
    if (response?.ok) {
      showToast("muted buzzing tabs so you can stay focused.");
      hideMeetingNudge();
      refreshMuteDashboard();
    }
  });
});

ignoreMeetingBtn?.addEventListener("click", () => {
  hideMeetingNudge();
  showToast("okay, i'll stay quiet for now");
});

// ============================================================================
// 🔕 MUTE TABS BACKGROUND INTEGRATION
// ============================================================================
// Functions that communicate with the background script for real mute functionality
// ============================================================================

// Mute a specific tab by ID
function muteTabById(tabId, byUser = false) {
  setMuteState(MuteStates.MUTING);
  
  chrome.runtime.sendMessage({
    type: "MUTE_TAB",
    id: tabId,
    byUser: byUser
  }, (response) => {
    if (response?.ok) {
      showToast(`muted tab`);
      refreshMuteDashboard();
    } else {
      showToast("failed to mute tab");
    }
    setMuteState(MuteStates.IDLE);
  });
}

// Unmute a specific tab by ID
function unmuteTabById(tabId) {
  setMuteState(MuteStates.MUTING);
  
  chrome.runtime.sendMessage({
    type: "UNMUTE_TAB",
    id: tabId
  }, (response) => {
    if (response?.ok) {
      showToast(`unmuted tab`);
      refreshMuteDashboard();
    } else {
      showToast("failed to unmute tab");
    }
    setMuteState(MuteStates.IDLE);
  });
}

// Refresh the mute dashboard with real data from background script
function refreshMuteDashboard() {
  log("Refreshing mute dashboard...");
  chrome.runtime.sendMessage({
    type: "GET_DASHBOARD"
  }, (response) => {
    log("Dashboard response:", response);
    if (response) {
      updateMuteInterface(response);
    } else {
      log("No response from background script");
      showToast("Failed to load tab data");
    }
  });
}

// Update the mute interface with real tab data
function updateMuteInterface(data) {
  if (!soundingTabs || !silentTabs || !soundSummary) return;
  
  log("Updating mute interface with data:", data);
  
  // Clear existing tabs
  soundingTabs.innerHTML = '';
  silentTabs.innerHTML = '';
  
  // Check if data has the expected structure
  if (!data || !data.summary) {
    log("Invalid data structure:", data);
    soundSummary.textContent = "Error loading tab data";
    return;
  }
  
  // Update summary
  soundSummary.textContent = `${data.summary.soundingCount} tabs playing sound — ${data.summary.mutedByTabithaCount} muted by Tabitha`;
  
  // Add sounding tabs
  if (data.sounding && Array.isArray(data.sounding)) {
    data.sounding.forEach(tab => {
      const tabItem = createTabItem(tab);
      soundingTabs.appendChild(tabItem);
    });
  }
  
  // Add silent tabs
  if (data.silent && Array.isArray(data.silent)) {
    data.silent.forEach(tab => {
      const tabItem = createTabItem(tab);
      silentTabs.appendChild(tabItem);
    });
  }
  
  // Update auto-mute toggle
  if (autoMuteToggle) {
    autoMuteToggle.checked = data.autoMuteDuringMeetings;
  }
  
  // Show meeting nudge if meeting detected
  if (data.meeting && meetingNudge) {
    meetingNudge.classList.remove("hidden");
  } else if (meetingNudge) {
    meetingNudge.classList.add("hidden");
  }
}

// Create a tab item element from tab data
function createTabItem(tab) {
  const tabItem = document.createElement('div');
  tabItem.className = 'tab-item';
  tabItem.dataset.tabId = tab.id;
  
  // Determine sound indicator type
  let indicatorClass = 'muted';
  let indicatorContent = '<div class="muted-icon">🔇</div>';
  
  if (tab.meeting) {
    indicatorClass = 'priority';
    indicatorContent = '<div class="priority-glow"></div>';
  } else if (tab.audible && !tab.muted) {
    indicatorClass = 'playing';
    indicatorContent = `
      <div class="waveform">
        <span class="bar"></span>
        <span class="bar"></span>
        <span class="bar"></span>
      </div>
    `;
  } else if (tab.muted) {
    indicatorClass = tab.label.includes('Tabitha') ? 'muted-auto' : 'muted';
    indicatorContent = '<div class="muted-icon">🔇</div>';
  }
  
  // Determine button state
  let buttonText = 'Mute';
  let buttonAction = 'mute';
  let buttonDisabled = false;
  
  if (tab.meeting) {
    buttonText = 'Keep Live';
    buttonAction = 'mute';
    buttonDisabled = true;
  } else if (tab.muted) {
    buttonText = 'Unmute';
    buttonAction = 'unmute';
  }
  
  tabItem.innerHTML = `
    <div class="tab-icon">
      <img src="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTggMTJDMTAuMjA5MSAxMiAxMiAxMC4yMDkxIDEyIDhWNEg4QzUuNzkwODYgNCA0IDUuNzkwODYgNCA4VjEyWiIgZmlsbD0iIzc5NjFGRiIvPgo8L3N2Zz4K" alt="${tab.domain}">
      <div class="sound-indicator ${indicatorClass}">
        ${indicatorContent}
      </div>
    </div>
    <div class="tab-info">
      <span class="tab-title">${tab.title}</span>
      <span class="tab-status">${tab.label}</span>
    </div>
    <div class="tab-controls">
      <button class="mute-btn" data-action="${buttonAction}" ${buttonDisabled ? 'disabled' : ''}>${buttonText}</button>
    </div>
  `;
  
  return tabItem;
}

// Hide meeting nudge
function hideMeetingNudge() {
  if (meetingNudge) {
    meetingNudge.classList.add("hidden");
  }
  setMuteState(MuteStates.IDLE);
}

// Toast message system
function showToast(message) {
  if (!toastContainer) return;
  
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  
  toastContainer.appendChild(toast);
  
  // Auto-remove after 3 seconds
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }, 3000);
}

// Voice/chat commands for muting
function handleMuteCommand(command) {
  const lowerCommand = command.toLowerCase();
  
  if (lowerCommand.includes('mute all except') || lowerCommand.includes('mute everything except')) {
    // Extract the exception
    const exception = lowerCommand.match(/except\s+(\w+)/i)?.[1];
    if (exception) {
      // This would need to be implemented in background script
      showToast(`muting all tabs except ${exception} 🎵`);
    }
  } else if (lowerCommand.includes('unmute my meeting') || lowerCommand.includes('unmute meeting')) {
    // Unmute all auto-muted tabs
    chrome.runtime.sendMessage({
      type: "UNMUTE_ALL_AUTOMUTED"
    }, (response) => {
      if (response?.ok) {
        showToast("unmuted your meeting tab");
        refreshMuteDashboard();
      }
    });
  } else if (lowerCommand.includes('mute buzzing') || lowerCommand.includes('mute noisy')) {
    // This would trigger auto-mute for meeting
    chrome.runtime.sendMessage({
      type: "UNMUTE_ALL_AUTOMUTED"
    }, (response) => {
      if (response?.ok) {
        showToast("silenced buzzing tabs for your focus");
        refreshMuteDashboard();
      }
    });
  }
}

// Load saved mute preferences from background script
chrome.runtime.sendMessage({
  type: "GET_SETTINGS"
}, (response) => {
  if (response?.settings) {
    if (autoMuteToggle) {
      autoMuteToggle.checked = response.settings.autoMuteDuringMeetings || false;
    }
  }
  
  // Load remember mute preference from local storage
  chrome.storage.local.get(['rememberMute'], (result) => {
    if (rememberMuteToggle) {
      rememberMuteToggle.checked = result.rememberMute || false;
    }
  });
});

// Add voice command integration
// This would be called from the voice/chat interfaces
window.handleMuteCommand = handleMuteCommand;

// ============================================================================
// 🧪 DEBUGGING & TESTING
// ============================================================================
// Temporary debugging functions to test background script integration
// ============================================================================

// Test background script connection
function testBackgroundConnection() {
  log("Testing background script connection...");
  chrome.runtime.sendMessage({
    type: "GET_SETTINGS"
  }, (response) => {
    if (response) {
      log("✅ Background script connected! Settings:", response);
      showToast("Background script connected!");
    } else {
      log("❌ No response from background script");
      showToast("Background script not responding");
    }
  });
}

// Test dashboard data
function testDashboardData() {
  log("Testing dashboard data...");
  refreshMuteDashboard();
}

// Test mute interface opening
function testMuteInterface() {
  log("Testing mute interface...");
  openMuteInterface();
}

// Expose test functions globally for debugging
window.testBackgroundConnection = testBackgroundConnection;
window.testDashboardData = testDashboardData;
window.testMuteInterface = testMuteInterface;

// Test notification function
window.testNotification = () => {
  log("Testing notification from popup...");
  chrome.runtime.sendMessage({
    type: "TEST_NOTIFICATION"
  }, (response) => {
    log("Notification test response:", response);
  });
};

// ============================================================================
// 🎙️ VOICE HUB LIVE CAPTIONS FUNCTIONALITY
// ============================================================================
// Handles the live captions toggle for the voice hub
// ============================================================================
liveCaptionsToggle?.addEventListener("change", (e) => {
  const isEnabled = e.target.checked;
  log(`Live Captions ${isEnabled ? 'enabled' : 'disabled'}`);
  log('Transcript element:', transcript);
  
  // Toggle transcript visibility
  if (transcript) {
    if (isEnabled) {
      transcript.classList.remove('hidden');
      log('Removed hidden class from transcript');
    } else {
      transcript.classList.add('hidden');
      log('Added hidden class to transcript');
    }
  } else {
    log('Transcript element not found!');
  }
  
  // Store the preference
  chrome.storage.local.set({ liveCaptions: isEnabled });
});

// Load saved Live Captions preference on popup open
chrome.storage.local.get(['liveCaptions'], (result) => {
  log('Loading Live Captions preference:', result);
  log('Toggle element:', liveCaptionsToggle);
  log('Transcript element:', transcript);
  
  if (liveCaptionsToggle) {
    const isEnabled = result.liveCaptions || false;
    liveCaptionsToggle.checked = isEnabled;
    log('Set toggle checked to:', isEnabled);
    
    // Apply the saved state to transcript visibility
    if (transcript) {
      if (isEnabled) {
        transcript.classList.remove('hidden');
        log('Removed hidden class on init');
      } else {
        transcript.classList.add('hidden');
        log('Added hidden class on init');
      }
    } else {
      log('Transcript element not found during init!');
    }
  } else {
    log('Toggle element not found!');
  }
});

// ============================================================================
// 🎙️ VOICE HUB REAL ASR/TTS INTEGRATION
// ============================================================================
// Real voice interaction with ASR, TTS, and voice pipeline
// ============================================================================

let ASRManager = null;
let TTSManager = null;
let pendingConfirmationRequestId = null;
let pendingVoiceDisambiguation = null; // Store voice disambiguation state for follow-ups
let latencyTimeout = null;

// Initialize ASR and TTS managers
async function initVoiceModules() {
  try {
    // Create managers (modules already imported at top of file)
    ASRManager = await createASRManager({ language: 'en-US' });
    TTSManager = await createTTSManager({ useOffscreen: true, preferChromeTTS: true });
    
    if (!ASRManager) {
      log('ASR unavailable');
      setState(States.ERROR);
      if (statusText) statusText.textContent = "Voice understanding isn't available — use the text box or update Chrome.";
      return false;
    }
    
    if (!TTSManager) {
      log('TTS unavailable, continuing without speech');
    }
    
    // Set up ASR callbacks
    ASRManager.onInterimResult((interimText, latencyMs) => {
      // Update live captions (if enabled)
      if (liveCaptionsToggle?.checked && transcript) {
        const interimEl = transcript.querySelector('.interim-text');
        if (!interimEl) {
          const el = document.createElement('div');
          el.className = 'interim-text bubble user';
          transcript.appendChild(el);
        }
        const el = transcript.querySelector('.interim-text');
        if (el) {
          el.textContent = interimText;
          transcript.scrollTop = transcript.scrollHeight;
        }
      }
      
      // Log latency (target <150ms)
      if (latencyMs > 150) {
        log(`ASR latency: ${latencyMs}ms (target: <150ms)`);
      }
    });
    
    ASRManager.onFinalResult(async (finalText) => {
      // Clear interim text
      const interimEl = transcript?.querySelector('.interim-text');
      if (interimEl) interimEl.remove();
      
      // Add final transcript bubble
      if (liveCaptionsToggle?.checked && transcript) {
        addBubble(finalText, 'user');
      }
      
      // Check if we're waiting for a confirmation
      if (pendingConfirmationRequestId) {
        // Handle as confirmation response
        await handleVoiceConfirmation(finalText);
      } else {
        // Send to voice pipeline
        await processVoiceQuery(finalText);
      }
    });
    
    ASRManager.onError((error) => {
      log('ASR error:', error);
      setState(States.ERROR);
      if (statusText) statusText.textContent = error.message || 'Voice recognition error';
      
      // Show error in transcript
      if (transcript) {
        addBubble(`Error: ${error.message}`, 'error');
      }
    });
    
    // Set up TTS callbacks
    if (TTSManager) {
      TTSManager.onSpeakStart((text) => {
        setState(States.SPEAKING);
        if (transcript) {
          addBubble(text, 'her');
        }
      });
      
      TTSManager.onSpeakEnd(() => {
        setState(States.IDLE);
      });
      
      TTSManager.onSpeakError((error) => {
        log('TTS error:', error);
        setState(States.IDLE);
      });
    }
    
    log('Voice modules initialized');
    return true;
  } catch (err) {
    log('Voice module init error:', err);
    setState(States.ERROR);
    if (statusText) statusText.textContent = 'Voice features unavailable';
    return false;
  }
}

// Process voice query through pipeline
async function processVoiceQuery(text) {
  if (!text || !text.trim()) return;
  
  const requestId = `voice_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  setState(States.THINKING);
  
  // Clear latency timeout if exists
  if (latencyTimeout) {
    clearTimeout(latencyTimeout);
    latencyTimeout = null;
  }
  
  // Show "Still thinking..." if routing takes >1.5s
  latencyTimeout = setTimeout(() => {
    if (state === States.THINKING && statusText) {
      statusText.textContent = 'Still thinking...';
    }
  }, 1500);
  
  try {
    // Send voice query to background
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'VOICE_QUERY',
        text: text.trim(),
        requestId: requestId
      }, resolve);
    });
    
    // Clear latency timeout
    if (latencyTimeout) {
      clearTimeout(latencyTimeout);
      latencyTimeout = null;
    }
    
    if (!response?.ok) {
      // Handle error
      setState(States.ERROR);
      const errorMsg = response?.spokenSummary || response?.error || 'Unknown error';
      if (statusText) statusText.textContent = 'Error';
      if (transcript) {
        addBubble(errorMsg, 'error');
      }
      
      // Speak error if TTS available
      if (TTSManager && response?.spokenSummary) {
        await TTSManager.speak(response.spokenSummary);
      }
      return;
    }
    
    // Handle confirmation needed
    if (response.needsConfirmation) {
      pendingConfirmationRequestId = response.requestId;
      
      // Show confirmation in transcript
      if (transcript) {
        addBubble(response.spokenSummary, 'her');
      }
      
      // Speak confirmation prompt
      if (TTSManager && response.spokenSummary) {
        await TTSManager.speak(response.spokenSummary);
      }
      
      setState(States.IDLE);
      return;
    }
    
    // Handle disambiguation needed
    if (response.needsDisambiguation) {
      // Store pending disambiguation for follow-ups
      pendingVoiceDisambiguation = {
        candidates: response.candidates || [],
        intent: response.intent,
        spokenSummary: response.spokenSummary
      };
      
      // Show cards in voice hub
      if (response.candidates && response.candidates.length > 0) {
        showVoiceDisambiguation(response.candidates, response.intent);
      }
      
      // Show candidates in transcript (simplified)
      if (transcript) {
        addBubble(response.spokenSummary || `Found ${response.candidates?.length || 0} matches`, 'her');
      }
      
      // Speak disambiguation prompt
      if (TTSManager && response.spokenSummary) {
        await TTSManager.speak(response.spokenSummary);
      }
      
      setState(States.IDLE);
      return;
    }
    
    // Auto-execute successful
    if (response.autoExecute) {
      // Speak success message
      if (TTSManager && response.spokenSummary) {
        await TTSManager.speak(response.spokenSummary);
      } else {
        setState(States.IDLE);
      }
      return;
    }
    
    // Default: speak response
    if (TTSManager && response.spokenSummary) {
      await TTSManager.speak(response.spokenSummary);
    } else {
      setState(States.IDLE);
    }
    
  } catch (err) {
    log('Voice query error:', err);
    setState(States.ERROR);
    if (transcript) {
      addBubble('Sorry, I encountered an error processing your request.', 'error');
    }
    if (TTSManager) {
      await TTSManager.speak('Sorry, I encountered an error.');
    } else {
      setState(States.IDLE);
    }
  }
}

// Handle voice confirmation
async function handleVoiceConfirmation(text) {
  // Check if this is a follow-up to disambiguation
  if (pendingVoiceDisambiguation) {
    const followUp = await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'UNDERSTAND_FOLLOWUP',
        previousQuery: pendingVoiceDisambiguation.intent?.query || '',
        previousResponse: pendingVoiceDisambiguation.spokenSummary || '',
        candidates: pendingVoiceDisambiguation.candidates,
        newMessage: text.trim(),
        sessionId: 'voice_session'
      }, resolve);
    });
    
    if (followUp?.ok && followUp.action === 'select' && followUp.tabNumber) {
      // Execute on selected tab
      const selectedCandidate = pendingVoiceDisambiguation.candidates[followUp.tabNumber - 1];
      if (selectedCandidate) {
        const result = await new Promise((resolve) => {
          chrome.runtime.sendMessage({
            type: 'EXECUTE_ACTION',
            intent: pendingVoiceDisambiguation.intent?.intent || 'open',
            cardId: selectedCandidate.card.cardId,
            requestId: `voice_${Date.now()}`
          }, resolve);
        });
        
        // Generate success message and speak
        const successResponse = await new Promise((resolve) => {
          chrome.runtime.sendMessage({
            type: 'GENERATE_SUCCESS_RESPONSE',
            intent: pendingVoiceDisambiguation.intent,
            result: result,
            candidate: selectedCandidate
          }, resolve);
        });
        
        if (successResponse?.ok && successResponse.text) {
          if (transcript) {
            addBubble(successResponse.text, 'her');
          }
          if (TTSManager) {
            await TTSManager.speak(successResponse.text);
          }
        }
        
        // Hide disambiguation cards
        const voiceDisambiguation = document.getElementById('voiceDisambiguation');
        if (voiceDisambiguation) {
          voiceDisambiguation.classList.add('hidden');
        }
        
        pendingVoiceDisambiguation = null;
        setState(States.IDLE);
        return;
      }
    }
    
    // If unclear, continue with confirmation flow below
    pendingVoiceDisambiguation = null;
  }
  
  if (!pendingConfirmationRequestId) return;
  
  const requestId = pendingConfirmationRequestId;
  pendingConfirmationRequestId = null;
  
  setState(States.THINKING);
  
  try {
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'VOICE_CONFIRM',
        requestId: requestId,
        text: text.trim()
      }, resolve);
    });
    
    if (response?.ok && response.spokenSummary) {
      if (transcript) {
        addBubble(response.spokenSummary, 'her');
      }
      if (TTSManager) {
        await TTSManager.speak(response.spokenSummary);
      } else {
        setState(States.IDLE);
      }
    } else {
      setState(States.IDLE);
    }
  } catch (err) {
    log('Confirmation error:', err);
    setState(States.IDLE);
  }
}

// Mic button click handler with barge-in support
micBtn?.addEventListener("click", async () => {
  // Only work if voice hub is visible
  if (voiceHub && voiceHub.classList.contains("hidden")) {
    return;
  }
  
  // Initialize voice modules if not already done
  if (!ASRManager) {
    const initialized = await initVoiceModules();
    if (!initialized) return;
  }
  
  // Barge-in: If speaking, stop TTS and start listening immediately
  if (state === States.SPEAKING && TTSManager) {
    TTSManager.stopSpeaking();
    // Small delay to ensure TTS stops cleanly
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  
  // Start or stop listening
  if (state === States.IDLE || state === States.ERROR || state === States.SPEAKING) {
    setState(States.LISTENING);
    
    // Start ASR
    if (ASRManager) {
      ASRManager.startListening();
    }
  } else if (state === States.LISTENING) {
    // Manual stop (VAD will also stop automatically after silence)
    if (ASRManager) {
      ASRManager.stopListening();
    }
    // Will transition to THINKING when final result arrives
  } else if (state === States.THINKING) {
    // Cancel thinking and return to idle
    setState(States.IDLE);
    if (latencyTimeout) {
      clearTimeout(latencyTimeout);
      latencyTimeout = null;
    }
  }
});

// Initialize voice modules when voice hub opens
if (voiceHub) {
  // Lazy init on first open
  let voiceModulesInitialized = false;
  const originalOpenVoiceHub = openVoiceHub;
  openVoiceHub = async function() {
    originalOpenVoiceHub();
    if (!voiceModulesInitialized) {
      voiceModulesInitialized = true;
      await initVoiceModules();
    }
  };
}

// ============================================================================
// 🎙️ VOICE HUB HELPER FUNCTIONS
// ============================================================================
// Helper functions for voice hub functionality
// ============================================================================
function addBubble(text, who = "her") {
  if (!transcript) return;
  const div = document.createElement("div");
  div.className = `bubble ${who}`;
  div.textContent = text;
  transcript.appendChild(div);
  transcript.scrollTop = transcript.scrollHeight;
}

// Show voice disambiguation cards
function showVoiceDisambiguation(candidates, intent) {
  const voiceDisambiguation = document.getElementById('voiceDisambiguation');
  const voiceCardsContainer = document.getElementById('voiceCardsContainer');
  
  if (!voiceDisambiguation || !voiceCardsContainer) return;
  
  // Clear previous cards
  voiceCardsContainer.innerHTML = '';
  
  // Create cards (reuse candidate item helper from chat)
  candidates.slice(0, 5).forEach((candidate, index) => {
    const item = document.createElement('div');
    item.className = 'candidate-item';
    
    try {
      const url = new URL(candidate.card.url);
      const hostname = url.hostname.replace(/^www\./, '');
      item.innerHTML = `
        <div class="candidate-header">
          <span class="candidate-title">${escapeHtml(candidate.card.title || 'Untitled')}</span>
        </div>
        <div class="candidate-meta">
          <span class="domain-badge">${escapeHtml(hostname || 'unknown')}</span>
        </div>
      `;
    } catch {
      item.innerHTML = `
        <div class="candidate-header">
          <span class="candidate-title">${escapeHtml(candidate.card.title || 'Untitled')}</span>
        </div>
      `;
    }
    
    // Cards are visual only - voice uses speech for selection
    item.setAttribute('data-index', index + 1);
    voiceCardsContainer.appendChild(item);
  });
  
  // Show the disambiguation section
  voiceDisambiguation.classList.remove('hidden');
  
  // Auto-dismiss after 30s
  setTimeout(() => {
    voiceDisambiguation.classList.add('hidden');
    pendingVoiceDisambiguation = null;
  }, 30000);
}

// ============================== TEMP: POPUP-ONLY PROMPT API TEST (remove with this block) ==============================
/*
;(function initPopupPromptApiTest(){
  // helpers
  function setBar(el, progress){ try { el.textContent = `Downloading model… ${Math.round((progress.loaded||0)*100)}%`; } catch {} }
  function withMonitor(factory){ return { monitor(m){ try { m.addEventListener('downloadprogress', (e)=> factory?.(e)); } catch {} } }; }

  // Prompt API (popup-only test)
  const LanguageModel = self.LanguageModel || self.ai?.languageModel;
  const promptOut = document.getElementById('prompt-out');
  const promptBar = document.getElementById('prompt-bar');
  const promptParams = document.getElementById('prompt-params');
  let promptSession = null;

  async function ensurePromptSession(opts = {}) {
    try {
      const params = await LanguageModel?.params?.();
      if (promptParams && params) {
        promptParams.textContent = JSON.stringify({
          defaultTemperature: params.defaultTemperature,
          defaultTopK: params.defaultTopK
        });
      }
    } catch {}
    const avail = await LanguageModel?.availability?.(opts);
    if (avail === 'unavailable') throw new Error('Prompt model unavailable on this device.');
    const session = await LanguageModel.create({
      ...opts,
      ...withMonitor((p) => setBar(promptBar, p))
    });
    return session;
  }

  const btnRun = document.getElementById('prompt-run');
  if (btnRun) btnRun.onclick = async () => {
    if (promptOut) promptOut.textContent = 'Running…';
    const inputEl = document.getElementById('prompt-input');
    const input = (inputEl?.value || '').trim() || 'Write a haiku about autumn leaves.';
    chrome.runtime.sendMessage({ type: 'OFFSCREEN_PROMPT', prompt: input }, (res) => {
      if (!res) {
        if (promptOut) promptOut.textContent = 'Error: no response from offscreen';
        return;
      }
      if (res.error) {
        if (promptOut) promptOut.textContent = `Error: ${res.error}`;
      } else {
        if (promptOut) promptOut.textContent = res.text ?? JSON.stringify(res);
      }
    });
  };
})();
*/
// ============================== END TEMP: POPUP-ONLY PROMPT API TEST ==============================


