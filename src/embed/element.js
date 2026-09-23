/*
 | <community-map> — the map as a custom element.
 |
 | One Shadow DOM boundary does two jobs, and both matter on somebody else's
 | website:
 |
 |   their CSS cannot reach us   a host page's `h2 { font-size: 3rem }` or
 |                               `* { box-sizing: content-box }` would
 |                               otherwise wreck the layout, and those rules
 |                               are extremely common
 |   our CSS cannot reach them   we ship Tailwind's preflight, which resets
 |                               margins and list styles globally. Injected
 |                               into a host page it would silently restyle
 |                               their site. That is the sort of thing that
 |                               gets an embed torn out.
 |
 | Fonts still inherit across the boundary on purpose — an embed that imposes
 | its own typeface looks pasted on. See the :host block in embed.css.
 |
 | The element is defensive throughout: a failure here happens inside someone
 | else's page, where an uncaught error can take down their scripts too.
 */

import { createApp, h } from 'vue';
import EmbedMap from './EmbedMap.vue';

/* Imported for its side effect: this is what makes Tailwind compile the
   embed stylesheet. The build then folds the result into this file in place
   of __EMBED_CSS__ below (see vite.embed.config.js). */
import './embed.css';

/* Replaced at build time with the compiled stylesheet (see vite.embed.config.js).
   Inlined rather than fetched so an embed is one request and cannot render
   unstyled while a stylesheet is in flight. */
const STYLES = '__EMBED_CSS__';

const DEFAULT_TAG = 'community-map';
const DEFAULT_API = 'https://maps.seniorsplaces.com';

/**
 * Theme keys an operator may set, mapped to the custom properties they drive.
 *
 * Deliberately a small, safe surface. Values are written into a stylesheet, so
 * an unvalidated value would be a CSS injection vector — see sanitiseColor.
 * Availability colours are NOT themeable: they are paired with hatch patterns
 * and carry meaning, and letting a brand palette override them would make the
 * map unreadable for exactly the people the patterns are there to protect.
 */
const THEME_KEYS = {
    brand:      '--color-brand',
    brandDark:  '--color-brand-dark',
    brandLight: '--color-brand-light',
    brandMid:   '--color-brand-mid',
    ink:        '--color-ink',
    inkMid:     '--color-ink-mid',
    surface:    '--color-warm',
    hairline:   '--color-hairline',
    radius:     '--radius-brand',
    radiusCard: '--radius-card',
    font:       '--font-sans',
    fontSerif:  '--font-serif',
};

/**
 * Only allow values that cannot escape a declaration.
 *
 * The theme arrives from an API payload and from host-page attributes, so it
 * is untrusted input being written into CSS. Anything containing a brace,
 * semicolon, `url(` or a comment sequence is dropped rather than escaped —
 * rejecting is safer than sanitising, and no legitimate colour or font stack
 * needs those characters.
 */
function safeCssValue(value) {
    if (typeof value !== 'string') return null;
    const v = value.trim();
    if (!v || v.length > 120) return null;
    if (/[{};<>]|url\(|\/\*|\*\/|expression|@import/i.test(v)) return null;
    return v;
}

function themeCss(theme) {
    if (!theme || typeof theme !== 'object') return '';
    const decls = [];
    for (const [key, prop] of Object.entries(THEME_KEYS)) {
        const value = safeCssValue(theme[key]);
        if (value) decls.push(`${prop}:${value}`);
    }
    return decls.length ? `:host{${decls.join(';')}}` : '';
}

/** Attributes are strings; "false" and "0" must not read as true. */
function boolAttr(el, name, fallback = false) {
    if (!el.hasAttribute(name)) return fallback;
    const v = (el.getAttribute(name) || '').trim().toLowerCase();
    return v !== 'false' && v !== '0' && v !== 'off' && v !== 'no';
}

function parseJsonAttr(el, name) {
    const raw = el.getAttribute(name);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        /* A malformed theme must not stop the map rendering. */
        return null;
    }
}

export class CommunityMapElement extends HTMLElement {
    static get observedAttributes() {
        return ['map', 'api', 'theme', 'height', 'deep-link', 'lazy'];
    }

    #app = null;
    #mount = null;
    #themeSheet = null;
    /* Theme delivered with the fetched payload, as opposed to one set on the
       element by the host page. */
    #remoteTheme = null;

