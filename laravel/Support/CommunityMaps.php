<?php

namespace App\Support;

use App\Models\CareTier;
use App\Models\CommunityMapSetting;
use App\Models\FloorPlan;
use App\Models\Legacy\Community;
use App\Models\MapBuilding;
use App\Models\MapUnit;
use Illuminate\Support\Collection;

/**
 * The interactive community map.
 *
 * Builds the single JSON document the Vue component consumes. Follows the same
 * shape as App\Support\FloorPlans — a `payload()` for the public listing and a
 * `portalPayload()` for the operator's edit panel — so the two features read
 * the same way and share the tier gate.
 *
 * WHY ONE DOCUMENT: a family panning a floor plan should never wait on a
 * network round trip. A 60-unit community serialises to roughly 50 KB, which
 * is smaller than one of the photos already on the listing page, and it means
 * the map is interactive the moment the page paints. It is also what makes
 * every suite server-renderable at its own URL, which an iframe map cannot do.
 *
 * PRICING: `pricing_public` on the listing is honoured exactly as it is for
 * floor plans — when an operator keeps rates private every figure in the
 * payload is null, and the component renders the same structure with the
 * numbers withheld rather than a different, emptier layout.
 */
class CommunityMaps
{
    /** Gated on the same tiers as floor plans — a map is a Featured/Enterprise feature. */
    public static function allowed(Community $c): bool
    {
        return FloorPlans::allowed($c);
    }

    /** A map shows publicly only when it is allowed, configured AND published by the operator. */
    public static function isLive(Community $c): bool
    {
        if (! self::allowed($c)) {
            return false;
        }

        $settings = self::settings($c);

        return (bool) $settings?->is_published
            && MapBuilding::where('community_id', $c->id)->exists();
    }

    public static function settings(Community $c): ?CommunityMapSetting
    {
        return CommunityMapSetting::firstWhere('community_id', $c->id);
    }

    /**
     * The public payload. Returns an empty array when the community has no
     * live map, which the listing page treats as "render the plain floor plan
     * cards instead" — so a community without a map is never worse off.
     *
     * @return array<string, mixed>
     */
    public static function payload(Community $c): array
    {
        if (! self::isLive($c)) {
            return [];
        }

        $settings = self::settings($c);
        $showPrice = (bool) ($c->pricing_public ?? true);

        /* Eager-load the whole tree in one pass. Without this a 60-unit campus
           issues a query per unit for its layout, which is the classic way a
           map like this ends up taking two seconds to render. */
        $buildings = MapBuilding::where('community_id', $c->id)
            ->with(['levels.units.floorPlan', 'levels.features'])
            ->orderBy('sort')->orderBy('id')
            ->get();

        $units = $buildings->flatMap->levels->flatMap->units;

        return [
            'id'            => $c->id,
            'slug'          => $c->community_slug,
            'name'          => $c->community_name ?? 'This community',
            'city'          => $c->community_city ?? null,
            'state'         => $c->community_state ?? null,
            'pricingPublic' => $showPrice,

            'careLevels' => self::careLevels($units),
            'careTiers'  => $showPrice ? self::careTiers($c) : [],
            'addOns'     => $showPrice ? ($settings?->add_ons ?? []) : [],
            'fees'       => $showPrice ? array_filter([
                'community'    => $settings?->community_fee,
                'secondPerson' => $settings?->second_person_fee,
                'petDeposit'   => $settings?->pet_deposit,
            ], static fn ($v) => $v !== null) : [],

            'layouts'   => self::layouts($c, $showPrice),
            'buildings' => $buildings->map(static fn (MapBuilding $b) => [
                'id'        => (string) $b->id,
                'name'      => $b->name,
                'shortName' => $b->short_name ?: $b->name,
                'blurb'     => $b->blurb,
                'levels'    => $b->levels->map(static fn ($lv) => [
                    'id'      => (string) $lv->id,
                    'name'    => $lv->name,
                    'ordinal' => (int) $lv->ordinal,
                    'plan'    => [
                        'image'  => $lv->planImageUrl(),
                        'width'  => (int) $lv->plan_width,
                        'height' => (int) $lv->plan_height,
                    ],
                    'units'    => $lv->units->map(static fn (MapUnit $u) => self::unit($u, $showPrice))->values()->all(),
                    'features' => $lv->features->map(static fn ($f) => [
                        'id'    => (string) $f->id,
                        'kind'  => $f->kind,
                        'label' => $f->label,
                        'shape' => $f->shape,
                    ])->values()->all(),
                ])->values()->all(),
            ])->values()->all(),

            'legalNote' => $settings?->legal_note,
        ];
    }

