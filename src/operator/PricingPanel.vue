<script setup>
/*
 | Owner portal: levels of care, fees, and how fresh to look.
 |
 | The platform has never been able to store "Level 2 care is $1,150 a month",
 | which is why a listing can only ever advertise a starting rate. That gap is
 | the reason families say the industry is opaque about money — the advertised
 | figure and the first invoice are different numbers and nobody told them.
 |
 | Filling this in is a chore, so the panel earns it two ways:
 |
 |   1. A LIVE PREVIEW of the exact line families will read, updating as they
 |      type. Operators fill in fields when they can see what the fields do.
 |   2. It argues the case in plain language — being the listing that shows a
 |      real number is a competitive advantage over one that says "call us".
 |
 | Nothing here is mandatory. A community with no tiers still gets a working
 | map; it just shows the suite rate alone, which is where we started.
 */
import { computed, ref, watch } from 'vue';
import { money } from '../lib/pricing.js';
import { CARE_LEVELS } from '../lib/model.js';

const props = defineProps({
    map:    { type: Object, required: true },
    submit: { type: Function, required: true },
});

const CARE_KEYS = CARE_LEVELS.map((c) => c.key);

const tiers = ref(clone(props.map.tiers ?? []));
const fees = ref({
    community_fee: props.map.settings?.community_fee ?? '',
    second_person_fee: props.map.settings?.second_person_fee ?? '',
    pet_deposit: props.map.settings?.pet_deposit ?? '',
    legal_note: props.map.settings?.legal_note ?? '',
    freshness_days: props.map.settings?.freshness_days ?? 30,
    show_confirmed_at: props.map.settings?.show_confirmed_at ?? true,
    add_ons: clone(props.map.settings?.add_ons ?? []),
});

const savingTiers = ref(false);
const savingFees = ref(false);
const flash = ref(null);

watch(() => props.map.tiers, (t) => { tiers.value = clone(t ?? []); });

function clone(v) {
    return JSON.parse(JSON.stringify(v ?? []));
}

/* ----------------------------------------------------------------- tiers */

function addTier() {
    const n = tiers.value.length + 1;
    tiers.value.push({
        key: `level-${n}`,
        label: `Level ${n}`,
        monthly: 0,
        care_levels: ['al'],
        description: '',
    });
}

function removeTier(i) {
    tiers.value.splice(i, 1);
}

function toggleCare(tier, key) {
    const i = tier.care_levels.indexOf(key);
    i === -1 ? tier.care_levels.push(key) : tier.care_levels.splice(i, 1);
}

const duplicateKeys = computed(() => {
    const seen = new Set();
    const dupes = new Set();
    for (const t of tiers.value) {
        const k = (t.key ?? '').trim().toLowerCase();
        if (!k) continue;
        seen.has(k) ? dupes.add(k) : seen.add(k);
    }
    return dupes;
});

async function saveTiers() {
    if (duplicateKeys.value.size) {
        flash.value = { tone: 'error', text: 'Two levels share the same key. Each needs its own.' };
        return;
    }
    savingTiers.value = true;
    flash.value = null;
    try {
        await props.submit('tiers.save', { tiers: tiers.value });
        flash.value = { tone: 'ok', text: 'Levels of care saved.' };
    } catch (err) {
        flash.value = { tone: 'error', text: err?.message || 'That did not save.' };
    } finally {
        savingTiers.value = false;
    }
}

/* ------------------------------------------------------------------ fees */

function addExtra() {
    fees.value.add_ons.push({ key: `extra-${fees.value.add_ons.length + 1}`, label: '', monthly: 0 });
}

async function saveFees() {
    savingFees.value = true;
    flash.value = null;
    try {
        await props.submit('settings.save', {
            ...fees.value,
            community_fee: num(fees.value.community_fee),
            second_person_fee: num(fees.value.second_person_fee),
            pet_deposit: num(fees.value.pet_deposit),
            add_ons: fees.value.add_ons.filter((a) => a.label.trim()),
        });
        flash.value = { tone: 'ok', text: 'Pricing details saved.' };
    } catch (err) {
        flash.value = { tone: 'error', text: err?.message || 'That did not save.' };
    } finally {
        savingFees.value = false;
    }
}

