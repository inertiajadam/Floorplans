<script setup>
/*
 | Plan tracing tool.
 |
 | The reason this exists: with a hosted map vendor, changing a floor plan is a
 | support ticket. A community splits a two-bedroom into two studios, or
 | renumbers a wing, and the map is wrong for a fortnight. This tool makes
 | geometry something the Seniors Places team owns — trace a plan once, export
 | the JSON, paste it into the community's map document, done.
 |
 | It is an internal staff tool, not a family-facing one, so it optimises for
 | speed over hand-holding: click to drop points, Enter or double-click to
 | close a shape, drag a vertex to nudge it, and the sidebar fills in the
 | details. Undo is a real stack because tracing forty suites without one is
 | miserable.
 |
 | Output is exactly the `level` shape that lib/model.js consumes, so there is
 | no conversion step and no second schema to keep in sync.
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { toPointsAttr, centroid, area } from '../src/lib/geometry.js';
import { STATUS_ORDER, STATUSES } from '../src/lib/availability.js';
import { CARE_LEVELS } from '../src/lib/model.js';

/* --------------------------------------------------------------- state */

const image = ref(null);          // data URL or remote URL of the plan drawing
const imageSize = ref({ width: 1200, height: 800 });
const levelName = ref('Ground floor');
const levelId = ref('level-1');
const ordinal = ref(1);

const shapes = ref([]);           // committed units
const draft = ref([]);            // the polygon being drawn, flat [x,y,...]
const selectedIndex = ref(null);
const mode = ref('draw');         // draw | edit
const snap = ref(true);
const gridSize = ref(10);

const svgRef = ref(null);
const dragging = shallowRef(null); // { shapeIndex, pointIndex }
const undoStack = ref([]);

const selected = computed(() => (selectedIndex.value === null ? null : shapes.value[selectedIndex.value]));
const viewBox = computed(() => `0 0 ${imageSize.value.width} ${imageSize.value.height}`);

/* --------------------------------------------------------------- history */

function pushUndo() {
    undoStack.value.push(JSON.stringify({ shapes: shapes.value, draft: draft.value }));
    if (undoStack.value.length > 60) undoStack.value.shift();
}

function undo() {
    const prev = undoStack.value.pop();
    if (!prev) return;
    const parsed = JSON.parse(prev);
    shapes.value = parsed.shapes;
    draft.value = parsed.draft;
    if (selectedIndex.value !== null && selectedIndex.value >= shapes.value.length) selectedIndex.value = null;
}

/* ----------------------------------------------------------- the picture */

function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        const img = new Image();
        img.onload = () => {
            /* The image's natural pixels ARE the coordinate space. Everything
               downstream is in these units, which keeps the exported geometry
               meaningful even if the image is later served at another size. */
            imageSize.value = { width: img.naturalWidth, height: img.naturalHeight };
            image.value = reader.result;
        };
        img.src = reader.result;
    };
    reader.readAsDataURL(file);
}

/* --------------------------------------------------------------- drawing */

function toWorld(e) {
    const el = svgRef.value;
    const rect = el.getBoundingClientRect();
    const sx = imageSize.value.width / rect.width;
    const sy = imageSize.value.height / rect.height;
    let x = (e.clientX - rect.left) * sx;
    let y = (e.clientY - rect.top) * sy;
    if (snap.value) {
        x = Math.round(x / gridSize.value) * gridSize.value;
        y = Math.round(y / gridSize.value) * gridSize.value;
    }
    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
}

function onCanvasClick(e) {
    if (mode.value !== 'draw' || dragging.value) return;
    const { x, y } = toWorld(e);
    pushUndo();
    draft.value.push(x, y);
}

function closeShape() {
    if (draft.value.length < 6) return;      // a polygon needs three points
    pushUndo();
    const n = shapes.value.length + 1;
    shapes.value.push({
        id: `u-${Date.now().toString(36)}-${n}`,
        number: String(100 + n),
        layoutId: '',
        shape: [...draft.value],
        status: 'available',
        careLevels: ['al'],
        baseRate: null,
        sqft: null,
        accessible: false,
        view: '',
    });
    draft.value = [];
    selectedIndex.value = shapes.value.length - 1;
    mode.value = 'edit';
}

