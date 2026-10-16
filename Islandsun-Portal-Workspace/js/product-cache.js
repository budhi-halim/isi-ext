import { PREVIEW_FRESH_MS, recordKind, readPriority } from './fetch-policy.js';
import { diagnosticLog } from './diagnostic-log.js';

/** One bounded request queue serves foreground previews, page prefetch, and monitoring. */
export function createProductCache(load, { maxEntries = 90, maxBytes = 8 * 1024 * 1024, maxPending = 100, lifetime = PREVIEW_FRESH_MS, concurrency = 1, now = Date.now, persistence = null, pageSize = 10 } = {}) {
  const entries = new Map(), failures = new Map(), queued = new Map(), queue = [], controllers = new Set();
  let active = 0, urgentActive = 0, cachedBytes = 0, disposed = false, generation = 0;
  let storageWarning = false;
  function storageFailed() {
    if (!storageWarning) console.warn('[Islandsun Portal Workspace] Product cache is limited to this page because session storage is unavailable.');
    storageWarning = true;
  }
  const ready = persistence ? persistence.load().then(records => {
    if (!disposed) for (const record of records) remember(record.url, record.value, record.fetched);
  }).catch(storageFailed) : Promise.resolve();
  function forget(url) { cachedBytes -= entries.get(url)?.bytes || 0; entries.delete(url); }
  function remember(url, value, fetched = now()) {
    forget(url);
    let bytes;
    try { bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength; }
    catch { return; }
    // Large results remain usable by their caller without occupying the reusable cache.
    if (bytes > maxBytes) return;
    entries.set(url, { value, bytes, fetched, expires: fetched + lifetime }); cachedBytes += bytes;
    const kind = recordKind(url);
    const sameKind = [...entries.keys()].filter(key => recordKind(key) === kind);
    while (sameKind.length > pageSize * 3) forget(sameKind.shift());
    while (entries.size > maxEntries || cachedBytes > maxBytes) forget(entries.keys().next().value);
  }
  function pump() {
    while (!disposed && queue.length) {
      // Reserve one dispatch slot for visible work even when a background reader is held by the worker.
      const index = queue.findIndex(job => ['hover','visible'].includes(job.purpose) ? urgentActive < 1 : active - urgentActive < concurrency);
      if (index < 0) break;
      const job = queue.splice(index,1)[0], urgent = ['hover','visible'].includes(job.purpose), startedGeneration = generation;
      active++; if (urgent) urgentActive++;
      const controller = new AbortController(); controllers.add(controller);
      job.controller = controller;
      Promise.resolve().then(async () => {
        const release = await persistence?.lock?.(job.url);
        try {
          controller.signal.throwIfAborted();
          const shared = await persistence?.get?.(job.url);
          if (shared) job.cacheResult = true;
          if (!job.fresh && shared?.fetched + job.maxAge > now()) {
            job.fetched = shared.fetched;
            diagnosticLog('cache-hit',{url:job.url,shared:true,purpose:job.purpose});
            return shared.value;
          }
          const value = await load(job.url, controller.signal, { priority: job.priority, purpose:job.purpose, reason:job.reason });
          if (persistence && job.cacheResult && !controller.signal.aborted && generation === startedGeneration) await persistence.save({url:job.url,value,fetched:now(),pageSize,startedAt:job.startedAt}).catch(storageFailed);
          return value;
        } finally { release?.(); }
      }).then(value => {
        if (disposed || controller.signal.aborted || generation !== startedGeneration) throw new DOMException('Stopped', 'AbortError');
        failures.delete(job.url);
        if (job.cacheResult) remember(job.url, value, job.fetched || now());
        job.resolve(value);
      }).catch(error => {
        if (error.name !== 'AbortError') failures.set(job.url, { error, expires: now() + 10000 });
        while (failures.size > maxEntries) failures.delete(failures.keys().next().value);
        job.reject(error);
      }).finally(() => { job.settled = true; active--; if (urgent) urgentActive--; if (queued.get(job.url) === job) queued.delete(job.url); controllers.delete(controller); pump(); });
    }
  }
  function request(url, { priority = false, purpose = priority ? 'hover' : 'notification', reason, fresh = false, maxAge = lifetime, cacheResult = true } = {}) {
    if (disposed) return { promise: Promise.reject(new DOMException('Disposed', 'AbortError')) };
    const cached = entries.get(url);
    cacheResult ||= !!cached;
    if (!fresh && cached?.expires > now() && cached.fetched + maxAge > now()) {
      diagnosticLog('cache-hit',{url,purpose,ageMs:now()-cached.fetched});
      return { promise: Promise.resolve(cached.value) };
    }
    const failure = failures.get(url);
    if (failure?.expires > now()) return { promise: Promise.reject(failure.error) };
    const existing = queued.get(url);
    if (existing) {
      diagnosticLog('cache-joined',{url,purpose});
      existing.cacheResult ||= cacheResult;
      if (priority) existing.priority = true;
      if (readPriority(purpose,recordKind(url)) > readPriority(existing.purpose,recordKind(url))) { existing.purpose = purpose; existing.reason = reason; }
      queue.sort((a,b) => readPriority(b.purpose,recordKind(b.url)) - readPriority(a.purpose,recordKind(a.url))); pump();
      return existing;
    }
    if (queued.size >= maxPending) {
      const victim = priority && queue.find(job => !job.priority);
      if (!victim) return { promise: Promise.reject(new Error('The product list is busy. Please try again shortly.')) };
      queue.splice(queue.indexOf(victim), 1); queued.delete(victim.url); victim.settled = true;
      victim.reject(new DOMException('Prefetch superseded by an active request', 'AbortError'));
    }
    const job = { url, priority, purpose, reason, fresh, maxAge, cacheResult, startedAt:now(), consumers: new Set(), retained: false, settled: false };
    job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
    queued.set(url, job); queue.push(job);
    queue.sort((a,b) => readPriority(b.purpose,recordKind(b.url)) - readPriority(a.purpose,recordKind(a.url))); pump();
    return job;
  }
  function getReady(url, { signal, ...options } = {}) {
    if (signal?.aborted) return Promise.reject(signal.reason);
    const job = request(url, options);
    if (!signal) { job.retained = true; return job.promise; }
    const consumer = {};
    job.consumers?.add(consumer);
    function release() {
      signal.removeEventListener('abort', abort);
      job.consumers?.delete(consumer);
    }
    let abort;
    // Stop unused work while keeping a request shared by a hover or another consumer alive.
    return new Promise((resolve, reject) => {
      abort = () => {
        release(); reject(signal.reason);
        if (job.consumers && !job.consumers.size && !job.retained && !job.settled) {
          job.settled = true;
          const index = queue.indexOf(job);
          if (index >= 0) queue.splice(index, 1);
          if (queued.get(url) === job) queued.delete(url);
          job.controller?.abort();
          job.reject(new DOMException('No active consumers', 'AbortError'));
        }
      };
      signal.addEventListener('abort', abort, { once: true });
      job.promise.then(resolve, reject).finally(release);
    });
  }
  function get(url, options = {}) {
    const purpose = options.purpose || (options.priority ? 'hover' : 'notification');
    if (['hover','visible'].includes(purpose)) {
      try { globalThis.chrome?.runtime?.sendMessage({type:'portal-read-promote',url,purpose})?.catch(() => {}); }
      catch { /* Navigation may already have disconnected this consumer. */ }
    }
    return ready.then(() => getReady(url, options));
  }
  function peek(url, maxStale = 0) {
    const entry = entries.get(url);
    return !disposed && entry?.expires + maxStale > now() ? entry.value : undefined;
  }
  function clear() {
    generation++;
    for (const controller of controllers) controller.abort();
    for (const job of queue.splice(0)) job.reject(new DOMException('Cache cleared','AbortError'));
    queued.clear(); entries.clear(); cachedBytes = 0; failures.clear();
  }
  async function hasFresh(url) {
    await ready;
    return !disposed && entries.get(url)?.expires > now();
  }
  return { get, peek, hasFresh, clear, setPageSize(value) { if (Number.isInteger(value) && value >= 5 && value <= 100) pageSize = value; }, destroy() { disposed = true; clear(); } };
}
