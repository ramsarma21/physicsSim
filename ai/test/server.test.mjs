// web/server.py's POST /api/ai/<step> through its real command (zsh -c 'source ~/.config/truefoundry/env && exec node ai/cli.mjs'),
// with HOME pointing at a temp dir holding a FAKE key and the mock gateway's URL (the real key is never involved). The harness runs ONE AI
// slot and a 1.5 s queue wait (AI_SLOTS, AI_QUEUE_WAIT), so the queue, its busy answer and the progress endpoint can be seen.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { connect } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { after, before, beforeEach, test } from "node:test"
import { FAKE_KEY, startMockGateway, testRouting } from "./mock-gateway.mjs"

const HARNESS = fileURLToPath(new URL("./server_harness.py", import.meta.url))
let gw
let home
let srv
let base
before(async () => {
	gw = await startMockGateway()
	home = mkdtempSync(join(tmpdir(), "ai-server-"))
	mkdirSync(join(home, ".config", "truefoundry"), { recursive: true })
	writeFileSync(join(home, ".config", "truefoundry", "env"), `export TRUEFOUNDRY_API_KEY=${FAKE_KEY}\nexport TRUEFOUNDRY_BASE_URL=${gw.url}\n`)
	writeFileSync(join(home, "models.json"), JSON.stringify(testRouting({ timeoutMs: 600, budgetMs: 2500, backoffMs: 10 })))
	srv = spawn("python3", [HARNESS], { env: { PATH: process.env.PATH, HOME: home, AI_MODELS: join(home, "models.json"), AI_CACHE_DIR: home, AI_SLOTS: "1", AI_QUEUE_WAIT: "1.5" }, stdio: ["ignore", "pipe", "pipe"] })
	let err = ""
	srv.stderr.on("data", (c) => (err += c))
	const port = await new Promise((resolve, reject) => {
		srv.stdout.once("data", (c) => resolve(Number(String(c).trim())))
		srv.once("exit", (code) => reject(new Error(`harness exited ${code}: ${err}`)))
	})
	base = `http://127.0.0.1:${port}`
})
after(async () => {
	srv?.kill("SIGTERM")
	await gw.close()
	rmSync(home, { recursive: true, force: true })
})
beforeEach(() => gw.reset())

const post = async (path, body, init = {}) => {
	const r = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body), ...init })
	const text = await r.text()
	assert.equal(text.includes(FAKE_KEY), false, "the key is not in the answer")
	return { status: r.status, json: JSON.parse(text) }
}

test("the server's other routes still answer (GET /api/catalog)", async () => {
	const r = await fetch(base + "/api/catalog")
	assert.equal(r.status, 200)
	assert.ok((await r.json()).types.length >= 100)
})

