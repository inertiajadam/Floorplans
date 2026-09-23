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
import { describeAge } from '../lib/availability.js';
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
const rail = ref(null);   // the horizontal strip of matching suites

/* Page the strip by most of its width, so the last card seen is still
   visible after the move and nobody loses their place. */
function railBy(direction) {
    const el = rail.value;
    if (!el) return;
    el.scrollBy({ left: direction * Math.max(240, el.clientWidth * 0.8), behavior: 'smooth' });
}

/* Whatever is selected on the plan is brought into view in the strip. */
watch(() => filters.ui.unitId, (id) => {
    if (!id) return;
    nextTick(() => {
        const el = rail.value;
        const card = el?.querySelector(`[data-unit="${CSS.escape(id)}"]`);
        if (!el || !card) return;
        const left = card.offsetLeft - (el.clientWidth - card.offsetWidth) / 2;
        el.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
    });
});

const summary = computed(() => summarize(model.value, filters.results.value));
const confirmedAge = computed(() => describeAge(model.value.confirmedAt));
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

    /* On a desktop the drawer covers the right of the canvas, so centring
       the suite in the full viewBox can park it underneath the panel.
       Stretching the target box rightward by the drawer's share pushes the
       centre right, which lands the suite in the visible left portion. */
    const f = drawerFraction();
    const box = f > 0 && f < 0.9
        ? { ...u.bounds, width: u.bounds.width / (1 - f) }
        : u.bounds;
    view.flyTo(box, { padding: 1.3 });
    emit('select', u);
}

function closeDetail() {
    filters.selectUnit(null, { push: false });
}

/** Picking from the strip: same as picking on the plan, and the plan scrolls
    back into view on a phone so the suite is actually seen. */
function selectFromList(id) {
    select(id);
    if (window.matchMedia('(max-width: 899px)').matches) {
        mapBox.value?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
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
    <div class="community-map">
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

            <!--
              "Availability confirmed 2 days ago."
              Nothing else on a listing page tells a family whether what
              they are reading is current, and a community that keeps on
              top of its roster deserves the credit. Opt-in per community
              (the server sends null when it is switched off), so it is
              never an accidental admission that a map has rotted.
            -->
            <p v-if="confirmedAge" class="inline-flex shrink-0 items-center gap-1.5 self-start rounded-full bg-brand-light px-2.5 py-1 text-[12.5px] font-semibold text-brand-dark">
                <span aria-hidden="true">✓</span>
                Availability confirmed {{ confirmedAge }}
            </p>
        </header>

        <!-- ---------------------------------------------------- filters -->
        <div class="cm-filters-bar">
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
        </div>

        <!-- ------------------------------------------------------- plan -->
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

        <!-- ----------------------------------------------------- suites -->
        <section class="cm-results" aria-label="Matching suites">
            <div class="cm-results-head">
                <h3 class="font-serif text-[18px] font-bold text-ink">
                    {{ filters.results.value.length }} {{ filters.results.value.length === 1 ? 'suite' : 'suites' }}
                    <span class="font-sans text-[14px] font-normal text-ink-mid">{{ filters.active.value ? 'match your filters' : 'across the community' }}</span>
                </h3>
                <div v-if="filters.results.value.length > 1" class="cm-results-nav" role="group" aria-label="Scroll the suites">
                    <button type="button" class="tap-safe" @click="railBy(-1)">
                        <span aria-hidden="true">‹</span><span class="sr-only">Earlier suites</span>
                    </button>
                    <button type="button" class="tap-safe" @click="railBy(1)">
                        <span aria-hidden="true">›</span><span class="sr-only">Later suites</span>
                    </button>
                </div>
            </div>

            <p v-if="!filters.results.value.length" class="rounded-card border border-dashed border-hairline bg-white px-4 py-8 text-center text-[14px] text-ink-mid">
                No suites match what you've asked for.<br />
                <button type="button" class="mt-2 font-semibold text-brand underline" @click="filters.clear()">
                    Clear the filters
                </button>
                and start again, or ask the community what's coming up.
            </p>

            <ul v-else ref="rail" class="cm-rail">
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
        </section>

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
    gap: 0.5rem;
    padding: 1rem;
    background: #fff;
    border-bottom: 1px solid var(--color-hairline);
}

/* ---- filters, on top ---- */
.cm-filters-bar { padding: 0.75rem 1rem 0; }
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
.cm-filters--open { display: block; margin-top: 0.5rem; }

/* ---- the plan ---- */
.cm-map { display: flex; flex-direction: column; min-width: 0; }
.cm-map-controls { padding: 0.75rem 1rem; }

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

.cm-legend { padding: 0.75rem 1rem 0.25rem; }

/* ---- the suites, as a strip under the plan ----
   A horizontal rail: every matching suite side by side, scrolled by touch,
   wheel, the arrow buttons, or Tab (each card is a button, and the browser
   keeps the focused one in view). Cards are a fixed width so the strip
   reads as a row of equals; the selected one is scrolled to the centre. */
.cm-results { padding: 0.75rem 0 1rem; }
.cm-results-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0 1rem 0.625rem;
}
.cm-results-nav { display: flex; gap: 0.375rem; }
.cm-results-nav button {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    font-size: 26px;
    line-height: 1;
    color: var(--color-ink);
    background: #fff;
    border: 1px solid var(--color-hairline);
    border-radius: 999px;
}
.cm-results-nav button:hover { background: var(--color-warm); border-color: var(--color-brand-mid); }
.cm-results > p { margin: 0 1rem; }

.cm-rail {
    display: flex;
    gap: 0.75rem;
    padding: 0.25rem 1rem 0.75rem;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scroll-snap-type: x proximity;
    scroll-padding-inline: 1rem;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: thin;
    scrollbar-color: var(--color-plan-wall) transparent;
}
.cm-rail :deep(li) {
    flex: 0 0 min(300px, 82vw);
    scroll-snap-align: start;
}

/* Desktop: everything gets the full width. */
@media (min-width: 900px) {
    .cm-header { flex-direction: row; align-items: flex-start; justify-content: space-between; padding: 1.25rem 1.5rem; }
    .cm-filters-bar { padding: 1rem 1.5rem 0; }
    .cm-filter-toggle { display: none; }
    .cm-filters { display: block; }
    .cm-map-controls { padding: 1rem 1.5rem 0.75rem; }
    .cm-canvas { aspect-ratio: 16 / 9; min-height: 480px; max-height: 72vh; }
    .cm-legend { padding: 0.75rem 1.5rem 0.25rem; }
    .cm-results-head { padding: 0 1.5rem 0.625rem; }
    .cm-results > p { margin: 0 1.5rem; }
    .cm-rail { padding: 0.25rem 1.5rem 0.75rem; scroll-padding-inline: 1.5rem; }
    .cm-rail :deep(li) { flex-basis: 320px; }
}
</style>