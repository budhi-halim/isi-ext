import { sampleType } from './logic.js';

export function portalPath(value) {
  return value.replace(/^\/islandsun\/index\.php\//i, '/islandsun/').replace(/\/$/, '').toLowerCase();
}

export function saveContract(action, current) {
  const page = new URL(current), target = new URL(action, page);
  if (target.origin !== page.origin || target.search || target.hash) return null;
  const path = portalPath(target.pathname), route = portalPath(page.pathname);
  if (path === '/islandsun/master/tir/store' && route === '/islandsun/master/tir/create') return {kind:'tir', id:null};
  if (path === '/islandsun/master/tir/update') {
    const match = /^\/islandsun\/master\/tir\/edit\/([1-9]\d*)$/.exec(route);
    return match ? {kind:'tir', id:match[1]} : null;
  }
  const sampleCreate = route === '/islandsun/samplerequest/add'
    || route === '/islandsun/samplerequest/getimprovement' && /^[1-9]\d*$/.test(page.searchParams.get('sr_id'));
  if (path === '/islandsun/samplerequest/processaddsamplerequestnew' && sampleCreate) return {kind:'sample', id:null};
  if (path === '/islandsun/samplerequest/processupdatesamplerequestnew' && route === '/islandsun/samplerequest/edit' && /^[1-9]\d*$/.test(page.searchParams.get('id'))) return {kind:'sample', id:page.searchParams.get('id')};
  return null;
}

/** A complete fresh index is required to distinguish new requests from existing drafts. */
export function tirSaveIndex(payload) {
  const total = Number(payload?.recordsFiltered);
  if (!/^(?:0|[1-9]\d*)$/.test(String(payload?.recordsFiltered)) || !Array.isArray(payload?.data)
    || !Number.isSafeInteger(total) || total !== payload.data.length) {
    throw new Error('The complete TIR list could not be verified.');
  }
  const records = new Map();
  for (const row of payload.data) {
    const id = String(row?.id_tir ?? '');
    if (!/^[1-9]\d{0,11}$/.test(id) || records.has(id)) throw new Error('The TIR list contains inconsistent record identifiers.');
    records.set(id, {id, number:String(row.tir_no ?? '').trim(), customer:String(row.customer ?? '').trim()});
  }
  return records;
}

/** Read the complete Sample index without deriving identity from table order. */
export function sampleSaveIndex(payload) {
  const total = Number(payload?.recordsFiltered);
  if (!/^(?:0|[1-9]\d*)$/.test(String(payload?.recordsFiltered)) || !Array.isArray(payload?.data)
    || !Number.isSafeInteger(total) || total !== payload.data.length) {
    throw new Error('The complete Sample list could not be verified.');
  }
  const records = new Map();
  for (const row of payload.data) {
    const id = String(row?.sr_id ?? '');
    if (!/^[1-9]\d{0,11}$/.test(id) || records.has(id)) throw new Error('The Sample list contains inconsistent record identifiers.');
    const type = /^[1-5]$/.test(String(row.sr_srtype)) ? Number(row.sr_srtype) : sampleType(row.sr_srtype);
    records.set(id, {id, number:String(row.sr_no ?? '').trim(), type});
  }
  return records;
}

