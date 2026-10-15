/** Refresh a bounded working set without overlapping passes or retaining obsolete pages. */
export function createProductPrefetch(cache, { interval = 300000, limit = 100 } = {}) {
  let urls = [], signature = '', controller, timer, disposed = false;
  async function run() {
    clearTimeout(timer);
    if (disposed || controller || !urls.length) return;
    const current = new AbortController();
    controller = current;
    try {
      for (const url of urls) {
        if (current.signal.aborted) break;
        try { await cache.get(url, { signal: current.signal, priority: true, purpose:'visible' }); }
        catch (error) { if (error.name === 'AbortError') break; }
      }
    } finally {
      if (controller === current) {
        controller = null;
        if (!disposed && urls.length) timer = setTimeout(run, interval);
      }
    }
  }
  return {
    update(records) {
      const next = [...new Set(records)].slice(0, limit);
      const key = JSON.stringify(next);
      if (key === signature) return;
      signature = key; urls = next;
      clearTimeout(timer); controller?.abort(); controller = null;
      void run();
    },
    destroy() { disposed = true; clearTimeout(timer); controller?.abort(); urls = []; }
  };
}
