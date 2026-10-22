import { calendarDay } from './notification-logic.js';
import { submissionStage } from './submission-logic.js';

const DAY = 86400000;
export const DOCUMENT_WINDOW_MS = 30 * DAY;

/** Keep one current revision per document, never an unlimited revision history. */
export function documentBaseline(record, previous = {}, now = Date.now()) {
  if (record.documentsUnavailable) return structuredClone(previous);
  const fallback = calendarDay(record.date);
  return Object.fromEntries((record.documents || []).map(document => {
    const old = previous[document.id];
    const explicit = Date.parse(document.uploadedAt || '');
    const uploadedAt = Number.isFinite(explicit) && explicit <= now ? explicit
      : old && !old.ready && document.ready ? now : old?.uploadedAt || (fallback == null ? now : fallback * DAY);
    return [document.id,{...old,id:document.id,label:document.label,url:document.url || null,ready:document.ready,
      uploadedAt,watchUntil:Math.max(old?.watchUntil || 0,uploadedAt + DOCUMENT_WINDOW_MS)}];
  }));
}

export function shouldMonitorTir(record, previous, now = Date.now()) {
  const stage = submissionStage('tir',record.status);
  if (['rejected','cancelled','rollback'].includes(stage)) return false;
  if (!previous?.snapshot) return true;
  if (stage !== 'complete') return true;
  return Object.values(previous.documents || {}).some(document => document.ready && document.watchUntil > now);
}

export function observeDocumentBytes(previous, hash, now = Date.now()) {
  const changed = Boolean(previous.hash && previous.hash !== hash);
  return {...previous,hash,checkedAt:now,changed,watchUntil:changed ? now + DOCUMENT_WINDOW_MS : previous.watchUntil};
}
