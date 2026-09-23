/*
 | Generates the first real community: The Commons on Meridian.
 |
 | Output: demo/data/commons-on-meridian.json
 |
 | Everything positional here was read off the client's current SightMap
 | (the Engrain site plan): the site frame, the two streets, the drive loop
 | and parking, the building outline, and every suite and named room on
 | both floors. Coordinates are in the screenshot's pixel space, doubled, with
 | the map's top-left as the origin. The screenshot is 905 × 790 px, so the
 | plan is 1810 × 1580.
 |
 | What is REAL (taken from the screenshots or the client's own files):
 |
 |   - suite numbers and which wing they sit in (purple = memory care, green
 |     = assisted living), and that the A/B pairs are companion suites
 |   - the care levels (assisted living, memory care — no independent living)
 |   - the layout catalogue names, exactly as their filter lists them
 |   - the view names, exactly as their filter lists them
 |   - the room and amenity names on the plan
 |   - three rates: 101 studio $3,410, 102 studio $3,825, 103/106 1 bed $5,295
 |   - 101, 102, 103, 104 and 106 are available now; floor 2: 201 $3,410,
 |     202 $3,825, 203 $5,295, and 201–204 available now
 |   - floor 2 is assisted living only: the memory care household is
 |     single-storey (roof above its ring), the Meridian row and the
 |     commons carry a second floor
 |   - the memory care deluxe plan drawing and its square footage, from the
 |     client's Floorplanner export (demo/data/plans/tcom-mc-deluxe.plan.svg)
 |   - street names and that north points to the RIGHT of the plan
 |
 | What is a PLACEHOLDER until the client's rent roll arrives (each marked
 | `placeholder` below so nothing is mistaken for fact):
 |
 |   - every other rate, the care tier charges, the community fee
 |   - which layout each suite has (assigned by the size drawn on the plan)
 |   - square footage other than the deluxe plan's
 |   - availability of every suite not listed above
 |
 | Run: node scripts/build-commons.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../demo/data/commons-on-meridian.json');
const DELUXE_PLAN = resolve(__dirname, '../demo/data/plans/tcom-mc-deluxe.plan.svg');

/* Screenshot pixel → plan units. The map's top-left corner in the
   screenshot is (433, 178); everything is doubled for headroom. */
const OX = 433;
const OY = 178;
const S = 2;
const px = (x) => Math.round((x - OX) * S);
const py = (y) => Math.round((y - OY) * S);
/** A rectangle given by its screenshot corners. */
const R = (x1, y1, x2, y2) => [px(x1), py(y1), px(x2), py(y1), px(x2), py(y2), px(x1), py(y2)];
/** A polygon given as screenshot (x, y) pairs. */
const P = (...pairs) => pairs.flatMap(([x, y]) => [px(x), py(y)]);

const W = px(1338);
const H = py(968);

/* ------------------------------------------------------------- catalogue */

/* The names are the client's own (their Floor Plans filter). Sizes other
   than the deluxe plan are placeholders. */
const LAYOUTS = [
    { id: 'al-studio',    name: 'Assisted Living – Studio',            roomType: 'studio',           typeLabel: 'Studio',          careLevel: 'al', sqft: 380, bedrooms: 0, bathrooms: 1, description: 'A single room with a kitchenette, a walk-in shower and a window seat.' },
    { id: 'al-1br',       name: 'Assisted Living – 1 Bedroom',         roomType: 'one-bedroom',      typeLabel: 'One bedroom',     careLevel: 'al', sqft: 560, bedrooms: 1, bathrooms: 1, description: 'A separate bedroom with a door, a living room and a kitchenette.' },
    { id: 'al-2br',       name: 'Assisted Living – 2 Bedroom',         roomType: 'two-bedroom',      typeLabel: 'Two bedroom',     careLevel: 'al', sqft: 860, bedrooms: 2, bathrooms: 2, description: 'Two bedrooms and two bathrooms — for couples, or a second room for family to stay.' },
    { id: 'mc-studio',    name: 'Memory Care – Studio',                roomType: 'memory-care-suite',typeLabel: 'Studio',          careLevel: 'mc', sqft: 320, bedrooms: 0, bathrooms: 1, description: 'A private room and bathroom off the memory care household.' },
    { id: 'mc-deluxe',    name: 'Memory Care – Studio Deluxe',         roomType: 'memory-care-suite-deluxe', typeLabel: 'Studio deluxe', careLevel: 'mc', sqft: null, bedrooms: 0, bathrooms: 1, description: 'A larger private suite with a separate sitting area and its own bathroom.' },
    { id: 'mc-1br',       name: 'Memory Care – 1 Bedroom',             roomType: 'one-bedroom',      typeLabel: 'One bedroom',     careLevel: 'mc', sqft: 480, bedrooms: 1, bathrooms: 1, description: 'A bedroom with a door and a sitting room, inside the secured household.' },
    { id: 'mc-companion', name: 'Memory Care – Companion Suite',       roomType: 'companion-suite',  typeLabel: 'Companion suite', careLevel: 'mc', sqft: 420, bedrooms: 2, bathrooms: 1, description: 'A shared suite: two private sleeping areas and one bathroom. Each half is listed on its own.' },
];

