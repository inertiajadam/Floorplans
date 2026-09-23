# Dropping this into seniorsplaces-platform

The components are written against the platform's stack as it stands —
Laravel 12 + Inertia v3 + Vue 3.5 + Tailwind v4 — and use the design tokens
already defined in `resources/css/app.css`. They compile in that app's Vite
build with no extra dependencies.

This repo exists so the work can be reviewed and demoed standalone. Nothing in
`src/` imports anything outside `src/`, so moving it is a copy.

---

## 1. Frontend

Copy the component tree in:

```
src/components/*.vue      →  resources/js/Components/Frontend/CommunityMap/
src/composables/*.js      →  resources/js/Composables/
src/lib/*.js              →  resources/js/Support/communityMap/
```

Then fix the relative imports — the components reach for `../lib/…` and
`../composables/…`, which become `@/Support/communityMap/…` and
`@/Composables/…` under the platform's alias.

### Tokens to add

`src/tokens.css` contains a copy of the platform's `@theme` block purely so
this repo renders identically on its own. **Do not port that part.** Only the
block marked `NEW, port these into the host app's @theme` needs adding to
`resources/css/app.css`:

- `--color-status-*` (seven statuses, fill and text tone each)
- `--color-plan-*` (corridor, amenity, outdoor, staff, wall)
- `--shadow-map-panel`

Plus the two `@layer base` rules for focus rings and `prefers-reduced-motion`,
and the `.tap-safe` utility. All are additive; nothing existing changes.

### Mounting it

On `resources/js/Pages/Frontend/Community/Show.vue`, beside the existing
`<FloorPlans />` section:

```vue
<script setup>
import CommunityMap from '@/Components/Frontend/CommunityMap/CommunityMap.vue';
import { router } from '@inertiajs/vue3';
import { ref } from 'vue';

const props = defineProps({ community: Object, communityMap: Object, /* … */ });

const submitting = ref(false);
const sent = ref(false);
const leadError = ref(null);

function onLead(payload) {
    submitting.value = true;
    leadError.value = null;

    router.post(`/community/${props.community.slug}/map-lead`, {
        name: payload.name,
        email: payload.email,
        phone: payload.phone,
        preferred: payload.preferred,
        relationship: payload.relationship,
        intent: payload.intent,
        tour_date: payload.tourDate || null,
        message: payload.message,
        unit_id: payload.context.unitId,
        website: '',                       // honeypot, same as the other forms
    }, {
        preserveScroll: true,
        preserveState: true,
        onSuccess: () => { sent.value = true; },
        onError: (errors) => { leadError.value = Object.values(errors)[0] ?? 'Something went wrong. Please try again.'; },
        onFinish: () => { submitting.value = false; },
    });
}
</script>

<template>
    <CommunityMap
        v-if="communityMap"
        :community="communityMap"
        :submitting="submitting"
        :lead-sent="sent"
        :lead-error="leadError"
        @lead="onLead"
    />
    <!-- No map configured: the existing layout cards still carry the page. -->
    <FloorPlans v-else :plans="floorPlans" :community="community.name" />
</template>
```

`preserveState: true` matters — without it Inertia replaces the page component
and the family loses their filters, their zoom and their place on the plan.

---

## 2. Backend

```
laravel/migrations/*.php                    →  database/migrations/
laravel/Models/*.php                        →  app/Models/
laravel/Support/CommunityMaps.php           →  app/Support/
laravel/Http/Controllers/*.php              →  app/Http/Controllers/Frontend/
```

The controller's namespace is already `App\Http\Controllers\Frontend`.

### Route

In `routes/frontend.php`, beside the existing tour route:

```php
use App\Http\Controllers\Frontend\CommunityMapLeadController;

// Interactive community map enquiry (Featured / Enterprise, map published)
Route::post('/community/{slug}/map-lead', [CommunityMapLeadController::class, 'store'])
    ->middleware('throttle:10,1')
    ->name('frontend.community.map-lead');
```

### Controller wiring

In `CommunityController@show`, add the payload to the Inertia props:

```php
use App\Support\CommunityMaps;

return Inertia::render('Frontend/Community/Show', [
    // … existing props …
    'communityMap' => CommunityMaps::payload($community) ?: null,
]);
```

