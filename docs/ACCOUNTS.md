# Accounts: sign in with Google, and every scene you saved, on any device

Status (2026-10-15): **the server and the sign-in are built and tested; switched off until the owner connects Clerk and Neon** (section 9,
about 10 minutes, which only the owner can do: it creates provider accounts and accepts their terms). Until then every deployment behaves as
before: `/api/scenes/me` answers `{accounts: null}`, the page keeps scenes in the browser, and the AI function keeps its old access check.
What was built, how it was checked and where it differs from the design below: **section 13**; the repairs after review (round 3: storage
bounds, the Build-with-AI sign-in sheet, Save links, two-device conflicts, account deletion): **section 14**. The page's library and account
chip (`web/account/` except `clerk.js`) are a separate build step with its own notes (7.9).

What changes for people using the sandbox:

- **Anyone** can still open the sandbox and use it without an account: build, run and export videos. Saves stay in that browser, as they do today.
- **Signing in** is one button, **Continue with Google**. After that, **Save** keeps the scene in your account, and **My scenes** shows every
  scene you saved, each with a picture, on any device you sign in on. You can open, rename, duplicate, export and delete them.
- **Build with AI** on the hosted site needs sign-in. Each person gets a daily allowance, and the whole site has a daily spend cap, so a link
  that travels further than intended cannot run up the AI bill.

| Part | Choice | One-line reason |
| --- | --- | --- |
| Sign-in | **Clerk**, added from the Vercel Marketplace (Vercel-native integration), Google as the only sign-in method | Google sign-in works in Clerk's development instance with no Google setup, and the keys reach the project by themselves |
| Instance for the demo | Clerk's **development instance** (Vercel Development and Preview environments) | It works on `*.vercel.app`. A production instance needs a domain the owner controls and the owner's own Google OAuth client |
| Storage | **Neon Postgres** from the Vercel Marketplace, free plan: scenes, thumbnails, accounts and AI counters in one database | Per-user listing, ownership checks, atomic quotas and private access in one place, with one integration to add |
| Browser SDK | `@clerk/clerk-js` **6.39.0**, its "no remotely hosted code" build, **vendored** into `web/vendor/clerk/` like three.js, loaded lazily through the importmap. Clerk's prebuilt UI is not used | No third-party script on the page. The sign-in UI is the app's own |
| Server check | A Clerk session token (RS256 JWT) in `Authorization: Bearer`, verified with `node:crypto` against the instance's public JWKS | No SDK dependency, and no cookies, so there is no CSRF surface |
| AI | `api/ai/[step].mjs` accepts a signed-in user (plus the invite cookie and preview token it already accepts), and checks per-user and site-wide limits in Neon before each step | Public page, private wallet |

## 1. Decisions (checked against the providers' current docs on 2026-10-15)

### 1.1 Sign-in: Clerk via the Vercel Marketplace, development instance for the demo

Verified:

- Clerk is a **Vercel-native** Marketplace integration. "Install" creates a Clerk account (billing through Vercel), an application, and
  **both instances**. Clerk's **development instance maps to Vercel's Development and Preview environments**, and its production instance
  maps to Production. Connecting it to a project syncs **`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`** and **`CLERK_SECRET_KEY`** into every
  environment, with each environment getting its own instance's keys. The `NEXT_PUBLIC_` prefix means nothing here (there is no Next.js); the
  functions read the variable by that name.
- **Google in a development instance**: Clerk "uses preconfigured shared OAuth credentials and redirect URIs, and no other configuration is
  needed". You turn Google on under SSO connections, and that is all.
- **Google in a production instance** needs the owner's own Google OAuth client: in Google Cloud, a Web application client with Clerk's
  Authorized Redirect URI, and the consent screen published "In production". While it is in "Testing", Google limits it to 100 test users.
  The production instance also needs **a domain the owner controls**. Clerk's Vercel guide says "you cannot use a `*.vercel.app` domain for
  production".
- **Development instance limits:** at most **100 users**, and users cannot be moved between instances. Clerk's Hobby plan is free up to
  50,000 monthly retained users per app and up to 3 social connections.
- **Sign-up challenges.** "Challenge suspicious sign-ups" (Cloudflare Turnstile) is on by default for new applications. It never
  challenges a sign-in. In a custom flow it needs clerk-js 6.39.0 or later and loads Cloudflare's script. See 1.3 for why the demo turns it
  off.

Why the **development instance** is right for the investor demo: the demo runs on Vercel **preview** deployments behind Vercel
Authentication and its share link (docs/DEPLOY.md: never `--prod` yet). Previews get the development keys by themselves, the
`*.vercel.app` URL is allowed, and Google works with no Google Cloud project. Two costs, both acceptable for a demo:

- Google's account chooser names Clerk's shared app, not "Physics Sandbox".
- There is a 100-user cap.

Moving to production later (section 9.5) needs a domain, DNS records, and a Google OAuth client. Scenes are not lost when that happens: the
data model links a person's production sign-in to the account they already have, by their verified Google email (3.1).

Not chosen:

- **Hand-rolled Google Identity Services** would load `accounts.google.com/gsi/client` into the page, need our own OAuth client from day one,
  and need our own sessions.
- **Neon Auth** and **Auth.js** need more setup and more server code for the same result.
- **Sign in with Vercel** signs people in with Vercel accounts, not Google.

### 1.2 Storage: Neon Postgres for all of it

| Need | Neon Postgres (chosen) | Vercel Blob (private store) | Upstash Redis |
| --- | --- | --- | --- |
| "My scenes" with name, date, item count, picture | one indexed query `WHERE owner_id = $1 ORDER BY updated_at DESC` | `list({prefix})` is an *advanced* operation (2,000 a month free on Hobby), and names would need a second read per scene | sorted set plus hash per scene: workable, but every field is hand-kept |
| Ownership and partial updates | SQL `WHERE owner_id`, row versions for If-Match | path naming conventions only | hand-written |
| Per-user and site AI limits | one atomic `INSERT ... ON CONFLICT ... WHERE n < cap` | not possible | natural (`INCR`) |
| Private access | only through our function | private store through our function | through our function |
| Thumbnails (20–40 KB) | `bytea` beside the scene, served by our function on our origin | natural, but a public store would put images on `*.blob.vercel-storage.com` (another origin), and a private one is served through a function anyway | poor fit (memory) |
| Free tier | 1 GB storage per project, 100 CU-hours a month, 5 GB egress, scales to zero after 5 min idle | 1 GB, 10k simple and 2k advanced ops, 10 GB transfer | (not needed) |
| Owner's setup | one integration | one store | one integration |

