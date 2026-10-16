// callModel(step, {...}): one AI step through the TrueFoundry gateway (OpenAI-compatible /chat/completions), routed by ai/models.json.
//   - routing: the step's primary route, then its fallbacks (a route whose model cannot see is skipped when images are sent)
//   - retries with exponential backoff (and Retry-After) on 429 / 5xx / timeouts / network errors; a 400 naming a param the route rejects
//     (temperature, top_p, reasoning_effort, response_format...) drops that param and tries again at once
//   - per-attempt timeout (timeoutMs) inside a whole-call budget (budgetMs); abort with an AbortSignal at any time
//   - streaming (a step's `stream: true` in models.json): the answer comes as server-sent events, so an attempt that stops making progress
//     for idleTimeoutMs is dropped at once (a hung request no longer waits out the whole timeoutMs), while a long one that keeps thinking may
//     use all of it; o.onProgress({step, model, attempt, phase, tokens, ms}) hears how far it has got. A route that answers a stream
//     request with plain JSON is read as before.
//   - the answer's JSON is extracted (fences, prose around it) and validated (ai/schemas.mjs); ONE repair retry shows the model its
//     validation errors; after that, invalid output moves on to the next route while the budget lasts. "Soft" problems (a validator's
//     `soft` list: faithfulness checks) also get the one repair, but an answer that still has them is used, with them as warnings, and
//     a repair that breaks a usable answer falls back to it
//   - returns {result, model, servedModel, ms, usage, attempts, warnings}; throws AIError {code, message, retryable, status, attempts}
// The key comes from process.env.TRUEFOUNDRY_API_KEY and never appears in a result, an error or a log line.
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { VALIDATORS } from "./schemas.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
export const DEFAULT_BASE_URL = "https://tfy.promptlens.trilogy.com/v1"

/** HTTP status for each error code (web/server.py and api/ai/[step].mjs answer with it). */
export const STATUS = { bad_input: 400, too_large: 413, config: 500, aborted: 499, timeout: 504, budget: 504, gateway: 502, invalid_output: 502, busy: 429, internal: 500 }

export class AIError extends Error {
	constructor(code, message, { retryable = false, attempts = [], details } = {}) {
		super(message)
		this.name = "AIError"
		this.code = code
		this.status = STATUS[code] ?? 500
		this.retryable = retryable
		this.attempts = attempts
		if (details) this.details = details
	}
}

// ---------------------------------------------------------------- routing
let routingCache = null
/** ai/models.json (or AI_MODELS, a path), re-read when it changes on disk. */
export function loadRouting(path = process.env.AI_MODELS || join(HERE, "models.json")) {
	const text = readFileSync(path, "utf8")
	if (routingCache?.path === path && routingCache.text === text) return routingCache.routing
	const routing = JSON.parse(text)
	if (!routing?.steps || typeof routing.steps !== "object") throw new AIError("config", `${path} has no "steps"`)
	routingCache = { path, text, routing }
	return routing
}

/** The resolved route list for a step: [{model, params, quirks}], with the step's settings. */
export function routeFor(step, routing = loadRouting()) {
	const s = routing.steps?.[step]
	if (!s) throw new AIError("config", `no route for step "${step}" in models.json`)
	const d = routing.defaults ?? {}
	const seen = new Set()
	const routes = []
	for (const e of [s.model, ...(s.fallbacks ?? [])]) {
		const r = typeof e === "string" ? { model: e } : e
		if (!r?.model || seen.has(r.model)) continue
		seen.add(r.model)
		const quirks = routing.models?.[r.model] ?? {}
		// streaming only where the step asks for it AND the route is known to stream its thinking as it goes (models.json quirk stream: true;
		// a route that buffers the whole answer, as Bedrock does, would look idle for minutes)
		routes.push({ model: r.model, params: { ...(s.params ?? {}), ...(r.params ?? {}) }, quirks, stream: !!(r.stream ?? s.stream ?? d.stream ?? false) && quirks.stream === true })
	}
	return {
		routes,
		retries: s.retries ?? d.retries ?? 2,
		timeoutMs: s.timeoutMs ?? d.timeoutMs ?? 120000,
		idleTimeoutMs: s.idleTimeoutMs ?? d.idleTimeoutMs ?? 90000,
		budgetMs: s.budgetMs ?? d.budgetMs ?? 300000,
		backoffMs: s.backoffMs ?? d.backoffMs ?? 1500,
		maxBackoffMs: s.maxBackoffMs ?? d.maxBackoffMs ?? 20000,
		minAttemptMs: s.minAttemptMs ?? d.minAttemptMs ?? 8000,
		needsVision: !!s.needsVision
	}
}

