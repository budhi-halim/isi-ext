import { translateChrome } from './logic.js';
import { enterSurface, exitSurface } from './motion.js';
import { labelSaveAction } from './icons.js';

function confirmationText(message, action) {
  if (/technical request/i.test(message)) return 'Save this technical information request?';
  if (/general request/i.test(message)) return 'Save this general sample request?';
  if (/^are you sure(?: want to submit)?\??$/i.test(message.trim())) return action === 'Save' ? 'Save this request?' : `${action} with this action?`;
  return translateChrome(message);
}

export function createPortalDialogs() {
  const events = new AbortController(), queue = [];
  let current = null, disposed = false;
  function respond(item, accepted) {
    item.respond?.(accepted);
    if (item.id !== undefined) document.dispatchEvent(new CustomEvent('islandsun-confirm-response', { detail: { id: item.id, accepted } }));
  }
  function showNext() {
    if (disposed || current || !queue.length) return;
    const item = queue.shift(), previousFocus = document.activeElement;
    const dialog = document.createElement('dialog'); dialog.className = 'isi-portal-confirm'; dialog.dataset.isiOwned = '';
    dialog.setAttribute('aria-labelledby','isi-confirm-title'); dialog.setAttribute('aria-describedby','isi-confirm-message');
    const title = document.createElement('h2'); title.id = 'isi-confirm-title'; title.textContent = item.title || (item.id === undefined ? 'Please review' : item.action === 'Save' ? 'Save request' : 'Confirm action');
    const message = document.createElement('p'); message.id = 'isi-confirm-message'; message.textContent = item.message;
    const actions = document.createElement('div'); actions.className = 'isi-dialog-actions';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = item.id === undefined && (!item.respond || !item.action) ? 'Close' : 'Cancel';
    actions.append(cancel);
    if (item.id !== undefined || item.respond && item.action) {
      const accept = document.createElement('button'); accept.type = 'button'; accept.textContent = item.action; accept.className = 'btn btn-primary';
      if (item.action === 'Save') { accept.dataset.isiSaveAction = ''; labelSaveAction(accept,item.action); }
      accept.addEventListener('click', () => finish(true)); actions.append(accept);
    }
    dialog.append(title,message,actions); document.body.append(dialog);
    current = { dialog, item, previousFocus, closing: false };
    function finish(accepted) {
      if (!current || current.dialog !== dialog || current.closing) return;
      current.closing = true;
      for (const button of actions.children) button.disabled = true;
      const close = () => {
        if (disposed || current?.dialog !== dialog) return;
        dialog.close(); dialog.remove(); current = null;
        if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
        respond(item, accepted); showNext();
      };
      if (document.hidden) close(); else exitSurface(dialog, close);
    }
    cancel.addEventListener('click', () => finish(false));
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) finish(false);
    });
    dialog.showModal(); cancel.focus(); enterSurface(dialog);
  }
  document.addEventListener('islandsun-confirm-request', event => {
    if (!Number.isSafeInteger(event.detail?.id) || typeof event.detail.message !== 'string') return;
    const action = ['Save','Delete','Edit','Continue'].includes(event.detail.action) ? event.detail.action : 'Continue';
    const item = { id: event.detail.id, action, message: confirmationText(event.detail.message, action) };
    const combined = action === 'Save' && document.querySelector('form[data-isi-save-submit]');
    if (combined) {
      item.title = 'Save & Submit';
      item.message = combined.dataset.isiSaveSubmit === 'select'
        ? 'Save this TIR, then open the saved request to review it and finish submission to Product Marketing?'
        : 'Save this request and submit the verified saved record to Product Marketing?';
    }
    if (current || queue.length) { respond(item,false); return; }
    queue.push(item); showNext();
  }, { signal: events.signal });
  document.addEventListener('islandsun-portal-notice', event => {
    if (typeof event.detail !== 'string') return;
    const message = translateChrome(event.detail);
    if (current?.item.message === message || queue.some(item => item.message === message)) return;
    if (queue.length >= 4) queue.shift();
    queue.push({ message }); showNext();
  }, { signal: events.signal });
  return { ask({ message, action = 'Continue', title = 'Please review' }) {
    if (disposed || current || queue.length) return Promise.resolve(false);
    return new Promise(resolve => { queue.push({ message, action, title, respond: resolve }); showNext(); });
  }, destroy() {
    disposed = true; events.abort();
    if (current) { respond(current.item,false); current.dialog.close(); current.dialog.remove(); current = null; }
    for (const item of queue.splice(0)) respond(item,false);
  } };
}
