import { PORTAL_ORIGIN } from './shared/document-names.js';
import { createNotifications } from './notifications.js';
import { addThemeControl, arrangeTables, releaseTableControls, translateInterface } from './presentation.js';
import { refineShell } from './shell.js';
import { createDocumentTools } from './document-tools.js';
import { createProductPreview } from './product-preview.js';
import { createNavigation } from './navigation.js';
import { createProductCache } from './product-cache.js';
import { readProducts } from './product-loader.js';
import { productSession } from './product-session.js';
import { createNotificationStore } from './notification-store.js';
import { createNotificationCenter } from './notification-center.js';
import { withUpdateNotifications } from './update-notification-store.js';
import { createNotificationMonitor } from './notification-monitor.js';
import { createPresentationJournal } from './presentation-journal.js';
import { cancelMotion } from './motion.js';
import { needsEnhancement } from './portal-observer.js';
import { createSubmissionTracking } from './submission-tracking.js';
import { createSavedRequestTracking } from './saved-request-tracking.js';
import { createSampleFormControls } from './sample-form-controls.js';
import { createImprovementPrefill } from './improvement-prefill.js';
import { applyDefaultFilterDate } from './filter-dates.js';
import { createOperationalForms } from './operational-forms.js';
import { createCalendarPresentation } from './calendar-presentation.js';
import { recordConnectionDiagnostic } from './connection-diagnostics.js';
import { createTirForm } from './tir-form.js';
import { createPortalDialogs } from './portal-dialogs.js';
import { createFormEditMode } from './form-edit-mode.js';
import { createDropdownTranslation } from './dropdown-translation.js';
import { createUnsavedChanges } from './unsaved-changes.js';
import { createFormValidation } from './form-validation.js';
import { createSaveSubmit } from './save-submit.js';
import { setOfflineAccount } from './offline-observer.js';
import { createObservedSampleTable } from './offline-observed-table.js';
import { ACCOUNT_SCOPE } from './account-scope.js';
import { createTextareaLimits } from './textarea-limits.js';
import { createModalAccessibility } from './modal-accessibility.js';
import { createActivityConsole } from './activity-console.js';

