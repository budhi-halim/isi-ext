import { DEFAULT_PORTAL_ORIGIN, portalOrigin, selectPortalTab } from './js/shared/portal-address.js';
import { initializeTheme } from './assets/family/js/theme.js';
import { createRevenueUI } from './js/ui.js';
import { validateMonths } from './js/validation.js';
import { discoverIndexes } from './js/discovery.js';
import { runCoreScraper } from './js/extraction.js';
import { createRevenueWorkbook, revenueFilename } from './js/workbook.js';
import { downloadBlob } from './js/download.js';
import * as checkpoints from './js/checkpoint.js';

const find = id => document.getElementById(id);
const ui = createRevenueUI();
const requestedOrigin = portalOrigin(new URL(location.href).searchParams.get('portal'));
const selectedOrigin = requestedOrigin
  ? Promise.resolve(requestedOrigin)
  : selectPortalTab(chrome.tabs).then(tab => portalOrigin(tab?.url) || DEFAULT_PORTAL_ORIGIN);
initializeTheme({ toggle: find('theme-toggle') });

let controller = null;
let runNumber = 0;
let workbookFile = null;
let workbookDownloading = false;
let datesEdited = false;
let previewNumber = 0;

const previousMonth = new Date();
previousMonth.setDate(1);
previousMonth.setMonth(previousMonth.getMonth() - 1);
const defaultMonth = previousMonth.getFullYear() + '-' + String(previousMonth.getMonth() + 1).padStart(2, '0');
find('start-month').value = defaultMonth;
find('end-month').value = defaultMonth;

function showSavedProgress(run) {
  const note = find('resume-note');
  const restart = find('restart-button');
  if (!run) {
    note.hidden = true;
    restart.hidden = true;
    find('start-button-label').textContent = 'Begin Extraction';
    return;
  }
  const count = run.targets?.length || 0;
  const message = run.phase === 'deliveries'
    ? 'Saved delivery scan: ' + Math.max(0, run.latestDO - run.nextDO) + ' records checked.'
    : run.phase === 'ready'
      ? 'All ' + count + ' sales orders are saved. Resume to prepare the workbook.'
      : 'Saved sales data: ' + (run.nextOrder || 0) + ' of ' + count + ' orders completed.';
  note.textContent = message + ' You can safely close and reopen this page.';
  note.hidden = false;
  restart.hidden = false;
  find('start-button-label').textContent = 'Resume Extraction';
}

async function refreshSavedProgress() {
  const ticket = ++previewNumber;
  if (ui.running || workbookDownloading) return;
  try {
    const origin = await selectedOrigin;
    const startMonth = find('start-month').value;
    const endMonth = find('end-month').value;
    const valid = !validateMonths(startMonth, endMonth);
    const run = valid ? await checkpoints.loadCheckpoint(checkpoints.checkpointKey(origin, startMonth, endMonth)) : null;
    if (ticket === previewNumber && !ui.running) showSavedProgress(run);
  } catch (error) {
    if (ticket === previewNumber) ui.log('Saved progress could not be read: ' + error.message, 'warn');
  }
}

async function showRecentCheckpoint() {
  try {
    const recent = await checkpoints.latestCheckpoint(await selectedOrigin);
    if (recent && !datesEdited) {
      find('start-month').value = recent.startMonthVal;
      find('end-month').value = recent.endMonthVal;
    }
  } catch (error) {
    ui.log('Saved progress could not be read: ' + error.message, 'warn');
  }
  await refreshSavedProgress();
}

async function saveWorkbook() {
  if (!workbookFile || workbookDownloading) return;
  workbookDownloading = true;
  const ticket = runNumber;
  const file = workbookFile;
  find('save-workbook').disabled = true;
  find('start-button').disabled = true;
  try {
    await downloadBlob(file.blob, file.name);
    if (ticket === runNumber) {
      ui.setPhaseState(3);
      ui.log('Extraction complete. Excel workbook saved.', 'success');
      try { await checkpoints.clearCheckpoint(file.checkpointKey); }
      catch (error) { ui.log('Workbook saved, but the old checkpoint could not be cleared: ' + error.message, 'warn'); }
    }
  } catch (error) {
    if (ticket === runNumber) ui.log('The workbook could not be saved. Use Save workbook to retry without extracting again.', 'warn');
  } finally {
    workbookDownloading = false;
    find('save-workbook').disabled = false;
    if (!ui.running) find('start-button').disabled = false;
  }
}

