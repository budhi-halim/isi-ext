export { PORTAL_ROOT, LOGIN_URL, SessionExpiredError, fetchPortal } from './shared/portal-session.js';

export function pause(milliseconds, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, milliseconds);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