// Load the module graph during parsing; DOM work still waits for the native page.
if (document.documentElement.dataset.isiDomReady === 'pending' || document.readyState === 'loading') await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
let teardown, generation = 0;
async function start() {
  if (location.origin !== PORTAL_ORIGIN || teardown) return;
  const current = ++generation;
  const { enabled = true } = await chrome.storage.local.get(['enabled']);
  if (current !== generation) return;
  if (!enabled) { delete document.documentElement.dataset.isiPortal; document.documentElement.classList.remove('isi-theme'); document.documentElement.dataset.isiBoot = 'off'; return; }
  if (applyDefaultFilterDate()) return;
  const activity = createActivityConsole();
  document.documentElement.dataset.isiPortal = 'enabled';
  document.documentElement.classList.add('isi-theme');
  const journal = createPresentationJournal();
  const dropdownTranslation = createDropdownTranslation(journal);
  const theme = addThemeControl();
  const notices = createNotifications();
  const dialogs = createPortalDialogs();
  const validation = createFormValidation(dialogs);
  const editMode = createFormEditMode(dialogs);
  const unsavedChanges = createUnsavedChanges(form => editMode.canEdit(form), dialogs);
  const documents = createDocumentTools(notices.notify);
  const accountLink = document.querySelector('.user-menu a[href*="lockscreen?user="]');
  const account = accountLink ? new URL(accountLink.href).searchParams.get('user') : null;
  setOfflineAccount(account);
  const observedTable = createObservedSampleTable(account);
  const saveSubmit = createSaveSubmit({notify:notices.notify, canEdit:form => editMode.canEdit(form), account, onSaved:form => unsavedChanges.markSaved(form), onSubmission:record => store?.registerSubmission(record)});
  const repository = createProductCache(readProducts, { persistence: productSession(account) });
  const products = createProductPreview(notices.notify, repository);
  const navigation = createNavigation();
  const sampleForms = createSampleFormControls();
  const textareaLimits = createTextareaLimits();
  const modalAccessibility = createModalAccessibility();
  const improvementPrefill = createImprovementPrefill({notify: notices.notify, onLoaded: textareaLimits.enhance});
  const operationalForms = createOperationalForms();
  const tirForm = createTirForm();
  const calendar = createCalendarPresentation();
  let store, center, monitor, combinedStore, submissions, saves;
  let accountPaused = false;
  function checkAccount(scope) {
    if (!account || !scope || scope.account === account || accountPaused) return;
    accountPaused = true;
    saveSubmit.destroy();
    improvementPrefill.destroy();
    observedTable.destroy();
    monitor?.destroy(); submissions?.destroy(); saves?.destroy(); center?.destroy(); combinedStore?.destroy(); store?.destroy();
    products.destroy(); repository.destroy(); setOfflineAccount(null);
    notices.notify('The signed-in account changed. Reload this page before continuing.',{key:'account-changed',tone:'warning'});
  }
  const accountChanged = (changes,area) => { if (area === 'local' && changes[ACCOUNT_SCOPE]) checkAccount(changes[ACCOUNT_SCOPE].newValue); };
  if (account && document.querySelector('.content-wrapper')) {
    chrome.runtime.sendMessage({type:'portal-session-active'}).catch(()=>{});
    store = createNotificationStore(account, { onError: () => notices.notify('Notification history is unavailable. Your records have not changed.', { error: true }) });
    submissions = createSubmissionTracking(store, () => notices.notify('This submission could not be tracked for notifications. Check its status in the request list.', { error: true }));
    saves = createSavedRequestTracking(store, () => notices.notify('The reminder for this save could not be recorded. Check its status in the request list.', {error:true}));
    combinedStore = withUpdateNotifications(store);
    center = createNotificationCenter(combinedStore, notices);
    const accountName = document.querySelector('.user-menu > a')?.textContent.trim().replace(/\s+/g, ' ');
    monitor = createNotificationMonitor(store, repository, notices, accountName);
  }
  chrome.storage.onChanged.addListener(accountChanged);
  chrome.storage.local.get(ACCOUNT_SCOPE).then(saved => checkAccount(saved[ACCOUNT_SCOPE])).catch(() => {});
  let timer;
  const observer = new MutationObserver(records => {
    if (!needsEnhancement(records)) return;
    clearTimeout(timer); timer = setTimeout(enhance, 100);
  });
  function enhance() {
    observer.disconnect();
    journal.capture(() => { operationalForms.enhance(); tirForm.enhance(); calendar.enhance(); translateInterface(); arrangeTables(); documents.enhance(); if (!accountPaused) products.enhance(); navigation.enhance(); refineShell(); sampleForms.arrange(); });
    sampleForms.enhanceUnits();
    textareaLimits.enhance();
    modalAccessibility.enhance();
    editMode.enhance();
    observedTable.enhance();
    unsavedChanges.enhance();
    saveSubmit.enhance();
    if (!accountPaused) improvementPrefill.enhance();
    submissions?.observe();
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  document.addEventListener('islandsun-table-draw', enhance);
  teardown = (preservePresentation = false) => {
    activity.destroy();
    setOfflineAccount(null);
    observedTable.destroy();
    chrome.storage.onChanged.removeListener(accountChanged);
    document.removeEventListener('islandsun-table-draw', enhance);
    clearTimeout(timer); observer.disconnect(); dropdownTranslation.destroy(); theme?.destroy({ preserveScheme: preservePresentation });
    monitor?.destroy(); submissions?.destroy(); saves?.destroy(); center?.destroy(); combinedStore?.destroy(); store?.destroy();
    improvementPrefill.destroy(); saveSubmit.destroy(preservePresentation); validation.destroy(); unsavedChanges.destroy(); editMode.destroy(); dialogs.destroy();
    modalAccessibility.destroy(); textareaLimits.destroy(); documents.destroy(); products.destroy(); navigation.destroy(); notices.destroy(); calendar.destroy(); cancelMotion(); releaseTableControls(); operationalForms.destroy(); tirForm.destroy(); journal.restore(); sampleForms.destroy(); teardown = null;
    document.querySelector('#isi-portal-theme')?.closest('[data-isi-owned]')?.remove();
    if (!preservePresentation) { delete document.documentElement.dataset.isiPortal; delete document.documentElement.dataset.isiLayout; delete document.documentElement.dataset.theme; document.documentElement.classList.remove('isi-theme'); document.documentElement.dataset.isiBoot = 'off'; }
  };
  enhance();
  document.documentElement.dataset.isiBoot = 'ready';
  recordConnectionDiagnostic({kind:'page', outcome:'complete'});
  const loginInput = document.querySelector('.lockscreen-wrapper input[autofocus],.login-box input[autofocus]');
  if (loginInput && [document.body, document.documentElement].includes(document.activeElement)) loginInput.focus({ preventScroll: true });
  document.dispatchEvent(new Event('islandsun-portal-ready'));
}
// Preserve the outgoing canvas until the browser replaces it, including form navigation.
function startupFailed(error) {
  console.error('[Islandsun] Portal enhancement startup failed.', error);
  teardown?.();
  delete document.documentElement.dataset.isiPortal;
  document.documentElement.dataset.isiBoot = 'failed';
  document.dispatchEvent(new Event('islandsun-startup-failed'));
}
window.addEventListener('pagehide', () => { generation++; teardown?.(true); });
window.addEventListener('pageshow', event => {
  if (!event.persisted) return;
  document.documentElement.dataset.isiBoot = 'pending';
  start().catch(startupFailed);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.enabled) return;
  generation++;
  if (changes.enabled.newValue === false) { teardown?.(); delete document.documentElement.dataset.isiPortal; document.documentElement.classList.remove('isi-theme'); document.documentElement.dataset.isiBoot = 'off'; }
  else start().catch(startupFailed);
});
await start().catch(startupFailed);
