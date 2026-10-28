(() => {
  if (!['http://apps.islandsunindonesia.com:81', 'http://192.168.0.22:81'].includes(location.origin)
    || !/^\/islandsun\/(?:index\.php\/)?master\/tir(?:\/|$)/i.test(location.pathname)) return;

  let installed = false, sequence = 0;
  const events = new AbortController();
  function install() {
    const $ = window.jQuery;
    if (installed || typeof $?.ajaxPrefilter !== 'function') return;
    installed = true;
    events.abort();
    $.ajaxPrefilter((options, original) => {
      let url;
      try { url = new URL(options.url, location.href); } catch { return; }
      if (url.origin !== location.origin || !/^\/islandsun\/(?:index\.php\/)?master\/tir\/chooseJenis\/?$/i.test(url.pathname)
        || typeof options.success !== 'function') return;
      const data = original.data;
      const kind = typeof data === 'string' ? new URLSearchParams(data).get('jenis') : data?.jenis;
      if (!['-', 'Sample Request', 'Stock Request'].includes(kind)) return;
      const current = document.querySelector('#tir_jenis')?.value === kind ? ++sequence : -1;
      const success = options.success;
      options.success = function (...args) {
        const source = document.querySelector('#tir_jenis');
        // Late catalogs must not replace the currently selected source or its dependent fields.
        if (document.documentElement.dataset.isiPortal === 'enabled'
          && (!source || current !== sequence || source.value !== kind)) return;
        return success.apply(this, args);
      };
    });
  }

  // Capture script loads before the portal's ready callback starts its initial catalog request.
  document.addEventListener('load', event => {
    if (event.target instanceof HTMLScriptElement) install();
  }, { capture: true, signal: events.signal });
  document.addEventListener('DOMContentLoaded', install, { signal: events.signal });
  document.addEventListener('islandsun-portal-ready', install, { signal: events.signal });
  install();
})();
