/** One bounded request queue serves foreground previews, page prefetch, and monitoring. */
export function createProductCache(load, { maxEntries = 300, maxBytes = 8 * 1024 * 1024, maxPending = 300, lifetime = 60000, concurrency = 2, now = Date.now, persistence = null } = {}) {
  const entries = new Map(), failures = new Map(), queued = new Map(), queue = [], controllers = new Set();
  let active = 0, cachedBytes = 0, disposed = false;
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
    while (entries.size > maxEntries || cachedBytes > maxBytes) forget(entries.keys().next().value);
  }
  function pump() {
    while (!disposed && active < concurrency && queue.length) {
      const job = queue.shift(); active++;
      const controller = new AbortController(); controllers.add(controller);
      job.controller = controller;
      Promise.resolve().then(() => load(job.url, controller.signal, { priority: job.priority })).then(value => {
        if (disposed || controller.signal.aborted) throw new DOMException('Stopped', 'AbortError');
        failures.delete(job.url); remember(job.url, value);
        if (persistence) persistence.save({ url: job.url, value, fetched: now() }).catch(storageFailed);
        job.resolve(value);
      }).catch(error => {
        if (error.name !== 'AbortError') failures.set(job.url, { error, expires: now() + 10000 });
        while (failures.size > maxEntries) failures.delete(failures.keys().next().value);
        job.reject(error);
      }).finally(() => { job.settled = true; active--; if (queued.get(job.url) === job) queued.delete(job.url); controllers.delete(controller); pump(); });
    }
  }
  function request(url, { priority = false, fresh = false, maxAge = lifetime } = {}) {
    if (disposed) return { promise: Promise.reject(new DOMException('Disposed', 'AbortError')) };
    const cached = entries.get(url);
    if (!fresh && cached?.expires > now() && cached.fetched + maxAge > now()) return { promise: Promise.resolve(cached.value) };
    const failure = failures.get(url);
    if (failure?.expires > now()) return { promise: Promise.reject(failure.error) };
    const existing = queued.get(url);
    if (existing) {
      if (priority) existing.priority = true;
      const index = queue.indexOf(existing);
      if (priority && index > 0) { queue.splice(index, 1); queue.unshift(existing); }
      return existing;
    }
    if (queued.size >= maxPending) {
      const victim = priority && queue.find(job => !job.priority);
      if (!victim) return { promise: Promise.reject(new Error('The product list is busy. Please try again shortly.')) };
      queue.splice(queue.indexOf(victim), 1); queued.delete(victim.url); victim.settled = true;
      victim.reject(new DOMException('Prefetch superseded by an active request', 'AbortError'));
    }
    const job = { url, priority, consumers: new Set(), retained: false, settled: false };
    job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
    queued.set(url, job); priority ? queue.unshift(job) : queue.push(job); pump();
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
  function get(url, options) { return ready.then(() => getReady(url, options)); }
  function peek(url, maxStale = 0) {
    const entry = entries.get(url);
    return !disposed && entry?.expires + maxStale > now() ? entry.value : undefined;
  }
  return { get, peek, destroy() { disposed = true; for (const controller of controllers) controller.abort(); for (const job of queue.splice(0)) job.reject(new DOMException('Disposed', 'AbortError')); queued.clear(); entries.clear(); cachedBytes = 0; failures.clear(); } };
}
