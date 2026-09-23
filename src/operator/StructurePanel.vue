<script setup>
/*
 | Owner portal: buildings, floors, and getting geometry in.
 |
 | This is the once-a-year job, so it is allowed to cost more clicks than the
 | availability roster. Buildings and floors are ordinary forms; the actual
 | tracing happens in the plan tracer and arrives here as pasted JSON.
 |
 | The one rule worth stating out loud, because getting it wrong would be
 | quietly destructive: RE-TRACING A FLOOR MUST NOT RESET ITS AVAILABILITY.
 | An operator fixing a wall they drew in the wrong place should not discover
 | they have marked the whole wing occupied. The server matches on suite number
 | and keeps status, dates and rates — see CommunityMapController::importLevel.
 | The wording here tells the operator that, so the paste is not frightening.
 */
import { ref } from 'vue';

const props = defineProps({
    map:         { type: Object, required: true },
    tracerUrl:   { type: String, default: '/editor.html' },
    submit:      { type: Function, required: true },
});

const showAddBuilding = ref(false);
const building = ref({ name: '', short_name: '', blurb: '' });

const addingLevelTo = ref(null);
const level = ref({ name: '', ordinal: null });

const importingInto = ref(null);
const geometry = ref('');

const busy = ref(null);
const flash = ref(null);

async function run(action, payload, message) {
    busy.value = action;
    flash.value = null;
    try {
        await props.submit(action, payload);
        flash.value = { tone: 'ok', text: message };
        return true;
    } catch (err) {
        flash.value = { tone: 'error', text: err?.message || 'That did not save.' };
        return false;
    } finally {
        busy.value = null;
    }
}

async function saveBuilding() {
    if (!building.value.name.trim()) return;
    if (await run('building.store', { ...building.value }, `${building.value.name} added, with a ground floor to start.`)) {
        building.value = { name: '', short_name: '', blurb: '' };
        showAddBuilding.value = false;
    }
}

async function saveLevel(buildingId) {
    if (!level.value.name.trim()) return;
    if (await run('level.store', { building_id: buildingId, ...level.value }, `${level.value.name} added.`)) {
        level.value = { name: '', ordinal: null };
        addingLevelTo.value = null;
    }
}

async function importGeometry(levelId) {
    if (!geometry.value.trim()) return;
    if (await run('level.import', { id: levelId, geometry: geometry.value }, 'Floor plan updated. Availability on existing suites was kept.')) {
        geometry.value = '';
        importingInto.value = null;
    }
}

function removeBuilding(b) {
    const units = b.levels.reduce((n, l) => n + l.units, 0);
    if (units > 0) {
        flash.value = { tone: 'error', text: `${b.name} still has ${units} suite${units === 1 ? '' : 's'}. Remove those first — deleting them would lose the shapes you traced.` };
        return;
    }
    if (!confirm(`Remove ${b.name} and its floors?`)) return;
    run('building.destroy', { id: b.id }, `${b.name} removed.`);
}

const fieldClass = 'tap-safe w-full rounded-[10px] border-[1.5px] border-hairline bg-white px-2.5 py-2 text-[13.5px] text-ink outline-none transition focus:border-brand focus:ring-[3px] focus:ring-brand-light';
</script>