// ---------------------------------------------------------------- JSON out of a model's answer
/** The text of a chat completion message (a string, or content parts). */
export function messageText(msg) {
	const c = msg?.content
	if (typeof c === "string") return c
	if (Array.isArray(c)) return c.map((p) => (typeof p === "string" ? p : p?.type === "text" || p?.text ? p.text ?? "" : "")).join("")
	return ""
}

/** Balanced {...} spans of a text, string-aware, in order of appearance. */
function objectSpans(t) {
	const spans = []
	for (let i = t.indexOf("{"); i !== -1 && spans.length < 20; i = t.indexOf("{", i + 1)) {
		let depth = 0
		let inStr = false
		let esc = false
		for (let j = i; j < t.length; j++) {
			const ch = t[j]
			if (inStr) {
				if (esc) esc = false
				else if (ch === "\\") esc = true
				else if (ch === '"') inStr = false
				continue
			}
			if (ch === '"') inStr = true
			else if (ch === "{") depth++
			else if (ch === "}" && --depth === 0) {
				spans.push(t.slice(i, j + 1))
				i = j // the next candidate starts after this object
				break
			}
		}
	}
	return spans
}
const dropTrailingCommas = (s) => s.replace(/,(\s*[}\]])/g, "$1")

/** The JSON object in a model's answer: the whole text, a fenced block, or the largest balanced {...}; throws with a reason. */
export function extractJson(text) {
	const t = String(text ?? "").trim()
	if (!t) throw new Error("the answer was empty")
	const tries = [t]
	for (const m of t.matchAll(/```(?:json|JSON)?\s*\n?([\s\S]*?)```/g)) tries.push(m[1].trim())
	tries.push(...objectSpans(t).sort((a, b) => b.length - a.length))
	for (const s of tries) {
		for (const cand of [s, dropTrailingCommas(s)]) {
			try {
				const v = JSON.parse(cand)
				if (v && typeof v === "object" && !Array.isArray(v)) return v
			} catch {}
		}
	}
	throw new Error(t.includes("{") ? "the answer's JSON does not parse (check commas, quotes and brackets)" : "the answer holds no JSON object")
}

// ---------------------------------------------------------------- small helpers
const sleep = (ms, signal) =>
	new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(signal.reason)
		const t = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort)
			resolve()
		}, ms)
		const onAbort = () => {
			clearTimeout(t)
			reject(signal.reason)
		}
		signal?.addEventListener("abort", onAbort, { once: true })
	})

function sumUsage(total, u) {
	if (!u || typeof u !== "object") return total
	for (const [k, v] of Object.entries(u)) {
		if (typeof v === "number" && Number.isFinite(v)) total[k] = (total[k] ?? 0) + v
		else if (v && typeof v === "object" && !Array.isArray(v)) total[k] = sumUsage(total[k] ?? {}, v)
	}
	return total
}

/** A gateway error body as one short line, with the key (if it ever appears) and any email address removed (a gateway 403 names the
 *  gateway account's address: "User <email> is not authorized to access model …", which must not reach a visitor of the hosted site). */
function redact(s, key) {
	let t = String(s ?? "")
	if (key && key.length >= 8) t = t.split(key).join("[redacted]")
	t = t.replace(/Bearer\s+[A-Za-z0-9._\-]{12,}/g, "Bearer [redacted]")
	return dropEmails(t)
}
/** Every email address (local@domain.tld) as "[account]". Linear: it starts from each "@" (a regex with a leading [\w.+-]+ retries from
 *  every character of a long run, which a whole answer with a picture in it, megabytes of base64, would make quadratic). */
