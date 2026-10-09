export const PORTAL_ORIGIN = 'http://apps.islandsunindonesia.com:81';
export const LOGIN_URL = `${PORTAL_ORIGIN}/islandsun/login`;

export function portalUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === PORTAL_ORIGIN && !url.username && !url.password && url.pathname.startsWith('/islandsun/') ? url : null;
  } catch { return null; }
}

export function downloadUrl(value) {
  const url = portalUrl(value);
  return url && /^\/islandsun\/master\/tir\/dowloadFileTir\/\d+\/?$/i.test(url.pathname) ? url.href : null;
}

export function documentParts(label) {
  const text = String(label ?? '').replace(/\s+/g, ' ').trim();
  if (!text.endsWith(')')) return null;
  let depth = 0, start = -1;
  for (let index = text.length - 1; index >= 0; index--) {
    if (text[index] === ')') depth++;
    if (text[index] === '(' && --depth === 0) { start = index; break; }
  }
  if (start < 1) return null;
  const product = text.slice(start + 1, -1), slash = product.lastIndexOf('/');
  if (slash < 1) return null;
  const document = text.slice(0, start).trim().replace(/\bSpesification\b/gi, 'Specification');
  const name = product.slice(0, slash).trim(), code = product.slice(slash + 1).trim();
  return document && name && code ? { document, name, code } : null;
}

export function sanitizeFilename(value) {
  let text = String(value).normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '');
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(text)) text = `_${text}`;
  return text;
}

export function documentFilename(label, original = '', mime = '') {
  const parts = documentParts(label);
  if (!parts) return null;
  const extensions = { 'application/pdf': 'pdf', 'application/zip': 'zip', 'application/x-rar-compressed': 'rar', 'application/vnd.rar': 'rar', 'application/x-7z-compressed': '7z', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx' };
  const extension = String(original).match(/\.([a-z0-9]{1,12})$/i)?.[1] || extensions[mime.split(';')[0]];
  let stem = sanitizeFilename(`${parts.document} - ${parts.name} ${parts.code}`);
  while (new TextEncoder().encode(stem).length > 190) stem = [...stem].slice(0, -1).join('');
  stem = stem.replace(/[. ]+$/g, '');
  return stem ? `${stem}${extension ? `.${extension}` : ''}` : null;
}

export function dispositionFilename(value) {
  const text = String(value || '');
  const encoded = text.match(/(?:^|;)\s*filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
  if (encoded) { try { return decodeURIComponent(encoded.trim()); } catch { /* Fall back to the regular filename parameter. */ } }
  return text.match(/(?:^|;)\s*filename\s*=\s*"([^"]*)"/i)?.[1] || text.match(/(?:^|;)\s*filename\s*=\s*([^;]+)/i)?.[1]?.trim() || '';
}

/** Fragments stay in the browser and coordinate naming without sending labels to the server. */
export function namedDownloadUrl(url, label) {
  const parsed = new URL(url);
  parsed.hash = `isi-document=${encodeURIComponent(label)}`;
  return parsed.href;
}

export function downloadLabel(url) {
  if (!downloadUrl(url)) return null;
  const hash = new URL(url).hash;
  if (!hash.startsWith('#isi-document=')) return null;
  try {
    const label = decodeURIComponent(hash.slice(14));
    return label.length < 5000 && documentParts(label) ? label : null;
  } catch { return null; }
}
