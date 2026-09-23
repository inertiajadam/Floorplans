/*
 | Assemble the hosted demo in .demo-stage/.
 |
 | One file. The hub (demo/hub.html) is the page; the showcase bundle
 | (dist-showcase/showcase.js — Vue, all four demos and their compiled
 | stylesheet) is inlined into it, so the published page fetches nothing.
 | Every sub-resource is something a sandbox can refuse, and the artifact
 | viewer refuses several, including opening a published sub-page top-level.
 |
 | Run: npm run demo:bundle
 */

import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const out = resolve(root, '.demo-stage');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const hub = await readFile(resolve(root, 'demo/hub.html'), 'utf8');
let bundle = await readFile(resolve(root, 'dist-showcase/showcase.js'), 'utf8');

/* The HTML parser ends a <script> at the first "</script" it sees, even inside
   a JS string. "<\/" is "</" to the JS engine, so escaping is lossless. Same
   for "<!--", which can open a comment in a classic script context. */
bundle = bundle.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

if (!hub.includes('__SHOWCASE_BUNDLE__')) {
    throw new Error('demo/hub.html has no __SHOWCASE_BUNDLE__ placeholder');
}
const page = hub.replace('__SHOWCASE_BUNDLE__', () => bundle);

await writeFile(resolve(out, 'index.html'), page);
console.log(`Demo assembled: ${out}/index.html (${(page.length / 1024).toFixed(0)} kB)`);
