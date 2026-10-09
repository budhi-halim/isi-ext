export const PORTAL_ROOT = 'http://apps.islandsunindonesia.com:81/islandsun/';
export const LOGIN_URL = `${PORTAL_ROOT}index.php/login/`;

export class SessionExpiredError extends Error {
  constructor() { super('Your company session has expired. Sign in and try again.'); this.name = 'SessionExpiredError'; }
}

export async function fetchPortal(url, signal) {
  signal?.throwIfAborted();
  const timeout = AbortSignal.timeout(30000);
  const response = await fetch(url, { credentials: 'include', signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  if ([401, 403].includes(response.status) || /\/login(?:\/|\?|$)/i.test(new URL(response.url || url).pathname)) throw new SessionExpiredError();
  return response;
}

export function pause(milliseconds, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, milliseconds);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
