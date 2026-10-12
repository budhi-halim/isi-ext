import { reveal } from './motion.js';
import { applyDefaultFilterLinks } from './filter-dates.js';

function columnType(text) {
  if (/^\/islandsun\/(?:index\.php\/)?newdo\/?$/i.test(location.pathname)) {
    if (/^(print|cetak)$/i.test(text)) return ['print', .45];
    if (/^(actions?|aksi)$/i.test(text)) return ['actions', 1.25];
  }
  if (/information request/i.test(text)) return ['information', 3.8];
  if (/^(actions?|aksi)?$/i.test(text)) return ['actions', .65];
  if (/^no\.?$/i.test(text)) return ['sequence', .45];
  if (/^(print|cetak|item|total item|total qty.*|is replacement)$/i.test(text)) return ['numeric', 1.2];
  if (/customer|product$|remark|description|^(sample name|comments?|suggestions?|conclusion)$/i.test(text)) return ['description', 2.1];
  if (/date|tanggal|schedule/i.test(text)) return ['date', 1.55];
  if (/^(no |request number|srs no)|(?:product|sample) code/i.test(text)) return ['identifier', 1.85];
  if (/pic|sales/i.test(text)) return ['person', 1.65];
  return ['status', 1.45];
}

/** Keep existing detail handlers and form controls; only navigation presentation changes. */
export function createNavigation() {
  const listeners = new AbortController();
  const panels = new Set();
  const signal = listeners.signal;
  // The old slimScroll wheel listener must not cancel scrolling of the native outer sidebar.
  document.addEventListener('wheel', event => {
    if (event.target instanceof Element && event.target.closest('.main-sidebar')) event.stopImmediatePropagation();
  }, { capture: true, passive: true, signal });
  function submenu(link) { return link?.parentElement?.querySelector(':scope > .treeview-menu'); }
  document.addEventListener('click', event => {
    const link = event.target.closest('.sidebar-menu > li > a');
    const panel = submenu(link);
    if (panel) {
      event.preventDefault(); event.stopImmediatePropagation();
      const open = link.getAttribute('aria-expanded') !== 'true';
      link.setAttribute('aria-expanded', String(open)); reveal(panel, open);
      panel.style.removeProperty('display'); panel.classList.toggle('menu-open', open);
      return;
    }
    const row = event.target.closest('tr[data-isi-row-detail]');
    if (!row || event.target.closest('a,button,input,select,textarea,label,[role="button"]') || getSelection()?.toString()) return;
    row.querySelector('[data-isi-detail]')?.click();
  }, { capture: true, signal });
  document.addEventListener('keydown', event => {
    const row = event.target.closest('tr[data-isi-row-detail]');
    if (row && event.target === row && ['Enter',' '].includes(event.key)) { event.preventDefault(); row.querySelector('[data-isi-detail]')?.click(); }
  }, { signal });
  function enhance() {
    applyDefaultFilterLinks();
    if (/^\/islandsun\/(?:index\.php\/)?newdo\/?$/i.test(location.pathname)) {
      for (const button of document.querySelectorAll('.content button')) {
        if (/^(Get product data|Get Produk Data)$/i.test(button.textContent.trim())) {
          const row = button.closest('.row');
          if (row) {
            row.dataset.isiDeliveryToolbar = '';
            for (const column of row.children) if (!column.childElementCount && !column.textContent.trim()) column.dataset.isiEmptyLayout = '';
          }
        }
        if (!/^deleteDO\(\d+\)/.test(button.getAttribute('onclick') || '') || button.hasAttribute('data-isi-delivery-delete')) continue;
        button.dataset.isiDeliveryDelete = ''; button.setAttribute('aria-label','Delete delivery order');
        for (const node of [...button.childNodes]) if (node.nodeType === Node.TEXT_NODE) node.remove();
        const full = document.createElement('span'); full.dataset.isiDeleteFull = ''; full.textContent = 'Delete';
        const compact = document.createElement('span'); compact.dataset.isiDeleteCompact = ''; compact.textContent = 'Del';
        button.append(full, compact);
      }
    }
    for (const link of document.querySelectorAll('.sidebar-menu > li > a')) {
      const panel = submenu(link);
      if (!panel || link.hasAttribute('aria-expanded')) continue;
      const open = panel.classList.contains('menu-open') || link.parentElement.classList.contains('active');
      link.setAttribute('aria-expanded', String(open)); panel.hidden = !open;
      panels.add(panel);
      panel.dataset.isiSubmenu = ''; panel.style.removeProperty('display');
    }
    for (const card of document.querySelectorAll('.small-box')) {
      const link = card.querySelector('.small-box-footer[href]');
      if (!link || link.dataset.isiCardLink !== undefined) continue;
      link.dataset.isiCardLink = ''; link.setAttribute('aria-label', `View ${card.querySelector('.inner')?.textContent.trim().replace(/\s+/g, ' ') || 'details'}`);
      link.replaceChildren(); card.dataset.isiClickable = '';
    }
    for (const table of document.querySelectorAll('table')) {
      const headers = [...(table.tHead?.rows[0]?.cells || [])];
      const bodyTable = table.closest('.dataTables_scrollHead')?.parentElement.querySelector('.dataTables_scrollBody table') || table;
      const bodyRows = [...(bodyTable.tBodies[0]?.rows || [])];
      if (/^\/islandsun\/(?:index\.php\/)?stockcard\/adjustmentstock\/?$/i.test(location.pathname) && bodyTable.id === 'stocktable') {
        table.dataset.isiStockAdjustmentTable = ''; bodyTable.dataset.isiStockAdjustmentTable = '';
      }
      if (/^\/islandsun\/(?:index\.php\/)?newdo\/?$/i.test(location.pathname) && headers.some(header => /^(print|cetak)$/i.test(header.textContent.trim()))) {
        table.dataset.isiDeliveryTable = ''; bodyTable.dataset.isiDeliveryTable = '';
      }
      const actions = headers.map((cell,index) => /^(actions?|aksi)?$/i.test(cell.textContent.trim()) ? index : -1).filter(index => index >= 0);
      for (const [index, header] of headers.entries()) {
        const text = header.textContent.trim();
        header.dataset.isiColumn = columnType(text)[0];
      }
      for (const row of bodyRows) {
        for (const [index, header] of headers.entries()) {
          if (header.dataset.isiColumn && row.cells[index]) row.cells[index].dataset.isiColumn = header.dataset.isiColumn;
        }
        const detail = [...row.querySelectorAll('a,button')].find(control => /^(detail|details|view details)$/i.test(control.textContent.trim() || control.getAttribute('aria-label') || control.getAttribute('title') || '') && !control.disabled);
        if (detail) { detail.dataset.isiDetail = ''; row.dataset.isiRowDetail = ''; row.tabIndex = 0; }
        else if (row.hasAttribute('data-isi-row-detail')) { delete row.dataset.isiRowDetail; row.removeAttribute('tabindex'); }
      }
      for (const index of actions) {
        const cells = bodyRows.map(row => row.cells[index]).filter(Boolean);
        const onlyDetails = cells.length > 0 && cells.every(cell => [...cell.querySelectorAll('a,button,input')].every(control => control.hasAttribute('data-isi-detail')) && !cell.textContent.replace(/details?/ig, '').trim());
        headers[index].toggleAttribute('data-isi-hidden-action', onlyDetails);
        for (const cell of cells) cell.toggleAttribute('data-isi-hidden-action', onlyDetails);
      }
      const visibleHeaders = headers.filter(header => !header.hasAttribute('data-isi-hidden-action'));
      const totalWeight = visibleHeaders.reduce((sum, header) => sum + columnType(header.textContent.trim())[1], 0);
      for (const header of visibleHeaders) header.style.setProperty('--isi-column-width', `${100 * columnType(header.textContent.trim())[1] / totalWeight}%`);
      const info = headers.findIndex(cell => /information request/i.test(cell.textContent));
      if (info < 0) continue;
      for (const row of bodyRows) {
        const cell = row.cells[info]; if (!cell || cell.hasAttribute('data-isi-bullets')) continue;
        let entries = cell.innerText.split(/\n/).map(text => text.trim()).filter(Boolean);
        try { const parsed = JSON.parse(cell.textContent); if (Array.isArray(parsed)) entries = parsed.map(String).map(text => text.trim()).filter(Boolean); } catch { /* The live table may already contain line-separated labels. */ }
        if (!entries.length || cell.querySelector('a,input,button')) continue;
        const list = document.createElement('ul'); list.className = 'isi-document-list';
        for (const text of entries) { const item = document.createElement('li'); item.textContent = text; list.append(item); }
        cell.replaceChildren(list); cell.dataset.isiBullets = '';
      }
    }
  }
  return { enhance, destroy() { listeners.abort(); for (const panel of panels) { panel.hidden = false; panel.inert = false; panel.parentElement.querySelector(':scope > a')?.removeAttribute('aria-expanded'); } panels.clear(); } };
}
