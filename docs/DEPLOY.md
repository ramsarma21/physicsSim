# Deploying the sandbox to Vercel (preview)

The deploy is a **static site** (the whole app, with the physics engine running in the browser) plus **one serverless function** for
"Build with AI" (`api/ai/[step].mjs`, which holds the AI key). Linked as `ram-sarmas-projects/physics-sandbox` on 2026-10-15; first preview
(no AI key, AI off) `physics-sandbox-l6e6pfkp5-ram-sarmas-projects.vercel.app`. Everything below was checked locally
(`npm run check:vercel` runs `vercel build` on the exact upload and calls the built function; a static server; headless Chromium; see
"Verified" at the end).

| Part | What it is | Where it comes from |
| --- | --- | --- |
| `dist/` (Vercel's `outputDirectory`) | index.html, the app's modules, models, styles, the engine bundle (`sim/engine-worker.js`, a module Worker), the 12 built-in scenes and `scenario-list.json`, vendored three.js and mediabunny (the MP4 muxer) | `tools/build-static.mjs`, from `web/` |
| `/api/ai/observe\|plan\|refine\|edit` | the Vercel twin of `web/server.py`'s AI route | `api/ai/[step].mjs`, with all of `ai/` (the AI core, `ai/prompts/`, `ai/models.json`) and `web/sim/`'s code |
| `/api/scenes`, `/api/scenes/:id[/thumb\|/restore]`, `/api/scenes/me` | accounts: sign in with Google, a person's saved scenes on any device, their AI allowance. **Off until Clerk and Neon are connected** (setup step 6); until then `/api/scenes/me` answers `{accounts: null}` and the page keeps scenes in the browser | `api/scenes/index.mjs` with `api/_lib/` and `web/sim/`'s code (docs/ACCOUNTS.md) |
| `/api/videos/upload`, `/api/videos/publish`, `/videos/<gallery>[/batches/<batch>]`, `/videos/<gallery>/jobs/<job>/<file>` | the video pipeline: Blob upload tokens, publishing to the team gallery, the gallery page and each video's report page. Robot keys only (`x-agent-key`); see "Robot keys and the video gallery" below | `api/videos/*.mjs` with `api/_lib/` (videos, blob, agent-keys, gallery) |

On any host that is not this machine the page picks the browser engine by itself (`web/app.js`: `localhost`, `*.localhost`, `127.x`
and `[::1]` use the local server, every other host the browser). So the deployed page makes no calls to a physics server: the catalog,
scenes, runs and saves are answered in the page (`web/sim/api.js`), saves go to the browser's localStorage, and only the AI steps
go to `/api/ai/*` on the same origin. The app itself loads nothing from another origin (the build fails if it would); the one thing that
can add another origin is Vercel's own toolbar, which setup step 3 turns off.

## One-time setup

All commands run in `blender-playground/`. The Vercel CLI (v63) is logged in as scope `ram-sarmas-projects` (Hobby).

1. **Link a project** (creates it on Vercel and writes `.vercel/`, which is never uploaded):
   ```sh
   vercel link --scope ram-sarmas-projects
   ```
   Answer: set up this directory, yes; link to an existing project, no; a name such as `physics-sandbox`; directory `./`.
   Leave the build settings alone: `vercel.json` sets them (framework none, `npm ci`, `npm run build:static`, output `dist`).
2. **Node.js version: nothing to set.** `package.json` `"engines": {"node": ">=24"}` decides it and overrides the Project Settings value:
   Vercel uses the newest Node.js major it offers that satisfies `>=24` (24.x today; `vercel build` used `nodejs24.x`) and warns that it
   will move to the next major by itself when Vercel adds one. To pin 24.x instead, change `engines.node` to `"24.x"` (local Node 26 then
   only prints an npm `EBADENGINE` warning on `npm ci`).
3. **Turn off the Vercel Toolbar on previews**: Project Settings, General, **Vercel Toolbar**, Preview: **Off**. By default every preview
   deployment (and the share link below, which allows Comments) gets the toolbar: a script from `vercel.live` added to every HTML page and a
   floating button over the app (Vercel's docs list `vercel.live` and `wss://ws-us3.pusher.com` among the origins it uses). It would be the only
   other-origin code on the page, and it was never tested with the app's import map. The same thing as an environment variable, if you prefer the CLI (it applies to deployments made after it):
   ```sh
   printf 0 | vercel env add VERCEL_PREVIEW_FEEDBACK_ENABLED preview --yes
   ```
4. **Deployment Protection**: Project Settings, Deployment Protection: **Vercel Authentication** on, scope **Standard Protection**
   (it protects every deployment except production domains, so every preview URL and generated deployment URL needs a Vercel login; it
   covers the function too, so a stranger cannot reach `/api/ai/*` and spend the key). On Hobby only you can log in to it. To show someone
   else (an investor): open the deployment, **Share**, "Anyone with the link"; that link opens the page without a Vercel account (it sets a
   cookie for that deployment, so the page's own requests, `/api/ai/*` included, go through too). Hobby allows **one** such link per account
   in total; revoke it by switching back to "Only people with access". Password Protection is not on Hobby (Pro: $20 per month per project).
5. **The AI key**, as Secret (write-only, encrypted) **Preview** variables. The values go in through stdin, so they never appear on a
   command line, in shell history or in this repo:
   ```sh
   zsh -c 'source ~/.config/truefoundry/env && printf %s "$TRUEFOUNDRY_API_KEY" | vercel env add TRUEFOUNDRY_API_KEY preview --sensitive --yes'
   zsh -c 'source ~/.config/truefoundry/env && printf %s "$TRUEFOUNDRY_BASE_URL" | vercel env add TRUEFOUNDRY_BASE_URL preview --sensitive --yes'
   vercel env ls preview        # shows the names, never the values
   ```
   If it asks for a Git branch, leave it empty (all previews). Do not use `--value` (it puts the key on the command line). Do not add
   them to Production until production is protected (below). Rotating the key: the same command with `--force`, then redeploy.
   Optional, as plain Config variables:
   - `ALLOWED_ORIGINS`: **leave it unset for these CLI preview deploys.** Each `vercel deploy` gets a new URL, and this folder is not a Git
     repository, so there is no stable branch URL (no `-git-main-` alias is ever made); an `ALLOWED_ORIGINS` naming any other URL makes every
     AI call from the real page fail with 403. If you want one stable address: `vercel alias set <deployment-url> <name>.vercel.app` after
     each deploy, put `https://<name>.vercel.app` in `ALLOWED_ORIGINS`, and open the alias once in a private window to check that it still
     asks for a Vercel login (Standard Protection leaves production domains open).
   - `AI_CACHE_DIR=/tmp`: lets a warm instance keep the catalog digest on disk. Not needed: without it the write fails quietly
     (read-only file system) and the digest is rebuilt once per cold start (measured: well under 0.1 s).
6. **Accounts (optional): sign in with Google, "My scenes" in an account, a daily AI allowance per person.** Two Vercel Marketplace
   integrations, Clerk and Neon, both free, each connected to this project in the dashboard (they create the provider accounts and accept their
   terms, so only you can add them): **docs/ACCOUNTS.md section 9** has the exact clicks (about 10 minutes), then deploy as below. Nothing else
   changes: the code is already in the upload and switches itself on when `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` and
   `DATABASE_URL` are there. With accounts on, **Build with AI needs a signed-in person** (on top of the protection in step 4), and every person
   has hourly and daily step limits and a daily dollar cap, plus a site-wide daily dollar cap (docs/ACCOUNTS.md section 6).

## Every deploy

```sh
npm run build:static:nogen     # builds dist/ from web/ as it is and checks it (writes only dist/); fails on any stale generated file
npm run check:vercel           # what a deploy does, without deploying: vercel build on the exact upload, then calls the built AI function
npm run test:ai                # the AI core's tests, the Vercel twin included (a mock gateway, no key)
npm run test:accounts          # the accounts' server: token checks, the scenes function on an in-process Postgres, the AI gate (no network, no keys)
npm run preview:static         # optional: serves dist/ at http://127.0.0.1:4173/?engine=browser with vercel.json's headers
vercel deploy --target preview # a PREVIEW deployment (never add --prod, see below)
```

**Always pass `--target preview`.** The CLI sends a new project's **first** deployment to production even without `--prod` (CLI 63:
"This is the project's first deployment, so it was assigned to production"), and aliases it to the project's production domain
(`physics-sandbox-blond.vercel.app`), which Standard Protection leaves **public**. That happened on 2026-10-15: the first `vercel deploy`
here became production and its alias answered without a login (no AI key was set; the AI answered 503) for about 2 minutes, until
`vercel alias rm physics-sandbox-blond.vercel.app` took the alias off (the deployment's own URL stays behind Vercel Authentication). The domain
is still on the project, so a later production deploy would put it back.

`build:static:nogen` fails if `vendor:three:check`, `vendor:media:check` or `gen:scenarios:check` fails, and if the engine bundle
(`web/sim/engine-worker.js`, `engine-math.js`, and the optics tracer's plain build `web/sim/optics.js`) is not byte-identical to what `npm run
build:engine` makes from the current sources (it rebuilds them in a scratch folder with `tools/build-engine.mjs` and every `tools/*.mjs` that
script imports, `tools/build-optics.mjs`, and compares; nothing in `web/` changes).

`check:vercel` (`node tools/build-static.mjs --vercel-check`, about 15 s; needs git and the Vercel CLI, touches nothing in the project):
copies exactly what `vercel deploy` would upload (`.vercelignore`) to a scratch folder; runs `vercel build` there with a throwaway local
project id (nothing is linked or created on Vercel; the AI key is removed from its environment), which runs `npm ci` and
`npm run build:static` as Vercel does; checks the output (the `/api/ai/<step>` route, no dot files or dev-only files in the static site,
the function's runtime, `maxDuration` and `supportsCancellation`, and that all of `ai/` and `web/sim/`'s code and data are in the function);
lays the function out as a deploy does (its traced files plus its `includeFiles`, read-only); and calls it the way Vercel's Node runtime does,
against a mock gateway on 127.0.0.1 with a fake key: GET 405, an unknown step 404, an `edit` of the starter 200 (the bundled prompts,
routing, catalog digest and scene digest), no key in any answer, then runs the starter in the function's own engine (541 frames, goal met).
It also checks the scenes function (docs/ACCOUNTS.md): exactly two functions are built (`api/_lib/` holds modules, not functions), the two
rewrites `/api/scenes/:id[/:part]` reach it, it holds web/sim's code and the Neon driver, and called with no keys it answers
`/api/scenes/me` `{accounts: null, storage: false}` and `/api/scenes` 503 `not_configured`; an unreachable database answers 503 `unavailable`
with nothing of its address.

After `vercel deploy`, open the deployment URL (logged in to Vercel, or through the share link) with DevTools' Network panel open and check:

- no request goes to `vercel.live` or `pusher.com`, and the page's HTML (`view-source:`) has no `<script>` that `web/index.html` does not have
  (if it does, the Toolbar is still on: setup step 3);
- every other request goes to the deployment's own origin (blob: URLs are the app's own Workers); with accounts on (setup step 6), also
  Clerk's Frontend API (`https://<name>.clerk.accounts.dev`, fetches only: the sign-in code itself is vendored in `vendor/clerk-<hash>/`) and,
  while signing in, Google's sign-in page;
- the starter runs ("Ran in ..."), and "Build with AI" answers.

Then share the link.

`vercel deploy` uploads what `.vercelignore` lets through (about 155 files, 5 MB: package files, `vercel.json`, `api/`, `ai/` without its
research, benchmark, tests, notes and cache, the build scripts, the engine's sources in `tooling/src`, `web/` without `web/dev` and the other
local-only folders), then Vercel runs:

1. `npm ci` (the lockfile: three 0.170.0, mediabunny 1.61.0, planck 1.5.0, effect 4.0.2, @neondatabase/serverless 1.2.0, esbuild 0.28.2,
   @electric-sql/pglite 0.5.8 for the accounts' tests).
2. `npm run build:static` = `node tools/build-static.mjs --regen`:
   - regenerates the generated files: `npm run build:engine` (the engine bundle from `tooling/src/sim`), `vendor:three`,
     `vendor:media`, `vendor:clerk` (Clerk's browser SDK from its pinned, integrity-checked npm tarball), `gen:scenarios`. **An engine bundle that comes out different from the uploaded copy fails the deploy**: the uploaded one
     is the one the parity tools checked, and the deploy must not ship engine code they never saw (`--allow-engine-drift` would ship the fresh
     build anyway; nothing uses it). A vendored package or scenario list that comes out different is a warning (the deploy has the fresh one);
   - copies only what the app loads into `dist/` (never `web/ai/dev-mock.js`, the development-only fake AI behind `?aimock=1`) and **fails
     the deploy** on any import, `new URL(..., import.meta.url)`, CSS `url()`/`@import` or HTML `src`/`href` that does not resolve to a
     shipped file exactly as the browser asks for it (bare names only through the importmap: `three`, `three/addons/...`, `mediabunny`, `clerk-js`; none
     in a module worker, which has no importmap), a template import (`./models/${g}.js`) whose names do not all exist, anything on another
     origin, a new `web/` folder it does not know, or a shipped file holding the key's value (`TRUEFOUNDRY_API_KEY` is visible to the build), or
     the value of an accounts secret (`CLERK_SECRET_KEY`, `DATABASE_URL`, ...), a Clerk secret key or a database URL with a password.
3. The functions are bundled by `@vercel/node` (Node 24) with their `includeFiles`: the AI function with all of `ai/` and `web/sim`'s `.js` and
   `.json`; the scenes function (`api/scenes/index.mjs`, `maxDuration` 30) with `web/sim`'s `.js` and `.json` (it checks scenes with web/sim's
   `clean()`). Both carry `api/_lib/` and the Neon driver (the AI function uses them for the accounts' AI limits).

**Not production.** Do not run `vercel deploy --prod` or attach a public domain until there is (as `ai/DESIGN.md` "Protecting the hosted
endpoint" says) a per-user rate limit and a daily spend cap in front of the AI steps, and protection on the production URL too
(Deployment Protection scope "All Deployments", free on every plan with Vercel Authentication). Standard Protection leaves production domains open.
With accounts on (setup step 6) the first two exist: Build with AI needs a signed-in person, each with hourly and daily limits and a daily
dollar cap, under a site-wide daily dollar cap (docs/ACCOUNTS.md section 6). Production sign-in also needs your own domain and Google OAuth
client (docs/ACCOUNTS.md 9.5).

## What vercel.json says, and why

| Key | Value | Why |
| --- | --- | --- |
| `framework` | `null` | "Other": a static output directory plus the `api/` functions. |
| `fluid` | `true` | Fluid compute, which the function's `maxDuration` 300 needs on Hobby (300 s is the Hobby default and maximum with Fluid compute; without it Hobby's limit is 60 s). It is on by default for new projects; this states it. |
| `installCommand` | `npm ci` | Exactly the lockfile. npm 11 skips esbuild's postinstall unless allowed; esbuild works without it (its binary comes from the `@esbuild/<platform>` optional package; checked). |
| `buildCommand` | `npm run build:static` | See above. |
| `outputDirectory` | `dist` | What `tools/build-static.mjs` writes (its marker, `.dist.build-static`, sits beside `dist/`, so it is not published). |
| `cleanUrls` | `true` | `/index.html` 308s to `/`; no other page has a URL of its own. Module paths (`/sim/index.js`) are untouched. |
| `functions["api/ai/*.mjs"].maxDuration` | `300` | The most Hobby allows (Pro: up to 800 s). See "What the AI steps need". The glob is `*.mjs`, not `[step].mjs`: in a glob, `[step]` would mean one of the letters s, t, e, p. |
| `...supportsCancellation` | `true` | When the browser gives up (the panel's Cancel, a closed tab) Vercel ends the function, so the model call stops with it. |
| `...includeFiles` | `{ai/**,web/sim/**/*.js,web/sim/**/*.json}` | The AI core reads its prompts and routing and imports web/sim (the catalog digest, `clean()`, and the engine bundle that checks a refine's goals) by computed paths, which the file tracer cannot follow. All of `ai/` goes in, so a new module or data file there needs no change here; web/sim's `.js` and `.json` at any depth, never its source maps. |
| `...excludeFiles` | `web/sim/**/*.map` | Keeps the 6 MB engine source map out of what the tracer adds (the function is 1.1 MB). It does not filter `includeFiles`, which is why that pattern names `.js` and `.json` only. |
| `functions["api/scenes/*.mjs"]` | `maxDuration` 30, `includeFiles` web/sim's `.js` and `.json` | The accounts' scenes function (docs/ACCOUNTS.md): short requests (a list, a save, a picture); it validates scenes with web/sim's `clean()`, which imports the catalog. |
| `functions["api/videos/*.mjs"]` | `maxDuration` 60 | The video functions (upload tokens, publish, the gallery page, a video's report page): short requests; the video bytes go straight to Blob, never through a function. |
| `rewrites` | `/api/scenes/:id` and `/api/scenes/:id/:part` to `/api/scenes`; `/videos/:gallery`, `/videos/:gallery/batches/:batch` and `/videos/:gallery/jobs/:job/:file` to `/api/videos/gallery` | One function serves the whole group of scene routes (Vercel's advice: a warm instance serves them all); the named segments arrive as `?id=` and `?part=` (`?gallery=`, `?batch=`, `?job=&file=`). `cleanUrls` sends `.../index.html` to `.../` and `.../report.html` to `.../report` first (308), so a report's link `../../index.html` lands on the gallery page. Checked by `check:vercel`. |
| headers `/(.*)` | `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` | No MIME guessing; no full URLs in Referer to other sites. |
| headers `/((?!vendor/\|api/).*)` | `Cache-Control: public, max-age=0, must-revalidate` | The app's files keep their names between deploys, so browsers revalidate them (a 304 when unchanged; Vercel's CDN serves each deployment's files from its edge). |
| headers `/vendor/(.*)` | `Cache-Control: public, max-age=31536000, immutable` | `dist/vendor/<pkg>-<12 hex of its content>/`: the build names each vendored package's folder by its content and rewrites the importmap in `dist/index.html`, so a new three.js, a new addon or a new mediabunny export set is a new URL. |
| headers `/(.*)\.(js\|mjs)` | `Content-Type: text/javascript; charset=utf-8` | Module scripts and the engine's module Worker (`new Worker(url, {type: "module"})`) need a JavaScript MIME type; this states the standard one. |

**No COOP/COEP.** Nothing needs cross-origin isolation: no `SharedArrayBuffer`, `Atomics` or `crossOriginIsolated` in the app (mediabunny
only tests `typeof SharedArrayBuffer` in a guarded type check); WebCodecs (the MP4 encoder), OffscreenCanvas, module Workers and the
encoder's blob Worker all work without it. Adding COEP would only risk blocking something. WebCodecs needs a secure context, which
`https://*.vercel.app` is.

**No Content-Security-Policy yet.** The build already guarantees the app loads nothing from another origin; a CSP would add a second guard
but could block a live flow (the blob: Workers, inline styles) and would have to allow the Toolbar's origins if it were ever on. Not added.

## What the AI steps need

| Step | Measured on the gateway (2026-10-15) | `ai/models.json` timeout / budget |
| --- | --- | --- |
| observe (pictures) | 21–32 s | 120 s / 300 s |
| plan | 9–108 s in the live smoke, 145 s worst seen (typical 20–45 s) | 300 s / 420 s |
| refine | about 9 s (each round) | 120 s / 240 s |
| edit | 13–15 s | 60 s / 180 s |

These are open on Hobby, and owned by the AI client and server code, not by this deploy setup:

- **Time**: each step is its own request, so the 300 s cap applies per step. Every measured step fits. The plan step's budget (420 s:
  its 300 s attempt plus a fallback route) does not: on Hobby a plan whose first route runs long and then falls back is cut at 300 s
  with Vercel's `504 FUNCTION_INVOCATION_TIMEOUT` instead of the fallback's answer (the panel shows a timeout and can retry). Fixes: keep the
  plan budget at 290 s or less when hosted, or deploy under a Pro team (`vercel teams ls` lists `emufarm` as Pro) and raise `maxDuration`
  to 450 here and in `api/ai/[step].mjs`'s `config`.
- **Size**: Vercel caps a function's request and response body at **4.5 MB** (`413 FUNCTION_PAYLOAD_TOO_LARGE`); the local server takes
  12 MB and the client (`web/ai/orchestrator.js`, `MAX_BODY`) allows 12 MB. Text-only builds and a picture or two are far below it;
  4 reference pictures plus renders in a refine can pass it (the panel shows an input error). Keep pictures few on the hosted page until the
  client caps hosted requests at about 4.4 MB (or uploads pictures to Blob first).
- **Progress polling**: while a step runs, the panel asks `GET /api/ai/progress?id=...`, which only the local server answers. On Vercel the
  function answers 405, the panel stops asking after 3 misses in a session; three failed requests show in DevTools, nothing else happens.
- **Memory and region**: the default 2 GB / 1 vCPU is plenty (the function's engine runs the starter, 541 frames, in about 0.3 s);
  the function runs in `iad1` (Washington, D.C.) by default.
- **Streaming**: the function answers once at the end (no bytes for up to 300 s). Vercel keeps HTTP/2 connections alive with PING frames;
  an HTTP/1.1 proxy in between could still drop a long silent request.

## Protection, in layers

1. **Vercel Authentication** (Standard Protection) on every preview and generated URL: no login or share link, no page and no `/api/ai/*`.
2. **The function's own checks** (`api/ai/[step].mjs`): POST only (405), only the four steps (404), a JSON body of the right shape (400) and size
   (413), and with `ALLOWED_ORIGINS` set, browser calls from other origins refused (403). It runs only its own fixed prompts (no free-form
   proxying), the key comes from the environment and is scrubbed from every answer and error, and it never reaches the browser or the
   static files (the build checks that no shipped file holds its value).
3. **Before anything public**: a per-user and per-IP rate limit and a daily spend cap (a Vercel Firewall rate-limit rule on `/api/ai/`, within
   the plan's WAF limits, or a KV counter checked before `runStep`; every answer's `usage.costInUSD` says what it cost). The per-user part
   and the spend caps are built: with accounts on (setup step 6), `api/_lib/ai-gate.mjs` checks them in Neon before each step and records each
   step's `usage.costInUSD` after it (docs/ACCOUNTS.md section 6). A per-IP flood limit is still the Firewall's job.

`/_src` and `/_logs` on a deployment need your Vercel login. Function logs carry no key (the AI core redacts it).

## Cost

- **Vercel Hobby** is free within its monthly allowances: 100 GB Fast Data Transfer, 1,000,000 CDN requests, 1,000,000 function
  invocations, 4 CPU-hours of Active CPU, 360 GB-hours of provisioned memory. A first visit downloads about 4.6 MB (1.3 MB compressed;
  the vendor files are then cached for a year), so 100 GB is tens of thousands of first visits. An AI step is mostly waiting for the model,
  which is not Active CPU; provisioned memory counts the whole wait (2 GB x 45 s for a typical plan = 0.025 GB-hours; 360 GB-hours is
  about 14,000 such plans). Over a Hobby allowance the feature pauses (up to 30 days); it does not bill.
- **Hobby's terms**: Vercel's fair use guidelines limit Hobby to **non-commercial, personal use**. A demo for investors in a company is
  arguably commercial: Pro is $20 per member per month (and adds spend management, longer function durations, Password Protection as an add-on).
- **The model** is the real cost, paid to the gateway, not Vercel: `ai/research/benchmark.md` measured a plan call with the 40k-token
  catalog at about $0.21–0.34 when it writes the prompt cache and $0.02–0.09 when it reads it (all Opus routes); a full "Build with AI"
  run is a plan, a picture step when there are pictures, and a few refine rounds. Protection (above) is what keeps strangers from spending it.

## Robot keys and the video gallery (the video pipeline)

An agent makes physics lesson videos on the live site by itself and publishes each one, once every check passed, to the team's gallery in
Vercel Blob. It has no Google sign-in: it sends a **robot key** in the header `x-agent-key` on `/api/ai/*` and `/api/videos/*`.

**Variables** (names only; values never in this repo, a command line or a log):

| Name | Where | What |
| --- | --- | --- |
| `AI_AGENT_KEY` | Vercel Production + Preview (sensitive); `~/.config/physics-sandbox/agent.env` | the owner's master robot key (caller `agent:owner`); at least 32 characters |
| `VIDEO_GALLERY_ID` | Vercel Production + Preview (sensitive); `agent.env` | the gallery's unguessable folder: `videos/<VIDEO_GALLERY_ID>/` in Blob and the page `/videos/<VIDEO_GALLERY_ID>` (made with `openssl rand -hex 16`, 2026-10-19) |
| `BLOB_READ_WRITE_TOKEN` | set by the Blob store `physics-sandbox-videos` (public access) linked to the project; also `.env.local` | server only: signs the upload tokens, checks the files, writes the indexes |
| `AI_AGENT_USD_PER_DAY`, `AI_AGENT_STEPS_PER_HOUR` | optional | the master key's caps, and a new key's defaults: 25, 120 |
| `AI_AGENT_VIDEOS_PER_DAY`, `AI_AGENT_UPLOAD_MB_PER_DAY` | optional | the master key's video caps: 50 new videos and 2000 MB of upload grants a day (a new key's defaults are the same, set per key with `--videos`, `--mb`) |
| `VIDEO_BLOB_API_URL` | tests only | a mock Blob API instead of `https://vercel.com/api/blob` |

Vercel applies a variable to deployments made after it: deploy once after adding them.

### Robot keys (`api/_lib/agent-keys.mjs`)

- **Keys**: the master `AI_AGENT_KEY` (name `owner`) and per-person keys in Neon (`agent_keys`: name, the key's **sha256** only, `usd_per_day`
  default 25, `steps_per_hour` default 120, `videos_per_day` default 50, `upload_mb_per_day` default 2000, created, revoked). The tables and
  columns are made by the functions on first use (schema version 4: the two video caps).
- **Checking**: the key is hashed and compared to the master's hash with `crypto.timingSafeEqual` (fixed 32-byte digests: no length or
  prefix shows in the time); a per-person key is found by its hash and compared again the same way. A match is the caller `agent:<name>`;
  a wrong, unknown or revoked key is **403** `{code: "forbidden"}`; no header changes nothing for anyone else.
- **On `/api/ai/*`**: no Origin, sign-in, invite cookie or preview token is needed (the key is the proof; a page on another site cannot send
  the header without a CORS preflight, which these functions never grant). Each key has **its own caps** (dollars per day, steps per hour,
  reserved and settled like a person's), and agents are **not counted in `AI_SITE_USD_PER_DAY`**, so a batch of videos never closes Build
  with AI for people, nor people's use a batch. Over a cap: **403** `{code: "quota", resetsAt}`.
- **The owner's tool** (on the owner's machine; changes apply at once, no redeploy):
  ```sh
  node tools/video-agent/keys.mjs issue <name> [--usd 25] [--steps 120] [--videos 50] [--mb 2000] [--out <file>]   # prints the key ONCE (or writes it, mode 600)
  node tools/video-agent/keys.mjs revoke <name>                                                               # refused from the next request on
  node tools/video-agent/keys.mjs list                                                                        # names, caps, status, today's use (never a key)
  ```
  It needs `DATABASE_URL` (the site's Neon connection string) in `blender-playground/.env.local` or the environment. On Vercel it is a
  sensitive variable, so `vercel env pull` leaves it empty: copy it once from the Vercel dashboard (Storage, the Neon database, its
  connection string) or the Neon console into `.env.local` (git and the upload ignore `.env*`). A revoked name can be issued again (a new key).

### The video endpoints (`api/_lib/videos.mjs`)

`POST /api/videos/upload` `{job, files: [{name, type, size}]}` answers, per file, a Blob **client token** good for 15 minutes and only for
`videos/<VIDEO_GALLERY_ID>/jobs/<job>/<name>`, that name's content type and at most the declared size (the Blob API refuses anything else:
another path, a bigger file, another type, an expired or forged token; checked against the real store on 2026-10-19). The caller uploads the
bytes straight to Blob with one request, no SDK and no 4.5 MB function limit:

```js
const { uploads } = await (await fetch(`${site}/api/videos/upload`, { method: "POST", headers: { "content-type": "application/json", "x-agent-key": key }, body: JSON.stringify({ job, files }) })).json()
for (const u of uploads) await fetch(u.put.url, { method: u.put.method, headers: u.put.headers, body: bytesOf(u.name) }) // put.headers carry the token
```

(`@vercel/blob/client`'s `put(u.pathname, body, {access: "public", token: u.token, contentType: u.contentType})` works too.) Asking again for
the same job gives fresh tokens and overwrites, **until it is published**: then its files are final and asking is 409 `already_published`
(for every key; a new video is a new job name), and publish records each file's size and etag. The **first key to ask for a job owns it**:
another key gets 409 `conflict` (the master key may touch any job). Job and batch names: 3-80 of `a-z 0-9 - _`, starting with a letter or
digit. A token already handed out stays good until it expires (15 minutes), also after its key is revoked or its job published: Blob checks
only the token's own signature and expiry.

**Each key's daily caps** (counted in `counters` as `vid:<name>`, reset at 00:00 UTC; over one: **403** `{code: "quota", resetsAt}`, and a
refused ask counts nothing): **new videos** (a job's first upload grant; `videos_per_day`, default 50), **megabytes of upload grants** (the
declared sizes, rounded up, every ask; `upload_mb_per_day`, default 2000) and **publishes** (each rewrites 2-4 index files in Blob: at most 3
per video of the key's cap). The master key's come from `AI_AGENT_VIDEOS_PER_DAY` and `AI_AGENT_UPLOAD_MB_PER_DAY`. `keys.mjs list` shows
each key's caps and today's videos and megabytes.

| File | Type | At most | |
| --- | --- | --- | --- |
| `video.mp4` | `video/mp4` | 200 MB | required to publish |
| `poster.jpg` | `image/jpeg` | 5 MB | required to publish |
| `concept.jpg`, `frames.jpg` | `image/jpeg` | 10 MB, 15 MB | |
| `scene.json`, `audit.json` | `application/json` | 5 MB each | |
| `captions.vtt` | `text/vtt` | 1 MB | shown as the player's captions |
| `report.html` | `text/html` | 4 MB | Blob serves HTML as a **download** (`Content-Disposition: attachment`, measured), so the site shows it: `report_url` |

`POST /api/videos/publish` `{job, batch?, title, request, lesson: {id?, grade?, concept?}, seconds, checks, cost_usd}`: checks that the job's
`video.mp4` and `poster.jpg` are in Blob (409 `missing_files`) and that **every check passed**, then records the publishing key's name. The
check gate **fails closed**: `checks` is `[{name, ok: true | false}, ...]` (`id` may stand for `name`; other descriptive fields such as
`detail` are fine) or `{name: true | false, ...}`, at most 500 (413). Any entry it can't read is **400** `bad_input`, never skipped: `ok`
not a boolean (`"false"`, `1`), a result said another way (`result`, `status`, `passed`, `failed`, ...), no name, an empty list, a summary
such as `{passed: 40, failed: 0}`. Any `ok: false` anywhere in the list: 409 `checks_failed` with the failed names. What is stored (and shown)
is the whole list as `[{name, ok}]`. Then it rewrites from the database the gallery's
`videos/<id>/index.json` + `index.html` and, with `batch`, `videos/<id>/batches/<batch>/index.(json|html)` (60 s cache). Publishing the same
job again is idempotent (one entry, the same bytes; its first publish time kept); a job moved to another batch leaves the old batch's index.
It answers `{video_url, poster_url, report_url, gallery_url, gallery_json_url, gallery_html_url, batch_url, batch_json_url, published_by,
published_at, checks}`. `gallery_url`, `batch_url` and `report_url` are **pages on this site**, `/videos/<VIDEO_GALLERY_ID>[/batches/<batch>]`
and `/videos/<VIDEO_GALLERY_ID>/jobs/<job>/report` (`api/videos/gallery.mjs`, from the database, no script, a strict CSP, `noindex`), because
Blob hands HTML out as a download; the Blob `index.html` is the same page as a file, and the cards' Report links and index.json's
`report_url` are the report pages (index.json's `files` keep the raw Blob URLs). A report page is the job's `report.html` as uploaded; its
relative links work: `/videos/<id>/jobs/<job>/captions.vtt` is served by the function (a `<track>` loads same-origin only), any other of the
job's files (`video.mp4`, `poster.jpg`, `audit.json`, ...) redirects (302) to its Blob URL, and `../../index.html` reaches the gallery page.
Only a published job's files are there (anything else 404). Anyone with the gallery's link can watch it (the production domain is public); a new
`VIDEO_GALLERY_ID` starts a new gallery (the old files stay in Blob). Nothing in any answer, index or page is a key or the Blob token.

**Blob's Hobby limits** (Vercel's docs, 2026-09-23): 1 GB stored, 2,000 advanced operations (every upload, each multipart part, every
index rewrite), 10,000 simple operations and 10 GB of downloads a month; **over any of them Blob stops for 30 days** (no bill). One video
here is about 4-8 uploads plus 2 index writes (4 with a batch), so roughly 150-250 videos a month by operations and, at 10-20 MB a video,
50-100 by storage; a class watching them spends the 10 GB fast. For mass production, move the team to Pro (usage-based, with Spend
Management) or keep videos short and small; Observability, Blob in the dashboard, shows the use (browsing the store there counts as operations).

**For an agent driving the live page** (not only calling the API): with accounts on, `/api/scenes/me` says `ai: {signInRequired: true}` and
the page shows its sign-in sheet instead of Build with AI (docs/ACCOUNTS.md §6). The robot key is honoured on `/api/ai/*` and
`/api/videos/*` only, so such an agent adds the header to those requests itself (for example Playwright `page.route("**/api/ai/**")`) and
answers the page's own `/api/scenes/me` with `signInRequired: false` in the same way.

**Checked** (2026-10-19): `ai/test/agent-videos.test.mjs` (in `npm run test:ai`: the master key, a per-person key, revoked, wrong, empty,
oversized and missing keys, caps independent of the site cap, the constant-time comparison, tokens held to the job's path, names, types and
sizes, ownership, publish's refusals, idempotent indexes, batches, the gallery page, the keys tool, no key in any answer, stored file or log
line; PGlite and a mock Blob API; since 2026-10-19 evening also the fail-closed checks gate (a failure at #220 of 250, 21 unreadable shapes,
over 500), no upload after publish, the report page and a job's files, each key's caps); `check:vercel` builds and calls the three
functions and resolves `/videos/<id>/index.html` and `.../report.html` through the built routes; and one run against the **real** Blob store with a
throwaway gallery id (upload tokens, the PUTs, a wrong path refused, publish, index.json at its public URL, republish, the page; its 8 files
deleted after).

## Troubleshooting the build

| The build says | Do |
| --- | --- |
| `web/<x>/ is neither shipped nor left out` | add the folder to `SHIP_DIRS` (it is loaded at run time) or `SKIP_DIRS` (dev-only) in `tools/build-static.mjs` |
| `"three/addons/..." -> ... is not in the build` or `vendor:three:check failed` | `npm run vendor:three` (a new addon import). If vendor-three says a file "imports" an addon it cannot follow, that file has the text `"three/addons/...` in quotes (a comment counts): write the full addon file name, or reword the comment |
| `"x" is not in the importmap` | a bare import the page cannot resolve: add it to the importmap in `web/index.html` (and vendor it) or import by path |
| `is on another origin` | the app must load everything from its own origin: vendor it |
| ``import(`./models/${g}.js`) with the names [...]: ... not in the build`` | a model group named in `web/models3d.js` has no file |
| `names a development-only file` | only a dynamic `import()` may name a `DEV_ONLY` file (`web/ai/dev-mock.js`): it is not in the build |
| `scenario-list.json ...` / `gen:scenarios:check failed` | `npm run gen:scenarios` after adding, renaming or removing `web/scenarios/*.json` |
| `web/sim/engine-worker.js ... is not what npm run build:engine makes from the current sources` (`build:static:nogen`, an error) | the engine's sources changed since the bundle was built: `npm run build:engine`, then the parity tools (`web/CONTRACT.md`, "Browser port, parity and builds"). A deploy would fail on it too |
| `came out different from the copy that was uploaded, so this deploy would ship engine code the parity tools never checked` (Vercel's build, an error) | the same, found on Vercel: the deploy failed and nothing changed. Rebuild the engine and run the parity tools locally, then deploy again |
| `came out different from the copy that was uploaded` (a warning, `vendor` or `scenario-list.json`) | the deploy has the fresh copy; run `npm run vendor:three`, `vendor:media` or `gen:scenarios` locally so the repo matches what shipped |
| `vercel-check: the function lacks ...` | a file under `ai/` or `web/sim/` is not in the function: widen `functions["api/ai/*.mjs"].includeFiles` in `vercel.json` |

The build only ever wipes an output folder it made (the marker `.dist.build-static` beside `dist/` says so), and refuses to write into
`web/`, `ai/` or any other source folder.

## Verified (2026-10-15, before any deploy)

The numbers change as the app grows; the current ones are in the build log's `dist/ ready:` line and `check:vercel`'s `upload:` and
`function:` lines.

- `npm run check:vercel` (a copy of the upload in which one in-progress comment in `web/models/bake-worker.js`, another branch's file, was
  reworded so `vendor:three` could read it): upload 155 files, 5.2 MB; `vercel build` (CLI 63.1.0) passed, its regenerated engine bundle,
  three.js, mediabunny and scenario list byte-identical to the uploaded ones; `dist/` 101 files, 4.6 MB (1.3 MB gzipped), 79 modules and 5
  stylesheets checked, no dev-mock, no dot files; the function `nodejs24.x`, `maxDuration` 300, `supportsCancellation`, 35 files, 1.1 MB, no
  source map; called as deployed: GET 405, an unknown step 404, the starter's `edit` 200 through `claude-group/claude-opus-5-5`, no key
  in any answer; its engine ran the starter (541 frames, the goal met).
- The checks, against broken copies: an engine source edited without rebuilding the bundle (`build:static:nogen` and Vercel's `--regen`
  both failed, naming the bundle; `--regen --allow-engine-drift` passed with a warning), a static import of `dev-mock.js`, and the old
  narrow `includeFiles` (`check:vercel` named the file the function lacked) each failed. From the first round: a missing three addon, a
  missing relative import, a bare name outside the importmap, a CDN import, a bare import in the engine Worker, a missing model group, a CSS
  `url()` to a missing file, a CSS `@import` and HTML `<link>`/`<script>` to other origins, a new `web/` folder and a file holding the key's
  value each failed the build with its file named.
- `dist/` served with vercel.json's headers on `http://sandbox.test:<port>` (a non-local host name mapped to 127.0.0.1, every other host
  unresolvable), headless Chromium (first round): the page chose the browser engine by host, ran the starter ("Ran in 0.2 s", its goal met)
  in the module Worker, opened the catalog (113 cards), opened the AI panel, and exported a 2 s 1280x720 30 fps MP4 with sound (ffprobe:
  H.264, 60 frames, AAC); every request to its own origin or a `blob:` Worker, none elsewhere; no failed responses, no console errors; every
  `.js` as `text/javascript`, `/vendor/*` immutable, the rest revalidating, `nosniff` on all. Vercel adds nothing to a local copy, so the
  Toolbar check after the first real deploy (above) is still to do.
