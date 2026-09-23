/*
 | Public entry point.
 |
 | Host apps import from here, never from a deep path — it keeps the internal
 | file layout free to change. See docs/INTEGRATION.md.
 */

export { default as CommunityMap } from './components/CommunityMap.vue';

/* Sub-components, exported for hosts that want to compose their own layout
   (a bare map on a listing page, a standalone compare view, and so on). */
export { default as MapCanvas } from './components/MapCanvas.vue';
export { default as MapPatterns } from './components/MapPatterns.vue';
export { default as MapLegend } from './components/MapLegend.vue';
export { default as LevelSwitcher } from './components/LevelSwitcher.vue';
export { default as FilterBar } from './components/FilterBar.vue';
export { default as UnitCard } from './components/UnitCard.vue';
export { default as UnitDetail } from './components/UnitDetail.vue';
export { default as PricingPanel } from './components/PricingPanel.vue';
export { default as CompareTray } from './components/CompareTray.vue';
export { default as LeadForm } from './components/LeadForm.vue';
export { default as StatusPill } from './components/StatusPill.vue';

export { normalize, summarize, CARE_LEVELS, careLevel } from './lib/model.js';
export { quote, headline, money, tiersFor } from './lib/pricing.js';
export * as availability from './lib/availability.js';
export * as geometry from './lib/geometry.js';

export { useMapView } from './composables/useMapView.js';
export { useUnitFilters } from './composables/useUnitFilters.js';
export { useCompare } from './composables/useCompare.js';
export { useAnnouncer } from './composables/useAnnouncer.js';
