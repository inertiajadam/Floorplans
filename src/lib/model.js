/*
 | The community map document, and how we normalise it.
 |
 | One JSON document describes everything the map needs: the campus, its
 | buildings, each building's levels, the units drawn on each level, the
 | layouts those units are instances of, and the care tiers that price them.
 | It is deliberately one document — a family panning a floor plan should
 | never wait on a network round trip, and a 40-unit community serialises to
 | well under 60 KB.
 |
 | Shape (everything but ids and geometry is optional):
 |
 |   {
 |     id, slug, name, city, state, pricingPublic,
 |     careLevels: [{ key, label, blurb }],
 |     careTiers:  [{ key, label, monthly, careLevels?, description? }],
 |     addOns:     [{ key, label, monthly }],
 |     fees:       { community, secondPerson, petDeposit },
 |     layouts:    [{ id, name, roomType, typeLabel, sqft, bedrooms, bathrooms,
 |                    image2d, image3d, tourUrl, description }],
 |     buildings:  [{ id, name, shortName, blurb, levels: [Level] }]
 |   }
 |
 |   Level = { id, name, ordinal, plan: { image, width, height },
 |             units: [Unit], features: [Feature] }
 |
 |   Unit  = { id, number, layoutId, shape: [x,y,...], status, careLevels: [key],
 |             baseRate, availableOn?, waitlistCount?, accessible?, view?,
 |             features?: [string], notes? }
 |
 |   Feature = { id, kind, label, shape } — dining rooms, courtyards, the salon,
 |             the nurse station. Not for sale, but the reason a suite at the
 |             end of the hall is worth more than the one by the lift.
 |
 | `normalize()` flattens layout data onto each unit so every consumer reads one
 | object, and builds the indexes the map and list need. Do this once, not per
 | render — the components all treat the result as frozen.
 */

import { bounds, centroid, unionBounds } from './geometry.js';
import { floorPrice, headline } from './pricing.js';
import { OCCUPIED, status as statusFor } from './availability.js';

/** The care levels senior living actually sells, in the order families move through them. */
export const CARE_LEVELS = [
    { key: 'il', label: 'Independent living', short: 'Independent', blurb: 'Your own apartment, with meals, housekeeping and life on tap.' },
    { key: 'al', label: 'Assisted living', short: 'Assisted', blurb: 'Help with dressing, bathing and medication, in your own suite.' },
    { key: 'mc', label: 'Memory care', short: 'Memory care', blurb: 'A secured neighbourhood with staff trained in dementia care.' },
    { key: 'snf', label: 'Skilled nursing', short: 'Skilled nursing', blurb: 'Round-the-clock clinical care from licensed nurses.' },
];

export function careLevel(key) {
    return CARE_LEVELS.find((c) => c.key === key) ?? { key, label: key, short: key, blurb: '' };
}

/**
 * Normalise a raw community document into the shape the components consume.
 * Pure; returns a new object and never mutates its input.
 */
export function normalize(raw) {
    if (!raw) throw new Error('normalize(): a community document is required');

    const layouts = new Map((raw.layouts ?? []).map((l) => [l.id, l]));
    const pricingPublic = raw.pricingPublic !== false;

    const community = {
        id: raw.id ?? null,
        slug: raw.slug ?? null,
        name: raw.name ?? 'This community',
        city: raw.city ?? null,
        state: raw.state ?? null,
        pricingPublic,
        careLevels: (raw.careLevels ?? []).map((c) => ({ ...careLevel(c.key ?? c), ...(typeof c === 'object' ? c : {}) })),
        careTiers: raw.careTiers ?? [],
        addOns: raw.addOns ?? [],
        fees: raw.fees ?? {},
        layouts: raw.layouts ?? [],
        legalNote: raw.legalNote ?? null,
        /* When the operator has opted in, the server sends the most recent
           availability confirmation across the community. Null means either
           "switched off" or "never confirmed" — both render as nothing, which
           is the right outcome for each. */
        confirmedAt: raw.confirmedAt ?? null,
    };

    const units = [];
    const buildings = (raw.buildings ?? []).map((b) => {
        const levels = (b.levels ?? []).map((lv) => {
            const levelUnits = (lv.units ?? []).map((u) => {
                const unit = hydrateUnit(u, layouts.get(u.layoutId), b, lv, community);
                units.push(unit);
                return unit;
            });

            const features = (lv.features ?? []).map((f) => ({
                ...f,
                centroid: f.shape ? centroid(f.shape) : null,
                bounds: f.shape ? bounds(f.shape) : null,
            }));

            return {
                id: lv.id,
                name: lv.name ?? `Level ${lv.ordinal ?? ''}`.trim(),
                ordinal: lv.ordinal ?? 0,
                buildingId: b.id,
                plan: lv.plan ?? { image: null, width: 1000, height: 700 },
                features,
                units: levelUnits,
                /*
                 | Pre-computed so fitting the view to a level costs nothing at
                 | render. Features count toward the extent as well as units:
                 | the lift core, the dining room and the garden sit outside the
                 | suites' bounding box, and fitting to units alone crops them
                 | off the edge of the plan.
                 */
                extent: unionBounds([
                    ...levelUnits.map((u) => u.bounds),
                    ...features.map((f) => f.bounds),
                ]) ?? {
                    x: 0, y: 0, width: lv.plan?.width ?? 1000, height: lv.plan?.height ?? 700,
                },
            };
        });

        return {
            id: b.id,
            name: b.name,
            shortName: b.shortName ?? b.name,
            blurb: b.blurb ?? null,
            levels: levels.sort((x, y) => x.ordinal - y.ordinal),
        };
    });

    const levels = buildings.flatMap((b) => b.levels);

    return Object.freeze({
        ...community,
        buildings,
        levels,
        units,
        byId: new Map(units.map((u) => [u.id, u])),
        levelById: new Map(levels.map((l) => [l.id, l])),
        buildingById: new Map(buildings.map((b) => [b.id, b])),
        /* Facets drive the filter UI: only offer a control the data can satisfy. */
        facets: facetsFor(units, community),
    });
}

