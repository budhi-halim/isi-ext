import { diagnosticLog } from './diagnostic-log.js';

export const NOTIFICATION_ACTION_ATTEMPTS = 3;
const RETRY_DELAYS = [1000, 2000];
const FAILURE_MESSAGES = {
  dismiss: 'Couldn’t dismiss this notification. Please try again later.',
  silence: 'Couldn’t silence this notification type. Please try again later.',
  'silence-all': 'Couldn’t silence these notifications. Please try again later.',
  clear: 'Couldn’t clear all notifications. Please try again later.',
  reset: 'Couldn’t reset notification history. Please try again later.',
};

/** Retry only local notification actions, with one owner and cancellable waits. */
export function createNotificationActions({ onBusy = () => {}, onError = () => {} } = {}) {
  let active, disposed = false, timer, releaseWait;
  const wait = milliseconds => new Promise(resolve => {
    releaseWait = resolve;
    timer = setTimeout(() => { releaseWait = null; resolve(); }, milliseconds);
  });
  return {
    get busy() { return Boolean(active); },
    run(action, operation, { key = action, attempts = NOTIFICATION_ACTION_ATTEMPTS } = {}) {
      if (disposed) return Promise.resolve(false);
      if (active) return active.key === key ? active.promise : Promise.resolve(false);
      const task = { key };
      active = task; onBusy(true);
      task.promise = (async () => {
        for (let attempt = 1; attempt <= attempts && !disposed; attempt++) {
          try {
            await operation();
            if (disposed) return false;
            diagnosticLog('notification-action-completed', { action, attempt });
            return true;
          } catch (error) {
            if (disposed) return false;
            diagnosticLog('notification-action-failed', { action, attempt, retry:attempt < attempts, errorType:error.name, message:String(error.message).slice(0,500) });
            if (attempt === attempts) { onError(FAILURE_MESSAGES[action], action); return false; }
            await wait(RETRY_DELAYS[attempt - 1]);
          }
        }
        return false;
      })().finally(() => { if (active === task) active = null; if (!disposed) onBusy(false); });
      return task.promise;
    },
    destroy() { disposed = true; clearTimeout(timer); releaseWait?.(); releaseWait = null; },
  };
}
