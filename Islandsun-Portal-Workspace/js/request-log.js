const labels = new Map();
const MAX_LABELS = 600;

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
  const now = new Date();
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()].map(value => String(value).padStart(2, '0')).join(':');
  console.info(`${time} ${label}`);
}
