import { PORTAL_ORIGIN } from './shared/document-names.js';

const TRANSLATIONS = new Map(Object.entries({
  'KETERSEDIAAN BARANG (AVAILABILITY PRODUCTS)': 'Product availability',
  'Avability Products Calendar': 'Availability calendar', 'Avability Products Table': 'Availability table',
  'Cari SO': 'Search sales orders', '-- Pilih --': 'Select an option',
  'Oops something wrong, please try again': 'Something went wrong. Please try again.',
  'Opps, Someting Wrong check your internet connection': 'The request could not be completed. Check your connection and try again.',
  'Bulan': 'Month', 'Tahun': 'Year', 'Pilih Bulan': 'Select month', 'Pilih Tahun': 'Select year',
  'Bulan Hail': 'Month', 'Kode Barang': 'Product code', 'No Bacth': 'Batch number', 'Jumlah Stok': 'Stock quantity',
  'Stock Adjustment & LELANG': 'Stock Adjustment & Auction',
  'Cari Barang': 'Search products', 'Cari Kode': 'Search codes', 'Cari Bact': 'Search batches', 'Cari Jumlah': 'Search quantities',
  'Januari': 'January', 'Febuari': 'February', 'Februari': 'February', 'Maret': 'March',
  'Mei': 'May', 'Juni': 'June', 'Juli': 'July', 'Agustus': 'August', 'Oktober': 'October', 'Desember': 'December',
  'Calendar gagal dimuat': 'The calendar could not be loaded. Please try again.',
  'Filter bulan tahun wajib diisi': 'Select a month and year.',
  'Customer Belum Di isi': 'Select a customer.', 'Technical Information Belum Di Isi': 'Select at least one technical document or specify another request.',
  'COA Tanggal Kirim Wajib Di Isi': 'Enter the delivery date for the certificate of analysis.',
  'COA Product Wajib Di Isi': 'Select a product for the certificate of analysis.', 'COA Quantity Di Isi': 'Enter the quantity for the certificate of analysis.',
  'Tambah TIR': 'Add TIR', 'Pilih Jenis': 'Select type', 'Pilih Tipe': 'Select type', 'Pilih Status': 'Select status',
  'Cari Produk': 'Search products',
  'Tanggal Rencana Keluar(Format : Tgl Bulan Tahun)': 'Planned dispatch date (day month year)',
  'Get Produk Data': 'Get product data', 'Filter Produk': 'Filter products', 'Status Pengiriman': 'Shipping status',
  'Lihat Detail': 'View details', 'Detail Data': 'View details',
  'File Excel': 'Excel file', 'Login Another Account': 'Sign in to another account', 'Login': 'Sign in',
  'Keripik': 'Chips', 'Kerupuk': 'Crackers', 'Sosis': 'Sausage',
  'Makaroni': 'Macaroni', 'Kacang': 'Peanuts', 'Base Terigu': 'Wheat base',
  'Konfirmasi Produk': 'Product confirmation', 'Lihat PDF': 'View PDF', 'Cetak PDF': 'Print PDF',
  '(berupa seasoning)': '(seasoning)', '(berupa concentrate -tanpa msg, gula dan garam)': '(concentrate without MSG, sugar, or salt)',
  'Tidak terdapat produk yang memiliki total Quantity lebih dari 1000 GRAM': 'No product exceeds a total quantity of 1,000 g.',
  'Quantity Lebih Besar Dari 1000 Gram': 'The total quantity exceeds 1,000 g.',
  'Ideal Price tidak boleh lebih kecil dari Marketing Price': 'The ideal price cannot be lower than the marketing price.',
  'Price Competitor wajib diisi': 'The competitor price is required.',
  'Pastikan Produk yang ada adalah produk yang akan dimasukan , jika produk tidak sesuai maka click tombol reload dan check kembali produk yang dimasukan': 'Review the products below before saving. If they do not match your selection, reload the list and check again.',
  'Produk Name': 'Product name',
  'Are you sure want to Submit to Marketing Products?': 'Submit this request to Product Marketing?',
  'alasan wajib di isi': 'Enter a reason.', 'Isi Semua Kolom Isian': 'Complete all required fields.',
  'Produk sudah ada! Silahkan tambahkan produk yang lain': 'This product is already listed. Select another product.',
  'Produk sudah ada! silahkan masukan produk yang lain': 'This product is already listed. Select another product.',
  'Negara wajib di isi': 'Enter a country.', 'Primary Reason wajib di isi': 'Enter the primary reason.',
  'Purchase Unit Measures wajib di isi': 'Enter the purchase unit of measure.',
  'Estimated Unit Price wajib di isi': 'Enter the estimated unit price.',
  'Monthly Potential wajib di isi': 'Enter the monthly potential.',
  'Extimated Date Sample wajib di isi': 'Enter the estimated sample date.',
  'Product Form wajib di isi': 'Select a product form.', 'Name Of Product wajib di isi': 'Enter a product name.',
  'Target Reference wajib di isi': 'Enter a target reference.', 'Sample Quality wajib di isi': 'Enter the sample quantity.',
  'Product House Wajib Diisi': 'Specify whether an existing product performs the same function.',
  'Final Application Belum Di Isi': 'Select a final application.', 'Detailed Application Belum Di Isi': 'Select a detailed application.',
  'Potential Belum Lengkap': 'Complete the first-order, monthly average, and maximum-capacity quantities.',
  'Sukses Konfirmasi': 'Confirmed successfully.',
  'Pilih Customer': 'Select customer', 'Pilih Sales': 'Select salesperson', 'Pilih Produk': 'Select product',
  'Pilih Tujuan': 'Select destination', 'Pilih SRF': 'Select sample request', 'Pilih SRS': 'Select stock request',
  'Pilih PIC': 'Select contact', 'Pilih Form': 'Select product form',
  'Masukan Tir Telp': 'Enter phone or fax',
  'Ketersediaan Barang': 'Product availability', 'Stok Gagal Kirim': 'Undelivered stock',
  'Cari Customer': 'Search customers', 'Dikirim': 'Shipped', 'Belum Dikirim': 'Not shipped',
  'Status Lock': 'Lock status', 'Check again your Username and password': 'Incorrect username or password. Please try again.',
  'Enter your password to retrieve your session': 'Enter your password to sign in',
  'Lockscreen': 'Lock screen', 'View Data': 'View details', 'Apakah Anda Yakin ?': 'Are you sure?',
  'Tipe': 'Type', 'Jenis': 'Type', 'Jenis SO': 'Order type', 'Tanggal': 'Date',
  'Dari': 'From', 'Sampai': 'To', 'Aksi': 'Actions', 'Alasan': 'Reason',
  'Deskripsi': 'Description', 'Keterangan': 'Remarks', 'Catatan': 'Notes',
  'Simpan': 'Save', 'Batal': 'Cancel', 'Tutup': 'Close', 'Hapus': 'Delete',
  'Tambah': 'Add', 'Ubah': 'Edit', 'Cari': 'Search', 'Cetak': 'Print',
  'Kembali': 'Back', 'Lanjut': 'Next', 'Sebelumnya': 'Previous',
  'Masuk': 'Sign in', 'Keluar': 'Sign out', 'Ingat Saya': 'Remember me',
  'Upload Dokumen': 'Documents', 'Upload Document': 'Documents',
  'TUJUAN': 'Destination', 'JENIS DATA': 'Data type', 'NO SR': 'Request number',
  'Tangal Kirim': 'Shipping date', 'Tanggal Kirim': 'Shipping date',
  'Tanggal TIR': 'TIR date', 'Tanggal SR': 'Request date',
  'Data Product': 'Product information', 'Nama Produk': 'Product name',
  'Kode Produk': 'Product code', 'Nama Dan Kode Produk': 'Product name and code',
  'Jumlah (GR)': 'Quantity (g)', 'Jumlah': 'Quantity',
  'Nama Customer': 'Customer name', 'Nomor Request': 'Request number',
  'Telp / Fax': 'Phone / Fax', 'PIC Sales': 'Sales contact', 'PIC Customer': 'Customer contact',
  'FeedBack': 'Feedback', 'Tambah FeedBack': 'Add feedback',
  'Komentar': 'Comments', 'Saran': 'Suggestions', 'Kesimpulan': 'Conclusion',
  'Nomor SRF': 'Sample request number', 'Nama Sample': 'Sample name', 'Kode Sample': 'Sample code',
  'Tangal Terima Sample': 'Sample received date', 'Tanggal Terima Sample': 'Sample received date',
  'Tanggal Kirim Sample ke Customer': 'Sample sent to customer date', 'Tidak Ok': 'Not OK',
  'Tidak ok perlu improvement': 'Not OK — improvement needed',
  'List Data SRF': 'Sample requests', 'List Stock Request': 'Stock requests',
  'List Sales Order': 'Sales orders', 'Report Stock Request': 'Stock request report',
  'Extimated Launching Date': 'Estimated launch date', 'Estimated Launching Date': 'Estimated launch date',
  'Manufacture Name': 'Manufacturer name', 'Input Competitor': 'Competitor details',
  'Tambah Competitor': 'Add competitor', 'Water Solube': 'Water soluble',
  'General Product Spesification': 'General Product Specification',
  'COA Pengiriman': 'Delivery certificate of analysis',
  '--Pilih Jenis--': 'Select type', '--Pilih Status--': 'Select status',
  '-- Pilih Customer --': 'Select customer', '--Pilih Customer--': 'Select customer',
  '* Semua Field Wajib Di Isi': '* All fields are required',
  'Tanggal tidak valid': 'Enter a valid date.', 'Data berhasil disimpan': 'Saved successfully.',
  'Data gagal disimpan': 'Could not save. Please try again.',
  'Silahkan isi semua field': 'Complete all required fields.',
  'Sign in to start your session': 'Sign in to Islandsun',
  'LOGIN ADMIN': 'Sign in to Islandsun', 'Masukan Username / NIP': 'Enter your username or employee number',
  'Quatity': 'Quantity', 'Produk Code': 'Product code', 'Desription': 'Description',
  'Keterangan RND': 'R&D remarks', 'Status Bahan Baku': 'Raw material status',
  'Complain': 'Complaint', 'Date Complain': 'Complaint date', 'SO Complain': 'Sales order complaint',
  'SR Complain': 'Stock request complaint', 'Status Kirim': 'Shipping status',
  'Syarat Pembayaran': 'Payment terms',
  'Biscuit, Wafer & Coklat': 'Biscuits, wafers & chocolate',
  'Nama Barang': 'Product name', 'Jumlah Kg': 'Quantity (kg)', 'Harga / KG': 'Price / kg',
  'JML': 'Quantity', 'Cek Hutang': 'Check outstanding balance',
  'Total Qty tidak sama': 'Total quantities do not match',
  'Nilai grand total tidak sama': 'Grand totals do not match',
  'Pengeluaran Sample R&D': 'R&D-issued samples', 'Tanda Terima Sample': 'Sample receipt',
}));
const TRANSLATIONS_BY_CASE = new Map([...TRANSLATIONS].map(([key,value]) => [key.toLowerCase(),value]));

