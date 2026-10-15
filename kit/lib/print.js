// makePrintFiles: a print link's job -> the print files the storefront's print page saves for it, made by the
// builders' own code (gen/*.js, copied verbatim from the theme sources by tools/extract.mjs) on the live engine.
// Each runner sets up only what that code reads from its page (the listing's handle, kind, garment...), from the job
// and the Admin data, and stands in for the page's UI (nothing is drawn, nothing is downloaded).
import * as PC from '../gen/pc.js';
import * as OP from '../gen/op.js';
import * as SHIRT from '../gen/shirt.js';
import * as TEE from '../gen/tee.js';
import * as TOTE from '../gen/tote.js';
import * as BADGE from '../gen/badge.js';
import { printTools } from './tools.js';
import { productByHandle } from './shop.js';
import { removeLast } from './designfile.js';
import { parsePrintLink, HANDLE_RE } from './links.js';
import { queued } from './queue.js';

export class KitError extends Error {
  constructor(code, message, extra) {
    super(message);
    this.name = 'KitError';
    this.code = code; // 'bad job' | 'no file' | 'failed' | 'not allowed' | 'wrong page'
    Object.assign(this, extra || {});
  }
}

// the builders' own words when a print link can't be made (P.status(..., true)), as the error message
function failed(capture, fallback) {
  const err = capture.status.filter(([, e]) => e).map(([t]) => t);
  return err.length ? err[err.length - 1] : fallback;
}

/* ---------- the runners: one per builder ---------- */
// The print link's own listing (its page): the builders check the link against it (garment, tote mode, badge kind)
// with their own words. If the listing can't be read (gone, or no access), the job's own values stand in for it.
async function listing(handle, ctx) {
  if (!handle) return null;
  try {
    return await productByHandle(handle, ctx);
  } catch (e) {
    return null;
  }
}
const metaText = (m) => (m && m.value != null && String(m.value).trim() ? String(m.value).trim() : '');

class PcPage extends PC.Members {
  update() {}
  paint() {}
  paintNow() {}
  takeJob() {}
  $() {
    return null;
  }
  showError(msg) {
    this._error = msg;
  }
}

// Patch customiser (patch and back patch listings): the link's own listing gives the name and the back listing's
async function pcFiles(handle, job, ctx, P) {
  const facts = await listing(handle, ctx);
  // (only patch and back patch listings have the customiser: anything else shows no print page at all)
  if (facts && !['patches', 'bapas'].includes(facts.templateSuffix)) throw new KitError('wrong page', `${handle} isn't a patch listing, so this print link has no print page.`);
  const back = facts ? facts.templateSuffix === 'bapas' : /-back-patch$/.test(handle);
  const page = new PcPage();
  page.cfg = { kind: back ? 'back' : 'patch', handle: facts ? facts.handle : handle, back: null };
  // 30x30cm on a patch listing is its back patch listing's variant: the file is named after that listing
  if (page.cfg.kind === 'patch' && job.s === PC.BACK_SIZE) {
    const other = await productByHandle(removeLast(page.cfg.handle, '-patch') + '-back-patch', ctx).catch(() => null);
    if (other && other.templateSuffix === 'bapas') page.cfg.back = { handle: other.handle, title: other.title };
  }
  page.failed = false;
  page.printing = true;
  await page.startPrint(P);
}

class OpPage extends OP.Members {
  update() {}
  paint() {}
  paintNow() {}
  ensureFont() {}
  $() {
    return null;
  }
  showError(msg) {
    this._error = msg;
  }
}

// One-off patch builder (Patch (One Off), Back Patch (One Off), Design Patch, own size) with one of our designs
async function opFiles(handle, job, ctx, P) {
  if (!HANDLE_RE.test(String(job.d || '')) || !/^[a-z0-9][a-z0-9-]{0,254}$/i.test(job.d)) throw new KitError('bad job', 'This print link has no design in it.');
  const page = new OpPage();
  page.cfg = { handle };
  page.printing = true;
  await page.startPrint(P, job);
}

