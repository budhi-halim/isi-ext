(() => {
  if (!['http://apps.islandsunindonesia.com:81', 'http://192.168.0.22:81'].includes(location.origin)) return;
  const WIDGETS = '.connectedSortable,.todo-list,.textarea,.daterange,.knob,#world-map,#sparkline-1,#sparkline-2,#sparkline-3,#calendar,#chat-box,#revenue-chart,#line-chart,#sales-chart';
  const events = new AbortController();
  function waitForPreference() {
    const root = document.documentElement;
    if (root.dataset.isiPortal === 'enabled' || root.dataset.isiBoot !== 'pending') return null;
    return new Promise(resolve => {
      let timer;
      const finish = () => { clearTimeout(timer); observer.disconnect(); resolve(); };
      const observer = new MutationObserver(() => {
        if (root.dataset.isiPortal === 'enabled' || root.dataset.isiBoot !== 'pending') finish();
      });
      observer.observe(root, {attributes:true, attributeFilter:['data-isi-portal','data-isi-boot']});
      timer = setTimeout(finish, 1000);
    });
  }
  function install() {
    const $ = window.jQuery;
    if (typeof $?.fn.ready !== 'function') return;
    events.abort();
    const ready = $.fn.ready;
    $.fn.ready = function (callback, ...args) {
      let demo = false;
      try {
        const script = new URL(document.currentScript?.src || '', location.href);
        demo = script.origin === location.origin && script.pathname === '/islandsun/assets/dist/js/pages/dashboard.js';
      } catch { /* Other ready callbacks retain their native behavior. */ }
      if (!demo || typeof callback !== 'function') return Reflect.apply(ready, this, [callback, ...args]);
      return Reflect.apply(ready, this, [function (...values) {
        // This bundled demo initializes missing map/chart plugins on pages with none of its widgets.
        const run = () => {
          if (document.documentElement.dataset.isiPortal === 'enabled' && !document.querySelector(WIDGETS)) return;
          return Reflect.apply(callback, this, values);
        };
        // Storage may resolve after jQuery's ready callbacks; real widgets never wait.
        const preference = document.querySelector(WIDGETS) ? null : waitForPreference();
        return preference ? preference.then(run) : run();
      }, ...args]);
    };
  }
  document.addEventListener('load', event => {
    if (event.target instanceof HTMLScriptElement) install();
  }, {capture:true, signal:events.signal});
  document.addEventListener('DOMContentLoaded', install, {once:true, signal:events.signal});
  install();
})();
