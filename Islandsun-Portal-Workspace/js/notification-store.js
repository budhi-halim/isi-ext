import { emptyNotificationState } from './notification-logic.js';
import { notificationKey, legacyNotificationKey, validateNotificationHistory } from './notification-history.js';
import { submissionRecord, SUBMISSION_INTENT_LIFETIME } from './submission-logic.js';
import { diagnosticLog } from './diagnostic-log.js';

/** Extension storage owns history; a synchronous website outbox survives native form navigation. */
export function createNotificationStore(account, { api = chrome, storage = localStorage, events = window, log = diagnosticLog, onError = () => {} } = {}) {
  const key = notificationKey(account), legacyKey = legacyNotificationKey(account);
  const outboxPrefix = `${legacyKey}:submission:`, savePrefix = `${legacyKey}:save:`;
  const listeners = new Set();
  const token = () => [...crypto.getRandomValues(new Uint32Array(4))].join('-');
  const owner = token();
  let disposed = false, revision = -1, state = emptyNotificationState();
  let lastError = '', lastErrorAt = 0;
  function reportError(error, operation) {
    const signature = `${operation}:${error.name}:${error.message}`;
    if (signature === lastError && Date.now() - lastErrorAt < 60000) return;
    lastError = signature; lastErrorAt = Date.now();
    log('notification-history-failed', {operation,stage:'client',errorType:error.name,message:String(error.message).slice(0,500)});
    onError(error, operation);
  }
  function accept(record) {
    if (disposed || !record || record.version !== 2 || !Number.isSafeInteger(record.revision) || record.revision <= revision) return;
    state = structuredClone(validateNotificationHistory(record.state));
    revision = record.revision;
    for (const listener of listeners) {
      try { listener(structuredClone(state)); } catch (error) { reportError(error,'display'); }
    }
  }
  function pendingIntents() {
    const entries = [];
    for (let index = 0; index < storage.length; index++) {
      const name = storage.key(index);
      if (!name?.startsWith(outboxPrefix) && !name?.startsWith(savePrefix)) continue;
      const text = storage.getItem(name);
      let value;
      try { value = JSON.parse(text); } catch { /* Discard malformed intents only after a successful history commit. */ }
      entries.push({name,text,kind:name.startsWith(savePrefix) ? 'save' : 'submission',value});
    }
    return entries;
  }
  async function request(action, payload = {}) {
    if (disposed) return {claimed:false};
    try {
      const pending = pendingIntents().slice(0,64);
      const response = await api.runtime.sendMessage({type:'islandsun-notifications',account,owner,action,payload,
        pending:pending.map(({kind,value}) => ({kind,value}))});
      if (!response?.ok) throw Object.assign(new Error(response?.code === 'ACCOUNT_CHANGED'
        ? 'The signed-in account changed.' : 'Notification history could not be updated.'), {code:response?.code || 'NOTIFICATION_STORAGE'});
      accept(response.record);
      for (const entry of pending) if (storage.getItem(entry.name) === entry.text) storage.removeItem(entry.name);
      return response;
    } catch (cause) {
      reportError(cause, action);
      throw Object.assign(new Error('Notification history could not be updated.', {cause}), {code:cause.code === 'ACCOUNT_CHANGED' ? cause.code : 'NOTIFICATION_STORAGE'});
    }
  }
  const changed = (changes, area) => {
    if (area !== 'local' || !changes[key]) return;
    try { accept(changes[key].newValue); } catch (error) { reportError(error,'read'); }
  };
  const outboxChanged = event => {
    if (event.newValue && (event.key?.startsWith(outboxPrefix) || event.key?.startsWith(savePrefix))) void update('outbox').catch(() => {});
  };
  api.storage.onChanged.addListener(changed);
  events.addEventListener('storage', outboxChanged);
  const ready = (async () => {
    let legacy;
    try { const text = storage.getItem(legacyKey); legacy = text ? validateNotificationHistory(JSON.parse(text)) : null; }
    catch (cause) { reportError(cause,'migration'); throw Object.assign(new Error('Notification history could not be read.',{cause}),{code:'NOTIFICATION_STORAGE'}); }
    await request('initialize', {legacy});
  })();
  // Native intent capture remains available even if initialization needs a page refresh.
  void ready.catch(() => {});
  async function update(action, payload) {
    await ready;
    return request(action, payload);
  }
  function capture(kind, record) {
    const now = Date.now();
    for (const entry of pendingIntents()) {
      if (!entry.value || now - entry.value.created > SUBMISSION_INTENT_LIFETIME) storage.removeItem(entry.name);
    }
    if (pendingIntents().length >= 64) throw new Error('Request tracking is busy.');
    const intent = {...record, token:token(), created:now};
    if (kind === 'save' && record.kind === 'tir' && !record.id && !intent.beforeIds && state.monitor?.indexedAt) {
      intent.beforeIds = (state.monitor.records || []).filter(item => item.kind === 'tir').map(item => item.id);
    }
    storage.setItem(`${kind === 'save' ? savePrefix : outboxPrefix}${intent.token}`, JSON.stringify(intent));
    log(kind === 'save' ? 'save-intent' : 'submission-intent', {kind:record.kind,id:record.id,number:record.number,created:now});
    void update('outbox').catch(() => {});
  }
  return {
    key, account, ready,
    read: () => structuredClone(state),
    refresh: () => update('read'),
    setToastPopups: enabled => update('popup-setting', {enabled}),
    bypassPopups: ids => update('bypass-popups', {ids}),
    retainPopup: request => update('retain-popup', request),
    saveMonitor: monitor => update('save-schedule', {monitor}),
    registerSave(record) { if (!disposed && ['sample','tir'].includes(record.kind)) capture('save', record); },
    registerSubmission(record) {
      if (disposed) return;
      const valid = submissionRecord(record);
      if (!valid) throw new Error('Invalid submission record.');
      capture('submission', valid);
    },
    advanceReminders: options => update('reminders', options),
    observeStatuses: (records, options = {}) => update('statuses', {records,options}),
    observe: (record, time) => update('observe', {record,time}),
    dismiss: (id, mute = false) => update(mute ? 'silence' : 'dismiss', {id}),
    silence: ids => update('silence-all', {ids}),
    clear: ids => update('clear', {ids}),
    claim: async id => Boolean((await update('claim', {id})).claimed),
    release: id => update('release', {id}),
    delivered: id => update('delivered', {id}),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    destroy() {
      disposed = true; listeners.clear();
      api.storage.onChanged.removeListener(changed); events.removeEventListener('storage', outboxChanged);
    },
  };
}
