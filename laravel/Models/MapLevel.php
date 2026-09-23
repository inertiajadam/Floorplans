<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** One floor of a building, and the coordinate space its geometry is drawn in. */
class MapLevel extends Model
{
    protected $table = 'community_map_levels';
    protected $guarded = [];

    protected $casts = [
        'ordinal'     => 'integer',
        'plan_width'  => 'integer',
        'plan_height' => 'integer',
    ];

    public function building(): BelongsTo
    {
        return $this->belongsTo(MapBuilding::class, 'building_id');
    }

    public function units(): HasMany
    {
        return $this->hasMany(MapUnit::class, 'level_id')->orderBy('sort')->orderBy('number');
    }

    public function features(): HasMany
    {
        return $this->hasMany(MapFeature::class, 'level_id');
    }

    /** Public disk key -> URL, matching the convention in App\Support\FloorPlans. */
    public function planImageUrl(): ?string
    {
        return $this->plan_image ? '/storage/' . ltrim($this->plan_image, '/') : null;
    }
}
