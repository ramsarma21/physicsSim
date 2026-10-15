# Vector tooling

Lesson pictures constructed in code for the vector style `g3-5-science-diagram` and for
composites (`g3-5-science` raster cutouts placed and moved by code). How to choose a route,
write a lesson and what each step checks: the
[construction guide](../../styles/g3-5-science-diagram/construction.md).

- `src/scene.ts`: a lesson module's types, the delivery size, and `admitLesson`, which folds
  the screens into states and checks each derived answer against the lesson's.
- `src/svg.ts`: draws each state as a part tree and writes a move or an entrance as a SMIL
  loop (`src/timing.ts`) by diffing the tree across keyframes.
- `src/ray.ts`: light paths with one reflection; `src/cutout.ts`: raster cutouts with
  declared sizes; `src/lint.ts`: the technical rules; `src/render.ts`: Chromium renders PNG
  stills and one-loop animated WebP, transparent where nothing is drawn.
- `src/tokens.ts`: the token types and `penFor`, which converts a style's delivery-pixel
  weights to a lesson's view-box units; `src/styles/`: style tokens.
- `src/primitives/`: picture cards (a cutout on a raster ground or a floor line) and arrows.
- `lessons/`: lesson modules (EN-31 in both routes; the Unit 8 pilot's composites, with the
  life-cycle stages LI-107 and LI-108 share in `life-cycles.ts`) and their cutouts, each with
  its prompt beside it as `<name>.txt`.

```sh
node_modules/.bin/playwright-core install chromium        # again after any pnpm install that updates playwright-core
node .agents/skills/lesson-art/scripts/vector-art/render.ts EN-31 "$PWD/out/vector-art/EN-31"
node .agents/skills/lesson-art/scripts/vector-art/demo.ts <base>   # a raster clip's demonstration loop
```

It lives with the skill, like the animation scripts, because it writes SVG files: the
repository's style check keeps markup construction out of maintained source under
`packages/`. Its dependencies are root devDependencies; `pnpm typecheck:tooling` and
superlint cover it. Rendering is authoring-time tooling; its reviewed outputs are published
to `/learn` through the content CLI.

`demo.ts` delivers the [shared clip pipeline](../../references/clips.md)'s demonstrations
(raster clips that run from one still to another) with this tooling's loop, holds, export
limits and delivery size, so a raster clip and a vector loop are the same kind of file.

## Simulated demonstrations

