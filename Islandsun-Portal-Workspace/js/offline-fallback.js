import { DEFAULT_PORTAL_ORIGIN, ALTERNATIVE_PORTAL_ORIGIN, portalOrigin } from './shared/portal-address.js';

const PORTAL_HOST = new URL(DEFAULT_PORTAL_ORIGIN).hostname;
const FILTER = {urls:[`*://${PORTAL_HOST}/*`, `http://${new URL(ALTERNATIVE_PORTAL_ORIGIN).hostname}/*`], types:['main_frame']};
const requestKey = tabId => `islandsun.offline-navigation:${tabId}`;

function portalAddress(value) {
  try {
    const url = new URL(value);
    if (!['http:','https:'].includes(url.protocol) || url.hostname !== PORTAL_HOST && !portalOrigin(url.href) || url.username || url.password) return null;
    url.hash = '';
    return url.href;
  } catch { return null; }
}

/** Open the ordinary account-scoped viewer only after a top-level read fails. */
export function startOfflineFallback(api = chrome, {onUnavailable = async () => {}} = {}) {
  const requests = new Map();
  const listeners = [];
  let revision = 0;
  let persistence = Promise.resolve();
  function persist(operation) {
    const result = persistence.then(operation);
    persistence = result.catch(() => {});
    return result;
  }
  function forget(tabId, id) {
    return persist(async () => {
      const key = requestKey(tabId), saved = (await api.storage.session.get(key))[key];
      if (saved?.id === id) await api.storage.session.remove(key);
    }).catch(() => {});
  }
  function listen(event, listener, filter) {
    event.addListener(listener, ...(filter ? [filter] : []));
    listeners.push(() => event.removeListener(listener));
  }
  function eligible(details) {
    return details.tabId >= 0 && details.type === 'main_frame' && portalAddress(details.url);
  }
  function started(details) {
    if (!eligible(details)) return;
    const previous = requests.get(details.tabId);
    const current = {
      id:details.requestId, url:portalAddress(details.url), done:false,
      // A POST redirected to a GET is still part of a business submission.
      readOnly:details.method === 'GET' && (previous?.id !== details.requestId || previous.readOnly),
    };
    requests.set(details.tabId,current);
    current.ready = persist(async () => {
      const key = requestKey(details.tabId), saved = (await api.storage.session.get(key))[key];
      current.readOnly &&= saved?.id !== current.id || saved.readOnly;
      await api.storage.session.set({[key]:{id:current.id,readOnly:current.readOnly}});
    }).catch(() => { current.readOnly = false; });
  }
  function currentRequest(details) {
    if (!eligible(details)) return null;
    let current = requests.get(details.tabId);
    if (current && current.id !== details.requestId) return null;
    if (!current) {
      // A terminal event can wake a suspended extension worker.
      current = {id:details.requestId,url:portalAddress(details.url),readOnly:details.method === 'GET',done:false};
      requests.set(details.tabId,current);
      const restored = current;
      restored.ready = persist(async () => {
        const saved = (await api.storage.session.get(requestKey(details.tabId)))[requestKey(details.tabId)];
        restored.readOnly &&= saved?.id === restored.id && saved.readOnly;
      }).catch(() => { restored.readOnly = false; });
    }
    return current;
  }
  async function openSavedCopy(details, reason) {
    const current = currentRequest(details);
    if (!current || current.done) return;
    current.done = true;
    const generation = revision;
    try {
      await current.ready;
      if (!current.readOnly || details.method !== 'GET') return;
      const [settings,tab] = await Promise.all([api.storage.local.get({enabled:true}),api.tabs.get(details.tabId)]);
      if (!settings.enabled || generation !== revision || requests.get(details.tabId) !== current) return;
      // pendingUrl wins: a completed failure must not steal a newer navigation.
      if (portalAddress(tab.pendingUrl || tab.url) !== portalAddress(details.url)) return;
      try { await onUnavailable(); }
      catch { /* A status-storage failure must not prevent access to saved records. */ }
      if (generation !== revision || requests.get(details.tabId) !== current) return;
      await api.tabs.update(details.tabId,{url:api.runtime.getURL(`offline.html?fallback=${reason}`)});
    } catch {
      // Closed tabs and browser-rejected navigation leave Chrome's error page intact.
    } finally {
      await forget(details.tabId,current.id);
    }
  }
  function failed(details) {
    if (details.error === 'net::ERR_ABORTED' || details.error === 'net::ERR_BLOCKED_BY_CLIENT'
      || details.error === 'net::ERR_BLOCKED_BY_ADMINISTRATOR') {
      const current = currentRequest(details);
      if (current) { current.done = true; return forget(details.tabId,current.id); }
      return;
    }
    return openSavedCopy(details,'connection');
  }
  function response(details) {
    if (details.statusCode >= 500 && details.statusCode <= 599) return openSavedCopy(details,'server');
  }
  function completed(details) {
    if (details.statusCode >= 500 && details.statusCode <= 599) return response(details);
    const current = currentRequest(details);
    if (current) { current.done = true; return forget(details.tabId,current.id); }
  }
  listen(api.webRequest.onBeforeRequest,started,FILTER);
  listen(api.webRequest.onErrorOccurred,failed,FILTER);
  listen(api.webRequest.onResponseStarted,response,FILTER);
  listen(api.webRequest.onCompleted,completed,FILTER);
  listen(api.webRequest.onBeforeRedirect,details => {
    if (portalAddress(details.redirectUrl)) return;
    const current = currentRequest(details);
    if (current) { current.done = true; return forget(details.tabId,current.id); }
  },FILTER);
  listen(api.tabs.onRemoved,id => {
    requests.delete(id);
    persist(() => api.storage.session.remove(requestKey(id))).catch(() => {});
  });
  listen(api.tabs.onUpdated,(id,info,tab) => {
    const current = requests.get(id);
    if (current && info.url && portalAddress(tab.pendingUrl || info.url) !== current.url) {
      requests.set(id,{id:null,done:true});
      forget(id,current.id);
    }
  });
  listen(api.storage.onChanged,(changes,area) => {
    if (area === 'local' && changes.enabled) revision++;
  });
  return () => {
    revision++;
    for (const remove of listeners) remove();
    requests.clear();
  };
}
