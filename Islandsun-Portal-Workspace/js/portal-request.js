import { rebasePortalUrl } from './shared/portal-address.js';
import { portalUrl } from './shared/document-names.js';
import { isTirSourceUrl } from './tir-source-logic.js';
import { recordConnectionDiagnostic } from './connection-diagnostics.js';
import { logFetch, logFetchResult, requestNumber as knownRequestNumber } from './request-log.js';
import { createActivityLog } from './activity-log.js';
import { ACCOUNT_SCOPE } from './account-scope.js';
import { capturePortalFetch } from './debug-capture-client.js';
import { recordKind } from './fetch-policy.js';

async function verifyPageAccount() {
  const link = document.querySelector('.user-menu a[href*="lockscreen?user="]');
  if (!link) return;
  const account = new URL(link.href).searchParams.get('user');
  const scope = (await chrome.storage.local.get(ACCOUNT_SCOPE))[ACCOUNT_SCOPE];
  if (scope && scope.account !== account) throw Object.assign(new Error('The signed-in account changed. Reload this page.'),{code:'ACCOUNT_CHANGED'});
}

function requestKind(url) {
  const path = new URL(url).pathname.toLowerCase();
  if (path.endsWith('/samplerequest/json')) return 'sample-index';
  if (path.endsWith('/tir/json')) return 'tir-index';
  if (path.endsWith('/samplerequest/edit')) return 'sample-detail';
  if (/\/tir\/edit\/\d+$/.test(path)) return 'tir-detail';
  if (path.endsWith('/getprodukusernd') || path.endsWith('/getprodukusagernd')) return 'sample-products';
  if (isTirSourceUrl(String(url))) return 'tir-source';
  return 'portal-read';
}

let lifecycle = new AbortController();
let navigating = false;
let listening = false;
const activity = createActivityLog('Live reads');

function suspend(reason = 'navigation') { activity.pause(reason); lifecycle.abort(new DOMException('Portal reads paused', 'AbortError')); }
function resume() {
  if (!navigating && lifecycle.signal.aborted) { lifecycle = new AbortController(); activity.resume(); }
}
function listen() {
  if (listening) return;
  listening = true;
  window.addEventListener('beforeunload', () => { navigating = true; suspend(); });
  window.addEventListener('pagehide', () => suspend());
  window.addEventListener('pageshow', () => { navigating = false; resume(); });
  // A cancelled navigation leaves the same document active; real interaction resumes its reads.
  for (const type of ['pointerdown', 'keydown']) document.addEventListener(type, event => {
    if (event.isTrusted && navigating) { navigating = false; resume(); }
  }, { passive: true });
}

function acquireRead(signal, priority, editorLookup, purpose, url) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const port = chrome.runtime.connect({ name: 'islandsun-read-gate' });
    let granted = false, released = false, yielding = false;
    const disconnected = new AbortController();
    const queuedAt = Date.now();
    const waiting = setTimeout(() => {
      try { port.postMessage({type:'status'}); }
      catch { /* Disconnection owns cleanup and the error result. */ }
    }, 4000);
    const timeout = setTimeout(() => {
      activity.note('queue-timeout', 'Queue wait reached two minutes; this attempt stopped. Background checks retry automatically.');
      stop(new Error('The portal is busy. Please try again shortly.'));
    }, 120000);
    function stop(error) {
      released = true; clearTimeout(timeout); clearTimeout(waiting); signal?.removeEventListener('abort', abort); port.disconnect();
      if (!granted) reject(error);
    }
    // Cancelling a consumer removes a waiter, but an active HTTP response retains
    // its permit until the transaction finishes; client abort cannot stop PHP work.
    const abort = () => { if (!granted) stop(signal.reason); };
    signal?.addEventListener('abort', abort, { once: true });
    port.onDisconnect.addListener(() => {
      clearTimeout(timeout); clearTimeout(waiting); signal?.removeEventListener('abort', abort);
      if (!released) {
        const error = new Error('The portal connection was interrupted. Please try again.');
        disconnected.abort(error);
        if (!granted) reject(error);
      }
    });
    port.onMessage.addListener(message => {
      if (message.waiting) {
        if (!granted && !released) activity.pause(message.waiting.reason, message.waiting.until);
        return;
      }
      if (message.yield) { activity.note('yield', 'Yielding to visible table activity after the current response finishes.'); yielding = true; return; }
      if (message.cooldownUntil) {
        activity.pause('recovery', message.cooldownUntil);
        const error = new Error('The portal connection needs time to recover. Cached products remain available; live checks will retry automatically.');
        error.code = 'PORTAL_READ_COOLDOWN'; stop(error); return;
      }
      if (message.paused) {
        const offline = message.reason === 'offline';
        activity.pause(offline ? 'offline' : 'editor');
        const error = new Error(offline ? 'The portal is unavailable. Live lookups will resume after the connection recovers.' : 'Live product lookups are paused while a request form is open. Return to a list to resume.');
        error.code = offline ? 'PORTAL_OFFLINE' : 'PORTAL_EDITOR_OPEN'; disconnected.abort(error); stop(error); return;
      }
      if (!message.granted || released) return;
      granted = true; clearTimeout(timeout); clearTimeout(waiting); activity.resume();
      if (Date.now() - queuedAt >= 4000) activity.note('queue-granted', `Queue granted after ${((Date.now() - queuedAt) / 1000).toFixed(1)}s.`);
      resolve({ release: failed => {
        try { if (!released) port.postMessage({type:'finished', failed}); }
        catch { /* A disconnected permit already released its lane. */ }
        finally { stop(); }
      }, signal: disconnected.signal, assertAvailable: () => {
        if (yielding) throw new DOMException('Portal table activity has priority.','AbortError');
      } });
    });
    port.postMessage({ type: 'read', priority, editorLookup, purpose, url, kind:url ? recordKind(url) : undefined });
  });
}