A screen whose answer rests on how a motion comes out is simulated
([route guide](../../references/science-routes.md#the-simulated-route)). Each demonstration is
one **scene document** in `sims/` (`ball-drop.json`, `three-balls.json`), the record every editor
reads and writes: parts in meters, kilograms and seconds, materials named once with their density
(and yield strength for one that stays dented), the contact values of each pair, the release, the
camera, and the chosen sprites (files in `sims/<scene>/sprites/`, each with its SHA-256 and fit).
A material or contact with no `source` is provisional; sourced values are kept in the skill's
[value tables](../../references/physical-values.md). `src/sim/document.ts` admits a document
once, refusing an unknown material name.

`sim.ts` works on a document (a name in `sims/` or a path), one reviewed step at a time:

```sh
node .agents/skills/lesson-art/scripts/vector-art/sim.ts <scene> "$PWD/out/<run>" mockup         # vectors and dimensions
node .agents/skills/lesson-art/scripts/vector-art/sim.ts <scene> "$PWD/out/<run>" placeholders   # each sprite's input and prompt
node .agents/skills/lesson-art/scripts/vector-art/sim.ts <scene> "$PWD/out/<run>" sprites <set>  # every prompt run through picture.ts
node .agents/skills/lesson-art/scripts/vector-art/sim.ts <scene> "$PWD/out/<run>" fit <set>      # a set's sprites fitted, frames with outlines
node .agents/skills/lesson-art/scripts/vector-art/sim.ts <scene> "$PWD/out/<run>" choose <set>   # record that set in the document
node .agents/skills/lesson-art/scripts/vector-art/sim.ts <scene> "$PWD/out/<run>" render         # MP4 on white and a transparent WebP
```

`placeholders` also prints and writes the scene's **bill of materials** (`placeholders/bill.json`):
each drawing to generate once and the parts it draws. Rigid solids with the same words and body
share one drawing unless one names a `sprite` of its own, and identical animated pieces name a
shared one, so a cart's two wheels are one drawing. Read the bill before generating anything.

`sprites` runs lesson-art's `picture.ts` on each placeholder (keys from `.env.local`), the held
ball's sprite before the holder's first pose that attaches it, and keeps any sprite already made.
A holder's first pose is drawn alone; when its sleeve would end inside the frame (measured along
the arm, in ball radii), the drawing is shrunk into its canvas's lower right and the sleeve
continued to the edge by an edit, and the other poses are edits of that one, so a
second set is `sprites 2`; `--dry` prints the commands instead. After the set, `part=set` takes one
part's sprites from another set (`fit 3 rubber=2`, `choose 3 rubber=2`). `choose` keeps each
sprite cropped to its drawing and at twice the resolution it is drawn at; the full-size originals
stay in the run's folder. `render` needs only the document and its folder.

A rigid solid's drawing is fitted within its body, keeping its proportions, against the edge the
part rests on or holds up (its top when only its top touches another part, else its base). `fit`
gives each a verdict. A drawing that misses its part's proportions by at most 3% is stretched to
fill the part exactly, changing nothing else. One that misses by no more than 20% is kept and `choose` resizes its part to the drawing along the
axis left over, moving the part's center, children and pivot so they stay where they are; whatever
rests on the edge that moved follows it (its whole assembly, as a cart parked on a crate), and
`choose` says what it moved. A drawing is regenerated when it misses by more, or when a part
resting on the moved edge is held by another part as well (a ramp between a crate and the floor),
since it cannot follow. After a resize, run `placeholders` again before the next `fit`.

A document may name a **setting** (`"setting": { "words": "a child's playroom: …" }`) when the
environment matters to the screen. It is one opaque picture behind every part, of only what
stands behind the ground (a wall and its baseboard, a hedge, a sky): the scene's ground (its widest
fixed slab, a floor, a tabletop, a tiled strip of grass) is a part drawn in front, so the picture
has no ground of its own. `sprites` makes it from its words alone, its foot along its bottom edge,
and it is placed across the frame's width with that edge on the ground's top, its last row running
on below so a ground open between its tufts shows the picture, not the page.

A document may list **clip layers**: a living thing's motion (an animal reacting, a child
pushing) made as a transparent clip by the [shared clip pipeline](../../references/clips.md),
drawn among the parts at its own depth. Each is placed in meters by its lower left corner and
width, and may name a parent part it moves with; it starts at its start time, plays at the speed
it was made at, and holds its first frame before and its last frame after. A layer does not
interact with the physics or with other layers. Add its entry to the document (an id, its words,
where it stands, its width, depth and start), then take the clip in, which writes its frames
beside the document and their times into the entry:

```sh
node .agents/skills/lesson-art/scripts/vector-art/sim.ts <scene> - layer <id> <clip.webp>
```

