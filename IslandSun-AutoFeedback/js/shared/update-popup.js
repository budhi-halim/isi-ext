import { UPDATE_KEY, UPDATE_PAGE, compareVersions } from './update-logic.js';

export function initializeUpdatePopup(key, { discoverFamily = false } = {}) {
  if (!globalThis.chrome?.runtime?.id) return;
  const version = chrome.runtime.getManifest().version;
  const section = document.createElement('section'); section.className = 'popup-updates';
  section.setAttribute('aria-label', 'Extension updates');
  const label = document.createElement('p'); label.className = 'isi-muted'; label.textContent = `Version ${version}`;
  const status = document.createElement('p'); status.className = 'isi-muted'; status.setAttribute('role', 'status');
  const update = document.createElement('a'); update.className = 'isi-button'; update.textContent = 'Update available';
  update.href = UPDATE_PAGE; update.target = '_blank'; update.rel = 'noopener'; update.hidden = true;
  section.append(label, update, status);
  document.querySelector('main').append(section);
  let disposed = false, revision = 0;
  function render(state) {
    if (disposed) return;
    const latest = state?.catalog?.[key]?.version;
    const available = latest && compareVersions(latest, version) > 0;
    update.hidden = !available;
    update.textContent = available ? `Update available · ${latest}` : 'Update available';
    status.textContent = state?.status === 'unavailable' ? 'Update check unavailable. We’ll try again later.' : state?.status === 'ready' ? (available ? '' : 'Up to date') : 'Checking for updates…';
  }
  const changed = (changes, area) => { if (area === 'local' && changes[UPDATE_KEY]) { revision++; render(changes[UPDATE_KEY].newValue); } };
  chrome.storage.onChanged.addListener(changed);
  const refresh = async () => {
    const ticket = revision;
    try { const response = await chrome.runtime.sendMessage({ type: 'islandsun-updates', action: 'status' }); if (!response?.ok) throw new Error(); if (ticket === revision) render(response.state); }
    catch { if (!disposed) status.textContent = 'Update check unavailable. Reopen the extension to try again.'; }
  };
  if (discoverFamily) {
    const permission = document.createElement('button'); permission.type = 'button'; permission.className = 'isi-button'; permission.textContent = 'Check all Islandsun extensions';
    const explanation = document.createElement('p'); explanation.className = 'isi-muted'; explanation.textContent = 'Allow access to installed extensions for Islandsun update reminders.';
    section.append(permission, explanation);
    const showPermission = async () => {
      try {
        const granted = await chrome.permissions.contains({ permissions: ['management'] });
        if (!disposed) { permission.hidden = granted; explanation.hidden = granted; }
      } catch { if (!disposed) permission.disabled = true; }
    };
    permission.addEventListener('click', async () => {
      permission.disabled = true;
      try { await chrome.permissions.request({ permissions: ['management'] }); await showPermission(); await refresh(); }
      catch { if (!disposed) status.textContent = 'Access was not granted. You can still check each extension in its own popup.'; }
      finally { if (!disposed) permission.disabled = false; }
    });
    void showPermission();
  }
  window.addEventListener('pagehide', () => { disposed = true; chrome.storage.onChanged.removeListener(changed); }, { once: true });
  void refresh();
}
