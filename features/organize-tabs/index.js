// Organize Tabs feature entry point
import { createGroupFor, getTargetWindowId, restoreLayoutFromSnapshot } from './utils.js';
import { initMetadataListeners } from './metadata.js';
import { organizeTabsByActivity, groupByActivity } from './by-activity.js';
import { organizeTabsByDomain, groupByDomain } from './by-domain.js';
import { groupBySessionTabs, groupBySession } from './by-session.js';
import { organizeByIntent, groupByIntent } from './by-intent.js';
import { saveLayoutForWindow, getLayoutForWindow, deleteLayoutForWindow, setLastLayoutSnapshot, getLastLayoutSnapshot } from './state.js';

// Initialize metadata listeners
initMetadataListeners();

// Main organize function that dispatches to different modes
export async function organizeTabs(mode) {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const windowId = tabs[0]?.windowId;
  
  // Save snapshot for undo
  const layout = tabs.map(t => ({ tabId: t.id, oldGroupId: t.groupId, oldIndex: t.index }));
  saveLayoutForWindow(windowId, layout);

  let clusters = {};
  switch (mode) {
    case 'intent':
      clusters = await groupByIntent(tabs);
      break;
    case 'activity':
      clusters = await groupByActivity(tabs);
      break;
    case 'session':
      clusters = await groupBySession(tabs);
      break;
    case 'domain':
      clusters = await groupByDomain(tabs);
      break;
    default:
      clusters = await groupByDomain(tabs);
      break;
  }

  const targetWindowId = await getTargetWindowId();

  for (const [groupLabel, group] of Object.entries(clusters)) {
    const { tabIds = [], color, title } = group;
    if (!tabIds.length) continue;

    try {
      await createGroupFor(
        targetWindowId,
        title || groupLabel,
        color || 'blue',
        tabIds
      );
    } catch (e) {
      console.warn('Failed to create group', groupLabel, e);
    }
  }
  
  return { ok: true };
}

// Undo/Restore Last Layout
export async function undoLastLayout(windowId) {
  const snapshot = getLayoutForWindow(windowId);
  if (!snapshot) return false;
  
  // Ungroup all tabs first
  await chrome.tabs.ungroup(snapshot.map(s => s.tabId));
  
  // Optionally, move back to previous positions (Chrome API quirk: this may not always be perfect)
  for (const { tabId, oldIndex } of snapshot) {
    try {
      await chrome.tabs.move(tabId, { index: oldIndex });
    } catch {}
  }
  
  // try to restore group ids (skipped for now, Chrome groups can't be recreated exactly)
  deleteLayoutForWindow(windowId);
  return true;
}

// Message handlers
export function handleOrganizeTabsMessage(msg) {
  switch (msg.type) {
    case "ORGANIZE_TABS":
      return (async () => {
        try {
          if (msg.mode === "activity") {
            const res = await organizeTabsByActivity();
            return { ok: res.ok, detail: res };
          }
          if (msg.mode === "domain") {
            const res = await organizeTabsByDomain();
            return { ok: res.ok, detail: res };
          }
          if (msg.mode === "session") {
            const res = await groupBySessionTabs();
            return { ok: res.ok, detail: res };
          }
          if (msg.mode === "intent") {
            const res = await organizeByIntent();
            return { ok: res.ok, detail: res };
          }
          // Default: use generic organizeTabs with mode
          await organizeTabs(msg.mode);
          return { ok: true };
        } catch (err) {
          return { ok: false, error: String(err?.message || err) };
        }
      })();


    case "USER_HINT_DOMAIN_GROUP":
      return (async () => {
        try {
          if (msg.domain && msg.group) {
            // Store user hints for domain-to-group mappings
            // Store user hints if needed
            await chrome.storage.local.set({ domainToGroup: { [msg.domain]: msg.group } });
            return { ok: true };
          } else {
            return { ok: false, error: 'missing_domain_or_group' };
          }
        } catch (err) {
          return { ok: false, error: String(err?.message || err) };
        }
      })();

    case "UNDO_LAST_LAYOUT":
      return (async () => {
        try {
          const win = await chrome.windows.getLastFocused();
          await restoreLayoutFromSnapshot(getLastLayoutSnapshot());
          return { ok: true };
        } catch (err) {
          return { ok: false, error: String(err?.message || err) };
        }
      })();

    case "UNGROUP_TAB":
      return chrome.tabs.ungroup([msg.tabId])
        .then(() => ({ ok: true }))
        .catch(err => ({ ok: false, error: String(err?.message || err) }));


  }
  
  return null; // Not handled by this module
}

// Initialize organize tabs module
export function init() {
  // Module is initialized via initMetadataListeners() which is called at module load
  // This is a no-op for now but provides consistent init interface
}

// Export all organize functions for direct use
export {
  organizeTabsByActivity,
  organizeTabsByDomain,
  groupBySessionTabs,
  organizeByIntent
};

