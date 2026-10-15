// Our designs' files from Admin data, exactly as the theme's two Liquid views give them:
//   designFile(handle, ctx): templates/product.cc-file.liquid (the FULL-SIZE design, team only on the website) ->
//     the same object CCPrint.designFile returns: { url, dark, mono, ink, handle, title, kind }, or null with
//     designFile.lastError 'no file' | 'failed' (as CCPrint.lastError).
//   designPreview(handle, ctx): templates/product.cc-design.liquid (the small preview the builders show) ->
//     { handle, title, name, kind, mono, ink, file, dark, image } or null.
// Liquid semantics mirrored (as in the old print job's lib/ccfile.mjs, unit tested on every branch): remove / strip /
// plus with Ruby rules, blank?, default, {{ true }}. file_url -> the file on the shop's CDN (cdn.shopify.com, which
// answers any page: Access-Control-Allow-Origin *).
import { productByHandle, shopData, fileUrl } from './shop.js';

const RUBY_WS = /^[\t\n\v\f\r \0]+|[\t\n\v\f\r \0]+$/g;
export const rubyStrip = (s) => String(s).replace(RUBY_WS, '');

// Ruby String#to_i
export function rubyToI(s) {
  const m = /^[\t\n\v\f\r ]*([+-]?)(\d+(?:_\d+)*)/.exec(String(s));
  if (!m) return 0;
  const n = parseInt(m[1] + m[2].replace(/_/g, ''), 10);
  return Object.is(n, -0) ? 0 : n;
}

// Liquid's `plus: 0` on a string: "12.5" -> a decimal, anything else -> to_i; { n, text } (text: how Liquid prints it)
export function liquidNumber(s) {
  const t = rubyStrip(s);
  const d = /^(-?)(\d+)\.(\d+)$/.exec(t);
  if (d) {
    const int = d[2].replace(/^0+(?=\d)/, '');
    let frac = d[3].replace(/0+$/, '');
    if (!frac) frac = '0';
    const text = `${d[1]}${int}.${frac}`;
    const n = Number(text);
    return { n, text: n === 0 ? '0.0' : text };
  }
  const n = rubyToI(s);
  return { n, text: String(n) };
}

export function isBlank(v) {
  if (v == null || v === false) return true;
  if (typeof v === 'string') return /^[\s ]*$/.test(v);
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
}

function liquidDefault(v, d) {
  if (v == null || v === false) return d;
  if ((typeof v === 'string' || Array.isArray(v)) && v.length === 0) return d;
  if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) return d;
  return v;
}

// Liquid's remove_last: the last occurrence, wherever it is
export function removeLast(s, sub) {
  s = String(s);
  const i = s.lastIndexOf(sub);
  return i < 0 ? s : s.slice(0, i) + s.slice(i + sub.length);
}

function metaValue(m) {
  if (!m) return null;
  if (m.type === 'boolean') return m.value === true || m.value === 'true';
  if (m.type === 'number_integer') return Number(m.value);
  return m.value;
}

// the patch number in a SKU, padded to 3 ('Patch117' -> '117', 'BAPA-216' -> '216', 'Patch7' -> '007'), or '' (none)
export function patchPad(sku) {
  const digits = rubyStrip(String(liquidDefault(sku, '')).split('BAPA-').join('').split('BAPA').join('').split('Patch').join('').split('PATCH').join(''));
  const { n, text } = liquidNumber(digits);
  if (!(n > 0)) return '';
  return n < 10 ? '00' + text : n < 100 ? '0' + text : text;
}

const hash = (o) => o && typeof o === 'object' && !Array.isArray(o);
// Liquid looks a string key up in hashes only
function lookup(obj, group, key) {
  const g = hash(obj) && Object.prototype.hasOwnProperty.call(obj, group) ? obj[group] : null;
  const v = hash(g) && Object.prototype.hasOwnProperty.call(g, key) ? g[key] : null;
  return typeof v === 'string' || typeof v === 'number' ? v : null;
}

