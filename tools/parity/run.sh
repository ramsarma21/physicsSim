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
node --no-warnings tools/parity/fuzz-live.mjs --n 300   # the running server (read only): catalog() vs GET /api/catalog, every scenario, random scenes of all 113 types: doc, resolved, warnings, summary given the server's track; and the app's local API (sim/api.js + the engine bundle) answer, track byte for byte (--n 2000 for the full fuzz; --shard i/K to split it)
