/*
 | The Floorplanner importer, run against a real export.
 |
 | The fixture is a genuine Floorplanner 2D SVG export of a memory-care deluxe
 | layout with its embedded furniture PNGs emptied out (6.9 MB → 64 kB; the
 | geometry is untouched). The numbers asserted here were cross-checked by
 | hand against the dimension labels drawn on the plan itself.
 |
 | Run: node tests/js/floorplanner.test.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseFloorplannerSvg, pathToPoints, pathToPolygons, UNITS_PER_FOOT } from '../../src/lib/plans/floorplanner.js';

const svg = readFileSync(fileURLToPath(new URL('../fixtures/floorplanner-mc-deluxe.svg', import.meta.url)), 'utf8');

let passed = 0;
const failed = [];
const ok = (name, cond, detail = '') => {
    if (cond) { passed += 1; console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`); }
    else { failed.push(name); console.log(` FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

console.log('Floorplanner import\n');

const plan = parseFloorplannerSvg(svg);

/* ---- coordinate space ---- */
ok('viewBox is read', plan.viewBox.width > 1800 && plan.viewBox.height > 1200,
    `${plan.viewBox.width.toFixed(0)} × ${plan.viewBox.height.toFixed(0)}`);
ok('scale is centimetres (30.48 per foot)', plan.scale.unitsPerFoot === UNITS_PER_FOOT);

/* ---- rooms ---- */
ok('every room in the areas layer is found', plan.rooms.length === 7, `${plan.rooms.length} rooms`);
ok('rooms are real polygons', plan.rooms.every((r) => r.points.length >= 6));
ok('room areas are plausible for an apartment', plan.rooms.every((r) => r.sqft > 10 && r.sqft < 400),
    plan.rooms.map((r) => r.sqft).join(', '));

/* Total floor area, checked against the plan's own dimension labels: the
   outer envelope is 47' 10 3/8" × 28' 7/8" ≈ 1,344 sq ft; take off the
   walls (~115 sq ft at 6") and the two notches and the floor comes to
   ~1,100. The main room alone is 16' 2 3/8" × 24' 8" less a notch ≈ 392. */
ok('total square footage matches the drawing', Math.abs(plan.totalSqft - 1102) < 4, `${plan.totalSqft} sq ft`);
ok('square metres agree with square feet', Math.abs(plan.totalSqm * 10.7639 - plan.totalSqft) < 1, `${plan.totalSqm} m²`);

const biggest = [...plan.rooms].sort((a, b) => b.sqft - a.sqft)[0];
ok('the largest room is the main living space', Math.abs(biggest.sqft - 392) < 4, `${biggest.sqft} sq ft`);

/* ---- walls ---- */
ok('every wall segment is found', plan.walls.length === 40, `${plan.walls.length} walls`);

/* ---- the clean drawing ---- */
ok('clean SVG has no embedded images', !/<image/i.test(plan.cleanSvg));
const roomParts = plan.rooms.reduce((n, r) => n + r.parts.length, 0);
ok('rooms keep their doorway thresholds as parts', roomParts === 11, `${roomParts} parts across ${plan.rooms.length} rooms`);
ok('clean SVG keeps every room part', (plan.cleanSvg.match(/<g id="rooms">.*?<\/g>/s)?.[0].match(/<polygon/g) ?? []).length === roomParts);
ok('clean SVG keeps the walls', (plan.cleanSvg.match(/<g id="walls">.*?<\/g>/s)?.[0].match(/<polygon/g) ?? []).length === 40);
ok('clean SVG keeps doors and windows', /<g id="openings">/.test(plan.cleanSvg));
ok('clean SVG drops dimensions by default', !/<g id="dimensions">/.test(plan.cleanSvg));
ok('clean SVG is a fraction of the export', plan.cleanSvg.length < 80_000,
    `${(plan.cleanSvg.length / 1024).toFixed(0)} kB from ${(plan.source.bytes / 1024).toFixed(0)} kB (fixture) — the original was 6.9 MB`);
ok('the original carried embedded images', plan.source.embeddedImages > 20, `${plan.source.embeddedImages}`);

const withDims = parseFloorplannerSvg(svg, { keepDimensions: true });
ok('dimensions can be kept on request', /<g id="dimensions">/.test(withDims.cleanSvg) && /47' 10 3\/8"/.test(withDims.cleanSvg));

/* ---- path parsing edge cases ---- */
ok('relative commands are handled', JSON.stringify(pathToPoints('m 10 10 l 5 0 l 0 5 z')) === '[10,10,15,10,15,15]');
ok('H and V are handled', JSON.stringify(pathToPoints('M0 0 H10 V10 H0 Z')) === '[0,0,10,0,10,10,0,10]');
ok('a redundant closing vertex is dropped', pathToPoints('M0 0 L10 0 L10 10 L0 0 Z').length === 6);
let threw = false;
try { pathToPoints('M0 0 C1 1 2 2 3 3'); } catch { threw = true; }
ok('curves throw rather than mis-parse', threw);
ok('subpaths become separate polygons', JSON.stringify(pathToPolygons('M0 0 L10 0 L10 10 Z M20 20 L30 20 L30 30 Z')) === '[[0,0,10,0,10,10],[20,20,30,20,30,30]]');

/* ---- not a Floorplanner file ---- */
let rejected = false;
try { parseFloorplannerSvg('<svg viewBox="0 0 10 10"><rect/></svg>'); } catch (e) { rejected = /Floorplanner/.test(e.message); }
ok('an unrelated SVG is rejected with a clear message', rejected);

console.log(`\n${passed + failed.length} assertions, ${passed} passed${failed.length ? `, ${failed.length} FAILED: ${failed.join('; ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
