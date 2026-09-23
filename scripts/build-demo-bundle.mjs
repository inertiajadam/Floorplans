/*
 | Assemble the hosted demo bundle in .demo-stage/.
 |
 | Everything a reviewer can click, laid out exactly as it is served, so the
 | relative paths in the pages resolve the same locally and when published:
 |
 |   index.html                        the hub (authored: demo/hub.html)
 |   map.html / operator.html / …      the Vite-built demos
 |   assets/*                          their JS and CSS
 |   v1/embed.js · v1/runtime.js       the real embed build
 |   v1/maps/<slug>                    the map payload, at the exact path the
 |                                     embed's API client requests — which is
 |                                     what lets the demo run the snippet
 |                                     verbatim with no server behind it
 |
 | Run: npm run demo:bundle
 |   (after `vite build --base=./` and `vite build -c vite.embed.config.js`)
 */

import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const out = resolve(root, '.demo-stage');

await rm(out, { recursive: true, force: true });
await mkdir(resolve(out, 'v1/maps'), { recursive: true });

/* The Vite-built demos. index.html is the family map; renamed so the hub can
   take the index slot. */
await cp(resolve(root, 'dist/assets'), resolve(out, 'assets'), { recursive: true });
await cp(resolve(root, 'dist/index.html'), resolve(out, 'map.html'));
await cp(resolve(root, 'dist/operator.html'), resolve(out, 'operator.html'));
await cp(resolve(root, 'dist/editor.html'), resolve(out, 'editor.html'));

/* The embed, under the versioned path a client's snippet points at. */
await cp(resolve(root, 'dist-embed/embed.js'), resolve(out, 'v1/embed.js'));
await cp(resolve(root, 'dist-embed/runtime.js'), resolve(out, 'v1/runtime.js'));

/* The map payload, with an operator theme so the embed demo shows per-map
   branding rather than platform defaults. */
const community = JSON.parse(await readFile(resolve(root, 'demo/data/willow-creek.json'), 'utf8'));
community.theme = { brand: '#1d4ed8', brandDark: '#1e3a8a', brandLight: '#e0e7ff', radiusCard: '8px' };
await writeFile(resolve(out, `v1/maps/${community.slug}`), JSON.stringify(community));

/*
 | The hostile host page, with two demo-only changes: the API base points at
 | this bundle, and one stub answers the lead POST. The snippet itself is
 | untouched — it has to be, or the demo would not be showing the real thing.
 */
let hostile = await readFile(resolve(root, 'demo/client-site.html'), 'utf8');
hostile = hostile.replace('data-api="/"', 'data-api="."');
hostile = hostile.replace('</head>', `
    <!-- DEMO ONLY: no server here, so this answers the lead POST and nothing else. -->
    <script>
    (function () {
        const realFetch = window.fetch.bind(window);
        window.fetch = function (input, init) {
            const url = typeof input === 'string' ? input : input?.url ?? '';
            if (/\\/leads$/.test(url) && (init?.method || '').toUpperCase() === 'POST') {
                try { console.info('[demo] lead captured:', JSON.parse(init.body)); } catch {}
                return Promise.resolve(new Response('{"ok":true}', {
                    status: 200, headers: { 'content-type': 'application/json' },
                }));
            }
            return realFetch(input, init);
        };
    })();
    </script>
</head>`, 1);
await writeFile(resolve(out, 'client-site.html'), hostile);

/* The hub, as both its own name and the bundle's index. */
const hub = await readFile(resolve(root, 'demo/hub.html'), 'utf8');
await writeFile(resolve(out, 'hub.html'), hub);
await writeFile(resolve(out, 'index.html'), hub);

console.log(`Demo bundle assembled in ${out}`);
