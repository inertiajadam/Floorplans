import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { inlineStylesheet } from './scripts/vite-inline-css.mjs';

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

export default defineConfig({
    plugins: [vue(), tailwindcss(), inlineStylesheet({ version })],
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
