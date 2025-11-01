// Chat with your Tabs - Shared utilities
// Includes: offscreen document management, logging, telemetry, undo buffer, concurrency guards

const log = (...a) => console.log("[Tabitha::chat]", ...a);

// ==== OFFScreen Document Management ====
let offscreenReady = false;
export async function ensureOffscreen() {
  // Check for API presence for robust compatibility
  if (chrome.offscreen && chrome.offscreen.createDocument) {
    try {
      // Prefer native hasDocument when available
      const already = await (chrome.offscreen.hasDocument?.() || Promise.resolve(false));
      if (already || offscreenReady) { offscreenReady = true; return; }
      await chrome.offscreen.createDocument({
        url: chrome.runtime.getURL('offscreen.html'),
        reasons: [chrome.offscreen.Reason.DOM_SCRAPING],
        justification: 'Run on-device Prompt/Summarizer in a DOM context'
      });
      offscreenReady = true;
      console.log('Offscreen document created ✅');
    } catch (e) {
      const msg = String(e?.message || e);
      if (msg.includes('Only a single offscreen document may be created')) {
        offscreenReady = true;
        console.log('Offscreen already exists ✅');
        return;
      }
      console.warn('Offscreen document creation failed:', e);
    }
  } else {
    console.warn("Offscreen API unavailable ❌ — update Chrome or enable 'Experimental Web Platform features'");
  }
}

export async function postToOffscreen(kind, payload) {
  try {
    await ensureOffscreen();
  } catch (err) {
    // If offscreen document creation fails, return an error
    return Promise.reject(new Error('offscreen_unavailable'));
  }
  
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({ target: 'offscreen', type: kind, ...payload }, (res) => {
        const err = chrome.runtime.lastError;
        if (err) {
          // Suppress "Receiving end does not exist" errors silently if it's just timing
          if (err.message && err.message.includes('Receiving end does not exist')) {
            log('Offscreen document not ready yet, will retry on next call');
            return reject(new Error('offscreen_not_ready'));
          }
          return reject(new Error(err.message));
        }
        if (!res) return reject(new Error('no_response'));
        if (res.ok === false && res.error) return reject(new Error(res.error));
        resolve(res);
      });
    } catch (e) {
      reject(e);
    }
  });
}

// ==== Structured Logging ====
export function structuredLog(phase, action, data) {
  const timestamp = Date.now();
  const entry = {
    phase,
    action,
    timestamp,
    ...data
  };
  log(`[${phase}] ${action}:`, entry);
  return entry;
}

// ==== Telemetry (Local Only) ====
const telemetry = {
  actions: {
    open: { success: 0, failed: 0 },
    close: { success: 0, failed: 0 },
    find_open: { success: 0, failed: 0 },
    reopen: { success: 0, failed: 0 },
    save: { success: 0, failed: 0 },
    show: { success: 0, failed: 0 }
  },
  parsing: {
    prompt_api: 0,
    fallback: 0,
    failed: 0
  },
  search: {
    lexical: 0,
    semantic_rerank: 0,
    no_candidates: 0,
    too_many_candidates: 0
  }
};

export async function recordTelemetry(category, event, success = true) {
  try {
    if (telemetry[category] && telemetry[category][event]) {
      if (success) {
        telemetry[category][event].success = (telemetry[category][event].success || 0) + 1;
      } else {
        telemetry[category][event].failed = (telemetry[category][event].failed || 0) + 1;
      }
    }
    
    // Persist to storage (occasionally)
    if (Math.random() < 0.1) { // 10% chance
      await chrome.storage.local.set({ chatTelemetry: telemetry });
    }
  } catch (err) {
    // Silent fail - telemetry is non-critical
  }
}

async function loadTelemetry() {
  try {
    const stored = await chrome.storage.local.get(['chatTelemetry']);
    if (stored.chatTelemetry) {
      Object.assign(telemetry, stored.chatTelemetry);
    }
  } catch (err) {
    // Silent fail
  }
}

// Load telemetry on module init
loadTelemetry();

// ==== Concurrency Guard (in-flight requests) ====
const inFlightActions = new Map(); // requestId -> { type, startTime }

export function isActionInFlight(requestId) {
  return inFlightActions.has(requestId);
}

export function markActionStarted(requestId, actionType) {
  if (requestId) {
    inFlightActions.set(requestId, { type: actionType, startTime: Date.now() });
    // Cleanup after 30s (safety)
    setTimeout(() => inFlightActions.delete(requestId), 30000);
  }
}

export function markActionCompleted(requestId) {
  if (requestId) {
    inFlightActions.delete(requestId);
  }
}

// ==== Undo Buffer (ring buffer of last 10 destructive actions) ====
const undoBuffer = [];
const MAX_UNDO_ENTRIES = 10;

export function addUndoEntry(action) {
  undoBuffer.push(action);
  if (undoBuffer.length > MAX_UNDO_ENTRIES) {
    undoBuffer.shift(); // Remove oldest
  }
}

export function getLatestUndoEntry() {
  return undoBuffer.length > 0 ? undoBuffer[undoBuffer.length - 1] : null;
}

// ==== URL Normalization (shared utility) ====
// Normalize URLs for dedupe & "is already open": strip #..., known utm_*, fbclid, gclid, etc.
export function normalizeUrl(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const u = new URL(url);
    // Remove hash fragment
    u.hash = '';
    // Remove common tracking params
    const paramsToRemove = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref', 'source', 'fbclid', 'gclid', '_ga', 'gclsrc', 'dclid'];
    paramsToRemove.forEach(p => u.searchParams.delete(p));
    // Normalize to string (remove trailing slash for consistency)
    return u.toString().replace(/\/$/, '').toLowerCase().trim();
  } catch {
    // If URL parsing fails, return lowercase trimmed version
    return url.toLowerCase().trim();
  }
}

