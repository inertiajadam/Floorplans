<?php

namespace App\Models;

use App\Models\Legacy\Community;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** One building on a campus. Cottages are a "building" holding a single site plan. See App\Support\CommunityMaps. */
class MapBuilding extends Model
{
    protected $table = 'community_map_buildings';
    protected $guarded = [];

    protected $casts = ['sort' => 'integer'];

    public function community(): BelongsTo
    {
        return $this->belongsTo(Community::class, 'community_id');
    }

    public function levels(): HasMany
    {
        return $this->hasMany(MapLevel::class, 'building_id')->orderBy('ordinal');
    }
}
