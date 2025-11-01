// Chat with your Tabs - Action Layer
// Executes user intents: open, close, find_open, reopen, save, show, ask, mute, unmute, pin, unpin, reload, discard
// Handles tab activation, closing, bookmarking, muting, pinning, reloading, discarding, and conversational questions

import { structuredLog, recordTelemetry, normalizeUrl, addUndoEntry, getLatestUndoEntry, postToOffscreen } from './utils.js';
import { formatAge } from './search.js';
import { formatConversationForPrompt, getChatSessionId } from './conversation.js';
import { Indexer } from './indexer.js';

const log = (...a) => console.log("[Tabitha::chat]", ...a);

// Global flag (will be set by index.js)
let __INDEXER_BOOTED__ = false;
export function setIndexerBooted(flag) {
  __INDEXER_BOOTED__ = flag;
}

// Helper to get card by cardId from Indexer cache
function IndexerCardById(cardId) {
  if (!cardId) return null;
  return Indexer._get(cardId) || null;
}

// ==== PHASE 6: OPEN ACTION ====
export async function executeOpenAction(cardId, nextToCurrent = false, intent = null, requestId = null) {
  try {
    structuredLog('Phase 6', 'action_started', {
      intent: 'open',
      requestId,
      cardId,
      nextToCurrent
    });
    
    if (!__INDEXER_BOOTED__) {
      __INDEXER_BOOTED__ = true;
      await Indexer.init();
    }
    
    const targetCard = IndexerCardById(cardId);
    if (!targetCard) {
      return { ok: false, error: 'card_not_found' };
    }
    
    // If groupHint is present, try to find and focus the group first
    if (intent?.constraints?.group) {
      try {
        const groupTitle = intent.constraints.group;
        const allGroups = await chrome.tabGroups.query({});
        const matchingGroup = allGroups.find(g => 
          g.title && g.title.toLowerCase().includes(groupTitle.toLowerCase())
        );
        
        if (matchingGroup) {
          const groupTabs = await chrome.tabs.query({ groupId: matchingGroup.id });
          if (groupTabs.length > 0) {
            let tabToActivate = groupTabs[0];
            if (targetCard && targetCard.tabId) {
              const matchingTab = groupTabs.find(t => t.id === targetCard.tabId);
              if (matchingTab) {
                tabToActivate = matchingTab;
              }
            }
            
            await chrome.windows.update(tabToActivate.windowId, { focused: true });
            await chrome.tabs.update(tabToActivate.id, { active: true });
            
            structuredLog('Phase 6', 'execute_action', {
              intent: 'open',
              result: 'success',
              action: 'focused_group',
              groupId: matchingGroup.id,
              groupTitle: matchingGroup.title,
              tabId: tabToActivate.id
            });
            return { ok: true, tabId: tabToActivate.id, activated: true, groupFocused: true };
          }
        }
      } catch (groupErr) {
        log('Group focus failed, continuing with normal open:', groupErr);
      }
    }
    
    if (!targetCard || !targetCard.url) {
      return { ok: false, error: 'card_not_found_or_no_url' };
    }
    
    // SPEED: Parallelize Chrome API calls (active tab query + group check + tab existence check)
    let nextToCurrentIndex = undefined;
    const activeTabPromise = nextToCurrent ? chrome.tabs.query({ active: true, currentWindow: true }) : Promise.resolve([]);
    const groupCheckPromise = intent?.constraints?.group ? chrome.tabGroups.query({}) : Promise.resolve([]);
    const tabCheckPromise = targetCard.source === 'tab' && targetCard.tabId ? chrome.tabs.get(targetCard.tabId).catch(() => null) : Promise.resolve(null);
    const windowCheckPromise = targetCard.source === 'tab' && targetCard.tabId ? chrome.windows.get(targetCard.windowId || -1).catch(() => null) : Promise.resolve(null);
    
    const [activeTabs, allGroups, existingTab, windowInfo] = await Promise.all([
      activeTabPromise,
      groupCheckPromise,
      tabCheckPromise,
      windowCheckPromise
    ]);
    
    if (nextToCurrent && activeTabs.length > 0) {
      const activeTab = activeTabs[0];
      nextToCurrentIndex = activeTab.index + 1;
    }
    
    // Check if the tab is already open
    if (targetCard.source === 'tab' && targetCard.tabId && existingTab) {
      try {
        
        if (nextToCurrent) {
          // SPEED: Parallelize move, window update, and tab update
          await Promise.all([
            chrome.tabs.move(targetCard.tabId, { index: nextToCurrentIndex }),
            chrome.windows.update(existingTab.windowId, { focused: true }),
            chrome.tabs.update(targetCard.tabId, { active: true })
          ]);
          
          recordTelemetry('actions', 'open', true);
          structuredLog('Phase 6', 'execute_action', {
            intent: 'open',
            targetUrl: targetCard.url,
            result: 'success',
            action: 'moved_to_next_to_current',
            tabId: targetCard.tabId
          });
          return { ok: true, tabId: targetCard.tabId, url: targetCard.url, activated: true, moved: true };
        } else {
          // SPEED: Parallelize window update and tab update
          await Promise.all([
            chrome.windows.update(existingTab.windowId, { focused: true }),
            chrome.tabs.update(targetCard.tabId, { active: true })
          ]);
          
          recordTelemetry('actions', 'open', true);
          structuredLog('Phase 6', 'execute_action', {
            intent: 'open',
            targetUrl: targetCard.url,
            result: 'success',
            action: 'activated_existing',
            tabId: targetCard.tabId
          });
          return { ok: true, tabId: targetCard.tabId, url: targetCard.url, activated: true };
        }
      } catch (tabErr) {
        log('Tab not found, opening new tab:', tabErr);
      }
    }
    
    // Also check if any open tab has the same URL (normalized)
    try {
      const normalizedTargetUrl = normalizeUrl(targetCard.url);
      const allTabs = await chrome.tabs.query({});
      const existingTabs = allTabs.filter(t => normalizeUrl(t.url) === normalizedTargetUrl);
      
      if (existingTabs.length > 0) {
        const existingTab = existingTabs[0];
        
        if (nextToCurrent) {
          await chrome.tabs.move(existingTab.id, { index: nextToCurrentIndex });
          await chrome.windows.update(existingTab.windowId, { focused: true });
          await chrome.tabs.update(existingTab.id, { active: true });
          
          recordTelemetry('actions', 'open', true);
          structuredLog('Phase 6', 'execute_action', {
            intent: 'open',
            targetUrl: targetCard.url,
            result: 'success',
            action: 'moved_to_next_to_current_by_url',
            tabId: existingTab.id
          });
          return { ok: true, tabId: existingTab.id, url: targetCard.url, activated: true, moved: true };
        } else {
          await chrome.windows.update(existingTab.windowId, { focused: true });
          await chrome.tabs.update(existingTab.id, { active: true });
          
          recordTelemetry('actions', 'open', true);
          structuredLog('Phase 6', 'execute_action', {
            intent: 'open',
            targetUrl: targetCard.url,
            result: 'success',
            action: 'activated_existing_by_url',
            tabId: existingTab.id
          });
          return { ok: true, tabId: existingTab.id, url: targetCard.url, activated: true };
        }
      }
    } catch (queryErr) {
      log('Tab URL query failed, opening new tab:', queryErr);
    }
    
    // No existing tab found - create new one
    const tab = await chrome.tabs.create({ url: targetCard.url, index: nextToCurrentIndex });
    
    recordTelemetry('actions', 'open', true);
    structuredLog('Phase 6', 'action_completed', {
      intent: 'open',
      requestId,
      result: 'success',
      action: 'created_new',
      tabId: tab.id
    });
    return { ok: true, tabId: tab.id, url: targetCard.url, activated: false };
  } catch (err) {
    recordTelemetry('actions', 'open', false);
    structuredLog('Phase 6', 'action_completed', {
      intent: 'open',
      requestId,
      result: 'error',
      error: String(err?.message || err)
    });
    return { ok: false, error: String(err?.message || err) };
  }
}

