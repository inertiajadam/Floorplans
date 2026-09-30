<script setup>
/*
 | The 3D floor plan, full screen.
 |
 | Two ways of looking at a suite, and a way to move between them:
 |
 |   Whole suite   the dollhouse: the model from above at an angle, walls
 |                 cut at ceiling height so every room is visible at once.
 |                 Orbit, zoom, tap a room.
 |   Step inside   standing in a room at eye height, turning to look. The
 |                 doorways are buttons: tap one to walk through.
 |
 | The camera glides between poses so a visitor never loses their bearings
 | — a hard cut from above to inside is disorienting — unless they have
 | asked for reduced motion, in which case it just goes.
 |
 | Everything is a real control: the rooms are buttons, the doorways are
 | buttons, Escape closes, Tab stays inside. The canvas is for looking;
 | nothing depends on being able to drag it.
 |
 | Loaded on demand (three.js is 600 kB) — the map never pays for it until
 | someone opens a suite in 3D.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildPlan, EYE_HEIGHT } from './planScene.js';
import { activeElementDeep, trapTab } from '../lib/dom.js';

const props = defineProps({
    plan:     { type: Object, required: true },
    title:    { type: String, default: 'Floor plan' },
    subtitle: { type: String, default: '' },
    /** The 2D drawing, shown when WebGL is not available. */
    image:    { type: String, default: null },
    /** The furnished render of this layout, when the community has one. */
    render:   { type: String, default: null },
});
const emit = defineEmits(['close']);

const panel = ref(null);
const stage = ref(null);
const closeBtn = ref(null);
const mode = ref('dollhouse');          // 'dollhouse' | 'inside' | 'furnished'
const roomIndex = ref(null);
const hoverRoom = ref(null);
const hotspots = ref([]);
const failed = ref(false);
const moving = ref(false);

const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/* three.js state lives outside Vue's reactivity on purpose: proxying a
   scene graph is slow and pointless. */
let renderer = null;
let scene = null;
let camera = null;
let controls = null;
let built = null;
let raf = 0;
let resizeObserver = null;
let tween = null;
let restoreTo = null;
const look = { yaw: 0, pitch: 0 };
const drag = { on: false, x: 0, y: 0, moved: false };
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const tmp = new THREE.Vector3();

/* The scene graph is not reactive; the room list is the one thing the
   template needs from it, copied out once the model is built. */
const roomList = ref([]);
/* Under this size a "room" is a closet: shown in the model, never stood in. */
const CLOSET_SQFT = 35;
const isCloset = (index) => built.rooms[index].sqft < CLOSET_SQFT;

function listRooms() {
    const names = props.plan.roomNames ?? {};
    roomList.value = [...built.rooms]
        .filter((r) => r.sqft >= CLOSET_SQFT)
        .sort((a, b) => b.sqft - a.sqft)
        .map((r, i) => ({ index: r.index, label: names[r.id] ?? `Room ${i + 1}`, sqft: r.sqft }));
}
const roomLabel = (index) => roomList.value.find((r) => r.index === index)?.label ?? 'this room';

/* ------------------------------------------------------------------ setup */

/* Escape closes from anywhere: a doorway button disappears the moment it
   is used, which drops focus to the page, and the dialog's own key handler
   would no longer hear the key. */
function onDocumentKeydown(e) {
    if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); emit('close'); }
}

onMounted(() => {
    restoreTo = activeElementDeep(panel.value?.getRootNode?.() ?? document);
    closeBtn.value?.focus();
    document.addEventListener('keydown', onDocumentKeydown);

    try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch {
        failed.value = true;
        return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = 'tour-canvas';
    renderer.domElement.setAttribute('aria-hidden', 'true');

    scene = new THREE.Scene();
    built = buildPlan(props.plan);
    scene.add(built.group);
    listRooms();

    /* Warm, even light: this is a home, not a showroom. The hemisphere does
       most of the work so rooms without a window still read as bright. */
    scene.add(new THREE.HemisphereLight(0xfff7ec, 0xe9e2d6, 1.7));
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.1);
    sun.position.set(6, 12, 5);
    scene.add(sun);

    camera = new THREE.PerspectiveCamera(50, 1, 0.05, 200);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.47;   // never below the floor
    controls.minDistance = 2.5;
    controls.maxDistance = 60;
    controls.screenSpacePanning = false;

    stage.value.appendChild(renderer.domElement);
    resize();
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(stage.value);

    const el = renderer.domElement;
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
    el.addEventListener('click', onCanvasClick);

    const pose = dollhousePose();
    camera.position.copy(pose.position);
    camera.lookAt(pose.target);
    controls.target.copy(pose.target);
    controls.update();

    raf = requestAnimationFrame(loop);
});

