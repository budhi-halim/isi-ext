import { rebasePortalUrl } from './shared/portal-address.js';
import { PORTAL_HOME } from './offline-config.js';
import { HTML_SOURCES } from './offline-html-sources.js';
import { parseIdentity, parseHtmlRows, normalizeIndex } from './offline-parser.js';
import { resolveStockRows } from './offline-logistics-source.js';
import { readArchive, archiveMeta, saveRecords, reconcileRecords } from './offline-store.js';
import { ARCHIVE_SCOPE_VERSION } from './offline-access.js';
import { sourcePeriods, periodCoverage } from './offline-periods.js';

/** Discover native periods separately; a blank default table is never a complete archive. */
export function parseSourcePeriods(account,kind,html,url) {
  url = rebasePortalUrl(url);
  const source = HTML_SOURCES[kind], expected = source && new URL(source.path,PORTAL_HOME).href;
  if (!source?.periodic || url!==expected || parseIdentity(html)?.account!==account) throw new Error('The signed-in reporting source changed.');
  const root = new DOMParser().parseFromString(html,'text/html');
  const form = [...root.forms].find(form=>rebasePortalUrl(new URL(form.getAttribute('action'),url).href)===expected && form.method.toLowerCase()==='get');
  const values = name=>[...form?.querySelector(`select[name="${name}"]`)?.options || []].map(option=>option.value).filter(Boolean);
  return sourcePeriods(values('tahun'),values('bulan'));
}

export async function capturePeriod(message,shouldContinue) {
  const {account,kind,html,url,period} = message;
  const key = `index:${account}:${kind}`;
  const previous = await readArchive('meta',key) || {};
  if (!period) {
    const periods = parseSourcePeriods(account,kind,html,url);
    if (!shouldContinue()) throw new DOMException('Archive paused.','AbortError');
    const meta = {...previous,periods,periodsDiscoveredAt:Date.now(),attemptedAt:Date.now(),nextAttemptAt:0,lastError:''};
    await archiveMeta(key,{...meta,...periodCoverage(meta)});
    return;
  }
  if (!previous.periods?.includes(period)) throw new Error('This reporting period is not offered by the signed-in portal.');
  const parameters = new URL(url).searchParams;
  if (`${parameters.get('tahun')}-${parameters.get('bulan')}`!==period) throw new Error('The requested reporting month does not match this response.');
  const rows = parseHtmlRows(account,kind,html,url).map(row=>({...row,reporting_period:period}));
  const data = await resolveStockRows(account,rows,shouldContinue);
  const records = normalizeIndex(account,kind,{data,recordsFiltered:data.length}).map(record=>({...record,period,scopeVersion:ARCHIVE_SCOPE_VERSION}));
  records.sort((a,b)=>(b.date || '').localeCompare(a.date || ''));
  const pendingDates = records.filter(record=>record.pendingDate).length;
  const stored = await saveRecords(records.filter(record=>!record.pendingDate),shouldContinue);
  if (!shouldContinue()) throw new DOMException('Archive paused.','AbortError');
  if (!pendingDates) await reconcileRecords(account,kind,records.map(record=>record.key),null,period);
  if (!shouldContinue()) throw new DOMException('Archive paused.','AbortError');
  const meta = {...previous,checkedAt:Date.now(),attemptedAt:Date.now(),nextAttemptAt:0,lastError:'',
    periodStates:{...previous.periodStates,[period]:{checkedAt:Date.now(),attemptedAt:Date.now(),total:records.length,stored,pendingDates}}};
  await archiveMeta(key,{...meta,...periodCoverage(meta)});
}
