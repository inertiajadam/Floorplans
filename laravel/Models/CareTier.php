<?php

namespace App\Models;

use App\Models\Legacy\Community;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A level of care and what it adds to the monthly bill.
 *
 * Assisted living is normally sold in tiers set by a nurse assessment;
 * independent living usually has none, and memory care is often all-inclusive.
 * `care_levels` scopes a tier to the levels it applies to, so a listing never
 * offers a family a tier that cannot apply to the suite they are looking at.
 */
class CareTier extends Model
{
    protected $table = 'community_care_tiers';
    protected $guarded = [];

    protected $casts = [
        'monthly'     => 'integer',
        'care_levels' => 'array',
        'sort'        => 'integer',
    ];

    public function community(): BelongsTo
    {
        return $this->belongsTo(Community::class, 'community_id');
    }
}
