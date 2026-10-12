import { PORTAL_ORIGIN } from './shared/document-names.js';
import { isTirSourceUrl } from './tir-source-logic.js';
import { watchPortalNavigation } from './navigation-readiness.js';
import { safeRequestUrl } from './debug-capture-data.js';
import { createArchivePacing } from './archive-pacing.js';
import { OFFLINE_STATUS } from './offline-config.js';

function recoveryDelay(elapsed) {
  return elapsed >= 4000 ? Math.min(10000, elapsed) : 250;
}

/** Share a single paced read lane across all portal tabs, leaving navigation connections free. */
export function startReadGate({onEvent = () => {}} = {}) {
  const emit=(event,fields={})=>{try{Promise.resolve(onEvent(event,fields)).catch(()=>{});}catch{}};
  const queue = [];
  const editors = new Set();
  const tables = new Set();
  let current, timer, availableAt = 0, archiveAvailableAt = 0;
  let failures = 0, cooldownUntil = 0;
  let portalOffline = false, connectionRevision = 0;
  const pacing = createArchivePacing();
  const storage = chrome.storage?.local || chrome.storage?.session;
  const healthKey = 'islandsun.read-health';
  let healthWrites = Promise.resolve();
  let restored = !storage;
  const navigation = watchPortalNavigation(chrome.tabs, state => {
    if (state?.durationMs >= 2000) {
      pacing.observe({elapsedMs:state.durationMs});
      archiveAvailableAt = Date.now() + Math.min(10000,state.durationMs);
      emit('archive-pacing',{...pacing.state(),reason:'slow-navigation'});
    }
    if (state) emit('navigation-state',{...state,url:safeRequestUrl(state.url),
      activeRead:current ? {kind:current.kind || 'preview',elapsedMs:Math.max(0,Date.now()-current.started)} : null,
      queuedReads:queue.length});
    pump();
  }, chrome.webRequest);
  if (storage) storage.get([healthKey,OFFLINE_STATUS]).then(saved => {
    if (!connectionRevision) portalOffline = saved[OFFLINE_STATUS]?.hadOutage === true || saved[OFFLINE_STATUS]?.state === 'offline';
    const health = saved[healthKey];
    if (Number.isFinite(health?.until) && health.until > 0 && health.until >= Date.now() - 86400000 && health.until <= Date.now() + 300000) {
      cooldownUntil = health.until;
      failures = Math.max(1, Math.min(4, Number(health.failures) || 1));
    }
    if (Number.isFinite(health?.inFlightUntil) && health.inFlightUntil > Date.now()) {
      cooldownUntil = Math.max(cooldownUntil,Math.min(health.inFlightUntil,Date.now() + 60000));
      emit('archive-interrupted',{cooldownUntil});
    }
  }).catch(() => {}).finally(() => { restored = true; pump(); });

  function persistHealth(inFlightUntil = 0) {
    const value = {until:cooldownUntil,failures,inFlightUntil};
    healthWrites = healthWrites.catch(() => {}).then(() => storage?.set({[healthKey]:value}));
    return healthWrites;
  }
  function recordResult(failed) {
    failures = failed ? Math.min(4, failures + 1) : 0;
    cooldownUntil = failed ? Date.now() + Math.min(300000, 60000 * 2 ** (failures - 1)) : 0;
    persistHealth().catch(() => {});
    emit('queue-health',{failed,failures,cooldownUntil});
  }

  function pump() {
    clearTimeout(timer);
    if (!restored || current || !queue.length) return;
    if (portalOffline) { for (const job of queue.splice(0)) pause(job); return; }
    const nativeTable = queue[0].nativeTable;
    const recoveryProbe = nativeTable && queue[0].kind !== 'sales-row-lookup';
    if (navigation.pendingRequest()) return;
    // A page may wait for its initial table before completing navigation.
    if (!nativeTable && (navigation.busy() || tables.size)) return;
    if (!recoveryProbe && cooldownUntil > Date.now()) {
      for (const job of queue.splice(0)) {
        try { job.port.postMessage({cooldownUntil}); } catch { /* The port may have closed during navigation. */ }
        finally { job.close(); }
      }
      return;
    }
    if (!nativeTable && editors.size && !queue[0].editorLookup) return;
    const wait = Math.max(availableAt, nativeTable ? 0 : navigation.settledAt()) - Date.now();
    if (wait > 0) { timer = setTimeout(pump, wait); return; }
    const job = queue.shift(); current = job; job.started = Date.now();
    emit('queue-granted',{queueId:job.id,priority:job.priority,queueMs:job.started-job.queuedAt,remaining:queue.length});
    try {
      job.port.postMessage({ granted: true });
      job.expiry = setTimeout(() => { recordResult(true); job.close(); }, nativeTable ? 60000 : 30000);
    } catch { job.close(); }
  }

  chrome.runtime.onConnect.addListener(port => {
    if (!['islandsun-read-gate', 'islandsun-editor-guard','islandsun-table-guard','islandsun-table-read'].includes(port.name)) return;
    try { if (new URL(port.sender?.url).origin !== PORTAL_ORIGIN) return port.disconnect(); }
    catch { return port.disconnect(); }
    if (port.name === 'islandsun-table-guard') {
      tables.add(port);
      emit('foreground-busy',{kind:'native-ajax-or-table',count:tables.size});
      try { current?.port?.postMessage({yield:true}); }
      catch { /* The existing owner releases its own request when it finishes. */ }
      port.onDisconnect.addListener(() => { tables.delete(port); emit('foreground-settled',{count:tables.size}); pump(); });
      return;
    }
    if (port.name === 'islandsun-editor-guard') {
      editors.add(port);
      port.onDisconnect.addListener(() => { editors.delete(port); pump(); });
      for (const job of [current, ...queue].filter(Boolean)) {
        if (!job.editorLookup && !job.nativeTable) pause(job);
      }
      return;
    }
    const job = { id:crypto.randomUUID(),port, started: 0, queued: false, nativeTable:port.name === 'islandsun-table-read' };
    function remove() {
      if (job.closed) return;
      job.closed = true;
      emit('queue-released',{queueId:job.id,started:Boolean(job.started),durationMs:job.started?Date.now()-job.started:0,finished:!!job.finished});
      clearTimeout(job.expiry);
      const index = queue.indexOf(job);
      if (index >= 0) queue.splice(index, 1);
      if (current === job) {
        // Healthy reads remain serial; slow responses retain a longer recovery interval.
        availableAt = Date.now() + recoveryDelay(Date.now() - job.started);
        pacing.observe({elapsedMs:Date.now()-job.started,failed:job.failed === true,interrupted:!job.finished && Date.now()-job.started < 4000});
        current = null;
      }
      pump();
    }
    job.close = () => { remove(); port.disconnect(); };
    port.onDisconnect.addListener(remove);
    port.onMessage.addListener(message => {
      if (message?.type === 'status' && job.queued && !job.closed) {
        try { port.postMessage({waiting:archiveWait()}); }
        catch { /* A closed reader no longer needs a queue explanation. */ }
        return;
      }
      if (message?.type === 'finished') {
        if (current === job && !job.closed && !job.finished && typeof message.failed === 'boolean') {
          job.finished = true; job.failed = message.failed; recordResult(message.failed);
          emit('queue-response',{queueId:job.id,failed:message.failed,durationMs:Date.now()-job.started});
        }
        return;
      }
      job.editorLookup = isTirSourceUrl(message?.editorLookup)
        && /^\/islandsun\/(?:index\.php\/)?master\/tir\/(?:create|edit\/\d+)\/?$/i.test(new URL(port.sender.url).pathname);
      if (editors.size && !job.editorLookup && !job.nativeTable) { pause(job); return; }
      if (job.queued || message?.type !== 'read' || queue.length >= 384) { job.close(); return; }
      job.kind = job.nativeTable ? message.kind === 'sales-row-lookup' ? 'sales-row-lookup' : 'native-table' : 'preview';
      job.queued = true; job.priority = job.nativeTable ? job.kind === 'native-table' ? 3 : 2 : message.priority === true ? 1 : 0;
      job.queuedAt=Date.now();
      emit('queue-enqueued',{queueId:job.id,kind:job.kind,priority:job.priority,tabId:port.sender?.tab?.id,wait:archiveWait()});
      const index = queue.findIndex(item => item.priority < job.priority);
      if (index < 0) queue.push(job); else queue.splice(index, 0, job);
      pump();
    });
  });

  function pause(job) {
    if (job.cancel) { job.cancel(); return; }
    try { job.port.postMessage({ paused: true, reason: portalOffline ? 'offline' : 'editor' }); }
    catch { /* A disconnected reader still needs its queue slot released. */ }
    finally { job.close(); }
  }
  function archiveWait() {
    if (!restored) return {reason:'startup'};
    if (portalOffline) return {reason:'offline'};
    if (navigation.busy()) return {reason:'navigation'};
    if (tables.size) return {reason:'table'};
    if (navigation.settledAt() > Date.now()) return {reason:'settling',until:navigation.settledAt()};
    if (editors.size) return {reason:'editor'};
    if (cooldownUntil > Date.now()) return {reason:'recovery',until:cooldownUntil};
    if (current) return {reason:'reading'};
    if (queue.length) return {reason:'queued'};
    if (Math.max(availableAt,archiveAvailableAt) > Date.now()) return {reason:'pacing',until:Math.max(availableAt,archiveAvailableAt)};
    return null;
  }
  return {
    archiveWait,
    isPortalOffline: () => portalOffline,
    setPortalOffline(value) {
      connectionRevision++;
      portalOffline = value;
      if (value) {
        if (current?.cancel) current.cancel();
        else if (current?.port && !current.nativeTable) pause(current);
        for (const job of queue.splice(0)) pause(job);
      }
      pump();
    },
    archivePacing: () => pacing.state(),
    archivePaused: (connectionProbe = false) => portalOffline && !connectionProbe || navigation.busy() || navigation.settledAt() > Date.now() || editors.size > 0 && !connectionProbe || tables.size > 0,
    /** Archive reads yield to foreground work and are aborted as soon as an editor opens. */
    async runArchiveRead(read, kind = 'archive') {
      if (portalOffline && kind !== 'archive-identity') return {deferred:true};
      const connectionProbe = portalOffline && kind === 'archive-identity';
      if (!restored || navigation.busy() || navigation.settledAt() > Date.now() || current || queue.length || editors.size && !connectionProbe || tables.size || cooldownUntil > Date.now()) return {deferred:true};
      if (Math.max(availableAt,archiveAvailableAt) > Date.now()) return {deferred:true,retryAfterMs:Math.max(availableAt,archiveAvailableAt)-Date.now()};
      const controller = new AbortController();
      const job = {kind:/^archive(?:-[a-z-]+)?$/.test(kind) ? kind : 'archive',started:Date.now(), cancel:() => controller.abort(), editorLookup:connectionProbe};
      current = job;
      let failed = false, interrupted = false;
      try {
        // Persist ownership before starting server work so a crash cannot trigger an immediate retry.
        if (storage) await persistHealth(Date.now() + 120000);
        controller.signal.throwIfAborted();
        if (navigation.busy() || tables.size || queue.length) { interrupted = true; return {deferred:true}; }
        const result = await read(controller.signal);
        controller.signal.throwIfAborted();
        recordResult(false);
        return {result};
      } catch (error) {
        failed = !controller.signal.aborted && error.name !== 'AbortError';
        interrupted = !failed;
        if (failed && connectionProbe && error.code === 'SIGNED_OUT') { failed = false; recordResult(false); }
        const serverFailure = error.status === 429 || error.status >= 500;
        if (!controller.signal.aborted && error.name !== 'AbortError'
          && (serverFailure || error.code !== 'ARCHIVE_DATA' && error.code !== 'SIGNED_OUT')) recordResult(true);
        throw error;
      } finally {
        pacing.observe({elapsedMs:Date.now()-job.started,failed,interrupted});
        archiveAvailableAt = Date.now() + pacing.state().gapMs;
        emit('archive-pacing',pacing.state());
        await persistHealth().catch(() => {});
        if (current === job) current = null;
        availableAt = Date.now() + recoveryDelay(Date.now() - job.started);
        pump();
      }
    },
    // The protected home check reads no record-specific editor/cart route.
    async runSessionCheck(check) {
      if (portalOffline) return {deferred:true};
      if (!restored || navigation.busy() || navigation.settledAt() > Date.now() || current || queue.length || tables.size || cooldownUntil > Date.now() || availableAt > Date.now()) return { deferred: true };
      const job = { kind:'keepalive', editorLookup: true, started: Date.now() };
      current = job;
      emit('session-check-start');
      try {
        const result = await check();
        recordResult(false);
        return { result };
      } catch (error) { recordResult(error.name !== 'AbortError'); throw error; }
      finally {
        emit('session-check-end',{durationMs:Date.now()-job.started});
        if (current === job) current = null;
        availableAt = Date.now() + recoveryDelay(Date.now() - job.started);
        pump();
      }
    },
  };
}
