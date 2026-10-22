import { readMonitorIndex, readMonitoredRecord } from './monitor-data.js';
import { acquireLocalLock } from './local-lock.js';
import { monitorDetailsEligible } from './submission-logic.js';
import { activityTime, createActivityLog } from './activity-log.js';
import { INDEX_FRESH_MS, PREVIEW_FRESH_MS, statusSignature } from './fetch-policy.js';
import { shouldMonitorTir, documentBaseline } from './tir-document-policy.js';
import { checkTirDocuments } from './tir-document-check.js';
import { diagnosticLog } from './diagnostic-log.js';
import { OFFLINE_STATUS, PORTAL_HOME } from './offline-config.js';
import { nextNotificationRead, previewQueue } from './monitor-schedule.js';

/** Persist the current schedule so page changes and browser restarts do not restart discovery. */
export function createNotificationMonitor(store, repository, notices, accountName, {
  readIndex = readMonitorIndex, readRecord = readMonitoredRecord, acquireLock = acquireLocalLock,
  checkDocuments = checkTirDocuments,
  readArchiveStatus = async () => (await chrome.storage.local.get(OFFLINE_STATUS))[OFFLINE_STATUS],
  activity = createActivityLog('Notification checks'),
} = {}) {
  let disposed = false, busy = false, timer, controller, releaseLeadership;
  let retry = 15000;
  let previewCacheChecked = false;
  let pendingObservation;
  let memory = {records:[],checked:{},indexedAt:0,warmup:{},tir:{}}, restoreRequired = true;
  const schedule = delay => { clearTimeout(timer); if (!disposed) timer = setTimeout(tick,delay); };
  async function checkpoint() {
    if (!disposed) await store.saveMonitor?.(memory);
  }
  async function retainPending(signal) {
    if (!pendingObservation) return;
    const pending = pendingObservation;
    signal.throwIfAborted();
    await store.observe(pending.result);
    signal.throwIfAborted();
    if (pendingObservation !== pending) return;
    memory.checked[pending.key] = pending.checked;
    await checkpoint();
    if (pendingObservation === pending) pendingObservation = null;
  }
  function warmupQueue() {
    const pageSize = Math.max(5,Math.min(100,Number(document.querySelector?.('[name="mytable_length"]')?.value) || memory.pageSize || 10));
    memory.pageSize = pageSize; repository.setPageSize?.(pageSize);
    return previewQueue(memory.records, pageSize);
  }
  async function restoreWarmup(signal) {
    if (previewCacheChecked) return;
    const byKey = new Map(memory.records.map(record => [`${record.kind}:${record.id}`,record]));
    const completed = memory.warmup.queue
      ? memory.warmup.queue.slice(0,memory.warmup.cursor)
      : memory.warmup.completedAt ? warmupQueue() : [];
    for (const key of completed) {
      const record = byKey.get(key);
      if (!record || memory.checked[key]?.retryKind !== 'documents' && memory.checked[key]?.retryAt > Date.now()) continue;
      if (repository.hasFresh && !await repository.hasFresh(record.url)) {
        signal.throwIfAborted();
        memory.warmup = {queue:warmupQueue(),cursor:0,startedAt:Date.now()};
        diagnosticLog('warmup-cache-restored',{reason:'Saved schedule has no matching fresh previews.'});
        activity.note('preview-cache-missing','Preparing hover previews before notification checks; the saved schedule outlived its preview cache.',0);
        await checkpoint(); break;
      }
    }
    signal.throwIfAborted();
    previewCacheChecked = true;
  }
  async function observe(record, signal, purpose, documents = false, reason) {
    const key = `${record.kind}:${record.id}`, previous = memory.checked[key];
    const signature = statusSignature(record);
    const changed = previous && previous.signature !== signature;
    let stage = 'detail';
    async function retain(result, verifiedDocuments, complete = false) {
      signal.throwIfAborted();
      const keepDocumentRetry = memory.checked[key]?.retryKind === 'documents' && !(verifiedDocuments && complete);
      pendingObservation = {key,result,checked:{...memory.checked[key],signature,at:Date.now(),snapshot:result,
        ...(!keepDocumentRetry ? {retryAt:0,failures:0,retryKind:null} : {}),
        ...(record.kind === 'tir' ? {documents:verifiedDocuments && !result.documentsUnavailable ? Object.fromEntries(result.documents.map(item=>[item.id,item])) : documentBaseline(result,previous?.documents)} : {})}};
      await retainPending(signal);
    }
    try {
      let result = await readRecord(record,repository,signal,{purpose,reason,fresh:!!changed});
      if (documents && record.kind === 'tir') {
        stage = 'documents';
        result = await checkDocuments(result,previous,signal,partial => retain(partial,true));
      }
      await retain(result,documents,true);
      diagnosticLog('monitor-observed',{kind:record.kind,number:record.number,purpose,statusChanged:!!changed,documents});
      return true;
    } catch (error) {
      if (signal.aborted || error.code === 'NOTIFICATION_STORAGE' || error.message === 'session' || /session has expired/i.test(error.message)) throw error;
      const failures = (memory.checked[key]?.failures || 0) + 1;
      const delay = Math.min(2*3600000,60000*2**Math.min(failures-1,7));
      memory.checked[key] = {...memory.checked[key],failures,retryKind:stage,retrySignature:signature,retryAt:Date.now()+delay};
      diagnosticLog('monitor-retry',{kind:record.kind,number:record.number,purpose,reason,retryAt:memory.checked[key].retryAt,failures,errorType:error.name,code:error.code,message:String(error.message).slice(0,500)});
      activity.note(`record-retry:${key}`,`${record.number || record.kind}: ${purpose === 'warmup' ? 'hover warm-up' : 'notification check'} failed; retry at ${activityTime(memory.checked[key].retryAt)}. Other eligible records can continue.`);
      await checkpoint(); return false;
    }
  }
  async function tick() {
    if (disposed) return;
    if (busy) { schedule(1000); return; }
    busy = true; controller = new AbortController();
    const signal = controller.signal;
    try {
      if (!releaseLeadership) {
        const release = await acquireLock(`${store.key}:monitor`,{wait:false,onLost:() => { releaseLeadership = null; controller?.abort(); schedule(5000); }});
        if (disposed || signal.aborted) { release?.(); return; }
        releaseLeadership = release;
        if (release) { restoreRequired = true; previewCacheChecked = false; }
      }
      if (!releaseLeadership) { activity.pause('other-tab'); schedule(5000); return; }
      if (restoreRequired) { memory = store.read().monitor || memory; restoreRequired = false; }
      await retainPending(signal);
      await store.advanceReminders?.();
      if (!memory.indexedAt || Date.now()-memory.indexedAt >= INDEX_FRESH_MS) {
        const observedAt = Date.now();
        const index = [...await readIndex('sample',signal,accountName),...await readIndex('tir',signal,accountName)];
        signal.throwIfAborted();
        await store.observeStatuses(index,{observedAt});
        memory.records = index; memory.indexedAt = Date.now();
        for (const record of index) {
          const previous = memory.checked[`${record.kind}:${record.id}`];
          if (previous?.retrySignature && previous.retrySignature !== statusSignature(record)) { previous.retryAt = 0; previous.failures = 0; }
        }
        const present = new Set(index.map(record=>`${record.kind}:${record.id}`));
        for (const key of Object.keys(memory.checked)) if (!present.has(key)) delete memory.checked[key];
        // Weekly reminders advance from the verified snapshot without another detail request.
        for (const record of index) {
          const previous = memory.checked[`${record.kind}:${record.id}`];
          if (previous?.snapshot && previous.signature === statusSignature(record)) await store.observe({...previous.snapshot,...record});
        }
        await checkpoint(); notices.dismiss('portal-sign-in');
        diagnosticLog('monitor-index',{records:index.length,intervalMs:INDEX_FRESH_MS});
        activity.note(`index:${memory.indexedAt}`,`Lists checked: ${index.filter(record => record.kind === 'sample').length} Sample, ${index.filter(record => record.kind === 'tir').length} TIR. Unchanged verified details are reused.`);
      }
      memory.warmup ||= {}; memory.tir ||= {};
      await restoreWarmup(signal);
      if (!memory.warmup.queue && (!memory.warmup.completedAt || Date.now() >= memory.warmup.completedAt+PREVIEW_FRESH_MS)) {
        memory.warmup = {queue:warmupQueue(),cursor:0,startedAt:Date.now()}; await checkpoint();
      }
      const byKey = new Map(memory.records.map(record=>[`${record.kind}:${record.id}`,record]));
      if (memory.warmup.queue) {
        const position = memory.warmup.cursor, key = memory.warmup.queue[position], record = byKey.get(key);
        if (record) {
          const prior = memory.warmup.queue.slice(0,position).filter(key => key.startsWith(`${record.kind}:`)).length;
          const page = Math.floor(prior / memory.pageSize) + 1;
          activity.note(`preview:${memory.warmup.startedAt}:${record.kind}:${page}`,`Hover warm-up: ${record.kind === 'sample' ? 'Sample' : 'TIR'} page ${page}/3, up to ${memory.pageSize} records; fresh cached results need no request.`,Infinity);
        }
        if (record && !(memory.checked[key]?.retryKind !== 'documents' && memory.checked[key]?.retryAt > Date.now())) { activity.resume(); await observe(record,signal,'warmup'); }
        memory.warmup.cursor++;
        if (memory.warmup.cursor >= memory.warmup.queue.length) {
          memory.warmup = {completedAt:Date.now()}; diagnosticLog('warmup-complete',{records:Math.min(memory.records.length,memory.pageSize*6)});
        }
        await checkpoint(); schedule(250); return;
      }
      activity.note(`preview-wait:${memory.warmup.completedAt}`,`Hover warm-up is complete; next refresh ${activityTime(memory.warmup.completedAt+PREVIEW_FRESH_MS)}. Notification checks and offline saving can use the interval.`,Infinity);
      const next = nextNotificationRead(memory);
      if (next) {
        if (next.rotation.count === 1) {
          const reason = {baseline:'first successful check needed','status-change':'status changed',retry:'retrying a failed check'}[next.reason];
          activity.note(`discovery:${next.record.kind}:${next.reason}`,`Notification backlog: ${next.record.kind === 'sample' ? 'Sample' : 'TIR'} batch, up to ${memory.pageSize} records (${next.remaining} pending). Purpose: ${reason}.`,0);
        }
        activity.resume(); await observe(next.record,signal,'notification',next.record.kind === 'tir',next.reason);
        memory.discovery = next.rotation; await checkpoint(); schedule(250); return;
      }
      if (!memory.tir.queue && Date.now() >= (memory.tir.nextAt || 0)) {
        memory.tir = {queue:memory.records.filter(record => record.kind === 'tir' && monitorDetailsEligible(record)
          && shouldMonitorTir(record,memory.checked[`tir:${record.id}`])).map(record=>`tir:${record.id}`),cursor:0,startedAt:Date.now()};
        await checkpoint();
      }
      if (memory.tir.queue) {
        activity.note(`documents:${memory.tir.startedAt}`,`TIR document recheck: ${memory.tir.queue.length} eligible records; uploaded files are compared within their monitoring window.`,Infinity);
        const key = memory.tir.queue[memory.tir.cursor], record = byKey.get(key);
        if (record && !(memory.checked[key]?.retryAt > Date.now())) { activity.resume(); await observe(record,signal,'notification',true,'documents'); }
        memory.tir.cursor++;
        if (memory.tir.cursor >= memory.tir.queue.length) {
          const archive = await readArchiveStatus();
          const interval = archive?.caughtUp || archive?.state === 'paused' ? 5*60000 : 2*3600000;
          memory.tir = {completedAt:Date.now(),nextAt:Date.now()+interval};
          diagnosticLog('document-pass-complete',{nextAt:memory.tir.nextAt,intervalMs:interval,archiveCaughtUp:archive?.caughtUp === true});
        }
        await checkpoint(); schedule(250); return;
      }
      const retryRecord = memory.records.find(record => {
        const previous = memory.checked[`${record.kind}:${record.id}`];
        return previous?.retryAt && previous.retryAt <= Date.now() && monitorDetailsEligible(record);
      });
      if (retryRecord) { await observe(retryRecord,signal,'notification',retryRecord.kind === 'tir','retry'); schedule(250); return; }
      retry = 15000; activity.pause('idle'); schedule(5000);
    } catch (error) {
      if (!signal.aborted && !disposed) {
        if (error.message === 'session' || /session has expired/i.test(error.message)) {
          notices.notify('Your portal session expired. Sign in again.',{key:'portal-sign-in',tone:'warning',href:`${PORTAL_HOME}login`}); activity.pause('signed-out',Date.now()+60000); schedule(60000);
        } else { activity.pause(error.code === 'NOTIFICATION_STORAGE' ? 'notification-storage' : 'retry',Date.now()+retry); diagnosticLog('monitor-paused',{errorType:error.name,code:error.code,message:String(error.message).slice(0,500),localRetry:!!pendingObservation,retryAt:Date.now()+retry}); schedule(retry); retry = Math.min(retry*2,120000); }
      }
    } finally { busy = false; controller = null; if (signal.aborted && !disposed) schedule(1000); }
  }
  const reset = (changes,area) => {
    const value = changes['islandsun.archive-reset']?.newValue;
    if (area !== 'local' || !value || value.account && value.account !== store.account) return;
    controller?.abort(); pendingObservation = null; previewCacheChecked = false; memory = {records:[],checked:{},indexedAt:0,warmup:{},tir:{}};
    repository.clear?.(); checkpoint().catch(()=>{}); schedule(1000);
  };
  globalThis.chrome?.storage?.onChanged?.addListener(reset);
  schedule(1000);
  return {destroy() {
    disposed = true; clearTimeout(timer); controller?.abort(); releaseLeadership?.(); releaseLeadership = null; activity.destroy();
    globalThis.chrome?.storage?.onChanged?.removeListener(reset);
  }};
}
