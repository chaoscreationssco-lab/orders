// mockup(line, ctx): the picture of an order line for the Orders page, drawn by the builders' own mock-up code
// (gen/*.js, copied from the theme): our patches like the patch listing's live mock-up (cc-patch-customiser) in the
// size, edge and colour ordered; our designs on one-off patches / the Design Patch (cc-one-off-patch); our one colour
// shirt designs in the colour ordered, and (v33) any design shirt's "Pocket + Back Print" with the designs swapped in
// (cc-shirt-ink); badges with our designs (cc-custom-badge). Each is the same
// picture the customer's cart showed (600 x 600 JPEG). Custom lines: their "_Mockup" (CONTRACT C1), or an older
// line's "_Cart image", else the customer's own artwork, else the listing's photo. -> Blob, or null.
import * as PC from '../gen/pc.js';
import * as OP from '../gen/op.js';
import * as SHIRT from '../gen/shirt.js';
import * as BADGE from '../gen/badge.js';
import { productByHandle, fileUrl, seeUrl } from './shop.js';
import { designPreview } from './designfile.js';
import { fetchOriginal } from './original.js';
import { attr, attrsOf, printLinksOf, artworkOf, isRasterName, variantParts } from './lines.js';
import { HANDLE_RE } from './links.js';
import { queued } from './queue.js';

const THUMB = 800; // longest side of a picture made from an upload

const fetchOf = (ctx) => (typeof ctx.fetch === 'function' ? ctx.fetch.bind(globalThis) : fetch);

// a file on the CDN as a same-page blob: URL (so canvases that draw it stay readable). Remember to revoke.
async function blobUrl(url, ctx, accept) {
  const r = await fetchOf(ctx)(url, { headers: { Accept: accept || 'image/png,image/jpeg,image/webp,*/*;q=0.1' }, credentials: 'omit' });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return URL.createObjectURL(await r.blob());
}

function imageFrom(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('picture'));
    img.src = src;
  });
}

// the listing photo's corner colour, as the live mock-ups take their background from it (else white)
async function cornerColour(url, ctx) {
  if (!url) return '#ffffff';
  let u = '';
  try {
    u = await blobUrl(url, ctx);
    const img = await imageFrom(u);
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 4;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, 8, 8, 0, 0, 4, 4);
    const d = g.getImageData(0, 0, 1, 1).data;
    return d[3] > 200 ? `rgb(${d[0]},${d[1]},${d[2]})` : '#ffffff';
  } catch (e) {
    return '#ffffff';
  } finally {
    if (u) URL.revokeObjectURL(u);
  }
}

