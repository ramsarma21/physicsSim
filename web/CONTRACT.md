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
- The AI builder starts nothing higher than 3 m above the table top (`ai/schemas.mjs` `HIGHEST_START_M`: the 3D room's wide shot frames up to 3 m, its
  ceiling is 4.45 m up; a scene with `settings.camera` is left to its stage) and says so ("the room only shows drops up to 3 m"); an AI edit that puts a
  thing above the stage's top gets a taller stage with it (`set_scene {stage}`), otherwise an edit keeps the scene's stage (ai/DESIGN.md §18).
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
  (pow, cube) into `web/sim/engine-math.js`. In the bundle Math.sin, cos, atan2, exp, hypot and pow (and `**`) are tools/fdlibm.ts's (its
  hypot takes any number of arguments, as Math.hypot does: until 2026-10-20 it took two, so a `Math.hypot(x, y, z)` dropped z); the
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
  - `"focus"` and `"director-plan"` (2026-10-20): directed cameras, a shot plan filmed exactly (t is video time): "Filming module: directed cameras".
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

## Physics modules: the plug-in framework (2026-10-19)
Heat, liquids, circuits, light, sound, magnets and the rest of grades 3-8 come as **modules**: new files that plug into fixed extension points, so a
module never edits the engine, the builders, the view, the inspector or the AI. A scene that uses no module item and no setting builds and runs
EXACTLY as before (the 12 scenarios and the 10 gallery scenes: document, resolved props, warnings, summary and track byte for byte against the bundle
of 2026-10-19 16:43, in Python and in web/sim). How to write one: the guide and worked example in `tools/plugin-toy/` (`mod_toy.py`, `toy.js`,
`src/sim/toy.ts`, `mod-toy.js`; tested end to end by `test.mjs` and `browser.mjs`, never in the catalog).
- **Files of module `<name>`** (`[a-z0-9_]`), each optional but the first two go together: `machines/mod_<name>.py` (its catalog, `register_all(g)` as a
  catalog file's; found by items.py in name order and reloaded with it: `GET /api/catalog?reload=1`), `web/sim/modules/<name>.js` (its exact port,
  `register_all(F)` with F = items.js `FRAMEWORK`, plus `export const plugin`, below), `tooling/src/sim/modules/<name>.ts` (engine processes: `export default`
  a `ProcessKind` or a list), `web/models/mod-<name>.js` (3D models and view hooks). `node tools/gen-modules.mjs` writes the three indexes
  (`web/sim/modules/index.js`, `tooling/src/sim/modules/index.ts`, `web/models/modules.js`; `--check`) and says when a Python file has no port or the
  reverse. A module file that throws while loading is left out and said (stderr / console; `items.MODULE_ERRORS`, web/sim `MODULE_ERRORS`, the engine's
  `ENGINE_MODULE_ERRORS`): one module being written never stops the catalog or the engine. `PLAYGROUND_MODULES="a,b"` (names without `mod_`; `""` none) loads
  only those in Python and web/sim (tests; the identity checks run with `""`).
- **Scene settings** (`scene.settings`, all optional; machines/items.py `settings_of`, web/sim the same, number for number, refused alike with "can't
  build this scene: settings.…"): `gravity` ("earth" 9.81 | "moon" 1.62 | "mars" 3.71 | "jupiter" 24.79 | "none" 0, or m/s² 0…30; NASA planetary fact
  sheets), `air` (false = a vacuum: no buoyancy, no drag, no fans' streams acting), `air_density` (2026-10-20: kg/m³ 0.001…100 with air on, the air's
  density for the engine's drag and buoyancy, standard 1.2: a world's own air, Mars's surface ~0.020, Venus's ~65, Jupiter's 0.16, Saturn's 0.19 and
  Neptune's 0.45 at the 1-bar level [NASA fact sheets]; written as `airDensity` only when air is on and it is not 1.2; the modules' air reads it
  too (`ctx.settings.airDensity`, 2026-10-20: a fan's wind on a sail and liquids' buoyancy against air, fluids and flow; a hot-air balloon's lift, a
  paper plane's and a kite's push, air.ts `airRho`: on Mars a fan pushes a sail 60 times less), while the air module's pressures, jars and a
  balloon's size, keep a room's 101.3 kPa; 1.2 is the standard bit for bit), `room_temp` (°C −60…60), `time_lapse` (1…100000: seconds of slow processes per second of the run).
  The document carries `settings: {gravity?, air?, airDensity?, roomTemperature?, timeLapse?}` only for what differs from the standard (so an ordinary
  scene's document is unchanged), and the engine refuses values outside those limits (`RunSettings.airDensity`, `SETTING_LIMITS`). web/server.py's `clean()` passes
  `settings` through untouched (the builder checks it), so a running server needs only `?reload=1` for it. Builders read `c.settings`.
- **Catalog additions** (items.py and items.js identical): `ItemType(..., links=[Link(key, label, types, help)], readouts=[Readout(key, label, unit,
  digits, help, words?)], module="<name>")`; the type's catalog entry gains `links`, `readouts` and `module` only when it has them (every other entry is as it
  was). A link's value is the other item's id in `item.props[key]` (≤ 64 characters, kept by `clean()` as an optional prop); `c.link(key)` gives it when
  it names an item of the scene of an allowed type, else None. `c.process(kind, part, **fields)` adds `{kind, id: "<item>/<part>", item, ...fields}` to
  `doc.processes`; `c.sid(part)`; `c.sb.scene_items`; `register_build_hook(fn(sb, scene))` runs after every item is built (before the solids are
  tagged), for processes that gather several items (a circuit); `register_warning_hook(fn(scene, doc) → [{items, text}])` (2026-10-20) adds a
  module's plain-language warnings after the overlaps (`overlaps`: the layout's and the run's `warnings`; [] when it has nothing to say, so a scene
  without its items warns as before; the space module: an ordinary moving thing in a space scene floats off); `register_common_prop(Prop, applies)` (added by the mechanics module) lists a prop on
  every matching type (`common: true`, defaulted in the entry only), which builds nothing unless an item sets it (a hook reads it).
- **Engine** (`tooling/src/sim/plugins.ts`): `doc.processes[]` records are run by their registered kinds, in document order: `start`, `step` (every
  480 Hz step from t = 0), `slow(ctx, dt)` every `coarse` steps (default 48) with dt scaled by the time-lapse, `force(ctx, h)` every (sub-)step after the
  release, `end`. The context gives solid handles (pose, velocity, spin, mass, outline, push, twist, resize), contacts (`touching`), the air (`air`), a
  submerged volume (`submerged`: a sphere's cap, an outline below a line × depth), readings (`set`/`get`) and events. Admission refuses an unknown kind,
  two processes with one id, settings out of range, and whatever a kind's `check` says. The track gains `state: {item: {key: [value per frame]}}`
  (5 decimals), `events: [{t, items, text, kind?}]` and a resized solid's placement `scale` (its body against the document's: depth too, so its volume
  and mass go as scale³; below 1 % it is a sensor that no longer falls) — each only when a process made one. Gravity and the air's density are per run
  (`runGravity`, `airDensity` in physics.ts): exactly 9.81 and 1.2 without settings. Engine modules use only the deterministic math (+ − × ÷, sqrt, abs,
  min, max, floor, ceil, round, sign, trunc and the engine's sin, cos, atan2, exp, hypot, pow): the bundle and the server compute the same bits.
  A run's track depends on its document alone, never on what ran before in the same process: planck's contact pool is bypassed (physics.ts
  replaces `Contact.destroy` with planck 1.5's own minus the release into the pool), so a destroyed contact is never handed to another pair
  and a module may key state by contact object (fracture's pass-through contacts). Before this, a long-lived engine (the server's workers,
  the app's engine worker) gave fuzz-845 another track after fuzz-3 than in a fresh process; the 22 identity scenes are the same bits either way.
- **Summary** (items.py and items.js, number for number): a goal of a registered kind is reported by its module's rule (`register_goal_kind(kind,
  fn(ctx, goal))` in Python, `plugin.goals[i].summarize(ctx, goal)` in JS; `ctx` = `GoalCtx`: scene, doc, track, items, name, known, num, short_m,
  state(item, key), first_time(item, key, test), solids(item, dynamic)); the summary gains `readings: {item: {key: end value}}` and `happenings` (the
  track's events) only when the run has them.
- **View** (`web/view-plugins.js`; models3d.js hands `addViewPlugin`, `addFrameHook`, `ownMaterial` and `addThumb` to every model file): a model part marked
  `userData.frame = {hook, ...args}` is called at every drawn moment with the item's readings and its scale (`ownMaterial(obj)` before changing a colour:
  models share materials); `addViewPlugin({name, load(ctx)})` adds per-run objects (beams, field lines, glows, labels: `ctx.label()` makes a camera-facing
  text sprite on `HUD_LAYER` = PANE_LAYER, drawn by the canvas and the MP4 export, never by the table's mirror or the chrome balls). A resized body's model
  is scaled (and hidden at 0) by updateParts; `placementsAt` carries `scale`. A run with hooks, plugins or readings redraws every frame while it plays.
  A type whose picture in a scene a view plug-in draws, so no part of it has a model (a wire, the circuit board, a motion trail, the sunlight),
  registers its catalog photo's model with `addThumb(type, ({props, preview, looks, THREE}) => Object3D)` (web/thumbs3d.js uses it only when none
  of the preview's parts draws anything; without one those parts' plain stand-ins are photographed); a photo's props are the type's defaults with
  its automatic props at their listed defaults (a water tank's size and fill, a beaker's 300 mL).
- **Inspector** (`web/inspector-plugins.js`): a link is a select of the scene's items of the link's types (and "none"); a type's readouts show the last
  run's values at its end (`render(scene, selected, resolved, readings)`; app.js passes `S.sim.summary.readings`); the Scene group has Gravity, Air,
  Air density (kg/m³; greyed out with the air off), Room temperature and Time-lapse (only non-standard values are stored in `scene.settings`).
- **AI** (`web/sim/plugins.js`, the registry on `globalThis[Symbol.for("sandbox.plugins")]` so ai/goals.mjs and web/ai/goals.js stay import-free; ai/DESIGN.md
  §17): the catalog digest lists a module type's links (`key: link → the id of a <type>`) and readings and ends with each module's how-to, goal kinds,
  knobs, examples and the settings (nothing changes without modules); past 160k characters the plan and edit prompts carry its core tier and the full
  sections of the modules a request uses (`promptCatalog`); plan, refine and edit prompts get each module's own lines (`moduleSnippets`); plans and edits
  validate module goals by their `fields` (and read their spellings), link props, `plan.settings` and `set_scene {settings}`; the solver resolves a link
  named by id or by name, puts module goals into the scene's goals (with the plan's own label or none: one without a label is said in its own
  words, its kind's summary of its fields, "Unheated balloon does not rise 5 cm": by the run's summary, and by goalLabel for the AI's list, the card
  and the change lines, never a label minted from its kind alone that drops an `expect: false` or its numbers) and keeps the settings (`place.containers`, `place.interior`, `place.float` for module
  containers; `place.held` for a fixed thing the module's view holds up, a fan on a lab stand); ai/goals.mjs checks module goals on a run or from the summary; the edit step's rich digest lists each item's readings ("temperature 20.0
  → 58.0 °C (reaches its end value at 0.90 s)") and the modules' events; the make-it-work search turns a module's `knobs` (rel, m, deg, abs, link,
  choice, bool; a knob on `x` or `y` moves the item by its own `steps` in metres, default 2-6 mm, never back over what the person moved: a balloon
  lowered over paper scraps) and says them in its words ("turn the hot pad up (60 W → 72 W)"; a bool knob by its `more` words when it turns on and its `less` words
  when it turns off, with no "(true → false)": "switch the electromagnet off"; the card's past tense from `pastOf` in web/ai/fixer.js: its table of
  irregular verbs, else "changed", "emptied", "stopped", "rubbed"); change lines name links and settings, and an added thing as its
  module calls it (`words.added`: "a stack of 20 pennies"); a thing's name that is a module's proper noun is said as the module says it
  (`words.proper` {name: words}, matched without case; web/sim/plugins.js `properName`, used by `theName` in web/ai/fixer.js and orchestrator.js:
  "made the Earth heavier", "Mars", never "the earth").
- Checked (2026-10-19): `node --no-warnings tools/plugin-toy/test.mjs` ALL PASS (catalog, documents, resolved, warnings and summaries Python == web/sim;
  the toy's track from the server's engine == the browser bundle byte for byte, with readings, an event, a resized body, a force and the Moon in a
  vacuum; the AI layer end to end; 120 random toy scenes, no exception, nothing non-finite); `TOY_OUT=... node tools/plugin-toy/browser.mjs` ALL PASS
  (frame hooks, a view plugin's label, the shrinking cube, the inspector's link, readings and settings, headless Chromium); the 22 scenes identical to
  the before-bundle with `PLAYGROUND_MODULES=""` (and their tracks identical with modules loaded); ai/test (steps, digest, schemas, goals, core) and
  web/ai/test (solver, fixer, orchestrator) pass.
- **Framework repairs (2026-10-20)**:
  - A reading's value words: `Readout(..., words={0: "whole", 1: "cracked", 2: "in pieces"})` (whole-number codes; JS `{words: {...}}`) puts
    `"words": {"0": "whole", ...}` in the entry, in number order, only when given (every other entry is as it was). The inspector shows the word
    ("Broken cracked", never "Broken 1"), the edit step's digest "broken whole (0) → in pieces (2)", the catalog digest "broken (Broken: 0 whole, 1
    cracked, 2 in pieces)". Used by fracture (broken), granular (empty, clogged) and air (popped, holding, steaming, flying).
  - Which modules' full sections a plan or edit prompt carries (`ai/catalog-digest.mjs` promptCatalog, DIGEST_VERSION 9): a module is picked by one
    of its types in the scene or plan; a type's one-word name or key ("pitcher", "battery", "stopwatch"; never one a core type has, or that two or more
    core types are tagged with: "ramp"); a type's name, key, tag or goal spelling of two words or more ("ceramic plate", "stream table", "first class
    lever", "carts push apart"; two words written apart are one, "stop watch"); a word of its title no other title has, or of its goal kinds no other
    module has ("light", "melt", "orbit"); or its own words adding up to 1 (each 1 / the modules that use it). Never by an everyday or classroom word
    (`GENERIC`: class, grade, lesson, video, held, off, let, land, stand, together, run, bigger, spring, stop, between, ...) nor a word of a core type's
    key or name; and a core thing named in full ("glass marble", "plastic ball", "rubber duck") is taken out of the words first. Measured on 393
    module requests (each module's worked examples, every module type's name, the reviewer's cases) and 71 core-only ones (the imagine bench and the
    edit fixtures): 25 module requests miss a section (84 before), and 6 core requests carry one (64 before, 2.8k characters on average, 49.8k before).
  - A goal's numbers are the person's (`web/ai/goal-targets.js`): an edit answer to a request that asks for an outcome ("make it work", a fix, a
    rework) that makes a goal easier to meet (an `at_least_*`/`min_*`/count lowered, a `before_s`/`by_min`/`at_most_*`/tolerance raised, an exact
    target moved, a deadline dropped) keeps the person's number and label; the card says "Kept your goal “…” as it was (the AI wanted at least 4 L →
    200 mL: <its own why>); lowering a goal is yours to choose", a reply that found nothing adds "The AI wanted to lower the goals (…): that is
    yours to choose.", and while the goal fails a chip offers it ("Lower the goals to 200 mL" → "Change the goals “…” to at least 200 mL, …"). Words
    that ask for it ("goal", "target", or the new number itself: "only 200 mL", "a full minute") let it through. Every goal-number change and every
    settings change is a line of the change list ("changed the goal “The hose carries at least 4 L” (at least 4 L → 200 mL)", "changed the
    time-lapse (2× → 4×)"), and of describeDiff ("Goal “…”: at least 4 L → 200 mL").
  - Change lines call a thing by the person's words only when those words name it (one phrase ending in a word of its name, kind or tags: "the
    yellow ball"), never by words for what it should become ("a narrower hose", "the pump the air out", "the honey instead of water", "a bigger sail":
    its name is said); the card never says "Every item was changed" when the scene's only item changed.
  - Release gate: `tools/parity/module.mjs --module <name> [--n] [--mix] [--engine]` (+ `py_module.py`, which cleans each scene with web/server.py's
    `clean()` as a request is) checks any module: catalog entries, every type at its defaults, random props (on their steps and at their ends) and
    links (to an allowed item, to nothing, to a wrong one), garbage props, mixed scenes with partner items and settings: documents, resolved,
    warnings and refusals Python == JS; the node engine == the browser bundle byte for byte; finite placements and readings; summaries Python ==
    JS with every goal kind sampled. `tools/air/test.mjs` runs it for air (with a fan and a breeze). `tools/parity/run.sh` now runs air, fracture,
    space, staging, circuits, optics and measure too (circuits 1016 checks, optics 741, measure 769, air 1011: 0 mismatches each).
  - The static site ships `sim/modules/*.js` and `models/mod-*.js` minified (tools/build-static.mjs: whitespace and local names only, no expression
    rewritten; esbuild prints every number exactly): 2256 → 1602 KiB, 689 → 550 KiB gzipped. Checked: the minified copy's catalog, the 22 scenes and
    630 seeded module scenes (documents, and summaries with sampled goals on engine runs) byte-identical to the source. (The module model files still
    load at start: the palette's 3D thumbnails, the bake workers and the exports draw every type's model, so loading them per run needs a gate in
    view3d.js, thumbs3d.js and the bake worker: not done.)

## Liquids module (2026-10-19): water in containers, floating and sinking, displacement, boats and sails
Files: `machines/mod_fluids.py` (catalog), `web/sim/modules/fluids.js` (its exact port + the AI plug-in), `tooling/src/sim/modules/fluids.ts` (the
processes) with the physics in `tooling/src/sim/fluids.ts`, `web/models/mod-fluids.js` (models, frame hooks, a view plugin). Nothing of it runs in a
scene without a liquid container, a sailboat, a hull boat or a breeze (the 22 scenes are byte-identical, `identity.mjs`).
- **Items** (category "Liquids"; sizes and values cited in each type's `source`): `water-tank` (`style` aquarium | tub | trough: glass 50 × 30 cm with
  black trims, a plastic tub 60 × 18 cm, a 3.05 m vinyl rain-gutter lane; `length`, `height`, `depth`, `fill` and `color` follow the style until set;
  fill 0.7 of the inside's height, a trough 0.85), `graduated-cylinder` (100 / 250 / 1000 mL, 1 / 2 / 10 mL marks, a 12 mm hexagonal foot), `beaker`
  (250 / 600 / 1000 mL), `measuring-jug` (1 L), `density-column` (presets of layers: honey, corn syrup, dish soap, water, vegetable oil, rubbing
  alcohol, densest at the bottom; `layer_ml`); `sailboat` (pine hull `hull_length` 0.12-0.40 m, `hull_mass`, keel fin, dowel mast, `sail` tiny 48 /
  small 120 / big 320 cm², a `sail_area_cm2` set overrides it, `sail_material` paper 80 / plastic 46 / cloth 120 g/m², colours), `clay-boat` (`mass` of
  modelling clay at 4 mm walls: the boat grows with it), `foil-boat` (kitchen foil 0.016 mm, `length`, `width`, `height`), `penny` (2.5 g, `count`: one
  solid stack, a boat's cargo), `grape` (1060), `cork` (200, on its side), `plastic-bead` (polyethylene 950), `pebble` (granite 2650), `breeze` (a steady
  wind over the whole scene from its wind sock: the engine's round jet made 20 m across, `speed`, `direction`, `on_at`); `soap-drop`,
  `capillary-tube`, `paper-strip` (surface tension, below). Every container is fixed and
  upright (its angle is not used); its anchor is the middle of its base. Liquids (at 20 °C): water 998.2 kg/m³, 1.002 mPa·s [IAPWS-95]; salt water by
  `salt_pct` 0-26 (CRC NaCl table: 10 % 1070.7, 12 % 1085.7, 26 % 1197.2; viscosity likewise); sea water 1024.8 [Sharqawy 2010]; vegetable oil 920,
  0.06 Pa·s; corn syrup 1380, 2.5 Pa·s; honey 1420, 10 Pa·s; dish soap 1050, 0.5 Pa·s; rubbing alcohol (70 %) 880 (the approximate ones say so).
- **Document** (`doc.processes`, both builders alike): `{kind: "liquid", id, item, x0, x1, floor, rim, area, layers: [{words, density, viscosity,
  height}]}` (world m; `area` the horizontal cross-section, π r² for a round vessel); `{kind: "hull", solid, points (its envelope in that solid's frame),
  rim: [i, j], depth, material_ml}` (an open boat); `{kind: "sail", solid, area, push}` (readings only); `{kind: "displace", item, volume_ml}` (a build
  hook adds it, only in a scene with a liquid, for catalog items whose outline × depth is not their volume: an egg 1080 kg/m³ [Hamilton 1982], a mug and a
  traffic cone and a LEGO brick that fill with water, a full can 1040, a full bottle 1005). In such a scene a fan's base also gets `stand: "post"`.
- **Physics** (`fluids.ts`; every (sub-)step, one process for all of a run's liquids, after the air's forces and before the world is stepped):
  - Levels: each layer's liquid volume is conserved; its top is where liquid + what the bodies push under fill the cross-section (bisection, 2⁻³²);
    more than fits under the rim spills from the top layer down and stays spilled.
  - Buoyancy (ρ − ρ_air)·g·V of what is under each layer's top, at that volume's centroid (the engine already lifts every body by the air). A ball
    displaces its outer sphere, a cylinder πr²·length, a slab or polygon its outline × depth (× `displace`'s true volume over it); a hollow hull its
    envelope less the water that has come in. Things inside a dry hull (pennies) are not in the liquid.
  - Hulls flood gradually: water pours in over any corner of the opening that is under the surface, as over a weir, Q = 0.6·(2/3)·√(2g)·b·δ^{3/2}
    (White, Fluid Mechanics §10.7); a brief dip lets in drops, a rim held under fills it within a second; full (its envelope less its material), it
    displaces only its material (`material_ml`) and sinks if that is denser.
  - Drag: Newton's flat-plate drag on each wet side (C_d 1.05, the air drag's), a sphere's whole Clift–Gauvin curve, and a viscous drag (Stokes 3πμd on
    the equal-volume sphere with Schiller–Naumann's correction) that dominates in syrup and honey; added mass C_a·ρ·V while it touches nothing and hangs
    from nothing (sphere ½ [Lamb §92], cylinder 1, block ½: provisional); wave damping 0.1 of critical on the heave and pitch stiffness of every
    surface or interface it pierces (provisional, Vugts 1968). The linear parts are solved implicitly with the body's mass and added mass (the air's
    pushes on it included), so any viscosity is steady and a body hangs at its exact terminal speed.
- **Readings** (`track.state`): a container's `level_mm`, `volume_ml` (what its scale reads: liquid + what is under the surface), `spilled_ml` (and
  `layer1_mm`… for several layers); an item that is or was in a liquid: `submerged` (0-1), `buoyancy_n` (ρgV), `afloat` (the liquid holds up ≥ 97 % of
  its weight, smoothed over 0.25 s), `sunk` (it rests on something, rising or falling slower than 2 cm/s: rolling along the bottom counts; held up less), `draft_mm`; a hull's `water_ml`, `flooded`,
  `freeboard_mm`; a sailboat's `air_ms` (the air's speed at its sail) and `push_n`. Events: "<item> fills with water and sinks", "<container> overflows".
- **Goals** (Python == JS): `floats {item}` (afloat at the end), `sinks {item}` (sunk at the end), `level {container, at_least_ml?, at_most_ml?}`
  (its scale's reading at the end). Boat races use the measure module's `farther {a, b}`.
- **Sails**: the sail is set 45° to the boat's line (the camera sees it; a sail square to the wind is edge-on in a side view); its push along the wind
  is 0.8·½ρ·A·v² (a square flat plate at 45°: normal-force coefficient ≈ 1.13, Ortiz, Rival & Wood 2015; 1.17 square to the wind, Hoerner). The
  engine's own air drag on the sail's slab gives exactly that (its depth = 0.8/1.05 of the sail's width; the model draws the true width). The sail is a
  welded solid, so the fan's jet is read at its middle (`sail_middle`, resolved: its height over the boat's anchor — where a fan's axis must be).
  A fan's jet keeps full speed for 6.2 jet diameters (5.6 fan diameters), then falls as 1/x [Rajaratnam]: with the default 0.30 m fan every distance
  under 1.67 m pushes the same; compare near and far fans with 0.12 m fans (full speed to 0.67 m).
- **AI** (`plugin` in web/sim/modules/fluids.js): its how-to (the containers, every liquid's density, the floating rule, cargo, sails and fans with
  their heights, the jet's core, separate lanes for a comparison), plan / edit / refine lines, ten worked examples (one per lesson demo: F1, F2,
  F4, F5, F6, F7, F8, F9, F10, F12; each an `ask`, a `how` line — the digest lists only examples with one — and a `plan` the tests solve), goal kinds
  with aliases ("float", "sink", "water_level"…), knobs for the make-it-work search (a sail's area, relative steps ×1.1…×2.7; a fan's speed and
  diameter (with its core's flat region said); the breeze's speed; a tank's salt (2…12 %, cost 2), fill (cost 2) and liquid (cost 8: honey or syrup
  saves almost anything, so it comes late); a cylinder's fill; a foil boat's sides; a clay boat's clay (×1.25…×3); a penny stack's count (cost 2);
  a hull's weight last (cost 3: a hidden change, after what a lesson shows)), digest
  lines (a container's liquid, density, depth, surface and rim heights, its reading start → end; an item's float/sink state, % under, draft, average
  density, buoyancy against weight; a hull's freeboard and flood; a sail's area, wind and push, and "NO wind reaches its sail" when a fan misses it),
  change words ("sail small (120 cm²) → big (320 cm²)", "salt 4 → 12 % (1026.8 → 1085.7 kg/m³)"), added words (`words.added`, a new plug-in point:
  web/sim/plugins.js `addedWords`, used by web/ai/orchestrator.js's change card: "Added a stack of 20 pennies on the clay boat", not "a penny"),
  and placement: `place.interior` (a container's
  inside from its liquid record) and `place.float(thing, container, riders)`: the solver starts a thing put `inside` a liquid container at its own
  floating height (the engine's exact balance, so nothing bobs at the release) and, after everything is placed, lowers a floating thing and what rests
  on it (a boat's pennies) to its loaded height (web/ai/solver.js §4b); a thing that sinks starts on the floor (`restingY(thing, container)`,
  exported for scene makers and tests). `place.held(type, types)` (a new plug-in point, web/sim/plugins.js `heldByModule`): a fan in a scene with
  a liquid container is held up by the stand the view draws, so the solver does not call it floating (web/ai/solver.js mustBeHeld).
- **View** (`web/models/mod-fluids.js`): a container is drawn on its floor part (its walls draw nothing): an aquarium of faint clear-coated glass panes
  with black trims (the bottom one no taller than its glass floor, so what lies there shows), a coloured tub, a white vinyl gutter; graduated
  cylinders, beakers and the jug with printed mL scales (a decal), a meniscus ring at the surface. A liquid is an alpha-blended body (tinted by its
  depth, 1 − e^(−depth/d), gently rippled), so what is in it, glass marbles and ice included, shows; its top follows `level_mm` (frame hook
  `fluids:level`; a column's layers `layerN_mm`). Sailboat: a painted hull narrowing to its bow, a wooden deck, keel, mast with a pennant, the sail let
  out 45° with a slight belly and a boom; clay and foil boats (open trays; the water inside shows from `water_ml`), stacked pennies, grape, cork, bead,
  pebble (granite texture), a wind sock that lifts with the wind. A view plugin (`fluids:fan-stands`) draws a lab stand behind a fan raised off what
  is under it (a lane's fan at its sail's height). A raised tank stands on the view's posts (`stand: "post"`).
- **Engine access** (added to plugins.ts / physics.ts for it): `SolidHandle.body()` → `BodyView {key, mass, inertia (about the centre of mass), center,
  velocity, spin, force, torque (applied so far this step, besides gravity), jointed}`.
- **Validated** (`node --no-warnings --import ./tools/engine-math-node.mjs research/rw-validate-fluids.ts [archimedes|float|ice|sink|stokes|rise|
  displace|clay|egg|pennies|sails|column|spill|determinism|fuzz|all]`, 39 checks, ALL PASS): buoyancy = (ρ − ρ_air)·g·V_sub to 1e-12 and the level
  rise = V_sub/area to 1e-12 m (core), a held block's reading = ρgV; F1 a 10 × 5 × 5 cm hardwood block floats 35.05 mm deep (theory 35.05), starts at
  rest at its placed height, bobs at 0.458 s (2π√((m + m_a)/k) = 0.451 s) and the waves damp it 20× in 2 s; F2 ice 91.87 % under in fresh water
  (91.86), 89.49 % in sea water (89.47); F4 a 1 in steel ball reaches the floor of the 30 cm aquarium at 0.429 s (the drag ODE: 0.428 s) and rests
  there; Stokes: a 5 mm steel ball through honey at 8.728 mm/s (8.728); a ping-pong ball starts up at 15.42 m/s² (with ½ρV added mass 15.48; 120
  without); F5 five 16 mm marbles raise 60 mL to 70.72 mL (70.72), a pebble reads its own volume to 0.0001 mL; F6 a 50 g clay ball sinks, the 50 g clay
  boat floats 20.99 mm deep (Archimedes on its hull 20.98); F7 an egg sinks in tap water and 6 % brine, floats in 12 %; F8 a 7 × 7 × 1.5 cm foil boat
  floats with 22 pennies (2.7 mm freeboard) and floods and sinks with 32 (ideal capacity 29: near it any tilt floods it); F9 near fan 0.15 m vs far
  0.9 m (0.12 m fans): 1.18 m vs 0.78 m in 3.5 s, ratio 1.51 (spec ≥ 1.25), the far sail's air 3.39 m/s (Rajaratnam 3.42); F10 big vs small sail ratio
  1.25 (≥ 1.15), tiny/small 0.77 (≈ 0.75); F11 each sail's drag area 1.05·h·depth = 0.8·A to the rounding; F12 the grape rests on the syrup, the bead
  where oil meets water, the cork on top; an over-full tank spills 1094.04 mL (exact) and stays at its rim; two runs bit-identical; 60 fuzz scenes
  (random liquids, styles, raised tanks, things dropped in at angles) clean. Demo scenes (both engines byte-identical, Python and web/sim summaries
  equal, every goal met): F1, F4, F5 (pebble, marbles), F6, F7, F8, F9, F10, F10b, F12.
- **AI acceptance** (the real app on its own server, headless Chromium, real Opus 5.5 calls; `scratchpad engine4/fluids/tools/ai-accept.mjs`):
  Build with AI on an empty table, three plain lesson requests (two sailboats with near and far fans in stacked troughs; a clay ball and a clay boat;
  an egg in tap and very salty water): 3/3 built with every goal met in each of two full runs, 73-121 s (5 of the 6 builds met them in the first
  run, one after 12 tuning runs). Edit with AI, three requests: "change the top boat's sail from small to tiny" (exactly that: "sail small (120 cm²)
  → tiny (48 cm²)", the boat renamed to match, the goal still met); "put a stack of 20 pennies in the clay
  boat" (the card says "Added a stack of 20 pennies on the clay boat … Clay boat floats: no ✗" and offers a checked fix: more clay 0.05 → 0.1 kg, or
  honey for the water, both goals ✓ after it); "move the bottom boat 0.8 m further from its fan" (moved exactly 80 cm, the card says the near boat no
  longer goes farther and offers a checked fix: the far boat's sail, or its hull 0.08 → 0.1 kg, all 3 goals ✓). Success: 6/6 in run 1, 6/6 in run 2,
  2/2 in a re-run of the edits after the knob costs and `words.added` (every goal met, every broken edit with an honest card and a checked fix).
  Final run on the tree of 2026-10-20 (machine load 180-200): 5/6 — the three builds and two edits as before; "move the bottom boat" moved it
  exactly and said so honestly, but the 1-minute search got through only 29 runs (3.8 s each at that load) without a fix; alone it found "make the
  far boat's hull heavier (0.08 → 0.1 kg), checked: all 3 goals ✓" in 28 s, and node's search finds "make the far fan smaller (12 → 11 cm)" in 22
  runs. A last run with the ten worked examples in the digest (before 2026-10-20 they had no `how` line, so the prompts left them out): the three
  builds 3/3 again, the sail and boat-move edits with their checked fixes; the pennies edit honest ("Clay boat floats: no ✗") but its search did
  54 tries in its minute at load 200-260 without the fix that node's search finds after 32 runs ("use more clay 0.05 → 0.1 kg", as runs 1-3
  found). Totals: builds 12/12, edits 13/15 (both misses a search out of time at that load, the cards honest).
- **Parity** (`tools/parity`, 2026-10-19): the catalog-port checks run Python without physics modules, as their JavaScript side has none
  (`PLAYGROUND_MODULES=""` in py_dump.py's core mode and in py_dump_cat.py, `env` in mechanisms.mjs; catalog.mjs's registration order check
  compares the catalog files only): a module's types are built on the catalogs' materials, so with catalogs stubbed Python stopped at a KeyError
  (glass, PET). With a server and node started with `PLAYGROUND_MODULES=fluids`: core 21995 cases, server 21995, browser 12558, everyday 29758,
  everyday --integrated 29843, catalog_items 39653, the three catalogs together 73984, mechanisms 13989, fuzz-live 768 (all 127 types against the server, through web/sim and the app's
  local API with the engine bundle, track byte for byte): 0 mismatches each; `node tools/parity-engine.mjs --catalog`: all 14 Liquids items
  byte-identical in the reference worker, the bundle in node and Chromium. The module's own check, `node --no-warnings tools/parity/fluids.mjs
  [--n 12] [--engine]` (in run.sh; Python side tools/parity/py_fluids.py; the lesson demos in tools/parity/fixtures/fluids-demos.json): every type at
  its defaults, limits and 12 random props, with things dropped into random liquids or started at their floating height, boat lanes with fans and a
  breeze, pennies on foil boats, the catalog's own floaters and sinkers in random liquids, and scenes without a container (no liquid, displace or
  stand record): 946 checks, 244 documents, 62 engine runs (node engine == bundle byte for byte), 165 goals judged Python == JS, every demo's
  outcomes met, 0 mismatches. (browser-mechanisms.mjs, like mechanisms.mjs, asks Python for its catalog without physics modules, whose common props
  are not the port's.) research/rw-validate-p3.ts and p4.ts copy the engine's subfolders
  (modules/, matter/) into their 4800 Hz copies, since document.ts imports the modules' index.
- **Known limits**: 2D: a body's displaced volume is its side outline × its depth (round items that state a true volume only through `displace`); a
  boat's sail force is in the picture's plane only (its side force is taken by the keel, unseen); in 2D the sail's push pitches the boat bow-down — a
  big sail in a full 5 m/s jet dips a 20 cm boat's bow about 17° until it gets going, about 3° once sailing (statics: ρ·g·I_L of its waterplane against
  the push's lever), never capsizing; liquids stand only in fixed containers (a filled cup that tips does not pour; melt water or pouring can be added
  by another module through `pourInto(scene, container, m³)`); layers never mix; surface tension only as below (no menisci on walls, no
  drops), no walls' effect on a falling ball (Faxén), no
  splash; the level responds at once (no waves travelling); added mass is isotropic; a flooded hull's inner water adds no inertia. Speed: a scene of a
  few floaters costs a few ms a step more; stacked loose pennies are expensive for the engine's time of impact (use `count` stacks).
- **Repair of 2026-10-20** (all of it only in a scene with a liquid container and the new things; the 22 scenes byte-identical, every earlier fluids
  demo's document and track byte-identical):
  - *Open vessels float* (`VESSELS` in machines/mod_fluids.py and its port: the catalog's `coffee-mug` and the heat module's `bowl`): in a scene with
    a liquid the build hook gives each a `{kind: "hull", ..., vessel: true}` record instead of the mug's `displace` one: its envelope is the convex
    outline of its floor and walls (rounded to 0.01 mm, rim = its two top corners), its depth that of a frustum of its top D and bottom b widths,
    π(D² + Db + b²)/(6(D + b)) (a mug 64.08 mm: 496.9 mL to its rim; a 15 cm bowl 709.3 mL), `material_ml` its mass over its material's density,
    `extra`/`extra_ml` the parts outside the envelope (a mug's handle) that displace their true volume while it floats. Engine (fluids.ts hull
    `held`, `extra`; modules/fluids.ts `heldIn`): what another module keeps in it (the flow module's basin water, which it adds to the body's mass)
    is its body's mass over its own parts', taken at the outside liquid's density: it does not come off the envelope, takes up room (it floods when
    the water over the rim and it fill the envelope less its material), the flood water rests on it, and once flooded it displaces as much as it is
    (neutral). Measured: a melamine bowl floats upright (buoyancy = weight to 0.1 %); a hose from a beaker on a shelf fills it to 559 mL when its
    rim reaches the water (theory ρV_env − m: 565), it floods and sinks at 10 s; a foam bowl never sinks; the stoneware mug (330 g, its handle 15 %)
    floats tipped toward its handle and floods (2D statics: GM 3 mm against the handle's 9 mm lever), a light one floats on its side, as real light
    cups do. The solver's `place.float` starts a vessel at its height. The catalog's cup, plastic-cup, jar, bucket and box are fixed: never float.
    Not yet: a tap's or a pitcher's stream into a vessel that floats in a tank joins the TANK's water (tooling/src/sim/modules/flow.ts `land()`
    gives a particle to a RegionStore once it is below the tank's surface, though it is inside a BasinStore's inside): the flow module's change; the
    how-to and the edit digest say so and build the hose version.
  - *Goal* `floats_then_sinks {item, by_s?}` (Python == JS, aliases fills_and_sinks, fills_then_sinks, sinks_when_full…): it floats first (afloat 1),
    later sinks (sunk 1) and rests on the bottom at the end; never met by a thing that sank at once (entry `floated_s`, `sank_s`, `flooded`).
  - *Surface tension* (records `surface`, `soap`; layers get `tension` N/m and `wets` (the largest contact angle it allows, °) only in a scene with
    surface things: water 72.8 mN/m [IAPWS 2014], salt water + 1.64 mN/m per mol/kg [Weissenborn & Pugh 1996], sea water 73.8, oil 32 (wets 15°),
    syrup 75, honey 55, dish soap 30 (25°), alcohol 25 (10°), approximate except water). The magnetism module's `paper-clip` (0.45 g, 97 mm of
    0.9 mm wire): a `surface` record per clip, contact line 0.194 m (both sides of its wire), contact angle 80° (lightly oiled steel, provisional),
    and a `displace` record (its wire's volume). Engine (fluids.ts `meniscusPull`, `surfaceHoldEnergy`; modules/fluids.ts `surfaceStep`): its lowest
    side's contact line in four quarters, each pulled up γ·sinφ per metre where the meniscus is pushed down d = 2·l_c·sin(φ/2) (l_c = √(γ/(Δρg)),
    2.73 mm for water), damped at half the critical rate of γ·C/l_c; the surface lets go for good where d passes 2·l_c·sin(θ/2) (3.51 mm), and a
    clip that arrives with more kinetic energy than the surface can take (its pull's work to that depth less its weight's) breaks through: laid
    gently (the solver's start: buoyancy + pull = weight) it floats in a 0.776 mm dent (theory 0.776), dropped from more than about 3 mm it sinks; on
    oil it sinks. The pulls are solved with the liquid's own pushes (the body's force), so a held clip rests exactly. `soap-drop` (a dropper on a stand,
    its anchor the tip, `at_s`): its drop lands after its fall, √(2h/g), and the surface's tension from there is soapy (30 mN/m, wets 25°) out to
    0.12·t^(3/4) m [Jensen 1995] (provisional): a held clip sinks when the film reaches it; a body across the film's edge is pulled toward the clean
    side, (γ ahead − γ behind) × its width at the water line: a 7 cm foil boat with the drop behind it starts at 2.9 m/s² (pull 3.0 mN on 0.43 g,
    less added mass) and keeps pace with the film's edge, 36 cm in 4.4 s.
  - *Capillary action* (records `capillary`, `wick`): `capillary-tube` (`bore_mm` 0.3-4, a fixed glass tube held by a stand, its anchor its
    bottom end): the column climbs at Washburn's rate (Poiseuille over the wetted length, implicit in its weight, never faster than √(2γcosθ/(ρr)),
    Quéré 1997) to Jurin's h = 2γcosθ/(ρgr): 29.74 mm in a 1 mm tube (theory 29.74, 90 % in 0.300 s, Washburn 0.301 s), 7.43 mm in 4 mm; soapy water
    12.25 mm; corn syrup creeps. `paper-strip` (paper towel 4×10⁻⁵, filter paper 1.1×10⁻⁵, printer paper 3×10⁻⁷ m²/s, Lucas-Washburn h² = D·t
    with D ∝ γ/μ, slowing toward its highest; approximate): 15.0 / 8.1 / 1.7 mm in 6 s. Goals `climbs {item, at_least_mm?, at_most_mm?}` (rise_mm or
    wet_mm at the end) and `climbs_higher {a, b}`.
  - *Readings*: a held clip's item `surface_mn`, `on_surface`; a soap's `landed`, `spread_cm`, `surface_y`; a tube's `rise_mm`, a strip's `wet_mm`, and
    both `column_mm` (the liquid in it over its bottom end, for the view). Events "<item> breaks through the surface and sinks", "<soap>'s soap lands
    on the water".
  - *AI*: how-to and plan lines (vessels, the hose version, fixed cups, surface tension, tubes and strips on stands, a sail's area set overrides its
    size), worked examples F13 (bowl and hose), S1 (clip and soap), S2 (soap boat), S3 (tubes); goal kinds above with `detail`; knobs: a tube's
    bore, a strip's paper, a soap's time and place; `place.held` for tubes, strips and droppers (the view's stands); digest lines (a vessel's volume
    and what was poured in, "NO water reaches it from the tap" while it floats; a clip held or let go; a tube's or strip's rise; the soap's spread);
    change words: the sail's line from the items as they were and are, "sail small → big (104 → 320 cm²)" (web/sim/plugins.js `changeWords(type, key,
    a, b, nameOf, items)` and web/ai/orchestrator.js `propChange(..., items)` pass {before, after}: never "NaN" for an unset sail area); `words.keys`
    sail and sail_area_cm2 both "sails?", so the person's sail choice holds the area too (the fix search never turns it back past a quarter).
  - *Catalog*: `fill_ml` is labelled "Amount" (the cylinder's, beaker's and jug's "Liquid" is their liquid choice); new material "paper strip".
  - *View*: a container that starts empty builds its liquid body and meniscus anyway (hidden until the level hook reads liquid: a beaker the flow
    module pours into shows its water); the dropper (glass, green soap, red bulb), the tube's dyed column (frame hook `fluids:column`), the strip's wet
    part; view plugins `fluids:soap` (the falling drop, the film spreading on the surface) and `fluids:clamps` (a lab stand on the table behind the
    container for a tube, strip or dropper).
  - *Validated* (research/rw-validate-fluids.ts `vessel` 8, `surface` 11, `capillary` 10, `soapboat` 3; with the earlier sections 71 checks ALL PASS,
    the fuzz with bowls, clips, soap, tubes and strips); tools/parity/fluids.mjs (17 types; clips, soap, tubes, strips and vessels in random liquids;
    the demos S1, S1b, S2, S3, S4, F13 in fixtures/fluids-demos.json, every goal met; node engine == bundle; summaries Python == JS): 0 mismatches.
    Engine parity (`node tools/parity-engine.mjs --catalog`): every Liquids item, the mug, the bowl and the paper clip byte-identical in the
    reference worker, the bundle in node and Chromium. Inspector (headless, the real app): the beaker's and jug's "Amount" and "Liquid" rows, the
    tube's, strip's and dropper's settings and readings, no two rows of an item sharing a label.
    AI acceptance (the real app on its own server, headless Chromium, real Opus 5.5 calls): Build with AI "a paper clip floats until soap makes it
    sink" (clip laid on the surface, soap at 2 s, sinks at 3.3 s ✓, 65 s), "water climbs higher in the thinner of two tubes" (1 and 4 mm: 29.7 against
    7.4 mm ✓, 56 s), "a tap drips into a small floating plastic cup until it fills and sinks" (said plainly: no tap into a floating vessel and the
    cups are fixed, so a melamine bowl filled by a hose from a beaker on a shelf; floats, then fills and sinks at 9.6 s ✓, 88 s), "a soap-powered
    boat" (38 cm ✓, 68 s), the X6 fan sailboat (✓, 58 s); Edit with AI "Use a bigger sail" on the X6 scene: "sail small → big (104 → 320 cm²)",
    and its checked fix goes on the same way ("a bigger sail (320 → 448 cm²)"), never back. 6/6.
    Not yet: drops of water counted onto a penny; a clip seen edge-on in the side view (a raised camera shows it).

## Measure module (2026-10-19): instruments, lanes, timing, distance, speed, force, mass, angle; trails and boards
Files: `machines/mod_measure.py` (catalog, goal kinds), `web/sim/modules/measure.js` (its exact port + the AI plug-in), `tooling/src/sim/modules/measure.ts`
(the instruments' processes), `web/models/mod-measure.js` (models, frame hooks, view plugins). Nothing of it runs in a scene without one of its items (the
22 scenes are byte-identical in Python and in web/sim, `identity.mjs`). Sources are cited in the files ([VERNIER], [OHAUS], [NIST-HB44], [OIML-R111],
[HUMAN-RT], [ASPHALT]).
- **Ghost solids** (engine, document, items): a solid may carry `ghost: true` (document.ts `SolidRecord`, part.ts `SolidPart`): its fixture's collision
  mask is 0 (physics.ts `ghostFilter`), so nothing ever touches it (no contacts, impacts or time-of-impact), while it is drawn, picked, framed and weighs
  what its body says (a welded ghost part adds its mass to its group). `items.overlaps()` (Python and web/sim) leaves ghost solids out. An instrument's
  face, a painted line, a tape, a light gate, a trail's tag and a board are ghosts; so are the pan balance's pointer and pan hangers (they pass in front of
  the post and through the pans' middles). Without `ghost` every fixture's definition is exactly as before. The module's ghosts and its lanes also
  carry `stand: "self"` (a render hint like `legs`): they draw what holds them up (a pole, the floor they are painted on, a lane's legs), so the AI's
  solver adds no wooden stand under them (its `mounted` test reads any `stand`) and the view plans no mount for them (only post | panel | wall are its).
  The AI's scene digests never count a ghost as a support: `ai/scene-digest.mjs` leaves other items' ghost solids out of `rests_on` and marks a
  display-only item (every solid a ghost) `ghost: true` and a partly-ghost one's `firm_box`, which `ai/rich-digest.mjs`'s "standing on" reads (a stopwatch's
  face never holds a lane up); the solver's "floats" check skips a thing with no finite outline (a wire).
- **Items** (category "Measuring"; links are item ids in props, readouts are `track.state[item][key]`):
  `lane` (a static floor board 2 cm thick of `surface` gym floor | vinyl | concrete | carpet | asphalt; `length` 1…60 m, `margin` of floor before 0 and
  after the end, `marks_every`, `labels`, `label_cm` upright number cards at the back edge, `start_at`, `finish_at` (auto: follows `length`), `width`,
  `color` (a pale paint); anchor = its 0 m mark on its top, so the d-metre mark is at lane.x + d; a raised lane stands on legs drawn by the
  `measure:supports` plugin, down to a lane under it, the table or the room's floor; `end_stop` (default on, with 10 cm of floor or more past the
  end): a static foam bumper 8 × 10 cm on the floor's far end, so what races past the finish stops on the lane instead of running off a raised
  one; a `measure-mark` process record {zero, start, finish} (world x of its marks; no engine work) lets a goal check that has only the document
  find its finish); `start-line` / `finish-line` (painted bands, `sign`, `gate` posts; a `measure-mark` record {x});
  `stopwatch` (links `watch`, `start_line`, `finish_line` (a line or a lane); `start` release | moves | crosses (`start_x`); `stop` crosses (`stop_x`) |
  stops | hits | at (`stop_at`) | never; `reaction_s` 0…0.3 (a hand's delay on presses that answer something seen); `counts` run | lesson (seconds ×
  the scene's time-lapse); `face_cm` 6…60 (drawn only); `on_table` a real 6 × 8 × 1.5 cm 60 g one; readouts seconds, meters, start_s, stop_s, running,
  lesson_s; with nothing to watch (no watch link, or one that names nothing) a watch that starts at the release and stops `at` or `never` runs as
  a plain clock, any other reads 0); `measuring-tape` (`watch`, `point` front | back | centre, `from` left end | right end, `length` 0.3…30 m: meters =
  the point's place along it, every step, within the tape: 0 … length; past_end 1 while the point is beyond its end); `speed-gate` (`watch` else the first thing through, `pair` an earlier gate, `beam_height`: the beam crosses the track at (x, y); entered_s
  and exit_s where the thing's front and then its back pass the beam's point along the way it moves, interpolated between steps; length = its chord
  through that point along its motion (a photogate's flag), speed = length / blocked_s, between_s; a car passing level and a ball falling through read
  their track's speed to 0.00 %); `speedometer` (a radar sign: speed, top, mean); `spring-scale` (`range` 2.5…50 N, k = range /
  0.10 m, a static clear tube and a 12 g steel hook on a spring (30 % of critical damping with half its range hung on it), `hook` link: a build hook ties the linked item's
  topmost moving solid to the hook with a 1.5 mm string (a rope joint) as placed; newtons = k·stretch − the hook's weight, smoothed over 0.2 s; grams
  = newtons ÷ 9.81 (the Earth's g whatever the run's: a scale is calibrated on Earth and shows weight, so 1 kg on the Moon reads 1.62 N and 165 g);
  the hook bottoms out 5 mm past full scale (a planck rope joint the process makes between the spring's ends at the start, slack until then, never
  drawn): `over` 1 past its range, and the spring never stretches past its tube; the view hangs its ring from a retort stand (`stand: "self"`));
  `kitchen-scale` (digital | mechanical, `tare`, `capacity_kg`: the platform is static; grams = Σ m·(g + a_y) over every moving item resting on it,
  directly or stacked, not also leaning on another fixed solid (a solid resized to nothing, such as a piece parked in an egg, is skipped), ÷ 9.81 (calibrated
  on Earth: under `settings.gravity` moon a 1 kg mass reads 165 g, on Mars 378 g; `over` past capacity_kg × 9.81 N), smoothed over
  0.05 s from what rests on it at the release; tare takes off the weight Σ m·g of what rests on it at the release (the first step that sees contacts),
  never what lands on it later: a tared bowl reads an egg dropped into it, smashed or whole; the frames before that step read that first reading, so it
  shows what was set on it from 0 s); `pan-balance`
  (a 30 cm beam on a pin with ±`stop_deg` limits and `damping` (0.02 N·m·s), pans hung on pins 12 cm under its ends (the hangers' bodies are the top 2 cm of
  their bows; the model draws them down to the pans): tilt (right pan down +), heavier −1 | 0 (within 0.5°) | 1, left_g and right_g (what rests in each
  pan, as the kitchen scale finds it); its beam, pointer and a 46.6 g brass gravity bob 9 cm under the pivot are ghosts (what is dropped into a pan
  passes the beam over it): the bob gives the beam a restoring torque of about 0.05 N·m per radian, so equal masses settle level within ±0.5° in
  about 4-5 s (a 5 cm drop into one pan), it swings with a period of about 4.7 s with 100 g in each pan, tips 1.5° per gram of difference (its stop at
  10 g) and the same on the Moon (both torques scale with g: a balance compares masses); its process keeps the beam's planck body from sleeping (it
  froze at a stop before, or level at low gravity); the AI's solver puts things inside it (place interior {x0 −0.2, x1 0.2, floor 0.13, rim 0.2}): at
  x = its x ∓ 0.14 m they rest in a pan);
  `gram-mass` (1 g … 1 kg brass cylinders weighing exactly their mass); `protractor` (`watch`: degrees = a pivoted thing's turn from hanging straight
  (0…180) or a slope from level (0…90); swing = half its whole sweep); `plumb-line` (drawn hanging from a retort stand's arm; its bob's point is the line's bottom end); `metre-stick` (a real 1 m stick); `motion-sensor` (distance to the
  nearest solid along its +x, turned with it, 0.15…`range_m`, 120 Hz); `motion-trail` (`watch`, `color`, `style` line | dots | ghosts, `strobe_s`,
  `fade_s`; drawn by the `measure:trails` plugin, which also draws a trail for any item whose props say `trail: true` or `strobe_s`); `graph-board`
  (distance | speed | reading of up to three linked things against time, drawn as the run plays; a reading is the linked thing's main one, as the
  builder picks it into the board's resolved `reads` {id: {key, unit, label, digits}}: a measuring instrument's own, else reading | water_temp | grams
  | … , else its first with a unit; the axis says its label and unit, runs below 0 when the reading does, and carries no numbers with nothing
  linked; in a time-lapsed scene the time axis is the lesson's, in minutes past 2 minutes) and `data-table` (the linked instruments' readings with
  their units) by the `measure:boards` plugin; the boards' frames stay inside their bodies (their feet on what they stand on).
- **Warnings** (`register_warning_hook`, Python == web/sim): a measure item's link that names no item of the scene, the item itself, or an item of a
  type the link does not take, and a stopwatch that needs a watch and has none, a trail or a board with nothing linked: "Red stopwatch's watch link
  names "no-such-car", which is no item of this scene, so it times nothing and reads 0.00 s" (the layout's and the run's warnings: the AI sees
  them and puts the link right).
- **Timing** (measure.ts): a process's `step` sees the bodies where the previous engine step left them, the track's frame one step earlier
  (`observed` = ctx.time() − 1/480 s), and times every event there; a crossing is interpolated between steps on the front edge (the watched item's
  outline's extreme toward the line, by which side its middle starts on); a hit is timed where the gap to the struck solid closes to the engine's 0.5 mm
  contact skin, at the rate it closed the step before (the engine reports a contact a step or two late and leaves a struck body where its contact left
  it); "stops" is where a 1 mm-for-0.25 s stillness began. Keys that become known once (start_s, stop_s, a gate's entered_s / exit_s / speed) are set
  once: `Readings.series` gives every earlier frame that value, so a face draws a frozen time exactly (the stopwatch's LCD shows clamp(t − start_s, 0,
  stop_s − start_s)). Measured (research/rw-validate-measure.ts): free falls of 0.25-2 m timed to 0.1 ms of the engine's own fall (the engine's
  semi-implicit 480 Hz step runs half a step, 1.04 ms, ahead of the exact fall with drag); crossings between two lines equal the 480 Hz track's to 0.0000 s;
  a light gate's speed equals the track's to 0.00 % (a car passing, a ball falling through).
- **Lessons** (MO-37 "Farther, or fewer seconds?"): two 10 m lanes stacked (y 0.02 and 0.82), a motor car on each with its front at 0 m, `speed` =
  wanted × 1.016 (a motor car drives 1.6 % under its setting: its wheels roll on the engine's 0.25 mm contact skin, v = ω·(r − 0.25 mm)) and the
  mechanics module's `start_speed` the same (else start it 1 m before 0 m and time from the start line), a stopwatch per car (`finish_line` = its lane):
  red 10/3 m/s reads 2.9995 s, blue 2.5 m/s 3.9994 s; both stopped at 3 s (`stop` at): red 10.0016 m, blue (8/3 m/s) 8.0011 m. A rolling soccer ball needs
  3.74 m/s at the start for 10 m in 3.00 s (it slows). The AI's prompt says so; its make-it-work search tunes a car's `speed` to a stopwatch's `reads`
  goal (ai/test/measure.test.mjs: a car moved 50 cm back is put back on 3 s by its speed, the car left where it was put); the `reads` goal's `aim`
  works the setting out from the reading and is tried first (a time over a distance: speed × got / want; metres in set seconds or a gate's or a
  speedometer's speed: speed × want / got; a motor car's start speed with its speed when the two are the same; a ball's start speed): the 50 cm case is
  found in its first run, 3.39 → 3.56 m/s.
- **Goals** (Python == web/sim == ai/goals.mjs): `reads {item: instrument, seconds | meters | mps | newtons | grams | degrees | value, key?, tol?}` (the
  reading the unit names when the instrument has it, else `key`, else its main one; any module's instrument by `value` and its first readout; default
  tol the instrument's: 0.1 s, 5 cm, 0.1 m/s, 0.1 N, 10 g, 1°, else 2 %), `crosses {item, line (a line, or a lane's finish) | x, before_s?, after_s?}`
  (its front, by the track), `faster {a, b, line? | x?}` (sooner over a common distance; neither there: farther), `farther {a, b}` (its middle ends ≥
  1 cm farther along +x from its start), `stops_between {item, x0, x1}`. A line's x comes from the document's `measure-mark` record (else the scene's
  item), so ai/goals.mjs judges `crosses` / `faster` the same on a run without its scene (the card, the build tuner, the fixer: before, a lane's
  finish was not found there and "reaches the 5 m finish line" read "no" on a run whose summary said yes).
- **View** (web/view3d.js, two small changes): the wide shot's x clamp (FRAME_X) widens to every lane, ghost solid and static slab of 4.5 m or more, and
  such a shot is framed round its content (no sinking to the table's front edge); a scene without them frames exactly as before. Faces draw 7-segment
  digits on per-instance canvas textures (no fonts: the same picture on every machine and in exports).
- **AI** (web/sim/modules/measure.js `plugin`): the digest's how-to (instruments, links, lanes, the stopwatch's rules, readings), plan / edit / refine
  lines (race layout: fronts at 0 m, one stopwatch per racer above its lane's finish, stage = lane ± 1.5 m; the 1.6 % rule; tapes from a ramp's foot;
  scales, balances, gates), 10 worked examples, five goal kinds, knobs (motor-car speed abs 0.02…1 m/s and push, lane finish_at, stopwatch stop_at,
  gate beam_height, spring-scale range, kitchen-scale tare, pan-balance damping, gram-mass grams), the `reads` aim for a pan balance that should read
  level (aim_balance: one, two or three gram masses in its pans resized so both hold the same grams, from its left_g / right_g, the fewest changes
  first; an orange swapped in for the apple is balanced again by the masses, never by changing the orange), `words.picks` (requests that need an
  instrument in everyday words: "time it", "how many seconds", "how far", "weigh": ai/catalog-digest.mjs promptCatalog picks the module by them),
  `words.regoals` (a harder push, a steeper ramp, a heavier load: an edit that may rewrite the outcome goal), edit lines (a change to the thing
  being tested rewrites the goal stating the old outcome; a swap in a pan is balanced with gram masses; on another world a scale's goal is the
  weight's grams), the edit digest's lines (a balance's pans' grams, a scale's weight under another gravity, a spring scale or tape past its end;
  what a stopwatch timed, from when to when, and
  each racer's crossings of its lane's marks: "its front crossed 2/4/6/8/10 m at 1.30/2.10/2.90/3.70/4.50 s"), change words ("stops after set seconds
  (was at its finish line)", "the lane 10 m → 20 m").
- **Framework additions** (small, locked edits, 2026-10-20): GOAL KINDS `aim?(g, entry, scene) -> [{changes: [{kind: "prop", id, key, from, to}],
  cost?}]` (web/sim/plugins.js; web/ai/fixer.js `findFix` puts a failing module goal's aims with the targeted candidates, first, never on a prop the
  person set; any module may give its goal kinds one: a lamp's distance from a temperature, a voltage from a brightness). The search's `fits` and
  `widenTable` (web/ai/fixer.js) judge a thing that was already out past the table's end before the change (a car or a stopwatch on a 10 m lane) by
  whether the change takes it further out, and never widen the table for it; a thing that was on the table is judged as before.
- Checked: research/rw-validate-measure.ts 55 of 55 (`node --no-warnings --import ./tools/engine-math-node.mjs research/rw-validate-measure.ts
  [time|roll|gate|spring|scale|balance|angle|tape|sensor|lesson|rules|fuzz|all]`); Python == web/sim on random measure scenes (catalog entries,
  documents, resolved, warnings, summaries with every goal kind: 0 mismatches); the ten lesson demos (M1-M10) true in both engines with identical
  summaries; ai/test/measure.test.mjs 8 of 8 (6 + 2 skipped without the mechanics module); machines/test_measure.py 352 of 352 (every type at its
  defaults, numbers' ends and choices, ghosts, brass masses, spring stiffness, the goal kinds on hand-made tracks); AI acceptance on a server with Opus 5.5: three plain lesson requests through New → Build with AI built
  working scenes (3 of 3, every goal met: the 10 m race read 3.00 / 4.00 s, the 3 s race 10.00 / 8.00 m, the newton meter and kitchen scale 1.78 N /
  200 g), and three Edit with AI requests made exactly the change asked with an honest card (3 of 3); after the edit lines on stale goals were added,
  "take 5 s" and "stop at 2 s" kept every goal met, and "move the red car back 50 cm" offered a checked fix through the speed knob (3.39 → 3.56 m/s).
  Again on 20 Oct with every module loaded: builds 3 of 3 (every goal met), edits 3 of 3 exact with an honest card, "take 5 s" and "stop at 2 s"
  every goal met; "move back 50 cm" found no fix in the page's 12 s at a load average of 200 (53 runs of the speed lattice, which steps past the
  ±0.02 s window), and with the `aim` it is offered in its first run: "speed the red car up (3.39 m/s → 3.56 m/s) and set the red car's start
  speed to 3.56 m/s (from 3.39 m/s)? (checked: all 3 goals ✓, only just)".
- Repair (2026-10-20, verified problems): scales calibrated on Earth (1 kg on the Moon: 165 g); the pan balance comes back level (gravity bob, never
  asleep, ghost beam so drops land in its pans, left_g / right_g); boards plot the main reading with its unit against lesson time; link warnings and
  the plain clock; the tape and the spring scale stop at their ends (past_end, over); measure goals judged from the document alone (measure-mark);
  the lanes' bumpers (MO-37's red car no longer drives off its raised lane); the plumb line's and the spring scale's retort stands and the boards'
  frames inside their bodies; words.picks for "time it" / "balloon rocket" / "cart" (mechanics); web/ai/orchestrator.js: a swap's article read whole
  ("for an orange", never "a" + "n orange") and a replaced thing's old words never relabel a goal about another thing they also name (the orange's
  kitchen scale stays "the orange's scale" when the apple's became a spring scale). Checked: research/rw-validate-measure.ts 139 of 139;
  machines/test_measure.py 382 of 382; ai/test/measure.test.mjs 12 of 12 (goals with and without the scene, the Moon, links, the balance's aim
  found by the fix search); tools/parity/module.mjs --module measure 771 checks 0 mismatches and the module's own parity 261 cases 0 mismatches;
  the 22 scenes byte-identical (web/sim and Python, with and without the modules; only the catalog differs); the ten demos true in both engines.
- Known limits: the motor car's 1.6 % (the AI and the fixer handle it; the car is the mechanics module's); a kitchen scale counts a thing that also
  leans on another fixed solid as not on it; the wide shot of a 12 m race shows 20 cm cars small (prefer the follow camera or big bodies, big faces).

## Sound and waves module (2026-10-19; repaired 2026-10-20: kicks, ropes, Slinkies, gravity, goal kinds, events): things that sound, a sound meter, echoes, sound through solids and in a vacuum, ropes, Slinkies, ripples
Files: `machines/mod_waves.py` (catalog), `web/sim/modules/waves.js` (its exact port + the AI plug-in + `soundsOf` / `toneEvents`),
`tooling/src/sim/modules/waves.ts` (the processes) with the physics in `tooling/src/sim/waves.ts`, `web/models/mod-waves.js` (models, frame hooks,
view plugins), `web/export/tones.js` (the tones in the MP4's sound track). Nothing of it runs in a scene without a waves item or a circuits buzzer
(the 22 scenes are byte-identical, `identity.mjs`). Checked by `research/waves-core.test.ts` (16 unit tests of the physics), `research/rw-validate-waves.ts`
(36 checks of the spec's demos W1-W11 and more against cited values), `tools/parity/waves.mjs` (catalog, documents, engine node == bundle == Chromium,
summaries, every goal kind; random scenes; a step of `tools/parity/run.sh`).
- **Items** (category "Sound & waves"; every number cited in the type's `source` and the builder's comments; the levels 1 m away and the ring times
  marked provisional are typical values within the cited ranges): `tuning-fork` (`pitch` 128-2048 Hz, A4 = 440 [ISO 16]; steel prongs 6 mm, their
  length from the clamped-free bar f = 1.875²/(2π)·(t/L²)·√(E/(12ρ)): 10.5 cm at 440 Hz; on a quarter-wave resonance box (`box`, c/(4f) long): 55 dB at
  1 m, rings τ 2 s, bare 45 dB and 6 s; clang mode 6.25 ×), `plucked-ruler` (a 30 cm ruler clamped to the table's right or left `edge`, which it finds
  itself whatever its x; `overhang` 5-25 cm; acrylic 3 mm (3.2 GPa, 1190) / spring steel 0.5 mm / wood 4 mm: f₁ ≈ 0.795/L² Hz for acrylic, 15 cm → 35.3
  Hz; heard as the slap of its tip once a cycle: harmonics 1/n, 70 dB), `drum` (`diameter` 20-40 cm, `tension` 200-5000 N/m, a 0.19 mm Mylar head 0.264
  kg/m²: f01 = 2.405/(2πa)·√(T/σ), 157 Hz at defaults; overtones 1.59 … 2.92 × weighted by where it is struck, `strike_where`; 85 dB), `monochord`
  (`length` 0.3-1 m, `tension` 20-120 N, `gauge` 0.4-6 g/m, steel or nylon: f = √(T/μ)/(2L) with stiffness B = π³Ed⁴/(64TL²): 329.6 Hz at defaults, the
  high E; plucked in the middle (odd harmonics) or near a bridge), `rubber-band` (a band 0.8 mm × `width` over a shoebox, pulled with `tension` 0.2-20 N
  (default 2 N), at most what it holds before it snaps: neo-Hookean, T = G·A0·(λ − 1/λ²), G 0.5 MPa, breaking at λ 6 [Treloar 1975]: a 3 mm band 7.2 N,
  1 mm 2.4 N; stretched as far as its pull needs (60 halvings, the same bits in both builders): μ = 930·A0/λ; 2 N on a 3 mm band, 25 cm: 83.3 Hz; at the
  same pull a wider band is lower),
  `xylophone-bar` (free-free bar 4.730²/(2π)·(t/L²)·√(E/(12ρ)): aluminium 6 mm × 20 cm → 779 Hz; overtones 2.756, 5.404, 8.933), `glass-bottle`
  (330 / 500 / 750 ml with `fill` 0-0.9 of water, `play` tap or blow: tapped, the wall's ring mode n = 2 (Rayleigh) lowered by the water, (f₀/f)² = 1 +
  ρ_w R/(5ρ_g a)·(h/H)⁴ after French (Am. J. Phys. 51, 688, 1983; α = 1 provisional): more water, lower (500 ml: 1564 → 1219 Hz); blown, a Helmholtz
  resonator (c/2π)·√(A/(V·L')), L' the neck + 1.45 bore radii: more water, higher (750 ml empty 104 Hz)), `speaker` (a steady
  tone: `pitch`, `level` dB 1 m away, `on_at`, `on_for`), `clapper` (a sharp 1.2-4 kHz click, 95 dB), `bell-jar` (an electric bell, 18 strikes a
  second, in a jar pumped from 100 % to `air_left` % between `pump_at` and `pump_at + pump_for`), `rice` (grains as 3 mm balls of a 20 mg kernel's
  volume, 1450 kg/m³, at least 3.2 mm apart), `sound-meter` (the listener: dB(A) or dB(Z), fast 0.125 s or slow 1 s, its `room` level 35 dB [ANSI
  S12.60]; `listen` "in the air" or "touching"), `hydrophone` (a probe hung from a lab stand's arm under the water of a liquids `water-tank`: it hears
  a source in the same water at 1481 m/s (sea or salt water 1500), a sound from the air 30 dB down across the surface (provisional)), `oscilloscope` (a bench scope whose microphone, on a little stand 21 cm to its `mic_side`, is a meter (dB(Z),
  fast); its screen of 10 × 8 squares draws the wave it hears: `time_base` 0.5-10 ms a square, `scale` 0.01-1 Pa a square; the wave's height √2 · 20
  µPa · 10^(L/20) ÷ the scale (a sine's peak over its rms [Kinsler]), its waves across pitch × 10 × time_base (440 Hz at 1 ms: 4.4); render only, from
  the microphone's `level` and `pitch`), `sound-panel` (foam 0.8, curtain 0.49, cork 0.2, carpet 0.14 of the sound absorbed [Everest]),
  `wave-rope` (`length`, `tension`, `weight` per metre: v = √(T/μ); held up or on the floor; one pulse or keep shaking (`frequency` 3 Hz by default:
  between the default rope's 2nd and 3rd standing waves); the far end tied, a ring on a pole or running on (those two lying on the floor: held up, the
  free end hangs μgL²/(2T) down onto the table); a `ribbon`; `damping` 1.5/s by default, a real rope's (Q ≈ 10 at a few Hz); n segments: one every
  2.5 cm (40-240) and at least 10 a wavelength of its shake, up to 800; its diameter from its weight at ≈ 1000 kg/m³ of fibres and air (1.1 cm at
  0.1 kg/m)), `slinky` (0.2 kg, k 1 N/m for the whole spring (provisional), pushed and pulled or shaken side to side: v = L·√(k/m); its 80 turns are
  its segments; its coils clash at its 6 cm closed length), `ripple-tank` (`depth` 0.5-3 cm, `frequency` 2-20 Hz, a point or bar dipper, the far end a
  wall or a beach, a floating duck or cork; kept level however it is turned, as a pendulum's hanger: water stays level). Strikes: each
  sounding type has `strength` 0.2-2 (twice the strength = twice the vibration = +6 dB), `strike_at`, `hits` × `every`, `show_waves`.
- **Document** (`doc.processes`, both builders alike): `{kind: "sound", id, item, role, ...}` with role `source` `{solid, at (in the solid's frame), f0,
  partials [[ratio, amplitude, τ s]], lp1 (dB SPL 1 m away at strike level 1), strikes [[t, level]], hold?, ring? {rate, from, until}, hit? {solids,
  momentum, max}, kick? {solids, dir "up" | "out", amp (m), shape "membrane" | "prong", size, mass (kg: the vibrating part's modal mass)}, jar? {from, to, t0, t1, glass, base}, amp, show}`, `meter`
  `{solid, at, weighting, response, floor, listen ("air" | "touch" | "water")}`, `water` `{x0, x1, floor, top, speed}` (a build hook adds one per liquids
  `liquid` record when a meter listens "water"), `wall` `{solid, a, b, absorption}`, `carrier` `{solid, a, b, half, speed, gain, material}`, `buzzer`
  `{solid, at, f0, partials, lp1, on: ["sound", "sounding"]}`; a build hook adds the walls (every visible `wall` item: wood 0.1, steel 0.03 absorbed),
  the carriers (only when a meter listens "touching": steel and wooden rods, a steel beam, planks, the table top; bar speeds steel 5050, aluminium 5150,
  glass 5170, wood 4000 m/s [Kinsler A10]) and circuits' buzzers (65 dB 1 m away, sounding while circuits' `sound` reading is above zero, that loud).
  `{kind: "wave-line", id, item, line: "rope" | "slinky", a, b (world), n, mass, tension, stiffness, plane "vertical" | "flat", damping, drive {mode,
  dir, amp, f, at, cycles}, end "fixed" | "free" | "open", keep, ribbon?, floor (world y it never goes below: what its posts stand on + its radius, a
  rope's from its weight, a Slinky's 33.5 mm coils), drag? (1/m, a rope in air: ½·1.204·1.2·d/μ [Hoerner]), closed? (a Slinky's 0.06 m)}`; `{kind: "ripples", id, item, x0, x1, y, width, depth, f, amp, at, source,
  sx, near, far, floater?, floater_kind?}`.
- **Physics** (`waves.ts`; deterministic: + − × ÷, √ and the engine's exp/sin/cos/pow/hypot; its own `ln`, `log10`, `tanh`):
  - One sound field per run. A strike (scheduled, a bell's clapper, or a body that newly touches a `hit` solid: level = its mass × approach speed ÷
    `momentum`, at most `max`, none under 0.001) sends each partial along every path to every meter: straight (blocked by a wall between), off each wall
    (the image source; the mirror point must fall on the wall and both ends on its open side; pressure × √(1 − α)) and off two walls in turn; and, for a
    meter that listens "touching", through a carrier both touch (any of their solids within its half-thickness + 1 cm: its bar speed, `gain` 10 dB over
    the source's level 1 m away, no spreading; provisional). A path arrives after length ÷ speed, its pressure falling as 1/r (r ≥ 5 cm) and each
    partial dying away as e^(−t/τ) (held `hold` s first). Speed of sound c = 331.3·√(1 + T/273.15) m/s at the room's temperature (`settings.room_temp`;
    343.2 at 20 °C); `settings.air` false (a vacuum): no path through the air. Air absorption is neglected (under 0.1 dB over 10 m below 2 kHz [ISO 9613-1]).
  - A meter reads the A- (IEC 61672-1 Annex E) or Z-weighted mean square through its exponential time weighting, advanced exactly from step to step
    (the closed form of an exponential input through an exponential average), plus its room level: 10·log10(ms/(20 µPa)²).
  - Kicks: only at a source's own strikes (its strike times, a bell's clapper), never at an impact's (a body landing on the head sounds it, but its
    landing never throws it back up: no energy from nothing). A dynamic body touching the `kick` solid gets Δv = v·share·m/(m + M·share²) on its whole
    body (an impulse M·Δv over one (sub-)step): v = amp × level × 2πf₀, share the mode's shape there (a membrane's J0(2.405·r/a); a prong's (s/L)²), m
    the part's modal mass (a drum head's (0,1) mode 0.2695·σ·πa² = 5.0 g at 30 cm [Kinsler §4.4]; a fork prong a quarter of its mass at the tip, 9.9 g
    at 440 Hz [Blevins]), M the body's mass: a 20 mg grain leaves at the head's speed, a 1 kg weight barely stirs. A drum's head swings 0.0785/f₀ m at
    level 1 (≈ 0.49 m/s whatever its tension: a stick's impulse on its modal mass), so rice hops alike on a loose and a tight head, ∝ strength². A strike
    made while the bodies are still held (at or before the release) or with none touching yet waits while the part rings on, its swing dying as
    e^(−t/τ), τ its fundamental's (a drum 0.2 s, a fork 2-6 s; under 5 % it is dropped).
  - A bell in a jar: what reaches the room is the bell's level × (10^(−glass/20) × the air left + 10^(−base/20)): pumped empty it falls ≈ 35 dB.
  - Lines: n + 1 equal masses, symplectic Euler in sub-steps of the engine's step (ω·h ≤ 0.5): across, the tension, held constant (as a hanging
    weight or a spring scale holds it), each link pulling along its own slant, T·Δw/√(dx² + Δw²) (w the offset from the rest shape: the linear
    √(T/μ) within 0.3 % at slopes under 0.08, a little softer for big shakes); along a Slinky, its springs (L·√(k/m)), its coils clashing at their
    closed length (inelastic: a sweep from the driver, then back from a fixed end); a held-up line starts still in its sag μ·g⊥·u(L − u)/(2T) under the
    run's gravity (settings.gravity), lying on its `floor` where the sag would take it below it, and never goes below it (inelastic). The air's drag
    `drag`·|v|·v across (implicit), and `damping` for the rest of its losses. End a follows the drive (a pulse: ½(1 − cos 2πft) once; a wave:
    sin 2πft); end b fixed (a pulse returns upside down), free (a ring on a smooth pole: the same way up), open (a matched damper √(T·μ): nothing
    returns). Within 1 % of the wave speed for waves of 10 segments or more; nothing travels above f = v/(π·dx) (a warning event when its waves are
    under 4 segments long). The default rope shaken at its 2nd standing wave with its 8 cm drive settles at ±0.23 m; with damping 0 it stays under
    ±0.47 m (drag, its slant, the table); a Slinky pushed at its 2nd stays under ±0.25 m. A line the floor holds partly up at the start is watched
    (arrive, reflection, loops, ribbon) against an undriven twin of itself, so its settling there is not taken for a wave.
  - Ripples: ω² = (g·k + σ/ρ·k³)·tanh(k·h) solved for k (σ 0.0728 N/m, ρ 998.2) [Lamb §267], g the run's (settings.gravity: 2 cm, 5 Hz → 6.43 cm on
    Earth, 3.03 on the Moon, 2.64 with none: capillary waves, Newton then starts from k = (ω²ρ/σ)^(1/3)); the dipper's waves and their images in the end and side
    walls (a beach end reflects nothing), spreading as 1/√r from a point dipper, decaying 2νk²/c_g a metre [Lamb §348], their front running at the
    group speed; a floater follows the water's orbit (A·coth(kh) along, A up).
- **Readings** (`track.state`): a source's `sounding` (dB 1 m away now, 0 when silent), `pitch`, `struck`, `strike_t`, `strike_level`, `amp_mm`; a
  meter's `peak`, `level`, `pitch` (Hz heard most now, 0 below 1 dB over the room), `heard` (s, −1), `echo` (s: the first reflected arrival after the
  first sound, −1), and per source S `peak:S` (dB of S alone there) and `at:S` (s: when S first arrived); a buzzer's `sound_db`; a line's `speed`,
  `wavelength`, `frequency`, `arrive`, `reflection` (−1 upside down, 1 same way up, 0 none, −2 not yet), `loops`, `end_mm`, `ribbon_along_mm`,
  `ribbon_across_mm` and its shape `d0 … d40`; a tank's `wavelength`, `speed`, `group`, `frequency`, `reach`, `floater_x`, `floater_y`, `floater_drift`,
  `floater_bob_mm`; `loops` counts the humps of each point's largest offset over each second that dip between them under half the lower one (a lossy
  line's nodes still move). Events (the AI card's run sentence): the first strike of each source ("fork sounds (440.0 Hz)"); a line's wave reaching its
  far end ("the pulse on rope reaches its far end"), its pulse coming back ("comes back upside down" / "the same way up" / "nothing comes back from
  rope's far end"), its standing loops once they hold two seconds after the wave arrived ("2 standing loops form on rope"), at the end its ribbon ("the
  ribbon on rope bobs 119 mm up and down and moves 0 mm along: the wave passes, the rope stays"), a warning when its waves are too short for it; a
  tank's ripples reaching its far end, and at the end its floater ("the duck on tank bobs 1.6 mm up and down but stays put (it drifts 0.0 mm at
  most)").
- **Goal kinds** (`summarize` in items.py == web/sim; the AI's checks): `sounds {source | item | buzzer, pitch_hz?, tol_hz? (2 %), at_least_db?}`,
  `higher {a, b}`, `louder {a, b, at?}` (two meters: their peaks; two sources: their level 1 m away, or with `at` their shares at that meter),
  `hears {meter, source, at_least_db?}` (the source's share reaches the room level, or at_least_db), `echo {meter, delay_s?, tol? (5 ms)}`,
  `wave_reaches {item, x?, before_s?}` (thermal owns `reaches`), `reflects {item, way?: "upside down" | "same way up" | "none"}`, `jumps {item, min_m?
  (5 mm)}` (something of it rises that much above its start), `period {item, seconds?, tol? (2 %)}` (a pendulum, swing or bob on a spring: the mean
  time between its x (or y) crossing the middle of its range the same way); `standing {item, loops?}` (a line kept shaking: its loops reading at the
  end); `wavelength {item, m?, tol? (5 %)}` and `wave_speed {item, m_s?, tol? (5 %)}` (a rope's, Slinky's or tank's readings); `stays_put {item,
  max_drift_m? (1 cm), min_bob_mm? (0.5)}` (a tank's floater bobs and does not drift: its largest |floater_drift| and floater_bob_mm; a line's ribbon
  moves across and travels no more than that along); `trace {oscilloscope | item, waves_across?, squares_high?, tol? (0.1 of each)}` (an oscilloscope's
  screen at its loudest moment: pitch × 10 × time a square; √2·20 µPa·10^(L/20) ÷ Pa a square, the power correctly rounded in both builders).
- **AI** (`plugin` in web/sim/modules/waves.js): a how-to paragraph (what sets each source's pitch and loudness, the meter as the listener, echoes,
  vacuum, carriers, rice on a drum, ropes, Slinkies, ripples, pendulum timing, the oscilloscope), plan/edit/refine prompt lines, the goal kinds above,
  16 worked requests (one per lesson demo W1-W11, a 3-loop standing wave, the pendulum, the bottle xylophone, sound in water, the oscilloscope), 32 knobs for the make-it-work search (the ruler's overhang, a string's length and tension, a band's
  width and tension, a bar's length, a drum's tension, strength and strike time, a fork's pitch, strength and strike time, a speaker's level, a meter's room level,
  a rope's tension, frequency, amplitude, losses, length and far end, a Slinky's stiffness, frequency and amplitude, a tank's frequency, depth and dipper amplitude,
  an oscilloscope's scale and time a square, the jar's air), a `jumps` aim (a drum or fork struck at or before the release: strike it 0.3 s after
  it), plan/edit/refine lines for standing waves (f = n·v/(2L), shake ≤ 2 cm, damping ≥ 1, ≥ 4 s), strike-after-release and the new goal kinds,
  edit-digest lines (pitch, times sounded and loudest level at the strike's instant (unweighted) with what a fast dB(A) sound meter 1 m away reads
  (`meterReading1m`: the partials, A-weighted, through the meter's average: a 157 Hz drum hit reads ≈ 16 dB under its instant level); a band pulled
  past what it holds; a drum with rice struck at or before the release; a rope's standing-wave tuning (which harmonic, or between which) and a shake
  too big or too lossless to settle, a held-up free end lying on the table; a listener's (sound-meter, hydrophone, oscilloscope) readings, echo and every source it heard, and an oscilloscope's
  screen: "its screen shows 4.4 waves across (440 Hz at 1 ms a square), at the loudest 1.86 squares high from the middle line"; a line's speed, wavelength, arrival, reflection and loops; a
  tank's wavelength, speed and the floater's bob and drift; a pendulum's measured period), and change words ("the ruler's overhang 15 → 10 cm (pitch
  35 → 79 Hz)", "struck 1.4 × as hard (+2.9 dB)").
- **View** (`mod-waves.js`): real models (a steel fork on its resonance box, a clamped acrylic / steel / wooden ruler with printed centimetres, a
  lacquered drum with lugs and hoops, rice kernels, a yellow sound level meter on a tripod with an LCD that shows its reading every frame, foam wedges,
  a curtain, a monochord with bridges and a sound hole, a shoebox with a band, a xylophone bar on felt, a speaker, a hinged clapper that snaps shut at
  its claps, a glass bell jar with its gong on a pump plate, wave drivers and posts); the ruler's and strings' blur from `amp_mm`; view plugins: sound
  lines (faint arcs from each sounding source while it sounds, spacing ∝ its wavelength × 0.05 within 1.2-12 cm, drifting out at 0.8 spacings a
  second: a picture, not the 343 m/s itself; never in the table's mirror), ropes (a tube through the 41 kept points, the ribbon), Slinkies (81
  instanced coils; before a run's readings move them, each far post draws its rope or Slinky at rest, sagging as the plugin's first frame does, so a
  catalog photo shows the line too), an oscilloscope's screen (its own canvas per instance: model clones share textures, so every LCD and screen
  takes its own on its first frame), the ripple tank's water surface (the same wave field recomputed for the picture), dipper and floater, and a big reading over each
  meter (drawn in exports too).
- **Audio** (MP4 export): `web/export/audio.js` `renderImpacts` mixes in `tones.js`: every strike of every source (soundsOf: from the readings, a
  strike where `struck` rises), as the scene's listener hears it (`toneEvents`: the first sound meter's microphone, delayed by distance ÷ c and
  −20·log10(distance); without a meter, as heard 1 m away; none in a vacuum), each partial a sine with a 4 ms attack, its hold, then e^(−t/τ); 100 dB SPL
  = 0.7 peak, the impacts' calibration; the export's loudness then levels the whole track. A scene with tones but no impacts gets a sound track too
  (`export-ui.js`). Checked: an exported 440 Hz fork is 440 Hz in the AAC (ffmpeg), the run's impacts each one event at its time (W9).
- **Measured** (2026-10-19): W1 35.32 / 79.46 Hz (ratio 2.2500); W2 +6.02 dB, rice 3.3 → 12.3 mm; W3 −5.98 / −6.00 dB per doubling, 2.94 / 5.85 /
  11.68 ms; W4 echo 0.09994 s; W5 329.63 / 659.26 Hz; W6 10.000 m/s, inverted, standing loops 1/2/3; W7 duck at 5.05 Hz (± 2 %: the side walls'
  reflections ease in for seconds), drift 0.05 mm, 0.321 m/s (= the dispersion relation; √(gh) = 0.443 m/s holds only for kh ≪ 1, here 1.96); W8 6.43 →
  2.37 cm; W9 23 of 23 impacts; W10 −34.8 dB; W11 779.4 / 1568 Hz. The slowest of 61 random parity scenes: 111 ms of engine per second of run.
- **Repair checks** (2026-10-20, `rw-validate-waves.ts R`, 18 of 18; all 54 of 54): balls dropped on a never-struck drum bounce lower each time (bowling
  0.6 → 0.347 → 0.287 m; golf on a 5000 N/m 20 cm drum 0.5 → 0.314 → 0.237 m; steel 0.6 → 0.392 m); a 1 kg weight on a struck drum (default, or tight
  at strength 2) rises 0.000 mm; rice hops 11.77 / 11.78 mm on 400 / 3000 N/m heads, 11.41 mm struck at the release (0.5 / 0.5 s), 46.7 mm on a tight
  drum at strength 2 (was 24-46 cm); the rope at its 2nd harmonic ±0.226 → ±0.224 m (5-10 s → 15-20 s), with damping 0 ±0.421 → ±0.338 m, never under
  the table; the Slinky at its 2nd ±0.242 m, its coils never closer than closed; 1/2/3 loops with the default losses and a 1.5 cm shake; a 5 cm wave on
  a 1 m/s rope arrives (400 segments); ripples 6.43 / 3.03 / 2.64 cm on Earth / Moon / none; tanks turned 90°, 150°, −120°, 180° run; a 1 mm band at
  30 N = at its 2.39 N; the digest's meter words 73.9 dB vs a meter's 73.9 dB; a rope's events. `tools/parity/waves.mjs` 598 cases, 0 mismatches (with
  turned tanks and every new goal kind); `research/waves-core.test.ts` 19 of 19.
- **Known limits**: the sound field is ray-acoustic (no diffraction round a wall's edge, no interference between paths: the meter adds their energy);
  tabletop reflections are not counted; a source's level 1 m away is a calibration, not radiated from its vibration; the drum's and fork's kicks are
  one impulse at the strike, not the head's oscillation (the 480 Hz step cannot follow 157 Hz); a carrier's 10 dB is provisional; a line's tension is
  constant (a weight holds it): a rope tied hard between two posts would stiffen as it stretches, which is not modelled; a Slinky stretches without limit.

## Circuits and electricity (module `circuits`, 2026-10-19; repaired 2026-10-20: electromagnetism, the light on a solar panel, wire ends)
Files: `machines/mod_circuits.py` (catalog) = `web/sim/modules/circuits.js` (its exact port, and its AI plug-ins), `tooling/src/sim/modules/circuits.ts`
(the engine process "circuit"), `tooling/src/sim/circuits.ts` (the parts' physics, planck-free), `tooling/src/sim/circuit-solver.ts` (nodal analysis) and
`tooling/src/sim/circuits-em.ts` (a coil's flux, a straight wire's field, silicon's response to light), `web/models/mod-circuits.js` (3D models, frame
hooks, the wires and the board). Unit tests `tools/circuits.test.ts` (`node --test --no-warnings --import ./tools/engine-math-node.mjs tools/circuits.test.ts`),
AI plug-in tests `web/ai/test/circuits-plugin.test.mjs`, validation `research/rw-validate-circuits.ts`, parity `tools/parity/circuits.mjs` (+ `py_circuits.py`,
the lesson demos `tools/parity/fixtures/circuits-demos.json`).
- **Items** (category "Electricity"; every part has TWO terminals, "+" = its first (on its right: a battery's +, an LED's anode, a bulb's, switch's or
  tester's right screw) and "-" = its second; `mount` "table" (on its own 12 mm plywood base board with two brass screw terminals, free to be knocked) or
  "board" (fixed where it is put, no base: clipped to a circuit board)): `battery` (`kind` AA | D | 9V | "lantern 6V", `cells` 1-6 AA/D in a holder,
  `charge_pct`: an alkaline cell 1.58 V fresh, 1.3 V at half charge, 1.1 V at 10 %, 0.9 V empty, its 0.2 Ω (AA) doubling toward empty; Energizer E91 /
  522), `wire` (links `a`, `b` to two parts, `a_end`/`b_end` "+" | "-"; an end the item does not set is joined as current flows round a loop: to the
  terminal its other end's leads on to, "out" (a source's +, a part's −) to "in" (a part's +, a source's −; a voltmeter as the part it is across), with
  neither set end a on its item's terminal with fewer wires, + when even; the chosen ends are written back into the wire's resolved props; `length` automatic = 1.3 × the gap between its terminals at the start + 5 cm, to
  the next cm; 22 AWG copper, 0.053 Ω/m, ASTM B258; no solid: drawn between its terminals; an end on no part is a free end), `bulb` (`rating` 2.5V 0.3A |
  2.25V 0.25A | 3.8V 0.3A | 6V 0.06A in a batten holder), `led` (`color` red 2.0 V | yellow 2.1 | green 2.2 | blue 3.2 | white 3.2 V at 20 mA, Kingbright
  WP7113), `switch` (`style` knife | toggle | push; `closed`, `flip_at`, `flip_back_at` s; a push switch is closed between `press_from` and `press_to` or
  while what rests on its button weighs ≥ `force` N), `buzzer` (`volts` rated, `pitch` Hz), `motor` (`kind` hobby = Mabuchi FA-130: 9100 rpm, 0.2 A no
  load and 2.2 A stalled on 3 V | solar (RF-300 class, provisional) | geared (48:1 "TT", about 100 rpm on 3 V, provisional); `drives` propeller (a fan
  blowing along the motor's axis, +x) | paddle | disc (turning bodies facing the camera) | none; `size`), `resistor` (`ohms`), `dimmer` (a rheostat 0.5 Ω +
  `max_ohms` × knob, turned from `knob` to `knob_to` over `turn_seconds` from `turn_at`), `tester` (two copper probe plates `gap` apart), `meter` (a
  multimeter standing up: `mode` volts, 10 MΩ across; amps, 0.1 Ω in series; galvanometer: a centre-zero needle meter in a wooden box, 0.5 mA full scale,
  50 Ω, its needle a damped swing of 0.6 s period and damping ratio 0.6, stopped at ±1.2: provisional), `electromagnet` (an iron nail, `length`, `diameter`,
  wound with `turns` of 24 AWG enamelled copper (84.2 mΩ/m), held point down in a clamp; its winding a circuit part, its nail the magnetism module's
  soft iron whose coil current is this circuit's: a `magnetism` record `{role: "soft", ..., coil: {turns, length, reading: {item, key: "current"}}}`
  when that module is loaded; current in at + makes its point a north pole), `coil` (`turns` of 28 AWG (212.9 mΩ/m) on a cardboard tube, `diameter`
  bore, `length`, `axis` vertical | horizontal, held in a clamp: its two walls are its solids, the bore between them clear for a magnet), `straight-wire`
  (Oersted's: 14 AWG bare copper (8.28 mΩ/m) `length` long; `runs` over: between two wooden clamps, left to right, `in_front` m in front of the
  picture's plane, so a compass at its own x, y is like one under a wire; through: straight through the picture front to back, its cut a 1.6 mm dot,
  its terminals at its two ends (`z` ±length/2)), `solar-panel` (4 cells: 0.2 A into a short at 1000 W/m², knee 1.8 V,
  about 2 V open; `tilt`, `sun` W/m², `sun_angle`), `hand-generator` (6 V open-circuit at 2 turns a second, 6 Ω; cranked at `rpm` from `start_at` until
  `stop_at`), `circuit-board` (an upright pegboard `width` × `height` drawn behind the parts; no solid: lesson art).
- **Document**: the build hook gathers every part into ONE process record `{kind: "circuit", id: "circuit", parts: [...], terminals: {"<item>/+": {solid,
  at}}, resistivity: {material name: Ω·m}, names: [[id, name]], boards?: [...]}` (only when the scene has a circuit item: every other document is
  unchanged). A part: `{kind, id, item, name, a, b, ...}` with battery `emf, r`; wire `r, length, color`; bulb `v_rated, i_rated`; led `vf, i_rated, rs,
  i_max`; switch `closed, r, flips, press?`; resistor `r, turn?`; buzzer `r, v_min, v_rated, pitch`; motor `k, r, efficiency, friction` and `rotor, stator`
  (a body on the shaft) or `fan` {inertia, drag, solid, at, direction, diameter, pitch}; probe `contacts, gap`; solar `isc, v_knee, g_d, rsh, rs, face,
  sun`; generator `k, r, speed, from, to?`; meter `mode, r, fs?`; coil `r, turns, induce?` {solid, at, axis, radius, length} (an electromagnet's
  winding has none); conductor `r, field` {solid, from {x, y, z}, to} (its line, positive current from `from` to `to`). A solar panel's face in a
  scene with light the optics module traces (one of its items, or the heat module's desk lamp) is a light-taking `optics` body `{role: "panel", faces:
  [1], eff: [8 bands], color}` (its cells' 5.9 % in sunlight shared out by silicon's response); the terminals may carry `z` (out of the picture: the leads run to it). Every welded part hangs straight off its item's root solid (one level of welds, as
  items.py's `_world_poses` and the solver's outlines compose them).
- **Engine** (every 480 Hz step from t = 0): the network is solved by nodal analysis, each connected component referenced to its lowest node and
  solved alone (Gaussian elimination with partial pivoting); LEDs, a buzzer's driver (0.7 V) and a solar cell's junction are piecewise-linear diodes
  found by iteration from the step before's states (at most 24 solves; Kirchhoff's current law to 1e-9 A in 3000 random netlists). A bulb's tungsten
  filament is made from its rating (radiates its rated power at 2500 K with ε 0.30: 2.5 V 0.3 A → 34 µm × 10.6 mm, 2.7e-5 J/K): R ∝ T^1.2 (13 × cold to
  hot), m·c dT/dt = I²R − P_rated·(T⁴ − T₀⁴)/(T_r⁴ − T₀⁴) in sub-steps of at most 20 K, light = exp(8.84 (1 − T_r/T)) (the lamp law: light ∝ V^3.4,
  current ∝ V^0.55, power ∝ V^1.55, IES); it burns out when it melts (3695 K) or wears through (life ∝ V^-13 from 15 h at its rating: GE #14). An LED fails
  open after 50 ms over twice its 30 mA. A motor with a shaft body is twisted by η·k·I along its torque-speed line, implicitly in its rotor's turning
  (τ = η·k·(a − b·k·ω)/(1 + η·k²·b·h/J), J its rotor's inertia about the pivot: steady at any inertia), its friction a Coulomb pin joint; a fan's rotor
  is stepped in the module (J dω/dt = τ − C_Q ρ D⁵ ω²/4π²) and its jet (0.7 D across, 0.45 D per turn: Rajaratnam's profile, as the engine's fans)
  pushes what is in it (drag against the moving air, never more than half the gap closed in a step). A press switch reads the weight of what rests on its
  button; a tester conducts through the one solid touching both probes (R = ρ·gap/(depth × min(thickness, 1 cm)), a material not listed: 1e14 Ω·m); a
  solar panel's light, as the W/m² of standard sunlight that makes the same current: its own `sun` on its face (cosine, blocked by any opaque solid
  on 5 rays); the light the optics module traces onto its face (`opticsOf(scene)`: the desk lamps, flashlights, the "sunlight" item, by mirrors and
  lenses, shaded by what is in the way), each deposit band by band as crystalline silicon takes it (A/W per band: QE·λ/1239.84 nm with QE 0.70-0.92
  over the visible bands [GREEN]; the infrared band by the light: sunlight 0.325, a 2856 K filament 0.139, a 3000 K halogen 0.152, an infrared laser
  0.59) over sunlight's 0.347 A/W (AM1.5, the optics module's spectrum: the optics sun at 1000 W/m² reads 1000); without the optics module, the heat
  module's lamps by their cones (their `dir`); and the circuit's glowing bulbs (a watt of a filament's radiation counts 0.35 of sunlight's: a 2500 K
  black body's 0.121 A/W); no light is blocked by its own item (a lamp's shade, a bulb's holder). A wire whose terminals are pulled farther apart than
  its length comes off.
- **Electromagnetism** (tooling/src/sim/circuits-em.ts, with the magnetism module's records): a coil's flux linkage λ = n × the mean flux through one
  turn, from every permanent magnet (its pole faces: a north face and the opposite face across its body bound a magnetized prism, M = σ along the north
  normal, whose flux is ∫ M·b dV by reciprocity, b the turn's own exact field per ampere (the circular loop's elliptic-integral field, Simpson et al.
  NASA 2001; K and E by the AGM), at 5 × 3 × 3 Gauss points of the prism and 8 loops along the winding: smooth wherever the magnet is, through the coil
  too; a pole that bounds no prism (a horseshoe's tips) by its μ0·H through each turn's disc, outside it) and the Earth's field (B·u·πR²); its EMF each
  step is (λ − λ_before)/h with + at its first terminal, so the current it drives opposes the change (Lenz). A conductor's current makes the field of
  its straight line (Biot–Savart for its length: μ0·I/(2π·r) when long; inside its 0.81 mm radius falling to zero), which pushes every magnet's pole
  faces with q·B (q = σ·w·d) at their centres after the release: a compass behind a straight wire swings to where the wire's field at its poles and
  the Earth's balance; a lead lying in the picture makes its field across the picture and turns no needle in it. An electromagnet's coil reading is
  its signed current (+ → −; under a picoamp: 0).
- **Readings** (track.state[item]): battery `current` (out of +), `voltage`; wire `current`, `off`; bulb `light` (× its full light), `current`,
  `voltage`, `temp_c`, `broken`; led `light`, `current`, `voltage`, `broken`; switch `closed`, `current`; resistor/dimmer `current`, `voltage`, `ohms`;
  buzzer `sound` (× its rated loudness), `pitch` (Hz while sounding), `current`, `voltage`; motor `rpm`, `current`, `voltage` (+ `air` m/s and `angle` for a
  propeller); generator `rpm`, `voltage`, `current`, `angle`; tester `conducts`, `current`; solar `irradiance`, `current`, `voltage`, `power`; meter
  `reading` (V or A), `current` (so a `current` goal works on an ammeter), `needle` (a galvanometer's, × full scale); coil `emf_mv`, `current`
  (signed, + → −), `voltage`, `flux_uwb` (µWb through one turn); electromagnet `current` (signed), `voltage` (and the magnetism module's `amps`,
  `magnetized`, `pull_mN`); straight wire `current` (signed), `field_ut` (µT 1 cm from it); a solar panel's `current` is out of its + (positive while it
  powers the loop; it was negative before 2026-10-20) and `power` positive. **Events** (said once a new state has lasted 30 ms, dated when it began: `ctx.event(text, items, kind, at)`): "Bulb lights"
  / "goes out" (a tenth of its full light), "burns out (...)", "LED burned out: 130 mA is over its 30 mA", "Buzzer sounds (2700 Hz)", "Motor starts
  turning", "Switch closes", "Tester conducts through Coin" / "does not conduct through Eraser", "Wire 2 pulled off", "Battery is short-circuited (7.7 A)", "Coil has a voltage induced in it (1.1 mV): the magnetic field through it is
  changing" (kind "induces", once it passes 1 mV), "Straight wire carries 2.03 A: its magnetic field 1 cm away is 41 µT" (kind "field", once it passes
  5 µT).
- **Goal kinds** (machines/mod_circuits.py = web/sim, number for number): `lights {item, at_least? (0.1), before_s?}` (over the run's last 0.5 s; with
  before_s, first reached by then), `stays_dark {item}` (never 0.1 of its light), `glows_brighter {a, b}` (a's mean over the last 0.5 s ≥ 1.05 × b's; not `dark`/`brighter`: those are the optics module's light-meter goals), `buzzes {item,
  before_s?}` (sounds for ≥ 30 ms), `spins {item, at_least_rpm? (30)}`, `current {item, at_least_a?, at_most_a?}` (|I| over the last 0.5 s),
  `conducts {item: tester}`, `deflects {compass, at_least_deg? (15), at_s?}` (the needle's least swing away from north, where the Earth's field alone
  points it (the magnetism module's first Earth record; without one, from its starting heading), over the last 0.5 s, or at at_s; `most_deg` its
  biggest), `induces {coil, at_least_mv? (1), before_s?}` (|EMF| first reaches it; `peak_mv`). (The softbody module's alias
  "deflects" for `bends` is shadowed by this goal kind: a beam's bending is `bends`.)
- **AI** (plugin in web/sim/modules/circuits.js): a how-to for the digest (loops, terminals, series and parallel, what a cell lights, layout on the table
  or the board, wire ends joined as current flows, electromagnetism: the electromagnet, induction with a coil and a galvanometer, Oersted's straight
  wire, a solar panel indoors under a lamp), plan/edit/refine lines, nine worked examples (a switch lighting a bulb, series vs parallel, conductor vs
  insulator, a battery fan, a ball on a doorbell, a lamp running a solar motor, Oersted's compass, a magnet dropped through a coil, an electromagnet
  with a switch and an ammeter), knobs (wire a/b links and a_end/b_end, battery cells and charge, bulb rating, LED colour, resistor ohms, dimmer knob,
  switch closed and flip_at, push force, buzzer volts, motor kind and size, tester gap, solar sun, tilt and its place along the table, generator rpm,
  coil turns and bore, electromagnet turns, the straight wire's distance in front of the needle and its length), the edit digest's lines (each
  terminal's wires, each wire's ends as built, each source's or coil's loop: closed, OPEN at a part, or a SHORT; a coil's peak and present EMF and flux,
  a straight wire's current and field, an electromagnet's current and magnetization, a galvanometer's needle, a panel's light) and change words in real
  units ("AA cells (1.58 V each) → a 9 V battery (9.5 V fresh)", "wire end b moved from Battery to Bulb 2", "the wire 12 → 6 mm in front of the
  needle"); `place.held` for the wire and the circuit board (no body: the solver never calls them floating); every worked example has its `how`
  line (the digest lists an example only by its ask and how); goal aims for the make-it-work search's first tries: `deflects` (a straight wire
  running over the needle brought nearer, the resistors carrying its current turned down, more cells in its battery: the swing's tangent ∝ the
  wire's field over the Earth's), `induces` (more turns: the EMF ∝ the turns), `lights`/`spins`/`buzzes` (a solar panel in too little light moved
  toward the nearest lamp or flashlight: the circuit's parts never move, so the search's chain would not reach them otherwise).
- **View**: models for every part (cells in their holder, the bulb's glass, cap and coiled filament, LEDs, knife/toggle/push switches, the buzzer, the
  motors and their propeller, paddle or colour disc, colour-coded resistors, the dimmer's knob, copper probes, a multimeter, a solar panel, a crank
  generator); frame hooks `circuits:glow` (filament colour from its temperature, a warm glow and halo; a point light per bulb), `circuits:led`,
  `circuits:knife` (the blade drops into its clip), `circuits:toggle`, `circuits:push`, `circuits:prop` (the propeller by its angle, a blur disc above
  600 rpm), `circuits:knob`, `circuits:crank`, `circuits:buzz` (faint sound arcs while it sounds), `circuits:lcd` (the meter's display); the view plugin
  "circuits" draws each wire as a 2.2 mm insulated lead with crocodile clips leaning out of each terminal, sagging to its length, lying on the table,
  behind the parts it passes, a pulled-off end dropped (an end on a terminal out of the picture's plane runs out to it); and the circuit boards. The
  electromagnet's nail and enamelled winding, the coil as two halves of its wound tube (one per wall, the bore clear), the straight wire's clamps and
  bare copper (in front of the picture, or through it), the galvanometer's dial with `circuits:galvo` turning its needle ±45° at full scale.
- Validated (`node --no-warnings --import ./tools/engine-math-node.mjs research/rw-validate-circuits.ts all`: 58 checks against the IES lamp law,
  Energizer, Mabuchi FA-130, Kingbright LED, ASTM B258 and CRC values; the spec's demos C1-C9, C11, C12; 3000 random netlists) and checked in both
  engines: 14 lesson demos (server and the bundle: documents and tracks byte for byte, every expected outcome). Parity: Python == web/sim for 400 random
  circuit scenes (documents, resolved props, catalog entries) and the goal summaries; fuzz-live with the module 768 cases, 0 mismatches. The 22
  scenes are byte-identical to the bundle of 2026-10-19 16:43 with and without the module. AI acceptance on the real app with Claude Opus 5.5: Build
  with AI 3/3 lesson requests built working circuits (goals met); Edit with AI 3/3 (an exact change and an honest card each; the two edits that broke
  a goal got a checked fix found by the module's knobs: a 6 V 0.06 A bulb on the 9 V battery, a blue LED on 3 V without its resistor).
- Validated 2026-10-20 (research/rw-validate-circuits.ts sections lamplight, oersted, induction, magnetize: 83 checks in all): a 150 W halogen lamp
  20-30 cm off runs a solar motor through an indoor panel (272 W/m² of sunlight's worth, 34 mA, 1545 rpm), less light further off; the optics
  sunlight at 1000 W/m² overhead reads 1000.9 W/m² and 0.199 A; 40 µT 1 cm from 2 A, 1/r; Oersted's needle at −50.2° against the balance's 50.2°, the
  other way reversed; a small magnet's flux on a coil's axis within 0.006 % of the dipole's exact μ0·m·R²/(2(R² + z²)^1.5), its EMF at 1 m/s within
  0.01 % of N·dΦ/dt; a dropped neodymium bar: ∫EMF dt = Δλ to the track's rounding, the current against the change, twice the turns 1.99 × the
  voltage, the galvanometer flicking and back to zero, steady at I/I_full; a wired electromagnet's current is its coil's, it holds clips switched on
  and drops them when switched off.
- Known limits: no capacitance, and no inductance but the coils' changing flux (a coil's self-inductance, L/R under a step for the default coil, is
  left out; so is one coil's field through another: no transformer yet); a coil's own field does not push back on the magnet (Lenz's force; with a
  meter in the loop well under a hundredth of a falling magnet's weight), nor does a soft iron core add to its flux; a battery does not run down
  during a run (its `charge_pct` sets its state); a motor's own rotor inertia is not reflected through a gearbox (a light attachment spins up at
  once); a motor and the hand generator are lumped (k, R: their own magnets and coils are not modelled); the fan's push is the jet against the body's
  drag (no lift); a press switch reads weight at rest, not an impact's force; a motor driving a car's wheels and a winch are not built yet.

## Breaking things and padding (module `fracture`, 2026-10-19; repaired 2026-10-20): eggs, glass, plates, windows, cushions, the egg-drop challenge, snapping bridges, glued towers
Files: `machines/mod_fracture.py` (catalog, goal kinds, the padding table's build hook), `web/sim/modules/fracture.js` (its exact port + the AI plug-in),
`tooling/src/sim/fracture.ts` (the pure physics; `fracture.test.ts` its unit tests), `tooling/src/sim/modules/fracture.ts` (the processes),
`web/models/mod-fracture.js` (models, frame hooks, the parachute plugin). Nothing of it runs in a scene without one of its items (the 22 scenes are
byte-identical, `identity.mjs`; the catalog differs only by its own 8 types, 11 materials, looks and category "Breaking & padding"). Sources are cited in
the Python file ([EGG-F] [EGG-V] [EGG-M] [GLASS] [NITE] [PORC] [PASTA] [WOOD] [GYPSUM] [CHOC] [PU] [EPS] [AIR] [VANWYK] [RUBBER] [CHUTE] [BOX] [PVA] [TAPE] [TACK]
[HAMILTON] [EDGE] [PLATE] [SOFT]).
- **Items**: `raw-egg` (57 × 44 mm, 57 g, `strength` 35 N: an 8-sided outline round the egg's curve; cracks at its strength, smashes at twice it into
  two half shells and a spill holding 89 % of its mass), `drinking-glass` (annealed tumbler, 250 g, `strength` 1840 N: shatters into 5 shards),
  `ceramic-plate` (26 cm, 450 g, `strength` 2470 N: 4 sherds), `cushion` (material foam | packing foam | bubble wrap | cotton balls | pillow stuffing |
  crumpled paper | folded towel | carpet; width, thickness, depth; reading `squash`), `egg-drop-box` (a closed cardboard cube `size`, the egg welded inside,
  `padding` none | foam | bubble wrap | cotton balls | crumpled paper | pillow stuffing | packing foam, `padding_thickness` (clamped to the room the box has),
  `parachute` canopy width, `strength`), `snap-bridge` (two static wooden supports `support_height` tall and a beam across the `span` gap resting 2 cm on
  each: `made_of` spaghetti (Ø 1.75 mm, 36 MPa, 4.1 GPa) | craft sticks (10 × 2 mm birch, 85 MPa, 11 GPa) | chalk (Ø 10 mm, 3 MPa, 2 GPa) | chocolate bar
  (35 × 8 mm, 2.5 MPa, 0.4 GPa), `strands` = how many PIECES of `made_of` lie side by side (strands 1: one chocolate bar or one stick of chalk; a swap of
  `made_of` keeps the count, so the AI sets it from the request), `span` (label "Span length"); anchor: the floor under the gap's middle), `block-tower`
  (`blocks` wooden blocks stacked, each `block_width` × `block_height` × `block_depth` (10 × 5 × 5 cm), `glue` none | sticky tack | tape | glue stick |
  white glue), `window-pane` (a fixed type, `dynamic` false: window glass `height` × `width` (front to back) × `thickness` (3 mm; 2-12), `mount` frame
  (the pane fixed upright in a varnished wooden frame: a 4 cm sill and head, the side stiles drawn in 3D) | loose (a free dynamic sheet), `strength`
  following its size and glass ([PLATE]: 258 N for 60 × 60 cm, 3 mm) until typed; 5 shards up its height). Any solid whose material is padding pads: the
  catalog's pillow, foam block and sponge (foam), carpet strip (carpet) and rubber mat (rubber mat) too. Prop labels are chosen for the cards' generic
  verb table (web/ai/orchestrator.js propWord): "Breaks at" (never "faster"), "Padding layer", "Padding round the egg" (never "thicker wall"),
  "Span length" ("longer", never "further apart").
- **Pieces**: a breakable is one solid while whole; its pieces are solids of the same item built inside it (always dynamic), which its process
  resizes to nothing at the start (sensors, weightless) and keeps on the whole every (sub-)step. In the document a piece's material has a parked
  density of 0.001 kg/m³ (whatever adds up an item's moving solids, the AI's weights among them, counts the thing once; where the whole is a FIXED
  solid, a snap-bridge's beam and a framed pane, the pieces carry the real density instead, so the thing still counts once and a card says its real
  weight, never "0 g → 0 g"); its real mass is in its
  record (`masses`, a beam's `pieces[i][2]`: shares of the whole's that add up to it) and the engine gives it that mass when it lets it go (its
  fixture's density and its part's material scaled: a kitchen scale under an egg reads 57.0 g before and after it smashes on it). When it breaks the whole
  is resized to nothing (weightless, still: placements `scale` 0) and each piece is let go where it is (resize 1), moving as that part of the whole
  moved plus a deterministic outward scatter (scatter × the impact speed); an egg's spill is laid flat on the surface it broke against. Two pieces of one
  thing never collide (the process leaves their contacts out). A beam's six pieces are welded (planck WeldJoint) into the two sides of the snap (a
  spaghetti beam's longer side snaps again: dry spaghetti breaks in three or more, Audoly & Neukirch, PRL 95, 095505, 2005); a whole beam is a static
  solid (held as its supports hold it, so a 4 g strand under a 500 g mass stays put), its pieces dynamic.
- **Impact** (`fracture.ts peakForce`): a contact that begins on the thing at a normal approach speed v (as physics.ts measures impacts) meets a chain of
  springs in series carrying one force F: the thing's own contact stiffness k (egg 21.5 kN/m = 35²/(0.057·1.0²) from the crack at 1.0 m/s [EGG-V];
  glass 1.5 MN/m and plate 2 MN/m, calibrations) and the padding between (the other solid's material from the `fracture-soft` table, its thickness its
  outline's extent along the contact normal). At the peak ½·m·v² = F²/(2k) + Σ∫F_i dx with F_i(x) = σ(x/t)·A(x): σ the padding's compression law (1 cellular
  foam σ_ref·(ε_D − ε_ref)/(ε_D − ε); 2 trapped air φ·p0·ε/(1 − ε); 3 fibres s0·((1 − ε)⁻³ − 1); 4 rubber E·ε), A the pressed area (a round end's cap
  π(2Rx − x²) up to πR²; a flat face's area). Padding squashed to its densification limit bottoms out (the rest goes into the stiffer springs). Bisection
  on F in [0, v·√(k·m)]. The effective mass: its own against a fixed thing (or one resting on something fixed or far heavier: a cushion on the table);
  the striker's when something hits it while it is held (or when it is itself fixed: a pane in its frame); else the pair's reduced mass; two
  breakables meeting put their stiffnesses in series. A striker that broke in the same hit (two glasses rim to rim) strikes with its mass and hold
  as the contact began (captured in the contact hook), not as the empty solid it is once its own process has run.
- **Soft bodies of other modules** (the `fracture-soft` table, laws 5-8 in `fracture.ts`, [SOFT]): the build hook adds, besides padding materials,
  the softbody module's `ball` records (law pressure → 5 "inflated" [Δp, R, wall, hard]; hertz → 6 [E/(1 − ν²), R, hard]; clay → 7 [3σ_y, R, k_c
  ratio, hard]), every trampoline's mat (8 "sprung" [its stiffness prop, 0.9 × its height]) and any solid of a process record that carries
  `contact_law: [5-8, ...]` (the plug-in point for another module's soft thing). They join the chain like padding, with the contact's own geometry:
  R_eff = R·r/(R + r) for the breakable's round end r (a flat face: R, the flat at most its area). Inflated: F = Δp·π(2R_eff·x − x²) + k_w·x + the
  skin's pull 2π·T·x/ln(R/a) (T = Δp·R/2, at most 2π·a·T once the skin wraps it; the flat stops growing at π·R_eff²); Hertz (4/3)·E*·√R_eff·x^1.5;
  clay min(k_c·x, p·π(2R_eff·x − x²)); sprung k·x, the mat counting as held (a light membrane: the breakable's own mass against its springs). Each
  bottoms out at the soft body's `hard` (where its module's rigid contact resumes) or the mat's travel. `ln` is `fracture.ts lnOf` (square roots and
  arithmetic only, the engine's rule). Measured: an egg dropped 50 cm onto a 65 cm exercise ball (4 kPa) feels 29.7 N (whole; softened to 0.5 kPa,
  10.3 N), onto the bare table 108 N (smashed); a 22 g foam ball dropped 55 cm onto an egg 21.8 N (whole; Hertz 21.7 N); an egg dropped 1 m onto a
  trampoline 17.9 N (whole); 50 cm onto a 14 kPa playground ball 41.5 N (cracked); 30 cm onto a 20 cm clay ball 67.6 N (cracked, not smashed).
- **Hard on hard** ([EDGE]): a breakable whose record has `edge` (glass, plate, pane: 0.5) hit by another such breakable breaks at edge × its
  strength (a rim on a rim concentrates the stress); the event says "(920 N in a hard edge-on-edge hit like this one)". A glass dropped 60 cm onto a
  standing glass now shatters both (1475 N each), as onto the table; from 20 cm both stay whole (846 N).
- **Water** (with the fluids module): in a scene with a liquid, a free raw egg, drinking glass and plate get the fluids module's
  `{kind: "displace", item, volume_ml}` (true densities: egg 1080 kg/m³ [HAMILTON], glass 2500, stoneware 2400; volume_ml is scaled by all of the item's
  moving outlines over the whole's, as the engine divides it out), so a raw egg sinks in fresh water (buoyancy 0.517 N: 52.8 cm³) and floats in 12 %
  salt water; a breakable falling into a tank is slowed by the water and only its hit on the floor counts (an egg dropped 30 cm into 20 cm of water
  meets the floor at 0.16 m/s: whole). The whole egg's 8-sided prism (91 cm³) was what floated it before.
- **Steady loads**: each contact's force from its solved impulses (contacts older than 4 steps, so an impact is not counted twice), the largest, low-
  passed over 30 ms (a dropped load's dynamic overshoot comes through partly, as a real one does). It breaks when the larger of the two reaches
  `strength`. Readings: `broken` (0 whole, 1 cracked, 2 in pieces), `peak_force` (N), `share` (peak / strength), `impact_speed` (m/s); the padding it
  squashed gets `squash` (m, relaxing over 0.15 s; the view squashes the cushion by it). Events: "Raw egg cracks at 0.62 s, hitting a varnished
  hardwood table top at 1.38 m/s (48.5 N); the shell breaks at 35 N", "… smashes (already cracked) …", "… under a steady 35.0 N".
- **Egg-drop box** (`mode: "boxed"`): an impact on the box at v gives the box's own peak force (its whole mass, its crush stiffness 50 kN/m, the padding
  it lands on over its bottom's area) and the egg's through its padding (the padding's law, `padding_thickness` thick, over the egg's projected area
  π·L/2·W/2); the egg feels the smaller (riding with a gently slowed box it is pressed only by its share, m_egg/M, of the box's force). The parachute
  (`fracture-chute`): drag ½·ρ·C_d·A·|u|·u (C_d 0.8 [CHUTE], ρ 1.204) against the box's velocity relative to the air (fans blow it), applied where
  its lines meet; none in a vacuum; inside one of the air module's vacuum jars (the build hook copies the jars' insides into the record, `jars`
  [{item, x0, x1, y0, y1}]) ρ = 1.204 × the jar's `pressure_kpa` reading / 101.325 (a box under a 30 cm canopy in a jar pumped to 0.1 kPa lands at
  3.515 m/s, as with none). It is drawn by the `fracture:chutes` plugin and slumps beside the box when it lands.
- **Beams** (`fracture-beam`): the bending moment at the five joints between its pieces from the contact forces on it (as above, low-passed over 40 ms)
  and its own weight on a simply supported span between the middles of its rests (`fracture.ts supportedMoment`); a thing dropped on the span adds
  F = v·√(k·m) with k = 3EIL/(a²b²) at its point, moment F·a·b/L under it (`beamImpact`). It snaps where |M| reaches M_c = σ·Z of all its strands
  (5 spaghetti strands over a 20 cm gap: 0.0947 N·m, about 175 g at the middle). Readings: `broken` (0 / 2), `load` (N, what presses on it), `share`
  (|M| / M_c), `sag` (M·L²/12EI: the view bows the beam by it, drawn up to 4 mm so the things on it stay on its straight top). Event: "Bridge snaps at
  0.33 s under 2.2 N (222 g) of load (bending 0.0966 N·m; it holds 0.0947 N·m)" or "… as a … lands on it at 1.2 m/s …".
- **Towers** (`fracture-glue`, every tower of 2 or more blocks; its blocks are built 1 mm apart, the bottom one 1 mm up: rigid blocks placed exactly
  touching sit inside each other's contact skin and jitter apart in the engine, a 10-block stack of the catalog's wooden blocks falls within 6 s, while
  1 mm apart they settle at once and stand): glued ones get a planck WeldJoint between neighbours at their shared face's middle;
  after each step a weld's reaction (two steps averaged) gives the glue line's tension −F_n/(w·d) + 6|M|/(d·w²) and shear |F_t|/(w·d) (`glueShare`:
  a block's weight holds it down until the moment tips it); at its strength (tape 540/d Pa [TAPE], sticky tack 10 kPa, glue stick 0.2 MPa, white glue
  3 MPa tension / 6 MPa shear [PVA]) the weld is gone. A block has FALLEN once it is more than half a block lower than it was stacked, or turned
  more than 35°; a block that only slides along the one under it still stands (a 1 m/s tennis ball slides a top block 1.9 cm: nothing fell). A loose
  tower comes apart (`broken` 1) when a block falls; a glued one only when a weld lets go (tipping over in one piece is not coming apart). Knocked down
  (an event, and the goal below): half its blocks or more have fallen, or its top is under half its built height. Readings `broken` (0 / 1),
  `blocks_fallen` (now), `top_height` (m: its highest block's top over its bottom block's start), `share` (glue). Events: "The tape between block 2 and
  block 3 of Tower lets go at 0.53 s", "Tower comes apart at 0.81 s: block 6 of 6 falls off block 5", "Tower is knocked down at 0.9 s: 4 of 6 blocks
  have fallen, its top 12 cm up (built 31 cm)".
- **Goals** (Python == web/sim == ai/goals.mjs = web/ai/goals.js): `breaks {item, before_s?}` (its `broken` reading reaches 0.5: cracked, shattered,
  snapped, came apart; by before_s), `survives {item}` (never; entry `share`), `breaks_first {item, other}` (item breaks, before other or other never),
  `knocked_down {item, at_least_blocks?}` (a block tower: half its blocks fell or its top is under half its built height; with at_least_blocks, that many
  fell; entry `fallen`; aliases knock_down, tower_falls, collapses… — never "topples", which ai/schemas.mjs reads as the core `falls`).
  Aliases: cracks, snaps, shatters, smashes, comes_apart…; intact, stays_whole, unbroken…; breaks_before…. The mechanics module (its `fragile` egg)
  and the softbody module (its snapping beams) also call a goal `breaks` / `survives` and load after this one; this module's build hook hands their
  kinds on (`_claim_goals` / `claim_goals`) and answers for every item with a `broken` reading, theirs included, delegating any other item to theirs.
- **Measured** (`research/rw-validate-fracture.ts`, 44 gates, all pass; the repair's 14 are in groups soft, water, jar, edge, pane, tower): an egg cracks under a resting 35.1 N (3.58 kg) [EGG-F 34.9-36.4 N] and at
  1.02 m/s on a rigid floor [EGG-V 1.0 m/s], is smashed at 3.95 m/s, its pieces weigh 57.00 g of 57.00 g (a kitchen scale reads 57.0 g before and after); the padding laws at their sources' points;
  the engine's peak forces through padding equal the energy balance to 0.5 %; the highest safe drop table 6 ≤ EPS 12 ≤ carpet 12 ≤ bubble wrap 21 ≤
  cotton 32 ≤ foam 55 ≤ pillow 98 cm; a glass whole from 40 cm and in shards from 50 cm, a tempered-strength one survives 70 cm [NITE]; a plate whole
  from 30 cm, in sherds from 40 cm; spaghetti and craft-stick beams snap at 4σZ/L within 1.5 % (1, 5, 10 strands; 10 and 20 cm) with the sag
  P·L³/48EI within 1.1 %; a bowling ball parts loose and taped towers, not a glued one; an 80 cm parachute brings a 196 g box to 2.70 m/s (terminal
  2.82); on the Moon an egg cracks from 31.3 cm (v²/2g: 30.9). Calibrations, said as such: the glass's and the plate's stiffness and strength, the
  fibre laws' s0, the box's crush stiffness, tack and glue stick strengths.
- **AI** (web/sim/modules/fracture.js `plugin`): the digest's how-to (any egg that should break is raw-egg; the mechanics module's egg {fragile} is the
  simple version with no pieces; drops as held items on air at y_m; loads ON a snap-bridge at its x and `strands` counts pieces of `made_of`; a wide
  load spreads the bending; other modules' soft things cushion; WATER: a tank's water slows a breakable and only the floor hit counts, a raw egg sinks
  in fresh and floats in 12 % salt water, never a cushion standing in for water; TABLES AND SHELVES: a real table, or a plank on blocks or posts, never
  one hanging in the air; the egg-drop box is one item; a parachute does nothing in a pumped jar), plan / edit / refine snippets (refine: never drop or
  relabel a predicted outcome's goal: keep it, say it is not met yet, offer the change that makes it happen), 7 worked `examples` (padding comparison,
  strands for a load, the egg-drop challenge, glass on carpet, loose vs glued towers, a baseball at a window, an egg into water), the four goal kinds,
  digest lines (what breaks it and from what drop; a pane's breaking ball speeds; a bridge: "10 strands of spaghetti … holds about 286 g pressed at one
  point in its middle, about 329 g of a 3.5 cm steel weight, 351 g of a 5 cm block" (P = 4·M_c/(L − w)) and, after a run that held, "with the last run's
  load where it is (300 g on it, 93 % of its strength), it snaps at about 321 g" (the engine: holds 320 g, snaps at 330 g); a tower: "last run: came
  apart: 1 of 6 blocks fell; its top 25.6 cm up at the end (built 30.5 cm)", no share for a loose one), change words ("breaks at 1840 → 7360 N",
  "padding 5 cm → 8 cm thick", "padding round the egg 3 cm → 5 cm", "gap 25 cm → 50 cm", "made of spaghetti → chocolate bar; 10 g → 1 kg" (the card's
  weight says how many bars), "glass 3 mm → 4 mm thick"), knobs: cushion thickness and material, egg-drop-box padding_thickness, padding, parachute (from none: "give the
  box a 20 cm parachute"), size, snap-bridge strands, span, made_of, block-tower glue, window-pane thickness, a raw egg's strength in whole newtons within
  30-40 N, and (costly) the glass's and plate's strengths. Two knob fields were added to the plug-in point for this (web/ai/fixer.js, documented in
  web/sim/plugins.js): `min`/`max` (the knob's own range inside the prop's) and `from_zero`/`to_zero` (the offer's words from or to 0, said whole).
  Tests: `web/ai/test/fracture.test.mjs` (digest, plans and aliases, the solver's placing, goal checks alike, digest lines, change and fix words, and the
  search finding "make the pillow pad thicker (12 cm → 16 cm)" after an edit raised the egg), `tools/fracture/test.mjs` (catalog, documents, tracks
  server == bundle byte for byte, summaries Python == JS, on random scenes; the thresholds in the engine).
- **Fix workers** (`web/ai/fix-pool.js`, a repair found by this module's acceptance): a job goes to a fix worker only once the worker has said it is
  ready. web/sim's module index loads with a top-level await, so a job posted to a worker still loading reached only the engine bundle's own listener
  (which answers a message without `fix: 1`) and the search waited for ever: "Looking for a fix…" never ended on a page whose workers were new (the
  plain ball-drop scene too). Workers still start side by side, one per waiting job, up to the pool's size.
- **Limits**: 2D side view: an egg lands on the side its outline meets; a beam is simply supported (a load on an overhang never lifts its far end); padding
  under a padded thing is not counted twice (only the padding the hit meets); a cracked egg stays whole until a force over half its strength smashes it;
  pieces are rigid (the spill is a thin slab); the glass and plate thresholds are calibrations, not measurements. An egg's 35 N is a point contact's: a
  load spread over a wide patch (pressed into clay, held in a hand) would take more, which is left out (so clay cracks an egg from 30 cm). A rigid
  sprung plate (a bounce pad, a spring launcher's plate, a coil spring's platform) meets a breakable with its own mass, its springs too slow to matter
  in the millisecond of the hit (correct for a rigid plate); only a trampoline's mat (a membrane) is a spring in series. Rim-on-rim contact is the
  [EDGE] share (0.5, provisional), not a Hertzian stress analysis. A pane is a quasi-static simply supported plate hit at its middle (an edge or corner
  hit is not weaker here); its threshold ball speed grows only as √t. Broken pieces in a liquid displace as their drawn outlines scaled with the whole
  (an eggshell half floats). The air module's own drag on the box inside a jar is that module's.

## Filming module (`staging`, 2026-10-19): a fixed camera, starting gates, paint on the lesson toys

Render only: nothing here changes a body, a contact or a track (`tools/staging/test.mjs` runs the same scene with and without them on the browser bundle
and the server: the same bytes). Files: `machines/mod_staging.py` and its port `web/sim/modules/staging.js` (catalog prop, build hook, AI plug-in),
`web/start-gate.js` (the gate's 3D parts and swing), small edits in `web/view3d.js` (gates, the fixed camera, the export), `machines/items.py` /
`web/sim/items.js` build (`doc.view`), `ai/schemas.mjs` (a plan's settings take `camera`). Lesson use: `lesson-regen/compositor/ENGINE.md`.

- **doc.view** (new, optional, render only): a module's build hook may set `sb.view`; build writes it as `doc.view` after `processes`. Written only for a
  scene that sets `settings.camera` or an item's `start_gate`, so every other scene builds the very document it did before (the 12 scenarios and 10
  gallery scenes: byte-identical documents, tracks, summaries and layouts, Python and JS, with the module and without; only the catalog lists the new
  prop). The engine ignores it (`SceneDocument` decodes known keys only).
- **settings.camera** `{x0, x1, y = 0.3, pitch = 6.843, hfov = 69.39}` (m, m, m, degrees down, degrees across) → `doc.view.camera` (floats, defaults
  filled in). A FIXED side camera: it stands d = (x1 − x0) / 2 / tan(hfov / 2) in front of the machine plane (z = d), at the height y + d·tan(pitch),
  looking at ((x0 + x1) / 2, y, 0), +y up, the vertical field from hfov and the picture's aspect; near = max(0.02, min(0.5, d / 200)), far = max(80, 4d).
  The machine plane spans x0..x1 across the picture at the height y (the picture's centre line): exactly at pitch 0, 1 / cos(pitch) of it when tilted.
  The defaults are the Wide shot's own lens (26 mm) and tilt (tan = 0.12). Nothing else goes into it: every run with the same camera is filmed from the
  same place, so lanes run apart line up pixel for pixel (`lesson-regen/compositor/camera.py` `camera_pose` with `cy` = y is the same math, checked to
  1e-13 px against `exportProject`). Checks (Python == JS, the same words): an object; only those keys; x0 and x1 given; x0, x1 −1000…1000, y −10…100,
  pitch −20…80, hfov 5…120; x1 − x0 from 0.1 to 300 m. Without it the Wide shot frames each run by itself (FRAME_X: never wider than x −1.5…4.5 m).
- **The view**: the canvas's Wide shot IS the fixed camera when the run's doc has one (`frameWide`; `lastFrame.fixed`), whatever the canvas's size (the
  buttons may cover its top); a load of such a run frames afresh even when the app keeps the camera (and so does the first load after one). Follow and
  Orbit are as before. The wide camera's near/far are set back to 0.05 / 80 for a run without one.
- **The export**: `renderFrame(t, {camera: "wide"})` draws the fixed camera when the doc has one (so the lane tools need no change); `camera: "fixed"`
  says so explicitly (the wide shot without one); `exportInfo().fixed` is the doc's camera or null (`cameras` lists "fixed").
  `exportProject(t, x, y, {camera, width, height, xy: true, z})` returns `{x, y}` (both −1…1: left/bottom to right/top; z: the point's depth, 0 = the
  machine plane) instead of x alone: overlays can be placed from the export's own shot.
- **start_gate** (bool, default false; a common prop, listed on the dynamic types of the categories Balls, Wheels & vehicles, Blocks & shapes) →
  `doc.view.gates` (the ids of every item that sets it, in scene order). For a HELD item (`held: true`; the engine holds it exactly still until the
  scene's `release`) the view draws a starting gate instead of the pull pin (`web/start-gate.js`): a boom barrier, a white arm with red bands on a steel
  pivot at the top of a 24 mm wooden post, reaching back along the item's way to a white stop (a dowel across the item's width, radius 10 % of the
  item's height, 3 to 30 mm) that touches the item's front, its downhill side, at the front's own height (a ball's equator, a bumper). The way down is
  the item's own motion in the run (its first 3 mm within 0.6 s of the release), else the slope of the static surface under it (a layout). The arm is
  level, 1.2 × the item's size (0.12 to 0.6 m), on the way-down side; the post stands just behind the item's own path (its widest part + 6 mm) on what
  is under it there (the ramp's plank, a carpet strip, the table), sunk by the slope across its foot. At the release the arm swings up 75° in 0.25 s,
  easing out (cubic): one frame after the release the stop has risen centimetres while the item has moved a fraction of a millimetre (a 28° ramp,
  a 40 cm ball: 0.17 mm in 10 ms while the stop rises 7 cm), so nothing is seen pushing or passing through it. No way down to block (it would fall straight down,
  or it does not move): the pin as before. The post and gate are picked as the item while it is held, like the pin; the export's motion blur takes
  sub-frames while a gate swings. Not held: no gate (the doc still lists it).
- **Paint** (the mechanics module's `color` prop: none, a named paint or any `#rrggbb`; render only, its solids' `color`): the lesson toys' models take it: toy-car,
  motor-car, truck (cab and body; tyres and hubs as they are), dynamics-cart, every ball (tinting its pattern), wooden-block (a stain), clay-ball,
  clay-lump, and now cup (a plain coloured paper cup, no printed band), plastic-cup (its red becomes the paint) and cart (its side beams stained; the
  deck bare wood). Not yet: clay-boat (its model keeps its own clay green; web/models/mod-fluids.js), foil-boat (foil stays foil). The sailboat paints
  with its own colour prop (hull, mast and sail).
- **AI**: the digest's module paragraph (settings.camera, start_gate), plan and edit lines ("a ball or car that waits at the top of a ramp until the
  release: held: true and props.start_gate: true"; "a long track or lanes that must line up: settings.camera"), change words ("starting gate on (it
  lifts at the release)"); `ai/schemas.mjs` validates `plan.settings.camera` (and `set_scene {settings: {camera}}` edits through the same schema).
  The inspector lists Starting gate (a checkbox) on the types that take it. The Scene settings have a **Camera** row (web/inspector-plugins.js
  `settingsRows`): Wide (no settings.camera) or Fixed, which starts from the scene's items' x span (0.75 m more each side, at least 2 m) and shows
  Camera from / to (x0, x1 m), aim (y m), tilt (pitch °) and lens (hfov °), each kept in the module's limits (x1 − x0 0.1…300 m, in floats as the
  server checks it); a number left at its default is not stored. The export dialog (web/export/export-ui.js) offers a **Fixed** camera when the run's
  scene sets one (`exportInfo().fixed`, read again as the dialog draws), with its span in the hint; a remembered Fixed falls back to Wide otherwise.
- **Tests**: `node tools/staging/test.mjs [--server <port>]` (catalog entries Python == JS, documents and errors alike, tracks unchanged with and without
  doc.view on the bundle and the server, the AI registry, digest and schema).

### Filming module: directed cameras (2026-10-20): shot plans filmed exactly (web/export/shots.js, web/export/subjects.js, web/view3d.js)

Every video gets a camera directed for what it teaches: a **shot plan** (`web/export/shot-plan.schema.json`, JSON Schema 2020-12; the language is
DIRECTOR.md section 3: shots with a story beat and an intent, a run window at a speed, a move, a subject, a framing, a join, a look, marks) is
written by a director (the AI step `direct`, a person, or `autoPlan` when there is none) and the engine films it exactly: every target is resolved
from the scene and its finished run before a frame is drawn, the camera of every frame of every band is planned once (non-causally, like follow and
director), and a safety net measures it. View only: no body, contact or track changes (`web/export/test/identity.test.mjs`: the 12 scenarios and 10
gallery scenes run byte for byte as before; filming a run never changes it).

**The pure module** (`web/export/shots.js`; node and page alike; imports only `web/track.js`, the optics tracer `web/sim/optics.js` and the
recognizer `web/export/subjects.js`):
```js
import * as Shots from "web/export/shots.js"
const world = Shots.makeWorld({run, scene, catalog, registry, hints, boxes, environment})   // or {runs: {lane: {sim, scene, boxes}}, ...}
Shots.resolvePlan(plan, world)  -> {ok, errors: [{at, message, nearest}], warnings}          // every id and target exists (DIRECTOR.md 7.1)
Shots.compile(plan, world, {width, height, fps, kind}) -> film                              // throws PlanError {message, shot, nearest}
Shots.measure(film)             -> report {ok, shots: [measured facts], checks: [{shot, check, ok, why}], failed: [sentences]}
Shots.checkPlan(plan, world, {width, height, fps}) -> {ok, errors, report, film, messages}  // resolve + compile + measure, for the director's repair
Shots.autoPlan(world, {width, height, fps, moves, environment}) -> plan                     // the plan with no director (camera "focus")
Shots.digest(world) -> data; Shots.digestText(digest) -> the prompt's text                  // what a director may name (DIRECTOR.md section 2)
Shots.frameAt(film, tau) -> {frame, shot, u, t, bands: [{lane, rect, inset, pose}], look, label}
Shots.runTimeAt(film, tau), Shots.videoTimesOf(film, t), Shots.retime(film, impacts), Shots.cameraOf(pose), Shots.specOf(pose), Shots.filmFromJSON(json)
Shots.NET, Shots.VIEWS, Shots.TONES, Shots.FLOORS, Shots.DEFAULT_LOOK, Shots.VERSION (1), Shots.PlanError
import { checkSchema } from "web/export/schema-check.js"   // checkSchema(schema, plan) -> [{path, message}]: the schema's keywords, no library
```
- **The world**: `run` is an `/api/simulate` answer `{doc, track, summary}` (or the view's `run.sim`); `scene` the scene JSON (better words and goals
  for the recognizer; `sceneFromSim(run)` without it); `boxes(solidId)` (or an object of them) the drawn models' boxes: `{x0, x1, y0, y1, z0, z1}` in a
  mover's own frame, `{round: R, z0, z1}`, or `{world: [x0, x1, y0, y1, z0, z1]}` for a still thing (the view's `exportBoxes()`); without them a solid's
  physics outline (a polygon's corners, a ball's circle, a slab's rectangle) times its depth stands in. `runs` instead of `run`: one run per lane
  (the lesson compositor's lanes), each lane's id the plan's lane id. `environment`: a module's world (space: `{room: false, table: false}`).
- **Moments** (section 3.4) come from the run: `start release result end pause:setup pause:result t=<s>`, `start: stop: exit: landing:<item>`,
  `apex: turn:<item>[#n]` (a swing's turn back: odd n on the far side), `contact:<a>+<b>[#n]` (both orders), `event:<kind>:<item>[#n]`,
  `reading:<item>.<key>:<starts|settles|peak|max|min|crosses=v>`, `beam:<source>:on`, `cue:<n>` and `step:<n>` (the skill's cues); `{at, plus}`;
  `@lane` for one lane's run; a lane role's name in `start:`/`stop:`/`contact:` ids means each lane's own item (the latest of them).
- **Targets** (3.5) resolve to box corners at a run time: `{item[, part]}` (the drawn model's box), `{items}`, `{role[, lane]}`, `{point}`,
  `{region}`, `{contact: [a, b], nth}` (where they touch at that impact), `{item, event}`, `{item, reading}` (its `face` part), `{beam}` /
  `{beam, segment}` / `{beam, bounce}` (the turn and both rays 12 cm either way, and the face normal) / `{beam, from, to}` (`source`, `bounce:<n>`,
  `hit:<item>`, `end`) from the optics tracer's own trace at that moment (the levels, drives and liquid levels the view draws with), `{trail, from,
  to}`, `{through}`, `{gap}`, `{mark, m}` (a lane's metre mark, on its floor: `measure-mark` zero + m). `pad` grows a box by that much each way (a
  mark: along its lane). `{path}` (a module's drawn route) is refused: no module publishes one yet.
- **A film** is plain data (JSON.stringify keeps all of it): `{version, kind, W, H, fps, duration, frameCount, runSeconds, lanes, perLaneRuns,
  shots: [{id, beat, move, layout, arrange, i0, n, tau0, T, t0, t1, rate, holdAfter, playT, label, look, bands: [{lane, rect: [x, y, w, h] px from
  the top left, inset?}], hide: [[item ids each band leaves out]], in, notes}], frames: [{s (shot), t (run time), b: [[Lx, Ly, Lz, d, yaw, pitch,
  hfov] per band]}], marks: {frame index: [[primitives] per band]}, notes}`. A pose: the camera at L + d (sin yaw cos pitch, sin pitch, cos yaw cos
  pitch) looking at L, +y up, no roll, hfov radians. Shots are whole frames at the film's fps; tau (video time) i / fps is frame i; `frameAt`
  interpolates between two frames of one shot only (never across a cut). Run time per shot: `clamp(rate ? min(t1, t0 + rate u) : t0, 0, run's end)`
  (a window reaching past the run's end plays its whole length, the run held at its end).
- **Execution** (DIRECTOR.md 4): `fit` (tight 6 %, snug 10 %, loose 18 % margins, centred on subject + keep by iterating the projected box), `size`
  (the subject's larger side that share of the picture; backs off for keep), `width` (metres across at the look point); `place`; `view` (side, eye,
  low, high, top-down, three-quarter-left/right, macro, or `{yaw, pitch}`) and `lens` (mm). hold: the union over its run window, still (a `continue`
  hold that names no new framing keeps exactly the last pose); push/pull: the director's straight dolly line from the start framing (or the last
  pose) to `end`, eased (smooth, gentle, linear) over `move_seconds`; arc: yaw, pitch, look point and log-distance together; follow: the subject's
  centre at 60 Hz over the shot and a second beyond each end, clamped at `stop_at`, zero-phase critically damped (omega 3), steady horizon for axis
  x, room ahead along the motion faded in with the speed, distance backed off for `keep` (an envelope 0.6 s wide), `per_lane` each band its own;
  travel: the look point along the path at a trapezoid pace (or leg by leg with `dwell` rests). Joins: cut; continue (from the last pose; a 0.5 s
  glide when the shot's own start differs); `{ease: s}`. A join across a change of layout or arrangement is filmed as a cut (a note). Lanes:
  split (rows or columns, one camera shifted by each lane's offset, the median shift of paired start boxes or `align` on one role), together, single;
  one run per lane: the same pose in every band. Insets: a corner band with its own still camera.
- **The safety net** (`Shots.NET`, DIRECTOR.md 7.2): keep-in (2 % inside, every frame, every band), subject-size (each hero 0.09 and 0.10 high unless
  flat or thin; 0.045 in a setup or reveal shot), must-see and details (their floors; `min_size` raises, `small_because` lowers), speed (0.5 widths/s;
  a travel 1.25; a follow 1.5 while its subject is steady in the picture, 1.25 while not), zoom 0.7/s, turn 15 deg/s, no jump (3 widths/s), no jump
  cut, holds still and at least 0.8 s, the last shot (and a pause beat's last) still for its last 0.5 s, shots at least 0.8 s, a rate other than 1
  labelled, the beam's core 1.5 px and glow 6 px, an instrument face 18 % of the height, lane parity (one scale: picture widths per metre at each
  lane's own subject within 10 %). The report's facts per shot: sizes per band, heroes, must-see, faces, closest keep margin and when, peak picture,
  subject, zoom and turn speeds, the beam's widths, parity, travel length, notes.
- **autoPlan** (the "focus" camera): the recognizer's primaries (local supports and scenery never framed), its lanes as a split at one scale (rows
  for horizontal action, columns otherwise), a setup hold until 0.35 s before the first start, the action held still and snug (tight when that
  reaches the floors) or, when it does not, cut link by link at each next start (a chain) or a lone traveller followed at the closest width a calm
  follow allows, the result held to the end, a follow that runs to the end handed to a still; jump cuts become glides; the run plays at its own pace
  from 0 to its end (video time = run time, so every caller that films t = i / fps films it). A hero no framing gets to its floor is named in the
  plan's notes (framing-infeasible: the scene's to change). The studio look unless a module's world says otherwise. `moves: false`: the safe plan
  (holds and cuts only).

**The view** (`web/view3d.js`): two more export cameras, `"director-plan"` (alias `"plan"`) and `"focus"`; the others unchanged.
```js
view.renderFrame(tau, {camera: "director-plan", plan | film, width, height, fps, motionBlur, runId, output, runs?, lane?, focus?})
view.renderFrame(t,   {camera: "focus", focus: {scene, hints, catalog}, width, height, fps, motionBlur, runId, output})
view.exportProject(tau, x, y, {camera, plan | film | focus, width, height, fps, lane?, xy, z}) -> across the whole picture, through the point's band
view.exportInfo({camera, plan | film | focus, width, height, fps, runs?, lane?}) -> {..., duration (the film's), plan: {kind, duration, frameCount,
     fps, width, height, lanes, perLaneRuns, shots: [{id, beat, move, layout, arrange, video: [tau0, tau1], frames: [i0, i1], run: [t0, t1], rate, label,
     in, look, bands}], notes, report, plan}} (plan: null and planPending while the models load; planError when the plan cannot be filmed)
view.exportCamera(tau, o) -> {tau, t, frame, shot, layout, arrange, bands: [{lane, rect, inset, position, target, up, hfov, vfov, near, far, spec}]}
view.exportPlan(o) -> {film, plan, report, summary}      view.exportDigest(o) -> {digest, text}      view.exportBoxes() -> {solid id: box}
view.setOptions({catalog})   // the app hands its catalog over: the recognizer reads its categories, tags and readouts
```
- For both cameras t is **video time** (a plan may slow the run, hold a moment, cut back); each frame's run time comes from the film. The focus film
  plays the run at its own pace, so its video time is the run time. `exportInfo().directed` = `{goals, comparison, lanes}` for the run shown.
- Films are made once per run, picture size, fps and plan (cache keys hash the plan, film and focus options by content), from the run's track and
  the drawn models' boxes, measured once the models are in (the mounts and stands the view adds to hold parts up are not part of a part's box).
  A plan naming what the run does not have is a RangeError with the resolver's messages and the nearest ids.
- Each frame draws its bands (viewport and scissor on the export's MSAA target), each with its own camera; in a split band of one run the other
  lanes' things (their roots, contact shades, mounts and stands) are left out and the key light's shadow map is drawn again for that band; motion
  blur sub-frames stay inside the frame's own shot (half a frame past its last frame at most, never across a cut), their count measured over every
  band (camera and bodies). The look per shot: backdrop `studio` (the room hidden, a plain backdrop in `tone`: dark #1b1e23, mid #3b4048, light
  #8d929b) / `room` / `scene` (a module's world, space's stars); ground `sweep` (the table top not drawn; an 80 m matte studio floor at its height in
  the tone, #15171b / #2c3036 / #6f747c, receiving shadows, fogged into the backdrop from d + 0.6 to d + 4.5 m: no wood, no edge, no wall), `table`,
  `hidden`; light `subject` (the key light's shadow frustum fitted to what the bands see) or `room`; labels `hidden` (the modules' sprites and boards);
  vignette. Not drawn yet: depth `soft` (no depth of field), a beam drawn only as far as a travel has gone (`travel.reveal`; noted in the film).
- Over each frame (2D, after the picture is read back; `output: "imagedata"` included): the plan's marks through each band's own camera (lines,
  dashed normals, angle arcs with the tracer's measured angles, distance bars, labels with `{label}` `{value}` `{m}` `{dt}` `{s}`; key readings 4 %
  of the frame's height, other words 3 %, white with a dark edge), a line between split bands, an inset's frame, and the shot's badge (`label`,
  top right). The overlay is deterministic in one browser build.
- One run per lane (the compositor): load each other lane, keep its `sim` and `exportBoxes()`; load the first lane, `film = exportPlan({camera:
  "director-plan", plan, runs: {other: {sim, boxes, scene}}, lane: first, width, height, fps}).film`; film every lane's run with `{film, lane}` (a
  band of another lane stays plain backdrop; a single or together shot comes from the first lane's run) and put the bands together by
  `film.shots[s].bands[].rect` (`web/export/test/film-plans.mjs` does exactly this). `exportCamera(tau, o).bands[].spec` is the fixed-camera spec
  `camera.py` projects (square-on poses: yaw 0), for its own overlays.
- `updateParts` fix (CAMERA_INTERNALS 9.4): a frame with no `scale` for a part a module has resized shows it at its own size, so a frame is a pure
  function of t on melting, dissolving or swelling runs too (a moment drawn after a later one used to keep the later size).
- `_debug.export`: `plan(kind, W, H, fps, o)` (the shot: film, plan, world, report), `world(o)`, `boxes()`, `Shots`.

**The export dialog** (`web/export/export-ui.js`): a **Directed** camera (`focus`), the default for a scene with goals or a comparison
(`exportInfo().directed`) unless the person picked a camera (`cameraChosen` is remembered, the camera with it); it passes `focus: {scene}` to the
preview, the frames, `exportInfo` and the sound's `exportProject` (the same film everywhere). `app.js` hands the view its catalog.

**For the AI step and the pipelines**: `direct` runs the scene (`runScene`), builds `makeWorld` (node: physics outlines; or the page's
`exportDigest`/`exportBoxes`), shows `digestText(digest(world))`, and validates the answer with `checkSchema(schema, plan)` then
`checkPlan(plan, world)` (its `messages` go back to the director, once); a plan that still fails films `autoPlan(world, {moves: false})` (the safe plan).
`audit` reads the frames `film-plans.mjs` makes (or any `renderFrame` of the film) with the plan's audits. The physics-lesson-video skill passes
`camera: "director-plan", plan` (or `"focus"` with `focus: {scene, hints: {roles, brief, cues, text}}`) to every `renderFrame`, to the audio
`panAt` and to the lane labels' `exportProject`, times its audio with `retime(film, impacts)` (video times), and takes `duration` from
`exportInfo(...).plan`.

**Tests**: `node --test web/export/test/shots.test.mjs` (executor on synthetic runs; the twelve plans of `web/export/test/plans`, every check
passing; the automatic plan on the 22 scenes, every motion and comfort check passing, video time = run time; `LESSON_SCENES=<compositor
build2/scenes>` adds the three lesson plans), `node --test web/export/test/subjects.test.mjs` (recognition: precision and recall on hand labels;
`FOCUS_TESTSET=` the scout's 180-scene set), `node --test web/export/test/identity.test.mjs` (view only), and the headless filming of the twelve
plans through this export: `node web/export/test/film-plans.mjs --server http://127.0.0.1:<port> --out <dir>` (stills per shot, today's Wide beside
them, contact sheets; every check passing in the page on the drawn models' boxes; frames byte-identical when drawn again after a later one;
`exportProject` exact to 1e-15 in every band).

## Machines and motion (module `mechanics`, 2026-10-19/20): catalog-wide start speed and paint, floors and ramps, lab carts, pullers, force meters, simple machines (a screw jack too), a roller coaster, falling through air, a balloon rocket, a fragile egg

Files: `machines/mod_mechanics.py` and its port `web/sim/modules/mechanics.js` (line for line: the same documents, number for number; the AI
plug-in), the engine's side `tooling/src/sim/mechanics.ts` + `tooling/src/sim/modules/mechanics.ts` (one process kind, `mechanics`, its records told
apart by `role`), the 3D models `web/models/mod-mechanics.js`, small framework edits (below). Nothing changes for a scene that uses none of it: the 12
scenarios and 10 gallery scenes build the same documents, tracks and summaries, Python and JS.

- **Catalog-wide props** (`COMMON_PROPS`, `register_common_prop(prop, applies?)` in `machines/items.py` = `web/sim/items.js`; listed after a type's own
  props with `"common": true`, their defaults in the entry's `defaults` only; `ai/catalog-digest.mjs` leaves them out of each type's lines and says
  them once in the module paragraph): `color` (none, red, blue, green, yellow, orange, purple, pink, white, black, gray, brown, or any `#rrggbb`:
  an OPEN choice (`open: true` in the catalog entry: web/server.py and web/sim/clean.js keep or leave out any other value exactly as they do an
  unlisted prop (a bool, a number or text of up to 64 characters kept as given, anything else dropped), never a 400, so older scenes with `"#c62828"`
  (or anything else) on a ball run as they always did; the inspector shows such a value as one more option;
  ai/schemas.mjs and web/ai/solver.js take `#rrggbb`); render only, the item's solids' `color` (a named paint's hex, a `#rrggbb` lower-cased; other
  text paints nothing. A ball's builder copies its colour prop as it is: a hex or other text stays so, but the 3D ball reads only a hex, so on a type
  whose colour is this common prop a named paint becomes its hex and "none" removes the copy: the very document of a ball that sets no colour,
  2026-10-20; "blue" and "none" drew a ball grey before) but its tyres, hubs, cords and pins), `glow` (render only, `glow` on its solids), and on every dynamic type `start_speed`
  (0-30 m/s), `start_dir` (−180…180°, from the way it faces, counter-clockwise), `start_spin` ("roll": round bodies and wheels turn as rolling,
  ω = −v/r; "none"). A moving item that sets start_speed gets a `start` record per moving body (`vx`, `vy`, and `w` for a round one); the engine sets
  those velocities at the release step (a held item when it lets go). An `egg` also takes `fragile` (bool).
- **Items** (category "Machines & motion" is new): `floor` (a long static slab, 0.5-60 m, its anchor the middle of its top; surfaces as the
  catalog's materials, grass and felt and sandpaper new), `ramp` (a plank on `blocks` 5 cm wooden blocks, 0-8; `rises` left/right; a lip at the top;
  its anchor the foot; resolved `rise`, `slope`, `blocks_used`), `clay-lump` (sticks to the first moving thing it touches), `dynamics-cart` (0.25 kg
  [PASCO]; `load` kg of bars, `plunger` 0-3 clicks of a 400 N/m spring, `bumper` plain/spring/magnet/velcro/clay; resolved `total_mass`), `puller`
  (a winch: link `pulls`, a steady force or a speed), `pusher` (a paddle: a force for a time, or a speed over a stroke), `edge-pulley` (link
  `pulls`; a hanging mass over a pulley at the table's end), `coffee-filters` (1.1 g each, `count` nested), `parachute`, `paper-sheet`,
  `paper-ball`, `feather` (falcon 30 g [APOLLO15] or craft 1 g), `coaster-track` (curved ramp, valley, hill, loop: arcs the ball rides with no
  polygon crease), `gear-train` (2 or 3 meshed gears, a motor on the first), `wheel-and-axle`, `block-and-tackle` (2-4 strands), `lever-kit`
  (classes 1-3; resolved `balanced_by`, the effort that balances; its pin has friction μ·N·r, 3 mm steel in wood at μ 0.25, provisional: about 3 mN·m,
  so a gram off the balance holds, as a real one does), `balloon-rocket` (readings `volume`, `thrust`), `screw-jack` (a screw lifting a steel `load`
  on its cap as its handle turns: `effort` N at the end of a `handle` m long, `pitch` mm a turn, `turns` a second, `efficiency` (0.3: square and Acme
  threads 0.2-0.4 [SHIGLEY], self-locking under 0.5), `lift` the stroke; the cap is driven up its screw at turns × pitch with at most efficiency ×
  effort × 2π·L/p (a `slider` drive, never back down: a heavier load stays where it is); its screw and tommy bar are welded ghosts (they touch
  nothing); resolved `advantage` (2π·L/p), `lift_force` (N), `moving_mass`, `lifts`; reading `lift` (m), which the view turns the tommy bar by).
- **Sensors** (readings, every one the mean over its last 0.1 s, `SENSOR_WINDOW`): a `puller`'s `newtons` (the pull in its cord: a force meter), an
  `edge-pulley`'s `newtons` (the pull in its string where it is tied to the cart: a force sensor, T = m·(g − a)), a `dynamics-cart`'s `speed` (m/s
  along the way it faces, + forward) and `accel` (m/s², the change of that speed over the window), a `screw-jack`'s `lift`. The view shows the force
  meters' readings over a puller's drum and an edge pulley ("mechanics:meters"). A puller in mode speed has a 2 kg drum (its gearbox held at speed):
  a 10 g drum fought the cord within each solver step and flung what it reeled in 45 % fast; mode force keeps the 10 g drum.
- **Engine records** (`doc.processes`, kind `mechanics`; `MECHANICS_ROLES` in `tooling/src/sim/mechanics.ts`): `start`, `force` (a puller's or a
  pusher's), `gear` (two hinged gears' angles tied by their teeth), `spool` (a cord wound on a wheel or an axle), `slider` (a straw on a string, a
  plunger in its rail, a screw jack's cap on its screw), `sticky` (weld on first touch), `meter` (`reads` "rope": the pull of the rope joining solids
  `a` and `b`, a spool's or a doc pulley's (physics.ts's rope-pulley), from its joint's reaction; "motion": a solid's speed and acceleration along its
  own x; "rise": how far a solid has risen; `key` the reading's name), `arc` + `loop` (a track's circular pieces: a contact held on the arc's circle, bending the
  velocity by the curvature, so a ball keeps its energy to 0.07 %; a ball a hair inside the track is put back by the position pass, never
  by a push, so a ball rolling onto a hump's arc from a slope gains nothing), `balloon` (jet thrust 2·C_c·Δp·A while the latex holds its pressure, the size and
  drag shrinking as it empties), `unbuoy` (light broad things are not lifted by the air's buoyancy twice), `fragile` (a strike's peak force
  v·√(k_eff·m), k_eff the egg's 1.5e4 N/m in series with a soft surface's; over 35 N it cracks and stops: readings `broken`, `peak`). The plug-in
  framework gained `Process.after` (after each step), `Process.contact` (begin / pre-solve), `SolidHandle.setVelocity` and `ProcessContext.engine()`
  (the world, bodies, anchors) for these. Hinged parts marked `notHinge` are not treated as hinges by the engine's hinge rule.
- **Goals** (Python == web/sim == ai/goals.mjs = web/ai/goals.js; names no other module uses): `balanced {item, part?, max_deg?, max_m?}` (its main
  moving part moves < 1 cm and turns < 2° all run), `rises {item, part?, min_m?}` (its load ends ≥ 5 cm higher), `gear_speed {item, part?, rpm?,
  tol?, direction?}` (its last gear's speed over the run's second half, and its way round), `loops {item, track}` (round the coaster's loop, never
  20 % of the radius inside the track in its top half), `recoils {a, b, ratio?, tol?}` (from rest, neither given a start speed: just after the push,
  0.15-0.35 s after the release, the two move off opposite ways at ≥ 2 cm/s, speeds in the given ratio; entry `from_rest`), `accelerates {item, accel, tol?}` (a least-squares fit from the release until it hits
  something or 1.5 s), `pulls_with {item, newtons, tol?}` (a force meter's steady reading: the median of its `newtons` from 0.2 s after the release,
  the frames under a tenth of its highest left out; tol 5 %, at least 0.05 N; entry `newtons_read`), `net_force`, `energy_kept`, `energy_to_heat`
  (force arrows and energy bars, below). `rises` on a screw jack wants 1 cm by default. The egg's `breaks` / `survives` are the fracture module's (they read any `broken` reading); clay's and velcro's `sticks` is the
  magnetism module's.
- **AI** (`plugin` of `web/sim/modules/mechanics.js`): the digest paragraph (how to place each thing: a car on a ramp at the top end + half its length
  + 3 cm; machines on "air" at a height their weights clear the table; the edge pulley at the table's right end + 4 cm, 1.6 cm up; a floor's id never
  "floor": `place.on "floor"` means the table; an inclined plane with a force meter: a puller on the floor just past the ramp's top, its drum on the
  slope's line), plan / edit / refine lines, 19 worked examples (one per lesson demo), knobs (lever effort and distances in slotted-mass and
  centimetre steps, wheel-and-axle and tackle effort, strands, gear teeth and speed, coaster height and loop size, ramp blocks, cart load and
  plunger, hanging mass and its drop, forces, a puller's speed, balloon pressure, canopy, filters, a screw jack's push, handle, thread, load and
  turning, `start_speed` of cars, carts and balls), the edit digest's lines (a lever's
  balance, a machine's advantage and its load's rise, gear speeds measured, a cart's mass and momentum, F = ma's expected acceleration, a loop's
  least height, an egg's peak force, a set start speed, a force meter's steady reading and the string's M·a, a screw jack's advantage, lifting force
  and whether it lifts its load) and change words ("effort 250 g → 300 g", "2 → 3 rope strands, mechanical advantage 2 → 3", "ramp on 1 → 3 blocks,
  rise 5 cm → 15 cm", "start speed 0 → 1.2 m/s", "thread pitch 5 → 2.5 mm a turn", "reels in at 0.1 → 0.2 m/s").
- **Measured** (`research/rw-validate-mechanics.ts`, 81 checks, all pass): a toy car down 1 vs 3 blocks onto carpet within 8 % of v² = 2gΔh(1 −
  C_rr/tan θ) and the roll-out v²/(2C_rr·g) (0.95 vs 2.52 m); the same scene twice, byte for byte; clay on the roof changes the roll 0.3 %; start_speed:
  no speed-up at all; a 5 vs 3 N tug of war within 1 % of (2 − C_rr·m·g)/(m + wheels), equal pulls hold; F = ma 0.851 m/s² (ideal 0.892; 0.24 % from the
  closed form with the cart's rolling resistance and wheels); coffee filters 1.006 m/s, 1 : √2 : 2 within 0.01 %, their approach to terminal speed
  the quadratic-drag closed form within 0.6 %; a 30 cm parachute ≈ 3.0 m/s; Apollo 15's hammer and feather land together at 1.406 s; plunger carts
  2 : 1 within 0.9 %; velcro, magnet and clay collisions within 2-3 % of momentum's numbers; the lever, wheel and axle, block and tackle balance at
  the law's efforts and move in their ratios (0.0 %); gears at −10.000 and 18.000 rpm; the loop's least start height 0.371 m against 2.7·(R − r) +
  the track's 2 cm 0.391 m (5 %); a ball on a valley track climbs back to 99.7 % of its drop; the balloon's push 0.292 N and burn time; an egg cracks from 7.3 cm onto the table, at 91 N from 0.5 m, and
  survives 0.5 m onto foam; the edge pulley's force sensor reads m·(g − a) within 0.04 % and M·m·g/(M + m) within 0.4 %, the cart's own
  acceleration and speed readings its track's within 0.13 %, F/a its mass within 0.2 %; a winch set to 2 N reads 1.992 N; pulled up a ramp at a
  steady 0.1 m/s a 1 kg cart takes m·g·(sin θ + C_rr·cos θ) within 0.07 % (4.23 N on 8 blocks, 1.72 N on 3, against 9.81 N to lift it); a screw jack
  lifts at turns × pitch exactly, lifts a load 3 % under efficiency × effort × 2π·L/p and not one 3 % over (74.5 kg for 10 N on a 20 cm handle, 5 mm
  thread), and twice the load with a handle twice as long. Force arrows (K12, 13 checks) and energy bars (K11, 10 checks): see the next item.
- **Force arrows and energy bars** (2026-10-20; spec X9, K11, K12): catalog-wide props on every dynamic type, render only, the run records the
  numbers only for an item that asks: `arrows` (an OPEN choice: "none" (default), "all", "net", "all+net", one kind, or kinds joined by "+" or ","
  (`gravity+support+net`); ai/schemas.mjs `joinedChoice` and web/ai/solver.js take any join of the words of an open choice whose listed choices
  join words with "+", normalised to "a+b"; a colour is never such a join), `arrow_scale` (m of arrow per N, 0-1; 0 auto), `show_energy` (bool).
  The build hook `_shows` adds `{kind: "mechanics", id: "<item>#forces", item, role: "forces", solids: [its dynamic solids], show: [kinds], scale}`
  for an item with arrows or one a `net_force` goal names, and `{role: "energy", id: "<item>#energy", item, solids, bars}` for one with
  show_energy (`bars` true), one an `energy-bars` board links (`watch`), or one an energy goal names; nothing else changes. Readings (N, world,
  each the mean over its last `FORCE_WINDOW` = 1/60 s, 8 steps): `f_<kind>_x`, `f_<kind>_y` for `FORCE_KINDS` gravity (its own mass × g),
  support (a contact pushing it within 60° of straight up), push (any other contact: a wall, a paddle, a collision), friction (along the
  contact), tension (ropes, cords on drums, a pulley's string), spring (the engine's springs, and a spring's own weight its end carries), air
  (drag or a fan's wind, as physics.ts applied it), buoyancy (the air's displaced-volume lift; a liquid's push, from the liquids module's
  pushes), magnetic (the magnetism module's and an electromagnet's), applied (a balloon's jet, a force record, other modules' pushes) and net
  (their sum); where the contact and joint kinds act (`f_<kind>_px`, `_py`, the force-weighted mean of their points) and its centre of mass
  (`f_cx`, `f_cy`); an item with two or more ropes or springs also gets each one's own (`f_tension1_x` ... `f_tension<n>_py`, `f_spring1_x` ...:
  a tug of war's two pulls). Only forces from outside the item count (contacts and joints between its own bodies are left out: a cart's wheels).
  Contacts are read right after planck's main solve (their impulses ÷ h); a sleeping body's contacts keep their last solve's impulses. Energy
  readings (J): `e_kinetic` ½·M·v² + ½·I·ω², `e_potential` M·g·y (y of each body's centre of mass, from y = 0) plus a spring's own weight's F·y,
  `e_spring` ½·k·x², `e_heat` what has left the motion since the release, `e_added` what has come into it (the net: at most one is above 0);
  start + added = kinetic + potential + spring + heat at every frame, exactly. The step's velocities are planck's semi-implicit Euler's, the
  step's middle's, so heights and stretches are paired as the step's mean (½·(y₀ + y₁), ½·k·x₀·x₁): a free fall's ½mv² = mgh to the bit,
  a pendulum in a vacuum to 3·10⁻⁵ of its swing, an undamped spring to 10⁻¹³. The view: "mechanics:arrows" (a shaft and head per kind in fixed
  colours, gravity blue, support green, push amber, friction red, tension violet, spring pink, air sky, buoyancy teal, magnetic fuchsia,
  applied orange, net near-black and thicker; labels "gravity 6.4 N" (one decimal from 1 N, two figures under), "pull", "air resistance" or
  "wind" (with its motion or against it), "net force 0 N" when balanced; gravity, the net and the air from the centre of mass, contacts and ropes
  from where they act; one auto scale for the scene: its biggest typical force (the 90th percentile over the run, so a collision's spike does
  not shrink the rest) a fifth of the scene's extent over the run, 3-40 cm, a spike drawn at most 1.6 times that; on HUD_LAYER, depth test
  off) and "mechanics:energy" (an `energy-bars` board: kinetic, potential (from the lowest point it reaches, or `zero: "floor"`), spring, heat
  and sound and the total, as the run plays; show_energy's small bars beside the item). New item `energy-bars` (a white board on two legs, a
  ghost: `width`, `height`, `zero` lowest|floor, link `watch`). Goals (Python == web/sim == the AI's check): `net_force {item, at_most_n?,
  at_least_n?}` (the median net from 0.1 s after the release; with neither, balanced: under 2 % of its weight + 0.01 N; entry `net_n`,
  `weight_n`), `energy_kept {item, tol?}` (at most tol, 5 %, of the energy it had to spend turned to heat: its end total less its lowest
  potential energy; entry `lost_pct`, `heat_j`), `energy_to_heat {item, at_least_pct?}` (10 %). The digest's lines: "forces on it (N, from
  the run; its arrows show ...): just after the release gravity 6.38 N down, support 6.36 N up; net 0 N (balanced); at the end ..." and
  "energy (J; potential counted from the lowest point it reaches): just after the release kinetic ..., at the end ..., heat and sound ... (x %
  of the ... it had to spend)"; change words "force arrows none → all", "energy bars off → on", "arrow length auto → 2 cm per N"; knobs: a
  puller's force in newtons (+2 N balances 3 N against 5 N). Framework additions (read only, nothing changes for a run without a watcher):
  `Process.watchesForces`, `ProcessContext.reportForce(solid, kind, fx, fy, at?)` and `forces()` (every process's pushes this (sub-)step, under
  its process kind, or its reports instead), `EngineInternals.afterSolve(fn)`, `airOn(id)`, `jointForce(joint, body, inv_dt)` (planck's
  joints, physics.ts's hinge, cord, spring, pulley rope (`RopePulley.forceOn`) and chain touch (`ChainTouch.forceOn`)), `spring(joint)` ({k, x}:
  `SpringLink.stretchNow`) and `springWeights(body)`; mechanics.ts's `SpoolRope.forceOn` and `ArcTouch.parts`. Measured
  (research/rw-validate-mechanics.ts arrows, energy): a resting book's support 6.362 N against gravity 6.376 N (0.23 %: the air holds the
  rest), acting at the table top, net 0; a tug of war's pulls 4.988 and 3.007 N, the net their sum with friction exactly, = M·Δv/Δt within
  0.005 %; a floating block's buoyancy its weight within 0.11 %; a parachute at its steady speed, air = gravity within 0.15 %; a coffee
  filter's net = m·a over the reading's window within 0.001 %; a 30° pendulum in a vacuum keeps KE + PE within 0.003 % of its swing (its
  bottom's KE mg·Δh within 0.003 %, no heat), with air 1.05 % turns to heat in 4 s, never less; a free fall's KE = mgh exactly; an undamped
  spring's KE + PE + ½kx² to 2.6·10⁻¹⁴; a sliding block's heat its ½mv² within 2 %, the leftover never below −1e-6 J (nothing put in), the
  bookkeeping exact every frame.
- **Parachute regression** (fuzz-454, 2026-10-20): a cord or string from a puller or an edge pulley is tied to a parachute's load (`TIE_PART`), not
  its canopy: a 1 g canopy hauled by a 0.92 kg hanging mass into a fixed cup's wall was 900 times lighter than what pulled it and the run broke
  down (NaN), with air or without (its drag was not the cause); 0 of 600 random parachute and pulley scenes break down now (9 and 6 of 300 did).
- **Tests**: `node --test web/ai/test/mechanics-plugin.test.mjs` (registry, plan checks, summary == the AI's own check, digest, change words, Python
  == JS on a real run of every goal kind, the screw jack and the force meters, force arrows (a book, a tug of war) and energy bars (a pendulum
  in a vacuum, a sliding block), the arrows' joined words, the make-it-work search balancing a tipping lever, lifting an overloaded screw jack
  and balancing a tug of war through the knobs); `node --no-warnings research/rw-validate-mechanics.ts arrows|energy`; `node --no-warnings tools/mechanics/test.mjs --n 300` (Python == JS: random scenes of the module's types,
  the catalog-wide props on every type, the catalog entries, every goal kind summarised on real runs); the parity fuzz covers the items. The core
  parity harness's server and everyday modes give the port the catalog-wide props the server has (`register_catalog_wide` of a module's JS file,
  `tools/parity/core.mjs` loadCatalogWide; browser-everyday's first page the same) and compare each catalog entry without the common props of modules
  it did not load.

## Light and optics (module `optics`, 2026-10-19)
Files: `machines/mod_optics.py` (catalog) = `web/sim/modules/optics.js` (its exact port, and its AI plug-ins), `tooling/src/sim/optics.ts` (the ray tracer:
pure, no imports), `tooling/src/sim/modules/optics.ts` (the engine process "optics"), `web/sim/optics.js` (the tracer as plain JavaScript, GENERATED by
`tools/build-optics.mjs`, which `npm run build:engine` runs; `--check` verifies it), `web/models/mod-optics.js` (3D models, frame hooks and the view
plug-in that draws the light). Unit tests `research/optics-unit.test.ts` (`node --test research/optics-unit.test.ts`), AI plug-in tests
`web/ai/test/optics-plugin.test.mjs`, validation `research/rw-validate-optics.ts` (`node --no-warnings --import ./tools/engine-math-node.mjs
research/rw-validate-optics.ts [snell|fresnel|mirror|tir|prism|lens|image|inverse|shadow|materials|seeing|sun|heat|filter|energy|perf|determinism|fuzz|liquids|lamps|colour|blink|fuzzx|all]`).
- **2026-10-20 additions** (nothing changes for a scene without them: a scene without any light or optics item still gets no optics record, and a light
  scene without liquids, circuit lamps, coloured or blinking torches builds the same document):
  - **Liquids bend light.** Every layer of the liquids module's containers (`liquid` records: water-tank, beaker, graduated-cylinder, measuring-jug,
    density-column) is a body `{solid: <container>/floor, item, role: "glass", medium, nd?, liquid: <rank, 1 at the bottom>, prims (a slab from wall
    to wall, in the floor solid's frame), half, level: {item, top: "level_mm" | "layer<i>_mm", bottom?: "layer<i−1>_mm", floor (the inner floor, own
    frame), up}}`: its top follows the liquids module's live level reading (`withLevels`: what is dropped in raises it; the engine traces again when a
    surface moves 0.05 mm; the view and the digest read the track). Media: water (nD 1.333, CRC), "salt water" (its own `nd` = 1.33299 + 0.001757 ×
    salt %: 1.3394 at 3.5 % [Quan & Fry], 1.3787 saturated), "sea water" 1.3394, "vegetable oil" 1.4735 (Codex 210), "corn syrup" ≈ 1.49, honey 1.491
    (Chataway), "dish soap" ≈ 1.37, "rubbing alcohol" ≈ 1.372 (approximate ones marked provisional), each with water's dispersion shifted to its nD and
    its own absorption per band; a liquid not listed refracts as water. A liquid reaches 10 µm (`LIQUID_OVER`) into its walls, its floor and the layer
    above, and the tracer's medium is the innermost SOLID dielectric (else the liquid of the highest rank) among those a ray is in, so light goes from
    a glass wall straight into the water (n·sin θ kept), stops on an opaque floor, and goes oil → water at their interface. A laser into an aquarium
    at 45°: 32.04° in the water; a coin hidden by an opaque jug's rim shows to an eye once the jug holds 500 mL (`sees`); a pencil's tip under water is
    seen displaced (looks broken). The glass-block's `glass` also takes `water` (a block of water). Flow-module basins (cups and jars a tap fills)
    are not media yet.
  - **Circuit bulbs and LEDs are light sources** (the circuits module's `bulb` and `led`, from its `circuit` record's parts and their `<item>/glow`
    terminals): `{id: <item>/glow-light, kind: "lamp", dir: up, drive: {item, key: "light", scale: 1}}` with a bulb a bare bulb lighting all round
    (`spread` π, `out` π/2, 8.4 lm/W of its rating and 77 % of it as infrared, provisional) and an LED a 30° cone up (red 0.5, yellow 0.5, green 1.5,
    blue 0.4, white 4 lm at 20 mA, one-colour LED spectra, provisional); their light is their `light` reading × that (a bulb on 2 cells reads 11.6 ×
    the lux of one on 1 cell on a meter: its light ratio), they cast shadows, and a bulb's thin glass globe passes its own light (it is left out of the
    bodies). The circuits module's solar panel still keeps its own light estimate (sun, lamps and glowing bulbs, no mirrors or lenses):
    `opticsOf(scene).irradiance(panel solid, at, normal, width)` gives it the traced light whenever its owner reads it.
  - **Coloured and blinking torches.** The flashlight's `color` white | red | green | blue (one-colour LEDs: light kinds `led-red` 640 nm, `led-green`
    525, `led-blue` 465, `led-yellow` 590 (an LED's), FWHM 15-35 nm, Schubert); its `lumens` follows the colour until set (red 40, green 100, blue 10,
    white 150 lm: BT.2020's white balance, so red + green + blue make white and pairs make yellow, magenta, cyan). Its `pattern` (an open choice:
    steady, a word in Morse code (ITU-R M.1677-1), or 1s and 0s of one dot each), `dot_s` (0.2 s) and `repeat` give the source `blink: [on, off, on ...
    s]` (from `on_at`; repeated with 10 dots of dark), `dot` and `message` (what it sends, as read back). A light-sensor's or light-meter's `pulses`
    reading counts the flashes it sees (only in a run with a blinking source).
  - **Checked** (2026-10-20): the validator's new groups (liquids, lamps, colour, blink, fuzzx: 46 checks; 110 of 111 in all, `perf` still not on a
    loaded machine): 32.05° in water at 589.3 nm (32.037° ± 0.05), the app's red laser by Snell to 1e-7°, n·sin θ through a glass wall to 1e-9,
    saturated salt water 30.87°, oil then water 19.84° / 22.04°, the coin hidden empty and seen at 500 mL, a bulb's E = Φ·light/(4π d²) within 1 %
    and 1/d² 3.98 : 1, its shadow by the tangent lines within 0.1 %, colour mixes (white, yellow, magenta, cyan), coloured shadows, SOS read back with
    each flash within a frame. Python == JS: 200 random scenes with liquids, blinking torches and circuit lamps (documents, engine summaries,
    receives), `tools/parity/module.mjs --module optics` 741 checks; circuits and fluids parity unchanged (0 mismatches). 8 new demo scenes (an
    aquarium, a coin that shows as a tap fills a jug (seen at 3.65 s), a pencil in a beaker, red-green-blue shadows, Morse, 1 vs 2 cells, a circuit
    lamp's shadow, a block of water) and the 17 earlier ones meet every goal on the server and in the browser engine with identical tracks; the 22
    identity scenes are byte-identical (Python and JS, with and without modules). Real model (Opus 5.5) on the app: 3/3 builds ("a laser into an
    aquarium onto a target on its floor", "SOS by flashlight to a light sensor", "1 vs 2 batteries with meters over the bulbs") met their goals in
    one plan and one refine; 5/5 edits made exactly the asked change (blink HI, colour red, salt water 26 %, vegetable oil).
- **Items** (category "Light & optics"; all fixed on stands, `stand: "post"` so the view draws a retort stand under one in mid-air; every directional one
  points where its `aim` prop says, degrees: 0 = +x, 90 = up, 180 = −x, −90 = down, added to the item's own angle): `flashlight` (LED torch 15 cm × Ø 3 cm:
  `lumens` 20-1000 (150), `beam_angle` (label "Beam spread") 5-60° full (20), `on`, `on_at`), `laser-pointer` (`color` red 650 nm | green 532 | violet 405, `power_mw` (label "Brightness") 0.1-5 (1:
  class 2 ≤ 1 mW, IEC 60825-1), beam Ø 1.5 mm, 1 mrad), `sunlight` (parallel light from far away at `elevation` 5-90° from the side `comes_from` left |
  right, `irradiance` 50-1400 W/m² (1000: ASTM G173 AM1.5), in a band `width` 5 mm-12 m centred on its marker; its marker solid is hidden_3d, the view
  draws a glowing sun there; with the heat module loaded it also adds a heat record `{role: "sun"}`, so what it lights warms), `mirror` (back-silvered
  glass on a stand, `width` 5-60 cm, `reflectance` 0.5-0.99 (0.9); ONE shiny face, along `aim`, default 180), `curved-mirror` (`curve` concave | convex,
  `focal_length` 0.05-1 m (R = 2f), `diameter`), `convex-lens` / `concave-lens` (`focal_length` (label "Focal distance": a label with "length" or "angle" or "power" in it would make the AI's
  change line say "longer", "tilted" or "faster") 3-50 cm, `diameter` 2-15 cm (at most 3(n − 1)f), `glass`
  crown (N-BK7 nd 1.5168) | flint (F2 1.62004) | acrylic (1.4917); two spherical faces from the thick-lens lensmaker's equation, edge 1.5 mm / centre 2 mm),
  `prism` (60°, `edge` 2-15 cm, `glass`), `glass-block` (`width` × `height`, 2 cm deep), `semicircle-block` (D-shaped, `radius`, flat face along `aim`),
  `color-filter` (a gel in a card frame: `color` red | orange | yellow | green | cyan | blue | violet | magenta: ≈ 0.85-0.9 in its band, 0.02 outside),
  `material-panel` (10 cm sample: `sample` clear glass | clear plastic (refract, two 4 % reflections) | frosted glass 0.8 | wax paper 0.5 | tissue paper 0.4
  (translucent: the share that goes on, scattered over ±0.6-1 rad) | white card | cardboard | black cloth | wood (opaque) | aluminium foil (mirror 0.8,
  both faces)), `screen` (white card on a stand, `height`, `width`, `color`; both faces catch light), `light-meter` (a lux meter: a 1 cm × 1 cm sensor
  window on the face its `aim` points to (default 180), the rest its housing; `threshold` lx for its `lit` reading), `light-sensor` (a round target board
  that registers light on either face), `eye` (an eyeball Ø 2.4 cm looking along `aim`, `fov` 20-180°), `lit-arrow` (a light box whose arrow is the
  object for lens images: 5 points from its bottom to its top each send `lumens`/5 over ±`spread` along `aim`). The heat module's `lamp` shines as well
  (its `heat` record of role "lamp": a round cone of `spread`, its beam power split by bulb: incandescent 10 of every 82 radiated W visible (IES),
  halogen 0.15, LED all visible). Optics materials: "optical glass" (2510 kg/m³; flint 3610, acrylic 1190 as densities), "mirror glass", "ABS
  housing", "card"; looks mirror, lens glass, dark plastic, white card, gel, sun.
- **Document**: the build hook gathers everything into ONE process record (only when the scene has a light or optics item: every other document is
  unchanged) `{kind: "optics", id: "optics", sources: [...], bodies: [...], names: [[item, name]]}`. A source: `{id, item, solid ("" = the world), kind
  laser | flashlight | lamp | sun | object, x, y (its solid's frame), dir (rad, or a direction {x, y}), spread (in-plane half-angle), out (out-of-plane
  half-angle), round?, size (emitter half-size m), blur (angular radius rad), rays, light (white | sun | incandescent | halogen | led) with lumens | watts
  | irradiance, or nm + mw (a laser), back? (m: sunlight starts that far up-sun), on?: false, on_at?, off_at?, drive?: {item, key, scale}}` (its level
  follows another module's reading). A body (every solid the light can meet, in document order; hidden_3d solids are left out; a solid may have several:
  a meter's window, then its housing): `{solid, item, role opaque | glass | mirror | filter | translucent | sensor | panel | screen, ...}`: `prims`
  (an outline of its own, [kind, a, b, c, sph?]: "half" nx, ny, d | "disk" | "hole" cx, cy, r, in the solid's frame; else its body's), `faces` (prim
  indices that do its role's work; the others are opaque), `medium` ("crown glass" | "flint glass" | acrylic | PET | water | ice), `color` + `look`
  (an opaque surface's absorptance per band from its colour, below), `reflect` / `pass` / `eff` (per band), `transmit` + `blur` (translucent), `half` (its
  half-depth out of the plane), `aperture` [cx, cy, ax, ay, r] (a round lens or mirror), `threshold`, `target`, `eye` (half field of view) + `pupil` +
  `look`, `aim` (a flat mirror's). Other catalogs' things: glass, PET, the glass marble → glass; ice → ice; tissue paper → translucent; everything else
  opaque.
- **Physics** (`tooling/src/sim/optics.ts`): a deterministic 2D ray tracer in the machine plane. Each source sends a fan of rays (laser: one; flashlight
  96, lamp 180, sun 240, a lit object's point 48), each carrying 8 bands (violet 380-450, blue 450-495, cyan 495-520, green 520-565, yellow 565-590,
  orange 590-625, red 625-750 nm, near infrared 750-2500 nm) in W. Between neighbouring rays whose paths part ways (one meets a thing the other misses)
  more rays are added, halving the gap up to 8 times (to 0.2 mrad / 0.2 mm); a sensor's or panel's window gets 9 rays aimed straight across it, so a
  small one is never missed. Bodies are intersections of half-planes, discs and holes (exact segment / circle crossings). At a crossing: opaque →
  absorbed by band (absorptance from its colour: each band's reflectance from the linear-light channel it shows, the infrared's from the luminance,
  kept within 0.05-0.97: white paint ≈ 0.16-0.25, black 0.97, Incropera A.12; metals 0.3 visible, 0.1 infrared), the rest scattered (Lambertian:
  light meters facing a lit surface see it as (P/π)·cos θ_p·A·cos θ_s/r², line of sight checked); mirror face → specular reflection, reflectance per band
  (Hecht §4.3); glass → Snell's law and the unpolarised Fresnel split (reflected rays followed for beams: lasers and sunlight; a fan's 4 % reflections are
  not), total internal reflection past the critical angle, white light split into its bands at the first refracting surface (indices: N-BK7 and F2
  Sellmeier, SCHOTT; water Cauchy through CRC's nC and nF; acrylic, PET, ice provisional fits), absorption inside by Beer-Lambert per band (water and ice
  40 /m in the infrared band, Hale & Querry; glass 0.2-0.5 /m); filter → its transmittance; translucent → its share goes on as 5 rays over ±blur, each a
  new wide source. Out of the plane each ray is a tube followed paraxially (a point source's cos-weighted spread, a beam's height, the source's own size
  in quadrature; a round lens or mirror cuts and focuses it with Coddington's sagittal equation): a thing of depth D catches the part of the tube
  within |z| < D/2, so a small target's light falls as 1/d² (Hecht §3.3) and a magnifying glass concentrates sunlight. Limits: ≤ 48 segments a
  branch, branches under 0.2 % of their ray's power dropped, ≤ 4096 rays a source, ≤ 120 000 segments. Light is 2D: what passes beside a thing out of
  the plane is not followed; a point source makes sharp shadows (no penumbra in the plane). A white beam is split into its 8 bands at the first refracting surface (a flat
  panel too: its bands leave parallel, a hair apart).
  Determinism: only + − × ÷, Math.sqrt and the file's own sin, cos, exp, ln, atan2 (series after exact reduction): the same bits in node, every
  browser and the 3D view (`web/sim/optics.js`: its build refuses Math.sin … pow in the source).
- **Engine** (`tooling/src/sim/modules/optics.ts`): traced at the start and again whenever a body or source housing moved ≥ 0.5 mm or turned ≥ 0.05°,
  was resized by another module (an ice cube melting), or a source's level changed (switched, or `drive`n), at most every 4th step (120 Hz). Nothing is
  pushed: the bodies' motion is unchanged. Readings: a source item's `on`; `light_w` (W absorbed, all bands) on every item light has reached; a
  light-meter's `lux`, `wm2`, `lit`; a light-sensor's `hit`, `mw`; a screen's `shadow_cm` (the unlit length between lit stretches on its face), `lit_pct`,
  `colors` and `spread_mm` (bands of split light on it; violet's middle to red's), `image_cm` (a lit object's image: signed, negative = upside down, from
  the light a lens or mirror made) and `blur_mm`; an eye's `sees` (items seen now); a flat mirror's `beam_in_deg` (the strongest beam on its silvered
  face) and `aim_for:<item>` (the aim that would send it at that item's middle). Events: "light" [source, item] the first time a source's light reaches
  an item (≥ 1e-9 W and 1e-6 of the source), "shadow" [occluder, screen] (light it stops would have landed on the screen first), "sees" [eye, item] (rays
  from its pupil over its field, through glass and off mirrors, end on a thing that scatters ≥ 1e-4 lm, or a source's light lands on it), "tir" [item].
  For other modules: `opticsOf(scene)` → `{absorbed(solid) W, irradiance(solid, at, normal, width) W/m², result()}` (the heat module's lamp heating and the
  circuits module's solar panels can read the traced light from it; today both keep their own simpler estimates, which agree for an unobstructed beam).
- **Goal kinds** (`machines/mod_optics.py` == `web/sim/modules/optics.js` == the AI's checks): `hits_target {light, target, before_s?}` ("light"
  event), `lit {item, at_least_lux?}` (a meter's lux at the end ≥ the value, default 1 lx; a target: mW > 0; else light_w > 0), `dark {item,
  at_most_lux?}`, `shadow_on {occluder, screen}`, `sees {eye, item}`, `brighter {a, b}` (lux, else mW, else light taken in), `focused {screen}`
  (|image| > 0.5 mm and blur ≤ max(2 mm, a tenth of it)), `rainbow {screen}` (≥ 6 bands, violet and red ≥ 2 mm apart), `receives {sensor, light,
  message?}` (the sensor's `hit` (a target) or `lit` (a meter) record cut into runs and read in the light's dot length: on < 2 dots a dot, else a
  dash; off < 2 between signs, < 5 between letters, < 9 between words, longer the message's end; its first message equals the light's `message`
  (or `message` given); entry `sent`, `got`). A meter's number: measure's
  `reads {item, value, tol}` (its first readout is lux; a screen's is shadow_cm).
- **View** (`web/models/mod-optics.js`): models for every item (an anodised torch with a glowing LED behind its lens, a brushed laser pen whose aperture
  glows its colour, chrome-faced mirrors, lenses with their true spherical faces in glass, prisms and blocks in glass, gels in card frames, the sample
  panels in their materials, a lux meter with an LCD showing its reading (frame hook `optics:lcd`), a bullseye target whose middle glows when hit
  (`optics:hit`), an eyeball looking along its aim, a lit arrow). The plug-in `optics:light` traces the light at every drawn moment (only again when
  something moved or a source switched: `stateAt(item, "on")`, or the record's switch times in a layout preview) and draws: a soft haze between
  neighbouring rays (split light whose bands stay together, through a panel, a block or a lens, drawn as the one white beam it looks
  like; a ray leaving the scene drawn 50 m along its own direction; additive, its strength ∝ (E / E at 30 cm)^0.7, coloured by the bands: white light white, split light its colours), each laser as a
  saturated core line and an additive halo, pools of light where reflected, bent or filtered light lands, and three.js lights for the room's shading
  (a spot light per flashlight and lamp, a directional light for the sun; two cast shadows).
- **AI**: `plugin.howto` (the aim convention, stands, how each thing treats light, what each instrument reads), prompt lines for plan / edit / refine,
  15 worked examples (ask + recipe, one per lesson demo), the 8 goal kinds with aliases and samples, 21 knobs for the make-it-work search (aim of every
  light, mirror, lens, prism, block, meter, eye; lumens, beam_angle, power_mw, focal_length, a target's size, a screen's height, the sun's elevation and
  irradiance; never a compared material or colour), the edit digest's lines (what each light reaches; a mirror's arriving beam and the aims that steer
  it to each receiver; a meter's lux; a screen's shadow, image and colours; what an eye sees; light taken in; with the whole run at hand, each beam's path
  in words), and change words ("turned 10° anticlockwise (aim 150° → 160°): the reflected beam turns 20°", "brightness 150 → 500 lm", "beam 20° → 40°
  wide", "focal length 10 cm → 15 cm", "the sun 45° → 60° high"). 2026-10-20: the how-to and prompts say liquids bend light, circuit lamps shine,
  torches mix colours and send Morse; 6 more examples (a laser into an aquarium, the coin, the bent pencil, coloured shadows, Morse, a bulb on 1 vs 2
  cells); goal `receives` (aliases morse, decodes, reads_message ...); knobs `dot_s` (blink faster: a message the run is too short for), a
  measuring-jug's and a beaker's `fill_ml` (more water: the coin appears); digest lines: a container's "its liquid bends light: water n 1.333", a
  sensor's "it saw 9 flashes from Torch: read back as Morse "SOS"", a screen's "the light on it looks yellow" (CIE 1931 colour of its bands: white
  near the Planckian locus, else its hue), a circuit lamp's reach; change words for pattern, dot_s, repeat, a block's glass. The view draws the
  liquids' surfaces where the track has them, a coloured torch's LED and spot light in its colour, a circuit bulb as a point light as bright as its
  circuit drives it.
- **Checked**: research/rw-validate-optics.ts all groups pass (`perf` too since 2026-10-20, below) (Snell into water 32.03° and BK7 27.79° at 589 nm to 0.05°,
  n·sin θ to 1e-16; Fresnel 4.21 %; a glass panel 92.5 % (91.8 % expected) in the app; angle out = angle in to 1e-15 rad; critical angle 41.26°, TIR
  flips between 40.96° and 41.56°; prism minimum deviation C 38.39°, F 39.10°, spread 0.71°; lens focus at the thick-lens back focal length to 1 mm; image
  −1.00 cm of a 2 cm arrow at 15 cm, sharp, blurred at 25 cm; inverse square 3.98 : 1, a 150 lm 20° torch's I/d² within 3 %, the lamp's I/d² within 3 %;
  shadow 15.02 and 7.51 cm; materials; seeing (lit, dark, hidden); sunlight 969 W/m², 105 klx, × sin 30°; black cloth 0.97, white card 0.18; red filter 0.88
  / 0.02; energy kept to 1e-12 at a surface, within 1 % over 200 random paths (dropped branches); the view's tracer = the engine's bit for bit; 120 random
  scenes: no exceptions or non-finite readings). Python == JS over 150 random layout scenes and 80 more with engine tracks and summaries, every
  module loaded; 17 demo scenes (engine4 scratch `optics/scenes/demo-*.json`) meet every goal on the server and in the browser engine with identical tracks;
  the 22 identity scenes are byte-identical. Speed: the spec's scene (3 torches × 256 rays, 50 solids) costs 0.7-1.1 ms of this thread's CPU a
  warm trace (2026-10-20; 1.1-1.5 ms before an opaque hit's three spectra became arrays of their own instead of views of one 24-number store,
  the same numbers), so `perf` passes its 2 ms (CI 5 ms). It measures as a running scene traces: warm (after 40 traces: the first 20 of a fresh
  process cost about twice as much), the thread's own CPU time (`process.threadCpuUsage`: wall time on this machine at a load average of 100 was
  13-38 ms), the fastest of 15 batches of 20. A lesson's scene (2-10 things) is 0.2-0.6 ms, and nothing is traced again until something moves or
  switches. Build and Edit with AI on the app with the real model (Opus 5.5): 3 lesson builds (a laser off a
  mirror onto a target; a ball's shadow on a screen; glass vs cardboard in front of two meters) met their goals in 2 runs each, 6/6; 3 edits (a mirror
  turned 10°, a card moved 20 cm, a torch dimmed to 50 lm) made exactly the asked change and said honestly that a goal now fails, every time; the
  checked fix (lower the target 20 cm; move the screen 60 cm; narrow the beam 20° → 14°) was found 8 times in 9 over three runs (the miss: the
  search's 12 s budget ran out after 107 tries at a load average of 130).

## Air and gases (module `air`, 2026-10-19): balloons, hot air, smoke, wind, air pressure, flight
Files: `machines/mod_air.py` (catalog, goal kinds, build hook), its exact port `web/sim/modules/air.js` (+ the AI plug-ins), the engine's process kind
`air` in `tooling/src/sim/modules/air.ts` with the physics in `tooling/src/sim/air.ts` (unit tests `tooling/src/sim/air.test.ts`), 3D models and view hooks in
`web/models/mod-air.js`, the validator `research/rw-validate-air.ts`, the AI tests `web/ai/test/air-plugin.test.mjs`. A scene without air items builds and
runs exactly as before (no `air` record: nothing of this module runs). Wind comes from the catalog's fans and the liquids module's breeze (the engine's air
streams, `ctx.air(p)`); settings `{air: false}` is a vacuum for every air item (balloons burst, cards fall, cups let go, smoke stops, planes and kites drop).

Items (category Air; anchors as listed; every number below is the default):
- `party-balloon` (its middle): `gas` air|helium, `fill_l` 8 L put in (measured at 20 °C, 1 atm), `size` 0.28 m rated diameter (an 11-inch balloon), `tied`
  (false: its air jets out of its neck, its own −y, and it flies the other way), `pump_lps` (a hand pump in its neck from t = 0: it grows until it pops),
  `prick_at` (s; −1 never), `string_m` + `weight_g` (a string down to a weight; 0 g: a fixed hook), `color`. Built as a hollow ball at the radius where
  (P_out + Δp(r/r₀))·V = nRT (64 halvings, the same in both languages), its wall the rubber spread thin (t₀/λ²).
- `hot-air-balloon` (its launch stand's base): `size` 0.9 m envelope of `envelope` tissue paper (17 g/m² + 15 % seams) or plastic bag (11 g/m²), a mouth ring
  (3 g + `payload_g`) resting on two wire posts over a heat gun (`heater_w` 1500 W, off at `heater_off_s`), the air inside `start_c` 65 °C at the start,
  `tether_m` (a thread from its ring to the stand), `color` stripes. Envelope + ring are one weld group.
- `incense-stick` (its holder's bottom; the tip 23.2 cm up): `amount` light|normal|thick (6/10/12 puffs a second lasting 4.0/4.8/5.3 s, at most 48), `lit_at`.
- `anemometer` (its foot): cups `height` 0.4 m up.
- `wind-tunnel` (the middle of its floor's top): a `length` 1.2 m duct, `height` 0.3 m inside (a wooden floor, a clear top; the front and back panes are
  drawn only), its fan box at the upwind end blowing `speed` 5 m/s `blows` to the right from `on_at`: an `airflow` record (the engine's round jet, 2 × the
  duct's height across: within 16 % of `speed` at its walls, full speed for 12 duct heights). A container for the solver (x −L/2 … L/2, floor 0, rim H).
- `vacuum-jar` (its plate's bottom): inside `width` 0.3 × `height` 0.35 m (static glass walls and top), the pump from `pump_at` 0.5 s with time constant
  `pump_s` 2 s down to `lowest_kpa` 2 kPa; `vent_at` lets the air back in (τ 0.4 s). A container for the solver (`place.interior`: x0 −W/2 … W/2, floor 0.02,
  rim 0.02 + H); things in it with place {inside: <jar>}.
- `card-glass` (its stand's base): an upside-down `diameter` 7 × `height` 12 cm glass held by a clamp, its mouth `stand_height` 0.3 m up, `water` 0.8 full,
  a `card` (index card 2 g, playing card, cardboard 6 g, plastic lid) under it (dynamic, 1.5 mm in the physics).
- `suction-cup` (its stand's base): a `diameter` 5 cm cup under a sheet of `surface` glass|glazed tile|painted wall|wood `height` 0.6 m up, a `load_kg` 1 kg
  weight (+ a 50 g hanger) hanging 12 cm under it — cup and weight one rigid body (the string drawn by the cup's model).
- `steam-can` (its stove's foot): a 355 mL can (30 g with its water) on a camping stove, `boil_s` 30 s of boiling before the run, a dish of `bath_c` 2 °C
  water `gap` 0.35 m to the right; at `dip_at` 1 s tongs carry it over (1.3 s: lift, carry turning it mouth-down, push 3 cm under) and hold it there.
- `paper-airplane` (its balance point): `design` dart (A4, span 13 cm, wing 164 cm², aspect ratio 1.03) | glider (22 cm, 280 cm², 1.73) | balsa glider (8 g,
  30 × 5 cm wing aspect ratio 6, tail 3.4), thrown at the release at `launch_speed` 5 m/s and `launch_angle` 5° (its pitch too; the item's own angle is
  not used) toward `facing`, `elevator` 5° (tail flaps up), `nose_clips` (0.5 g each), `paper_gsm` 80. The body is its keel's side outline, 4-6 mm deep
  (its mass from the sheet), plus a welded clip part; the wings act through the process (they are drawn spanning z beyond the body's depth).
- `kite` (the foot of its stake): a `size` 0.7 m diamond (85 % as wide, about 25 g), its spine a thin polygon (8 mm deep) starting on its `line_m` 1.5 m
  line at 50° downwind toward `toward` (right), nose upwind 30° above the wind; a rope joint from its `bridle` point (0.3 of its height from the nose) to the
  stake; `tail_m` 1 m (a 3 cm ribbon, drag only).

Engine (`air` records, one process each by `role`; deterministic: + − × ÷, sqrt and the engine's exp/pow/atan2/sin/cos; smoke jitter from a 32-bit
xorshift seeded by the item id; checked by `airProblem` on admission):
- balloon: every step n (mol) gives its radius from the gas law against the pressure outside (the room's 101.325 kPa, a jar's, or 0 in a vacuum) and the
  rubber's Δp = 3.0 kPa·S(λ)/S(6), S(λ) = (1/λ − 1/λ⁷)(1 + λ²/10) (Merritt & Weinhaus's Mooney-Rivlin sphere); its body is resized (when it changes by
  0.2 %) and its planck mass set to rubber + gas + ½ρV, so the engine's own air lift (ρ·g·V) gives exactly ρ_air·V − rubber − gas: helium rises, air sinks.
  It pops (resized to nothing, event "… popped (why)") past stretch 7.8 (1.3 × its rated diameter), when pricked, or in a vacuum. Untied: ṁ = 0.62·A·ρ·v,
  v = √(2Δp/ρ), thrust 2·0.62·Δp·A along its own +y, n falls by ṁ/M. Pumped: n grows by `pump` mol/s and its neck is kept on the nozzle (its body placed
  there each step). Leak (slow time, time-lapsed): helium e^(−t/14.4 h), air e^(−t/10 days). Readings diameter_cm, pressure_kpa, volume_l, lift_g,
  thrust_n, popped.
- hotair: T_in steps as (P_heat − U·A·(T_in − T_room))/(ρ_in·V·c_p), U 3.5 W/(m²·K), c_p 1007, P_heat = power × 0.6 × (1 − d/0.6 m) × (1 − |dx|/(mouth +
  5 cm)) while the mouth is within reach of the gun's nozzle; the weld group's planck mass is lightened by (1.2 − ρ_in)·V (ρ_in = 1.2·T_room/T_in) with
  its centre of mass moved accordingly (I about the envelope's middle kept), and woken. Readings inside_c, lift_n, net_g, heating_w, height_m.
- glider and kite: each surface {lx, ly (leading edge in the body frame), ang (chord direction), c, S, AR, cd0} meets the air (its velocity at the point,
  ω × r included, minus `air(p)`) with C_N(α) = a·sin α·|cos α|·fade(α) + 1.2·sin α·|sin α| (Helmbold's a = 2πAR/(2 + √(AR² + 4)); fade: past the stall
  angle, 15° at AR ≥ 3 … 35° at AR ≤ 1, to nothing over 20°) along its normal, at its centre of pressure (0.25 + 0.25|sin α| of the chord from the edge the
  air meets), plus skin friction ½ρu²·S·cd0. A glider is set moving at `launch` at the release, lands at its first touch of another item (event, its
  horizontal distance kept): readings distance_m, speed_ms, height_m, flying, aoa_deg. A kite's tail: ½ρ·0.1·area·|u|·u at its trailing end. Readings
  height_m, line_angle_deg, pull_n (|air force + weight|, a steady estimate), wind_ms, flying.
- smoke: up to 48 particles born at `rate` a second, recycled every `life` s, moved at 120 Hz by the air there + its own plume (Morton-Taylor-Turner
  w = 3.4·F^(1/3)·z^(−1/3), F = g·1.5 W/(ρ·c_p·T), Gaussian across a half-width 0.12z + 2 cm) + the plumes over items with a `temp`/`water_temp` reading
  (whichever of the two is farther from the room's; heat from 5 W/(m²·K) × their width × 0.1 m × ΔT; cold ones sink) and over the hot-air balloons' heat guns (1.5 m/s) + a random walk (K = 0.0005 + 0.01·|wind|
  m²/s). `track.series[item].smoke` = [x, y, age, …] (3, 3 and 2 decimals); readings drift_m, rise_m, puffs. No air: none.
- anemometer: wind_ms = |air(cups)|; turns = ∫ wind/(3·0.06 m)/2π dt (a third of the wind's speed).
- jar: pressure_kpa = P_low + (P_room − P_low)·e^(−(t − pump_at)/τ); after vent_at it returns as 1 − e^(−t/0.4 s). The build hook gives every balloon, card
  and cup record `jars` (the insides, world); each takes its outside pressure from the jar holding its point.
- card: a planck WeldJoint (made at the start through EngineInternals) holds the card to the glass; after each (sub-)step its reaction along the glass's
  axis (smoothed over 0.1 s) gives the pull; the hold breaks (the weld destroyed, event, `water` drains in 0.4 s) when there is no water to seal, when
  P_out ≤ Δ = ρ_w·g·h + pull/A, or when the trapped air would stretch past the 2 mm water seal: (V_air/A)·Δ/(P_out − Δ) > 2 mm. Readings holding, push_n
  (P_out·A), inside_kpa, outside_kpa, water.
- cup: the same weld to its sheet; it lets go when the pull passes Δp·(P_out/P_room)·A (Δp 35/30/10/0 kPa on glass/tile/paint/wood). Readings holding,
  hold_n, pull_n.
- can: on the stove the inside is 100 °C with x_air = max(3 %, e^(−boil_s/8 s)) of the air left (boil_s 0: room air only); the tongs place it each step on
  their path from `dip`; mouth-down in the water (over the dish, after the turn) T_in → bath with τ 0.15 s (in air 30 s). P_in = x_air·P·T/373.15 K + min((1 −
  x_air)·P, P_sat(T)) (Buck), the unheated one P·T/T_room; once P − P_in passes the wall's buckling pressure (Windenburg & Trilling, 69 GPa, ν 0.33, 0.097 mm,
  Ø 66 mm, 115 mm: 8.74 kPa) it folds in to keep max(30 %, p_air/(P − p_steam − p_cr/2)) of its volume (event). Readings crushed (0-0.7), inside_kpa,
  temp_c, steaming, tongs.

Goal kinds (Python == JavaScript, the AI's checks through `plugin.goals`): `pops {item, before_s?, expect?}`, `lifts_off {item, at_least_m? (0.2), expect?}`
(any item's moving parts rise that much at some time: going up in air; mechanics' `rises` is a machine lifting its load), `crushes {item, before_s?,
expect?}` (crushed ≥ 0.05), `stays_held {item}` (holding = 1 at the end; magnetism's `holds` is for magnets), `lets_go {item, before_s?}`, `glides {item,
at_least_m? (1)}` (distance_m at the end), `kite_flies {item, at_least_m? (0.5), expect?}` (the lowest height_m over the last 30 % of the run),
`wind_reads {item, at_least?, at_most?}`, `smoke_drifts {item, toward?: left|right|up|down}` (right/left: |drift| ≥ 5 cm; up: rise ≥ 10 cm and more than
the drift; down: rise ≤ −3 cm). `expect: false` asks for the opposite (a fair test's control: "the unheated can is not crushed"). Each has aliases
(`balloon_rises`, `card_falls`, `can_crushes`, …), a label, `about` text and a fuzz `sample`.

AI plug-ins (`plugin` in web/sim/modules/air.js): `howto` (every item, its anchor and how to place it, the numbers that decide outcomes, which wind to add),
`prompt.plan|edit|refine`, six worked `examples` {ask, how, plan} (each solved by web/ai/solver.js and met in the engine bundle: the AI tests), 28 knobs
(fill, gas, weight, size, pump of a balloon; heat gun, start temperature, size, payload, envelope of the hot-air balloon; throw speed and angle, tail flaps,
clips, design of a plane; line, bridle, tail of a kite; load, diameter, surface of a cup; water of the card glass; boiling and bath of the can; the jar's pump;
the anemometer's height, the wind tunnel's speed) with honest `why` and `more`/`less` words, the vacuum jar's and the wind tunnel's `place.interior`, edit-digest lines for every air item (sizes,
pressures, lift, what popped / fell / let go / was crushed and when, "NO wind reaches it"), `words.change` in real units ("gas in it 8 → 12 L", "cup 5 cm
→ 8 cm across (holds 69 → 176 N on glass)") and `words.keys` (the words that name a setting the person chose, so a fix never undoes it).

View (`web/models/mod-air.js`): latex balloons (foil when silver) drawn wholly inside their ball (an inverted teardrop, its knot's bottom at the ball's bottom,
so it never sinks into what it rests on; no knot when untied, and on a pump its neck sleeved over the nozzle), hidden when popped while the `air:pops` plugin throws nine shreds; a gored
tissue envelope that glows with its warmth (`inside_c`), the heat gun's nozzle glowing while it heats; incense stick with an ember and the `air:smoke`
plugin's puffs (sprites growing and fading with age at the engine's particles); anemometer cups turning with `turns` and a m/s label (`air:readouts`, also
the jar's kPa); the bell jar drawn from its top part with a gauge needle on `pressure_kpa`; the tumbler and its water (`water` drains it); the cup, its
string and slotted masses; the can in four crush stages chosen by `crushed`, steam while `steaming`, the stove's flame, the glass dish with water and ice,
and the `air:tongs` plugin's tongs from above while `tongs`; folded paper darts and gliders (keel + two wings with dihedral) and a balsa glider; a diamond
kite with spars inside its 8 mm plank, its sail drawn rolled 35° about its spine so its face shows (the physics stays in the plane), and the `air:kites`
plugin, which lowers that roll as the kite nears what is under it (flat as it lies there) and draws its tail of bows from its trailing end: a ribbon
of 1.4 g/m lying straight along its weight plus the drag ½ρ·0.1·0.03·|u|·u of the air past it (the wind at the kite toward its downwind side, less the
end's velocity), along the top of whatever static thing it meets and hanging over its edges to the room's floor; a wind tunnel's fan box
with a grille, turning blades and a honeycomb, its clear duct. Planes are seen edge-on from the side, as a side view shows them.

Checked (2026-10-19): `research/rw-validate-air.ts all` 82 of 82 (gas law and Charles to 1e-4, helium lift to 1 mg and its rise speed to 0.1 %, an air
balloon's sinking against m·dv/dt = F − ½ρC_dAv² to 0.1 %, popping at stretch 7.8 to 6 ms, jet thrust 2C_cΔpA to 0.01 %, lift-off temperature 58.2 °C
(3 °C under: stays; 6 over: rises), skin cooling to 0.002 °C, jar pressure to 1e-4 kPa and Boyle in it to 0.002 %, the card's P·A and its fall in a jar at
11.14 kPa against 11.15 predicted, a cup holding 6.9 kg and losing 7.1 kg (Δp·A 68.72 N), the can's inside 2.947 kPa and its control 95.10 kPa, Buck vs
IAPWS within 0.2 %, each plane's long glide within 3.5 % of its trimmed polar, a kite at 64° on its line with pull ∝ v², the fan jet read to 0.01 m/s, smoke
rising 0.35 m in still air and drifting 2.3 m in a 1 m/s breeze, beside a pan of 95 °C water (the heat module's) climbing 1.02 m against 0.39 m, the wind
tunnel's stream read to 0.01 m/s, the same track twice, 150 random scenes with no exception or NaN); `node --test
tooling/src/sim/air.test.ts` 10 of 10; `node --test web/ai/test/air-plugin.test.mjs` 8 of 8 (registry, field checks, the six examples met, Python ==
JavaScript summaries, digest lines, change words, two make-it-work fixes found through the module's knobs); 18 demo scenes (engine4/air/scenes): both
engines byte-identical, Python == JavaScript, every goal met; air parity fuzz (random scenes of air items, every prop, settings, the module's goals:
documents, resolved, warnings, summaries, engine runs, no NaN) 920 scenes with 0 problems; `tools/parity-engine.mjs --catalog`: every air item
identical in node and Chromium; the 22 regression scenes byte-identical. AI acceptance on a server of this checkout with Claude Opus 5.5: 5 of 5 plain
lesson requests built from air items with every goal met (helium vs air balloon, hot air rises, the card trick with an empty-glass control, a kite in a
breeze, the can crush with an unheated control; plan + refine, 26-49 s each) and 3 of 3 edits exact with honest cards ("gas in it 8 → 15 L"; "weight on it
1 → 9 kg", which broke the hold, then the checked fix found by the module's knob "cup 5 cm → 6 cm across (holds 69 → 99 N on glass)", applied, goal met;
"thrown at 5 → 7 m/s").
Re-checked 2026-10-20 on the tree as it then was (every module loaded): validator 82 of 82, core tests 10 of 10, AI plug-in tests 8 of 8, the 18 demos as above,
air fuzz 200 more scenes with 0 problems, `parity-engine --catalog` all identical, the 22 regression scenes byte-identical, AI acceptance again 5 of 5 builds
and 3 of 3 edits. The hot-air balloon's `start_c` knob (steps 5, 10, 20, 30 °C at cost 0.1 per °C) is tried before its envelope: in a short run a heat gun
warms the air only about 1.5 °C a second, so the start temperature is the honest fix (a balloon at 45 °C on a 400 W gun: "start 45 → 65 °C", found in 19 runs).
Repairs after the 2026-10-20 review (these lines replace what the section above says where they differ):
- A jar's thin air is the engine's too. A new framework hook, `SolidHandle.setAirShare(share)` (tooling/src/sim/plugins.ts, optional; physics.ts's
  handles have it): the engine's buoyancy and drag on a part (and so a fan's stream's push on it) are scaled by its share of the room's air density
  (a `Map` per part, empty in a plain run: nothing else changes, the 22 scenes are byte-identical). Every `jar` record (the vacuum jar, the new vacuum
  tube, the waves module's bell jar) sets it each step to P_jar/P_room for every moving part whose pose is inside its box (back to 1 when it leaves). So
  a balloon in a jar pumped to 12.5 kPa (0.149 kg/m³) sinks and rests on the jar's floor, its `lift_g` = ρ_jar·V − rubber − gas (−0.63 g; it was +1.37 g and
  floated to the lid), its carried air ½ρ_jar·V; a feather and a coin in a jar or tube at 0.1 kPa fall together (2.871 / 2.873 s; free fall within 1 ms).
- `vacuum-tube` (anchor: its base's bottom): a 1.5 m × 30 cm (`length`, `width`) clear tube on a pump base, `pumped` (false: the control, the room's air),
  `pump_at` 0, `pump_s` 0.4 s, `lowest_kpa` 0.1, `vent_at`; a `jar` record (a container for the solver: x ±W/2, floor 0.03, rim 0.03 + L). The coin-and-
  feather demo: mechanics' craft feather and a coin (coin-flat) side by side near its top, not held (nothing moves before the scene's release; a held
  thing gets the view's pull-pin post, drawn inside the tube), the scene's release after the pump (2.5 s); goals `lands_together` / `lands_first` (space).
- Bursting in view: a balloon that would burst at the start (no air: settings `air: false` or an airless world; over-filled) is drawn as it was filled (the
  builder sizes it at the room's pressure), held so until the release, then swells to its bursting size over `SWELL_S` = 0.3 s and pops; a pin pricks
  it at `prick_at` or at the release if that is later. Every pop writes its event ("popped (no air pressed on it from outside)", "(over-filled: …)",
  "(a pin pricked it)", "(it touched hp at 253 °C: hot enough to melt latex)").
- Local heat (Charles): a balloon's gas has its own temperature (`gas_c` reading), starting at the room's and relaxing (slow time, so time-lapse
  speeds it) toward the air round it with τ = (m_gas·c_p + m_rubber·1900)/(5 W/(m²·K)·4πr²) (about 15 s for 8 L): the room's air, warmer in the MTT plume
  over any item with a `temp`/`water_temp` reading (ΔT = T·g'/g, g' = 8.67·F^(2/3)·z^(−5/3), top-hat α = 0.1; capped at the item's own ΔT; Gaussian
  across 0.12z + its half-width; cold things' air sinks under them), halfway to an item's temperature where it touches it. Its gas law uses that
  temperature (8 L over a 90 °C pan: 20 → 28.7 °C in 10 s, (P + Δp)·V ∝ T to 1e-4). Touching an item at 150 °C or more pops it (latex softens and tears
  from 120-180 °C: provisional).
- Airless worlds: when the scene has air items and its settings give `gravity` "moon" or "mars" (or 1.62 / 3.71 m/s²) without `air`, the build hook
  sets `air: false` (the Moon has none; Mars 0.6 kPa, 1.6 % of Earth's air's density): a helium balloon there bursts instead of floating. A scene that
  says `air: true` keeps its air.
- The waves module's bell jar: the build hook (when the scene has air items) adds an air `jar` record for it (`id` "<bell jar>/air-jar", its box between
  its glass sides over its plate, `linear` {from, to, t0, t1}: the bell jar's own straight-line pump-down), so a balloon in it swells by Boyle and pops.
  The other way, a waves sound source (`sound` record, role source, no `jar` yet) whose point is inside this module's vacuum jar or tube gets that
  module's jar law `jar` = {from 100, to 100·P_low/P_room %, t0 pump_at, t1 pump_at + 3·pump_s (the e^(−t/τ) as a straight line to 95 %), glass 20,
  base 55}: a speaker in a pumped vacuum jar fades to the quiet room's floor (46 → 35 dB at 1 m).
- Paper planes: a landed plane is braked (damping 25 /s on its body: it stops within about 15 cm, so where it lies is where it landed and a tape
  agrees); with two or more planes the build hook gives each glider record `pass` (the other planes' parts): their contacts are left out (`contact`
  "pre"/"begin"), so planes thrown side by side on one lane fly as each would alone (distances equal to 1e-9) and never land on each other. A plane still
  flying at the end is said ("… is still flying at the end, 14.67 m from where it was thrown").
- Events for the run's story (so describeRun never says "nothing moves"): smoke ("smoke from Incense stick drifts right 3.21 m and rises 0.04 m", "makes
  no smoke (no air to burn in)"), the wind meter ("reads 3.0 m/s", "reads no wind"), a card that stays up, a cup that holds (pull and hold in N), a can
  that is not crushed, a kite that flies or not, a hot-air balloon's lift-off and its height, a jar's pump-down, a balloon that swelled or shrank.
- Goal kinds (Python == JavaScript): `glides_farther {a, b, by_m?}` (a's distance_m ≥ b's + by_m (5 cm), b landed), `rises_faster {a, b}` (two incense
  sticks: the mean `rise_m` over the run's second half; else the moving parts' rise at the end; a ≥ b + max(5 cm, 20 % of b): two identical sticks
  differ by up to 3 cm), `jets {item, toward?, at_least_m? (0.5), expect?}` (an untied balloon's first moving part travels that far along `toward`, or
  sideways; its record must say tied false and its thrust must have been > 0), `swells` / `shrinks {item, at_least_x? (1.05), measure? volume|diameter}`
  (the last value before it popped over the first; shrinks: ≤ 1/x). Aliases: flies_farther, glides_further, smoke_rises_faster, balloon_rocket,
  shoots_off, grows, expands, inflates, gets_bigger, deflates, contracts, gets_smaller.
- AI: the plan text asks for comparison goals for comparisons and controls and for ONE changed setting in a fair test; the how-to says the boiled can is
  crushed in any bath up to about 95 °C (vapour 47 kPa at 80 °C, 70 at 90, 85 at 95 against the 92.6 kPa that buckles it), how to stage two planes on one
  floor lane from one height (they pass through each other), to start smoke-over-hot-water lessons with already hot water (a hot plate warms for
  minutes) and that ice water barely changes the smoke beside it, a balloon set on a jar's floor with place {inside: jar}, the vacuum tube; the edit text
  re-aims wind_reads / smoke_drifts / kite_flies goals when the wind changes and switches the wind off as it really goes off (a wind tunnel or a
  breeze at speed 0; the catalog's fan has no off switch, its slowest is 0.5 m/s, so a fan off for the whole run gets its on_at after the run's end
  and the goals say no wind); the refine text never fixes a comparison by changing one of its two items. Goal aims (tried first by the make-it-work
  search): `pops` on a party balloon that did not pop: the gas that bursts it at the lowest pressure round it in the run (a jar's lowest reading, or the
  room's), 10 % and 25 % more, in litres, with the balloon set up by as much as it grew so it rests where it rested ("blow more air into the small
  balloon (0.3 L → 1.4 L) and raise it 2.7 cm", found in 1-5 runs for a jar pumped only to 60 kPa); `swells` in a vacuum jar: the jar pumped down to the
  pressure that gives at_least_x (Boyle) with 10 % to spare. `words.keys` "party-balloon.tied" (tie, untie, knot, neck): a fix never unties a balloon the
  person asked to tie. The alias `stays_stuck` is now `cup_stays_stuck` (the heat module's `passes_through` uses `stays_stuck`). Six new worked examples (a balloon swelling and popping in a jar, a card-glass inside a jar, two
  planes on one lane, the vacuum tube with a control, smoke over a hot pan, a balloon rocket against a tied one). Knobs: `fill_l` in litres (steps 0.25,
  0.5, 1, 2, 4, 8 L, cost 0.5: up to 5× and more for a small jar balloon), a balloon's `tied`, the vacuum tube's `lowest_kpa` and `pump_s`.
  `place.containers` + vacuum-tube, `place.interior` for it; the solver (web/ai/solver.js, a shared edit) sets what goes inside a module container on its
  floor under its lid: the container's shapes at or above its interior's rim are left out of the drop (a card-glass, stand and all, stands on the jar's
  plate; it was put on the jar's glass top). The make-it-work search (web/ai/fixer.js, a shared edit): when the goals compare two things (a goal with a
  and b) or keep a control (expect false), a setting two things of one kind in those goals share is never changed on just one of them (no "boil the
  warm can shorter" when both were boiled 12 s); the fix search then finds none and says so.
- View: smoke puffs 2.6 cm at birth growing to 16 cm, opacity up to 0.95 fading with age, a darker grey; the steam can's dish has ice cubes only when
  `bath_c` ≤ 5 °C; the vacuum tube drawn from its cap (a clear acrylic cylinder down to its base, a brass valve, a hose to the pump, a gauge on
  `pressure_kpa`).
Checked 2026-10-20 (repair): `research/rw-validate-air.ts all` 114 of 114 (the new `repair` group 32 of 32: the jar balloon's lift to the reading's 5
decimals and resting on the floor, coin and feather in the jar and the tube, bursting at the release + 0.3 s with events, the Moon by gravity alone,
Charles over a hot pan to 1e-4, a hot plate popping it, Boyle in the bell jar, a speaker fading in a pumped jar, two planes on one lane flying as alone,
a landed plane within 12 cm of its touchdown, the events, the new goal kinds on real runs); `node --test web/ai/test/air-plugin.test.mjs` 13 of 13
(with the new kinds, the solver's jar floor, the airless Moon, the fair-test fix search, the 60 kPa aim); `npm run test:ai` 202 of 202; `node --test
tooling/src/sim/air.test.ts` 10 of 10; `machines/test_catalog.py` on the 12 air types 12 of 12; the 12 air types' catalog entries Python (GET
/api/catalog) == JavaScript; `tools/parity-engine.mjs --catalog`: every air item identical in node and Chromium; 26 demo scenes: both engines
identical, Python == JavaScript, every goal met; air fuzz 450 scenes 0 problems; the 22 regression scenes byte-identical with and without modules.
AI acceptance on a server of this checkout (Claude Opus 5.5, the review's failed cases): 10 of 10 — a card-glass inside a vacuum jar falls (it was 3/10:
put on the jar's top); a jar balloon swells without bursting and sinks (lift −0.57 g); "only pump the jar down to 60 kPa" → the checked offer "blow more
air into the small balloon (0.3 L → 1.4 L) and raise it 2.7 cm", applied, popped; a dart and a glider on one lane at one height with a farther goal; an
untied balloon jets right 3.0 m, then "tie the balloon this time" → the jets goal fails honestly and nothing unties it; smoke beside a pan of hot water
rises faster than in the room, then "use ice water" → that goal fails honestly; two boiled cans in ice and 80 °C water, both planned crushed and
crushed; smoke in a fan's wind with a wind meter, "turn the fan up to 6 m/s" (goal re-aimed 4.5-7 m/s), "switch the fan off" (on_at past the run,
goals re-aimed: smoke straight up, no wind); a coin and a feather in a pumped vacuum tube and a tube of air; a helium balloon on the Moon (air false)
bursts once let go.
Known limits: smoke passes through solids; the jar's share of the room's air is set by where a part's pose is (a body half in a jar counts as inside or
outside as its pose is), and a fan outside a jar still blows into it (only thinner); the tethered balloon's string anchors at its starting neck; a
hot-air balloon's inside air is carried as 1.2 kg/m³ of inertia (its lift is exact); planes and kites fly in the plane (no roll or yaw); paper planes pass
through each other (not other things); a suction cup's or card's hold is quasi-static (no peel, no slow leak); a balloon's gas warms in plumes and by
touch, not by a lamp's radiation.

## Soft and bendy things (module `softbody`, 2026-10-19): squashing clay, bouncy balls that flatten, bending rulers, boards and bridges, rubber bands, coil springs
Files: `machines/mod_softbody.py` (catalog, goal kinds, the rubber-band cars' build hook), `web/sim/modules/softbody.js` (its exact port + the AI plug-in),
`tooling/src/sim/softbody.ts` (the physics; `softbody.test.ts` its unit tests), `tooling/src/sim/modules/softbody.ts` (the process `softbody`),
`web/models/mod-softbody.js` (models, the `softbody:shape` frame hook, the `softbody:bands` plugin), `tools/parity/softbody.mjs` + `py_softbody.py` (parity),
`tools/softbody/test.mjs` (the AI layer end to end), `web/ai/test/softbody-plugin.test.mjs` (the AI plug-ins' unit tests: goal kinds, checks, digest
lines, change words, Python == JS summaries, checked fixes, the knobs' `when`/`tune`), `research/rw-validate-softbody.ts` (109 gates against theory, all
pass). Nothing of it runs in a
scene without one of its items or a car with `band_turns` (the 22 scenes are byte-identical, `identity.mjs`; the catalog differs by its 9 types, 8
materials, 5 looks, the category "Soft & bendy" and two common props on toy-car, cart and truck). Sources are cited in the Python file ([SOFUOGLU]
[TABOR] [CROSS] [FIBA] [BOUNCE] [ISO2533] [JOHNSON] [GIBSON] [FPL] [PMMA] [ASM] [TRELOAR] [GENT] [ALLIANCE] [RAYLEIGH]).
- **Items**: `soft-clay` (modelling clay ball, `diameter`, `softness` firm | normal | soft = flow stress 175 | 120 | 80 kPa: it keeps every dent),
  `playground-ball` (21.6 cm, 0.4 kg, `pressure` 14 kPa, at most 35), `exercise-ball` (65 cm, 1.1 kg, 4 kPa, at most 10): their coefficient of restitution
  rises with the pressure and levels off, e(p) = e_flat + (e_top − e_flat)·p/(p + p_half) [BOUNCE] (playground 0.30, 0.85, 3.1 kPa: e 0.52 at 2 kPa, 0.75 at
  14, 0.81 at 35; exercise 0.25, 0.80, 1.5 kPa: 0.65 at 4), written into the record as `e`; `foam-ball` (7 cm, 22 g, foam
  `stiffness` 100 kPa, e 0.55), `flex-ruler` (a ruler clamped to a 10 × 5 cm wooden block, `overhang` past the block's edge, `length`, `material` wood |
  acrylic | steel | aluminium with its usual thickness (3.5 | 3 | 0.5 | 1.5 mm) unless `thickness_mm`, `width`, `facing`; anchor: the floor under the
  block's edge), `springboard` (a board bolted on a `stand_height` stand: a diving board; `length` past the stand, `thickness_mm`, `width`, `material`
  pine | wood | aluminium | steel | acrylic | card), `flex-plank` (a free plank, card or metal strip resting on what is under it: across two supports a
  bridge; anchor the middle of its underside), `band-launcher` (a 65 cm launch board, two posts at its anchor drawn beside it, a rubber band to a V
  pouch pulled back `draw` (at most 0.2 m: the band about 5 × its length; it snaps at 6 ×); `bands` 1-4 each side, `band` thin | medium | thick (#19 | #64 | #84), `spread`, `height` of the band above the board: 3 cm, the middle of a toy car's flat back, by default),
  `coil-spring` (a spring on a base under a platform kept upright by a slide; `stiffness`, `rest_length`, `width`, `damping`). `springboard` is named
  "Diving board". Inspector labels: `thickness_mm` "Gauge", the launcher's `band` "Rubber band", `spread` "Post spread" (the AI's change lines word
  them with the module's words, never a generic "bigger" or "thicker wall"). A `fixed` item keeps its moving parts free (a beam's pieces, the launcher's pouch,
  the spring's platform): what is fixed is its base, which stands still anyway. Common props on toy-car,
  cart and truck: `band_turns` (0-30: a rubber band wound on the rear axle drives it) and `band_size`.
- **Soft contacts** (role `ball`): a soft ball is an ordinary ball solid; planck's rigid contact with it is left out (Process.contact "pre") while
  its squash is under `hard` (an inflated ball 0.85 R, a foam ball 0.6 R, clay's elastic part 0.3 R), and the process pushes instead. Every soft contact of a step is gathered
  (planck's contact list gives the candidates: its broad phase and filters), its geometry measured afresh (the other's outline, a dented ball's
  `reach`), and all of them solved together (Gauss-Seidel passes, warm-started from the step before, as planck's contacts are: 10 for a lone contact,
  until they agree within 1e-7 (at most 200) when there are several: a 177 g clay ball between a 5 kg weight and the table couples its two stiff contacts
  so tightly that 10 left the weight ringing; friction stops the contact point sliding within μ·N, μ from the document's contact for the pair). Laws:
  `pressure` F = (p − p_atm)·π(2Rδ − δ²) (an inflated ball: the gas pushes on the flat [CROSS]; p the gas's pressure, (101 325 Pa [ISO2533] + the gauge)
  × (V0/V)^1.4 as the flattened cap πδ²(R − δ/3) squeezes it, adiabatic: a nearly flat ball stiffens smoothly instead of bottoming out; the work in closed
  form, `gasSquash`); `hertz` F = (4/3)E*√R·δ^1.5 [JOHNSON]; both squash at the law's full force and give back e² of it as they ease
  (a hysteresis loop of the right area), and a lone bounce leaves at exactly e times the speed it came in at (`parting`: what a few steps' integration
  of a short touch gained or lost is set right as it parts). `clay` flows at p = 3σ over the flat [TABOR] (the engine's dent law for clay balls): a
  lone hit spends ½·m·v² on the flow's work p·π(Rδ² − δ³/3) exactly (the flat it comes to rest on; the step's travel carries it there), a pressed or
  stacked contact is held by a stiff elastic part (50 × the flow resistance 2πRp: 2 % spring-back) capped at the flow force, which flows the rest; it is
  damped for the heavier of the two bodies and kept while within 0.5 mm of touching (CLAY_SKIN: its signed spring closes the gap only as far as the load
  needs), so a weight rests on clay steadily: `force_n` (everything pressing on it) reads 99.8 N under 5 kg every frame (2 × 49.05 + its own 1.7).
  Flats are kept in the ball's own frame (up to 8; within 25° they merge) and roll with it. Readings: `squash_mm`, `force_n`, `energy_j` (elastic),
  clay `dent_mm`; series `shape` [angle, depth, ...] (own frame) for the view. Measured: clay dents within 1.3 % of the energy law from 0.25-1 m
  (6 and 10 cm, firm to soft), a 1 kg weight resting on a 6 cm ball flattens it 0.173 mm (law 0.171); balls' contact times, squash and restitution
  within 12 % (16 % for a nearly flat 2 kPa ball), 10 % and 4 % of the gas law integrated on its own (gravity's work over a deep squash included); a
  playground ball dropped 1 m bounces 0.15 m at 0.5 kPa, 0.27 at 2, 0.41 at 5, 0.55 at 14, 0.62 at 35 (each within 10 % of e(p)² of the drop, rising at
  every step); the foam ball's 4-step touch within 40 % (its squash 1 %).
- **Beams** (role `beam`): N rigid segments (slabs; 6-16 by length; a ruler's under 2 mm thick collide 2 mm thick, weigh their real thickness) joined
  by the process's own `BeamLink` joints: a pin and a bending spring k = E·I/ℓ (at the clamp E·I/(ℓ·(1/2 − 1/(6N))), so an end load bends N pieces
  exactly F·L³/(3EI)), damping c = 2ζ·k/ω₁ (the material's damping ratio at the first mode). planck's sweeps cannot hold a chain of light stiff
  segments (a ruler's 2 g pieces swing at ω·h ≈ 70; its own WeldJoint chain blows up), so each beam's links form one `BeamChain`: its pins and bends
  solved as one block-tridiagonal system (3 rows a joint), factorised at the step's start and solved again in every velocity pass, the pins' drift
  corrected the same way in the position passes; the bend a soft row (Box2D's soft constraint with this k and c), θ of it implicit (θ = 1 − 2/a,
  a = h²·k·(1/I_A + 1/I_B)·2, as physics.ts's springs), the rest explicit. No document pins (nothing draws axles); the clamped part is a ghost solid and
  the block's edge stands 4 mm short of the bend's root. A ductile beam (steel, aluminium, card) keeps a permanent bend past the moment that first yields it, σ_y·b·t²/6 (smoothed over 5 ms),
  a brittle one (wood, acrylic) snaps past its modulus of rupture × b·t²/6 (its spring lets go; event "<item> snapped"). Readings: `bend_mm` (a clamped
  beam's tip below its clamp's line; a free plank's sag below the line through its ends), `energy_j`, `set_deg`, `broken` (1 once snapped or creased
  10°: the fracture module's `breaks` goal reads it). Measured: cantilever tips within 1 % of Euler-Bernoulli for wood, acrylic, aluminium and steel
  (end loads spread over a slotted mass's foot, where it ends up: set on the end and let go, a mass rides the ruler's ringing and creeps down
  its slope toward the end, 100 g 4-5 mm, 20 g 0.2 mm), twice the load 1.90× the bend (theory 1.90 there), twice the overhang 9.67× (theory 9.72);
  bridges on two point supports within 6 %; a springboard's own sag exact and its first mode 2.3 % low (12.0 against 12.3 Hz).
- **Rubber** (roles `band`, `motor`): strands F = A0·(E/3)(λ − 1/λ²) × J_m/(J_m − (λ² + 2/λ − 3)) (neo-Hookean [TRELOAR], Gent [GENT]; E 1.5 MPa, J_m 40),
  slack under λ 1; shortening they give back `resilience` (0.8) of their pull. The launcher's pouch (it never turns: its strands hold it square to
  the launch line; at the start it closes up, less 0.5 mm, to a moving thing within 1 cm in front of it, so what it launches sits in it and is
  pushed, not struck by a 2 g pouch at 20 m/s) is pulled toward the posts' line by 2n strands of
  √(r² + (spread/2)²) each (rest 5 % short of the posts' half spacing), followed through each step in pieces (ω·h/N ≤ 0.05, 16 to 1024, ω from the
  band's stiffest point this step and what rides in it), and the pouch is given the step's MEAN speed so the engine's x += v·h lands it where the pieces
  put it; its end speed is kept for the next step with whatever else changed its speed since: steady at any stiffness (four thick bands at 0.2 m against
  the empty 2 g pouch, ω·h ≈ 3, ran away to 1.5e9 J before). A band stretched to `snap` (BAND_SNAP 6: rubber's breaking stretch) snaps: event "<item>'s
  rubber band snapped" (kind snap), then it pulls nothing (`broken` 1; the fracture module's `breaks` reads it; drawn hanging limp from its posts).
  Measured: stored energy exact against the integral, a 2.5 cm ball takes 40-51 % of it (the pouch keeps its share); every prop at its most with nothing,
  a ping-pong ball or a toy car in the pouch: no energy above the start's, no part past 250 m/s. A band car's band (2 strands, l0 = 0.6 × the car's
  length, on a 3 mm skewer axle, AXLE_R 1.5 mm) turns the rear wheel with T·r (the body the other way) while it unwinds (event "<car>'s rubber band
  unwound"); the tyres grip only μ·N·r_wheel (μ of the wheel on what it touches, N its share of the car's weight by the lever rule about the car's centre
  of mass, × the slope's cosine): a band that pulls harder spins the wheels and the turns above what they hold unwind at once (event "<car>'s wheels
  spin: … N turns unwind for nothing", kind spin), so more turns never take a car less far (validated: 5/10/20/30 turns of each band, toy car and
  cart, non-decreasing; a toy car on a table: medium band 2 turns 0.4 m, 5 turns 2.3 m, 10 turns 7 m, past about 19 turns 12.7 m; thin 5 turns 0.6 m,
  10 turns 2 m; thick spins past about 8 turns). The band waits one step after the release (the engine finds what the wheels stand on in its first
  step). Readings on the car `band_turns`, `band_stretch_cm`, `band_tension_n`, `band_energy_j`.
- **Coil spring** (roles `guide`, `spring`): the document's own spring joint (the engine's springs, drawn as a coil) under a platform held on a planck
  prismatic slide to the ground; readings `compression_mm`, `force_n`, `energy_j` zeroed with its own platform resting on it (`tare`, as a lab
  zeroes its scale): an empty spring reads 0, a load reads m·g/k within 2 % (200 N/m: 4.9 mm per 100 g), and squash(2m) − squash(m) = m·g/k (gated).
- **Goals** (Python == web/sim == ai/goals.mjs = web/ai/goals.js): `squashes {item, at_least_mm?}` (its `dent_mm` at the end, default 1 mm),
  `springs_back {item}` (its deformation reached 2 mm and it keeps no dent, set or break), `bends {item, at_least_mm?, at_most_mm?}` (`bend_mm` at the end;
  default at least 1), `deforms_more {a, b}` (a's bend, dent or compression at the end, or squash or stretch at its most, more than b's by 5 % and 0.2 mm),
  `stores {item, at_least_j?}` (its peak `energy_j` or `band_energy_j`, default 0.01 J), `bounces {item, at_least_m?, at_most_m?}` (`bounce_m`: how high
  it rises after its first landing, its centre's highest point before it comes down again less where it was as it touched, its lowest point plus its
  squash there; default at least 0.02 m), `bounces_more {a, b}` (a's first bounce higher by 5 % and 1 cm; `a_m`, `b_m`). `deforms_more` between bends
  under 1 mm (stiff rulers): by a quarter and 0.02 mm, the entry then says `small: true`. `bends` on an item that is not one of this module's beams is
  judged by the goal kind of that name registered before this module (the heat module's bimetal strip: its tip's most), so both keep their rule.
  Aliases: dents, flattens, plastic…; elastic, returns_to_shape…; sags, deflects…; bends_more, squashes_more, stretches_more…; stores_energy,
  elastic_energy…; bounce, bounce_height, rebounds…; bounces_higher, bounce_higher, higher_bounce, rebounds_higher….
- **AI** (web/sim/plugins.js): the title carries its own words for the prompt's module pick (squashing clay, bouncing, bending rulers, stretched and
  wound rubber bands, coil springs: "wind-up rubber band cars … wound 5 turns", "modelling clay", "a ball … bounces higher" bring its section in, a plain
  car race does not); the how-to (what each item does, where its anchor is, every compared ruler's load centred at the same distance from its block,
  a car on the launcher, bounce heights per pressure, launcher energies per draw, band-car distances per turn and band on a table and where the wheels
  spin, the spring's zeroed readings), prompt lines (plan: bounce lessons with bounces_more; a COMPARE request reports what happens and never puts a
  material or pressure in the tune knobs; edit/refine: a band car's distance comes from band_turns and band_size, never start_speed or another lane's
  surface; in a comparison change what is compared, not one beam's material), worked examples (pumped vs flat ball, band cars 5 vs 10 thin turns,
  Hooke's three springs), digest lines (a beam's E·I, its bend per 100 g at its very end and, for the loads where they really rest, F·a²(3L − a)/6EI;
  clay's flow and force; a ball's pressure, its e and its first bounce; a launcher's stretch against its snap and its energy; a spring's per-100 g and
  the load it reads; a band car's turns, stored energy and a wheel spin). Knobs said in plain verbs ("push the ruler out farther over the edge (20 cm →
  24 cm)", "pump Flat ball up (3 → 5 kPa)": pressure in kPa steps 1-10), with the framework's new fields: `tune: false` on what a lesson compares (balls'
  pressure, foam stiffness, beams' material, clay softness, spring stiffness: the build's tuners leave a plan's tune knob on them out, and say so),
  `when` (a band car's band_turns and band_size only on a car that already has a band; a beam's material only on a beam not compared with another of
  its type). Change words without parentheses inside ("overhang 20 cm → 30 cm: it bends 3.37× as much (L³)", "pumped 14 → 7 kPa: it bounces lower
  (leaving the floor at 0.75 → 0.68 of its landing speed)", "rubber band wound 0 turns → 1 turn"); `words.moves` (a beam that bends or a ball or spring
  that squashes 2 mm still does its thing: no "no longer moves" heads-up), `words.ownHits` (a launcher's, a beam's or a spring's own parts striking each
  other are no news in the run's story), `words.mass` (a ruler or diving board weighs its whole length, not only its moving part), `words.keys` so an
  edit's own amounts are held.
- **View**: soft balls are spheres flattened every frame at their series' flats (grown to keep clay's volume, half that for a ball's gas); beams are their
  segments drawn as pieces of the board or ruler (a ruler's mm, half-cm and cm ticks run on across them; acrylic clear and tinted); the clamp a dark
  steel block with a red knob; the launcher's board carries its posts and hooks, the band's strands are drawn each frame from the hooks to the pouch
  (thinning as they stretch; snapped, they hang limp from the posts), and a band car's band runs from a hook under its body to the rear axle, its wound
  turns a coil that shrinks as it unwinds.
- **Framework plug-in points added for this repair** (web/sim/plugins.js, shared edits under their locks): knob `tune?: false` (`knobTunable`, used by
  web/ai/orchestrator.js `safeKnobs`, which both build tuners call) and `when?(item, scene)` (`knobApplies`, web/ai/fixer.js `moduleKnob`); `words.moves`
  (`moduleMoves`, orchestrator `lostStageList`), `words.ownHits` (`ownHitsTold`, orchestrator `describeRun` and the run's notes), `words.mass`
  (`moduleMass`, orchestrator `massOf`). Without a module that uses them, nothing changes.
Checked 2026-10-20 (repair): `research/rw-validate-softbody.ts all` 109 of 109; `node --test web/ai/test/softbody-plugin.test.mjs` 13 of 13;
`tools/softbody/test.mjs` 55 of 55; `node --test tooling/src/sim/softbody.test.ts` 9 of 9; `tools/parity/softbody.mjs --engine` 969 checks, 0
mismatches (61 engine runs, 30 at the props' limits, bounded, the bundle byte for byte); the 22 regression scenes byte-identical with and without
modules (only zz-catalog differs); the 11 demo scenes Python == JavaScript, every goal met (s3: the 10 cm launch stays on its lane, an end stop
beyond it; s7: thin bands, 5 vs 10 turns, 0.6 m vs 1.9 m).

## Gravity and space module (2026-10-19): other worlds, orbits, the Moon's phases, shadows through the day (2026-10-20: the classroom Sun-Earth-Moon models, the Moon's tilted orbit and eclipses, seasons)
Files: `machines/mod_space.py` and its exact port `web/sim/modules/space.js` (catalog, goal kinds, AI plug-ins), `tooling/src/sim/space.ts` (the pure physics:
attraction, launches, phases, shadows, the Sun's position; unit tests `tooling/src/sim/space.test.ts`), `tooling/src/sim/modules/space.ts` (the engine's
processes), `web/models/mod-space.js` (models and the view plug-in "space:sky"). Sources: NASA NSSDCA planetary, lunar and satellite fact sheets
[NASA-PFS], CODATA 2018 (G = 6.67430e-11), IAU 2012 B2 / 2015 B3, the Apollo 15 Lunar Surface Journal, Meeus (Astronomical Algorithms ch. 13, 48),
Cooper 1969 (declination). Scenes without these types are untouched (the 22 scenes byte for byte, Python and web/sim, against the before-bundle).
- **Places** are the scene's settings (the framework's `settings.gravity`, `air` and, since 2026-10-20, `air_density`): the inspector's Gravity menu lists
  Earth 9.81, the Moon 1.62 (no air), Mars 3.71 (thin air 0.020 kg/m³), Jupiter's cloud tops 24.79 (0.16 kg/m³), Mercury 3.70 (no air), Venus 8.87 (thick
  air 65 kg/m³), Saturn 10.44 (0.19), Neptune 11.15 (0.45), Pluto 0.62 (no air) and "No gravity" (a space station: air on; outer space: air off); a
  world without air sets `air: false` with it, a world with its own air keeps the air on at its density (`air_density`), Earth brings the room's back
  (one undo step; numbers are stored as numbers). Fall times √(2h/g), weights m·g on measure's spring scale, a jump's peak v²/2g all follow.
- **Orbit mode**: a scene holding a `sun`, `planet`, `moon` or `satellite` is in space: the build hook sets `doc.settings` gravity 0 and air false whatever
  the scene says (the inspector greys its Gravity and Air rows and says why). The machine plane is the plane of the orbits, seen from above.
  - `sun` / `planet` (`body`: earth, mercury, venus, mars, jupiter, saturn, uranus, neptune, pluto) / `moon` (moon, io, europa, ganymede, callisto, titan,
    phobos, deimos): a ball with the body's real mass × `mass_scale`; `diameter` automatic = its true size at the scene's scale, or a visible size where that
    is too small (Earth 11 cm, the Moon 3 cm, the Sun 30 cm: drawn larger than true, the same factor for the Earth and the Moon); `fixed` holds it still.
  - **Scale**: the scene's heaviest pulling body's `scale` sets km per metre and real time per scene second for every body: auto = its own (`inner-planets`
    1 m = 1 au, 1 s = 40 days; `earth-moon` 1 m = 300,000 km, 1 s = 2 days; `jupiter-moons` 1 m = 10⁶ km, 1 s = 12 h; `mars-moons` 1 m = 20,000 km, 1 s = 2 h;
    `low-orbit` 1 m = 10,000 km, 1 s = 10 min, the Earth drawn true size 1.274 m), or `custom` (`km_per_m`, `hours_per_s`). μ_scene = G·M·s²/(1000·k)³:
    real mass, distance and period ratios are kept. Engine masses are 1e-21 × real (Earth 5972 kg), so pulling bodies attract each other with equal and
    opposite forces.
  - **Attraction** (`space-body` records, one per body; the first runs the system): every (sub-)step after the release every moving solid is pulled by every
    body with μ > 0 but itself, a = μ·d/|d|³ at its middle, μ·d/R³ inside its radius R (a uniform sphere); a satellite pulls nothing. A body
    far too heavy for the scene's scale (μ over 20²·R: a circle just above its surface faster than 20 m/s; every lesson scale is under 5 m/s,
    the Sun dropped into an Earth-Moon scene is 990) is held there and said once ("… is too heavy to show at this scale"): such a pull would only
    fling everything at the engine's speed limit and grind the run down in collisions.
  - **Launch** (`orbit_factor`, default 1; `direction`; `primary` link, else the attractor with the highest μ/r³): at the release, heaviest first, the
    circular speed √((μ_c + μ)/r) round its primary × the factor, at right angles, the pair's barycentre kept (the primary recoils by μ/(μ_c + μ)); given as one
    step's impulse m·(v/h − a/2), so planck's step is leapfrog (velocity Verlet) from the start: a circular orbit holds its radius to 2·10⁻⁵ over 10 orbits.
    0 = let go at rest; < 1 falls in (periapsis r·f²/(2 − f²)); 1 a circle; √2 escapes.
  - **A Sun that only shines** (`sun` `pulls: false`): no pull, held still, its light parallel (at infinity): the Moon's phases beside an Earth and a Moon at
    visible distances (a pulling Sun there would tear them apart: the real Sun is 390 times farther than the Moon).
  - **Readings** (each body with a primary; lag one 1/480 s step): `distance` (m) and `distance_km`, `speed` (m/s, relative) and `speed_kms`, `turns`
    (in its own direction), `fell` (1 once it touched its primary), `escaped` (1 while its energy is ≥ 0 moving away), `altitude_km` (satellites), and for a
    moon with a sun in the scene `lit` ((1 + cos i)/2) and `elongation` (° from the Sun as its planet sees it: 0 new, 90 first quarter, 180 full, 270 last).
    Events: "<item> completed orbit n round <primary>", "<item> fell onto <primary>", "<item> escaped <primary>'s pull".
- **satellite** (`kind`: satellite, space-station, cannonball (an iron ball), probe; `size`): a test body launched like a moon; its weight never changes its
  orbit. At the low-orbit scale the ISS's 420 km is 4.2 cm: keep it ≤ 5 cm there or it grazes the Earth.
- **rock-hammer**: Apollo 15's 1.32 kg geologic hammer lying on its side (a steel head welded upright at the right end of its handle; 0.62 of the weight
  in the head, provisional), for drops on other worlds.
- **gnomon** (shadow stick, static, its foot the anchor; `height`, `latitude`, `season` (an equinox, a solstice, or `day_of_year`), `hour` = solar time at
  the start): the `sun-clock` process runs solar time at the scene's `time_lapse` (hour + t·lapse/3600) and reads `hour`, `sun_elevation`, `sun_azimuth`
  (from north, clockwise), `shadow_m` (h/tan e, 0 with the Sun down, ≤ 100 m), `shadow_dir`, `day_length_h` (sin e = sin φ sin δ + cos φ cos δ cos H;
  Meeus 13.5; δ = 0 / ±23.44° / Cooper). The view draws its true shadow on the ground (the machine plane runs east-west: east right, north into the
  picture), a compass round its foot and a small Sun in its direction; the stick casts no lamp shadow of its own.
- **Classroom models** (2026-10-20; side view on the table, ordinary gravity, NOT orbit mode). What plays the Sun is a light of the scene: the heat module's
  desk `lamp` (its bulb: the `heat` record's `at` from its base, radius 3 cm, a 60 W A19 bulb's 60 mm), the optics module's `flashlight` (its lens, turned
  with it) or `sunlight` (parallel, its travel direction `dir`), or a space `sun` (a point at its middle; `pulls: false`: parallel from where it is drawn).
  The build hook `_lights` (after optics' hook: it reads the optics record's sources, else the solids' `light`) writes `light` {kind: point | parallel |
  far, solid, x, y, frame: world | solid, radius, dir, from (the time it comes on; 1e9 off)} into each `globe` and `moon-ball` record (the item's `lit_by`
  link, else the first light of the scene, in scene order; none: null), and the view's copy into the resolved props (`light` {x, y} or {dx, dy, parallel},
  the moon ball's `centre`). The geometry is 3D (x right, y up, z toward the camera): `tooling/src/sim/space.ts` globeAxis, globeMeridian, globeTown,
  carriedAt, phase3D, shadowCone, lunarEclipse, solarEclipse (only + − × ÷, sqrt and the engine's sin, cos, atan2).
  - **globe** (static; foot on the table; Ø `diameter` 0.30 m on a stand, `stand_height` 0.25 (its middle 0.40 m up, level with a desk lamp's bulb at
    `head_height` 0.4), `tilt_deg` 23.44 [NASA-PFS], `lean` = where its north pole leans, kept so: toward / away from the camera, right, left (fixed in the
    room), toward / away from the light (from the light at the start: the June / December solstice); `spin_rpm` 6 (west to east, one turn = one day of the
    model), `start_hour` (the town's solar time at the start), `town_lat` 30.27; link `lit_by`). Solids: base (slab), post (hidden: the model draws it),
    ball (static: it does not turn in the physics). Process `globe` {solid, radius, tilt, lean, rpm, hour, lat, light}: the reference meridian is the light's
    at the start; every step the town u = cos φ (cos ψ e1 + sin ψ e2) + sin φ a, ψ = (hour − 12)·15° + 360°·turns: `day` (1 while the light is above the
    town's horizon, from its own place on the ball: a near lamp lights the cap u·(L − C) > R, less than half; and on), `local_time` (12 + the hour angle
    round the axis from the light's meridian / 15), `sun_elevation`, `noon_elevation` (90° − |φ − δ|), `sun_lat` (δ = asin(a·ŝ): where the light is
    overhead), `day_length_h` (cos H0 = −tan φ tan δ), `turns`; events sunrise / sunset at the town. No light: `day` 0 (and `turns`).
  - **moon-ball** (static ghost ball Ø 7.5 cm of `craft foam` (EPS 25 kg/m³, provisional), clear to the optics module's rays: it is carried, it touches
    nothing; its anchor is the centre of the circle it is carried round: with `around` a globe that globe's middle): `radius` 0.6 m, `period_s` 12 (one trip,
    a month; 0 held still), `start_deg` (from the light's side, counter-clockwise seen from above: 0 new (between the light and the globe), 90 first
    quarter (toward the camera with the light on the left), 180 full, 270 last), `tilt_deg` 30 and `node_deg` 90 (its circle tilted about a line of nodes
    90° from the light: high at full, low at new, so with a near lamp and a 30 cm globe it misses both shadows; level, 0: a lunar eclipse at full and a
    solar one at new); links `around` (globe), `lit_by`. Process `moon-ball` {solid, ball, radius, period, start, tilt, node, around, light}: where the
    hand has it (carriedAt: the horizontal circle turned `tilt` about its line of nodes), `elongation` (the ball's and the light's longitudes round the
    vertical seen from the centre: the astronomers' phases by ecliptic longitude, the table's level the model's ecliptic), `lit` ((1 + cos i)/2 at its
    place), `height`, and with a globe `lunar_eclipse` (the globe's shadow on it: 0 none, 1 penumbral, 2 partial, 3 total) and `solar_eclipse` (its
    shadow on the globe: 0, 1 partial, 2 annular, 3 total), from the cones of the light's disc (lamp 3 cm, flashlight 1.2 cm, sunlight 0.2666°); events
    when an eclipse ends, by its deepest kind.
- **The Moon's tilted orbit and eclipses** (orbit mode; the 2D orbit is the real one seen from above, its tilt an out-of-plane height): `moon` props
  `orbit_tilt` (automatic by body: the Moon 5.145° to the ecliptic [NASA lunar fact sheet]; Io, Europa, Ganymede, Callisto 3.13 and Titan 26.73, Phobos,
  Deimos 25.19: their planet's axial tilt, their orbits lying near its equator) and `node_deg` (90: where the tilted orbit crosses its planet's, counted
  from the Sun's direction at the start the way it goes: 90 high at full and low at new, no eclipse this month; 0 or 180 eclipses at this new and
  full moon). Record fields `tilt`, `node`, `sun_km` (its planet's real distance from the Sun: a far Sun's distance; 1 au without one). Readings (a moon
  of a planet with a sun in the scene): `height_km` (its height above the plane: its distance across the line of nodes × tan tilt, at the scale) and
  `latitude`, and `lunar_eclipse` / `solar_eclipse` (codes as the ball's) from the REAL sizes and distances in km (the Sun 695,700 km, the Earth 6,371,
  the Moon 1,737.4; the cones of space.ts shadowCone); events when one ends. The earlier readings (`lit`, `elongation`) are unchanged (in-plane). At the
  Moon's mean distance (384,400 km) a central solar eclipse is annular (the umbra's tip 50 km short of the Earth's middle); a total one needs it nearer
  (perigee 363,300 km = 1.211 m at the earth-moon scale, orbit_factor 1.027). The eclipse limits come out as the cones say: a full moon within 4.74°
  of a node is totally eclipsed, within 10.55° partly, within 16.64° penumbrally; a new moon within 10.66° gives a central (annular) solar eclipse,
  within 16.59° a partial one (real: about 4.6-5.3°, 11-12°, 17°, 10-12°, 15-18.5° [Meeus ch. 54; the real umbra is 2 % larger, from the Earth's air]).
- **Seasons** (orbit mode, a `planet` with `seasons` true: listed on every planet, built only when set): `axis_tilt` (automatic by body: Earth 23.44,
  Mars 25.19, Uranus 97.77 ... [NASA-PFS]), `start_date` (march equinox, june solstice, september equinox, december solstice: where its north pole leans
  from the Sun at the start: toward it in June, away in December, square to it at the equinoxes, the June solstice a quarter orbit on), `town_lat`. Its
  axis keeps pointing one way in space all round its orbit (space.ts seasonLean, seasonsAt): readings `sun_lat` (δ = asin(sin ε · (b·ŝ))),
  `noon_elevation`, `day_length_h`, and `night_lon` (5-ESS1-2, the stars change with the seasons: the ecliptic longitude of the midnight sky, the Sun's
  + 180°, the Sun's 0 at the March equinox and growing the way the planet goes round: the constellation on the ecliptic highest at midnight, by the
  IAU's boundaries at J2000 (Pisces 351.6-29.1°, Aries ... Ophiuchus 247.7-266.3°, Sagittarius ...: `ZODIAC`), and Orion while it is 70-100°). Record
  field `seasons` {tilt, date, lat}; the view's axis in the resolved props `season_axis` [x, y, z].
- **Goal kinds** (Python == JS, ai/goals.mjs through the registry): `orbits {item, around?, turns?}`, `falls_in {item, into?}` (the `fell` reading for its
  primary, else an impact), `escapes {item}`, `lands_together {a, b, tol_s?}` (first impacts within 0.02 s), `lands_first {a, b}` (by ≥ 0.02 s),
  `phase {item, name, at_s?, any?}` (eight 45° bins; "full", "new", "third quarter" ... accepted; a moon or a moon ball), `shadow_length {item, m, tol?, at_s?}`;
  (2026-10-20) `day_night {item: globe, is?: "day" | "night", at_s?, days?}` (day or night at the town at at_s, default the end; with `days` n: at least n
  sunrises and n sunsets), `eclipse {type: "solar" | "lunar", item: the moon or moon ball, total?, central? (solar: annular or total), none?, at_s?}` (that
  eclipse at some moment, or at at_s; none: never; summarize takes every moon and moon ball when the item is left out, the AI's plans name it),
  `solar_eclipse {item, ...}`, `lunar_eclipse {item, ...}`, `noon_sun {item: globe | planet with seasons, deg, tol? (1°), at_s?}`, `night_sky {item: a planet
  with seasons, constellation (the zodiac's 13 or Orion; "scorpio", "capricorn", "the hunter" ... accepted), at_s?, any?}` (it stands highest at midnight).
- **View** (`space:sky`, for a run with space bodies): `environment` {room: false, table: false, background: a starry sky, key 0, fill 0.025, envIntensity
  0.03} (a new framework field, below), a point light inside each pulling sun and parallel light from a far one (shadows: eclipses show), each body's
  path drawn as it goes, and beside a moon's planet an inset of the phase it sees ("Seen from Earth: waxing gibbous, 78 % lit"). Models: the Sun (limb-
  darkened, not tone-mapped, a corona; casts no shadow), every planet and moon with a texture baked on the sphere (Earth's land, ice and clouds, the
  Moon's maria and craters, Jupiter's bands and Red Spot, Saturn's rings (drawn, not solid) ...), the pole leaning 25° toward the camera, turning at its
  real rate when that is under 0.3 turns a second; satellites (gold foil, solar wings, dish), the station, the cannonball, the hammer, the stick.
  (2026-10-20) A tilted moon is drawn lifted off the plane by its height × `lift_per_km` (resolved props: its planet's drawn radius / its real radius, so the
  drawn shadows fall as the real cones do), its path too; red-brown with a faint copper glow of its own in a total lunar eclipse (the Earth's air bends
  red sunlight into the umbra), dimmed in a partial one; the inset says the eclipse ("a total lunar eclipse", a copper disc). A planet with seasons leans
  its real axis (`season_axis`) instead of the 25° toward the camera, and a label over the Sun says the town's noon Sun and day ("June solstice: 30° N noon
  Sun 83° up, 13.9 h of day"). The classroom: `globe` (a round walnut-dark base, a chrome post, a brass half meridian round its far side and its axis pins,
  the Earth's map on a varnished ball turning on its axis from the run's `turns`, the town's red pin; its night half darkened from where the light is: the
  lit cap of a near lamp, half the ball in parallel light, matching `day`), `moon-ball` (a white foam ball on a 30 cm dowel, drawn where it is carried,
  its night half dark, dark grey in a total eclipse; an unseen box of its whole circle so the wide shot frames it: the export's framing, and the
  canvas's once its model is cached); plug-in `space:classroom` (a run with a globe or a moon ball and no space bodies): a dimmer room (key 1.3, fill
  0.12, environment 0.16) so the lamp's light shows the day and night halves, the phase inset of each moon ball as its centre sees it ("Seen from the
  globe: waxing gibbous, 78 % lit", or "in the globe's shadow (total)"), and a label over each globe with its town's solar time ("30° N: 9:00 day").
- **AI**: the digest's how-to (places with g and air, orbit mode, the scales with real distances and periods in scene units, placing an orbit scene and
  Newton's cannon, phases with a far Sun, shadows with time-lapse), plan / edit / refine lines, 9 worked requests, digest lines per body (scale, launch,
  real distance and speed, the period at this speed, turns, fell / escaping, the phases in order; the stick's Sun and shadow at the start, the end and its
  shortest), knobs (`orbit_factor` abs 0.02-0.4, `mass_scale` rel ×1.1-×3 (cost 6), `primary` link; the stick's `hour`, `height`, `season`), change words
  ("launch speed 1 → 1.2× orbit speed (an ellipse that swings out farther)", "Earth → Mars", "clock 9:00 → 15:00 (solar time)") and `words.keys` (below).
  (2026-10-20) The module's title names the classroom words ("... the Moon's phases, eclipses, seasons, day and night on a globe"), so the tiered digest
  carries its full section for "day and night on a spinning globe", "moon phases with a ball on a stick", "why isn't there an eclipse every month", "the
  Earth's seasons"; the how-to's CLASSROOM SUN-EARTH-MOON MODELS, moon-ball and ECLIPSES and SEASONS paragraphs (where to put the lamp, globe and ball,
  level lights, one globe a run for June against December: a globe in line with another sits in its shadow, the eclipse settings, a far Sun's place
  clear of the Moon's circle, the perigee for a total solar eclipse), plan / edit / refine lines, 7 more worked requests, digest lines (the globe: its
  light and how far, axis and lean, spin; the town's time and day at the start and the end, sunrises and sunsets, where the light is overhead and the
  season it makes, the noon light and the day; the moon ball: its circle, trip, tilt, light, the phases in order, its eclipses with their times; the
  Moon: its tilt, nodes, greatest latitude and eclipses; a planet's seasons: the noon Sun at the start, the end, highest and lowest with their times),
  knobs (the globe's `start_hour` abs 0.5-6 h, `spin_rpm` rel, `lean` choice, `town_lat` abs, `tilt_deg` abs (cost 5); the ball's `start_deg` abs
  15-180°, `period_s` rel, `tilt_deg` abs 5-30°, `node_deg` abs, `radius` rel; the Moon's `node_deg` abs 5-90°, `orbit_tilt` (cost 8: the real 5.145°,
  changed only when asked); the planet's `start_date` choice, `town_lat` abs), change words ("starts 0° → 180° round from the light (new moon → full
  moon)", "circle tilt 30° → 0° (level: eclipses at full and new)", "north pole leans toward the camera → toward the light", "town's clock at the start
  6:00 → 12:00 (solar time)", "nodes 0° → 90° from the Sun (no eclipses this month)"), `words.keys` for them ("spin the globe faster", "carry the ball
  round in 20 s"), `place.held` for the moon ball (carried in the air: the solver does not call it floating), and goal-kind aims (web/ai/fixer.js's
  first tries): `phase` on a moon ball: the `start_deg` that shows the phase at at_s; `day_night`: the `start_hour` that puts the town's noon (or
  midnight) at at_s, or midnight when the run holds the days asked; `noon_sun`: the `town_lat` where the noon light stands that high, from the run's
  `sun_lat`. (The search cannot lengthen the run: a day_night goal a slower spin breaks for want of time is said honestly, no fix offered.)
- **Framework additions** (small, locked edits): `web/view-plugins.js` passes a plugin's `environment`; `web/view3d.js` applies it per run (`applyEnvironment`:
  room, table top, background, the room light's strengths; restored for every run without one; kept through the mirror and export passes) and draws no
  stand under a static solid marked `stand: "none"` (a body in space); `web/sim/plugins.js` `keyWords(type, key)` from a module's `words.keys`, which
  `web/ai/orchestrator.js` `choicesOf` reads (so "make the Earth half as heavy" is the person's own choice of `mass_scale` and no fix offers it back), and
  `choicesOf` no longer splits a clause at a decimal point ("0.8 times orbit speed" is one clause); `web/sim/plugins.js` `settingWords(key, a, b)` from
  a module's `words.setting`, which `describeDiff` uses for the scene's settings ("Settings: gravity the Moon → Mars (g 1.62 → 3.71 m/s²)");
  `web/inspector-plugins.js` the places above.
- Known limits: the month shown is the sidereal 27.32 days (the far Sun does not move); the Moon's nodes do not regress (18.6 years a turn: a month moves
  them 1.6°); the Earth's shadow is the geometric one (the real umbra is about 2 % larger, from its air) and day lengths are the Sun's centre's (refraction
  and the Sun's disc add about 6 minutes); the classroom models are carried and turned by the run (kinematic, not physics bodies: the moon ball is a
  ghost that things do not bump, the globe's ball does not turn in the physics), and their readings see the light's place, not what stands between (a
  globe in line with another sits in its shadow in the picture, not in the readings: one globe a run); a light's brightness changes no reading (a lamp
  off is night, on is the Sun); at a clock slower than about an hour a second a slow body (under 1 mm/s: a primary's recoil) is put to sleep by planck
  and its velocity zeroed: hold such a primary `fixed`; tides are not modelled (no ocean on a turning planet in a rigid-body engine); Mars's thin air is
  the scene's `air_density` 0.020 (2026-10-20; it was treated as none: a 1 g craft feather from 2 m lands 1.06 s after the drop, a golf ball 1.04 s, both
  1.04 s with the air off; the air module's airless-world hook still turns the air off on Mars when the scene has balloons and does not say `air: true`); satellites do not turn to face their planet (no attitude control).
- Checked (2026-10-20, the classroom models, eclipses, seasons): `node --no-warnings research/rw-validate-space.ts` 117 of 117 (the 65 below and: the midnight
  sky at the March equinox 180° (Virgo), the June solstice 269.94° (Sagittarius), December's 89.98° (Orion high), its goals met; S8 a globe
  under sunlight from 5° up: a sunrise and a sunset each 10 s turn, the day 12.358 h = Meeus' 2·acos(−tan φ tan δ)/15 to 0.002 %, 12.000 h at the equator
  (the terminator a great circle), the light's height every frame = Meeus' sin e within 2·10⁻⁴°, the solar time 24 h a turn; a lamp 0.90 m away lights a
  cap: the day 10.459 h against 2·acos((R/D)/cos φ)/15 = 10.517 h (0.55 %, the frames' crossings); S10 on the table with the bulb level: leaning toward the
  light the light overhead at 23.44° and Austin's noon 83.17°, 13.95 h; away −23.44°, 36.29°, 10.05 h (exact); S7 a moon ball round a globe in a far Sun's
  level parallel light: lit = (1 − cos E)/2 to 4·10⁻¹⁶, the elongation 360° a trip, a total lunar eclipse at full and a total solar one at new; with the lamp
  and the default 30° circle: the eight phases in order, no eclipse, the lit fraction and the elongation against a recomputation of where the hand has
  it (4·10⁻¹⁶ and 2·10⁻⁴°); S10 the Earth round the Sun with seasons on: the Sun overhead at asin(sin 23.44° · sin θ) all year to 1.1·10⁻⁶° (the axis kept
  one way), ±23.44° at the solstices, June a quarter year (2.2833 s against 2.2829 s) after March, Austin's noon 59.73 → 83.17 → 36.29°; eclipses: a total
  lunar eclipse at a full moon on the nodes, its totality 1.550 h against 2·(r_umbra − r_moon)/v = 1.552 h, the umbral phase 3.425 against 3.436 h, the
  penumbral 5.354 against 5.375 h (a 1 h-a-second clock, the Earth held: real eclipses up to 1.7, 3.8 and 6 h); a month with the nodes square to the Sun:
  phases, no eclipse, the Moon up to 5.145° off the plane; the limits by bisection against the cones' closed form: lunar total 4.744°, umbral 10.550°,
  penumbral 16.642°, solar central 10.664°, partial 16.586° (all within 1.2·10⁻⁴°)); `python3 machines/test_space.py` 220 of 220 (229 with the heat and
  optics modules: the lights the hook finds, the records, the view's props, the new goal kinds on hand-made tracks); `node --no-warnings --test
  tooling/src/sim/space.test.ts` 13 of 13; `node --no-warnings tools/space/test.mjs --n 120 --seed 11` 50 of 50 (now with 60 classroom scenes: lights,
  globes, moon balls with random links, every goal kind); `node --no-warnings tools/parity/module.mjs --module space --n 12 --mix 60 --engine` 601
  checks, 0 mismatches (8 types); `node --test web/ai/test/space.test.mjs` 12 of 12 (the AI's checks of day_night, eclipse and noon_sun
  = the summary; change lines; the person's choices; an edit that moves the full moon: said honestly, the fix search finds "start it further round"
  (start_deg) and keeps the 20 s trip; the aims: a spin twice as fast fixed by the town's start time; the real Moon's eclipse in the digest; the
  registry); `PARITY_SERVER=<own server> node tools/parity/fuzz-live.mjs --n 300` 967 checks, 0 mismatches; a fuzz of 300 classroom and orbit scenes with props at
  their ends: no exception, every reading finite, every goal a boolean, the slowest run 1.9 s; the 22 scenes byte-identical to the before-bundle (web/sim
  and Python; with `PLAYGROUND_MODULES=""` the catalog too); the space demos of 2026-10-19: 11 tracks byte-identical, the Moon's phases demo identical but
  for its new eclipse readings (motion and every earlier reading the same bits); 20 demo scenes (8 new: a globe's day and night, its June and December,
  a moon ball's phases and its eclipse, a total lunar eclipse, a month without one, the Earth's seasons round the Sun) every goal met through the server
  (Python and node) and the browser (web/sim and the bundle), tracks byte-identical; AI acceptance with real Opus 5.5 through a local server
  (`tools/space/ai-acceptance.mjs`), the classroom cases 8 of 8: builds (day and night on a globe under a lamp; the phases with a moon ball; why no eclipse
  every month, with the real Sun, Earth and Moon; the Earth's seasons round the Sun, the noon Sun at Austin highest in June) all with the module's items
  and goal kinds, every goal met; edits ("start the town at noon": start_hour 12, nothing else; "carry the ball round in 20 s": the trip 20 s, the full
  moon's goal moved to 10 s and the run lengthened, said; "spin the globe at only 1 turn a minute": honest ✗, "a day now takes 60 s, longer than the 20 s
  run"; "spin it at 12 turns a minute": honest ✗ and a checked fix found by the aim, the town's start 6:00 → 0:00, the spin kept).
- Checked (2026-10-19): `node --no-warnings research/rw-validate-space.ts` 65 of 65 (Apollo 15's hammer and feather on the Moon at 1.406 s against
  √(2h/g) = 1.405 s; one metre on seven worlds within 0.25 %; a ping-pong ball through the air within 0.06 % of quadratic drag; jumps v²/2g; 1 kg on a
  spring scale 9.81 / 1.62 / 3.71 N; a space station and free fall; the ISS 92.84 min and 7.661 km/s against NASA's 92.9 min and 7.66 km/s, its radius
  held to 2.3·10⁻⁵ over 10 orbits, energy drift 1.3·10⁻¹⁰ an orbit; launch factors 0.7 / 1.2 (out to 2.5714 r, exact) / 1.40 / 1.42; Mercury 87.98 d and
  Earth 365.29 d against NASA's 87.97 and 365.26 (Kepler's ratio to 0.002 %); the Moon 27.29 d and 1.025 km/s; Io, Europa, Ganymede 1.769 / 3.553 /
  7.154 d; radial infall within 0.17 % of Kepler's free-fall time; the Earth-Moon barycentre still to 5·10⁻¹⁵ m; the phases in order, lit fraction
  (1 − cos E)/2 to 3·10⁻⁷; Austin's equinox noon 59.73°, 0.584 m, 9:00 1.297 m toward 297°, the solstices' noon shadows 0.120 / 1.362 m and days 13.95 /
  10.05 h); `python3 machines/test_space.py` 148 of 148; `node --no-warnings --test tooling/src/sim/space.test.ts` 9 of 9; `node --no-warnings
  tools/space/test.mjs --n 120` 35 of 35 (items.py == web/sim on 120 random scenes and the demos; the server's engine == the bundle byte for byte;
  summaries with every goal kind; the AI registry); `node --test web/ai/test/space.test.mjs` 5 of 5; a stability fuzz of 300 scenes of up to 12
  space bodies with props at their ends (absurd scales included): no exception, nothing non-finite, every run under 20 s on a machine at load 150-370; fuzz-live with this module (119 types: 760 cases,
  0 mismatches); `node tools/parity-engine.mjs --catalog` ALL IDENTICAL (137 scenes x 2 runs, node and Chromium); the 22 scenes byte-identical to the
  before-bundle (Python and web/sim; with `PLAYGROUND_MODULES=""` the catalog too); 12 demo scenes, every goal met in both engines with identical
  tracks; AI acceptance with real Opus 5.5 through a local server (`tools/space/ai-acceptance.mjs`): 8 of 8 (builds: the Moon round the Earth, the
  Apollo 15 drop, Newton's cannon (falls in / circles / escapes), a shadow stick through the day; edits: the other way round, the drop on Mars, the Earth
  half as heavy (honest ✗, fix found: launch the Moon at 0.8×, the change kept), the cannonball at 0.8× (honest ✗, fix found by the AI's rework: 77 cm
  higher, a 20 s run, the change kept)).

- Repairs after the third review (2026-10-20; these lines replace what the section above says where they differ):
  - A world's own air: the framework's new `settings.air_density` (kg/m³ with the air on; "Scene settings" above). Mars is
    `{gravity: "mars", air_density: 0.02}` (it was air off), Venus `{gravity: 8.87, air_density: 65}`, Jupiter's cloud tops 0.16, Saturn's 0.19,
    Neptune's 0.45 (NASA fact sheets; they kept a room's 1.2 before); the Moon, Mercury and Pluto stay airless. The inspector's Gravity menu sets
    them and has an Air density row; the how-to, plan and edit lines say them; `words.setting` says a change "air density 1.2 → 0.02 kg/m³ (Mars's
    thin air)". On Mars a 1 g craft feather from 2 m lands at 1.060 s, a golf ball at 1.040 s (1.038 s both with the air off); on Venus the feather
    (42 kg/m³) rises at 0.156 m/s, lighter than the air.
  - An ordinary moving thing in a space scene (orbit mode: no gravity but the bodies' pull, no air) is warned about before the run, once per item,
    through the framework's new `register_warning_hook` (items.py `WARNING_HOOKS`, web/sim/items.js the same): "no gravity in a space scene: Steel
    ball bearing floats and drifts toward Earth (a sun, planet, moon or satellite puts the scene in space; for a drop on a world, set the place's
    gravity without them)" (toward the heaviest pulling body; "floats where it is let go" when none pulls). The edit digest says it of the item too
    ("floats: … drifts toward Earth (1.79 m during the run) …"). The module's demo scenes warn nothing.
  - Edits: a speed change of an orbiting body ("make the Moon go 1.5 times faster") is that body's `orbit_factor` × the factor, never its primary's
    `mass_scale`, and its goal is rewritten to what the new speed does (1.5: `escapes`); the primary is made heavier (× factor²) only when the person
    asks to keep the same orbit. Bodies are proper nouns in the cards (`words.proper`: "the Earth", "the Moon", "Mars").
  - Checked: `node --no-warnings research/rw-validate-space-air.ts` 38 of 38 (Mars's air against quadratic drag's closed form: the feather 1.0604 s vs
    1.0605 s, the golf ball 0.11 %; the feather's terminal speed on Earth 1.5876 m/s exact; Venus's golf ball 0.11 %, the rising feather 0.001 %;
    Jupiter's ping-pong ball 0.05 %; the documents and refusals Python == JS; the warning, Python == JS on 14 scenes, the drift in the run, the digest
    line; the AI's words and prompt rules); fuzz-live with this module (121 types; settings now draw `air_density` too) 1962 cases, 0 mismatches;
    `tools/space/test.mjs --n 120` 49 of 49; `machines/test_space.py` 216 of 216; `research/rw-validate-plugins.ts` ALL PASS; web/ai tests (space,
    describe-run-names, fixer, edit-turns, solver, orchestrator) 162 of 162 and ai/test (schemas, digest, digest-tiers, edit-digest-modules, goals) 56
    of 56; the 22 scenes byte-identical to the before-bundle in web/sim and Python (with `PLAYGROUND_MODULES=""` the catalog too); the inspector in
    headless Chromium (Mars → air_density 0.02, Venus 65, the Moon air off with the row greyed, Earth clears both). AI acceptance with real Opus 5.5
    (port 8933): 4 of 4: "Make the Moon go 1.5 times faster" (orbit_factor 1 → 1.5, the goal now `escapes`, the Earth's mass untouched: "Done — the
    Moon escapes from Earth ✓"); "Do the same drop on Mars instead" (gravity 3.71 with Mars's thin air, the hammer and ball still land together); a
    feather and a golf ball on Mars built from words (air_density 0.02, "the golf ball lands just before the feather ✓"); a steel ball added beside the
    Earth model (the AI pinned it and said why: it would drift toward the Earth).
## Magnetism and static electricity (module `magnetism`, 2026-10-19)
Files: `machines/mod_magnetism.py` (catalog) = `web/sim/modules/magnetism.js` (its exact port, and its AI plug-in), `tooling/src/sim/modules/magnetism.ts`
(the engine process "magnetism"), `tooling/src/sim/magnetism.ts` (the fields: planck-free, its own `ln` and `atan`), `web/models/mod-magnetism.js` (3D
models, the field-line and battery view plug-ins). AI plug-in tests `web/ai/test/magnetism-plugin.test.mjs`, parity `tools/parity/magnetism.mjs` (+
`py_magnetism.py`, demos in `tools/parity/fixtures/magnetism-demos.json`), validation `research/rw-validate-magnetism.ts`.
- **Items** (category "Magnets & static"): permanent magnets `bar-magnet` (`material` ceramic B_r 0.39 T | alnico 1.25 T, 0.86 of it working | neodymium
  1.30 T; `length`, `width`, `depth`; `flip`; `show_field`), `horseshoe-magnet` (opening down, north on the left tip), `disc-magnet` (poles on its round
  faces), `ring-magnets` (`count` ferrite or neodymium rings on a dowel on a base; `alternate`: like faces together, they float), `magnet-cart` (the
  catalog's cart with a bar magnet on its deck at `magnet_end` front | back); soft iron and steel `paper-clip` (a row: `count`, `spacing`, `color`),
  `iron-nail`, `steel-washer`, `steel-can`, `can-on-side` (`material` steel | aluminium), `clip-on-thread` (a clip tied by `thread` to putty on the
  table), `battery-electromagnet` (a nail wound with `turns` of 24 AWG on `cells` AA cells, `on` from `on_at`, `flip`); not magnetic `plastic-clip`,
  `foil-ball`, `copper-wire`, `brass-key`, `wooden-bead`; `barrier-sheet` (upright `material` paper | cardboard | plastic | glass | aluminium | steel);
  `compass` (face-on: its needle turns in the picture's plane; `earth` 20 µT level, `north` right | left); static electricity `balloon` (`rubbed`
  strokes, −10 nC each up to −100 nC on its `rubbed_side`, `on_thread` from a hook, `thread`, `color`), `paper-bits` (`count` scraps, `size`, `paper`
  tissue | printer), `charged-rod` (plastic negative | glass positive, 7 nC a stroke), `pith-ball` (a light conductor on a thread). A magnet, the
  electromagnet or a rod held in mid-air (static) carries `stand: "post"` (a horseshoe on its left arm, which stops 0.3 mm under its bend): the view
  draws a retort stand behind it. Its looks and materials are made only under names nobody has made yet: `paper` (catalog_everyday's), `latex`,
  `copper`, `brass`, `foil` and `aluminium foil` stay as the catalogs or an earlier module made them, so loading the module changes no existing type,
  material or look (with it alone: the 113 types, 46 materials and 37 looks of the catalog unchanged, 11 materials and 7 looks added).
- **Document**: one record per magnetic or charged part in `doc.processes`, `{kind: "magnetism", id, item, role, ...}`: `magnet {solid, faces: [{x, y,
  z?, angle, width, depth, sigma}], round?, level?, center?}` (σ = ±B_r/µ0 on its pole faces; `level`: a ring on its dowel, pushed at `center`, never
  turned), `soft {solid, x, y, w, h, d, round?, volume, ms, chi, coil?: {turns, length, current?: [{t, amps}], reading?: {item, key}}}`, `earth {x, y}`
  (T), `charge {solid, x, y, q, radius, capacitance, conductor?, grounded?}`, `polar {solid, x, y, w, h, d, round?, volume, epsr}` (epsr 0: a
  conductor). The build hook gives every OTHER part of a magnetic material (the catalog's steel balls and weights, low-carbon steel, tinplate, nickel)
  a soft record when the scene has a magnet or a coil, and every metal part a polar record when it has a charge (not a part thinner than the
  records' 0.01 mm or of no area: too small to matter, and its record would be refused); a scene with none of them gets no record at all (the 22
  scenes are byte-identical). **Circuits hookup**: a coil's `reading: {item, key}` takes its current each step from another
  module's reading (`ctx.set(item, key, amps)`, e.g. a circuit's current through a coil part) instead of its own schedule.
- **Engine** (all the records of a run make one field, stepped by the first record's process; every pair reckoned once, its opposite force on the
  other at the same point, so momentum is kept): Gilbert's model. A face's field is the exact field of a uniformly charged rectangle (solid angle and
  logs); the force on a face is sampled at Gauss points (3 × 2, 5 × 3 near), past 3 reaches by its quadrupole, past 12 body sizes by dipoles. Soft
  iron is magnetized M = H/(N + 1/χ) toward the field, at most M_s, with Aharoni's prism factors: a ball as one piece, a flat sheet as a grid,
  anything else as a row (see Repair round 2 below), settled before the release (40 sweeps) and relaxed one sweep a step after. A magnet's pole faces are reckoned 0.7 mm (SKIN) out, their
  charge scaled to keep its moment, so two things resting on their contact skins (1.5 mm apart) pull nearly as touching ones do; a point just behind
  a face (within 3 SKIN) is taken in front of it. Turning is implicit (τ/(1 + |m||B| h²/I)); a pair of solids' pull on each other (all their
  pieces' pairs together) is capped at 50 × the lighter's weight, the same share off both. A coil adds n·I/length along its core. Charges: Coulomb with a core (a balloon's patch as a point a/√2 under it), induced
  dipoles p = αE (α = ε0 V/N, a conductor; (ε−1)/(1 + N(ε−1)) a dielectric), charge shared by capacitance on touching, a spark when the gap's field
  passes air's breakdown (Paschen). Readings (track.state[item]): `pull_mN`, `magnetized` (%), `amps`, `heading_deg` (a magnet's or needle's north end,
  ° counter-clockwise from +x), `charge_uC`. Events: a coil switched on or off, charge passed by a touch, a spark.
- **Goal kinds** (machines/mod_magnetism.py = web/sim, number for number): `attracts {source, item}` (starts more than 3 mm apart, then ends touching, within 3 mm, or ≥ 1 cm nearer),
  `repels {a, b, min_m? (0.01)}` (the gap's widest growth), `sticks {item, to}` (within 3 mm through the last 0.5 s), `lifts {source, item, min_m?
  (0.005)}` (rises and ends nearer), `points {compass, toward? | angle_deg?, tol_deg? (15)}`, `holds {magnet, count, items?}` (soft pieces hanging from
  it, touching nothing else), `levitates {item, count?, min_m?}` (rings' gaps ≥ 2 mm; else ≥ 1 cm off the table touching nothing). Subjects (what the
  make-it-work search tunes first): attracts and lifts the item and the source, sticks the item and `to`, repels both.
- **AI** (plugin in web/sim/modules/magnetism.js): a how-to (what is and is not magnetic, poles, strengths and reaches, carts, rings, the compass,
  the electromagnet's chain, static electricity), plan/edit/refine lines, 13 worked examples, one per lesson demo (G1-G7, G2 both ways, the
  electromagnet's turns, G11-G13, P3), knobs (magnet material, flip, sizes, ring alternate and thickness, cart magnet_end, turns, cells, on, balloon
  rubbed, rubbed_side and thread, the balloon's and the rod's height `y` in 2-10 mm steps, paper and scrap size, rod rubbed and material, clip
  thread, sheet material, compass north, can material; a scrap's pull grows as its size cubed (a conducting flake) and its weight as its size
  squared, so tissue lifts with about half the charge of printer paper and 3 mm scraps need about 1.4 times the charge of 6 mm ones), the edit digest's lines
  ("neodymium (NdFeB) magnet (B_r 1.3 T) | its north pole points right (0°) | at the end: clip touching", "NOT magnetic", "needle's red end ends
  pointing left (179°; north is right)", "charge -100 nC on its bottom side", "electromagnet: 200 turns on 2 AA cell(s), on, 5.0 A") and change words
  ("ceramic → neodymium magnet (about 11.1× the pull at contact)", "rubbed 10 → 2 times (−100 → −20 nC)", "50 → 200 turns of wire (3.1× the coil's
  field with 2 cells)").
- **View**: painted bar magnets (red N, blue S, letters; nickel neodymium with a red north end), a red alnico horseshoe with steel tips, discs, ferrite
  rings on a dowel, Gem clips, nails, the electromagnet's enamelled coil (as many layers as its turns need), washers, cans, foil, copper, a brass key,
  beads, sheets, a compass (case, dial, glass, red-and-white needle), latex balloons with minus signs on the rubbed side, pith balls, paper scraps, a
  rod with its signs. View plug-ins: "magnetism:field" (each magnet with `show_field`: field lines traced through every magnet's faces, five out of each
  north face and nested loops through the line across its middle, arrows north to south, on the HUD layer, redrawn when a magnet moves),
  "magnetism:battery" (each electromagnet's AA holder on what is under it, beside it and 1 cm behind the plane, with red and black leads to its coil's
  ends).
- Validated (`node --no-warnings --import ./tools/engine-math-node.mjs research/rw-validate-magnetism.ts all`: 79 checks, after repair round 2): ln and atan within 1 ulp of
  V8; the rectangle field = a 400² Coulomb integral (3e-6); Aharoni's factors (cube 1/3, the sum rule, = an independent volume average within 0.5 %);
  two N42 10 mm cubes = Akoun & Yonnet's closed form for the model at 1.5-40 mm (≤ 2.4 %) and for the real cubes at 3-8 cm (≤ 2.8 %), off axis too,
  resting on the skins 82 % of the touching pull; far pulls fall as z^-4.05 and equal 3µ0m²/(2πz⁴) (1.2 %); ΣF = 0 exactly; a steel ball = the
  induced-dipole law (≤ 1.4 %); a soft rod = the converged volume-integral solve (≤ 3 %, the row model); a nail end-on to a pole pulls 0.97-1.11 × the
  converged 120-cell solve (2-20 mm); G3 non-magnetic things exactly unmoved; G4 the pull through paper, cardboard, plastic, glass, aluminium identical
  to none (a 0.5 mm steel sheet cuts it 88 % from a ceramic pole, 55 % from a neodymium one); G1 the clip jumps where its static pull passes its weight (ceramic 16 mm, neodymium 28 mm: it jumps from 3 cm); G6 ring gaps within
  30 % of the dipole equilibrium; G7 north 0.03°, over the bar 179°; Coulomb exact; a conducting ball = 2kq²R³/r⁵; the coil's current = Ohm's law with
  84.2 mΩ/m and 0.2 Ω cells; 10/50/200 turns hold 1/2/3 clips; chains against a converged solve of the whole chain; the other modules' steel, metals and dielectrics; the 20 demos; 30 random scenes with no NaN, nothing over 15 m/s, the same twice. Both
  engines: the 20 demos, server and bundle, documents and tracks byte for byte, every expected outcome. Parity (`tools/parity/magnetism.mjs`): 23
  catalog entries and previews, 414 random scenes' documents byte for byte, 54 engine runs node == bundle, their summaries Python == JS. Crash fuzz
  (`PLAYGROUND_MODULES=magnetism node --no-warnings tools/parity/engine-fuzz.mjs --n 1500 --seed 777`): 1500 random scenes, 0 exceptions, 0
  non-finite, 0 refused on admission. AI acceptance
  on the real app with Claude Opus 5.5, four runs: Build with AI 12/12 (a clip jumping to a magnet, carts that repel, a balloon lifting paper: goals
  met); Edit with AI 11/12 (an exact change and an honest card each; every edit broke a goal and got a checked fix found by the module's knobs: the
  other cart turned around, a longer magnet, the balloon lowered 4 mm). The one miss (2026-10-20, run 3): "rub the balloon only 2 times" found no
  fix once the search kept the person's 2 strokes (it had offered 2 → 4 before); the balloon's height knob (`y`, mm steps) fixed it: run 4 3/3.
- Known limits: the machine is a 2D slice (a compass's needle turns in the picture's plane, field lines are drawn in it); a row's end pieces' coarse
  charges overstate a contact between soft bodies up to 1.5-2 × (chains hold a little more than a converged solve); a sheet's grid has no
  coupling between its pieces' different directions of magnetization (a little less shielding than a converged sheet); a thin steel sheet near a
  strong pole saturates (partial shielding, as a real one does); a dielectric ping-pong ball is pulled only from a few mm (a real one in humid air
  may conduct a little); no eddy currents, no hysteresis (soft iron keeps no magnetism), charge does not leak away
  during a run. The circuits module has no coil part: `battery-electromagnet` has its own AA cells and is switched with `on` / `on_at`; it cannot
  be wired into a circuit with a switch or a meter (a coil record's `coil.reading` is there for a module that adds such a part).
- **Repair (2026-10-20, after verify)**: (1) `ring-magnets`' dowel is at least 3 mm wide (`max(0.003, hole − 2 × 2.5 mm)`, both ports): a hole at
  its 5 mm least once gave a dowel 0 m wide, a slab with no sides, and Python's overlap check divided by zero (server 500) where web/sim built the
  scene. Under an 8 mm hole the clearance is less than 2.5 mm a side; the rings still float (5-9 mm holes, ferrite 15 and 25 mm, all levitate).
  The overlap depth itself now passes over a side of no length (`machines/rube.py` = `web/sim/rube.js` and `machines/items.py` = `web/sim/items.js`
  `_overlap_depth`: no direction to test; no side at all, two points: 0), so a degenerate slab or a polygon with repeated corners can never make
  Python and JavaScript disagree (4000 random degenerate pairs: identical; scenes that do not have one are unchanged). `tools/parity/magnetism.mjs`
  builds every magnetism type with all its numbers at their least and at their most among a box, a ball and a can (`py_magnetism.py` reports any
  other exception instead of losing the run). (2) The AI: "Flip the held magnet around so the boat is pushed away" kept its old goal ("pulls the
  boat toward it") while the card said the goals changed, and the fix offered was turning the magnet back. `repels` gained the aliases
  `pushed_away`, `pushes_away`, `push_away`, `pushed_apart`, `attracts` `pulled_toward`, `pulls_toward`, `pulled_closer`, `drawn_to`; `words.outcomes`
  ("push… away", "pull… closer", "jump up", "pick… up", "snap together", "swing apart"); `words.keys` for every magnet's `flip`, the rings'
  `alternate`, a cart's `magnet_end`, the electromagnet's `on`, `turns`, `cells`, a balloon's or rod's `rubbed`, a balloon's `rubbed_side` and
  `on_thread`, a compass's `north` and `earth`, paper scraps' `paper`. Framework (small, locked edits): `web/sim/plugins.js` `outcomeWords()` (every
  module goal kind and alias, "_" a space, and each module's `words.outcomes`, as one alternation) and `web/ai/orchestrator.js`
  `statesModuleOutcome(text)` (an outcome in those words after "so", "until" or "make sure": "so the boat is pushed away", "so the ice melts first"),
  which lets an edit change the goals (`goalsAsked`) and nothing else statesOutcome decides; `choicesOf` holds a module's switch the words name
  (a bool: "flip the held magnet", "put the cap on") and a choice said by the very value it now has ("pour honey") as the person's own (`hard`), so
  no fix or rework turns it back. Checked with the edit step mocked (`node --no-warnings <scratch>/x2-flow.mjs`): the goals become the AI's (`repels`),
  `hard` holds `held-magnet: flip`, and the fix found is "move the tank of water 1 cm left" with both goals met and the held magnet still flipped.
  On the real app (headless, Claude Opus 5.5 edit step, the X2 scene): the goals became "floats" + `repels {held-magnet, boat}` ("set the goal to the
  boat being pushed away instead of pulled"; "No longer checked: The held magnet pulls the boat toward it"), the fix offered "Make the magnet on the
  deck thicker (1.2 → 1.7 cm)", both goals met with the held magnet still flipped; "Turn the held magnet around." alone kept the pull goal and
  offered "Turn the magnet on the deck around…" (met, held magnet still flipped). (3) A goal kind may say `compares: false` (`repels` does): its a
  and b act on each other, so `web/ai/fixer.js`'s fair-test rule (a setting two compared things share is held equal) does not hold their shared
  `flip`: two carts with unlike poles facing are fixed by turning one cart's magnet around again (`web/ai/test/magnetism-plugin.test.mjs`, 11/11).

- **Repair round 2 (2026-10-20, after the second verify)**: (1) **Compass**: its needle is always dynamic (a held, `fixed` compass's needle turns:
  only its foot is fixed), starts pointing north (`north: left` turns it 180°), and its magnet record carries `needle: true`: the engine turns a
  needle within 5° of pointing exactly against the field at it (an unstable balance a deterministic run would never leave) as one 5° off would be
  (`needleKick`), so a bar flipped level with a compass swings its needle round (180° in about 2 s). (2) **Soft iron, rows**: a soft body that is not
  a ball or a sheet is solved as a row: 24 cells of a Chebyshev partition (fine at its ends) spanning its faces (the body and a skin at each end),
  with the exact mutual factors of coaxial prisms (F(ℓ) = ℓ·S(ℓ), N = [F(a+g+b) − F(a+g) − F(b+g) + F(g)]/(2a)) and precomputed inverses, the field
  sampled at its pieces' Gauss points and interpolated; its forces from 4 coarse pieces (two end pieces about as long as it is thick, which take
  their outermost cell's magnetization, and two halves). A nail's and a clip's moment in a uniform field = the 120-cell volume-integral solve within 3 %
  (4 equal pieces took 0.56 and 0.49 of it). Two rows touching end-on and lined up (within 3 mm, 25°) are **linked**: each row's cells take the other
  row's pieces' field with the exact coaxial factors (the larger section's, the smaller's share for the larger), not sampled (a 1 mm end face 0.1 mm
  away), cached by the gap to 0.1 µm. Against a converged solve of the whole chain (1 mm cells): 2 and 4 clips in a uniform field within 3 %; the
  electromagnet's nail and its first two clips at 10, 50, 200 turns within 15 %; the first clip's pull 0.8-1.5 × (the end pieces' coarse charges
  overstate a contact). On 2 AA, 10, 50 and 200 turns now hold 1, 2 and 3 clips of a chain (the converged solve: 1, 2, 2-3; a classroom's 5-15 is
  a bunch picked up from a pile, which no single chain holds). (3) **Sheets**: a flat soft body of sheet metal (at most 5 mm thick, thinner than 0.2
  of its length and of its depth, both at least 4 cm: the barrier sheet, a tray; a 12 mm beam or post is a row) is a grid of about 8.3 mm pieces
  (at most 12 × 12; all the sheets of a run at most 200 pieces together, coarser alike past that) along its length and across the plane, each
  magnetized in all three directions (pieces across the plane have faces normal to z; their mutual factors from the blocks' self factors), its
  factors for its steel's own thickness (0.5 mm in a 1 mm body: a thin sheet's pull along itself grows as it thins), reckoned as dipoles past 4
  reaches. A 0.5 mm steel sheet 8 mm from a 15 cm bar's pole cuts the pull on a clip 15 mm from the pole by 88 % (ceramic) and 55 % (neodymium: it
  saturates where the pole faces it), was 17 %; a clip 8 mm behind it stays put (ceramic). (4) **Materials**: `SOFT` also has the other modules'
  `density set steel`, `cast iron` (µ0·M_s 1.6 T, χ 300 [ASM-CI]), `spring bumper` and `steel wool` (its wire's share of the pad: density ÷ 7850
  times M_s and χ); not `stainless steel` (austenitic) nor `magnet bumper` (a magnet, its poles not set). `CONDUCTORS` also has those and
  `copper-plated zinc`, `stainless steel`, `density set aluminium/brass/copper/zinc`, `can aluminium`, `spacecraft aluminium`, `graphite`.
  (5) **Dielectrics**: with a charge in the scene every light part that is not metal (under 50 g, no size over 30 cm, free to move) gets a `polar`
  record with ε_r from `DIELECTRIC` (cellulose 4.5 at 1.5 g/cm³ for paper and wood, keratin 3.5, plastics 2.2-3.8, rubber 2.7, glass 6.5, water 80,
  ice 90, others 3 [CRC-EPS] [TORG] [WATER] [ICE]), thinned by the air in it (ε = 1 + (ε_s − 1)·ρ/ρ_s [SIHVOLA]); a hollow ball (a ping-pong ball, a
  balloon) as the thin shell is polarized (α = ε0·V_shell·(ε−1)(2ε+1)/(3ε) [JACKSON §4.4]). A ping-pong ball rolls to a rubbed balloon from about
  5 mm. (6) **Reach**: a fixed part of iron or steel in a scene whose magnets and coils are all fixed gets its
  soft record only where one of them could reach it (its strongest dipole field, µ0·m/(2π r³), over 2 µT at the part's nearest: a 15 cm
  neodymium bar 1.4 m, a ceramic one 0.95 m); anything that can move, or near a magnet that can, keeps its record wherever it starts. A soft
  record of the build hook says `grid: false` where no magnet's or coil's strongest field reaches 1 mT at the start (18 cm from a 15 cm
  neodymium bar): sheet metal there is a row, not a grid (a steel bucket across the room took a fuzz scene from 3 s to 36 s). (7) A pair of solids' pull is capped together (the sum of their
  pieces' pairs, 50 × weight), not each piece pair: a clip of four pieces at a pole had four times the cap and bounced on the pole every step.
  (8) **Goal kind** `not_attracted {source, item, max_m? (0.003)}` (aliases not_pulled, not_picked_up, unmoved_by...): the item never comes more than
  max_m nearer the source all run; the plan prompt asks for one per test object that must not be pulled (the plastic clip, the unrubbed balloon's
  scraps). (9) **AI**: every example has its `how` (the digest lists an example by it; a plan-only example is now rendered in one line,
  ai/catalog-digest.mjs `moduleExamples`); ai/schemas.mjs tidyGoals no longer turns a one-entry `items` into `item` for a module kind without an
  `item` field (`holds {magnet, count, items: [chain]}` was refused in every plan); web/ai/orchestrator.js statesModuleOutcome also reads "the
  nail should be pulled too", and `ownOutcome` counts a module's outcome words (a compass goal's 0° may become 180° with "the needle should turn
  around"); `words.keys` for a flip read "turn the magnet at the end of the tank around", "the same poles face"; the edit prompt
  rewrites attracts as repels when a flip makes like poles face; ai/rich-digest.mjs says a thing on a thread "hanging on a thread" and a set-of
  type "a set of scraps" ("2 sets of scraps", never "scrapses"). New demos: `g4b-steel-blocks`, `g7b-compass-flip-level`,
  `g7c-compass-north-left`, `g11b-balloon-control`, `g13b-ping-pong`, `g3b-density-cubes`; `em1-turns` holds 1, 2, 3. Checked: the validator 79/79,
  `tools/parity/magnetism.mjs` (300 random scenes with the other modules' steel, metals and dielectrics, every goal kind) Python == JS and node ==
  bundle, the 23 scenes byte-identical with no modules and with them (only zz-catalog differs), real Opus 5.5 builds 4/4 and edits 3/3
  (ai/DESIGN.md §20).

## Heat and temperature (module `heat`, 2026-10-19): melting ice and salt, lamps, hot plates, thermometers, insulation, boiling, evaporation, dew
Files: `machines/mod_heat.py` (catalog, goal kinds, the build hook), `web/sim/modules/heat.js` (its exact port) + `web/sim/modules/heat-ai.js` (the AI
plug-in, made by heat.js), `tooling/src/sim/heat-data.ts` (constants, tables, materials, each cited), `tooling/src/sim/heat.ts` (the heat world;
`heat.test.ts` its unit tests), `tooling/src/sim/modules/heat.ts` (the process kind "heat"), `web/models/mod-heat.js` (models, frame hooks, three view
plugins). Nothing of it runs in a scene without a heat item, a non-standard room temperature or a time-lapse (the 22 scenes are byte-identical,
`identity.mjs`; the catalog differs only by its own 11 types, its materials and looks, category "Heat & temperature", and the additions below).
- **Settings** (scene.settings, items.py STANDARD_SETTINGS): `room_temp` (°C, −60…60, standard 20: a classroom is 22) and `time_lapse` (lesson seconds
  per run second, 1…100000). Motion stays real time; the heat runs on lesson time: every process beat (8 engine steps) advances the heat by
  8 × STEP × time_lapse lesson seconds in sub-steps of at most 2 s (at most 64 a beat: a time-lapse over 7680 lengthens them; each exchange stays
  exact). Goals' times are lesson time (run t × time_lapse): `by_min` / `at_min` in minutes (what the AI writes), or `before_s` / `at_s` in seconds. With time_lapse > 1 the view shows a clock
  (`⏱ h:mm:ss · room 22 °C`, view plugin `heat-clock`).
- **Items** (sources in each type's `source`): `salt-pile` (`mass_g` 0.2-30 table salt, `grain` table | coarse (dissolves 3 × slower); a cone at the
  angle of repose 33°, anchor its foot: put it ON an ice cube), `plate` (`diameter`, `material` ceramic | glass | melamine | aluminium | foam |
  paperboard, `color`: a base slab of cells and welded rims, a 4 mm air gap under its foot ring), `bowl` (`diameter`, `height`, `material`, `color`),
  `lamp` (desk lamp, static: `bulb` incandescent | halogen | led (0.8, 0.8, 0.35 of `power_w` as light and heat), `power_w` 5-150, `on`, `on_at`,
  `aim`, `beam_angle` 40-140°, `head_height`; link `target`: it aims at it), `thermometer` (`style` glass (8 s in water, 60 s in air) | digital (3 s /
  30 s), `units` C | F; anchor: its bulb, the bottom end), `hot-plate` (static, `power_w` 100-1500, `setpoint_c` 20-550 with a ±5 K thermostat, `on`,
  `on_at`; glows above ~500 °C), `saucepan` (stainless, `diameter`, `height`, `water_ml`, `water_temp_c`, `salt_g`, `lid`), `drink-cup` (`style` foam |
  paper | plastic | glass | steel | mug | flask, `water_ml`, `water_temp_c`, `lid`, `color`), `spoon` (`material` stainless steel | aluminium | copper |
  polypropylene | varnished hardwood, `length`; its bowl at its left end), `meltable` (butter 33 °C | chocolate 34 °C | wax 58 °C, sizes,
  `start_temp_c`), `puddle` (`water_ml`, `water_temp_c`: 1.5 mm deep). Added to existing types: `ice-cube` `start_temp_c` (−18, −30…0) and readouts
  `temp`, `melted`, `puddle_g`; `steel-rod` materials copper, stainless steel, glass; rods' readouts `temp0`, `temp7`; a fluids container's water is
  heat's water at its `water_temp_c`.
- **Document**: `doc.processes` records `{kind: "heat", id, item, role, solid, …, name?}` (`name`: its item's, when it has one), role `body` (`start`, `cells`, `profile`, `retain`, `standoff`,
  `absorptivity`, `liquid`, `ice`, `wet`, `with` (welded walls), `pool`), `water` (`frame: "world"` for a fluids container, `x0 x1 y0 y1 depth round`,
  `liquid` kg, `ice`, `salt`, `start`, `lid`, `wall`, `wallMaterial`), `sensor` (`capacity`, `area`, `size`, `resistance`), `lamp` (`at`, `dir`,
  `spread`, `power`, `from`), `heater` (`power`, `setpoint`, `from`, `until`), `salt` (`mass`, `rate`), `sun`, `enclosure`, `room`; `doc.settings`
  `{roomTemperature, timeLapse}` only when not standard. A build hook (`register_build_hook`) adds the ice cubes', rods' and fluids containers' records.
- **Physics** (`heat.ts`, one heat world per run for all records): lumped nodes (one per weld group; a plate, spoon or rod a chain of ~1 cm cells,
  wide chains split in an inner and an outer band) with an enthalpy each, H = C·T + m_s c_s T + m_l (c_l T + L′) [CRC: L_f 333.55 kJ/kg, c 2050 / 4184];
  solved per pair exactly (exponential exchange; unconditionally stable, energy-exact). Contact conduction A/(t_a/2k_a + t_b/2k_b + R_c) (R_c 5e-4 dry,
  5e-5 wet m²K/W) over the touching length × depth, split across a chain's cells; natural convection (Holman's simplified air correlations, the
  ¼ power), forced by the engine's air (3.97 √(v/L)), mixed by Churchill–Usagi; radiation ε σ A (T⁴ − T_room⁴) linearised per beat; evaporation and dew
  by Chilton–Colburn from the convection (still-air floor 5.3 W/m²K: Carrier's equation [ASHRAE]); boiling at 100 °C + K_b·i·b with the steam leaving;
  melting and freezing by the enthalpy (ice, butter, chocolate, wax); salt: a pile dissolves first-order into the melt water it touches (solubility
  0.359 kg/kg, heat of solution 3.88 kJ/mol), the brine freezing at the CRC curve to the eutectic −21.1 °C at 23.3 %; melt water beyond a film
  (0.3 mm) and what the support holds (2 mm plate, 5 mm bowl) drains to a puddle node that spreads 1.5 mm deep and, drying, keeps its edge pinned
  (constant area) until 0.2 mm thin [Picknett & Bexon 1977]; a melting body shrinks as the cube root of its ice (resized on 0.5 mm or 1 %); lamps: a
  cone with a soft edge, 1/r², blocked by anything in between, absorbed by colour (0.2 white … 0.97 black [INC A.12]); hot plates; thermometers lag
  through their own resistance and read what their bulb is in or touches, else the air around (the air in a pot over boiling water is steam at the
  water's temperature; over hot or cold water halfway to the room, provisional); a lid keeps the steam (no water lost) and passes heat through its
  own wall. A cube under 1 mm is gone: its last crumb joins its puddle, heat for heat; a puddle's last 0.01 g dries at once. A ledger books every joule (sources, room, vapour, chemistry, spills): `imbalance()` is ~1e-13 of what moved.
- **Readings** (`track.state`): ice-cube/meltable `temp`, `melted` (0-1), `puddle_g`, `puddle_temp`, `liquid_g`, `brine_g`, `scale`, `wet_g`;
  plate/bowl `temp`, `temp_min`, `temp_max`; rods and spoons `temp0`…`temp7`; drink-cup/saucepan/fluids container `water_temp`, `water_g`, `ice_g`,
  `level`, `boiled_g`, `boiling`, `temp` (wall); thermometer `reading` (°C); salt-pile `salt_g`, `temp`; hot-plate `temp`, `power`, `on`; lamp `on`;
  puddle `liquid_g`, `temp`. Events, by the item's name when it has one (records carry `name`): "Salted ice cube melted completely", "the salt pile
  dissolved", "the water in Pot boils", "water condenses on Glass of ice water" (not for frost on ice), "Lit puddle dried up", "… spilled".
- **Goals** (Python == JS; `T` = `by_min` (lesson minutes) or `before_s` (lesson seconds), `A` = `at_min` or `at_s`): `melts {item, T?}`,
  `melts_first {a, b}` (a fully melted before b, or more melted by the end), `melt_fraction {item, at_least?, at_most?, A?}`, `reaches {item,
  at_least_c? | at_most_c?, T?}` (a thermometer's reading, else the item's temperature or water's), `warmer {a, b, A?}` (by 0.5 °C), `boils {item, T?}`,
  `freezes {item, T?}`, `dries {item, T?}` (a puddle, a melted cube's puddle, or a cup's or pan's water, under 0.05 g), `dew {item}` (≥ 0.05 g).
- **AI** (`plugin`, web/sim/modules/heat-ai.js): its how-to (time-lapse and how long things take; ice ON plates or IN bowls, salt ON the cube; lamps
  aimed by `target`; thermometers fixed inside what they read; hot plates, pots, cups; conduction; the readings), plan / edit / refine lines, 12
  worked examples (one per lesson demo), the 9 goal kinds with aliases ("melts_before", "hotter", "evaporates", "sweats"…), knobs for the make-it-work
  search (salt mass and grain; cube size and start temperature; the lamp's target (a link), power, bulb and head height; plate and bowl material; the
  hot plate's power and setpoint; a pan's water and lid; a cup's style, lid, water and temperature; spoon, rod and meltable material; a puddle's
  water), digest lines (when a cube melted, its lowest temperature and puddle, % melted at 10/30/60 min; the salt left; a lamp's W into its beam,
  its distance and W/m² at its target; a thermometer's reading; a cup's or pan's water and boiling; a plate's coldest spot; a rod's ends), change words
  ("salt 3 → 6 g", "incandescent → led bulb", "lamp aimed at A → B", "lid off → on"; an ice cube's sides in the catalog's own words with
  its weight, "width 4 → 8 cm; height 4 → 8 cm; 59 g → 470 g"), placement
  (`place.containers` bowl, drink-cup, saucepan; `place.inside`; `place.interior`). Lesson time on the card: `plugin.clock`.
- **View** (`web/models/mod-heat.js`): glazed plates and bowls (lathe), a salt cone of grains, an articulated desk lamp with a glowing bulb (`heat:bulb`) and
  a real spot light with shadows on its target while on (`heat-lamps`), glass thermometers with a red column (`heat:column`) and digital probes with
  an LCD (`heat:lcd`, °C/°F), a hot plate whose top glows by Draper's colours (`heat:glow`), a pilot light, pans and cups (foam, paper, plastic,
  glass, steel, mug, flask) with water whose top follows `level` (`heat:water`), bubbles while boiling (`heat:bubbles`), steam (`heat:steam`), dew on
  the outside (`heat:dew`), spoons, butter/chocolate/wax, puddles; melt water spreading under each melting cube and drying with its edge pinned
  (`heat-puddles`); the clock (`heat-clock`).
- **Validated** (`node --no-warnings --import ./tools/engine-math-node.mjs research/rw-validate-thermal.ts [data|melt|salt|lamp|water|cups|conduction|
  sensor|energy|fuzz|all]`, 82 checks, ALL PASS): saturation vapour pressure vs the steam tables (2333 Pa at 20 °C vs 2339; 12361 vs 12352 at
  50 °C), the dew point of 22 °C / 50 % air 11.10 °C (11.1), salt water's freezing points (CRC 5-25 %: −3.05 … −21.10 °C, exact), 80 °C water's evaporation
  1.804 g/(m²s) (Carrier 1.803); T1 a 4 cm cube on a ceramic plate at 22 °C melts in 87.5 min (spec model 110, range 80-150), 43 % at 30 min, 84 % at
  60 min, from −18 °C +8.6 %; 2.5 cm 48.8 min, 5 cm 118.8 min; aluminium plate 33.8 min, foam 45 % at 60 min; T3 1 g of salt on a 5 cm cube 3.0 %
  sooner, 6 g 11.9 %, the brine down to −17.4 °C; T2 a small plain cube (31.3 min) before a big salted one (73.8); T5 a 60 W lamp 10.7 % sooner, T6 a 9 W
  LED 0.7 %; a black plate warms 3.18 × a white one; 1 L on a 600 W plate boils in 13.8 min, 833 g/h boils away (87 % of 600 W), a plateau at
  99.7-99.9 °C, no loss with the lid; 100 g salt in 1 kg boils at 101.75 °C; a cup freezes in a −18 °C room holding 0 °C while it does; after 20 min a
  flask 79.6 °C, foam with a lid 63.9, paper 48.1; an open cup loses 35 % of its heat by evaporation; a flask keeps 450 mL of 95 °C water at 80.4 °C
  after 6 h (spec ≥ 70, typical 75); dew on a cold glass 0.33 g, none at 20 °C; spoon handles copper 58.9 > aluminium 55.5 > stainless 29.9 > wood 22.0 °C;
  butter on copper melts at 6.6 min, never on stainless; a glass thermometer's 63 % time 7.7 s (typical 8); energy closes to 1e-12; deterministic;
  120 fuzz scenes (every heat type at random, time-lapse 1-100000, rooms −40-50 °C) clean: no exception, every reading finite, the books closing
  to 1e-10 at worst, none over 20 s.
- **Demos** (`tools/parity/fixtures/heat-demos.json`, 12 scenes; both engines the same document and track byte for byte, Python and web/sim summaries
  equal, every goal met): salt on one of two 4 cm cubes (72 vs 95 min), size beats salt (33 vs 77 min), a lamp on one cube (71 vs 78 min), LED vs
  incandescent, aluminium / ceramic / foam plates (38 min, 95 min, 83 % by 2.5 h), four cups after 24 min (foam + lid 61.3 °C, steel 51.1, mug 48.2,
  paper 44.7), a pot boils at 7.6 min with the thermometer at 100 °C, metal vs wooden spoon, a puddle under a lamp dries in 4.8 h (the shaded one keeps 3.8 g of
  its 10 at 8 h), dew on a glass of ice water, a thermometer settling in 40 °C water, butter on copper vs steel rods.
- **AI acceptance** (the real app on its own server, headless Chromium, real Opus 5.5 calls through the app's AI panel, `scratchpad
  engine4/thermal/accept.mjs`): Build with AI, the three lesson demos as a teacher asks them (salt on one of two cubes on white plates; a big and a
  small cube; a desk lamp on one of two cubes); Edit with AI on the demo scenes ("use twice as much salt": exactly "salt 6 → 12 g", the race still
  won; "make the salted cube twice as big, 8 cm": exactly "width 4 → 8 cm; height 4 → 8 cm; 59 g → 470 g", the card says the race is now lost "(88 % melted
  by the end vs melted at 1 h 35 min, lesson time)" and offers a checked fix through the module's knobs (the plain cube's plate ceramic → foam),
  applied: ✓; "swap the lamp's bulb for an LED": exactly "incandescent → led bulb", still ✓). Run 1: 5/6 (a build wrote `before_s: 8` meaning run
  seconds; the goal fields became lesson minutes, `by_min` / `at_min`, with `before_s` / `at_s` still read); runs 2 and 3: 6/6 each (35-115 s
  a request), the builds choosing room 22 °C, time-lapse 600-900 and `by_min` deadlines themselves. Run 4 (20 Oct, every module in): builds 3/3,
  edits 1/3: two edits answered "the salt pile is not a kind I can edit": the shared digest cache (ai/.cache/catalog-digest.json) had been
  rewritten by a test process run with PLAYGROUND_MODULES (289 types, no heat), and its key (the web/sim files) did not tell the two apart; a
  process with only some modules now keeps its digest in a file of its own (`ai/.cache/catalog-digest.only-<hash>.json`), its key naming them. Runs 5 and 6 (edits): 3/3 each. In all: builds 11/12, edits
  16/18 (both misses that stale cache).
  A new plug-in point: a goal kind's `detail(entry)` gives the card its words for the result (web/ai/goals.js and ai/goals.mjs use it when present):
  heat's say times on the lesson clock ("melted at 1 h 14 min vs 1 h 35 min, lesson time", "61.3 vs 51.1 °C").
- **Parity**: `node tools/parity/heat.mjs [--n 500] [--engine 48]` (in `tools/parity/run.sh`): the 14 heat catalog entries equal; 512 random heat scenes
  (every type, random props, settings, ice cubes, rods, a fluids tank) build the same document, resolved props and warnings in Python and web/sim;
  48 of them run byte for byte the same in the node engine and the browser bundle; their summaries equal.
- **Known limits**: 2D heat on the side outline × depth (a cube's faces front and back are counted as open sides); lumped bodies except the cell chains
  (a cube's inside is one temperature); salt's brine is uniform within a cube's film and puddle; dew forms only on bodies (not on water); the air in the
  room is one temperature and humidity (50 %) besides enclosures, lamps' beams and the inside of vessels; steam is not drawn as moving air; boiling has
  no superheat; a puddle is a disc of fixed depth while it grows. Provisional values are marked so in heat-data.ts (contact resistance, film and
  retention depths, the puddle's pinning depth, the salt dissolving rate, the vessel's inside air). Speed: plates and spoons are chains of cells
  (a scene of two plates and two cubes runs 1-3 s on a laptop at time-lapse 600, 15 s).

### Heat repair (2026-10-20): work into heat, candles, traced light, liquids that move, sand, solids that expand, the clock in the frame
These lines add to the section above (and replace it where they differ). Scenes without heat are unchanged (the 22 scenes byte-identical, with and
without modules; the catalog grows by the types and props below).
- **Friction and impacts warm things** (`heat.ts` `rub`, `touch`; the first heat record's process gets `after` and `contact` hooks): after every
  (sub-)step each contact a heat body takes part in gives |tangent impulse| × its mean slip over the step (the slip met before the solve and after it)
  as heat; as a contact begins, the impact's lost kinetic energy ½·m_eff·v_n²·(1 − e²) (m_eff along the normal at the contact points' middle; e only
  past the engine's 0.2 m/s threshold; approaches under 5 cm/s are contact jitter). Half to each side; a fixed solid's half goes to the room. Booked
  in the ledger's `work`; reading `work_j` (J it took in, from 1 mJ). Honest sizes [thermal spec §3]: a `sanding-block` rubbed 10 s at 5 N and 0.5 m/s
  takes 7.7 J and warms +0.10 °C; pressed 10 N, 1.6 × the work; a 1 kg steel weight dropped 1 m takes 5.2 J (half its 9.8 J), +0.011 °C; a resting
  block takes nothing.
- **Candles** (the everyday `candle` gains `lit` (false) and `lit_at`, catalog-wide props of the candle alone (`COMMON_PROPS`, `common: true` in
  the catalog, never built unless an item sets them; `register_catalog_wide` gives them, and the build hook, to a harness's everyday port), readouts
  `flame`, `burned_g`, `temp`): a record `{role: "flame", solid, at
  (the wick's top), power 80, burn 1.66667e-6 kg/s, from}` [NIST-CANDLE: Hamins et al. 2005, about 80 W, 0.1 g of paraffin a minute at 46 kJ/g].
  Its wax burns away on the lesson clock (the candle shrinks, rebuilt every 0.15 % of its mass, so a kitchen scale under it reads less); 75 % of its
  power rises in a plume (Heskestad's plume [SFPE]: ΔT0 = 9.1·(T∞/(g·c_p²·ρ²))^⅓·Qc^⅔·z^(−5/3), u0 = 3.4·(g/(c_p·ρ·T∞))^⅓·Qc^⅓·z^(−⅓), half-width
  0.12·(T0/T∞)^½·z, capped 900 K) that heats what stands over it, lowest first (forced convection at u0 over the part of its underside in the plume, a
  link to the gas at T∞ + ΔT0/2, until the plume's 60 W are used or something wide stops it) and a thermometer's bulb held in it (the plume's own
  gas and speed at the bulb); 20 % leaves as radiation (heat's own 1/r² estimate, or the optics module's tracing: with optics loaded the candle's
  solid carries a `light` source, 12.6 lm (1 cd) and 16 W of infrared, every way, `drive` its `flame` reading; only when the scene has an optics item, so a candle with no lens or mirror near it
  traces nothing). It goes out: in a `candle-jar` (an
  upside-down glass jar, `volume_ml` 250-4000; record `{role: "jar", solid, x0 x1 y0 y1, volume}`, reading `o2_pct`) when its air's oxygen falls to
  16 % (3.45 g of oxygen a gram of wax; air 20.95 %: a 1 L jar in 11.5 s, 2 L in 23 s), when its wax is gone, tipped over, or in a vacuum. Events:
  "Covered candle is lit", "… went out: the oxygen in the jar's air fell to 16.0 % (air is 20.9 %; a candle flame needs about 16 %)". Goal
  `burns_out {item, jar?, by_min? | before_s?}` (`jar` names the jar, so the fix search may change it too). The jar is mouth down: put it and its candle `on: table` at the same x (not `inside`).
- **Light the optics module traces heats** (`heat.ts` `traced`, through `opticsOf(scene)`): every opaque body optics traces takes the light that
  lands on it (its deposits' `incident`, all sources: lamps, the sun, flashlights, flames, through lenses, off mirrors and foil, through clear glass)
  times heat's own absorptivity (Incropera A.12: white paint 0.2 … black 0.97; the tracer's own 1 − reflectance would make a white glaze take a
  tenth of a lamp's infrared). Clear bodies (ice, water, glass: optics role `glass`) keep heat's own estimate: the tracer gives a body of the glass
  role the whole height of a beam out of the plane rather than the share its depth catches (a 4 cm ice cube 34 cm from a lamp would take 12 × its
  light: an optics-side limit, reported to its owner), and water, puddles and thermometers' bulbs keep heat's own too. Without optics (or before
  its first trace) heat's own estimate holds for everything, and clear solids in the way now pass their share (heat-data `TRANSMITTANCE`: glass,
  optical glass 0.92; PET, bag film 0.9; acrylic 0.92) instead of blocking: an ice cube under a clear jar gets 92 % of a lamp's heat. A focus (many
  bent or turned rays, ≥ 8, in 4 mm of a face) is a hot spot: its power on a spot of its rays' spread (0.5-2 mm radius), conducted into the sheet
  (a sheet of paper at its real thickness, its mass over 800 kg/m³: `sheet`) and lost from both faces, reached over the spot's own time constant;
  readings `spot_temp`, `spot_x`, `spot_y`, `scorched` (paper 233 °C, card 260, wood 300: heat-data `SCORCH`); event "… scorches where the light is
  focused"; goal `scorches {item, by_min? | before_s?}`. A 5 cm lens (f 10 cm) in sunlight on paper: 922 °C at its focus within 0.5 s; plain sun
  makes no spot; foil beside chocolate in the sun: 60 % more light, warmer by 4 °C.
- **Liquids that move, other liquids, sand**: flow's `pitcher` and `tap` gain `temp_c` (their liquid's, the room's when not set). A pitcher's liquid is
  a heat water record on its lip (`follow {item, key: "left_ml"}`, `keep`: it does not spill as it tips); a tap brings water at its temperature
  (`{role: "tap", item, key: "flowed_ml", start}`); a fluids container (even an empty one, when the scene pours) follows what it received
  (`follow {key: "received_ml", add: true}`), a heat `bowl` what flow caught in it (`liquid_ml`). Liquid that leaves goes into `transit` (kg and its
  enthalpy, in the books) and arrives heat for heat: 200 mL at 80 °C into 200 mL at 20 °C in a 600 mL beaker comes to 48.6 °C (50.0 less the
  beaker's glass: calorimetry 48.3-50). A fluids container's other liquids (`fluids [[words, kg]]`): vegetable oil (c 1970 J/(kg·K) [ETB]), honey
  (2300), corn syrup (2400), dish soap (3800), rubbing alcohol (3130), heat-data `HEAT_LIQUIDS`: with less of them than water they add their heat
  capacity and volume; with more, the container holds a liquid that is not water (no evaporation or boiling at 100 °C), reading `liquid_temp`
  (goal kinds read it). Under one lamp, oil warms 3.4 × as fast as water. A `bowl` gains `contents` (nothing | water | sand), `contents_g`,
  `contents_temp_c`: its water a water record, its sand a slab of dry sand (1600 kg/m³, c 830 J/(kg·K) [CRC]) on its floor, reading `sand:temp`;
  sand warms 3.9 × as fast as water under the same lamp (T12). A granular `sand-tray`'s sand is a heat body (its ghost slab, `material: dry sand`,
  `extra [["dry sand", kg]]`). New materials: sand, dry sand, office paper, card, optical glass, acrylic, brass, pine, modelling clay, sandpaper.
- **Solids expand**: a body record may carry `expand` (α, 1/K), `size` (m) and `ref` (°C); `ball-and-ring` (a 25.4 mm brass ball, α 19e-6, dropped
  onto a steel ring, α 12e-6, its hole 25.45 mm: `ball_temp_c`, `ring_temp_c`, `ball_mm`, `hole_mm`, `drop`, `ring_height`; record `{role: "ring",
  ball, jaws}`): the ball's and ring's contacts are left out (the `contact` hook's "pre") while the ball, 1 + α·ΔT its size, is smaller than the hole,
  1 + α·ΔT its, so the fit is decided by their true sizes, not the engine's 1 mm skin; a ball that comes to fit is woken (`force`). Readings `ball_mm`,
  `hole_mm`, `fits`, `through`; event "Hot ball passes through the ring (25.443 mm through a 25.461 mm hole)"; goal `passes_through {item, passes?}`.
  A 300 °C ball sits on the ring, warms it, and drops through after 4.3 lesson minutes. `bimetal-strip` (static: `layers` brass on steel | steel on
  brass, `length`, `height`, `start_temp_c`; a body record's `bend {a1, a2, e1, e2, t1, t2, length, ref}`): readings `bend_mm` (its tip, toward its
  lower-α layer) and `bend_deg` by Timoshenko 1925 (two 0.6 mm layers: 4.24 mm for a 10 cm strip 100 K over 20 °C); goal `bends {item,
  at_least_mm?}` (the softbody module's `bends` defers to it for this type). The glass thermometer's red column already follows its reading.
- **Rubbing**: `sanding-block` (a 50 g pine block with sandpaper under it, `press_n`, `speed`, `stroke`, `rub_s`, `rub_at`; record `{role: "drive",
  solid, speed, stroke, press, from, until}`: its process's `force` hook moves it back and forth at its speed and presses it down; readings `temp`,
  `work_j`). Goal: the matter module's `warms_by {item, at_least_c}`.
- **AI** (heat-ai.js): how-to paragraphs for rubbing, candles, traced light and lenses, pouring and other liquids, sand, expansion; plan and refine
  lines; 7 more worked examples (one with a plan the solver builds and the engine meets: a candle under a jar); goal kinds `burns_out`, `scorches`,
  `passes_through`, `bends`; knobs (candle `lit`, the jar's `volume_ml`, the sanding block's `press_n`, `speed`, `rub_s`, the ball's and ring's
  temperatures, the strip's `start_temp_c` and `length`, a bowl's `contents` and `contents_g`, a pitcher's `temp_c`); digest lines (friction's work
  and the temperature it made; a candle's flame, when it went out and its wax burned; a jar's oxygen; a hot spot and whether it scorched; the ball and
  hole sizes and when it went through; the strip's bend; a bowl's sand or water; a container's liquid); change words ("candle not lit → lit",
  "jar 1 → 2 L of air", "pressed with 5 → 10 N", "ball 20 → 300 °C", "holds nothing → sand").
- **View** (mod-heat.js): candle flames (`heat-flames`: a teardrop of flame and a warm light over each burning wick, flickering from a fixed table;
  out when the run says), the jar (a clear shell, so the candle and its flame show through it), the ball-and-ring's ring, the bimetal strip's two
  layers bending by `bend_mm` (`heat:bimetal`), a bowl's water (`heat:water`), focused spots (`heat-spots`: a glow, a char mark once scorched, a
  wisp of smoke). The clock (`heat-clock`) now sits inside the picture the camera frames (the machine and its movers over the run, or the fixed
  camera's span; at its top, 6 % inside its edges, 0.8-7 cm tall), not beside a tall machine where the wide shot cut it off.
- **Validated** (`research/rw-validate-thermal.ts` groups `work`, `candle`, `light`, `liquids`, `expansion`, and the fuzz with the new types):
  the numbers above. **Demos**: `heat-rubbing`, `heat-candle-jar`, `heat-burning-glass`, `heat-mix-water`, `heat-sand-water`, `heat-oil-water`,
  `heat-ball-ring`, `heat-bimetal-candle`, `heat-foil-reflector` (tools/parity/fixtures/heat-demos.json). Also checked: a pusher shoving a block
  warms it (0.2-1.2 J), and a kitchen scale under a burning candle reads about 1 g less after 10 minutes.
- **Known limits**: friction's and impacts' heat is lumped (a rubbed face is warmer than the block's mean); a candle's wax pool and dripping are not
  drawn and a candle shrinks evenly as it burns; a jar's air is one mixture (no draught under a raised jar); heat takes the optics module's light only
  for opaque bodies (see above) and a flat mirror's reflection off a small mirror is the tracer's (it reflects the whole height of a lamp's beam: the
  foil demo uses sunlight, which it handles exactly); poured liquid mixes as if of one kind; the circuits module's solar panel reads its own light; the fix search keeps a covered candle riding with its jar's top, so it seldom resizes a
  jar over a candle (the jar's `volume_ml` knob is offered, but the moved candle makes the smaller jar's scene unfit).

### Heat repair 2 (2026-10-20): one water and one level, lids with holes, the clock from t = 0, the thermostat, no air, cups, the fix search
These lines add to the sections above (and replace them where they differ). Scenes without heat are unchanged (the 22 scenes byte-identical, with and
without modules; only zz-catalog differs, by the drink-cup's and lamp's words and the meltable's name).
- **One water, one level** (`tooling/src/sim/heat-fluids.ts`): heat's water of a fluids container (a water record with `frame: "world"`) reads its
  surface from the liquids module (`liquidsIn(scene)` regions: what floats or stands in it raises it), and what heat adds to that water or takes from it
  goes to the container's liquid at the end of each beat (`changeLiquid`, the RegionState volumes, as flow's pours do): ice floating or standing in it
  gives its melt water as its body shrinks, kg for kg of what the engine's body lost (÷ 998.2 kg/m³), so the level holds while floating ice melts
  [Archimedes]; evaporation and boiling take water away; dew running in adds it; salt that dissolves in it adds 0.284 mL a gram (NaCl's apparent molar
  volume 16.61 cm³/mol [Millero, Chem. Rev. 71, 147 (1971)]). So level_mm, volume_ml, buoyancy and the view follow heat's water. A fluids
  container's level is the liquids module's `level_mm` only (heat sets no `level` of its own there; cups, pans, pitchers keep theirs). Measured: an
  8 × 6 × 8 cm cube floating in a 20 × 10 cm aquarium with 10 cm of water: 120.15 mm floating, 120.08 mm melted (0.04 mm of it condensation);
  volume_ml and heat's water agree to 0.1 mL; an 80 °C tank's volume falls by exactly what evaporates (101.2 mL in 6 h).
- **A thermometer or spoon goes through a lid** (mod_heat.py / heat.js `_lid_holes`, in the build hook): a lidded `drink-cup` or `saucepan` has its lid
  cut where a thermometer's or spoon's slab crosses it (the probe's outline in the floor's frame within the lid's band, 1.5 mm clearance each side;
  pieces narrower than 2 mm left out), into pieces welded as the lid was: the first keeps `<item>/lid`, the others `<item>/lid-2`, `-3` (the view draws
  the lid whole from the floor's model; those parts have no model). The water record lists them, `cover: [solid ids]`. So nothing is shoved out (no
  "starts inside" warning), the bulb stays in the water under the lid and reads it. Thermometers gain the reading `in_water` (readout "Bulb in
  water", no/yes); the `reaches` goal is not met by a reading taken after a bulb that started in water has left it (its entry gets `left_water: true`, the
  card says "its bulb had left the water"; Python == JS).
- **The lesson clock and heat start together at t = 0, whatever the release**: before the release the engine steps no contacts, so heat takes what
  stands touching at the start (`heldTouches`: within 2 mm, one side able to move) until the release and the engine's contacts after it, salt piles'
  targets too; held touches count as the engine's resting ones do (`SKIN` 1.5 mm apart, planck's contact skin, measured), whatever gap a cube shrinking
  as it melts opens before it can settle. A 4 cm cube with 6 g of salt and a plain one on ceramic plates, 22 °C: 71.7 / 95.0 min with the release at
  0.2 s, 72.1 / 94.2 at 2 s, 72.1 / 94.6 at 5 s (50 lesson minutes held), 71.9-72.5 / 95.0 at time-lapse 300-3600 (was 72.3 / 94.7, 82.7 / 97.0,
  98.3 / 109.5); the salt dissolves from the start.
- **The hot plate's thermostat acts every sub-step**, and within one gives no more heat than lifts the top to the setpoint + 5 K: an empty 1500 W plate
  set to 300 °C peaks at 303.7-304.3 °C at time-lapse 60 to 30000 (was 307-767), at 550 °C 551.7. Its `power` reading is the beat's mean (what the
  thermostat let through).
- **No air** (`settings.air` false): no convection, evaporation or dew; radiation and contact go on. A plain 4 cm cube on its plate melts in 137.5
  min instead of 95.0; an open cup loses nothing to evaporation (water in a vacuum would boil: not modelled).
- **Cups and pans**: a vessel (the solid of a water record) is never made a chain of cells (a lidded steel tumbler's lid made it one, and its water met
  only the first cell); a vessel's chain (a bowl with cells) meets its water cell by cell by area; a vessel's faces that look into it are not open to
  the room (its inside above the water: half of it for an open vessel, all of it under a lid; the lid's underside and edges, its top a disc, π/4 of
  its slab). 200 mL from 80 °C, 20 °C room, 30 min: open foam 47.7, paper 42.7, plastic 42.6, glass 45.5, steel 48.2, mug 44.6, flask 61.8 °C; lidded
  64.4, 56.8, 56.5, 56.4, 62.1, 53.4, 79.5 (was 56.9, 41.5, 41.1, 44.9, 68.2, 44.9, 79.2): lidded foam keeps warmer than lidded steel, and a lid saves
  25-52 % of every open cup's cooling (the evaporation it stops: a third to a half [ASHRAE]). A polished steel tumbler (ε 0.2) radiates little, so
  open it cools about as a foam cup; the drink-cup's description now says so (it said "a steel cup cools it fastest").
- **AI** (heat-ai.js): goal kinds `melts`, `melts_first`, `melt_fraction`, `reaches`, `warmer`, `boils` have `aim` (the fix search's targeted tries,
  first: more salt (2 ×, 3 ×) on the cube that should win, the lamp turned onto it (and an LED made incandescent, a dim bulb brighter), its plate
  aluminium or the other's foam; a lid or a better cup for the cup that should stay warm; the pan's hot plate turned up, a lid, less water); knob
  costs so a heat setting is tried before a centimetre's move (plate and bowl `material` 0.15, the lamp's `target` 0.15, `bulb` 0.3, `head_height`
  0.5, salt `mass_g` 0.5, lids 0.2, a cup's `style` 0.3, the hot plate's power 0.5); `words.keys` for every heat setting a request names (the lamp's
  bulb and watts, salt grams, a cup's style, water temperature and amount, lids, the hot plate's power and setting, …; and "alumin…", "ceramic",
  "copper" now name a `material` in web/ai/orchestrator.js choicesOf), so a fix never undoes "a 4 watt LED", "twice as much salt" or "warm water";
  `words.how` (a new plug-in point, web/sim/plugins.js `howWords`, used by orchestrator.js `propWord`): "brighter"/"dimmer" for a lamp's watts, "its
  beam wider"/"narrower" (never "tilted less"), "more/less powerful" for a hot plate, "warmer"/"colder" for start temperatures; `words.added` ("a 3 g
  salt pile", "a foam cup of 200 mL of water at 80 °C with a lid", "a piece of chocolate"); change words for the beam ("beam 140° → 60° wide") and
  aim; a change line now says every setting that changed, a pick-from-list's and a link's too ("…; lamp aimed at the salted cube → the plain cube;
  incandescent → led bulb"), links by the things' names. Prompt lines: a thermometer or spoon goes through a lid; a change that removes what an
  outcome needs (warm water: no dew) rewrites that goal rather than undo the change. The meltable type is "Meltable piece (butter, chocolate or
  wax)" (the card said "the 2 butters" for chocolate); the lamp's `power_w` goes down to 1 W (LED filament bulbs 2-8 W). `words.regoals` ("warm water",
  "instead of ice …", "no salt", "an LED", "switch the lamp off", …): an edit asking for such a change may rewrite the outcome goal it undoes.
- **Validated** (`research/rw-validate-thermal-2.ts [level|clock|thermostat|vacuum|lids|cups|all]`, 31 checks, all pass): the numbers above;
  research/rw-validate-thermal.ts every group still passes (T1 86.9 min); `tools/parity/heat.mjs` all pass; web/ai/test/heat-plugin.test.mjs 12/12
  (new: a missed heat goal's own aim finds the fix in under 8 runs; the card's words). AI acceptance (my server, headless Chromium, real Opus 5.5
  calls, `engine4/thermal/repair/accept2.mjs`): builds 2/2 (floating ice in an aquarium: "the water level stays the same" met; foam vs metal cups with
  lids and thermometers: 69.4 vs 66.5 °C); edits 5/5 ("Put a lid on the pot": both goals still met, nothing shoved; "Put a lid on the cup": reads 38 °C;
  "Use a 4 watt LED bulb in the lamp instead": exactly "bulb 60 → 4 W; incandescent → led bulb"; "Fill the glass with warm water instead of ice
  water": 2 → 40 °C kept, the dew goal no longer checked (said); "Make the room colder: 10 degrees": the card offers a checked fix through the aim, 6 →
  12 g of salt, applied: both goals met, the room kept at 10 °C).
  **Demos**: `heat-lid-cups` (foam and steel cups with lids, thermometers through them), `heat-ice-tank` (floating ice, the level holds: 2113.9 mL).

## Sand, gravel and soil (module `granular`, 2026-10-19): piles, sandcastles, craters, pouring and clogging, sand timers, erosion and deltas
Files: `machines/mod_granular.py` and its exact port `web/sim/modules/granular.js` (catalog, goal kinds, the AI plug-in), `tooling/src/sim/granular.ts`
(the physics, pure), `tooling/src/sim/modules/granular.ts` (the process kinds), `web/models/mod-granular.js` (models and the view plugin
"granular"); tests `research/granular-core.test.ts`, `web/ai/test/granular-plugin.test.mjs`, `tools/parity/granular.mjs` (+ `py_granular.py`);
validator `research/rw-validate-granular.ts`. Category "Sand & soil".
- **Items** (all fixed in place, `dynamic: false`; their sand stands on whatever fixed solids are under it): `sand-pile` (shape `heap`: `sand_kg` kg as a
  cone at the angle of repose, or `castle`: a packed tower `width` × `height`), `sand-tray` (a wooden tray `length` × `width`, `wall` high, filled level
  `sand_depth`), `sand-funnel` (a funnel `funnel_cm` across holding `sand_kg` kg, its spout `outlet_mm` wide and `height` m over its ring stand's foot; it opens
  `delay` s after the release; its anchor is under its spout, on what its stand's foot stands on, the foot drawn beside the heap), `hourglass` (`sand_kg` kg
  through a `neck_mm` neck, bulbs `bulb_cm` wide, cells R/10; it starts `delay` s after the release), `stream-table`
  (a tray `length` × `width` tipped `tilt_deg` (books under its high end), damp sand `sand_depth` deep over `sand_share` of it from the high end, a hose of
  `flow_lpm` L/min at the high end from the release, a pool `lake_cm` deep at the low end, `plants` none | lower half | upper half | all). Grains (`grain`):
  fine sand 0.18 mm (32°), sand 0.4 mm (34°), coarse sand 1 mm (35°), gravel 6 mm (38°), pebbles 2 cm (40°), soil (silt loam, 35°), flour (45°); `wetness`
  dry | damp | soaked; `sand_color` a render-only tint (the catalog-wide `color` paints the item, a tray's wood). Their ghost solids (`ghost`, `stand: "self"`)
  are what the editor picks and what the models draw on; the funnel's foot ghost is what it stands on. Sources in the files' headers.
- **Records** (`doc.processes`): `sand-region {x0, x1, z0, z1, base, top, cell, grain, wet, role (pile | tray | landing | stream), deposit, walls?, exclude?}`
  (overlapping regions are one bed; the floor is scanned at the start from the document's fixed, non-ghost solids reaching into `[., top]`; `walls` are
  barriers the side view has no solids for, a tray's front and back; `deposit` cone | castle | layer | slope | none; a cone (a heap) and a castle are laid
  on what they stand on: the columns joined to the one under their middle without a drop of more than 1.5 columns or 6 mm (a shelf's or a plank's top, a
  tipped board, never the table 40 cm under it), the cone with exactly its mass (scaled down when even its lowest cone would hold more, so grains are never
  made); a heap that reaches its support's edge runs off it before the run (the bed's own avalanches, up to 3 s), lands below and is said), `sand-vessel {cx, base, shape (cone |
  bowl), R, rOut, wall, top, cell, grain, wet, mass, role (funnel | hourglass-top | hourglass-bottom), outlet {diameter, delay} | null}`, `sand-water
  {region, sources [{x, z, rate m³/s}], drainX, lake, plants [{x0, x1, tau Pa}] | null}`. All are worked by one process (the first record), every 480 Hz
  step after the release (before it nothing moves); a document without them runs exactly as before.
- **Physics** (`granular.ts`; details and sources in its header): a bed is a grid of columns (2.5-D: x along the plane, z front to back) over the scanned
  floor; avalanches are a staggered depth-averaged flow with Coulomb friction (tan of the angle of repose at rest, rising with speed by the μ(I) rheology,
  Jop et al. 2006), only the excess over the stable slope flowing (so heaps are cones at their angle of repose on a square grid) and a column sinking no
  faster than ½√(g·h) (a tower slumps in about 3√(H/g), Lube et al. 2004); damp grains stand at Culmann's cohesive limit (vertical to (4c/γ)·tan(45° + φ/2)),
  a free tower taller than 2c·tan(45° + φ/2)/γ (23 cm of damp sand) crushes; soaked grains stand only at 20-28°; outlets let grains out at Beverloo's rate
  × the time-lapse (an hourglass's minute in seconds), jamming under 5 grains (Zuriguel 2005) or a cohesive arch (Jenike), choking when the heap reaches
  the spout; falling grains are parcels in free fall that land on the first surface they meet; bodies in sand displace what they overlap (to the ring
  round them, or thrown out when they strike faster than 0.3 m/s: once per strike (half a second's memory: a body falling into its own crater opens no
  second one) a bowl as deep as Uehara et al.'s penetration d = (0.14/μ)(ρ_b/ρ_g)^½D^⅔H^⅓ and 0.7 × half their crater D_c = 0.90(ρ_b/(ρ_gμ²))^¼D^¾H^¼
  wide (H = v²/2g + d; a block as the sphere of its volume), its grains thrown from the struck surface to land a third of its radius past its edge, so
  the rim stands D_c across; in sand thinner than d the ball strikes the floor, the sand takes t/d of its energy and the crater is (t/d)^¼ as wide; a body
  too small for the grid opens the old 45° cone), and are held up and braked by Terzaghi-Vesić bearing,
  an inertial drag ρ_b·v², Coulomb friction, a compaction rolling resistance and Rankine's passive pressure, all capped implicit stops (never pulling a body
  back up; a body at rest is buried by what slides onto it); running water is routed over the priority-flooded surface (hollows fill and spill) by slope⁴,
  Manning depth, τ = ρghS, Wong & Parker's bed load above Shields' threshold, picked up or let fall over the grains' settling distance, the bed changing by
  time-lapse × that (a morphological factor); plants add 15 Pa to the threshold and keep their sand from soaking. Mass is conserved exactly (grains
  only leave by an edge or the drain, and are counted). A face stops when the layer above its stable slope is under 20 µm or its source under 2 µm (a
  film on a funnel's wall stays put and the bed rests); the avalanches are sub-stepped up to 4 times (8 before 2026-10-20: three funnels cost 2.5 s).
- **Readings** (track.state, 30 a second): pile `height_mm, width_mm, angle_deg, mass_g` (on what it stands on), `spilled_g` (what ran off a support
  narrower than the heap; mass_g + spilled_g = sand_kg); tray `crater_mm` (rim to rim, from the hole's depth-weighted middle, the rim's radius between
  rings by a parabola: no steps of the grid), `crater_depth_mm, sand_mm`; funnel `left_g, poured_g, flow_gs, clogged, heap_mm, heap_deg, heap_g` (the heap
  it poured, read as a pile's); hourglass `top_g, bottom_g, flow_gs, run_s` (lesson seconds, frozen when it runs out and while its neck is jammed), `empty`,
  `clogged` (1 while its grains jam in the neck); stream table
  `eroded_g` (net: sand gone from where it lay), `delta_cm` (the deposit's reach past the sand's toe), `channel_mm, water_lpm`. Events: "<funnel> clogs: its
  grains jam in the spout", "<funnel> runs empty", "<hourglass> runs out after 59.6 lesson seconds", "<hourglass> jams: its grains arch over the 3 mm
  neck", "<funnel> starts pouring: about 25 g a second" ("a lesson second" under a time-lapse), "<hourglass> starts running: about 1.1 g a second
  through its 3 mm neck", "a crater opens in <tray>", "<heap> does not fit on <plank>: 412 g of its grains spill off the edge" (at the start),
  "the water starts carrying sand down <stream table>", "the washed-off sand builds a delta in <stream table>'s pool", "<castle> collapses", "sand spills off the edge by <item>", and at the start "only 163 g of the 200 g of grains fits in <hourglass>'s top bulb: it is filled to the brim"
  (a funnel holds about 0.36·funnel_cm³ g of sand, a timer's top bulb about 0.75·bulb_cm³ g of fine sand; more is cut to the brim).
- **Keyframes** (new framework call `ctx.keyframe(item, key, values)` in tooling/src/sim/plugins.ts: sparse frames of a large list, kept only when set, as
  `track.keyframes[item][key] = [[t, ...values]]`, t to 6 decimals and values to 5 by `slimExtras`; also used by the flow module): each bed under its first
  item: `grid:<bed>` once ([x0, z0, dx, nx, nz, K, grain index ×K, wetness index ×K, base m, the floor as runs of column-to-column steps in 0.1 mm, the kinds as
  runs]), `h:<bed>` (thickness in 0.1 mm over the rectangle that changed: values, runs or changed columns only, whichever is shortest; up to 20 a second while
  something changes by 1 mm, 5 under running water, else 4), `mix:<bed>` (which classes), `water:<bed>` (depth, 4 a second); the run's falling grains `air`
  ([x, y, z, vx, vy, vz, grain] per parcel, 30 a second). Typical tracks: a crater pair 90 KB, a poured heap 320 KB, a 5-minute stream table 0.5-0.9 MB.
- **View** (`web/models/mod-granular.js`): a tray's front and back walls, a funnel on a ring stand, an hourglass of glass on turned posts, a stream table's
  clear front side, blue back, hose, outlet and books; each item's starting sand for the editor's picture (frame hook `granular:start` hides it in a run);
  the plugin draws each ground bed as a heightfield of grain-textured sand (vertex colours by grain, wetness and tint; triangles only where there is sand;
  a skirt along its front and back), a vessel's sand as a turned body averaged round its axis (solid against the glass), running water as a see-through
  sheet, and falling grains as streaks of grains (a funnel's or a neck's stream is continuous; a crater's splash flies).
- **AI** (`plugin` in web/sim/modules/granular.js): how-to and plan/edit/refine lines (grains and their angles, Beverloo's rates and the jam widths per
  grain, craters need held balls over a tray and follow Uehara's law, stream tables need time_lapse 10-30, a poured heap is the funnel's own: never a
  sand-pile under a funnel, a heap must fit its plank or shelf, an hourglass is its own clock (never a stopwatch on it), a kitchen scale does not weigh
  grains, a change of grain/spout/neck that makes a goal stale is rewritten with set_goals); goal kinds `piles {item: pile or funnel, min_deg?, max_deg?}`
  (a funnel's `heap_mm`/`heap_deg` when the item has no height_mm), `stands {item}`, `collapses {item}`, `steeper {a, b}` (piles or funnels),
  `crater {item, min_mm?}`, `crater_bigger {a, b}`, `sand_runs_out {item, before_s?, after_s?}`, `runs_out_first {a, b}`, `timer {item, seconds, tol_s?}`
  (tol_s in seconds, default 5 % of seconds; an old `tol` under 1 is a share, 0.1 = 10 %, 1 or more seconds; the entry carries want, tol, empty, jammed),
  `clogs {item: funnel or hourglass}`, `erodes {item, min_g?}`, `erodes_more {a, b}`, `delta {item, min_cm?}`, each with a `detail` for the cards ("no (its
  grains jam in the neck, so it never runs; the goal 60 ± 3 s)"); the comparisons need a clear difference, as a ruler, a clock or a scale would
  tell (`crater_bigger` by 2 mm and 5 %, `runs_out_first` by 2 % of b's time, `erodes_more` by 10 g and 5 %, `steeper` by 1°), so two equal set-ups
  never pass on a grid cell's difference, and their subject is both items (the make-it-work search turns a's and b's knobs) (Python == JS, aliases such as bigger_crater, timer_runs_out, erosion,
  angle_of_repose; none shared with another module's kinds: the flow module's liquid `empties` stays its own); knobs (funnel outlet_mm/sand_kg/grain, hourglass sand_kg/neck_mm (steps to +150 %: past 5 grains, the honest fix of a jam when the grains are the person's)/grain, pile sand_kg/wetness/height, tray sand_depth/grain, stream table
  tilt_deg/flow_lpm/grain/plants/sand_depth) with honest whys, the choice knobs' chips naming the value ("fill the funnel with sand instead (gravel →
  sand)", `{to}`), and a coupled knob: with a timer goal, the hourglass's neck widened past 5 grains together with the sand that keeps the goal's time
  (sand = seconds × Beverloo's rate, a bigger bulb when the top one cannot hold it), so "fill the 30 s timer with coarse sand" then "make it work" finds
  "widen the sand timer's neck (3 mm → 5.25 mm) and put more sand in the sand timer (0.033 kg → 0.0824 kg)". Framework (web/ai/fixer.js, 2026-10-20):
  a module knob may have `also(props, to, {goals, item}) -> {key: value}`, the settings that change with it (never the person's own; null: no candidate); edit-digest lines ("a heap of 400 g of dry sand; height 0 → 47 mm, slope 33.1°", "it does NOT fit on what it stands on: 119 g ran off
  the edge", "it CLOGGED: the 12 mm spout is too narrow for gravel (it needs over 30 mm)", "its poured heap: 45 mm tall, sides at 38.1°", "it JAMS: its
  coarse sand arches over the 3 mm neck … over 5 mm", "ran out after 29.8 lesson s (goal 30 ± 1.5 s)", "eroded 760 g, channel 27 mm deep, delta 22.5 cm");
  change words ("slope 6 → 10°", "neck 3 → 4 mm",
  "spout 10 → 30 mm"); `place.containers` sand-tray with `interior` (its sand's top is its floor); `words.keys` (the words that name each setting in a request: "make the
  timer's neck 4 mm wide" holds `neck_mm` as the person's own choice, so the make-it-work search adds sand instead of offering 3 mm back; "fill the funnel
  with gravel" holds the gravel: a choice the words name by its value is the person's exact choice, web/ai/orchestrator.js choicesOf; the grain knobs
  also cost 15, after a wider spout); its goal kinds' generic words (run, out, first, bigger, stand, steeper) never pick this module for a request
  alone (ai/catalog-digest.mjs: its STOP list applies after stemming, so "runs" is "run", and its GENERIC words; "a tap runs into a mug" or "a steeper
  ramp" is not about sand: checked in web/ai/test/granular-plugin.test.mjs); `words.regoals` (a change of grains, wetness, spout or neck: the edit may
  rewrite a goal it makes untrue, "fill the funnel with fine sand instead" turns "the gravel jams" into "the fine sand runs out");
  six worked examples (solved and met in tests: one funnel's heap, sand vs gravel funnels judged on their poured heaps, craters, a 30 s timer with
  tol_s, castles, stream tables). Sieving by grain size is the matter module's `mixture-dish` + `sieve` (the how-to says so). A run in which no solid moves is said on the card by its
  happenings ("In the run: Funnel clogs: its grains jam in the spout (0.52 s)", web/ai/orchestrator.js `describeRun`, for every module), not "nothing moves".
- Checked (2026-10-20, repair): `research/rw-validate-granular.ts` also: heaps on a shelf 0.4 m up, a plank, boards tipped 5° and 20° and the table hold
  exactly their sand_kg (mass_g + spilled_g within 0.3 %), what spills is said; the funnel's heap_deg within 3° of the repose angles and its heap_g what it
  poured; three funnels' heaps flour > gravel > sand; ping-pong, golf, wooden, tennis and steel balls in sand and flour within 25 % of Uehara's crater (a
  ping-pong ball's crater about its own size, wider with the drop, always narrower than a steel ball's), a 1 cm flour layer's crater smaller, steel still
  wider; hourglass necks under 5 grains jam (clogged, said, run_s 0) and wider ones run; three funnels and two timers each under 1.5 s of CPU.
- Checked (2026-10-19): see `research/rw-validate-granular.ts` (heaps at 32-38° within 3° of their angles of repose, Beverloo's rate within 5 % and the
  same full or nearly empty, jams, hourglasses within 4 % of mass ÷ rate, collapse in 1.5-1.7 × 3√(H/g), damp towers to 23 cm, craters' penetration and
  width within 30-35 % of Uehara's laws and the width's power of the drop height near ¼, a brick and a rolling ball in sand, erosion monotonic in slope
  and flow, gravel and grass resisting, 30 random scenes finite, determinism, CPU 0.1-1.5 s for each lesson scene); the demo scenes identical on the
  server's engine and the bundle with every goal met; `tools/parity/granular.mjs` 0 mismatches; `research/granular-core.test.ts` and
  `web/ai/test/granular-plugin.test.mjs` pass (make-it-work finds a fix through the module's knobs for a clogged funnel and a sand timer).
- Edit prompt (ai/prompts/edit.md, Goals, 2026-10-20): a goal whose own words the requested change makes untrue ("the gravel jams in the 10 mm spout"
  after "fill the funnel with fine sand instead") is rewritten with set_goals to what the change now shows, and the reply says so. A refine round
  whose run the engine cannot finish (too slow under load) keeps the last version that ran (web/ai/orchestrator.js). The open rework's refusal says a
  module goal's "<label>: no (…)" as "“<label>” still doesn’t happen (…)", never "<label>, and no".
- For other modules: `grainsOn(scene, item)` (tooling/src/sim/modules/granular.ts) gives the grains (kg) resting on an item's fixed solids now (a kitchen
  scale's platform); `grainsIn(scene)` the run's beds.
- Known limits: a kitchen scale does not weigh grains yet (the measure module's scale counts moving solids; `grainsOn` is there for it to add);
  a stopwatch cannot time an hourglass (its stop rules watch motion and an hourglass stands still: the hourglass's own run_s and the timer goal are its
  clock; a stopwatch stop on another item's reading would need the measure module); sand rests only on fixed solids (a movable board under a heap is
  not its floor);
  sand does not pile on moving bodies (falling grains pass through them) and does not push bodies sideways (an avalanche against a block);
  a pile is one heightfield (nothing under an overhang); the hourglass and funnel are fixed; a column taller than the crush height fails by slumping its
  edges rather than as one block; running water is quasi-steady (no waves; flood routing, not shallow-water dynamics) and the bed's change is
  time-lapsed while the water runs in real time; a planted cell holds fully (15 Pa); the flow module's free water does not wet or erode these beds.

## Matter (module `matter`, 2026-10-19): the particle model, states and the heating curve, gas laws, diffusion, dissolving and saturation, conservation of mass on a scale, mixtures and separating, density
Files: `machines/mod_matter.py` (catalog, goal kinds), `web/sim/modules/matter.js` (its exact port + the AI plug-in), `tooling/src/sim/modules/matter.ts`
(the process kind "matter"), `tooling/src/sim/matter/` (`particles.ts` a 2-D DEM of discs, `substances.ts` real data, `box.ts` the particle box,
`dissolve.ts` + `glass.ts` dissolving, `grains.ts` mixtures, sieves and magnets, `separate.ts` filtering and evaporating, `closed.ts` a closed
fizz bottle (Henry's law, the cap that pops), `vapour.ts` vapour pressures and critical points; `matter.test.ts` 19 and
`separate.test.ts` 10 unit tests), `web/models/mod-matter.js` (models,
frame hooks, the `matter:particles` view plugin). Nothing of it runs in a scene without one of its items: the 12 scenarios and 10 gallery scenes are
byte-identical (`identity.mjs`). Sources are cited in the files ([CRC], [NIST-WB], [ISO-AIR], [FIFA], [USDA], Wood Handbook, Schiller-Naumann, Ranz-Marshall,
Churchill, Henderson, Barker-Henderson, Lindemann, Furlani).
- **Items** (category "Matter"; readouts are `track.state[item][key]`): `particle-box` (a clear box on a hot plate: `substance` water | wax | gallium | carbon
  dioxide | iron | nitrogen | helium | air | bromine, `temp_c`, `heater_w` from `heat_from_s` (cuts out 250 °C past the boiling point), `sample_g`, `particles`
  8…160, `volume_ml` (the real container), `piston` + `piston_start`, `load_kg` on `piston_area_cm2`, `divider` + `second` (another gas, or none: one gas in two
  colours) lifted at `open_at_s`; readings temp_c, solid_pct, liquid_pct, gas_pct, pressure_kpa, volume_ml, speed_ms (the molecules' mean speed √(8RT/πM)),
  heat_kj, mixed_pct, piston_m; `sample_g` is cut to `volume_ml` × the substance's densest state, with a warning: 1000 g of CO2 in 1 mL holds 1.562 g);
  `syringe` (60 mL sealed, plunger pushed from `start_ml` to `push_to_ml` between `push_from_s` and + `push_s`: volume_ml, pressure_kpa, temp_c,
  force_n: the push that holds the plunger, (p − p_outside) × 5.60 cm²: 57 N at 30 mL, 284 N at 10 mL, 624 N at 5 mL; warned past 200 N); `balloon-bath` (a `balloon_l` balloon of air at `air_temp_c` dipped at `dip_at_s` into water at `water_temp_c`, settling over `settle_s`
  lesson seconds: temp_c, volume_l, diameter_cm); `dissolving-glass` (`water_ml`, `water_temp_c`, `solute` salt | sugar | sand | chalk, `grain` table |
  granulated | coarse | powder | cube | fine, `solute_g`, `specks` drawn, `start_in` spoon | dish (a paper cup beside it on the same scale) | glass, `pour_at_s`,
  `stir` turns/s from `stir_from_s` to `stir_until_s`: dissolved_g, left_g, dissolved_pct, strength_pct, saturated, clock_s (lesson seconds since poured),
  weighed_g); `zip-bag` (`sealed`, `bag_g`, `puff`; a module container: an ice cube or salt pile goes `place.inside` it: water_g, contents_g); `chocolate-bar`
  (`mass_g`, `pieces`, snapped at `snap_at_s`: pieces_apart); `reaction-bottle` (`vinegar_ml` of `acid_pct` vinegar, `soda_g` baking soda dropped in at
  `mix_at_s`, `closure` open | cap | balloon, `react_s` the fizz's time (lesson seconds): co2_g, escaped_g, balloon_ml, pressure_kpa, fizz,
  co2_dissolved_g (Henry's law under a cap or a balloon), popped (the cap, past 900 kPa)); `pumped-ball`
  (size 5, `start_bar` → `end_bar` gauge from `pump_at_s` over `pump_s`: air_g, gauge_bar); `mixture-dish` (`mixture` sand + iron filings | sand + gravel |
  salt + pepper | rice + beans | sand + paper clips | sand + salt, `amount_a_g`, `amount_b_g`, `grains`, `width`; its own magnet `wand` swept `wand_height`
  above the floor from `wand_from_s` over `wand_s` and lifted out, and/or the link `magnet` to a bar/horseshoe/disc/ring magnet item: a_left_pct, b_left_pct,
  a_out_g, b_out_g, weighed_g, wand_x, wand_y); `sieve` (a round wire-mesh kitchen sieve on a stand over a tray: `aperture_mm`, `sieve_height`, shaken
  `shake_mm` × `shake_hz` from `shake_from_s` to `shake_until_s`: a_passed_pct, b_passed_pct, a_passed_g, b_passed_g); `density-cube` (1 inch, `made_of` one of
  12 materials) and `equal-mass-block` (`mass_g` of `made_of`, its size from the density): mass_g, volume_cm3, density_gcm3. A density cube's material is its
  own "density set <key>" material, never another module's of the same name. `filter-funnel` (fixed: a ring stand, a glass funnel `funnel_mm` across lined
  with filter paper, a 250 mL beaker under it; a cup of `water_ml` at `water_temp_c` holding `solid_g` of an undissolved `solid` sand | chalk | none and
  `dissolved_g` of `dissolved` salt | sugar | none is poured in from `pour_at_s` over `pour_s` run seconds, the pourer waiting while the funnel is full, then a
  `rinse_ml` of clean water; `paper` filter paper | coffee filter | none: poured_ml, in_funnel_ml, held_ml, filtrate_ml, filtrate_pct, salt_through_g,
  salt_through_pct, kept_g, kept_pct, through_g, clear, flow_ml_min, level_mm, clock_s); `evaporating-dish` (a 9 cm borosilicate glass dish of `water_ml`
  with `solute_g` of `solute` salt | sugar at `water_temp_c`, `heat` hot plate (its own hot plate under it, `heater_w`) | sun (a sunny windowsill) | room,
  from `heat_from_s` (so a scale under it settles first), the room's `humidity_pct`; a moving item: water_g, temp_c, dissolved_g, crystals_g, strength_pct,
  saturated, dry, boiling, evaporated_g, loss_g_min, weighed_g (on its ballast: a kitchen scale under it falls by the water only), level_mm, clock_s).
- **Engine** (`matter.ts`; process kind "matter" with `role` box | balloon | glass | bag | bar | reaction | ball | grains | block | filter | evaporate; `check` refuses an unknown
  role, a missing solid and numbers outside `LIMITS`): **series** is a new reading channel of the framework (tooling/src/sim/plugins.ts):
  `ctx.series(item, key, values)` keeps a list per item that the track carries as `track.series[item][key]` = that list as it was at each frame (copied every
  4 steps, 120 a second, 5 decimals); not a reading, never in the summary or the AI's digest; a track without series has no `series` key (every existing
  track unchanged). The view draws the model's particles, crystals and grains from it. **Mass on a scale**: what a process gains or loses (gas escaping,
  air pumped in, a dissolved solute that came from the paper cup) is carried by a hidden 1 mm welded steel "ballast" ball of the item, built with the most
  it will carry and resized (`ctx.solid().resize(k)`, mass ∝ k³) only after the release (a held body's mass is the engine's to set). (A welded SLAB resized
  to k ≤ 0.1 jumped 0.10 m in the engine — physics.ts's resize of a degenerate polygon, not this module's code: the ballast is a ball for that reason.)
- **The particle model** (`box.ts`, `particles.ts`): what is real — the temperature, the heat in (heater × time × time-lapse), the heating curve (stateAt:
  melting/boiling points, specific and latent heats [CRC]), the molecules' real speeds, the gas's pressure (kPa) and volume (mL) of the real sample; what is a
  model — each particle stands for very many molecules and moves 1/1250 (`SPEED_SCALE`) of the real speed; spring-dashpot contacts with exact restitution
  (stiffness ∝ R²), a Langevin heat bath (τ 0.2 s gas, 0.05 s condensed; momentum-free kicks for a solid: no "flying ice cube"), solids bonded so their
  vibration at the melting point is a tenth of their spacing (Lindemann), a liquid held by a pull 2.5 × the motion's energy at the boiling point (Trouton),
  `CONDENSED_GRAVITY` 12 m/s² on the liquid and solid only; phases assigned to follow the heat's fractions (melting from the fewest-bonded surface particles,
  boiling from the top). The heater works at 60 Hz (coarse 8: the curve's corners within 1/60 run s). The pressure READING is the real sample's gas
  nRT/V in the real volume (20 Oct; it was measured from the particles' wall hits, which fell 5-20 % behind from 3 to 6 × compressed as the model's
  discs packed, and ran away at 12 ×: the hits, against Henderson's hard-disc equation of state, are now only the picture's diagnostic `measured`).
  A loaded piston does NOT ride on the particles (60 particles would jostle it ±15 %): its real volume slides, damped (`PISTON_TAU` 0.3 s), to nRT/P
  for the outside air (none in a vacuum) and its load × the run's gravity (Boyle, Charles), never below its solid's and liquid's own volume (resting on
  them it reads its load); the drawn piston follows as far as the drawn particles leave room (50 kg on 0.5 cm² over 1 g of CO2: 5.59 mL at 9.91 MPa,
  the gauge, the volume and nRT/V agreeing). A syringe's plunger is driven (ease in-out) and the air stays at its temperature (a slow push). A box's
  states are those of a sample at 1 atm (stateAt); when its gas presses more than 1.05 × its vapour pressure at that temperature (`vapour.ts`:
  IAPWS-95 water, Span-Wagner CO2, Span et al. nitrogen; Clausius-Clapeyron from the 1-atm boiling point with the substance's own latent heat for
  the rest; none above the critical point) an event says a real one would be partly liquid (1 g of water in 1 L at 100 °C: 171 kPa against 101 kPa;
  CO2 under that piston: past 5729 kPa). Mixing past a lifted divider runs on a MODEL clock (a few run seconds whatever the time-lapse; real gases take
  about L²/2D, a 20 cm box half an hour): the readout, how-to, digest and the mixes goal say so.
- **Dissolving** (`dissolve.ts`, `glass.ts`): Noyes-Whitney with Ranz-Marshall (forced) and Churchill (natural) mass transfer, mixed by Churchill's cube rule,
  D by Stokes-Einstein; crystals (`specks`, each a pinch of real grains) fall through the water at Schiller-Naumann drag (the drag's coefficient at the
  slip before each sub-step's kick: exactly the terminal speed), rest on the floor (pushed apart so a heap spreads to a layer), are swept by the stirred
  water (a Rankine vortex with the tea-leaf inflow at the floor); those on the floor dissolve into a 3 mm brine layer that mixes up by diffusion when still
  (LAYER²/2D) and in about a turn when stirred, so unstirred salt stalls in its own brine; concentration by mass fraction, saturating exactly at the
  solubility (grams per 100 g of water: salt 35.89 at 20 °C, sugar 203.9 [CRC]). The scene's time-lapse speeds the dissolving fully and the motion at most
  `MOTION_LAPSE` 20 × (sub-steps of ≤ 0.01 lesson s); the dissolving and the layer's mixing are done once per engine step.
- **Mixtures** (`grains.ts`): discs of each component's real size (three sizes over its spread), contacts as soft as 4 % of the smallest grain's radius
  under a 20-grain column (resolved in 6 sub-steps), the sieve's mesh a row of 0.8 mm wires shaken sideways, and a grain wider than the holes is held on its
  seat between two wires (steel does not give: without it the contacts' softness let 1.7 mm sand through a 1.5 mm mesh); magnets by the Gilbert model
  (poles of Br·A/μ0), a cylinder's poles at its faces softened over R²/3 (its axial field within 12 % of the exact one from 3 mm to 4 cm), F = V·M·∇|B| with
  the filings' susceptibility saturating at 1.71 MA/m, capped at 40 × a grain's weight; held grains (within 2 mm of the wand or magnet, or above the rim)
  count as taken out.
- **Filtering and evaporating** (`separate.ts`, lesson time, coarse 8): a funnel drains by Darcy's law through the paper and its cake, Q = ΔP·A/(μ(R_paper +
  R_cake)); in a 60° cone the liquid's volume and the wetted paper under its mean head h/3 both go as h³, so it drains exponentially, V = V0·e^(−t/τ), τ =
  sin30°·μ·R/(share·ρ·g) (share 2/3: a quarter-folded paper), solved exactly over each step; R_paper 1.47e9 1/m from Whatman Grade 1's Herzberg flow
  time (150 s for 100 mL through 10 cm² under 10 cm), a coffee filter's a third of it (provisional); the cake by Kozeny-Carman (sand 0.25 mm, ε 0.4: 2 % on
  10 g; chalk 5 µm, ε 0.5: many times the paper's); μ(T) and ρ(T) from the CRC tables (twice as fast at 50 °C). A paper keeps grains at least its retention
  (11 µm; 20 µm; none) — chalk counts as its 15 µm flocs (provisional) — the rest stays suspended and runs through with the water; the wet paper holds 2 mL
  (× its area) and the cake its pores' water, which keep their share of the dissolved salt until the rinse dilutes it through (100 mL with 10 g of sand and
  5 g of salt, a 10 mL rinse: 98.6 % of the salt through, 17 lesson minutes to 90 %). An evaporating dish is one lumped node (the water, its solute, the
  110 g glass): natural convection and radiation to the room and Chilton-Colburn evaporation with the heat module's own laws (heat-data.ts), the surface's
  vapour lowered by the solute's water activity (NaCl by molality, Robinson & Stokes; sucrose by Norrish), the dish a spherical bowl whose surface shrinks
  as it empties; it boils at 100 °C + 0.512·i·b once the heat keeps coming (the heat past that point boils water away, energy kept), half a hot plate's
  power reaches it (provisional), a sunny windowsill gives 700 W/m² × 0.35 (provisional); the solute stays dissolved up to its solubility at the dish's
  temperature, the rest is crystals (all of it when dry). 50 mL of salt water: 17 min on 300 W, about 3 days in the sun, 11 days in a room at 50 %.
  `heat_from_s` holds it until then (nothing changes before). **Events** (track.events, the card's "In the run: …"): a box starts to melt / boil / is all
  gas; what was put in a glass has dissolved / a glass is saturated; a filter's filtrate starts dripping / everything has run through; a dish starts to
  boil / crystals appear / is dry, each once.
- **Closed bottles and a vacuum** (`closed.ts`, 20 Oct): under a cap or a balloon the vinegar takes its Henry's-law share of the CO2 at once (H^cp
  3.79e-4 mol/(m³·Pa) at 20 °C, 1.69 g per litre per atm [Sander 2015]; the fizz stirs it): 5 g of soda capped over 100 mL: 0.49 g dissolved, 396 kPa
  (was 464); a balloon holds what the vinegar does not, mixed with the headspace's air at 1 atm (1.36 L, the scale −1.62 g). A capped bottle's cap pops
  past 900 kPa (ISBT: a closure holds 690 kPa gauge in the secure-seal test, PET bottles burst at 1-1.5 MPa: a modelling choice between them): an event,
  `popped`, the gas over the vinegar escapes at once and what is dissolved follows over `DEGAS_S` 300 lesson s (provisional); the view throws the
  cap off. In a vacuum (`settings.air` false) a balloon is not buoyed, a piston and a plunger have no air on their far side, and an evaporating dish is
  refused (its water would boil at room temperature and freeze, not modelled): an event and a warning, nothing changes.
- **Goals** (Python == web/sim == ai/goals.mjs): `holds_at {item, temp_c, while: melting | boiling, tol_c?}` (a heating curve's plateau: while it
  melts or boils its temperature stays at temp_c within tol_c, default 0.5 °C, for at least two frames: a particle box's sample, heat's ice-cube or
  meltable, a saucepan's, kettle's or evaporating dish's water), `crystallizes {item, g?, tol_g?}` (an evaporating dish ends holding g grams of crystals, default all its
  solute, within 2 % or 0.05 g), `dissolves {item, before_s?}`, `dissolves_first {a, b}` (both finish: the sooner; else the larger share),
  `saturates {item}`, `mass_same {scale, tol_g?}` (default 1 g) and `mass_changes {scale, by_g, tol_g?}` (default 0.2 g or a tenth of by_g) — a kitchen
  scale's mean over 0.5-0.6 s after the release (settled: its reading closes in with about 0.05 s) against the last 0.3 s —, `state {item, is: solid | liquid
  | gas | melting | boiling}`, `mixes {item, at_least?}` (default 80 %), `pressure {item, kpa, tol_kpa?}` (default 10 %, mean of the last 1 s), `volume {item,
  ml, tol_ml?}` (default 5 %), `separates {item}` (a sieve: ≥ 95 % of the small part through and ≤ 5 % of the big; a dish: ≥ 90 % of the iron out, ≤ 5 % of the
  rest; a filter funnel: ≥ 95 % of the undissolved solid on the paper and ≥ 80 % of the water through); with fluids' `floats` / `sinks` for the density cubes
  and heat's `dries` for an evaporating dish (its water_g reading, on the lesson clock).
- **View** (`mod-matter.js`): a hot plate under an acrylic box (glowing as it heats), a syringe with printed marks, a balloon in a glass bowl, a tumbler of
  water with a paper cup that pours, a zip bag (its water drawn as it melts), a snapping chocolate bar, a PET bottle (foam, a balloon that fills, bubbles),
  a glass dish, a wire-mesh sieve that shakes over a tray, the cubes; the `matter:particles` plugin draws the box's particles (coloured by phase and side,
  bonds, piston, divider, labels), the crystals (opaque, so they show through the water), the grains (six depth copies inside the round dish or sieve), the
  wand with its red rod, the balloon and the pump's hose. A ring stand with a glass funnel, its see-through wet paper (the liquid's cone and the sand's cake
  in its tip show), a cup that tips while it pours (its stream), drops from the stem and the filtrate rising in a graduated beaker; a glass evaporating
  dish (its water a spherical cap that sinks, steam while it boils, a crust of white crystals round the old water line and on the bottom) on a hot plate
  that glows while on; labels with the lesson clock (minutes, hours, days). Every mesh a hook scales is built at its real size (the wide camera frames
  the models' meshes) and instanced meshes are never culled (their instances move).
- **AI** (`plugin` in matter.js): how-to (particle box, syringe, balloon bath, dissolving, conservation on a kitchen scale, mixtures and the wand, density),
  plan / edit / refine lines (weigh only moving items resting on the scale; slow things need `time_lapse`; an edit that changes what a goal's number expects
  updates it: −0.524 g of CO2 per g of soda open while the vinegar lasts, −0.34 g/g with a balloon, 6080 ÷ push_to_ml kPa, Charles' mL), 15 worked requests
  (X1-X14, each with `how` and a plan: every one validated, solved and met in the bundle by web/ai/test/matter-plugin.test.mjs) and 3 more for filtering
and evaporating (sand from salt water; salt back on a hot plate; a dish on a sunny windowsill), 11 goal kinds with aliases (crystallizes: salt_back,
recovers…; separates: filters…),
  23 knobs (water_temp_c, stir, grain, solute_g, water_ml, heater_w, temp_c, sample_g, load_kg, open_at_s, push_to_ml, balloon water, soda_g, react_s, closure,
  aperture_mm, shake_until_s, shake_mm, wand_height, wand_s, magnet link, end_bar, snap_at_s; and 9 for separating: the funnel's funnel_mm, rinse_ml, paper
  (cost 3), water_temp_c, pour_s, the dish's heater_w, water_ml, humidity_pct, heat (cost 4); their words start with verbs the card puts in the past),
  request words per prop (`words.keys`: "stop stirring" keeps stir the person's), `words.regoals` (a new plug-in point,
  web/sim/plugins.js moduleRegoals → web/ai/orchestrator.js goalsAsked: "take the cap off the bottle", "uncap it", "seal the bag" let the edit change
  its goals, and the edit line says opening a sealed container makes mass_same mass_changes {by_g < 0}: the expected result of the person's change), the edit digest's lines (a glass's grams and its saturation, the box's
  state path and when it began melting and boiling, a syringe's p·V, the fizz's CO2, a sieve's and a dish's shares), change words, `place` (zip-bag a
  container: its interior). **Shared fix** (ai/catalog-digest.mjs): a module's `place.containers` types are containers in the digest's index, so
  `place.inside` a water tank, a bowl or a zip bag validates (ai/schemas.mjs refused every module container before).
- Checked: research/rw-validate-matter.ts (163 of 163 checks pass, 2026-10-20, with filtering and evaporating) (`node --no-warnings --import ./tools/engine-math-node.mjs research/rw-validate-matter.ts
  [gas|heating|boyle|charles|piston|graham|mixing|dissolve|saturate|settle|mass|density|sieve|magnet|filter|evaporate|demos|fuzz|all]`: the gauge within 8 % of nRT/V (air
  20/150 °C, helium, nitrogen −50 °C; +4.6 % at 20 °C), speeds to 0.005 %, the 0 °C and 100 °C plateaus to 1/60 s of fusion ÷ power and vaporization ÷
  power, Boyle (three syringes: 45 mL +1 %, 30 mL +5.8 %, 20 mL +7.5 %), Charles to 0.00 %, pistons to 0.00 %, saturation (salt 20/60 °C, sugar) within 1 %,
  settling 0.3-2 mm grains at the Schiller-Naumann speed, the scale through snapping, dissolving, open/capped/ballooned fizz (−2.62 / 0 / −1.72 g) and a
  pumped ball (+5.30 g), cube masses and block volumes to 0.2 %, sieving, the magnet's field and lift, the 20 demos and determinism, a 24-scene fuzz);
  tools/parity/matter.mjs --engine (1004 checks over 304 documents: Python == JS, the node engine == the bundle on 30 runs; 0 mismatches); the 23 demo scenes (scratchpad engine4/matter/scenes, also tools/parity/fixtures/matter-demos.json) met on both
  engines with identical tracks and summaries; matter.test.ts 19/19, separate.test.ts 10/10; web/ai/test/matter-plugin.test.mjs (14 of 14). AI acceptance on a server (:8920) with Opus
  5.5: three plain requests through New → Build with AI built working scenes (3 of 3: salt dissolving on a scale, mass the same; sugar in hot vs cold
  water; sand and iron filings separated by the wand), three Edit with AI requests on demo scenes made exactly the change with an honest card (3 of 3:
  "hot water 80 °C" kept its goal; "stop stirring" broke "dissolves", said so, and offered a checked fix through the module's grain knob, table → powder,
  which met both goals when applied; "10 g of soda" updated the scale goal to −3.7 g, the vinegar-limited CO2, and met it); the same six again on
  20 Oct with filtering and evaporating in (runs 3 and 4: 6/6 each). Separating (20 Oct): builds "separate sand from salt water with a filter funnel",
  "get the salt back by evaporating it on a hot plate", "a dish of salt water on a scale on a sunny windowsill for a few days" (3/3 twice) and "separate
  sand, salt and water: filter, then evaporate" (1/1: a filter funnel beside a hot plate's dish, three goals met); edits "use a coffee filter", "make the
  funnel 50 mm" (exact, goals kept) and "turn the hot plate down to 100 W": in the first run it broke dries/crystallizes and the card said so honestly
  ("I couldn't find a change that works (I tried 53)": the run's lesson time, not a knob, was short); the edit line now says a slowed process needs
  more lesson time, and in the final run the AI turned it down and raised the time-lapse 150 → 500 itself, saying why (5/6, then 6/6).
- Separating checked (2026-10-20): `research/rw-validate-matter.ts filter|evaporate` (22 checks: the drain's τ against Darcy and Whatman's Herzberg time to
  0.01 % at 20 and 50 °C, every drop accounted for, the sand kept, the salt through within 2 %, 17 min for 110 mL [LAB 10-30], chalk kept by paper and through a
  coffee filter, its cake 8 × slower; the boiling point 101.79 °C (K_b·i·b), crystals at the saturated strength 28.09 % (S/(100 + S)), all 5 g left, 16.5 min
  to dry against an ideal 15.3 min of heat ÷ (½·300 W), 2.1 mm a day in a room, cooled to 17.3 °C (above the 13.7 °C wet bulb), a scale falling by the
  water only); the three demos (x10d-filter, x10e-evaporate, x10f-windowsill) met on both engines with identical tracks; separate.test.ts 10/10.
  Stability: the matter items of every one of the 5000 engine-fuzz scenes that has one (1305 scenes with the 14 types, props at their corners and far
  outside their ranges, held, fixed, clustered), alone with the table: 0 exceptions, 0 non-finite placements, 0 wild bodies; the slowest 70 s of a loaded
  laptop for 1-4 s of run (the particle models at 160-400 particles and grains are the cost; the filter and the dish take milliseconds). An evaporating
  dish on its hot plate welds every part to the plate (welds one level deep, as items.py's `_world_poses` and the AI's geometry expect).
  The whole suite after this change (20 Oct, on a loaded laptop): tools/parity/run.sh's 20 steps one by one, 19 pass (fuzz-live: 1 mismatch, magnetism's
  ring-magnets at a degenerate size give a 0-wide dowel that Python's overlap check divides by), tools/parity-engine.mjs --catalog ALL IDENTICAL (322 scenes),
  identity 23/23 with the modules off and only the catalog differing with them on, machines tests 4/4, p2/p3 pass; p4 the same two over-time fixtures
  and 4 planck breakdowns in 4959 fuzz scenes (5 in 4962 before), and 1 in the 1305 matter scenes run whole (a dynamics cart's load in the TOI solver,
  not repeated when that scene is run again, alone or after its shard's earlier scenes, with or without its evaporating dish).
- Closed containers checked (20 Oct, `research/rw-validate-matter.ts closed|boyle`): Boyle to 0.1 % at 45, 30, 20, 10 and 5 mL (5 mL pushed in 0.1 s
  too) and the plunger's push to 0.1 %, said once past 200 N; Henry's constant 1.688 g/L/atm; a capped bottle's dissolved CO2 and pressure exact; the
  cap pops past 900 kPa once (30 g of soda in 400 mL of 10 % vinegar), the scale then down by what escaped, less than open; a vacuum's balloon scale
  unchanged, its dish refused (event and warning); 1000 g of CO2 in 1 mL held as 1.562 g; 50 kg on 0.5 cm² to nRT/P within 0.03 %; a piston in a
  vacuum carries its load only; holds_at met at 0 °C melting and 100 °C boiling, not at 50 °C or 0 °C boiling. The whole validator 232 of 232
  (all sections, with the concurrent chemistry and model sections), tools/parity/matter.mjs --engine 1487 checks over 451 documents, 0 mismatches
  (holds_at and the warnings Python == JS), identity 23/23 with the modules off (only the catalog differs with them on), matter.test.ts +
  separate.test.ts 29/29, web/ai/test/matter-plugin.test.mjs 13/13, machines tests 6/6. Live Opus 5.5 on a server (:8940): builds "push a sealed
  60 mL syringe in to 15 mL" (405 kPa, "4 times", met; it read 374 kPa before), "show the temperature stays at 0 °C while the ice melts" (the AI
  chose holds_at: "0 °C from 0.842 s to 3.617 s", met), "30 g of soda in 400 mL of 10 % vinegar, capped, on a scale" (the cap pops, the scale
  −11 g, met); edits "take the cap off the capped bottle" (closure open and its scale's mass_same became mass_changes −0.79 g, all 3 met: the
  regoals words; the AI dropped the other two goals' tol_g, said on the card), "push the plunger further, to 10 mL" (608 kPa goal, met), "also
  check that the temperature stays at 100 °C while it boils" (a holds_at goal added and met: the orchestrator now reads "check / verify / show
  that …" with a module's outcome words).
- Known limits: the particle model is 2-D with 8-160 particles (the drawn particles' own hits are not the reading); its states follow the 1-atm
  heating curve (a closed box past its vapour pressure is only said); a syringe stays at its temperature however fast it is pushed (a real fast push
  heats the air); a balloon in a vacuum keeps its 1-atm size; the cap's 900 kPa and the 300 s degassing are provisional; a dissolving glass's crystals are pinches of
  grains; a kitchen scale's start reading is taken 0.5-0.6 s after the release (things that change before that count from there); a grain sieve or a dish
  takes 2-7 s of run time in the browser at 150 grains (fewer `grains` is faster). Filtering: the funnel and paper are a fixed setup (nothing falls into
  them from other items); the filtrate is not passed to another item (an evaporating dish beside it is given the filtrate's water and salt by its own
  props); the boiling point is the ideal K_b·i·b (106.9 °C saturated; a real saturated brine boils at 108.7 °C); the dish is one temperature; sugar boiled
  dry would caramelize (not modelled: it is left as crystals); the hot plate's and the sun's shares are provisional.

- **Chemical changes and models of particles** (2026-10-20, the repair of "the only reaction is baking soda with vinegar" and "no models of atoms
  or molecules"): seven more types, `tooling/src/sim/matter/chem.ts` (roles pack, warmer, rust, indicator, precip, atoms of the process kind
  "matter"). Each chemistry item is a moving item a kitchen scale weighs (what it gains or loses rides on its hidden ballast) and, when the heat
  module is loaded, a node of heat.ts's world: its builder adds a heat record (a `body` for a pouch or a pad, cells 1; a `water` for a beaker's
  liquid, the record `<item>/liquid`), so a thermometer touching it or standing in it reads it and it exchanges heat with what it touches and the
  room as everything there does. chem.ts puts the chemistry's heat into that node (`HeatWorld.heat`, booked in `ledger.chem`), sets the body's heat
  capacity at the start to what the item really holds (water and a salt in a pouch are no material of heat's table; `start0` follows, so the
  books close), and gives the slow sources (a hand warmer, rusting) as the power of the item's own heater record (`<item>/warmth`, 0 W, setpoint
  1500 °C), which heat.ts spreads over its sub-steps (an impulse at a long time-lapse beat would jump and decay in one beat). Without the heat module:
  a lumped model of its own, h = 10 W/(m²·K) to the room (Incropera: natural convection about 5, radiation about 6), exactly integrated.
  - `cold-pack` (an instant cold pack lying flat, 15 × 12 cm: `chemical` ammonium nitrate | urea | ammonium chloride | calcium chloride (a hot
    pack), `salt_g` in a `water_ml` bag burst at `squeeze_at_s`, dissolving first order over `dissolve_s` lesson seconds toward all of it or what the
    water holds at its temperature now (solubility tables [CRC], each from its ice-salt eutectic, where it would freeze rather than cool: not
    modelled); ΔsolH +25.69, +15.1, +14.78, −81.3 kJ/mol [CRC-H; NIST-WB]; readings temp_c, dissolved_g, dissolved_pct, heat_kj (+ given out, −
    taken in), burst; auto prop change_c = −n·ΔH/C, the change with no heat in or out). 30 g of ammonium nitrate in 100 mL: 20 → 1.9 °C at its
    coldest (−20.1 °C with no heat in), back toward the room over 20 minutes; 30 g of calcium chloride: 20 → 64-68 °C.
  - `hand-warmer` (13 × 9.5 cm: `iron_g` of iron powder (55 % of the fill: water 20 %, the rest vermiculite, carbon, salt), lasting `lasts_h`, opened at
    `open_at_s`: oxygen comes in at a steady rate n/lasts (at most 20 W of heat: what a breathable film lets in; real warmers peak at about
    60-70 °C: a modelling bound), the last 15 % of the iron fading; 412.1 kJ per mol of iron (4Fe + 3O2 → 2Fe2O3,
    ΔfH −824.2 kJ/mol [CRC-H]) and 24.0 g of the air's oxygen per mol, which the scale gains (20 g: +8.6 g over its life); readings temp_c,
    iron_left_pct, oxygen_g, power_w, heat_kj; auto power_w, oxygen_g). Default 8.2 W: on the table 20 → 41 °C in 14 minutes (time_lapse 120), on a
    kitchen scale's metal platform less (it conducts the heat away).
  - `steel-wool` (a 5 g pad soaked in vinegar | salt water | water | dry: half of its iron can rust (`RUST_SHARE`), 63 % of that in 0.5 | 1 | 3 | 60 days,
    from `from_s`: modelling choices, said on the prop; readings rust_pct, gained_g (0.4298 g of oxygen per g of iron), oxygen_ml (at 20 °C, 1 atm),
    temp_c (a few °C warm at first); auto gain_g). It turns orange-brown as it rusts (5 % shows).
  - `indicator-cup` (a 250 mL glass beaker of red cabbage juice, `water_ml` at `water_temp_c`; `add` vinegar | lemon juice | baking soda | washing soda |
    none, `amount` (mL of a liquid, g of a powder) poured from a little paper cup at `add_at_s`, a second `then_add` / `then_amount` at `then_at_s`;
    `fizz_s`): the pH by the charge balance of an ideal solution (Ka acetic 1.75e-5, carbonic 4.45e-7 / 4.69e-11, citric 7.44e-4 / 1.73e-5 / 4.02e-7, Kw
    1e-14 [CRC]; bisection −1…16) — 10 mL of vinegar pH 2.94 (red), 2 g of baking soda 8.35 (blue), 2 g of washing soda 11.80 (green), the analytic values
    to 0.15; CO2(aq) past 1.69 g/L [CRC] bubbles out within `fizz_s`, the rest leaves toward the air's over about an hour (a modelling choice); the
    heat by the species' ΔfH relative to water [CRC-H] (baking soda after vinegar cools it 1.5 °C; washing soda warms it 1 °C); a powder dissolves
    only as far as the juice holds it (baking soda 9.6, washing soda 21.5 g per 100 g at 20 °C [CRC]: the rest stays on the bottom, left_g, and
    dissolves as an acid uses up what is dissolved); colour bands by pH:
    red < 3 ≤ pink < 5 ≤ purple < 7.5 ≤ blue < 9 ≤ blue-green < 10.5 ≤ green < 12.5 ≤ yellow (approximate, as widely published); readings ph,
    color_band (0-6), co2_g, escaped_g, fizz, temp_c, left_g.
  - `reaction-cup` (a beaker of `soda_g` baking soda dissolved in `water_ml`; `cacl2_g` calcium chloride poured in at `mix_at_s`; baking soda past 9.6 g per 100 g lies on the bottom and dissolves as the
    reaction uses it, +18.7 kJ/mol): it dissolves (−81.8
    kJ/mol by ΔfH), Ca2+ + 2HCO3− → CaCO3 + CO2(aq) + H2O (+19.6 kJ/mol) over `react_s`, CO2 past 1.69 g/L bubbles out (+20.3 kJ/mol), the chalk's 10 µm grains
    settle by Stokes (0.093 mm/s); readings solid_g, cloudy (1 − e^(−c/0.5 g/L): a modelling choice), settled_g, co2_g, escaped_g, fizz, temp_c; auto chalk_g,
    co2_g. 5 g + 5 g in 100 mL: 2.98 g of chalk, 1.15 g of gas out (the scale −1.14 g), 20 → 28 °C.
  - `molecule` (`molecule` water | carbon dioxide | methane | ammonia | oxygen | nitrogen | hydrogen, `style` ball-and-stick | space-filling, `scale_cm`
    cm per Å, `labels`): its atoms at the real molecule's bond lengths and angles [CCCBDB] (water 0.9572 Å, 104.52°, its H's below; CO2 1.16 Å; methane
    1.087 Å, 109.47°, one H up; ammonia 1.012 Å, 106.67°), balls 0.6 × the covalent radius [Cordero 2008] or the van der Waals radius [Bondi 1964],
    CPK colours; `crystal` (`lattice` salt: (2·cells+1)³ ions 2.82 Å apart, Na+ and Cl− alternating, ionic radii [Shannon 1976]; diamond: cells³ cubic
    cells, a = 3.5668 Å, each carbon bonded to four; ice: one puckered layer of 2·cells rows × cells hexagons, O–O 2.76 Å, O–H 1.00 Å, the ice rules,
    hydrogen bonds dotted; `cells` 1-4, `style`, `scale_cm`, `labels`). The physics is one rigid weld group of balls in the item's plane: one ball per
    column of atoms one behind another (as big as the biggest), the model plastic's density raised so the balls weigh what the whole model's would; its
    root ball (`a1`) draws the whole model in 3D (every atom at its real depth, sticks, double and triple bonds side by side), the other balls nothing;
    the `matter:atomlabels` view plugin puts its formula and name over it. Readings (fixed, record `readings`): atoms, bonds, mass_u, bond_length_pm,
    bond_angle_deg (molecules); atoms, cells, sodium, chloride, carbon, oxygen, hydrogen (crystals). They are models, scaled up about 10⁸ times.
  - Goal kinds (Python == JS == the AI's checks): `warms_by {item, at_least_c}` / `cools_by {item, at_least_c}` (its highest / lowest temperature
    against its first: temp_c, a thermometer's reading, a cup's water_temp, a heat body's temp — any item that has one), `color_changes {item, to?}`
    (an indicator's colour band at some moment other than its first, and with `to` its end colour that one; a reaction-cup clear → cloudy white; steel
    wool ≥ 5 % rusted: orange-brown; `to` words: red, pink, purple, blue, blue-green, green, yellow, white, brown and violet, magenta, teal, cloudy,
    rusty, orange). The AI plug-in (web/sim/modules/matter.js `plugin`): how-to paragraphs, plan/edit lines, ten examples (cold vs hot pack, a hand warmer,
    vinegar then soda, acid or base, the three signs of a precipitate on a scale, steel wool on a scale for days, molecule and crystal models), the
    edit digest's lines (coldest/hottest, colour sequence, pH, gas, chalk, rust, atoms), knobs with honest words (salt_g, water_ml, dissolve_s,
    chemical; lasts_h, iron_g; soaked, wool_g; amount, then_amount, add; cacl2_g, soda_g, react_s), change words for every new prop, placement (a
    thermometer goes inside either beaker: `place.interior`).
  - Checked (20 Oct): `research/rw-validate-matter.ts chem|models` (the heat booked = n·ΔsolH to 0.01 %, the cold pack's coldest 0.5 °C above its no-heat-in
    −0.08 °C with a 5 s dissolve, the hot pack's 67.7 °C against 69.2; the hand warmer's heat, power and oxygen exact; the three pH values against the
    analytic ones; the chalk and the gas to the stoichiometry; the goals' verdicts; steel wool's scale gain = its rust's oxygen; water's balls at 104.52° and
    0.9572 Å; 125 / 64 / 48 atoms); tools/parity/matter.mjs --engine (Python == JS on 451 documents of all 21 types, the node engine == the bundle on 66
    runs, summaries with every goal kind sampled: 0 mismatches); identity: the 22 scenes byte-identical with the modules on and off.
  - Known limits: the indicator's and the precipitate's chemistry keep their volume (over days of time-lapse the heat world's water can
    evaporate away: then the item's temperature holds at its last value and no more heat goes in); a pack is one temperature (no cold spot); below a salt's eutectic it would freeze (not modelled); the indicator's pH ignores
    activities and the CO2 the juice holds from the air; the hand warmer's rate does not depend on its temperature or on what covers it; how fast steel
    wool rusts is a modelling choice; a molecule's 3-D atoms outside the item's plane (methane's back H's) collide as their shadow on it.
## Flowing liquids (module `flow`, 2026-10-20): pouring, taps, jets from holes, siphons, waterwheels, puddles, mixing colours, thick liquids
Files: `machines/mod_flow.py` and its exact port `web/sim/modules/flow.js` (catalog, goal kinds, the AI plug-in), `tooling/src/sim/flow.ts` (the
physics, pure: particles and basins), `tooling/src/sim/modules/flow.ts` (the process kinds, the hand-off to the liquids module), `web/models/mod-flow.js`
(models and the view plugin "flow"); tests `web/ai/test/flow-plugin.test.mjs`, `tools/parity/flow.mjs` (+ `py_flow.py`, in `tools/parity/run.sh`);
validator `research/rw-validate-flow.ts` (a gate: exits 1 on any failure). Category "Pouring & flowing".
- **Items**: `pitcher` (`vessel` pitcher 10 × 17 cm glass, 750 mL | jug 13 × 22 cm plastic, 1500 mL | measuring cup 9.5 × 12 cm, 400 mL | cup 7 × 9.5 cm,
  200 mL; `fill_ml` of `liquid` (+ `salt_pct` for salt water) with `dye`; held by a hand: its item position IS ITS POUR LIP, fixed in the air; from `pour_at`
  it tips over `tip_s` to `tilt`° toward `pour_to`, back upright from `back_at` (0: never)), `tap` (a chrome wall tap whose stream falls straight down
  from its mouth (the item position) at `flow_ml_s` (EPA WaterSense: kitchen ≤ 139 mL/s) from `on_at` to `off_at` (0: stays on), `nozzle` aerator 22 mm
  | plain 12 mm, `liquid`, `dye`), `leaky-bottle` (a 2 L PET bottle, 10.2 cm inside and 23 cm of straight body, on a wooden block `stand_cm` high: `holes`
  1-4 up the side it is `facing` from `lowest_cm` every `spacing_cm`, `hole_mm` wide, water `fill_cm` deep, `kept_full` (a hose tops it up: a constant
  head), `cap` (no air gets in, nothing comes out), the tape off at `open_at`), `hose` (a siphon: links `from` and `to` containers, or a free end at
  its item position; `diameter_mm` inside, `length_m` (0: its path's), `inlet_cm` over the source's floor, the clip opened at `open_at`), `waterwheel`
  (on a fixed axle at its item position: `diameter`, `paddles`, `paddle_depth` front to back, `axle_friction` N·m·s, a load). Liquids at 20 °C (the
  liquids module's table, the same words and numbers so the same liquid joins the same layer): water 998.2 kg/m³ 1.002 mPa·s [IAPWS-95], salt water by
  its salt [CRC], sea water 1024.8 / 1.08 mPa·s [SHARQAWY], vegetable oil 920 / 0.06 Pa·s [NOUREDDINI], honey 1420 / 10 Pa·s [YANNIOTIS], corn syrup
  1380 / 2.5, dish soap 1050 / 0.5, rubbing alcohol 880 / 2.5 mPa·s (the last three approximate). Dyes are absorbances per cm (Beer–Lambert): red,
  orange, yellow, green, blue, purple; a mixture is named by its colour through 5 cm (blue + yellow → green, red + blue → purple, red + yellow → orange,
  "clear", "brown").
- **Catching**: once a scene has a pitcher, tap, leaky-bottle or hose, a build hook gives every catalog `cup`, `plastic-cup`, `glass-jar`, `coffee-mug`,
  `bucket`, `bowl` and `box` a `flow-basin` record (its inside is read from its floor's and walls' outlines at the start); the liquids module's fixed
  `water-tank`, `beaker`, `measuring-jug`, `graduated-cylinder` and `density-column` take poured liquid through that module's exported `liquidsIn`
  (their `volume_ml` and level rise, `received_ml` counts it, a floater in them rises with the water) and feed hoses; their overflow becomes a pour over the
  rim. A scene with no flow item gets no records and builds and runs exactly as before.
- **Records** (`doc.processes`; full field lists in tooling/src/sim/modules/flow.ts's header): `flow-pour` (a pitcher: its root solid turns about the
  lip; `inside` 4 points in that frame, `depth`, `lip`, `wall`, `liquid {words, density, viscosity}`, `dye [3]`, `volume`, `tilt`, `at`, `turn`, `back`),
  `flow-tap {at, angle, d, q, on, off, liquid, dye}`, `flow-vessel` (the bottle: `layers`, `holes [{x, y, angle, d}]`, `cap`, `full`, `open`, `ground`),
  `flow-basin {floor, left, right, round, depth}`, `flow-hose {from, to, out, d, length, inlet, open}`, `flow-wheel {solid}`. All are worked by ONE
  process (the first flow record) every 480 Hz step from t = 0.
- **Physics** (`flow.ts`; details and sources in its header): FREE liquid is particles, a position-based fluid (Macklin & Müller 2013) in the machine
  plane at a 5 mm rest spacing, mass-weighted (heavier liquids sink under lighter ones), one-sided density constraint (pushed apart, never pulled into
  clumps), an implicit no-slip viscosity (honey creeps, water splashes; mirror ghosts at walls weighted 2 so plane Poiseuille flow comes out right),
  two-way momentum with solids (a jet turns a waterwheel, a stream weighs on what it lands in), dye mixed by the flow's own shear (Smagorinsky 0.17,
  Schmidt 0.7); each particle carries the VOLUME it stands for, so every millilitre is counted whatever the slice looks like. STILL liquid is a basin
  per container: level whatever the tilt, layered by density, its volume conserved exactly; out through holes as a sharp-edged orifice (C_d 0.61,
  C_v 0.97 [WHITE]) with Sampson's creeping flow added for thick liquids, over the lowest rim as a weir (C_d 0.62 [HENDERSON]) in series with Nusselt's
  film (honey oozes as a film), through hoses by Bernoulli with an entrance loss 0.5 and Poiseuille / Blasius friction (a siphon runs until the
  surfaces are level and breaks when the source falls below its inlet; a filled hose flows from the HIGHER surface to the lower whichever end is
  called `from`, and says so). Particles that fall into a basin's liquid or settle in its bottom join it; those that settle on a fixed surface within
  about 6° of level (n_y > 0.995) outside any container form a puddle (`puddle_ml` on that item, drawn as a thin film laid along that surface); on
  anything steeper they run on down it (Nusselt: a 2 mm film on 10° flows at about 2 m/s), so a 10-30° plank delivers a pour into a bucket below its
  low end; those that leave the stage are spilt. A container's liquid adds its mass to the container's body and is carried by its floor's solid
  (`SolidHandle.carry`, tooling/src/sim/plugins.ts: `mass()` includes it), so a kitchen scale under a mug a tap fills reads the mug and its water.
  A moving thing in a catalog container's liquid (a cork, a duck, a ball in a jar a tap fills) floats: the liquids module's `fluidPushes` on that
  liquid as it stands now (buoyancy, drag, added mass), with that module's readings `submerged`, `buoyancy_n`, `afloat`, `sunk`, `draft_mm` (its goals
  `floats`, `sinks`); not yet: the level is not raised by what floats in it, and a container tipped past 10° floats nothing. Budget: at most 4000 particles in a run (a source waits when the
  budget is used: its volume is owed, never lost), particles slow for 120 steps against a still solid sleep and wake when something moves near them; lesson scenes cost 0.25-0.8 s CPU
  for 3.5-14 s of run on a laptop.
- **Readings** (track.state): pitcher `left_ml, poured_ml, flow_ml_s, tilt_deg, lands_x` (where its stream came down); tap `flowed_ml, flow_ml_s,
  lands_x`; leaky-bottle `left_ml, level_mm, poured_ml, flow_ml_s, jet<k>_ms, reach<k>_m` (k = 1 the lowest hole; reach measured out from the hole at
  the level the bottle stands on); hose `moved_ml, flow_ml_s`; a catching container `liquid_ml, level_mm, overflow_ml` (gone over its rim), `tint_r,
  tint_g, tint_b` (what shows through 5 cm of its BIGGEST layer, 0…1: liquids that do not mix, oil on blue water, are never blended into green) and
  `puddle_ml`; a liquids-module container `received_ml` (and its own `volume_ml`, `level_mm`); waterwheel `rpm, turns`. Events: "<tap> turns on (100
  mL/s)", "<tap> turns off after 400 mL", "<pitcher> starts pouring", "<pitcher> is empty", "<bottle>'s jets start (3 holes)", "<bottle>'s holes open,
  but its cap is on: no air gets in, so no water comes out", "<hose> starts siphoning" (after its first mL), "<hose> runs from <b> to <a>: that
  surface is the higher", "<container> overflows", "<container> fills to N mL" (at the moment it last gained), "<bottle>'s hole k stops spurting",
  "<wheel> starts turning", "<hose> stops: the two surfaces are level"; at the start: "only N mL fits in <pitcher> (not M mL): it is filled to the
  brim" (the record's `asked`, set only when fill_ml is past the brim), "<bottle> has room for only k of its n holes…" (`dropped`, only when holes
  were left off), "<pitcher> starts inside <fixed solid>…" (a pitcher in a table top: web/sim's layout warns only of moving things), "<solid> is in
  the way of <wheel>'s paddles: it cannot turn freely". The waterwheel is a fixed machine (catalog `dynamic: false`; its hub and paddles are moving
  solids unless the item is fixed), so the catalog-wide start speed and spin are not its props.
- **Keyframes** (`ctx.keyframe`, drawing only): the particles under the first flow item (`.p`: id, x mm, y mm, look per particle, 60 a second), each
  container's layers (`.b`: top y and look per layer), its inside (`.i`), puddles (`.d`), each hose's path (`.h`). Typical tracks 0.3-1 MB.
- **View** (`web/models/mod-flow.js`): a glass pitcher, plastic jug, measuring cup and cup that tip about the lip, a chrome tap, a PET bottle with its
  holes on a wooden block (red cap), clear hose tubing, a waterwheel (blue rim, yellow paddles, hub and bracket); the plugin draws particles in flight
  stretched along their motion as a round stream as thick as continuity allows (so a pour or a jet reads as one stream), landed particles as drops,
  each container's liquid as a body filling its inside to the level (a lathe upright, an extrusion cut at the level when tipped) in its mixed colour,
  puddles as thin discs, a hose's liquid while it flows, and the tint of coloured water poured into a liquids-module container.
- **AI** (`plugin` in web/sim/modules/flow.js): how-to (the item position is the pour lip / the tap's mouth; a pitcher's stream LANDS PAST THE LIP, 7-10 cm
  for water, about 3 cm for honey; where to put two pitchers into one jar; jets need clear space; compare liquids at the same moderate tilt), plan / edit
  / refine lines; goal kinds `fills {container, at_least_ml, before_s?}`, `overflows {container, before_s?}` (overflow_ml or a liquids container's
  spilled_ml past 0.5 mL), `empties {item, before_s?}`, `pours_faster {a, b}`, `fills_faster {a, b, ml?}` (a gains ml, default half of what the
  less full ends with, at least 0.1 s and 5 % sooner), `jet_farthest {item, hole}` (by 1 cm and 5 % over each other jet), `reaches_farther {a, b,
  hole?}` (bottle a's jet lands farther out than b's, by 1 cm and 5 %), `turns {item, at_least_rpm?, before_s?}` (held for half a second: a
  one-frame spike as it jams never counts; `held_rpm` in its entry), `turns_faster {a, b}` (each wheel's best speed held half a second, by 2 rpm and
  10 %), `mixes_to {container, color}`, `delivers {item, at_least_ml}` (Python == JS; aliases fill, fills_to, overflow, squirts_farther,
  spins_faster, fills_first, spins, siphons…; `fills` and `overflows` have an `aim`: the pitcher, tap or hose end whose stream misses moved by its
  miss); knobs with honest whys (pitcher tilt/pour_at/tip_s/fill_ml/back_at/liquid, tap flow_ml_s/on_at/off_at, bottle fill_cm/hole_mm/stand_cm/
  kept_full/cap, hose diameter_mm/inlet_cm/from/to, waterwheel axle_friction (cheap: freeing an axle is the natural fix)/paddle_depth); edit-digest lines
  (where a stream lands: "its stream comes down at x 1.178 m: INTO Beaker (opening x …)" or "… it MISSES Glass jar (opening x …) by 7.5 cm to the
  left: move the pitcher 10 cm right"; held / poured / left; jets' speeds and reaches; a siphon's flow); change words in real units ("water 10 → 20 cm deep (lowest jet 1.14 → 1.77 m/s)", "axle drag 0.05 → 0.01 N·m·s");
  pitchers and taps are held by the hand (they stay where they are put) and HOVER (`place.hover`, web/sim/plugins.js `hoversByModule`: the solver
  places them after the rest and raises one clear of a bowl or box it would start inside, never shoves the bowl aside); thirteen worked examples
  with their words (`how`, which the digest lists) and plans, each solved and met in the tests: two liquids into one jar, a tap filling a mug until
  it overflows, fair tests (deep vs shallow bottle: reaches_farther; strong stream vs trickle on two waterwheels: turns_faster; two taps: fills_faster),
  water down a slide into a bucket, a cork floating up in a jar a tap fills, a mug of water weighed on a kitchen scale. Request words: the title
  ("Pouring, flowing and spilling liquids: taps, faucets, overflows, spills, siphons, puddles, jets and waterwheels") and tags of the phrases teachers
  use ("cup of water", "pour oil", "coloured water", "water runs down", "tap water"...) pick this module's full section in the tiered digest
  (ai/catalog-digest.mjs promptCatalog) for plain pouring requests. Make-it-work (web/ai/fixer.js): an on/off or pick-from-list setting the person
  named without an amount ("put the cap on") is never flipped back or swapped, a number that follows a named choice (a sail's area its size) is never
  turned back the other way (forward() reads the built values), and when only that undo would work the search runs it once and the card says so
  (`undoOnly`: "Only undoing your change would make it work (take the bottle's cap off: with the cap on no air gets in…)"); a goal's `aim` gets the
  run and may move a thing (never what the person placed).
- Checked (2026-10-20): `research/rw-validate-flow.ts`, 48 of 48: orifice jets 5-30 cm deep within 0.3 % of C_v·√(2gh) and C_d·a·√(2gh) [WHITE,
  TORRICELLI], honey through a 2 mm hole within 0.1 % of Sampson's r³Δp/(3μ), weirs within 0.2 % [HENDERSON] and a honey film within 2.3 % of
  Nusselt's g·H³/(3ν), Poiseuille and Blasius hoses exact, layered basins (honey, water, oil) level when tipped 34° and their bottom pressure Σρ·g·h
  exact; the three jets of a bottle on a 20 cm block 1.134-1.769 m/s within 0.3 % and landing within 1 % of v·√(2y/g) (the lowest farthest; standing on
  the table the middle one farthest); draining √h(t) within 0.1 mm; a siphon's flow 113.9 vs 113.8 mL/s (Bernoulli with losses), stopping level within
  0.5 mm, breaking at its inlet, no liquid made or lost; a jet's push on a plate within 9 % of ρ·Q·V; shear waves decaying at ν·k² within 7 % (honey),
  2.4 % (corn syrup), 0.1 % (dish soap); corn syrup between walls 4 cm apart within 1.4 % of plane Poiseuille's g·G²/(12ν); cups tipped 75°: honey
  takes 7.7 s to pour half against water's 2.9 s; pours landing in a bucket and a jar; blue + yellow mixing to exp(−ā·5 cm) exactly; a mug's mass
  carrying its water; every millilitre conserved to 10⁻⁹ (containers, particles, puddles, spills, inflow); determinism (byte for byte); a waterwheel at
  141 rpm under a tap; 12 random scenes finite. The ten demo scenes (pour into a beaker, honey vs water, jets, mixing green and purple, a waterwheel,
  a siphon, a tap filling a tank with a floating cork, a mug, a jug emptied) identical on the server's engine and the bundle with every goal met (0.25-0.8
  s CPU each); `tools/parity/flow.mjs --n 20 --engine` 0 mismatches; `web/ai/test/flow-plugin.test.mjs` 8 of 8 (make-it-work finds a checked fix
  through the module's knobs for a pour that misses its jar and a waterwheel too loaded to turn); scenes without flow items byte-identical (22 scenes,
  both languages).
- Re-checked after the repair (2026-10-20): `research/rw-validate-flow.ts all` 60 of 60 (new: 10°, 20° and 30° planks deliver 459, 492 and 497 mL of a
  500 mL pour into the bucket below their low ends; a tap filling a mug on a kitchen scale raises it 327.8 → 509.7 g for 180 mL; a cork in a jar a
  tap fills rises 4.8 cm and floats 19.9 % under (cork/water ≈ 0.2); a hose named from the lower beaker siphons 777.5 mL from the higher; a deep
  bottle's jet 0.348 m against a shallow one's 0.191 m (√(17/5) within 1.2 %); wheels under 140 and 30 mL/s 145.8 against 79.2 rpm held; 120 mL/s
  fills its jar in 1.59 s against 3.38 s and overflows it; yellow oil on blue water is "blue", never "green"; on the table the middle jet's 3 % lead
  is too close to call, the goal says so); `tools/parity/flow.mjs --n 20 --engine` 0 mismatches (419 checks, 47 sampled goals with the new kinds);
  `web/ai/test/flow-plugin.test.mjs` 13 of 13 (all 13 examples solved and met; the tiered digest gives 10 plain pouring requests this module and
  not a ramp or a car race; the solver raises a pitcher out of a box; make-it-work re-aims a pitcher at a moved box and never takes a named cap
  off, saying only that would work); the ten demos identical on both engines, every goal met; 22 scenes without flow items byte-identical (both
  ways). Real Opus 5.5 builds and edits (the critic's eight requests: two cups into one jar, a tap overflowing a mug, a ramp into a bucket, a mug
  on a scale, two bottles deep and shallow, two waterwheels, a tap into a jug, two measuring cups then "move the bowl 20 cm right" + "make it work")
  met every goal (scores 8-9/10), the fix offered after the move being "Move Measuring cup 2 19 cm right", checked.
- Known limits: the slice is 2-D (a stream's depth front to back is carried as volume, not drawn from a 3-D flow); surface tension and wetting are
  not modelled (no drips clinging under a spout, no meniscus); a stream striking a plank at 2 m/s splashes a few per cent off it (a flat plank has no
  sides); a puddle on a kitchen scale's fixed platform is not weighed (the scale reads the moving things on it); what floats in a catalog container
  does not raise its level; a stream that would need more than 4000 particles in flight at once waits; pitchers and
  the bottle are moved only by the hand that holds them or stay fixed; liquids do not soak into sand, cloth or paper, and do not dissolve
  (salt water is its own liquid); the flow module's free water does not wet or erode the granular module's beds.

## Engine repair (2026-10-19): stacks placed touching stand (tooling/src/sim/physics.ts)
The document format and the track are unchanged. Every scene runs as before except where moving solids rest inside the time-of-impact pass's target
of one another (below): of the 12 scenarios and 10 gallery scenes only wrecking-ball, whose bricks are built 0.5 mm apart; the other 21 and the catalog
are identical byte for byte (document, resolved, warnings, summary and track; Python and web/sim).
- Cause: every moving body is a bullet, so planck's time-of-impact pass checks its contacts after each step, and its TimeOfImpact counts two solids as
  striking at the very start of their paths when their outlines (the cores inside Box2D's 1 mm skins) are nearer than its target: 0.5 mm between
  polygons, 0.625 mm with its tolerance. A resting pair sits 1.5 mm apart (both skins less the 0.5 mm slop), so only solids placed nearer than
  0.625 mm (exactly touching, or 0.5 mm apart) start inside it. For such a strike the pass moves every body of its island back to where the step began,
  losing what the step's solve did to part them, and parts only those two while it holds every other moving body where it is: a block between the
  table and the block on it cannot get clear, so the same strike comes back up to nine times a step (planck's `maxSubSteps`), each time sliding the
  block about 0.06 mm sideways, and the stack walks over. Measured before (this branch's base): 10 wooden blocks stacked touching spread 1.14 m within
  6 s (0.25 / 0.5 / 0.6 / 0.7 mm apart: 0.88 / 0.86 / 1.46 / 0.59 m; at 0.7 mm the first steps' solve brings some of the gaps inside the target), a
  bottom block set exactly on the table under blocks 1 mm or 1.5 mm apart 383 mm and 27 mm, 1, 1.5 and 2 mm apart 0.0 mm; 10 bricks 1.01 m, 20 blocks
  0.97 m, a 3-2-1 pyramid 55 mm, a 2 × 4 brick wall in offset rows 11 mm, five blocks under a tennis ball 59 mm. Restitution plays no part (these pairs
  close at no speed, so `compensated` gives none), nor does the solve's own position correction: with the pass off, the touching stack stands (0.07 mm).
- Repair (`held`, `began`, `still`, `undoable`, `stuck`, `before`, `inside` in `simulate`): a strike that gets nowhere on a pair at rest inside the
  target is undone. The solve held the contact as the step began, its two solids were inside the target where the step began and are at rest where
  they touch (both slower than VELOCITY_THRESHOLD, 0.2 m/s, at its points), and the strike leaves them still inside the target: its island goes back to
  where the pass found it (each body's path before the pass moved it back, and its motion; its contacts' pushes, the strikes passed on through them, a
  Garwin spring's impulses and the impulses kept for warm starting; the impacts it listed), the contact sits out the rest of the pass, and later
  strikes on it are refused while the pair stays so (planck then puts its two bodies back); the solve parts the pair over the next steps, as it parts a
  pair placed 1 mm apart. A strike that gets its pair clear is kept (a domino set exactly on the table is lifted out of its skin at once, as before),
  and so is every strike on a pair that moves or began the step apart: a real one, which the pass is there to catch, and those an impact drives
  through a stack. In the 22 scenes no strike is undone but wrecking-ball's.
- Why at rest: the repair's first version (reviewed 20 Oct) undid every such strike on a contact the solve held. Squeezed, a struck stack's pairs stay
  inside the target (the pass parts only two bodies at a time), so the strikes of the next steps began inside it too and were undone while the stack
  still moved: a bowling ball let fall 1.5 m on six phones 1.5 mm apart threw them 18 cm up and left one under another; in 160 random drops on stacks
  1.5-3 mm apart a ball went more than 3 mm into a piece 35 times (14 before the repair), 17.1 mm at most (12.5); and the AI panel's recorded breakfast
  stand-in (a closed laptop on its edge that the soda cans tip onto the seesaw) settled upright instead. Its wrecking-ball track is the one approved
  (19 Oct, 23:48: "Approved: wrecking-ball's track may change"); this one gives the same track, byte for byte.
- Measured after: 10 blocks stacked touching 0.07 mm sideways, at most 0.23° of tilt, still to the micrometre from 2 s on (the solve lifts them out of
  each other's skins within about a second, about 1 mm a contact: 10 mm at the top of ten; a stack built 1 mm apart rises 0.2 mm a contact the same
  way); 0.25 / 0.5 / 0.6 / 0.7 mm apart and the two towers on a bottom block set exactly on the table 0.0-0.04 mm, 6-block stacks 0.0-0.03 mm, 1, 1.5
  and 2 mm apart byte for byte as before; 10 bricks 0.03 mm, 20 blocks 0.2 mm, the pyramid 2.8 mm and the wall 3.7 mm (blocks set side by side are
  parted by their skins), five blocks under a tennis ball 0.03 mm; a tower whose blocks overhang their balance point still falls. Engine time (CPU,
  best of 3): the touching 10-block stack 0.2 s (0.7 s before), the pyramid 0.1 s (1.8 s), the wall 0.09 s (4.2-4.4 s), wrecking-ball 0.2 s (0.3 s); a
  stack built 1.5 mm apart, the starter and plinko as before (within the runs' spread).
- Strikes a heavy ball drives through a stack are the pass's, as before the repair. In 400 random drops (impact sweeps of 80, seeds 3, 5, 7, 11 and 13)
  of eight balls, a steel ball to a bowling ball, 0.2-2.5 m onto 3-10 wooden blocks, bricks, phones, books, boards, rulers, Lego bricks, dice or
  erasers stacked 1.5, 2 or 3 mm apart (the tracks are the same until the strike), a ball went more than 3 mm into a piece in 51 (45 before the
  repair), a piece ended passed through another in 11 (19), a piece went faster than 10 m/s in 25 (26) and more than 3 mm into the table in 80 (88);
  the deepest a ball went was 18.6 mm (16.4). A heavy strike on light pieces tumbles differently with any change in how it is solved, so these
  counts move both ways; the six phones above keep their order (one 3.2 mm up at most, 4.8 mm before), and a bowling ball let fall 1.5-2.5 m on five
  blocks 1.5 mm apart goes 0.6-1.8 mm into one (0.5-5.1 mm before).
- What changed in the scenes: wrecking-ball only. Before, its bricks walked up to 3.4 mm sideways and tilted up to 0.6° before the ball came; now they
  rise 1.4-4.8 mm out of each other's skins and do not move sideways (0.01 mm). The ball strikes bricks 3, 2 and 4 at the same moments (1.05, 1.05,
  1.07 s); the tumble after differs: the stories' top speeds of bricks 4 and 5 go 1.7 → 1.8 and 1.2 → 1.3 m/s (every story's `ok` the same; no
  goals), the events gain "Brick 3 hits Brick 4", "Brick 5 hits Brick 4", "Brick 2 hits Brick 3" and "Brick 5 hits Table", "Brick 4 hits Brick 5"
  and "Brick 1 hits Brick 4" become "Brick 4 hits Brick 1", and end positions move up to 73 mm (bricks 4 and 5 end leaning on each other, −21° and
  −32°, instead of flat).
- What changed for the AI panel (web/ai): scenes with things placed touching, or exactly on the table, can play out differently, recorded ones
  included. Three of its tests had recorded the old pass's strikes: chain-guard's h2-no-seesaw (Ball 2 set on the last domino: its row started on its
  own at 0.51 s; now it stands until Ball 1 knocks it at 1.95 s, and the dominoes push Ball 2 into the box at 3.29 s, a fix through the machine, no
  longer refused), make-it-work's breakfast search (a full-thickness closed laptop on its edge there now tips only at its exact place, so the sturdy
  stand-in found is the 6 mm one, and the card says so) and orchestrator's w-add-brick-top (one more brick on the wrecking ball's stack: 4 of 5 still
  fall, as without it; three more: 3 of 5, the heads-up's line).
- Known limits: a pair placed inside the skin is still parted by the solve's position correction, over about a second for a tall stack and with a
  small tilt (0.1-0.3°), as a stack built 1 mm apart always was; built 1.5 mm apart (where the engine rests a pair) ten blocks barely move (the top
  0.2 mm down, 0.01°). A pair at rest on each other but carried at 0.2 m/s or more (a stack on a moving cart or belt) is left to the pass, as before.
  The undo puts back what the strike's solve changed, not what the pass did as it built the island: a contact that began touching there keeps its
  begin-contact (its hit is listed), and the island's contacts keep the manifolds the pass made where it moved their bodies back (the next step's
  collision makes them again, keeping their impulses by point).
- Checked (this branch against its base, cb17d14; a separate copy of each, the live :8790 server never touched): `research/rw-validate-stack.ts` (new,
  9 checks: the five stack and wrecking-ball checks fail on the base and pass; the four strike checks pass on both, and its first version failed the
  two heavy ones); the 12 scenarios and 10 gallery scenes (web/sim with the bundle, and Python's documents, resolved, warnings, summaries and
  layouts): 21 identical byte for byte, the catalog too, wrecking-ball as above, and Python's answers equal web/sim's in each copy (all but their
  cache keys, which differ the same way on the base); every `research/rw-validate*.ts` CI runs, pointed at each copy: the same PASS lines before and
  after (-p2 30 of 30, -p3 98 of 98, -p4 56 of 56, its crash fuzz of 5000 scenes 0 exceptions and 0 non-finite, -poly 47 of 47, rw-validate.ts's
  numbers the same), two measured values moving within their tolerances (p3's bowling ball on the default trampoline, which bottoms its mat out on
  the table, rebounds 0.71729 m, 0.72398 m before, 0.72236 m at 4800 Hz: −0.70%, within 2.5%; p4's catalog pads lose 45.4% of a drop on average,
  45.3% before); machines/test_*.py as before (test_catalog 139 of 139, test_everyday 38 of 38, test_mechanisms and test_rg pass);
  `tools/parity-engine.mjs --catalog` ALL IDENTICAL (131 scenes × 3 runs in node and headless Chromium, 4 rates, 4 error messages),
  `tools/parity/fuzz-live.mjs --n 300` 754 cases, 0 mismatches; the node:test files as CI runs them, 473 of 473; the app in headless Chromium (the
  engine on the server and in the page) runs the starter and wrecking-ball, the same track both ways, no console errors.
