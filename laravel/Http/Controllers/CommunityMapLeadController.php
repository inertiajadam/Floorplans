<?php

namespace App\Http\Controllers\Frontend;

use App\Actions\Leads\NotifyLead;
use App\Http\Controllers\Controller;
use App\Models\Legacy\Community;
use App\Models\Legacy\Lead;
use App\Models\MapUnit;
use App\Support\CommunityMaps;
use App\Support\Consent;
use App\Support\InquiryForm;
use App\Support\MetaCapi;
use App\Support\Stats;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * A family asking about one specific suite on the interactive map.
 *
 * This is a thin variant of CommunityController@storeTour. It deliberately
 * reuses that whole pipeline — duplicate detection, Stats, NotifyLead, the
 * Aline push, the Meta CAPI event — because a map enquiry is an ordinary
 * community lead that happens to name a suite. Forking the pipeline would mean
 * map leads quietly missing the CRM, which is the sort of bug nobody notices
 * for a month.
 *
 * What it adds is the suite: the number, layout, building, floor, care level
 * and advertised rate go into custom_ques_ans and into the notification email.
 * "Sarah asked about Suite 214, a Cedar on the second floor, $4,950" is worth
 * considerably more to a sales counsellor than "Sarah submitted the contact
 * form", and it is the single thing an embedded third-party map cannot give
 * you, because the map does not know who you are.
 */
class CommunityMapLeadController extends Controller
{
    public const FORM = 'community-map';

    public function store(Request $request, string $slug, NotifyLead $notify): RedirectResponse
    {
        $community = Community::query()
            ->where('community_slug', $slug)
            ->active()->approved()->with('organization')
            ->firstOrFail();

        abort_unless(CommunityMaps::isLive($community), 404);

        $data = $request->validate([
            'name'         => ['required', 'string', 'max:120'],
            'email'        => ['nullable', 'email', 'max:255', 'required_without:phone'],
            'phone'        => ['nullable', 'string', 'max:40', 'required_without:email'],
            'preferred'    => ['nullable', Rule::in(['email', 'phone', 'either'])],
            'relationship' => ['nullable', Rule::in(['parent', 'spouse', 'self', 'other'])],
            'intent'       => ['required', Rule::in(['tour', 'info'])],
            'tour_date'    => ['nullable', 'date', 'after_or_equal:today', 'before_or_equal:' . now()->addDays(120)->toDateString(), 'required_if:intent,tour'],
            'message'      => ['nullable', 'string', 'max:2000'],
            'unit_id'      => ['required', 'integer'],
            'website'      => ['nullable', 'string', 'max:0'],   // honeypot, same as the other forms
        ]);

        /* Resolve the suite from OUR database rather than trusting the posted
           layout, rate and care level. The client sends them for convenience;
           a lead that records what the family was actually shown has to come
           from the same source the map was rendered from. */
        $unit = MapUnit::query()
            ->where('id', $data['unit_id'])
            ->where('community_id', $community->id)
            ->with(['floorPlan', 'level.building'])
            ->firstOrFail();

        $careSlug = $unit->care_levels[0] ?? ($community->community_care_type ?? 'assisted-living');

        $answers = array_filter([
            'suite'        => $unit->number,
            'layout'       => $unit->floorPlan?->name,
            'building'     => $unit->level?->building?->name,
            'floor'        => $unit->level?->name,
            'care_level'   => $careSlug,
            'availability' => $unit->status,
            'suite_rate'   => ($community->pricing_public ?? true) ? $unit->rate() : null,
            'intent'       => $data['intent'],
            'tour_date'    => $data['tour_date'] ?? null,
            'relationship' => $data['relationship'] ?? null,
            'preferred'    => $data['preferred'] ?? null,
        ], static fn ($v) => $v !== null && $v !== '');

        $stored = [
            'form'    => self::FORM,
            'answers' => $answers,
            'consent' => Consent::record($request, 'community_map'),
        ];

        $duplicate = Lead::query()
            ->where('community_id', $community->id)
            ->where(function ($q) use ($data) {
                if (! empty($data['email'])) $q->orWhere('lead_email', $data['email']);
                if (! empty($data['phone'])) $q->orWhere('lead_phone', $data['phone']);
            })
            ->where('created_at', '>=', now()->subDays(30))
            ->exists();

        $lead = Lead::create([
            'community_id'        => $community->id,
            'community_added_by'  => $community->added_by,
            'lead_name'           => trim($data['name']),
            'lead_email'          => trim((string) ($data['email'] ?? '')),
            'lead_phone'          => trim((string) ($data['phone'] ?? '')),
            'lead_community_type' => $careSlug,
            'lead_ip'             => $request->ip() ?? '0.0.0.0',
            'lead_date'           => now()->toDateString(),
            'lead_form'           => self::FORM,
            'req_comment'         => trim((string) ($data['message'] ?? '')),
            'custom_ques_ans'     => json_encode($stored, JSON_UNESCAPED_SLASHES),
            'which_type'          => InquiryForm::legacyWhichType($careSlug),
            'getreferrer'         => $request->headers->get('referer'),
            'is_unique'           => $duplicate ? 'Not unique' : 'Unique',
            'lead_count'          => 1,
        ]);

        Stats::lead($community);

        /* The labelled block at the top of the notification email. Suite first:
           it is the reason this lead is different from every other one. */
        $labelled = array_filter([
            'Suite'        => $unit->number . ($unit->floorPlan?->name ? ' — ' . $unit->floorPlan->name : ''),
            'Where'        => trim(($unit->level?->building?->name ?? '') . ' ' . ($unit->level?->name ?? '')) ?: null,
            'Availability' => $unit->status,
            'Asked for'    => $data['intent'] === 'tour' ? 'A visit' . (! empty($data['tour_date']) ? ' on ' . $data['tour_date'] : '') : 'Details by ' . ($data['preferred'] ?? 'email'),
        ]);

        if (\App\Actions\Leads\PushToCrm::linked($community)) {
            $labelled['CRM'] = 'Aline, sent right after this email; the outcome is on the lead record';
            dispatch(fn () => app(\App\Actions\Leads\PushToCrm::class)->handle($lead, $community))->afterResponse();
        }

        $notify->handle($lead, $community, 'community-map', $labelled);

        MetaCapi::lead($request, [
            'name'  => $lead->lead_name,
            'email' => $lead->lead_email,
            'phone' => $lead->lead_phone,
            'city'  => $community->community_city,
            'state' => $community->community_state,
        ], [
            'content_name' => 'community_map',
            'lead_type'    => 'community_map',
            'community'    => $community->community_slug,
            'unit'         => $unit->number,
        ]);

        /* Back to the exact suite the family was looking at. The map reads the
           unit out of the query string, so the drawer is still open when the
           page comes back and the confirmation lands in context. */
        return back(fallback: route('frontend.community.show', $community->community_slug) . '?unit=' . $unit->id)
            ->with('map_lead_sent', true);
    }
}
