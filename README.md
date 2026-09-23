# Community map

An interactive senior living availability map, built to replace the embedded
third-party map on a client listing and to live inside the Seniors Places
platform.

Not an iframe. Not a multifamily tool with "senior living" written on it.

```bash
npm install
npm run dev          # the family-facing map,  http://localhost:5173
                     # the owner portal panels, /operator.html
                     # the plan tracer,         /editor.html
npm run build
node scripts/smoke.mjs           # 29 browser checks — the map
node scripts/smoke-operator.mjs  # 27 browser checks — the operator panels
```

The demo runs against **The Commons on Meridian**, the first real community,
generated from its current site map by `scripts/build-commons.mjs`: 51 suites
across a memory care household and an assisted living wing, with the client's
own layout and view names. Rates and availability are placeholders except the
few its public map shows. A synthetic three-building campus (Willow Creek,
`scripts/build-demo.mjs`) is kept for stress-testing the multi-building case.

---

## What it does

**Three building typologies, one component.** A double-loaded corridor over
three floors (assisted living), a memory care household where suites ring a
shared hearth, and a field of free-standing cottages on a site plan. The third
is a map of a *site*, not a floor, and it needs no second code path.

**Availability that matches how communities actually sell.** Seven states —
available, coming available, waitlist, respite, held, model, occupied — each
with its own call to action, because "Apply now" is the wrong ask for five of
them. Occupied suites stay drawn so you can see that the one you want is at
the quiet end of the hall.

**Pricing worked out in front of the family.** The suite rate is the starting
figure; the level of care is a control the family moves themselves; the total
updates as they move it. Second person fee, recurring extras and the one-time
community fee are all shown. The listing headline says both "from $4,950" and
"most residents here pay about $6,100", where typical is the *median* care
tier — not the cheapest. Communities that keep rates private get the same
structure with the numbers withheld.

**Built for people over seventy, and their children on phones.**
- Every status is a hatch **pattern** as well as a colour. ~1 in 12 men are
  colour blind and contrast sensitivity drops with age; "green means available"
  on its own fails a lot of this audience.
- The whole map is keyboard-operable, and arrow keys move **spatially** — press
  Right and you go to the suite on the right, not the next one in DOM order.
- 44px touch targets throughout (WCAG 2.2 asks for 24).
- The list view is a first-class equal of the map, not a fallback. On a phone
  it is the better interface, and the map is what you open to answer "but
  where *is* it".
- `prefers-reduced-motion` disables the fly-to animation. Vestibular disorders
  are common in this group.
- Step-free with a roll-in shower is a real filter, not a line in an amenities
  blob.

**A URL for everything.** Filters, the open floor and the selected suite all
live in the query string. A link to "two-bedrooms under $6,000 in Magnolia"
can be texted to a sibling. The back button steps through the map instead of
leaving the page. Every suite is server-renderable and indexable — which an
iframe structurally cannot be.

**Leads that name the suite.** The map emits a payload; the host posts it. In
the platform that reuses the existing pipeline unchanged — duplicate
detection, `Stats`, `NotifyLead`, the Aline push, Meta CAPI — and adds the
suite, layout, floor, availability and rate. A sales counsellor reads *"Suite
204 — The Cedar, Magnolia Floor 2, coming available, asked for a visit on 15
November"* instead of "someone submitted the contact form".

**Operators keep it true themselves.** `/operator.html` is the owner portal.
Availability changes weekly; geometry changes yearly; the panels are shaped
around that gap. A suite is one dropdown saved on change, and the most common
truth — nothing changed — is a single "everything here is still right" button.
The roster opens on the work: suites that are bookable but unvouched-for, at
the top.

Freshness is tracked separately from `updated_at`, because `updated_at` moves
when anyone edits anything — a typo fix would make a year-old vacancy look
freshly checked. That one column drives the staleness nudge, the roster order,
and an opt-in "availability confirmed 2 days ago" line on the listing that
almost nothing else in the market can show.

**You own the geometry.** `/editor.html` is a plan tracer: load a floor plan
drawing, click to trace each suite, export JSON. Changing a map is not a
support ticket to a vendor. Re-tracing a floor later keeps every suite's
availability — matched by number — so fixing a mis-drawn wall never marks a
wing vacant.

**Ready for hands-off inventory sync.** No PMS adapter yet — that should be
written against a real customer's feed, not a guess. But everything expensive
to retrofit is in place: matching on a stable external id rather than suite
number, an explicit split of which fields a feed may write (occupancy, dates,
rent) versus which stay operator-owned (geometry, accessibility, layout), and
per-field operator locks. Writing an adapter becomes a translation job against
one seam. See [docs/PMS-SYNC.md](docs/PMS-SYNC.md).

