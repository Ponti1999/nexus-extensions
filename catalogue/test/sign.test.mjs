import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKey, keyIdOf, signBytes, verifyBytes } from '../sign.mjs';

const index = Buffer.from('{\n  "schemaVersion": 1,\n  "extensions": []\n}\n');

function trustedFor(key) {
  return [{ keyId: key.keyId, publicKey: key.publicKeyHex }];
}

test('a signature made with a key verifies against that key, and the key id is derived from the public key', () => {
  const key = generateKey();
  assert.equal(key.keyId, keyIdOf(key.publicKeyHex));
  assert.equal(key.publicKeyHex.length, 64);
  const sig = signBytes(index, key.privatePem);
  assert.equal(sig.keyId, key.keyId);
  assert.deepEqual(verifyBytes(index, sig, trustedFor(key)), { ok: true, reason: '', keyId: key.keyId });
});

test('any change to the file, even one space, breaks the signature', () => {
  const key = generateKey();
  const sig = signBytes(index, key.privatePem);
  const edited = Buffer.concat([index, Buffer.from(' ')]);
  const result = verifyBytes(edited, sig, trustedFor(key));
  assert.equal(result.ok, false);
  assert.match(result.reason, /edited after signing/);
});

test('a signature by a key that is not trusted is refused, including a look-alike', () => {
  const mine = generateKey();
  const other = generateKey();
  const sig = signBytes(index, other.privatePem);
  assert.match(verifyBytes(index, sig, trustedFor(mine)).reason, /not trusted/);
  assert.match(verifyBytes(index, sig, []).reason, /not trusted/);
  // someone puts their public key under MY key id: the id no longer matches the key, so it is refused
  assert.match(verifyBytes(index, signBytes(index, other.privatePem), [{ keyId: other.keyId, publicKey: mine.publicKeyHex }]).reason, /does not match its own id/);
});

test('a malformed signature file is a refusal, never a crash', () => {
  const key = generateKey();
  for (const bad of [null, {}, { alg: 'rsa', keyId: key.keyId, signature: 'AA==' }, { alg: 'ed25519', keyId: key.keyId, signature: 'AAAA' }, { alg: 'ed25519', keyId: key.keyId, signature: 5 }]) {
    assert.equal(verifyBytes(index, bad, trustedFor(key)).ok, false);
  }
});

test('a rotated key set: either trusted key verifies its own signatures', () => {
  const a = generateKey();
  const b = generateKey();
  const both = [...trustedFor(a), ...trustedFor(b)];
  assert.equal(verifyBytes(index, signBytes(index, a.privatePem), both).ok, true);
  assert.equal(verifyBytes(index, signBytes(index, b.privatePem), both).ok, true);
});
