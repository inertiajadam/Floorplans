<script setup>
/*
 | The map as it appears on somebody else's website.
 |
 | Wraps CommunityMap with the three things an embed needs and a first-party
 | page does not: fetching its own data, wearing the host's brand, and failing
 | in a way that does not embarrass the site it is sitting on.
 |
 | ---------------------------------------------------------------------------
 | THINGS AN EMBED MUST NOT DO
 | ---------------------------------------------------------------------------
 | 1. Touch the host page's URL. CommunityMap syncs filters and the selected
 |    suite to the query string, which is right on a listing page and hostile
 |    on someone else's site — it would rewrite their address bar and break
 |    their analytics and their back button. URL sync is OFF by default here
 |    and opt-in via `deep-link`.
 |
 | 2. Throw. An exception that escapes into a host page can take down their
 |    own scripts. Every failure path ends in a quiet fallback with a link to
 |    the community, which is still more useful to a family than a broken box.
 |
 | 3. Assume it is visible. Embeds are routinely placed in tabs, accordions and
 |    far below the fold. Rendering a map nobody has scrolled to costs the host
 |    page's Core Web Vitals, so we wait for an intersection before fetching.
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import CommunityMap from '../components/CommunityMap.vue';
import { normalize } from '../lib/model.js';

const props = defineProps({
    /** Public map id, e.g. "the-commons-on-meridian". */
    mapId:    { type: String, required: true },
    /** Origin of the map platform's API. */
    apiBase:  { type: String, required: true },
    /** Skip the fetch entirely — used by the demo and by server-rendered hosts. */
    payload:  { type: Object, default: null },
    /** Opt in to rewriting the host page's query string. Off by default. */
    deepLink: { type: Boolean, default: false },
    /** Wait for the element to be scrolled near before fetching. */
    lazy:     { type: Boolean, default: true },
});

const emit = defineEmits(['loaded', 'error', 'lead']);

const state = ref(props.payload ? 'ready' : 'idle');   // idle | loading | ready | error
const community = shallowRef(props.payload ? normalize(props.payload) : null);
const errorMessage = ref(null);
const root = ref(null);

const submitting = ref(false);
const leadSent = ref(false);
const leadError = ref(null);

let observer = null;
let controller = null;

/* --------------------------------------------------------------- loading */

async function load() {
    if (state.value === 'loading' || state.value === 'ready') return;
    state.value = 'loading';
    errorMessage.value = null;

    controller?.abort();
    controller = new AbortController();

    try {
        const res = await fetch(`${props.apiBase}/v1/maps/${encodeURIComponent(props.mapId)}`, {
            signal: controller.signal,
            headers: { accept: 'application/json' },
            /* No cookies: this is a public, cacheable document and sending
               credentials would make every CDN treat it as private. */
            credentials: 'omit',
        });

        if (res.status === 404) throw new Error('not-found');
        if (res.status === 403) throw new Error('not-allowed');
        if (!res.ok) throw new Error(`http-${res.status}`);

        const json = await res.json();
        community.value = normalize(json);
        state.value = 'ready';
        emit('loaded', json);
    } catch (err) {
        if (err?.name === 'AbortError') return;
        state.value = 'error';
        errorMessage.value = messageFor(err?.message);
        emit('error', err);
    }
}

/**
 * Wording aimed at a family, not a developer — this text can end up on a
 * public page. "not-allowed" is the one an operator will see while testing a
 * new domain, so it says what to do about it.
 */
function messageFor(code) {
    switch (code) {
        case 'not-found':   return 'This availability map is not available.';
        case 'not-allowed': return 'This map is not enabled for this website yet.';
        default:            return 'We could not load availability just now.';
    }
}

onMounted(() => {
    if (props.payload) return;

    if (!props.lazy || typeof IntersectionObserver === 'undefined') {
        load();
        return;
    }

    /* 400px of runway so the map is usually ready by the time it is reached. */
    observer = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) {
            observer?.disconnect();
            observer = null;
            load();
        }
    }, { rootMargin: '400px' });

    if (root.value) observer.observe(root.value);
    else load();
});

onBeforeUnmount(() => {
    observer?.disconnect();
    controller?.abort();
});

/* ----------------------------------------------------------------- leads */

async function onLead(payload) {
    submitting.value = true;
    leadError.value = null;

    try {
        const res = await fetch(`${props.apiBase}/v1/maps/${encodeURIComponent(props.mapId)}/leads`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            credentials: 'omit',
            body: JSON.stringify(payload),
        });

        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.message || 'We could not send that. Please try again, or call the community directly.');
        }

        leadSent.value = true;
        emit('lead', payload);
        setTimeout(() => { leadSent.value = false; }, 8000);
    } catch (err) {
        leadError.value = err.message;
    } finally {
        submitting.value = false;
    }
}

const fallbackHref = computed(() => community.value?.slug
    ? `https://seniorsplaces.com/community/${community.value.slug}`
    : null);
</script>

<template>
    <div ref="root" class="embed-root">
        <!-- Idle and loading look the same on purpose: a lazy embed sitting
             below the fold should not advertise that it has not started. -->
        <div v-if="state === 'idle' || state === 'loading'" class="embed-skeleton" role="status" aria-live="polite">
            <span class="sr-only">Loading availability…</span>
            <div class="embed-skeleton__bar" aria-hidden="true"></div>
            <div class="embed-skeleton__plan" aria-hidden="true"></div>
        </div>

        <!-- A quiet, useful failure. Never a stack trace, never an empty box. -->
        <div v-else-if="state === 'error'" class="embed-error" role="status">
            <p class="embed-error__text">{{ errorMessage }}</p>
            <a v-if="fallbackHref" :href="fallbackHref" class="embed-error__link" target="_blank" rel="noopener">
                See this community on Seniors Places
            </a>
            <button v-else type="button" class="embed-error__link" @click="state = 'idle'; load()">Try again</button>
        </div>

        <CommunityMap
            v-else-if="community"
            :community="community"
            :sync-url="deepLink"
            :submitting="submitting"
            :lead-sent="leadSent"
            :lead-error="leadError"
            @lead="onLead"
        />
    </div>
</template>

<style scoped>
.embed-root {
    container-type: inline-size;
    width: 100%;
}

/* Skeleton rather than a spinner: it reserves the right amount of space, so
   the host page does not shift when the map arrives. */
.embed-skeleton {
    border: 1px solid var(--color-hairline);
    border-radius: var(--radius-card);
    overflow: hidden;
    background: #fff;
}
.embed-skeleton__bar {
    height: 64px;
    background: linear-gradient(90deg, var(--color-warm) 25%, var(--color-warm-2) 50%, var(--color-warm) 75%);
    background-size: 200% 100%;
    animation: embed-shimmer 1.4s infinite linear;
}
.embed-skeleton__plan {
    height: 420px;
    background: var(--color-warm);
    border-top: 1px solid var(--color-hairline);
}
@keyframes embed-shimmer {
    to { background-position: -200% 0; }
}
@media (prefers-reduced-motion: reduce) {
    .embed-skeleton__bar { animation: none; }
}

.embed-error {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 1.5rem;
    border: 1px solid var(--color-hairline);
    border-radius: var(--radius-card);
    background: #fff;
}
.embed-error__text {
    margin: 0;
    font-size: 14px;
    color: var(--color-ink-mid);
}
.embed-error__link {
    font-size: 14px;
    font-weight: 600;
    color: var(--color-brand);
    text-decoration: underline;
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
}
</style>
