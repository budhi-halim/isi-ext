import { pageSubmissionRecord } from './submission-tracking.js';
import { submissionIntent } from './submission-logic.js';
import { saveContract } from './save-submit-logic.js';
import { labelSaveAction } from './icons.js';
import { sampleRequestNumber, sampleProductSnapshot, sampleReviewMatches } from './sample-save-snapshot.js';
import { createSaveSubmitFrame } from './save-submit-frame.js';
import { diagnosticLog } from './diagnostic-log.js';
import { readSampleContinuation } from './sample-save-continuation.js';

/** Add the explicit two-stage action while leaving ordinary native Save intact. */
export function createSaveSubmit({ notify, canEdit, account, onSubmission, onSaved }) {
  const events = new AbortController(), buttons = new Map(), groups = new Map(), locked = new WeakSet();
  let active, disposed = false, timer;
  function syncButtons() {
    for (const [save, button] of buttons) {
      const contract = saveContract(save.form.action, location.href);
      const eligible = !contract?.id || [...document.querySelectorAll('.content-wrapper a[href]')].some(link => submissionIntent(link.href, location.href, 'saved request'));
      const hidden = !eligible || !canEdit(save.form) || !save.getClientRects().length || !!save.closest('[hidden],.hidden,.sembunyi,.hidened');
      const disabled = !!active || locked.has(save.form) || save.disabled;
      if (button.hidden !== hidden) button.hidden = hidden;
      if (button.disabled !== disabled) button.disabled = disabled;
    }
  }
  function continueProductReview() {
    if (!active?.authorized || active.finished || active.reviewed || active.transaction.committed) return;
    const review = document.querySelector('#modal-produk-masuk');
    if (!review?.getClientRects().length || getComputedStyle(review).display === 'none') return;
    const save = [...review.querySelectorAll('button[onclick],input[onclick]')].filter(button => /^(save|simpan)$/i.test((button.textContent || button.value).trim()));
    if (save.length !== 1 || save[0].disabled || !sampleReviewMatches(active.products,review)) return;
    active.reviewed = true;
    diagnosticLog('submission-product-review',{number:active.number,matched:true,products:active.products.length});
    save[0].click();
  }
  const observer = new MutationObserver(() => { syncButtons(); continueProductReview(); });
  observer.observe(document.body, {subtree:true, childList:true, characterData:true, attributes:true, attributeFilter:['style','class','hidden','disabled','data-isi-read-only']});
  function cancelPrepared(allowFinished = false) {
    if (!active || active.transaction.committed || active.finished && allowFinished !== true) return;
    active.transaction.destroy(); delete active.form.dataset.isiSaveSubmit; delete active.form.dataset.isiSaveSubmitAuthorized; active = null;
    clearTimeout(timer); syncButtons();
  }
  function commit(form) {
    if (disposed || active?.finished || form !== active?.form || !canEdit(form)) return true;
    const committed = active.transaction.commit(); clearTimeout(timer);
    return committed;
  }
  window.addEventListener('submit', event => {
    if (!disposed && !event.defaultPrevented && commit(event.target) === false) event.preventDefault();
  }, {signal:events.signal});
  document.addEventListener('islandsun-native-submit', event => { if (commit(event.target) === false) event.preventDefault(); }, {signal:events.signal});
  document.addEventListener('islandsun-native-submit-failed', () => active?.transaction.stop('The save could not be confirmed. Check the request list before trying again.'), {signal:events.signal});
  document.addEventListener('invalid', event => { if (event.target.form === active?.form) cancelPrepared(); }, {capture:true,signal:events.signal});
  document.addEventListener('islandsun-confirm-response', event => {
    if (!active || !event.detail?.combined || event.detail.action !== 'Save') return;
    if (event.detail.accepted !== true) cancelPrepared();
    else { active.authorized = true; active.form.dataset.isiSaveSubmitAuthorized = 'true'; active.transaction.waitForSave(); }
  }, {capture:true,signal:events.signal});
  document.addEventListener('islandsun-portal-notice', cancelPrepared, {signal:events.signal});
  document.addEventListener('click', event => {
    if (!event.isTrusted || !active) return;
    const save = [...buttons.keys()].find(button => button === event.target || button.contains(event.target));
    if (save?.form === active.form) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, {capture:true,signal:events.signal});
  async function start(save, contract) {
    const form = save.form;
    if (disposed || active || locked.has(form) || !canEdit(form) || save.disabled) return;
    if (!save.dispatchEvent(new CustomEvent('islandsun-before-save', {bubbles:true,cancelable:true}))) return;
    const current = pageSubmissionRecord(), number = current?.number || sampleRequestNumber();
    if (!account || contract.kind === 'sample' && !contract.id && !number) {
      notify('Save this request first, then review and submit it.', {error:true}); return;
    }
    const products = contract.kind === 'sample' ? sampleProductSnapshot(form) : undefined;
    if (products === null) { notify('Review the product list before using Save & Submit.', {error:true}); return; }
    const pending = {account, ...contract, number, products, sourceUrl:current?.url,
      sampleType:contract.kind === 'sample' ? Number(form.querySelector('[name="srtype"]')?.value || new URL(location.href).searchParams.get('srtype')) : undefined};
    const transaction = createSaveSubmitFrame({form, pending, nativeSave:contract.kind === 'sample', onSubmission, onSaved:() => onSaved?.(form),
      onCommitted() {
        locked.add(form);
        // Leave native successful controls enabled until the browser has collected the form data.
        setTimeout(() => { if (!disposed && save.isConnected && locked.has(form)) save.disabled = true; }, 0);
      },
      onFinished() { if (active?.transaction === transaction) active.finished = true; clearTimeout(timer); delete form.dataset.isiSaveSubmit; delete form.dataset.isiSaveSubmitAuthorized; syncButtons(); },
      onClosed() { if (active?.transaction === transaction && !transaction.committed) cancelPrepared(true); },
    });
    active = {form, transaction, products, number, authorized:false, reviewed:false}; form.dataset.isiSaveSubmit = contract.kind === 'sample' ? 'navigation' : 'iframe'; syncButtons();
    try { await transaction.prepare(); }
    catch {
      if (disposed || active?.transaction !== transaction) return;
      transaction.stop('Automatic submission could not be prepared. Nothing was saved. Try again later or use Save.'); return;
    }
    if (disposed || active?.transaction !== transaction) return;
    if (!canEdit(form) || !form.isConnected || save.disabled) { cancelPrepared(); return; }
    try { save.click(); }
    catch { transaction.stop('Save did not start. Review the form before trying again.'); return; }
    if (active && !active.finished && !transaction.committed) timer = setTimeout(() => {
      if (active && !active.finished && !transaction.committed) {
        const review = active.authorized && document.querySelector('#modal-produk-masuk');
        diagnosticLog('submission-save-not-started',{number,authorized:active.authorized,reviewed:active.reviewed,reviewPresent:!!review,
          expectedProducts:active.products,
          reviewRows:review ? [...review.querySelectorAll('#body-produk-masuk tr')].slice(0,50).map(row => [...row.cells].map(cell => cell.textContent.trim().slice(0,300))) : undefined});
        transaction.stop(review ? 'The portal’s product review could not be verified. Nothing was saved or submitted.' : 'Save did not start. Review the form before trying again.');
      }
    }, 60000);
  }
  function restoreGroup(save) {
    const entry = groups.get(save);
    if (!entry) return;
    for (const [node, marker] of entry.originals) { if (marker.isConnected) marker.replaceWith(node); }
    entry.group.remove(); groups.delete(save);
  }
  function enhance() {
    if (disposed) return;
    for (const [save, button] of buttons) if (!save.isConnected) { button.remove(); restoreGroup(save); buttons.delete(save); }
    for (const form of document.querySelectorAll('.content-wrapper form')) {
      const contract = saveContract(form.action, location.href);
      if (!contract) continue;
      const save = [...form.querySelectorAll('button,input[type="submit"]')].find(control => !control.hasAttribute('data-isi-owned') && /^(save|simpan)(\s+update)?$/i.test((control.textContent || control.value).trim()));
      if (!save || buttons.has(save)) continue;
      const button = document.createElement('button'); button.type = 'button';
      button.className = 'btn btn-primary isi-save-submit'; button.dataset.isiSaveAction = ''; button.dataset.isiOwned = '';
      labelSaveAction(button, 'Save & Submit'); button.addEventListener('click', () => start(save, contract));
      const original = save.parentElement.matches('.isi-save-input') ? save.parentElement : save;
      const cancel = [...original.parentElement.children].find(node => node !== original && node.matches('button,a,input') && /^(cancel|batal)$/i.test((node.textContent || node.value).trim()));
      const originals = [original, cancel].filter(Boolean).map(node => {
        const marker = document.createComment('native action'); node.before(marker); return [node, marker];
      });
      const group = document.createElement('div'); group.className = 'isi-save-actions'; original.before(group);
      group.append(original, button); if (cancel) group.append(cancel);
      groups.set(save, {group, originals}); buttons.set(save, button);
    }
    syncButtons();
  }
  const continuation = readSampleContinuation(account);
  if (continuation) {
    const transaction = createSaveSubmitFrame({pending:continuation,onSubmission,
      onFinished() { if (active?.transaction === transaction) active.finished = true; syncButtons(); },
    });
    active = {form:null,transaction,number:continuation.number,authorized:true,reviewed:true};
    void transaction.resume();
  }
  return {enhance, destroy() {
    if (disposed) return;
    disposed = true; clearTimeout(timer); events.abort(); observer.disconnect();
    active?.transaction.destroy();
    if (active?.form) { delete active.form.dataset.isiSaveSubmit; delete active.form.dataset.isiSaveSubmitAuthorized; }
    for (const [save, button] of buttons) { button.remove(); restoreGroup(save); }
    buttons.clear();
  }};
}
