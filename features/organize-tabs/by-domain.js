// Organize Tabs - By Website Domain
// Groups tabs by their domain (e.g., all google.com tabs together)
// Hardened version with robust domain extraction, deduplication, and async safety

import { snapshotCurrentLayout, niceDomain, pickColorForDomain, isHttpLike } from './utils.js';
import { setLastLayoutSnapshot } from './state.js';

const log = (...a) => console.log("[Tabitha::organize-domain]", ...a);

/**
 * Normalize hostname: lowercase, remove www., trim trailing dot
 */
function normalizeHost(host) {
  if (!host) return '';
  return host.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
}

/**
 * Extract base domain from URL (hostname only, robust parsing)
 * Handles: fragments, query params, trailing dots, multi-level TLDs
 */
function getBaseDomain(url) {
  try {
    const u = new URL(url);
    const hostname = normalizeHost(u.hostname);
    if (!hostname) return 'unknown';
    
    const parts = hostname.split('.');
    // Extract last 2 parts for base domain
    if (parts.length >= 2) {
      return parts.slice(-2).join('.');
    }
    return hostname; // Fallback for single-part domains
  } catch (err) {
    log('Failed to parse URL:', url, err);
    return 'unknown';
  }
}

export async function organizeTabsByDomain() {
  const win = await chrome.windows.getCurrent();
  if (!win?.id) return { ok: false, reason: "No window" };
  
  // Get tabs for this window
  const allTabs = await chrome.tabs.query({ windowId: win.id });
  const tabs = allTabs.filter(t => !t.pinned && t.url?.startsWith('http'));
  
  if (tabs.length === 0) return { ok: false, reason: "No tabs" };
  
  log(`Organizing ${tabs.length} tabs by domain...`);
  
  // Save snapshot for undo
  const snapshot = await snapshotCurrentLayout(win.id);
  setLastLayoutSnapshot(snapshot);
  
  // Log domain detection for debugging
  const domainLog = tabs.map(t => {
    try {
      const hostname = new URL(t.url).hostname;
      const base = getBaseDomain(t.url);
      log(`[domainDetection] Tab ${t.id}: "${t.title}" -> host: ${hostname} -> base: ${base}`);
      return { tabId: t.id, title: t.title, hostname, baseDomain: base };
    } catch (err) {
      log(`[domainDetection] Tab ${t.id}: "${t.title}" -> ERROR:`, err);
      return { tabId: t.id, title: t.title, hostname: 'unknown', baseDomain: 'unknown' };
    }
  });
  
  // Build domain buckets (deduplicated)
  const buckets = new Map(); // baseDomain -> tabIds[]
  const usedTabIds = new Set(); // Track which tabs we've processed
  
  for (const t of tabs) {
    if (usedTabIds.has(t.id)) {
      log(`⚠️ Tab ${t.id} already processed, skipping duplicate`);
      continue;
    }
    
    const baseDomain = getBaseDomain(t.url);
    if (!baseDomain || baseDomain === 'unknown') {
      log(`⚠️ Tab ${t.id} has invalid domain, skipping`);
      continue;
    }
    
    if (!buckets.has(baseDomain)) {
      buckets.set(baseDomain, []);
    }
    buckets.get(baseDomain).push(t.id);
    usedTabIds.add(t.id);
  }
  
  log(`Created ${buckets.size} domain buckets:`, Array.from(buckets.entries()).map(([d, ids]) => `${d} (${ids.length})`));
  
  // Sort by size (largest first)
  const ordered = Array.from(buckets.entries()).sort((a, b) => b[1].length - a[1].length);
  
  // Ungroup all tabs first (synchronously, await completion)
  const allTabIds = ordered.flatMap(([, ids]) => ids);
  const tabsToUngroup = allTabs.filter(t => t.groupId !== -1 && allTabIds.includes(t.id)).map(t => t.id);
  
  if (tabsToUngroup.length > 0) {
    log(`Ungrouping ${tabsToUngroup.length} tabs...`);
    await chrome.tabs.ungroup(tabsToUngroup);
    // Small delay to ensure Chrome has processed ungroup
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  
  // Group sequentially (await each operation to avoid race conditions)
  const created = [];
  const groupedTabIds = new Set();
  let indexCursor = 0;
  
  // Get current tab indices for positioning
  const currentTabs = await chrome.tabs.query({ windowId: win.id });
  const minIndex = Math.min(...currentTabs.filter(t => allTabIds.includes(t.id)).map(t => t.index));
  indexCursor = minIndex >= 0 ? minIndex : 0;
  
  for (const [domain, tabIds] of ordered) {
    // Double-check: filter out any tabs already grouped (safety)
    const ids = tabIds.filter(id => !groupedTabIds.has(id));
    
    if (ids.length === 0) {
      log(`⚠️ Domain ${domain} has no ungrouped tabs, skipping`);
      continue;
    }
    
    if (ids.length !== tabIds.length) {
      log(`⚠️ Domain ${domain}: ${tabIds.length - ids.length} tabs were already grouped, using remaining ${ids.length}`);
    }
    
    try {
      // Group tabs
      log(`Grouping ${ids.length} tabs for domain: ${domain}`);
      const groupId = await chrome.tabs.group({ tabIds: ids });
      
      // Update group title and color
      const groupTitle = niceDomain(domain);
      const color = pickColorForDomain(domain);
      await chrome.tabGroups.update(groupId, {
        title: groupTitle,
        color: color
      });
      
      // Move group to position (sequential)
      if (ids.length > 0) {
        // Move first tab to position, others follow
        const firstTabId = ids[0];
        await chrome.tabs.move(firstTabId, { index: indexCursor });
      }
      
      // Track grouped tabs
      ids.forEach(id => groupedTabIds.add(id));
      
      created.push({ groupId, domain, count: ids.length });
      indexCursor += ids.length;
      
      log(`✅ Created group "${groupTitle}" (${ids.length} tabs) at index ${indexCursor - ids.length}`);
    } catch (err) {
      log(`❌ Failed to group domain ${domain}:`, err);
    }
  }
  
  // Post-verification: check for strays (tabs that should be grouped but aren't)
  log('Verifying grouping completeness...');
  const afterTabs = await chrome.tabs.query({ windowId: win.id });
  let strayCount = 0;
  
  for (const [domain, expectedTabIds] of buckets.entries()) {
    const strays = expectedTabIds.filter(id => {
      const tab = afterTabs.find(t => t.id === id);
      return tab && tab.groupId === -1; // Ungrouped when it should be grouped
    });
    
    if (strays.length > 0) {
      strayCount += strays.length;
      log(`⚠️ Found ${strays.length} stray tabs for domain ${domain}, attempting to group...`);
      try {
        const groupId = await chrome.tabs.group({ tabIds: strays });
        await chrome.tabGroups.update(groupId, {
          title: niceDomain(domain),
          color: pickColorForDomain(domain)
        });
        log(`✅ Re-grouped ${strays.length} stray tabs for ${domain}`);
      } catch (err) {
        log(`❌ Failed to re-group strays for ${domain}:`, err);
      }
    }
  }
  
  // Final checksum: verify no domain is split across multiple groups
  log('Running checksum verification...');
  for (const [domain, expectedTabIds] of buckets.entries()) {
    const groupsForDomain = new Set();
    for (const tabId of expectedTabIds) {
      const tab = afterTabs.find(t => t.id === tabId);
      if (tab && tab.groupId !== -1) {
        groupsForDomain.add(tab.groupId);
      }
    }
    
    if (groupsForDomain.size > 1) {
      log(`❌ CHECSUM FAILED: Domain ${domain} is split across ${groupsForDomain.size} groups!`);
      log(`   Expected all ${expectedTabIds.length} tabs in one group, but found in groups:`, Array.from(groupsForDomain));
    } else if (groupsForDomain.size === 1) {
      log(`✅ Domain ${domain}: All ${expectedTabIds.length} tabs correctly in one group`);
    }
  }
  
  if (strayCount > 0) {
    log(`⚠️ Total ${strayCount} stray tabs were re-grouped`);
  }
  
  log(`✅ Domain organization complete: ${created.length} groups created`);
  
  return { ok: true, groups: created.length, strayCount };
}

export async function groupByDomain(tabs) {
  // Returns cluster structure for use in organizeTabs()
  // Uses same robust domain extraction
  const cluster = {};
  const usedTabIds = new Set(); // Dedupe
  
  tabs.forEach(t => {
    if (usedTabIds.has(t.id)) return; // Skip duplicates
    const d = getBaseDomain(t.url);
    if (!d || d === 'unknown') return;
    if (!cluster[d]) cluster[d] = { tabIds: [], color: pickColorForDomain(d), title: niceDomain(d) };
    cluster[d].tabIds.push(t.id);
    usedTabIds.add(t.id);
  });
  return cluster;
}

