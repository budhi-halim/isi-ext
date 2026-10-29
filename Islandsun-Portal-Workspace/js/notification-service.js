import { ACCOUNT_SCOPE } from './account-scope.js';
import { portalOrigin, portalUrl } from './shared/portal-address.js';
import { emptyNotificationState } from './notification-logic.js';
import { notificationKey, mergeNotificationHistory, recoverNotificationActions, validateNotificationHistory } from './notification-history.js';
import { applyNotificationIntents, mutateNotifications } from './notification-mutations.js';
import { appendJournal, notificationJournalActions } from './diagnostic-journal-store.js';

/** One worker owns each account's history across both website origins and every portal tab. */
export function createNotificationService({storage, readActions = notificationJournalActions, log = appendJournal}) {
  const operations = new Map();
  async function execute(message, {origin, tabId, assertAccount = async () => {}}) {
    const {account, action, owner, payload = {}, pending = []} = message;
    const key = notificationKey(account);
    let stage = 'read';
    try {
      await assertAccount();
      const saved = (await storage.get(key))[key];
      if (saved && (saved.version !== 2 || !Number.isSafeInteger(saved.revision))) throw new Error('Notification history could not be read.');
      let state = saved ? validateNotificationHistory(saved.state) : emptyNotificationState();
      const previous = structuredClone(state);
      const migrated = {...saved?.migrated}, handled = {...saved?.handled};
      let recovered = saved?.recovered || false;
      stage = 'migration';
      if (action === 'initialize' && !migrated[origin]) {
        if (payload.legacy) state = mergeNotificationHistory(state, payload.legacy);
        migrated[origin] = true;
      }
      if (!recovered) {
        state = recoverNotificationActions(state, await readActions(account));
        recovered = true;
      }
      stage = 'update';
      state = applyNotificationIntents(state, pending, handled);
      const result = mutateNotifications(state, action, payload, owner);
      state = result.state;
      const removedIds = Object.keys(previous.notices).filter(id => !state.notices[id]);
      const silencedKeys = Object.keys(state.muted).filter(id => !previous.muted[id]);
      if (['dismiss','silence','silence-all','clear'].includes(action)) {
        state.removedNotices ||= {};
        for (const id of removedIds) state.removedNotices[id] = Date.now();
      }
      if (state.removedNotices) {
        const oldest = Object.entries(state.removedNotices).sort((a,b) => b[1] - a[1]);
        for (const [id] of oldest.slice(5000)) delete state.removedNotices[id];
      }
      const data = {version:2,state,migrated,handled,recovered};
      const before = saved && JSON.stringify({...saved, revision:undefined});
      const changed = before !== JSON.stringify(data);
      const record = {...data,revision:(saved?.revision || 0) + (changed ? 1 : 0)};
      stage = 'write';
      await assertAccount();
      if (changed) await storage.set({[key]:record});
      // Only committed changes become evidence; diagnostic failures cannot undo a saved action.
      const note = (event, fields) => log(account,event,{...fields,tabId}).catch(() => {});
      if (action === 'initialize' && !saved?.migrated?.[origin]) {
        await note('notification-history-migrated',{origin,imported:!!payload.legacy,notices:Object.keys(state.notices).length,silenced:Object.keys(state.muted).length});
      }
      if (['dismiss','silence','silence-all','clear'].includes(action)) {
        for (let index=0; index<Math.max(removedIds.length,silencedKeys.length,1); index+=100) {
          await note('notification-action-saved',{operation:action,removedIds:removedIds.slice(index,index+100),silencedKeys:silencedKeys.slice(index,index+100)});
        }
      }
      if (action !== 'initialize') {
        for (const [id,item] of Object.entries(state.notices)) if (!previous.notices[id]) await note('notification-created',{id,key:item.key,type:item.type,customer:item.customer});
      }
      for (const id of removedIds) await note('notification-removed',{id});
      for (const [recordKey,item] of Object.entries(state.submissions || {})) {
        if (item.confirmed && !previous.submissions?.[recordKey]?.confirmed) await note('submission-confirmed',{kind:item.kind,number:item.number,key:recordKey});
      }
      for (const [recordKey,item] of Object.entries(state.drafts || {})) {
        if (item.savedAt !== previous.drafts?.[recordKey]?.savedAt) await note('draft-save-observed',{key:recordKey,number:item.number,savedAt:item.savedAt,reminderAt:item.savedAt+300000});
      }
      return {record,claimed:result.claimed};
    } catch (error) {
      await log(account,'notification-history-failed',{operation:action,stage,errorType:error.name,message:String(error.message).slice(0,500),tabId}).catch(() => {});
      throw error;
    }
  }
  return {
    run(message, context) {
      const previous = operations.get(message.account) || Promise.resolve();
      const next = previous.catch(() => {}).then(() => execute(message,context));
      operations.set(message.account,next);
      void next.finally(() => { if (operations.get(message.account) === next) operations.delete(message.account); }).catch(() => {});
      return next;
    },
  };
}

export function startNotificationService(api = chrome) {
  const service = createNotificationService({storage:api.storage.local});
  api.runtime.onMessage.addListener((message,sender,respond) => {
    if (message?.type !== 'islandsun-notifications') return;
    if (sender.id !== api.runtime.id || sender.frameId !== 0 || !portalUrl(sender.url)
      || typeof message.account !== 'string' || !message.account || message.account.length > 200
      || typeof message.owner !== 'string' || !/^[\w-]{1,150}$/.test(message.owner)
      || !Array.isArray(message.pending) || message.pending.length > 64) return;
    const assertAccount = async () => {
      const scope = (await api.storage.local.get(ACCOUNT_SCOPE))[ACCOUNT_SCOPE];
      if (scope?.account !== message.account) throw Object.assign(new Error('The signed-in account changed.'),{code:'ACCOUNT_CHANGED'});
    };
    service.run(message,{origin:portalOrigin(sender.url),tabId:sender.tab?.id,assertAccount}).then(
      value => respond({ok:true,...value}),
      error => respond({ok:false,code:error.code === 'ACCOUNT_CHANGED' ? error.code : 'NOTIFICATION_STORAGE'}),
    );
    return true;
  });
}