Neon does all four jobs with one integration and one environment variable (`DATABASE_URL`). One gigabyte holds about 15,000 scenes with
pictures (a scene is 5–60 KB of JSON, a picture 20–40 KB). **Blob is the right place for MP4 videos later** (they are 5–100 MB, past the
4.5 MB function body limit, so they need Blob's client uploads). Videos stay downloads in this version.

Driver: **`@neondatabase/serverless` 1.2.0** (exact pin; Neon's HTTP query mode with no dependencies of its own). There are no connection
pools to manage on Fluid compute, and `sql.transaction([...])` covers the two-statement quota updates.

### 1.3 The browser SDK: vendored, pinned, headless

- npm `@clerk/clerk-js` **6.39.0** (published 2026-10-09; `latest`). Its exports include `./no-rhc` (`dist/clerk.no-rhc.mjs`, 839 KB): a
  build without remotely hosted code (Clerk added it for browser extensions; it drops the Stripe and wallet loaders). The default
  `dist/clerk.mjs` is 1.5 MB. **As built:** it is *not* a package.json dependency (that would add its ~50 dependencies, 159 MB of wallet SDKs,
  to every `npm ci`); `tools/vendor-clerk.mjs` takes the one pinned tarball with `npm pack` and checks its sha512 integrity before using it
  (section 13).
- In Core 3 (clerk-js 6) Clerk's prebuilt components live in a separate `@clerk/ui` bundle, which the documented setup loads **at run time
  from the Clerk Frontend API domain** (`https://<fapi>/npm/@clerk/ui@1/dist/ui.browser.js`). This design loads **no Clerk UI**: the app
  draws its own sign-in sheet, avatar and menu, so nothing is fetched as code from Clerk at run time.
- **`tools/vendor-clerk.mjs`** (new; modelled on `tools/vendor-media.mjs`) bundles `node_modules/@clerk/clerk-js/dist/clerk.no-rhc.mjs`
  with the pinned esbuild into **one ES module, `web/vendor/clerk/clerk.mjs`** (minified, browser target, `process.env.NODE_ENV`
  "production"), plus Clerk's MIT `LICENSE`. `--check` writes nothing and exits 1 when the folder differs. `web/index.html`'s importmap
  gains `"clerk-js": "./vendor/clerk/clerk.mjs"`. `tools/build-static.mjs` then publishes it under a content-hashed `vendor/clerk-<hash>/`
  with a year of immutable caching, as it does for three.js and mediabunny.
- `web/account/account.js` loads it with `await import("clerk-js")` **only when the deployment has accounts configured**, after the first
  picture. Nothing changes for page load on the local server or on a deployment without accounts. The build step records the bundle's size
  (estimate: about 250–350 KB minified, under 100 KB gzipped).
- `clerk.load({ telemetry: false })` with no `ui` option. Telemetry is off so that the development instance does not report SDK events.
  The build step confirms the option name against the vendored version.
- **Other origins the page now talks to** (fetch and navigation only, never code):
  - Clerk's Frontend API, `https://<slug>.clerk.accounts.dev` in development and `https://clerk.<domain>` in production;
  - a top-level navigation to Google's account chooser during sign-in.

  docs/DEPLOY.md's after-deploy check ("every other request goes to the deployment's own origin") needs that exception added when this
  ships. Clerk can be proxied through our own origin later (its Frontend API proxy works for both instance types). It is not needed for the
  demo, and it would add a function hop to every token refresh.
- **Sign-up challenge: off for the demo** (one Clerk dashboard switch, section 9.1). The no-remotely-hosted-code build is not expected to be
  able to load Turnstile, and Clerk documents the vanilla-JS return from a redirect challenge less than the React one. If an investor on a
  VPN were challenged on their first sign-in, the demo would stall. With Google as the only sign-in method, the 100-user cap, and the AI
  limits in place, turning it off is the smaller risk. To turn it back on later: switch `tools/vendor-clerk.mjs` to `dist/clerk.mjs`, test a
  challenged sign-up, then flip the switch.

### 1.4 How the functions check who is calling

The page sends `Authorization: Bearer <token>`, using `await clerk.session.getToken()`. clerk-js caches the token and refreshes it before it
expires; it lives about a minute by default. The functions never read Clerk's cookies. `api/_lib/auth.mjs` verifies the token with
`node:crypto` alone, following Clerk's "manual JWT verification" steps:

1. **Split and parse.** Exactly three base64url parts. The header must be `alg: "RS256"`. Any other algorithm, including `none` and
   `HS256`, is refused.
2. **Key.** The `kid` is looked up in the instance's JWKS at `https://<fapi>/.well-known/jwks.json`. The Frontend API host comes from the
   publishable key: `pk_test_`/`pk_live_` + base64(`<host>$`). The JWKS is public, so no secret is needed. It is cached per instance for one
   hour. An unknown `kid` refetches it, at most once a minute. When `CLERK_JWT_KEY` (the PEM from Clerk's API keys page) is set, it is used
   instead, with no network call.
3. **Signature.** `crypto.verify("RSA-SHA256", ...)` with `createPublicKey({ key: jwk, format: "jwk" })`.
4. **Claims.**
   - `iss` must equal `https://<fapi>`.
   - `exp` must be in the future and `nbf` in the past, each with 5 s of leeway.
   - `sub` must be present.
   - `azp`, when present, must be one of the deployment's own origins. These are the same list as the AI function's `allowedOrigins()`:
     `VERCEL_URL`, `VERCEL_BRANCH_URL`, `VERCEL_PROJECT_PRODUCTION_URL` and `ALLOWED_ORIGINS`. Off Vercel, `http://localhost:<port>` is
     also accepted. Clerk warns that skipping the `azp` check opens CSRF.
   - `sts`, when present, must be `"active"`.
5. **Result.** `{ iss, sub, sid }`. Failure gives **401** `{ code: "sign_in", expired: true|false }`. With `expired: true` the page refreshes
   the token once (`getToken({ skipCache: true })`) and retries.

The **Backend API** (`CLERK_SECRET_KEY`) is called in exactly two places:

- once when a new person first arrives, `GET https://api.clerk.com/v1/users/{sub}`, for their name and verified primary email (3.1);
- when someone deletes their account, `DELETE /v1/users/{sub}`.

### 1.5 Build with AI behind sign-in

`api/ai/[step].mjs` today accepts an `ai_session` invite cookie, or, on previews, the `x-ai-access` token. It answers 503 when neither is
configured. With accounts configured it also accepts **a signed-in user**. Anonymous callers get **401** with
`{ code: "sign_in", error: "Sign in with Google to use Build with AI" }`. Before any step it checks **per-user and site-wide limits** in Neon,
and after the step it records the step's `usage.costInUSD`. Details are in section 6. This closes the gap docs/DEPLOY.md lists under "Not
production": "a per-user rate limit and a daily spend cap in front of the AI steps".

## 2. How it fits together

```
browser (static app, ES modules)                                       Vercel functions (Node 24, Fluid)              Neon Postgres
 web/app.js  api(path, body, signal) ──► window.sandboxAccount.wants()?
                 │ no: as today (web/sim/api.js in the page, or fetch)
                 ▼ yes
 web/account/account.js ── Bearer token ──► /api/scenes, /api/scenes/:id[/thumb|/restore], /api/scenes/me
   ├ cloud.js (signed in)                    api/scenes/index.mjs (one function; vercel.json rewrites)  ─► accounts, identities,
   ├ local-idb.js (signed out: IndexedDB)    api/_lib/{auth,origin,db,accounts,http}.mjs                      scenes, counters
   ├ ai-signin.js ("Build with AI needs an account", signed out on a deploy whose AI needs sign-in)
   ├ library.js ("My scenes" dialog)        /api/ai/<step>  api/ai/[step].mjs + api/_lib/ai-gate.mjs ──► counters (quota, spend)
   ├ thumb.js (640x360 picture of the scene)
   └ clerk-js (vendored) ──fetch──► Clerk Frontend API (*.clerk.accounts.dev)        api.clerk.com (secret key, server only)
```

**Where scenes live, by how the page runs:**

| The page runs on | Accounts | Save goes to | "My scenes" shows |
| --- | --- | --- | --- |
| the local server, `localhost:8790` (`web/server.py`, untouched) | none (`/api/scenes/me` is 404 there) | `web/saved/` through the server, as today | the server's saved scenes (open only; rename and delete are hidden, because the server has no such routes) |
| `npm run preview:static` | none (`/api/*` answers 503) | this browser | this browser's scenes |
| a Vercel deploy without Clerk configured | none | this browser | this browser's scenes |
| a Vercel deploy, signed out | **Sign in** button | this browser | this browser's scenes, plus "Sign in to keep your scenes everywhere" |
| a Vercel deploy, signed in | your initials | **your account** | your account's scenes, plus a one-time offer to copy this browser's scenes in |

### 2.1 New files (no other agent works on these)

| File | What it is |
| --- | --- |
| `api/scenes/index.mjs` | The one scenes function. It routes `/api/scenes`, `/api/scenes/me`, `/api/scenes/:id`, `/api/scenes/:id/thumb` and `/api/scenes/:id/restore`. Vercel recommends one function per group of routes, so a warm instance serves all of them |
| `api/_lib/auth.mjs` | token verification (1.4) and publishable key parsing |
| `api/_lib/origin.mjs` | `allowedOrigins()` and `originProblem()`, the same rules as in `api/ai/[step].mjs` (that file may import them from here later) |
| `api/_lib/db.mjs` | the lazy Neon client (created on first use, never at import), the schema bootstrap, and the queries. Errors are scrubbed: a connection string never reaches an answer or a log |
| `api/_lib/accounts.mjs` | who a token belongs to: identities, accounts, and linking by verified email (3.1) |
| `api/_lib/ai-gate.mjs` | who may run an AI step, the quota checks, and recording usage (section 6) |
| `api/_lib/http.mjs` | answers in the AI endpoint's shape (`{ok, ...}` / `{ok: false, error, code, retryable}`), JSON body reading with a byte cap, `Cache-Control: no-store` |
| `web/account/account.js` | the entry point: config, Clerk, the sign-in sheet, the top-bar button and menu, `window.sandboxAccount`, the AI sign-in prompt, the copy-to-account offer |
| `web/account/cloud.js`, `local-idb.js` | the two libraries, with one interface (7.6, 7.9) |
| `web/account/ai-signin.js` | "Build with AI needs an account": the sheet in front of the AI for someone signed out, and the way back to it after Google (6, 14) |
| `web/account/library.js` | the "My scenes" dialog |
| `web/account/thumb.js` | the scene's picture for its card (7.5) |
| `web/account/account.css` | styles, using the app's existing tokens and button classes |
| `web/account/dev-mock.js` | development only (`?accountmock=1`): a fake Clerk and an in-memory `/api/scenes`, for headless tests. Listed in `DEV_ONLY`, so it never ships |
| `web/account/test/*.test.mjs` | node tests for the server (`api/_lib`, the function) and the local library. The build never ships `test/` folders |
| `tools/vendor-clerk.mjs` | vendors clerk-js (1.3) |

Files in `api/_lib/` are not turned into functions, because Vercel skips files whose names start with `_`. The build step's
`check:vercel` asserts that the built output has exactly the two functions `api/ai/[step]` and `api/scenes/index`.

### 2.2 Hooks in shared files (small, self-contained; re-read each file right before editing it)

**As built (server and sign-in, section 13):** `web/app.js` was **not** changed for accounts' server side: the AI token is added by
`web/account/clerk.js` (a wrapper around `window.fetch` for same-origin POSTs to `/api/ai/*` while someone is signed in, with one retry on an
expired token). `web/index.html` gained one importmap line (`"clerk-js"`); `tools/build-static.mjs`, `vercel.json`, `api/ai/[step].mjs`,
`package.json` and `.vercelignore` got the edits listed in 13.2. The page's own hooks (the library and the chip) belong to the page's build step.

**`web/app.js`** (about 6 lines). Split `api()` so the account layer can take the routes it owns. Pass extra headers through. Let a save
say where it went. Expose two app actions.

```js
// web/account/ (docs/ACCOUNTS.md) may answer the scenario routes (a signed-in person's scenes) and adds the sign-in header to /api/ai/*
async function api(path, body, signal) {
	const acct = window.sandboxAccount
	return acct?.wants?.(path, body) ? acct.api(path, body, signal, apiDirect) : apiDirect(path, body, signal)
}
async function apiDirect(path, body, signal, headers = {}) {   // the old api(), with `headers` added to both fetch() calls
	...                                                             // { signal, headers } and { ..., headers: { "Content-Type": "application/json", ...headers } }
}
```
- In `saveScene()`: `toast(r.persisted === false ? ... : r.saved ?? (BROWSER ? "Saved in this browser" : "Saved"))`. A cloud save answers
  `saved: "Saved to your account"`.
- Next to `window.sandbox = S`: `window.sandboxApp = { open: (id) => loadScenario(id), reloadScenarios: () => loadScenarioList() }`.

**`web/index.html`** (3 lines):
- `<link rel="stylesheet" href="account/account.css">`;
- the importmap entry `"clerk-js": "./vendor/clerk/clerk.mjs"`;
- `<script type="module" src="account/account.js"></script>` after `app.js`.

**`tools/build-static.mjs`** (4 small edits):
- `SHIP_DIRS` gains `"account"`;
- `DEV_ONLY` gains `"account/dev-mock.js"`;
- `vendor:clerk` joins the `--regen` list, and `vendor:clerk:check` joins the checks;
- the shipped-secret scan also covers the values of `CLERK_SECRET_KEY`, `DATABASE_URL`, `DATABASE_URL_UNPOOLED` and `PGPASSWORD` when they
  are set in the build's environment.

`check:vercel` additionally asserts the `api/scenes` function and the rewrite routes. It also calls the built function's `/api/scenes/me`
with no keys and expects `{accounts: null, storage: false}`.

**`vercel.json`** (one new key, one new `functions` entry):

```json
"rewrites": [
  { "source": "/api/scenes/:id", "destination": "/api/scenes" },
  { "source": "/api/scenes/:id/:part", "destination": "/api/scenes" }
],
"functions": { "api/scenes/*.mjs": { "maxDuration": 30, "includeFiles": "{web/sim/**/*.js,web/sim/**/*.json}", "excludeFiles": "web/sim/**/*.map" } }
```

Vercel turns the named segments into query parameters (`req.query.id`, `req.query.part`). `includeFiles` is there because the function
validates scenes with `web/sim/clean.js`, which imports the catalog. The headers and `cleanUrls` already in `vercel.json` work with
`rewrites`; only the legacy `routes` key would not.

**`api/ai/[step].mjs`** (about 4 lines; section 6). Replace the `accessProblem(req)` call with
`const gate = await aiGate(req, step, { accessProblem })`, and record usage in the `finally` block.

**`package.json`**:
- dependencies `"@clerk/clerk-js": "6.39.0"` and `"@neondatabase/serverless": "1.2.0"`;
- scripts `vendor:clerk`, `vendor:clerk:check` and `test:accounts`;
- the lockfile updated with them.

**`.vercelignore`**: `/web/account/test`.

## 3. Data model (Neon Postgres)

The function creates the tables itself the first time it runs (idempotent DDL, guarded by `schema_version`), so the owner never runs SQL.

```sql
create table if not exists accounts (
  id             text primary key,                 -- 'u_' + 16 base32 chars (ours; stable across Clerk instances)
  email          text,                             -- primary email, lower-cased, from Clerk's Backend API (once)
  email_verified boolean not null default false,
  name           text,                             -- display name (first + last), for the account menu
  created_at     timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  ai_usd_per_day numeric(8,2),                     -- this account's own AI allowance (null = AI_USER_USD_PER_DAY)
  disabled       boolean not null default false    -- blocks scenes and AI for this account (an admin switch, set by SQL)
);
create unique index if not exists accounts_email on accounts (email) where email_verified;

create table if not exists identities (            -- a Clerk user in one Clerk instance -> our account
  iss        text not null,                        -- the instance (its Frontend API URL)
  sub        text not null,                        -- the Clerk user id in that instance
  account_id text not null references accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (iss, sub)
);

create table if not exists scenes (
  id          text primary key,                    -- 's_' + 16 base32 chars (80 random bits), made by the server
  owner_id    text not null references accounts(id) on delete cascade,
  name        text not null,                       -- 1-60 chars (rules below); also written into scene.name
  scene       json not null,                       -- web/sim clean() output, kept as text exactly (json, not jsonb: never queried inside)
  scene_bytes integer not null,                    -- UTF-8 length of that text
  item_count  integer not null,
  thumb       bytea,                               -- the card's picture: WebP, JPEG or PNG
  thumb_type  text check (thumb_type in ('image/webp', 'image/jpeg', 'image/png')),
  thumb_etag  text,                                -- 16 hex of its SHA-256 (in the picture's URL, so it can be cached forever)
  version     integer not null default 1,          -- +1 on every change of name or scene (If-Match)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),  -- a name or scene change; a new picture alone does not change it
  deleted_at  timestamptz,                         -- deleted (can be restored for 30 days, while the account has room: 3.2)
  saved_as    text                                 -- (schema 2) the app's scenario it was saved as with Save: picking that again continues it
);
create index if not exists scenes_owner_recent on scenes (owner_id, updated_at desc) where deleted_at is null;
create index if not exists scenes_owner_deleted on scenes (owner_id, deleted_at) where deleted_at is not null;  -- (schema 2)

create table if not exists counters (              -- AI quotas, site spend, scene write rate
  key    text not null,                            -- an account id, 'inv_<nonce>' (an invite cookie), 'tok' (the preview token), or '*' (the whole site)
  bucket text not null,                            -- 'ai:d:2026-10-15', 'ai:h:2026-10-15T13', 'w:h:2026-10-15T13' (UTC)
  n      integer not null default 0,
  usd    numeric(10,4) not null default 0,
  primary key (key, bucket)
);
create table if not exists schema_version (v integer primary key);
```

### 3.1 Who a token is (`api/_lib/accounts.mjs`)

1. **Known person.** Look up `identities (iss, sub)`. Found: that account. `last_seen_at` is updated at most once an hour.
2. **New person.** Fetch the user from Clerk's Backend API (3 s timeout) for their verified primary email and name. If an account with
   that **verified** email already exists, add this identity to it. This happens when someone first signed in on the development instance
   and now signs in on production. Otherwise create a new account, then the identity.
3. **Backend API unreachable.** Create the account without an email, and try again on a later request while the email is still missing.

Linking happens only on a Google-verified email. With Google as the only sign-in method, nobody can claim a verified address they don't
own. Within one Clerk instance two users never share an email, so linking only ever joins the same person across instances.

### 3.2 Limits

| What | Limit | Answer when over |
| --- | --- | --- |
| request body (POST/PUT JSON, picture included) | 1.5 MB (checked from `Content-Length`, and again while reading) | 413 `too_large` |
| scene JSON after `clean()` | 256 KB (a 200-item scene is about 60 KB). Top-level keys the app never reads are dropped first (kept: `version`, `id`, `name`, `seconds`, `release`, `stage`, `items`, `goals`) | 413 `too_large` |
| items in a scene | 200 (`clean()`'s `MAX_ITEMS`, as everywhere else) | 400 `bad_input` |
| name | 1–60 characters: letters, digits, spaces and ordinary punctuation (`_ - ' ’ . , : ; ( ) & ! ? + #`); spaces collapsed, trimmed; empty (or no letter or digit) gives "Scene HHMMSS". The page's rename uses the same rule and says what it left out | (normalised, never refused) |
| picture | 150 KB; WebP, JPEG or PNG by its first bytes (never SVG); the page sends 640x360 | 413 `too_large` / 400 `bad_input` |
| scenes per account | 500 (`SCENES_MAX_PER_USER`), not counting deleted ones | 403 `quota` |
| bytes per account (scenes plus pictures) | 10 MB (`SCENES_MAX_BYTES_PER_USER`), **counting deleted scenes still in the 30-day bin**. When a save needs room, the bin empties itself, oldest first, so deleting always frees room and create-delete loops never grow the database | 403 `quota` |
| bytes on the whole site (every account, the bins included) | 700 MB (`SCENES_SITE_MAX_BYTES`) of Neon's free 1 GB, where Neon blocks every write. Past it, every save that grows is refused (expired bin rows are removed first) | 403 `storage_full` |
| scene writes per account | 120 an hour (POST, PUT, DELETE, restore) | 429 `rate_limited` with `Retry-After` |
| scenes copied in from the browser (`copy: true` on POST) | 600 a day (`SCENES_COPIES_PER_DAY`), a count of their own: copying a library never uses up the hour's writes the autosave needs | 429 `rate_limited` (`copy: true`) |
| list answer | the whole list in one answer (at most 500 entries, about 120 KB) | (no paging) |
| deleted scenes | kept 30 days (or until their room is needed), then removed the next time that account deletes or saves | (no cron job needed) |

## 4. API

### 4.1 Common rules

- **JSON in, JSON out.** Answers have the AI endpoint's shape: `{ok: true, ...}` or `{ok: false, error (plain words), code, retryable}`.
  Every JSON answer carries `Cache-Control: no-store`. There are no CORS headers at all.
- **Who.** Every route except `GET /api/scenes/me` needs a valid token (1.4); without one, 401 `sign_in`. The account must exist and not be
  disabled (`disabled` gives 403 `forbidden`).
- **Writes** (POST, PUT, DELETE):
  - On Vercel, they need an `Origin` from the allowed list and a `Sec-Fetch-Site` of `same-origin` when one is sent. Otherwise 403
    `forbidden`. This is the same code as the AI function.
  - POST and PUT need `Content-Type: application/json`, otherwise 415.
- **Ids.** Checked against `^s_[a-z2-7]{16}$` before any query; anything else is 404. Every query includes `owner_id = $account`. Another
  person's scene, a deleted one (except for restore), or a made-up id all answer **404 `not_found`**, never 403, so ids leak nothing.
- **Scene meta** (in lists and answers):
  `{id, name, items, bytes, version, createdAt, updatedAt, thumb: "/api/scenes/<id>/thumb?v=<etag>" | null, savedAs: string | null}`.

### 4.2 Routes

| Method and path | Body | Answer |
| --- | --- | --- |
| `GET /api/scenes/me` | — | Without a token: `{ok, accounts: {provider: "clerk", publishableKey} \| null, storage: true\|false, ai: {signInRequired}}`. With a token, also `user: {id, name, email}`, `usage: {scenes, bytes, maxScenes, maxBytes}` and `aiToday: {steps, usd, maxUsd, resetsAt}`. The first call with a token creates the account (3.1) |
| `GET /api/scenes` | — | `{ok, scenes: [meta, ...]}`, newest first, deleted ones left out |
| `POST /api/scenes` | `{name, scene, thumb?, savedAs?, copy?}`. `thumb` is a data URL `data:image/(webp\|jpeg\|png);base64,...`; `savedAs` a scenario id (`[\p{L}\p{N}_'-]`, at most 80); `copy: true` for "copy this browser's scenes" (3.2) | **201** `{ok, scene: meta}` and `Location`. The server runs `clean(scene)` (400 with its message for a scene the builder can't use), sets `scene.id` and `scene.name`, and stores it |
| `GET /api/scenes/:id` | — | `{ok, scene: meta, data: <the scene JSON>}` with `ETag: "v<version>"` |
| `PUT /api/scenes/:id` | any of `{name, scene, thumb, savedAs}` (`thumb: null` removes the picture; `savedAs` alone, like a picture alone, is not an edit). Optional `If-Match: "v<version>"` | `{ok, scene: meta}`. A name or scene change adds 1 to `version` and sets `updated_at`. A picture alone changes neither. A stale `If-Match` gives **412** `{code: "conflict", current: meta}` |
| `DELETE /api/scenes/:id` | — | `{ok, deleted: id, restoreUntil}` (sets `deleted_at`) |
| `POST /api/scenes/:id/restore` | — (no body needed) | `{ok, scene: meta}`, within 30 days of the delete |
| `GET /api/scenes/:id/thumb?v=<etag>` | — | The picture's bytes with its type, `Cache-Control: private, max-age=31536000, immutable`, `Content-Security-Policy: default-src 'none'`, `Cross-Origin-Resource-Policy: same-origin`. 404 when the scene has none |
| `DELETE /api/scenes/me` | `{confirm: "delete my account"}` | Removes the account, its identities, scenes and counters, and deletes the Clerk user through the Backend API. Then `{ok}`, and the page signs out |

Duplicate and export are done in the page: it reads the scene, then POSTs a copy or downloads the JSON.

### 4.3 Errors

| Status | `code` | When |
| --- | --- | --- |
| 400 | `bad_input` | a body that is not an object, an unknown field, a scene `clean()` refuses (its message), a bad picture |
| 401 | `sign_in` | no token, or a bad or expired one (`expired: true` tells the page to refresh the token once and retry) |
| 403 | `forbidden` | an origin that is not this app's, or a disabled account |
| 403 | `quota` | 500 scenes or 10 MB reached (the message says which, and that deleting frees room) |
| 403 | `storage_full` | the whole site's scenes reached `SCENES_SITE_MAX_BYTES` ("Saving to accounts is paused…"); the page says it once and tries again on the next change |
| 404 | `not_found` | no such scene in this account |
| 405 | `bad_input` | a method the route doesn't take (`Allow` is set) |
| 412 | `conflict` | `If-Match` is stale (`current` is the scene's meta as it is now) |
| 413 | `too_large` | over a size limit in 3.2 |
| 415 | `bad_input` | not `application/json` |
| 429 | `rate_limited` | over 120 writes an hour, or 600 copied-in scenes a day (`copy: true`) (`Retry-After`, `retryable: true`) |
| 503 | `not_configured` | `DATABASE_URL` or the Clerk keys are not set on this deployment |
| 503 | `unavailable` | Neon or Clerk could not be reached (`retryable: true`; the message never names a host or a connection string) |

## 5. Security

- **Authentication.** RS256 only, with `kid`, `iss`, `exp`/`nbf`, `azp` and `sts` checked (1.4). Tokens are short-lived and sent in a
  header. They are never written to our logs, our database or our URLs.
- **Authorization.** The server makes every id, and every query is scoped by `owner_id`. Misses answer 404. There is no route that reads
  another person's data, and there is no admin API.
- **CSRF.** The scenes and AI routes trust only the `Authorization` header, which a browser never attaches by itself to a cross-site request.
  A cross-site page that tries gets a CORS preflight, which these functions never grant. Writes also need our `Origin` and
  `Sec-Fetch-Site: same-origin` (defense in depth), and `azp` binds each token to our origins. The AI function's existing cookie, `ai_session`,
  is `SameSite=Strict` and `Path=/api/ai`, and its route keeps the `Origin` check.
- **Input validation.**
  - Sizes are checked before parsing.
  - Bodies may only have known keys.
  - Scenes go through `web/sim/clean.js`: the same rules, clamps and messages as the local server and the in-page save.
  - Names are normalised, and the page always shows them as text (never `innerHTML`).
  - Pictures are accepted only by their first bytes (`RIFF....WEBP`, `FF D8 FF`, `89 50 4E 47`), served with `nosniff` and a CSP of
    `default-src 'none'`, and never as SVG.
  - All SQL is parameterized (the driver's tagged template).
- **Secrets.** `CLERK_SECRET_KEY` and `DATABASE_URL` exist only in the functions' environment. They are never in an answer, a log line, the
  page, or `dist/` (the build scans for their values, 2.2). The publishable key is public by design. Neon and Clerk errors are replaced by
  plain messages before they are answered or logged. The TrueFoundry key stays as it is (`ai/DESIGN.md`).
- **Abuse.**
  - Writes: 120 an hour.
  - Storage: 500 scenes and 10 MB per account (the bin included), 256 KB per scene, unknown top-level keys dropped, and 700 MB for the whole
    site, so no one account, and no loop of saves and deletes, can fill Neon's 1 GB (which would block every write, the AI's counters too).
  - AI: hourly and daily steps, daily dollars per person, and a site-wide daily dollar cap (section 6).
  - Sign-up: at most 100 users in the development instance.
  - Whole-site floods are still the Vercel Firewall's job (docs/DEPLOY.md).
- **Privacy.**
  - We keep a name, an email, and the scenes. No Google tokens: Clerk keeps the Google link.
  - Account deletion removes everything we keep, immediately, and deletes the Clerk user.
  - Logs carry route, status, milliseconds and the first 6 characters of the account id. Never emails, tokens or scene contents.
- **Third-party code.** None. The page runs only its own and vendored code. Its only other-origin traffic is Clerk's Frontend API and
  Google's sign-in page (1.3).

## 6. The AI gate (`api/_lib/ai-gate.mjs`, called by `api/ai/[step].mjs`)

Order, for each `POST /api/ai/<step>`, after the existing method, step and origin checks:

1. **Who.**
   - A robot key in `x-agent-key` (the video pipeline's agent, added 2026-10-19): `agent:<name>`, with that key's own caps and outside the
     site-wide cap; no Origin or sign-in needed; a wrong or revoked key 403 `forbidden` (docs/DEPLOY.md "Robot keys and the video gallery").
   - A valid Clerk token: that account.
   - Otherwise, the existing `accessProblem()` rules: an `ai_session` invite cookie (counted as `inv_<its nonce>`), or the preview token
     (counted as `tok`).
   - Otherwise:
     - if sign-in is required (`AI_REQUIRE_SIGN_IN`, which is on whenever both Clerk keys **and** `DATABASE_URL` are set: Clerk without the
       database leaves the function's own access check in place, since nobody could be counted), **401**
       `{code: "sign_in", error: "Sign in with Google to use Build with AI", retryable: false}`;
     - if not, the existing 401 or 503 messages.
2. **Allowed.** When `AI_ALLOWED_EMAILS` is set (comma-separated addresses and `@domain` entries), an account whose verified email does not
   match gets **403** `{code: "not_allowed", error: "Build with AI is invite-only for now"}`.
3. **Limits.** Every check is atomic in Neon, in one statement of three guarded upserts (the site's dollars, then this caller's day, then
   this caller's hour), each only if the one before it went through:

   ```sql
   insert into counters (key, bucket, n, usd) values ($1, $2, 1, $est)
   on conflict (key, bucket) do update set n = counters.n + 1, usd = counters.usd + excluded.usd
     where counters.usd + excluded.usd <= $cap and counters.n < $steps
   returning 1
   ```

   A missing row in the answer means that limit is reached (what the guards before it added is given back). **The dollars are reserved,
   not just compared:** each step adds its estimate (`STEP_USD`: plan $0.35, observe $0.20, refine $0.15, edit $0.10, about each step's
   99th-percentile cost in `ai/bench/results`) in the same statement that checks the cap, so steps running side by side line up on the row
   lock instead of all passing a cap they break together (12 parallel plans at a $3 cap: 8 run, the rest get `quota`). The checks:
   - this caller's steps this hour (`AI_USER_STEPS_PER_HOUR`, default 40);
   - this caller's steps today (`AI_USER_STEPS_PER_DAY`, 200);
   - this caller's dollars today (`ai_usd_per_day`, else `AI_USER_USD_PER_DAY`, 3.00);
   - the whole site's dollars today (`AI_SITE_USD_PER_DAY`, 30.00).

   When over, the answer is **403**, not 429:
   - `{code: "quota", error: "You've used today's Build with AI allowance. It resets at 00:00 UTC.", resetsAt, retryable: false}`
   - `{code: "site_quota", ...}` for the site-wide cap.

   **Not 429**, because the AI client (`web/ai/orchestrator.js`, `call()`) treats every 429 as "the AI slots are busy" and waits and retries.
   A quota is not busy.
4. **Database missing.** Without `DATABASE_URL` accounts are off for the AI gate too: a token is ignored and the function's own access
   check (invite cookie, preview token) decides, as before accounts. This fails closed, like the rest of the AI endpoint.
5. **After the step** (`gate.run()`, success or failure): the reservation becomes the step's real `usage.costInUSD` (from the answer or the
   error) for this caller's day and the site's; with no cost known it is given back. A cap can be passed only by what steps already running
   cost beyond their estimates (a few cents each in practice), never by a burst of parallel steps.

The page **does not wait for a 401** to explain this (**as built**, `web/account/ai-signin.js`). When `/api/scenes/me` says
`ai: {signInRequired: true}` and nobody is signed in, it catches, in the capture phase before the app sees them: **Edit with AI** (the `#ai`
button and the `A` key) and New → Build with AI's **Build new scene** button (and Enter in its box). Instead of the AI panel it shows a small
sheet: "Edit with AI needs an account" / "Build with AI needs an account", **Continue with Google**, "You'll come right back. The scene on the
table is kept.", and Not now. What the person was doing is kept in `sessionStorage` across Google's round trip; back, signed in, the AI opens
where they left off (the drawer, or New with their words in the box: nothing is built until they press Build). If Clerk can't be reached the
sheet says the AI is unavailable right now. **Backstop** for any other way in: a POST to this origin's `/api/ai/*` answered 401
`{code: "sign_in"}` dispatches `sandbox:sign-in-needed` (a `fetch` wrapper outside clerk.js's, so its one retry with a fresh token has
already happened), and the same sheet opens ("Sign in again" when someone is signed in but the token is no longer good).

## 7. The page (`web/account/`)

### 7.1 Start and sign-in

1. **Config.** `account.js` (a module after `app.js`) installs `window.sandboxAccount` at once, with a ready promise. It then asks
   `GET /api/scenes/me`. A 404, 503 or network error means **local mode**, with no sign-in button. That is the case on the local server, in
   the static preview, and on a deploy without accounts.
2. **Clerk.** With `accounts` in the answer: `const { Clerk } = await import("clerk-js")`, then `new Clerk(publishableKey)`, then
   `await clerk.load({ telemetry: false })`. The load is capped at 6 s; on timeout, local mode with a "Sign-in unavailable" tooltip.
3. **Return from Google.** When the URL has `?auth=callback`:
   - call `await clerk.handleRedirectCallback({ signInFallbackRedirectUrl: back, signUpFallbackRedirectUrl: back }, navigate)`, where
     `navigate` is a `history.replaceState` back to the address saved in `sessionStorage` before leaving (so `?profile=` and other
     parameters survive);
   - an error shows "Couldn't finish signing in", with **Try again** and **Use Clerk's sign-in page** (`clerk.redirectToSignIn()`, Clerk's
     hosted page, which handles any extra step).
4. **Sign in.**
   - The button opens a small sheet: the app's logo, "Keep your scenes in your account and use Build with AI", and a **Continue with
     Google** button (Google's white button with the G mark, following Google's branding rules).
   - It warns: "You'll come right back; the scene on the table is kept". The app autosaves the table to localStorage, so a redirect loses
     nothing.
   - The button calls `clerk.client.signIn.authenticateWithRedirect({ strategy: "oauth_google", redirectUrl: origin + "/?auth=callback",
     redirectUrlComplete: back })`. clerk-js turns a first-time Google sign-in into a sign-up by itself.
   - Clerk marks this the legacy SignIn API in Core 3; it is still documented, and so is `handleRedirectCallback`. The newer `signIn.sso()`
     documents only a React callback, so it is not used. The build step checks both calls against the vendored 6.39.0.
5. **Signed in.**
   - `clerk.addListener` updates the top bar.
   - `GET /api/scenes/me` (with the token) gets the account and usage.
   - `sandboxApp.reloadScenarios()` puts the account's scenes in the menu.
   - A first-ever sign-in shows a toast: "Welcome, Ram. Your scenes now follow you."
6. **Sign out.** `await clerk.signOut()`; back to local mode; the menu reloads. The scene on the table stays.

### 7.2 Top bar and menu

The button goes at the end of `.top-right`: **Sign in**, or a 32 px circle with the person's initials. Initials are used, not the Google
photo, so the page loads no images from other origins. The menu has:

- the name and email;
- **My scenes** (also the `L` key, when not typing);
- AI today ("4 builds left today", from `aiToday`);
- **Sign out**;
- **Delete account…** (a confirm dialog that asks the person to type DELETE; it calls `DELETE /api/scenes/me`, then signs out. **As built**
  (14); "AI today" is not in the menu yet).

On a phone the circle stays visible, and the menu becomes a bottom sheet. Everything has labels, keyboard focus and Escape, like the app's
other menus (`web/ui/ui.js`).

### 7.3 "My scenes"

The dialog is centred, 880 px wide on desktop and full-screen on a phone. It contains:

- **Header**: "My scenes", where they are kept ("In your account" / "In this browser"), a search box (filters by name in the page), sorting
  (Recent / Name), and a close button.
- **Grid**: 16:9 cards with the picture (or a calm placeholder with the scene's initial), the name, "Edited 2 h ago", and the item count.
  Clicking a card opens it. A "⋯" menu has **Rename**, **Duplicate**, **Export .json** and **Delete**.
- **Delete**: instant, with a toast "Deleted · Undo" (restore). Rename and delete update the card at once, and go back with an error toast if
  the server refuses.
- **Loading**: skeleton cards (Neon may take about a second to wake after 5 idle minutes).
- **Empty**: "No saved scenes yet. Press Save to keep the scene on the table."
- **Signed out on a deploy with accounts**: a quiet banner, "Sign in to keep your scenes in your account and open them on any device."
- **Pictures**: fetched with the token (`fetch` and an object URL; an `<img>` cannot send the header) only for cards in view
  (IntersectionObserver). They are cached by `?v=<etag>` (the browser's HTTP cache, `private, immutable`), and the object URLs are released
  when the dialog closes.
- **Opening**: `window.sandboxApp.open(id)`, which is the app's own `loadScenario`, with its undo, menu and autosave.

### 7.4 Save and the menu run through the app's own code

`window.sandboxAccount.wants(path, body)` is true for:

- `GET /api/scenarios` and `GET /api/scenarios/s_…` when signed in;
- `POST /api/scenarios` always (so a save in local mode also gets its picture);
- `POST /api/ai/*` when signed in (to add the token).

Its `api(path, body, signal, direct)`:

- **List** (signed in): the built-in scenarios from `/scenario-list.json` (the same file the in-page backend reads), plus the account's
  scenes as `{id, name, builtin: false, items}`. The menu marks them "(mine)" as today.
- **Open `s_…`**: `GET /api/scenes/:id` gives `data`.
- **Save** (signed in):
  1. If the account has a scene with the same name (ignoring case), it is a PUT to that one, with `If-Match` of the version last seen. The app
     has already asked "Replace it?". Otherwise it is a POST.
  2. The picture (7.5) goes in the same request.
  3. The answer is `{id, name, saved: "Saved to your account"}`.
  4. A 412 asks "This scene was changed on another device since you opened it. Replace that version?"; **Cancel** saves nothing.
  5. A network error or a 5xx falls back to `direct()` (this browser), with `saved: "Saved in this browser (your account couldn't be
     reached)"`. The copy-to-account offer (7.7) picks it up later.
- **Save** (signed out): `direct()` as today, then the picture is stored locally (7.6).
- **AI**: `direct(path, body, signal, { Authorization: "Bearer " + token })`.

### 7.5 The picture

`thumb.js` takes it after each save, through the view's export interface (`window.sandbox.view`, described at the top of
`web/export/export-ui.js`):

1. `await view.whenSettled()` (capped at 1.5 s);
2. `renderFrame(0, {width: 640, height: 360, camera: "wide"})`: the scene's starting pose, the whole machine in one shot;
3. draw it on a 640x360 `OffscreenCanvas` and `convertToBlob({type: "image/webp", quality: 0.8})`. If the browser can't encode WebP, the
   blob comes back as another type, so encode JPEG at 0.85 instead;
4. `view.endExport()` in `finally`.

It takes no picture while a video export runs, during a drag, or when the view has no `renderFrame` (no WebGL). The card then shows the
placeholder. When a scene without a picture is opened and has run once, the page sends its picture with `PUT {thumb}`, which changes neither
`version` nor "Edited". This fills in pictures for scenes copied from the browser.

### 7.6 Local mode (no sign-in)

`local.js` has the same interface as `cloud.js`: `list()`, `get(id)`, `save({id?, name, scene, thumb})`, `rename(id, name)`, `remove(id)`,
`restore(id)`, `thumbURL(meta)` and `usage()`. That way the library dialog is one piece of code.

- **Scenes**: they stay exactly where the in-page backend keeps them, in localStorage `sandbox:saved` (`sandbox@<profile>:saved` with
  `?profile=`), in its documented format (`web/CONTRACT.md`). The menu and **Save** keep working with no change. Rename rewrites the entry
  under its new name-based id. Delete removes it, and Undo puts it back from memory within 10 s.
- **Pictures and dates**: IndexedDB database `sandbox-library`, store `thumbs`, keyed `<profile or "-">/<id>`, holding
  `{blob, type, etag, createdAt, updatedAt}`. Without IndexedDB (some private windows), cards show placeholders. Every access is wrapped in
  try/catch.
- **On the local server** (`localhost:8790`) the list comes from `api("/api/scenarios")` (the scenes saved in `web/saved/`) and opening uses
  `loadScenario`. Rename and delete are hidden, because `web/server.py` has no routes for them and is not changed.

### 7.7 First sign-in: copy this browser's scenes in

If this browser has saved scenes and this account has not been offered them yet, the library shows a banner: "3 scenes are saved in this
browser. **Copy to my account**". The banner is remembered per account, in localStorage under the app's key scheme. Copying POSTs each
scene with its local picture and shows progress. Local copies are never deleted automatically.

### 7.8 When things fail

| What fails | What the person sees |
| --- | --- |
| Clerk unreachable or blocked by an extension | the sandbox works; the sign-in button is greyed out with "Sign-in unavailable right now" |
| Neon asleep | skeleton cards for about a second |
| Neon down | "Your scenes can't be reached right now. Try again." and Save falls back to this browser (7.4) |
| token expired mid-session | one silent refresh and retry, then the sign-in sheet |
| quota reached | the server's sentence ("You've reached 500 saved scenes. Delete some to save more.") |
| AI allowance used up | the panel shows the server's sentence, with the reset time |

### 7.9 As built: My scenes and autosave (2026-10-15; these lines replace 7.2–7.7 where they differ)

- **Every scene is kept as it is made** (`web/account/autosave.js`), not only the ones Saved. A scene ("project") starts with New → Blank,
  New → Build with AI, an example or a menu scenario, an imported file, or opening one from My scenes; every later change (by hand, Edit
  with AI, undo, redo, Save) is written to it about a second later, and its picture (`thumb.js`: `view.renderFrame(0, 640×360, "wide")`,
  WebP, about 20 ms, the canvas never stalls) once its run has landed and nobody is touching the page. An example only opened and run, or a
  bare table, is never written. Undo past the start of a scene goes back to the project before it (each undo step records its project).
- **Where, signed out:** IndexedDB `sandbox-scenes` (`sandbox-scenes@<profile>` with `?profile=`) in `local-idb.js`: scenes, dates and
  pictures, deleted ones restorable for 30 days, other tabs told by BroadcastChannel; the same on the local server (`localhost:8790`).
  Scenes saved with Save before this existed (the local server's `web/saved/`, or the in-page engine's `sandbox:saved`) are copied in
  once and linked, so picking one from the scenario menu continues it. Save itself still writes where it always did; it also names the
  project. **Signed in:** the account (`cloud.js`, section 4): a scene at most every 45 s and its picture every 3 minutes (inside the 120
  writes an hour), and at once when the library opens or the page goes (`keepalive`).
- **One interface** (`store.js`): `list, get, create, update, remove, restore, thumb, usage, onChange`, the backend chosen by `auth.js`.
- **The page:** a **My scenes** button after New (key **O**; a dot on it says saving / saved), the library dialog (`library.js`: search,
  sort, open, rename, duplicate, download, delete with Undo, keyboard and screen-reader ready, a sheet on phones), the New dialog's row of
  recent scenes, and the account chip (Sign in with Google; signed in, the initials and a menu). Signing in offers "Copy N scenes to my
  account" once; the scene on the table goes on in the account as one scene.
- **Hooks in shared files:** `web/app.js` (`lib("changed" | "fresh")` in autosave, loadScenario, importScene, New → Blank, a new AI scene;
  `window.sandboxApp.open/rename`; New's "save first" note skipped for a kept scene), `web/ai/new-project.js` (the recent row), `web/index.html`
  (the stylesheet and `account/account.js`), `tools/build-static.mjs` (`account` in SHIP_DIRS, `account/dev-mock.js` in DEV_ONLY).
- **Trying the signed-in screens without accounts:** `?accountmock=1` (or `=signedin`): a pretend Google sign-in and a pretend `/api/scenes`
  in the page (`dev-mock.js`, never shipped). **Tests:** `node web/account/test/library.e2e.mjs` (the real app, headless Chromium).

## 8. Configuration (environment variables)

| Name | Set by | Used for |
| --- | --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | the Clerk integration (each environment gets its own instance's key) | `/api/scenes/me` gives it to the page. The server derives the Frontend API host, the JWKS URL and the expected `iss` from it. Also read as `CLERK_PUBLISHABLE_KEY` if that is set instead |
| `CLERK_SECRET_KEY` | the Clerk integration | server only: the Backend API (new person's email and name; deleting a user) |
| `CLERK_JWT_KEY` | optional, the owner | the instance's PEM public key, for verifying tokens without fetching the JWKS |
| `DATABASE_URL` | the Neon integration | everything in section 3 (the pooled connection string; the HTTP driver needs nothing else). `POSTGRES_URL` is read when `DATABASE_URL` is not set |
| `ACCOUNTS` | optional | `off` hides sign-in and the library on that deployment (an emergency switch; needs a redeploy, like any variable) |
| `AI_REQUIRE_SIGN_IN` | optional | defaults to on when both Clerk keys and `DATABASE_URL` are set; `0` turns it off |
| `AI_USER_STEPS_PER_HOUR`, `AI_USER_STEPS_PER_DAY` | optional | 40, 200 |
| `AI_USER_USD_PER_DAY`, `AI_SITE_USD_PER_DAY` | optional | 3.00, 30.00 |
| `AI_ALLOWED_EMAILS` | optional | invite-only AI: `you@example.com,@yourschool.edu` |
| `SCENES_MAX_PER_USER`, `SCENES_MAX_BYTES_PER_USER`, `SCENES_WRITES_PER_HOUR` | optional | 500, 10485760 (10 MB, the bin included), 120 |
| `SCENES_COPIES_PER_DAY`, `SCENES_SITE_MAX_BYTES` | optional | 600 (scenes copied in from the browser), 734003200 (700 MB of Neon's free 1 GB; raise it with a paid Neon plan) |
| `ALLOWED_ORIGINS` | as in docs/DEPLOY.md | also the accepted `azp` values (aliases and custom domains) |

The existing AI variables (`TRUEFOUNDRY_*`, `AI_SESSION_SECRET`, `AI_INVITE_CODES`, `AI_ACCESS_TOKEN`) are unchanged. Vercel applies any
variable change only to deployments made after it.

## 9. Your one-time steps

The code is in place (section 13): these steps switch it on. Each step is something only you can do: it creates provider accounts and
accepts their terms. All of it happens in the Vercel dashboard for team **ram-sarmas-projects**, on the project **physics-sandbox** (linked
on 2026-10-15, docs/DEPLOY.md step 1). Total: about 10 minutes. Nothing needs a code change, a key pasted anywhere, or SQL.

### 9.1 Clerk (about 4 minutes)

1. vercel.com → team **ram-sarmas-projects** → **Integrations** → **Browse Marketplace** → **Clerk** → **Install**. Choose
   **Create New Clerk Account**, plan **Free / Hobby**, application name **Physics Sandbox**, then **Create**. You accept Clerk's terms here.
2. On the integration's page: **Connect Project** → **physics-sandbox**. Keep all three environments (Development, Preview, Production) →
   **Connect**. This adds `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`. Previews get the development instance's keys.
3. **Open in Clerk**. With the **Development** instance selected (the default):
   - **SSO connections** (under User & authentication / Configure): make sure **Google** is there and enabled for sign-up and sign-in.
     Leave "Use custom credentials" **off**: development uses Clerk's shared Google credentials, so there is nothing to do in Google Cloud.
   - Make sure nothing besides an email address is **required** at sign-up: no username, no phone number, no legal-consent checkbox. A
     Google sign-up then finishes in one step. You may turn password sign-in off; the app only offers Google.
4. **Protect → Protections → Challenge suspicious sign-ups → Manage → Enable off → Save.** The reason is in 1.3: a VPN user's first
   sign-up must not stall during a demo.

### 9.2 Neon (about 3 minutes)

1. The project → **Storage** → **Create Database** → **Neon** → **Continue**. Plan **Free**; region **Washington, D.C., USA (iad1)**
   (AWS us-east-1, next to the functions); database name `sandbox` → **Create**. You accept Neon's terms here.
2. **Connect Project** → **physics-sandbox**. Environments: Development, Preview, Production. Leave **preview branching / "create a database
   branch for each deployment" off**: this project deploys from the CLI, not Git, so there are no branches to copy. The default variable
   prefix (`DATABASE_URL`) is right → **Connect**.

There is no SQL to run: the scenes function creates its tables the first time it is called.

### 9.3 Optional: your own AI limits

The defaults are in section 8. To change one, for example the daily allowance for everyone on previews:

```sh
printf 2 | vercel env add AI_USER_USD_PER_DAY preview --yes
```

For invite-only AI during the demo, add `AI_ALLOWED_EMAILS` the same way.

### 9.4 Deploy and check (about 3 minutes)

```sh
vercel env ls preview          # NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY and DATABASE_URL are listed (names only, never values)
npm run build:static:nogen && npm run check:vercel && npm run test:accounts && vercel deploy --target preview
```

A variable reaches only deployments made after it was added, so this must be a new deploy (and always `--target preview`: docs/DEPLOY.md
explains why). Then open the new deployment through its share link, as in docs/DEPLOY.md, and check:

0. `https://<deployment>/api/scenes/me` (in the same browser) answers `{"ok":true,"accounts":{"provider":"clerk",...},"storage":true,...}`.
   Accounts switch on only when **both** Clerk and the database are there, so `accounts: null` means one of them is missing:
   - **`storage: false`: stop here and finish 9.2 (Neon) first**, then deploy again. Until then the page stays as it was (no Sign in, scenes
     in the browser, the AI behind its old invite check), so nothing is half-working in front of anyone;
   - `storage: true` with `accounts: null`: the Clerk variables did not reach this deployment (9.1 step 2, then deploy again).
1. **Sign in** → Google's account chooser → pick your Google account → you are back on the sandbox with your initials in the top bar.
   (A greyed-out Sign in with "unavailable" means Clerk could not be reached, or Google is not switched on: 9.1 step 3.)
2. Save or make a scene → **My scenes** shows it under "In your account", with its picture.
3. Open the same link in a private window (or on your phone), sign in → the same scene is in **My scenes** → open it.
4. Sign out → **Edit with AI** (or New → Build with AI → Build) shows "… needs an account" with Continue with Google (the AI function refuses
   anyone signed out). Continue → back signed in, the AI opens where you were → a build runs (each step is counted against your allowance:
   the `counters` table in the Neon console shows it).
5. DevTools → Network: no requests to other origins except `*.clerk.accounts.dev` (and Google during sign-in).

If step 1 says "Couldn't finish signing in", check the Clerk dashboard's **Logs** for an `oauth_callback.failed` event, and that 9.1 step 3
left nothing required.

### 9.5 Later: production on your own domain (when the demo becomes a product)

1. Add your domain to the Vercel project (Settings → Domains).
2. In Clerk, switch to the **Production** instance → **Domains**: enter the domain, then add the DNS records Clerk lists (CNAMEs for
   `clerk.`, `accounts.`, and the email ones). On Vercel DNS, add them under the domain's DNS settings. Wait for Clerk to show them verified.
3. In Google Cloud Console:
   - create a project;
   - set up the **OAuth consent screen** as External, with the app name, logo and support email, and set its publishing status to **In
     production**. Google verifies the name and logo; while it is in "Testing", only 100 listed test users can sign in;
   - **Credentials → Create Credentials → OAuth client ID → Web application**: Authorized JavaScript origins `https://<your domain>`;
     Authorized redirect URI = the one Clerk shows under Production → SSO connections → Google → **Use custom credentials**.
4. Paste the Client ID and Client Secret into Clerk → **Save**. Repeat 9.1 step 3 (required fields) and step 4 (your choice for
   production) on the Production instance.
5. Set `ALLOWED_ORIGINS=https://<your domain>` for Production. Then deploy to production, following docs/DEPLOY.md "Not production" and its
   protection guidance. The production keys are already in the Production environment from 9.1.
6. People who used the demo keep their scenes: their first production sign-in links to their existing account by their verified Google
   email (3.1).

## 10. What the build step must prove (before calling it done)

(For the server and the sign-in: done, see 13.3. The page's library and chip have their own checks.)

- **Unit and integration** (`npm run test:accounts`, node `--test`, no network, no keys):
  - the token verifier against a test RSA key and JWKS (valid; `alg` none and HS256; bad signature; expired; `nbf` in the future; wrong
    `iss`; foreign `azp`; unknown `kid` refetched once; `sts` pending);
  - the scenes function against a real Postgres in-process (`@electric-sql/pglite`, a pinned devDependency; `db.mjs` takes any
    `query(text, params)`):
    - create, list, get, update, If-Match 412, delete, restore;
    - person B gets 404 for person A's id;
    - every limit in 3.2;
    - a picture that is really SVG or HTML is refused;
    - name normalisation, `clean()` messages, Origin and Content-Type refusals;
    - no secret value in any answer;
  - the AI gate: limits at the edge, the 403 codes, usage recorded on success and failure, the invite cookie and preview token still
    working.
- **Headless browser** (own Playwright Chromium, `headless: true`), on `npm run preview:static` (no accounts) and with `?accountmock=1`:
  - local Save → card with picture → rename, delete, Undo → survives a reload;
  - mock sign-in → the menu lists account scenes → Save says "Saved to your account" → the picture is uploaded;
  - signed out, the AI button shows the sign-in sheet (**built and checked in round 3**, section 14);
  - 375 px wide: no horizontal scroll, and the dialog is a full-screen sheet;
  - no console errors;
  - no request to another origin except the mock's.
- **`npm run check:vercel`**: the two functions, the rewrites, `/api/scenes/me` unconfigured giving `{accounts: null, storage: false}`,
  the vendored clerk-js byte-identical to `vendor:clerk`'s output, and no secret value shipped.
- **The local server is untouched**: `localhost:8790` behaves exactly as before; the library there shows server saves and no sign-in.

## 11. Costs (free on all three at demo scale)

- **Clerk Hobby**: $0. 50,000 monthly retained users per app; the development instance holds at most 100 users.
- **Neon Free**: $0.
  - 1 GB storage per project (about 15,000 scenes with pictures). Past it Neon blocks every write, so the site stops itself at 700 MB
    (`SCENES_SITE_MAX_BYTES`, 3.2);
  - 100 CU-hours a month: compute runs only while queried, plus a 5-minute tail;
  - 5 GB egress a month: list answers are about 100 KB, pictures about 30 KB and cached in the browser.
  - Over a limit, writes or compute pause until the next month. Nothing is billed.
- **Vercel Hobby**: the scenes function adds a few invocations per save, open and library view, well inside 1,000,000 invocations a month.
  docs/DEPLOY.md's note on Hobby's non-commercial terms still applies.
- **The AI** is the real cost, and section 6 caps it: by default $3 per person and $30 for the whole site per day.

## 12. Risks and open points

- **Core 3's vanilla redirect API.** `authenticateWithRedirect` and `handleRedirectCallback` are documented, but Clerk marks the
  `authenticateWithRedirect` API "legacy" and recommends `signIn.sso()`, whose redirect return is documented only for React. **Checked
  (13.3):** the vendored 6.39.0 runs a whole Google sign-in with both calls in a headless browser against an emulated Frontend API (the
  request carries `strategy=oauth_google` and our two addresses; the return signs the person in and puts the address back; a first-time
  Google account is transferred to a sign-up and signed in). What only the
  first real sign-in can prove is that Clerk's real Frontend API answers as the emulation does. If a later version drops the calls, the
  fallback is Clerk's hosted sign-in page (`redirectToSignIn()`), which needs no change on the server.
- **No-remotely-hosted-code build.** **Checked:** the vendored bundle names no Turnstile (`challenges.cloudflare.com`), Stripe or Clerk UI
  URL (`tools/vendor-clerk.mjs` fails if it ever does), and its only network use is the Frontend API named by the key. If Google sign-in
  ever needed something remote, switch the entry to `dist/clerk.mjs` (one constant in `tools/vendor-clerk.mjs`).
- **Development instance cap.** If more than about 90 people will sign in before production, do 9.5 first.
- **Shared database.** Previews and production share one Neon database, because there is no branching. That is intended (one product,
  one set of accounts), but a destructive test must not be run against a preview.
- **Neon wake-up.** After 5 idle minutes the first query wakes the database. The library shows skeleton cards, and the AI gate adds the
  same delay once. A paid Neon plan can keep it awake.
- **Where scenes and pictures are deleted.** An account deletion is final. A scene deletion can be undone for 30 days. Point-in-time restore
  is Neon's; the person's own backup is **Export .json**.
- **Not in this version** (straightforward on this design later):
  - share links (a `public` flag and a read-only page);
  - saved MP4 videos (Vercel Blob client uploads);
  - a Clerk Frontend API proxy on our own origin;
  - an admin view.

## 13. As built: the server and the sign-in (2026-10-15)

### 13.1 Files

| File | What it is |
| --- | --- |
| `api/scenes/index.mjs` | the scenes function (section 4): routing (path or the rewrite's `?id=&part=`), methods, the write Origin check, who is calling, sizes, `clean()`, every route |
| `api/_lib/http.mjs` | answers in the AI endpoint's shape, `Cache-Control: no-store`, JSON bodies with a byte cap, and `scrubSecrets()`: every answer and log line has the environment's secret values, connection strings, bearer tokens and `sk_` keys replaced |
| `api/_lib/origin.mjs` | the app's own origins (the AI function's rules), the writes' Origin / Sec-Fetch-Site check, the accepted `azp` values (off Vercel also `http://localhost:*` and `127.0.0.1`) |
| `api/_lib/auth.mjs` | the publishable key's Frontend API host; Clerk session tokens checked with `node:crypto` only (1.4): RS256, `kid` from the JWKS (an hour's cache; an unknown kid refetches at most once a minute; `CLERK_JWT_KEY` instead when set), `iss`, `exp`/`nbf` with 5 s leeway, `sub`, `azp`, `sts`. A JWKS that can't be fetched is 503, not 401 |
| `api/_lib/db.mjs` | Neon over HTTP (`@neondatabase/serverless` 1.2.0, exact pin, no dependencies of its own), imported on first use only; the schema made by the function itself, once per instance (section 3); every database error becomes a plain 503 |
| `api/_lib/accounts.mjs` | identities to accounts (3.1): a new person's name and verified email from Clerk's Backend API (3 s), linking by verified email across Clerk instances, a race-safe first call, the email filled in later if Clerk didn't answer; deleting the Clerk user |
| `api/_lib/scenes.mjs` | the scene queries (owner-scoped), ids, names, pictures (WebP / JPEG / PNG by their first bytes, 150 KB), the limits of 3.2, the write rate |
| `api/_lib/ai-gate.mjs` | section 6, used by `api/ai/[step].mjs` |
| `web/account/clerk.js` | the sign-in provider the page's `auth.js` loads on a deploy with accounts: the vendored SDK, `telemetry: false`, Clerk's navigations kept in the page, the return from Google (`?auth=callback`) handled first and the address put back (`?profile=` kept), "unavailable" when Clerk can't be reached or Google isn't switched on, and the token on the page's POSTs to `/api/ai/*` |
| `web/vendor/clerk/clerk.mjs`, `LICENSE` | `@clerk/clerk-js` 6.39.0's no-remotely-hosted-code build as one ES module (841 KiB, 333 KiB gzipped; loaded only on a deploy with accounts), its MIT licence |
| `tools/vendor-clerk.mjs` | makes them: `npm pack` of the pinned version, its sha512 integrity checked, the four optional wallet and password-strength modules replaced by a module that says they're left out, a check that no remote-code URL and no bare import is left; `--check` |
| `web/account/test/*` | the tests below (never uploaded: `.vercelignore`; never shipped: the build skips `test/`) |

### 13.2 Edits to shared files

- `api/ai/[step].mjs` (4 places): the import; `aiGate()` in place of `accessProblem()` (which it still calls); `gate.charge()` after the queue
  gives a slot (so a "busy" retry is not counted; a refusal gives the slot back); `gate.run(() => runStep(...))` to record the cost.
- `vercel.json`: the `api/scenes/*.mjs` function (`maxDuration` 30, web/sim in `includeFiles`) and the two rewrites.
- `tools/build-static.mjs`: `vendor:clerk` in `--regen`, `vendor:clerk:check` in the plain build, the shipped-secret scan for
  `CLERK_SECRET_KEY`, `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `POSTGRES_URL`, `POSTGRES_PASSWORD`, `PGPASSWORD` and `AI_SESSION_SECRET` (and any
  `sk_live_`/`sk_test_` key or database URL with a password in shipped text), and `--vercel-check`'s scenes function checks (DEPLOY.md).
- `web/index.html`: the importmap entry `"clerk-js": "./vendor/clerk/clerk.mjs"`.
- `package.json`: `@neondatabase/serverless` 1.2.0, devDependency `@electric-sql/pglite` 0.5.8 (a Postgres in the test process), scripts
  `vendor:clerk`, `vendor:clerk:check`, `test:accounts`, `test:accounts:browser`. `.vercelignore`: `tools/vendor-clerk.mjs` is uploaded.

Differences from the design above: the page reads its configuration from `GET /api/scenes/me` (as 7.1 says; no build-time config file);
clerk-js is vendored from its tarball, not installed (1.3); `web/app.js` is not touched by this part (2.2); a quota refusal of the AI gate
happens after the queue, not before it (so retries while busy cost nothing); `sk_`-shaped keys and database URLs are also refused in shipped
files; a JWKS that can't be fetched answers 503 `unavailable` (not 401), so the page doesn't ask anyone to sign in again for Clerk's outage.

### 13.3 How it was checked (no accounts, no keys, nothing deployed)

| Command | What it proves | Result |
| --- | --- | --- |
| `npm run test:accounts` | the token checks (good, `alg` none and HS256, a bad signature, another key, expired, `nbf`, issuer, a foreign `azp`, `sts` pending, the JWKS refetch rule and a rotated key, `CLERK_JWT_KEY`, the JWKS unreachable); the scenes function on a real Postgres in the process: the first call makes the account, create / list / get / rename / update with If-Match / 412 / picture alone / delete / restore, another person's scene and made-up or malformed ids 404, `clean()`'s messages, unknown fields, 400/405/413/415, foreign Origin and cross-site writes 403, SVG or HTML "pictures" refused, every limit of 3.2 (scenes, bytes, the scene, the body, writes per hour with Retry-After), linking by verified email across two Clerk instances (and not by an unverified one), Clerk's Backend API down, account deletion, no secret in any answer; the AI gate alone (sign-in required, invite cookie and preview token, hourly steps, dollars per person and per site, invite-only emails, fail-closed without a database) and inside the real `api/ai/[step].mjs` with the AI core's mock gateway (401 `sign_in`, a step's cost recorded, 403 `quota` with the model never called and the slot given back, an expired token, the invite cookie) | 32 of 32 |
| `node --test ai/test/vercel.test.mjs` | the AI function's own tests, after the gate went in | 8 of 8 |
| `node web/account/test/clerk-browser.mjs` (headless Chromium) | `clerk.js` against a recording stand-in (the redirect's addresses, `?profile=` kept, the return handled and the address put back, a failed return, Google off, the token on `/api/ai/*` POSTs only, an expired token refreshed once, sign-out without leaving); the **real vendored SDK**: loads with no other-origin code, and a Clerk that can't be reached gives "unavailable" within 6 s; then a **whole Google sign-in with the real SDK** against an emulated Frontend API (`fapi-emulator.mjs`): `POST /v1/client/sign_ins` with `strategy=oauth_google` and our two addresses, the trip to "Google", the return, `handleRedirectCallback`, the session made active, a session token, sign-out ending the session; and a **first-time** Google account, which Clerk turns into a sign-up (`POST /v1/client/sign_ups` with `transfer=true`) and signs in | 21 of 21 |
| `node web/account/test/e2e-accounts.mjs` (headless Chromium) | the real page and the page's account layer against the real scenes function on PGlite, with a stand-in for Clerk whose tokens are real RS256 JWTs: signed out the page offers Sign in; the Google round trip; the chip shows the person; a scene saved to the account is in the database under that person; My scenes lists it; a picture goes up and comes back (a picture alone is not an edit); a second device (375 px wide, no sideways scroll) sees the scene; another person doesn't; sign-out goes back to this browser; no page errors, no other-origin request | 10 of 10 |
| `npm run build:static:nogen` | the site builds with `web/account/` and the vendored SDK, every import resolves (`clerk-js` through the importmap), `vendor:clerk:check` passes | passed (117 files) |
| `npm run check:vercel` | `vercel build` on the exact upload: two functions only, the rewrites, the scenes function's files and the Neon driver in it, `/api/scenes/me` with no keys `{accounts: null, storage: false}`, an unreachable database answering 503 with nothing of its address; the AI function as before (its edit of the starter 200) | passed |
| `vercel dev` on a copy of the upload (the linked project, nothing changed on it) | Vercel's own router: `/api/scenes/me` with a test publishable key, the rewrites reaching the function (`/:id`, `/:id/thumb`, `/:id/restore`, an unknown part 404), 405, a cross-site write 403; a token signed by a test key (`CLERK_JWT_KEY`) accepted, a foreign `azp` and a tampered one 401 | as expected |

Not checkable here: the real Clerk instance and Google (the owner's first sign-in, 9.4), and Neon itself (the queries ran on PGlite, which is
Postgres; the Neon driver's loading and its unreachable-database answer were checked in the built function). `vercel dev` with a real database
would need Neon's HTTP endpoint.

## 14. Repairs after review (round 3, 2026-10-15)

Each problem the review verified, what changed, and what proves it. The defaults moved, so section 13's figures for the limits are replaced
by 3.2 and 8.

| Problem | What changed | Where |
| --- | --- | --- |
| Signed out, Build with AI gave an error card ("Couldn't reach the AI … Sign in with Google…") instead of a way to sign in | The "needs an account" sheet (6): the AI's ways in caught in the capture phase, Continue with Google, the AI reopened where the person left off after Google, and the `sandbox:sign-in-needed` backstop on any 401 `sign_in` from `/api/ai/*`. `auth.js` keeps `ai.signInRequired` | `web/account/ai-signin.js` (new), `auth.js`, `account.js`, `account.css`, `dev-mock.js` (`ai.signInRequired`, `&aisignin=0` turns it off) |
| One account could fill the shared database (deleted scenes not counted, padded scenes accepted, 50 MB × 100 users = 5 GB) | Bytes per account count the 30-day bin and the bin empties itself oldest first when room is needed; a site-wide cap (700 MB, 403 `storage_full`); 10 MB per account and 256 KB per scene by default; top-level keys the app never reads dropped before `clean()` | `api/_lib/scenes.mjs`, `api/scenes/index.mjs`, `api/_lib/db.mjs` (index) |
| Signed in, Save didn't link the scene, so picking the saved scenario again made a second copy | `scenes.saved_as` (schema 2), `savedAs` accepted on POST / PUT and returned in every meta; `cloud.js` sends it; the autosave also finds a Save not yet written (the account spaces one scene's writes 45 s apart) and keeps it when a newer change replaces it | `api/_lib/db.mjs`, `scenes.mjs`, `index.mjs`, `web/account/cloud.js`, `autosave.js` |
| Copying a big browser library into the account ran into the 120 writes an hour, and autosave was then refused for the hour | `copy: true` on POST counts in its own bucket (600 a day), never the hour's writes; a partial copy says how far it got and keeps offering the rest | `scenes.mjs`, `index.mjs`, `cloud.js`, `library.js` |
| Parallel AI steps could all pass a dollar cap (check before, record after) | Each step reserves its estimate in the statement that checks the caps, for the person and the site; the real cost replaces it after; a refused step gives back what it reserved | `api/_lib/ai-gate.mjs` |
| Clerk connected without Neon broke Build with AI for everyone and My scenes after sign-in | Accounts (and AI sign-in) switch on only with Clerk **and** the database; the page also treats `storage: false` as local; 9.4 step 0 says to stop and finish 9.2 | `api/scenes/index.mjs` `accountsOn()`, `ai-gate.mjs` `signInRequired()`, `web/account/auth.js`, 9.4 |
| Two tabs or devices on one scene: the last writer won silently | Every autosave write (and picture) carries the version it was based on (If-Match / the local `ifVersion`); a 412 keeps this page's version as "<name> (other copy)" and the table goes on as that copy, with a toast saying so. Also found and fixed: a retry queued from inside the write queue (the "deleted meanwhile" 404 path) waited on itself and stalled every later write | `web/account/autosave.js` |
| Rename dropped ordinary punctuation silently; AI names lost theirs in the account | One wider rule on both sides: letters, digits, spaces and `_ - ' ’ . , : ; ( ) & ! ? + #`; the rename says what it left out ("names can't have < > ✨") and refuses a name with no letter or digit visibly | `web/account/util.js` `cleanName()`, `api/_lib/scenes.mjs` `normName()`, `library.js` |
| No account deletion in the UI; "Not now" on the copy offer was final; deleting the scene on the table made a same-named card at the next edit with no word; the ⋯ button was 28 px on phones | **Delete account…** in the account menu (type DELETE; `DELETE /api/scenes/me`, then sign-out, a reload when the provider can't be told); a line under the cards while browser scenes remain uncopied that brings the offer back; the Undo bar says "It's still on the table: your next change there keeps it as a new scene."; a 44 px touch target under `(hover: none)`; autosave refusals that waiting won't fix (403 / 413 / 400) are said once and not retried in a loop | `account.js`, `cloud.js`, `library.js`, `account.css`, `autosave.js` |
| `dist/` still shipped the deleted `account/local.js`; a stale comment about a build-time config file | Rebuilt (`npm run build:static:nogen`: 120 files, `account/ai-signin.js` in, `dev-mock.js` out); the comment is gone | `dist/`, `api/scenes/index.mjs` |

**Left to the AI panel's owners** (`web/ai/` is theirs): `orchestrator.js` `plainError()` still titles a 401 `sign_in` and a 403 `quota` /
`site_quota` "Couldn't reach the AI" (and offers Try again). The sheet now covers sign-in before any request, and the backstop covers the rest,
but a quota refusal should get its own title (the server's sentence, with `resetsAt`) and no Try again; `sign_in` should not offer Try again.
The New dialog's Build with AI pane could also say "needs an account" before anything is typed (`window.sandboxLibrary.auth.aiSignInRequired`).

**How it was checked** (no accounts, no keys, nothing deployed; headless Chromium only):

| Command | What it proves | Result |
| --- | --- | --- |
| `npm run test:accounts` | everything in 13.3, plus: the bin counted and emptied oldest first (12 create + delete cycles at 1 MB hold at most 1 MB; the newest deleted scene still restores, the oldest says it was removed to make room); padding dropped (a 900 KB junk key stores 1.4 KB); 256 KB per scene; `storage_full` for everyone past the site cap; `savedAs` kept, changed alone without an edit, malformed ones refused; `copy: true` with its own count while the hour's writes stay free; Clerk without a database: accounts off and the AI's own check; 12 parallel plans at a $3 cap: 8 run, at most $3 recorded; a failed step with no cost gives its reservation back; a site refusal gives back what it reserved; names keep punctuation | 39 of 39 |
| `node web/account/test/e2e-accounts.mjs` | as in 13.3, plus with the **real AI gate**: signed out, Edit with AI shows the sheet and the gate's own 401 `sign_in` brings it up too; signed in, the gate lets the person through; `saved_as` in the database; two devices renaming one scene: the laptop's change kept, the phone's kept as "(other copy)" (a real 412); Delete account removes the account, its scenes and the Clerk user and signs out; `storage: false` stays local | 16 of 16 |
| `node web/account/test/library.e2e.mjs` (local server, mock accounts) | as in 7.9, plus `aiSignIn` (the sheet for the button, the A key and New's Build; Continue → back in New with the words; Build then runs into the account; the backstop), `cloudSavedAs`, `copyLater`, `edits` (punctuation kept and the left-out characters named; the on-table delete message), `deleteAccount`, `phone` (44 px) | all parts pass |
| `node web/account/test/clerk-browser.mjs`, `node --test ai/test/vercel.test.mjs` | unchanged parts still hold | 21 of 21, 8 of 8 |
| `npm run build:static:nogen`, `npm run check:vercel` | the site builds, every import resolves; the two functions, the rewrites, `/api/scenes/me` unconfigured `{accounts: null, storage: false, ai: {signInRequired: false}}` | passed |
| the reviewer's own probes (`savedas.mjs`, `flush.mjs`, `gate-par.mjs`, `adv-server.test.mjs`) | signed in, one "My ramp" scene, not two; two tabs keep both versions; 8 of 12 parallel steps, $2.80 recorded; a padded scene stores 1.4 KB and create + delete loops stay inside the quota | as expected |

## Sources (read 2026-10-15)

- Clerk + Vercel Marketplace (instances per environment, synced variables): https://clerk.com/docs/guides/development/integrations/platforms/vercel-marketplace
- Clerk on Vercel (a production instance needs a domain you own, not `*.vercel.app`): https://clerk.com/docs/guides/development/deployment/vercel
- Google with Clerk (shared credentials in development; production client and consent screen): https://clerk.com/docs/guides/configure/auth-strategies/social-connections/google
- Manual JWT verification (cookie or header, JWKS URLs, `azp`, `sts`): https://clerk.com/docs/guides/sessions/manual-jwt-verification
- Session token claims (v2) and size: https://clerk.com/docs/guides/sessions/session-tokens
- JavaScript SDK quickstart (`@clerk/clerk-js`, UI bundle loaded from the Frontend API): https://clerk.com/docs/js-frontend/getting-started/quickstart
- `SignIn.authenticateWithRedirect` (legacy) and `SignInFuture.sso`: https://clerk.com/docs/js-frontend/reference/objects/sign-in.md, https://clerk.com/docs/js-frontend/reference/objects/sign-in-future.md
- Clerk object (`handleRedirectCallback`, `proxyUrl`, `addListener`): https://clerk.com/docs/js-frontend/reference/objects/clerk.md
- Frontend API proxy (development and production): https://clerk.com/docs/guides/dashboard/dns-domains/proxy-fapi
- Bot protection (on by default; clerk-js 6.39.0 for custom flows; how to turn it off): https://clerk.com/docs/guides/secure/bot-protection
- Clerk pricing (Hobby: 50,000 MRU per app, 3 social connections): https://clerk.com/pricing ; development instance: 100 users: https://clerk.com/docs/guides/development/managing-environments
- npm: `@clerk/clerk-js` 6.39.0 (2026-10-09; exports `.` and `./no-rhc`), `@neondatabase/serverless` 1.2.0 (2026-10-01)
- Neon via Vercel (variables, preview branching): https://neon.com/docs/guides/vercel-managed-integration ; Neon free plan: https://neon.com/pricing
- Vercel Blob pricing and Hobby limits: https://vercel.com/docs/vercel-blob/usage-and-pricing
- Neon free plan, re-read for round 3: "1 GB/project"; "Exceeding 1 GB of Postgres storage in a project … blocks writes" (hence the 700 MB site cap): https://neon.com/pricing
- Vercel Functions limits (4.5 MB bodies, 300 s on Hobby): https://vercel.com/docs/functions/limitations ; Node.js functions (one function per group of routes, plus rewrites): https://vercel.com/docs/functions/runtimes/node-js ; rewrites (named segments become query parameters): https://vercel.com/docs/routing/rewrites
