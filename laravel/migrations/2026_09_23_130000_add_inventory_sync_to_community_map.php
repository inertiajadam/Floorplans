<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 | Freshness, and the groundwork for hands-off inventory sync.
 |
 | Split from the first migration so it can land on an existing map without
 | touching the tables that hold geometry.
 |
 | ---------------------------------------------------------------------------
 | WHY THESE COLUMNS EXIST BEFORE THE INTEGRATION DOES
 | ---------------------------------------------------------------------------
 | A PMS (PointClickCare, Yardi Senior Living, RealPage, Aline) knows occupancy,
 | move-out dates and rent. It does NOT know the polygon a suite occupies on a
 | floor plan, whether the shower is roll-in, or which way the window faces.
 | So a sync can never be "replace the unit row" — it is a partial update of
 | three or four fields onto a record whose other fields are operator-curated
 | and expensive to recreate.
 |
 | That means the model needs to answer "who owns this field?" BEFORE the first
 | sync runs. Retrofitting it afterwards means either discarding operator work
 | or reconciling by hand. These columns are cheap now and load-bearing later:
 |
 |   external_id       the unit's identifier in the source system, so a sync
 |                     matches on a stable key rather than on suite number
 |                     (numbers get reused when a wing is renumbered)
 |   external_source   which system it came from, so two feeds cannot fight
 |   synced_at         when the feed last touched this row
 |   locked_fields     fields the operator has pinned; a sync skips them
 |
 | See docs/PMS-SYNC.md for the full field-ownership table and conflict rules.
 |
 | ---------------------------------------------------------------------------
 | WHY FRESHNESS IS TRACKED SEPARATELY FROM updated_at
 | ---------------------------------------------------------------------------
 | A map showing a suite that was let last week is worse than no map: it turns
 | a trust-building tool into the opposite. `updated_at` cannot answer "is this
 | still true" because it moves when anyone edits anything — a typo fix in the
 | description would make a year-old vacancy look freshly checked.
 |
 | `availability_confirmed_at` moves only when a human (or a feed) asserts the
 | availability is still correct. That is what powers the staleness nudge in
 | the operator panel and the "confirmed 2 days ago" line families see.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('community_map_units', function (Blueprint $table) {
            // Freshness: set when someone asserts this suite's availability is still right.
            $table->timestamp('availability_confirmed_at')->nullable()->index();
            $table->unsignedBigInteger('availability_confirmed_by')->nullable();

            // Inventory sync.
            $table->string('external_id', 120)->nullable();
            $table->string('external_source', 40)->nullable();
            $table->timestamp('synced_at')->nullable();
            /* Field names the operator has pinned against the feed, e.g.
               ["base_rate"]. Null or [] means the feed owns everything it
               is allowed to own. */
            $table->json('locked_fields')->nullable();

            /* Matching key for a sync. Scoped to source as well as community so
               a community migrating between systems can hold both briefly. */
            $table->unique(['community_id', 'external_source', 'external_id'], 'cmu_external_unique');
        });

        Schema::table('community_map_settings', function (Blueprint $table) {
            // 'manual' | 'pms'. Decides whether the panel presents itself as the
            // source of truth or as a read-mostly view of someone else's.
            $table->string('inventory_source', 20)->default('manual');
            $table->string('pms_provider', 40)->nullable();
            $table->timestamp('last_sync_at')->nullable();
            $table->string('last_sync_status', 20)->nullable();   // ok | partial | failed
            $table->string('last_sync_message', 300)->nullable();

            /* How long before availability is treated as stale. Per-community
               because a 200-unit CCRC and a 16-bed memory care home do not
               turn over at the same rate. */
            $table->unsignedSmallInteger('freshness_days')->default(30);

            /* Whether families see "availability confirmed N days ago". Opt-in:
               it is a strong trust signal for a community that keeps on top of
               it, and a liability for one that does not. */
            $table->boolean('show_confirmed_at')->default(true);
        });
    }

    public function down(): void
    {
        Schema::table('community_map_units', function (Blueprint $table) {
            $table->dropUnique('cmu_external_unique');
            $table->dropColumn([
                'availability_confirmed_at', 'availability_confirmed_by',
                'external_id', 'external_source', 'synced_at', 'locked_fields',
            ]);
        });

        Schema::table('community_map_settings', function (Blueprint $table) {
            $table->dropColumn([
                'inventory_source', 'pms_provider', 'last_sync_at',
                'last_sync_status', 'last_sync_message',
                'freshness_days', 'show_confirmed_at',
            ]);
        });
    }
};
