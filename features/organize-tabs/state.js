// Organize Tabs - State management
// Tracks layout snapshots for undo functionality

export const lastLayouts = {}; // windowId -> [{tabId, oldGroupId, oldIndex}]
export let lastLayoutSnapshot = null;

export function setLastLayoutSnapshot(snapshot) {
  lastLayoutSnapshot = snapshot;
}

export function getLastLayoutSnapshot() {
  return lastLayoutSnapshot;
}

export function saveLayoutForWindow(windowId, layout) {
  lastLayouts[windowId] = layout;
}

export function getLayoutForWindow(windowId) {
  return lastLayouts[windowId];
}

export function deleteLayoutForWindow(windowId) {
  delete lastLayouts[windowId];
}

// Intent classification cache
const intentCache = {}; // tabId -> { intent, confidence, timestamp, url }

export function getCachedIntent(tabId, currentUrl) {
  const cached = intentCache[tabId];
  if (!cached) return null;
  
  // Re-validate if URL changed or cache > 20 mins
  const age = Date.now() - cached.timestamp;
  const twentyMinutes = 20 * 60 * 1000;
  
  if (cached.url !== currentUrl || age > twentyMinutes) {
    delete intentCache[tabId];
    return null;
  }
  
  return cached;
}

export function cacheIntent(tabId, intent, confidence, url) {
  intentCache[tabId] = { intent, confidence, timestamp: Date.now(), url };
}

export function clearIntentCache() {
  Object.keys(intentCache).forEach(key => delete intentCache[key]);
}

// Topic group assignment cache
const topicGroupCache = {}; // tabId -> { groupName, confidence, timestamp, url }

export function getCachedTopicGroup(tabId, currentUrl) {
  const cached = topicGroupCache[tabId];
  if (!cached) return null;
  
  // Re-validate if URL changed or cache > 15 mins
  const age = Date.now() - cached.timestamp;
  const fifteenMinutes = 15 * 60 * 1000;
  
  if (cached.url !== currentUrl || age > fifteenMinutes) {
    delete topicGroupCache[tabId];
    return null;
  }
  
  return cached;
}

export function cacheTopicGroup(tabId, groupName, confidence, url) {
  topicGroupCache[tabId] = { groupName, confidence, timestamp: Date.now(), url };
}

export function clearTopicGroupCache() {
  Object.keys(topicGroupCache).forEach(key => delete topicGroupCache[key]);
}