    /**
     * One suite. Keys match src/lib/model.js exactly — the component does no
     * renaming, so a mismatch here shows up as a silently missing field rather
     * than an error. Keep the two in step.
     *
     * @return array<string, mixed>
     */
    private static function unit(MapUnit $u, bool $showPrice): array
    {
        return [
            'id'      => (string) $u->id,
            'number'  => $u->number,
            'layoutId'=> $u->floor_plan_id ? (string) $u->floor_plan_id : null,
            'shape'   => $u->shape,

            'status'             => $u->status,
            'availableOn'        => $u->available_on?->toDateString(),
            'waitlistCount'      => $u->waitlist_count,
            'respiteNightlyRate' => $showPrice ? $u->respite_nightly_rate : null,

            'careLevels' => $u->care_levels ?? [],
            'baseRate'   => $showPrice ? $u->rate() : null,
            'sqft'       => $u->size(),
            'accessible' => (bool) $u->accessible,
            'view'       => $u->view,
            'features'   => $u->features ?? [],
            /* `notes` is deliberately absent: it is an internal field and this
               payload is public. Do not add it here. */
        ];
    }

    /**
     * Layouts, drawn from the EXISTING floor_plans table. A unit points at one
     * of these for its drawing, size and description; nothing is duplicated.
     *
     * @return array<int, array<string, mixed>>
     */
    private static function layouts(Community $c, bool $showPrice): array
    {
        return FloorPlan::where('community_id', $c->id)
            ->orderBy('sort')->orderBy('id')
            ->get()
            ->map(static fn (FloorPlan $p) => [
                'id'          => (string) $p->id,
                'name'        => $p->name,
                'roomType'    => $p->room_type,
                'typeLabel'   => FloorPlans::roomTypeLabel($p->room_type),
                'sqft'        => $p->sqft,
                'bedrooms'    => $p->bedrooms,
                'bathrooms'   => $p->bathrooms,
                'description' => $p->description,
                'image2d'     => $p->image_2d ? FloorPlans::url($p->image_2d) : null,
                'image3d'     => $p->image_3d ? FloorPlans::url($p->image_3d) : null,
                'baseRate'    => $showPrice ? $p->starting_price : null,
                /* floor_plans has no tour_url column today. The component
                   renders a "walk through this layout in 3D" link when one is
                   present, so add the column when you start selling Matterport
                   tours and this starts working with no frontend change. */
                'tourUrl'     => $p->tour_url ?? null,
            ])->values()->all();
    }

    /** @return array<int, array<string, mixed>> */
    private static function careTiers(Community $c): array
    {
        return CareTier::where('community_id', $c->id)
            ->orderBy('sort')->orderBy('monthly')
            ->get()
            ->map(static fn (CareTier $t) => [
                'key'         => $t->key,
                'label'       => $t->label,
                'monthly'     => (int) $t->monthly,
                'careLevels'  => $t->care_levels ?? [],
                'description' => $t->description,
            ])->values()->all();
    }

    /**
     * Only the care levels this campus actually has units for, so the filter
     * bar never offers a toggle that can only return nothing.
     *
     * @return array<int, array{key: string}>
     */
    private static function careLevels(Collection $units): array
    {
        $keys = $units->flatMap(static fn (MapUnit $u) => $u->care_levels ?? [])->unique()->values();

        /* Preserve the order families move through, not database order. */
        $order = ['il', 'al', 'mc', 'snf'];

        return $keys->sortBy(static fn ($k) => array_search($k, $order, true) === false ? 99 : array_search($k, $order, true))
            ->map(static fn ($k) => ['key' => $k])
            ->values()->all();
    }

    /**
     * Headline counts for the listing page, so it can say "12 suites available"
     * above the fold without shipping the whole map payload first.
     *
     * @return array{available: int, actionable: int, total: int, careLevels: int}
     */
    public static function summary(Community $c): array
    {
        if (! self::isLive($c)) {
            return ['available' => 0, 'actionable' => 0, 'total' => 0, 'careLevels' => 0];
        }

        $units = MapUnit::where('community_id', $c->id)->get(['status', 'care_levels']);

        return [
            'available'  => $units->where('status', MapUnit::AVAILABLE)->count(),
            'actionable' => $units->filter->isActionable()->count(),
            'total'      => $units->count(),
            'careLevels' => $units->flatMap(static fn ($u) => $u->care_levels ?? [])->unique()->count(),
        ];
    }
}
