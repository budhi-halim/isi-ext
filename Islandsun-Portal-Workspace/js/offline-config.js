import { PORTAL_ORIGIN } from './shared/document-names.js';

const columns = entries => entries.map(([key, label]) => ({ key, label }));
const STOCK_MOVEMENT_SOURCE = {id:'snapshot_id',number:'srs_no',date:'entry_date',stockRows:true,columns:columns([['customer','Customer'],['salesperson','Salesperson'],['srs_no','Stock request'],['entry_date','Request date'],['isr_no','ISR'],['related_orders','Sales orders'],['eta','ETA 2'],['handover_date','Handover date'],['product','Product / code'],['batch','Batch'],['request_qty','First request'],['qty_in','Incoming'],['qty_out','Outgoing'],['stock_qty','Stock'],['sudden_plus','Sudden plus'],['sudden_minus','Sudden minus']])};
export const OFFLINE_SOURCES = {
  sample: { title: 'Sample Requests', path: '/samplerequest/json', id: 'sr_id', number: 'sr_no', date: 'sr_date', status: 'sr_status', columns: columns([['sr_no','Request number'],['sr_date','Date'],['sr_customer','Customer'],['sr_pic','PIC'],['sr_srtype','Type'],['sr_status','Status'],['sr_statkirimbarang','Shipping'],['sr_statfeedback','Feedback']]) },
  tir: { title: 'TIR', path: '/master/Tir/json', id: 'id_tir', number: 'tir_no', date: 'date_tir', status: 'stat', columns: columns([['tir_no','Request number'],['date_tir','Date'],['customer','Customer'],['pic','PIC'],['tir_ir','Information request'],['stat','Status'],['tir_locked_status','Lock status']]) },
  stock: { title: 'Stock Requests', path: '/stock-request/json-srs', id: 'srs_id', number: 'srs_no', date: 'srs_date', status: 'srs_status', columns: columns([['srs_no','Request number'],['srs_date','Date'],['srs_customer','Customer'],['srs_product','Product'],['kode_produk','Product code'],['srs_total_qty','Quantity'],['srs_status','Status'],['srs_remarks','Remarks']]) },
  sales: { title: 'Sales Orders', path: '/sales-order/json', id: 'so_id', number: 'so_no', date: 'so_date', status: 'so_status', columns: columns([['so_no','Order number'],['so_date','Date'],['so_customer','Customer'],['so_po_no','PO'],['so_sales','Salesperson'],['so_status','Status'],['so_jenis','Type'],['so_total_spb','SPB total']]) },
  products: { title: 'Product List', id: 'product_code', number: 'product_code', columns: columns([['product_code','Product code'],['product_name','Product name'],['marketing_price','Original marketing price']]) },
  availability: {title:'Product Availability',id:'availability_id',number:'srs_no',date:'entry_date',status:'isr_status_kirim',columns:columns([['c_name','Customer'],['so_ekspedisi','Address / expedition'],['product_name','Product'],['product_code','Product code'],['srs_no','Stock request'],['entry_date','Request date'],['isrd_eta_2','ETA'],['srsc_qty','Quantity'],['sisa','Remaining'],['so_po_no','PO / SPB'],['so_sales','Salesperson'],['isrd_note_isr','ISR notes'],['srs_note','SR notes'],['isr_status_kirim','Shipping status'],['isr_updated_date','Last update'],['source_type','Source']])},
  'stock-products': {title:'Stock By Product',id:'product_code',number:'product_code',summaryOnly:true,columns:columns([['product_name','Product'],['product_code','Product code'],['qty_in','Incoming quantity'],['qty_out','Outgoing quantity'],['stock_qty','Stock']])},
  'stock-outstanding': {...STOCK_MOVEMENT_SOURCE,title:'Stock Outstanding'},
  'stock-history': {...STOCK_MOVEMENT_SOURCE,title:'Stock History'},
  'stock-adjustment': {title:'Stock Adjustment & Auction',id:'stock_id',number:'product_code',summaryOnly:true,columns:columns([['product_name','Product'],['product_code','Product code'],['batch','Batch'],['stock_qty','Stock']])},
  delivery: {title:'Delivery Orders',id:'id',number:'do_no',date:'tanggal',status:'do_statuskirim',columns:columns([['do_no','Delivery number'],['tanggal','Date'],['do_customer','Customer'],['do_pic_name','PIC'],['do_ekspedisi','Expedition'],['do_statuskirim','Shipping status'],['status','Status']])},
  returns: {title:'Returns & Replacement',id:'complain_id',number:'complain_id',date:'complain_date',status:'complain_status',columns:columns([['complain_id','Record ID'],['complain_date','Date'],['complain_jenis','Type'],['so_no','Sales order'],['srs_no','Stock request'],['complain_customer','Customer'],['complain_product_code','Product code'],['complain_product','Product'],['complain_qty','Quantity'],['complain_status','Status']])},
  sudden: {title:'Sudden Requests',id:'srs_id',number:'srs_no',date:'srs_date',status:'srs_sudden_status',columns:columns([['srs_no','Request number'],['srs_date','Date'],['srs_suddenstock_no','Source stock request'],['srs_customer','Customer'],['srs_product','Product'],['srs_total_qty','Quantity'],['sudden_sales','Salesperson'],['pic','PIC'],['srs_sudden_type','Type'],['srs_sudden_status','Approval status'],['srs_status','Stock status']])},
};
export const PRODUCT_SOURCE = 'https://budhi-halim.github.io/pl-isi/data/products.json';
export const PORTAL_HOME = `${PORTAL_ORIGIN}/islandsun/`;
export const OFFLINE_STATUS = 'islandsun.offline-status';

export function indexUrl(kind, now = new Date()) {
  const source = OFFLINE_SOURCES[kind];
  if (!source?.path) return null;
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return `${PORTAL_HOME.slice(0, -1)}${source.path}?${new URLSearchParams({dari:'0001-01-01', sampai:date, tipe:'', status:'', fil_status:'', fil_lock:'', srs_value:'', orderData:''})}`;
}

export function businessDate(value) {
  const text = String(value || '').trim();
  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[ T])/);
  if (!match) {
    const named = text.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
    const month = named && ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(named[2].toLowerCase()) + 1;
    if (!month) return null;
    match = ['', named[3], String(month).padStart(2,'0'), named[1].padStart(2,'0')];
  }
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0,10) === date ? date : null;
}

export function archiveKey(account, kind, id) { return JSON.stringify([account, kind, String(id)]); }

export function suggestedPrice(value) {
  if (value == null || String(value).trim() === '') return null;
  const price = Number(value);
  return Number.isFinite(price) && price >= 0 ? (price === 0 ? 5 : price) : null;
}
