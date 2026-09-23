<?php

namespace App\Support\Inventory\PointClickCare;

use App\Support\Inventory\FeedUnit;
use App\Support\Inventory\StatusMap;

/**
 * Turning PointClickCare's bed records into FeedUnit objects.
 *
 * ---------------------------------------------------------------------------
 * READ THIS BEFORE GOING LIVE
 * ---------------------------------------------------------------------------
 * developer.pointclickcare.com is unreachable from the environment this was
 * written in, so the FIELD NAMES in config/inventory.php are informed guesses
 * at PointClickCare's schema, not transcriptions of their documentation.
 *
 * That is why none of them are hard-coded here. This class reads a field map
 * and walks dot-paths; correcting it against the real API is editing a config
 * array, not rewriting logic. `describe()` dumps what it found against a
 * sample response so you can check the mapping in one pass rather than
 * discovering it a room at a time.
 *
 * The class is pure — no HTTP, no container — so it is unit-tested against
 * fixtures in tests/php/. The untestable surface is PointClickCareClient
 * alone, and it makes no decisions.
 *
 * ---------------------------------------------------------------------------
 * BEDS VERSUS SUITES
 * ---------------------------------------------------------------------------
 * A PMS tracks BEDS because it bills per resident. We map SUITES because a
 * family rents a room. In a semi-private room those are not the same thing:
 * PCC has "204-A" and "204-B" where we have one "204".
 *
 * `collapseBeds` handles that. When several feed rows map to one suite, the
 * suite is free only if EVERY bed is free — a room with one empty bed is not
 * a room you can move a parent into. Getting this backwards would advertise
 * half-occupied shared rooms as available, which is the single worst error
 * this integration could make.
 */
final class PointClickCareMapper
{
    public function __construct(
        private readonly array $fields,
        private readonly StatusMap $statusMap,
    ) {
    }

    /**
     * @param  array<int, array<string, mixed>>  $rows decoded records from the API
     * @return FeedUnit[]
     */
    public function map(array $rows): array
    {
        $units = [];

        foreach ($rows as $row) {
            $externalId = self::str(self::pick($row, $this->fields['external_id'] ?? 'bedId'));
            if ($externalId === null) {
                continue;   // no stable key means we could never match it safely
            }

            $label = self::str(self::pick($row, $this->fields['label'] ?? ['bedName', 'roomName']))
                ?? $externalId;

            $vendorStatus = self::str(self::pick($row, $this->fields['status'] ?? 'bedStatus'));

            $units[] = new FeedUnit(
                externalId: $externalId,
                label: $label,
                status: $this->statusMap->translate($vendorStatus),
                availableOn: self::date(self::pick($row, $this->fields['available_on'] ?? 'availableDate')),
                baseRate: self::money(self::pick($row, $this->fields['base_rate'] ?? null)),
                building: self::str(self::pick($row, $this->fields['building'] ?? ['unitName', 'unitDescription'])),
                floor: self::str(self::pick($row, $this->fields['floor'] ?? 'floorName')),
                raw: $row,
            );
        }

        return $units;
    }

    /**
     * Collapse bed-level rows into suite-level ones.
     *
     * Rows are grouped by the room key (config `fields.room_key`); when that
     * is absent the label's digits are used, so "204-A" and "204-B" still
     * group as "204".
     *
     * A grouped suite is free only if every bed in it is free. Anything else
     * would advertise a shared room with one occupied bed as available.
     *
     * @param  FeedUnit[]  $units
     * @return FeedUnit[]
     */
    public function collapseBeds(array $units): array
    {
        $roomKey = $this->fields['room_key'] ?? null;
        $groups = [];

        foreach ($units as $u) {
            $key = $roomKey ? self::str(self::pick($u->raw, $roomKey)) : null;
            $key ??= self::digits($u->label) ?: $u->externalId;
            $groups[$key][] = $u;
        }

        $out = [];
        foreach ($groups as $key => $beds) {
            if (count($beds) === 1) {
                $out[] = $beds[0];
                continue;
            }

            /* Worst case wins. `null` (feed cannot say) is treated as unknown
               and suppresses the whole group's status rather than being
               ignored — a suite we are unsure about must not be advertised. */
            $statuses = array_map(static fn (FeedUnit $b) => $b->status, $beds);
            $status = self::worstStatus($statuses);

            /* Only meaningful when the whole room is coming free; the latest
               date is when that actually happens. */
            $dates = array_filter(array_map(static fn (FeedUnit $b) => $b->availableOn, $beds));
            $availableOn = $status === 'coming_available' && $dates ? max($dates) : null;

            $rates = array_filter(array_map(static fn (FeedUnit $b) => $b->baseRate, $beds), static fn ($r) => $r !== null);

            $first = $beds[0];
            $out[] = new FeedUnit(
                /* The room, not a bed. Reconciliation pairs this against our
                   suite, and it must stay stable as beds come and go. */
                externalId: $roomKey ? (string) $key : $first->externalId,
                label: self::sharedLabel($beds, (string) $key),
                status: $status,
                availableOn: $availableOn,
                baseRate: $rates ? max($rates) : null,
                building: $first->building,
                floor: $first->floor,
                raw: ['beds' => array_map(static fn (FeedUnit $b) => $b->raw, $beds)],
            );
        }

        return $out;
    }

