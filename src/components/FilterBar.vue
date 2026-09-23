<script setup>
/*
 | Filters.
 |
 | Built from the community's own facets (lib/model.js), so a community with no
 | memory care never shows a memory care toggle and one that keeps rates private
 | never shows a price slider. An empty control that can only ever return zero
 | results is worse than no control.
 |
 | Order is deliberate: care level first, because it is the only question a
 | family can always answer, and the one that changes what everything else
 | means. Price last, because people arrive at it reluctantly.
 |
 | Every control is a real <input> or <button> with a real <label>. No custom
 | dropdowns — they are the most common thing to get wrong for screen readers,
 | and a native <select> is also the only control that works properly with
 | voice access and switch devices.
 */
import { computed, ref } from 'vue';
import { STATUSES } from '../lib/availability.js';
import { money } from '../lib/pricing.js';

const props = defineProps({
    facets:  { type: Object, required: true },
    filters: { type: Object, required: true },   // the reactive object from useUnitFilters
    active:  { type: Boolean, default: false },
    resultCount: { type: Number, default: 0 },
});
const emit = defineEmits(['toggle', 'clear']);

const open = ref(false);   // the "more filters" disclosure

const priceStep = 250;
const priceCeiling = computed(() => {
    const max = props.facets.priceRange?.max ?? 0;
    return Math.ceil(max / priceStep) * priceStep;
});
const priceFloorValue = computed(() => {
    const min = props.facets.priceRange?.min ?? 0;
    return Math.floor(min / priceStep) * priceStep;
});

const bedLabel = (n) => (Number(n) === 0 ? 'Studio' : `${n} bed`);

/* Today, as YYYY-MM-DD, for the move-in date input's min attribute. */
const today = new Date().toISOString().slice(0, 10);

const chips = computed(() => {
    const out = [];
    const f = props.filters;
    for (const key of f.care) out.push({ label: props.facets.careLevels.find((c) => c.key === key)?.short ?? key, on: () => emit('toggle', 'care', key) });
    for (const key of f.status) out.push({ label: STATUSES[key]?.short ?? key, on: () => emit('toggle', 'status', key) });
    for (const n of f.beds) out.push({ label: bedLabel(n), on: () => emit('toggle', 'beds', n) });
    for (const v of f.view) out.push({ label: v, on: () => emit('toggle', 'view', v) });
    if (f.ada) out.push({ label: 'Step-free', on: () => { f.ada = false; } });
    if (f.max !== null) out.push({ label: `Under ${money(f.max)}`, on: () => { f.max = null; } });
    if (f.sqft !== null) out.push({ label: `${f.sqft}+ sq ft`, on: () => { f.sqft = null; } });
    if (f.from) out.push({ label: `By ${f.from}`, on: () => { f.from = null; } });
    if (f.q.trim()) out.push({ label: `“${f.q.trim()}”`, on: () => { f.q = ''; } });
    return out;
});
</script>

