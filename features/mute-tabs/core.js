// Mute Tabs core functionality
import { state, isMeetingTabLike, saveSettings } from './state.js';
import { BUZZY_DOMAINS_DEFAULT } from '../../shared/config.js';
import { getDomain } from '../../shared/utils.js';
import { log } from '../../shared/utils.js';
import { showMeetingNudgeNotification } from './notifications.js';

let meetingNotified = false; // module-level, shared across detection
let autoMuting = false;

// Export getter/setter for meetingNotified
export function getMeetingNotified() { return meetingNotified; }
export function setMeetingNotified(value) { meetingNotified = value; }

export async function refreshAllTabs() {
  const tabs = await chrome.tabs.query({});
  const known = new Set();

  for (const t of tabs) {
    const info = {
      id: t.id,
      title: t.title,
      url: t.url,
      audible: !!t.audible,
      muted: !!(t.mutedInfo && t.mutedInfo.muted),
      active: !!t.active,
      windowId: t.windowId
    };
    state.tabs.set(t.id, info);
    known.add(t.id);
  }
  // prune removed
  for (const id of Array.from(state.tabs.keys())) {
    if (!known.has(id)) state.tabs.delete(id);
  }

  // after refresh, re-evaluate meeting + maybe apply policy
  const meetingChanged = detectMeeting();
  if (meetingChanged || state.meetingTabId) {
    if (state.meetingTabId) {
      log("Meeting detected on tab", state.meetingTabId);
      (async () => {
        const { shouldNotify, soundingCount, likelyToChimeCount } = await computeNoiseSituation();
        log('Noise summary:', { shouldNotify, soundingCount, likelyToChimeCount });
        if (state.settings.autoMuteDuringMeetings) {
          await safeAutoMute(); // always auto-mute first
        }
        if (shouldNotify && !meetingNotified) {
          // Check notification permission and show badge fallback if blocked
          chrome.notifications.getPermissionLevel((level) => {
            const hasNotificationPermission = level === 'granted';
            
            if (hasNotificationPermission) {
              showMeetingNudgeNotification(true, { soundingCount, likelyToChimeCount });
            } else {
              // Fallback: badge + store flag for popup snackbar
              chrome.action.setBadgeText({ text: "MEET" });
              chrome.action.setBadgeBackgroundColor({ color: "#0ea5e9" });
              chrome.storage.local.set({ 
                __tabithaMeetingDetected: Date.now(),
                __tabithaMeetingMutedCount: soundingCount + likelyToChimeCount
              });
            }
            meetingNotified = true;
          });
        }
      })();
    } else {
      log("Meeting ended");
      meetingNotified = false;
      chrome.action.setBadgeText({ text: "" });
      chrome.storage.local.remove(['__tabithaMeetingDetected', '__tabithaMeetingMutedCount']);
      chrome.notifications.getPermissionLevel((level) => {
        if (level === 'granted') {
          showMeetingNudgeNotification(false);
        }
      });
    }
  }
}

export function detectMeeting() {
  const prev = state.meetingTabId;
  // Prefer focused window + active tab if it's a meeting
  const activeMeeting = Array.from(state.tabs.values())
    .filter(t => t.active)
    .find(t => isMeetingTabLike(t));

  if (activeMeeting) {
    state.meetingTabId = activeMeeting.id;
  } else {
    // fallback: any audible meeting tab
    const audibleMeeting = Array.from(state.tabs.values())
      .find(t => t.audible && isMeetingTabLike(t));
    state.meetingTabId = audibleMeeting ? audibleMeeting.id : null;
  }

  // Reset meetingNotified when meeting changes
  const changed = prev !== state.meetingTabId;
  if (changed && state.meetingTabId) {
    meetingNotified = false; // new meeting -> allow notify once
  } else if (changed && !state.meetingTabId) {
    // Meeting ended
    meetingNotified = false;
  }

  // ensure meeting tab is unmuted (priority)
  if (state.meetingTabId && state.tabs.has(state.meetingTabId)) {
    const t = state.tabs.get(state.meetingTabId);
    if (t.muted) {
      chrome.tabs.update(t.id, { muted: false }).catch(() => {});
      state.mutedByTabitha.delete(t.id); // we want it live
    }
  }
  return changed;
}

export async function autoMuteForMeeting() {
  const meetingId = state.meetingTabId;
  if (!meetingId) {
    log("No meeting tab found, skipping auto-mute");
    return;
  }

  const meetingDomain = getDomain(state.tabs.get(meetingId)?.url);
  const preferDomains = new Set([
    ...BUZZY_DOMAINS_DEFAULT,
    ...state.autoMutePreferredDomains
  ]);
  
  log("Auto-muting for meeting, buzzy domains:", Array.from(preferDomains));

  for (const t of state.tabs.values()) {
    if (t.id === meetingId) continue;

    const domain = getDomain(t.url);
    const shouldMute =
      t.audible ||                       // currently making sound
      preferDomains.has(domain);         // likely to chime soon
    
    log(`Tab ${t.id} (${domain}): audible=${t.audible}, shouldMute=${shouldMute}, alreadyMuted=${t.muted}`);

    if (shouldMute && !t.muted) {
      try {
        await chrome.tabs.update(t.id, { muted: true });
        state.mutedByTabitha.add(t.id);
        log(`Muted tab ${t.id} (${domain})`);
      } catch (err) {
        log(`Failed to mute tab ${t.id}:`, err);
      }
    }
  }
}

export async function safeAutoMute(){
  if (autoMuting) return;
  autoMuting = true;
  try { await autoMuteForMeeting(); }
  finally { autoMuting = false; }
}

export async function computeNoiseSituation() {
  await refreshAllTabs(); // ensure fresh
  const meetingId = state.meetingTabId;
  if (!meetingId) return { shouldNotify:false, soundingCount:0, likelyToChimeCount:0 };

  let soundingCount = 0;
  let likelyToChimeCount = 0;
  for (const t of state.tabs.values()) {
    if (t.id === meetingId) continue;
    const domain = getDomain(t.url);
    const likely = BUZZY_DOMAINS_DEFAULT.includes(domain) || state.autoMutePreferredDomains.has(domain);
    if (t.audible && !t.muted) soundingCount += 1;
    else if (!t.muted && likely) likelyToChimeCount += 1;
  }
  const shouldNotify = (soundingCount > 0) || (likelyToChimeCount > 0);
  return { shouldNotify, soundingCount, likelyToChimeCount };
}

export function unmuteAllAutoMuted() {
  log("Unmuting all auto-muted tabs:", Array.from(state.mutedByTabitha));
  for (const id of Array.from(state.mutedByTabitha)) {
    chrome.tabs.update(id, { muted: false }).then(() => {
      log(`Unmuted tab ${id}`);
    }).catch((err) => {
      log(`Failed to unmute tab ${id}:`, err);
    });
  }
  state.mutedByTabitha.clear();
}

export async function loadSettings() {
  const { settings = {} } = await chrome.storage.sync.get("settings");
  Object.assign(state.settings, settings);
}

