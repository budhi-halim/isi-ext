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
  if (recordNeedsSignIn(text)) throw new SessionExpiredError();
  return text;
}

function recordNeedsSignIn(text) {
  if (!isLoginDocument(text)) return false;
  if (!text.includes('loginMultipleUser')) return true;
  const document = new DOMParser().parseFromString(text, 'text/html');
  const accountSwitch = document.querySelector('form#loginMultipleUser');
  if (!accountSwitch || !document.querySelector('.main-sidebar') || !document.querySelector('.content-wrapper')) return true;
  // The signed-in shell embeds a login form for switching accounts without ending the current session.
  accountSwitch.remove();
  return isLoginDocument(document.documentElement.outerHTML);
}

export function pause(milliseconds, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, milliseconds);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