`payload()` returns `[]` when the community has no published map, which the
`v-if` above turns back into the existing floor-plan cards. A community that
never configures a map is never worse off than it is today.

---

## 3. How this relates to the floor plans you already have

It extends them; it does not replace them. The distinction is the design:

| | What it is | Table |
|---|---|---|
| **Floor plan** | A **layout** the community offers — "The Cedar, one bedroom, ~610 sq ft, from $4,950". The 2D drawing and any delivered 3D rendering. | `floor_plans` *(existing, untouched)* |
| **Map unit** | An **actual suite** — "204, a Cedar, 2nd floor of Magnolia, free 15 Nov, courtyard-facing, step-free". | `community_map_units` *(new)* |

A unit points at a floor plan via `floor_plan_id` and inherits its drawing,
size, bed/bath count and description. Only what is specific to that suite is
stored on the unit. So the operator's existing uploads keep working and get
more valuable: one 3D rendering now illustrates every suite of that layout.

The `$149` 3D rendering upsell (`FloorPlanOrder`) is unaffected, and arguably
sells better once a rendering is attached to twelve bookable suites rather than
one card.

### New tables

| Table | Holds |
|---|---|
| `community_map_buildings` | Buildings on a campus |
| `community_map_levels` | Floors, and the coordinate space their geometry is drawn in |
| `community_map_units` | Real suites: geometry, availability, rate, accessibility |
| `community_map_features` | Corridors, dining rooms, gardens, lift cores |
| `community_care_tiers` | **Levels of care and what they add per month** |
| `community_map_settings` | Community fee, second person fee, extras, publish switch |

`community_care_tiers` is the one worth arguing for on its own merits. The
platform currently cannot express "Level 2 care is $1,150/month", which is why
every listing can only ever advertise a starting rate. It is the number
families most want and can least often find.

---

## 4. Lead flow

The map does not post anything itself — it emits a payload and the host decides.
`CommunityMapLeadController` deliberately reuses the existing pipeline rather
than forking it: duplicate detection, `Stats::lead`, `NotifyLead`, the Aline
push via `PushToCrm`, and the Meta CAPI event all behave exactly as they do for
a tour request.

What it adds is the suite. These land in `custom_ques_ans.answers`:

| Key | Example |
|---|---|
| `suite` | `"204"` |
| `layout` | `"The Cedar"` |
| `building` / `floor` | `"Magnolia House"` / `"Floor 2"` |
| `care_level` | `"al"` |
| `availability` | `"coming_available"` |
| `suite_rate` | `4950` |
| `intent` | `"tour"` or `"info"` |
| `tour_date` | `"2026-11-15"` |
| `relationship` | `"parent"` |

and into the notification email's labelled block, so a sales counsellor opens
it and reads *"Suite 204 — The Cedar, Magnolia House Floor 2, coming
available, asked for a visit on 15 November"*.

The suite is re-resolved server-side from `unit_id` rather than trusted from
the post body, so the lead records what the family was actually shown.

**Note on `lead_form`:** map leads are stamped `community-map`. Anything that
filters or reports on `lead_form` — the backend inbox, reports, CRM mapping —
needs that value adding, or map leads will be invisible in those views.

---

## 5. Authoring a community's map

1. The operator uploads their layouts as they do now (`FloorPlans` panel).
2. Open `/editor.html` (the plan tracer), load the floor plan drawing, and
   trace each suite. Set number, layout id, availability and rate as you go.
3. Copy the exported JSON into a `community_map_levels` row plus its
   `community_map_units`.
4. Add the care tiers and fees.
5. Flip `community_map_settings.is_published`.

Step 3 is a seeder or a paste today. The obvious next piece of work is an
operator-facing panel in the portal that wraps the tracer, so communities
maintain their own availability — see "Not built yet" in the README.

---

## 6. Checks

```bash
npm run build          # compiles clean
node scripts/smoke.mjs # 28 browser checks: rendering, filtering, deep links,
                       # keyboard nav, pricing maths, lead flow, a11y, mobile
```

`scripts/smoke.mjs` drives a real Chromium against the built output. It is
worth keeping pointed at the platform's own build once the components move —
the accessibility and touch-target checks in particular are the kind of thing
that regresses silently.
