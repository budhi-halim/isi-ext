import { PORTAL_ORIGIN } from './shared/document-names.js';

export function tirSourceUrl(type, id) {
  const endpoint = { 'Sample Request': 'getprd', 'Stock Request': 'getprdStok' }[type];
  return endpoint && /^[1-9]\d{0,11}$/.test(String(id))
    ? `${PORTAL_ORIGIN}/islandsun/master/Tir/${endpoint}//${id}` : null;
}

export function isTirSourceUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === PORTAL_ORIGIN && !url.search && !url.hash
      && /^\/islandsun\/master\/Tir\/(?:getprd|getprdStok)\/\/[1-9]\d{0,11}$/.test(url.pathname);
  } catch { return false; }
}

export function sourceProduct(label) {
  const text = String(label || '').replace(/\s+/g, ' ').trim();
  const separator = [...text.matchAll(/\s\/\s*/g)].at(-1);
  if (!text) return null;
  return separator?.index > 0 ? { name: text.slice(0, separator.index).trim(), code: text.slice(separator.index + separator[0].length).replace(/\s*\(Code Cust:[^)]*\)\s*$/i, '').trim() || null }
    : { name: text, code: null };
}
