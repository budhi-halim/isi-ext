import { readVisibleRecord, recordFiles, saveFile } from './offline-store.js';
import { capturedText, captureResponseBody, responseHeaders } from './debug-capture-data.js';

export const DETAIL_SOURCE_URL = 'urn:islandsun:archive-source:detail';
export const FAILED_DETAIL_SOURCE_URL = 'urn:islandsun:archive-source:failed-detail';
export const OBSERVED_TABLE_SOURCE_URL = 'urn:islandsun:archive-source:observed-confirmation';

/** Retain native DOM evidence without promoting session-cart data into a verified detail. */
export async function saveObservedTableSource(record, html, observedAt) {
  return Boolean(await saveSource(record, {html, supplementary:null, url:record.detailUrl,
    key:OBSERVED_TABLE_SOURCE_URL, format:'observed-table-source',
    provenance:{method:'native-view-dom', table:'res-cartprod', observedAt, recordOwnershipVerified:false}}));
}

export const documentSourceKey = url => `urn:islandsun:archive-source:document:${url}`;
export const failedDocumentSourceKey = url => `urn:islandsun:archive-source:failed-document:${url}`;

/** Keep the most recent HTTP failure separate from successful source and document bytes. */
export async function saveFailedDocumentSource(record, document, response, signal) {
  return saveFailedSource(record,{url:document.url,key:failedDocumentSourceKey(document.url),format:'failed-document-source'},response,signal);
}

/** A failed read is diagnostic evidence, never a replacement for a usable detail. */
export async function saveFailedDetailSource(record, response, signal) {
  return saveFailedSource(record,{url:record.detailUrl,key:FAILED_DETAIL_SOURCE_URL,format:'failed-detail-source'},response,signal);
}

async function saveFailedSource(record, target, response, signal) {
  signal?.throwIfAborted();
  if (response.status < 400 || [401,403].includes(response.status)) return false;
  const captured = await captureResponseBody(response);
  signal?.throwIfAborted();
  return Boolean(await saveSource(record,{...target,html:captured.text ?? '',supplementary:null,
    provenance:{method:'failed-http-response',status:response.status,headers:responseHeaders(response.headers),
      bytes:captured.bytes,truncated:captured.truncated,redactions:captured.redactions || 0,omitted:captured.omitted || (captured.text === undefined ? 'non-text-body' : null),
      errorType:captured.errorType || null}},signal));
}

/** Retain an inert encrypted source and return its capture time, or false if it was rejected. */
export async function saveDetailSource(record, {html, supplementary = null, capturedAt}, signal) {
  return saveSource(record, {html, supplementary, capturedAt, url:record.detailUrl, key:DETAIL_SOURCE_URL, format:'detail-source'}, signal);
}

/** Retain a fetched print response before parsing without exposing it as a saved document. */
export async function saveDocumentSource(record, document, html, signal) {
  if (!['sample-request-sheet','delivery-order-sheet'].includes(document.format)) throw new TypeError('Unknown print source format.');
  return Boolean(await saveSource(record, {html, supplementary:null, url:document.url, key:documentSourceKey(document.url), format:'document-source'}, signal));
}

async function saveSource(record, {html, supplementary, url, key, format, provenance, capturedAt = provenance?.observedAt ?? Date.now()}, signal) {
  signal?.throwIfAborted();
  const current = await readVisibleRecord(record.key, record.account, record.kind);
  if (!current || current.detailUrl !== record.detailUrl || current.fingerprint !== record.fingerprint) return false;
  if (['document-source','failed-document-source'].includes(format) && !current.detail?.documents?.some(document => document.url === url)) return false;
  if (typeof html !== 'string' || supplementary !== null && typeof supplementary !== 'string') {
    throw new TypeError('The saved detail source must contain text responses.');
  }
  const main = capturedText(html);
  const extra = supplementary === null ? null : capturedText(supplementary);
  if (main.omitted || extra?.omitted) return false;
  const source = {
    schema: 1,
    kind: record.kind,
    id: record.id,
    url,
    fingerprint: record.fingerprint,
    capturedAt,
    ...(provenance ? {provenance} : {}),
    html: main.text,
    supplementary: extra?.text ?? null,
    redactions: main.redactions + (extra?.redactions || 0),
    omittedForms: main.omittedForms || [],
  };
  const stream = new Blob([JSON.stringify(source)]).stream().pipeThrough(new CompressionStream('gzip'));
  const blob = new Blob([await new Response(stream).arrayBuffer()], {type: 'application/gzip'});
  signal?.throwIfAborted();
  const saved = await saveFile(record, {url:key, purpose:'source', format, savedAt:capturedAt, blob});
  return saved ? capturedAt : false;
}

/** Source bytes are for local parser replay, never navigation or HTML rendering. */
export async function readDetailSource(key, account, kind) {
  return readSource(key, account, kind);
}

export async function readFailedDetailSource(key, account, kind) {
  return readSource(key,account,kind,undefined,FAILED_DETAIL_SOURCE_URL);
}

export async function readDocumentSource(key, account, kind, url) {
  return readSource(key, account, kind, url);
}

export async function readFailedDocumentSource(key, account, kind, url) {
  return readSource(key,account,kind,url,failedDocumentSourceKey(url));
}

export async function readObservedTableSource(key, account, kind) {
  return readSource(key, account, kind, undefined, OBSERVED_TABLE_SOURCE_URL);
}

async function readSource(key, account, kind, documentUrl, overrideKey) {
  const record = await readVisibleRecord(key, account, kind);
  if (!record) return null;
  if (documentUrl && !record.detail?.documents?.some(document => document.url === documentUrl)) return null;
  const sourceKey = overrideKey || (documentUrl ? documentSourceKey(documentUrl) : DETAIL_SOURCE_URL);
  const file = (await recordFiles(key, {purpose: 'source'})).find(file => file.url === sourceKey);
  if (!file?.blob) return null;
  const stream = file.blob.stream().pipeThrough(new DecompressionStream('gzip'));
  const source = JSON.parse(await new Response(stream).text());
  if (source.schema !== 1 || source.id !== record.id || source.kind !== kind || source.url !== (documentUrl || record.detailUrl)
    || typeof source.html !== 'string' || source.supplementary !== null && typeof source.supplementary !== 'string') {
    throw new Error('The saved source does not match this record.');
  }
  return {...source, matchesCurrentList: source.fingerprint === record.fingerprint};
}