// ==== PHASE 6: CLOSE ACTION (with preview) ====
export async function executeCloseAction(filters, tabIds = null, confirmed = false, requestId = null) {
  try {
    structuredLog('Phase 6', 'action_started', {
      intent: 'close',
      requestId,
      confirmed
    });
    
    let matchingTabs = [];
    
    if (tabIds && Array.isArray(tabIds)) {
      for (const tabId of tabIds) {
        try {
          const tab = await chrome.tabs.get(tabId);
          matchingTabs.push(tab);
        } catch (err) {
          log('Tab not found for preview:', tabId);
        }
      }
    } else {
      const allTabs = await chrome.tabs.query({ currentWindow: true });
      
      for (const tab of allTabs) {
        if (filters.title && !tab.title?.toLowerCase().includes(filters.title.toLowerCase())) continue;
        if (filters.domain) {
          try {
            const tabDomain = new URL(tab.url).hostname.replace(/^www\./, '');
            if (tabDomain !== filters.domain.replace(/^www\./, '')) continue;
          } catch {
            continue;
          }
        }
        if (filters.url && !tab.url?.includes(filters.url)) continue;
        
        matchingTabs.push(tab);
      }
    }
    
    if (matchingTabs.length === 0) {
      structuredLog('Phase 6', 'action_completed', {
        intent: 'close',
        requestId,
        result: 'error',
        error: 'no_matching_tabs'
      });
      return { ok: false, error: 'no_matching_tabs' };
    }
    
    const hasPinned = matchingTabs.some(t => t.pinned);
    const isBulk = matchingTabs.length > 1;
    const needsConfirmation = !confirmed && (isBulk || hasPinned);
    
    if (needsConfirmation) {
      return {
        ok: true,
        preview: true,
        count: matchingTabs.length,
        tabs: matchingTabs.map(t => ({
          id: t.id,
          title: t.title || 'Untitled',
          url: t.url,
          domain: new URL(t.url).hostname.replace(/^www\./, ''),
          pinned: t.pinned || false
        })),
        filters: filters || { tabIds },
        canConfirm: true,
        requiresConfirmation: true,
        reason: isBulk ? 'bulk_close' : hasPinned ? 'pinned_tab' : null
      };
    }
    
    const tabIdsToClose = matchingTabs.map(t => t.id);
    const tabInfo = matchingTabs.map(t => ({ 
      tabId: t.id, 
      url: t.url, 
      title: t.title,
      windowId: t.windowId,
      index: t.index
    }));
    
    addUndoEntry({
      type: 'close',
      tabInfo: tabInfo,
      timestamp: Date.now(),
      requestId
    });
    
    await chrome.tabs.remove(tabIdsToClose);
    
    recordTelemetry('actions', 'close', true);
    structuredLog('Phase 6', 'action_completed', {
      intent: 'close',
      requestId,
      result: 'success',
      closedCount: matchingTabs.length
    });
    
    return { 
      ok: true, 
      count: matchingTabs.length,
      tabIds: tabIdsToClose,
      undoAvailable: true
    };
  } catch (err) {
    recordTelemetry('actions', 'close', false);
    structuredLog('Phase 6', 'execute_action', {
      intent: 'close',
      result: 'error',
      error: String(err?.message || err)
    });
    return { ok: false, error: String(err?.message || err) };
  }
}

// ==== PHASE 6: UNDO CLOSE ACTION ====
export async function undoLastCloseAction() {
  const undoEntry = getLatestUndoEntry();
  if (!undoEntry || undoEntry.type !== 'close') {
    return { ok: false, error: 'no_undo_available' };
  }
  
  try {
    const tabInfo = undoEntry.tabInfo;
    const restoredCount = tabInfo.length;
    
    // Try chrome.sessions.restore first
    try {
      const closed = await chrome.sessions.getRecentlyClosed({ maxResults: 25 });
      
      for (const session of closed) {
        if (session.tab && tabInfo.find(t => t.url === session.tab.url && t.tabId === session.tab.sessionId)) {
          await chrome.sessions.restore(session.sessionId);
          structuredLog('Phase 6', 'undo_close', {
            method: 'sessions.restore',
            restored: 1,
            sessionId: session.sessionId
          });
          return { ok: true, restored: 1, method: 'session_restore' };
        }
      }
      
      for (const session of closed) {
        if (session.window && tabInfo.length > 1) {
          const windowTabs = session.window.tabs || [];
          if (windowTabs.length === tabInfo.length) {
            await chrome.sessions.restore(session.sessionId);
            structuredLog('Phase 6', 'undo_close', {
              method: 'sessions.restore',
              restored: windowTabs.length,
              sessionId: session.sessionId
            });
            return { ok: true, restored: windowTabs.length, method: 'window_restore' };
          }
        }
      }
    } catch (sessionErr) {
      log('Session restore failed, falling back to manual restore:', sessionErr);
    }
    
    // Fallback: manually restore tabs
    const restored = [];
    for (const info of tabInfo) {
      try {
        const tab = await chrome.tabs.create({ 
          url: info.url, 
          active: false,
          windowId: info.windowId,
          index: info.index
        });
        restored.push(tab.id);
      } catch (err) {
        log('Failed to restore tab:', info, err);
      }
    }
    
    structuredLog('Phase 6', 'undo_close', {
      method: 'manual_create',
      restored: restored.length,
      attempted: restoredCount
    });
    
    return { ok: true, restored: restored.length, method: 'manual_restore' };
  } catch (err) {
    structuredLog('Phase 6', 'undo_close', {
      error: String(err?.message || err)
    });
    return { ok: false, error: String(err?.message || err) };
  }
}

