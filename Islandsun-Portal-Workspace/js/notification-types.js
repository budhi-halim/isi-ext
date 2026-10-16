/** Each silence key suppresses one category, never the whole record. */
export function notificationMuteKey(item) {
  if (!item?.key || item.type === 'update') return undefined;
  if (item.muteKey) return item.muteKey;
  return `${item.key}:${item.type}${item.documentId ? `:${item.documentId}` : ''}`;
}

export function silenceDescription(item) {
  if (item.type === 'unsubmitted') return `Stop reminders to submit ${item.number}? Other notifications for this request will remain enabled.`;
  if (item.type === 'overdue') return 'Stop overdue reminders for this document or sample request? Readiness, completion and status-change notifications will remain enabled.';
  return 'Stop this type of notification for this request on this browser? Other notification types will remain enabled.';
}
