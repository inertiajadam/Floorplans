import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';

/*
 | The embeddable build.
 |
 | Separate from the demo build because it has different rules: fixed file
 | names (the snippet URL is public and permanent), no hashing, and the
 | stylesheet folded into the JS.
 |
 | Two outputs:
 |
 |   embed.js    the snippet target. Tiny, non-blocking, and all it does is
 |               reserve space and wait. This is what a client pastes.
 |   runtime.js  Vue, the map, and the stylesheet. Fetched by embed.js only
 |               once a map is nearly on screen.
 |
 | Deploy both under a versioned path (/v1/) and cache them hard. The snippet
 | on a client's site points at a URL that must keep working for years, so the
 | version lives in the path and breaking changes get /v2/ rather than a
 | surprise on somebody's homepage.
 */

const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

/**
 * Fold the compiled stylesheet into the runtime chunk.
 *
 * The alternative — shipping style.css and fetching it — costs a second
 * request and, worse, lets the map render unstyled while that request is in
 * flight. On someone else's website a flash of unstyled map looks broken.
 */
function inlineStylesheet() {
    return {
        name: 'inline-embed-stylesheet',
        apply: 'build',
        enforce: 'post',
        generateBundle(_options, bundle) {
            const cssFiles = Object.keys(bundle).filter((f) => f.endsWith('.css'));
            const css = cssFiles.map((f) => bundle[f].source ?? '').join('\n');

            let injected = false;
            for (const file of Object.keys(bundle)) {
                const chunk = bundle[file];
                if (chunk.type !== 'chunk' || !chunk.code.includes('__EMBED_CSS__')) continue;

                /* Backticks matter: the minifier rewrites short string
                   literals as template literals, so matching only ' and "
                   silently leaves the placeholder in the bundle and ships an
                   unstyled map. */
                chunk.code = chunk.code
                    .replace(/["'`]__EMBED_CSS__["'`]/g, JSON.stringify(css))
                    .replace(/__EMBED_VERSION__/g, version);
                injected = true;
            }

            /* Fail the build rather than shipping an unstyled embed. This has
               already gone wrong once (quote style), and the failure mode is
               invisible until the map is on somebody's website. */
            if (css && !injected) {
                this.error('Embed stylesheet was compiled but never injected — the __EMBED_CSS__ placeholder was not found in any chunk.');
            }
            if (!css) {
                this.error('No stylesheet was compiled for the embed — check that element.js still imports embed.css.');
            }

            /* Drop the standalone CSS so nobody deploys a file that is now
               dead weight and could drift out of sync with the JS. */
            for (const f of cssFiles) delete bundle[f];
        },
    };
}

export default defineConfig({
    plugins: [vue(), tailwindcss(), inlineStylesheet()],
    define: {
        /* Vue ships dev warnings unless this is set, and they are noise in
           someone else's console. */
        'process.env.NODE_ENV': JSON.stringify('production'),
        __VUE_OPTIONS_API__: 'false',
        __VUE_PROD_DEVTOOLS__: 'false',
        __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
    },
    build: {
        outDir: fileURLToPath(new URL('./dist-embed', import.meta.url)),
        emptyOutDir: true,
        cssCodeSplit: false,
        target: 'es2022',
        rollupOptions: {
            input: {
                embed: fileURLToPath(new URL('./src/embed/loader.js', import.meta.url)),
                runtime: fileURLToPath(new URL('./src/embed/runtime.js', import.meta.url)),
            },
            output: {
                format: 'es',
                /* Fixed names: the loader resolves ./runtime.js relative to
                   itself, and the snippet URL is public. */
                entryFileNames: '[name].js',
                chunkFileNames: 'chunk-[hash].js',
                assetFileNames: '[name][extname]',
                /* Keep the loader genuinely standalone — no shared chunk that
                   would make the "tiny" snippet pull the runtime anyway. */
                manualChunks: undefined,
            },
            /* The loader imports the runtime by absolute URL at runtime; do not
               try to resolve or bundle it. */
            external: [],
        },
    },
});
