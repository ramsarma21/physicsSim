// api/ai/[step].mjs (the Vercel twin) called the way Vercel's Node runtime calls it, against the mock gateway: the same checks and answers as
// the local server, plus the hosted protections (origin and access fail closed on Vercel, the invite cookie, the preview token), the time cap,
// the streamed answer with heartbeats, and the per-instance queue.
import assert from "node:assert/strict"
import { Readable } from "node:stream"
import { after, before, beforeEach, test } from "node:test"
import { FAKE_KEY, startMockGateway, testRouting } from "./mock-gateway.mjs"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let gw, handler, twin, dir
const HOSTED = ["VERCEL", "VERCEL_ENV", "VERCEL_URL", "VERCEL_BRANCH_URL", "VERCEL_PROJECT_PRODUCTION_URL", "ALLOWED_ORIGINS", "AI_ACCESS_TOKEN", "AI_SESSION_SECRET", "AI_INVITE_CODES", "AI_SLOTS", "AI_QUEUE_WAIT"]
before(async () => {
	gw = await startMockGateway()
	dir = mkdtempSync(join(tmpdir(), "ai-vercel-"))
	writeFileSync(join(dir, "models.json"), JSON.stringify(testRouting({ timeoutMs: 500, budgetMs: 2000, backoffMs: 10 })))
	Object.assign(process.env, { TRUEFOUNDRY_API_KEY: FAKE_KEY, AI_GATEWAY_URL: gw.url, AI_MODELS: join(dir, "models.json") })
	twin = await import("../../api/ai/[step].mjs")
	handler = twin.default
})
after(async () => {
	for (const k of ["TRUEFOUNDRY_API_KEY", "AI_GATEWAY_URL", "AI_MODELS", ...HOSTED]) delete process.env[k]
	await gw.close()
	rmSync(dir, { recursive: true, force: true })
})
beforeEach(() => {
	gw.reset()
	for (const k of HOSTED) delete process.env[k]
})
const withEnv = async (env, fn) => {
	Object.assign(process.env, env)
	try {
		return await fn()
	} finally {
		for (const k of Object.keys(env)) delete process.env[k]
	}
}

function call(step, { method = "POST", body, headers = {}, url } = {}) {
	const raw = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body)
	const req = Readable.from(raw ? [Buffer.from(raw)] : [])
	const u = new URL(url ?? `/api/ai/${step}`, "http://x")
	Object.assign(req, { method, url: u.pathname + u.search, query: { step, ...Object.fromEntries(u.searchParams) }, headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(raw)), ...headers } })
	return new Promise((resolve) => {
		let streamed = ""
		const res = {
			statusCode: 200,
			headers: {},
			writableEnded: false,
			destroyed: false,
			setHeader(k, v) {
				this.headers[k.toLowerCase()] = v
			},
			flushHeaders() {},
			write(t) {
				streamed += t
				return true
			},
			end(text) {
				this.writableEnded = true
				const all = streamed + (text ?? "")
				assert.equal(all.includes(FAKE_KEY), false)
				let json = null
				try {
					json = JSON.parse(all)
				} catch {}
				resolve({ status: this.statusCode, json, text: all, headers: this.headers })
			}
		}
		handler(req, res)
	})
}
const EDIT = { payload: { text: "hi", scene: { items: [{ id: "table", type: "table", x: 1.3, y: 0 }] } }, client: { requestId: "r1" } }
const NOTHING = { content: JSON.stringify({ kind: "answer", targets: [], mode: "patch", reply: "Nothing to change.", patches: [] }) }

test("method, step and body checks", async () => {
	assert.equal((await call("plan", { method: "GET" })).status, 405)
	assert.equal((await call("dance", { body: { payload: {} } })).status, 404)
	assert.equal((await call("plan", { body: "{nope" })).status, 400)
	assert.equal((await call("plan", { body: { text: "x" } })).status, 400)
	const r = await call("plan", { body: { payload: {} } })
	assert.equal(r.status, 400)
	assert.match(r.json.error, /text is missing/)
	assert.equal((await call("plan", { body: { payload: {} }, headers: { "content-length": String(13 << 20) } })).status, 413)
	assert.equal((await call("plan", { body: { payload: { text: "x" } }, headers: { "content-type": "text/plain" } })).status, 415)
	assert.equal(gw.requests.length, 0)
})

