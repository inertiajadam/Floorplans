<script setup>
/*
 | One suite, in the results list.
 |
 | The card is the accessible equal of the polygon on the map — everything the
 | fill colour tells a sighted user is written out here. It is not a fallback:
 | on a phone the list is the primary way people browse, and plenty of families
 | never open the map at all.
 |
 | The price line says two numbers on purpose. "From $4,950" is the suite rate;
 | "most pay about $6,100" is the suite rate plus a typical care level. Showing
 | only the first is how the industry got its reputation for surprise invoices.
 */
import { computed } from 'vue';
import StatusPill from './StatusPill.vue';
import { statusDetail } from '../lib/availability.js';
import { money } from '../lib/pricing.js';

const props = defineProps({
    unit:      { type: Object, required: true },
    selected:  { type: Boolean, default: false },
    comparing: { type: Boolean, default: false },
    compareDisabled: { type: Boolean, default: false },
});
const emit = defineEmits(['select', 'compare', 'hover']);

/* "Studio · 380 sq ft · 1 bath", not "Studio · 380 sq ft · Studio · 1 bath":
   the bedroom count is dropped when the layout's own label already says it. */
const specs = computed(() => {
    const beds = props.unit.bedrooms !== null ? (Number(props.unit.bedrooms) === 0 ? 'Studio' : `${Number(props.unit.bedrooms)} bed`) : null;
    const type = props.unit.typeLabel;
    return [
        type,
        props.unit.sqft ? `${Number(props.unit.sqft).toLocaleString()} sq ft` : null,
        beds && !(type && type.toLowerCase().includes(beds.toLowerCase().replace(' bed', ' bed'))) ? beds : null,
        props.unit.bathrooms ? `${Number(props.unit.bathrooms)} bath` : null,
    ].filter(Boolean).join(' · ');
});

const where = computed(() => [props.unit.buildingName, props.unit.levelName].filter(Boolean).join(' · '));
</script>

<template>
    <li
        :data-unit="unit.id"
        class="relative rounded-card border bg-white transition-colors"
        :class="selected ? 'border-brand-dark ring-2 ring-brand-dark/25' : 'border-hairline hover:border-brand-mid'"
        @mouseenter="emit('hover', unit.id)"
        @mouseleave="emit('hover', null)"
    >
        <!-- The whole card is one button. A card wrapped in a link with more
             buttons inside is a well-known screen-reader trap; the compare
             control sits outside the button's box instead. -->
        <button
            type="button"
            class="w-full p-4 pr-14 text-left"
            :aria-pressed="String(selected)"
            @click="emit('select', unit.id)"
        >
            <div class="flex items-baseline justify-between gap-3">
                <span class="font-serif text-[19px] font-bold leading-tight text-ink">
                    Suite {{ unit.number }}
                </span>
                <span v-if="unit.accessible" class="shrink-0 rounded-full bg-brand-light px-2 py-0.5 text-[11.5px] font-semibold text-brand-dark">
                    Step-free
                </span>
            </div>

            <div class="mt-0.5 text-[14px] text-ink">{{ unit.layoutName }}</div>
            <div class="text-[13px] text-ink-mid">{{ specs }}</div>
            <div class="text-[12.5px] text-ink-light">{{ where }}<template v-if="unit.view"> · {{ unit.view }} outlook</template></div>

            <div class="mt-2.5">
                <StatusPill :status="unit.status" :detail="statusDetail(unit)" />
            </div>

            <div v-if="unit.headline.public && unit.headline.from" class="mt-2 text-[14px] text-ink">
                <span class="font-semibold text-brand-dark">{{ money(unit.headline.from) }}</span>
                <span class="text-ink-mid">/mo suite rate</span>
                <span v-if="unit.headline.typical" class="block text-[12.5px] text-ink-light">
                    Most residents here pay about {{ money(unit.headline.typical) }} with care
                </span>
            </div>
            <div v-else class="mt-2 text-[13.5px] text-ink-mid">Pricing on request</div>
        </button>

        <!-- compare sits outside the button so it is its own stop -->
        <button
            type="button"
            class="tap-safe absolute right-2 top-3 grid place-items-center rounded-brand border px-2 text-[12px] font-semibold transition-colors"
            :class="comparing
                ? 'border-brand-dark bg-brand-dark text-white'
                : compareDisabled
                    ? 'border-hairline bg-white text-ink-light opacity-50'
                    : 'border-hairline bg-white text-ink-mid hover:bg-warm'"
            :aria-pressed="String(comparing)"
            :disabled="compareDisabled && !comparing"
            :title="comparing ? 'Remove from compare' : compareDisabled ? 'Compare is full' : 'Add to compare'"
            @click.stop="emit('compare', unit.id)"
        >
            <span aria-hidden="true">{{ comparing ? '✓' : '+' }}</span>
            <span class="sr-only">{{ comparing ? `Remove suite ${unit.number} from compare` : `Compare suite ${unit.number}` }}</span>
        </button>
    </li>
</template>
