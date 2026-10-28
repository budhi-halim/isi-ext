import { portalOrigin, rebasePortalUrl } from './shared/portal-address.js';
import { PORTAL_HOME } from './offline-config.js';
import { copyPrintSheet, printSheetFile } from './offline-print.js';

const clean = value => String(value || '').replace(/\s+/g,' ').trim();
const REQUEST_NUMBER = /^\d+\/[IVXLCDM]+\/\d{4}\/SRF$/i;
const SHEET_TITLES = new Set(['SAMPLE REQUEST FORM', 'NEW PRODUCT DEVELOPMENT REQUEST FORM']);

/** Accept only the native print link for the exact saved sample and request type. */
export function samplePrintUrl(value,detailUrl) {
  try {
    const detail = new URL(detailUrl,PORTAL_HOME), target = new URL(rebasePortalUrl(new URL(value,detail).href, detail.origin));
    const id = detail.searchParams.get('id'), type = detail.searchParams.get('srtype');
    if (!portalOrigin(detail.href) || !/^\/islandsun\/(?:index\.php\/)?samplerequest\/edit$/i.test(detail.pathname)
      || !/^\d+$/.test(id) || !/^[1-5]$/.test(type)) return null;
    return target.origin === detail.origin && !target.username && !target.password && !target.search && !target.hash
      && target.pathname === `/islandsun/Samplerequest/PrintPdfSampleRequest/${id}/${type}` ? target.href : null;
  } catch { return null; }
}

export function samplePrintLinks(root,detailUrl) {
  const markers = [...root.querySelectorAll('.content-wrapper b,.content-wrapper strong')]
    .filter(node => !node.closest('form,.modal'))
    .map(node => clean(node.textContent).match(/^NO\s+SRF\s*:\s*(\d+\/[IVXLCDM]+\/\d{4}\/SRF)$/i)?.[1]).filter(Boolean);
  const numbers = [...new Set(markers)];
  if (numbers.length !== 1) return [];
  const links = new Map();
  for (const anchor of root.querySelectorAll('.content-wrapper a[href]')) {
    const url = samplePrintUrl(anchor.getAttribute('href'),detailUrl);
    if (url) links.set(url,{url,number:numbers[0],label:`Sample request sheet · ${numbers[0]}`,format:'sample-request-sheet'});
  }
  return [...links.values()];
}

function sampleSheetRoot(html,documentLink,record) {
  if (record.kind !== 'sample' || !samplePrintUrl(documentLink.url,record.detailUrl) || !REQUEST_NUMBER.test(record.number)
    || documentLink.number !== record.number) throw new Error('This print sheet does not match the Sample Request.');
  const source = new DOMParser().parseFromString(html,'text/html');
  const sheet = source.querySelector('body > .container');
  const heading = sheet?.querySelector('h3');
  const identity = heading?.parentElement.querySelector('p');
  const identityText = [...identity?.childNodes || []].map(node => node.textContent).join(' ');
  const number = clean(identityText).match(/^No\.?\s+(\d+\/[IVXLCDM]+\/\d{4}\/SRF)(?:\s|$)/i)?.[1];
  if (!sheet || !SHEET_TITLES.has(clean(heading?.textContent)) || number !== record.number || !sheet.querySelector('table')) {
    throw new Error('The portal returned a different page instead of the sample sheet.');
  }
  return sheet;
}

/** Reject login pages or mismatched sheets before producing a passive offline document. */
export function parseSampleSheet(html,documentLink,record) {
  return {markup:copyPrintSheet(sampleSheetRoot(html,documentLink,record),documentLink.url),number:record.number};
}

/** Read only the explicit product, quantity and description table from the matching sheet. */
export function parseSampleConfirmationSheet(html,documentLink,record) {
  const root = sampleSheetRoot(html,documentLink,record);
  const candidates = [];
  for (const table of root.querySelectorAll('table')) {
    const rows = [...table.rows].filter(row => row.closest('table') === table);
    const headings = [...rows[0]?.cells || []].map(cell => clean(cell.textContent));
    const index = pattern => headings.findIndex(label => pattern.test(label));
    const code = index(/^(?:Produk|Product) Code$/i), quantity = index(/^Sample QTY$/i);
    const description = index(/^(?:Desription|Description)$/i);
    if (code < 0 || quantity < 0 || description < 0) continue;
    if (rows.some(row => row.cells.length !== headings.length || [...row.cells].some(cell => cell.colSpan !== 1 || cell.rowSpan !== 1))) continue;
    candidates.push(rows.slice(1).map(row => ({code:clean(row.cells[code].textContent),
      quantity:clean(row.cells[quantity].textContent),description:clean(row.cells[description].textContent)})));
  }
  return candidates.length === 1 ? candidates[0] : [];
}

export function sampleSheetFile(sheet,css,savedAt) {
  return printSheetFile(sheet,css,savedAt,'sample request sheet','Sample request');
}
