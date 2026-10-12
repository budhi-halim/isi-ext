import { emptyNotificationState, observeRecord, dismissNotification } from './notification-logic.js';
import { acquireLocalLock } from './local-lock.js';
import { registerSubmission, observeSubmissionStatuses, submissionRecord, SUBMISSION_INTENT_LIFETIME } from './submission-logic.js';
import { pruneNotificationState } from './notification-relevance.js';

/** A same-origin lock serializes localStorage updates across portal tabs. */
export function createNotificationStore(account, { storage = localStorage, locks = navigator.locks, onError = () => {} } = {}) {
  const key = `islandsun.portal.notifications.v1:${encodeURIComponent(account)}`;
  const outboxPrefix = `${key}:submission:`;
  const listeners = new Set();
  const owner = [...crypto.getRandomValues(new Uint32Array(4))].join('-');
  let disposed = false;
  function read() {
    const text = storage.getItem(key);
    if (!text) return emptyNotificationState();
    const value = JSON.parse(text);
    if (value?.version !== 1 || !value.jobs || !value.notices || !value.muted) throw new Error('Notification history could not be read.');
    return value;
  }
  function publish() { if (!disposed) for (const listener of listeners) listener(read()); }
  function pendingIntents() {
    const entries = [];
    for (let index = 0; index < storage.length; index++) {
      const name = storage.key(index);
      if (name?.startsWith(outboxPrefix)) entries.push(name);
    }
    return entries;
  }
  async function update(transform) {
    const change = () => {
      if (disposed) return;
      let previous = read();
      const before = JSON.stringify(previous), pending = pendingIntents();
      for (const name of pending) {
        try { previous = registerSubmission(previous, JSON.parse(storage.getItem(name))); } catch { /* A malformed outbox entry cannot become a submission. */ }
      }
      const next = pruneNotificationState(transform(previous)), after = JSON.stringify(next);
      if (after !== before) storage.setItem(key, after);
      for (const name of pending) storage.removeItem(name);
      if (after !== before) publish();
      return next;
    };
    try {
      if (locks) return await locks.request(key, change);
      const release = await acquireLocalLock(key);
      try { return change(); } finally { release(); }
    } catch (error) { onError(error); throw error; }
  }
  const changed = event => {
    if (event.key === key) { try { publish(); } catch (error) { onError(error); } }
    else if (event.key?.startsWith(outboxPrefix) && event.newValue) update(state => state).catch(() => {});
  };
  window.addEventListener('storage', changed);
  try {
    const saved = read(), count = Object.keys(saved.notices).length;
    if (Object.keys(pruneNotificationState(saved).notices).length !== count) void update(state => state).catch(() => {});
  } catch (error) { onError(error); }
  return {
    key, read,
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
      update(state => state).catch(() => {});
    },
    observeStatuses: (records, options = {}) => update(state => {
      const observedAt = options.observedAt ?? Date.now();
      if (options.source !== 'page' && observedAt < (state.submissionIndexAt || 0)) return state;
      const next = observeSubmissionStatuses(state, records, { ...options, observedAt });
      if (options.source !== 'page') next.submissionIndexAt = observedAt;
      return next;
    }),
    observe: (record, time) => update(state => observeRecord(state, record, time)),
    dismiss: (id, mute = false) => update(state => dismissNotification(state, id, mute)),
    clear: () => update(state => ({ ...state, notices: {} })),
    reset: () => update(() => emptyNotificationState()),
    async claim(id) {
      let claimed = false;
      await update(state => {
        const item = state.notices[id];
        if (item && !item.delivered && (!item.claim || item.claim.until < Date.now() || item.claim.owner === owner)) {
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
