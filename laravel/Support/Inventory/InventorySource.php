<?php

namespace App\Support\Inventory;

use App\Models\Legacy\Community;

/**
 * An inventory feed.
 *
 * Implementations own exactly one thing: talking to a specific vendor's API
 * and translating what comes back into FeedUnit objects. Everything else —
 * matching, field ownership, operator locks, the freshness stamp, the sync
 * status record — lives in MapInventory and InventoryMatcher, identically for
 * every provider, which is why it does not belong here.
 *
 * Writing a second adapter should touch nothing outside its own directory.
 *
 * Adapters MUST NOT:
 *   - write to the database (applyFeed does that, under its own rules)
 *   - decide what to do about unmatched units (the operator does)
 *   - guess a status their API cannot express (return null instead)
 */
interface InventorySource
{
    /** Short stable key stored on units as `external_source`, e.g. 'pointclickcare'. */
    public function key(): string;

    /** Shown to operators. */
    public function label(): string;

    /**
     * Every unit the source knows about for this community.
     *
     * Used for both reconciliation (pairing up front) and the nightly sync,
     * because they need the same data and a second code path is a second
     * thing to get wrong.
     *
     * @return FeedUnit[]
     * @throws InventorySourceException on auth failure, transport failure or an unusable response
     */
    public function fetch(Community $community): array;

    /**
     * Can we reach the source with the stored credentials?
     *
     * Separate from fetch() so the operator gets a fast, safe "test connection"
     * that cannot change anything.
     *
     * @return array{ok: bool, message: string, units?: int}
     */
    public function test(Community $community): array;
}
