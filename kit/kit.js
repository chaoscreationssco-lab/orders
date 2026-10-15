/* KIT (v33, 15 Oct): print files, original downloads, mock-ups and zips for the Orders page, in the page itself.
   An ES module for the browser (no build step, standard web APIs only: works in Firefox). CONTRACT C6.

   The same files the storefront's print page saves: the builders' own print code, copied verbatim from the theme's
   readable sources into gen/ (tools/extract.mjs), runs on the live engine (engine/cc-print.js = the theme's
   assets/cc-print.js, byte for byte). Only where the files come from changes: our designs' full-size files are found
   from Admin data the way the theme's cc-file view finds them (lib/designfile.js), and fetched from Shopify's CDN.

   ctx (from the Orders page), one per store and download:
     graphql(query, variables) -> data      Admin GraphQL (the page's direct API access); reads products by handle and
                                             the shop metafields (custom.cc_files / cc_previews / cc_shirt_map)
     ccFiles, ccPreviews, ccShirtMap         optional: those metafields already read (Admin JSON string or object)
     cdnBase                                 optional: 'https://cdn.shopify.com/s/files/1/1028/0966/5885/' (else found
                                             from any product photo or upload URL the KIT sees)
     fetch                                   optional: the fetch for CDN files (default: window.fetch)
     shopName, onProgress({ stage, ... })    optional
   The KIT keeps what it reads on ctx (each product once a download).

   makePrintFiles(link | { handle, job } | job, ctx) -> [{ blob, filename, type, format, kind, label, what, notes }]
     kind: the builder ('pc' patch listings, 'op' one-off patches / Design Patch, 'shirt' our design shirts, 'badge'
     badge family, 'tee' garments, 'tote' totes); filename: the storefront's own name; what: a short word for the
     zip name (size / print spot). Throws KitError { code: 'bad job' | 'no file' | 'failed' | 'wrong page', message }.
   fetchOriginal(url | #cc-dl link, nameHint, ctx) -> { blob, filename, type, url, size }  (own format, no APNG)
   mockup(line, ctx) -> Blob | null   (line: Admin LineItem with sku, variantTitle, product { handle templateSuffix },
     customAttributes, image { url })
   zip(files, name) -> File  (files: [{ blob, name }], array or async iterable); zipWriter() to add files as they're made
   zipName('#16330') -> '16330.zip'; zipNameAll(date) -> 'Print files 15-10-2026.zip';
   entryName({ order, position, sku, what, filename }) -> '16330-2 Patch358 20x20.png'
   lineFiles(line, ctx, { order, position, originals }) -> { files: [{ blob, name, filename, source, key }], errors, skipped }
   needsPrintFile(job): false for a 10x10cm White patch (screen printed from stock; older lines still carry a link)
   zipOrders([{ order, lines }], ctx, { name, originals, onFile, maxBytes, onZip }) -> { file, files, errors, skipped, count }
   designFile(handle, ctx) / designPreview(handle, ctx): the cc-file / cc-design views from Admin data. */
import { makePrintFiles, KitError, jobKind, needsPrintFile } from './lib/print.js';
import { fetchOriginal, plainPng } from './lib/original.js';
import { mockup, SOURCES as MOCKUP_SOURCES } from './lib/mockup.js';
import { zip, zipWriter, safeEntryName } from './lib/zip.js';
import { zipName, zipNameAll, entryName } from './lib/names.js';
import { designFile, designPreview, patchPad } from './lib/designfile.js';
import { printLinksOf, uploadedPrintFilesOf, artworkOf, attrsOf } from './lib/lines.js';
import { parsePrintLink, parseDlLink, isPrintLink, isDlLink, uploadName } from './lib/links.js';
import { cdnBase, productByHandle, shopData } from './lib/shop.js';
import { SOURCE as PC } from './gen/pc.js';
import { SOURCE as OP } from './gen/op.js';
import { SOURCE as SHIRT } from './gen/shirt.js';
import { SOURCE as TEE } from './gen/tee.js';
import { SOURCE as TOTE } from './gen/tote.js';
import { SOURCE as BADGE } from './gen/badge.js';
import { ENGINE } from './gen/engine-info.js';

export const VERSION = 'kit v33';
// which theme sources (md5) the copied code came from, and the engine (tools/build.mjs writes them)
export const SOURCES = { engine: ENGINE, pc: PC, op: OP, shirt: SHIRT, tee: TEE, tote: TOTE, badge: BADGE, mockups: MOCKUP_SOURCES };

