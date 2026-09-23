<?php

namespace App\Support;

use App\Models\CommunityMapSetting;
use App\Models\Legacy\Community;
use App\Models\MapUnit;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

/**
 * Keeping availability true.
 *
 * Every write to a suite's availability goes through here — the operator
 * panel, a bulk action, and later a PMS feed. One door, so the freshness
 * stamp, the field-ownership rules and the audit trail cannot be bypassed by
 * whichever caller was written last.
 *
 * ---------------------------------------------------------------------------
 * THE PROBLEM THIS CLASS EXISTS TO SOLVE
 * ---------------------------------------------------------------------------
 * A map showing a suite that was let last week is worse than no map. It takes
 * a tool that builds trust and makes it destroy trust, and the family only
 * finds out after they have rung up and been told.
 *
 * `updated_at` cannot tell you whether availability is still true, because it
 * moves when anyone edits anything. So availability carries its own stamp,
 * moved only when someone asserts the availability is still correct. From that
 * one column comes the staleness nudge in the panel, the ordering of the
 * roster, and the "confirmed 2 days ago" line families see.
 *
 * The most common truth about a rent roll is "nothing changed since last
 * week". `confirmAll()` makes saying that a single click, because a workflow
 * that demands a form per suite to say nothing happened is a workflow nobody
 * completes.
 */
class MapInventory
{
    /* ---------------------------------------------------------------- fields */

    /**
     * Fields an inventory feed is allowed to write.
     *
     * A PMS knows occupancy, move-out dates and rent. It does not know the
     * polygon a suite occupies, whether the shower is roll-in, or which way
     * the window faces — that is operator-curated and expensive to recreate.
     * So a sync is a partial update of these four fields and nothing else,
     * regardless of what else the feed happens to carry.
     */
    public const FEED_OWNED = ['status', 'available_on', 'base_rate', 'waitlist_count'];

    /**
     * Fields that are always the operator's, whatever a feed says. Listed
     * explicitly rather than implied by omission so the rule is greppable and
     * so adding a column does not silently hand it to a feed.
     */
    public const OPERATOR_OWNED = [
        'shape', 'number', 'floor_plan_id', 'level_id',
        'accessible', 'view', 'features', 'notes', 'sqft', 'care_levels', 'sort',
    ];

    /** Fields the operator may pin against a feed. */
    public const LOCKABLE = self::FEED_OWNED;

    /* ------------------------------------------------------------ freshness */

    public static function freshnessDays(Community $c): int
    {
        return (int) (CommunityMaps::settings($c)?->freshness_days ?: 30);
    }

    /** A suite is stale when nobody has vouched for it inside the window. */
    public static function isStale(MapUnit $unit, int $days): bool
    {
        if (! $unit->availability_confirmed_at) {
            return true;
        }

        return $unit->availability_confirmed_at->lt(now()->subDays($days));
    }

    /**
     * The panel's headline. `stale` deliberately counts only suites a family
     * could act on — nobody needs nagging about an occupied room that has been
     * occupied for three years.
     *
     * @return array{total:int, actionable:int, stale:int, days:int, oldest:?string, confirmedAt:?string}
     */
    public static function freshness(Community $c): array
    {
        $days = self::freshnessDays($c);
        $units = MapUnit::where('community_id', $c->id)->get(['status', 'availability_confirmed_at']);
        $actionable = $units->filter->isActionable();

        return [
            'total'       => $units->count(),
            'actionable'  => $actionable->count(),
            'stale'       => $actionable->filter(static fn (MapUnit $u) => self::isStale($u, $days))->count(),
            'days'        => $days,
            'oldest'      => $actionable->min('availability_confirmed_at')?->toIso8601String(),
            /* The most recent confirmation across the community — what the
               public "confirmed N days ago" line reads from. */
            'confirmedAt' => $units->max('availability_confirmed_at')?->toIso8601String(),
        ];
    }

    /**
     * "Everything here is still right."
     *
     * The single most important affordance in the panel: it makes the common
     * case — nothing changed — a one-click job. Touches only the stamp, never
     * the availability itself, so it can never accidentally publish a change.
     *
     * @return int how many suites were confirmed
     */
    public static function confirmAll(Community $c, ?User $by = null, ?array $unitIds = null): int
    {
        $query = MapUnit::where('community_id', $c->id);
        if ($unitIds !== null) {
            $query->whereIn('id', $unitIds);
        }

        return $query->update([
            'availability_confirmed_at' => now(),
            'availability_confirmed_by' => $by?->id,
            'updated_at'                => now(),
        ]);
    }

    /* -------------------------------------------------------------- writing */

