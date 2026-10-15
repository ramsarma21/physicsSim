// The bench's model calls: one step (ai/steps.mjs, the app's own prompts and validators) with ONE route of a candidate config, through the
// HTTP/1.1 fetch (ai/research/fetch-h1.mjs: Node's fetch puts parallel calls on one HTTP/2 connection the gateway serves one by one), under a
// process-wide cap on calls in flight (at most 6). No fallbacks here: the bench measures each route by itself; a failure is a failure.
//   const r = await runConfig("plan", payload, CONFIGS.plan.find((c) => c.id === "opus-high"))
//   // {ok, result, model, servedModel, ms, usage, attempts, repaired, warnings} | {ok: false, error: {code, message}, ms, attempts, usage}
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { callModel } from "../../core.mjs"
import { runStep } from "../../steps.mjs"
import { fetchH1 } from "../../research/fetch-h1.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const AI = join(HERE, "..", "..")
export const BASE_ROUTING = JSON.parse(readFileSync(join(AI, "models.json"), "utf8"))

/** Route quirks for candidates that models.json does not list yet (vision, prompt caching, params the route rejects): measured in
 *  ai/research/gateway-probe.md. */
export const QUIRKS = {
	"claude-group/claude-opus-5-5": { family: "claude", vision: true, cache: true, drop: ["temperature", "top_p"] },
	"aws-bedrock/global.anthropic.claude-opus-5-5": { family: "claude", vision: true, cache: true, drop: ["temperature", "top_p"] },
	"microsoft-foundry-quark/claude-opus-5-5": { family: "claude", vision: true, cache: true, drop: ["temperature", "top_p"] },
	"claude-group/claude-fable-5-1": { family: "claude", vision: true, cache: true, drop: ["temperature", "top_p"] },
	"claude-group/claude-sonnet-5-5": { family: "claude", vision: true, cache: true, drop: ["temperature", "top_p"] },
	"claude-group/claude-haiku-5-5": { family: "claude", vision: true, cache: true, drop: ["temperature", "top_p"] },
	"gemini-group/gemini-4-argon": { family: "gemini", vision: true, cache: false },
	"gemini-primary/gemini-4-argon": { family: "gemini", vision: true, cache: false },
	"gemini-group/gemini-3.8-flash": { family: "gemini", vision: true, cache: false },
	"openai-group/gpt-6-astra": { family: "openai", vision: true, cache: false, drop: ["temperature", "top_p"] },
	"openai-group/gpt-6.1-sol": { family: "openai", vision: true, cache: false, drop: ["temperature", "top_p"] },
	"openai-group/gpt-5.4-mini": { family: "openai", vision: true, cache: false }
}

const OPUS = "claude-group/claude-opus-5-5"
const ARGON = "gemini-group/gemini-4-argon"
const ASTRA = "openai-group/gpt-6-astra"
const SOL = "openai-group/gpt-6.1-sol"
const SONNET = "claude-group/claude-sonnet-5-5"
const FABLE = "claude-group/claude-fable-5-1"
const FLASH = "gemini-group/gemini-3.8-flash"
const HAIKU = "claude-group/claude-haiku-5-5"
const cfg = (id, model, effort, max_tokens, extra = {}) => ({ id, model, params: { max_tokens, ...(effort ? { reasoning_effort: effort } : {}) }, ...extra })

/** The candidate configs per step: ai/research/candidates.json ∩ the routes that passed the gateway probes, plus reasoning-effort variants. */
export const CONFIGS = {
	plan: [
		cfg("opus-high", OPUS, "high", 32000),
		cfg("opus-medium", OPUS, "medium", 32000),
		cfg("opus-low", OPUS, "low", 32000),
		cfg("fable-high", FABLE, "high", 32000),
		cfg("astra-high", ASTRA, "high", 32000),
		cfg("argon-high", ARGON, "high", 32000),
		cfg("sonnet-high", SONNET, "high", 32000),
		cfg("sol-high", SOL, "high", 32000),
		// the same model and effort on Opus 5.5's other routes (fallback candidates)
		cfg("opus-medium-bedrock", "aws-bedrock/global.anthropic.claude-opus-5-5", "medium", 32000),
		cfg("opus-medium-foundry", "microsoft-foundry-quark/claude-opus-5-5", "medium", 32000),
		cfg("opus-xhigh", OPUS, "xhigh", 48000)
	],
	observe: [
		cfg("opus-medium", OPUS, "medium", 16000),
		cfg("opus-high", OPUS, "high", 16000),
		cfg("argon-low", ARGON, "low", 16000),
		cfg("argon-high", ARGON, "high", 16000),
		cfg("astra-medium", ASTRA, "medium", 16000),
		cfg("sol-medium", SOL, "medium", 16000),
		cfg("flash-low", FLASH, "low", 16000),
		cfg("opus-low", OPUS, "low", 16000)
	],
	refine: [
		cfg("opus-medium", OPUS, "medium", 16000),
		cfg("opus-low", OPUS, "low", 16000),
		cfg("opus-high", OPUS, "high", 16000),
		cfg("argon-low", ARGON, "low", 16000),
		cfg("astra-medium", ASTRA, "medium", 16000),
		cfg("sonnet-medium", SONNET, "medium", 16000),
		cfg("sol-medium", SOL, "medium", 16000),
		cfg("flash-low", FLASH, "low", 16000)
	],
	edit: [
		cfg("opus-low", OPUS, "low", 16000),
		cfg("opus-medium", OPUS, "medium", 16000),
		cfg("sonnet-low", SONNET, "low", 16000),
		cfg("sol-low", SOL, "low", 16000),
		cfg("flash-low", FLASH, "low", 16000),
		cfg("haiku-low", HAIKU, "low", 16000),
		cfg("opus-high", OPUS, "high", 16000)
	],
	judge: [cfg("opus-high", OPUS, "high", 16000), cfg("argon-high", ARGON, "high", 16000), cfg("astra-high", ASTRA, "high", 16000), cfg("opus-medium", OPUS, "medium", 16000)]
}
export const configOf = (step, id) => {
	const list = CONFIGS[step === "judge" ? "judge" : step] ?? []
	const c = list.find((x) => x.id === id)
	if (!c) throw new Error(`no config "${id}" for ${step} (one of ${list.map((x) => x.id).join(", ")})`)
	return c
}

