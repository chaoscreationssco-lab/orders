// The print tools the copied builder code gets as `P` (or `window.CCPrint`, rewritten to __P()): the live engine
// (engine/cc-print.js, byte for byte the theme's assets/cc-print.js), with five things answered by the KIT:
//   designFile -> lib/designfile.js (Admin data, what the cc-file view gives the team), readJob -> the job given,
//   offer -> keeps the files (nothing is downloaded), status / notAllowed -> kept as messages,
//   loadImage -> the engine's own steps (fetch asking for PNG/JPEG, not WebP; drawn from a blob: URL) through ctx.fetch.
import '../engine/cc-print.js';
import { designFile } from './designfile.js';
import { seeUrl } from './shop.js';

export function engine() {
  const E = globalThis.CCPrint;
  if (!E || typeof E.films !== 'function') throw new Error('KIT: the print engine (engine/cc-print.js) did not load');
  return E;
}

// CCPrint.loadImage, step for step, with the fetch the Orders page gives (ctx.fetch)
export function loadImageWith(fetchFn) {
  return async function loadImage(url) {
    let src = url;
    if (!/^(blob|data):/.test(url)) {
      try {
        const r = await fetchFn(url, { headers: { Accept: 'image/png,image/jpeg,image/svg+xml,*/*;q=0.1' }, credentials: 'same-origin' });
        if (r.ok) src = URL.createObjectURL(await r.blob());
      } catch (e) {
        /* plain <img> below */
      }
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      if (!/^blob:/.test(src)) img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => {
        if (src !== url) URL.revokeObjectURL(src);
        resolve(img);
      };
      img.onerror = () => reject(new Error('CCPrint: could not load ' + url));
      img.src = src;
    });
  };
}

// a fresh set of print tools for one job: { P, capture }
export function printTools(job, ctx) {
  const E = engine();
  const capture = { files: null, status: [], notAllowed: 0, notes: [] };
  const P = Object.create(E);
  P.lastError = '';
  P.readJob = () => job;
  P.isPrintPage = () => true;
  P.designFile = async (handle) => {
    P.lastError = '';
    const f = await designFile(handle, ctx);
    if (!f) P.lastError = designFile.lastError || 'failed';
    else {
      seeUrl(ctx, f.url);
      capture.design = capture.design || {};
      capture.design[handle] = f;
    }
    return f;
  };
  if (typeof ctx.fetch === 'function') P.loadImage = loadImageWith(ctx.fetch.bind(globalThis));
  P.offer = (files) => {
    capture.files = (files || []).filter((f) => f && f.blob);
    return null;
  };
  P.status = (text, isError) => {
    capture.status.push([String(text), !!isError]);
    return null;
  };
  P.notAllowed = () => {
    capture.notAllowed++;
    return null;
  };
  P.download = () => {
    throw new Error('KIT: nothing is downloaded from here');
  };
  return { P, capture };
}