// ==== PHASE 6: FIND_OPEN ACTION ====
export async function executeFindOpenAction(cardId) {
  try {
    if (!__INDEXER_BOOTED__) {
      __INDEXER_BOOTED__ = true;
      await Indexer.init();
    }
    
    const targetCard = IndexerCardById(cardId);
    
    if (!targetCard) {
      return { ok: false, error: 'card_not_found' };
    }
    
    if (targetCard.source === 'tab' && targetCard.tabId) {
      if (targetCard.windowId) {
        await chrome.windows.update(targetCard.windowId, { focused: true });
      }
      await chrome.tabs.update(targetCard.tabId, { active: true });
      
      recordTelemetry('actions', 'find_open', true);
      structuredLog('Phase 6', 'execute_action', {
        intent: 'find_open',
        targetUrl: targetCard.url,
        result: 'success',
        action: 'activated'
      });
      return { ok: true, found: true, tabId: targetCard.tabId, action: 'activated' };
    }
    
    recordTelemetry('actions', 'find_open', true);
    structuredLog('Phase 6', 'execute_action', {
      intent: 'find_open',
      targetUrl: targetCard.url,
      result: 'not_open',
      action: 'propose_open'
    });
    return { ok: true, found: false, card: targetCard, action: 'propose_open' };
  } catch (err) {
    recordTelemetry('actions', 'find_open', false);
    structuredLog('Phase 6', 'execute_action', {
      intent: 'find_open',
      result: 'error',
      error: String(err?.message || err)
    });
    return { ok: false, error: String(err?.message || err) };
  }
}

// ==== PHASE 6: REOPEN ACTION ====
export async function executeReopenAction(cardId) {
  try {
    if (!__INDEXER_BOOTED__) {
      __INDEXER_BOOTED__ = true;
      await Indexer.init();
    }
    
    const card = await Indexer.handleMessage({ type: 'INDEX_QUERY', query: '', filters: {}, limit: 1000 });
    const targetCard = card.results?.find(c => c.cardId === cardId);
    
    if (!targetCard || !targetCard.url) {
      return { ok: false, error: 'card_not_found_or_no_url' };
    }
    
    const closed = await chrome.sessions.getRecentlyClosed({ maxResults: 25 });
    
    let matchingSession = null;
    for (const session of closed) {
      if (session.tab && session.tab.url === targetCard.url) {
        matchingSession = session;
        break;
      }
      if (session.window) {
        for (const tab of session.window.tabs || []) {
          if (tab.url === targetCard.url) {
            matchingSession = session;
            break;
          }
        }
      }
    }
    
    if (matchingSession) {
      await chrome.sessions.restore(matchingSession.sessionId);
      recordTelemetry('actions', 'reopen', true);
      structuredLog('Phase 6', 'execute_action', {
        intent: 'reopen',
        targetUrl: targetCard.url,
        result: 'success',
        restored: true
      });
      return { ok: true, restored: true };
    } else {
      const tab = await chrome.tabs.create({ url: targetCard.url });
      recordTelemetry('actions', 'reopen', true);
      structuredLog('Phase 6', 'execute_action', {
        intent: 'reopen',
        targetUrl: targetCard.url,
        result: 'success',
        restored: false,
        fallback: true,
        tabId: tab.id
      });
      return { ok: true, restored: false, fallback: true, tabId: tab.id };
    }
  } catch (err) {
    recordTelemetry('actions', 'reopen', false);
    structuredLog('Phase 6', 'execute_action', {
      intent: 'reopen',
      result: 'error',
      error: String(err?.message || err)
    });
    return { ok: false, error: String(err?.message || err) };
  }
}

