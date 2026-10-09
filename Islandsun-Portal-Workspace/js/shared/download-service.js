import { documentFilename, documentParts, dispositionFilename, downloadLabel, downloadUrl, namedDownloadUrl, portalUrl } from './document-names.js';

/** Persist URL metadata across worker suspension; every message is revalidated here. */
export function startDownloadService({ ownDownloadsOnly = false } = {}) {
  let serial = Promise.resolve();
  const jobs = new Set();
  const key = 'documentMappings';
  const lifetime = 24 * 60 * 60 * 1000;
  const supported = item => downloadUrl(item.url) || downloadUrl(item.finalUrl);
  const trusted = sender => sender.id === chrome.runtime.id && portalUrl(sender.url || sender.tab?.url);

  async function register(documents) {
    const mappings = (await chrome.storage.session.get(key))[key] || {};
    const now = Date.now();
    for (const [url, entry] of Object.entries(mappings)) if (now - entry.time > lifetime) delete mappings[url];
    for (const item of documents) {
      const url = downloadUrl(item?.url);
      if (url && typeof item.label === 'string' && item.label.length < 5000 && documentParts(item.label)) mappings[url] = { label: item.label, time: now };
    }
    const bounded = Object.fromEntries(Object.entries(mappings).sort((a, b) => b[1].time - a[1].time).slice(0, 500));
    await chrome.storage.session.set({ [key]: bounded });
  }

  // Native links and extension batches share one filename owner.
  // The explicit-name mode remains available for callers delegating native downloads.
  if (!ownDownloadsOnly) chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    const url = supported(item);
    const delegatedLabel = item.byExtensionId && item.byExtensionId !== chrome.runtime.id ? downloadLabel(item.url) : null;
    if (!url || (item.byExtensionId && item.byExtensionId !== chrome.runtime.id && !delegatedLabel)) { suggest(); return; }
    (async () => {
      const { enabled = true } = await chrome.storage.local.get('enabled');
      if (!enabled && !delegatedLabel) return null;
      if (/^(text\/html|application\/xhtml\+xml)(?:;|$)/i.test(item.mime || '') || (item.finalUrl && !downloadUrl(item.finalUrl))) {
        await chrome.downloads.cancel(item.id);
        return null;
      }
      if (delegatedLabel) return documentFilename(delegatedLabel, item.filename, item.mime);
      await serial;
      const entry = (await chrome.storage.session.get(key))[key]?.[url];
      return entry && Date.now() - entry.time < lifetime ? documentFilename(entry.label, item.filename, item.mime) : null;
    })().then(filename => suggest(filename ? { filename, conflictAction: 'uniquify' } : undefined), () => suggest());
    return true;
  });

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!trusted(sender) || !['register-documents', 'download-documents'].includes(message?.type)) return;
    if (!Array.isArray(message.documents) || message.documents.length > 100 || message.documents.some(item => typeof item?.label !== 'string' || item.label.length >= 5000 || !downloadUrl(item?.url) || !documentParts(item.label))) { respond({ error: 'The document links could not be verified.' }); return; }
    const task = serial.then(() => register(message.documents));
    serial = task.catch(() => {});
    (async () => {
      await task;
      if (message.type === 'register-documents') return { registered: true };
      const { enabled = true } = await chrome.storage.local.get('enabled');
      if (!enabled) return { error: 'Enable the extension to download named documents.' };
      const tabId = sender.tab?.id;
      if (!Number.isInteger(tabId) || jobs.has(tabId)) return { error: 'A download batch is already starting. Please wait.' };
      jobs.add(tabId);
      const started = [], failed = [];
      try {
        for (const document of new Map(message.documents.map(item => [item.url, item])).values()) {
          try {
            const filename = ownDownloadsOnly ? await resolveFilename(document) : undefined;
            started.push(await chrome.downloads.download({ url: ownDownloadsOnly ? namedDownloadUrl(document.url, document.label) : document.url, ...(filename ? {filename} : {}), conflictAction: 'uniquify', saveAs: false }));
          }
          catch { failed.push(document.label); }
        }
        return { started: started.length, failed: failed.length };
      } finally { jobs.delete(tabId); }
    })().then(respond, () => respond({ error: 'Downloads could not start. Check your connection and browser download settings.' }));
    return true;
  });
}

/** Read only response headers; preserve the server's real extension before a batch download. */
async function resolveFilename(document) {
  const signal = AbortSignal.timeout(15000);
  let response = await fetch(document.url, { method: 'HEAD', credentials: 'include', signal });
  if ([405, 501].includes(response.status)) response = await fetch(document.url, { credentials: 'include', signal });
  try {
    const mime = response.headers.get('content-type') || '';
    if (!response.ok || !downloadUrl(response.url) || /^(text\/html|application\/xhtml\+xml)(?:;|$)/i.test(mime)) throw new Error('The document is unavailable or your session has expired.');
    const original = dispositionFilename(response.headers.get('content-disposition'));
    const filename = documentFilename(document.label, original, mime);
    if (!filename) throw new Error('The document filename is unavailable.');
    return filename;
  } finally { await response.body?.cancel(); }
}