const num = (v) => (v === '' || v === null ? null : Number(v));

/* --------------------------------------------------------------- preview */

/**
 * The exact line a family reads on the listing, from the operator's own
 * numbers. "Typical" uses the median tier rather than the cheapest — the
 * cheapest is what makes an advertised rate misleading in the first place.
 */
const preview = computed(() => {
    const cheapest = (props.map.units ?? [])
        .map((u) => u.baseRate)
        .filter((n) => Number.isFinite(n) && n > 0)
        .sort((a, b) => a - b)[0] ?? null;

    if (!props.map.pricingPublic) {
        return { hidden: true, from: null, typical: null };
    }
    if (!cheapest) return { hidden: false, from: null, typical: null };

    const applicable = tiers.value
        .filter((t) => Number(t.monthly) > 0)
        .sort((a, b) => Number(a.monthly) - Number(b.monthly));
    const median = applicable.length ? applicable[Math.floor(applicable.length / 2)] : null;

    return {
        hidden: false,
        from: cheapest,
        typical: median ? cheapest + Number(median.monthly) : null,
        tierLabel: median?.label ?? null,
    };
});

const fieldClass = 'tap-safe w-full rounded-[10px] border-[1.5px] border-hairline bg-white px-2.5 py-2 text-[13.5px] text-ink outline-none transition focus:border-brand focus:ring-[3px] focus:ring-brand-light';
</script>

