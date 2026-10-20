// A small pool of fix workers (./fix-worker.js) so the fix search runs several candidates at once, off the page's thread.
//   import { createFixPool } from "./fix-pool.js"
//   const pool = createFixPool()               // workers start on the first use (or pool.prewarm())
//   const judged = await pool.evaluate(scene, targets, signal)   // ./fixer.js judgeRun's answer for that scene's run
//   const j = await pool.stage(scene, goals, checks, signal)      // ./stage-tune.js judgeRun's: {goals, checks: [{res, d}], warnings} (the stage tuner)
//   const p = await pool.probe(scene, targets, item, signal)      // ./fixer.js probeRun's: judgeRun's answer + the item's path and hits (stage by stage)
//   pool.size; pool.broken (no fix workers to use now: use the app's own runs instead); pool.terminate()
// Idle workers are let go after a minute (they are made again on the next search). Aborting a run that a worker is busy with replaces that worker.
// A job goes to a worker only once the worker has said it is ready (see pump). No job waits for ever: one not given to a worker in loadMs, or not
// answered in jobMs once it was, fails with an Error (not an abort: the stage tuner then judges that run on the app's own engine), and a worker
// that hasn't said it is ready in loadMs, or didn't answer, is let go. When none has ever said so in loadMs, the pool is broken for restMs (the
// app's own runs), then workers are tried again; only where they can't be made at all (no module workers) is it broken for good.
const URL_ = new URL("./fix-worker.js", import.meta.url)
const IDLE_MS = 60000
// (a worker's start took 22–33 s, and a stage run 19 s, on a machine at load 350 (20 Oct): these only catch what will never come)
const LOAD_MS = 60000
const JOB_MS = 60000 // (one engine run; the searches that send them have budgets of 25–45 s)
const REST_MS = 60000 // (no worker was ready in LOAD_MS: a slow start on a busy machine, not for good)
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now())

