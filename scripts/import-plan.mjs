#!/usr/bin/env node
/*
 | Turn a Floorplanner export into what the platform stores for a layout.
 |
 |   node scripts/import-plan.mjs path/to/export.svg [--out dir] [--dimensions]
 |
 | Writes, next to the input or in --out:
 |
 |   <name>.plan.svg    the clean vector drawing — rooms, walls, doors and
 |                      windows, no furniture. This is what the suite drawer
 |                      shows as image2d. 64 kB instead of 6.9 MB.
 |   <name>.plan.json   { sqft, sqm, rooms[], viewBox, scale } — sqft goes on
 |                      the layout record; rooms are kept for a future room
 |                      breakdown in the drawer.
 |
 | Until the Floorplanner API is reachable, this is the whole integration:
 | export from Floorplanner (the S3 export URL works from anywhere), run this,
 | attach the two files to the layout. When the API opens up, the same parser
 | runs on whatever it returns.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { parseFloorplannerSvg } from '../src/lib/plans/floorplanner.js';

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith('--'));
if (!input) {
    console.error('usage: node scripts/import-plan.mjs <export.svg> [--out dir] [--dimensions]');
    process.exit(2);
}
const outDir = args.includes('--out') ? resolve(args[args.indexOf('--out') + 1]) : dirname(resolve(input));
const keepDimensions = args.includes('--dimensions');

const svg = await readFile(input, 'utf8');
const plan = parseFloorplannerSvg(svg, { keepDimensions });

await mkdir(outDir, { recursive: true });
const stem = basename(input).replace(/\.svg$/i, '');

await writeFile(join(outDir, `${stem}.plan.svg`), plan.cleanSvg);
await writeFile(join(outDir, `${stem}.plan.json`), JSON.stringify({
    sqft: plan.totalSqft,
    sqm: plan.totalSqm,
    rooms: plan.rooms.map((r) => ({ id: r.id, sqft: r.sqft, sqm: r.sqm, points: r.points })),
    viewBox: plan.viewBox,
    scale: plan.scale,
    source: { file: basename(input), ...plan.source },
}, null, 2));

console.log(`${stem}`);
console.log(`  ${plan.rooms.length} rooms, ${plan.totalSqft} sq ft (${plan.totalSqm} m²), ${plan.walls.length} wall segments`);
console.log(`  ${(svg.length / 1e6).toFixed(2)} MB export → ${(plan.cleanSvg.length / 1024).toFixed(0)} kB plan`);
console.log(`  → ${join(outDir, `${stem}.plan.svg`)}`);
console.log(`  → ${join(outDir, `${stem}.plan.json`)}`);
