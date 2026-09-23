/*
 | Embed isolation test.
 |
 | Loads the real built snippet into a deliberately hostile host page
 | (demo/client-site.html) and asserts BOTH directions of isolation:
 |
 |   their CSS must not reach in   the host sets `* { box-sizing: content-box
 |                                 !important }`, restyles every button, and
 |                                 stretches every svg. None of it may touch
 |                                 the map.
 |
 |   our CSS must not reach out    we ship Tailwind's preflight, which resets
 |                                 margins, heading sizes and list styles
 |                                 globally. If any of it escaped, the client's
 |                                 own page would silently change — which is
 |                                 how an embed gets removed from a site.
 |
 | The second direction is the one people forget, and it is the one that loses
 | you the customer.
 |
 | Run: npx vite build -c vite.embed.config.js && node scripts/smoke-embed.mjs
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const community = JSON.parse(await readFile(join(ROOT, 'demo/data/commons-on-meridian.json'), 'utf8'));

/* An operator-set theme, delivered with the payload. Deliberately nothing like
   the host page's pink so a leak in either direction is obvious. */
const THEME = { brand: '#1d4ed8', brandDark: '#1e3a8a', brandLight: '#e0e7ff', radiusCard: '6px' };

let leadsReceived = [];

const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const path = url.pathname;

    const send = (code, type, body) => {
        res.writeHead(code, {
            'Content-Type': type,
            /* The real API is cross-origin from a client's website. */
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'content-type',
        });
        res.end(body);
    };

    if (req.method === 'OPTIONS') return send(204, 'text/plain', '');

    if (path === `/v1/maps/${community.slug}/leads` && req.method === 'POST') {
        let body = '';
        for await (const chunk of req) body += chunk;
        leadsReceived.push(JSON.parse(body || '{}'));
        return send(200, 'application/json', JSON.stringify({ ok: true }));
    }

    if (path === `/v1/maps/${community.slug}`) {
        return send(200, 'application/json', JSON.stringify({ ...community, theme: THEME }));
    }

    if (path === '/v1/maps/does-not-exist') {
        return send(404, 'application/json', JSON.stringify({ message: 'No such map' }));
    }

    /* Static: the built embed under /v1/, everything else from demo/. */
    const file = path.startsWith('/v1/')
        ? join(ROOT, 'dist-embed', path.slice(4))
        : join(ROOT, 'demo', path === '/' ? 'client-site.html' : path);

    try {
        const body = await readFile(file);
        send(200, TYPES[extname(file)] ?? 'application/octet-stream', body);
    } catch {
        send(404, 'text/plain', 'not found');
    }
});

await new Promise((r) => server.listen(4182, r));
const BASE = 'http://127.0.0.1:4182';

const results = [];
const check = (name, pass, detail = '') => {
    results.push({ name, pass });
    console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });

const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

/* Count requests so we can prove the runtime is fetched once for two maps. */
const requested = [];
page.on('request', (r) => requested.push(r.url()));

