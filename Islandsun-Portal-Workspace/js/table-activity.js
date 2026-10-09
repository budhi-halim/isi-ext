(() => {
  if (location.origin !== 'http://apps.islandsunindonesia.com:81') return;
  const requests = new Set();
  let active = false, jquery, scanTimer, idleTimer, quietUntil = 0, announced = false;

  function publish(force = false) {
    clearTimeout(idleTimer);
    const busy = active && (requests.size > 0 || Date.now() < quietUntil);
    if (force || busy !== announced) {
      announced = busy;
      document.dispatchEvent(new CustomEvent('islandsun-table-activity', {detail:{busy}}));
    }
    if (active && !requests.size && quietUntil > Date.now()) idleTimer = setTimeout(publish, quietUntil - Date.now());
  }
  function settle() { quietUntil = Date.now() + 2000; publish(); }
  function interaction(event) {
    if (active && event.isTrusted && event.target.closest?.('.dataTables_wrapper,[data-isi-filter-panel]')) settle();
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
    else { jquery?.(document).off('.isiTableActivity'); requests.clear(); quietUntil = 0; publish(); }
  }
  for (const event of ['input','keydown','pointerdown','change']) document.addEventListener(event,interaction,{capture:true,passive:true});
  document.addEventListener('islandsun-table-activity-request',() => publish(true));
  document.addEventListener('islandsun-portal-ready',sync);
  window.addEventListener('pagehide',() => { active = false; clearTimeout(scanTimer); jquery?.(document).off('.isiTableActivity'); requests.clear(); quietUntil = 0; publish(); });
  window.addEventListener('pageshow',sync);
  function start() {
    new MutationObserver(sync).observe(document.documentElement,{attributes:true,attributeFilter:['data-isi-portal']});
    sync();
  }
  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded',start,{once:true});
})();
