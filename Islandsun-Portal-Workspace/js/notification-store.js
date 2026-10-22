import { emptyNotificationState, observeRecord, dismissNotification, acknowledgeNotices, silenceNotifications } from './notification-logic.js';
import { acquireLocalLock } from './local-lock.js';
import { registerSubmission, observeSubmissionStatuses, submissionRecord, SUBMISSION_INTENT_LIFETIME } from './submission-logic.js';
import { pruneNotificationState } from './notification-relevance.js';
import { diagnosticLog } from './diagnostic-log.js';
import { registerSaveAttempt, observeDraftStatuses, advanceDraftReminders } from './draft-reminders.js';
import { bypassPopupNotices, retainPopupNotice } from './notification-popup-state.js';

/** A same-origin lock serializes localStorage updates across portal tabs. */
export function createNotificationStore(account, { storage = localStorage, locks = navigator.locks, onError = () => {} } = {}) {
  const key = `islandsun.portal.notifications.v1:${encodeURIComponent(account)}`;
  const outboxPrefix = `${key}:submission:`;
  const savePrefix = `${key}:save:`;
  const listeners = new Set();
  const owner = [...crypto.getRandomValues(new Uint32Array(4))].join('-');
  let disposed = false;
  let lastError = '', lastErrorAt = 0;
  function reportError(error, operation, stage = operation) {
    const signature = `${operation}:${stage}:${error.name}:${error.message}`;
    if (signature !== lastError || Date.now() - lastErrorAt >= 60000) {
      lastError = signature; lastErrorAt = Date.now();
      let characters;
      try { characters = storage.getItem(key)?.length || 0; } catch { /* Storage permission may be the failure being reported. */ }
      diagnosticLog('notification-history-failed',{operation,stage,errorType:error.name,message:String(error.message).slice(0,500),characters});
      onError(error,operation);
    }
  }
  function read() {
    const text = storage.getItem(key);
    if (!text) return emptyNotificationState();
    const value = JSON.parse(text);
    if (value?.version !== 1 || !value.jobs || !value.notices || !value.muted) throw new Error('Notification history could not be read.');
    return value;
  }
  function publish() {
    if (disposed) return;
    const state = read();
    for (const listener of listeners) {
      try { listener(state); }
      catch (error) { reportError(error,'display'); }
    }
  }
  function pendingIntents() {
    const entries = [];
    for (let index = 0; index < storage.length; index++) {
      const name = storage.key(index);
      if (name?.startsWith(outboxPrefix) || name?.startsWith(savePrefix)) entries.push(name);
    }
    return entries;
  }
  async function update(transform, operation = 'update') {
    let stage = 'lock';
    const change = () => {
      if (disposed) return;
      stage = 'read';
      let previous = read();
      const before = JSON.stringify(previous), pending = pendingIntents();
      stage = 'update';
      for (const name of pending) {
        try {
          previous = (name.startsWith(savePrefix) ? registerSaveAttempt : registerSubmission)(previous, JSON.parse(storage.getItem(name)));
        } catch { /* A malformed outbox entry cannot become a save or submission. */ }
      }
      let next = pruneNotificationState(transform(previous));
      if (next.toastPopups === false) next = bypassPopupNotices(next);
      const after = JSON.stringify(next);
      stage = 'write';
      if (after !== before) storage.setItem(key, after);
      if (['dismiss', 'silence', 'silence-all', 'clear'].includes(operation)) {
        diagnosticLog('notification-action-saved', {operation,
          removedIds:Object.keys(previous.notices).filter(id => !next.notices[id]),
          silencedKeys:Object.keys(next.muted).filter(id => !previous.muted[id])});
      }
      for (const [id,item] of Object.entries(next.notices)) if (!previous.notices[id]) diagnosticLog('notification-created',{id,key:item.key,type:item.type,customer:item.customer});
      for (const id of Object.keys(previous.notices)) if (!next.notices[id]) diagnosticLog('notification-removed',{id});
      for (const [recordKey, item] of Object.entries(next.submissions || {})) {
        if (item.confirmed && !previous.submissions?.[recordKey]?.confirmed) diagnosticLog('submission-confirmed', {kind:item.kind,number:item.number,key:recordKey});
      }
      for (const [recordKey, item] of Object.entries(next.drafts || {})) {
        if (item.savedAt !== previous.drafts?.[recordKey]?.savedAt) diagnosticLog('draft-save-observed', {key:recordKey,number:item.number,savedAt:item.savedAt,reminderAt:item.savedAt+300000});
      }
      stage = 'outbox';
      for (const name of pending) storage.removeItem(name);
      stage = 'display';
      if (after !== before) publish();
      return next;
    };
    try {
      if (locks) return await locks.request(key, change);
      const release = await acquireLocalLock(key);
      try { return change(); } finally { release(); }
    } catch (error) {
      reportError(error,operation,stage);
      throw Object.assign(new Error('Local notification history could not be updated.',{cause:error}),{code:'NOTIFICATION_STORAGE'});
    }
  }
  const changed = event => {
    if (event.key === key) { try { publish(); } catch (error) { reportError(error,'read'); } }
    else if ((event.key?.startsWith(outboxPrefix) || event.key?.startsWith(savePrefix)) && event.newValue) update(state => state).catch(() => {});
  };
  window.addEventListener('storage', changed);
  try {
    const saved = read(), count = Object.keys(saved.notices).length;
    if (Object.keys(pruneNotificationState(saved).notices).length !== count) void update(state => state).catch(() => {});
  } catch (error) { reportError(error,'read'); }
  return {
    key, read, account,
    setToastPopups: enabled => update(state => ({
      ...(enabled === false || state.toastPopups === false ? bypassPopupNotices(state) : state),
      toastPopups:Boolean(enabled),
    }), 'popup-setting'),
    bypassPopups: ids => update(state => bypassPopupNotices(state, ids), 'bypass-popups'),
    retainPopup: request => update(state => retainPopupNotice(state, request), 'retain-popup'),
    saveMonitor: monitor => update(state => ({...state,monitor}), 'save-schedule'),
    registerSave(record) {
      if (disposed || !['sample','tir'].includes(record.kind)) return;
      if (pendingIntents().length >= 64) throw new Error('Save tracking is busy.');
      const state = read(), token = [...crypto.getRandomValues(new Uint32Array(4))].join('-');
      const intent = {...record, token, created:Date.now()};
      if (record.kind === 'tir' && !record.id && !intent.beforeIds && state.monitor?.indexedAt) {
        intent.beforeIds = state.monitor.records.filter(item => item.kind === 'tir').map(item => item.id);
      }
      storage.setItem(`${savePrefix}${token}`, JSON.stringify(intent));
      diagnosticLog('save-intent', {kind:record.kind,id:record.id,number:record.number,created:intent.created});
      update(state => state).catch(() => {});
    },
    advanceReminders: options => update(state => advanceDraftReminders(state, options)),
    registerSubmission(record) {
      if (disposed) return;
      const valid = submissionRecord(record);
      if (!valid) throw new Error('Invalid submission record.');
      const now = Date.now();
      for (const name of pendingIntents()) {
        try { const value = JSON.parse(storage.getItem(name)); if (now - value.created > SUBMISSION_INTENT_LIFETIME) storage.removeItem(name); }
        catch { storage.removeItem(name); }
      }
      if (pendingIntents().length >= 64) throw new Error('Submission tracking is busy.');
      const token = [...crypto.getRandomValues(new Uint32Array(4))].join('-');
      storage.setItem(`${outboxPrefix}${token}`, JSON.stringify({ ...valid, token, created: now }));
      diagnosticLog('submission-intent', {kind:valid.kind,id:valid.id,number:valid.number,created:now});
      update(state => state).catch(() => {});
    },
    observeStatuses: (records, options = {}) => update(state => {
      const observedAt = options.observedAt ?? Date.now();
      if (options.source !== 'page' && observedAt < (state.submissionIndexAt || 0)) return state;
      const next = observeSubmissionStatuses(options.source === 'page' ? state : observeDraftStatuses(state, records, {...options, observedAt}), records, { ...options, observedAt });
      if (options.source !== 'page') next.submissionIndexAt = observedAt;
      return next;
    }),
    observe: (record, time) => update(state => observeRecord(state, record, time)),
    dismiss: (id, mute = false) => update(state => dismissNotification(state, id, mute), mute ? 'silence' : 'dismiss'),
    silence: ids => update(state => silenceNotifications(state, ids), 'silence-all'),
    clear: ids => update(state => {
      const selected = ids ? ids.map(id => state.notices[id]).filter(Boolean) : Object.values(state.notices);
      const next = {...state,notices:{...state.notices}};
      acknowledgeNotices(next, selected);
      for (const item of selected) delete next.notices[item.id];
      return next;
    }, 'clear'),
    async claim(id) {
      let claimed = false;
      await update(state => {
        const item = state.notices[id];
        if (state.toastPopups !== false && item && !item.delivered && (!item.claim || item.claim.until < Date.now() || item.claim.owner === owner)) {
          item.claim = { owner, until: Date.now() + 15000 }; claimed = true;
        }
        return state;
      });
      return claimed;
    },
    release: id => update(state => { if (state.notices[id]?.claim?.owner === owner) delete state.notices[id].claim; return state; }),
    delivered: id => update(state => { const item = state.notices[id]; if (item?.claim?.owner === owner) { item.delivered = true; delete item.claim; } return state; }),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    destroy() { disposed = true; listeners.clear(); window.removeEventListener('storage', changed); },
  };
}
