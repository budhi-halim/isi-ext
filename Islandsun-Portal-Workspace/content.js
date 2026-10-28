// The manifest installs the stylesheet before the first paint without blocking native content.
if (['http://apps.islandsunindonesia.com:81', 'http://192.168.0.22:81'].includes(location.origin)) {
  document.addEventListener('submit',event => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || new URL(form.action).pathname !== '/islandsun/login/act_login') return;
    const username = form.elements.namedItem('username')?.value;
    const password = form.elements.namedItem('password')?.value;
    if (typeof username !== 'string' || typeof password !== 'string' || !password.trim()) return;
    chrome.runtime.sendMessage({type:'offline-login-candidate',username,password}).catch(() => {});
  },true);
  const reportAccount = () => {
    const link = document.querySelector('.user-menu a[href*="lockscreen?user="]');
    const account = link && document.querySelector('.content-wrapper') ? new URL(link.href).searchParams.get('user') : '';
    if (!account && !document.querySelector('.login-box, .lockscreen-wrapper, form.lockscreen-credentials')) return;
    return chrome.runtime.sendMessage({type:'portal-account-observed',account:account || '',name:account ? document.querySelector('.user-menu > a')?.textContent.trim().replace(/\s+/g,' ') || account : '',observedAt:performance.timeOrigin}).catch(() => {});
  };
  const accountReady = document.readyState === 'loading'
    ? new Promise(resolve => document.addEventListener('DOMContentLoaded',() => resolve(reportAccount()),{once:true}))
    : Promise.resolve(reportAccount());
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'portal-session-pulse' && document.documentElement.dataset.isiPortal === 'enabled' && document.querySelector('.content-wrapper .content')) {
      document.dispatchEvent(new Event('islandsun-session-pulse'));
    }
  });
  const root = document.documentElement;
  // Keep this tab's chosen scheme through native navigation, including sign-in.
  try {
    const scheme = sessionStorage.getItem('islandsun.portal.theme');
    root.dataset.theme = ['light', 'dark'].includes(scheme) ? scheme : 'system';
  } catch { root.dataset.theme = 'system'; }
  root.dataset.isiDomReady = document.readyState === 'loading' ? 'pending' : 'ready';
  document.addEventListener('DOMContentLoaded', () => { root.dataset.isiDomReady = 'ready'; }, { once: true });
  root.dataset.isiBoot = 'pending'; root.classList.add('isi-theme');
  function showStartupFailure() {
    if (!document.body) { document.addEventListener('DOMContentLoaded', showStartupFailure, { once: true }); return; }
    if (root.dataset.isiBoot === 'ready' || root.dataset.isiBoot === 'off' || document.querySelector('#isi-portal-startup')) return;
    const notice = document.createElement('section'); notice.id = 'isi-portal-startup'; notice.setAttribute('role', 'status');
    notice.dataset.isiOwned = '';
    const message = document.createElement('p'); message.textContent = root.dataset.isiBoot === 'failed'
      ? 'The portal layout could not finish loading. Reload the page to try again.' : 'The portal layout is still loading.';
    const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Reload page'; retry.addEventListener('click', () => location.reload());
    const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.textContent = 'Dismiss'; dismiss.addEventListener('click', () => notice.remove());
    notice.append(message, retry, dismiss); document.body.append(notice);
  }
  let fallback;
  const waitForLayout = () => { fallback = setTimeout(showStartupFailure, 15000); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', waitForLayout, {once:true});
  else waitForLayout();
  document.addEventListener('islandsun-startup-failed', showStartupFailure);
  chrome.storage.local.get({ enabled: true }).then(async ({ enabled }) => {
    if (!enabled) { root.dataset.isiBoot = 'off'; root.classList.remove('isi-theme'); clearTimeout(fallback); }
    else { root.dataset.isiPortal = 'enabled'; }
    const ui = await import(chrome.runtime.getURL('js/ui.js'));
    await ui.initializePortal(accountReady);
  }).catch(showStartupFailure).finally(() => { clearTimeout(fallback); if (root.dataset.isiBoot === 'ready' || root.dataset.isiBoot === 'off') document.querySelector('#isi-portal-startup')?.remove(); });
} else document.documentElement.dataset.isiBoot = 'off';
