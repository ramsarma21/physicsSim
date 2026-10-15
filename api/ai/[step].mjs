// Vercel serverless twin of web/server.py's POST /api/ai/<step> (observe | plan | refine | edit). Not deployed by this file: docs/DEPLOY.md.
// Same request and answer as the local server: body {payload, client?: {requestId}} -> {ok: true, result, model, ms, usage, ...} or
// {ok: false, error, code, retryable} with the status the error names. The key comes from the project's environment variables
// (TRUEFOUNDRY_API_KEY, TRUEFOUNDRY_BASE_URL) and never leaves the function. Contract: ai/DESIGN.md §13 "The hosted endpoint".
//
// Who may call it (checked before a body is read; on Vercel every check fails closed):
//   - Origin: a browser call must come from ALLOWED_ORIGINS (comma-separated) or from this deployment's own URLs (VERCEL_URL,
//     VERCEL_BRANCH_URL, VERCEL_PROJECT_PRODUCTION_URL), and Sec-Fetch-Site, when sent, must be same-origin. On Vercel a call with no Origin
//     is refused too (403). Off Vercel (tests, a local `vercel dev`) an Origin is only checked against ALLOWED_ORIGINS when that is set.
//   - Access (401 without it): an `ai_session` cookie (HttpOnly, signed with AI_SESSION_SECRET; GET /api/ai/session?invite=<one of
//     AI_INVITE_CODES> sets it and goes back to the app: the production design, nothing secret in the page), or, on a preview only
//     (VERCEL_ENV != "production"), the header `x-ai-access: <AI_ACCESS_TOKEN>` (the protected preview's simple token, which the static
//     build may put in the page). On Vercel with neither configured every AI call is refused (503 "not configured"); off Vercel the check
//     applies when AI_ACCESS_TOKEN or AI_SESSION_SECRET is set.
//   - Shape: POST only (405), one of the four steps (404), Content-Type application/json (415), at most 12 MB (413; Vercel itself stops
//     bodies over 4.5 MB), a JSON object {payload: {...}} (400). The payload goes through the same checks as the local server's
//     (ai/steps.mjs: web/sim clean() for scenes, pictures as data URLs, size caps).
// Time: a step's budget is capped at maxDuration − 20 s (and what it waited for a slot), so it ends with its own answer, never Vercel's
// 504. With `Accept: application/x-ndjson` the answer streams: progress lines while the model thinks and writes, a heartbeat every 10 s
// when nothing else is sent (so no proxy drops a silent long plan), and the answer as the last line with its HTTP status in `status`.
// Concurrency: one instance runs at most AI_SLOTS steps at once (and the local server's per-step caps); the others wait first come, first
// served for up to AI_QUEUE_WAIT s, then get 429 busy {busy: true, position, retryAfterMs} with Retry-After (a whole-site limit is the
// Vercel Firewall's rate-limit rule, docs/DEPLOY.md).
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { AIError, scrub } from "../../ai/core.mjs"
import { runStep, STEPS } from "../../ai/steps.mjs"
import { aiGate } from "../_lib/ai-gate.mjs" // who may run a step and how much: a signed-in person's allowance (docs/ACCOUNTS.md §6)

export const config = { maxDuration: 300 } // Hobby's most with Fluid compute (vercel.json says the same); Pro allows up to 800
const MAX_DURATION_S = 300
const MARGIN_MS = 20000 // the step ends this long before Vercel would stop it
const MAX_BODY = 12 << 20
const ON_VERCEL = () => !!process.env.VERCEL
const SLOTS = () => Math.max(1, Number(process.env.AI_SLOTS) || 12)
const STEP_SLOTS = { observe: 4, plan: 6, refine: 8, edit: 8 }
const QUEUE_WAIT_MS = () => Math.max(0, Number(process.env.AI_QUEUE_WAIT) || 30) * 1000
const QUEUE_MAX = () => Math.max(1, Number(process.env.AI_QUEUE_MAX) || 24)
const TYPICAL_S = { observe: 30, plan: 30, refine: 15, edit: 6 }
const SESSION_COOKIE = "ai_session"
const RID_RE = /^[\w.:-]{1,80}$/

// ---------------------------------------------------------------- answers
function send(res, status, obj, headers = {}) {
	const text = scrub(JSON.stringify(obj))
	res.statusCode = status
	res.setHeader("Content-Type", "application/json")
	res.setHeader("Cache-Control", "no-store")
	for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
	res.end(text)
}
const fail = (res, status, code, error, extra = {}, headers = {}) => send(res, status, { ok: false, error, code, retryable: false, ...extra }, headers)

