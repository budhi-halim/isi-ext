const SESSION_KEY = 'islandsun.archive-capture-keys';
const cached = new Map(), seeded = new Map();

function valid(value) {
  return typeof value?.id === 'string' && Array.isArray(value.key) && value.key.length === 32
    && value.key.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255);
}

/** Offscreen parsers receive only the temporary key for this browser's fresh captures. */
export function seedCaptureSession(account, value) {
  if (value == null) seeded.delete(account);
  else {
    if (!valid(value)) throw new Error('The archive capture session is unavailable.');
    seeded.set(account, value);
  }
}

/** This key opens newly fetched working data, never the password-protected historical archive. */
export async function captureSession(account) {
  if (seeded.has(account)) return seeded.get(account);
  if (!account || !globalThis.chrome?.storage?.session) throw new Error('The archive capture session is unavailable.');
  if (!cached.has(account)) cached.set(account, navigator.locks.request(SESSION_KEY, async () => {
    const values = (await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY] || {};
    if (valid(values[account])) return values[account];
    const value = {id:crypto.randomUUID(), key:Array.from(crypto.getRandomValues(new Uint8Array(32)))};
    await chrome.storage.session.set({[SESSION_KEY]:{...values,[account]:value}});
    return value;
  }).catch(error => { cached.delete(account); throw error; }));
  return cached.get(account);
}

export async function clearCaptureSessions(account = null) {
  if (account === null) { cached.clear(); seeded.clear(); }
  else { cached.delete(account); seeded.delete(account); }
  await navigator.locks.request(SESSION_KEY, async () => {
    const values = (await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY] || {};
    if (account !== null) delete values[account];
    await chrome.storage.session.set({[SESSION_KEY]:account === null ? {} : values});
  });
}

globalThis.chrome?.storage?.onChanged?.addListener((changes, area) => {
  if (area === 'session' && changes[SESSION_KEY]) cached.clear();
});
