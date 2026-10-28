import { DEFAULT_PORTAL_ORIGIN, portalOrigin, selectPortalTab } from './shared/portal-address.js';
import { initializeUpdatePopup } from './shared/update-popup.js';
initializeUpdatePopup('feedback');
import { initializeTheme } from '../assets/family/js/theme.js';
import { checkSession } from './shared/portal-session.js';
import { ACTIVE_STATES, DEFAULT_SETTINGS, validateSettings } from './logic.js';

initializeTheme();
const find = id => document.getElementById(id);
let controller = null;
let selectedOrigin = DEFAULT_PORTAL_ORIGIN;
let generation = 0;
let starting = false;
let currentJob = null;
let ready = false;

function showError(message = '') {
  find('error-message').textContent = message;
  find('error-message').hidden = !message;
}

function renderConnection(state) {
  const content = {
    checking: ['Checking connection', 'Checking your company session…'],
    out: ['Sign in to continue', 'Sign in to the Islandsun system, then check your connection again.'],
    ready: ['Ready to fill feedback', 'Old, uncancelled requests with blank feedback are processed oldest first.'],
    error: ['Connection unavailable', 'Connect to the company network and try again.']
  }[state];
  ready = state === 'ready';
  find('connection-state').dataset.state = state;
  find('state-title').textContent = content[0];
  find('state-message').textContent = content[1];
  find('connection-spinner').hidden = state !== 'checking';
  find('login-button').hidden = state !== 'out';
  find('retry-button').hidden = !['out', 'error'].includes(state);
  find('settings-form').hidden = !ready || Boolean(currentJob);
  if (currentJob) renderJob(currentJob);
}

function renderJob(job) {
  currentJob = job;
  find('job-state').hidden = !job;
  find('connection-state').hidden = Boolean(job);
  find('settings-form').hidden = !ready || Boolean(job);
  if (!job) return;
  find('login-button').hidden = true;
  find('retry-button').hidden = true;
  const active = ACTIVE_STATES.has(job.state);
  find('job-message').textContent = job.message;
  find('stop-button').hidden = !active;
  find('stop-button').disabled = job.state === 'cancelling' || job.state === 'starting';
  find('restart-button').hidden = active;
  if (job.total > 0) find('job-progress').value = job.completed / job.total * 100;
  else if (!active) find('job-progress').value = job.state === 'completed' ? 100 : 0;
  else find('job-progress').removeAttribute('value');
}

async function send(action, extra = {}) {
  const reply = await chrome.runtime.sendMessage({ action, ...extra });
  if (!reply?.ok) {
    if (reply?.expired) renderConnection('out');
    throw new Error(reply?.message || 'The extension could not complete this action. Reopen it and try again.');
  }
  return reply;
}

async function checkConnection() {
  controller?.abort();
  controller = new AbortController();
  const ticket = ++generation;
  showError();
  renderConnection('checking');
  try {
    const origin = portalOrigin((await selectPortalTab(chrome.tabs))?.url) || DEFAULT_PORTAL_ORIGIN;
    if (ticket !== generation) return;
    selectedOrigin = origin;
    await checkSession(controller.signal, origin);
    if (ticket === generation) renderConnection('ready');
  } catch (error) {
    if (ticket === generation && error.name !== 'AbortError') renderConnection(error.name === 'SessionExpiredError' ? 'out' : 'error');
  }
}

find('settings-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (starting || currentJob || !ready) return;
  let settings;
  showError();
  try { settings = validateSettings(Object.fromEntries(new FormData(event.currentTarget))); }
  catch (error) { showError(error.message); return; }
  starting = true;
  find('start-button').disabled = true;
  find('start-button').textContent = 'Starting…';
  try { const reply = await send('FEEDBACK_START', { settings, origin:selectedOrigin }); renderJob(reply.job); }
  catch (error) { showError(error.message); }
  finally { starting = false; find('start-button').disabled = false; find('start-button').textContent = 'Start AutoFeedback'; }
});
find('login-button').addEventListener('click', () => { void chrome.tabs.create({ url: `${selectedOrigin}/islandsun/index.php/login/` }); });
find('retry-button').addEventListener('click', checkConnection);
find('restart-button').addEventListener('click', () => { renderJob(null); void checkConnection(); });
find('open-job').addEventListener('click', () => { void send('FEEDBACK_OPEN').catch(error => showError(error.message)); });
find('stop-button').addEventListener('click', async () => {
  find('stop-button').disabled = true;
  try { const reply = await send('FEEDBACK_CANCEL'); renderJob(reply.job); }
  catch (error) { showError(error.message); find('stop-button').disabled = false; }
});
const storageChanged = (changes, area) => {
  if (area === 'session' && changes.feedbackJob) renderJob(changes.feedbackJob.newValue);
};
chrome.storage.onChanged.addListener(storageChanged);
window.addEventListener('pagehide', () => { generation++; controller?.abort(); chrome.storage.onChanged.removeListener(storageChanged); });

async function initialize() {
  try {
    const stored = await chrome.storage.local.get(['days', 'komentar', 'saran']);
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) find(key).value = stored[key] ?? value;
    const reply = await send('FEEDBACK_GET');
    if (reply.job) renderJob(reply.job);
    else await checkConnection();
  } catch { renderConnection('error'); showError('The extension could not load its settings. Reopen it and try again.'); }
}
void initialize();
