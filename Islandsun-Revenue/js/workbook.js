export function createRevenueWorkbook(finalData, XLSX) {
  const worksheet = XLSX.utils.json_to_sheet(finalData);
  const idrFormat = '_-"Rp"* #,##0.00_-;-"Rp"* #,##0.00_-;_-"Rp"* "-"??_-;_-@_-';
  const usdFormat = '_-$* #,##0.00_-;-$* #,##0.00_-;_-$* "-"??_-;_-@_-';
  const range = XLSX.utils.decode_range(worksheet['!ref']);

  for(let R = 1; R <= range.e.r; ++R) {
    const cellH = worksheet[XLSX.utils.encode_cell({c:7, r:R})];
    if(cellH) cellH.z = idrFormat;
    const cellI = worksheet[XLSX.utils.encode_cell({c:8, r:R})];
    if(cellI) cellI.z = idrFormat;

    worksheet[XLSX.utils.encode_cell({c:9, r:R})] = { t: 'n', f: `G${R+1}*I${R+1}`, z: idrFormat };
    worksheet[XLSX.utils.encode_cell({c:10, r:R})] = { t: 'n', f: `J${R+1}*1.11`, z: idrFormat };
    worksheet[XLSX.utils.encode_cell({c:11, r:R})] = { t: 'n', f: `J${R+1}/H${R+1}`, z: usdFormat };
    worksheet[XLSX.utils.encode_cell({c:12, r:R})] = { t: 'n', f: `K${R+1}/H${R+1}`, z: usdFormat };
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Revenue");

  return workbook;
}

export function revenueFilename(startMonthVal, endMonthVal) {
  const [sYear, sMonth] = startMonthVal.split('-');
  const [eYear, eMonth] = endMonthVal.split('-');
  const startLabel = `${sMonth}-${sYear.substring(2)}`;
  const endLabel = `${eMonth}-${eYear.substring(2)}`;
  const fileName = startMonthVal === endMonthVal ? `Revenue ${startLabel}.xlsx` : `Revenue ${startLabel} to ${endLabel}.xlsx`;

  return fileName;
}
