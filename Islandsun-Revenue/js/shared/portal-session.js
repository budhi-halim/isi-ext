import { PORTAL_ORIGIN, portalOrigin, portalUrl } from './portal-address.js';

export const PORTAL_ROOT = `${PORTAL_ORIGIN}/islandsun/`;
export const LOGIN_URL = `${PORTAL_ROOT}index.php/login/`;

export class SessionExpiredError extends Error {
  constructor() { super('Your company session has expired. Sign in and try again.'); this.name = 'SessionExpiredError'; }
}

export async function fetchPortal(url, signal) {
  const target = portalUrl(url);
  if (!target) throw new Error('The company address is not supported.');
  signal?.throwIfAborted();
  const timeout = AbortSignal.timeout(30000);
  const response = await fetch(target.href, {credentials: 'include', cache: 'no-store', signal: signal ? AbortSignal.any([signal, timeout]) : timeout});
  const destination = new URL(response.url || target.href);
  if ([401, 403].includes(response.status) || /\/login(?:\/|$)/i.test(destination.pathname)) throw new SessionExpiredError();
  if (destination.origin !== target.origin || !portalUrl(destination.href)) throw new Error('The company system returned an unexpected address.');
  return response;
}

export function isLoginDocument(text) {
  return /<input\b[^>]*\btype\s*=\s*["']?password\b/i.test(text) ||
    /<form\b[^>]*\baction\s*=\s*["'][^"']*\/login\b/i.test(text) ||
    /<form\b[^>]*\bclass\s*=\s*["'][^"']*\blockscreen-credentials\b/i.test(text) ||
    /<title\b[^>]*>[^<]*\bLogin\s*<\/title>/i.test(text);
}

export async function readPortalItems(response) {
  if (!response.ok) throw new Error('The company connection is unavailable.');
  const text = await response.text();
  if (isLoginDocument(text)) throw new SessionExpiredError();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('The company system returned an unreadable response.'); }
  const items = Array.isArray(data) ? data : data?.data;
  if (!Array.isArray(items)) throw new Error('The company system returned an unexpected response.');
  return items;
}

export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function sampleListUrl(from, to) {
  const url = new URL('samplerequest/json', PORTAL_ROOT);
  url.search = new URLSearchParams({dari: from, sampai: to, fil_status: '', tipe: ''});
  return url.href;
}

export async function checkSession(signal, origin = PORTAL_ORIGIN) {
  if (portalOrigin(origin) !== origin) throw new Error('The company address is not supported.');
  // Protected-route redirects determine sign-in state; signed-in pages can contain password controls.
  const response = await fetchPortal(`${origin}/islandsun/`, signal);
  if (!response.ok) throw new Error('The company connection is unavailable.');
  signal?.throwIfAborted();
  await response.body?.cancel();
}
