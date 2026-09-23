<script setup>
/*
 | Owner portal: keeping availability true.
 |
 | This panel exists because of one fact: a map showing a suite that was let
 | last week is worse than no map. It takes a tool that builds trust and makes
 | it destroy trust, and the family only finds out after they have rung up.
 |
 | So the panel is not organised around "editing units". It is organised around
 | the question "is this still right?", and it makes the two honest answers
 | cheap:
 |
 |   "Yes, nothing changed"   → one button, the whole roster confirmed
 |   "No, 204 has gone"       → one dropdown on one row, saved on change
 |
 | Everything else — adding suites, tracing geometry, care tiers — is a rarer
 | job and is allowed to cost more clicks. The roster is sorted so the work
 | comes first: suites that are stale AND bookable at the top, because those
 | are the rows where being wrong actually costs a family a phone call.
 |
 | TRANSPORT-AGNOSTIC: the panel never posts anything itself. It calls the
 | `submit` prop and awaits the result. In the platform that prop is a few
 | lines of Inertia router; in the demo it mutates local state. That keeps the
 | panel drivable in a browser test without a Laravel app behind it.
 */
import { computed, ref } from 'vue';
import UnitRow from './UnitRow.vue';
import { STATUSES, STATUS_ORDER, describeAge } from '../lib/availability.js';

const props = defineProps({
    /** App\Support\CommunityMaps::portalPayload() */
    map:         { type: Object, required: true },
    communityId: { type: Number, required: true },
    /** async (action, payload) => void. Throws to signal failure. */
    submit:      { type: Function, required: true },
});

const q = ref('');
const scope = ref('attention');           // attention | bookable | all
const selected = ref(new Set());
const savingIds = ref(new Set());
const savedAt = ref({});                  // unitId -> timestamp
const busy = ref(null);                   // a panel-level action in flight
const flash = ref(null);                  // { tone, text }

const settings = computed(() => props.map.settings ?? {});
const freshness = computed(() => props.map.freshness ?? { stale: 0, actionable: 0, total: 0, days: 30 });
const synced = computed(() => settings.value.inventory_source === 'pms');
const units = computed(() => props.map.units ?? []);

/* ------------------------------------------------------------- filtering */

const scopes = computed(() => [
    { key: 'attention', label: 'Needs attention', count: units.value.filter(needsAttention).length },
    { key: 'bookable', label: 'Bookable now', count: units.value.filter((u) => u.actionable).length },
    { key: 'all', label: 'Every suite', count: units.value.length },
]);

/**
 * "Needs attention" is deliberately narrow. If it lists everything it lists
 * nothing — the point is that an operator can clear it and be done.
 */
function needsAttention(u) {
    if (u.stale && u.actionable) return true;                                  // bookable, but unvouched for
    if (u.status === 'coming_available' && !u.availableOn) return true;        // no date to show families
    if (u.actionable && !u.layoutName) return true;                            // bookable with no plan drawing
    return false;
}

const visible = computed(() => {
    const needle = q.value.trim().toLowerCase();
    return units.value.filter((u) => {
        if (scope.value === 'attention' && !needsAttention(u)) return false;
        if (scope.value === 'bookable' && !u.actionable) return false;
        if (!needle) return true;
        return [u.number, u.layoutName, u.building, u.level]
            .filter(Boolean).join(' ').toLowerCase().includes(needle);
    });
});

/* -------------------------------------------------------------- selection */

const allVisibleSelected = computed(() =>
    visible.value.length > 0 && visible.value.every((u) => selected.value.has(u.id)));

function toggleSelect(id) {
    const next = new Set(selected.value);
    next.has(id) ? next.delete(id) : next.add(id);
    selected.value = next;
}

function toggleSelectAll() {
    selected.value = allVisibleSelected.value ? new Set() : new Set(visible.value.map((u) => u.id));
}

/* ---------------------------------------------------------------- actions */

async function run(action, payload, { key = null, message = null } = {}) {
    if (key) savingIds.value = new Set(savingIds.value).add(key);
    else busy.value = action;
    flash.value = null;

    try {
        await props.submit(action, payload);
        if (key) savedAt.value = { ...savedAt.value, [key]: Date.now() };
        if (message) flash.value = { tone: 'ok', text: message };
    } catch (err) {
        flash.value = { tone: 'error', text: err?.message || 'That did not save. Please try again.' };
    } finally {
        if (key) {
            const next = new Set(savingIds.value);
            next.delete(key);
            savingIds.value = next;
        } else {
            busy.value = null;
        }
    }
}

const onUnitChange = (id, changes) => run('unit.update', { id, ...changes }, { key: id });
const onToggleLock = (id, field) => run('lock.toggle', { id, field }, { key: id });

function confirmAll() {
    run('confirm.all', {}, { message: `Thank you — all ${freshness.value.total} suites are marked as confirmed today.` });
}

function bulkStatus(status) {
    const ids = [...selected.value];
    if (!ids.length) return;
    run('bulk.status', { ids, status }, {
        message: `${ids.length} suite${ids.length === 1 ? '' : 's'} set to ${STATUSES[status].label.toLowerCase()}.`,
    }).then(() => { selected.value = new Set(); });
}

