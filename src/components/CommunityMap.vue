<script setup>
/*
 | The interactive community map.
 |
 | This is the only component a host page mounts. Everything else is internal.
 |
 |     <CommunityMap :community="payload" @lead="postToYourCrm" />
 |
 | Layout is two columns on a desktop — controls and results on the left, the
 | plan on the right — and a tabbed single column on a phone. The phone case is
 | not a degraded desktop: more than half of this audience arrives on a phone,
 | usually an adult child, and the list is the better interface there. The map
 | is what you open to answer "but where IS it".
 |
 | The component owns no data of its own. It normalises what it is given once
 | (lib/model.js), derives everything else, and emits when the family wants to
 | talk to somebody. Posting the lead is the host app's job.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';

import MapPatterns from './MapPatterns.vue';
import MapCanvas from './MapCanvas.vue';
import MapLegend from './MapLegend.vue';
import LevelSwitcher from './LevelSwitcher.vue';
import FilterBar from './FilterBar.vue';
import UnitCard from './UnitCard.vue';
import UnitDetail from './UnitDetail.vue';
import CompareTray from './CompareTray.vue';
import LeadForm from './LeadForm.vue';

import { normalize, summarize } from '../lib/model.js';
import { useMapView } from '../composables/useMapView.js';
import { useUnitFilters } from '../composables/useUnitFilters.js';
import { useCompare } from '../composables/useCompare.js';
import { useAnnouncer } from '../composables/useAnnouncer.js';

const props = defineProps({
    /** Raw community document, or one already through normalize(). */
    community: { type: Object, required: true },
    /** false when several maps share a page — only one may own the URL. */
    syncUrl:   { type: Boolean, default: true },
    /** Host sets these while it posts the lead. */
    submitting:{ type: Boolean, default: false },
    leadError: { type: String, default: null },
    leadSent:  { type: Boolean, default: false },
});

const emit = defineEmits(['lead', 'select']);

/* Normalise once. `shallowRef` because the result is frozen and deeply
   reactive proxying of a few thousand points is pure overhead. */
const model = shallowRef(props.community.byId ? props.community : normalize(props.community));
watch(() => props.community, (c) => { model.value = c.byId ? c : normalize(c); });

const view = useMapView();
const filters = useUnitFilters(model.value, { syncUrl: props.syncUrl });
const compare = useCompare(model.value);
const { message: liveMessage, announce } = useAnnouncer();

const canvas = ref(null);
const mapBox = ref(null);
const hoverId = ref(null);
const compareOpen = ref(false);
const leadFor = ref(null);
const leadIntent = ref('tour');
const showFiltersOnPhone = ref(false);

const summary = computed(() => summarize(model.value, filters.results.value));
const totals = computed(() => summarize(model.value));

const headline = computed(() => {
    const n = filters.results.value.length;
    if (!filters.active.value) {
        return `${totals.value.actionable} suite${totals.value.actionable === 1 ? '' : 's'} you can enquire about today`;
    }
    return n === 0 ? 'Nothing matches those filters' : `${n} suite${n === 1 ? '' : 's'} match`;
});

/* ------------------------------------------------------- view management */

/** Keep the viewBox's aspect ratio matched to the box it is drawn in. */
let ro = null;
onMounted(() => {
    fitLevel(filters.level.value, { reset: true });
    if (typeof ResizeObserver !== 'undefined' && mapBox.value) {
        ro = new ResizeObserver(([entry]) => {
            const { width, height } = entry.contentRect;
            if (width > 0 && height > 0) view.setAspect(height / width);
        });
        ro.observe(mapBox.value);
    }
    /* A deep link to a suite should open on that suite, framed. */
    if (filters.selected.value) {
        nextTick(() => view.flyTo(filters.selected.value.bounds, { padding: 1.4, duration: 0 }));
    }
});
onBeforeUnmount(() => ro?.disconnect());

function fitLevel(level, { reset = true } = {}) {
    if (!level) return;
    view.setExtent(level.extent, { reset });
}

watch(() => filters.level.value?.id, () => {
    fitLevel(filters.level.value, { reset: true });
    announce(`${filters.level.value?.name}. ${filters.countsByLevel.value[filters.level.value?.id] ?? 0} suites here match.`);
});

/* Announce result changes, debounced — a slider fires a lot of updates and a
   screen reader reading each one is unusable. */
