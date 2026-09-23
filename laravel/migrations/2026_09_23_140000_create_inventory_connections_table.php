<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 | One community's link to its management system.
 |
 | Separate from community_map_settings because the two have different
 | lifecycles and very different sensitivity. Settings are display preferences
 | an operator edits freely; this holds credentials, is encrypted at rest, and
 | should never be loaded into a page payload.
 |
 | Credentials here are the COMMUNITY-SPECIFIC parts — the organisation and
 | facility ids, and any per-site token. The OAuth application's client id and
 | secret belong to Seniors Places, not to a community, and stay in the
 | environment (config/inventory.php).
 |
 | `reconciled_at` is the gate. A connection is not syncable until a human has
 | paired feed units to our suites, because matching on suite number is the bug
 | that marks the wrong room vacant. See docs/PMS-SYNC.md §3.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('inventory_connections', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('community_id')->index();
            $table->string('provider', 40);                     // 'pointclickcare'

            // Which site inside the vendor's tenancy this community is.
            $table->string('org_id', 120)->nullable();
            $table->string('facility_id', 120)->nullable();

            /* Any per-community secret. Cast to 'encrypted:array' on the model
               so it is never readable from a database dump. */
            $table->text('credentials')->nullable();

            /*
             | A PMS bills per bed; a family rents a room. When the feed is
             | bed-level, rows are grouped into suites and a suite is free only
             | if every bed in it is. Operators whose feed is already
             | room-level switch this off.
             */
            $table->boolean('collapse_beds')->default(true);

            /* The reconciliation gate. Null means "never paired" — the sync
               refuses to run, rather than guessing at matches. */
            $table->timestamp('reconciled_at')->nullable();
            $table->unsignedBigInteger('reconciled_by')->nullable();
            $table->unsignedSmallInteger('linked_units')->default(0);

            // Last connection test, so the portal can show state without a call.
            $table->timestamp('tested_at')->nullable();
            $table->boolean('test_ok')->nullable();
            $table->string('test_message', 500)->nullable();

            /* Switched on only after a successful reconciliation. Kept here
               rather than on settings so pausing a feed never touches the
               operator's display preferences. */
            $table->boolean('is_active')->default(false);

            $table->timestamps();

            $table->unique(['community_id', 'provider'], 'inv_conn_community_provider_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('inventory_connections');
    }
};