// ==== PHASE 6: SAVE ACTION ====
export async function executeSaveAction(cardIds, folderName = null, saveAs = 'bookmark') {
  try {
    if (!__INDEXER_BOOTED__) {
      __INDEXER_BOOTED__ = true;
      await Indexer.init();
    }
    
    const card = await Indexer.handleMessage({ type: 'INDEX_QUERY', query: '', filters: {}, limit: 1000 });
    const cardsToSave = cardIds.map(id => card.results?.find(c => c.cardId === id)).filter(Boolean);
    
    if (cardsToSave.length === 0) {
      return { ok: false, error: 'no_valid_cards' };
    }
    
    if (saveAs === 'group') {
      const tabIds = cardsToSave
        .filter(c => c.source === 'tab' && c.tabId)
        .map(c => c.tabId);
      
      if (tabIds.length === 0) {
        return { ok: false, error: 'no_open_tabs_to_group' };
      }
      
      try {
        const groupId = await chrome.tabs.group({ tabIds });
        await chrome.tabGroups.update(groupId, {
          title: folderName || 'Saved Tabs',
          collapsed: false
        });
        
        recordTelemetry('actions', 'save', true);
        structuredLog('Phase 6', 'execute_action', {
          intent: 'save',
          result: 'success',
          mode: 'group',
          groupId,
          groupTitle: folderName || 'Saved Tabs',
          saved: tabIds.length
        });
        
        return {
          ok: true,
          saved: tabIds.length,
          mode: 'group',
          groupId,
          groupTitle: folderName || 'Saved Tabs',
          tabIds
        };
      } catch (err) {
        return { ok: false, error: String(err?.message || err) };
      }
    }
    
    const folderTitle = folderName || 'Chat Saves';
    
    const tree = await chrome.bookmarks.getTree();
    let tabithaFolder = null;
    let targetFolder = null;
    
    function findTabithaFolder(nodes) {
      for (const node of nodes) {
        if (node.title === 'Tabitha' && node.children) {
          for (const child of node.children) {
            if (child.title === folderTitle) {
              return { tabitha: node, folder: child };
            }
          }
          return { tabitha: node, folder: null };
        }
        if (node.children) {
          const found = findTabithaFolder(node.children);
          if (found) return found;
        }
      }
      return null;
    }
    
    const found = await findTabithaFolder(tree);
    if (found) {
      tabithaFolder = found.tabitha;
      targetFolder = found.folder;
    }
    
    if (!tabithaFolder) {
      tabithaFolder = await chrome.bookmarks.create({ title: 'Tabitha' });
    }
    
    let folderId;
    if (targetFolder) {
      folderId = targetFolder.id;
    } else {
      folderId = (await chrome.bookmarks.create({ 
        parentId: tabithaFolder.id, 
        title: folderTitle 
      })).id;
    }
    
    const saved = [];
    const failed = [];
    
    for (const targetCard of cardsToSave) {
      if (!targetCard.url) {
        failed.push(targetCard.cardId);
        continue;
      }
      
      try {
        const bookmark = await chrome.bookmarks.create({
          parentId: folderId,
          title: targetCard.title || targetCard.url,
          url: targetCard.url
        });
        saved.push(bookmark.id);
      } catch (err) {
        failed.push(targetCard.cardId);
      }
    }
    
    const success = saved.length > 0;
    recordTelemetry('actions', 'save', success);
    structuredLog('Phase 6', 'execute_action', {
      intent: 'save',
      targetUrl: `${cardIds.length} cards`,
      result: success ? 'success' : 'error',
      mode: 'bookmark',
      folderName: folderTitle,
      saved: saved.length,
      failed: failed.length
    });
    
    return { 
      ok: success, 
      saved: saved.length, 
      failed: failed.length,
      mode: 'bookmark',
      folderId,
      folderName: folderTitle,
      bookmarkIds: saved
    };
  } catch (err) {
    recordTelemetry('actions', 'save', false);
    structuredLog('Phase 6', 'execute_action', {
      intent: 'save',
      result: 'error',
      error: String(err?.message || err)
    });
    return { ok: false, error: String(err?.message || err) };
  }
}

// ==== PHASE 6: SHOW ACTION ====
export async function executeShowAction(cardIds) {
  try {
    if (!__INDEXER_BOOTED__) {
      __INDEXER_BOOTED__ = true;
      await Indexer.init();
    }
    
    const card = await Indexer.handleMessage({ type: 'INDEX_QUERY', query: '', filters: {}, limit: 1000 });
    const cards = cardIds.map(id => card.results?.find(c => c.cardId === id)).filter(Boolean);
    
    recordTelemetry('actions', 'show', true);
    structuredLog('Phase 6', 'execute_action', {
      intent: 'show',
      targetUrl: `${cardIds.length} cards`,
      result: 'success',
      count: cards.length
    });
    
    return { 
      ok: true, 
      cards: cards.map(c => ({
        cardId: c.cardId,
        title: c.title,
        url: c.url,
        domain: c.domain,
        type: c.type,
        source: c.source,
        lastVisitedAt: c.lastVisitedAt,
        tabId: c.tabId,
        windowId: c.windowId
      }))
    };
  } catch (err) {
    recordTelemetry('actions', 'show', false);
    structuredLog('Phase 6', 'execute_action', {
      intent: 'show',
      result: 'error',
      error: String(err?.message || err)
    });
    return { ok: false, error: String(err?.message || err) };
  }
}