try {
    await page.goto(`${BASE}/client-site.html`, { waitUntil: 'networkidle' });
    await page.waitForSelector('community-map', { timeout: 10000 });
    await page.waitForFunction(
        () => document.querySelector('community-map')?.shadowRoot?.querySelector('.map-canvas'),
        null,
        { timeout: 15000 },
    );

    /* ---------------------------------------------------- it works at all */

    const inside = await page.evaluate(() => {
        const sr = document.querySelector('community-map').shadowRoot;
        return {
            hasShadow: Boolean(sr),
            units: sr.querySelectorAll('.map-canvas .units > g').length,
            heading: sr.querySelector('h2')?.textContent?.trim() ?? null,
        };
    });
    check('the element attaches a shadow root', inside.hasShadow);
    check('the map renders inside it', inside.units > 5, `${inside.units} suites drawn`);
    check('with real content', /Availability at/.test(inside.heading ?? ''), inside.heading);

    /* ------------------------------- their CSS must not reach into the map */

    const mapStyles = await page.evaluate(() => {
        const sr = document.querySelector('community-map').shadowRoot;
        const btn = [...sr.querySelectorAll('button')].find((b) => b.offsetHeight > 0);
        const svg = sr.querySelector('.map-canvas');
        const card = sr.querySelector('.cm-header');
        const cs = (el) => (el ? getComputedStyle(el) : null);
        const b = cs(btn);
        const s = cs(svg);
        const c = cs(card);
        return {
            buttonBg: b?.backgroundColor,
            buttonFontSize: b?.fontSize,
            buttonRadius: b?.borderRadius,
            buttonTextTransform: b?.textTransform,
            svgTransform: s?.transform,
            cardBoxSizing: c?.boxSizing,
            rootFontSize: cs(sr.querySelector('.community-map'))?.fontSize,
        };
    });

    check('host button styling does not leak in (colour)',
        mapStyles.buttonBg !== 'rgb(255, 105, 180)', mapStyles.buttonBg);
    check('host button styling does not leak in (size)',
        mapStyles.buttonFontSize !== '28px', mapStyles.buttonFontSize);
    check('host !important text-transform does not apply',
        mapStyles.buttonTextTransform !== 'uppercase', mapStyles.buttonTextTransform);
    check('host `* { box-sizing: content-box !important }` does not apply',
        mapStyles.cardBoxSizing === 'border-box', mapStyles.cardBoxSizing);
    check('host `svg { transform: rotate() }` does not apply',
        mapStyles.svgTransform === 'none' || mapStyles.svgTransform === 'matrix(1, 0, 0, 1, 0, 0)', mapStyles.svgTransform);

    /* The host sets :root custom properties with OUR names. Shadow DOM does not
       stop custom properties inheriting, so :host must redeclare them — this is
       the check that catches that regression. */
    const tokens = await page.evaluate(() => {
        const host = document.querySelector('community-map');
        const sr = host.shadowRoot;
        const probe = sr.querySelector('.community-map');
        const cs = getComputedStyle(probe);
        return {
            brand: cs.getPropertyValue('--color-brand').trim(),
            ink: cs.getPropertyValue('--color-ink').trim(),
            hostBrand: getComputedStyle(document.documentElement).getPropertyValue('--color-brand').trim(),
        };
    });
    check("host page's colliding --color-brand does not win",
        tokens.brand !== tokens.hostBrand && tokens.brand !== '#ff0066', `map=${tokens.brand} host=${tokens.hostBrand}`);

    /* --------------------------------------------------- per-map theming */

    check('the operator theme is applied', tokens.brand.toLowerCase() === '#1d4ed8', tokens.brand);

    /* Scan for either themed colour actually painted somewhere, rather than
       guessing which control is on screen at this moment — which controls are
       visible depends on layout and on whether a suite is open. */
    const painted = await page.evaluate(() => {
        const sr = document.querySelector('community-map').shadowRoot;
        const wanted = new Set(['rgb(29, 78, 216)', 'rgb(30, 58, 138)', 'rgb(224, 231, 255)']);
        const hits = [];
        for (const el of sr.querySelectorAll('*')) {
            const bg = getComputedStyle(el).backgroundColor;
            if (wanted.has(bg)) hits.push(`${el.tagName.toLowerCase()}:${bg}`);
            if (hits.length >= 3) break;
        }
        return hits;
    });
    check('the theme reaches painted UI, not just the variable', painted.length > 0, painted.join(', '));

    /* ------------------------------ our CSS must not reach out to the host */

    const host = await page.evaluate(() => {
        const cs = (sel) => {
            const el = document.querySelector(sel);
            return el ? getComputedStyle(el) : null;
        };
        const h2 = cs('#host-heading');
        const li = cs('#host-list');
        const btn = cs('#host-button');
        const p = cs('#host-paragraph');
        return {
            headingSize: h2?.fontSize,
            headingColor: h2?.color,
            listStyle: li?.listStyleType,
            buttonBg: btn?.backgroundColor,
            paragraphSize: p?.fontSize,
            bodyFont: getComputedStyle(document.body).fontFamily,
        };
    });

    /* Tailwind preflight would set headings to inherit their size, strip list
       markers and reset button backgrounds. All of these prove it stayed in. */
    check('host heading keeps its own size', host.headingSize === '64px', host.headingSize);
    check('host heading keeps its own colour', host.headingColor === 'rgb(255, 0, 102)', host.headingColor);
    check('host list markers survive our preflight', host.listStyle === 'square', host.listStyle);
    check('host button keeps its own styling', host.buttonBg === 'rgb(255, 105, 180)', host.buttonBg);
    check('host paragraph keeps its own size', host.paragraphSize === '26px', host.paragraphSize);
    check('host font-family is untouched', /Comic Sans/.test(host.bodyFont), host.bodyFont);

    /* ------------------------------------------------------- page health */

    /*
     | Measure the embed's CONTRIBUTION, not the absolute page width.
     |
     | This host page overflows on its own — `box-sizing: content-box
     | !important` plus margins, padding and borders on every div does that at
     | any narrow width. Asserting "no overflow" would fail for reasons that
     | have nothing to do with us, and the useful question is whether adding
     | the map makes the client's page any wider than it already was.
     */
    const overflowDelta = await page.evaluate(() => {
        const doc = document.documentElement;
        const el = document.querySelector('community-map');
        const withEmbed = doc.scrollWidth;
        /* Hide rather than detach: removing the element fires
           disconnectedCallback, which unmounts and then re-fetches the map,
           invalidating every assertion after this one. */
        const previous = el.style.display;
        el.style.display = 'none';
        const withoutEmbed = doc.scrollWidth;
        el.style.display = previous;
        return { withEmbed, withoutEmbed, client: doc.clientWidth };
    });
    check('the embed adds no horizontal overflow',
        overflowDelta.withEmbed <= overflowDelta.withoutEmbed,
        `${overflowDelta.withoutEmbed}px without → ${overflowDelta.withEmbed}px with (page itself already overflows ${overflowDelta.client}px)`);

    const runtimeRequests = requested.filter((u) => u.includes('/v1/runtime.js')).length;
    check('the runtime is fetched once', runtimeRequests === 1, `${runtimeRequests} request(s)`);

    /* --------------------------------------------------------- the lead */

    const clicked = await page.evaluate(() => {
        const sr = document.querySelector('community-map').shadowRoot;
        const target = sr.querySelector('.cm-results li button')
            ?? sr.querySelector('.map-canvas .units > g');
        if (!target) return false;
        target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return true;
    });
    check('a suite is clickable', clicked);
    await page.waitForTimeout(800);

    const drawerOpen = await page.evaluate(() =>
        Boolean(document.querySelector('community-map').shadowRoot.querySelector('[role="dialog"]')));
    check('a suite opens inside the embed', drawerOpen);

    await page.evaluate(() => {
        const sr = document.querySelector('community-map').shadowRoot;
        const cta = [...sr.querySelectorAll('footer button')].find((b) => /tour|Ask|waitlist|short stay|next in line/i.test(b.textContent));
        cta?.click();
    });
    await page.waitForTimeout(600);

    const formOpen = await page.evaluate(() =>
        Boolean(document.querySelector('community-map').shadowRoot.querySelector('.lead-dialog')));
    check('the enquiry form opens inside the embed', formOpen);

    if (formOpen) {
        await page.evaluate(() => {
            const sr = document.querySelector('community-map').shadowRoot;
            const set = (sel, v) => {
                const el = sr.querySelector(sel);
                if (!el) return;
                el.value = v;
                el.dispatchEvent(new Event('input', { bubbles: true }));
            };
            set('#lead-name', 'Test Family');
            set('#lead-email', 'someone@example.com');
            const date = sr.querySelector('#lead-date');
            if (date) { date.value = '2026-12-01'; date.dispatchEvent(new Event('input', { bubbles: true })); }
        });
        await page.waitForTimeout(200);
        await page.evaluate(() => {
            const sr = document.querySelector('community-map').shadowRoot;
            sr.querySelector('.lead-dialog form')?.requestSubmit();
        });
        await page.waitForTimeout(1200);

        check('the lead reaches the platform API', leadsReceived.length === 1, `${leadsReceived.length} received`);
        check('and names the suite', Boolean(leadsReceived[0]?.context?.unitNumber), leadsReceived[0]?.context?.unitNumber);
    }

    /* -------------------------------------------------- DOM events out */

    const events = await page.evaluate(async () => {
        const seen = [];
        for (const t of ['map:loaded', 'map:lead', 'map:error']) {
            window.addEventListener(t, (e) => seen.push(t), { once: true });
        }
        /* Force a fresh element so map:loaded fires again. */
        const el = document.createElement('community-map');
        el.setAttribute('map', 'the-commons-on-meridian');
        el.setAttribute('api', '/');
        el.setAttribute('lazy', 'false');
        document.body.appendChild(el);
        await new Promise((r) => setTimeout(r, 2500));
        return seen;
    });
    check('a host page can listen for map events', events.includes('map:loaded'), events.join(', '));

    /* A second element must not re-register the custom element or re-fetch. */
    const runtimeAfterSecond = requested.filter((u) => u.includes('/v1/runtime.js')).length;
    check('a second map on the page reuses the runtime', runtimeAfterSecond === 1, `${runtimeAfterSecond} request(s)`);

    /* ------------------------------------------------- failure is quiet */

    const failure = await page.evaluate(async () => {
        const el = document.createElement('community-map');
        el.setAttribute('map', 'does-not-exist');
        el.setAttribute('api', '/');
        el.setAttribute('lazy', 'false');
        document.body.appendChild(el);
        await new Promise((r) => setTimeout(r, 1800));
        const sr = el.shadowRoot;
        return {
            text: sr?.textContent?.trim() ?? '',
            hasStack: /Error|undefined|null|TypeError/.test(sr?.textContent ?? ''),
        };
    });
    check('a missing map fails with a human message', /not available/i.test(failure.text), failure.text.slice(0, 60));
    check('and never shows an error object', !failure.hasStack);

    const realErrors = consoleErrors.filter((e) => !/404|Failed to load resource/.test(e));
    check('no console errors on the host page', realErrors.length === 0, realErrors.slice(0, 2).join(' | '));

    /* ------------------------------------------------------------ phone */

    await page.setViewportSize({ width: 390, height: 780 });
    await page.goto(`${BASE}/client-site.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(
        () => document.querySelector('community-map')?.shadowRoot?.querySelector('.map-canvas'),
        null,
        { timeout: 15000 },
    );
    const mobileDelta = await page.evaluate(() => {
        const doc = document.documentElement;
        const el = document.querySelector('community-map');
        const withEmbed = doc.scrollWidth;
        const previous = el.style.display;
        el.style.display = 'none';
        const withoutEmbed = doc.scrollWidth;
        el.style.display = previous;
        return { withEmbed, withoutEmbed };
    });
    check('the embed adds no horizontal overflow on a phone',
        mobileDelta.withEmbed <= mobileDelta.withoutEmbed,
        `${mobileDelta.withoutEmbed}px → ${mobileDelta.withEmbed}px`);
} catch (err) {
    check('run completed without throwing', false, String(err).slice(0, 300));
} finally {
    await browser.close();
    server.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
