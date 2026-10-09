const DAY = 86400000;
const RETRY = 300000;

export function reportingMonth(now = Date.now()) {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit'}).format(new Date(now));
}

/** Use only periods offered by the authenticated source, including its future months. */
export function sourcePeriods(years,months) {
  if (!years.length || !months.length || years.some(year=>!/^\d{4}$/.test(year)||Number(year)<1) || months.some(month=>!/^(0[1-9]|1[0-2])$/.test(month))) throw new Error('The reporting periods were not recognized.');
  return [...new Set(years.flatMap(year=>months.map(month=>`${year}-${month}`)))].sort().reverse();
}

/** Refresh recent periods while giving each unvisited historical period a turn. */
export function nextPeriod(meta,now = Date.now()) {
  if (!meta?.periods?.length || now-(meta.periodsDiscoveredAt || 0)>=DAY) return {discover:true};
  const current = reportingMonth(now);
  const previous = new Date(`${current}-01T00:00:00Z`); previous.setUTCMonth(previous.getUTCMonth()-1);
  const recent = new Set([current,previous.toISOString().slice(0,7)]);
  const states = meta.periodStates || {};
  const eligible = meta.periods.filter(period=>{
    const state = states[period] || {};
    return now-(state.attemptedAt || 0)>=RETRY && (!state.checkedAt || now-state.checkedAt >= (recent.has(period)||state.pendingDates ? RETRY : DAY));
  });
  // A source may get its next turn after the current month is already due again.
  // Alternate that refresh with backlog work instead of repeatedly selecting it.
  const latestOtherAttempt = Math.max(0,...Object.entries(states).filter(([period])=>period!==current).map(([,state])=>state.attemptedAt || 0));
  const refreshCurrent = (states[current]?.attemptedAt || 0) <= latestOtherAttempt;
  eligible.sort((a,b)=>Number(refreshCurrent && b===current)-Number(refreshCurrent && a===current)
    || Number(!refreshCurrent && a===current)-Number(!refreshCurrent && b===current)
    || Number(!!states[a]?.checkedAt)-Number(!!states[b]?.checkedAt)
    || (states[a]?.attemptedAt || 0)-(states[b]?.attemptedAt || 0) || b.localeCompare(a));
  return eligible.length ? {period:eligible[0]} : null;
}

export function periodCoverage(meta) {
  const states = (meta.periods || []).map(period=>meta.periodStates?.[period] || {});
  return {total:states.reduce((sum,state)=>sum+(state.total || 0),0),pendingDates:states.reduce((sum,state)=>sum+(state.pendingDates || 0),0),periodCount:states.length,
    periodsSaved:states.filter(state=>state.checkedAt).length,partial:states.some(state=>!state.checkedAt || state.pendingDates)};
}
