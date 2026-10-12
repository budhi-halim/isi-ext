import { activityTime, createActivityLog } from './activity-log.js';

const labels = new Map();
const MAX_LABELS = 600;
const results = createActivityLog('Live reads');

function extractNumber(label) {
  return String(label || '').match(/\b(?:[\dA-Z]+\/(?:[IVX]+|\d{1,2})\/(?:\d{4}|\d{2})\/(?:SRF(?:-ISI)?|SRS|SRI|SRJ|SD|TIR)|(?:SRF(?:-ISI)?|SRS|SRI|SRJ|SD|TIR)\/[\dA-Z]+\/(?:[IVX]+|\d{1,2})\/(?:\d{4}|\d{2}))(?:\/SYS)?\b/i)?.[0];
}

/** Retain only the displayed request number, never customer text or internal IDs. */
export function rememberRequestNumber(url, label) {
  const number = extractNumber(label);
  if (!number) return;
  labels.delete(String(url)); labels.set(String(url), number);
  while (labels.size > MAX_LABELS) labels.delete(labels.keys().next().value);
}

export function requestNumber(url) { return labels.get(String(url)); }

export function logFetch(url, kind, number) {
  const label = extractNumber(number) || requestNumber(url);
  if (!label) return;
  console.info(`${activityTime()} ${label} · fetching ${kind}`);
}

/** Fast successes stay quiet; failures and slow responses explain otherwise silent gaps. */
export function logFetchResult(url, kind, { number, outcome, status, durationMs }) {
  if (outcome === 'complete' && durationMs < 4000 || outcome === 'cancelled') return;
  const label = extractNumber(number) || requestNumber(url);
  results.note(`${kind}:${label || ''}:${outcome}:${status}`, `${label ? `${label} · ` : ''}${kind}: ${outcome}${status ? ` (HTTP ${status})` : ''}, ${(durationMs / 1000).toFixed(1)}s.`);
}
