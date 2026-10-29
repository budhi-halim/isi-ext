(() => {
  if (!['http://apps.islandsunindonesia.com:81', 'http://192.168.0.22:81'].includes(location.origin)) return;
  const { pageSize } = window[Symbol.for('islandsun.table-density')];
  const tables = new Map();
  let timer, active = false, suspended = false, jquery;

  function bindTableEvents() {
    jquery(document).off('.isiDensity')
      .on('preDraw.dt.isiDensity length.dt.isiDensity', (_event, settings) => settings.nTable.style.removeProperty('--isi-records-height'))
      .on('init.dt.isiDensity draw.dt.isiDensity', () => {
        // Row replacement loses presentation attributes; restore them before the next paint.
        document.dispatchEvent(new Event('islandsun-table-draw'));
        schedule();
      })
      .on('xhr.dt.isiDensity', schedule);
  }

  function requestPending(api) {
    return api.settings()[0]?.jqXHR?.state?.() === 'pending';
  }

  function schedule() {
    clearTimeout(timer);
    if (active && !suspended) timer = setTimeout(refresh, 180);
  }

  function release(table, state) {
    state.resize.disconnect();
    state.wrapper.removeEventListener('change', state.onChange, true);
    table.style.removeProperty('--isi-records-height');
    if (table.isConnected && !state.manual && state.api.page.len() !== state.originalLength) {
      state.api.page.len(state.originalLength);
      if (requestPending(state.api)) {
        jquery(table).one('draw.dt.isiDensityRestore', () => {
          if (!active && table.isConnected) state.api.draw(false);
        });
      } else state.api.draw(false);
    }
    for (const option of state.options) if (!option.selected) option.remove();
    tables.delete(table);
  }

  function refresh() {
    if (!active || suspended) return;
    if (!jquery?.fn.dataTable && window.jQuery?.fn.dataTable) {
      jquery = window.jQuery;
      bindTableEvents();
    }
    for (const [table, state] of tables) if (!table.isConnected) release(table, state);
    if (!jquery?.fn.dataTable) return;
    for (const wrapper of document.querySelectorAll('[data-isi-table]')) {
      const table = [...wrapper.querySelectorAll('table')].find(element => !element.closest('.dataTables_scrollHead,.dataTables_scrollFoot') && jquery.fn.dataTable.isDataTable(element));
      const region = wrapper.querySelector('[data-isi-table-scroll]');
      if (!table || !region || !region.clientHeight) continue;
      let state = tables.get(table);
      if (!state) {
        const api = jquery(table).DataTable();
        state = { api, wrapper, region, originalLength: api.page.len(), manual: api.page.len() !== 10, options: new Set(), size: '', resize: new ResizeObserver(schedule) };
        state.onChange = event => {
          if (event.target.matches('.dataTables_length select')) { state.manual = true; schedule(); }
        };
        wrapper.addEventListener('change', state.onChange, true);
        state.resize.observe(region);
        tables.set(table, state);
      }
      // Keep automatic layout behind the native read already serving this table.
      // Completion schedules a fresh measurement using the latest viewport.
      if (requestPending(state.api)) continue;
      const search = state.api.settings()[0]?.nTableWrapper?.querySelector('.dataTables_filter input');
      if (search && search.value !== state.api.search()) continue;
      const rows = [...(table.tBodies[0]?.rows || [])].filter(row => !row.querySelector('.dataTables_empty') && row.getBoundingClientRect().height > 0);
      if (!rows.length) { table.style.removeProperty('--isi-records-height'); continue; }
      // Measure intrinsic row geometry before sharing unused vertical space.
      table.style.removeProperty('--isi-records-height');
      const naturalHeight = rows.reduce((height, row) => height + row.getBoundingClientRect().height, 0);
      const headerHeight = table.tHead?.getBoundingClientRect().height || 0;
      const tableOffset = table.getBoundingClientRect().top - region.getBoundingClientRect().top + region.scrollTop;
      const footerHeight = table.tFoot?.getBoundingClientRect().height || 0;
      const available = Math.max(0, region.clientHeight - tableOffset - headerHeight - footerHeight - (parseFloat(getComputedStyle(table).marginBottom) || 0) - 2);
      const size = `${region.clientWidth}:${region.clientHeight}`;
      if (!state.manual && size !== state.size) {
        const singleLineHeight = Math.max(36, ...[...rows[0].cells].filter(cell => cell.getBoundingClientRect().width > 0).map(cell => {
          const style = getComputedStyle(cell);
          const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.45;
          return lineHeight + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
        }));
        const length = pageSize(available, singleLineHeight);
        state.size = size;
        if (length !== state.api.page.len()) {
          for (const select of wrapper.querySelectorAll('.dataTables_length select')) {
            if (![...select.options].some(option => Number(option.value) === length)) {
              const option = new Option(String(length), String(length));
              select.add(option, [...select.options].find(item => Number(item.value) > length) || null);
              state.options.add(option);
            }
          }
          // Retain the current record's page when adapting an existing viewport.
          const start = state.api.page.info().start;
          state.api.page.len(length).page(Math.floor(start / length)).draw(false);
          schedule();
          continue;
        }
      }
      // Short final/search pages keep normal density instead of a few oversized rows.
      if (rows.length >= state.api.page.len() && naturalHeight < available) {
        table.style.setProperty('--isi-records-height', `${available}px`);
      }
    }
  }

  function sync() {
    if (suspended) return;
    const enabled = document.documentElement.dataset.isiPortal === 'enabled' && document.documentElement.dataset.isiLayout === 'table';
    if (enabled && !active) {
      active = true;
      jquery = window.jQuery;
      jquery?.('table').off('.isiDensityRestore');
      if (jquery) bindTableEvents();
      schedule();
    } else if (!enabled && active) {
      active = false; clearTimeout(timer);
      jquery?.(document).off('.isiDensity');
      for (const [table, state] of tables) release(table, state);
    }
    if (enabled) schedule();
  }
  const observer = new MutationObserver(sync);
  function connect() {
    suspended = false;
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-isi-portal', 'data-isi-layout'] });
    sync();
    for (const state of tables.values()) state.resize.observe(state.region);
    schedule();
  }
  document.addEventListener('islandsun-portal-ready', sync);
  window.addEventListener('pagehide', () => {
    suspended = true; observer.disconnect(); clearTimeout(timer);
    for (const state of tables.values()) state.resize.disconnect();
  });
  window.addEventListener('pageshow', connect);
  if (document.documentElement) connect();
  else document.addEventListener('DOMContentLoaded', connect, { once: true });
})();
