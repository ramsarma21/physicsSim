// ai/imagine.mjs (the imagine step: ai/DESIGN.md §15) against a mock gateway on 127.0.0.1: the chat pre-pass goes to ./mock-gateway.mjs
// (through a small front server that also answers POST /images/generations from a script), so the whole step runs over real HTTP with the
// real catalog, prompts and validator. The key is a fake one, and it must appear in no answer, error or log line.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createServer } from "node:http"
import { after, before, beforeEach, test } from "node:test"
import { AIError } from "../core.mjs"
import { catalogInfo, imagePrompt, imageRoutes, imagine, pictureInfo, prepassSystem, validatePrepass } from "../imagine.mjs"
import { runStep, STEPS } from "../steps.mjs"
import { getCatalog } from "../catalog-digest.mjs"
import { FAKE_KEY, mockEnv, startMockGateway } from "./mock-gateway.mjs"

const HERE = new URL("./", import.meta.url)
const fixture = (name) => JSON.parse(readFileSync(new URL(`fixtures/imagine/${name}.json`, HERE), "utf8"))
const FIXTURES = ["c1-rube-cup", "n09-pendulum-dominoes-car", "i1-cat-water"]
const MODELS = JSON.parse(readFileSync(new URL("../models.json", HERE), "utf8"))
const FLARE = "openai-group/gpt-image-2.5-flare"
const SUNBURST = "openai-group/gpt-image-2.5-sunburst"
const GEMINI = "gemini-group/gemini-3-pro-image-preview"

// ---------------------------------------------------------------- tiny pictures (headers only: the step reads type and size from them)
function jpeg(w, h) {
	const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01])
	const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00])
	return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.alloc(64, 0x11), Buffer.from([0xff, 0xd9])])
}
function png(w, h) {
	const b = Buffer.alloc(33)
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
	b.writeUInt32BE(13, 8)
	b.write("IHDR", 12, "latin1")
	b.writeUInt32BE(w, 16)
	b.writeUInt32BE(h, 20)
	return b
}
const JPEG = jpeg(1536, 1024).toString("base64")
const PNG = png(1024, 1024).toString("base64")
const IMG_USAGE = { input_tokens: 660, input_tokens_details: { image_tokens: 0, text_tokens: 660 }, output_tokens: 1372, output_tokens_details: { image_tokens: 1372, text_tokens: 0 }, total_tokens: 2032 }

// ---------------------------------------------------------------- the front server: images scripted here, chat proxied to the mock gateway
let gw
let front
const images = { scripts: new Map(), requests: [] }
before(async () => {
	gw = await startMockGateway()
	const chatOrigin = gw.url.replace(/\/v1$/, "")
	const server = createServer(async (req, res) => {
		const chunks = []
		for await (const c of req) chunks.push(c)
		const raw = Buffer.concat(chunks)
		if (req.url === "/images/generations") {
			let body = null
			try {
				body = JSON.parse(raw.toString("utf8"))
			} catch {}
			const rec = { model: body?.model, body, auth: /^Bearer \S{8,}$/.test(req.headers.authorization ?? ""), at: Date.now() }
			images.requests.push(rec)
			const q = images.scripts.get(body?.model)
			const step = q?.length ? q.shift() : { status: 500, message: "no scripted picture" }
			if (step.hang) return
			if (step.delayMs) await new Promise((r) => setTimeout(r, step.delayMs))
			if (res.destroyed) return
			const status = step.status ?? 200
			res.writeHead(status, { "content-type": "application/json", ...(step.headers ?? {}) })
			return res.end(status === 200 ? JSON.stringify({ created: 1, data: [{ b64_json: step.b64 ?? JPEG }], usage: step.usage === undefined ? IMG_USAGE : step.usage }) : JSON.stringify({ error: { message: step.message ?? `mock error ${status}` } }))
		}
		const r = await fetch(chatOrigin + req.url, { method: req.method, headers: { "content-type": req.headers["content-type"] ?? "application/json", authorization: req.headers.authorization ?? "" }, body: raw.length ? raw : undefined })
		res.writeHead(r.status, { "content-type": r.headers.get("content-type") ?? "application/json" })
		for await (const c of r.body) res.write(c)
		res.end()
	})
	const sockets = new Set()
	server.on("connection", (s) => {
		sockets.add(s)
		s.on("close", () => sockets.delete(s))
	})
	await new Promise((r) => server.listen(0, "127.0.0.1", r))
	front = { url: `http://127.0.0.1:${server.address().port}/v1`, close: () => new Promise((r) => (sockets.forEach((s) => s.destroy()), server.close(() => r()))) }
})
after(async () => {
	await front.close()
	await gw.close()
})
beforeEach(() => {
	gw.reset()
	images.scripts.clear()
	images.requests.length = 0
})
const script = (model, steps) => images.scripts.set(model, [...(images.scripts.get(model) ?? []), ...steps])