    /**
     * Update one suite's availability from the operator panel.
     *
     * Any touch counts as a confirmation: someone has just looked at this
     * suite and told us what is true, which is exactly what the stamp means.
     * Fields absent from `$changes` are left alone.
     *
     * @param  array<string, mixed>  $changes
     */
    public static function update(MapUnit $unit, array $changes, ?User $by = null): MapUnit
    {
        $allowed = array_merge(self::FEED_OWNED, ['respite_nightly_rate', 'accessible', 'view', 'sqft', 'floor_plan_id', 'care_levels', 'features', 'notes', 'number']);
        $clean = array_intersect_key($changes, array_flip($allowed));

        /* Statuses carry their own satellite data. Clearing it on a status
           change stops a suite reading "Occupied · 3 families waiting" because
           it used to be a waitlist and nobody cleared the count. */
        if (array_key_exists('status', $clean)) {
            if ($clean['status'] !== MapUnit::COMING_AVAILABLE) {
                $clean['available_on'] = null;
            }
            if ($clean['status'] !== MapUnit::WAITLIST) {
                $clean['waitlist_count'] = null;
            }
            if ($clean['status'] !== MapUnit::RESPITE) {
                $clean['respite_nightly_rate'] = null;
            }
        }

        $unit->fill($clean);
        $unit->availability_confirmed_at = now();
        $unit->availability_confirmed_by = $by?->id;
        $unit->save();

        return $unit;
    }

    /**
     * Set one status across many suites — "these six are all occupied now".
     *
     * @param  int[]  $unitIds
     * @return int how many were changed
     */
    public static function bulkStatus(Community $c, array $unitIds, string $status, ?User $by = null): int
    {
        if (! in_array($status, MapUnit::STATUSES, true) || ! $unitIds) {
            return 0;
        }

        $payload = [
            'status'                    => $status,
            'availability_confirmed_at' => now(),
            'availability_confirmed_by' => $by?->id,
            'updated_at'                => now(),
        ];

        /* Same reasoning as update(): satellite data belongs to the status that
           owns it. One status applies to the whole batch, so the decision is
           made once here rather than per row in SQL. */
        if ($status !== MapUnit::COMING_AVAILABLE) $payload['available_on'] = null;
        if ($status !== MapUnit::WAITLIST)         $payload['waitlist_count'] = null;
        if ($status !== MapUnit::RESPITE)          $payload['respite_nightly_rate'] = null;

        return MapUnit::where('community_id', $c->id)
            ->whereIn('id', $unitIds)
            ->update($payload);
    }

    /* ------------------------------------------------------------ the seam */

    /**
     * Apply an inventory feed.
     *
     * This is the seam the PMS adapter plugs into. No adapter exists yet — the
     * integration should be built against a real customer's feed rather than a
     * guess at one — but the CONTRACT lives here so the later work is a
     * translation job rather than a redesign.
     *
     * An adapter's only responsibility is to produce rows of:
     *
     *     ['external_id' => 'PCC-204', 'status' => 'available',
     *      'available_on' => '2026-11-15', 'base_rate' => 4950]
     *
     * Everything below — matching, field ownership, operator locks, the audit
     * stamp — is the same regardless of which system the rows came from, and
     * so belongs here rather than in each adapter.
     *
     * Rules, in order:
     *   1. Match on external_id, never on suite number. Numbers get reused
     *      when a wing is renumbered; a mismatch there silently marks the
     *      wrong room vacant.
     *   2. Write only FEED_OWNED fields. The feed does not know the rest.
     *   3. Skip any field the operator has pinned in locked_fields.
     *   4. Never create or delete suites. A row with no match is reported, not
     *      guessed at — creating one would need geometry the feed cannot
     *      supply, and deleting one would destroy operator work over what is
     *      usually a feed glitch.
     *
     * @param  array<int, array<string, mixed>>  $rows
     * @return array{matched:int, updated:int, skipped:int, unmatched:array<int, string>, locked:int}
     */
    public static function applyFeed(Community $c, array $rows, string $source): array
    {
        $units = MapUnit::where('community_id', $c->id)
            ->where('external_source', $source)
            ->whereNotNull('external_id')
            ->get()
            ->keyBy('external_id');

        $matched = 0;
        $updated = 0;
        $skipped = 0;
        $lockedHits = 0;
        $unmatched = [];

        foreach ($rows as $row) {
            $key = (string) ($row['external_id'] ?? '');
            if ($key === '') {
                $skipped++;
                continue;
            }

            $unit = $units->get($key);
            if (! $unit) {
                $unmatched[] = $key;
                continue;
            }

            $matched++;
            $locked = (array) ($unit->locked_fields ?? []);
            $changes = [];

            foreach (self::FEED_OWNED as $field) {
                if (! array_key_exists($field, $row)) {
                    continue;
                }
                if (in_array($field, $locked, true)) {
                    $lockedHits++;
                    continue;
                }
                $changes[$field] = $row[$field];
            }

            if (! $changes) {
                /* Nothing to write, but the feed still vouches for this suite
                   being current — that is exactly what the stamp records. */
                $unit->forceFill(['availability_confirmed_at' => now(), 'synced_at' => now()])->save();
                continue;
            }

            if (array_key_exists('status', $changes) && ! in_array($changes['status'], MapUnit::STATUSES, true)) {
                unset($changes['status']);
            }

            $unit->fill($changes);
            $unit->availability_confirmed_at = now();
            $unit->synced_at = now();
            $unit->save();
            $updated++;
        }

        CommunityMapSetting::updateOrCreate(
            ['community_id' => $c->id],
            [
                'last_sync_at'      => now(),
                'last_sync_status'  => $unmatched ? 'partial' : 'ok',
                'last_sync_message' => $unmatched
                    ? count($unmatched) . ' row(s) had no matching suite: ' . implode(', ', array_slice($unmatched, 0, 5))
                    : "Updated {$updated} of {$matched} matched suites.",
            ],
        );

        return compact('matched', 'updated', 'skipped', 'unmatched') + ['locked' => $lockedHits];
    }

