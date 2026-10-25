import { readAccountSettings, accountSettingsChanged } from './account-settings.js';
import { OFFLINE_STATUS, OFFLINE_SOURCES, PORTAL_HOME, PRODUCT_SOURCE } from './offline-config.js';
import { PAGED_SOURCES, beginIndexScan, indexPageRequest } from './offline-pagination.js';
import { ARCHIVE_SCOPE_VERSION } from './offline-access.js';
import { HTML_SOURCES } from './offline-html-sources.js';
import { nextPeriod } from './offline-periods.js';
import { includedOfflineDocuments } from './offline-document-policy.js';
import { samplePrintUrl, sampleSheetFile } from './offline-sample-print.js';
import { archiveFailure, connectionUpdate } from './offline-connection.js';
import { archiveWaitState } from './offline-wait.js';
import { connectionFailure, sanitizeDiagnostic } from './connection-diagnostics.js';
import { archiveMeta, readArchive, nextDetail, updateDetail, completeDetailCapture, retryDetail, postponeDetail, recordFiles, saveFile, clearArchive, archiveStorageUsage } from './offline-store.js';
import { ARCHIVE_CLEANUP, createArchiveCleanupProgress, recoverArchiveCleanup } from './archive-cleanup-progress.js';
import { ACCOUNT_SCOPE, setAccountScope, scopedAccount } from './account-scope.js';
import { pauseAuthenticationWrites } from './offline-auth-service.js';
import { purgeCaptures } from './debug-capture-store.js';
import { capturedError } from './debug-capture-data.js';
import { ensureVault, vaultKey } from './offline-vault.js';
import { captureSession } from './offline-capture-session.js';
import { saveDetailSource, saveDocumentSource, saveFailedDocumentSource, saveFailedDetailSource } from './offline-source-store.js';
import { DETAIL_PARSER_REVISION } from './offline-parser-version.js';
import { saveIndexSource, retainFailedIndexSource, resolveIndexFailure } from './offline-index-source.js';
import { retainObservedSampleTable } from './offline-observed-table-service.js';
import { retainObservedDetail } from './offline-observed-detail-service.js';
import { clearOfflineSession } from './offline-session.js';
import { documentFilename, dispositionFilename, downloadUrl } from './shared/document-names.js';
import { clearJournal } from './diagnostic-journal-store.js';
import { SOURCE_ORDER } from './fetch-policy.js';
import { clearProductSessions } from './product-session-store.js';

const ALARM = 'islandsun-offline-sync';
const INDEX_INTERVAL = 5 * 60000;
const wait = (milliseconds, signal) => new Promise((resolve, reject) => {
  signal.throwIfAborted();
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, milliseconds);
  function abort() { clearTimeout(timer); reject(signal.reason); }
  signal.addEventListener('abort', abort, {once:true});
});
let parserOpening, parserClosing, parserUsers = 0;
async function parse(operation, data) {
  await parserClosing;
  parserUsers++;
  try {
    let key, capture;
    if (data.account) {
      capture = await captureSession(data.account);
      try { key = await vaultKey(data.account); }
      catch (error) { if (error.code !== 'OFFLINE_LOCKED') throw error; }
    }
    if (!parserOpening) parserOpening = (async () => {
      const url = chrome.runtime.getURL('offline-parser.html');
      const contexts = await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'], documentUrls:[url]});
      if (!contexts.length) await chrome.offscreen.createDocument({url:'offline-parser.html', reasons:['DOM_PARSER'], justification:'Extract inert record text for the requested local offline archive.'});
    })().finally(() => { parserOpening = null; });
    await parserOpening;
    // Offscreen documents expose runtime messaging, but not chrome.storage.session.
    const response = await chrome.runtime.sendMessage({target:'offline-parser', operation, ...data, vaultKey:key, captureSession:capture});
    if (!response || response.error) throw Object.assign(new Error(response?.error || 'The archive parser is unavailable.'),{code:'ARCHIVE_DATA'});
    return response.result;
  } finally { parserUsers--; }
}

async function closeParser() {
  if (parserUsers || parserClosing) return;
  parserClosing = chrome.offscreen.hasDocument().then(hasDocument => {
    if (hasDocument && !parserUsers) return chrome.offscreen.closeDocument();
  }).catch(() => {}).finally(() => { parserClosing = null; });
  await parserClosing;
}