onBeforeUnmount(() => {
    document.removeEventListener('keydown', onDocumentKeydown);
    cancelAnimationFrame(raf);
    resizeObserver?.disconnect();
    controls?.dispose();
    built?.dispose();
    renderer?.dispose();
    renderer?.domElement?.remove();
    if (restoreTo?.isConnected) restoreTo.focus?.();
});

function resize() {
    if (!renderer || !stage.value) return;
    const w = stage.value.clientWidth || 1;
    const h = stage.value.clientHeight || 1;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
}

function loop(now) {
    raf = requestAnimationFrame(loop);
    if (tween) stepTween(now);
    else if (mode.value === 'dollhouse') controls.update();
    if (mode.value === 'inside' && !tween) updateHotspots();
    renderer.render(scene, camera);
}

/* ------------------------------------------------------------------ poses */

function dollhousePose() {
    const center = built.bounds.getCenter(new THREE.Vector3());
    const size = built.bounds.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.z);
    /* From the front-right, high enough to see into every room. */
    return {
        position: new THREE.Vector3(center.x + span * 0.35, span * 0.95, center.z + span * 0.85),
        target: new THREE.Vector3(center.x, 0.4, center.z),
    };
}

function roomPose(index, facingFrom = null) {
    const room = built.rooms[index];
    const position = room.center.clone().setY(EYE_HEIGHT);
    /* Look back the way you came, or at the room's main doorway, or across
       the suite — whichever exists, in that order. */
    let target;
    if (facingFrom) {
        target = position.clone().add(position.clone().sub(facingFrom).setY(0).normalize());
    } else if (room.doors.length) {
        target = built.doors[room.doors[0]].position.clone().setY(EYE_HEIGHT);
    } else {
        target = built.bounds.getCenter(new THREE.Vector3()).setY(EYE_HEIGHT);
    }
    if (target.distanceTo(position) < 0.01) target = position.clone().add(new THREE.Vector3(1, 0, 0));
    return { position, target };
}

function flyTo({ position, target }, ms, onArrive) {
    const probe = camera.clone();
    probe.position.copy(position);
    probe.lookAt(target);
    tween = {
        from: { p: camera.position.clone(), q: camera.quaternion.clone() },
        to: { p: position.clone(), q: probe.quaternion.clone() },
        start: performance.now(),
        ms: reducedMotion ? 0 : ms,
        onArrive,
    };
    moving.value = true;
}

function stepTween(now) {
    const t = tween.ms === 0 ? 1 : Math.min(1, (now - tween.start) / tween.ms);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    camera.position.lerpVectors(tween.from.p, tween.to.p, e);
    camera.quaternion.slerpQuaternions(tween.from.q, tween.to.q, e);
    if (t >= 1) {
        const done = tween.onArrive;
        tween = null;
        moving.value = false;
        done?.();
    }
}

/* -------------------------------------------------------------- the modes */

function enterRoom(index, from = null) {
    if (!built || index == null || isCloset(index)) return;
    const wasFurnished = mode.value === 'furnished';
    const was = wasFurnished ? null : roomIndex.value;
    roomIndex.value = index;
    mode.value = 'inside';
    controls.enabled = false;
    setCeilings(true);
    const origin = from ?? (was != null ? built.rooms[was].center.clone().setY(EYE_HEIGHT) : null);
    setFov(68);   // a natural standing view; the dollhouse uses a longer lens
    flyTo(roomPose(index, origin), 900, () => {
        const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
        look.yaw = e.y;
        look.pitch = e.x;
    });
    hotspots.value = [];
}

/* The furnished render, over the model: what the room looks like lived in.
   The model keeps rendering underneath so switching back is instant. */
function showFurnished() {
    mode.value = 'furnished';
    hotspots.value = [];
    if (controls) controls.enabled = false;
}

function showDollhouse() {
    if (!built) return;
    if (mode.value === 'furnished') {
        mode.value = 'dollhouse';
        controls.enabled = true;
        return;
    }
    mode.value = 'dollhouse';
    hotspots.value = [];
    setFov(50);
    const pose = dollhousePose();
    flyTo(pose, 800, () => {
        setCeilings(false);
        controls.target.copy(pose.target);
        controls.enabled = true;
        controls.update();
    });
}

