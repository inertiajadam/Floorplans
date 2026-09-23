<?php

namespace App\Support\Inventory;

/**
 * Translating a vendor's occupancy vocabulary into ours — and knowing when
 * not to.
 *
 * ---------------------------------------------------------------------------
 * THE PROBLEM
 * ---------------------------------------------------------------------------
 * Our vocabulary has seven states. A PMS typically has three or four, because
 * it is a billing and clinical record, not a marketing surface. Three of ours
 * usually have no equivalent at all:
 *
 *   waitlist   occupied, but the community keeps a list for this layout
 *   respite    let by the week for recovery and trial stays
 *   model      shown on tours, never for sale
 *
 * To a PMS all three are simply "occupied" or "unavailable". A naive mapping
 * therefore overwrites every one of them with `occupied` on the first sync —
 * silently destroying exactly the states that make this map better than a
 * multifamily one, and doing it to the suites an operator took the most care
 * over.
 *
 * ---------------------------------------------------------------------------
 * THE RULE
 * ---------------------------------------------------------------------------
 * A feed may always move a suite INTO a state it can express. It may never
 * move a suite OUT of a state it cannot express, EXCEPT to say the suite has
 * become free — which is unambiguous, useful, and the whole point of syncing.
 *
 *   currently `waitlist`, feed says `occupied`   → leave alone
 *       (the PMS saying "occupied" is true of a waitlisted suite; it tells
 *        us nothing we did not know)
 *
 *   currently `waitlist`, feed says `available`  → apply
 *       (it freed up; that is real news and the operator wants it)
 *
 * A suite genuinely moving from respite to long-term occupancy still needs a
 * human to say so. That is the right trade: losing an operator's curation
 * silently is far worse than asking them to update one row.
 */
final class StatusMap
{
    /** Our states a typical PMS has no vocabulary for. */
    public const OPERATOR_ONLY = ['waitlist', 'respite', 'model'];

    /** Feed statuses meaningful enough to override an operator-only state. */
    public const FREEING = ['available', 'coming_available'];

    /**
     * @param array<string, string|null> $map normalised vendor status => our status, or null for "cannot tell"
     */
    public function __construct(private readonly array $map)
    {
    }

    /**
     * Default mapping for PointClickCare-shaped bed statuses.
     *
     * ⚠ UNVERIFIED. developer.pointclickcare.com is unreachable from this
     * environment, so these keys are informed guesses at the vendor's
     * vocabulary, not transcriptions of their documentation. Check them
     * against a real response before going live — `config/inventory.php`
     * overrides this without touching code, and an unrecognised key is
     * treated as "cannot tell" rather than guessed at, so a wrong key here
     * fails safe (nothing is written) instead of failing loud.
     *
     * @return array<string, string|null>
     */
    public static function defaults(): array
    {
        return [
            // free now
            'available'        => 'available',
            'vacant'           => 'available',
            'open'             => 'available',
            'ready'            => 'available',
            'vacant_ready'     => 'available',

            // free soon
            'notice'           => 'coming_available',
            'notice_given'     => 'coming_available',
            'pending_discharge' => 'coming_available',
            'vacant_not_ready' => 'coming_available',
            'turn'             => 'coming_available',
            'in_turn'          => 'coming_available',

            // taken
            'occupied'         => 'occupied',
            'in_use'           => 'occupied',
            'admitted'         => 'occupied',

            // spoken for
            'reserved'         => 'held',
            'hold'             => 'held',
            'on_hold'          => 'held',
            'deposit'          => 'held',

            /* Out of service is NOT occupied — a room being renovated is not a
               room someone lives in. We have no state for it, and guessing
               would put a builder's skip on the family-facing map. Leave it. */
            'out_of_service'   => null,
            'oos'              => null,
            'maintenance'      => null,
            'closed'           => null,
        ];
    }

    public static function fromConfig(?array $overrides = null): self
    {
        return new self(array_merge(self::defaults(), $overrides ?? []));
    }

    /**
     * Vendor string to our vocabulary, or null when this feed cannot say.
     *
     * Normalises case, spaces, hyphens and underscores so "Vacant Ready",
     * "vacant-ready" and "VACANT_READY" are one key.
     */
    public function translate(?string $vendorStatus): ?string
    {
        if ($vendorStatus === null) {
            return null;
        }

        $key = strtolower(trim($vendorStatus));
        $key = preg_replace('/[\s\-]+/', '_', $key) ?? '';
        $key = preg_replace('/[^a-z0-9_]/', '', $key) ?? '';

        return $this->map[$key] ?? null;
    }

    /**
     * The leave-alone rule, applied to an already-translated status.
     *
     * This is the decision the whole class exists for; `translate()` is just
     * lookup. Split out because the two happen at different moments: an
     * adapter translates while it reads the feed, but only the database knows
     * what the suite currently is, so guarding happens at write time inside
     * MapInventory::applyFeed().
     *
     * Null means leave the suite alone.
     */
    public function guard(?string $incoming, ?string $currentStatus): ?string
    {
        if ($incoming === null) {
            return null;                       // feed cannot say; not our business to guess
        }

        if ($currentStatus !== null && in_array($currentStatus, self::OPERATOR_ONLY, true)) {
            /* Only news of the suite becoming free is worth overriding an
               operator-curated state. Anything else the feed "knows" about a
               waitlisted or respite suite, it already agrees with. */
            return in_array($incoming, self::FREEING, true) ? $incoming : null;
        }

        return $incoming;
    }

    /**
     * Vendor status plus current status to the value we should write.
     * Convenience for callers holding both; equivalent to guard(translate()).
     */
    public function resolve(?string $vendorStatus, ?string $currentStatus): ?string
    {
        return $this->guard($this->translate($vendorStatus), $currentStatus);
    }

    /** Vendor statuses we recognise, for the connection-test diagnostics. */
    public function knownKeys(): array
    {
        return array_keys($this->map);
    }

    /**
     * Vendor statuses seen in a response that we have no mapping for.
     * Surfaced during reconciliation so an operator finds out before a sync
     * quietly ignores half their rooms.
     *
     * @param  string[]  $seen
     * @return string[]
     */
    public function unknownAmong(array $seen): array
    {
        $unknown = [];
        foreach (array_unique(array_filter($seen)) as $status) {
            $key = strtolower(trim((string) $status));
            $key = preg_replace('/[\s\-]+/', '_', $key) ?? '';
            $key = preg_replace('/[^a-z0-9_]/', '', $key) ?? '';
            if (! array_key_exists($key, $this->map)) {
                $unknown[] = (string) $status;
            }
        }

        return $unknown;
    }
}
