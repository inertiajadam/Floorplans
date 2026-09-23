# Hands-off inventory sync — the contract

No PMS adapter is built yet, and that is deliberate: an integration written
against a guess at a feed gets rewritten the first time a real one arrives.

What **is** built is everything that would be expensive to retrofit — the
matching key, the field-ownership split, the operator override mechanism and
the audit stamp. Once a customer's feed is in hand, writing the adapter is a
translation job against `MapInventory::applyFeed()`, not a redesign.

This document is the contract that makes that true.

---

## 1. The one thing to get right

**A sync is a partial update, never a replace.**

A PMS knows occupancy, move-out dates and rent. It does not know:

- the polygon a suite occupies on a floor plan
- whether the shower is roll-in
- which way the window faces
- which marketing layout ("The Cedar") the suite is an instance of

All of that is operator-curated and expensive to recreate. A sync that writes
whole rows destroys it. So the model answers "who owns this field?" before the
first feed ever runs.

---

## 2. Field ownership

| Field | Owner | Why |
|---|---|---|
| `status` | **Feed** (lockable) | The PMS is the rent roll |
| `available_on` | **Feed** (lockable) | Move-out and turn dates live there |
| `base_rate` | **Feed** (lockable) | Rent is billed from there |
| `waitlist_count` | **Feed** (lockable) | Some systems track it |
| `shape` | Operator, always | The feed has no geometry |
| `number` | Operator, always | The matching key is `external_id`, not this |
| `floor_plan_id` | Operator, always | A marketing layout, not a PMS concept |
| `level_id` | Operator, always | Structure is drawn, not fed |
| `accessible` | Operator, always | Rarely in a PMS, and never reliably |
| `view`, `features` | Operator, always | Marketing attributes |
| `sqft` | Operator, always | Feed values are gross, listings quote net |
| `care_levels` | Operator, always | Licensing, not occupancy |
| `notes` | Operator, always | Internal, never published |

Encoded in `App\Support\MapInventory`:

```php
public const FEED_OWNED     = ['status', 'available_on', 'base_rate', 'waitlist_count'];
public const OPERATOR_OWNED = ['shape', 'number', 'floor_plan_id', 'level_id',
                               'accessible', 'view', 'features', 'notes',
                               'sqft', 'care_levels', 'sort'];
```

`OPERATOR_OWNED` is listed explicitly rather than implied by omission, so
adding a column never silently hands it to a feed.

### Operator overrides

An operator can pin any feed-owned field on any suite via `locked_fields`.
The panel surfaces this as a padlock on the rate, shown only once a feed is
connected. Real case: a community runs a promotional rate on one suite that
their PMS does not know about. They pin it; the feed stops touching it.

---

## 3. Matching

**Match on `external_id`. Never on suite number.**

Suite numbers get reused when a wing is renumbered or a building is
re-addressed. A mismatch there does not throw — it silently marks the wrong
room vacant, and nobody notices until a family is shown a room someone lives
in.

`external_id` is scoped by `external_source` and `community_id`
(`cmu_external_unique`), so a community mid-migration between systems can
carry both briefly without a collision.

### First connection

Matching only works once the ids exist. Connecting a feed for the first time
needs a one-off reconciliation:

1. Pull the feed's unit list.
2. Propose matches to the operator by suite number — a review screen, not an
   automatic write.
3. The operator confirms or corrects; the confirmed pairs write `external_id`.
4. Anything unmatched stays manual until someone pairs it.

**This screen is not built.** It is the first piece of adapter work, and it
must be a human-confirmed step. Auto-matching on number at connection time is
the same bug as matching on number every time — just concentrated into one bad
afternoon.

---

## 4. Writing an adapter

The adapter's entire job is to produce rows in this shape:

```php
[
    ['external_id' => 'PCC-204', 'status' => 'available',
     'available_on' => null, 'base_rate' => 4950],
    ['external_id' => 'PCC-205', 'status' => 'coming_available',
     'available_on' => '2026-11-15', 'base_rate' => 5100],
]
```

