<script setup>
/*
 | The key.
 |
 | Only lists states the open level actually contains — a legend with six rows
 | when the floor holds two is noise, and this audience does not need more to
 | read. Each row is a real toggle: tapping "Available" filters to it, which
 | turns the legend from a passive key into the fastest filter on the page.
 */
import { computed } from 'vue';
import { STATUSES, STATUS_ORDER } from '../lib/availability.js';

const props = defineProps({
    units:    { type: Array, default: () => [] },    // [{ unit, matches }]
    selected: { type: Array, default: () => [] },    // active status filters
    compact:  { type: Boolean, default: false },
});
const emit = defineEmits(['toggle']);

const rows = computed(() => {
    const counts = {};
    for (const { unit } of props.units) counts[unit.status] = (counts[unit.status] ?? 0) + 1;
    return STATUS_ORDER
        .filter((k) => counts[k])
        .map((k) => ({ ...STATUSES[k], count: counts[k], on: props.selected.includes(k) }));
});
</script>

<template>
    <div class="flex flex-wrap items-center gap-1.5" role="group" aria-label="Availability key — also filters the map">
        <button
            v-for="r in rows"
            :key="r.key"
            type="button"
            class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[12.5px] transition-colors tap-safe"
            :class="r.on
                ? 'border-brand-dark bg-brand-dark text-white font-semibold'
                : 'border-hairline bg-white text-ink-mid hover:bg-warm'"
            :aria-pressed="String(r.on)"
            :title="r.help"
            @click="emit('toggle', r.key)"
        >
            <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true" class="shrink-0 rounded-[3px] overflow-hidden">
                <rect width="14" height="14" :fill="`var(--color-status-${r.key}-fill)`" />
                <rect v-if="r.key !== 'occupied'" width="14" height="14" :fill="`url(#hatch-${r.key})`" />
                <rect width="14" height="14" fill="none" :stroke="r.on ? '#fff' : `var(--color-status-${r.key})`" stroke-width="1.6" />
            </svg>
            <span>{{ compact ? r.short : r.label }}</span>
            <span class="tabular-nums" :class="r.on ? 'text-white/80' : 'text-ink-light'">{{ r.count }}</span>
        </button>
    </div>
</template>
