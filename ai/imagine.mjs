// The imagine step (ai/DESIGN.md §15, ai/research/round3-plan.md §3): a concept picture of a NEW scene from words alone, for the client's
// imagine-first route (a multi-step chain: concept -> observe -> plan). Ported from ai/experiments/imagine/lib/{cast,prompts,catalog-info,
// image}.mjs, which measured it (pass 0.82 -> 0.95 on chains).
//   import { imagine } from "./imagine.mjs"      (runStep("imagine", {text}) in ai/steps.mjs calls it)
//   const out = await imagine({ text: "a marble rolls down a ramp, knocks over 5 dominoes, and the last one tips a cup" }, { signal })
//   // out.result {concepts: [{data: "data:image/jpeg;base64,...", mime, model, width, height}] (exactly one), cast: [{type, count, role, size}],
//   //             missing: [{asked, substitute_type}], layout, story: [...], prompt (the image prompt, for the record), ms: {prepass, image}}
//   // out.usage  the pre-pass usage + image: {model, output_tokens, usd_est}; costInUSD includes the image estimate (the gateway gives an
//   //            image's tokens, not its price, and api/_lib/ai-gate.mjs meters costInUSD)
// The flow:
//   1. pre-pass: models.json "prepass" (Opus 5.5, low effort) reads the request against the catalog brief (prompts/prepass.md) and answers the
//      cast (catalog keys only, counts, roles; sizes added here), what the catalog lacks, the START layout (left to right, laid out so it would
//      really work) and the story. The validator drops non-catalog keys and needs a cast item and a layout.
//   2. the image prompt: prompts/imagine.md (the experiment's "photo" template, byte for byte) with the request, the cast lines (name, size and
//      looks from the catalog digest) and the layout.
//   3. the picture: models.json "imagine" (kind "image"): POST <gateway base without /v1>/images/generations over HTTP/1.1 (fetchH1: Node's
//      fetch queues parallel calls on one HTTP/2 connection, which is how the experiment's image log reached 16-380 s). gpt-image-2.5-flare at
//      quality high, 1536x1024, JPEG 85 (about 100-250 KB); then sunburst with the same params; then Gemini 3 Pro Image with none (a square
//      PNG). Each attempt has timeoutMs; a 429 / 5xx / network error is tried once more on the same route after a backoff (Retry-After
//      honoured up to maxBackoffMs, else the next route at once); a timeout, a picture over maxPictureBytes (2.5 MB: the hosted answer must
//      stay under Vercel's 4.5 MB) or another 4xx moves on to the next route. budgetMs (70 s) covers the whole step, pre-pass included, so
//      it ends inside the client's 75 s deadline.
// The key comes from the environment only (TRUEFOUNDRY_API_KEY) and is scrubbed from every error; it never reaches a result or a log line.
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { AIError, callModel, gatewayUrl, loadRouting, scrub } from "./core.mjs"
import { getCatalog } from "./catalog-digest.mjs"
import { fetchH1 } from "./fetch-h1.mjs" // (the shipped copy: ai/research is not in the Vercel upload)

const HERE = dirname(fileURLToPath(import.meta.url))
const MAX_TEXT = 8000
const PICTURE_FIELDS = ["images", "image", "pictures", "renders"]
/** The biggest picture passed on (decoded bytes; models.json steps.imagine.maxPictureBytes overrides it): 2.5 MB is 3.3 MB of base64, which
 *  leaves room under Vercel's 4.5 MB response limit. Measured: flare's JPEGs 83-113 KB, Gemini's PNGs 516-552 KB. */
export const MAX_PICTURE_BYTES = 2.5 * 1048576

// ---------------------------------------------------------------- prompts
/** A prompt file of this step (AI_PROMPTS_DIR when it has one, else ai/prompts), without its trailing newline. */
function promptFile(name) {
	const dir = process.env.AI_PROMPTS_DIR
	const path = dir && existsSync(join(dir, name)) ? join(dir, name) : join(HERE, "prompts", name)
	return readFileSync(path, "utf8").replace(/\n+$/, "")
}
const hash = (s) => createHash("sha1").update(s).digest("hex").slice(0, 10)

/** The pre-pass system prompt: prompts/prepass.md with the catalog brief (static per catalog, so the route's prompt cache serves it). */
export function prepassSystem(cat) {
	return promptFile("prepass.md").replace("{{CATALOG_BRIEF}}", () => cat.brief)
}
/** The pre-pass user turn. */
export const prepassUser = (request) => `# The request\n"""\n${request}\n"""\n\nAnswer as one JSON object.`

