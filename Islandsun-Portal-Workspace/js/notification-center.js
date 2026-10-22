import { icon, iconButton } from './icons.js';
import { enterSurface, exitSurface } from './motion.js';
import { createNoticeMotion } from '../assets/family/js/notice-motion.js';
import { UPDATE_PAGE } from './shared/update-logic.js';
import { notificationTone } from './submission-logic.js';
import { createTrayClearMotion } from './tray-clear-motion.js';
import { submissionRecord } from './submission-logic.js';
import { silenceDescription } from './notification-types.js';
import { createNotificationActions } from './notification-actions.js';
import { diagnosticLog } from './diagnostic-log.js';
import { notificationText } from './notification-text.js';

function destination(item) {
  if (item.type === 'update' && item.url === UPDATE_PAGE) return UPDATE_PAGE;
  if (item.type === 'system' && item.url) {
    try { const url = new URL(item.url); if (url.origin === location.origin && ['http:','https:'].includes(url.protocol)) return url.href; }
    catch { /* A stored message with no valid local destination stays plain text. */ }
  }
  const [kind,id] = String(item.key || '').split(':');
  return submissionRecord({kind,id,number:item.number || 'Notification',url:item.url})?.url;
}

function orderedNotices(state) {
  return Object.values(state.notices).sort((a, b) => Number(b.type === 'update') - Number(a.type === 'update') || b.created - a.created || b.id.localeCompare(a.id));
}

