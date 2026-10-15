// ai/core.mjs against a mock gateway: routing, retries, fallback, param stripping, timeouts, budget, abort, JSON extraction, the repair
// retry, and that the key never shows up in what comes back.   node --test "ai/test/*.test.mjs"
import assert from "node:assert/strict"
import { after, before, beforeEach, test } from "node:test"
import { AIError, buildMessages, callModel, extractJson, gatewayUrl, routeFor } from "../core.mjs"
import { FAKE_KEY, mockEnv, startMockGateway, testRouting } from "./mock-gateway.mjs"

let gw
before(async () => {
	gw = await startMockGateway()
})
after(async () => {
	await gw.close()
})
beforeEach(() => gw.reset())

const okValidate = (v) => (v.ok === true ? { ok: true, errors: [], warnings: [], value: v } : { ok: false, errors: ["ok must be true"], warnings: [] })
const run = (over = {}, routing = testRouting()) =>
	callModel("test", { system: "sys", content: "hello", validate: okValidate, env: mockEnv(gw), routing, backoffScale: 0.01, ...over })

test("a good first answer: result, model, usage, the key sent as a Bearer token, params passed", async () => {
	gw.script("m1", [{ content: '{"ok": true, "n": 1}', usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10, costInUSD: 0.5 } }])
	const out = await run()
	assert.deepEqual(out.result, { ok: true, n: 1 })
	assert.equal(out.model, "m1")
	assert.equal(out.attempts.length, 1)
	assert.equal(out.usage.prompt_tokens, 7)
	assert.equal(out.usage.costInUSD, 0.5)
	const r = gw.requests[0]
	assert.equal(r.auth, true)
	assert.equal(r.body.model, "m1")
	assert.equal(r.body.max_tokens, 100)
	assert.equal(r.body.messages[0].role, "system")
	assert.equal(r.body.messages[1].content, "hello")
})

test("429 then success: retried on the same route (Retry-After honoured)", async () => {
	gw.script("m1", [{ status: 429, headers: { "retry-after": "0" } }, { content: '{"ok": true}' }])
	const out = await run()
	assert.equal(out.model, "m1")
	assert.equal(gw.forModel("m1").length, 2)
	assert.equal(out.attempts[0].status, 429)
	assert.equal(out.attempts[1].ok, true)
})

test("5xx until the retries run out: falls back to the next route", async () => {
	gw.script("m1", [{ status: 503 }, { status: 502 }, { status: 500 }])
	gw.script("m2", [{ content: '{"ok": true}' }])
	const out = await run()
	assert.equal(out.model, "m2")
	assert.equal(gw.forModel("m1").length, 3) // 1 + 2 retries
	assert.equal(out.attempts.length, 4)
})

test("a non-retryable 4xx moves to the next route at once", async () => {
	gw.script("m1", [{ status: 404, message: "model not found" }])
	gw.script("m2", [{ content: '{"ok": true}' }])
	const out = await run()
	assert.equal(out.model, "m2")
	assert.equal(gw.forModel("m1").length, 1)
})

test("a 400 naming a rejected param drops it and retries the same route", async () => {
	gw.script("m1", [{ status: 400, message: "anthropic error: `temperature` is deprecated for this model." }, { content: '{"ok": true}' }])
	const out = await run()
	assert.equal(out.model, "m1")
	const [a, b] = gw.forModel("m1")
	assert.equal(a.body.temperature, 0.2)
	assert.equal("temperature" in b.body, false)
})

test("a route's drop list keeps params it rejects out of the request", async () => {
	const routing = testRouting()
	routing.models.m1.drop = ["temperature"]
	gw.script("m1", [{ content: '{"ok": true}' }])
	await run({}, routing)
	assert.equal("temperature" in gw.requests[0].body, false)
})