// ---------------------------------------------------------------- catalog facts for the image prompt
const infoMemo = new WeakMap()
/**
 * Per-type facts for the image prompt: name, true size at the defaults (outline w × h, m), what it looks like (the digest's "Looks:" line), from
 * the catalog digest. -> {types: Map(key -> {key, name, w, h, looks, desc, dynamic, category, facts}), cat}
 */
export async function catalogInfo(cat) {
	cat ??= await getCatalog()
	if (infoMemo.has(cat)) return infoMemo.get(cat)
	const blocks = new Map()
	for (const b of cat.text.split("\n### ").slice(1)) blocks.set(b.slice(0, b.indexOf(" ")), b)
	const types = new Map()
	for (const [key, t] of Object.entries(cat.index.types)) {
		if (key === "table") continue
		const b = blocks.get(key) ?? ""
		const looks = /\nLooks: ([^\n]+)/.exec(b)?.[1]?.trim() ?? null
		const o = t.outline ?? {}
		const w = Number.isFinite(o.x1 - o.x0) ? o.x1 - o.x0 : null
		const h = Number.isFinite(o.y1 - o.y0) ? o.y1 - o.y0 : null
		const desc = String(t.description ?? "").split(/(?<=[.:])\s/)[0].replace(/:$/, "")
		types.set(key, { key, name: t.name, w, h, looks, desc, dynamic: !!t.dynamic, category: t.category, facts: t.facts ?? "" })
	}
	const out = { types, cat }
	infoMemo.set(cat, out)
	return out
}

/** "6.7 cm" / "1 m" */
export const fmtLen = (v) => (!Number.isFinite(v) ? "?" : v >= 1 ? `${+v.toFixed(2)} m` : v >= 0.1 ? `${Math.round(v * 100)} cm` : `${+(v * 100).toFixed(1)} cm`)
/** A size phrase for the image prompt: "6.7 cm across" for a ball, else "w wide × h tall". */
export function sizePhrase(t) {
	if (!t || !Number.isFinite(t.w) || !Number.isFinite(t.h)) return ""
	if (Math.abs(t.w - t.h) < 1e-6 && /ball|marble|Balls/i.test(`${t.name} ${t.category}`)) return `${fmtLen(t.w)} across`
	return `${fmtLen(t.w)} wide × ${fmtLen(t.h)} tall`
}

// ---------------------------------------------------------------- the pre-pass answer
/**
 * The pre-pass answer as the image prompt needs it: cast items with catalog keys only (others dropped with a warning), counts 1..60 (else 1),
 * roles ≤ 140 characters, each with its size phrase; at least one cast item and a layout; missing and story tidied.
 */
export function validatePrepass(v, types) {
	const errors = []
	const warnings = []
	if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false, errors: ["answer must be a JSON object"], warnings }
	const kept = []
	for (const c of Array.isArray(v.cast) ? v.cast : []) {
		if (!c || typeof c.type !== "string") continue
		if (!types.has(c.type)) {
			warnings.push(`cast type "${c.type}" is not a catalog key: dropped`)
			continue
		}
		kept.push({ type: c.type, count: Number.isInteger(c.count) && c.count > 0 ? Math.min(c.count, 60) : 1, role: String(c.role ?? "").slice(0, 140), size: sizePhrase(types.get(c.type)) })
	}
	if (!kept.length) errors.push('"cast" must list at least one catalog key (exact keys from the catalog)')
	if (typeof v.layout !== "string" || v.layout.trim().length < 10) errors.push('"layout" must describe the start of the scene')
	if (errors.length) return { ok: false, errors, warnings }
	return {
		ok: true,
		errors,
		warnings,
		value: {
			cast: kept,
			missing: (Array.isArray(v.missing) ? v.missing : []).filter((m) => m && typeof m === "object").map((m) => ({ asked: String(m.asked ?? "").slice(0, 120), substitute_type: types.has(m.substitute_type) ? m.substitute_type : null })),
			layout: String(v.layout).slice(0, 1200),
			story: (Array.isArray(v.story) ? v.story : []).map((s) => String(s).slice(0, 200)).slice(0, 10)
		}
	}
}

