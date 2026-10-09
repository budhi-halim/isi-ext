import { createRowHover, positionHover, fadeHover } from '../assets/family/js/row-hover.js';
import { icon, iconButton } from './icons.js';
import { enterSurface, exitSurface } from './motion.js';

export function createProductPreviewUI({notify, repository, resolveRecord:record, sources = null, prefetch = null}) {
  const listeners = new AbortController();
  let hover, dialog, focused, pointer;
  const copyTimers = new Map();
  const reads = new WeakMap();
  function closeHover() { if (hover) { const surface = hover; reads.get(surface)?.abort(); hover = null; fadeHover(surface, false, () => surface.remove()); } }
  function closeDialog() { if (dialog) { const surface = dialog; exitSurface(surface, () => surface.close()); } }
  async function copyCode(code, button) {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(code);
      else {
        const input = document.createElement('textarea'); input.className = 'isi-portal-copy-buffer'; input.value = code;
        (dialog || document.body).append(input); input.select();
        let copied;
        try { copied = document.execCommand('copy'); } finally { input.remove(); button.focus(); }
        if (!copied) throw new Error('Clipboard unavailable');
      }
      if (!button.isConnected) return;
      clearTimeout(copyTimers.get(button)); button.replaceChildren(icon('check')); button.setAttribute('aria-label', 'Copied');
      copyTimers.set(button, setTimeout(() => { button.replaceChildren(icon('copy')); button.setAttribute('aria-label', `Copy ${code}`); copyTimers.delete(button); }, 1500));
      notify('Product code copied.');
    } catch { notify('Copy is unavailable. Select and copy the product code shown in the dialog.', { error: true }); }
  }
  function render(container, products, interactive) {
    container.querySelector('[data-isi-result]')?.remove();
    const list = document.createElement('div'); list.dataset.isiResult = '';
    if (!products.length) { const empty = document.createElement('p'); empty.textContent = 'No products yet'; empty.dataset.muted = ''; list.append(empty); }
    for (const product of products) {
      const item = document.createElement('div'); item.className = 'isi-portal-product';
      if (product.requested) { item.dataset.requested = ''; item.setAttribute('aria-label', 'Requested; not yet provided'); }
      const details = document.createElement('div');
      const name = document.createElement('p'); name.textContent = product.name;
      const code = document.createElement(product.code ? 'p' : 'small');
      code.textContent = product.code || 'Code unavailable'; code.dataset.muted = '';
      details.append(name, code); item.append(details);
      if (interactive && product.code) {
        const copy = iconButton('copy', `Copy ${product.code}`, () => copyCode(product.code, copy)); item.append(copy);
      }
      list.append(item);
    }
    if (products.some(product => product.requested)) { const key = document.createElement('small'); key.textContent = 'Italic items are requested, not yet provided.'; key.dataset.muted = ''; list.append(key); }
    container.append(list); if (!interactive) positionHover(container, pointer);
  }
  async function show(row, pinned) {
    const data = record(row); if (!data) return;
    closeHover(); if (dialog) return;
    const container = document.createElement(pinned ? 'dialog' : 'aside'); container.dataset.isiOwned = '';
    const request = new AbortController(); reads.set(container, request);
    container.className = pinned ? 'isi-portal-products' : 'isi-portal-hover isi-row-hover';
    const title = document.createElement('h2'); title.textContent = 'Products';
    container.append(title);
    const loading = document.createElement('p'); loading.dataset.isiResult = ''; loading.setAttribute('role', 'status'); loading.textContent = 'Loading…'; container.append(loading);
    const cache = repository;
    const cached = cache.peek(data.url, Infinity);
    if (cached) render(container, cached.products, pinned);
    if (pinned) {
      focused = document.activeElement; dialog = container;
      title.id = 'isi-portal-products-title'; dialog.setAttribute('aria-labelledby', title.id);
      const close = iconButton('close', 'Close products', closeDialog); close.classList.add('isi-portal-dialog-close'); container.append(close);
      container.addEventListener('close', () => { request.abort(); closeHover(); container.remove(); dialog = null; document.documentElement.removeAttribute('data-isi-dialog'); for (const timer of copyTimers.values()) clearTimeout(timer); copyTimers.clear(); if (focused?.isConnected) focused.focus({preventScroll:true}); }, { once: true });
      container.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
      document.body.append(container); container.showModal(); enterSurface(container); document.documentElement.dataset.isiDialog = 'open';
    } else { hover = container; container.hidden = true; document.body.append(container); fadeHover(container, true); positionHover(container, pointer); }
    try {
      const { products } = await cache.get(data.url, { priority: true, signal: request.signal });
      if (container.isConnected && container === (pinned ? dialog : hover)) render(container, products, pinned);
    } catch (error) {
      if (error.name !== 'AbortError' && container.isConnected && container === (pinned ? dialog : hover)) {
        loading.textContent = cached ? 'Showing the last loaded products. Refresh is temporarily unavailable.' : error.message || 'Products could not be loaded. Try again.';
        if (!loading.isConnected) container.append(loading);
      }
    }
  }
  const signal = listeners.signal;
  function target(hit) { const candidate = sources?.target(hit) || hit.closest('tr'); return record(candidate) ? candidate : null; }
  const tracking = createRowHover({ root: document.body, resolveRow: target,
    keyFor: row => record(row)?.url,
    show: (row, point) => { pointer = point; show(row, false); }, hide: closeHover,
    move: point => { pointer = point; if (hover) positionHover(hover, point); }, disabled: () => Boolean(dialog) });
  document.addEventListener('mouseup', event => {
    // Legacy Select2 selects on every mouseup, including a right click intended for inspection.
    if (event.button === 2 && sources?.target(event.target)) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, { signal, capture: true });
  document.addEventListener('contextmenu', event => {
    if (dialog) { event.preventDefault(); closeDialog(); return; }
    const row = target(event.target);
    if (record(row)) { event.preventDefault(); tracking.dismiss(); show(row, true); }
  }, { signal, capture: true });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') tracking.dismiss();
    // Keyboard inspection belongs to the open dropdown, just like pointer inspection.
    if ((event.key === 'F2' || event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))
      && (target(event.target) || document.querySelector('#select2-setsrf-results'))) {
      const selected = sources?.highlighted() || target(event.target);
      if (record(selected)) { event.preventDefault(); tracking.dismiss(); show(selected, true); }
    }
  }, { signal, capture: true });
  function enhance() {
    if (sources && !document.querySelector('#select2-setsrf-results')) closeHover();
    // Wait for DataTables to establish its current page before prefetching.
    const records = [];
    for (const row of document.querySelectorAll('.dataTables_wrapper #mytable tbody tr')) {
      const data = record(row);
      if (data && row.getClientRects().length && !document.hidden) records.push(data.url);
    }
    prefetch?.update(document.hidden ? [] : records.concat(sources?.records() || []));
  }
  document.addEventListener('visibilitychange', enhance, { signal });
  document.addEventListener('scroll', event => { if (event.target.id === 'select2-setsrf-results') enhance(); }, { signal, capture: true, passive: true });
  return { enhance, dismiss() { tracking.dismiss(); dialog?.close(); }, destroy() { prefetch?.destroy(); sources?.destroy(); reads.get(hover)?.abort(); hover?.remove(); hover = null; tracking.destroy(); dialog?.close(); listeners.abort(); repository.destroy(); for (const timer of copyTimers.values()) clearTimeout(timer); copyTimers.clear(); } };
}
