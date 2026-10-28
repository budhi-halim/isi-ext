import { DEFAULT_PORTAL_ORIGIN, portalOrigin, selectPortalTab } from './shared/portal-address.js';
import { checkSession } from './shared/portal-session.js';
import { ACTIVE_STATES, isCompanyWorkspace, validateSettings } from './logic.js';

class FeedbackError extends Error {
  constructor(message) { super(message); this.name = 'FeedbackError'; }
}

export function createCoordinator(api, { authenticate = checkSession, wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)), readyTimeout = 30000 } = {}) {
  let startPromise = null;
  let writes = Promise.resolve();
  const getJob = async () => (await api.storage.session.get('feedbackJob')).feedbackJob || null;
  const save = (job, { replace = false } = {}) => {
    const operation = writes.then(async () => {
      const current = await getJob();
      if (current && current.id !== job.id && !replace) return current;
      if (current?.id === job.id && (!ACTIVE_STATES.has(current.state) || current.completed > job.completed)) return current;
      await api.storage.session.set({ feedbackJob: job });
      return job;
    });
    writes = operation.catch(() => {});
    return operation;
  };

  async function reconcile() {
    const job = await getJob();
    if (!job || !ACTIVE_STATES.has(job.state) || startPromise) return job;
    try {
      const current = await api.tabs.sendMessage(job.tabId, { action: 'FEEDBACK_STATUS' });
      if (current?.job?.id === job.id) return save({ ...job, ...current.job, tabId: job.tabId });
    } catch { /* A navigated or closed tab no longer owns the run. */ }
    return save({ ...job, state: 'interrupted', message: 'The company page was closed or reloaded. Check saved feedback before starting again.' });
  }

  async function waitForContent(tabId, origin) {
    const started = Date.now();
    let injected = false;
    while (Date.now() - started < readyTimeout) {
      const tab = await api.tabs.get(tabId);
      if (tab.status === 'complete') {
        if (!isCompanyWorkspace(tab.url) || portalOrigin(tab.url) !== origin) throw new FeedbackError('The company page did not open correctly. Sign in and try again.');
        try {
          const reply = await api.tabs.sendMessage(tabId, { action: 'FEEDBACK_PING' });
          if (reply?.ready) return;
        } catch { /* Older open tabs may not yet contain this extension's script. */ }
        if (!injected) {
          injected = true;
          await api.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
        }
      }
      await wait(200);
    }
    throw new FeedbackError('The company page took too long to become ready. Retry when it finishes loading.');
  }

  async function launch(settings, requestedOrigin) {
    const previous = await reconcile();
    if (previous && ACTIVE_STATES.has(previous.state)) return { ok: true, job: previous };
    const selected = await selectPortalTab(api.tabs);
    const origin = portalOrigin(selected?.url) || DEFAULT_PORTAL_ORIGIN;
    if (requestedOrigin && requestedOrigin !== origin) throw new FeedbackError('The company page changed. Check your connection again.');
    await authenticate(undefined, origin);
    await api.storage.local.set(settings);
    const existing = selected && isCompanyWorkspace(selected.url) ? selected : null;
    if (!existing && origin !== DEFAULT_PORTAL_ORIGIN) throw new FeedbackError('Sign in to the company page and try again.');
    const tab = existing || await api.tabs.create({ url: `${DEFAULT_PORTAL_ORIGIN}/islandsun/`, active: false });
    const job = { id: crypto.randomUUID(), tabId: tab.id, origin, state: 'starting', message: 'Preparing the company page…', completed: 0, total: 0 };
    await save(job, { replace: true });
    try {
      await waitForContent(tab.id, origin);
      const reply = await api.tabs.sendMessage(tab.id, { action: 'FEEDBACK_START', id: job.id, settings, origin });
      if (!reply?.ok || reply.id !== job.id) throw new FeedbackError(reply?.message || 'The company page did not acknowledge startup.');
      // Content owns the state after acknowledgement; never overwrite an early completion.
      return { ok: true, job: await getJob() };
    } catch (error) {
      const failure = error.name === 'FeedbackError' ? error : new FeedbackError('The company page could not start feedback. Reload it and try again.');
      await save({ ...job, state: 'failed', message: failure.message });
      throw failure;
    }
  }

  async function handle(message, sender = {}) {
    if (!message || typeof message.action !== 'string') return { ok: false };
    if (sender.tab) {
      if (message.action !== 'FEEDBACK_UPDATE') return { ok: false };
      const job = await getJob();
      const update = message.job;
      if (!job || job.id !== update?.id || job.tabId !== sender.tab.id || !ACTIVE_STATES.has(job.state)) return { ok: false };
      if (!['running', 'cancelling', 'completed', 'cancelled', 'failed'].includes(update.state)) return { ok: false };
      return { ok: true, job: await save({ ...job, state: update.state, message: String(update.message), completed: update.completed, total: update.total }) };
    }
    if (message.action === 'FEEDBACK_GET') return { ok: true, job: await reconcile() };
    if (message.action === 'FEEDBACK_START') {
      if (startPromise) return startPromise;
      let settings;
      try { settings = validateSettings(message.settings); } catch (error) { throw new FeedbackError(error.message); }
      // Reconcile before acquiring the in-memory launch lock so a worker restart cannot duplicate a run.
      const previous = await reconcile();
      if (previous && ACTIVE_STATES.has(previous.state)) return { ok: true, job: previous };
      if (startPromise) return startPromise;
      startPromise = launch(settings, message.origin);
      try { return await startPromise; } finally { startPromise = null; }
    }
    if (message.action === 'FEEDBACK_CANCEL') {
      const job = await reconcile();
      if (!job || !ACTIVE_STATES.has(job.state)) return { ok: true, job };
      await api.tabs.sendMessage(job.tabId, { action: 'FEEDBACK_CANCEL', id: job.id });
      return { ok: true, job: await getJob() };
    }
    if (message.action === 'FEEDBACK_OPEN') {
      const job = await getJob();
      if (job) await api.tabs.update(job.tabId, { active: true });
      return { ok: true };
    }
    return { ok: false };
  }

  async function interruptTab(tabId) {
    const job = await getJob();
    if (job?.tabId === tabId && ['running', 'cancelling'].includes(job.state)) await save({ ...job, state: 'interrupted', message: 'The company page was closed or reloaded. Check saved feedback before starting again.' });
  }
  async function inspectTab(tabId) {
    const job = await getJob();
    // Reconcile ownership instead of interpreting loading indicators as top-page navigation.
    if (job?.tabId === tabId && ['running', 'cancelling'].includes(job.state)) await reconcile();
  }
  return { handle, interruptTab, inspectTab };
}
