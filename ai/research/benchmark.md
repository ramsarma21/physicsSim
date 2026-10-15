# AI scene builder: benchmark, model routing and prompt optimisation (15 Oct 2026)

What this decides: which model, route and reasoning effort runs each AI step (`ai/models.json`), and the prompts each step runs (`ai/prompts/`). Everything below was measured on 15 Oct 2026 with `ai/bench/run.mjs` (≈4,900 model calls: ≈2,600 steps and ≈2,300 judge verdicts) on the eval set in `ai/bench/`. Raw results: `ai/bench/results/<run>/<phase>/<config>/<case>.json` (one file per answer: the call, the answer, the solved scene, the run summary, the deterministic score, both judges' verdicts).

## 1. Headline

**Routing shipped in `ai/models.json`** (every step on Claude Opus 5.5, the user's preference, at the effort the benchmark found best for it):

| step | primary (route · effort) | fallbacks, in order | why (numbers in §4–§7) | latency p50 / p90 (s) |
|---|---|---|---|---|
| observe | `claude-group/claude-opus-5-5` · **medium** | same model on `aws-bedrock/global…`; `openai-group/gpt-6.1-sol` · medium | Gemini 4 Argon was not clearly better (§5). End to end on the 26 picture cases (2 samples each), medium beat low: pass 0.96 vs 0.90, det. 0.994 vs 0.975, both judges higher; low effort's observation made the planner drop a real part (the spring launcher's 45° support plank) in 6 of 6 tries. It costs +11 s per picture build. | 26.9 / 41.2 |
| plan | `claude-group/claude-opus-5-5` · **medium** | same model on Bedrock; `openai-group/gpt-6.1-sol` · high | Over 2 samples × 25 cases medium was at least as good as high (det. 0.967 vs 0.961, judge 7.26 vs 7.04) and 30 % faster; low lost 0.02 det. / 0.08 pass. | 18.3 / 40.6 |
| refine | `claude-group/claude-opus-5-5` · **medium**, every round | same model on Bedrock; `gemini-group/gemini-4-argon` · low | Fixed 4 of the 6 failing states in one round and broke 1 of 45 passing ones; the fast candidates fixed 0–2 and broke up to 3 (§6). | 11.1 / 25.2 |
| edit | `claude-group/claude-opus-5-5` · **low** | same model on Bedrock; `openai-group/gpt-6.1-sol` · low | 19/19 edit cases passed; it is itself the fast option (p50 3.7 s, the same as Haiku and Gemini Flash). Medium and high effort were slower and *worse* (they changed things the user did not ask for). | 3.6 / 10.4 |

Latencies are per call inside the shipped pipeline runs (6 builds in parallel). All four steps keep a different family as the last fallback. `retries` is now 1 per route (a failing route moves to an independent backend instead of retrying twice), and per-attempt timeouts are about 3× the slowest answer measured (observe 120 s, plan 180 s, refine 120 s, edit 60 s; slowest seen 50 / 130 / 44 / 12 s). **Changed in the repair round (§12):** plan 300 s, because a real classroom photo's plan needed 145 s, and every step now streams on the routes that stream their thinking (claude-group, the OpenAI group). An attempt with no progress for 90 s is dropped at once, while a plan that keeps thinking can use its whole timeout. In the shipped pipeline runs, every one of 361 calls was answered (360 by the primary route, 1 refine call by the Bedrock fallback) and no build failed.

**The whole app pipeline, before vs after** (`web/ai/orchestrator.js` run headlessly exactly as the AI panel runs it: observe → plan/edit → solve → engine → real renders → refine ≤ 3 → tune; 70 cases: 25 text, 26 pictures, 19 edits; both judges; the picture cases of the shipped configuration averaged over 2 runs). Both rows already had the fixed validators and solver (§1.2, §1.1), so this isolates routing and prompts; the validator fix's own effect is in §1.2 and §8:

| | det. score | hard pass | judge Opus / Astra | rubric met (Opus) | time p50 / p90 | $ per build |
|---|---|---|---|---|---|---|
| before (provisional routing: observe Opus-medium, plan Opus-high, refine Opus-medium, edit Opus-low; original prompts) | 0.985 | 0.89 | 8.21 / 8.82 | 0.89 | 41.8 s / 107.9 s | 0.17 |
| **shipped** (this routing and these prompts) | **0.988** | **0.91** | 8.07 / **8.89** | 0.88 | **39–40 s / 90–95 s** | 0.16–0.17 |
| · text requests (25) | 0.986 → 0.979 | 0.84 → 0.84 | 8.24 / 9.00 → 8.04 / 9.20 | 0.88 → 0.88 | 29.9 / 123.5 → **25.1 / 83.3** | 0.18 → 0.16 |
| · from a picture (26) | 0.982 → **0.994** | 0.96 → 0.96 | 7.96 / 8.37 → 7.73 / 8.23 | 0.88 → 0.83 | 77.5 / 108.4 → **58.6** / 116.4 | 0.22 → 0.23 |
| · follow-up edits (19) | 0.987 → **0.992** | 0.84 → **0.95** | 8.53 / 9.21 → **8.58 / 9.37** | 0.89 → **0.95** | 14.1 / 31.7 → 13.1 / 40.2 | 0.08 → 0.07 |

Read it as: **the provisional all-Opus setup was already close to the ceiling of this eval set end to end; the shipped one is as good or better on every deterministic number, ties on the judges (Opus −0.14, Astra +0.07), fixes follow-up edits (pass 0.84 → 0.95), and cuts the slow tail of text builds by a third (p90 124 → 83 s) and picture builds' typical time by a quarter (p50 78 → 59 s).** Single samples per case flip pass/fail about one time in ten (§10), so ±0.04 pass and ±0.2 judge between rows is noise. The plan step on its own improved clearly with the new prompt (pass 0.78 → 0.86–0.88, judge 7.26 → 7.74, §8), but in the whole loop refine and the tuner already repaired most of what the old plan prompt got wrong, so the end-to-end gain shows up as fewer slow builds, not as more passes.

**Bugs the benchmark exposed, fixed here** (each with a regression check in `ai/bench/tools/selftest.mjs`, 215/215 passing, and `npm run test:ai` 69/69):
1. `web/ai/solver.js` `planFromScene()` did not round-trip: editing a hand-made scene moved items the edit never touched. The built-in **Spring launcher scenario's launcher jumped 11.4 cm** off its support plank when a user added a cup elsewhere; an offset book moved 6 mm and a brick 10 mm in two ground-truth scenes (6 of 30 scenes). Fix: `pinDrifters()` solves the inferred plan and pins any item the solver would put elsewhere to its exact pose. Now 30/30 scenes round-trip.
2. `ai/schemas.mjs` sent trivial slips back for a full repair turn, which re-sends the whole conversation and doubles the step's time: **13 of 40 Opus-high observations** (a 62-character colour, a 438-character "uncertain" note, `est_size_m.w: null`), and **2 of 320 observations failed outright** on a colour 62 characters long. Refine and edit answers repaired for a 432-character issue text or a goal without a label; plans for `place.y` instead of `y_m` and an item-level `angle_deg`. Fix: over-long free text is cut, a size with an unknown side becomes null, a few state/relation synonyms are read, a box a hair outside the picture is clamped, a goal gets a label from its item and container, `y` → `y_m` in the air, `angle_deg` moved into `place`; each with a warning. Anything ambiguous (a box on another scale, swapped corners, unknown relations, unknown support labels) still gets the repair, as the existing tests require. Effect: Opus-low observe repairs 4/26 → 0–1/26 on the same images, p90 27 → 17 s.
3. The prompts never said that the solver's see-through **safety walls** cannot be removed: 10 of 357 critiques tried `remove wall-right` (to let a mug fall off the table) and needed a repair. `prompts/_world.md` now says so, and that nothing can fall off the table.
4. **Refine after an edit moved what the user kept** (the critic judged "add a dog that chases the car" as if it were a new scene and moved the existing car): edits passed 0.84 in the pipeline although the edit step alone passed 1.00. `prompts/refine.md` now judges a change request only on the change. Pipeline edit pass 0.84 → 0.95.
5. Benchmark (not app) bugs: the edit checks compared props literally (the solver writes only props that differ from the defaults) and counted the solver's safety walls as added items, so every edit of a hand-made scene failed "keep the others"; case d14 allowed 1 new item where raising a ramp honestly needs 2 books. Fixed in `score.mjs` / `cases/text.json`.

## 2. How it was measured

- **Runner:** `ai/bench/run.mjs` (node, no new dependencies). Every model call goes through the app's own `ai/steps.mjs` (real prompts, catalog digest, payload checks, validators and the one repair turn) with ONE route per candidate config (no fallbacks: a failure counts as a failure), over HTTP/1.1 (`ai/research/fetch-h1.mjs`: Node's fetch queues parallel calls on one HTTP/2 connection), at most 6 calls in flight.
- **Every answer is built and run**: plan → `web/ai/solver.js` → the engine (`web/sim` + the engine bundle in worker threads; byte-identical tracks to `POST /api/simulate`, checked) → `ai/bench/score.mjs` (schema, catalog validity, honesty of `missing`, counts, 17 relation kinds on the solved geometry, overlap warnings, 14 outcome kinds read from the physics track, edit checks; ground-truth pictures also by type/family F1, Kendall τ of the left-right order, position and true-size error). "Pass" = every hard check holds; "det. score" = the weighted mean of all checks (0..1).
- **Real renders**: each solved scene is rendered with the app's own critique camera (`web/ai/shot.js`: view3d, Wide camera, start + end + a goal close-up, 1024×576) in a headless Chromium (Metal GPU) on the local server. Refine sees exactly these pictures, as in the app; so does the judge.
- **Blinded judge** (`ai/bench/lib/judge.mjs`): the request (and the reference picture with the author's description of it), the case rubric, the built scene's items with true outline boxes, the run (events, goals), the honesty report and the renders; never the model, prompt or config, nor the plan's reasoning text. Two judges from different families score the comparisons: **Claude Opus 5.5 (high)** and **GPT-6 Astra (high)**. Gemini 4 Argon was tried and dropped: on the smoke test it gave 7 on every sub-score of both results and listed no issues, where the other two gave 9–10 with specific issues. Scores are 0–10 with anchors; `rubric_met` is a yes/no on the case rubric.
- **Latency** = the step's own wall time for one call (including a repair turn when one was needed), with 6 calls in flight, p50/p90 over the cases. Cost and tokens from the gateway's usage block (prompt caching included: a plan call with the 40k-token catalog costs ≈$0.21–0.34 when it writes the cache and ≈$0.02–0.09 when it reads it, on all three Opus routes).
- **Eval set** (`ai/bench/cases/text.json`, `images/index.json`): 25 text requests (simple, chains, stacking, everyday, vehicles, mechanisms, sizes/materials, vague, impossible) + **19 edit cases** (5 before + 14 written for this benchmark: question-only, move, resize, retime, add, remove, swap, start over, conversation references, on hand-made and plan-built scenes; each has a hand-made reference answer that passes, `tools/make-edit-references.mjs`) + 40 pictures (10 generated photos, 4 sketches, 26 renders of 18 ground-truth scenes; the 26-picture "core" set is used for everything downstream). Train/held-out split: `cases/split.json` (stratified; a scene's two camera angles on the same side).

## 3. The judges

| | n | Spearman | mean Astra − Opus | on Claude-made | on Gemini-made | on OpenAI-made |
|---|---|---|---|---|---|---|
| plan + edit + downstream comparisons | 511 | 0.84 | +0.85 | +0.93 | +0.73 | +0.85 |
| whole pipeline (before/after) | 140 | 0.73 | +0.76 | | | |

The two judges agree well (Spearman 0.84). Opus is the stricter one (≈0.85 lower on the same results). **No self-preference**: Opus is *harsher* on Claude-made results than Astra is (gap 0.93 vs 0.73–0.85). Each judge correlates 0.65–0.67 with the deterministic score, so they add information instead of repeating it. Not calibrated against human labels (§10).

## 4. Plan (25 text requests, the plan step alone: solved and run, no refine, no tune)

| route | effort | n | ok | repaired | det. score | pass | judge Astra | judge Opus | p50 s | p90 s | out tok | $/call |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| claude-group/claude-opus-5-5 | medium | 25 | 25 | 0 | 0.968 | 0.80 | 8.32 | 7.16 | 15.5 | 32.6 | 1707 | 0.043 |
| claude-group/claude-opus-5-5 | high | 25 | 25 | 0 | 0.963 | 0.76 | 8.16 | 6.96 | 21.8 | 52.5 | 2520 | 0.066 |
| claude-group/claude-opus-5-5 | low | 25 | 25 | 1 | 0.946 | 0.68 | 8.12 | 7.00 | 8.4 | 22.6 | 1039 | 0.030 |
| claude-group/claude-fable-5-1 | high | 25 | 25 | 0 | 0.970 | 0.80 | 8.80 | 7.68 | 26.7 | 102.8 | 3097 | 0.186 |
| claude-group/claude-sonnet-5-5 | high | 25 | 25 | 1 | 0.975 | 0.84 | 8.32 | 7.28 | 15.0 | 63.2 | 2921 | 0.037 |
| gemini-group/gemini-4-argon | high | 25 | 25 | 0 | **0.981** | **0.92** | 8.76 | 7.56 | 71.5 | 211.3 | 8544 | 0.149 |
| openai-group/gpt-6-astra | high | 25 | 25 | 0 | 0.970 | 0.84 | 8.52 | 7.28 | 48.0 | 129.2 | 2354 | 0.157 |
| openai-group/gpt-6.1-sol | high | 25 | 25 | 0 | 0.972 | 0.84 | 8.32 | 7.24 | 34.4 | 99.7 | 2215 | 0.027 |

Opus 5.5 effort, repeated (2 samples × 25 cases, original prompt): **high** det. 0.963/0.958, pass 0.76/0.80, judge 6.96/7.12, p50 22 s; **medium** 0.968/0.966, 0.80/0.76, 7.16/7.36, p50 15.5 s; **low** 0.946/0.946, 0.68/0.72, 7.00/7.20, p50 9 s. → medium.

Opus 5.5 routes, same 8 cases, medium: `claude-group` p50 21.1 / p90 36.2 s, $0.050; `aws-bedrock/global` 26.5 / 78.6 s, $0.159; `microsoft-foundry-quark` 26.8 / 75.6 s, $0.136; equal scores (det. 0.94–0.95, pass 0.62 on these harder cases). All three cache the catalog. → `claude-group` primary, Bedrock as the same-model fallback (an independent backend; the probe found Foundry and Bedrock equally reliable).

**Where the evidence disagrees with the preference.** On the plan step alone, **Gemini 4 Argon (high) scored best** (det. +0.013, pass +0.12, judges +0.4 over Opus-medium with the original prompt): it failed only the two hardest goal cases. It is also **4.6× slower at p50 and 6.5× at p90** (71 s / 211 s; up to 283 s, with 18–25k reasoning tokens on the chain cases), and its gateway route had 502s in the probes. Fable 5.1 (high) matched it on the judges at 4× Opus's cost and 3× its p90. After the prompt optimisation (§8) Opus-medium reaches det. 0.976, pass 0.86–0.88, judge(Opus) 7.74 (Argon was not re-run with the new prompt, so this is not a like-for-like comparison). In the whole pipeline the refine + tune loop closes most plan-only gaps. Opus 5.5 medium stays the pick; Argon is the candidate to re-test if plan quality ever matters more than 1–3 minutes of waiting. Fallback: GPT-6.1 Sol (high) — same pass rate as Sonnet/Astra, 34 s p50, $0.027, a different backend.

## 5. Observe (pictures)

Direct quality against ground truth (26 renders of 18 known scenes: an observed object matches a true item by box IoU ≥ 0.3, or a group box covering it; `ai/bench/lib/observe-metrics.mjs`), and **downstream**: the same Opus-medium planner builds each of the 26 core pictures from that observation + the picture, and the built scene is scored and judged. "none" = no observe step at all (the planner reads the picture itself).

| route | effort | ok | repaired | recall | mIoU | group counts exact | p50 / p90 s (1st answer) | down. det. | down. pass | judge Astra | judge Opus | type F1 | size err | $/call |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| claude-group/claude-opus-5-5 | low | 40/40 | 5 | 0.98 | 0.70 | 14/18 | **14.9 / 19.1** | 0.961 | 0.88 | 7.46 | 7.00 | 0.91 | **0.05** | 0.046 |
| claude-group/claude-opus-5-5 | **medium** | 40/40 | 11 | 0.92 | 0.66 | 14/18 | 27.8 / 37.6 | 0.957 | 0.96 | 7.31 | 6.73 | 0.92 | 0.08 | 0.083 |
| claude-group/claude-opus-5-5 | high | 40/40 | 13 | 0.96 | 0.66 | 15/18 | 33.3 / 44.2 | – | – | – | – | – | – | 0.103 |
| gemini-group/gemini-4-argon | low | 40/40 | 7 | 0.99 | 0.70 | 14/18 | 29.8 / 82.9 | 0.970 | 0.92 | 7.56 | 7.19 | 0.94 | 0.06 | 0.035 |
| gemini-group/gemini-4-argon | high | 40/40 | 9 | 1.00 | 0.68 | 16/18 | 67.1 / 107.9 | – | – | – | – | – | – | 0.068 |
| openai-group/gpt-6-astra | medium | 39/40 | 6 | 0.96 | 0.67 | 14/18 | 34.4 / 47.8 | 0.931 | 0.81 | 7.35 | 6.81 | 0.88 | 0.15 | 0.139 |
| openai-group/gpt-6.1-sol | medium | 39/40 | 4 | 0.96 | 0.68 | 13/18 | 35.2 / 42.9 | 0.954 | 0.85 | 7.44 | 7.12 | 0.93 | 0.09 | 0.026 |
| gemini-group/gemini-3.8-flash | low | 38/40 | 11 | 0.94 | 0.70 | 12/18 | 8.5 / 10.7 | 0.922 | 0.85 | 7.27 | 6.77 | 0.90 | 0.06 | 0.008 |
| no observe step | | | | | | | 0 | 0.974 | 0.92 | 7.68 | 7.31 | 0.94 | 0.20 | – |

(Repairs and failures are from before the validator fix of §1.2: Astra, Sol and Flash's failures were a 62-character colour and boxes on a 0–1000 scale. Latency is the first answer, i.e. without the repair the fix now avoids.)

- On these clean renders **every frontier model finds everything** (recall 0.92–1.00, mIoU 0.66–0.70): the research's caveat holds, the direct metrics saturate. Argon was not clearly better downstream (+0.009 det., +0.1/+0.19 judge over Opus-low, the same size error, 2× slower with a 4× longer tail), so the preference holds: **Opus 5.5**.
- **Effort, decided end to end.** Downstream with one sample, low looked as good as medium (and faster), so the first shipped pipeline observed at low. The whole-pipeline runs then showed a consistent gap on the 26 picture cases, two runs each, with the shipped prompts:

  | observe effort | det. | pass | judge Opus / Astra | true-size error | build time p50 / p90 | observe call p50 |
  |---|---|---|---|---|---|---|
  | low | 0.975 | 0.90 | 7.69 / 8.12 | 0.07 | 47.7 / 80.5 s | 15.0 s |
  | **medium (shipped)** | **0.994** | **0.96** | **7.73 / 8.23** | 0.10 | 58.6 / 116.4 s | 26.9 s |

  The clearest case: with low effort's observation the planner dropped the spring launcher's 45° support plank in 6 of 6 tries (it then stood tilted on the table and fired the wrong way); with medium, with Argon, Sol or Astra, or with no observation at all, the plank was there. Train and held-out agree (train pass 0.96 vs 0.88, held-out 0.96 vs 0.93), so medium it is: +11 s on a picture build buys fewer wrong scenes.
- **The observe step adds little that the planner could not get from the picture itself**: without it (the planner reads the picture), downstream det./pass/judges were as good, except true sizes (size error 0.20 vs 0.05–0.08). It is kept: sizes matter for "rebuild this exactly", and its counts and `uncertain[]` feed the report. A quick-build variant that skips observe would save ≈27 s per picture build at a measured cost in size accuracy only.

## 6. Refine (one critique round on stored states: 25 text plans + 26 picture builds; patches applied, re-solved, re-run, re-rendered)

| route | effort | states | ok | mean Δ det. | failing states fixed | passing states broken | Δ judge (Opus) | done rate | p50 s | p90 s | $/call |
|---|---|---|---|---|---|---|---|---|---|---|---|
| claude-group/claude-opus-5-5 | **medium** | 51 | 51 | +0.010 | **4/6** | 1 | +0.55 | 0.63 | 10.4 | 28.4 | 0.055 |
| claude-group/claude-opus-5-5 | low | 51 | 51 | +0.010 | 1/6 | 3 | +0.43 | 0.63 | 5.6 | 15.9 | 0.041 |
| claude-group/claude-sonnet-5-5 | medium | 51 | 51 | +0.011 | 0/6 | 1 | +0.37 | 0.45 | 4.6 | 9.7 | 0.020 |
| gemini-group/gemini-4-argon | low | 51 | 51 | +0.014 | 2/6 | 0 | +0.59 | 0.53 | 10.2 | 38.7 | 0.029 |
| gemini-group/gemini-3.8-flash | low | 51 | 48 | +0.010 | 2/6 | 1 | +0.27 | 0.44 | 5.1 | 13.9 | 0.013 |
| openai-group/gpt-6-astra | medium | 51 | 51 | +0.012 | 1/6 | 1 | +0.65 | 0.57 | 9.5 | 22.1 | 0.076 |
| openai-group/gpt-6.1-sol | medium | 51 | 51 | +0.010 | 0/6 | 0 | +0.43 | 0.57 | 8.0 | 22.4 | 0.015 |

Every critic improves the judged result by about half a point in one round. What separates them is fixing real failures without breaking working scenes: **Opus-medium fixed 4 of the 6 failing states** (the Rube Goldberg ending, the phone onto the pillow, the cereal-box row, a photo build) and broke 1 of 45. **A faster model for rounds 2–3 is not worth it**: Sonnet-medium (the fastest) would save ≈6 s per round at p50 but fixed 0 of 6 and gained 0.18 less judge; Opus-low saves ≈5 s but broke 3 working scenes. The quality loss is not small, so every round stays on Opus-medium. Fallback: Gemini 4 Argon (low), the only other critic that fixed failures without breaking anything.

## 7. Edit (19 edit cases: the edit step, applied as the app applies it, solved, run)

| route | effort | n | ok | repaired | det. score | pass | judge Astra | judge Opus | p50 s | p90 s | out tok | $/call |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| claude-group/claude-opus-5-5 | **low** | 19 | 19 | 0 | 0.990 | **1.00** | 9.05 | 8.32 | **3.7** | **9.7** | 372 | 0.018 |
| claude-group/claude-opus-5-5 | medium | 19 | 19 | 0 | 0.982 | 0.95 | 9.16 | 8.37 | 6.8 | 13.0 | 598 | 0.023 |
| claude-group/claude-opus-5-5 | high | 19 | 19 | 0 | 0.974 | 0.89 | 9.21 | 8.32 | 7.6 | 15.3 | 726 | 0.035 |
| claude-group/claude-sonnet-5-5 | low | 19 | 19 | 1 | 0.989 | 0.95 | 8.89 | 7.84 | 4.0 | 6.6 | 347 | 0.014 |
| claude-group/claude-haiku-5-5 | low | 19 | 19 | 0 | 0.989 | 0.95 | 9.00 | 7.95 | 3.7 | 10.1 | 612 | 0.001 |
| openai-group/gpt-6.1-sol | low | 19 | 19 | 0 | 0.994 | 0.95 | 9.53 | 8.42 | 11.0 | 14.4 | 138 | 0.008 |
| gemini-group/gemini-3.8-flash | low | 19 | 19 | 0 | 0.973 | 0.84 | 8.42 | 7.58 | 3.2 | 10.8 | 284 | 0.007 |

With the catalog prompt cached, Opus-low answers an edit as fast as Haiku and Flash, so there is no speed case for a separate quick-edit model. More effort made edits worse: on "add a dog that chases the car" Opus-medium/high moved the user's car to make room; on "make the ramp steeper" they rebuilt more than asked. GPT-6.1 Sol (low) is the different-family fallback (the best judge scores, 3× slower).

## 8. Prompt optimisation

Train / held-out: 13 / 12 text requests and 12 / 14 core pictures (`cases/split.json`). Every change was decided from TRAIN results and judge comments only; held-out numbers were read only as totals. The model and effort were fixed (plan: Opus-medium; observe: Opus-low, its plan downstream Opus-medium with the original plan prompt). Rounds with two samples are averaged; identical repeats differ by about ±0.015 det., ±0.08 pass and ±0.3 judge, so smaller differences are noise. The variants: `ai/bench/prompts/` (README there).

**Plan prompt** (det. / pass / judge Opus):

| round | samples | train (13) | held-out (12) | p50 / p90 s | out tok |
|---|---|---|---|---|---|
| r0 (original) | 2 | 0.959 / 0.73 / 7.46 | 0.976 / 0.83 / 7.04 | 15.6 / 33.6 | 1707 |
| r1 | 1 | 0.983 / 0.92 / 7.69 | 0.957 / 0.67 / 6.58 | 15.3 / 32.0 | 1575 |
| r2 | 2 | 0.979 / 0.92 / 7.77 | 0.972 / 0.83 / 7.46 | 15.8 / 51.7 | 2050 |
| **r3 (shipped)** | 2 | **0.985 / 0.88 / 8.12** | 0.966 / 0.83 / 7.33 | 15.6 / 50.0 | 2130 |

- **r1** (from train failures): the pulley lift's own cup was reported "missing" (m3); a basketball rolled off an invented shelf instead of being dropped (m5); books propped side by side instead of stacked (e1); a golf ball placed on a seesaw's slope rolled away (c1). Added: parts of a catalog item and part-missing things ("a glass of water": the glass exists) are not missing; "drop X" means held above; nothing waits on a slope unless held; same-kind supports are stacked; how a thing gets INTO a container. Train +0.19 pass, but held-out fell: its "fewest items" rule also thinned open requests ("something fun with balls" got one ball). Disclosure: this was noticed from the held-out total and one held-out case's failed check, so r2's open-request clause is mildly test-informed.
- **r2**: "fewest items" narrowed to "keep the request's own events"; N requested stages = N distinct mechanisms (c1 had 3 stages for "at least four"); open requests lively; and the seesaw's real behaviour (g2's catapult threw its ball backwards, away from the target). Checked in the engine first: in all 4 test setups the ball flies up and back over the pivot towards the struck side. Both splits up; held-out back to baseline pass with +0.42 judge.
- **r3**: three more engine-checked facts from train failures (c1/g2 "the last domino lands on the ball"; m5; e1): a toppling domino only nudges a ball beside it (measured 0.16–0.25 m/s; it falls off a ledge only from within 1 cm of the edge); a ball dropped off-centre on a trampoline is thrown outwards (10 cm off-centre from 1.3 m: lands 0.8 m away; on the centre it bounces straight up); landing ON a target needs the slide to end at or above its top; plus the safety walls in `_world.md`. Best train judge (+0.66 over r0) and det.; held-out stays above r0 on the judge (+0.29) with the same pass. **Shipped.** Cost: longer thinking on the hard cases, p90 34 → 50 s (p50 unchanged).

**Observe prompt** (direct on the gt renders: recall / mIoU / group counts exact · downstream: det. / pass / judge Opus / size error):

| round | train direct | train downstream | held-out direct | held-out downstream | repaired | p50 / p90 s |
|---|---|---|---|---|---|---|
| obs-r0 (original) | 0.97 / 0.71 / 4/5 | 0.955 / 0.75 / 6.92 / 0.04 | 1.00 / 0.80 / 3/3 | 0.971 / 1.00 / 7.29 / 0.08 | 4/26 | 15.4 / 27.3 |
| obs-r1 | 0.90 / 0.63 / 4/5 | 0.940 / 0.79 / 6.54 / 0.07 | 1.00 / 0.79 / 2/3 | 0.977 / 0.86 / 7.32 / 0.16 | 0/26 | 13.7 / 16.7 |
| obs-r2 | **1.00 / 0.71 / 5/5** | 0.953 / 0.79 / **6.88** / **0.03** | 1.00 / 0.80 / 2/3 | 0.969 / 0.93 / 6.96 / 0.08 | 1/26 | 14.8 / 17.2 |
| obs-r3 | 0.97 / 0.68 / 3/5 | 0.957 / **0.88** / 6.58 / 0.04 | 1.00 / 0.79 / 3/3 | 0.966 / 0.93 / 7.29 / 0.08 | 2/26 | 15.3 / 19.4 |

(Observations once per round, the downstream plan twice; "repaired" and the latency drop from r0 are the validator fix of §1.2, not the prompt.)
- **obs-r1** (from train observations): plain dominoes called "wooden blocks"; growing dominoes and colourful sketch dominoes listed one by one; a ball waiting on a ramp called "resting"; a pendulum reported as five parts. Added role names (dominoes with or without pips, ramp, pendulum, seesaw), "a mechanism is ONE object", same-kind groups regardless of colour, `held` for things that cannot stay put, the sandbox's own render as a scale. Counts improved, but merging mechanisms swallowed their supports (the conveyor's legs, the launcher's plank) and sizes got worse.
- **obs-r2**: r1 without the merging rule and without the scale cue; sizes are of the thing itself, without its stand. Best train direct metrics (all items found, all group counts exact) and train downstream judge and sizes.
- **obs-r3**: r2 + a likely kind for each ball and, in `notes`, which way tilted or aimed things point. On train it recovered the spring launcher's 45° support plank in both downstream samples (missed by every r0–r2 sample: the launcher stood on the table and fired the wrong way), train pass +0.09, but judge −0.3 and two group counts slipped.

**Observe pick: obs-r2.** It had the best train direct metrics (every item found, every group count exact) and the best train downstream judge and sizes; obs-r3 had the better train downstream pass. To settle it on the product path, the whole shipped pipeline ran the 26 picture cases with obs-r3 and twice with obs-r2: on train, obs-r3 passed 0.75 (judges 7.17 / 7.67) against 0.83 and 0.92 (7.50 / 7.83 and 7.25 / 7.71) for obs-r2, and it did not keep the spring launcher's plank either. obs-r2 is shipped. The observe prompt's gains are modest (the renders saturate the direct metrics); the bigger observe win was the validator fix (repairs 4/26 → 0–1/26, p90 −10 s) and, end to end, the effort (§5).

## 9. Remaining weaknesses (from the shipped pipeline runs; input → output → what is wrong)

Each line: the request → what the shipped pipeline built → what is wrong (the check that failed, or the judges' words). Renders of several are in `ai/bench/results/examples/`.

1. **A domino row that must push a ball onward stalls.** "Build a Rube Goldberg machine with at least four stages that ends with a ball dropping into a cup" (c1) → pendulum → wooden ball → growing dominoes on a shelf → golf ball at the shelf's end → ramp → cup → the golf ball "is pinned under the last fallen domino at the top of the ramp", top speed 0.3 m/s; the cup stage never fires (judges 3 / 5; refine scored it 5 twice, the tuner tried 33 runs without a knob that moves the ball to the edge). The plan prompt now states the engine-checked rule (a domino only nudges a ball; within 1 cm of the edge or nothing), but the planner still places the ball a few cm in. *Next fix:* a solver placement "at the edge of" (`right_of` the support's end with gap 0) or a tune knob on that ball's x. (`examples/shipped-c1-rube-cup-end.jpg`)
2. **A physics glitch at a ramp-to-ramp hand-off.** "A marble rolls down two zig-zag ramps, knocks over a row of dominoes, and the last domino pushes a ball off a ledge into a bucket" (c2) → a 2.5 cm marble on a 4 cm-thick upper ramp drops onto the lower ramp (which ends on the domino shelf) at 1.48 s, then the run records a top speed of 30.9 m/s for it and it never reaches the dominoes: 0 of 10 fall (judges 3 / 5). The solved scene has no overlap warnings, so this looks like the engine ejecting or tunnelling a small fast ball at the drop, not a placement error; refine tried twice and the tuner 40 runs. *Next step (engine owners):* reproduce from `ai/bench/results/final/pipeline-shipped/app/c2-marble-zigzag.json` (its `scene`). (`examples/shipped-c2-marble-zigzag-start.jpg`)
3. **Mirrored seesaws.** "Build this setup from the photo" with a seesaw whose LEFT end is down (photo-seesaw-catapult, sketch-seesaw-catapult) → the scene is built mirrored (ball on the right, weight over the left) because the catalog's seesaw only tilts down to the right; the target stays where the picture had it, now on the wrong side, and the mirroring is not reported (judges 5–7 / 6–7). *Next fix:* a `flip` (or negative `tilt`) prop on the seesaw in the catalog; until then the plan prompt could say "mirror the whole scene and report it". (`examples/reference-photo-seesaw-catapult.jpg` vs `examples/shipped-photo-seesaw-catapult-start.jpg`)
4. **Rolling into a standing cup.** "Build what this sketch shows, and make it work" (sketch-ramp-cup) → ramp, ball, cup on the table past the ramp's foot → "the ball rolls down, hits the cup's side at 1.74 m/s and bounces back" (judges 4 / 5). The new container rule in the plan prompt fixed this in text requests, but with a picture the planner copies the drawn layout (cup on the ground) instead of making it work, and refine called it done. (`examples/shipped-sketch-ramp-cup-end.jpg`)
5. **Unreported substitutions in picture builds.** photo-board-bucket-34: a cutting board built as a 63 cm plank (the photo's is ≈40 cm), a paperback built as a hardcover, the bucket 27 cm off the board's foot (det. fail: no cutting board; judges 7 / 7); photo-seesaw-catapult: a 6.5 cm plastic ball labelled "white ball" for a 4 cm ping-pong ball. The honesty rules hold for text requests (the shipped run has no false or missing "missing" entries; an earlier run had one over-cautious "a hand to tip the first domino"), but in picture builds a stand-in of a different kind or size is not always reported.
6. **The critic can still override an edit's "keep".** "Add a dog that chases the car" (d4, on the car-ramp-dominoes scenario) → a motor car stands in for the dog (reported honestly), but refine moved the user's toy car 16 cm down the ramp "since it is the thing being chased" (fails "the car stays as it was"; judges 8 / 8). The new refine rule fixed 2 of the 3 edit regressions; this one it reasoned around. *Next fix (outside this task's files):* the orchestrator could tell refine it is an edit and pass the ids the edit changed, so the validator itself rejects patches to other items. (`examples/shipped-d4-car-dog-start.jpg`)
7. **Stack vs side by side.** "A phone slides down a cutting board propped up on two books and stops on a pillow" (e1) → the books are stacked in 3 of 7 runs with the new plan prompt (0 of 3 with the original), and in the shipped run they stand side by side (fails "stack ≥ 2"); the phone ends against the pillow's edge rather than on it (judges 8 / 7).
8. **A picture's parts and kinds can still go wrong.** gt-spring-launch with low-effort observation: the 45° plank under the launcher was never built (6/6; `examples/reference-gt-spring-launch.jpg` vs `examples/shipped-gt-spring-launch-start.jpg`). With medium effort (shipped) the plank is there and the checks pass, but in one of two runs the launch only nudges the ball (1.6 m/s) and in the other a ping-pong ball silently replaces the pictured golf ball (judges 5–6 / 5–7). Mirrored seesaws (#3) and the rolling-into-the-cup layout (#4, 1 of 2 runs) also persist with medium effort; photo-board-bucket-34 gets unrequested boxes under the ramp.
9. **A goal "met" by a fluke.** "A spring launcher shoots a golf ball over a wall of three stacked bricks into a cup" (m6) → the tuner made the goal pass, but the ball "overshoots, hits the table, bounces off the invisible right safety wall and rolls into the cup at 0.29 m/s" (judges 5 / 7). The tuner optimises "ends in the cup", not "flies into the cup"; a goal kind that requires the first landing inside would close this.

Also: the plan prompt's extra rules lengthened Opus's thinking on hard chains (plan p90 34 → 50 s on the plan-only runs), and the catalog changed under the benchmark once (another agent's web/sim edit at 13:46 UTC added 167 characters to the digest; it affected the last pipeline runs only).

## 10. Caveats

- Small n: 25 text, 26 pictures, 19 edits. Model comparisons are one sample per case (Opus's efforts two); identical repeats move det. by ±0.015, pass by ±0.08 and the judge by ±0.3, and single cases flip. Rankings inside those bands are ties.
- The photos and sketches are generated pictures with known descriptions, and the ground-truth pictures are the app's own renders: real phone photos (clutter, glare, perspective) will be harder, and the observe ranking may change there (the research ranked Argon first on real-photo detection).
- The judges were not calibrated against human ratings; they agree with each other (0.84) and with the checks (0.65), and show no own-family bias, which is as far as this run can check.
- The plan, refine and edit comparisons measure one step at a time; only the pipeline runs measure the whole loop, and those are single samples.
- Latency was measured with 6 calls in flight from one machine on 15 Oct; the gateway's load varies by hour (the probes saw Argon at 7–22 s on one task).
- `claude-group` resolves to anthropic-primary: a Bedrock fallback protects against that backend failing; the third fallback is a different family.

## 11. Reproduce

```
zsh -c 'source ~/.config/truefoundry/env && node ai/bench/run.mjs plan --run main --configs opus-medium,argon-high'
zsh -c 'source ~/.config/truefoundry/env && node ai/bench/run.mjs observe --run main --configs opus-low'
zsh -c 'source ~/.config/truefoundry/env && node ai/bench/run.mjs downstream --run main --obs opus-low,none --planner opus-medium --core'
zsh -c 'source ~/.config/truefoundry/env && node ai/bench/run.mjs refine --run main --from main/plan/opus-medium --configs opus-medium,sonnet-medium'
zsh -c 'source ~/.config/truefoundry/env && node ai/bench/run.mjs edit --run main --configs opus-low,sol-low'
zsh -c 'source ~/.config/truefoundry/env && node ai/bench/run.mjs pipeline --run final --routing ai/models.json --tag shipped --images --core --edits'
zsh -c 'source ~/.config/truefoundry/env && node ai/bench/run.mjs judge --run main --phase plan --judges opus-high,astra-high'
node ai/bench/run.mjs report --run main --by-split --detail          # tables + per-case lines (no model calls)
node ai/bench/run.mjs rescore --run main                             # re-score stored answers after a case or scorer change
node ai/bench/tools/selftest.mjs                                     # 243 checks: references pass, mutations fail, round trips, validators, hard ground-truth checks
node ai/bench/tools/compare-pipelines.mjs "base=ai/bench/results/ab3/pipeline-base/app" "new=ai/bench/results/ab3/pipeline-new/app"   # §12 tables
python3 ai/bench/tools/tables.py plan                                # the tables of sections 4-8 (plan | rounds | orounds | edit | refine | observe)
```
Prompt variants: `--prompts ai/bench/prompts/<variant>`. Renders go to `$BENCH_RENDER_DIR/<run>/` (default `ai/bench/results/<run>/renders/`; this run kept them outside the repo, a few examples are in `ai/bench/results/examples/`).

## 12. Repair round (15 Oct, afternoon): every stated outcome checked, faithfulness to pictures, streaming, a queue instead of "busy"

**What changed on the server side** (the review's 16 findings; details in `ai/DESIGN.md` "Server AI core"):
- **Goals of every kind** (`ai/goals.mjs`, `schemas.mjs`, `_plan_format.md`): `falls {item | items}` (counted per rigid body: a weld group, so 10 bowling pins of 6 welded parts read "8 of 10 fell", not 60; hinged parts and a car's wheels are left out; each body fell when it turned past its own tipping angle, atan(base/height) of its outline at the start + 5° within 20–85°, or was knocked down by at least half its smaller side, which does not apply to bodies on wheels), `hits {item, target, before_s?}`, `moves {item, min_m}`, besides `in`. The refine step checks every goal on its own run of the solved scene (about 0.2 s), shows the critic MET / FAILED with numbers, returns them as `goals`, and caps the score at 7 while a stated goal fails.
- **Faithfulness**: a plan built from pictures must account for every observed object in `covers` (a soft check that gets one repair turn and never costs a build). A "make it work" picture whose story ends in a container needs that `in` goal. Plans list `differences`. The critic gets an object-by-object **reference checklist** (`COUNT DIFFERS` / `SIZE DIFFERS`), which skips parts of one item, rows seen one by one, hung bobs and sketches. Refine may not change a requested thing's material. The catalog digest gained `Looks:` lines (the paperback is dark blue, not cream) and a wedge-direction note. Prompts now cover the user's language everywhere, left/middle/right as thirds of the table, varied open requests that keep what they name, undo requests, unknown items, and stale names (a name with a changed number is renamed by the validator).
- **Routing**: the patch cap is 150, with `ids` for one change to many items. The plan timeout is 300 s per attempt. Every step streams, with a 90 s no-progress cut, and `GET /api/ai/progress` reports it. The local server runs 8 steps at once and queues the rest first come, first served for 90 s before a 429 with Retry-After.
- **Bench**: hard ground-truth checks (fitted scale within 20 %, per-item size error ≤ 0.25, exact unit counts per type), hard depicted outcomes for "make it work" pictures, and the refine delta on ground-truth metrics.

**How it was measured.** This is a same-time A/B, because the gateway's speed changes by the hour: the morning's stored runs had observe at p50 15 s, while both arms here measured 27 s. The **base** arm is a copy of `ai/` with every server-side file put back to its pre-repair version from `research/*-before-ai-repair*` (schemas, steps, core, cli, digests, models.json, the 8 prompts). The **new** arm is the repo. Both arms ran the same frozen browser pipeline (`research/ai-orchestrator-before-ai.js` and `ai-solver-before-ai.js`, through `--client`), the same strict scorer, and the same 70 cases. Each arm ran 2 times, launched together, with at most 15 calls in flight. Results are in `ai/bench/results/ab2|ab3/pipeline-{base,new,new-rep}/`.

| 2 runs × 70 cases per arm | pass | det. score | time p50 / p90 | refine rounds | $ per build | GT size err | GT hard pass |
|---|---|---|---|---|---|---|---|
| base (before the repair) | 0.84 | 0.987 | 42.1 / 85.3 s | 1.21 | 0.151 | 0.082 | 0.58 |
| **new** | **0.89** | **0.994** | 43.9 / 104.9 s | 1.39 | 0.157 | **0.067** | **0.67** |
| · text (25) | 0.90 → **0.96** | 0.989 → **0.997** | 25.1 / 76.7 → 27.4 / 113.3 s | 1.22 → 1.44 | 0.146 → 0.129 | | |
| · pictures (26) | 0.73 → **0.79** | 0.985 → **0.993** | 62.8 / 93.7 → 75.1 / 123.5 s | 1.23 → 1.50 | 0.208 → 0.246 | 0.082 → 0.067 | 0.58 → 0.67 |
| · edits (19) | 0.92 → 0.92 | 0.987 → 0.990 | 11.2 / 46.5 → **10.5 / 41.6 s** | 1.18 → 1.16 | 0.079 → 0.071 | | |

How to read it:
- **Quality is up everywhere it can be measured.** Text pass rose 0.90 → 0.96 and picture pass 0.73 → 0.79. Pictures got closer to ground truth: hard checks 0.58 → 0.67, size error 0.082 → 0.067.
- **gt-car-ramp-dominoes**, the review's own example, now passes. The checklist showed the critic "car 30 cm, ramp 1.6 m against about half that", so it put the car back to its true 20 cm and shortened the ramp. Ground-truth seesaw and vehicle cases also pass more often.
- **The cost is time on picture builds:** +12 s at p50 and +$0.04 per build. The plan step takes +3 s, because `covers` and `differences` make it write more. Refine takes +3 s per build and 1.50 rounds instead of 1.23, because the critic now sees failed `falls`/`hits`/`moves` goals and count or size differences, and acts on them. A few text chains take a third round (text p90 rose 77 → 113 s). Follow-up edits are not slower.
- **The first new arm (ab2) scored worse on pictures (pass 0.65)**, which exposed false alarms that broke good scenes. The checklist compared a sketch's sizes, so the critic resized a weight and a box to a drawing's proportions. The plan used the look-alike wedge, which only slopes down to the left, and mirrored a whole chain. "The car rolls into the cup and shoves it" was read as a landing, and naming the table in `covers` triggered a repair turn. A "falls" goal called a collapsed tower "2 of 3 tipped" because cubes land flat. A finished domino cascade, leaning at 44°, read as "2 of 6". All of these are fixed and tested in `ai/test/schemas|steps|goals.test.mjs`. ab3 is the fixed version (only the tipping-angle rule came after it).
- **Observe effort, measured again end to end** (pictures, 1 run at low effort against the new arm's 2): low is 24 s faster (p50 51 s against 75 s). It is worse on everything else: pass 0.69 against 0.79, det. 0.980 against 0.993, hard ground-truth pass 0.58 against 0.67. Observe stays at medium. Re-run with the same prompt at the same hour, the new observe prompt was as fast as the old one (p50 25 s against 27 s) and counted at least as well.

**Live checks** (real gateway, `ai/steps.mjs` directly or through the running server at :8790):
- **Unknown item:** "make the green ball heavier" got `patches: []` and the question "There's no green ball: … Which one should be heavier?".
- **Undo:** "undo isn't working, put everything back" got `undo: true` and a pointer to ⌘Z.
- **Count change:** "use 12 dominoes" sent `set_item {name: "Row of 12 dominoes"}`.
- **Language:** a Spanish request came back with Spanish notes and assumptions.
- **Left / middle / right:** "On the left, a pendulum. In the middle, books. On the right, a bucket." was run 4 times. Each time the pendulum's pivot ended at x 0.70–0.75, the end of the left third, and the books started the middle third. The bucket was in the right third 3 times; once it stood at 1.42 m, and the plan said why: a book knocked off a stack flies only 30 cm.
- **Open request:** "make something satisfying" gave pendulum → billiard ball → growing dominoes → block tower, with 4 goals.
- **40 dominoes and a marble:** two rows (30 + 10) with `falls` goals.
- **Through the server:** refine answered with `goals` (falls 7/7, hits at 1.94 s, a moves goal FAILED at 41 cm of 3 m) and scored 6. The progress endpoint showed waiting → thinking 0…93 tokens → writing 363…653. Edit answered the undo request with `undo: true`.

**Done on the browser side** (the web/ai agent, from these contracts; its tests 74/74): `web/ai/goals.js` is a verbatim copy of `ai/goals.mjs`, used for the card's ✓/✗, the tuner's objective and the stage-loss check, and the solver keeps non-`in` goals in the plan without a "left out" note. Simple edits take a quick path: applied after one physics run, the critic skipped and the tuner run only when a goal stopped working (`report.quick`). `shot.js` adds an "items close-up" crop when the machine is small in the wide shot. Refine gets the `observation` and `sim.final`. The edit answer's `undo` shows an Undo button. Plan `differences` are shown first on the card.

**Confirmation run with the final code (ab4).** After ab3, three more changes went in: falls counted per rigid body, and a deterministic scale anchor in plan.md. The anchor is a thing of standard real size if the picture has one; otherwise every catalog item stays at its default size, and a size changes only where the picture clearly differs by more than about 1.5×. Before this rule, one photo's toy car was "an 18 cm 1:24 model" in one run and 10 cm in another, and a ground-truth car was stretched to 30 cm to match a domino row. The final code ran all 70 cases once (`ab4/pipeline-new`) plus the 26 pictures again (`ab4/pipeline-new-rep`):

| | pass | det. | time p50 / p90 | GT size err | GT hard |
|---|---|---|---|---|---|
| text (25) | **1.00** | 0.996 | 29.1 / 89.2 s | | |
| edits (19) | **1.00** | 0.995 | 17.0 / 38.3 s | | |
| pictures, 2 runs (52) | 0.73 (0.65 and 0.81) | 0.989 | 77 / 120 s | **0.046** | 0.62 |

Over all 4 runs of the new version, pictures passed 79 of 104 (0.76), against 38 of 52 (0.73) for base. One run's failures were not the other's, so the pass rate per run moves by about ±0.08. The size error against ground truth is clearly better: 0.046 for the final runs, against 0.083 for base. Sizes are also steadier across runs of the same photo: photo-ramp-dominoes' ball was 3.5–3.6 cm in all three new runs, against 6 and 4.5 cm in the two base runs. Edit p50 here is 17 s, against 9–12 s in ab3. That is the machine and the gateway in this window, not the code: refine time per edit was the same (6.2 s), but the engine runs and renders took 6–9× longer in total (another agent's performance tests were running) and the gateway's edit call p50 was 5.6 s against 3.4–4.3 s. In the app, the browser's quick path also skips the critique for simple edits; this frozen bench client still critiques every one.

**Remaining weaknesses** (this round):
- **gt-spring-launch** fails in every run of both arms (scale, sizes or the count of the board's legs). The launcher is built about 1.5× the picture's size, and the critic cannot fix it without breaking the launch.
- **Pendulum on a rod or a rope:** the ground truth's `pendulum` draws a thin light-wood rod, which observe reads as "a tan rope". The plan then builds a `rope-pendulum`. They swing the same below 90°, but the hard type count fails.
- **"Make it work" against "count exactly":** photo-board-bucket-34 needs a raised ramp so the balls can drop in. The plan adds two books (it reports them) and so fails the photo's book count; without them the balls hit the bucket's side.
- **Time:** an open request ("something fun with balls", "a cool chain reaction") now plans 3–5 different mechanisms with a finale and a goal each. Opus thinks for 96–138 s on these, against about 20 s for a plain request. Picture builds take one refine round more on average, because the critic acts on count and size differences. The live client's stage-loss check undoes a round that breaks a working stage; the frozen bench client does not have it, so the bench shows the worst case (photo-zigzag-marble: 3 rounds, 236 s).

## 13. Round 2 (15 Oct, evening): a fair queue, supports and stages, a rate-only check, speed, the hosted endpoint, and edits that stay edits

**What changed** (contracts in `ai/DESIGN.md` §13):
- **Queue** (`web/server.py`): 12 steps at once, at most 4 observe / 6 plan / 8 refine / 8 edit; first come, first served among the requests whose step has room; 90 s wait; then 429 `{busy, position, retryAfterMs}` + `Retry-After`; `GET /api/ai/progress?id=` reports `position` and `eta_ms`; a client that hangs up leaves the queue. The AI routes now refuse other sites' pages (Content-Type JSON, Host and Origin of this server). The Vercel twin has the same per-instance queue (§13.7).
- **Prompts**: nothing floats (static things stand on supports: posts, stacks, legs on; `_world.md`, `_place.md`, catalog digest notes); refine never switches legs off in mid-air (the validator also drops such a `legs: false`); chains of 4+ stages carry `stages` (each stage's expectation, its own check and knobs; `set_stages`), the critic is shown each stage's MET / FAILED and told to fix the first failing one; edits keep notes and assumptions; picture builds keep the pictured kinds, colours and sizes or say why in `differences`.
- **Rate-only check** (`refine` with `rate_only: true`, models.json `rate`, effort low): `{score_0_10, issues}`, no patches, the same cached system prompt.
- **Speed**: sketches observed at low effort; the system prompt cached for 1 h; the rate-only final check and a rate-first confirmation round (browser contract, reference diff `research/ai-orchestrator-rate-only.diff`, arm "new+F′" below); edits that are new scenes go on to the plan step; the plan route decides edit-vs-new in parallel with a fresh plan.
- **Edits stay edits** (the user's report, §13.8): `intent` on plan and edit, the edit prompt's patch-vs-new rules, kind swaps that keep place and role, `sim` for "make it work again"; and the chat fields `reply` + `suggestions` (§13.9).

**How it was measured.** Same-time A/B as §12. **base** = `ai/` as it was at 12:58 (before this round), **new** = the repo; every arm runs the same frozen browser pipeline (`web/ai` as of 12:58, through `--client`), the same strict scorer and the same cases. **new+F′** = new with that frozen client plus the 52-line §13.3 change (rate-only final check; a rate-only look before a full critique in rounds ≥ 2 once every goal passes), i.e. what the browser gets when it adopts §13.3. Results: `ai/bench/results/ai2ab` (full A/B), `ai2ed3`/`ai2ed4` (edits), `ai2lat` (latency); base arms under the scratchpad copy of the old tree.

**1. The full A/B** (2 runs × 70 cases per arm, launched together, 6 processes; `--jobs 4 --concurrency 3`, so builds also wait for the bench's own call slots: the totals include those waits for every arm alike; latency is read from table 3):

| kind | arm | n | pass | det. | time p50 / p90 s (incl. bench waits) | plan / edit call p50 s | refine per build p50 s | rounds | $ per build | floating statics (plans) | GT size err | GT hard | errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| text | base | 50 | 0.94 | 0.990 | 44.0 / 142.5 | 16.0 | 9.3 | 1.62 | 0.145 | 12 (8) | – | – | 0 |
| text | new | 50 | 0.96 | 0.993 | 42.1 / 120.3 | 15.7 | 6.6 | 1.52 | 0.140 | 2 (2) | – | – | 0 |
| text | new+F′ | 50 | 1.00 | 0.998 | 39.0 / 117.9 | 18.0 | 7.1 | 1.44 | 0.132 | 2 (2) | – | – | 0 |
| picture | base | 52 | 0.75 | 0.987 | 99.9 / 162.4 | 25.2 | 17.6 | 1.52 | 0.271 | 4 (3) | 0.028 | 0.67 | 0 |
| picture | new | 52 | 0.79 | 0.986 | 98.0 / 154.5 | 26.0 | 13.9 | 1.54 | 0.267 | 0 (0) | 0.055 | 0.71 | 0 |
| picture | new+F′ | 52 | 0.75 | 0.994 | 106.7 / 162.3 | 26.0 | 19.5 | 1.63 | 0.281 | 0 (0) | 0.076 | 0.54 | 0 |
| edit | base | 38 | 0.95 | 0.984 | 9.8 / 46.9 | 3.8 | 0.0 | 0.45 | 0.055 | 1 (1) | – | – | 0 |
| edit | new | 38 | 0.95 | 0.984 | 9.6 / 35.7 | 3.6 | 0.0 | 0.50 | 0.046 | 0 (0) | – | – | 0 |
| edit | new+F′ | 38 | 0.95 | 0.991 | 8.0 / 36.7 | 3.6 | 0.0 | 0.50 | 0.047 | 0 (0) | – | – | 0 |
| all | base | 140 | 0.87 | 0.987 | 64.0 / 145.5 | 17.5 | 10.3 | 1.26 | 0.167 | 17 (12) | 0.028 | 0.67 | 0 |
| all | new | 140 | 0.89 | 0.988 | 66.4 / 135.5 | 17.9 | 7.8 | 1.25 | 0.162 | 2 (2) | 0.055 | 0.71 | 0 |
| all | new+F′ | 140 | 0.89 | 0.995 | 60.8 / 137.4 | 18.2 | 8.9 | 1.26 | 0.164 | 2 (2) | 0.076 | 0.54 | 0 |

- Quality: text pass 0.94 → 0.96 (new) / **1.00** (new+F′), det. 0.990 → 0.993 / 0.998; pictures 0.75 → 0.79 / 0.75 (±0.08 is noise at this n, §10); edits 0.95 everywhere. **Floating static things in the plans: 17 in 12 builds → 2 in 2.** No errors in 420 builds.
- Ground-truth size error moved the wrong way in this window (0.028 → 0.055 / 0.076; 12 gt cases × 2 runs). Its plan bullet ("keep the pictured sizes … widened to 12 cm") was then reworded without the resize example; the latency run below (one run, shipped prompts) measured 0.069 → **0.048** and GT hard 0.50 → **0.67**. Read both as noisy; neither is a clear regression.

**2. The plan prompt alone** (25 text requests, the plan step only, solved and run; base 4 samples, the variants 2 each; plan-only so the effect of the prompt is not hidden by refine and tune):

| prompt | samples | det. | pass | train det. / pass | held-out det. / pass | p50 / p90 s | out tok p50 / p90 | floating statics (plans) | plans with stages |
|---|---|---|---|---|---|---|---|---|---|
| base (12:58) | 4 × 25 | 0.982 | 0.87 | 0.988 / 0.94 | 0.976 / 0.79 | 17.0 / 79.6 | 1570 / 7344 | 33 (21) | 0 |
| ai2-full (with "check each hand-off once …") | 2 × 25 | 0.978 | 0.84 | 0.986 / 0.92 | 0.969 / 0.75 | 15.6 / 61.1 | 1518 / 6212 | 2 (2) | 8 |
| **ai2-nohandoff (shipped)** | 2 × 25 | **0.991** | **0.94** | 0.989 / 0.92 | 0.993 / 0.96 | 16.7 / 59.6 | 1584 / 5951 | **2 (2)** | 7 |

The supports rules removed floating statics (33 → 2) without costing passes; asking for `stages` did not lengthen the slow tail (p90 80 → 60 s). The one speed-motivated sentence ("check each hand-off once with rough numbers; give a close one a knob") was not faster and lost pass, so it was dropped. Disclosure: train alone could not separate the two variants (0.92 both); the choice was read off the held-out totals, so it is mildly test-informed.

**3. Latency without bench waits** (1 run × 82 cases per arm: 25 text, 26 pictures, 31 edits; `--jobs 3 --concurrency 3`, 2 processes = 6 builds in flight; base = old server + frozen client; final = the shipped server and prompts + F′):

| arm | kind | n | pass | det. | p50 / p90 s | observe p50 | plan/edit p50 | refine per build p50 | rounds | $/build | reply ok | GT size err | GT hard |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| base | text | 25 | 1.00 | 0.999 | 31.0 / 85.4 | nan | 16.0 | 7.4 | 1.52 | 0.159 | 0/0 | nan | nan |
| final | text | 25 | 0.96 | 0.994 | 24.1 / 119.0 | nan | 18.6 | 5.1 | 1.24 | 0.125 | 24/25 | nan | nan |
| base | picture | 26 | 0.73 | 0.992 | 77.8 / 111.4 | 27.2 | 24.9 | 26.9 | 1.65 | 0.277 | 0/0 | 0.069 | 0.50 |
| final | picture | 26 | 0.77 | 0.991 | 78.1 / 130.5 | 25.3 | 26.5 | 16.3 | 1.54 | 0.270 | 26/26 | 0.048 | 0.67 |
| base | edit | 31 | 0.87 | 0.959 | 8.5 / 51.4 | nan | 3.9 | 0.0 | 0.74 | 0.084 | 0/31 | nan | nan |
| final | edit | 31 | 0.90 | 0.977 | 11.9 / 38.3 | nan | 4.9 | 0.0 | 0.65 | 0.065 | 30/31 | nan | nan |
| base | all | 82 | 0.87 | 0.981 | 43.9 / 99.2 | 27.2 | 14.9 | 9.3 | 1.27 | 0.168 | 0/31 | 0.069 | 0.50 |
| final | all | 82 | 0.88 | 0.987 | 31.2 / 108.3 | 25.3 | 18.2 | 7.4 | 1.11 | 0.149 | 80/82 | 0.048 | 0.67 |

| target | base | final | |
|---|---|---|---|
| text p50 ≤ 25 s | 31.0 s | **24.1 s** | met |
| text p90 ≤ 75 s | 85.4 s | 119 s | **not met**: three open or chain requests planned for 108–132 s (g1 "something fun with balls" 132 s of plan alone, c1 122 s); one run per case, these swing ±60 s between runs (g1 base 83 s here, 141 s in table 2) |
| picture p50 ≤ 55 s | 77.8 s | 78.1 s | **not met**: observe 25 s + plan 26 s are 51 s before the first run; refine per build fell 26.9 → 16.3 s |
| edit p50 ≤ 8 s | 8.5 s | 11.9 s (edit call 4.9 s) | **not met in this client**: the frozen client critiques every edit that changes a goal; the quick ones (no critique) take 3–6 s, the edit call itself 3.9 → 4.9 s (+~200 output tokens for `why`, `reply`, `suggestions`) |

**Where the time goes** (call p50 inside the pipeline, all arms): observe 25–27 s (≈2.7k output tokens at ≈100 tok/s, half of them thinking), plan 16 s text / 25 s pictures, refine 7 s text / 13 s pictures per call, edit 3.6–4.9 s; the engine, solver and renders under 1 s per build. Output tokens set the time (Opus 5.5 writes 64–100 tokens/s through the gateway); prompt length does not, once cached:
- **Prompt caching** (probes through the gateway): the refine system prompt (10.1k tokens) is written once and read on the next call; a low-effort call reads the medium-effort call's entry (effort does not break the cache); with `ttl: "1h"` the entry was still read after 7 minutes while a 5-minute entry had been written again; the 44k-token plan prompt cold: 2.0 / 3.0 s to the first token, warm: 0.96 / 1.28 s. Bedrock and claude-group both accept `ttl`. Shipped: 1 h on both Opus routes.
- **Rate-only vs a full critique** on the same stored scenes (live): 4.8 → 3.2 s, 5.2 → 6.1 s, 6.5 → 9.7 s when the critic would say done anyway (no gain), but **36.9 → 6.1 s** when it would write patches; same scores (9/9, 9/9, 8/8, 6/6). Hence: rate-only only where a full critique cannot help (the final check, and confirming a round whose patches made every goal pass).
- **Parallel calls**: the plan route's edit-vs-new decision runs beside a fresh plan, so a new scene from a full canvas costs no extra wait (live: 13.6 s for "a pendulum knocks over ten dominoes" with the starter on screen); a change returns as soon as the edit call does (10–12 s).
- **What would still cut picture time**: observe at low effort for photos saves ≈11 s but cost pass twice (0.79 → 0.69, §12); skipping observe saves ≈27 s at 3× the size error (§5). Neither is worth it for "make no mistakes"; a cheaper observation (fewer output fields) is the next thing to measure.

**4. Edits that must stay edits** (the user's report; cases d20–d29 written for it, d30–d31 added alongside: swap ball kinds, taller dominoes, move the box, a material, "same machine but …" wording, add dominoes, make it work again, on the starter, the conveyor and the trampoline; hard checks: untouched items within 5 mm, and the scene's goals still met or the reply says they may not be).

The user's path: the change sent to **`/api/ai/plan` with the scene on screen** (what a client in "new scene" mode does), the answer applied as the client applies it, no refine (`ai/bench/tools/plan-route.mjs`, 2 runs × 16 edit cases):

| server | pass | untouched items changed | answered as an edit | answered as a new scene |
|---|---|---|---|---|
| base | 0.44 | 6 | 0 of 32 (every answer a new plan) | 32 |
| **new** | **0.75** | **0** | 30 (every change) | 2 (both "start over": correct) |

Through the frozen client's own edit path (the client always sends edits with the scene; 2 runs × 31 edit cases per arm; d20–d31 also 2 more runs for base and the staged prompts):

| arm | all 31 edit cases | d1–d19 | d20–d31 (d30 excluded*) | untouched items changed | goal broken and not said | reply check ok |
|---|---|---|---|---|---|---|
| base | 0.90 | 0.92 | 0.91 (4 runs) | 1 | 1 | 0 / 48 (no reply rules) |
| new | 0.90 | **1.00** | 0.82 | 0 | 1 | 62 / 62 |
| new+F′ | 0.90 | 0.97 | 0.86 | 0 | 1 | 62 / 62 |

\* d30 ("move the box 10 cm left") fails in every arm and run: the frozen client's solver lifts the moved box 9–14 cm clear of the seesaw, which the case forbids; the AI's answer is right (dx −0.10). d25 "make it work again" (the box hangs 30 cm too high) is the hardest: 2 of 4 base runs, 1 of 4 new. With the edit prompt's new "make it work" rule the edit step now lowers the box (49 → 30–32 cm) as it should; in the bench client the critic then sometimes undoes it (the critic, unlike the edit step, may not move items the request does not name). Sending `sim` with edits (§13.8) gives the edit step the run's goal results and end positions for exactly these requests. Differences of 1–2 cases per arm are within run-to-run noise.

**Reply and suggestions** (§13.9): in the latency run 80 of 82 builds passed the soft check (≤ 2 sentences, no raw names, 2–3 specific chips); live examples: "I swapped the yellow ball for a 6.7 cm tennis ball on the seesaw and the red ball for a 24 cm basketball waiting at the top of the first ramp. The much heavier basketball changes the chain, so the tennis ball may now miss the box." with chips "Tune the box position", "Bigger dominoes for basketball".

**Checks**: `npm run test:ai` 123/123 (queue, per-step slots, caller checks, stages, set_stages, legs guard, rate-only, sketch effort, 1 h cache + fallback, budget cap, auto plan/edit routing, escalation, edit `sim`, reply/suggestions tidy, the twin's origin/access/session/stream/queue); `node ai/bench/tools/selftest.mjs` 266/267 (the one failure, reference v1-motor-car-cereal "1 of 3 cereal boxes toppled", follows the engine change in `tooling/src/sim/physics.ts` at 13:35, not the AI); the restarted server: catalog 200, other-site Origin 403, text/plain 415, foreign Host 403, a live edit through the queue with progress (`thinking` → `writing`), a rate-only refine with goals and stage checks (read 10.7k cached tokens), and the report's exact request through `/api/ai/plan` → intent edit in 10.2 s.

**Reproduce** (base = a copy of `ai/` from `research/*-before-ai2*`, frozen client = a copy of `web/ai` from 12:58 with `web/sim` linked):
```
node ai/bench/run.mjs pipeline --run ai2ab --tag new --images --core --edits --jobs 4 --concurrency 3 --client <frozen-client>
node ai/bench/run.mjs plan --configs opus-medium --run ai2v-noho-c --prompts ai/bench/prompts/ai2-nohandoff --no-render
node ai/bench/run.mjs pipeline --run ai2lat --tag final --images --core --edits --jobs 3 --concurrency 3 --client <frozen-client + research/ai-orchestrator-rate-only.diff>
node ai/bench/tools/compare-pipelines.mjs "base=dirA,dirB" "new=dirC,dirD"
```

## 14. Round 3 (15 Oct, night): the edit experiment's configuration n7, integrated on the server

**What changed** (contracts in `ai/DESIGN.md` §14): the edit step got n7's prompt (`ai/prompts/edit.md`: targets first, a `kind`, ask only when truly ambiguous, questions change nothing, exact numbers, no collateral changes; plus §13.9's chips and reply style), the rich digest (`ai/rich-digest.mjs`, built from a run the step makes itself; the plan's falls / hits / moves goals shown MET / FAILED), `kind` + `targets` on the answer (`ai/schemas.mjs`: the experiment's three hard checks get the repair turn, the rest is tidied), and an optional `feedback` payload for the client's repair and make-it-work turns. The browser half (deterministic application, one overlap repair, the fast path with a heads-up, aim-first) is a contract for `web/ai` (§14.2), not built in this round.

**How it was measured.** The experiment's own eval (`ai/experiments/edit`: 105 cases on the starter (63, including the user's real swap), 5 built-in scenes and 5 AI-built ones; hard checks in `lib/check.mjs`; the "says why" grader cached), with its frozen browser side (`arms.mjs` arm n7: apply-edit v3, overlap repair, aim-first, ≤ 2 more rounds and the tuner for a fix) unchanged. `ai/bench/tools/edit-integrated.mjs` swaps only the arm's edit call (`./lib/step.mjs`, by a module hook) for the shipped `runStep("edit")`, run from a byte-identical copy of `ai/` placed next to the experiment's frozen `web/sim` (so the server's own run uses the engine the frozen browser side uses; the copy's hashes are in each run's `tree.json`). The experiment's `extra` is sent as `feedback`. Reference: the experiment's records, n7 on the 4 make-it-work cases (5 samples) and n6 on the other 101 (n7 runs exactly n6 there; the experiment ran n7 only on the fix cases). Each call also rebuilt the experiment's own request text for the same payload and compared it with what the shipped step sent.

| arm | n | pass | byte-identical pass | exact change | others untouched ≤ 3 mm | untouched byte | no unasked items | no new overlaps | works or says why | questions / ambiguous unchanged | asks when ambiguous | answers right | p50 / p90 s | edit calls | $ per edit |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| experiment n7 (r1 + r2) | 210 | 0.986 | 0.976 | 177/178 | 178/178 | 176/178 | 166/166 | 178/178 | 202/202 | 32/32 | 10/10 | 8/8 | 8.7 / 15.8 | 1.05 | 0.028 |
| **integrated (i1 + i2)** | 210 | **0.990** | **0.981** | 177/178 | 178/178 | 176/178 | 166/166 | 178/178 | 202/202 | 32/32 | 10/10 | 8/8 | 7.3 / 11.5 | 1.03 | 0.029 |
| experiment n7 (r1) | 105 | 0.981 | 0.971 | 88/89 | 89/89 | 88/89 | 83/83 | 89/89 | 101/101 | 16/16 | 5/5 | 4/4 | 7.5 / 13.0 | 1.04 | 0.026 |
| integrated, `intent: "edit"` (ie1: what the app's drawer sends) | 105 | 0.981 | 0.971 | 88/89 | 89/89 | 88/89 | 83/83 | 89/89 | 101/101 | 16/16 | 5/5 | 4/4 | 7.6 / 13.1 | 1.04 | 0.031 |

- **By category** (i1 + i2 vs the experiment): swap 30/30 vs 29/30, add 17/18 vs 18/18, fix 7/8 vs 6/8, every other category the same and full (resize 26/26, material 12/12, move 26/26, remove 16/16, duplicate 6/6, rotate 16/16, retime 12/12, ambiguous 10/10, resolve 8/8, question 22/22). By scene: the starter 124/126 vs 123/126; every other scene full in both.
- **Paired** (same case, same sample index): 206 both pass, 1 only the experiment's (s-add3-dominoes, i1: the step asked whether 3 more growing dominoes should push the seesaw or grow more gently, the "asks when a change can't fit" behaviour the experiment already noted), 2 only the integrated (s-fix-tennis, s-swap-box-cup), 1 both fail. ie1 against r1: 102 both, 1 / 1, 1 both fail.
- **Make it work again** (4 cases × 5 samples): experiment 16/20, integrated 15/20 (box moved up 5/5 and 5/5, box moved right 5/5 and 5/5, tennis swap 2/5 and 3/5, the user's swap 4/5 and 2/5); p50 / p90 32 / 101 s vs 21 / 76 s. The two hard ones need the machine changed (the heavier ball barely leaves the seesaw) and swing between windows, so they were also run **at the same time** with the experiment's own edit call (`--original`), 5 samples each: 2/10 vs 2/10 (both lower than in their own windows: 10 processes shared the CPU, and the tuner's 45 s budget then covers fewer runs).
- **The user's request** ("replace the yellow ball with a tennis ball and the red ball with a basketball"): exact in both samples, untouched byte-identical, 6.0 / 6.3 s: "I swapped the yellow ball on the seesaw for a tennis ball (6 g → 58 g) and the red ball at the top for a basketball (24 cm, 620 g)." plus the frozen client's heads-up that "Tennis ball lands in the box" no longer happens. Through the running local server (`POST /api/ai/edit`, intent edit): 8.1 s, kind change, targets ball2 / ball1, the two swaps and their names only, 45k prompt tokens read from the cache, $0.028.
- **The request text** was the experiment's byte for byte in 188 of 216 edit calls; all 28 others differ only in the `Goals:` line of the AI-built scenes (c1, m2, z2, k2), where the shipped digest shows the plan's falls / hits / moves goals MET / FAILED ("FAILED: The wooden ball goes down the ramp (ends 89 cm from where it started (needs 1 m))") instead of "label [kind]". Those scenes passed 28/28 in both arms.
- **Cost of the chat fields**: the edit call itself is p50 4.6 s / p90 7.9 s and $0.026 (the experiment's: 3.4 / 6.7 s, $0.023), from ≈ 150 more output tokens (p50 360 vs 210) for `suggestions`, the first-person reply and `why`; the server's own run of the scene adds ≈ 0.2–0.4 s. Whole edits were not slower (7.3 vs 8.7 s p50) because the gateway was less loaded in this window.

**Checks**: `npm run test:ai` 125/125 (new: the rich digest from the step's own run, `feedback` placement and limits, other-kind goals MET / FAILED, kind / targets checks and tidying, an `ask` with patches repaired); `node --test ai/experiments/edit/integrate/apply-edit.test.mjs` 5/5 against the live `web/ai` + `web/sim` (the browser contract's module still fits the live code).

**Reproduce** (results under `$EDIT_OUT`, default this session's scratchpad `n7int/results`; summaries in `ai/bench/results/edit-n7-integrated/`; 351 case-runs cost $16.5):
```
zsh -c 'source ~/.config/truefoundry/env && node ai/bench/tools/edit-integrated.mjs --run i1'          # also i2; ie1 with --intent edit
zsh -c 'source ~/.config/truefoundry/env && node ai/bench/tools/edit-integrated.mjs --run i3 --cat fix' # i3..i5
zsh -c '... --run t1 --cases s-fix-tennis,s-fix-user-swap' and the same with --original                 # t1..t5, launched together
node ai/bench/tools/edit-integrated.mjs --report --runs i1,i2 --fix-runs i1,i2,i3,i4,i5 --same-time t1,t2,t3,t4,t5 --same-time-cases s-fix-tennis,s-fix-user-swap --save
```
