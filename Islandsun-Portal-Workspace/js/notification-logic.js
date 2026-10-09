import { monitorDetailsEligible } from './submission-logic.js';

const DAY = 86400000;
const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

export function calendarDay(value) {
  const text = String(value ?? '').trim();
  const named = /^(\d{1,2})-([a-z]{3})-(\d{4})$/i.exec(text);
  const iso = named ? `${named[3]}-${String(MONTHS.indexOf(named[2].toLowerCase()) + 1).padStart(2,'0')}-${named[1].padStart(2,'0')}` : text.slice(0,10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const stamp = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0,10) === iso ? stamp / DAY : null;
}

export function emptyNotificationState() { return { version: 1, jobs: {}, notices: {}, muted: {} }; }

/** Apply one verified record snapshot. Failed/missing snapshots never imply completion. */
export function observeRecord(previous, record, { now = Date.now(), today = new Date().toLocaleDateString('en-CA') } = {}) {
  const state = structuredClone(previous);
  const key = `${record.kind}:${record.id}`;
  const known = state.jobs[key];
  const notify = (id, message, extra = {}) => {
    if (!state.notices[id]) state.notices[id] = { id, key, message, created: now, url: record.url, ...extra };
  };
  const day = calendarDay(today), start = calendarDay(record.date);
  const elapsed = day !== null && start !== null ? Math.max(0, day - start) : 0;
  const week = Math.floor(elapsed / 7);
  const pending = {};
  if (record.kind === 'tir') {
    if (!monitorDetailsEligible(record)) return state;
    if (!record.documents?.length) return state;
    for (const document of record.documents) {
      const documentKey = String(document.id);
      const muteKey = `${key}:${documentKey}`;
      const tracked = known?.pending[documentKey];
      if (document.ready) {
        if (tracked) notify(`${key}:${documentKey}:ready`, `${record.number}: ${document.label} is ready.`, { type: 'ready' });
        continue;
      }
      const lastWeek = tracked?.lastWeek || 0;
      pending[documentKey] = { label: document.label, lastWeek };
      if (week > lastWeek && !state.muted[muteKey]) {
        notify(`${muteKey}:overdue:${week}`, `${record.number}: ${document.label} has been waiting ${elapsed} days.`, { type: 'overdue', muteKey, week });
        pending[documentKey].lastWeek = week;
      }
    }
    for (const [id, document] of Object.entries(known?.pending || {})) {
      if (!record.documents.some(item => String(item.id) === id)) pending[id] = document;
    }
    if (known && Object.keys(known.pending).length && !Object.keys(pending).length) notify(`${key}:complete`, `${record.number}: all documents are ready.`, { type: 'complete' });
  } else if (record.kind === 'sample') {
    if (!Number.isInteger(record.requestedCount) || record.requestedCount < 1 || !Number.isInteger(record.providedCount)) return state;
    if (record.requestedCount !== record.providedCount) {
      const lastWeek = known?.pending.sample?.lastWeek || 0;
      pending.sample = { label: record.number, lastWeek };
      if (week > lastWeek && !state.muted[key]) {
        notify(`${key}:overdue:${week}`, `${record.number}: samples have been waiting ${elapsed} days.`, { type: 'overdue', muteKey: key, week });
        pending.sample.lastWeek = week;
      }
    }
  } else return state;
  if (Object.keys(pending).length) state.jobs[key] = { pending, number: record.number, date: record.date, url: record.url, kind: record.kind, id: record.id };
  else delete state.jobs[key];
  return state;
}

/** Dismissal deletes both views; muting retains only a suppression key, never finished job history. */
export function dismissNotification(previous, id, mute = false) {
  const state = structuredClone(previous);
  const item = state.notices[id];
  if (mute && item?.muteKey) {
    state.muted[item.muteKey] = true;
    for (const [key, notice] of Object.entries(state.notices)) if (notice.muteKey === item.muteKey) delete state.notices[key];
  } else delete state.notices[id];
  return state;
}
