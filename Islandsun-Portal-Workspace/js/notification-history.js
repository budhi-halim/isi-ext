import { emptyNotificationState } from './notification-logic.js';
import { pruneNotificationState } from './notification-relevance.js';

export const notificationKey = account => `islandsun.portal.notifications.v2:${encodeURIComponent(account)}`;
export const legacyNotificationKey = account => `islandsun.portal.notifications.v1:${encodeURIComponent(account)}`;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const observedAt = (state, key) => Math.max(state.monitor?.checked?.[key]?.at || 0,
  state.observationTimes?.[key] || 0, state.drafts?.[key]?.observedAt || 0,
  state.submissions?.[key]?.observed || 0, state.submissionOutcomes?.[key]?.observed || 0);

export function validateNotificationHistory(value) {
  if (value?.version !== 1 || !object(value.jobs) || !object(value.notices) || !object(value.muted)) {
    throw new Error('Notification history could not be read.');
  }
  return value;
}

/** Import each website's history once; explicit silence and dismissal always survive merging. */
export function mergeNotificationHistory(current = emptyNotificationState(), incoming) {
  validateNotificationHistory(incoming);
  const state = structuredClone(current);
  state.muted = {...incoming.muted, ...state.muted};
  for (const [key, value] of Object.entries(incoming.acknowledged || {})) {
    state.acknowledged ||= {};
    if (value.at > (state.acknowledged[key]?.at || 0)) state.acknowledged[key] = value;
  }
  for (const field of ['jobs', 'drafts', 'submissions', 'submissionOutcomes']) {
    state[field] ||= {};
    const keys = new Set([...Object.keys(current[field] || {}), ...Object.keys(incoming[field] || {})]);
    for (const key of keys) {
      if (observedAt(incoming, key) > observedAt(current, key)
        || !Object.hasOwn(current[field] || {}, key) && observedAt(current, key) === 0) {
        if (incoming[field]?.[key]) state[field][key] = structuredClone(incoming[field][key]);
        else delete state[field][key];
      }
    }
  }
  state.saveAttempts = {...incoming.saveAttempts, ...state.saveAttempts};
  state.observationTimes = {...incoming.observationTimes, ...state.observationTimes};
  for (const [key, at] of Object.entries(incoming.observationTimes || {})) {
    state.observationTimes[key] = Math.max(at, state.observationTimes[key] || 0);
  }
  state.documentVersions = {...incoming.documentVersions, ...state.documentVersions};
  for (const [key, hash] of Object.entries(incoming.documentVersions || {})) {
    const recordKey = key.split(':').slice(0,2).join(':');
    if (observedAt(incoming, recordKey) > observedAt(current, recordKey)) state.documentVersions[key] = hash;
  }
  const acknowledgedIds = new Set(Object.values(state.acknowledged || {}).map(value => value.id));
  for (const [id, item] of Object.entries(incoming.notices)) {
    if (state.removedNotices?.[id] || acknowledgedIds.has(id)) continue;
    // Imported notices remain in the tray, without replaying a historical popup queue.
    const notice = {...(state.notices[id] || item), delivered:true};
    delete notice.claim;
    state.notices[id] = notice;
  }
  const newer = (incoming.monitor?.indexedAt || 0) > (current.monitor?.indexedAt || 0) ? incoming : current;
  const older = newer === incoming ? current : incoming;
  if (newer.monitor || older.monitor) {
    state.monitor = structuredClone(newer.monitor || older.monitor);
    state.monitor.checked ||= {};
    for (const [key, value] of Object.entries(older.monitor?.checked || {})) {
      if (value.at > (state.monitor.checked[key]?.at || 0)) state.monitor.checked[key] = structuredClone(value);
    }
  }
  state.submissionIndexAt = Math.max(incoming.submissionIndexAt || 0, current.submissionIndexAt || 0);
  if (!current.popupPreferenceAt && incoming.toastPopups === false) state.toastPopups = false;
  for (const [id] of Object.entries(state.notices)) {
    if (state.removedNotices?.[id] || acknowledgedIds.has(id)) delete state.notices[id];
  }
  return pruneNotificationState(state);
}

/** Recover only confirmed user actions from extension-owned diagnostics, never inferred silence. */
export function recoverNotificationActions(previous, actions) {
  const state = structuredClone(previous);
  state.removedNotices ||= {};
  for (const action of actions) {
    if (action.event !== 'notification-action-saved' || !Number.isFinite(action.at)
      || !['dismiss','silence','silence-all','clear'].includes(action.operation)) continue;
    for (const key of Array.isArray(action.silencedKeys) ? action.silencedKeys : []) {
      if (typeof key === 'string' && /^(sample|tir):[1-9]\d*:/.test(`${key}:`)) state.muted[key] = true;
    }
    for (const id of Array.isArray(action.removedIds) ? action.removedIds : []) {
      if (typeof id !== 'string' || id.length > 2000) continue;
      state.removedNotices[id] = Math.max(state.removedNotices[id] || 0, action.at);
      delete state.notices[id];
    }
  }
  return pruneNotificationState(state);
}
