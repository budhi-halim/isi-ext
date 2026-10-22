export const ACCOUNT_SCOPE = 'islandsun.account-scope';

/** An outage preserves the last account; a confirmed sign-out locks its saved views. */
export function scopedAccount(scope, fallback = {}) {
  return scope ? scope.account || '' : fallback.account || '';
}

let updates = Promise.resolve();
export function setAccountScope(account, name = '', observedAt = Date.now()) {
  const result = updates.then(async () => {
    const previous = (await chrome.storage.local.get(ACCOUNT_SCOPE))[ACCOUNT_SCOPE];
    if (previous?.observedAt > observedAt) return;
    const next = {account:account || '', name:account ? name || account : '', observedAt};
    await chrome.storage.local.set({[ACCOUNT_SCOPE]:next});
  });
  updates = result.catch(() => {});
  return result;
}

export function startAccountScope({observeAuthentication = async () => {}} = {}) {
  let chain = Promise.resolve();
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== 'portal-account-observed' || sender.id !== chrome.runtime.id) return;
    try { if (new URL(sender.url).origin !== 'http://apps.islandsunindonesia.com:81') return; } catch { return; }
    if (typeof message.account !== 'string' || message.account.length > 200 || typeof message.name !== 'string' || message.name.length > 300
      || !Number.isFinite(message.observedAt) || message.observedAt > Date.now() + 1000) return;
    let responded = false;
    const result = chain.then(async () => {
      await setAccountScope(message.account, message.name, message.observedAt);
      respond({ok:true}); responded = true;
      await observeAuthentication(message,sender);
    });
    chain = result.catch(() => {});
    result.catch(() => { if (!responded) respond({ok:false}); });
    return true;
  });
}
