<script setup>
/*
 | One suite in the operator's roster.
 |
 | The whole design brief for this row is: changing a suite from occupied to
 | available must take one interaction, and it must be obvious it saved.
 |
 | So the status control is a plain <select> that saves the moment it changes —
 | no edit mode, no save button, no modal. Availability changes weekly and
 | sometimes daily; anything that turns it into a form is a workflow that stops
 | getting done, and a stale map is worse than no map.
 |
 | The satellite fields (move-in date, waitlist count, nightly rate) appear only
 | for the status that owns them, because a date input on an occupied suite is
 | a question with no answer. They save on change too, but the row stays valid
 | in between: a coming-available suite with no date yet is shown as needing
 | one rather than silently reverting.
 |
 | A <select> rather than a nicer custom control on purpose. It is the only
 | thing that works properly with voice access, switch devices and the native
 | picker on a phone — and a lot of this gets done on a phone, standing in a
 | corridor, by someone who has just shown a family out.
 */
import { computed, ref, watch } from 'vue';
import { STATUS_ORDER, STATUSES, describeAge, freshnessOf } from '../lib/availability.js';
import { money } from '../lib/pricing.js';
import StatusPill from '../components/StatusPill.vue';

const props = defineProps({
    unit:          { type: Object, required: true },
    selected:      { type: Boolean, default: false },
    freshnessDays: { type: Number, default: 30 },
    pricingPublic: { type: Boolean, default: true },
    synced:        { type: Boolean, default: false },   // a PMS feed owns inventory
    saving:        { type: Boolean, default: false },
    savedAt:       { type: Number, default: 0 },        // timestamp of the last successful save
});

const emit = defineEmits(['change', 'toggle-select', 'toggle-lock']);

/* Local mirrors so the control responds instantly rather than waiting on the
   round trip. Re-synced whenever the server sends a new value. */
const status = ref(props.unit.status);
const availableOn = ref(props.unit.availableOn ?? '');
const waitlistCount = ref(props.unit.waitlistCount ?? '');
const respiteRate = ref(props.unit.respiteRate ?? '');
const baseRate = ref(props.unit.ownRate ?? '');

watch(() => props.unit, (u) => {
    status.value = u.status;
    availableOn.value = u.availableOn ?? '';
    waitlistCount.value = u.waitlistCount ?? '';
    respiteRate.value = u.respiteRate ?? '';
    baseRate.value = u.ownRate ?? '';
}, { deep: true });

const today = new Date().toISOString().slice(0, 10);

const freshness = computed(() => freshnessOf(props.unit.confirmedAt, props.freshnessDays));
const confirmedLabel = computed(() => describeAge(props.unit.confirmedAt) ?? 'never confirmed');

/* A coming-available suite with no date cannot render a useful line to a
   family, so the row says so rather than letting it through quietly. */
const needsDate = computed(() => status.value === 'coming_available' && !availableOn.value);

const recentlySaved = computed(() => props.savedAt && Date.now() - props.savedAt < 2600);

const where = computed(() => [props.unit.building, props.unit.level].filter(Boolean).join(' · '));

function push() {
    emit('change', props.unit.id, {
        status: status.value,
        available_on: status.value === 'coming_available' ? (availableOn.value || null) : null,
        waitlist_count: status.value === 'waitlist' ? (waitlistCount.value === '' ? null : Number(waitlistCount.value)) : null,
        respite_nightly_rate: status.value === 'respite' ? (respiteRate.value === '' ? null : Number(respiteRate.value)) : null,
        base_rate: baseRate.value === '' ? null : Number(baseRate.value),
    });
}

function onStatus() {
    /* Don't save a coming-available with no date — it would be published as a
       suite that is "coming available" on no particular day. Wait for the date
       control that just appeared. */
    if (needsDate.value) return;
    push();
}

const rateLocked = computed(() => props.unit.lockedFields?.includes('base_rate'));
</script>