function walkThrough(door) {
    const to = door.rooms.find((r) => r !== roomIndex.value);
    panel.value?.focus();   // the button being used is about to go away
    if (to == null) { showDollhouse(); return; }
    enterRoom(to, camera.position.clone());
}

function stepRoom(delta) {
    const list = roomList.value;
    if (!list.length) return;
    const at = list.findIndex((r) => r.index === roomIndex.value);
    const next = list[(at + delta + list.length) % list.length];
    enterRoom(next.index);
}

function setFov(deg) {
    camera.fov = deg;
    camera.updateProjectionMatrix();
}

function setCeilings(visible) {
    for (const r of built.rooms) for (const m of r.ceilings) m.visible = visible;
}

/* --------------------------------------------------------------- pointing */

function pointTo(e) {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
}

function floorUnder(e) {
    pointTo(e);
    const floors = built.rooms.flatMap((r) => r.floors);
    const hit = raycaster.intersectObjects(floors, false)[0];
    const room = hit ? hit.object.userData.room : null;
    return room != null && isCloset(room) ? null : room;
}

function onPointerMove(e) {
    if (mode.value === 'dollhouse') {
        if (drag.on) return;
        const r = floorUnder(e);
        if (r !== hoverRoom.value) {
            hoverRoom.value = r;
            for (const room of built.rooms) {
                for (const m of room.floors) m.material.color.set(room.index === r ? '#f9f5ea' : '#ebe6dc');
            }
            renderer.domElement.style.cursor = r == null ? 'grab' : 'pointer';
        }
        return;
    }
    if (!drag.on || tween) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    drag.x = e.clientX;
    drag.y = e.clientY;
    turn(dx * 0.0045, dy * 0.0045);
}

function turn(dyaw, dpitch) {
    look.yaw -= dyaw;
    look.pitch = THREE.MathUtils.clamp(look.pitch - dpitch, -Math.PI * 0.42, Math.PI * 0.42);
    camera.rotation.set(look.pitch, look.yaw, 0, 'YXZ');
}

function onPointerDown(e) {
    drag.on = true;
    drag.moved = false;
    drag.x = e.clientX;
    drag.y = e.clientY;
    renderer.domElement.setPointerCapture?.(e.pointerId);
}
function onPointerUp() { drag.on = false; }

function onCanvasClick(e) {
    if (drag.moved || tween) return;
    if (mode.value === 'dollhouse') {
        const r = floorUnder(e);
        if (r != null) enterRoom(r);
    }
}

/* Doorways of the room you are in, as buttons laid over the canvas. */
function updateHotspots() {
    const room = built.rooms[roomIndex.value];
    if (!room) { hotspots.value = []; return; }
    const w = renderer.domElement.clientWidth;
    const h = renderer.domElement.clientHeight;
    const out = [];
    for (const di of room.doors) {
        const door = built.doors[di];
        tmp.copy(door.position).project(camera);
        if (tmp.z > 1 || Math.abs(tmp.x) > 1.05 || Math.abs(tmp.y) > 1.05) continue;
        const other = door.rooms.find((r) => r !== roomIndex.value);
        if (other != null && isCloset(other)) continue;   // a closet door is not a way onward
        /* Kept a little inside the edges so a doorway just out of frame
           still offers its button whole. */
        out.push({
            key: di,
            x: THREE.MathUtils.clamp(((tmp.x + 1) / 2) * w, w * 0.08, w * 0.92),
            y: THREE.MathUtils.clamp(((1 - tmp.y) / 2) * h, h * 0.1, h * 0.88),
            label: other == null ? 'Out the front door' : `Into ${roomLabel(other)}`,
            door,
        });
    }
    hotspots.value = out;
}

/* --------------------------------------------------------------- keyboard */

function onKeydown(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); emit('close'); return; }
    if (mode.value === 'inside' && !tween && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)
        && !(e.target instanceof HTMLButtonElement && e.target.classList.contains('tour-room'))) {
        e.preventDefault();
        const step = 0.12;
        if (e.key === 'ArrowLeft') turn(-step, 0);
        if (e.key === 'ArrowRight') turn(step, 0);
        if (e.key === 'ArrowUp') turn(0, -step * 0.6);
        if (e.key === 'ArrowDown') turn(0, step * 0.6);
        return;
    }
    trapTab(e, panel.value);
}
</script>