class ShirtPage extends SHIRT.Members {
  update() {}
  paint() {}
  paintNow() {}
  syncLink() {}
  syncCarry() {}
  $() {
    return null;
  }
  get print() {
    return this._print || { chest: true, pocket: false, back: false };
  }
}

// Our design shirts (cc-shirt-ink on every shirt listing with a design file)
async function shirtFiles(handle, job, ctx, P) {
  // a print swapped for another of our designs (v33, CONTRACT C3: "dp") needs the v33 shirt code: never the listing's
  // own design in its place
  if (job && job.dp && typeof job.dp === 'object' && Object.keys(job.dp).length && typeof SHIRT.Members.prototype.swapAt !== 'function')
    throw new KitError('failed', "This shirt has a print swapped for another of our designs, which this version of the Orders page can't make yet. Open the print link from the order instead.");
  const facts = await listing(handle, ctx);
  const page = new ShirtPage();
  // (a listing that can't be read: a link with a colour is a one colour design)
  const mono = facts ? !!(facts.designMono && (facts.designMono.value === true || facts.designMono.value === 'true')) : !!(job && job.x);
  const ink = facts && facts.designInk && facts.designInk.value ? facts.designInk.value : '#FFFFFF';
  // the snippet's config: { handle, mono, pick, design, photo, ink }
  page.cfg = { handle: facts ? facts.handle : handle, mono, pick: mono, ink };
  page.mono = page.cfg.mono !== false;
  const base = SHIRT.normHex(page.cfg.ink) || '#FFFFFF';
  const named = SHIRT.INKS.find((x) => x[1] === base);
  page.state = { ink: named ? named[0] : 'custom', hex: base };
  // (a link's own colour: setHex)
  if (job && SHIRT.normHex(job.x)) {
    const hex = SHIRT.normHex(job.x);
    const same = SHIRT.INKS.find((x) => x[1] === hex);
    page.state = same ? { ink: same[0], hex } : { ink: 'custom', hex };
  }
  page.job = job;
  await page.startPrint(job);
}

class TeePage extends TEE.Members {
  update() {}
  $() {
    return null;
  }
  applyJob() {
    return Promise.resolve();
  }
}

// The garment builders (T-shirts, women's fit, vests, hoodies, zip hoodies, design T-shirt) with our designs
async function teeFiles(handle, job, ctx, P) {
  // the page's garment: the listing's custom.garment (the section's Liquid: default 'tee')
  const facts = await listing(handle, ctx);
  const garment = facts ? metaText(facts.garment) || 'tee' : job.g;
  const g = TEE.GARMENTS[garment] || TEE.GARMENTS[job.g];
  if (!g) throw new KitError('bad job', `This print link is for a garment we don't make (${job.g}).`);
  // (the page's own start-up check: a design T-shirt link carries its design, d: { handle, ... })
  const dh = job.d && job.d.handle ? String(job.d.handle) : '';
  if (g.designOnly && !/^[a-z0-9][a-z0-9-]{0,254}$/i.test(dh)) throw new KitError('wrong page', "This print link doesn't match this page. Open it from the order again.");
  const page = new TeePage();
  page.dataset = { garment };
  page.state = { shirt: job.sh || g.types[0] };
  page.g = g;
  // the print areas' names (the page's AREAS: Front, Back, Pocket) for the garment's drawing
  const shape = TEE.SHAPES[(g.shapes && g.shapes[page.state.shirt]) || g.shape];
  page.AREAS = shape && shape.areas ? shape.areas : {};
  page.product = { handle };
  page.printMode = true;
  await page.startPrint(job);
}

class TotePage extends TOTE.Members {
  update() {}
  $() {
    return null;
  }
  applyJob() {
    return Promise.resolve();
  }
}

