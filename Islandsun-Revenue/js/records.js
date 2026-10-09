export function getSoMagnitude(soStr) {
  const romans = { "I":1,"II":2,"III":3,"IV":4,"V":5,"VI":6,"VII":7,"VIII":8,"IX":9,"X":10,"XI":11,"XII":12 };
  const parts = soStr.split('/');
  if(parts.length < 5) return 0;
  return (parseInt(parts[4],10)*1000000) + ((romans[parts[3]]||0)*10000) + parseInt(parts[0],10);
}

export function extractData(html, targetSO, id) {
  const finalData = [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const branchEl = doc.querySelector('select[name="dt[so_branch_code]"]');
  let branch = branchEl && branchEl.options[branchEl.selectedIndex] ? branchEl.options[branchEl.selectedIndex].text : "N/A";
  if(branch === "--Choose Branch--") branch = "N/A";

  const salesEl = doc.querySelector('select[name="dt[so_sales_id]"]');
  const sales = salesEl && salesEl.options[salesEl.selectedIndex] ? salesEl.options[salesEl.selectedIndex].text : "N/A";

  const customerEl = doc.querySelector('select[name="dt[so_customer_id]"]');
  const customer = customerEl && customerEl.options[customerEl.selectedIndex] ? customerEl.options[customerEl.selectedIndex].text : "N/A";

  const kursEl = doc.querySelector('input[name="dt[so_kurs]"]');
  let kurs = kursEl ? parseFloat(kursEl.value || 1) : 1;
  if (kurs === 0) kurs = 1;

  const products = doc.querySelectorAll('input[name="dtd[sop_internal_code][]"]');
  const qtys = doc.querySelectorAll('input[name="dtd[sop_qty][]"]');
  const prices = doc.querySelectorAll('input[name="dtd[sop_unit_price][]"]');

  for (let j = 0; j < products.length; j++) {
    const prodName = products[j] ? products[j].value : "N/A";
    const qty = qtys[j] ? parseFloat(qtys[j].value || 0) : 0;
    const price = prices[j] ? parseFloat(prices[j].value || 0) : 0;

    finalData.push({
      "SO ID": id,
      "SO Number": targetSO,
      "Cabang": branch,
      "Sales": sales,
      "Customer": customer,
      "Product": prodName,
      "Quantity": qty,
      "Exchange Rate": kurs,
      "Unit Price (IDR)": price,
      "Price IDR": 0,
      "Price IDR (Tax)": 0,
      "Price USD": 0,
      "Price USD (Tax)": 0
    });
  }
  return finalData;
}