<template>
    <div
        ref="panel"
        class="tour"
        role="dialog"
        aria-modal="true"
        :aria-label="`3D floor plan: ${title}`"
        tabindex="-1"
        @keydown="onKeydown"
    >
        <header class="tour-bar">
            <div class="min-w-0">
                <h2 class="truncate font-serif text-[19px] font-bold leading-tight text-ink">{{ title }}</h2>
                <p v-if="subtitle" class="truncate text-[13px] text-ink-mid">{{ subtitle }}</p>
            </div>

            <div v-if="!failed" class="tour-modes" role="group" aria-label="How to look">
                <button
                    type="button"
                    class="tap-safe"
                    :class="{ 'is-on': mode === 'dollhouse' }"
                    :aria-pressed="String(mode === 'dollhouse')"
                    @click="showDollhouse()"
                >Whole suite</button>
                <button
                    type="button"
                    class="tap-safe"
                    :class="{ 'is-on': mode === 'inside' }"
                    :aria-pressed="String(mode === 'inside')"
                    @click="enterRoom(roomIndex ?? roomList[0]?.index)"
                >Step inside</button>
                <button
                    v-if="render"
                    type="button"
                    class="tap-safe"
                    :class="{ 'is-on': mode === 'furnished' }"
                    :aria-pressed="String(mode === 'furnished')"
                    @click="showFurnished()"
                >Furnished</button>
            </div>

            <button ref="closeBtn" type="button" class="tour-close tap-safe" @click="emit('close')">
                <span aria-hidden="true">×</span><span class="sr-only">Close the 3D floor plan</span>
            </button>
        </header>

        <div ref="stage" class="tour-stage">
            <div v-if="failed" class="tour-fallback">
                <p>This browser can't draw the 3D view, so here is the plan.</p>
                <img v-if="image" :src="image" :alt="`Floor plan, ${title}`" />
            </div>

            <template v-else>
                <figure v-if="mode === 'furnished'" class="tour-furnished">
                    <img :src="render" :alt="`Furnished 3D plan of ${title}`" decoding="async" />
                    <figcaption>A furnished view of this layout. Your suite's furniture and finishes may differ.</figcaption>
                </figure>

                <button
                    v-for="h in hotspots"
                    :key="h.key"
                    type="button"
                    class="tour-hotspot tap-safe"
                    :style="{ left: `${h.x}px`, top: `${h.y}px` }"
                    @click="walkThrough(h.door)"
                >{{ h.label }}</button>

                <p v-if="mode !== 'furnished'" class="tour-hint" aria-hidden="true">
                    <template v-if="mode === 'dollhouse'">Drag to turn · scroll to zoom · tap a room to step inside</template>
                    <template v-else>Drag or use the arrow keys to look around · tap a doorway to walk through</template>
                </p>
            </template>
        </div>

        <footer v-if="!failed" class="tour-rooms">
            <div class="tour-rooms-row">
                <span class="tour-rooms-label">Rooms</span>
                <button
                    v-for="r in roomList"
                    :key="r.index"
                    type="button"
                    class="tour-room tap-safe"
                    :class="{ 'is-on': mode === 'inside' && r.index === roomIndex }"
                    :aria-pressed="String(mode === 'inside' && r.index === roomIndex)"
                    @click="enterRoom(r.index)"
                >
                    {{ r.label }}
                    <span class="tour-room-size">{{ Math.round(r.sqft) }} sq ft</span>
                </button>
                <div v-if="mode === 'inside'" class="tour-step" role="group" aria-label="Next or previous room">
                    <button type="button" class="tap-safe" @click="stepRoom(-1)"><span aria-hidden="true">‹</span><span class="sr-only">Previous room</span></button>
                    <button type="button" class="tap-safe" @click="stepRoom(1)"><span aria-hidden="true">›</span><span class="sr-only">Next room</span></button>
                </div>
            </div>
            <p class="tour-note">Drawn from the suite's real walls, doors and windows. Furniture and finishes vary — see the photos.</p>
        </footer>
    </div>
</template>