/** A routing object (models.json shape) with only this config's route for the step: no fallbacks, generous timeouts, 2 retries on 5xx/429. */
export function routingFor(step, c, { timeoutMs, budgetMs } = {}) {
	const T = { plan: 330000, observe: 240000, refine: 240000, edit: 180000, judge: 300000 }
	return {
		version: 1,
		defaults: { ...BASE_ROUTING.defaults },
		models: { ...BASE_ROUTING.models, [c.model]: QUIRKS[c.model] ?? BASE_ROUTING.models?.[c.model] ?? { vision: true } },
		steps: {
			[step]: {
				model: c.model,
				fallbacks: [],
				params: c.params,
				timeoutMs: timeoutMs ?? T[step] ?? 240000,
				budgetMs: budgetMs ?? Math.max(600000, (T[step] ?? 240000) * 2),
				retries: 2,
				needsVision: step === "observe"
			}
		}
	}
}

// ---------------------------------------------------------------- the cap on calls in flight (process-wide)
export const MAX_IN_FLIGHT = 6
let limit = MAX_IN_FLIGHT
let active = 0
const waiters = []
export function setConcurrency(n) {
	limit = Math.max(1, Math.min(MAX_IN_FLIGHT, n | 0))
}
async function acquire() {
	if (active < limit) {
		active++
		return
	}
	await new Promise((r) => waiters.push(r))
	active++
}
function release() {
	active--
	const w = waiters.shift()
	if (w) w()
}
export const inFlight = () => ({ active, waiting: waiters.length, limit })

const plainError = (e) => ({ code: e?.code ?? "error", message: String(e?.message ?? e).slice(0, 600), status: e?.status ?? null, details: e?.details?.slice?.(0, 12) ?? undefined })

/** One app step (observe | plan | refine | edit) with one config. Never throws: failures come back as {ok: false}. */
export async function runConfig(step, payload, c, { signal, timeoutMs, budgetMs } = {}) {
	await acquire()
	const t0 = Date.now()
	try {
		const out = await runStep(step, payload, { routing: routingFor(step, c, { timeoutMs, budgetMs }), fetch: fetchH1, signal })
		return { ok: true, result: out.result, model: out.model, servedModel: out.servedModel, ms: out.ms, wallMs: Date.now() - t0, usage: out.usage, attempts: out.attempts, repaired: !!out.repaired, warnings: out.warnings, prompt: out.prompt }
	} catch (e) {
		return { ok: false, error: plainError(e), ms: e?.ms ?? Date.now() - t0, wallMs: Date.now() - t0, attempts: e?.attempts ?? [], usage: e?.usage ?? {} }
	} finally {
		release()
	}
}

/** A free-form call (the judge): system + user text + images, validated by `validate`, with one config's route. Never throws. */
export async function callConfig(step, c, { system, content, images = [], validate, signal, timeoutMs, budgetMs }) {
	await acquire()
	const t0 = Date.now()
	try {
		const out = await callModel(step, { system, content, images, validate, signal, routing: routingFor(step, c, { timeoutMs, budgetMs }), fetch: fetchH1 })
		return { ok: true, result: out.result, model: out.model, servedModel: out.servedModel, ms: out.ms, usage: out.usage, attempts: out.attempts, repaired: !!out.repaired }
	} catch (e) {
		return { ok: false, error: plainError(e), ms: e?.ms ?? Date.now() - t0, attempts: e?.attempts ?? [], usage: e?.usage ?? {} }
	} finally {
		release()
	}
}

/** One app step with a whole routing file (primary + fallbacks, as the app runs it): the pipeline command. Never throws. */
export async function runConfigWithRouting(step, payload, routing, { signal } = {}) {
	await acquire()
	const t0 = Date.now()
	try {
		const out = await runStep(step, payload, { routing, fetch: fetchH1, signal })
		return { ok: true, result: out.result, model: out.model, servedModel: out.servedModel, ms: out.ms, usage: out.usage, attempts: out.attempts, repaired: !!out.repaired }
	} catch (e) {
		return { ok: false, error: plainError(e), ms: e?.ms ?? Date.now() - t0, attempts: e?.attempts ?? [], usage: e?.usage ?? {} }
	} finally {
		release()
	}
}