// ---------------------------------------------------------------- the image prompt
/** One line per cast item: "- 8 × domino (0.8 cm wide × 5 cm tall; light wood with dark pips) — topple in a row along the shelf". */
export function castLines(prepass, info) {
	return prepass.cast.map((c) => {
		const t = info.types.get(c.type)
		const what = t ? t.name.replace(/\s*\(.*\)$/, "").toLowerCase() : c.type
		const looks = t?.looks ? `; ${t.looks.replace(/\.$/, "")}` : ""
		const size = c.size ? ` (${c.size}${looks})` : looks ? ` (${looks.slice(2)})` : ""
		return `- ${c.count} × ${what}${size}${c.role ? ` — ${c.role}` : ""}`
	})
}
/**
 * The text sent to the image model: prompts/imagine.md with {{REQUEST}}, {{CAST}}, {{LAYOUT}} and {{STORY}} filled in (one pass, so text in
 * the request is never read as a placeholder). The shipped template is the experiment's "photo" one, byte for byte (it does not use the story).
 */
export async function imagePrompt(request, prepass, { info } = {}) {
	info ??= await catalogInfo()
	const story = prepass.story?.length ? prepass.story.map((s, i) => `${i + 1}. ${s}`).join(" ") : ""
	const vals = { REQUEST: request, CAST: castLines(prepass, info).join("\n"), LAYOUT: prepass.layout, STORY: story }
	return promptFile("imagine.md").replace(/\{\{(REQUEST|CAST|LAYOUT|STORY)\}\}/g, (_, k) => vals[k])
}

// ---------------------------------------------------------------- image routes
/**
 * The resolved image routes of a step of kind "image" in models.json: [{model, params, usdPerOutputToken}] with the step's timings. A route
 * whose quirks say imageParams: false (or any Gemini route, unless its quirks say otherwise) gets no size, quality or format params.
 */
export function imageRoutes(step = "imagine", routing = loadRouting()) {
	const s = routing.steps?.[step]
	if (!s || s.kind !== "image") throw new AIError("config", `no image route for step "${step}" in models.json`)
	const seen = new Set()
	const routes = []
	for (const e of [s.model, ...(s.fallbacks ?? [])]) {
		const r = typeof e === "string" ? { model: e } : e
		if (!r?.model || seen.has(r.model)) continue
		seen.add(r.model)
		const quirks = routing.models?.[r.model] ?? {}
		const plain = quirks.imageParams === false || (quirks.imageParams === undefined && /gemini/i.test(r.model))
		routes.push({ model: r.model, params: plain ? {} : { ...(s.params ?? {}), ...(r.params ?? {}) }, usdPerOutputToken: Number(r.usdPerOutputToken ?? quirks.usdPerOutputToken ?? s.usdPerOutputToken ?? 0.00004) })
	}
	if (!routes.length) throw new AIError("config", `the image step "${step}" has no model`)
	return {
		routes,
		timeoutMs: s.timeoutMs ?? 30000,
		budgetMs: s.budgetMs ?? 70000,
		retries: s.retries ?? 1,
		backoffMs: s.backoffMs ?? 2000,
		maxBackoffMs: s.maxBackoffMs ?? 20000,
		minAttemptMs: s.minAttemptMs ?? 5000,
		typicalTokens: s.typicalTokens ?? 1372,
		maxPictureBytes: s.maxPictureBytes ?? MAX_PICTURE_BYTES
	}
}

// ---------------------------------------------------------------- one image attempt
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
function retryAfterMs(h) {
	if (!h) return null
	const s = Number(h)
	if (Number.isFinite(s)) return Math.max(0, s * 1000)
	const d = Date.parse(h)
	return Number.isFinite(d) ? Math.max(0, d - Date.now()) : null
}
/** A gateway error body as one short line, without the key. */
function errorLine(body, env) {
	let msg = body
	try {
		const j = JSON.parse(body)
		msg = j?.error?.message ?? j?.message ?? body
	} catch {
		msg = String(body).replace(/<[^>]+>/g, " ")
	}
	return scrub(String(typeof msg === "string" ? msg : JSON.stringify(msg)).replace(/\s+/g, " ").trim(), env).slice(0, 300)
}

