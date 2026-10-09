import { readSampleProducts } from './portal-data.js';
import { readTirRecordProducts, readTirSourceProducts } from './tir-source-data.js';
import { isTirSourceUrl } from './tir-source-logic.js';

export function readProducts(url, signal, options) {
  if (isTirSourceUrl(url)) return readTirSourceProducts(url, signal, options);
  if (/\/master\/tir\/edit\//i.test(url)) return readTirRecordProducts(url, signal, options);
  return readSampleProducts(url, signal, options);
}
