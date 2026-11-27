import { getSoMagnitude } from './records.js';

// A sales-order serial does not identify its global record ID. Other SO series
// (for example different branch codes) may be interleaved in the portal.
// Try the saved cursor first for speed, then retry from the full latest ID.
const FIRST_SO_ID = 1000;
const MAX_PROBES = 120;

async function searchWithinRange(targetSO, upperBound, readOrder) {
  if (!Number.isSafeInteger(upperBound) || upperBound < FIRST_SO_ID) return null;

  const magnitude = getSoMagnitude(targetSO);
  let low = FIRST_SO_ID;
  let high = upperBound;
  let pos = upperBound;
  let jump = 1;
  let binary = false;
  let probes = 0;
  const alreadyRead = new Map();

  async function read(id) {
    if (alreadyRead.has(id)) return alreadyRead.get(id);
    if (++probes > MAX_PROBES) return null;
    const record = await readOrder(id);
    alreadyRead.set(id, record);
    return record;
  }

  while (probes < MAX_PROBES) {
    if (high - low <= 5) {
      for (let id = high; id >= low && probes < MAX_PROBES; id--) {
        const page = await read(id);
        if (page?.soNumber === targetSO) return page;
      }
      return null;
    }

    if (!Number.isSafeInteger(pos) || pos < FIRST_SO_ID || pos > upperBound) return null;
    const page = await read(pos);
    if (!page) {
      if (probes >= MAX_PROBES) return null;
      if (!binary) { pos -= jump; jump *= 2; }
      else pos--;
      continue;
    }

    if (page.soNumber === targetSO) return page;
    if (page.mag >= magnitude) {
      high = page.id;
      if (!binary) { pos = page.id - jump; jump *= 2; }
      else pos = Math.floor((low + high) / 2);
    } else {
      low = page.id;
      binary = true;
      pos = Math.floor((low + high) / 2);
    }
  }
  return null;
}

export async function findSalesOrder(targetSO, currentPos, latestSO, readOrder) {
  for (const bound of new Set([currentPos, latestSO])) {
    const found = await searchWithinRange(targetSO, bound, readOrder);
    if (found) return found;
  }
  return null;
}
