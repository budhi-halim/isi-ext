import { portalOrigin, PORTAL_MATCHES } from './shared/portal-address.js';

/** Pause optional reads while any portal tab is loading its native page. */
export function watchPortalNavigation(tabs, changed, webRequest) {
  const loading = new Set();
  const requests = new Map();
  let observed = new Set();
  let ready = !tabs?.query;
  let settledAt = 0;
  function notify(state) {
    changed(state ? {...state, loading:loading.size, pendingRequests:requests.size} : undefined);
  }
  function isPortal(tab) {
    try {
      const url = new URL(tab?.url);
      return portalOrigin(url.href) && /^\/islandsun(?:\/|$)/i.test(url.pathname);
    } catch { return false; }
  }
  function update(id, info, tab) {
    if (!info.status && !info.url) return;
    observed?.add(id);
    const wasLoading = loading.has(id);
    if (isPortal(tab) && (info.status || tab.status) === 'loading') loading.add(id);
    else loading.delete(id);
    if (wasLoading && !loading.has(id)) settledAt = Date.now() + 1000;
    notify(isPortal(tab) || wasLoading ? {
      tabId:id,status:info.status || tab.status,url:isPortal(tab)?tab.url:undefined,loading:loading.size,
    } : undefined);
  }
  tabs?.onUpdated?.addListener(update);
  tabs?.onRemoved?.addListener(id => {
    observed?.add(id);
    const hadRequest = requests.delete(id);
    if (loading.delete(id) || hadRequest) { settledAt = Date.now() + 1000; notify(); }
  });
  // Tab status can remain complete until response headers arrive. Track the
  // provisional request independently so keepalive cannot enter that gap.
  const filter = {urls:PORTAL_MATCHES, types:['main_frame']};
  function requestStarted(details) {
    if (details.tabId < 0 || details.type !== 'main_frame' || !isPortal(details)) return;
    const previous = requests.get(details.tabId);
    requests.set(details.tabId, {id:details.requestId,
      startedAt:previous?.id === details.requestId ? previous.startedAt : details.timeStamp, url:details.url});
    notify({tabId:details.tabId, status:'request-started', browserRequestId:details.requestId, url:details.url});
  }
  function requestEnded(details) {
    const active = requests.get(details.tabId);
    if (!active || active.id !== details.requestId) return;
    requests.delete(details.tabId);
    settledAt = Date.now() + 1000;
    notify({tabId:details.tabId, status:details.error ? 'request-failed' : 'request-finished',
      browserRequestId:details.requestId, url:active.url,
      durationMs:Math.max(0, details.timeStamp - active.startedAt)});
  }
  webRequest?.onBeforeRequest?.addListener(requestStarted, filter);
  webRequest?.onCompleted?.addListener(requestEnded, filter);
  webRequest?.onErrorOccurred?.addListener(requestEnded, filter);
  webRequest?.onBeforeRedirect?.addListener(details => {
    // Redirects inside the portal retain the request ID. External destinations
    // fall outside this listener's host scope and must release it here.
    if (!isPortal({url:details.redirectUrl})) requestEnded(details);
  }, filter);
  if (tabs?.query) tabs.query({url:PORTAL_MATCHES}).then(list => {
    for (const tab of list) {
      if (!observed.has(tab.id) && (isPortal(tab) && tab.status === 'loading' || isPortal({url:tab.pendingUrl}))) loading.add(tab.id);
    }
  }).catch(() => {}).finally(() => { observed = null; ready = true; notify(); });
  return {
    busy: () => !ready || loading.size > 0 || requests.size > 0,
    pendingRequest: () => requests.size > 0,
    settledAt: () => settledAt,
  };
}