/** Translate known interface phrases, never free-form record contents. */
export function translateChrome(text) {
  const normalized = String(text).replace(/\s+/g, ' ').trim();
  const existingTir = /^WARNING!+\s*(SRF|SRS) ini sudah dibuat TIR sebanyak\s*(\d+)\s*kali[.!]?$/i.exec(normalized);
  if (existingTir) return `This ${existingTir[1].toUpperCase() === 'SRF' ? 'sample' : 'stock'} request already has ${existingTir[2]} ${Number(existingTir[2]) === 1 ? 'TIR' : 'TIRs'}.`;
  const quantity = /^Terdapat (\d+) Produk yang memiliki total Quantity lebih dari ([\d.,]+) GRAM\.?$/i.exec(normalized);
  if (quantity) return `${quantity[1]} ${Number(quantity[1]) === 1 ? 'product exceeds' : 'products exceed'} a total quantity of ${Number(quantity[2].replace(/[.,]/g, '')).toLocaleString('en-US')} g.`;
  if (/^Pastikan hanya ada 1 tab yang aktif pada saat melakukan edit/i.test(normalized)) return 'Keep only one editing tab open. Do you want to edit this request?';
  const key = normalized.replace(/^[\s-]+|[\s-]+$/g, '').toLowerCase();
  if (normalized.endsWith(':')) {
    const label = TRANSLATIONS_BY_CASE.get(normalized.slice(0, -1).trim().toLowerCase());
    if (label) return `${label}:`;
  }
  return TRANSLATIONS_BY_CASE.get(normalized.toLowerCase()) ?? TRANSLATIONS_BY_CASE.get(key) ?? normalized;
}

export function requestDetailUrl(id, type) {
  if (!/^\d+$/.test(String(id)) || ![1, 2, 3, 4, 5].includes(Number(type))) return null;
  return `${PORTAL_ORIGIN}/islandsun/samplerequest/edit?id=${id}&srtype=${type}`;
}

export function tirDetailUrl(id) {
  return /^\d+$/.test(String(id)) ? `${PORTAL_ORIGIN}/islandsun/master/Tir/edit/${id}` : null;
}

export function sampleType(text) {
  return { 'general request': 1, 'special request': 2, 'duplication': 3, 'duplication request': 3, 'improvement': 4, 'improvement special': 5 }[String(text).trim().toLowerCase()] ?? null;
}

export function handlerId(value, name) {
  const match = String(value ?? '').trim().match(/^(detailData|edit)\(\s*['"]?(\d+)['"]?\s*\);?$/);
  return match?.[1] === name ? match[2] : null;
}
