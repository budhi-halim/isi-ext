// Keep background detail reads away from native request editors and their working state.
if (location.origin === 'http://apps.islandsunindonesia.com:81' && /\/(?:add|edit|create|update|getImprovement)[^/]*(?:\/|$)/i.test(location.pathname)) {
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
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.enabled) { version++; apply(changes.enabled.newValue); }
  });
  const initial = version;
  chrome.storage.local.get({ enabled: true })
    .then(saved => { if (version === initial) apply(saved.enabled); })
    .catch(() => { if (version === initial) apply(true); });
  window.addEventListener('pagehide', () => { active = false; release(); });
  window.addEventListener('pageshow', () => { active = true; connect(); });
}
