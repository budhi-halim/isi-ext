import { visitRecords } from './offline-store.js';
import { plainValue } from './offline-parser.js';
import { availabilityIdentity, availabilityRequestDate, availabilityRequestNumber } from './offline-logistics.js';

/** Join only the requested numbers without retaining a second full Stock Request list. */
export async function resolveAvailabilityDates(account,payload,shouldContinue) {
  if (!Array.isArray(payload?.data)) throw new Error('The product availability list was not recognized.');
  const requestNumber = row => availabilityRequestNumber(plainValue(row?.srs_no),plainValue(row?.c_kode));
  const wanted = new Set(payload.data.map(requestNumber)), requests = new Map();
  await visitRecords(account,'stock',record => {
    const number = record.fields.srs_no;
    if (!wanted.has(number)) return;
    requests.set(number,requests.has(number) ? null : {id:record.id,date:record.date});
  },{details:false,readableOnly:true,shouldContinue});
  return {...payload,data:payload.data.map(row => {
    let identity;
    try { identity = availabilityIdentity(row); }
    catch { return {...row,availability_id:''}; }
    const request = availabilityRequestDate(requestNumber(row),requests);
    return {...row,availability_id:identity.id,entry_date:request?.date || '',source_stock_id:request?.stockId || '',source_date_pending:!request,
      source_type:row.jenis === 'serah_terima' ? 'Handover' : 'Internal'};
  })};
}

/** Preserve duplicate source rows without treating display positions or SO lookup IDs as record IDs. */
export async function resolveStockRows(account,rows,shouldContinue = () => true) {
  const wanted = new Set(rows.map(row => row.srs_no)), requests = new Map(), occurrences = new Map();
  await visitRecords(account,'stock',record => {
    const number = record.fields.srs_no;
    if (wanted.has(number)) requests.set(number,requests.has(number) ? null : {id:record.id,date:record.date});
  },{details:false,readableOnly:true,shouldContinue});
  const result = [];
  for (const row of rows) {
    if (!shouldContinue()) throw new DOMException('Archive paused.','AbortError');
    const bytes = new TextEncoder().encode(JSON.stringify(row));
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value => value.toString(16).padStart(2,'0')).join('');
    const occurrence = occurrences.get(hash) || 0; occurrences.set(hash,occurrence+1);
    const request = availabilityRequestDate(row.srs_no,requests);
    result.push({...row,snapshot_id:`${hash}:${occurrence}`,entry_date:request?.date || '',source_stock_id:request?.stockId || '',source_date_pending:!request});
  }
  return result;
}
