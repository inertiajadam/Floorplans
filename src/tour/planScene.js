/*
 | A 3D suite from a 2D plan.
 |
 | The Floorplanner importer gives us rooms, walls and openings in
 | centimetres. This turns them into a model a family can orbit and step
 | inside: floors per room, walls extruded to ceiling height with real
 | holes cut where the doors and windows are, a door leaf hung in every
 | doorway, glass in every window. No furniture, no finishes — those come
 | from photos. What it does show is the truth of the space: how the
 | rooms join, where the light comes in, how far it is from the bed to the
 | bathroom door.
 |
 | Coordinates: the plan's x runs right and y runs down the page. Here x
 | stays x, y becomes z (toward the viewer), and up is up. One plan unit
 | is a centimetre; the model is in metres.
 |
 | Pure geometry — no renderer, no DOM — so it runs in Node for the tests.
 */

import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { area, centroid, contains } from '../lib/geometry.js';

export const EYE_HEIGHT = 1.55;      // a seated-to-standing compromise; most visitors are older
const DOOR_HEIGHT = 2.1;
const WINDOW_SILL = 0.9;
const WINDOW_HEAD = 2.1;
const CUT_MARGIN = 0.03;             // metres beyond the wall face so the cut goes clean through

const toM = (cm) => cm / 100;

/**
 * @param {object} plan  a layout's plan3d: { rooms:[{id,sqft,parts:number[][]}], walls:number[][], openings:[…], wallHeight? }
 * @param {object} [options]
 * @param {Record<string,string>} [options.colors]
 * @returns {{
 *   group: THREE.Group,
 *   rooms: Array<{ id:string, index:number, sqft:number, center:THREE.Vector3, floors:THREE.Mesh[], ceilings:THREE.Mesh[], doors:number[] }>,
 *   doors: Array<{ index:number, kind:string, position:THREE.Vector3, normal:THREE.Vector3, rooms:number[] }>,
 *   bounds: THREE.Box3,
 *   dispose: () => void,
 * }}
 */
