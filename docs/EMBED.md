# The embed

One map, on somebody else's website.

```html
<script type="module"
        src="https://maps.seniorsplaces.com/v1/embed.js"
        data-map="the-commons-on-meridian"></script>
```

That is the whole snippet. It renders the map where the tag sits.

---

## What a client can set

| Attribute | Default | What it does |
|---|---|---|
| `data-map` | — | **Required.** The map's public id |
| `data-height` | `480px` min | `720` or `80vh`. Bare numbers are pixels |
| `data-target` | after the script | CSS selector for where to put the map |
| `data-theme` | operator's theme | JSON overriding the colours for this one placement |
| `data-lazy` | `true` | `false` loads immediately instead of near-viewport |
| `data-deep-link` | `false` | `true` lets the map write filters to the page URL |
| `data-api` | the platform | Point at another environment |

Markup-first alternative, for CMSs that strip attributes from script tags:

```html
<div data-community-map="the-commons-on-meridian" data-height="720"></div>
<script type="module" src="https://maps.seniorsplaces.com/v1/embed.js"></script>
```

**`data-deep-link` is off by default and should usually stay off.** On our own
listing pages URL sync is right — it makes suites shareable and indexable. On
a client's site it rewrites *their* address bar, which breaks their analytics
and their back button.

---

## How it is built, and why

### Two files, not one

| File | Size | When it loads |
|---|---|---|
| `embed.js` | **3.4 kB** (1.5 kB gzipped) | Immediately, non-blocking |
| `runtime.js` | 187 kB (60 kB gzipped) | Only when a map is ~600px from the viewport |

The loader reserves space, watches for an intersection, and only then fetches
Vue and the map. A map three screens down costs the host page a kilobyte and a
half at load.

The split matters commercially: a snippet that drags 60 kB of framework onto
every page view gets blamed for a client's Core Web Vitals and then gets
removed.

### Shadow DOM, in both directions

The map runs inside a shadow root. People reach for that to protect the
widget; the *other* direction is what keeps you installed.

**Their CSS cannot reach in.** Real rules from real client sites — all in the
test fixture, all neutralised:

```css
* { box-sizing: content-box !important; }
button { background: hotpink !important; font-size: 28px !important; }
svg { width: 100% !important; transform: rotate(0.5deg); }
h1, h2 { font-size: 4rem !important; }
```

**Our CSS cannot reach out.** We ship Tailwind's preflight, which resets
margins, heading sizes, list markers and button styling *globally*. Injected
into a client's page it would silently restyle their site. They would not
report it as a bug; they would delete the snippet.

Both directions are asserted in `scripts/smoke-embed.mjs` — 30 checks against
a deliberately hostile page.

### Tokens and the shadow boundary

Custom properties **do** inherit across a shadow boundary. A client site with
its own `--color-brand` would otherwise recolour the map.

Tailwind v4 emits its theme layer as `:root, :host`, so the tokens land on the
shadow host and beat anything inherited from the page. Verified against the
compiled bundle: there is no bare `:root` in it. No build-time selector
rewriting was needed.

### Fonts deliberately inherit

Type is the one thing we *let* through, so the map reads as part of the site
rather than pasted on. `--font-sans: inherit` in `embed.css`. An operator who
wants our typography sets `font` in their theme and brings the face.

---

## Theming

An operator sets their brand once; it travels with the map payload.

```json
{ "brand": "#1d4ed8", "brandDark": "#1e3a8a", "brandLight": "#e0e7ff",
  "ink": "#1f2a33", "radiusCard": "6px", "font": "Inter, sans-serif" }
```

Precedence is `data-theme` attribute → payload theme → platform defaults, so a
host page can override for one placement.

**Availability colours are not themeable.** They carry meaning and are paired
with hatch patterns for colour-blind and low-contrast vision. A brand palette
applied to them would make the map unreadable for exactly the people the
patterns protect.

Values are written into a stylesheet, so they are validated: anything with a
brace, semicolon, `url(`, or comment sequence is rejected rather than escaped.

---

## Failure

Everything fails quietly, because it fails on someone else's page.

| What happens | What the visitor sees |
|---|---|
| Map not found | "This availability map is not available." |
| Domain not allowed | "This map is not enabled for this website yet." |
| Network down | A message and a link to the community on Seniors Places |
| Runtime fails to load | The reserved space collapses. Nothing else |
| Anything throws | Caught, logged to console, never propagated |

No stack traces, no error objects, no empty bordered box. A visitor on a
client's marketing site should never see our plumbing.

---

## Events

The element emits composed DOM events, so a host can wire analytics without
knowing it is Vue:

```js
document.addEventListener('map:loaded', (e) => console.log(e.detail.mapId));
document.addEventListener('map:lead',   (e) => gtag('event', 'generate_lead'));
document.addEventListener('map:error',  (e) => console.warn(e.detail.message));
```

And a programmatic handle for maps rendered into modals or single-page apps:

```js
window.CommunityMap.render('#slot', { map: 'the-commons-on-meridian', height: 700 });
window.CommunityMapLoader.scan();   // re-scan after adding containers
```

---

## Inside Seniors Places

The listing page already has the payload server-side, so it should not fetch
it again:

```js
window.CommunityMap.render('#map', {
    map: community.slug,
    payload: communityMapPayload,   // skips the network entirely
    deepLink: true,                 // our own page: URL sync is wanted here
});
```

Same element, same code path as any client site — which means our own site
dogfoods the embed, and an embed regression shows up on our listing pages
before it shows up on a customer's.

---

## Deployment

Serve both files from a CDN under an immutable, versioned path:

```
/v1/embed.js
/v1/runtime.js
```

`embed.js` resolves `runtime.js` relative to its own URL, so the two must stay
side by side. **The snippet URL is permanent** — it lives in client HTML you
do not control. Breaking changes go to `/v2/`; `/v1/` keeps working.

Cache hard (`immutable`, a year). Ship changes as a new version rather than
mutating a cached file, or a client's site changes without anybody deciding it
should.

### Build

```bash
npx vite build -c vite.embed.config.js   # → dist-embed/
node scripts/smoke-embed.mjs             # 30 isolation checks
```

The build **fails** if the stylesheet is not folded into the runtime. That
guard exists because it silently regressed once: the minifier rewrote the
placeholder as a template literal and the replacement stopped matching,
producing an unstyled map that still passed a naive check.

---

## Still to build

The client side is done and tested. The server side is not:

1. **The public API** — `GET /v1/maps/{id}` and `POST /v1/maps/{id}/leads`,
   with per-map domain allowlists, CORS, caching and rate limits. The
   contract is fixed and exercised by the test's mock server.
2. **Domain allowlisting.** Without it, anyone can embed a map and any site
   can generate leads against it. The 403 path and its wording already exist
   client-side.
3. **Lead forwarding** — capture, then deliver to Seniors Places, an
   operator's CRM webhook, or email.
4. **Embed analytics** — views, opens and leads per map is what proves the
   embed is worth what you charge for it.