/** {mime, width, height} of a picture's bytes (PNG, JPEG, WebP, GIF), or {mime: null}. */
export function pictureInfo(buf) {
	if (!buf || buf.length < 12) return { mime: null, width: null, height: null }
	if (buf[0] === 0x89 && buf.toString("latin1", 1, 4) === "PNG") return { mime: "image/png", width: buf.length >= 24 ? buf.readUInt32BE(16) : null, height: buf.length >= 24 ? buf.readUInt32BE(20) : null }
	if (buf[0] === 0xff && buf[1] === 0xd8) {
		let i = 2
		while (i + 9 < buf.length) {
			if (buf[i] !== 0xff) {
				i++
				continue
			}
			const m = buf[i + 1]
			if (m === 0xff) {
				i++
				continue
			}
			if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
				i += 2
				continue
			}
			const len = buf.readUInt16BE(i + 2)
			if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { mime: "image/jpeg", width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) }
			if (m === 0xda) break
			i += 2 + len
		}
		return { mime: "image/jpeg", width: null, height: null }
	}
	if (buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return { mime: "image/webp", width: null, height: null }
	if (buf.toString("latin1", 0, 3) === "GIF") return { mime: "image/gif", width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }
	return { mime: null, width: null, height: null }
}

async function imageAttempt({ fetchImpl, url, key, route, prompt, timeoutMs, signal, maxBytes = MAX_PICTURE_BYTES }) {
	const timeout = new AbortController()
	const timer = setTimeout(() => timeout.abort(new Error("timeout")), timeoutMs)
	const both = AbortSignal.any([timeout.signal, ...(signal ? [signal] : [])])
	const t0 = Date.now()
	try {
		const r = await fetchImpl(url, {
			method: "POST",
			headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
			body: JSON.stringify({ model: route.model, prompt, n: 1, ...route.params }),
			signal: both
		})
		const text = await r.text()
		const ms = Date.now() - t0
		if (!r.ok) return { ok: false, status: r.status, ms, body: text, retryAfter: retryAfterMs(r.headers?.get?.("retry-after")) }
		let j
		try {
			j = JSON.parse(text)
		} catch {
			return { ok: false, status: 502, ms, body: "the gateway answered with something that is not JSON", retryable: true }
		}
		const d = j?.data?.[0]
		const b64 = typeof d?.b64_json === "string" ? d.b64_json.replace(/\s+/g, "") : ""
		if (!b64) return { ok: false, status: 502, ms, body: d?.url ? "the picture came as a link, not as data" : "the answer holds no picture", retryable: true }
		const bytes = Buffer.from(b64, "base64")
		const info = pictureInfo(bytes)
		if (!info.mime) return { ok: false, status: 502, ms, body: "the answer's picture is not a JPEG, PNG, WebP or GIF", retryable: true }
		// (too big to send on: the hosted answer is one JSON body under Vercel's 4.5 MB response limit, and base64 adds a third; the same route
		// with the same params would draw as big a picture again, so the next route at once)
		if (bytes.length > maxBytes) return { ok: false, status: 502, ms, body: `the picture is too big to send on (${(bytes.length / 1048576).toFixed(1)} MB; at most ${(maxBytes / 1048576).toFixed(1)} MB)`, nextRoute: true }
		return { ok: true, status: r.status, ms, b64, bytes: bytes.length, ...info, usage: j?.usage ?? null }
	} catch (e) {
		const ms = Date.now() - t0
		if (signal?.aborted) return { aborted: true, ms }
		if (timeout.signal.aborted) return { ok: false, timeout: true, status: 504, ms, body: `no picture within ${Math.round(timeoutMs / 1000)} s` }
		return { ok: false, status: 0, ms, body: `network error: ${e?.cause?.code ?? e?.code ?? e?.message ?? e}`, retryable: true }
	} finally {
		clearTimeout(timer)
	}
}

const RETRYABLE = new Set([408, 409, 425, 429, 500, 502, 503, 504, 520, 522, 524, 529])
/**
 * The picture, from the first image route that gives one inside the deadline. -> {model, b64, mime, width, height, bytes, usage, ms, attempts,
 * usdPerOutputToken}; throws AIError (gateway | timeout | budget | aborted) with the attempts.
 */