function dropEmails(t) {
	if (!t.includes("@")) return t
	const re = /@[\w-]+(?:\.[\w-]+)+/g
	let out = ""
	let last = 0
	let m
	while ((m = re.exec(t))) {
		let i = m.index
		while (i > last && /[\w.+-]/.test(t[i - 1])) i--
		if (i === m.index) continue // no name before the "@"
		out += t.slice(last, i) + "[account]"
		last = m.index + m[0].length
	}
	return out + t.slice(last)
}
function errorLine(body, key) {
	let msg = body
	try {
		const j = JSON.parse(body)
		msg = j?.error?.message ?? j?.message ?? body
	} catch {
		msg = String(body).replace(/<[^>]+>/g, " ")
	}
	return redact(String(msg).replace(/\s+/g, " ").trim(), key).slice(0, 300)
}

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 520, 522, 524, 529])
const PARAM_NAMES = ["temperature", "top_p", "top_k", "reasoning_effort", "response_format", "max_completion_tokens", "presence_penalty", "frequency_penalty", "seed", "thinking", "output_config"]
/** A 400 that names a param the route does not take: that param's name, else null. */
function rejectedParam(status, msg, params) {
	if (status !== 400 && status !== 422) return null
	const m = msg.toLowerCase()
	if (!/(unsupported|not supported|deprecated|unknown|unrecognized|not allowed|invalid|extra inputs|does not support)/.test(m)) return null
	return PARAM_NAMES.find((p) => p in params && m.includes(p.replace(/_/g, "_"))) ?? PARAM_NAMES.find((p) => p in params && m.includes(p.replace(/_/g, " "))) ?? null
}
function retryAfterMs(h) {
	if (!h) return null
	const s = Number(h)
	if (Number.isFinite(s)) return Math.max(0, s * 1000)
	const d = Date.parse(h)
	return Number.isFinite(d) ? Math.max(0, d - Date.now()) : null
}

/** Messages for a call: given messages as they are, or a system prompt + one user turn (text and images). */
export function buildMessages({ messages, system, content, images }) {
	if (Array.isArray(messages) && messages.length) return messages
	const parts = []
	if (Array.isArray(content)) parts.push(...content)
	else if (content != null) parts.push({ type: "text", text: String(content) })
	for (const img of images ?? []) {
		const url = typeof img === "string" ? img : img?.url ?? img?.data
		if (url) parts.push({ type: "image_url", image_url: { url } })
	}
	const out = []
	if (system) out.push({ role: "system", content: system })
	out.push({ role: "user", content: parts.length === 1 && parts[0].type === "text" ? parts[0].text : parts })
	return out
}
const hasImages = (messages) => messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p?.type === "image_url"))

/**
 * Messages as one route takes them: the system prompt marked cacheable for routes that cache (Anthropic prompt caching), for an hour where
 * the route's quirks say cacheTtl "1h" (measured through the gateway 2026-10-15: a 1-hour entry was still read after 7 minutes, a 5-minute
 * one was written again; a cold 44k-token plan prompt costs about 1-2 s more to the first token and a cache write).
 */
function forRoute(messages, quirks, ttl = quirks.cacheTtl) {
	if (!quirks.cache) return messages
	const cc = typeof ttl === "string" && ttl ? { type: "ephemeral", ttl } : { type: "ephemeral" }
	return messages.map((m, i) => (m.role === "system" && typeof m.content === "string" && i === 0 ? { ...m, content: [{ type: "text", text: m.content, cache_control: cc }] } : m))
}

// ---------------------------------------------------------------- one HTTP attempt
/**
 * One request. With stream, the body asks for server-sent events and the answer is read as it comes: every chunk resets the idle timer
 * (idleTimeoutMs without a byte drops the attempt as a timeout) and onProgress hears the thinking and writing as they grow. The overall
 * timeoutMs still caps the attempt.
 */
