// A scene's run in node, as the page's own engine makes it (web/sim/api.js simulate: clean -> build -> the engine bundle -> finish), for the
// focus tests: {doc, summary, resolved, track, warnings}. The track is the engine's own (static solids that never move only in frames[0]).
const sim = await import("../../sim/index.js")
const E = await import("../../sim/engine-worker.js")
const RATE = 120 // (web/sim/api.js RATE: what the app asks the engine for)

export function simulate(scene) {
	const s = sim.clean(scene)
	const { doc, resolved } = sim.build(s)
	const r = E.handle({ id: 1, doc, rate: RATE })
	if (r.error !== undefined) throw new Error(`${scene.id ?? scene.name}: ${r.error}`)
	const meta = sim.finish(s, doc, resolved, r.track)
	return { doc: meta.doc, summary: meta.summary, resolved: meta.resolved, track: r.track, warnings: meta.warnings }
}

/** The catalog as GET /api/catalog answers it, and the physics modules' goal kinds (web/sim/plugins.js's registry, filled by importing web/sim). */
export const catalog = () => sim.catalog()
export const plugins = () => globalThis[Symbol.for("sandbox.plugins")] ?? null
