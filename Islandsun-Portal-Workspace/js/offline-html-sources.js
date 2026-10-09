const STOCK_MOVEMENT = {
  table:'#stocktable',requestDates:true,
  columns:['sequence','customer','salesperson','srs_no','isr_no','related_orders','eta','handover_date','product','batch','request_qty','qty_in','qty_out','stock_qty','sudden_plus','sudden_minus'],
  headers:['No','Customer','Sales','SR No','ISR No','SO','ETA 2','Tanggal Serah Terima','Nama Barang','NO Batch','First Request','Qty Masuk','Qty Keluar','Jumlah','Sudden Plus','Sudden Minus'],
};

export const HTML_SOURCES = {
  'stock-monthly': {path:'StockCard/allStockBact',table:'#stocktable',periodic:true,requestDates:true,columns:['sequence','srs_no','customer','product','request_qty','qty_in','qty_out','stock_qty','sudden_plus','sudden_minus'],headers:['No','No SR','Customer','Nama Barang','QTY SR','QTY Masuk','QTY Keluar','Stok','Sudden Plus','Sudden Minus']},
  'stock-products': {path:'StockCard/stockCardByProduct',table:'#stocktable',columns:['sequence','product_name','product_code','qty_in','qty_out','stock_qty'],headers:['No','Nama Barang','Kode Barang','QTY Masuk','QTY Keluar','Stok']},
  'stock-outstanding': {...STOCK_MOVEMENT,path:'StockCard'},
  'stock-history': {...STOCK_MOVEMENT,path:'StockCard/allStok'},
  'stock-adjustment': {path:'StockCard/AdjustmentStock',table:'#stocktable',columns:['sequence','product_name','product_code','batch','stock_qty','actions'],headers:['No','Nama Barang','Kode Barang','No Bacth','Jumlah Stok','Aksi']},
};