async function attemptOnce({ fetchImpl, baseUrl, key, model, messages, params, timeoutMs, signal, stream = false, idleTimeoutMs = 0, onProgress }) {
	const timeout = new AbortController()
	const timer = setTimeout(() => timeout.abort(new Error("timeout")), timeoutMs)
	let idleTimer = null
	let idled = false
	const idle = new AbortController()
	const poke = () => {
		if (!stream || !(idleTimeoutMs > 0)) return
		clearTimeout(idleTimer)
		idleTimer = setTimeout(() => {
			idled = true
			idle.abort(new Error("idle"))
		}, idleTimeoutMs)
	}
	const both = AbortSignal.any([timeout.signal, idle.signal, ...(signal ? [signal] : [])])
	const t0 = Date.now()
	try {
		poke() // waiting for the first byte counts too
		const body = stream ? { model, messages, ...params, stream: true, stream_options: { include_usage: true } } : { model, messages, ...params }
		const r = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
			method: "POST",
			headers: { "content-type": "application/json", authorization: `Bearer ${key}`, ...(stream ? { accept: "text/event-stream" } : {}) },
			body: JSON.stringify(body),
			signal: both
		})
		poke()
		if (stream && r.ok && /text\/event-stream/i.test(r.headers.get("content-type") ?? "")) return await readEvents(r, { t0, poke, onProgress })
		const text = await r.text()
		const ms = Date.now() - t0
		if (!r.ok) return { ok: false, status: r.status, ms, body: text, retryAfter: retryAfterMs(r.headers.get("retry-after")) }
		let j
		try {
			j = JSON.parse(text)
		} catch {
			return { ok: false, status: 502, ms, body: "the gateway answered with something that is not JSON", retryable: true }
		}
		const choice = j?.choices?.[0]
		return { ok: true, status: r.status, ms, text: messageText(choice?.message), finish: choice?.finish_reason ?? null, usage: j?.usage ?? null, servedModel: j?.model ?? null }
	} catch (e) {
		const ms = Date.now() - t0
		if (signal?.aborted) return { aborted: true, ms }
		if (idled) return { ok: false, timeout: true, idle: true, status: 504, ms, body: `no progress for ${Math.round(idleTimeoutMs / 1000)} s`, retryable: true }
		if (timeout.signal.aborted) return { ok: false, timeout: true, status: 504, ms, body: `no answer within ${Math.round(timeoutMs / 1000)} s`, retryable: true }
		return { ok: false, status: 0, ms, body: `network error: ${e?.cause?.code ?? e?.code ?? e?.message ?? e}`, retryable: true }
	} finally {
		clearTimeout(timer)
		clearTimeout(idleTimer)
	}
}

/** An OpenAI-style event stream (data: {choices: [{delta: {content, reasoning_content}}], usage?} ... data: [DONE]) as one answer. */
async function readEvents(r, { t0, poke, onProgress }) {
	const dec = new TextDecoder()
	let buf = ""
	let text = ""
	let thought = 0 // characters of thinking seen
	let finish = null
	let usage = null
	let servedModel = null
	let lastNote = 0
	const note = (phase) => {
		const now = Date.now()
		if (!onProgress || now - lastNote < 1000) return
		lastNote = now
		try {
			onProgress({ phase, tokens: Math.round((thought + text.length) / 4), ms: now - t0 })
		} catch {}
	}
	const take = (line) => {
		if (!line.startsWith("data:")) return null
		const d = line.slice(5).trim()
		if (!d || d === "[DONE]") return null
		let j
		try {
			j = JSON.parse(d)
		} catch {
			return null
		}
		if (j?.error) return { error: j.error?.message ?? String(j.error) }
		if (j?.model) servedModel = j.model
		if (j?.usage) usage = j.usage
		const c = j?.choices?.[0]
		if (c?.finish_reason) finish = c.finish_reason
		const delta = c?.delta ?? {}
		if (typeof delta.content === "string") text += delta.content
		else if (Array.isArray(delta.content)) text += messageText({ content: delta.content })
		for (const k of ["reasoning_content", "reasoning", "thinking"]) if (typeof delta[k] === "string") thought += delta[k].length
		note(text ? "writing" : "thinking")
		return null
	}
	for await (const chunk of r.body) {
		poke()
		buf += dec.decode(chunk, { stream: true })
		let i
		while ((i = buf.indexOf("\n")) >= 0) {
			const line = buf.slice(0, i).trim()
			buf = buf.slice(i + 1)
			const bad = take(line)
			if (bad) return { ok: false, status: 502, ms: Date.now() - t0, body: bad.error, retryable: true }
		}
	}
	const bad = take(buf.trim())
	if (bad) return { ok: false, status: 502, ms: Date.now() - t0, body: bad.error, retryable: true }
	if (!text && finish === null) return { ok: false, status: 502, ms: Date.now() - t0, body: "the stream ended without an answer", retryable: true }
	return { ok: true, status: r.status, ms: Date.now() - t0, text, finish, usage, servedModel, streamed: true }
}