export async function drawPicture(prompt, R, { env = process.env, fetch: fetchImpl = fetchH1, signal, deadline = Date.now() + R.budgetMs, log = () => {}, onProgress, backoffScale = 1 } = {}) {
	const key = env.TRUEFOUNDRY_API_KEY
	if (!key) throw new AIError("config", "the AI key is not set on the server (TRUEFOUNDRY_API_KEY)")
	const url = `${gatewayUrl(env).replace(/\/+$/, "").replace(/\/v1$/, "")}/images/generations`
	const attempts = []
	const aborted = () => new AIError("aborted", "cancelled", { attempts })
	let last = null
	let tries = 0
	const t0 = Date.now()
	routes: for (const route of R.routes) {
		for (let attempt = 0; attempt <= R.retries; attempt++) {
			if (signal?.aborted) throw aborted()
			const remaining = deadline - Date.now()
			if (remaining < R.minAttemptMs) {
				last ??= new AIError("budget", `ran out of time for the concept picture (${Math.round(R.budgetMs / 1000)} s budget)`, { retryable: true })
				break routes
			}
			const n = ++tries
			const ta = Date.now()
			const note = () => {
				try {
					onProgress?.({ step: "imagine", model: route.model, attempt: n, repair: false, phase: "writing", tokens: 0, ms: Date.now() - ta })
				} catch {}
			}
			note()
			const ticker = onProgress ? setInterval(note, 2000) : null
			let res
			try {
				res = await imageAttempt({ fetchImpl, url, key, route, prompt, timeoutMs: Math.min(R.timeoutMs, remaining), signal, maxBytes: R.maxPictureBytes })
			} finally {
				clearInterval(ticker)
			}
			if (res.aborted) {
				attempts.push({ model: route.model, ok: false, ms: res.ms, error: "cancelled", image: true })
				throw aborted()
			}
			if (res.ok) {
				attempts.push({ model: route.model, ok: true, status: res.status, ms: res.ms, image: true })
				return { model: route.model, b64: res.b64, mime: res.mime, width: res.width, height: res.height, bytes: res.bytes, usage: res.usage, ms: Date.now() - t0, attempts, usdPerOutputToken: route.usdPerOutputToken }
			}
			const msg = res.timeout ? res.body : errorLine(res.body, env)
			attempts.push({ model: route.model, ok: false, status: res.status, ms: res.ms, error: msg, image: true })
			log(`imagine ${route.model} attempt ${attempt + 1}: ${res.status} ${msg}`)
			last = new AIError(res.timeout ? "timeout" : "gateway", `${route.model}: ${msg}`, { retryable: true })
			// a picture that did not come within the attempt's time: the next route (another wait on this one would eat the budget);
			// a picture too big to send on, or a 4xx other than 408/409/425/429: the next route at once
			if (res.timeout || res.nextRoute || !(res.retryable || res.status === 0 || RETRYABLE.has(res.status))) continue routes
			if (attempt < R.retries) {
				// Retry-After is honoured when it is short enough; a longer one moves on to the next route at once
				if (res.retryAfter != null && res.retryAfter > R.maxBackoffMs) continue routes
				const backoff = Math.min(R.maxBackoffMs, R.backoffMs * 2 ** attempt) * (0.75 + Math.random() * 0.5)
				const wait = Math.min(Math.max(backoff, res.retryAfter ?? 0) * backoffScale, Math.max(0, deadline - Date.now() - R.minAttemptMs))
				try {
					await sleep(wait, signal)
				} catch {
					throw aborted()
				}
			}
		}
	}
	const err = last ?? new AIError("gateway", "no image route answered", { retryable: true })
	err.attempts = attempts
	throw err
}

// ---------------------------------------------------------------- the step
const bad = (msg) => new AIError("bad_input", msg)
const round = (v, d = 6) => Math.round(v * 10 ** d) / 10 ** d

/**
 * POST /api/ai/imagine {payload: {text*}}: the step (see the top of this file). o: {signal, routing, env, fetch (the pre-pass's chat calls),
 * imageFetch (the picture's; default fetchH1), log, backoffScale, budgetMs (a host's cap), onProgress}.
 * -> {result, model (the image route that drew it), servedModel, ms, usage, attempts, warnings, prompt, catalog}; throws AIError (its usage
 * is the pre-pass's when the picture failed after it, so a host still meters what was spent).
 */
