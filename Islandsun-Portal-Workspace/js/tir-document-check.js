import { readPortalText } from './portal-request.js';
import { documentBaseline, observeDocumentBytes } from './tir-document-policy.js';
import { diagnosticLog } from './diagnostic-log.js';
import { PREVIEW_FRESH_MS } from './fetch-policy.js';

/** Compare downloaded bytes, since a replacement may keep the same URL and label. */
export async function checkTirDocuments(record, previous, signal, onProgress = async () => {}) {
  const documents = documentBaseline(record,previous?.documents);
  const snapshot = () => ({...record,documents:record.documents.map(document => ({...document,...documents[document.id]}))});
  for (const document of Object.values(documents)) {
    if (!document.ready || !document.url || document.watchUntil <= Date.now()
      || document.checkedAt > Date.now()-PREVIEW_FRESH_MS) continue;
    signal.throwIfAborted();
    const startedAt = Date.now();
    const response = await readPortalText(document.url,{signal,purpose:'notification',reason:'documents',binary:true,requestNumber:record.number});
    const result = await chrome.runtime.sendMessage({type:'tir-document-bytes',startedAt,account:record.account,record:{id:record.id,url:record.url,number:record.number},document:{id:document.id,url:document.url,label:document.label},...response});
    signal.throwIfAborted();
    if (!result?.ok) throw Object.assign(new Error('The document could not be verified. It will be checked again.'), {code:result?.code || 'DOCUMENT_SERVICE_UNAVAILABLE'});
    documents[document.id] = observeDocumentBytes(document,result.hash);
    await onProgress(snapshot());
    diagnosticLog('document-version',{record:record.number,url:document.url,changed:documents[document.id].changed,hash:result.hash,archiveSaved:result.saved});
  }
  return snapshot();
}
