// The energy module end to end (machines/mod_energy.py, web/sim/modules/energy.js, tooling/src/sim/modules/energy.ts and its additions to the
// circuits, mechanics and flow modules), in the release gate (tools/parity/run.sh):
//   generic   tools/parity/module.mjs: its catalog entries, every type at its defaults and --n random props (links to shafts, cars, nothing or a
//             wrong item), --mix scenes with a fan, a breeze, an LED, a resistor, a waterwheel under a tap, a wheel and axle, a cart and a battery,
//             in a vacuum, a cold or hot room, on the Moon, in a time-lapse: Python == JS; the node engine == the bundle; summaries
//   lessons   the scenes the module is for, which random mixes hardly ever make: a turbine in a fan's jet lighting an LED, windmills lifting cups
//             (turned toward the viewer too), a waterwheel winding a cup either way and lighting an LED through a 5:1 generator with its leads
//             swapped, generators on a windmill, a turbine and a wheel and axle, battery cars with each motor (and wired backward), a turbine with a
//             hobby motor, a fair test of pitch, and the AI's six worked examples as its solver lays them out: the document, resolved values and
//             warnings Python == JS, the node engine == the bundle byte for byte, every placement and reading finite, the summaries Python == JS with
//             their own goals and goals of every energy kind sampled, and each lesson's own goals met
//   node --no-warnings tools/energy/test.mjs [--n 12] [--mix 80] [--per 2] [--seed 7]
import { execFileSync } from "../child-sync.mjs" // (node's, with the input given to the child as a file: a macOS hang, tools/child-sync.mjs)
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { isDeepStrictEqual } from "node:util"
import { firstDiff, runModuleParity } from "../parity/module.mjs"

const PG = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const arg = (k, d) => {
	const i = process.argv.indexOf(k)
	return i >= 0 ? Number(process.argv[i + 1]) : d
}
// (the partners: what turns its rotors and shafts, what its generators light, and what its battery cars are built from)
const partners = [
	{ type: "fan", x: 0.2, y: 0.265, props: { speed: 5, diameter: 0.4 } },
	{ type: "breeze", x: -0.45, y: 0, props: { speed: 5 } },
	{ type: "led", y: 0.006 },
	{ type: "resistor", y: 0.006, props: { ohms: 50 } },
	{ type: "waterwheel", x: 1.2, y: 0.45, props: { load_g: 20 } },
	{ type: "tap", x: 1.284, y: 0.75, props: { flow_ml_s: 140 } },
	{ type: "wheel-and-axle", y: 0.6 },
	{ type: "cart" },
	{ type: "battery", y: 0.0735 }
]
const generic = await runModuleParity({ module: "energy", n: arg("--n", 12), mix: arg("--mix", 80), per: arg("--per", 2), seed: arg("--seed", 7), engine: true, partners })

// ---------------------------------------------------------------- the lessons
let failed = 0
let cases = 0
const ok = (cond, what, detail = "") => {
	cases++
	if (!cond) {
		failed++
		console.log(`FAIL  ${what}${detail ? `  (${detail})` : ""}`)
	}
}
const sim = await import(pathToFileURL(join(PG, "web/sim/index.js")).href)
await (sim.ready ?? Promise.resolve())
const { solve } = await import(pathToFileURL(join(PG, "web/ai/solver.js")).href)
const { checkGoals } = await import(pathToFileURL(join(PG, "web/ai/goals.js")).href)
await import(pathToFileURL(join(PG, "tools/engine-math-node.mjs")).href)
const { admitDocument } = await import(pathToFileURL(join(PG, "tooling/src/sim/document.ts")).href)
const { simulate } = await import(pathToFileURL(join(PG, "tooling/src/sim/physics.ts")).href)
const { slimExtras } = await import(pathToFileURL(join(PG, "tooling/src/sim/plugins.ts")).href)
const B = await import(pathToFileURL(join(PG, "web/sim/engine-worker.js")).href)

