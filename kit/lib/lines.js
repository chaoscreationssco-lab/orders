// Order lines as the Orders page reads them (Admin GraphQL LineItem: name, sku, quantity, variantTitle,
// product { handle templateSuffix }, customAttributes [{ key, value }], image { url }): what's on each one.
import { isPrintLink, parsePrintLink, isDlLink, parseDlLink, uploadName, extOf } from './links.js';
import { jobKind } from './print.js';

export const attrsOf = (line) => (Array.isArray(line && line.customAttributes) ? line.customAttributes.filter((a) => a && a.key != null) : []);

export function attr(line, key) {
  const a = attrsOf(line).find((x) => x.key === key);
  return a ? String(a.value == null ? '' : a.value) : '';
}

export const isUploadUrl = (v) => !!uploadName(String(v || '').trim());

// every print link on the line, in property order: [{ key, value, handle, job, kind }]
export function printLinksOf(line) {
  return attrsOf(line)
    .filter((a) => isPrintLink(a.value))
    .map((a) => {
      const p = parsePrintLink(a.value);
      return p.ok ? { key: a.key, value: a.value, handle: p.handle, job: p.job, kind: jobKind(p.job) } : { key: a.key, value: a.value, error: p.reason };
    });
}

// Print files uploaded with the line (made in the customer's browser): "_Print file", "_Print file 2", "_Front print
// file", "_Side 1 print file", "_Design 1 print file" (older ports), "_Print files" (zip) -> [{ key, url, what }]
const PRINT_KEY = /^_(?:(.+?) )?print files?(?: (\d+))?$/i;
export function uploadedPrintFilesOf(line) {
  return attrsOf(line)
    .filter((a) => PRINT_KEY.test(a.key) && isUploadUrl(a.value))
    .map((a) => {
      const m = PRINT_KEY.exec(a.key);
      const what = [m[1], m[2]].filter(Boolean).join(' ').toLowerCase();
      return { key: a.key, url: String(a.value).trim(), what };
    });
}

// The customer's own artwork on the line: uploads under their own keys ("Front artwork", "Artwork", "Design 1",
// "Design 1 back") and, after CCPrint.finishLine, the download links next to them ("_Front artwork file": #cc-dl=,
// with the original name) -> [{ key, value, name, what }]
export function artworkOf(line) {
  const out = [];
  const seen = new Set();
  attrsOf(line).forEach((a) => {
    const v = String(a.value == null ? '' : a.value).trim();
    if (/^_/.test(a.key) && / file$/i.test(a.key) && isDlLink(v)) {
      const base = a.key.replace(/^_/, '').replace(/ file$/i, '');
      const d = parseDlLink(v);
      if (!d.ok || seen.has(base)) return;
      seen.add(base);
      out.push({ key: base, value: v, name: d.n, what: base.replace(/ artwork$/i, '').toLowerCase() });
      return;
    }
    if (/^_/.test(a.key) || PRINT_KEY.test(a.key) || /^_?(?:mockup|cart image)$/i.test(a.key)) return;
    if (isUploadUrl(v) && !seen.has(a.key)) {
      seen.add(a.key);
      out.push({ key: a.key, value: v, name: '', what: a.key.replace(/ artwork$/i, '').toLowerCase() });
    }
  });
  return out;
}

const RASTER = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg']);
export const isRasterName = (n) => RASTER.has(extOf(String(n || '').split(/[?#]/)[0]));

// the line's variant options, from its title ("10x10cm / Cut Edge / White")
export const variantParts = (line) =>
  String((line && line.variantTitle) || '')
    .split(' / ')
    .map((s) => s.trim())
    .filter(Boolean);
