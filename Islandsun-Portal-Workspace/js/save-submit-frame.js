import { pageSubmissionRecord } from './submission-tracking.js';
import { submissionIntent, submissionStage } from './submission-logic.js';
import { portalPath, saveContract, sameSavedFields, sameSavedRecord, newTirRecords, recoveredSample } from './save-submit-logic.js';
import { readSaveIndex, verifySaveAccount } from './save-index.js';
import { savedPageAccount, saveNeedsSignIn } from './save-response.js';
import { saveFieldSnapshot } from './save-field-snapshot.js';
import { sampleProductSnapshot, sameSampleProducts } from './sample-save-snapshot.js';
import { createRequestProgress } from './request-progress.js';
import { holdForegroundAction } from './foreground-action.js';
import { diagnosticLog } from './diagnostic-log.js';
import { handlerId, sampleType, requestDetailUrl, tirDetailUrl } from './logic.js';
import { SAVE_RESPONSE_WAIT_MS, SAVE_PROGRESS_NOTICE_MS, SAVE_VERIFICATION_WAIT_MS, SAVE_VERIFICATION_ATTEMPTS, SAVE_RETRY_DELAYS_MS } from './save-retry-policy.js';

/** Own one native save response without rebuilding the user's working form. */
export function createSaveSubmitFrame({ form, pending, onCommitted, onFinished, onSubmission, onSaved }) {
  const name = `isi-save-${[...crypto.getRandomValues(new Uint32Array(4))].map(value => value.toString(16)).join('-')}`;
  let frame = document.createElement('iframe');
  frame.name = name; frame.title = 'Saving request'; frame.className = 'isi-save-frame';
  frame.dataset.isiOwned = ''; frame.tabIndex = -1; frame.setAttribute('aria-hidden', 'true');
  // Native scripts/forms run, but cannot replace the parent, open windows or show hidden dialogs.
  frame.setAttribute('sandbox', 'allow-forms allow-scripts allow-same-origin');
  const frames = new Set([frame]);
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
  const requests = new AbortController();
  let state = 'prepared', disposed = false, observer, timer, checkTimer, pollTimer, locateTimer, recoveryTimer, lastDocument, savedUrl, releaseAction, beforeIndex;
  let verificationAttempt = 0, verificationStarted = 0, waitSignature = '', verificationIssue = '', progressTimer;
  const trace = (event,fields={}) => diagnosticLog(event,{kind:pending.kind,number:pending.number,state,...fields});
  function poll() {
    clearTimeout(pollTimer);
    if (disposed || state === 'finished') return;
    inspect();
    if (!disposed && state !== 'finished') pollTimer = setTimeout(poll,250);
  }
  let committed = false, submitted = false, awaitingDocument;
  function restoreTarget() {
    if (originalTarget === null) form.removeAttribute('target'); else form.setAttribute('target', originalTarget);
    for (const [node, value] of overrides) if (node.isConnected) node.setAttribute('formtarget', value);
  }
  function resetDeadline(callback = recover, duration = SAVE_RESPONSE_WAIT_MS) {
    clearTimeout(timer);
    timer = setTimeout(callback, duration);
  }
  function navigate(url) { if (!disposed) location.assign(url); }
  function finish(text, success = false) {
    if (disposed || state === 'finished') return;
    trace('submission-finished',{success,message:text,url:savedUrl});
    state = 'finished'; requests.abort(); clearTimeout(timer); clearTimeout(checkTimer); clearTimeout(progressTimer); clearTimeout(pollTimer); clearTimeout(locateTimer); clearTimeout(recoveryTimer); observer?.disconnect(); restoreTarget();
    releaseAction?.(); releaseAction = null;
    for (const item of frames) { item.removeEventListener('load', inspect); item.remove(); }
    frames.clear();
    progress.hidden = true; choices.replaceChildren(); message.textContent = text;
    dialog.dataset.state = success ? 'success' : 'attention';
    const open = document.createElement('button'); open.type = 'button'; open.className = 'btn btn-primary';
    open.textContent = savedUrl ? 'Open saved request' : 'Open request list';
    open.addEventListener('click', () => navigate(savedUrl || new URL(pending.kind === 'tir' ? '/islandsun/master/Tir' : '/islandsun/samplerequest', location.origin).href));
    actions.replaceChildren(open); onFinished?.({success, committed, url:savedUrl});
    if (!dialog.open) dialog.showModal();
  }
  function retireFrames() {
    observer?.disconnect();
    for (const item of frames) { item.removeEventListener('load', inspect); item.remove(); }
    frames.clear();
    lastDocument = undefined;
  }
  function retryVerification() {
    if (disposed || state === 'finished' || state === 'retrying') return;
    clearTimeout(timer); clearTimeout(checkTimer);
    trace('submission-verification-timeout', {attempt:verificationAttempt,elapsedMs:Date.now()-verificationStarted,reason:verificationIssue || 'document-not-ready',url:savedUrl});
    retireFrames();
    if (verificationAttempt >= SAVE_VERIFICATION_ATTEMPTS) {
      finish(submitted
        ? `${pending.number}: submission could not be confirmed after three checks. Open the saved request to check its status; Submit was not repeated.`
        : `Automatic verification of ${pending.number} could not finish after three attempts. Nothing further was submitted. Open the saved request to review it.`);
      return;
    }
    state = 'retrying';
    const delay = SAVE_RETRY_DELAYS_MS[verificationAttempt-1];
    message.textContent = `The portal is taking longer. Retrying verification (${verificationAttempt+1}/${SAVE_VERIFICATION_ATTEMPTS}) in ${delay/1000} seconds…`;
    trace('submission-verification-retry', {attempt:verificationAttempt+1,delayMs:delay,url:savedUrl});
    recoveryTimer = setTimeout(() => openRecoveryPage(savedUrl), delay);
  }
  function startVerification() {
    clearTimeout(timer); clearTimeout(progressTimer);
    verificationAttempt++;
    verificationStarted = Date.now(); waitSignature = ''; verificationIssue = '';
    state = 'verifying';
    resetDeadline(retryVerification, SAVE_VERIFICATION_WAIT_MS);
    trace('submission-verification-start', {attempt:verificationAttempt,phase:submitted ? 'submit' : 'save',url:savedUrl});
  }
  function openRecoveryPage(url) {
    if (disposed || state === 'finished') return;
    observer?.disconnect(); frame.removeEventListener('load', inspect);
    const next = frame.cloneNode(false);
    next.removeAttribute('src');
    // Retire the old browsing context before another read; neither write is replayed.
    retireFrames(); frame = next; frame.name = `${name}-verify-${submitted ? 'submit' : 'save'}-${verificationAttempt+1}`;
    frames.add(frame); savedUrl = url;
    frame.addEventListener('load', inspect); document.body.append(frame);
    awaitingDocument = frame.contentDocument; lastDocument = undefined;
    startVerification(); frame.src = url;
    message.textContent = `${submitted ? 'Checking whether the portal completed submission' : 'Checking the saved fields and products'} (${verificationAttempt}/${SAVE_VERIFICATION_ATTEMPTS})…`;
    trace('submission-recovery-page', {url, phase:submitted ? 'submit' : 'save'});
  }
  function scheduleRecovery() {
    clearTimeout(progressTimer);
    progressTimer = setTimeout(() => {
      if (!disposed && ['saving','submitting'].includes(state)) {
        message.textContent = 'The portal is taking longer than usual. Waiting for its response; your action will not be repeated…';
        trace('submission-response-delayed', {waitMs:SAVE_RESPONSE_WAIT_MS});
      }
    }, SAVE_PROGRESS_NOTICE_MS);
  }
  async function recover(attempt = 0) {
    if (disposed || state === 'finished') return;
    state = 'recovering'; observer?.disconnect(); clearTimeout(timer); clearTimeout(progressTimer);
    message.textContent = 'The portal response is delayed. Checking the saved result without saving again…';
    if (!attempt) trace('submission-recovery-start', {phase:submitted ? 'submit' : 'save'});
    try {
      await verifySaveAccount(pending.account);
      if (disposed || state !== 'recovering') return;
      if (pending.id && (savedUrl || pending.sourceUrl)) {
        openRecoveryPage(savedUrl || pending.sourceUrl); return;
      }
      const after = await readSaveIndex(pending.kind, pending.account, requests.signal, 'delayed-response');
      if (disposed || state !== 'recovering') return;
      if (pending.kind === 'sample') {
        const record = recoveredSample(beforeIndex, after, pending);
        if (record) { pending.id = record.id; openRecoveryPage(record.url); return; }
      } else {
        const records = newTirRecords(beforeIndex, after);
        if (records.length === 1) {
          pending.id = records[0].id; pending.number = records[0].number;
          openRecoveryPage(tirDetailUrl(pending.id)); return;
        }
        if (records.length > 1) { chooseTir(records, frame.contentDocument); return; }
      }
    } catch (error) {
      if (disposed || state === 'finished') return;
      trace('submission-recovery-failed', {attempt:attempt+1, errorType:error.name});
      if (error.name === 'SignInRequiredError') { finish('Sign-in is required. Check whether the request was saved before trying again.'); return; }
      if (error.name === 'AccountChangedError') { finish('The signed-in account changed. Nothing further will be submitted.'); return; }
    }
    if (attempt < 2) recoveryTimer = setTimeout(() => recover(attempt+1), SAVE_RETRY_DELAYS_MS[attempt]);
    else finish('The portal has not confirmed the saved result. Check the request list before trying again; saving was not repeated.');
  }
  function openTir(record, doc) {
    if (disposed || state === 'finished') return;
    pending.id = record.id; pending.number = record.number;
    progress.hidden = false; choices.replaceChildren(); actions.replaceChildren();
    trace('submission-located', {url:tirDetailUrl(record.id), source:'new-index-record'});
    openRecoveryPage(tirDetailUrl(record.id));
  }
  function chooseTir(records, doc) {
    trace('submission-identity-ambiguous',{candidates:records.map(record => ({id:record.id,number:record.number}))});
    finish('The portal returned more than one possible saved TIR. Automatic submission stopped because its identity could not be confirmed. Check the TIR list; Save was not repeated.');
  }
  async function locateTir(doc, attempt = 0) {
    if (disposed || state === 'finished') return;
    state = 'locating'; clearTimeout(timer); clearTimeout(progressTimer); message.textContent = 'Finding the saved TIR…';
    try {
      const after = await readSaveIndex('tir', pending.account, requests.signal, 'after-save');
      if (disposed || state !== 'locating') return;
      const records = newTirRecords(beforeIndex, after);
      trace('submission-candidates', {count:records.length, attempt:attempt+1});
      if (records.length === 1) { openTir(records[0], doc); return; }
      if (records.length > 1) { chooseTir(records, doc); return; }
    } catch (error) {
      if (disposed || state === 'finished') return;
      trace('submission-locate-failed', {attempt:attempt+1, errorType:error.name});
      if (error.name === 'SignInRequiredError') { finish('Sign-in is required. Check whether the request was saved before trying again.'); return; }
      if (error.name === 'AccountChangedError') { finish('The signed-in account changed. Nothing further will be submitted.'); return; }
    }
    // Only repeat the read. The native save is never retried automatically.
    if (attempt < 2) locateTimer = setTimeout(() => locateTir(doc, attempt+1), SAVE_RETRY_DELAYS_MS[attempt]);
    else finish('The portal has not identified the saved TIR. Check the request list before trying again; nothing was submitted.');
  }
  function inspect() {
    clearTimeout(checkTimer);
    if (disposed || !committed || ['finished','retrying','locating','recovering','selecting','review','authorizing'].includes(state)) return;
    let doc, href;
    try { doc = frame.contentDocument; href = frame.contentWindow.location.href; }
    catch { finish('The returned page could not be read. Check the saved request before trying again.'); return; }
    const waiting = !doc || href === 'about:blank' || doc === awaitingDocument ? 'document-not-ready' : doc.readyState === 'loading' ? 'document-loading' : '';
    if (waiting) {
      if (waitSignature !== `${waiting}:${href}`) { waitSignature = `${waiting}:${href}`; verificationIssue = waiting; trace('submission-frame-wait', {reason:waiting,url:href,attempt:verificationAttempt}); }
      return;
    }
    awaitingDocument = undefined;
    if (doc !== lastDocument) {
      lastDocument = doc; observer?.disconnect();
      trace('submission-response',{url:href,readyState:doc.readyState});
      observer = new MutationObserver(() => { clearTimeout(checkTimer); checkTimer = setTimeout(inspect, 100); });
      observer.observe(doc, {childList:true, subtree:true, attributes:true, characterData:true});
    }
    if (new URL(href).origin !== location.origin || saveNeedsSignIn(doc, href)) {
      finish('Sign-in is required. Check whether the request was saved before trying again.'); return;
    }
    const status = frame.contentWindow.performance.getEntriesByType('navigation')[0]?.responseStatus;
    if (status >= 500) {
      verificationIssue = `http-${status}`;
      if (verificationAttempt && savedUrl) retryVerification(); else recover();
      return;
    }
    if (status >= 400 || [...doc.querySelectorAll('.content-wrapper .alert-danger,.content-wrapper .show_error')].some(node => node.textContent.trim() && !node.hidden && node.getClientRects().length)) {
      finish('The portal returned an error. Check the saved request before trying again.'); return;
    }
    const returnedAccount = savedPageAccount(doc);
    if (returnedAccount && returnedAccount !== pending.account) { finish('The signed-in account changed. Nothing further will be submitted.'); return; }
    const record = pageSubmissionRecord(doc, href);
    if (!record) {
      if (state === 'verifying') {
        verificationIssue = 'saved-record-not-visible';
        return;
      }
      if (pending.kind === 'sample' && portalPath(new URL(href).pathname) === '/islandsun/samplerequest' && returnedAccount === pending.account && state !== 'locating') {
        const matches = [...doc.querySelectorAll('#mytable tbody tr')].filter(row => [...row.cells].some(cell => cell.textContent.trim() === pending.number));
        if (matches.length === 1) {
          const row = matches[0];
          const id = [...row.querySelectorAll('[onclick]')].map(node => handlerId(node.getAttribute('onclick'),'detailData')).find(Boolean);
          const type = [...row.cells].map(cell => sampleType(cell.textContent)).find(Boolean);
          const url = requestDetailUrl(id,type);
          if (url && (!pending.id || pending.id === id)) {
            trace('submission-located',{url}); openRecoveryPage(url);
          }
        }
      }
      if (pending.kind === 'tir' && portalPath(new URL(href).pathname) === '/islandsun/master/tir' && returnedAccount === pending.account) {
        if (!pending.id && state !== 'locating') locateTir(doc);
        else if (savedUrl || pending.sourceUrl) {
          openRecoveryPage(savedUrl || pending.sourceUrl);
        }
      }
      return;
    }
    if (!returnedAccount) { finish('The saved account could not be verified. Review the request before submitting.'); return; }
    if (!sameSavedRecord(pending, record)) { finish('The returned request does not match. Nothing further was submitted.'); return; }
    pending.id = record.id;
    savedUrl = href;
    if (state !== 'verifying') startVerification();
    const active = submissionStage(record.kind, record.status) === 'active';
    if (active && submitted) {
      finish(`${record.number} submitted to Product Marketing.`, true); return;
    }
    if (submitted) {
      verificationIssue = 'submitted-status-not-visible';
      message.textContent = `Waiting for the portal to confirm submission (${verificationAttempt}/${SAVE_VERIFICATION_ATTEMPTS})…`;
      return;
    }
    const savedForm = [...doc.querySelectorAll('.content-wrapper form')].find(item => saveContract(item.action, href)?.kind === pending.kind);
    const link = [...doc.querySelectorAll('.content-wrapper a[href]')].find(item => submissionIntent(item.href, href, record.number));
    const actual = savedForm && saveFieldSnapshot(savedForm, pending.kind);
    const products = savedForm && pending.products && sampleProductSnapshot(savedForm);
    if (!savedForm || !active && !link || !sameSavedFields(pending.fields, actual)
      || pending.products && !sameSampleProducts(pending.products,products)) {
      message.textContent = 'Checking the saved fields and products…';
      verificationIssue = 'saved-fields-not-matched';
      const details = {hasForm:!!savedForm,hasSubmit:!!link,fields:Object.keys(pending.fields).filter(key => JSON.stringify(pending.fields[key]) !== JSON.stringify(actual?.[key])),productsMatch:!pending.products || sameSampleProducts(pending.products,products),
        expectedProducts:pending.products,actualProducts:products,productHeadings:[...savedForm?.querySelectorAll('#tableSP thead th') || []].map(cell=>cell.textContent.trim())};
      const signature = JSON.stringify(details);
      if (signature !== waitSignature) { waitSignature = signature; trace('submission-verification-pending',{...details,attempt:verificationAttempt}); }
      // Native Ajax may still be populating the returned form; observe it within the same deadline.
      return;
    }
    onSaved?.();
    if (active) { finish(`${record.number} is saved and already submitted to Product Marketing.`, true); return; }
    const submit = async () => {
      if (disposed || submitted || state === 'finished') return;
      state = 'authorizing'; clearTimeout(timer); actions.replaceChildren(); choices.replaceChildren(); progress.hidden = false;
      message.textContent = `Submitting ${record.number} to Product Marketing…`;
      observer?.disconnect(); awaitingDocument = doc;
      try { await verifySaveAccount(pending.account); }
      catch { finish('The signed-in account could not be verified. Nothing further was submitted.'); return; }
      if (disposed || state === 'finished') return;
      if (doc !== frame.contentDocument || savedPageAccount(doc) !== pending.account) {
        finish('The saved page changed during verification. Review the request before submitting.'); return;
      }
      trace('submission-start',{url:link.href});
      submitted = true; state = 'submitting'; verificationAttempt = 0;
      resetDeadline();
      try { Promise.resolve(onSubmission?.(submissionIntent(link.href, href, record.number))).catch(() => {}); }
      catch { /* Notification tracking must not alter an authorized submission. */ }
      // The exact native link is verified against this record; the user's Save & Submit authorizes it.
      frame.src = link.href;
      scheduleRecovery();
    };
    void submit();
  }
  frame.addEventListener('load', inspect);
  dialog.addEventListener('cancel', event => event.preventDefault());
  document.body.append(frame, dialog); form.target = name;
  for (const [node] of overrides) node.setAttribute('formtarget', name);
  return {
    waitForSave() {
      if (disposed || committed) return;
      message.textContent = 'Checking the portal’s product review and saving the request…';
      if (!dialog.open) dialog.showModal();
    },
    async prepare() {
      if (pending.id) return;
      state = 'preparing'; message.textContent = 'Preparing to save and identify this request…';
      releaseAction = holdForegroundAction('save-and-submit');
      dialog.showModal();
      beforeIndex = await readSaveIndex(pending.kind, pending.account, requests.signal, 'before-save');
      if (disposed) throw new DOMException('Saving cancelled.', 'AbortError');
      state = 'prepared'; dialog.close();
    },
    commit() {
      if (disposed || committed) return;
      committed = true; state = 'saving'; message.textContent = 'Saving the request…';
      releaseAction ||= holdForegroundAction('save-and-submit'); trace('submission-save-start');
      pending.fields = saveFieldSnapshot(form, pending.kind);
      if (!dialog.open) dialog.showModal(); resetDeadline(); onCommitted?.();
      pollTimer = setTimeout(poll,250);
      scheduleRecovery();
    },
    get committed() { return committed; },
    stop(message) { if (committed) finish(message); else this.destroy(); },
    destroy() {
      if (disposed) return;
      disposed = true; requests.abort(); clearTimeout(timer); clearTimeout(checkTimer); clearTimeout(progressTimer); clearTimeout(pollTimer); clearTimeout(locateTimer); clearTimeout(recoveryTimer); observer?.disconnect(); restoreTarget();
      releaseAction?.(); releaseAction = null;
      for (const item of frames) { item.removeEventListener('load', inspect); item.remove(); }
      frames.clear(); dialog.close(); dialog.remove();
    },
  };
}
