/*
 | Pan and zoom over an SVG viewBox.
 |
 | The map is a single <svg> whose viewBox we move, rather than a CSS transform
 | on a container. That choice buys three things that matter here:
 |
 |   - strokes stay crisp at every zoom level, so a 1px wall is a 1px wall
 |   - the browser hit-tests the polygons for us, so an L-shaped suite has an
 |     L-shaped click target rather than a rectangular one
 |   - screen readers keep seeing a normal DOM tree, unaffected by the transform
 |
 | Everything is driven off one reactive `view` box. Gestures, the keyboard and
 | the fly-to animation all write to the same four numbers, which is why they
 | compose rather than fight.
 */

import { ref, shallowRef, computed, onBeforeUnmount } from 'vue';
import { clamp, padBox } from '../lib/geometry.js';

const prefersReducedMotion = () =>
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function useMapView({ minZoom = 1, maxZoom = 9 } = {}) {
    /* The world we are looking at — set by setExtent() when a level loads. */
    const extent = shallowRef({ x: 0, y: 0, width: 1000, height: 700 });
    const view = ref({ x: 0, y: 0, width: 1000, height: 700 });
    const svgEl = shallowRef(null);
    const isPanning = ref(false);

    let raf = null;
    const pointers = new Map();
    let pinchStart = null;

    const zoom = computed(() => (extent.value.width || 1) / (view.value.width || 1));
    const canZoomIn = computed(() => zoom.value < maxZoom - 0.001);
    const canZoomOut = computed(() => zoom.value > minZoom + 0.001);

    const viewBox = computed(() => {
        const v = view.value;
        return `${r(v.x)} ${r(v.y)} ${r(v.width)} ${r(v.height)}`;
    });

    /** Scale factor for things that must keep a constant on-screen size. */
    const inverseScale = computed(() => view.value.width / (extent.value.width || 1));

    function setExtent(box, { reset = true } = {}) {
        const padded = padBox(box, 0.04, 8);
        extent.value = padded;
        if (reset) {
            cancel();
            view.value = { ...padded };
        }
    }

    /** Never let the view leave the world or shrink past maxZoom. */
    function constrain(next) {
        const e = extent.value;
        const minW = e.width / maxZoom;
        const maxW = e.width;
        /* Take the aspect from the box being proposed, not from the current
           view. Reading it from the current view silently discards any change
           to height, which is exactly what setAspect() is trying to make when
           the container is resized. */
        const aspect = (next.height || view.value.height || 1) / (next.width || view.value.width || 1);

        const width = clamp(next.width, minW, maxW);
        const height = width * aspect;

        /* When the view is wider than the world, centre rather than clamp —
           clamping would pin a small floor plan to the left edge. */
        const x = width >= e.width
            ? e.x + (e.width - width) / 2
            : clamp(next.x, e.x, e.x + e.width - width);
        const y = height >= e.height
            ? e.y + (e.height - height) / 2
            : clamp(next.y, e.y, e.y + e.height - height);

        return { x, y, width, height };
    }

    function setAspect(ratio) {
        const v = view.value;
        view.value = constrain({ ...v, height: v.width * ratio });
    }

    /* ------------------------------------------------------------- zooming */

    /**
     * Zoom by `factor`, keeping the world point under `anchor` (in client
     * coordinates) pinned to the same pixel. This is what makes wheel-zoom and
     * pinch feel like they are grabbing the map rather than the screen.
     */
    function zoomBy(factor, anchor = null) {
        cancel();
        const v = view.value;
        const world = anchor ? toWorld(anchor.x, anchor.y) : { x: v.x + v.width / 2, y: v.y + v.height / 2 };

        const width = v.width / factor;
        const height = v.height / factor;
        const kx = (world.x - v.x) / (v.width || 1);
        const ky = (world.y - v.y) / (v.height || 1);

        view.value = constrain({ x: world.x - width * kx, y: world.y - height * ky, width, height });
    }

    const zoomIn = () => zoomBy(1.45);
    const zoomOut = () => zoomBy(1 / 1.45);

    function reset() {
        cancel();
        view.value = { ...constrain({ ...extent.value, height: view.value.height / view.value.width * extent.value.width }) };
    }

    /* -------------------------------------------------------------- panning */

    /** Pan by a fraction of the current view — keyboard arrows and the nudge buttons. */
    function panBy(fx, fy) {
        cancel();
        const v = view.value;
        view.value = constrain({ ...v, x: v.x + v.width * fx, y: v.y + v.height * fy });
    }

    function toWorld(clientX, clientY) {
        const el = svgEl.value;
        const v = view.value;
        if (!el) return { x: v.x, y: v.y };
        const rect = el.getBoundingClientRect();
        if (!rect.width || !rect.height) return { x: v.x, y: v.y };
        return {
            x: v.x + ((clientX - rect.left) / rect.width) * v.width,
            y: v.y + ((clientY - rect.top) / rect.height) * v.height,
        };
    }

    /* ------------------------------------------------------------- gestures */

    function onPointerDown(e) {
        /* Let clicks on a unit through; only blank canvas starts a pan. */
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), width: view.value.width };
            isPanning.value = false;
            return;
        }
        if (pointers.size === 1) {
            isPanning.value = true;
            cancel();
            e.currentTarget.setPointerCapture?.(e.pointerId);
        }
    }

    function onPointerMove(e) {
        const prev = pointers.get(e.pointerId);
        if (!prev) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (pointers.size === 2 && pinchStart) {
            const [a, b] = [...pointers.values()];
            const dist = Math.hypot(a.x - b.x, a.y - b.y);
            if (dist > 4) {
                const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
                const target = pinchStart.width * (pinchStart.dist / dist);
                zoomBy(view.value.width / target, mid);
            }
            return;
        }

        if (!isPanning.value) return;
        const el = svgEl.value;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const v = view.value;
        const dx = ((e.clientX - prev.x) / rect.width) * v.width;
        const dy = ((e.clientY - prev.y) / rect.height) * v.height;
        view.value = constrain({ ...v, x: v.x - dx, y: v.y - dy });
    }

    function onPointerUp(e) {
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinchStart = null;
        if (pointers.size === 0) isPanning.value = false;
    }

    /**
     * Wheel zooms; trackpad two-finger scroll pans. We distinguish them the way
     * map libraries do: ctrlKey is set by the browser for pinch-zoom gestures,
     * and a large deltaY with no deltaX is almost always a real mouse wheel.
     */
    function onWheel(e) {
        e.preventDefault();
        if (e.ctrlKey || Math.abs(e.deltaX) < 1) {
            const factor = Math.exp(-e.deltaY * 0.0022);
            zoomBy(factor, { x: e.clientX, y: e.clientY });
        } else {
            const v = view.value;
            const el = svgEl.value;
            const rect = el?.getBoundingClientRect();
            if (!rect) return;
            view.value = constrain({
                ...v,
                x: v.x + (e.deltaX / rect.width) * v.width,
                y: v.y + (e.deltaY / rect.height) * v.height,
            });
        }
    }

    /* ------------------------------------------------------------- fly to */

    function cancel() {
        if (raf) cancelAnimationFrame(raf);
        raf = null;
    }

    /**
     * Ease the view onto a box. Used when a unit is picked from the list, so
     * the map does not teleport and lose the family's sense of where they are.
     * Honours prefers-reduced-motion by jumping instead.
     */
    function flyTo(box, { padding = 0.5, duration = 420 } = {}) {
        cancel();
        const aspect = (view.value.height || 1) / (view.value.width || 1);
        const padded = padBox(box, padding, 40);

        /* Grow the box to the view's aspect ratio so nothing is cropped. */
        let width = padded.width;
        let height = padded.height;
        if (height / width > aspect) width = height / aspect;
        else height = width * aspect;

        const target = constrain({
            x: padded.x + padded.width / 2 - width / 2,
            y: padded.y + padded.height / 2 - height / 2,
            width,
            height,
        });

        if (prefersReducedMotion() || duration <= 0) {
            view.value = target;
            return;
        }

        const from = { ...view.value };
        const start = performance.now();
        const step = (now) => {
            const t = Math.min(1, (now - start) / duration);
            const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;  // easeInOutCubic
            view.value = {
                x: from.x + (target.x - from.x) * e,
                y: from.y + (target.y - from.y) * e,
                width: from.width + (target.width - from.width) * e,
                height: from.height + (target.height - from.height) * e,
            };
            raf = t < 1 ? requestAnimationFrame(step) : null;
        };
        raf = requestAnimationFrame(step);
    }

    onBeforeUnmount(cancel);

    return {
        svgEl, view, viewBox, extent, zoom, inverseScale, isPanning,
        canZoomIn, canZoomOut,
        setExtent, setAspect, zoomIn, zoomOut, zoomBy, panBy, reset, flyTo, toWorld,
        handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onWheel },
    };
}

function r(n) {
    return Math.round(n * 10) / 10;
}
