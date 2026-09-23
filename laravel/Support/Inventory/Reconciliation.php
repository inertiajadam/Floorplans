<?php

namespace App\Support\Inventory;

use App\Models\InventoryConnection;
use App\Models\Legacy\Community;
use App\Models\MapUnit;
use App\Models\User;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Pairing a feed's units to our suites, once, with a human confirming.
 *
 * ---------------------------------------------------------------------------
 * WHY A HUMAN
 * ---------------------------------------------------------------------------
 * Every later sync matches on `external_id`, which is stable. But the ids have
 * to get onto our records somehow, and the only information available at that
 * first moment is labels — "204" on their side, "204" on ours.
 *
 * Matching on that is exactly the bug the whole design avoids elsewhere. Suite
 * numbers get reused when a wing is renumbered; two buildings on one campus
 * both have a 204; a PMS labels beds where we have rooms. None of those throw.
 * They point a family at a room someone lives in.
 *
 * So the whole risk of the integration is concentrated into one reviewed
 * afternoon, and after that it is gone for good.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT WILL NOT DO
 * ---------------------------------------------------------------------------
 * Create suites. A feed row with no match stays unmatched and is reported. To
 * put it on the map somebody has to draw it, and geometry is the one thing no
 * PMS can supply.
 */
final class Reconciliation
{
    /** Long enough to review a screen without re-hitting the vendor on every render. */
    private const PREVIEW_TTL = 600;

    /**
     * Fetch the feed, propose pairings, and describe what needs a decision.
     *
     * @param  bool  $fresh  bypass the cached fetch (the operator's "refresh" button)
     * @return array<string, mixed>
     */
    public static function preview(Community $community, InventorySource $source, bool $fresh = false): array
    {
        $key = "inventory:preview:{$community->id}:{$source->key()}";
        if ($fresh) {
            Cache::forget($key);
        }

        /** @var FeedUnit[] $feed */
        $feed = Cache::remember($key, self::PREVIEW_TTL, static fn () => $source->fetch($community));

        $suites = MapUnit::where('community_id', $community->id)
            ->with(['level:id,name,building_id', 'level.building:id,short_name,name'])
            ->get()
            ->map(static fn (MapUnit $u) => [
                'id'       => $u->id,
                'number'   => $u->number,
                'building' => $u->level?->building?->short_name ?: $u->level?->building?->name,
                'level'    => $u->level?->name,
                /* So the screen can show what a pairing would change, and so a
                   previously linked suite comes back pre-paired. */
                'status'     => $u->status,
                'externalId' => $u->external_id,
            ])->all();

        $proposal = InventoryMatcher::propose($feed, $suites);

        /* Anything already linked from a previous reconciliation wins over a
           fresh proposal: a confirmed human decision is better evidence than
           our scoring, and re-opening the screen must not silently re-pair. */
        $existing = [];
        foreach ($suites as $s) {
            if (! empty($s['externalId'])) {
                $existing[$s['externalId']] = $s['id'];
            }
        }
        if ($existing !== []) {
            $proposal = self::applyExistingLinks($proposal, $existing, $feed, $suites);
        }

        /* A status we cannot read is not a blocker, but the operator should
           learn about it here rather than wonder why rooms never update. */
        $statusMap = method_exists($source, 'statusMap') ? $source->statusMap() : StatusMap::fromConfig();
        $vendorStatuses = [];
        foreach ($feed as $f) {
            if ($f->status === null && ($f->raw['__vendorStatus'] ?? null)) {
                $vendorStatuses[] = (string) $f->raw['__vendorStatus'];
            }
        }

        return $proposal + [
            'provider'      => $source->key(),
            'providerLabel' => $source->label(),
            'feedCount'     => count($feed),
            'suiteCount'    => count($suites),
            'unreadable'    => count(array_filter($feed, static fn (FeedUnit $f) => $f->status === null)),
            'unknownStatuses' => $statusMap->unknownAmong($vendorStatuses),
            'feed'          => array_map(static fn (FeedUnit $f) => $f->toArray(), $feed),
        ];
    }

