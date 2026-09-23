<script setup>
/*
 | The embed, inside a deliberately hostile "client website".
 |
 | The mock site below is styled the way real client sites often are: element
 | selectors everywhere, `!important` on the buttons, a box-sizing reset, a
 | rule that stretches every svg. The map is mounted as the real custom
 | element — the same code a client's snippet loads — with the payload handed
 | over directly, so no server is needed.
 |
 | Both directions of isolation are visible at once: the pink page is
 | untouched by us, and the map is untouched by it. The map also wears the
 | operator's blue theme rather than the page's pink, which is the per-map
 | branding doing its job.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { defineCommunityMap } from '../src/embed/element.js';
import raw from './data/willow-creek.json';

const slot = ref(null);
let el = null;

onMounted(() => {
    const tag = defineCommunityMap();
    if (!tag || !slot.value) return;

    el = document.createElement(tag);
    el.setAttribute('map', raw.slug);
    el.setAttribute('lazy', 'false');
    el.setAttribute('height', '680');
    /* Handed over directly: the element skips its fetch. This is also how the
       Seniors Places listing page would mount it, with a server-rendered
       payload rather than a second round trip. */
    el.payload = {
        ...raw,
        theme: { brand: '#1d4ed8', brandDark: '#1e3a8a', brandLight: '#e0e7ff', radiusCard: '8px' },
    };
    slot.value.appendChild(el);
});

onBeforeUnmount(() => {
    el?.remove();
    el = null;
});
</script>

<template>
    <div class="hostile">
        <header class="hostile-header">
            <h1>Willow Creek Senior Living</h1>
        </header>

        <div class="hostile-lede">
            <h2>Find your apartment</h2>
            <p>Browse our availability below. Call us on 0800 000 000 to arrange a visit.</p>
            <ul>
                <li>Independent living</li>
                <li>Assisted living</li>
                <li>Memory care</li>
            </ul>
            <button type="button">Call us</button>
        </div>

        <div class="hostile-note">
            Everything above and around the map is styled by the "client's" stylesheet — Comic Sans,
            hotpink buttons, a content-box reset, rotated SVGs. Watch what reaches the map: nothing.
            And the map's own reset reaches none of this.
        </div>

        <div class="hostile-slot" ref="slot"></div>

        <p class="hostile-footer">Willow Creek is a fictional community used for testing.</p>
    </div>
</template>

<style>
/*
 | THE CLIENT SITE'S STYLESHEET. Deliberately awful; every rule is something
 | seen on a real marketing site. Unscoped on purpose so it behaves like a
 | global stylesheet within this demo's own shadow root.
 */
.hostile, .hostile * { box-sizing: content-box !important; }

.hostile {
    font-family: "Comic Sans MS", "Comic Sans", cursive;
    font-size: 20px;
    line-height: 2.2;
    color: #b3005e;
    background: #fffaf3;
    padding: 0 0 24px;
}
.hostile div { margin: 14px; padding: 10px; border: 2px dashed #ffb6d5; }
.hostile h1, .hostile h2 { font-size: 3rem !important; color: #ff0066 !important; text-transform: uppercase; margin: 0; }
.hostile p { font-size: 22px; letter-spacing: 2px; }
.hostile button, .hostile select, .hostile input {
    background: hotpink !important;
    color: #fff !important;
    font-size: 26px !important;
    border: 6px ridge lime !important;
    border-radius: 0 !important;
    padding: 16px !important;
    text-transform: uppercase !important;
}
.hostile ul { list-style: square inside; padding-left: 48px; }
.hostile svg { width: 100% !important; height: auto !important; transform: rotate(0.5deg); }

.hostile-header { background: #ff0066; color: #fff; padding: 8px 24px; }
.hostile-header h1 { font-size: 1.8rem !important; color: #fff !important; }
.hostile-lede { max-width: 60ch; }
.hostile-note {
    font-family: ui-monospace, monospace !important;
    font-size: 13px !important;
    line-height: 1.5;
    color: #444 !important;
    background: #fff3c4;
    border: 2px solid #e0b400 !important;
}
.hostile-slot { border: 4px solid #ff0066 !important; padding: 0 !important; }
.hostile-footer { font-size: 14px; }
</style>
