<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** A room on the plan that is not for sale: a corridor, the dining room, the lift core, a garden. */
class MapFeature extends Model
{
    protected $table = 'community_map_features';
    protected $guarded = [];

    protected $casts = ['shape' => 'array'];

    public const KINDS = ['corridor', 'amenity', 'outdoor', 'staff', 'vertical'];

    public function level(): BelongsTo
    {
        return $this->belongsTo(MapLevel::class, 'level_id');
    }
}