Then:

```php
$result = MapInventory::applyFeed($community, $rows, 'pointclickcare');
// ['matched' => 58, 'updated' => 12, 'skipped' => 0,
//  'unmatched' => ['PCC-311'], 'locked' => 1]
```

Matching, ownership, locks, the freshness stamp and the sync status record are
all handled there — identically for every provider, which is exactly why they
do not belong in the adapter.

### Status mapping is the adapter's real work

No PMS uses our vocabulary. Each needs a mapping, and the mapping is where the
domain judgement lives:

| Ours | Typical PMS equivalent |
|---|---|
| `available` | Vacant / Ready |
| `coming_available` | Notice given, Vacant-not-ready, Turn in progress |
| `occupied` | Occupied |
| `held` | Reserved, Deposit taken |
| `waitlist` | Usually absent — keep manual |
| `respite` | Short-stay / Respite, where modelled |
| `model` | Almost always absent — keep manual |

`waitlist`, `respite` and `model` mostly do not exist in a PMS. An adapter that
maps them to `occupied` would wipe out exactly the states that make this map
better than a multifamily one. **When a feed has no concept for a state, it must
leave that suite alone**, not flatten it.

Practical rule: if a suite's current status is one the feed cannot express,
skip the status field for that row and let the operator own it.

---

## 5. Rules `applyFeed` enforces

1. Match on `external_id` only.
2. Write only `FEED_OWNED` fields.
3. Skip fields in that suite's `locked_fields`.
4. **Never create or delete suites.** An unmatched row is reported, not
   guessed at. Creating one would need geometry the feed cannot supply;
   deleting one would destroy operator work over what is usually a feed
   glitch or a mid-migration id change.
5. A matched row with no changes still stamps `availability_confirmed_at` —
   the feed has vouched for that suite being current, which is what the stamp
   means.

Unmatched rows land in `community_map_settings.last_sync_message` and the
panel shows them. Silent partial failure is how a sync quietly rots.

---

## 6. Scheduling

Not built. When it is:

- Nightly is enough. Availability is a daily-resolution fact, and hourly polls
  buy nothing but rate limits.
- Run per community, not globally — one operator's broken credentials must not
  stop everyone else's sync.
- Record every run on `community_map_settings` (already has `last_sync_at`,
  `last_sync_status`, `last_sync_message`).
- **Alert on silence, not just on errors.** A feed that stops returning rows
  looks like success and is the failure mode that actually bites: the map
  freezes on stale data while every status light stays green. The freshness
  stamp already catches this — a synced community whose suites drift past the
  staleness window means the feed has stopped, and should page someone.

A Laravel command shell would be roughly:

```php
// app/Console/Commands/SyncCommunityInventory.php
foreach ($communities as $community) {
    try {
        $rows = $this->adapterFor($community)->fetch();
        $result = MapInventory::applyFeed($community, $rows, $provider);
        // log $result
    } catch (\Throwable $e) {
        // record failure on settings; continue to the next community
    }
}
```

---

## 7. What the operator sees once a feed is connected

Already built, behind `settings.inventory_source === 'pms'`:

- A strip naming the provider and when it last ran.
- Status and rate controls disabled per row, unless that field is pinned.
- A padlock per lockable field to take ownership back.
- Partial-sync warnings surfaced in the panel.

The panel does **not** hide itself when a feed is connected. Operators still
need the states their PMS cannot express — waitlist, respite, model suites —
and they still need to confirm freshness on anything the feed does not cover.

---

## 8. Recommended order of work

1. **Reconciliation screen** (§3). Nothing else can run before ids exist.
2. **One adapter**, against a real customer feed. Resist writing three.
3. **Scheduling and alerting** (§6), including the silence alarm.
4. A second adapter — only now is the interface proven enough to generalise.

Steps 1 and 2 are most of the value. A single community moving from manual to
synced proves the contract; the rest is repetition.
