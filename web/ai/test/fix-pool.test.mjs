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

// ---- no job waits for ever (the video pipeline's batch, 19 Oct: every balanced-forces Build with AI stuck in "Tuning stage by stage")
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const CHECK = [{ item: "x", container: "y" }]
/** The fix worker as it loads when its imports wait at a top-level await (web/sim's module index): the engine bundle's listener is there at once
 *  and answers every message, without fix: 1 (a fix job has no doc: an error); the worker's own listener comes 40 ms later, then says it is
 *  ready. A message that comes in before that meets the engine bundle's listener alone. */
class LateWorker {
	constructor() {
		this.l = { message: [], error: [] }
		this.own = false
		setTimeout(() => {
			this.own = true
			this.emit({ fix: 1, ready: true })
		}, 40)
	}
	addEventListener(t, f) {
		this.l[t].push(f)
	}
	emit(data) {
		for (const f of this.l.message) f({ data })
	}
	postMessage(m) {
		setTimeout(() => this.emit({ id: m.id, error: "the document does not fit the format: Expected object" }), 1)
		if (this.own) setTimeout(() => this.emit(m.op === "stage" ? { fix: 1, id: m.id, goals: [], checks: m.checks.map(() => ({ res: { ok: false }, d: 1.9 })), warnings: 0, ms: 3 } : { fix: 1, id: m.id, results: [], ok: false, f: 1, warn: 0, ms: 3 }), 5)
	}
	terminate() {}
}
async function withWorker(W, f) {
	globalThis.Worker = W
	try {
		return await f()
	} finally {
		globalThis.Worker = FakeWorker
	}
}

test("a job goes to a worker only once it has said it is ready: sent sooner, it meets only the engine bundle's listener and never comes back", { timeout: 10000 }, () =>
	withWorker(LateWorker, async () => {
		const pool = createFixPool({ size: 2 })
		try {
			const lost = Symbol("lost")
			const r = await Promise.race([Promise.all([pool.stage({ items: [] }, [], CHECK), pool.stage({ items: [] }, [], CHECK), pool.evaluate({ items: [] }, []), pool.stage({ items: [] }, [], [])]), sleep(3000).then(() => lost)])
			assert.notEqual(r, lost, "every job came back")
			assert.deepEqual(r.map((x) => x.checks?.length ?? "fix"), [1, 1, "fix", 0])
		} finally {
			pool.terminate()
		}
	})
)

test("a job that doesn't come back fails after jobMs (an Error, not an abort: the stage tuner judges it on the app's own engine) and its worker is replaced", { timeout: 10000 }, async () => {
	let made = 0
	let stopped = 0
	class Mute extends FakeWorker {
		constructor() {
			super()
			this.n = ++made
		}
		postMessage(m) {
			if (this.n > 1) super.postMessage(m) // (the first worker takes the job and never answers)
		}
		terminate() {
			stopped++
		}
	}
	await withWorker(Mute, async () => {
		const pool = createFixPool({ size: 1, jobMs: 120 })
		try {
			const t0 = performance.now()
			await assert.rejects(pool.stage({ items: [] }, [], CHECK), (e) => e.name !== "AbortError" && /didn't answer in/.test(e.message))
			assert.ok(performance.now() - t0 < 1500)
			assert.equal(stopped, 1, "the worker that didn't answer was let go")
			const r = await pool.stage({ items: [] }, [], CHECK)
			assert.equal(made, 2, "the next job went to a new worker")
			assert.equal(r.checks.length, 1)
		} finally {
			pool.terminate()
		}
	})
})

test("workers that never say they are ready: after loadMs the pool is broken and the jobs waiting fail (an Error: the app's own runs are used)", { timeout: 10000 }, async () => {
	class Silent {
		constructor() {
			this.l = { message: [], error: [] }
		}
		addEventListener(t, f) {
			this.l[t].push(f)
		}
		postMessage() {}
		terminate() {}
	}
	await withWorker(Silent, async () => {
		const pool = createFixPool({ size: 2, loadMs: 120 })
		try {
			await assert.rejects(Promise.all([pool.stage({ items: [] }, [], CHECK), pool.evaluate({ items: [] }, [])]), (e) => e.name !== "AbortError" && /not available/.test(e.message))
			assert.equal(pool.broken, true)
			await assert.rejects(pool.stage({ items: [] }, [], CHECK), /not available/)
		} finally {
			pool.terminate()
		}
	})
})

test("terminate() fails the jobs still out (AbortError): none is left waiting on a worker that was let go", { timeout: 10000 }, async () => {
	class Busy extends FakeWorker {
		postMessage() {}
	}
	await withWorker(Busy, async () => {
		const pool = createFixPool({ size: 1 })
		const p = pool.stage({ items: [] }, [], CHECK)
		await sleep(40) // (on the worker by now)
		pool.terminate()
		await assert.rejects(p, (e) => e.name === "AbortError")
	})
})
