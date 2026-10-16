import { OFFLINE_SOURCES } from './offline-config.js';
import { visitRecords, readArchive, recordFileCoverage } from './offline-store.js';
import { diagnosticArchiveSource, sanitizeDiagnostic } from './connection-diagnostics.js';
import { archiveWaitState, archiveWaitMessage } from './offline-wait.js';
import { includedOfflineDocuments } from './offline-document-policy.js';
import { prepareOfflineDetail } from './offline-detail-presentation.js';
import { documentSourceKey, failedDocumentSourceKey, FAILED_DETAIL_SOURCE_URL } from './offline-source-store.js';
import { indexSourceKey } from './offline-index-source.js';

const timestamp = value => Number.isFinite(value) && value > 0 ? new Date(value).toISOString() : null;

/** Describe coverage separately from whether the server currently responds. */
export function coverageState(source, now = Date.now()) {
  if (source.hasError) return source.nextAttemptAt > now ? 'Retry scheduled' : 'Refresh failed';
  if (!source.hasMetadata) return 'First capture pending';
  if (source.importing) return source.lastReconciled ? 'Refreshing saved list' : 'List refresh incomplete';
  if (source.partial || source.pendingDates || source.unverified || source.periods && source.periods.saved < source.periods.discovered) return 'Coverage incomplete';
  if (source.details.missing || source.details.incomplete || source.files.missing) return 'Details or files pending';
  if (source.total != null && source.saved !== source.total - (source.skippedIdentifiers || 0)) return 'List comparison needed';
  if (source.details.reconstructed) return 'Saved with reconstructed products';
  return 'Saved snapshot caught up';
}

/** Keep capture availability separate from the contents already saved. */
export function captureStatus(connection, settings, wait) {
  if (!settings.enabled || !settings.offlineArchive) return 'Automatic saving is paused.';
  if (connection === 'waiting') return archiveWaitMessage(wait);
  return {'signed-out':'Automatic saving needs online sign-in.','unlock-required':'Saving will resume automatically while you are signed in to the portal.',offline:'The portal is unavailable; saved records remain accessible.',attention:'Automatic saving needs attention; check the affected sections.'}[connection] || 'Automatic saving is enabled.';
}

