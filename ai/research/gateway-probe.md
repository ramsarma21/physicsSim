# Gateway probe: TrueFoundry chat routes

Measured 2026-10-15 10:13 UTC against `https://tfy.promptlens.trilogy.com/v1` by `ai/research/probe.mjs` (machine-readable: `gateway-probe.json`, whose top-level `summary` has one row per deep-probed route). At most 4 requests in flight. Medians of 3 trials.

**How to read latency cells:** `adjusted (wall)`. *Wall* is what this Mac saw. *Adjusted* subtracts the time spent outside the gateway's own processing (wall at response headers minus the gateway's `server-timing` total: queueing on the connection, network, TLS). Adjusted is the fair number for comparing models; section 7 has wall-clock numbers with one request in flight. All latency runs use HTTP/1.1 (section 6 explains why).

<!-- notes:start -->
## Findings and recommendations

About 3,500 calls in total on 15 Oct 2026: a deep probe of 37 routes (about 1,700 calls), a sweep of 281 routes (769 calls), a one-at-a-time latency pass and a transport A/B test. Never more than 4 requests were in flight.

### 1. The biggest latency fix is client-side: use HTTP/1.1 for parallel calls
- **The problem.** Node 26's built-in `fetch` (undici 8) negotiates HTTP/2 with this gateway and puts every request a process makes on one connection. The gateway then serves those requests one after another.
- **The measurement** (section 6, tiny calls, 4 in flight):
  - `fetch`: about **0.8–1.0 s** of extra wait per call, 2.3–2.5 calls/s.
  - `node:https` with a keep-alive socket per request: about **45 ms** extra, 5.4–7.3 calls/s.
  - In the first deep-probe run, which used `fetch` with big prompts, the extra wait grew to 10–70 s per call. The extra disappeared after the switch: median 90 ms, p90 260 ms over 628 latency calls, and the remaining time is upload time.
- **What to do.** `ai/core.mjs` calls `globalThis.fetch`. One call per process is unaffected, but the bench runner and anything else that runs calls in parallel in one process must pass `fetch: fetchH1` from `ai/research/fetch-h1.mjs`. It is a drop-in, dependency-free HTTP/1.1 replacement that also retries once when a reused keep-alive socket is reset.
- Latency numbers taken from parallel `fetch` calls in one process (for example some in `model-research.md`) are inflated by this queueing. Every number below was measured over HTTP/1.1.

### 2. Reliability is good. Retry 502, 503 and socket resets
- **Deep probe:** 16 transport errors in 1,698 calls. 10 of them came from Gemini 3.1 Pro, which is unusable: 20–140 s per call or a timeout. The other 6 in about 1,640 calls (0.4%) were:
  - 3 gateway 502 HTML pages plus 1 keep-alive reset right after one of them (`gemini-group/gemini-4-argon`),
  - 1 Grok 4.7 timeout,
  - 1 gateway 502 on `claude-group/claude-fable-5`.
- **Sweep:** 6 transport errors in 769 calls: Gemini `*-flex` tiers answered 503 "high demand" on 4 of 70 calls, plus one Bedrock-EU 502 and one timeout (Gemini 3.1 Pro custom-tools).
- **False content-filter refusals: Claude Fable 5.1 only.** On the harmless scene-edit prompt it returned `finish_reason: "content_filter"` with zero output tokens 7 times across both routes (about 30% of its short-edit runs). No other model ever did.
- **No 429s anywhere.** Provider limits are far above our needs. anthropic-primary allows 20k requests per minute and 40M input tokens per minute; openai-primary 15k requests and 40M tokens per minute; xai 24k requests per minute. Azure and Microsoft Foundry are the lowest at 2k requests and 2M tokens per minute. Bedrock and Gemini send no limit headers. The key's budget rule was never violated.
- **Recommended `core.mjs` policy:** retry 502, 503, 504, `ECONNRESET` and timeouts twice with backoff (the current default), then fall back. Treat `finish_reason: "content_filter"` or an empty reply as a failure that moves on to the fallback.

### 3. Which route to use per model
Latency comes from section 7: wall-clock, one request in flight, median of 3. *Short* is a tiny edit; *big* is an 8–10k-token catalog prompt plus one 1536×864 render with a short JSON answer.

**Fastest vs most reliable route.** Within one model, every working route had the same latency within noise (3 trials each; section 4), and only `gemini-group/gemini-4-argon` had errors. So the route choice rests on features and fallback behaviour, not speed:
- `claude-group/` is the best Claude route: Anthropic-native features, plus Bedrock as an automatic fallback.
- `openai-group/` and `openai-primary/` are the same backend, as are `xai-group/` and `xai-primary/`.
- For Gemini, the direct `gemini-primary/` route avoids falling back onto another team's allocation.

| Model | Route to use | short / big (default effort) | fastest setting: short / big | Why this route; caveats |
|---|---|---|---|---|
| **Claude Opus 5.5** | `claude-group/claude-opus-5-5` | 2.8 s / 4.5 s | `minimal` 2.6 s / 2.7 s | anthropic-primary, with Bedrock-global as the gateway's automatic fallback. It never fell back in 48 calls. **Strict `json_schema` works only on the Anthropic backend.** On the Bedrock routes (`global`/`us`) the gateway turns the schema into a forced tool, which Opus/Sonnet 5.5 reject with a 400. All 5 Opus 5.5 routes had the same latency within noise and 0 errors. |
| **Claude Sonnet 5.5** | `claude-group/claude-sonnet-5-5` | 1.9 s / 4.0 s | `thinking:{type:"between_tools"}` 1.8 s / 3.0 s | Same structure and the same `json_schema`/Bedrock caveat as Opus 5.5. |
| **Claude Haiku 5.5** | `claude-group/claude-haiku-5-5` | 1.5 s / 5.3 s | `thinking:{type:"disabled"}` 1.5 s / 1.9 s | anthropic-primary only, with no fallback. Use `claude-group/claude-haiku-4-5` as the fallback. Miscounted 1 of 4 images. |
| **Claude Fable 5.1** | `claude-group/claude-fable-5-1`, **if at all** | 2.8 s / 4.6 s | `none` 2.3 s / 5.8 s | anthropic-primary only; the `azure-foundry-quark/` and `microsoft-foundry-quark/` routes answer (sweep). **It answered about 30% of the plain scene-edit prompts with `content_filter` and an empty reply** (see §2 above). Fable 5 did not do this. |
| **Gemini 4 Argon** | `gemini-primary/gemini-4-argon` | 3.3 s / 5.8 s (group route) | `none` 2.6 s / 4.9 s | `gemini-group/` falls back to `vertex-contract-analyzer/`, another team's allocation, and had 4 of 43 errors (502s) in our window; the direct route had 0 of 42. The default thinking level varies a lot: 7–22 s on the big task in the deep probe. |
| **Gemini 3.8 Flash** | either route, **always with `reasoning_effort: "minimal"` or `"low"`** | 3.5 s / **55 s** | `minimal` 4.0 s / 13.5 s | At default effort it spent 2k–15k reasoning tokens on the image-plus-catalog task, and in a 4,000-token trial it ran out of `max_tokens` before answering. `none` is accepted but it still thinks (330–470 tokens on a small task). |
| **GPT-6.1 Sol** | `openai-group/gpt-6.1-sol` | 2.0 s / 10.1 s | `low` 1.7 s / 7.2 s | The same backend as `openai-primary`, with no fallback. **Strict `json_schema` and tools need `reasoning_effort` of `"low"` or higher.** The default and `"none"` both return a 400, even though the error text suggests `none`. |
| **GPT-5.4 mini** | `openai-group/gpt-5.4-mini` | **0.8 s / 1.2 s** | `none` 0.6 s / 1.5 s | The fastest capable model; every JSON and tool mode works. Weaker on vision: one 4-image count off by one, and it said 1 image when 4 were sent. A fit for quick checks, intent classification and JSON repair. |
| **Grok 4.7** | `xai-primary/grok-4.7` | 5.9 s / **178 s** | `low` 5.5 s / 60 s | Spent 0.8k–2.7k reasoning tokens at every effort setting, even on a small physics question. It refused the plain "reply with the single word: pong" instruction, and one big-task call timed out at 240 s. Not for interactive steps. |
| **Qwen3-VL 235B** | `bedrock-oss-group/qwen3-vl-235b` | 1.3 s / 5.1 s | `none` 1.2 s / 7.0 s | Fast, but wrong on the two-step projectile question at every setting. Its request-body limit is under 6.6 MB: 4 × 1.2 MB images return a 400 "length limit exceeded". |
| Gemini 3.1 Pro | do not use | – / 112 s | – | 20–140 s or a timeout, even for "pong". `gemini-primary/gemini-3.1-pro-preview` never answered within 90 s. |

For comparison on the same tasks (deep probe, adjusted): Opus 4.8 1.0 s / 3.3 s, Sonnet 5 1.5 s / 1.8 s, Haiku 4.5 0.8–1.0 s / 1.7–2.1 s. These older models, however, counted the 7 dominoes wrong in most trials: Opus 4.8 1 of 9, Haiku 4.5 0 of 9, Sonnet 4.6 3 of 9.

### 4. Parameter rules for `ai/models.json` and `core.mjs` (measured)
- **Every route:**
  - `max_tokens` works everywhere, and a 40-token cap was honoured everywhere. `max_completion_tokens` works too.
  - Output caps of 32k, 64k and 128k are accepted everywhere except Haiku 4.5, whose limit is 64k (128k returns a 400).
  - Never send a loose `{"type":"object"}` schema (see `model-research.md`).
- **Claude 5.5 family** (Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5.x):
  - **No `temperature`** (400, "deprecated").
  - `reasoning_effort` is accepted with `none`, `minimal`, `low`, `medium` and `high`; it maps to adaptive thinking.
  - `thinking: {type:"enabled", budget_tokens}` returns a 400.
  - Turning thinking off: `{type:"disabled"}` returns a 400 on Opus 5.5 and Fable; Sonnet 5.5 needs `{type:"between_tools"}` instead; Haiku 5.5 accepts `disabled`.
  - **A forced `tool_choice` (a named function, `required` or `any`) returns a 400** on Opus 5.5, Sonnet 5.5 and Fable 5.1. Use `tool_choice: "auto"` or `response_format: json_schema`.
  - Older Claude models (Opus 5, Opus 4.8, Sonnet 5, Sonnet 4.6, Haiku 4.5) accept `temperature` 0 and forced tools.
  - Claude 5.x and Opus 4.8 count the big prompt as about 10.0k tokens; Sonnet 4.6 and Haiku 4.5 count it as 8.1k (an older tokenizer). GPT counts it as 7.7k and Gemini as 8.1k.
- **Claude on Bedrock:**
  - `response_format: json_schema` returns a 400 for Opus and Sonnet 5.5, so those routes are prompt-JSON fallbacks only: drop `response_format`, validate locally and repair once.
  - `claude-group/*` sent about 7% of calls (3 of 42) to Bedrock for Opus 5, Opus 4.8, Sonnet 5 and Haiku 4.5. A `json_schema` request that lands there fails, so `core.mjs` must answer that particular 400 by retrying without `response_format`.
- **Gemini:**
  - `reasoning_effort` is accepted with `none` through `high`.
  - `thinking` combined with `output_config` returns a 400.
  - A budget-style `thinking` parameter works on Argon but returns a 400 on 3.8 Flash ("MINIMAL not supported").
  - `temperature` 0 is fine, and `json_schema` strict and both tool modes work.
- **GPT-6.x:**
  - `temperature` returns a 400, and `thinking` returns a 400 ("Unknown parameter").
  - Tools and `json_schema` need an explicit `reasoning_effort`. 6.1 Sol and 6 Astra need `low` or higher; 6 Sol and 6 Luna also accept `none`.
  - GPT-5.5 and 5.4 mini accept every mode.
- **Images:**
  - A 1536 px JPEG sent as a data URL worked on every vision route, and 1, 2 and 4 images were all accepted.
  - A 4-image body of about 6.6 MB was rejected only by Qwen3-VL. Keep images at ≤ 1536 px and about q0.85, which gives 90–300 KB each, as `DESIGN.md` plans.
  - Counting accuracy (the shapes fixtures) was perfect on the 1-image test everywhere. The 4-image test was missed by Sonnet 5, Haiku 5.5, Haiku 4.5 and GPT-5.4 mini.

### 5. Routes not to use, and aliases
- **Not usable with this key:**
  - `claude-max-traffic/*` and `claude-pro-traffic/*` all return 401, as do 4 of the 8 `claude-pro-group/*` routes. The other 4 are aliases: `claude-pro-group/claude-opus` is Opus 4.8 and `claude-pro-group/claude-sonnet` is Sonnet 5.
  - `anthropic-primary/claude-4-*` and `claude-opus-4-1*` return 404 (retired), and `openai-primary/gpt-5.3-chat-latest` returns 404 (deprecated).
- **Aliases:** `*gemini-3.5-flash` is served by 3.6-flash, `*gemini-3.7-flash` by 3.8-flash, and `*grok-latest` by grok-4.7.
- **Fallbacks that swap the model:** `openai-group/gpt-5` and `gpt-5-mini` fall back to `aws-bedrock/openai.gpt-oss-120b`, a different and weaker model. `gemini-group/gemini-2.5-*` resolve straight to `vertex-contract-analyzer/`.
- `claude-group/claude-opus-4-5` resolves to an `anthropic-fast/` backend.
<!-- notes:end -->

## 1. Capability matrix (deep probe)

yes = accepted and the answer checked out · partial = accepted but the answer was wrong or unparseable · no = rejected (4xx) · err = 5xx/timeout · skip = slow route (over 15 s for "pong" or two timeouts), only the decisive tests and one latency trial were run · – = not run.

| Model route | Resolves to (calls) | Works | json_object | json_schema strict | tools forced / auto | same 3, effort none | same 3, effort low | 1 image 1536 | 2 images | 4 images | 4 heavy (~6.6 MB body) | temp 0 | token param | 40-token cap honoured | 32k / 64k / 128k out |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `claude-group/claude-opus-5-5` | anthropic-primary ×48 | yes | yes | yes | no / yes | yes / no / yes | yes / no / yes | yes | yes | yes | yes | no | max_tokens | yes | ok / ok / ok |
| `anthropic-primary/claude-opus-5-5` | direct (anthropic) | yes | yes | yes | no / yes | yes / no / yes | yes / no / yes | yes | yes | yes | yes | no | max_tokens | yes | ok / ok / ok |
| `aws-bedrock/global.anthropic.claude-opus-5-5` | direct (aws-bedrock) | yes | yes | no | no / yes | no / no / yes | no / no / yes | yes | yes | yes | yes | yes | max_tokens | yes | ok / ok / ok |
| `aws-bedrock/us.anthropic.claude-opus-5-5` | direct (aws-bedrock) | yes | yes | no | no / yes | no / no / yes | no / no / yes | yes | yes | yes | yes | yes | max_tokens | yes | ok / ok / ok |
| `claude-opus-5-5` | anthropic-primary ×48 | yes | yes | yes | no / yes | yes / no / yes | yes / no / yes | yes | yes | yes | yes | no | max_tokens | yes | ok / ok / ok |
| `claude-group/claude-opus-5` | anthropic-primary ×45, aws-bedrock/global ×3 | yes | yes | yes | yes / yes | yes / yes / yes | yes / yes / yes | yes | yes | yes | yes | yes | max_tokens | yes | ok / ok / ok |
| `claude-group/claude-opus-4-8` | anthropic-primary ×45, aws-bedrock/global ×3 | yes | yes | yes | yes / yes | yes / yes / yes | yes / yes / yes | yes | yes | yes | yes | yes | max_tokens | yes | ok / ok / ok |
| `claude-group/claude-sonnet-5-5` | anthropic-primary ×48 | yes | yes | yes | no / yes | yes / no / yes | yes / no / yes | yes | yes | yes | partial | no | max_tokens | yes | ok / ok / ok |
| `anthropic-primary/claude-sonnet-5-5` | direct (anthropic) | yes | yes | yes | no / yes | yes / no / yes | yes / no / yes | yes | yes | yes | partial | no | max_tokens | yes | ok / ok / ok |
| `aws-bedrock/global.anthropic.claude-sonnet-5-5` | direct (aws-bedrock) | yes | yes | no | no / yes | no / no / yes | no / no / yes | yes | yes | yes | yes | yes | max_tokens | yes | ok / ok / ok |
| `claude-group/claude-sonnet-5` | anthropic-primary ×45, aws-bedrock/global ×3 | yes | yes | yes | yes / yes | yes / yes / yes | yes / yes / yes | yes | partial | partial | yes | yes | max_tokens | yes | ok / ok / ok |
| `claude-group/claude-sonnet-4-6` | anthropic-primary ×47, aws-bedrock/global ×1 | yes | yes | yes | yes / yes | yes / yes / yes | yes / yes / yes | yes | yes | yes | yes | yes | max_tokens | yes | ok / ok / ok |
| `claude-group/claude-haiku-5-5` | anthropic-primary ×48 | yes | yes | yes | yes / yes | yes / yes / yes | yes / yes / yes | yes | yes | partial | yes | no | max_tokens | yes | ok / ok / ok |
| `anthropic-primary/claude-haiku-5-5` | direct (anthropic) | yes | yes | yes | yes / yes | yes / yes / yes | yes / yes / yes | yes | yes | yes | yes | no | max_tokens | yes | ok / ok / ok |
| `claude-group/claude-haiku-4-5` | anthropic-primary ×45, aws-bedrock/global ×3 | yes | yes | yes | yes / yes | yes / yes / yes | yes / yes / yes | yes | yes | yes | yes | yes | max_tokens | yes | ok / ok / no |
| `aws-bedrock/global.anthropic.claude-haiku-4-5-20251001-v1-0` | direct (aws-bedrock) | yes | yes | yes | yes / yes | yes / yes / yes | yes / yes / yes | yes | yes | partial | yes | yes | max_tokens | yes | ok / ok / no |
| `claude-group/claude-fable-5-1` | anthropic-primary ×48 | yes | yes | yes | no / yes | yes / no / yes | yes / no / yes | yes | yes | yes | yes | no | max_tokens | yes | ok / ok / ok |
| `anthropic-primary/claude-fable-5-1` | direct (anthropic) | yes | yes | yes | no / yes | yes / no / yes | yes / no / yes | yes | yes | yes | yes | no | max_tokens | yes | ok / ok / ok |
| `claude-group/claude-fable-5` | anthropic-primary ×48 | yes | yes | yes | yes / yes | yes / yes / yes | yes / yes / yes | yes | yes | yes | yes | no | max_tokens | yes | ok / ok / ok |
| `gemini-group/gemini-4-argon` | gemini-primary ×45 | yes | yes | yes | yes / yes | yes / yes / yes | yes / yes / yes | yes | yes | yes | yes | yes | max_tokens | yes | ok / ok / ok |
| `gemini-primary/gemini-4-argon` | direct (google) | yes | yes | yes | yes / yes | yes / yes / yes | yes / yes / yes | yes | yes | yes | yes | yes | max_tokens | yes | ok / ok / ok |
| `gemini-group/gemini-3.1-pro` | gemini-primary ×6 | yes | err | err | skip / err | – / – / – | – / – / – | err | skip | err | skip | skip | – | – | skip / skip / skip |
| `gemini-primary/gemini-3.1-pro-preview` | – | **no**: no complete response within 90000 ms | | | | | | | | | | | | | |
| `gemini-group/gemini-3.8-flash` | gemini-primary ×48 | yes | yes | yes | yes / yes | yes / yes / yes | yes / yes / yes | yes | yes | yes | yes | yes | max_tokens | yes | ok / ok / ok |
| `gemini-primary/gemini-3.8-flash` | direct (google) | yes | yes | yes | yes / yes | yes / yes / yes | yes / yes / yes | yes | yes | yes | yes | yes | max_tokens | yes | ok / ok / ok |
| `gemini-group/gemini-3.5-flash-lite` | gemini-primary ×48 | yes | yes | yes | yes / yes | yes / yes / yes | yes / yes / yes | yes | yes | yes | yes | yes | max_tokens | yes | ok / ok / ok |
| `openai-group/gpt-6.1-sol` | openai-primary ×48 | yes | yes | no | no / no | no / no / no | yes / yes / yes | yes | yes | yes | yes | no | max_tokens | yes | ok / ok / ok |
| `openai-primary/gpt-6.1-sol` | direct (openai) | yes | yes | no | no / no | no / no / no | yes / yes / yes | yes | yes | yes | yes | no | max_tokens | yes | ok / ok / ok |
| `openai-group/gpt-6-sol` | openai-primary ×48 | yes | yes | no | no / no | yes / yes / yes | yes / yes / yes | yes | yes | yes | yes | no | max_tokens | yes | ok / ok / ok |
| `openai-group/gpt-6-astra` | openai-primary ×48 | yes | yes | no | no / no | no / no / no | yes / yes / yes | yes | yes | yes | yes | no | max_tokens | yes | ok / ok / ok |
| `openai-group/gpt-6-luna` | openai-primary ×48 | yes | yes | no | no / no | yes / yes / yes | yes / yes / yes | yes | yes | yes | yes | no | max_tokens | yes | ok / ok / ok |
| `openai-group/gpt-5.5` | openai-primary ×48 | yes | yes | yes | yes / yes | yes / yes / yes | yes / yes / yes | yes | yes | yes | partial | no | max_tokens | yes | ok / ok / ok |
| `openai-group/gpt-5.4-mini` | openai-primary ×48 | yes | yes | yes | yes / yes | yes / yes / yes | yes / yes / yes | yes | yes | partial | partial | yes | max_tokens | yes | ok / ok / ok |
| `xai-group/grok-4.7` | xai-primary ×47 | yes (refused "pong") | yes | yes | yes / yes | yes / yes / yes | yes / yes / yes | yes | yes | yes | yes | partial | max_tokens | yes | ok / ok / ok |
| `xai-primary/grok-4.7` | direct (xai) | yes | yes | yes | yes / yes | yes / yes / yes | yes / yes / yes | yes | yes | yes | yes | yes | max_tokens | yes | ok / ok / ok |
| `bedrock-oss-group/qwen3-vl-235b` | aws-bedrock ×48 | yes | yes | yes | yes / yes | yes / yes / yes | yes / yes / yes | yes | yes | yes | no | yes | max_tokens | yes | ok / ok / ok |
| `aws-bedrock/qwen.qwen3-vl-235b-a22b` | direct (aws-bedrock) | yes | yes | yes | yes / yes | yes / yes / yes | yes / yes / yes | yes | yes | yes | no | yes | max_tokens | yes | ok / ok / ok |

