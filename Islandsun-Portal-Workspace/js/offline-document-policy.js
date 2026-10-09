/** Generated Delivery Order print sheets are outside the requested offline coverage. */
export function includedOfflineDocuments(documents = []) {
  return documents.filter(document => document.format !== 'delivery-order-sheet');
}
