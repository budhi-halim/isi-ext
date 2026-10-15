import { startAccountSettings } from './account-settings.js';
startAccountSettings();
import { startUpdateService } from './shared/update-service.js';
startUpdateService({ key: 'workspace', discoverFamily: true });
import { startDownloadService } from './shared/download-service.js';
import { startReadGate } from './read-gate.js';
import { startProductSessionService } from './product-session-store.js';
import { startTirDocumentService } from './tir-document-service.js';
import { startConnectionDiagnostics } from './connection-diagnostics.js';
import { startSessionKeepAlive } from './session-keepalive.js';
import { startOfflineService } from './offline-service.js';
import { startOfflineFallback } from './offline-fallback.js';
import { startDebugCapture } from './debug-capture.js';
import { startCaptureCleanup } from './debug-capture-store.js';
import { startDebugNetwork } from './debug-network.js';
import { startAccountScope } from './account-scope.js';
import { startOfflineAuthentication, observePortalAuthentication } from './offline-auth-service.js';
startOfflineAuthentication();
startAccountScope({observeAuthentication:observePortalAuthentication});
startDownloadService();
const debugCapture = startDebugCapture();
startCaptureCleanup();
startDebugNetwork(debugCapture);
const readGate = startReadGate({onEvent:(event,fields) => debugCapture.note(event,fields)});
const connectionDiagnostics = startConnectionDiagnostics({onEvent:event=>debugCapture.note('connection-result',event)});
startSessionKeepAlive(readGate, connectionDiagnostics, debugCapture);
const offlineService = startOfflineService(readGate, connectionDiagnostics, debugCapture);
startOfflineFallback(chrome,{onUnavailable:offlineService.unavailable});
startProductSessionService();
startTirDocumentService();

const locks = new Map();
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'islandsun-local-lock') return;
  try { if (new URL(port.sender?.url).origin !== 'http://apps.islandsunindonesia.com:81') return port.disconnect(); }
  catch { return port.disconnect(); }
  let lockKey;
  port.onMessage.addListener(message => {
    if (lockKey || typeof message.key !== 'string' || !message.key.startsWith('islandsun.portal.') || message.key.length > 500) return port.disconnect();
    lockKey = message.key;
    const queue = locks.get(lockKey) || [];
    if (queue.length && message.wait === false) { port.postMessage({ granted: false }); return; }
    queue.push(port); locks.set(lockKey, queue);
    if (queue.length === 1) port.postMessage({ granted: true });
  });
  port.onDisconnect.addListener(() => {
    const queue = locks.get(lockKey);
    if (!queue) return;
    const index = queue.indexOf(port);
    if (index < 0) return;
    queue.splice(index, 1);
    if (!queue.length) locks.delete(lockKey);
    else if (index === 0) { try { queue[0].postMessage({ granted: true }); } catch { /* Disconnection removes the next queued owner. */ } }
  });
});
