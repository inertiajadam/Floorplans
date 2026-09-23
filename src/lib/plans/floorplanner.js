/*
 | Reading a Floorplanner 2D SVG export.
 |
 | Written against a real export (tests/fixtures/floorplanner-mc-deluxe.svg),
 | not against documentation — the docs domain is unreachable from the build
 | environment, and the file turned out to be the better spec anyway.
 |
 | What the export contains, as observed:
 |
 |   <g id="areas">       one <path> per room: the floor polygon. THIS is the
 |                        geometry we want. Fills are texture patterns.
 |   <g id="walls">       one <polygon> per wall segment, white on white.
 |   <g id="openings">    doors and windows as lines, rects and small paths.
 |   <g id="items">       furniture: <use> of base64 PNGs in <defs>. This is
 |                        ~99% of the file's bytes and none of its meaning.
 |   <g id="lightNodes">  lighting. Same story.
 |   <g id="dimensions">  the dimension annotations and their labels.
 |
 |   viewBox in CENTIMETRES. Verified by reading the dimension labels back
 |   against their line lengths: 30.48 units per foot, i.e. 100 per metre.
 |   That means square footage falls straight out of the polygon area, with
 |   no calibration step and no guessing.
 |
 |   An area path can hold several subpaths (M…Z M…Z): the floor polygon plus
 |   the little threshold strips under each doorway. They are parts of one
 |   room, not separate rooms, so a room keeps them as `parts` and its area is
 |   their sum. Flattening them into one polygon draws wedges across the room.
 |
 |   No names. No ids on rooms, no <title>, no data-* attributes. Rooms are
 |   anonymous geometry, which is fine for a single-suite layout (the whole
 |   file IS the suite) and means a whole-building export would still need a
 |   human to say which polygon is which suite.
 |
 | Deliberately dependency-free and DOM-free — a small balanced-tag scanner
 | rather than an XML parser — so the same code runs in the browser (the plan
 | tracer), in Node (the CLI and the tests), and later inside a Laravel job
 | shelling out to node. Generated SVG is regular enough for that to be safe;
 | this is not a general-purpose SVG parser and does not pretend to be.
 */

import { area, bounds, centroid } from '../geometry.js';

/** cm per foot. Floorplanner exports in centimetres; this is the one constant. */
export const UNITS_PER_FOOT = 30.48;
export const UNITS_PER_METRE = 100;
const SQCM_PER_SQFT = 929.0304;

/**
 * Parse an export.
 *
 * @param {string} svg  the file's text
 * @param {{ keepDimensions?: boolean }} [options]
 * @returns {{
 *   viewBox: {x:number,y:number,width:number,height:number},
 *   scale: {unitsPerFoot:number, unitsPerMetre:number, source:string},
 *   rooms: Array<{id:string, points:number[], parts:number[][], sqft:number, sqm:number, bounds:object, centroid:object, fill:string|null}>,
 *   walls: number[][],
 *   totalSqft: number,
 *   totalSqm: number,
 *   cleanSvg: string,
 *   source: {bytes:number, embeddedImages:number}
 * }}
 */
