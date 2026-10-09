(() => {
  if (location.origin !== 'http://apps.islandsunindonesia.com:81') return;
  const KEY = 'islandsunTableState';
  const SEARCH_DELAY = 700;
  const tables = new Map();
  let jquery, active = false, scanTimer;
  const enabled = () => document.documentElement.dataset.isiPortal === 'enabled';
  const read = () => history.state?.[KEY] || {};

  function write(id, value) {
    try { history.replaceState({...history.state, [KEY]: {...read(), [id]: value}}, ''); }
    catch { /* Private browsing or another history owner may reject persistence. */ }
  }
  function filters() {
    return [...document.querySelectorAll('[data-isi-filter-panel] input[id],[data-isi-filter-panel] select[id]')]
      .filter(control => !['password','hidden','button','submit'].includes(control.type))
      .map(control => ({id:control.id, value:control.value, checked:control.checked}));
  }
  function restoreFilters(state, early = false) {
    for (const saved of (state.filters || []).slice(0,32)) {
      const control = document.getElementById(saved.id);
      if (!control?.closest(early ? '.content-wrapper .box-header,[data-isi-filter-panel]' : '[data-isi-filter-panel]') || !control.matches('input,select') || ['password','hidden','button','submit'].includes(control.type)) continue;
      control.value = saved.value;
      if (['checkbox','radio'].includes(control.type)) control.checked = saved.checked;
    }
  }
  document.addEventListener('DOMContentLoaded', () => {
    if (!enabled()) return;
    for (const state of Object.values(read())) restoreFilters(state, true);
  }, {once:true});
  function remember(state) {
    const info = state.api.page.info();
    write(state.table.id, {search:state.input.value, order:state.api.order(), length:info.length, page:info.page, filters:filters()});
  }
  function apply(state, retry = false) {
    clearTimeout(state.timer);
    if (!active || !state.table.isConnected || state.composing) return;
    const value = state.input.value;
    remember(state);
    if (state.api.settings()[0]?.jqXHR?.state?.() === 'pending') {
      state.pending = true;
      return;
    }
    state.pending = false;
    if (value !== state.api.search() || retry && state.api.settings()[0]?.jqXHR?.state?.() === 'rejected') state.api.search(value).draw();
  }
  function release(state) {
    clearTimeout(state.timer); state.events.abort();
    jquery(state.table).off('.isiSearch');
    // Restore the native handler list in its original order when the extension is disabled.
    jquery(state.input).off('.isiSearch');
    for (const entry of state.originals) jquery(state.input).on(entry.event, entry.handler);
  }
  function scan() {
    if (!active) return;
    jquery = window.jQuery;
    if (!jquery?.fn.dataTable) { scanTimer = setTimeout(scan, 150); return; }
    for (const [table, state] of tables) if (!table.isConnected) { release(state); tables.delete(table); }
    for (const table of document.querySelectorAll('.content-wrapper table[id]')) {
      if (tables.has(table) || !jquery.fn.dataTable.isDataTable(table)) continue;
      const api = jquery(table).DataTable(), settings = api.settings()[0];
      if (!settings._bInitComplete) { scanTimer = setTimeout(scan, 150); continue; }
      const input = settings.nTableWrapper?.querySelector('.dataTables_filter input');
      if (!input) continue;
      const originals = [];
      for (const [event, handlers] of Object.entries(jquery._data(input, 'events') || {})) {
        for (const {namespace,handler} of handlers) if (namespace?.split('.').includes('DT') || ['keyup','input','search','change','paste','cut'].includes(event)) originals.push({event:namespace ? `${event}.${namespace}` : event,handler});
      }
      for (const entry of originals) jquery(input).off(entry.event, entry.handler);
      const state = {table,api,input,originals,events:new AbortController(),timer:null,composing:false};
      tables.set(table, state);
      const options = {signal:state.events.signal};
      input.addEventListener('input', () => { clearTimeout(state.timer); remember(state); if (!state.composing) state.timer = setTimeout(() => apply(state), SEARCH_DELAY); }, options);
      input.addEventListener('compositionstart', () => { state.composing = true; clearTimeout(state.timer); }, options);
      input.addEventListener('compositionend', () => { state.composing = false; clearTimeout(state.timer); state.timer = setTimeout(() => apply(state), SEARCH_DELAY); }, options);
      input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); apply(state,true); } }, options);
      jquery(table).on('draw.dt.isiSearch', () => remember(state));
      jquery(table).on('xhr.dt.isiSearch', () => {
        // The xhr event precedes jQuery's resolved state. Keep only the latest input.
        if (state.pending) { clearTimeout(state.timer); state.timer = setTimeout(() => apply(state), 250); }
      });
      const saved = read()[table.id];
      if (saved && typeof saved.search === 'string') {
        restoreFilters(saved);
        input.value = saved.search;
        api.search(saved.search);
        if (Array.isArray(saved.order) && saved.order.every(item => Array.isArray(item) && Number.isInteger(item[0]) && item[0] >= 0 && item[0] < settings.aoColumns.length && ['asc','desc'].includes(item[1]))) api.order(saved.order);
        if ([10,15,20,25,30,35,40,45,50,55,60,65,70,75,80,85,90,95,100].includes(saved.length)) api.page.len(saved.length);
        api.page(Math.max(0, Number.isSafeInteger(saved.page) ? saved.page : 0)).draw(false);
      }
    }
  }
  function sync() {
    const next = enabled();
    if (next === active) return;
    active = next; clearTimeout(scanTimer);
    if (active) scan();
    else { for (const state of tables.values()) release(state); tables.clear(); }
  }
  document.addEventListener('islandsun-portal-ready', sync);
  document.addEventListener('islandsun-table-draw', () => { clearTimeout(scanTimer); if (active) scanTimer = setTimeout(scan, 0); });
  window.addEventListener('pagehide', () => { for (const state of tables.values()) { remember(state); clearTimeout(state.timer); } clearTimeout(scanTimer); });
  window.addEventListener('pageshow', () => { if (active) scan(); else sync(); });
  new MutationObserver(sync).observe(document.documentElement, {attributes:true, attributeFilter:['data-isi-portal']});
  sync();
})();