function togglePublish() {
    run('publish', { published: !props.map.published });
}

/* ---------------------------------------------------------------- display */

const lastConfirmed = computed(() => describeAge(freshness.value.confirmedAt));

const banner = computed(() => {
    const f = freshness.value;
    if (!f.total) return null;
    if (f.stale > 0) {
        return {
            tone: 'warn',
            title: `${f.stale} bookable suite${f.stale === 1 ? '' : 's'} ${f.stale === 1 ? 'has' : 'have'} not been checked in ${f.days} days`,
            body: 'Families are seeing this availability right now. If it is still right, say so — it takes one click.',
        };
    }
    return {
        tone: 'ok',
        title: lastConfirmed.value ? `Availability confirmed ${lastConfirmed.value}` : 'Availability is up to date',
        body: settings.value.show_confirmed_at
            ? 'Families can see how recently you checked, which is a reason to choose you over a listing that cannot show it.'
            : 'Turn on “show families when this was last confirmed” below to make this visible on your listing.',
    };
});
</script>

<template>
    <section id="availability" class="scroll-mt-24 space-y-4 rounded-[18px] border border-hairline bg-white p-5 shadow-card-soft sm:p-6">
        <!-- ---------------------------------------------------- header -->
        <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
                <h2 class="font-serif text-lg font-bold text-ink">Availability</h2>
                <p class="mt-0.5 text-[13px] text-ink-mid">
                    What families see on your interactive map. Change a suite and it is live straight away.
                </p>
            </div>

            <div class="flex items-center gap-2">
                <span
                    class="rounded-full px-2.5 py-1 text-[12px] font-semibold"
                    :class="map.published ? 'bg-forest-light text-forest' : 'bg-warm-dark text-ink-mid'"
                >{{ map.published ? 'Live on your listing' : 'Hidden' }}</span>
                <button
                    type="button"
                    class="tap-safe rounded-lg border border-hairline px-3 py-2 text-[13px] font-semibold text-ink hover:bg-warm disabled:opacity-60"
                    :disabled="busy === 'publish'"
                    @click="togglePublish"
                >{{ map.published ? 'Hide the map' : 'Publish the map' }}</button>
            </div>
        </div>

        <!-- ------------------------------------------------- tier gate -->
        <div v-if="!map.allowed" class="rounded-[12px] border border-hairline bg-warm/40 p-4 text-[13.5px] text-ink-mid">
            The interactive map is included on Featured and Enterprise listings. Choose one of those plans above
            and we will set your floor plans up with it.
        </div>

        <template v-else-if="!freshness.total">
            <div class="rounded-[12px] border border-dashed border-hairline bg-warm/40 p-5 text-[13.5px] text-ink-mid">
                <p class="font-semibold text-ink">No suites on the map yet.</p>
                <p class="mt-1">
                    Add a building below, then trace its floor plan with the plan tracer. You only do this once —
                    after that, keeping availability current is a dropdown per suite.
                </p>
            </div>
        </template>

        <template v-else>
            <!-- ------------------------------------------ flash + banner -->
            <p
                v-if="flash"
                class="rounded-[12px] px-3.5 py-2.5 text-[13.5px]"
                :class="flash.tone === 'error' ? 'bg-danger/10 text-danger' : 'bg-forest-light text-forest'"
                role="status"
                aria-live="polite"
            >{{ flash.text }}</p>

            <div
                v-if="banner"
                class="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border p-4"
                :class="banner.tone === 'warn' ? 'border-gold-dark/40 bg-gold-light/25' : 'border-hairline bg-warm/40'"
            >
                <div class="min-w-0">
                    <p class="text-[14px] font-semibold text-ink">{{ banner.title }}</p>
                    <p class="mt-0.5 text-[13px] text-ink-mid">{{ banner.body }}</p>
                </div>

                <!--
                  The most-used control in the panel. The most common truth about
                  a rent roll is "nothing changed", and a workflow that demands a
                  form per suite to say that is one nobody completes.
                -->
                <button
                    type="button"
                    class="tap-safe shrink-0 rounded-lg bg-brand px-4 py-2.5 text-[14px] font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
                    :disabled="busy === 'confirm.all'"
                    @click="confirmAll"
                >{{ busy === 'confirm.all' ? 'Confirming…' : 'Everything here is still right' }}</button>
            </div>

            <!-- ------------------------------------------- sync status -->
            <div v-if="synced" class="rounded-[12px] border border-hairline bg-warm/30 p-3 text-[13px] text-ink-mid">
                <span class="font-semibold text-ink">Inventory syncs from {{ settings.pms_provider ?? 'your management system' }}.</span>
                Availability and rates come across automatically<template v-if="settings.last_sync_at">, last
                {{ describeAge(settings.last_sync_at) }}</template>.
                Use the padlock on a row to keep a value as you set it.
                <span v-if="settings.last_sync_status === 'partial'" class="mt-1 block text-gold-dark">
                    {{ settings.last_sync_message }}
                </span>
            </div>

            <!-- ----------------------------------------------- filters -->
            <div class="flex flex-wrap items-center gap-2">
                <div class="flex flex-wrap gap-1.5" role="group" aria-label="Which suites to show">
                    <button
                        v-for="s in scopes"
                        :key="s.key"
                        type="button"
                        class="tap-safe rounded-lg border px-3 py-2 text-[13px] transition-colors"
                        :class="scope === s.key
                            ? 'border-brand-dark bg-brand-dark font-semibold text-white'
                            : 'border-hairline bg-white text-ink-mid hover:bg-warm'"
                        :aria-pressed="String(scope === s.key)"
                        @click="scope = s.key"
                    >
                        {{ s.label }}
                        <span class="tabular-nums" :class="scope === s.key ? 'text-white/75' : 'text-ink-light'">{{ s.count }}</span>
                    </button>
                </div>

                <div class="ml-auto min-w-[180px] flex-1 sm:max-w-[260px]">
                    <label class="sr-only" for="roster-q">Find a suite</label>
                    <input
                        id="roster-q"
                        v-model="q"
                        type="search"
                        placeholder="Find a suite or layout"
                        class="tap-safe w-full rounded-[10px] border-[1.5px] border-hairline px-3 py-2 text-[13.5px] text-ink outline-none transition focus:border-brand focus:ring-[3px] focus:ring-brand-light"
                    />
                </div>
            </div>

            <!-- --------------------------------------------- bulk bar -->
            <div
                v-if="selected.size"
                class="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-[12px] border border-brand-mid bg-brand-light px-3 py-2.5"
            >
                <span class="text-[13.5px] font-semibold text-brand-dark">
                    {{ selected.size }} selected
                </span>
                <label class="sr-only" for="bulk-status">Set all selected suites to</label>
                <select
                    id="bulk-status"
                    class="tap-safe rounded-[10px] border-[1.5px] border-hairline bg-white px-2.5 py-2 text-[13.5px]"
                    :disabled="busy === 'bulk.status'"
                    @change="bulkStatus($event.target.value); $event.target.selectedIndex = 0"
                >
                    <option value="">Set all to…</option>
                    <option v-for="k in STATUS_ORDER" :key="k" :value="k">{{ STATUSES[k].label }}</option>
                </select>
                <button
                    type="button"
                    class="tap-safe ml-auto text-[13px] font-semibold text-ink-mid underline hover:text-ink"
                    @click="selected = new Set()"
                >Clear selection</button>
            </div>

            <!-- ---------------------------------------------- the roster -->
            <div class="flex items-center justify-between gap-3">
                <label class="flex cursor-pointer items-center gap-2 text-[13px] text-ink-mid">
                    <input
                        type="checkbox"
                        class="size-4 rounded accent-[var(--color-brand)]"
                        :checked="allVisibleSelected"
                        :disabled="!visible.length"
                        @change="toggleSelectAll"
                    />
                    Select all shown
                </label>
                <span class="text-[12.5px] text-ink-light">
                    Showing {{ visible.length }} of {{ units.length }}
                </span>
            </div>

            <p v-if="!visible.length && scope === 'attention'" class="rounded-[12px] border border-hairline bg-forest-light/40 px-4 py-6 text-center text-[14px] text-forest">
                Nothing needs your attention. Every bookable suite has been confirmed inside the last {{ freshness.days }} days.
            </p>
            <p v-else-if="!visible.length" class="rounded-[12px] border border-dashed border-hairline px-4 py-6 text-center text-[13.5px] text-ink-mid">
                No suites match that search.
            </p>

            <!--
              Column headers, desktop only. The rows are a responsive grid
              rather than a table (they restack on a phone), so the headings
              are presentational and every control keeps its own sr-only label
              — a screen reader hears "Availability for suite 204", not a
              column position it has to remember.
            -->
            <div
                v-if="visible.length"
                aria-hidden="true"
                class="hidden px-3 text-[11px] font-bold uppercase tracking-[1.1px] text-ink-light md:grid md:items-end md:gap-x-3"
                :class="map.pricingPublic
                    ? 'md:grid-cols-[auto_minmax(150px,1.3fr)_minmax(150px,1fr)_minmax(130px,0.9fr)_auto]'
                    : 'md:grid-cols-[auto_minmax(150px,1.3fr)_minmax(150px,1fr)_auto]'"
            >
                <span class="w-5"></span>
                <span>Suite</span>
                <span>Availability</span>
                <span v-if="map.pricingPublic">Rate / month</span>
                <span class="text-right">Last confirmed</span>
            </div>

            <ul v-if="visible.length" class="space-y-2">
                <UnitRow
                    v-for="u in visible"
                    :key="u.id"
                    :unit="u"
                    :selected="selected.has(u.id)"
                    :freshness-days="freshness.days"
                    :pricing-public="map.pricingPublic"
                    :synced="synced"
                    :saving="savingIds.has(u.id)"
                    :saved-at="savedAt[u.id] ?? 0"
                    @change="onUnitChange"
                    @toggle-select="toggleSelect"
                    @toggle-lock="onToggleLock"
                />
            </ul>
        </template>
    </section>
</template>