<template>
    <div class="rounded-card border border-hairline bg-white p-4">
        <!-- care level: the primary question -->
        <fieldset v-if="facets.careLevels.length > 1">
            <legend class="mb-2 text-[11px] font-bold uppercase tracking-[1.2px] text-ink-light">Type of care</legend>
            <div class="flex flex-wrap gap-1.5">
                <button
                    v-for="c in facets.careLevels"
                    :key="c.key"
                    type="button"
                    class="tap-safe rounded-brand border px-3 py-2 text-[13.5px] transition-colors"
                    :class="filters.care.includes(c.key)
                        ? 'border-brand-dark bg-brand-dark text-white font-semibold'
                        : 'border-hairline bg-white text-ink hover:bg-warm'"
                    :aria-pressed="String(filters.care.includes(c.key))"
                    :title="c.blurb"
                    @click="emit('toggle', 'care', c.key)"
                >{{ c.short }}</button>
            </div>
        </fieldset>

        <!-- bedrooms -->
        <fieldset v-if="facets.bedrooms.length > 1" class="mt-4">
            <legend class="mb-2 text-[11px] font-bold uppercase tracking-[1.2px] text-ink-light">Bedrooms</legend>
            <div class="flex flex-wrap gap-1.5">
                <button
                    v-for="n in facets.bedrooms"
                    :key="n"
                    type="button"
                    class="tap-safe rounded-brand border px-3 py-2 text-[13.5px] transition-colors"
                    :class="filters.beds.includes(n)
                        ? 'border-brand-dark bg-brand-dark text-white font-semibold'
                        : 'border-hairline bg-white text-ink hover:bg-warm'"
                    :aria-pressed="String(filters.beds.includes(n))"
                    @click="emit('toggle', 'beds', n)"
                >{{ bedLabel(n) }}</button>
            </div>
        </fieldset>

        <!-- budget -->
        <div v-if="facets.pricingPublic && facets.priceRange" class="mt-4">
            <label for="flt-max" class="mb-1 block text-[11px] font-bold uppercase tracking-[1.2px] text-ink-light">
                Monthly budget
            </label>
            <div class="flex items-center gap-3">
                <input
                    id="flt-max"
                    v-model.number="filters.max"
                    type="range"
                    class="h-6 w-full accent-[var(--color-brand)]"
                    :min="priceFloorValue"
                    :max="priceCeiling"
                    :step="priceStep"
                    :aria-valuetext="filters.max ? `${money(filters.max)} a month or less` : 'Any budget'"
                />
                <output
                    for="flt-max"
                    class="w-[104px] shrink-0 text-right text-[14px] font-semibold tabular-nums text-ink"
                >{{ filters.max ? `≤ ${money(filters.max)}` : 'Any' }}</output>
            </div>
            <p class="mt-1 text-[12px] text-ink-light">
                Suite rate only. Care is charged on top — open a suite to see the full monthly figure.
            </p>
        </div>

        <!-- move-in date: the question every adult child asks first -->
        <div class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
                <label for="flt-from" class="mb-1 block text-[11px] font-bold uppercase tracking-[1.2px] text-ink-light">
                    Need it by
                </label>
                <input
                    id="flt-from"
                    v-model="filters.from"
                    type="date"
                    :min="today"
                    class="tap-safe w-full rounded-brand border border-hairline px-3 py-2 text-[14px] text-ink"
                />
            </div>
            <div>
                <label for="flt-q" class="mb-1 block text-[11px] font-bold uppercase tracking-[1.2px] text-ink-light">
                    Find a suite
                </label>
                <input
                    id="flt-q"
                    v-model="filters.q"
                    type="search"
                    placeholder="Suite number or layout name"
                    class="tap-safe w-full rounded-brand border border-hairline px-3 py-2 text-[14px] text-ink"
                />
            </div>
        </div>

        <!-- accessibility: a first-class filter, not an afterthought -->
        <div v-if="facets.hasAccessible" class="mt-4">
            <label class="tap-safe flex cursor-pointer items-center gap-2.5 text-[14px] text-ink">
                <input v-model="filters.ada" type="checkbox" class="size-5 rounded accent-[var(--color-brand)]" />
                <span>Step-free with a roll-in shower</span>
            </label>
        </div>

        <!-- everything else, folded away -->
        <div v-if="facets.views.length > 1 || facets.sqftRange" class="mt-3">
            <button
                type="button"
                class="tap-safe text-[13.5px] font-semibold text-brand hover:underline"
                :aria-expanded="String(open)"
                aria-controls="flt-more"
                @click="open = !open"
            >{{ open ? 'Fewer options' : 'More options' }}</button>

            <div v-show="open" id="flt-more" class="mt-3 border-t border-hairline pt-3">
                <fieldset v-if="facets.views.length > 1">
                    <legend class="mb-2 text-[11px] font-bold uppercase tracking-[1.2px] text-ink-light">Outlook</legend>
                    <div class="flex flex-wrap gap-1.5">
                        <button
                            v-for="v in facets.views"
                            :key="v"
                            type="button"
                            class="tap-safe rounded-brand border px-3 py-2 text-[13.5px] transition-colors"
                            :class="filters.view.includes(v)
                                ? 'border-brand-dark bg-brand-dark text-white font-semibold'
                                : 'border-hairline bg-white text-ink hover:bg-warm'"
                            :aria-pressed="String(filters.view.includes(v))"
                            @click="emit('toggle', 'view', v)"
                        >{{ v }}</button>
                    </div>
                </fieldset>

                <div v-if="facets.sqftRange" class="mt-4">
                    <label for="flt-sqft" class="mb-1 block text-[11px] font-bold uppercase tracking-[1.2px] text-ink-light">
                        At least this big
                    </label>
                    <div class="flex items-center gap-3">
                        <input
                            id="flt-sqft"
                            v-model.number="filters.sqft"
                            type="range"
                            class="h-6 w-full accent-[var(--color-brand)]"
                            :min="facets.sqftRange.min"
                            :max="facets.sqftRange.max"
                            step="25"
                            :aria-valuetext="filters.sqft ? `${filters.sqft} square feet or more` : 'Any size'"
                        />
                        <output for="flt-sqft" class="w-[104px] shrink-0 text-right text-[14px] font-semibold tabular-nums text-ink">
                            {{ filters.sqft ? `${filters.sqft}+ sq ft` : 'Any' }}
                        </output>
                    </div>
                </div>
            </div>
        </div>

        <!-- what is on, and the way out -->
        <div v-if="active" class="mt-4 flex flex-wrap items-center gap-1.5 border-t border-hairline pt-3">
            <span class="text-[12px] text-ink-light">Filtering by</span>
            <button
                v-for="(c, i) in chips"
                :key="i"
                type="button"
                class="inline-flex items-center gap-1 rounded-full bg-brand-light px-2.5 py-1 text-[12.5px] font-semibold text-brand-dark hover:bg-brand-mid"
                @click="c.on()"
            >
                {{ c.label }}
                <span aria-hidden="true">×</span>
                <span class="sr-only">Remove this filter</span>
            </button>
            <button
                type="button"
                class="ml-auto text-[13px] font-semibold text-ink-mid underline hover:text-ink"
                @click="emit('clear')"
            >Clear all</button>
        </div>
    </div>
</template>
