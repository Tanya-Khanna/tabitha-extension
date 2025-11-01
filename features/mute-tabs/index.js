// Mute Tabs feature entry point
import { state, isMeetingTabLike, saveSettings } from './state.js';
import { refreshAllTabs, detectMeeting, autoMuteForMeeting, safeAutoMute, computeNoiseSituation, unmuteAllAutoMuted, loadSettings } from './core.js';
import { showMeetingNudgeNotification, setupNotificationHandlers } from './notifications.js';
import { getDomain } from '../../shared/utils.js';
import { BUZZY_DOMAINS_DEFAULT } from '../../shared/config.js';
import { log } from '../../shared/utils.js';

// meetingNotified is now managed in core.js
import { getMeetingNotified, setMeetingNotified } from './core.js';

// Setup notification handlers
setupNotificationHandlers(autoMuteForMeeting);

// Event listeners
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!state.tabs.has(tabId)) state.tabs.set(tabId, {});
  const entry = state.tabs.get(tabId);
  if ("title" in changeInfo) entry.title = changeInfo.title;
  if ("url" in changeInfo) entry.url = changeInfo.url;
  if ("audible" in changeInfo) entry.audible = !!changeInfo.audible;
  if ("mutedInfo" in changeInfo) entry.muted = !!(changeInfo.mutedInfo && changeInfo.mutedInfo.muted);

  // Re-check meeting
  const meetingChanged = detectMeeting();
  if (meetingChanged && state.meetingTabId && state.settings.autoMuteDuringMeetings) {
    autoMuteForMeeting();
  }
});

chrome.tabs.onActivated.addListener(async () => {
  await refreshAllTabs();
  // Meeting detection and notification handled in refreshAllTabs()
});

chrome.tabs.onRemoved.addListener((tabId) => {
  state.tabs.delete(tabId);
  state.mutedByTabitha.delete(tabId);
  if (state.meetingTabId === tabId) state.meetingTabId = null;
});

chrome.windows.onFocusChanged.addListener(async () => {
  await refreshAllTabs();
});

// Add tabGroups listener for group switches
chrome.tabGroups?.onUpdated.addListener(async () => {
  await refreshAllTabs();
});

// Startup kick - works right after install/reload
chrome.runtime.onStartup?.addListener(async () => {
  await refreshAllTabs();
});

chrome.runtime.onInstalled?.addListener(async () => {
  await refreshAllTabs();
});

// Periodic heartbeat to catch missed audible flips
chrome.alarms.create('muteHeartbeat', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'muteHeartbeat') {
    await refreshAllTabs();
  }
});

// Load settings on startup
loadSettings();

// Message handlers
export function handleMuteTabsMessage(msg) {
  switch (msg.type) {
    case "GET_SETTINGS":
      return Promise.resolve({ ok: true, settings: state.settings });

    case "TOGGLE_AUTOMUTE":
      state.settings.autoMuteDuringMeetings = !!msg.enabled;
      return saveSettings().then(() => ({ ok: true, settings: state.settings }));

    case "GET_DASHBOARD":
      return refreshAllTabs().then(() => {
        const meetingId = state.meetingTabId;
        const sounding = [];
        const silent = [];
        for (const t of state.tabs.values()) {
          const entry = {
            id: t.id,
            title: t.title,
            url: t.url,
            domain: getDomain(t.url),
            audible: t.audible,
            muted: t.muted,
            meeting: t.id === meetingId,
            label: ""
          };
          if (entry.meeting) {
            entry.label = "Priority tab (meeting) — Keep Live";
            sounding.unshift(entry);
            continue;
          }
          if (t.audible && !t.muted) {
            entry.label = "Sounding";
            sounding.push(entry);
            continue;
          }
          if (t.muted) {
            entry.label = state.mutedByTabitha.has(t.id)
              ? "Muted by Tabitha (auto)"
              : "Muted by user";
            silent.push(entry);
            continue;
          }
          const domain = entry.domain;
          if (BUZZY_DOMAINS_DEFAULT.includes(domain) || state.autoMutePreferredDomains.has(domain)) {
            entry.label = "Quiet (likely to chime)";
            silent.push(entry);
          }
        }
        return {
          ok: true,
          meeting: meetingId,
          summary: {
            soundingCount: sounding.filter(x => x.audible && !x.muted).length,
            mutedByTabithaCount: Array.from(state.mutedByTabitha).length
          },
          sounding,
          silent,
          autoMuteDuringMeetings: state.settings.autoMuteDuringMeetings
        };
      });

    case "MUTE_TAB":
      return chrome.tabs.update(msg.id, { muted: true }).then(() => {
        state.mutedByTabitha.add(msg.id);
        if (msg.byUser) state.mutedByTabitha.delete(msg.id);
        return { ok: true };
      }).catch(err => ({ ok: false, error: String(err?.message || err) }));

    case "UNMUTE_TAB":
      return chrome.tabs.update(msg.id, { muted: false }).then(() => {
        state.mutedByTabitha.delete(msg.id);
        return { ok: true };
      }).catch(err => ({ ok: false, error: String(err?.message || err) }));

    case "USER_MUTED_DURING_MEETING":
      const { url } = msg;
      const domain = getDomain(url);
      if (state.meetingTabId && domain) {
        state.domainMuteCount[domain] = (state.domainMuteCount[domain] || 0) + 1;
        if (state.domainMuteCount[domain] >= 3) {
          state.autoMutePreferredDomains.add(domain);
          return chrome.storage.local.set({
            autoMutePreferredDomains: Array.from(state.autoMutePreferredDomains)
          }).then(() => ({ ok: true }));
        }
      }
      return Promise.resolve({ ok: true });

    case "UNMUTE_ALL_AUTOMUTED":
      unmuteAllAutoMuted();
      return Promise.resolve({ ok: true });

    case "AUTO_MUTE_FOR_MEETING":
      return autoMuteForMeeting().then(() => ({ ok: true }));

    case "TEST_NOTIFICATION":
      log("Testing notification from popup...");
      showMeetingNudgeNotification(true);
      return Promise.resolve({ ok: true });
  }
  return null; // Not handled by this module
}

export { state, refreshAllTabs };

// Initialize mute tabs module
export function init() {
  // Module initializes itself via:
  // - setupNotificationHandlers() called at module load
  // - Event listeners registered at module load
  // - loadSettings() called at module load
  // This is a no-op for now but provides consistent init interface
}