// The tote builder (screen, full colour, one-off, design tote) with our designs
async function toteFiles(handle, job, ctx, P) {
  // the page's mode, as the section's Liquid works it out: screen (a "Colours" option), one-off (tag one-off), the
  // design tote (handle design-tote), else full colour
  const facts = await listing(handle, ctx);
  let mode = job.m;
  if (facts) {
    mode = 'dtf';
    if (facts.options.some((o) => o.name === 'Colours')) mode = 'screen';
    if (facts.tags.includes('one-off')) mode = 'oneoff';
    if (facts.handle === 'design-tote') mode = 'design';
  }
  const page = new TotePage();
  page.mode = mode;
  page.product = { handle };
  page.printMode = true;
  await page.startPrint(job);
}

class BadgePage extends BADGE.Members {
  update() {}
  renderAll() {}
  $() {
    return null;
  }
  querySelector() {
    return null;
  }
  printSay(msg, isError = false) {
    const P = this._P;
    if (P && P.status) P.status(msg, isError);
  }
  printNote(msg) {
    if (msg) this._notes.push(msg);
  }
}

// The badge family (pin and D-pin badges, mirrors, magnets, bottle openers, medals, photo keyrings, jumbo magnets)
async function badgeFiles(handle, job, ctx, P) {
  // the page's kind: the listing's custom.garment (the section's Liquid: default 'badge'; the builder: 'badge' if it
  // isn't one it knows). printFromLink checks the link's item against it, in its own words.
  const facts = await listing(handle, ctx);
  const wanted = facts ? metaText(facts.garment) || 'badge' : job.item;
  const kind = BADGE.KINDS[wanted] ? wanted : 'badge';
  const page = new BadgePage();
  page._P = P;
  page._notes = [];
  page.kind = kind;
  page.k = BADGE.KINDS[kind];
  // the listing's sizes (medals: 58mm only) and one-off or bulk (tag one-off, or no batch prices): from the listing
  const all = facts && facts.options[0] ? facts.options[0].values.slice() : [];
  const keep = page.k.sizes ? all.filter((s) => page.k.sizes.includes(s)) : all;
  page.sizes = keep.length ? keep : all.length ? all : [job.size];
  const bands = facts && facts.options[1] ? facts.options[1].values.filter((l) => !/single/i.test(l)) : [];
  page.oneOffOnly = facts ? facts.tags.includes('one-off') || !bands.length : job.sheet !== BADGE.SHEET_BULK;
  page.state = { size: page.sizes[0], mode: page.oneOffOnly ? 'single' : 'batch', designs: [], active: 0, guides: true, view: 'front', band: '', notes: '', terms: false };
  page.photos = {};
  page.product = { handle };
  await page.printFromLink();
  return { notes: page._notes };
}

const RUNNERS = { pc: pcFiles, op: opFiles, shirt: shirtFiles, tee: teeFiles, tote: toteFiles, badge: badgeFiles };
const GEN = { pc: PC, op: OP, shirt: SHIRT, tee: TEE, tote: TOTE, badge: BADGE };

// which builder a job is for: 'pc' | 'op' | 'shirt' | 'tee' | 'tote' | 'badge' | ''
export function jobKind(job) {
  if (!job || typeof job !== 'object') return '';
  if (job.b === 'badge') return 'badge';
  return ['pc', 'op', 'shirt', 'tee', 'tote'].includes(job.k) ? job.k : '';
}

// Does this job need a print file at all? v30 (Greg 14 Oct): a 10x10cm patch in White is screen printed from stock,
// so it never does: the patch listings and the one-off builder stopped adding links for it (cc-patch-customiser
// noPrintLink, cc-one-off-patch screenPrinted), but lines from before v30 still carry one.
export function needsPrintFile(job) {
  const kind = jobKind(job);
  if (kind === 'pc') return !PC.noPrintLink(job.s, job.c);
  if (kind === 'op' && job.c === 'White') {
    const m = OP.Members.prototype.jobMm(job);
    return !(m.w === 100 && m.h === 100);
  }
  return !!kind;
}

