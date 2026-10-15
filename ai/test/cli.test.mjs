// ai/cli.mjs as a process: one JSON request in, one JSON answer out, exit codes, cancellation by SIGTERM, and no key in its output.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { after, before, beforeEach, test } from "node:test"
import { FAKE_KEY, startMockGateway, testRouting } from "./mock-gateway.mjs"

const CLI = fileURLToPath(new URL("../cli.mjs", import.meta.url))
const PG = fileURLToPath(new URL("../../", import.meta.url))
let gw
let dir
let modelsPath
before(async () => {
	gw = await startMockGateway()
	dir = mkdtempSync(join(tmpdir(), "ai-cli-"))
	modelsPath = join(dir, "models.json")
	writeFileSync(modelsPath, JSON.stringify(testRouting({ timeoutMs: 400, budgetMs: 2500, backoffMs: 10 })))
})
after(async () => {
	await gw.close()
	rmSync(dir, { recursive: true, force: true })
})
beforeEach(() => gw.reset())

function runCli(input, { env = {}, killAfterMs, killWhen } = {}) {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [CLI], {
			cwd: PG,
			env: { PATH: process.env.PATH, TRUEFOUNDRY_API_KEY: FAKE_KEY, AI_GATEWAY_URL: gw.url, AI_MODELS: modelsPath, AI_CACHE_DIR: dir, ...env },
			stdio: ["pipe", "pipe", "pipe"]
		})
		let out = ""
		let err = ""
		child.stdout.on("data", (c) => (out += c))
		child.stderr.on("data", (c) => (err += c))
		if (killAfterMs) setTimeout(() => child.kill("SIGTERM"), killAfterMs)
		// killWhen(): SIGTERM as soon as it is true (polled), e.g. once the gateway has the request, so a slow start on a loaded machine
		// cannot make the signal land before the CLI is listening for it
		if (killWhen) {
			const poll = setInterval(() => {
				if (killWhen()) {
					clearInterval(poll)
					child.kill("SIGTERM")
				}
			}, 10)
			child.on("close", () => clearInterval(poll))
		}
		child.on("close", (code) => {
			let json = null
			try {
				json = JSON.parse(out)
			} catch {}
			resolve({ code, out, err, json })
		})
		child.stdin.on("error", () => {}) // the CLI stops reading an oversized request (EPIPE here is expected)
		child.stdin.end(typeof input === "string" ? input : JSON.stringify(input))
	})
}
const noKey = (r) => {
	assert.equal(r.out.includes(FAKE_KEY), false, "key in stdout")
	assert.equal(r.err.includes(FAKE_KEY), false, "key in stderr")
}

test("ok: exit 0 and {ok, result, model, ms, usage}", async () => {
	gw.script("m1", [{ content: JSON.stringify({ mode: "patch", reply: "Nothing to change.", patches: [] }) }])
	const r = await runCli({ step: "edit", payload: { text: "what does the seesaw do?", scene: { items: [{ id: "table", type: "table", x: 1.3, y: 0 }] } }, client: { requestId: "req-1" } })
	assert.equal(r.code, 0, r.out + r.err)
	assert.equal(r.json.ok, true)
	assert.equal(r.json.result.mode, "patch")
	assert.equal(r.json.model, "m1")
	assert.equal(typeof r.json.ms, "number")
	assert.equal(r.json.usage.total_tokens, 15)
	assert.equal(r.json.requestId, "req-1")
	noKey(r)
})

test("bad input: exit 2, status 400, nothing sent", async () => {
	for (const input of ["{not json", { payload: {} }, { step: "fly", payload: {} }, { step: "plan", payload: "x" }, { step: "plan", payload: {} }]) {
		const r = await runCli(input)
		assert.equal(r.code, 2, JSON.stringify(input))
		assert.equal(r.json.ok, false)
		assert.equal(r.json.status, 400)
		assert.equal(r.json.code, "bad_input")
		noKey(r)
	}
	assert.equal(gw.requests.length, 0)
})

test("the models fail: exit 3, status 502, the gateway's reason (redacted)", async () => {
	gw.fallback = () => ({ status: 403, message: `forbidden for Bearer ${FAKE_KEY}` })
	try {
		const r = await runCli({ step: "plan", payload: { text: "a ball" } })
		assert.equal(r.code, 3)
		assert.equal(r.json.status, 502)
		assert.equal(r.json.code, "gateway")
		assert.ok(r.json.attempts.length >= 3)
		noKey(r)
	} finally {
		gw.fallback = () => ({ status: 500, body: { error: { message: "no scripted answer" } } })
	}
})

test("out of time: exit 4, status 504, retryable", async () => {
	gw.fallback = () => ({ hang: true })
	try {
		const r = await runCli({ step: "plan", payload: { text: "a ball" } })
		assert.equal(r.code, 4)
		assert.equal(r.json.status, 504)
		assert.equal(r.json.retryable, true)
	} finally {
		gw.fallback = () => ({ status: 500, body: { error: { message: "no scripted answer" } } })
	}
})

test("no key: exit 5, status 500", async () => {
	const r = await runCli({ step: "plan", payload: { text: "a ball" } }, { env: { TRUEFOUNDRY_API_KEY: "" } })
	assert.equal(r.code, 5)
	assert.equal(r.json.code, "config")
	assert.equal(gw.requests.length, 0)
})

test("SIGTERM cancels the step: exit 130, {ok: false, code: aborted}", async () => {
	gw.fallback = () => ({ hang: true })
	try {
		gw.reset()
		let sent = 0
		const r = await runCli({ step: "plan", payload: { text: "a ball" } }, { killWhen: () => gw.requests.length > 0 && (sent ||= Date.now()) })
		assert.equal(r.code, 130)
		assert.equal(r.json.code, "aborted")
		assert.ok(Date.now() - sent < 2000, "it stops within 2 s of the signal")
	} finally {
		gw.fallback = () => ({ status: 500, body: { error: { message: "no scripted answer" } } })
	}
})

test("a request over the size cap: exit 2, status 413", async () => {
	const r = await runCli({ step: "observe", payload: { images: ["data:image/png;base64," + "A".repeat(14 << 20)] } })
	assert.equal(r.code, 2)
	assert.equal(r.json.status, 413)
})

test("progress (AI_PROGRESS=1): streamed steps write AIPROGRESS lines on stderr: numbers and the model's name, never the key", async () => {
	const streamPath = join(dir, "models-stream.json")
	const r0 = testRouting({ timeoutMs: 4000, budgetMs: 8000, backoffMs: 10, stream: true })
	r0.models.m1 = { ...r0.models.m1, stream: true }
	writeFileSync(streamPath, JSON.stringify(r0))
	gw.script("m1", [{ content: JSON.stringify({ mode: "patch", reply: "Nothing to change.", patches: [] }), thinking: 6, chunkDelayMs: 60 }])
	const r = await runCli({ step: "edit", payload: { text: "what does the seesaw do?", scene: { items: [{ id: "table", type: "table", x: 1.3, y: 0 }] } } }, { env: { AI_MODELS: streamPath, AI_PROGRESS: "1" } })
	assert.equal(r.code, 0, r.out + r.err)
	noKey(r)
	const lines = r.err.split("\n").filter((l) => l.startsWith("AIPROGRESS "))
	assert.ok(lines.length >= 1, r.err)
	const p = JSON.parse(lines[0].slice(11))
	assert.deepEqual(Object.keys(p).sort(), ["attempt", "model", "ms", "phase", "repair", "step", "tokens"])
	assert.equal(p.step, "edit")
	assert.equal(p.model, "m1")
})
