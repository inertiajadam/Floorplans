<?php

namespace App\Models;

use App\Models\Legacy\Community;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One real suite on a floor plan.
 *
 * Distinct from App\Models\FloorPlan, which is the LAYOUT — "The Cedar, a one
 * bedroom, about 610 sq ft". A unit is an instance of a layout at an address:
 * "204, a Cedar, second floor of Magnolia, free on 15 November". Many units
 * share one floor plan, and inherit its drawing, size and description.
 *
 * The nullable columns here are overrides. Reach for the accessors rather than
 * the raw attributes so inheritance is applied consistently.
 */
class MapUnit extends Model
{
    protected $table = 'community_map_units';
    protected $guarded = [];

    protected $casts = [
        'shape'                => 'array',
        'care_levels'          => 'array',
        'features'             => 'array',
        'available_on'         => 'date',
        'accessible'           => 'boolean',
        'base_rate'            => 'integer',
        'sqft'                 => 'integer',
        'waitlist_count'       => 'integer',
        'respite_nightly_rate' => 'integer',
        'sort'                 => 'integer',
        'availability_confirmed_at' => 'datetime',
        'synced_at'                 => 'datetime',
        'locked_fields'             => 'array',
    ];

    /* Availability vocabulary. Mirrors src/lib/availability.js — the two must
       stay in step, so change them together. */
    public const AVAILABLE         = 'available';
    public const COMING_AVAILABLE  = 'coming_available';
    public const WAITLIST          = 'waitlist';
    public const RESPITE           = 'respite';
    public const HELD              = 'held';
    public const MODEL_SUITE       = 'model';
    public const OCCUPIED          = 'occupied';

    public const STATUSES = [
        self::AVAILABLE, self::COMING_AVAILABLE, self::WAITLIST,
        self::RESPITE, self::HELD, self::MODEL_SUITE, self::OCCUPIED,
    ];

    /** States a family can act on — what the "N suites available" count means. */
    public const ACTIONABLE = [self::AVAILABLE, self::COMING_AVAILABLE, self::RESPITE];

    public function level(): BelongsTo
    {
        return $this->belongsTo(MapLevel::class, 'level_id');
    }

    public function floorPlan(): BelongsTo
    {
        return $this->belongsTo(FloorPlan::class, 'floor_plan_id');
    }

    public function community(): BelongsTo
    {
        return $this->belongsTo(Community::class, 'community_id');
    }

    /* ------------------------------------------------- inherited attributes */

    /** Monthly rate before care: this suite's own, else the layout's starting price. */
    public function rate(): ?int
    {
        return $this->base_rate ?? $this->floorPlan?->starting_price;
    }

    public function size(): ?int
    {
        return $this->sqft ?? $this->floorPlan?->sqft;
    }

    /** The image families see — the delivered 3D rendering when there is one. */
    public function image(): ?string
    {
        $key = $this->floorPlan?->displayImage();

        return $key ? '/storage/' . ltrim($key, '/') : null;
    }

    public function isActionable(): bool
    {
        return in_array($this->status, self::ACTIONABLE, true);
    }

    /** Has the operator pinned this field against an inventory feed? */
    public function isLocked(string $field): bool
    {
        return in_array($field, (array) ($this->locked_fields ?? []), true);
    }

    public function confirmedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'availability_confirmed_by');
    }
}