let announceTimer = null;
watch(() => filters.results.value.length, (n) => {
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => {
        announce(n === 0 ? 'No suites match these filters.' : `${n} suite${n === 1 ? '' : 's'} match.`);
    }, 450);
});
onBeforeUnmount(() => clearTimeout(announceTimer));

/* ------------------------------------------------------------- selection */

/* Matches the .unit-detail width rule below: a 420px-wide panel, capped at 42%. */
function drawerFraction() {
    if (typeof window === 'undefined' || !window.matchMedia('(min-width: 900px)').matches) return 0;
    const w = mapBox.value?.clientWidth ?? 0;
    return w ? Math.min(420, w * 0.42) / w : 0;
}

function select(id) {
    filters.selectUnit(id);
    const u = filters.selected.value;
    if (!u) return;

    if (filters.ui.mode === 'map') {
        /* On a desktop the drawer covers the right of the canvas, so centring
           the suite in the full viewBox can park it underneath the panel.
           Stretching the target box rightward by the drawer's share pushes the
           centre right, which lands the suite in the visible left portion. */
        const f = drawerFraction();
        const box = f > 0 && f < 0.9
            ? { ...u.bounds, width: u.bounds.width / (1 - f) }
            : u.bounds;
        view.flyTo(box, { padding: 1.3 });
    }
    emit('select', u);
}

function closeDetail() {
    filters.selectUnit(null, { push: false });
}

/** Picking from the list on a phone should show it on the plan, not just open the drawer. */
function selectFromList(id) {
    select(id);
    if (window.matchMedia('(max-width: 899px)').matches) filters.ui.mode = 'map';
}

function onCompare(id) {
    const unit = model.value.byId.get(id);
    const result = compare.toggle(id);
    if (result === 'full') {
        announce(`You can compare up to ${compare.max} suites. Remove one first.`);
        return;
    }
    announce(result === 'added'
        ? `Suite ${unit.number} added to compare. ${compare.ids.value.length} of ${compare.max}.`
        : `Suite ${unit.number} removed from compare.`);
    if (result === 'added' && compare.ids.value.length >= 2) compareOpen.value = true;
}

function openLead(unit, intent = 'tour') {
    leadIntent.value = unit?.statusMeta?.selectable && unit.status === 'available' ? 'tour' : intent;
    leadFor.value = unit;
}

function onLeadSubmit(payload) {
    emit('lead', payload);
}

function closeLead() {
    leadFor.value = null;
}

/* ---------------------------------------------------------------- toolbar */

function resetView() {
    fitLevel(filters.level.value, { reset: true });
    announce('View reset to the whole floor.');
}
</script>

