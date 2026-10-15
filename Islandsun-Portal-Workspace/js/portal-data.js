import { PORTAL_ORIGIN, portalUrl } from './shared/document-names.js';
import { hasRequestedProducts, mergeProducts, splitIssuedProduct, splitRequestedProduct } from './product-logic.js';
import { readPortalText, withPortalRead } from './portal-request.js';
import { requestNumber } from './request-log.js';
import { rememberOfflineDetail } from './offline-observer.js';
import { recordPortalProcessing } from './debug-capture-client.js';

const detailSources = new WeakMap();

/** Read a detail page without executing any of its scripts or loading its frames. */
export async function readDetail(url, signal, { priority = false, purpose, reason, readText = readPortalText } = {}) {
  const parsed = portalUrl(url);
  if (!parsed || !/^\/islandsun\/(?:master\/tir\/edit\/\d+|samplerequest\/edit)$/i.test(parsed.pathname)) throw new Error('This record link is unavailable.');
  const observedAt = Date.now();
  const html = await readText(parsed.href, { signal, priority, purpose, reason, redirect: 'follow' });
  const started = performance.now();
  const root = new DOMParser().parseFromString(html, 'text/html');
  recordPortalProcessing(url,'preview-dom-parse',performance.now()-started,root);
  if ((root.querySelector('input[type="password"],form.lockscreen-credentials,.login-box') || root.body.classList.contains('lockscreen')) && !root.querySelector('.content-wrapper')) throw new Error('Your session has expired. Sign in to Islandsun and try again.');
  detailSources.set(root,{html,observedAt,supplementary:null});
  if (/\/tir\//i.test(parsed.pathname)) rememberOfflineDetail(url,root,detailSources.get(root));
  return root;
}

/** The R&D-issued table is authoritative; requested products only resolve exact name/code matches. */
export function issuedProducts(root, splitCode = false) {
  const table = [...root.querySelectorAll('#samplernd table')].find(candidate => /Nama\s+Dan\s+Kode\s+Produk|Product name and code/i.test(candidate.textContent));
  if (!table) return [];
  const candidates = [];
  for (const row of root.querySelectorAll('#productRequest #tableSP tbody tr')) {
    const cells = [...row.cells].map(cell => cell.textContent.replace(/\s+/g, ' ').trim());
    // The server's requested-product table exposes separate product name/code columns.
    const headers = [...row.closest('table').querySelectorAll('thead th')].map(cell => cell.textContent.trim().toLowerCase());
    const nameIndex = headers.findIndex(text => /^(?:product name|nama produk)$/.test(text));
    const codeIndex = headers.findIndex(text => /^(?:product code|produk code|kode produk)$/.test(text));
    if (nameIndex >= 0 && codeIndex >= 0 && cells[nameIndex] && cells[codeIndex]) candidates.push({ name: cells[nameIndex], code: cells[codeIndex] });
  }
  const header = [...table.querySelectorAll('tr')].find(row => /Nama\s+Dan\s+Kode\s+Produk|Product name and code/i.test(row.textContent));
  const index = [...(header?.cells || [])].findIndex(cell => /Nama\s+Dan\s+Kode\s+Produk|Product name and code/i.test(cell.textContent));
  if (index < 0) return [];
  return [...table.querySelectorAll('tr')].filter(row => row !== header && row.querySelector('td')).flatMap(row => {
    const text = row.cells[index]?.textContent.replace(/\s+/g, ' ').trim();
    if (!text || row.cells.length <= index + 1) return [];
    const matches = candidates.filter(item => `${item.name} ${item.code}` === text);
    return [matches.length === 1 ? matches[0] : splitCode ? splitIssuedProduct(text) : { name: text, code: null }];
  });
}

/** The portal loads its separate product-code columns through this read-only lookup. */
export async function readSampleProducts(url, signal, options) {
  return withPortalRead(readText => readSampleRecord(url, signal, { ...options, readText }), { ...options, signal, url });
}

async function readSampleRecord(url, signal, { readText, priority }) {
  const root = await readDetail(url, signal, { readText, priority });
  let requested = requestedProducts(root);
  let requestedComplete = requested.length > 0;
  const id = new URL(url).searchParams.get('id');
  const type = Number(new URL(url).searchParams.get('srtype'));
  const result = (archive = true) => {
    if (archive) rememberOfflineDetail(url,root,detailSources.get(root));
    const issued = issuedProducts(root, Number.isInteger(type) && type > 1);
    return { products: mergeProducts(requested, issued, { includeRequested: hasRequestedProducts(type) }), requestedCount: requestedComplete ? requested.length : null, providedCount: issued.length };
  };
  const table = root.querySelector('#productRequest #tableSP');
  if (!/^\d+$/.test(id || '') || !table || ![1, 4].includes(type)) return result();
  try {
    const html = await readText(`${PORTAL_ORIGIN}/islandsun/Samplerequest/getProdukUsageRND`, {
      method: 'POST', signal,
      requestNumber: requestNumber(url),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
      body: new URLSearchParams({ idsrf: id, jenis_hidden: '' }),
    });
    const fragment = new DOMParser().parseFromString(`<table><tbody>${html}</tbody></table>`, 'text/html');
    detailSources.get(root).supplementary = html;
    const body = table.tBodies[0] || table.createTBody();
    body.replaceChildren(...[...fragment.querySelectorAll('tbody > tr')].map(row => root.importNode(row, true)));
    requested = requestedProducts(root);
    requestedComplete = requested.length > 0;
    return result();
  } catch (error) {
    if (error.name === 'AbortError' || error.code === 'PORTAL_EDITOR_OPEN') throw error;
    // Issued names remain useful even when the supplementary code lookup is unavailable.
    return result(false);
  }
}

export function requestedProducts(root) {
  // Special, Duplication, and Improvement Special store the original request
  // separately from R&D's product confirmation/editing cart.
  const originalName = root.querySelector('#nameofproduct')?.value?.trim();
  if (originalName) return [splitRequestedProduct(originalName)];
  const table = root.querySelector('#productRequest #tableSP');
  if (!table) return [];
  const headers = [...table.querySelectorAll('thead th')].map(cell => cell.textContent.trim().toLowerCase());
  const name = headers.findIndex(text => /^(?:product name|nama produk)$/.test(text));
  const code = headers.findIndex(text => /^(?:product code|produk code|kode produk)$/.test(text));
  if (name < 0) return [];
  return [...table.querySelectorAll('tbody tr')].flatMap(row => {
    const value = cell => cell?.querySelector('input:not([type="hidden"]),textarea,select')?.value || cell?.textContent.replace(/\s+/g, ' ').trim();
    const label = value(row.cells[name]);
    return label ? [{ name: label, code: value(row.cells[code]) || null }] : [];
  });
}

export async function readIssuedProducts(url, signal) {
  return (await readSampleProducts(url, signal)).products.filter(product => !product.requested);
}
