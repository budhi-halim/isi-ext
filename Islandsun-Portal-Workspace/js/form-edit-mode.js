import { submissionIntent } from './submission-logic.js';

function visible(element) {
  return Boolean(element?.isConnected && !element.hidden && element.getClientRects().length
    && !element.closest('[hidden],.hidden,.sembunyi,.hidened') && getComputedStyle(element).visibility !== 'hidden');
}

/** Identify observed native modes without inferring editing permission from a route called "edit". */
function formContract() {
  const root = document.querySelector('.content-wrapper');
  if (!root) return null;
  const forms = [...root.querySelectorAll('form')];
  const actionPath = form => {
    try { return new URL(form.action).pathname; } catch { return ''; }
  };
  const edit = root.querySelector('#btn-edit-lock,#btn-updated');
  const sample = forms.find(form => /\/samplerequest\/processUpdateSampleRequestNew\/?$/i.test(actionPath(form)));
  const tir = forms.find(form => /^\/islandsun\/(?:index\.php\/)?master\/tir\/update\/?$/i.test(actionPath(form)));
  if (edit?.closest('form') || sample || tir) return { form: edit?.closest('form') || sample || tir, edit };
  const sales = forms.find(form => /\/sales-order\/process-edit\/?$/i.test(actionPath(form)));
  if (sales) return { form: sales, edit: root.querySelector('#btn-edit[onclick*="setEditable"]') };
  const stock = forms.find(form => /^\/islandsun\/(?:index\.php\/)?(?:stock-request|Suddenrequest)\/processEditStockRequest\/[1-9]\d*\/?$/i.test(actionPath(form)));
  const replacement = forms.find(form => /^\/islandsun\/(?:index\.php\/)?stock-request\/processEditComplain\/[1-9]\d*\/?$/i.test(actionPath(form)));
  if (stock || replacement) return { form: stock || replacement, save: (stock || replacement).querySelector('#btn-submit') };
  return null;
}

function nativeStatusAction(target) {
  if (!target.matches('a[href]')) return false;
  if (submissionIntent(target.href, location.href, target.textContent.trim())) return true;
  let action;
  try { action = new URL(target.href); } catch { return false; }
  const page = new URL(location.href);
  const sudden = /^\/islandsun\/(?:index\.php\/)?Suddenrequest\/detail-sudden\/([1-9]\d*)\/?$/i.exec(page.pathname);
  return Boolean(sudden && action.origin === page.origin && !action.search && !action.hash
    && action.pathname.toLowerCase() === `/islandsun/suddenrequest/updatestatus/${sudden[1]}/draft`);
}

