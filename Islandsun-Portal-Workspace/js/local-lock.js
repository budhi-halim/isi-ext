/** Extension ports coordinate insecure-HTTP portal tabs without weakening browser security. */
export function acquireLocalLock(key, { wait = true, onLost, timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connect({ name: 'islandsun-local-lock' });
    let granted = false, released = false;
    const timeout = setTimeout(() => { if (!granted) { port.disconnect(); reject(new Error('The shared request is still busy. Please try again.')); } }, timeoutMs);
    port.onMessage.addListener(message => {
      clearTimeout(timeout);
      if (!message.granted) { port.disconnect(); resolve(null); return; }
      granted = true; resolve(() => { released = true; port.disconnect(); });
    });
    port.onDisconnect.addListener(() => { clearTimeout(timeout); if (!granted) reject(new Error('The extension connection was interrupted. Refresh the portal.')); else if (!released) onLost?.(); });
    port.postMessage({ key, wait });
  });
}
