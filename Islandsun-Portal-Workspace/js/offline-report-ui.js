import { vaultKey } from './offline-vault.js';
import { accountSettingsKey, DEFAULT_ACCOUNT_SETTINGS } from './account-settings.js';
import { formatArchiveReport } from './offline-report.js';

/** Own the report worker and discard all output when the viewer locks. */
export function createArchiveReport({getAccount,getConnection,getActivity = () => ({})}) {
  const panel = document.querySelector('#archive-report');
  const status = panel.querySelector('[data-report-status]');
  const rows = panel.querySelector('tbody');
  const refresh = panel.querySelector('[data-report-refresh]');
  const copy = panel.querySelector('[data-report-copy]');
  const download = panel.querySelector('[data-report-download]');
  const fallback = panel.querySelector('[data-report-text]');
  let worker, generation = 0, report = null, downloadUrl = null;

  function clear() {
    generation++;
    worker?.terminate(); worker = null; report = null;
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = null;
    rows.replaceChildren(); fallback.value = ''; fallback.hidden = true;
    copy.disabled = true; download.disabled = true; refresh.disabled = false;
    status.textContent = 'Generate a local report to see coverage for every section. This does not contact the portal.';
  }
  async function generate() {
    const account = getAccount();
    if (!account || refresh.disabled) return;
    clear();
    const current = generation;
    refresh.disabled = true;
    status.textContent = 'Reading local archive coverage…';
    try {
      const key = accountSettingsKey(account);
      const [saved, secret] = await Promise.all([chrome.storage.local.get({enabled:true,[key]:null}),vaultKey(account)]);
      if (current !== generation || account !== getAccount()) return;
      const preferences = saved[key] || {};
      const settings = {enabled:Boolean(saved.enabled)};
      for (const name of Object.keys(DEFAULT_ACCOUNT_SETTINGS)) settings[name] = typeof preferences[name] === 'boolean' ? preferences[name] : DEFAULT_ACCOUNT_SETTINGS[name];
      worker = new Worker(new URL('./offline-report-worker.js',import.meta.url),{type:'module'});
      const fail = () => {
        worker?.terminate(); worker = null; refresh.disabled = false;
        status.textContent = 'The report could not finish. Unlock the saved copy again, then retry. Partial counts below are not a complete report.';
      };
      worker.onerror = fail;
      worker.onmessage = ({data}) => {
        if (current !== generation || account !== getAccount()) return;
        if (data.error) { fail(); return; }
        if (data.source) {
          const source = data.source;
          const row = document.createElement('tr');
          for (const value of [source.title,source.state,`${source.saved} / ${source.total ?? 'Unknown'}`,`${source.details.saved} saved · ${source.details.missing} missing${source.details.incomplete ? ` · ${source.details.incomplete} incomplete` : ''}`,`${source.files.saved} / ${source.files.known} known`]) {
            const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
          }
          if (source.rawDetails && source.rawDetails.saved + source.rawDetails.missing) {
            const raw = document.createElement('small');
            raw.textContent = `Source copies: ${source.rawDetails.saved} saved · ${source.rawDetails.missing} awaiting normal refresh${source.rawDetails.stale ? ` · ${source.rawDetails.stale} older than the list` : ''}.`;
            row.children[3].append(raw);
          }
          if (source.rawDocuments && source.rawDocuments.saved + source.rawDocuments.missing) {
            const raw = document.createElement('small');
            raw.textContent = `Print source copies: ${source.rawDocuments.saved} saved · ${source.rawDocuments.missing} pending.`;
            row.children[4].append(raw);
          }
          if (source.lastFailure) {
            const failure = document.createElement('small');
            const labels = {'document-response':'Document download','logo-response':'Sheet logo','sheet-parsing':'Sheet content','account-check':'Account check','source-storage':'Source storage','local-styles':'Sheet styling','file-validation':'Document content','file-storage':'Document storage'};
            const phase = labels[source.lastFailure.stage] || 'Archive refresh';
            failure.textContent = `Last failure: ${phase}${source.lastFailure.status ? ` (HTTP ${source.lastFailure.status})` : ''}${source.lastFailure.at ? ` · ${new Date(source.lastFailure.at).toLocaleString()}` : ''}. May since have recovered.`;
            row.children[1].append(failure);
          }
          if (source.lastReconciled) {
            const completed = document.createElement('small');
            completed.textContent = `Last fully matched list: ${new Date(source.lastReconciled.at).toLocaleString()}${Number.isSafeInteger(source.lastReconciled.stored) ? ` · ${source.lastReconciled.stored} records` : ''}. Later changes may still be refreshing.`;
            row.children[1].append(completed);
          }
          if (source.lastCheckReconciled === false) {
            const incomplete = document.createElement('small');
            incomplete.textContent = 'The last full scan could not finish matching the saved list. Earlier records were retained.';
            row.children[1].append(incomplete);
          }
          if (source.omitted?.length) {
            const omission = document.createElement('small');
            omission.textContent = `Excluded: ${source.omitted.join(', ')}.`;
            row.children[1].append(omission);
          }
          if (source.skippedIdentifiers) {
            const missing = document.createElement('small');
            missing.textContent = `${source.skippedIdentifiers} invalid identifiers skipped${source.importing ? ' so far' : ''}; excluded from missing-record counts.`;
            row.children[2].append(missing);
          }
          if (source.details.reconstructed || source.details.productConflicts || source.details.expectedEmpty) {
            const recovery = document.createElement('small');
            recovery.textContent = `${source.details.reconstructed || 0} with reconstructed products · ${source.details.expectedEmpty || 0} awaiting products or unissued · ${source.details.productConflicts || 0} with conflicting product tabs.`;
            row.children[3].append(recovery);
          }
          rows.append(row);
          status.textContent = `Reading local archive coverage: ${rows.children.length} sections checked…`;
        }
        if (data.report) {
          report = data.report; copy.disabled = false; download.disabled = false; refresh.disabled = false;
          status.textContent = `Report generated at ${new Date(report.completedAt).toLocaleString()}. ${report.captureStatus} Section statuses describe saved coverage, separately from automatic saving.`;
          worker?.terminate(); worker = null;
        }
      };
      worker.postMessage({account,vaultKey:secret,settings,version:chrome.runtime.getManifest().version,connection:getConnection(),activity:getActivity()});
    } catch {
      if (current === generation) {
        refresh.disabled = false;
        status.textContent = 'The report could not start. Unlock the saved copy again, then retry.';
      }
    }
  }
  refresh.addEventListener('click',generate);
  download.addEventListener('click',() => {
    if (!report) return;
    downloadUrl ??= URL.createObjectURL(new Blob([formatArchiveReport(report)],{type:'application/json'}));
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `islandsun-archive-report-${report.startedAt.replace(/:/g,'-')}.json`;
    document.body.append(link); link.click(); link.remove();
    status.textContent = 'Archive report download requested. Share this file to check the remaining coverage; no diagnostic recording is needed.';
  });
  copy.addEventListener('click',async () => {
    if (!report) return;
    const current = generation;
    const text = formatArchiveReport(report);
    try {
      await navigator.clipboard.writeText(text);
      if (current === generation) status.textContent = 'Archive verification report copied. You can paste it into the chat.';
    } catch {
      if (current !== generation) return;
      fallback.hidden = false; fallback.value = text; fallback.focus(); fallback.select();
      status.textContent = 'Automatic copying is unavailable. The report below is selected; press Ctrl+C to copy it.';
    }
  });
  clear();
  return {clear,generate};
}