/** Scan one account in bounded batches; never export record content or identifiers. */
export async function collectArchiveReport({account, version, connection, settings, activity = {}, shouldContinue = () => true, onSource = () => {}}) {
  const report = {version,startedAt:timestamp(Date.now()),connection,settings,sources:[]};
  report.activity = {attemptedAt:timestamp(activity.attemptedAt),syncedAt:timestamp(activity.syncedAt),stateChangedAt:timestamp(activity.stateChangedAt),wait:connection === 'waiting' ? archiveWaitState(activity.wait) : null};
  if (['careful','steady','quick'].includes(activity.pacing?.mode)) {
    const {mode,gapMs,cycleMs,averageMs} = activity.pacing;
    report.activity.pacing = {mode,gapMs:Number(gapMs) || 0,cycleMs:Number(cycleMs) || 0,averageMs:Number(averageMs) || 0};
  }
  report.captureStatus = captureStatus(connection,settings,report.activity.wait);
  for (const [kind, config] of Object.entries(OFFLINE_SOURCES)) {
    if (!shouldContinue()) throw new DOMException('Report cancelled.','AbortError');
    const meta = await readArchive('meta',`index:${account}:${kind}`);
    const source = {...diagnosticArchiveSource(kind,meta),title:config.title,saved:0,
      details:{saved:0,missing:0,incomplete:0,reconstructed:0,productConflicts:0,expectedEmpty:0},rawDetails:{saved:0,missing:0,stale:0},rawDocuments:{saved:0,missing:0},failedDetailResponses:{saved:0},failedDocumentResponses:{saved:0},files:{known:0,saved:0,missing:0},
      oldestEntryDate:null,newestEntryDate:null,latestDetailAt:null,latestFileAt:null};
    const failure = (await readArchive('meta',`index:${account}:${kind}:health`))?.failure;
    source.listResponses = {
      latestAt:timestamp((await readArchive('meta',indexSourceKey(account,kind)))?.capturedAt),
      processingFailureAt:timestamp((await readArchive('meta',indexSourceKey(account,kind,true)))?.capturedAt),
    };
    const safeFailure = sanitizeDiagnostic(failure);
    if (safeFailure) source.lastFailure = {...safeFailure,at:timestamp(failure.at)};
    if (kind === 'delivery') source.omitted = ['Generated print sheets'];
    source.skippedIdentifiers = (meta?.importing ? meta.scan?.skippedIdentifiers : meta?.skippedIdentifiers) || 0;
    source.unverified = await visitRecords(account,kind,async record => {
      record = {...record,detail:prepareOfflineDetail(record.detail,record)};
      source.saved++;
      if (record.date) {
        source.oldestEntryDate = !source.oldestEntryDate || record.date < source.oldestEntryDate ? record.date : source.oldestEntryDate;
        source.newestEntryDate = !source.newestEntryDate || record.date > source.newestEntryDate ? record.date : source.newestEntryDate;
      }
      if (record.detailAt) {
        source.details.saved++;
        if (record.detail?.supplementaryComplete === false) source.details.incomplete++;
        if (record.detail?.tables?.some(table => table.productRecovery?.state === 'reconstructed')) source.details.reconstructed++;
        if (record.detail?.tables?.some(table => table.productRecovery?.state === 'conflict')) source.details.productConflicts++;
        if (record.detail?.tables?.some(table => table.productRecovery?.state === 'expected-empty')) source.details.expectedEmpty++;
        const at = timestamp(record.detailAt);
        if (at > source.latestDetailAt || !source.latestDetailAt) source.latestDetailAt = at;
      } else if (record.detailUrl) source.details.missing++;
      if (record.detailUrl) {
        if (record.rawDetailAt) {
          source.rawDetails.saved++;
          if (record.rawDetailFingerprint !== record.fingerprint) source.rawDetails.stale++;
        } else source.rawDetails.missing++;
      }
      const includedDocuments = includedOfflineDocuments(record.detail?.documents);
      const documents = new Set(includedDocuments.map(file => file.url));
      if (!record.rawDetailFailureAt && !documents.size) return;
      const files = await recordFileCoverage(record.key,{includeSources:true});
      if (files.some(file => file.purpose === 'source' && file.url === FAILED_DETAIL_SOURCE_URL && file.available)) source.failedDetailResponses.saved++;
      for (const url of documents) {
        if (files.some(file => file.purpose === 'source' && file.url === failedDocumentSourceKey(url) && file.available)) source.failedDocumentResponses.saved++;
      }
      const printSources = new Set(includedDocuments.filter(document => document.format === 'sample-request-sheet').map(document => documentSourceKey(document.url)));
      for (const url of printSources) {
        if (files.some(file => file.purpose === 'source' && file.url === url && file.available)) source.rawDocuments.saved++;
        else source.rawDocuments.missing++;
      }
      for (const url of documents) {
        source.files.known++;
        const file = files.find(file => file.url === url && file.available);
        if (!file) { source.files.missing++; continue; }
        source.files.saved++;
        const at = timestamp(file.savedAt);
        if (at > source.latestFileAt || !source.latestFileAt) source.latestFileAt = at;
      }
    },{readableOnly:true,shouldContinue});
    if (config.periodic) {
      source.periods = {saved:meta?.periodsSaved || 0,discovered:meta?.periodCount || 0};
      source.periodCoverage = (meta?.periods || []).filter(period => /^\d{4}-\d{2}$/.test(period)).map(period => {
        const state = meta.periodStates?.[period] || {};
        return {period,checkedAt:timestamp(state.checkedAt),attemptedAt:timestamp(state.attemptedAt),total:state.total ?? null,pendingDates:state.pendingDates || 0};
      });
    }
    source.state = coverageState(source);
    report.sources.push(source);
    onSource(source);
  }
  if (!shouldContinue()) throw new DOMException('Report cancelled.','AbortError');
  report.completedAt = timestamp(Date.now());
  report.note = 'Local observations taken during the report interval, not an atomic snapshot. File counts cover links discovered in saved details; unsaved details may contain additional files. Caught up does not establish historical or visual parity.';
  return report;
}

export function formatArchiveReport(report) {
  return JSON.stringify(report,null,2);
}
