export const PREVIEW_FRESH_MS = 5 * 60000;
export const INDEX_FRESH_MS = 5 * 60000;
export const SOURCE_ORDER = Object.freeze(['sample','tir','stock','sales','delivery','returns','sudden','availability','products','stock-products','stock-outstanding','stock-history','stock-adjustment']);

export function recordKind(url) {
  const path = new URL(url,'http://apps.islandsunindonesia.com:81').pathname.toLowerCase();
  if (path.includes('/tir/getprdstok/')) return 'stock';
  if (path.includes('/tir/getprd/')) return 'sample';
  if (path.includes('samplerequest')) return 'sample';
  if (path.includes('/tir/')) return 'tir';
  if (path.includes('detail_complain')) return 'returns';
  if (path.includes('suddenrequest')) return 'sudden';
  if (/stock-?request|\/tir\/getsrs/.test(path)) return 'stock';
  if (/sales-?order/.test(path)) return 'sales';
  if (path.includes('newdo')) return 'delivery';
  return 'other';
}

export function readPriority(purpose, kind) {
  const tier = {native:6, hover:5, visible:4, warmup:3, notification:2, archive:1}[purpose] || 2;
  const rank = SOURCE_ORDER.indexOf(kind);
  return tier * 100 + (rank < 0 ? 0 : SOURCE_ORDER.length - rank);
}

export function statusSignature(record) {
  return [record.status, record.feedbackStatus, record.deliveryStatus].map(value => String(value || '').trim().toLowerCase()).join('|');
}
