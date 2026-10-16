import { calendarDay, localCalendarDate } from './calendar-day.js';
import { submissionRecord, submissionStage } from './submission-logic.js';
import { discardRecordNotices } from './notification-relevance.js';

export const DRAFT_DELAY_MS = 5 * 60000;
const SAVE_INTENT_LIFETIME = 7 * 86400000;

/** Save attempts survive navigation; a fresh server list must establish the actual record. */
export function registerSaveAttempt(previous, intent, now = Date.now()) {
  if (!intent || !['sample', 'tir'].includes(intent.kind) || !/^[\w-]{1,100}$/.test(intent.token || '')
    || !Number.isFinite(intent.created) || intent.created > now || now - intent.created > SAVE_INTENT_LIFETIME) return previous;
  const state = structuredClone(previous);
  state.saveAttempts ||= {};
  state.saveAttempts[intent.token] = intent;
  for (const [key, draft] of Object.entries(state.drafts || {})) {
    if (draft.kind !== intent.kind || (intent.id ? draft.id !== String(intent.id) : !intent.number || draft.number !== intent.number)
      || intent.created <= draft.savedAt) continue;
    Object.assign(draft, {savedAt:intent.created, lastDay:null, submitAttemptAt:0, eligible:true});
    discardRecordNotices(state, key, ['unsubmitted']);
  }
  for (const [token, item] of Object.entries(state.saveAttempts)) {
    if (now - item.created > SAVE_INTENT_LIFETIME) delete state.saveAttempts[token];
  }
  const oldest = Object.values(state.saveAttempts).sort((a, b) => a.created - b.created);
  for (const item of oldest.slice(0, Math.max(0, oldest.length - 64))) delete state.saveAttempts[item.token];
  return state;
}

/** Match explicit IDs/numbers or an unambiguous new TIR from a complete earlier account index. */
function savedRecord(intent, records) {
  const matches = records.filter(record => {
    if (record.kind !== intent.kind) return false;
    if (intent.id) return record.id === String(intent.id);
    if (intent.number) return record.number === intent.number;
    return intent.kind === 'tir' && Array.isArray(intent.beforeIds) && !intent.beforeIds.includes(record.id);
  });
  return matches.length === 1 ? matches[0] : null;
}

/** Reconcile unsubmitted requests using fresh account-scoped status, never old detail tabs. */
export function observeDraftStatuses(previous, records, {now = Date.now(), observedAt = now} = {}) {
  const state = structuredClone(previous);
  state.drafts ||= {};
  state.saveAttempts ||= {};
  const valid = records.map(raw => {
    const record = submissionRecord(raw);
    return record && {...record, status:raw.status, date:raw.date};
  }).filter(Boolean);
  const saves = new Map();
  for (const [token, intent] of Object.entries(state.saveAttempts)) {
    if (now - intent.created > SAVE_INTENT_LIFETIME) { delete state.saveAttempts[token]; continue; }
    if (observedAt < intent.created) continue;
    if (!intent.id && !intent.number && !Array.isArray(intent.beforeIds)) { delete state.saveAttempts[token]; continue; }
    const record = savedRecord(intent, valid);
    if (!record) continue;
    const key = `${record.kind}:${record.id}`;
    if (!saves.has(key) || saves.get(key).created < intent.created) saves.set(key, intent);
    delete state.saveAttempts[token];
  }
  for (const record of valid) {
    const key = `${record.kind}:${record.id}`, current = state.drafts[key], save = saves.get(key);
    if (observedAt < (current?.observedAt || 0)) continue;
    const stage = submissionStage(record.kind, record.status);
    if (!stage) continue;
    if (stage !== 'rollback') {
      delete state.drafts[key];
      discardRecordNotices(state, key, ['unsubmitted']);
      continue;
    }
    const rolledBack = previous.submissions?.[key]?.confirmed || previous.submissionOutcomes?.[key] || Object.values(previous.notices).some(item => item.key === key && item.type === 'rollback');
    const savedAt = save?.created ?? current?.savedAt ?? now;
    state.drafts[key] = {
      ...current, ...record, savedAt, observedAt,
      eligible:save ? true : current?.eligible ?? !rolledBack,
      ...(save ? {lastDay:null, submitAttemptAt:0} : {}),
    };
    if (save) discardRecordNotices(state, key, ['unsubmitted']);
  }
  return advanceDraftReminders(state, {now});
}

/** First reminder follows a five-minute grace period; subsequent reminders use local dates. */
export function advanceDraftReminders(previous, {now = Date.now(), today = localCalendarDate(now)} = {}) {
  const state = structuredClone(previous), day = calendarDay(today);
  if (day === null) return state;
  for (const [key, draft] of Object.entries(state.drafts || {})) {
    if (!draft.eligible || draft.observedAt < draft.savedAt || now < draft.savedAt + DRAFT_DELAY_MS
      || now - draft.observedAt > DRAFT_DELAY_MS + 15000
      || draft.submitAttemptAt && now - draft.submitAttemptAt < 120000
      || draft.lastDay != null && day <= draft.lastDay) continue;
    const muteKey = `${key}:unsubmitted`;
    if (state.muted[muteKey]) continue;
    const id = `${key}:unsubmitted:${draft.savedAt}:${day}`;
    discardRecordNotices(state, key, ['unsubmitted']);
    state.notices[id] = {
      id, key, number:draft.number, customer:draft.customer || '', url:draft.url,
      type:'unsubmitted', muteKey, created:now,
      message:`${draft.number}: saved ${draft.kind === 'tir' ? 'TIR is still Pending' : 'sample request is still Draft'}. Submit it to Product Marketing when ready.`,
    };
    draft.lastDay = day;
  }
  return state;
}
