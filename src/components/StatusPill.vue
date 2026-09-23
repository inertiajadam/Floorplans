<script setup>
/*
 | The availability badge, used on the map legend, every card and the drawer.
 |
 | Carries a shape as well as a colour — a small swatch that repeats the same
 | hatch the map uses, so the link between "this badge" and "that suite on the
 | plan" survives for someone who cannot separate the greens from the golds.
 */
import { computed } from 'vue';
import { status as statusFor } from '../lib/availability.js';

const props = defineProps({
    status: { type: String, required: true },
    size:   { type: String, default: 'md' },   // sm | md
    detail: { type: String, default: null },   // the line under it, e.g. "Available 15 November"
});

const meta = computed(() => statusFor(props.status));
</script>

<template>
    <span class="inline-flex items-center gap-1.5" :class="size === 'sm' ? 'text-[12px]' : 'text-[13px]'">
        <svg :width="size === 'sm' ? 12 : 14" :height="size === 'sm' ? 12 : 14" viewBox="0 0 14 14" aria-hidden="true" class="shrink-0 rounded-[3px] overflow-hidden">
            <rect width="14" height="14" :fill="`var(--color-status-${status}-fill)`" />
            <rect v-if="status !== 'occupied'" width="14" height="14" :fill="`url(#hatch-${status})`" />
            <rect width="14" height="14" fill="none" :stroke="`var(--color-status-${status})`" stroke-width="1.5" />
        </svg>
        <span class="font-semibold" :style="{ color: `var(--color-status-${status})` }">{{ meta.short }}</span>
        <span v-if="detail" class="text-ink-mid font-normal">· {{ detail }}</span>
    </span>
</template>
