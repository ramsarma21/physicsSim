// Stacks placed touching (tooling/src/sim/physics.ts, "Impacts solved for nothing"; web/CONTRACT.md "Engine repair (2026-10-19): stacks placed
// touching stand"): solids placed inside the time-of-impact pass's target of one another (exactly touching, or 0.5 mm apart) must stand as a stack
// built 2 mm apart does, and the pass must still catch a real strike. Every scene is built by web/sim and run by the engine, as the app runs it.
//   node --no-warnings --import ./tools/engine-math-node.mjs research/rw-validate-stack.ts
// Exits 1 when any check fails. Before the repair the first five fail (the 10-block stack spread 1.22 m, the wrecking-ball's bricks walked 3 mm).
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

process.env.PLAYGROUND_MODULES = ""
const PG = join(dirname(fileURLToPath(import.meta.url)), "..")
const sim = await import(pathToFileURL(join(PG, "web/sim/index.js")).href)
const { admitDocument } = await import(pathToFileURL(join(PG, "tooling/src/sim/document.ts")).href)
const { simulate } = await import(pathToFileURL(join(PG, "tooling/src/sim/physics.ts")).href)

type Place = { x: number; y: number; angle: number }
type Track = { frames: { t: number; placements: Record<string, Place> }[]; impacts?: { t: number; a: string; b: string }[] }

let failed = 0
const check = (ok: boolean, what: string, detail: string) => {
	console.log(`${ok ? "PASS" : "FAIL"}  ${what}  (${detail})`)
	if (!ok) failed++
}
const run = (scene: unknown, fps = 120): Track => simulate(admitDocument(sim.prepare(scene).doc).scene, fps)
const table = { id: "table", type: "table", x: 1.3, y: 0 }
/** n blocks of a type h tall in a column at x = 2: the bottom one `bottom` above the table, the rest `gap` apart. */
const column = (type: string, h: number, n: number, gap: number, bottom = gap) =>
	Array.from({ length: n }, (_, i) => ({ id: `b${i}`, type, x: 2, y: h / 2 + bottom + (h + gap) * i }))
const scene = (items: unknown[], seconds = 6) => ({ version: 2, id: "stack", name: "stack", seconds, release: 0.5, items: [table, ...items], goals: [] })
const at = (track: Track, t: number) => track.frames.reduce((best, f) => (Math.abs(f.t - t) < Math.abs(best.t - t) ? f : best)).placements
/** The most any of the solids (all but the table's) moved sideways and turned from the start to time t, and how far any moved from `still` s to the end. */
const motion = (track: Track, t: number, still: number, of = (id: string) => !id.startsWith("table")) => {
	const first = at(track, 0)
	const now = at(track, t)
	const settled = at(track, still)
	const last = at(track, track.frames.at(-1)?.t ?? t)
	let sideways = 0
	let turned = 0
	let late = 0
	for (const id in first) {
		if (!of(id)) continue
		const p = first[id] as Place
		const q = (now[id] ?? p) as Place
		const s = (settled[id] ?? p) as Place
		const e = (last[id] ?? p) as Place
		sideways = Math.max(sideways, Math.abs(q.x - p.x))
		turned = Math.max(turned, Math.abs(q.angle - p.angle))
		late = Math.max(late, Math.hypot(e.x - s.x, e.y - s.y))
	}
	return { sideways, turned: (turned * 180) / Math.PI, late }
}
const stands = (what: string, items: unknown[]) => {
	const track = run(scene(items))
	const m = motion(track, 6, 2)
	check(
		m.sideways <= 0.001 && m.turned <= 1 && m.late <= 1e-5,
		what,
		`moved ${(m.sideways * 1000).toFixed(2)} mm sideways, turned ${m.turned.toFixed(2)}° by 6 s, ${(m.late * 1e6).toFixed(1)} µm after 2 s; limits 1 mm, 1°, 10 µm`
	)
}