A pivoted solid may have a **damper** (`damping`, newton-meter-seconds): a torque against its
turning on the pivot in proportion to that speed, which slows everything it carries, so a pan
balance's beam settles exactly where its loads leave it. A weight fixed below the pivot (the
balance's pointer) returns equal loads to level. An animated piece whose ends must meet what it spans
(a pan's hanger, from the beam's end to the pan's rim) takes `fill`: its drawing is stretched to its
vector exactly rather than fitted inside it.

A document may list **marks**: a faint dashed outline where a solid stood at the start, shown from
a moment on (`{ "of": "pinecone", "from": 1.0 }`, where a pinecone hung once it falls).

`sims/` holds the reference examples. A scene being tried out lives in its run's folder in `out/`
(`out/<run>/document/<scene>.json`, its sprites beside it), and every step takes its path.

### Hitboxes (tabled 2026-10-13)

A clip and simulated parts that act on each other are not used in lessons; such a screen is one
generated video. This section records the trial's tooling, which stays in the code; it is not a
method to follow. A layer's `speed` plays it faster than it was made (on the trial, the video
model spread a shove over the clip's whole five seconds). A layer whose subject pushes a part (a hand's palm,
a dog's nose) has a **hitbox**: the side it pushes with, the band of heights it pushes with in
meters above the layer's lower edge, and its material. `sim.ts <scene> - hitbox <id>` tracks the
subject's leading edge within that band on every frame, from the clip's own transparency,
smoothed over five frames, and writes the track into the entry. In the engine the hitbox is a
kinematic body that follows the track exactly and is moved by nothing it touches, so what it
pushes rides along while the clip pushes and goes on by the engine when the clip slows. Make the
clip of the subject alone from a first frame only (`END=none`), the subject roughly where it acts
in a neutral pose, so the video model decides the motion and it never has to agree with the
simulation about where the pushed part is; then fit the scene to the clip: place the layer so its
edge starts just short of the part, take its frames at the clip's full rate (a quick push spans a
few), and let the track decide when it touches. Taking a clip in keeps only each frame's subject:
pieces apart from it under a twentieth of its size (impact marks, stray strokes) are cleared. A
frame with nothing in the hitbox's band leaves the hitbox off until the subject comes back into it. `fit` draws each
hitbox and a frame midway through each push, with the parts where the engine has them.

### Editing a document in Blender

The Sim Studio add-on (`editors/blender/`) opens a document as a 2D shot: each part an empty at
its placement carrying an unlit sprite plane, each clip layer one plane per frame, the camera the document's.
The planes stand 0.1 m apart in depth by the tooling's stacking, an assembly's members together
within its place, so each can be seen and picked from above; the camera is orthographic, so the
spacing does not change the picture. It needs Blender 5.2 or
later from blender.org with `blender` on `PATH`, and Node; it finds the engine by searching up
from the document (or `$SIM_TS`). Build a working copy in a run's folder, then open it:

```sh
blender -b --python .agents/skills/lesson-art/scripts/vector-art/editors/blender/build.py -- \
  .agents/skills/lesson-art/scripts/vector-art/sims/<scene>.json "$PWD/out/<run>/<scene>.blend"
```

The file carries the add-on and registers it when it opens, so Blender asks to allow the file's
script. The sidebar's Sim tab (N) holds Simulate, Rebuild from document, and the document's
editable values in one box per section; parts are moved by dragging their empties in the front
view. Saving the file writes the document back, with each part where it stands at the current
frame, so save at the first frame: saved partway into the simulation, the moving parts' positions
there are written as where they start. Blender does not watch the document, so after editing it
elsewhere press Rebuild from document before saving, or the save writes the older values back. The `.blend` is a working copy and stays out of git. It is saved uncompressed, so
that its file-browser thumbnail can be the camera's view of the first frame, 512 pixels wide: the build and every
save through the add-on render it into the file.

### Editing a document in Remotion

`editors/remotion/` is a Remotion Studio project (the team holds a Remotion license). It is its own
pnpm project, outside the repository's workspace, so install it once after the repository's own
install, then start the Studio on a folder of documents:

```sh
cd .agents/skills/lesson-art/scripts/vector-art/editors/remotion
pnpm install
pnpm studio                                   # the documents in sims/
SIM_DOCS="$OLDPWD/out/<run>/document" pnpm studio   # a scene being tried out
```

`editors/remotion/studio.sh [folder]` does the same from anywhere: it opens the Studio on the
folder named or the current one (a run's folder opens its `document/`), after the repository's and the editor's installs (running
either that is missing). `studio.sh --setup [folder]` prepares a run's folder (or a folder of documents) for both editors:
`Open in Remotion.command`, double-clicked in Finder; a `package.json` whose `studio` script runs
the Studio, so `npm run studio` works there with nothing installed; and a `README.md` with both
editors' instructions and the commands that build each scene's `.blend` and set up another folder.
They name the checkout they were written from, so each person runs the step from their own.
`choose` runs it once a document's sprites are recorded; a run's folder finished any other way
(documents copied in, or written by a script) gets it from whoever finished it.

