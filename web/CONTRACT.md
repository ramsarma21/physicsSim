# Physics sandbox contract (v2: scenes of catalog items) — localhost:8790

Plain ES modules in `web/`, loaded by `web/index.html`; the page compiles nothing. Some files in `web/` are generated and kept with the source:
the engine bundle (`web/sim/engine-worker.js`, `web/sim/engine-math.js`: `npm run build:engine`), the vendored three.js (`web/vendor/three/`:
`npm run vendor:three`), `web/scenario-list.json` (`node tools/gen-scenarios.mjs`) and web/sim's tables (`trig.js`, `sprites.js`, `unicode.js`);
see "Backends" below and "Browser port, parity and builds" at the end. The app has ONE view: a realistic three.js 3D view of a scene of
catalog items (`web/view3d.js`). The physics runs in one vertical plane (the machine plane, z = 0, x right, y up); 3D only adds the
front-to-back depth of things. Server `web/server.py` is ALREADY RUNNING at http://localhost:8790 (never start, stop or restart it; after
editing `machines/items.py` or a `machines/catalog_*.py` call `GET /api/catalog?reload=1` to make it re-read them). three.js (0.170.0) only via
the importmap in `web/index.html`, which points at the vendored copy (no CDN): `"three": "./vendor/three/build/three.module.js"`,
`"three/addons/": "./vendor/three/examples/jsm/"`. `web/vendor/three/` holds only `build/three.module.js`, the addons the app imports (with what
they import) and the LICENSE, copied from `node_modules/three` by `npm run vendor:three` (tools/vendor-three.mjs; `npm ci` first). A NEW
`three/addons/...` import in `web/*.js`, `web/models/**` or `web/sim/**` needs `npm run vendor:three` again, or it 404s and the whole model group
that imports it fails to load (bare shapes); write the path whole, ending in `.js`, as a plain string. `npm run vendor:three:check` writes nothing
and exits 1 when the folder is missing a file, holds an extra one or differs from `node_modules/three`. The pages in `web/dev/` keep the CDN.

## Backends: the local server or the page itself (`?engine=browser|server`)
- The app (`web/app.js`) gets the catalog, the scenarios, the runs and the saves from one of two backends that answer the same paths (below):
  **server** = `web/server.py` (the Python builder `machines/*.py`, the engine in node workers); **browser** = `web/sim/api.js`
  (`createLocalApi({profile, engine})`), which answers them in the page: clean, build (`web/sim`, the JavaScript port of the Python), the engine in a
  Web Worker (`web/sim/engine.js` runs `web/sim/engine-worker.js`; on the main thread where module Workers are missing), summarize.
- Which one: a page served from this machine (hostname `localhost`, `*.localhost`, `127.x.x.x` or `[::1]`) uses the server, a page from any other
  host (a static deploy) the browser; `?engine=browser` or `?engine=server` overrides that. `<html data-engine="server|browser">` says which runs.
  The AI steps (`/api/ai/*`) always go to a server (see "AI builder").
- The browser backend: `GET /api/catalog` is web/sim's `catalog()`; `GET /api/scenarios` lists `web/scenario-list.json` (the built-ins) and the
  scenes saved in this browser; `GET /api/scenarios/<id>` is a saved one, else `web/scenarios/<id>.json` (404 `no scenario <id>`);
  `POST /api/scenarios` saves in localStorage (`sandbox:saved`, `sandbox@<profile>:saved` with `?profile=`) and answers `{id, name}`, plus
  `persisted: false` when the browser would not store it (kept for this visit only); `POST /api/simulate` and `/api/layout` answer what the server
  answers (doc, resolved, warnings and summary the same, the track byte for byte: the parity tools check it), with a cache of the last 100 runs
  (48 MB) instead of the server's 300 MB. A scene holding item types that web/sim does not have also gets a warning
  `{items: [their ids], text: "2 items (rocket, kite) can’t be shown in the browser version yet, so they were left out"}` (the server leaves such
  items out without a word). Errors reject with an
  Error whose message is the server's `{error}` text and whose `status` is 400 (a scene the builder can't use), 404 or 500.
  `/api/dev/snapshot` exists only on the server.
- `web/scenario-list.json` is the built-in list, `[{id, name, builtin: true, items (count)}]` in the server's menu order (the starter, the empty
  table, then by name), because a static host cannot list a folder. After adding, renaming or removing a `web/scenarios/*.json`, run
  `node tools/gen-scenarios.mjs` (`--check` writes nothing and exits 1 when the list is stale).
- `?profile=<name>` keeps a tab's autosaved scene, its settings and (browser backend) its saved scenes apart from everyone else's
  (localStorage keys `sandbox@<name>:...` instead of `sandbox:...`).

## Scene (what the user edits; JSON)
```
scene = {version: 2, id, name, seconds, release (s: when held items let go),
         stage: {x0, x1, y0, y1} (m: the scene's edges), items: [item], goals: [goal]}
item  = {id, type (catalog key), name?, x, y (m: the item's anchor, usually its centre), angle (DEGREES, counter-clockwise),
         props: {key: value} (only values that differ from the type's defaults), held?: bool, fixed?: bool}
goal  = {kind: "in", item, container, label}
```
- `stage` is the scene's edges in metres (default x −0.56…3.19, y −0.16…2.34): the inspector keeps an item's X and Y inside it, and Add puts a new
  item inside its x range where it fits (a card dropped on the picture lands where it is dropped). The engine document's `camera` is derived from it; the 3D view does not read it.
- `seconds` 0.5…20 (default 4.5), `release` 0…20 (default 0.5). A goal `"in"` is met when the item's solids end between the container's
  walls (a `box`, `cup`, `bucket` or `basket`).
- The server checks what it is sent (a number that isn't one, a choice that isn't offered, an id that is empty, twice used or holds "/" (ids are
  1 to 80 characters), more than 200 items, a body over 8 MB: HTTP 400 `{error: why}`); numbers outside their catalog range are clamped (items:
  x, y within ±1000, angle within ±1e5); an unknown item type is left out.

Scenarios: `GET /api/scenarios` → `[{id, name, builtin, items (count)}]`; `GET /api/scenarios/<id>` → scene; `POST /api/scenarios {scene}` saves it
under its name → `{id, name}` (the name keeps letters, digits, spaces, `_`, `-` and `'`, at most 60 characters; the id is the name lower-cased with
`-` for spaces, plus `-mine` when a built-in has that id). Built-ins live in `web/scenarios/*.json` (`rube-goldberg` is the starter, `empty` is just
the table) and are listed for static hosts in `web/scenario-list.json`; saved ones in `web/saved/<id>.json` (the browser backend: localStorage).

