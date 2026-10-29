import { DEFAULT_PORTAL_ORIGIN, rebasePortalUrl } from './shared/portal-address.js';
import { fetchPortal, pause, readPortalItems, readRecord } from './portal.js';

export async function discoverIndexes(signal, log, origin = DEFAULT_PORTAL_ORIGIN) {
  const root = rebasePortalUrl(`${DEFAULT_PORTAL_ORIGIN}/islandsun/`, origin);
  const fetch = url => fetchPortal(url, signal);
  log("Checking delivery records…", "info");
  const doRes = await fetch(`${root}NewDo/json`);
  const deliveries = await readPortalItems(doRes);
  const latestDO = Math.max(...deliveries.map(item => Number(item.id)));
  if (!Number.isSafeInteger(latestDO) || latestDO < 1) throw new Error("Invalid delivery index.");
  log('Delivery records ready.', 'success');

  log("Locating the latest sales order…", "info");
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const d1 = `${thirtyDaysAgo.getFullYear()}-${String(thirtyDaysAgo.getMonth()+1).padStart(2,'0')}-${String(thirtyDaysAgo.getDate()).padStart(2,'0')}`;
  const now = new Date();
  const d2 = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

  const soUrl = `${root}sales-order/json?dari=${d1}&sampai=${d2}&status=&tipe=&srs_value=&orderData=`;
  const soRes = await fetch(soUrl);
  const sales = await readPortalItems(soRes);

  const maxSoIdFromJSON = sales.length > 0 ? Math.max(...sales.map(item => Number(item.so_id))) : 20000;
  if (!Number.isSafeInteger(maxSoIdFromJSON) || maxSoIdFromJSON < 1) throw new Error('Invalid sales index.');

  let latestSO = maxSoIdFromJSON;
  let emptyCount = 0;
  let testId = maxSoIdFromJSON + 1;

  while(emptyCount < 5) {
    const tRes = await fetch(`${root}sales-order/edit/${testId}`);
    if (tRes.ok) {
      const tHtml = await readRecord(tRes);
      if (tHtml.match(/\d+\/ISI\/[A-Z0-9]+\/[A-Z]+\/\d{4}/)) {
        latestSO = testId;
        emptyCount = 0;
      } else emptyCount++;
    } else emptyCount++;
    testId++;
    await pause(150, signal);
  }
  log('Sales orders ready.', 'success');

  return { latestDO, latestSO };
}
