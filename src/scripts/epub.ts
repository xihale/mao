import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { buildEpub } from '../lib/epub';

const out = resolve(process.argv[2] ?? 'dist/mao-selected-works.epub');
await mkdir(dirname(out), { recursive: true });
await buildEpub(out);
console.log(`EPUB written: ${out}`);