async function startProcess(event) {
  event.preventDefault();
  if (ui.running || workbookDownloading) return;

  const startMonthVal = find('start-month').value;
  const endMonthVal = find('end-month').value;
  const validation = validateMonths(startMonthVal, endMonthVal);
  find('validation-message').textContent = validation;
  find('validation-message').hidden = !validation;
  find('start-month').setAttribute('aria-invalid', String(Boolean(validation)));
  find('end-month').setAttribute('aria-invalid', String(Boolean(validation)));
  if (validation) { find('start-month').focus(); return; }

  controller = new AbortController();
  runNumber++;
  workbookFile = null;
  find('save-workbook').hidden = true;
  find('resume-note').hidden = true;
  find('restart-button').hidden = true;
  ui.reset();
  ui.setRunning(true);
  let saved = false;

  try {
    const origin = await selectedOrigin;
    controller.signal.throwIfAborted();
    const key = checkpoints.checkpointKey(origin, startMonthVal, endMonthVal);
    let checkpoint = await checkpoints.loadCheckpoint(key);

    if (!checkpoint) {
      const indexes = await discoverIndexes(controller.signal, ui.log, origin);
      checkpoint = {
        key, origin, startMonthVal, endMonthVal,
        latestDO: indexes.latestDO, latestSO: indexes.latestSO,
        nextDO: indexes.latestDO, targets: [], emptyDoCount: 0,
        historicalStreak: 0, deliveryProgress: 0, phase: 'deliveries',
        nextOrder: 0, currentPos: indexes.latestSO
      };
      await checkpoints.saveCheckpoint(checkpoint);
    } else {
      ui.log('Found an unfinished extraction. Continuing from the last saved checkpoint.', 'success');
    }
    saved = true;

    const data = await runCoreScraper({
      startMonthVal, endMonthVal,
      latestDO: checkpoint.latestDO, latestSO: checkpoint.latestSO,
      signal: controller.signal, ui, origin, checkpoint, checkpoints
    });

    if (!data.length) {
      ui.log('No revenue rows were found for the selected months.', 'warn');
      await checkpoints.clearCheckpoint(key);
      return;
    }

    ui.log('Preparing the Excel workbook…');
    const workbook = createRevenueWorkbook(data, globalThis.XLSX);
    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    workbookFile = {
      blob: new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      name: revenueFilename(startMonthVal, endMonthVal),
      checkpointKey: key
    };
    find('save-workbook').hidden = false;
    await saveWorkbook();
  } catch (error) {
    const description = error?.name === 'SessionExpiredError' ? error.message
      : error?.name === 'AbortError' ? 'The operation was interrupted.'
        : error?.message || 'An unexpected error occurred.';
    ui.log('Extraction stopped: ' + description + (saved
      ? ' Saved progress is available. Use Resume Extraction after the issue is resolved.'
      : ' Please retry after resolving the issue.'), 'warn');
  } finally {
    ui.setRunning(false);
    controller = null;
    await refreshSavedProgress();
  }
}

async function startOver() {
  if (ui.running || workbookDownloading) return;
  const origin = await selectedOrigin;
  const key = checkpoints.checkpointKey(origin, find('start-month').value, find('end-month').value);
  if (!confirm('Discard saved extraction progress for these months? The sales data will need to be collected again.')) return;
  try {
    await checkpoints.clearCheckpoint(key);
    ui.reset();
    ui.log('Saved progress cleared. You can begin a new extraction.', 'info');
    await refreshSavedProgress();
  } catch (error) {
    ui.log('Could not discard saved progress: ' + error.message, 'warn');
  }
}

find('extraction-form').addEventListener('submit', startProcess);
find('save-workbook').addEventListener('click', () => { void saveWorkbook(); });
find('restart-button').addEventListener('click', () => { void startOver(); });
for (const id of ['start-month', 'end-month']) {
  find(id).addEventListener('change', () => {
    datesEdited = true;
    void refreshSavedProgress();
  });
}
window.addEventListener('pagehide', event => {
  controller?.abort();
  if (!event.persisted) ui.destroy();
});
void showRecentCheckpoint();