// ==== CHAT-FOR-TABS: CONVERSATIONAL ASK ACTION ====
export async function executeAskAction(query, intent, sessionId) {
  try {
    if (!__INDEXER_BOOTED__) {
      __INDEXER_BOOTED__ = true;
      await Indexer.init();
    }
    
    const hasTimeHint = intent?.constraints?.dateRange || 
                       ((intent?.canonical_query || intent?.query) && /\b(yesterday|last week|this week|today)\b/i.test(intent.canonical_query || intent.query || ''));
    
    const filters = {};
    if (!hasTimeHint && intent?.constraints?.resultMustBeOpen !== false) {
      filters.source = 'tab';
    }
    
    const cardQuery = await Indexer.handleMessage({ 
      type: 'INDEX_QUERY', 
      query: '', 
      filters: filters, 
      limit: 10000
    });
    
    let allCards = cardQuery?.results || [];
    
    let historyCards = [];
    if (hasTimeHint) {
      const historyQuery = await Indexer.handleMessage({
        type: 'INDEX_QUERY',
        query: '',
        filters: { source: 'history' },
        limit: 1000
      });
      
      historyCards = (historyQuery?.results || []).filter(card => {
        if (intent.constraints?.dateRange) {
          const cardTime = card.lastVisitedAt || 0;
          const since = intent.constraints.dateRange.since ? 
            new Date(intent.constraints.dateRange.since).getTime() : 0;
          const until = intent.constraints.dateRange.until ? 
            new Date(intent.constraints.dateRange.until).getTime() : Date.now();
          if (cardTime < since || cardTime > until) return false;
        }
        return true;
      }).sort((a, b) => (b.lastVisitedAt || 0) - (a.lastVisitedAt || 0))
        .slice(0, 5);
    }
    
    let relevantCards = allCards;
    if (intent?.constraints) {
      relevantCards = allCards.filter(card => {
        if (intent.constraints.dateRange) {
          const cardTime = card.lastVisitedAt || 0;
          const since = intent.constraints.dateRange.since ? 
            new Date(intent.constraints.dateRange.since).getTime() : 0;
          const until = intent.constraints.dateRange.until ? 
            new Date(intent.constraints.dateRange.until).getTime() : Date.now();
          if (cardTime < since || cardTime > until) return false;
        }
        if (intent.constraints.app && Array.isArray(intent.constraints.app)) {
          const appConstraint = intent.constraints.app;
          if (appConstraint !== 'any') {
            const matchesApp = appConstraint.some(domain => 
              card.domain?.includes(domain) || card.url?.includes(domain)
            );
            if (!matchesApp) return false;
          }
        }
        if (intent.constraints.resultMustBeOpen && card.source !== 'tab') {
          return false;
        }
        return true;
      });
    }
    
    const openTabs = relevantCards.filter(c => c.source === 'tab');
    const historyItems = historyCards.length > 0 ? historyCards : 
                        (hasTimeHint ? relevantCards.filter(c => c.source === 'history') : []);
    
    const contextCards = [
      ...openTabs.sort((a, b) => (b.lastVisitedAt || 0) - (a.lastVisitedAt || 0)).slice(0, 15),
      ...historyItems.slice(0, 5)
    ];
    
    const openTabsContext = openTabs.length > 0 ? 
      `OPEN TABS:\n${openTabs.slice(0, 15).map((c, idx) => {
        const age = c.lastVisitedAt ? formatAge(Date.now() - c.lastVisitedAt) : 'unknown';
        return `${idx + 1}. "${c.title || c.url || 'Untitled'}" (${c.domain || 'unknown'}) - ${c.type || 'page'} - ${age} ago`;
      }).join('\n')}` : '';
    
    const historyContext = historyItems.length > 0 ?
      `FROM HISTORY (${hasTimeHint ? 'yesterday' : 'past'}):\n${historyItems.slice(0, 5).map((c, idx) => {
        const age = c.lastVisitedAt ? formatAge(Date.now() - c.lastVisitedAt) : 'unknown';
        return `${idx + 1}. "${c.title || c.url || 'Untitled'}" (${c.domain || 'unknown'}) - ${c.type || 'page'} - ${age} ago`;
      }).join('\n')}` : '';
    
    const cardContext = [
      openTabsContext,
      historyContext
    ].filter(Boolean).join('\n\n') || 'No matching items found.';
    
    const conversationContext = formatConversationForPrompt(sessionId || getChatSessionId());
    
    const prompt = `You are Tabitha. Answer questions about browsing activity naturally.

${conversationContext ? `Previous conversation:\n${conversationContext}\n` : ''}

Question: "${query}"
Constraints: ${JSON.stringify(intent?.constraints || {})}

Browsing data:
${cardContext}

Answer conversationally. Clearly label "Open tabs" vs "From history". Be specific and concise.

Answer:`;

    const res = await postToOffscreen('OFFSCREEN_RUN_PROMPT_LM', { prompt });
    const answer = String(res?.text || '').trim();
    
    if (!answer) {
      return { 
        ok: false, 
        error: 'no_response',
        answer: "I couldn't generate an answer. Could you rephrase your question?" 
      };
    }
    
    recordTelemetry('actions', 'ask', true);
    structuredLog('Phase 6', 'execute_ask', {
      query: query,
      result: 'success',
      answerLength: answer.length,
      contextCards: contextCards.length
    });
    
    return { 
      ok: true, 
      answer: answer,
      contextCards: contextCards.length,
      totalCards: allCards.length
    };
  } catch (err) {
    recordTelemetry('actions', 'ask', false);
    structuredLog('Phase 6', 'execute_ask', {
      query: query,
      result: 'error',
      error: String(err?.message || err)
    });
    return { ok: false, error: String(err?.message || err) };
  }
}

// ==== GROUP HELPER FUNCTIONS ====

// Query all existing tab groups
async function allTabGroups() {
  // Chrome has no direct list() for groups; derive from tabs
  const tabs = await chrome.tabs.query({});
  const gIds = [...new Set(tabs.map(t => t.groupId).filter(id => id >= 0))];
  const out = [];
  for (const id of gIds) {
    try {
      const g = await chrome.tabGroups.get(id);
      out.push(g); // { id, title, color, collapsed, windowId }
    } catch {}
  }
  return out;
}

// Find group by name (fuzzy match)
async function findGroupByName(name) {
  const groups = await allTabGroups();
  const low = String(name || '').trim().toLowerCase();
  return groups.find(g => {
    const groupTitle = (g.title || '').trim().toLowerCase();
    return groupTitle === low || groupTitle.includes(low) || low.includes(groupTitle);
  }) || null;
}

// Get all tabs in a group by name
async function tabsInGroupByName(name) {
  const g = await findGroupByName(name);
  if (!g) return [];
  const all = await chrome.tabs.query({ windowId: g.windowId });
  return all.filter(t => t.groupId === g.id);
}

// Focus a group (activate first tab + focus window)
async function focusGroup(groupId) {
  const tabs = await chrome.tabs.query({});
  const inGroup = tabs.filter(t => t.groupId === groupId);
  if (!inGroup.length) return;
  await chrome.tabs.update(inGroup[0].id, { active: true });
  await chrome.windows.update(inGroup[0].windowId, { focused: true });
}

// Extract minimal tab info for preview
function miniCard(t) {
  return { id: t.id, title: t.title, url: t.url, windowId: t.windowId };
}

// Ensure bookmark folder exists, create if needed
async function ensureBookmarkFolder(pathParts) {
  let parentId = null;
  
  // Get bookmarks tree to find root
  const tree = await chrome.bookmarks.getTree();
  if (tree.length > 0) {
    // Use "Other bookmarks" as root, or "Bookmarks bar"
    const otherBookmarks = tree[0].children?.find(c => c.id === '2') || tree[0].children?.[0];
    parentId = otherBookmarks?.id || tree[0].id;
  }
  
  if (!parentId) return null;
  
  // Create or find each part of the path
  for (const part of pathParts) {
    const children = (await chrome.bookmarks.getChildren(parentId)) || [];
    const found = children.find(n => n.title === part && !n.url);
    
    if (found) {
      parentId = found.id;
    } else {
      const created = await chrome.bookmarks.create({ parentId, title: part });
      parentId = created.id;
    }
  }
  
  return parentId;
}

// ==== GROUP EXECUTOR FUNCTIONS ====

