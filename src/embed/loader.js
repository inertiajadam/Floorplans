/*
 | The snippet a client pastes into their website.
 |
 |   <script type="module" src="https://maps.example.com/v1/embed.js"
 |           data-map="willow-creek-senior-living"></script>
 |
 | Everything below is written to one standard: THIS CODE RUNS ON SOMEBODY
 | ELSE'S PAGE. It must be small, it must never block, and it must never throw.
 | A marketing site that breaks after pasting our snippet removes the snippet.
 |
 | So the loader does the least possible:
 |   1. finds where the map should go
 |   2. reserves the right amount of space, so nothing reflows later
 |   3. waits until the map is nearly on screen
 |   4. only then downloads the runtime (Vue and the map itself)
 |
 | Steps 3 and 4 are why this is split from runtime.js. A map three screens
 | down should not cost the host page anything at load; a script tag that
 | pulls 30 KB of framework on every page view is how embeds get blamed for
 | Core Web Vitals.
 */

/*
 | The runtime's URL, derived from our own.
 |
 | Deliberately NOT `new URL('./runtime.js', import.meta.url)`. Vite treats
 | that exact literal form as a static asset reference: it copies the raw,
 | unbundled source file into the output and overwrites the real compiled
 | chunk of the same name. The map then fails to load with a bare-import error
 | in the browser, which is a miserable thing to debug on a client's site.
 |
 | Plain string arithmetic gets the same result with no build-time magic.
 */
const BASE = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
const RUNTIME = `${BASE}runtime.js`;
const TAG = 'community-map';

let runtimePromise = null;

/** Download the runtime once, however many maps are on the page. */
function loadRuntime() {
    runtimePromise ??= import(/* @vite-ignore */ RUNTIME).catch((err) => {
        /* Reset so a later intersection can retry — a transient network
           failure should not permanently break every map on the page. */
        runtimePromise = null;
        console.warn('[community-map] could not load the map runtime', err);
        throw err;
    });
    return runtimePromise;
}

/**
 * Reserve space before the runtime arrives.
 *
 * An unknown element is `display: inline` with no size, so without this the
 * page would settle, then jolt when the map appears. Layout shift is the
 * single most common complaint about third-party embeds.
 */
function reserve(el, height) {
    el.style.display = 'block';
    el.style.width = '100%';
    if (height) {
        el.style.height = /^\d+$/.test(String(height)) ? `${height}px` : String(height);
    } else {
        el.style.minHeight = '480px';
    }
}

/** Load the runtime when the element gets near the viewport. */
function whenNear(el, run) {
    if (typeof IntersectionObserver === 'undefined') {
        run();
        return;
    }
    const io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) {
            io.disconnect();
            run();
        }
    }, { rootMargin: '600px' });
    io.observe(el);
}

/**
 * Turn one configuration into a mounted map.
 * @param {{map: string, api?: string, theme?: string, height?: string, deepLink?: boolean, eager?: boolean, target?: Element}} config
 */
function mount(config) {
    if (!config.map) return;

    /* Reuse an element the host supplied; otherwise make one. */
    const el = config.target?.tagName?.toLowerCase() === TAG
        ? config.target
        : document.createElement(TAG);

    el.setAttribute('map', config.map);
    if (config.api) el.setAttribute('api', config.api);
    if (config.theme) el.setAttribute('theme', config.theme);
    if (config.height) el.setAttribute('height', config.height);
    if (config.deepLink) el.setAttribute('deep-link', 'true');
    /* The element does its own lazy data fetch; by the time the runtime is
       loaded we are already near the viewport, so it should not wait again. */
    el.setAttribute('lazy', 'false');

    reserve(el, config.height);

    if (!el.isConnected) {
        if (config.target && config.target !== el) {
            config.target.appendChild(el);
        } else if (config.script?.parentNode) {
            /* Default placement: exactly where the snippet was pasted. */
            config.script.parentNode.insertBefore(el, config.script.nextSibling);
        } else {
            document.body.appendChild(el);
        }
    }

    const go = () => loadRuntime().catch(() => {
        /* Leave the reserved box empty rather than showing an error on a
           stranger's marketing site. The host page is not ours to deface. */
        el.style.minHeight = '';
        el.style.height = '';
    });

    if (config.eager) go();
    else whenNear(el, go);
}

function readScriptConfig(script) {
    const d = script.dataset;
    return {
        map: d.map || d.communityMap || '',
        api: d.api || '',
        theme: d.theme || '',
        height: d.height || '',
        deepLink: d.deepLink === 'true',
        eager: d.lazy === 'false',
        target: d.target ? document.querySelector(d.target) ?? undefined : undefined,
        script,
    };
}

function boot() {
    try {
        /* Our own script tag. `document.currentScript` is null in modules, so
           match on the src we were loaded from. */
        const here = import.meta.url.split('?')[0];
        for (const script of document.querySelectorAll('script[data-map], script[data-community-map]')) {
            const src = (script.getAttribute('src') || '').split('?')[0];
            if (!src) continue;
            if (new URL(src, document.baseURI).href !== here) continue;
            if (script.dataset.mounted === '1') continue;
            script.dataset.mounted = '1';
            mount(readScriptConfig(script));
        }

        /* Markup-first alternative, for CMSs that strip script attributes or
           where the map belongs somewhere the snippet cannot sit:
             <div data-community-map="willow-creek" data-height="700"></div> */
        for (const host of document.querySelectorAll('[data-community-map]:not(script)')) {
            if (host.dataset.mounted === '1') continue;
            host.dataset.mounted = '1';
            mount({
                map: host.dataset.communityMap,
                api: host.dataset.api || '',
                theme: host.dataset.theme || '',
                height: host.dataset.height || '',
                deepLink: host.dataset.deepLink === 'true',
                eager: host.dataset.lazy === 'false',
                target: host,
            });
        }
    } catch (err) {
        /* Nothing the loader does is worth an exception on a host page. */
        console.warn('[community-map] loader error', err);
    }
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
        boot();
    }

    /* Single-page hosts add containers after load; re-scan on demand rather
       than running a MutationObserver forever on someone else's DOM. */
    window.CommunityMapLoader = { scan: boot, runtimeUrl: RUNTIME };
}

export { boot as scan };
