import { fetchPortal as requestPortal, isLoginDocument, SessionExpiredError } from './shared/portal-session.js';
export { PORTAL_ROOT, LOGIN_URL, SessionExpiredError, readPortalItems } from './shared/portal-session.js';

/** Missing historical IDs may be skipped; connection failures must stop an incomplete export. */
export async function fetchPortal(url, signal) {
  const response = await requestPortal(url, signal);
  if (!response.ok && ![404, 410].includes(response.status)) throw new Error('The company connection is unavailable.');
  return response;
}

export async function readRecord(response) {
  const text = await response.text();
  if (isLoginDocument(text)) throw new SessionExpiredError();
  return text;
}

export function pause(milliseconds, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, milliseconds);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
