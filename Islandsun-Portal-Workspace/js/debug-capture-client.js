import { captureResponseBody, responseHeaders, safeRequestBody, safeRequestUrl } from './debug-capture-data.js';
let activeUntil = 0;

async function send(message) {
  try { return await chrome.runtime.sendMessage(message); }
  catch { return null; }
}

/** Observe existing isolated-world lookups without moving their fetch or changing its credentials. */
export async function capturePortalFetch(url, options, kind, timeoutMs = 25000) {
  activeUntil = 0;
  let captureState;
  const registration = send({type:'debug-portal-start',kind,request:{
    url:safeRequestUrl(String(url)),method:options.method || 'GET',body:safeRequestBody(options.body),
    credentials:options.credentials,redirect:options.redirect,timeoutMs,
  }}).then(capture => { captureState = capture?.attemptId ? capture : null; activeUntil = capture?.expiresAt || 0; return capture; });
  const report = async (event,fields) => {
    const capture = await registration;
    activeUntil = capture?.expiresAt || 0;
    if (capture?.attemptId) await send({type:'debug-portal-event',attemptId:capture.attemptId,event,fields});
  };
  const started = performance.now();
  try {
    const response = await fetch(url,options);
    if (captureState === null) return response;
    const headers = report('response-headers',{
      status:response.status,url:safeRequestUrl(response.url || url),type:response.type,
      headers:responseHeaders(response.headers),headersMs:performance.now()-started,failure:response.status>=400,
    });
    const bodyStarted = performance.now();
    // Clone before returning; diagnostic storage must not hold the caller's response.
    void captureResponseBody(response).then(async body => {
      const timings = {bodyMs:performance.now()-bodyStarted,durationMs:performance.now()-started};
      await headers;
      await report('response-body',{body,...timings});
    }, async error => {
      await headers;
      await report('capture-body-failed',{errorType:error.name,failure:true});
    });
    return response;
  } catch (error) {
    void report('request-failed',{errorType:error.name,durationMs:performance.now()-started,failure:true});
    throw error;
  }
}

export function recordPortalProcessing(url, operation, durationMs, root) {
  if (Date.now()>=activeUntil) return;
  send({type:'debug-portal-processing',url:safeRequestUrl(url),operation,durationMs,nodes:root.querySelectorAll('*').length});
}