const STAGE = { x0: -0.56, x1: 3.19, y0: -0.16, y1: 2.34 }
const scene = (id, items, goals = [], seconds = 4, extra = {}) => ({ version: 2, id, name: id, seconds, release: 0.3, stage: STAGE, items: [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }, ...items], goals, ...extra })
const wire = (id, a, ae, b, be) => ({ id, type: "wire", x: 0, y: 0, props: { a, a_end: ae, b, b_end: be } })
const loop = (src, part, pre = "w") => [wire(`${pre}1`, src, "+", part, "+"), wire(`${pre}2`, part, "-", src, "-")]
// (a fan standing on the table: its middle diameter/2 + 6.5 cm up, the height the rotors are given)
const fan = (x, speed = 5, diameter = 0.4) => ({ id: "fan", type: "fan", x, y: diameter / 2 + 0.065, props: { speed, diameter } })
const tapped = (load = {}) => [
	{ id: "wheel", type: "waterwheel", x: 1.2, y: 0.45, props: load },
	{ id: "tap", type: "tap", x: 1.284, y: 0.75, props: { flow_ml_s: 140, on_at: 0.3 } },
	{ id: "tub", type: "bucket", x: 1.25, y: 0, props: {} }
]
const lessons = [
	scene("turbine-led", [fan(0.55, 6), { id: "wt", type: "wind-turbine", x: 1.0, y: 0, props: { height: 0.265 } }, { id: "led", type: "led", x: 1.45, y: 0.006 }, ...loop("wt", "led")], [{ kind: "lights", item: "led" }], 7),
	scene("turbine-led-yaw", [fan(0.5, 6), { id: "wt", type: "wind-turbine", x: 0.95, y: 0, props: { height: 0.265, yaw: 30, blades: 4 } }, { id: "led", type: "led", x: 1.4, y: 0.006 }, ...loop("wt", "led")], [], 6),
	scene("pinwheel-lift", [fan(0.55, 4), { id: "pw", type: "pinwheel", x: 1.0, y: 0, props: { load_g: 20, height: 0.265 } }], [{ kind: "rises", item: "pw" }], 6),
	scene("pinwheel-yaw-skewer", [{ id: "wind", type: "breeze", x: -0.45, y: 0, props: { speed: 4 } }, { id: "pw", type: "pinwheel", x: 1.0, y: 0, props: { load_g: 45, yaw: 30, axle_mm: 3, facing: "left" } }], [{ kind: "rises", item: "pw" }], 6),
	scene("pinwheel-right", [{ id: "wind", type: "breeze", x: -0.45, y: 0, props: { speed: 4, direction: "to the left" } }, { id: "pw", type: "pinwheel", x: 1.0, y: 0, props: { facing: "right", blades: 8, paper: "card", diameter: 0.3 } }], [], 4),
	scene("waterwheel-lift", tapped({ load_g: 20 }), [{ kind: "rises", item: "wheel" }], 5),
	scene("waterwheel-lift-ccw", tapped({ load_g: 20, winds: "counter-clockwise" }), [], 4),
	scene("waterwheel-gen", [...tapped(), { id: "gen", type: "generator", x: 0.8, y: 0, props: { shaft: "wheel", ratio: 5, leads: "swapped" } }, { id: "led", type: "led", x: 0.6, y: 0.006 }, ...loop("gen", "led")], [{ kind: "lights", item: "led" }], 5),
	scene("waterwheel-gen-backward", [...tapped({ load_g: 10 }), { id: "gen", type: "generator", x: 0.8, y: 0, props: { shaft: "wheel", ratio: 3 } }, { id: "led", type: "led", x: 0.6, y: 0.006 }, ...loop("gen", "led")], [{ kind: "stays_dark", item: "led" }], 4),
	scene("pinwheel-gen", [{ id: "wind", type: "breeze", x: -0.45, y: 0, props: { speed: 5 } }, { id: "pw", type: "pinwheel", x: 1.0, y: 0 }, { id: "gen", type: "generator", x: 0.6, y: 0, props: { shaft: "pw", kind: "hobby motor", ratio: 2 } }, { id: "r", type: "resistor", x: 0.35, y: 0.006, props: { ohms: 10 } }, ...loop("gen", "r")], [], 4),
	scene("turbine-gen-belt", [{ id: "wind", type: "breeze", x: -0.45, y: 0, props: { speed: 6 } }, { id: "wt", type: "wind-turbine", x: 1.0, y: 0, props: { generator: "none" } }, { id: "gen", type: "generator", x: 1.5, y: 0, props: { shaft: "wt", ratio: 2 } }, { id: "led", type: "led", x: 1.8, y: 0.006 }, ...loop("gen", "led")], [], 5),
	scene("turbine-hobby", [{ id: "wind", type: "breeze", x: -0.45, y: 0, props: { speed: 5 } }, { id: "wt", type: "wind-turbine", x: 1.0, y: 0, props: { generator: "hobby motor", load_g: 30, axle_mm: 6 } }, { id: "r", type: "resistor", x: 1.4, y: 0.006, props: { ohms: 5 } }, ...loop("wt", "r")], [], 4),
	scene("wheel-axle-gen", [{ id: "wa", type: "wheel-and-axle", x: 1.2, y: 0.8, props: { effort: 0.4 } }, { id: "gen", type: "generator", x: 0.8, y: 0, props: { shaft: "wa", ratio: 4 } }, { id: "led", type: "led", x: 0.55, y: 0.006 }, ...loop("gen", "led")], [], 3),
	...["geared", "hobby", "solar"].map((kind) =>
		scene(`battery-car-${kind}`, [{ id: "car", type: "cart", x: 0.6, y: 0 }, { id: "bat", type: "battery", x: 0.6, y: 0.0735 }, { id: "mot", type: "motor", x: 0.6, y: 0.2, props: { kind, drives: "wheels", car: "car" } }, ...loop("bat", "mot")], kind === "geared" ? [{ kind: "moves", item: "car", min_m: 0.3 }] : [], 3)
	),
	scene("battery-car-backward", [{ id: "car", type: "toy-car", x: 1.6, y: 0.0005 }, { id: "bat", type: "battery", x: 1.6, y: 0.08455 }, { id: "mot", type: "motor", x: 1.6, y: 0.2, props: { kind: "geared", drives: "wheels", car: "car" } }, wire("w1", "bat", "+", "mot", "-"), wire("w2", "mot", "+", "bat", "-")], [], 3),
	scene("fair-test-pitch", [
		{ id: "wind", type: "breeze", x: -0.45, y: 0, props: { speed: 5 } },
		{ id: "a", type: "wind-turbine", x: 0.4, y: 0, props: { pitch: 20 } }, { id: "ra", type: "resistor", x: 0.75, y: 0.006, props: { ohms: 50 } }, ...loop("a", "ra", "a"),
		{ id: "b", type: "wind-turbine", x: 1.6, y: 0, props: { pitch: 45 } }, { id: "rb", type: "resistor", x: 1.95, y: 0.006, props: { ohms: 50 } }, ...loop("b", "rb", "b")
	], [{ kind: "generates_more", a: "a", b: "b" }, { kind: "generates", item: "a", at_least_v: 1 }], 5),
	scene("moon-vacuum", [{ id: "wind", type: "breeze", x: -0.45, y: 0, props: { speed: 5 } }, { id: "pw", type: "pinwheel", x: 1.0, y: 0, props: { load_g: 10 } }, { id: "wt", type: "wind-turbine", x: 2.0, y: 0 }], [], 2, { settings: { air: false, gravity: "moon" } })
]
// the AI's worked examples, laid out by its solver
const mod = sim.plugins.modules().find((m) => m.name === "mod_energy")
for (const [i, ex] of (mod?.examples ?? []).entries()) {
	const r = solve({ title: `example ${i}`, seconds: 4, missing: [], tune: [], notes: "", ...ex.plan })
	ok(r.ok !== false, `the solver lays out example ${i} (${ex.ask})`, JSON.stringify(r.issues ?? []))
	if (r.ok === false) continue
	lessons.push({ ...r.scene, id: `example-${i}`, name: `example-${i}`, seconds: ex.plan.seconds ?? 4, goals: r.scene.goals ?? [], coreGoals: r.goals })
}