<template>
    <section id="map-structure" class="scroll-mt-24 space-y-4 rounded-[18px] border border-hairline bg-white p-5 shadow-card-soft sm:p-6">
        <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
                <h2 class="font-serif text-lg font-bold text-ink">Buildings &amp; floor plans</h2>
                <p class="mt-0.5 text-[13px] text-ink-mid">
                    Set up once. After this, keeping the map current is a dropdown per suite.
                </p>
            </div>
            <button
                type="button"
                class="tap-safe rounded-lg bg-brand px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-brand-dark"
                @click="showAddBuilding = !showAddBuilding"
            >Add a building</button>
        </div>

        <p
            v-if="flash"
            class="rounded-[12px] px-3.5 py-2.5 text-[13.5px]"
            :class="flash.tone === 'error' ? 'bg-danger/10 text-danger' : 'bg-forest-light text-forest'"
            role="status"
            aria-live="polite"
        >{{ flash.text }}</p>

        <!-- add a building -->
        <div v-if="showAddBuilding" class="rounded-[12px] border border-brand-mid bg-brand-light/30 p-3">
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label class="text-[11.5px] font-semibold text-ink-light">
                    Name
                    <input v-model="building.name" :class="fieldClass" class="mt-0.5 font-normal" placeholder="Magnolia House" />
                </label>
                <label class="text-[11.5px] font-semibold text-ink-light">
                    Short name <span class="font-normal">(used on buttons)</span>
                    <input v-model="building.short_name" :class="fieldClass" class="mt-0.5 font-normal" placeholder="Magnolia" />
                </label>
            </div>
            <label class="mt-2 block text-[11.5px] font-semibold text-ink-light">
                One line families read
                <input v-model="building.blurb" :class="fieldClass" class="mt-0.5 font-normal" placeholder="Assisted living over three floors, with the dining room on the ground floor." />
            </label>
            <div class="mt-2 flex gap-2">
                <button
                    type="button"
                    class="tap-safe rounded-lg bg-brand px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
                    :disabled="busy === 'building.store' || !building.name.trim()"
                    @click="saveBuilding"
                >Add it</button>
                <button type="button" class="tap-safe rounded-lg border border-hairline px-3.5 py-2 text-[13px] font-semibold hover:bg-warm" @click="showAddBuilding = false">Cancel</button>
            </div>
        </div>

        <!-- the campus -->
        <p v-if="!map.buildings?.length" class="rounded-[12px] border border-dashed border-hairline px-4 py-6 text-center text-[13.5px] text-ink-mid">
            No buildings yet. Add one, then trace its floor plan.
        </p>

        <ul v-else class="space-y-3">
            <li v-for="b in map.buildings" :key="b.id" class="rounded-[12px] border border-hairline p-3">
                <div class="flex flex-wrap items-start justify-between gap-2">
                    <div class="min-w-0">
                        <p class="font-serif text-[15.5px] font-bold text-ink">{{ b.name }}</p>
                        <p v-if="b.blurb" class="text-[12.5px] text-ink-mid">{{ b.blurb }}</p>
                    </div>
                    <div class="flex gap-1.5">
                        <button type="button" class="tap-safe rounded-lg border border-hairline px-2.5 py-1.5 text-[12.5px] font-semibold hover:bg-warm" @click="addingLevelTo = addingLevelTo === b.id ? null : b.id">
                            Add a floor
                        </button>
                        <button type="button" class="tap-safe rounded-lg border border-hairline px-2.5 py-1.5 text-[12.5px] text-ink-mid hover:bg-warm" @click="removeBuilding(b)">
                            <span aria-hidden="true">Remove</span>
                            <span class="sr-only">Remove {{ b.name }}</span>
                        </button>
                    </div>
                </div>

                <div v-if="addingLevelTo === b.id" class="mt-2 grid grid-cols-[1fr_90px_auto] gap-2 rounded-[10px] bg-warm/50 p-2">
                    <label class="sr-only" :for="`lvl-name-${b.id}`">Floor name</label>
                    <input :id="`lvl-name-${b.id}`" v-model="level.name" :class="fieldClass" placeholder="Floor 2" />
                    <label class="sr-only" :for="`lvl-ord-${b.id}`">Storey number</label>
                    <input :id="`lvl-ord-${b.id}`" v-model.number="level.ordinal" type="number" min="0" :class="fieldClass" placeholder="2" />
                    <button
                        type="button"
                        class="tap-safe rounded-lg bg-brand px-3 py-2 text-[13px] font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
                        :disabled="busy === 'level.store' || !level.name.trim()"
                        @click="saveLevel(b.id)"
                    >Add</button>
                </div>

                <ul class="mt-2 space-y-1.5">
                    <li
                        v-for="l in b.levels"
                        :key="l.id"
                        class="flex flex-wrap items-center gap-2 rounded-[10px] border border-hairline bg-warm/30 px-3 py-2"
                    >
                        <span class="text-[13.5px] font-semibold text-ink">{{ l.name }}</span>
                        <span class="text-[12.5px] tabular-nums text-ink-light">
                            {{ l.units }} suite{{ l.units === 1 ? '' : 's' }}
                        </span>

                        <div class="ml-auto flex gap-1.5">
                            <a
                                :href="tracerUrl"
                                target="_blank"
                                rel="noopener"
                                class="tap-safe rounded-lg border border-hairline bg-white px-2.5 py-1.5 text-[12.5px] font-semibold text-brand hover:bg-warm"
                            >Open the plan tracer</a>
                            <button
                                type="button"
                                class="tap-safe rounded-lg border border-hairline bg-white px-2.5 py-1.5 text-[12.5px] font-semibold hover:bg-warm"
                                @click="importingInto = importingInto === l.id ? null : l.id"
                            >{{ l.units ? 'Update the plan' : 'Paste the plan' }}</button>
                        </div>

                        <div v-if="importingInto === l.id" class="w-full">
                            <label :for="`geo-${l.id}`" class="mt-2 block text-[11.5px] font-semibold text-ink-light">
                                Paste the JSON from the plan tracer
                            </label>
                            <textarea
                                :id="`geo-${l.id}`"
                                v-model="geometry"
                                rows="4"
                                :class="fieldClass"
                                class="mt-0.5 font-mono text-[11.5px]"
                                placeholder='{ "id": "...", "units": [ ... ] }'
                            />
                            <p class="mt-1 text-[12px] text-ink-mid">
                                Suites are matched by number, so anything already on this floor keeps its availability,
                                dates and rate. Only the shapes change.
                            </p>
                            <button
                                type="button"
                                class="tap-safe mt-2 rounded-lg bg-brand px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
                                :disabled="busy === 'level.import' || !geometry.trim()"
                                @click="importGeometry(l.id)"
                            >{{ busy === 'level.import' ? 'Updating…' : 'Update this floor' }}</button>
                        </div>
                    </li>
                </ul>
            </li>
        </ul>
    </section>
</template>
