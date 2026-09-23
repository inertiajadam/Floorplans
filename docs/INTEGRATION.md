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

## 5. The operator panel

Three panels for the listing edit page, in `src/operator/`:

| Component | What it does | How often it gets used |
|---|---|---|
| `AvailabilityPanel.vue` | The rent roll. Inline status, bulk actions, confirm-all | Weekly, sometimes daily |
| `PricingPanel.vue` | Care tiers, fees, freshness settings | A few times a year |
| `StructurePanel.vue` | Buildings, floors, pasting traced geometry | Once, then rarely |

They are shaped around that frequency gap. Availability is one dropdown per
suite saved on change; structure is ordinary forms.

### Copying them in

```
src/operator/*.vue  →  resources/js/Components/Frontend/Portal/CommunityMap/
```

### The `submit` contract

The panels post nothing themselves. They call a `submit(action, payload)` prop
and await it; throwing surfaces an error in the panel. That keeps them
drivable in a browser test with no Laravel behind them — which is how
`scripts/smoke-operator.mjs` works.

On `Pages/Frontend/Portal/Communities/Form.vue`:

```vue
<script setup>
import AvailabilityPanel from '@/Components/Frontend/Portal/CommunityMap/AvailabilityPanel.vue';
import PricingPanel from '@/Components/Frontend/Portal/CommunityMap/PricingPanel.vue';
import StructurePanel from '@/Components/Frontend/Portal/CommunityMap/StructurePanel.vue';
import { router } from '@inertiajs/vue3';

const props = defineProps({ community: Object, communityMap: Object /* … */ });

const base = `/account/communities/${props.community.id}/map`;

const ROUTES = {
    'unit.update':      (p) => [`${base}/units/${p.id}`, p],
    'bulk.status':      (p) => [`${base}/bulk-status`, p],
    'confirm.all':      (p) => [`${base}/confirm`, p],
    'lock.toggle':      (p) => [`${base}/units/${p.id}/lock`, p],
    'publish':          (p) => [`${base}/publish`, p],
    'tiers.save':       (p) => [`${base}/tiers`, p],
    'settings.save':    (p) => [`${base}/settings`, p],
    'building.store':   (p) => [`${base}/buildings`, p],
    'building.destroy': (p) => [`${base}/buildings/${p.id}`, p, 'delete'],
    'level.store':      (p) => [`${base}/levels`, p],
    'level.import':     (p) => [`${base}/levels/${p.id}/import`, p],
};

function submit(action, payload) {
    const [url, data, method = 'post'] = ROUTES[action](payload);

    return new Promise((resolve, reject) => {
        router[method](url, data, {
            preserveScroll: true,
            preserveState: true,
            onSuccess: resolve,
            onError: (errors) => reject(new Error(Object.values(errors)[0] ?? 'That did not save.')),
        });
    });
}
</script>

<template>
    <AvailabilityPanel :map="communityMap" :community-id="community.id" :submit="submit" />
    <PricingPanel :map="communityMap" :submit="submit" />
    <StructurePanel :map="communityMap" :submit="submit" tracer-url="/account/plan-tracer" />
</template>
```

`preserveState: true` matters: without it Inertia replaces the page component
and the operator loses their scroll position and selection mid-edit.

### Routes

In `routes/frontend.php`, inside the existing `account.` group beside the
floor-plan routes:

```php
use App\Http\Controllers\Frontend\Portal\CommunityMapController as MapCtl;

Route::prefix('/communities/{community}/map')->whereNumber('community')->name('communities.map.')->group(function () {
    Route::post('/units/{unit}',        [MapCtl::class, 'updateUnit'])->whereNumber('unit')->name('units.update');
    Route::post('/units/{unit}/lock',   [MapCtl::class, 'toggleLock'])->whereNumber('unit')->name('units.lock');
    Route::post('/bulk-status',         [MapCtl::class, 'bulkStatus'])->name('bulk-status');
    Route::post('/confirm',             [MapCtl::class, 'confirmAll'])->name('confirm');
    Route::post('/publish',             [MapCtl::class, 'publish'])->name('publish');
    Route::post('/tiers',               [MapCtl::class, 'saveTiers'])->name('tiers');
    Route::post('/settings',            [MapCtl::class, 'saveSettings'])->name('settings');
    Route::post('/buildings',           [MapCtl::class, 'storeBuilding'])->name('buildings.store');
    Route::delete('/buildings/{building}', [MapCtl::class, 'destroyBuilding'])->whereNumber('building')->name('buildings.destroy');
    Route::post('/levels',              [MapCtl::class, 'storeLevel'])->name('levels.store');
    Route::post('/levels/{level}/import', [MapCtl::class, 'importLevel'])->whereNumber('level')->name('levels.import');
});
```

And add the payload to `OwnerCommunityController@edit`:

```php
'communityMap' => CommunityMaps::portalPayload($community),
```

### The plan tracer needs a home

`StructurePanel` links to `tracerUrl` for tracing. Serve `editor.html` behind
auth — a Blade view at `/account/plan-tracer` that mounts the same component
is enough. It is an internal tool, so it should not be publicly reachable.

### Freshness

Two migrations, applied in order:

1. `create_community_map_tables` — the map itself
2. `add_inventory_sync_to_community_map` — freshness stamps and the
   sync-readiness columns

The second adds `availability_confirmed_at`, which is what the whole panel is
built around. It is tracked separately from `updated_at` because `updated_at`
moves when anyone edits anything — a typo fix in a description would make a
year-old vacancy look freshly checked.

---

## 6. Authoring a community's map

1. The operator uploads their layouts as they do now (`FloorPlans` panel).
2. **Buildings &amp; floor plans** panel → add a building (it gets a ground
   floor automatically).
3. Open the plan tracer, trace the floor, copy the JSON.
4. Paste it into that floor via **Paste the plan**.
5. **Levels of care &amp; fees** panel → tiers and fees, watching the live
   preview of the line families will read.
6. **Publish the map.**

After that, keeping it current is a dropdown per suite, or one click on
"everything here is still right".

Re-tracing a floor later is safe: suites are matched by number and keep their
availability, dates and rates. Only the shapes change. That is enforced in
`CommunityMapController::importLevel` and is worth not breaking — an operator
fixing a mis-drawn wall should never discover they have marked a wing vacant.

---

## 7. Checks

```bash
npm run build                    # compiles clean
node scripts/smoke.mjs           # 29 checks: the family-facing map
node scripts/smoke-operator.mjs  # 27 checks: the operator panels
```

Both drive a real Chromium against the built output. Worth keeping pointed at
the platform's own build once the components move — the accessibility and
touch-target checks in particular are the kind of thing that regresses
silently.

The operator suite encodes several rules that are easy to break by accident:
a coming-available suite will not save without a date, switching status clears
the previous status's satellite fields, and confirm-all clears the stale count
without touching availability.
