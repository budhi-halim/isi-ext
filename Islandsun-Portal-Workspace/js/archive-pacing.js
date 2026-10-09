// === Adaptive Serial Archive Pacing ===

const GAPS = [1500,750,250];
const MODES = ['careful','steady','quick'];

/** Speed up only after sustained healthy reads; one slow response removes that credit. */
export function createArchivePacing() {
  let level = 0, healthy = 0, averageMs = 0;
  return {
    observe({elapsedMs,failed = false,interrupted = false}) {
      if (interrupted) { healthy = 0; return; }
      averageMs = averageMs ? averageMs * 0.75 + elapsedMs * 0.25 : elapsedMs;
      if (failed || elapsedMs >= 4000) { level = 0; healthy = 0; }
      else if (elapsedMs >= 2000 || averageMs >= 2000) { level = Math.max(0,level - 1); healthy = 0; }
      else if (elapsedMs < 1000 && averageMs < 1000) {
        if (++healthy >= 8) { level = Math.min(GAPS.length - 1,level + 1); healthy = 0; }
      } else healthy = 0;
    },
    state() {
      return {mode:MODES[level],gapMs:GAPS[level],cycleMs:level === 2 ? 30000 : 60000,averageMs:Math.round(averageMs)};
    },
  };
}
