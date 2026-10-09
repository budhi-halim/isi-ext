import { fetchPortal, pause } from './portal.js';
import { createDateTrend } from './trend.js';
import { extractData, getSoMagnitude } from './records.js';

export async function runCoreScraper({ startMonthVal, endMonthVal, latestDO: LATEST_DO_ID, latestSO: LATEST_SO_ID, signal, ui }) {
  const { setProgress, setPhaseState, log, waitForCompletion } = ui;
  const fetch = url => fetchPortal(url, signal);
  const trend = createDateTrend();
  const doBaseUrl = "http://apps.islandsunindonesia.com:81/islandsun/NewDo/detailDO/";
  const soBaseUrl = "http://apps.islandsunindonesia.com:81/islandsun/sales-order/edit/";

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
  setPhaseState(1);
  log(`[PHASE 1] Scanning delivery records (${targetStartDate} to ${targetEndDate})`, "info");

  let currentDelay = 400;
  const MIN_DELAY = 100, MAX_DELAY = 30000;

  async function dynamicFetch(url) {
    const startTime = performance.now();
    let response;
    try { response = await fetch(url); }
    catch (error) {
      signal.throwIfAborted();
      if (error.name === 'SessionExpiredError') throw error;
      currentDelay = Math.min(MAX_DELAY, currentDelay * 2);
      await pause(currentDelay, signal);
      throw error;
    }
    const latency = performance.now() - startTime;
    if (response.ok) {
      if (latency < 200) currentDelay = Math.max(MIN_DELAY, currentDelay - 50);
      else if (latency > 800) currentDelay = Math.min(MAX_DELAY, currentDelay + 200);
    } else if (response.status >= 429) {
      currentDelay = Math.min(MAX_DELAY, currentDelay * 2);
    }
    await pause(currentDelay, signal);
    return response;
  }

  let currentDO = LATEST_DO_ID;
  const targetSOs = new Set();
  let emptyDoCount = 0;
  let historicalStreak = 0;
  let maxProgressSeen = 0;

  while (currentDO > 0) {
    try {
      const res = await dynamicFetch(doBaseUrl + currentDO);
      if (res.ok) {
        const html = await res.text();
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
            log(`  ✓ Target acquired on ${tgl}`, "success");
            const links = doc.querySelectorAll('#detail_srf a');
            links.forEach(link => {
              const text = link.innerText.trim();
              if (text.includes('/ISI/')) targetSOs.add(text);
            });
          } else if (tgl > safetyNetDate && tgl < targetStartDate) {
            historicalStreak = 0;
            const printToConsole = (currentDO % 15 === 0);
            log(`  Scanning historical records to verify completion...`, "info", printToConsole);
          } else if (tgl <= safetyNetDate) {
            historicalStreak++;
            if (historicalStreak > 25) {
              log(`  🛑 Historical threshold achieved consistently (Streak: 25).`, "info");
              break;
            }
          }
        } else {
          trend.observe(null);
          emptyDoCount++;
          if (emptyDoCount > 150) {
            log(`  ⚠ Consecutive dead-ends detected. Terminating Phase 1.`, "warn");
            break;
          }
        }
      } else trend.observe(null);
    } catch (err) {
      signal.throwIfAborted();
      if (err.name === 'SessionExpiredError') throw err;
      trend.observe(null);
    }
    currentDO--;
  }

  setProgress(100);

  await waitForCompletion(signal);

  if (targetSOs.size === 0) {
    log(`⚠ Zero active operations found in selected range.`, "warn");
    return [];
  }

  const sortedTargets = Array.from(targetSOs).sort((a, b) => getSoMagnitude(b) - getSoMagnitude(a));
  log(`[PHASE 2] Extracting Sales Data for ${sortedTargets.length} records.`, "info");

  await pause(400, signal);
  setProgress(0, true);
  setPhaseState(2);

  const finalData = [];
  let currentPos = LATEST_SO_ID;
  const totalTargets = sortedTargets.length;

  async function tryFetch(id) {
    try {
      const res = await dynamicFetch(soBaseUrl + id);
      if (!res.ok) return null;
      const html = await res.text();
      const soMatch = html.match(/\d+\/ISI\/[A-Z0-9]+\/[A-Z]+\/\d{4}/);
      if (soMatch) return { id: id, soNumber: soMatch[0], mag: getSoMagnitude(soMatch[0]), html: html };
    } catch (e) { signal.throwIfAborted(); if (e.name === "SessionExpiredError") throw e; }
    return null;
  }

  for (let i = 0; i < totalTargets; i++) {
    const targetSO = sortedTargets[i];
    const targetMag = getSoMagnitude(targetSO);

    log(`  Processing [${i+1}/${totalTargets}]: ${targetSO}...`, "info");
    setProgress(Math.min(99, ((i+1) / totalTargets) * 100));

    let low = 1000, high = currentPos, pos = currentPos, jump = 1, isBinarySearch = false;

    while (true) {
      if (high - low <= 5) {
        let found = false;
        for (let scanId = high; scanId >= low; scanId--) {
          const pageData = await tryFetch(scanId);
          if (pageData && pageData.soNumber === targetSO) {
            finalData.push(...extractData(pageData.html, targetSO, pageData.id));
            currentPos = pageData.id;
            found = true;
            break;
          }
        }
        if (!found) log(`  ⚠ Record ${targetSO} absent (Likely purged).`, "warn");
        break;
      }

      if (!Number.isSafeInteger(pos) || pos < 1) throw new Error("Sales lookup reached an invalid index.");
      const pageData = await tryFetch(pos);
      if (!pageData) {
        if (!isBinarySearch) { pos -= jump; jump *= 2; }
        else { pos--; }
        continue;
      }

      if (pageData.soNumber === targetSO) {
        finalData.push(...extractData(pageData.html, targetSO, pageData.id));
        currentPos = pageData.id;
        break;
      }

      if (pageData.mag >= targetMag) {
        high = pageData.id;
        if (!isBinarySearch) { pos = pageData.id - jump; jump *= 2; }
        else { pos = Math.floor((low + high) / 2); }
      } else {
        low = pageData.id;
        if(!isBinarySearch) isBinarySearch = true;
        pos = Math.floor((low + high) / 2);
      }
    }
  }

  setProgress(100);
  await waitForCompletion(signal);
  return finalData;
}
