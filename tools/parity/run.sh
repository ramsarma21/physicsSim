#!/bin/bash
# Everything that checks the browser-side scene builder (web/sim) against machines/items.py + web/server.py. Needs python3, node, and for the
# last step the playwright-core in ~/.bun/install/cache. Reads the Python files as they are now; never touches the running server except to
# GET /api/catalog and POST /api/simulate (the starter) and /api/layout (core scenes), read-only (skipped if it is not up).
#   prims.mjs               numbers and text primitives against CPython, every code point included (Unicode 15.1 vs the engine's)
#   core.mjs --mode core    core items against Python with catalog_items.py's pairs among the six core materials (what web/sim holds today); its groups
#                           "sprites" (sprite balls that differ in hollow/wall side by side: same document, admitted by the engine) and "overlapties" (pairs
#                           exactly on the 3 mm overlap tolerance at non-round angles: same warnings) guard the two fixes of 2026-10-15
#   core.mjs --mode server  the same against the whole server, with its catalog tables loaded: THE GATE FOR A RELEASE
#   browser.mjs             the same cases and every code point of repr/lower/float, run in headless Chromium
#   core.mjs --mode everyday              web/sim/catalog-everyday.js (the port of machines/catalog_everyday.py) against Python with the whole server
#                                         loaded: every type alone (default, min, max, 20 random prop sets), at round angles, in mixed scenes, clean() on garbage,
#                                         the catalog() JSON (previews included), the engine's tracks summarised on both sides, and the running server's own answers
#   core.mjs --mode everyday --integrated  the same with web/sim/index.js as the app imports it (all three catalog ports, their own tables)
#   browser-everyday.mjs                  the everyday cases in headless Chromium, on items.js + the module and on index.js
#   catalog.mjs --module catalog_items,catalog_everyday,catalog_mechanisms   the three catalog ports together (python with the three real)
#   module.mjs --module <name>         one physics module's catalog, documents (defaults, random props and links, mixes, settings) Python == JS, the
#                                         node engine == the bundle, summaries with its goal kinds: the check for a module without a tool of its own
#   fuzz-live.mjs                         random scenes of all 113 types, the scenarios and the catalog against the running server, through web/sim and through
#                                         the app's local API with the engine bundle (the whole static-deploy pipeline): doc, resolved, warnings, summary, track
# (tools/parity/gen_trig.py, gen_sprites.py and gen_unicode.py write the generated tables web/sim/trig.js, sprites.js and unicode.js.)
# The running server is http://localhost:8790 unless PARITY_SERVER says another (e.g. PARITY_SERVER=http://localhost:8795 for a second checkout).
set -e
cd "$(dirname "$0")/../.."
node tools/parity/prims.mjs "$@"
node tools/parity/core.mjs --mode core "$@"
node tools/parity/core.mjs --mode server "$@"
node tools/parity/browser.mjs
node tools/parity/core.mjs --mode everyday "$@"
node tools/parity/core.mjs --mode everyday --integrated "$@"
node tools/parity/browser-everyday.mjs
node tools/parity/catalog.mjs --module catalog_items "$@"   # catalog_items.py against web/sim/catalog-items.js: tables, catalog + previews, every type, mixed scenes, ties, clean, scenarios, summary, live, Chromium
node tools/parity/mechanisms.mjs "$@"                          # catalog_mechanisms.py against web/sim/catalog-mechanisms.js: tables, catalog + previews, every type (types, sweeps, corners, ties, angles), mixed and dense scenes, clean, scenarios, summary, live
node tools/parity/browser-mechanisms.mjs                         # the same cases in headless Chromium
node tools/parity/catalog.mjs --module catalog_items,catalog_everyday,catalog_mechanisms --no-browser "$@"   # all three catalog ports together against python with all three real (the tables they make between them)
node tools/parity/heat.mjs        # the heat module: machines/mod_heat.py == web/sim/modules/heat.js (catalog, 200 random heat scenes), the node engine == the bundle, summaries
node --no-warnings tools/parity/softbody.mjs --engine   # the softbody module: machines/mod_softbody.py == web/sim/modules/softbody.js (catalog, every type at its defaults, limits and 20 random props, combinations), the node engine == the bundle, summaries with every goal kind
node --no-warnings tools/parity/matter.mjs --n 20 --engine   # the matter module: machines/mod_matter.py == web/sim/modules/matter.js (catalog, every type at its defaults and 20 random props, combined scenes), the node engine == the bundle, summaries with every goal kind
node --no-warnings tools/parity/flow.mjs --n 20 --engine   # the flow module: machines/mod_flow.py == web/sim/modules/flow.js (catalog, every type at its defaults, limits and 20 random props, with containers and linked hoses), the node engine == the bundle, summaries with every goal kind
node --no-warnings tools/parity/circuits.mjs --n 150 --engine 16   # the circuits module: machines/mod_circuits.py == web/sim/modules/circuits.js (catalog + previews of its 17 types, the 19 lesson demos and random circuit scenes with wire ends set and unset, magnets, compasses, lamps and sunlight: document, resolved, warnings byte for byte), the node engine == the bundle, summaries with every goal kind, every demo as it expects
node --no-warnings tools/parity/magnetism.mjs --n 150 --engine 12   # the magnetism module: machines/mod_magnetism.py == web/sim/modules/magnetism.js (catalog + previews of its 23 types, the lesson demos and random magnetism scenes: document, resolved, warnings byte for byte), the node engine == the bundle, summaries with every goal kind
node --no-warnings tools/parity/fluids.mjs --n 12 --engine   # the fluids module: machines/mod_fluids.py == web/sim/modules/fluids.js (catalog, every type at its defaults, limits and 12 random props, things in random liquids, boat lanes with fans and a breeze, pennies on boats, the lesson demos), the node engine == the bundle, summaries with every goal kind and every demo's outcomes met
node --no-warnings tools/parity/waves.mjs --n 60 --browser   # the waves module: machines/mod_waves.py == web/sim/modules/waves.js (catalog of its 18 types, random scenes of every waves type with walls, rods, water, a vacuum, a warm room: document, resolved, warnings), the node engine == the bundle (readings included, Chromium on every 4th scene), summaries with every waves goal kind
node --no-warnings tools/parity/granular.mjs --n 20 --engine   # the granular module: machines/mod_granular.py == web/sim/modules/granular.js (catalog, every type at its defaults and random props, goal summaries on real runs), the node engine == the browser bundle
node --no-warnings tools/fracture/test.mjs --n 40   # the fracture module: machines/mod_fracture.py == web/sim/modules/fracture.js (catalog, random scenes of its 8 types with loads and padding, corners and garbage, scenes with other modules' soft balls, a trampoline, water tanks, a vacuum jar), the node engine == the bundle, summaries with every goal kind, its thresholds in the engine
node --no-warnings tools/mechanics/test.mjs --n 300   # the mechanics module: machines/mod_mechanics.py == web/sim/modules/mechanics.js (random scenes of its types with links, the catalog-wide props on every type, catalog entries, every goal kind summarised on real runs)
node --no-warnings tools/air/test.mjs   # the air module: machines/mod_air.py == web/sim/modules/air.js (catalog, random air scenes with fans, a breeze and settings: document, resolved, warnings, refusals), the node engine == the bundle, summaries with every air goal kind
node --no-warnings tools/energy/test.mjs   # the energy module: machines/mod_energy.py == web/sim/modules/energy.js (catalog, every type at its defaults and random props, mixes with a fan, a breeze, LEDs, a waterwheel, a cart; its lessons: turbines lighting LEDs, windmill and waterwheel winches, generators on shafts, battery cars, the AI's worked examples), the node engine == the bundle, summaries with every energy goal kind, every lesson's goals met
node --test web/ai/test/energy-plugin.test.mjs   # its AI plug-ins: goal kinds, knobs, words, every worked example met, Python == JS goal summaries, make-it-work fixes
node --no-warnings tools/fracture/test.mjs --n 30   # the fracture module: catalog, random breakable scenes Python == JS, the node engine == the bundle, summaries, and the thresholds it claims in the real engine
node --no-warnings tools/space/test.mjs --n 30   # the space module: catalog, random orbit and drop scenes Python == JS, the node engine == the bundle, summaries with every goal kind, the AI's registry
node --no-warnings tools/staging/test.mjs   # the staging module (a fixed camera, starting gates): catalog, doc.view Python == JS, no track changed by it
node --no-warnings tools/parity/module.mjs --module circuits --n 12 --mix 60 --engine   # the circuits module through the generic module check: catalog, every type at its defaults and random props with wires linked, mixed circuits with settings, Python == JS; the node engine == the bundle; summaries with every goal kind
node --test web/ai/test/circuits-plugin.test.mjs   # its goal kinds' summaries Python == JS on real runs, and its AI plug-ins
node --no-warnings tools/parity/module.mjs --module optics --n 8 --mix 40 --engine   # the optics module: the same generic check
node --test web/ai/test/optics-plugin.test.mjs   # its goal kinds' summaries Python == JS on real runs, and its AI plug-ins
node --no-warnings tools/parity/module.mjs --module measure --n 8 --mix 40 --engine   # the measure module: the same generic check
node --test ai/test/measure.test.mjs   # its goal kinds judged by ai/goals.mjs as the summary judges them, and its AI plug-ins
node --no-warnings tools/parity/fuzz-live.mjs --n 300   # the running server (read only): catalog() vs GET /api/catalog, every scenario, random scenes of all 113 types: doc, resolved, warnings, summary given the server's track; and the app's local API (sim/api.js + the engine bundle) answer, track byte for byte (--n 2000 for the full fuzz; --shard i/K to split it)
