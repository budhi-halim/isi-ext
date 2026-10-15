(() => {
  if (location.origin !== 'http://apps.islandsunindonesia.com:81') return;
  const requests = new Set();
  let active = false, jquery, scanTimer, idleTimer, quietUntil = 0, announced = '', interactionUntil = 0;

  function publish(force = false) {
    clearTimeout(idleTimer);
    const busy = active && (requests.size > 0 || Date.now() < quietUntil);
    const interacting = active && Date.now() < interactionUntil;
    const signature = `${busy}:${interacting}:${interactionUntil}`;
    if (force || signature !== announced) {
      announced = signature;
      document.dispatchEvent(new CustomEvent('islandsun-table-activity', {detail:{busy, interactionUntil:interacting ? interactionUntil : 0}}));
    }
    const deadlines = [!requests.size && quietUntil, interactionUntil].filter(value => value > Date.now());
    if (active && deadlines.length) idleTimer = setTimeout(publish, Math.min(...deadlines) - Date.now());
  }
  function settle() { quietUntil = Date.now() + 2000; publish(); }
  function interaction(event) {
    if (!active || !event.isTrusted) return;
    const target = event.target;
    const table = target.closest?.('.dataTables_wrapper,[data-isi-filter-panel]');
    const search = table && target.matches?.('input,select,textarea,[role="searchbox"]');
    const source = target.closest?.('#setsrf,#select2-setsrf-container,#select2-setsrf-results,[aria-owns="select2-setsrf-results"],[aria-controls="select2-setsrf-results"]')
      || target.matches?.('.select2-search__field') && document.querySelector('#select2-setsrf-results');
    if (search || source) interactionUntil = Date.now() + 60000;
    if (table || source) settle();
  }
  function bind() {
    if (!active) return;
    jquery = window.jQuery;
    if (!jquery?.ajax) { scanTimer = setTimeout(bind,150); return; }
    jquery(document).off('.isiTableActivity')
      .on('ajaxSend.isiTableActivity', (_event,xhr,settings) => {
        try { if (new URL(settings.url,location.href).origin !== location.origin) return; }
        catch { return; }
        requests.add(xhr); publish();
      })
      .on('ajaxComplete.isiTableActivity', (_event,xhr) => {
        if (requests.delete(xhr)) settle();
      });
    // Cover requests that began before the theme enabled this observer.
    if (jquery.fn.dataTable?.settings) for (const settings of jquery.fn.dataTable.settings) {
      if (settings.jqXHR?.state?.() === 'pending') requests.add(settings.jqXHR);
    }
    publish();
  }
  function sync() {
    const next = document.documentElement?.dataset.isiPortal === 'enabled';
    if (next === active) return;
    active = next; clearTimeout(scanTimer);
    if (active) bind();
    else { jquery?.(document).off('.isiTableActivity'); requests.clear(); quietUntil = 0; interactionUntil = 0; publish(); }
  }
  for (const event of ['focusin','input','keydown','pointerdown','change','scroll']) document.addEventListener(event,interaction,{capture:true,passive:true});
  document.addEventListener('focusout',() => queueMicrotask(() => {
    const target = document.activeElement;
    if (!target?.closest?.('.dataTables_wrapper,[data-isi-filter-panel],.select2-container,#setsrf') && !document.querySelector('#select2-setsrf-results')) {
      interactionUntil = 0; publish();
    }
  }));
  document.addEventListener('islandsun-table-activity-request',() => publish(true));
  document.addEventListener('islandsun-portal-ready',sync);
  window.addEventListener('pagehide',() => { active = false; clearTimeout(scanTimer); jquery?.(document).off('.isiTableActivity'); requests.clear(); quietUntil = 0; interactionUntil = 0; publish(); });
  window.addEventListener('pageshow',sync);
  function start() {
    new MutationObserver(sync).observe(document.documentElement,{attributes:true,attributeFilter:['data-isi-portal']});
    sync();
  }
  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded',start,{once:true});
})();
