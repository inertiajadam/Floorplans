<?php

/*
 |-----------------------------------------------------------------------------
 | Inventory sync
 |-----------------------------------------------------------------------------
 | Every assumption about a vendor's API lives in this file, on purpose.
 |
 | ⚠ THE POINTCLICKCARE SECTION IS UNVERIFIED.
 |
 | developer.pointclickcare.com was unreachable from the environment this was
 | written in, so the base URLs, endpoint paths and field names below are
 | informed guesses at their schema — NOT transcriptions of their docs. They
 | are almost certainly wrong in detail and roughly right in shape.
 |
 | That is why they are config and not code. The logic that consumes them —
 | matching, status translation, bed collapsing — is tested and correct
 | (tests/php/run.php, 62 assertions). Correcting this integration against the
 | real API should be editing the arrays below, and nothing else.
 |
 | HOW TO CORRECT IT, in order:
 |   1. Put real credentials on a community and hit "Test connection". The test
 |      calls describe(), which dumps the keys actually present in the
 |      response, the vendor statuses it saw, and which of them we have no
 |      mapping for. It writes nothing.
 |   2. Fix `fields` until the mapped sample looks right.
 |   3. Fix `status_map` until `unknownStatuses` comes back empty.
 |   4. Only then reconcile, and only then enable the nightly sync.
 |
 | An unknown status is treated as "cannot tell" and leaves the suite alone, so
 | a half-corrected map under-reports rather than publishing something wrong.
 */

return [

    /*
     | Nightly is enough. Availability is a daily-resolution fact and hourly
     | polling buys nothing but rate limits. Staggered per community by the
     | scheduler so a hundred listings do not all fire at 02:00.
     */
    'schedule' => [
        'enabled' => (bool) env('INVENTORY_SYNC_ENABLED', false),
        'cron'    => env('INVENTORY_SYNC_CRON', '0 2 * * *'),
    ],

    /*
     | A feed that stops returning rows looks exactly like success: the job
     | runs, nothing errors, and the map quietly freezes on stale data. This is
     | the failure mode that actually bites, so it is alarmed explicitly.
     |
     | `silence_days`  no successful sync in this long is an alert
     | `empty_is_failure`  a sync returning zero rows for a community that had
     |                     rows yesterday is treated as a failure, not an
     |                     emptied building
     */
    'alarm' => [
        'silence_days'     => (int) env('INVENTORY_SILENCE_DAYS', 3),
        'empty_is_failure' => true,
        'notify'           => array_filter(explode(',', (string) env('INVENTORY_ALERT_EMAILS', ''))),
    ],

    'providers' => [

        'pointclickcare' => [
            'label' => 'PointClickCare',

            /*
             | ⚠ UNVERIFIED. PCC runs separate sandbox and production hosts and
             | the paths below are a guess at their public API shape.
             */
            'base_url'  => env('PCC_BASE_URL', 'https://connect.pointclickcare.com/api/public/api/v2'),
            'token_url' => env('PCC_TOKEN_URL', 'https://connect.pointclickcare.com/auth/token'),

            /* OAuth2 client credentials. Per-application, not per-community:
               the community-specific parts are org and facility ids, stored on
               the connection record. */
            'client_id'     => env('PCC_CLIENT_ID'),
            'client_secret' => env('PCC_CLIENT_SECRET'),
            'scope'         => env('PCC_SCOPE', ''),

            /*
             | The listing endpoint. `{org}` and `{facility}` are filled from
             | the connection record. If PCC turns out to expose rooms and beds
             | separately, point this at beds — bed-level data collapses to
             | rooms correctly (PointClickCareMapper::collapseBeds), whereas
             | room-level data cannot be expanded to beds.
             */
            'units_path' => env('PCC_UNITS_PATH', '/orgs/{org}/facs/{facility}/beds'),

            /* Where the array of records sits in the response body. Empty
               string means the body is already the array. */
            'collection_key' => env('PCC_COLLECTION_KEY', 'data'),

            /* Cursor or page-based pagination. `page_param` is dropped from
               the query when null. */
            'pagination' => [
                'page_param'  => 'page',
                'size_param'  => 'pageSize',
                'page_size'   => 200,
                'max_pages'   => 50,
                'next_key'    => 'paging.next',   // dot-path to a next cursor, when present
            ],

            /*
             | ⚠ UNVERIFIED FIELD NAMES.
             |
             | Values may be a dot-path ("room.name") or a list of paths tried
             | in order until one is non-empty. A path that does not exist
             | yields null rather than an error, so a partly-wrong map degrades
             | instead of failing.
             |
             | `room_key` is what groups beds into a suite. It matters: without
             | it, "204-A" and "204-B" arrive as two separate suites. With it,
             | they collapse and the room is only free when every bed is.
             */
            'fields' => [
                'external_id'  => 'bedId',
                'room_key'     => 'roomId',
                'label'        => ['bedName', 'roomName', 'bedDescription'],
                'status'       => ['bedStatus', 'occupancyStatus', 'status'],
                'building'     => ['unitName', 'unitDescription', 'wingName'],
                'floor'        => ['floorName', 'floor'],
                'available_on' => ['availableDate', 'expectedDischargeDate'],
                /* Rates usually live in a billing API rather than the bed
                   record. Leaving this null means the feed never touches
                   rates, which is the safer default — operators keep the
                   numbers families see. */
                'base_rate'    => env('PCC_RATE_FIELD') ?: null,
            ],

            /* Overrides merged over App\Support\Inventory\StatusMap::defaults().
               Add real vendor values here as the connection test reveals them. */
            'status_map' => [
                // 'awaiting_deep_clean' => 'coming_available',
            ],

            'timeout' => (int) env('PCC_TIMEOUT', 20),
        ],

    ],
];