// ---------------------------------------------------------------- who may call
const header = (req, k) => {
	const v = req.headers?.[k]
	return Array.isArray(v) ? v[0] : typeof v === "string" ? v : undefined
}
/** The origins allowed to call: ALLOWED_ORIGINS plus, on Vercel, this deployment's own URLs. */
export function allowedOrigins(env = process.env) {
	const list = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim().replace(/\/+$/, "").toLowerCase()).filter(Boolean)
	for (const k of ["VERCEL_URL", "VERCEL_BRANCH_URL", "VERCEL_PROJECT_PRODUCTION_URL"]) if (env[k]) list.push(`https://${String(env[k]).replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase()}`)
	return [...new Set(list)]
}
/** Why this caller's origin is refused (403), or null. */
export function originProblem(req, env = process.env) {
	const origin = (header(req, "origin") ?? "").trim().replace(/\/+$/, "").toLowerCase()
	const site = (header(req, "sec-fetch-site") ?? "").toLowerCase()
	const allowed = allowedOrigins(env)
	const vercel = !!env.VERCEL
	if (site && site !== "same-origin" && site !== "none" && vercel) return "only this app's own page may use the AI steps"
	if (!origin) return vercel ? "only this app's own page may use the AI steps (no Origin)" : null
	if (vercel || (env.ALLOWED_ORIGINS ?? "").trim()) return allowed.includes(origin) ? null : "this origin may not use the AI steps"
	return null
}

const b64u = (b) => Buffer.from(b).toString("base64url")
const sign = (data, secret) => createHmac("sha256", secret).update(data).digest("base64url")
const same = (a, b) => {
	const x = Buffer.from(String(a))
	const y = Buffer.from(String(b))
	return x.length === y.length && timingSafeEqual(x, y)
}
/** A signed session value: base64url({exp, n}).HMAC (the cookie the invite link sets). */
export function makeSession(secret, hours = 72, now = Date.now()) {
	const body = b64u(JSON.stringify({ exp: Math.round(now / 1000 + hours * 3600), n: randomBytes(8).toString("hex") }))
	return `${body}.${sign(body, secret)}`
}
export function sessionValid(value, secret, now = Date.now()) {
	if (typeof value !== "string" || !secret) return false
	const [body, mac] = value.split(".")
	if (!body || !mac || !same(mac, sign(body, secret))) return false
	try {
		const { exp } = JSON.parse(Buffer.from(body, "base64url").toString("utf8"))
		return Number.isFinite(exp) && exp * 1000 > now
	} catch {
		return false
	}
}
const cookie = (req, name) => {
	for (const part of (header(req, "cookie") ?? "").split(";")) {
		const i = part.indexOf("=")
		if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim())
	}
	return undefined
}
/** [status, code, error] when the caller has no access, or null. */
export function accessProblem(req, env = process.env) {
	const secret = env.AI_SESSION_SECRET && env.AI_SESSION_SECRET.length >= 32 ? env.AI_SESSION_SECRET : null
	const token = env.AI_ACCESS_TOKEN && env.AI_ACCESS_TOKEN.length >= 16 ? env.AI_ACCESS_TOKEN : null
	const preview = env.VERCEL_ENV !== "production"
	if (!secret && !(token && preview)) return env.VERCEL ? [503, "not_configured", "the AI is not switched on for this deployment (no access configured)"] : null
	if (secret && sessionValid(cookie(req, SESSION_COOKIE), secret)) return null
	const given = header(req, "x-ai-access")
	if (token && preview && typeof given === "string" && same(given, token)) return null
	return [401, "unauthorized", "this page has no access to the AI (open the invite link again)"]
}