// Focus a group
export async function executeFocusGroup(groupName) {
  try {
    const group = await findGroupByName(groupName);
    if (!group) {
      return { ok: false, error: 'group_not_found' };
    }
    
    await focusGroup(group.id);
    
    structuredLog('Phase 6', 'execute_action', {
      intent: 'focus_group',
      result: 'success',
      groupId: group.id,
      groupTitle: group.title
    });
    
    return { ok: true, groupId: group.id, groupTitle: group.title };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

// Close group (with preview/confirm support)
export async function executeCloseGroup(groupName, confirmed = false) {
  try {
    const tabs = await tabsInGroupByName(groupName);
    
    if (tabs.length === 0) {
      return { ok: false, error: 'group_not_found_or_empty' };
    }
    
    // Preview mode
    if (!confirmed) {
      return {
        ok: true,
        preview: true,
        count: tabs.length,
        tabs: tabs.map(miniCard),
        groupName: groupName,
        canConfirm: true,
        requiresConfirmation: true
      };
    }
    
    // Execute close
    const tabIdsToClose = tabs.map(t => t.id);
    const tabInfo = tabs.map(t => ({
      tabId: t.id,
      url: t.url,
      title: t.title,
      windowId: t.windowId,
      index: t.index
    }));
    
    addUndoEntry({
      type: 'close_group',
      tabInfo: tabInfo,
      groupName: groupName,
      timestamp: Date.now()
    });
    
    await chrome.tabs.remove(tabIdsToClose);
    
    structuredLog('Phase 6', 'execute_action', {
      intent: 'close_group',
      result: 'success',
      groupName: groupName,
      closedCount: tabs.length
    });
    
    return {
      ok: true,
      count: tabs.length,
      tabIds: tabIdsToClose,
      undoAvailable: true
    };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

// Save group tabs as bookmarks
export async function executeSaveGroup(groupName, folderName = 'Chat Saves') {
  try {
    const tabs = await tabsInGroupByName(groupName);
    
    if (tabs.length === 0) {
      return { ok: false, error: 'group_not_found_or_empty' };
    }
    
    const folderId = await ensureBookmarkFolder(['Tabitha', folderName]);
    if (!folderId) {
      return { ok: false, error: 'failed_to_create_folder' };
    }
    
    let savedCount = 0;
    for (const t of tabs) {
      try {
        await chrome.bookmarks.create({
          parentId: folderId,
          title: t.title || 'Untitled',
          url: t.url
        });
        savedCount++;
      } catch (err) {
        log('Failed to bookmark tab:', t.id, err);
      }
    }
    
    structuredLog('Phase 6', 'execute_action', {
      intent: 'save_group',
      result: 'success',
      groupName: groupName,
      folderName: folderName,
      savedCount: savedCount
    });
    
    return {
      ok: true,
      saved: savedCount,
      folderName: folderName,
      groupName: groupName
    };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

// Move group to new window
export async function executeMoveGroupToWindow(groupName) {
  try {
    const tabs = await tabsInGroupByName(groupName);
    
    if (tabs.length === 0) {
      return { ok: false, error: 'group_not_found_or_empty' };
    }
    
    // Create new window with first tab
    const win = await chrome.windows.create({ tabId: tabs[0].id });
    
    // Move remaining tabs to new window
    for (let i = 1; i < tabs.length; i++) {
      await chrome.tabs.move(tabs[i].id, { windowId: win.id, index: -1 });
    }
    
    structuredLog('Phase 6', 'execute_action', {
      intent: 'move_group_to_window',
      result: 'success',
      groupName: groupName,
      windowId: win.id
    });
    
    return {
      ok: true,
      windowId: win.id,
      groupName: groupName,
      movedCount: tabs.length
    };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

// Rename group
export async function executeRenameGroup(groupName, newName) {
  try {
    const g = await findGroupByName(groupName);
    if (!g) {
      return { ok: false, error: 'group_not_found' };
    }
    
    await chrome.tabGroups.update(g.id, { title: newName });
    
    structuredLog('Phase 6', 'execute_action', {
      intent: 'rename_group',
      result: 'success',
      groupId: g.id,
      oldName: groupName,
      newName: newName
    });
    
    return { ok: true, groupId: g.id, newName: newName };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

// Collapse/expand group
export async function executeCollapseGroup(groupName, collapsed) {
  try {
    const g = await findGroupByName(groupName);
    if (!g) {
      return { ok: false, error: 'group_not_found' };
    }
    
    await chrome.tabGroups.update(g.id, { collapsed: !!collapsed });
    
    structuredLog('Phase 6', 'execute_action', {
      intent: 'collapse_group',
      result: 'success',
      groupId: g.id,
      collapsed: !!collapsed
    });
    
    return { ok: true, groupId: g.id, collapsed: !!collapsed };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

// Ungroup (remove group, keep tabs)
export async function executeUngroup(groupName) {
  try {
    const tabs = await tabsInGroupByName(groupName);
    
    if (tabs.length === 0) {
      return { ok: false, error: 'group_not_found_or_empty' };
    }
    
    // Ungroup all tabs
    for (const t of tabs) {
      await chrome.tabs.ungroup(t.id);
    }
    
    structuredLog('Phase 6', 'execute_action', {
      intent: 'ungroup',
      result: 'success',
      groupName: groupName,
      ungroupedCount: tabs.length
    });
    
    return {
      ok: true,
      count: tabs.length,
      groupName: groupName
    };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

// ==== PHASE 6: MUTE ACTION ====
export async function executeMuteAction(cardIds, intent = null) {
  try {
    if (!__INDEXER_BOOTED__) {
      __INDEXER_BOOTED__ = true;
      await Indexer.init();
    }
    
    // Get matching tabs
    let tabIds = [];
    if (Array.isArray(cardIds) && cardIds.length > 0) {
      // Get tabs from cardIds
      const cards = await Indexer.handleMessage({ type: 'INDEX_QUERY', query: '', filters: {}, limit: 1000 });
      const matchingCards = cardIds.map(id => cards.results?.find(c => c.cardId === id)).filter(Boolean);
      tabIds = matchingCards.filter(c => c.source === 'tab' && c.tabId).map(c => c.tabId);
    } else {
      // Query all tabs and filter by constraints
      const allTabs = await chrome.tabs.query({});
      let candidates = allTabs;
      
      // Apply includeApps constraint (migrated from "app")
      const includeApps = intent?.constraints?.includeApps || intent?.constraints?.app || [];
      if (Array.isArray(includeApps) && includeApps.length > 0) {
        candidates = candidates.filter(tab => {
          try {
            const url = new URL(tab.url);
            const domain = url.hostname.replace(/^www\./, '');
            return includeApps.some(d => domain.includes(d.replace(/^www\./, '')));
          } catch {
            return false;
          }
        });
      }
      
      // Handle excludeApps constraint (e.g., "mute all except zoom")
      const excludeApps = intent?.constraints?.excludeApps || intent?.constraints?.exclude || [];
      if (Array.isArray(excludeApps) && excludeApps.length > 0) {
        candidates = candidates.filter(tab => {
          try {
            const url = new URL(tab.url);
            const domain = url.hostname.replace(/^www\./, '');
            return !excludeApps.some(excludeDomain => 
              domain.includes(excludeDomain.replace(/^www\./, ''))
            );
          } catch {
            return true;
          }
        });
      }
      
      tabIds = candidates.map(t => t.id);
    }
    
    if (tabIds.length === 0) {
      return { ok: false, error: 'no_tabs_found' };
    }
    
    // Mute all matching tabs
    await Promise.all(tabIds.map(id => chrome.tabs.update(id, { muted: true }).catch(() => {})));
    
    recordTelemetry('actions', 'mute', true);
    structuredLog('Phase 6', 'execute_action', {
      intent: 'mute',
      result: 'success',
      mutedCount: tabIds.length
    });
    
    return { ok: true, count: tabIds.length };
  } catch (err) {
    recordTelemetry('actions', 'mute', false);
    structuredLog('Phase 6', 'execute_action', {
      intent: 'mute',
      result: 'error',
      error: String(err?.message || err)
    });
    return { ok: false, error: String(err?.message || err) };
  }
}

// ==== PHASE 6: UNMUTE ACTION ====
export async function executeUnmuteAction(cardIds, intent = null) {
  try {
    if (!__INDEXER_BOOTED__) {
      __INDEXER_BOOTED__ = true;
      await Indexer.init();
    }
    
    // Get matching tabs (similar to mute)
    let tabIds = [];
    if (Array.isArray(cardIds) && cardIds.length > 0) {
      const cards = await Indexer.handleMessage({ type: 'INDEX_QUERY', query: '', filters: {}, limit: 1000 });
      const matchingCards = cardIds.map(id => cards.results?.find(c => c.cardId === id)).filter(Boolean);
      tabIds = matchingCards.filter(c => c.source === 'tab' && c.tabId).map(c => c.tabId);
    } else {
      const allTabs = await chrome.tabs.query({});
      let candidates = allTabs;
      
      const includeApps = intent?.constraints?.includeApps || intent?.constraints?.app || [];
      if (Array.isArray(includeApps) && includeApps.length > 0) {
        candidates = candidates.filter(tab => {
          try {
            const url = new URL(tab.url);
            const domain = url.hostname.replace(/^www\./, '');
            return includeApps.some(d => domain.includes(d.replace(/^www\./, '')));
          } catch {
            return false;
          }
        });
      }
      
      tabIds = candidates.map(t => t.id);
    }
    
    if (tabIds.length === 0) {
      return { ok: false, error: 'no_tabs_found' };
    }
    
    // Unmute all matching tabs
    await Promise.all(tabIds.map(id => chrome.tabs.update(id, { muted: false }).catch(() => {})));
    
    recordTelemetry('actions', 'unmute', true);
    structuredLog('Phase 6', 'execute_action', {
      intent: 'unmute',
      result: 'success',
      unmutedCount: tabIds.length
    });
    
    return { ok: true, count: tabIds.length };
  } catch (err) {
    recordTelemetry('actions', 'unmute', false);
    structuredLog('Phase 6', 'execute_action', {
      intent: 'unmute',
      result: 'error',
      error: String(err?.message || err)
    });
    return { ok: false, error: String(err?.message || err) };
  }
}

// ==== PHASE 6: PIN ACTION ====
export async function executePinAction(cardIds, intent = null) {
  try {
    if (!__INDEXER_BOOTED__) {
      __INDEXER_BOOTED__ = true;
      await Indexer.init();
    }
    
    // Get matching tabs
    let tabIds = [];
    if (Array.isArray(cardIds) && cardIds.length > 0) {
      const cards = await Indexer.handleMessage({ type: 'INDEX_QUERY', query: '', filters: {}, limit: 1000 });
      const matchingCards = cardIds.map(id => cards.results?.find(c => c.cardId === id)).filter(Boolean);
      tabIds = matchingCards.filter(c => c.source === 'tab' && c.tabId).map(c => c.tabId);
    } else {
      const allTabs = await chrome.tabs.query({});
      let candidates = allTabs;
      
      const includeApps = intent?.constraints?.includeApps || intent?.constraints?.app || [];
      if (Array.isArray(includeApps) && includeApps.length > 0) {
        candidates = candidates.filter(tab => {
          try {
            const url = new URL(tab.url);
            const domain = url.hostname.replace(/^www\./, '');
            return includeApps.some(d => domain.includes(d.replace(/^www\./, '')));
          } catch {
            return false;
          }
        });
      }
      
      tabIds = candidates.map(t => t.id);
    }
    
    if (tabIds.length === 0) {
      return { ok: false, error: 'no_tabs_found' };
    }
    
    // Pin all matching tabs
    await Promise.all(tabIds.map(id => chrome.tabs.update(id, { pinned: true }).catch(() => {})));
    
    recordTelemetry('actions', 'pin', true);
    structuredLog('Phase 6', 'execute_action', {
      intent: 'pin',
      result: 'success',
      pinnedCount: tabIds.length
    });
    
    return { ok: true, count: tabIds.length };
  } catch (err) {
    recordTelemetry('actions', 'pin', false);
    structuredLog('Phase 6', 'execute_action', {
      intent: 'pin',
      result: 'error',
      error: String(err?.message || err)
    });
    return { ok: false, error: String(err?.message || err) };
  }
}

// ==== PHASE 6: UNPIN ACTION ====
export async function executeUnpinAction(cardIds, intent = null) {
  try {
    if (!__INDEXER_BOOTED__) {
      __INDEXER_BOOTED__ = true;
      await Indexer.init();
    }
    
    // Get matching tabs
    let tabIds = [];
    if (Array.isArray(cardIds) && cardIds.length > 0) {
      const cards = await Indexer.handleMessage({ type: 'INDEX_QUERY', query: '', filters: {}, limit: 1000 });
      const matchingCards = cardIds.map(id => cards.results?.find(c => c.cardId === id)).filter(Boolean);
      tabIds = matchingCards.filter(c => c.source === 'tab' && c.tabId).map(c => c.tabId);
    } else {
      const allTabs = await chrome.tabs.query({});
      let candidates = allTabs;
      
      const includeApps = intent?.constraints?.includeApps || intent?.constraints?.app || [];
      if (Array.isArray(includeApps) && includeApps.length > 0) {
        candidates = candidates.filter(tab => {
          try {
            const url = new URL(tab.url);
            const domain = url.hostname.replace(/^www\./, '');
            return includeApps.some(d => domain.includes(d.replace(/^www\./, '')));
          } catch {
            return false;
          }
        });
      }
      
      tabIds = candidates.map(t => t.id);
    }
    
    if (tabIds.length === 0) {
      return { ok: false, error: 'no_tabs_found' };
    }
    
    // Unpin all matching tabs
    await Promise.all(tabIds.map(id => chrome.tabs.update(id, { pinned: false }).catch(() => {})));
    
    recordTelemetry('actions', 'unpin', true);
    structuredLog('Phase 6', 'execute_action', {
      intent: 'unpin',
      result: 'success',
      unpinnedCount: tabIds.length
    });
    
    return { ok: true, count: tabIds.length };
  } catch (err) {
    recordTelemetry('actions', 'unpin', false);
    structuredLog('Phase 6', 'execute_action', {
      intent: 'unpin',
      result: 'error',
      error: String(err?.message || err)
    });
    return { ok: false, error: String(err?.message || err) };
  }
}

// ==== PHASE 6: RELOAD ACTION ====
export async function executeReloadAction(cardIds, intent = null) {
  try {
    if (!__INDEXER_BOOTED__) {
      __INDEXER_BOOTED__ = true;
      await Indexer.init();
    }
    
    // Get matching tabs
    let tabIds = [];
    if (Array.isArray(cardIds) && cardIds.length > 0) {
      const cards = await Indexer.handleMessage({ type: 'INDEX_QUERY', query: '', filters: {}, limit: 1000 });
      const matchingCards = cardIds.map(id => cards.results?.find(c => c.cardId === id)).filter(Boolean);
      tabIds = matchingCards.filter(c => c.source === 'tab' && c.tabId).map(c => c.tabId);
    } else {
      // If no cardIds, reload current active tab if limit is 1
      if (intent?.constraints?.limit === 1) {
        const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTabs.length > 0) {
          tabIds = [activeTabs[0].id];
        }
      } else {
        const allTabs = await chrome.tabs.query({});
        let candidates = allTabs;
        
        const includeApps = intent?.constraints?.includeApps || intent?.constraints?.app || [];
        if (Array.isArray(includeApps) && includeApps.length > 0) {
          candidates = candidates.filter(tab => {
            try {
              const url = new URL(tab.url);
              const domain = url.hostname.replace(/^www\./, '');
              return includeApps.some(d => domain.includes(d.replace(/^www\./, '')));
            } catch {
              return false;
            }
          });
        }
        
        tabIds = candidates.map(t => t.id);
      }
    }
    
    if (tabIds.length === 0) {
      return { ok: false, error: 'no_tabs_found' };
    }
    
    // Reload all matching tabs
    await Promise.all(tabIds.map(id => chrome.tabs.reload(id).catch(() => {})));
    
    recordTelemetry('actions', 'reload', true);
    structuredLog('Phase 6', 'execute_action', {
      intent: 'reload',
      result: 'success',
      reloadedCount: tabIds.length
    });
    
    return { ok: true, count: tabIds.length };
  } catch (err) {
    recordTelemetry('actions', 'reload', false);
    structuredLog('Phase 6', 'execute_action', {
      intent: 'reload',
      result: 'error',
      error: String(err?.message || err)
    });
    return { ok: false, error: String(err?.message || err) };
  }
}

// ==== PHASE 6: DISCARD ACTION ====
export async function executeDiscardAction(cardIds, intent = null) {
  try {
    if (!__INDEXER_BOOTED__) {
      __INDEXER_BOOTED__ = true;
      await Indexer.init();
    }
    
    // Get matching tabs
    let tabIds = [];
    if (Array.isArray(cardIds) && cardIds.length > 0) {
      const cards = await Indexer.handleMessage({ type: 'INDEX_QUERY', query: '', filters: {}, limit: 1000 });
      const matchingCards = cardIds.map(id => cards.results?.find(c => c.cardId === id)).filter(Boolean);
      tabIds = matchingCards.filter(c => c.source === 'tab' && c.tabId).map(c => c.tabId);
    } else {
      const allTabs = await chrome.tabs.query({});
      let candidates = allTabs;
      
      const includeApps = intent?.constraints?.includeApps || intent?.constraints?.app || [];
      if (Array.isArray(includeApps) && includeApps.length > 0) {
        candidates = candidates.filter(tab => {
          try {
            const url = new URL(tab.url);
            const domain = url.hostname.replace(/^www\./, '');
            return includeApps.some(d => domain.includes(d.replace(/^www\./, '')));
          } catch {
            return false;
          }
        });
      }
      
      // Don't discard pinned tabs or active tab
      const activeTabs = await chrome.tabs.query({ active: true });
      const activeTabIds = new Set(activeTabs.map(t => t.id));
      candidates = candidates.filter(t => !t.pinned && !activeTabIds.has(t.id));
      
      tabIds = candidates.map(t => t.id);
    }
    
    if (tabIds.length === 0) {
      return { ok: false, error: 'no_tabs_found' };
    }
    
    // Discard all matching tabs
    await Promise.all(tabIds.map(id => chrome.tabs.discard(id).catch(() => {})));
    
    recordTelemetry('actions', 'discard', true);
    structuredLog('Phase 6', 'execute_action', {
      intent: 'discard',
      result: 'success',
      discardedCount: tabIds.length
    });
    
    return { ok: true, count: tabIds.length };
  } catch (err) {
    recordTelemetry('actions', 'discard', false);
    structuredLog('Phase 6', 'execute_action', {
      intent: 'discard',
      result: 'error',
      error: String(err?.message || err)
    });
    return { ok: false, error: String(err?.message || err) };
  }
}
