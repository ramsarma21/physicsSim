// A pool of engine threads (lib/sim-worker.mjs) for the bench: simulate(scene, signal) -> the /api/simulate answer, or throws the engine's error.
//   const pool = createSimPool({ size: 6 }); const sim = await pool.simulate(scene); pool.close()
import { Worker } from "node:worker_threads"
import os from "node:os"

export function createSimPool({ size = Math.max(2, Math.min(8, os.cpus().length - 4)) } = {}) {
	const url = new URL("./sim-worker.mjs", import.meta.url)
	const idle = []
	const all = []
	const waiting = []
	const jobs = new Map()
	let next = 1
	let closed = false
	const spawn = () => {
		const w = new Worker(url)
		w.unref()
		w.on("message", (m) => {
			const j = jobs.get(m.id)
			if (!j) return
			jobs.delete(m.id)
			w.job = null
			if (m.ok) j.resolve(m.sim)
			else j.reject(new Error(m.error))
			release(w)
		})
		w.on("error", (e) => {
			if (w.job) {
				const j = jobs.get(w.job)
				jobs.delete(w.job)
				j?.reject(new Error(`engine thread died: ${e.message}`))
			}
			const i = all.indexOf(w)
			if (i >= 0) all.splice(i, 1)
			if (!closed) release(spawn())
		})
		all.push(w)
		return w
	}
	const release = (w) => {
		const job = waiting.shift()
		if (job) run(w, job)
		else idle.push(w)
	}
	const run = (w, job) => {
		w.job = job.id
		jobs.set(job.id, job)
		w.postMessage({ id: job.id, scene: job.scene, rate: job.rate })
	}
	for (let i = 0; i < size; i++) idle.push(spawn())
	function simulate(scene, signal, rate = 120) {
		if (closed) return Promise.reject(new Error("the simulation pool is closed"))
		if (signal?.aborted) return Promise.reject(Object.assign(new Error("Cancelled"), { name: "AbortError" }))
		return new Promise((resolve, reject) => {
			const job = { id: next++, scene, rate, resolve, reject }
			const w = idle.pop()
			if (w) run(w, job)
			else waiting.push(job)
		})
	}
	function close() {
		closed = true
		for (const w of all) w.terminate()
	}
	return { simulate, close, size }
}