export function buildPlan(plan, { colors = {} } = {}) {
    const wallHeight = toM(plan.wallHeight ?? 270);
    const c = {
        floor: '#ebe6dc',
        floorLit: '#f7f3ea',
        wall: '#f3f0ea',
        wallTop: '#3a4750',
        base: '#2b3a44',
        door: '#b8946a',
        glass: '#cfe3ee',
        frame: '#e6e1d8',
        ...colors,
    };

    const group = new THREE.Group();
    const disposables = [];
    const track = (o) => { disposables.push(o); return o; };

    const floorMat = track(new THREE.MeshStandardMaterial({ color: c.floor, roughness: 0.95 }));
    const ceilingMat = track(new THREE.MeshStandardMaterial({ color: '#faf8f4', roughness: 1, side: THREE.DoubleSide }));
    const wallSide = track(new THREE.MeshStandardMaterial({ color: c.wall, roughness: 0.9 }));
    const wallTop = track(new THREE.MeshStandardMaterial({ color: c.wallTop, roughness: 0.7 }));
    const doorMat = track(new THREE.MeshStandardMaterial({ color: c.door, roughness: 0.6 }));
    const glassMat = track(new THREE.MeshStandardMaterial({ color: c.glass, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.45, side: THREE.DoubleSide }));
    const frameMat = track(new THREE.MeshStandardMaterial({ color: c.frame, roughness: 0.8 }));
    const baseMat = track(new THREE.MeshStandardMaterial({ color: c.base, roughness: 0.9 }));

    /* ---- rooms: a floor and a ceiling per part ---- */
    const rooms = plan.rooms.map((r, index) => {
        const main = r.parts.reduce((best, p) => (area(p) > area(best) ? p : best), r.parts[0]);
        const cen = centroid(main);
        const floors = r.parts.map((pts) => {
            const geo = track(new THREE.ShapeGeometry(shapeFrom(pts)));
            const mesh = new THREE.Mesh(geo, floorMat.clone());
            track(mesh.material);
            mesh.rotation.x = -Math.PI / 2;
            mesh.position.y = 0.004;
            mesh.userData = { kind: 'floor', room: index };
            group.add(mesh);
            return mesh;
        });
        const ceilings = r.parts.map((pts) => {
            const geo = track(new THREE.ShapeGeometry(shapeFrom(pts)));
            const mesh = new THREE.Mesh(geo, ceilingMat);
            mesh.rotation.x = -Math.PI / 2;
            mesh.position.y = wallHeight;
            mesh.visible = false;           // dollhouse view looks in from above
            mesh.userData = { kind: 'ceiling', room: index };
            group.add(mesh);
            return mesh;
        });
        return {
            id: r.id,
            index,
            sqft: r.sqft,
            center: new THREE.Vector3(toM(cen.x), 0, toM(cen.y)),
            polygon: main,
            floors,
            ceilings,
            doors: [],
        };
    });

    /* ---- openings: where the walls are cut ---- */
    const cuts = plan.openings.map((o) => openingRect(o, CUT_MARGIN));

    /* ---- walls: the polygon minus every opening, then the bits above and below ---- */
    for (const wall of plan.walls) {
        const ring = ringFrom(wall);
        const solid = safeClip(() => polygonClipping.difference([ring], ...cuts.map((r) => [r])), [[ring]]);
        for (const poly of solid) addExtruded(poly, 0, wallHeight);

        plan.openings.forEach((o, i) => {
            const hit = safeClip(() => polygonClipping.intersection([ring], [cuts[i]]), []);
            if (!hit.length) return;
            for (const poly of hit) {
                if (o.kind === 'window') {
                    addExtruded(poly, 0, WINDOW_SILL);
                    addExtruded(poly, WINDOW_HEAD, wallHeight);
                } else {
                    addExtruded(poly, DOOR_HEIGHT, wallHeight);
                }
            }
        });
    }

    function addExtruded(poly, from, to) {
        const shape = shapeFromRings(poly);
        if (!shape) return;
        const geo = track(new THREE.ExtrudeGeometry(shape, { depth: to - from, bevelEnabled: false }));
        const mesh = new THREE.Mesh(geo, [wallTop, wallSide]);   // caps, then sides
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = from;
        mesh.userData = { kind: 'wall' };
        group.add(mesh);
    }

    /* ---- what hangs in the openings ---- */
    const doors = [];
    plan.openings.forEach((o, index) => {
        const theta = THREE.MathUtils.degToRad(o.angle);
        const pos = new THREE.Vector3(toM(o.x), 0, toM(o.y));
        const along = new THREE.Vector3(Math.cos(theta), 0, Math.sin(theta));      // the wall's direction
        const normal = new THREE.Vector3(-Math.sin(theta), 0, Math.cos(theta));    // across the wall
        const w = toM(o.width);
        const d = toM(o.depth);

        const holder = new THREE.Object3D();
        holder.position.copy(pos);
        holder.rotation.y = -theta;      // local +x becomes `along`
        group.add(holder);

        if (o.kind === 'door') {
            /* Jambs, then the leaf on a hinge, swung open so the doorway reads as a doorway. */
            for (const side of [-1, 1]) {
                const jamb = new THREE.Mesh(track(new THREE.BoxGeometry(0.04, DOOR_HEIGHT, d + 0.02)), frameMat);
                jamb.position.set(side * (w / 2 + 0.02), DOOR_HEIGHT / 2, 0);
                holder.add(jamb);
            }
            const hingeSide = (o.hinge === 'end' ? 1 : -1) * (o.flip ? -1 : 1);
            const hinge = new THREE.Object3D();
            hinge.position.set(hingeSide * (w / 2), 0, 0);
            const leaf = new THREE.Mesh(track(new THREE.BoxGeometry(w, DOOR_HEIGHT - 0.02, 0.04)), doorMat);
            leaf.position.set(-hingeSide * (w / 2), (DOOR_HEIGHT - 0.02) / 2, 0);
            hinge.add(leaf);
            /* 75° open, into the side the arc was drawn on. */
            hinge.rotation.y = hingeSide * (o.flip ? 1 : -1) * THREE.MathUtils.degToRad(75);
            holder.add(hinge);
        } else if (o.kind === 'window') {
            const pane = new THREE.Mesh(track(new THREE.BoxGeometry(w, WINDOW_HEAD - WINDOW_SILL, 0.02)), glassMat);
            pane.position.set(0, (WINDOW_HEAD + WINDOW_SILL) / 2, 0);
            holder.add(pane);
            const sill = new THREE.Mesh(track(new THREE.BoxGeometry(w + 0.06, 0.03, d + 0.06)), frameMat);
            sill.position.set(0, WINDOW_SILL, 0);
            holder.add(sill);
        }

        /* Which rooms does this opening join? Look a little way to each side. */
        const joined = [];
        for (const side of [-1, 1]) {
            const px = o.x + (-Math.sin(theta)) * side * (o.depth / 2 + 20);
            const py = o.y + (Math.cos(theta)) * side * (o.depth / 2 + 20);
            const room = rooms.find((r) => r.polygon && contains(r.polygon, px, py));
            if (room && !joined.includes(room.index)) joined.push(room.index);
        }
        if (o.kind !== 'window') {
            const door = { index, kind: o.kind, position: pos.clone().setY(1.0), normal, along, rooms: joined, width: w };
            doors.push(door);
            for (const ri of joined) rooms[ri].doors.push(doors.length - 1);
        }
    });

    /* ---- the slab everything sits on ---- */
    const bounds = new THREE.Box3().setFromObject(group);
    const size = bounds.getSize(new THREE.Vector3());
    const mid = bounds.getCenter(new THREE.Vector3());
    const base = new THREE.Mesh(track(new THREE.BoxGeometry(size.x + 0.5, 0.1, size.z + 0.5)), baseMat);
    base.position.set(mid.x, -0.05, mid.z);
    base.userData = { kind: 'base' };
    group.add(base);

    return {
        group,
        rooms: rooms.map(({ polygon, ...r }) => r),
        doors,
        bounds: new THREE.Box3().setFromObject(group),
        dispose() {
            for (const d of disposables) d.dispose?.();
        },
    };
}