/** A routing like models.json's prepass and imagine steps (the same models and image params), with short timings. */
function routing(over = {}) {
	const im = MODELS.steps.imagine
	return {
		defaults: { minAttemptMs: 50, maxBackoffMs: 200 },
		models: { p1: { vision: true }, p2: { vision: true }, ...Object.fromEntries(Object.entries(MODELS.models).filter(([k]) => /image/.test(k))) },
		steps: {
			prepass: { model: "p1", fallbacks: ["p2"], params: { max_tokens: 100, reasoning_effort: "low" }, timeoutMs: 1500, budgetMs: 4000, retries: 1, backoffMs: 10 },
			imagine: { ...im, timeoutMs: 600, budgetMs: 6000, backoffMs: 10, maxBackoffMs: 300, minAttemptMs: 100, ...over }
		}
	}
}
const logs = []
const opts = (extra = {}) => ({ env: mockEnv({ url: front.url }), routing: routing(), backoffScale: 0.01, log: (l) => logs.push(l), ...extra })
const PRE = (fx = fixture("c1-rube-cup")) => ({ ...fx.prepass, cast: fx.prepass.cast.map(({ size, ...c }) => c) })
const prepassOk = (answer = PRE()) => gw.script("p1", [{ content: JSON.stringify(answer), usage: { prompt_tokens: 6440, completion_tokens: 2079, total_tokens: 8519, costInUSD: 0.0431 } }])
const noKey = (x) => assert.equal(JSON.stringify(x).includes(FAKE_KEY), false, "the key is nowhere in it")
const imageModels = () => images.requests.map((r) => r.model)

// ---------------------------------------------------------------- config and prompts
test("models.json: the prepass step (Opus 5.5 low) and the imagine step (flare, then sunburst, then Gemini; high, 1536x1024, JPEG 85)", () => {
	const p = MODELS.steps.prepass
	assert.equal(p.model, "claude-group/claude-opus-5-5")
	assert.deepEqual([p.params.reasoning_effort, p.params.max_tokens, p.timeoutMs, p.idleTimeoutMs, p.budgetMs, p.retries, p.stream], ["low", 6000, 40000, 20000, 45000, 0, true])
	assert.deepEqual(p.fallbacks.map((f) => (typeof f === "string" ? f : f.model)), ["aws-bedrock/global.anthropic.claude-opus-5-5", "openai-group/gpt-6.1-sol"])
	const im = MODELS.steps.imagine
	assert.equal(im.kind, "image")
	assert.equal(im.model, FLARE)
	assert.deepEqual(im.params, { size: "1536x1024", quality: "high", output_format: "jpeg", output_compression: 85 })
	assert.deepEqual([im.timeoutMs, im.budgetMs, im.retries, im.usdPerOutputToken], [30000, 70000, 1, 0.00004])
	// the whole step ends inside the client's 75 s deadline, and the pre-pass (the budget less one picture attempt) still has time for a fallback
	// after a hung first route (its idle timeout)
	assert.ok(im.budgetMs <= 75000, "the imagine budget fits the client's 75 s deadline")
	const preBudget = Math.min(p.budgetMs, im.budgetMs - Math.min(45000, im.timeoutMs))
	assert.ok(preBudget - p.idleTimeoutMs >= 15000, "a hung pre-pass route leaves time for the next route")
	const R = imageRoutes("imagine", MODELS)
	assert.deepEqual(R.routes.map((r) => r.model), [FLARE, SUNBURST, GEMINI])
	assert.deepEqual(R.routes[1].params, im.params)
	assert.deepEqual(R.routes[2].params, {}, "Gemini gets no size, quality or format params")
	assert.ok(STEPS.includes("imagine"))
})