<template>
    <li
        class="grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-2 rounded-[12px] border p-3 transition-colors md:grid-cols-[auto_minmax(150px,1.3fr)_minmax(150px,1fr)_minmax(130px,0.9fr)_auto] md:items-center"
        :class="[
            selected ? 'border-brand bg-brand-light/40' : 'border-hairline bg-white',
            freshness === 'stale' && unit.actionable ? 'ring-1 ring-gold-dark/40' : '',
        ]"
    >
        <!-- select -->
        <label class="flex items-center justify-center pt-0.5 md:pt-0">
            <input
                type="checkbox"
                class="size-5 rounded accent-[var(--color-brand)]"
                :checked="selected"
                @change="emit('toggle-select', unit.id)"
            />
            <span class="sr-only">Select suite {{ unit.number }} for a bulk change</span>
        </label>

        <!-- who -->
        <div class="min-w-0">
            <div class="flex flex-wrap items-baseline gap-x-2">
                <span class="font-serif text-[16px] font-bold text-ink">{{ unit.number }}</span>
                <span class="truncate text-[13px] text-ink-mid">{{ unit.layoutName ?? 'No layout set' }}</span>
            </div>
            <div class="text-[12px] text-ink-light">
                {{ where }}
                <template v-if="unit.sqft"> · {{ Number(unit.sqft).toLocaleString() }} sq ft</template>
                <template v-if="unit.accessible"> · step-free</template>
            </div>
            <p v-if="!unit.layoutName" class="mt-0.5 text-[11.5px] text-gold-dark">
                No layout linked, so families see no plan drawing for this suite.
            </p>
        </div>

        <!-- status, and whatever that status needs -->
        <div class="col-span-2 md:col-span-1">
            <label class="sr-only" :for="`status-${unit.id}`">Availability for suite {{ unit.number }}</label>
            <select
                :id="`status-${unit.id}`"
                v-model="status"
                class="tap-safe w-full rounded-[10px] border-[1.5px] border-hairline bg-white px-2.5 py-2 text-[13.5px] text-ink outline-none transition focus:border-brand focus:ring-[3px] focus:ring-brand-light"
                :disabled="synced && !unit.lockedFields?.includes('status')"
                @change="onStatus"
            >
                <option v-for="k in STATUS_ORDER" :key="k" :value="k">{{ STATUSES[k].label }}</option>
            </select>

            <div v-if="status === 'coming_available'" class="mt-1.5">
                <label class="sr-only" :for="`date-${unit.id}`">Available from, suite {{ unit.number }}</label>
                <input
                    :id="`date-${unit.id}`"
                    v-model="availableOn"
                    type="date"
                    :min="today"
                    class="tap-safe w-full rounded-[10px] border-[1.5px] px-2.5 py-2 text-[13.5px] text-ink outline-none transition focus:border-brand focus:ring-[3px] focus:ring-brand-light"
                    :class="needsDate ? 'border-gold-dark' : 'border-hairline'"
                    @change="push"
                />
                <p v-if="needsDate" class="mt-0.5 text-[11.5px] text-gold-dark">
                    Pick a date — it is the first thing families look for.
                </p>
            </div>

            <div v-else-if="status === 'waitlist'" class="mt-1.5">
                <label class="sr-only" :for="`wait-${unit.id}`">Families waiting, suite {{ unit.number }}</label>
                <input
                    :id="`wait-${unit.id}`"
                    v-model="waitlistCount"
                    type="number"
                    min="0"
                    max="999"
                    placeholder="How many waiting?"
                    class="tap-safe w-full rounded-[10px] border-[1.5px] border-hairline px-2.5 py-2 text-[13.5px] text-ink outline-none transition focus:border-brand focus:ring-[3px] focus:ring-brand-light"
                    @change="push"
                />
            </div>

            <div v-else-if="status === 'respite'" class="mt-1.5">
                <label class="sr-only" :for="`resp-${unit.id}`">Nightly rate, suite {{ unit.number }}</label>
                <input
                    :id="`resp-${unit.id}`"
                    v-model="respiteRate"
                    type="number"
                    min="0"
                    placeholder="Per night"
                    class="tap-safe w-full rounded-[10px] border-[1.5px] border-hairline px-2.5 py-2 text-[13.5px] text-ink outline-none transition focus:border-brand focus:ring-[3px] focus:ring-brand-light"
                    @change="push"
                />
            </div>
        </div>

        <!-- rate -->
        <div v-if="pricingPublic" class="col-span-2 md:col-span-1">
            <label class="sr-only" :for="`rate-${unit.id}`">Monthly suite rate, suite {{ unit.number }}</label>
            <div class="flex items-center gap-1.5">
                <!-- The currency mark is decorative; the label above names the field
                     properly for anyone not reading the column. -->
                <div class="relative flex-1">
                    <span aria-hidden="true" class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13.5px] text-ink-light">$</span>
                    <input
                        :id="`rate-${unit.id}`"
                        v-model="baseRate"
                        type="number"
                        min="0"
                        :placeholder="unit.baseRate ? `${unit.baseRate} from layout` : 'Monthly'"
                        class="tap-safe w-full rounded-[10px] border-[1.5px] border-hairline py-2 pl-5 pr-2.5 text-[13.5px] tabular-nums text-ink outline-none transition focus:border-brand focus:ring-[3px] focus:ring-brand-light"
                        :disabled="synced && !rateLocked"
                        @change="push"
                    />
                </div>
                <!-- Pin a rate against the feed. Only meaningful once inventory syncs. -->
                <button
                    v-if="synced"
                    type="button"
                    class="tap-safe shrink-0 rounded-[10px] border px-2 text-[12px] transition-colors"
                    :class="rateLocked ? 'border-brand-dark bg-brand-dark text-white' : 'border-hairline text-ink-light hover:bg-warm'"
                    :aria-pressed="String(Boolean(rateLocked))"
                    :title="rateLocked ? 'Kept as you set it, even when inventory syncs' : 'Let inventory sync set this'"
                    @click="emit('toggle-lock', unit.id, 'base_rate')"
                >
                    <span aria-hidden="true">{{ rateLocked ? '🔒' : '🔓' }}</span>
                    <span class="sr-only">{{ rateLocked ? `Unpin the rate for suite ${unit.number}` : `Pin the rate for suite ${unit.number} against inventory sync` }}</span>
                </button>
            </div>
            <p v-if="baseRate === '' && unit.baseRate" class="mt-0.5 text-[11.5px] text-ink-light">
                Using the layout's {{ money(unit.baseRate) }}
            </p>
        </div>

        <!-- freshness + save state -->
        <div class="col-span-2 flex items-center justify-between gap-2 md:col-span-1 md:flex-col md:items-end md:justify-center">
            <span
                class="text-[11.5px] whitespace-nowrap"
                :class="{
                    'text-ink-light': freshness === 'fresh',
                    'text-ink-mid': freshness === 'ageing',
                    'font-semibold text-gold-dark': freshness === 'stale' || freshness === 'never',
                }"
            >
                <template v-if="freshness === 'never'">Never confirmed</template>
                <template v-else>Confirmed {{ confirmedLabel }}</template>
            </span>

            <span class="text-[11.5px]" aria-live="polite">
                <span v-if="saving" class="text-ink-light">Saving…</span>
                <span v-else-if="recentlySaved" class="font-semibold text-brand">Saved</span>
            </span>

            <!-- what families currently see, so the operator can sanity-check it -->
            <StatusPill v-if="!saving && !recentlySaved" :status="unit.status" size="sm" class="hidden md:inline-flex" />
        </div>
    </li>
</template>
