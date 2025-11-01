// Chat with your Tabs - Indexer Module
// IndexedDB-based index for storing and searching open tabs.
// Only stores active/open tabs (history/bookmarks queried on-demand).
// Provides lexical search, inverted index, and card management.

export const Indexer = (() => {
  const IDX_log = (...a) => console.log('[Tabitha::index]', ...a);
  const IDX_warn = (...a) => console.warn('[Tabitha::index]', ...a);
  const IDX_err = (...a) => console.error('[Tabitha::index]', ...a);

  let IDX_DB = null;
  const IDX_DB_NAME = 'tabitha_index';
  const IDX_STORE = 'cards';
  
  // ==== PHASE 2: LEXICAL SEARCH STATE ====
  let IDX_invertedIndex = null; // Map<token, Set<cardId>> - built lazily
  let IDX_indexBuiltAt = 0; // timestamp of last rebuild
  
  // ==== PHASE 7: THROTTLING STATE ====
  let IDX_lastRefreshOpenTabs = 0; // timestamp of last refresh

  // ==== PHASE 9: YIELD HELPERS (for Indexer use) ====
  async function IDX_yieldToEventLoop() {
    return new Promise(resolve => setTimeout(resolve, 0));
  }

  async function* IDX_chunkArray(array, chunkSize = 50) {
    for (let i = 0; i < array.length; i += chunkSize) {
      yield array.slice(i, i + chunkSize);
      await IDX_yieldToEventLoop();
    }
  }

  async function IDX_openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDX_DB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        const store = db.createObjectStore(IDX_STORE, { keyPath: 'cardId' });
        store.createIndex('byDomain', 'domain', { unique: false });
        store.createIndex('byType', 'type', { unique: false });
        store.createIndex('bySource', 'source', { unique: false });
        store.createIndex('byLastVisited', 'lastVisitedAt', { unique: false });
        store.createIndex('byUrl', 'url', { unique: false });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function IDX_idbPutAll(rows) {
    if (!rows?.length) return;
    await new Promise((resolve, reject) => {
      const tx = IDX_DB.transaction(IDX_STORE, 'readwrite');
      const store = tx.objectStore(IDX_STORE);
      for (const r of rows) store.put(r);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function IDX_idbPutOne(row) {
    await new Promise((resolve, reject) => {
      const tx = IDX_DB.transaction(IDX_STORE, 'readwrite');
      tx.objectStore(IDX_STORE).put(row);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function IDX_idbGetAll() {
    return new Promise((resolve, reject) => {
      const tx = IDX_DB.transaction(IDX_STORE, 'readonly');
      const req = tx.objectStore(IDX_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function IDX_idbDelete(key) {
    await new Promise((resolve, reject) => {
      const tx = IDX_DB.transaction(IDX_STORE, 'readwrite');
      tx.objectStore(IDX_STORE).delete(key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  const IDX_cache = new Map();
  let IDX_writeBuf = [];
  let IDX_writeTimer = null;
  const IDX_WRITE_DEBOUNCE_MS = 300;

  function IDX_queueWrite(card) {
    IDX_writeBuf.push(card);
    if (IDX_writeTimer) return;
    IDX_writeTimer = setTimeout(async () => {
      const batch = IDX_writeBuf; IDX_writeBuf = []; IDX_writeTimer = null;
      try { await IDX_idbPutAll(batch); } catch (e) { IDX_err('idbPutAll', e); }
    }, IDX_WRITE_DEBOUNCE_MS);
  }

  function IDX_upsert(card) {
    IDX_cache.set(card.cardId, card);
    IDX_queueWrite(card);
  }

  async function IDX_upsertNow(card) {
    IDX_cache.set(card.cardId, card);
    await IDX_idbPutOne(card);
  }

  const IDX_now = () => Date.now();
  const IDX_domainOf = (url='') => { try { return new URL(url).hostname.replace(/^www\./,''); } catch { return ''; } };

  // ==== TYPE INFERENCE ====
  function IDX_inferTypeFromUrl(url='') {
    try {
      const u = new URL(url);
      const p = u.pathname.toLowerCase();
      if (p.endsWith('.pdf')) return 'pdf';
    } catch {}
    return 'page';
  }

  function IDX_extractOwnerPath(url='') {
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./,'');
      if (host === 'notion.so' || host.endsWith('.notion.site')) {
        return { docOwner: '', path: u.pathname };
      }
      if (host === 'drive.google.com') {
        return { docOwner: '', path: u.pathname };
      }
      if (host === 'confluence.yourcorp.com') {
        return { docOwner: '', path: u.pathname };
      }
    } catch {}
    return { docOwner: '', path: '' };
  }

  async function IDX_groupNameFromTab(t) {
    if (Number.isInteger(t.groupId) && t.groupId >= 0) {
      try {
        const g = await chrome.tabGroups.get(t.groupId);
        return g?.title || `group:${t.groupId}`;
      } catch { return `group:${t.groupId}`; }
    }
    return null;
  }

  // ==== CARD CREATION (ONLY FOR OPEN TABS) ====
  async function IDX_toCard({ source, payload }) {
    if (source !== 'tab') {
      IDX_err(`IDX_toCard called with invalid source: ${source}. Only 'tab' is allowed.`);
      return null;
    }

    const t = payload;
    if (!t || typeof t.id !== 'number') {
      IDX_err('IDX_toCard: payload must be a tab object with id');
      return null;
    }

    const title = t.title || '';
    const url = t.url || '';
    const domain = IDX_domainOf(url);
    const tabId = t.id;
    const windowId = t.windowId;
    const isPinned = !!t.pinned;
    const lastVisitedAt = t.active ? IDX_now() : (t.lastAccessed || IDX_now());
    const groupName = await IDX_groupNameFromTab(t);
    const type = IDX_inferTypeFromUrl(url);

    const sourceId = tabId;
    const cardId = `tab:${tabId}`;

    return {
      cardId,
      source: 'tab',
      sourceId: tabId,
      title,
      url,
      domain,
      type,
      tabId,
      windowId,
      isPinned,
      groupName,
      lastVisitedAt,
      updatedAt: IDX_now()
    };
  }

  function IDX_cryptoRandomId() {
    if (crypto?.randomUUID) return crypto.randomUUID();
    return String(Math.random()).slice(2) + String(Date.now());
  }

  // ==== BULLETPROOF BOOTSTRAP: ONLY OPEN TABS ====
  async function IDX_bootstrap() {
    IDX_DB = await IDX_openDB();
    
    const tabs = await chrome.tabs.query({});
    IDX_log(`Bootstrap: Found ${tabs.length} open tabs from chrome.tabs.query()`);
    
    IDX_cache.clear();
    
    const cardsToUpsert = [];
    for (const t of tabs) {
      const card = await IDX_toCard({ source: 'tab', payload: t });
      if (card) {
        IDX_cache.set(card.cardId, card);
        cardsToUpsert.push(card);
      }
    }
    
    if (cardsToUpsert.length > 0) {
      await IDX_idbPutAll(cardsToUpsert);
    }
    IDX_log(`Bootstrap: Upserted ${cardsToUpsert.length} open tabs into IndexedDB`);
    
    const currentOpenTabIds = new Set(tabs.map(t => t.id));
    const allStoredCards = await IDX_idbGetAll();
    const staleCardIds = [];
    
    for (const storedCard of allStoredCards) {
      if (storedCard.source === 'tab' && storedCard.tabId) {
        if (!currentOpenTabIds.has(storedCard.tabId)) {
          staleCardIds.push(storedCard.cardId);
        }
      } else {
        staleCardIds.push(storedCard.cardId);
      }
    }
    
    if (staleCardIds.length > 0) {
      IDX_log(`Bootstrap reconcile: Removing ${staleCardIds.length} stale cards from IndexedDB`);
      const deletePromises = staleCardIds.map(cardId => {
        IDX_cache.delete(cardId);
        IDX_removeFromIndex(cardId);
        return IDX_idbDelete(cardId).catch(e => {
          IDX_err('Failed to delete stale card during reconcile', cardId, e);
        });
      });
      await Promise.all(deletePromises);
      IDX_log(`Bootstrap reconcile: Removed ${staleCardIds.length} stale cards`);
    }
    
    const finalTabCount = Array.from(IDX_cache.values()).filter(c => c.source === 'tab').length;
    IDX_log(`Bootstrap complete: ${tabs.length} tabs open, ${finalTabCount} cards in IndexedDB (should match)`);
    
    if (finalTabCount !== tabs.length) {
      IDX_warn(`Bootstrap mismatch: ${tabs.length} open tabs but ${finalTabCount} cards in IndexedDB`);
    }
  }

  // ==== RECONCILE FUNCTION ====
  async function IDX_reconcileOpenTabs() {
    try {
      const tabs = await chrome.tabs.query({});
      const currentOpenTabIds = new Set(tabs.map(t => t.id));
      
      const staleCardIds = [];
      for (const [cardId, card] of IDX_cache.entries()) {
        if (card.source === 'tab' && card.tabId) {
          if (!currentOpenTabIds.has(card.tabId)) {
            staleCardIds.push(cardId);
          }
        } else if (card.source !== 'tab') {
          staleCardIds.push(cardId);
        }
      }
      
      if (staleCardIds.length > 0) {
        IDX_log(`Reconcile: Removing ${staleCardIds.length} stale cards`);
        for (const cardId of staleCardIds) {
          IDX_cache.delete(cardId);
          IDX_removeFromIndex(cardId);
          await IDX_idbDelete(cardId).catch(() => {});
        }
      }
      
      for (const t of tabs) {
        const cardId = `tab:${t.id}`;
        if (!IDX_cache.has(cardId)) {
          const card = await IDX_toCard({ source: 'tab', payload: t });
          if (card) {
            IDX_upsert(card);
          }
        }
      }
    } catch (err) {
      IDX_err('Reconcile failed', err);
    }
  }

  // ==== PHASE 2: IMPROVED TOKENIZATION ====
  const IDX_STOPWORDS = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may', 'might', 'can', 'this', 'that', 'these', 'those']);
  
  function IDX_tokenize(text) {
    if (!text || typeof text !== 'string') return [];
    const lower = text.toLowerCase();
    
    const tokens = lower.split(/[\W_]+/).filter(t => t.length > 0);
    const result = new Set();
    
    for (const token of tokens) {
      if (!IDX_STOPWORDS.has(token) || token.length >= 4 || /^[a-z]+\.[a-z]+/.test(token)) {
        result.add(token);
      }
    }
    
    if (tokens.length >= 2) {
      for (let i = 0; i < tokens.length - 1; i++) {
        const bigram = tokens.slice(i, i + 2).join(' ');
        const bothMeaningful = !IDX_STOPWORDS.has(tokens[i]) || !IDX_STOPWORDS.has(tokens[i + 1]);
        if (bothMeaningful) {
          result.add(bigram);
        }
      }
    }
    
    return Array.from(result);
  }

  // ==== PHASE 2: BUILD INVERTED INDEX ====
  function IDX_rebuildInvertedIndex() {
    IDX_invertedIndex = new Map();
    IDX_indexBuiltAt = Date.now();
    
    for (const card of IDX_cache.values()) {
      const tokens = new Set();
      
      if (card.title) IDX_tokenize(card.title).forEach(t => tokens.add(t));
      if (card.url) IDX_tokenize(card.url).forEach(t => tokens.add(t));
      if (card.domain) IDX_tokenize(card.domain).forEach(t => tokens.add(t));
      
      for (const token of tokens) {
        if (!IDX_invertedIndex.has(token)) {
          IDX_invertedIndex.set(token, new Set());
        }
        IDX_invertedIndex.get(token).add(card.cardId);
      }
    }
    
    IDX_log(`Inverted index rebuilt: ${IDX_invertedIndex.size} tokens, ${IDX_cache.size} cards`);
  }

  // ==== PHASE 7: INCREMENTAL INDEX UPDATE ====
  function IDX_updateIndexForCard(card) {
    if (!IDX_invertedIndex) {
      IDX_invertedIndex = new Map();
    }
    
    const tokens = new Set();
    
    if (card.title) IDX_tokenize(card.title).forEach(t => tokens.add(t));
    if (card.url) IDX_tokenize(card.url).forEach(t => tokens.add(t));
    if (card.domain) IDX_tokenize(card.domain).forEach(t => tokens.add(t));
    
    for (const [token, cardIds] of IDX_invertedIndex.entries()) {
      cardIds.delete(card.cardId);
      if (cardIds.size === 0) {
        IDX_invertedIndex.delete(token);
      }
    }
    
    for (const token of tokens) {
      if (!IDX_invertedIndex.has(token)) {
        IDX_invertedIndex.set(token, new Set());
      }
      IDX_invertedIndex.get(token).add(card.cardId);
    }
  }

  // ==== PHASE 7: REMOVE FROM INDEX ====
  function IDX_removeFromIndex(cardId) {
    if (!IDX_invertedIndex) return;
    
    for (const [token, cardIds] of IDX_invertedIndex.entries()) {
      cardIds.delete(cardId);
      if (cardIds.size === 0) {
        IDX_invertedIndex.delete(token);
      }
    }
  }

  // ==== PHASE 2: IMPROVED SCORING ====
  function IDX_scoreCard(card, queryTokens, matchedTokens, groupConstraint = null) {
    let score = 0;
    
    const queryLower = queryTokens.join(' ').toLowerCase();
    const titleLower = (card.title || '').toLowerCase();
    const urlLower = (card.url || '').toLowerCase();
    const domainLower = (card.domain || '').toLowerCase();
    const fullText = `${titleLower} ${urlLower} ${domainLower}`;
    
    if (fullText.includes(queryLower)) {
      score += 5;
    }
    
    for (const token of queryTokens) {
      if (token.length < 3) continue;
      
      if (domainLower === token || domainLower === `${token}.com` || domainLower === `${token}.org` || domainLower === `${token}.net`) {
        score += 10;
      } else if (domainLower.startsWith(token + '.')) {
        score += 10;
      } else if (domainLower.includes('.' + token + '.') || domainLower.endsWith('.' + token)) {
        score += 8;
      } else {
        const parentDomain = domainLower.split('.').slice(-2).join('.');
        if (parentDomain === token || parentDomain.startsWith(token + '.')) {
          score += 5;
        } else if (domainLower.includes(token) && token.length >= 4) {
          score += 4;
        }
      }
      
      try {
        const urlObj = new URL(card.url || '');
        const pathTail = urlObj.pathname.split('/').filter(p => p).pop() || '';
        if (pathTail.toLowerCase().includes(token.toLowerCase())) {
          score += 4;
        }
      } catch {}
    }
    
    if (groupConstraint && card.groupName) {
      const groupLower = (card.groupName || '').toLowerCase();
      const constraintLower = String(groupConstraint).toLowerCase();
      
      if (groupLower === constraintLower) {
        score += 6;
      } else if (groupLower.includes(constraintLower) || constraintLower.includes(groupLower)) {
        score += 3;
      }
    }
    
    if (matchedTokens.length >= 2) {
      score += 3;
    } else if (matchedTokens.length === 1) {
      score += 1;
    }
    
    const now = Date.now();
    const ageDays = (now - (card.lastVisitedAt || 0)) / (24 * 60 * 60 * 1000);
    if (ageDays < 1) score += 5;
    else if (ageDays < 7) score += 3;
    else if (ageDays < 30) score += 1;
    
    if (card.source === 'tab') score += 4;
    else if (card.source === 'bookmark') score += 2;
    else if (card.source === 'history') score += 1;
    
    return score;
  }

  // ==== PHASE 2: LEXICAL SEARCH ====
  function IDX_lexicalSearch(queryTokens, limit = 20, filters = null) {
    if (!IDX_invertedIndex || IDX_invertedIndex.size === 0) {
      IDX_rebuildInvertedIndex();
    }
    
    const sourceFilter = filters?.source;
    
    const candidateIds = new Set();
    const tokenHits = new Map();
    
    for (const token of queryTokens) {
      const hits = IDX_invertedIndex.get(token) || new Set();
      tokenHits.set(token, hits);
      for (const cardId of hits) {
        candidateIds.add(cardId);
      }
      
      for (const card of IDX_cache.values()) {
        const domainLower = (card.domain || '').toLowerCase();
        if (domainLower && token.length >= 3) {
          if (domainLower.startsWith(token + '.') ||
              domainLower === token ||
              domainLower.includes('.' + token + '.') ||
              domainLower.endsWith('.' + token)) {
            candidateIds.add(card.cardId);
            if (!tokenHits.has(token)) {
              tokenHits.set(token, new Set());
            }
            tokenHits.get(token).add(card.cardId);
          }
        }
        const titleLower = (card.title || '').toLowerCase();
        const urlLower = (card.url || '').toLowerCase();
        if (token.length >= 4 && (titleLower.includes(token) || urlLower.includes(token))) {
          candidateIds.add(card.cardId);
          if (!tokenHits.has(token)) {
            tokenHits.set(token, new Set());
          }
          tokenHits.get(token).add(card.cardId);
        }
      }
    }
    
    const scoredMap = new Map();
    for (const cardId of candidateIds) {
      const card = IDX_cache.get(cardId);
      if (!card) continue;
      
      if (scoredMap.has(cardId)) continue;
      
      const matchedTokens = queryTokens.filter(token => {
        if (tokenHits.get(token)?.has(cardId)) return true;
        if (card.domain && card.domain.toLowerCase().includes(token)) return true;
        const titleLower = (card.title || '').toLowerCase();
        const urlLower = (card.url || '').toLowerCase();
        if (titleLower.includes(token) || urlLower.includes(token)) return true;
        return false;
      });
      
      if (matchedTokens.length === 0) continue;
      
      const groupConstraint = filters?.group || null;
      const score = IDX_scoreCard(card, queryTokens, matchedTokens, groupConstraint);
      scoredMap.set(cardId, { card, score, matchedTokens });
    }
    
    const scored = Array.from(scoredMap.values());
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, Math.min(limit, 20));
  }

  function IDX_getHitsPerToken(tokens) {
    if (!IDX_invertedIndex) return {};
    const result = {};
    for (const token of tokens) {
      const hits = IDX_invertedIndex.get(token);
      result[token] = hits ? hits.size : 0;
    }
    return result;
  }

  // ==== TAB EVENT LISTENERS (ONLY) ====
  let IDX_listenersRegistered = false;
  
  function IDX_registerListeners() {
    if (IDX_listenersRegistered) return;
    IDX_listenersRegistered = true;
    
    IDX_log('Registering tab event listeners (ONLY - no history/bookmarks/sessions)');

    chrome.tabs.onCreated.addListener(async (t) => {
      const card = await IDX_toCard({ source: 'tab', payload: t });
      IDX_upsert(card);
      IDX_updateIndexForCard(card);
    });

    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
      const cardId = `tab:${tabId}`;
      const existing = IDX_cache.get(cardId) || await IDX_toCard({ source: 'tab', payload: tab });
      let touched = false;

      if ('title' in changeInfo) { 
        existing.title = changeInfo.title || ''; 
        touched = true; 
      }
      if ('url' in changeInfo) { 
        existing.url = changeInfo.url || ''; 
        existing.domain = IDX_domainOf(existing.url); 
        existing.type = IDX_inferTypeFromUrl(existing.url); 
        touched = true; 
      }
      if ('pinned' in changeInfo){ existing.isPinned = !!tab.pinned; touched = true; }

      if (Number.isInteger(tab.groupId) && tab.groupId >= 0) {
        try { existing.groupName = (await chrome.tabGroups.get(tab.groupId))?.title || `group:${tab.groupId}`; touched = true; } catch {}
      } else if (existing.groupName) {
        existing.groupName = null; touched = true;
      }

      if (touched) {
        existing.updatedAt = IDX_now();
        IDX_upsert(existing);
        IDX_updateIndexForCard(existing);
      }
    });

    chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
      const cardId = `tab:${tabId}`;
      const c = IDX_cache.get(cardId);
      if (c) {
        c.lastVisitedAt = IDX_now();
        c.windowId = windowId;
        c.updatedAt = IDX_now();
        IDX_upsert(c);
      } else {
        const tab = await chrome.tabs.get(tabId);
        const card = await IDX_toCard({ source: 'tab', payload: tab });
        IDX_upsert(card);
      }
    });

    chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
      const cardId = `tab:${tabId}`;
      if (IDX_cache.has(cardId)) {
        IDX_cache.delete(cardId);
        IDX_removeFromIndex(cardId);
        try {
          await IDX_idbDelete(cardId);
        } catch (e) {
          IDX_err('Failed to delete closed tab from IndexedDB', cardId, e);
        }
        IDX_log(`Tab ${tabId} removed → deleted card ${cardId}`);
      }
    });

    chrome.tabs.onAttached.addListener(async (tabId, attachInfo) => {
      const cardId = `tab:${tabId}`;
      const c = IDX_cache.get(cardId);
      if (c) {
        c.windowId = attachInfo.newWindowId;
        c.updatedAt = IDX_now();
        IDX_upsert(c);
      }
    });
    chrome.tabs.onDetached.addListener(async (tabId, detachInfo) => {
      const cardId = `tab:${tabId}`;
      const c = IDX_cache.get(cardId);
      if (c) {
        c.windowId = null;
        c.updatedAt = IDX_now();
        IDX_upsert(c);
      }
    });

    if (chrome.tabGroups?.onUpdated) {
      chrome.tabGroups.onUpdated.addListener(async (group) => {
        const tabs = await chrome.tabs.query({ groupId: group.id });
        for (const t of tabs) {
          const cardId = `tab:${t.id}`;
          const c = IDX_cache.get(cardId);
          if (c) {
            c.groupName = group.title || `group:${group.id}`;
            c.updatedAt = IDX_now();
            IDX_upsert(c);
          }
        }
      });
    }
    
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === 'IDX_RECONCILE') {
        IDX_reconcileOpenTabs().catch(() => {});
      }
    });
    
    chrome.alarms.create('IDX_RECONCILE', { periodInMinutes: 2 });
    
    IDX_log('Tab listeners registered. Reconcile alarm set (every 2 minutes)');
  }

  return {
    init: async () => { 
      await IDX_bootstrap(); 
      IDX_registerListeners();
    },
    handleMessage: async (msg) => {
      if (!msg?.type) return { ok: false, error: 'bad_request' };

      if (msg.type === 'INDEX_COUNTS') {
        let tabCount = 0;
        const toDelete = [];
        
        for (const c of IDX_cache.values()) {
          if (c.source === 'tab') {
            tabCount++;
          } else {
            toDelete.push(c.cardId);
          }
        }
        
        if (toDelete.length > 0) {
          IDX_log(`Removing ${toDelete.length} non-tab entries from cache during COUNT check`);
          for (const cardId of toDelete) {
            IDX_cache.delete(cardId);
            IDX_idbDelete(cardId).catch(()=>{});
            IDX_removeFromIndex(cardId);
          }
        }
        
        const counts = { 
          total: tabCount, 
          bySource: {
            tab: tabCount,
            history: 0,
            bookmark: 0,
            closed: 0
          }
        };
        return { ok: true, counts };
      }

      if (msg.type === 'INDEX_QUERY') {
        const toDelete = [];
        const q = (msg.query || '').toLowerCase();
        const filters = msg.filters || {};
        const out = [];
        
        for (const c of IDX_cache.values()) {
          if (c.source !== 'tab') {
            toDelete.push(c.cardId);
            continue;
          }
          
          if (filters.type && c.type !== filters.type) continue;
          if (filters.source && c.source !== filters.source) continue;
          if (filters.domain && c.domain !== filters.domain) continue;
          if (!q || (c.title?.toLowerCase().includes(q) || c.url?.toLowerCase().includes(q) || c.domain?.toLowerCase().includes(q))) {
            out.push(c);
          }
        }
        
        if (toDelete.length > 0) {
          IDX_log(`Removing ${toDelete.length} non-tab entries from cache during QUERY`);
          for (const cardId of toDelete) {
            IDX_cache.delete(cardId);
            IDX_idbDelete(cardId).catch(()=>{});
            IDX_removeFromIndex(cardId);
          }
        }
        
        out.sort((a,b) => (b.lastVisitedAt - a.lastVisitedAt) || (b.visitCount - a.visitCount));
        return { ok: true, results: out.slice(0, msg.limit || 25) };
      }

      if (msg.type === 'REFRESH_OPEN_TABS') {
        const REFRESH_THROTTLE_MS = 2000;
        const now = Date.now();
        if (now - IDX_lastRefreshOpenTabs < REFRESH_THROTTLE_MS) {
          return { ok: true, skipped: true, reason: 'throttled' };
        }
        IDX_lastRefreshOpenTabs = now;
        
        try {
          const tabs = await chrome.tabs.query({});
          let updated = 0;
          for await (const chunk of IDX_chunkArray(tabs, 20)) {
            for (const t of chunk) {
              const card = await IDX_toCard({ source: 'tab', payload: t });
              const existing = IDX_cache.get(card.cardId);
              if (!existing || existing.updatedAt < card.updatedAt) {
                IDX_upsert(card);
                IDX_updateIndexForCard(card);
                updated++;
              }
            }
            await IDX_yieldToEventLoop();
          }
          return { ok: true, updated };
        } catch (err) {
          return { ok: false, error: String(err?.message || err) };
        }
      }

      if (msg.type === 'INDEX_HEALTH') {
        let tabCount = 0;
        const toDelete = [];
        
        for (const c of IDX_cache.values()) {
          if (c.source === 'tab') {
            tabCount++;
          } else {
            toDelete.push(c.cardId);
          }
        }
        
        if (toDelete.length > 0) {
          IDX_log(`Removing ${toDelete.length} non-tab entries from cache during HEALTH check`);
          for (const cardId of toDelete) {
            IDX_cache.delete(cardId);
            IDX_idbDelete(cardId).catch(()=>{});
            IDX_removeFromIndex(cardId);
          }
        }
        
        const counts = { 
          total: tabCount, 
          bySource: {
            tab: tabCount,
            history: 0,
            bookmark: 0,
            closed: 0
          }
        };
        
        const examples = Array.from(IDX_cache.values()).slice(0, 5).map(c => ({
          cardId: c.cardId,
          source: c.source,
          title: c.title?.slice(0, 50) || '',
          domain: c.domain || '',
          type: c.type || ''
        }));
        
        return { ok: true, counts, examples };
      }

      if (msg.type === 'LEXICAL_SEARCH') {
        const query = String(msg.query || '').trim();
        const limit = msg.limit || 20;
        const filters = msg.filters || {};
        
        if (!query) {
          return { ok: false, error: 'empty_query' };
        }
        
        if (!IDX_invertedIndex) {
          IDX_rebuildInvertedIndex();
        }
        
        const queryTokens = IDX_tokenize(query);
        if (queryTokens.length === 0) {
          return { ok: true, results: [], tokens: [] };
        }
        
        let candidates = IDX_lexicalSearch(queryTokens, limit * 2);
        
        if (filters.source) {
          candidates = candidates.filter(c => c.card.source === filters.source);
        }
        
        const seen = new Set();
        const uniqueCandidates = [];
        for (const c of candidates) {
          if (!seen.has(c.card.cardId)) {
            seen.add(c.card.cardId);
            uniqueCandidates.push(c);
          }
        }
        
        const limitedCandidates = uniqueCandidates.slice(0, limit);
        
        return { 
          ok: true, 
          results: limitedCandidates.map(c => ({ card: c.card, score: c.score })),
          tokens: queryTokens,
          hitsPerToken: IDX_getHitsPerToken(queryTokens)
        };
      }

      return { ok: false, error: 'unknown_type' };
    },
    _get: (cardId) => {
      return IDX_cache.get(cardId) || null;
    }
  };
})();