<template>
    <div class="community-map" :class="{ 'community-map--list': filters.ui.mode === 'list' }">
        <MapPatterns />

        <!-- one live region for the whole component -->
        <p class="sr-only" role="status" aria-live="polite">{{ liveMessage }}</p>

        <!-- ----------------------------------------------------- header -->
        <header class="cm-header">
            <div class="min-w-0">
                <h2 class="font-serif text-[24px] font-bold leading-tight text-ink">
                    Availability at {{ model.name }}
                </h2>
                <p class="mt-0.5 text-[14px] text-ink-mid">
                    {{ headline }}
                    <span v-if="totals.careLevels > 1" class="text-ink-light">
                        · {{ totals.careLevels }} levels of care
                    </span>
                </p>
            </div>

            <!-- map / list, on phones only: both are first-class -->
            <div class="cm-modes" role="group" aria-label="How to browse">
                <button
                    v-for="m in [{ k: 'map', l: 'Map' }, { k: 'list', l: 'List' }]"
                    :key="m.k"
                    type="button"
                    class="tap-safe flex-1 rounded-brand px-4 py-2 text-[14px] transition-colors"
                    :class="filters.ui.mode === m.k ? 'bg-brand-dark text-white font-semibold' : 'text-ink-mid hover:bg-warm'"
                    :aria-pressed="String(filters.ui.mode === m.k)"
                    @click="filters.ui.mode = m.k"
                >{{ m.l }}</button>
            </div>
        </header>

        <!-- ------------------------------------------------------- body -->
        <div class="cm-body">
            <!-- left: controls + results -->
            <aside class="cm-side" aria-label="Filters and matching suites">
                <button
                    type="button"
                    class="cm-filter-toggle tap-safe"
                    :aria-expanded="String(showFiltersOnPhone)"
                    aria-controls="cm-filters"
                    @click="showFiltersOnPhone = !showFiltersOnPhone"
                >
                    {{ showFiltersOnPhone ? 'Hide filters' : 'Filters' }}
                    <span v-if="filters.active.value" class="ml-1.5 rounded-full bg-brand px-2 py-0.5 text-[11.5px] font-bold text-white">on</span>
                </button>

                <div id="cm-filters" class="cm-filters" :class="{ 'cm-filters--open': showFiltersOnPhone }">
                    <FilterBar
                        :facets="model.facets"
                        :filters="filters.filters"
                        :active="filters.active.value"
                        :result-count="filters.results.value.length"
                        @toggle="(k, v) => filters.toggle(k, v)"
                        @clear="filters.clear(); announce('Filters cleared.')"
                    />
                </div>

                <!-- results -->
                <div class="cm-results">
                    <h3 class="sr-only">Matching suites</h3>

                    <p v-if="!filters.results.value.length" class="rounded-card border border-dashed border-hairline bg-white px-4 py-8 text-center text-[14px] text-ink-mid">
                        No suites match what you've asked for.<br />
                        <button type="button" class="mt-2 font-semibold text-brand underline" @click="filters.clear()">
                            Clear the filters
                        </button>
                        and start again, or ask the community what's coming up.
                    </p>

                    <ul v-else class="flex flex-col gap-2.5">
                        <UnitCard
                            v-for="u in filters.results.value"
                            :key="u.id"
                            :unit="u"
                            :selected="u.id === filters.ui.unitId"
                            :comparing="compare.has(u.id)"
                            :compare-disabled="compare.isFull.value"
                            @select="selectFromList"
                            @compare="onCompare"
                            @hover="hoverId = $event"
                        />
                    </ul>
                </div>
            </aside>

            <!-- right: the plan -->
            <section class="cm-map" aria-label="Floor plan">
                <div class="cm-map-controls">
                    <LevelSwitcher
                        :buildings="model.buildings"
                        :level-id="filters.ui.levelId"
                        :counts="filters.countsByLevel.value"
                        :filtered="filters.active.value"
                        @open="filters.openLevel($event)"
                    />
                </div>

                <div ref="mapBox" class="cm-canvas">
                    <MapCanvas
                        ref="canvas"
                        :level="filters.level.value"
                        :units="filters.levelUnits.value"
                        :selected-id="filters.ui.unitId"
                        :compare-ids="compare.ids.value"
                        :view="view"
                        @select="select"
                        @hover="hoverId = $event"
                        @announce="announce"
                    />

                    <!-- zoom, as real buttons. Pinch is lovely; a button is reliable. -->
                    <div class="cm-zoom" role="group" aria-label="Zoom">
                        <button type="button" class="tap-safe" :disabled="!view.canZoomIn.value" @click="view.zoomIn()">
                            <span aria-hidden="true">＋</span><span class="sr-only">Zoom in</span>
                        </button>
                        <button type="button" class="tap-safe" :disabled="!view.canZoomOut.value" @click="view.zoomOut()">
                            <span aria-hidden="true">－</span><span class="sr-only">Zoom out</span>
                        </button>
                        <button type="button" class="tap-safe" @click="resetView">
                            <span aria-hidden="true">⤢</span><span class="sr-only">Fit the whole floor</span>
                        </button>
                    </div>

                    <p class="cm-hint">
                        Drag to move · pinch or scroll to zoom · tap a suite for details
                    </p>

                    <UnitDetail
                        :unit="filters.selected.value"
                        :community="model"
                        :comparing="filters.ui.unitId ? compare.has(filters.ui.unitId) : false"
                        :compare-disabled="compare.isFull.value"
                        :share-url="filters.shareUrl()"
                        @close="closeDetail"
                        @compare="onCompare"
                        @enquire="openLead($event, 'tour')"
                    />
                </div>

                <div class="cm-legend">
                    <MapLegend
                        :units="filters.levelUnits.value"
                        :selected="filters.filters.status"
                        @toggle="filters.toggle('status', $event)"
                    />
                </div>
            </section>
        </div>

        <!-- ---------------------------------------------------- compare -->
        <CompareTray
            :units="compare.units.value"
            :community="model"
            :open="compareOpen"
            @toggle="compareOpen = !compareOpen"
            @remove="compare.remove($event)"
            @clear="compare.clear(); compareOpen = false"
            @select="select"
            @enquire="openLead($event, 'tour')"
        />

        <LeadForm
            :unit="leadFor"
            :community="model"
            :intent="leadIntent"
            :submitting="submitting"
            :error="leadError"
            :sent="leadSent"
            @close="closeLead"
            @submit="onLeadSubmit"
        />
    </div>
