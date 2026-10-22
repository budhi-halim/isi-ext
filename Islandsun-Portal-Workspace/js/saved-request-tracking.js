import { saveContract } from './save-contract.js';
import { sampleRequestNumber } from './sample-request-number.js';
import { readSaveIndex } from './save-index.js';
import { diagnosticLog } from './diagnostic-log.js';

/** Capture actual native form submissions after validation/confirmation, including unchanged saves. */
export function createSavedRequestTracking(store, reportError, onSave = () => {}) {
  const events = new AbortController(), recorded = new WeakMap(), failed = new WeakSet();
  let disposed = false;
  let beforeIds;
  const initialForm = document.querySelector('.content-wrapper form');
  const initial = initialForm && saveContract(initialForm.action, location.href);
  if (initial?.kind === 'tir' && !initial.id) {
    readSaveIndex('tir', store.account, events.signal, 'native-save-baseline').then(records => {
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
      const entry = {...contract, number:contract.kind === 'sample' ? sampleRequestNumber() : null, ...(beforeIds ? {beforeIds} : {})};
      onSave(entry, form);
      store.registerSave(entry);
    } catch (error) { reportError(error); }
  }
  window.addEventListener('submit', event => {
    queueMicrotask(() => { if (!event.defaultPrevented) capture(event.target); });
  }, {signal:events.signal});
  document.addEventListener('islandsun-native-submit', event => {
    failed.delete(event.target);
    queueMicrotask(() => { if (!event.defaultPrevented && !failed.has(event.target)) capture(event.target); });
  }, {signal:events.signal});
  document.addEventListener('islandsun-native-submit-failed', event => failed.add(event.target), {signal:events.signal});
  return {destroy() { disposed = true; events.abort(); }};
}
