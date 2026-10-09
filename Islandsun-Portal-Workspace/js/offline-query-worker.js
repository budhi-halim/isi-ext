import { visitRecords, readArchive } from './offline-store.js';
import { OFFLINE_SOURCES } from './offline-config.js';
import { seedVaultKey } from './offline-vault.js';
import { availabilityCalendarRows } from './offline-calendar.js';
let cache, loading, generation = 0, unlockedAccount;
self.onmessage = async ({data}) => {
  if (data.reset) { generation++; cache = loading = null; seedVaultKey(unlockedAccount,null); unlockedAccount = null; return; }
  const current = generation;
  if (data.vaultKey) {
    if (unlockedAccount && unlockedAccount !== data.account) seedVaultKey(unlockedAccount,null);
    unlockedAccount = data.account;
    seedVaultKey(data.account,data.vaultKey);
  }
  try {
    const key = JSON.stringify([data.account,data.kind,data.revision]);
    if (cache?.key !== key) {
      if (loading?.key !== key) {
        const promise = (async () => {
          const rows = []; let details = 0;
          const unverified = await visitRecords(data.account,data.kind,record => {
            if (record.detailAt) details++;
            rows.push({key:record.key,number:record.number,fields:record.fields,date:record.date,search:[record.number,...Object.values(record.fields)].join(' ').toLowerCase()});
          },{details:false,readableOnly:true,shouldContinue:() => current === generation});
          return {key,rows,details,unverified,meta:await readArchive('meta',`index:${data.account}:${data.kind}`)};
        })();
        loading = {key,promise};
      }
      const result = await loading.promise;
      if (current !== generation) return;
      cache = result;
    }
    const source = OFFLINE_SOURCES[data.kind];
    const statuses = [...new Set(cache.rows.map(row => row.fields[source.status]).filter(Boolean))].sort();
    const query = data.search.toLowerCase().trim();
    const rows = cache.rows.filter(row => (!query || row.search.includes(query)) && (!source.periodic || !data.period || row.fields.reporting_period === data.period) && (!data.status || row.fields[source.status] === data.status) && (!data.from || row.date >= data.from) && (!data.to || row.date <= data.to) && (data.kind !== 'availability' || !data.category || row.fields.event_status === data.category));
    const collator = new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});
    rows.sort((a,b) => {
      const left = data.sort === source.date ? a.date : a.fields[data.sort] || '';
      const right = data.sort === source.date ? b.date : b.fields[data.sort] || '';
      if (['marketing_price','srs_total_qty','so_total_spb','complain_qty','srsc_qty','sisa','qty_in','qty_out','stock_qty','request_qty','sudden_plus','sudden_minus'].includes(data.sort)) {
        const number = value => value !== '' && /^-?\d+(?:,\d{3})*(?:\.\d+)?$/.test(value) ? Number(value.replaceAll(',','')) : null;
        const first = number(left), second = number(right);
        if (first !== null && second !== null) return (first-second) * (data.desc ? -1 : 1) || collator.compare(a.key,b.key);
        if (first === null && second !== null) return 1;
        if (second === null && first !== null) return -1;
      }
      return collator.compare(left || '',right || '') * (data.desc ? -1 : 1) || collator.compare(a.key,b.key);
    });
    const page = Math.max(0,Math.min(data.page,Math.ceil(rows.length/data.size)-1));
    const calendarRows = data.kind === 'availability' && data.calendar ? availabilityCalendarRows(rows,data.month) : [];
    self.postMessage({id:data.id, rows:rows.slice(page*data.size,(page+1)*data.size), calendarRows, page, total:rows.length, saved:cache.rows.length, details:cache.details, unverified:cache.unverified, statuses, meta:cache.meta});
  } catch (error) { self.postMessage({id:data.id,error:error.message}); }
};
