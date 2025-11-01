// Mute Tabs notifications
import { state } from './state.js';
import { log } from '../../shared/utils.js';
import { unmuteAllAutoMuted } from './core.js';

const NOTE_ID = "tabitha-meeting-note";

export function showMeetingNudgeNotification(meetingStarted, counts) {
  chrome.notifications.getPermissionLevel((level) => {
    if (level !== "granted") {
      log("Notifications not granted; skipping system notification");
      return;
    }
    if (meetingStarted) {
      const sounding = counts?.soundingCount || 0;
      const likely   = counts?.likelyToChimeCount || 0;
      const message = state.settings.autoMuteDuringMeetings
        ? `Muted ${sounding} sounding tab(s).${likely ? ` ${likely} likely to chime.` : ''}`
        : `Detected ${sounding} sounding tab(s)${likely ? ` + ${likely} likely to chime` : ''}.`;
      chrome.notifications.create(NOTE_ID, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "🎙️ Meeting detected",
        message,
        buttons: state.settings.autoMuteDuringMeetings
          ? [{ title: "Unmute all" }]
          : [{ title: "Mute others" }, { title: "Ignore" }],
        priority: 1,
        requireInteraction: true
      });
    } else {
      chrome.notifications.create(NOTE_ID, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "Meeting ended",
        message: "Unmute tabs that were silenced?",
        buttons: [{ title: "Unmute all" }, { title: "Keep muted" }],
        priority: 1,
        requireInteraction: true
      });
    }
  });
}

export function setupNotificationHandlers(autoMuteForMeeting) {
  chrome.notifications.onButtonClicked.addListener((notifId, btnIndex) => {
    log("Notification button clicked:", { notifId, btnIndex, meetingTabId: state.meetingTabId });
    if (notifId !== NOTE_ID) return;
    // Meeting started
    if (state.meetingTabId) {
      if (!state.settings.autoMuteDuringMeetings && btnIndex === 0) {
        log("Auto-muting for meeting");
        autoMuteForMeeting();
      }
      // Ignore path (btnIndex === 1) does nothing
    } else {
      // Meeting ended
      if (btnIndex === 0) {
        log("Unmuting all auto-muted tabs");
        unmuteAllAutoMuted();
      } else {
        log("Keeping tabs muted");
      }
    }
    chrome.notifications.clear(NOTE_ID);
  });
}

