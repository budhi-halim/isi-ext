import { validateSettings, isCompanyWorkspace, ACTIVE_STATES } from './logic.js';
import { runAutomation } from './automation.js';
import { createOverlay } from './overlay.js';

export function install() {
  if (window !== window.top || !isCompanyWorkspace(location.href)) return;
  let job = null;
  let controller = null;
  let overlay = null;
  let updates = Promise.resolve();

  function publish(patch) {
    job = { ...job, ...patch };
    overlay?.render(job);
    const snapshot = { ...job };
    // Preserve update ordering even if the worker is waking from suspension.
    // The tab remains authoritative if the worker is temporarily unavailable; STATUS reconciles it.
    updates = updates.then(() => chrome.runtime.sendMessage({ action: 'FEEDBACK_UPDATE', job: snapshot })).catch(() => {});
  }

  async function execute(settings, id, signal) {
    try {
      publish({ state: 'running', message: 'Finding pending sample requests…' });
      const result = await runAutomation({ settings, frame: overlay.frame, signal, report: patch => { if (job.id === id && !signal.aborted) publish(patch); } });
      signal.throwIfAborted();
      if (job.id === id) publish({ ...result, state: 'completed' });
    } catch (error) {
      if (job.id === id) publish({ state: signal.aborted ? 'cancelled' : 'failed', message: signal.aborted ? 'Stopped. No further feedback will be submitted.' : error.message });
    } finally {
      if (job.id === id) controller = null;
      await updates.catch(() => {});
    }
  }

  const listener = (message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (message.action === 'FEEDBACK_PING') { respond({ ready: true }); return false; }
    if (message.action === 'FEEDBACK_STATUS') { respond({ job }); return false; }
    if (message.action === 'FEEDBACK_CANCEL' && job?.id === message.id) {
      if (controller) { publish({ state: 'cancelling', message: 'Stopping…' }); controller.abort(); }
      respond({ ok: true });
      return false;
    }
    if (message.action !== 'FEEDBACK_START') return false;
    if (job && ACTIVE_STATES.has(job.state)) { respond({ ok: job.id === message.id, id: job.id, message: 'Feedback is already running in this tab.' }); return false; }
    let settings;
    try { settings = validateSettings(message.settings); } catch (error) { respond({ ok: false, message: error.message }); return false; }
    if (typeof message.id !== 'string' || !message.id) { respond({ ok: false }); return false; }
    overlay?.destroy();
    controller = new AbortController();
    job = { id: message.id, state: 'starting', completed: 0, total: 0, message: 'Preparing feedback…' };
    overlay = createOverlay({ cancel: () => { publish({ state: 'cancelling', message: 'Stopping…' }); controller?.abort(); }, closed: () => { overlay = null; } });
    respond({ ok: true, id: job.id });
    void execute(settings, job.id, controller.signal);
    return false;
  };
  chrome.runtime.onMessage.addListener(listener);
  window.addEventListener('pagehide', () => {
    controller?.abort();
    overlay?.destroy();
  });
}
