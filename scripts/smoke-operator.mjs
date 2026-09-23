/*
 | Browser smoke test for the operator panels.
 |
 | Drives the real panels in a real browser against the demo harness. The
 | checks are the ones that would be embarrassing to ship broken, and several
 | encode rules that are easy to regress silently:
 |
 |   - changing a status saves, and the freshness stamp moves with it
 |   - "everything is still right" clears the whole stale count
 |   - a coming-available suite will NOT save without a date, because it would
 |     publish "available on no particular day" to families
 |   - switching away from a status clears that status's satellite data
 |   - the pricing preview shows what families will actually read
 |
 | Run: npm run build && node scripts/smoke-operator.mjs
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

await new Promise((r) => server.listen(4180, r));
const BASE = 'http://127.0.0.1:4180';

const results = [];
const check = (name, pass, detail = '') => {
    results.push({ name, pass, detail });
    console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });

/* Google Fonts is blocked by this sandbox's egress proxy; that noise is not ours. */
const ours = (t) => !/fonts\.(googleapis|gstatic)\.com|ERR_CERT_AUTHORITY_INVALID|favicon/.test(t)
    && !/^Failed to load resource:/.test(t);
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error' && ours(m.text())) consoleErrors.push(m.text()); });
page.on('pageerror', (e) => { if (ours(String(e))) consoleErrors.push(String(e)); });

const firstRow = () => page.locator('#availability ul li').first();

