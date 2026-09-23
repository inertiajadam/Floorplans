/*
 | The embed runtime.
 |
 | Loaded on demand by loader.js, so a host page pays for Vue and the map only
 | once a map is actually about to be seen. Defines the custom element and
 | upgrades any placeholders already on the page.
 */

import { defineCommunityMap, CommunityMapElement, DEFAULT_TAG, DEFAULT_API } from './element.js';

const tag = defineCommunityMap(DEFAULT_TAG);

/* A global handle so a host page can do things we have not thought of —
   render a map into a modal they open, swap communities in a single-page app,
   or listen for events before any element exists. */
const api = {
    tag,
    version: '__EMBED_VERSION__',
    define: defineCommunityMap,
    Element: CommunityMapElement,

    /**
     * Put a map somewhere, without writing markup.
     *
     * @param {Element|string} target  element or selector
     * @param {{map: string, api?: string, theme?: object, height?: string|number, deepLink?: boolean, lazy?: boolean, payload?: object}} options
     */
    render(target, options = {}) {
        const host = typeof target === 'string' ? document.querySelector(target) : target;
        if (!host || !options.map) return null;

        const el = document.createElement(tag ?? DEFAULT_TAG);
        el.setAttribute('map', options.map);
        if (options.api) el.setAttribute('api', options.api);
        if (options.theme) el.setAttribute('theme', JSON.stringify(options.theme));
        if (options.height) el.setAttribute('height', String(options.height));
        if (options.deepLink) el.setAttribute('deep-link', 'true');
        if (options.lazy === false) el.setAttribute('lazy', 'false');
        /* A server-rendered payload skips the fetch entirely, which is how the
           Seniors Places listing page avoids a second round trip for data it
           already has. */
        if (options.payload) el.payload = options.payload;

        host.appendChild(el);
        return el;
    },
};

if (typeof window !== 'undefined') {
    window.CommunityMap = Object.assign(window.CommunityMap ?? {}, api);
    /* Tells the loader, and any host script waiting on us, that we are up. */
    window.dispatchEvent(new CustomEvent('community-map:ready', { detail: api }));
}

export default api;
export { defineCommunityMap, CommunityMapElement, DEFAULT_API };
