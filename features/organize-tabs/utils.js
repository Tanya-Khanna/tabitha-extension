// Organize Tabs - Shared utilities
import { getDomain, getBaseDomain, log } from '../../shared/utils.js';

export function safeURL(u) {
  try {
    const x = new URL(u);
    x.hash = "";
    return x;
  } catch {
    return null;
  }
}

export function hostOf(u) {
  return getBaseDomain(u);
}

export function isHttpLike(u) {
  return /^https?:/i.test(u || '');
}

export function niceDomain(dom) {
  if (dom.endsWith('google.com')) return 'Google';
  if (dom.endsWith('youtube.com')) return 'YouTube';
  if (dom.endsWith('notion.so')) return 'Notion';
  return dom;
}

export function pickColorForDomain(dom) {
  const colors = ['blue', 'green', 'yellow', 'red', 'purple', 'cyan', 'pink', 'grey'];
  let h = 0;
  for (let i = 0; i < dom.length; i++) {
    h = (h * 31 + dom.charCodeAt(i)) >>> 0;
  }
  return colors[h % colors.length];
}

export function pickColorForName(name) {
  const colors = ['blue', 'cyan', 'green', 'yellow', 'orange', 'red', 'pink', 'purple', 'grey'];
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return colors[h % colors.length];
}

// Ensure all tabs are in one window, then group and style
export async function createGroupFor(windowId, title, color, tabIds) {
  if (!Array.isArray(tabIds) || tabIds.length === 0) return null;

  // 1) Move tabs to the target window FIRST (group() requires same window)
  for (const id of tabIds) {
    const t = await chrome.tabs.get(id);
    if (t.windowId !== windowId) {
      await chrome.tabs.move(id, { windowId, index: -1 });
    }
  }

  // 2) Group them (returns groupId)
  const groupId = await chrome.tabs.group({ tabIds });

  // 3) Style the group (title/color)
  await chrome.tabGroups.update(groupId, {
    title: (title || '').slice(0, 40),
    color: color || 'blue',
  });

  return groupId;
}

// Pick a target window (active/current is fine for now)
export async function getTargetWindowId() {
  const w = await chrome.windows.getCurrent();
  return w.id;
}

export async function moveGroupToIndex(groupId, targetIndex) {
  const tabs = await chrome.tabs.query({ groupId });
  if (!tabs.length) return;
  const firstTabId = tabs[0].id;
  await chrome.tabs.move(firstTabId, { index: targetIndex });
}

export async function snapshotCurrentLayout(windowId) {
  const tabs = await chrome.tabs.query({ windowId });
  return tabs.map(t => ({
    id: t.id,
    index: t.index,
    groupId: t.groupId
  })).sort((a, b) => a.index - b.index);
}

export async function restoreLayoutFromSnapshot(snapshot) {
  if (!snapshot) return;
  for (const entry of snapshot) {
    try {
      await chrome.tabs.move(entry.id, { index: entry.index });
      if (entry.groupId >= 0) {
        try {
          await chrome.tabs.group({ groupId: entry.groupId, tabIds: entry.id });
        } catch {}
      } else {
        await chrome.tabs.ungroup(entry.id).catch(() => {});
      }
    } catch {}
  }
}

export function toastFromBG(text) {
  try {
    chrome.runtime.sendMessage({ type: 'BG_TOAST', text });
  } catch {}
}

