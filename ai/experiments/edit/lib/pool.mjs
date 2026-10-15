// Engine threads (sim-worker.mjs) and a cap on model calls in flight (gateway politeness: at most 4 per experiment).
import { Worker } from "node:worker_threads"
import os from "node:os"
import { join } from "node:path"
import { FROZEN } from "./env.mjs"

let pool = null
export function simPool(size = Math.max(2, Math.min(6, os.cpus().length - 4))) {
	if (pool) return pool
	const url = new URL("./sim-worker.mjs", import.meta.url)
	const idle = []
	const waiting = []
	const jobs = new Map()
	let next = 1
	const spawn = () => {
		const w = new Worker(url, { workerData: { sim: join(FROZEN, "web", "sim") } })
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
			release(spawn())
		})
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
	const simulate = (scene, signal, rate = 120) =>
		new Promise((resolve, reject) => {
			if (signal?.aborted) return reject(Object.assign(new Error("Cancelled"), { name: "AbortError" }))
			const job = { id: next++, scene: JSON.parse(JSON.stringify(scene)), rate, resolve, reject }
			const w = idle.pop()
			if (w) run(w, job)
			else waiting.push(job)
		})
	pool = { simulate, size }
	return pool
}

// ---------------------------------------------------------------- at most N model calls in flight, process-wide
const LIMIT = Number(process.env.EDIT_MAX_CALLS ?? 4)
let active = 0
const waiters = []
export async function withSlot(fn) {
	// (a freed slot is handed straight to the next waiter, so the cap is never exceeded)
	if (active >= LIMIT) await new Promise((r) => waiters.push(r))
	else active++
	try {
		return await fn()
	} finally {
		const w = waiters.shift()
		if (w) w()
		else active--
	}
}
export const slots = () => ({ active, waiting: waiters.length, limit: LIMIT })
