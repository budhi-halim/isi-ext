import { OFFLINE_SOURCES } from './offline-config.js';
import { visitRecords, readVisibleRecord } from './offline-store.js';
import { readDetailSource, readDocumentSource, readObservedTableSource, readFailedDocumentSource, readFailedDetailSource } from './offline-source-store.js';
import { readIndexSource } from './offline-index-source.js';

/** Export one account's local parser inputs without making network requests. */
export async function exportArchiveSources({account, kind, version, shouldContinue = () => true, onProgress = () => {}}) {
  if (!account || !Object.hasOwn(OFFLINE_SOURCES, kind)) throw new TypeError('Select a saved section.');
  const startedAt = new Date().toISOString();
  const parts = [];
  const counts = {records:0, sources:0, missing:0, failed:0};
  const check = () => {
    if (!shouldContinue()) throw new DOMException('Source export cancelled.', 'AbortError');
  };
  const append = value => parts.push(JSON.stringify(value) + '\n');
  append({type:'header', schema:1, purpose:'Portal archive source export', version, account, kind, startedAt,
    note:'Private business data. Local saved responses only; credentials are redacted at capture. Sources may be older than current parsed records. HTML is inert text, not executable content.'});
  for (const failed of [false,true]) {
    check();
    const format = failed ? 'failed-index-source' : 'index-source';
    try {
      const source = await readIndexSource(account,kind,failed);
      check();
      if (source) { append({type:'source',format,source}); counts.sources++; }
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      counts.failed++; append({type:'error',format,message:'Saved list response could not be read.'});
    }
  }
  await visitRecords(account, kind, async item => {
    check();
    const record = await readVisibleRecord(item.key, account, kind);
    if (!record) return;
    counts.records++;
    const targets = [];
    if (record.detailUrl) targets.push({format:'detail-source', url:record.detailUrl},{format:'failed-detail-source',optional:true});
    if (kind === 'sample') targets.push({format:'observed-table-source', optional:true});
    for (const document of record.detail?.documents || []) {
      targets.push({format:'failed-document-source',url:document.url,optional:true});
      if (['sample-request-sheet','delivery-order-sheet'].includes(document.format)) {
        targets.push({format:'document-source', url:document.url});
      }
    }
    for (const target of targets) {
      check();
      try {
        const source = target.format === 'detail-source'
          ? await readDetailSource(record.key, account, kind)
          : target.format === 'failed-detail-source' ? await readFailedDetailSource(record.key,account,kind)
          : target.format === 'observed-table-source' ? await readObservedTableSource(record.key, account, kind)
            : target.format === 'failed-document-source' ? await readFailedDocumentSource(record.key,account,kind,target.url)
            : await readDocumentSource(record.key, account, kind, target.url);
        check();
        if (!source) { if (!target.optional) counts.missing++; continue; }
        append({type:'source', format:target.format,
          record:{id:record.id, number:record.number, date:record.date, fingerprint:record.fingerprint, detailAt:record.detailAt ?? null},
          source, parsed:record.detail ?? null});
        counts.sources++;
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        counts.failed++;
        append({type:'error', id:record.id, format:target.format, message:'Saved source could not be read.'});
      }
    }
    onProgress({...counts});
  }, {readableOnly:true, details:false, shouldContinue});
  check();
  append({type:'summary', ...counts, completedAt:new Date().toISOString()});
  const stream = new Blob(parts).stream().pipeThrough(new CompressionStream('gzip'));
  const blob = await new Response(stream).blob();
  check();
  return {blob, counts, filename:`islandsun-sources-${kind}-${startedAt.replace(/:/g,'-')}.jsonl.gz`};
}
