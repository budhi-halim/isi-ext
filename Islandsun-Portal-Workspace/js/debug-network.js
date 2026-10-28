import { portalOrigin, PORTAL_MATCHES } from './shared/portal-address.js';
import { safeRequestUrl } from './debug-capture-data.js';

/** Observe portal transport lifecycle only; no blocking listeners, headers or request bodies. */
export function startDebugNetwork(debug, webRequest=chrome.webRequest) {
  if (!webRequest) return;
  const filter={urls:PORTAL_MATCHES};
  const observe = event => details => {
    if (!debug.recording()) return;
    try {
      if (!portalOrigin(details.url)) return;
      const fields={browserRequestId:details.requestId,observedAt:details.timeStamp,url:safeRequestUrl(details.url),resourceType:details.type,method:details.method,tabId:details.tabId,frameId:details.frameId};
      if (Number.isInteger(details.statusCode)) fields.status=details.statusCode;
      if (details.redirectUrl) fields.redirectUrl=safeRequestUrl(details.redirectUrl);
      if (details.error) fields.networkError=String(details.error).slice(0,160);
      if (typeof details.fromCache==='boolean') fields.fromCache=details.fromCache;
      fields.failure=!!details.error || details.statusCode>=400;
      debug.note(event,fields).catch(()=>{});
    } catch { /* Diagnostics never affect the observed request. */ }
  };
  for (const [name,event] of [
    ['onBeforeRequest','browser-request-start'],['onResponseStarted','browser-response-start'],
    ['onBeforeRedirect','browser-request-redirect'],['onCompleted','browser-request-complete'],
    ['onErrorOccurred','browser-request-failed'],
  ]) webRequest[name].addListener(observe(event),filter);
}
