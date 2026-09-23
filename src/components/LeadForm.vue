<script setup>
/*
 | Ask about a suite, or book a tour, without leaving the map.
 |
 | Two decisions worth defending:
 |
 | 1. It is SHORT. Five fields, one of which is optional. Senior living lead
 |    forms are famously long, and every extra field costs conversions from an
 |    audience that is often filling this in on a phone, for a parent, in a
 |    hurry. Everything else the sales team wants to know — care level, budget,
 |    timeframe — the map already knows from the suite and the filters, and it
 |    is sent along silently in `context`.
 |
 | 2. The suite is NAMED in the form. "I'm asking about Suite 214" is both a
 |    reassurance to the family and the single most useful thing the community
 |    receives. Generic "contact us" forms attached to a map are why sales
 |    counsellors ring back asking which apartment you meant.
 |
 | The component does not post anything itself: it emits a payload and lets the
 | host app decide. In the platform that means a POST to the existing leads
 | endpoint — see docs/INTEGRATION.md for the field mapping.
 */
import { computed, nextTick, ref, watch } from 'vue';
import { money } from '../lib/pricing.js';

const props = defineProps({
    unit:      { type: Object, default: null },
    community: { type: Object, required: true },
    intent:    { type: String, default: 'tour' },     // 'tour' | 'info'
    submitting:{ type: Boolean, default: false },
    error:     { type: String, default: null },
    sent:      { type: Boolean, default: false },
});
const emit = defineEmits(['close', 'submit']);

const form = ref(blank());
const dialog = ref(null);
const firstField = ref(null);
const doneBtn = ref(null);
const touched = ref(false);
let restoreTo = null;

function blank() {
    return {
        intent: props.intent,
        name: '',
        email: '',
        phone: '',
        preferred: 'either',      // email | phone | either
        relationship: 'parent',   // who the search is for
        tourDate: '',
        message: '',
        consent: false,
    };
}

/* --------------------------------------------------------------- validity */

const emailOk = computed(() => !form.value.email || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.value.email.trim()));
const errors = computed(() => {
    const e = {};
    const f = form.value;
    if (!f.name.trim()) e.name = 'Please tell us your name.';
    if (!f.email.trim() && !f.phone.trim()) e.email = 'An email address or a phone number, whichever you prefer.';
    else if (!emailOk.value) e.email = 'That email address does not look right.';
    if (f.intent === 'tour' && !f.tourDate) e.tourDate = 'Pick a day that suits you.';
    return e;
});
const valid = computed(() => Object.keys(errors.value).length === 0);

const today = new Date().toISOString().slice(0, 10);
const RELATIONSHIPS = [
    { key: 'parent', label: 'A parent' },
    { key: 'spouse', label: 'My husband or wife' },
    { key: 'self', label: 'Myself' },
    { key: 'other', label: 'Someone else' },
];

/* --------------------------------------------------------------- lifecycle */

watch(() => props.unit?.id, async (id) => {
    if (!id) return;
    form.value = blank();
    touched.value = false;
    restoreTo = document.activeElement;
    await nextTick();
    firstField.value?.focus();
});

/*
 | When the form is replaced by the confirmation, the element that had focus —
 | the submit button — is gone, and focus silently falls back to <body>. That
 | strands keyboard users outside the dialog (so Escape stops closing it) and
 | means a screen reader announces nothing at all after they hit submit. Move
 | focus onto the confirmation instead; the role="status" on it reads out.
 */
watch(() => props.sent, async (isSent) => {
    if (isSent) {
        await nextTick();
        doneBtn.value?.focus();
        return;
    }
    if (restoreTo?.isConnected) { restoreTo.focus?.(); restoreTo = null; }
});

function close() {
    if (restoreTo?.isConnected) { restoreTo.focus?.(); restoreTo = null; }
    emit('close');
}

function onKeydown(e) {
    if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab' || !dialog.value) return;
    const f = dialog.value.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])');
    if (!f.length) return;
    const [first, last] = [f[0], f[f.length - 1]];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

function submit() {
    touched.value = true;
    if (!valid.value) {
        /* Send focus to the first thing that is wrong, rather than just
           colouring it red and hoping. */
        nextTick(() => dialog.value?.querySelector('[aria-invalid="true"]')?.focus());
        return;
    }

    const u = props.unit;
    emit('submit', {
        ...form.value,
        name: form.value.name.trim(),
        email: form.value.email.trim(),
        phone: form.value.phone.trim(),
        message: form.value.message.trim(),
        /* Everything the community needs that the family never had to type. */
        context: {
            communityId: props.community.id,
            communitySlug: props.community.slug,
            communityName: props.community.name,
            unitId: u?.id ?? null,
            unitNumber: u?.number ?? null,
            layout: u?.layoutName ?? null,
            roomType: u?.roomType ?? null,
            building: u?.buildingName ?? null,
            level: u?.levelName ?? null,
            careLevels: u?.careLevels ?? [],
            status: u?.status ?? null,
            baseRate: u?.price ?? null,
            url: typeof window !== 'undefined' ? window.location.href : null,
        },
    });
}
</script>

