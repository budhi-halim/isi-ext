import { businessDate, PORTAL_HOME } from './offline-config.js';

/** The availability list decorates the number with its separate customer-code field. */
export function availabilityRequestNumber(number, customerCode) {
  const value = String(number ?? '').trim(), code = String(customerCode ?? '').trim();
  const prefix = code ? `${code} - ` : '- ';
  return value.startsWith(prefix) ? value.slice(prefix.length).trim() : value;
}

/** A source ID can occur in both internal and handover rows. */
export function availabilityIdentity(row) {
  const source = String(row.jenis || ''), id = String(row.isrd_id ?? '');
  const handover = row.stbjd_id == null ? '' : String(row.stbjd_id);
  if (!['internal','serah_terima'].includes(source) || !/^\d+$/.test(id) || handover && !/^\d+$/.test(handover)) {
    throw new Error('The product availability record identifier was not recognized.');
  }
  if (source === 'serah_terima' && !handover) throw new Error('The handover record identifier is missing.');
  return {id:JSON.stringify([source,id,handover]),detailUrl:`${PORTAL_HOME}daftar_kiriman_barang/getDetailCalendar/${id}/${source}`};
}

/** Use a unique, account-visible request date; ETA and handover dates are different facts. */
export function availabilityRequestDate(number, requests) {
  const record = requests.get(number);
  const date = record && businessDate(record.date);
  if (!date || !/^\d+$/.test(record.id)) return null;
  return {date,stockId:record.id};
}