    /**
     * Save the operator's decisions.
     *
     * @param  array<string, int|string|null>  $links  externalId => our unit id, or null to unlink
     * @return array{linked: int, unlinked: int, skipped: int}
     */
    public static function apply(Community $community, string $provider, array $links, ?User $by = null): array
    {
        $ours = MapUnit::where('community_id', $community->id)->get()->keyBy('id');

        $linked = 0;
        $unlinked = 0;
        $skipped = 0;

        /* One unit id may not take two external ids, and one external id may
           not take two units. The screen prevents both, but a hand-crafted
           request must not be able to corrupt the mapping. */
        $seenUnits = [];
        $seenExternals = [];

        DB::transaction(static function () use ($community, $provider, $links, $ours, &$linked, &$unlinked, &$skipped, &$seenUnits, &$seenExternals) {
            foreach ($links as $externalId => $unitId) {
                $externalId = trim((string) $externalId);
                if ($externalId === '' || isset($seenExternals[$externalId])) {
                    $skipped++;
                    continue;
                }
                $seenExternals[$externalId] = true;

                if ($unitId === null || $unitId === '') {
                    /* Explicitly unlinked: clear whichever suite held it. */
                    $unlinked += MapUnit::where('community_id', $community->id)
                        ->where('external_source', $provider)
                        ->where('external_id', $externalId)
                        ->update(['external_id' => null, 'external_source' => null, 'synced_at' => null]);
                    continue;
                }

                $unit = $ours->get((int) $unitId);
                if (! $unit || isset($seenUnits[$unit->id])) {
                    $skipped++;
                    continue;
                }
                $seenUnits[$unit->id] = true;

                /* Free the id from any other suite first — an operator moving a
                   pairing must not hit the unique index. */
                MapUnit::where('community_id', $community->id)
                    ->where('external_source', $provider)
                    ->where('external_id', $externalId)
                    ->where('id', '!=', $unit->id)
                    ->update(['external_id' => null, 'external_source' => null]);

                $unit->forceFill([
                    'external_id'     => $externalId,
                    'external_source' => $provider,
                ])->save();
                $linked++;
            }

            /* Suites the operator left out of the submission keep whatever they
               had. Silently unlinking everything not mentioned would make a
               partial save destructive. */
        });

        $count = MapUnit::where('community_id', $community->id)
            ->where('external_source', $provider)
            ->whereNotNull('external_id')
            ->count();

        InventoryConnection::updateOrCreate(
            ['community_id' => $community->id, 'provider' => $provider],
            [
                'reconciled_at' => now(),
                'reconciled_by' => $by?->id,
                'linked_units'  => $count,
            ],
        );

        Cache::forget("inventory:preview:{$community->id}:{$provider}");

        return ['linked' => $linked, 'unlinked' => $unlinked, 'skipped' => $skipped];
    }

    /**
     * Existing confirmed links override fresh proposals.
     *
     * A human decision made last month is better evidence than today's score,
     * and an operator re-opening the screen to fix one room must not find the
     * other ninety silently re-paired underneath them.
     */
    private static function applyExistingLinks(array $proposal, array $existing, array $feed, array $suites): array
    {
        $feedById = [];
        foreach ($feed as $f) {
            $feedById[$f->externalId] = $f;
        }
        $suiteById = [];
        foreach ($suites as $s) {
            $suiteById[$s['id']] = $s;
        }

        $pairs = [];
        $claimedFeed = [];
        $claimedSuites = [];

        foreach ($existing as $externalId => $unitId) {
            if (! isset($feedById[$externalId], $suiteById[$unitId])) {
                continue;   // the feed dropped it, or the suite was deleted
            }
            $f = $feedById[$externalId];
            $s = $suiteById[$unitId];
            $pairs[] = [
                'externalId'   => $externalId,
                'feedLabel'    => $f->label,
                'feedBuilding' => $f->building,
                'unitId'       => $unitId,
                'unitNumber'   => $s['number'],
                'unitBuilding' => $s['building'],
                'unitLevel'    => $s['level'],
                'score'        => 1.0,
                'confidence'   => 'confirmed',
                'ambiguous'    => false,
                'reason'       => 'You matched these previously',
            ];
            $claimedFeed[$externalId] = true;
            $claimedSuites[$unitId] = true;
        }

        foreach ($proposal['pairs'] as $p) {
            if (isset($claimedFeed[$p['externalId']]) || isset($claimedSuites[$p['unitId']])) {
                continue;
            }
            $pairs[] = $p;
            $claimedFeed[$p['externalId']] = true;
            $claimedSuites[$p['unitId']] = true;
        }

        $unmatchedFeed = array_values(array_filter(
            $proposal['unmatchedFeed'],
            static fn ($u) => ! isset($claimedFeed[$u['externalId']]),
        ));
        $unmatchedSuites = array_values(array_filter(
            $proposal['unmatchedSuites'],
            static fn ($u) => ! isset($claimedSuites[$u['unitId']]),
        ));

        usort($pairs, static fn ($a, $b) => strnatcasecmp((string) $a['unitNumber'], (string) $b['unitNumber']));

        return [
            'pairs'           => $pairs,
            'unmatchedFeed'   => $unmatchedFeed,
            'unmatchedSuites' => $unmatchedSuites,
            'counts' => [
                'high'      => count(array_filter($pairs, static fn ($p) => $p['confidence'] === 'high')),
                'medium'    => count(array_filter($pairs, static fn ($p) => $p['confidence'] === 'medium')),
                'low'       => count(array_filter($pairs, static fn ($p) => $p['confidence'] === 'low')),
                'confirmed' => count(array_filter($pairs, static fn ($p) => $p['confidence'] === 'confirmed')),
                'unmatchedFeed'   => count($unmatchedFeed),
                'unmatchedSuites' => count($unmatchedSuites),
            ],
        ];
    }
}