test("prompts/prepass.md is the experiment's pre-pass system prompt, byte for byte (with the catalog brief in place)", async () => {
	const src = readFileSync(new URL("../experiments/imagine/lib/cast.mjs", HERE), "utf8")
	const head = "const SYSTEM = (brief) => `"
	const a = src.indexOf(head) + head.length
	const theirs = src.slice(a, src.indexOf("`", a))
	const cat = await getCatalog()
	assert.equal(prepassSystem(cat), theirs.replace("${brief}", cat.brief))
})

test("the image prompt is byte-identical to the experiment's photo prompt for 3 stored pre-passes", async () => {
	const info = await catalogInfo()
	for (const name of FIXTURES) {
		const fx = fixture(name)
		assert.equal(await imagePrompt(fx.request, fx.prepass, { info }), fx.prompt, name)
		// and the experiment's own function agrees (same catalog, same template)
		const { imagePrompt: theirs } = await import("../experiments/imagine/lib/prompts.mjs")
		assert.equal(await theirs("photo", fx.request, fx.prepass), fx.prompt, `${name} (experiment)`)
	}
	// text in the request is never read as a placeholder
	const fx = fixture("c1-rube-cup")
	const odd = await imagePrompt("a ball {{CAST}} rolls $& away", fx.prepass, { info })
	assert.match(odd, /moment just before it starts: a ball \{\{CAST\}\} rolls \$& away\n/)
})

test("the validator drops keys that are not in the catalog, adds sizes, and needs a cast and a layout", async () => {
	const { types } = await catalogInfo()
	const v = validatePrepass({ cast: [{ type: "unicorn", count: 1, role: "x" }, { type: "tennis-ball", count: 200, role: "rolls" }, { type: "domino", count: 0 }], missing: [{ asked: "a cat", substitute_type: "dragon" }, 3], layout: "A tennis ball waits at the top of the ramp.", story: ["it rolls"] }, types)
	assert.equal(v.ok, true)
	assert.deepEqual(v.value.cast.map((c) => [c.type, c.count]), [["tennis-ball", 60], ["domino", 1]])
	assert.match(v.value.cast[0].size, /cm across$/)
	assert.match(v.warnings[0], /"unicorn" is not a catalog key: dropped/)
	assert.deepEqual(v.value.missing, [{ asked: "a cat", substitute_type: null }])
	const none = validatePrepass({ cast: [{ type: "unicorn" }], layout: "x" }, types)
	assert.equal(none.ok, false)
	assert.equal(none.errors.length, 2)
})

// ---------------------------------------------------------------- the step end to end
test("a concept: the pre-pass, then ONE picture from flare with exactly the image params; the answer's shape; costInUSD includes the picture", async () => {
	const fx = fixture("c1-rube-cup")
	prepassOk(PRE(fx))
	script(FLARE, [{}])
	logs.length = 0
	const out = await runStep("imagine", { text: fx.request }, opts())
	// the pre-pass: the catalog brief in the cacheable system prompt, the request as the user turn
	const chat = gw.requests[0].body
	const sys = chat.messages[0].content
	assert.match(typeof sys === "string" ? sys : sys[0].text, /^You prepare a concept picture for a physics-sandbox scene builder/)
	assert.equal(chat.messages[1].content, `# The request\n"""\n${fx.request}\n"""\n\nAnswer as one JSON object.`)
	// the picture: one call, the plan's body, the fixture's prompt byte for byte, the key as a Bearer token
	assert.equal(images.requests.length, 1)
	const body = images.requests[0].body
	assert.deepEqual(Object.keys(body).sort(), ["model", "n", "output_compression", "output_format", "prompt", "quality", "size"])
	assert.deepEqual([body.model, body.n, body.size, body.quality, body.output_format, body.output_compression], [FLARE, 1, "1536x1024", "high", "jpeg", 85])
	assert.equal(body.prompt, fx.prompt)
	assert.equal(images.requests[0].auth, true)
	// the answer
	const r = out.result
	assert.equal(r.concepts.length, 1)
	assert.deepEqual({ ...r.concepts[0], data: r.concepts[0].data.slice(0, 23) }, { data: "data:image/jpeg;base64,", mime: "image/jpeg", model: FLARE, width: 1536, height: 1024 })
	assert.equal(r.concepts[0].data, `data:image/jpeg;base64,${JPEG}`)
	assert.deepEqual(r.cast, fx.prepass.cast)
	assert.deepEqual([r.missing, r.layout, r.story], [fx.prepass.missing, fx.prepass.layout, fx.prepass.story])
	assert.equal(r.prompt, fx.prompt)
	assert.ok(Number.isFinite(r.ms.prepass) && Number.isFinite(r.ms.image))
	assert.equal(out.model, FLARE)
	assert.ok(Number.isFinite(out.ms))
	assert.deepEqual(out.usage.image, { model: FLARE, output_tokens: 1372, usd_est: 0.05488 })
	assert.ok(Math.abs(out.usage.costInUSD - (0.0431 + 0.05488)) < 1e-9, String(out.usage.costInUSD))
	assert.equal(out.usage.prompt_tokens, 6440)
	assert.deepEqual(out.attempts.map((a) => [a.model, a.ok, !!a.image]), [["p1", true, false], [FLARE, true, true]])
	noKey(out)
	noKey(logs)
})

