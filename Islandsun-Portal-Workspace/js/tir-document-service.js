import { portalOrigin, portalUrl, rebasePortalUrl } from './shared/portal-address.js';
import { downloadUrl, documentFilename } from './shared/document-names.js';
import { readAccountSettings } from './account-settings.js';
import { readVisibleRecord, saveFile } from './offline-store.js';
import { archiveKey } from './offline-config.js';

export function startTirDocumentService() {
  let generation = 0;
  chrome.storage.onChanged.addListener((changes,area) => {
    const scope = changes['islandsun.account-scope'];
    if (area === 'local' && (changes['islandsun.archive-reset'] || scope && scope.oldValue?.account !== scope.newValue?.account)) generation++;
  });
  chrome.runtime.onMessage.addListener((message,sender,respond) => {
    if (message?.type !== 'tir-document-bytes' || sender.id !== chrome.runtime.id || sender.frameId !== 0 || !portalUrl(sender.url)) return;
    (async () => {
      const current = generation;
      const settings = await readAccountSettings();
      const reset = (await chrome.storage.local.get('islandsun.archive-reset'))['islandsun.archive-reset'];
      const fail = code => { throw Object.assign(new Error(code),{code}); };
      if (!Number.isFinite(message.startedAt)) fail('INVALID_OBSERVATION_TIME');
      if (reset && (!reset.account || reset.account === settings.account) && (reset.clearing || message.startedAt <= reset.at)) fail('ARCHIVE_RESET');
      const match = new URL(message.record.url).pathname.match(/^\/islandsun\/master\/tir\/edit\/([1-9]\d*)$/i);
      if (!settings.enabled) fail('EXTENSION_DISABLED');
      if (!settings.account || message.account !== settings.account) fail('ACCOUNT_CHANGED');
      if (!match || match[1] !== message.record.id || new URL(message.record.url).origin !== portalOrigin(sender.url)
        || !downloadUrl(message.document?.url) || typeof message.base64 !== 'string' || message.base64.length > Math.ceil(32*1024*1024/3)*4) throw new Error('Invalid document observation');
      const bytes = Uint8Array.from(atob(message.base64),value=>value.charCodeAt(0));
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
      let saved = false;
      if (settings.offlineArchive && settings.offlineDocuments) {
        try {
          const record = await readVisibleRecord(archiveKey(settings.account,'tir',match[1]),settings.account,'tir');
          const latest = await readAccountSettings();
          const document = record?.detail?.documents.find(document => rebasePortalUrl(document.url) === rebasePortalUrl(message.document.url));
          if (latest.account === settings.account && document) {
            const blob = new Blob([bytes],{type:String(message.mime || '').slice(0,100)});
            saved = await saveFile(record,{url:document.url,label:document.label,blob,savedAt:Date.now(),filename:documentFilename(document.label,'',blob.type)},{shouldContinue:() => current === generation});
          }
        } catch { /* A locked archive does not prevent independent document notifications. */ }
      }
      if (current !== generation || (await readAccountSettings()).account !== settings.account) fail('ACCOUNT_OR_STORAGE_CHANGED');
      return {ok:true,hash,saved};
    })().then(respond,error=>respond({ok:false,code:error.code || 'DOCUMENT_VERIFICATION_FAILED',errorType:error.name}));
    return true;
  });
}
