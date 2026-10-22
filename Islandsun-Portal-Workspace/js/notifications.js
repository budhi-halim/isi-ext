import { translateChrome } from './logic.js';
import { createNotifications as createFamilyNotifications } from '../assets/family/js/notifications.js';

export function createNotifications() {
  const region = document.createElement('section'); region.dataset.isiOwned = '';
  region.className = 'isi-portal-notifications'; document.body.append(region);
  const notices = createFamilyNotifications(region, { visibleOnly: true, toastClass: 'isi-portal-toast' });
  const notify = (message, options = {}) => notices.show(translateChrome(message), { ...options, tone: options.error ? 'error' : options.tone });
  return { notify, dismiss: notices.dismiss, setEnabled:notices.setEnabled, destroy() { notices.destroy(); region.remove(); } };
}
