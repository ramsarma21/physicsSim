# Accounts: sign in with Google, and every scene you saved, on any device

Status (2026-10-15): **design only.** Nothing here is built, configured or deployed yet. This file is the contract for the build step
and lists the owner's one-time setup steps (section 9), which only the owner can take: they create provider accounts and accept terms.

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
  `dist/clerk.mjs` is 1.5 MB.
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
   ├ local.js (signed out: localStorage +    api/_lib/{auth,origin,db,accounts,http}.mjs                      scenes, counters
   │           IndexedDB, as today + pictures)
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
| `web/account/cloud.js`, `local.js` | the two libraries, with one interface (7.6) |
| `web/account/library.js` | the "My scenes" dialog |
| `web/account/thumb.js` | the scene's picture for its card (7.5) |
| `web/account/account.css` | styles, using the app's existing tokens and button classes |
| `web/account/dev-mock.js` | development only (`?accountmock=1`): a fake Clerk and an in-memory `/api/scenes`, for headless tests. Listed in `DEV_ONLY`, so it never ships |
| `web/account/test/*.test.mjs` | node tests for the server (`api/_lib`, the function) and the local library. The build never ships `test/` folders |
| `tools/vendor-clerk.mjs` | vendors clerk-js (1.3) |

Files in `api/_lib/` are not turned into functions, because Vercel skips files whose names start with `_`. The build step's
`check:vercel` asserts that the built output has exactly the two functions `api/ai/[step]` and `api/scenes/index`.

