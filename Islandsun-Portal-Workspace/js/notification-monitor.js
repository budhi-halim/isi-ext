import { readMonitorIndex, readMonitoredRecord } from './monitor-data.js';
import { acquireLocalLock } from './local-lock.js';
import { monitorDetailsEligible } from './submission-logic.js';
import { createActivityLog } from './activity-log.js';
import { INDEX_FRESH_MS, PREVIEW_FRESH_MS, statusSignature } from './fetch-policy.js';
import { shouldMonitorTir, documentBaseline } from './tir-document-policy.js';
import { checkTirDocuments } from './tir-document-check.js';
import { diagnosticLog } from './diagnostic-log.js';
import { OFFLINE_STATUS } from './offline-config.js';
import { calendarDay } from './notification-logic.js';

/** Persist the current schedule so page changes and browser restarts do not restart discovery. */
export function createNotificationMonitor(store, repository, notices, accountName, {
  readIndex = readMonitorIndex, readRecord = readMonitoredRecord, acquireLock = acquireLocalLock,
  checkDocuments = checkTirDocuments,
  readArchiveStatus = async () => (await chrome.storage.local.get(OFFLINE_STATUS))[OFFLINE_STATUS],
  activity = createActivityLog('Notification checks'),
} = {}) {
  let disposed = false, busy = false, timer, controller, releaseLeadership;
  let retry = 15000;
  let memory = store.read().monitor || {records:[],checked:{},indexedAt:0,warmup:{},tir:{}};
  const schedule = delay => { clearTimeout(timer); if (!disposed) timer = setTimeout(tick,delay); };
  async function checkpoint() {
    if (!disposed) await store.saveMonitor?.(memory);
  }
  function warmupQueue() {
    const kinds = ['sample','tir'];
    const lists = Object.fromEntries(kinds.map(kind => [kind,memory.records.filter(record => record.kind === kind)
      .sort((a,b) => (calendarDay(b.date) || 0)-(calendarDay(a.date) || 0) || Number(b.id)-Number(a.id))]));
    const pageSize = Math.max(5,Math.min(100,Number(document.querySelector?.('[name="mytable_length"]')?.value) || memory.pageSize || 10));
    memory.pageSize = pageSize; repository.setPageSize?.(pageSize);
    const queue = [];
    for (let page=0;page<3;page++) for (const kind of kinds) {
      for (const record of lists[kind].slice(page*pageSize,(page+1)*pageSize)) queue.push(`${record.kind}:${record.id}`);
    }
    return queue;
  }
  async function observe(record, signal, purpose, documents = false) {
    const key = `${record.kind}:${record.id}`, previous = memory.checked[key];
    const signature = statusSignature(record);
    const changed = previous && previous.signature !== signature;
    async function retain(result, verifiedDocuments) {
      signal.throwIfAborted();
      await store.observe(result);
      memory.checked[key] = {...memory.checked[key],signature,at:Date.now(),snapshot:result,retryAt:0,
        ...(record.kind === 'tir' ? {documents:verifiedDocuments ? Object.fromEntries(result.documents.map(item=>[item.id,item])) : documentBaseline(result,previous?.documents)} : {})};
      await checkpoint();
    }
    try {
      let result = await readRecord(record,repository,signal,{purpose,fresh:!!changed});
      if (documents && record.kind === 'tir') result = await checkDocuments(result,previous,signal,partial => retain(partial,true));
      await retain(result,documents);
      diagnosticLog('monitor-observed',{kind:record.kind,number:record.number,purpose,statusChanged:!!changed,documents});
      return true;
    } catch (error) {
      if (signal.aborted || error.message === 'session' || /session has expired/i.test(error.message)) throw error;
      memory.checked[key] = {...memory.checked[key],retryAt:Date.now()+60000};
      diagnosticLog('monitor-retry',{kind:record.kind,number:record.number,retryAt:memory.checked[key].retryAt,errorType:error.name,code:error.code});
      activity.note('record-retry','A record check failed; retry in 60s. Other eligible records can continue.');
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
        if (release) memory = store.read().monitor || memory;
      }
      if (!releaseLeadership) { activity.pause('other-tab'); schedule(5000); return; }
      if (!memory.indexedAt || Date.now()-memory.indexedAt >= INDEX_FRESH_MS) {
        const observedAt = Date.now();
        const index = [...await readIndex('sample',signal,accountName),...await readIndex('tir',signal,accountName)];
        signal.throwIfAborted();
        await store.observeStatuses(index,{observedAt});
        memory.records = index; memory.indexedAt = Date.now();
        const present = new Set(index.map(record=>`${record.kind}:${record.id}`));
        for (const key of Object.keys(memory.checked)) if (!present.has(key)) delete memory.checked[key];
        // Weekly reminders advance from the verified snapshot without another detail request.
        for (const record of index) {
          const previous = memory.checked[`${record.kind}:${record.id}`];
          if (previous?.snapshot && previous.signature === statusSignature(record)) await store.observe({...previous.snapshot,...record});
        }
        await checkpoint(); notices.dismiss('notification-session');
        diagnosticLog('monitor-index',{records:index.length,intervalMs:INDEX_FRESH_MS});
      }
      memory.warmup ||= {}; memory.tir ||= {};
      if (!memory.warmup.queue && (!memory.warmup.completedAt || Date.now() >= memory.warmup.completedAt+PREVIEW_FRESH_MS)) {
        memory.warmup = {queue:warmupQueue(),cursor:0,startedAt:Date.now()}; await checkpoint();
      }
      const byKey = new Map(memory.records.map(record=>[`${record.kind}:${record.id}`,record]));
      if (memory.warmup.queue) {
        const key = memory.warmup.queue[memory.warmup.cursor++], record = byKey.get(key);
        if (record && !(memory.checked[key]?.retryAt > Date.now())) { activity.resume(); await observe(record,signal,'warmup'); }
        if (memory.warmup.cursor >= memory.warmup.queue.length) {
          memory.warmup = {completedAt:Date.now()}; diagnosticLog('warmup-complete',{records:Math.min(memory.records.length,memory.pageSize*6)});
        }
        await checkpoint(); schedule(250); return;
      }
      const changed = memory.records.find(record => monitorDetailsEligible(record)
        && !(memory.checked[`${record.kind}:${record.id}`]?.retryAt > Date.now())
        && memory.checked[`${record.kind}:${record.id}`]?.signature !== statusSignature(record));
      if (changed) { activity.resume(); await observe(changed,signal,'notification',changed.kind === 'tir'); schedule(250); return; }
      if (!memory.tir.queue && Date.now() >= (memory.tir.nextAt || 0)) {
        memory.tir = {queue:memory.records.filter(record => record.kind === 'tir' && monitorDetailsEligible(record)
          && shouldMonitorTir(record,memory.checked[`tir:${record.id}`])).map(record=>`tir:${record.id}`),cursor:0,startedAt:Date.now()};
        await checkpoint();
      }
      if (memory.tir.queue) {
        const key = memory.tir.queue[memory.tir.cursor++], record = byKey.get(key);
        if (record && !(memory.checked[key]?.retryAt > Date.now())) { activity.resume(); await observe(record,signal,'notification',true); }
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
      if (retryRecord) { await observe(retryRecord,signal,'notification',retryRecord.kind === 'tir'); schedule(250); return; }
      retry = 15000; activity.pause('idle'); schedule(5000);
    } catch (error) {
      if (!signal.aborted && !disposed) {
        if (error.message === 'session' || /session has expired/i.test(error.message)) {
          notices.notify('Sign in again to resume notifications.',{key:'notification-session',error:true}); activity.pause('signed-out',Date.now()+60000); schedule(60000);
        } else { activity.pause('retry',Date.now()+retry); diagnosticLog('monitor-paused',{errorType:error.name,code:error.code,retryAt:Date.now()+retry}); schedule(retry); retry = Math.min(retry*2,120000); }
      }
    } finally { busy = false; controller = null; if (signal.aborted && !disposed) schedule(1000); }
  }
  const reset = (changes,area) => {
    const value = changes['islandsun.archive-reset']?.newValue;
    if (area !== 'local' || !value || value.account && value.account !== store.account) return;
    controller?.abort(); memory = {records:[],checked:{},indexedAt:0,warmup:{},tir:{}};
    repository.clear?.(); checkpoint().catch(()=>{}); schedule(1000);
  };
  globalThis.chrome?.storage?.onChanged?.addListener(reset);
  schedule(1000);
  return {destroy() {
    disposed = true; clearTimeout(timer); controller?.abort(); releaseLeadership?.(); releaseLeadership = null; activity.destroy();
    globalThis.chrome?.storage?.onChanged?.removeListener(reset);
  }};
}
