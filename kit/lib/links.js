// Print links and download links on order lines (CCPrint.printLink / CCPrint.downloadLink in assets/cc-print.js):
//   print link:    https://www.chaoscreations.scot/products/<handle>#cc-print=<base64url JSON job>
//   download link: https://<shop domain>/products/<handle>#cc-dl=<base64url JSON { u: upload file name, n: save as, png? }>
//   cart upload:   https://cdn.shopify.com/s/files/1/<shop>/uploads/<hex>.<ext>
// Browser versions of CCPrint.readJob / readDl / uploadName (same patterns, same answers).

const JOB_RE = /(?:^#|&)cc-print=([A-Za-z0-9_-]+)/; // CCPrint.readJob
const DL_RE = /(?:^#|&)cc-dl=([A-Za-z0-9_-]+)/; // CCPrint.readDl
const UPLOAD_RE = /\/uploads\/([A-Za-z0-9_-][A-Za-z0-9_.-]{0,200})(?:[?#]|$)/; // CCPrint.uploadName
export const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{0,254}$/i;
const te = new TextEncoder();

export function b64url(str) {
  const b = te.encode(String(str));
  let bin = '';
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function unb64url(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(b);
}

export const isPrintLink = (v) => typeof v === 'string' && /#cc-print=/.test(v);
export const isDlLink = (v) => typeof v === 'string' && /#cc-dl=/.test(v);

// the job in a hash (#cc-print=...), as CCPrint.readJob reads it: an object, or null
export function jobOfHash(hash) {
  const m = JOB_RE.exec(String(hash || ''));
  if (!m) return null;
  try {
    const j = JSON.parse(unb64url(m[1]));
    return j && typeof j === 'object' ? j : null;
  } catch (e) {
    return null;
  }
}

// a cart upload URL (…/uploads/<name>) -> '<name>' ('' if it isn't one), as CCPrint.uploadName
export function uploadName(v) {
  const m = typeof v === 'string' && /^https?:\/\/|^\/\//.test(v) ? UPLOAD_RE.exec(v) : null;
  return m && m[1].indexOf('..') < 0 ? m[1] : '';
}

function urlOf(value) {
  try {
    return new URL(String(value).trim());
  } catch (e) {
    return null;
  }
}

function handleOf(u) {
  const m = /^\/products\/([^/]+)\/?$/.exec(u.pathname);
  let h = '';
  try {
    h = m ? decodeURIComponent(m[1]) : '';
  } catch (e) {
    h = '';
  }
  return HANDLE_RE.test(h) ? h : '';
}

// One print link -> { ok: true, handle, job, host } or { ok: false, reason }
export function parsePrintLink(value) {
  if (!isPrintLink(value)) return { ok: false, reason: 'not a print link' };
  const u = urlOf(value);
  if (!u || !/^https?:$/.test(u.protocol)) return { ok: false, reason: 'not a web link' };
  const handle = handleOf(u);
  if (!handle) return { ok: false, reason: 'not a product link' };
  const job = jobOfHash(u.hash);
  if (!job) return { ok: false, reason: 'the print job in the link is unreadable' };
  return { ok: true, handle, job, host: u.hostname.toLowerCase() };
}

// a safe name to save as (CCPrint's safeName): no folders, no control characters, at most 150 characters
export function safeName(n, fallback) {
  let s = String(n == null ? '' : n)
    .replace(/[\\/]+/g, '-')
    .replace(/[\u0000-\u001f\u007f<>:"|?*]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  if (!s) s = fallback || 'download';
  if (s.length > 150) {
    const e = extOf(s);
    s = s.slice(0, 150 - (e ? e.length + 1 : 0)).trim() + (e ? '.' + e : '');
  }
  return s;
}

export function extOf(name) {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
}

// One download link (#cc-dl=) -> { ok: true, handle, u, n, png, host } or { ok: false, reason }, as CCPrint.readDl
export function parseDlLink(value) {
  if (!isDlLink(value)) return { ok: false, reason: 'not a download link' };
  const url = urlOf(value);
  if (!url) return { ok: false, reason: 'not a web link' };
  const m = DL_RE.exec(url.hash || '');
  if (!m) return { ok: false, reason: 'not a download link' };
  try {
    const d = JSON.parse(unb64url(m[1]));
    const u = d && typeof d.u === 'string' ? uploadName('https://x/uploads/' + d.u) : '';
    if (!u || u !== d.u) return { ok: false, reason: 'the file in the link is unreadable' };
    return { ok: true, handle: handleOf(url), u, n: safeName(d.n, u), png: !!d.png, host: url.hostname.toLowerCase() };
  } catch (e) {
    return { ok: false, reason: 'the file in the link is unreadable' };
  }
}

// the shop's CDN folder from any of its file URLs: https://cdn.shopify.com/s/files/1/1028/0966/5885/
const CDN_RE = /^https?:\/\/cdn\.shopify\.com\/s\/files\/((?:\d+\/)+)(?:files|uploads)\//i;
export function cdnBaseOf(url) {
  const m = CDN_RE.exec(String(url || ''));
  return m ? `https://cdn.shopify.com/s/files/${m[1]}` : '';
}
