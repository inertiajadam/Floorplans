/*
 | The 3D suite, built from the real memory care deluxe plan.
 |
 | Run: node tests/js/plan-scene.test.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseFloorplannerSvg } from '../../src/lib/plans/floorplanner.js';
import { buildPlan, EYE_HEIGHT } from '../../src/tour/planScene.js';

const svg = readFileSync(fileURLToPath(new URL('../fixtures/floorplanner-mc-deluxe.svg', import.meta.url)), 'utf8');
const parsed = parseFloorplannerSvg(svg);
const plan = { viewBox: parsed.viewBox, rooms: parsed.rooms, walls: parsed.walls, openings: parsed.openings, wallHeight: 270 };

let passed = 0;
const failed = [];
const ok = (name, cond, detail = '') => {
    if (cond) { passed += 1; console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`); }
    else { failed.push(name); console.log(` FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

console.log('3D suite\n');

const built = buildPlan(plan);
const meshes = [];
built.group.traverse((o) => { if (o.isMesh) meshes.push(o); });
const by = (kind) => meshes.filter((m) => m.userData.kind === kind);

ok('a floor for every room part', by('floor').length === 11, `${by('floor').length}`);
ok('a ceiling for every room part, hidden until you step inside', by('ceiling').length === 11 && by('ceiling').every((m) => !m.visible));
ok('every wall is built', by('wall').length >= 40, `${by('wall').length} wall pieces (40 walls, plus the bits over doors and around windows)`);
ok('walls are cut for the openings', by('wall').length > 40);
ok('every door has a leaf and two jambs', meshes.filter((m) => m.geometry.type === 'BoxGeometry' && m.material.color?.getHexString() === 'b8946a').length === 7);
ok('every window has glass', meshes.filter((m) => m.material.transparent).length === 3);
ok('the model sits on a slab', by('base').length === 1);

/* size: the plan is 47' 10" × 28' 1" */
const size = built.bounds.getSize(new (await import('three')).Vector3());
/* the slab runs 0.25 m past the walls on every side */
ok('the model is the size of the suite', Math.abs(size.x - 0.5 - 14.6) < 0.4 && Math.abs(size.z - 0.5 - 8.6) < 0.4, `${(size.x - 0.5).toFixed(2)} m × ${(size.z - 0.5).toFixed(2)} m`);
ok('walls are ceiling height', Math.abs(size.y - 2.7 - 0.1) < 0.02, `${size.y.toFixed(2)} m including the slab`);

/* rooms and doors */
ok('every room has a centre to stand in', built.rooms.every((r) => Number.isFinite(r.center.x) && Number.isFinite(r.center.z)));
ok('eye height suits a seated or standing visitor', EYE_HEIGHT > 1.4 && EYE_HEIGHT < 1.7);
ok('doors and cased openings are walkable', built.doors.length === 8, `${built.doors.length}`);
const interior = built.doors.filter((d) => d.rooms.length === 2);
ok('interior doors join two rooms', interior.length >= 5, `${interior.length} of ${built.doors.length}`);
ok('the front door joins one room to outside', built.doors.some((d) => d.rooms.length === 1));
ok('every room is reachable through a door', built.rooms.every((r) => r.doors.length > 0),
    built.rooms.map((r) => `${r.id}:${r.doors.length}`).join(' '));

built.dispose();
ok('dispose runs clean', true);

console.log(`\n${passed + failed.length} assertions, ${passed} passed${failed.length ? `, ${failed.length} FAILED: ${failed.join('; ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
