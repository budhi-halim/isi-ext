import { DEFAULT_PORTAL_ORIGIN, portalOrigin, selectPortalTab } from './js/shared/portal-address.js';
import { initializeUpdatePopup } from './js/shared/update-popup.js';
initializeUpdatePopup('revenue');
import { initializeTheme } from './assets/family/js/theme.js';
import { checkSession } from './js/shared/portal-session.js';

const find = id => document.getElementById(id);
initializeTheme();
let controller = null;
let selectedOrigin = DEFAULT_PORTAL_ORIGIN;
let generation = 0;
function render(state) {
  const content = {
    checking: ['Checking connection', 'Checking your company session…'],
    out: ['Sign in to continue', 'Sign in to the Islandsun system, then check your connection again.'],
    ready: ['Ready to extract', 'Open the dashboard to select the months to extract.'],
    error: ['Connection unavailable', 'Connect to the company network and try again.']
  }[state];
  find('connection-state').dataset.state = state;
  find('state-title').textContent = content[0];
  find('state-message').textContent = content[1];
  find('connection-spinner').hidden = state !== 'checking';
  find('login-button').hidden = state !== 'out';
  find('dashboard-button').hidden = state !== 'ready';
  find('retry-button').hidden = state === 'checking' || state === 'ready';
}
async function checkConnection() {
  controller?.abort();
  controller = new AbortController();
  const ticket = ++generation;
  render('checking');
  try {
    const origin = portalOrigin((await selectPortalTab(chrome.tabs))?.url) || DEFAULT_PORTAL_ORIGIN;
    if (ticket !== generation) return;
    selectedOrigin = origin;
    await checkSession(controller.signal, origin);
    if (ticket === generation) render('ready');
  } catch (error) {
    if (ticket === generation && error.name !== 'AbortError') render(error.name === 'SessionExpiredError' ? 'out' : 'error');
  }
}
find('login-button').addEventListener('click', () => { chrome.tabs.create({ url: `${selectedOrigin}/islandsun/index.php/login/` }); });
find('dashboard-button').addEventListener('click', () => { chrome.tabs.create({ url: chrome.runtime.getURL(`scraper.html?portal=${encodeURIComponent(selectedOrigin)}`) }); });
find('retry-button').addEventListener('click', checkConnection);
window.addEventListener('pagehide', () => { generation++; controller?.abort(); });
void checkConnection();
