import { translateChrome } from './logic.js';
import { iconButton, icon } from './icons.js';
import { reveal } from './motion.js';
import { isTirList } from './tir-page.js';
import { translateNativeFormLabels } from './native-form-labels.js';
import { renderThemeControl } from '../assets/family/js/theme-control.js';

const CHROME = 'label,th,button,option,h1,h2,h3,h4,h5,legend,.content-wrapper b,.content-wrapper small,.content-header a,.box-header a,.tab-pane > div,.tab-pane > p,.tab-pane > span,.tab-pane > b,.tab-pane > font,.select2-selection__rendered,.select2-selection__placeholder,.select2-results__option,.main-sidebar a,.breadcrumb,.breadcrumb li,.nav-tabs a,.nav-pills a,.box-title,.panel-heading,.login-box-msg,.lockscreen-logo,.lockscreen-name,.lockscreen-wrapper .help-block,.dataTables_length,.dataTables_filter,.dataTables_info,.pagination a,a.btn,.alert,.show_error,.user-menu a';
const filterControls = new Map();
const LIST_ROUTES = new Set([
  '/islandsun/samplerequest', '/islandsun/master/tir', '/islandsun/stock-request/list-srs',
  '/islandsun/sales-order', '/islandsun/feedback', '/islandsun/newdo',
  '/islandsun/stock-request/listcomplain', '/islandsun/suddenrequest/list_sudden',
  '/islandsun/daftar_kiriman_barang_sales', '/islandsun/stockcard/allstockbact',
  '/islandsun/stockcard', '/islandsun/stockcard/allstok',
  '/islandsun/stockcard/stockcardbyproduct', '/islandsun/stockcard/adjustmentstock',
  '/islandsun/daftar_kiriman_barang/tablefailed', '/islandsun/stock-request/report',
]);

function addFilterControl(wrapper) {
  const box = wrapper.closest('.box');
  const header = [...(box?.children || [])].find(child => !child.contains(wrapper) && child.querySelector('input:not([type="hidden"]),select'));
  if (!header || filterControls.has(header)) return;
  const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'isi-portal-button isi-portal-filter-toggle'; toggle.dataset.isiOwned = '';
  const previousId = header.id;
  if (!header.id) header.id = `isi-portal-filters-${filterControls.size + 1}`;
  toggle.setAttribute('aria-controls', header.id); toggle.append(icon('chevron'), document.createTextNode('Filters'));
  header.dataset.isiFilterPanel = '';
  for (const column of header.querySelectorAll('.row > [class*="col-"]')) {
    if (!column.childElementCount && !column.textContent.trim()) column.dataset.isiEmptyLayout = '';
  }
  const hadNoPadding = header.classList.contains('no_padding');
  header.classList.remove('no_padding');
  function setExpanded(expanded, immediate = false) { toggle.setAttribute('aria-expanded', String(expanded)); reveal(header, expanded, immediate); }
  toggle.addEventListener('click', () => setExpanded(toggle.getAttribute('aria-expanded') !== 'true'));
  const addTir = [...header.querySelectorAll('a[href]')].find(link => {
    const url = new URL(link.href);
    return url.origin === location.origin && /^\/islandsun\/(?:index\.php\/)?master\/tir\/create\/?$/i.test(url.pathname);
  });
  let toolbar, addParent, addNext;
  if (addTir) {
    addParent = addTir.parentNode; addNext = addTir.nextSibling;
    toolbar = document.createElement('div'); toolbar.className = 'isi-portal-table-toolbar'; toolbar.dataset.isiOwned = '';
    header.before(toolbar); toolbar.append(toggle, addTir);
    if (!addParent.textContent.trim()) addParent.dataset.isiEmptyLayout = '';
  } else header.before(toggle);
  const navigation = [];
  for (const group of header.querySelectorAll('.btn-group')) {
    const links = [...group.children];
    if (links.length < 2 || !links.every(link => {
      if (!link.matches('a[href]')) return false;
      const url = new URL(link.href);
      return url.origin === location.origin && /^\/islandsun\/(?:index\.php\/)?stockcard(?:\/|$)/i.test(url.pathname);
    })) continue;
    navigation.push({group,parent:group.parentNode,next:group.nextSibling});
    group.classList.add('isi-portal-section-navigation');
    (toolbar || toggle).before(group);
  }
  setExpanded(false, true);
  filterControls.set(header, () => {
    header.hidden = false; header.inert = false;
    if (hadNoPadding) header.classList.add('no_padding');
    delete header.dataset.isiFilterPanel; header.id = previousId;
    if (addTir && addParent.isConnected) addParent.insertBefore(addTir, addNext?.parentNode === addParent ? addNext : null);
    for (const {group,parent,next} of navigation) {
      group.classList.remove('isi-portal-section-navigation');
      if (parent.isConnected) parent.insertBefore(group,next?.parentNode === parent ? next : null);
    }
    toolbar?.remove(); toggle.remove();
  });
}

export function releaseTableControls() {
  for (const cleanup of filterControls.values()) cleanup();
  filterControls.clear();
}

