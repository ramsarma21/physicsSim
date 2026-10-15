// A scriptable stand-in for the TrueFoundry gateway (OpenAI-compatible POST /v1/chat/completions) on 127.0.0.1, for the tests.
//   const gw = await startMockGateway()
//   gw.script("m1", [{status: 429, headers: {"retry-after": "0"}}, {content: '{"ok": true}'}])   // answers for model m1, in order
//   gw.fallback = (req) => ({content: "..."})          // when a model's script is used up (default: 500)
//   ... env AI_GATEWAY_URL = gw.url ...
//   gw.requests  -> [{model, body (parsed, the auth header removed), auth (true when a Bearer token came), at}]
//   await gw.close()
// A step: {status?, content?, finish?, usage?, body? (raw JSON object or string to send instead), headers?, delayMs?, hang?}
// A request with stream: true is answered as server-sent events (role, `thinking` reasoning chunks, the content in pieces, the finish, the
// usage, [DONE]) unless the step says plain: true; chunkDelayMs spaces the chunks; stall: n sends n chunks and then nothing more.
// The Authorization header is never stored: only whether it was there.
import { createServer } from "node:http"

export async function startMockGateway() {
	const scripts = new Map()
	const requests = []
	const sockets = new Set()
	const gw = {
		url: "",
		requests,
		fallback: () => ({ status: 500, body: { error: { message: "no scripted answer" } } }),
		script(model, steps) {
			scripts.set(model, [...(scripts.get(model) ?? []), ...steps])
			return gw
		},
		reset() {
			scripts.clear()
			requests.length = 0
		},
		forModel: (model) => requests.filter((r) => r.model === model),
		close: () =>
			new Promise((resolve) => {
				for (const s of sockets) s.destroy()
				server.close(() => resolve())
			})
	}
	const server = createServer(async (req, res) => {
		const chunks = []
		for await (const c of req) chunks.push(c)
		let body = null
		try {
			body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
		} catch {}
		const auth = /^Bearer \S{8,}$/.test(req.headers.authorization ?? "")
		const rec = { model: body?.model, body, auth, path: req.url, at: Date.now() }
		requests.push(rec)
		if (req.method !== "POST" || !req.url.endsWith("/chat/completions")) {
			res.writeHead(404, { "content-type": "application/json" })
			return res.end(JSON.stringify({ error: { message: "not found" } }))
		}
		const queue = scripts.get(body?.model)
		const step = queue?.length ? queue.shift() : gw.fallback(rec)
		rec.step = step
		if (step.hang) return // never answers (the client times out or aborts)
		if (step.delayMs) await new Promise((r) => setTimeout(r, step.delayMs))
		if (res.destroyed) return
		const status = step.status ?? 200
		if (body?.stream === true && status === 200 && step.body === undefined && !step.plain) return sse(res, body, step)
		const headers = { "content-type": "application/json", ...(step.headers ?? {}) }
		let out
		if (step.body !== undefined) out = typeof step.body === "string" ? step.body : JSON.stringify(step.body)
		else if (status === 200)
			out = JSON.stringify({
				id: "mock",
				model: String(body?.model ?? "").split("/").pop(),
				choices: [{ index: 0, message: { role: "assistant", content: step.content ?? "{}" }, finish_reason: step.finish ?? "stop" }],
				usage: step.usage ?? { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, costInUSD: 0.001 }
			})
		else out = JSON.stringify({ error: { message: step.message ?? `mock error ${status}` } })
		res.writeHead(status, headers)
		res.end(out)
	})
	server.on("connection", (s) => {
		sockets.add(s)
		s.on("close", () => sockets.delete(s))
	})
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
	gw.url = `http://127.0.0.1:${server.address().port}/v1`
	return gw
}

/** An answer as an OpenAI-style event stream. */
async function sse(res, body, step) {
	res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" })
	const model = String(body?.model ?? "").split("/").pop()
	const content = step.content ?? "{}"
	const pieces = [{ role: "assistant" }, ...Array.from({ length: step.thinking ?? 3 }, (_, i) => ({ reasoning_content: `step ${i} of the thinking. ` }))]
	for (let i = 0; i < content.length; i += 7) pieces.push({ content: content.slice(i, i + 7) })
	const chunks = pieces.map((delta) => ({ id: "mock", model, choices: [{ index: 0, delta }] }))
	chunks.push({ id: "mock", model, choices: [{ index: 0, delta: {}, finish_reason: step.finish ?? "stop" }] })
	chunks.push({ id: "mock", model, choices: [], usage: step.usage ?? { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, costInUSD: 0.001 } })
	let sent = 0
	for (const c of chunks) {
		if (res.destroyed) return
		if (step.stall !== undefined && sent >= step.stall) return // goes quiet: the client's idle timer must notice
		res.write(`data: ${JSON.stringify(c)}\n\n`)
		sent++
		if (step.chunkDelayMs) await new Promise((r) => setTimeout(r, step.chunkDelayMs))
	}
	res.end("data: [DONE]\n\n")
}

/** A routing object like ai/models.json, with short timings for tests. */
export function testRouting(over = {}) {
	const step = {
		model: "m1",
		fallbacks: ["m2", "m3"],
		params: { max_tokens: 100, temperature: 0.2 },
		timeoutMs: 1500,
		budgetMs: 15000,
		retries: 2,
		backoffMs: 20,
		...over
	}
	return {
		defaults: { minAttemptMs: 50, maxBackoffMs: 200 },
		models: { m1: { vision: true }, m2: { vision: true }, m3: { vision: true }, blind: { vision: false } },
		steps: { test: step, observe: step, plan: step, refine: step, edit: step }
	}
}

/** A fake key (never a real one) and the env that points the core at the mock. */
export const FAKE_KEY = "sk-test-NOT-A-REAL-KEY-0123456789abcdef"
export const mockEnv = (gw, extra = {}) => ({ TRUEFOUNDRY_API_KEY: FAKE_KEY, AI_GATEWAY_URL: gw.url, ...extra })
