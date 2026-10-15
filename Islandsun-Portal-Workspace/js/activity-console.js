import { createActivityLog, activityTime } from './activity-log.js';
import { OFFLINE_STATUS } from './offline-config.js';
import { UPDATE_KEY, compareVersions, versionParts } from './shared/update-logic.js';
import { DIAGNOSTIC_FAILURES_KEY, sanitizeDiagnostic } from './connection-diagnostics.js';
import { logFetch, logFetchResult } from './request-log.js';

const HEALTH_KEY = 'islandsun.read-health';

/** Mirror worker queue and request status into the portal console without extra portal requests. */
export function createActivityConsole({ api = chrome, logger = createActivityLog, fetchStarted = logFetch, fetchFinished = logFetchResult } = {}) {
  const archive = logger('Offline saving'), recovery = logger('Read queue'), updates = logger('Updates'), failures = logger('Failures');
  const changedKeys = new Set();
  let disposed = false, failureAt = 0, checkedAt = 0, requestEvent;
  const keys = [OFFLINE_STATUS, HEALTH_KEY, UPDATE_KEY, DIAGNOSTIC_FAILURES_KEY];
  function accept(key, value, initial = false) {
    if (disposed || !value) return;
    if (key === OFFLINE_STATUS) {
      const request = value.lastRequest;
      const event = request && `${request.id}:${request.event}`;
      if (event && event !== requestEvent && /^archive-[a-z-]+$/.test(request.kind)) {
        requestEvent = event;
        if (!initial) {
          if (request.event === 'started') fetchStarted('',request.kind,request.number,{purpose:'archive'});
          else if (request.event === 'finished') fetchFinished('',request.kind,{...request,purpose:'archive'});
        }
      }
      if (value.hadOutage || value.state === 'offline') archive.pause('offline');
      else if (value.state === 'waiting') {
        if (value.wait?.reason !== 'pacing') archive.pause(value.wait?.reason || 'queued', value.wait?.until);
      } else if (value.state === 'active') archive.resume();
      else if (value.state === 'attention') archive.pause('retry');
      else archive.pause(value.state === 'paused' ? 'disabled' : value.state);
    } else if (key === HEALTH_KEY) {
      if (value.until > Date.now()) recovery.pause('recovery', value.until);
      else recovery.resume();
    } else if (key === UPDATE_KEY) {
      const own = api.runtime.getManifest().version;
      const latest = value.catalog?.workspace?.version;
      const result = versionParts(latest) ? `Installed ${own}; published ${latest}${compareVersions(latest, own) > 0 ? ' — update available' : ' — up to date'}.` : 'No verified release information yet.';
      const next = value.nextCheck ? ` Next check ${activityTime(value.nextCheck)}.` : '';
      if (value.status === 'unavailable') updates.pause('retry', value.nextCheck);
      else if (value.checkedAt) {
        updates.resume();
        if (value.checkedAt !== checkedAt) updates.note(`checked:${value.checkedAt}`, `${initial ? `Last check ${activityTime(value.checkedAt)}. ` : 'Feed checked. '}${result}${next}`);
        checkedAt = value.checkedAt;
      } else if (initial) updates.note('initial', `${result}${next}`);
    } else if (key === DIAGNOSTIC_FAILURES_KEY) {
      if (!Array.isArray(value)) return;
      if (initial) { failureAt = Math.max(0, ...value.map(item => Number(item.at) || 0)); return; }
      for (const item of Array.isArray(value) ? value : []) {
        const event = sanitizeDiagnostic(item);
        if (!event || item.at <= failureAt) continue;
        if (!event.kind.startsWith('archive-') && !['native-table', 'session-check', 'sales-row-lookup'].includes(event.kind)) continue;
        failures.note(`${event.kind}:${event.outcome}:${event.status}`, `${event.kind}: ${event.outcome}${event.status ? ` (HTTP ${event.status})` : ''}, ${(event.durationMs / 1000).toFixed(1)}s${event.stage ? `, ${event.stage}` : ''}.`);
      }
      failureAt = Math.max(failureAt, ...value.map(item => Number(item.at) || 0));
    }
  }
  const changed = (changes, area) => {
    if (area !== 'local') return;
    for (const [key, entry] of Object.entries(changes)) {
      if (!keys.includes(key)) continue;
      changedKeys.add(key); accept(key, entry.newValue);
    }
  };
  api.storage.onChanged.addListener(changed);
  void api.storage.local.get(keys).then(values => {
    for (const key of keys) if (!changedKeys.has(key)) accept(key, values[key], true);
  }).catch(() => {});
  return { destroy() {
    disposed = true; api.storage.onChanged.removeListener(changed);
    for (const log of [archive, recovery, updates, failures]) log.destroy();
  } };
}