test("an allowed-origins list refuses other origins", async () => {
	await withEnv({ ALLOWED_ORIGINS: "https://good.example" }, async () => {
		assert.equal((await call("plan", { body: { payload: { text: "x" } }, headers: { origin: "https://evil.example" } })).status, 403)
	})
})

test("a good answer and a failing gateway, same shapes as the local server", async () => {
	gw.script("m1", [NOTHING])
	let r = await call("edit", { body: EDIT })
	assert.equal(r.status, 200)
	assert.equal(r.json.ok, true)
	assert.equal(r.json.requestId, "r1")
	assert.equal(r.headers["cache-control"], "no-store")
	gw.fallback = () => ({ status: 503 })
	try {
		r = await call("plan", { body: { payload: { text: "a ball" } } })
		assert.equal(r.status, 502)
		assert.equal(r.json.code, "gateway")
	} finally {
		gw.fallback = () => ({ status: 500, body: { error: { message: "no scripted answer" } } })
	}
})

test("on Vercel the origin check fails closed: no Origin, another site, or a cross-site fetch is refused; the deployment's own URL gets through", async () => {
	await withEnv({ VERCEL: "1", VERCEL_ENV: "preview", VERCEL_URL: "sandbox-abc.vercel.app", AI_ACCESS_TOKEN: "preview-token-0123456789" }, async () => {
		const ok = { origin: "https://sandbox-abc.vercel.app", "sec-fetch-site": "same-origin", "x-ai-access": "preview-token-0123456789" }
		assert.equal((await call("edit", { body: EDIT, headers: { ...ok, origin: undefined } })).status, 403)
		assert.equal((await call("edit", { body: EDIT, headers: { ...ok, origin: "https://evil.example" } })).status, 403)
		assert.equal((await call("edit", { body: EDIT, headers: { ...ok, "sec-fetch-site": "cross-site" } })).status, 403)
		assert.equal(gw.requests.length, 0)
		gw.script("m1", [NOTHING])
		assert.equal((await call("edit", { body: EDIT, headers: ok })).status, 200)
	})
})

test("on Vercel access fails closed: nothing configured -> 503; the preview token only on a preview; a wrong token -> 401", async () => {
	const own = { origin: "https://sandbox-abc.vercel.app" }
	await withEnv({ VERCEL: "1", VERCEL_ENV: "preview", VERCEL_URL: "sandbox-abc.vercel.app" }, async () => {
		const r = await call("edit", { body: EDIT, headers: own })
		assert.equal(r.status, 503)
		assert.equal(r.json.code, "not_configured")
	})
	await withEnv({ VERCEL: "1", VERCEL_ENV: "preview", VERCEL_URL: "sandbox-abc.vercel.app", AI_ACCESS_TOKEN: "preview-token-0123456789" }, async () => {
		assert.equal((await call("edit", { body: EDIT, headers: { ...own, "x-ai-access": "wrong-token-0123456789x" } })).status, 401)
		assert.equal((await call("edit", { body: EDIT, headers: own })).status, 401)
	})
	await withEnv({ VERCEL: "1", VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "sandbox.example.com", AI_ACCESS_TOKEN: "preview-token-0123456789" }, async () => {
		const r = await call("edit", { body: EDIT, headers: { origin: "https://sandbox.example.com", "x-ai-access": "preview-token-0123456789" } })
		assert.equal(r.status, 503, "a token in the page is never enough in production")
	})
	assert.equal(gw.requests.length, 0)
})

