import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { checkRemote, compareWithBase, validateIndex } from '../validate.mjs';
import { listEntries, readEntry } from '../zip.mjs';

const REPO = 'https://github.com/someone/night-pack';
const version = (over = {}) => ({
  version: '1.0.0',
  nexusApi: '^1.2',
  type: 'pack',
  permissions: ['profiles.read'],
  url: `${REPO}/releases/download/v1.0.0/night-pack.nexusext`,
  sha256: 'a'.repeat(64),
  size: 1234,
  ...over,
});
const catalogue = (versions = [version()], over = {}) => ({ schemaVersion: 1, extensions: [{ id: 'com.example.night-pack', repo: REPO, name: 'Night pack', author: 'Someone', description: 'Dark lighting presets.', versions, ...over }] });

/** A zip with the given files, each stored (0) or deflated (8). CRCs are zero: the reader does not use them. */
function zip(files, method = 8) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text);
    const data = method === 8 ? deflateRawSync(raw) : raw;
    const nm = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(method, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nm.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(method, 10); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(nm.length, 28); cd.writeUInt32LE(offset, 42);
    locals.push(local, nm, data);
    central.push(cd, nm);
    offset += 30 + nm.length + data.length;
  }
  const cdBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cdBytes.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cdBytes, end]);
}

// --- the shape of index.json ---------------------------------------------------------------------------------------------------

test('a well-formed catalogue has no problems, and an empty one is fine', () => {
  assert.deepEqual(validateIndex(catalogue()), []);
  assert.deepEqual(validateIndex({ schemaVersion: 1, extensions: [] }), []);
});

test('every wrong field is named, all at once', () => {
  const bad = catalogue([version({ version: '1.0', nexusApi: '1.2', sha256: 'XYZ', size: 0, url: 'https://evil.example/x.nexusext' })], { id: 'Night Pack' });
  assert.match(validateIndex(catalogue([version()], { repo: 'http://github.com/x' })).join(), /'repo'/); // the url is judged against the repo, so a bad repo is reported on its own
  const text = validateIndex(bad).join('\n');
  for (const part of ["'id'", "'version'", "'nexusApi'", "'sha256'", "'size'", "'url'"]) assert.match(text, new RegExp(part));
});

test('a download must be a .nexusext release asset of the entry repo', () => {
  for (const url of [`${REPO}/archive/main.zip`, `${REPO}/releases/download/v1/x.zip`, `https://github.com/other/repo/releases/download/v1/x.nexusext`, `${REPO}/releases/download/v1/x.nexusext?token=1`, `${REPO}/releases/download/../../x.nexusext`]) {
    assert.ok(validateIndex(catalogue([version({ url })])).some((p) => /'url'/.test(p)), url);
  }
});

test('the card fields are required and bounded', () => {
  const text = validateIndex(catalogue([version({ type: 'exe', permissions: ['Bad Name', 'profiles.read', 'profiles.read'], minAppVersion: '5', minFirmwareBuild: -1 })], { name: '', author: 'x'.repeat(61), description: 'y'.repeat(301) })).join(' ');
  for (const part of ["'name'", "'author'", "'description'", "'type'", "'permissions'", "'minAppVersion'", "'minFirmwareBuild'"]) assert.match(text, new RegExp(part));
  assert.deepEqual(validateIndex(catalogue([version({ permissions: [], minAppVersion: '5.0.0', minFirmwareBuild: 30724 })], { description: undefined })), []);
});

test('duplicates and unknown keys are refused', () => {
  assert.ok(validateIndex(catalogue([version(), version()])).some((p) => /listed twice/.test(p)));
  const two = { schemaVersion: 1, extensions: [catalogue().extensions[0], catalogue().extensions[0]] };
  assert.ok(validateIndex(two).some((p) => /listed twice/.test(p)));
  assert.ok(validateIndex(catalogue([version({ extra: 1 })])).some((p) => /unknown key 'extra'/.test(p)));
  assert.ok(validateIndex({ schemaVersion: 2, extensions: [] }).some((p) => /schemaVersion/.test(p)));
});

test('a version is a SemVer, with a prerelease allowed, and the API range is ^MAJOR.MINOR only', () => {
  assert.deepEqual(validateIndex(catalogue([version({ version: '1.2.3-beta.1' })])), []);
  assert.ok(validateIndex(catalogue([version({ nexusApi: '^1' })])).length > 0);
  assert.ok(validateIndex(catalogue([version({ nexusApi: '>=1.2' })])).length > 0);
});

// --- against the catalogue on the target branch ---------------------------------------------------------------------------------

