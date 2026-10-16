# Round 3 integration plan: edits that do exactly what was asked, and a concept picture for chain builds

15 Oct 2026, 18:45. The user asked: "the ai part needs to be wayyy smarter and actually be useful. edits need to actually edit the thing i asked for, and for requests without a ref image, you can use gpt 2.5 image to actually create a ref image anyway, which will help with the setup." Cost is no object; quality and usefulness are.

This plan covers what is still left to integrate. Its inputs are three finished experiments: `ai/experiments/edit` (n7), `ai/experiments/imagine` and `ai/experiments/search`, plus `ai/DESIGN.md` §12–§14 and `ai/research/benchmark.md` §12–§14.

## UPDATE 19:16: read this before §4.2 and §6

The server repair has finished, and the `r3-server.done` gate is open. It changed the browser contract. These sources now win over anything older in this plan:

- **The exact browser contract is ai/DESIGN.md §14.2 as rewritten at 19:16, plus §14.4.** It adds:
  - the base-plan rule;
  - every changed thing ending exactly where its patch asked, with any shortfall reported;
  - `plan_missing` handling;
  - the replace_type in-range mirror for web/ai's `applyPatches`;
  - "start over" now returning `kind: "new"`.
- **The reference browser modules now live in `ai/browser/`**: `apply-edit.js` **v4**, `edit-path.js`, `aim-container.js`, plus 19 tests.
  - They replace `ai/experiments/edit/integrate/apply-edit.js` (v3) and the experiment's `aim-container.js` everywhere this plan names those.
  - v4 equals v3 on every hard check of the 165-answer replay, and fixes a critical drift on AI-built scenes.
- **C1:**
  - `web/ai/aim.js` must port `ai/browser/aim-container.js` **and** `edit-path.js`'s `namedInTurn` / `lastChange` rule. Without it, aim-first can undo the user's own change to a container.
  - §4.2 (3) compares the live application against **v4**.
  - Mirror the replace_type in-range rule in `web/ai` `applyPatches`.
  - Route `kind: "new"` to "Build it as a new scene…".
- **B:** the replay runs live vs **v4** (`ai/browser/apply-edit.js`). `ai/bench/cases/edit-review.mjs` plus `ai/bench/tools/edit-review.mjs` (59 live review requests) is a ready extra acceptance set for §8 B.

## 0. Already in: do not redo

| what | where | status |
|---|---|---|
| n7 edit step, server half: new prompt, rich digest from the step's own run, `kind` + `targets`, `feedback` payload | `ai/steps.mjs`, `ai/rich-digest.mjs`, `ai/prompts/edit.md`, `ai/schemas.mjs` | built and measured (DESIGN §14.1, benchmark §14): pass 0.990, untouched byte-identical 0.981, edit p50 7.3 s |
| Client part A: stage tuner right after the first solve, rate-only final check, per-stage knobs, AI access states | `web/ai/stage-tune.js`, `web/ai/access.js`, `orchestrator.js`, `panel.js` | being finished now by the part-A agent, who holds those files until it reports |
| "Edit with AI" (the drawer, A) and "New → Build with AI" (N) as separate entry points; `intent: "edit"` / `"new"` | `panel.js`, `new-project.js` | built (DESIGN §13.8 "as built") |
| Untouched items kept byte for byte (`pinUntouched`, `restoreExact`), room-making, a reply-only path, refusing "new" answers, a pre-checked fix chip after a plain edit (`fixer.js`) | `orchestrator.js`, `fixer.js` | built. It already does most of §14.2 its own way: §4.2 says which parts are still missing. |
| A slot for a concept picture on the result card | `panel.js:534, :1041` (reads `r.concept` as a string); `orchestrator.js:2824` (reads `plan.concept_image`) | placeholder only. §4.1 replaces it with one contract. |

## 1. Decisions

1. **Imagine-first goes in for chain requests only** (`exp:imagine`).
   - It applies to New → Build with AI, from words only, when the request is a multi-step chain (`isChainRequest`).
   - The route is concept → observe → plan. The concept informs the plan only: it is never treated as the user's picture.
   - Every other new scene is built from words, unless the user picks "Always".
   - Edits never make a concept.
