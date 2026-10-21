// A long-lived twin of dense_track.ts for web/server.py: the engine modules load once, then each request line
// on stdin  {"id": n, "doc": <scene document>, "rate": <Hz>}  is answered by one line on stdout:
//   <id>\t<ms>\t<track JSON>     or     <id>\terror\t<message as a JSON string>
// The track is dense_track.ts's, already slimmed for the browser: x, y, angle, squash rounded to 5 decimals, t to 6, and a
// static solid that never moves is listed only in frames[0] (readers fall back to frames[0].placements[id]).
// server.py restarts this process when anything under tooling/src/sim/, the engine's math in tools/ (server.py ENGINE_MATH) or this file
// changes, so edits reach the engine.
// The engine runs with the browser bundle's math (tools/engine-math-node.mjs: Math.sin ... pow and ** are tools/fdlibm.ts's, pow correctly
// rounded), so the server's tracks are the bundle's on any machine; the engine is loaded after that, by dynamic import.
// node --no-warnings worker.ts
import { createInterface } from "node:readline"
import "../../tools/engine-math-node.mjs"

const { admitDocument } = await import("../../tooling/src/sim/document.ts")
const { simulate } = await import("../../tooling/src/sim/physics.ts")
const { slimExtras } = await import("../../tooling/src/sim/plugins.ts")

// Same result as Python's round(v, d) except on exact binary ties (a few multiples of 1/64): toFixed is exact decimal rounding.
const round = (v: number, d: number): number => Number(v.toFixed(d))

interface Place {
	x: number
	y: number
	angle: number
	squash?: number
	scale?: number
}

const run = (doc: unknown, rate: number): string => {
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
	return JSON.stringify({ fps: track.fps, frames: slim, impacts: track.impacts, ...slimExtras(track, round) })
}

for await (const line of createInterface({ input: process.stdin })) {
	if (!line.trim()) continue
	let id = 0
	try {
		const req = JSON.parse(line)
		id = req.id
		const t0 = performance.now()
		const out = run(req.doc, Number(req.rate))
		process.stdout.write(`${id}\t${Math.round(performance.now() - t0)}\t${out}\n`)
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e)
		process.stdout.write(`${id}\terror\t${JSON.stringify(msg.trim().split("\n").at(-1) ?? "engine failed")}\n`)
	}
}
