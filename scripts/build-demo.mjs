/*
 | Generates the demo campus at demo/data/willow-creek.json.
 |
 | Hand-authoring a few thousand polygon coordinates is a waste of everyone's
 | time and impossible to tweak, so the demo community is generated from a
 | small description of each building's shape. Three real senior living
 | typologies are covered, because they stress the map in different ways:
 |
 |   Magnolia House  double-loaded corridor, 3 floors, assisted living.
 |                   The common case: two rows of suites either side of a hall.
 |   The Grove       a memory care "household" — suites ringing a shared hearth
 |                   and dining room. Secured, single storey, no lift.
 |   The Cottages    free-standing independent living homes on a site plan,
 |                   which is a map of a *site*, not a floor. Proves the same
 |                   component handles both without a second code path.
 |
 | Run: node scripts/build-demo.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../demo/data/willow-creek.json');

/* Deterministic PRNG so regenerating the demo does not churn the diff. */
let seed = 20260923;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const between = (a, b) => a + Math.round(rnd() * (b - a));

const rect = (x, y, w, h) => [x, y, x + w, y, x + w, y + h, x, y + h];

/** An L-shaped corner suite: a rectangle with a bite taken out of one corner. */
const lShape = (x, y, w, h, notchW, notchH, corner = 'tr') => {
    if (corner === 'tr') return [x, y, x + w - notchW, y, x + w - notchW, y + notchH, x + w, y + notchH, x + w, y + h, x, y + h];
    if (corner === 'tl') return [x + notchW, y, x + w, y, x + w, y + h, x, y + h, x, y + notchH, x + notchW, y + notchH];
    if (corner === 'br') return [x, y, x + w, y, x + w, y + h - notchH, x + w - notchW, y + h - notchH, x + w - notchW, y + h, x, y + h];
    return [x, y, x + w, y, x + w, y + h, x + notchW, y + h, x + notchW, y + h - notchH, x, y + h - notchH];
};

/* ------------------------------------------------------------- catalogue */

const LAYOUTS = [
    { id: 'studio-a',   name: 'The Aspen',    roomType: 'studio',            typeLabel: 'Studio',            sqft: 385, bedrooms: 0, bathrooms: 1, description: 'A bright single room with a kitchenette and a full walk-in shower.' },
    { id: 'studio-b',   name: 'The Birch',    roomType: 'studio',            typeLabel: 'Studio deluxe',     sqft: 440, bedrooms: 0, bathrooms: 1, description: 'A larger studio with a separate sitting alcove by the window.' },
    { id: 'one-bed-a',  name: 'The Cedar',    roomType: 'one-bedroom',       typeLabel: 'One bedroom',       sqft: 610, bedrooms: 1, bathrooms: 1, description: 'A proper bedroom door, a full kitchen and room for your own furniture.' },
    { id: 'one-bed-b',  name: 'The Dogwood',  roomType: 'one-bedroom-deluxe',typeLabel: 'One bedroom deluxe',sqft: 705, bedrooms: 1, bathrooms: 1.5, description: 'Corner exposure on two sides, a guest powder room and a wider hall.' },
    { id: 'two-bed',    name: 'The Elm',      roomType: 'two-bedroom',       typeLabel: 'Two bedroom',       sqft: 940, bedrooms: 2, bathrooms: 2, description: 'Two bedrooms at opposite ends — the layout couples and siblings ask for.' },
    { id: 'companion',  name: 'The Fern',     roomType: 'companion-suite',   typeLabel: 'Companion suite',   sqft: 480, bedrooms: 2, bathrooms: 1, description: 'A shared suite with two private sleeping areas and one bathroom.' },
    { id: 'mc-private', name: 'Hearth Room',  roomType: 'memory-care-suite', typeLabel: 'Memory care suite', sqft: 320, bedrooms: 1, bathrooms: 1, description: 'A private room off the household hearth, with a memory box at the door.' },
    { id: 'mc-shared',  name: 'Hearth Shared',roomType: 'semi-private-room', typeLabel: 'Shared suite',      sqft: 400, bedrooms: 2, bathrooms: 1, description: 'Two private beds with a curtain divider and a shared bathroom.' },
    { id: 'cottage-2',  name: 'Garden Home',  roomType: 'cottage',           typeLabel: 'Cottage',           sqft: 1180, bedrooms: 2, bathrooms: 2, description: 'A free-standing home with a garage, a patio and no stairs.' },
];

