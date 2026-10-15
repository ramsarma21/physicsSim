# Model research for the AI scene builder (15 Oct 2026)

Scope: which model to use for each AI step in `ai/DESIGN.md`, which are **observe** (vision), **plan** (catalog-constrained reasoning), **refine** (render vs reference plus simulation results, run in a loop), **edit** (follow-up chat), and a **judge** for benchmarking. This file ranks candidates from public evidence and our own probes of the TrueFoundry gateway. `candidates.json` lists the route ids for the benchmark in `ai/bench/` to measure. That benchmark makes the final call. This file only decides what is worth measuring and in what order.

Method:
1. **Public evidence.** Vendor model cards and launch pages, plus independent leaderboards. All links are at the end.
2. **Gateway probes, run today.** About 400 live calls through `https://tfy.promptlens.trilogy.com/v1`. They checked which routes answer, which parameters each route accepts, and how fast each one is.
3. **Smoke tests on this app's own inputs.**
   - Synthetic side-view pictures with known boxes.
   - Realistic renders of four of the app's scenes, shot headlessly from `localhost:8790`.
   - A render-vs-reference "find the differences" test, which is the core skill refine needs.
   - Plan and edit runs with the real 113-type catalog digest (about 11k tokens).

   Scripts and raw outputs are in the session scratchpad (`mr-probe/`). They were not committed. They are smoke tests (n = 2 to 8 per cell), not the benchmark.

Caveat: this research was done by Claude Opus 5.5, the same model the user prefers. Third-party numbers are independent. My qualitative reading of plan outputs could be biased toward Claude, so the benchmark must use a cross-family judge (see Judge).

---

## 1. Recommendations at a glance

| Step | Pick to beat (benchmark default) | Runner-ups to benchmark | Effort | Measured latency (our probes) | Agrees with "Opus 5.5 for thinking"? |
|---|---|---|---|---|---|
| **observe** | `gemini-group/gemini-4-argon` (low or medium) | `claude-group/claude-opus-5-5` (medium), `openai-group/gpt-6-astra` (medium), `openai-group/gpt-6.1-sol` (medium), `gemini-group/gemini-3.8-flash` (low) | low/medium | Argon low 10–14 s; Opus 12–25 s; Astra 13–22 s | **Partly disagrees.** Every vision leaderboard puts Gemini 4 Argon ahead of Opus 5.5 on detection and counting. Opus 5.5 is #2–#3 and the best physical reasoner. Benchmark both head-to-head, plus the hybrid in §5.1. |
| **plan** | `claude-group/claude-opus-5-5` (high) | `claude-group/claude-fable-5-1`, `openai-group/gpt-6-astra` (high), `gemini-group/gemini-4-argon` (high), `claude-group/claude-sonnet-5-5`, `openai-group/gpt-6.1-sol` (high) | high (medium if latency matters) | Opus medium 44–60 s, high 63 s (22k-token prompt); Astra high 123–136 s; Argon high 90–304 s | **Agrees.** Opus 5.5 is #1 on the Artificial Analysis Intelligence Index, GDPval-AA and HLE-with-tools, and #1 on causal physical reasoning (PhysVista). It followed the semantic-placement contract best in our runs. |
| **refine** (loop ≤ 3) | `claude-group/claude-opus-5-5` (medium) | `gemini-group/gemini-4-argon` (low), `openai-group/gpt-6-astra` (medium), `claude-group/claude-sonnet-5-5`, `openai-group/gpt-6.1-sol`, `gemini-group/gemini-3.8-flash` | medium | Opus 8–10 s per two-image diff (all 3 planted differences found, no invented ones); Argon 10–43 s; Astra 23–24 s; Sol 24–41 s | **Agrees.** Opus 5.5 combines top-3 vision, the best physical-causal reasoning and the fastest top-tier vision latency. |
| **edit** | `claude-group/claude-opus-5-5` (low) | `claude-group/claude-sonnet-5-5` (low), `openai-group/gpt-6.1-sol` (low), `gemini-group/gemini-3.8-flash` (low), `claude-group/claude-haiku-5-5` | low | Opus low 9–12 s, medium 17–22 s; Sonnet low 7–9 s; Sol low 3 s; 3.8 Flash low 4 s; Haiku 8–10 s | **Agrees, with a speed cost.** Opus cannot turn thinking off (low effort is the only lever), so it is 2–3× slower than the fast models. Only Opus (medium) and Sonnet (high) noticed the stage was too short for the requested extra dominoes. Benchmark whether a fast model matches Opus-low on simple edits. |
| **judge** (offline) | `gemini-group/gemini-4-argon` (high) | `openai-group/gpt-6-astra` (high/xhigh), `claude-group/claude-opus-5-5` (max), `claude-group/claude-fable-5-1` | high/max | not latency-bound | **Deliberately not Opus-first.** The generator is Claude, and judges favour their own family. Use a cross-family panel. |

Fast "quick check" models (JSON repair, intent classification, cheap sanity checks), fastest first in our probes: `openai-group/gpt-6.1-sol` low (3 s), `gemini-group/gemini-3.8-flash` low (4 s), `claude-group/claude-sonnet-5-5` low (7–9 s), `claude-group/claude-haiku-5-5` (8–10 s with a 22k-token prompt; about 2.5 s with a short one).

---

## 2. What the gateway actually offers (probed today)

### Route families
- **Claude.** `claude-group/*` resolves to `anthropic-primary/*`: the parallel probe in `ai/research/gateway-probe.json` shows `resolved_model: anthropic-primary/claude-opus-5-5`, and the bare id `claude-opus-5-5` resolves the same way. So these are one backend, not independent fallbacks.
  - **Independent Opus 5.5 backends** that answered: `aws-bedrock/global.anthropic.claude-opus-5-5`, `aws-bedrock/us.anthropic.claude-opus-5-5` and `microsoft-foundry-quark/claude-opus-5-5`.
  - **401 "Invalid bearer token"** (unusable with this key): `claude-pro-group/*`, `claude-max-traffic/*`, `claude-pro-traffic/*`.
