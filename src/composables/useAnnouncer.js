/*
 | A single polite live region for the whole map.
 |
 | Panning, zooming and filtering change the page silently for a sighted user
 | and invisibly for everyone else. Without this, a screen reader user filtering
 | to two-bedrooms hears nothing at all and has no way to know whether anything
 | happened. Each meaningful change pushes one short sentence here.
 |
 | Deliberately one shared region rather than aria-live on the results list:
 | a live region on a list that re-renders announces the entire list, which is
 | unusable when it holds sixty suites.
 */

import { ref } from 'vue';

export function useAnnouncer() {
    const message = ref('');
    let timer = null;

    /**
     * Re-announcing identical text is a no-op in most screen readers, so we
     * clear first and set on the next tick to force it through.
     */
    function announce(text) {
        if (!text) return;
        clearTimeout(timer);
        if (message.value === text) {
            message.value = '';
            timer = setTimeout(() => { message.value = text; }, 60);
            return;
        }
        message.value = text;
    }

    return { message, announce };
}

/** "12 suites match" / "No suites match these filters" — one place, one wording. */
export function resultsSentence(count, { filtered = true } = {}) {
    if (count === 0) return filtered ? 'No suites match these filters.' : 'No suites to show.';
    return `${count} suite${count === 1 ? '' : 's'} ${filtered ? 'match' : 'shown'}${count === 1 ? 'es' : ''}.`.replace('matches', 'match');
}
