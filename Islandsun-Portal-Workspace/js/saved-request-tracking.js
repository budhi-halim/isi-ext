import { saveContract } from './save-submit-logic.js';
import { sampleRequestNumber } from './sample-save-snapshot.js';
import { readSaveIndex } from './save-index.js';
import { diagnosticLog } from './diagnostic-log.js';

/** Capture actual native form submissions after validation/confirmation, including unchanged saves. */
export function createSavedRequestTracking(store, reportError) {
  const events = new AbortController(), recorded = new WeakMap();
  let disposed = false;
  let beforeIds;
  const initialForm = document.querySelector('.content-wrapper form');
  const initial = initialForm && saveContract(initialForm.action, location.href);
  if (initial?.kind === 'tir' && !initial.id) {
    const monitor = store.read().monitor;
    if (monitor?.indexedAt && Array.isArray(monitor.records)) beforeIds = monitor.records.filter(record => record.kind === 'tir').map(record => record.id);
    else readSaveIndex('tir', store.account, events.signal, 'save-reminder-baseline').then(records => {
      if (!disposed) beforeIds = [...records.keys()];
    }).catch(error => {
      if (!events.signal.aborted) diagnosticLog('save-reminder-baseline-failed', {kind:'tir',errorType:error.name});
    });
  }
  function capture(form) {
    if (disposed || !(form instanceof HTMLFormElement)) return;
    const contract = saveContract(form.action, location.href);
    if (!contract || Date.now() - (recorded.get(form) || 0) < 1000) return;
    recorded.set(form, Date.now());
    try {
      store.registerSave({...contract, number:contract.kind === 'sample' ? sampleRequestNumber() : null, ...(beforeIds ? {beforeIds} : {})});
    } catch { reportError(); }
  }
  window.addEventListener('submit', event => {
    queueMicrotask(() => { if (!event.defaultPrevented) capture(event.target); });
  }, {signal:events.signal});
  document.addEventListener('islandsun-native-submit', event => capture(event.target), {signal:events.signal});
  return {destroy() { disposed = true; events.abort(); }};
}