/* ------------------------------------------------------------------ helpers */

/** Flat [x,y,…] in cm → a closed ring in metres for polygon-clipping. */
function ringFrom(flat) {
    const ring = [];
    for (let i = 0; i < flat.length; i += 2) ring.push([toM(flat[i]), toM(flat[i + 1])]);
    if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) ring.push([...ring[0]]);
    return ring;
}

/** A THREE.Shape from flat cm points. Plan y-down becomes shape y-up, so the
    extrusion, rotated onto the ground, lands with plan y along world +z. */
function shapeFrom(flat) {
    const pts = [];
    for (let i = 0; i < flat.length; i += 2) pts.push(new THREE.Vector2(toM(flat[i]), -toM(flat[i + 1])));
    return new THREE.Shape(pts);
}

/** A shape (with holes) from a polygon-clipping polygon: [outerRing, ...holes] in metres. */
function shapeFromRings(poly) {
    const [outer, ...holes] = poly;
    if (!outer || outer.length < 4) return null;
    const shape = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, -y)));
    for (const h of holes) {
        if (h.length >= 4) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, -y))));
    }
    return shape;
}

/** The rectangle an opening occupies, as a closed ring in metres. */
function openingRect(o, margin) {
    const theta = THREE.MathUtils.degToRad(o.angle);
    const hw = toM(o.width) / 2;
    const hd = toM(o.depth) / 2 + margin;
    const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
    const ring = corners.map(([lx, ly]) => [
        toM(o.x) + lx * Math.cos(theta) - ly * Math.sin(theta),
        toM(o.y) + lx * Math.sin(theta) + ly * Math.cos(theta),
    ]);
    ring.push([...ring[0]]);
    return ring;
}

/* polygon-clipping is exact but throws on degenerate input; a wall that
   cannot be cut is better drawn whole than not at all. */
function safeClip(fn, fallback) {
    try { return fn(); } catch { return fallback; }
}
