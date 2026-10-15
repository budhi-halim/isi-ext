/** Hold optional work for the lifetime of a native save/submit transaction. */
export function holdForegroundAction(action) {
  let port;
  try {
    port = chrome.runtime.connect({name:'islandsun-action-guard'});
    port.postMessage({action});
  } catch { /* Native saving must remain usable if the extension is shutting down. */ }
  return () => { port?.disconnect(); port = null; };
}
