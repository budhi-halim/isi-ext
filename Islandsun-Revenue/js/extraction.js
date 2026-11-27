import { DEFAULT_PORTAL_ORIGIN, rebasePortalUrl } from './shared/portal-address.js';
import { fetchPortal, isTransientPortalError, pause, readRecord } from './portal.js';
import { createDateTrend } from './trend.js';
import { extractData, getSoMagnitude } from './records.js';
import { findSalesOrder } from './search.js';

export async function runCoreScraper({ startMonthVal, endMonthVal, latestDO: LATEST_DO_ID, latestSO: LATEST_SO_ID, signal, ui, origin = DEFAULT_PORTAL_ORIGIN, checkpoint, checkpoints }) {
  const { setProgress, setPhaseState, log, waitForCompletion } = ui;
  const root = rebasePortalUrl(`${DEFAULT_PORTAL_ORIGIN}/islandsun/`, origin);
  const fetch = url => fetchPortal(url, signal);
  const trend = createDateTrend();
  const doBaseUrl = `${root}NewDo/detailDO/`;
  const soBaseUrl = `${root}sales-order/edit/`;

  let [sYear, sMonth] = startMonthVal.split("-");
  let [eYear, eMonth] = endMonthVal.split("-");

  function getFormattedDate(y, m, d) {
    const dt = new Date(y, m, d);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  }

  const targetStartDate = getFormattedDate(sYear, sMonth - 1, 1);
  const targetEndDate = getFormattedDate(eYear, eMonth, 0);
  const safetyNetDate = getFormattedDate(sYear, sMonth - 3, 1);

  const endMs = Date.parse(targetEndDate);
  const startMs = Date.parse(safetyNetDate);
  const totalTimeRangeMs = endMs - startMs;

  setProgress(0, true);
  if (checkpoint.phase === 'deliveries') {
    setPhaseState(1);
    log('Reading deliveries from ' + targetStartDate + ' to ' + targetEndDate + '.', 'info');
  } else {
    setPhaseState(2);
    log('Delivery scan already saved; restoring sales-order progress.', 'info');
  }

  let currentDelay = 400;
  const MIN_DELAY = 100, MAX_DELAY = 30000;

  async function dynamicFetch(url) {
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const started = performance.now();
      try {
        const response = await fetch(url);
        const latency = performance.now() - started;
        if (response.ok) {
          if (latency < 200) currentDelay = Math.max(MIN_DELAY, currentDelay - 50);
          else if (latency > 800) currentDelay = Math.min(MAX_DELAY, currentDelay + 200);
        }
        await pause(currentDelay, signal);
        return response;
      } catch (error) {
        signal.throwIfAborted();
        if (!isTransientPortalError(error) || attempt === maxAttempts) throw error;
        currentDelay = Math.min(MAX_DELAY, Math.max(800, currentDelay * 2));
        const cause = error.status ? 'HTTP ' + error.status
          : error.name === 'TimeoutError' ? 'request timed out' : 'temporary network failure';
        log('Request failed (' + cause + '). Retrying ' + attempt + '/' + (maxAttempts - 1) + '…', 'warn');
        await pause(currentDelay, signal);
      }
    }
  }

  let currentDO = checkpoint.nextDO;
  const targetSOs = new Set(checkpoint.targets || []);
  let emptyDoCount = checkpoint.emptyDoCount || 0;
  let historicalStreak = checkpoint.historicalStreak || 0;
  let maxProgressSeen = checkpoint.deliveryProgress || 0;
  let checkedSinceSave = 0;

  if (checkpoint.phase === 'deliveries') {
    if (currentDO < LATEST_DO_ID) log('Resuming delivery scan at record #' + currentDO + '.', 'info');
    setProgress(maxProgressSeen);
    while (currentDO > 0) {
    try {
      const res = await dynamicFetch(doBaseUrl + currentDO);
      if (res.ok) {
        const html = await readRecord(res);
        const doc = new DOMParser().parseFromString(html, "text/html");
        const dateEl = doc.querySelector('#do_tgl_kirim');

        if (dateEl && dateEl.value) {
          const tgl = dateEl.value.trim();
          emptyDoCount = 0;

          const estimate = trend.observe(tgl);
          let calculatedProgress = null;
          if (estimate.changed && estimate.acceptedMs <= endMs && estimate.acceptedMs >= startMs) {
            calculatedProgress = ((endMs - estimate.acceptedMs) / totalTimeRangeMs) * 100;
            maxProgressSeen = Math.max(maxProgressSeen, Math.min(99, calculatedProgress));
            setProgress(maxProgressSeen);
          }

          if (tgl.startsWith("1970") || tgl.startsWith("0000") || tgl === "") {
          } else if (tgl > targetEndDate) {
            historicalStreak = 0;
          } else if (tgl >= targetStartDate && tgl <= targetEndDate) {
            historicalStreak = 0;
            log(`Delivery found for ${tgl}.`, 'success');
            const links = doc.querySelectorAll('#detail_srf a');
            links.forEach(link => {
              const text = link.innerText.trim();
              if (text.includes('/ISI/')) targetSOs.add(text);
            });
          } else if (tgl > safetyNetDate && tgl < targetStartDate) {
            historicalStreak = 0;
            const appendProgress = currentDO % 15 === 0;
            log('Checking earlier deliveries…', 'info', appendProgress);
          } else if (tgl <= safetyNetDate) {
            historicalStreak++;
            if (historicalStreak > 25) {
              log('Delivery check complete.', 'info');
              break;
            }
          }
        } else {
          trend.observe(null);
          emptyDoCount++;
          if (emptyDoCount > 150) {
            throw new Error('Delivery records could not be verified.');
          }
        }
      } else trend.observe(null);
    } catch (err) {
      signal.throwIfAborted();
      throw err;
    }
    currentDO--;
    checkpoint.nextDO = currentDO;
    if (++checkedSinceSave >= 15) {
      checkpoint.targets = Array.from(targetSOs);
      checkpoint.emptyDoCount = emptyDoCount;
      checkpoint.historicalStreak = historicalStreak;
      checkpoint.deliveryProgress = maxProgressSeen;
      await checkpoints.saveCheckpoint(checkpoint);
      checkedSinceSave = 0;
    }
    }
    checkpoint.targets = Array.from(targetSOs).sort((a, b) => getSoMagnitude(b) - getSoMagnitude(a));
    checkpoint.phase = 'orders';
    checkpoint.nextOrder = 0;
    checkpoint.currentPos = LATEST_SO_ID;
    await checkpoints.saveCheckpoint(checkpoint);
    setProgress(100);
    await waitForCompletion(signal);
  }

  if (checkpoint.targets.length === 0) {
    log('No deliveries found for these months.', 'warn');
    return { data: [], skipped: [], totalOrders: 0 };
  }

  const sortedTargets = checkpoint.targets;
  const totalTargets = sortedTargets.length;
  const savedOrders = await checkpoints.loadSavedOrders(checkpoint.key);
  const savedByOrder = new Map(savedOrders.map(order => [order.soNumber, order]));
  const rowsByOrder = new Map(savedOrders.filter(order => order.status !== 'skipped').map(order => [order.soNumber, order.rows]));
  const skippedOrders = sortedTargets.filter(so => savedByOrder.get(so)?.status === 'skipped')
    .map(so => ({ soNumber: so, reason: savedByOrder.get(so).reason }));
  ui.setSkippedOrders(skippedOrders);
  const nextOrder = checkpoint.nextOrder || 0;
  if (nextOrder < 0 || nextOrder > totalTargets ||
      sortedTargets.slice(0, nextOrder).some(so => !savedByOrder.has(so))) {
    throw new Error('Saved sales data is inconsistent. Use Start over to scan this period again.');
  }
  log('Reading ' + totalTargets + ' sales orders (' + nextOrder + ' already processed).', 'info');
  await pause(400, signal);
  setProgress(0, true);
  setPhaseState(2);
  setProgress(Math.min(99, nextOrder / totalTargets * 100));

  let currentPos = checkpoint.currentPos || LATEST_SO_ID;

  async function completeOrder(pageData, targetSO, index) {
    const rows = extractData(pageData.html, targetSO, pageData.id);
    checkpoint.currentPos = pageData.id;
    checkpoint.nextOrder = index + 1;
    await checkpoints.saveCompletedOrder(checkpoint, targetSO, pageData.id, rows);
    rowsByOrder.set(targetSO, rows);
    savedByOrder.set(targetSO, { soNumber: targetSO, rows });
    currentPos = pageData.id;
    setProgress(Math.min(99, (index + 1) / totalTargets * 100));
  }

  async function skipOrder(targetSO, index) {
    const reason = 'Not located in the expected sales-order record range; verify this order in the company portal.';
    checkpoint.nextOrder = index + 1;
    // Never adjust currentPos when an order is skipped: we have no verified ID.
    await checkpoints.saveSkippedOrder(checkpoint, targetSO, reason);
    savedByOrder.set(targetSO, { soNumber: targetSO, rows: [], status: 'skipped', reason });
    skippedOrders.push({ soNumber: targetSO, reason });
    ui.setSkippedOrders(skippedOrders);
    setProgress(Math.min(99, (index + 1) / totalTargets * 100));
    log('Skipped ' + targetSO + ': ' + reason, 'warn');
  }

  async function tryFetch(id) {
    try {
      const res = await dynamicFetch(soBaseUrl + id);
      if (!res.ok) return null;
      const html = await readRecord(res);
      const soMatch = html.match(/\d+\/ISI\/[A-Z0-9]+\/[A-Z]+\/\d{4}/);
      if (soMatch) return { id: id, soNumber: soMatch[0], mag: getSoMagnitude(soMatch[0]), html: html };
    } catch (e) { signal.throwIfAborted(); throw e; }
    return null;
  }

  for (let i = nextOrder; i < totalTargets; i++) {
    const targetSO = sortedTargets[i];
    log(`${i + 1} of ${totalTargets}: ${targetSO}`, 'info');
    setProgress(Math.min(99, (i / totalTargets) * 100));

    // Sales-order series can be interleaved, so a previous match is not
    // necessarily an upper bound for the next one.
    const pageData = await findSalesOrder(targetSO, currentPos, LATEST_SO_ID, tryFetch);
    if (pageData) await completeOrder(pageData, targetSO, i);
    else await skipOrder(targetSO, i);
  }

  setProgress(100);
  await waitForCompletion(signal);
  checkpoint.phase = 'ready';
  await checkpoints.saveCheckpoint(checkpoint);

  // Rebuild strictly in target order, retaining the omissions in a separate report.
  const finalData = [];
  for (const so of sortedTargets) {
    if (savedByOrder.get(so)?.status === 'skipped') continue;
    const rows = rowsByOrder.get(so);
    if (!rows) throw new Error('Saved sales data is missing for ' + so + '. Use Start over.');
    finalData.push(...rows);
  }
  return { data: finalData, skipped: skippedOrders, totalOrders: totalTargets };
}
