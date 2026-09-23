<script setup>
/*
 | The hatch patterns, defined once for the whole document.
 |
 | SVG `url(#id)` references resolve document-wide, not per-<svg>, so these
 | live in one hidden svg at the root of the map rather than inside the canvas.
 | That matters because the legend, the unit cards and the compare table all
 | paint the same swatches, and in list mode the canvas is not rendered at all
 | — if the patterns lived there, every swatch on the page would go blank.
 |
 | Mount exactly once per page. CommunityMap.vue does this for you.
 */
</script>

<template>
    <svg aria-hidden="true" focusable="false" class="absolute h-0 w-0 overflow-hidden" style="position:absolute">
        <defs>
            <!-- Rising diagonal, densest of the set: available, the state we most want to read at a glance. -->
            <pattern id="hatch-available" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="8" height="8" fill="var(--color-status-available-fill)" />
                <line x1="0" y1="0" x2="0" y2="8" stroke="var(--color-status-available)" stroke-width="2.4" opacity="0.5" />
            </pattern>

            <!-- Falling diagonal: mirrors "available" so the two are separable by direction alone. -->
            <pattern id="hatch-coming_available" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
                <rect width="9" height="9" fill="var(--color-status-coming-fill)" />
                <line x1="0" y1="0" x2="0" y2="9" stroke="var(--color-status-coming)" stroke-width="2.2" opacity="0.5" />
            </pattern>

            <!-- Dots: no lines at all, unmistakable next to either diagonal. -->
            <pattern id="hatch-waitlist" width="10" height="10" patternUnits="userSpaceOnUse">
                <rect width="10" height="10" fill="var(--color-status-waitlist-fill)" />
                <circle cx="5" cy="5" r="1.7" fill="var(--color-status-waitlist)" opacity="0.55" />
            </pattern>

            <!-- Horizontal rules: reads as "temporary", and is axis-distinct from the diagonals. -->
            <pattern id="hatch-respite" width="10" height="10" patternUnits="userSpaceOnUse">
                <rect width="10" height="10" fill="var(--color-status-respite-fill)" />
                <line x1="0" y1="5" x2="10" y2="5" stroke="var(--color-status-respite)" stroke-width="2" opacity="0.45" />
            </pattern>

            <!-- Paired thick/thin diagonal: same angle as available, different rhythm. -->
            <pattern id="hatch-held" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="9" height="9" fill="var(--color-status-held-fill)" />
                <line x1="0" y1="0" x2="0" y2="9" stroke="var(--color-status-held)" stroke-width="1.6" opacity="0.5" />
                <line x1="4.5" y1="0" x2="4.5" y2="9" stroke="var(--color-status-held)" stroke-width="0.8" opacity="0.35" />
            </pattern>

            <!-- Lattice: the only closed shape in the set. -->
            <pattern id="hatch-model" width="11" height="11" patternUnits="userSpaceOnUse" patternTransform="rotate(30)">
                <rect width="11" height="11" fill="var(--color-status-model-fill)" />
                <path d="M0 5.5 L5.5 0 L11 5.5 L5.5 11 Z" fill="none" stroke="var(--color-status-model)" stroke-width="1.3" opacity="0.45" />
            </pattern>

            <!-- Occupied has no hatch on purpose: flat and quiet, so it recedes. -->
        </defs>
    </svg>
</template>