    /* --------------------------------------------------------------- panel */

    /**
     * The roster the operator panel renders.
     *
     * Ordered by what needs attention rather than by suite number: stale
     * first, then the suites a family could act on, then everything else.
     * Someone opening this on a Monday morning should see their work at the
     * top, not have to hunt for it down a list of occupied rooms.
     *
     * @return array<int, array<string, mixed>>
     */
    public static function roster(Community $c): array
    {
        $days = self::freshnessDays($c);
        $showPrice = (bool) ($c->pricing_public ?? true);

        return MapUnit::where('community_id', $c->id)
            ->with(['floorPlan:id,name,room_type,sqft', 'level:id,name,building_id', 'level.building:id,short_name,name'])
            ->get()
            ->map(static function (MapUnit $u) use ($days, $showPrice) {
                $stale = self::isStale($u, $days);

                return [
                    'id'           => $u->id,
                    'number'       => $u->number,
                    'status'       => $u->status,
                    'availableOn'  => $u->available_on?->toDateString(),
                    'waitlistCount' => $u->waitlist_count,
                    'respiteRate'  => $u->respite_nightly_rate,
                    'baseRate'     => $showPrice ? $u->rate() : null,
                    'ownRate'      => $u->base_rate,          // null means "inheriting the layout's price"
                    'sqft'         => $u->size(),
                    'accessible'   => (bool) $u->accessible,
                    'view'         => $u->view,
                    'careLevels'   => $u->care_levels ?? [],
                    'layoutId'     => $u->floor_plan_id,
                    'layoutName'   => $u->floorPlan?->name,
                    'building'     => $u->level?->building?->short_name ?: $u->level?->building?->name,
                    'level'        => $u->level?->name,
                    'levelId'      => $u->level_id,
                    'confirmedAt'  => $u->availability_confirmed_at?->toIso8601String(),
                    'stale'        => $stale,
                    'actionable'   => $u->isActionable(),
                    'lockedFields' => (array) ($u->locked_fields ?? []),
                    'externalId'   => $u->external_id,
                    'syncedAt'     => $u->synced_at?->toIso8601String(),
                ];
            })
            ->sortBy([
                /* Stale and actionable first — that is the work. */
                static fn ($a, $b) => ($b['stale'] && $b['actionable'] ? 1 : 0) <=> ($a['stale'] && $a['actionable'] ? 1 : 0),
                static fn ($a, $b) => ($b['actionable'] ? 1 : 0) <=> ($a['actionable'] ? 1 : 0),
                static fn ($a, $b) => strnatcasecmp($a['number'], $b['number']),
            ])
            ->values()
            ->all();
    }

    /** Human freshness, shared by the panel and the public listing. */
    public static function describeAge(?Carbon $at): ?string
    {
        if (! $at) {
            return null;
        }
        $days = (int) $at->startOfDay()->diffInDays(now()->startOfDay());

        return match (true) {
            $days <= 0 => 'today',
            $days === 1 => 'yesterday',
            $days < 14 => "{$days} days ago",
            $days < 60 => round($days / 7) . ' weeks ago',
            default => round($days / 30) . ' months ago',
        };
    }

    /** Toggle an operator lock on one field, so a later feed cannot overwrite it. */
    public static function toggleLock(MapUnit $unit, string $field): array
    {
        if (! in_array($field, self::LOCKABLE, true)) {
            return (array) ($unit->locked_fields ?? []);
        }

        $locked = (array) ($unit->locked_fields ?? []);
        $locked = in_array($field, $locked, true)
            ? array_values(array_diff($locked, [$field]))
            : [...$locked, $field];

        $unit->forceFill(['locked_fields' => $locked])->save();

        return $locked;
    }
}
