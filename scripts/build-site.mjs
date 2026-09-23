/*
 | Assemble the whole thing as one static site, for Vercel.
 |
 |   npm run build:site        → site/
 |
 |   /                    the showcase hub (demos mounted inline)
 |   /map                 the family-facing map, with URL sync
 |   /operator            the operator panels
 |   /editor              the plan tracer
 |   /client-site         a pretend client website carrying the snippet
 |   /v1/embed.js         the snippet target, plus /v1/runtime.js
 |   /v1/maps/<slug>      the map payload (static JSON; vercel.json rewrites
 |                        the extensionless URL onto it)
 |   /v1/maps/<slug>/leads   POST → api/leads.js (a Vercel function)
 |
 | The three Vite builds each have their own config and output directory;
 | this runs them and copies the results into place. Nothing here is
 | Vercel-specific except the layout: any static host that can rewrite
 | /v1/maps/:slug → /v1/maps/:slug.json serves it just as well.
 */

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const out = resolve(root, 'site');
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });

run('npx vite build');
run('npx vite build -c vite.embed.config.js');
run('npm run demo:bundle');

await rm(out, { recursive: true, force: true });
await mkdir(resolve(out, 'v1/maps'), { recursive: true });

/* The demo pages. Each lands in its own folder as index.html so the URL is
   clean; their assets are referenced absolutely (/assets/…) so the move is
   free. */
await cp(resolve(root, 'dist/assets'), resolve(out, 'assets'), { recursive: true });
for (const [from, to] of [['index.html', 'map'], ['operator.html', 'operator'], ['editor.html', 'editor']]) {
    await mkdir(resolve(out, to), { recursive: true });
    await cp(resolve(root, 'dist', from), resolve(out, to, 'index.html'));
}

/* The hub, with the full-page links that the artifact version cannot use. */
const hub = await readFile(resolve(root, '.demo-stage/index.html'), 'utf8');
const links = `<nav id="site-links" class="site-links" aria-label="Full pages">
        <span>Full pages:</span>
        <a href="/map">Family map</a>
        <a href="/operator">Operator panels</a>
        <a href="/editor">Plan tracer</a>
        <a href="/client-site">Client site with the snippet</a>
    </nav>`;
if (!hub.includes('<!-- __SITE_LINKS__ -->')) throw new Error('demo/hub.html has no __SITE_LINKS__ placeholder');
await writeFile(resolve(out, 'index.html'), hub.replace('<!-- __SITE_LINKS__ -->', links));

/* The client site and the embed. */
await cp(resolve(root, 'demo/client-site.html'), resolve(out, 'client-site.html'));
await cp(resolve(root, 'dist-embed/embed.js'), resolve(out, 'v1/embed.js'));
await cp(resolve(root, 'dist-embed/runtime.js'), resolve(out, 'v1/runtime.js'));

/* Map payloads. Until the platform has its own API these are the JSON files
   the demos import, served as-is. */
for (const file of ['commons-on-meridian', 'willow-creek']) {
    const community = JSON.parse(await readFile(resolve(root, `demo/data/${file}.json`), 'utf8'));
    await writeFile(resolve(out, `v1/maps/${community.slug}.json`), JSON.stringify(community));
}

console.log(`Site assembled in ${out}`);
