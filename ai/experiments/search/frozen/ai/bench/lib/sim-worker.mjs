// One engine thread of the bench's simulation pool (lib/sim-pool.mjs): a scene in, the run out, exactly as POST /api/simulate answers it
// (web/sim prepare -> the engine bundle web/sim/engine-worker.js -> finish). Node has no Web Worker, so the browser engine client would run
// every scene on the main thread; worker_threads keep the event loop free for the gateway calls and let tuning runs go in parallel.
import { parentPort } from "node:worker_threads"
import { prepare, finish } from "../../../web/sim/index.js"
import { handle } from "../../../web/sim/engine-worker.js"

parentPort.on("message", ({ id, scene, rate }) => {
	try {
		const t0 = Date.now()
		const { scene: s, doc, resolved } = prepare(scene)
		const msg = handle({ id, doc, rate: rate ?? 120 })
		if (msg.error !== undefined) throw new Error(msg.error)
		const meta = finish(s, doc, resolved, msg.track)
		parentPort.postMessage({ id, ok: true, sim: { key: "bench", ms: Date.now() - t0, engineMs: msg.ms, track: msg.track, doc: meta.doc, summary: meta.summary, warnings: meta.warnings, resolved: meta.resolved ?? resolved } })
	} catch (e) {
		parentPort.postMessage({ id, ok: false, error: String(e?.message ?? e).split("\n").at(-1) })
	}
})
