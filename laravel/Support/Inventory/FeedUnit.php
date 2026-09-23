<?php

namespace App\Support\Inventory;

/**
 * One unit as an inventory system describes it.
 *
 * The boundary between "someone else's data model" and ours. Every adapter
 * translates into this shape, and nothing downstream — the matcher, the
 * reconciliation screen, MapInventory::applyFeed — knows which system a row
 * came from.
 *
 * Deliberately small. A PMS record carries dozens of fields; all we want are
 * the four a feed is allowed to own (see MapInventory::FEED_OWNED), plus
 * enough context for a human to recognise the unit during reconciliation.
 *
 * `status` is nullable on purpose, and it is the most important nullable in
 * the codebase. Null means "this feed cannot tell us the availability of this
 * unit" — not "it is occupied". A feed with no concept of a waitlist must
 * leave a waitlisted suite alone rather than flatten it, or the sync destroys
 * exactly the states that make this map better than a multifamily one.
 * See StatusMap.
 */
final class FeedUnit
{
    /**
     * @param string      $externalId   stable id in the source system — the matching key
     * @param string      $label        what a human would call it, e.g. "204" or "Magnolia 204-A"
     * @param string|null $status       our vocabulary, or null for "leave this suite alone"
     * @param string|null $availableOn  Y-m-d, when known
     * @param int|null    $baseRate     monthly, in whole currency units
     * @param string|null $building     context for reconciliation, never written to our records
     * @param string|null $floor        same
     * @param array       $raw          the untouched source record, for debugging a bad mapping
     */
    public function __construct(
        public readonly string $externalId,
        public readonly string $label,
        public readonly ?string $status = null,
        public readonly ?string $availableOn = null,
        public readonly ?int $baseRate = null,
        public readonly ?string $building = null,
        public readonly ?string $floor = null,
        public readonly array $raw = [],
    ) {
    }

    /**
     * The row shape MapInventory::applyFeed() consumes.
     *
     * Fields the feed could not determine are omitted rather than sent as
     * null, because applyFeed distinguishes "absent, leave it" from "present
     * and null, clear it" by key existence.
     *
     * @return array<string, mixed>
     */
    public function toFeedRow(): array
    {
        $row = ['external_id' => $this->externalId];

        if ($this->status !== null) {
            $row['status'] = $this->status;
            /* A move-in date only means anything alongside a status that can
               carry one. Sending it with, say, "occupied" would be noise. */
            if ($this->status === 'coming_available') {
                $row['available_on'] = $this->availableOn;
            }
        }

        if ($this->baseRate !== null) {
            $row['base_rate'] = $this->baseRate;
        }

        return $row;
    }

    /** What the reconciliation screen shows so a human can recognise the unit. */
    public function toArray(): array
    {
        return [
            'externalId' => $this->externalId,
            'label'      => $this->label,
            'status'     => $this->status,
            'availableOn' => $this->availableOn,
            'baseRate'   => $this->baseRate,
            'building'   => $this->building,
            'floor'      => $this->floor,
        ];
    }
}
