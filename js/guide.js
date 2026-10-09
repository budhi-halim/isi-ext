import { initializeTheme } from '../assets/family/js/theme.js';
import { createNotifications } from '../assets/family/js/notifications.js';

initializeTheme({ toggle: document.querySelector('#theme-toggle') });
const notices = createNotifications();

for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    button.disabled = true;
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      notices.show('Address copied. Paste it into your browser’s address bar.');
    } catch {
      notices.show('Select and copy the address beside this button.', { tone: 'warning' });
    } finally { button.disabled = false; }
  });
}

async function showVersions() {
  const labels = [...document.querySelectorAll('[data-version]')];
  try {
    const response = await fetch('extension-versions.json', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Version list unavailable');
    const feed = await response.json();
    if (feed.schema !== 1) throw new Error('Invalid version list');
    for (const label of labels) {
      const version = feed.extensions?.[label.dataset.version]?.version;
      label.textContent = typeof version === 'string' && /^\d+(?:\.\d+){1,3}$/.test(version) ? `Version ${version}` : 'See version in downloaded folder';
    }
  } catch {
    for (const label of labels) label.textContent = 'See version in downloaded folder';
  }
}
showVersions();