<details><summary>Why routes said "no" (gateway/provider messages)</summary>

- **temperature_0**: anthropic error: `temperature` is deprecated for this model. — `claude-group/claude-opus-5-5`, `anthropic-primary/claude-opus-5-5`, `claude-opus-5-5`, `claude-group/claude-sonnet-5-5`, `anthropic-primary/claude-sonnet-5-5`, `claude-group/claude-haiku-5-5`, `anthropic-primary/claude-haiku-5-5`, `claude-group/claude-fable-5-1`, `anthropic-primary/claude-fable-5-1`, `claude-group/claude-fable-5`
- **tools_forced**: anthropic error: tool_choice: type "tool" and "any" are not supported for this model. — `claude-group/claude-opus-5-5`, `anthropic-primary/claude-opus-5-5`, `claude-opus-5-5`, `claude-group/claude-sonnet-5-5`, `anthropic-primary/claude-sonnet-5-5`, `claude-group/claude-fable-5-1`, `anthropic-primary/claude-fable-5-1`
- **reasoning_thinking_budget**: anthropic error: "thinking.type.enabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort" to control thinking behavior. — `claude-group/claude-opus-5-5`, `anthropic-primary/claude-opus-5-5`, `claude-opus-5-5`, `claude-group/claude-sonnet-5-5`, `anthropic-primary/claude-sonnet-5-5`, `claude-group/claude-haiku-5-5`, `anthropic-primary/claude-haiku-5-5`, `claude-group/claude-fable-5-1`, `anthropic-primary/claude-fable-5-1`, `claude-group/claude-fable-5`
- **reasoning_thinking_disabled**: anthropic error: "thinking.type.disabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort" to control thinking behavior. — `claude-group/claude-opus-5-5`, `anthropic-primary/claude-opus-5-5`, `claude-opus-5-5`, `claude-group/claude-fable-5-1`, `anthropic-primary/claude-fable-5-1`, `claude-group/claude-fable-5`
- **reasoning_thinking_between_tools**: anthropic error: "thinking.type.between_tools" is not supported for this model. — `claude-group/claude-opus-5-5`, `anthropic-primary/claude-opus-5-5`, `claude-opus-5-5`, `claude-group/claude-haiku-5-5`, `anthropic-primary/claude-haiku-5-5`, `claude-group/claude-fable-5-1`, `anthropic-primary/claude-fable-5-1`, `claude-group/claude-fable-5`
- **tools_forced_effort_none**: anthropic error: tool_choice: type "tool" and "any" are not supported for this model. — `claude-group/claude-opus-5-5`, `anthropic-primary/claude-opus-5-5`, `claude-opus-5-5`, `claude-group/claude-sonnet-5-5`, `anthropic-primary/claude-sonnet-5-5`, `claude-group/claude-fable-5-1`, `anthropic-primary/claude-fable-5-1`
- **tools_forced_effort_low**: anthropic error: tool_choice: type "tool" and "any" are not supported for this model. — `claude-group/claude-opus-5-5`, `anthropic-primary/claude-opus-5-5`, `claude-opus-5-5`, `claude-group/claude-sonnet-5-5`, `anthropic-primary/claude-sonnet-5-5`, `claude-group/claude-fable-5-1`, `anthropic-primary/claude-fable-5-1`
- **json_schema_strict**: aws-bedrock error: The model returned the following errors: tool_choice: type "tool" and "any" are not supported for this model. — `aws-bedrock/global.anthropic.claude-opus-5-5`, `aws-bedrock/us.anthropic.claude-opus-5-5`, `aws-bedrock/global.anthropic.claude-sonnet-5-5`
- **tools_forced**: aws-bedrock error: The model returned the following errors: tool_choice: type "tool" and "any" are not supported for this model. — `aws-bedrock/global.anthropic.claude-opus-5-5`, `aws-bedrock/us.anthropic.claude-opus-5-5`, `aws-bedrock/global.anthropic.claude-sonnet-5-5`
- **reasoning_thinking_budget**: aws-bedrock error: The model returned the following errors: "thinking.type.enabled" is not supported for this model. Use "thinking.type.adaptive" and "output_co — `aws-bedrock/global.anthropic.claude-opus-5-5`, `aws-bedrock/us.anthropic.claude-opus-5-5`, `claude-group/claude-opus-5`, `claude-group/claude-opus-4-8`, `aws-bedrock/global.anthropic.claude-sonnet-5-5`, `claude-group/claude-sonnet-5`
- **reasoning_thinking_disabled**: aws-bedrock error: The model returned the following errors: "thinking.type.disabled" is not supported for this model. Use "thinking.type.adaptive" and "output_c — `aws-bedrock/global.anthropic.claude-opus-5-5`, `aws-bedrock/us.anthropic.claude-opus-5-5`
- **reasoning_thinking_between_tools**: aws-bedrock error: The model returned the following errors: "thinking.type.between_tools" is not supported for this model. — `aws-bedrock/global.anthropic.claude-opus-5-5`, `aws-bedrock/us.anthropic.claude-opus-5-5`, `claude-group/claude-opus-5`, `claude-group/claude-opus-4-8`, `claude-group/claude-sonnet-5`, `claude-group/claude-sonnet-4-6`, `claude-group/claude-haiku-4-5`, `aws-bedrock/global.anthropic.claude-haiku-4-5-20251001-v1-0`
- **json_schema_strict_effort_none**: aws-bedrock error: The model returned the following errors: tool_choice: type "tool" and "any" are not supported for this model. — `aws-bedrock/global.anthropic.claude-opus-5-5`, `aws-bedrock/us.anthropic.claude-opus-5-5`, `aws-bedrock/global.anthropic.claude-sonnet-5-5`
- **tools_forced_effort_none**: aws-bedrock error: The model returned the following errors: tool_choice: type "tool" and "any" are not supported for this model. — `aws-bedrock/global.anthropic.claude-opus-5-5`, `aws-bedrock/us.anthropic.claude-opus-5-5`, `aws-bedrock/global.anthropic.claude-sonnet-5-5`
- **json_schema_strict_effort_low**: aws-bedrock error: The model returned the following errors: tool_choice: type "tool" and "any" are not supported for this model. — `aws-bedrock/global.anthropic.claude-opus-5-5`, `aws-bedrock/us.anthropic.claude-opus-5-5`, `aws-bedrock/global.anthropic.claude-sonnet-5-5`
- **tools_forced_effort_low**: aws-bedrock error: The model returned the following errors: tool_choice: type "tool" and "any" are not supported for this model. — `aws-bedrock/global.anthropic.claude-opus-5-5`, `aws-bedrock/us.anthropic.claude-opus-5-5`, `aws-bedrock/global.anthropic.claude-sonnet-5-5`
- **reasoning_thinking_disabled**: anthropic error: To turn thinking off on this model, send "thinking": {"type": "between_tools"} instead of {"type": "disabled"}. The model does not think before — `claude-group/claude-sonnet-5-5`, `anthropic-primary/claude-sonnet-5-5`
- **reasoning_thinking_disabled**: aws-bedrock error: The model returned the following errors: To turn thinking off on this model, send "thinking": {"type": "between_tools"} instead of {"type": " — `aws-bedrock/global.anthropic.claude-sonnet-5-5`
- **max_out_128k**: aws-bedrock error: The maximum tokens you requested exceeds the model limit of 64000. Try again with a maximum tokens value that is lower than 64000. — `claude-group/claude-haiku-4-5`, `aws-bedrock/global.anthropic.claude-haiku-4-5-20251001-v1-0`
- **reasoning_thinking_adaptive**: aws-bedrock error: The model returned the following errors: adaptive thinking is not supported on this model — `claude-group/claude-haiku-4-5`, `aws-bedrock/global.anthropic.claude-haiku-4-5-20251001-v1-0`
- **reasoning_thinking_adaptive**: gcp error: Invalid JSON payload received. Unknown name "output_config": Cannot find field. — `gemini-group/gemini-4-argon`, `gemini-primary/gemini-4-argon`, `gemini-group/gemini-3.8-flash`, `gemini-primary/gemini-3.8-flash`, `gemini-group/gemini-3.5-flash-lite`
- **reasoning_thinking_budget**: gcp error: Thinking level MINIMAL is not supported for this model. Please retry with other thinking level. — `gemini-group/gemini-3.8-flash`, `gemini-primary/gemini-3.8-flash`
- **temperature_0**: openai error: Unsupported value: 'temperature' does not support 0 with this model. Only the default (1) value is supported. — `openai-group/gpt-6.1-sol`, `openai-primary/gpt-6.1-sol`, `openai-group/gpt-6-sol`, `openai-group/gpt-6-astra`, `openai-group/gpt-6-luna`, `openai-group/gpt-5.5`
- **json_schema_strict**: openai error: Function tools with reasoning_effort are not supported for gpt-6.1-sol in /v1/chat/completions. To use function tools, use /v1/responses or set re — `openai-group/gpt-6.1-sol`, `openai-primary/gpt-6.1-sol`
- **tools_forced**: openai error: Function tools with reasoning_effort are not supported for gpt-6.1-sol in /v1/chat/completions. To use function tools, use /v1/responses or set re — `openai-group/gpt-6.1-sol`, `openai-primary/gpt-6.1-sol`
- **tools_auto**: openai error: Function tools with reasoning_effort are not supported for gpt-6.1-sol in /v1/chat/completions. To use function tools, use /v1/responses or set re — `openai-group/gpt-6.1-sol`, `openai-primary/gpt-6.1-sol`
- **reasoning_thinking_disabled**: openai error: Unknown parameter: 'thinking'. — `openai-group/gpt-6.1-sol`, `openai-primary/gpt-6.1-sol`, `openai-group/gpt-6-sol`, `openai-group/gpt-6-astra`, `openai-group/gpt-6-luna`, `openai-group/gpt-5.5`, `openai-group/gpt-5.4-mini`
- **json_schema_strict_effort_none**: openai error: Function tools with reasoning_effort are not supported for gpt-6.1-sol in /v1/chat/completions. To use function tools, use /v1/responses or set re — `openai-group/gpt-6.1-sol`, `openai-primary/gpt-6.1-sol`
- **tools_forced_effort_none**: openai error: Function tools with reasoning_effort are not supported for gpt-6.1-sol in /v1/chat/completions. To use function tools, use /v1/responses or set re — `openai-group/gpt-6.1-sol`, `openai-primary/gpt-6.1-sol`
- **tools_auto_effort_none**: openai error: Function tools with reasoning_effort are not supported for gpt-6.1-sol in /v1/chat/completions. To use function tools, use /v1/responses or set re — `openai-group/gpt-6.1-sol`, `openai-primary/gpt-6.1-sol`
- **json_schema_strict**: openai error: Function tools with reasoning_effort are not supported for gpt-6-sol in /v1/chat/completions. To use function tools, use /v1/responses or set reas — `openai-group/gpt-6-sol`
- **tools_forced**: openai error: Function tools with reasoning_effort are not supported for gpt-6-sol in /v1/chat/completions. To use function tools, use /v1/responses or set reas — `openai-group/gpt-6-sol`
- **tools_auto**: openai error: Function tools with reasoning_effort are not supported for gpt-6-sol in /v1/chat/completions. To use function tools, use /v1/responses or set reas — `openai-group/gpt-6-sol`
- **json_schema_strict**: openai error: Function tools with reasoning_effort are not supported for gpt-6-astra in /v1/chat/completions. To use function tools, use /v1/responses or set re — `openai-group/gpt-6-astra`
- **tools_forced**: openai error: Function tools with reasoning_effort are not supported for gpt-6-astra in /v1/chat/completions. To use function tools, use /v1/responses or set re — `openai-group/gpt-6-astra`
- **tools_auto**: openai error: Function tools with reasoning_effort are not supported for gpt-6-astra in /v1/chat/completions. To use function tools, use /v1/responses or set re — `openai-group/gpt-6-astra`
- **json_schema_strict_effort_none**: openai error: Function tools with reasoning_effort are not supported for gpt-6-astra in /v1/chat/completions. To use function tools, use /v1/responses or set re — `openai-group/gpt-6-astra`
- **tools_forced_effort_none**: openai error: Function tools with reasoning_effort are not supported for gpt-6-astra in /v1/chat/completions. To use function tools, use /v1/responses or set re — `openai-group/gpt-6-astra`
- **tools_auto_effort_none**: openai error: Function tools with reasoning_effort are not supported for gpt-6-astra in /v1/chat/completions. To use function tools, use /v1/responses or set re — `openai-group/gpt-6-astra`
- **json_schema_strict**: openai error: Function tools with reasoning_effort are not supported for gpt-6-luna in /v1/chat/completions. To use function tools, use /v1/responses or set rea — `openai-group/gpt-6-luna`
- **tools_forced**: openai error: Function tools with reasoning_effort are not supported for gpt-6-luna in /v1/chat/completions. To use function tools, use /v1/responses or set rea — `openai-group/gpt-6-luna`
- **tools_auto**: openai error: Function tools with reasoning_effort are not supported for gpt-6-luna in /v1/chat/completions. To use function tools, use /v1/responses or set rea — `openai-group/gpt-6-luna`
- **images_4_heavy**: aws-bedrock error: The model returned the following errors: {"error":{"code":"validation_error","message":"Failed to buffer the request body: length limit excee — `bedrock-oss-group/qwen3-vl-235b`, `aws-bedrock/qwen.qwen3-vl-235b-a22b`

</details>

## 2. Reasoning controls

Each cell: adjusted time · reasoning tokens (`tok`, from usage) or visible reasoning text (`ch`) · answer right? The task is a two-step projectile question (answer 0.756 m). "no" = the route rejected the parameter. Claude routes do not report reasoning tokens separately; their summarised thinking shows up as `ch`.

| Model route | effort none | effort minimal | effort low | effort medium | effort high | thinking adaptive | thinking budget | thinking disabled | thinking between_tools |
|---|---|---|---|---|---|---|---|---|---|
| `claude-group/claude-opus-5-5` | 4.95 s · 0 · ✓ | 1.79 s · 0 · ✓ | 2.36 s · 121 ch · ✓ | 6.60 s · 125 ch · ✓ | 2.94 s · 122 ch · ✓ | 2.67 s · 0 · ✓ | no | no | no |
| `anthropic-primary/claude-opus-5-5` | 2.81 s · 0 · ✓ | 3.60 s · 116 ch · ✓ | 3.58 s · 91 ch · ✓ | 4.06 s · 123 ch · ✓ | 3.14 s · 121 ch · ✓ | 3.37 s · 0 · ✓ | no | no | no |
| `aws-bedrock/global.anthropic.claude-opus-5-5` | 2.70 s · 0 · ✓ | 1.95 s · 0 · ✓ | 1.66 s · 0 · ✓ | 2.75 s · 0 · ✓ | 3.21 s · 0 · ✓ | 2.35 s · 0 · ✓ | no | no | no |
| `aws-bedrock/us.anthropic.claude-opus-5-5` | 2.87 s · 0 · ✓ | 2.02 s · 0 · ✓ | 1.92 s · 0 · ✓ | 2.87 s · 0 · ✓ | 2.59 s · 0 · ✓ | 2.96 s · 0 · ✓ | no | no | no |
| `claude-opus-5-5` | 3.29 s · 0 · ✓ | 2.90 s · 113 ch · ✓ | 2.30 s · 128 ch · ✓ | 4.71 s · 117 ch · ✓ | 4.04 s · 178 ch · ✓ | 3.38 s · 0 · ✓ | no | no | no |
| `claude-group/claude-opus-5` | 2.06 s · 0 · ✓ | 2.53 s · 127 ch · ✓ | 2.28 s · 111 ch · ✓ | 3.79 s · 121 ch · ✓ | 4.37 s · 135 ch · ✓ | 2.25 s · 0 · ✓ | no | 2.07 s · 0 · ✓ | no |
| `claude-group/claude-opus-4-8` | 1.11 s · 0 · ✓ | 2.59 s · 140 ch · ✓ | 3.14 s · 118 ch · ✓ | 2.92 s · 131 ch · ✓ | 2.95 s · 174 ch · ✓ | 1.78 s · 0 · ✓ | no | 2.22 s · 0 · ✓ | no |
| `claude-group/claude-sonnet-5-5` | 1.59 s · 0 · ✓ | 2.08 s · 0 · ✓ | 1.57 s · 0 · ✓ | 1.99 s · 0 · ✓ | 1.82 s · 0 · ✓ | 1.76 s · 0 · ✓ | no | no | 1.97 s · 0 · ✓ |
| `anthropic-primary/claude-sonnet-5-5` | 2.21 s · 0 · ✓ | 2.25 s · 0 · ✓ | 1.75 s · 0 · ✓ | 1.91 s · 0 · ✓ | 2.02 s · 0 · ✓ | 2.03 s · 0 · ✓ | no | no | 1.44 s · 0 · ✓ |
| `aws-bedrock/global.anthropic.claude-sonnet-5-5` | 1.35 s · 0 · ✓ | 1.23 s · 0 · ✓ | 1.46 s · 0 · ✓ | 1.45 s · 0 · ✓ | 1.39 s · 0 · ✓ | 1.30 s · 0 · ✓ | no | no | 0.99 s · 0 · ✓ |
| `claude-group/claude-sonnet-5` | 2.13 s · 0 · ✓ | 0.77 s · 0 · ✗ | 2.64 s · 117 ch · ✓ | 2.73 s · 138 ch · ✓ | 3.34 s · 177 ch · ✓ | 1.62 s · 0 · ✓ | no | 1.10 s · 0 · ✗ | no |
| `claude-group/claude-sonnet-4-6` | 4.81 s · 0 · ✓ | 2.41 s · 114 ch · ✓ | 3.35 s · 126 ch · ✓ | 4.64 s · 249 ch · ✓ | 11.9 s · 541 ch · ✓ | 9.59 s · 458 ch · ✓ | 5.19 s · 395 ch · ✓ | 4.15 s · 0 · ✓ | no |
| `claude-group/claude-haiku-5-5` | 1.79 s · 0 · ✓ | 1.13 s · 0 · ✓ | 1.16 s · 0 · ✓ | 3.01 s · 137 ch · ✓ | 2.77 s · 130 ch · ✓ | 2.95 s · 0 · ✓ | no | 0.93 s · 0 · ✓ | no |
| `anthropic-primary/claude-haiku-5-5` | 1.33 s · 0 · ✓ | 1.17 s · 0 · ✓ | 2.83 s · 172 ch · ✓ | 2.78 s · 141 ch · ✓ | 2.85 s · 153 ch · ✓ | 2.18 s · 0 · ✓ | no | 3.27 s · 0 · ✓ | no |
| `claude-group/claude-haiku-4-5` | 2.92 s · 0 · ✓ | 3.28 s · 0 · ✓ | 3.14 s · 0 · ✓ | 2.75 s · 0 · ✓ | 3.33 s · 0 · ✓ | no | 5.59 s · 915 ch · ✓ | 2.90 s · 0 · ✓ | no |
| `aws-bedrock/global.anthropic.claude-haiku-4-5-20251001-v1-0` | 2.26 s · 0 · ✓ | 2.51 s · 0 · ✓ | 2.22 s · 0 · ✓ | 1.96 s · 0 · ✓ | 2.28 s · 0 · ✓ | no | 4.14 s · 935 ch · ✓ | 1.85 s · 0 · ✓ | no |
| `claude-group/claude-fable-5-1` | 3.91 s · 0 · ✓ | 6.77 s · 0 · ✓ | 4.23 s · 0 · ✓ | 5.63 s · 0 · ✓ | 4.55 s · 0 · ✓ | 4.86 s · 0 · ✓ | no | no | no |
| `anthropic-primary/claude-fable-5-1` | 2.52 s · 0 · ✓ | 4.13 s · 0 · ✓ | 4.35 s · 0 · ✓ | 2.42 s · 0 · ✓ | 2.69 s · 0 · ✓ | 2.76 s · 0 · ✓ | no | no | no |
| `claude-group/claude-fable-5` | 2.03 s · 0 · ✓ | 3.26 s · 85 ch · ✓ | 3.37 s · 105 ch · ✓ | 3.70 s · 118 ch · ✓ | 2.54 s · 124 ch · ✓ | 3.34 s · 0 · ✓ | no | no | no |
| `gemini-group/gemini-4-argon` | 2.19 s · 0 · ✓ | 2.46 s · 0 · ✓ | 2.86 s · 0 · ✓ | 34.1 s · 533 tok · ✓ | 9.91 s · 551 tok · ✓ | no | 15.6 s · 0 · ✓ | 8.18 s · 174 tok · ✓ | 3.95 s · 217 tok · ✓ |
| `gemini-primary/gemini-4-argon` | 2.91 s · 0 · ✓ | 11.7 s · 0 · ✓ | 2.79 s · 0 · ✓ | 19.1 s · 829 tok · ✓ | 75.2 s · 653 tok · ✓ | no | 13.9 s · 0 · ✓ | 4.54 s · 108 tok · ✓ | 5.21 s · 264 tok · ✓ |
| `gemini-group/gemini-3.1-pro` | 122.1 s · 1011 tok · ✓ | skip | 139.2 s · 418 tok · ✓ | skip | 113.9 s · 913 tok · ✓ | skip | skip | skip | skip |
| `gemini-group/gemini-3.8-flash` | 3.51 s · 331 tok · ✓ | 4.22 s · 250 tok · ✓ | 4.51 s · 257 tok · ✓ | 6.10 s · 439 tok · ✓ | 6.12 s · 538 tok · ✓ | no | no | 4.62 s · 391 tok · ✓ | 3.29 s · 435 tok · ✓ |
| `gemini-primary/gemini-3.8-flash` | 3.74 s · 471 tok · ✓ | 4.90 s · 290 tok · ✓ | 5.36 s · 296 tok · ✓ | 5.53 s · 387 tok · ✓ | 7.55 s · 748 tok · ✓ | no | no | 3.91 s · 452 tok · ✓ | 3.13 s · 372 tok · ✓ |
| `gemini-group/gemini-3.5-flash-lite` | 0.92 s · 0 · ✗ | 1.07 s · 0 · ✗ | 3.42 s · 237 tok · ✓ | 4.70 s · 475 tok · ✓ | 6.83 s · 804 tok · ✓ | no | 0.81 s · 0 · ✗ | 1.15 s · 0 · ✗ | 0.95 s · 0 · ✗ |
| `openai-group/gpt-6.1-sol` | 4.20 s · 83 tok · ✓ | 2.76 s · 22 tok · ✓ | 2.59 s · 21 tok · ✓ | 3.67 s · 54 tok · ✓ | 5.49 s · 110 tok · ✓ | 4.53 s · 72 tok · ✓ | 3.66 s · 33 tok · ✓ | no | 3.61 s · 63 tok · ✓ |
| `openai-primary/gpt-6.1-sol` | 2.92 s · 36 tok · ✓ | 4.52 s · 35 tok · ✓ | 5.38 s · 45 tok · ✓ | 3.78 s · 59 tok · ✓ | 4.40 s · 100 tok · ✓ | 4.93 s · 73 tok · ✓ | 6.55 s · 73 tok · ✓ | no | 4.91 s · 79 tok · ✓ |
| `openai-group/gpt-6-sol` | 1.08 s · 0 · ✓ | 2.30 s · 28 tok · ✓ | 2.48 s · 37 tok · ✓ | 2.52 s · 30 tok · ✓ | 2.52 s · 48 tok · ✓ | 2.53 s · 39 tok · ✓ | 2.73 s · 54 tok · ✓ | no | 2.54 s · 30 tok · ✓ |
| `openai-group/gpt-6-astra` | 3.15 s · 46 tok · ✓ | 3.74 s · 26 tok · ✓ | 4.02 s · 30 tok · ✓ | 4.65 s · 47 tok · ✓ | 6.23 s · 107 tok · ✓ | 5.24 s · 58 tok · ✓ | 5.20 s · 55 tok · ✓ | no | 8.11 s · 63 tok · ✓ |
| `openai-group/gpt-6-luna` | 2.28 s · 0 · ✓ | 2.29 s · 43 tok · ✓ | 2.89 s · 40 tok · ✓ | 2.66 s · 61 tok · ✓ | 2.97 s · 157 tok · ✓ | 2.83 s · 77 tok · ✓ | 3.38 s · 103 tok · ✓ | no | 3.06 s · 75 tok · ✓ |
| `openai-group/gpt-5.5` | 1.41 s · 0 · ✓ | 3.78 s · 74 tok · ✓ | 3.04 s · 94 tok · ✓ | 3.23 s · 95 tok · ✓ | 4.03 s · 109 tok · ✓ | 3.89 s · 103 tok · ✓ | 3.50 s · 97 tok · ✓ | no | 3.43 s · 103 tok · ✓ |
| `openai-group/gpt-5.4-mini` | 0.60 s · 0 · ✗ | 2.40 s · 78 tok · ✓ | 2.81 s · 105 tok · ✓ | 3.04 s · 125 tok · ✓ | 2.87 s · 212 tok · ✓ | 0.55 s · 0 · ✗ | 0.71 s · 0 · ✗ | no | 0.69 s · 0 · ✗ |
| `xai-group/grok-4.7` | 24.2 s · 1759 tok · ✓ | 21.9 s · 1655 tok · ✓ | 14.4 s · 1215 tok · ✓ | 29.2 s · 2311 tok · ✓ | 35.7 s · 1929 tok · ✓ | 27.2 s · 2082 tok · ✓ | 33.5 s · 2369 tok · ✓ | 24.3 s · 1759 tok · ✓ | 29.3 s · 2354 tok · ✓ |
| `xai-primary/grok-4.7` | 18.2 s · 1598 tok · ✓ | 9.53 s · 841 tok · ✓ | 14.3 s · 1094 tok · ✓ | 29.1 s · 2117 tok · ✓ | 46.9 s · 2690 tok · ✓ | 23.7 s · 1904 tok · ✓ | 33.5 s · 2702 tok · ✓ | 23.3 s · 1787 tok · ✓ | 34.6 s · 2664 tok · ✓ |
| `bedrock-oss-group/qwen3-vl-235b` | 0.91 s · 0 · ✗ | 1.18 s · 0 · ✗ | 0.42 s · 0 · ✗ | 0.61 s · 0 · ✗ | 0.42 s · 0 · ✗ | 0.96 s · 0 · ✗ | 0.74 s · 0 · ✗ | 1.65 s · 0 · ✗ | 0.47 s · 0 · ✓ |
| `aws-bedrock/qwen.qwen3-vl-235b-a22b` | 0.58 s · 0 · ✗ | 0.50 s · 0 · ✗ | 0.34 s · 0 · ✗ | 0.42 s · 0 · ✗ | 1.60 s · 0 · ✗ | 1.62 s · 0 · ✗ | 0.39 s · 0 · ✗ | 0.45 s · 0 · ✗ | 0.48 s · 0 · ✗ |

## 3. Latency (deep probe, adjusted (wall))

Short = tiny edit task (~150–230 tokens in, ~40–200 out). Big = catalog digest (~6k tokens on GPT, ~7k Gemini, ~8k Claude) + one 1536×864 JPEG render of the app, short JSON out. *ns* = non-streaming total; *s* = streaming, time to first answer token. *fast* = the same task with the lowest reasoning setting the route accepts (named in brackets). ✓ columns: short = both patches right; dominoes = the render has 7, counted right.

| Model route | short ns | short s TTFT | short fast ns | big ns | big s TTFT | big fast ns | prompt tok (big) | short ✓ | dominoes ✓ | overhead p50 | errors / calls |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `claude-group/claude-opus-5-5` | 1.80 s <sub>(1.84 s)</sub> | 2.42 s <sub>(2.47 s)</sub> | 2.99 s <sub>(3.04 s)</sub> minimal | 2.60 s <sub>(2.84 s)</sub> | 4.86 s <sub>(5.22 s)</sub> | 2.48 s <sub>(2.61 s)</sub> | 10024 | 9/9 | 9/9 | 0.07 s | 0/48 |
| `anthropic-primary/claude-opus-5-5` | 2.17 s <sub>(2.21 s)</sub> | 2.07 s <sub>(2.11 s)</sub> | 2.15 s <sub>(2.19 s)</sub> none | 5.72 s <sub>(5.81 s)</sub> | 4.15 s <sub>(4.29 s)</sub> | 5.51 s <sub>(5.64 s)</sub> | 10026 | 9/9 | 9/9 | 0.09 s | 0/48 |
| `aws-bedrock/global.anthropic.claude-opus-5-5` | 1.95 s <sub>(1.99 s)</sub> | 2.29 s <sub>(2.33 s)</sub> | 2.10 s <sub>(2.15 s)</sub> minimal | 5.38 s <sub>(5.54 s)</sub> | 4.15 s <sub>(4.28 s)</sub> | 3.41 s <sub>(3.51 s)</sub> | 10024 | 9/9 | 9/9 | 0.08 s | 0/48 |
| `aws-bedrock/us.anthropic.claude-opus-5-5` | 1.86 s <sub>(1.91 s)</sub> | 1.42 s <sub>(1.46 s)</sub> | 1.81 s <sub>(1.85 s)</sub> low | 2.45 s <sub>(2.58 s)</sub> | 2.27 s <sub>(2.57 s)</sub> | 2.46 s <sub>(2.65 s)</sub> | 10026 | 9/9 | 9/9 | 0.09 s | 0/48 |
| `claude-opus-5-5` | 2.39 s <sub>(2.43 s)</sub> | 1.86 s <sub>(1.91 s)</sub> | 2.43 s <sub>(2.48 s)</sub> none | 5.14 s <sub>(5.39 s)</sub> | 3.86 s <sub>(3.99 s)</sub> | 3.55 s <sub>(3.69 s)</sub> | 10025 | 9/9 | 9/9 | 0.07 s | 0/48 |
| `claude-group/claude-opus-5` | 2.76 s <sub>(2.81 s)</sub> | 2.44 s <sub>(2.49 s)</sub> | 1.15 s <sub>(1.19 s)</sub> disabled | 5.53 s <sub>(5.79 s)</sub> | 3.96 s <sub>(4.22 s)</sub> | 2.24 s <sub>(2.34 s)</sub> | 10024 | 9/9 | 9/9 | 0.07 s | 0/48 |
| `claude-group/claude-opus-4-8` | 1.00 s <sub>(1.05 s)</sub> | 0.64 s <sub>(0.69 s)</sub> | 1.10 s <sub>(1.14 s)</sub> none | 3.33 s <sub>(3.50 s)</sub> | 0.87 s <sub>(1.27 s)</sub> | 2.62 s <sub>(2.73 s)</sub> | 10023 | 9/9 | 1/9 | 0.07 s | 0/48 |
| `claude-group/claude-sonnet-5-5` | 1.78 s <sub>(1.82 s)</sub> | 2.33 s <sub>(2.38 s)</sub> | 1.58 s <sub>(1.62 s)</sub> between_tools | 3.93 s <sub>(4.19 s)</sub> | 4.60 s <sub>(4.70 s)</sub> | 2.41 s <sub>(2.58 s)</sub> | 10025 | 9/9 | 9/9 | 0.07 s | 0/48 |
| `anthropic-primary/claude-sonnet-5-5` | 2.02 s <sub>(2.07 s)</sub> | 1.91 s <sub>(1.97 s)</sub> | 1.57 s <sub>(1.62 s)</sub> between_tools | 4.01 s <sub>(4.11 s)</sub> | 1.60 s <sub>(1.78 s)</sub> | 2.23 s <sub>(2.35 s)</sub> | 10025 | 9/9 | 9/9 | 0.08 s | 0/48 |
| `aws-bedrock/global.anthropic.claude-sonnet-5-5` | 1.50 s <sub>(1.55 s)</sub> | 0.98 s <sub>(1.06 s)</sub> | 0.89 s <sub>(0.94 s)</sub> between_tools | 4.38 s <sub>(4.50 s)</sub> | 3.75 s <sub>(3.88 s)</sub> | 2.08 s <sub>(2.34 s)</sub> | 10027 | 9/9 | 9/9 | 0.09 s | 0/48 |
| `claude-group/claude-sonnet-5` | 1.54 s <sub>(1.58 s)</sub> | 0.60 s <sub>(0.70 s)</sub> | 1.01 s <sub>(1.05 s)</sub> minimal | 1.82 s <sub>(1.92 s)</sub> | 0.89 s <sub>(1.02 s)</sub> | 1.79 s <sub>(1.92 s)</sub> | 10026 | 9/9 | 7/9 | 0.09 s | 0/48 |
| `claude-group/claude-sonnet-4-6` | 1.28 s <sub>(1.50 s)</sub> | 0.79 s <sub>(0.84 s)</sub> | 1.17 s <sub>(1.22 s)</sub> disabled | 3.54 s <sub>(3.77 s)</sub> | 1.05 s <sub>(1.18 s)</sub> | 3.60 s <sub>(3.86 s)</sub> | 8117 | 9/9 | 3/9 | 0.09 s | 0/48 |
| `claude-group/claude-haiku-5-5` | 1.59 s <sub>(1.63 s)</sub> | 1.09 s <sub>(1.14 s)</sub> | 1.32 s <sub>(1.36 s)</sub> disabled | 5.85 s <sub>(5.94 s)</sub> | 4.65 s <sub>(4.74 s)</sub> | 1.51 s <sub>(1.77 s)</sub> | 10025 | 9/9 | 7/9 | 0.07 s | 0/48 |
| `anthropic-primary/claude-haiku-5-5` | 1.42 s <sub>(1.47 s)</sub> | 0.95 s <sub>(1.00 s)</sub> | 2.61 s <sub>(2.66 s)</sub> minimal | 5.15 s <sub>(5.27 s)</sub> | 4.93 s <sub>(5.02 s)</sub> | 6.23 s <sub>(6.36 s)</sub> | 10025 | 9/9 | 9/9 | 0.07 s | 0/48 |
| `claude-group/claude-haiku-4-5` | 1.00 s <sub>(1.04 s)</sub> | 0.42 s <sub>(0.49 s)</sub> | 1.05 s <sub>(1.09 s)</sub> disabled | 2.14 s <sub>(2.23 s)</sub> | 0.48 s <sub>(0.60 s)</sub> | 2.07 s <sub>(2.16 s)</sub> | 8117 | 9/9 | 0/9 | 0.09 s | 0/48 |
| `aws-bedrock/global.anthropic.claude-haiku-4-5-20251001-v1-0` | 0.79 s <sub>(0.84 s)</sub> | 0.46 s <sub>(0.51 s)</sub> | 0.81 s <sub>(0.86 s)</sub> disabled | 1.69 s <sub>(1.78 s)</sub> | 0.75 s <sub>(0.93 s)</sub> | 1.67 s <sub>(1.80 s)</sub> | 8119 | 9/9 | 0/9 | 0.07 s | 0/48 |
| `claude-group/claude-fable-5-1` | 3.62 s <sub>(3.67 s)</sub> | 1.36 s <sub>(1.40 s)</sub> | 3.75 s <sub>(3.80 s)</sub> none | 4.74 s <sub>(4.84 s)</sub> | 2.33 s <sub>(2.43 s)</sub> | 4.88 s <sub>(4.97 s)</sub> | 10026 | 6/9 | 7/9 | 0.07 s | 0/48 |
| `anthropic-primary/claude-fable-5-1` | 2.74 s <sub>(2.79 s)</sub> | 1.78 s <sub>(1.86 s)</sub> | 3.72 s <sub>(3.77 s)</sub> none | 4.44 s <sub>(4.70 s)</sub> | 2.51 s <sub>(2.63 s)</sub> | 4.32 s <sub>(4.68 s)</sub> | 10026 | 6/9 | 9/9 | 0.09 s | 0/48 |
| `claude-group/claude-fable-5` | 2.88 s <sub>(3.03 s)</sub> | 1.27 s <sub>(1.32 s)</sub> | 2.86 s <sub>(2.90 s)</sub> none | 6.33 s <sub>(6.65 s)</sub> | 5.50 s <sub>(5.63 s)</sub> | 7.58 s <sub>(7.84 s)</sub> | 10022 | 9/9 | 9/9 | 0.09 s | 1/49 |
| `gemini-group/gemini-4-argon` | 3.14 s <sub>(3.19 s)</sub> | 2.51 s <sub>(2.55 s)</sub> | 3.42 s <sub>(3.47 s)</sub> none | 22.2 s <sub>(22.4 s)</sub> | 19.7 s <sub>(19.9 s)</sub> | 5.87 s <sub>(6.00 s)</sub> | 8145 | 8/9 | 7/7 | 0.09 s | 4/49 |
| `gemini-primary/gemini-4-argon` | 2.94 s <sub>(2.99 s)</sub> | 2.52 s <sub>(2.56 s)</sub> | 2.33 s <sub>(2.38 s)</sub> minimal | 7.15 s <sub>(7.28 s)</sub> | 5.11 s <sub>(5.36 s)</sub> | 14.6 s <sub>(14.9 s)</sub> | 8147 | 9/9 | 9/9 | 0.07 s | 0/48 |
| `gemini-group/gemini-3.1-pro` | – | – | – low | 112.2 s <sub>(112.5 s)</sub> | – | 119.7 s <sub>(119.9 s)</sub> | 8125 | 0/2 | 2/2 | 0.22 s | 9/15 |
| `gemini-group/gemini-3.8-flash` | 2.63 s <sub>(2.73 s)</sub> | 2.63 s <sub>(2.67 s)</sub> | 3.81 s <sub>(3.86 s)</sub> minimal | 26.9 s <sub>(27.0 s)</sub> | 47.6 s <sub>(47.9 s)</sub> | 9.44 s <sub>(9.63 s)</sub> | 8126 | 9/9 | 9/9 | 0.09 s | 0/48 |
| `gemini-primary/gemini-3.8-flash` | 2.76 s <sub>(2.84 s)</sub> | 2.91 s <sub>(2.95 s)</sub> | 3.84 s <sub>(3.88 s)</sub> minimal | 26.1 s <sub>(26.2 s)</sub> | 98.7 s <sub>(98.8 s)</sub> | 8.60 s <sub>(8.72 s)</sub> | 8126 | 9/9 | 9/9 | 0.09 s | 0/48 |
| `gemini-group/gemini-3.5-flash-lite` | 0.80 s <sub>(0.99 s)</sub> | 0.90 s <sub>(0.94 s)</sub> | 0.86 s <sub>(0.91 s)</sub> none | 1.46 s <sub>(1.60 s)</sub> | 0.94 s <sub>(1.19 s)</sub> | 1.42 s <sub>(1.66 s)</sub> | 8127 | 9/9 | 6/9 | 0.09 s | 0/48 |
| `openai-group/gpt-6.1-sol` | 1.78 s <sub>(1.82 s)</sub> | 1.46 s <sub>(1.52 s)</sub> | 1.71 s <sub>(1.75 s)</sub> low | 5.95 s <sub>(6.28 s)</sub> | 9.01 s <sub>(9.26 s)</sub> | 9.85 s <sub>(9.94 s)</sub> | 7751 | 9/9 | 9/9 | 0.07 s | 0/48 |
| `openai-primary/gpt-6.1-sol` | 1.82 s <sub>(1.86 s)</sub> | 1.28 s <sub>(1.33 s)</sub> | 1.78 s <sub>(1.83 s)</sub> minimal | 6.20 s <sub>(6.36 s)</sub> | 8.88 s <sub>(9.13 s)</sub> | 7.94 s <sub>(8.03 s)</sub> | 7750 | 9/9 | 9/9 | 0.08 s | 0/48 |
| `openai-group/gpt-6-sol` | 1.29 s <sub>(1.34 s)</sub> | 0.89 s <sub>(0.94 s)</sub> | 1.10 s <sub>(1.15 s)</sub> none | 13.6 s <sub>(13.8 s)</sub> | 9.15 s <sub>(9.24 s)</sub> | 2.33 s <sub>(2.46 s)</sub> | 7750 | 9/9 | 9/9 | 0.07 s | 0/48 |
| `openai-group/gpt-6-astra` | 2.24 s <sub>(2.29 s)</sub> | 1.60 s <sub>(1.64 s)</sub> | 1.99 s <sub>(2.04 s)</sub> minimal | 6.98 s <sub>(7.11 s)</sub> | 5.21 s <sub>(5.34 s)</sub> | 5.42 s <sub>(5.71 s)</sub> | 7750 | 9/9 | 9/9 | 0.08 s | 0/48 |
| `openai-group/gpt-6-luna` | 1.22 s <sub>(1.41 s)</sub> | 1.09 s <sub>(1.13 s)</sub> | 1.11 s <sub>(1.16 s)</sub> none | 9.76 s <sub>(9.85 s)</sub> | 11.6 s <sub>(11.7 s)</sub> | 4.50 s <sub>(4.63 s)</sub> | 7749 | 9/9 | 9/9 | 0.10 s | 0/48 |
| `openai-group/gpt-5.5` | 1.94 s <sub>(1.99 s)</sub> | 1.64 s <sub>(1.69 s)</sub> | 1.19 s <sub>(1.23 s)</sub> none | 15.1 s <sub>(15.3 s)</sub> | 13.8 s <sub>(13.9 s)</sub> | 1.74 s <sub>(1.87 s)</sub> | 7749 | 9/9 | 9/9 | 0.07 s | 0/48 |
| `openai-group/gpt-5.4-mini` | 0.60 s <sub>(0.64 s)</sub> | 0.38 s <sub>(0.42 s)</sub> | 0.55 s <sub>(0.77 s)</sub> none | 1.16 s <sub>(1.29 s)</sub> | 0.73 s <sub>(1.00 s)</sub> | 1.11 s <sub>(1.36 s)</sub> | 7751 | 9/9 | 8/9 | 0.13 s | 0/48 |
| `xai-group/grok-4.7` | 5.53 s <sub>(5.58 s)</sub> | 5.53 s <sub>(5.68 s)</sub> | 4.96 s <sub>(5.00 s)</sub> low | 152.4 s <sub>(152.6 s)</sub> | 140.1 s <sub>(140.4 s)</sub> | 37.4 s <sub>(37.7 s)</sub> | 8839 | 9/9 | 8/8 | 0.13 s | 1/48 |
| `xai-primary/grok-4.7` | 6.25 s <sub>(6.29 s)</sub> | 7.25 s <sub>(7.56 s)</sub> | 4.49 s <sub>(4.54 s)</sub> minimal | 126.6 s <sub>(126.9 s)</sub> | 114.4 s <sub>(114.7 s)</sub> | 55.8 s <sub>(56.0 s)</sub> | 8838 | 9/9 | 9/9 | 0.11 s | 0/48 |
| `bedrock-oss-group/qwen3-vl-235b` | 1.37 s <sub>(1.42 s)</sub> | 0.47 s <sub>(0.52 s)</sub> | 1.64 s <sub>(1.68 s)</sub> none | 4.30 s <sub>(4.39 s)</sub> | 1.00 s <sub>(1.26 s)</sub> | 4.29 s <sub>(4.38 s)</sub> | 8335 | 9/9 | 8/9 | 0.09 s | 0/48 |
| `aws-bedrock/qwen.qwen3-vl-235b-a22b` | 2.02 s <sub>(2.07 s)</sub> | 0.59 s <sub>(0.64 s)</sub> | 1.77 s <sub>(1.82 s)</sub> none | 4.31 s <sub>(4.43 s)</sub> | 0.96 s <sub>(1.19 s)</sub> | 5.85 s <sub>(5.96 s)</sub> | 8332 | 9/9 | 9/9 | 0.07 s | 0/48 |

## 4. Route comparison per model (deep probe)

Within each model the most reliable route comes first (fewest transport errors: 5xx, 429, timeouts, network, stream errors), then the fastest (adjusted median short ns + big ns). The fallback chain is what the gateway reported in `x-tfy-applied-rules`.

| Model | Route | Fallback chain | short ns | big ns | big s TTFT | transport errors | pick |
|---|---|---|---|---|---|---|---|
| claude-opus-5-5 | `aws-bedrock/us.anthropic.claude-opus-5-5` | – | 1.86 s | 2.45 s | 2.27 s | 0/48 | **best** |
|  | `claude-group/claude-opus-5-5` | anthropic-primary/claude-opus-5-5 → aws-bedrock/global.anthropic.claude-opus-5-5 | 1.80 s | 2.60 s | 4.86 s | 0/48 |  |
|  | `aws-bedrock/global.anthropic.claude-opus-5-5` | – | 1.95 s | 5.38 s | 4.15 s | 0/48 |  |
|  | `claude-opus-5-5` | anthropic-primary/claude-opus-5-5 → aws-bedrock/global.anthropic.claude-opus-5-5 | 2.39 s | 5.14 s | 3.86 s | 0/48 |  |
|  | `anthropic-primary/claude-opus-5-5` | – | 2.17 s | 5.72 s | 4.15 s | 0/48 |  |
| claude-opus-5 | `claude-group/claude-opus-5` | anthropic-primary/claude-opus-5 → aws-bedrock/global.anthropic.claude-opus-5 | 2.76 s | 5.53 s | 3.96 s | 0/48 |  |
| claude-opus-4-8 | `claude-group/claude-opus-4-8` | anthropic-primary/claude-opus-4-8 → aws-bedrock/global.anthropic.claude-opus-4-8 | 1.00 s | 3.33 s | 0.87 s | 0/48 |  |
| claude-sonnet-5-5 | `claude-group/claude-sonnet-5-5` | anthropic-primary/claude-sonnet-5-5 → aws-bedrock/global.anthropic.claude-sonnet-5-5 | 1.78 s | 3.93 s | 4.60 s | 0/48 | **best** |
|  | `aws-bedrock/global.anthropic.claude-sonnet-5-5` | – | 1.50 s | 4.38 s | 3.75 s | 0/48 |  |
|  | `anthropic-primary/claude-sonnet-5-5` | – | 2.02 s | 4.01 s | 1.60 s | 0/48 |  |
| claude-sonnet-5 | `claude-group/claude-sonnet-5` | anthropic-primary/claude-sonnet-5 → aws-bedrock/global.anthropic.claude-sonnet-5 | 1.54 s | 1.82 s | 0.89 s | 0/48 |  |
| claude-sonnet-4-6 | `claude-group/claude-sonnet-4-6` | anthropic-primary/claude-sonnet-4-6 → aws-bedrock/global.anthropic.claude-sonnet-4-6 | 1.28 s | 3.54 s | 1.05 s | 0/48 |  |
| claude-haiku-5-5 | `anthropic-primary/claude-haiku-5-5` | – | 1.42 s | 5.15 s | 4.93 s | 0/48 | **best** |
|  | `claude-group/claude-haiku-5-5` | anthropic-primary/claude-haiku-5-5 | 1.59 s | 5.85 s | 4.65 s | 0/48 |  |
| claude-haiku-4-5 | `aws-bedrock/global.anthropic.claude-haiku-4-5-20251001-v1-0` | – | 0.79 s | 1.69 s | 0.75 s | 0/48 | **best** |
|  | `claude-group/claude-haiku-4-5` | anthropic-primary/claude-haiku-4-5 → aws-bedrock/global.anthropic.claude-haiku-4-5-20251001-v1-0 | 1.00 s | 2.14 s | 0.48 s | 0/48 |  |
| claude-fable-5-1 | `anthropic-primary/claude-fable-5-1` | – | 2.74 s | 4.44 s | 2.51 s | 0/48 | **best** |
|  | `claude-group/claude-fable-5-1` | anthropic-primary/claude-fable-5-1 | 3.62 s | 4.74 s | 2.33 s | 0/48 |  |
| claude-fable-5 | `claude-group/claude-fable-5` | anthropic-primary/claude-fable-5 | 2.88 s | 6.33 s | 5.50 s | 1/49 |  |
| gemini-4-argon | `gemini-primary/gemini-4-argon` | – | 2.94 s | 7.15 s | 5.11 s | 0/48 | **best** |
|  | `gemini-group/gemini-4-argon` | gemini-primary/gemini-4-argon → vertex-contract-analyzer/gemini-4-argon | 3.14 s | 22.2 s | 19.7 s | 4/49 |  |
| gemini-3.1-pro | `gemini-group/gemini-3.1-pro` | gemini-primary/gemini-3.1-pro-preview | – | 112.2 s | – | 9/15 |  |
| gemini-3.8-flash | `gemini-primary/gemini-3.8-flash` | – | 2.76 s | 26.1 s | 98.7 s | 0/48 | **best** |
|  | `gemini-group/gemini-3.8-flash` | gemini-primary/gemini-3.8-flash → vertex-contract-analyzer/gemini-3.8-flash | 2.63 s | 26.9 s | 47.6 s | 0/48 |  |
| gemini-3.5-flash-lite | `gemini-group/gemini-3.5-flash-lite` | gemini-primary/gemini-3.5-flash-lite | 0.80 s | 1.46 s | 0.94 s | 0/48 |  |
| gpt-6.1-sol | `openai-group/gpt-6.1-sol` | openai-primary/gpt-6.1-sol | 1.78 s | 5.95 s | 9.01 s | 0/48 | **best** |
|  | `openai-primary/gpt-6.1-sol` | – | 1.82 s | 6.20 s | 8.88 s | 0/48 |  |
| gpt-6-sol | `openai-group/gpt-6-sol` | openai-primary/gpt-6-sol | 1.29 s | 13.6 s | 9.15 s | 0/48 |  |
| gpt-6-astra | `openai-group/gpt-6-astra` | openai-primary/gpt-6-astra | 2.24 s | 6.98 s | 5.21 s | 0/48 |  |
| gpt-6-luna | `openai-group/gpt-6-luna` | openai-primary/gpt-6-luna | 1.22 s | 9.76 s | 11.6 s | 0/48 |  |
| gpt-5.5 | `openai-group/gpt-5.5` | openai-primary/gpt-5.5 | 1.94 s | 15.1 s | 13.8 s | 0/48 |  |
| gpt-5.4-mini | `openai-group/gpt-5.4-mini` | openai-primary/gpt-5.4-mini | 0.60 s | 1.16 s | 0.73 s | 0/48 |  |
| grok-4.7 | `xai-primary/grok-4.7` | – | 6.25 s | 126.6 s | 114.4 s | 0/48 | **best** |
|  | `xai-group/grok-4.7` | xai-primary/grok-4.7 | 5.53 s | 152.4 s | 140.1 s | 1/48 |  |
| qwen3-vl-235b | `bedrock-oss-group/qwen3-vl-235b` | aws-bedrock/qwen.qwen3-vl-235b-a22b | 1.37 s | 4.30 s | 1.00 s | 0/48 | **best** |
|  | `aws-bedrock/qwen.qwen3-vl-235b-a22b` | – | 2.02 s | 4.31 s | 0.96 s | 0/48 |  |

## 5. Route sweep (every chat route in scope, 3 single calls each)

basic = "pong", non-streaming; stream = tiny JSON, first token; image = 512 px JPEG, count the red circles (3). One shot each: indicative only. Times are adjusted (wall). Routes from other teams' dedicated allocations (openai-academics/-esw, vertex-contract-analyzer) were left out on purpose.

| Model | Route id | Works | Resolves to | basic | stream TTFT | image ✓ | note |
|---|---|---|---|---|---|---|---|
| claude-fable-5 | `microsoft-foundry-quark/claude-fable-5` | yes | microsoft-foundry | 1.52 s <sub>(1.57 s)</sub> | 2.13 s <sub>(2.19 s)</sub> | yes |  |
|  | `azure-foundry-quark/claude-fable-5` | yes | azure-foundry | 1.69 s <sub>(1.73 s)</sub> | 2.81 s <sub>(2.86 s)</sub> | yes |  |
|  | `claude-group/claude-fable-5` | yes | anthropic-primary/claude-fable-5 | 2.41 s <sub>(2.48 s)</sub> | 1.91 s <sub>(1.96 s)</sub> | yes |  |
|  | `anthropic-primary/claude-fable-5` | yes | anthropic | 2.41 s <sub>(2.46 s)</sub> | 2.15 s <sub>(2.19 s)</sub> | yes |  |
|  | `claude-fable-5` | yes | anthropic-primary/claude-fable-5 | 2.49 s <sub>(2.54 s)</sub> | 2.59 s <sub>(2.64 s)</sub> | yes |  |
|  | `claude-group/claude-fable-5-azure` | yes | azure-foundry-quark/claude-fable-5 | 2.52 s <sub>(2.56 s)</sub> | 3.02 s <sub>(3.06 s)</sub> | yes |  |
|  | `claude-fable-5-azure` | yes | azure-foundry-quark/claude-fable-5 | 2.62 s <sub>(2.74 s)</sub> | 1.85 s <sub>(1.90 s)</sub> | yes |  |
|  | `claude-max-traffic/claude-fable-5` | **no** | – | – | – | – | HTTP 401: anthropic error: Invalid bearer token |
|  | `claude-pro-traffic/claude-fable-5` | **no** | – | – | – | – | HTTP 401: anthropic error: Invalid bearer token |
| claude-fable-5-1 | `claude-fable-5-1-azure` | yes | azure-foundry-quark/claude-fable-5-1 | 1.09 s <sub>(1.14 s)</sub> | 1.05 s <sub>(1.10 s)</sub> | yes |  |
|  | `azure-foundry-quark/claude-fable-5-1` | yes | azure-foundry | 1.25 s <sub>(1.29 s)</sub> | 0.87 s <sub>(0.92 s)</sub> | yes |  |
|  | `anthropic-primary/claude-fable-5-1` | yes | anthropic | 1.31 s <sub>(1.37 s)</sub> | 1.77 s <sub>(1.82 s)</sub> | yes |  |
|  | `claude-group/claude-fable-5-1` | yes | anthropic-primary/claude-fable-5-1 | 1.32 s <sub>(1.36 s)</sub> | 0.69 s <sub>(0.73 s)</sub> | yes |  |
|  | `claude-group/claude-fable-5-1-azure` | yes | azure-foundry-quark/claude-fable-5-1 | 1.40 s <sub>(1.45 s)</sub> | 0.55 s <sub>(0.59 s)</sub> | yes |  |
|  | `microsoft-foundry-quark/claude-fable-5-1` | yes | microsoft-foundry | 1.46 s <sub>(1.50 s)</sub> | 0.67 s <sub>(0.71 s)</sub> | yes |  |
|  | `claude-fable-5-1` | yes | anthropic-primary/claude-fable-5-1 | 2.42 s <sub>(2.75 s)</sub> | 1.58 s <sub>(1.63 s)</sub> | yes |  |
|  | `claude-max-traffic/claude-fable-5-1` | **no** | – | – | – | – | HTTP 401: anthropic error: Invalid bearer token |
| claude-haiku | `claude-pro-group/claude-haiku` | yes | anthropic-primary/claude-haiku-4-5-20251001 | 0.46 s <sub>(0.50 s)</sub> | 0.40 s <sub>(0.48 s)</sub> | yes |  |
| claude-haiku-4-5 | `aws-bedrock/global.anthropic.claude-haiku-4-5-20251001-v1-0` | yes | aws-bedrock | 0.40 s <sub>(0.44 s)</sub> | 0.46 s <sub>(0.51 s)</sub> | yes |  |
|  | `claude-group/claude-haiku-4-5-20251001` | yes | anthropic-primary/claude-haiku-4-5-20251001 | 0.44 s <sub>(0.48 s)</sub> | 0.41 s <sub>(0.46 s)</sub> | yes |  |
|  | `claude-group/claude-haiku-4-5` | yes | anthropic-primary/claude-haiku-4-5 | 0.44 s <sub>(0.48 s)</sub> | 0.43 s <sub>(0.47 s)</sub> | yes |  |
|  | `anthropic-primary/claude-haiku-4-5-20251001` | yes | anthropic | 0.44 s <sub>(0.48 s)</sub> | 0.41 s <sub>(0.46 s)</sub> | yes |  |
|  | `anthropic-primary/claude-haiku-4-5` | yes | anthropic | 0.45 s <sub>(0.49 s)</sub> | 0.45 s <sub>(0.49 s)</sub> | yes |  |
|  | `claude-haiku-4-5-20251001` | yes | anthropic-primary/claude-haiku-4-5-20251001 | 0.45 s <sub>(0.50 s)</sub> | 0.42 s <sub>(0.46 s)</sub> | yes |  |
|  | `claude-haiku-4-5` | yes | anthropic-primary/claude-haiku-4-5 | 0.48 s <sub>(0.53 s)</sub> | 0.40 s <sub>(0.45 s)</sub> | yes |  |
|  | `aws-bedrock/us.anthropic.claude-haiku-4-5-20251001-v1-0` | yes | aws-bedrock | 0.51 s <sub>(0.55 s)</sub> | 0.49 s <sub>(0.54 s)</sub> | yes |  |
|  | `claude-pro-group/claude-haiku-4-5-20251001` | yes | anthropic-primary/claude-haiku-4-5-20251001 | 0.51 s <sub>(0.66 s)</sub> | 0.47 s <sub>(0.54 s)</sub> | yes |  |
|  | `aws-bedrock/eu.anthropic.claude-haiku-4-5-20251001-v1-0` | yes | aws-bedrock | 0.76 s <sub>(0.83 s)</sub> | 0.74 s <sub>(0.78 s)</sub> | yes |  |
|  | `azure-foundry-quark/claude-haiku-4-5` | yes | azure-foundry | 0.93 s <sub>(0.97 s)</sub> | 0.54 s <sub>(0.58 s)</sub> | yes |  |
|  | `microsoft-foundry-quark/claude-haiku-4-5` | yes | microsoft-foundry | 0.97 s <sub>(1.01 s)</sub> | 0.60 s <sub>(0.65 s)</sub> | yes |  |
|  | `claude-pro-traffic/claude-haiku-4-5` | **no** | – | – | – | – | HTTP 401: anthropic error: Invalid bearer token |
|  | `claude-max-traffic/claude-haiku-4-5` | **no** | – | – | – | – | HTTP 401: anthropic error: Invalid bearer token |
|  | `claude-max-traffic/claude-haiku-4-5-20251001` | **no** | – | – | – | – | HTTP 401: anthropic error: Invalid bearer token |
| claude-haiku-5-5 | `claude-group/claude-haiku-5-5` | yes | anthropic-primary/claude-haiku-5-5 | 0.50 s <sub>(0.55 s)</sub> | 0.43 s <sub>(0.47 s)</sub> | yes |  |
|  | `anthropic-primary/claude-haiku-5-5` | yes | anthropic | 0.54 s <sub>(0.58 s)</sub> | 0.60 s <sub>(0.64 s)</sub> | yes |  |
|  | `claude-haiku-5-5` | yes | anthropic-primary/claude-haiku-5-5 | 0.56 s <sub>(0.61 s)</sub> | 0.47 s <sub>(0.52 s)</sub> | yes |  |
|  | `microsoft-foundry-quark/claude-haiku-5-5` | yes | microsoft-foundry | 1.00 s <sub>(1.04 s)</sub> | 0.50 s <sub>(0.54 s)</sub> | yes |  |
|  | `claude-max-traffic/claude-haiku-5-5` | **no** | – | – | – | – | HTTP 401: anthropic error: Invalid bearer token |
|  | `claude-pro-group/claude-haiku-5-5` | **no** | claude-pro-traffic/claude-haiku-5-5 | – | – | – | HTTP 401: anthropic error: Invalid bearer token |
|  | `claude-pro-traffic/claude-haiku-5-5` | **no** | – | – | – | – | HTTP 401: anthropic error: Invalid bearer token |
| claude-opus | `claude-pro-group/claude-opus` | yes | anthropic-primary/claude-opus-4-8 | 7.04 s <sub>(7.09 s)</sub> | 1.23 s <sub>(1.27 s)</sub> | yes |  |
| claude-opus-4 | `anthropic-primary/claude-opus-4-20250514` | **no** | – | – | – | – | HTTP 404: anthropic error: model: claude-opus-4-20250514 |
|  | `anthropic-primary/claude-4-opus-20250514` | **no** | – | – | – | – | HTTP 404: anthropic error: model: claude-4-opus-20250514 |
| claude-opus-4-1 | `anthropic-primary/claude-opus-4-1` | **no** | – | – | – | – | HTTP 404: anthropic error: model: claude-opus-4-1 |
|  | `anthropic-primary/claude-opus-4-1-20250805` | **no** | – | – | – | – | HTTP 404: anthropic error: model: claude-opus-4-1-20250805 |
|  | `azure-foundry-quark/claude-opus-4-1` | **no** | – | – | – | – | HTTP 400: azure-foundry error: The API deployment for the resource is not ready, please wa |
|  | `microsoft-foundry-quark/claude-opus-4-1` | **no** | – | – | – | – | HTTP 400: microsoft-foundry error: The API deployment for the resource is not ready, pleas |
| claude-opus-4-5 | `azure-foundry-quark/claude-opus-4-5` | yes | azure-foundry | 0.82 s <sub>(0.87 s)</sub> | 1.09 s <sub>(1.13 s)</sub> | yes |  |
|  | `anthropic-primary/claude-opus-4-5` | yes | anthropic | 0.84 s <sub>(0.89 s)</sub> | 0.95 s <sub>(0.99 s)</sub> | yes |  |
|  | `microsoft-foundry-quark/claude-opus-4-5` | yes | microsoft-foundry | 0.96 s <sub>(1.00 s)</sub> | 1.02 s <sub>(1.30 s)</sub> | yes |  |
|  | `claude-group/claude-opus-4-5` | yes | anthropic-fast/claude-opus-4-5 | 1.10 s <sub>(1.14 s)</sub> | 0.96 s <sub>(1.01 s)</sub> | yes |  |
|  | `anthropic-primary/claude-opus-4-5-20251101` | yes | anthropic | 1.30 s <sub>(1.35 s)</sub> | 0.96 s <sub>(1.01 s)</sub> | yes |  |
|  | `aws-bedrock/us.anthropic.claude-opus-4-5-20251101-v1-0` | yes | aws-bedrock | 1.32 s <sub>(1.36 s)</sub> | 1.21 s <sub>(1.25 s)</sub> | yes |  |
|  | `aws-bedrock/global.anthropic.claude-opus-4-5-20251101-v1-0` | yes | aws-bedrock | 2.00 s <sub>(2.05 s)</sub> | 1.15 s <sub>(1.20 s)</sub> | yes |  |
| claude-opus-4-6 | `aws-bedrock/global.anthropic.claude-opus-4-6-v1` | yes | aws-bedrock | 1.27 s <sub>(1.31 s)</sub> | 1.18 s <sub>(1.23 s)</sub> | yes |  |
|  | `aws-bedrock/eu.anthropic.claude-opus-4-6-v1` | yes | aws-bedrock | 1.36 s <sub>(1.40 s)</sub> | 1.39 s <sub>(1.44 s)</sub> | yes |  |
|  | `microsoft-foundry-quark/claude-opus-4-6` | yes | microsoft-foundry | 1.55 s <sub>(1.59 s)</sub> | 2.80 s <sub>(2.85 s)</sub> | yes |  |
|  | `azure-foundry-quark/claude-opus-4-6` | yes | azure-foundry | 1.70 s <sub>(1.75 s)</sub> | 1.84 s <sub>(1.88 s)</sub> | yes |  |
|  | `anthropic-primary/claude-opus-4-6` | yes | anthropic | 1.74 s <sub>(1.78 s)</sub> | 1.84 s <sub>(1.89 s)</sub> | yes |  |
|  | `claude-group/claude-opus-4-6` | yes | anthropic-primary/claude-opus-4-6 | 2.60 s <sub>(2.64 s)</sub> | 1.63 s <sub>(1.70 s)</sub> | yes |  |
|  | `claude-opus-4-6` | yes | anthropic-primary/claude-opus-4-6 | 3.53 s <sub>(3.58 s)</sub> | 1.56 s <sub>(1.61 s)</sub> | yes |  |
| claude-opus-4-7 | `claude-opus-4-7` | yes | anthropic-primary/claude-opus-4-7 | 0.45 s <sub>(0.54 s)</sub> | 0.43 s <sub>(0.48 s)</sub> | yes |  |
|  | `aws-bedrock/global.anthropic.claude-opus-4-7` | yes | aws-bedrock | 0.61 s <sub>(0.65 s)</sub> | 0.58 s <sub>(0.62 s)</sub> | yes |  |
|  | `aws-bedrock/us.anthropic.claude-opus-4-7` | yes | aws-bedrock | 0.61 s <sub>(0.66 s)</sub> | 0.57 s <sub>(0.62 s)</sub> | yes |  |
|  | `claude-group/claude-opus-4-7` | yes | anthropic-primary/claude-opus-4-7 | 0.61 s <sub>(0.66 s)</sub> | 0.85 s <sub>(0.89 s)</sub> | yes |  |
|  | `azure-foundry-quark/claude-opus-4-7` | yes | azure-foundry | 0.63 s <sub>(0.68 s)</sub> | 0.56 s <sub>(0.61 s)</sub> | yes |  |
|  | `anthropic-primary/claude-opus-4-7` | yes | anthropic | 0.74 s <sub>(0.79 s)</sub> | 0.50 s <sub>(0.55 s)</sub> | yes |  |
|  | `aws-bedrock/eu.anthropic.claude-opus-4-7` | yes | aws-bedrock | 0.77 s <sub>(0.82 s)</sub> | 0.73 s <sub>(0.77 s)</sub> | yes |  |
|  | `microsoft-foundry-quark/claude-opus-4-7` | yes | microsoft-foundry | 0.94 s <sub>(0.98 s)</sub> | 0.60 s <sub>(0.65 s)</sub> | yes |  |
|  | `claude-max-traffic/claude-opus-4-7` | **no** | – | – | – | – | HTTP 401: anthropic error: Invalid bearer token |
|  | `claude-pro-traffic/claude-opus-4-7` | **no** | – | – | – | – | HTTP 401: anthropic error: Invalid bearer token |
| claude-opus-4-8 | `anthropic-primary/claude-opus-4-8` | yes | anthropic | 0.55 s <sub>(0.59 s)</sub> | 1.22 s <sub>(1.27 s)</sub> | yes |  |
|  | `aws-bedrock/global.anthropic.claude-opus-4-8` | yes | aws-bedrock | 0.69 s <sub>(0.74 s)</sub> | 0.68 s <sub>(0.72 s)</sub> | yes |  |
|  | `aws-bedrock/us.anthropic.claude-opus-4-8` | yes | aws-bedrock | 0.74 s <sub>(0.79 s)</sub> | 0.85 s <sub>(0.89 s)</sub> | yes |  |
|  | `microsoft-foundry-quark/claude-opus-4-8` | yes | microsoft-foundry | 0.77 s <sub>(0.82 s)</sub> | 1.46 s <sub>(1.51 s)</sub> | yes |  |
|  | `claude-group/claude-opus-4-8` | yes | anthropic-primary/claude-opus-4-8 | 0.81 s <sub>(0.85 s)</sub> | 0.87 s <sub>(0.91 s)</sub> | yes |  |
|  | `azure-foundry-quark/claude-opus-4-8` | yes | azure-foundry | 0.85 s <sub>(0.91 s)</sub> | 0.81 s <sub>(0.86 s)</sub> | yes |  |
|  | `aws-bedrock/eu.anthropic.claude-opus-4-8` | yes | aws-bedrock | 0.94 s <sub>(0.99 s)</sub> | 0.89 s <sub>(0.93 s)</sub> | yes |  |
|  | `claude-opus-4-8` | yes | anthropic-primary/claude-opus-4-8 | 1.61 s <sub>(1.65 s)</sub> | 0.84 s <sub>(0.88 s)</sub> | yes |  |
|  | `claude-max-traffic/claude-opus-4-8` | **no** | – | – | – | – | HTTP 401: anthropic error: Invalid bearer token |
|  | `claude-pro-traffic/claude-opus-4-8` | **no** | – | – | – | – | HTTP 401: anthropic error: Invalid bearer token |
| claude-opus-5 | `aws-bedrock/global.anthropic.claude-opus-5` | yes | aws-bedrock | 1.14 s <sub>(1.18 s)</sub> | 1.54 s <sub>(1.58 s)</sub> | yes |  |
|  | `anthropic-primary/claude-opus-5` | yes | anthropic | 1.17 s <sub>(1.22 s)</sub> | 1.53 s <sub>(1.57 s)</sub> | yes |  |
|  | `azure-foundry-quark/claude-opus-5` | yes | azure-foundry | 1.26 s <sub>(1.30 s)</sub> | 1.64 s <sub>(1.69 s)</sub> | yes |  |
|  | `claude-group/claude-opus-5` | yes | anthropic-primary/claude-opus-5 | 1.28 s <sub>(1.32 s)</sub> | 0.78 s <sub>(0.82 s)</sub> | yes |  |
|  | `aws-bedrock/us.anthropic.claude-opus-5` | yes | aws-bedrock | 1.43 s <sub>(1.48 s)</sub> | 0.81 s <sub>(0.85 s)</sub> | yes |  |
|  | `aws-bedrock/eu.anthropic.claude-opus-5` | yes | aws-bedrock | 1.45 s <sub>(1.49 s)</sub> | 10.3 s <sub>(10.3 s)</sub> | yes |  |
|  | `microsoft-foundry-quark/claude-opus-5` | yes | microsoft-foundry | 2.42 s <sub>(2.79 s)</sub> | 1.33 s <sub>(1.38 s)</sub> | yes |  |
|  | `claude-opus-5` | yes | anthropic-primary/claude-opus-5 | 2.82 s <sub>(2.86 s)</sub> | 0.60 s <sub>(0.66 s)</sub> | yes |  |
|  | `claude-max-traffic/claude-opus-5` | **no** | – | – | – | – | HTTP 401: anthropic error: Invalid bearer token |
|  | `claude-pro-group/claude-opus-5` | **no** | claude-pro-traffic/claude-opus-5 | – | – | – | HTTP 401: anthropic error: Invalid bearer token |
|  | `claude-pro-traffic/claude-opus-5` | **no** | – | – | – | – | HTTP 401: anthropic error: Invalid bearer token |
| claude-opus-5-5 | `aws-bedrock/us.anthropic.claude-opus-5-5` | yes | aws-bedrock | 0.90 s <sub>(0.95 s)</sub> | 0.83 s <sub>(0.93 s)</sub> | yes |  |
|  | `microsoft-foundry-quark/claude-opus-5-5` | yes | microsoft-foundry | 1.03 s <sub>(1.07 s)</sub> | 1.97 s <sub>(2.01 s)</sub> | yes |  |
|  | `aws-bedrock/global.anthropic.claude-opus-5-5` | yes | aws-bedrock | 1.24 s <sub>(1.29 s)</sub> | 1.04 s <sub>(1.08 s)</sub> | yes |  |
|  | `claude-group/claude-opus-5-5` | yes | anthropic-primary/claude-opus-5-5 | 1.24 s <sub>(1.29 s)</sub> | 0.87 s <sub>(0.92 s)</sub> | yes |  |
|  | `anthropic-primary/claude-opus-5-5` | yes | anthropic | 1.42 s <sub>(1.96 s)</sub> | 1.65 s <sub>(1.70 s)</sub> | yes |  |
|  | `claude-opus-5-5` | yes | anthropic-primary/claude-opus-5-5 | 1.91 s <sub>(1.95 s)</sub> | 1.05 s <sub>(1.09 s)</sub> | yes |  |
|  | `aws-bedrock/eu.anthropic.claude-opus-5-5` | yes | aws-bedrock | 2.28 s <sub>(2.33 s)</sub> | 0.87 s <sub>(0.91 s)</sub> | yes |  |
|  | `claude-pro-group/claude-opus-5-5` | **no** | claude-pro-traffic/claude-opus-5-5 | – | – | – | HTTP 401: anthropic error: Invalid bearer token |
|  | `claude-max-traffic/claude-opus-5-5` | **no** | – | – | – | – | HTTP 401: anthropic error: Invalid bearer token |
|  | `claude-pro-traffic/claude-opus-5-5` | **no** | – | – | – | – | HTTP 401: anthropic error: Invalid bearer token |
| claude-opus-5-5-2 | `microsoft-foundry-quark/claude-opus-5-5-2` | yes | microsoft-foundry | 1.30 s <sub>(1.34 s)</sub> | 0.53 s <sub>(0.58 s)</sub> | yes |  |
| claude-sonnet | `claude-pro-group/claude-sonnet` | yes | anthropic-primary/claude-sonnet-5 | 0.86 s <sub>(0.90 s)</sub> | 0.59 s <sub>(0.70 s)</sub> | yes |  |
| claude-sonnet-4 | `anthropic-primary/claude-sonnet-4-20250514` | **no** | – | – | – | – | HTTP 404: anthropic error: model: claude-sonnet-4-20250514 |
|  | `anthropic-primary/claude-4-sonnet-20250514` | **no** | – | – | – | – | HTTP 404: anthropic error: model: claude-4-sonnet-20250514 |
| claude-sonnet-4-5 | `claude-group/claude-sonnet-4-5-20250929` | yes | anthropic-primary/claude-sonnet-4-5-20250929 | 0.69 s <sub>(0.76 s)</sub> | 0.77 s <sub>(0.82 s)</sub> | yes |  |
|  | `anthropic-primary/claude-sonnet-4-5-20250929` | yes | anthropic | 0.70 s <sub>(0.74 s)</sub> | 0.89 s <sub>(0.93 s)</sub> | yes |  |
|  | `anthropic-primary/claude-sonnet-4-5` | yes | anthropic | 0.71 s <sub>(0.76 s)</sub> | 1.06 s <sub>(1.10 s)</sub> | yes |  |
|  | `claude-sonnet-4-5-20250929` | yes | anthropic-primary/claude-sonnet-4-5-20250929 | 0.86 s <sub>(0.91 s)</sub> | 0.64 s <sub>(0.68 s)</sub> | yes |  |
|  | `aws-bedrock/global.anthropic.claude-sonnet-4-5-20250929-v1-0` | yes | aws-bedrock | 1.68 s <sub>(1.73 s)</sub> | 1.44 s <sub>(1.48 s)</sub> | yes |  |
| claude-sonnet-4-6 | `aws-bedrock/eu.anthropic.claude-sonnet-4-6` | yes | aws-bedrock | 0.64 s <sub>(0.69 s)</sub> | 0.78 s <sub>(0.82 s)</sub> | yes |  |
|  | `aws-bedrock/global.anthropic.claude-sonnet-4-6` | yes | aws-bedrock | 0.65 s <sub>(0.70 s)</sub> | 0.62 s <sub>(0.66 s)</sub> | yes |  |
|  | `azure-foundry-quark/claude-sonnet-4-6` | yes | azure-foundry | 0.77 s <sub>(0.82 s)</sub> | 0.87 s <sub>(0.92 s)</sub> | yes |  |
|  | `microsoft-foundry-quark/claude-sonnet-4-6` | yes | microsoft-foundry | 0.93 s <sub>(0.97 s)</sub> | 1.17 s <sub>(1.21 s)</sub> | yes |  |
|  | `claude-group/claude-sonnet-4-6` | yes | anthropic-primary/claude-sonnet-4-6 | 1.01 s <sub>(1.06 s)</sub> | 0.83 s <sub>(0.88 s)</sub> | yes |  |
|  | `claude-sonnet-4-6` | yes | anthropic-primary/claude-sonnet-4-6 | 1.28 s <sub>(1.32 s)</sub> | 0.87 s <sub>(0.91 s)</sub> | yes |  |
|  | `anthropic-primary/claude-sonnet-4-6` | yes | anthropic | 1.36 s <sub>(1.41 s)</sub> | 2.33 s <sub>(2.37 s)</sub> | yes |  |
|  | `claude-max-traffic/claude-sonnet-4-6` | **no** | – | – | – | – | HTTP 401: anthropic error: Invalid bearer token |
|  | `claude-pro-traffic/claude-sonnet-4-6` | **no** | – | – | – | – | HTTP 401: anthropic error: Invalid bearer token |
| claude-sonnet-5 | `claude-group/claude-sonnet-5` | yes | anthropic-primary/claude-sonnet-5 | 0.62 s <sub>(0.67 s)</sub> | 0.58 s <sub>(0.63 s)</sub> | yes |  |
|  | `azure-foundry-quark/claude-sonnet-5` | yes | azure-foundry | 0.83 s <sub>(0.87 s)</sub> | 0.87 s <sub>(0.91 s)</sub> | yes |  |
|  | `microsoft-foundry-quark/claude-sonnet-5` | yes | microsoft-foundry | 0.86 s <sub>(0.90 s)</sub> | 0.85 s <sub>(0.90 s)</sub> | yes |  |
|  | `claude-sonnet-5` | yes | anthropic-primary/claude-sonnet-5 | 0.94 s <sub>(0.99 s)</sub> | 0.68 s <sub>(0.76 s)</sub> | yes |  |
|  | `aws-bedrock/global.anthropic.claude-sonnet-5` | yes | aws-bedrock | 1.06 s <sub>(1.10 s)</sub> | 1.14 s <sub>(1.20 s)</sub> | yes |  |
|  | `aws-bedrock/eu.anthropic.claude-sonnet-5` | yes | aws-bedrock | 1.28 s <sub>(1.32 s)</sub> | – | yes | stream: <html> <head><title>502 Bad Gateway</title></head> <body> <c |
|  | `anthropic-primary/claude-sonnet-5` | yes | anthropic | 1.37 s <sub>(1.43 s)</sub> | 0.65 s <sub>(0.72 s)</sub> | yes |  |
|  | `aws-bedrock/us.anthropic.claude-sonnet-5` | yes | aws-bedrock | 1.41 s <sub>(1.45 s)</sub> | 1.11 s <sub>(1.15 s)</sub> | yes |  |
|  | `claude-max-traffic/claude-sonnet-5` | **no** | – | – | – | – | HTTP 401: anthropic error: Invalid bearer token |
|  | `claude-pro-traffic/claude-sonnet-5` | **no** | – | – | – | – | HTTP 401: anthropic error: Invalid bearer token |
| claude-sonnet-5-5 | `aws-bedrock/global.anthropic.claude-sonnet-5-5` | yes | aws-bedrock | 0.86 s <sub>(0.90 s)</sub> | 0.71 s <sub>(0.75 s)</sub> | yes |  |
|  | `claude-group/claude-sonnet-5-5` | yes | anthropic-primary/claude-sonnet-5-5 | 0.97 s <sub>(1.02 s)</sub> | 0.64 s <sub>(0.68 s)</sub> | yes |  |
|  | `anthropic-primary/claude-sonnet-5-5` | yes | anthropic | 1.02 s <sub>(1.06 s)</sub> | 0.45 s <sub>(0.56 s)</sub> | yes |  |
|  | `microsoft-foundry-quark/claude-sonnet-5-5` | yes | microsoft-foundry | 1.06 s <sub>(1.11 s)</sub> | 0.59 s <sub>(0.63 s)</sub> | yes |  |
|  | `claude-sonnet-5-5` | yes | anthropic-primary/claude-sonnet-5-5 | 1.56 s <sub>(1.61 s)</sub> | 1.62 s <sub>(1.66 s)</sub> | yes |  |
|  | `claude-pro-traffic/claude-sonnet-5-5` | **no** | – | – | – | – | HTTP 401: anthropic error: Invalid bearer token |
|  | `claude-max-traffic/claude-sonnet-5-5` | **no** | – | – | – | – | HTTP 401: anthropic error: Invalid bearer token |
|  | `claude-pro-group/claude-sonnet-5-5` | **no** | claude-pro-traffic/claude-sonnet-5-5 | – | – | – | HTTP 401: anthropic error: Invalid bearer token |
| gemini-2.5-flash | `gemini-group/gemini-2.5-flash-flex` | yes | gemini-flex/gemini-2.5-flash | 0.39 s <sub>(0.43 s)</sub> | 0.52 s <sub>(0.57 s)</sub> | yes |  |
|  | `gemini-flex/gemini-2.5-flash` | yes | google | 0.44 s <sub>(0.49 s)</sub> | 0.79 s <sub>(0.83 s)</sub> | yes |  |
|  | `gemini-2.5-flash-flex` | yes | gemini-flex/gemini-2.5-flash | 0.54 s <sub>(0.59 s)</sub> | 0.56 s <sub>(0.60 s)</sub> | yes |  |
|  | `gemini-group/gemini-2.5-flash` | yes | vertex-contract-analyzer/gemini-2.5-flash | 0.63 s <sub>(0.67 s)</sub> | 0.97 s <sub>(1.01 s)</sub> | yes |  |
|  | `gemini-2.5-flash` | yes | vertex-contract-analyzer/gemini-2.5-flash | 0.64 s <sub>(0.69 s)</sub> | 0.81 s <sub>(0.92 s)</sub> | yes |  |
| gemini-2.5-flash-lite | `gemini-2.5-flash-lite-flex` | yes | gemini-flex/gemini-2.5-flash-lite | 0.21 s <sub>(0.26 s)</sub> | 0.39 s <sub>(0.55 s)</sub> | yes |  |
|  | `gemini-primary/gemini-2.5-flash-lite` | yes | google | 0.24 s <sub>(0.29 s)</sub> | 0.32 s <sub>(0.36 s)</sub> | yes |  |
|  | `gemini-flex/gemini-2.5-flash-lite` | yes | google | 0.31 s <sub>(0.36 s)</sub> | 0.42 s <sub>(0.71 s)</sub> | yes |  |
|  | `gemini-group/gemini-2.5-flash-lite-flex` | yes | gemini-flex/gemini-2.5-flash-lite | 0.34 s <sub>(0.52 s)</sub> | 0.55 s <sub>(0.59 s)</sub> | yes |  |
| gemini-2.5-pro | `gemini-2.5-pro` | yes | vertex-contract-analyzer/gemini-2.5-pro | 3.38 s <sub>(3.45 s)</sub> | 4.71 s <sub>(4.75 s)</sub> | yes |  |
|  | `gemini-group/gemini-2.5-pro` | yes | vertex-contract-analyzer/gemini-2.5-pro | 5.97 s <sub>(6.01 s)</sub> | 4.56 s <sub>(4.60 s)</sub> | yes |  |
| gemini-3-flash | `gemini-flex/gemini-3-flash-preview` | yes | google | 0.88 s <sub>(0.92 s)</sub> | 1.05 s <sub>(1.10 s)</sub> | yes |  |
|  | `gemini-primary/gemini-3-flash-preview` | yes | google | 0.90 s <sub>(0.94 s)</sub> | 1.30 s <sub>(1.34 s)</sub> | yes |  |
|  | `gemini-3-flash-preview` | yes | gemini-primary/gemini-3-flash-preview | 1.01 s <sub>(1.05 s)</sub> | 1.46 s <sub>(1.50 s)</sub> | yes |  |
|  | `gemini-group/gemini-3-flash-preview` | yes | gemini-primary/gemini-3-flash-preview | 1.03 s <sub>(1.08 s)</sub> | 1.63 s <sub>(1.68 s)</sub> | yes |  |
| gemini-3-flash-preview | `gemini-3-flash-preview-flex` | yes | gemini-flex/gemini-3-flash-preview | 1.01 s <sub>(1.05 s)</sub> | 0.91 s <sub>(0.95 s)</sub> | yes |  |
|  | `gemini-group/gemini-3-flash-preview-flex` | yes | gemini-flex/gemini-3-flash-preview | 1.18 s <sub>(1.22 s)</sub> | 0.90 s <sub>(0.95 s)</sub> | yes |  |
| gemini-3.1-flash-lite | `gemini-group/gemini-3.1-flash-lite-flex` | yes | gemini-flex/gemini-3.1-flash-lite | 0.53 s <sub>(0.58 s)</sub> | 0.69 s <sub>(0.73 s)</sub> | yes |  |
|  | `gemini-primary/gemini-3.1-flash-lite` | yes | google | 0.53 s <sub>(0.58 s)</sub> | 0.52 s <sub>(0.63 s)</sub> | yes |  |
|  | `gemini-flex/gemini-3.1-flash-lite` | yes | google | 0.99 s <sub>(1.05 s)</sub> | 0.47 s <sub>(0.54 s)</sub> | yes |  |
|  | `gemini-3.1-flash-lite-flex` | yes | gemini-flex/gemini-3.1-flash-lite | 1.58 s <sub>(1.63 s)</sub> | 0.74 s <sub>(0.78 s)</sub> | yes |  |
| gemini-3.1-pro | `gemini-primary/gemini-3.1-pro-preview` | yes | google | 14.2 s <sub>(14.3 s)</sub> | 11.4 s <sub>(11.6 s)</sub> | yes |  |
|  | `gemini-group/gemini-3.1-pro` | yes | gemini-primary/gemini-3.1-pro-preview | 17.6 s <sub>(17.6 s)</sub> | 19.8 s <sub>(19.8 s)</sub> | yes |  |
| gemini-3.1-pro-preview-customtools | `gemini-group/gemini-3.1-pro-preview-customtools` | yes | gemini-primary/gemini-3.1-pro-preview-customtools | 9.85 s <sub>(9.89 s)</sub> | 62.1 s <sub>(62.1 s)</sub> | yes |  |
|  | `gemini-3.1-pro-preview-customtools` | yes | gemini-primary/gemini-3.1-pro-preview-customtools | 18.1 s <sub>(18.2 s)</sub> | 73.4 s <sub>(73.5 s)</sub> | yes |  |
|  | `gemini-primary/gemini-3.1-pro-preview-customtools` | **no** | – | – | – | – | no complete response within 90000 ms |
| gemini-3.5-flash | `gemini-3.5-flash` | yes | gemini-primary/gemini-3.5-flash | 1.19 s <sub>(1.75 s)</sub> | 1.96 s <sub>(2.01 s)</sub> | yes |  |
|  | `gemini-group/gemini-3.5-flash` | yes | gemini-primary/gemini-3.5-flash | 1.42 s <sub>(1.46 s)</sub> | 1.55 s <sub>(1.59 s)</sub> | yes |  |
|  | `gemini-primary/gemini-3.5-flash` | yes | google | 1.42 s <sub>(1.56 s)</sub> | 1.34 s <sub>(1.38 s)</sub> | yes |  |
|  | `gemini-flex/gemini-3.5-flash` | yes | google | 1.70 s <sub>(1.74 s)</sub> | 1.66 s <sub>(1.73 s)</sub> | yes |  |
|  | `gemini-group/gemini-3.5-flash-flex` | yes | gemini-flex/gemini-3.5-flash | 1.83 s <sub>(1.88 s)</sub> | 1.33 s <sub>(1.37 s)</sub> | no | image: gcp error: This model is currently experiencing high demand. |
|  | `gemini-3.5-flash-flex` | yes | gemini-flex/gemini-3.5-flash | 2.02 s <sub>(2.06 s)</sub> | 2.06 s <sub>(2.10 s)</sub> | yes |  |
| gemini-3.5-flash-lite | `gemini-flex/gemini-3.5-flash-lite` | yes | google | 0.41 s <sub>(0.49 s)</sub> | 0.83 s <sub>(0.88 s)</sub> | yes |  |
|  | `gemini-group/gemini-3.5-flash-lite` | yes | gemini-primary/gemini-3.5-flash-lite | 0.46 s <sub>(0.50 s)</sub> | 0.48 s <sub>(0.53 s)</sub> | yes |  |
|  | `gemini-3.5-flash-lite` | yes | gemini-primary/gemini-3.5-flash-lite | 0.46 s <sub>(0.50 s)</sub> | 0.53 s <sub>(0.58 s)</sub> | yes |  |
|  | `gemini-primary/gemini-3.5-flash-lite` | yes | google | 0.55 s <sub>(0.59 s)</sub> | 0.76 s <sub>(0.88 s)</sub> | yes |  |
|  | `gemini-group/gemini-3.5-flash-lite-flex` | yes | gemini-flex/gemini-3.5-flash-lite | 0.55 s <sub>(0.59 s)</sub> | 0.66 s <sub>(0.71 s)</sub> | yes |  |
|  | `gemini-3.5-flash-lite-flex` | yes | gemini-flex/gemini-3.5-flash-lite | 0.62 s <sub>(0.66 s)</sub> | 6.55 s <sub>(6.59 s)</sub> | yes |  |
| gemini-3.6-flash | `gemini-flex/gemini-3.6-flash` | yes | google | 1.19 s <sub>(1.23 s)</sub> | 1.69 s <sub>(1.77 s)</sub> | yes |  |
|  | `gemini-primary/gemini-3.6-flash` | yes | google | 1.36 s <sub>(1.46 s)</sub> | 1.60 s <sub>(1.65 s)</sub> | yes |  |
|  | `gemini-group/gemini-3.6-flash-flex` | yes | gemini-flex/gemini-3.6-flash | 1.45 s <sub>(1.49 s)</sub> | 1.67 s <sub>(1.71 s)</sub> | no | image: gcp error: This model is currently experiencing high demand. |
|  | `gemini-3.6-flash` | yes | gemini-primary/gemini-3.6-flash | 1.47 s <sub>(1.52 s)</sub> | 1.37 s <sub>(1.46 s)</sub> | yes |  |
|  | `gemini-group/gemini-3.6-flash` | yes | gemini-primary/gemini-3.6-flash | 1.91 s <sub>(1.96 s)</sub> | 1.71 s <sub>(1.75 s)</sub> | yes |  |
|  | `gemini-3.6-flash-flex` | yes | gemini-flex/gemini-3.6-flash | 2.08 s <sub>(2.12 s)</sub> | 3.42 s <sub>(3.46 s)</sub> | yes |  |
| gemini-3.7-flash | `gemini-3.7-flash` | yes | gemini-primary/gemini-3.7-flash | 1.51 s <sub>(1.56 s)</sub> | 1.87 s <sub>(1.92 s)</sub> | yes |  |
|  | `gemini-flex/gemini-3.7-flash` | yes | google | 1.98 s <sub>(2.04 s)</sub> | 2.25 s <sub>(2.29 s)</sub> | yes |  |
|  | `gemini-primary/gemini-3.7-flash` | yes | google | 2.09 s <sub>(2.13 s)</sub> | 1.14 s <sub>(1.18 s)</sub> | yes |  |
|  | `gemini-group/gemini-3.7-flash` | yes | gemini-primary/gemini-3.7-flash | 2.78 s <sub>(2.82 s)</sub> | 1.49 s <sub>(1.53 s)</sub> | yes |  |
|  | `gemini-group/gemini-3.7-flash-flex` | yes | gemini-flex/gemini-3.7-flash | 3.59 s <sub>(3.63 s)</sub> | – | yes | stream: gcp error: [{"error":{"code":503,"message":"This model is cu |
|  | `gemini-3.7-flash-flex` | **no** | gemini-flex/gemini-3.7-flash | – | – | – | HTTP 503: gcp error: This model is currently experiencing high demand. Spikes in demand ar |
| gemini-3.8-flash | `gemini-group/gemini-3.8-flash` | yes | gemini-primary/gemini-3.8-flash | 1.44 s <sub>(1.49 s)</sub> | 2.60 s <sub>(2.65 s)</sub> | yes |  |
|  | `gemini-3.8-flash` | yes | gemini-primary/gemini-3.8-flash | 1.45 s <sub>(1.49 s)</sub> | 4.03 s <sub>(4.07 s)</sub> | yes |  |
|  | `gemini-primary/gemini-3.8-flash` | yes | google | 2.35 s <sub>(2.67 s)</sub> | 2.52 s <sub>(2.56 s)</sub> | yes |  |
| gemini-4-argon | `gemini-group/gemini-4-argon` | yes | gemini-primary/gemini-4-argon | 2.03 s <sub>(2.08 s)</sub> | 1.66 s <sub>(1.71 s)</sub> | yes |  |
|  | `gemini-4-argon` | yes | gemini-primary/gemini-4-argon | 4.13 s <sub>(4.18 s)</sub> | 2.36 s <sub>(2.41 s)</sub> | yes |  |
|  | `gemini-primary/gemini-4-argon` | yes | google | 62.1 s <sub>(62.1 s)</sub> | 16.2 s <sub>(16.3 s)</sub> | yes |  |
| gpt-5 | `openai-primary/gpt-5` | yes | openai | 1.23 s <sub>(1.27 s)</sub> | 2.49 s <sub>(2.54 s)</sub> | yes |  |
|  | `openai-group/gpt-5` | yes | openai-primary/gpt-5 | 1.57 s <sub>(1.62 s)</sub> | 2.06 s <sub>(2.10 s)</sub> | yes |  |
|  | `gpt-5` | yes | openai-primary/gpt-5 | 1.82 s <sub>(1.87 s)</sub> | 3.84 s <sub>(3.89 s)</sub> | yes |  |
| gpt-5-mini | `openai-primary/gpt-5-mini` | yes | openai | 0.86 s <sub>(0.91 s)</sub> | 1.61 s <sub>(1.66 s)</sub> | yes |  |
|  | `openai-group/gpt-5-mini` | yes | openai-primary/gpt-5-mini | 0.88 s <sub>(0.92 s)</sub> | 1.17 s <sub>(1.22 s)</sub> | yes |  |
|  | `gpt-5-mini` | yes | openai-primary/gpt-5-mini | 1.03 s <sub>(1.08 s)</sub> | 1.59 s <sub>(1.63 s)</sub> | yes |  |
| gpt-5-nano | `openai-primary/gpt-5-nano` | yes | openai | 1.18 s <sub>(1.22 s)</sub> | 2.08 s <sub>(2.12 s)</sub> | yes |  |
|  | `gpt-5-nano` | yes | openai-primary/gpt-5-nano | 1.21 s <sub>(1.25 s)</sub> | 1.52 s <sub>(1.57 s)</sub> | yes |  |
|  | `openai-group/gpt-5-nano` | yes | openai-primary/gpt-5-nano | 1.41 s <sub>(1.53 s)</sub> | 2.00 s <sub>(2.05 s)</sub> | yes |  |
| gpt-5.2 | `openai-group/gpt-5.2` | yes | openai-primary/gpt-5.2 | 0.65 s <sub>(0.70 s)</sub> | 0.81 s <sub>(0.91 s)</sub> | yes |  |
|  | `openai-primary/gpt-5.2` | yes | openai | 0.68 s <sub>(0.72 s)</sub> | 0.61 s <sub>(0.65 s)</sub> | yes |  |
|  | `gpt-5.2` | yes | openai-primary/gpt-5.2 | 0.70 s <sub>(0.75 s)</sub> | 0.53 s <sub>(0.58 s)</sub> | yes |  |
| gpt-5.3-chat-latest | `openai-primary/gpt-5.3-chat-latest` | **no** | – | – | – | – | HTTP 404: openai error: The model `gpt-5.3-chat-latest` has been deprecated, learn more he |
| gpt-5.3-codex | `openai-group/gpt-5.3-codex` | yes | openai-primary/gpt-5.3-codex | 0.68 s <sub>(0.72 s)</sub> | 0.62 s <sub>(0.67 s)</sub> | yes |  |
|  | `openai-primary/gpt-5.3-codex` | yes | openai | 0.70 s <sub>(0.77 s)</sub> | 0.58 s <sub>(0.63 s)</sub> | yes |  |
|  | `codex-traffic/gpt-5.3-codex` | yes | openai | 0.73 s <sub>(0.78 s)</sub> | 0.63 s <sub>(0.67 s)</sub> | yes |  |
|  | `codex-group/gpt-5.3-codex` | yes | codex-traffic/gpt-5.3-codex | 0.78 s <sub>(0.83 s)</sub> | 0.58 s <sub>(0.63 s)</sub> | yes |  |
|  | `gpt-5.3-codex` | yes | openai-primary/gpt-5.3-codex | 0.80 s <sub>(0.84 s)</sub> | 0.57 s <sub>(0.61 s)</sub> | yes |  |
| gpt-5.4 | `openai-group/gpt-5.4` | yes | openai-primary/gpt-5.4 | 0.62 s <sub>(0.68 s)</sub> | 0.62 s <sub>(0.67 s)</sub> | yes |  |
|  | `openai-primary/gpt-5.4` | yes | openai | 0.67 s <sub>(0.72 s)</sub> | 0.56 s <sub>(0.61 s)</sub> | yes |  |
|  | `gpt-5.4` | yes | openai-primary/gpt-5.4 | 0.68 s <sub>(0.72 s)</sub> | 0.74 s <sub>(0.78 s)</sub> | yes |  |
| gpt-5.4-mini | `gpt-5.4-mini` | yes | openai-primary/gpt-5.4-mini | 0.38 s <sub>(0.43 s)</sub> | 0.68 s <sub>(0.73 s)</sub> | yes |  |
|  | `openai-primary/gpt-5.4-mini` | yes | openai | 0.39 s <sub>(0.52 s)</sub> | 0.52 s <sub>(0.58 s)</sub> | yes |  |
|  | `openai-group/gpt-5.4-mini` | yes | openai-primary/gpt-5.4-mini | 0.46 s <sub>(0.51 s)</sub> | 0.72 s <sub>(0.76 s)</sub> | yes |  |
| gpt-5.4-nano | `openai-primary/gpt-5.4-nano` | yes | openai | 0.44 s <sub>(0.48 s)</sub> | 0.43 s <sub>(0.51 s)</sub> | yes |  |
|  | `openai-group/gpt-5.4-nano` | yes | openai-primary/gpt-5.4-nano | 0.49 s <sub>(0.53 s)</sub> | 0.59 s <sub>(0.64 s)</sub> | yes |  |
|  | `gpt-5.4-nano` | yes | openai-primary/gpt-5.4-nano | 0.67 s <sub>(0.75 s)</sub> | 0.44 s <sub>(0.49 s)</sub> | yes |  |
| gpt-5.5 | `gpt-5.5` | yes | openai-primary/gpt-5.5 | 1.00 s <sub>(1.05 s)</sub> | 0.86 s <sub>(0.91 s)</sub> | yes |  |
|  | `openai-primary/gpt-5.5` | yes | openai | 1.01 s <sub>(1.05 s)</sub> | 0.87 s <sub>(0.92 s)</sub> | yes |  |
|  | `openai-group/gpt-5.5` | yes | openai-primary/gpt-5.5 | 1.27 s <sub>(1.31 s)</sub> | 1.09 s <sub>(1.14 s)</sub> | yes |  |
| gpt-5.6-luna | `gpt-5.6-luna` | yes | openai-primary/gpt-5.6-luna | 0.51 s <sub>(0.57 s)</sub> | 0.66 s <sub>(0.83 s)</sub> | yes |  |
|  | `codex-group/gpt-5.6-luna` | yes | codex-traffic/gpt-5.6-luna | 0.55 s <sub>(0.59 s)</sub> | 0.60 s <sub>(0.65 s)</sub> | yes |  |
|  | `openai-group/gpt-5.6-luna` | yes | openai-primary/gpt-5.6-luna | 0.60 s <sub>(0.72 s)</sub> | 0.86 s <sub>(0.90 s)</sub> | yes |  |
|  | `openai-primary/gpt-5.6-luna` | yes | openai | 0.63 s <sub>(0.68 s)</sub> | 0.60 s <sub>(0.65 s)</sub> | yes |  |
|  | `codex-traffic/gpt-5.6-luna` | yes | openai | 0.76 s <sub>(0.81 s)</sub> | 0.72 s <sub>(0.87 s)</sub> | yes |  |
| gpt-5.6-sol | `openai-group/gpt-5.6-sol` | yes | openai-primary/gpt-5.6-sol | 0.72 s <sub>(0.82 s)</sub> | 0.87 s <sub>(0.91 s)</sub> | yes |  |
|  | `openai-primary/gpt-5.6-sol` | yes | openai | 0.78 s <sub>(0.82 s)</sub> | 0.95 s <sub>(1.20 s)</sub> | yes |  |
|  | `codex-group/gpt-5.6-sol` | yes | codex-traffic/gpt-5.6-sol | 0.79 s <sub>(0.83 s)</sub> | 0.71 s <sub>(0.78 s)</sub> | yes |  |
|  | `codex-traffic/gpt-5.6-sol` | yes | openai | 0.97 s <sub>(1.02 s)</sub> | 1.04 s <sub>(1.08 s)</sub> | yes |  |
|  | `gpt-5.6-sol` | yes | openai-primary/gpt-5.6-sol | 1.43 s <sub>(1.48 s)</sub> | 0.71 s <sub>(0.93 s)</sub> | yes |  |
| gpt-5.6-terra | `codex-traffic/gpt-5.6-terra` | yes | openai | 0.50 s <sub>(0.59 s)</sub> | 0.58 s <sub>(0.63 s)</sub> | yes |  |
|  | `codex-group/gpt-5.6-terra` | yes | codex-traffic/gpt-5.6-terra | 0.56 s <sub>(0.60 s)</sub> | 0.79 s <sub>(0.89 s)</sub> | yes |  |
|  | `gpt-5.6-terra` | yes | openai-primary/gpt-5.6-terra | 0.61 s <sub>(0.72 s)</sub> | 0.59 s <sub>(0.64 s)</sub> | yes |  |
|  | `openai-group/gpt-5.6-terra` | yes | openai-primary/gpt-5.6-terra | 0.66 s <sub>(0.70 s)</sub> | 0.58 s <sub>(0.63 s)</sub> | yes |  |
|  | `openai-primary/gpt-5.6-terra` | yes | openai | 0.71 s <sub>(0.81 s)</sub> | 0.60 s <sub>(0.65 s)</sub> | yes |  |
| gpt-6-astra | `gpt-6-astra` | yes | openai-primary/gpt-6-astra | 0.90 s <sub>(0.94 s)</sub> | 2.11 s <sub>(2.16 s)</sub> | yes |  |
|  | `openai-primary/gpt-6-astra` | yes | openai | 1.21 s <sub>(1.25 s)</sub> | 1.35 s <sub>(1.40 s)</sub> | yes |  |
|  | `openai-group/gpt-6-astra` | yes | openai-primary/gpt-6-astra | 1.26 s <sub>(1.38 s)</sub> | 1.73 s <sub>(1.77 s)</sub> | yes |  |
|  | `microsoft-foundry-quark/gpt-6-astra` | yes | microsoft-foundry | 1.58 s <sub>(1.63 s)</sub> | 1.64 s <sub>(1.69 s)</sub> | yes |  |
|  | `codex-group/gpt-6-astra` | yes | openai-primary/gpt-6-astra | 1.94 s <sub>(1.99 s)</sub> | 1.27 s <sub>(1.76 s)</sub> | yes |  |
| gpt-6-luna | `openai-group/gpt-6-luna` | yes | openai-primary/gpt-6-luna | 0.97 s <sub>(1.02 s)</sub> | 1.05 s <sub>(1.10 s)</sub> | yes |  |
|  | `openai-primary/gpt-6-luna` | yes | openai | 1.24 s <sub>(1.29 s)</sub> | 0.99 s <sub>(1.03 s)</sub> | yes |  |
|  | `gpt-6-luna` | yes | openai-primary/gpt-6-luna | 1.96 s <sub>(2.01 s)</sub> | 1.13 s <sub>(1.18 s)</sub> | yes |  |
| gpt-6-sol | `gpt-6-sol` | yes | openai-primary/gpt-6-sol | 0.69 s <sub>(0.74 s)</sub> | 0.73 s <sub>(0.78 s)</sub> | yes |  |
|  | `openai-group/gpt-6-sol` | yes | openai-primary/gpt-6-sol | 0.71 s <sub>(0.75 s)</sub> | 0.69 s <sub>(0.74 s)</sub> | yes |  |
|  | `openai-primary/gpt-6-sol` | yes | openai | 0.76 s <sub>(0.81 s)</sub> | 0.89 s <sub>(0.93 s)</sub> | yes |  |
| gpt-6.1-sol | `openai-group/gpt-6.1-sol` | yes | openai-primary/gpt-6.1-sol | 1.14 s <sub>(1.18 s)</sub> | 1.21 s <sub>(1.25 s)</sub> | yes |  |
|  | `openai-primary/gpt-6.1-sol` | yes | openai | 1.62 s <sub>(1.66 s)</sub> | 1.25 s <sub>(1.30 s)</sub> | yes |  |
|  | `gpt-6.1-sol` | yes | openai-primary/gpt-6.1-sol | 2.09 s <sub>(2.14 s)</sub> | 1.33 s <sub>(1.41 s)</sub> | yes |  |
| grok-4.3 | `xai/grok-4.3` | yes | xai | 1.93 s <sub>(2.04 s)</sub> | 1.84 s <sub>(1.89 s)</sub> | yes |  |
|  | `xai-primary/grok-4.3` | yes | xai | 2.09 s <sub>(2.13 s)</sub> | 2.96 s <sub>(3.01 s)</sub> | yes |  |
|  | `xai-group/grok-4.3` | yes | xai-primary/grok-4.3 | 2.28 s <sub>(2.33 s)</sub> | 1.98 s <sub>(2.02 s)</sub> | yes |  |
|  | `grok-4.3` | yes | xai-primary/grok-4.3 | 8.10 s <sub>(8.42 s)</sub> | 2.71 s <sub>(2.76 s)</sub> | yes |  |
| grok-4.3-latest | `xai-primary/grok-4.3-latest` | yes | xai | 1.84 s <sub>(1.88 s)</sub> | 2.51 s <sub>(2.55 s)</sub> | yes |  |
|  | `xai-group/grok-4.3-latest` | yes | xai-primary/grok-4.3-latest | 1.94 s <sub>(1.98 s)</sub> | 2.39 s <sub>(2.43 s)</sub> | yes |  |
|  | `grok-4.3-latest` | yes | xai-primary/grok-4.3-latest | 2.07 s <sub>(2.12 s)</sub> | 2.25 s <sub>(2.30 s)</sub> | yes |  |
|  | `xai/grok-4.3-latest` | yes | xai | 2.08 s <sub>(2.15 s)</sub> | 2.15 s <sub>(2.20 s)</sub> | yes |  |
| grok-4.5 | `xai-primary/grok-4.5` | yes | xai | 1.03 s <sub>(1.08 s)</sub> | 1.20 s <sub>(1.33 s)</sub> | yes |  |
|  | `grok-4.5` | yes | xai-primary/grok-4.5 | 1.18 s <sub>(1.23 s)</sub> | 0.84 s <sub>(0.89 s)</sub> | yes |  |
|  | `xai-group/grok-4.5` | yes | xai-primary/grok-4.5 | 1.22 s <sub>(1.29 s)</sub> | 1.28 s <sub>(1.39 s)</sub> | yes |  |
| grok-4.6 | `grok-4.6` | yes | xai-primary/grok-4.6 | 3.22 s <sub>(3.26 s)</sub> | 4.09 s <sub>(4.13 s)</sub> | yes |  |
|  | `xai-group/grok-4.6` | yes | xai-primary/grok-4.6 | 4.29 s <sub>(4.34 s)</sub> | 6.07 s <sub>(6.12 s)</sub> | yes |  |
|  | `xai-primary/grok-4.6` | yes | xai | 4.78 s <sub>(4.83 s)</sub> | 4.82 s <sub>(4.87 s)</sub> | yes |  |
| grok-4.7 | `xai-primary/grok-4.7` | yes | xai | 1.47 s <sub>(1.51 s)</sub> | 6.89 s <sub>(6.94 s)</sub> | yes |  |
|  | `xai-group/grok-4.7` | yes | xai-primary/grok-4.7 | 5.18 s <sub>(5.23 s)</sub> | 2.32 s <sub>(2.37 s)</sub> | yes |  |
|  | `grok-4.7` | yes | xai-primary/grok-4.7 | 13.9 s <sub>(14.1 s)</sub> | 2.92 s <sub>(2.97 s)</sub> | yes |  |
| grok-build-0.1 | `xai/grok-build-0.1` | yes | xai | 2.37 s <sub>(2.43 s)</sub> | 4.36 s <sub>(4.41 s)</sub> | yes |  |
|  | `xai-group/grok-build-0.1` | yes | xai-primary/grok-build-0.1 | 3.55 s <sub>(3.64 s)</sub> | 6.38 s <sub>(6.43 s)</sub> | yes |  |
|  | `xai-primary/grok-build-0.1` | yes | xai | 4.02 s <sub>(4.07 s)</sub> | 5.84 s <sub>(5.88 s)</sub> | yes |  |
|  | `grok-build-0.1` | yes | xai-primary/grok-build-0.1 | 8.13 s <sub>(8.22 s)</sub> | 3.86 s <sub>(3.94 s)</sub> | yes |  |
| grok-latest | `grok-latest` | yes | xai-primary/grok-latest | 1.24 s <sub>(1.28 s)</sub> | 3.71 s <sub>(3.76 s)</sub> | yes |  |
|  | `xai-group/grok-latest` | yes | xai-primary/grok-latest | 1.39 s <sub>(1.44 s)</sub> | 2.89 s <sub>(2.94 s)</sub> | yes |  |
|  | `xai-primary/grok-latest` | yes | xai | 1.60 s <sub>(2.17 s)</sub> | 6.02 s <sub>(6.10 s)</sub> | yes |  |
|  | `xai/grok-latest` | yes | xai | 3.72 s <sub>(3.77 s)</sub> | 3.29 s <sub>(3.39 s)</sub> | yes |  |
| qwen3-vl-235b | `bedrock-oss-group/qwen3-vl-235b` | yes | aws-bedrock/qwen.qwen3-vl-235b-a22b | 0.15 s <sub>(0.23 s)</sub> | 1.00 s <sub>(1.05 s)</sub> | yes |  |
|  | `qwen3-vl-235b` | yes | aws-bedrock/qwen.qwen3-vl-235b-a22b | 0.24 s <sub>(0.28 s)</sub> | 0.61 s <sub>(0.66 s)</sub> | yes |  |
|  | `aws-bedrock/qwen.qwen3-vl-235b-a22b` | yes | aws-bedrock | 0.26 s <sub>(0.31 s)</sub> | 2.48 s <sub>(2.53 s)</sub> | yes |  |

## 6. Parallel requests: HTTP/2 (Node fetch) vs HTTP/1.1 (node:https)

Tiny "pong" calls to `openai-group/gpt-5.4-mini` at 2026-10-15 09:39 UTC. *Overhead* = wall time at response headers minus the gateway's own server-timing total. Node's built-in fetch (undici 8) negotiates HTTP/2 with this gateway and sends every request over one connection, where they are served one after another; plain HTTP/1.1 with a keep-alive agent gives each request its own socket.

| Transport | In flight | calls | wall | throughput | gateway p50 | wall p50 | overhead p50 | overhead max | errors |
|---|---|---|---|---|---|---|---|---|---|
| fetch (HTTP/2) | 1 | 6 | 3.15 s | 1.91/s | 0.42 s | 0.50 s | 0.05 s | 0.29 s | 0 |
| https (HTTP/1.1) | 1 | 6 | 3.19 s | 1.88/s | 0.44 s | 0.53 s | 0.04 s | 0.22 s | 0 |
| fetch (HTTP/2) | 4 | 12 | 5.17 s | 2.32/s | 0.49 s | 1.62 s | 1.00 s | 1.76 s | 0 |
| https (HTTP/1.1) | 4 | 12 | 2.24 s | 5.35/s | 0.47 s | 0.54 s | 0.05 s | 0.16 s | 0 |
| fetch (HTTP/2) | 4 | 12 | 4.81 s | 2.5/s | 0.41 s | 1.31 s | 0.83 s | 1.66 s | 0 |
| https (HTTP/1.1) | 4 | 12 | 1.65 s | 7.25/s | 0.43 s | 0.49 s | 0.04 s | 0.15 s | 0 |

## 7. Wall-clock latency with one request in flight (clean pass)

Same tasks as section 3, run strictly one at a time (other users of the key could still add delay; overhead is shown). Times are wall (adjusted in brackets).

| Model route | short ns | short fast ns | big ns | big fast ns | overhead p50 | short ✓ | dominoes ✓ |
|---|---|---|---|---|---|---|---|
| `claude-group/claude-opus-5-5` | 2.80 s <sub>(2.75 s)</sub> | 2.58 s <sub>(2.53 s)</sub> minimal | 4.50 s <sub>(4.23 s)</sub> | 2.71 s <sub>(2.59 s)</sub> | 0.08 s | 6/6 | 6/6 |
| `claude-group/claude-sonnet-5-5` | 1.86 s <sub>(1.81 s)</sub> | 1.78 s <sub>(1.74 s)</sub> between_tools | 3.98 s <sub>(3.85 s)</sub> | 3.03 s <sub>(2.90 s)</sub> | 0.08 s | 6/6 | 6/6 |
| `claude-group/claude-haiku-5-5` | 1.53 s <sub>(1.49 s)</sub> | 1.45 s <sub>(1.29 s)</sub> disabled | 5.28 s <sub>(5.17 s)</sub> | 1.89 s <sub>(1.75 s)</sub> | 0.10 s | 6/6 | 4/6 |
| `claude-group/claude-fable-5-1` | 2.81 s <sub>(2.76 s)</sub> | 2.34 s <sub>(2.29 s)</sub> none | 4.58 s <sub>(4.44 s)</sub> | 5.80 s <sub>(5.30 s)</sub> | 0.07 s | 5/6 | 5/6 |
| `gemini-group/gemini-4-argon` | 3.27 s <sub>(3.23 s)</sub> | 2.58 s <sub>(2.54 s)</sub> none | 5.83 s <sub>(5.73 s)</sub> | 4.92 s <sub>(4.66 s)</sub> | 0.07 s | 6/6 | 6/6 |
| `gemini-group/gemini-3.8-flash` | 3.47 s <sub>(3.43 s)</sub> | 3.96 s <sub>(3.85 s)</sub> minimal | 54.9 s <sub>(54.5 s)</sub> | 13.5 s <sub>(13.3 s)</sub> | 0.12 s | 6/6 | 6/6 |
| `openai-group/gpt-6.1-sol` | 1.99 s <sub>(1.94 s)</sub> | 1.71 s <sub>(1.66 s)</sub> low | 10.1 s <sub>(9.98 s)</sub> | 7.22 s <sub>(7.09 s)</sub> | 0.07 s | 6/6 | 6/6 |
| `openai-group/gpt-5.4-mini` | 0.80 s <sub>(0.57 s)</sub> | 0.58 s <sub>(0.53 s)</sub> none | 1.24 s <sub>(1.12 s)</sub> | 1.50 s <sub>(1.24 s)</sub> | 0.09 s | 6/6 | 5/6 |
| `xai-group/grok-4.7` | 5.94 s <sub>(5.89 s)</sub> | 5.47 s <sub>(5.42 s)</sub> low | 177.6 s <sub>(177.4 s)</sub> | 60.1 s <sub>(60.0 s)</sub> | 0.09 s | 5/6 | 6/6 |
| `bedrock-oss-group/qwen3-vl-235b` | 1.30 s <sub>(1.26 s)</sub> | 1.23 s <sub>(1.15 s)</sub> none | 5.09 s <sub>(5.00 s)</sub> | 7.00 s <sub>(6.91 s)</sub> | 0.09 s | 6/6 | 6/6 |

## 8. Rate-limit headers seen

- **anthropic-primary** (e.g. `claude-group/claude-opus-5-5`): anthropic-ratelimit-input-tokens-limit=40000000, anthropic-ratelimit-input-tokens-remaining=39999000, anthropic-ratelimit-output-tokens-limit=8000000, anthropic-ratelimit-output-tokens-remaining=8000000, anthropic-ratelimit-requests-limit=20000, anthropic-ratelimit-requests-remaining=19998, anthropic-ratelimit-tokens-limit=48000000, anthropic-ratelimit-tokens-remaining=47999000
- **openai-primary** (e.g. `openai-group/gpt-6.1-sol`): x-ratelimit-limit-requests=15000, x-ratelimit-limit-tokens=40000000, x-ratelimit-remaining-requests=14996, x-ratelimit-remaining-tokens=39999855
- **xai-primary** (e.g. `xai-group/grok-4.7`): x-ratelimit-limit-requests=24000, x-ratelimit-limit-tokens=100000000, x-ratelimit-remaining-requests=24000, x-ratelimit-remaining-tokens=100000000
- **azure-foundry-quark** (e.g. `azure-foundry-quark/claude-haiku-4-5`): x-ratelimit-abusepenalty-active=False, x-ratelimit-key=claude-haiku-4-5, x-ratelimit-limit-requests=2000, x-ratelimit-limit-tokens=2000000, x-ratelimit-remaining-requests=1999, x-ratelimit-remaining-tokens=1999900, x-ratelimit-renewalperiod-requests=60, x-ratelimit-renewalperiod-tokens=60
- **anthropic-fast** (e.g. `claude-group/claude-opus-4-5`): anthropic-ratelimit-input-tokens-limit=10000000, anthropic-ratelimit-input-tokens-remaining=10000000, anthropic-ratelimit-output-tokens-limit=2000000, anthropic-ratelimit-output-tokens-remaining=2000000, anthropic-ratelimit-requests-limit=20000, anthropic-ratelimit-requests-remaining=19999, anthropic-ratelimit-tokens-limit=12000000, anthropic-ratelimit-tokens-remaining=12000000
- **codex-traffic** (e.g. `codex-group/gpt-5.3-codex`): x-ratelimit-limit-requests=15000, x-ratelimit-limit-tokens=40000000, x-ratelimit-remaining-requests=14998, x-ratelimit-remaining-tokens=39999994
- **microsoft-foundry-quark** (e.g. `microsoft-foundry-quark/claude-haiku-4-5`): x-ratelimit-abusepenalty-active=False, x-ratelimit-key=claude-haiku-4-5, x-ratelimit-limit-requests=2000, x-ratelimit-limit-tokens=2000000, x-ratelimit-remaining-requests=1999, x-ratelimit-remaining-tokens=1999900, x-ratelimit-renewalperiod-requests=60, x-ratelimit-renewalperiod-tokens=60
- **xai** (e.g. `xai/grok-4.3`): x-ratelimit-limit-requests=10000, x-ratelimit-limit-tokens=85000000, x-ratelimit-remaining-requests=10000, x-ratelimit-remaining-tokens=85000000
- No rate-limit headers from: `aws-bedrock/global.anthropic.claude-opus-5-5`, `aws-bedrock/us.anthropic.claude-opus-5-5`, `aws-bedrock/global.anthropic.claude-sonnet-5-5`, `aws-bedrock/global.anthropic.claude-haiku-4-5-20251001-v1-0`, `gemini-group/gemini-4-argon`, `gemini-primary/gemini-4-argon`, `gemini-group/gemini-3.1-pro`, `gemini-group/gemini-3.8-flash`, `gemini-primary/gemini-3.8-flash`, `gemini-group/gemini-3.5-flash-lite`, `bedrock-oss-group/qwen3-vl-235b`, `aws-bedrock/qwen.qwen3-vl-235b-a22b`

## 9. Errors (deep probe; every call, including expected "unsupported" 4xx)

| Model route | calls | ok | unsupported 4xx | 429 | 5xx | timeouts | network | stream errors | transport error rate |
|---|---|---|---|---|---|---|---|---|---|
| `claude-group/claude-opus-5-5` | 48 | 41 | 7 | 0 | 0 | 0 | 0 | 0 | 0.0% |
| `anthropic-primary/claude-opus-5-5` | 48 | 41 | 7 | 0 | 0 | 0 | 0 | 0 | 0.0% |
| `aws-bedrock/global.anthropic.claude-opus-5-5` | 48 | 39 | 9 | 0 | 0 | 0 | 0 | 0 | 0.0% |
| `aws-bedrock/us.anthropic.claude-opus-5-5` | 48 | 39 | 9 | 0 | 0 | 0 | 0 | 0 | 0.0% |
| `claude-opus-5-5` | 48 | 41 | 7 | 0 | 0 | 0 | 0 | 0 | 0.0% |
| `claude-group/claude-opus-5` | 48 | 46 | 2 | 0 | 0 | 0 | 0 | 0 | 0.0% |
| `claude-group/claude-opus-4-8` | 48 | 46 | 2 | 0 | 0 | 0 | 0 | 0 | 0.0% |
| `claude-group/claude-sonnet-5-5` | 48 | 42 | 6 | 0 | 0 | 0 | 0 | 0 | 0.0% |
| `anthropic-primary/claude-sonnet-5-5` | 48 | 42 | 6 | 0 | 0 | 0 | 0 | 0 | 0.0% |
| `aws-bedrock/global.anthropic.claude-sonnet-5-5` | 48 | 40 | 8 | 0 | 0 | 0 | 0 | 0 | 0.0% |
| `claude-group/claude-sonnet-5` | 48 | 46 | 2 | 0 | 0 | 0 | 0 | 0 | 0.0% |
| `claude-group/claude-sonnet-4-6` | 48 | 47 | 1 | 0 | 0 | 0 | 0 | 0 | 0.0% |
| `claude-group/claude-haiku-5-5` | 48 | 45 | 3 | 0 | 0 | 0 | 0 | 0 | 0.0% |
| `anthropic-primary/claude-haiku-5-5` | 48 | 45 | 3 | 0 | 0 | 0 | 0 | 0 | 0.0% |
| `claude-group/claude-haiku-4-5` | 48 | 45 | 3 | 0 | 0 | 0 | 0 | 0 | 0.0% |
| `aws-bedrock/global.anthropic.claude-haiku-4-5-20251001-v1-0` | 48 | 45 | 3 | 0 | 0 | 0 | 0 | 0 | 0.0% |
| `claude-group/claude-fable-5-1` | 48 | 41 | 7 | 0 | 0 | 0 | 0 | 0 | 0.0% |
| `anthropic-primary/claude-fable-5-1` | 48 | 41 | 7 | 0 | 0 | 0 | 0 | 0 | 0.0% |
| `claude-group/claude-fable-5` | 49 | 44 | 4 | 0 | 1 | 0 | 0 | 0 | 2.0% |
| `gemini-group/gemini-4-argon` | 49 | 44 | 1 | 0 | 3 | 0 | 1 | 0 | 8.2% |
| `gemini-primary/gemini-4-argon` | 48 | 47 | 1 | 0 | 0 | 0 | 0 | 0 | 0.0% |
| `gemini-group/gemini-3.1-pro` | 15 | 6 | 0 | 0 | 0 | 9 | 0 | 0 | 60.0% |
| `gemini-primary/gemini-3.1-pro-preview` | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 100.0% |
| `gemini-group/gemini-3.8-flash` | 48 | 46 | 2 | 0 | 0 | 0 | 0 | 0 | 0.0% |
| `gemini-primary/gemini-3.8-flash` | 48 | 46 | 2 | 0 | 0 | 0 | 0 | 0 | 0.0% |
| `gemini-group/gemini-3.5-flash-lite` | 48 | 47 | 1 | 0 | 0 | 0 | 0 | 0 | 0.0% |
| `openai-group/gpt-6.1-sol` | 48 | 40 | 8 | 0 | 0 | 0 | 0 | 0 | 0.0% |
| `openai-primary/gpt-6.1-sol` | 48 | 40 | 8 | 0 | 0 | 0 | 0 | 0 | 0.0% |
| `openai-group/gpt-6-sol` | 48 | 43 | 5 | 0 | 0 | 0 | 0 | 0 | 0.0% |
| `openai-group/gpt-6-astra` | 48 | 40 | 8 | 0 | 0 | 0 | 0 | 0 | 0.0% |
| `openai-group/gpt-6-luna` | 48 | 43 | 5 | 0 | 0 | 0 | 0 | 0 | 0.0% |
| `openai-group/gpt-5.5` | 48 | 46 | 2 | 0 | 0 | 0 | 0 | 0 | 0.0% |
| `openai-group/gpt-5.4-mini` | 48 | 47 | 1 | 0 | 0 | 0 | 0 | 0 | 0.0% |
| `xai-group/grok-4.7` | 48 | 47 | 0 | 0 | 0 | 1 | 0 | 0 | 2.1% |
| `xai-primary/grok-4.7` | 48 | 48 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0% |
| `bedrock-oss-group/qwen3-vl-235b` | 48 | 47 | 1 | 0 | 0 | 0 | 0 | 0 | 0.0% |
| `aws-bedrock/qwen.qwen3-vl-235b-a22b` | 48 | 47 | 1 | 0 | 0 | 0 | 0 | 0 | 0.0% |

Sweep: 281 routes, 769 calls, 728 ok, 6 transport errors, 37 routes unusable (4xx on the first call).

## Method

- Every request goes to `POST /v1/chat/completions` in the OpenAI shape; images are `image_url` data: URLs (JPEG; fixtures in `probe-assets/`, built by `probe-assets/make_assets.py`). The key is read from the environment and never logged or stored.
- A random tag ends every user message, so the gateway cannot serve a cached reply; the long system prompt stays identical, so provider prefix caches may apply on later trials (`usage.cached` in the JSON).
- 429/5xx/network failures on feature tests are retried once after a pause; both attempts count toward the error rate. A 4xx on a feature test means the route does not support that parameter.
- Output-cap test: a 600-word essay with a 40-token cap; honoured = completion tokens ≤ 44 and finish_reason = length. 32k/64k/128k = the route accepts that cap on a tiny reply.
- Re-run one route: `zsh -c 'source ~/.config/truefoundry/env && node ai/research/probe.mjs --phase full --models <id>'` (merges into the JSON). `--phase report` rewrites this file and keeps the notes block.
