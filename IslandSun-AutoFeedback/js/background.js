import { startUpdateService } from './shared/update-service.js';
startUpdateService({ key: 'feedback' });
import { createCoordinator } from './coordinator.js';

const coordinator = createCoordinator(chrome);
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === 'islandsun-updates' || sender.id !== chrome.runtime.id) return false;
  coordinator.handle(message, sender).then(respond, error => respond({
    ok: false,
    message: ['FeedbackError', 'SessionExpiredError'].includes(error.name) ? error.message : 'The extension could not reach the company page. Check your connection and try again.',
    expired: error.name === 'SessionExpiredError'
  }));
  return true;
});
chrome.tabs.onRemoved.addListener(tabId => { void coordinator.interruptTab(tabId); });
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'complete') void coordinator.inspectTab(tabId);
});