export function parseFloorplannerSvg(svg, { keepDimensions = false } = {}) {
    if (typeof svg !== 'string' || !/<svg[\s>]/i.test(svg)) {
        throw new Error('Not an SVG document.');
    }

    const viewBox = readViewBox(svg);
    const areasGroup = extractGroup(svg, 'areas');
    const wallsGroup = extractGroup(svg, 'walls');
    const openingsGroup = extractGroup(svg, 'openings');
    const dimensionsGroup = keepDimensions ? extractGroup(svg, 'dimensions') : '';

    if (areasGroup === null && wallsGroup === null) {
        throw new Error('This does not look like a Floorplanner export: no "areas" or "walls" layer.');
    }

    const rooms = [];
    for (const [i, path] of elements(areasGroup ?? '', 'path').entries()) {
        const parts = pathToPolygons(attr(path, 'd')).filter((pts) => pts.length >= 6);
        if (!parts.length) continue;   // fewer than three vertices is not a room
        /* The floor is the biggest part; the rest are doorway thresholds. */
        const points = parts.reduce((best, pts) => (area(pts) > area(best) ? pts : best), parts[0]);
        const a = parts.reduce((sum, pts) => sum + area(pts), 0);
        rooms.push({
            id: `area-${i}`,
            points,
            parts,
            sqft: round1(a / SQCM_PER_SQFT),
            sqm: round1(a / (UNITS_PER_METRE * UNITS_PER_METRE)),
            bounds: bounds(points),
            centroid: centroid(points),
            fill: attr(path, 'fill'),
        });
    }

    const walls = [];
    for (const poly of elements(wallsGroup ?? '', 'polygon')) {
        const points = polygonToPoints(attr(poly, 'points'));
        if (points.length >= 6) walls.push(points);
    }

    const totalSqcm = rooms.reduce((s, r) => s + r.sqft * SQCM_PER_SQFT, 0);

    return {
        viewBox,
        scale: { unitsPerFoot: UNITS_PER_FOOT, unitsPerMetre: UNITS_PER_METRE, source: 'floorplanner' },
        rooms,
        walls,
        totalSqft: round1(totalSqcm / SQCM_PER_SQFT),
        totalSqm: round1(totalSqcm / (UNITS_PER_METRE * UNITS_PER_METRE)),
        cleanSvg: buildCleanSvg({ viewBox, rooms, walls, openingsGroup, dimensionsGroup }),
        source: {
            bytes: svg.length,
            embeddedImages: (svg.match(/<image[\s>]/g) ?? []).length,
        },
    };
}

/* --------------------------------------------------------------- clean SVG */

/**
 * A vector-only drawing of the plan: rooms, walls, doors and windows.
 *
 * The export is 6.9 MB, of which 64 kB is geometry and the rest is furniture
 * renders as base64 PNG. Nobody needs a sofa on an availability map. The
 * rebuilt file keeps everything that describes the space and drops
 * everything that decorates it, and is what the suite drawer should show
 * instead of "No plan drawing for this layout yet".
 *
 * Built from scratch rather than by deleting from the original: the export's
 * area fills reference texture patterns that in turn reference the images,
 * so stripping images leaves transparent rooms. Flat fills are the point.
 */
function buildCleanSvg({ viewBox, rooms, walls, openingsGroup, dimensionsGroup }) {
    const vb = `${n(viewBox.x)} ${n(viewBox.y)} ${n(viewBox.width)} ${n(viewBox.height)}`;
    const roomsMarkup = rooms.flatMap((r) => r.parts.map((pts) =>
        `<polygon points="${toPoints(pts)}" fill="var(--plan-room, #f3f2ee)" stroke="none"/>`)).join('');
    const wallsMarkup = walls.map((w) =>
        `<polygon points="${toPoints(w)}" fill="var(--plan-wall, #2b3a44)" stroke="none"/>`).join('');

    /* Openings are lines/rects/paths drawn in near-white over the walls in
       the original. Keep their geometry; recolour so they read on a flat
       wall rather than vanishing into it. */
    const openings = (openingsGroup ?? '')
        .replace(/\sfill="[^"]*"/g, ' fill="var(--plan-opening, #ffffff)"')
        .replace(/\sstroke="[^"]*"/g, ' stroke="var(--plan-wall, #3a4750)"');

    return [
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" role="img" aria-label="Floor plan">`,
        `<g id="rooms">${roomsMarkup}</g>`,
        `<g id="walls">${wallsMarkup}</g>`,
        openings ? `<g id="openings">${openings}</g>` : '',
        dimensionsGroup ? `<g id="dimensions">${dimensionsGroup}</g>` : '',
        `</svg>`,
    ].join('');
}

/* ---------------------------------------------------------------- scanning */

function readViewBox(svg) {
    const m = svg.match(/<svg[^>]*\sviewBox="([^"]+)"/i);
    if (!m) throw new Error('The SVG has no viewBox, so its coordinate space is unknown.');
    const [x, y, width, height] = m[1].trim().split(/[\s,]+/).map(Number);
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
        throw new Error(`Unreadable viewBox: "${m[1]}"`);
    }
    return { x, y, width, height };
}