const round = (v, d) => Number(v.toFixed(d))
/** The server's engine (tooling/src/sim in node with the bundle's math), its track slimmed as the server sends it (tools/parity/module.mjs). */
const serverRun = (doc) => {
	const { scene: s } = admitDocument(doc)
	const track = simulate(s, 120)
	const frames = track.frames
	const first = frames[0]?.placements ?? {}
	const still = new Set()
	for (const part of s.solids) {
		const a = first[part.id]
		if (part.kind !== "static" || a === undefined) continue
		let same = true
		for (let k = 1; k < frames.length && same; k++) {
			const b = frames[k]?.placements[part.id]
			same = b !== undefined && b.x === a.x && b.y === a.y && b.angle === a.angle && b.squash === a.squash && b.scale === a.scale
		}
		if (same) still.add(part.id)
	}
	const slim = frames.map((f, k) => {
		const placements = {}
		for (const id in f.placements) {
			if (k > 0 && still.has(id)) continue
			const p = f.placements[id]
			const q = { x: round(p.x, 5), y: round(p.y, 5), angle: round(p.angle, 5) }
			if (p.squash !== undefined) q.squash = round(p.squash, 5)
			if (p.scale !== undefined) q.scale = round(p.scale, 5)
			placements[id] = q
		}
		return { t: round(f.t, 6), placements }
	})
	return JSON.stringify({ fps: track.fps, frames: slim, impacts: track.impacts, ...slimExtras(track, round) })
}
const py = (req) => JSON.parse(execFileSync("python3", [join(PG, "tools/parity/py_module.py")], { input: JSON.stringify({ module: "energy", ...req }), maxBuffer: 1 << 30 }).toString())