- **Gemini.** `gemini-group/gemini-4-argon` (2.5–2.7 s ping), `gemini-4-argon`, and `vertex-contract-analyzer/gemini-4-argon` all answer. `gemini-primary/gemini-4-argon` answers but pinged at 9 s.
  - **Aliasing (important for benchmark labels):** `gemini-group/gemini-3.5-flash` and `gemini-primary/gemini-3.5-flash` are served by **gemini-3.6-flash**, and `gemini-group/gemini-3.7-flash` is served by **gemini-3.8-flash** (the `model` field of the response says so).
  - `gemini-group/gemini-3.1-pro` and `gemini-primary/gemini-3.1-pro-preview` **timed out at 180 s**.
- **OpenAI.** `openai-group/` and `openai-primary/` both serve `gpt-6-astra`, `gpt-6.1-sol`, `gpt-6-sol` and `gpt-6-luna`. Two sporadic Cloudflare **520** pages came back from `api.openai.com` in roughly 60 calls, so these routes need retries.
- **Others.** `xai-group/grok-4.7` is alive but slow: 12–124 s even for trivial JSON. `fireworks-group/qwen3p8-max` (vision-capable) and `fireworks-group/kimi-k3` are alive but take 30–140 s per vision call. `bedrock-oss-group/qwen3-vl-235b` is fast but weak (see §4).

