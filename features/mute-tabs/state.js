// Mute Tabs state management
import { MEETING_DOMAINS, BUZZY_DOMAINS_DEFAULT } from '../../shared/config.js';
import { getDomain } from '../../shared/utils.js';

export const state = {
  tabs: new Map(),             // tabId -> {id,title,url,audible,muted,active,windowId}
  meetingTabId: null,          // current meeting tabId (or null)
  mutedByTabitha: new Set(),   // tabIds this session auto-muted by us
  // learned preferences (domain -> count)
  domainMuteCount: {},         // increments when user mutes during meeting
  autoMutePreferredDomains: new Set(), // domains we'll pre-mute in meetings
  settings: {
    autoMuteDuringMeetings: true
  }
};

export function isMeetingTabLike(tab) {
  const domain = getDomain(tab.url || '');
  return MEETING_DOMAINS.some(md => domain.includes(md));
}

export function saveSettings() {
  return chrome.storage.local.set({
    autoMuteDuringMeetings: state.settings.autoMuteDuringMeetings,
    autoMutePreferredDomains: Array.from(state.autoMutePreferredDomains)
  });
}

