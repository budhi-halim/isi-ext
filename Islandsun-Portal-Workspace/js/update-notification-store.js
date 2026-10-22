import { UPDATE_KEY, UPDATE_PAGE } from './shared/update-logic.js';

/** Merge browser-wide update history with the active account's operational history. */
export function withUpdateNotifications(store, { onError = () => {} } = {}) {
  let updates = {}, disposed = false;
  const listeners = new Set();
  const owner = [...crypto.getRandomValues(new Uint32Array(4))].join('-');
  const isUpdate = id => id.startsWith('extension-update:');
  const read = () => { const state = store.read(); return { ...state, notices: { ...state.notices, ...updates } }; };
  const publish = () => {
    if (disposed) return;
    let state;
    try { state = read(); } catch (error) { onError(error); return; }
    for (const listener of listeners) { try { listener(state); } catch (error) { onError(error); } }
  };
  function accept(state) {
    if (disposed) return;
    updates = Object.fromEntries(Object.entries(state?.notices || {}).filter(([id, item]) => isUpdate(id) && item.type === 'update' && item.url === UPDATE_PAGE));
    publish();
  }
  async function send(action, id) {
    const result = await chrome.runtime.sendMessage({ type: 'islandsun-updates', action, id, owner });
    if (!result?.ok) throw new Error('Update history could not be saved.');
    // Storage events own subsequent snapshots so an older message reply cannot undo a newer mutation.
    return result;
  }
  const changed = (changes, area) => { if (area === 'local' && changes[UPDATE_KEY]) accept(changes[UPDATE_KEY].newValue); };
  chrome.storage.onChanged.addListener(changed);
  const unsubscribe = store.subscribe(publish);
  let observed = false;
  const observedChange = (changes, area) => { if (area === 'local' && changes[UPDATE_KEY]) observed = true; };
  chrome.storage.onChanged.addListener(observedChange);
  void chrome.storage.local.get(UPDATE_KEY).then(value => { if (!observed) accept(value[UPDATE_KEY]); }).catch(onError).finally(() => chrome.storage.onChanged.removeListener(observedChange));
  void send('status').catch(onError);
  return {
    read,
    dismiss: (id, mute) => isUpdate(id) ? send('dismiss', id) : store.dismiss(id, mute),
    silence: ids => store.silence(ids.filter(id => !isUpdate(id))),
    clear: async (ids = Object.keys(read().notices)) => {
      await store.clear(ids.filter(id => !isUpdate(id)));
      for (const id of ids.filter(isUpdate)) await send('dismiss', id);
    },
    reset: async () => { await store.reset(); await send('reset'); },
    claim: async id => isUpdate(id) ? (await send('claim', id)).claimed : store.claim(id),
    delivered: id => isUpdate(id) ? send('delivered', id) : store.delivered(id),
    release: id => isUpdate(id) ? send('release', id) : store.release(id),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    destroy() { disposed = true; listeners.clear(); unsubscribe(); chrome.storage.onChanged.removeListener(changed); chrome.storage.onChanged.removeListener(observedChange); },
  };
}
