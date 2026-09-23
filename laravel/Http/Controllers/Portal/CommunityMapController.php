<?php

namespace App\Http\Controllers\Frontend\Portal;

use App\Http\Controllers\Controller;
use App\Models\CareTier;
use App\Models\CommunityMapSetting;
use App\Models\Legacy\Community;
use App\Models\MapBuilding;
use App\Models\MapLevel;
use App\Models\MapUnit;
use App\Support\CommunityMaps;
use App\Support\MapInventory;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Owner portal: the community map.
 *
 * Two jobs, on very different clocks, and the panel is shaped around the gap
 * between them:
 *
 *   Availability   changes weekly, sometimes daily. Has to be a ten-second
 *                  job or it will not get done, and a stale map is worse than
 *                  no map.
 *   Structure      buildings, floors, geometry. Changes once a year, if that.
 *
 * So availability gets inline controls, bulk actions and a one-click "still
 * accurate"; structure gets ordinary forms and hands geometry off to the plan
 * tracer. Optimising both for the same frequency would make the common case
 * tedious and the rare case cramped.
 *
 * Every availability write goes through App\Support\MapInventory so the
 * freshness stamp and the field-ownership rules cannot be bypassed — the same
 * door a PMS feed will later come through.
 *
 * The panel lives on the listing edit page; data comes from
 * OwnerCommunityController::edit via CommunityMaps::portalPayload().
 */
class CommunityMapController extends Controller
{
    /* ------------------------------------------------------- availability */

    /** One suite's availability, from the roster row. */
    public function updateUnit(Request $request, int $community, MapUnit $unit): RedirectResponse
    {
        $c = $this->own($request, $community);
        abort_unless((int) $unit->community_id === (int) $c->id, 404);

        $data = $request->validate([
            'status'               => ['required', Rule::in(MapUnit::STATUSES)],
            'available_on'         => ['nullable', 'date', 'after_or_equal:today', 'required_if:status,' . MapUnit::COMING_AVAILABLE],
            'waitlist_count'       => ['nullable', 'integer', 'min:0', 'max:999'],
            'respite_nightly_rate' => ['nullable', 'integer', 'min:0', 'max:5000'],
            'base_rate'            => ['nullable', 'integer', 'min:0', 'max:100000'],
        ]);

        MapInventory::update($unit, $data, $request->user());

        return back()->with('success', "Suite {$unit->number} updated.");
    }

    /** One status across a selection — "these six are all occupied now". */
    public function bulkStatus(Request $request, int $community): RedirectResponse
    {
        $c = $this->own($request, $community);

        $data = $request->validate([
            'ids'    => ['required', 'array', 'min:1'],
            'ids.*'  => ['integer'],
            'status' => ['required', Rule::in(MapUnit::STATUSES)],
        ]);

        $n = MapInventory::bulkStatus($c, $data['ids'], $data['status'], $request->user());

        return back()->with('success', $n . ' suite' . ($n === 1 ? '' : 's') . ' set to ' . str_replace('_', ' ', $data['status']) . '.');
    }

    /**
     * "Everything here is still right."
     *
     * The most-used button in the panel, because the most common truth about a
     * rent roll is that nothing changed since last week. It moves only the
     * freshness stamp, never the availability, so it cannot publish a change
     * by accident.
     */
    public function confirmAll(Request $request, int $community): RedirectResponse
    {
        $c = $this->own($request, $community);
        $n = MapInventory::confirmAll($c, $request->user());

        return back()->with('success', "Thank you — all {$n} suites are marked as confirmed today.");
    }

    /** Pin a field so a later inventory feed cannot overwrite it. */
    public function toggleLock(Request $request, int $community, MapUnit $unit): RedirectResponse
    {
        $c = $this->own($request, $community);
        abort_unless((int) $unit->community_id === (int) $c->id, 404);

        $field = (string) $request->input('field');
        abort_unless(in_array($field, MapInventory::LOCKABLE, true), 422);

        $locked = MapInventory::toggleLock($unit, $field);

        return back()->with('success', in_array($field, $locked, true)
            ? "Suite {$unit->number}: that value is now kept as you set it, even when inventory syncs."
            : "Suite {$unit->number}: that value will follow your inventory system again.");
    }

    /* ----------------------------------------------------------- structure */

    public function storeBuilding(Request $request, int $community): RedirectResponse
    {
        $c = $this->gate($request, $community);

        $data = $request->validate([
            'name'       => ['required', 'string', 'max:120'],
            'short_name' => ['nullable', 'string', 'max:60'],
            'blurb'      => ['nullable', 'string', 'max:300'],
        ]);

        $building = MapBuilding::create($data + [
            'community_id' => $c->id,
            'sort'         => (int) MapBuilding::where('community_id', $c->id)->max('sort') + 1,
        ]);

        /* A building with no floor cannot hold anything, and an operator who
           has just named one is about to add a floor anyway. */
        MapLevel::create([
            'building_id'  => $building->id,
            'community_id' => $c->id,
            'name'         => 'Ground floor',
            'ordinal'      => 1,
        ]);

        return back()->with('success', $building->name . ' added, with a ground floor to start.');
    }