Each document is a composition: its preview runs the engine, and its form, which the Studio builds
from the plain values it is given, has one section per scope (the release, each contact pair, each
airflow, each material, where each moving part starts and each fixed part with an airflow stands).
Each edit the form commits is written straight into the document, rounded to 0.001 and held within
the value's bounds by the tooling, through a patch to the Studio
(`pnpm-workspace.yaml`); a Blender save shows in the Studio at once. A Studio serves one folder,
because it never writes through a link.

An editor in another language works through a few more steps: `sim.ts <scene> - tunables` prints the
values an editor may change, and `sim.ts <scene> - tune <values.json>` writes them into the
document; `drawings` names the sprite that draws each solid part, shared ones included; `track` gives it the placements per frame and `normalize` rewrites the document in its
canonical form.

- `src/sim/part.ts`: the part model. Any part may name a **parent**, making it one piece of an
  assembly: its position, angle and keys are then measured in the parent's frame, and every
  part's world pose comes from `worldPose` (a claw's jaws on its mount). `stacking` gives the
  composition's order back to front: each top-level part or layer takes one place by its depth,
  and an assembly's members, ordered among themselves by their depths in their parents' frames
  (the parent at 0), share their root's place, so none passes a neighbor outside the assembly.
  `sim.ts` and the Remotion preview draw in that order, and Blender stacks its planes by it. A **solid** part (a ball, a slab, which may `taper` to a narrower bottom so it stands on a narrow end as a pinecone hanging point down does) has a body, a material, a starting angle when it starts
  tilted, a **pivot** when it turns on a hinge (to its parent's body, as a wheel on a cart's axle,
  or to the world, as a seesaw's plank on its fulcrum; with a parent and no pivot it is fixed to
  the parent), a **sprite** name (lookalike rigid parts share one drawing without
  it; naming one keeps a part apart), and a render mode: `rigid` (a sprite redrawn literally from its
  vector, scaled uniformly), `tiled` (a repeat unit laid along its length, the last tile trimmed so
  the part is exactly its length; the way to draw a long plank), or `procedural` (its vector in the style's
  flat fill with one darker tone). An **animated** part is a mechanism piece turned about its pivot by keyed
  angles (a claw's jaw), or held still with no keys (a fan), drawn by a rigid sprite and colliding
  with nothing; identical pieces share one sprite. It may carry an **airflow**, a stream of air
  from an outlet in its own frame (so the stream moves and turns with it) from the moment it is
  switched on, and a **cycle**, a looping sprite animation played while that airflow blows (a
  running fan's blades and ribbons), with an off drawing before it starts; each cycle drawing is
  an edit of the part's sprite, aligned on what the edits leave alone. Its **anchor** names the
  edge its sprite's fit keeps on its vector when the sprite's proportions miss (the base it stands
  on). An **organic** part (a hand) is specified by its grip and the direction it
  enters the frame, and drawn by one sprite per pose. The **release** names the parts held at rest
  until a moment, and an organic holder's poses around it.
- `src/sim/physics.ts`: planck (Box2D) with the Prism mechanics lab's corrections (a ×10 length
  scale, restitution compensated for Box2D's post-gravity rebound, an inelastic threshold, rolling
  resistance, continuous collision), plus air drag (through the air where the body is: still, or
  a stream modeled as a round turbulent jet) and dents. It steps at 480 Hz and lands a frame
  on each impact, so a fast body is never drawn short of what it hits.
- `src/sim/tunable.ts`: the values an editor may change, in one section per scope (the release, a
  contact pair, a part's airflow, a material), with their bounds and the one step every editor offers (0.001).
- `src/sim/drawing.ts`: how each part is drawn from a document's recorded sprites, pure so a
  browser editor draws from the same definition: sprite images, tiled parts, procedural slabs,
  clip layers' frames.
- `src/sim/sprite.ts`: placeholders, aspect fits (each drawing's opaque pixels scaled uniformly to
  fit within its part, a solid standing on its base, each reporting how far its proportions miss),
  tiling, and an organic part's registration: its first pose placed by the red
  disk of the ball it holds, its other poses aligned to the first on what does not change.
- `src/sim/sheet.ts`: layouts of labeled boxes for an image model, cropped back by column.
- `src/sim/draw.ts`: the orthographic camera and each frame as SVG.
