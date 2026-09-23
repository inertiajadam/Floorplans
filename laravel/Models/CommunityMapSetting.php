<?php

namespace App\Models;

use App\Models\Legacy\Community;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Per-community map settings: the fees that turn a suite rate into a monthly bill. */
class CommunityMapSetting extends Model
{
    protected $table = 'community_map_settings';
    protected $guarded = [];

    protected $casts = [
        'community_fee'     => 'integer',
        'second_person_fee' => 'integer',
        'pet_deposit'       => 'integer',
        'add_ons'           => 'array',
        'is_published'      => 'boolean',
        'last_sync_at'      => 'datetime',
        'freshness_days'    => 'integer',
        'show_confirmed_at' => 'boolean',
    ];

    /** True when a PMS feed is the source of truth, not the operator panel. */
    public function isSynced(): bool
    {
        return $this->inventory_source === 'pms';
    }

    public function community(): BelongsTo
    {
        return $this->belongsTo(Community::class, 'community_id');
    }
}
