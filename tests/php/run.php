<?php

/*
 | Tests for the inventory sync logic.
 |
 | These cover the decisions, not the plumbing: which suite a feed row belongs
 | to, whether a status may be overwritten, and how bed-level records collapse
 | into suite-level ones. That is where a bug does real damage — pointing a
 | family at an occupied room, or wiping an operator's curation.
 |
 | Run: php tests/php/run.php
 */

require_once __DIR__ . '/bootstrap.php';

use App\Support\Inventory\FeedUnit;
use App\Support\Inventory\InventoryMatcher;
use App\Support\Inventory\PointClickCare\PointClickCareMapper;
use App\Support\Inventory\StatusMap;

echo "Inventory sync logic\n";

/* ========================================================== the status map */

T::group('StatusMap — translating a vendor vocabulary');

$sm = StatusMap::fromConfig();

T::same('vacant becomes available', 'available', $sm->translate('vacant'));
T::same('case and spacing are normalised', 'coming_available', $sm->translate('Notice Given'));
T::same('hyphens normalise too', 'coming_available', $sm->translate('vacant-not-ready'));
T::same('reserved becomes held', 'held', $sm->translate('Reserved'));

/* A status we have never seen must not be guessed at. Guessing "occupied" for
   an unknown value is how a sync quietly hides rooms. */
T::same('an unknown vendor status yields null', null, $sm->translate('AWAITING_DEEP_CLEAN'));

/* Out of service is explicitly mapped to null rather than occupied: a room
   being renovated is not a room someone lives in, and we have no state for it. */
T::same('out of service is left alone, not called occupied', null, $sm->translate('Out of Service'));

T::same(
    'unmapped statuses are reported for review',
    ['AWAITING_DEEP_CLEAN'],
    $sm->unknownAmong(['vacant', 'occupied', 'AWAITING_DEEP_CLEAN', 'vacant']),
);

T::group('StatusMap — the leave-alone rule (the one that matters)');

/* The core safety property. A PMS has no concept of a waitlist; it reports a
   waitlisted suite as occupied. Applying that would destroy the state. */
T::same('a feed saying "occupied" must not clear a waitlist', null, $sm->resolve('occupied', 'waitlist'));
T::same('nor clear a respite suite', null, $sm->resolve('occupied', 'respite'));
T::same('nor clear a model suite', null, $sm->resolve('Occupied', 'model'));
T::same('nor may "reserved" clear one', null, $sm->resolve('reserved', 'waitlist'));

/* But a suite becoming FREE is unambiguous and is exactly what we sync for. */
T::same('a waitlisted suite becoming available is applied', 'available', $sm->resolve('vacant', 'waitlist'));
T::same('coming-available also overrides', 'coming_available', $sm->resolve('Notice Given', 'respite'));

/* Ordinary transitions are untouched by the rule. */
T::same('occupied to available applies normally', 'available', $sm->resolve('vacant', 'occupied'));
T::same('available to occupied applies normally', 'occupied', $sm->resolve('occupied', 'available'));
T::same('an unknown status never writes', null, $sm->resolve('SOMETHING_NEW', 'available'));

/* guard() is the same rule on an already-translated value, used at write time. */
T::same('guard leaves operator-only states alone', null, $sm->guard('occupied', 'waitlist'));
T::same('guard passes freeing news through', 'available', $sm->guard('available', 'model'));

/* ============================================================= the matcher */

T::group('InventoryMatcher — confident pairings');

$suites = [
    ['id' => 1, 'number' => '204', 'building' => 'Magnolia House', 'level' => 'Floor 2'],
    ['id' => 2, 'number' => '205', 'building' => 'Magnolia House', 'level' => 'Floor 2'],
    ['id' => 3, 'number' => 'G12', 'building' => 'The Grove',      'level' => 'The household'],
];

$feed = [
    new FeedUnit(externalId: 'PCC-1', label: '204',   building: 'Magnolia House'),
    new FeedUnit(externalId: 'PCC-2', label: 'Rm 205', building: 'Magnolia House'),
    new FeedUnit(externalId: 'PCC-3', label: 'G12',   building: 'Grove'),
];

$r = InventoryMatcher::propose($feed, $suites);
$byExt = [];
foreach ($r['pairs'] as $p) {
    $byExt[$p['externalId']] = $p;
}

