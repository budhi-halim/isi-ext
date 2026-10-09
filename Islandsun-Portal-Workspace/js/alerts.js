(() => {
  if (location.origin !== 'http://apps.islandsunindonesia.com:81') return;
  const nativeAlert = window.alert.bind(window);
  const nativeConfirm = window.confirm.bind(window);
  let pendingSave = null, allowance = null, sequence = 0;
  const enabled = () => document.documentElement?.dataset.isiPortal === 'enabled';
  function confirmationFor(button, eventType = 'click') {
    if (eventType === 'click' && button.id === 'btn-updated'
      && /\/samplerequest\/edit\/?$/i.test(location.pathname)) {
      const handlers = window.jQuery?._data?.(button, 'events')?.click || [];
      for (const {handler} of handlers) {
        const source = Function.prototype.toString.call(handler);
        const message = source.match(/^[^{]*\{\s*(?:var|let|const)\s+\w+\s*=\s*confirm\(\s*(['"])([^'"\\]*)\1\s*\)\s*;/)?.[2];
        if (message && /^Pastikan hanya ada 1 tab/i.test(message)) return {callback: handler, code: '', action: 'Edit', message};
      }
    }
    const code = button.getAttribute(eventType === 'submit' ? 'onsubmit' : 'onclick')?.trim() || '';
    const direct = code.match(/^return\s+confirm\(\s*(['"])([^'"\\]*)\1\s*\);?$/);
    const label = eventType === 'submit' ? 'Save' : button.textContent.trim() || button.value || '';
    const action = /save|simpan/i.test(label) ? 'Save' : /delete|hapus/i.test(label) ? 'Delete' : /edit|ubah/i.test(label) ? 'Edit' : 'Continue';
    if (direct) return { callback: code, code, message: direct[2], action };
    const handler = code.match(/^(?:return\s+)?([a-zA-Z_$][\w$]*)\(\s*(?:(?:\d+|true|false|null|'[^'\\]*'|"[^"\\]*")\s*,?\s*)*\);?$/)?.[1];
    if (!handler || typeof window[handler] !== 'function') return null;
    const source = Function.prototype.toString.call(window[handler]);
    // Only handlers whose first operation is the confirmation can be safely deferred.
    const message = source.match(/^[^{]*\{\s*(?:var|let|const)\s+\w+\s*=\s*confirm\(\s*(['"])([^'"\\]*)\1\s*\)\s*;/)?.[2];
    return message ? { handler, callback: window[handler], code, message, action } : null;
  }
  function intercept(event) {
    if (!enabled() || allowance) return;
    const button = event.type === 'submit' ? event.target : event.target instanceof Element ? event.target.closest('button[onclick],input[onclick],a[onclick],#btn-updated') : null;
    if (!button || button.disabled) return;
    const confirmation = confirmationFor(button, event.type);
    if (!confirmation || document.documentElement.dataset.isiBoot !== 'ready') return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (pendingSave) return;
    if (confirmation.action === 'Save' && !button.dispatchEvent(new CustomEvent('islandsun-before-save', {bubbles: true, cancelable: true}))) return;
    pendingSave = { ...confirmation, button, eventType: event.type, submitter: event.submitter, id: ++sequence };
    document.dispatchEvent(new CustomEvent('islandsun-confirm-request', { detail: { id: pendingSave.id, message: confirmation.message, action: confirmation.action } }));
  }
  document.addEventListener('click', intercept, true);
  document.addEventListener('submit', intercept, true);
  document.addEventListener('islandsun-confirm-response', event => {
    const pending = pendingSave;
    if (!pending || event.detail?.id !== pending.id) return;
    pendingSave = null;
    if (event.detail.accepted !== true || !enabled() || !pending.button.isConnected || pending.button.disabled) return;
    const current = confirmationFor(pending.button, pending.eventType);
    if (current?.callback !== pending.callback || current.code !== pending.code || current.message !== pending.message) return;
    allowance = { message: pending.message, used: false };
    const confirmedLink = event => {
      if (pending.button.matches('a[href]') && pending.button.contains(event.target) && !event.defaultPrevented) {
        pending.button.dispatchEvent(new CustomEvent('islandsun-confirmed-link', {bubbles:true}));
      }
    };
    window.addEventListener('click', confirmedLink);
    try {
      if (pending.eventType === 'submit') {
        if (!pending.submitter || (pending.submitter.form === pending.button && !pending.submitter.disabled)) pending.button.requestSubmit(pending.submitter || undefined);
      } else pending.button.click();
    } finally { window.removeEventListener('click', confirmedLink); allowance = null; }
  });
  const clearPending = () => { pendingSave = null; allowance = null; };
  window.addEventListener('pagehide', clearPending);
  new MutationObserver(() => { if (!enabled()) clearPending(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-isi-portal'] });
  const confirmMessages = new Map([
    ['apakah anda yakin ?', 'Are you sure?'],
    ['pastikan hanya ada 1 tab yang aktif pada saat melakukan edit !! apakah anda yakin ingin melakukan edit ?', 'Keep only one editing tab open. Do you want to edit this request?'],
  ]);
  window.confirm = message => {
    const text = String(message ?? '');
    if (allowance && !allowance.used && allowance.message === text && enabled()) { allowance.used = true; return true; }
    const key = text.trim().replace(/\s+/g, ' ').replace(/\s*\?$/, ' ?').toLowerCase();
    const translated = document.documentElement?.dataset.isiPortal === 'enabled' ? confirmMessages.get(key) || text : text;
    return nativeConfirm(translated);
  };
  const pending = [];
  const dispatch = message => document.dispatchEvent(new CustomEvent('islandsun-portal-notice', { detail: message }));
  window.alert = message => {
    if (document.documentElement?.dataset.isiPortal !== 'enabled') return nativeAlert(message);
    const text = String(message ?? '');
    if (document.documentElement.dataset.isiBoot !== 'ready') { if (!pending.includes(text)) { if (pending.length >= 4) pending.shift(); pending.push(text); } return; }
    dispatch(text);
  };
  document.addEventListener('islandsun-portal-ready', () => { for (const message of pending.splice(0)) dispatch(message); });
  // Uninspected synchronous decisions retain the browser's confirmation semantics.
})();
