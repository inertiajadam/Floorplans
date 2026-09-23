/*
 | Polygon maths for unit shapes.
 |
 | A unit's shape is stored as a flat array of numbers — [x1,y1,x2,y2,...] — in
 | the coordinate space of its level's plan image. Flat arrays rather than
 | objects because a campus can carry a few thousand points and this form is
 | half the JSON and noticeably cheaper to hand to an SVG `points` attribute.
 |
 | Everything here is pure and allocation-light: it runs on every pan frame.
 */

/** Bounding box of a flat point array. */
export function bounds(points) {
    if (!points || points.length < 2) return { x: 0, y: 0, width: 0, height: 0 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < points.length; i += 2) {
        const x = points[i], y = points[i + 1];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Union of several boxes — used to fit the view to a filtered set of units. */
export function unionBounds(boxes) {
    const real = boxes.filter((b) => b && b.width >= 0 && b.height >= 0 && Number.isFinite(b.x));
    if (!real.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const b of real) {
        if (b.x < minX) minX = b.x;
        if (b.y < minY) minY = b.y;
        if (b.x + b.width > maxX) maxX = b.x + b.width;
        if (b.y + b.height > maxY) maxY = b.y + b.height;
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Area-weighted centroid. Labels and the "fly to this unit" animation anchor
 * here rather than at the bbox centre, which drifts outside L-shaped suites.
 */
export function centroid(points) {
    if (!points || points.length < 6) {
        const b = bounds(points);
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }
    let area = 0, cx = 0, cy = 0;
    const n = points.length / 2;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const x0 = points[i * 2], y0 = points[i * 2 + 1];
        const x1 = points[j * 2], y1 = points[j * 2 + 1];
        const cross = x0 * y1 - x1 * y0;
        area += cross;
        cx += (x0 + x1) * cross;
        cy += (y0 + y1) * cross;
    }
    area *= 0.5;
    if (Math.abs(area) < 1e-9) {
        const b = bounds(points);
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }
    return { x: cx / (6 * area), y: cy / (6 * area) };
}

export function area(points) {
    if (!points || points.length < 6) return 0;
    let a = 0;
    const n = points.length / 2;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        a += points[i * 2] * points[j * 2 + 1] - points[j * 2] * points[i * 2 + 1];
    }
    return Math.abs(a / 2);
}

/** Even-odd ray cast. Used by the tracing editor, not by the map (SVG hit-tests itself). */
export function contains(points, x, y) {
    let inside = false;
    const n = points.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = points[i * 2], yi = points[i * 2 + 1];
        const xj = points[j * 2], yj = points[j * 2 + 1];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

/** Flat array -> the string an SVG <polygon points> wants. */
export function toPointsAttr(points) {
    if (!points || points.length < 2) return '';
    const out = new Array(points.length / 2);
    for (let i = 0; i < points.length; i += 2) out[i / 2] = `${round(points[i])},${round(points[i + 1])}`;
    return out.join(' ');
}

/**
 * Inset a polygon toward its centroid. Selected units draw a second, inner
 * outline; insetting it stops the two strokes fusing into one thick line at
 * low zoom.
 */
export function inset(points, amount) {
    const c = centroid(points);
    const out = new Array(points.length);
    for (let i = 0; i < points.length; i += 2) {
        const dx = points[i] - c.x;
        const dy = points[i + 1] - c.y;
        const len = Math.hypot(dx, dy) || 1;
        const k = Math.max(0, len - amount) / len;
        out[i] = c.x + dx * k;
        out[i + 1] = c.y + dy * k;
    }
    return out;
}

/** Pad a box by a ratio of its own size, with a floor so tiny boxes still breathe. */
export function padBox(box, ratio = 0.12, min = 24) {
    const px = Math.max(box.width * ratio, min);
    const py = Math.max(box.height * ratio, min);
    return { x: box.x - px, y: box.y - py, width: box.width + px * 2, height: box.height + py * 2 };
}

export function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function round(n) {
    return Math.round(n * 100) / 100;
}
