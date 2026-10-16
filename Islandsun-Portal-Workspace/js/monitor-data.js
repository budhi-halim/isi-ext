import { PORTAL_ORIGIN } from './shared/document-names.js';
export { documentReadiness } from './document-readiness.js';
import { requestDetailUrl, tirDetailUrl, sampleType } from './logic.js';
import { readPortalText } from './portal-request.js';
import { rememberRequestNumber } from './request-log.js';
import { ACCOUNT_SCOPE } from './account-scope.js';
import { PREVIEW_FRESH_MS } from './fetch-policy.js';
import { invalidIndexIdentity } from './offline-index-identity.js';

const SOURCES = { tir: `${PORTAL_ORIGIN}/islandsun/master/Tir/json`, sample: `${PORTAL_ORIGIN}/islandsun/samplerequest/json` };

/** These GET endpoints are also used by the family's read-only database writer. */
export async function readMonitorIndex(kind, signal, accountName) {
  const observedAt = Date.now();
  const before = (await chrome.storage.local.get(ACCOUNT_SCOPE))[ACCOUNT_SCOPE];
  const text = await readPortalText(SOURCES[kind], { signal, cache: 'no-store', purpose:'warmup', reason:'index' });
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('unavailable'); }
  if (!Array.isArray(data.data) || Number(data.recordsFiltered) !== data.data.length) throw new Error('incomplete-index');
  const scope = (await chrome.storage.local.get(ACCOUNT_SCOPE))[ACCOUNT_SCOPE];
  if (scope?.account !== before?.account) throw new DOMException('Account changed.','AbortError');
  if (scope?.account) await chrome.runtime.sendMessage({type:'offline-observed-index',account:scope.account,kind,text,observedAt}).catch(() => {});
  return data.data.flatMap(row => {
    const owner = kind === 'tir' ? row.pic : row.sr_pic;
    // Server roles can expose wider lists; reminders belong to the active salesperson.
    if (!accountName || String(owner || '').trim().toLowerCase() !== accountName.trim().toLowerCase()) return [];
    if (kind === 'tir') {
      const url = tirDetailUrl(row.id_tir);
      if (!url || invalidIndexIdentity(kind,String(row.id_tir),String(row.tir_no))) return [];
      return [{ kind, account:scope?.account, id: String(row.id_tir), number: String(row.tir_no), date: String(row.date_tir), status: String(row.stat), customer:String(row.customer || ''), url }];
    }
    const url = requestDetailUrl(row.sr_id, sampleType(row.sr_srtype));
    if (!url || invalidIndexIdentity(kind,String(row.sr_id),String(row.sr_no))) return [];
    return [{ kind, id: String(row.sr_id), number: String(row.sr_no), date: String(row.sr_date), status: String(row.sr_status), feedbackStatus:String(row.sr_statfeedback || ''), deliveryStatus:String(row.sr_statkirimbarang || ''), customer:String(row.sr_customer || ''), url }];
  });
}

export async function readMonitoredRecord(record, repository, signal, options = {}) {
  rememberRequestNumber(record.url, record.number);
  // Historical notification discovery must not evict the three pages reserved for previews.
  const request = {signal,purpose:'notification',cacheResult:options.purpose === 'warmup',...options};
  if (record.kind === 'sample') {
    const result = await repository.get(record.url, request);
    return { ...record, requestedCount: result.requestedCount, providedCount: result.providedCount };
  }
  let result = await repository.get(record.url, {maxAge:PREVIEW_FRESH_MS,...request});
  // Older session entries contain only preview products.
  if (!Array.isArray(result.documents)) result = await repository.get(record.url, {...request,fresh:true});
  const documents = result.documents || [];
  if (!documents.length) throw new Error('documents-unavailable');
  return { ...record, documents };
}
