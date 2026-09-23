/*
 | The compare tray.
 |
 | Families shortlist two or three suites and then argue about them in a car
 | park. Capped at three: four columns do not fit a phone, and the point is to
 | force a decision rather than build a spreadsheet.
 |
 | Persisted to sessionStorage rather than localStorage — a shortlist is about
 | this visit. Coming back a fortnight later to a stale list of suites that
 | have since been let is worse than an empty tray.
 */

import { computed, ref, watch } from 'vue';

const KEY = 'spm:compare';
export const MAX_COMPARE = 3;

export function useCompare(community) {
    const ids = ref(load());

    watch(ids, (v) => {
        try {
            sessionStorage.setItem(KEY, JSON.stringify(v));
        } catch {
            /* Private browsing and storage-blocked contexts: the tray still
               works for this page, it just will not survive a reload. */
        }
    }, { deep: true });

    const units = computed(() => ids.value.map((id) => community.byId.get(id)).filter(Boolean));
    const isFull = computed(() => ids.value.length >= MAX_COMPARE);

    const has = (id) => ids.value.includes(id);

    /** @returns {'added'|'removed'|'full'} so the caller can announce the right thing. */
    function toggle(id) {
        const i = ids.value.indexOf(id);
        if (i !== -1) {
            ids.value.splice(i, 1);
            return 'removed';
        }
        if (isFull.value) return 'full';
        ids.value.push(id);
        return 'added';
    }

    const remove = (id) => { const i = ids.value.indexOf(id); if (i !== -1) ids.value.splice(i, 1); };
    const clear = () => { ids.value = []; };

    return { ids, units, has, toggle, remove, clear, isFull, max: MAX_COMPARE };
}

function load() {
    try {
        const raw = sessionStorage.getItem(KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.slice(0, MAX_COMPARE) : [];
    } catch {
        return [];
    }
}
