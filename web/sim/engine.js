// The physics engine in the browser: a small client for web/sim/engine-worker.js (built by `npm run build:engine`).
//   import { createEngine } from "./sim/engine.js"
//   const engine = createEngine()                       // starts the worker now, so the first run doesn't wait for it to load
//   const track = await engine.run(doc, 120, signal)    // doc = a scene document (/api/layout's "doc"); rate = frames per second; signal optional
//   engine.terminate()
// The track is the server's /api/simulate track: {fps, frames: [{t, placements}], impacts} (CONTRACT.md "One run"), rounded as there.
// One worker runs one scene at a time. Runs that wait for it go newest first (as web/server.py does: the app only shows the newest).
// Aborting a run rejects its promise with signal.reason (an AbortError); a run already in the worker is cut short by terminating the worker
// and starting a fresh one. A run that fails rejects with the engine's message (the one the server's 400/500 would carry).
// Where Workers can't be used (none, or module workers unsupported), runs happen on the main thread instead (engine.mode === "main"):
// same results, but the page is busy while one runs and an abort only takes effect before it starts (about 40 ms after the run was asked for).
const WORKER_URL = new URL("./engine-worker.js", import.meta.url)
const MAIN_PAUSE_MS = 40 // the pause before a run on the main thread (no Worker): see runOnMain

export function createEngine({ url = WORKER_URL, prewarm = true } = {}) {
	let worker = null // the live Worker, or null (none started yet, or it was terminated)
	let useMain = typeof Worker === "undefined"
	let loaded = false // has the worker answered once? (a worker that fails before that can't be a module worker here)
	let busy = null // the job the worker holds
	let ended = false
	let nextId = 0
	let engineModule = null // main-thread fallback: the imported bundle
	const waiting = [] // jobs not yet started, oldest first
	const engine = {
		/** Milliseconds the engine itself took for the last finished run (inside the worker). */
		lastMs: 0,
		get mode() {
			return useMain ? "main" : "worker"
		},
		run,
		terminate
	}

	function start() {
		if (worker || useMain || ended) return
		let w
		try {
			w = new Worker(url, { type: "module" })
		} catch {
			useMain = true
			return
		}
		worker = w
		w.addEventListener("message", (e) => {
			if (w !== worker) return
			loaded = true
			if (busy && e.data.id === busy.id) finish(e.data)
		})
		w.addEventListener("error", (e) => {
			if (w !== worker) return
			e.preventDefault?.()
			dropWorker()
			if (!loaded) {
				useMain = true // it never loaded: module workers aren't available here
				if (busy) waiting.push(busy)
				busy = null
			} else if (busy) {
				const job = busy
				busy = null
				settle(job, null, new Error(`the engine stopped: ${e.message || "no reason given"}`))
			}
			pump()
		})
		w.addEventListener("messageerror", () => {
			if (w !== worker) return
			dropWorker()
			if (busy) {
				const job = busy
				busy = null
				settle(job, null, new Error("the engine's answer could not be read"))
			}
			pump()
		})
	}

	function dropWorker() {
		worker?.terminate()
		worker = null
	}

	function settle(job, track, error) {
		job.signal?.removeEventListener("abort", job.onAbort)
		if (error) job.reject(error)
		else job.resolve(track)
	}

	function finish(msg) {
		const job = busy
		busy = null
		if (msg.error !== undefined) settle(job, null, new Error(msg.error))
		else {
			engine.lastMs = msg.ms
			settle(job, msg.track)
		}
		pump()
	}

	function pump() {
		if (busy || ended) return
		const job = waiting.pop() // the newest first
		if (!job) return
		busy = job
		if (!useMain) start()
		if (useMain) return void runOnMain(job)
		if (!worker) return void fail(job, new Error("the engine could not be started")) // can't happen: start() either made one or switched to the main thread
		try {
			worker.postMessage({ id: job.id, doc: job.doc, rate: job.rate })
		} catch (e) {
			fail(job, asError(e)) // a doc that can't be copied to the worker (a function in it, say): this run fails, the worker is still fine
		}
	}

	// The job the engine holds ends with this rejection (as it is: an abort's own reason too), and the next one goes on.
	function fail(job, reason) {
		if (busy === job) busy = null
		job.signal?.removeEventListener("abort", job.onAbort)
		job.reject(reason)
		pump()
	}
	const asError = (e) => (e instanceof Error ? e : new Error(String(e)))

	// No Worker: the run happens here, and while it does the page can't react (nor abort it). So it starts only after a pause (MAIN_PAUSE_MS), in which
	// the page can still paint and take edits: a run aborted by then never starts, and a newer run that arrived meanwhile goes first. (A burst of
	// quick edits, each aborting the one before, then costs one run, not all of them.)
	async function runOnMain(job) {
		try {
			const [mod] = await Promise.all([(engineModule ??= import(url instanceof URL ? url.href : url)), new Promise((r) => setTimeout(r, MAIN_PAUSE_MS))])
			if (busy !== job) return
			if (job.signal?.aborted) return fail(job, job.signal.reason)
			const newer = waiting.findIndex((w) => w.id > job.id)
			if (newer >= 0) {
				// a newer run came in during the pause: it goes first, this one waits behind it (waiting stays in the order the runs were asked for)
				busy = null
				waiting.splice(newer, 0, job)
				return pump()
			}
			const msg = mod.handle({ id: job.id, doc: job.doc, rate: job.rate })
			if (busy !== job) return
			if (job.signal?.aborted) return fail(job, job.signal.reason)
			finish(msg)
		} catch (e) {
			engineModule = null // (a failed import is tried again next time)
			if (busy === job) fail(job, asError(e))
		}
	}

	function run(doc, rate, signal) {
		if (ended) return Promise.reject(new DOMException("The engine was terminated", "AbortError"))
		if (signal?.aborted) return Promise.reject(signal.reason)
		return new Promise((resolve, reject) => {
			const job = { id: ++nextId, doc, rate, signal, resolve, reject, onAbort: null }
			job.onAbort = () => {
				const k = waiting.indexOf(job)
				if (k >= 0) waiting.splice(k, 1)
				else if (busy === job) {
					busy = null
					if (!useMain) {
						dropWorker() // cut the run short: a fresh worker takes over (and loads while the next scene is made)
						start()
					}
				} else return
				reject(signal.reason)
				pump()
			}
			signal?.addEventListener("abort", job.onAbort, { once: true })
			waiting.push(job)
			pump()
		})
	}

	function terminate() {
		ended = true
		dropWorker()
		const err = new DOMException("The engine was terminated", "AbortError")
		for (const job of [busy, ...waiting.splice(0)]) if (job) settle(job, null, err)
		busy = null
	}

	if (prewarm) start()
	return engine
}
