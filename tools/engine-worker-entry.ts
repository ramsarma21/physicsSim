// The physics engine as a browser Web Worker: the same per-request work as research/poc/worker.ts (which web/server.py runs in node),
// minus the stdin/stdout line protocol. Bundled by tools/build-engine.mjs into web/sim/engine-worker.js.
//   in:  postMessage({id, doc, rate})   doc = the scene document (what /api/layout calls "doc"), rate = frames per second (Hz)
//   out: {id, ms, track}  or  {id, error}   (error = the last line of the engine's message, as the server's worker sends it)
// track = {fps, frames: [{t, placements: {solid id: {x, y, angle, squash?}}}], impacts}, with x, y, angle, squash rounded to 5 decimals,
// t to 6, and a static solid that never moves listed only in frames[0]. It equals the server's track once that has gone through JSON:
// numbers come out as JSON would write them (no -0, no NaN or Infinity: those are null there).
// The build (tools/build-engine.mjs) swaps Math.sin/cos/atan2/exp/hypot/pow and `**` for tools/fdlibm.ts, so the bits match node's in every browser.
// Keep `run` in step with research/poc/worker.ts (the server's copy): the parity test (tools/parity-engine.mjs) compares them.
import { admitDocument } from "../tooling/src/sim/document.ts"
import { simulate } from "../tooling/src/sim/physics.ts"
import { slimExtras } from "../tooling/src/sim/plugins.ts"

// Same result as Python's round(v, d) except on exact binary ties: toFixed is exact decimal rounding. `+ 0` turns -0 into 0 (JSON has no -0).
const round = (v: number, d: number): number => (Number.isFinite(v) ? Number(v.toFixed(d)) + 0 : (null as unknown as number))

// What JSON.stringify would write for a value, as a value (for the small parts the engine hands back unrounded).
const asJson = (v: unknown): unknown => {
	if (typeof v === "number") return Number.isFinite(v) ? v + 0 : null
	if (Array.isArray(v)) return v.map(asJson)
	if (typeof v === "object" && v !== null) {
		const o: Record<string, unknown> = {}
		for (const [k, x] of Object.entries(v)) if (x !== undefined) o[k] = asJson(x)
		return o
	}
	return v
}

interface Place {
	x: number
	y: number
	angle: number
	squash?: number
	scale?: number
}

export const run = (doc: unknown, rate: number) => {
	const { scene } = admitDocument(doc)
	const track = simulate(scene, rate)
	const frames = track.frames
	const first = frames[0]?.placements ?? {}
	// A static solid whose placement is identical in every frame is sent once, in frame 0.
	const still = new Set<string>()
	for (const part of scene.solids) {
		const a = first[part.id] as Place | undefined
		if (part.kind !== "static" || a === undefined) continue
		let same = true
		for (let k = 1; k < frames.length && same; k++) {
			const b = frames[k]?.placements[part.id] as Place | undefined
			same = b !== undefined && b.x === a.x && b.y === a.y && b.angle === a.angle && b.squash === a.squash && b.scale === a.scale
		}
		if (same) still.add(part.id)
	}
	const slim = frames.map((f, k) => {
		const placements: Record<string, Place> = {}
		for (const id in f.placements) {
			if (k > 0 && still.has(id)) continue
			const p = f.placements[id] as Place
			const q: Place = { x: round(p.x, 5), y: round(p.y, 5), angle: round(p.angle, 5) }
			if (p.squash !== undefined) q.squash = round(p.squash, 5)
			if (p.scale !== undefined) q.scale = round(p.scale, 5)
			placements[id] = q
		}
		return { t: round(f.t, 6), placements }
	})
	// (a module's readings and events, tooling/src/sim/plugins.ts: only when the run made any, so a plain track is what it was)
	return { fps: asJson(track.fps) as number, frames: slim, impacts: asJson(track.impacts) as typeof track.impacts, ...slimExtras(track, round) }
}

type Request = { id: number; doc: unknown; rate: number }

// One request -> one answer, exactly what the worker posts back (the main-thread fallback in web/sim/engine.js calls this too).
export const handle = ({ id, doc, rate }: Request): { id: number; ms: number; track: ReturnType<typeof run> } | { id: number; error: string } => {
	try {
		const t0 = performance.now()
		const track = run(doc, Number(rate))
		return { id, ms: Math.round(performance.now() - t0), track }
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err)
		return { id, error: msg.trim().split("\n").at(-1) ?? "engine failed" }
	}
}

type Scope = { addEventListener(type: "message", fn: (e: { data: Request }) => void): void; postMessage(m: unknown): void }
declare const WorkerGlobalScope: { new (): unknown } | undefined

// Only inside a Worker: imported on the main thread (the no-Workers fallback) or in node, the module just exports `run` and `handle`.
if (typeof WorkerGlobalScope !== "undefined" && globalThis instanceof WorkerGlobalScope) {
	const scope = globalThis as unknown as Scope
	scope.addEventListener("message", (e) => scope.postMessage(handle(e.data)))
}
