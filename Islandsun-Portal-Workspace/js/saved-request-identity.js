import { requestDetailUrl, tirDetailUrl } from './logic.js';

const REQUEST_ID = /^[1-9]\d{0,11}$/;
const MAX_AGE_MS = 10 * 60000;

/** Validate a tab-local Save destination without accepting an arbitrary URL. */
export function validSavedRequestIntent(value, account, now = Date.now()) {
  if (!value || value.version !== 1 || value.account !== account || !account
    || !['sample', 'tir'].includes(value.kind) || !Number.isFinite(value.created)
    || value.created > now || now - value.created > MAX_AGE_MS
    || value.id && !REQUEST_ID.test(String(value.id))) return false;
  if (value.kind === 'sample') return [1, 2, 3, 4, 5].includes(value.sampleType)
    && /^\d+\/[IVX]+\/\d{4}\/SRF$/i.test(value.number);
  return Boolean(value.id || Array.isArray(value.beforeIds)
    && value.beforeIds.every(id => REQUEST_ID.test(id)) && new Set(value.beforeIds).size === value.beforeIds.length);
}

/** Resolve only the exact SRF or one unambiguous TIR created since the fresh baseline. */
export function savedRequestDestination(pending, records) {
  if (pending.kind === 'sample') {
    const matches = [...records.values()].filter(record => record.number === pending.number
      && record.type === pending.sampleType && (!pending.id || pending.id === record.id));
    return matches.length === 1 ? requestDetailUrl(matches[0].id, matches[0].type) : null;
  }
  if (pending.id) return records.has(pending.id) ? tirDetailUrl(pending.id) : null;
  if (!pending.beforeIds || pending.beforeIds.some(id => !records.has(id))) return null;
  const before = new Set(pending.beforeIds);
  const matches = [...records.values()].filter(record => !before.has(record.id));
  return matches.length === 1 && /^\d+\/[IVX]+\/\d{4}\/TIR$/i.test(matches[0].number)
    ? tirDetailUrl(matches[0].id) : null;
}
