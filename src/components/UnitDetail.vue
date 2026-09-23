<script setup>
/*
 | The suite drawer.
 |
 | A side panel on a desktop, a bottom sheet on a phone — same component, same
 | markup, one media query. It is a real modal dialog: focus moves into it,
 | Tab is trapped inside it, Escape closes it, and focus returns to whatever
 | opened it. Most embedded maps get the last part wrong, which strands
 | keyboard users at the top of the page every time they close a unit.
 |
 | Order of content follows the order families ask: what is it, can I have it,
 | what does it cost, can I see it, who do I talk to.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import StatusPill from './StatusPill.vue';
import PricingPanel from './PricingPanel.vue';
import { statusDetail } from '../lib/availability.js';

const props = defineProps({
    unit:      { type: Object, default: null },
    community: { type: Object, required: true },
    comparing: { type: Boolean, default: false },
    compareDisabled: { type: Boolean, default: false },
    shareUrl:  { type: String, default: '' },
});
const emit = defineEmits(['close', 'compare', 'enquire']);

const panel = ref(null);
const closeBtn = ref(null);
const copied = ref(false);
let restoreTo = null;

const specs = computed(() => {
    const u = props.unit;
    if (!u) return [];
    return [
        u.typeLabel ? { k: 'Layout', v: `${u.layoutName} · ${u.typeLabel}` } : null,
        u.sqft ? { k: 'Size', v: `about ${Number(u.sqft).toLocaleString()} sq ft` } : null,
        u.bedrooms !== null ? { k: 'Bedrooms', v: Number(u.bedrooms) === 0 ? 'Studio' : String(Number(u.bedrooms)) } : null,
        u.bathrooms ? { k: 'Bathrooms', v: String(Number(u.bathrooms)) } : null,
        { k: 'Where', v: [u.buildingName, u.levelName].filter(Boolean).join(', ') },
        u.view ? { k: 'Outlook', v: u.view } : null,
        u.accessible ? { k: 'Access', v: 'Step-free, roll-in shower' } : null,
    ].filter(Boolean);
});

/* ------------------------------------------------------------ dialog plumbing */

watch(() => props.unit?.id, async (id, was) => {
    if (id && !was) restoreTo = document.activeElement;
    if (id) {
        await nextTick();
        closeBtn.value?.focus();
    } else if (restoreTo?.isConnected) {
        restoreTo.focus?.();
        restoreTo = null;
    }
});

