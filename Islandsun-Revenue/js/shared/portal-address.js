export const DEFAULT_PORTAL_ORIGIN = 'http://apps.islandsunindonesia.com:81';
export const ALTERNATIVE_PORTAL_ORIGIN = 'http://192.168.0.22:81';
export const PORTAL_MATCHES = ['http://apps.islandsunindonesia.com/islandsun/*', 'http://192.168.0.22/islandsun/*'];

/** Match exact origins, including the port, independently of Chrome's host permissions. */
export function portalOrigin(value) {
  try {
    const url = new URL(value);
    return !url.username && !url.password && [DEFAULT_PORTAL_ORIGIN, ALTERNATIVE_PORTAL_ORIGIN].includes(url.origin) ? url.origin : null;
  } catch { return null; }
}

// Content modules follow their page. Extension pages and workers default to the domain.
export const PORTAL_ORIGIN = portalOrigin(globalThis.location?.href) || DEFAULT_PORTAL_ORIGIN;

export function portalUrl(value) {
  if (!portalOrigin(value)) return null;
  const url = new URL(value);
  return /^\/islandsun(?:\/|$)/i.test(url.pathname) ? url : null;
}

/** Route a recognized portal resource through a deliberately selected session. */
export function rebasePortalUrl(value, origin = PORTAL_ORIGIN) {
  if (portalOrigin(origin) !== origin) throw new TypeError('Unsupported portal address.');
  const url = portalUrl(value);
  return url ? `${origin}${url.pathname}${url.search}${url.hash}` : value;
}

/** An existing tab is user intent; a failed connection never selects another address. */
export async function selectPortalTab(tabs) {
  const candidates = (await tabs.query({url: PORTAL_MATCHES})).filter(tab => portalUrl(tab.url));
  const active = await tabs.query({active: true, lastFocusedWindow: true});
  return candidates.find(tab => active.some(current => current.id === tab.id))
    || candidates.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0] || null;
}