<template>
    <div v-if="unit" class="lead-overlay" @click.self="close">
        <div
            ref="dialog"
            class="lead-dialog"
            role="dialog"
            aria-modal="true"
            :aria-labelledby="`lead-title-${unit.id}`"
            @keydown="onKeydown"
        >
            <!-- sent -->
            <div v-if="sent" class="p-6 text-center" role="status" aria-live="polite">
                <div class="mx-auto grid size-12 place-items-center rounded-full bg-brand-light text-[22px]" aria-hidden="true">✓</div>
                <h2 :id="`lead-title-${unit.id}`" class="mt-3 font-serif text-[22px] font-bold text-ink">Thank you — that's sent</h2>
                <p class="mt-2 text-[14px] leading-relaxed text-ink-mid">
                    Someone from {{ community.name }} will be in touch about
                    <strong class="text-ink">Suite {{ unit.number }}</strong>.
                    <template v-if="form.intent === 'tour' && form.tourDate">
                        They will confirm whether {{ form.tourDate }} works.
                    </template>
                </p>
                <button
                    ref="doneBtn"
                    type="button"
                    class="tap-safe mt-5 w-full rounded-brand bg-brand px-4 py-3 text-[15px] font-semibold text-white hover:bg-brand-dark"
                    @click="close"
                >Back to the map</button>
            </div>

            <!-- form -->
            <form v-else novalidate @submit.prevent="submit">
                <header class="flex items-start justify-between gap-3 border-b border-hairline px-5 py-4">
                    <div>
                        <h2 :id="`lead-title-${unit.id}`" class="font-serif text-[20px] font-bold leading-tight text-ink">
                            {{ form.intent === 'tour' ? 'Book a tour' : 'Ask about this suite' }}
                        </h2>
                        <p class="mt-0.5 text-[13.5px] text-ink-mid">
                            Suite {{ unit.number }} · {{ unit.layoutName }}
                            <template v-if="unit.headline.public && unit.headline.from">
                                · from {{ money(unit.headline.from) }}/mo
                            </template>
                        </p>
                    </div>
                    <button
                        type="button"
                        class="tap-safe -mr-1 shrink-0 rounded-brand border border-hairline px-3 text-[13px] font-semibold text-ink-mid hover:bg-warm"
                        @click="close"
                    >
                        <span aria-hidden="true">✕</span><span class="sr-only">Close</span>
                    </button>
                </header>

                <div class="max-h-[62vh] space-y-4 overflow-y-auto px-5 py-4">
                    <!-- what they want -->
                    <fieldset>
                        <legend class="mb-1.5 text-[11px] font-bold uppercase tracking-[1.2px] text-ink-light">What would you like?</legend>
                        <div class="flex gap-1.5">
                            <button
                                v-for="o in [{ k: 'tour', l: 'Visit in person' }, { k: 'info', l: 'Just send details' }]"
                                :key="o.k"
                                type="button"
                                class="tap-safe flex-1 rounded-brand border px-3 py-2.5 text-[14px] transition-colors"
                                :class="form.intent === o.k
                                    ? 'border-brand-dark bg-brand-dark text-white font-semibold'
                                    : 'border-hairline bg-white text-ink hover:bg-warm'"
                                :aria-pressed="String(form.intent === o.k)"
                                @click="form.intent = o.k"
                            >{{ o.l }}</button>
                        </div>
                    </fieldset>

                    <div v-if="form.intent === 'tour'">
                        <label for="lead-date" class="mb-1 block text-[13.5px] font-semibold text-ink">
                            A day that suits you
                        </label>
                        <input
                            id="lead-date"
                            v-model="form.tourDate"
                            type="date"
                            :min="today"
                            class="tap-safe w-full rounded-brand border px-3 py-2.5 text-[15px] text-ink"
                            :class="touched && errors.tourDate ? 'border-danger' : 'border-hairline'"
                            :aria-invalid="String(Boolean(touched && errors.tourDate))"
                            :aria-describedby="touched && errors.tourDate ? 'err-date' : undefined"
                        />
                        <p v-if="touched && errors.tourDate" id="err-date" class="mt-1 text-[12.5px] text-danger">{{ errors.tourDate }}</p>
                        <p v-else class="mt-1 text-[12.5px] text-ink-light">We'll confirm a time with you — nothing is booked yet.</p>
                    </div>

                    <!-- who -->
                    <div>
                        <label for="lead-rel" class="mb-1 block text-[13.5px] font-semibold text-ink">Who is this for?</label>
                        <select
                            id="lead-rel"
                            v-model="form.relationship"
                            class="tap-safe w-full rounded-brand border border-hairline px-3 py-2.5 text-[15px] text-ink"
                        >
                            <option v-for="r in RELATIONSHIPS" :key="r.key" :value="r.key">{{ r.label }}</option>
                        </select>
                    </div>

                    <div>
                        <label for="lead-name" class="mb-1 block text-[13.5px] font-semibold text-ink">Your name</label>
                        <input
                            id="lead-name"
                            ref="firstField"
                            v-model="form.name"
                            type="text"
                            autocomplete="name"
                            class="tap-safe w-full rounded-brand border px-3 py-2.5 text-[15px] text-ink"
                            :class="touched && errors.name ? 'border-danger' : 'border-hairline'"
                            :aria-invalid="String(Boolean(touched && errors.name))"
                            :aria-describedby="touched && errors.name ? 'err-name' : undefined"
                        />
                        <p v-if="touched && errors.name" id="err-name" class="mt-1 text-[12.5px] text-danger">{{ errors.name }}</p>
                    </div>

                    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                            <label for="lead-email" class="mb-1 block text-[13.5px] font-semibold text-ink">Email</label>
                            <input
                                id="lead-email"
                                v-model="form.email"
                                type="email"
                                autocomplete="email"
                                inputmode="email"
                                class="tap-safe w-full rounded-brand border px-3 py-2.5 text-[15px] text-ink"
                                :class="touched && errors.email ? 'border-danger' : 'border-hairline'"
                                :aria-invalid="String(Boolean(touched && errors.email))"
                                :aria-describedby="touched && errors.email ? 'err-email' : undefined"
                            />
                        </div>
                        <div>
                            <label for="lead-phone" class="mb-1 block text-[13.5px] font-semibold text-ink">Phone</label>
                            <input
                                id="lead-phone"
                                v-model="form.phone"
                                type="tel"
                                autocomplete="tel"
                                inputmode="tel"
                                class="tap-safe w-full rounded-brand border border-hairline px-3 py-2.5 text-[15px] text-ink"
                            />
                        </div>
                    </div>
                    <p v-if="touched && errors.email" id="err-email" class="-mt-2 text-[12.5px] text-danger">{{ errors.email }}</p>

                    <fieldset>
                        <legend class="mb-1.5 text-[13.5px] font-semibold text-ink">How should they reach you?</legend>
                        <div class="flex gap-1.5">
                            <button
                                v-for="o in [{ k: 'phone', l: 'Call me' }, { k: 'email', l: 'Email me' }, { k: 'either', l: 'Either' }]"
                                :key="o.k"
                                type="button"
                                class="tap-safe flex-1 rounded-brand border px-2 py-2 text-[13.5px] transition-colors"
                                :class="form.preferred === o.k
                                    ? 'border-brand-dark bg-brand-dark text-white font-semibold'
                                    : 'border-hairline bg-white text-ink hover:bg-warm'"
                                :aria-pressed="String(form.preferred === o.k)"
                                @click="form.preferred = o.k"
                            >{{ o.l }}</button>
                        </div>
                    </fieldset>

                    <div>
                        <label for="lead-msg" class="mb-1 block text-[13.5px] font-semibold text-ink">
                            Anything they should know? <span class="font-normal text-ink-light">(optional)</span>
                        </label>
                        <textarea
                            id="lead-msg"
                            v-model="form.message"
                            rows="3"
                            class="w-full rounded-brand border border-hairline px-3 py-2.5 text-[15px] text-ink"
                            placeholder="Mobility, memory, timing — whatever matters most."
                        />
                    </div>

                    <p v-if="error" class="rounded-brand bg-danger/10 px-3 py-2 text-[13px] text-danger" role="alert">{{ error }}</p>
                </div>

                <footer class="border-t border-hairline px-5 py-4">
                    <button
                        type="submit"
                        class="tap-safe w-full rounded-brand bg-brand px-4 py-3 text-[15px] font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
                        :disabled="submitting"
                    >{{ submitting ? 'Sending…' : form.intent === 'tour' ? 'Request this tour' : 'Send my question' }}</button>
                    <p class="mt-2 text-center text-[12px] text-ink-light">
                        Goes straight to {{ community.name }}. No placement fees, no call centre.
                    </p>
                </footer>
            </form>
        </div>
    </div>
</template>

<style scoped>
.lead-overlay {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: grid;
    place-items: end center;
    background: rgba(31, 42, 51, 0.55);
    padding: 0;
}
@media (min-width: 640px) {
    .lead-overlay { place-items: center; padding: 1rem; }
}

.lead-dialog {
    width: 100%;
    max-width: 30rem;
    background: #fff;
    border-radius: var(--radius-card) var(--radius-card) 0 0;
    box-shadow: var(--shadow-map-panel);
    max-height: 92vh;
    overflow: hidden;
}
@media (min-width: 640px) {
    .lead-dialog { border-radius: var(--radius-card); }
}
</style>
