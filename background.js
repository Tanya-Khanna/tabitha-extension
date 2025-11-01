// background.js — Tabitha Extension Main Orchestrator
// MV3 service worker
//
// ARCHITECTURE:
// =============
// This file serves as the main orchestrator for all feature modules:
// - Chat with your Tabs (features/chat-for-tabs/)
// - Mute Tabs (features/mute-tabs/)
// - Organize Tabs (features/organize-tabs/)
// - Talk to your Tabs (features/talk-to-tabs/)
//
// Message Routing:
// All messages are routed to feature modules first via:
// 1. Chat module (checks handlesMessageType)
// 2. Mute Tabs module (handleMuteTabsMessage)
// 3. Organize Tabs module (handleOrganizeTabsMessage)
// 4. Talk to Tabs module (handleTalkToTabsMessage)
// If no module handles it, falls through to default handler
//
// Initialization:
// All modules are initialized in the boot sequence (init function)

// Import all feature modules
import { handleChatMessage, init as initChat, handlesMessageType } from './features/chat-for-tabs/index.js';
import { handleMuteTabsMessage, init as initMuteTabs } from './features/mute-tabs/index.js';
import { handleOrganizeTabsMessage, init as initOrganizeTabs } from './features/organize-tabs/index.js';
import { handleTalkToTabsMessage, init as initTalkToTabs } from './features/talk-to-tabs/index.js';

/***********************************
 *  BOOT GUARDS & HYGIENE
 ***********************************/
let __BOOTED__ = false; // Guard flag: prevent duplicate listeners/intervals

/***********************************
 *  UTIL
 ***********************************/
const log = (...a) => console.log("[Tabitha::bg]", ...a);

/***********************************
 *  BOOT
 ***********************************/
const v = chrome.runtime.getManifest().version;
chrome.runtime.onInstalled.addListener(() => log(`Installed (v${v})`));
chrome.runtime.onStartup.addListener(() => log(`Service worker started (v${v})`));

(async function init() {
  if (__BOOTED__) {
    log('Already booted, skipping init');
    return;
  }
  __BOOTED__ = true;

  try {
    // Initialize all feature modules
    await initChat();
    await initMuteTabs();
    await initOrganizeTabs();
    await initTalkToTabs();
    
    log('All feature modules initialized');
  } catch (err) {
    console.error('[Tabitha::bg] Init error:', err);
    // Continue even if initialization fails
  }
})();

/***********************************
 *  MESSAGE HANDLERS (All Features)
  ***********************************/
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Always wrap async work in an IIFE and return true up-front
  (async () => {
    try {
      if (!msg || !msg.type) {
        sendResponse({ ok: false, error: 'bad_request' });
        return;
      }

      // Route messages to appropriate feature modules
      // Try modules in order: Chat → Mute Tabs → Organize Tabs → Talk to Tabs
      
      // 1. Chat with your Tabs
      if (handlesMessageType(msg.type)) {
        try {
          const result = await handleChatMessage(msg);
          if (result !== null) {
            sendResponse(result);
            return;
          }
        } catch (err) {
          sendResponse({ ok: false, error: String(err?.message || err) });
          return;
        }
      }
      
      // 2. Mute Tabs
      const muteResult = await handleMuteTabsMessage(msg);
      if (muteResult !== null) {
        sendResponse(muteResult);
        return;
      }
      
      // 3. Organize Tabs
      const organizeResult = await handleOrganizeTabsMessage(msg);
      if (organizeResult !== null) {
        sendResponse(organizeResult);
        return;
      }
      
      // 4. Talk to your Tabs
      const talkResult = await handleTalkToTabsMessage(msg);
      if (talkResult !== null) {
        sendResponse(talkResult);
        return;
      }

      // If no module handled the message, fall through to default handler
      switch (msg.type) {
        default: {
          log("message:", msg, "from", sender.id);
          sendResponse({ ok: false, error: `unknown_type:${msg.type}` });
          return;
        }
      }
    } catch (err) {
      console.error('[bg] handler error for', msg?.type, err);
      sendResponse({ ok: false, error: String(err?.message || err) });
    }
  })();

  // Tell Chrome we'll respond asynchronously
  return true;
});

/***********************************
 *  STARTUP DIAGNOSTICS
 ***********************************/
async function runStartupChecks() {
  console.group("%c🧠 Tabitha Startup Checks", "color:#7B61FF;font-weight:bold;");

  // Chrome API availability
  console.log("🔹 chrome.runtime:", !!chrome.runtime);
  console.log("🔹 chrome.tabs:", !!chrome.tabs);
  console.log("🔹 chrome.tabGroups:", !!chrome.tabGroups);

  // Permissions check
  try {
    const perm = await chrome.permissions.getAll?.();
    console.log("🔹 Permissions:", (perm && perm.permissions) ? perm.permissions : []);
  } catch (e) {
    console.warn("⚠️ Unable to read permissions via chrome.permissions:", e);
  }

  // AI model check (Prompt API availability)
  try {
    if ("ai" in self && self.ai?.languageModel) {
      const avail = await self.ai.languageModel.availability();
      console.log("✅ AI Model availability:", avail);
    } else {
      console.warn("⚠️ No AI model found in this context. Prompt API unavailable.");
    }
  } catch (err) {
    console.error("❌ Error checking AI model:", err);
  }

  // Storage check
  try {
    const storageTest = { testKey: "hello" };
    await chrome.storage.local.set(storageTest);
    const stored = await chrome.storage.local.get("testKey");
    console.log("🔹 Storage test:", stored.testKey === "hello" ? "✅ OK" : "❌ FAILED");
  } catch (e) {
    console.warn("⚠️ Storage check failed:", e);
  }

  // Offscreen document check
  if (chrome.offscreen) {
    try {
      const hasDoc = await chrome.offscreen.hasDocument?.();
      console.log("🔹 Offscreen document present:", !!hasDoc);
    } catch (e) {
      console.warn("⚠️ Offscreen API not available in this context.");
    }
  } else {
    console.warn("⚠️ chrome.offscreen API not defined here.");
  }

  console.groupEnd();
}

runStartupChecks();

// Also run on install/start to guarantee visibility in SW console
try { chrome.runtime.onInstalled.addListener(() => runStartupChecks()); } catch {}
try { chrome.runtime.onStartup.addListener(() => runStartupChecks()); } catch {}

/***********************************
 *  KEYBOARD COMMANDS
 ***********************************/
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-voice') {
    log('Keyboard shortcut: toggle-voice');
    
    try {
      // Send message to all tabs to show floating chip and start listening
      const tabs = await chrome.tabs.query({});
      
      for (const tab of tabs) {
        try {
          await chrome.tabs.sendMessage(tab.id, {
            type: 'VOICE_CHIP_SHOW',
            state: 'listening'
          });
        } catch (err) {
          // Ignore errors for tabs that don't have content script loaded
        }
      }
      
      // Also notify popup if it's open
      // (This will be handled by popup.js if the voice hub is visible)
      
      log('Voice listening activated via keyboard shortcut');
    } catch (err) {
      log('Error handling keyboard shortcut:', err);
    }
  }
});