# Physics Sandbox

[![CI](https://github.com/ramsarma21/physicsSim/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ramsarma21/physicsSim/actions/workflows/ci.yml)

A physics-true scene builder and "video generator": real-world objects (113 catalog items with true sizes, masses and materials), a validated rigid-body engine, a realistic three.js 3D view, an AI builder (describe a scene, drop a photo, or edit what's on screen), and frame-perfect MP4 export with impact sounds.

## Run locally
```bash
npm ci
npm run build:engine     # engine Web Worker bundle (web/sim/engine-worker.js)
npm run vendor:three
python3 web/server.py 8790   # then open http://localhost:8790
```
The AI builder needs a TrueFoundry key on the server side (see `ai/DESIGN.md`); everything else runs without it. `?engine=browser` runs the whole sandbox in the browser (the default on any non-localhost host).

## Development
Work on a branch (`dev`, or a feature branch), open a pull request into `main`, and merge when CI is green. CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs on every push to `main` and `dev` and on every pull request:

| Job | Runs |
| --- | --- |
| Checks (Linux, Node 24 and 26) | syntax of every tracked JS/TS/Python file; `vendor:three:check`, `vendor:media:check`, `vendor:clerk:check`, `gen:scenarios:check`; the `node --test` suites (`ai/test`, `web/ai/test`, `web/account/test`); the engine validators `research/rw-validate*.ts`; `npm run build:static:nogen` |
| Scene builder tests (Linux) | `machines/test_rg.py`, `test_catalog.py`, `test_mechanisms.py`, `test_everyday.py` |
| Python <-> JS parity (macOS arm64) | `tools/parity/run.sh` against `web/server.py` started in the job (macOS, because web/sim matches CPython on the platform libm at rounding ties) |

Until the open-source `pow` lands (see Status), CI cannot build the engine bundle, so the steps that load `web/sim` (most of the `node --test` files, the static build and the parity suite) are skipped with a notice; they turn on by themselves once `npm run build:engine` works from a clean checkout. Locally, with the bundle built:

```bash
npm run test:ai && npm run test:accounts && node --test "web/ai/test/*.test.mjs"
for t in rg catalog mechanisms everyday; do python3 machines/test_$t.py; done
bash tools/parity/run.sh            # with web/server.py running on :8790
npm run build:static:nogen
```

## Layout
- `web/` app (view3d, models, inspector, export, AI panel, account library), `web/sim/` exact JS port of the scene builder + engine worker
- `machines/` Python scene builder and catalog (reference implementation + tests), `tooling/src/sim/` the engine (planck.js)
- `ai/` AI core (prompts, routing, benchmark), `api/` Vercel serverless functions, `tools/` build/vendor/parity tools, `docs/` deploy + accounts

## Status
The deterministic `pow` used by the engine bundle is being replaced by an open-source correctly-rounded implementation; until then `npm run build:engine` needs `tools/apple-pow-tables.ts`, which is not in this repository.