/* Real: 101 $3,410 · 102 $3,825 · 103/106 $5,295. The rest are placeholders. */
const RATES = {
    'al-studio': 3410, 'al-1br': 5295, 'al-2br': 6450,
    'mc-studio': 5850, 'mc-deluxe': 6650, 'mc-1br': 7100, 'mc-companion': 4650,
};
const KNOWN_RATES = { 101: 3410, 102: 3825, 103: 5295, 106: 5295, 201: 3410, 202: 3825, 203: 5295 };
const KNOWN_AVAILABLE = new Set(['101', '102', '103', '104', '106', '201', '202', '203', '204']);

/* Their Views filter, verbatim. North is to the right of the plan, so:
   top = west (Meridian), right = north (86th), bottom = east, left = south. */
const VIEW = {
    courtyard: 'Courtyard View',
    east: 'East/Residential Neighborhood View',
    north: 'North/86th Street View',
    south: 'South/Residential Neighborhood View',
    west: 'West/Meridian View',
};

/* ------------------------------------------------------------------ units */

/* Deterministic PRNG so regenerating does not churn the diff. */
let seed = 20260923;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const between = (a, b) => a + Math.round(rnd() * (b - a));

/* Placeholder availability for suites we have no word on: mostly full, a
   few open, a couple coming up, a short waitlist — the shape of a real
   rent roll, so the map reads honestly in a demo. */
const STATUS_MIX = [
    ...Array(12).fill('occupied'),
    ...Array(3).fill('available'),
    ...Array(2).fill('coming_available'),
    'waitlist', 'held', 'respite',
];

let seq = 0;

/**
 * @param {string} number  suite number as painted on the plan
 * @param {string} layoutId
 * @param {number[]} shape
 * @param {string} view    a VIEW key
 */
