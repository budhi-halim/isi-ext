import { PORTAL_HOME } from './offline-config.js';
import { ARCHIVE_SCOPE_VERSION } from './offline-access.js';

// === Native Read-only Table Contracts ===
export const PAGED_SOURCES = {
  sample: {path:'samplerequest/json', columns:['sr_id','sr_no','sr_date','sr_pic','sr_customer','sr_srtype','function','sr_status','sr_statfeedback','function','view'], order:0, direction:'asc', size:100, notSearchable:[6,9], notOrderable:[0,6,9,10]},
  tir: {path:'master/Tir/json', columns:['id_tir','tir_no','customer','tujuan_jenis','date_tir','pic','tir_ir','tir_cetak','stat','tir_locked_status','view'], order:1, direction:'desc', size:100, notSearchable:[3], notOrderable:[0,10]},
  sales: {path:'sales-order/json', columns:['so_id','so_no','so_jenis','tax_stat','so_customer','so_po_no','so_sales','so_id','so_id','so_created_at','so_id','so_status','view'], order:0, direction:'desc', size:100, notSearchable:[8], notOrderable:[0,12]},
  stock: {path:'stock-request/json-srs', columns:['srs_id','srs_no','srs_date','srs_srs_no','srs_customer','kode_produk','srs_product','name','srs_total_qty','srs_remarks','status_next','srs_status','is_replacement'], order:1, direction:'asc', size:100},
  availability: {path:'daftar_kiriman_barang_sales/jsonDaftarKirim',columns:['isrd_id','c_name','so_ekspedisi','product_name','srs_no','isrd_eta_2','srsc_qty','sisa','so_po_no','so_sales','isrd_note_isr','srs_note','isr_status_kirim','isr_updated_date','isrd_id'],order:1,direction:'asc',size:100},
  delivery: {path:'NewDo/json', columns:['id','do_no','tanggal','do_customer','do_pic_name','id','id','view','view2'], order:0, direction:'desc', size:100, notSearchable:[5], notOrderable:[]},
  returns: {path:'stock-request/jsonComplain', columns:['complain_id','complain_date','complain_jenis','so_no','srs_no','complain_customer','complain_product_code','complain_product','complain_qty','complain_status'], order:1, direction:'desc', size:10},
  sudden: {path:'Suddenrequest/json-sudden', columns:['srs_id','srs_no','srs_suddenstock_no','srs_sudden_type','srs_customer','srs_product','sudden_sales','pic','srs_total_qty','srs_sudden_status','srs_status','srs_status'], order:1, direction:'asc', size:100, notSearchable:[11]},
};

export function beginIndexScan(now = Date.now()) {
  return {id:crypto.randomUUID(), startedAt:now, cursor:0, stored:0, stable:true,scopeVersion:ARCHIVE_SCOPE_VERSION};
}

export function indexPageRequest(kind, scan, {verify = false, now = new Date(scan.startedAt)} = {}) {
  const source = PAGED_SOURCES[kind];
  if (!source) throw new Error('This source does not use paginated capture.');
  const url = new URL(source.path,PORTAL_HOME);
  if (['returns','stock','sample','tir','sales'].includes(kind)) {
    const today = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
    const filters = {tipe:'',dari:'0001-01-01',sampai:today};
    if (kind === 'sample' || kind === 'tir') filters.fil_status = '';
    else filters.status = '';
    if (kind === 'tir') filters.fil_lock = '';
    if (kind === 'sales') { filters.srs_value = ''; filters.orderData = 'ASC'; }
    url.search = new URLSearchParams(filters);
  }
  if (kind === 'sudden') url.search = new URLSearchParams({jenis:'',tipe:'',status:''});
  if (kind === 'availability') url.search = new URLSearchParams({filter:'',bulan:'',tahun:''});
  const body = new URLSearchParams({draw:'1',start:String(verify ? 0 : Math.max(0,scan.cursor-1)),length:String(source.size),'search[value]':'','search[regex]':'false','order[0][column]':String(source.order),'order[0][dir]':source.direction});
  source.columns.forEach((name,index) => {
    body.set(`columns[${index}][data]`,name);
    body.set(`columns[${index}][name]`,'');
    body.set(`columns[${index}][searchable]`,String(!(source.notSearchable || []).includes(index)));
    body.set(`columns[${index}][orderable]`,String(!(source.notOrderable || [0]).includes(index)));
    body.set(`columns[${index}][search][value]`,'');
    body.set(`columns[${index}][search][regex]`,'false');
  });
  return {url:url.href, options:{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8','X-Requested-With':'XMLHttpRequest'},body:body.toString()}};
}

export async function pageSignature(records) {
  const bytes = new TextEncoder().encode(JSON.stringify(records.map(record => [record.key,record.fingerprint])));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value => value.toString(16).padStart(2,'0')).join('');
}

/** Overlapping boundaries detect shifting pages; unstable scans never revoke saved records. */
export async function advanceIndexScan(scan, records, payload, size) {
  const total = Number(payload.recordsFiltered), overall = Number(payload.recordsTotal);
  const start = Math.max(0,scan.cursor-1);
  if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(overall) || overall < total || records.length > size ||
      records.length !== Math.min(size,Math.max(0,total-start)) || new Set(records.map(record => record.key)).size !== records.length) {
    throw new Error('The portal returned an incomplete or inconsistent page. The saved archive is retained.');
  }
  const next = {...scan,total,overall};
  let fresh = records;
  if (!scan.cursor) {
    next.headSignature = await pageSignature(records);
    next.headCheckedAt = Date.now();
  }
  else {
    const overlap = records.length && await pageSignature(records.slice(0,1)) === scan.tailSignature;
    next.stable = scan.stable && overlap && total === scan.total && overall === scan.overall;
    if (overlap) fresh = records.slice(1);
  }
  next.tailSignature = await pageSignature(records.slice(-1));
  next.cursor = start + records.length;
  next.verify = next.cursor >= total;
  if (!next.verify && next.cursor <= scan.cursor) throw new Error('The portal page did not advance. Capture will retry later.');
  return {scan:next,records:fresh};
}

export async function verifyIndexScan(scan, records, payload) {
  return scan.stable && Number(payload.recordsFiltered) === scan.total && Number(payload.recordsTotal) === scan.overall &&
    await pageSignature(records) === scan.headSignature;
}