let seed = 11
const pick = (a) => {
	seed = (seed * 1103515245 + 12345) % 2147483648
	return a[Math.floor((seed / 2147483648) * a.length)]
}
const plain = lessons.map(({ coreGoals, ...s }) => s)
const P = py({ scenes: plain }).results
const done = []
for (const [k, s] of plain.entries()) {
	const what = s.id
	let J
	try {
		const c = sim.clean(s)
		const r = sim.layout(c)
		J = { doc: r.doc, resolved: r.resolved, warnings: r.warnings, cleaned: c }
	} catch (e) {
		ok(false, `${what}: web/sim builds it`, e.message)
		continue
	}
	ok(P[k].error === undefined && P[k].error500 === undefined, `${what}: Python builds it`, P[k].error ?? P[k].error500)
	ok(isDeepStrictEqual(P[k].doc, J.doc), `${what}: document`, firstDiff(P[k].doc, J.doc))
	ok(isDeepStrictEqual(P[k].resolved, J.resolved), `${what}: resolved`, firstDiff(P[k].resolved, J.resolved))
	ok(isDeepStrictEqual(P[k].warnings, J.warnings), `${what}: warnings`, firstDiff(P[k].warnings, J.warnings))
	ok(J.warnings.length === 0, `${what}: nothing starts inside anything`, JSON.stringify(J.warnings).slice(0, 300))
	const server = serverRun(J.doc)
	const msg = B.handle({ id: k, doc: J.doc, rate: 120 })
	ok(msg.error === undefined && JSON.stringify(msg.track) === server, `${what}: bundle == server engine`, msg.error ?? `${server.length} bytes`)
	const track = JSON.parse(server)
	let finite = true
	for (const f of track.frames) for (const p of Object.values(f.placements)) if (![p.x, p.y, p.angle].every(Number.isFinite)) finite = false
	ok(finite && !/null|NaN|Infinity/.test(JSON.stringify(track.state ?? {})), `${what}: finite placements and readings`)
	// (its own goals, and one of every energy kind its items allow)
	const sampled = mod.goals.map((g) => g.sample?.(J.cleaned, pick)).filter(Boolean)
	done.push({ k, s: { ...J.cleaned, goals: [...(J.cleaned.goals ?? []), ...sampled] }, J, track, own: (J.cleaned.goals ?? []).length })
}
const PS = py({ scenes: done.map((d) => d.s), tracks: done.map((d) => d.track) }).results
let met = 0
let ownTotal = 0
let goalsTotal = 0
for (const [i, d] of done.entries()) {
	const what = d.s.id
	const js = sim.finish(d.s, d.J.doc, d.J.resolved, d.track).summary
	ok(PS[i].error === undefined && isDeepStrictEqual(PS[i].summary, js), `${what}: summary Python == JS (${d.s.goals.length} goals)`, PS[i].error ?? firstDiff(PS[i].summary, js))
	goalsTotal += d.s.goals.length
	// (each lesson's own goals are met, as the AI checks them: the worked examples' goals as its solver gave them, core kinds (moves) too)
	const own = lessons[d.k].coreGoals ?? lessons[d.k].goals ?? []
	const checked = own.length ? checkGoals(own, { doc: d.J.doc, track: d.track, summary: js }) : []
	ok(checked.length === own.length, `${what}: its ${own.length} goals are checked`)
	for (const g of checked) ok(g.ok === true, `${what}: ${g.label}`, JSON.stringify(g).slice(0, 300))
	met += checked.filter((g) => g.ok === true).length
	ownTotal += own.length
}
console.log(`lessons: ${lessons.length} scenes, ${done.length} run in both engines, ${goalsTotal} goals summarised, ${met} of their own ${ownTotal} goals met`)
console.log(`mod_energy lessons: ${cases} checks, ${failed} mismatches`)
process.exit(generic.failed || failed ? 1 : 0)