    connectedCallback() {
        /* Guard against double-connection: moving an element in the DOM
           disconnects and reconnects it, and mounting twice would leak. */
        if (this.#app) return;

        try {
            this.#render();
        } catch (err) {
            this.#bail(err);
        }
    }

    disconnectedCallback() {
        try {
            this.#app?.unmount();
        } catch {
            /* Unmounting a broken tree must not throw into the host page. */
        }
        this.#app = null;
        this.#mount = null;
    }

    attributeChangedCallback(name, previous, next) {
        if (previous === next || !this.#app) return;

        if (name === 'theme') {
            this.#applyTheme();
            return;
        }
        if (name === 'height') {
            this.#applyHeight();
            return;
        }
        /* map/api/deep-link/lazy change what is loaded, so remount. Rare in
           practice; a single-page app swapping communities is the case. */
        this.disconnectedCallback();
        this.#render();
    }

    #render() {
        const shadow = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
        shadow.innerHTML = '';

        /* Constructable stylesheets when available — one parsed copy shared by
           every embed on the page. The <style> fallback keeps older Safari
           working, at the cost of re-parsing per instance. */
        const base = CommunityMapElement.#sheet();
        if (base && 'adoptedStyleSheets' in shadow) {
            shadow.adoptedStyleSheets = [base];
        } else {
            const style = document.createElement('style');
            style.textContent = STYLES;
            shadow.appendChild(style);
        }

        this.#themeSheet = document.createElement('style');
        shadow.appendChild(this.#themeSheet);

        this.#mount = document.createElement('div');
        this.#mount.style.height = '100%';
        shadow.appendChild(this.#mount);

        this.#applyTheme();
        this.#applyHeight();

        const mapId = this.getAttribute('map');
        if (!mapId) {
            /* Nothing useful to show, and shouting at a visitor about a
               configuration mistake helps nobody. Warn the developer. */
            console.warn('<community-map> needs a `map` attribute.');
            return;
        }

        const self = this;
        this.#app = createApp({
            render: () => h(EmbedMap, {
                mapId,
                apiBase: (self.getAttribute('api') || DEFAULT_API).replace(/\/+$/, ''),
                payload: self.payload ?? null,
                deepLink: boolAttr(self, 'deep-link', false),
                lazy: boolAttr(self, 'lazy', true),
                /* Re-emitted as DOM events so a host page can hook analytics
                   without knowing anything about Vue. */
                onLoaded: (p) => {
                    /* The operator's theme travels with the payload, which the
                       component fetches itself — so the element only learns of
                       it here. Without this, a themed map renders in platform
                       colours on the client's own site. */
                    self.#remoteTheme = p?.theme ?? null;
                    self.#applyTheme();
                    self.#emit('map:loaded', { mapId, units: p?.buildings?.length ?? 0 });
                },
                onLead: (p) => self.#emit('map:lead', { mapId, unit: p?.context?.unitNumber ?? null }),
                onError: (e) => self.#emit('map:error', { mapId, message: String(e?.message ?? e) }),
            }),
        });

        /* Vue's own errors must not escape into the host page either. */
        this.#app.config.errorHandler = (err) => {
            console.error('[community-map]', err);
            this.#emit('map:error', { mapId, message: String(err?.message ?? err) });
        };

        this.#app.mount(this.#mount);
    }

    #applyTheme() {
        if (!this.#themeSheet) return;
        /* Attribute theme wins over the payload's, so a host page can override
           what the operator set — useful for dark sections and A/B tests. */
        const fromAttr = parseJsonAttr(this, 'theme');
        const fromPayload = this.payload?.theme ?? this.#remoteTheme ?? null;
        this.#themeSheet.textContent = themeCss({ ...(fromPayload ?? {}), ...(fromAttr ?? {}) });
    }

    #applyHeight() {
        const h = this.getAttribute('height');
        if (!h) {
            this.style.removeProperty('height');
            return;
        }
        /* A bare number means pixels — "700" is what people write. */
        const value = /^\d+$/.test(h.trim()) ? `${h.trim()}px` : h.trim();
        if (safeCssValue(value)) this.style.height = value;
    }

    #emit(type, detail) {
        try {
            this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
        } catch {
            /* Event dispatch failing is not worth breaking a page over. */
        }
    }

    #bail(err) {
        console.error('[community-map] failed to start', err);
        this.#emit('map:error', { message: String(err?.message ?? err) });
    }

    /** Set by the loader for server-rendered payloads; skips the fetch. */
    payload = null;

    /* One parsed stylesheet for every instance on the page. */
    static #cachedSheet;
    static #sheet() {
        if (this.#cachedSheet !== undefined) return this.#cachedSheet;
        try {
            const sheet = new CSSStyleSheet();
            sheet.replaceSync(STYLES);
            this.#cachedSheet = sheet;
        } catch {
            this.#cachedSheet = null;
        }
        return this.#cachedSheet;
    }
}

/**
 * Register the element.
 *
 * The tag is overridable because custom element names are global to a page: if
 * a host site already defines `community-map`, redefining it throws and takes
 * both embeds down. Re-registering the same tag is a no-op rather than an
 * error, so calling this twice (two embeds, two script tags) is safe.
 */
export function defineCommunityMap(tag = DEFAULT_TAG) {
    if (typeof window === 'undefined' || !('customElements' in window)) return null;
    if (window.customElements.get(tag)) return tag;

    try {
        window.customElements.define(tag, class extends CommunityMapElement {});
    } catch (err) {
        console.warn(`[community-map] could not register <${tag}>`, err);
        return null;
    }
    return tag;
}

export { DEFAULT_TAG, DEFAULT_API };
