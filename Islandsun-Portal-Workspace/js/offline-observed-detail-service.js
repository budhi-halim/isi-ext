import { PORTAL_HOME, archiveKey } from './offline-config.js';
import { readVisibleRecord, updateDetail, completeDetailCapture } from './offline-store.js';
import { saveDetailSource } from './offline-source-store.js';
import { DETAIL_PARSER_REVISION } from './offline-parser-version.js';
import { CAPTURE_LIMITS } from './debug-capture-data.js';

function recordIdentity(value) {
  try {
    const url = new URL(value);
    if (url.origin !== new URL(PORTAL_HOME).origin) return null;
    const tir = url.pathname.match(/^\/islandsun\/master\/tir\/edit\/([1-9]\d*)$/i);
    if (tir) return {kind:'tir',id:tir[1],type:null};
    if (!/^\/islandsun\/samplerequest\/edit$/i.test(url.pathname)
      || !/^[1-9]\d*$/.test(url.searchParams.get('id') || '')
      || !/^[1-5]$/.test(url.searchParams.get('srtype') || '')) return null;
    return {kind:'sample',id:url.searchParams.get('id'),type:Number(url.searchParams.get('srtype'))};
  } catch { return null; }
}

/** Archive successful preview responses off the live page; stale or partial results cannot replace complete details. */
export async function retainObservedDetail(message, sender, {readSettings, parse, canContinue}) {
  const identity = recordIdentity(message.url);
  if (!identity || sender.id !== chrome.runtime.id || !sender.url?.startsWith(PORTAL_HOME)
    || !message.account || typeof message.html !== 'string' || !message.html
    || message.html.length > CAPTURE_LIMITS.responseBytes
    || message.supplementary !== null && typeof message.supplementary !== 'string'
    || (message.supplementary?.length || 0) > CAPTURE_LIMITS.responseBytes
    || !Number.isFinite(message.observedAt) || message.observedAt > Date.now()
    || Date.now() - message.observedAt > 120000
    || identity.kind === 'sample' && [1,4].includes(identity.type) && message.supplementary === null) return false;
  const permitted = async () => {
    const settings = await readSettings();
    return canContinue() && settings.enabled && settings.offlineArchive && settings.account === message.account ? settings : null;
  };
  if (!await permitted()) return false;
  const key = archiveKey(message.account,identity.kind,identity.id);
  const record = await readVisibleRecord(key,message.account,identity.kind,{capture:true});
  if (!record || JSON.stringify(recordIdentity(record.detailUrl)) !== JSON.stringify(identity)
    || record.detailAt >= message.observedAt || record.rawDetailAt >= message.observedAt) return false;
  if ((await parse('identity',{html:message.html}))?.account !== message.account || !await permitted()) return false;
  const sourceCapturedAt = await saveDetailSource(record,{
    html:message.html,supplementary:message.supplementary,capturedAt:message.observedAt,
  });
  if (!sourceCapturedAt || !canContinue()) return false;
  const parsed = await parse('detail',{
    html:message.html,account:message.account,url:record.detailUrl,supplementary:message.supplementary,
    record:{kind:record.kind,date:record.date,fields:record.fields},
  });
  if (!Array.isArray(parsed?.documents) || record.detail?.supplementaryComplete && !parsed.supplementaryComplete) return false;
  const settings = await permitted();
  if (!settings) return false;
  const detail = {...parsed,sourceCapturedAt,parserRevision:DETAIL_PARSER_REVISION};
  if (!await updateDetail(key,detail,message.observedAt,{
    pendingFiles:true,expected:record,shouldContinue:canContinue,
  })) return false;
  // The durable document checkpoint lets the normal worker resume without another detail fetch.
  if (!settings.offlineDocuments) {
    const saved = await readVisibleRecord(key,message.account,identity.kind,{capture:true});
    if (saved?.detailAt === message.observedAt) await completeDetailCapture(saved);
  }
  return true;
}
