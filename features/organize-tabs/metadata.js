// Organize Tabs - Tab metadata tracking for activity-based organization
// Tracks when tabs are created, focused, etc.

const tabMeta = new Map(); // tabId -> { createdAt, lastFocusedAt, everFocused }

export function ensureMeta(tabId) {
  if (!tabMeta.has(tabId)) {
    tabMeta.set(tabId, { createdAt: Date.now(), lastFocusedAt: 0, everFocused: false });
  }
  return tabMeta.get(tabId);
}

export function initMetadataListeners() {
  chrome.tabs.onCreated.addListener((tab) => {
    const m = ensureMeta(tab.id);
    m.createdAt = Date.now();
  });

  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    const m = ensureMeta(activeInfo.tabId);
    m.lastFocusedAt = Date.now();
    m.everFocused = true;
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    tabMeta.delete(tabId);
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tab && tab.active) {
      const m = ensureMeta(tabId);
      m.lastFocusedAt = Date.now();
      m.everFocused = true;
    }
  });
}

export function minutesSince(ts) {
  return (Date.now() - ts) / 60000;
}

export function hoursSince(ts) {
  return (Date.now() - ts) / 3600000;
}

export function getTabMeta() {
  return tabMeta;
}

