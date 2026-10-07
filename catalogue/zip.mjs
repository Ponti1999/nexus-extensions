// A minimal, bounded zip reader: just enough to read `nexus-plugin.json` out of a `.nexusext` without trusting it.
// Supports stored and deflate entries only (what the app accepts too); refuses everything else and anything oversized.
import { inflateRawSync } from 'node:zlib';

export const MAX_ENTRY_BYTES = 10 * 1024 * 1024; // the app refuses a file over 10 MB
const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** The entries of a zip as `{name, method, compressed, size, offset}`. Throws `Error` with a plain message when the file is not a usable zip. */
export function listEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file (no end-of-archive record)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CENTRAL) throw new Error('damaged zip (bad central directory)');
    const flags = buf.readUInt16LE(p + 8);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    if (flags & 1) throw new Error('encrypted entries are not allowed');
    entries.push({
      name: buf.toString('utf8', p + 46, p + 46 + nameLen),
      method: buf.readUInt16LE(p + 10),
      compressed: buf.readUInt32LE(p + 20),
      size: buf.readUInt32LE(p + 24),
      offset: buf.readUInt32LE(p + 42),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** The bytes of one entry. Refuses a compression method other than stored/deflate and an entry over `MAX_ENTRY_BYTES`. */
export function readEntry(buf, entry) {
  if (entry.size > MAX_ENTRY_BYTES) throw new Error(`${entry.name} is larger than ${MAX_ENTRY_BYTES} bytes`);
  const o = entry.offset;
  if (o + 30 > buf.length || buf.readUInt32LE(o) !== LOCAL) throw new Error('damaged zip (bad local header)');
  const start = o + 30 + buf.readUInt16LE(o + 26) + buf.readUInt16LE(o + 28);
  const data = buf.subarray(start, start + entry.compressed);
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES });
  throw new Error(`compression method ${entry.method} is not allowed (only stored and deflate)`);
}