</template>

<style scoped>
.community-map {
    display: flex;
    flex-direction: column;
    background: var(--color-warm);
    border: 1px solid var(--color-hairline);
    border-radius: var(--radius-card);
    overflow: hidden;
}

.cm-header {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1rem;
    background: #fff;
    border-bottom: 1px solid var(--color-hairline);
}

.cm-modes {
    display: flex;
    gap: 0.25rem;
    padding: 0.25rem;
    background: var(--color-warm);
    border-radius: var(--radius-brand);
}

.cm-body { display: flex; flex-direction: column; }

.cm-side {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1rem;
    min-width: 0;
}

.cm-filter-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    padding: 0.625rem 1rem;
    font-size: 14px;
    font-weight: 600;
    color: var(--color-ink);
    background: #fff;
    border: 1px solid var(--color-hairline);
    border-radius: var(--radius-brand);
}

.cm-filters { display: none; }
.cm-filters--open { display: block; }

.cm-results { min-width: 0; }

.cm-map { display: flex; flex-direction: column; min-width: 0; }
.cm-map-controls { padding: 0 1rem 0.75rem; }

.cm-canvas {
    position: relative;
    aspect-ratio: 4 / 3;
    background: var(--color-warm);
    border-top: 1px solid var(--color-hairline);
    border-bottom: 1px solid var(--color-hairline);
    overflow: hidden;
}

.cm-zoom {
    position: absolute;
    top: 0.75rem;
    right: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 1px;
    background: var(--color-hairline);
    border: 1px solid var(--color-hairline);
    border-radius: var(--radius-brand);
    overflow: hidden;
    box-shadow: 0 2px 10px rgba(31, 42, 51, 0.12);
}
.cm-zoom button {
    display: grid;
    place-items: center;
    background: #fff;
    font-size: 17px;
    line-height: 1;
    color: var(--color-ink);
}
.cm-zoom button:hover:not(:disabled) { background: var(--color-warm); }
.cm-zoom button:disabled { color: var(--color-ink-light); opacity: 0.45; cursor: default; }

.cm-hint {
    position: absolute;
    left: 0.75rem;
    bottom: 0.75rem;
    padding: 0.3rem 0.6rem;
    font-size: 11.5px;
    color: var(--color-ink-mid);
    background: rgba(255, 255, 255, 0.92);
    border-radius: 999px;
    pointer-events: none;
}
/* The hint is for pointer users; it just clutters a small screen. */
@media (max-width: 640px) { .cm-hint { display: none; } }

.cm-legend { padding: 0.75rem 1rem 1rem; }

/* On a phone the two modes are exclusive. */
@media (max-width: 899px) {
    .community-map:not(.community-map--list) .cm-results { display: none; }
    .community-map--list .cm-map { display: none; }
}

/* Desktop: side by side, both always visible, so the modes stop mattering. */
@media (min-width: 900px) {
    .cm-header { flex-direction: row; align-items: flex-start; justify-content: space-between; padding: 1.25rem 1.5rem; }
    .cm-modes { display: none; }

    .cm-body { flex-direction: row; align-items: stretch; }

    .cm-side {
        width: 380px;
        flex: 0 0 380px;
        border-right: 1px solid var(--color-hairline);
        max-height: 78vh;
        overflow-y: auto;
        overscroll-behavior: contain;
    }
    .cm-filter-toggle { display: none; }
    .cm-filters { display: block; }

    .cm-map { flex: 1 1 auto; }
    .cm-map-controls { padding: 1rem 1.25rem 0.75rem; }
    .cm-canvas { aspect-ratio: auto; flex: 1 1 auto; min-height: 520px; }
    .cm-legend { padding: 0.75rem 1.25rem 1rem; }
}
</style>
