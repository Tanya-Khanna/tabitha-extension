// Organize Tabs - By Activity
// Groups tabs by activity level: Active Now, Recently Used, Frequently Used

import { createGroupFor, moveGroupToIndex, snapshotCurrentLayout } from './utils.js';
import { ensureMeta, minutesSince, hoursSince, getTabMeta } from './metadata.js';
import { setLastLayoutSnapshot } from './state.js';

const ACTIVITY_CFG = {
  ACTIVE_MINUTES: 60,     // last focused within 60m
  RECENT_HOURS: 6,        // last focused within 6h
  ACTIVE_CAP: 7,          // at most N tabs in Active Now
  HISTORY_LOOKBACK_DAYS: 7,
  HISTORY_MIN_VISITS: 5,
};

async function buildHistoryCounts() {
  const startTime = Date.now() - ACTIVITY_CFG.HISTORY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const results = await chrome.history.search({
    text: "",
    startTime,
    maxResults: 5000
  });
  const urlCount = new Map();
  for (const r of results) {
    let u;
    try {
      u = new URL(r.url);
    } catch {
      continue;
    }
    u.hash = "";
    const key = u.toString();
    urlCount.set(key, (urlCount.get(key) || 0) + (r.visitCount || 1));
  }
  return urlCount;
}

export async function organizeTabsByActivity() {
  const win = await chrome.windows.getLastFocused({ populate: true });
  if (!win?.tabs?.length) return { ok: false, reason: "No tabs" };
  
  const snapshot = await snapshotCurrentLayout(win.id);
  setLastLayoutSnapshot(snapshot);
  const historyCounts = await buildHistoryCounts();
  const tabMeta = getTabMeta();
  
  const data = win.tabs
    .filter(t => !t.pinned)
    .map(t => {
      const meta = ensureMeta(t.id);
      const lastFocus = meta.lastFocusedAt || t.lastAccessed || 0;
      let key;
      try {
        const u = new URL(t.url);
        u.hash = "";
        key = u.toString();
      } catch {
        key = t.url;
      }
      const visits = historyCounts.get(key) || 0;
      return { tab: t, meta, lastFocus, visits };
    })
    .sort((a, b) => b.lastFocus - a.lastFocus); // newest focus first

  const active = [];
  const recent = [];
  const frequent = [];
  const other = [];

  for (const item of data) {
    const { tab, meta, lastFocus, visits } = item;
    const focusedRecently = lastFocus && minutesSince(lastFocus) <= ACTIVITY_CFG.ACTIVE_MINUTES;
    const engageOK = meta.everFocused || tab.active;
    
    if (focusedRecently && engageOK && active.length < ACTIVITY_CFG.ACTIVE_CAP) {
      active.push(tab);
      continue;
    }
    
    const recentWindow = lastFocus && hoursSince(lastFocus) <= ACTIVITY_CFG.RECENT_HOURS;
    const newButNotEngaged = !meta.everFocused && minutesSince(meta.createdAt || Date.now()) <= ACTIVITY_CFG.ACTIVE_MINUTES;
    
    if (recentWindow || newButNotEngaged) {
      recent.push(tab);
      continue;
    }
    
    if (visits >= ACTIVITY_CFG.HISTORY_MIN_VISITS) {
      frequent.push(tab);
    } else {
      other.push(tab);
    }
  }

  const buckets = [
    { title: "Active Now", color: "blue", tabs: active },
    { title: "Recently Used", color: "purple", tabs: recent },
    { title: "Frequently Used", color: "green", tabs: frequent },
  ];

  const regroupIds = buckets.flatMap(b => b.tabs.map(t => t.id));
  await Promise.all(regroupIds.map(id => chrome.tabs.ungroup(id).catch(() => {})));

  const created = [];
  for (const b of buckets) {
    if (!b.tabs.length) continue;
    const gid = await createGroupFor(win.id, b.title, b.color, b.tabs.map(t => t.id));
    created.push({ ...b, groupId: gid });
  }

  const fresh = await chrome.tabs.query({ windowId: win.id });
  const involved = fresh.filter(t => regroupIds.includes(t.id));
  let anchor = involved.length ? Math.min(...involved.map(t => t.index)) : 0;

  for (const g of created) {
    if (!g.groupId) continue;
    await moveGroupToIndex(g.groupId, anchor);
    anchor += g.tabs.length;
  }

  return {
    ok: true,
    counts: { active: active.length, recent: recent.length, frequent: frequent.length, other: other.length }
  };
}

export async function groupByActivity(tabs) {
  // Returns cluster structure for use in organizeTabs()
  return {
    "Active Now": { tabIds: tabs.slice(0, Math.ceil(tabs.length / 2)).map(t => t.id), color: 'green' },
    "Idle": { tabIds: tabs.slice(Math.ceil(tabs.length / 2)).map(t => t.id), color: 'grey' }
  };
}

