// fetchOriginal: an uploaded file on an order line (cart uploads: "_Print file", "_<Spot> print file", "_Print file N",
// "Design N", "<Spot> artwork", "_Mockup"..., or a #cc-dl= download link) in its OWN format: the CDN gives browsers a
// WebP for an image unless the request asks for the file's own type (CCPrint.fetchUpload's Accept), and PNGs lose any
// APNG chunks (CCPrint.plainPng: v24-v25 marked print PNGs as one-frame APNGs). The name: the link's `n`, else the
// hint (the property's file name), else the upload's own name; its extension follows what the CDN sent.
import { parseDlLink, uploadName, extOf, safeName, isDlLink } from './links.js';
import { cdnBase, seeUrl } from './shop.js';

// CCPrint's TYPES / EXTS (+ ai and psd, which the builders accept as uploads)
export const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf', tif: 'image/tiff', tiff: 'image/tiff', avif: 'image/avif', heic: 'image/heic', zip: 'application/zip' };
export const EXTS = { 'image/png': 'png', 'image/apng': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'application/pdf': 'pdf', 'image/tiff': 'tif', 'image/avif': 'avif', 'application/zip': 'zip' };
const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];

// CCPrint.plainPng: a PNG without its APNG chunks (acTL, fcTL, fdAT), everything else byte for byte
export async function plainPng(blob) {
  const b = new Uint8Array(await blob.arrayBuffer());
  if (b.length < 8 || PNG_SIG.some((x, i) => b[i] !== x)) return blob;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const parts = [b.subarray(0, 8)];
  let dropped = 0;
  for (let p = 8; p + 12 <= b.length; ) {
    const type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
    const end = p + 12 + v.getUint32(p);
    if (end > b.length) return blob;
    if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') dropped++;
    else parts.push(b.subarray(p, end));
    p = end;
    if (type === 'IEND') break;
  }
  return dropped ? new Blob(parts, { type: 'image/png' }) : new Blob([b], { type: 'image/png' });
}

async function isPng(blob) {
  const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  return head.length === 8 && PNG_SIG.every((x, i) => head[i] === x);
}

// where to fetch a value from, and what it's called: { url, name, png } (throws if it isn't an uploaded file)
export function resolveOriginal(value, nameHint, ctx) {
  const v = String(value == null ? '' : value).trim();
  if (isDlLink(v)) {
    const d = parseDlLink(v);
    if (!d.ok) throw new Error(`Not a download link: ${d.reason}.`);
    // the shop's own CDN folder (cdn.shopify.com answers any page); else the shop's own address for its uploads
    const base = ctx ? cdnBase(ctx) : '';
    const url = base ? `${base}uploads/${encodeURIComponent(d.u)}` : `https://${d.host}/cdn/shop/uploads/${encodeURIComponent(d.u)}`;
    return { url, name: d.n || d.u, png: d.png, upload: d.u };
  }
  let url = v;
  if (/^\/\//.test(url)) url = 'https:' + url;
  if (!/^https?:\/\//i.test(url)) throw new Error('Not a file on Shopify.');
  if (ctx) seeUrl(ctx, url);
  const u = uploadName(url);
  const own = u || decodeURIComponent((url.split(/[?#]/)[0].split('/').pop() || '').trim());
  let name = nameHint ? String(nameHint) : own;
  // a hint without an extension gets the file's own
  if (nameHint && !extOf(name) && extOf(own)) name = `${name}.${extOf(own)}`;
  return { url, name: name || own || 'download', png: false, upload: u };
}

// -> { blob, filename, type, url, size }
export async function fetchOriginal(value, nameHint, ctx) {
  const r0 = resolveOriginal(value, nameHint, ctx);
  const f = ctx && typeof ctx.fetch === 'function' ? ctx.fetch.bind(globalThis) : fetch;
  const want = TYPES[extOf(r0.upload || r0.url.split(/[?#]/)[0])];
  const res = await f(r0.url, { headers: { Accept: want ? want + ',*/*;q=0.1' : '*/*' }, credentials: 'omit', cache: 'no-store' });
  if (!res.ok) throw new Error(res.status === 404 ? `${r0.name}: the file is no longer on Shopify` : `${r0.name}: Shopify answered ${res.status}`);
  let blob = await res.blob();
  const type = (res.headers.get('content-type') || blob.type || '').split(';')[0].trim().toLowerCase();
  if (r0.png || type === 'image/apng' || type === 'image/png' || (await isPng(blob))) blob = await plainPng(blob);
  else if (type && blob.type !== type) blob = new Blob([blob], { type });
  // the CDN may hand back another format (e.g. a TIFF as JPEG): the name gets that format's extension (CCPrint.runDl)
  let name = safeName(r0.name, r0.upload || 'download');
  const ext = EXTS[type];
  const own = extOf(name);
  if (ext && own && ext !== own && !(ext === 'jpg' && own === 'jpeg') && !(ext === 'tif' && own === 'tiff')) name = name.replace(/\.[A-Za-z0-9]{1,8}$/, '.' + ext);
  else if (ext && !own) name = `${name}.${ext}`;
  return { blob, filename: name, type: blob.type || type, url: r0.url, size: blob.size };
}