// ---------------------------------------------------------------- callModel
/**
 * Run one step's model call.
 * @param {string} step  observe | plan | refine | edit (any key of models.json steps)
 * @param {object} o
 *   messages | {system, content, images}   what to send (images: data URLs)
 *   validate(value) -> {ok, errors, warnings, value}   default: ai/schemas.mjs VALIDATORS[step] with o.validateCtx
 *   signal, routing (an object like models.json), params (merged over the route's), env, fetch, log(line), backoffScale (tests),
 *   budgetMs (a cap on the step's own budget: a host's time limit), onProgress
 */
export async function callModel(step, o = {}) {
	const env = o.env ?? process.env
	const key = env.TRUEFOUNDRY_API_KEY
	const baseUrl = gatewayUrl(env)
	if (!key) throw new AIError("config", "the AI key is not set on the server (TRUEFOUNDRY_API_KEY)")
	const fetchImpl = o.fetch ?? globalThis.fetch
	const log = o.log ?? (env.AI_DEBUG ? (l) => process.stderr.write(`[ai] ${redact(l, key)}\n`) : () => {})
	const R = routeFor(step, o.routing ?? loadRouting())
	// a host with a hard time limit (Vercel's maxDuration) caps the whole call: the step's budget never outlasts the request
	if (Number.isFinite(o.budgetMs) && o.budgetMs > 0) R.budgetMs = Math.min(R.budgetMs, o.budgetMs)
	const validator = o.validate ?? ((v) => (VALIDATORS[step] ? VALIDATORS[step](v, o.validateCtx ?? {}) : { ok: true, errors: [], warnings: [], value: v }))
	const messages = buildMessages(o)
	const vision = hasImages(messages)
	let routes = R.routes
	if (vision) routes = routes.filter((r) => r.quirks.vision !== false)
	if (!routes.length) throw new AIError("config", `no route for step "${step}" can take images`)
	const start = Date.now()
	const deadline = start + R.budgetMs
	const attempts = []
	const usage = {}
	const scale = o.backoffScale ?? 1
	let repairsLeft = o.repairs ?? 1
	let last = null
	const abortedError = () => new AIError("aborted", "cancelled", { attempts })
	let tries = 0
	const progress = (route, attemptNo, repair) =>
		o.onProgress
			? (p) => {
					try {
						o.onProgress({ step, model: route.model, attempt: attemptNo, repair: !!repair, ...p })
					} catch {}
				}
			: undefined
	const send = (route, convo, params, timeoutMs, repair = false) =>
		attemptOnce({ fetchImpl, baseUrl, key, model: route.model, messages: convo, params, timeoutMs, signal: o.signal, stream: route.stream, idleTimeoutMs: R.idleTimeoutMs, onProgress: progress(route, ++tries, repair) })

	for (const route of routes) {
		const params = { ...route.params, ...(o.params ?? {}) }
		for (const p of route.quirks.drop ?? []) delete params[p]
		let convo = forRoute(messages, route.quirks)
		let strips = 0
		for (let attempt = 0; attempt <= R.retries; attempt++) {
			if (o.signal?.aborted) throw abortedError()
			const remaining = deadline - Date.now()
			if (remaining < Math.min(R.minAttemptMs, R.timeoutMs)) {
				last ??= new AIError("budget", `ran out of time (${Math.round(R.budgetMs / 1000)} s budget)`, { retryable: true })
				break
			}
			const res = await send(route, convo, params, Math.min(R.timeoutMs, remaining))
			if (res.aborted) {
				attempts.push({ model: route.model, ok: false, ms: res.ms, error: "cancelled" })
				throw abortedError()
			}
			if (res.ok) sumUsage(usage, res.usage)
			if (!res.ok) {
				const msg = res.timeout ? res.body : errorLine(res.body, key)
				const bad = rejectedParam(res.status, msg, params)
				attempts.push({ model: route.model, ok: false, status: res.status, ms: res.ms, error: msg })
				log(`${step} ${route.model} attempt ${attempt + 1}: ${res.status} ${msg}`)
				if (bad && strips < 4) {
					delete params[bad]
					strips++
					attempt-- // not a real failure: the same route again without that param
					continue
				}
				if (route.quirks.cacheTtl && !route.noTtl && (res.status === 400 || res.status === 422) && /\bttl\b|cache_control/i.test(msg) && strips < 4) {
					route.noTtl = true // this route does not take a cache lifetime: the same route again with the default one
					convo = forRoute(messages, route.quirks, null)
					strips++
					attempt--
					continue
				}
				if (route.stream && (res.status === 400 || res.status === 422) && /stream/i.test(msg) && strips < 4) {
					route.stream = false // this route does not take a streaming request: the same route again, plainly
					strips++
					attempt--
					continue
				}
				const retryable = res.retryable || res.timeout || RETRYABLE_STATUS.has(res.status) || res.status === 0
				last = new AIError(res.timeout ? "timeout" : "gateway", `${route.model}: ${msg}`, { retryable: true })
				if (!retryable) break // a 4xx this route will keep giving: next route
				if (attempt < R.retries) {
					const backoff = Math.min(R.maxBackoffMs, R.backoffMs * 2 ** attempt) * (0.75 + Math.random() * 0.5) * scale
					const wait = Math.min(Math.max(backoff, (res.retryAfter ?? 0) * scale), Math.min(R.maxBackoffMs, 20000) * Math.max(scale, 0.0001), Math.max(0, deadline - Date.now() - R.minAttemptMs))
					try {
						await sleep(wait, o.signal)
					} catch {
						throw abortedError()
					}
				}
				continue
			}
			// an answer: is it what the step needs?
			if (res.finish === "length") {
				const whole = parseAndCheck(res.text, validator) // thinking counts against max_tokens: the JSON may still be complete
				if (whole.ok) {
					attempts.push({ model: route.model, ok: true, status: res.status, ms: res.ms, note: "finished at max_tokens" })
					return done(whole, route.model, res.servedModel, false)
				}
				attempts.push({ model: route.model, ok: false, status: res.status, ms: res.ms, error: "the answer was cut off (max_tokens)" })
				params.max_tokens = Math.min(64000, Math.round((params.max_tokens ?? 8000) * 2))
				last = new AIError("invalid_output", `${route.model}: the answer was cut off at max_tokens`, { retryable: true })
				continue
			}
			let checked = parseAndCheck(res.text, validator)
			const rec = { model: route.model, ok: checked.ok, status: res.status, ms: res.ms }
			attempts.push(rec)
			// a usable answer with only soft problems gets the repair when there is time for a whole extra answer, and is kept otherwise
			const softOnly = checked.ok && checked.soft.length > 0
			const left = deadline - Date.now()
			if ((!checked.ok || softOnly) && repairsLeft > 0 && left > (softOnly ? Math.min(R.timeoutMs, SOFT_REPAIR_MIN_MS) : Math.min(R.minAttemptMs, R.timeoutMs))) {
				repairsLeft--
				const shown = checked.ok ? checked.soft : [...checked.errors, ...checked.soft]
				rec.error = `${checked.ok ? "to improve" : "invalid"}: ${shown.slice(0, 3).join("; ")}`
				log(`${step} ${route.model}: ${checked.errors.length} validation error(s), ${checked.soft.length} soft; repairing`)
				const repairConvo = [...convo, { role: "assistant", content: res.text || "(empty)" }, { role: "user", content: repairPrompt(shown) }]
				const first = checked
				const rep = await send(route, repairConvo, params, Math.min(R.timeoutMs, deadline - Date.now()), true)
				if (rep.aborted) throw abortedError()
				if (rep.ok) {
					sumUsage(usage, rep.usage)
					checked = parseAndCheck(rep.text, validator)
					const still = checked.ok && checked.soft.length ? { note: `still: ${checked.soft.slice(0, 2).join("; ")}` } : {}
					attempts.push({ model: route.model, ok: checked.ok, status: rep.status, ms: rep.ms, repair: true, ...(checked.ok ? still : { error: `invalid after repair: ${checked.errors.slice(0, 3).join("; ")}` }) })
					if (checked.ok) return done(checked, route.model, rep.servedModel, true)
				} else attempts.push({ model: route.model, ok: false, status: rep.status, ms: rep.ms, repair: true, error: rep.timeout ? rep.body : errorLine(rep.body, key) })
				if (first.ok) {
					// the repair broke (or lost) an answer that was usable: the first one stands
					rec.note = "kept: the repair did not give a usable answer"
					return done(first, route.model, res.servedModel, false)
				}
			}
			if (checked.ok) return done(checked, route.model, res.servedModel, false)
			if (!rec.error) rec.error = `invalid: ${checked.errors.slice(0, 3).join("; ")}`
			last = new AIError("invalid_output", `the model's answer was not usable: ${checked.errors.slice(0, 6).join("; ")}`, { retryable: true, details: checked.errors.slice(0, 40) })
			break // invalid output: the next route (if the budget allows)
		}
		if (last?.code === "budget") break
	}
	const err = last ?? new AIError("gateway", "no route answered")
	err.attempts = attempts
	err.ms = Date.now() - start
	err.usage = usage
	throw err

	function done(checked, model, servedModel, repaired) {
		const warnings = [...(checked.warnings ?? []), ...(checked.soft ?? []).map((e) => `not fixed: ${e}`)]
		return { result: checked.value, model, servedModel, ms: Date.now() - start, usage, attempts, warnings, repaired }
	}
}
/** A soft repair (an answer that is usable already) is tried only with this much of the budget left. */
const SOFT_REPAIR_MIN_MS = 60000

