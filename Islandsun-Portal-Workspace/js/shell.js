import { icon, labelSaveAction } from './icons.js';

// Paint-only declarations never control visibility, permissions, field values, or validation.
const PAINT = ['background','background-color','background-image','color','border','border-color','border-radius','box-shadow','text-shadow','font-family','font-size','font-weight'];
const ICONS = [['sign-out','logout'],['key','lock'],['lock','lock'],['list','list'],['clone','copy'],['refresh','refresh'],['undo','refresh'],['arrow-right','arrow'],['bars','menu'],['angle','chevron'],['caret','chevron'],['trash','trash'],['remove','close'],['times','close'],['pencil','edit'],['edit','edit'],['eye','eye'],['plus','plus'],['download','download'],['user','user'],['truck','truck'],['cube','box'],['desktop','home'],['dashboard','home'],['chart','chart'],['check','check']];

export function refineShell() {
  if (/^\/islandsun\/(?:index\.php\/)?stock-request\/(?:add|add-open|add-replace)\/?$/i.test(location.pathname)) {
    const actions = document.querySelector('#btn-submit')?.closest('.row');
    if (actions) actions.dataset.isiStockActions = '';
  }
  if (document.querySelector('.main-header')) for (const node of document.body.childNodes) {
    // The native template emits a stray equals sign before its fixed-header wrapper.
    if (node.nodeType === Node.TEXT_NODE && node.textContent.trim() === '=') node.textContent = '';
  }
  const login = document.querySelector('.lockscreen-wrapper,.login-box');
  if (login) {
    const footer = login.querySelector('.lockscreen-footer');
    if (footer) for (const node of footer.childNodes) if (node.nodeType === Node.TEXT_NODE && node.textContent.includes('Â©')) node.textContent = node.textContent.replaceAll('Â©', '©');
    for (const alert of document.querySelectorAll('body > .alert,body > .show_error')) login.prepend(alert);
    const input = login.querySelector('input:not([type="hidden"]):not([disabled])');
    if (input && !login.dataset.isiFocused) {
      login.dataset.isiFocused = 'true'; input.autofocus = true;
      if (document.activeElement === document.body || document.activeElement === document.documentElement) input.focus({ preventScroll: true });
    }
  }
  for (const clock of document.querySelectorAll('.main-header #clock,.main-header #date')) {
    clock.hidden = true;
    if (clock.parentElement?.matches('i,a:not([href])')) clock.parentElement.hidden = true;
  }
  for (const element of document.querySelectorAll('body[style],body [style],body [bgcolor],body font[color]')) {
    if (element.closest('[data-isi-owned],.select2-container,.datepicker,svg')) continue;
    const conditional = element.closest('[data-isi-operational-form],.fc-event,.filter_color');
    for (const property of PAINT) {
      if (conditional && ['background','background-color','color'].includes(property)) continue;
      element.style.removeProperty(property);
    }
    if (!conditional) { element.removeAttribute('bgcolor'); element.removeAttribute('color'); }
  }
  for (const old of document.querySelectorAll(':is(i,span):is(.fa,.fas,.far,.glyphicon,.mdi),.sidebar-toggle')) {
    if (old.closest('.small-box .icon,.info-box-icon')) continue;
    if (old.dataset.isiIcon) continue;
    old.dataset.isiIcon = 'true';
    const match = ICONS.find(([key]) => old.className.includes(key));
    if (old.classList.contains('sidebar-toggle')) { old.replaceChildren(icon('menu')); old.setAttribute('aria-label', 'Toggle navigation'); }
    else { old.replaceChildren(icon(old.className.includes('clock') ? 'clock' : match?.[1] || 'document')); old.setAttribute('aria-hidden', 'true'); }
  }
  for (const subtitle of document.querySelectorAll('.content-header h1 small,.content-header h5')) {
    if (/Welcome Administrator to Islandsun/i.test(subtitle.textContent)) subtitle.hidden = true;
    if (/^Stock Request$/i.test(subtitle.textContent.trim()) && /\/stock[-_]request\/add-replace\/?$/i.test(location.pathname)) subtitle.hidden = true;
  }
  if (/\/stock[-_]request\/add-replace\/?$/i.test(location.pathname)) {
    for (const link of document.querySelectorAll('.breadcrumb a')) if (/^Stock Request$/i.test(link.textContent.trim())) link.textContent = 'Return & Replacement';
  }
  for (const row of document.querySelectorAll('.content .row')) {
    if (row.querySelector(':scope > [class*="col-"] > .small-box')) {
      row.dataset.isiDashboardGrid = '';
      if (row.previousElementSibling?.querySelector('h2,h3')) row.previousElementSibling.dataset.isiDashboardHeading = '';
    }
  }
  for (const link of document.querySelectorAll('.main-header .logo,.lockscreen-logo,.login-logo')) {
    if (link.dataset.isiBrand) continue;
    link.dataset.isiBrand = 'true';
    const mark = document.createElement('img'); mark.src = chrome.runtime.getURL('assets/family/assets/icons/family.svg'); mark.alt = ''; mark.width = 40; mark.height = 40;
    const text = document.createElement('span'); text.textContent = 'Islandsun';
    const subtitle = document.createElement('small'); subtitle.textContent = 'Company portal'; text.append(subtitle);
    const content = link.matches('a') ? link : link.querySelector(':scope > a') || link;
    content.replaceChildren(mark, text);
  }
  for (const button of document.querySelectorAll('.lockscreen-credentials button[type="submit"],.login-box form button[type="submit"]')) {
    if (button.dataset.isiSubmit) continue;
    button.dataset.isiSubmit = 'true'; button.replaceChildren(icon('arrow'));
    button.setAttribute('aria-label', button.form?.querySelector('input[type="password"]') ? 'Sign in' : 'Continue signing in');
  }
  for (const input of document.querySelectorAll('.lockscreen-credentials input:not([type="hidden"])')) {
    const password = input.type === 'password';
    input.setAttribute('aria-label', password ? 'Password' : 'Username'); input.placeholder = password ? 'Password' : 'Username';
    input.autocomplete = password ? 'current-password' : 'username';
  }
  for (const button of document.querySelectorAll('.table :is(button,a.btn),table.dataTable :is(button,a.btn)')) {
    button.classList.add('isi-portal-table-action');
    const label = button.textContent.trim();
    if (/^(pending|completed|approved|rejected|cancelled|draft)$/i.test(label) && !button.hasAttribute('onclick')) button.dataset.isiStatus = label.toLowerCase();
    if (!button.querySelector('svg') && /^(Detail|Delete|Edit|Download documents|R&D products)$/i.test(label)) {
      const name = /delete/i.test(label) ? 'trash' : /edit/i.test(label) ? 'edit' : /download/i.test(label) ? 'download' : 'eye';
      button.prepend(icon(name));
    }
  }
  for (const button of document.querySelectorAll(':is(.content-wrapper,.modal) button,:is(.content-wrapper,.modal) a.btn')) {
    button.toggleAttribute('data-isi-forward', /^(next|continue)$/i.test(button.textContent.trim()));
    button.toggleAttribute('data-isi-save', /^(save|simpan)$/i.test(button.textContent.trim()));
    if (button.hasAttribute('data-isi-save') && !button.querySelector('[data-isi-save-icon]')) labelSaveAction(button, button.textContent.trim());
  }
  for (const button of document.querySelectorAll(':is(.content-wrapper,.modal) input[type="submit"],:is(.content-wrapper,.modal) input[type="button"]')) {
    button.toggleAttribute('data-isi-save', /^(save|simpan)$/i.test(button.value.trim()));
    if (button.hasAttribute('data-isi-save') && !button.parentElement.matches('.isi-save-input')) {
      const wrapper = document.createElement('span'); wrapper.className = 'isi-save-input';
      wrapper.classList.toggle('isi-save-input--end',getComputedStyle(button).float === 'right');
      const mark = icon('document'); mark.dataset.isiSaveIcon = '';
      button.before(wrapper); wrapper.append(button,mark);
    }
  }
}
