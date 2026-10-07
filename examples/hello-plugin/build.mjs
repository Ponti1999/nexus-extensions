// Builds hello-plugin.nexusext: copies the built SDK in beside main.mjs (an extension carries its own files; Nexus Studio does not install packages for it), then packs the folder.
//   cd sdk && npm install && npm run build      once
//   node examples/hello-plugin/build.mjs
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync, cpSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packDirectory } from '../../catalogue/pack.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const sdk = join(here, '..', '..', 'sdk', 'build', 'src', 'index.js');
if (!existsSync(sdk)) {
  console.error('Build the SDK first: cd sdk && npm install && npm run build');
  process.exit(2);
}
const staging = mkdtempSync(join(tmpdir(), 'hello-plugin-'));
for (const file of ['nexus-plugin.json', 'main.mjs']) cpSync(join(here, file), join(staging, file));
copyFileSync(sdk, join(staging, 'nexus-extension-sdk.mjs'));
const packed = packDirectory(staging);
if (packed.problems) {
  for (const p of packed.problems) console.error(p);
  process.exit(1);
}
const out = join(here, 'hello-plugin.nexusext');
writeFileSync(out, packed.bytes);
console.log(`Wrote ${out} (${packed.files.join(', ')})`);
console.log(`  sha256 ${createHash('sha256').update(packed.bytes).digest('hex')}  size ${packed.bytes.length}`);