test("an attempt that takes longer than timeoutMs is cut off and retried, then falls back", async () => {
	gw.script("m1", [{ hang: true }, { hang: true }, { hang: true }])
	gw.script("m2", [{ content: '{"ok": true}' }])
	const t0 = Date.now()
	const out = await run({}, testRouting({ timeoutMs: 200, budgetMs: 5000 }))
	assert.equal(out.model, "m2")
	assert.equal(out.attempts.filter((a) => a.status === 504).length, 3)
	assert.ok(Date.now() - t0 < 3000)
})

test("every route hanging: a timeout error within the budget", async () => {
	gw.fallback = () => ({ hang: true })
	try {
		const t0 = Date.now()
		await assert.rejects(run({}, testRouting({ timeoutMs: 150, budgetMs: 1200 })), (e) => e instanceof AIError && ["timeout", "budget"].includes(e.code) && e.status === 504 && e.retryable)
		assert.ok(Date.now() - t0 < 2500, "stayed within the budget")
	} finally {
		gw.fallback = () => ({ status: 500, body: { error: { message: "no scripted answer" } } })
	}
})

test("abort: the in-flight request is dropped at once and nothing else is tried", async () => {
	gw.script("m1", [{ hang: true }])
	gw.script("m2", [{ content: '{"ok": true}' }])
	const ac = new AbortController()
	setTimeout(() => ac.abort(), 100)
	const t0 = Date.now()
	await assert.rejects(run({ signal: ac.signal }), (e) => e instanceof AIError && e.code === "aborted")
	assert.ok(Date.now() - t0 < 1000)
	await new Promise((r) => setTimeout(r, 100))
	assert.equal(gw.forModel("m2").length, 0)
})

test("abort during a backoff wait stops at once; an already-aborted signal sends nothing", async () => {
	gw.script("m1", [{ status: 503 }])
	const routing = testRouting({ backoffMs: 3000, maxBackoffMs: 3000 })
	const ac = new AbortController()
	setTimeout(() => ac.abort(), 150)
	const t0 = Date.now()
	await assert.rejects(run({ signal: ac.signal, backoffScale: 1 }, routing), (e) => e.code === "aborted")
	assert.ok(Date.now() - t0 < 1000, "did not sit out the backoff")
	assert.equal(gw.requests.length, 1)
	gw.reset()
	await assert.rejects(run({ signal: AbortSignal.abort() }), (e) => e.code === "aborted")
	assert.equal(gw.requests.length, 0)
})

test("invalid output: ONE repair that shows the model its errors, then success", async () => {
	gw.script("m1", [{ content: '{"ok": false}' }, { content: '```json\n{"ok": true, "fixed": 1}\n```' }])
	const out = await run()
	assert.equal(out.model, "m1")
	assert.equal(out.repaired, true)
	assert.deepEqual(out.result, { ok: true, fixed: 1 })
	const rep = gw.forModel("m1")[1].body.messages
	assert.equal(rep.at(-2).role, "assistant")
	assert.equal(rep.at(-2).content, '{"ok": false}')
	assert.match(rep.at(-1).content, /ok must be true/)
	assert.match(rep.at(-1).content, /complete corrected JSON/)
})

test("still invalid after the repair: the next route gets a fresh try (no second repair)", async () => {
	gw.script("m1", [{ content: '{"ok": false}' }, { content: '{"ok": false}' }])
	gw.script("m2", [{ content: '{"ok": true}' }])
	const out = await run()
	assert.equal(out.model, "m2")
	assert.equal(gw.forModel("m1").length, 2)
	assert.equal(gw.forModel("m2").length, 1)
})

test("invalid everywhere: invalid_output with the validation errors as details", async () => {
	gw.fallback = () => ({ content: '{"ok": false}' })
	try {
		await assert.rejects(run(), (e) => e.code === "invalid_output" && e.status === 502 && Array.isArray(e.details) && e.details.includes("ok must be true"))
		assert.equal(gw.requests.length, 4) // m1 + its repair, m2, m3
	} finally {
		gw.fallback = () => ({ status: 500, body: { error: { message: "no scripted answer" } } })
	}
})

