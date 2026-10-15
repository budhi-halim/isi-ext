import { PORTAL_ORIGIN } from './shared/document-names.js';
import { requestDetailUrl, tirDetailUrl } from './logic.js';
import { discardRecordNotices, pruneNotificationState } from './notification-relevance.js';

export const SUBMISSION_INTENT_LIFETIME = 7 * 86400000;
const RECORD_ID = /^[1-9]\d{0,11}$/;
const ACTIVE_TIR = new Set(['PROCESS PM', 'APPROVE', 'APPROVED', 'FULLFIL', 'PARTIAL COMPLETE', 'PARTIAL COMPLETED']);
const ACTIVE_SAMPLE = new Set(['WAITING APPROVAL PM', 'APPROVED BY PM', 'PROCESS RND', 'WAITING FEEDBACK', 'PARTIAL COMPLETED']);

export function normalizedStatus(value) {
  const status = String(value ?? '').trim().toUpperCase().replace(/[_\s]+/g, ' ');
  return status === 'PROCESSPM' ? 'PROCESS PM' : status;
}

export function submissionStage(kind, value) {
  const status = normalizedStatus(value);
  if ((kind === 'tir' ? ACTIVE_TIR : ACTIVE_SAMPLE).has(status)) return 'active';
  if (kind === 'tir' && status === 'PENDING' || kind === 'sample' && status === 'DRAFT') return 'rollback';
  if (kind === 'tir' && status === 'REJECT') return 'rejected';
  if (kind === 'sample' && status === 'CANCEL') return 'cancelled';
  if (['COMPLETE', 'COMPLETED', 'COMPLETED BY SYSTEM'].includes(status)) return 'complete';
  return null;
}

export function notificationTone(type) {
  return ['overdue', 'rollback', 'rejected', 'cancelled'].includes(type) ? 'warning' : 'success';
}

/** Status tracking needs draft/rejected rows; expensive document reads do not. */
export function monitorDetailsEligible(record) {
  const status = normalizedStatus(record.status);
  if (record.kind === 'tir') return ['APPROVE', 'APPROVED', 'PARTIAL COMPLETE', 'PARTIAL COMPLETED', 'COMPLETE', 'COMPLETED'].includes(status);
  return record.kind === 'sample' && [...ACTIVE_SAMPLE, 'COMPLETE', 'COMPLETED', 'COMPLETED BY SYSTEM'].includes(status);
}

export function submissionRecord(value) {
  if (!value || !['tir', 'sample'].includes(value.kind) || !RECORD_ID.test(String(value.id))) return null;
  const number = String(value.number ?? '').trim();
  if (!number || number.length > 100 || /[\x00-\x1f]/.test(number)) return null;
  let url;
  try { url = new URL(value.url); } catch { return null; }
  const canonical = value.kind === 'tir' ? tirDetailUrl(value.id) : requestDetailUrl(value.id, url.searchParams.get('srtype'));
  if (url.origin !== PORTAL_ORIGIN || url.href !== canonical) return null;
  return { kind: value.kind, id: String(value.id), number, url: canonical };
}

