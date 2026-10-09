import { parseIdentity, normalizeIndex, parseDetail, parseAvailabilityDetail, parseHtmlIndex, parseHtmlRows, parseStockOrders } from './offline-parser.js';
import { saveRecords, archiveMeta, readArchive, reconcileRecords } from './offline-store.js';
import { PAGED_SOURCES, beginIndexScan, advanceIndexScan, verifyIndexScan } from './offline-pagination.js';
import { ARCHIVE_SCOPE_VERSION } from './offline-access.js';
import { resolveAvailabilityDates, resolveStockRows } from './offline-logistics-source.js';
import { HTML_SOURCES } from './offline-html-sources.js';
import { capturePeriod } from './offline-period-source.js';
import { parseOrderSheet } from './offline-print.js';
import { parseSampleSheet } from './offline-sample-print.js';
import { seedVaultKey } from './offline-vault.js';
import { includedIndexRows } from './offline-index-identity.js';
import { indexCompletion } from './offline-index-completion.js';
let generation = 0;

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.target !== 'offline-parser') return;
  if (sender.url !== chrome.runtime.getURL('js/background.js')) return;
  if (message.operation === 'cancel') { generation++; respond({result:true}); return; }
  const current = generation;
  (async () => {
    if (message.account) {
      if (!Array.isArray(message.vaultKey) || message.vaultKey.length !== 32 || !message.vaultKey.every(value => Number.isInteger(value) && value >= 0 && value <= 255)) throw new Error('The archive unlock key is unavailable.');
      seedVaultKey(message.account,message.vaultKey);
      delete message.vaultKey;
    }
    if (message.operation === 'identity') return parseIdentity(message.html);
    if (message.operation === 'order-sheet') return parseOrderSheet(message.html,message.documentLink,message.deliveryId,message.logo);
    if (message.operation === 'sample-sheet') return parseSampleSheet(message.html,message.documentLink,message.record);
    if (message.operation === 'html-period') return capturePeriod(message,() => current === generation);
    if (message.operation === 'availability-detail') return parseAvailabilityDetail(message.html,message.url,message.record);
    if (message.operation === 'stock-orders') return parseStockOrders(message.html,message.url,message.record);
    if (message.operation === 'detail') {
      if (parseIdentity(message.html)?.account !== message.account) throw new Error('The signed-in account changed. This detail was not archived.');
      return parseDetail(message.html, message.url, message.supplementary,message.record);
    }
    if (['index-page','index-head'].includes(message.operation)) {
      const source = PAGED_SOURCES[message.kind];
      if (!source) throw new Error('Unknown paginated archive source.');
      const key = `index:${message.account}:${message.kind}`;
      const previous = await readArchive('meta',key) || {};
      const scan = previous.scan?.scopeVersion === ARCHIVE_SCOPE_VERSION ? previous.scan : message.scan || beginIndexScan();
      if (scan.id !== message.scan?.id || scan.cursor !== message.scan?.cursor || !!scan.verify !== !!message.scan?.verify) throw new Error('The archive scan changed. This page was not accepted.');
      let payload = JSON.parse(message.text);
      if (message.kind === 'availability') payload = await resolveAvailabilityDates(message.account,payload,() => current === generation);
      const start = message.operation === 'index-head' || scan.verify ? 0 : Math.max(0,scan.cursor-1);
      const records = normalizeIndex(message.account,message.kind,payload,{partial:true,includeOmitted:true,start}).map(record => ({...record,scopeVersion:ARCHIVE_SCOPE_VERSION}));
      if (current !== generation) throw new DOMException('Archive paused.','AbortError');
      if (message.operation === 'index-head') {
        await advanceIndexScan(beginIndexScan(),records,payload,source.size);
        const same = await verifyIndexScan(scan,records,payload);
        await saveRecords(includedIndexRows(records).filter(record => !record.pendingDate),() => current === generation);
        if (current !== generation) throw new DOMException('Archive paused.','AbortError');
        await archiveMeta(key,{...previous,scan:{...scan,headCheckedAt:Date.now(),stable:scan.stable && same},attemptedAt:Date.now(),lastError:''});
        return {complete:false};
      }
      if (scan.verify) {
        const verified = await verifyIndexScan(scan,records,payload);
        const reconciled = verified && !scan.pendingDates && await reconcileRecords(message.account,message.kind,null,scan);
        if (current !== generation) throw new DOMException('Archive paused.','AbortError');
        await archiveMeta(key,{...indexCompletion(previous,{...scan,reconciled}),total:scan.total,stored:scan.stored,skippedIdentifiers:scan.skippedIdentifiers || 0,importing:false,partial:!reconciled,pendingDates:scan.pendingDates || 0,
          lastError:scan.pendingDates ? `${scan.pendingDates} availability records are waiting for their Stock Request dates. Existing records are retained.` : reconciled ? '' : 'The list changed during capture. Saved records are retained; another scan will follow.'});
        return {complete:true,reconciled};
      }
      const next = await advanceIndexScan(scan,records,payload,source.size);
      const stored = await saveRecords(includedIndexRows(next.records).filter(record => !record.pendingDate).map(record => ({...record,indexScan:scan.id})),() => current === generation);
      if (current !== generation) throw new DOMException('Archive paused.','AbortError');
      next.scan.stored += stored;
      next.scan.skippedIdentifiers = (scan.skippedIdentifiers || 0) + next.records.filter(record => record.omitted).length;
      next.scan.pendingDates = (scan.pendingDates || 0) + next.records.filter(record => record.pendingDate).length;
      await archiveMeta(key,{...previous,scan:next.scan,attemptedAt:Date.now(),total:next.scan.total,importing:true,partial:true,nextAttemptAt:0,lastError:''});
      return {complete:false,cursor:next.scan.cursor,total:next.scan.total,stored:next.scan.stored,skippedIdentifiers:next.scan.skippedIdentifiers};
    }
    let records;
    if (message.operation === 'html-index') {
      if (HTML_SOURCES[message.kind]?.requestDates) {
        const rows = parseHtmlRows(message.account,message.kind,message.html,message.url);
        const data = await resolveStockRows(message.account,rows,() => current === generation);
        records = normalizeIndex(message.account,message.kind,{data,recordsFiltered:data.length},{includeOmitted:true});
      } else records = parseHtmlIndex(message.account,message.kind,message.html,message.url,{includeOmitted:true});
      records = records.map(record => ({...record,scopeVersion:ARCHIVE_SCOPE_VERSION}));
    }
    else {
      if (message.operation !== 'index') throw new Error('Unknown archive operation.');
      if (message.kind !== 'products') throw new Error('Portal records require a verified signed-in list.');
      records = normalizeIndex(message.account,message.kind,JSON.parse(message.text),{includeOmitted:true});
    }
    const key = `index:${message.account}:${message.kind}`;
    const previous = await readArchive('meta',key);
    await archiveMeta(key,{...previous, importing:true, attemptedAt:Date.now()});
    // Newest records survive first if the browser reaches its storage quota mid-import.
    records.sort((a,b) => (b.date || '').localeCompare(a.date || ''));
    const pendingDates = records.filter(record => record.pendingDate).length;
    const included = includedIndexRows(records);
    const skippedIdentifiers = records.length - included.length;
    const stored = await saveRecords(included.filter(record => !record.pendingDate),() => current === generation);
    if (current !== generation) throw new DOMException('Archive paused.','AbortError');
    const reconciled = !pendingDates && await reconcileRecords(message.account,message.kind,included.map(record => record.key));
    if (current !== generation) throw new DOMException('Archive paused.','AbortError');
    await archiveMeta(key, {...indexCompletion(previous,{reconciled,total:records.length,stored,skippedIdentifiers}),
      total:records.length, stored, skippedIdentifiers, importing:false,partial:!reconciled,pendingDates});
    return {total:records.length, stored, skippedIdentifiers};
  })().finally(() => {
    if (message.account) seedVaultKey(message.account,null);
    delete message.vaultKey;
  }).then(result => respond({result}), error => respond({error:error.message}));
  return true;
});
