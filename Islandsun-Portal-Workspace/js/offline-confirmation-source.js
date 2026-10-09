import { readDocumentSource } from './offline-source-store.js';
import { readVisibleRecord } from './offline-store.js';
import { parseSampleConfirmationSheet } from './offline-sample-print.js';

/** Attach local sheet evidence for this view; never change capture age, stored details or retry scheduling. */
export async function readConfirmationSheet(record, shouldContinue = () => true) {
  if (record.kind !== 'sample' || !record.detail?.sourceCapturedAt || !shouldContinue()
    || !record.detail.tables?.some(table => table.section === 'productRequest'
      && (table.productRecovery?.state === 'reconstructed' || table.rows.length === table.headerRows))) return record;
  const documents = record.detail.documents?.filter(document => document.format === 'sample-request-sheet') || [];
  if (documents.length !== 1) return record;
  const document = documents[0];
  const source = await readDocumentSource(record.key,record.account,record.kind,document.url);
  if (!shouldContinue() || !source?.matchesCurrentList || source.fingerprint !== record.fingerprint
    || !Number.isFinite(source.capturedAt) || source.capturedAt < record.detail.sourceCapturedAt) return record;
  const products = parseSampleConfirmationSheet(source.html,document,record);
  if (!products.length || !shouldContinue()) return record;
  const current = await readVisibleRecord(record.key,record.account,record.kind);
  if (!shouldContinue()) return record;
  if (!current || current.fingerprint !== record.fingerprint || current.detailAt !== record.detailAt
    || JSON.stringify(current.detailContent) !== JSON.stringify(record.detailContent)) return current;
  return {...current,detail:{...current.detail,confirmationSheet:{number:record.number,detailUrl:record.detailUrl,
    fingerprint:source.fingerprint,url:source.url,capturedAt:source.capturedAt,products}}};
}