test("unknown step 404; not JSON / no payload 400; too large 413 — before any process starts", async () => {
	let r = await post("/api/ai/dance", { payload: {} })
	assert.equal(r.status, 404)
	assert.equal(r.json.ok, false)
	r = await post("/api/ai/plan", "{nope")
	assert.equal(r.status, 400)
	r = await post("/api/ai/plan", { text: "no payload wrapper" })
	assert.equal(r.status, 400)
	assert.match(r.json.error, /\{payload/)
	const raw = await new Promise((resolve) => {
		const u = new URL(base)
		const s = connect(Number(u.port), "127.0.0.1", () => s.write(`POST /api/ai/observe HTTP/1.1\r\nHost: 127.0.0.1:${u.port}\r\nContent-Type: application/json\r\nContent-Length: ${13 << 20}\r\n\r\n`))
		let got = ""
		s.on("data", (c) => (got += c))
		s.on("close", () => resolve(got))
		s.on("error", () => resolve(got))
	})
	assert.match(raw, /^HTTP\/1\.\d 413/)
	assert.match(raw, /too large/)
	assert.equal(gw.requests.length, 0)
})

test("the step's own 400 comes back as a 400 (the payload is checked in the process)", async () => {
	const r = await post("/api/ai/plan", { payload: {} })
	assert.equal(r.status, 400)
	assert.equal(r.json.code, "bad_input")
	assert.match(r.json.error, /text is missing/)
})

test("a good answer: 200 {ok, result, model, ms, usage}; the key reached the gateway as a Bearer token", async () => {
	gw.script("m1", [{ content: JSON.stringify({ kind: "answer", targets: [], mode: "patch", reply: "Nothing to change.", patches: [] }) }])
	const r = await post("/api/ai/edit", { payload: { text: "hi", scene: { items: [{ id: "table", type: "table", x: 1.3, y: 0 }] } }, client: { requestId: "abc" } })
	assert.equal(r.status, 200, JSON.stringify(r.json))
	assert.equal(r.json.ok, true)
	assert.equal(r.json.result.reply, "Nothing to change.")
	assert.equal(r.json.requestId, "abc")
	assert.equal(gw.requests[0].auth, true)
})

test("the models failing is a 502; running out of time a 504", async () => {
	gw.fallback = () => ({ status: 503 })
	try {
		let r = await post("/api/ai/plan", { payload: { text: "a ball" } })
		assert.equal(r.status, 502)
		assert.equal(r.json.code, "gateway")
		assert.equal(r.json.retryable, true)
		gw.fallback = () => ({ hang: true })
		r = await post("/api/ai/plan", { payload: { text: "a ball" } })
		assert.equal(r.status, 504)
	} finally {
		gw.fallback = () => ({ status: 500, body: { error: { message: "no scripted answer" } } })
	}
})

test("a client that hangs up cancels the step: its gateway call is dropped", async () => {
	let closed = null
	gw.fallback = () => ({ hang: true })
	const ac = new AbortController()
	const p = fetch(base + "/api/ai/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ payload: { text: "a ball" } }), signal: ac.signal }).catch(() => null)
	try {
		// wait until the step's request reaches the gateway, then hang up
		for (let i = 0; i < 50 && !gw.requests.length; i++) await new Promise((r) => setTimeout(r, 50))
		assert.ok(gw.requests.length, "the step reached the gateway")
		const sent = gw.requests.length
		ac.abort()
		await p
		const t0 = Date.now()
		await new Promise((r) => setTimeout(r, 1500))
		closed = Date.now() - t0
		assert.equal(gw.requests.length, sent, "no further attempts after the hang-up")
	} finally {
		gw.fallback = () => ({ status: 500, body: { error: { message: "no scripted answer" } } })
	}
	assert.ok(closed !== null)
})

const EDIT = (rid) => ({ payload: { text: "hi", scene: { items: [{ id: "table", type: "table", x: 1.3, y: 0 }] } }, client: { requestId: rid } })
const progress = async (rid) => {
	const r = await fetch(`${base}/api/ai/progress${rid ? `?id=${encodeURIComponent(rid)}` : ""}`)
	return { status: r.status, json: await r.json() }
}

test("a step that finds every slot busy waits its turn (first come, first served) instead of failing; progress shows it waiting", async () => {
	const answer = { content: JSON.stringify({ kind: "answer", targets: [], mode: "patch", reply: "Nothing to change.", patches: [] }), delayMs: 300 }
	gw.script("m1", [answer, answer])
	const first = post("/api/ai/edit", EDIT("q-first"))
	await new Promise((r) => setTimeout(r, 120))
	const second = post("/api/ai/edit", EDIT("q-second"))
	let sawWaiting = false
	for (let i = 0; i < 40 && !sawWaiting; i++) {
		const p = await progress("q-second")
		if (p.status === 200 && p.json.state === "waiting") {
			sawWaiting = true
			assert.equal(p.json.position, 1)
			assert.equal(p.json.step, "edit")
		} else await new Promise((r) => setTimeout(r, 25))
	}
	const [a, b] = await Promise.all([first, second])
	assert.equal(a.status, 200, JSON.stringify(a.json))
	assert.equal(b.status, 200, JSON.stringify(b.json))
	assert.ok(sawWaiting, "the second step was seen waiting for the slot")
	const done = await progress("q-second")
	assert.equal(done.json.state, "done")
	const all = await progress()
	assert.deepEqual([all.json.slots, all.json.running, all.json.waiting], [1, 0, 0])
	assert.equal((await progress("never-sent")).status, 404)
})

test("a step that cannot get a slot within the queue wait is told busy (429, retryable) with Retry-After", async () => {
	gw.fallback = () => ({ hang: true })
	try {
		const first = post("/api/ai/plan", { payload: { text: "a ball" }, client: { requestId: "hog" } })
		await new Promise((r) => setTimeout(r, 150))
		const t0 = Date.now()
		const r = await fetch(base + "/api/ai/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ payload: { text: "a ball" } }) })
		const body = await r.json()
		assert.equal(r.status, 429)
		assert.equal(body.code, "busy")
		assert.equal(body.retryable, true)
		assert.equal(body.busy, true)
		assert.equal(body.position, 1)
		assert.ok(Number.isInteger(body.retryAfterMs) && body.retryAfterMs >= 1000, JSON.stringify(body))
		assert.equal(r.headers.get("retry-after"), String(Math.ceil(body.retryAfterMs / 1000)))
		assert.ok(Date.now() - t0 >= 1300, "it waited for the queue first")
		assert.equal((await first).status, 504)
	} finally {
		gw.fallback = () => ({ status: 500, body: { error: { message: "no scripted answer" } } })
	}
})

// ---------------------------------------------------------------- round 2 (2026-10-15): only this app may call; per-step slots
test("only this app may call: another Host, another Origin, or a body that is not JSON is refused before any process starts", async () => {
	const u = new URL(base)
	const raw = (headers) =>
		new Promise((resolve) => {
			const body = JSON.stringify({ payload: { text: "a ball" } })
			const s = connect(Number(u.port), "127.0.0.1", () => s.write(`POST /api/ai/plan HTTP/1.1\r\n${headers}Content-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`))
			let got = ""
			s.on("data", (c) => (got += c))
			s.on("close", () => resolve(got))
			s.on("error", () => resolve(got))
		})
	assert.match(await raw(`Host: attacker.example:${u.port}\r\nContent-Type: application/json\r\n`), /^HTTP\/1\.\d 403[\s\S]*Host is not this server/)
	assert.match(await raw(`Host: 127.0.0.1:${u.port}\r\nOrigin: https://evil.example\r\nContent-Type: application/json\r\n`), /^HTTP\/1\.\d 403[\s\S]*another site/)
	assert.match(await raw(`Host: 127.0.0.1:${u.port}\r\nContent-Type: text/plain\r\n`), /^HTTP\/1\.\d 415/)
	assert.equal(gw.requests.length, 0, "none of them reached the gateway")
	assert.match(await raw(`Host: localhost:${u.port}\r\nOrigin: http://localhost:${u.port}\r\nContent-Type: application/json\r\n`), /^HTTP\/1\.\d (200|502)/) // this app's own page gets through
})

test("per-step slots: a step at its own cap waits while another step runs at once (first come, first served among those that can run)", async () => {
	const h2 = mkdtempSync(join(tmpdir(), "ai-server2-"))
	mkdirSync(join(h2, ".config", "truefoundry"), { recursive: true })
	writeFileSync(join(h2, ".config", "truefoundry", "env"), `export TRUEFOUNDRY_API_KEY=${FAKE_KEY}\nexport TRUEFOUNDRY_BASE_URL=${gw.url}\n`)
	writeFileSync(join(h2, "models.json"), JSON.stringify(testRouting({ timeoutMs: 600, budgetMs: 2500, backoffMs: 10 })))
	const s2 = spawn("python3", [HARNESS], { env: { PATH: process.env.PATH, HOME: h2, AI_MODELS: join(h2, "models.json"), AI_CACHE_DIR: h2, AI_SLOTS: "3", AI_STEP_SLOTS: "plan=1", AI_QUEUE_WAIT: "1.2" }, stdio: ["ignore", "pipe", "pipe"] })
	try {
		const port = await new Promise((resolve, reject) => {
			s2.stdout.once("data", (c) => resolve(Number(String(c).trim())))
			s2.once("exit", (code) => reject(new Error(`harness exited ${code}`)))
		})
		const b2 = `http://127.0.0.1:${port}`
		const p2 = (path, body) => fetch(b2 + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json(), retry: r.headers.get("retry-after") }))
		gw.fallback = (req) => (/a ball/.test(JSON.stringify(req.body?.messages?.at(-1) ?? "")) ? { hang: true } : { content: JSON.stringify({ kind: "answer", targets: [], mode: "patch", reply: "Nothing to change.", patches: [] }) })
		const hog = p2("/api/ai/plan", { payload: { text: "a ball" }, client: { requestId: "hog2" } })
		await new Promise((r) => setTimeout(r, 200))
		const waiting = p2("/api/ai/plan", { payload: { text: "a ball" }, client: { requestId: "wait2" } })
		await new Promise((r) => setTimeout(r, 150))
		const t0 = Date.now()
		const ed = await p2("/api/ai/edit", EDIT("edit2"))
		assert.equal(ed.status, 200, JSON.stringify(ed.json))
		assert.ok(Date.now() - t0 < 1000, "the edit did not wait behind the plan that waits for the plan slot")
		const st = await fetch(`${b2}/api/ai/progress`).then((r) => r.json())
		assert.deepEqual([st.slots, st.steps.plan.slots, st.steps.plan.running, st.steps.plan.waiting], [3, 1, 1, 1])
		const pw = await fetch(`${b2}/api/ai/progress?id=wait2`).then((r) => r.json())
		assert.equal(pw.state, "waiting")
		assert.equal(pw.position, 1)
		assert.ok(pw.eta_ms >= 1000)
		const w = await waiting
		assert.equal(w.status, 429)
		assert.deepEqual([w.json.busy, w.json.position], [true, 1])
		assert.equal((await hog).status, 504)
	} finally {
		gw.fallback = () => ({ status: 500, body: { error: { message: "no scripted answer" } } })
		s2.kill("SIGTERM")
		rmSync(h2, { recursive: true, force: true })
	}
})