/** Keep a record's dependent reads together so another record cannot replace portal session state. */
export async function withPortalRead(task, { signal, priority = false, editorLookup, purpose = priority ? 'hover' : 'notification', reason, url } = {}) {
  listen();
  if (editorLookup) editorLookup = rebasePortalUrl(editorLookup);
  if (url) url = rebasePortalUrl(url);
  signal = signal ? AbortSignal.any([signal, lifecycle.signal]) : lifecycle.signal;
  if (editorLookup && !isTirSourceUrl(editorLookup)) throw new Error('This request link is unavailable.');
  const permit = await acquireRead(signal, priority, editorLookup, purpose, url || editorLookup);
  const transactionSignal = AbortSignal.any([signal, permit.signal]);
  let previousRead = false;
  const loggedRecords = new Set();
  let failed = false;
  async function read(url, { signal: _signal, priority: _priority, editorLookup: _lookup, purpose:_purpose, reason:_reason, url:_url, binary = false, maxBytes, requestNumber, ...options } = {}) {
    permit.assertAvailable();
    if (!portalUrl(String(url))) throw new Error('This portal link is unavailable.');
    url = rebasePortalUrl(String(url));
    if (editorLookup && (String(url) !== editorLookup || (options.method && options.method !== 'GET'))) throw new Error('This request link is unavailable.');
    transactionSignal.throwIfAborted();
    if (previousRead) await new Promise((resolve, reject) => {
      const finish = () => { transactionSignal.removeEventListener('abort', abort); resolve(); };
      const timer = setTimeout(finish, 250);
      const abort = () => { clearTimeout(timer); reject(transactionSignal.reason); };
      transactionSignal.addEventListener('abort', abort, { once: true });
    });
    previousRead = true;
    permit.assertAvailable();
    const timeout = AbortSignal.timeout(binary ? 60000 : 25000);
    const requestSignal = AbortSignal.any([permit.signal, timeout]);
    const started = performance.now(), kind = requestKind(url);
    let status = 0, outcome = 'complete';
    recordConnectionDiagnostic({kind, outcome:'started'});
    try {
      requestSignal.throwIfAborted();
      await verifyPageAccount();
      transactionSignal.throwIfAborted();
      const number = requestNumber || knownRequestNumber(url);
      const logKey = number || `${kind}:${url}`;
      if (!loggedRecords.has(logKey)) {
        logFetch(url, kind, number, {purpose,reason});
        loggedRecords.add(logKey);
      }
      // Background reads must never follow a protected page into a login/logout handler.
      const response = await capturePortalFetch(url, { ...options, credentials: 'include', redirect: 'manual', signal: requestSignal }, kind, binary ? 60000 : 25000);
      status = response.status;
      if (response.type === 'opaqueredirect' || status >= 300 && status < 400) {
        const error = new Error('The portal redirected this background lookup. Live checks are paused briefly; your current page is unchanged.');
        error.code = 'PORTAL_AUTH_REDIRECT';
        throw error;
      }
      if (!portalUrl(response.url) || /\/login(?:\/|$)/i.test(new URL(response.url).pathname)) throw new Error('Your session has expired. Sign in to Islandsun and try again.');
      if (!response.ok) throw new Error('The record could not be loaded. Please try again.');
      if (!maxBytes && !binary) { const text = await response.text(); await verifyPageAccount(); return text; }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let bytes = 0, text = '';
      const chunks = [];
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > (maxBytes || 32*1024*1024)) throw new Error('This response is too large to check in the background.');
          if (binary) chunks.push(value); else text += decoder.decode(value, { stream: true });
        }
        await verifyPageAccount();
        if (binary) {
          const buffer = new Uint8Array(bytes);
          let offset = 0;
          for (const chunk of chunks) { buffer.set(chunk,offset); offset += chunk.length; }
          const prefix = new TextDecoder().decode(buffer.slice(0,512)).trimStart();
          if (!bytes || /html/i.test(response.headers.get('content-type')) || /^<(?:!doctype|html|head|body)/i.test(prefix)) throw new Error('The server returned a page instead of a document.');
          let value = '';
          for (let index=0;index<buffer.length;index+=8192) value += String.fromCharCode(...buffer.subarray(index,index+8192));
          return {base64:btoa(value),mime:response.headers.get('content-type') || '',lastModified:response.headers.get('last-modified') || null};
        }
        return text + decoder.decode();
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    } catch (error) {
      outcome = error.code === 'PORTAL_AUTH_REDIRECT' ? 'redirect-blocked' : transactionSignal.aborted ? 'cancelled' : timeout.aborted ? 'timeout'
        : status >= 400 ? 'http-error' : error instanceof TypeError ? 'network-error' : 'failed';
      if (['timeout','network-error','redirect-blocked'].includes(outcome) || status === 429 || status >= 500) failed = true;
      if (timeout.aborted && !transactionSignal.aborted) throw new Error('The portal is taking too long to respond. Please try again.');
      if (error instanceof TypeError) throw new Error('The portal could not be reached. Check your connection and try again.');
      throw error;
    } finally {
      recordConnectionDiagnostic({kind, outcome, status, durationMs:performance.now() - started});
      logFetchResult(url, kind, {number:requestNumber, outcome, status, durationMs:performance.now() - started, purpose, reason});
    }
  }
  try { return await task(read); }
  finally { permit.release(transactionSignal.aborted && !failed ? undefined : failed); }
}

export function readPortalText(url, options) { return withPortalRead(read => read(url, options), {...options,url}); }
