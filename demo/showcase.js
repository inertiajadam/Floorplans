/*
 | Mounts a demo into a shadow root on demand.
 |
 | The hub page calls `window.Showcase.mount('map', hostElement)` when a card
 | is chosen and `unmount()` when the person goes back. Each demo lives inside
 | its own shadow root with the full compiled stylesheet adopted, so the hub's
 | own design is never touched by the demos' CSS and vice versa.
 |
 | Why not navigate to separate pages: the artifact viewer refuses to open a
 | published sub-page top-level (ERR_BLOCKED_BY_RESPONSE), so every link out
 | of the hub is a dead end there. One document, mounted in place, is the only
 | shape that works everywhere the demo might be opened.
 */

import { createApp } from 'vue';
import MapDemo from './MapDemo.vue';
import EmbedDemo from './EmbedDemo.vue';
import OperatorApp from './OperatorApp.vue';
import PlanEditor from '../editor/PlanEditor.vue';

/* Both stylesheets, so the merged bundle carries the demo tokens AND the
   embed's :host rules. The build folds the result into STYLES below. */
import '../src/tokens.css';
import '../src/embed/embed.css';

const STYLES = '__EMBED_CSS__';

const DEMOS = {
    map:      { component: MapDemo,     title: 'The availability map' },
    embed:    { component: EmbedDemo,   title: 'The embed, on a hostile page' },
    operator: { component: OperatorApp, title: 'The availability panel' },
    tracer:   { component: PlanEditor,  title: 'The plan tracer' },
};

let sheet;
function stylesheet() {
    if (sheet !== undefined) return sheet;
    try {
        sheet = new CSSStyleSheet();
        sheet.replaceSync(STYLES);
    } catch {
        sheet = null;
    }
    return sheet;
}

let current = null;
let currentHost = null;

function unmount() {
    try {
        current?.unmount();
    } catch {
        /* a broken tree must not stop the next demo mounting */
    }
    current = null;
    if (currentHost?.shadowRoot) currentHost.shadowRoot.innerHTML = '';
    currentHost = null;
}

function mount(name, host) {
    const demo = DEMOS[name];
    if (!demo || !host) return null;

    unmount();
    currentHost = host;

    const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '';

    const base = stylesheet();
    if (base && 'adoptedStyleSheets' in shadow) {
        shadow.adoptedStyleSheets = [base];
    } else {
        const style = document.createElement('style');
        style.textContent = STYLES;
        shadow.appendChild(style);
    }

    const root = document.createElement('div');
    shadow.appendChild(root);

    current = createApp(demo.component);
    current.config.errorHandler = (err) => console.error(`[showcase:${name}]`, err);
    current.mount(root);

    return demo.title;
}

const api = {
    mount,
    unmount,
    titles: Object.fromEntries(Object.entries(DEMOS).map(([k, v]) => [k, v.title])),
    version: '__EMBED_VERSION__',
};

if (typeof window !== 'undefined') {
    window.Showcase = api;
    window.dispatchEvent(new CustomEvent('showcase:ready', { detail: api }));
}

export default api;