// ---------------------------------------------------------------- the queue (one instance)
const queue = { busy: 0, by: {}, waiting: [], typical: { ...TYPICAL_S } }
const capOf = (step) => Math.min(SLOTS(), STEP_SLOTS[step] ?? SLOTS())
const eligible = (step) => queue.busy < SLOTS() && (queue.by[step] ?? 0) < capOf(step)
const etaMs = (step, pos) => Math.round(Math.min(120000, Math.max(1000, ((queue.waiting.slice(0, pos - 1).filter((w) => w.step === step).length + 1) / capOf(step)) * queue.typical[step] * 1000)))
function pump() {
	for (const w of [...queue.waiting]) {
		if (!eligible(w.step)) continue
		queue.waiting.splice(queue.waiting.indexOf(w), 1)
		queue.busy++
		queue.by[w.step] = (queue.by[w.step] ?? 0) + 1
		w.resolve(true)
	}
}
/** -> {ok: true, release(seconds)} or {ok: false, position, retryAfterMs}. */
function acquire(step, signal) {
	const release = (seconds) => {
		queue.busy = Math.max(0, queue.busy - 1)
		queue.by[step] = Math.max(0, (queue.by[step] ?? 0) - 1)
		if (seconds > 0) queue.typical[step] = 0.8 * queue.typical[step] + 0.2 * Math.min(600, seconds)
		pump()
	}
	if (!queue.waiting.length && eligible(step)) {
		queue.busy++
		queue.by[step] = (queue.by[step] ?? 0) + 1
		return Promise.resolve({ ok: true, release })
	}
	if (queue.waiting.length >= QUEUE_MAX()) return Promise.resolve({ ok: false, position: queue.waiting.length + 1, retryAfterMs: etaMs(step, queue.waiting.length + 1) })
	return new Promise((resolve) => {
		const w = { step, resolve: null }
		const done = (got) => {
			clearTimeout(timer)
			signal?.removeEventListener("abort", onAbort)
			if (got) return resolve({ ok: true, release })
			const pos = Math.max(1, queue.waiting.indexOf(w) + 1)
			const i = queue.waiting.indexOf(w)
			if (i >= 0) queue.waiting.splice(i, 1)
			resolve({ ok: false, position: pos, retryAfterMs: etaMs(step, pos) })
			pump()
		}
		w.resolve = done
		const onAbort = () => done(false)
		const timer = setTimeout(() => done(false), QUEUE_WAIT_MS())
		signal?.addEventListener("abort", onAbort, { once: true })
		queue.waiting.push(w)
	})
}
export const _queue = queue // (tests)

// ---------------------------------------------------------------- the body
async function readBody(req) {
	if (req.body !== undefined && req.body !== null) {
		// Vercel's helpers parse JSON bodies already (a string or Buffer when the content type is not JSON)
		if (typeof req.body === "string" || Buffer.isBuffer(req.body)) {
			const s = req.body.toString()
			if (s.length > MAX_BODY) throw new AIError("too_large", "the request is too large")
			return JSON.parse(s)
		}
		return req.body
	}
	const chunks = []
	let n = 0
	for await (const c of req) {
		n += c.length
		if (n > MAX_BODY) throw new AIError("too_large", `the request is too large (at most ${MAX_BODY >> 20} MB)`)
		chunks.push(c)
	}
	return n ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null
}