function hydrateUnit(u, layout, building, level, community) {
    const shape = u.shape ?? [];
    const merged = {
        id: u.id,
        number: u.number ?? String(u.id),
        layoutId: u.layoutId ?? null,

        /* Layout-derived, overridable per unit — a corner suite may be larger
           than the standard version of the same plan. */
        layoutName: layout?.name ?? u.layoutName ?? 'Suite',
        roomType: layout?.roomType ?? u.roomType ?? null,
        typeLabel: layout?.typeLabel ?? u.typeLabel ?? null,
        sqft: u.sqft ?? layout?.sqft ?? null,
        bedrooms: u.bedrooms ?? layout?.bedrooms ?? null,
        bathrooms: u.bathrooms ?? layout?.bathrooms ?? null,
        image: u.image ?? layout?.image3d ?? layout?.image2d ?? null,
        image2d: layout?.image2d ?? null,
        image3d: layout?.image3d ?? null,
        tourUrl: u.tourUrl ?? layout?.tourUrl ?? null,
        description: u.description ?? layout?.description ?? null,

        status: u.status ?? OCCUPIED,
        availableOn: u.availableOn ?? null,
        waitlistCount: u.waitlistCount ?? null,
        respiteNightlyRate: u.respiteNightlyRate ?? null,
        careLevels: u.careLevels ?? (layout?.careLevels ?? []),
        baseRate: u.baseRate ?? layout?.baseRate ?? null,

        accessible: u.accessible ?? false,
        view: u.view ?? null,
        exposure: u.exposure ?? null,
        features: u.features ?? [],
        notes: u.notes ?? null,

        shape,
        bounds: bounds(shape),
        centroid: centroid(shape),
        buildingId: building.id,
        buildingName: building.shortName ?? building.name,
        levelId: level.id,
        levelName: level.name ?? '',
    };

    merged.price = floorPrice(merged);
    merged.headline = headline(merged, community);
    merged.statusMeta = statusFor(merged.status);
    merged.searchText = [merged.number, merged.layoutName, merged.typeLabel, merged.buildingName, merged.levelName, merged.view]
        .filter(Boolean).join(' ').toLowerCase();

    return merged;
}

/**
 * What the data can actually be filtered by. Building a filter bar from this
 * rather than from a hard-coded list means a community with no memory care
 * never shows an empty memory care toggle.
 */
function facetsFor(units, community) {
    const set = (fn) => [...new Set(units.flatMap(fn).filter((v) => v !== null && v !== undefined))];

    const prices = units.map((u) => u.price).filter((p) => Number.isFinite(p));
    const sqfts = units.map((u) => u.sqft).filter((s) => Number.isFinite(s));
    const beds = set((u) => [u.bedrooms]).sort((a, b) => a - b);

    return {
        careLevels: CARE_LEVELS.filter((c) => units.some((u) => u.careLevels.includes(c.key))),
        statuses: set((u) => [u.status]),
        bedrooms: beds,
        roomTypes: set((u) => [u.roomType && { key: u.roomType, label: u.typeLabel ?? u.roomType }])
            .filter(Boolean)
            .filter((v, i, a) => a.findIndex((x) => x.key === v.key) === i),
        views: set((u) => [u.view]).sort(),
        features: set((u) => u.features).sort(),
        hasAccessible: units.some((u) => u.accessible),
        priceRange: prices.length ? { min: Math.min(...prices), max: Math.max(...prices) } : null,
        sqftRange: sqfts.length ? { min: Math.min(...sqfts), max: Math.max(...sqfts) } : null,
        pricingPublic: community.pricingPublic,
    };
}

/** Counts for the headline line — "12 suites available across 3 care levels". */
export function summarize(community, units = community.units) {
    const counts = {};
    for (const u of units) counts[u.status] = (counts[u.status] ?? 0) + 1;
    return {
        total: units.length,
        counts,
        actionable: units.filter((u) => u.statusMeta.weight <= 3).length,
        careLevels: new Set(units.flatMap((u) => u.careLevels)).size,
    };
}
