const READING = '.dataTables_filter,.dataTables_length,.dataTables_paginate,[data-isi-owned]';

function requestForm(form) {
  if (!(form instanceof HTMLFormElement) || form.method.toLowerCase() !== 'post') return false;
  try {
    const url = new URL(form.action);
    return url.origin === location.origin && /^\/islandsun\/(?:index\.php\/)?(?:samplerequest|master\/tir|stock-request|sales-order|suddenrequest)\//i.test(url.pathname);
  } catch { return false; }
}

/** Keep comparison values only in this page's memory; never persist request content. */
function snapshot(form) {
  return JSON.stringify([...form.elements].filter(control =>
    control.matches('input,textarea,select') && !control.closest(READING)
    && !['hidden', 'button', 'submit', 'reset', 'image'].includes(control.type)
  ).map(control => [control.name || control.id, control.type,
    control.type === 'file' ? [...control.files].map(file => [file.name, file.size, file.lastModified])
      : control.matches('select') ? [...control.selectedOptions].map(option => option.value)
        : ['radio', 'checkbox'].includes(control.type) ? [control.value, control.checked] : control.value,
  ]));
}

/** Warn on leaving changed request forms while preserving native validation and submission. */
export function createUnsavedChanges(canEdit, dialogs) {
  const forms = new Map(), events = new AbortController();
  let listening = false, submitting = null, submissionTimer, interactionForm = null, leaving = false, confirming = false;
  function clearSubmission() { clearTimeout(submissionTimer); submitting = null; }
  function isDirty() {
    return [...forms].some(([form, state]) => form !== submitting && form.isConnected
      && canEdit(form) && state.touched && snapshot(form) !== state.baseline);
  }
  function beforeLeave(event) {
    if (!leaving && isDirty()) { event.preventDefault(); event.returnValue = ''; }
  }
  function track(event) {
    const form = event.target.closest?.('form');
    const state = forms.get(form);
    if (!state || !canEdit(form) || event.target.closest(READING)) return;
    if (!event.isTrusted && interactionForm !== form) {
      if (!state.touched) state.baseline = snapshot(form);
      return;
    }
    state.editable = true;
    state.touched = true;
    if (!listening) { window.addEventListener('beforeunload', beforeLeave); listening = true; }
  }
  function allowSubmission(form) {
    if (!forms.has(form) || !canEdit(form)) return;
    clearSubmission(); submitting = form;
    // An attempted native submission is not proof of a successful save.
    submissionTimer = setTimeout(clearSubmission, 1500);
  }
  function beginInteraction(event) {
    if (!event.isTrusted) return;
    const previousForm = interactionForm;
    interactionForm = null;
    const control = event.target.closest?.('input,textarea,select,label,button,.select2-container,.select2-dropdown,.isi-tir-source');
    const form = control?.closest('form') || (control?.closest('.select2-dropdown') ? previousForm : null);
    const state = forms.get(form);
    if (!state || !canEdit(form) || control.closest('.dataTables_filter,.dataTables_length,.dataTables_paginate')) return;
    if (!state.touched) state.baseline = snapshot(form);
    interactionForm = form;
  }
  for (const type of ['pointerdown','keydown','beforeinput']) document.addEventListener(type, beginInteraction, {capture:true,signal:events.signal});
  for (const type of ['input', 'change']) document.addEventListener(type, track, {capture: true, signal: events.signal});
  document.addEventListener('click', event => {
    if (!event.isTrusted || !event.target.closest?.('button')) return;
    const form = event.target.closest('form'), state = forms.get(form);
    queueMicrotask(() => {
      if (!events.signal.aborted && state && snapshot(form) !== state.baseline) track(event);
    });
  }, {capture:true,signal:events.signal});
  document.addEventListener('click', async event => {
    const link = event.target.closest?.('a[href]');
    if (!dialogs || event.defaultPrevented || !link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey
      || link.hasAttribute('download') || link.hasAttribute('onclick') || link.target && link.target !== '_self') return;
    const url = new URL(link.href, location.href);
    const sameDocument = link.getAttribute('href').startsWith('#') || url.hash && url.href.split('#')[0] === location.href.split('#')[0];
    if (!['http:','https:'].includes(url.protocol) || sameDocument || !isDirty()) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (confirming) return;
    confirming = true;
    const accepted = await dialogs.ask({title:'Leave this request?',message:'Your changes have not been saved. Leave this page and discard them?',action:'Leave'});
    confirming = false;
    if (accepted && !events.signal.aborted && link.isConnected) { leaving = true; location.assign(url.href); }
  }, {capture:true,signal:events.signal});
  window.addEventListener('pageshow', () => { leaving = false; }, {signal:events.signal});
  for (const type of ['pointerdown', 'keydown']) document.addEventListener(type, clearSubmission, {capture: true, signal: events.signal});
  window.addEventListener('submit', event => {
    queueMicrotask(() => { if (!events.signal.aborted && !event.defaultPrevented) allowSubmission(event.target); });
  }, {signal: events.signal});
  document.addEventListener('islandsun-native-submit', event => allowSubmission(event.target), {signal: events.signal});
  document.addEventListener('islandsun-native-submit-failed', clearSubmission, {signal: events.signal});
  function enhance() {
    for (const form of forms.keys()) if (!form.isConnected) forms.delete(form);
    for (const form of document.querySelectorAll('.content-wrapper form')) {
      if (!requestForm(form)) continue;
      const editable = canEdit(form), previous = forms.get(form);
      if (!previous || previous.editable !== editable) forms.set(form, {editable, baseline: snapshot(form), touched: false});
      else if (!previous.touched && interactionForm !== form) previous.baseline = snapshot(form);
    }
  }
  return {enhance, markSaved(form) {
    const state = forms.get(form);
    if (state) { state.baseline = snapshot(form); state.touched = false; }
    if (submitting === form) clearSubmission();
  }, destroy() {
    events.abort(); clearSubmission(); forms.clear();
    window.removeEventListener('beforeunload', beforeLeave);
  }};
}
