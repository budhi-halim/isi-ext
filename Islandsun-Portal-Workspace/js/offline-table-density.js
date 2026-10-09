import './table-density-logic.js';

const { pageSize } = window[Symbol.for('islandsun.table-density')];

/** Apply the portal's row-fit policy to local queries, preserving manual choices and position. */
export function createOfflineTableDensity({region,select,getPage,onResize}) {
  const table = region.querySelector('table');
  let timer, frame, manual = false, suspended = false, geometry = '';
  const observer = new ResizeObserver(schedule);

  function option(size) {
    if (![...select.options].some(item => Number(item.value) === size)) select.add(new Option(String(size),String(size)),[...select.options].find(item => Number(item.value) > size) || null);
    select.value = String(size);
  }
  function refresh() {
    if (suspended || !region.clientHeight || !region.getClientRects().length || table.tBodies[0]?.getAttribute('aria-busy') === 'true') return;
    const rows = [...table.tBodies[0]?.rows || []];
    table.style.removeProperty('--isi-records-height');
    if (!rows.length) return;
    const natural = rows.reduce((height,row) => height+row.getBoundingClientRect().height,0);
    const offset = table.getBoundingClientRect().top-region.getBoundingClientRect().top+region.scrollTop;
    const available = Math.max(0,region.clientHeight-offset-(table.tHead?.getBoundingClientRect().height || 0)-2);
    const size = `${region.clientWidth}:${region.clientHeight}`;
    if (!manual && size !== geometry) {
      const rowHeight = Math.max(36,...[...rows[0].cells].map(cell => {
        const style = getComputedStyle(cell);
        return (parseFloat(style.lineHeight) || parseFloat(style.fontSize)*1.45)+parseFloat(style.paddingTop)+parseFloat(style.paddingBottom)+parseFloat(style.borderTopWidth)+parseFloat(style.borderBottomWidth);
      }));
      const length = pageSize(available,rowHeight);
      geometry = size;
      if (length !== Number(select.value)) {
        const start = getPage()*Number(select.value);
        option(length); onResize(Math.floor(start/length)); return;
      }
    }
    if (rows.length >= Number(select.value) && natural < available) table.style.setProperty('--isi-records-height',`${available}px`);
  }
  function schedule() {
    clearTimeout(timer); cancelAnimationFrame(frame);
    if (!suspended) timer = setTimeout(() => { frame = requestAnimationFrame(refresh); },180);
  }
  function setManual() { manual = true; schedule(); }
  function stop() { suspended = true; observer.disconnect(); clearTimeout(timer); cancelAnimationFrame(frame); }
  function start() { suspended = false; observer.observe(region); schedule(); }
  select.addEventListener('change',setManual);
  window.addEventListener('pagehide',stop);
  window.addEventListener('pageshow',start);
  start();
  return {
    schedule,
    get automatic() { return !manual; },
    restore(size,automatic) {
      manual = !automatic; geometry = '';
      const length = Number(size);
      option(Number.isInteger(length) && length >= 10 && length <= 100 ? length : 10);
      schedule();
    },
    destroy() { stop(); select.removeEventListener('change',setManual); window.removeEventListener('pagehide',stop); window.removeEventListener('pageshow',start); table.style.removeProperty('--isi-records-height'); }
  };
}