function cancelDraft() {
    if (!draft.value.length) return;
    pushUndo();
    draft.value = [];
}

/** A rectangle is most of a floor plan; give it a one-click path. */
function addRectangle() {
    pushUndo();
    const w = imageSize.value.width;
    const h = imageSize.value.height;
    const size = Math.min(w, h) * 0.18;
    const x = w / 2 - size / 2;
    const y = h / 2 - size / 2;
    const n = shapes.value.length + 1;
    shapes.value.push({
        id: `u-${Date.now().toString(36)}-${n}`,
        number: String(100 + n),
        layoutId: '',
        shape: [x, y, x + size, y, x + size, y + size * 0.8, x, y + size * 0.8],
        status: 'available',
        careLevels: ['al'],
        baseRate: null, sqft: null, accessible: false, view: '',
    });
    selectedIndex.value = shapes.value.length - 1;
    mode.value = 'edit';
}

/* ---------------------------------------------------------- vertex drag */

function onVertexDown(e, shapeIndex, pointIndex) {
    e.stopPropagation();
    pushUndo();
    dragging.value = { shapeIndex, pointIndex };
    selectedIndex.value = shapeIndex;
    window.addEventListener('pointermove', onVertexMove);
    window.addEventListener('pointerup', onVertexUp, { once: true });
}

function onVertexMove(e) {
    const d = dragging.value;
    if (!d) return;
    const { x, y } = toWorld(e);
    const shape = shapes.value[d.shapeIndex].shape;
    shape[d.pointIndex * 2] = x;
    shape[d.pointIndex * 2 + 1] = y;
}

function onVertexUp() {
    dragging.value = null;
    window.removeEventListener('pointermove', onVertexMove);
}

function deleteVertex(shapeIndex, pointIndex) {
    const shape = shapes.value[shapeIndex].shape;
    if (shape.length <= 6) return;        // never below a triangle
    pushUndo();
    shape.splice(pointIndex * 2, 2);
}

/** Insert a point at the midpoint of an edge — how you turn a box into an L. */
function splitEdge(shapeIndex, edgeIndex) {
    pushUndo();
    const shape = shapes.value[shapeIndex].shape;
    const n = shape.length / 2;
    const a = edgeIndex;
    const b = (edgeIndex + 1) % n;
    const mx = (shape[a * 2] + shape[b * 2]) / 2;
    const my = (shape[a * 2 + 1] + shape[b * 2 + 1]) / 2;
    shape.splice((a + 1) * 2, 0, mx, my);
}

function removeShape(i) {
    pushUndo();
    shapes.value.splice(i, 1);
    selectedIndex.value = null;
}

function duplicateShape(i) {
    pushUndo();
    const src = shapes.value[i];
    const offset = 24;
    const moved = src.shape.map((v, k) => (k % 2 === 0 ? v + offset : v + offset));
    shapes.value.splice(i + 1, 0, {
        ...src,
        id: `u-${Date.now().toString(36)}-${shapes.value.length + 1}`,
        number: String(Number(src.number) + 1 || ''),
        shape: moved,
    });
    selectedIndex.value = i + 1;
}

/* ------------------------------------------------------------ keyboard */

function onKey(e) {
    if (e.target.matches('input, textarea, select')) return;

    if (e.key === 'Enter') { e.preventDefault(); closeShape(); }
    else if (e.key === 'Escape') { cancelDraft(); selectedIndex.value = null; }
    else if ((e.key === 'z' || e.key === 'Z') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); undo(); }
    else if (e.key === 'Backspace' || e.key === 'Delete') {
        if (draft.value.length) { pushUndo(); draft.value.splice(-2); }
        else if (selectedIndex.value !== null) removeShape(selectedIndex.value);
    }
    else if (e.key === 'd') mode.value = 'draw';
    else if (e.key === 'e') mode.value = 'edit';
}

onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('pointermove', onVertexMove);
});

/* -------------------------------------------------------------- export */