### Parameters by family
| Family / route | `response_format: json_schema` | Reasoning control | Other quirks |
|---|---|---|---|
| Claude via `claude-group/`, `anthropic-primary/`, bare id | **Works** (strict) | `reasoning_effort` in low, medium, high, xhigh or max is accepted and changes token use. For example, Opus plan output was 2.2k tokens at low, 4.3–5.8k at default and 6.0k at high. `none` is accepted but thinking stays on. | Opus 5.5 rejects `temperature`, and `thinking: disabled` returns 400: adaptive thinking is always on ([effort docs](https://platform.claude.com/docs/en/build-with-claude/effort)). Default effort is **medium** on Opus 5.5 and Haiku 5.5, and **high** on Sonnet 5.5. |
| Claude via `aws-bedrock/*`, `microsoft-foundry-quark/*` | **400**: `tool_choice: type "tool" and "any" are not supported for this model` (the gateway turns the schema into a forced tool, which always-on thinking forbids) | same | Usable only as **prompt-JSON fallbacks**: drop `response_format`, validate locally, repair once. `core.mjs` drops rejected params, so the provisional `models.json` fallbacks still work, but without schema enforcement. |
| Gemini (`gemini-group/`) | **Works, but the schema must avoid type unions.** `"type": ["string","null"]` returns 400 `Proto field is not repeating`. | `reasoning_effort` maps to `thinking_level` in low, medium or high. `xhigh` returns 400. | The Gemini 4 Argon docs list thinking levels low, medium and high only ([model page](https://ai.google.dev/gemini-api/docs/models/gemini-4-argon)). |
| OpenAI GPT-6.x | **Works only with an explicit `reasoning_effort` of low, medium, high, xhigh or max.** Omitting it, or sending `none`, returns 400 `Function tools with reasoning_effort are not supported…` | effort levels low to max. GPT-6.1 Sol cannot turn reasoning off. | Rejects `temperature`. |
| All providers | A loose `{"type":"object"}` schema makes every provider except xAI return **`{}`** (constrained decoding to an empty object). | | Either send the full schema, or send no `response_format` and validate. |

**Opus 5.5 fast mode** (`speed: "fast"`, up to 2.5× output speed, Claude API only, research preview) is **not active here**. The gateway accepted it with `x-tfy-anthropic-beta: fast-mode-2026-02-01`, but billing stayed at the standard $20/M output and there was no speed-up. Without the header it returns 400 `speed: Extra inputs are not permitted`. Do not plan on it.

### Coordinate formats: this affects the observe contract (`bbox` in 0..1)
- **Claude**: the docs state Claude *"does not work well when you ask for normalized coordinates"*; ask for pixel coordinates on the exact image sent, then normalise in code ([coordinates guide](https://platform.claude.com/docs/en/build-with-claude/vision-coordinates)). The design downscales to ≤ 1536 px. That stays inside Opus 5.5's native limits (2576 px long edge, 4784 visual tokens), so the image Claude sees is the image you sent.
- **Gemini** is trained to output `box_2d: [ymin, xmin, ymax, xmax]` on a 0–1000 scale ([image understanding](https://ai.google.dev/gemini-api/docs/image-understanding)). In our probe, when asked for 0..1, **Gemini 4 Argon mixed 0..1 and 0..1000 inside a single box** and Gemini 3.8 Flash returned 0–1000 numbers. In native mode both were correct.
- **OpenAI**: pixel coordinates. Use `detail: "high"` or `"original"` for localisation ([vision guide](https://developers.openai.com/api/docs/guides/images-vision)).
- Recommendation for the observe prompt: request each family's native format, then convert to the 0..1 contract in `core.mjs`.

---

## 3. Public evidence (October 2026)

### Vision: detection, counting, visual reasoning
**Roboflow Vision Evals** (63 VLMs, same real-world samples, low effort, mean of 3 runs; [leaderboard](https://playground.roboflow.com/evals)):

| Model | Overall | Object det. | Counting | Identif. | OCR | Visual reasoning | s/sample | $/sample |
|---|---|---|---|---|---|---|---|---|
| Gemini 4 Argon | **87.5** | **82.5** | **86.0** | 93.8 | **85.7** | **89.4** | 13.4 | 0.0058 |
| GPT-6 Astra | 83.4 | 82.1 | 80.2 | 89.6 | 77.8 | 87.2 | 9.9 | 0.034 |
| Claude Opus 5.5 | 82.0 | 74.5 | 80.6 | 93.8 | 78.3 | 83.0 | **7.6** | 0.015 |
| Gemini 3.5 Flash | 81.8 | 70.6 | 80.6 | 99.0 | 76.7 | 82.1 | 11.5 | 0.012 |
| GPT-6.1 Sol | 81.7 | 80.8 | 78.8 | 89.6 | 75.8 | 83.7 | 12.8 | 0.0068 |
| Gemini 3.7 Flash | 80.1 | 70.5 | 78.4 | 96.9 | 73.9 | 80.8 | 11.0 | 0.0033 |
| Gemini 3.8 Flash | 79.8 | 68.1 | 78.8 | 97.9 | 72.8 | 81.2 | 12.8 | 0.0041 |
| Qwen3.8 Max | 79.3 | 76.7 | 81.1 | 88.5 | 74.0 | 75.9 | 19.0 | 0.0080 |
| Claude Sonnet 5.5 | 77.6 | 74.3 | 79.3 | 91.7 | 66.3 | 76.4 | 8.3 | 0.0073 |
| Claude Fable 5.1 | 74.7 | 61.4 | 69.4 | 97.9 | 72.9 | 72.0 | 8.4 | 0.039 |
| Claude Haiku 5.5 | 69.6 | 65.8 | 68.9 | 83.3 | 61.2 | 68.9 | 11.0 | 0.0006 |
| Grok 4.7 | 63.5 | 40.4 | 61.7 | 87.5 | 63.6 | 64.2 | 33.3 | 0.020 |
| Kimi K3 | 56.0 | 51.9 | 46.0 | 81.3 | 58.6 | 42.4 | 9.9 | 0.0058 |
| Qwen3-VL-235B | 55.2 | 52.1 | 47.3 | 90.6 | 56.4 | 29.8 | 15.9 | 0.0011 |

High effort adds about 1.4–2.9 points for Opus 5.5 (OD 76.0, counting 82.0, reasoning 85.9; [Opus page](https://playground.roboflow.com/models/anthropic/claude-opus-5-5)).

### Spatial layout from photos
**Blueprint-Bench 2** (about 20 apartment photos turned into a floor plan, scored on room-connectivity graphs; [Andon Labs](https://andonlabs.com/evals/blueprint-bench-2)). This is the closest public analogue to observe: recovering *relations and layout* from photos.
- Human 0.586
- **Gemini 4 Argon 0.544**, **Claude Opus 5.5 0.512**, GPT-6 Astra 0.497
- Fable 5.1 0.419, Sonnet 5.5 0.393, Gemini 3.8 Flash 0.386, GPT-6 Sol 0.369
- Haiku 5.5 0.330, Grok 4.7 0.325, Kimi K3 0.295
- GPT-6.1 Sol is not listed.

### Physical understanding
**PhysVista** (arXiv 2610.00559, 1 Oct 2026; perception, then reasoning, then plausibility, on physics videos; [paper](https://arxiv.org/html/2610.00559)). Gemini 4 Argon and GPT-6 Astra were not tested.
- **State perception:** GPT-6 Sol 68.6, **Opus 5.5 65.8**, GPT-5.2 64.1, Gemini 3.1 Pro 58.3.
- **Causal physical reasoning:** **Opus 5.5 67.9** (#1), GPT-6 Sol 62.7, Gemini 3.1 Pro 60.2. Opus leads on order (90.7), dynamics prediction (58.5) and counterfactuals (49.6).
- **Plausibility scoring (SRCC):** GPT-6 Sol 0.614, Opus 5.5 0.570.

**ERQA** (embodied 3D/physical reasoning): Google reports **87% for Gemini 4 Argon**, "outperforming every other frontier model" ([Google for Developers](https://developers.googleblog.com/gemini-4-argon-for-robotics/)). This is a vendor claim. Aggregators show Qwen3.8 Max at 77.8 and Claude Opus 4.6 at 40.8, with no independent Opus 5.5 number ([BenchLM ERQA](https://benchlm.ai/benchmarks/erqa)).

**Google's comparison table** ([DeepMind Gemini page](https://deepmind.google/models/gemini/)):

| Benchmark | Gemini 4 Argon | GPT-6 Astra | Opus 5.5 | Fable 5.1 |
|---|---|---|---|---|
| Chartography | 71.6 | 71.0 | 66.3 | 46.2 |
| LVBench | 91.7 | 87.5 | 83.7 | 79.7 |
| GraphWalks 256k–1M | 84.2 | 71.8 | 66.8 | 65.0 |
| Terminal-Bench 4.0 | 57.4 | 58.2 | **66.4** | 57.9 |
| AutomationBench | **51.3** | 41.4 | 42.5 | 31.4 |

**GPT-6 Astra (OpenAI):**
- **ScreenSpot-Pro** 92.7 (GPT-5.6 Sol 76.9).
- **BenchCAD** (CAD programs from rendered views) 95.9 vs Fable 5.1 84.3. This was run with Python tools, self-reported, and OpenAI notes that the Claude runs used modified settings ([Vellum summary](https://www.vellum.ai/blog/gpt-6-astra-benchmarks-explained)).
- Price: $10/$50 per M tokens, the most expensive of the candidates.

**Metric size and position from images is weak for every VLM** ([IDEAL-Bench](https://arxiv.org/html/2607.03614), best model 62/100, with recognition well ahead of geometry; [Metric-Bench](https://arxiv.org/html/2609.25841); [MindEdit-Bench](https://arxiv.org/abs/2607.00491)).

> Design implication, which the design already supports: trust observe for *what, how many, which rests on which, left/right order*. Treat `est_size_m` as a hint only. Take sizes from the catalog's true sizes and scale cues.

### Reasoning, intelligence and latency
**Artificial Analysis Intelligence Index** ([leaderboard](https://artificialanalysis.ai/leaderboards/models)):
- Opus 5.5 at max **58** (#1), Sonnet 5.5 max 56, Opus xhigh 56, Opus high 54.
- Fable 5.1 53, GPT-6 Astra max 53, Gemini 4 Argon high 53, GPT-6.1 Sol max 52.
- Opus medium 51, Grok 4.7 46, Qwen3.8 Max 45, Kimi K3 44, Gemini 3.8 Flash high 41.
- Another source reports 59 for Gemini 3.8 Flash on an earlier index version, so treat Flash's figure as uncertain.

**Opus 5.5 time to first token by effort** (reasoning included; Anthropic API):

| Effort | TTFT | Output speed |
|---|---|---|
| low | 10.7 s | 78 tok/s |
| medium | 26.9 s | 79 tok/s |
| high | 58.8 s | 74 tok/s |
| xhigh | 144.8 s | 76 tok/s |

Other models:
- **Sonnet 5.5:** low 0.95 s, medium 1.8 s, high 14.6 s TTFT, at 92–129 tok/s.
- **GPT-6.1 Sol:** medium 6.3 s, high 50.9 s, at about 46–58 tok/s.
- **GPT-6 Astra:** medium 6.3 s, high 70.9 s, at 43 tok/s.
- **Gemini 3.8 Flash:** high 24.5 s, at 140–300 tok/s, but very verbose.
- **Gemini 4 Argon:** no speed data yet. It was released at the end of September and generally available on 13 Oct.

**Anthropic's own table** ([launch page](https://www.anthropic.com/claude-opus-5-5)): Opus 5.5 beats Fable 5.1 and GPT-6 Astra on these:

| Benchmark | Opus 5.5 | Fable 5.1 | GPT-6 Astra |
|---|---|---|---|
| GDPval-AA (Elo) | 1846 | 1735 | 1542 |
| HLE with tools | 67.7 | 65.6 | 57.2 |
| Terminal-Bench 4.0 | 66.4 | 55.8 | 57.9 |
| Chartography with tools | 89.0 | 88.4 | — |

Price: $4/$20 per M tokens, 40% cheaper than Opus 5. On cost per unit of quality, Opus 5.5 beats Fable 5.1 ($10/$50) for every step here.

### Structured output and judging
- **Structured output.** Schema validity is near the ceiling for frontier models; the difference is in value accuracy ([SOB benchmark](https://interfaze.ai/blog/introducing-structured-output-benchmark), [arXiv 2604.25359](https://arxiv.org/html/2604.25359v1)). In our probes every frontier model produced valid JSON on every successful call, with and without a schema. The real risk is **gateway translation** (§2), not the models.
- **Judging.** Multimodal judges show **self- and family-preference bias** ([arXiv 2604.11589](https://arxiv.org/abs/2604.11589); [preference leakage, arXiv 2502.01534](https://arxiv.org/abs/2502.01534)). Ensembles across families reduce it. Top multimodal judges reach only about 70–80% agreement with human preference on MMRB2 ([arXiv 2512.16899](https://arxiv.org/abs/2512.16899)). So deterministic checks should carry most of the benchmark score.

---

## 4. Our probes: results

### 4a. Observe on clean synthetic side views
Two pictures: a ramp leaning on a box with a ball and a cup, and a pendulum on a stand with 7 dominoes and a bucket. The prompt was in the observe format, run once in 0..1 mode and once in native-coordinate mode. Scores are mean IoU excluding the table, which is ambiguous.

| Model | mIoU 0..1 | mIoU native | supports correct | domino count = 7 | median s |
|---|---|---|---|---|---|
| Opus 5.5 (medium) | 0.980 | 0.979 | 16/16 | 2/2 | 16.3 |
| Opus 5.5 (high) | 0.978 | 0.979 | 16/16 | 2/2 | 15.9 |
| GPT-6 Astra (medium) | 0.966 | 0.971 | 16/16 | 2/2 | 17.3 |
| GPT-6.1 Sol (medium) | 0.972 | 0.942 | 28/28 | 4/4 | 14.3 |
| Gemini 4 Argon (high) | 0.975 | 0.964 | 15/16 | 2/2 | 30.7 |
| Gemini 4 Argon (low) | 0.855 | 0.868 | 15/16 | 2/2 | 11.8 |
| Fable 5.1 | 0.968 | 0.961 | 16/16 | 2/2 | 14.0 |
| Sonnet 5.5 | 0.966 | 0.938 | 16/16 | 2/2 | 7.5 |
| Gemini 3.6 Flash (served for `3.5-flash`) | 0.956 | 0.964 | 15/16 | 2/2 | 2.6 |
| Gemini 3.8 Flash (low) | **0.483** (mixed scales) | 0.967 | 14/16 | 2/2 | 6.5 |
| Haiku 5.5 | 0.941 | 0.980 | 15/16 | 2/2 | 3.5 |
| Qwen3.8 Max | 0.931 | 0.901 | 16/16 | 2/2 | 87 |
| Kimi K3 | 0.910 | 0.948 | 16/16 | 2/2 | 94 |
| Grok 4.7 (low) | 0.852 | 0.770 | 16/16 | 2/2 | 17.9 |
| Qwen3-VL-235B | 0.617 | 0.006 | 11/16 | 2/2 | 7.0 |

Reading the table:
- On clean diagrams the frontier tier is saturated (about 0.97). This test separates **format reliability and speed**, not visual skill.
- Argon's lower scores at low effort come from boxing the pendulum bob *together with its string*, which is a labelling choice. The rest is Gemini mixing coordinate scales outside its native format.
- The 4 "errors" reported for Gemini were our schema's `["string","null"]` union, not the model.

### 4b. Realistic renders of the app's own scenes
Scenes: the Rube Goldberg starter, Pendulum and dominoes, and Car, ramp and dominoes, shot headlessly at t = 0.
- Every frontier model got the counts (7 dominoes), the hanging box, the yellow ball on the seesaw, and the motion story (domino chain, seesaw launch, ball into box). The remaining automated misses were scoring artefacts: "ball holder" counted as a ball, "ramp support legs" counted as a ramp.
- **Qualitative difference:** GPT-6 Astra and GPT-6.1 Sol both called the open, rope-hung box a **"suspended wooden block"**. A solid block cannot catch the ball, so this misreading would break planning. Claude and Gemini called it a crate, box or basket.

### 4c. Refine-style diff
Reference render vs build render. Three planted differences: 7→4 dominoes, the yellow ball removed, the upper ramp moved right and made steeper.

| Model | found 3/3 + `matches=false` | invented differences | median s |
|---|---|---|---|
| Opus 5.5 (medium/high) | 4/4, both runs | none (extras were real consequences, such as the ball post now detached) | **8–9** |
| Fable 5.1 | 4/4 | none | 13 |
| Sonnet 5.5 | 4/4 | 1 minor (crate "slightly larger") | 10 |
| Haiku 5.5 | 4/4 | a few vague ones | 6 |
| Gemini 4 Argon low/high | 4/4 | none | 26 (10–43) |
| Gemini 3.8 Flash low | 4/4 | none | 5.7 |
| Gemini 3.6 Flash | 4/4 | said the reference had **8** dominoes | 7.8 |
| GPT-6 Astra (medium) | 4/4 | none | 24 |
| GPT-6.1 Sol (medium/low) | 4/4 | none | 24–34 |
| Grok 4.7 | 3/4 in one run | lever angle, box position | 48 |
| Qwen3.8 Max / Kimi K3 | 4/4 | seesaw tilt / "blue cube" | 72–110 |

### 4d. Plan
Real catalog digest (about 22k prompt tokens). The request: "marble → ramp → 6 dominoes → toy car off a hardcover book into a cup; a cat watches, a desk lamp, water that splashes."
- **Every model** used only catalog types, valid prop keys and in-range values. Every model listed cat, lamp and water in `missing` and set the goal `car in cup`.
- **Fable 5.1** substituted a rubber duck for the cat, and listed the swap honestly.

Differences in kind:
- Opus 5.5, Fable 5.1, Sonnet 5.5 and Gemini 4 Argon used the **semantic placement** contract (`on`, `lean`, `right_of`) as instructed. Opus and Fable built a raised deck so the car drops into a table-level cup.
- GPT-6 Astra and GPT-6.1 Sol placed most items in `"air"` with absolute `y_m`. That bypasses the solver. Sol also produced a 1.1 m "hardcover book" and a 0.5 m cup.

Latency per model:

| Model | Latency |
|---|---|
| Opus low | 22 s |
| Opus medium | 44–60 s |
| Opus high | 63 s |
| Fable 5.1 | 62 s |
| Sonnet 5.5 (high) | 43–61 s |
| Argon low | 15–17 s |
| Argon high | 90–152 s (304 s in an earlier run) |
| GPT-6.1 Sol high | 92–111 s |
| Astra high | 123–136 s |
| Gemini 3.8 Flash high | 152–171 s (20–27k output tokens) |
| Grok 4.7 high | 395–421 s |
| Qwen3.8 Max | 266 s, then a 600 s timeout |

### 4e. Edit
Instruction on the starter scene: "make the red ball a steel ball bearing 4 cm across, put a second row of 5 dominoes to the right of the seesaw, make the lower ramp a bit steeper." All models produced valid, catalog-correct patches (replace_type to `steel-ball` with diameter 0.04, add a `domino-row` of count 5, a steeper ramp2).
- **Opus 5.5 (medium)** noticed the right wall at x = 3.12 leaves no room, and moved it. **Sonnet 5.5 (high)** widened the table.
- The low-effort and fast models wrote `right_of: seesaw` and left the collision for the solver.

Latency: GPT-6.1 Sol low 3.1–3.3 s, Gemini 3.8 Flash low 3.5–4.3 s, Gemini 4 Argon low 4.4–13 s (one earlier call hung for 600 s), GPT-6 Astra low 5.3–5.7 s, Sonnet low 7.4–8.6 s, Haiku 8.3–9.7 s, **Opus low 9.4–11.9 s**, Opus medium 17–22 s, Sonnet high 18–25 s.

### 4f. Reliability seen in about 400 calls
- Claude routes: 0 failures on `claude-group`.
- OpenAI: 2 Cloudflare 520 errors.
- Gemini 4 Argon: one plain call took 77 s and one edit hung until the 600 s timeout. It launched on 13 Oct and capacity looks volatile, so it needs a tight per-attempt timeout and a cross-family fallback.
- Qwen3.8 Max: one 600 s timeout.
- Grok 4.7: consistently slow.

---

## 5. Per-step ranking, trade-offs and route ids

### 5.1 Observe (vision, runs once per build; quality first, about 30 s is acceptable)
1. **Gemini 4 Argon**, `gemini-group/gemini-4-argon`, effort low or medium, native `box_2d`.
   - #1 on Roboflow overall (87.5) and on detection, counting and visual reasoning.
   - #1 on Blueprint-Bench 2 (0.544).
   - Vendor-reported ERQA 87%.
   - Risks: two days old on this gateway, volatile latency, and the Bloomberg-cited "weaker in real work" report ([MindStudio summary](https://www.mindstudio.ai/blog/gemini-4-argon-benchmarks)).
2. **Claude Opus 5.5**, `claude-group/claude-opus-5-5`, medium, pixel boxes.
   - #3 on Roboflow (82.0). Detection is weaker (74.5 vs 82.5), but it is the fastest top-tier model per sample (7.6 s).
   - #2 on Blueprint-Bench 2 (0.512).
   - #1 causal physical reasoning and #2 perception on PhysVista.
   - Most reliable route in our probes. Read the hanging box correctly as a container.
3. **GPT-6 Astra**, `openai-group/gpt-6-astra`, medium. #2 on Roboflow, with detection 82.1 and ScreenSpot-Pro 92.7. 5× Opus's price and slower; misread the open box as a block.
4. **GPT-6.1 Sol**, `openai-group/gpt-6.1-sol`, medium. 81.7 Roboflow (detection 80.8) at a fifth of Astra's price. Same "block" misreading.
5. **Gemini 3.8 Flash**, `gemini-group/gemini-3.8-flash`, low. 79.8 Roboflow in about 5 s. The fast fallback.

Not recommended:
- **Fable 5.1:** 74.7 Roboflow (detection 61.4) at $10/$50.
- **Grok 4.7, Kimi K3, Qwen3.8 Max:** slow or weaker.
- **Qwen3-VL-235B:** failed the native format.

**Evidence vs preference.** Observe is a vision step. The evidence says Argon at least matches Opus 5.5 on localisation and counting. Opus 5.5 is the stronger physical reasoner and the more dependable route today. Benchmark three configurations:
- (a) Argon alone.
- (b) Opus alone.
- (c) **Hybrid:** Argon for `objects[].bbox` and `count`, and Opus for `relations`, `state`, `supports` and `motion_story`, merged by label. Run the two calls in parallel so latency is the slower of the two.

If (b) is within noise of (a), keep Opus for simplicity and to match the preference.

### 5.2 Plan (text plus observation; quality first; 30–90 s is acceptable)
1. **Claude Opus 5.5**, `claude-group/claude-opus-5-5`, **high** (medium as a speed fallback).
   - Best on every reasoning signal: AA index #1, GDPval-AA 1846, HLE with tools 67.7, PhysVista causal reasoning #1.
   - Best adherence to the semantic-place contract in our runs. Latency is acceptable at about 60 s for high.
2. **Claude Fable 5.1**, `claude-group/claude-fable-5-1`. Same contract adherence and similar quality, but it trails Opus 5.5 on Anthropic's own table and costs 2.5× more. A strong same-family alternative.
3. **GPT-6 Astra**, `openai-group/gpt-6-astra`, high. Strong reasoner (AA 53, BenchCAD), but 2 minutes per plan and placed items with absolute coordinates.
4. **Gemini 4 Argon**, `gemini-group/gemini-4-argon`, high. AA 53, best long-context score. Latency is volatile (90–304 s at high). Low effort produced a sensible plan in 16 s, which is worth measuring.
5. **Claude Sonnet 5.5**, `claude-group/claude-sonnet-5-5`, high. AA up to 56 at max for a fifth of Opus's price. A good fallback.
6. **GPT-6.1 Sol**, `openai-group/gpt-6.1-sol`, high. Cheap, but produced odd sizes and absolute placement.

**Evidence vs preference: agrees.**

### 5.3 Refine (render vs reference plus simulation summary; looped up to 3 times, so per-call latency matters)
1. **Claude Opus 5.5**, `claude-group/claude-opus-5-5`, **medium**.
   - Found all 3 planted differences in 8–10 s with nothing invented.
   - Top-3 vision, #1 physical-causal reasoning, and the fastest top-tier vision model.
   - About 30 s for three loops leaves the time budget to the engine and tuner.
2. **Gemini 4 Argon**, `gemini-group/gemini-4-argon`, low. Best raw vision, but diffs took 10–43 s.
3. **GPT-6 Astra**, `openai-group/gpt-6-astra`, medium. Accurate, 24 s.
4. **Claude Sonnet 5.5**, `claude-group/claude-sonnet-5-5`, medium. 10 s and 77.6 vision. One small invented difference.
5. **GPT-6.1 Sol**, `openai-group/gpt-6.1-sol`, medium. Accurate but 24–41 s.
6. **Gemini 3.8 Flash**, `gemini-group/gemini-3.8-flash`, low. 6 s, all differences found. A quick-check tier, for example an early "done?" decision before calling Opus.

**Evidence vs preference: agrees.**

### 5.4 Edit (follow-up chat; latency-critical)
1. **Claude Opus 5.5**, `claude-group/claude-opus-5-5`, **low**: 9–12 s. Medium (17–22 s) handled stage constraints the fast models skipped.
2. **Claude Sonnet 5.5**, `claude-group/claude-sonnet-5-5`, low: 7–9 s. With the gateway's adaptive thinking, low effort is about Opus-low speed, not dramatically faster.
3. **GPT-6.1 Sol**, `openai-group/gpt-6.1-sol`, low: about 3 s. The fastest correct edits.
4. **Gemini 3.8 Flash**, `gemini-group/gemini-3.8-flash`, low: about 4 s.
5. **Claude Haiku 5.5**, `claude-group/claude-haiku-5-5`: 8–10 s with the 22k-token catalog prompt, so no faster than Sonnet-low here. Its advantage is price.

**Evidence vs preference: agrees on quality, costs speed.** Opus cannot disable thinking, so it is about 3× slower than Sol-low or Flash-low. The benchmark should measure edit quality at Opus-low against Sol-low and Flash-low. If the fast models tie Opus on small edits, consider a fast path, though a router adds its own latency and failure modes. The simplest robust choice is Opus 5.5 at low effort for every edit.

Prompt caching should help Opus and Sonnet here, because the about 11k-token catalog digest is a stable prefix. `models.json` already marks Claude routes `cache: true`. Measure cached latency in the benchmark.

### 5.5 Judge (benchmark only; latency irrelevant)
Use deterministic metrics first: goals met in the engine, overlap warnings, catalog validity, honest `missing`, and box IoU against `ai/bench/gt`. Use a judge only for "does the render match the request or reference?".

The judge must not be the generator's family, because of self-preference bias. Recommended panel, averaged with disagreements flagged:
1. **Gemini 4 Argon**, `gemini-group/gemini-4-argon`, high: best vision.
2. **GPT-6 Astra**, `openai-group/gpt-6-astra`, high or xhigh: second-best vision, a different family.
3. **Claude Opus 5.5**, `claude-group/claude-opus-5-5`, max: third vote only. Its scores on Claude-generated scenes should be compared with the other two to measure bias.
4. **Claude Fable 5.1**, `claude-group/claude-fable-5-1`: reserve.

Calibrate the panel on 10–20 human-labelled pairs before trusting it.

---

## 6. Suggested benchmark configurations (copy into `ai/bench`)

```json
{
  "observe": [
    {"model": "gemini-group/gemini-4-argon", "params": {"reasoning_effort": "low", "max_tokens": 16000}, "coords": "gemini_box_2d_1000"},
    {"model": "gemini-group/gemini-4-argon", "params": {"reasoning_effort": "medium", "max_tokens": 16000}, "coords": "gemini_box_2d_1000"},
    {"model": "claude-group/claude-opus-5-5", "params": {"reasoning_effort": "medium", "max_tokens": 16000}, "coords": "pixels"},
    {"model": "claude-group/claude-opus-5-5", "params": {"reasoning_effort": "high", "max_tokens": 16000}, "coords": "pixels"},
    {"hybrid": ["gemini-group/gemini-4-argon:boxes+counts", "claude-group/claude-opus-5-5:relations+story"]},
    {"model": "openai-group/gpt-6-astra", "params": {"reasoning_effort": "medium", "max_tokens": 16000}, "coords": "pixels"},
    {"model": "openai-group/gpt-6.1-sol", "params": {"reasoning_effort": "medium", "max_tokens": 16000}, "coords": "pixels"},
    {"model": "gemini-group/gemini-3.8-flash", "params": {"reasoning_effort": "low", "max_tokens": 16000}, "coords": "gemini_box_2d_1000"}
  ],
  "plan": [
    {"model": "claude-group/claude-opus-5-5", "params": {"reasoning_effort": "high", "max_tokens": 32000}},
    {"model": "claude-group/claude-opus-5-5", "params": {"reasoning_effort": "medium", "max_tokens": 32000}},
    {"model": "claude-group/claude-fable-5-1", "params": {"reasoning_effort": "high", "max_tokens": 32000}},
    {"model": "openai-group/gpt-6-astra", "params": {"reasoning_effort": "high", "max_tokens": 32000}},
    {"model": "gemini-group/gemini-4-argon", "params": {"reasoning_effort": "high", "max_tokens": 32000}},
    {"model": "gemini-group/gemini-4-argon", "params": {"reasoning_effort": "low", "max_tokens": 32000}},
    {"model": "claude-group/claude-sonnet-5-5", "params": {"reasoning_effort": "high", "max_tokens": 32000}},
    {"model": "openai-group/gpt-6.1-sol", "params": {"reasoning_effort": "high", "max_tokens": 32000}}
  ],
  "refine": [
    {"model": "claude-group/claude-opus-5-5", "params": {"reasoning_effort": "medium", "max_tokens": 16000}},
    {"model": "claude-group/claude-opus-5-5", "params": {"reasoning_effort": "low", "max_tokens": 16000}},
    {"model": "gemini-group/gemini-4-argon", "params": {"reasoning_effort": "low", "max_tokens": 16000}},
    {"model": "openai-group/gpt-6-astra", "params": {"reasoning_effort": "medium", "max_tokens": 16000}},
    {"model": "claude-group/claude-sonnet-5-5", "params": {"reasoning_effort": "medium", "max_tokens": 16000}},
    {"model": "openai-group/gpt-6.1-sol", "params": {"reasoning_effort": "medium", "max_tokens": 16000}},
    {"model": "gemini-group/gemini-3.8-flash", "params": {"reasoning_effort": "low", "max_tokens": 16000}}
  ],
  "edit": [
    {"model": "claude-group/claude-opus-5-5", "params": {"reasoning_effort": "low", "max_tokens": 16000}},
    {"model": "claude-group/claude-opus-5-5", "params": {"reasoning_effort": "medium", "max_tokens": 16000}},
    {"model": "claude-group/claude-sonnet-5-5", "params": {"reasoning_effort": "low", "max_tokens": 16000}},
    {"model": "openai-group/gpt-6.1-sol", "params": {"reasoning_effort": "low", "max_tokens": 16000}},
    {"model": "gemini-group/gemini-3.8-flash", "params": {"reasoning_effort": "low", "max_tokens": 16000}},
    {"model": "claude-group/claude-haiku-5-5", "params": {"reasoning_effort": "low", "max_tokens": 16000}}
  ],
  "judge": [
    {"model": "gemini-group/gemini-4-argon", "params": {"reasoning_effort": "high", "max_tokens": 16000}},
    {"model": "openai-group/gpt-6-astra", "params": {"reasoning_effort": "high", "max_tokens": 16000}},
    {"model": "claude-group/claude-opus-5-5", "params": {"reasoning_effort": "max", "max_tokens": 32000}},
    {"model": "claude-group/claude-fable-5-1", "params": {"reasoning_effort": "high", "max_tokens": 32000}}
  ]
}
```

Fallback design. A fallback should change failure domain, so prefer a different family over a different route of the same backend.
- `claude-group` and `anthropic-primary` are one backend.
- Bedrock and Foundry are independent, but only as prompt-JSON routes: no `response_format`.
- A good chain for Opus-primary steps: `claude-group/claude-opus-5-5` → `gemini-group/gemini-4-argon` (or `openai-group/gpt-6.1-sol` for edit) → `aws-bedrock/global.anthropic.claude-opus-5-5` without a schema.

Benchmark hygiene:
- Label Gemini 3.5 and 3.7 Flash results by the *served* model.
- Always send `reasoning_effort` to GPT-6.x when using `response_format`.
- Keep schemas free of type unions (for Gemini) and numeric `minimum`/`maximum` (Anthropic rejects them, per [TrueFoundry](https://www.truefoundry.com/docs/ai-gateway/anthropic.md)).
- Run at least 3 trials per case. Latency varies 2–4× trial to trial (Argon 10–43 s on the same diff).

---

## 7. Caveats
- Many October 2026 numbers come from secondary write-ups: Vellum, MindStudio, aggregators. The strongest independent sources here are Roboflow Vision Evals, Andon Labs Blueprint-Bench 2, PhysVista and Artificial Analysis. ERQA 87% for Argon and BenchCAD 95.9 for Astra are vendor-reported.
- I could not parse the Opus 5.5 system card PDF (over 10 MB). Its vision tables are cited only through secondary sources.
- Our probes are smoke tests (n = 2–8 per cell) on clean and synthetic inputs, where the top tier saturates. They are trustworthy for **gateway behaviour and latency**, not for small quality gaps. Real photos and hand sketches in `ai/bench` will separate the models more.
- Gemini 4 Argon is two days into general availability. Its gateway latency and stability will probably change, so re-probe before finalising.

## Sources
- Anthropic, Claude Opus 5.5 launch page: https://www.anthropic.com/claude-opus-5-5 · system card: https://www-cdn.anthropic.com/fc1b44717c85dc068bc6ba5024219938094694bd/Claude%20Opus%205.5%20System%20Card.pdf
- Claude docs: vision https://platform.claude.com/docs/en/build-with-claude/vision · coordinates https://platform.claude.com/docs/en/build-with-claude/vision-coordinates · effort https://platform.claude.com/docs/en/build-with-claude/effort · fast mode https://platform.claude.com/docs/en/build-with-claude/fast-mode
- Roboflow Vision Evals: https://playground.roboflow.com/evals · Opus 5.5 https://playground.roboflow.com/models/anthropic/claude-opus-5-5 · Fable 5.1 vs Opus 5.5 https://playground.roboflow.com/models/compare/claude-fable-5-1-vs-claude-opus-5-5
- Andon Labs Blueprint-Bench 2: https://andonlabs.com/evals/blueprint-bench-2
- PhysVista (arXiv 2610.00559): https://arxiv.org/html/2610.00559
- Google: Gemini 4 Argon for robotics (ERQA) https://developers.googleblog.com/gemini-4-argon-for-robotics/ · model page https://ai.google.dev/gemini-api/docs/models/gemini-4-argon · image understanding (box_2d) https://ai.google.dev/gemini-api/docs/image-understanding · DeepMind comparison table https://deepmind.google/models/gemini/
- Artificial Analysis: leaderboard https://artificialanalysis.ai/leaderboards/models · Opus 5.5 by effort https://artificialanalysis.ai/models/claude-opus-5-5-low, https://artificialanalysis.ai/models/claude-opus-5-5-medium, https://artificialanalysis.ai/models/claude-opus-5-5-xhigh · Gemini 4 Argon https://artificialanalysis.ai/models/gemini-4-argon
- OpenAI: GPT-6 Sol/Luna October update https://deploymentsafety.openai.com/gpt-6-october · vision guide https://developers.openai.com/api/docs/guides/images-vision · GPT-6 Astra benchmarks (Vellum) https://www.vellum.ai/blog/gpt-6-astra-benchmarks-explained · GPT-6.1 Sol (The Batch) https://www.deeplearning.ai/the-batch/sol-nearly-eclipses-astra · (ProPakistani) https://propakistani.pk/2026/09/30/gpt-6-1-sol-brings-astra-level-performance-at-5x-lower-cost/
- Claude Sonnet 5.5: https://letsdatascience.com/news/anthropic-releases-claude-sonnet-55-with-faster-responses-an-95c4c0b5 · Haiku 5.5: https://gori.me/?p=171039 · Opus 5.5 benchmarks (Vellum): https://www.vellum.ai/blog/claude-opus-5-5-benchmarks-explained
- Gemini 3.8 Flash speed/verbosity: https://www.eesel.ai/blog/gemini-3-8-flash-review · Gemini 4 Argon commentary: https://www.mindstudio.ai/blog/gemini-4-argon-benchmarks
- ERQA aggregator: https://benchlm.ai/benchmarks/erqa · BenchCAD: https://arxiv.org/pdf/2605.10865
- Spatial/metric limits: IDEAL-Bench https://arxiv.org/html/2607.03614 · Metric-Bench https://arxiv.org/html/2609.25841 · MindEdit-Bench https://arxiv.org/abs/2607.00491 · StateSight https://arxiv.org/abs/2608.20414
- Structured output: SOB https://interfaze.ai/blog/introducing-structured-output-benchmark · https://arxiv.org/html/2604.25359v1
- Judges: MLLM self-preference https://arxiv.org/abs/2604.11589 · preference leakage https://arxiv.org/abs/2502.01534 · MMRB2 https://arxiv.org/abs/2512.16899
- TrueFoundry gateway (Anthropic): https://www.truefoundry.com/docs/ai-gateway/anthropic.md
