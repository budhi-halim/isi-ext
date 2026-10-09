/** A failed record/file read cannot establish that the whole portal is down. */
export function archiveFailure(error, checkingConnection) {
  if (error.code === 'OFFLINE_LOCKED') return {state:'unlock-required',error:'Unlock this account’s offline copy to resume saving.'};
  if (error.code === 'SIGNED_OUT') return { state: 'signed-out', error: 'Sign in to continue saving offline records.' };
  if (error.name === 'TimeoutError' || error instanceof TypeError && /fetch|network/i.test(error.message)
    || checkingConnection && error.status >= 500) return {
    state:'offline',error:'The portal connection could not be confirmed. Saved records remain available.',
  };
  const sourceFailure = error.code === 'ARCHIVE_DATA'
    || ['QuotaExceededError', 'UnknownError', 'InvalidStateError'].includes(error.name)
    || /storage|archive/i.test(error.message);
  if (sourceFailure) return { state: 'attention', error: error.message };
  if (!checkingConnection) return {
    state: 'attention',
    error: 'A background request did not finish. Saving will retry after a pause; the previous copy is retained.',
  };
  return { state: 'offline', error: 'The portal connection could not be confirmed. Saved records remain available.' };
}

/** An outage remains authoritative until a subsequent connection probe succeeds. */
export function connectionUpdate(saved, values, verified, now = Date.now()) {
  const next = {...saved,...values};
  if (values.state === 'offline') return {...next,hadOutage:true,recoveredAt:0,connectedAt:0};
  if (verified) return {...next,hadOutage:false,connectedAt:now,recoveredAt:saved.hadOutage ? now : saved.recoveredAt || 0};
  if (saved.hadOutage && values.state && values.state !== 'paused') {
    next.state = 'offline'; next.error = saved.error; next.wait = null;
  }
  return next;
}

/** Historical recovery timestamps are a baseline, never a notification on page opening. */
export function createRecoveryObservation() {
  let initialized = false, latest = 0;
  return next => {
    const at = Number(next.recoveredAt) || 0;
    const recovered = initialized && at > latest && !next.hadOutage && next.connectedAt >= at;
    latest = Math.max(latest,at); initialized = true;
    return recovered;
  };
}
