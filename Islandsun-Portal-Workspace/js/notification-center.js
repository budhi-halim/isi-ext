import { icon, iconButton } from './icons.js';
import { enterSurface, exitSurface } from './motion.js';
import { createNoticeMotion } from '../assets/family/js/notice-motion.js';
import { UPDATE_PAGE } from './shared/update-logic.js';
import { notificationTone } from './submission-logic.js';
import { createTrayClearMotion } from './tray-clear-motion.js';
import { submissionRecord } from './submission-logic.js';
import { silenceDescription } from './notification-types.js';

function destination(item) {
  if (item.type === 'update' && item.url === UPDATE_PAGE) return UPDATE_PAGE;
  const [kind,id] = String(item.key || '').split(':');
  return submissionRecord({kind,id,number:item.number || 'Notification',url:item.url})?.url;
}

function orderedNotices(state) {
  return Object.values(state.notices).sort((a, b) => Number(b.type === 'update') - Number(a.type === 'update') || a.created - b.created || a.id.localeCompare(b.id));
}

export function createNotificationCenter(store, notices) {
  const target = document.querySelector('.navbar-custom-menu');
  if (!target) return { destroy() {} };
  const scheduled = new Set(), shown = new Set();
  const listMotion = createNoticeMotion();
  const clearMotion = createTrayClearMotion();
  const departures = new Map();
  function cancelDeparture(row) { clearTimeout(departures.get(row)); departures.delete(row); delete row.dataset.noticeQueued; }
  function clearDepartures() { for (const row of departures.keys()) cancelDeparture(row); }
  let dialog, confirmation, disposed = false, rendered = '', restoreFocus = true;
  const button = iconButton('bell', 'Notifications', open);
  button.dataset.isiOwned = ''; button.classList.add('isi-notification-bell');
  button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-expanded', 'false');
  const badge = document.createElement('span'); badge.className = 'isi-notification-count'; button.append(badge);
  const updateBadge = document.createElement('span'); updateBadge.className = 'isi-notification-count isi-notification-count--update'; button.append(updateBadge);
  badge.setAttribute('aria-hidden', 'true'); updateBadge.setAttribute('aria-hidden', 'true');
  target.insertBefore(button, document.querySelector('#isi-portal-theme'));
  const reportError = () => notices.notify('Notification history could not be saved. Please try again.', { error: true });
  function dismiss(id) { store.dismiss(id).catch(reportError); }
  function closeTray(focusBell = true) { if (dialog) { restoreFocus = focusBell; const current = dialog; exitSurface(current, () => current.close()); } }
  function closeConfirmation() { if (confirmation) { const current = confirmation; exitSurface(current, () => current.close()); } }
  function positionTray() {
    if (!dialog) return;
    const anchor = button.getBoundingClientRect();
    const top = Math.max(8, anchor.bottom + 10);
    dialog.style.top = `${top}px`;
    dialog.style.left = `${Math.max(8, Math.min(anchor.right - dialog.offsetWidth, innerWidth - dialog.offsetWidth - 8))}px`;
    dialog.style.maxHeight = `${Math.max(120, innerHeight - top - 12)}px`;
  }

  function mute(item) {
    if (confirmation) return;
    confirmation = document.createElement('dialog'); confirmation.className = 'isi-portal-products'; confirmation.dataset.isiOwned = '';
    const title = document.createElement('h2'); title.id = 'isi-mute-title'; title.textContent = 'Silence this notification type?';
    const text = document.createElement('p'); text.textContent = silenceDescription(item);
    const actions = document.createElement('div'); actions.className = 'isi-dialog-actions';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'isi-portal-button'; cancel.textContent = 'Cancel'; cancel.addEventListener('click', closeConfirmation);
    const confirm = document.createElement('button'); confirm.type = 'button'; confirm.className = 'isi-portal-button'; confirm.textContent = 'Silence';
    confirm.addEventListener('click', async () => {
      confirm.disabled = true;
      try { await store.dismiss(item.id, true); closeConfirmation(); }
      catch { confirm.disabled = false; reportError(); }
    });
    const close = iconButton('close', 'Close confirmation', closeConfirmation); close.classList.add('isi-portal-dialog-close');
    actions.append(cancel, confirm); confirmation.append(title, text, actions, close);
    confirmation.setAttribute('aria-labelledby', title.id);
    confirmation.addEventListener('cancel', event => { event.preventDefault(); closeConfirmation(); });
    confirmation.addEventListener('close', () => { confirmation.remove(); confirmation = null; }, { once: true });
    document.body.append(confirmation); confirmation.showModal(); enterSurface(confirmation); cancel.focus();
  }

  function resetHistory() {
    if (confirmation) return;
    confirmation = document.createElement('dialog'); confirmation.className = 'isi-portal-products'; confirmation.dataset.isiOwned = '';
    const title = document.createElement('h2'); title.id = 'isi-reset-notices-title'; title.textContent = 'Reset notification history?';
    const text = document.createElement('p'); text.textContent = 'Reset dismissed notifications and silenced reminders for this account, plus extension update reminders on this browser. Eligible reminders will appear again after the next check.';
    const actions = document.createElement('div'); actions.className = 'isi-dialog-actions';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'isi-portal-button'; cancel.textContent = 'Cancel'; cancel.addEventListener('click', closeConfirmation);
    const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'isi-portal-button'; reset.textContent = 'Reset history';
    reset.addEventListener('click', async () => {
      reset.disabled = true; cancel.disabled = true;
      try { await store.reset(); closeConfirmation(); notices.notify('Notification history reset.'); }
      catch { reset.disabled = false; cancel.disabled = false; reportError(); }
    });
    actions.append(cancel, reset); confirmation.append(title, text, actions); confirmation.setAttribute('aria-labelledby', title.id);
    confirmation.addEventListener('cancel', event => { event.preventDefault(); if (!reset.disabled) closeConfirmation(); });
    confirmation.addEventListener('close', () => { confirmation.remove(); confirmation = null; }, {once:true});
    document.body.append(confirmation); confirmation.showModal(); enterSurface(confirmation); cancel.focus();
  }

  function renderDialog(state) {
    if (!dialog) return;
    const items = orderedNotices(state);
    const signature = JSON.stringify(items.map(({id,message,created,muteKey,type}) => ({id,message,created,muteKey,type})));
    if (signature === rendered) return;
    clearMotion.cancel();
    rendered = signature;
    const list = dialog.querySelector('[data-notice-list]');
    list.querySelector('[data-notice-empty]')?.remove();
    const rows = new Map([...list.querySelectorAll('[data-notice-id]')].map(row => [row.dataset.noticeId, row]));
    const ids = new Set(items.map(item => item.id));
    function emptyState() {
      if (!list.isConnected || list.querySelector('[data-notice-id],[data-notice-empty]')) return;
      const empty = document.createElement('p'); empty.dataset.noticeEmpty = ''; empty.textContent = 'No notifications'; list.append(empty);
    }
    if (!items.length && rows.size > 1) {
      clearDepartures(); listMotion.destroy();
      dialog.querySelector('[aria-label="Close notifications"]').focus({preventScroll:true});
      dialog.querySelector('[data-clear-notices]').disabled = true;
      clearMotion.remove(list,[...rows.values()],emptyState);
      return;
    }
    let departureIndex = 0;
    for (const [id, row] of rows) if (!ids.has(id) && !row.dataset.noticeLeaving && !row.dataset.noticeQueued) {
      if (row.contains(document.activeElement)) {
        const next = [...rows].find(([key, node]) => ids.has(key) && !node.dataset.noticeLeaving)?.[1];
        (next?.querySelector('button') || dialog.querySelector('[aria-label="Close notifications"]')).focus({ preventScroll: true });
      }
      const delay = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : Math.min(800, departureIndex++ * 55);
      row.dataset.noticeQueued = 'true'; row.inert = true;
      const depart = () => {
        cancelDeparture(row);
        if (row.isConnected) listMotion.remove(row, emptyState, -1);
      };
      if (delay) departures.set(row, setTimeout(depart, delay));
      else depart();
    }
    for (const item of items) {
      const existing = rows.get(item.id);
      if (existing) {
        if (existing.dataset.noticeLeaving || existing.dataset.noticeQueued) { cancelDeparture(existing); listMotion.cancel(existing); delete existing.dataset.noticeLeaving; existing.inert = false; listMotion.enter(existing); }
        continue;
      }
      const row = document.createElement('article'); row.className = 'isi-notification-entry';
      row.dataset.noticeId = item.id;
      row.dataset.tone = notificationTone(item.type);
      const mark = icon(row.dataset.tone === 'warning' ? 'clock' : 'check'); mark.classList.add('isi-notice-mark');
      const href = destination(item);
      const content = document.createElement(href ? 'a' : 'div'), text = document.createElement('p'), time = document.createElement('time');
      if (href) { content.href = href; content.className = 'isi-notification-link'; }
      if (item.customer) { const customer = document.createElement('strong'); customer.className = 'isi-notification-customer'; customer.textContent = item.customer; content.append(customer); }
      text.textContent = item.message; time.dateTime = new Date(item.created).toISOString(); time.textContent = new Date(item.created).toLocaleString();
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
    dialog.querySelector('[data-clear-notices]').disabled = !items.length;
  }

  function sync(state) {
    if (disposed) return;
    const items = orderedNotices(state);
    const updateCount = items.filter(item => item.type === 'update').length;
    const regularCount = items.length - updateCount;
    badge.textContent = String(regularCount); badge.hidden = !regularCount;
    updateBadge.textContent = String(updateCount); updateBadge.hidden = !updateCount;
    button.setAttribute('aria-label', updateCount ? `Notifications (${regularCount} regular, ${updateCount} ${updateCount === 1 ? 'update' : 'updates'})` : `Notifications (${regularCount})`);
    for (const id of scheduled) if (!state.notices[id] || (state.notices[id].delivered && !shown.has(id))) { notices.dismiss(id); scheduled.delete(id); }
    for (const id of shown) if (!state.notices[id]) shown.delete(id);
    renderDialog(state);
    if (document.hidden || !document.hasFocus()) return;
    for (const item of items) {
      if (item.delivered || scheduled.has(item.id)) continue;
      scheduled.add(item.id);
      const accepted = notices.notify(item.message, {
        href:destination(item), customer:item.customer,
        key: item.id, tone: notificationTone(item.type), onDismiss: () => dismiss(item.id), onMute: item.muteKey ? () => mute(item) : undefined,
        beforeShow: () => store.claim(item.id), isCurrent: () => Boolean(store.read().notices[item.id]),
        onSkip: () => { scheduled.delete(item.id); store.release(item.id).catch(reportError); },
        onShow: () => { shown.add(item.id); store.delivered(item.id).catch(reportError); },
      });
      if (accepted === false) scheduled.delete(item.id);
    }
  }

  function open() {
    if (dialog) { closeTray(); return; }
    let state;
    try { state = store.read(); } catch { reportError(); return; }
    rendered = '';
    dialog = document.createElement('dialog'); dialog.className = 'isi-portal-products isi-notification-center'; dialog.dataset.isiOwned = '';
    const heading = document.createElement('h2'); heading.textContent = 'Notifications'; heading.id = 'isi-notification-title';
    const clear = document.createElement('button'); clear.type = 'button'; clear.className = 'isi-portal-button'; clear.textContent = 'Clear all'; clear.dataset.clearNotices = '';
    clear.addEventListener('click', () => store.clear().catch(reportError));
    const list = document.createElement('div'); list.dataset.noticeList = '';
    const close = iconButton('close', 'Close notifications', () => closeTray());
    const header = document.createElement('header'); header.className = 'isi-notification-header'; header.append(heading, clear, close);
    dialog.append(header, list); dialog.setAttribute('aria-labelledby', heading.id);
    if (store.reset) {
      const footer = document.createElement('footer'); footer.className = 'isi-dialog-actions';
      const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'isi-portal-button'; reset.textContent = 'Reset notification history'; reset.addEventListener('click', resetHistory);
      footer.append(reset); dialog.append(footer);
    }
    restoreFocus = true;
    dialog.addEventListener('close', () => { clearDepartures(); clearMotion.cancel(); listMotion.destroy(); dialog.remove(); dialog = null; button.setAttribute('aria-expanded', 'false'); if (restoreFocus && !disposed && button.isConnected) button.focus(); }, { once: true });
    document.body.append(dialog); renderDialog(state); dialog.show(); positionTray(); enterSurface(dialog); button.setAttribute('aria-expanded', 'true'); close.focus();
  }
  const outside = event => { if (dialog && !confirmation && !dialog.contains(event.target) && !button.contains(event.target)) closeTray(false); };
  const escape = event => { if (event.key === 'Escape' && dialog && !confirmation) { event.preventDefault(); closeTray(); } };
  document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
  window.addEventListener('resize', positionTray); document.addEventListener('scroll', positionTray, true);
  const unsubscribe = store.subscribe(sync), focus = () => { try { sync(store.read()); } catch { reportError(); } };
  const retryClaims = setInterval(focus, 5000);
  window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus); focus();
  return { destroy() { disposed = true; clearInterval(retryClaims); unsubscribe(); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); window.removeEventListener('resize', positionTray); document.removeEventListener('scroll', positionTray, true); confirmation?.close(); dialog?.close(); button.remove(); } };
}
