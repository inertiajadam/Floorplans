<script setup>
/*
 | The floor plan itself.
 |
 | One SVG, one viewBox, one <g> per layer. Units are real polygons, so an
 | L-shaped corner suite has an L-shaped hit area — the thing iframe maps with
 | rectangular hotspots get wrong and nobody can explain to a confused family.
 |
 | Three things here are deliberate and worth not undoing:
 |
 | 1. Every status has a HATCH PATTERN as well as a colour. Around 1 in 12 men
 |    are colour blind, contrast sensitivity drops with age, and this audience
 |    is mostly over seventy or looking over a parent's shoulder. A map that
 |    says "green means available" and nothing else fails a lot of people.
 |
 | 2. Keyboard navigation is SPATIAL, not tab order. Arrow keys move to the
 |    nearest suite in that direction, which is what someone means when they
 |    press Right on a floor plan. Sixty tab stops in DOM order would be
 |    technically accessible and practically useless.
 |
 | 3. Labels and strokes are scaled by the inverse of the zoom, so a suite
 |    number stays legible at every zoom level instead of growing into a
 |    billboard.
 */

import { computed, nextTick, ref, watch } from 'vue';
import { toPointsAttr } from '../lib/geometry.js';
import { OCCUPIED, statusDetail } from '../lib/availability.js';
import { money } from '../lib/pricing.js';

const props = defineProps({
    level:     { type: Object, required: true },   // normalised level
    units:     { type: Array, required: true },    // [{ unit, matches }]
    selectedId:{ type: String, default: null },
    compareIds:{ type: Array, default: () => [] },
    view:      { type: Object, required: true },   // useMapView()
    dimUnmatched: { type: Boolean, default: true },
});

const emit = defineEmits(['select', 'hover', 'announce']);

const hoverId = ref(null);
const focusId = ref(null);
const svgRef = ref(null);

/* Roving tabindex: exactly one suite is in the tab order at a time. */
const tabTarget = computed(() => focusId.value ?? props.selectedId ?? selectable.value[0]?.unit.id ?? null);
const selectable = computed(() => props.units.filter((r) => r.unit.statusMeta.selectable));

const planWidth = computed(() => props.level.plan?.width ?? 1000);
const planHeight = computed(() => props.level.plan?.height ?? 700);

/* One stroke width in world units that renders as ~1.5 screen px at any zoom. */
const hair = computed(() => 1.5 * props.view.inverseScale.value);
const labelSize = computed(() => {
    /* Clamped so labels never get smaller than readable or larger than silly. */
    const s = 15 * props.view.inverseScale.value;
    return Math.max(8, Math.min(s, 34));
});
const showLabels = computed(() => props.view.zoom.value > 1.25 || props.units.length <= 20);
const showDetail = computed(() => props.view.zoom.value > 2.4);

function pts(shape) {
    return toPointsAttr(shape);
}

function unitClass(rec) {
    const { unit, matches } = rec;
    const dim = props.dimUnmatched && !matches;
    return [
        'unit',
        `unit--${unit.status}`,
        dim ? 'unit--dim' : '',
        unit.id === props.selectedId ? 'unit--selected' : '',
        unit.id === hoverId.value ? 'unit--hover' : '',
        unit.statusMeta.selectable ? 'unit--live' : 'unit--static',
    ].filter(Boolean).join(' ');
}

/** What a screen reader reads for one suite. Everything a sighted user gets from the fill. */
function label(unit) {
    const bits = [
        `Suite ${unit.number}`,
        unit.layoutName,
        unit.typeLabel,
        unit.sqft ? `${unit.sqft} square feet` : null,
        unit.statusMeta.label,
        statusDetail(unit),
        unit.price ? `from ${money(unit.price)} a month` : null,
        unit.accessible ? 'step-free, roll-in shower' : null,
    ].filter(Boolean);
    return bits.join('. ') + '.';
}

/* ------------------------------------------------------------- selection */