test("not JSON at all counts as invalid and is repaired", async () => {
	gw.script("m1", [{ content: "Sure! Here is the plan you asked for." }, { content: '{"ok": true}' }])
	const out = await run()
	assert.equal(out.repaired, true)
	assert.match(gw.forModel("m1")[1].body.messages.at(-1).content, /no JSON object/)
})

test("an answer cut off at max_tokens is asked again with twice the room", async () => {
	gw.script("m1", [{ content: '{"ok": tr', finish: "length" }, { content: '{"ok": true}' }])
	const out = await run()
	assert.equal(out.model, "m1")
	assert.equal(gw.forModel("m1")[1].body.max_tokens, 200)
})

test("an answer that hit max_tokens but is complete and valid is kept", async () => {
	gw.script("m1", [{ content: '{"ok": true}', finish: "length" }])
	const out = await run()
	assert.deepEqual(out.result, { ok: true })
	assert.equal(gw.requests.length, 1)
})

test("no key: a config error, nothing sent", async () => {
	await assert.rejects(callModel("test", { content: "x", env: { AI_GATEWAY_URL: gw.url }, routing: testRouting() }), (e) => e.code === "config" && e.status === 500)
	assert.equal(gw.requests.length, 0)
})

test("the key never appears in an error, even when the gateway echoes it", async () => {
	gw.fallback = () => ({ status: 401, message: `invalid bearer token Bearer ${FAKE_KEY} (key ${FAKE_KEY})` })
	try {
		const e = await run().catch((x) => x)
		assert.ok(e instanceof AIError)
		const text = JSON.stringify({ m: e.message, a: e.attempts })
		assert.equal(text.includes(FAKE_KEY), false)
		assert.match(text, /redacted/)
	} finally {
		gw.fallback = () => ({ status: 500, body: { error: { message: "no scripted answer" } } })
	}
})

