import { pageSubmissionRecord } from './submission-tracking.js';
import { submissionIntent, submissionStage } from './submission-logic.js';
import { portalPath, saveContract, sameSavedFields, sameSavedRecord } from './save-submit-logic.js';
import { saveFieldSnapshot } from './save-field-snapshot.js';
import { sampleProductSnapshot } from './sample-save-snapshot.js';
import { createRequestProgress } from './request-progress.js';
import { holdForegroundAction } from './foreground-action.js';
import { diagnosticLog } from './diagnostic-log.js';
import { handlerId, sampleType, requestDetailUrl } from './logic.js';

/** Own one native save response without rebuilding the user's working form. */
export function createSaveSubmitFrame({ form, pending, onCommitted, onFinished, onSubmission, onSaved }) {
  const name = `isi-save-${[...crypto.getRandomValues(new Uint32Array(4))].map(value => value.toString(16)).join('-')}`;
  const frame = document.createElement('iframe');
  frame.name = name; frame.title = 'Saving request'; frame.className = 'isi-save-frame';
  frame.dataset.isiOwned = ''; frame.tabIndex = -1; frame.setAttribute('aria-hidden', 'true');
  // Native scripts/forms run, but cannot replace the parent, open windows or show hidden dialogs.
  frame.setAttribute('sandbox', 'allow-forms allow-scripts allow-same-origin');
  const originalTarget = form.getAttribute('target');
  const overrides = [...form.querySelectorAll('[formtarget]')].map(node => [node, node.getAttribute('formtarget')]);
  const dialog = document.createElement('dialog');
  dialog.className = 'isi-portal-confirm isi-save-progress'; dialog.dataset.isiOwned = '';
  dialog.setAttribute('aria-labelledby', `${name}-title`);
  const title = document.createElement('h2'); title.id = `${name}-title`; title.textContent = 'Save & Submit';
  const message = document.createElement('p'); message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
  const progress = createRequestProgress('Request in progress');
  const choices = document.createElement('div'); choices.className = 'isi-save-choices';
  const actions = document.createElement('div'); actions.className = 'isi-dialog-actions';
  dialog.append(title, message, progress, choices, actions);
  let state = 'prepared', disposed = false, observer, timer, checkTimer, verificationTimer, pollTimer, lastDocument, savedUrl, releaseAction;
  const trace = (event,fields={}) => diagnosticLog(event,{kind:pending.kind,number:pending.number,state,...fields});
  function poll() {
    clearTimeout(pollTimer);
    if (disposed || state === 'finished') return;
    inspect();
    if (!disposed && state !== 'finished') pollTimer = setTimeout(poll,250);
  }
  let committed = false, selected = false, submitted = false, awaitingDocument;
  function restoreTarget() {
    if (originalTarget === null) form.removeAttribute('target'); else form.setAttribute('target', originalTarget);
    for (const [node, value] of overrides) if (node.isConnected) node.setAttribute('formtarget', value);
  }
  function resetDeadline() {
    clearTimeout(timer);
    timer = setTimeout(() => finish('The portal has not confirmed the result. Check the saved request before trying again.'), 60000);
  }
  function navigate(url) { if (!disposed) location.assign(url); }
  function finish(text, success = false) {
    if (disposed || state === 'finished') return;
    trace('submission-finished',{success,message:text,url:savedUrl});
    state = 'finished'; clearTimeout(timer); clearTimeout(checkTimer); clearTimeout(verificationTimer); clearTimeout(pollTimer); observer?.disconnect(); restoreTarget();
    releaseAction?.(); releaseAction = null;
    frame.removeEventListener('load', inspect); frame.remove();
    progress.hidden = true; choices.replaceChildren(); message.textContent = text;
    dialog.dataset.state = success ? 'success' : 'attention';
    const open = document.createElement('button'); open.type = 'button'; open.className = 'btn btn-primary';
    open.textContent = savedUrl ? 'Open saved request' : 'Open request list';
    open.addEventListener('click', () => navigate(savedUrl || new URL(pending.kind === 'tir' ? '/islandsun/master/Tir' : '/islandsun/samplerequest', location.origin).href));
    actions.replaceChildren(open); onFinished?.({success, committed, url:savedUrl});
    if (!dialog.open) dialog.showModal();
  }
  function accountOf(doc) {
    const link = doc.querySelector('.user-menu a[href*="lockscreen?user="]');
    try { return link && new URL(link.href).searchParams.get('user'); } catch { return null; }
  }
  function chooseTir(doc) {
    state = 'selecting'; progress.hidden = true;
    message.textContent = 'Saved. The portal returned to the TIR list without identifying the new request. Select the TIR you just created; its fields will be checked before submission.';
    const items = [];
    for (const row of doc.querySelectorAll('#mytable tbody tr')) {
      const id = row.querySelector('[onclick]')?.getAttribute('onclick')?.match(/^edit\(([1-9]\d*)\);?$/)?.[1];
      if (!id || !row.cells[1]?.textContent.trim()) continue;
      const button = document.createElement('button'); button.type = 'button';
      button.textContent = `${row.cells[1].textContent.trim()} · ${row.cells[2]?.textContent.trim() || ''}`;
      button.addEventListener('click', () => {
        if (state !== 'selecting') return;
        selected = true; pending.id = id; pending.number = row.cells[1].textContent.trim();
        state = 'verifying'; progress.hidden = false; choices.replaceChildren();
        message.textContent = 'Checking the selected TIR…'; resetDeadline();
        awaitingDocument = doc;
        frame.src = new URL(`/islandsun/master/Tir/edit/${id}`, location.origin).href;
      });
      items.push(button);
    }
    choices.replaceChildren(...items);
    if (items.length) clearTimeout(timer);
    if (!actions.children.length) {
      const open = document.createElement('button'); open.type = 'button'; open.textContent = 'Review in the TIR list';
      open.addEventListener('click', () => navigate(new URL('/islandsun/master/Tir', location.origin).href)); actions.append(open);
    }
  }
  function inspect() {
    clearTimeout(checkTimer);
    if (disposed || !committed || state === 'finished') return;
    let doc, href;
    try { doc = frame.contentDocument; href = frame.contentWindow.location.href; }
    catch { finish('The returned page could not be read. Check the saved request before trying again.'); return; }
    if (!doc || href === 'about:blank' || doc === awaitingDocument || ['selecting','review'].includes(state)) return;
    awaitingDocument = undefined;
    if (doc.readyState === 'loading') return;
    if (doc !== lastDocument) {
      lastDocument = doc; observer?.disconnect();
      trace('submission-response',{url:href,readyState:doc.readyState});
      observer = new MutationObserver(() => { clearTimeout(checkTimer); checkTimer = setTimeout(inspect, 100); });
      observer.observe(doc, {childList:true, subtree:true, attributes:true, characterData:true});
    }
    if (new URL(href).origin !== location.origin || /\/login(?:\/|$)/i.test(new URL(href).pathname)
      || doc.querySelector('.lockscreen-credentials,input[type="password"]:not(#loginMultipleUser input)')) {
      finish('Sign-in is required. Check whether the request was saved before trying again.'); return;
    }
    const status = frame.contentWindow.performance.getEntriesByType('navigation')[0]?.responseStatus;
    if (status >= 400 || [...doc.querySelectorAll('.content-wrapper .alert-danger,.content-wrapper .show_error')].some(node => node.textContent.trim() && !node.hidden && node.getClientRects().length)) {
      finish('The portal returned an error. Check the saved request before trying again.'); return;
    }
    const returnedAccount = accountOf(doc);
    if (returnedAccount && returnedAccount !== pending.account) { finish('The signed-in account changed. Nothing further will be submitted.'); return; }
    const record = pageSubmissionRecord(doc, href);
    if (!record) {
      if (pending.kind === 'sample' && portalPath(new URL(href).pathname) === '/islandsun/samplerequest' && returnedAccount === pending.account && state !== 'locating') {
        const matches = [...doc.querySelectorAll('#mytable tbody tr')].filter(row => [...row.cells].some(cell => cell.textContent.trim() === pending.number));
        if (matches.length === 1) {
          const row = matches[0];
          const id = [...row.querySelectorAll('[onclick]')].map(node => handlerId(node.getAttribute('onclick'),'detailData')).find(Boolean);
          const type = [...row.cells].map(cell => sampleType(cell.textContent)).find(Boolean);
          const url = requestDetailUrl(id,type);
          if (url && (!pending.id || pending.id === id)) {
            state = 'locating'; observer?.disconnect(); trace('submission-located',{url}); awaitingDocument = doc; frame.src = url;
          }
        }
      }
      if (pending.kind === 'tir' && portalPath(new URL(href).pathname) === '/islandsun/master/tir' && returnedAccount === pending.account) {
        if (!pending.id) chooseTir(doc);
        else if (savedUrl || pending.sourceUrl) {
          observer?.disconnect();
          awaitingDocument = doc;
          frame.src = savedUrl || pending.sourceUrl;
        }
      }
      return;
    }
    if (!returnedAccount) { finish('The saved account could not be verified. Review the request before submitting.'); return; }
    if (!sameSavedRecord(pending, record)) { finish('The returned request does not match. Nothing further was submitted.'); return; }
    savedUrl = href;
    const active = submissionStage(record.kind, record.status) === 'active';
    if (active && submitted) {
      finish(`${record.number} submitted to Product Marketing.`, true); return;
    }
    if (submitted) { finish('The portal still shows an unsubmitted request. Review its status before trying again.'); return; }
    const savedForm = [...doc.querySelectorAll('.content-wrapper form')].find(item => saveContract(item.action, href)?.kind === pending.kind);
    const link = [...doc.querySelectorAll('.content-wrapper a[href]')].find(item => submissionIntent(item.href, href, record.number));
    const actual = savedForm && saveFieldSnapshot(savedForm, pending.kind);
    const products = savedForm && pending.products && sampleProductSnapshot(savedForm);
    if (!savedForm || !active && !link || !sameSavedFields(pending.fields, actual)
      || pending.products && JSON.stringify(pending.products) !== JSON.stringify(products)) {
      message.textContent = 'Checking the saved fields and products…';
      if (!verificationTimer) {
        trace('submission-verification-pending',{hasForm:!!savedForm,hasSubmit:!!link,fields:Object.keys(pending.fields).filter(key => JSON.stringify(pending.fields[key]) !== JSON.stringify(actual?.[key])),productsMatch:!pending.products || JSON.stringify(pending.products) === JSON.stringify(products)});
        verificationTimer = setTimeout(() => finish('The saved request needs review. Nothing was submitted; check its values and use Submit when ready.'), 15000);
      }
      // Native Ajax may still be populating the returned form; observe it within the same deadline.
      return;
    }
    clearTimeout(verificationTimer); verificationTimer = undefined;
    onSaved?.();
    if (active) { finish(`${record.number} is saved and already submitted to Product Marketing.`, true); return; }
    const submit = () => {
      if (disposed || submitted || state === 'finished') return;
      submitted = true; state = 'submitting'; actions.replaceChildren(); choices.replaceChildren(); progress.hidden = false;
      trace('submission-start',{url:link.href});
      message.textContent = `Submitting ${record.number} to Product Marketing…`;
      try { Promise.resolve(onSubmission?.(submissionIntent(link.href, href, record.number))).catch(() => {}); }
      catch { /* Notification tracking must not alter an authorized submission. */ }
      resetDeadline(); observer?.disconnect();
      // The exact native link is verified against this record; the user's Save & Submit authorizes it.
      awaitingDocument = doc; frame.src = link.href;
    };
    if (selected) {
      clearTimeout(timer);
      state = 'review'; progress.hidden = true; actions.replaceChildren();
      message.textContent = `${record.number} matches the saved fields. Submit this TIR to Product Marketing?`;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-primary'; button.textContent = 'Submit';
      button.addEventListener('click', submit); actions.append(button); observer?.disconnect();
    } else submit();
  }
  frame.addEventListener('load', inspect);
  dialog.addEventListener('cancel', event => event.preventDefault());
  document.body.append(frame, dialog); form.target = name;
  for (const [node] of overrides) node.setAttribute('formtarget', name);
  return {
    commit() {
      if (disposed || committed) return;
      committed = true; state = 'saving'; message.textContent = 'Saving the request…';
      releaseAction = holdForegroundAction('save-and-submit'); trace('submission-save-start');
      pending.fields = saveFieldSnapshot(form, pending.kind);
      if (!dialog.open) dialog.showModal(); resetDeadline(); onCommitted?.();
      pollTimer = setTimeout(poll,250);
    },
    get committed() { return committed; },
    stop(message) { if (committed) finish(message); else this.destroy(); },
    destroy() {
      if (disposed) return;
      disposed = true; clearTimeout(timer); clearTimeout(checkTimer); clearTimeout(verificationTimer); clearTimeout(pollTimer); observer?.disconnect(); restoreTarget();
      releaseAction?.(); releaseAction = null;
      frame.removeEventListener('load', inspect); frame.remove(); dialog.close(); dialog.remove();
    },
  };
}