test("fallbacks: flare 5xx twice -> sunburst; flare timing out -> sunburst; flare 4xx -> sunburst at once", async () => {
	prepassOk()
	script(FLARE, [{ status: 500 }, { status: 502 }])
	script(SUNBURST, [{}])
	let out = await runStep("imagine", { text: "a ball rolls down a ramp into a cup" }, opts())
	assert.deepEqual(imageModels(), [FLARE, FLARE, SUNBURST])
	assert.equal(out.result.concepts[0].model, SUNBURST)
	assert.equal(images.requests[2].body.size, "1536x1024", "sunburst gets the same params")
	assert.match(out.warnings.at(-1), /drawn by openai-group\/gpt-image-2.5-sunburst/)

	images.requests.length = 0
	prepassOk()
	script(FLARE, [{ hang: true }])
	script(SUNBURST, [{}])
	out = await runStep("imagine", { text: "a ball rolls down a ramp into a cup" }, opts())
	assert.deepEqual(imageModels(), [FLARE, SUNBURST], "a timed-out route is not tried again")
	assert.match(out.attempts.find((a) => a.model === FLARE).error, /no picture within/)

	images.requests.length = 0
	prepassOk()
	script(FLARE, [{ status: 400, message: "Your request was rejected by the safety system" }])
	script(SUNBURST, [{}])
	out = await runStep("imagine", { text: "a ball rolls down a ramp into a cup" }, opts())
	assert.deepEqual(imageModels(), [FLARE, SUNBURST])
})

test("both OpenAI routes failing -> Gemini, with its params stripped (a square PNG comes back as it is)", async () => {
	prepassOk()
	script(FLARE, [{ status: 500 }, { status: 500 }])
	script(SUNBURST, [{ status: 503 }, { status: 503 }])
	script(GEMINI, [{ b64: PNG, usage: null }])
	const out = await runStep("imagine", { text: "a ball rolls down a ramp into a cup" }, opts())
	assert.deepEqual(imageModels(), [FLARE, FLARE, SUNBURST, SUNBURST, GEMINI])
	const body = images.requests.at(-1).body
	assert.deepEqual(Object.keys(body).sort(), ["model", "n", "prompt"])
	assert.deepEqual(out.result.concepts[0].mime, "image/png")
	assert.deepEqual([out.result.concepts[0].width, out.result.concepts[0].height], [1024, 1024])
	// no tokens in its answer: the estimate assumes a typical picture, at Gemini's price
	assert.equal(out.usage.image.output_tokens, null)
	assert.ok(out.usage.image.usd_est > 0.1 && out.usage.costInUSD > out.usage.image.usd_est)
})

test("a picture too big to send on (over maxPictureBytes) moves on to the next route at once, without a second try on the same route", async () => {
	prepassOk()
	const big = Buffer.concat([jpeg(1536, 1024), Buffer.alloc(3000, 0x22)]).toString("base64")
	script(FLARE, [{ b64: big }])
	script(SUNBURST, [{}])
	const out = await runStep("imagine", { text: "a ball rolls down a ramp into a cup" }, opts({ routing: routing({ maxPictureBytes: 2000 }) }))
	assert.deepEqual(imageModels(), [FLARE, SUNBURST])
	assert.equal(out.result.concepts[0].model, SUNBURST)
	assert.match(out.attempts.find((a) => a.model === FLARE).error, /too big to send on/)
	assert.equal(imageRoutes("imagine", MODELS).maxPictureBytes, 2.5 * 1048576, "the shipped cap: 2.5 MB (3.3 MB of base64, under Vercel's 4.5 MB answer)")
})