function onActivate(unit) {
    if (!unit.statusMeta.selectable) return;
    emit('select', unit.id);
}

function onEnter(unit) {
    hoverId.value = unit.id;
    emit('hover', unit.id);
}

function onLeave() {
    hoverId.value = null;
    emit('hover', null);
}

/* ------------------------------------------------- spatial keyboard nav */

/**
 * Nearest selectable suite in a compass direction from `from`.
 * Scores by distance along the axis plus a penalty for drifting off it, so
 * pressing Right from a suite goes to the one beside it rather than the one
 * diagonally across the corridor.
 */
function neighbour(from, dir) {
    const origin = from.centroid;
    let best = null;
    let bestScore = Infinity;

    for (const { unit } of selectable.value) {
        if (unit.id === from.id) continue;
        const dx = unit.centroid.x - origin.x;
        const dy = unit.centroid.y - origin.y;

        const along = dir === 'right' ? dx : dir === 'left' ? -dx : dir === 'down' ? dy : -dy;
        if (along <= 1) continue;                       // wrong side
        const off = Math.abs(dir === 'left' || dir === 'right' ? dy : dx);
        if (off > along * 2.4) continue;                // too far off-axis to be "that way"

        const score = along + off * 1.8;
        if (score < bestScore) { bestScore = score; best = unit; }
    }
    return best;
}

async function focusUnit(unit) {
    if (!unit) return;
    focusId.value = unit.id;
    await nextTick();
    svgRef.value?.querySelector(`[data-unit="${CSS.escape(unit.id)}"]`)?.focus({ preventScroll: true });
    /* Keep the focused suite on screen without yanking the view around. */
    if (!inView(unit)) props.view.flyTo(unit.bounds, { padding: 1.6, duration: 260 });
    emit('announce', label(unit));
}

function inView(unit) {
    const v = props.view.view.value;
    const b = unit.bounds;
    return b.x >= v.x && b.y >= v.y && b.x + b.width <= v.x + v.width && b.y + b.height <= v.y + v.height;
}

function onKeydown(e, unit) {
    const dirs = { ArrowRight: 'right', ArrowLeft: 'left', ArrowDown: 'down', ArrowUp: 'up' };

    if (dirs[e.key]) {
        /* Shift+arrow pans the map instead of moving between suites — the
           escape hatch for someone who wants to look around, not choose. */
        if (e.shiftKey) {
            e.preventDefault();
            const d = dirs[e.key];
            props.view.panBy(d === 'right' ? 0.2 : d === 'left' ? -0.2 : 0, d === 'down' ? 0.2 : d === 'up' ? -0.2 : 0);
            return;
        }
        const next = neighbour(unit, dirs[e.key]);
        if (next) { e.preventDefault(); focusUnit(next); }
        return;
    }

    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        onActivate(unit);
        return;
    }
    if (e.key === 'Home') { e.preventDefault(); focusUnit(selectable.value[0]?.unit); return; }
    if (e.key === 'End')  { e.preventDefault(); focusUnit(selectable.value.at(-1)?.unit); return; }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); props.view.zoomIn(); return; }
    if (e.key === '-' || e.key === '_') { e.preventDefault(); props.view.zoomOut(); }
}

/* Moving to another level invalidates the focused suite. */
watch(() => props.level.id, () => { focusId.value = null; hoverId.value = null; });

defineExpose({ focusUnit });
</script>

