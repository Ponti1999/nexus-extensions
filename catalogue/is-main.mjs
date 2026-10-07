// "Is this file the one Node was started with?" Compares whole paths, so a script that merely IMPORTS a catalogue tool (and has a similar name, like my-pack.mjs) never runs its command line.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const isMain = (metaUrl) => Boolean(process.argv[1]) && resolve(process.argv[1]) === resolve(fileURLToPath(metaUrl));
