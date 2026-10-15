// One engine thread: a scene in, the run out, exactly as POST /api/simulate answers it (web/sim prepare -> engine bundle -> finish),
// from the frozen copy's web/sim (workerData.sim = its directory).
import { parentPort, workerData } from "node:worker_threads"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const { prepare, finish } = await import(pathToFileURL(join(workerData.sim, "index.js")).href)
const { handle } = await import(pathToFileURL(join(workerData.sim, "engine-worker.js")).href)

parentPort.on("message", ({ id, scene, rate }) => {
	try {
		const t0 = Date.now()
		const { scene: s, doc, resolved } = prepare(scene)
		const msg = handle({ id, doc, rate: rate ?? 120 })
		if (msg.error !== undefined) throw new Error(msg.error)
		const meta = finish(s, doc, resolved, msg.track)
		parentPort.postMessage({ id, ok: true, sim: { key: "edit-exp", ms: Date.now() - t0, track: msg.track, doc: meta.doc, summary: meta.summary, warnings: meta.warnings, resolved: meta.resolved ?? resolved } })
	} catch (e) {
		parentPort.postMessage({ id, ok: false, error: String(e?.message ?? e).split("\n").at(-1) })
	}
})