function onKeydown(e) {
    if (e.key === 'Escape') {
        e.stopPropagation();
        emit('close');
        return;
    }
    if (e.key !== 'Tab' || !panel.value) return;

    const focusables = panel.value.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

async function copyLink() {
    try {
        await navigator.clipboard.writeText(props.shareUrl);
        copied.value = true;
        setTimeout(() => { copied.value = false; }, 2400);
    } catch {
        /* Clipboard is blocked in some embedded contexts; the input below is
           still selectable, so there is always a way to get the link. */
    }
}

onBeforeUnmount(() => { restoreTo = null; });
</script>

<template>
    <Transition name="sheet">
        <div
            v-if="unit"
            ref="panel"
            class="unit-detail"
            role="dialog"
            aria-modal="true"
            :aria-label="`Suite ${unit.number}, ${unit.layoutName}`"
            @keydown="onKeydown"
        >
            <!-- header stays put while the body scrolls -->
            <header class="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-hairline bg-white px-4 py-3">
                <div class="min-w-0">
                    <h2 class="font-serif text-[22px] font-bold leading-tight text-ink">Suite {{ unit.number }}</h2>
                    <p class="truncate text-[13.5px] text-ink-mid">{{ unit.layoutName }} · {{ unit.buildingName }}</p>
                </div>
                <button
                    ref="closeBtn"
                    type="button"
                    class="tap-safe -mr-1 shrink-0 rounded-brand border border-hairline px-3 text-[13px] font-semibold text-ink-mid hover:bg-warm"
                    @click="emit('close')"
                >
                    <span aria-hidden="true">✕</span>
                    <span class="sr-only">Close this suite</span>
                </button>
            </header>

            <div class="flex-1 overflow-y-auto overscroll-contain px-4 pb-28 pt-4">
                <!-- status first: it decides whether the rest matters -->
                <div class="rounded-card border border-hairline bg-white p-3">
                    <StatusPill :status="unit.status" size="md" />
                    <p class="mt-1 text-[13.5px] text-ink-mid">{{ statusDetail(unit) }}</p>
                </div>

                <!-- the plan -->
                <figure v-if="unit.image" class="mt-4 overflow-hidden rounded-card border border-hairline bg-warm">
                    <img
                        :src="unit.image"
                        :alt="`Floor plan of the ${unit.layoutName} layout, suite ${unit.number}`"
                        class="h-auto w-full object-contain"
                        loading="lazy"
                        decoding="async"
                    />
                </figure>
                <div v-else class="mt-4 grid place-items-center rounded-card border border-dashed border-hairline bg-warm px-4 py-8 text-center">
                    <p class="text-[13px] text-ink-light">
                        No plan drawing for this layout yet.<br />
                        The shape on the map is the real footprint of the suite.
                    </p>
                </div>

                <a
                    v-if="unit.tourUrl"
                    :href="unit.tourUrl"
                    target="_blank"
                    rel="noopener"
                    class="tap-safe mt-2 inline-flex items-center gap-2 text-[13.5px] font-semibold text-brand hover:underline"
                >Walk through this layout in 3D <span aria-hidden="true">→</span></a>

                <p v-if="unit.description" class="mt-3 text-[14px] leading-relaxed text-ink-mid">{{ unit.description }}</p>

                <!-- specs -->
                <dl class="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5">
                    <div v-for="s in specs" :key="s.k">
                        <dt class="text-[11px] font-bold uppercase tracking-[1.1px] text-ink-light">{{ s.k }}</dt>
                        <dd class="text-[14px] text-ink">{{ s.v }}</dd>
                    </div>
                </dl>

                <ul v-if="unit.features?.length" class="mt-3 flex flex-wrap gap-1.5">
                    <li
                        v-for="f in unit.features"
                        :key="f"
                        class="rounded-full bg-brand-light px-2.5 py-1 text-[12.5px] text-brand-dark"
                    >{{ f }}</li>
                </ul>

                <!-- the money -->
                <div class="mt-5">
                    <PricingPanel :unit="unit" :community="community" />
                </div>

                <!-- share: the thing an iframe map can never do properly -->
                <div class="mt-4 rounded-card border border-hairline bg-white p-3">
                    <label :for="`share-${unit.id}`" class="mb-1 block text-[11px] font-bold uppercase tracking-[1.2px] text-ink-light">
                        Send this suite to someone
                    </label>
                    <div class="flex gap-2">
                        <input
                            :id="`share-${unit.id}`"
                            :value="shareUrl"
                            readonly
                            class="min-w-0 flex-1 rounded-brand border border-hairline bg-warm px-2.5 py-2 text-[12.5px] text-ink-mid"
                            @focus="$event.target.select()"
                        />
                        <button
                            type="button"
                            class="tap-safe shrink-0 rounded-brand border border-hairline px-3 text-[13px] font-semibold text-ink hover:bg-warm"
                            @click="copyLink"
                        >{{ copied ? 'Copied' : 'Copy' }}</button>
                    </div>
                    <p class="mt-1 text-[12px] text-ink-light">Opens straight to this suite, on any device.</p>
                </div>
            </div>

            <!-- the ask, always reachable -->
            <footer class="absolute inset-x-0 bottom-0 flex gap-2 border-t border-hairline bg-white px-4 py-3">
                <button
                    type="button"
                    class="tap-safe flex-1 rounded-brand bg-brand px-4 py-3 text-[15px] font-semibold text-white hover:bg-brand-dark"
                    @click="emit('enquire', unit)"
                >{{ unit.statusMeta.cta ?? 'Ask about this suite' }}</button>
                <button
                    type="button"
                    class="tap-safe shrink-0 rounded-brand border px-3 text-[13px] font-semibold transition-colors"
                    :class="comparing
                        ? 'border-brand-dark bg-brand-dark text-white'
                        : compareDisabled
                            ? 'border-hairline text-ink-light opacity-50'
                            : 'border-hairline text-ink hover:bg-warm'"
                    :aria-pressed="String(comparing)"
                    :disabled="compareDisabled && !comparing"
                    @click="emit('compare', unit.id)"
                >{{ comparing ? 'Comparing' : 'Compare' }}</button>
            </footer>
        </div>
    </Transition>
</template>

<style scoped>
.unit-detail {
    position: absolute;
    inset: 0;
    z-index: 30;
    display: flex;
    flex-direction: column;
    background: #fff;
}

/* Desktop: a panel docked to the right, so the map stays visible and the
   family keeps their bearings while they read. */
@media (min-width: 900px) {
    .unit-detail {
        inset: 0 0 0 auto;
        width: min(420px, 42%);
        border-left: 1px solid var(--color-hairline);
        box-shadow: var(--shadow-map-panel);
    }
}

.sheet-enter-active, .sheet-leave-active { transition: transform 260ms cubic-bezier(0.22, 1, 0.36, 1), opacity 200ms ease; }
.sheet-enter-from, .sheet-leave-to { opacity: 0; transform: translateY(14px); }
@media (min-width: 900px) {
    .sheet-enter-from, .sheet-leave-to { transform: translateX(22px); }
}
@media (prefers-reduced-motion: reduce) {
    .sheet-enter-active, .sheet-leave-active { transition: none; }
    .sheet-enter-from, .sheet-leave-to { transform: none; }
}
</style>