<template>
    <svg
        :ref="(el) => { svgRef = el; view.svgEl.value = el; }"
        class="map-canvas"
        :class="{ 'map-canvas--panning': view.isPanning.value }"
        :viewBox="view.viewBox.value"
        preserveAspectRatio="xMidYMid meet"
        role="group"
        :aria-label="`Floor plan: ${level.name}. ${selectable.length} suites you can select. Use the arrow keys to move between suites, Enter to open one.`"
        v-on="view.handlers"
    >
        <!-- Hatch patterns live in MapPatterns.vue, mounted once by CommunityMap. -->

        <!-- 1. the plan drawing, when the community has supplied one -->
        <image
            v-if="level.plan?.image"
            :href="level.plan.image"
            x="0" y="0" :width="planWidth" :height="planHeight"
            preserveAspectRatio="xMidYMid meet"
            opacity="0.92"
        />

        <!-- 2. the building itself: corridors, shared rooms, gardens -->
        <g class="features" aria-hidden="true">
            <template v-for="f in level.features" :key="f.id">
                <polygon :points="pts(f.shape)" :class="`feature feature--${f.kind}`" :stroke-width="hair" />
                <text
                    v-if="f.label && showLabels"
                    :x="f.centroid.x" :y="f.centroid.y"
                    class="feature-label"
                    :font-size="labelSize * 0.82"
                    text-anchor="middle" dominant-baseline="middle"
                >{{ f.label }}</text>
            </template>
        </g>

        <!-- 3. the suites -->
        <g class="units">
            <g
                v-for="rec in units"
                :key="rec.unit.id"
                :data-unit="rec.unit.id"
                :class="unitClass(rec)"
                :tabindex="rec.unit.statusMeta.selectable ? (rec.unit.id === tabTarget ? 0 : -1) : -1"
                :role="rec.unit.statusMeta.selectable ? 'button' : 'img'"
                :aria-label="label(rec.unit)"
                :aria-pressed="rec.unit.statusMeta.selectable ? String(rec.unit.id === selectedId) : undefined"
                @click="onActivate(rec.unit)"
                @mouseenter="onEnter(rec.unit)"
                @mouseleave="onLeave"
                @focus="focusId = rec.unit.id"
                @keydown="onKeydown($event, rec.unit)"
            >
                <!-- solid tint first, hatch over it: the hatch reads at any zoom -->
                <polygon :points="pts(rec.unit.shape)" class="unit__fill" />
                <polygon
                    v-if="rec.unit.status !== OCCUPIED"
                    :points="pts(rec.unit.shape)"
                    class="unit__hatch"
                    :fill="`url(#hatch-${rec.unit.status})`"
                />
                <polygon :points="pts(rec.unit.shape)" class="unit__stroke" :stroke-width="hair * 1.6" />

                <!-- selection ring, drawn inside so it never overlaps a neighbour -->
                <polygon
                    v-if="rec.unit.id === selectedId"
                    :points="pts(rec.unit.shape)"
                    class="unit__ring"
                    :stroke-width="hair * 3.4"
                />

                <!-- in the compare tray -->
                <circle
                    v-if="compareIds.includes(rec.unit.id)"
                    :cx="rec.unit.centroid.x"
                    :cy="rec.unit.centroid.y - labelSize * 1.15"
                    :r="labelSize * 0.34"
                    class="unit__compare"
                />

                <g v-if="showLabels" class="unit__label" aria-hidden="true">
                    <text
                        :x="rec.unit.centroid.x" :y="rec.unit.centroid.y"
                        :font-size="labelSize"
                        text-anchor="middle" dominant-baseline="middle"
                    >{{ rec.unit.number }}</text>
                    <text
                        v-if="showDetail && rec.unit.price && rec.matches"
                        :x="rec.unit.centroid.x" :y="rec.unit.centroid.y + labelSize * 1.05"
                        :font-size="labelSize * 0.74"
                        class="unit__label-price"
                        text-anchor="middle" dominant-baseline="middle"
                    >{{ money(rec.unit.price) }}</text>
                    <text
                        v-if="showDetail && rec.unit.accessible"
                        :x="rec.unit.centroid.x" :y="rec.unit.centroid.y - labelSize * 1.0"
                        :font-size="labelSize * 0.8"
                        class="unit__label-ada"
                        text-anchor="middle" dominant-baseline="middle"
                    >♿</text>
                </g>
            </g>
        </g>
    </svg>
</template>

<style scoped>
.map-canvas {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;              /* we handle pinch and drag ourselves */
    background: var(--color-warm);
    cursor: grab;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
}
.map-canvas--panning { cursor: grabbing; }