export async function archiveResponse(url, signal, options = {}, fetcher = fetch) {
  const {timeoutMs = 25000, onHttpError, ...requestOptions} = options;
  const response = await fetcher(url, {...requestOptions, credentials:'include', redirect:'manual', cache:'no-store', signal:AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])});
  if (response.type === 'opaqueredirect' || response.status >= 300 && response.status < 400 || [401,403].includes(response.status)) {
    await response.body?.cancel();
    throw Object.assign(new Error('Sign in to continue saving offline records.'), {code:'SIGNED_OUT',status:response.status});
  }
  if (!response.ok) {
    let sourceCaptureFailed = false;
    try { if (onHttpError) await onHttpError(response); }
    catch { sourceCaptureFailed = true; }
    if (signal.aborted) { response.body?.cancel().catch(() => {}); signal.throwIfAborted(); }
    await response.body?.cancel();
    throw Object.assign(new Error(response.status === 404 ? 'This record is no longer available on the portal.' : 'The portal returned an error for this request. Saved records remain available.'),
      {code:'ARCHIVE_DATA',status:response.status,...(sourceCaptureFailed ? {sourceCaptureFailed:true} : {})});
  }
  return response;
}

/** Alarm slices persist every record independently, so worker suspension cannot lose progress. */
export function startOfflineService(gate, diagnostics, debug) {
  let running = false, controller, pendingRecord, pendingNumber, pendingFingerprint, pendingIndex, runningAccount, deferredRead = false;
  let deleting = false, completion = Promise.resolve(), finish, resumeNeeded = false;
  gate.onAvailable?.(() => { if (resumeNeeded && !running && !deleting) { resumeNeeded = false; void tick(); } });
  let statusWrites = Promise.resolve(), outageRevision = 0;
  const observations = new Set();
  const reportedFailures = new WeakSet();
  let trace = {};
  const note = (event,fields={}) => debug?.note(event,{...trace,...fields}) || Promise.resolve();
  const cleanupRecovery = recoverArchiveCleanup();
  cleanupRecovery.catch(error => { void note('archive-cleanup-recovery-failed',{errorType:error.name,message:error.message}); });
  async function observedSettings(message) {
    await cleanupRecovery;
    const settings = await readAccountSettings();
    const reset = (await chrome.storage.local.get('islandsun.archive-reset'))['islandsun.archive-reset'];
    if (reset && (!reset.account || reset.account === message.account) && (reset.clearing || message.observedAt <= reset.at)) return {...settings,enabled:false};
    return settings;
  }
  async function recordedParse(operation,data,context = trace) {
    const started=Date.now();
    const fields = {...context,operation,recordId:data.record?.id || data.record?.number,sourceKind:data.kind || data.record?.kind};
    await note('processing-start',fields);
    try {
      const result=await parse(operation,data);
      await note('processing-complete',{...fields,durationMs:Date.now()-started,summary:result && typeof result==='object' ? {number:result.number,complete:result.complete,cursor:result.cursor,total:result.total,stored:result.stored,skippedIdentifiers:result.skippedIdentifiers,documents:result.documents?.length,tables:result.tables?.length} : {}});
      return result;
    } catch(error){await note('processing-failed',{...fields,...capturedError(error),durationMs:Date.now()-started,failure:true});throw error;}
  }
  async function retainFailure(kind,error,durationMs,stage) {
    if (!runningAccount || error.name === 'AbortError') return;
    const source = Object.keys(OFFLINE_SOURCES).find(source => ['index','detail','document'].some(stage => kind === `archive-${source}-${stage}`));
    const event = sanitizeDiagnostic({kind,outcome:connectionFailure(error),durationMs,status:error.status || 0,stage});
    if (source && event) await archiveMeta(`index:${runningAccount}:${source}:health`,{failure:{...event,at:Date.now(),version:chrome.runtime.getManifest().version}}).catch(() => {});
  }
  function readResponse(url, signal, options) {
    // Compound detail/document reads yield between responses as well as between jobs.
    if (gate.archivePaused?.(url === PORTAL_HOME,trace.kind)) throw new DOMException('Waiting for portal navigation.', 'AbortError');
    return archiveResponse(url, signal, options,debug ? (target,init)=>debug.fetch(target,init,{...trace,timeoutMs:options?.timeoutMs || 25000}) : fetch);
  }
  async function runRead(kind, read) {
    const jobId=crypto.randomUUID(),queuedAt=Date.now();
    trace={jobId,kind,recordKey:pendingRecord,indexKey:pendingIndex};
    await note('job-queued',{priority:'background',wait:gate.archiveWait?.()});
    const operation = async signal => {
      const started = Date.now();
      await note('job-start',{queueMs:started-queuedAt});
      if (kind !== 'archive-identity') await status({lastRequest:{id:jobId,event:'started',kind,purpose:'archive',number:pendingNumber,at:started}});
      let stage;
      const record = (outcome, status = 0) => diagnostics?.append({ kind, outcome, status, stage, durationMs: Date.now() - started }).catch(() => {});
      record('started');
      try {
        const result = await read(signal,value => { stage = value; note('job-stage',{stage}).catch(()=>{}); });
        record('complete');
        await note('job-complete',{durationMs:Date.now()-started,stage});
        if (Date.now()-started >= 4000) await status({lastRequest:{id:jobId,event:'finished',kind,purpose:'archive',number:pendingNumber,outcome:'complete',durationMs:Date.now()-started,at:Date.now()}});
        return result;
      } catch (error) {
        record(connectionFailure(error, signal), error.status || 0);
        await retainFailure(kind,error,Date.now()-started,stage);
        reportedFailures.add(error);
        await note('job-failed',{stage,...capturedError(error),status:error.status,durationMs:Date.now()-started,failure:true});
        await status({lastRequest:{id:jobId,event:'finished',kind,purpose:'archive',number:pendingNumber,outcome:connectionFailure(error,signal),status:error.status || 0,durationMs:Date.now()-started,at:Date.now()}});
        throw error;
      }
    };
    let outcome = await gate.runArchiveRead(operation,kind);
    // Wait out pacing without discarding a fetched page before its identity check.
    // A busy portal, editor or failure cooldown still yields the entire slice.
    if (outcome.deferred && outcome.retryAfterMs > 0 && outcome.retryAfterMs <= 10000) {
      await wait(outcome.retryAfterMs,controller.signal);
      outcome = await gate.runArchiveRead(operation,kind);
    }
    if (outcome.deferred) { deferredRead = true; resumeNeeded = true; await note('job-deferred',{wait:gate.archiveWait?.(),retryAfterMs:outcome.retryAfterMs}); await status({state:'waiting'}); }
    return outcome;
  }
  function status(values, verifiedRevision) {
    const operation = statusWrites.then(async () => {
      const saved = (await chrome.storage.local.get(OFFLINE_STATUS))[OFFLINE_STATUS] || {};
      const verified = verifiedRevision !== undefined && verifiedRevision === outageRevision;
      const next = connectionUpdate(saved,values,verified);
      if (gate.archivePacing) next.pacing = gate.archivePacing();
      next.wait = next.state === 'waiting' ? archiveWaitState(gate.archiveWait?.()) : values.state ? null : saved.wait;
      if (values.state) next.stateChangedAt = saved.state === next.state && saved.wait?.reason === next.wait?.reason
        ? saved.stateChangedAt || Date.now() : Date.now();
      if (verified) gate.setPortalOffline?.(false);
      await chrome.storage.local.set({[OFFLINE_STATUS]:next});
    });
    statusWrites = operation.catch(() => {});
    return operation;
  }
  async function unavailable() {
    outageRevision++;
    gate.setPortalOffline?.(true);
    controller?.abort();
    await status({state:'offline',checkedAt:Date.now(),error:'The portal connection could not be confirmed. Saved records remain available.'});
    await configure();
  }
  async function tick() {
    await cleanupRecovery;
    if (running || deleting) return;
    completion = new Promise(resolve => { finish = resolve; });
    running = true; controller = new AbortController();
    deferredRead = false;
    const signal = controller.signal;
    const started = Date.now();
    const probeRevision = outageRevision;
    let checkingConnection = true;
    signal.addEventListener('abort',() => chrome.runtime.sendMessage({target:'offline-parser',operation:'cancel'}).catch(() => {}),{once:true});
    try {
      await status({attemptedAt:started});
      let settings = await readAccountSettings();
      const previous = (await chrome.storage.local.get(OFFLINE_STATUS))[OFFLINE_STATUS] || {};
      const recovering = previous.hadOutage || previous.state === 'offline';
      if (!settings.enabled || settings.account && !settings.offlineArchive && !recovering) return;
      const home = await runRead('archive-identity', async laneSignal => {
        const response = await readResponse(PORTAL_HOME, AbortSignal.any([signal,laneSignal]));
        return recordedParse('identity', {html:await response.text()});
      });
      if (home.deferred) { await status({state:'waiting'}); return; }
      signal.throwIfAborted();
      if (!home.result) { await setAccountScope('','',started); await status({state:'signed-out', account:'',name:'',checkedAt:Date.now()},probeRevision); return; }
      await status({...(settings.offlineArchive ? {} : {state:'paused'}),checkedAt:Date.now(),error:''},probeRevision);
      signal.throwIfAborted();
      checkingConnection = false;
      const identity = home.result, account = identity.account;
      runningAccount = account;
      await setAccountScope(account,identity.name,started);
      const activeScope = (await chrome.storage.local.get(ACCOUNT_SCOPE))[ACCOUNT_SCOPE];
      if (activeScope?.account !== account) throw new DOMException('Account changed.','AbortError');
      signal.throwIfAborted();
      settings = await readAccountSettings();
      if (settings.account !== account || !settings.enabled || !settings.offlineArchive) return;
      await archiveMeta(`account:${account}`, {...identity, checkedAt:Date.now()});
      await status({account, name:identity.name});
      await ensureVault(account,identity.name);
      await captureSession(account);
      await status({state:'active', account, name:identity.name, checkedAt:Date.now(), error:''});
      const kinds = SOURCE_ORDER.filter(kind => OFFLINE_SOURCES[kind]);
      const stamps = await Promise.all(kinds.map(kind => readArchive('meta',`index:${account}:${kind}`)));
      const due = kinds.map((kind,index) => {
        const saved = stamps[index] || {}, periodic = HTML_SOURCES[kind]?.periodic;
        const stamp = saved.scan || periodic ? saved.attemptedAt || 0 : saved.checkedAt || 0;
        return {kind,stamp:saved.captureRefreshAt > (saved.attemptedAt || 0) ? 0 : stamp,
          captureRefresh:!!saved.captureRefreshAt,scan:saved.scan,
          periodRequest:periodic ? nextPeriod(saved) : undefined,nextAttemptAt:saved.nextAttemptAt || 0};
      })
        .filter(item => Date.now() >= item.nextAttemptAt && (HTML_SOURCES[item.kind]?.periodic ? !!item.periodRequest : item.captureRefresh || item.scan || Date.now() - item.stamp >= (item.kind === 'products' ? 3600000 : INDEX_INTERVAL)))
        .sort((a,b) => a.stamp - b.stamp || SOURCE_ORDER.indexOf(a.kind)-SOURCE_ORDER.indexOf(b.kind))[0];
      if (due) {
        pendingIndex = `index:${account}:${due.kind}`;
        if (PAGED_SOURCES[due.kind]) {
          let scan = due.scan?.scopeVersion === ARCHIVE_SCOPE_VERSION ? due.scan : beginIndexScan();
          // A slow identity/head check must not consume every slice without advancing.
          // Keep the four-page cap; navigation, editors and recovery still defer reads.
          let advanced = false;
          for (let page = 0; page < 4 && (!advanced || Date.now()-started < 8000); page++) {
            await wait(300,signal);
            const refreshHead = scan.cursor > 0 && !scan.verify && Date.now()-(scan.headCheckedAt || 0) >= INDEX_INTERVAL;
            const request = indexPageRequest(due.kind,scan,{verify:scan.verify || refreshHead});
            const outcome = await runRead(`archive-${due.kind}-index`, async laneSignal => {
              const response = await readResponse(request.url,AbortSignal.any([signal,laneSignal]),request.options);
              return response.text();
            });
            if (outcome.deferred) return;
            const sourceTrace = trace;
            await wait(300,signal);
            const verified = await runRead('archive-identity', async laneSignal => {
              const response = await readResponse(PORTAL_HOME,AbortSignal.any([signal,laneSignal]));
              return recordedParse('identity',{html:await response.text()});
            });
            if (verified.deferred) return;
            if (verified.result?.account !== account) throw Object.assign(new Error('The signed-in account changed. This page was not archived.'),{code:'ARCHIVE_DATA'});
            signal.throwIfAborted();
            let retained;
            try { retained = await saveIndexSource({account,kind:due.kind,text:outcome.result,request,scan},signal); }
            catch (error) {
              if (signal.aborted) throw error;
              await note('index-source-retention-failed',{code:error.name});
            }
            let imported;
            try { imported = await recordedParse(refreshHead ? 'index-head' : 'index-page',{account,kind:due.kind,scan,text:outcome.result},sourceTrace); }
            catch (error) {
              if (!signal.aborted && error.name !== 'AbortError') {
                try { await retainFailedIndexSource(retained,signal); }
                catch { await note('index-failure-retention-failed',{}); }
              }
              throw error;
            }
            if (!refreshHead) advanced = true;
            await resolveIndexFailure(retained,imported.complete);
            if (imported.complete) break;
            scan = (await readArchive('meta',pendingIndex)).scan;
          }
        } else if (HTML_SOURCES[due.kind]) {
          await wait(300,signal);
          const target = new URL(HTML_SOURCES[due.kind].path,PORTAL_HOME);
          const period = due.periodRequest?.period;
          if (period) {
            target.search = new URLSearchParams({bulan:period.slice(5),tahun:period.slice(0,4)});
            const previous = await readArchive('meta',pendingIndex);
            await archiveMeta(pendingIndex,{...previous,attemptedAt:Date.now(),periodStates:{...previous.periodStates,[period]:{...previous.periodStates?.[period],attemptedAt:Date.now()}}});
          }
          const url = target.href;
          const outcome = await runRead(`archive-${due.kind}-index`, async laneSignal => {
            const response = await readResponse(url,AbortSignal.any([signal,laneSignal]));
            return response.text();
          });
          if (outcome.deferred) return;
          const sourceTrace = trace;
          await wait(300,signal);
          const verified = await runRead('archive-identity', async laneSignal => {
            const response = await readResponse(PORTAL_HOME,AbortSignal.any([signal,laneSignal]));
            return recordedParse('identity',{html:await response.text()});
          });
          if (verified.deferred) return;
          if (verified.result?.account !== account) throw Object.assign(new Error('The signed-in account changed. This list was not archived.'),{code:'ARCHIVE_DATA'});
          signal.throwIfAborted();
          await recordedParse(due.periodRequest ? 'html-period' : 'html-index',{account,kind:due.kind,html:outcome.result,url,period},sourceTrace);
        } else {
          if (due.kind !== 'products') throw Object.assign(new Error('This section does not have a verified signed-in archive reader.'),{code:'ARCHIVE_DATA'});
          await wait(300,signal);
          const outcome = await runRead('archive-products-index', async laneSignal => {
            try {
              const response = await readResponse(PRODUCT_SOURCE, AbortSignal.any([signal,laneSignal]));
              return await response.text();
            } catch (error) {
              if (!signal.aborted && !laneSignal.aborted) throw Object.assign(new Error('The product price list could not be refreshed. The previously saved list is retained.'),{code:'ARCHIVE_DATA'});
              throw error;
            }
          });
          if (outcome.deferred) return;
          const sourceTrace = trace;
          await wait(300,signal);
          const verified = await runRead('archive-identity', async laneSignal => {
            const response = await readResponse(PORTAL_HOME,AbortSignal.any([signal,laneSignal]));
            return recordedParse('identity',{html:await response.text()});
          });
          if (verified.deferred) return;
          if (verified.result?.account !== account) throw Object.assign(new Error('The signed-in account changed. This list was not archived.'),{code:'ARCHIVE_DATA'});
          signal.throwIfAborted();
          await recordedParse('index', {account, kind:due.kind, text:outcome.result},sourceTrace);
        }
        pendingIndex = null;
      }
      const rotationKey = `index:${account}:detail-rotation`;
      let afterKind = (await readArchive('meta',rotationKey))?.kind;
      while (Date.now() - started < 20000) {
        const record = await nextDetail(account,{kinds,afterKind,ordered:true,capture:true});
        if (!record) break;
        if (record.captureRefresh) {
          const key = `index:${account}:${record.kind}`;
          const previous = await readArchive('meta',key);
          if (!previous?.captureRefreshAt) {
            await archiveMeta(key,{...previous,captureRefreshAt:Date.now()});
            await note('capture-list-refresh',{kind:record.kind,reason:'Pending records need a fresh list after browser restart.'});
          }
          break;
        }
        pendingRecord = record.key;
        pendingNumber = record.number;
        pendingFingerprint = record.fingerprint;
        trace = {kind:`archive-${record.kind}-detail`,recordKey:record.key,purpose:'archive'};
        await wait(300,signal);
        const resumeFiles = record.detailCapture?.fingerprint === record.fingerprint
          && record.detailCapture.at === record.detailAt && record.detail;
        const outcome = resumeFiles ? {result:record.detail} : await runRead(`archive-${record.kind}-detail`, async laneSignal => {
          // An attempted section yields its next turn even if its document fails.
          // Persist only after the shared lane grants this read, not on deferral.
          afterKind = record.kind;
          await archiveMeta(rotationKey,{kind:afterKind,attemptedAt:Date.now()});
          const combined = AbortSignal.any([signal,laneSignal]);
          const response = await readResponse(record.detailUrl, combined,{
            ...(record.kind === 'availability' ? {method:'POST',headers:{'X-Requested-With':'XMLHttpRequest'}} : {}),
            onHttpError:async failed => {
              const retained = await saveFailedDetailSource(record,failed,combined);
              await note('detail-failure-source',{recordId:record.id,status:failed.status,retained});
            },
          });
          const html = await response.text();
          if (record.kind === 'availability' || OFFLINE_SOURCES[record.kind]?.stockRows) {
            await wait(300,combined);
            const home = await readResponse(PORTAL_HOME,combined);
            if ((await recordedParse('identity',{html:await home.text()}))?.account !== account) throw Object.assign(new Error('The signed-in account changed. This detail was not archived.'),{code:'ARCHIVE_DATA'});
            const sourceCapturedAt = await saveDetailSource(record,{html},combined);
            const parsed = await recordedParse(record.kind === 'availability' ? 'availability-detail' : 'stock-orders',{html,url:record.detailUrl,record:{kind:record.kind,fields:record.fields}});
            return {...parsed,sourceCapturedAt:sourceCapturedAt || null,parserRevision:DETAIL_PARSER_REVISION};
          }
          if ((await recordedParse('identity',{html}))?.account !== account) throw Object.assign(new Error('The signed-in account changed. This detail was not archived.'),{code:'ARCHIVE_DATA'});
          let sourceCapturedAt = await saveDetailSource(record,{html},combined);
          let supplementary = null;
          if (record.kind === 'sample' && [1,4].includes(Number(new URL(record.detailUrl).searchParams.get('srtype')))) {
            await wait(250,combined);
            const products = await readResponse(`${PORTAL_HOME}Samplerequest/getProdukUsageRND`, combined, {
              method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8','X-Requested-With':'XMLHttpRequest'},
              body:new URLSearchParams({idsrf:record.id,jenis_hidden:''}),
            });
            supplementary = await products.text();
            sourceCapturedAt = await saveDetailSource(record,{html,supplementary},combined);
          }
          const parsed = await recordedParse('detail', {html, account, url:record.detailUrl, supplementary,record:{kind:record.kind,date:record.date,fields:record.fields}});
          return {...parsed,sourceCapturedAt:sourceCapturedAt || null,parserRevision:DETAIL_PARSER_REVISION};
        });
        if (outcome.deferred) break;
        signal.throwIfAborted();
        const detail = outcome.result;
        // Persist details first; absent file bytes stay visibly marked as not yet saved.
        const capturedAt = resumeFiles ? record.detailAt : Date.now();
        if (!resumeFiles && !await updateDetail(record.key,detail,capturedAt,{pendingFiles:true})) continue;
        const captured = await readArchive('records',record.key,{capture:true});
        if (!captured || captured.fingerprint !== record.fingerprint || captured.detailAt !== capturedAt) continue;
        if (resumeFiles) {
          afterKind = record.kind;
          await archiveMeta(rotationKey,{kind:afterKind,attemptedAt:Date.now()});
          await note('documents-resumed',{recordId:record.id,detailAt:record.detailAt});
        }
        if (!resumeFiles) await note('detail-saved',{recordId:record.id,number:record.number,documents:detail.documents.length});
        const files = await recordFiles(record.key,{decrypt:false});
        for (const file of files) {
          signal.throwIfAborted();
          if (!file.hash && file.blob) await saveFile(record,file);
        }
        let incomplete = false;
        for (const document of settings.offlineDocuments ? includedOfflineDocuments(detail.documents) : []) {
          const sampleSheet = record.kind === 'sample' && document.format === 'sample-request-sheet' && samplePrintUrl(document.url,record.detailUrl);
          if ((!downloadUrl(document.url) && !sampleSheet) || files.some(file => file.url === document.url && file.available)) continue;
          if (Date.now() - started >= 20000) { incomplete = true; break; }
          await wait(300,signal);
          const downloaded = await runRead(`archive-${record.kind}-document`, async (laneSignal,setStage) => {
            const combined = AbortSignal.any([signal,laneSignal]);
            setStage('document-response');
            const response = await readResponse(document.url, combined, {timeoutMs:60000,onHttpError:async failed => {
              const retained = await saveFailedDocumentSource(record,document,failed,combined);
              await note('document-failure-source',{recordId:record.id,status:failed.status,retained});
            }});
            if (sampleSheet) {
              const html = await response.text();
              await wait(300,combined);
              setStage('account-check');
              const home = await readResponse(PORTAL_HOME,combined);
              if ((await recordedParse('identity',{html:await home.text()}))?.account !== account) throw Object.assign(new Error('The signed-in account changed. This sample sheet was not archived.'),{code:'ARCHIVE_DATA'});
              setStage('source-storage');
              await saveDocumentSource(record,document,html,combined);
              setStage('sheet-parsing');
              const sheet = await recordedParse('sample-sheet',{html,documentLink:document,record:{kind:record.kind,number:record.number,detailUrl:record.detailUrl}});
              setStage('local-styles');
              const css = await (await fetch(chrome.runtime.getURL('css/offline-print.css'),{signal:combined})).text();
              combined.throwIfAborted();
              const savedAt = Date.now();
              return {url:document.url,label:document.label,savedAt,...sampleSheetFile(sheet,css,savedAt)};
            }
            const blob = await response.blob();
            setStage('file-validation');
            const first = (await blob.slice(0,512).text()).trimStart();
            if (!blob.size || /(?:text\/html|application\/xhtml)/i.test(blob.type) || /^<(?:!doctype|html|head|body|script|\?xml)/i.test(first)) throw new Error('The server returned a page instead of a document.');
            return {url:document.url, label:document.label, blob, savedAt:Date.now(), filename:documentFilename(document.label,dispositionFilename(response.headers.get('content-disposition')),blob.type)};
          });
          if (downloaded.deferred) { incomplete = true; break; }
          signal.throwIfAborted();
          try {
            if (!await saveFile(record,downloaded.result)) throw new DOMException('Archive record changed.','AbortError');
            await note('file-saved',{recordId:record.id,url:document.url,bytes:downloaded.result.blob.size});
          }
          catch (error) {
            await retainFailure(`archive-${record.kind}-document`,error,0,'file-storage');
            throw error;
          }
        }
        if (incomplete) { await postponeDetail(record.key); break; }
        await completeDetailCapture(captured);
        pendingRecord = null;
        pendingNumber = null;
      }
      const remainingDetail = await nextDetail(account,{kinds,ordered:true,includeWaiting:true,capture:true});
      const coverage = await Promise.all(kinds.map(kind => readArchive('meta',`index:${account}:${kind}`)));
      const caughtUp = !remainingDetail && coverage.every(value => value?.checkedAt && !value.partial && !value.importing);
      resumeNeeded = !!remainingDetail && !remainingDetail.captureRefresh && remainingDetail.nextDetailAt <= Date.now();
      await status({state:deferredRead ? 'waiting' : 'active', syncedAt:Date.now(),caughtUp});
      await note('archive-checkpoint',{account,caughtUp,nextRecord:remainingDetail?.number || null});
    } catch (error) {
      // A saved detail is not proof that every file finished before cancellation.
      if (pendingRecord) {
        const retryAt = await retryDetail(pendingRecord,error,pendingFingerprint).catch(() => 0);
        await note('retry-scheduled',{recordKey:pendingRecord,retryAt,code:error.code});
      }
      if (pendingIndex && !signal.aborted && error.name !== 'AbortError') {
        const previous = await readArchive('meta',pendingIndex).catch(() => null);
        await archiveMeta(pendingIndex,{...previous, nextAttemptAt:Date.now()+INDEX_INTERVAL, lastError:error.message}).catch(() => {});
        if (!reportedFailures.has(error)) {
          const kind = Object.keys(OFFLINE_SOURCES).find(kind=>pendingIndex === `index:${runningAccount}:${kind}`);
          if (kind) await retainFailure(`archive-${kind}-index`,error,Date.now()-started,'index-processing');
        }
      }
      if (signal.aborted || error.name === 'AbortError') {
        const settings = await readAccountSettings();
        resumeNeeded = settings.enabled && settings.offlineArchive;
        await status({state:settings.enabled && settings.offlineArchive ? 'waiting' : 'paused'});
      }
      else {
        if (error.code !== 'OFFLINE_LOCKED' && !reportedFailures.has(error)) await diagnostics?.append({kind:'archive-processing',outcome:connectionFailure(error),durationMs:Date.now()-started}).catch(() => {});
        if (error.code === 'SIGNED_OUT') await setAccountScope('','',started);
        const failure = archiveFailure(error, checkingConnection);
        if (failure.state === 'offline') {
          outageRevision++; gate.setPortalOffline?.(true);
        }
        await status({...failure, checkedAt:Date.now()},checkingConnection && error.code === 'SIGNED_OUT' ? probeRevision : undefined);
      }
    } finally {
      controller = null; pendingRecord = null; pendingNumber = null; pendingFingerprint = null; pendingIndex = null; runningAccount = null;
      await Promise.allSettled([...observations]);
      if (!observations.size) await closeParser();
      running = false;
      finish();
    }
  }
  async function configure() {
    await cleanupRecovery;
    const settings = await readAccountSettings();
    const previous = (await chrome.storage.local.get(OFFLINE_STATUS))[OFFLINE_STATUS] || {};
    if (!settings.enabled || settings.account && !settings.offlineArchive && !previous.hadOutage) { controller?.abort(); await chrome.alarms.clear(ALARM); await status({state:'paused'}); return; }
    if (previous.state === 'unlock-required') await status({state:'waiting',error:''});
    const alarm = await chrome.alarms.get(ALARM);
    if (alarm?.periodInMinutes !== 0.5) await chrome.alarms.create(ALARM,{delayInMinutes:0.5,periodInMinutes:0.5});
  }
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name !== ALARM) return;
    (async () => {
      const previous = (await chrome.storage.local.get(OFFLINE_STATUS))[OFFLINE_STATUS];
      const pacing = gate.archivePacing?.() || {cycleMs:60000};
      if (Date.now() - (previous?.attemptedAt || 0) < pacing.cycleMs) return;
      await tick();
    })().catch(() => {});
  });
  chrome.storage.onChanged.addListener((changes,area) => {
    if (area !== 'local') return;
    if (changes[ACCOUNT_SCOPE] && runningAccount && changes[ACCOUNT_SCOPE].newValue?.account !== runningAccount) controller?.abort();
    if (accountSettingsChanged(changes)) {
      if (!changes[ACCOUNT_SCOPE] || changes[ACCOUNT_SCOPE].newValue?.account !== runningAccount) controller?.abort();
      configure().catch(() => {});
    }
  });
  chrome.runtime.onMessage.addListener((message,sender,respond) => {
    if (message?.type === 'offline-observed-index') {
      const operation = (async () => {
        if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !sender.url?.startsWith(PORTAL_HOME)
          || !['sample','tir'].includes(message.kind) || typeof message.text !== 'string' || message.text.length > 8*1024*1024
          || !Number.isFinite(message.observedAt) || message.observedAt > Date.now() || Date.now()-message.observedAt > 120000) return false;
        const settings = await readAccountSettings();
        if (deleting || !settings.enabled || !settings.offlineArchive || settings.account !== message.account) return false;
        await ensureVault(settings.account);
        const reset = (await chrome.storage.local.get('islandsun.archive-reset'))['islandsun.archive-reset'];
        if (deleting || (await readAccountSettings()).account !== settings.account
          || reset && (!reset.account || reset.account === settings.account) && message.observedAt <= reset.at) return false;
        const retained = await saveIndexSource({account:settings.account,kind:message.kind,text:message.text,capturedAt:message.observedAt,
          request:{url:`${PORTAL_HOME.slice(0,-1)}${OFFLINE_SOURCES[message.kind].path}`,options:{method:'GET',body:null}},scan:{cursor:0,verify:false}});
        let result;
        try { result = await parse('observed-index',{account:settings.account,kind:message.kind,text:message.text}); }
        catch (error) { await retainFailedIndexSource(retained); throw error; }
        await resolveIndexFailure(retained,true);
        await note('observed-index-saved',{account:settings.account,kind:message.kind,...result});
        return true;
      })();
      observations.add(operation);
      operation.then(ok => respond({ok}),error => { note('observed-index-failed',{kind:message.kind,code:error.code,errorType:error.name}).catch(()=>{}); respond({ok:false}); }).finally(() => observations.delete(operation));
      return true;
    }
    if (message?.type === 'offline-observed-sample-table') {
      const operation = (async () => retainObservedSampleTable(message,sender,await observedSettings(message),() => !deleting))();
      observations.add(operation);
      operation.then(ok => respond({ok}),() => respond({ok:false})).finally(() => observations.delete(operation));
      return true;
    }
    if (message?.type === 'offline-observed-detail') {
      const operation = retainObservedDetail(message,sender,{
        readSettings:() => observedSettings(message),parse,canContinue:() => !deleting,
      });
      observations.add(operation);
      operation.then(ok => respond({ok}), () => respond({ok:false})).finally(() => observations.delete(operation));
      return true;
    }
    if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return;
    if (message?.type === 'offline-browser-disconnected') {
      unavailable().then(() => respond({ok:true}),() => respond({ok:false}));
      return true;
    }
    if (message?.type === 'offline-storage-info') {
      (async () => {
        const scope = (await chrome.storage.local.get(ACCOUNT_SCOPE))[ACCOUNT_SCOPE];
        const account = scopedAccount(scope);
        if (!account) throw new Error('Sign in to manage saved storage.');
        return {account,name:scope.name || account,...await archiveStorageUsage(account)};
      })().then(value => respond({ok:true,value}),() => respond({ok:false}));
      return true;
    }
    if (message?.type === 'offline-cleanup-status') {
      cleanupRecovery.then(() => chrome.storage.local.get(ARCHIVE_CLEANUP))
        .then(saved => respond({ok:true,value:saved[ARCHIVE_CLEANUP]}),() => respond({ok:false}));
      return true;
    }
    if (message?.type === 'offline-clear') {
      (async () => {
        await cleanupRecovery;
        if (deleting) throw new Error('Storage cleanup is already running.');
        if (!['all','account'].includes(message.scope)) throw new Error('Choose which saved records to delete.');
        const settings = await chrome.storage.local.get([ACCOUNT_SCOPE,OFFLINE_STATUS]);
        const account = scopedAccount(settings[ACCOUNT_SCOPE],settings[OFFLINE_STATUS]);
        if (!account || message.account !== account) throw new Error('The account changed. Reopen settings before deleting.');
        if (deleting) throw new Error('Storage cleanup is already running.');
        deleting = true;
        const target = message.scope === 'all' ? null : account;
        const progress = createArchiveCleanupProgress(account,message.scope);
        try {
          await progress({phase:'stopping'});
          await chrome.storage.local.set({'islandsun.archive-reset':{account:target,at:Date.now(),clearing:true}});
          controller?.abort();
          await completion;
          await Promise.allSettled([...observations]);
          await pauseAuthenticationWrites(() => clearArchive(target,{onProgress:progress}));
          await clearOfflineSession(target);
          await clearProductSessions(target);
          await progress({phase:'history',completed:0,total:0});
          await purgeCaptures(target);
          await clearJournal(target,{onProgress:progress});
          const currentSettings = await readAccountSettings();
          await status({state:currentSettings.offlineArchive ? 'waiting' : 'paused',clearedAt:Date.now(),error:'',syncedAt:0});
          await progress({state:'complete',completed:0,total:0});
        } catch (error) {
          await progress({state:'failed'});
          throw error;
        } finally {
          try { await chrome.storage.local.set({'islandsun.archive-reset':{account:target,at:Date.now()}}); }
          finally { deleting = false; }
        }
        await note('archive-cleared',{scope:message.scope,account,settingsPreserved:true});
        void tick();
      })().then(() => respond({ok:true}),error => respond({ok:false,error:error.message}));
      return true;
    }
    if (message?.type !== 'offline-check') return;
    tick().then(() => respond({ok:true}), () => respond({ok:false}));
    return true;
  });
  chrome.runtime.onStartup.addListener(() => configure().catch(() => {}));
  configure().catch(() => {});
  return {unavailable};
}
