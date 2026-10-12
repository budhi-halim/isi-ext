import { UPDATE_KEY, UPDATE_FEED, CHECK_INTERVAL, emptyUpdateState, parseUpdateFeed, familyInventory, reconcileUpdates, compareVersions } from './update-logic.js';

const ALARM = 'islandsun-version-check';
const MAX_FEED_BYTES = 65536;

async function fetchCatalog(fetcher) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetcher(UPDATE_FEED, { signal: controller.signal, credentials: 'omit', cache: 'no-cache', redirect: 'error' });
    if (!response.ok || Number(response.headers.get('content-length')) > MAX_FEED_BYTES) throw new Error('Version feed unavailable.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let total = 0, text = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_FEED_BYTES) { await reader.cancel(); throw new Error('Version feed too large.'); }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally { reader.releaseLock(); }
    return parseUpdateFeed(JSON.parse(text));
  } finally { clearTimeout(timer); }
}

/** The worker is the only writer. Network work never blocks notification dismissal or uses the company session. */
export function startUpdateService({ key, discoverFamily = false, api = chrome, fetcher = fetch, now = Date.now } = {}) {
  let serial = Promise.resolve(), checking, inventoryGeneration = 0;
  const ownVersion = api.runtime.getManifest().version;
  const ownInventory = { [key]: { version: ownVersion, enabled: true } };
  function transaction(task) {
    const result = serial.then(async () => {
      const stored = (await api.storage.local.get(UPDATE_KEY))[UPDATE_KEY];
      const state = stored?.schema === 1 ? stored : emptyUpdateState();
      const before = JSON.stringify(state);
      const result = await task(state);
      if (JSON.stringify(state) !== before) await api.storage.local.set({ [UPDATE_KEY]: state });
      return result;
    });
    serial = result.catch(() => {});
    return result;
  }
  async function inventory() {
    if (!discoverFamily || !await api.permissions.contains({ permissions: ['management'] })) return ownInventory;
    return { ...familyInventory(await api.management.getAll()), ...ownInventory };
  }
  async function refreshInventory() {
    const generation = ++inventoryGeneration;
    const installed = await inventory();
    return transaction(state => {
      if (generation === inventoryGeneration) Object.assign(state, reconcileUpdates(state, installed, now(), discoverFamily));
      return structuredClone(state);
    });
  }
  function check() {
    if (checking) return checking;
    checking = (async () => {
      await refreshInventory();
      const due = await transaction(state => {
        // Bound persisted deadlines when a release shortens the check interval.
        const lastAttempt = Math.max(Number(state.attemptedAt) || 0, Number(state.checkedAt) || 0);
        state.nextCheck = Math.min(Number(state.nextCheck) || 0, lastAttempt + CHECK_INTERVAL);
        if (state.nextCheck > now()) return false;
        state.attemptedAt = now(); state.nextCheck = now() + 60000;
        return true;
      });
      if (!due) return;
      try {
        const catalog = await fetchCatalog(fetcher);
        await transaction(state => {
          for (const [id, entry] of Object.entries(catalog)) {
            if (!state.catalog[id] || compareVersions(entry.version, state.catalog[id].version) >= 0) state.catalog[id] = entry;
          }
          state.checkedAt = now(); state.nextCheck = now() + CHECK_INTERVAL; state.failures = 0; state.status = 'ready';
          Object.assign(state, reconcileUpdates(state, state.inventory, now(), discoverFamily));
        });
      } catch {
        await transaction(state => {
          state.failures = Math.min(10, (state.failures || 0) + 1); state.status = 'unavailable';
          state.nextCheck = now() + Math.min(CHECK_INTERVAL, 30 * 60000 * 2 ** (state.failures - 1));
        });
      }
    })().finally(async () => {
      try { await scheduleNextCheck(); }
      finally { checking = null; }
    });
    return checking;
  }
  const safelyCheck = () => { void check().catch(() => {}); };
  function trusted(sender) {
    if (sender.id !== api.runtime.id) return false;
    try {
      const url = new URL(sender.url || sender.tab?.url);
      return url.origin === new URL(api.runtime.getURL('')).origin || (discoverFamily && url.origin === 'http://apps.islandsunindonesia.com:81' && url.pathname.startsWith('/islandsun/'));
    } catch { return false; }
  }
  async function handle(message, sender) {
    if (message.action === 'status') {
      safelyCheck();
      return transaction(state => ({ ok: true, state: structuredClone(state) }));
    }
    if (!discoverFamily) return { ok: false };
    if (!['clear', 'reset', 'claim', 'release', 'delivered', 'dismiss'].includes(message.action)) return { ok: false };
    if (!['clear','reset'].includes(message.action) && (typeof message.id !== 'string' || message.id.length > 150 || !message.id.startsWith('extension-update:'))) return { ok: false };
    const owner = `${sender.tab?.id ?? 'popup'}:${sender.documentId ?? ''}:${message.owner}`;
    if (typeof message.owner !== 'string' || message.owner.length > 100) return { ok: false };
    return transaction(state => {
      const item = Object.hasOwn(state.notices, message.id) ? state.notices[message.id] : null;
      let claimed = false;
      if (message.action === 'claim' && item && !item.delivered && (!item.claim || item.claim.until <= now() || item.claim.owner === owner)) {
        item.claim = { owner, until: now() + 15000 }; claimed = true;
      } else if (message.action === 'release' && item?.claim?.owner === owner) delete item.claim;
      else if (message.action === 'delivered' && item?.claim?.owner === owner) { item.delivered = true; delete item.claim; }
      else if (message.action === 'dismiss') delete state.notices[message.id];
      else if (message.action === 'clear') state.notices = {};
      else if (message.action === 'reset') { state.notices = {}; state.reminders = {}; }
      return { ok: true, claimed, state: structuredClone(state) };
    });
  }
  api.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== 'islandsun-updates' || !trusted(sender)) return false;
    handle(message, sender).then(respond, () => respond({ ok: false }));
    return true;
  });
  api.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) safelyCheck(); });
  async function scheduleNextCheck() {
    const state = (await api.storage.local.get(UPDATE_KEY))[UPDATE_KEY];
    const when = Math.max(now() + 1000, Number(state?.nextCheck) || now() + CHECK_INTERVAL);
    const periodInMinutes = CHECK_INTERVAL / 60000;
    const alarm = await api.alarms.get(ALARM);
    if (alarm?.periodInMinutes !== periodInMinutes || Math.abs((alarm.scheduledTime ?? alarm.when ?? 0) - when) > 1000) {
      await api.alarms.create(ALARM, { when, periodInMinutes });
    }
  }
  api.runtime.onInstalled.addListener(safelyCheck);
  api.runtime.onStartup.addListener(safelyCheck);
  if (discoverFamily) {
    const changed = () => { void refreshInventory().catch(() => {}); safelyCheck(); };
    api.permissions.onAdded.addListener(changed); api.permissions.onRemoved.addListener(changed);
    for (const event of ['onInstalled', 'onUninstalled', 'onEnabled', 'onDisabled']) api.management?.[event]?.addListener(changed);
  }
  safelyCheck();
  return { check, refreshInventory };
}