const output = computed(() => JSON.stringify({
    id: levelId.value,
    name: levelName.value,
    ordinal: Number(ordinal.value) || 1,
    plan: { image: null, width: imageSize.value.width, height: imageSize.value.height },
    units: shapes.value.map((s) => ({
        id: s.id,
        number: s.number,
        layoutId: s.layoutId || null,
        shape: s.shape,
        status: s.status,
        careLevels: s.careLevels,
        baseRate: s.baseRate === '' || s.baseRate === null ? null : Number(s.baseRate),
        sqft: s.sqft === '' || s.sqft === null ? null : Number(s.sqft),
        accessible: Boolean(s.accessible),
        view: s.view || null,
    })),
    features: [],
}, null, 1));

const copied = ref(false);
async function copyOutput() {
    try {
        await navigator.clipboard.writeText(output.value);
        copied.value = true;
        setTimeout(() => { copied.value = false; }, 2000);
    } catch { /* the textarea below is selectable either way */ }
}

function download() {
    const blob = new Blob([output.value], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${levelId.value || 'level'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
}

const importText = ref('');
const importError = ref(null);
function importLevel() {
    importError.value = null;
    try {
        const parsed = JSON.parse(importText.value);
        const units = parsed.units ?? [];
        if (!Array.isArray(units)) throw new Error('No units array in that JSON.');
        pushUndo();
        levelId.value = parsed.id ?? levelId.value;
        levelName.value = parsed.name ?? levelName.value;
        ordinal.value = parsed.ordinal ?? ordinal.value;
        if (parsed.plan?.width) imageSize.value = { width: parsed.plan.width, height: parsed.plan.height };
        shapes.value = units.map((u) => ({
            id: u.id, number: u.number ?? '', layoutId: u.layoutId ?? '',
            shape: u.shape ?? [], status: u.status ?? 'available',
            careLevels: u.careLevels ?? ['al'], baseRate: u.baseRate ?? null,
            sqft: u.sqft ?? null, accessible: Boolean(u.accessible), view: u.view ?? '',
        }));
        importText.value = '';
        mode.value = 'edit';
    } catch (err) {
        importError.value = err.message;
    }
}

/* Rough sq ft readout while tracing: if the operator tells us the scale, the
   polygon area becomes a useful sanity check against the plan's own figures. */
const pixelsPerFoot = ref(0);
function approxSqft(shape) {
    if (!pixelsPerFoot.value) return null;
    return Math.round(area(shape) / (pixelsPerFoot.value ** 2));
}
</script>

<template>
    <div class="min-h-dvh bg-warm-2 font-sans text-ink">
        <div class="mx-auto max-w-[1500px] px-4 py-5">
            <header class="mb-4">
                <p class="text-[11px] font-bold uppercase tracking-[1.4px] text-ink-light">Seniors Places · internal tool</p>
                <h1 class="mt-0.5 font-serif text-[28px] font-bold">Plan tracer</h1>
                <p class="mt-1 max-w-[70ch] text-[14px] text-ink-mid">
                    Trace a floor plan once and export the geometry. Click to drop points,
                    <kbd class="rounded bg-white px-1.5 py-0.5 text-[12px]">Enter</kbd> to close a suite,
                    <kbd class="rounded bg-white px-1.5 py-0.5 text-[12px]">D</kbd>/<kbd class="rounded bg-white px-1.5 py-0.5 text-[12px]">E</kbd>
                    to switch draw and edit, <kbd class="rounded bg-white px-1.5 py-0.5 text-[12px]">Ctrl</kbd>+<kbd class="rounded bg-white px-1.5 py-0.5 text-[12px]">Z</kbd> to undo.
                </p>
            </header>

            <div class="grid gap-4 lg:grid-cols-[1fr_360px]">
                <!-- canvas -->
                <div class="rounded-card border border-hairline bg-white p-3">
                    <div class="mb-3 flex flex-wrap items-center gap-2">
                        <input type="file" accept="image/*" class="text-[13px]" @change="onFile" />

                        <div class="flex gap-1 rounded-brand bg-warm p-1">
                            <button
                                v-for="m in [{ k: 'draw', l: 'Draw' }, { k: 'edit', l: 'Edit' }]"
                                :key="m.k"
                                type="button"
                                class="rounded-brand px-3 py-1.5 text-[13px]"
                                :class="mode === m.k ? 'bg-brand-dark font-semibold text-white' : 'text-ink-mid'"
                                @click="mode = m.k"
                            >{{ m.l }}</button>
                        </div>

                        <button type="button" class="rounded-brand border border-hairline px-3 py-1.5 text-[13px] hover:bg-warm" @click="addRectangle">
                            + Rectangle
                        </button>
                        <button type="button" class="rounded-brand border border-hairline px-3 py-1.5 text-[13px] hover:bg-warm" :disabled="draft.length < 6" @click="closeShape">
                            Close shape
                        </button>
                        <button type="button" class="rounded-brand border border-hairline px-3 py-1.5 text-[13px] hover:bg-warm" @click="undo">Undo</button>

                        <label class="ml-auto flex items-center gap-1.5 text-[13px]">
                            <input v-model="snap" type="checkbox" class="size-4 accent-[var(--color-brand)]" /> Snap
                        </label>
                        <input v-model.number="gridSize" type="number" min="1" max="50" class="w-16 rounded-brand border border-hairline px-2 py-1 text-[13px]" aria-label="Grid size" />
                    </div>

                    <div class="overflow-auto rounded-brand border border-hairline bg-warm">
                        <svg
                            ref="svgRef"
                            :viewBox="viewBox"
                            class="block w-full"
                            :style="{ cursor: mode === 'draw' ? 'crosshair' : 'default', aspectRatio: `${imageSize.width} / ${imageSize.height}` }"
                            @click="onCanvasClick"
                            @dblclick.prevent="closeShape"
                        >
                            <image v-if="image" :href="image" x="0" y="0" :width="imageSize.width" :height="imageSize.height" />
                            <rect v-else x="0" y="0" :width="imageSize.width" :height="imageSize.height" fill="#fff" />

                            <!-- committed suites -->
                            <g v-for="(s, i) in shapes" :key="s.id">
                                <polygon
                                    :points="toPointsAttr(s.shape)"
                                    :fill="`var(--color-status-${s.status}-fill)`"
                                    :stroke="i === selectedIndex ? 'var(--color-brand-dark)' : `var(--color-status-${s.status})`"
                                    :stroke-width="i === selectedIndex ? 4 : 2"
                                    fill-opacity="0.65"
                                    style="cursor: pointer"
                                    @click.stop="selectedIndex = i; mode = 'edit'"
                                />
                                <text
                                    :x="centroid(s.shape).x" :y="centroid(s.shape).y"
                                    text-anchor="middle" dominant-baseline="middle"
                                    font-size="18" font-weight="700" fill="var(--color-ink)"
                                    style="pointer-events: none; paint-order: stroke; stroke: #fff; stroke-width: 4px;"
                                >{{ s.number }}</text>

                                <!-- vertex handles and edge midpoints, on the selected suite only -->
                                <template v-if="i === selectedIndex && mode === 'edit'">
                                    <circle
                                        v-for="(_, p) in s.shape.length / 2"
                                        :key="`v${p}`"
                                        :cx="s.shape[p * 2]" :cy="s.shape[p * 2 + 1]" r="7"
                                        fill="#fff" stroke="var(--color-brand-dark)" stroke-width="2.5"
                                        style="cursor: grab"
                                        @pointerdown="onVertexDown($event, i, p)"
                                        @dblclick.stop.prevent="deleteVertex(i, p)"
                                    />
                                    <circle
                                        v-for="(_, eI) in s.shape.length / 2"
                                        :key="`e${eI}`"
                                        :cx="(s.shape[eI * 2] + s.shape[((eI + 1) % (s.shape.length / 2)) * 2]) / 2"
                                        :cy="(s.shape[eI * 2 + 1] + s.shape[((eI + 1) % (s.shape.length / 2)) * 2 + 1]) / 2"
                                        r="4.5" fill="var(--color-brand-mid)" stroke="var(--color-brand-dark)" stroke-width="1.5"
                                        style="cursor: copy"
                                        @click.stop="splitEdge(i, eI)"
                                    />
                                </template>
                            </g>

                            <!-- the shape being drawn -->
                            <g v-if="draft.length">
                                <polyline
                                    :points="toPointsAttr(draft)"
                                    fill="var(--color-brand-light)" fill-opacity="0.5"
                                    stroke="var(--color-brand-dark)" stroke-width="2.5" stroke-dasharray="6 4"
                                />
                                <circle
                                    v-for="(_, p) in draft.length / 2"
                                    :key="`d${p}`"
                                    :cx="draft[p * 2]" :cy="draft[p * 2 + 1]" r="5"
                                    fill="var(--color-brand-dark)"
                                />
                            </g>
                        </svg>
                    </div>

                    <p class="mt-2 text-[12.5px] text-ink-mid">
                        {{ shapes.length }} suite{{ shapes.length === 1 ? '' : 's' }} traced ·
                        coordinate space {{ imageSize.width }} × {{ imageSize.height }}
                        <template v-if="draft.length"> · drawing ({{ draft.length / 2 }} points)</template>
                    </p>
                </div>

                <!-- sidebar -->
                <div class="flex flex-col gap-4">
                    <section class="rounded-card border border-hairline bg-white p-4">
                        <h2 class="mb-2 font-serif text-[16px] font-bold">This level</h2>
                        <div class="grid grid-cols-2 gap-2">
                            <label class="text-[12px] font-semibold text-ink-light">
                                Level id
                                <input v-model="levelId" class="mt-0.5 w-full rounded-brand border border-hairline px-2 py-1.5 text-[13px] font-normal text-ink" />
                            </label>
                            <label class="text-[12px] font-semibold text-ink-light">
                                Ordinal
                                <input v-model.number="ordinal" type="number" class="mt-0.5 w-full rounded-brand border border-hairline px-2 py-1.5 text-[13px] font-normal text-ink" />
                            </label>
                            <label class="col-span-2 text-[12px] font-semibold text-ink-light">
                                Name
                                <input v-model="levelName" class="mt-0.5 w-full rounded-brand border border-hairline px-2 py-1.5 text-[13px] font-normal text-ink" />
                            </label>
                            <label class="col-span-2 text-[12px] font-semibold text-ink-light">
                                Pixels per foot <span class="font-normal">(optional — gives a sq ft estimate)</span>
                                <input v-model.number="pixelsPerFoot" type="number" min="0" step="0.1" class="mt-0.5 w-full rounded-brand border border-hairline px-2 py-1.5 text-[13px] font-normal text-ink" />
                            </label>
                        </div>
                    </section>

                    <section v-if="selected" class="rounded-card border border-hairline bg-white p-4">
                        <div class="mb-2 flex items-center justify-between">
                            <h2 class="font-serif text-[16px] font-bold">Suite {{ selected.number }}</h2>
                            <div class="flex gap-1">
                                <button type="button" class="rounded-brand border border-hairline px-2 py-1 text-[12px] hover:bg-warm" @click="duplicateShape(selectedIndex)">Duplicate</button>
                                <button type="button" class="rounded-brand border border-danger px-2 py-1 text-[12px] text-danger hover:bg-danger/10" @click="removeShape(selectedIndex)">Delete</button>
                            </div>
                        </div>

                        <div class="grid grid-cols-2 gap-2">
                            <label class="text-[12px] font-semibold text-ink-light">
                                Number
                                <input v-model="selected.number" class="mt-0.5 w-full rounded-brand border border-hairline px-2 py-1.5 text-[13px] font-normal text-ink" />
                            </label>
                            <label class="text-[12px] font-semibold text-ink-light">
                                Layout id
                                <input v-model="selected.layoutId" placeholder="one-bed-a" class="mt-0.5 w-full rounded-brand border border-hairline px-2 py-1.5 text-[13px] font-normal text-ink" />
                            </label>
                            <label class="col-span-2 text-[12px] font-semibold text-ink-light">
                                Availability
                                <select v-model="selected.status" class="mt-0.5 w-full rounded-brand border border-hairline px-2 py-1.5 text-[13px] font-normal text-ink">
                                    <option v-for="k in STATUS_ORDER" :key="k" :value="k">{{ STATUSES[k].label }}</option>
                                </select>
                            </label>
                            <fieldset class="col-span-2">
                                <legend class="text-[12px] font-semibold text-ink-light">Care levels</legend>
                                <div class="mt-1 flex flex-wrap gap-1">
                                    <label v-for="c in CARE_LEVELS" :key="c.key" class="flex items-center gap-1 rounded-brand border border-hairline px-2 py-1 text-[12.5px]">
                                        <input
                                            type="checkbox"
                                            class="size-3.5 accent-[var(--color-brand)]"
                                            :checked="selected.careLevels.includes(c.key)"
                                            @change="selected.careLevels.includes(c.key)
                                                ? selected.careLevels.splice(selected.careLevels.indexOf(c.key), 1)
                                                : selected.careLevels.push(c.key)"
                                        />
                                        {{ c.short }}
                                    </label>
                                </div>
                            </fieldset>
                            <label class="text-[12px] font-semibold text-ink-light">
                                Base rate
                                <input v-model="selected.baseRate" type="number" class="mt-0.5 w-full rounded-brand border border-hairline px-2 py-1.5 text-[13px] font-normal text-ink" />
                            </label>
                            <label class="text-[12px] font-semibold text-ink-light">
                                Sq ft
                                <input v-model="selected.sqft" type="number" :placeholder="approxSqft(selected.shape) ?? ''" class="mt-0.5 w-full rounded-brand border border-hairline px-2 py-1.5 text-[13px] font-normal text-ink" />
                            </label>
                            <label class="text-[12px] font-semibold text-ink-light">
                                Outlook
                                <input v-model="selected.view" placeholder="Courtyard" class="mt-0.5 w-full rounded-brand border border-hairline px-2 py-1.5 text-[13px] font-normal text-ink" />
                            </label>
                            <label class="flex items-end gap-1.5 text-[12.5px]">
                                <input v-model="selected.accessible" type="checkbox" class="size-4 accent-[var(--color-brand)]" /> Step-free
                            </label>
                        </div>
                        <p v-if="approxSqft(selected.shape)" class="mt-2 text-[12px] text-ink-light">
                            Traced area ≈ {{ approxSqft(selected.shape).toLocaleString() }} sq ft at the scale you gave.
                        </p>
                    </section>

                    <section class="rounded-card border border-hairline bg-white p-4">
                        <h2 class="mb-2 font-serif text-[16px] font-bold">Export</h2>
                        <div class="flex gap-2">
                            <button type="button" class="flex-1 rounded-brand bg-brand px-3 py-2 text-[13px] font-semibold text-white hover:bg-brand-dark" @click="copyOutput">
                                {{ copied ? 'Copied' : 'Copy JSON' }}
                            </button>
                            <button type="button" class="rounded-brand border border-hairline px-3 py-2 text-[13px] font-semibold hover:bg-warm" @click="download">Download</button>
                        </div>
                        <textarea :value="output" readonly rows="8" class="mt-2 w-full rounded-brand border border-hairline bg-warm p-2 font-mono text-[11px]" />
                    </section>

                    <section class="rounded-card border border-hairline bg-white p-4">
                        <h2 class="mb-2 font-serif text-[16px] font-bold">Import</h2>
                        <p class="mb-1.5 text-[12.5px] text-ink-mid">Paste a level's JSON to carry on editing it.</p>
                        <textarea v-model="importText" rows="4" class="w-full rounded-brand border border-hairline p-2 font-mono text-[11px]" placeholder='{ "id": "mag-l1", "units": [...] }' />
                        <button type="button" class="mt-2 w-full rounded-brand border border-hairline px-3 py-2 text-[13px] font-semibold hover:bg-warm" @click="importLevel">Load it</button>
                        <p v-if="importError" class="mt-1 text-[12.5px] text-danger">{{ importError }}</p>
                    </section>
                </div>
            </div>
        </div>
    </div>
</template>