## Catalog: `GET /api/catalog`
```
{categories: [str], looks: {key: {fill, shade, roughness, metalness, clearcoat, grain?, transmission?, ...}}, materials: {...},
 types: [{key, name, category, tags, description, source, facts, dynamic (bool), anchor (text),
          props: [{key, label, kind: "number"|"int"|"bool"|"choice", default, unit, help, min, max, step (number and int only),
                   slider_max? (number: the slider's own top, where a typed value may go up to max), choices?, auto? (true, or the list of prop keys its built value follows)}],
          defaults: {key: value} (every prop's default except the `auto` ones), edit: [handle], preview: {solids, animated, joints}}]}
```
`preview` = that item alone built at the origin (its doc solids, cords and joints), for drawing a catalog card (see `drawPreview` below).
`looks`: how a surface renders in 3D (roughness, metalness, clearcoat, grain, transmission ...). `fill` is the look's base colour in 3D (a solid's own
`color` overrides it); a card's flat stand-in picture fills a solid with its `color`, else its `placeholder.fill`, else the look's `fill`, and outlines it in the look's `shade`. A solid whose `look` is not in
`catalog.looks` falls back to its `placeholder.fill` and `render.shade`.
A prop with `auto` has a default that is only right while the item sets none of the props it follows (`auto: true`: every prop of the type that is not itself `auto`; a list
names them: a ball's `mass` follows `diameter`, `hollow` and `wall`, its `wall` follows `diameter`): what is actually built follows those props until the
item sets this one (see below). The built value is in `sim.resolved`; for an item whose type has an `auto` prop, its entry also carries `_type` (the item's type) and
`_own` (the sorted keys, among the `auto` props and the props they follow, that the item itself sets), which say what the built value was made for (see the inspector
below). `defaults` leaves such props out, so a value the item sets is always stored, even one equal to the default size's (the app drops only props equal to a `defaults` entry).
Edit handles (the editor in web/editor.js, `createEditor`, implements exactly these kinds; item types use only these):
`{kind: "length", prop}` two ends at local (±prop/2, 0) · `{kind: "radius", prop}` (prop = diameter) at local (prop/2, 0) ·
`{kind: "top", prop}` at local (0, prop) for base-anchored items · `{kind: "size", w, h}` corner at (w/2, h/2), centre-anchored ·
`{kind: "boxWidth", prop}` at (prop/2, wall/2) · `{kind: "rotate"}` above the item, sets item.angle ·
`{kind: "swing", prop, length}` a pendulum's bob at local (L sin a, −L cos a), L = the prop named by `length`; sets prop (degrees) from the pointer ·
`{kind: "tiltEnd", prop}` / `{kind: "armEnd", prop}` the seesaw's raised end (tilt) and right end (length).

### Ball weight follows size (machines/items.py `ball_type`)
A ball type states a weight for its stated diameter d0. Resize it and the weight follows the volume of material: unless the item sets `mass`
itself, mass = stated weight × (material volume now ÷ material volume at d0). A solid ball's volume scales with (d/d0)³. A hollow ball's
default `wall` grows with d/d0 too (unless the item sets `wall`), and its volume is the shell's, so its weight scales the same way; with
`hollow` off it is a full sphere of the same material, which weighs more. An explicit `mass` is kept through any resize (the density
follows); a `wall` the item sets is kept too. `sim.resolved[item id].mass` and `.wall` are the values built, and the inspector shows those
(to 4 significant figures: a 5 mm ball weighs milligrams, a 1 m one hundreds of kilograms).
A typed Weight or Wall may be anything the diameter range (5 mm to 1 m) can make of the stated values: Weight from a power of ten below a 5 mm
ball's weight (also its step) to a 1 m solid ball's; Wall from the lower of 0.2 mm (the minimum it had before, so a wall that was valid stays valid) and the
5 mm ball's default wall (rounded down to a micrometre) to the 1 m ball's (at least 0.05 m), in steps of 1 µm, so every stated wall is on the slider's grid. The Weight slider stops at 20 × the stated weight (`slider_max`),
so it stays usable at normal sizes; a larger typed weight still works. The engine gets the density as mass ÷ volume, to 6 decimals from 1 kg/m³ up and to 6 significant
figures below that (so the lightest typed weight, 1e-7 kg in a 1 m ball, is not rounded to no weight at all).
At the default size, with `hollow` on and no `mass` or `wall` set, an item builds exactly as it did before this rule; switching `hollow` off or
setting a `wall` without a `mass` changes the weight (it follows the material volume). A ball offers only its own material (`materials` = [its material]); the server refuses another one (HTTP 400).
Only balls made by `ball_type` do this; any other type follows its own builder's rule (many keep one stated weight whatever their size).

## One run: `POST /api/simulate {scene}` → `sim`
```
sim = {cached (bool), key, doc, track, summary, warnings, resolved, ms}
```
The answer is gzip-encoded when the request accepts it. Equal scenes (the name and id aside) are answered from a cache with `cached: true`.
- `doc` — the engine's scene document. Meters, radians CCW, x right, y up. `doc.solids[]`:
  `{kind: "static"|"dynamic", id ("<item id>/<part>"), item (owning item id), itemType, part (the part name: the 3D view picks its model by
    (itemType, part)), words, body, material, at, angle?, look, color?, pattern?, shape?, length?, depth3d?, legs?, hidden_3d?, surfaceSpeed?,
    pivot?, parent?, motor?, damping?, eye?, stand?}`, and `placeholder: {fill}`, `render: {shade, ...}`, `depth` (a draw layer) and `sprite?`, which the engine's document
    format requires. The 3D view does not draw from `depth` or `sprite`; it uses `placeholder.fill` and `render.shade` only as the fallback colours
    when the solid's `look` is not in `catalog.looks`. `stand` ("post" | "panel" | "wall") is a render-only support hint (see "Mounts" below).
  - `sprite`: solids that name the same sprite are one rigid object to the engine, which refuses the document unless they have the same `body` and
    `words` (HTTP 500 "... shares sprite ... but differs in its body or words"). So a ball type's sprite (the superball's, the plastic and clay balls')
    goes only on a ball whose body is the stated ball's: its stated diameter and its stated wall (none for a solid type). One resized, filled in
    (`hollow` off), given a `wall` of its own, or a hair off the stated size (its wall follows the size) gets no sprite and `render: {kind: "procedural"}`
    (the physics is the same either way, and the 3D view does not use sprites).
  - `body`: `{kind: "ball", radius, wall?, inertia?}`, `{kind: "slab", width, height, depth, taper?}` (taper = bottom width ÷ top width) or
    `{kind: "polygon", points, depth}` (below). `depth` = front-to-back size: contacts happen in the x-y plane, so the engine uses it only for the volume: mass (density × volume), buoyancy and air drag.
  - `eye` (a hanging bob): the height of its lifting eye's centre above the ball, m (web/models/mechanisms-ropes.js draws the eye and ties the rope to it).
  - `look`: key into catalog.looks (how its surface renders). `color` (hex) overrides the look's base colour.
  - `pattern` (balls): one of pingpong, tennis, golf, baseball, basketball, soccer, bowling, marble, beach, billiard, wooden (none = plain, as the superball).
  - `shape: "cylinder"`: a round body that is a cylinder along the depth axis (a log, a wheel seen end-on), not a sphere. `length` (m) is its
    length for the engine's air model; `depth3d` (m) is what the 3D view draws it as. Without `depth3d` a round body is drawn 2·radius deep and a plain
    cylinder (a log) 4·radius, except a wheel on a wheel joint (tyres 0.55·R wide) and a part drawn by a registered model (which gets `ctx.d` = `depth3d` or 2·radius, cylinder or not).
  - `legs: true`: a static slab (a plank) that stands on wooden legs down to the floor. `hidden_3d: true`: leave it out of the picture (a safety wall).
  - `pivot` (a hinge, in the solid's own frame) to `parent` or to the world; `parent` without pivot = welded (its `at`/`angle` are then in the parent's frame): the engine
    makes a part, everything welded to it and to those, ONE rigid body (see "Engine batch" below), whose parts never collide with each other.
  - `angularDamping?` (1/s, engine): its turning slows as dω/dt = −c·ω (a raw egg's liquid); for a weld group, the largest of its parts'. None without it.
  - `doc.materials` = `{name: {density, yieldStrength?, source?}}`; `doc.contacts` = `[{between: [material, material], friction, restitution, rollingResistance, tangentRestitution?, grip?, source}]`.
  - `doc.animated[]`: drawn-only parts. The ones items.py makes are cords `{id, item, at (bottom end), sprite: "cord"}` (2.6 m long in the document; the 3D view
    draws two thin cords 3 m up at the item's front and back faces) and a fan's blades (with an `airflow` jet, below).
  - `doc.release = {parts: [held solid ids], at, holder?}`: the 3D view draws a wooden pull pin under every held part until `at` (instead of the drawn
    hand `doc.organic[0]`, which the engine document keeps).
  - `doc.sprites` and `doc.camera` (canvas 1536×1024, origin, pixel, pixelsPerMeter, fixed per scene stage) are in the document because the engine's
    format requires them; the 3D view uses neither.
- `track` = `{fps, frames: [{t, placements: {solid id: {x, y, angle, squash?}}}], impacts: [{t, a, b (solid ids), speed}]}` ~120 Hz,
  every dynamic solid in every frame; placements (x, y, angle, squash) are rounded to 1e-5 and `t` to 1e-6; a static solid that never moves is listed only in `frames[0]`.
  Use `placementsAt(track, t)` from `web/track.js`; it, `frameIndex` and `pathOf` first call `completeTrack(track)`, which shares each
  such placement into every later frame in place (once per track). Code reading `track.frames` directly must do the same, or fall
  back to `frames[0].placements[id]`.
- `summary` = `{goals: [{label, ok, item, container}], stories: [{item, name, moved_at, max_speed, text, ok}], events: [{t, a, b (item ids), text, speed}]}`
- `warnings` = `[{items: [a, b], text}]` (items that start inside each other: two solids of different items whose overlap depth, rounded to
  9 decimals, is more than 3 mm; two static solids are not compared when one is the table's. The rounding makes a pair exactly 3 mm deep, as a
  3 mm plank through a block, the same answer in Python and in a browser, whatever the last bit of the sin and cos of its angle).
  `resolved` = `{item id: full props}`: the type's defaults and the
  item's own props, then what the builder worked out from them (an `auto` prop's built value), and for a type with an `auto` prop the private `_type` and `_own`
  (see the `auto` paragraph in the Catalog section; a model's props include them, which does not change how it is drawn).
- `POST /api/layout {scene}` → `{doc, resolved, warnings}`: the same doc without physics, ~10 ms — the app calls it while dragging and
  hands the view a one-frame sim `{key: "layout", doc, track: {fps: 1, frames: [{t: 0, placements}]}, summary, resolved}`.

## The view (web/view3d.js)
```js
createView3D(container) → {
  load(sim, previous, opts),   // opts.keepCamera: don't re-frame (the app passes it for layout previews and re-runs after edits); opts.rebuild: build anew even
                               // where a layout that only moves things could be applied in place (tests). `previous` is ignored.
  render(t),                   // draw moment t; the app's clock calls it every animation frame (except while a layout preview is shown) and it redraws only when the picture can have changed; cheap
  setOptions(opts),            // {camera: "wide"|"follow"|"orbit", looks (catalog.looks), reflections: bool, exposure: number}
  resize(), dispose(),
  // editing hooks (the app's editor uses these; coordinates are CLIENT px in, CONTAINER px out)
  pick(clientX, clientY),      // id of the solid drawn nearest the viewer there, or null (a safety wall's pane only when nothing else is there; a held ball's post and pin only while it is still held)
  surfaceAt(clientX, clientY), // the top surface under the cursor's point in the machine plane: {x (the cursor's place in the plane z = 0), y (top of the first drawn solid straight below it: a front or side hit is reported as the top of that solid at that x; stand a dropped thing there), solidId, itemId, normal {x, y, z} (world)}, or null (never the room, a safety wall's pane, a cord or a held ball's stand)
  setHighlight({selected, hover}), // item ids the app marks (or null): their see-through walls (hidden_3d solids) are drawn as faint acrylic panes and become pickable; the panes of other items stay invisible
  toWorld(clientX, clientY),   // {x, y} m: where the camera ray meets the machine plane z = 0, or null
  toScreen(x, y),              // {x, y} css px relative to the container for world point (x, y, 0), or null if behind the camera
  pxPerMeter(x, y),            // css px per meter at that world point (handle sizes, hit tolerances)
  setEditing(on),              // while the user drags: the follow camera stays put and orbit-dragging is off
  frame(),                     // re-fit the wide camera to everything now
  setQuality(mode), getQuality(), // "auto" | "high" | "medium" | "low"; -> {mode, tier, reason} (see "Slow machines" below; the app's Quality control calls them)
}
```
Without WebGL the factory returns the same object with every call a no-op (`pick`, `toWorld`, `toScreen` give null, `pxPerMeter` 0, `getQuality` `{mode: "auto", tier: "low", reason: "no WebGL"}`) and a message in the container.
The app owns the clock, fetching, selection and the editor overlay (its own canvas on top, reading pointer events on the
container in the capture phase and calling stopPropagation when it grabs an item, so 3D orbit only gets empty-space drags).
A view only draws. A container may be 0×0 (the page not laid out yet): guard it.
`load()` reads `sim.doc`, `sim.track` and `sim.resolved`; a model gets `resolved[item id]` as `ctx.props` (sizes, colours, mass, a billiard ball's `number`, which is
not in the doc solid), and its build cache is keyed on those props.
Item models: `web/models3d.js` (`addModel(itemType, part, build)`; the files in `web/models/`) draws catalog items as their real shapes in place of plain
boxes and spheres; `web/thumbs3d.js` photographs the same models for catalog cards and inspector icons.

## UI modules (web/catalog-ui.js, web/inspector.js)
`createCatalog(host, {catalog, drawPreview, onAdd(key), onDrop(key, clientX, clientY), onDragOver(clientX, clientY | null), onShow(canvases)})` → `{open(), close(), toggle(), isOpen()}`
(`onShow` gets the shown cards' canvases, in screen order, whenever the chips or the search change what is listed, so their 3D photos can be made first.)
`createInspector(host, {catalog, onSelect(id), onChange(id, patch, commit), onScene(patch, commit), onDelete(id), onDuplicate(id), drawPreview?, onNotice?(text)})`
→ `{render(scene, selectedId, resolved)}`. `patch` = `{x?, y?, angle?, name?, held?, fixed?, props?: {key: value}}`;
`commit` false while a slider drags, true when it settles. `drawPreview(canvas, preview, looks)` paints a type's `preview` into a canvas:
the app passes one that draws the item's 3D photo (`drawPreview3D` in thumbs3d.js, which finishes the picture when it is ready), and `placeholderPreview`
in catalog-ui.js (flat shapes) is the default and the stand-in until then.
The inspector shows a prop's value from the item's own `props`, else from `resolved[item id]` (what the builder made of it), else the type's default.
An `auto` prop with no value of its own shows what was built only while that `resolved` entry is for the item as it is now: its `_type` is the item's type, the
`_own` it lists matches which of the prop and the props it follows the item sets (a weight that was typed is not the automatic weight, so after a reset or an undo
that removes it, the typed entry says nothing), and the props it follows (the item's own, else the defaults) are what was built. Otherwise the inspector shows the
default while the item sets none of them, and else leaves the box empty and the slider hidden until a matching `resolved` arrives: it never shows another state's
weight (the copy of a big ball, a reset, an undo, a size just changed, or another item that had the same id in another scene). Typing a value sets it (a weight
typed stays through later resizes; the reset button returns it to automatic: it sends `undefined`, so the item stores nothing). An `auto` prop's box shows 4
significant figures (also when it restores an entry that was not a number) and its slider (whose top is `slider_max` where the prop has one) stores 3.
The app does not store a prop that equals the type's default (an `auto` prop has none in `defaults`, so what the user types is always stored). The app renders the
inspector with `S.layout?.resolved ?? S.sim?.resolved` whenever the scene, the selection or the run changes (a run landing, a commit, a select, an undo, a save),
but not when only a layout arrives: during a drag (of a handle or a slider) the box stays empty, and at release it fills from the last layout if that matches the
item, otherwise when the run lands (a fraction of a second, longer under load). Calling `renderInspector()` after `S.layout = r` in `requestLayout` (web/app.js)
would fill it in at once (the layout answers in about 10 ms). The inspector's Items list draws its
icons only while the list is on screen (not while the panel or the group is collapsed).

## The app's top bar and transport (web/app.js, web/index.html)
- Scenario menu: `GET /api/scenarios` (a saved one is marked "(mine)"); it reads "Edited scene" once the scene differs from the scenario it was loaded as.
- **Save**: asks for a name (and confirms before replacing a saved scene of that name), then `POST /api/scenarios {scene}` (see Scenarios above).
- **Export** (the down-arrow button): downloads the scene as `<name>.json` (the name lower-cased, spaces to `-`, other punctuation dropped;
  `scene.json` without one), `JSON.stringify(scene, null, 1)`, made in the page (no server).
- **Import** (the up-arrow button): a `.json` file of at most 8 MB that is a JSON object with an `items` list. It is checked with `POST /api/layout`
  first, so a file the builder refuses is reported with its reason and the scene on screen stays; the x, y and angle of each item of a known type
  become numbers (missing = 0; one that is not a number refuses the file). It opens as an edited scene (not one of the menu's), as one undo step;
  Save keeps it.
- **Quality** (transport bar: Auto, High, Low): `view.setQuality(mode)` (see "Slow machines" below for the tiers). The choice is kept in localStorage
  (`sandbox:quality`); `?quality=auto|high|medium|low` on the page wins over it (medium is only reachable that way). The control's tooltip shows
  `view.getQuality()` (the mode, the tier drawn now and why) and is refreshed on the view's `"quality"` event.
- First picture: at boot the catalog, the scenario list, the 3D module (`view3d.js`) and the first `POST /api/simulate` (the autosaved scene, else
  the starter) start together, so the engine runs while 3D loads; the view's `load()` from app.js is a progressive build (stand-ins at once, the models
  in idle slices: "Slow machines" below). Until the first scene is up, Add, Build with AI, Clear, Reset, Save, Export, Import and the scenario menu are disabled.

## Phase 2: joints, motors, wheels, conveyors (doc additions)
`doc.joints[]` (optional; built by items.py from item types; the engine reads them; the 3D view draws them):
```
{kind: "spring", id, item, a, b, anchorA, anchorB, rest, stiffness, damping, compressOnly?, coils?, coilRadius?}
{kind: "rope",   id, item, a, b, anchorA, anchorB, length, thickness?, collide?, render?}   // slack until taut; never longer than length
{kind: "pin",    id, item, a, b, anchorA, anchorB, motor?: {speed, torque}, limits?: {lower, upper}, friction?, damping?}
{kind: "wheel",  id, item, chassis, wheel, anchor, axis, frequency, damping, motor?: {speed, torque}}
{kind: "pulley", id, item, a, b, groundA, groundB, anchorA, anchorB, ratio, wheelRadius?, minLengthA?, minLengthB?}
```
- `a`, `b`, `chassis`, `wheel`: solid ids, or null for the world (then that side's anchor is a WORLD point). Anchors on a solid
  are in that solid's own frame (meters). `rest`/`length` m. `stiffness` N/m, `damping` N·s/m (spring force along the line
  between anchors: F = −k(d − rest) − c·ḋ; `compressOnly`: no pull, only push, like a bounce pad's spring). `motor.speed` rad/s
  (counter-clockwise positive), `motor.torque` N·m (the most it can apply). `limits` rad. `axis` (wheel) unit vector in the chassis
  frame along which the wheel's suspension slides; `anchor` is the wheel centre in the chassis frame; `frequency` Hz / `damping`
  ratio of the suspension (`frequency: 0` = rigid axle). Pulley: `groundA/B` world points the rope runs over; `ratio` 1 = plain.
- A solid's `surfaceSpeed` (m/s): it is a conveyor belt; things touching its top move along its +x (its own frame) at that speed
  relative to it (friction permitting); the 3D view draws the belt running. A belt welded into a group (`parent`) runs along its own
  +x as it sits in the group, at any angle of the group.
- A pivoted solid (`pivot`) may carry `motor: {speed, torque}`: its hinge is driven.
- Render hints the 3D view uses: spring → a coil (`coils` turns, `coilRadius` m) stretched between its anchors (`render: {rows}`: that many coils side by side
  across the depth, as a trampoline's mat is held); rope → a braided rope, sagging when slack; pin → a steel axle with hex heads (and a motor housing when it is driven); wheel → spokes so it visibly turns; pulley → a grooved wheel on a small bracket at each of groundA/B, and the rope's runs. A pin joint may carry `render: {"hinge": "none"}`: the 3D view then draws no generic hinge axle or motor can for it (the part's own model draws the pivot, as the pinball flipper's; the coil is under the playfield).
- A rope joint may carry `render: {"style": "chain"}`: the 3D view then draws steel chain links (alternately face-on and edge-on, wire ≈ 1.5 × `thickness`, pitch 3 wire diameters) along the rope, straight when taut, sagging when slack, instead of braided rope.
- Models may mark a child Object3D `userData.spin = {axis: "x"|"y"|"z" (its own, default "z"), rps (turns/s, counter-clockwise about +axis), from? (s)}`: the view turns it with the clock (a fan's blades, a rotor). A resting slab or polygon (lowest point < 2 mm above the tabletop or a static slab under it) is drawn lowered onto it: the engine's contact skin is visual only.
- items.py: `c.joint(kind, part, a=..., b=..., anchorA=(x, y), anchorB=(x, y), ...fields)` adds joint "<item id>/<part>"; a/b/chassis/wheel are this item's part names (None = world; an id with "/" is kept), a world side's anchor and groundA/B are in the item's frame (made world points), a solid's anchor in that solid's frame.
- Engine: `limits` are relative to the starting angle (b − a); a wheel's `frequency` is the bounce of the load it carries (its share of its chassis, from where the
  chassis's centre of mass is: see "Engine batch" below), so k = load·(2πf)² and sag ≈ g/(2πf)² at every wheel; a spring the 480 Hz step follows only roughly logs a
  warning (console.warn, once per run): from ω·dt > 0.35 its period comes out short by 1 − ω·dt/(2·asin(ω·dt/2)) (0.5 % at 0.35, 3.6 % at
  0.9) and its swing reaches 1/√(1 − (ω·dt/2)²) of its release on the far side; past ω·dt √2 (h²·Σk/m > 2 on a body) part of it is solved
  implicitly: steady at any stiffness, but its bounce is slowed and damped.
- Pulley: the rope only pulls (lengthA + ratio·lengthB is never MORE than it starts at; it goes slack); `minLengthA`/`minLengthB` (m) are the shortest each run
  gets (its rope end jams at its wheel: the body stops there, dead, and the other side stops with it). Without them: where the body, hauled straight up its run,
  first meets its wheel, a circle of `wheelRadius` at the ground point's height whose rim is on the run (inboard of it, toward the other run); with no
  `wheelRadius`, where the body's top reaches the ground point's height. Never under 1 mm; a body that starts nearer stops where it starts.
  The stop holds however fast the end arrives: it reads the run's length along its direction at the step's start, so an end cannot pass
  through its ground point within a step (with no `wheelRadius` a 45 g cube tied at its top used to pass at 1.5 m/s and fling both bodies).
- Pin: `friction` (N·m) is a Coulomb torque against the two parts' relative turning (it holds them while what turns them is less), `damping` (N·m·s) a viscous
  one, −c·Δω (implicit: any value is steady); frictionless without them. Each is solved with the pin's point constraint as one 3×3 block, its impulse
  carried from step to step, and a pin with either that is joined to other pins through moving bodies (an arm's shoulder and elbow, a double pendulum)
  is solved together with them (`HingeGroup`, 24 sweeps in each of planck's 8 passes), so a chain held by friction holds (it gives under 0.01° as
  the solver takes up its load) and a damped chain only slows. (A solid's own `pivot` keeps its explicit `damping`.)
- Rope: one drawn as a chain (`render: {style: "chain"}`) or with `collide: true` collides while taut (no more slack than would sag it by its own half-width, or
  1 mm): moving solids (not its own two ends, not fixed parts) land on, rest on and are pushed by a band along the straight line between its anchors, a chain's
  as wide as the view draws its face-on links (1.775 × its wire each side, the wire 1.5 × `thickness` clamped to 4–12 mm: 14.8 mm for the wrecking ball's
  5.55 mm chain), a rope's `thickness` / 2. Friction 0.5, no bounce (provisional). The touch's push goes to the chain's two ends by the lever rule. These
  touches are not reported as impacts. A body within 5 cm of the band is met there (a speculative margin), its approach cut to its real gap, so small
  and fast bodies land on it too (a 2.5 mm steel ball from 5 m, 9.9 m/s, 21 mm a step); it rests on the band as on a floor (1.5 mm of skins).
  The wrecking ball's chain-style rope collides, so in the wrecking-ball scene it strikes bricks the pre-batch engine let it pass through, and
  that scene's brick outcomes differ from before the engine batch (Brick 3 now ends 733 mm from where it did, Brick 4 rather than Brick 3 lands on
  the table; see "Engine repair" below).
- Resting gap (view only): a part the grown meshes sink into the tabletop or a static slab (up to 2 mm) is raised onto it as well as lowered; a part resting on another mover takes that mover's offset (the gap between the two stays the physics'); a hinged part (`pivot`, and what is welded to it) is never moved. A held ball's post stands further back where something deeper than 9 cm stands under the ball.

## Polygons: true side outlines (a cone's slope, a wedge, a car's hood, an egg)
- `body: {kind: "polygon", points: [{x, y}, ...], depth}`: a convex prism seen from the side. 3 to 8 points, counter-clockwise
  (x right, y up), in the solid's own frame around its origin (`at` is that origin, which need not be the centroid); `depth` =
  front-to-back size. Mass = density × area × depth, centred on the outline's centroid, with the prism's rotational inertia.
  Everything a slab does works the same (contacts, restitution, sideways spring-back, CCD, pivots, parents/welds, joints,
  drag; `surfaceSpeed` too, though only a slab is drawn as a running belt), and a polygon rectangle runs exactly like its slab. The engine refuses, on admission and with the
  reason, a clockwise / concave / self-crossing list, a point on a side's line, a side under 0.5 mm, or < 3 / > 8 points.
  A concave object (an L-bracket, a cup): several convex solids welded together (`parent`, no pivot).
- items.py: `c.poly(part, points, depth, lx=0, ly=0, langle=0, material=None, kind=None, look=None, words=None, **extra)`, like
  `c.slab`: `points` ((x, y) or {"x", "y"}) are the outline around the solid's origin at (lx, ly) in the item frame, turned by
  `langle` with it (as a slab's width and height are); rounded to 5 decimals; an outline the engine would refuse raises
  ValueError (so the catalog card shows the reason). `overlaps()` handles polygons against balls, slabs and polygons.
- 3D view: extrudes the outline through `depth` with small bevels (silhouette and depth exact) in the look's material, wood grain along its
  longest side-view axis; it is picked by its outline, and its contact shading follows its lowest corners. A model registered in
  models3d.js still wins: there `ctx.w`/`ctx.h` are undefined for a polygon (they come from width/height), so read
  `ctx.body.points` and keep the model's x-y silhouette on that outline.
- Precision: Box2D's skin makes polygons (and slabs) collide from 2 mm and rest 1.5 mm apart; on small polygons (sides ~2 cm)
  that is about 1° of slop when they rock or roll. Validated in research/rw-validate-poly.ts.
- Ball `wall` (m, optional): a hollow shell of that thickness; mass = shell volume × density, rolling inertia (2/5)(1−q⁵)/(1−q³)·m·r² with q = (r−wall)/r (2/3 for a thin wall, 2/5 as it fills the ball); an explicit `inertia` wins; no `wall` = solid sphere.
- Air (engine): buoyancy ρ·g·V up on every dynamic solid (ρ = 1.2 kg/m³, V = solid volume; a cylinder's πr²·`length`); a ball's enclosed air and its added mass (½ρV) are inertia only, not weight; quadratic drag ½ρ·Cd·A·|v|·v on every moving solid against still air or a fan's stream (an animated record's `airflow` = `{from (s: when it starts blowing), at (outlet, in the record's frame), direction (rad), diameter, speed (m/s)}`): `shape: "cylinder"` + `length` (m) gets cylinder drag (Cd 1.1 × diameter × length), a ball without them a sphere's (Cd 0.47 on its disc), a slab or polygon a box's (Cd 1.05 on its width across the flow × depth). A slab's or polygon's drag
  is taken side by side over its outline, as it is turned and as it turns (Newton's flat-plate drag: each bit of a side facing into the air meets
  −½ρ·Cd·depth·(u·n)·u, integrated exactly along each side): moving straight it is the formula above on the width it shows the air now (a plank
  falls end-first nearly as in a vacuum, flat like a leaf), turning, its far parts meet more air (a spinning plank, a swinging gate), and the force
  acts where the air meets it (a wedge falling on its flat side turns a little). A share of a body's motion over half taken by one step's drag
  is scaled down so a light, broad, fast-spinning thing is never turned back (never so far in a scene).

## Engine batch (2026-10-15): rigid welds, steady springs, pulley stops, swings that keep their energy (tooling/src/sim/physics.ts)
The document format is unchanged but for the optional fields above (pulley `minLengthA`/`minLengthB`, pin `friction`/`damping`, rope `collide`, solid
`angularDamping`); the track is the same shape (every solid's own placement under its own id). Validated against theory in `research/rw-validate-p3.ts`
(`node --no-warnings research/rw-validate-p3.ts [weld|spring|pulley|swing|friction|chain|wheel|belt|spin|drag|all]`; `ENGINE_DIR=<folder>` runs it on another copy of the engine).
- Weld groups: a part with a `parent` and no `pivot` is ONE planck body with its parent (and everything welded to either): a fixture per part, each with its own
  material (friction, restitution), the body's mass, centre of mass and rotational inertia summed from its parts (a ball's sphere or shell inertia and carried
  air included). Exactly rigid at any mass ratio (a 10 kg bob on a 2 g rod: 0.000 mm of stretch; the old weld joint gave 5.7 to 663 mm), and the parts of
  one group never collide with each other (no more slits or hidden pins between welded pieces). A group with a fixed (static) part is fixed. Each part's
  placement is its group body's pose composed with the part's own pose in its group. A part's drag and buoyancy act at its own middle. A pivot or a
  joint on a welded part attaches to the group's body at that part's point; two solids a joint joins still never collide with each other, but only those two
  (a part welded to one of them still collides with the other). A joint whose two ends are in one group is left out (nothing can move).
- Springs are solved inside the step: the Hooke force as before (explicit: the same period), the damping by the trapezoidal rule as a soft velocity
  constraint (it never takes more than the whole relative speed, so no damping blows a light part up), and a spring too stiff for the step to follow
  (h²·Σk/m > 2 over the springs on a body; it was 1 before the repair below) takes the excess stiffness implicitly (θ = 1 − 2/a), as does a stretched
  spring's sideways stiffness T/d: stable at any stiffness, damping and mass, with no energy gain. Measured: periods within 0.09 % and damping ratios within 0.01 % of the analytic ones; 96 light
  plates on uncapped springs (5–200 g, 50–10⁷ N/m, damping 0–1000) never faster than their stored energy allows (+3.5 %, the symplectic step's own swing);
  the 14.5 g bounce pad at damping 20 that left at 59 m/s stays put. Keep the catalog's `_spring_cap` limits: the explicit step is steady without
  them, but not true to period past ω·h ≈ 0.35 (above); a cap of ω·h ≤ 0.3 (k·λ·h² ≤ 0.09) would keep every catalog spring within 0.4 % of its period.
  (The catalog has since lifted its damping cap and kept the stiffness cap: see "Catalog after the engine batch" below.)
- Pulley: its own constraint (not planck's equality): the rope only pulls, its ends jam at `minLengthA`/`minLengthB` (above), and the side hauling holds
  directly at the axle (a 3 kg weight hauling a 50 g one into its wheel stops at the jam, 28.92 mm under the axle, both ways round). Its constraints are met
  where the step leaves the rope's ends (a swinging pail keeps its energy).
- Pins (solid `pivot`s, pin joints, rigid wheel axles) and ropes keep a swing's energy: their constraint is met where the step leaves the anchors, the
  bend of their paths included (planck's velocity projection lost 0.5–6 % of a swing's energy each period: a 150° pendulum lost 9° in its first half
  swing). Undamped swings now lose under 0.007 % a period (30° to 170°, the air's drag included). No slower: the 12 scenarios run in 619 ms against 665 ms before
  (node, best of 5 each; atwood 4.8 → 6.0 ms, the wrecking ball 126 → 97 ms).
- Wheels: each wheel's static load is its share of what its chassis carries from where that assembly's centre of mass is (along the chassis, across the
  suspension axis), W_i = W·(1/n + (x_i − x̄)(x_cg − x̄)/Σ(x_j − x̄)²) (the lever rule for two wheels; at least 2 % of the whole each), so a front- or
  rear-heavy vehicle sits level, every spring sagging g/(2πf)², and bounces at `frequency` without pitching.
- The server caches results by scene: after an engine change, `GET /api/catalog?reload=1` clears that cache (it also re-reads the catalog), or a scene
  already run is answered with its old track.

## Engine repair (2026-10-15, after the engine batch's review): tooling/src/sim/physics.ts
The document format and the track are unchanged. Backups: research/physics-before-engine-repair.ts (and part/document, unchanged), research/CONTRACT-before-engine-repair.md,
research/rw-validate-p3-before-engine-repair.ts, research/rw-validate-poly-before-engine-repair.ts. Each repair is checked in `research/rw-validate-p3.ts`
(`[weld|spring|pulley|swing|friction|chain|wheel|belt|spin|drag|all]`, 97 checks, ALL PASS; where theory has no closed form, against the same engine
stepping at 4800 Hz, a copy it makes in a temporary folder; each new check fails on the engine before the repair).
- Fast spins no longer crash: the series for a step's turn (`stepDrift`, `bendOf`) give way to the exact cos and sin past a radian a step (ω > 480 rad/s),
  where they ran away (as φ⁸) and fed a joint's solve to NaN, which leaked into fixed bodies and made planck's time-of-impact pass throw ("Cannot read
  properties of undefined (reading 'x')", HTTP 500). Below a radian a step the bits are unchanged (every regression scene identical). A rod driven at
  3000 and 5000 rad/s, a rope on a rod at 2000 rad/s and the review's crowded 13-item table run finite.
- Pulley stops hold however fast a rope end arrives (Phase 2's Pulley above). No-wheel cube hauled by 0.08 / 0.3 / 7.85 kg: stops 1.00 mm under its
  ground point (it passed it by up to 11.7 m, the energy 1.2 J → 127 J); hauled while swinging, energy never above its start.
- Pin `friction`/`damping` in chains (Phase 2's Pin above): a two-link chain under friction 50 or 500 N·m holds (it crept, and fell 122°); damping 1 to
  10⁶ N·m·s never gives NaN (it did in 0.044 s at 100), the energy never rises; friction on the elbow alone holds it to 0.005° as the arm swings (4.8°).
- Springs: the implicit share starts at h²·Σk/m > 2 (θ = 1 − 2/a; it was 1 − 1/a from 1), which took 13 to 42 % off a launcher's or pad's throw at the
  stiffest settings. The stiffest, smallest launcher throws a golf ball 18.69 m (4800 Hz: 18.39 m; it threw 13.77 m), a steel ball 15.14 m (14.92 m).
  Default launcher, pad and trampoline with a ball: within 2.1 % of 4800 Hz (p3 lists them).
- Colliding ropes and chains: the speculative margin (Phase 2's Rope above). 120 drops of 2.5–10 mm balls, a 4 mm rod and a brick from 0.5–5 m onto
  level and 30° ropes and chains: none passes through (20 of them did); the resting gap is unchanged (16.28 mm on the wrecking ball's chain).
- A conveyor welded into a group at an angle carries at its speed (it carried 0.47 / 0.32 / 0 / 0 m/s for 0.5 at 20 / 50 / 70 / 90°).
- Air drag on slabs and polygons follows their turn (Air above): a balsa plank falls 3.109 m end-first in 0.8 s (2.299 m before, as if flat), the
  hinged gate's swing matches RK4 of its equation (pivot, gravity, its sides' drag K·ω|ω|) to 0.01°, a plank spun by a steady torque settles at
  √(τ/K) to 0.01 %. Balls' drag is unchanged.
- The spring warning (Phase 2's Engine above) now speaks from ω·dt 0.35, stating the period's error.
- What changed in the scenes (before the repair → after): all 12 scenarios' goals unchanged; car-ramp-dominoes lists "Dominoes hit Table" again
  (drag on the falling dominoes; all 7 fall); end positions move by at most 15.3 mm (car-ramp-dominoes), 10.8 mm (pendulum-dominoes), 7.4 mm
  (rube-goldberg), 15.1 mm (wrecking-ball), 0.9 mm (newtons-cradle), 0.1 mm (spring-launch), 0 (atwood) and 248.7 mm (trampoline's basketball, a
  bouncing ball's chaos). The starter: 15 of 15 nudged starts land (before: 14 of 15), 131 of 143 on the fine grid (pre-batch and before: 127);
  the default start's ball 2 rises 0.378 m and lands. Parity: the bundle and the server identical (131 scenes × 3 runs in node and Chromium, and
  the repairs' own scenes). Speed: +4.6 % engine time on the 12 scenarios (the side-by-side drag), +2 % on crowded tables.
- Correction to the engine batch's report: the starter's higher ball-2 rise (0.331 → 0.404 m) was not the seesaw hinge keeping energy; it is the
  starter's sensitivity to small changes. Over the 143 nudged starts the mean rise was 0.352 m before the batch and 0.335 m after (medians 0.335 and
  0.319; now 0.345 and 0.352), both landing 127/143. And its "stories match" held for pass/fail only: the batch dropped car-ramp-dominoes's
  "Dominoes hit Table" (back now) and turned wrecking-ball's "Brick 3 hits Table" into "Brick 4 hits Table" (the chain now strikes bricks, above).
- Known limits, measured: a superball dropped 1 m on the default bounce pad strikes its light plate twice in 20 ms as it springs back, and rises
  0.416 m (4800 Hz: 0.363 m, +15 %); a 7.3 kg bowling ball bottoms the default trampoline's 0.77 kg mat out on the table, a three-body impact the
  480 Hz step resolves with more loss (0.664 m against 0.740 m, −10 %; not the spring's damping: with none the gap is −7 %). At a spring slider's
  far end the explicit step can over-throw (the smallest pad at 10000 N/m, ω·h 1.37 for its plate alone: +18 %); the catalog's caps (above) keep
  that away from defaults (no default was capped; the stiffness cap stays, the damping cap is lifted: "Catalog after the engine batch" below). A hinged part placed through a fixed part of another item (a cradle's pivot inside a bumper's shelf) can be flung when
  the contact and the hinge fight (as before the batch; `items.overlaps` warns of such overlaps). The drag is Newton's flat-plate model side by side:
  no lift, no flutter.

## Catalog after the engine batch (2026-10-15): machines/catalog_*.py and their ports web/sim/catalog-*.js
The document format is unchanged; the items below use the batch's optional fields. Every default type and every scenario builds the same document as
before except atwood-machine, pulley-lift, spring-gate, spring-catapult and wrecking-ball (and the atwood and wrecking-ball scenarios).
- Springs (catalog_mechanisms.py `_spring_cap`): the damping cap is gone (the engine solves damping implicitly, true at any value): the launcher, bounce
  pad, trampoline, bumper and spring gate build the damping their props say, and `resolved` shows it. The stiffness cap stays (k·λ·dt² ≤ 1.44, ω·dt ≤ 1.2
  for the part's fastest motion on its springs, written into `resolved`): past ω·dt √2 the engine solves the excess implicitly, steady but slowed, and the
  smallest, stiffest launcher then threw its ball 32-39 % short of the same engine at 4800 Hz (p3's launcher rows fail without the cap); at the cap it
  throws within 2 %. No default is capped; the props' ranges are unchanged. Measured at the sliders' far ends against 4800 Hz: a 10 N·s/m gate and a
  30 N·s/m bumper now swing as at 4800 Hz (capped to a fifth and a quarter, they were 13 % and 27 % off), the smallest launcher at 20 N·s/m throws within
  1 % (it threw 13.0 m with its damping capped, 3.2 m with the damping set). Known limit (engine, not the caps): on a light plate on a stiff spring a
  bouncy ball can rebound above its drop at 480 Hz, the restitution applied again as the plate springs back into it (6 × 10 cm pad at 5000 N/m, steel
  ball dropped 30 cm: +7 mm; 80 × 2 cm pad at 10000 N/m, bowling ball: +122 mm; at 4800 Hz both lose height), capped or not.
- Pulleys (atwood-machine, pulley-lift): each run's `minLengthA`/`minLengthB` is where its body, hauled up, stops 2 mm (`JAM_GAP`) under its wheel's drawn
  rim: the weight's flat top where it comes nearest the rim, the pail's bail wire at (bail radius + rim + 2 mm) from the wheel's axle. The hidden stops
  (`jam-*`, `stop-left`/`stop-right`, `jam-pail`) are gone; the wheels' solid discs (`wheel`, `wheel1`, `wheel2`, hidden_3d) are the drawn rims again. 32
  Atwood machines (1.1:1 to 60:1 either way, drops 0.1-2 m) and 69 lifts (item y 1.2-2.3 m, the review's 50 g weight under a 30 × 30 cm pail among them): the
  hauled body ends 2.0 mm under the rim, turned under 0.1°, the pail's late swing 0.00° (the weight used to tumble 458° and end 14 mm inside the wheel).
- Hinge friction (pin `friction`, μ 0.3 steel on steel, provisional): the spring gate has a pin joint `<id>/hinge` from the world to the gate at its
  pivot, μ × 1.9 mm (its hinge pin) × the gate's weight (default 0.0038 N·m), `render.hinge` "none" (its model draws the hinge; the gate keeps its
  frictionless `pivot`, which names the hinge). The catapult's hinge gets μ × 4 mm (its bolt) × the arm's weight and the spring's pull when cocked (default
  0.048 N·m), and its spring's damping is the spring's own again (2 % of critical; it was 20 %, standing in for the pin): the default golf ball leaves at
  4.94 m/s (it left at 4.14; 5.02 without friction), a 0.8 m arm on a 20 N/m spring with a baseball is still after 3.7 s (it swung on past 6 s).
- The wrecking ball's chain carries `collide: true` (its chain style already made it collide).
- Egg (catalog_everyday.py): its root solid carries `angularDamping` 2 /s when it moves (a raw egg's liquid insides): round eggs settle in 2-7 s
  instead of 3-12 s; a hen's egg set 8° off its rest still settles in 0.35-0.6 s.
- Newton's cradle and the pendulum (catalog_items.py `_hung_ball`) are unchanged: with weld groups rigid the bob stays on its rod or string to 0.0000 mm
  in 306 runs (pendulum 0.1-2 m, 1-30 cm, 0.01-10 kg, 5-170°; cradles of 2-9 balls of 1-15 cm, frame on and off); the pivot drifts at most 0.11 mm.
- web/sim/catalog-mechanisms.js now has round 7's changes too (the browser backend builds what the server does): the motor spinner (a static `hub` ball
  with `depth3d` and `stand`, the paddle's `pivot` and `parent` on it, a pin joint `hinge` with the motor, `render.hinge` "none"), the rope pendulum's
  `bob_mass` (follows size and material until typed; a lighter typed weight is a hollow shell of the material, a heavier one denser), the catapult's post
  lug, stop and limits, the built start angles and sweep written to `resolved`, the pail's root and bail gaps. (What the weld groups made unneeded but
  harmless is left as built: the pail's root choice and 2.5 mm bail gaps, the egg's slits and hidden pins.)
- Checked: test_rg (the starter's document and track unchanged), test_catalog 139/139, test_everyday 38/38, test_mechanisms 58/58; rw-validate, -p2,
  -poly and -p3 pass; tools/parity/run.sh, catalog.mjs with all three modules (Chromium and the live server: 75,771 cases), fuzz-live --n 2000 (4 shards)
  and parity-engine --catalog (131 scenes × 3 runs, node and Chromium): no mismatch. The 12 scenarios keep their goals, stories and events; only atwood's
  track moves (its light weight now jams 0.6 mm lower).

## Slow machines: quality tiers and a progressive first build (web/view3d.js)
- `view.setQuality(mode)`: `"auto"` (the default) | `"high"` | `"low"` (also `"medium"`, which auto reaches by itself). high = the full look; medium = at most 1.5 device px per css px, a 2048 shadow map, the table's reflection only while the clock is stopped; low = 1 device px per css px, no planar reflection, a 1024 shadow map, glass and ice see-through with no transmission pass. auto starts from hints (a renderer string that names a CPU rasteriser (SwiftShader, llvmpipe) = low, and that context is made without MSAA; a window under 500 px, 4 GB or less of `deviceMemory`, 4 or fewer cores = medium; else high) and, while the app's clock runs or the camera orbits, steps down after about 1 s of draws averaging over 20 ms (when drawing one frame, timed whole, costs over 11 ms: a 30 Hz display or battery saver does not count), and up cautiously (after 4 s at 60 fps with a measured, finished frame costing under 5 ms; a step up that has to be undone within 20 s is not tried again). `?quality=high|medium|low|auto` on the page sets the first mode; every change fires a `"quality"` CustomEvent (detail = getQuality()) on the container.
- `view.getQuality()` → `{mode: "auto"|"high"|"medium"|"low", tier: "high"|"medium"|"low", reason}` (what is drawn now and why, e.g. "auto: frames took 27 ms, stepped down").
- Progressive first build: a `load()` called from app.js (or with `opts.progressive: true`) that has models still to build (more than ~40 ms of them) draws plain stand-ins (the look's colour, the part's outline and depth) at once, then builds the models in idle slices (about 12 ms each, largest part first), compiles each in the background and swaps it into the same holder (no jump, picking and shadows keep working, the camera is not re-fitted); the table's and the wood's grain is drawn in slices too. Any other caller (dev pages, tests) gets everything built before `load()` returns, as ever. `view._debug.settled()` resolves once every stand-in is replaced, `view._debug.progress` says how many are left.

### Slow machines: repairs after review (web/view3d.js; these lines replace what the section above says where they differ)
- A finished model swap or grain map asks for a redraw itself (`requestRedraw()`), so the picture shows it whoever does or does not call `render()`: a layout preview (the app draws no clock then) and a failed run (error banner over the picture) get their models too.
- Stand-ins for multi-part items: while a model is deferred, the item's other parts (registered `addModel(type, part, null)`: a jar's walls, a cone's collar, a pin's body) are drawn as stand-ins as well, as children of the stand-in of the part that carries the model, at their starting pose relative to it (the parts of a dynamic item that share a weld root; any static part of a static item), each picked as itself. They go with that stand-in when the model swaps in; the stand-in and the finished item have the same outline to within the 2 mm skin.
- Auto steps down only when the machine is what paces the frames: a window averaging over 20 ms steps down when a drawn frame, timed whole, costs more than 11 ms **and** more than 0.75 of the window's average gap (`ADAPT_LIMIT`); a 30 Hz display or battery saver, which spaces frames out while drawing one costs far less than the gap, no longer costs a tier. A step up needs a measured frame under 8 ms (was 5), so a tier lost to a slow spell can come back.
- Low-tier glass and ice: the view's meshes get a see-through copy of each transmissive material (cached per material) and the original back when the tier goes up; the kit's own materials are never changed, so catalog photos (web/thumbs3d.js) and other views look the same whatever tier the view is at.
- The progressive build keeps out of the way of play and drags on a slow machine: while the app's clock plays or seeks (a new moment drawn in the last 300 ms), the orbit camera moves, or `setEditing(true)`, and the machine takes more than 100 ms to build a model (`BUSY_UNIT_MS`, a running average of the builds so far), no model build is forced after `requestIdleCallback`'s timeout (or by a `setTimeout` slice) and none starts unless the idle time left covers what one costs, because one model's build is a single unit of 0.4 to 2.4 s there. Everything waits until the clock is paused (about 300 ms after the last new moment), then the forced slices resume; so with the clock playing on such a machine the stand-ins stay until it is paused. A machine that builds a model faster than that goes on building while it plays, as before.

### View batch 2: springs in rows, pulleys, mounts, resting round bodies, clear shade, paint, chrome (web/view3d.js, web/models3d.js; these lines replace what the sections above say where they differ)
- Spring `render: {rows: n}` (n > 1): n coils side by side across the depth of `a`'s body (else `b`'s), at z_k = -d/2 + (k + 0.5) d / n, the same x-y anchors, one InstancedMesh of one shared coil geometry (a trampoline's frame hooks and mat V-rings stand at those z). A coil of more than 24 turns is drawn with 10 cuts per turn and a hexagonal wire (4.4k triangles).
- Pulley (`groundA`, `groundB` = where the rope's vertical runs hang, and the height of its top run): the wheels hang their rope radius below that height and INBOARD of the ground points by it, so each outer run hangs straight from the wheel's side to the body's anchor and the straight top line is the engine's own groundA-groundB run; the rope wraps the top of each wheel (an arc of rope in the groove). Where two wheels of `wheelRadius` would touch or overlap (|groundB.x - groundA.x| < 4 x (wheelRadius - 4 mm)) or `render: {wheel: "single"}`, ONE wheel spans both runs (radius |dx| / 2: a real Atwood machine); `render: {wheel: "double"}` forces two. The brackets (steel plates behind the wheels, axle bolt and nut) hang from the lowest static slab over the wheel within 12 cm (the bar), else from a hanging eye. For a single wheel the bar's underside must be at least the ground height + 6 mm (catalog_mechanisms.py `_rig` puts it at `wr + 0.012` above the ground height: with wheelRadius = d / 2 passed to `_rig` there is room).
- Mounts (render-only supports, `solid.stand` = "post" | "panel" | "wall", a top-level key of a static doc solid, like `legs` and `hidden_3d`; the engine and the server ignore it; the catalog sets it with the solid's other keys): a static part held in mid-air with nothing under it (no other static within 3 cm below its underside across its width, no tabletop; the pegs of one item do not hold one another) gets a support drawn behind the motion plane (nearer than 7.5 cm to it never): "post" = a retort stand (steel rod 13 mm on a 11 x 22 cm cast foot on the table, a boss head and an arm into the part's back; a bar wider than 26 cm is held at both ends), "panel" = an upright plywood panel (18 mm) with two feet, sized to the part (all the static balls of an item: the pegs) plus a margin, standing on the table behind the part's own back board, "wall" = a wooden bracket (cleat, 3 cm beam, brace) from the room's wall. Without the hint the view detects: a static solid that carries a hinge or a joint (a joint names it as `a`/`b`/`chassis`/`wheel`, a pivot or a world anchor of a rope, spring or pulley sits on it) gets a post (a wall bracket when its underside is above 1.3 m); the static balls of an item (pegs, bumpers) a post, two or more a panel. It is drawn only while the part is held up by nothing (a hanger dragged down onto the table loses it), picks as the part (`userData.mount`; `surfaceAt` never reports it), follows the part when it is dragged, casts shadows and is NOT in the wide shot's framing (so every shot frames as it did; the stand never extends the machine's silhouette by more than 1.5 cm). Built on first need.
- Round bodies (balls, rolls, a coin on edge, cans lying, wheels) resting on the tabletop or a static slab are drawn lifted onto it: the engine rests them 0.5-1 mm above y = 0 but the tabletop is drawn at 1 mm, so their meshes sank 0.1-1 mm (a coin on edge showed a 5 mm chord). The lift is the depth the drawn mesh is inside the top face, only while the BODY is less than 0.5 mm into it (fading to nothing by 1 mm), straight up, no allocation (`roundLift`); statics too (settleStatics). `setRestFix(false)` turns it off with the other resting-gap fixes.
- Contact shade under clear things: the blot under a part is scaled by (1 - transmission)^2 x opacity of its look and, for a model, of the materials of its lowest meshes (the smaller of the two): ice (0.55) keeps 20 %, glass (0.9) 1 %, fully clear none; movers too.
- Paint (web/models3d.js `paintHook`, `isPlainPaint`): AgX tone-maps each channel after an inset matrix, which washed a pure bright paint toward cream (truck #ffc400 came out (216,188,121)). A kit material (`kit.mat`) that is plain paint (no map, not a bare metal (metalness < 0.7), opaque, saturated colour) now maps its PEAK channel through AgX's grey curve and keeps its channels' ratios: hue exact, saturation what the paint says (truck cab: S 0.42 -> 0.85 of authored; toy car 0.53 -> 0.70; a plastic yellow swatch 0.53 -> 0.87, green hue error -21 deg -> -2 deg). The view uses the same hook in `satify` for plain looks. A model that sets its own `onBeforeCompile` on a kit material afterwards (balls, blocks, everyday items) replaces it and keeps what it tuned. Only where the renderer tone-maps (the main pass and the catalog photos); the planar mirror and cube passes stay linear. Anything else that wants the same: `import { paintHook, isPlainPaint } from "./models3d.js"`, `if (isPlainPaint(mat)) mat.onBeforeCompile = paintHook`.
- Chrome (high tier only): a ball that is a mirror (metalness >= 0.95, roughness <= 0.1, radius >= 6 mm: the steel ball) gets a material of its own (a clone) whose envMap is a 128 px cube render of the real scene from its centre with the ball hidden (the table, the wall, the neighbouring balls are in the chrome), made after a load, a layout change or a model swap, at most every 250 ms, never while the clock plays or an item is dragged, at most 6 balls. About 1-3 ms of CPU per ball per refresh (the first one 14 ms), nothing per frame. `view._debug.mirrors` says what it has.

## Browser port, parity and builds
- `web/sim/` is an exact JavaScript port of the Python side: `items.js` (machines/items.py), `catalog-items.js`, `catalog-everyday.js` and
  `catalog-mechanisms.js` (the three `machines/catalog_*.py`), `clean.js` and `layout.js` (web/server.py's `clean()`, `/api/layout` and what
  `/api/simulate` does around the engine), `rube.js` and `materials.js` (the parts of rube.py and items.py they need), with Python's own number and
  text rules in `pymath.js` (round(), float repr and parsing, str.lower(), sin and cos where CPython's bits are needed) and generated tables
  (`trig.js`, `sprites.js`, `unicode.js`, written by tools/parity/gen_trig.py, gen_sprites.py and gen_unicode.py). `web/sim/index.js` is the one
  import (`layout`, `prepare`, `finish`, `catalog`, `clean`, ...); it registers the three catalog ports in items.py's order. Exact means the same
  document, resolved props, warnings and summary, number for number and key for key, and the same error messages. Every change to a `machines/*.py`
  file is made in its `web/sim` port the same way, and the parity tools must pass.
- Parity tools (`tools/parity/`; they only read from the running server, never start or stop it): `tools/parity/run.sh` runs them all: the
  primitives against CPython; `core.mjs --mode core` and `--mode server` (the core types against items.py alone and against the whole server: the
  gate for a release; its groups `sprites` and `overlapties` guard the two rules above); headless-Chromium replays (`browser*.mjs`); the everyday and
  mechanisms ports; `node tools/parity/catalog.mjs --module catalog_items,catalog_everyday,catalog_mechanisms --no-browser` (all three catalog ports
  together); and `node --no-warnings tools/parity/fuzz-live.mjs --n 300` (random scenes of every type, every scenario and the catalog against the
  running server, through web/sim and through the browser backend with the engine bundle, the track byte for byte; `--n 2000` for the full fuzz).
  Each prints its cases and mismatches and exits 1 on any mismatch. The server is http://localhost:8790 unless `PARITY_SERVER` names another. Every layout answer is also checked for a sprite shared by two solids of different
  body or words (a document the engine would refuse).
- Engine bundle: `npm run build:engine` (tools/build-engine.mjs, esbuild from `npm ci`) bundles tools/engine-worker-entry.ts (the engine,
  tooling/src/sim on planck.js) into `web/sim/engine-worker.js` (a module Worker, with `engine-worker.js.map`) and the math the page itself needs
  (pow, cube) into `web/sim/engine-math.js`. In the bundle Math.sin, cos, atan2, exp, hypot and pow (and `**`) are tools/fdlibm.ts's; the
  server's engine (research/poc/worker.ts, and research/poc/dense_track.ts for the Python tests) loads the engine through
  tools/engine-math-node.mjs, which makes the same substitution in node (the rules: tools/engine-math-transform.ts), so the server and every
  browser compute the same bits on any machine, macOS or Linux. pow is tools/crpow.ts, correctly rounded (2^(y log2 x) in double-double with
  a proven error bound; the rare pair it cannot round, and the exact and halfway cases, in BigInt), written for this project with tables
  computed by tools/gen-crpow-tables.mjs (`--check` verifies them); `node tools/test-crpow.mjs` checks it against MPFR (python3 with gmpy2)
  on 10 million pairs and for the same bits in node, bun, deno and headless Chromium. The Python builders take their powers from
  machines/crmath.py (cube, cr_pow, sq), the same correctly rounded values, and their sin and cos too (crmath.sin, cos: math.sin/cos but
  at the multiples of 30 degrees, where the last bit decides a rounding tie, web/sim/trig.js's values, the table pymath.js reads), so a
  document is the same on a Mac and on Linux, except where another libm function lands exactly on a rounding tie: the builders' tan,
  atan2, acos, asin, sinh/cosh/asinh (the hanging chain), log10 and sin/cos at other angles are still the platform's in Python and V8's in
  web/sim, and can differ in the last bit, which shows only at an exact tie of a printed number (the hanging chain's documented case,
  tools/parity/mechanisms.mjs --groups chainties). CI runs the parity suite on both (on Linux not blocking until it has passed on main).
  The bundle is committed: rebuild it after any change
  under tooling/src/sim or to the engine's math in tools/ (the server's node workers restart by themselves; the bundle does not), check it
  with `node tools/parity-engine.mjs` (the bundle against the server's engine in node and headless Chromium, the track byte for byte) and
  fuzz-live, and commit it (CI and a Vercel deploy rebuild it and fail on any difference). The node validators run the engine the same
  way: `node --no-warnings --import ./tools/engine-math-node.mjs research/rw-validate.ts` (.github/scripts/validators.sh runs them all).
- three.js is vendored: see the top of this file (`npm run vendor:three`, `npm run vendor:three:check`).

## AI builder ("Build with AI")
Its contract is `ai/DESIGN.md` (the steps observe, plan, solve, simulate, refine, tune and apply; their schemas; the model routing in
`ai/models.json`; the panel). The panel (`web/ai/panel.js`, loaded when first opened or once the page is idle) gets the app's `api`, the scene and
the catalog, and applies its result through the app's `setScene` as one undo step. Its endpoints, `POST /api/ai/observe|plan|refine|edit` with
`{payload, client?: {requestId}}` → `{ok: true, result, model, ms, usage}` or `{ok: false, error, retryable, ...}`, are served by web/server.py
(one `node ai/cli.mjs` process per request, which loads the gateway key itself: the key never passes through the server, `web/` or the browser)
and, on Vercel, by `api/ai/[step].mjs`. They always go to a server, also with `?engine=browser`.

### View batch 2, repairs after review (web/view3d.js, web/models3d.js; these lines replace what the "View batch 2" lines say where they differ)
- Pulley: the wheels are centred at the height of `groundA`/`groundB` (the engine's run ends there: a body whose anchor rises to it comes no closer to the wheel's axle than the engine allows), inboard of the ground points by the rope's radius on them, and a wheel is never taller than the bar over it leaves room for (the lowest static slab within 30 cm above, 1.5 mm to spare): a single wheel (Atwood, `render: {wheel: "single"}`, or two wheels that would touch or stand less than 1 cm apart) is then smaller than the weights are apart and the runs lean in to it a little (the default Atwood: radius 3.05 cm, weights 10 cm apart); with room (`wheelRadius = d / 2` in catalog_mechanisms.py `_rig`, bar at `wr + 0.012`) it spans both runs and they hang vertical. Both runs are tangents from the body's anchor to its wheel, found at every draw in every mode (the wheel's rope is a length of rope laid on it of which the part between the run's tangent point and the top line (or the other run) is drawn: `ropeWrapGeometry`, a draw range), so a swinging pail's rope leaves the wheel at the tangent point; a run that would go DOWN to its wheel (a body inside it) is not drawn.
- Mounts: `solid.stand` is per plan, and a plan is drawn as the kind it needs now: a "post" whose foot (11 cm wide) would not stand on the tabletop (a rod near or past its end) is a wall bracket until it is dragged back on (pegs' posts too); a panel's feet are kept on the tabletop. Every support stays behind the deepest mover (half-depth over 3 cm: a bowling ball, a box, a swing's seat) whose path along x, over the whole run, comes within 6 cm of it: rod at z = -(max(part's half-depth, mover's half-depth, 7.5 cm) + 1.6 cm), the foot behind the rod (it runs from 1 cm in front of the rod to 21 cm behind), a panel's front face behind the pegs' own back and the mover (a 6 mm steel standoff joins each of the first 30 parts to it where the gap is more than 6 mm). A post whose arm lands on a drawn panel (a hanger on a peg board) is carried by the panel: only the boss and a short arm from the panel's front. The wall bracket's cleat is 30 cm tall (from 6 cm above the beam to 24 cm below it) so the brace's foot lands on it. The first build of a progressive load is queued after the first frame (`run.late`, run by the pump, 1-5 ms each); a load that is not progressive builds them at once.
- Chrome (high tier): the cube capture leaves the room out (the shell round the machine and the wall behind): the studio (the environment the metals reflected before, with its window and soft boxes, at the strength the metals' own env map has: backgroundIntensity 1) is drawn where the room was, and the table, the rods and the neighbouring balls are real; no seam where a lit wall met an unlit one. Nothing is scanned, compiled or captured until every model and mount of the run is in and two frames have been drawn for it. More than `MIRROR_MAX` (6) mirror balls: the others take the nearest tracked ball's cube map (`mirrors.follow`), so a cradle of nine looks alike everywhere.
- Paint program: plain paints (kit.mat, models3d.js `mat`) and the view's plain looks (satify) are ONE shader program per pass: `gradeShader(shader, paint)` in models3d.js, a uniform `uPaint` chooses the peak-channel AgX path (1) or the saturation + the renderer's tone mapping (0), and `gradeKeyFor(hook)` makes them share a program cache key (a material whose onBeforeCompile was replaced since answers with its own hook's text). `paintHook` is still exported (a plain paint's hook; set `customProgramCacheKey = gradeKeyFor(paintHook)` with it); `gradeSat` is the view's saturation uniform.
- Springs: the lighter coil (14 cuts per turn, hexagonal wire, 6.2k triangles) is for a coil of more than 24 turns drawn in a ROW (`render: {rows: n}` with n > 1) only; a single spring is always drawn in full (18 cuts per turn, 8-sided wire).

## Export: frames for a video (web/view3d.js; added 2026-10-15, the MP4 export's view side)
```js
view.whenSettled() → Promise<void>          // every stand-in swapped for its model, mounts and wood grain in, and (high tier) the canvas's chrome balls captured (at most 3 s more)
view.exportInfo() → {ready, settled, left, runId, duration, trackFps, impacts, recommended: {width, height, fps, camera, motionBlur}, maxSize, samples, cameras,
                     exporting, tier, gpu, softwareGL, lastFrameMs}
view.renderFrame(t, {width = 1920, height = 1080, camera = "wide", motionBlur = 0, fps = 60, shutter = 180, samples, runId, output = "canvas"})
  → Promise<OffscreenCanvas>                // (an HTMLCanvasElement where OffscreenCanvas is missing); output "imagedata" → a fresh ImageData instead
view.endExport()                            // optional: end the export session now (else it ends 4 s after the last frame, or at the next load())
```
- `renderFrame` draws moment t (clamped to 0…duration; frame i of an fps video is t = i / fps) at exactly width × height (16…`maxSize`, at most 8192) into the view's own
  targets, never the canvas, and resolves to a 2D OffscreenCanvas holding it, which the next call reuses: make the `VideoFrame` (`new VideoFrame(canvas, {timestamp})`)
  before asking for another. Calls are queued, one frame at a time. It rejects (Error) when no finished run is shown (`ready` false: nothing loaded, or a one-frame layout
  preview), when `runId` is given and the run shown is another (`the scene changed since the export began`: pass `exportInfo().runId` with every frame), when the GPU context
  is lost, and with a RangeError for a bad size or camera. The first call of a session waits for `whenSettled()` and compiles what the passes need (a few hundred ms).
- Always the high tier, whatever the canvas's: shadow map 4096, glass and ice with their transmission pass, the table's mirror drawn for every frame (every layer), chrome
  balls (`_debug.mirrors`) with a 256 px cube map made afresh for every frame (the other mirror balls show the studio while one is made). MSAA 8 up to 1440p, 4 above
  (`samples` overrides, up to the GPU's). The selected item's see-through walls (the app's marking) are left out.
- The colours are the canvas's: the main pass draws into a render target three.js treats as it treats the canvas (`isXRRenderTarget`, RGBA8 holding sRGB bytes), so every
  material compiles exactly as for the canvas (AgX and the sRGB encoding in the shader, the paints' own tone curve) and shares its programs. With `camera: "live"` at the
  canvas's drawing-buffer size and `samples: 4` a frame equals the paused canvas pixel for pixel (measured: 0 of 3.5 M pixels differ; with chrome balls 1.3 % differ, in
  the balls: 256 px cube maps against the canvas's 128).
- Deterministic: nothing reads the wall clock and every camera is a pure function of t built from the track; the same t and options give the same pixels (checked byte for
  byte, also with motion blur and after other frames). The canvas is left alone while a session runs: not drawn (it keeps its picture), not resized, not re-tiered;
  a resize, `setQuality`, or a draw asked meanwhile is done when the session ends, and the canvas then draws the very pixels it showed before. `getQuality()` keeps
  reporting the canvas's tier. A `load()` (a new run) or a change of `looks` ends the session. Picking and the editor see the parts where the canvas shows them.
- `motionBlur`: `true` = 6, a number N (2…32), or `{samples: N, shutter: degrees, max}`. The shutter (default 180°, i.e. 1/(2 fps) s) is centred on t; the sub-frames are
  spread evenly over it, each drawn whole (its own shadow map, mirror and picture; the chrome is made once, at t), accumulated in linear light in a float target and
  encoded to sRGB once (an unmoving pixel comes back to its very byte). N is the least: where things move so far while the shutter is open that N sub-frames would
  show steps, more are taken (no more than 2 px between two, up to `max`, default 32); where nothing in the picture moves the frame is the sharp one.
- Cameras (each built once per run, camera and size; 60 Hz samples through Catmull-Rom):
  - `"wide"`: the wide shot fitted to the picture (as the canvas's, without the 56 px kept for the buttons: 5 % clear at the top, 4 % at the bottom, 5 % at the sides).
  - `"follow"` (35 mm): the lead (the body that began moving most recently, with any that began within 50 ms of it), where it is going (0.3 s on), what it is about to
    hit (its next two impacts within 0.8 s: both bodies, now and at the impact) and whatever moves faster than 25 cm/s within 40 cm of it, held inside the picture
    (10 % / 12 % margins). The centre is smoothed by a zero-phase critically damped spring (no lag, no overshoot, no jerk); the distance is what holds all of it around the
    smoothed centre, held 0.6 s either side and eased, so it is never cut off (checked at every sample of all 11 built-in scenes); 45 cm to 1.6 × the whole machine's
    distance. It is still until 0.35 s before the first thing moves, then eases into the path (where that could not hold everything, it moves from the start).
  - `"orbit"`: an arc of 8° per second of the run (30° to 60°, cosine-eased) round the wide shot's target, from left to right, at the wide distance or as far as keeps
    the whole machine in the picture at every angle.
  - `"director"` (26 mm): the wide shot first (~15 % of the run), then, where the impacts of the next 1.2 s happen somewhere clearly smaller than the machine, a
    push-in (a straight dolly line, the close frame inside the wide one or overhanging it by at most half its own half-width) held while the action stays there,
    and back out to the wide shot for the end. Moves are smootherstep eases of 0.9 to 1.3 s (out up to 1.8 s where there is room), no two moves start less than 1.5 s
    apart, a hold is lengthened rather than cut short, a push-in that the action would turn back half way starts once it would not; the close shot is no tighter
    than keeps the picture's fastest motion under 2400 px/s at 1920 wide with its subject near the middle (else the director holds the wide shot: atwood, ball drop,
    Newton's cradle, pendulum dominoes do). Never loses the action: everything moving faster than 20 cm/s (that the wide shot holds) and every impact within 0.1 s
    stays inside the picture; where the close shot would leave some out it eases back toward wide (a limit held 0.75 s either side and eased).
  - `"live"`: the canvas's camera as it is now, held for the whole export (for comparing a frame with the canvas).
- Measured (Apple M5 Pro, ANGLE Metal, headless Chromium; Rube Goldberg 4.5 s = 271 frames at 60 fps, `VideoFrame` made from each): 1080p wide 5–8 ms a frame
  (2.1 s for the run), 1080p director with `motionBlur: 6` 11.5 ms (6.4 sub-frames on average; 3.1 s), follow + blur 14 ms (10 sub-frames), 1440p director + blur
  18 ms, 4K wide 15.5 ms, 4K director + blur 35 ms (9.4 s); the first frame of a session 30–60 ms more. Readback is a pixel-pack buffer kept for the session (8 MB at
  1080p in ~3 ms); the GPU work of a sharp 1080p frame is ~2 ms.
- `_debug.export`: `{state, shot(kind, W, H) (its path: series, segments, z, mag, peak, contains(k)), analysis(), fitWide(W, H, topPx), probe(on)}` for tests.

### View batch 3: detail by size, lens parts in the mirror, chrome refresh, raised panels (web/view3d.js; these lines replace what the sections above say where they differ)
- Coils and chains choose their detail by their size in the picture, before every picture, for the camera that draws it (`applyLods(camera, picture height in device px)`:
  the canvas's camera and drawing buffer, an export frame's camera and height): a curve is cut so it stands at most 0.5 device px off the true one (pieces per circle
  = pi sqrt(r / 1 px), r its radius in px). Coil (`coilLevel`): 8/12/16/24/32/40 pieces a turn, 4/6/8/10/12/16 sides round the wire, at most 60k triangles a coil and
  200k for a row (`render: {rows}`); chain (`chainLevel`): 3/4/6/8/12/16 cuts round each end of a link and ONE along each straight side, the same wire sides, at most
  40k triangles for the chain. A polygon is drawn as wide as its circle on average (`roundOut`), so no level looks thinner. The level is a pure function of camera and
  height (no history): an export frame is the same whatever came before it and the canvas equals the export's "live" frame; a level change redraws the shadow map.
  Measured (1400 x 900): wrecking ball's 36-link chain 4.3k triangles in the wide shot at dpr 1, 8k at dpr 2 (37k before), 39k from 12 cm (16-sided); trampoline rows
  35k each in the wide shot (62k before), 178k for the near row from 16 cm (now round: 24 pieces, 10 sides); 80-turn hanging spring 7.7k wide, 41k from 18 cm.
  The 24-turn / `rows` rule of batch 2 is gone. Until its first draw a coil or chain has an empty geometry (`LOD_PENDING`).
- Lens parts (`LENS_LAYER` = 4): in a model that has glass (a material with transmission), every part three.js draws in its transparent pass (all its materials
  transparent, none with transmission) that casts no shadow: a marble's cat's eye and gloss shell, a bottle's water line, ice's core, bubbles and frost. The table's
  mirror draws them in a pass of their own after the rest (over the same depth; the key and fill lights are on that layer too): the table shows that full mirror in the
  picture, and the mirror WITHOUT them (`refl.base` / the export's own, a copy made first) in three.js's transmission pass, which is what glass bends. So a glass marble
  no longer shows its own cat's eye's mirror image, upside down, as a coloured streak at the top of its glass, and its mirror image in the table still has the eye.
  Measured: the mirror image itself is unchanged (0 pixels differ outside the glass); the extra pass costs one scene traversal and a half-size copy, only in runs with
  lens parts (`run.lens`, `_debug.stats.lensPasses`). The real cameras, an export's camera and picking see the layer.
- Chrome (high tier): a capture is made again when the moment drawn is not the one it was made at (`mirrors.capT`) and the picture holds still: in the redraw the view
  asks for anyway when the clock stops (so a pause still draws once, as before, and that draw makes it), or 300 ms after a seek; never while the clock plays or on its
  first frame. The copies of a mirror ball's material (canvas and export) keep the original's onBeforeCompile, customProgramCacheKey, onBeforeRender and userData
  (`chromeCopy`). Measured: a paused canvas at t = 2 s vs the export's "live" frame: 0.12 % of pixels differ (in the balls: 128 vs 256 px cube maps); 0.49 % before.
- Panels on legs: a panel (peg board) whose sheet would start more than 30 cm above the table (`PANEL_RAISE`) is a sheet just round its parts (the margin as before) on
  two 3.5 cm battens behind it standing on the feet, from the table to 2 cm under its top edge, not a sheet from the table up. A post whose arm meets a panel's sheet
  is carried by it (as before); one whose rod would stand within 6.5 cm of a panel's sides along x and is not carried stands 18 cm behind the panel's front face, behind
  its sheet, legs and feet, its arm reaching forward.
- Glass and PET shadows: nothing changed in the view; checked smooth (no dither visible) at high, medium and low, at 18 cm and in the wide shot (the models' 3 x 3
  shadow-map-pixel dither averages out in the PCF soft filter).

### View batch 3, repairs after review (web/view3d.js; these lines replace what the sections above say where they differ)
- Raised panels and stands: a panel's sheet, legs and feet, and a stand's rod and foot, stand behind every STATIC part (not its own) that stands where they go, from
  the table up to the panel's top or the stand's arm (`staticsDepth`: a conveyor or a basket under a board on legs, a deep block beside a hanger), as behind the movers:
  panel front face at z = -max(parts' half-depth + 1.6 cm, mover's half-depth + 1.2 cm, static's half-depth + 1.6 cm). A board on legs records where its legs stand
  (`rect.legs`, `rect.home`); a stand whose arm passes under the sheet within 2.75 cm of a leg (half its 3.5 cm, the arm's 5 mm radius and 5 mm of air) makes that leg
  step aside along the sheet's back (`rect.dodge`: to the nearest place clear of every such arm, under the sheet, its foot on the tabletop; back home when the arm
  goes); where there is no such place the arm is clamped to the leg's front face instead (no rod, no foot). Box checks (every visible mount mesh against the other
  plans' meshes, the static parts and every 2nd frame of the movers; pbleg, pbconv, pbbasket, mounts, edge, pbhigh, high, pbbig, standball, truckpend, truck2, lift,
  pendulum-dominoes, plinko, wrecking-ball, atwood): no hits but the known test-scene artefacts (a box that starts inside a peg's arm, 5.8 mm; a ball's corner box
  against a peg's standoff, 2 mm; a bowling ball over a board on legs through the pegs' standoffs, 7.9 mm: see the peg-board model below). Before: the arms went
  through the legs (pbleg, 1 cm), the legs and feet through the conveyor and the basket (3-3.5 cm), and a stand's rod and foot 1.3-1.9 cm into a fixed box under
  its hanger (now behind it). A hanger dragged past a leg (layout previews) moves the leg each time, with no overlap.
- Chrome on the canvas and in an export is made in two rounds: every ball's cube first, then each again with its neighbours wearing those, so a ball shows its
  neighbours as chrome of the same moment (an export frame's first round is a 128 px cube per ball with every mirror ball in the studio, its second the 256 px
  maps). Each cube size has its OWN PMREM generator (`chromeUV`; the material's envMap is the converted texture): three.js's own conversion shares one generator,
  which keeps its blur set up for the size it last allocated, so cubes of two sizes through it (the canvas's 128, an export's 256) were blurred with the wrong
  levels (dark rims round every ball in an export made with two sizes; before this repair, a canvas capture made after an export showed ghost rings inside every
  ball). Cube cameras see glass, tiny parts and lens parts too (`chromeLayers`), the glass drawn as its see-through copy while the faces are made (`cubeGlass`: no
  transmission target per face camera), so a steel ball beside a jar shows the jar. Measured, Newton's cradle (real app, high,
  close orbit, paused at 1.2 s, 2500 x 1054): canvas vs the export's "live" frame 3.1 % of pixels differ by more than 2 levels and 0.04 % by more than 40 (was
  3.97 % and 0.43 %: the export's grey neighbours); close orbit at dpr 2, 0.03 % by more than 40 (was 0.31 %); the wide shot at dpr 2, 1.27 % differ at all and
  0.005 % by more than 40 (was 1.35 % and 0.058 %); the rest is the 128 vs 256 px maps' sharpness. Scenes without chrome balls: 0 pixels differ, as before. A
  capture costs about twice what one round did (cradle: 4.5 ms of CPU a pause); an export frame with the cradle 2.4 ms more (1080p wide 11.6 ms, follow + blur 15.3).
- Medium tier: chrome balls get 64 px cube maps (`TIERS.medium.chrome`; the same at most 6 balls as high, so which balls an export captures never depends on the
  canvas's tier), made only while the picture holds still, as on high. Low tier (no captures: a CPU rasteriser would stall compiling the faces' shaders): a mirror
  ball wears a copy whose env is the studio with a floor of the tabletop's colour (`LOW_FLOOR`/`LOW_SHEEN`, streaked along x, lighter toward the horizon; matched to
  the high tier's steel ball side on within about 10 levels), at strength 1 as a capture's, so its upper half is the high tier's studio and its lower half is wood,
  not grey plastic. The env is made once per view on first need (15-25 ms on a GPU); on a CPU rasteriser (SwiftShader) it would stall 0.7-1.6 s, so there the balls
  keep the kit's own studio, as before. A tier change back, an export (which holds high) and its end swap the copies on and off; the canvas then shows the very
  pixels it did before.
- Coils and chains: COIL_CUTS go up to 48, WIRE_SIDES and CHAIN_ENDS up to 24, and a coil or chain whose nearest point is within 25 cm of the camera (`LOD_CLOSE`)
  may have twice the triangle budget (a trampoline row from 16 cm: 40 cuts on 12-sided wire, 441k main-pass triangles, was 263k with 24 x 10; the wrecking ball's
  chain from 8-20 cm at dpr 2: 24 ends, 20 sides, 78k, was 45k with a visibly 16-sided wire). The canvas uses a share of every budget by tier (`TIERS.lod`: high 1,
  medium 0.5, low 0.25); an export frame always has the whole (so its "live" frame equals the canvas on high). No built-in wide shot changes level on any tier.
- Pulley: a body above its wheel's top (thrown up: the run would go down to the wheel) has its run drawn from the end of the wrap on that side (the top line's point
  on the wheel, the top of a single wheel), straight up to the body; only a body inside the wheel's rim has no run (pulley lift, bowling ball, t = 2.0 s: the rope
  leaves the right wheel's top for the pail).
- The lens pass waits for the progressive build (`run.left === 0`): the draws a load asks for meanwhile skip it and its copy.
- Opaque draw order is front to back, then the objects' own order (`renderer.setOpaqueSort`), never three.js's material id: material ids are a page-wide counter,
  so kept and cached materials came in another order than in a fresh page and faces at exactly the same depth were won by another one (1-14 levels in 1-10
  pixels a frame). Measured with the review's 96 frames (16 scene/camera/blur cases x 6 moments, 1280 x 720, one view per page, forward vs reverse order): 22
  frames differed before, none from the page's history now. Frames are byte-identical for the same t and options, whatever the canvas's tier (checked: cradle,
  steelbig, chromeglass from high, medium and low canvases). Left, in glass only and also before this change: between two browser sessions one or two glass frames in 96
  can differ by 1 level in 3-22 pixels, and a page's FIRST view differs from views made after it by 1 level in up to 8 glass pixels (one view reloading the same
  scene, as the app does, gives the same bytes). Cost: 0.1-0.4 ms of CPU a frame at 230-400 draw calls. The wide shots change in at most 44 single pixels (depth ties).
- Measured changes, this repair against batch 3 (sweep: 22 scenes x 3 tiers x 0.7 s / 2.5 s, wide, 1200 x 760, dpr 1, on a GPU): the built-in scenes differ only in
  1-44 single pixels (depth ties: the opaque order), except Newton's cradle (high: 15 px at 0.7 s, 0.12 % at 2.5 s, inside the balls: the second round; medium and
  low: 2.1-2.8 %, the new chrome); test scenes: pbleg and pbconv 2.7-5.4 % (legs moved, panels moved back), steelbig and chromeglass on medium and low 1-6 %
  (chrome), chromeglass on high 0.19 % (the jar and the second round in the steel ball), mounts 3-144 pixels; 60 of the 132 pictures are byte-identical.
  Batch 3 against before it (the review's numbers, re-measured): trampoline wide 1.5-1.6 % of pixels (max 62 levels), wrecking ball 0.42-0.44 % (max 65), spring
  launch 0.35-0.39 % (max 46), the glass scene 0.135 % (max 21: the marbles' tops, the bottles' bottoms), Newton's cradle on high at t > 0 1.6 % (the chrome made at
  t); all in coils, chains, glass and chrome balls; the other built-in scenes identical.
- Not the view's: the peg board's own painted panel (web/models/surfaces.js `pegPanel`) stands at the pegs' back whatever passes: a bowling ball over a raised board
  goes 7.4 cm into it and its frame rails (and through the view's standoffs, which join the pegs to the mount panel standing behind the ball). The model would have to
  put its panel behind the deepest ball that can reach the pegs (or the view's mount panel be the only board).

## Engine batch 2 (2026-10-15): no crashed runs, restitution only on impacts, sub-steps for stiff springs, springs with mass (tooling/src/sim/physics.ts)
These lines replace what the sections above say where they differ (the stiffness cap, the spring warning, the summary's goals). The track is the same
shape; the document gains one optional field, a spring joint's `mass` (kg, below). Backups: research/*-before-engine-batch2.*
(physics, part, document, the bundle and engine-math.js, catalog_mechanisms.py and its port, items.py and web/sim/items.js / layout.js, check.py,
rw-validate-p2/-p3, fuzz-live.mjs, this file). Checked in `research/rw-validate-p4.ts` (`node --no-warnings research/rw-validate-p4.ts [crash|energy|stiff|mass|all]`;
`ENGINE_DIR` as for p3; `FUZZ_N`, default 5000, and `FUZZ_JOBS`, default 8, size its crash fuzz; where theory has no closed form, against the same engine
stepping at 4800 Hz), and in p3's launcher, pad and trampoline rows.
- No crashed runs. fuzz-1646 (tools/parity/fixtures/fuzz-1646.json: 28 items, 113 solids) threw "Cannot read properties of undefined (reading 'x')" in
  planck's TimeOfImpact. Cause: the time-of-impact pass ignores joints, so the engine turns a hinged body's contacts off before it (a part on a pin, rope or
  pulley would be solved as if loose), but planck's pass turns back on every contact it updates (Box2D's Contact.update re-enables it). A swing's seat
  on two cords, moving at 1 m/s, met a rod 1.6 mm deep in that pass at 1.046 s and left it at 38 m/s; wedged among other solids, the solve fed on itself
  until five bodies' motion was NaN (1.204 s), and planck's distance routine, its search direction NaN, found no support vertex (index −1) and read
  `.x` of the missing vertex. Repairs: (1) the pre-solve keeps a hinged body's contact off through the whole
  time-of-impact pass; (2) restitution only at a contact point that is new this step (a lasting touch the solve could not part was given e again every
  step, which drove wedged solids ever harder); (3) no body faster than 150 m/s (`SANE_SPEED`: its centre, or any point of it as it turns; nothing a scene
  builds comes near it, the stiffest launcher throws at 34 m/s), slowed to it and said once a run (console.warn); (4) at most 64 impacts a step for the
  time-of-impact pass (`TOI_EVENTS`: a ball wedged among hundreds of pegs set off thousands, 5 minutes for a 2.5 s run); (5) pins, ropes and pulleys meet
  their paths' bend ("Engine batch" above) only while neither of their bodies touches anything (`free`; else planck's own constraint along the anchors'
  line), the bend taken from the turning as the step began (a 111 kg ball wedged frictionless on a 2 cm rope was spun to planck's 4π a step in three
  steps); a rope's end-of-step length is met with its own effective mass along where the step leaves it (a short rope whose end swings far in a step is not
  overshot); (6) a body's air drag is limited over all its parts together (a 0.5 g foam pillow 2 m deep, its nine parts each limited alone, was flung at
  the 5760 m/s planck allows; it now rises at 7.3 m/s at most: it is lighter than its air).
  Anything that still goes wrong is said in one line, never in planck's words alone: `SimulationError` (exported by physics.ts), "the simulation broke
  down at 0.002 s: ball's motion stopped being a number as the step was solved" (checked before the time-of-impact pass and after every (sub-)step: which
  part, and when), or "the simulation failed at <t> s (<the error's first line>)" for any other throw inside a step. The server answers it as before (the
  worker's error line, HTTP 500 with the message), the page's engine worker as its error; neither worker stops.
  Fuzz (tools/parity/engine-fuzz.mjs: 5000 random scenes of all 113 types, props at and past their ends, dense clusters, 37,816 items, in 8 processes):
  before, 5 scenes threw (all this crash); now 0 exceptions and 0 non-finite placements.
- Restitution only on genuine impacts. A bouncy ball on a light, stiffly sprung plate could come back above its drop: within one step the spring flung
  the plate back up into the ball, and the time-of-impact pass applied e to that spring-driven approach as if it were a strike. Now, in that pass, what a
  contact's springs gave its bodies after the moment they met (the share 1 − α of the step's push, α where the pass moved them back to) is taken out of
  the approach e acts on (`springApproach`, `SpringLink.pushOn`), and a sprung plate that something nears is stepped in finer sub-steps (below), so it
  follows the exchange of strikes. Sweep (p4 `energy`): pads 6 or 80 cm wide, 2 or 60 cm deep, of rubber or steel (plates 3.4 g to 3.8 kg), on 50 / 1000 / 10000 N/m,
  no damping, a ping-pong ball (e 0.96), superball, steel ball and bowling ball (e 0.65) dropped 0.1, 0.5 and 2 m: 288 drops, 226 measured (62 pads
  too soft to hold their plate up or balls landing on a narrow pad's rails): no ball comes back higher than its start (the highest 3.5 mm below it;
  on average 46 % of the drop lost). Before this batch, a steel ball dropped 2 m on a 6 × 2 cm rubber plate at 1000 N/m came back 4.9 m ABOVE its start.
  Ordinary bounces unchanged: rw-validate.ts (Cross 2002's drops and ramps) gives the same numbers; a superball dropped 1 m on wood rebounds 0.7265 m,
  e² with the air's drag and lift 0.7297 m.
- Stiff springs in sub-steps (`subSteps`): a step is split into as many sub-steps as the fastest spring group needs (its springs' k/m summed on the bodies
  they move: ω·h at most 0.45 alone, `SUB_TURN`, 0.15 while a moving body from outside the group nears or touches it, `SUB_TURN_NEAR`, kept 0.25 s after,
  `SUB_HOLD`), at most 16 (`SUB_MAX`); the whole world is stepped in them. Past 16 the implicit share (θ = 1 − 2/a) still keeps it steady, and the
  spring warning now says when even 16 sub-steps cannot follow a spring (ω·h / 16 past 0.35: rw-validate-p2's 10⁹ N/m spring warns, its 10⁵ N/m one is
  followed in silence). Every catalog spring at its defaults with nothing on it runs in whole steps. Measured (p4 `stiff`, Prony fits of a bob on a
  spring at ω·h 0.3 to 2.8 a 480 Hz step, undamped and ζ 0.05): periods within 0.69 %, damping ratios within 0.011 %, the undamped swing never grows
  (99.93-99.99 % kept over a second). The catalog's stiffness cap is lifted (below): the stiffest, smallest launcher pressed 45 cm throws a ping-pong
  ball at 34.02 m/s (4800 Hz: 33.95) and a steel ball at 32.81 m/s (32.81); p3's launcher rows within 0.09 %, its pad and trampoline drops (median of 7
  drops from 0.97-1.03 m) within 1.4 % of 4800 Hz: the superball on the default pad, +15 % before, is now within 0.17 %; the bowling ball on the
  default trampoline, −10 % before, within 1.4 %.
- Springs with mass (spring joint `mass`, kg, optional): a third of a spring's own mass moves with what it pushes (Rayleigh: the coils move from not at all
  at a fixed end to all the way at the moving one), so a plate of mass m on a spring of mass mₛ swings at √(k/(m + mₛ/3)) and is thrown with
  ½k·x² = ½(m + mₛ/3)·v². The engine adds mₛ/3 to the moving end's body at its anchor (its weight with it); a spring between two moving bodies puts half
  its mass at each end. Measured (p4 `mass`): launchers at the springs' rest length within 0.7 % of ½kx² = ½(m + m_b + mₛ/3)v² + the air's lift (the default
  launcher with a golf ball 4.424 m/s against 4.438; the stiffest one 33.8 m/s with 2.55 kg of steel, weightless springs would claim 325 m/s); a hanging
  spring's period within 0.03 % of 2π√((m + mₛ/3)/k).
- What changed in the scenes (before this batch → now; scene by scene through web/sim and the engine): all 12 scenarios keep their goals. Stories:
  rube-goldberg's first ball "top speed 2.2 → 2.3 m/s"; trampoline's balls 2.7 → 2.6 and 4.2 → 4.1 m/s; wrecking-ball's ball 2.7 → 2.8 m/s. Events:
  trampoline loses "Basketball hits Tennis ball", wrecking-ball "Brick 2 hits Brick 3". End positions move at most 0 (atwood, ball-drop,
  conveyor-delivery, plinko), 1.0 mm (newtons-cradle), 5.2 (spring-launch), 10.3 (pendulum-dominoes), 17.1 (car-ramp-dominoes), 19.2 (rube-goldberg),
  31.8 (wrecking-ball) and 181.5 mm (trampoline's tennis ball, bouncing balls' chaos). The starter (machines/check.py --sweep): 15 of 15 nudged starts land;
  the fine grid (--grid) 130 of 143 (131 before). Speed (node, best of 10 each): the 12 scenarios 685 → 839 ms; the trampoline 43 → 169 ms (its mat
  is stepped in sub-steps while the balls are on it), every other scenario within +8 % (rube-goldberg 117 → 126 ms).
- Known limits, measured: the sub-steps step the whole world, so a crowded table with a stiff pad in it costs up to 16 times a step while something is
  near the pad (the fuzz's slowest scenes took 78-86 s, and 137 s in one run on a busier machine, with 8 processes at once: the server's
  RUN_TIMEOUT is 120 s, so such a scene can time out there);
  `SANE_SPEED` also caps what a document asks for directly (a rod a motor drives at 3000 rad/s turns at 1459, its tip at 150 m/s); solids placed deep
  inside one another at the release are still pushed apart hard (the overlap warning says so), now slowed to 150 m/s instead of crashing; an ultralight
  slab has no added mass of air (the foam pillow above rises at 7.3 m/s in its first steps).

## Catalog and summary after engine batch 2 (2026-10-15): machines/catalog_mechanisms.py, machines/items.py, their ports, machines/check.py
- Spring steel (catalog_mechanisms.py `_spring_mass`, `_spring(..., travel)`): every catalog spring carries `mass`, the steel a coil spring needs to take
  its item's travel at its working stress: m = ρ·4G·(½k·travel²)/τ² (music wire: ρ 7850 kg/m³, G 79.3 GPa, τ 0.7 GPa, provisional; 5.1 g a joule; after
  Shigley ch. 10). Travel: the launcher's held compression, the bounce pad's room to its closed coils, the trampoline spring's stretch with the mat
  pressed down half its height, the bumper's room, the gate's stretch swung to 85° (or its closed coils), the catapult's stretch when cocked, the
  hanging spring's from its closed coils to twice its weight's sag. The default launcher's two springs weigh 3.7 g each; a 2500 N/m one held 45 cm,
  1.29 kg. The pad's starting compression and the trampoline's sag carry a third of each spring's mass with the plate or mat ((m + 2mₛ/3)·g for
  their two springs). web/sim/catalog-mechanisms.js builds the same.
- `_spring_cap` returns the stiffness prop itself (the cap is lifted: the engine's sub-steps follow every prop; p3's launcher rows pass uncapped).
  `resolved` no longer shows a lowered stiffness for any prop set.
- Summary goals (items.py `summarize`, web/sim/items.js the same, number for number): besides `{kind: "in", item, container}` (reported
  `{label, ok, item, container}` as always), a goal may be
  - `{kind: "falls", item | items: [id]}` → `{label, ok, kind: "falls", items, fallen, of}`: ok when every rigid body of them that can fall has fallen,
    by ai/goals.mjs's balance-point rule (`_Fall`): an item's weld groups not hinged to the world or a parent (round ones only when it has nothing else)
    have fallen when turned past their tipping angle (atan(base / height) of their outline box at the start, + 5°, within 20° to 85°) or knocked down
    at least half their smaller side and 2 cm (not a body on wheels). Label "<name> falls over", or "all N of a, b, c… fall over".
  - `{kind: "hits", item, target, before_s?}` → `{label, ok, kind: "hits", item, target, t}`: ok when one of the item's solids strikes one of the
    target's (track.impacts), by before_s if given; t the first strike (s, 3 decimals) or null. Label "<name> hits <target>[ by <s> s]".
  - `{kind: "moves", item, min_m?}` → `{label, ok, kind: "moves", item, moved_m}`: ok when the mean of its moving parts ends at least min_m (default
    0.05 m) from where it started; moved_m to 4 decimals. Label "<name> moves at least 5 cm" (ai/goals.mjs's lengths: 1.25 m, 12.3 cm).
  A goal's own `label` wins; a goal naming an item the scene does not have, or of no known kind, is left out (as before). The domino row's story
  ("N of M fall") counts by the same rule (it turned past 57° before; the 12 scenarios and the starter tell the same stories: rube-goldberg "7 of 7 fall").
- machines/check.py runs the engine through research/poc/worker.ts (the server's own worker; tooling/sim.ts left with the edullm link): `python3
  machines/check.py` (one run), `--sweep` (15 heights of ball 1, 7 mm lower to 7 mm higher; exit 1 under 13 landing), `--grid` (143 starts).
- Checked: test_rg PASS (the starter's document and track unchanged), test_catalog 139/139, test_everyday 38/38, test_mechanisms 58/58; rw-validate,
  -p2, -poly, -slop, -p3 and -p4 pass; tools/parity/run.sh, catalog.mjs with all three modules, fuzz-live --n 2000 (4 shards; its scenes now carry
  falls / hits / moves goals too, odd fields included) and parity-engine --catalog: no mismatch.

## Engine batch 2 repair (2026-10-15, after its review): tooling/src/sim/physics.ts, document.ts; the catalog's springs and the summary's falls rule
These lines replace what "Engine batch 2" and "Catalog and summary after engine batch 2" above say where they differ (the sub-steps, the spring mass,
the measured accuracy and speed, the falls rule). The track is the same shape; the document format is the same but for a spring's `mass`, which must now
be zero or more. Backups: research/*-before-engine-batch2-repair.* (physics, part, document, the bundle and engine-math.js, catalog_mechanisms.py and its
port, items.py and web/sim/items.js / layout.js, check.py, rw-validate-p3/-p4, fuzz-live.mjs, engine-fuzz.mjs, this file). Checked in
`research/rw-validate-p4.ts` (rewritten: `[crash|energy|stiff|mass|impacts|all]`; `ENGINE_DIR` as before, `MACHINES_DIR` builds the catalog's scenes
with another copy of machines/), p3's sprung rows, and the new fixtures tools/parity/fixtures/fuzz99991-8970.doc.json and fuzz99991-4425.doc.json.
- No energy from the sub-steps. Batch 2 recomputed a spring group's sub-step count every step from its rate, which takes in a stretched spring's
  sideways stiffness T/d: that comes and goes each half period, so the count flipped (2 ↔ 3) in step with the swing and pumped it like a swing pumped
  in time. An undamped 10 × 10 cm pad at 10000 N/m alone rang up from 17 to 93 mm in 2.5 s; a marble dropped 2 m on a 6 × 10 cm pad at 7000 N/m rose
  to 6.6 m; a steel ball dropped 4 m on a 10 × 10 cm pad at 10000 N/m 7 m above its start; 21 of 139 undamped bobs on springs grew (×10.75 at
  ω·h 1.3). Now the count may rise at any step but falls only after `SUB_HOLD` (120) steps of needing fewer, for a group alone as for one something
  nears (and the work budget below the same). Measured (p4 `energy`, `stiff`): 290 undamped bobs, ω·h 0.3 to 7.5 a 480 Hz step, 1 mm and 2 cm, 3 s:
  none grows (Prony's decay a step ≤ 1); the review's five (ω·h 0.9, 1.3, 1.35, 1.75, 3.45, 2 cm) keep at most 98.6 % (the air's drag); 192 drops
  on stiff pads as documents (3000-7000 N/m, 3-20 cm springs, 6 and 20 cm plates, marble, golf ball, superball, steel ball from 0.5 and 2 m, 6 s): the
  highest comes back 125 mm under its start; the three review scenes 0.53 to 1.7 m under their starts over 8 s; the lone pad's swing dies away
  (16.8 → 6.6 mm in 2.4 s: the air on a plate swinging at 8 m/s). The 12 scenarios' placements are unchanged by this alone.
- Sub-step accuracy, measured over a fine scan (p4 `stiff`: a bob on a spring at ω·h 0.2 to 2.8 in 0.05 steps, every point where the count changes
  included; batch 2's "periods within 0.69 %, damping ratios within 0.011 %" held at its five sample points only): periods within 0.87 % undamped and
  at ζ 0.05 and 0.1 (theory for ω·h 0.45 a sub-step: 0.86 %), 1.14 % at ζ 0.3 (ω·h to 1.5); damping ratios within 0.07 % (ζ ≤ 0.1), 0.57 % at ζ 0.3.
- Cheaper sub-steps (the whole world is stepped in them): a body from outside a group counts as nearing it only when it moves against it faster than
  `NEAR_SPEED` (0.1 m/s: a ball resting on a pad, or riding it, strikes nothing); a group none of whose springs' ends have moved against each other
  faster than that since the step before takes whole steps (its implicit share keeps it steady; never at its first step, so a launcher's plate is
  stepped finely from its release); and at most `SUB_WORK` (64) over the moving bodies awake, held as above. A pad and a ball added to a scenario
  (best of 3, node, this machine): rube-goldberg 108 ms → with the default pad 283 ms (batch 2: 518), with a 6 × 2 cm pad at 10000 N/m (a document)
  763 ms (batch 2: 2805); car-ramp-dominoes 145 / 434 ms (310 / 1750); plinko 92 / 346 ms (172 / 890).
- No crashed runs, no runs of minutes. (1) A wedged body's contacts could pile up impulse through planck's warm start, opposing contacts cancelling
  while their stored impulses grew, until the warm start alone flung the body and its motion was NaN (engine-fuzz seed 99991 scene 8970, a sneaker's
  heel among fixed pegs: "the simulation broke down at 1.181 s", HTTP 500 after 46 s): a stored impulse that would change the heavier moving body's
  speed by more than `SANE_SPEED` is dropped from the next warm start (post-solve). (2) A body wedged against fixed solids struck them again and
  again in the time-of-impact pass (scene 4425: a handle against a fixed ball and a wheel, 122,432 events in 1.5 s, 51 to 329 s for 3 s, past the
  server's 120 s `RUN_TIMEOUT`): at most `BODY_TOI` (32) events a body a step, and 4 a step (`BODY_TOI_WEDGED`) for a body that used all of them the
  step before, while it goes on using its 4 (wedged: it strikes the same solids over and over; four such in a 390-peg scene used 32 every step, 44 s
  of a 3 s run's 47, now 10 s); at most `TOI_EVENTS` (1024) a step, fewer where the world has many contacts (each event scans them all again: at most
  `TOI_WORK`, 200,000 contacts scanned a step). The 12 scenarios never reach these caps (their tracks are the same with or without them). (3) planck's clamp on a (sub-)step's
  move (`Settings.maxTranslation`) is `SANE_SPEED`·h. (4) `SANE_SPEED` 150 → 250 m/s: a run lasts at most 20 s, in which gravity gives up to 196 m/s
  (a 1 m steel ball let fall from 1000 m reaches 183.42 m/s in 20 s through the air; it was slowed to 150 and warned of as wedged); a document's motor
  driven past it is still held to it. Fuzz (engine-fuzz.mjs, seed 99991, 10,000 scenes, 76,189 items, built by this catalog, 8 processes on a machine
  busy with other work): 0 exceptions, 0 non-finite, the slowest 55 s (scene 2762, 13 s run alone; batch 2: 1 exception, 2 scenes over 120 s, 7 over
  60 s); the fixtures 8970 and 4425 (batch 2's documents) run in 1.9 and 1.5 s; p4's own fuzz (seed 20261015, 5000 scenes): 0 exceptions, 0 non-finite,
  the slowest 33 s (batch 2's report: 78-86 s).
- Strikes carried on through lasting contacts (sequential impacts). planck solves an island's contacts together and gives restitution only to one
  closing as the step begins, so a strike on a ball that rested against another went on through contacts that were not closing yet, as if the balls
  were glued: a tennis ball resting on a basketball, let fall 1 m onto the table, rose to 0.85 m; a Newton's cradle of touching balls (gap 0, the
  slider's least) sent two out. Now, where a strike (a contact `compensated` gives restitution) lands on a body that touches another moving body
  round to round, the island's one-point contacts (the struck ones, and those between round solids) are resolved one strike at a time, the hardest
  closing first, each with its own e, until none closes faster than `VELOCITY_THRESHOLD`; then planck solves the island as always. A struck contact's
  e is `compensated`'s (its rebound e times the approach as the step began, as planck would give it); one passed on is its pair's own. A body takes
  part when it is loose or turns on one hinge to a fixed body with no motor or limit (met with its inertia about that pivot, so the hinge holds as
  it is struck: a cradle's ball); anything else holding it (a rope, a pulley, a wheel axle, a chain, a driven or limited hinge) leaves its contacts to
  planck. Each strike is a two-body collision with e ≤ 1: no energy is made. A strike passed on is an impact of its own (track.impacts, the frame
  nearest it). In both the main solve and the time-of-impact pass (`solveIsland`, `solveIslandTOI`). Measured (p4 `impacts`): the tennis ball rises to
  2.919 m against 2.906 m for sequential impacts with each ball's drag, e 0.767 off the table and 0.661 between them (+0.4 %); the gap-0 cradle swings
  235 / 6 / 6 / 6 / 203 mm (one ball out, 86 % as far: steel's e 0.95 four times; the middle ones under 2.5 %); a tennis ball resting on a basketball
  on the table never rises. Slabs and planks (dominoes leaning on dominoes, a seesaw with a ball on it, stacked bricks) are left to planck's solve:
  there a strike is shared as before.
- Spring mass, where it acts (`simulate`'s spring masses, `SpringMass`). One end fixed: the moving end carries the inertia of the spring's fundamental
  mode, m_e = mₛ/β² − m with β·tan β = mₛ/m (m its body's own mass; springs from fixed points to one body reckoned together): the exact period of a
  mass on a uniform spring, Rayleigh's mₛ/3 for a light spring, up to 0.405·mₛ for a heavy one; and half the spring's weight (the fixed end holds the
  other half), the part beyond m_e's own weight applied at the anchor (`springWeight`), so a pad's plate and a hanging weight settle (m + mₛ/2)·g/k
  down, as a uniform spring's own weight puts them. Both ends moving: a uniform bar's consistent mass, mₛ/6 at each end and 2mₛ/3 at the middle of
  the anchors moving as they do (a velocity constraint, no body of its own): the pair carries all of mₛ, its stretching swing mₛ/6 at each end (it
  carried mₛ/2 at each, 11.6 % slow for mₛ = m). Measured (p4 `mass`): hanging springs' periods within 0.04 % of the uniform spring's fundamental
  (500 N/m with 450 g of steel and a 50 g weight: Rayleigh's mₛ/3 would be 5.7 % short); two 50 g balls joined by a 50 g spring, falling free: its
  stretching swing within 0.25 % of the uniform spring's; pads' plates, let go, move at most 10 µm (the catalog's starting compression and the engine's statics agree). A lumped mass is a real spring only while the
  spring is light against what it moves (a light ball on a plate whose springs outweigh it is thrown at the coil's release-wave speed x₀·√(k/mₛ), not
  by any lumped share): the catalog keeps its springs there (below).
- Catalog springs (machines/catalog_mechanisms.py, web/sim/catalog-mechanisms.js the same, number for number):
  - sized for the most the item can ever deflect them, whatever it is set to (batch 2 sized them by the setting, so a launcher's spring weighed 81 times
    more held 45 cm than 5 cm, and nothing held at 0): the launcher's to rest − max(3 cm, closed coils), the pad's and bumper's to their closed coils,
    the trampoline's to the mat pressed half its height (as before), the gate's to 85° or its closed coils (as before), the catapult's to its arm
    cocked 60° (its rest length still follows the cocked arm's height), the hanging spring's for the item's own 0.2 kg weight's bounce (`HANG_RATED`:
    a heavier weight stretches it past what its steel was sized for, as a real one would take a set; the engine keeps it linear);
  - at the most stress music wire takes without a set, `SPRING_STRESS` 1.0 GPa (45 % of S_ut = 2.2 GPa for 1 mm wire: Shigley table 10-6, set not
    removed; it was a 0.7 GPa working stress): m = ρ·4G·(½k·travel²)/τ², 2.5 g a joule. The default launcher's springs weigh 6.7 g each (3.7 g held 6 cm
    before), the default pad's 2.2 g, the default hanging spring's 3.0 g;
  - `_spring_cap(P, moved, n, fk, travel)`: a stiffness prop is built at most where a third of its springs' steel is `SPRING_SHARE` (0.3) of the plate,
    mat or bumper plate and a light ball (`LIGHT_BALL`, 2.7 g), written into `resolved` as the old cap was. There a launcher's throw is within 2.1 %
    of a 400-node coil (p4 `mass`, 7 launchers from the default to the smallest at its cap: −2.0 to +0.8 %); past it the steel would outweigh what it throws. No
    default is capped; the default launcher can be built up to 4960 N/m (slider 5000), the default pad to 10000. Capped e.g.: the 6 × 2 cm launcher on
    50 cm springs asked 5000 N/m is built at 33.9 N/m; the default launcher on 50 cm springs at 332 N/m; a 6 × 10 cm pad on 12 cm springs at 2088 N/m;
    the default trampoline's 50 g mat at 959 N/m (slider 3000). The gate and the catapult are not capped (their swings are their springs' fundamental);
  - the pad's starting compression and the trampoline's sag take half of each spring's weight ((m + mₛ)·g/k for their two springs), the hanging
    spring's coil-closure bound (2m + mₛ)·g/k;
  - the launcher's and hanging spring's card texts (`source`) say so.
- Summary falls rule (items.py `_Fall`, web/sim/items.js the same): a weld group any of whose parts a pin, rope (or chain) or pulley joint holds is not
  a body that can fall, as a pivoted one is not: a swing's seat, a rope pendulum's bob, a hanging chain's links, an Atwood machine's weights, a pulley
  lift's pail now report "falls over: false (0 of 0)" (the swing reported "true (1/1)", the Atwood machine "1/2"). fuzz-live.mjs has a group `hung`
  (in its defaults) for them. ai/goals.mjs trackTools.bodiesOf (the AI's own check, not this side's file) still counts them: it should skip the same
  weld groups, or the AI and the summary disagree on such items.
- Document admission (document.ts): a spring's `mass` must be zero or more; a document that does not fit the format is refused in one line, with its
  place in it: "<id>: the document does not fit the format: Expected a value greater than or equal to 0 at ["joints"][0]["mass"]" (a worker passes on
  an error's last line only, which was the bare path before).
- What changed in the scenes (batch 2's engine and builder → now): all 12 scenarios keep their goals; nine run exactly as
  before (atwood, ball-drop, car-ramp-dominoes, conveyor-delivery, empty, pendulum-dominoes, plinko, rube-goldberg, wrecking-ball: the same tracks). newtons-cradle's
  ends move 1.4 mm (its balls touch after the first strikes: they are carried on); spring-launch's ball 17 mm (its springs' steel, 2.2 → 6.7 g each, and the
  launch's sub-steps); trampoline's basketball 89 mm, its stories' top speeds 2.6 / 2.9 / 4.1 → 2.7 / 3.0 / 4.4 m/s, and "Basketball hits Tennis
  ball" is listed again (batch 2 had lost it). The starter (machines/check.py): --sweep 15 of 15 land, --grid 130 of 143 (as batch 2).
- Speed (node, best of 10 each, interleaved, this machine): the 12 scenarios 608 ms before batch 2, 726 ms with it (+19.3 %; its
  CONTRACT's "within +8 % but the trampoline" was wrong for spring-launch, +19 %), 683 ms now (+12.2 %): trampoline 38 → 151 → 101 ms (its light mat is
  sub-stepped while balls strike it), spring-launch 27.7 → 32.9 → 34.2 ms, every other scenario within 6 % of before batch 2 (atwood and empty, under 3 ms,
  19 and 29 %).
- Known limits: a crowded scene with a stiff spring in it follows the spring in fewer sub-steps (the work budget), steady but its rebounds followed less
  closely; sequential impacts are for round solids touching at one point (a slab struck through a slab is solved as one, as before); the catalog's
  spring steel is an ideal lower bound (the steel the stored energy needs: coil curvature and end turns add some); a document's spring heavier than what
  it moves is still lumped (a throw then too fast: the catalog never builds one); the ultralight slab and the motor past `SANE_SPEED` as before.
- Checked (the final engine, its bundle rebuilt, the server reloaded): research/rw-validate-p4.ts all PASS (crash with its 5000-scene fuzz,
  energy, stiff, mass, impacts), rw-validate-p3.ts 99 of 99, -p2 and -poly pass, rw-validate.ts and -slop print the same as before this repair;
  python3 machines/test_rg.py PASS (the starter's goal met), test_catalog 139/139, test_everyday 38/38, test_mechanisms 58/58; tools/parity/run.sh (every
  step 0 mismatches), node tools/parity-engine.mjs --catalog (ALL IDENTICAL: 131 scenes × 3 runs in node and Chromium, 4 extra rates, 4 error
  messages), node --no-warnings tools/parity/fuzz-live.mjs --n 2000 in 4 shards (4154 cases, 0 mismatches, the `hung` group included); engine-fuzz
  seed 99991 × 10,000 (above).
