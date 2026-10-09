import { captureResponseBody, responseHeaders, safeRequestBody, safeRequestUrl } from './debug-capture-data.js';
let activeUntil = 0;

async function send(message) {
  try { return await chrome.runtime.sendMessage(message); }
  catch { return null; }
}

/** Observe existing isolated-world lookups without moving their fetch or changing its credentials. */
export async function capturePortalFetch(url, options, kind) {
  const capture = await send({type:'debug-portal-start',kind,request:{
    url:safeRequestUrl(String(url)),method:options.method || 'GET',body:safeRequestBody(options.body),
    credentials:options.credentials,redirect:options.redirect,timeoutMs:10000,
  }});
  activeUntil = capture?.expiresAt || 0;
  if (!capture?.attemptId) return fetch(url,options);
  const report = (event,fields) => send({type:'debug-portal-event',attemptId:capture.attemptId,event,fields});
  const started = performance.now();
  try {
    const response = await fetch(url,options);
    await report('response-headers',{
      status:response.status,url:safeRequestUrl(response.url || url),type:response.type,
      headers:responseHeaders(response.headers),headersMs:performance.now()-started,failure:response.status>=400,
    });
    const bodyStarted = performance.now();
    try {
      const body = await captureResponseBody(response);
      await report('response-body',{body,bodyMs:performance.now()-bodyStarted,durationMs:performance.now()-started});
    } catch (error) {
      await report('capture-body-failed',{errorType:error.name,failure:true});
    }
    return response;
  } catch (error) {
    await report('request-failed',{errorType:error.name,durationMs:performance.now()-started,failure:true});
    throw error;
  }
}

export function recordPortalProcessing(url, operation, durationMs, root) {
  if (Date.now()>=activeUntil) return;
  send({type:'debug-portal-processing',url:safeRequestUrl(url),operation,durationMs,nodes:root.querySelectorAll('*').length});
}
