export function createOverlay({ cancel, closed }) {
  const previousFocus = document.activeElement;
  const host = document.createElement('islandsun-feedback');
  const shadow = host.attachShadow({ mode: 'open' });
  const asset = path => chrome.runtime.getURL(path);
  for (const path of ['assets/family/css/tokens.css', 'assets/family/css/components.css', 'css/overlay.css']) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = asset(path);
    shadow.append(link);
  }
  const shell = document.createElement('div');
  shell.className = 'isi-theme isi-ui feedback-backdrop';
  // Static markup only; all portal data and messages are assigned with textContent.
  shell.innerHTML = `<section class="feedback-panel" role="dialog" aria-modal="true" aria-labelledby="feedback-title" tabindex="-1">
    <header><img width="40" height="40" alt=""><h1 id="feedback-title">AutoFeedback</h1><span class="isi-badge" data-state-label>Running</span></header>
    <div class="feedback-status"><p role="status" data-message>Preparing feedback…</p><progress max="100" aria-label="Feedback progress"></progress></div>
    <iframe title="Company feedback form"></iframe>
    <footer><p class="isi-muted" data-note>Keep this tab open while feedback is processed.</p><button type="button" class="isi-button" data-action>Stop</button></footer>
  </section>`;
  shell.querySelector('img').src = asset('assets/family/assets/icons/feedback.svg');
  shadow.append(shell);
  document.body.append(host);
  const inert = new Map();
  for (const sibling of document.body.children) {
    if (sibling !== host) { inert.set(sibling, sibling.inert); sibling.inert = true; }
  }
  const action = shadow.querySelector('[data-action]');
  const frame = shadow.querySelector('iframe');
  const panel = shadow.querySelector('.feedback-panel');
  let terminal = false;
  let destroyed = false;
  const click = () => { if (terminal) destroy(); else { action.disabled = true; cancel(); } };
  const keydown = event => {
    if (event.key === 'Escape') { event.preventDefault(); click(); }
    if (event.key === 'Tab') {
      if (terminal) { event.preventDefault(); action.focus(); return; }
      // The company iframe manages its own form focus; the action remains reachable on exit.
      if (shadow.activeElement === action && !event.shiftKey) { event.preventDefault(); (terminal ? action : frame).focus(); }
      else if (shadow.activeElement === frame && event.shiftKey) { event.preventDefault(); action.focus(); }
    }
  };
  action.addEventListener('click', click);
  shadow.addEventListener('keydown', keydown);
  action.focus();

  function render(job) {
    if (destroyed) return;
    terminal = !['starting', 'running', 'cancelling'].includes(job.state);
    panel.dataset.state = job.state;
    shadow.querySelector('[data-message]').textContent = job.message;
    shadow.querySelector('[data-state-label]').textContent = { running: 'Running', cancelling: 'Stopping', completed: 'Complete', failed: 'Stopped', cancelled: 'Cancelled' }[job.state] || 'Preparing';
    const progress = shadow.querySelector('progress');
    if (job.total > 0) progress.value = job.completed / job.total * 100;
    else if (terminal) progress.value = job.state === 'completed' ? 100 : 0;
    else progress.removeAttribute('value');
    if (terminal) {
      frame.remove();
      action.disabled = false;
      action.textContent = 'Close';
      shadow.querySelector('[data-note]').textContent = job.state === 'completed' ? 'You can start another run from the extension.' : 'Already submitted feedback is retained. Check the company system before retrying.';
      action.focus();
    }
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    action.removeEventListener('click', click);
    shadow.removeEventListener('keydown', keydown);
    host.remove();
    for (const [element, value] of inert) if (element.isConnected) element.inert = value;
    if (previousFocus?.isConnected) previousFocus.focus();
    closed();
  }
  return { frame, render, destroy };
}