    public function destroyBuilding(Request $request, int $community, MapBuilding $building): RedirectResponse
    {
        $c = $this->own($request, $community);
        abort_unless((int) $building->community_id === (int) $c->id, 404);

        $units = MapUnit::whereIn('level_id', $building->levels()->pluck('id'))->count();
        if ($units > 0) {
            return back()->with('error', "{$building->name} still has {$units} suite" . ($units === 1 ? '' : 's') . '. Remove those first — deleting them would lose the floor plan shapes you traced.');
        }

        $name = $building->name;
        $building->levels()->delete();
        $building->delete();

        return back()->with('success', $name . ' removed.');
    }

    public function storeLevel(Request $request, int $community): RedirectResponse
    {
        $c = $this->gate($request, $community);

        $data = $request->validate([
            'building_id' => ['required', 'integer'],
            'name'        => ['required', 'string', 'max:80'],
            'ordinal'     => ['nullable', 'integer', 'min:0', 'max:99'],
            'plan_width'  => ['nullable', 'integer', 'min:100', 'max:20000'],
            'plan_height' => ['nullable', 'integer', 'min:100', 'max:20000'],
        ]);

        $building = MapBuilding::where('community_id', $c->id)->findOrFail($data['building_id']);

        MapLevel::create([
            'building_id'  => $building->id,
            'community_id' => $c->id,
            'name'         => $data['name'],
            'ordinal'      => $data['ordinal'] ?? ((int) $building->levels()->max('ordinal') + 1),
            'plan_width'   => $data['plan_width'] ?? 1200,
            'plan_height'  => $data['plan_height'] ?? 800,
        ]);

        return back()->with('success', $data['name'] . ' added to ' . $building->name . '.');
    }

    /**
     * Replace a level's suites from the plan tracer's export.
     *
     * Tracing is the one part of this that is genuinely a drawing job, so it
     * happens in the tracer and lands here as JSON. Availability is preserved
     * across the replace by suite number: re-tracing a floor to fix a wall
     * should not silently mark the whole wing vacant.
     */
    public function importLevel(Request $request, int $community, MapLevel $level): RedirectResponse
    {
        $c = $this->gate($request, $community);
        abort_unless((int) $level->community_id === (int) $c->id, 404);

        $data = $request->validate([
            'geometry' => ['required', 'string', 'max:2000000'],
        ]);

        $parsed = json_decode($data['geometry'], true);
        if (! is_array($parsed) || ! is_array($parsed['units'] ?? null)) {
            return back()->with('error', 'That does not look like a plan export. Copy the JSON from the plan tracer and paste the whole thing.');
        }

        /* Keep what the tracer cannot know. */
        $existing = MapUnit::where('level_id', $level->id)->get()->keyBy('number');

        $kept = 0;
        $added = 0;
        foreach ($parsed['units'] as $row) {
            $number = trim((string) ($row['number'] ?? ''));
            if ($number === '' || ! is_array($row['shape'] ?? null)) {
                continue;
            }

            $prior = $existing->get($number);
            $attrs = [
                'level_id'      => $level->id,
                'community_id'  => $c->id,
                'number'        => $number,
                'shape'         => array_map('floatval', $row['shape']),
                'care_levels'   => $row['careLevels'] ?? ($prior->care_levels ?? []),
                'accessible'    => (bool) ($row['accessible'] ?? ($prior->accessible ?? false)),
                'view'          => $row['view'] ?? ($prior->view ?? null),
                'sqft'          => $row['sqft'] ?? ($prior->sqft ?? null),
                'floor_plan_id' => $prior->floor_plan_id ?? null,
            ];

            if ($prior) {
                /* Availability, rate and freshness belong to the rent roll,
                   not to the drawing. Re-tracing must not touch them. */
                $prior->fill($attrs)->save();
                $kept++;
            } else {
                MapUnit::create($attrs + ['status' => MapUnit::OCCUPIED]);
                $added++;
            }
        }

        /* A suite that disappeared from the tracing was genuinely removed. */
        $traced = collect($parsed['units'])->pluck('number')->map(static fn ($n) => trim((string) $n))->filter();
        $removed = MapUnit::where('level_id', $level->id)->whereNotIn('number', $traced)->delete();

        if (! empty($parsed['plan']['width'])) {
            $level->forceFill([
                'plan_width'  => (int) $parsed['plan']['width'],
                'plan_height' => (int) ($parsed['plan']['height'] ?? $level->plan_height),
            ])->save();
        }

        return back()->with('success', "{$level->name}: {$added} suite(s) added, {$kept} updated keeping their availability, {$removed} removed.");
    }

