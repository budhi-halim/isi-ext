// Keep background detail reads away from native request editors and their working state.
if (['http://apps.islandsunindonesia.com:81', 'http://192.168.0.22:81'].includes(location.origin) && /\/(?:add|edit|create|update|getImprovement)[^/]*(?:\/|$)/i.test(location.pathname)) {
  let enabled = false, active = true, port, retry, version = 0;
  function release() { clearTimeout(retry); const previous = port; port = null; previous?.disconnect(); }
  function connect() {
    if (!enabled || !active || port) return;
    try {
      const current = chrome.runtime.connect({ name: 'islandsun-editor-guard' }); port = current;
      current.onDisconnect.addListener(() => {
        if (port !== current) return;
        port = null;
        if (enabled && active) retry = setTimeout(connect, 1000);
      });
    } catch { release(); }
  }
  function apply(value) { enabled = value !== false; if (enabled) connect(); else release(); }
  function inspectMode() {
    const forms = [...document.querySelectorAll('.content-wrapper form[data-isi-read-only]')];
    active = !forms.length || forms.some(form => form.dataset.isiReadOnly !== 'true');
    if (active) connect(); else release();
  }
  function observeMode() {
    new MutationObserver(inspectMode).observe(document.documentElement,{subtree:true,attributes:true,attributeFilter:['data-isi-read-only']});
    inspectMode();
  }
  if (document.documentElement) observeMode(); else document.addEventListener('DOMContentLoaded',observeMode,{once:true});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.enabled) { version++; apply(changes.enabled.newValue); }
  });
  const initial = version;
  chrome.storage.local.get({ enabled: true })
    .then(saved => { if (version === initial) apply(saved.enabled); })
    .catch(() => { if (version === initial) apply(true); });
  window.addEventListener('pagehide', () => { active = false; release(); });
  window.addEventListener('pageshow', inspectMode);
}
