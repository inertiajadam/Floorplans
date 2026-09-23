<script setup>
/*
 | Demo harness for the operator panels.
 |
 | Stands in for the listing edit page in seniorsplaces-platform. It builds a
 | portalPayload-shaped object from the same Commons on Meridian dataset the public
 | map uses, and implements the `submit` contract against local state instead
 | of Inertia — so the panels are fully drivable (and browser-testable) with no
 | Laravel behind them.
 |
 | The confirmation stamps are spread deliberately across fresh, ageing and
 | stale so the freshness nudge has something to say. In the real app they come
 | from community_map_units.availability_confirmed_at.
 */
import { computed, ref } from 'vue';
import AvailabilityPanel from '../src/operator/AvailabilityPanel.vue';
import PricingPanel from '../src/operator/PricingPanel.vue';
import StructurePanel from '../src/operator/StructurePanel.vue';
import ReconcilePanel from '../src/operator/ReconcilePanel.vue';
import raw from './data/commons-on-meridian.json';

/* ------------------------------------------------------- build the roster */

const daysAgo = (n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString();
};

/* A spread that exercises every freshness bucket, deterministic so the demo
   looks the same on every reload. */
const AGES = [0, 1, 2, 3, 5, 9, 14, 21, 34, 47, 61, 95];

function buildRoster() {
    const layouts = new Map(raw.layouts.map((l) => [l.id, l]));
    const rows = [];
    let i = 0;

    for (const b of raw.buildings) {
        for (const lv of b.levels) {
            for (const u of lv.units) {
                const layout = layouts.get(u.layoutId);
                const age = AGES[i % AGES.length];
                i += 1;

                rows.push({
                    id: i,
                    number: u.number,
                    status: u.status,
                    availableOn: u.availableOn ?? null,
                    waitlistCount: u.waitlistCount ?? null,
                    respiteRate: u.respiteNightlyRate ?? null,
                    baseRate: u.baseRate ?? layout?.baseRate ?? null,
                    ownRate: u.baseRate ?? null,
                    sqft: u.sqft ?? layout?.sqft ?? null,
                    accessible: Boolean(u.accessible),
                    view: u.view ?? null,
                    careLevels: u.careLevels ?? [],
                    layoutId: u.layoutId ?? null,
                    /* One suite deliberately has no layout, to show the
                       "no plan drawing" warning the panel raises. */
                    layoutName: i === 4 ? null : (layout?.name ?? null),
                    building: b.shortName ?? b.name,
                    level: lv.name,
                    levelId: lv.id,
                    confirmedAt: daysAgo(age),
                    lockedFields: [],
                    externalId: null,
                    syncedAt: null,
                });
            }
        }
    }
    return rows;
}

const ACTIONABLE = ['available', 'coming_available', 'respite'];
const units = ref(buildRoster());

const settings = ref({
    community_fee: raw.fees.community,
    second_person_fee: raw.fees.secondPerson,
    pet_deposit: raw.fees.petDeposit,
    add_ons: [...raw.addOns],
    legal_note: raw.legalNote,
    freshness_days: 30,
    show_confirmed_at: true,
    inventory_source: 'manual',
    pms_provider: null,
    last_sync_at: null,
    last_sync_status: null,
    last_sync_message: null,
});

const tiers = ref(raw.careTiers.map((t) => ({ ...t, care_levels: t.careLevels ?? [] })));
const published = ref(true);
const pricingPublic = ref(true);
const syncMode = ref(false);

const buildings = ref(raw.buildings.map((b, bi) => ({
    id: bi + 1,
    name: b.name,
    short: b.shortName,
    blurb: b.blurb,
    levels: b.levels.map((l, li) => ({
        id: `${bi + 1}-${li + 1}`,
        name: l.name,
        ordinal: l.ordinal,
        units: l.units.length,
    })),
})));

/* --------------------------------------------------------- derived payload */

/** Mirrors App\Support\MapInventory::freshness(). */
const freshness = computed(() => {
    const days = settings.value.freshness_days;
    const cutoff = Date.now() - days * 86400000;
    const actionable = units.value.filter((u) => ACTIONABLE.includes(u.status));

    return {
        total: units.value.length,
        actionable: actionable.length,
        stale: actionable.filter((u) => !u.confirmedAt || new Date(u.confirmedAt).getTime() < cutoff).length,
        days,
        confirmedAt: units.value.reduce((max, u) => (u.confirmedAt && u.confirmedAt > max ? u.confirmedAt : max), ''),
    };
});

