import { PORTAL_ORIGIN } from './shared/document-names.js';
import { isTirSourceUrl } from './tir-source-logic.js';
import { ACCOUNT_SCOPE } from './account-scope.js';
import { recordKind } from './fetch-policy.js';

const PREFIX = 'islandsun.product-cache.';
let serviceStore;
export async function clearProductSessions(account = null) { await serviceStore?.clear(account); }

function validUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === PORTAL_ORIGIN && (isTirSourceUrl(value)
      || /^\/islandsun\/master\/tir\/edit\/\d+$/i.test(url.pathname)
      || (/^\/islandsun\/samplerequest\/edit$/i.test(url.pathname) && /^\d+$/.test(url.searchParams.get('id')) && /^[1-5]$/.test(url.searchParams.get('srtype'))));
  } catch { return false; }
}

function validRecord(record) {
  return record && typeof record.account === 'string' && record.account.length > 0 && record.account.length <= 200
    && validUrl(record.url) && Number.isFinite(record.fetched) && record.fetched > 0
    && Array.isArray(record.value?.products) && record.value.products.length <= 2000
    && record.value.products.every(product => typeof product?.name === 'string' && product.name.length <= 10000
      && (product.code === null || typeof product.code === 'string' && product.code.length <= 10000));
}

/** A single owner bounds session storage across accounts, tabs and all preview types. */
export function createProductSessionStore(storage, { maxEntries = 300, maxBytes = 8 * 1024 * 1024 } = {}) {
  const entries = new Map();
  let bytes = 0;
  const sizeOf = (key, value) => {
    const text = JSON.stringify(value);
    return Math.max(new TextEncoder().encode(text).byteLength, text.length * 2) + key.length * 2 + 256;
  };
  let chain = storage.get(null).then(async data => {
    const saved = Object.entries(data).filter(([key]) => key.startsWith(PREFIX));
    const invalid = saved.filter(([, record]) => !validRecord(record)).map(([key]) => key);
    if (invalid.length) await storage.remove(invalid);
    for (const [key, record] of saved.filter(([, record]) => validRecord(record)).sort((a, b) => a[1].fetched - b[1].fetched)) {
      const size = sizeOf(key, record);
      entries.set(key, { record, size }); bytes += size;
    }
    await trim();
  });
  function serialized(task) {
    const result = chain.then(task);
    chain = result.catch(() => {});
    return result;
  }
  async function trim(reserve = 0, replacingKey = null) {
    const removed = [];
    let remainingBytes = bytes - (entries.get(replacingKey)?.size || 0);
    let remainingCount = entries.size - (entries.has(replacingKey) ? 1 : 0);
    const candidates = [...entries].filter(([key]) => key !== replacingKey).sort((a, b) => a[1].record.fetched - b[1].record.fetched);
    for (const [key, item] of candidates) {
      if (remainingCount <= maxEntries - (reserve > 0 ? 1 : 0) && remainingBytes + reserve <= maxBytes) break;
      remainingBytes -= item.size; remainingCount--; removed.push(key);
    }
    if (removed.length) {
      await storage.remove(removed);
      for (const key of removed) { bytes -= entries.get(key).size; entries.delete(key); }
    }
  }
  return {
    clear(account = null) { return serialized(async () => {
      const removed = [...entries].filter(([,item]) => account === null || item.record.account === account);
      await storage.remove(removed.map(([key]) => key));
      for (const [key,item] of removed) { entries.delete(key); bytes -= item.size; }
    }); },
    read(account) { return serialized(() => [...entries.values()].filter(item => item.record.account === account).map(item => item.record)); },
    write(record) {
      return serialized(async () => {
        if (!validRecord(record)) throw new Error('Invalid product cache record');
        const key = PREFIX + JSON.stringify([record.account, record.url]);
        const size = sizeOf(key, record);
        if (size > maxBytes) return false;
        const previous = entries.get(key);
        if (previous?.record.fetched > record.fetched) return false;
        await trim(size, key);
        await storage.set({ [key]: record });
        if (previous) { entries.delete(key); bytes -= previous.size; }
        entries.set(key, { record, size }); bytes += size;
        const limit = Math.max(5,Math.min(100,Number(record.pageSize) || 10)) * 3;
        const sameKind = [...entries].filter(([,item]) => item.record.account === record.account && recordKind(item.record.url) === recordKind(record.url));
        const excess = sameKind.sort((a,b) => a[1].record.fetched - b[1].record.fetched).slice(0,Math.max(0,sameKind.length-limit));
        if (excess.length) {
          await storage.remove(excess.map(([key]) => key));
          for (const [key,item] of excess) { entries.delete(key); bytes -= item.size; }
        }
        return true;
      });
    }
  };
}

export function startProductSessionService() {
  const store = createProductSessionStore(chrome.storage.session);
  serviceStore = store;
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!['product-cache-read', 'product-cache-write'].includes(message?.type)) return;
    try { if (new URL(sender.url).origin !== PORTAL_ORIGIN) return; } catch { return; }
    if (typeof message.account !== 'string' || !message.account || message.account.length > 200) return;
    const operation = (async () => {
      const scope = (await chrome.storage.local.get(ACCOUNT_SCOPE))[ACCOUNT_SCOPE];
      if (scope && scope.account !== message.account) throw new Error('The signed-in account changed.');
      const reset = (await chrome.storage.local.get('islandsun.archive-reset'))['islandsun.archive-reset'];
      if (message.type === 'product-cache-write' && reset && (!reset.account || reset.account === message.account)
        && (reset.clearing || (message.record?.startedAt || message.record?.fetched || 0) <= reset.at)) return false;
      const value = message.type === 'product-cache-read' ? await store.read(message.account) : await store.write({ ...message.record, account: message.account });
      const current = (await chrome.storage.local.get(ACCOUNT_SCOPE))[ACCOUNT_SCOPE];
      if (current && current.account !== message.account) throw new Error('The signed-in account changed.');
      return value;
    })();
    operation.then(value => respond({ ok: true, value }), () => respond({ ok: false }));
    return true;
  });
}
