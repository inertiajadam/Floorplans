<script setup>
/*
 | Matching a management system's rooms to the suites on the map. Once.
 |
 | ---------------------------------------------------------------------------
 | WHY THIS SCREEN EXISTS
 | ---------------------------------------------------------------------------
 | Every sync after this one matches on a stable id. But those ids have to get
 | onto our records somehow, and at that first moment the only shared
 | information is labels — "204" on their side, "204" on ours.
 |
 | Matching on that automatically is the bug the whole design avoids. Numbers
 | get reused when a wing is renumbered; two buildings on one campus both have
 | a 204; a PMS labels beds where we have rooms. None of those throw an error.
 | They point a family at a room someone already lives in.
 |
 | So the entire risk of the integration is concentrated here, into one
 | reviewed sitting, and after that it is gone for good.
 |
 | ---------------------------------------------------------------------------
 | THE DESIGN RULE
 | ---------------------------------------------------------------------------
 | "Accept all confident matches" is only safe because confidence already
 | accounts for ambiguity: a pair whose runner-up scored nearly as well is
 | demoted to low no matter how high it scored, so bulk-accept can never touch
 | a coin-flip. That is enforced in InventoryMatcher and tested — without it,
 | this button would be the most dangerous control in the product.
 */
import { computed, ref } from 'vue';

const props = defineProps({
    /** App\Support\Inventory\Reconciliation::preview() */
    reconcile: { type: Object, required: true },
    /** async (action, payload) => void */
    submit:    { type: Function, required: true },
});

/* Local decisions, keyed by the feed's id. Nothing is written until Save, so
   an operator can work through a campus and change their mind. */
const chosen = ref(seed());
const busy = ref(null);
const flash = ref(null);
const showMatched = ref(false);

function seed() {
    const out = {};
    for (const p of props.reconcile.pairs ?? []) out[p.externalId] = p.unitId;
    for (const f of props.reconcile.unmatchedFeed ?? []) out[f.externalId] = null;
    return out;
}

const counts = computed(() => props.reconcile.counts ?? {});

/** Every suite, for the manual picker — including ones already proposed. */
const allSuites = computed(() => {
    const seenIds = new Set();
    const out = [];
    for (const p of props.reconcile.pairs ?? []) {
        if (!seenIds.has(p.unitId)) {
            seenIds.add(p.unitId);
            out.push({ id: p.unitId, number: p.unitNumber, building: p.unitBuilding, level: p.unitLevel });
        }
    }
    for (const s of props.reconcile.unmatchedSuites ?? []) {
        if (!seenIds.has(s.unitId)) {
            seenIds.add(s.unitId);
            out.push({ id: s.unitId, number: s.number, building: s.building, level: s.level });
        }
    }
    return out.sort((a, b) => String(a.number).localeCompare(String(b.number), undefined, { numeric: true }));
});

/* A suite may only be claimed once. The picker greys out taken ones rather
   than hiding them, so an operator can see why a suite is unavailable. */
const claimed = computed(() => {
    const m = new Map();
    for (const [ext, unitId] of Object.entries(chosen.value)) {
        if (unitId !== null && unitId !== undefined && unitId !== '') m.set(unitId, ext);
    }
    return m;
});

const decided = computed(() => Object.values(chosen.value).filter((v) => v !== null && v !== '').length);

/** Rows still wanting a human decision: anything not confident, plus leftovers. */
const needsReview = computed(() => {
    const pairs = (props.reconcile.pairs ?? []).filter((p) => p.confidence !== 'high' && p.confidence !== 'confirmed');
    const orphans = (props.reconcile.unmatchedFeed ?? []).map((f) => ({
        externalId: f.externalId,
        feedLabel: f.label,
        feedBuilding: f.building,
        unitId: null,
        confidence: 'none',
        reason: 'We could not find a suite that looks like this',
    }));
    return [...pairs, ...orphans];
});

const confidentPairs = computed(() =>
    (props.reconcile.pairs ?? []).filter((p) => p.confidence === 'high' || p.confidence === 'confirmed'));

const BADGE = {
    confirmed: { label: 'You matched this', cls: 'bg-brand-dark text-white' },
    high:      { label: 'Confident', cls: 'bg-forest-light text-forest' },
    medium:    { label: 'Probably', cls: 'bg-gold-light/70 text-plum' },
    low:       { label: 'Check this', cls: 'bg-gold-light text-plum' },
    none:      { label: 'No match', cls: 'bg-warm-dark text-ink-mid' },
};

/* ---------------------------------------------------------------- actions */

function acceptConfident() {
    for (const p of confidentPairs.value) chosen.value[p.externalId] = p.unitId;
    flash.value = { tone: 'ok', text: `${confidentPairs.value.length} confident match${confidentPairs.value.length === 1 ? '' : 'es'} accepted. Anything that needed a look is below.` };
}

