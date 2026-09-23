<?php

namespace App\Models;

use App\Models\Legacy\Community;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A community's link to its management system.
 *
 * Holds credentials, so: never put this model in an Inertia payload. The
 * portal reads `toPortalArray()`, which carries state and no secrets.
 */
class InventoryConnection extends Model
{
    protected $table = 'inventory_connections';
    protected $guarded = [];

    protected $hidden = ['credentials'];

    protected $casts = [
        /* Encrypted at rest: a database dump must not hand over a customer's
           PMS access. */
        'credentials'   => 'encrypted:array',
        'collapse_beds' => 'boolean',
        'is_active'     => 'boolean',
        'test_ok'       => 'boolean',
        'reconciled_at' => 'datetime',
        'tested_at'     => 'datetime',
        'linked_units'  => 'integer',
    ];

    public function community(): BelongsTo
    {
        return $this->belongsTo(Community::class, 'community_id');
    }

    /**
     * May this connection actually sync?
     *
     * Three things must all be true, and the reconciliation gate is the one
     * that matters: without confirmed pairings a sync would have to match on
     * suite number, which is how the wrong room gets marked vacant.
     */
    public function isSyncable(): bool
    {
        return $this->is_active
            && $this->reconciled_at !== null
            && $this->linked_units > 0;
    }

    /** Why it cannot sync, in words an operator can act on. */
    public function blockedReason(): ?string
    {
        if ($this->reconciled_at === null) {
            return 'Match your rooms to your floor plan before turning the sync on.';
        }
        if ($this->linked_units < 1) {
            return 'No rooms are linked yet, so a sync would have nothing to update.';
        }
        if (! $this->is_active) {
            return 'The sync is paused.';
        }

        return null;
    }

    /** Safe for the portal: state, never secrets. */
    public function toPortalArray(): array
    {
        return [
            'provider'      => $this->provider,
            'orgId'         => $this->org_id,
            'facilityId'    => $this->facility_id,
            'collapseBeds'  => $this->collapse_beds,
            'hasCredentials' => ! empty($this->credentials),
            'reconciledAt'  => $this->reconciled_at?->toIso8601String(),
            'linkedUnits'   => $this->linked_units,
            'testedAt'      => $this->tested_at?->toIso8601String(),
            'testOk'        => $this->test_ok,
            'testMessage'   => $this->test_message,
            'isActive'      => $this->is_active,
            'syncable'      => $this->isSyncable(),
            'blockedReason' => $this->blockedReason(),
        ];
    }
}