const map = computed(() => ({
    allowed: true,
    published: published.value,
    live: published.value,
    pricingPublic: pricingPublic.value,
    freshness: freshness.value,
    units: units.value.map((u) => ({
        ...u,
        actionable: ACTIONABLE.includes(u.status),
        stale: !u.confirmedAt || new Date(u.confirmedAt).getTime() < Date.now() - settings.value.freshness_days * 86400000,
    })).sort((a, b) =>
        (b.stale && b.actionable ? 1 : 0) - (a.stale && a.actionable ? 1 : 0)
        || (b.actionable ? 1 : 0) - (a.actionable ? 1 : 0)
        || a.number.localeCompare(b.number, undefined, { numeric: true })),
    buildings: buildings.value,
    layouts: raw.layouts.map((l) => ({ id: l.id, name: l.name, typeLabel: l.typeLabel, sqft: l.sqft, rate: l.baseRate })),
    tiers: tiers.value,
    settings: { ...settings.value, inventory_source: syncMode.value ? 'pms' : 'manual', pms_provider: syncMode.value ? 'PointClickCare' : null, last_sync_at: syncMode.value ? daysAgo(0) : null },
}));

/*
 | A mock reconciliation payload, shaped exactly like
 | App\Support\Inventory\Reconciliation::preview(). Built from the real roster
 | so the pairings are recognisable, and seeded with the three cases that
 | matter: clean matches, an ambiguous one, and rooms on each side the other
 | does not know about.
 */
const reconcile = computed(() => {
    const suites = units.value.slice(0, 14);
    const pairs = suites.slice(0, 10).map((u, i) => ({
        externalId: `PCC-${1000 + i}`,
        feedLabel: i % 4 === 3 ? `${u.number}-A` : u.number,
        feedBuilding: u.building,
        unitId: u.id,
        unitNumber: u.number,
        unitBuilding: u.building,
        unitLevel: u.level,
        score: i === 6 ? 0.93 : 1,
        confidence: i === 6 ? 'low' : 'high',
        ambiguous: i === 6,
        reason: i === 6
            ? 'Exact number, but another suite matches almost as well — check this one'
            : 'Exact number, same building',
    }));

    return {
        provider: 'pointclickcare',
        providerLabel: 'PointClickCare',
        feedCount: 12,
        suiteCount: units.value.length,
        unreadable: 1,
        unknownStatuses: ['AWAITING_DEEP_CLEAN'],
        pairs,
        unmatchedFeed: [
            { externalId: 'PCC-2001', label: 'Annexe Suite 9001', building: 'Annexe', floor: '1' },
            { externalId: 'PCC-2002', label: 'Rm 77', building: null, floor: null },
        ],
        unmatchedSuites: suites.slice(10, 14).map((u) => ({
            unitId: u.id, number: u.number, building: u.building, level: u.level,
        })),
        counts: {
            high: pairs.filter((p) => p.confidence === 'high').length,
            medium: 0,
            low: pairs.filter((p) => p.confidence === 'low').length,
            confirmed: 0,
            unmatchedFeed: 2,
            unmatchedSuites: 4,
        },
    };
});

const log = ref([]);

/* ----------------------------------------------------------- the contract */

/**
 * The `submit` prop the panels call. In the platform this is Inertia's router;
 * here it mutates local state after a short delay so the saving indicators are
 * visible. Throwing rejects, which is how the panels surface an error.
 */
