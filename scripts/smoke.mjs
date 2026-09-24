/*
 | Browser smoke test.
 |
 | Not a unit test suite — it drives the real component in a real browser and
 | asserts the things that would be embarrassing to ship broken: the map draws,
 | filtering changes the result count, a suite opens, the URL carries the
 | selection, the care-level control moves the total, and the whole thing is
 | reachable from the keyboard.
 |
 | Run: npm run build && node scripts/smoke.mjs
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

const server = createServer(async (req, res) => {
    const url = req.url.split('?')[0];
    const file = join(DIST, url === '/' ? 'index.html' : url);
    try {
        const body = await readFile(file);
        res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
        res.end(body);
    } catch {
        res.writeHead(404).end('not found');
    }
});

await new Promise((r) => server.listen(4178, r));
const BASE = 'http://127.0.0.1:4178';

const results = [];
const check = (name, pass, detail = '') => {
    results.push({ name, pass, detail });
    console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

/*
 | Only our own failures count. This sandbox blocks Google Fonts at the egress
 | proxy, which produces a cert error and a stylesheet 404 on every page load —
 | noise from the environment, not from the component.
 */
const ours = (text) => !/fonts\.(googleapis|gstatic)\.com|ERR_CERT_AUTHORITY_INVALID|favicon/.test(text)
    /* Chromium logs "Failed to load resource: ... 404" with no URL attached, so
       it cannot be attributed here. The requestfailed/response hooks below DO
       carry URLs and catch any real failure, so this line is redundant noise. */
    && !/^Failed to load resource:/.test(text);
const consoleErrors = [];
const failedRequests = [];
page.on('console', (m) => { if (m.type() === 'error' && ours(m.text())) consoleErrors.push(m.text()); });
page.on('pageerror', (e) => { if (ours(String(e))) consoleErrors.push(String(e)); });
page.on('requestfailed', (r) => { if (ours(r.url())) failedRequests.push(r.url()); });
page.on('response', (r) => { if (r.status() >= 400 && ours(r.url())) failedRequests.push(`${r.status()} ${r.url()}`); });

