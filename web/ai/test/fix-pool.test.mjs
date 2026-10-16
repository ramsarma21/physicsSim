// The fix workers' pool (node --test web/ai/test/fix-pool.test.mjs): made at once, jobs routed to free workers, the stage tuner's jobs ("stage")
// told apart from the fix search's, answers matched to their jobs, aborts. The worker itself is stood in for (node has no module Worker); the real
// one runs in the page (the access e2e checks it there: web/ai/test/access.e2e.mjs).
import test from "node:test"
import assert from "node:assert/strict"

const posted = []
class FakeWorker {
	constructor() {
		this.l = { message: [], error: [] }
		setTimeout(() => this.emit({ fix: 1, ready: true }), 0)
	}
	addEventListener(t, f) {
		this.l[t].push(f)
	}
	emit(data) {
		for (const f of this.l.message) f({ data })
	}
	postMessage(m) {
		posted.push(m)
		setTimeout(() => this.emit(m.op === "stage" ? { fix: 1, id: m.id, goals: [{ label: "g", ok: true }], checks: m.checks.map(() => ({ res: { ok: true }, d: 0 })), warnings: 0, ms: 1 } : { fix: 1, id: m.id, results: [], ok: true, f: 0, warn: 0, ms: 1 }), 5)
	}
	terminate() {}
}
globalThis.Worker = FakeWorker
const { createFixPool } = await import("../fix-pool.js")

test("the pool is made at once (no use before its functions exist) and routes both kinds of job", async () => {
	const pool = createFixPool({ size: 2 })
	assert.equal(typeof pool.evaluate, "function")
	assert.equal(typeof pool.stage, "function")
	assert.equal(pool.broken, false)
	const [a, b, c] = await Promise.all([pool.stage({ items: [] }, [{ item: "x", container: "y" }], [{ item: "x", container: "y" }]), pool.evaluate({ items: [] }, []), pool.stage({ items: [] }, [], [])])
	assert.deepEqual(Object.keys(a).sort(), ["checks", "goals", "ms", "warnings"])
	assert.equal(a.checks.length, 1)
	assert.equal(b.ok, true)
	assert.equal(c.checks.length, 0)
	assert.deepEqual(posted.map((m) => m.op ?? "fix"), ["stage", "fix", "stage"])
	const ctl = new AbortController()
	const p = pool.stage({ items: [] }, [], [], ctl.signal)
	ctl.abort()
	await assert.rejects(p, (e) => e.name === "AbortError")
	pool.terminate()
})
