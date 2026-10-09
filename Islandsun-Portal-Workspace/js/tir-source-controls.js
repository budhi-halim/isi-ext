import { tirSourceUrl } from './tir-source-logic.js';
import { isTirForm } from './tir-page.js';
import { rememberRequestNumber } from './request-log.js';

/** Resolve only the TIR request selector; leave Select2's choices and native handlers intact. */
export function createTirSourceControls(onChange) {
  const type = document.querySelector('#tir_jenis');
  const select = document.querySelector('#setsrf');
  if (!type || !select || !isTirForm()) return null;
  function loadedType() {
    const label = select.options[1]?.textContent || select.options[0]?.textContent || '';
    if (/\bSRF\b/.test(label)) return 'Sample Request';
    if (/\bSRS\b/.test(label)) return 'Stock Request';
    return null;
  }
  let readyType = loadedType();
  const optionsById = new Map();
  function indexOptions() {
    optionsById.clear();
    for (const option of select.options) optionsById.set(option.value, option);
  }
  indexOptions();
  function changed() { onChange(); }
  const events = new AbortController();
  const observer = new MutationObserver(() => { readyType = loadedType(); indexOptions(); changed(); });
  observer.observe(select, { childList: true });
  type.addEventListener('change', () => { readyType = null; changed(); }, { capture: true, signal: events.signal });
  select.addEventListener('change', changed, { signal: events.signal });

  function target(hit) {
    if (!(hit instanceof Element)) return null;
    const option = hit.closest('#select2-setsrf-results [role="treeitem"],#select2-setsrf-results [role="option"]');
    return option?.getClientRects().length ? option : null;
  }
  function record(element) {
    if (!target(element) || readyType !== type.value) return null;
    const id = element.id.match(/-([1-9]\d*)$/)?.[1];
    const url = tirSourceUrl(readyType, id);
    if (!url) return null;
    const option = optionsById.get(id);
    if (option) rememberRequestNumber(url, option.textContent);
    return option ? { url, title: option.textContent.trim() } : null;
  }
  function highlighted() {
    return document.querySelector('#select2-setsrf-results .select2-results__option--highlighted');
  }
  function records() {
    if (readyType !== type.value) return [];
    const menu = document.querySelector('#select2-setsrf-results');
    // Only the visible dropdown needs speculative previews; closed catalogs can contain thousands of records.
    const urls = [];
    if (menu) {
      for (const option of menu.children) {
        if (option.offsetTop + option.offsetHeight < menu.scrollTop) continue;
        if (option.offsetTop >= menu.scrollTop + menu.clientHeight) break;
        const data = record(option);
        if (data) urls.push(data.url);
        if (urls.length === 100) break;
      }
    }
    return urls;
  }
  return { target, record, highlighted, records, destroy() { observer.disconnect(); events.abort(); optionsById.clear(); } };
}
