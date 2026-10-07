// Builds a `.nexusext` (the zip Nexus Studio installs) from a folder, and prints the size and SHA-256 to paste into the catalogue.
//
//   node catalogue/pack.mjs <folder> [out.nexusext]
//
// The folder must have `nexus-plugin.json` at its top level. The archive is reproducible (the same folder gives the same bytes: sorted names, a fixed
// timestamp) and stays inside the limits the app enforces (20 MB in all, 10 MB a file, 200 files, no links, plain forward-slash names).
// Exit code 0 = written, 1 = the folder can't be packed (every reason printed), 2 = could not run.
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

export const MAX_FILES = 200;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01, so the output does not depend on when it was built
const SAFE_NAME = /^[A-Za-z0-9._ -]+(?:\/[A-Za-z0-9._ -]+)*$/;
const SKIP = new Set(['.git', '.DS_Store', 'Thumbs.db', 'node_modules']);

/** Every file under `root` as `{name, path}` with forward-slash names, sorted. Collects problems instead of throwing. */
function walk(root, prefix, files, problems) {
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (SKIP.has(entry.name)) continue;
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    const path = join(root, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) problems.push(`${name}: links are not allowed.`);
    else if (stat.isDirectory()) walk(root, name, files, problems);
    else if (stat.isFile()) {
      if (!SAFE_NAME.test(name)) problems.push(`${name}: use letters, digits, spaces, dots, dashes and underscores in file names.`);
      else files.push({ name, path, size: stat.size });
    }
  }
}

/** The archive bytes for a folder, or `{problems}` when it can't be packed. */
export function packDirectory(dir) {
  const root = resolve(dir);
  const problems = [];
  const files = [];
  walk(root, '', files, problems);
  if (!files.some((f) => f.name === 'nexus-plugin.json')) problems.push('There is no nexus-plugin.json at the top level of the folder.');
  if (files.length > MAX_FILES) problems.push(`More than ${MAX_FILES} files (${files.length}).`);
  for (const f of files) if (f.size > MAX_FILE_BYTES) problems.push(`${f.name}: bigger than ${MAX_FILE_BYTES} bytes.`);
  if (files.reduce((n, f) => n + f.size, 0) > MAX_TOTAL_BYTES) problems.push(`The files add up to more than ${MAX_TOTAL_BYTES} bytes.`);
  if (problems.length) return { problems };

  const locals = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const raw = readFileSync(f.path);
    const deflated = deflateRawSync(raw, { level: 9 });
    const stored = deflated.length >= raw.length;
    const data = stored ? raw : deflated;
    const method = stored ? 0 : 8;
    const name = Buffer.from(f.name, 'utf8');
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10); local.writeUInt16LE(DOS_DATE, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0, 8); cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(DOS_TIME, 12); cd.writeUInt16LE(DOS_DATE, 14); cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    central.push(cd, name);
    offset += 30 + name.length + data.length;
  }
  const cdBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdBytes.length, 12); end.writeUInt32LE(offset, 16);
  return { bytes: Buffer.concat([...locals, cdBytes, end]), files: files.map((f) => f.name) };
}

function main(argv) {
  const dir = argv[0];
  if (!dir) { console.error('usage: pack.mjs <folder> [out.nexusext]'); return 2; }
  let manifest;
  try { manifest = JSON.parse(readFileSync(join(dir, 'nexus-plugin.json'), 'utf8')); } catch (e) { console.error(`Cannot read ${join(dir, 'nexus-plugin.json')}: ${e.message}`); return 1; }
  const packed = packDirectory(dir);
  if (packed.problems) { for (const p of packed.problems) console.error(p); return 1; }
  const out = argv[1] ?? `${manifest.id ?? basename(resolve(dir))}-${manifest.version ?? '0'}.nexusext`;
  writeFileSync(out, packed.bytes);
  console.log(`Wrote ${out} (${packed.files.length} files)`);
  console.log(`  "sha256": "${createHash('sha256').update(packed.bytes).digest('hex')}",`);
  console.log(`  "size": ${packed.bytes.length}`);
  return 0;
}

if (process.argv[1]?.endsWith('pack.mjs')) process.exitCode = main(process.argv.slice(2)); // run as a command, not imported by a test