<style scoped>
.tour { outline: none; }
.tour {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: flex;
    flex-direction: column;
    background: var(--color-warm);
    color: var(--color-ink);
    font-family: var(--font-sans);
}
.tour-bar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    background: #fff;
    border-bottom: 1px solid var(--color-hairline);
}
.tour-bar > .min-w-0 { flex: 1 1 auto; }
.tour-modes {
    display: flex;
    gap: 2px;
    padding: 3px;
    background: var(--color-warm);
    border-radius: var(--radius-brand);
}
.tour-modes button {
    padding: 0.5rem 0.9rem;
    font-size: 14px;
    font-weight: 600;
    color: var(--color-ink-mid);
    border-radius: calc(var(--radius-brand) - 2px);
}
.tour-modes button.is-on { background: var(--color-brand-dark); color: #fff; }
.tour-close {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    font-size: 24px;
    line-height: 1;
    color: var(--color-ink);
    background: #fff;
    border: 1px solid var(--color-hairline);
    border-radius: var(--radius-brand);
}
.tour-close:hover { background: var(--color-warm); }

.tour-stage {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
    background: radial-gradient(ellipse at 50% 40%, #f7f5f0 0%, var(--color-warm) 70%);
    touch-action: none;
}
/* The canvas is appended last, so it would sit over the doorway buttons:
   stack it beneath everything laid over it. */
.tour-stage :deep(.tour-canvas) { display: block; position: absolute; inset: 0; z-index: 1; cursor: grab; }
.tour-hotspot, .tour-hint, .tour-fallback, .tour-furnished { z-index: 2; }

.tour-furnished {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-rows: 1fr auto;
    gap: 0.5rem;
    padding: 1rem 1rem 0.75rem;
    background: var(--color-warm);
}
.tour-furnished img {
    width: 100%;
    height: 100%;
    min-height: 0;
    object-fit: contain;
    border-radius: var(--radius-card);
}
.tour-furnished figcaption { text-align: center; font-size: 12.5px; color: var(--color-ink-mid); }
.tour-stage :deep(.tour-canvas:active) { cursor: grabbing; }

.tour-hotspot {
    position: absolute;
    transform: translate(-50%, -50%);
    padding: 0.55rem 0.9rem;
    font-size: 14px;
    font-weight: 600;
    color: var(--color-brand-dark);
    background: rgba(255, 255, 255, 0.94);
    border: 1px solid var(--color-brand-mid);
    border-radius: 999px;
    box-shadow: 0 4px 18px rgba(31, 42, 51, 0.16);
    white-space: nowrap;
}
.tour-hotspot::before {
    content: '';
    position: absolute;
    left: 50%;
    bottom: -9px;
    width: 10px;
    height: 10px;
    background: var(--color-brand-dark);
    border: 2px solid #fff;
    border-radius: 999px;
    transform: translateX(-50%);
}
.tour-hotspot:hover { background: #fff; border-color: var(--color-brand-dark); }

.tour-hint {
    position: absolute;
    left: 0.75rem;
    bottom: 0.75rem;
    padding: 0.3rem 0.65rem;
    font-size: 12px;
    color: var(--color-ink-mid);
    background: rgba(255, 255, 255, 0.92);
    border-radius: 999px;
    pointer-events: none;
}
@media (max-width: 640px) { .tour-hint { display: none; } }

.tour-fallback {
    display: grid;
    gap: 1rem;
    place-content: center;
    height: 100%;
    padding: 1.5rem;
    text-align: center;
    color: var(--color-ink-mid);
}
.tour-fallback img { max-width: min(90vw, 900px); border-radius: var(--radius-card); background: #fff; }

.tour-rooms {
    padding: 0.6rem 1rem 0.75rem;
    background: #fff;
    border-top: 1px solid var(--color-hairline);
}
.tour-rooms-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    overflow-x: auto;
    padding-bottom: 0.25rem;
    scrollbar-width: thin;
}
.tour-rooms-label {
    margin-right: 0.35rem;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    color: var(--color-ink-light);
}
.tour-room {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    padding: 0.4rem 0.8rem;
    font-size: 13.5px;
    font-weight: 600;
    color: var(--color-ink);
    background: #fff;
    border: 1px solid var(--color-hairline);
    border-radius: var(--radius-brand);
    line-height: 1.2;
}
.tour-room:hover { background: var(--color-warm); }
.tour-room.is-on { background: var(--color-brand-dark); border-color: var(--color-brand-dark); color: #fff; }
.tour-room-size { font-size: 11.5px; font-weight: 500; opacity: 0.75; }
.tour-step { display: flex; gap: 0.3rem; margin-left: auto; }
.tour-step button {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    font-size: 24px;
    line-height: 1;
    background: #fff;
    border: 1px solid var(--color-hairline);
    border-radius: 999px;
}
.tour-note { margin-top: 0.35rem; font-size: 12px; color: var(--color-ink-light); }
</style>