test("pictures skip the routes that cannot see", async () => {
	const routing = testRouting({ model: "blind", fallbacks: ["m2"] })
	gw.script("m2", [{ content: '{"ok": true}' }])
	const out = await run({ images: ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="] }, routing)
	assert.equal(out.model, "m2")
	assert.equal(gw.forModel("blind").length, 0)
	const content = gw.requests[0].body.messages[1].content
	assert.equal(content[1].type, "image_url")
})

test("prompt caching: a route with cache: true sends the system prompt as a cacheable block", async () => {
	const routing = testRouting()
	routing.models.m1.cache = true
	gw.script("m1", [{ content: '{"ok": true}' }])
	await run({}, routing)
	const sys = gw.requests[0].body.messages[0].content
	assert.equal(sys[0].cache_control.type, "ephemeral")
	assert.equal(sys[0].text, "sys")
})

test("AI_GATEWAY_URL may only point at this machine", () => {
	assert.throws(() => gatewayUrl({ AI_GATEWAY_URL: "https://evil.example.com/v1" }), (e) => e.code === "config")
	assert.equal(gatewayUrl({ AI_GATEWAY_URL: "http://127.0.0.1:9/v1" }), "http://127.0.0.1:9/v1")
	assert.equal(gatewayUrl({ TRUEFOUNDRY_BASE_URL: "https://tfy.example/v1" }), "https://tfy.example/v1")
})

test("extractJson: plain, fenced, wrapped in prose, braces inside strings, trailing commas", () => {
	assert.deepEqual(extractJson('{"a": 1}'), { a: 1 })
	assert.deepEqual(extractJson('Here:\n```json\n{"a": {"b": [1, 2]}}\n```\nDone.'), { a: { b: [1, 2] } })
	assert.deepEqual(extractJson('I think {"note": "use } and { freely", "x": 2} is right'), { note: "use } and { freely", x: 2 })
	assert.deepEqual(extractJson('{"a": [1, 2,], "b": 3,}'), { a: [1, 2], b: 3 })
	assert.throws(() => extractJson("no json here"), /no JSON object/)
	assert.throws(() => extractJson(""), /empty/)
})

test("routeFor: fallbacks deduplicated, per-fallback params, step settings", () => {
	const r = routeFor("plan", {
		defaults: { retries: 1 },
		models: { a: { cache: true } },
		steps: { plan: { model: "a", fallbacks: ["a", { model: "b", params: { reasoning_effort: "low" } }], params: { max_tokens: 9, reasoning_effort: "high" }, timeoutMs: 5, budgetMs: 9 } }
	})
	assert.deepEqual(r.routes.map((x) => x.model), ["a", "b"])
	assert.equal(r.routes[1].params.reasoning_effort, "low")
	assert.equal(r.routes[1].params.max_tokens, 9)
	assert.equal(r.routes[0].quirks.cache, true)
	assert.equal(r.retries, 1)
	assert.throws(() => routeFor("nope", { steps: {} }), (e) => e.code === "config")
})

test("buildMessages: system + text + pictures; given messages pass through", () => {
	const m = buildMessages({ system: "S", content: "T", images: ["data:image/png;base64,AAAA", { data: "data:image/jpeg;base64,BBBB" }] })
	assert.equal(m[0].content, "S")
	assert.equal(m[1].content.length, 3)
	assert.equal(m[1].content[2].image_url.url, "data:image/jpeg;base64,BBBB")
	const given = [{ role: "user", content: "x" }]
	assert.equal(buildMessages({ messages: given }), given)
})

// ---------------------------------------------------------------- streaming, the idle timer, progress (2026-10-15 repair)
const streaming = (over = {}) => {
	const r = testRouting({ stream: true, ...over })
	for (const m of ["m1", "m2", "m3"]) r.models[m] = { ...r.models[m], stream: true }
	return r
}

test("streaming: the answer is put together from its events; usage, model and progress come through", async () => {
	gw.script("m1", [{ content: '{"ok": true, "n": 42}', thinking: 4, chunkDelayMs: 2, usage: { prompt_tokens: 9, completion_tokens: 30, total_tokens: 39, costInUSD: 0.25 } }])
	const seen = []
	const out = await run({ onProgress: (p) => seen.push(p) }, streaming())
	assert.deepEqual(out.result, { ok: true, n: 42 })
	assert.equal(out.model, "m1")
	assert.equal(out.usage.costInUSD, 0.25)
	assert.equal(gw.requests[0].body.stream, true)
	assert.deepEqual(gw.requests[0].body.stream_options, { include_usage: true })
	for (const p of seen) assert.ok(p.step === "test" && p.model === "m1" && Number.isFinite(p.tokens) && ["thinking", "writing"].includes(p.phase))
})

test("streaming: a route that goes quiet is dropped after idleTimeoutMs, well before timeoutMs, and the next try answers", async () => {
	gw.script("m1", [{ content: '{"ok": true}', stall: 2 }, { content: '{"ok": true, "second": 1}' }])
	const t0 = Date.now()
	const out = await run({}, streaming({ timeoutMs: 5000, idleTimeoutMs: 250, budgetMs: 15000 }))
	assert.deepEqual(out.result, { ok: true, second: 1 })
	assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0} ms`)
	assert.equal(out.attempts[0].ok, false)
	assert.match(out.attempts[0].error, /no progress for/)
})

test("streaming only on routes that stream their thinking (quirk stream: true); a JSON answer to a stream request is read as before", async () => {
	const r = testRouting({ stream: true })
	r.models.m1 = { ...r.models.m1, stream: true }
	gw.script("m1", [{ content: '{"ok": true}', plain: true }])
	const out = await run({}, r)
	assert.deepEqual(out.result, { ok: true })
	assert.equal(gw.requests[0].body.stream, true)
	gw.reset()
	gw.script("m1", [{ status: 503 }, { status: 503 }, { status: 503 }])
	gw.script("m2", [{ content: '{"ok": true}' }])
	await run({}, r)
	assert.equal(gw.forModel("m2")[0].body.stream, undefined, "m2 has no stream quirk: called plainly")
})

test("a 400 that rejects streaming retries the same route plainly", async () => {
	gw.script("m1", [{ status: 400, message: "stream_options is not supported for this model" }, { content: '{"ok": true}' }])
	const out = await run({}, streaming())
	assert.equal(out.model, "m1")
	assert.equal(gw.forModel("m1")[1].body.stream, undefined)
})

// ---------------------------------------------------------------- soft problems: one repair, never the cost of a usable answer
const softValidate = (v) => (v.ok !== true ? { ok: false, errors: ["ok must be true"], warnings: [] } : { ok: true, errors: [], soft: v.better ? [] : ["it could be better"], warnings: [], value: v })

test("soft: a usable answer with a soft problem gets the one repair, and the better answer is taken", async () => {
	gw.script("m1", [{ content: '{"ok": true}' }, { content: '{"ok": true, "better": true}' }])
	const out = await run({ validate: softValidate }, testRouting({ budgetMs: 200000, timeoutMs: 1500 }))
	assert.deepEqual(out.result, { ok: true, better: true })
	assert.equal(out.repaired, true)
	assert.match(gw.forModel("m1")[1].body.messages.at(-1).content, /it could be better/)
})

test("soft: a repair that breaks a usable answer falls back to it, with the soft problem as a warning", async () => {
	gw.script("m1", [{ content: '{"ok": true}' }, { content: '{"ok": false}' }])
	const out = await run({ validate: softValidate }, testRouting({ budgetMs: 200000, timeoutMs: 1500 }))
	assert.deepEqual(out.result, { ok: true })
	assert.ok(out.warnings.some((w) => /not fixed: it could be better/.test(w)))
	assert.equal(gw.forModel("m2").length, 0, "no other route was tried")
})

test("soft: without time for a whole extra answer (min(timeoutMs, 60 s)) the usable answer is kept at once (no repair)", async () => {
	gw.script("m1", [{ content: '{"ok": true}' }])
	const out = await run({ validate: softValidate }, testRouting({ budgetMs: 1200, timeoutMs: 1500 }))
	assert.deepEqual(out.result, { ok: true })
	assert.equal(gw.forModel("m1").length, 1)
	assert.ok(out.warnings.some((w) => /not fixed/.test(w)))
})

test("prompt caching for an hour: a route with cacheTtl sends ttl 1h; a route that rejects it is asked again with the default lifetime", async () => {
	const routing = testRouting()
	Object.assign(routing.models.m1, { cache: true, cacheTtl: "1h" })
	gw.script("m1", [{ content: '{"ok": true}' }])
	await run({}, routing)
	assert.deepEqual(gw.requests[0].body.messages[0].content[0].cache_control, { type: "ephemeral", ttl: "1h" })
	gw.reset()
	gw.script("m1", [{ status: 400, message: "cache_control.ttl: unknown field" }, { content: '{"ok": true}' }])
	const out = await run({}, routing)
	assert.equal(out.model, "m1")
	assert.deepEqual(gw.requests[1].body.messages[0].content[0].cache_control, { type: "ephemeral" })
})

test("budgetMs caps the step's own budget (a host's time limit): the call gives up in time", async () => {
	gw.fallback = () => ({ hang: true })
	try {
		const t0 = Date.now()
		await assert.rejects(run({ budgetMs: 400 }, testRouting({ timeoutMs: 5000, budgetMs: 20000 })), (e) => e.code === "timeout" || e.code === "budget")
		assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0} ms`)
	} finally {
		gw.fallback = () => ({ status: 500, body: { error: { message: "no scripted answer" } } })
	}
})
