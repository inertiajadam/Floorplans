/*
 | What a month actually costs.
 |
 | A multifamily map shows one number because an apartment has one number: the
 | rent. Senior living has at least four, and the gap between the advertised
 | figure and the first invoice is the most common complaint families have
 | about the whole industry.
 |
 | A real monthly bill is:
 |
 |     base rate for the suite          (what the map usually shows, alone)
 |   + level-of-care charge             (assessed on move-in: tiers or à la carte)
 |   + second person fee                (couples — often $900–$1,500)
 |   + recurring add-ons                (pet rent, covered parking, salon plan)
 |   ----------------------------------
 |   = monthly total
 |
 |   plus a one-time community fee      (typically 1–2x a month's rate)
 |
 | We model all of it and show the family a range up front — "from $4,200, most
 | residents at this care level pay $5,350" — rather than a single number that
 | is technically true and practically misleading. Communities that keep rates
 | private (`pricingPublic: false` on the listing) get the same structure with
 | the numbers withheld, so the layout never shifts between the two modes.
 */

/** A community with no tiers configured still needs a sane "no care" baseline. */
export const NO_CARE = { key: 'none', label: 'No care needed', monthly: 0, description: 'Independent, no assistance with daily activities.' };

/**
 * Resolve the care tiers offered for a given care level. Independent living
 * usually has none; assisted living has tiers; memory care is often all-inclusive.
 */
export function tiersFor(community, careLevelKey) {
    const all = community?.careTiers ?? [];
    const scoped = all.filter((t) => !t.careLevels?.length || t.careLevels.includes(careLevelKey));
    return scoped.length ? scoped : [];
}

export function tierByKey(community, key) {
    return (community?.careTiers ?? []).find((t) => t.key === key) ?? null;
}

/**
 * Build the full cost picture for one unit under one set of choices.
 *
 * @param {object}  unit
 * @param {object}  community
 * @param {object}  choices
 * @param {string}  [choices.careLevel]  which care level the family is pricing
 * @param {string}  [choices.tier]       care tier key, or 'none'
 * @param {boolean} [choices.secondPerson]
 * @param {string[]} [choices.addOns]    keys from community.addOns
 * @returns {{
 *   public: boolean, base: number|null, care: number, secondPerson: number,
 *   addOns: Array<{key:string,label:string,monthly:number}>, monthly: number|null,
 *   oneTime: Array<{key:string,label:string,amount:number}>, lines: Array<object>
 * }}
 */
export function quote(unit, community, choices = {}) {
    const isPublic = community?.pricingPublic !== false;
    const careLevel = choices.careLevel ?? unit?.careLevels?.[0] ?? null;

    const base = Number.isFinite(unit?.baseRate) ? unit.baseRate : null;

    const tier = choices.tier === 'none' || !choices.tier ? null : tierByKey(community, choices.tier);
    const care = tier ? Number(tier.monthly) || 0 : 0;

    const secondPersonFee = Number(community?.fees?.secondPerson) || 0;
    const secondPerson = choices.secondPerson ? secondPersonFee : 0;

    const chosenAddOns = (choices.addOns ?? [])
        .map((key) => (community?.addOns ?? []).find((a) => a.key === key))
        .filter(Boolean)
        .map((a) => ({ key: a.key, label: a.label, monthly: Number(a.monthly) || 0 }));

    const addOnTotal = chosenAddOns.reduce((sum, a) => sum + a.monthly, 0);
    const monthly = base === null ? null : base + care + secondPerson + addOnTotal;

    const oneTime = [];
    const communityFee = Number(community?.fees?.community) || 0;
    if (communityFee) oneTime.push({ key: 'community', label: 'Community fee (one time)', amount: communityFee });
    const petFee = Number(community?.fees?.petDeposit) || 0;
    if (petFee && (choices.addOns ?? []).includes('pet')) {
        oneTime.push({ key: 'pet', label: 'Pet deposit (one time)', amount: petFee });
    }

    /* An ordered, renderable breakdown. Zero lines are dropped so the panel
       stays short for the common case of one resident at no care level. */
    const lines = [
        { key: 'base', label: 'Suite rate', amount: base, always: true },
        tier ? { key: 'care', label: `Care — ${tier.label}`, amount: care, note: tier.description } : null,
        secondPerson ? { key: 'second', label: 'Second person', amount: secondPerson } : null,
        ...chosenAddOns.map((a) => ({ key: `addon:${a.key}`, label: a.label, amount: a.monthly })),
    ].filter(Boolean);

    return { public: isPublic, base, care, secondPerson, addOns: chosenAddOns, monthly, oneTime, lines, careLevel, tier };
}

/**
 * The honest headline for a unit before a family has told us anything: the
 * suite rate, and what a typical resident at this care level actually pays.
 * Returns nulls when the listing keeps pricing private.
 */
export function headline(unit, community) {
    if (community?.pricingPublic === false) return { public: false, from: null, typical: null };
    const base = Number.isFinite(unit?.baseRate) ? unit.baseRate : null;
    if (base === null) return { public: true, from: null, typical: null };

    const level = unit?.careLevels?.[0] ?? null;
    const tiers = tiersFor(community, level);
    if (!tiers.length) return { public: true, from: base, typical: null };

    /* "Typical" is the median tier, not the cheapest — the cheapest is what
       makes the advertised number misleading in the first place. */
    const sorted = [...tiers].sort((a, b) => (a.monthly || 0) - (b.monthly || 0));
    const median = sorted[Math.floor(sorted.length / 2)];
    return { public: true, from: base, typical: base + (Number(median?.monthly) || 0), typicalTier: median ?? null };
}

/** Lowest possible monthly for a unit — what price filters sort and compare on. */
export function floorPrice(unit) {
    return Number.isFinite(unit?.baseRate) ? unit.baseRate : null;
}

export function money(n, { cents = false } = {}) {
    if (n === null || n === undefined || !Number.isFinite(Number(n))) return null;
    return '$' + Number(n).toLocaleString(undefined, {
        minimumFractionDigits: cents ? 2 : 0,
        maximumFractionDigits: cents ? 2 : 0,
    });
}