function clearAll() {
    for (const k of Object.keys(chosen.value)) chosen.value[k] = null;
}

async function run(action, payload, message) {
    busy.value = action;
    flash.value = null;
    try {
        await props.submit(action, payload);
        if (message) flash.value = { tone: 'ok', text: message };
    } catch (err) {
        flash.value = { tone: 'error', text: err?.message || 'That did not save.' };
    } finally {
        busy.value = null;
    }
}

function save() {
    run('reconcile.save', { links: { ...chosen.value } },
        `${decided.value} room${decided.value === 1 ? '' : 's'} linked. From now on the sync matches on your management system's own ids, not room numbers.`);
}

const refresh = () => run('reconcile.refresh', {});
</script>

<template>
    <section id="reconcile" class="scroll-mt-24 space-y-4 rounded-[18px] border border-hairline bg-white p-5 shadow-card-soft sm:p-6">
        <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
                <h2 class="font-serif text-lg font-bold text-ink">Match your rooms</h2>
                <p class="mt-0.5 max-w-[62ch] text-[13px] text-ink-mid">
                    Pair each room in {{ reconcile.providerLabel }} with the suite on your floor plan.
                    You only do this once — afterwards the sync uses their own room ids, so renumbering
                    a wing can never point families at the wrong room.
                </p>
            </div>
            <button
                type="button"
                class="tap-safe rounded-lg border border-hairline px-3 py-2 text-[13px] font-semibold hover:bg-warm disabled:opacity-60"
                :disabled="busy === 'reconcile.refresh'"
                @click="refresh"
            >{{ busy === 'reconcile.refresh' ? 'Fetching…' : 'Fetch again' }}</button>
        </div>

        <p
            v-if="flash"
            class="rounded-[12px] px-3.5 py-2.5 text-[13.5px]"
            :class="flash.tone === 'error' ? 'bg-danger/10 text-danger' : 'bg-forest-light text-forest'"
            role="status"
            aria-live="polite"
        >{{ flash.text }}</p>

        <!-- what came back -->
        <dl class="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div v-for="s in [
                { k: 'Their rooms', v: reconcile.feedCount },
                { k: 'Your suites', v: reconcile.suiteCount },
                { k: 'Confident', v: (counts.high ?? 0) + (counts.confirmed ?? 0) },
                { k: 'Need a look', v: needsReview.length },
            ]" :key="s.k" class="rounded-[12px] border border-hairline bg-warm/40 px-3 py-2">
                <dt class="text-[11px] font-bold uppercase tracking-[1.1px] text-ink-light">{{ s.k }}</dt>
                <dd class="font-serif text-[20px] font-bold tabular-nums text-ink">{{ s.v }}</dd>
            </div>
        </dl>

        <!-- things that will quietly not work unless fixed -->
        <div
            v-if="reconcile.unknownStatuses?.length || reconcile.unreadable"
            class="rounded-[12px] border border-gold-dark/40 bg-gold-light/25 p-3.5 text-[13px]"
        >
            <p v-if="reconcile.unknownStatuses?.length" class="text-ink">
                <strong>We do not recognise some availability values yet:</strong>
                {{ reconcile.unknownStatuses.join(', ') }}.
                Rooms using them are left alone rather than guessed at, so they will not update until
                someone maps them.
            </p>
            <p v-if="reconcile.unreadable" class="mt-1 text-ink-mid">
                {{ reconcile.unreadable }} room{{ reconcile.unreadable === 1 ? '' : 's' }} came through without an
                availability we could read.
            </p>
        </div>

        <!-- the safe bulk action -->
        <div v-if="confidentPairs.length" class="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-hairline bg-warm/40 p-4">
            <div class="min-w-0">
                <p class="text-[14px] font-semibold text-ink">
                    {{ confidentPairs.length }} room{{ confidentPairs.length === 1 ? '' : 's' }} match without any doubt
                </p>
                <p class="mt-0.5 text-[12.5px] text-ink-mid">
                    Same number, same building, and no other suite comes close. Anything even slightly
                    ambiguous is held back for you below.
                </p>
            </div>
            <button
                type="button"
                class="tap-safe shrink-0 rounded-lg bg-brand px-4 py-2.5 text-[14px] font-semibold text-white hover:bg-brand-dark"
                @click="acceptConfident"
            >Accept these</button>
        </div>

        <!-- the work -->
        <div v-if="needsReview.length">
            <h3 class="mb-2 font-serif text-[15px] font-bold text-ink">Needs your eyes ({{ needsReview.length }})</h3>
            <ul class="space-y-2">
                <li
                    v-for="row in needsReview"
                    :key="row.externalId"
                    class="grid grid-cols-1 gap-2 rounded-[12px] border border-hairline p-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center"
                >
                    <div class="min-w-0">
                        <p class="text-[14px] font-semibold text-ink">{{ row.feedLabel }}</p>
                        <p class="text-[12px] text-ink-light">
                            {{ row.feedBuilding || 'No building given' }} · id {{ row.externalId }}
                        </p>
                        <p class="mt-0.5 text-[12px] text-ink-mid">{{ row.reason }}</p>
                    </div>

                    <span
                        class="justify-self-start rounded-full px-2.5 py-1 text-[11.5px] font-semibold sm:justify-self-center"
                        :class="BADGE[row.confidence]?.cls ?? BADGE.none.cls"
                    >{{ BADGE[row.confidence]?.label ?? 'Check this' }}</span>

                    <div>
                        <label class="sr-only" :for="`pick-${row.externalId}`">
                            Which suite is {{ row.feedLabel }}?
                        </label>
                        <select
                            :id="`pick-${row.externalId}`"
                            v-model="chosen[row.externalId]"
                            class="tap-safe w-full rounded-[10px] border-[1.5px] border-hairline bg-white px-2.5 py-2 text-[13.5px] text-ink outline-none transition focus:border-brand focus:ring-[3px] focus:ring-brand-light"
                        >
                            <option :value="null">Not on our map — skip it</option>
                            <option
                                v-for="s in allSuites"
                                :key="s.id"
                                :value="s.id"
                                :disabled="claimed.has(s.id) && claimed.get(s.id) !== row.externalId"
                            >
                                {{ s.number }}<template v-if="s.building"> — {{ s.building }}</template><template v-if="s.level">, {{ s.level }}</template>
                                <template v-if="claimed.has(s.id) && claimed.get(s.id) !== row.externalId"> (already taken)</template>
                            </option>
                        </select>
                    </div>
                </li>
            </ul>
        </div>

        <p v-else class="rounded-[12px] border border-hairline bg-forest-light/40 px-4 py-5 text-center text-[14px] text-forest">
            Nothing ambiguous — every room matched cleanly.
        </p>

        <!-- the rest, folded away -->
        <div v-if="confidentPairs.length">
            <button
                type="button"
                class="tap-safe text-[13.5px] font-semibold text-brand hover:underline"
                :aria-expanded="String(showMatched)"
                aria-controls="matched-list"
                @click="showMatched = !showMatched"
            >{{ showMatched ? 'Hide' : 'Show' }} the {{ confidentPairs.length }} that matched cleanly</button>

            <ul v-show="showMatched" id="matched-list" class="mt-2 space-y-1.5">
                <li
                    v-for="p in confidentPairs"
                    :key="p.externalId"
                    class="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-[10px] border border-hairline bg-warm/30 px-3 py-2 text-[13px]"
                >
                    <span class="truncate text-ink">{{ p.feedLabel }}</span>
                    <span aria-hidden="true" class="text-ink-light">→</span>
                    <span class="truncate text-ink">
                        {{ p.unitNumber }}
                        <span class="text-ink-light">{{ p.unitBuilding }}</span>
                    </span>
                </li>
            </ul>
        </div>

        <!-- suites their system does not know about -->
        <div v-if="reconcile.unmatchedSuites?.length" class="rounded-[12px] border border-hairline bg-warm/30 p-3.5">
            <p class="text-[13.5px] font-semibold text-ink">
                {{ reconcile.unmatchedSuites.length }} suite{{ reconcile.unmatchedSuites.length === 1 ? '' : 's' }} on your
                map that {{ reconcile.providerLabel }} did not send
            </p>
            <p class="mt-0.5 text-[12.5px] text-ink-mid">
                These stay under your control and keep whatever availability you set by hand. That is
                usually right for model suites and anything not in the rent roll.
            </p>
            <p class="mt-1.5 text-[12.5px] text-ink-light">
                {{ reconcile.unmatchedSuites.map((s) => s.number).join(', ') }}
            </p>
        </div>

        <!-- save -->
        <div class="flex flex-wrap items-center gap-3 border-t border-hairline pt-4">
            <button
                type="button"
                class="tap-safe rounded-lg bg-brand px-4 py-2.5 text-[14px] font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
                :disabled="busy === 'reconcile.save'"
                @click="save"
            >{{ busy === 'reconcile.save' ? 'Saving…' : `Link ${decided} room${decided === 1 ? '' : 's'}` }}</button>

            <button type="button" class="tap-safe text-[13px] font-semibold text-ink-mid underline hover:text-ink" @click="clearAll">
                Clear every choice
            </button>

            <p class="ml-auto text-[12.5px] text-ink-light">
                Nothing syncs until you save this.
            </p>
        </div>
    </section>
</template>