/** Keep native view-mode fields unchanged until the portal's own Edit action is used. */
export function createFormEditMode(dialogs) {
  const events = new AbortController();
  let form, edit, save, observer, pending = false, disposed = false;
  const originals = new Map();
  const controls = 'input:not([type="hidden"]),select,textarea,[contenteditable="true"]';
  const readingControls = '.dataTables_filter,.dataTables_length,.dataTables_paginate';
  const textControls = 'textarea,input:not([type]),input[type="text"],input[type="search"],input[type="email"],input[type="url"],input[type="tel"],input[type="number"],input[type="date"],input[type="time"],input[type="datetime-local"]';

  function canOfferEdit() { return Boolean(edit?.isConnected && visible(edit) && !edit.disabled); }

  function locked() {
    if (!form?.isConnected) return false;
    if (edit) return !edit.isConnected || visible(edit);
    return save ? !visible(save) : true;
  }
  function restore() {
    for (const [control, attributes] of originals) {
      for (const [name, {before, applied}] of Object.entries(attributes)) {
        if (control.getAttribute(name) !== applied) continue;
        if (before === null) control.removeAttribute(name); else control.setAttribute(name, before);
      }
    }
    originals.clear();
  }
  function sync() {
    if (!form?.isConnected) return;
    for (const control of originals.keys()) if (!control.isConnected) originals.delete(control);
    const readOnly = locked();
    if (form.dataset.isiReadOnly !== String(readOnly)) form.dataset.isiReadOnly = String(readOnly);
    if (!readOnly) { restore(); return; }
    for (const control of form.querySelectorAll(controls)) {
      if (control.closest(readingControls)) continue;
      if (originals.has(control)) continue;
      const changes = {};
      const apply = (name, value) => {
        const before = control.getAttribute(name);
        if (before === value) return;
        changes[name] = {before, applied: value};
        control.setAttribute(name, value);
      };
      originals.set(control, changes);
      apply('aria-readonly', 'true');
      if (!canOfferEdit()) {
        if (control.matches(textControls)) apply('readonly', '');
        else if (control.hasAttribute('contenteditable')) apply('contenteditable', 'false');
        else if (!control.disabled) apply('disabled', '');
      }
    }
  }
  async function explain() {
    if (pending || disposed || !canOfferEdit()) return;
    pending = true;
    const currentEdit = edit;
    const accepted = await dialogs.ask({ title: 'Viewing request',
      message: 'This request is in view mode. Choose Edit request to make changes.',
      action: 'Edit request' });
    pending = false;
    if (accepted && !disposed && edit && edit === currentEdit && locked() && !edit.disabled) { edit.click(); sync(); }
  }
  function intercept(event) {
    if (!locked() || !form?.contains(event.target)) return;
    if (event.type === 'submit') { event.preventDefault(); event.stopImmediatePropagation(); explain(); return; }
    if (edit?.contains(event.target) || event.target.closest('#btn-cancel-lock,dialog[data-isi-owned]')) return;
    const target = event.target.closest(`${controls},label,.select2-container,button,[role="combobox"],a[onclick]`);
    if (!target) return;
    // Marketing submission remains a native workflow action on the viewed record.
    if (nativeStatusAction(target)) return;
    if (target.matches('[data-toggle="tab"],[data-dismiss="modal"],.addtab')) return;
    if (target.closest(readingControls)) return;
    const handler = target.getAttribute('onclick')?.trim() || '';
    if (/^(?:return\s+)?(?:nextRequest\d*|previousRequest\d*|prevRequest\d*|TandaTerimaPDF)\s*\(/.test(handler)) return;
    if (/^checkHutangCustomer\s*\(/.test(handler)) return;
    if (target.matches('button') && /^(?:open\s+)?history(?:\s+tir)?$/i.test(target.textContent.trim())) return;
    // Native readonly text fields retain caret movement, selection and copying.
    if (!canOfferEdit() && target.matches(textControls)
      && ['pointerdown', 'click', 'keydown'].includes(event.type)) return;
    // Tab and copy remain available while viewing values.
    if (event.type === 'keydown' && (['Tab','Escape','Shift','Control','Alt','Meta'].includes(event.key)
      || ((event.ctrlKey || event.metaKey) && ['c','a'].includes(event.key.toLowerCase())))) return;
    event.preventDefault(); event.stopImmediatePropagation();
    explain();
  }
  for (const type of ['pointerdown','click','keydown','beforeinput','paste','drop','submit']) {
    window.addEventListener(type, intercept, { capture: true, signal: events.signal });
  }
  function enhance() {
    const contract = formContract();
    if (!contract) {
      observer?.disconnect(); restore();
      if (form) delete form.dataset.isiReadOnly;
      form = edit = save = null;
      return;
    }
    if (form === contract.form && edit === contract.edit && save === contract.save) { sync(); return; }
    observer?.disconnect(); restore();
    if (form) delete form.dataset.isiReadOnly;
    ({ form, edit, save } = contract);
    observer = new MutationObserver(sync);
    observer.observe(form.closest('.content-wrapper'), { subtree: true, childList: true, attributes: true, attributeFilter: ['style','class','hidden'] });
    sync();
  }
  return { enhance, canEdit(target) { return target !== form || !locked(); }, destroy() {
    disposed = true; events.abort(); observer?.disconnect(); restore();
    if (form) delete form.dataset.isiReadOnly;
  } };
}
