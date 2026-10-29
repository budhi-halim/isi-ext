import { createActivityLog } from './activity-log.js';
import { diagnosticLog } from './diagnostic-log.js';

const labels = new Map();
const MAX_LABELS = 600;
const results = createActivityLog('Live reads');
const PURPOSES = Object.freeze({hover:'hover preview',visible:'visible rows / request selector',warmup:'hover warm-up',notification:'notifications',archive:'offline archive',native:'foreground action'});
const REASONS = Object.freeze({baseline:'first check', 'status-change':'status changed', documents:'scheduled document recheck', retry:'retry', index:'list/status scan'});

function purposeText(purpose, reason) {
  return `${PURPOSES[purpose] || 'live lookup'}${REASONS[reason] ? ` — ${REASONS[reason]}` : ''}`;
}

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

export function logFetch(url, kind, number, {purpose, reason} = {}) {
  const label = extractNumber(number) || requestNumber(url);
  if (!label && !purpose) return;
  diagnosticLog('fetch-start',{kind,number:label,purpose,reason});
}

/** Fast successes stay quiet; failures and slow responses explain otherwise silent gaps. */
export function logFetchResult(url, kind, { number, outcome, status, durationMs, purpose, reason }) {
  if (outcome === 'complete' && durationMs < 4000 || outcome === 'cancelled') return;
  const label = extractNumber(number) || requestNumber(url);
  results.note(`${kind}:${label || ''}:${purpose || ''}:${reason || ''}:${outcome}:${status}`, `${label ? `${label} · ` : ''}${kind}: ${outcome}${status ? ` (HTTP ${status})` : ''}, ${(durationMs / 1000).toFixed(1)}s · for ${purposeText(purpose,reason)}.`);
}