// what to call each file in a zip, after the line's SKU: its size or print spot
function whatOf(kind, job, f, i) {
  const label = String(f.label || '');
  if (kind === 'pc' || kind === 'op') {
    const own = kind === 'op' && job.s === OP.OWN && job.w && job.h;
    const s = own ? `${job.w}x${job.h}` : String(job.s || '').replace(/\s*\(.*?\)\s*/g, '').replace(/cm$/i, '');
    return s.trim();
  }
  if (kind === 'shirt') {
    // (the shirt page makes one file a print spot, in the job's order: chest, pocket, back)
    const where = (Array.isArray(job.p) ? job.p : []).filter((k) => SHIRT.SIZES[k]);
    return (where.length ? where : ['chest'])[i] || label.split(' ')[0].toLowerCase();
  }
  if (kind === 'tee') return label.replace(/ (print|films).*$/i, '').toLowerCase();
  if (kind === 'tote') return label.replace(/ (print|films).*$/i, '').toLowerCase();
  if (kind === 'badge') return `${job.size}${+job.n > 1 ? ` design ${job.n}` : ''}`;
  return '';
}

function formatOf(f) {
  const t = String((f.blob && f.blob.type) || '').toLowerCase();
  if (/pdf/.test(t) || /\.pdf$/i.test(f.filename || '')) return 'pdf';
  if (/png/.test(t) || /\.png$/i.test(f.filename || '')) return 'png';
  return t.split('/')[1] || 'bin';
}

// input: a print link (string), { handle, job }, or a job. -> [{ blob, filename, type, format, kind, label, what }]
// Throws a KitError (code + the builder's own message) when the storefront's print page would show an error.
// Jobs are made one at a time (lib/queue.js: one queue for the whole page, canvases let go of after each job).
export function makePrintFiles(input, ctx) {
  return queued(() => make(input, ctx), ctx);
}

async function make(input, ctx) {
  let handle = '';
  let job = null;
  if (typeof input === 'string') {
    const p = parsePrintLink(input);
    if (!p.ok) throw new KitError('bad job', `Not a print link: ${p.reason}.`);
    handle = p.handle;
    job = p.job;
  } else if (input && typeof input === 'object' && input.job && typeof input.job === 'object') {
    handle = input.handle || '';
    job = input.job;
  } else if (input && typeof input === 'object') job = input;
  const kind = jobKind(job);
  if (!kind) throw new KitError('bad job', 'This print link is for something the Orders page can\'t make.');
  if (!handle) handle = kind === 'pc' ? job.d : kind === 'shirt' ? job.h : '';
  if (kind === 'pc' || kind === 'shirt') {
    if (!HANDLE_RE.test(String(handle || ''))) throw new KitError('bad job', 'This print link has no listing in it.');
  }
  const { P, capture } = printTools(job, ctx);
  GEN[kind].__setP(P);
  const t0 = performance.now();
  let extra = null;
  try {
    extra = await RUNNERS[kind](handle, job, ctx, P);
  } finally {
    GEN[kind].__setP(null);
  }
  if (!capture.files) {
    // (the badge builder shows its "sign in" panel for any missing design file: the reason is in lastError)
    const said = failed(capture, '');
    const why = /doesn't match this page|isn't for this listing/.test(said)
      ? 'wrong page'
      : P.lastError === 'no file'
        ? 'no file'
        : P.lastError === 'failed'
          ? 'failed'
          : capture.notAllowed
            ? 'not allowed'
            : 'failed';
    const words = {
      'no file': "This design's print file isn't set up yet, so there's nothing to make the print file from.",
      failed: "Sorry, the print file couldn't be made.",
      'not allowed': "The design's full-size file couldn't be read from the shop.",
      'wrong page': "This print link doesn't match this page. Open it from the order again.",
    };
    throw new KitError(why, failed(capture, words[why]), { detail: capture.status.map(([t]) => t) });
  }
  if (typeof ctx.onProgress === 'function') ctx.onProgress({ stage: 'made', kind, files: capture.files.length, ms: Math.round(performance.now() - t0) });
  return capture.files.map((f, i) => ({
    blob: f.blob,
    filename: f.filename,
    type: (f.blob && f.blob.type) || '',
    format: formatOf(f),
    kind,
    label: f.label || '',
    what: whatOf(kind, job, f, i),
    notes: extra && extra.notes ? extra.notes : [],
  }));
}
