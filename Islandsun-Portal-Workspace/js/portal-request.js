import { portalUrl } from './shared/document-names.js';
import { isTirSourceUrl } from './tir-source-logic.js';
import { recordConnectionDiagnostic } from './connection-diagnostics.js';
import { logFetch, requestNumber as knownRequestNumber } from './request-log.js';
import { ACCOUNT_SCOPE } from './account-scope.js';
import { capturePortalFetch } from './debug-capture-client.js';

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

function suspend() { lifecycle.abort(new DOMException('Portal reads paused', 'AbortError')); }
function resume() {
  if (!document.hidden && !navigating && lifecycle.signal.aborted) lifecycle = new AbortController();
}
function listen() {
  if (listening) return;
  listening = true;
  window.addEventListener('beforeunload', () => { navigating = true; suspend(); });
  window.addEventListener('pagehide', suspend);
  window.addEventListener('pageshow', () => { navigating = false; resume(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); else resume(); });
  // A cancelled navigation leaves the same document active; real interaction resumes its reads.
  for (const type of ['pointerdown', 'keydown']) document.addEventListener(type, event => {
    if (event.isTrusted && navigating) { navigating = false; resume(); }
  }, { passive: true });
}

function acquireRead(signal, priority, editorLookup) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const port = chrome.runtime.connect({ name: 'islandsun-read-gate' });
    let granted = false, released = false, yielding = false;
    const disconnected = new AbortController();
    const timeout = setTimeout(() => stop(new Error('The portal is busy. Please try again shortly.')), 60000);
    function stop(error) {
      released = true; clearTimeout(timeout); signal?.removeEventListener('abort', abort); port.disconnect();
      if (!granted) reject(error);
    }
    // Cancelling a consumer removes a waiter, but an active HTTP response retains
    // its permit until the transaction finishes; client abort cannot stop PHP work.
    const abort = () => { if (!granted) stop(signal.reason); };
    signal?.addEventListener('abort', abort, { once: true });
    port.onDisconnect.addListener(() => {
      clearTimeout(timeout); signal?.removeEventListener('abort', abort);
      if (!released) {
        const error = new Error('The portal connection was interrupted. Please try again.');
        disconnected.abort(error);
        if (!granted) reject(error);
      }
    });
    port.onMessage.addListener(message => {
      if (message.yield) { yielding = true; return; }
      if (message.cooldownUntil) {
        const error = new Error('The portal connection needs time to recover. Cached products remain available; live checks will retry automatically.');
        error.code = 'PORTAL_READ_COOLDOWN'; stop(error); return;
      }
      if (message.paused) {
        const error = new Error('Live product lookups are paused while a request form is open. Return to a list to resume.');
        error.code = 'PORTAL_EDITOR_OPEN'; disconnected.abort(error); stop(error); return;
      }
      if (!message.granted || released) return;
      granted = true; clearTimeout(timeout);
      resolve({ release: failed => {
        try { if (!released) port.postMessage({type:'finished', failed}); }
        catch { /* A disconnected permit already released its lane. */ }
        finally { stop(); }
      }, signal: disconnected.signal, assertAvailable: () => {
        if (yielding) throw new DOMException('Portal table activity has priority.','AbortError');
      } });
    });
    port.postMessage({ type: 'read', priority, editorLookup });
  });
}

/** Keep a record's dependent reads together so another record cannot replace portal session state. */
export async function withPortalRead(task, { signal, priority = false, editorLookup } = {}) {
  listen();
  if (document.hidden) suspend();
  signal = signal ? AbortSignal.any([signal, lifecycle.signal]) : lifecycle.signal;
  if (editorLookup && !isTirSourceUrl(editorLookup)) throw new Error('This request link is unavailable.');
  const permit = await acquireRead(signal, priority, editorLookup);
  const transactionSignal = AbortSignal.any([signal, permit.signal]);
  let previousRead = false;
  const loggedRecords = new Set();
  let failed = false;
  async function read(url, { signal: _signal, priority: _priority, editorLookup: _lookup, maxBytes, requestNumber, ...options } = {}) {
    permit.assertAvailable();
    if (!portalUrl(String(url))) throw new Error('This portal link is unavailable.');
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
    const timeout = AbortSignal.timeout(10000);
    const requestSignal = AbortSignal.any([permit.signal, timeout]);
    const started = performance.now(), kind = requestKind(url);
    let status = 0, outcome = 'complete';
    recordConnectionDiagnostic({kind, outcome:'started'});
    try {
      requestSignal.throwIfAborted();
      await verifyPageAccount();
      transactionSignal.throwIfAborted();
      const number = requestNumber || knownRequestNumber(url);
      if (number && !loggedRecords.has(number)) {
        logFetch(url, kind, number);
        loggedRecords.add(number);
      }
      // Background reads must never follow a protected page into a login/logout handler.
      const response = await capturePortalFetch(url, { ...options, credentials: 'include', redirect: 'manual', signal: requestSignal }, kind);
      status = response.status;
      if (response.type === 'opaqueredirect' || status >= 300 && status < 400) {
        const error = new Error('The portal redirected this background lookup. Live checks are paused briefly; your current page is unchanged.');
        error.code = 'PORTAL_AUTH_REDIRECT';
        throw error;
      }
      if (!portalUrl(response.url) || /\/login(?:\/|$)/i.test(new URL(response.url).pathname)) throw new Error('Your session has expired. Sign in to Islandsun and try again.');
      if (!response.ok) throw new Error('The record could not be loaded. Please try again.');
      if (!maxBytes) { const text = await response.text(); await verifyPageAccount(); return text; }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let bytes = 0, text = '';
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > maxBytes) throw new Error('This product list is too large to preview. Open the request to view it.');
          text += decoder.decode(value, { stream: true });
        }
        await verifyPageAccount();
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
    }
  }
  try { return await task(read); }
  finally { permit.release(transactionSignal.aborted && !failed ? undefined : failed); }
}

export function readPortalText(url, options) { return withPortalRead(read => read(url, options), options); }
