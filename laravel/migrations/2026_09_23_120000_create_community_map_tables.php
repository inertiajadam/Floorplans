<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 | The interactive community map.
 |
 | This EXTENDS the existing floor_plans feature rather than replacing it.
 | The distinction is the whole design:
 |
 |   floor_plans          a LAYOUT the community offers — "The Cedar, a one
 |                        bedroom, about 610 sq ft, from $4,950". One row per
 |                        layout, with the 2D drawing and any delivered 3D
 |                        rendering. Already built; untouched by this migration.
 |
 |   community_map_units  an ACTUAL SUITE — "204, a Cedar, on the second floor
 |                        of Magnolia House, available on 15 November, facing
 |                        the courtyard, step-free". Many units per layout.
 |
 | An operator on a Featured or Enterprise listing already uploads their
 | layouts. The map adds the floor each one sits on and which are free, so a
 | unit points at a floor_plan for its drawing, size and description, and only
 | stores what is specific to that suite.
 |
 | Care tiers and fees live here too, because the platform has nowhere to put
 | "Level 2 care is $1,150 a month" and that number is the difference between
 | an advertised rate and a real one.
 |
 | See App\Support\CommunityMaps.
 */
return new class extends Migration
{
    public function up(): void
    {
        /* A campus is buildings; a building is levels. Cottages are a building
           with one "level" that happens to be a site plan. */
        Schema::create('community_map_buildings', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('community_id')->index();
            $table->string('name', 120);
            $table->string('short_name', 60)->nullable();
            $table->string('blurb', 300)->nullable();
            $table->unsignedSmallInteger('sort')->default(0);
            $table->timestamps();
        });

        Schema::create('community_map_levels', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('building_id')->index();
            $table->unsignedBigInteger('community_id')->index();   // denormalised: every map query filters on it
            $table->string('name', 80);                            // "Ground floor", "The household", "Site plan"
            $table->unsignedSmallInteger('ordinal')->default(1);   // storey number, for ordering
            $table->string('plan_image', 255)->nullable();         // public disk key, optional backdrop drawing
            $table->unsignedSmallInteger('plan_width')->default(1200);   // the geometry's coordinate space
            $table->unsignedSmallInteger('plan_height')->default(800);
            $table->timestamps();
        });

        /*
         | One real suite.
         |
         | `shape` is a flat JSON array of numbers — [x1,y1,x2,y2,...] — in the
         | level's coordinate space. Flat rather than [{x,y}] because a campus
         | carries a few thousand points and this halves the payload.
         |
         | Most descriptive columns are nullable overrides: null means "use the
         | floor_plan's value". A corner suite that is 40 sq ft larger than the
         | standard version of the same layout sets sqft and inherits the rest.
         */
        Schema::create('community_map_units', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('level_id')->index();
            $table->unsignedBigInteger('community_id')->index();
            $table->unsignedBigInteger('floor_plan_id')->nullable()->index();   // the layout; drawing and specs come from here
            $table->string('number', 20);                                       // "204", "C07"
            $table->json('shape');

            // availability — see App\Support\MapAvailability for the vocabulary
            $table->string('status', 24)->default('occupied')->index();
            $table->date('available_on')->nullable();
            $table->unsignedSmallInteger('waitlist_count')->nullable();
            $table->unsignedSmallInteger('respite_nightly_rate')->nullable();

            // what this suite is and costs
            $table->json('care_levels')->nullable();                 // ["al"] — which levels of care it serves
            $table->unsignedInteger('base_rate')->nullable();        // monthly, before care. null = use floor_plan.starting_price
            $table->unsignedSmallInteger('sqft')->nullable();        // override
            $table->boolean('accessible')->default(false);           // step-free with a roll-in shower
            $table->string('view', 60)->nullable();                  // "Courtyard"
            $table->json('features')->nullable();                    // ["Bay window", "Balcony"]
            $table->string('notes', 300)->nullable();                // internal, never rendered publicly

            $table->unsignedSmallInteger('sort')->default(0);
            $table->timestamps();

            $table->unique(['community_id', 'number'], 'cmu_community_number_unique');
        });

        /* Everything on the plan that is not for sale: corridors, the dining
           room, the lift core, a secured garden. They give the suites context
           and are why a family understands one is at the quiet end of a hall. */
        Schema::create('community_map_features', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('level_id')->index();
            $table->string('kind', 24);                 // corridor | amenity | outdoor | staff | vertical
            $table->string('label', 60)->nullable();    // shown on the plan; null for corridors
            $table->json('shape');
            $table->timestamps();
        });

        /*
         | Levels of care and what they add to the monthly bill.
         |
         | The platform has never stored this, which is why a listing can only
         | ever advertise a starting rate. It is the single most requested
         | number families cannot find anywhere.
         */
        Schema::create('community_care_tiers', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('community_id')->index();
            $table->string('key', 30);                    // "al-2"
            $table->string('label', 60);                  // "Level 2"
            $table->unsignedInteger('monthly')->default(0);
            $table->json('care_levels')->nullable();      // ["al"] — which care levels this tier applies to
            $table->string('description', 200)->nullable();
            $table->unsignedSmallInteger('sort')->default(0);
            $table->timestamps();

            $table->unique(['community_id', 'key'], 'cct_community_key_unique');
        });

        /* One row per community: the fees and extras that turn a suite rate
           into a monthly bill, plus the disclosure shown under the figures. */
        Schema::create('community_map_settings', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('community_id')->unique();
            $table->unsignedInteger('community_fee')->nullable();       // one time, on move-in
            $table->unsignedInteger('second_person_fee')->nullable();   // monthly, couples
            $table->unsignedInteger('pet_deposit')->nullable();         // one time
            $table->json('add_ons')->nullable();                        // [{key,label,monthly}]
            $table->string('legal_note', 500)->nullable();
            $table->boolean('is_published')->default(false);            // the map only shows when the operator says so
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('community_map_settings');
        Schema::dropIfExists('community_care_tiers');
        Schema::dropIfExists('community_map_features');
        Schema::dropIfExists('community_map_units');
        Schema::dropIfExists('community_map_levels');
        Schema::dropIfExists('community_map_buildings');
    }
};
