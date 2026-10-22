import { portalPath } from './save-contract.js';
import { readSaveIndex } from './save-index.js';
import { validSavedRequestIntent, savedRequestDestination } from './saved-request-identity.js';
import { holdForegroundAction } from './foreground-action.js';
import { diagnosticLog } from './diagnostic-log.js';

const KEY = 'islandsun.portal.saved-request-destination';

/** Follow an ordinary successful Save to its detail page, without submitting or repeating writes. */
export function createSavedRequestNavigation(account, notify) {
  const events = new AbortController();
  let disposed = false, release;
  const trace = (event, fields = {}) => diagnosticLog(event, fields);
  function clear() {
    try { sessionStorage.removeItem(KEY); }
    catch { /* An unavailable store cannot start automatic navigation. */ }
  }
  function capture(entry, form) {
    const pending = {
      version: 1, created: Date.now(), account, kind: entry.kind, id: entry.id,
      number: entry.number, beforeIds: entry.beforeIds,
      sampleType: entry.kind === 'sample'
        ? Number(form.querySelector('[name="srtype"]')?.value || new URL(location.href).searchParams.get('srtype')) : undefined,
    };
    clear();
    if (!validSavedRequestIntent(pending, account)) {
      trace('saved-request-navigation-unavailable', {kind:entry.kind, reason:'identity-not-ready'});
      return;
    }
    try {
      sessionStorage.setItem(KEY, JSON.stringify(pending));
      trace('saved-request-navigation-prepared', {kind:entry.kind, number:entry.number});
    } catch (error) { trace('saved-request-navigation-unavailable', {kind:entry.kind, reason:error.name}); }
  }
  async function resume() {
    let pending;
    try {
      // A prior installation must never resume the retired automatic Submit workflow.
      sessionStorage.removeItem('islandsun.portal.sample-save-continuation');
      pending = JSON.parse(sessionStorage.getItem(KEY));
    } catch { clear(); return; }
    if (!pending) return;
    const route = portalPath(location.pathname);
    const nativeReturn = pending.kind === 'sample'
      ? ['/islandsun/samplerequest/processaddsamplerequestnew', '/islandsun/samplerequest/processupdatesamplerequestnew']
      : ['/islandsun/master/tir/store', '/islandsun/master/tir/update'];
    // Some native Save responses are bare documents that redirect to the authenticated list.
    if (!account && nativeReturn.includes(route) && validSavedRequestIntent(pending, pending.account)) return;
    clear();
    if (!validSavedRequestIntent(pending, account)) return;
    const listRoute = pending.kind === 'sample' ? '/islandsun/samplerequest' : '/islandsun/master/tir';
    // Native detail redirects already satisfy the destination. Error/editor pages stay untouched.
    const failed = [...document.querySelectorAll('.content-wrapper .alert-danger,.content-wrapper .show_error')]
      .some(node => node.textContent.trim() && node.checkVisibility());
    if (route !== listRoute || failed) return;
    const originalUrl = location.href;
    const stop = event => {
      if (event.isTrusted) { events.abort(); release?.(); release = null; }
    };
    document.addEventListener('pointerdown', stop, {capture:true, signal:events.signal});
    document.addEventListener('keydown', stop, {capture:true, signal:events.signal});
    release = holdForegroundAction('open-saved-request');
    try {
      const records = await readSaveIndex(pending.kind, account, events.signal, 'open-saved-request');
      if (disposed || events.signal.aborted || location.href !== originalUrl) return;
      const url = savedRequestDestination(pending, records);
      if (!url) {
        trace('saved-request-navigation-unresolved', {kind:pending.kind, reason:'no-unique-match'});
        notify('Open your saved request from the list to review and submit it.', {key:'saved-request-location', tone:'warning'});
        return;
      }
      trace('saved-request-navigation-complete', {kind:pending.kind, url});
      location.replace(url);
    } catch (error) {
      if (disposed || events.signal.aborted) return;
      trace('saved-request-navigation-failed', {kind:pending.kind, errorType:error.name});
      notify('The saved request could not be opened automatically. Check the request list.', {key:'saved-request-location', tone:'warning'});
    } finally {
      release?.(); release = null;
      document.removeEventListener('pointerdown', stop, true);
      document.removeEventListener('keydown', stop, true);
    }
  }
  void resume();
  return {capture, destroy() { disposed = true; events.abort(); release?.(); release = null; }};
}
