// zip: the print files in one .zip, byte for byte the layout of CCPrint.zip (STORE, CRC-32, UTF-8 names, one DOS
// date/time), built so dozens of A3 300 dpi PNGs never need the memory twice:
//   - each file's CRC is worked out from its stream, 64 KB at a time (never a copy of the whole file),
//   - the zip is a Blob made of the files' own Blobs plus small headers (the browser keeps big Blobs on disk as it
//     needs; nothing is copied into one big buffer),
//   - zipWriter() takes the files one at a time as they are made, so a page can make a file, add it, and let go of
//     everything it used to make it before starting the next.
// Names are made safe for Windows (no \ / : * ? " < > |) and a repeated name gets " (2)", " (3)"... before its type.

let CRC_TABLE = null;
function table() {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  return CRC_TABLE;
}

export function crc32Update(c, bytes) {
  const T = table();
  for (let i = 0; i < bytes.length; i++) c = T[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return c;
}

// the CRC-32 of a Blob, read as a stream (falls back to one read where streams aren't there)
export async function crc32Blob(blob) {
  let c = 0xffffffff;
  if (typeof blob.stream === 'function') {
    const reader = blob.stream().getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      c = crc32Update(c, value);
    }
  } else c = crc32Update(c, new Uint8Array(await blob.arrayBuffer()));
  return (c ^ 0xffffffff) >>> 0;
}

const te = new TextEncoder();

// a file name that is safe on Windows, macOS and Linux (keeps its extension; at most 180 characters)
export function safeEntryName(name) {
  let s = String(name == null ? '' : name)
    .replace(/[\u0000-\u001f\u007f]+/g, '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '');
  if (!s) s = 'file';
  if (s.length > 180) {
    const m = /\.([A-Za-z0-9]{1,8})$/.exec(s);
    const ext = m ? m[0] : '';
    s = s.slice(0, 180 - ext.length).trim() + ext;
  }
  return s;
}

function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((Math.min(2107, Math.max(1980, d.getFullYear())) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

// opts: { date } (default now). -> { add(name, blob) -> the name used, finish(zipName) -> File, count, size }
export function zipWriter(opts = {}) {
  const { time, date } = dosTime(opts.date instanceof Date ? opts.date : new Date());
  const seen = new Set();
  const body = [];
  const dir = [];
  let offset = 0;
  let count = 0;
  let closed = false;
  const unique = (name) => {
    let n = safeEntryName(name);
    if (!seen.has(n.toLowerCase())) return n;
    const m = /^(.*?)(\.[A-Za-z0-9]{1,8})?$/.exec(n);
    for (let i = 2; ; i++) {
      const t = `${m[1]} (${i})${m[2] || ''}`;
      if (!seen.has(t.toLowerCase())) return t;
    }
  };
  return {
    get count() {
      return count;
    },
    get size() {
      return offset;
    },
    async add(name, data) {
      if (closed) throw new Error('zip: already finished');
      if (data == null) throw new Error('zip: no data for ' + name);
      const blob = data instanceof Blob ? data : new Blob([data]);
      const n = unique(name);
      seen.add(n.toLowerCase());
      if (count + 1 > 0xffff) throw new Error('zip: too many files');
      const crc = await crc32Blob(blob);
      const nb = te.encode(n);
      const size = blob.size;
      if (offset + 30 + nb.length + size > 0xffffffff) throw new Error('zip: over 4 GB');
      const head = (sig, len) => {
        const v = new DataView(new ArrayBuffer(len));
        v.setUint32(0, sig, true);
        return v;
      };
      const loc = head(0x04034b50, 30);
      [20, 0x0800, 0, time, date].forEach((x, i) => loc.setUint16(4 + 2 * i, x, true)); // version, UTF-8 flag, STORE, time, date
      loc.setUint32(14, crc, true);
      loc.setUint32(18, size, true);
      loc.setUint32(22, size, true);
      loc.setUint16(26, nb.length, true);
      body.push(loc, nb, blob);
      const cen = head(0x02014b50, 46);
      [20, 20, 0x0800, 0, time, date].forEach((x, i) => cen.setUint16(4 + 2 * i, x, true)); // made by, needed, flag, STORE, time, date
      cen.setUint32(16, crc, true);
      cen.setUint32(20, size, true);
      cen.setUint32(24, size, true);
      cen.setUint16(28, nb.length, true);
      cen.setUint32(42, offset, true);
      dir.push(cen, nb);
      offset += 30 + nb.length + size;
      count++;
      return n;
    },
    finish(zipName) {
      if (!count) throw new Error('zip: no files');
      closed = true;
      const dirSize = dir.reduce((s, p) => s + p.byteLength, 0);
      const end = new DataView(new ArrayBuffer(22));
      end.setUint32(0, 0x06054b50, true);
      end.setUint16(8, count, true);
      end.setUint16(10, count, true);
      end.setUint32(12, dirSize, true);
      end.setUint32(16, offset, true);
      const parts = body.concat(dir, [end]);
      body.length = 0;
      dir.length = 0;
      return new File(parts, safeEntryName(zipName || 'print-files.zip'), { type: 'application/zip' });
    },
  };
}

// files: an array (or async iterable) of { blob, name } / { blob, filename } -> a File (application/zip) called name
export async function zip(files, name, opts) {
  const w = zipWriter(opts);
  for await (const f of files) {
    if (!f) continue;
    await w.add(f.name || f.filename, f.blob != null ? f.blob : f.data);
  }
  return w.finish(name);
}
