import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { crc32 } from 'node:zlib';
import { packDirectory } from '../pack.mjs';
import { listEntries, readEntry } from '../zip.mjs';

function folder(files) {
  const dir = mkdtempSync(join(tmpdir(), 'nexus-pack-'));
  for (const [name, text] of Object.entries(files)) {
    const parts = name.split('/');
    if (parts.length > 1) mkdirSync(join(dir, ...parts.slice(0, -1)), { recursive: true });
    writeFileSync(join(dir, ...parts), text);
  }
  return dir;
}

const MANIFEST = JSON.stringify({ id: 'com.example.demo', version: '1.0.0', name: 'Demo', author: 'Me', type: 'pack', nexusApi: '^1.0', entry: 'pack.json', permissions: [] });

test('the archive holds every file with its exact content, sorted, and a correct CRC', () => {
  const dir = folder({ 'nexus-plugin.json': MANIFEST, 'pack.json': '{"schemaVersion":1}', 'assets/icon.svg': '<svg/>'.repeat(200) });
  const { bytes, files } = packDirectory(dir);
  assert.deepEqual(files, ['assets/icon.svg', 'nexus-plugin.json', 'pack.json']);
  const entries = listEntries(bytes);
  assert.deepEqual(entries.map((e) => e.name), files);
  const icon = entries.find((e) => e.name === 'assets/icon.svg');
  const content = readEntry(bytes, icon);
  assert.equal(content.toString(), '<svg/>'.repeat(200));
  assert.equal(bytes.readUInt32LE(bytes.length - 22 + 16) > 0, true); // the central directory starts somewhere real
  assert.ok(icon.method === 8 && icon.compressed < icon.size); // compressible data is deflated
  assert.equal(crc32(content) >>> 0, crc32(Buffer.from('<svg/>'.repeat(200))) >>> 0);
});

test('the same folder gives the same bytes every time', () => {
  const dir = folder({ 'nexus-plugin.json': MANIFEST, 'pack.json': '{"schemaVersion":1}' });
  assert.deepEqual(packDirectory(dir).bytes, packDirectory(dir).bytes);
});

test('Python reads it too, and every CRC checks out (the app unpacks with Python)', (t) => {
  const probe = spawnSync('python', ['--version']);
  if (probe.status !== 0) return t.skip('python is not on PATH');
  const dir = folder({ 'nexus-plugin.json': MANIFEST, 'pack.json': '{"schemaVersion":1}', 'a/b.txt': 'x'.repeat(5000), 'tiny.txt': 'x' });
  const file = join(dir, '..', `nexus-pack-${Date.now()}.zip`);
  writeFileSync(file, packDirectory(dir).bytes);
  const py = spawnSync('python', ['-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(z.testzip()); print(sorted(z.namelist()))', file], { encoding: 'utf8' });
  assert.equal(py.status, 0, py.stderr);
  assert.match(py.stdout, /^None\r?\n\['a\/b.txt', 'nexus-plugin.json', 'pack.json', 'tiny.txt'\]/);
});

test('a folder without a manifest, with a file that is too big or a name the app refuses, is not packed', () => {
  assert.match(packDirectory(folder({ 'pack.json': '{}' })).problems.join(), /no nexus-plugin.json/);
  assert.match(packDirectory(folder({ 'nexus-plugin.json': MANIFEST, 'bad;name.txt': 'x' })).problems.join(), /file names/);
  assert.match(packDirectory(folder({ 'nexus-plugin.json': MANIFEST, 'big.bin': 'x'.repeat(10 * 1024 * 1024 + 1) })).problems.join(), /bigger than/);
});

test('links are refused, and node_modules and .git are left out', (t) => {
  const dir = folder({ 'nexus-plugin.json': MANIFEST, 'node_modules/x/index.js': '1', '.git/config': '1', 'main.js': '2' });
  assert.deepEqual(packDirectory(dir).files, ['main.js', 'nexus-plugin.json']);
  try {
    symlinkSync(join(dir, 'main.js'), join(dir, 'link.js'));
  } catch {
    return t.skip('this machine does not allow links');
  }
  assert.match(packDirectory(dir).problems.join(), /links are not allowed/);
});

test('a script that only imports the packer does not run its command line, even with a similar name', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { pathToFileURL, fileURLToPath } = await import('node:url');
  const dir = mkdtempSync(join(tmpdir(), 'nexus-guard-'));
  const packer = pathToFileURL(fileURLToPath(new URL('../pack.mjs', import.meta.url))).href;
  writeFileSync(join(dir, 'my-pack.mjs'), `import { packDirectory } from '${packer}';\nconsole.log(typeof packDirectory);\n`);
  const run = spawnSync(process.execPath, [join(dir, 'my-pack.mjs')], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  assert.equal(run.stdout.trim(), 'function');
  assert.equal(run.stderr, ''); // no "usage:" line, no exit code 2
});
