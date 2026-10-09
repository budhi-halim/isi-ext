export const UPDATE_KEY = 'islandsun.extension-updates.v1';
export const UPDATE_FEED = 'https://budhi-halim.github.io/isi-ext/extension-versions.json';
export const UPDATE_PAGE = 'https://budhi-halim.github.io/isi-ext/';
export const CHECK_INTERVAL = 6 * 60 * 60 * 1000;
export const REMINDER_INTERVAL = 7 * 24 * 60 * 60 * 1000;
export const FAMILY_EXTENSIONS = {
  workspace: { name: 'Islandsun Portal Workspace', directory: 'Islandsun-Portal-Workspace' },
  revenue: { name: 'IslandSun Revenue Extractor', directory: 'Islandsun-Revenue' },
  feedback: { name: 'Islandsun AutoFeedback', directory: 'IslandSun-AutoFeedback' },
};

export function versionParts(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,4})(\.(0|[1-9]\d{0,4})){0,3}$/.test(value)) return null;
  const parts = value.split('.').map(Number);
  return parts.every(part => part <= 65535) ? [...parts, ...Array(4 - parts.length).fill(0)] : null;
}

export function compareVersions(left, right) {
  const a = versionParts(left), b = versionParts(right);
  if (!a || !b) throw new Error('Invalid extension version.');
  for (let i = 0; i < 4; i++) if (a[i] !== b[i]) return Math.sign(a[i] - b[i]);
  return 0;
}

export function parseUpdateFeed(value) {
  if (value?.schema !== 1 || !value.extensions || typeof value.extensions !== 'object') throw new Error('Invalid version feed.');
  const catalog = {};
  for (const key of Object.keys(FAMILY_EXTENSIONS)) {
    const entry = value.extensions[key];
    if (!entry || !versionParts(entry.version)) throw new Error('Incomplete version feed.');
    catalog[key] = { version: entry.version };
  }
  return catalog;
}

/** Unpacked extension IDs vary by installation path; recognize only exact family names and portal access. */
export function familyInventory(entries) {
  const inventory = {};
  for (const [key, family] of Object.entries(FAMILY_EXTENSIONS)) {
    const matches = entries.filter(entry => entry.type === 'extension' && entry.name === family.name && versionParts(entry.version)
      && entry.hostPermissions?.some(host => /^(?:http|https|\*):\/\/apps\.islandsunindonesia\.com\/\*$/.test(host)));
    if (!matches.length) continue;
    matches.sort((a, b) => compareVersions(a.version, b.version));
    inventory[key] = { version: matches[0].version, enabled: matches.some(entry => entry.enabled) };
  }
  return inventory;
}

export function emptyUpdateState() {
  return { schema: 1, catalog: {}, inventory: {}, reminders: {}, notices: {}, checkedAt: 0, attemptedAt: 0, nextCheck: 0, failures: 0, status: 'unchecked' };
}

/** One current notice per installed family member; dismissal never erases the seven-day clock. */
export function reconcileUpdates(previous, inventory, now, notifications) {
  const state = structuredClone(previous);
  state.inventory = inventory;
  for (const key of Object.keys(state.reminders)) if (!Object.hasOwn(FAMILY_EXTENSIONS, key)) delete state.reminders[key];
  for (const [id, notice] of Object.entries(state.notices)) if (!Object.hasOwn(FAMILY_EXTENSIONS, notice.extension)) delete state.notices[id];
  for (const key of Object.keys(FAMILY_EXTENSIONS)) {
    const installed = inventory[key], latest = state.catalog[key];
    const pending = installed && latest && compareVersions(latest.version, installed.version) > 0;
    if (!pending || !notifications) {
      delete state.reminders[key];
      for (const [id, notice] of Object.entries(state.notices)) if (notice.extension === key) delete state.notices[id];
      continue;
    }
    const previousReminder = state.reminders[key];
    const newer = !previousReminder || compareVersions(latest.version, previousReminder.version) > 0;
    // A stale CDN response cannot roll a known release backwards or restart its clock.
    if (previousReminder && compareVersions(latest.version, previousReminder.version) < 0) continue;
    if (!newer && now - previousReminder.notifiedAt < REMINDER_INTERVAL) continue;
    for (const [id, notice] of Object.entries(state.notices)) if (notice.extension === key) delete state.notices[id];
    const id = `extension-update:${key}:${latest.version}:${now}`;
    state.notices[id] = { id, extension: key, type: 'update', created: now, message: `${FAMILY_EXTENSIONS[key].name}: version ${latest.version} is available.`, url: UPDATE_PAGE };
    state.reminders[key] = { version: latest.version, notifiedAt: now };
  }
  return state;
}