export function createNotificationCenter(store, notices) {
  const target = document.querySelector('.navbar-custom-menu');
  if (!target) return { destroy() {} };
  const scheduled = new Set(), shown = new Set(), suppressed = new Set();
  const listMotion = createNoticeMotion();
  const clearMotion = createTrayClearMotion();
  let dialog, confirmation, pendingState, popupOverride, bypassing = false, disposed = false, rendered = '', restoreFocus = true;
  const button = iconButton('bell', 'Notifications', open);
  button.dataset.isiOwned = ''; button.classList.add('isi-notification-bell');
  button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-expanded', 'false');
  const badge = document.createElement('span'); badge.className = 'isi-notification-count'; button.append(badge);
  const updateBadge = document.createElement('span'); updateBadge.className = 'isi-notification-count isi-notification-count--update'; button.append(updateBadge);
  badge.setAttribute('aria-hidden', 'true'); updateBadge.setAttribute('aria-hidden', 'true');
  target.insertBefore(button, document.querySelector('#isi-portal-theme'));
  let lastError = '', lastErrorAt = 0;
  const reportError = error => {
    const message = String(error?.message || 'Notification history unavailable').slice(0,500);
    if (message === lastError && Date.now() - lastErrorAt < 60000) return;
    lastError = message; lastErrorAt = Date.now();
    diagnosticLog('notification-display-failed', {errorType:error?.name,message});
  };
  const mutations = createNotificationActions({
    onBusy: busy => {
      if (!busy) { try { sync(store.read()); } catch (error) { reportError(error); } }
      renderBusy();
    },
    onError: (message, action) => {
      if (action === 'popups' && dialog) {
        const error = dialog.querySelector('[data-popup-error]');
        error.hidden = false; error.textContent = message;
      } else notices.notify(message, {key:`notification-action-${action}`,error:true});
    },
  });
  function renderBusy() {
    const busy = mutations.busy;
    for (const control of document.querySelectorAll('.isi-notification-entry button,.isi-portal-toast .isi-toast-button')) control.disabled = busy;
    if (dialog) {
      dialog.querySelector('[data-toast-popups]').disabled = busy;
      dialog.querySelector('[data-clear-notices]').disabled = busy || !dialog.querySelector('[data-notice-id]:not([data-notice-leaving]):not([data-notice-queued])');
      dialog.querySelector('[data-silence-notices]').disabled = busy || !dialog.querySelector('[data-notice-id]:not([data-notice-leaving]):not([data-notice-queued]) [aria-label="Silence this notification type"]');
    }
    for (const control of confirmation?.querySelectorAll('button') || []) control.disabled = busy;
  }
  function renderPopupSetting(enabled) {
    const control = dialog?.querySelector('[data-toast-popups]');
    if (!control || control.getAttribute('aria-checked') === String(enabled)) return;
    control.setAttribute('aria-checked', String(enabled));
    const text = document.createElement('span'); text.textContent = enabled ? 'Popups on' : 'Popups off';
    control.replaceChildren(icon(enabled ? 'bell' : 'mute'), text);
  }
  function flushSuppressed() {
    if (disposed || bypassing || !store.bypassPopups) return;
    let state;
    try { state = store.read(); } catch (error) { reportError(error); return; }
    const ids = [...suppressed].filter(id => state.notices[id] && !state.notices[id].delivered);
    if (!ids.length) return;
    bypassing = true;
    void store.bypassPopups(ids).catch(reportError).finally(() => { bypassing = false; });
  }
  function retainBypassedPopup(request) {
    if (disposed) return;
    if (request.beforeShow) {
      suppressed.add(request.key); queueMicrotask(flushSuppressed);
    } else if (store.retainPopup) return store.retainPopup(request).catch(reportError);
  }
  async function togglePopups() {
    if (mutations.busy) return;
    let enabled;
    try { enabled = store.read().toastPopups === false; } catch (error) { reportError(error); return; }
    dialog.querySelector('[data-popup-error]').hidden = true;
    popupOverride = enabled;
    notices.setEnabled?.(enabled, retainBypassedPopup);
    renderPopupSetting(enabled);
    await mutations.run('popups', () => store.setToastPopups(enabled));
    popupOverride = undefined;
    try { sync(store.read()); } catch (error) { reportError(error); }
  }
  function dismiss(id) { return mutations.run('dismiss', () => store.dismiss(id), {key:`dismiss:${id}`}); }
  function closeTray(focusBell = true) { if (dialog) { restoreFocus = focusBell; const current = dialog; exitSurface(current, () => current.close()); } }
  function closeConfirmation() { if (confirmation && !mutations.busy) { const current = confirmation; exitSurface(current, () => current.close()); } }
  function positionTray() {
    if (!dialog) return;
    const anchor = button.getBoundingClientRect();
    const top = Math.max(8, anchor.bottom + 10);
    dialog.style.top = `${top}px`;
    dialog.style.left = `${Math.max(8, Math.min(anchor.right - dialog.offsetWidth, innerWidth - dialog.offsetWidth - 8))}px`;
    dialog.style.maxHeight = `${Math.max(120, innerHeight - top - 12)}px`;
  }

  function mute(item) {
    confirmSilence([item]);
  }

  function confirmSilence(items, all = false) {
    if (confirmation || mutations.busy) return;
    if (!items.length) return;
    confirmation = document.createElement('dialog'); confirmation.className = 'isi-portal-products'; confirmation.dataset.isiOwned = '';
    const title = document.createElement('h2'); title.id = 'isi-mute-title'; title.textContent = all ? 'Silence all eligible notifications?' : 'Silence this notification type?';
    const text = document.createElement('p'); text.textContent = all
      ? `Silence and remove ${items.length} ${items.length === 1 ? 'notification' : 'notifications'} from this tray? Future notifications of these types for these requests will be silenced. Other types and notifications that cannot be silenced will remain unchanged.`
      : silenceDescription(items[0]);
    const actions = document.createElement('div'); actions.className = 'isi-dialog-actions';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'isi-portal-button'; cancel.textContent = 'Cancel'; cancel.addEventListener('click', closeConfirmation);
    const confirm = document.createElement('button'); confirm.type = 'button'; confirm.className = 'isi-portal-button'; confirm.textContent = all ? 'Silence all' : 'Silence';
    confirm.addEventListener('click', async () => {
      const action = all ? 'silence-all' : 'silence';
      if (await mutations.run(action, () => all ? store.silence(items.map(item => item.id)) : store.dismiss(items[0].id, true), {key:`${action}:${items.map(item => item.id).join(',')}`})) closeConfirmation();
    });
    const close = iconButton('close', 'Close confirmation', closeConfirmation); close.classList.add('isi-portal-dialog-close');
    actions.append(cancel, confirm); confirmation.append(title, text, actions, close);
    confirmation.setAttribute('aria-labelledby', title.id);
    confirmation.addEventListener('cancel', event => { event.preventDefault(); closeConfirmation(); });
    confirmation.addEventListener('close', () => { confirmation.remove(); confirmation = null; }, { once: true });
    document.body.append(confirmation); confirmation.showModal(); enterSurface(confirmation); cancel.focus();
  }

  function renderDialog(state) {
    if (!dialog) return;
    if (clearMotion.busy) { pendingState = state; return; }
    const items = orderedNotices(state);
    const signature = JSON.stringify(items.map(({id,message,created,muteKey,type}) => ({id,message,created,muteKey,type})));
    if (signature === rendered) return;
    rendered = signature;
    const list = dialog.querySelector('[data-notice-list]');
    list.querySelector('[data-notice-empty]')?.remove();
    const rows = new Map([...list.querySelectorAll('[data-notice-id]')].map(row => [row.dataset.noticeId, row]));
    const ids = new Set(items.map(item => item.id));
    function emptyState() {
      if (!list.isConnected || list.querySelector('[data-notice-id],[data-notice-empty]')) return;
      const empty = document.createElement('p'); empty.dataset.noticeEmpty = ''; empty.textContent = 'No notifications'; list.append(empty);
    }
    const departing = [...rows].filter(([id]) => !ids.has(id)).map(([, row]) => row);
    if (departing.length) {
      if (departing.some(row => row.contains(document.activeElement)) || !items.length) {
        dialog.querySelector('[aria-label="Close notifications"]').focus({preventScroll:true});
      }
      listMotion.destroy();
      pendingState = state;
      void clearMotion.remove(list, departing, () => {
        const latest = pendingState;
        pendingState = null;
        rendered = '';
        if (latest) renderDialog(latest);
      }, () => {
        if (!Object.keys(pendingState?.notices || {}).length) emptyState();
      });
      renderBusy();
      return;
    }
    for (const item of items) {
      const existing = rows.get(item.id);
      if (existing) continue;
      const row = document.createElement('article'); row.className = 'isi-notification-entry';
      row.dataset.noticeId = item.id;
      row.dataset.tone = item.type === 'system' && ['success','warning','error'].includes(item.tone) ? item.tone : notificationTone(item.type);
      const mark = icon(row.dataset.tone === 'warning' ? 'clock' : row.dataset.tone === 'error' ? 'error' : 'check'); mark.classList.add('isi-notice-mark');
      const href = destination(item);
      const content = document.createElement(href ? 'a' : 'div'), text = document.createElement('p'), time = document.createElement('time');
      if (href) {
        content.href = href; content.className = 'isi-notification-link';
        if (item.type === 'update') { content.target = '_blank'; content.rel = 'noopener'; }
      }
      if (item.customer) { const customer = document.createElement('strong'); customer.className = 'isi-notification-customer'; customer.textContent = item.customer; content.append(customer); }
      text.textContent = notificationText(item); time.dateTime = new Date(item.created).toISOString(); time.textContent = new Date(item.created).toLocaleString();
      content.append(text, time);
      const actions = document.createElement('div'); actions.className = 'isi-notice-actions';
      if (item.muteKey) actions.append(iconButton('mute', 'Silence this notification type', () => mute(item)));
      actions.append(iconButton('close', 'Dismiss notification', () => dismiss(item.id))); row.append(mark, content, actions); list.append(row);
      rows.set(item.id, row);
      if (dialog.open) listMotion.enter(row);
    }
    let next = list.firstElementChild;
    for (const item of items) {
      const row = rows.get(item.id);
      if (row !== next) {
        const focused = row.contains(document.activeElement) ? document.activeElement : null;
        if (list.moveBefore) list.moveBefore(row, next);
        else { list.insertBefore(row, next); focused?.focus({preventScroll:true}); }
      }
      next = row.nextElementSibling;
    }
    emptyState();
    renderBusy();
  }

  function sync(state) {
    if (disposed) return;
    const items = orderedNotices(state);
    const popupsEnabled = popupOverride ?? (state.toastPopups !== false);
    notices.setEnabled?.(popupsEnabled, retainBypassedPopup);
    renderPopupSetting(popupsEnabled);
    for (const id of suppressed) if (!state.notices[id] || state.notices[id].delivered) suppressed.delete(id);
    if (!popupsEnabled) for (const item of items) if (!item.delivered) suppressed.add(item.id);
    flushSuppressed();
    const updateCount = items.filter(item => item.type === 'update').length;
    const regularCount = items.length - updateCount;
    badge.textContent = String(regularCount); badge.hidden = !regularCount;
    updateBadge.textContent = String(updateCount); updateBadge.hidden = !updateCount;
    button.setAttribute('aria-label', updateCount ? `Notifications (${regularCount} regular, ${updateCount} ${updateCount === 1 ? 'update' : 'updates'})` : `Notifications (${regularCount})`);
    for (const id of scheduled) if (!state.notices[id] || (state.notices[id].delivered && !shown.has(id))) { notices.dismiss(id); scheduled.delete(id); }
    for (const id of shown) if (!state.notices[id]) shown.delete(id);
    renderDialog(state);
    if (!popupsEnabled || document.hidden || !document.hasFocus()) return;
    for (const item of items) {
      if (item.delivered || scheduled.has(item.id) || suppressed.has(item.id)) continue;
      scheduled.add(item.id);
      const accepted = notices.notify(notificationText(item, {compact:true}), {
        href:destination(item), newTab:item.type === 'update', customer:item.customer,
        key: item.id, tone: notificationTone(item.type), onDismiss: () => dismiss(item.id), onMute: item.muteKey ? () => mute(item) : undefined,
        beforeShow: () => store.claim(item.id), isCurrent: () => Boolean(store.read().notices[item.id]),
        onSkip: () => { scheduled.delete(item.id); return store.release(item.id).catch(reportError); },
        onShow: () => { shown.add(item.id); renderBusy(); store.delivered(item.id).catch(reportError); },
      });
      if (accepted === false) scheduled.delete(item.id);
    }
  }

  function open() {
    if (dialog) { closeTray(); return; }
    let state;
    try { state = store.read(); } catch (error) {
      reportError(error);
      notices.notify('Couldn’t open notifications. Please try again later.', {key:'notification-open-error',error:true});
      return;
    }
    rendered = '';
    dialog = document.createElement('dialog'); dialog.className = 'isi-portal-products isi-notification-center'; dialog.dataset.isiOwned = '';
    const heading = document.createElement('h2'); heading.textContent = 'Notifications'; heading.id = 'isi-notification-title';
    const clear = document.createElement('button'); clear.type = 'button'; clear.className = 'isi-portal-button'; clear.textContent = 'Clear all'; clear.dataset.clearNotices = '';
    const silence = document.createElement('button'); silence.type = 'button'; silence.className = 'isi-portal-button'; silence.textContent = 'Silence all'; silence.dataset.silenceNotices = '';
    silence.addEventListener('click', () => {
      try { confirmSilence(orderedNotices(store.read()).filter(item => item.muteKey && item.type !== 'update'), true); }
      catch (error) { reportError(error); notices.notify('Couldn’t open notifications. Please try again later.', {key:'notification-open-error',error:true}); }
    });
    clear.addEventListener('click', () => {
      let ids;
      void mutations.run('clear', () => {
        ids ||= Object.keys(store.read().notices);
        return store.clear(ids);
      });
    });
    const list = document.createElement('div'); list.dataset.noticeList = '';
    const close = iconButton('close', 'Close notifications', () => closeTray());
    const popups = document.createElement('button'); popups.type = 'button'; popups.className = 'isi-portal-button'; popups.dataset.toastPopups = '';
    popups.setAttribute('role', 'switch'); popups.setAttribute('aria-label', 'Toast popups'); popups.addEventListener('click', togglePopups);
    const controls = document.createElement('div'); controls.className = 'isi-notification-controls'; controls.append(popups, silence, clear);
    const error = document.createElement('p'); error.dataset.popupError = ''; error.hidden = true; error.setAttribute('role', 'alert');
    const header = document.createElement('header'); header.className = 'isi-notification-header'; header.append(heading, close, controls, error);
    dialog.append(header, list); dialog.setAttribute('aria-labelledby', heading.id);
    renderPopupSetting(popupOverride ?? (state.toastPopups !== false));
    restoreFocus = true;
    dialog.addEventListener('close', () => { pendingState = null; clearMotion.cancel(); listMotion.destroy(); dialog.remove(); dialog = null; button.setAttribute('aria-expanded', 'false'); if (restoreFocus && !disposed && button.isConnected) button.focus(); }, { once: true });
    document.body.append(dialog); renderDialog(state); dialog.show(); positionTray(); enterSurface(dialog); button.setAttribute('aria-expanded', 'true'); close.focus();
  }
  const outside = event => { if (dialog && !confirmation && !dialog.contains(event.target) && !button.contains(event.target)) closeTray(false); };
  const escape = event => { if (event.key === 'Escape' && dialog && !confirmation) { event.preventDefault(); closeTray(); } };
  document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
  window.addEventListener('resize', positionTray); document.addEventListener('scroll', positionTray, true);
  const unsubscribe = store.subscribe(sync), focus = () => { try { sync(store.read()); } catch (error) { reportError(error); } };
  const retryClaims = setInterval(focus, 5000);
  window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus); focus();
  return { destroy() { disposed = true; mutations.destroy(); clearInterval(retryClaims); unsubscribe(); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); window.removeEventListener('resize', positionTray); document.removeEventListener('scroll', positionTray, true); confirmation?.close(); dialog?.close(); button.remove(); } };
}
