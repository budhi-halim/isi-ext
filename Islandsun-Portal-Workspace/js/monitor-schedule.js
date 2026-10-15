import { calendarDay } from './notification-logic.js';
import { monitorDetailsEligible } from './submission-logic.js';
import { statusSignature } from './fetch-policy.js';

const KINDS = ['sample', 'tir'];
const newestFirst = (a, b) => (calendarDay(b.date) || 0) - (calendarDay(a.date) || 0) || Number(b.id) - Number(a.id);

export function previewQueue(records, pageSize) {
  const lists = Object.fromEntries(KINDS.map(kind => [kind, records.filter(record => record.kind === kind).sort(newestFirst)]));
  const queue = [];
  for (let page = 0; page < 3; page++) for (const kind of KINDS) {
    for (const record of lists[kind].slice(page * pageSize, (page + 1) * pageSize)) queue.push(`${kind}:${record.id}`);
  }
  return queue;
}

/** Alternate bounded notification batches; a verified status change precedes historical discovery. */
export function nextNotificationRead({ records, checked, discovery = {}, pageSize = 10 }, now = Date.now()) {
  const pending = records.filter(record => monitorDetailsEligible(record)
    && !(checked[`${record.kind}:${record.id}`]?.retryAt > now)
    && checked[`${record.kind}:${record.id}`]?.signature !== statusSignature(record));
  const changed = pending.filter(record => checked[`${record.kind}:${record.id}`]?.signature !== undefined);
  const candidates = changed.length ? changed : pending;
  let kind = KINDS.includes(discovery.kind) ? discovery.kind : 'sample';
  let count = Number(discovery.count) || 0;
  if (count >= pageSize || !candidates.some(record => record.kind === kind)) {
    const other = kind === 'sample' ? 'tir' : 'sample';
    if (candidates.some(record => record.kind === other)) kind = other;
    count = 0;
  }
  const record = candidates.filter(record => record.kind === kind).sort(newestFirst)[0];
  if (!record) return null;
  const reason = checked[`${record.kind}:${record.id}`]?.retryAt ? 'retry' : changed.length ? 'status-change' : 'baseline';
  return { record, reason, rotation: {kind, count: count + 1}, remaining: pending.length };
}
