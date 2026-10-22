import { requestDetailUrl } from './logic.js';

const KEY = 'islandsun.portal.sample-save-continuation';
const MAX_AGE_MS = 30 * 60000;

/** Keep one tab's authorized continuation, without retaining form contents. */
export function writeSampleContinuation(pending, phase = 'saved') {
  const entry = {
    version: 1, token: pending.token || [...crypto.getRandomValues(new Uint32Array(4))].map(value => value.toString(16)).join('-'), created: pending.created || Date.now(),
    account: pending.account, kind: 'sample', number: pending.number, id: pending.id || null,
    sampleType: pending.sampleType, sourceUrl: pending.sourceUrl, phase,
  };
  sessionStorage.setItem(KEY, JSON.stringify(entry));
  Object.assign(pending, {token: entry.token, created: entry.created});
  return entry;
}

/** A reload can check an attempted submission, but must never repeat its write. */
export function readSampleContinuation(account, now = Date.now()) {
  let entry;
  try { entry = JSON.parse(sessionStorage.getItem(KEY)); } catch { return null; }
  if (!entry) return null;
  if (entry.version !== 1 || !['saved', 'submitting'].includes(entry.phase)
    || typeof entry.token !== 'string' || !Number.isFinite(entry.created) || entry.created > now || now - entry.created > MAX_AGE_MS
    || !/^\d+\/[IVX]+\/\d{4}\/SRF$/i.test(entry.number) || ![1, 2, 3, 4, 5].includes(entry.sampleType)
    || entry.id && !requestDetailUrl(entry.id, entry.sampleType)) {
    sessionStorage.removeItem(KEY);
    return null;
  }
  if (!account || entry.account !== account) return null;
  return entry;
}

export function clearSampleContinuation(token) {
  try {
    const current = JSON.parse(sessionStorage.getItem(KEY));
    if (current?.token === token) sessionStorage.removeItem(KEY);
  } catch { /* An unavailable session store cannot trigger another continuation. */ }
}

/** Resolve the exact SRF and type; row order and the highest ID are irrelevant. */
export function matchingSavedSample(records, pending) {
  const matches = [...records.values()].filter(record => record.number === pending.number);
  if (matches.length !== 1) return null;
  const record = matches[0];
  if (record.type !== pending.sampleType || pending.id && pending.id !== record.id) return null;
  const url = requestDetailUrl(record.id, record.type);
  return url ? {...record, url} : null;
}
