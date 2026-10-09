const WAIT_MESSAGES = Object.freeze({
  offline: 'The portal is unavailable. Saving is paused while the connection is checked.',
  startup: 'Waiting for browser activity checks to finish.',
  navigation: 'Waiting for an online portal tab to finish loading.',
  table: 'Saving is paused while you use a table or its results are loading.',
  settling: 'Waiting briefly for online navigation to settle.',
  editor: 'Saving is paused while a portal request editor is open.',
  recovery: 'Giving the portal time to recover after a failed request.',
  reading: 'Waiting for the current portal lookup to finish.',
  queued: 'Waiting for queued portal lookups to finish.',
  pacing: 'Waiting briefly between portal requests.',
});

/** Keep operational waiting data free of tab, account and record identifiers. */
export function archiveWaitState(value) {
  if (!value || !Object.hasOwn(WAIT_MESSAGES, value.reason)) return null;
  const result = {reason: value.reason};
  if (Number.isSafeInteger(value.until) && value.until > 0) result.until = value.until;
  return result;
}

export function archiveWaitMessage(value) {
  return WAIT_MESSAGES[archiveWaitState(value)?.reason]
    || 'Waiting for portal activity or an editing page to finish.';
}
