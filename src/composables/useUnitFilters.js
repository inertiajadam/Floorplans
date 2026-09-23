/*
 | Filter state, and the URL it lives in.
 |
 | Every filter, the open level and the selected suite are encoded in the query
 | string. That one decision fixes several things families complain about with
 | iframe-embedded maps:
 |
 |   - a link to "the two-bedrooms under $6,000 in Magnolia" can be texted to
 |     a sibling and it opens on exactly that
 |   - the back button steps back through the map instead of leaving the page
 |   - a sales counsellor can send a link to one suite
 |   - the server can read the same query string and render a real, indexable
 |     page for that suite, which an iframe can never do
 |
 | Keys are kept short and stable — they are a public API the moment someone
 | bookmarks one.
 */

import { computed, reactive, watch, onScopeDispose } from 'vue';
import { availableBy, OCCUPIED, STATUS_ORDER } from '../lib/availability.js';

export const PARAMS = {
    care: 'care',       // csv of care level keys
    status: 'status',   // csv of availability keys
    beds: 'beds',       // csv of bedroom counts
    max: 'max',         // max monthly base rate
    min: 'min',         // min monthly base rate
    sqft: 'sqft',       // minimum square feet
    from: 'from',       // move-in by date, YYYY-MM-DD
    ada: 'ada',         // 1 = step-free / roll-in shower only
    q: 'q',             // free text
    level: 'level',     // open level id
    unit: 'unit',       // selected unit id
    view: 'view',       // map | list
};

export function emptyFilters() {
    return {
        care: [], status: [], beds: [], view: [],
        max: null, min: null, sqft: null, from: null,
        ada: false, q: '',
    };
}

/**
 * @param {object} community  normalised community (see lib/model.js)
 * @param {object} [options]
 * @param {boolean} [options.syncUrl=true]  set false when embedding several maps on one page
 */