---

## Layout

```
src/lib/          domain — availability vocabulary, care pricing maths, polygon geometry,
                  and the normaliser that turns a community document into what the UI reads
src/composables/  pan/zoom, URL-synced filters, compare tray, screen-reader announcements
src/components/   the family-facing UI. CommunityMap.vue is the only one a host page mounts
src/operator/     the owner portal: availability roster, care tiers & fees, structure
editor/           the plan tracer
laravel/          drop-in server side: migrations, models, payload builders, the
                  inventory write-layer (MapInventory), lead + portal controllers
demo/             the harness and the generated community datasets
docs/             INTEGRATION.md (how to land it) · DATA-MODEL.md (why it is shaped
                  this way) · PMS-SYNC.md (the inventory sync contract)
scripts/          community generators, the Floorplanner importer, browser smoke suites
```

`src/` imports nothing from outside `src/`. Moving it into the platform is a
copy plus an import-path fix — see [docs/INTEGRATION.md](docs/INTEGRATION.md).

---

## How it relates to the floor plans already in the platform

It **extends** them. `floor_plans` models a *layout* ("The Cedar, one bedroom,
~610 sq ft"). The new `community_map_units` models an *actual suite* ("204, a
Cedar, 2nd floor, free 15 Nov"). A unit points at a layout and inherits its
drawing and specs, so existing operator uploads keep working and get more
valuable — one 3D rendering now illustrates twelve bookable suites instead of
one card. The `$149` rendering upsell is untouched and should sell better.

Full detail: [docs/DATA-MODEL.md](docs/DATA-MODEL.md).

---

## Verification

Two suites drive real Chromium against the built output. **56 checks, all
passing.**

`smoke.mjs` (29) — rendering, filtering, deep-link round trips, spatial
keyboard navigation, the care-pricing maths, the lead flow, focus management,
accessible names and labels, mobile layout and touch targets.

`smoke-operator.mjs` (27) — status changes posting correctly, bulk actions,
confirm-all clearing the stale count, the pricing preview reacting live, sync
mode affordances, adding buildings, labels and thumb-sized controls. It also
pins down three rules that are easy to break silently: a coming-available
suite will not save without a date, switching status clears the previous
status's satellite fields, and confirm-all never touches availability itself.

The map suite caught three real bugs during the build, which is the argument
for keeping them: the fitted view cropped the lift core and shared rooms off
the edge of the plan; a selected suite could land underneath the desktop
drawer; and after a lead was sent, focus fell back to `<body>`, so Escape
stopped working and a screen reader announced nothing.

---

## Not built yet

Honest list, roughly in the order I would do them.

1. **PMS reconciliation screen.** The first piece of sync work, and it must
   exist before any adapter: pairing feed units to our suites has to be
   human-confirmed once, because auto-matching on suite number is the bug that
   marks the wrong room vacant. See §3 of PMS-SYNC.md.
2. **One PMS adapter**, against a real customer feed — then scheduling with an
   alarm on *silence*, not just on errors. A feed that stops returning rows
   looks like success while the map quietly freezes on stale data.
3. **Serve the plan tracer behind auth.** It is linked from the operator panel
   but is currently a public static page in this repo. A Blade view at
   `/account/plan-tracer` mounting the same component is enough.
4. **Server-rendered suite pages.** The URL contract is already there
   (`?unit=204`); the SEO win needs a controller that renders that suite into
   the page's meta tags and JSON-LD.
5. **`lead_form` reporting.** Map leads are stamped `community-map`. The
   backend inbox and reports filter on `lead_form`, so that value needs adding
   or map leads will be invisible there.
6. **A staleness nudge by email.** The panel shows the warning, but only to
   someone who logs in. The operators most likely to let a map rot are the
   ones least likely to visit the portal.
7. **Analytics.** Which suites get opened, which filters get used, where people
   drop out. Cheap to add, and it is what tells you whether this is working.
8. **A `tour_url` column on `floor_plans`.** The component already renders a
   "walk through this layout in 3D" link when one is present.

---

## Two things worth deciding early

**What happens when an operator ignores the nudge?** The panel makes keeping
availability current easy, and the freshness stamp makes neglect visible. It
does not decide what to *do* about it. The options are a policy call, not a
technical one: hide a map whose suites have all gone stale, drop the
"confirmed" line, email the operator, or let it ride. Doing nothing is a real
choice — it just means some listings will quietly show availability from three
months ago.

**Does the client's community have real plan drawings?** The demo generates
its geometry. Real communities need a drawing to trace over, and the quality of
what they can supply — a CAD export, a PDF, a photo of a laminated sheet in the
lobby — decides how long tracing takes per building. This is the one thing
still blocking a real pilot.