const RATES = {
    'studio-a': 3850, 'studio-b': 4250, 'one-bed-a': 4950, 'one-bed-b': 5600,
    'two-bed': 6900, companion: 3200, 'mc-private': 6400, 'mc-shared': 5200, 'cottage-2': 4400,
};

const VIEWS = ['Courtyard', 'Garden', 'Main street', 'Woodland', 'Pond'];
const FEATURES = ['Walk-in shower', 'Kitchenette', 'Full kitchen', 'Bay window', 'Balcony', 'Extra storage', 'Heated floor', 'Emergency pendant'];

/**
 * Availability is weighted rather than random so the demo reads like a real
 * rent roll: mostly full, a handful open, a couple coming up, a short waitlist.
 */
const STATUS_MIX = [
    ...Array(11).fill('occupied'),
    ...Array(4).fill('available'),
    ...Array(2).fill('coming_available'),
    'waitlist', 'held', 'respite',
];

let unitSeq = 0;

function makeUnit({ number, layoutId, shape, careLevels, floorOrdinal, forceStatus }) {
    const layout = LAYOUTS.find((l) => l.id === layoutId);
    const status = forceStatus ?? pick(STATUS_MIX);
    unitSeq += 1;

    const unit = {
        id: `u-${unitSeq}`,
        number,
        layoutId,
        shape,
        careLevels,
        status,
        /* Higher floors and better views carry a premium, as they really do. */
        baseRate: RATES[layoutId] + (floorOrdinal - 1) * 125 + (rnd() > 0.7 ? 150 : 0),
        sqft: layout.sqft + between(-15, 15),
        accessible: rnd() > 0.72,
        view: pick(VIEWS),
        features: FEATURES.filter(() => rnd() > 0.62).slice(0, 4),
    };

    if (status === 'coming_available') {
        const days = between(12, 75);
        const d = new Date(2026, 8, 23 + days);
        unit.availableOn = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    if (status === 'waitlist') unit.waitlistCount = between(1, 6);
    if (status === 'respite') unit.respiteNightlyRate = between(185, 265);

    return unit;
}

/* --------------------------------------------- A: double-loaded corridor */

/**
 * Two rows of suites either side of a central hall, with the lounge, dining
 * room and lift core at the west end. Widths vary by layout so the elevation
 * reads like a building rather than a spreadsheet.
 */
function corridorFloor(ordinal, { careLevel, prefix }) {
    const W = 1240, H = 820;
    const left = 150, right = 1180;
    const corridorTop = 392, corridorBottom = 448;
    const topY = 150, bottomY = corridorBottom;
    const depth = corridorTop - topY;

    const plan = [
        ['studio-a', 150], ['one-bed-a', 190], ['studio-b', 165],
        ['one-bed-b', 195], ['studio-a', 150], ['two-bed', 180],
    ];

    const units = [];
    let x = left;
    plan.forEach(([layoutId, w], i) => {
        const isEnd = i === plan.length - 1;
        const shape = isEnd
            ? lShape(x, topY, w, depth, 46, 58, 'tr')
            : rect(x, topY, w, depth);
        units.push(makeUnit({ number: `${prefix}${ordinal}${String(i + 1).padStart(2, '0')}`, layoutId, shape, careLevels: [careLevel], floorOrdinal: ordinal }));
        x += w;
    });

    const bottomPlan = [
        ['one-bed-a', 190], ['studio-a', 150], ['companion', 170],
        ['one-bed-a', 190], ['studio-b', 165], ['one-bed-b', 165],
    ];
    x = left;
    bottomPlan.forEach(([layoutId, w], i) => {
        const isEnd = i === bottomPlan.length - 1;
        const shape = isEnd
            ? lShape(x, bottomY, w, depth, 46, 58, 'br')
            : rect(x, bottomY, w, depth);
        units.push(makeUnit({ number: `${prefix}${ordinal}${String(i + 7).padStart(2, '0')}`, layoutId, shape, careLevels: [careLevel], floorOrdinal: ordinal }));
        x += w;
    });

    const features = [
        { id: `f-${ordinal}-corridor`, kind: 'corridor', label: '', shape: rect(left, corridorTop, right - left, corridorBottom - corridorTop) },
        { id: `f-${ordinal}-lift`,     kind: 'vertical', label: 'Lifts',    shape: rect(58, 352, 86, 128) },
        { id: `f-${ordinal}-stair`,    kind: 'vertical', label: 'Stairs',   shape: rect(58, 200, 86, 110) },
        ordinal === 1
            ? { id: 'f-dining', kind: 'amenity', label: 'Dining room', shape: rect(58, 500, 86, 0) } // replaced below
            : null,
    ].filter(Boolean);

    /* Ground floor gives over its west end to the shared rooms families tour.
       Each room takes exactly the footprint of the suite it displaces, so the
       two never overlap on the plan. */
    if (ordinal === 1) {
        features.length = 3;
        features.push(
            { id: 'f-lounge', kind: 'amenity', label: 'Living room', shape: rect(left, topY, plan[0][1], depth) },
            { id: 'f-dining', kind: 'amenity', label: 'Dining room', shape: rect(left, bottomY, bottomPlan[0][1], depth) },
        );
        units.splice(0, 1);                      // top row's first suite
        units.splice(plan.length - 1, 1);        // bottom row's first suite
    }

    return {
        id: `mag-l${ordinal}`,
        name: ordinal === 1 ? 'Ground floor' : `Floor ${ordinal}`,
        ordinal,
        plan: { image: null, width: W, height: H },
        units,
        features,
    };
}

/* ------------------------------------------------ B: memory care household */

/**
 * A household: private rooms ringing a shared hearth and dining table, so no
 * resident is ever more than a short walk from a staffed, familiar space.
 * Modelled as a ring because that is genuinely how these are built.
 */
function householdFloor() {
    const W = 1000, H = 1000;
    const units = [];
    const cx = 500, cy = 500;

    /* North and south rows, then east and west columns. */
    const north = [['mc-private', 150], ['mc-private', 150], ['mc-shared', 175], ['mc-private', 150], ['mc-private', 150]];
    const south = [['mc-private', 150], ['mc-shared', 175], ['mc-private', 150], ['mc-private', 150], ['mc-private', 150]];
    const sides = [['mc-private', 150], ['mc-private', 160], ['mc-private', 150]];

    let x = 113;
    north.forEach(([layoutId, w], i) => {
        units.push(makeUnit({ number: `G1${String(i + 1).padStart(2, '0')}`, layoutId, shape: rect(x, 95, w, 175), careLevels: ['mc'], floorOrdinal: 1 }));
        x += w;
    });
    x = 113;
    south.forEach(([layoutId, w], i) => {
        units.push(makeUnit({ number: `G2${String(i + 1).padStart(2, '0')}`, layoutId, shape: rect(x, 730, w, 175), careLevels: ['mc'], floorOrdinal: 1 }));
        x += w;
    });
    let y = 285;
    sides.forEach(([layoutId, h], i) => {
        units.push(makeUnit({ number: `G3${String(i + 1).padStart(2, '0')}`, layoutId, shape: rect(95, y, 175, h), careLevels: ['mc'], floorOrdinal: 1 }));
        y += h;
    });
    y = 285;
    sides.forEach(([layoutId, h], i) => {
        units.push(makeUnit({ number: `G4${String(i + 1).padStart(2, '0')}`, layoutId, shape: rect(730, y, 175, h), careLevels: ['mc'], floorOrdinal: 1 }));
        y += h;
    });

    return {
        id: 'grove-l1',
        name: 'The household',
        ordinal: 1,
        plan: { image: null, width: W, height: H },
        units,
        features: [
            { id: 'g-corridor', kind: 'corridor', label: '', shape: rect(270, 270, 460, 460) },
            { id: 'g-hearth',   kind: 'amenity',  label: 'Hearth room',   shape: rect(330, 330, 200, 180) },
            { id: 'g-dining',   kind: 'amenity',  label: 'Family table',  shape: rect(330, 530, 200, 140) },
            { id: 'g-nurse',    kind: 'staff',    label: 'Care team',     shape: rect(550, 330, 130, 120) },
            { id: 'g-garden',   kind: 'outdoor',  label: 'Secured garden',shape: rect(550, 480, 130, 190) },
        ],
    };
}

/* ------------------------------------------------------- C: cottage site */

function cottageSite() {
    const units = [];
    const positions = [
        [110, 120], [350, 120], [590, 120], [830, 120],
        [110, 400], [350, 400], [590, 400], [830, 400],
        [230, 660], [470, 660], [710, 660],
    ];
    positions.forEach(([x, y], i) => {
        units.push(makeUnit({
            number: `C${String(i + 1).padStart(2, '0')}`,
            layoutId: 'cottage-2',
            shape: rect(x, y, 185, 150),
            careLevels: ['il'],
            floorOrdinal: 1,
        }));
    });

    return {
        id: 'cottages-site',
        name: 'Site plan',
        ordinal: 1,
        plan: { image: null, width: 1120, height: 880 },
        units,
        features: [
            { id: 'c-road',   kind: 'corridor', label: '', shape: rect(60, 300, 1000, 78) },
            { id: 'c-road-2', kind: 'corridor', label: '', shape: rect(60, 580, 1000, 62) },
            { id: 'c-green',  kind: 'outdoor',  label: 'Village green', shape: rect(230, 400, 420, 170) },
        ],
    };
}

/* --------------------------------------------------------------- assemble */

const magnolia = {
    id: 'magnolia',
    name: 'Magnolia House',
    shortName: 'Magnolia',
    blurb: 'Assisted living over three floors, with the dining room and living room on the ground floor.',
    levels: [corridorFloor(1, { careLevel: 'al', prefix: '' }), corridorFloor(2, { careLevel: 'al', prefix: '' }), corridorFloor(3, { careLevel: 'al', prefix: '' })],
};

const grove = {
    id: 'grove',
    name: 'The Grove',
    shortName: 'The Grove',
    blurb: 'A secured memory care household of sixteen rooms around a shared hearth.',
    levels: [householdFloor()],
};

const cottages = {
    id: 'cottages',
    name: 'The Cottages',
    shortName: 'Cottages',
    blurb: 'Eleven free-standing garden homes for independent living, with a village green in the middle.',
    levels: [cottageSite()],
};

/* Guarantee the demo always shows every state, whatever the PRNG did. */
function forceVariety(community) {
    const all = community.buildings.flatMap((b) => b.levels.flatMap((l) => l.units));
    const need = ['available', 'available', 'coming_available', 'waitlist', 'respite', 'held', 'model'];
    const occupied = all.filter((u) => u.status === 'occupied');
    need.forEach((s, i) => {
        const u = occupied[i * 3];
        if (!u) return;
        u.status = s;
        if (s === 'coming_available') u.availableOn = '2026-11-15';
        if (s === 'waitlist') u.waitlistCount = 3;
        if (s === 'respite') u.respiteNightlyRate = 215;
    });
}

const community = {
    id: 1,
    slug: 'willow-creek-senior-living',
    name: 'Willow Creek Senior Living',
    city: 'Richmond',
    state: 'VA',
    pricingPublic: true,

    careLevels: [{ key: 'il' }, { key: 'al' }, { key: 'mc' }],

    careTiers: [
        { key: 'none',  label: 'No care package', monthly: 0,    careLevels: ['il'], description: 'Independent, with meals and housekeeping included.' },
        { key: 'al-1',  label: 'Level 1',  monthly: 625,  careLevels: ['al'], description: 'A hand with medication and one or two daily tasks.' },
        { key: 'al-2',  label: 'Level 2',  monthly: 1150, careLevels: ['al'], description: 'Daily help with dressing, bathing and getting about.' },
        { key: 'al-3',  label: 'Level 3',  monthly: 1780, careLevels: ['al'], description: 'Substantial help with most activities, several times a day.' },
        { key: 'al-4',  label: 'Level 4',  monthly: 2450, careLevels: ['al'], description: 'Two-person assistance and full support with daily living.' },
        { key: 'mc-all',label: 'All-inclusive', monthly: 0, careLevels: ['mc'], description: 'Memory care is priced all-in — no separate care levels.' },
    ],

    addOns: [
        { key: 'pet',     label: 'Pet rent',            monthly: 45 },
        { key: 'parking', label: 'Covered parking',     monthly: 75 },
        { key: 'salon',   label: 'Salon plan',          monthly: 60 },
        { key: 'transport', label: 'Extra transport',   monthly: 95 },
    ],

    fees: { community: 3500, secondPerson: 1150, petDeposit: 400 },

    layouts: LAYOUTS.map((l) => ({ ...l, image2d: null, image3d: null, tourUrl: null })),
    buildings: [magnolia, grove, cottages],

    legalNote: 'Rates shown are current as of today and are a starting point. The care charge is set by a nurse assessment before move-in. Availability changes daily.',
};

forceVariety(community);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(community, null, 1));

const total = community.buildings.reduce((n, b) => n + b.levels.reduce((m, l) => m + l.units.length, 0), 0);
console.log(`Wrote ${OUT}`);
console.log(`${community.buildings.length} buildings, ${community.buildings.reduce((n, b) => n + b.levels.length, 0)} levels, ${total} units`);