2. **Image model: `openai-group/gpt-image-2.5-flare`** at quality high, 1536×1024, with **`output_format: "jpeg", output_compression: 85`**.
   - Probed today through the gateway: 200 OK, a 96 KB JPEG, 13.8 s, 1,372 image tokens. So no `sips` and no `sharp` dependency are needed, and the answer stays small for Vercel.
   - Fallbacks, in order: `openai-group/gpt-image-2.5-sunburst` (same params; as good, about 10 s slower), then `gemini-group/gemini-3-pro-image-preview` (no size, quality or format params; square PNG).
   - **No best-of-3 and no vision check.** They added 12 s and $0.22, and the check barely predicts plan quality (Spearman 0.19 within a case).
   - Note: `integration/imagine-step.mjs` defaults to sunburst. Use flare.
3. **The n7 browser half goes in as measured deltas on top of the live drawer, not as a replacement.**
   - The live drawer has moved on since the experiment's 14:00 frozen client: it has pinUntouched, room-making and the fixer chip.
   - Measure first (§6, E0). Then add only what is missing or what beats the live code on the experiment's eval.
4. **The user's rule stays: a plain edit is never auto-fixed.** It makes the exact change, runs it, says honestly what stopped working, and offers a fix already checked in the engine as a chip (`fixer.js`). Only requests that state the outcome ("make it work again", "so it lands in the cup", `kind: "fix"`) fix as part of the edit.
5. **Simplest version wins.** One concept per build, one setting, and no new model calls on the edit path apart from the measured repair and fix turns.

## 2. Who owns which file