// ---- stacks placed inside the pass's target stand (each spread 0.03-1.5 m before the repair)
stands("10 wooden blocks stacked exactly touching stand", column("wooden-block", 0.05, 10, 0))
stands("10 wooden blocks stacked 0.5 mm apart stand", column("wooden-block", 0.05, 10, 0.0005))
stands("10 bricks stacked exactly touching stand", column("brick", 0.065, 10, 0))
stands("blocks 1 mm apart on a bottom block set exactly on the table stand", column("wooden-block", 0.05, 10, 0.001, 0))

// ---- the wrecking-ball scenario: its bricks (0.5 mm apart) hold still until the ball comes
{
	const wb = JSON.parse(readFileSync(join(PG, "web/scenarios/wrecking-ball.json"), "utf8"))
	const track = run(wb)
	const hit = track.impacts?.find((i) => i.a.startsWith("crane") || i.b.startsWith("crane"))
	const before = (hit?.t ?? 1) - 0.01
	const m = motion(track, before, before, (id) => id.startsWith("brick"))
	check(
		hit !== undefined && m.sideways <= 0.0001 && m.turned <= 0.2,
		"wrecking-ball: the bricks hold still until the ball strikes",
		`first strike at ${hit?.t.toFixed(3)} s; by ${before.toFixed(3)} s a brick moved ${(m.sideways * 1000).toFixed(3)} mm sideways, turned ${m.turned.toFixed(3)}°; limits 0.1 mm, 0.2°`
	)
}

// ---- a real strike is still caught
{
	// a steel ball let fall 2 m onto a stack of three blocks placed touching: it lands on the top block, never through it
	const items = [...column("wooden-block", 0.05, 3, 0), { id: "ball", type: "steel-ball", x: 2.02, y: 0.15 + 2 }]
	const track = run(scene(items, 3), 480)
	let deepest = 0
	for (const f of track.frames) {
		const ball = f.placements["ball/ball"] ?? Object.entries(f.placements).find(([id]) => id.startsWith("ball/"))?.[1]
		const top = f.placements["b2/block"] ?? Object.entries(f.placements).find(([id]) => id.startsWith("b2/"))?.[1]
		if (ball === undefined || top === undefined || Math.abs(ball.x - top.x) > 0.05) continue
		deepest = Math.max(deepest, top.y + 0.025 - (ball.y - 0.0127))
	}
	check(deepest <= 0.003, "a steel ball let fall 2 m lands on a touching stack, not through its top block", `at most ${(deepest * 1000).toFixed(2)} mm into it; limit 3 mm`)
}
{
	// a steel ball let fall 3 m (7.7 m/s, 16 mm a step) onto a thin board: the pass stops it on the board's top
	const items = [{ id: "board", type: "plank", x: 2, y: 0.5, props: { thickness: 0.005, legs: false } }, { id: "ball", type: "steel-ball", x: 2, y: 3.5 }]
	const doc = sim.prepare(scene(items, 2)).doc as { solids: { id: string; body: { height?: number } }[] }
	const thick = doc.solids.find((s) => s.id.startsWith("board/"))?.body.height ?? 0
	const track = run(scene(items, 2), 480)
	let lowest = Number.POSITIVE_INFINITY
	for (const f of track.frames) {
		const ball = Object.entries(f.placements).find(([id]) => id.startsWith("ball/"))?.[1]
		if (ball !== undefined && Math.abs(ball.x - 2) < 0.4) lowest = Math.min(lowest, ball.y)
	}
	check(lowest >= 0.5 + thick / 2, "a steel ball let fall 3 m onto a thin board stays on it", `board ${(thick * 1000).toFixed(1)} mm thick; the ball's centre never below ${lowest.toFixed(4)} m (its top at ${(0.5 + thick / 2).toFixed(4)} m)`)
}

console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`)
if (failed > 0) process.exitCode = 1
