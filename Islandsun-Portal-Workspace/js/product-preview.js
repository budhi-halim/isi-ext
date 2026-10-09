import { handlerId, requestDetailUrl, tirDetailUrl, sampleType } from './logic.js';
import { readProducts } from './product-loader.js';
import { createProductCache } from './product-cache.js';
import { createTirSourceControls } from './tir-source-controls.js';
import { createProductPrefetch } from './product-prefetch.js';
import { isTirList } from './tir-page.js';
import { rememberRequestNumber } from './request-log.js';

import { createProductPreviewUI } from './product-preview-ui.js';

export function createProductPreview(notify, repository = createProductCache(readProducts)) {
  let view;
  const sources = createTirSourceControls(() => { view?.dismiss(); view?.enhance(); });
  const prefetch = createProductPrefetch(repository);
  function record(row) {
    const source = sources?.record(row);
    if (source) return source;
    if (!row?.closest('#mytable')) return null;
    if (isTirList()) {
      const id = [...row.querySelectorAll('[onclick]')].map(element => handlerId(element.getAttribute('onclick'), 'edit')).find(Boolean);
      const url = tirDetailUrl(id);
      if (url) rememberRequestNumber(url, row.cells[1]?.textContent);
      return url ? { url, title: row.cells[1]?.textContent.trim() || 'TIR' } : null;
    }
    if (!/^\/islandsun\/(?:index\.php\/)?samplerequest\/?$/i.test(location.pathname)) return null;
    const handler = [...row.querySelectorAll('[onclick]')].map(element => handlerId(element.getAttribute('onclick'), 'detailData')).find(Boolean);
    const type = [...row.cells].map(cell => sampleType(cell.textContent)).find(Boolean);
    const url = requestDetailUrl(handler, type);
    if (url) rememberRequestNumber(url, row.cells[1]?.textContent);
    return url ? { url, title: row.cells[1]?.textContent.trim() || 'Sample request' } : null;
  }
  view = createProductPreviewUI({notify,repository,sources,prefetch,resolveRecord:record});
  return view;
}
