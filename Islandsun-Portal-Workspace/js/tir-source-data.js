import { isTirSourceUrl, sourceProduct } from './tir-source-logic.js';
import { readPortalText } from './portal-request.js';
import { readDetail } from './portal-data.js';
import { documentReadiness } from './document-readiness.js';

export function parseTirProducts(html) {
  const root = new DOMParser().parseFromString(`<table><tbody>${html}</tbody></table>`, 'text/html');
  if (root.querySelector('input[type="password"],form.lockscreen-credentials')) throw new Error('Your session has expired. Sign in to Islandsun and try again.');
  return selectedTirProducts(root);
}

function selectedTirProducts(root) {
  const products = [];
  const keys = new Set();
  // Each source product has a catalog dropdown. Only its explicitly selected option belongs to this request.
  for (const option of root.querySelectorAll('select[name="tird_produk[]"] option[selected]')) {
    if (!/^[1-9]\d*$/.test(option.value)) continue;
    const product = sourceProduct(option.textContent);
    if (!product) continue;
    const key = JSON.stringify(product);
    if (!keys.has(key)) { keys.add(key); products.push(product); }
  }
  return { products };
}

export async function readTirRecordProducts(url, signal, options) {
  const root = await readDetail(url, signal, options);
  return { ...selectedTirProducts(root), documents: documentReadiness(root) };
}

export async function readTirSourceProducts(url, signal, { priority = true, purpose, readText = readPortalText } = {}) {
  if (!isTirSourceUrl(url)) throw new Error('This request link is unavailable.');
  const html = await readText(url, { signal, priority, purpose, editorLookup: url, maxBytes: 4 * 1024 * 1024 });
  return parseTirProducts(html);
}