// every print file of one order line, named for the zip. Print links are made here; print files the customer's
// browser uploaded with the line are fetched in their own format. originals: 'missing' (default: the customer's own
// artwork only for a line with no print file at all, e.g. a file too big to attach or one we couldn't preview),
// 'all' or 'none'. Never throws: each problem goes in errors ({ key, code, message }).
export async function lineFiles(line, ctx, opts = {}) {
  const { order = '', position = 0, originals = 'missing' } = opts;
  const sku = (line && line.sku) || '';
  const files = [];
  const errors = [];
  const add = (f, source, key, what) => files.push({ ...f, source, key, what, name: entryName({ order, position, sku, what, filename: f.filename }) });
  const skipped = [];
  for (const l of printLinksOf(line)) {
    if (l.job && l.kind && !needsPrintFile(l.job)) {
      // (a 10x10cm White patch from before v30: screen printed from stock, no print file)
      skipped.push({ key: l.key, why: '10x10cm White: screen printed, no print file' });
      continue;
    }
    if (!l.job || !l.kind) {
      errors.push({ key: l.key, code: 'bad job', message: l.error ? `Not a print link: ${l.error}.` : "This print link is for something the Orders page can't make." });
      continue;
    }
    try {
      const made = await makePrintFiles({ handle: l.handle, job: l.job }, ctx);
      made.forEach((f) => add(f, 'made', l.key, f.what));
    } catch (e) {
      errors.push({ key: l.key, code: e.code || 'failed', message: (e && e.message) || String(e) });
    }
  }
  for (const u of uploadedPrintFilesOf(line)) {
    try {
      const r = await fetchOriginal(u.url, null, ctx);
      add(r, 'upload', u.key, u.what);
    } catch (e) {
      errors.push({ key: u.key, code: 'failed', message: (e && e.message) || String(e) });
    }
  }
  if (originals === 'all' || (originals === 'missing' && !files.length && !errors.length)) {
    for (const a of artworkOf(line)) {
      try {
        const r = await fetchOriginal(a.value, a.name || null, ctx);
        add(r, 'original', a.key, `${a.what} original`.trim());
      } catch (e) {
        errors.push({ key: a.key, code: 'failed', message: (e && e.message) || String(e) });
      }
    }
  }
  return { files, errors, skipped };
}

// One zip for many orders (or one): [{ order: '#16330', lines: [line, ...] }] (lines in the order's own order: the
// position is their place, from 1). Each line's files go into the zip as they're made.
// -> { file, files, errors, skipped, count }. opts: name (default "16330.zip" for one order, else "Print files
// DD-MM-YYYY.zip"), originals, onFile({ order, position, name, size, done }), maxBytes (default 2 GB: a zip can't pass
// 4 GB, and a browser holds the whole zip until it's saved): past it the zip comes in parts, "<name> (1).zip",
// "(2)"..., each handed to onZip(file) as soon as it's full (await it: let go of the part, e.g. save it, before the
// next one is made); without onZip they all come back in files.
export async function zipOrders(orders, ctx, opts = {}) {
  const list = Array.isArray(orders) ? orders : [orders];
  const name = opts.name || (list.length === 1 ? zipName(list[0].order) : zipNameAll());
  const maxBytes = opts.maxBytes > 0 ? +opts.maxBytes : 2 * 1024 * 1024 * 1024;
  const errors = [];
  const skipped = [];
  const parts = [];
  let part = 1;
  let w = zipWriter(opts);
  let n = 0;
  const partName = (k) => name.replace(/(\.zip)?$/i, ` (${k}).zip`);
  const close = async (last) => {
    if (!w.count) return;
    const f = w.finish(last && part === 1 ? name : partName(part));
    part++;
    if (typeof opts.onZip === 'function') await opts.onZip(f);
    else parts.push(f);
  };
  for (const o of list) {
    const lines = (o && o.lines) || [];
    for (let i = 0; i < lines.length; i++) {
      const position = lines[i] && lines[i].position != null ? lines[i].position : i + 1;
      const r = await lineFiles(lines[i], ctx, { order: o.order, position, originals: opts.originals });
      r.errors.forEach((e) => errors.push({ order: o.order, position, sku: lines[i] && lines[i].sku, ...e }));
      r.skipped.forEach((e) => skipped.push({ order: o.order, position, sku: lines[i] && lines[i].sku, ...e }));
      for (const f of r.files) {
        // (a zip entry costs 76 bytes plus its name twice, on top of the file)
        if (w.count && w.size + f.blob.size + 200 > maxBytes) {
          await close(false);
          w = zipWriter(opts);
        }
        const used = await w.add(f.name, f.blob);
        n++;
        if (typeof opts.onFile === 'function') opts.onFile({ order: o.order, position, name: used, size: f.blob.size, done: n, part });
      }
    }
  }
  await close(true);
  return { file: parts[0] || null, files: parts, errors, skipped, count: n };
}

export {
  makePrintFiles,
  fetchOriginal,
  mockup,
  zip,
  zipWriter,
  zipName,
  zipNameAll,
  entryName,
  safeEntryName,
  designFile,
  designPreview,
  patchPad,
  printLinksOf,
  uploadedPrintFilesOf,
  artworkOf,
  attrsOf,
  parsePrintLink,
  parseDlLink,
  isPrintLink,
  isDlLink,
  uploadName,
  plainPng,
  jobKind,
  needsPrintFile,
  cdnBase,
  productByHandle,
  shopData,
  KitError,
};