/** Match only the portal's observed marketing links on their own record page. */
export function submissionIntent(href, pageUrl, number) {
  let action, page;
  try { action = new URL(href, pageUrl); page = new URL(pageUrl); } catch { return null; }
  if (action.origin !== PORTAL_ORIGIN || page.origin !== PORTAL_ORIGIN || action.hash) return null;
  page.pathname = page.pathname.replace(/^\/islandsun\/index\.php\//i, '/islandsun/');
  const tir = /^\/islandsun\/master\/Tir\/ajukan\/([1-9]\d{0,11})\/processPM$/i.exec(action.pathname);
  if (tir && !action.search && page.pathname.toLowerCase() === `/islandsun/master/tir/edit/${tir[1]}`) {
    return submissionRecord({ kind: 'tir', id: tir[1], number, url: tirDetailUrl(tir[1]) });
  }
  const sample = /^\/islandsun\/samplerequest\/updateStatus\/([1-9]\d{0,11})$/i.exec(action.pathname);
  if (sample && [...action.searchParams.keys()].length === 1 && normalizedStatus(action.searchParams.get('status')) === 'WAITING APPROVAL PM'
    && /^\/islandsun\/samplerequest\/edit$/i.test(page.pathname) && page.searchParams.get('id') === sample[1]) {
    return submissionRecord({ kind: 'sample', id: sample[1], number, url: requestDetailUrl(sample[1], page.searchParams.get('srtype')) });
  }
  return null;
}

export function registerSubmission(previous, intent, now = Date.now()) {
  const record = submissionRecord(intent);
  if (!record || !/^[\w-]{1,100}$/.test(intent.token || '') || !Number.isFinite(intent.created)
    || intent.created > now || now - intent.created > SUBMISSION_INTENT_LIFETIME) return previous;
  const key = `${record.kind}:${record.id}`, current = previous.submissions?.[key];
  if (current && (current.token === intent.token || current.created >= intent.created)) return previous;
  const state = structuredClone(previous);
  state.submissions ??= {};
  state.submissions[key] = { ...record, token: intent.token, created: intent.created, observed: intent.created, confirmed: false };
  return state;
}

/** A click is an intent, not proof of server acceptance. Only observed active status confirms it. */
export function observeSubmissionStatuses(previous, records, { now = Date.now(), observedAt = now, source = 'index' } = {}) {
  const state = structuredClone(previous);
  state.submissions ??= {};
  for (const [key, entry] of Object.entries(state.submissions)) {
    if (!entry.confirmed && now - entry.created > SUBMISSION_INTENT_LIFETIME) delete state.submissions[key];
  }
  for (const raw of records) {
    const record = submissionRecord(raw);
    if (!record) continue;
    const key = `${record.kind}:${record.id}`, stage = submissionStage(record.kind, raw.status), known = state.submissions[key];
    if (!stage || observedAt < (known?.observed ?? 0)) continue;
    if (source === 'page') {
      // A previously opened detail tab can be stale. It may confirm its own pending intent,
      // but rollback/rejection is decided only from the serialized fresh index.
      if (known && !known.confirmed && stage === 'active') state.submissions[key] = { ...known, confirmed: true, observed: observedAt };
      continue;
    }
    if (stage === 'active') {
      discardRecordNotices(state, key, ['rollback', 'rejected', 'cancelled']);
      state.submissions[key] = { ...record, token: known?.token || `observed-${observedAt}`, created: known?.created ?? observedAt, confirmed: true, observed: observedAt };
    } else if (stage === 'complete') {
      discardRecordNotices(state, key, ['rollback', 'rejected', 'cancelled']);
      delete state.submissions[key];
    } else {
      discardRecordNotices(state, key, ['overdue', 'ready', 'complete']);
      delete state.jobs[key];
      const previousNotice = Object.values(state.notices).find(notice => notice.key === key && ['rollback', 'rejected', 'cancelled'].includes(notice.type));
      if (!known?.confirmed && (!previousNotice || previousNotice.type === stage)) continue;
      discardRecordNotices(state, key, ['rollback', 'rejected', 'cancelled']);
      const id = `${key}:submission:${known?.token || `observed-${observedAt}`}:${stage}`;
      const message = stage === 'rollback' ? `${record.number}: returned to ${record.kind === 'tir' ? 'Pending' : 'Draft'} after submission to Product Marketing.`
        : `${record.number}: ${record.kind === 'tir' ? 'TIR rejected' : 'sample request cancelled'}.`;
      state.notices[id] ??= { id, key, type: stage, message, created: now, url: record.url, customer:record.customer || '' };
      delete state.submissions[key];
    }
  }
  return pruneNotificationState(state);
}
