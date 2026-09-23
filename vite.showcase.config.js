import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { inlineStylesheet } from './scripts/vite-inline-css.mjs';

/*
 | The hosted demo, as one script.
 |
 | The demo hub is a hand-authored page; this bundle is what it loads to mount
 | each demo in place when a card is chosen. Everything mounts into a shadow
 | root, for two reasons:
 |
 |   - the hub has its own typography and layout, and the demos ship Tailwind's
 |     preflight, which would flatten it
 |   - the demos should not navigate away. The artifact viewer refuses to open
 |     a published sub-page top-level, so links out of the hub are dead ends;
 |     one page with in-place mounting is the only shape that works there
 |
 | Same CSS-inlining approach as the embed build, for the same reason.
 */

const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

export default defineConfig({
    plugins: [vue(), tailwindcss(), inlineStylesheet({ version })],
    define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
        __VUE_OPTIONS_API__: 'false',
        __VUE_PROD_DEVTOOLS__: 'false',
        __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
    },
    build: {
        outDir: fileURLToPath(new URL('./dist-showcase', import.meta.url)),
        emptyOutDir: true,
        cssCodeSplit: false,
        target: 'es2022',
        rollupOptions: {
            input: { showcase: fileURLToPath(new URL('./demo/showcase.js', import.meta.url)) },
            output: {
                format: 'es',
                /* A fixed name so the hub can reference it without a manifest. */
                entryFileNames: '[name].js',
                chunkFileNames: 'chunk-[hash].js',
                assetFileNames: '[name][extname]',
                inlineDynamicImports: true,
            },
        },
    },
});
