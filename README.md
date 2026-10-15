# Physics Sandbox

A physics-true scene builder and "video generator": real-world objects (113 catalog items with true sizes, masses and materials), a validated rigid-body engine, a realistic three.js 3D view, an AI builder (describe a scene, drop a photo, or edit what's on screen), and frame-perfect MP4 export with impact sounds.

## Run locally
```bash
npm ci
npm run build:engine     # engine Web Worker bundle (web/sim/engine-worker.js)
npm run vendor:three
python3 web/server.py 8790   # then open http://localhost:8790
```
The AI builder needs a TrueFoundry key on the server side (see `ai/DESIGN.md`); everything else runs without it. `?engine=browser` runs the whole sandbox in the browser (the default on any non-localhost host).

## Layout
- `web/` app (view3d, models, inspector, export, AI panel, account library), `web/sim/` exact JS port of the scene builder + engine worker
- `machines/` Python scene builder and catalog (reference implementation + tests), `tooling/src/sim/` the engine (planck.js)
- `ai/` AI core (prompts, routing, benchmark), `api/` Vercel serverless functions, `tools/` build/vendor/parity tools, `docs/` deploy + accounts

## Status
The deterministic `pow` used by the engine bundle is being replaced by an open-source correctly-rounded implementation; until then `npm run build:engine` needs `tools/apple-pow-tables.ts`, which is not in this repository.