try {
    await page.goto(`${BASE}/operator.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);

    /* ---- it renders, and leads with the work ---- */
    check('panel renders', await page.getByRole('heading', { name: 'Availability' }).isVisible());

    const bannerText = (await page.locator('#availability').getByText(/have not been checked|has not been checked|Availability confirmed/).first().textContent())?.trim();
    check('freshness banner states the problem', /not been checked/.test(bannerText ?? ''), bannerText?.slice(0, 70));

    const attentionCount = Number((await page.getByRole('button', { name: /Needs attention/ }).textContent())?.match(/\d+/)?.[0] ?? 0);
    check('needs-attention scope is populated', attentionCount > 0, `${attentionCount} suites`);

    /* Default scope must be the work, not the whole roster — that is the point. */
    const shown = await page.locator('#availability ul li').count();
    check('opens on the work, not the full roster', shown === attentionCount, `showing ${shown}`);

    /* ---- changing a status saves ----
       Done in the "every suite" scope: in "needs attention" the row leaves the
       filter as soon as it is fixed, which would make the assertion ambiguous. */
    await page.getByRole('button', { name: /Every suite/ }).click();
    await page.waitForTimeout(300);
    const postsBefore = await page.locator('section:has-text("What was posted") li').count();
    await firstRow().locator('select').first().selectOption('occupied');
    await page.waitForTimeout(700);
    const posted = (await page.locator('section:has-text("What was posted") li').first().textContent()) ?? '';
    check('status change posts an update',
        (await page.locator('section:has-text("What was posted") li').count()) > postsBefore
        && /unit\.update/.test(posted) && /"status":"occupied"/.test(posted.replace(/\s/g, '')),
        posted.slice(0, 80));

    /* ---- the guard that matters: no date, no publish ---- */
    await page.getByRole('button', { name: /Every suite/ }).click();
    await page.waitForTimeout(300);
    const target = page.locator('#availability ul li').first();
    await target.locator('select').first().selectOption('coming_available');
    await page.waitForTimeout(500);
    const datePrompt = await target.getByText(/Pick a date/).isVisible().catch(() => false);
    check('coming-available demands a date before saving', datePrompt);

    const logBefore = await page.locator('section:has-text("What was posted") li').count();
    await target.locator('input[type="date"]').fill('2026-12-24');
    await page.waitForTimeout(600);
    const logAfter = await page.locator('section:has-text("What was posted") li').count();
    check('supplying the date then saves', logAfter > logBefore, `${logBefore} -> ${logAfter} posts`);

    /* ---- satellite data belongs to its status ---- */
    await target.locator('select').first().selectOption('waitlist');
    await page.waitForTimeout(500);
    const hasDate = await target.locator('input[type="date"]').count();
    check('switching status drops the old status field', hasDate === 0);

    const lastPost = (await page.locator('section:has-text("What was posted") li').first().textContent()) ?? '';
    check('the cleared date is sent as null', /"available_on":null/.test(lastPost.replace(/\s/g, '')), lastPost.slice(0, 90));

    /* ---- bulk ---- */
    await page.locator('#availability ul li input[type="checkbox"]').nth(0).check();
    await page.locator('#availability ul li input[type="checkbox"]').nth(1).check();
    await page.waitForTimeout(200);
    check('bulk bar appears on selection', await page.locator('#bulk-status').isVisible());
    await page.locator('#bulk-status').selectOption('occupied');
    await page.waitForTimeout(700);
    check('bulk status reports back', await page.getByText(/2 suites set to occupied/i).isVisible());

    /* ---- the most important button ---- */
    await page.getByRole('button', { name: /Needs attention/ }).click();
    await page.waitForTimeout(300);
    const staleBefore = Number((await page.getByRole('button', { name: /Needs attention/ }).textContent())?.match(/\d+/)?.[0] ?? 0);
    await page.getByRole('button', { name: /Everything here is still right/ }).click();
    await page.waitForTimeout(900);
    const staleAfter = Number((await page.getByRole('button', { name: /Needs attention/ }).textContent())?.match(/\d+/)?.[0] ?? 0);
    check('confirm-all clears the stale count', staleAfter < staleBefore, `${staleBefore} -> ${staleAfter}`);
    check('confirm-all confirms in words', await page.getByText(/marked as confirmed today/i).isVisible());

    /* ---- publish gate ---- */
    await page.getByRole('button', { name: /Hide the map/ }).click();
    await page.waitForTimeout(500);
    check('publish toggles', await page.getByRole('button', { name: /Publish the map/ }).isVisible());

    /* ---- pricing preview ---- */
    const preview = (await page.locator('#map-pricing').getByText(/Most residents here pay about/).first().textContent())?.trim();
    check('pricing preview shows the real family-facing line', /Most residents here pay about \$/.test(preview ?? ''), preview?.slice(0, 80));

    /* "Typical" is the MEDIAN tier, so editing an outlier legitimately leaves
       the preview alone. To prove it is live, move a tier past the median —
       raising the cheapest care level reorders the list and shifts it. */
    const beforeTier = preview;
    await page.locator('#map-pricing input[type="number"]').nth(1).fill('5000');
    await page.waitForTimeout(400);
    const afterTier = (await page.locator('#map-pricing').getByText(/Most residents here pay about/).first().textContent())?.trim();
    check('preview reacts to a tier change', beforeTier !== afterTier, `${afterTier?.slice(0, 70)}`);

    /* ---- sync mode surfaces the right affordances ---- */
    await page.getByText('Inventory syncs from a PMS').click();
    await page.waitForTimeout(500);
    check('sync strip appears', await page.getByText(/Inventory syncs from PointClickCare/).isVisible());
    check('per-field padlocks appear', await page.locator('#availability button[aria-pressed]').first().isVisible());

    /* ---- structure ---- */
    check('structure panel lists the campus', await page.getByRole('heading', { name: /Buildings/ }).isVisible());
    const buildingsBefore = await page.locator('#map-structure > ul > li').count();
    await page.getByRole('button', { name: 'Add a building' }).click();
    await page.locator('#map-structure input').first().fill('Test Wing');
    await page.getByRole('button', { name: 'Add it' }).click();
    await page.waitForTimeout(600);
    const buildingsAfter = await page.locator('#map-structure > ul > li').count();
    check('adding a building works', buildingsAfter === buildingsBefore + 1, `${buildingsBefore} -> ${buildingsAfter}`);

    /* Scoped to the campus list — an unscoped getByText also matches the flash
       message, which is a different element saying the same words. */
    const newBuilding = page.locator('#map-structure > ul > li').last();
    check('a new building gets a floor to start',
        (await newBuilding.getByText('Test Wing').count()) > 0
        && await newBuilding.getByText('Ground floor').isVisible());

    /* ---- accessibility ---- */
    const noName = await page.evaluate(() => {
        const bad = [];
        for (const b of document.querySelectorAll('button')) {
            if (!(b.getAttribute('aria-label') || b.textContent || '').trim()) bad.push(b.outerHTML.slice(0, 80));
        }
        return bad;
    });
    check('every button has an accessible name', noName.length === 0, noName.slice(0, 2).join(' | '));

    const unlabelled = await page.evaluate(() => {
        const bad = [];
        for (const i of document.querySelectorAll('input:not([type=hidden]), select, textarea')) {
            const labelled = (i.id && document.querySelector(`label[for="${CSS.escape(i.id)}"]`))
                || i.closest('label') || i.getAttribute('aria-label') || i.getAttribute('aria-labelledby');
            if (!labelled) bad.push(i.outerHTML.slice(0, 90));
        }
        return bad;
    });
    check('every form control is labelled', unlabelled.length === 0, unlabelled.slice(0, 2).join(' | '));

    /* The save indicator lives on each row, so assert against a row rather than
       the panel — by this point "needs attention" is empty and carries none. */
    await page.getByRole('button', { name: /Every suite/ }).click();
    await page.waitForTimeout(300);
    check('save state is announced on each row',
        await firstRow().locator('[aria-live="polite"]').count() > 0);

    /* ---- phone ---- */
    await page.setViewportSize({ width: 390, height: 780 });
    await page.goto(`${BASE}/operator.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const hScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    check('no horizontal scroll on a phone', !hScroll);

    const smallTargets = await page.evaluate(() => {
        const bad = [];
        for (const el of document.querySelectorAll('#availability select, #availability button, #availability input[type=date]')) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height < 40) bad.push(`${(el.textContent || el.tagName).trim().slice(0, 16)} ${Math.round(r.height)}px`);
        }
        return bad;
    });
    check('controls are thumb-sized on a phone', smallTargets.length === 0, smallTargets.slice(0, 3).join(' | '));

    check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));
} catch (err) {
    check('run completed without throwing', false, String(err).slice(0, 300));
} finally {
    await browser.close();
    server.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
