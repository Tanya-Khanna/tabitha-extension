// Shared utility functions
export const log = (...a) => console.log("[Tabitha::bg]", ...a);

export function getDomain(url = "") {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return ""; }
}

export function getBaseDomain(url) {
  try {
    const domain = getDomain(url);
    const parts = domain.split(".");
    if (parts.length >= 2) {
      return parts.slice(-2).join(".");
    }
    return domain;
  } catch {
    return "";
  }
}

// URL normalization for dedupe & "is already open": strip #..., known utm_*, fbclid, gclid, etc.
export function normalizeUrl(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const u = new URL(url);
    // Remove hash fragment
    u.hash = '';
    // Remove common tracking params
    const paramsToRemove = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref', 'source', 'fbclid', 'gclid', '_ga', 'gclsrc', 'dclid'];
    paramsToRemove.forEach(p => u.searchParams.delete(p));
    // Normalize to string (remove trailing slash for consistency)
    return u.toString().replace(/\/$/, '').toLowerCase().trim();
  } catch {
    // If URL parsing fails, return lowercase trimmed version
    return url.toLowerCase().trim();
  }
}