// ---------------------------------------------------------------- GET /api/ai/session?invite=... : the production access cookie
function session(req, res) {
	const secret = process.env.AI_SESSION_SECRET && process.env.AI_SESSION_SECRET.length >= 32 ? process.env.AI_SESSION_SECRET : null
	const codes = (process.env.AI_INVITE_CODES ?? "").split(",").map((s) => s.trim()).filter((s) => s.length >= 12)
	if (!secret || !codes.length) return fail(res, 404, "bad_input", "no invite links on this deployment")
	const invite = String(req.query?.invite ?? new URL(req.url ?? "/", "http://x").searchParams.get("invite") ?? "")
	if (!invite || !codes.some((c) => same(c, invite))) return fail(res, 401, "unauthorized", "this invite link is not valid")
	const hours = Math.min(24 * 30, Math.max(1, Number(process.env.AI_SESSION_HOURS) || 72))
	res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(makeSession(secret, hours))}; Path=/api/ai; Max-Age=${hours * 3600}; HttpOnly; Secure; SameSite=Strict`)
	res.setHeader("Cache-Control", "no-store")
	res.statusCode = 303
	res.setHeader("Location", "/")
	res.end()
}

// ---------------------------------------------------------------- POST /api/ai/<step>
export default async function handler(req, res) {
	const step = String(req.query?.step ?? new URL(req.url ?? "/", "http://x").pathname.split("/").pop() ?? "")
	if (step === "session" && req.method === "GET") return session(req, res)
	if (req.method !== "POST") {
		res.setHeader("Allow", "POST")
		return fail(res, 405, "bad_input", "use POST")
	}
	if (!STEPS.includes(step)) return fail(res, 404, "bad_input", `no AI step "${step.slice(0, 40)}" (one of ${STEPS.join(", ")})`)
	const bad = originProblem(req)
	if (bad) return fail(res, 403, "forbidden", bad)
	const gate = await aiGate(req, step, { accessProblem }) // a signed-in person (accounts), else accessProblem's invite cookie or preview token
	if (!gate.ok) return fail(res, gate.status, gate.code, gate.error, gate.extra)
	const ctype = (header(req, "content-type") ?? "").split(";")[0].trim().toLowerCase()
	if (ctype !== "application/json") return fail(res, 415, "bad_input", "the body must be JSON (Content-Type: application/json)")
	const len = Number(header(req, "content-length") ?? 0)
	if (len > MAX_BODY) return fail(res, 413, "too_large", `the request is too large (at most ${MAX_BODY >> 20} MB)`)
	const t0 = Date.now()
	let body
	try {
		body = await readBody(req)
	} catch (e) {
		const err = e instanceof AIError ? e : new AIError("bad_input", "the body must be JSON {payload: {...}, client?: {requestId}}")
		return fail(res, err.status, err.code, err.message)
	}
	if (!body || typeof body !== "object" || Array.isArray(body) || !body.payload || typeof body.payload !== "object" || Array.isArray(body.payload))
		return fail(res, 400, "bad_input", "the body must be JSON {payload: {...}, client?: {requestId}}")
	const rid = typeof body.client?.requestId === "string" && RID_RE.test(body.client.requestId) ? body.client.requestId : undefined
	const ac = new AbortController()
	req.on?.("close", () => {
		if (!res.writableEnded) ac.abort(new Error("client left"))
	})
	const stream = /application\/x-ndjson/i.test(header(req, "accept") ?? "")
	// the queue
	const slot = await acquire(step, ac.signal)
	if (!slot.ok) {
		if (ac.signal.aborted) return
		const s = Math.max(1, Math.ceil(slot.retryAfterMs / 1000))
		return send(res, 429, { ok: false, error: "the AI is busy: other builds are using every AI slot; this request was not started (try again in a moment)", code: "busy", retryable: true, busy: true, position: slot.position, retryAfterMs: slot.retryAfterMs, retryAfter: s, ...(rid ? { requestId: rid } : {}) }, { "Retry-After": String(s) })
	}
	const over = await gate.charge() // the caller's and the site's limits, counted only for a step that runs: 403 quota (never 429, which means busy)
	if (over) return slot.release(0), fail(res, over.status, over.code, over.error, { ...over.extra, ...(rid ? { requestId: rid } : {}) })
	const started = Date.now()
	let beat = null
	const line = (obj) => {
		if (!res.writableEnded && !res.destroyed) res.write(scrub(JSON.stringify(obj)) + "\n")
	}
	try {
		if (stream) {
			res.statusCode = 200
			res.setHeader("Content-Type", "application/x-ndjson")
			res.setHeader("Cache-Control", "no-store")
			res.setHeader("X-Accel-Buffering", "no")
			res.flushHeaders?.()
			line({ type: "start", step, ...(rid ? { requestId: rid } : {}) })
			beat = setInterval(() => line({ type: "heartbeat", ms: Date.now() - started }), 10000)
		}
		let lastProgress = 0
		const onProgress = stream
			? (p) => {
					const now = Date.now()
					if (now - lastProgress < 1000) return
					lastProgress = now
					line({ type: "progress", model: String(p.model ?? "").slice(0, 80), attempt: p.attempt | 0, repair: !!p.repair, phase: p.phase === "writing" ? "writing" : "thinking", tokens: Math.max(0, p.tokens | 0), ms: Math.max(0, p.ms | 0) })
				}
			: undefined
		const budgetMs = MAX_DURATION_S * 1000 - MARGIN_MS - (Date.now() - t0)
		const out = await gate.run(() => runStep(step, body.payload, { signal: ac.signal, onProgress, budgetMs })) // (records what it cost)
		const ans = { ok: true, result: out.result, model: out.model, servedModel: out.servedModel, ms: out.ms, usage: out.usage, attempts: out.attempts, warnings: out.warnings, prompt: out.prompt }
		if (out.catalog) ans.catalog = out.catalog
		if (out.goals) ans.goals = out.goals
		if (out.stages) ans.stages = out.stages
		if (out.intent) ans.intent = out.intent
		if (out.why) ans.why = out.why
		if (out.edit) ans.edit = out.edit
		if (rid) ans.requestId = rid
		if (stream) {
			line({ type: "result", status: 200, ...ans })
			return res.end()
		}
		return send(res, 200, ans)
	} catch (e) {
		const err = e instanceof AIError ? e : new AIError("internal", "the AI step failed")
		if (err.code === "aborted" && (res.destroyed || ac.signal.aborted)) return
		const ans = { ok: false, error: err.message, code: err.code, status: err.status, retryable: !!err.retryable }
		if (err.attempts?.length) ans.attempts = err.attempts
		if (err.details) ans.details = err.details
		if (rid) ans.requestId = rid
		if (stream) {
			line({ type: "result", ...ans })
			return res.end()
		}
		return send(res, err.status, ans)
	} finally {
		clearInterval(beat)
		slot.release((Date.now() - started) / 1000)
	}
}