    /**
     * The least-free status in a group.
     *
     * Order matters and is the safety property: unknown beats occupied beats
     * held beats coming-available beats available. A room is only as free as
     * its least free bed.
     *
     * @param  array<int, string|null>  $statuses
     */
    private static function worstStatus(array $statuses): ?string
    {
        if (in_array(null, $statuses, true)) {
            return null;                       // unsure about one bed = unsure about the room
        }

        foreach (['occupied', 'held', 'coming_available', 'available'] as $rank) {
            if (in_array($rank, $statuses, true)) {
                return $rank;
            }
        }

        return null;
    }

    /** "204-A" + "204-B" -> "204 (2 beds)". */
    private static function sharedLabel(array $beds, string $key): string
    {
        $digits = self::digits($beds[0]->label) ?: $key;

        return $digits . ' (' . count($beds) . ' beds)';
    }

    /**
     * What the mapper found, for checking a field map against a real response
     * without writing anything. Surfaced by the connection test.
     *
     * @param  array<int, array<string, mixed>>  $rows
     * @return array<string, mixed>
     */
    public function describe(array $rows): array
    {
        $sample = $rows[0] ?? [];
        $mapped = $this->map(array_slice($rows, 0, 5));

        $vendorStatuses = [];
        foreach ($rows as $row) {
            $s = self::str(self::pick($row, $this->fields['status'] ?? 'bedStatus'));
            if ($s !== null) {
                $vendorStatuses[] = $s;
            }
        }

        return [
            'rows'            => count($rows),
            'availableKeys'   => array_keys($sample),
            'mappedSample'    => array_map(static fn (FeedUnit $u) => $u->toArray(), $mapped),
            'vendorStatuses'  => array_values(array_unique($vendorStatuses)),
            'unknownStatuses' => $this->statusMap->unknownAmong($vendorStatuses),
            'missingIds'      => count($rows) - count($this->map($rows)),
        ];
    }

    /* ---------------------------------------------------------------- helpers */

    /**
     * Read a value by dot-path, or the first non-empty of several paths.
     * Tolerates a missing path rather than throwing: a field map that is
     * slightly wrong should degrade to null, not take the sync down.
     */
    private static function pick(array $row, string|array|null $path): mixed
    {
        if ($path === null) {
            return null;
        }

        foreach ((array) $path as $candidate) {
            $value = $row;
            foreach (explode('.', (string) $candidate) as $segment) {
                if (! is_array($value) || ! array_key_exists($segment, $value)) {
                    $value = null;
                    break;
                }
                $value = $value[$segment];
            }
            if ($value !== null && $value !== '') {
                return $value;
            }
        }

        return null;
    }

    private static function str(mixed $v): ?string
    {
        if ($v === null || is_array($v)) {
            return null;
        }
        $s = trim((string) $v);

        return $s === '' ? null : $s;
    }

    /** Accepts Y-m-d, ISO 8601 and common US formats; returns Y-m-d or null. */
    private static function date(mixed $v): ?string
    {
        $s = self::str($v);
        if ($s === null) {
            return null;
        }
        $ts = strtotime($s);

        return $ts === false ? null : date('Y-m-d', $ts);
    }

    /** "4,950.00" or 4950.0 to 4950. Rates are whole currency units for us. */
    private static function money(mixed $v): ?int
    {
        if ($v === null || $v === '') {
            return null;
        }
        if (is_numeric($v)) {
            return (int) round((float) $v);
        }
        $clean = preg_replace('/[^0-9.\-]/', '', (string) $v);

        return ($clean === '' || ! is_numeric($clean)) ? null : (int) round((float) $clean);
    }

    private static function digits(string $v): string
    {
        preg_match_all('/\d+/', $v, $m);
        if (! $m[0]) {
            return '';
        }
        usort($m[0], static fn ($a, $b) => strlen($b) <=> strlen($a));

        return $m[0][0];
    }
}
