import { fetchPortal, readPortalItems, sampleListUrl, localDate, PORTAL_ROOT, SessionExpiredError } from './shared/portal-session.js';
import { selectRequests, requestId } from './logic.js';

export function pause(milliseconds, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const finish = () => { signal.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(finish, milliseconds);
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
  });
}

export function frameDocument(frame) {
  let doc;
  try { doc = frame.contentDocument; } catch { throw new Error('The feedback page could not be accessed. Check your company session.'); }
  if (!doc) throw new Error('The feedback page could not be accessed. Check your company session.');
  if (/\/login(?:\/|\?|$)/i.test(doc.URL) || doc.querySelector('input[type="password"]')) throw new SessionExpiredError();
  return doc;
}

export function waitForFrame(frame, navigate, signal, timeout = 60000) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); frame.removeEventListener('load', loaded); signal.removeEventListener('abort', aborted); };
    const loaded = () => {
      try {
        const doc = frameDocument(frame);
        if (doc.URL === 'about:blank' && frame.src !== 'about:blank') return;
        cleanup();
        resolve(doc);
      } catch (error) { cleanup(); reject(error); }
    };
    const aborted = () => { cleanup(); reject(signal.reason); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('The feedback page took too long to respond. Check saved feedback before trying again.')); }, timeout);
    frame.addEventListener('load', loaded);
    signal.addEventListener('abort', aborted, { once: true });
    try { navigate(); } catch (error) { cleanup(); reject(error); }
  });
}

async function waitForField(frame, condition, signal) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const result = condition(frameDocument(frame));
    if (result) return result;
    await pause(250, signal);
  }
  throw new Error('The feedback form took too long to respond. Check saved feedback before trying again.');
}

function requireElement(doc, selector) {
  const element = doc.querySelector(selector);
  if (!element) throw new Error('The feedback form is missing a required control. No further forms will be submitted.');
  return element;
}

function changeValue(element, value) {
  element.value = value;
  element.dispatchEvent(new element.ownerDocument.defaultView.Event('change', { bubbles: true }));
}

export async function runAutomation({ settings, frame, signal, report, now = new Date() }) {
  const today = localDate(now);
  report({ message: 'Finding pending sample requests…', total: 0, completed: 0 });
  const items = await readPortalItems(await fetchPortal(sampleListUrl('2018-01-01', today), signal));
  const targets = selectRequests(items, settings, now);
  // Validate all identifiers before any form is submitted.
  targets.forEach(item => requestId(item.sr_id));
  let completed = 0;
  const reportStep = message => report({ message, total: targets.length, completed });
  for (const request of targets) {
    signal.throwIfAborted();
    reportStep(`Opening request ${completed + 1} of ${targets.length}…`);
    const url = new URL('FeedBack/addFeedBack', PORTAL_ROOT);
    url.searchParams.set('sr_id', requestId(request.sr_id));
    await waitForFrame(frame, () => { frame.src = url.href; }, signal);
    await pause(1000, signal);
    const doc = frameDocument(frame);
    const addButtons = [...doc.querySelectorAll('button[onclick^="addData"]')];
    requireElement(doc, '#simpan_btn');
    for (const [index, button] of addButtons.entries()) {
      signal.throwIfAborted();
      button.scrollIntoView({ block: 'center', behavior: 'instant' });
      await pause(500, signal);
      button.click();
      reportStep(`Request ${completed + 1} of ${targets.length} · filling item ${index + 1} of ${addButtons.length}…`);
      await waitForField(frame, current => {
        const field = current.getElementById('tanggal_terima_sample');
        return field && field.offsetParent !== null;
      }, signal);
      const current = frameDocument(frame);
      const date = requireElement(current, '#tanggal_terima_sample');
      const komentar = requireElement(current, '#komentar');
      const conclusion = requireElement(current, 'input[name="kesimpulan"][value="Tidak ok perlu improvement"]');
      const saran = requireElement(current, '#saran');
      const add = requireElement(current, 'button[onclick="submitdataNew()"]');
      changeValue(date, today);
      changeValue(komentar, settings.komentar);
      conclusion.click();
      conclusion.checked = true;
      conclusion.dispatchEvent(new current.defaultView.Event('change', { bubbles: true }));
      changeValue(saran, settings.saran);
      await pause(800, signal);
      signal.throwIfAborted();
      add.click();
      await waitForField(frame, current => {
        const field = current.getElementById('tanggal_terima_sample');
        return !field || field.offsetParent === null;
      }, signal);
      await pause(500, signal);
    }
    reportStep(`Saving request ${completed + 1} of ${targets.length}…`);
    const save = requireElement(frameDocument(frame), '#simpan_btn');
    save.scrollIntoView({ block: 'center', behavior: 'instant' });
    await pause(500, signal);
    // Register before clicking: a fast response must not race the load listener.
    await waitForFrame(frame, () => { signal.throwIfAborted(); save.click(); }, signal);
    completed++;
  }
  return { completed, total: targets.length, message: targets.length ? `Completed ${completed} sample requests.` : `No pending requests older than ${settings.days} days.` };
}
