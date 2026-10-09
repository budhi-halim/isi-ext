import { readDetailSource } from './offline-source-store.js';
import { replaceParsedDetail, readVisibleRecord } from './offline-store.js';
import { parseDetail, parseIdentity, parseAvailabilityDetail, parseStockOrders } from './offline-parser.js';
import { OFFLINE_SOURCES } from './offline-config.js';
import { DETAIL_PARSER_REVISION } from './offline-parser-version.js';

/** Rebuild a bound snapshot locally without treating older raw HTML as a newer observation. */
export async function replaySavedDetail(record, shouldContinue = () => true) {
  if (!record.detail?.sourceCapturedAt || record.detail.parserRevision === DETAIL_PARSER_REVISION || !shouldContinue()) return record;
  const source = await readDetailSource(record.key,record.account,record.kind);
  if (!shouldContinue() || !source?.matchesCurrentList || source.capturedAt !== record.detail.sourceCapturedAt) return record;
  let detail;
  if (record.kind === 'availability') detail = parseAvailabilityDetail(source.html,source.url,record);
  else if (OFFLINE_SOURCES[record.kind]?.stockRows) detail = parseStockOrders(source.html,source.url,record);
  else {
    if (parseIdentity(source.html)?.account !== record.account) throw new Error('Saved source account does not match.');
    detail = parseDetail(source.html,source.url,source.supplementary,record);
  }
  detail = {...detail,sourceCapturedAt:source.capturedAt,parserRevision:DETAIL_PARSER_REVISION};
  if (!shouldContinue()) return record;
  await replaceParsedDetail(record,detail,shouldContinue);
  return readVisibleRecord(record.key,record.account,record.kind);
}