export function createFixPool({ size = null, loadMs = LOAD_MS, jobMs = JOB_MS, restMs = REST_MS } = {}) {
	const n = Math.max(1, Math.min(4, size ?? Math.floor((globalThis.navigator?.hardwareConcurrency || 4) / 2) - 1))
	const slots = [] // {w, job: {id, resolve, reject, onAbort, signal, waitTimer} | null, loaded, loadTimer, jobTimer}
	const waiting = []
	let nextId = 1
	let idleTimer = 0
	let readyOnce = false
	let unavailable = typeof Worker === "undefined" // (no module workers here: for good)
	let restUntil = 0 // (none was ready in loadMs: no workers until then)
	const pool = {
		size: n,
		get broken() {
			return unavailable || now() < restUntil
		},
		evaluate,
		stage,
		probe,
		prewarm,
		terminate
	}

	function make() {
		let w
		try {
			w = new Worker(URL_, { type: "module" })
		} catch {
			unavailable = true
			return null
		}
		const slot = { w, job: null, loaded: false, loadTimer: 0, jobTimer: 0 }
		slot.loadTimer = setTimeout(() => {
			if (slot.loaded) return
			drop(slot)
			// (none ever was ready: the app's own runs for restMs, then workers again. Once one was, this one is only replaced, for a job that waits)
			if (!readyOnce) restUntil = now() + restMs
			pump()
		}, loadMs)
		w.addEventListener("message", (e) => {
			const m = e.data
			if (!m || m.fix !== 1) return
			slot.loaded = true
			clearTimeout(slot.loadTimer)
			if (m.ready) {
				readyOnce = true
				restUntil = 0
				return void pump()
			}
			const job = slot.job
			if (!job || job.id !== m.id) return
			free(slot)
			if (m.error !== undefined) job.reject(new Error(m.error))
			else job.resolve(job.op === "stage" ? { goals: m.goals, checks: m.checks, warnings: m.warnings, ms: m.ms } : job.op === "probe" ? { results: m.results, ok: m.ok, f: m.f, warn: m.warn, path: m.path, hits: m.hits, ms: m.ms } : { results: m.results, ok: m.ok, f: m.f, warn: m.warn, ms: m.ms })
			pump()
		})
		w.addEventListener("error", (e) => {
			e.preventDefault?.()
			if (!slot.loaded) unavailable = true // (it never loaded: no module workers here)
			const job = slot.job
			free(slot)
			drop(slot)
			if (job) job.reject(new Error(`the fix worker stopped: ${e.message || "no reason given"}`))
			pump()
		})
		slots.push(slot)
		return slot
	}
	/** The slot's job is over (answered, failed or given up): the slot takes the next. */
	function free(slot) {
		const job = slot.job
		slot.job = null
		clearTimeout(slot.jobTimer)
		job?.signal?.removeEventListener("abort", job.onAbort)
	}
	function drop(slot) {
		clearTimeout(slot.loadTimer)
		clearTimeout(slot.jobTimer)
		try {
			slot.w.terminate()
		} catch {}
		const i = slots.indexOf(slot)
		if (i >= 0) slots.splice(i, 1)
	}
	/** A job leaves the queue without a worker (it failed or was cancelled there). */
	function unqueue(job) {
		const qi = waiting.indexOf(job)
		if (qi >= 0) waiting.splice(qi, 1)
		clearTimeout(job.waitTimer)
		job.signal?.removeEventListener("abort", job.onAbort)
		return qi >= 0
	}
	function prewarm() {
		if (pool.broken) return
		while (slots.length < n && make());
		touch()
	}
	function touch() {
		clearTimeout(idleTimer)
		idleTimer = setTimeout(() => {
			if (slots.some((s) => s.job) || waiting.length) return touch()
			for (const s of [...slots]) drop(s)
		}, IDLE_MS)
	}
	function pump() {
		if (pool.broken) {
			for (const j of [...waiting]) {
				unqueue(j)
				j.reject(new Error("fix workers are not available here"))
			}
			return
		}
		while (waiting.length) {
			// (a job goes only to a worker that has said it is ready. One sent sooner can be lost: while the worker's imports wait at a top-level
			// await (web/sim's module index), a message that comes in meets only the listeners already added, and the engine bundle's
			// (web/sim/engine-worker.js answers every message of its worker) answers it without fix: 1, which is ignored here. The stage tuner
			// then waited for ever on it: every balanced-forces Build with AI of the video pipeline's batch, 19 Oct)
			const slot = slots.find((s) => s.loaded && !s.job)
			if (!slot) {
				// (one more worker for each job that waits, up to n: they load side by side)
				while (slots.length < n && slots.filter((s) => !s.loaded).length < waiting.length && make());
				if (pool.broken) return pump()
				return
			}
			const job = waiting.shift()
			clearTimeout(job.waitTimer)
			slot.job = job
			slot.jobTimer = setTimeout(() => {
				if (slot.job !== job) return
				// (lost, or stuck on it: the worker is replaced, and the job fails rather than waiting for ever)
				free(slot)
				drop(slot)
				job.reject(new Error(`the fix worker didn't answer in ${Math.round(jobMs / 1000)} s`))
				pump()
			}, jobMs)
			slot.w.postMessage(job.op === "stage" ? { fix: 1, id: job.id, op: "stage", scene: job.scene, goals: job.goals, checks: job.checks } : job.op === "probe" ? { fix: 1, id: job.id, op: "probe", scene: job.scene, targets: job.targets, item: job.item } : { fix: 1, id: job.id, scene: job.scene, targets: job.targets })
		}
	}
	/** The fix search's judgement of a scene's run (./fixer.js judgeRun). */
	function evaluate(scene, targets, signal) {
		return submit({ scene, targets }, signal)
	}
	/** The stage tuner's judgement of a scene's run: the goals and each stage's check, with how far each failing one is (./stage-tune.js). */
	function stage(scene, goals, checks, signal) {
		return submit({ op: "stage", scene, goals, checks }, signal)
	}
	/** The stage-by-stage search's look at a scene's run: the fix search's judgement, and one thing's path and hits (./fixer.js probeRun). */
	function probe(scene, targets, item, signal) {
		return submit({ op: "probe", scene, targets, item }, signal)
	}
	function submit(msg, signal) {
		if (pool.broken) return Promise.reject(new Error("fix workers are not available here"))
		touch()
		return new Promise((resolve, reject) => {
			if (signal?.aborted) return reject(abortError())
			const job = { id: nextId++, ...msg, resolve, reject, signal, waitTimer: 0 }
			job.onAbort = () => {
				unqueue(job)
				const slot = slots.find((s) => s.job === job)
				if (slot) drop(slot) // (a run in progress can't be stopped any other way)
				reject(abortError())
				pump()
			}
			signal?.addEventListener("abort", job.onAbort, { once: true })
			waiting.push(job)
			pump()
			// (no worker for it in loadMs, as when every new one is slow to start on a busy machine (once one was ready, each is only replaced): it
			// fails rather than waiting for ever, as its own timer (jobMs) starts only once a worker has it. Set after the workers pump made for it,
			// so that when none was ever ready the pool's rest comes first)
			if (waiting.includes(job))
				job.waitTimer = setTimeout(() => {
					if (unqueue(job)) reject(new Error(`no fix worker was ready for it in ${Math.round(loadMs / 1000)} s`))
				}, loadMs)
		})
	}
	function terminate() {
		clearTimeout(idleTimer)
		for (const s of [...slots]) {
			const job = s.job
			free(s)
			drop(s)
			job?.reject(abortError())
		}
		for (const j of [...waiting]) {
			unqueue(j)
			j.reject(abortError())
		}
	}
	return pool
}
const abortError = () => (typeof DOMException !== "undefined" ? new DOMException("Cancelled", "AbortError") : Object.assign(new Error("Cancelled"), { name: "AbortError" }))
