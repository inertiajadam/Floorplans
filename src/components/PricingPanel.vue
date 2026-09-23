<script setup>
/*
 | What a month actually costs, worked out in front of the family.
 |
 | This is the single biggest thing a multifamily map cannot do, and the reason
 | this project exists. An apartment has a rent. A senior living suite has a
 | rent, a care charge set by a nurse's assessment, a second person fee if a
 | couple is moving in, optional extras, and a one-time community fee that is
 | often a month's rent again. Families routinely discover the last four on the
 | first invoice.
 |
 | So: the suite rate is the starting figure, the care level is a control the
 | family moves themselves, and the total updates as they do. No modal, no
 | "contact us for pricing" where a number could be shown, and an explicit line
 | saying the care level is confirmed by assessment — because it is, and
 | pretending otherwise is how the industry lost people's trust.
 |
 | When the community keeps rates private (pricing_public = false on the
 | listing) the same structure renders with the figures withheld, so the family
 | still learns WHAT they will be charged for even when they must ring to find
 | out how much.
 */
import { computed, ref, watch } from 'vue';
import { money, quote, tiersFor } from '../lib/pricing.js';

const props = defineProps({
    unit:      { type: Object, required: true },
    community: { type: Object, required: true },
});

const careLevel = computed(() => props.unit.careLevels?.[0] ?? null);
const tiers = computed(() => tiersFor(props.community, careLevel.value));

const tier = ref(null);
const secondPerson = ref(false);
const addOns = ref([]);

/* Default to the middle tier rather than the cheapest: it is the honest
   starting point, and anchoring on the cheapest is the behaviour we are
   trying to replace. */
watch(tiers, (list) => {
    tier.value = list.length ? list[Math.floor(list.length / 2)].key : null;
}, { immediate: true });

/* A new suite means new defaults. */
watch(() => props.unit.id, () => {
    secondPerson.value = false;
    addOns.value = [];
});

const q = computed(() => quote(props.unit, props.community, {
    careLevel: careLevel.value,
    tier: tier.value,
    secondPerson: secondPerson.value,
    addOns: addOns.value,
}));

const hasTiers = computed(() => tiers.value.length > 1);
const secondPersonFee = computed(() => Number(props.community?.fees?.secondPerson) || 0);

function toggleAddOn(key) {
    const i = addOns.value.indexOf(key);
    if (i === -1) addOns.value.push(key);
    else addOns.value.splice(i, 1);
}
</script>

<template>
    <section aria-labelledby="pricing-heading" class="rounded-card border border-hairline bg-warm/60 p-4">
        <h3 id="pricing-heading" class="font-serif text-[17px] font-bold text-ink">What this costs a month</h3>

        <!-- rates withheld: show the structure, not the numbers -->
        <template v-if="!q.public">
            <p class="mt-1.5 text-[13.5px] text-ink-mid">
                {{ community.name }} shares its rates directly rather than publishing them.
                A month here is made up of the suite rate, a care charge set by an assessment before
                move-in<template v-if="secondPersonFee">, and a second person fee if two of you are moving in</template>.
            </p>
        </template>

        <template v-else>
            <!-- care level: the control that changes everything -->
            <div v-if="hasTiers" class="mt-3">
                <label for="care-tier" class="mb-1 block text-[11px] font-bold uppercase tracking-[1.2px] text-ink-light">
                    Level of care
                </label>
                <select
                    id="care-tier"
                    v-model="tier"
                    class="tap-safe w-full rounded-brand border border-hairline bg-white px-3 py-2 text-[14px] text-ink"
                >
                    <option v-for="t in tiers" :key="t.key" :value="t.key">
                        {{ t.label }}{{ t.monthly ? ` — +${money(t.monthly)}/mo` : '' }}
                    </option>
                </select>
                <p v-if="q.tier?.description" class="mt-1 text-[12.5px] text-ink-mid">{{ q.tier.description }}</p>
            </div>

            <!-- second person -->
            <label v-if="secondPersonFee" class="tap-safe mt-3 flex cursor-pointer items-center gap-2.5 text-[14px] text-ink">
                <input v-model="secondPerson" type="checkbox" class="size-5 rounded accent-[var(--color-brand)]" />
                <span>Two people moving in <span class="text-ink-mid">(+{{ money(secondPersonFee) }}/mo)</span></span>
            </label>

            <!-- extras -->
            <fieldset v-if="community.addOns?.length" class="mt-3">
                <legend class="mb-1.5 text-[11px] font-bold uppercase tracking-[1.2px] text-ink-light">Optional extras</legend>
                <div class="flex flex-wrap gap-1.5">
                    <button
                        v-for="a in community.addOns"
                        :key="a.key"
                        type="button"
                        class="tap-safe rounded-brand border px-2.5 py-1.5 text-[12.5px] transition-colors"
                        :class="addOns.includes(a.key)
                            ? 'border-brand-dark bg-brand-dark text-white font-semibold'
                            : 'border-hairline bg-white text-ink-mid hover:bg-white'"
                        :aria-pressed="String(addOns.includes(a.key))"
                        @click="toggleAddOn(a.key)"
                    >{{ a.label }} +{{ money(a.monthly) }}</button>
                </div>
            </fieldset>

            <!-- the sum -->
            <dl class="mt-4 border-t border-hairline pt-3 text-[14px]">
                <div v-for="line in q.lines" :key="line.key" class="flex items-baseline justify-between gap-3 py-1">
                    <dt class="text-ink-mid">{{ line.label }}</dt>
                    <dd class="shrink-0 font-semibold tabular-nums text-ink">
                        {{ line.amount === null ? 'on request' : money(line.amount) }}
                    </dd>
                </div>

                <div class="mt-2 flex items-baseline justify-between gap-3 border-t border-hairline pt-2.5">
                    <dt class="font-serif text-[16px] font-bold text-ink">Monthly total</dt>
                    <dd class="shrink-0 font-serif text-[22px] font-bold tabular-nums text-brand-dark">
                        {{ q.monthly === null ? 'on request' : money(q.monthly) }}
                    </dd>
                </div>
            </dl>

            <!-- the one-time charges nobody mentions until move-in day -->
            <dl v-if="q.oneTime.length" class="mt-3 rounded-brand bg-white p-3 text-[13px]">
                <div v-for="o in q.oneTime" :key="o.key" class="flex items-baseline justify-between gap-3 py-0.5">
                    <dt class="text-ink-mid">{{ o.label }}</dt>
                    <dd class="shrink-0 font-semibold tabular-nums text-ink">{{ money(o.amount) }}</dd>
                </div>
            </dl>
        </template>

        <p class="mt-3 text-[12px] leading-relaxed text-ink-light">
            <template v-if="hasTiers && q.public">
                The care level shown is an estimate you have chosen. The actual level is set by a nurse
                assessment before move-in and can change as needs change.
            </template>
            <template v-else-if="q.public">
                Care is included in the rate for this suite.
            </template>
            <template v-if="community.legalNote"> {{ community.legalNote }}</template>
        </p>
    </section>
</template>
