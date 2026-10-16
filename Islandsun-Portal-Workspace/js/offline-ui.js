import { OFFLINE_SOURCES, OFFLINE_STATUS, archiveKey } from './offline-config.js';
import { readArchive, readVisibleRecord, recordFiles } from './offline-store.js';
import { createNotifications } from '../assets/family/js/notifications.js';
import { renderThemeControl } from '../assets/family/js/theme-control.js';
import { icon } from './icons.js';
import { createOfflineRecordView } from './offline-record-ui.js';
import { ACCOUNT_SCOPE } from './account-scope.js';
import { vaultKey } from './offline-vault.js';
import { createOfflineAuthentication } from './offline-auth-ui.js';
import { OFFLINE_PASSWORD_REQUIRED } from './offline-access-policy.js';
import { calendarMonth, AVAILABILITY_CATEGORIES } from './offline-calendar.js';
import { createOfflineCalendar } from './offline-calendar-ui.js';
import { createArchiveReport } from './offline-report-ui.js';
import { createDebugCaptureUI } from './debug-capture-ui.js';
import { createSourceExport } from './offline-source-export-ui.js';
import { archiveWaitMessage } from './offline-wait.js';
import { replaySavedDetail } from './offline-detail-replay.js';
import { readConfirmationSheet } from './offline-confirmation-source.js';
import { activateRecordRow } from './offline-row-navigation.js';
import { createOfflineTableDensity } from './offline-table-density.js';
import { createOfflineNavigation } from './offline-navigation.js';
import { createOfflineProductPreview } from './offline-product-preview.js';
import { createRecoveryObservation } from './offline-connection.js';