async function submit(action, payload) {
    log.value.unshift({ at: new Date().toLocaleTimeString(), action, payload });
    await new Promise((r) => setTimeout(r, 260));

    const now = new Date().toISOString();
    const find = (id) => units.value.find((u) => u.id === id);

    switch (action) {
        case 'unit.update': {
            const u = find(payload.id);
            if (!u) throw new Error('That suite no longer exists.');
            Object.assign(u, {
                status: payload.status,
                availableOn: payload.available_on,
                waitlistCount: payload.waitlist_count,
                respiteRate: payload.respite_nightly_rate,
                ownRate: payload.base_rate,
                confirmedAt: now,
            });
            break;
        }
        case 'bulk.status': {
            for (const id of payload.ids) {
                const u = find(id);
                if (!u) continue;
                u.status = payload.status;
                if (payload.status !== 'coming_available') u.availableOn = null;
                if (payload.status !== 'waitlist') u.waitlistCount = null;
                if (payload.status !== 'respite') u.respiteRate = null;
                u.confirmedAt = now;
            }
            break;
        }
        case 'confirm.all':
            units.value.forEach((u) => { u.confirmedAt = now; });
            break;
        case 'lock.toggle': {
            const u = find(payload.id);
            if (!u) break;
            u.lockedFields = u.lockedFields.includes(payload.field)
                ? u.lockedFields.filter((f) => f !== payload.field)
                : [...u.lockedFields, payload.field];
            break;
        }
        case 'publish':
            published.value = payload.published;
            break;
        case 'tiers.save':
            tiers.value = payload.tiers.map((t) => ({ ...t }));
            break;
        case 'settings.save':
            Object.assign(settings.value, payload);
            break;
        case 'building.store':
            buildings.value.push({
                id: buildings.value.length + 1,
                name: payload.name,
                short: payload.short_name || payload.name,
                blurb: payload.blurb,
                levels: [{ id: `${buildings.value.length + 1}-1`, name: 'Ground floor', ordinal: 1, units: 0 }],
            });
            break;
        case 'building.destroy':
            buildings.value = buildings.value.filter((b) => b.id !== payload.id);
            break;
        case 'level.store': {
            const b = buildings.value.find((x) => x.id === payload.building_id);
            if (b) b.levels.push({ id: `${b.id}-${b.levels.length + 1}`, name: payload.name, ordinal: payload.ordinal ?? b.levels.length + 1, units: 0 });
            break;
        }
        case 'reconcile.save': {
            const linked = Object.values(payload.links).filter((v) => v !== null && v !== '').length;
            if (linked === 0) throw new Error('Nothing is linked yet, so there would be nothing to sync.');
            break;
        }
        case 'reconcile.refresh':
            break;
        case 'level.import': {
            let parsed;
            try {
                parsed = JSON.parse(payload.geometry);
            } catch {
                throw new Error('That is not valid JSON. Copy the whole export from the plan tracer.');
            }
            if (!Array.isArray(parsed?.units)) throw new Error('That does not look like a plan export.');
            break;
        }
        default:
            throw new Error(`Unknown action ${action}`);
    }
}
</script>

<template>
    <div class="min-h-dvh bg-warm-2 font-sans text-ink">
        <div class="mx-auto max-w-[1080px] px-4 py-6 sm:px-6">
            <header class="mb-5">
                <p class="text-[11px] font-bold uppercase tracking-[1.4px] text-ink-light">Seniors Places · owner portal demo</p>
                <h1 class="mt-1 font-serif text-[30px] font-bold leading-tight sm:text-[34px]">Your community map</h1>
                <p class="mt-1.5 max-w-[64ch] text-[15px] leading-relaxed text-ink-mid">
                    What a community operator sees on their listing edit page. Changing a suite saves straight away.
                    The dataset is the same Commons on Meridian plan the public map uses, with confirmation dates spread
                    across fresh, ageing and stale so the reminder has something to say.
                </p>

                <div class="mt-4 flex flex-wrap gap-4 rounded-card border border-hairline bg-white px-4 py-3">
                    <label class="flex cursor-pointer items-center gap-2 text-[13.5px]">
                        <input v-model="pricingPublic" type="checkbox" class="size-4 rounded accent-[var(--color-brand)]" />
                        Publish rates
                    </label>
                    <label class="flex cursor-pointer items-center gap-2 text-[13.5px]">
                        <input v-model="syncMode" type="checkbox" class="size-4 rounded accent-[var(--color-brand)]" />
                        Inventory syncs from a PMS
                        <span class="text-ink-light">(shows the sync strip and the per-field padlocks)</span>
                    </label>
                </div>
            </header>

            <div class="space-y-5">
                <ReconcilePanel v-if="syncMode" :reconcile="reconcile" :submit="submit" />
                <AvailabilityPanel :map="map" :community-id="1" :submit="submit" />
                <PricingPanel :map="map" :submit="submit" />
                <StructurePanel :map="map" :submit="submit" tracer-url="/editor.html" />
            </div>

            <section v-if="log.length" class="mt-5 rounded-card border border-hairline bg-white p-4">
                <h2 class="font-serif text-[17px] font-bold">What was posted</h2>
                <p class="mt-0.5 text-[13px] text-ink-mid">
                    Each entry is one call to the <code class="rounded bg-warm px-1">submit</code> contract. In the platform
                    these become Inertia posts — see docs/INTEGRATION.md.
                </p>
                <ul class="mt-2 max-h-[240px] space-y-1 overflow-auto font-mono text-[11.5px]">
                    <li v-for="(l, i) in log" :key="i" class="rounded bg-warm px-2 py-1">
                        <span class="text-ink-light">{{ l.at }}</span>
                        <strong class="ml-1.5">{{ l.action }}</strong>
                        <span class="ml-1.5 text-ink-mid">{{ JSON.stringify(l.payload) }}</span>
                    </li>
                </ul>
            </section>
        </div>
    </div>
</template>