test("a gateway error that names the account (a 403 with its email address) reaches no answer, error or log with the address", async () => {
	const EMAIL = "someone.else+ai@example-team.school"
	const deny = (m) => `User ${EMAIL} is not authorized to access model ${m}`
	// the image route
	prepassOk()
	script(FLARE, [{ status: 403, message: deny(FLARE) }])
	script(SUNBURST, [{}])
	logs.length = 0
	const out = await runStep("imagine", { text: "a ball rolls down a ramp into a cup" }, opts())
	const flare = out.attempts.find((a) => a.model === FLARE)
	assert.equal(flare.error, `User [account] is not authorized to access model ${FLARE}`)
	assert.equal(JSON.stringify(out).includes(EMAIL), false)
	assert.equal(JSON.stringify(logs).includes(EMAIL), false)
	// the pre-pass: every chat route refusing
	gw.reset()
	images.requests.length = 0
	gw.script("p1", [{ status: 403, message: deny("p1") }])
	gw.script("p2", [{ status: 403, message: deny("p2") }])
	const err = await runStep("imagine", { text: "a ball rolls down a ramp into a cup" }, opts()).catch((e) => e)
	assert.ok(err instanceof AIError)
	assert.match(err.message, /^the pre-pass failed: p2: User \[account\] is not authorized/)
	assert.equal(JSON.stringify({ m: err.message, a: err.attempts, logs }).includes(EMAIL), false)
	assert.equal(images.requests.length, 0)
})

test("429 with a short Retry-After waits it out and tries the same route; a long one moves on at once", async () => {
	prepassOk()
	script(FLARE, [{ status: 429, headers: { "retry-after": "1" } }, {}])
	await runStep("imagine", { text: "a ball rolls down a ramp into a cup" }, opts({ backoffScale: 0.2, routing: routing({ maxBackoffMs: 2000 }) }))
	assert.deepEqual(imageModels(), [FLARE, FLARE])
	const gap = images.requests[1].at - images.requests[0].at
	assert.ok(gap >= 150, `waited ${gap} ms (Retry-After 1 s, scaled 0.2)`)

	images.requests.length = 0
	prepassOk()
	script(FLARE, [{ status: 429, headers: { "retry-after": "120" } }])
	script(SUNBURST, [{}])
	const t0 = Date.now()
	await runStep("imagine", { text: "a ball rolls down a ramp into a cup" }, opts())
	assert.deepEqual(imageModels(), [FLARE, SUNBURST])
	assert.ok(Date.now() - t0 < 3000)
})

test("the budget covers the whole step: every route hanging ends with a budget or timeout error inside it, metering the pre-pass", async () => {
	prepassOk()
	script(FLARE, [{ hang: true }])
	script(SUNBURST, [{ hang: true }])
	script(GEMINI, [{ hang: true }])
	const t0 = Date.now()
	const o = opts({ routing: routing({ budgetMs: 1500, timeoutMs: 600 }) })
	const err = await runStep("imagine", { text: "a ball rolls down a ramp into a cup" }, o).catch((e) => e)
	assert.ok(err instanceof AIError)
	assert.ok(["budget", "timeout"].includes(err.code), err.code)
	assert.ok(Date.now() - t0 < 2500, `took ${Date.now() - t0} ms`)
	assert.match(err.message, /^no concept picture: /)
	assert.equal(err.usage.costInUSD, 0.0431, "what the pre-pass cost is still metered")
	assert.ok(err.attempts.some((a) => a.model === "p1" && a.ok))
	noKey({ m: err.message, a: err.attempts })
})

test("abort: a cancelled step stops its picture call at once", async () => {
	prepassOk()
	script(FLARE, [{ hang: true }])
	const ac = new AbortController()
	const p = runStep("imagine", { text: "a ball rolls down a ramp into a cup" }, opts({ signal: ac.signal, routing: routing({ timeoutMs: 5000 }) }))
	while (!images.requests.length) await new Promise((r) => setTimeout(r, 10))
	const t0 = Date.now()
	ac.abort(new Error("client left"))
	const err = await p.catch((e) => e)
	assert.equal(err.code, "aborted")
	assert.ok(Date.now() - t0 < 500)
})

