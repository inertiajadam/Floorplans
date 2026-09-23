<script setup>
/*
 | The family-facing map, for the showcase.
 |
 | Thin: the hub already explains what to look at, so this is the component
 | plus a fake lead round-trip so the enquiry flow can be walked all the way
 | to its confirmation. No URL sync — the demo is mounted inside another page
 | and must not rewrite its address bar.
 */
import { ref } from 'vue';
import CommunityMap from '../src/components/CommunityMap.vue';
import raw from './data/commons-on-meridian.json';

const submitting = ref(false);
const sent = ref(false);
const error = ref(null);
const lastLead = ref(null);

async function onLead(payload) {
    lastLead.value = payload;
    submitting.value = true;
    error.value = null;
    await new Promise((r) => setTimeout(r, 700));
    submitting.value = false;
    sent.value = true;
    setTimeout(() => { sent.value = false; }, 6000);
}
</script>

<template>
    <div class="bg-warm-2 p-3 font-sans text-ink sm:p-4">
        <CommunityMap
            :community="raw"
            :sync-url="false"
            :submitting="submitting"
            :lead-sent="sent"
            :lead-error="error"
            @lead="onLead"
        />

        <section v-if="lastLead" class="mt-4 rounded-card border border-hairline bg-white p-4">
            <h2 class="font-serif text-[16px] font-bold">What the enquiry sends</h2>
            <p class="mt-0.5 text-[13px] text-ink-mid">
                The suite, layout, floor, availability and rate go with it — a sales counsellor never has
                to ring back to ask which room you meant.
            </p>
            <pre class="mt-2 max-h-[220px] overflow-auto rounded-brand bg-warm p-3 text-[12px] leading-relaxed">{{ JSON.stringify(lastLead.context, null, 2) }}</pre>
        </section>
    </div>
</template>
