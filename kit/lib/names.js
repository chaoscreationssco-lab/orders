// Names (CONTRACT C6): one order's zip "16330.zip"; all open orders "Print files 15-10-2026.zip" (the download date);
// each file inside "16330-2 Patch358 20x20.png": order number, line position, the line's SKU, then a short word for
// the file (the patch size, the print spot "front" / "pocket" / "back", the badge size...), then its own type.
import { safeEntryName } from './zip.js';

const orderNo = (o) =>
  String(o == null ? '' : o)
    .replace(/^#/, '')
    .trim();

export function zipName(order) {
  return safeEntryName(`${orderNo(order) || 'order'}.zip`);
}

export function zipNameAll(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const p = (n) => String(n).padStart(2, '0');
  return `Print files ${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}.zip`;
}

// { order: '#16330', position: 2, sku: 'Patch358', what: '20x20', filename: '…png' | ext: 'png' }
export function entryName({ order, position, sku, what, filename, ext } = {}) {
  const e = (ext || (/\.([A-Za-z0-9]{1,8})$/.exec(String(filename || '')) || [])[1] || 'bin').toLowerCase();
  const parts = [`${orderNo(order) || 'order'}-${position != null ? position : 0}`];
  if (sku) parts.push(String(sku).trim());
  if (what) parts.push(String(what).trim());
  return safeEntryName(`${parts.join(' ')}.${e}`);
}