test('adding a version is allowed; removing one or changing a published one is not', () => {
  const base = catalogue([version()]);
  const added = compareWithBase(catalogue([version(), version({ version: '1.1.0', url: `${REPO}/releases/download/v1.1.0/night-pack.nexusext`, sha256: 'b'.repeat(64) })]), base);
  assert.deepEqual(added.problems, []);
  assert.deepEqual(added.added, ['com.example.night-pack@1.1.0']);
  assert.match(compareWithBase(catalogue([version({ version: '1.1.0' })]), base).problems.join(), /never removed/);
  assert.match(compareWithBase(catalogue([version({ sha256: 'c'.repeat(64) })]), base).problems.join(), /'sha256' of a published version never changes/);
});

test('an author cannot write testedWith on a new version', () => {
  const withTested = catalogue([version(), version({ version: '1.1.0', url: `${REPO}/releases/download/v1.1.0/n.nexusext`, testedWith: [{ app: '5.0.0', result: 'pass' }] })]);
  assert.match(compareWithBase(withTested, catalogue()).problems.join(), /written by the compatibility job/);
  assert.deepEqual(validateIndex(withTested), []); // the shape is fine: only a pull request may not add it
});

// --- the zip reader and the download check ---------------------------------------------------------------------------------------

const manifest = (over = {}) => JSON.stringify({ id: 'com.example.night-pack', version: '1.0.0', nexusApi: '^1.2', name: 'Night pack', author: 'Someone', description: 'Dark lighting presets.', type: 'pack', permissions: ['profiles.read'], ...over });
const served = (bytes, status = 200) => async () => ({ ok: status === 200, status, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) });
const entryFor = (bytes, over = {}) => version({ size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), ...over });

test('the zip reader reads stored and deflated entries and refuses an unknown method', () => {
  for (const method of [0, 8]) {
    const bytes = zip({ 'nexus-plugin.json': manifest() }, method);
    const [entry] = listEntries(bytes);
    assert.equal(JSON.parse(readEntry(bytes, entry).toString()).id, 'com.example.night-pack');
  }
  const odd = zip({ 'a.txt': 'x' }, 0);
  odd.writeUInt16LE(12, odd.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 10); // bzip2
  assert.throws(() => readEntry(odd, listEntries(odd)[0]), /not allowed/);
  assert.throws(() => listEntries(Buffer.from('not a zip')), /not a zip/);
});

test('a matching download passes; a wrong size, hash, id, version or API is reported', async () => {
  const good = zip({ 'nexus-plugin.json': manifest() });
  assert.deepEqual(await checkRemote(catalogue().extensions[0], entryFor(good), served(good)), []);
  assert.match((await checkRemote(catalogue().extensions[0], entryFor(good, { size: 5 }), served(good))).join(), /'size' says 5/);
  assert.match((await checkRemote(catalogue().extensions[0], entryFor(good, { sha256: 'd'.repeat(64) }), served(good))).join(), /'sha256'/);
  const other = zip({ 'nexus-plugin.json': manifest({ id: 'com.example.other', version: '2.0.0', nexusApi: '^1.9' }) });
  const text = (await checkRemote(catalogue().extensions[0], entryFor(other), served(other))).join('\n');
  assert.match(text, /manifest's id is 'com.example.other'/);
  assert.match(text, /manifest's version is '2.0.0'/);
  assert.match(text, /manifest's nexusApi is '\^1.9'/);
});

test('what the Store shows must be what the manifest says', async () => {
  const lying = zip({ 'nexus-plugin.json': manifest({ name: 'Other', author: 'Else', description: 'x', type: 'plugin', permissions: ['network'], minAppVersion: '6.0.0', minFirmwareBuild: 1 }) });
  const text = (await checkRemote(catalogue().extensions[0], entryFor(lying), served(lying))).join(' ');
  for (const part of ['name is "Other"', 'author is "Else"', 'description differs', "type is 'plugin'", 'asks for \\[network\\]', 'minAppVersion differs', 'minFirmwareBuild differs']) assert.match(text, new RegExp(part));
});

test('a missing manifest, a nested manifest, a failed download and a thrown fetch are each a problem, not a crash', async () => {
  const nested = zip({ 'folder/nexus-plugin.json': manifest() });
  assert.match((await checkRemote(catalogue().extensions[0], entryFor(nested), served(nested))).join(), /no nexus-plugin.json at its top level/);
  assert.match((await checkRemote(catalogue().extensions[0], version(), served(Buffer.alloc(0), 404))).join(), /HTTP 404/);
  assert.match((await checkRemote(catalogue().extensions[0], version(), async () => { throw new Error('offline'); })).join(), /offline/);
  const junk = Buffer.from('definitely not a zip file');
  assert.match((await checkRemote(catalogue().extensions[0], entryFor(junk), served(junk))).join(), /cannot read the zip/);
});
