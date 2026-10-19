/**
 * Minimal ZIP reader (central-directory based) used for PPTX and file-content validation.
 * Only supports stored/deflated entries - exactly what Office files use. No dependencies.
 */
const zlib = require('zlib');

function readZipEntries(buf, { maxEntries = 5000, maxUncompressed = 200 * 1024 * 1024 } = {}) {
  if (buf.length < 22) throw new Error('Not a valid ZIP file.');
  // Zip64 defense
  if (buf.includes(Buffer.from([0x50, 0x4b, 0x06, 0x06])) || buf.includes(Buffer.from([0x50, 0x4b, 0x06, 0x07]))) {
    throw new Error('Zip64 format is not supported.');
  }
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a valid ZIP file (no central directory).');
  const total = buf.readUInt16LE(eocd + 10);
  if (total > maxEntries) throw new Error('ZIP has too many entries.');
  let off = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  const seenLhos = [];
  let uncompressedTotal = 0;
  for (let n = 0; n < total; n++) {
    if (off + 46 > buf.length) throw new Error('Corrupt ZIP central directory.');
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('Corrupt ZIP central directory.');
    const method = buf.readUInt16LE(off + 10);
    if (method !== 0 && method !== 8) throw new Error(`Unsupported ZIP compression method: ${method}.`);
    const crc = buf.readUInt32LE(off + 16);
    const csize = buf.readUInt32LE(off + 20);
    const usize = buf.readUInt32LE(off + 24);
    const nlen = buf.readUInt16LE(off + 28), elen = buf.readUInt16LE(off + 30), clen = buf.readUInt16LE(off + 32);
    const lho = buf.readUInt32LE(off + 42);
    if (lho + 30 > buf.length) throw new Error('Corrupt ZIP local header offset.');
    if (lho + 30 + csize > buf.length) throw new Error('Compressed size exceeds file bounds.');
    if (off + 46 + nlen > buf.length) throw new Error('Corrupt ZIP central directory.');

    // Overlapping local header offset check (zip bomb defense)
    for (const [start, end] of seenLhos) {
      if (Math.max(lho, start) < Math.min(lho + 30 + csize, end)) {
        throw new Error('Overlapping zip entries detected (possible zip bomb).');
      }
    }
    seenLhos.push([lho, lho + 30 + csize]);

    const name = buf.toString('utf8', off + 46, off + 46 + nlen);
    // Zip-slip defense
    if (name.includes('..') || name.startsWith('/') || name.includes('\\') || /^[a-zA-Z]:/.test(name)) {
      throw new Error(`Unsafe path traversal characters in zip entry: ${name}`);
    }
    // Disallowed entry formats in document containers
    if (name.endsWith('.zip') || name.endsWith('.jar') || name.endsWith('.class') || name.startsWith('META-INF/')) {
      throw new Error(`Disallowed archive entry: ${name}`);
    }

    uncompressedTotal += usize;
    if (uncompressedTotal > maxUncompressed) throw new Error('ZIP expands beyond the allowed size (possible zip bomb).');
    entries.set(name, { method, csize, usize, lho, crc });
    off += 46 + nlen + elen + clen;
  }

  function inflateEntry(e) {
    if (e.lho + 30 > buf.length) throw new Error('Corrupt ZIP local header offset.');
    if (e.lho + 30 + e.csize > buf.length) throw new Error('Compressed size exceeds file bounds.');
    const nlen = buf.readUInt16LE(e.lho + 26), elen = buf.readUInt16LE(e.lho + 28);
    const start = e.lho + 30 + nlen + elen;
    if (start + e.csize > buf.length) throw new Error('Compressed size exceeds file bounds.');
    const data = buf.subarray(start, start + e.csize);
    const out = e.method === 0 ? Buffer.from(data) : zlib.inflateRawSync(data, { maxOutputLength: Math.max(e.usize, 1) + 1024 });
    if (e.crc !== 0 && zlib.crc32(out) !== e.crc) {
      throw new Error('CRC-32 checksum mismatch (archive corrupted).');
    }
    return out;
  }

  return {
    names: [...entries.keys()],
    has: (n) => entries.has(n),
    entries,
    read(name) {
      const e = entries.get(name);
      if (!e) return null;
      return inflateEntry(e);
    },
    inflateEntry,
  };
}

module.exports = { readZipEntries };