<template>
    <section id="map-pricing" class="scroll-mt-24 space-y-5 rounded-[18px] border border-hairline bg-white p-5 shadow-card-soft sm:p-6">
        <div>
            <h2 class="font-serif text-lg font-bold text-ink">Levels of care &amp; fees</h2>
            <p class="mt-0.5 text-[13px] text-ink-mid">
                What a month actually costs, beyond the suite rate. Families rank “I could see real numbers”
                above almost everything else, and most listings cannot show it.
            </p>
        </div>

        <p
            v-if="flash"
            class="rounded-[12px] px-3.5 py-2.5 text-[13.5px]"
            :class="flash.tone === 'error' ? 'bg-danger/10 text-danger' : 'bg-forest-light text-forest'"
            role="status"
            aria-live="polite"
        >{{ flash.text }}</p>

        <!-- ------------------------------------------------------ preview -->
        <div class="rounded-[12px] border border-brand-mid bg-brand-light/40 p-4">
            <p class="text-[11px] font-bold uppercase tracking-[1.2px] text-ink-light">What families will read</p>
            <template v-if="preview.hidden">
                <p class="mt-1 font-serif text-[17px] font-bold text-ink">Pricing on request</p>
                <p class="text-[12.5px] text-ink-mid">Your listing keeps rates private, so no figures are shown.</p>
            </template>
            <template v-else-if="!preview.from">
                <p class="mt-1 font-serif text-[17px] font-bold text-ink">Inquire for pricing</p>
                <p class="text-[12.5px] text-ink-mid">No suite rates set yet, so the map cannot show a starting figure.</p>
            </template>
            <template v-else>
                <p class="mt-1 font-serif text-[17px] font-bold text-ink">
                    From {{ money(preview.from) }}/mo
                </p>
                <p v-if="preview.typical" class="text-[13px] text-ink-mid">
                    “Most residents here pay about <strong class="text-ink">{{ money(preview.typical) }}</strong> with care”
                    <span class="text-ink-light">— suite rate plus {{ preview.tierLabel }}</span>
                </p>
                <p v-else class="text-[13px] text-gold-dark">
                    Add a level of care below and families will also see what a typical resident pays —
                    which is the number they are really asking for.
                </p>
            </template>
        </div>

        <!-- -------------------------------------------------------- tiers -->
        <div>
            <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 class="font-serif text-[15px] font-bold text-ink">Levels of care</h3>
                <button type="button" class="tap-safe rounded-lg border border-hairline px-3 py-2 text-[13px] font-semibold hover:bg-warm" @click="addTier">
                    Add a level
                </button>
            </div>

            <p v-if="!tiers.length" class="rounded-[12px] border border-dashed border-hairline px-4 py-5 text-[13.5px] text-ink-mid">
                No levels set. Assisted living is usually sold in tiers after a nurse assessment — adding them
                lets the map show a real monthly figure instead of a starting rate.
            </p>

            <ul v-else class="space-y-2">
                <li v-for="(t, i) in tiers" :key="i" class="rounded-[12px] border border-hairline p-3">
                    <div class="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_120px_auto]">
                        <label class="text-[11.5px] font-semibold text-ink-light">
                            Name
                            <input v-model="t.label" :class="fieldClass" class="mt-0.5 font-normal" placeholder="Level 2" />
                        </label>
                        <label class="text-[11.5px] font-semibold text-ink-light">
                            Key
                            <input
                                v-model="t.key"
                                :class="[fieldClass, duplicateKeys.has((t.key || '').trim().toLowerCase()) ? '!border-danger' : '']"
                                class="mt-0.5 font-mono font-normal"
                                placeholder="al-2"
                            />
                        </label>
                        <label class="text-[11.5px] font-semibold text-ink-light">
                            Per month
                            <input v-model.number="t.monthly" type="number" min="0" :class="fieldClass" class="mt-0.5 font-normal tabular-nums" />
                        </label>
                        <div class="flex items-end">
                            <button
                                type="button"
                                class="tap-safe rounded-lg border border-danger px-3 py-2 text-[12.5px] font-semibold text-danger hover:bg-danger/10"
                                @click="removeTier(i)"
                            >
                                <span aria-hidden="true">Remove</span>
                                <span class="sr-only">Remove the {{ t.label || 'unnamed' }} level of care</span>
                            </button>
                        </div>
                    </div>

                    <label class="mt-2 block text-[11.5px] font-semibold text-ink-light">
                        What it covers <span class="font-normal">(families read this)</span>
                        <input v-model="t.description" :class="fieldClass" class="mt-0.5 font-normal" placeholder="Daily help with dressing, bathing and getting about." />
                    </label>

                    <fieldset class="mt-2">
                        <legend class="text-[11.5px] font-semibold text-ink-light">Applies to</legend>
                        <div class="mt-1 flex flex-wrap gap-1.5">
                            <label
                                v-for="c in CARE_LEVELS"
                                :key="c.key"
                                class="flex cursor-pointer items-center gap-1.5 rounded-lg border border-hairline px-2.5 py-1.5 text-[12.5px]"
                            >
                                <input
                                    type="checkbox"
                                    class="size-3.5 accent-[var(--color-brand)]"
                                    :checked="t.care_levels?.includes(c.key)"
                                    @change="toggleCare(t, c.key)"
                                />
                                {{ c.short }}
                            </label>
                        </div>
                    </fieldset>
                </li>
            </ul>

            <button
                v-if="tiers.length"
                type="button"
                class="tap-safe mt-3 rounded-lg bg-brand px-4 py-2.5 text-[14px] font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
                :disabled="savingTiers"
                @click="saveTiers"
            >{{ savingTiers ? 'Saving…' : 'Save levels of care' }}</button>
        </div>

        <!-- --------------------------------------------------------- fees -->
        <div class="border-t border-hairline pt-5">
            <h3 class="mb-2 font-serif text-[15px] font-bold text-ink">Fees</h3>

            <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label class="text-[11.5px] font-semibold text-ink-light">
                    Community fee <span class="font-normal">(one time)</span>
                    <input v-model="fees.community_fee" type="number" min="0" :class="fieldClass" class="mt-0.5 font-normal tabular-nums" />
                </label>
                <label class="text-[11.5px] font-semibold text-ink-light">
                    Second person <span class="font-normal">(per month)</span>
                    <input v-model="fees.second_person_fee" type="number" min="0" :class="fieldClass" class="mt-0.5 font-normal tabular-nums" />
                </label>
                <label class="text-[11.5px] font-semibold text-ink-light">
                    Pet deposit <span class="font-normal">(one time)</span>
                    <input v-model="fees.pet_deposit" type="number" min="0" :class="fieldClass" class="mt-0.5 font-normal tabular-nums" />
                </label>
            </div>

            <div class="mt-3">
                <div class="mb-1.5 flex items-center justify-between">
                    <span class="text-[11.5px] font-semibold text-ink-light">Optional extras</span>
                    <button type="button" class="text-[12.5px] font-semibold text-brand hover:underline" @click="addExtra">Add an extra</button>
                </div>
                <ul v-if="fees.add_ons.length" class="space-y-2">
                    <li v-for="(a, i) in fees.add_ons" :key="i" class="grid grid-cols-[1fr_110px_auto] gap-2">
                        <label class="sr-only" :for="`extra-label-${i}`">Extra name</label>
                        <input :id="`extra-label-${i}`" v-model="a.label" :class="fieldClass" placeholder="Covered parking" />
                        <label class="sr-only" :for="`extra-cost-${i}`">Cost per month</label>
                        <input :id="`extra-cost-${i}`" v-model.number="a.monthly" type="number" min="0" :class="fieldClass" class="tabular-nums" />
                        <button
                            type="button"
                            class="tap-safe rounded-lg border border-hairline px-2.5 text-[12.5px] text-ink-mid hover:bg-warm"
                            @click="fees.add_ons.splice(i, 1)"
                        >
                            <span aria-hidden="true">×</span>
                            <span class="sr-only">Remove {{ a.label || 'this extra' }}</span>
                        </button>
                    </li>
                </ul>
            </div>

            <label class="mt-3 block text-[11.5px] font-semibold text-ink-light">
                Small print shown under the figures
                <textarea v-model="fees.legal_note" rows="2" :class="fieldClass" class="mt-0.5 font-normal" placeholder="Rates are current today and are a starting point. The care charge is set by an assessment before move-in." />
            </label>
        </div>

        <!-- ---------------------------------------------------- freshness -->
        <div class="border-t border-hairline pt-5">
            <h3 class="mb-1 font-serif text-[15px] font-bold text-ink">Keeping it current</h3>
            <p class="mb-3 text-[13px] text-ink-mid">
                A map showing a suite that went last week costs you more trust than having no map at all.
            </p>

            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label class="text-[11.5px] font-semibold text-ink-light">
                    Remind me when availability is older than
                    <select v-model.number="fees.freshness_days" :class="fieldClass" class="mt-0.5 font-normal">
                        <option :value="7">a week</option>
                        <option :value="14">a fortnight</option>
                        <option :value="30">a month</option>
                        <option :value="60">two months</option>
                        <option :value="90">three months</option>
                    </select>
                </label>

                <label class="flex cursor-pointer items-start gap-2.5 pt-5 text-[13.5px] text-ink">
                    <input v-model="fees.show_confirmed_at" type="checkbox" class="mt-0.5 size-5 rounded accent-[var(--color-brand)]" />
                    <span>
                        Show families when this was last confirmed
                        <span class="block text-[12.5px] text-ink-light">
                            “Availability confirmed 2 days ago” on your listing. A strong reason to pick you —
                            if you keep on top of it.
                        </span>
                    </span>
                </label>
            </div>

            <button
                type="button"
                class="tap-safe mt-3 rounded-lg bg-brand px-4 py-2.5 text-[14px] font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
                :disabled="savingFees"
                @click="saveFees"
            >{{ savingFees ? 'Saving…' : 'Save fees &amp; settings' }}</button>
        </div>
    </section>
</template>