function parseAndCheck(text, validator) {
	let v
	try {
		v = extractJson(text)
	} catch (e) {
		return { ok: false, errors: [`${e.message}: answer with one JSON object only`], soft: [], warnings: [] }
	}
	try {
		const r = validator(v)
		return { ok: !!r.ok, errors: r.errors ?? [], soft: Array.isArray(r.soft) ? r.soft : [], warnings: r.warnings ?? [], value: r.value ?? v }
	} catch (e) {
		return { ok: false, errors: [`could not check the answer: ${e.message}`], soft: [], warnings: [] }
	}
}

export function repairPrompt(errors) {
	const list = errors.slice(0, 40).map((e) => `- ${e}`).join("\n")
	const more = errors.length > 40 ? `\n- ...and ${errors.length - 40} more of the same kinds` : ""
	return `Your JSON answer does not pass the checks:\n${list}${more}\n\nReturn the complete corrected JSON object (the whole answer, not just the changed parts): fix exactly these problems and keep everything else as it was. Use only catalog types and the props listed for each type, inside their ranges. Keep writing in the language of the request. JSON only: no prose, no code fences.`
}

/** The gateway base URL. AI_GATEWAY_URL (tests) may only point at this machine, so the key can never be sent elsewhere by it. */
export function gatewayUrl(env = process.env) {
	const o = env.AI_GATEWAY_URL
	if (o) {
		let u
		try {
			u = new URL(o)
		} catch {
			throw new AIError("config", "AI_GATEWAY_URL is not a URL")
		}
		if (!["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)) throw new AIError("config", "AI_GATEWAY_URL may only point at this machine (tests)")
		return o
	}
	return env.TRUEFOUNDRY_BASE_URL || DEFAULT_BASE_URL
}

/** Any text with the key removed (for error strings that leave the process). */
export function scrub(text, env = process.env) {
	return redact(text, env.TRUEFOUNDRY_API_KEY)
}
