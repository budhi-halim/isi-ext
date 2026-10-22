/** Preserve full record details in history while using a brief toast summary. */
export function notificationText(item, { compact = false } = {}) {
  const message = String(item.message || '').replace(/\s+Open the request to check (?:their|its) status\.?$/i, '').trim();
  if (!compact) return message;
  const number = String(item.number || '');
  const detail = number && message.startsWith(`${number}:`) ? message.slice(number.length + 1).trim() : message;
  const label = value => value.replace(/^General Product Spe(?:ci|si)fication$/i, 'Product specification')
    .replace(/^Halal Certification$/i, 'Halal certificate')
    .replace(/^Material Safety Data Sheet$/i, 'Safety data sheet');
  let summary;
  if (item.type === 'overdue') {
    const match = /^(.*?) (?:has|have) been waiting (\d+) days\.$/i.exec(detail);
    if (match) summary = `${label(match[1]).replace(/^samples$/i, 'Samples').replace(/^documents$/i, 'Documents')} pending · ${match[2]} days`;
  } else if (item.type === 'unsubmitted') summary = 'Awaiting submission';
  else if (item.type === 'rollback') {
    const match = /^returned to (Pending|Draft) after submission/i.exec(detail);
    if (match) summary = `Returned to ${match[1]}`;
  } else if (item.type === 'complete') summary = 'All documents ready';
  else if (item.type === 'rejected') summary = 'Rejected';
  else if (item.type === 'cancelled') summary = 'Cancelled';
  else if (item.type === 'ready' || item.type === 'document-changed') {
    const match = /^(.*?) (?:is ready|was replaced)\.$/i.exec(detail);
    if (match) summary = `${label(match[1])} ${item.type === 'ready' ? 'ready' : 'replaced'}`;
  } else if (item.type === 'update') {
    return message.replace(/^Islandsun /, '').replace(/: version ([\d.]+) is available\.$/, ' $1 available');
  }
  return summary && number ? `${number} · ${summary}` : message;
}
