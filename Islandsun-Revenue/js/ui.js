import { advanceProgress } from './kinematics.js';

export function createRevenueUI() {
  const find = id => document.getElementById(id);
  const bar = find('progress-bar');
  const percent = find('percent-label');
  const meter = find('progress-meter');
  const status = find('status-text');
  const consoleArea = find('console-area');
  const progress = { target: 0, visual: 0, speed: 0 };
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0;
  let previousVisual = -1;
  let previousInteger = -1;
  let running = false;
  let destroyed = false;

  function render() {
    if (progress.visual !== previousVisual) {
      bar.style.width = `${progress.visual}%`;
      previousVisual = progress.visual;
    }
    const integer = Math.floor(progress.visual);
    if (integer !== previousInteger) {
      percent.textContent = `${integer}%`;
      meter.setAttribute('aria-valuenow', String(integer));
      previousInteger = integer;
    }
  }
  function animate() {
    if (destroyed) return;
    if (reducedMotion.matches) progress.visual = progress.target;
    else advanceProgress(progress);
    render();
    frame = requestAnimationFrame(animate);
  }
  function setProgress(value, reset = false) {
    if (reset) Object.assign(progress, { target: 0, visual: 0, speed: 0 });
    progress.target = Math.max(progress.target, Math.min(100, value));
    render();
  }
  function setPhaseState(value) {
    for (const [index, element] of [find('step-one'), find('step-two')].entries()) {
      const step = index + 1;
      element.dataset.state = value > step ? 'complete' : value === step ? 'active' : 'idle';
      if (value === step) element.setAttribute('aria-current', 'step');
      else element.removeAttribute('aria-current');
    }
    find('step-line').dataset.state = value === 3 ? 'complete' : value === 2 ? 'active' : 'idle';
    bar.dataset.complete = String(value === 3);
    meter.setAttribute('aria-label', value === 2 ? 'Sales data progress' : 'Delivery records progress');
  }
  function log(message, tone = 'info', append = true) {
    if (status.textContent !== message) status.textContent = message;
    if (!append) return;
    const follow = consoleArea.scrollHeight - consoleArea.clientHeight <= consoleArea.scrollTop + 15;
    const row = document.createElement('div');
    const time = document.createElement('span');
    time.className = 'log-time';
    time.textContent = `[${new Date().toLocaleTimeString()}] `;
    const text = document.createElement('span');
    text.className = `log-${['success', 'warn'].includes(tone) ? tone : 'info'}`;
    text.textContent = message;
    row.append(time, text);
    consoleArea.append(row);
    if (follow && find('activity-log').open) consoleArea.scrollTop = consoleArea.scrollHeight;
  }
  function setRunning(value) {
    running = value;
    document.body.dataset.extractionState = value ? 'running' : 'idle';
    find('start-button').disabled = value;
    find('start-month').disabled = value;
    find('end-month').disabled = value;
    find('start-button-label').textContent = value ? 'Extracting…' : 'Begin Extraction';
    find('start-spinner').hidden = !value;
    bar.dataset.active = String(value);
    find('start-button').setAttribute('aria-busy', String(value));
  }
  async function waitForCompletion(signal) {
    while (progress.visual < 100) {
      signal?.throwIfAborted();
      // Hidden-tab throttling must never hold the completed scan or workbook hostage.
      if (document.hidden || reducedMotion.matches) { progress.visual = progress.target; render(); break; }
      await new Promise(resolve => setTimeout(resolve, 40));
    }
  }
  const disclosure = find('activity-log');
  const followLog = () => { if (disclosure.open) consoleArea.scrollTop = consoleArea.scrollHeight; };
  disclosure.addEventListener('toggle', followLog);
  frame = requestAnimationFrame(animate);
  return {
    setProgress, setPhaseState, log, setRunning, waitForCompletion,
    reset() { consoleArea.replaceChildren(); setProgress(0, true); setPhaseState(0); },
    get running() { return running; },
    destroy() { destroyed = true; cancelAnimationFrame(frame); disclosure.removeEventListener('toggle', followLog); }
  };
}
