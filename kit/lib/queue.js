// One job at a time on the page (print files and mock-ups): a big print never shares the memory with another, and
// when a job ends the canvases it made are let go of at once (their pixels can be tens of MB each and the browser
// would otherwise keep them until it next tidies up). Only canvases made while the job ran, and not on the page,
// are cleared: the files themselves are Blobs and don't need them. ctx.releaseCanvases === false turns that off.
let tail = Promise.resolve();

export function queued(fn, ctx) {
  const run = tail.then(() => withRelease(fn, ctx));
  tail = run.catch(() => null);
  return run;
}

async function withRelease(fn, ctx) {
  const release = !(ctx && ctx.releaseCanvases === false) && typeof document !== 'undefined';
  if (!release) return fn();
  const made = [];
  const create = Document.prototype.createElement;
  Document.prototype.createElement = function (tag, opts) {
    const el = create.call(this, tag, opts);
    if (typeof tag === 'string' && tag.toLowerCase() === 'canvas') made.push(el);
    return el;
  };
  try {
    return await fn();
  } finally {
    Document.prototype.createElement = create;
    for (const c of made) {
      if (c.isConnected) continue;
      try {
        c.width = 0;
        c.height = 0;
      } catch (e) {
        /* leave it */
      }
    }
    made.length = 0;
    // a moment for the browser to hand the memory back before the next job
    await new Promise((r) => setTimeout(r, 0));
  }
}