test("payload checks: words only (pictures are a 400), text required, before any model call", async () => {
	const bad = (re) => (e) => e instanceof AIError && e.code === "bad_input" && e.status === 400 && re.test(e.message)
	const IMG = `data:image/jpeg;base64,${JPEG}`
	await assert.rejects(runStep("imagine", {}, opts()), bad(/text is missing/))
	await assert.rejects(runStep("imagine", { text: "  " }, opts()), bad(/text is empty/))
	await assert.rejects(runStep("imagine", { text: 3 }, opts()), bad(/text must be text/))
	await assert.rejects(runStep("imagine", { text: "x".repeat(9000) }, opts()), bad(/too long/))
	await assert.rejects(runStep("imagine", { text: "a ball", images: [IMG] }, opts()), bad(/from words only/))
	await assert.rejects(runStep("imagine", { text: "a ball", image: IMG }, opts()), bad(/from words only/))
	assert.equal(gw.requests.length + images.requests.length, 0)
})

test("a pre-pass that names no catalog key is repaired once; one that cannot be used fails without drawing", async () => {
	gw.script("p1", [{ content: JSON.stringify({ cast: [{ type: "unicorn", count: 1 }], layout: "A unicorn stands on the table." }) }, { content: JSON.stringify(PRE()) }])
	script(FLARE, [{}])
	const out = await runStep("imagine", { text: "a ball rolls down a ramp into a cup" }, opts())
	assert.match(gw.requests[1].body.messages.at(-1).content, /"cast" must list at least one catalog key/)
	assert.equal(out.result.cast[0].type, "steel-ball")

	gw.reset()
	images.requests.length = 0
	gw.fallback = () => ({ content: JSON.stringify({ cast: [], layout: "" }) })
	try {
		const err = await runStep("imagine", { text: "a ball rolls down a ramp into a cup" }, opts()).catch((e) => e)
		assert.equal(err.code, "invalid_output")
		assert.match(err.message, /^the pre-pass failed: /)
		assert.equal(images.requests.length, 0)
	} finally {
		gw.fallback = () => ({ status: 500, body: { error: { message: "no scripted answer" } } })
	}
})

test("the key appears in no answer, error or log line, even when the gateway echoes it", async () => {
	logs.length = 0
	prepassOk()
	script(FLARE, [{ status: 401, message: `Invalid API key: ${FAKE_KEY} (Bearer ${FAKE_KEY})` }])
	script(SUNBURST, [{ status: 403, message: `key ${FAKE_KEY} may not use this model` }])
	script(GEMINI, [{ status: 500, message: `upstream said Authorization: Bearer ${FAKE_KEY}` }, { status: 500, message: FAKE_KEY }])
	const err = await runStep("imagine", { text: "a ball rolls down a ramp into a cup" }, opts()).catch((e) => e)
	assert.equal(err.code, "gateway")
	assert.equal(images.requests.every((r) => r.auth), true, "the key went to the gateway as a Bearer token")
	noKey({ message: err.message, attempts: err.attempts, usage: err.usage })
	assert.ok(logs.length >= 3)
	noKey(logs)
	// and on success
	prepassOk()
	script(FLARE, [{}])
	noKey(await runStep("imagine", { text: "a ball rolls down a ramp into a cup" }, opts()))
})

test("pictureInfo reads type and size from JPEG, PNG and GIF headers", () => {
	assert.deepEqual(pictureInfo(jpeg(1536, 1024)), { mime: "image/jpeg", width: 1536, height: 1024 })
	assert.deepEqual(pictureInfo(png(1024, 1024)), { mime: "image/png", width: 1024, height: 1024 })
	assert.deepEqual(pictureInfo(Buffer.from("GIF89a\x10\x00\x20\x00\x00\x00\x00\x00", "latin1")), { mime: "image/gif", width: 16, height: 32 })
	assert.equal(pictureInfo(Buffer.from("not a picture at all")).mime, null)
})

test("imagine() runs on its own too (no steps.mjs): the same answer", async () => {
	prepassOk()
	script(FLARE, [{}])
	const out = await imagine({ text: "a ball rolls down a ramp into a cup" }, opts())
	assert.equal(out.result.concepts.length, 1)
})
