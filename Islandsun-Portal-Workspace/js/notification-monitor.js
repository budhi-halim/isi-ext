import { readMonitorIndex, readMonitoredRecord } from './monitor-data.js';
import { acquireLocalLock } from './local-lock.js';
import { monitorDetailsEligible } from './submission-logic.js';

/** A single visible portal tab owns polling. Work is read-only, serial, and backs off on failure. */
export function createNotificationMonitor(store, repository, notices, accountName, {
  readIndex = readMonitorIndex, readRecord = readMonitoredRecord, acquireLock = acquireLocalLock,
} = {}) {
  const seen = new Map(), records = new Map();
  let disposed = false, busy = false, timer, controller, releaseLeadership;
  let indexedAt = 0, retry = 15000;
  const relinquish = () => { releaseLeadership?.(); releaseLeadership = null; };
  const pause = () => { clearTimeout(timer); controller?.abort(); relinquish(); };
  const schedule = delay => { clearTimeout(timer); if (!disposed && !document.hidden) timer = setTimeout(tick, delay); };
  async function tick() {
    if (disposed || document.hidden) return;
    if (busy) { schedule(1000); return; }
    busy = true;
    controller = new AbortController();
    const interruption = controller.signal;
    const signal = AbortSignal.any([interruption, AbortSignal.timeout(30000)]);
    try {
      if (!releaseLeadership) {
        const release = await acquireLock(`${store.key}:monitor`, { wait: false, onLost: () => { releaseLeadership = null; controller?.abort(); schedule(5000); } });
        if (disposed || document.hidden || signal.aborted) { release?.(); return; }
        releaseLeadership = release;
      }
      if (!releaseLeadership) { schedule(5000); return; }
      if (!indexedAt || Date.now() - indexedAt > 30000) {
        const observedAt = Date.now();
        const index = [...await readIndex('tir', signal, accountName), ...await readIndex('sample', signal, accountName)];
        if (disposed || signal.aborted) return;
        await store.observeStatuses(index, { observedAt });
        records.clear(); for (const record of index) if (monitorDetailsEligible(record)) records.set(`${record.kind}:${record.id}`, record);
        for (const key of seen.keys()) if (!records.has(key)) seen.delete(key);
        indexedAt = Date.now();
        notices.dismiss('notification-session');
      }
      const started = performance.now();
      const state = store.read(), tracked = [], discovery = [];
      for (const [key, record] of records) {
        const previous = seen.get(key), pending = state.jobs[key];
        if (previous?.retryAt > Date.now()) continue;
        const lifetime = pending ? 15000 : 300000;
        if (previous && previous.status === record.status && Date.now() - previous.time < lifetime) continue;
        // Completed TIRs are baselines unless an incomplete document was previously observed.
        if (!pending && /^(complete|completed)$/i.test(record.status) && record.kind === 'tir') continue;
        (pending ? tracked : discovery).push({ key, record, checked: previous?.time || 0 });
      }
      tracked.sort((a,b) => a.checked - b.checked);
      discovery.sort((a,b) => a.checked - b.checked);
      const batch = [...tracked.slice(0,3), ...discovery.slice(0,Math.max(1,4-Math.min(3,tracked.length)))];
      for (const {key,record} of batch) {
        if (signal.aborted) return;
        let result;
        try { result = await readRecord(record, repository, signal); }
        catch (error) {
          if (signal.aborted || error.message === 'session' || /session has expired/i.test(error.message)) throw error;
          seen.set(key, { status: record.status, time: 0, retryAt: Date.now() + 60000 });
          continue;
        }
        if (disposed || signal.aborted) return;
        await store.observe(result);
        seen.set(key, { status: record.status, time: Date.now() });
      }
      retry = 15000;
      schedule(batch.length ? Math.max(1000, Math.min(15000, performance.now() - started)) : 5000);
    } catch (error) {
      if (!interruption.aborted && !disposed) {
        if (error.message === 'session' || /session has expired/i.test(error.message)) {
          notices.notify('Sign in again to resume notifications.', { key: 'notification-session', error: true });
          schedule(60000);
        } else { schedule(retry); retry = Math.min(retry * 2, 120000); }
      }
    } finally { busy = false; controller = null; if (interruption.aborted && !disposed && !document.hidden) schedule(1000); }
  }
  const visibility = () => { if (document.hidden) pause(); else schedule(250); };
  document.addEventListener('visibilitychange', visibility); schedule(1000);
  return { destroy() { disposed = true; pause(); document.removeEventListener('visibilitychange', visibility); seen.clear(); } };
}