### 2.2 Hooks in shared files (small, self-contained; re-read each file right before editing it)

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
  deleted_at  timestamptz                          -- deleted (can be restored for 30 days)
);
create index if not exists scenes_owner_recent on scenes (owner_id, updated_at desc) where deleted_at is null;

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
| scene JSON after `clean()` | 1 MB (a 200-item scene is about 60 KB) | 413 `too_large` |
| items in a scene | 200 (`clean()`'s `MAX_ITEMS`, as everywhere else) | 400 `bad_input` |
| name | 1–60 characters after the same rule as local saves: letters, digits, spaces, `_`, `-`, `'`; trimmed; empty gives "Scene HHMMSS" | (normalised, never refused) |
| picture | 150 KB; WebP, JPEG or PNG by its first bytes (never SVG); the page sends 640x360 | 413 `too_large` / 400 `bad_input` |
| scenes per account | 500 (`SCENES_MAX_PER_USER`), not counting deleted ones | 403 `quota` |
| bytes per account (scenes plus pictures) | 50 MB (`SCENES_MAX_BYTES_PER_USER`) | 403 `quota` |
| scene writes per account | 120 an hour (POST, PUT, DELETE, restore) | 429 `rate_limited` with `Retry-After` |
| list answer | the whole list in one answer (at most 500 entries, about 120 KB) | (no paging) |
| deleted scenes | kept 30 days, then removed the next time that account deletes something | (no cron job needed) |

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
  `{id, name, items, bytes, version, createdAt, updatedAt, thumb: "/api/scenes/<id>/thumb?v=<etag>" | null}`.

### 4.2 Routes

| Method and path | Body | Answer |
| --- | --- | --- |
| `GET /api/scenes/me` | — | Without a token: `{ok, accounts: {provider: "clerk", publishableKey} \| null, storage: true\|false, ai: {signInRequired}}`. With a token, also `user: {id, name, email}`, `usage: {scenes, bytes, maxScenes, maxBytes}` and `aiToday: {steps, usd, maxUsd, resetsAt}`. The first call with a token creates the account (3.1) |
| `GET /api/scenes` | — | `{ok, scenes: [meta, ...]}`, newest first, deleted ones left out |
| `POST /api/scenes` | `{name, scene, thumb?}`. `thumb` is a data URL `data:image/(webp\|jpeg\|png);base64,...` | **201** `{ok, scene: meta}` and `Location`. The server runs `clean(scene)` (400 with its message for a scene the builder can't use), sets `scene.id` and `scene.name`, and stores it |
| `GET /api/scenes/:id` | — | `{ok, scene: meta, data: <the scene JSON>}` with `ETag: "v<version>"` |
| `PUT /api/scenes/:id` | any of `{name, scene, thumb}` (`thumb: null` removes the picture). Optional `If-Match: "v<version>"` | `{ok, scene: meta}`. A name or scene change adds 1 to `version` and sets `updated_at`. A picture alone changes neither. A stale `If-Match` gives **412** `{code: "conflict", current: meta}` |
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
| 403 | `quota` | 500 scenes or 50 MB reached (the message says which, and that deleting frees room) |
| 404 | `not_found` | no such scene in this account |
| 405 | `bad_input` | a method the route doesn't take (`Allow` is set) |
| 412 | `conflict` | `If-Match` is stale (`current` is the scene's meta as it is now) |
| 413 | `too_large` | over a size limit in 3.2 |
| 415 | `bad_input` | not `application/json` |
| 429 | `rate_limited` | over 120 writes an hour (`Retry-After`, `retryable: true`) |
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
  - Storage: 500 scenes and 50 MB per account.
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
   - A valid Clerk token: that account.
   - Otherwise, the existing `accessProblem()` rules: an `ai_session` invite cookie (counted as `inv_<its nonce>`), or the preview token
     (counted as `tok`).
   - Otherwise:
     - if sign-in is required (`AI_REQUIRE_SIGN_IN`, which is on whenever both Clerk keys are set), **401**
       `{code: "sign_in", error: "Sign in with Google to use Build with AI", retryable: false}`;
     - if not, the existing 401 or 503 messages.
2. **Allowed.** When `AI_ALLOWED_EMAILS` is set (comma-separated addresses and `@domain` entries), an account whose verified email does not
   match gets **403** `{code: "not_allowed", error: "Build with AI is invite-only for now"}`.
3. **Limits.** Every check is atomic in Neon, in one transaction:

   ```sql
   insert into counters (key, bucket, n) values ($1, $2, 1)
   on conflict (key, bucket) do update set n = counters.n + 1 where counters.n < $3
   returning n
   ```

   A missing row in the answer means the limit is reached. The checks:
   - this caller's steps this hour (`AI_USER_STEPS_PER_HOUR`, default 40);
   - this caller's steps today (`AI_USER_STEPS_PER_DAY`, 200);
   - this caller's dollars today (`ai_usd_per_day`, else `AI_USER_USD_PER_DAY`, 3.00);
   - the whole site's dollars today (`AI_SITE_USD_PER_DAY`, 30.00).

   When over, the answer is **403**, not 429:
   - `{code: "quota", error: "You've used today's Build with AI allowance. It resets at 00:00 UTC.", resetsAt, retryable: false}`
   - `{code: "site_quota", ...}` for the site-wide cap.

   **Not 429**, because the AI client (`web/ai/orchestrator.js`, `call()`) treats every 429 as "the AI slots are busy" and waits and retries.
   A quota is not busy.
4. **Database missing.** A signed-in user on a deployment without `DATABASE_URL` gets **503** `not_configured`
   ("AI limits need the database"), on Vercel only. This fails closed, like the rest of the AI endpoint.
5. **After the step** (success or failure, in the existing `finally` block): add `usage.costInUSD` (when the answer or error has it) to this
   caller's day bucket and to the site's. One step can overshoot a cap by its own cost, at most about $0.35 for a plan.

The page **does not wait for a 401** to explain this. When accounts are configured and nobody is signed in, `account.js` catches the
**Build with AI** click (and the `A` key) in the capture phase. Instead of the AI panel, it shows the sign-in sheet: "Build with AI needs an
account. Continue with Google." After signing in, the panel opens where the person left off.

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
- **Delete account…** (a confirm dialog that asks the person to type DELETE).

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

## 8. Configuration (environment variables)

| Name | Set by | Used for |
| --- | --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | the Clerk integration (each environment gets its own instance's key) | `/api/scenes/me` gives it to the page. The server derives the Frontend API host, the JWKS URL and the expected `iss` from it. Also read as `CLERK_PUBLISHABLE_KEY` if that is set instead |
| `CLERK_SECRET_KEY` | the Clerk integration | server only: the Backend API (new person's email and name; deleting a user) |
| `CLERK_JWT_KEY` | optional, the owner | the instance's PEM public key, for verifying tokens without fetching the JWKS |
| `DATABASE_URL` | the Neon integration | everything in section 3 (the pooled connection string; the HTTP driver needs nothing else) |
| `ACCOUNTS` | optional | `off` hides sign-in and the library on that deployment (an emergency switch; needs a redeploy, like any variable) |
| `AI_REQUIRE_SIGN_IN` | optional | defaults to on when both Clerk keys are set; `0` turns it off |
| `AI_USER_STEPS_PER_HOUR`, `AI_USER_STEPS_PER_DAY` | optional | 40, 200 |
| `AI_USER_USD_PER_DAY`, `AI_SITE_USD_PER_DAY` | optional | 3.00, 30.00 |
| `AI_ALLOWED_EMAILS` | optional | invite-only AI: `you@example.com,@yourschool.edu` |
| `SCENES_MAX_PER_USER`, `SCENES_MAX_BYTES_PER_USER` | optional | 500, 52428800 |
| `ALLOWED_ORIGINS` | as in docs/DEPLOY.md | also the accepted `azp` values (aliases and custom domains) |

The existing AI variables (`TRUEFOUNDRY_*`, `AI_SESSION_SECRET`, `AI_INVITE_CODES`, `AI_ACCESS_TOKEN`) are unchanged. Vercel applies any
variable change only to deployments made after it.

## 9. Your one-time steps

Do these after the build step has landed this design in the code. Until then, nothing reads these variables. Each step is something only
you can do: it creates provider accounts and accepts their terms. All of it happens in the Vercel dashboard for team **ram-sarmas-projects**,
on the project created in docs/DEPLOY.md step 1 (for example `physics-sandbox`). Total: about 10 minutes.

### 9.1 Clerk (about 4 minutes)

1. vercel.com → team **ram-sarmas-projects** → **Integrations** → **Browse Marketplace** → **Clerk** → **Install**. Choose
   **Create New Clerk Account**, plan **Free / Hobby**, application name **Physics Sandbox**, then **Create**. You accept Clerk's terms here.
2. On the integration's page: **Connect Project** → choose the project. Keep all three environments (Development, Preview, Production) →
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
2. **Connect Project** → the same project. Environments: Development, Preview, Production. Leave **preview branching / "create a database
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
npm run build:static:nogen && npm run check:vercel && npm run test:accounts && vercel deploy
```

Then open the new deployment through its share link, as in docs/DEPLOY.md, and check:

1. **Sign in** → **Continue with Google** → pick your Google account → you are back on the sandbox with your initials in the top bar.
2. **Save** a scene → toast "Saved to your account" → **My scenes** (`L`) shows it with its picture.
3. Open the same link in a private window (or on your phone), sign in → the same scene is in **My scenes** → open it.
4. Sign out → **Build with AI** asks you to sign in. Sign in → a build runs, and the menu shows today's allowance going down.
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
  - signed out, the AI button shows the sign-in sheet;
  - 375 px wide: no horizontal scroll, and the dialog is a full-screen sheet;
  - no console errors;
  - no request to another origin except the mock's.
- **`npm run check:vercel`**: the two functions, the rewrites, `/api/scenes/me` unconfigured giving `{accounts: null, storage: false}`,
  the vendored clerk-js byte-identical to `vendor:clerk`'s output, and no secret value shipped.
- **The local server is untouched**: `localhost:8790` behaves exactly as before; the library there shows server saves and no sign-in.

## 11. Costs (free on all three at demo scale)

- **Clerk Hobby**: $0. 50,000 monthly retained users per app; the development instance holds at most 100 users.
- **Neon Free**: $0.
  - 1 GB storage per project (about 15,000 scenes with pictures);
  - 100 CU-hours a month: compute runs only while queried, plus a 5-minute tail;
  - 5 GB egress a month: list answers are about 100 KB, pictures about 30 KB and cached in the browser.
  - Over a limit, writes or compute pause until the next month. Nothing is billed.
- **Vercel Hobby**: the scenes function adds a few invocations per save, open and library view, well inside 1,000,000 invocations a month.
  docs/DEPLOY.md's note on Hobby's non-commercial terms still applies.
- **The AI** is the real cost, and section 6 caps it: by default $3 per person and $30 for the whole site per day.

## 12. Risks and open points

- **Core 3's vanilla redirect API.** `authenticateWithRedirect` and `handleRedirectCallback` are documented, but Clerk marks the
  `authenticateWithRedirect` API "legacy" and recommends `signIn.sso()`, whose redirect return is documented only for React. The build step
  confirms both calls on 6.39.0. If a later version drops them, the fallback is Clerk's hosted sign-in page (`redirectToSignIn()`), which
  needs no code change on the server.
- **No-remotely-hosted-code build.** It is expected to leave out Turnstile; the build step confirms by reading the bundle for
  `challenges.cloudflare.com`. If it turns out to need anything remote for Google sign-in, switch to `dist/clerk.mjs` (one constant in
  `tools/vendor-clerk.mjs`).
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
- Vercel Functions limits (4.5 MB bodies, 300 s on Hobby): https://vercel.com/docs/functions/limitations ; Node.js functions (one function per group of routes, plus rewrites): https://vercel.com/docs/functions/runtimes/node-js ; rewrites (named segments become query parameters): https://vercel.com/docs/routing/rewrites
