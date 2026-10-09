import { PORTAL_HOME } from './offline-config.js';

export const PRINT_LOGO = `${PORTAL_HOME}assets/print/img/islandsun%20semarang.png`;
const TAGS = new Set(['DIV','P','SPAN','BR','STRONG','B','EM','I','H3','H4','H5','TABLE','THEAD','TBODY','TFOOT','TR','TD','TH','LABEL','SMALL']);
const CLASSES = /^(?:container|row|col|col-(?:md-)?(?:[1-9]|1[0-2])|table|table-bordered|table-condensed|table-responsive|text-center|text-right|merah|checkbox)$/;
const clean = value => String(value || '').replace(/\s+/g,' ').trim();

/** Only native order-sheet links belonging to this Delivery Order can be archived. */
export function deliveryPrintUrl(value, deliveryId) {
  try {
    const url = new URL(value,PORTAL_HOME);
    const match = url.pathname.match(/^\/islandsun\/NewDo\/printSoLogistic\/(\d+)\/(\d+)$/);
    return url.origin === new URL(PORTAL_HOME).origin && !url.username && !url.password && !url.search && !url.hash && match?.[2] === String(deliveryId) ? url.href : null;
  } catch { return null; }
}

export function deliveryPrintLinks(root,url) {
  const id = new URL(url).pathname.match(/^\/islandsun\/NewDo\/detailDO\/(\d+)$/i)?.[1];
  if (!id) return [];
  const links = new Map();
  for (const anchor of root.querySelectorAll('.content-wrapper a[href]')) {
    const href = deliveryPrintUrl(anchor.getAttribute('href'),id);
    const number = clean(anchor.textContent);
    if (href && number) links.set(href,{url:href,label:`Order sheet · ${number}`,number,format:'delivery-order-sheet'});
  }
  return [...links.values()];
}

/** Rebuild a passive sheet from known tags, classes and spans; no source attributes survive. */
export function parseOrderSheet(html,documentLink,deliveryId,logo) {
  if (!deliveryPrintUrl(documentLink.url,deliveryId) || !clean(documentLink.number)) throw new Error('This order sheet does not match the Delivery Order.');
  const source = new DOMParser().parseFromString(html,'text/html');
  const sheet = source.querySelector('body > .container');
  const number = clean(sheet?.querySelector('h5')?.textContent).replace(/^No\.\s*:\s*/i,'');
  if (!sheet || number !== clean(documentLink.number) || clean(sheet.querySelector('h3')?.textContent) !== 'SURAT PESANAN BARANG' || !sheet.querySelector('table')) throw new Error('The portal returned a different page instead of the order sheet.');
  if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(logo)) throw new Error('The order sheet logo is unavailable.');
  return {markup:copyPrintSheet(sheet,documentLink.url,logo),number};
}

/** Preserve printable content while excluding scripts, controls and remote dependencies. */
export function copyPrintSheet(sheet,url,logo = null) {
  const output = document.implementation.createHTMLDocument('Saved order sheet');
  function copy(node) {
    if (node.nodeType === Node.TEXT_NODE) return output.createTextNode(node.textContent);
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    if (node.tagName === 'IMG') {
      if (!logo || new URL(node.getAttribute('src'),url).href !== PRINT_LOGO) return null;
      const image = output.createElement('img'); image.src = logo; image.alt = 'Islandsun Indonesia'; return image;
    }
    if (!TAGS.has(node.tagName)) return null;
    const result = output.createElement(node.tagName.toLowerCase());
    const classes = [...node.classList].filter(name => CLASSES.test(name));
    if (node.tagName === 'SPAN' && node.style.textDecoration.includes('underline')) classes.push('sheet-underlined');
    if (node.tagName === 'P' && /^(FRM-SLS-02-02|Rev:\s*00)$/.test(clean(node.textContent))) classes.push('sheet-revision');
    if (node.style.margin === '0px') classes.push('sheet-no-margin');
    if (node.style.fontSize === '13px') classes.push('sheet-small-text');
    if (node.style.fontSize === '18px') classes.push('sheet-section-title');
    if (classes.length) result.className = classes.join(' ');
    if (['TD','TH'].includes(node.tagName)) {
      for (const attribute of ['rowspan','colspan']) {
        const span = Number(node.getAttribute(attribute));
        if (Number.isInteger(span) && span > 0 && span <= (attribute === 'rowspan' ? 65534 : 1000)) result.setAttribute(attribute,String(span));
      }
    }
    for (const child of node.childNodes) { const safe = copy(child); if (safe) result.append(safe); }
    return result;
  }
  return copy(sheet).outerHTML;
}

/** A downloaded sheet embeds its local stylesheet and logo so it has no network dependencies. */
export function orderSheetFile(sheet,css,savedAt) {
  return printSheetFile(sheet,css,savedAt,'order sheet','Order sheet');
}

export function printSheetFile(sheet,css,savedAt,label,filenamePrefix) {
  const escape = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const heading = `Saved ${label} · ${sheet.number}`;
  const markup = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; object-src 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(heading)}</title><style>${css.replace(/<\/style/gi,'')}</style></head><body><aside class="saved-notice">Saved offline copy · Read only · ${escape(new Date(savedAt).toISOString())} · Use your browser’s Print command to print or save as PDF.</aside>${sheet.markup}</body></html>`;
  return {blob:new Blob([markup],{type:'text/html;charset=utf-8'}),filename:`${filenamePrefix} ${sheet.number.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'-')}.html`};
}