export function useUnitFilters(community, { syncUrl = true } = {}) {
    const filters = reactive(emptyFilters());
    const ui = reactive({ levelId: null, unitId: null, mode: 'map' });

    /* ------------------------------------------------------------ read URL */

    function readUrl() {
        if (typeof window === 'undefined') return;
        const p = new URLSearchParams(window.location.search);
        const csv = (k) => (p.get(k) ? p.get(k).split(',').filter(Boolean) : []);

        filters.care = csv(PARAMS.care);
        filters.status = csv(PARAMS.status).filter((s) => STATUS_ORDER.includes(s));
        filters.beds = csv(PARAMS.beds).map(Number).filter((n) => Number.isFinite(n));
        filters.view = csv(PARAMS.view);
        filters.max = num(p.get(PARAMS.max));
        filters.min = num(p.get(PARAMS.min));
        filters.sqft = num(p.get(PARAMS.sqft));
        filters.from = p.get(PARAMS.from) || null;
        filters.ada = p.get(PARAMS.ada) === '1';
        filters.q = p.get(PARAMS.q) || '';

        const level = p.get(PARAMS.level);
        ui.levelId = community.levelById.has(level) ? level : community.levels[0]?.id ?? null;
        const unit = p.get(PARAMS.unit);
        ui.unitId = community.byId.has(unit) ? unit : null;
        ui.mode = p.get(PARAMS.view) === 'list' ? 'list' : 'map';

        /* A deep link to a suite implies the level it sits on. */
        if (ui.unitId) ui.levelId = community.byId.get(ui.unitId).levelId;
    }

    function toQuery() {
        const p = new URLSearchParams();
        const put = (k, v) => { if (v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)) p.set(k, Array.isArray(v) ? v.join(',') : String(v)); };

        put(PARAMS.care, filters.care);
        put(PARAMS.status, filters.status);
        put(PARAMS.beds, filters.beds);
        put(PARAMS.max, filters.max);
        put(PARAMS.min, filters.min);
        put(PARAMS.sqft, filters.sqft);
        put(PARAMS.from, filters.from);
        if (filters.ada) p.set(PARAMS.ada, '1');
        put(PARAMS.q, filters.q.trim());
        /* The default level is implied; only write it when it is not the first. */
        if (ui.levelId && ui.levelId !== community.levels[0]?.id) p.set(PARAMS.level, ui.levelId);
        put(PARAMS.unit, ui.unitId);
        if (ui.mode === 'list') p.set(PARAMS.view, 'list');

        return p.toString();
    }

    if (syncUrl && typeof window !== 'undefined') {
        readUrl();

        /* replaceState, not pushState: a filter tweak is not a navigation, and
           filling history with 30 entries makes the back button useless. The
           one exception is selecting a suite, handled in selectUnit(). */
        let queued = null;
        const write = () => {
            queued = null;
            const qs = toQuery();
            const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
            if (url !== window.location.pathname + window.location.search) {
                window.history.replaceState(window.history.state, '', url);
            }
        };
        watch([filters, ui], () => {
            if (queued) return;
            queued = requestAnimationFrame(write);
        }, { deep: true });

        const onPop = () => readUrl();
        window.addEventListener('popstate', onPop);
        onScopeDispose(() => {
            window.removeEventListener('popstate', onPop);
            if (queued) cancelAnimationFrame(queued);
        });
    } else {
        ui.levelId = community.levels[0]?.id ?? null;
    }

    /* ----------------------------------------------------------- filtering */

    /**
     * Does one unit pass? Occupied suites are always kept in the result so the
     * map still draws the whole floor — greying them out rather than deleting
     * them is what lets a family see that a suite is at the quiet end of a
     * hall. `matches` on the returned record says whether it passed.
     */
    function test(u) {
        if (filters.care.length && !u.careLevels.some((c) => filters.care.includes(c))) return false;
        if (filters.status.length && !filters.status.includes(u.status)) return false;
        if (filters.beds.length && !filters.beds.includes(Number(u.bedrooms))) return false;
        if (filters.view.length && !filters.view.includes(u.view)) return false;
        if (filters.ada && !u.accessible) return false;
        if (filters.max !== null && (u.price === null || u.price > filters.max)) return false;
        if (filters.min !== null && (u.price === null || u.price < filters.min)) return false;
        if (filters.sqft !== null && (u.sqft === null || u.sqft < filters.sqft)) return false;
        if (filters.from && !availableBy(u, filters.from)) return false;
        if (filters.q.trim() && !u.searchText.includes(filters.q.trim().toLowerCase())) return false;
        return true;
    }

    const active = computed(() => {
        const f = filters;
        return Boolean(f.care.length || f.status.length || f.beds.length || f.view.length
            || f.max !== null || f.min !== null || f.sqft !== null || f.from || f.ada || f.q.trim());
    });

    /** Ids of every unit that passes, across the whole campus. */
    const matchingIds = computed(() => {
        const out = new Set();
        for (const u of community.units) if (test(u)) out.add(u.id);
        return out;
    });

    /**
     * What the map draws: every unit on the open level, each tagged with
     * whether it matches. Occupied units never "match" unless explicitly
     * filtered for, so they stay quiet without disappearing.
     */
    const levelUnits = computed(() => {
        const level = community.levelById.get(ui.levelId);
        if (!level) return [];
        const ids = matchingIds.value;
        return level.units.map((u) => ({
            unit: u,
            matches: ids.has(u.id) && (u.status !== OCCUPIED || filters.status.includes(OCCUPIED)),
        }));
    });

    /** What the list shows: matches only, campus-wide, best first. */
    const results = computed(() => {
        const ids = matchingIds.value;
        return community.units
            .filter((u) => ids.has(u.id) && (u.status !== OCCUPIED || filters.status.includes(OCCUPIED)))
            .sort((a, b) => a.statusMeta.weight - b.statusMeta.weight
                || (a.price ?? Infinity) - (b.price ?? Infinity)
                || a.number.localeCompare(b.number, undefined, { numeric: true }));
    });

    /** Per-level match counts, so the level switcher can say "4 here". */
    const countsByLevel = computed(() => {
        const ids = matchingIds.value;
        const out = {};
        for (const level of community.levels) {
            out[level.id] = level.units.filter((u) => ids.has(u.id) && u.status !== OCCUPIED).length;
        }
        return out;
    });

    const selected = computed(() => (ui.unitId ? community.byId.get(ui.unitId) ?? null : null));
    const level = computed(() => community.levelById.get(ui.levelId) ?? community.levels[0] ?? null);

    /* -------------------------------------------------------------- actions */

    function selectUnit(id, { push = true } = {}) {
        const unit = id ? community.byId.get(id) : null;
        ui.unitId = unit?.id ?? null;
        if (unit && unit.levelId !== ui.levelId) ui.levelId = unit.levelId;

        /* Selecting a suite IS a navigation — it is the thing people share and
           the thing they expect the back button to undo. */
        if (push && syncUrl && typeof window !== 'undefined' && unit) {
            const qs = toQuery();
            window.history.pushState(window.history.state, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
        }
    }

    function openLevel(id) {
        if (!community.levelById.has(id)) return;
        ui.levelId = id;
        if (ui.unitId && community.byId.get(ui.unitId)?.levelId !== id) ui.unitId = null;
    }

    function clear() {
        Object.assign(filters, emptyFilters());
    }

    function toggle(key, value) {
        const list = filters[key];
        if (!Array.isArray(list)) return;
        const i = list.indexOf(value);
        if (i === -1) list.push(value);
        else list.splice(i, 1);
    }

    /** A shareable absolute URL for the current view. */
    function shareUrl() {
        if (typeof window === 'undefined') return '';
        const qs = toQuery();
        return `${window.location.origin}${window.location.pathname}${qs ? `?${qs}` : ''}`;
    }

    return {
        filters, ui, active, results, levelUnits, matchingIds, countsByLevel,
        selected, level, test,
        selectUnit, openLevel, clear, toggle, shareUrl, readUrl,
    };
}

function num(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}
