// Validates `index.json`, the catalogue of approved Nexus Studio extensions (docs/catalogue.md).
//
//   node catalogue/validate.mjs [index.json] [--base base-index.json] [--remote]
//
// Static checks always run. `--base` compares with the catalogue as it is on the target branch (what a pull request would change):
// versions are immutable and never deleted, and an author may not write `testedWith`. `--remote` downloads every NEW version's zip
// (all of them when there is no `--base`), checks its size and SHA-256, and checks that the `nexus-plugin.json` inside agrees with
// the entry. Exit code 0 = no problem, 1 = problems (all printed), 2 = could not run.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { listEntries, readEntry } from './zip.mjs';

// The same rules as the app's manifest loader (nexus_studio/extensions/packs/manifest.py, semver.py).
export const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/;
export const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
export const API_RANGE = /^\^(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const REPO = /^https:\/\/github\.com\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const SHA256 = /^[0-9a-f]{64}$/;
export const MAX_ZIP_BYTES = 20 * 1024 * 1024; // the app refuses a file over 20 MB
const ENTRY_KEYS = new Set(['id', 'repo', 'versions']);
const VERSION_KEYS = new Set(['version', 'nexusApi', 'url', 'sha256', 'size', 'testedWith']);
const TESTED_KEYS = new Set(['app', 'result']);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function unknownKeys(obj, allowed, where, problems) {
  for (const key of Object.keys(obj)) if (!allowed.has(key)) problems.push(`${where}: unknown key '${key}'.`);
}

/** Problems with the shape of one catalogue (no network, no base). Never throws. */
export function validateIndex(index) {
  const problems = [];
  if (!isObject(index)) return ['index.json must be a JSON object.'];
  if (index.schemaVersion !== 1) problems.push(`'schemaVersion' must be 1 (got ${JSON.stringify(index.schemaVersion)}).`);
  if (!Array.isArray(index.extensions)) return [...problems, "'extensions' must be a list."];
  const seen = new Set();
  index.extensions.forEach((entry, n) => {
    const where = isObject(entry) && typeof entry.id === 'string' ? entry.id : `extensions[${n}]`;
    if (!isObject(entry)) return problems.push(`${where}: must be an object.`);
    unknownKeys(entry, ENTRY_KEYS, where, problems);
    if (typeof entry.id !== 'string' || !ID.test(entry.id)) problems.push(`${where}: 'id' must be a lower-case reverse-domain name like com.example.my-pack.`);
    else if (seen.has(entry.id)) problems.push(`${where}: listed twice.`);
    else seen.add(entry.id);
    if (typeof entry.repo !== 'string' || !REPO.test(entry.repo)) problems.push(`${where}: 'repo' must be an https://github.com/<owner>/<name> address.`);
    if (!Array.isArray(entry.versions) || entry.versions.length === 0) return problems.push(`${where}: 'versions' must be a list with at least one version.`);
    const versions = new Set();
    entry.versions.forEach((v, i) => {
      const at = `${where} version[${i}]`;
      if (!isObject(v)) return problems.push(`${at}: must be an object.`);
      unknownKeys(v, VERSION_KEYS, at, problems);
      if (typeof v.version !== 'string' || !VERSION.test(v.version)) problems.push(`${at}: 'version' must be a SemVer like 1.2.3 or 1.2.3-beta.1.`);
      else if (versions.has(v.version)) problems.push(`${at}: version ${v.version} is listed twice.`);
      else versions.add(v.version);
      if (typeof v.nexusApi !== 'string' || !API_RANGE.test(v.nexusApi)) problems.push(`${at}: 'nexusApi' must look like ^1.2.`);
      if (typeof v.sha256 !== 'string' || !SHA256.test(v.sha256)) problems.push(`${at}: 'sha256' must be 64 lower-case hex characters.`);
      if (!Number.isInteger(v.size) || v.size <= 0 || v.size > MAX_ZIP_BYTES) problems.push(`${at}: 'size' must be a whole number of bytes, at most ${MAX_ZIP_BYTES}.`);
      if (typeof v.url !== 'string') problems.push(`${at}: 'url' is missing.`);
      else if (typeof entry.repo === 'string' && REPO.test(entry.repo)) {
        const prefix = `${entry.repo}/releases/download/`;
        if (!v.url.startsWith(prefix) || !v.url.endsWith('.nexusext') || /[?#\s]/.test(v.url) || v.url.includes('..')) {
          problems.push(`${at}: 'url' must be a release asset of ${entry.repo} ending in .nexusext (${prefix}<tag>/<file>.nexusext).`);
        }
      }
      if (v.testedWith !== undefined) {
        if (!Array.isArray(v.testedWith)) problems.push(`${at}: 'testedWith' must be a list.`);
        else v.testedWith.forEach((t, k) => {
          if (!isObject(t) || typeof t.app !== 'string' || !VERSION.test(t.app) || !['pass', 'fail'].includes(t.result)) problems.push(`${at}: testedWith[${k}] must be {"app": "5.0.0", "result": "pass" | "fail"}.`);
          else unknownKeys(t, TESTED_KEYS, `${at} testedWith[${k}]`, problems);
        });
      }
    });
  });
  return problems;
}

const flat = (index) => {
  const map = new Map();
  for (const e of index?.extensions ?? []) for (const v of e?.versions ?? []) map.set(`${e.id}@${v.version}`, v);
  return map;
};

/** What a pull request changes, against the target branch's catalogue: `{problems, added}` (`added` = keys `id@version` that are new). */
export function compareWithBase(index, base) {
  const problems = [];
  const before = flat(base);
  const now = flat(index);
  const added = [];
  for (const key of before.keys()) if (!now.has(key)) problems.push(`${key}: a version is never removed from the catalogue (people on older apps still install it).`);
  for (const [key, v] of now) {
    const old = before.get(key);
    if (!old) {
      added.push(key);
      if (v.testedWith !== undefined) problems.push(`${key}: 'testedWith' is written by the compatibility job, not by authors. Remove it.`);
      continue;
    }
    for (const field of ['url', 'sha256', 'size', 'nexusApi']) if (old[field] !== v[field]) problems.push(`${key}: '${field}' of a published version never changes. Publish a new version instead.`);
  }
  return { problems, added };
}

/** Download one version's zip and check what can be checked without installing it. Returns problems. */
export async function checkRemote(id, v, fetchImpl = fetch) {
  const key = `${id}@${v.version}`;
  let bytes;
  try {
    const res = await fetchImpl(v.url, { redirect: 'follow' });
    if (!res.ok) return [`${key}: could not download ${v.url} (HTTP ${res.status}).`];
    bytes = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    return [`${key}: could not download ${v.url} (${e.message}).`];
  }
  const problems = [];
  if (bytes.length !== v.size) problems.push(`${key}: 'size' says ${v.size} bytes, the file is ${bytes.length}.`);
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== v.sha256) problems.push(`${key}: 'sha256' says ${v.sha256}, the file is ${digest}.`);
  try {
    const entries = listEntries(bytes);
    const manifest = entries.find((e) => e.name === 'nexus-plugin.json');
    if (!manifest) return [...problems, `${key}: the zip has no nexus-plugin.json at its top level.`];
    const data = JSON.parse(readEntry(bytes, manifest).toString('utf8'));
    if (data.id !== id) problems.push(`${key}: the manifest's id is '${data.id}', not '${id}'.`);
    if (data.version !== v.version) problems.push(`${key}: the manifest's version is '${data.version}', not '${v.version}'.`);
    if (data.nexusApi !== v.nexusApi) problems.push(`${key}: the manifest's nexusApi is '${data.nexusApi}', not '${v.nexusApi}'.`);
  } catch (e) {
    problems.push(`${key}: cannot read the zip (${e.message}).`);
  }
  return problems;
}

async function main(argv) {
  const files = argv.filter((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--base');
  const path = files[0] ?? 'index.json';
  const basePath = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : null;
  let index;
  try {
    index = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    console.error(`Cannot read ${path}: ${e.message}`);
    return 2;
  }
  const problems = validateIndex(index);
  let only = null;
  if (basePath) {
    let base;
    try { base = JSON.parse(readFileSync(basePath, 'utf8')); } catch (e) { console.error(`Cannot read ${basePath}: ${e.message}`); return 2; }
    const compared = compareWithBase(index, base);
    problems.push(...compared.problems);
    only = new Set(compared.added);
  }
  if (argv.includes('--remote') && problems.length === 0) {
    for (const e of index.extensions) for (const v of e.versions) if (!only || only.has(`${e.id}@${v.version}`)) problems.push(...(await checkRemote(e.id, v)));
  }
  for (const p of problems) console.error(p);
  console.log(problems.length ? `${problems.length} problem(s).` : `${path}: ok (${flat(index).size} version(s) of ${index.extensions.length} extension(s)).`);
  return problems.length ? 1 : 0;
}

if (process.argv[1]?.endsWith('validate.mjs')) { // run as a command, not imported by a test
  process.exitCode = await main(process.argv.slice(2));
}
