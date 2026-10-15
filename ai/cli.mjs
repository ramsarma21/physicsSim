#!/usr/bin/env node
// One AI step as a process: reads ONE JSON request {step, payload, client?} on stdin, writes ONE JSON answer on stdout, then exits.
//   ok:    {"ok": true, "result": {...}, "model", "servedModel", "ms", "usage", "attempts", "warnings", "prompt", "catalog"?, "requestId"?}
//   error: {"ok": false, "error": "plain words", "code", "status" (the HTTP status to answer with), "retryable", "attempts"?, "details"?}
// Exit codes: 0 ok, 2 bad input (400/413), 3 the models failed (502), 4 out of time (504), 5 not configured (500), 130 cancelled, 1 internal.
// SIGTERM / SIGINT cancel the step (the in-flight gateway request is aborted). The key (TRUEFOUNDRY_API_KEY, from the environment)
// never appears in the output: every answer is scrubbed of it before it is written.
// Used by web/server.py: zsh -c 'source ~/.config/truefoundry/env && exec node ai/cli.mjs'
import { AIError, scrub } from "./core.mjs"
import { runStep } from "./steps.mjs"

const MAX_STDIN = 13 << 20 // 12 MB body + the envelope
const EXIT = { bad_input: 2, too_large: 2, gateway: 3, invalid_output: 3, timeout: 4, budget: 4, config: 5, aborted: 130, busy: 3, internal: 1 }

function write(obj, code) {
	let text
	try {
		text = scrub(JSON.stringify(obj))
	} catch {
		text = JSON.stringify({ ok: false, error: "the answer could not be written", code: "internal", status: 500, retryable: false })
		code = 1
	}
	process.exitCode = code
	process.stdout.write(text + "\n", () => process.exit(code))
}

function fail(e, requestId) {
	const err = e instanceof AIError ? e : new AIError("internal", `internal error: ${e?.message ?? e}`)
	const out = { ok: false, error: err.message, code: err.code, status: err.status, retryable: !!err.retryable }
	if (requestId) out.requestId = requestId
	if (err.attempts?.length) out.attempts = err.attempts
	if (err.details) out.details = err.details
	if (err.ms !== undefined) out.ms = err.ms
	if (err.usage && Object.keys(err.usage).length) out.usage = err.usage
	write(out, EXIT[err.code] ?? 1)
}

async function readStdin() {
	const chunks = []
	let n = 0
	for await (const c of process.stdin) {
		n += c.length
		if (n > MAX_STDIN) throw new AIError("too_large", `the request is too large (over ${MAX_STDIN >> 20} MB)`)
		chunks.push(c)
	}
	return Buffer.concat(chunks).toString("utf8")
}

const ac = new AbortController()
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(sig, () => ac.abort(new Error("cancelled")))

let requestId
try {
	const raw = await readStdin()
	let req
	try {
		req = JSON.parse(raw)
	} catch {
		throw new AIError("bad_input", "the request is not valid JSON")
	}
	if (!req || typeof req !== "object" || Array.isArray(req)) throw new AIError("bad_input", "the request must be a JSON object {step, payload}")
	const cid = req.client?.requestId
	if (typeof cid === "string" && /^[\w.:-]{1,80}$/.test(cid)) requestId = cid
	if (typeof req.step !== "string") throw new AIError("bad_input", "step is missing")
	// progress (AI_PROGRESS=1, set by web/server.py): one line per second at most on stderr, "AIPROGRESS {step, model, attempt, repair, phase,
	// tokens, ms}" (numbers and the model's name only), which the server keeps for GET /api/ai/progress
	let lastProgress = 0
	const onProgress = process.env.AI_PROGRESS
		? (p) => {
				const now = Date.now()
				if (now - lastProgress < 1000) return
				lastProgress = now
				const line = { step: req.step, model: String(p.model ?? "").slice(0, 80), attempt: p.attempt | 0, repair: !!p.repair, phase: p.phase === "writing" ? "writing" : "thinking", tokens: Math.max(0, p.tokens | 0), ms: Math.max(0, p.ms | 0) }
				process.stderr.write(`AIPROGRESS ${scrub(JSON.stringify(line))}\n`)
			}
		: undefined
	const out = await runStep(req.step, req.payload, { signal: ac.signal, onProgress })
	const res = { ok: true, result: out.result, model: out.model, servedModel: out.servedModel, ms: out.ms, usage: out.usage, attempts: out.attempts, warnings: out.warnings, prompt: out.prompt }
	if (out.catalog) res.catalog = out.catalog
	if (out.goals) res.goals = out.goals
	if (out.stages) res.stages = out.stages
	if (out.intent) res.intent = out.intent
	if (out.why) res.why = out.why
	if (out.edit) res.edit = out.edit
	if (requestId) res.requestId = requestId
	write(res, 0)
} catch (e) {
	fail(e, requestId)
}
