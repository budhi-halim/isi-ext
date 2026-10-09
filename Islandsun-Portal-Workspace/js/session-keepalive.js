import { readAccountSettings, accountSettingsChanged } from './account-settings.js';
import { ACCOUNT_SCOPE } from './account-scope.js';
import { connectionFailure } from './connection-diagnostics.js';
export const SESSION_KEY = 'islandsun.session-keepalive';
export const SESSION_ALARM = 'islandsun-session-keepalive';
export const SESSION_INTERVAL = 5 * 60000;
const PORTAL_ROOT = 'http://apps.islandsunindonesia.com:81/islandsun/';

/** Refresh only the existing protected home session; never enter credentials or a record editor. */
export async function refreshSession(signal, fetcher = fetch) {
  const response = await fetcher(PORTAL_ROOT, { credentials: 'include', cache: 'no-store', redirect: 'manual', signal });
  try {
    if (response.type === 'opaqueredirect' || response.status >= 300 && response.status < 400) throw Object.assign(new Error('The portal session check redirected.'),{code:'SESSION_REDIRECT',status:response.status});
    const destination = new URL(response.url || PORTAL_ROOT);
    if ([401,403].includes(response.status) || /\/login(?:\/|$)/i.test(destination.pathname)) return 'signed-out';
    if (!response.ok || destination.origin !== new URL(PORTAL_ROOT).origin || !destination.pathname.startsWith('/islandsun/')) {
      throw Object.assign(new Error('The portal session check is unavailable.'),{status:response.status});
    }
    // Consume no dashboard data. Cancel the response body to release its connection promptly.
    return 'active';
  } finally { await response.body?.cancel(); }
}

export function createSessionKeepAlive({ storage, runCheck, pulse, now = Date.now, check = refreshSession, readSettings = () => storage.local.get({enabled:true,keepSessionAlive:true}) }) {
  let running = false, controller, generation = 0;
  async function tick() {
    if (running) return;
    running = true;
    const current = generation;
    try {
      const settings = await readSettings();
      if (current !== generation || !settings.enabled || !settings.keepSessionAlive) return;
      const saved = (await storage.session.get(SESSION_KEY))[SESSION_KEY] || {};
      if (saved.state === 'signed-out') return;
      await pulse();
      if (current !== generation) return;
      if (Number.isFinite(saved.nextCheck) && saved.nextCheck > now() && saved.nextCheck <= now() + SESSION_INTERVAL) return;
      controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]);
      const outcome = await runCheck(async () => {
        await storage.session.set({[SESSION_KEY]: {...saved, state: 'checking', attemptedAt: now()}});
        signal.throwIfAborted();
        return check(signal);
      });
      if (current !== generation || controller.signal.aborted) return;
      if (outcome.deferred) {
        await storage.session.set({[SESSION_KEY]: {...saved, state: 'deferred', attemptedAt: now(), nextCheck: now() + 60000}});
        return;
      }
      await storage.session.set({[SESSION_KEY]: {
        state: outcome.result, checkedAt: now(), nextCheck: now() + SESSION_INTERVAL,
      }});
    } catch (error) {
      if (current === generation && !controller?.signal.aborted) await storage.session.set({[SESSION_KEY]: {state:'retrying', checkedAt:now(), nextCheck:now()+60000}}).catch(()=>{});
    } finally { controller = null; running = false; }
  }
  return {
    tick,
    cancel() { generation++; controller?.abort(); },
    async resume() {
      const interrupted = running;
      const current = ++generation;
      controller?.abort();
      const saved = (await storage.session.get(SESSION_KEY))[SESSION_KEY];
      if (current !== generation) return;
      if (interrupted || !saved || saved.state === 'signed-out') await storage.session.set({[SESSION_KEY]:{state:'waiting',nextCheck:0}});
    },
  };
}

export function startSessionKeepAlive(gate, diagnostics, debug) {
  let configuration = 0;
  const service = createSessionKeepAlive({
    storage: chrome.storage,
    readSettings: async () => { const value = await readAccountSettings(); return {...value,keepSessionAlive:Boolean(value.account) && value.keepSessionAlive}; },
    check: signal=>refreshSession(signal,debug ? (url,options)=>debug.fetch(url,options,{kind:'session-check',timeoutMs:8000}) : fetch),
    runCheck: check => gate.runSessionCheck(async () => {
      const started = Date.now();
      const record = (outcome,status = 0) => diagnostics?.append({kind:'session-check',outcome,status,durationMs:Date.now()-started}).catch(() => {});
      record('started');
      try {
        const result = await check();
        record(result === 'signed-out' ? 'sign-in-required' : 'complete');
        return result;
      } catch (error) {
        record(connectionFailure(error),error.status || 0);
        throw error;
      }
    }),
    pulse: async () => {
      const tabs = await chrome.tabs.query({url:'http://apps.islandsunindonesia.com/islandsun/*'});
      await Promise.allSettled(tabs.filter(tab=>{
        try {return new URL(tab.url).origin===new URL(PORTAL_ROOT).origin;} catch {return false;}
      }).map(tab=>chrome.tabs.sendMessage(tab.id,{type:'portal-session-pulse'})));
    },
  });
  async function configure() {
    const current = ++configuration;
    const settings = await readAccountSettings();
    if (current !== configuration) return;
    if (!settings.enabled || !settings.account || !settings.keepSessionAlive) { service.cancel(); await chrome.alarms.clear(SESSION_ALARM); return; }
    const alarm = await chrome.alarms.get(SESSION_ALARM);
    if (current === configuration && !alarm) await chrome.alarms.create(SESSION_ALARM,{delayInMinutes:1,periodInMinutes:1});
  }
  chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name===SESSION_ALARM) service.tick();});
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area==='local' && accountSettingsChanged(changes)) {
      service.cancel();
      const scope = changes[ACCOUNT_SCOPE];
      const reset = scope && scope.oldValue?.account !== scope.newValue?.account
        ? chrome.storage.session.set({[SESSION_KEY]:{state:scope.newValue?.account ? 'waiting' : 'signed-out',nextCheck:0}})
        : Promise.resolve();
      reset.then(configure).catch(()=>{});
    }
  });
  chrome.runtime.onMessage.addListener((message,sender)=>{
    if(message?.type!=='portal-session-active') return;
    try { if(new URL(sender.url).origin!==new URL(PORTAL_ROOT).origin) return; } catch {return;}
    service.resume().catch(()=>{});
  });
  chrome.runtime.onStartup.addListener(()=>configure().catch(()=>{}));
  configure().catch(()=>{});
}