No two agents edit the same file. Before its first edit, each owner checks that nobody else is in the file (ListAgents, and the file's mtime in the last 10 minutes).

| owner | edits (existing files) | creates (new files) | may start |
|---|---|---|---|
| **S: server imagine** | `ai/steps.mjs`, `ai/core.mjs` (only if a shared helper is needed), `ai/schemas.mjs`, `ai/models.json`, `web/server.py` (its AI section only), `api/ai/[step].mjs`, `api/_lib/ai-gate.mjs`, `ai/DESIGN.md` (new §15 only), `ai/test/*.test.mjs` it must update | `ai/imagine.mjs`, `ai/prompts/prepass.md`, `ai/prompts/imagine.md`, `ai/test/imagine.test.mjs` (+ fixtures) | now |
| **C1: client pipeline** | `web/ai/orchestrator.js`, `web/ai/fixer.js` (only if needed), `web/ai/test/orchestrator.test.mjs` | `web/ai/imagine.js`, `web/ai/edit-turns.js`, `web/ai/aim.js`, `web/ai/test/imagine.test.mjs`, `web/ai/test/edit-turns.test.mjs` | new files now; existing files only after part A reports and the `web/ai` tests are green |
| **C2: client UI** | `web/ai/panel.js`, `web/ai/new-project.js`, `web/ai/ai.css` | none (optionally `web/ai/test/panel.e2e.mjs`) | after part A reports |
| **B: bench and acceptance** | `ai/bench/run.mjs`, `ai/bench/score.mjs` (only if a check is missing), `ai/research/benchmark.md` (new §15 only) | `ai/bench/tools/edit-live.mjs`, `ai/bench/tools/edit-apply-replay.mjs`, `ai/bench/cases/chains.json` | now (E0 baseline first) |
| nobody this round | `web/app.js`, `web/index.html`, `web/view3d.js`, `web/sim/**`, `web/ai/{solver,goals,stage-tune,access,fix-pool,fix-worker,shot}.js`, `ai/goals.mjs`, `ai/rich-digest.mjs`, `ai/prompts/{plan,observe,refine,edit}.md` | | |

Contracts between owners: S ↔ C1 is §3's request and answer. C1 ↔ C2 is the `concept` event, `report.concept`, the `imagine` build option and the edit report fields in §4.2. B uses only public entry points: `runStep`, and `createOrchestrator().build()`.

## 3. Server: the `imagine` step (owner S)

**Endpoint:** `POST /api/ai/imagine {payload: {text*}, client?}`. Same envelope, errors, queue and progress as the other steps (DESIGN "Server AI core"). Pictures in the payload are a 400.

**Answer:**
```
result: {
  concepts: [{data: "data:image/jpeg;base64,...", mime, model, width, height}],   // exactly one
  cast: [{type, count, role, size}],
  missing: [{asked, substitute_type}],
  layout,
  story: [..],
  prompt                                                                            // the image prompt, for the record
}
```
- `ms: {prepass, image}`.
- `usage`: the pre-pass usage, plus `image: {model, output_tokens, usd_est}`.
- `usage.costInUSD` **includes** the image estimate (1,372 tokens × $40/M ≈ $0.055). The gateway returns tokens, not dollars, and `api/_lib/ai-gate.mjs` would otherwise hand back the reservation and leave images unmetered.

**Flow (`ai/imagine.mjs`, ported from `ai/experiments/imagine/lib/{cast,prompts,catalog-info,image}.mjs`):**
1. **Pre-pass**: `callModel("prepass", …)`.
   - System prompt: `prompts/prepass.md`, which is lib/cast.mjs's `SYSTEM` with `{{CATALOG_BRIEF}}`. It is cacheable, like the other steps.
   - Validator: lib/cast.mjs `validate`. It drops non-catalog keys, needs at least one cast item and a layout, and adds `size` from `sizePhrase`.
   - Measured p50 8.5–10 s, about $0.03.
2. **Image prompt**: the **photo** template, `prompts/imagine.md` with `{{REQUEST}}`, `{{CAST}}`, `{{LAYOUT}}` and `{{STORY}}`, plus the cast lines from the catalog (name, Looks line, size). It must be **byte-identical** to `lib/prompts.mjs imagePrompt("photo", …)` for the same pre-pass (test below).
3. **Image**: `POST {base without /v1}/images/generations` over `fetchH1` (Node's HTTP/2 fetch queues parallel calls on one connection: the gen-log's 16–380 s).
   - Body: `{model, prompt, n: 1, size: "1536x1024", quality: "high", output_format: "jpeg", output_compression: 85}`. The Gemini route sends `{model, prompt, n: 1}` only.
   - 60 s per attempt. 1 retry per route with backoff, honouring Retry-After on 429/5xx. A 4xx moves to the next route.
   - The key comes from `process.env` only and is scrubbed from every error.

**Config:**
- `models.json`:
  - `"prepass"`: Opus 5.5 on claude-group, effort low, 6000 max tokens, 90 s, budget 90 s, stream. Fallbacks: Bedrock Opus, then `gpt-6.1-sol` low.
  - `"imagine"`: `{kind: "image", model: flare, fallbacks: [sunburst, gemini-3-pro-image-preview], params: {size, quality, output_format, output_compression}, timeoutMs: 60000, budgetMs: 150000, retries: 1, usdPerOutputToken: 0.00004}`. The 150 s budget covers the whole step, pre-pass included.
- `web/server.py`: add `imagine` to `AI_STEPS`; `AI_STEP_SLOTS["imagine"] = 4`; `AI_TYPICAL_S["imagine"] = 25`; its budget is the step's own.
- `api/ai/[step].mjs`: `STEP_SLOTS.imagine = 4`, `TYPICAL_S.imagine = 25`. `maxDuration` 300 already fits.
- `ai-gate.mjs`: `STEP_USD.imagine = 0.15`. A chain build now uses 1–2 more steps (imagine, observe), which fits inside 40 steps an hour.
- A concept is 100–700 KB, far below the 4.5 MB Vercel body limit.

**Schema fix (same owner):** an observed object with a `null` box goes into `uncertain`, with a warning. It is no longer a validation failure. 2 of 120 concept observations failed this way: the request named a cat and water that the picture did not show.

**Tests (`ai/test/imagine.test.mjs`, mock gateway):**
- The image body params.
- Fallback order on 5xx, timeout and 4xx; Gemini gets its params stripped.
- 429 with Retry-After; the budget; abort.
- Payload checks: bad input and pictures sent.
- The validator drops unknown keys.
- **The prompt text is byte-identical to the experiment's** for 3 stored pre-passes (copied from `ai/experiments/imagine/results/p2/imagine` as fixtures).
- **The key appears in no answer, error or log.**
- `costInUSD` includes the estimate.

**Docs:** DESIGN.md §15 (this contract).

**Local server:** restart it only when `GET /api/ai/progress` shows nothing running or waiting.

## 4. Client pipeline (owner C1)

### 4.1 Imagine-first in the orchestrator
- `web/ai/imagine.js` holds `isChainRequest`, `conceptPlan(text, mode)`, `CONCEPT_NOTE` and `CONCEPT_LABEL`, verbatim from `ai/experiments/imagine/integration/orchestrator-imagine.diff`. Modes: `"auto"` (default), `"always"`, `"off"`.
  - auto: a chain goes `"observe"`; anything else gets no concept.
  - always: a chain goes `"observe"`, anything else `"direct"`.
- Merge the diff's 8 hunks into the live `orchestrator.js`. 2 fail against the live file; merge them by hand. Changes against the diff:
  - Drop `n` (always 1).
  - A **client deadline of 75 s** on the imagine call; past it, plan from words.
  - Build option `imagine` comes from C2's setting.
  - Delete the `plan.concept_image` placeholder.
- **When:** `mode === "new"`, no user pictures, non-empty text. Never in edit or check. A user photo always wins: the photo route runs, and no concept is made.
- **Contract with C2:**
  - Event `{type: "concept", image, cast, story}` as soon as the image arrives (about 24 s in).
  - Step id `"imagine"`, label "Picturing the scene".
  - `report.concept = {image, cast, story, how: "observe" | "direct"}`, or null.
- **Never treated as the user's picture:**
  - no reconcile or coverage;
  - no observation, checklist or concept image in any refine or rate payload;
  - `plan.covers` is deleted;
  - `report.unsure` is empty;
  - plan `differences` that mention "the picture/image/photo/concept" are left out of the card.
- **The stage tuner and the critic run exactly as for words** (part A); they never see the concept.
- **Every failure falls back to the words alone, with one info line:** no image, observe failing, or the plan from the concept failing.
- Do not ship the "IFfull" variant (the concept used everywhere as a reference). It was worse: pass 0.90, judges −0.41 / −0.25, and it reported things that exist only in the picture as missing.
- **Tests (`orchestrator.test.mjs` + `imagine.test.mjs`, mock api):**
  - A chain calls imagine → observe → plan, and the concept is sent with `CONCEPT_NOTE`.
  - A simple request makes no imagine call; always → direct; off → none.
  - Each failure point falls back with the info line.
  - The refine payload carries no concept.
  - `report.concept` has the right shape.
  - A request with a photo makes no imagine call.
  - The classifier picks exactly c1, c2, g2, m5, n05, n08, n09, n10, n12, n13, n14 out of the 40 experiment prompts.

### 4.2 The n7 browser half (§14.2) as deltas on the live drawer

| §14.2 | live drawer now | action |
|---|---|---|
| (1) request | sends `plan` only when `sameScene` ✓; history is the last **8** turns (panel); still sends `sim` | C2: history ≤ **20** turns (assistant turns are the replies as shown, questions included). C1: stop sending `sim`; the server runs the scene itself (§14.1). |
| (2) read `kind` first | infers the kind from `patches: []` / `mode`; **drops `suggestions` on reply-only answers**; ignores `targets` | C1 `edit-turns.js routeKind(out)`: `ask` → the question, with `suggestions` as chips that each send a whole request; `answer`; `undo` → the Undo button; `new` → the existing "Build it as a new scene…"; `change` / `fix` → apply. `report.edit.kind` and `report.edit.targets` are kept for Details. |
| (3) deterministic application | `pinUntouched` / `restoreExact` / riders / `editScope` / room-making | **Measure, don't swap**: B's replay (§6) runs the stored n7 answers through the live application and through `apply-edit.js` v3. Adopt only the v3 behaviours the replay shows live failing (likely candidates: things hovering ≤ 6 cm above a moved thing follow it; a changed thing inside a safety wall slides off; a swap is re-seated at its support's x). The existing starter tests stay green. |
| (4) one overlap-repair turn | none (room-making only) | C1: when the applied change still leaves **new** start-up overlaps, make one edit call with `feedback` (the exact text in DESIGN §14.2 (4)), keeping the new answer only if it has fewer. About 3 % of edits. |
| (5) fast path + heads-up | fast path ✓; the fixer's pre-checked chip ✓ (the user's rule) | Keep the fixer chip as the "make it work again" offer. Add n7's heads-up only for what the fixer's lead does not already say: stages lost, and firm hits (≥ 0.3 m/s) that no longer happen. |
| (6) `kind: "fix"` | `CHECK_RE` adds container knobs, then the fixer search | C1: `aim.js` (a port of `aim-container.js`) **first**: a failing "in" goal with a static container the user did not just name gets aimed at where the thing now comes down (≤ 16 runs). If that does not pass, ≤ 2 `feedback` rounds (§14.2 (6b) text), then the tuner or fixer. The reply is honest ("It still doesn't fully work: …"). Adopt aim-first only if it is ≥ live on the 4 × 5 fix cases. |
| (7) no critic for edits | ✓ | keep |

## 5. UX (owner C2; desktop only, light and dark)

**New → Build with AI** (`new-project.js`):
- A one-line setting under the prompt box: **"Concept sketch: Auto · Always · Off"**, with the hint "Auto: for multi-step machines". It is remembered in `localStorage` (try/catch) and passed as `imagine` to `ai.build`.
- With a photo attached, the setting is shown as off: "your photo is the reference".

**Progress card** (`panel.js`):
- The step row "Picturing the scene", with elapsed time.
- On the `concept` event, the picture appears at once, while a chain still has 1–3 minutes to go. With it:
  - the label **"Concept sketch · AI-generated"**;
  - the caption "An AI picture of the idea, made from your words. The build follows your words, not the picture.";
  - the cast as catalog chips ("10 × domino · 5 cm");
  - the numbered story (≤ 6 lines).
- If it fails, nothing is shown except the info line under Details.

**Result card:**
- A small "Concept" thumbnail beside the result. Clicking it opens concept | final start frame side by side.
- It is kept in the turn history. The JPEG is ≤ 200 KB; the existing 400 KB guard stays, reading `r.concept.image`.

**Edit with AI (the drawer) never makes or shows a concept.** One card per kind:
- `ask`: one question that names the candidates, plus chips for each reading. The scene is untouched.
- `answer`: the reply.
- `undo`: the reply and the Undo button.
- `new`: "That's a new scene. Build it as a new scene…", which opens New → Build with AI with the same words.
- `change` / `fix`, the **edit card that lists exactly what changed**:
  - lead "Edited: <scene>";
  - one line per change in real units, before → after ("Yellow ball → tennis ball (6 g → 58 g)");
  - "Moved the box 3 cm right to make room" (madeRoom);
  - "Not done: …" (skipped patches);
  - **"Everything else is exactly as it was (N items untouched)"**, counted byte for byte;
  - then the heads-up and the pre-checked fix chip.
  - Details: targets ("“the yellow ball” → Ball 2"), why, time, model.

## 6. Bench and acceptance runs (owner B)

- `ai/bench/tools/edit-live.mjs`: the experiment's 105 cases (2 samples) plus the 4 make-it-work cases × 5.
  - It goes through the **live** `web/ai` orchestrator in mode edit, exactly as the panel calls it (history, plan, planScene), with the shipped `runStep` in process.
  - Scored with `ai/experiments/edit/lib/check.mjs` (imported read-only). The table is shaped like benchmark §14.3.
  - **E0** = the live client now (after part A). **E1** = after C1 and C2.
- `ai/bench/tools/edit-apply-replay.mjs`: the stored n7 answers' patches, applied by the live application and by `apply-edit.js` v3, scored with check.mjs. No model calls; it decides §4.2 (3).
- `ai/bench/run.mjs pipeline --imagine off|auto|always|observe|direct` passes the mode to the orchestrator and records the concept, route and ms.
- `ai/bench/cases/chains.json`: the union of the chain prompts in both experiments, about 18 unique:
  - imagine's c1, c2, g2, m5, n05, n08, n09, n10, n12, n13, n14;
  - search's c1, c2, g2, h01, h03, h04, h06, h07, h08, h14;
  - with their checks (the bench scorer's, plus search's key outcome and per-stage checks).
- Judges: Claude Opus 5.5 high and GPT-6 Astra high, blind. Same-time A/B, at most 4 calls in flight per process.
- Write-up: benchmark.md §15.

## 7. Expected gains (measured; noise is about ±0.08 pass and ±0.3 judge per run)

| change | measured on | before → after | cost |
|---|---|---|---|
| n7 edits (server + browser), vs the 14:00 client | 105 edit cases × 2, hard checks | pass **0.69 → 0.99**; untouched byte-identical **0.36 → 0.98**; ambiguous requests asked **3/10 → 10/10**; questions change nothing **22/32 → 32/32**; works or says why 179/202 → 202/202; make-it-work **8/20 → 15–16/20** | p50 / p90 **14 / 64 → 7–9 / 12–16 s**; **$0.07 → $0.03** per edit |
| imagine-first, chains (observe route) | 11 chain prompts × 2, whole pipeline | hard pass **0.82 → 0.95**; goals met **0.84 → 0.97**; det. 0.961 → 0.986; judges **+0.64 (Astra) / +0.73 (Opus)**; refine rounds on 4–6-stage chains 3.25 → 2.33 | +56 s p50 (128 → 183 s); +$0.15 per build |
| the same, direct route (no observe) | same | pass 0.91; goals 0.94; judges +0.96 / +0.86 | +13 s; +$0.02 |
| imagine-first, blended over the 40-prompt mix | 40 × 2 | pass about 0.90 → 0.94; judges about +0.18; simple scenes unchanged (no concept made) | about +15 s and +$0.04 per new-scene build |

**Caveats:**
- The edit gain was measured against the frozen 14:00 client. The live drawer has since gained exact pinning and the fixer, so the real gain over live is whatever E1 − E0 shows.
- Imagine was measured **without part A's stage tuner**. In the search experiment, the stage tuner alone took chains' success before any critic from 0.45 to 0.95, so the two gains may overlap. §8 D decides from the live numbers.

## 8. Acceptance tests (all must pass before it ships)

**A. The imagine server step.**
- `npm run test:ai` passes in full, with the new tests.
- The prompt text is byte-identical on the fixtures.
- 10 live calls through :8790: 10/10 answered; p50 ≤ 30 s, p90 ≤ 45 s; each concept a JPEG ≤ 400 KB at 1536×1024; `costInUSD` present (about $0.07–0.10).
- Faults: flare failing → sunburst; both failing → gemini.
- `grep` finds the key in no output, log or file.

**B. Edits through the live drawer (E1, 2 samples × 105 + 4 × 5):**

| check | must reach |
|---|---|
| pass | ≥ 0.98 |
| untouched byte-identical | ≥ 0.97 |
| exact change | ≥ 177/178 |
| others untouched (≤ 3 mm) | 178/178 |
| questions + ambiguous unchanged | 32/32 |
| asks when ambiguous | 10/10 |
| works or says why | 202/202 |
| make it work | ≥ 15/20 (aimed boxes 10/10) |
| edit time | p50 ≤ 10 s, p90 ≤ 20 s |
| cost | ≤ $0.04 per edit |

- E1 must also be ≥ E0 on every column.
- `node --test web/ai/test/*.test.mjs` is green, including the 4 "starter: …" tests.

**C. The user's real failing edit, in the real app** (headless Playwright Chromium on :8790, desktop 1440×900, 3 runs):
1. Load the starter. In Edit with AI, send "replace the yellow ball with a tennis ball and the red ball with a basketball".
   - Each run: `kind: "change"`, targets ball2 and ball1, exactly those two items changed (types and names). Every other item is byte-identical to before.
   - The basketball sits where the red ball was: its bottom at the red ball's bottom, held.
   - The card lists exactly the two swaps and "Everything else is exactly as it was (N items untouched)".
   - Under 12 s.
   - If the box goal now fails, the card says so and offers a pre-checked fix chip. Nothing else is changed automatically.
   - ⌘Z gives back the starter byte for byte.
2. Then "make it work again": it works, or the card says honestly what still fails. Only allowed things move, and never the user's two new balls' kinds.
3. "make the ball bigger" → one question naming both balls, 2 chips, scene byte-identical.
4. "start over with a catapult that flings a ball into a bucket" in Edit with AI → nothing changed; "Build it as a new scene…" opens New → Build with AI with the words filled in.

**D. Imagine end to end** (live client, `chains.json` × 2 samples; text25 + new15 × 1):
- **Ship Auto as the default only if, on chains, auto − off has:**
  - hard pass ≥ 0;
  - goals met ≥ 0;
  - mean of both judges ≥ +0.3;
  - p50 time ≤ +60 s;
  - the fallback used in ≤ 5 % of builds.
  Otherwise ship with **Off** as the default and keep the setting.
- Non-chain prompts make **0** imagine calls, and their results stay within noise (pass ±0.04).
- Also run the direct route on chains. If it ties the observe route on pass and goals (±0.04), switch Auto to direct (one line): it is 40 s faster.
- Fault injection at each of the 3 failure points: the build finishes from the words, with the info line and no concept shown.

**E. No regressions on the whole bench** (70 cases, live client before vs after, plus the 26 pictures a second time): text, picture and edit pass no lower than before beyond ±0.04; 0 errors.

**F. The UI** (headless Playwright, light and dark):
- On 5/5 chain builds, the concept shows in the progress card before the plan step ends.
- It is labelled AI-generated.
- The thumbnail and the side-by-side view work.
- The setting survives a reload.
- No imagine call from Edit with AI, or when a photo is attached.
- No "the picture" differences and no "unsure" lines on concept builds.

## 9. Risks

| risk | mitigation |
|---|---|
| The imagine gain does not stack on top of part A's stage tuner | §8 D's ship rule. The setting stays available either way. |
| The image model draws spatial details wrong ("zig-zag" ramps sloping the same way, "at least four stages" drawn as three; c2 failed 1 of 2 with the concept) | `CONCEPT_NOTE` (the words decide), and the critic sees only the words. Follow-up: put the stage count and slope directions into the image prompt (§10). |
| The chain regex misfires (three verbs in a simple request) | It only costs time. Counted in D; the classifier test pins the 40-prompt set. |
| Image latency spikes (gen-log: up to 380 s under HTTP/2) | `fetchH1`, 60 s per attempt, the 150 s step budget, the 75 s client deadline, then words alone. |
| Images go unmetered on the hosted site | `costInUSD` includes the token estimate; `STEP_USD.imagine` reserves $0.15. |
| Two agents in one file (part A is still in `orchestrator.js` / `panel.js`) | §2's gates. C1 builds its new modules first and only hooks them in after part A reports. |
| n7 code duplicates the live fixer and pinning, or regresses them | Measured deltas only (E0 vs E1, the replay). The starter regression tests stay green. |
| A concept looks like the result and misleads | The label, the caption, and the side-by-side view show the difference. A concept is never shown on edits. |
| Image moderation or refusals | Neutral prompts (no people); the fallback chain; then words alone. |

## 10. Not in this round (next, each with its own A/B)

- **Best of 4 plans + the stage tuner** (search "bonstage"). Against base: judges +0.71 [0.21, 1.29] Opus and +0.68 [0.24, 1.12] Astra; own goals all met 0.98. Against the stage tuner alone: +0.46 / +0.40. Cost: +$0.40 and about +14 s mean (first plan + a 60 s deadline keeps the plan wait at p90 82 s). It was not tested together with imagine. Worth trying: the concept plan as one of the candidates.
- **Stage repair through the edit step** (search v3) on the 8 hardest cases: success 0.56 → 0.69, judge 5.50 → 6.75, +23 s.
- **The verified gate**, if part A did not ship it: skip the critic when every check passes. −8 s, the same quality, and it avoids the 2 verified scenes the critic broke.
- **The `render_labels` template**: the best observe counts (0.69–0.74) and a readable labelled storyboard; possibly a better picture to show users.
- **The image prompt with stage count and slope directions**; and observe at low effort for concepts (would save about 13 s; untested).
- **n9** (n7 + "never worse" + a wider tuner): 17/20 vs 16/20 make-it-work, with a shorter tail; needs more samples.

## 11. Order

1. **Now, in parallel:**
   - S: the whole server step.
   - B: E0, the replay, the `--imagine` flag, `chains.json`.
   - C1: `imagine.js`, `edit-turns.js` and `aim.js` with their tests, no hooks yet.
2. **When part A reports:** C1 hooks both into `orchestrator.js`; C2 builds the UI. They work in parallel, on different files.
3. **When S, C1 and C2 are done:** B runs §8 B–F, with one fix round by the owners. Then an Opus review of the numbers, and §15 of DESIGN.md and benchmark.md.
