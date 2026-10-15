// A worker for the fix search (./fixer.js): runs a candidate scene start to end off the page's thread (web/sim's build, the engine, the summary,
// exactly as web/sim/api.js runs one for the app) and judges the goals on it, sending back only the judgement (never the whole track).
//   new Worker(new URL("./fix-worker.js", import.meta.url), { type: "module" })
//   postMessage({ fix: 1, id, scene, targets })  ->  { fix: 1, id, results, ok, f, warn, ms }  or  { fix: 1, id, error }
import { prepare, finish } from "../sim/index.js"
import { handle } from "../sim/engine-worker.js"
import { judgeRun } from "./fixer.js"

// (the engine bundle answers every message of its own worker: this worker's messages are this worker's, so its listener is skipped. A capture
// listener runs first at the target.)
self.addEventListener(
	"message",
	(e) => {
		const m = e.data
		if (!m || m.fix !== 1) return
		e.stopImmediatePropagation()
		const t0 = performance.now()
		let out
		try {
			const { scene, doc, resolved } = prepare(m.scene)
			const r = handle({ id: 0, doc, rate: 120 })
			if (r.error !== undefined) throw new Error(r.error)
			const meta = finish(scene, doc, resolved, r.track)
			const sim = { doc: meta.doc, track: r.track, summary: meta.summary, warnings: meta.warnings, resolved: meta.resolved ?? resolved }
			out = { fix: 1, id: m.id, ...judgeRun(m.targets, sim, m.scene), ms: Math.round(performance.now() - t0) }
		} catch (err) {
			out = { fix: 1, id: m.id, error: String(err?.message ?? err).slice(0, 300) }
		}
		self.postMessage(out)
	},
	{ capture: true }
)
self.postMessage({ fix: 1, ready: true })