try {
    await page.goto(BASE, { waitUntil: 'networkidle' });

    /* ---- it renders ---- */
    /* The demo's ground floor gives two suites over to the lounge and dining
       room, so it carries 10 — don't assert a number that the generator owns. */
    const polygons = await page.locator('.map-canvas .units > g').count();
    check('map draws unit polygons', polygons >= 8, `${polygons} suites on the open level`);

    const heading = await page.locator('h2').first().textContent();
    check('headline renders', /Availability at/.test(heading ?? ''), heading?.trim());

    /* The freshness trust signal — opt-in per community, and the single thing
       on a listing page that says whether what you are reading is current. */
    const confirmed = await page.getByText(/Availability confirmed/).first().textContent().catch(() => null);
    check('shows when availability was last confirmed', Boolean(confirmed), confirmed?.trim());

    /* ---- filtering ---- */
    const before = await page.locator('.cm-results li').count();
    await page.getByRole('button', { name: 'Memory care', exact: true }).click();
    await page.waitForTimeout(250);
    const after = await page.locator('.cm-results li').count();
    check('care filter changes results', after !== before, `${before} -> ${after}`);
    check('care filter writes the URL', page.url().includes('care=mc'), new URL(page.url()).search);

    await page.getByRole('button', { name: 'Clear all' }).click();
    await page.waitForTimeout(200);
    const cleared = await page.locator('.cm-results li').count();
    check('clear restores results', cleared === before, `${cleared}`);

    /* ---- selecting a suite ---- */
    await page.locator('.cm-results li button').first().click();
    await page.waitForTimeout(500);
    const dialog = page.locator('[role="dialog"]').first();
    check('suite drawer opens', await dialog.isVisible());
    check('selection is in the URL', /[?&]unit=/.test(page.url()), new URL(page.url()).search);

    const shareValue = await page.locator('input[readonly]').first().inputValue();
    check('share link points at the suite', /unit=/.test(shareValue), shareValue.slice(0, 80));

    /* ---- care pricing actually recomputes ---- */
    /* Target the monthly total specifically. The last `dd` on the page is the
       one-time community fee, which never moves when the care level changes —
       asserting on it would pass for the wrong reason. */
    const monthlyTotal = page.locator('dt', { hasText: /^Monthly total$/ }).locator('xpath=following-sibling::dd[1]');
    const tierSelect = page.locator('#care-tier');
    if (await tierSelect.count()) {
        const totalBefore = (await monthlyTotal.textContent())?.trim();
        const options = await tierSelect.locator('option').all();
        await tierSelect.selectOption(await options[options.length - 1].getAttribute('value'));
        await page.waitForTimeout(250);
        const totalAfter = (await monthlyTotal.textContent())?.trim();
        check('care level changes the monthly total', Boolean(totalBefore) && totalBefore !== totalAfter, `${totalBefore} -> ${totalAfter}`);
    } else {
        check('care level control present', false, 'no #care-tier rendered');
    }

    /* ---- deep link round trip ---- */
    const deep = page.url();
    await page.goto(deep, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    check('deep link reopens the suite', await page.locator('[role="dialog"]').first().isVisible());

    /* ---- keyboard ---- */
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const firstUnit = page.locator('.map-canvas .units > g[tabindex="0"]').first();
    await firstUnit.focus();
    const focusedBefore = await page.evaluate(() => document.activeElement?.getAttribute('data-unit'));
    /* The first suite may sit on an edge of the plan, so try each direction
       until one has a neighbour. */
    let focusedAfter = focusedBefore;
    for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
        await page.keyboard.press(key);
        await page.waitForTimeout(250);
        focusedAfter = await page.evaluate(() => document.activeElement?.getAttribute('data-unit'));
        if (focusedAfter !== focusedBefore) break;
    }
    check('arrow key moves between suites', Boolean(focusedBefore) && focusedBefore !== focusedAfter, `${focusedBefore} -> ${focusedAfter}`);



    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    check('Enter opens the focused suite', await page.locator('[role="dialog"]').first().isVisible());

    /* ---- lead capture ---- */
    await page.getByRole('button', { name: /Book a tour|Ask|Join the waitlist|See this on a tour/ }).first().click();
    await page.waitForTimeout(400);
    const leadDialog = page.locator('.lead-dialog');
    check('lead form opens', await leadDialog.isVisible());

    await page.locator('#lead-name').fill('Test Family');
    await page.locator('#lead-email').fill('someone@example.com');
    const dateField = page.locator('#lead-date');
    if (await dateField.count()) await dateField.fill('2026-12-01');
    await page.getByRole('button', { name: /Request this tour|Send my question/ }).click();
    await page.waitForTimeout(1600);
    check('lead submits and confirms', await page.getByText(/that's sent/i).isVisible());

    /* Focus must land on the confirmation, not fall back to <body> — otherwise
       Escape stops working and a screen reader announces nothing. */
    const focusAfterSend = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
    check('focus moves to the confirmation', /Back to the map/.test(focusAfterSend), focusAfterSend.slice(0, 40));

    /* ---- compare ---- */
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    check('Escape closes the confirmation', await page.locator('.lead-dialog').count() === 0);
    const compareButtons = page.locator('.cm-results li button[aria-pressed]').filter({ hasText: '+' });
    const n = Math.min(2, await compareButtons.count());
    for (let i = 0; i < n; i++) await compareButtons.nth(i).click();
    await page.waitForTimeout(400);
    check('compare tray appears', await page.locator('.compare-tray').isVisible());
    check('compare table is a real table', await page.locator('.compare-tray table th[scope="row"]').count() > 0);

    /* ---- accessibility basics ---- */
    const noNameButtons = await page.evaluate(() => {
        const bad = [];
        for (const b of document.querySelectorAll('button')) {
            const name = (b.getAttribute('aria-label') || b.textContent || '').trim();
            if (!name) bad.push(b.outerHTML.slice(0, 90));
        }
        return bad;
    });
    check('every button has an accessible name', noNameButtons.length === 0, noNameButtons.slice(0, 3).join(' | '));

    const liveRegions = await page.locator('[aria-live]').count();
    check('a live region exists', liveRegions >= 1, `${liveRegions}`);

    const unlabelledInputs = await page.evaluate(() => {
        const bad = [];
        for (const i of document.querySelectorAll('input:not([type=hidden]), select, textarea')) {
            const id = i.id;
            const labelled = (id && document.querySelector(`label[for="${CSS.escape(id)}"]`))
                || i.closest('label') || i.getAttribute('aria-label') || i.getAttribute('aria-labelledby');
            if (!labelled) bad.push(i.outerHTML.slice(0, 90));
        }
        return bad;
    });
    check('every form control is labelled', unlabelledInputs.length === 0, unlabelledInputs.slice(0, 3).join(' | '));

    /* ---- mouse: wheel zooms, drag pans ---- */
    {
        await page.keyboard.press('Escape');   // nothing in the way of the plan
        await page.waitForTimeout(200);
        const svg = page.locator('.map-canvas');
        const box = await svg.boundingBox();
        const vb = async () => svg.getAttribute('viewBox');
        const v0 = await vb();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.wheel(0, -300);
        await page.waitForTimeout(250);
        const v1 = await vb();
        check('mouse wheel zooms the plan', v0 !== v1, `${v0} -> ${v1}`);
        await page.mouse.move(box.x + 200, box.y + 200);
        await page.mouse.down();
        await page.mouse.move(box.x + 320, box.y + 260, { steps: 6 });
        await page.mouse.up();
        await page.waitForTimeout(250);
        const v2 = await vb();
        check('dragging pans the plan', v1 !== v2, `${v1} -> ${v2}`);
        check('a drag that ends over a suite does not open it', !(await page.locator('[role="dialog"]').first().isVisible().catch(() => false)));
        await page.getByRole('button', { name: 'Fit the whole floor' }).click();
        await page.waitForTimeout(250);
    }

    /* ---- mobile ---- */
    await page.setViewportSize({ width: 390, height: 780 });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const hScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    check('no horizontal scroll on a phone', !hScroll);
    check('filters fold away on a phone', await page.locator('.cm-filter-toggle').isVisible() && !(await page.locator('#cm-filters').isVisible()));
    check('the suite strip scrolls sideways, not the page', await page.evaluate(() => {
        const rail = document.querySelector('.cm-rail');
        return !!rail && rail.scrollWidth > rail.clientWidth && getComputedStyle(rail).overflowX === 'auto';
    }));

    const smallTargets = await page.evaluate(() => {
        const bad = [];
        for (const b of document.querySelectorAll('.cm-header button, .cm-filters-bar button, .cm-results button, .cm-zoom button')) {
            const r = b.getBoundingClientRect();
            if (r.width > 0 && (r.height < 40 || r.width < 32)) bad.push(`${(b.textContent || '').trim().slice(0, 18)} ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
        return bad;
    });
    check('touch targets are large enough', smallTargets.length === 0, smallTargets.slice(0, 4).join(' | '));

    /* ---- the editor loads ---- */
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${BASE}/editor.html`, { waitUntil: 'networkidle' });
    check('plan tracer loads', await page.getByRole('heading', { name: 'Plan tracer' }).isVisible());
    await page.getByRole('button', { name: '+ Rectangle' }).click();
    await page.waitForTimeout(200);
    const traced = await page.locator('textarea[readonly]').inputValue();
    check('tracer exports usable JSON', traced.includes('"units"') && traced.includes('"shape"'));

    check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
    check('no failed requests of ours', failedRequests.length === 0, failedRequests.slice(0, 3).join(' | '));
} catch (err) {
    check('run completed without throwing', false, String(err).slice(0, 300));
} finally {
    await browser.close();
    server.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