function unit(number, layoutId, shape, view, extra = {}) {
    const layout = LAYOUTS.find((l) => l.id === layoutId);
    seq += 1;
    const known = KNOWN_AVAILABLE.has(number);
    const status = known ? 'available' : pick(STATUS_MIX);
    const companion = layoutId === 'mc-companion';

    const u = {
        id: `tcom-${number.toLowerCase()}`,
        number,
        layoutId,
        shape,
        careLevels: [layout.careLevel],
        status,
        baseRate: KNOWN_RATES[number] ?? RATES[layoutId],
        sqft: layout.sqft ?? DELUXE_SQFT,
        accessible: rnd() > 0.7,
        view: VIEW[view],
        features: companion
            ? ['Shared bathroom', 'Memory box at the door']
            : layout.careLevel === 'mc'
                ? ['Memory box at the door', 'Walk-in shower']
                : ['Kitchenette', 'Walk-in shower', 'Emergency pendant'].filter(() => rnd() > 0.3),
        placeholder: {
            rate: !(number in KNOWN_RATES),
            status: !known,
            layout: true,
        },
        ...extra,
    };
    if (companion) u.companionOf = number.replace(/[AB]$/, '');

    if (status === 'coming_available') {
        const d = new Date(2026, 8, 23 + between(10, 60));
        u.availableOn = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    if (status === 'waitlist') u.waitlistCount = between(1, 5);
    if (status === 'respite') u.respiteNightlyRate = between(210, 275);
    return u;
}

/* ------------------------------------------------------ the deluxe plan */

const deluxeSvg = readFileSync(DELUXE_PLAN, 'utf8');
/* 1,102 sq ft measured from the drawing (see tests/js/floorplanner.test.mjs).
   Flagged for the client: it is large for a "studio deluxe", so the export
   may belong to a different layout. */
const DELUXE_SQFT = 1102;
const deluxeImage = `data:image/svg+xml;base64,${Buffer.from(deluxeSvg).toString('base64')}`;

/* ------------------------------------------------------------- the site */

/** The ground every floor sits on: lawn, the two streets, drives, parking. */
function site(ordinal) {
    const id = (k) => `s${ordinal}-${k}`;
    return [
        /* Ground first: everything else sits on it. */
        { id: id('lawn'),       kind: 'lawn',    label: '', shape: R(433, 178, 1338, 968) },
        { id: id('meridian'),   kind: 'road',    label: 'N Meridian Street', shape: R(433, 178, 1338, 240) },
        { id: id('86th'),       kind: 'road',    label: 'E 86th Street',     shape: R(1275, 178, 1338, 968) },
        { id: id('entry-w'),    kind: 'road',    label: '', shape: R(470, 240, 520, 300) },
        { id: id('entry-n'),    kind: 'road',    label: '', shape: R(1035, 240, 1080, 300) },
        { id: id('drive-top'),  kind: 'road',    label: '', shape: R(470, 300, 1200, 345) },
        { id: id('drive-e'),    kind: 'road',    label: '', shape: R(1150, 300, 1200, 900) },
        { id: id('drive-s'),    kind: 'road',    label: '', shape: R(1050, 855, 1275, 900) },
        { id: id('drive-bldg'), kind: 'road',    label: '', shape: R(1105, 345, 1150, 505) },
        { id: id('park-1'),     kind: 'parking', label: 'Parking', shape: R(520, 352, 765, 388) },
        { id: id('park-2'),     kind: 'parking', label: '', shape: R(900, 352, 1000, 388) },
        { id: id('park-3'),     kind: 'parking', label: 'Parking', shape: R(1108, 505, 1145, 625) },
        { id: id('park-4'),     kind: 'parking', label: 'Overflow parking', shape: R(1108, 660, 1148, 790) },
    ];
}

/* ------------------------------------------------------------- floor one */

function floorOne() {
    const units = [];

    /* ---- Memory care wing (purple on their map) ---------------------- */

    /* Top row, facing Meridian. */
    units.push(
        unit('309',  'mc-1br',       R(595, 400, 622, 436), 'west'),
        unit('308A', 'mc-companion', R(622, 400, 645, 436), 'west'),
        unit('308B', 'mc-companion', R(645, 400, 668, 436), 'west'),
        unit('307',  'mc-1br',       R(668, 400, 698, 436), 'west'),
        unit('305',  'mc-1br',       R(713, 400, 745, 436), 'west'),
        unit('303A', 'mc-companion', R(745, 400, 768, 436), 'west'),
        unit('303B', 'mc-companion', R(768, 400, 790, 436), 'west'),
        unit('301',  'mc-1br',       R(790, 400, 816, 436), 'west'),
    );
    /* Inner top row, on the courtyard. */
    units.push(
        unit('306',  'mc-deluxe',    R(690, 450, 718, 492), 'courtyard'),
        unit('304',  'mc-deluxe',    R(718, 450, 748, 492), 'courtyard'),
        unit('302B', 'mc-companion', R(748, 450, 772, 492), 'courtyard'),
        unit('302A', 'mc-companion', R(772, 450, 796, 492), 'courtyard'),
    );
    /* Outer column, facing the neighbourhood to the south. */
    units.push(
        unit('311', 'mc-studio', R(598, 452, 632, 478), 'south'),
        unit('313', 'mc-studio', R(598, 478, 632, 505), 'south'),
        unit('315', 'mc-studio', R(598, 505, 632, 530), 'south'),
        unit('316', 'mc-studio', R(598, 530, 632, 557), 'south'),
        unit('317', 'mc-studio', R(598, 557, 632, 588), 'south'),
    );
    /* Inner column, on the courtyard. */
    units.push(
        unit('310', 'mc-studio', R(645, 470, 675, 496), 'courtyard'),
        unit('312', 'mc-studio', R(645, 496, 675, 521), 'courtyard'),
        unit('314', 'mc-studio', R(645, 521, 675, 546), 'courtyard'),
    );
    /* Inner bottom row, on the courtyard. */
    units.push(
        unit('320', 'mc-studio', R(668, 548, 693, 580), 'courtyard'),
        unit('322', 'mc-studio', R(693, 548, 716, 580), 'courtyard'),
        unit('324', 'mc-studio', R(716, 548, 741, 580), 'courtyard'),
        unit('326', 'mc-studio', R(741, 548, 765, 580), 'courtyard'),
        unit('328', 'mc-studio', R(765, 548, 790, 580), 'courtyard'),
        unit('330', 'mc-studio', R(790, 548, 816, 580), 'courtyard'),
    );
    /* Outer bottom row, facing the neighbourhood to the east. */
    units.push(
        unit('318',  'mc-studio',    R(578, 605, 605, 637), 'south'),
        unit('319',  'mc-1br',       R(605, 595, 648, 637), 'east'),
        unit('321',  'mc-deluxe',    R(648, 595, 680, 637), 'east'),
        unit('323B', 'mc-companion', R(680, 595, 702, 637), 'east'),
        unit('323A', 'mc-companion', R(702, 595, 722, 637), 'east'),
        unit('325B', 'mc-companion', R(722, 595, 742, 637), 'east'),
        unit('325A', 'mc-companion', R(742, 595, 763, 637), 'east'),
        unit('327',  'mc-deluxe',    R(763, 595, 790, 637), 'east'),
        unit('329B', 'mc-companion', R(790, 595, 810, 637), 'east'),
        unit('329A', 'mc-companion', R(810, 595, 832, 637), 'east'),
    );

    /* ---- Assisted living wing (green on their map) ------------------- */

    /* Outer column, facing 86th Street. */
    units.push(
        unit('101', 'al-studio', R(1065, 470, 1102, 502), 'north'),
        unit('102', 'al-studio', R(1065, 502, 1102, 534), 'north'),
        unit('103', 'al-1br',    R(1065, 536, 1102, 568), 'north'),
        unit('105', 'al-1br',    R(1065, 570, 1102, 602), 'north'),
        unit('107', 'al-1br',    R(1065, 605, 1102, 640), 'north'),
        unit('111', 'al-1br',    R(1065, 650, 1102, 687), 'north'),
        unit('113', 'al-1br',    R(1065, 705, 1102, 740), 'north'),
        unit('116', 'al-2br',    R(1065, 745, 1102, 795), 'east'),
    );
    /* Inner column, on the assisted living courtyard. */
    units.push(
        unit('104', 'al-studio', R(1018, 540, 1050, 570), 'courtyard'),
        unit('106', 'al-1br',    R(1018, 570, 1050, 602), 'courtyard'),
        unit('108', 'al-studio', R(1018, 605, 1050, 640), 'courtyard'),
        unit('110', 'al-studio', R(1018, 645, 1050, 680), 'courtyard'),
        unit('112', 'al-studio', R(1018, 685, 1050, 716), 'courtyard'),
        unit('114', 'al-1br',    R(1018, 720, 1050, 750), 'courtyard'),
        unit('117', 'al-2br',    R(1005, 755, 1045, 797), 'east'),
    );

    /* ---- The building ------------------------------------------------ */

    const features = [
        ...site(1),
        /* The building: one outline so the wings read as one place. */
        { id: 'b-outline', kind: 'building', label: '', shape: P(
            [595, 395], [1090, 395], [1090, 465], [1105, 465], [1105, 800],
            [1000, 800], [1000, 625], [835, 625], [835, 640], [575, 640],
            [575, 595], [595, 595],
        ) },

        /* Memory care household. */
        { id: 'f-mc-hall-top',    kind: 'corridor', label: '', shape: R(595, 436, 835, 450) },
        { id: 'f-mc-hall-left',   kind: 'corridor', label: '', shape: R(632, 450, 645, 595) },
        { id: 'f-mc-hall-bottom', kind: 'corridor', label: '', shape: R(575, 580, 835, 595) },
        { id: 'f-mc-hall-right',  kind: 'corridor', label: '', shape: R(802, 450, 818, 580) },
        { id: 'f-mc-courtyard',   kind: 'outdoor',  label: 'Memory care courtyard', shape: R(688, 494, 802, 548) },
        { id: 'f-mc-private-dining', kind: 'amenity', label: 'Private dining', shape: R(796, 450, 818, 492) },
        { id: 'f-mc-dining',      kind: 'amenity',  label: 'Memory care dining', shape: R(818, 445, 882, 498) },
        { id: 'f-mc-living',      kind: 'amenity',  label: 'Memory care living', shape: R(818, 498, 882, 548) },
        { id: 'f-spa',            kind: 'amenity',  label: 'Spa',              shape: R(645, 546, 675, 566) },
        { id: 'f-laundry',        kind: 'staff',    label: 'Resident laundry', shape: R(645, 566, 675, 588) },
        { id: 'f-mc-utility',     kind: 'staff',    label: '',                 shape: R(698, 400, 713, 436) },

        /* The commons between the wings. */
        { id: 'f-office',      kind: 'staff',    label: 'Office',            shape: R(832, 400, 860, 432) },
        { id: 'f-salon',       kind: 'amenity',  label: 'Salon',             shape: R(860, 400, 885, 432) },
        { id: 'f-fitness',     kind: 'amenity',  label: 'Fitness & wellness', shape: R(885, 395, 925, 442) },
        { id: 'f-offices',     kind: 'staff',    label: 'Offices',           shape: R(925, 395, 1000, 442) },
        { id: 'f-welcome',     kind: 'amenity',  label: 'Welcome center',    shape: R(1000, 400, 1040, 432) },
        { id: 'f-kitchen',     kind: 'staff',    label: 'Kitchen',           shape: R(885, 450, 935, 530) },
        { id: 'f-al-dining',   kind: 'amenity',  label: 'Assisted living dining', shape: R(935, 445, 1000, 530) },
        { id: 'f-private-dining', kind: 'amenity', label: 'Private dining',  shape: R(1000, 445, 1030, 470) },
        { id: 'f-reception',   kind: 'amenity',  label: 'Reception',         shape: R(1035, 440, 1090, 482) },
        { id: 'f-bistro',      kind: 'amenity',  label: 'Bistro',            shape: R(1000, 482, 1062, 520) },
        { id: 'f-living-room', kind: 'amenity',  label: 'Living room',       shape: R(985, 520, 1040, 560) },
        { id: 'f-service',     kind: 'staff',    label: 'Service',           shape: R(832, 560, 885, 625) },
        { id: 'f-lift',        kind: 'vertical', label: 'Elevator',          shape: R(1040, 500, 1058, 520) },

        /* Assisted living wing. */
        { id: 'f-al-hall',      kind: 'corridor', label: '', shape: R(1050, 470, 1065, 800) },
        { id: 'f-al-stairs',    kind: 'vertical', label: 'Stairs', shape: R(1045, 760, 1065, 797) },
        { id: 'f-al-courtyard', kind: 'outdoor',  label: 'Assisted living courtyard & patio', shape: R(930, 560, 1000, 615) },
        { id: 'f-putting',      kind: 'outdoor',  label: 'Putting green', shape: R(920, 650, 985, 700) },
        { id: 'f-patio',        kind: 'outdoor',  label: 'Patio',         shape: R(960, 700, 1000, 740) },
        { id: 'f-dog-park',     kind: 'outdoor',  label: 'Dog park',      shape: R(930, 725, 992, 778) },
    ];

    return {
        id: 'tcom-l1',
        name: 'Floor 1',
        ordinal: 1,
        plan: { image: null, width: W, height: H },
        north: 'right',
        units,
        features,
    };
}


/* ------------------------------------------------------------- floor two */

/**
 * Assisted living only. The memory care household is single-storey (its
 * ring is roof up here), but the row along Meridian and the commons carry a
 * second floor, so floor 2 wraps around the memory care courtyard from
 * above and runs down the 86th Street wing.
 */
function floorTwo() {
    const units = [];

    /* Row along Meridian. */
    units.push(
        unit('231', 'al-2br',    R(650, 400, 700, 440), 'west'),
        unit('229', 'al-studio', R(700, 400, 735, 436), 'west'),
        unit('227', 'al-1br',    R(735, 400, 770, 436), 'west'),
        unit('225', 'al-1br',    R(770, 400, 805, 436), 'west'),
        unit('223', 'al-studio', R(805, 400, 840, 436), 'west'),
        unit('222', 'al-studio', R(840, 400, 870, 436), 'west'),
        unit('220', 'al-1br',    R(870, 400, 905, 436), 'west'),
        unit('218', 'al-1br',    R(920, 400, 952, 436), 'west'),
        unit('217', 'al-studio', R(952, 400, 985, 436), 'west'),
        unit('216', 'al-1br',    R(985, 400, 1015, 436), 'west'),
    );
    /* Second row, over the memory care courtyard. */
    units.push(
        unit('239', 'al-1br',    R(637, 450, 672, 490), 'courtyard'),
        unit('230', 'al-studio', R(672, 450, 708, 490), 'courtyard'),
        unit('228', 'al-1br',    R(708, 450, 745, 490), 'courtyard'),
        unit('226', 'al-studio', R(745, 450, 780, 490), 'courtyard'),
        unit('224', 'al-1br',    R(780, 450, 825, 480), 'courtyard'),
    );
    /* Two columns either side of the hall above the memory care living rooms. */
    units.push(
        unit('232', 'al-studio', R(795, 480, 830, 515), 'courtyard'),
        unit('234', 'al-studio', R(795, 520, 830, 552), 'courtyard'),
        unit('236', 'al-studio', R(795, 555, 830, 590), 'courtyard'),
        unit('238', 'al-1br',    R(795, 590, 830, 630), 'courtyard'),
        unit('233', 'al-1br',    R(845, 500, 885, 535), 'courtyard'),
        unit('235', 'al-1br',    R(845, 540, 885, 575), 'courtyard'),
        unit('237', 'al-studio', R(845, 580, 885, 615), 'courtyard'),
        unit('221', 'al-studio', R(880, 445, 915, 480), 'courtyard'),
        unit('219', 'al-studio', R(920, 465, 955, 500), 'courtyard'),
    );
    /* 86th Street wing. */
    units.push(
        unit('201', 'al-studio', R(1058, 475, 1095, 505), 'north'),
        unit('202', 'al-studio', R(1058, 505, 1095, 533), 'north'),
        unit('203', 'al-1br',    R(1058, 535, 1095, 566), 'north'),
        unit('204', 'al-1br',    R(1058, 570, 1095, 600), 'north'),
        unit('206', 'al-1br',    R(1058, 605, 1095, 640), 'north'),
        unit('210', 'al-1br',    R(1058, 650, 1095, 688), 'north'),
        unit('212', 'al-1br',    R(1058, 700, 1095, 740), 'north'),
        unit('214', 'al-2br',    R(1058, 745, 1095, 795), 'east'),
        unit('205', 'al-studio', R(1005, 565, 1042, 598), 'courtyard'),
        unit('207', 'al-1br',    R(1005, 600, 1042, 640), 'courtyard'),
        unit('209', 'al-studio', R(1005, 645, 1042, 680), 'courtyard'),
        unit('211', 'al-studio', R(1005, 685, 1042, 716), 'courtyard'),
        unit('213', 'al-studio', R(1005, 720, 1042, 750), 'courtyard'),
        unit('215', 'al-2br',    R(995, 755, 1042, 797), 'east'),
    );

    const features = [
        ...site(2),

        /* What is below: the memory care household's roof, and the courtyard
           it opens onto, seen from above. */
        { id: 'b2-outline', kind: 'building', label: '', shape: P(
            [637, 395], [1090, 395], [1090, 465], [1100, 465], [1100, 800],
            [995, 800], [995, 630], [795, 630], [795, 495], [637, 495],
        ) },
        { id: 'f2-roof-mc',    kind: 'roof',    label: 'Roof',  shape: P([575, 440], [637, 440], [637, 495], [795, 495], [795, 640], [575, 640]) },
        { id: 'f2-roof-mid',   kind: 'roof',    label: 'Roof',  shape: R(890, 515, 1000, 565) },
        { id: 'f2-courtyard',  kind: 'outdoor', label: 'Memory care courtyard', shape: R(688, 494, 795, 548) },

        /* Halls. */
        { id: 'f2-hall-top',   kind: 'corridor', label: '', shape: R(650, 436, 1040, 450) },
        { id: 'f2-hall-mid',   kind: 'corridor', label: '', shape: R(830, 480, 845, 630) },
        { id: 'f2-hall-al',    kind: 'corridor', label: '', shape: R(1042, 475, 1058, 800) },

        /* The commons, upstairs. */
        { id: 'f2-nurses',     kind: 'staff',    label: 'Nurses station', shape: R(845, 450, 890, 470) },
        { id: 'f2-spa',        kind: 'amenity',  label: 'Spa',            shape: R(845, 470, 870, 490) },
        { id: 'f2-laundry',    kind: 'staff',    label: 'Laundry',        shape: R(870, 480, 890, 500) },
        { id: 'f2-theater',    kind: 'amenity',  label: 'Theater',        shape: R(955, 450, 1000, 495) },
        { id: 'f2-activities', kind: 'amenity',  label: 'Activities',     shape: R(960, 495, 1005, 520) },
        { id: 'f2-balcony',    kind: 'outdoor',  label: 'Balcony',        shape: R(1005, 450, 1040, 478) },
        { id: 'f2-salon',      kind: 'amenity',  label: 'Salon',          shape: R(1005, 480, 1040, 515) },
        { id: 'f2-library',    kind: 'amenity',  label: 'Library',        shape: R(1005, 535, 1042, 565) },
        { id: 'f2-lift',       kind: 'vertical', label: 'Elevator',       shape: R(940, 445, 955, 465) },
        { id: 'f2-stairs-w',   kind: 'vertical', label: 'Stairs',         shape: R(845, 615, 885, 630) },
        { id: 'f2-stairs-e',   kind: 'vertical', label: 'Stairs',         shape: R(1042, 760, 1058, 797) },
    ];

    return {
        id: 'tcom-l2',
        name: 'Floor 2',
        ordinal: 2,
        plan: { image: null, width: W, height: H },
        north: 'right',
        units,
        features,
    };
}

/* ------------------------------------------------------------ community */

const community = {
    id: 2,
    slug: 'the-commons-on-meridian',
    name: 'The Commons on Meridian',
    city: 'Indianapolis',
    state: 'IN',
    pricingPublic: true,
    careLevels: [{ key: 'al' }, { key: 'mc' }],
    /* Placeholder charges; the structure (levels for AL, all-in for MC) is
       the usual one and the client will confirm. */
    careTiers: [
        { key: 'al-1',   label: 'Level 1', monthly: 650,  careLevels: ['al'], description: 'A hand with medication and one or two daily tasks.' },
        { key: 'al-2',   label: 'Level 2', monthly: 1200, careLevels: ['al'], description: 'Daily help with dressing, bathing and getting about.' },
        { key: 'al-3',   label: 'Level 3', monthly: 1850, careLevels: ['al'], description: 'Substantial help with most activities, several times a day.' },
        { key: 'al-4',   label: 'Level 4', monthly: 2500, careLevels: ['al'], description: 'Two-person assistance and full support with daily living.' },
        { key: 'mc-all', label: 'All-inclusive', monthly: 0, careLevels: ['mc'], description: 'Memory care is priced all-in — no separate care levels.' },
    ],
    addOns: [
        { key: 'pet',       label: 'Pet rent',       monthly: 50 },
        { key: 'salon',     label: 'Salon plan',     monthly: 65 },
        { key: 'transport', label: 'Extra transport',monthly: 95 },
    ],
    fees: { community: 3500, secondPerson: 1200, petDeposit: 500 },
    layouts: LAYOUTS.map(({ careLevel, ...l }) => ({
        ...l,
        sqft: l.sqft ?? DELUXE_SQFT,
        image2d: l.id === 'mc-deluxe' ? deluxeImage : null,
        image3d: null,
        tourUrl: null,
        planSource: l.id === 'mc-deluxe' ? 'floorplanner:tcom_mc_deluxe_first_floor_first_design' : null,
    })),
    buildings: [{
        id: 'tcom',
        name: 'The Commons on Meridian',
        shortName: 'Commons',
        blurb: 'One building, two wings: a secured memory care household around its own courtyard, and assisted living along 86th Street, joined by the dining rooms, bistro and salon.',
        levels: [floorOne(), floorTwo()],
    }],
    legalNote: 'Rates shown are a starting point and change with availability. The care charge is set by a nurse assessment before move-in.',
    confirmedAt: '2026-09-23T00:00:00.000Z',
    placeholder: {
        note: 'Geometry, suite numbers, care levels, layout and view names, amenity names and nine listed availabilities are from the community’s current map. Rates other than 101/102/103/106/201/202/203, care charges, fees, per-suite layouts and other availabilities are placeholders.',
    },
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(community, null, 2)}\n`);

const all = community.buildings.flatMap((b) => b.levels.flatMap((l) => l.units));
const byLevel = (k) => all.filter((u) => u.careLevels[0] === k).length;
console.log(`${community.name}: ${all.length} suites (${byLevel('mc')} memory care, ${byLevel('al')} assisted living), plan ${W} × ${H}`);
console.log(`  → ${OUT}`);
