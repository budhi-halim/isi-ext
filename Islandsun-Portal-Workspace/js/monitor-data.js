import { PORTAL_ORIGIN } from './shared/document-names.js';
export { documentReadiness } from './document-readiness.js';
import { requestDetailUrl, tirDetailUrl, sampleType } from './logic.js';
import { readPortalText } from './portal-request.js';
import { rememberRequestNumber } from './request-log.js';

const SOURCES = { tir: `${PORTAL_ORIGIN}/islandsun/master/Tir/json`, sample: `${PORTAL_ORIGIN}/islandsun/samplerequest/json` };

/** These GET endpoints are also used by the family's read-only database writer. */
export async function readMonitorIndex(kind, signal, accountName) {
  const text = await readPortalText(SOURCES[kind], { signal, cache: 'no-store' });
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('unavailable'); }
  if (!Array.isArray(data.data) || Number(data.recordsFiltered) !== data.data.length) throw new Error('incomplete-index');
  return data.data.flatMap(row => {
    const owner = kind === 'tir' ? row.pic : row.sr_pic;
    // Server roles can expose wider lists; reminders belong to the active salesperson.
    if (!accountName || String(owner || '').trim().toLowerCase() !== accountName.trim().toLowerCase()) return [];
    if (kind === 'tir') {
      const url = tirDetailUrl(row.id_tir);
      if (!url) return [];
      return [{ kind, id: String(row.id_tir), number: String(row.tir_no), date: String(row.date_tir), status: String(row.stat), url }];
    }
    const url = requestDetailUrl(row.sr_id, sampleType(row.sr_srtype));
    if (!url) return [];
    return [{ kind, id: String(row.sr_id), number: String(row.sr_no), date: String(row.sr_date), status: String(row.sr_status), url }];
  });
}

export async function readMonitoredRecord(record, repository, signal) {
  rememberRequestNumber(record.url, record.number);
  if (record.kind === 'sample') {
    const result = await repository.get(record.url, { signal });
    return { ...record, requestedCount: result.requestedCount, providedCount: result.providedCount };
  }
  let result = await repository.get(record.url, { signal, maxAge: 15000 });
  // Older session entries contain only preview products.
  if (!Array.isArray(result.documents)) result = await repository.get(record.url, { signal, fresh: true });
  const documents = result.documents || [];
  if (!documents.length) throw new Error('documents-unavailable');
  return { ...record, documents };
}