    /* ------------------------------------------------------ tiers and fees */

    /**
     * Levels of care and what they add to the monthly bill.
     *
     * The platform has never been able to express "Level 2 care is $1,150 a
     * month", which is why a listing can only advertise a starting rate. It is
     * the number families most want and can least often find, so it is worth
     * the operator's time to fill in.
     */
    public function saveTiers(Request $request, int $community): RedirectResponse
    {
        $c = $this->gate($request, $community);

        $data = $request->validate([
            'tiers'                => ['present', 'array', 'max:12'],
            'tiers.*.key'          => ['required', 'string', 'max:30', 'regex:/^[a-z0-9\-]+$/i'],
            'tiers.*.label'        => ['required', 'string', 'max:60'],
            'tiers.*.monthly'      => ['required', 'integer', 'min:0', 'max:50000'],
            'tiers.*.description'  => ['nullable', 'string', 'max:200'],
            'tiers.*.care_levels'  => ['nullable', 'array'],
            'tiers.*.care_levels.*'=> ['string', Rule::in(['il', 'al', 'mc', 'snf'])],
        ]);

        $keys = collect($data['tiers'])->pluck('key')->map(static fn ($k) => strtolower(trim($k)));
        if ($keys->count() !== $keys->unique()->count()) {
            return back()->with('error', 'Two care levels share the same key. Each needs its own.');
        }

        CareTier::where('community_id', $c->id)->whereNotIn('key', $keys)->delete();

        foreach ($data['tiers'] as $i => $tier) {
            CareTier::updateOrCreate(
                ['community_id' => $c->id, 'key' => strtolower(trim($tier['key']))],
                [
                    'label'       => $tier['label'],
                    'monthly'     => (int) $tier['monthly'],
                    'description' => $tier['description'] ?: null,
                    'care_levels' => $tier['care_levels'] ?? [],
                    'sort'        => $i,
                ],
            );
        }

        return back()->with('success', 'Levels of care saved.');
    }

    public function saveSettings(Request $request, int $community): RedirectResponse
    {
        $c = $this->gate($request, $community);

        $data = $request->validate([
            'community_fee'     => ['nullable', 'integer', 'min:0', 'max:200000'],
            'second_person_fee' => ['nullable', 'integer', 'min:0', 'max:20000'],
            'pet_deposit'       => ['nullable', 'integer', 'min:0', 'max:20000'],
            'legal_note'        => ['nullable', 'string', 'max:500'],
            'freshness_days'    => ['nullable', 'integer', 'min:7', 'max:180'],
            'show_confirmed_at' => ['nullable', 'boolean'],
            'add_ons'               => ['nullable', 'array', 'max:10'],
            'add_ons.*.key'         => ['required', 'string', 'max:30'],
            'add_ons.*.label'       => ['required', 'string', 'max:60'],
            'add_ons.*.monthly'     => ['required', 'integer', 'min:0', 'max:10000'],
        ]);

        CommunityMapSetting::updateOrCreate(['community_id' => $c->id], $data);

        return back()->with('success', 'Pricing details saved.');
    }

    /**
     * Publish or unpublish the map.
     *
     * Publishing is gated on the map being usable, because a half-built map on
     * a live listing costs more trust than no map. Unpublishing is always
     * allowed — an operator who wants it down gets it down immediately.
     */
    public function publish(Request $request, int $community): RedirectResponse
    {
        $c = $this->gate($request, $community);
        $publish = $request->boolean('published');

        if ($publish) {
            $units = MapUnit::where('community_id', $c->id)->count();
            if ($units === 0) {
                return back()->with('error', 'There are no suites on the map yet. Trace a floor plan first.');
            }
            if (! MapUnit::where('community_id', $c->id)->whereIn('status', MapUnit::ACTIONABLE)->exists()) {
                return back()->with('error', 'Every suite is marked occupied, so families would see a map with nothing to enquire about. Set at least one as available, coming available, or a short stay.');
            }
        }

        CommunityMapSetting::updateOrCreate(['community_id' => $c->id], ['is_published' => $publish]);

        return back()->with('success', $publish
            ? 'Your map is live on the listing.'
            : 'Your map is hidden. Families see your floor plan cards instead.');
    }

    /* ------------------------------------------------------------- helpers */

    /** Ownership, exactly as FloorPlanController does it. */
    private function own(Request $request, int $community): Community
    {
        $c = Community::findOrFail($community);
        abort_unless((int) $c->added_by === (int) $request->user()->id || $request->user()->isAdmin(), 403);

        return $c;
    }

    /** Ownership plus the tier gate, for anything that changes the map itself. */
    private function gate(Request $request, int $community): Community
    {
        $c = $this->own($request, $community);
        abort_unless(CommunityMaps::allowed($c), 403);

        return $c;
    }
}
