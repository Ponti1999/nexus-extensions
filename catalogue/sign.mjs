// Signs and verifies the catalogue (docs/catalogue.md, "Signing"). Ed25519, Node's own crypto, no dependencies.
//
//   node catalogue/sign.mjs keygen <private-key-file>          make a key pair; prints the public key to put in catalogue/trusted-keys.json
//   node catalogue/sign.mjs sign   [index.json] --key <file>   write index.json.sig for the exact bytes of index.json
//   node catalogue/sign.mjs verify [index.json]                check index.json.sig against catalogue/trusted-keys.json
//
// The signature is a small JSON file: {"alg": "ed25519", "keyId": "<first 16 hex of SHA-256 of the public key>", "signature": "<base64>"}.
// It covers the file's bytes exactly as stored, so any edit (even a space) needs signing again. The private key never goes in this repo.
// Exit code 0 = ok, 1 = a signature problem, 2 = could not run.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isMain } from './is-main.mjs';

export const ALG = 'ed25519';
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex'); // the fixed DER header of an Ed25519 public key

export const keyIdOf = (publicKeyHex) => createHash('sha256').update(Buffer.from(publicKeyHex, 'hex')).digest('hex').slice(0, 16);

/** A new key pair: `{privatePem, publicKeyHex, keyId}`. */
export function generateKey() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicKeyHex = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
  return { privatePem: privateKey.export({ format: 'pem', type: 'pkcs8' }), publicKeyHex, keyId: keyIdOf(publicKeyHex) };
}

/** The signature object for `bytes`, made with a PEM private key. */
export function signBytes(bytes, privatePem) {
  const key = createPrivateKey(privatePem);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('the key is not an Ed25519 key');
  const publicKeyHex = createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
  return { alg: ALG, keyId: keyIdOf(publicKeyHex), signature: sign(null, bytes, key).toString('base64') };
}

/** `{ok, reason, keyId}`: is `sigObject` a good signature over `bytes` by one of `trusted` (`[{keyId, publicKey}]`)? Never throws. */
export function verifyBytes(bytes, sigObject, trusted) {
  try {
    if (!sigObject || sigObject.alg !== ALG || typeof sigObject.keyId !== 'string' || typeof sigObject.signature !== 'string') return { ok: false, reason: 'the signature file is not an ed25519 signature' };
    const key = (trusted ?? []).find((k) => k.keyId === sigObject.keyId);
    if (!key) return { ok: false, reason: `the signature was made with key ${sigObject.keyId}, which is not trusted` };
    if (keyIdOf(key.publicKey) !== key.keyId) return { ok: false, reason: `trusted key ${key.keyId} does not match its own id` };
    const sig = Buffer.from(sigObject.signature, 'base64');
    if (sig.length !== 64) return { ok: false, reason: 'the signature is not 64 bytes' };
    const publicKey = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(key.publicKey, 'hex')]), format: 'der', type: 'spki' });
    return verify(null, bytes, publicKey, sig) ? { ok: true, reason: '', keyId: key.keyId } : { ok: false, reason: 'the signature does not match index.json: it was edited after signing' };
  } catch (e) {
    return { ok: false, reason: `could not check the signature (${e.message})` };
  }
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const flag = (name) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : null);
  const positional = rest.filter((a, i) => !a.startsWith('--') && rest[i - 1] !== '--key' && rest[i - 1] !== '--keys');
  if (cmd === 'keygen') {
    const out = positional[0];
    if (!out) { console.error('usage: sign.mjs keygen <private-key-file>'); return 2; }
    if (existsSync(out)) { console.error(`${out} already exists: not overwriting a key`); return 2; }
    const { privatePem, publicKeyHex, keyId } = generateKey();
    writeFileSync(out, privatePem, { mode: 0o600 });
    console.log(`Private key written to ${out}. KEEP IT OUT OF THIS REPO and back it up: losing it means nothing new can be signed.`);
    console.log(`Add to catalogue/trusted-keys.json:\n  {"keyId": "${keyId}", "publicKey": "${publicKeyHex}"}`);
    return 0;
  }
  const indexPath = positional[0] ?? 'index.json';
  const sigPath = `${indexPath}.sig`;
  if (cmd === 'sign') {
    const keyFile = flag('--key');
    if (!keyFile) { console.error('usage: sign.mjs sign [index.json] --key <private-key-file>'); return 2; }
    try {
      const bytes = readFileSync(indexPath);
      // The repo and GitHub hold LF. A copy that a checkout turned into CRLF would be signed here and then never verify where it is served from.
      if (bytes.includes(13)) {
        console.error(`${indexPath} contains carriage returns (CRLF line endings): not signing it. Restore it exactly as committed (git checkout -- ${indexPath}) and sign again.`);
        return 2;
      }
      writeFileSync(sigPath, `${JSON.stringify(signBytes(bytes, readFileSync(keyFile, 'utf8')), null, 2)}\n`);
    } catch (e) { console.error(`Cannot sign: ${e.message}`); return 2; }
    console.log(`Wrote ${sigPath}`);
    return 0;
  }
  if (cmd === 'verify') {
    let result;
    try {
      const trusted = JSON.parse(readFileSync(flag('--keys') ?? 'catalogue/trusted-keys.json', 'utf8')).keys;
      result = verifyBytes(readFileSync(indexPath), JSON.parse(readFileSync(sigPath, 'utf8')), trusted);
    } catch (e) { console.error(`Cannot verify: ${e.message}`); return 2; }
    console.log(result.ok ? `${indexPath}: signature ok (key ${result.keyId})` : `${indexPath}: ${result.reason}`);
    return result.ok ? 0 : 1;
  }
  console.error('usage: sign.mjs keygen|sign|verify ...');
  return 2;
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2)); // run as a command, not imported by a test
