<script setup>
/*
 | Building and floor picker.
 |
 | A campus is buildings, and a building is floors. Flattening that into one
 | long dropdown ("Magnolia Floor 1, Magnolia Floor 2, Grove...") is what
 | multifamily tools do, and it stops making sense the moment a community has
 | a memory care household with no floors and a field of cottages with no
 | building at all.
 |
 | Each floor carries its live match count, so a family filtering for
 | two-bedrooms can see which floor to look at without opening all of them.
 | A floor with no matches is still reachable — it is dimmed, not disabled,
 | because "nothing here" is useful information.
 */
import { computed } from 'vue';

const props = defineProps({
    buildings: { type: Array, required: true },
    levelId:   { type: String, default: null },
    counts:    { type: Object, default: () => ({}) },   // levelId -> matches
    filtered:  { type: Boolean, default: false },
});
const emit = defineEmits(['open']);

const currentBuilding = computed(() =>
    props.buildings.find((b) => b.levels.some((l) => l.id === props.levelId)) ?? props.buildings[0]);

const buildingTotal = (b) => b.levels.reduce((n, l) => n + (props.counts[l.id] ?? 0), 0);

function openBuilding(b) {
    if (b.id === currentBuilding.value?.id) return;
    /* Land on the floor with the most matches, not blindly on floor one —
       if the only available two-bedroom is on the third floor, go there. */
    const best = [...b.levels].sort((x, y) => (props.counts[y.id] ?? 0) - (props.counts[x.id] ?? 0))[0];
    emit('open', (props.filtered && best ? best : b.levels[0])?.id);
}
</script>

<template>
    <div class="flex flex-col gap-2">
        <!-- buildings -->
        <div v-if="buildings.length > 1" role="group" aria-label="Choose a building" class="flex flex-wrap gap-1.5">
            <button
                v-for="b in buildings"
                :key="b.id"
                type="button"
                class="tap-safe rounded-brand border px-3 py-2 text-left text-[13.5px] leading-tight transition-colors"
                :class="b.id === currentBuilding?.id
                    ? 'border-brand-dark bg-brand-dark text-white'
                    : 'border-hairline bg-white text-ink hover:bg-warm'"
                :aria-current="b.id === currentBuilding?.id ? 'true' : undefined"
                @click="openBuilding(b)"
            >
                <span class="font-semibold">{{ b.shortName }}</span>
                <span
                    v-if="filtered"
                    class="ml-1.5 tabular-nums"
                    :class="b.id === currentBuilding?.id ? 'text-white/75' : 'text-ink-light'"
                >{{ buildingTotal(b) }}</span>
            </button>
        </div>

        <!-- floors within the chosen building -->
        <div
            v-if="currentBuilding && currentBuilding.levels.length > 1"
            role="group"
            :aria-label="`Choose a floor in ${currentBuilding.name}`"
            class="flex flex-wrap gap-1.5"
        >
            <button
                v-for="l in currentBuilding.levels"
                :key="l.id"
                type="button"
                class="tap-safe inline-flex items-center gap-1.5 rounded-brand border px-3 py-2 text-[13.5px] transition-colors"
                :class="l.id === levelId
                    ? 'border-brand bg-brand-light text-brand-dark font-semibold'
                    : 'border-hairline bg-white text-ink-mid hover:bg-warm'"
                :aria-current="l.id === levelId ? 'true' : undefined"
                @click="emit('open', l.id)"
            >
                <span>{{ l.name }}</span>
                <span
                    v-if="filtered"
                    class="tabular-nums rounded-full px-1.5 text-[11.5px] font-semibold"
                    :class="(counts[l.id] ?? 0) > 0 ? 'bg-brand text-white' : 'bg-warm-dark text-ink-light'"
                >{{ counts[l.id] ?? 0 }}</span>
            </button>
        </div>

        <p v-if="currentBuilding?.blurb" class="text-[13px] text-ink-mid">{{ currentBuilding.blurb }}</p>
    </div>
</template>