T::same('every feed row is paired', 3, count($r['pairs']));
T::same('an exact number in the same building pairs', 1, $byExt['PCC-1']['unitId']);
T::same('and is high confidence', 'high', $byExt['PCC-1']['confidence']);
T::same('"Rm 205" pairs with 205', 2, $byExt['PCC-2']['unitId']);
T::same('an abbreviated building still agrees', 3, $byExt['PCC-3']['unitId']);
T::same('nothing is left unmatched', 0, $r['counts']['unmatchedFeed']);

T::group('InventoryMatcher — beds and rooms');

$r2 = InventoryMatcher::propose(
    [new FeedUnit(externalId: 'PCC-9', label: '204-A', building: 'Magnolia House')],
    [['id' => 1, 'number' => '204', 'building' => 'Magnolia House', 'level' => 'Floor 2']],
);
T::same('a bed label matches its room', 1, $r2['pairs'][0]['unitId']);
T::same('and is confident', 'high', $r2['pairs'][0]['confidence']);

T::group('InventoryMatcher — ambiguity must NOT be confident');

/* The bug this whole screen exists to prevent: two buildings, both with a
   "204", and a feed row that says only "204". The top score is a coin flip,
   so it must never land in the band that bulk-accept touches. */
$ambiguousSuites = [
    ['id' => 1, 'number' => '204', 'building' => null, 'level' => 'Floor 2'],
    ['id' => 2, 'number' => '204', 'building' => null, 'level' => 'Floor 2'],
];
$r3 = InventoryMatcher::propose([new FeedUnit(externalId: 'PCC-X', label: '204')], $ambiguousSuites);

T::same('a tie is still proposed', 1, count($r3['pairs']));
T::ok('the tie is flagged ambiguous', $r3['pairs'][0]['ambiguous'] === true);
T::same('and demoted to low confidence', 'low', $r3['pairs'][0]['confidence']);
T::ok('with a reason a human can act on', str_contains($r3['pairs'][0]['reason'], 'almost as well'), $r3['pairs'][0]['reason']);
T::same('so bulk-accept would touch none of them', 0, $r3['counts']['high']);

T::group('InventoryMatcher — a different building is not a match');

$r4 = InventoryMatcher::propose(
    [new FeedUnit(externalId: 'PCC-Y', label: '204', building: 'The Grove')],
    [['id' => 1, 'number' => '204', 'building' => 'Magnolia House', 'level' => 'Floor 2']],
);
T::ok('a cross-building pair is not confident', $r4['pairs'][0]['confidence'] !== 'high', $r4['pairs'][0]['confidence']);
T::ok('and says why', str_contains($r4['pairs'][0]['reason'], 'different building'), $r4['pairs'][0]['reason']);

T::group('InventoryMatcher — leftovers are visible in both directions');

$r5 = InventoryMatcher::propose(
    [
        new FeedUnit(externalId: 'PCC-1', label: '204', building: 'Magnolia House'),
        new FeedUnit(externalId: 'PCC-NEW', label: 'Wing C Suite 9001', building: 'Annexe'),
    ],
    [
        ['id' => 1, 'number' => '204', 'building' => 'Magnolia House', 'level' => 'Floor 2'],
        ['id' => 2, 'number' => '311', 'building' => 'Magnolia House', 'level' => 'Floor 3'],
    ],
);
T::same('a feed row with no home is reported', 1, $r5['counts']['unmatchedFeed']);
T::same('and named', 'PCC-NEW', $r5['unmatchedFeed'][0]['externalId']);
T::same('a suite the feed does not know is reported', 1, $r5['counts']['unmatchedSuites']);
T::same('and named', '311', $r5['unmatchedSuites'][0]['number']);

T::group('InventoryMatcher — one suite cannot take two feed rows');

$r6 = InventoryMatcher::propose(
    [
        new FeedUnit(externalId: 'PCC-A', label: '204', building: 'Magnolia House'),
        new FeedUnit(externalId: 'PCC-B', label: '204', building: 'Magnolia House'),
    ],
    [['id' => 1, 'number' => '204', 'building' => 'Magnolia House', 'level' => 'Floor 2']],
);
T::same('only one pair is made', 1, count($r6['pairs']));
T::same('the loser is reported rather than dropped', 1, $r6['counts']['unmatchedFeed']);

/* ============================================ the PointClickCare mapper */

T::group('PointClickCareMapper — reading a response');

$fields = [
    'external_id'  => 'bedId',
    'label'        => ['bedName', 'roomName'],
    'status'       => 'bedStatus',
    'building'     => 'unitName',
    'floor'        => 'floorName',
    'available_on' => 'availableDate',
    'base_rate'    => 'privateRate',
    'room_key'     => 'roomId',
];

