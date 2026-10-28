import { DEFAULT_PORTAL_ORIGIN, portalOrigin, selectPortalTab } from './js/shared/portal-address.js';
import { initializeTheme } from './assets/family/js/theme.js';
import { createRevenueUI } from './js/ui.js';
import { validateMonths } from './js/validation.js';
import { discoverIndexes } from './js/discovery.js';
import { runCoreScraper } from './js/extraction.js';
import { createRevenueWorkbook, revenueFilename } from './js/workbook.js';
import { downloadBlob } from './js/download.js';

const find = id => document.getElementById(id);
const ui = createRevenueUI();
const requestedOrigin = portalOrigin(new URL(location.href).searchParams.get('portal'));
initializeTheme({ toggle: find('theme-toggle') });
let controller = null;
let runNumber = 0;
let workbookFile = null;
let workbookDownloading = false;
const previousMonth = new Date();
previousMonth.setDate(1);
previousMonth.setMonth(previousMonth.getMonth() - 1);
const defaultMonth = previousMonth.getFullYear() + '-' + String(previousMonth.getMonth() + 1).padStart(2, '0');
find('start-month').value = defaultMonth;
find('end-month').value = defaultMonth;

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
    }
  } catch {
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
  ui.reset();
  ui.setRunning(true);
  try {
    const origin = requestedOrigin || portalOrigin((await selectPortalTab(chrome.tabs))?.url) || DEFAULT_PORTAL_ORIGIN;
    controller.signal.throwIfAborted();
    const indexes = await discoverIndexes(controller.signal, ui.log, origin);
    const data = await runCoreScraper({ startMonthVal, endMonthVal, ...indexes, signal: controller.signal, ui, origin });
    if (!data.length) {
      ui.log('No revenue rows were found for the selected months.', 'warn');
      return;
    }
    ui.log('Preparing the Excel workbook…');
    const workbook = createRevenueWorkbook(data, globalThis.XLSX);
    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    workbookFile = { blob: new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name: revenueFilename(startMonthVal, endMonthVal) };
    find('save-workbook').hidden = false;
    await saveWorkbook();
  } catch (error) {
    ui.log(error.name === 'SessionExpiredError' ? error.message : 'Extraction could not finish. Check your company connection and try again.', 'warn');
  } finally {
    ui.setRunning(false);
    controller = null;
  }
}
find('extraction-form').addEventListener('submit', startProcess);
find('save-workbook').addEventListener('click', () => { void saveWorkbook(); });
window.addEventListener('pagehide', event => {
  controller?.abort();
  if (!event.persisted) ui.destroy();
});
