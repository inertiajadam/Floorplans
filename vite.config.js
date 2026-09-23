import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

/*
 | Two entry points, both served from the repo root:
 |   index.html   the map itself, running against demo/data/willow-creek.json
 |   editor.html  the plan tracing tool
 |
 | This config only exists to run the demo. When the components move into
 | seniorsplaces-platform they are compiled by that app's Vite build — see
 | docs/INTEGRATION.md. Nothing in src/ imports anything from this file.
 */
export default defineConfig({
    plugins: [vue(), tailwindcss()],
    resolve: {
        alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    build: {
        rollupOptions: {
            input: {
                main: fileURLToPath(new URL('./index.html', import.meta.url)),
                editor: fileURLToPath(new URL('./editor.html', import.meta.url)),
            },
        },
    },
});