// the KIT's answer to the builders' /products/<handle>?view=cc-design requests (everything else: the network)
function designRouter(ctx) {
  const f = fetchOf(ctx);
  return async (url, opts) => {
    const m = /\/products\/([^/?#]+)\?view=cc-design\b/.exec(String(url));
    if (!m) return f(url, opts);
    const d = await designPreview(decodeURIComponent(m[1]), ctx).catch(() => null);
    if (!d || !d.file) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify({ ...d, url: `/products/${d.handle}`, alt: '' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
}

const blank = (ctx, edge) => fileUrl(ctx, edge === 'stitched' ? 'cc-patch-blank-stitched.webp' : 'cc-patch-blank-cut.webp');

/* ---------- patch listings (cc-patch-customiser) ---------- */
class PcMock extends PC.Members {
  update() {}
  paint() {}
  paintNow() {}
  takeJob() {}
  $() {
    return null;
  }
  showError() {}
}

async function patchMock(line, ctx, facts) {
  const job = (printLinksOf(line).find((l) => l.kind === 'pc') || {}).job || null;
  const v = variantParts(line);
  const back = facts.templateSuffix === 'bapas';
  const s = job ? job.s : back ? PC.BACK_SIZE : v[0];
  const e = job ? job.e : back ? v[0] : v[1];
  const c = job ? job.c : back ? v[1] : v[2];
  const hex = PC.normHex((job && job.x) || attr(line, 'Custom colour')) || '#3FA9F5';
  const prev = await designPreview(facts.handle, ctx);
  if (!prev || !prev.file) return null;
  const urls = [];
  try {
    const [design, cut, stitched] = await Promise.all([blobUrl(prev.file, ctx), blobUrl(blank(ctx, 'cut'), ctx), blobUrl(blank(ctx, 'stitched'), ctx)]);
    urls.push(design, cut, stitched);
    const page = new PcMock();
    page.cfg = { kind: back ? 'back' : 'patch', handle: facts.handle, files: { design, cut, stitched } };
    page.state = { size: s, edge: PC.EDGES[e] ? e : 'Cut Edge', colour: c === PC.CUSTOM || PC.COLOURS.some((x) => x[0] === c) ? c : 'White', hex, qty: 1 };
    page.design = await PC.loadImage(design);
    page.box = PC.inkBox(page.design);
    if (!page.box) return null;
    page.bg = await cornerColour(facts.image, ctx);
    return await page.cartImage();
  } finally {
    urls.forEach((u) => URL.revokeObjectURL(u));
  }
}

/* ---------- our designs on one-off patches and the Design Patch (cc-one-off-patch) ---------- */
class OpMock extends OP.Members {
  update() {}
  paint() {}
  paintNow() {}
  ensureFont() {}
  altInfo() {}
  $() {
    return null;
  }
  showError() {}
}

async function oneOffMock(line, ctx) {
  const job = (printLinksOf(line).find((l) => l.kind === 'op') || {}).job || null;
  const handle = job ? job.d : attr(line, '_Design');
  if (!handle) return null;
  const v = variantParts(line);
  const state = { size: v[0], edge: v[1], mode: 'ours', qty: 1, text: '', font: '', colour: 'White', hex: '#FFFFFF', terms: false, ownW: 20, ownH: 20 };
  // your own size: "Size" = "12 × 25 cm" (the line's variant is a price step)
  const own = /([\d.]+)\s*[×x]\s*([\d.]+)\s*cm/i.exec(attr(line, 'Size'));
  if (job) {
    state.size = job.s;
    state.edge = job.e;
    if (job.s === OP.OWN) {
      state.ownW = +job.w || 20;
      state.ownH = +job.h || 20;
    }
    if (job.c === 'custom' && OP.normHex(job.x)) {
      state.colour = 'custom';
      state.hex = OP.normHex(job.x);
    } else if (OP.COLOURS.some((x) => x[0] === job.c)) state.colour = job.c;
  } else {
    if (own) {
      state.size = OP.OWN;
      state.ownW = +own[1];
      state.ownH = +own[2];
      state.edge = v.find((x) => OP.EDGES[x]) || 'Cut Edge';
    }
    const pc = attr(line, 'Print colour');
    const cm = /^Custom\s+(#[0-9a-f]{3,6})$/i.exec(pc);
    if (cm && OP.normHex(cm[1])) {
      state.colour = 'custom';
      state.hex = OP.normHex(cm[1]);
    } else if (OP.COLOURS.some((x) => x[0] === pc)) state.colour = pc;
  }
  if (!OP.EDGES[state.edge]) state.edge = 'Cut Edge';
  const urls = [];
  try {
    const [cut, stitched] = await Promise.all([blobUrl(blank(ctx, 'cut'), ctx), blobUrl(blank(ctx, 'stitched'), ctx)]);
    urls.push(cut, stitched);
    const page = new OpMock();
    page.cfg = { handle: (line.product && line.product.handle) || 'custom-patch', files: { cut, stitched } };
    page.state = state;
    page.fonts = [];
    page.upload = null;
    page.bg = '#ffffff';
    OP.__setFetch(designRouter(ctx));
    try {
      page.ours = await page.loadDesign(handle);
    } finally {
      OP.__setFetch(null);
    }
    return await page.cartImage();
  } finally {
    urls.forEach((u) => URL.revokeObjectURL(u));
  }
}

/* ---------- our design shirts (cc-shirt-ink) ---------- */
class ShirtMock extends SHIRT.Members {
  update() {}
  paint() {}
  paintNow() {}
  syncLink() {}
  syncCarry() {}
  syncPrints() {}
  $() {
    return null;
  }
  get print() {
    return this._print;
  }
}

// v33 (CONTRACT C3): the builder can swap the pocket and back prints of "Pocket + Back Print" for our other designs
const SHIRT_SWAPS = typeof SHIRT.Members.prototype.swapAt === 'function';

async function shirtMock(line, ctx, facts) {
  const job = (printLinksOf(line).find((l) => l.kind === 'shirt') || {}).job || null;
  const metaTrue = (m) => !!(m && (m.value === true || m.value === 'true'));
  const mono = metaTrue(facts.designMono);
  // the live mock-up needs the design's small preview (custom.cc_previews "s"): without one, the listing's photo
  const prev = await designPreview(facts.handle, ctx);
  if (!prev || !prev.file) return null;
  const spots = job && Array.isArray(job.p) ? job.p : [];
  const t = (v) => String(v || '').toLowerCase();
  const variant = t(variantParts(line).join(' '));
  const print = spots.length
    ? { chest: spots.includes('chest') && !spots.includes('pocket') && !spots.includes('back'), pocket: spots.includes('pocket'), back: spots.includes('back') }
    : { chest: !/pocket|back/.test(variant), pocket: /pocket/.test(variant), back: /back/.test(variant) };
  // one colour designs: always (the colour picker's mock-up); v33: any design shirt's "Pocket + Back Print" too.
  // Everything else shows the listing's photo, as in the cart.
  const both = print.pocket && print.back;
  if (!mono && !(SHIRT_SWAPS && both)) return null;
  const ink = (facts.designInk && facts.designInk.value) || '#FFFFFF';
  let hex = mono ? SHIRT.normHex(job && job.x) : null;
  if (!hex && mono) {
    const pc = attr(line, 'Print colour');
    const named = SHIRT.INKS.find((x) => x[0] === pc);
    const cm = /^Custom\s+(#[0-9a-f]{3,6})$/i.exec(pc);
    hex = named ? named[1] : cm ? SHIRT.normHex(cm[1]) : null;
  }
  // (the builder starts from the listing's ink, custom.design_ink, else white)
  if (!hex) hex = SHIRT.normHex(ink) || '#FFFFFF';
  const page = new ShirtMock();
  page._print = print;
  page.cfg = { handle: facts.handle, title: facts.title, name: prev.name, mono, pick: mono, design: prev.file, photo: fileUrl(ctx, 'GildanShirtLiveMock-Black.png'), ink };
  page.mono = mono;
  page.pick = mono;
  page.preview = prev.file;
  page.swap = { pocket: null, back: null };
  page.job = null;
  const same = SHIRT.INKS.find((x) => x[1] === hex);
  page.state = same ? { ink: same[0], hex } : { ink: 'custom', hex };
  page.design = await SHIRT.loadImage(SHIRT.withParam(page.cfg.design, 'width=1200'));
  page.box = SHIRT.inkBox(page.design);
  if (!page.box) return null;
  // the designs swapped in (the print link's "dp"), each from its own small preview, as the builder showed them
  const dp = SHIRT_SWAPS && both && job && job.dp && typeof job.dp === 'object' ? job.dp : null;
  if (dp && typeof page.loadDesign === 'function') {
    SHIRT.__setFetch(designRouter(ctx));
    try {
      for (const s of ['pocket', 'back']) {
        const h = typeof dp[s] === 'string' ? dp[s] : '';
        if (!h || !HANDLE_RE.test(h) || h === facts.handle) continue;
        // (a design that can't be shown any more: no mock-up, rather than the wrong design on it)
        page.swap[s] = await page.loadDesign(h);
      }
    } finally {
      SHIRT.__setFetch(null);
    }
  }
  page.bg = await cornerColour(facts.image, ctx);
  const th = await page.cartImage();
  return th ? th.blob : null;
}

/* ---------- badges with our designs (cc-custom-badge) ---------- */
class BadgeMock extends BADGE.Members {
  update() {}
  renderAll() {}
  renderStage() {}
  refreshThumb() {}
  altInfo() {}
  printSay() {}
  printNote() {}
  $() {
    return null;
  }
  querySelector() {
    return null;
  }
}

async function badgeMock(line, ctx) {
  const links = printLinksOf(line).filter((l) => l.kind === 'badge');
  if (!links.length) return null;
  // a design that's the customer's own upload can't be drawn here (its place isn't on the line): _Mockup covers it
  if (attrsOf(line).some((a) => /^Design \d+( back)?$/.test(a.key) && /^https?:|^\/\//.test(String(a.value || '')))) return null;
  if (attrsOf(line).some((a) => /^_Design \d+( back)? file$/.test(a.key))) return null;
  const first = links[0].job;
  if (!BADGE.KINDS[first.item]) return null;
  const page = new BadgeMock();
  page.kind = first.item;
  page.k = BADGE.KINDS[first.item];
  page.sizes = [first.size];
  page.state = { size: first.size, mode: 'single', designs: [], active: 0, guides: true, view: 'front', band: '', notes: '', terms: false };
  page.photos = {};
  BADGE.__setFetch(designRouter(ctx));
  try {
    const jobs = links.map((l) => l.job).sort((a, b) => (+a.n || 0) - (+b.n || 0));
    let id = 0;
    for (const job of jobs) {
      const bg = (BADGE.normHex(job.bg) || '#FFFFFF').toLowerCase();
      const o = await page.loadDesign(job.h, bg);
      const ink = BADGE.normHex(job.ink);
      if (o.mono && ink) {
        o.hex = ink;
        o.ink = 'custom';
        o.inkAuto = false;
      }
      const d = { id: ++id, how: 'ours', ours: o, art: null, place: null, bg, qty: Math.max(1, Math.round(+job.q) || 1), portrait: !!job.portrait, search: '', up: null };
      page.state.designs.push(d);
      await page.paintDesign(o);
      d.art = page.designArt(o);
      if (job.p && +job.p.s > 0) {
        d.place = { s: +job.p.s, dx: +job.p.dx || 0, dy: +job.p.dy || 0, fit: null };
        page.clampPlace(d);
      } else page.fitFace(d);
    }
    return await page.cartPicture();
  } finally {
    BADGE.__setFetch(null);
  }
}

/* ---------- uploads and photos ---------- */
// a picture file, at most THUMB px on its longest side (PNG, so see-through stays see-through)
async function thumbOf(blob) {
  let src = '';
  try {
    src = URL.createObjectURL(blob);
    const img = await imageFrom(src);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return null;
    const k = Math.min(1, THUMB / Math.max(w, h));
    if (k === 1 && /^image\/(png|jpeg|webp|gif)$/.test(blob.type)) return blob;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k));
    c.height = Math.max(1, Math.round(h * k));
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((r) => c.toBlob(r, 'image/png'));
  } catch (e) {
    return null;
  } finally {
    if (src) URL.revokeObjectURL(src);
  }
}

async function photoOf(url, ctx) {
  if (!url) return null;
  const u = /cdn\.shopify\.com|\/cdn\/shop\//.test(url) && !/[?&]width=/.test(url) ? url + (url.includes('?') ? '&' : '?') + 'width=600' : url;
  const r = await fetchOf(ctx)(u, { headers: { Accept: 'image/jpeg,image/png,*/*;q=0.1' }, credentials: 'omit' });
  return r.ok ? r.blob() : null;
}

// -> Blob (the picture) or null (one at a time with the print files: lib/queue.js)
export function mockup(line, ctx, opts = {}) {
  return queued(() => draw(line, ctx, opts), ctx);
}

async function draw(line, ctx, opts) {
  if (!line) return null;
  attrsOf(line).forEach((a) => seeUrl(ctx, a.value));
  if (line.image && line.image.url) seeUrl(ctx, line.image.url);
  const tries = [];
  const mk = attr(line, '_Mockup');
  if (mk) tries.push(() => fetchOriginal(mk, 'mockup.jpg', ctx).then((r) => r.blob));
  const suffix = (line.product && line.product.templateSuffix) || '';
  const handle = (line.product && line.product.handle) || '';
  let facts = null;
  if (handle) facts = await productByHandle(handle, ctx).catch(() => null);
  if (facts && (facts.templateSuffix === 'patches' || facts.templateSuffix === 'bapas')) tries.push(() => patchMock(line, ctx, facts));
  if (attr(line, '_Design') && !/^(patches|bapas|shirts)$/.test(suffix)) tries.push(() => oneOffMock(line, ctx));
  if (facts && facts.templateSuffix === 'shirts') tries.push(() => shirtMock(line, ctx, facts));
  if (printLinksOf(line).some((l) => l.kind === 'badge')) tries.push(() => badgeMock(line, ctx));
  const ci = attr(line, '_Cart image');
  if (ci) tries.push(() => fetchOriginal(ci, 'cart-image.jpg', ctx).then((r) => r.blob));
  if (!mk && !opts.noArtwork)
    artworkOf(line)
      .filter((a) => isRasterName(a.name || a.value))
      .slice(0, 1)
      .forEach((a) => tries.push(() => fetchOriginal(a.value, a.name, ctx).then((r) => thumbOf(r.blob))));
  const photo = (line.image && line.image.url) || (facts && facts.image) || '';
  if (photo) tries.push(() => photoOf(photo, ctx));
  for (const t of tries) {
    try {
      const b = await t();
      if (b && b.size) return b;
    } catch (e) {
      if (opts.onError) opts.onError(e);
    }
  }
  return null;
}

// (the drawing code these mock-ups run)
export const SOURCES = { pc: PC.SOURCE, op: OP.SOURCE, shirt: SHIRT.SOURCE, badge: BADGE.SOURCE };