// the cc-file view's JSON for one product (facts from shop.productByHandle, files = custom.cc_files)
export function ccFileJson(facts, files, ctx) {
  if (!facts) return { status: 404 };
  const suffix = facts.templateSuffix || '';
  let kind = 'design';
  let file = '';
  let dark = '';
  let mono = false;
  const inkRaw = liquidDefault(metaValue(facts.designInk), '');
  const ink = typeof inkRaw === 'string' ? inkRaw : String(inkRaw);
  if (suffix === 'patches' || suffix === 'bapas') {
    kind = suffix === 'bapas' ? 'back patch' : 'patch';
    mono = true;
    const pad = patchPad(facts.firstSku);
    if (pad) {
      const name = lookup(files, 'p', pad);
      if (!isBlank(name)) file = fileUrl(ctx, name);
      const dname = lookup(files, 'pd', pad);
      if (!isBlank(dname)) dark = fileUrl(ctx, dname);
    }
  } else {
    const df = facts.designFile;
    if (df) {
      if (suffix === 'shirts') kind = 'shirt';
      // the original file (Liquid: its name through image_url / url, then file_url): the reference's own URL
      if ((df.media === 'image' || df.media === 'file') && df.url && !isBlank(String(df.url).split('?')[0].split('/').pop())) file = df.url;
    }
    if (metaValue(facts.designMono) === true) mono = true;
  }
  if (isBlank(file)) return { status: 200, json: { handle: facts.handle, error: 'no file' } };
  return { status: 200, json: { handle: facts.handle, title: facts.title, kind, file, dark, mono, ink } };
}

// CCPrint.designFile from Admin data: { url, dark, mono, ink, handle, title, kind } | null (designFile.lastError says why)
export async function designFile(handle, ctx) {
  designFile.lastError = '';
  let facts;
  let shop;
  try {
    [facts, shop] = await Promise.all([productByHandle(handle, ctx), shopData(ctx)]);
  } catch (e) {
    designFile.lastError = 'failed';
    designFile.lastDetail = (e && e.message) || String(e);
    return null;
  }
  let r;
  try {
    r = ccFileJson(facts, shop.ccFiles, ctx);
  } catch (e) {
    designFile.lastError = 'failed';
    designFile.lastDetail = (e && e.message) || String(e);
    return null;
  }
  if (r.status !== 200) {
    designFile.lastError = r.status === 404 ? 'no file' : 'failed';
    return null;
  }
  const j = r.json;
  if (!j || j.error || !j.file) {
    designFile.lastError = (j && j.error) || 'no file';
    return null;
  }
  return { url: j.file, dark: j.dark || '', mono: !!j.mono, ink: j.ink || '', handle: j.handle || handle, title: j.title || '', kind: j.kind || '' };
}
designFile.lastError = '';

// the cc-design view (the small preview): { handle, title, name, kind, mono, ink, file, dark, image } | null
export async function designPreview(handle, ctx) {
  const [facts, shop] = await Promise.all([productByHandle(handle, ctx), shopData(ctx)]);
  if (!facts) return null;
  const prev = shop.ccPreviews;
  const suffix = facts.templateSuffix || '';
  let kind = '';
  let mono = false;
  let file = '';
  let dark = '';
  let name = facts.title;
  if (suffix === 'patches' || suffix === 'bapas') {
    kind = suffix === 'bapas' ? 'back patch' : 'patch';
    mono = true;
    const pad = patchPad(facts.firstSku);
    if (pad) {
      const pf = lookup(prev, 'p', pad);
      if (!isBlank(pf)) file = fileUrl(ctx, pf);
      const pdf = lookup(prev, 'pd', pad);
      if (!isBlank(pdf)) dark = fileUrl(ctx, pdf);
    }
    name = rubyStrip(removeLast(removeLast(name, ' Back Patch'), ' Patch'));
  } else if (suffix === 'shirts') {
    kind = 'shirt';
    const sf = lookup(prev, 's', facts.handle);
    if (!isBlank(sf)) file = fileUrl(ctx, sf);
    name = rubyStrip(removeLast(name, ' Shirt'));
    if (metaValue(facts.designMono) === true) mono = true;
  }
  const inkRaw = liquidDefault(metaValue(facts.designInk), '');
  return {
    handle: facts.handle,
    title: facts.title,
    name,
    kind,
    mono,
    ink: typeof inkRaw === 'string' ? inkRaw : String(inkRaw),
    file,
    dark,
    image: facts.image || '',
  };
}
