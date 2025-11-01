// Organize Tabs - By Session
// Groups tabs by when they were last visited: Today, Yesterday, Last Week, Older

import { createGroupFor, moveGroupToIndex, snapshotCurrentLayout, isHttpLike } from './utils.js';
import { setLastLayoutSnapshot } from './state.js';
import { ensureMeta, getTabMeta } from './metadata.js';

const log = (...a) => console.log("[Tabitha::organize-session]", ...a);

const ONE_DAY = 24 * 60 * 60 * 1000;

export function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function startOfYesterday() {
  return startOfToday() - ONE_DAY;
}

export function startOfLastWeek() {
  return startOfToday() - 7 * ONE_DAY;
}

// Return the most recent visit before cutoff (if any)
async function lastVisitBefore(url, cutoffMs) {
  try {
    const visits = await chrome.history.getVisits({ url });
    if (!visits || !visits.length) return null;
    visits.sort((a, b) => b.visitTime - a.visitTime);
    const before = visits.find(v => v.visitTime < cutoffMs);
    return before ? before.visitTime : visits[0].visitTime;
  } catch {
    return null;
  }
}

export async function groupBySessionTabs() {
  const win = await chrome.windows.getLastFocused({ populate: true });
  if (!win?.tabs?.length) return { ok: false, reason: "No tabs" };
  
  const snapshot = await snapshotCurrentLayout(win.id);
  setLastLayoutSnapshot(snapshot);
  const today0 = startOfToday();
  const yest0 = startOfYesterday();
  const week0 = startOfLastWeek();

  // Get tab history lookups
  const results = await Promise.allSettled(
    win.tabs.filter(t => !t.pinned && isHttpLike(t.url)).map(async (t) => {
      const url = t.url || "";
      const ts = await lastVisitBefore(url, today0);
      return { tab: t, ts };
    })
  );

  const todays = [];
  const ydays = [];
  const week = [];
  const older = [];

  // Get tab metadata for fallback when history is unavailable
  const tabMeta = getTabMeta();

  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    const { tab, ts } = r.value;
    
    // Use visit timestamp if available, otherwise fallback to tab creation time
    let when;
    if (ts !== null && ts !== undefined) {
      when = ts; // Use history visit time
    } else {
      // Fallback to tab metadata (when tab was created/opened)
      const meta = ensureMeta(tab.id);
      when = meta.createdAt || tab.lastAccessed || Date.now();
      log(`Tab ${tab.id} has no history, using createdAt: ${when} (${new Date(when).toISOString()})`);
    }
    
    if (when >= today0) {
      todays.push(tab);
    } else if (when >= yest0) {
      ydays.push(tab);
    } else if (when >= week0) {
      week.push(tab);
    } else {
      older.push(tab); // More than a week ago
    }
  }

  // Ungroup involved tabs
  const moveIds = [...todays, ...ydays, ...week, ...older].map(t => t.id);
  await Promise.all(moveIds.map(id => chrome.tabs.ungroup(id).catch(() => {})));

  const createdArr = [];
  if (todays.length) {
    createdArr.push({
      groupId: await createGroupFor(win.id, "Today's Flow", "blue", todays.map(t => t.id)),
      tabs: todays
    });
  }
  if (ydays.length) {
    createdArr.push({
      groupId: await createGroupFor(win.id, "Yesterday's Trail", "purple", ydays.map(t => t.id)),
      tabs: ydays
    });
  }
  if (week.length) {
    createdArr.push({
      groupId: await createGroupFor(win.id, "Last Week", "green", week.map(t => t.id)),
      tabs: week
    });
  }
  if (older.length) {
    createdArr.push({
      groupId: await createGroupFor(win.id, "Older", "grey", older.map(t => t.id)),
      tabs: older
    });
  }

  // Order: Today, Yesterday, Last Week
  const fresh = await chrome.tabs.query({ windowId: win.id });
  const involved = fresh.filter(t => moveIds.includes(t.id));
  let anchor = involved.length ? Math.min(...involved.map(t => t.index)) : 0;

  for (const g of createdArr) {
    await moveGroupToIndex(g.groupId, anchor);
    anchor += g.tabs.length;
  }

  return {
    ok: true,
    counts: { today: todays.length, yesterday: ydays.length, lastWeek: week.length, older: older.length }
  };
}

export async function groupBySession(tabs) {
  // Returns cluster structure for use in organizeTabs()
  // Stub implementation - uses today's date as heuristic
  return { "Today": { tabIds: tabs.map(t => t.id), color: 'yellow' } };
}