test("the invite link sets a signed HttpOnly cookie that lets the page in; a forged or expired one does not", async () => {
	const env = { VERCEL: "1", VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "sandbox.example.com", AI_SESSION_SECRET: "s".repeat(40), AI_INVITE_CODES: "investor-2026-abcdef,other-code-123456" }
	await withEnv(env, async () => {
		assert.equal((await call("session", { method: "GET", url: "/api/ai/session?invite=nope" })).status, 401)
		const r = await call("session", { method: "GET", url: "/api/ai/session?invite=investor-2026-abcdef" })
		assert.equal(r.status, 303)
		assert.equal(r.headers.location, "/")
		const set = r.headers["set-cookie"]
		assert.match(set, /^ai_session=[^;]+; Path=\/api\/ai; Max-Age=259200; HttpOnly; Secure; SameSite=Strict$/)
		const cookie = set.split(";")[0]
		const own = { origin: "https://sandbox.example.com", cookie }
		gw.script("m1", [NOTHING])
		assert.equal((await call("edit", { body: EDIT, headers: own })).status, 200)
		const [b, mac] = decodeURIComponent(cookie.split("=")[1]).split(".")
		const forged = Buffer.from(JSON.stringify({ exp: 9e9, n: "x" })).toString("base64url")
		assert.equal((await call("edit", { body: EDIT, headers: { ...own, cookie: `ai_session=${forged}.${mac}` } })).status, 401)
		assert.equal(twin.sessionValid(`${b}.${mac}`, env.AI_SESSION_SECRET, Date.now() + 73 * 3600 * 1000), false, "expired after its hours")
	})
	await withEnv({ AI_SESSION_SECRET: "s".repeat(40) }, async () => {
		assert.equal((await call("session", { method: "GET", url: "/api/ai/session?invite=x" })).status, 404, "no invite codes, no invite links")
	})
})

test("Accept: application/x-ndjson streams start, progress and the answer as lines (the HTTP status inside the last line)", async () => {
	// a route that streams its thinking (models.json quirk stream: true), so there is progress to pass on
	const streaming = testRouting({ timeoutMs: 3000, budgetMs: 5000, backoffMs: 10, stream: true })
	streaming.models.m1.stream = true
	writeFileSync(join(dir, "models-stream.json"), JSON.stringify(streaming))
	process.env.AI_MODELS = join(dir, "models-stream.json")
	gw.script("m1", [{ ...NOTHING, thinking: 30, chunkDelayMs: 50 }])
	const r = await call("edit", { body: EDIT, headers: { accept: "application/x-ndjson" } }).finally(() => (process.env.AI_MODELS = join(dir, "models.json")))
	assert.equal(r.status, 200)
	assert.equal(r.headers["content-type"], "application/x-ndjson")
	const lines = r.text.trim().split("\n").map((l) => JSON.parse(l))
	assert.equal(lines[0].type, "start")
	assert.ok(lines.some((l) => l.type === "progress" && l.tokens > 0), r.text)
	const last = lines.at(-1)
	assert.deepEqual([last.type, last.status, last.ok, last.result.reply], ["result", 200, true, "Nothing to change."])
	gw.fallback = () => ({ status: 503 })
	try {
		const f = await call("plan", { body: { payload: { text: "a ball" } }, headers: { accept: "application/x-ndjson" } })
		const end = JSON.parse(f.text.trim().split("\n").at(-1))
		assert.deepEqual([f.status, end.type, end.ok, end.status, end.code], [200, "result", false, 502, "gateway"])
	} finally {
		gw.fallback = () => ({ status: 500, body: { error: { message: "no scripted answer" } } })
	}
})

test("the instance's queue: a step over the slots waits, then is told busy {busy, position, retryAfterMs} with Retry-After", async () => {
	await withEnv({ AI_SLOTS: "1", AI_QUEUE_WAIT: "0.3" }, async () => {
		gw.fallback = () => ({ hang: true })
		try {
			const hog = call("plan", { body: { payload: { text: "a ball" } } })
			await new Promise((r) => setTimeout(r, 100))
			const r = await call("plan", { body: { payload: { text: "another" } } })
			assert.equal(r.status, 429)
			assert.deepEqual([r.json.code, r.json.busy, r.json.position, r.json.retryable], ["busy", true, 1, true])
			assert.equal(r.headers["retry-after"], String(Math.ceil(r.json.retryAfterMs / 1000)))
			assert.equal((await hog).status, 504)
			assert.equal(twin._queue.busy, 0)
		} finally {
			gw.fallback = () => ({ status: 500, body: { error: { message: "no scripted answer" } } })
		}
	})
})
