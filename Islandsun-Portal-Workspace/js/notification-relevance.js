const SUBMISSION_WARNINGS = new Set(['rollback', 'rejected', 'cancelled']);

/** Remove superseded notices from a writable state snapshot without retaining a history. */
export function pruneNotificationState(state) {
  const latestWarnings = new Map();
  for (const notice of Object.values(state.notices)) {
    if (!SUBMISSION_WARNINGS.has(notice.type)) continue;
    const completion = state.notices[`${notice.key}:complete`];
    if (state.submissions?.[notice.key]?.confirmed || state.jobs[notice.key] || completion?.created >= notice.created) {
      delete state.notices[notice.id];
      continue;
    }
    const previous = latestWarnings.get(notice.key);
    if (!previous || notice.created >= previous.created) latestWarnings.set(notice.key, notice);
  }
  for (const [id, notice] of Object.entries(state.notices)) {
    const pending = state.jobs[notice.key]?.pending;
    if (notice.type === 'overdue') {
      const subject = notice.muteKey === notice.key ? 'sample' : notice.muteKey?.slice(notice.key.length + 1);
      const tracked = pending?.[subject];
      if (!tracked || state.muted[notice.muteKey] || notice.week < tracked.lastWeek) delete state.notices[id];
    } else if (notice.type === 'ready') {
      const subject = notice.documentId ?? id.slice(notice.key.length + 1, -':ready'.length);
      if (!pending || pending[subject] || latestWarnings.has(notice.key)) delete state.notices[id];
    } else if (notice.type === 'complete') {
      if ((pending && Object.keys(pending).length) || latestWarnings.has(notice.key)) delete state.notices[id];
    } else if (SUBMISSION_WARNINGS.has(notice.type)) {
      if (latestWarnings.get(notice.key) !== notice || state.submissions?.[notice.key]?.confirmed) delete state.notices[id];
    }
  }
  return state;
}

/** Clear only obsolete messages belonging to this record and these lifecycle categories. */
export function discardRecordNotices(state, key, types) {
  for (const [id, notice] of Object.entries(state.notices)) {
    if (notice.key === key && types.includes(notice.type)) delete state.notices[id];
  }
}
