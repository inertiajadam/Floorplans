# The data model, and why it is shaped like this

> **A note on the comparison.** `engrain.com` is blocked by this environment's
> network egress proxy, so this document does not claim to describe SightMap's
> current feature list — that would be guessing. What it argues is narrower and
> checkable: senior living has requirements that a model derived from
> multifamily apartment leasing does not naturally express, and here is how we
> express them. Where the client has specific complaints, check them against
> section 7 and tell me which ones matter most.

---

## 1. The core distinction: layout vs. unit

The platform already models **layouts** (`floor_plans`): "The Cedar, a one
bedroom, about 610 sq ft, from $4,950", with a 2D drawing and optionally a
delivered 3D rendering.

What it has never modelled is the **unit**: "204, a Cedar, second floor of
Magnolia House, free on 15 November, facing the courtyard, step-free, $5,075
because it is on a higher floor."

Everything interactive depends on that second thing existing. You cannot put a
layout on a floor plan — there are twelve of them and they are in twelve
different places. This is the whole reason the feature needs new tables rather
than new columns.

A unit points at a layout and inherits its drawing, size, bed/bath count and
description. Only what is genuinely per-suite is stored on the unit, so the
operator's existing uploads get *more* valuable: one 3D rendering now
illustrates every suite of that layout rather than one card.

---

## 2. Availability is not a boolean

An apartment is vacant or leased. That is why multifamily tools carry two
states. Senior living routinely needs to say six things:

| State | What it means | What the family can do |
|---|---|---|
| `available` | Ready now | Book a tour |
| `coming_available` | Empty, being refreshed | Reserve it before it opens |
| `waitlist` | Occupied, but a list exists | Join the list |
| `respite` | Let by the week for recovery or trial stays | Ask about a short stay |
| `held` | Reserved for another family | Ask to be next |
| `model` | Shown on tours, never for sale | See it on a tour |
| `occupied` | Someone lives here | Nothing — shown for context |

Each carries its own call to action, because "Apply now" is the wrong ask for
five of the seven. Collapsing this to available/unavailable is the single
biggest source of "I had to ring to ask a question the website should have
answered", and it is exactly the nuance that gets lost when a model built for
apartments is pointed at a care community.

`occupied` units are **drawn but never deleted** when filters are applied.
Seeing that the suite you want is at the quiet end of a hall, away from the
lift, is worth more than a tidy map.

---

## 3. Price is four numbers, not one

This is the part that matters most, and it is the reason the industry has the
reputation it has.

A real monthly bill is:

```
  base rate for the suite        ← the only number most maps show
+ level-of-care charge           ← set by a nurse assessment; $625–$2,450 here
+ second person fee              ← couples; often $900–$1,500
+ recurring extras               ← pet rent, covered parking, salon plan
──────────────────────────────
= monthly total

plus a one-time community fee    ← typically 1–2× a month's rate
```

Advertising the first line alone is technically true and practically
misleading. Families discover the rest on the first invoice.

So `community_care_tiers` exists, the care level is a **control the family
moves themselves**, and the total updates as they move it. The listing shows
two numbers up front — "from $4,950" and "most residents here pay about
$6,100" — where "typical" is the **median** tier, not the cheapest. Anchoring
on the cheapest is the behaviour being replaced.

`PricingPanel.vue` also states plainly that the care level is confirmed by
assessment, because it is, and pretending otherwise is how trust gets lost.

When a community keeps rates private (`pricing_public = false`, already on the
listing), the same structure renders with the figures withheld. The family
still learns *what* they will be charged for even when they must ring to find
out how much. The layout does not change between the two modes.

---

## 4. Accessibility is a filter, not a footnote

`accessible` (step-free, roll-in shower) is a first-class, indexed field and a
first-class filter control. For this audience it is frequently the *first*
hard requirement, and general-purpose property tools tend to bury it in a
free-text amenities list where it cannot be searched.

Same reasoning for `view` and `features`: an adult child choosing for a parent
with dementia cares whether the room faces the secured garden.

---

## 5. Care level is a dimension, not a tag

`care_levels` is an array on the unit, because a suite can serve more than one
(plenty of communities license a wing for both IL and AL), and because "what
kind of care does Mum need" is the only question a family can always answer.
It is the first filter in the bar for that reason.

Facets are derived from the data (`lib/model.js → facetsFor`), so a community
with no memory care never renders a memory care toggle that can only ever
return nothing.

---

## 6. One document, not an API per interaction

The whole community serialises into one JSON payload delivered with the page —
roughly 50 KB for 60 units, smaller than one photo already on the listing.

That buys:

- the map is interactive the moment the page paints; panning never waits on a
  network round trip
- every suite is server-renderable at its own URL, so `?unit=204` is a real,
  indexable page — something an iframe embed structurally cannot do
- no third-party origin in the critical path of your listing page

Geometry is a flat array — `[x1,y1,x2,y2,…]` — rather than `[{x,y}]`. Half the
JSON, and it is the exact form an SVG `points` attribute wants.

---

## 7. The scorecard

What this build does, and where it stands:

| | Status |
|---|---|
| Real polygon hit areas (an L-shaped suite has an L-shaped target) | ✅ |
| Seven availability states with per-state calls to action | ✅ |
| Level-of-care pricing the family can work out themselves | ✅ |
| Second person fee, extras, one-time community fee | ✅ |
| Private-pricing mode that keeps the same layout | ✅ |
| Step-free as a real filter | ✅ |
| Move-in-by date filter | ✅ |
| Full keyboard operation, spatially (arrows go where you point) | ✅ |
| Status encoded as pattern **and** colour, not colour alone | ✅ |
| Screen-reader parity — the list says everything the fill says | ✅ |
| 44px touch targets throughout | ✅ |
| Deep links to a suite or a filter set; back button works | ✅ |
| No iframe; no third-party origin | ✅ |
| Compare up to three suites | ✅ |
| Lead capture that names the suite, into your existing CRM pipeline | ✅ |
| Self-service geometry editing (the plan tracer) | ✅ |
| Operator-facing availability editing | ✅ |
| Freshness tracking, and a one-click "still accurate" | ✅ |
| "Availability confirmed N days ago" on the listing | ✅ opt-in per community |
| Operator-editable care tiers and fees | ✅ |
| Field ownership + per-field locks, ready for a feed | ✅ |
| A PMS adapter | ⛔ not built — deliberate; see [PMS-SYNC.md](PMS-SYNC.md) |
| 3D / virtual tour rendering | ➖ links out when `tour_url` is set |

---

## 8. Keeping the two halves in step

`src/lib/availability.js` and `App\Models\MapUnit::STATUSES` carry the same
vocabulary in two languages. There is no shared source of truth for it, so
**change them together**. The same applies to the payload keys in
`CommunityMaps::unit()` and the fields read in `lib/model.js → hydrateUnit` —
a mismatch there shows up as a silently missing field rather than an error,
which is the worst kind.

If this grows much further, generating the JS constants from the PHP at build
time is the fix. At two files it is not yet worth the machinery.
