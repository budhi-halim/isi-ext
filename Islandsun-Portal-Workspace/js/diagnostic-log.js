/** Best-effort structured events never interrupt the user's operation. */
export function diagnosticLog(event, fields = {}) {
  try { globalThis.chrome?.runtime?.sendMessage({ type: 'diagnostic-event', event, fields }).catch(() => {}); }
  catch { /* A closing page can no longer send diagnostic events. */ }
}