export function translateInterface(root = document) {
  translateNativeFormLabels(root);
  for (const element of root.querySelectorAll(CHROME)) {
    if (element.closest('[data-isi-owned],script,style')) continue;
    if (element.matches('b,small') && element.closest('tbody')) continue;
    for (const node of element.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue;
      const original = node.textContent;
      // Mei is also a person's name; the calendar translates its own month choices.
      if (original.trim() === 'Mei' && element.matches('option,.select2-selection__rendered,.select2-results__option')) continue;
      const translated = translateChrome(original);
      if (element.matches('option') && !element.hasAttribute('value') && translated !== original.trim()) element.setAttribute('value', element.value);
      if (translated !== original.trim().replace(/\s+/g, ' ')) node.textContent = original.replace(original.trim(), translated);
    }
  }
  for (const header of root.querySelectorAll('th[aria-label]')) {
    const original = header.getAttribute('aria-label');
    const separator = original.indexOf(': activate to sort column ');
    const label = separator < 0 ? original : original.slice(0, separator);
    const translated = translateChrome(label) + (separator < 0 ? '' : original.slice(separator));
    if (translated !== original) header.setAttribute('aria-label', translated);
  }
  // Capture implicit option values before translating the displayed label.
  for (const control of root.querySelectorAll('input[placeholder],textarea[placeholder]')) {
    const previous = control.getAttribute('placeholder');
    const translated = translateChrome(previous);
    if (translated !== previous) control.setAttribute('placeholder', translated);
  }
  for (const button of root.querySelectorAll('.lockscreen-credentials button[type="submit"]')) {
    if (!button.getAttribute('aria-label')) button.setAttribute('aria-label', 'Continue signing in');
  }
}

/** Keep DataTables' own controls outside the scroll region without replacing its DOM. */
export function arrangeTables() {
  for (const [header, cleanup] of filterControls) if (!header.isConnected) { cleanup(); filterControls.delete(header); }
  const route = location.pathname.replace(/^\/islandsun\/index\.php\//i, '/islandsun/').replace(/\/$/, '').toLowerCase();
  if (/^\/islandsun\/feedback\/(?:addfeedback|detailfeedback|editfeedback)(?:\/\d+)?$/.test(route)) {
    for (const table of document.querySelectorAll('.content-wrapper table')) {
      const products = table.id === 'tblProduct';
      const history = [...(table.tHead?.rows[0]?.cells || [])].map(cell => cell.textContent.trim().toLowerCase()).join('|') === 'no|note|status|date';
      if (!products && !history || table.closest('.modal')) continue;
      if (table.closest('[data-isi-feedback-scroll]')) continue;
      const region = document.createElement('div');
      region.dataset.isiFeedbackScroll = products ? 'products' : 'history';
      region.tabIndex = 0;
      region.setAttribute('role', 'region');
      region.setAttribute('aria-label', products ? 'Feedback products' : 'Feedback history');
      table.before(region);
      region.append(table);
    }
  }
  if (!LIST_ROUTES.has(route) && !isTirList()) return;
  for (const wrapper of document.querySelectorAll('.content-wrapper .dataTables_wrapper')) {
    if (wrapper.closest('form,.modal,.tab-pane,.hidden,.sembunyi,[hidden]')) continue;
    const rows = [...wrapper.children].filter(child => child.classList.contains('row'));
    const tableRow = rows.find(child => child.querySelector('table'));
    if (!tableRow) continue;
    document.documentElement.dataset.isiLayout = 'table';
    wrapper.dataset.isiTable = 'true';
    addFilterControl(wrapper);
    tableRow.dataset.isiTableScroll = 'true';
    tableRow.tabIndex = 0;
    tableRow.setAttribute('aria-label', 'Scrollable records');
    for (let parent = wrapper.parentElement; parent && parent !== document.querySelector('.content-wrapper'); parent = parent.parentElement) parent.dataset.isiTableChain = 'true';
  }
}

export function addThemeControl() {
  const target = document.querySelector('.main-header .navbar-custom-menu');
  const root = document.documentElement;
  const preference = matchMedia('(prefers-color-scheme: dark)');
  let override = null;
  let activeScheme = preference.matches ? 'dark' : 'light';
  try {
    const saved = sessionStorage.getItem('islandsun.portal.theme');
    if (saved === 'light' || saved === 'dark') override = saved === 'dark';
  } catch { /* Storage restrictions retain the system scheme. */ }
  const button = target ? iconButton('sun', 'Switch to dark mode', () => {
    override = !(override ?? preference.matches);
    try { sessionStorage.setItem('islandsun.portal.theme', override ? 'dark' : 'light'); }
    catch { /* The current page can still use the selected scheme. */ }
    apply();
  }) : null;
  if (button) {
    button.id = 'isi-portal-theme'; button.dataset.isiOwned = ''; button.classList.add('isi-portal-theme-button');
    target.append(button);
  }
  function apply() {
    const dark = override ?? preference.matches;
    activeScheme = dark ? 'dark' : 'light';
    root.dataset.theme = override === null ? 'system' : dark ? 'dark' : 'light';
    if (!button) return;
    renderThemeControl(button, dark);
  }
  preference.addEventListener('change', apply); apply();
  return { destroy({ preserveScheme = false } = {}) {
    preference.removeEventListener('change', apply);
    // Media-query state can reset as the outgoing document detaches.
    if (preserveScheme) root.dataset.theme = activeScheme;
    button?.remove();
  } };
}
