import { OFFLINE_SOURCES } from './offline-config.js';
import { vaultKey } from './offline-vault.js';

/** Own export work and discard decrypted output on cancellation or account changes. */
export function createSourceExport({getAccount}) {
  const panel = document.querySelector('#archive-sources');
  const section = panel.querySelector('[data-source-section]');
  const prepare = panel.querySelector('[data-source-prepare]');
  const cancel = panel.querySelector('[data-source-cancel]');
  const download = panel.querySelector('[data-source-download]');
  const status = panel.querySelector('[data-source-status]');
  for (const [kind, config] of Object.entries(OFFLINE_SOURCES)) section.add(new Option(config.title, kind));
  let worker = null, generation = 0, result = null, downloadUrl = null;

  function clear() {
    generation++;
    worker?.terminate(); worker = null; result = null;
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = null;
    prepare.disabled = false; section.disabled = false; cancel.disabled = true; download.disabled = true;
    status.textContent = 'Choose a section to export its saved source responses. This does not contact the portal.';
  }
  function fail() {
    clear();
    status.textContent = 'The source export could not finish. Reopen this saved account and try again.';
  }
  prepare.addEventListener('click', async () => {
    const account = getAccount(), kind = section.value;
    if (!account || prepare.disabled) return;
    clear();
    const current = generation;
    prepare.disabled = true; section.disabled = true; cancel.disabled = false;
    status.textContent = 'Reading saved source responses…';
    try {
      const secret = await vaultKey(account);
      if (current !== generation || account !== getAccount()) return;
      worker = new Worker(new URL('./offline-source-export-worker.js', import.meta.url), {type:'module'});
      worker.onerror = () => { if (current === generation && account === getAccount()) fail(); };
      worker.onmessage = ({data}) => {
        if (current !== generation || account !== getAccount()) return;
        if (data.error) { fail(); return; }
        if (data.progress) status.textContent = `${data.progress.records} records checked · ${data.progress.sources} saved responses collected…`;
        if (data.result) {
          result = data.result;
          worker.terminate(); worker = null;
          prepare.disabled = false; section.disabled = false; cancel.disabled = true;
          download.disabled = result.counts.sources === 0 && result.counts.failed === 0;
          const counts = result.counts;
          status.textContent = `Ready: ${counts.sources} saved responses · ${counts.missing} not yet captured · ${counts.failed} could not be read. No new responses were fetched.`;
        }
      };
      worker.postMessage({account, kind, version:chrome.runtime.getManifest().version, vaultKey:secret});
    } catch {
      if (current === generation) fail();
    }
  });
  cancel.addEventListener('click', () => { clear(); status.textContent = 'Source export cancelled. Your saved archive is unchanged.'; });
  section.addEventListener('change', clear);
  download.addEventListener('click', () => {
    if (!result) return;
    downloadUrl ??= URL.createObjectURL(result.blob);
    const link = document.createElement('a');
    link.href = downloadUrl; link.download = result.filename;
    document.body.append(link); link.click(); link.remove();
    status.textContent = 'Source export download requested. This file contains private business data; share it only for this investigation.';
  });
  window.addEventListener('pagehide', clear);
  clear();
  return {clear};
}
