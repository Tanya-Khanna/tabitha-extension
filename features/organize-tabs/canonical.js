// URL Canonicalization and Intent Cache Management
// Handles URL normalization, deterministic intent caching, and domain overrides

const log = (...a) => console.log("[Tabitha::canonical]", ...a);

// ============================================================================
// URL CANONICALIZATION
// ============================================================================

/**
 * Canonicalize a URL for consistent grouping/caching
 * - Lowercase host
 * - Strip fragments (#anchor)
 * - Remove benign query params (utm_*, gclid, ref, etc.)
 * - Trim trailing slashes
 */
export function canonicalizeUrl(url) {
  try {
    const u = new URL(url);
    
    // Lowercase host
    u.hostname = u.hostname.toLowerCase();
    
    // Remove fragment
    u.hash = '';
    
    // Remove benign query params (tracking, UTM, etc.)
    const paramsToRemove = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'gclid', 'gclsrc', 'fbclid', 'ref', 'source', 'medium',
      '_ga', '_gid', 'icid', 'cid', 'ncid',
      'fb_action_ids', 'fb_action_types', 'fb_source',
      'mc_cid', 'mc_eid', '_hsenc', '_hsmi'
    ];
    
    const searchParams = new URLSearchParams(u.search);
    for (const key of paramsToRemove) {
      searchParams.delete(key);
      // Also remove variations (case-insensitive)
      for (const param of Array.from(searchParams.keys())) {
        if (param.toLowerCase() === key.toLowerCase()) {
          searchParams.delete(param);
        }
      }
    }
    
    u.search = searchParams.toString();
    
    // Remove trailing slash from pathname (except root)
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1);
    }
    
    return u.toString();
  } catch (err) {
    log('Failed to canonicalize URL:', url, err);
    return url; // Fallback to original
  }
}

/**
 * Generate a canonical URL key for caching (host + path, no query/fragment)
 */
export function getUrlKey(url) {
  try {
    const u = new URL(canonicalizeUrl(url));
    // Use hostname + pathname as key (no query params for key)
    return `${u.hostname}${u.pathname}`;
  } catch (err) {
    log('Failed to generate URL key:', url, err);
    return url; // Fallback
  }
}

// ============================================================================
// DOMAIN OVERRIDES
// ============================================================================

/**
 * Domain-specific intent overrides
 * Maps domains to forced intents (bypasses AI classification)
 */
const DOMAIN_OVERRIDES = {
  'colab.research.google.com': 'Dev Tools',
  'github.com': 'Dev Tools',
  'gitlab.com': 'Dev Tools',
  'stackoverflow.com': 'Reading & Reference',
  'mail.google.com': 'Comms',
  'gmail.com': 'Comms',
  'slack.com': 'Comms',
  'teams.microsoft.com': 'Comms',
  'zoom.us': 'Comms',
  'meet.google.com': 'Comms',
  'youtube.com': 'Media',
  'spotify.com': 'Media',
  'docs.google.com': 'Deep Work',
  'sheets.google.com': 'Deep Work',
  'notion.so': 'Deep Work',
  'research.google.com': 'Dev Tools' // Colab parent domain
};

/**
 * Get forced intent for a domain (if override exists)
 */
export function getDomainOverride(domain) {
  if (!domain) return null;
  const normalizedDomain = domain.toLowerCase().replace(/^www\./, '');
  return DOMAIN_OVERRIDES[normalizedDomain] || null;
}

// ============================================================================
// INTENT CACHE MANAGEMENT (chrome.storage.local)
// ============================================================================

const CACHE_KEY = 'tabitha_intentCache';
const DOMAIN_RULES_KEY = 'tabitha_domainRules';

/**
 * Load intent cache from chrome.storage.local
 */
async function loadIntentCache() {
  try {
    const result = await chrome.storage.local.get([CACHE_KEY]);
    return result[CACHE_KEY] || {};
  } catch (err) {
    log('Failed to load intent cache:', err);
    return {};
  }
}

/**
 * Save intent cache to chrome.storage.local
 */
async function saveIntentCache(cache) {
  try {
    await chrome.storage.local.set({ [CACHE_KEY]: cache });
  } catch (err) {
    log('Failed to save intent cache:', err);
  }
}

/**
 * Load domain rules from chrome.storage.local
 */
async function loadDomainRules() {
  try {
    const result = await chrome.storage.local.get([DOMAIN_RULES_KEY]);
    return result[DOMAIN_RULES_KEY] || {};
  } catch (err) {
    log('Failed to load domain rules:', err);
    return {};
  }
}

/**
 * Save domain rules to chrome.storage.local
 */
async function saveDomainRules(rules) {
  try {
    await chrome.storage.local.set({ [DOMAIN_RULES_KEY]: rules });
  } catch (err) {
    log('Failed to save domain rules:', err);
  }
}

/**
 * Get cached intent for a URL key
 * Returns: { intent, score, updatedAt, source: 'cache'|'override'|null }
 */
export async function getCachedIntentForUrl(urlKey, domain) {
  // Check domain override first
  const domainOverride = getDomainOverride(domain);
  if (domainOverride) {
    return {
      intent: domainOverride,
      score: 1.0, // Maximum confidence for overrides
      updatedAt: Date.now(),
      source: 'override'
    };
  }
  
  // Check domain rules (user-defined)
  const domainRules = await loadDomainRules();
  if (domainRules[domain]) {
    return {
      intent: domainRules[domain],
      score: 0.95, // High confidence for user rules
      updatedAt: Date.now(),
      source: 'override'
    };
  }
  
  // Check URL-based cache
  const cache = await loadIntentCache();
  const cached = cache[urlKey];
  if (!cached) return null;
  
  // Cache expiry: 30 days
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  const age = Date.now() - cached.updatedAt;
  if (age > thirtyDays) {
    // Expired, remove it
    delete cache[urlKey];
    await saveIntentCache(cache);
    return null;
  }
  
  return {
    intent: cached.intent,
    score: cached.score,
    updatedAt: cached.updatedAt,
    source: 'cache'
  };
}

/**
 * Cache intent for a URL key
 * Only updates if new score is ≥0.15 better than existing
 * Returns true if cache was updated
 */
export async function cacheIntentForUrl(urlKey, intent, score) {
  const cache = await loadIntentCache();
  const existing = cache[urlKey];
  
  // Stability rule: only update if new score is significantly better (≥0.15)
  if (existing && existing.intent === intent) {
    // Same intent, update score if better (but keep existing if close)
    if (score >= existing.score + 0.15) {
      cache[urlKey] = { intent, score, updatedAt: Date.now() };
      await saveIntentCache(cache);
      return true;
    }
    return false; // Kept existing, no update
  }
  
  // Different intent or new entry
  if (existing) {
    // Check if new score is significantly better
    if (score < existing.score + 0.15) {
      // New score not better enough, keep existing
      return false;
    }
  }
  
  // Update cache
  cache[urlKey] = { intent, score, updatedAt: Date.now() };
  await saveIntentCache(cache);
  return true;
}

/**
 * Update domain rule (user override)
 */
export async function setDomainRule(domain, intent) {
  const rules = await loadDomainRules();
  if (intent) {
    rules[domain] = intent;
  } else {
    delete rules[domain];
  }
  await saveDomainRules(rules);
}

/**
 * Clear intent cache (optional: for specific URL key)
 */
export async function clearIntentCache(urlKey = null) {
  if (urlKey) {
    const cache = await loadIntentCache();
    delete cache[urlKey];
    await saveIntentCache(cache);
  } else {
    await chrome.storage.local.remove(CACHE_KEY);
  }
}