/**
 * The inner markup of `<g id="…">…</g>`, following nesting.
 *
 * A regex cannot do this — the openings and dimensions groups nest further
 * <g> elements — so walk forward counting opens and closes. Returns null when
 * the group is absent, '' when it is present and empty.
 */
function extractGroup(svg, id) {
    const open = new RegExp(`<g\\b[^>]*\\bid="${id}"[^>]*>`, 'i');
    const start = svg.search(open);
    if (start === -1) return null;
    const bodyStart = start + svg.match(open)[0].length;

    const token = /<g\b[^>]*?(\/?)>|<\/g\s*>/gi;
    token.lastIndex = bodyStart;
    let depth = 1;
    let m;
    while ((m = token.exec(svg))) {
        if (m[0].startsWith('</')) depth -= 1;
        else if (m[1] !== '/') depth += 1;       // a self-closing <g/> does not open
        if (depth === 0) return svg.slice(bodyStart, m.index);
    }
    return svg.slice(bodyStart);   // unterminated: take what there is
}

/** Every `<tag …>` or `<tag …/>` start tag in a fragment, as raw strings. */
function elements(fragment, tag) {
    return fragment.match(new RegExp(`<${tag}\\b[^>]*>`, 'gi')) ?? [];
}

function attr(element, name) {
    const m = element.match(new RegExp(`\\s${name}="([^"]*)"`));
    return m ? m[1] : null;
}

/* ------------------------------------------------------------- geometry io */

/**
 * Path data to a list of polygons, one per subpath.
 *
 * Handles M/L/H/V/Z and their relative forms, which is all a Floorplanner
 * area uses (verified: every area path is M…L…Z, absolute). Curves are not
 * handled and would be a sign the file is not what we think it is, so they
 * throw rather than silently producing a wrong polygon.
 */
export function pathToPolygons(d) {
    if (!d) return [];
    const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
    const polygons = [];
    let out = [];
    let cmd = null;
    let x = 0;
    let y = 0;
    let i = 0;

    const push = () => { out.push(x, y); };
    const close = () => {
        /* A closing vertex equal to the first is redundant for a polygon. */
        if (out.length >= 4 && out[0] === out[out.length - 2] && out[1] === out[out.length - 1]) out.length -= 2;
        if (out.length) polygons.push(out);
        out = [];
    };

    while (i < tokens.length) {
        const t = tokens[i];
        if (/[a-zA-Z]/.test(t)) {
            cmd = t;
            i += 1;
            if (cmd === 'Z' || cmd === 'z') { close(); continue; }
            if (cmd === 'M' || cmd === 'm') close();   // a new subpath without an explicit Z
            if ('CcSsQqTtAa'.includes(cmd)) {
                throw new Error(`Unsupported path command "${cmd}" — this is not a Floorplanner area path.`);
            }
            continue;
        }
        switch (cmd) {
            case 'M': case 'L': x = +tokens[i]; y = +tokens[i + 1]; i += 2; push(); if (cmd === 'M') cmd = 'L'; break;
            case 'm': case 'l': x += +tokens[i]; y += +tokens[i + 1]; i += 2; push(); if (cmd === 'm') cmd = 'l'; break;
            case 'H': x = +t; i += 1; push(); break;
            case 'h': x += +t; i += 1; push(); break;
            case 'V': y = +t; i += 1; push(); break;
            case 'v': y += +t; i += 1; push(); break;
            default: i += 1;
        }
    }
    close();
    return polygons;
}

/** The first (or only) subpath of a path, as a flat point list. */
export function pathToPoints(d) {
    return pathToPolygons(d)[0] ?? [];
}

export function polygonToPoints(points) {
    if (!points) return [];
    return (points.trim().split(/[\s,]+/).map(Number)).filter(Number.isFinite);
}

function toPoints(flat) {
    const parts = [];
    for (let i = 0; i < flat.length; i += 2) parts.push(`${n(flat[i])},${n(flat[i + 1])}`);
    return parts.join(' ');
}

const n = (v) => Math.round(v * 100) / 100;
const round1 = (v) => Math.round(v * 10) / 10;