/* ---- the building ---- */
.feature { stroke: var(--color-plan-wall); }
.feature--corridor { fill: var(--color-plan-corridor); }
.feature--amenity  { fill: var(--color-plan-amenity); }
.feature--outdoor  { fill: var(--color-plan-outdoor); }
.feature--staff    { fill: var(--color-plan-staff); }
.feature--vertical { fill: var(--color-plan-staff); }
/* Site plans: the ground the building sits on. No hairline on the ground
   itself, or the whole map gets an outline. */
.feature--lawn     { fill: var(--color-plan-lawn); stroke: none; }
.feature--road     { fill: var(--color-plan-road); stroke: none; }
.feature--parking  { fill: var(--color-plan-parking); stroke: none; }
.feature--building { fill: var(--color-plan-building); }
.feature-label {
    fill: var(--color-ink-light);
    font-family: var(--font-sans);
    font-weight: 600;
    letter-spacing: 0.02em;
    pointer-events: none;
}

/* ---- suites ---- */
.unit { outline: none; }
.unit--live { cursor: pointer; }
.unit--static { cursor: default; }

.unit__fill, .unit__hatch, .unit__stroke, .unit__ring { transition: opacity 140ms ease, fill 140ms ease; }
.unit__hatch { pointer-events: none; }
.unit__stroke { fill: none; stroke: var(--color-plan-wall); pointer-events: none; }
.unit__ring { fill: none; stroke: var(--color-brand-dark); pointer-events: none; }
.unit__compare { fill: var(--color-brand-dark); stroke: #fff; stroke-width: 1.5; pointer-events: none; }

.unit--available        .unit__fill { fill: var(--color-status-available-fill); }
.unit--coming_available .unit__fill { fill: var(--color-status-coming-fill); }
.unit--waitlist         .unit__fill { fill: var(--color-status-waitlist-fill); }
.unit--respite          .unit__fill { fill: var(--color-status-respite-fill); }
.unit--held             .unit__fill { fill: var(--color-status-held-fill); }
.unit--model            .unit__fill { fill: var(--color-status-model-fill); }
.unit--occupied         .unit__fill { fill: var(--color-status-occupied-fill); }

.unit--available        .unit__stroke { stroke: var(--color-status-available); }
.unit--coming_available .unit__stroke { stroke: var(--color-status-coming); }
.unit--waitlist         .unit__stroke { stroke: var(--color-status-waitlist); }
.unit--respite          .unit__stroke { stroke: var(--color-status-respite); }
.unit--held             .unit__stroke { stroke: var(--color-status-held); }
.unit--model            .unit__stroke { stroke: var(--color-status-model); }

/* Filtered out: faded, but still drawn. Seeing that the suite you want is
   next to the lift is worth more than a tidy map. */
.unit--dim .unit__fill  { fill: var(--color-status-occupied-fill); }
.unit--dim .unit__hatch { opacity: 0.12; }
.unit--dim .unit__label { opacity: 0.45; }
.unit--dim .unit__stroke { stroke: var(--color-plan-wall); }

.unit--hover:not(.unit--dim) .unit__fill,
.unit--live:hover:not(.unit--dim) .unit__fill { filter: brightness(0.94); }

.unit__label text {
    fill: var(--color-ink);
    font-family: var(--font-sans);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
    paint-order: stroke fill;
    stroke: rgba(255, 255, 255, 0.85);
    stroke-width: 3px;
    stroke-linejoin: round;
}
.unit__label-price { fill: var(--color-ink-mid); font-weight: 600; }
.unit__label-ada { stroke-width: 2px; }

/* Windows High Contrast / forced colours: patterns and tints are stripped by
   the OS, so fall back to border weight, which survives. */
@media (forced-colors: active) {
    .unit__stroke { stroke: CanvasText; }
    .unit--dim .unit__stroke { stroke: GrayText; }
    .unit__ring { stroke: Highlight; }
}
</style>