$mapper = new PointClickCareMapper($fields, $sm);

$rows = [
    ['bedId' => 'B-1', 'roomId' => 'R-1', 'bedName' => '204-A', 'roomName' => '204', 'bedStatus' => 'Occupied', 'unitName' => 'Magnolia House', 'floorName' => '2'],
    ['bedId' => 'B-2', 'roomId' => 'R-1', 'bedName' => '204-B', 'roomName' => '204', 'bedStatus' => 'Vacant',   'unitName' => 'Magnolia House', 'floorName' => '2'],
    ['bedId' => 'B-3', 'roomId' => 'R-2', 'bedName' => '205',   'roomName' => '205', 'bedStatus' => 'Vacant',   'unitName' => 'Magnolia House', 'floorName' => '2', 'privateRate' => '4,950.00', 'availableDate' => '2026-11-15'],
];

$mapped = $mapper->map($rows);
T::same('every row with an id is mapped', 3, count($mapped));
T::same('the id comes from the configured path', 'B-1', $mapped[0]->externalId);
T::same('the label falls back through the list', '204-A', $mapped[0]->label);
T::same('the vendor status is translated', 'occupied', $mapped[0]->status);
T::same('a formatted rate becomes an integer', 4950, $mapped[2]->baseRate);
T::same('a date is normalised', '2026-11-15', $mapped[2]->availableOn);

$noId = $mapper->map([['roomName' => '999', 'bedStatus' => 'Vacant']]);
T::same('a row with no stable id is skipped, not guessed', 0, count($noId));

T::group('PointClickCareMapper — a shared room is only as free as its beds');

$collapsed = $mapper->collapseBeds($mapped);
$byLabel = [];
foreach ($collapsed as $u) {
    $byLabel[$u->label] = $u;
}

T::same('two beds collapse into one suite', 2, count($collapsed));
T::ok('the shared room is labelled as shared', isset($byLabel['204 (2 beds)']), implode(', ', array_keys($byLabel)));

/* THE critical assertion. One bed occupied, one vacant: the ROOM is occupied.
   Reporting it available would advertise a room with someone already in it. */
T::same('one occupied bed makes the whole room occupied', 'occupied', $byLabel['204 (2 beds)']->status);
T::same('the room keeps a stable room-level id', 'R-1', $byLabel['204 (2 beds)']->externalId);
T::same('a private room is untouched by collapsing', 'available', $byLabel['205']->status);

/* An unknown status on any bed makes the whole room unknown — being unsure
   about one bed means being unsure about the room. */
$unsure = $mapper->collapseBeds($mapper->map([
    ['bedId' => 'B-9', 'roomId' => 'R-9', 'bedName' => '300-A', 'bedStatus' => 'Vacant'],
    ['bedId' => 'B-10', 'roomId' => 'R-9', 'bedName' => '300-B', 'bedStatus' => 'MYSTERY_STATE'],
]));
T::same('an unknown bed status suppresses the room', null, $unsure[0]->status);

T::group('PointClickCareMapper — feed rows for applyFeed');

$row = $mapped[2]->toFeedRow();
T::ok('a row carries its external id', ($row['external_id'] ?? null) === 'B-3');
T::ok('and its status', ($row['status'] ?? null) === 'available');
T::ok('a move-in date is omitted unless the status carries one', ! array_key_exists('available_on', $row), json_encode($row));

$coming = (new FeedUnit(externalId: 'X', label: 'X', status: 'coming_available', availableOn: '2026-12-01'))->toFeedRow();
T::same('a coming-available row does carry its date', '2026-12-01', $coming['available_on']);

$unknown = (new FeedUnit(externalId: 'Y', label: 'Y', status: null))->toFeedRow();
T::ok('a row the feed cannot judge omits status entirely', ! array_key_exists('status', $unknown), json_encode($unknown));

T::group('PointClickCareMapper — describe() for checking a field map');

$d = $mapper->describe($rows);
T::same('it counts what it saw', 3, $d['rows']);
T::ok('it lists the keys actually present', in_array('bedStatus', $d['availableKeys'], true));
T::ok('it reports vendor statuses found', in_array('Vacant', $d['vendorStatuses'], true));
T::same('and flags none unknown for a good map', [], $d['unknownStatuses']);

$bad = new PointClickCareMapper(['external_id' => 'nope', 'status' => 'alsoNope'], $sm);
T::same('a wrong field map maps nothing rather than throwing', 0, count($bad->map($rows)));

exit(T::summary());
