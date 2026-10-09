import { fetchPortal, pause } from './portal.js';

export async function discoverIndexes(signal, log) {
  const fetch = url => fetchPortal(url, signal);
  log("Checking delivery records…", "info");
  const doRes = await fetch("http://apps.islandsunindonesia.com:81/islandsun/NewDo/json");
  const doJson = await doRes.json();
  const latestDO = Math.max(...doJson.data.map(item => parseInt(item.id, 10)));
  if (!Number.isSafeInteger(latestDO) || latestDO < 1) throw new Error("Invalid delivery index.");
  log(`✓ Logic synced (Index: ${latestDO})`, "success");

  log("Locating the latest sales order…", "info");
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const d1 = `${thirtyDaysAgo.getFullYear()}-${String(thirtyDaysAgo.getMonth()+1).padStart(2,'0')}-${String(thirtyDaysAgo.getDate()).padStart(2,'0')}`;
  const now = new Date();
  const d2 = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

  const soUrl = `http://apps.islandsunindonesia.com:81/islandsun/sales-order/json?dari=${d1}&sampai=${d2}&status=&tipe=&srs_value=&orderData=`;
  const soRes = await fetch(soUrl);
  const soJson = await soRes.json();

  const maxSoIdFromJSON = soJson.data && soJson.data.length > 0 ? Math.max(...soJson.data.map(item => parseInt(item.so_id, 10))) : 20000;
  if (!Number.isSafeInteger(maxSoIdFromJSON) || maxSoIdFromJSON < 1) throw new Error('Invalid sales index.');

  let latestSO = maxSoIdFromJSON;
  let emptyCount = 0;
  let testId = maxSoIdFromJSON + 1;

  while(emptyCount < 5) {
    const tRes = await fetch(`http://apps.islandsunindonesia.com:81/islandsun/sales-order/edit/${testId}`);
    if (tRes.ok) {
      const tHtml = await tRes.text();
      if (tHtml.match(/\d+\/ISI\/[A-Z0-9]+\/[A-Z]+\/\d{4}/)) {
        latestSO = testId;
        emptyCount = 0;
      } else emptyCount++;
    } else emptyCount++;
    testId++;
    await pause(150, signal);
  }
  log(`✓ Secondary matrix synced (Index: ${latestSO})`, "success");

  return { latestDO, latestSO };
}
