<?php

namespace App\Support\Inventory\PointClickCare;

use App\Models\InventoryConnection;
use App\Models\Legacy\Community;
use App\Support\Inventory\FeedUnit;
use App\Support\Inventory\InventorySource;
use App\Support\Inventory\InventorySourceException;
use App\Support\Inventory\StatusMap;
use Throwable;

/**
 * PointClickCare as an inventory source.
 *
 * Thin by design: it wires the client to the mapper and hands FeedUnits back.
 * Both of those are the interesting parts — the client because it is the only
 * untestable surface, the mapper because it is where a wrong field name turns
 * into a wrong room on a family's screen.
 *
 * ⚠ The API shape this is written against is UNVERIFIED — see the warning at
 * the top of config/inventory.php. `test()` exists to close that gap safely:
 * it reads a small sample, reports what it found, and writes nothing.
 */
final class PointClickCareAdapter implements InventorySource
{
    public const KEY = 'pointclickcare';

    public function __construct(
        private readonly array $config,
        private readonly ?PointClickCareClient $client = null,
    ) {
    }

    public function key(): string
    {
        return self::KEY;
    }

    public function label(): string
    {
        return (string) ($this->config['label'] ?? 'PointClickCare');
    }

    /** @return FeedUnit[] */
    public function fetch(Community $community): array
    {
        $connection = $this->connection($community);
        $rows = $this->client()->units($connection->org_id, $connection->facility_id);

        $units = $this->mapper()->map($rows);

        /*
         | Collapse beds into rooms unless the operator has said their feed is
         | already room-level. A PMS bills per bed; a family rents a room, and
         | a shared room is only free when every bed in it is.
         */
        return $connection->collapse_beds ? $this->mapper()->collapseBeds($units) : $units;
    }

    /**
     * Prove the connection works, and show what we make of the response.
     *
     * Reads one small page and writes nothing, so it is safe to press
     * repeatedly while correcting a field map. The diagnostics it returns are
     * how the unverified config in this repo gets corrected against the real
     * API — see "HOW TO CORRECT IT" in config/inventory.php.
     *
     * @return array{ok: bool, message: string, units?: int, diagnostics?: array}
     */
    public function test(Community $community): array
    {
        try {
            $connection = $this->connection($community);
            $rows = $this->client()->sample($connection->org_id, $connection->facility_id);
        } catch (InventorySourceException $e) {
            return ['ok' => false, 'message' => $e->getMessage()];
        } catch (Throwable $e) {
            return ['ok' => false, 'message' => 'Something went wrong reaching your inventory system: ' . $e->getMessage()];
        }

        if ($rows === []) {
            return [
                'ok' => false,
                'message' => 'We connected, but your inventory system returned no rooms for that facility. Check the facility id.',
            ];
        }

        $diagnostics = $this->mapper()->describe($rows);

        /* Connecting is not the same as being ready. A response we cannot read
           is a failed test even though the HTTP worked, because syncing it
           would silently do nothing. */
        if ($diagnostics['mappedSample'] === []) {
            return [
                'ok'          => false,
                'message'     => 'We connected, but none of the rooms could be read with the current field settings. The keys we can see are listed below.',
                'units'       => count($rows),
                'diagnostics' => $diagnostics,
            ];
        }

        $unknown = $diagnostics['unknownStatuses'];
        $message = $unknown === []
            ? 'Connected. We can read ' . count($rows) . ' room(s) and understand every availability value.'
            : 'Connected, but we do not recognise these availability values yet: ' . implode(', ', $unknown)
              . '. Rooms with those values will be left alone until they are mapped.';

        return [
            'ok'          => true,
            'message'     => $message,
            'units'       => count($rows),
            'diagnostics' => $diagnostics,
        ];
    }

    /* ------------------------------------------------------------- internals */

    private function connection(Community $community): InventoryConnection
    {
        $connection = InventoryConnection::query()
            ->where('community_id', $community->id)
            ->where('provider', self::KEY)
            ->first();

        if (! $connection) {
            throw InventorySourceException::config('this community is not connected to PointClickCare');
        }
        if (! $connection->org_id || ! $connection->facility_id) {
            throw InventorySourceException::config('the organisation or facility id is missing');
        }

        return $connection;
    }

    private function client(): PointClickCareClient
    {
        return $this->client ?? new PointClickCareClient($this->config);
    }

    private function mapper(): PointClickCareMapper
    {
        return new PointClickCareMapper(
            $this->config['fields'] ?? [],
            StatusMap::fromConfig($this->config['status_map'] ?? []),
        );
    }

    public function statusMap(): StatusMap
    {
        return StatusMap::fromConfig($this->config['status_map'] ?? []);
    }
}
