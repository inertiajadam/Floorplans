/*
 | Availability states for a senior living unit.
 |
 | Multifamily mapping tools carry two states that matter — vacant and leased —
 | because an apartment is either rentable today or it is not. Senior living
 | does not work that way, and flattening it to two states is the single
 | biggest reason families call to ask a question the map should have answered.
 |
 | A community routinely needs to say:
 |   - this suite is empty but not yet cleaned and refreshed (COMING_AVAILABLE)
 |   - nothing is open in memory care, but we keep a list (WAITLIST)
 |   - this one is held for a family who toured Tuesday (HELD)
 |   - this one is let by the week for recovery stays (RESPITE)
 |   - this is the one we show on tours, it is never for sale (MODEL)
 |
 | Each state carries its own call to action, because "Apply now" is the wrong
 | ask for four of the six. `weight` orders units in lists so the things a
 | family can actually act on float to the top.
 */

export const AVAILABLE = 'available';
export const COMING_AVAILABLE = 'coming_available';
export const WAITLIST = 'waitlist';
export const HELD = 'held';
export const RESPITE = 'respite';
export const MODEL = 'model';
export const OCCUPIED = 'occupied';

/**
 * `tone` names a semantic colour role rather than a literal colour, so the host
 * application's design tokens decide what it looks like. See tokens.css.
 */
export const STATUSES = {
    [AVAILABLE]: {
        key: AVAILABLE,
        label: 'Available now',
        short: 'Available',
        tone: 'available',
        weight: 0,
        selectable: true,
        cta: 'Book a tour',
        help: 'Ready to move into now.',
    },
    [COMING_AVAILABLE]: {
        key: COMING_AVAILABLE,
        label: 'Coming available',
        short: 'Coming soon',
        tone: 'coming',
        weight: 1,
        selectable: true,
        cta: 'Ask to hold this suite',
        help: 'Being refreshed. You can reserve it before it opens.',
    },
    [WAITLIST]: {
        key: WAITLIST,
        label: 'Waitlist',
        short: 'Waitlist',
        tone: 'waitlist',
        weight: 2,
        selectable: true,
        cta: 'Join the waitlist',
        help: 'Occupied, but the community keeps a list for this layout.',
    },
    [RESPITE]: {
        key: RESPITE,
        label: 'Short-stay / respite',
        short: 'Respite',
        tone: 'respite',
        weight: 3,
        selectable: true,
        cta: 'Ask about a short stay',
        help: 'Available by the week or month for recovery and trial stays.',
    },
    [HELD]: {
        key: HELD,
        label: 'On hold',
        short: 'On hold',
        tone: 'held',
        weight: 4,
        selectable: true,
        cta: 'Ask to be next in line',
        help: 'Reserved for another family. Plans change — worth asking.',
    },
    [MODEL]: {
        key: MODEL,
        label: 'Model suite',
        short: 'Model',
        tone: 'model',
        weight: 5,
        selectable: true,
        cta: 'See this on a tour',
        help: 'Shown on tours to give you a feel for the layout.',
    },
    [OCCUPIED]: {
        key: OCCUPIED,
        label: 'Occupied',
        short: 'Occupied',
        tone: 'occupied',
        weight: 6,
        selectable: false,
        cta: null,
        help: 'Someone lives here. Shown for context only.',
    },
};

/** Every state, in the order a family cares about them. */
export const STATUS_ORDER = Object.values(STATUSES)
    .sort((a, b) => a.weight - b.weight)
    .map((s) => s.key);

/** States worth offering as a filter — "occupied" is context, not a search. */
export const FILTERABLE_STATUSES = STATUS_ORDER.filter((k) => k !== OCCUPIED);

/** States a family can act on today, used for the "X available" headline counts. */
export const ACTIONABLE_STATUSES = [AVAILABLE, COMING_AVAILABLE, RESPITE];

export function status(key) {
    return STATUSES[key] ?? STATUSES[OCCUPIED];
}

export function isActionable(key) {
    return ACTIONABLE_STATUSES.includes(key);
}

/**
 * The human line under a unit's status, e.g. "Available 1 November" or
 * "3 families waiting". Kept here so the map, the list and the detail drawer
 * can never drift apart on wording.
 */
export function statusDetail(unit, { today = new Date() } = {}) {
    const s = status(unit.status);

    if (unit.status === COMING_AVAILABLE && unit.availableOn) {
        const when = parseDate(unit.availableOn);
        if (when) {
            const days = daysBetween(today, when);
            if (days <= 0) return 'Available now';
            if (days <= 14) return `Available in about ${days} day${days === 1 ? '' : 's'}`;
            return `Available ${formatDay(when)}`;
        }
    }

    if (unit.status === WAITLIST && Number.isFinite(unit.waitlistCount) && unit.waitlistCount > 0) {
        return `${unit.waitlistCount} famil${unit.waitlistCount === 1 ? 'y' : 'ies'} waiting`;
    }

    if (unit.status === RESPITE && unit.respiteNightlyRate) {
        return `From $${Number(unit.respiteNightlyRate).toLocaleString()} per night`;
    }

    return s.help;
}

/* ------------------------------------------------------------------ dates */

/** Parses YYYY-MM-DD as a local date. `new Date('2026-11-01')` is UTC and drifts a day. */
export function parseDate(value) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) {
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function daysBetween(from, to) {
    const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
    return Math.round((b - a) / 86400000);
}

export function formatDay(date) {
    return date.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
}

/**
 * Can this unit be moved into by `date`? Available now always qualifies;
 * a coming-available suite qualifies once its date has passed. This is what
 * powers the move-in date filter, which multifamily tools tend to omit even
 * though it is the first question every adult child asks.
 */
export function availableBy(unit, date) {
    const target = parseDate(date);
    if (!target) return true;
    if (unit.status === AVAILABLE) return true;
    if (unit.status === COMING_AVAILABLE) {
        const when = parseDate(unit.availableOn);
        return !when || when <= target;
    }
    return false;
}