const $ = selector => document.querySelector(selector);
const notices = createNotifications();
const fallbackReason = new URLSearchParams(location.search).get('fallback');
const viewerOpenedAt = Date.now();
let unavailableSince = ['connection','server'].includes(fallbackReason) ? viewerOpenedAt : 0;
const observeRecovery = createRecoveryObservation();
if (['connection','server'].includes(fallbackReason)) {
  notices.show(fallbackReason === 'server'
    ? 'The portal returned a server error. The saved offline copy is open.'
    : 'The portal could not be reached. The saved offline copy is open.', {key:'portal-unavailable',tone:'warning'});
  const parameters = new URLSearchParams(location.search);
  parameters.delete('fallback');
  history.replaceState(null,'',`${location.pathname}${parameters.size ? `?${parameters}` : ''}${location.hash}`);
}
const worker = new Worker(new URL('./offline-query-worker.js',import.meta.url),{type:'module'});
const dateTime = value => value ? new Date(value).toLocaleString() : 'Not saved yet';
let kind, account = '', sequence = 0, revision = 0, page = 0, sort, desc = true, timer, detailSequence = 0;
let total = 0, hidden = new Set(), connection = {};
const recordView = createOfflineRecordView($('#record-content'));
let activeRecord = null, returnFocus = null;
const products = createOfflineProductPreview({getScope:() => ({account,kind}),notify:(message,options) => notices.show(message,{tone:options?.error ? 'error' : 'success'})});
const density = createOfflineTableDensity({region:$('.offline-table-scroll'),select:$('#page-size'),getPage:() => page,onResize(nextPage) {page = nextPage; query();}});
const navigation = createOfflineNavigation($('#sections'),$('#stock-card-views'));
let accountScope;
let offlineIdentity;
const archiveReport = createArchiveReport({
  getAccount:() => account,
  getConnection:() => connection.account === account ? connection.state || 'unknown' : 'signed-out',
  getActivity:() => connection.account === account ? {
    attemptedAt:connection.attemptedAt,syncedAt:connection.syncedAt,stateChangedAt:connection.stateChangedAt,
    wait:connection.wait,pacing:connection.pacing,
  } : {},
});
const debugCaptureUI = createDebugCaptureUI({getAccount:() => account});
const sourceExport = createSourceExport({getAccount:() => account});
let calendarActive = false, month = calendarMonth('');
$('#availability-category').append(...Object.entries(AVAILABILITY_CATEGORIES).map(([value,label]) => new Option(label,value)));
const calendar = createOfflineCalendar($('#availability-calendar'),{
  onChange(value) { month = value; query(); },
  onOpen(key,button) { returnFocus = button; openRecord(key); }
});
function setAvailabilityView(active) {
  calendarActive = kind === 'availability' && active;
  $('#availability-views').hidden = kind !== 'availability';
  $('#availability-category-label').hidden = kind !== 'availability';
  $('#availability-calendar').hidden = !calendarActive;
  $('#calendar-view-button').setAttribute('aria-pressed',String(calendarActive));
  $('#table-view-button').setAttribute('aria-pressed',String(!calendarActive));
  $('.offline-table-card').dataset.calendar = String(calendarActive);
  for (const selector of ['.offline-table-scroll','.offline-pagination','.offline-toolbar > label','.offline-columns']) $(selector).hidden = calendarActive;
}
$('#calendar-view-button').addEventListener('click',() => { setAvailabilityView(true); query(); });
$('#table-view-button').addEventListener('click',() => { setAvailabilityView(false); query(); });
function setSnapshotTime(text) {
  $('#snapshot-time').textContent = $('#offline-notice-time').textContent = text;
}
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text != null) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function scheme(dark) {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  renderThemeControl($('#theme'), dark);
}
const colorPreference = matchMedia('(prefers-color-scheme: dark)');
let themeOverride = null;
try {
  const savedTheme = sessionStorage.getItem('islandsun.offline.theme');
  if (['light','dark'].includes(savedTheme)) themeOverride = savedTheme === 'dark';
} catch { /* The active page remains usable when storage is unavailable. */ }
scheme(themeOverride ?? colorPreference.matches);
colorPreference.addEventListener('change',() => { if (themeOverride === null) scheme(colorPreference.matches); });
$('#theme').addEventListener('click',() => {
  themeOverride = document.documentElement.dataset.theme !== 'dark';
  scheme(themeOverride);
  try { sessionStorage.setItem('islandsun.offline.theme',themeOverride ? 'dark' : 'light'); }
  catch { /* Keep the current page's theme when storage is unavailable. */ }
});
$('#navigation-toggle').append(icon('menu'));
function setNavigation(open) {
  document.body.dataset.navigation = open ? 'open' : 'closed';
  $('#navigation-toggle').setAttribute('aria-expanded',String(open));
  $('#sections').inert = !open;
}
const compactNavigation = matchMedia('(max-width: 767px)');
setNavigation(!compactNavigation.matches);
compactNavigation.addEventListener('change',() => setNavigation(!compactNavigation.matches));
$('#navigation-toggle').addEventListener('click',() => setNavigation(document.body.dataset.navigation !== 'open'));
function closeArchivePanel() {
  $('.offline-storage').open = false;
  $('.offline-storage > summary').focus();
}
$('#close-archive-panel').addEventListener('click',closeArchivePanel);
document.addEventListener('pointerdown',event => {
  if (!event.target.closest('.offline-banner')) $('#offline-notice').open = false;
  if (!event.target.closest('.offline-storage')) $('.offline-storage').open = false;
  if (!event.target.closest('#filters')) $('#filters').open = false;
});
document.addEventListener('keydown',event => {
  if (event.key === 'Escape' && $('#offline-notice').open) { $('#offline-notice').open = false; $('#offline-notice summary').focus(); return; }
  if (event.key === 'Escape' && $('.offline-storage').open) { closeArchivePanel(); return; }
  if (event.key === 'Escape' && $('#filters').open) { $('#filters').open = false; $('#filters > summary').focus(); return; }
  if (event.key === 'Escape' && compactNavigation.matches && document.body.dataset.navigation === 'open') {
    setNavigation(false); $('#navigation-toggle').focus();
  }
});
function restore() {
  const parameters = new URLSearchParams(location.search);
  if (parameters.get('kind') === 'stock-monthly') parameters.set('kind','stock-products');
  kind = parameters.get('kind') in OFFLINE_SOURCES ? parameters.get('kind') : 'sample';
  month = calendarMonth(parameters.get('month'));
  setAvailabilityView(parameters.get('view') === 'calendar');
  $('#availability-category').value = Object.hasOwn(AVAILABILITY_CATEGORIES,parameters.get('category')) ? parameters.get('category') : '';
  const source = OFFLINE_SOURCES[kind];
  $('#reporting-period-label').hidden = !source.periodic;
  const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(parameters.get('period')) ? parameters.get('period') : '';
  $('#reporting-period').replaceChildren(new Option('All saved months',''),...(period ? [new Option(period,period)] : []));
  $('#reporting-period').value = period;
  sort = source.columns.some(column => column.key === parameters.get('sort')) ? parameters.get('sort') : source.date || source.number;
  desc = parameters.get('order') !== 'asc';
  page = Math.max(0,Number(parameters.get('page')) || 0);
  density.restore(parameters.get('size'),parameters.get('density') === 'auto' || !parameters.has('size'));
  for (const name of ['search','from','to']) $(`#${name}`).value = parameters.get(name) || '';
  $('#title').textContent = source.title;
  $('#status').disabled = !source.status;
  $('#from').disabled = $('#to').disabled = !source.date;
  hidden = new Set((parameters.get('hide') || '').split(',').filter(Boolean));
  hidden.delete(source.number);
  navigation.select(kind);
  $('#columns').replaceChildren();
  for (const column of source.columns) {
    const label = node('label'); const input = node('input'); input.type = 'checkbox'; input.checked = !hidden.has(column.key);
    input.disabled = column.key === source.number;
    input.addEventListener('change',() => { if (input.checked) hidden.delete(column.key); else hidden.add(column.key); query(); });
    label.append(input,node('span',column.label)); $('#columns').append(label);
  }
  query(parameters.get('status') || '');
  if (parameters.has('record') && account) openRecord(archiveKey(account,kind,parameters.get('record')),false);
  else showList();
}
async function query(status = $('#status').value) {
  clearTimeout(timer); timer = null;
  products.dismiss();
  const id = ++sequence;
  const settings = {id,account,kind,revision,page,size:Number($('#page-size').value),sort,desc,status,period:$('#reporting-period').value,calendar:calendarActive,month,category:$('#availability-category').value,search:$('#search').value,from:$('#from').value,to:$('#to').value};
  const parameters = new URLSearchParams({kind,sort,order:desc?'desc':'asc',size:String(settings.size),page:String(page)});
  if (density.automatic) parameters.set('density','auto');
  for (const key of ['search','status','from','to']) if (settings[key]) parameters.set(key,settings[key]);
  if (hidden.size) parameters.set('hide',[...hidden].join(','));
  if (kind === 'availability') { parameters.set('view',calendarActive ? 'calendar' : 'table'); parameters.set('month',month); }
  if (kind === 'availability' && settings.category) parameters.set('category',settings.category);
  if (OFFLINE_SOURCES[kind].periodic && settings.period) parameters.set('period',settings.period);
  const recordId = new URLSearchParams(location.search).get('record');
  if (recordId) parameters.set('record',recordId);
  history.replaceState(history.state,'',`?${parameters}`);
  if (!account) {
    calendar.clear();
    $('#rows').replaceChildren(); $('#head').replaceChildren(); $('#count').textContent = ''; $('#page-number').textContent = '';
    setSnapshotTime('No saved snapshot selected.');
    $('#previous').disabled = $('#next').disabled = true;
    $('#coverage').textContent = 'Sign in to the live portal to open your account’s saved records.';
    $('#empty').hidden = false; $('#empty').textContent = 'Saved records are locked after sign-out. Other accounts’ records are not shown.';
    return;
  }
  $('#rows').setAttribute('aria-busy','true');
  try {
    const key = await vaultKey(account);
    if (id === sequence) worker.postMessage({...settings,vaultKey:key});
  } catch { if (id === sequence) authentication.lock(); }
}
worker.onmessage = ({data}) => {
  if (data.id !== sequence) return;
  $('#rows').removeAttribute('aria-busy');
  if (data.error) { notices.show('Saved records could not be opened. Try refreshing the saved view.',{tone:'error'}); return; }
  const source = OFFLINE_SOURCES[kind];
  if (source.periodic) {
    const selected = $('#reporting-period').value;
    const periods = [...new Set([...(data.meta?.periods || []),...(selected ? [selected] : [])])].sort().reverse();
    $('#reporting-period').replaceChildren(new Option('All saved months',''),...periods.map(period=>new Option(`${period}${data.meta?.periodStates?.[period]?.checkedAt ? '' : ' · Not saved yet'}`,period)));
    $('#reporting-period').value = selected;
  }
  if (calendarActive) calendar.render(month,data.calendarRows || []);
  total = data.total; page = data.page;
  const status = new URLSearchParams(location.search).get('status') || '';
  $('#status').replaceChildren(new Option('All statuses',''),...data.statuses.map(value => new Option(value,value)));
  $('#status').value = status;
  const columns = source.columns.filter(column => !hidden.has(column.key));
  const head = node('tr');
  for (const column of columns) {
    const cell = node('th'); cell.scope = 'col';
    const button = node('button',`${column.label}${sort === column.key ? desc ? ' ↓' : ' ↑' : ''}`); button.type = 'button';
    cell.setAttribute('aria-sort',sort === column.key ? desc?'descending':'ascending' : 'none');
    button.addEventListener('click',() => { desc = sort === column.key ? !desc : false; sort = column.key; page = 0; query(); });
    cell.append(button); head.append(cell);
  }
  $('#head').replaceChildren(head);
  const rows = data.rows.map(record => {
    const row = node('tr');
    row.dataset.previewKey = record.key;
    activateRecordRow(row,element => { returnFocus = element; openRecord(record.key); });
    for (const column of columns) {
      const cell = node('td'); const value = record.fields[column.key];
      if (column.key === source.number) {
        const button = node('button',value || record.number || 'View record','record-link'); button.type = 'button';
        if (!value) button.setAttribute('aria-label',`View ${record.number}`);
        button.addEventListener('click',() => { returnFocus = button; openRecord(record.key); });
        cell.append(button);
      } else cell.textContent = value === '' || value == null ? '—' : value;
      row.append(cell);
    }
    return row;
  });
  $('#rows').replaceChildren(...rows);
  density.schedule();
  $('#empty').hidden = !!rows.length;
  $('#empty').textContent = data.saved ? 'No saved records match these filters.' : data.unverified ? 'Connect to the portal to check access to this older saved copy. Verified records will appear as the check progresses.' : 'This section has not been saved yet. Archiving runs while you are signed in.';
  $('#count').textContent = `${total ? page * Number($('#page-size').value) + 1 : 0}–${Math.min(total,(page+1)*Number($('#page-size').value))} of ${total.toLocaleString()} saved records`;
  $('#page-number').textContent = `Page ${page+1}`;
  $('#previous').disabled = !page;
  $('#next').disabled = (page+1)*Number($('#page-size').value) >= total;
  const pendingDates = data.meta?.importing ? data.meta.scan?.pendingDates || 0 : data.meta?.pendingDates || 0;
  $('#coverage').textContent = `${connection.name || account} · ${data.saved.toLocaleString()} saved${kind === 'products' || source.summaryOnly || source.periodic ? '' : ` · ${data.details.toLocaleString()} detailed snapshots`} · ${data.meta?.total != null ? `${data.meta.total.toLocaleString()} entries in last server list` : 'First list pending'}${data.meta?.importing ? ` · Saving list (${data.meta.scan?.cursor?.toLocaleString() || 'in progress'})` : pendingDates ? ` · ${pendingDates.toLocaleString()} awaiting Stock Request dates` : data.meta?.partial ? source.periodic ? ' · Monthly capture in progress' : ' · List changed during capture; recheck pending' : ''}`;
  if (data.meta?.importing) $('#coverage').textContent += ' · Refresh incomplete; records may have different saved times.';
  else if (data.meta?.lastError && !pendingDates) $('#coverage').textContent += ' · Latest refresh failed; previously saved records remain available.';
  if (source.periodic) $('#coverage').textContent += ` · ${data.meta?.periodsSaved || 0} of ${data.meta?.periodCount || 0} reporting months captured`;
  const skippedIdentifiers = (data.meta?.importing ? data.meta.scan?.skippedIdentifiers : data.meta?.skippedIdentifiers) || 0;
  if (skippedIdentifiers) $('#coverage').textContent += ` · ${skippedIdentifiers.toLocaleString()} invalid identifiers skipped${data.meta?.importing ? ' so far' : ''}.`;
  if (data.unverified) $('#coverage').textContent += ` · ${data.unverified.toLocaleString()} older records awaiting access checks.`;
  if (!activeRecord) setSnapshotTime(`List saved: ${dateTime(source.periodic && $('#reporting-period').value ? data.meta?.periodStates?.[$('#reporting-period').value]?.checkedAt : data.meta?.checkedAt)}`);
};
worker.onerror = () => notices.show('The saved-record search stopped. Reopen the offline workspace.',{tone:'error'});
function recordError(error) {
  notices.show(error?.code === 'ARCHIVE_SCOPE_PENDING' ? 'Connect to the portal to check access to this older saved record.' : 'This saved record could not be opened. Return to the list and refresh the saved view.',{tone:'error'});
  const parameters = new URLSearchParams(location.search); parameters.delete('record');
  history.replaceState(null,'',`?${parameters}`);
  showList();
}
async function openRecord(key, push = true) {
  products.dismiss();
  const current = ++detailSequence;
  try { await displaySavedRecord(key,push,current); }
  catch (error) { if (current === detailSequence) recordError(error); }
}
async function displaySavedRecord(key, push, current) {
  if (push && timer) {
    page = 0;
    await query();
    if (current !== detailSequence) return;
  }
  let record = await readVisibleRecord(key,account,kind);
  if (current !== detailSequence) return;
  if (!record || record.account !== account || record.kind !== kind) throw new Error('Saved record unavailable');
  try { record = await replaySavedDetail(record,() => current === detailSequence && record.account === account && record.kind === kind); }
  catch {
    if (current === detailSequence) notices.show('The saved source could not be reprocessed. Showing the previous saved details.',{tone:'warning'});
  }
  if (current !== detailSequence) return;
  if (!record) throw new Error('Saved record unavailable');
  try { record = await readConfirmationSheet(record,() => current === detailSequence && record.account === account && record.kind === kind); }
  catch {
    if (current === detailSequence) notices.show('The saved Sample sheet could not be matched. Showing the saved confirmation values.',{tone:'warning'});
  }
  if (current !== detailSequence) return;
  if (!record) throw new Error('Saved record unavailable');
  const files = await recordFiles(key);
  if (current !== detailSequence) return;
  activeRecord = record.id;
  if (push) {
    const parameters = new URLSearchParams(location.search); parameters.set('record',record.id);
    history.pushState({offlineRecord:true},'',`?${parameters}`);
  }
  recordView.render(record,files);
  $('#record-title').textContent = record.detail?.title || OFFLINE_SOURCES[record.kind].title;
  $('#record-number').textContent = record.number;
  $('#detail-time').textContent = `List saved: ${dateTime(record.savedAt)} · Details saved: ${dateTime(record.detailAt)}`;
  setSnapshotTime(`Details saved: ${dateTime(record.detailAt)}`);
  $('#list-view').hidden = true; $('#record-view').hidden = false;
  document.body.dataset.view = 'record';
  $('main').scrollTop = 0;
  $('#record-title').focus({preventScroll:true});
}
function showList() {
  detailSequence++; activeRecord = null; recordView.clear();
  $('#record-view').hidden = true; $('#list-view').hidden = false;
  document.body.dataset.view = 'list';
  if (returnFocus?.isConnected) returnFocus.focus({preventScroll:true});
  returnFocus = null;
}
$('#close-record').append(icon('arrow'));
$('#close-record').addEventListener('click',() => {
  if (history.state?.offlineRecord) history.back();
  else {
    const parameters = new URLSearchParams(location.search); parameters.delete('record');
    history.replaceState(null,'',`?${parameters}`); restore();
  }
});
$('#search').addEventListener('input',() => { clearTimeout(timer); timer = setTimeout(() => { page = 0; query(); },250); });
for (const name of ['status','from','to','page-size','availability-category','reporting-period']) $(`#${name}`).addEventListener('change',() => { page = 0; query(); });
$('#reset').addEventListener('click',() => { for (const name of ['search','status','from','to','availability-category','reporting-period']) $(`#${name}`).value = ''; page = 0; query(); });
$('#previous').addEventListener('click',() => { page = Math.max(0,page-1); query(); });
$('#next').addEventListener('click',() => { page++; query(); });
$('#refresh').addEventListener('click',() => { revision++; query(); storageStatus(); });
let navigationRevision = 0;
async function navigateSavedView(url, push = false) {
  const current = ++navigationRevision;
  clearTimeout(timer);
  if (!await authentication.canNavigate() || current !== navigationRevision) return;
  if (push) history.pushState(null,'',url);
  $('#rows').replaceChildren(); $('#head').replaceChildren(); $('#count').textContent = '';
  $('#coverage').textContent = 'Opening saved records…';
  $('#empty').hidden = false; $('#empty').textContent = 'Opening saved records…';
  $('#status').replaceChildren(new Option('All statuses',''));
  revision++; restore();
  $('main').scrollTop = 0;
  if (compactNavigation.matches) setNavigation(false);
  $('#title').focus({preventScroll:true});
}
document.addEventListener('click',event => {
  const link = event.target.closest('#sections a, #stock-card-views a, .offline-header .isi-brand');
  if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || link.target || link.hasAttribute('download')) return;
  event.preventDefault();
  navigateSavedView(link.href,true);
});
window.addEventListener('popstate',() => navigateSavedView(location.href));
async function storageStatus() {
  const [estimate,persisted,retention] = await Promise.all([navigator.storage.estimate(),navigator.storage.persisted(),readArchive('meta','retention')]);
  const bytes = value => `${(value/1024/1024).toLocaleString(undefined,{maximumFractionDigits:1})} MB`;
  $('#storage').textContent = `Browser storage: approximately ${bytes(estimate.usage || 0)} used of ${bytes(estimate.quota || 0)} available quota. ${persisted ? 'Persistent storage is enabled.' : 'The browser may reclaim this archive under storage pressure.'}`;
  $('#retention').textContent = retention ? `Storage cleanup removed records and files dated ${retention.through} and earlier. Newer dates are retained first.` : 'When browser quota is reached, the oldest entry date is removed across all record types, together with its files.';
}
$('#persist').addEventListener('click',async () => { const granted = await navigator.storage.persist(); notices.show(granted ? 'The browser will retain this archive until you clear it or remove the extension.' : 'The browser did not grant persistent storage. Your saved records remain available.',{tone:granted?'success':'warning'}); storageStatus(); });
async function checkConnection() {
  if ($('#check').disabled) return;
  $('#check').disabled = true;
  try { await chrome.runtime.sendMessage({type:'offline-check'}); revision++; query(); }
  catch { notices.show('The check could not finish. It will retry automatically.',{tone:'warning'}); }
  finally { $('#check').disabled = false; storageStatus(); }
}
$('#check').addEventListener('click',checkConnection);
const connectionAvailable = next => navigator.onLine && !next.hadOutage && next.connectedAt >= viewerOpenedAt && next.connectedAt > unavailableSince;
function renderConnection(next) {
  const recovered = observeRecovery(next);
  connection = next;
  const unavailable = !navigator.onLine || next.hadOutage || unavailableSince && !connectionAvailable(next);
  $('#account-name').textContent = offlineIdentity?.name || 'Sign in required';
  $('#connection').textContent = ({active:'Connected. Saving records in the background.',waiting:archiveWaitMessage(next.wait),paused:'Automatic archiving is paused.',offline:'The portal connection could not be confirmed. Saved records remain available.', 'signed-out':'Sign in to the portal to resume archiving.','unlock-required':'Saving will resume automatically while you are signed in to the portal.',attention:'Archiving needs attention.'})[next.state] || 'Waiting for the first connection check.';
  if (next.error && next.state === 'attention') $('#connection').textContent += ` ${next.error}`;
  if (next.state === 'active' && !connectionAvailable(next)) $('#connection').textContent = 'Waiting for a current connection check. Saved records remain available.';
  if (unavailable) $('#connection').textContent = 'The portal is unavailable. Saving is paused while the connection is checked. Saved records remain available.';
  $('#recovered').hidden = !connectionAvailable(next);
  if (!connectionAvailable(next)) notices.dismiss('portal-recovered');
  if (recovered && connectionAvailable(next)) {
    notices.dismiss('portal-unavailable');
    const message = 'The portal is available again.';
    notices.show(message,{key:'portal-recovered',tone:'success',isCurrent:() => connectionAvailable(connection),onShow:() => {
      const text = [...document.querySelectorAll('.isi-toast-message')].find(element => element.textContent === message);
      if (!text) return;
      const link = node('a',' Sign in to the live portal'); link.href = 'http://apps.islandsunindonesia.com:81/islandsun/login'; link.target = '_blank'; link.rel = 'noopener';
      text.append(link);
    }});
  }
}
function browserDisconnected() {
  unavailableSince = Date.now();
  renderConnection(connection);
  chrome.runtime.sendMessage({type:'offline-browser-disconnected'}).catch(() => {});
}
window.addEventListener('offline',browserDisconnected);
window.addEventListener('online',() => { checkConnection(); });
chrome.storage.onChanged.addListener((changes,area) => {
  if (area !== 'local' || !changes[OFFLINE_STATUS] && !changes[ACCOUNT_SCOPE]) return;
  if (changes[ACCOUNT_SCOPE]) accountScope = changes[ACCOUNT_SCOPE].newValue;
  const next = changes[OFFLINE_STATUS]?.newValue || connection;
  const refreshed = next.syncedAt && next.syncedAt !== connection.syncedAt;
  const cleared = next.clearedAt !== connection.clearedAt;
  renderConnection(next);
  if (cleared || OFFLINE_PASSWORD_REQUIRED && changes[ACCOUNT_SCOPE] && changes[ACCOUNT_SCOPE].oldValue?.account !== changes[ACCOUNT_SCOPE].newValue?.account) authentication.lock();
  else if (refreshed && account && account === next.account && !document.hidden) { revision++; query(); storageStatus(); }
});
const authentication = createOfflineAuthentication({
  onUnlock(identity) {
    offlineIdentity = identity; account = identity.account; revision++;
    debugCaptureUI.refresh();
    renderConnection(connection); restore();
  },
  onLock({preserveLocation = false} = {}) {
    debugCaptureUI.clear();
    archiveReport.clear();
    sourceExport.clear();
    navigationRevision++;
    if (account && !preserveLocation) {
      const parameters = new URLSearchParams(location.search);
      for (const name of ['record','search','status','from','to','page','category','period']) parameters.delete(name);
      history.replaceState(null,'',`?${parameters}`);
    }
    account = ''; offlineIdentity = null; sequence++; revision++; detailSequence++; showList();
    calendar.clear();
    worker.postMessage({reset:true}); $('#rows').replaceChildren(); $('#head').replaceChildren();
    $('#account-name').textContent = OFFLINE_PASSWORD_REQUIRED ? 'Sign in required' : 'Choose saved account'; $('#coverage').textContent = ''; $('#count').textContent = '';
    for (const name of ['search','from','to']) $(`#${name}`).value = '';
    $('#status').replaceChildren(new Option('All statuses','')); page = 0;
    $('#reporting-period').replaceChildren(new Option('All saved months',''));
  },
});
window.addEventListener('pagehide',event => {
  products.dismiss();
  debugCaptureUI.clear();
  archiveReport.clear();
  sourceExport.clear();
  document.body.dataset.access = 'checking'; $('#offline-sign-in').hidden = true;
  clearTimeout(timer);
  calendar.clear();
  sequence++; detailSequence++; recordView.clear(); $('#rows').replaceChildren(); $('#head').replaceChildren(); $('#account-name').textContent = '';
  if (!event.persisted) { products.destroy(); worker.terminate(); recordView.clear(); notices.destroy(); }
});
window.addEventListener('pageshow',async event => {
  if (!event.persisted) return;
  authentication.prepare();
  try {
    const saved = await chrome.storage.local.get([ACCOUNT_SCOPE,OFFLINE_STATUS]);
    accountScope = saved[ACCOUNT_SCOPE];
    revision++; renderConnection(saved[OFFLINE_STATUS] || {}); restore();
    await authentication.resume();
  } catch { authentication.lock(false); }
});
try {
  const initial = await chrome.storage.local.get([OFFLINE_STATUS,ACCOUNT_SCOPE]);
  const saved = initial[OFFLINE_STATUS] || {};
  accountScope = initial[ACCOUNT_SCOPE];
  account = ''; renderConnection(saved); restore(); storageStatus().catch(() => { $('#storage').textContent = 'Storage information is unavailable.'; });
  if (!navigator.onLine) browserDisconnected();
  await authentication.resume();
} catch { authentication.lock(false); $('#offline-login-error').textContent = 'The saved workspace could not be opened. Try unlocking it again.'; }
document.addEventListener('visibilitychange',() => { if (!document.hidden && account) { revision++; query(); } });