export async function imagine(p, o = {}) {
	for (const k of PICTURE_FIELDS)
		if (p[k] !== undefined && p[k] !== null && !(Array.isArray(p[k]) && !p[k].length))
			throw bad("imagine makes a picture from words only: a picture of your own is the reference itself (send it to observe and plan)")
	const v = p.text
	if (v === undefined || v === null) throw bad("text is missing")
	if (typeof v !== "string") throw bad("text must be text")
	if (v.length > MAX_TEXT) throw bad(`text is too long (${v.length} characters; at most ${MAX_TEXT})`)
	const text = v.trim()
	if (!text) throw bad("text is empty")
	const env = o.env ?? process.env
	if (!env.TRUEFOUNDRY_API_KEY) throw new AIError("config", "the AI key is not set on the server (TRUEFOUNDRY_API_KEY)")
	const routing = o.routing ?? loadRouting()
	const R = imageRoutes("imagine", routing)
	const start = Date.now()
	if (Number.isFinite(o.budgetMs) && o.budgetMs > 0) R.budgetMs = Math.min(R.budgetMs, o.budgetMs)
	const deadline = start + R.budgetMs
	const log = o.log ?? (env.AI_DEBUG ? (l) => process.stderr.write(`[ai] ${scrub(l, env)}\n`) : () => {})
	const cat = await getCatalog()
	const info = await catalogInfo(cat)
	const system = prepassSystem(cat)
	const user = prepassUser(text)

	// 1. the pre-pass (its own budget, capped so the picture keeps one whole attempt: timeoutMs, at most 45 s; with models.json's 70 s budget
	//    and 30 s attempts, the pre-pass gets 40 s, and the whole step ends inside the client's 75 s deadline)
	let pre
	try {
		pre = await callModel("prepass", {
			system,
			content: user,
			validate: (x) => validatePrepass(x, info.types),
			signal: o.signal,
			routing,
			env,
			fetch: o.fetch,
			log,
			backoffScale: o.backoffScale,
			budgetMs: Math.max(1000, deadline - Date.now() - Math.min(45000, R.timeoutMs)),
			onProgress: o.onProgress ? (x) => o.onProgress({ ...x, step: "imagine" }) : undefined
		})
	} catch (e) {
		if (!(e instanceof AIError)) throw e
		if (e.code !== "aborted") e.message = `the pre-pass failed: ${e.message}`
		throw e
	}
	const t1 = Date.now()
	const prompt = await imagePrompt(text, pre.result, { info })

	// 2. the picture
	let img
	try {
		img = await drawPicture(prompt, R, { env, fetch: o.imageFetch ?? fetchH1, signal: o.signal, deadline, log, onProgress: o.onProgress, backoffScale: o.backoffScale ?? 1 })
	} catch (e) {
		if (!(e instanceof AIError)) throw e
		if (e.code !== "aborted" && e.code !== "config") e.message = `no concept picture: ${e.message}`
		e.attempts = [...(pre.attempts ?? []), ...(e.attempts ?? [])]
		e.usage = pre.usage
		e.ms = Date.now() - start
		throw e
	}
	const t2 = Date.now()
	const outTokens = Number(img.usage?.output_tokens ?? img.usage?.output_tokens_details?.image_tokens)
	const tokens = Number.isFinite(outTokens) && outTokens > 0 ? outTokens : null
	const usdEst = round((tokens ?? R.typicalTokens) * img.usdPerOutputToken)
	const preUsd = Number(pre.usage?.costInUSD)
	const usage = { ...pre.usage, image: { model: img.model, output_tokens: tokens, usd_est: usdEst, ...(tokens === null ? { tokens_assumed: R.typicalTokens } : {}) }, costInUSD: round((Number.isFinite(preUsd) ? preUsd : 0) + usdEst) }
	const warnings = [...(pre.warnings ?? [])]
	if (img.model !== R.routes[0].model) warnings.push(`the concept was drawn by ${img.model} (${R.routes[0].model} failed)`)
	return {
		result: {
			concepts: [{ data: `data:${img.mime};base64,${img.b64}`, mime: img.mime, model: img.model, width: img.width, height: img.height }],
			cast: pre.result.cast,
			missing: pre.result.missing,
			layout: pre.result.layout,
			story: pre.result.story,
			prompt,
			ms: { prepass: t1 - start, image: t2 - t1 }
		},
		model: img.model,
		servedModel: img.model,
		ms: Date.now() - start,
		usage,
		attempts: [...(pre.attempts ?? []), ...img.attempts],
		warnings,
		prompt: { system: hash(system), chars: system.length + user.length },
		catalog: { fingerprint: cat.fingerprint, source: cat.source, ...(cat.stale ? { stale: true } : {}) }
	}
}
