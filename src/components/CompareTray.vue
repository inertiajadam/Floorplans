<script setup>
/*
 | Compare, up to three suites.
 |
 | Collapsed it is a bar along the bottom; expanded it is a table. The table is
 | a real <table> with proper row and column headers, because comparison is
 | exactly the case where a screen reader user needs to hear "Suite 214,
 | monthly total, $6,100" rather than four numbers in a row with no context.
 |
 | Rows only appear when at least one suite has something to say for them, so
 | comparing three studios does not produce eight rows of "—".
 */
import { computed } from 'vue';
import StatusPill from './StatusPill.vue';
import { statusDetail } from '../lib/availability.js';
import { headline, money } from '../lib/pricing.js';

const props = defineProps({
    units:     { type: Array, required: true },
    community: { type: Object, required: true },
    open:      { type: Boolean, default: false },
});
const emit = defineEmits(['toggle', 'remove', 'clear', 'select', 'enquire']);

const ROWS = [
    { key: 'layout', label: 'Layout',     get: (u) => u.layoutName },
    { key: 'type',   label: 'Room type',  get: (u) => u.typeLabel },
    { key: 'where',  label: 'Where',      get: (u) => [u.buildingName, u.levelName].filter(Boolean).join(', ') },
    { key: 'sqft',   label: 'Size',       get: (u) => (u.sqft ? `${Number(u.sqft).toLocaleString()} sq ft` : null) },
    { key: 'beds',   label: 'Bedrooms',   get: (u) => (u.bedrooms === null ? null : Number(u.bedrooms) === 0 ? 'Studio' : String(Number(u.bedrooms))) },
    { key: 'baths',  label: 'Bathrooms',  get: (u) => (u.bathrooms ? String(Number(u.bathrooms)) : null) },
    { key: 'view',   label: 'Outlook',    get: (u) => u.view },
    { key: 'ada',    label: 'Step-free',  get: (u) => (u.accessible ? 'Yes' : 'No') },
    { key: 'rate',   label: 'Suite rate', get: (u) => (u.headline.public && u.headline.from ? `${money(u.headline.from)}/mo` : 'On request') },
];

/* Drop rows where every suite is blank. */
const rows = computed(() => ROWS.filter((r) => props.units.some((u) => r.get(u))));

/* The typical-with-care figure, computed once per suite. */
const typical = (u) => {
    const h = headline(u, props.community);
    return h.public && h.typical ? `${money(h.typical)}/mo` : null;
};

const anyTypical = computed(() => props.units.some((u) => typical(u)));
</script>

<template>
    <div v-if="units.length" class="compare-tray">
        <!-- collapsed bar -->
        <div class="flex items-center gap-3 border-t border-hairline bg-white px-4 py-2.5">
            <button
                type="button"
                class="tap-safe flex items-center gap-2 text-[14px] font-semibold text-ink"
                :aria-expanded="String(open)"
                aria-controls="compare-table"
                @click="emit('toggle')"
            >
                <span class="grid size-6 place-items-center rounded-full bg-brand-dark text-[12px] font-bold text-white tabular-nums">
                    {{ units.length }}
                </span>
                <span>{{ open ? 'Hide comparison' : 'Compare these suites' }}</span>
                <span aria-hidden="true" class="text-ink-light">{{ open ? '▾' : '▴' }}</span>
            </button>

            <ul class="ml-auto hidden items-center gap-1.5 sm:flex">
                <li v-for="u in units" :key="u.id">
                    <button
                        type="button"
                        class="tap-safe inline-flex items-center gap-1 rounded-full border border-hairline px-2.5 py-1 text-[12.5px] text-ink-mid hover:bg-warm"
                        @click="emit('remove', u.id)"
                    >
                        Suite {{ u.number }}
                        <span aria-hidden="true">×</span>
                        <span class="sr-only">Remove suite {{ u.number }} from the comparison</span>
                    </button>
                </li>
            </ul>

            <button
                type="button"
                class="tap-safe shrink-0 text-[13px] font-semibold text-ink-mid underline hover:text-ink"
                @click="emit('clear')"
            >Clear</button>
        </div>

        <!-- expanded table -->
        <div v-show="open" id="compare-table" class="max-h-[54vh] overflow-auto border-t border-hairline bg-white">
            <table class="w-full min-w-[520px] text-[13.5px]">
                <caption class="sr-only">
                    Side-by-side comparison of {{ units.length }} suites at {{ community.name }}
                </caption>
                <thead>
                    <tr class="border-b border-hairline">
                        <th scope="col" class="sticky left-0 z-10 bg-white px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-[1.1px] text-ink-light">
                            <span class="sr-only">Detail</span>
                        </th>
                        <th v-for="u in units" :key="u.id" scope="col" class="px-3 py-2.5 text-left align-top">
                            <button
                                type="button"
                                class="font-serif text-[16px] font-bold text-ink hover:underline"
                                @click="emit('select', u.id)"
                            >Suite {{ u.number }}</button>
                            <div class="mt-1"><StatusPill :status="u.status" size="sm" /></div>
                            <div class="text-[12px] text-ink-light">{{ statusDetail(u) }}</div>
                        </th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="r in rows" :key="r.key" class="border-b border-hairline/70">
                        <th scope="row" class="sticky left-0 z-10 bg-white px-3 py-2 text-left font-semibold text-ink-mid">
                            {{ r.label }}
                        </th>
                        <td v-for="u in units" :key="u.id" class="px-3 py-2 align-top text-ink">
                            {{ r.get(u) ?? '—' }}
                        </td>
                    </tr>

                    <!-- the line that matters: rate plus typical care -->
                    <tr v-if="anyTypical" class="border-b border-hairline/70 bg-warm/60">
                        <th scope="row" class="sticky left-0 z-10 bg-warm/60 px-3 py-2 text-left font-semibold text-ink-mid">
                            Typical with care
                        </th>
                        <td v-for="u in units" :key="u.id" class="px-3 py-2 align-top font-semibold tabular-nums text-brand-dark">
                            {{ typical(u) ?? '—' }}
                        </td>
                    </tr>

                    <tr>
                        <th scope="row" class="sticky left-0 z-10 bg-white px-3 py-2.5 text-left">
                            <span class="sr-only">Next step</span>
                        </th>
                        <td v-for="u in units" :key="u.id" class="px-3 py-2.5 align-top">
                            <button
                                type="button"
                                class="tap-safe w-full rounded-brand bg-brand px-3 py-2 text-[13px] font-semibold text-white hover:bg-brand-dark"
                                @click="emit('enquire', u)"
                            >{{ u.statusMeta.cta ?? 'Ask about it' }}</button>
                        </td>
                    </tr>
                </tbody>
            </table>

            <p v-if="anyTypical" class="px-3 py-2 text-[12px] text-ink-light">
                “Typical with care” adds a mid-range care level to the suite rate. Your actual level is set by an assessment.
            </p>
        </div>
    </div>
</template>

<style scoped>
.compare-tray {
    position: sticky;
    bottom: 0;
    z-index: 20;
    box-shadow: 0 -4px 24px rgba(31, 42, 51, 0.09);
}
</style>
