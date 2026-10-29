import { acknowledgeNotices, dismissNotification, observeRecord, silenceNotifications } from './notification-logic.js';
import { registerSubmission, observeSubmissionStatuses } from './submission-logic.js';
import { registerSaveAttempt, observeDraftStatuses, advanceDraftReminders } from './draft-reminders.js';
import { bypassPopupNotices, retainPopupNotice } from './notification-popup-state.js';
import { pruneNotificationState } from './notification-relevance.js';

/** Apply one account operation on the worker's latest state, including durable native intents. */
export function mutateNotifications(previous, action, payload = {}, owner, now = Date.now()) {
  let state = structuredClone(previous), claimed = false;
  const {id} = payload;
  switch (action) {
    case 'initialize': case 'read': case 'outbox': break;
    case 'popup-setting':
      if (!payload.enabled || state.toastPopups === false) state = bypassPopupNotices(state);
      state.toastPopups = Boolean(payload.enabled); state.popupPreferenceAt = now;
      break;
    case 'bypass-popups': state = bypassPopupNotices(state, payload.ids); break;
    case 'retain-popup': state = retainPopupNotice(state, payload, now); break;
    case 'save-schedule': state.monitor = payload.monitor; break;
    case 'reminders': state = advanceDraftReminders(state, payload); break;
    case 'statuses': {
      const options = payload.options || {}, observedAt = options.observedAt ?? now;
      if (options.source !== 'page' && observedAt < (state.submissionIndexAt || 0)) break;
      if (options.source !== 'page') state = observeDraftStatuses(state, payload.records, {...options, observedAt});
      state = observeSubmissionStatuses(state, payload.records, {...options, observedAt});
      if (options.source !== 'page') state.submissionIndexAt = observedAt;
      break;
    }
    case 'observe':
      state = observeRecord(state, payload.record, payload.time);
      state.observationTimes ||= {};
      state.observationTimes[`${payload.record.kind}:${payload.record.id}`] = payload.time?.now ?? now;
      break;
    case 'dismiss': case 'silence': state = dismissNotification(state, id, action === 'silence'); break;
    case 'silence-all': state = silenceNotifications(state, payload.ids); break;
    case 'clear': {
      const ids = payload.ids || Object.keys(state.notices);
      acknowledgeNotices(state, ids.map(key => state.notices[key]).filter(Boolean));
      for (const key of ids) delete state.notices[key];
      break;
    }
    case 'claim': {
      const item = state.notices[id];
      if (state.toastPopups !== false && item && !item.delivered && (!item.claim || item.claim.until < now || item.claim.owner === owner)) {
        item.claim = {owner, until:now + 15000}; claimed = true;
      }
      break;
    }
    case 'release': case 'delivered':
      if (state.notices[id]?.claim?.owner === owner) {
        if (action === 'delivered') state.notices[id].delivered = true;
        delete state.notices[id].claim;
      }
      break;
    default: throw new Error('Unsupported notification operation.');
  }
  state = pruneNotificationState(state);
  for (const id of Object.keys(state.notices)) if (state.removedNotices?.[id]) delete state.notices[id];
  if (state.toastPopups === false) state = bypassPopupNotices(state);
  return {state, claimed};
}

export function applyNotificationIntents(previous, pending, handled, now = Date.now()) {
  let state = previous;
  for (const entry of pending) {
    const intent = entry.value;
    if (!intent || !/^[\w-]{1,100}$/.test(intent.token || '') || handled[intent.token]) continue;
    if (!['save','submission'].includes(entry.kind)) continue;
    state = (entry.kind === 'save' ? registerSaveAttempt : registerSubmission)(state, intent, now);
    handled[intent.token] = now;
  }
  const sorted = Object.entries(handled).sort((a,b) => b[1] - a[1]);
  for (const [token, at] of sorted) if (now - at > 7*86400000) delete handled[token];
  for (const [token] of sorted.slice(512)) delete handled[token];
  return state;
}
