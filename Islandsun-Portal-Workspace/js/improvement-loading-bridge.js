(() => {
  if (location.origin !== 'http://apps.islandsunindonesia.com:81') return;
  const route = location.pathname.toLowerCase().replace('/index.php/', '/');
  const query = new URLSearchParams(location.search);
  const source = route === '/islandsun/samplerequest/getimprovement' ? query.get('sr_id')
    : route === '/islandsun/samplerequest/add' && query.get('srtype') === '5' ? query.get('improveid') : null;
  if (!/^[1-9]\d*$/.test(source)) return;

  let installed = false, scope, active, sequence = 0, original, wrapped;
  const enabled = () => document.documentElement.dataset.isiPortal === 'enabled';
  function publish(run, state) {
    if (active !== run) return;
    document.dispatchEvent(new CustomEvent('islandsun-improvement-loading', {
      detail: {id: run.id, state, source, completed: run.completed, total: run.total},
    }));
  }
  function settle(run) {
    if (active !== run || run.pending) return;
    clearTimeout(run.timer);
    publish(run, run.failed || !run.total ? 'failed' : 'complete');
    active = null;
  }
  function invoke(run, callback, context, args) {
    const previous = scope;
    scope = run;
    try {
      let result;
      for (const fn of Array.isArray(callback) ? callback : [callback]) {
        if (typeof fn === 'function') result = fn.apply(context, args);
      }
      return result;
    } catch (error) {
      run.failed = true;
      throw error;
    } finally { scope = previous; }
  }
  function install() {
    const $ = window.jQuery;
    if (typeof $?.ajaxPrefilter !== 'function' || typeof window.LoadSrf !== 'function') return false;
    if (!installed) {
      installed = true;
      $.ajaxPrefilter((options, _original, xhr) => {
        const run = scope;
        if (!run || run !== active) return;
        run.pending++; run.total++;
        for (const key of ['success', 'error', 'complete']) {
          const callback = options[key];
          options[key] = function (...args) { return invoke(run, callback, this, args); };
        }
        // Observe the native request without changing its URL, data, timeout or retry behavior.
        xhr.always((_response, status) => {
          if (!['success', 'notmodified', 'nocontent'].includes(status)) run.failed = true;
          run.pending--; run.completed++;
          queueMicrotask(() => { publish(run, 'loading'); settle(run); });
        });
      });
    }
    if (window.LoadSrf !== wrapped) {
      original = window.LoadSrf;
      wrapped = function (...args) {
        if (!enabled()) return original.apply(this, args);
        if (active) return;
        const run = {id: ++sequence, pending: 0, total: 0, completed: 0, failed: false};
        active = run;
        run.timer = setTimeout(() => publish(run, 'slow'), 60000);
        publish(run, 'loading');
        try { return invoke(run, original, this, args); }
        finally { queueMicrotask(() => settle(run)); }
      };
      window.LoadSrf = wrapped;
    }
    return true;
  }
  document.addEventListener('click', event => {
    if (event.target.closest?.('a[onclick],button[onclick]')?.getAttribute('onclick')?.match(/^\s*LoadSrf\(\s*\)\s*;?\s*$/)) install();
  }, true);
  document.addEventListener('islandsun-portal-ready', install);
  window.addEventListener('pagehide', () => {
    clearTimeout(active?.timer); active = null; scope = null;
    if (window.LoadSrf === wrapped) window.LoadSrf = original;
  });
})();
