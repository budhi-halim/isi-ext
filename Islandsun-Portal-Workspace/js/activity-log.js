import { diagnosticLog } from './diagnostic-log.js';

const PAUSE_REASONS = Object.freeze({
  navigation: 'a portal page is loading',
  editor: 'a request editor is open; its product cart is protected',
  offline: 'the portal is unreachable; only connection recovery checks continue',
  recovery: 'the portal needs recovery time after a failed or interrupted request',
  table: 'a visible table or foreground request has priority',
  action: 'a save or submission is in progress',
  interaction: 'a search field or request selector is active; background work resumes after one minute idle',
  settling: 'waiting for portal navigation to settle',
  reading: 'another portal request is still running',
  queued: 'higher-priority portal requests are queued',
  startup: 'browser activity checks are starting',
  'other-tab': 'another portal tab owns notification checks, including in the background',
  'signed-out': 'sign-in is required',
  'unlock-required': 'automatic saving is preparing after the extension update; opening the offline copy is not required',
  disabled: 'saving is disabled in settings',
  retry: 'a check failed; it will retry automatically',
  'notification-storage': 'local reminder history could not be saved; retrying storage before fetching more records',
  idle: 'watched details are cached or not yet due for another check',
});

export function activityTime(value = Date.now()) {
  const date = new Date(value);
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map(part => String(part).padStart(2, '0')).join(':');
}

/** Deduplicate console messages and retain the same meaningful lifecycle changes. */
export function createActivityLog(scope, { now = Date.now, write = text => console.info(text) } = {}) {
  const notes = new Map();
  let paused, closed = false;
  const emit = text => { if (!closed) { write(`${activityTime(now())} [Workspace · ${scope}] ${text}`); diagnosticLog('activity',{scope,message:text}); } };
  return {
    note(key, text, repeatAfter = 60000) {
      if (closed || notes.has(key) && now() - notes.get(key) < repeatAfter) return;
      notes.delete(key); notes.set(key, now());
      while (notes.size > 40) notes.delete(notes.keys().next().value);
      emit(text);
    },
    pause(reason, until) {
      if (closed || !Object.hasOwn(PAUSE_REASONS, reason)) return;
      if (paused?.reason === reason && (paused.until === until || now() - paused.at < 30000)) return;
      const since = paused?.since ?? now();
      paused = { reason, until, at: now(), since };
      emit(`Paused: ${PAUSE_REASONS[reason]}.${Number.isFinite(until) && until > now() ? ` Retry no earlier than ${activityTime(until)}.` : ''}`);
    },
    resume() {
      if (!paused || closed) return;
      emit(`Resumed after ${Math.round((now() - paused.since) / 1000)}s.`);
      paused = null;
    },
    destroy() { closed = true; paused = null; notes.clear(); },
  };
}
