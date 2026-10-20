// The mechanics module's parity (machines/mod_mechanics.py against its port web/sim/modules/mechanics.js), through tools/mechanics/py_build.py:
//   - random scenes of the module's types mixed with the catalog's cars, balls and blocks: every prop drawn at random (numbers over their
//     ranges, choices, bools, links to other items), at round and random angles: the same document, resolved values and warnings, or the same error
//   - the catalog entries of the module's types (previews aside), and the catalog-wide props (color, glow, start_speed, start_dir, start_spin) set at
//     random on every type of the catalog: the same documents (a `start` record per moving body, paint and glow on the solids)
//   - the module's goal kinds summarised on real runs (the engine: tooling/src/sim with the bundle's math): the same summary text
//   node tools/mechanics/test.mjs [--n 400] [--seed 12345]
import { execFileSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const PG = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d)
const N = Number(arg("--n", 400))
let seed = Number(arg("--seed", 12345))
await import(pathToFileURL(join(PG, "tools/engine-math-node.mjs")).href)
const sim = await import(pathToFileURL(join(PG, "web/sim/index.js")).href)
const { admitDocument } = await import(pathToFileURL(join(PG, "tooling/src/sim/document.ts")).href)
const { simulate } = await import(pathToFileURL(join(PG, "tooling/src/sim/physics.ts")).href)
const { slimExtras } = await import(pathToFileURL(join(PG, "tooling/src/sim/plugins.ts")).href)

const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
const pick = (a) => a[Math.floor(rnd() * a.length)]
const cat = sim.catalog()
const mine = cat.types.filter((t) => t.module === "mechanics").map((t) => t.key)
const others = ["toy-car", "truck", "motor-car", "cart", "superball", "steel-ball", "glass-marble", "wooden-block", "soccer-ball", "egg", "foam-block"].filter((k) => cat.types.some((t) => t.key === k))
const typeOf = (key) => cat.types.find((t) => t.key === key)
const randProps = (key, all = false) => {
	const p = {}
	for (const sp of typeOf(key).props) {
		if (!all && rnd() < 0.5) continue
		if (sp.kind === "number") p[sp.key] = Math.round((sp.min + rnd() * (sp.max - sp.min)) / (sp.step || 0.001)) * (sp.step || 0.001)
		else if (sp.kind === "int") p[sp.key] = Math.floor(sp.min + rnd() * (sp.max - sp.min + 1))
		else if (sp.kind === "bool") p[sp.key] = rnd() < 0.5
		else if (sp.kind === "choice") p[sp.key] = pick(sp.choices)
	}
	return p
}
const STAGE = { x0: -0.56, x1: 3.19, y0: -0.16, y1: 2.34 }
let bad = 0
const diff = (what, a, b) => {
	bad++
	if (bad > 6) return
	const x = JSON.stringify(a)
	const y = JSON.stringify(b)
	let j = 0
	while (x[j] === y[j]) j++
	console.log(`MISMATCH ${what}\n  py: ${x?.slice(Math.max(0, j - 160), j + 160)}\n  js: ${y?.slice(Math.max(0, j - 160), j + 160)}`)
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// ---------------------------------------------------------------- random scenes
const scenes = []
for (let i = 0; i < N; i++) {
	const items = [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }]
	const n = 1 + Math.floor(rnd() * 5)
	for (let k = 0; k < n; k++) {
		const type = rnd() < 0.75 ? pick(mine) : pick(others)
		items.push({ id: `i${k}`, type, x: Math.round((rnd() * 3 - 0.5) * 1000) / 1000, y: Math.round(rnd() * 1000) / 1000, angle: rnd() < 0.3 ? (rnd() < 0.5 ? Math.round(rnd() * 60 - 30) : Math.round((rnd() * 60 - 30) * 1000) / 1000) : 0, ...(rnd() < 0.15 ? { held: true } : {}), props: randProps(type) })
	}
	for (const it of items) for (const l of typeOf(it.type).links ?? []) if (rnd() < 0.8) it.props[l.key] = pick(items.filter((o) => o !== it)).id
	scenes.push(sim.clean({ version: 2, id: `s${i}`, seconds: 2, release: 0.2, stage: STAGE, items, goals: [] }))
}
// ---------------------------------------------------------------- the catalog-wide props on every type
const common = []
for (const t of cat.types) {
	if (t.key === "table") continue
	const props = {}
	for (const sp of t.props.filter((p) => p.common)) {
		if (sp.kind === "number") props[sp.key] = Math.round((sp.min + rnd() * (sp.max - sp.min)) * 100) / 100
		else if (sp.kind === "bool") props[sp.key] = rnd() < 0.7
		else if (sp.kind === "choice") props[sp.key] = pick(sp.choices)
	}
	common.push(sim.clean({ version: 2, id: `c-${t.key}`, seconds: 1, release: 0.2, stage: STAGE, items: [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }, { id: "it", type: t.key, x: 1.3, y: 0.3, angle: rnd() < 0.5 ? 0 : 20, props }], goals: [] }))
}
// ---------------------------------------------------------------- goal summaries on real runs
const tilt = Math.tan((2 * Math.PI) / 180)
const runs = [
	{ items: [{ id: "lv", type: "lever-kit", x: 1, y: 0.8, props: { load: 0.5, load_at: 0.2, effort: pick([0.25, 0.3, 0.2]), effort_at: 0.4 } }, { id: "wa", type: "wheel-and-axle", x: 2.4, y: 1.6, props: { effort: pick([0.2, 0.4]) } }], goals: [{ kind: "balanced", item: "lv" }, { kind: "rises", item: "lv", min_m: 0.01 }, { kind: "rises", item: "wa" }, { kind: "balanced", item: "wa", max_deg: 1, label: "holds" }, { kind: "gear_speed", item: "wa" }] },
	{ items: [{ id: "g", type: "gear-train", x: 1.3, y: 1.2, props: { teeth_a: pick([10, 12, 20]), teeth_b: pick([24, 36]), teeth_c: pick([0, 20]), rpm: pick([20, 30]), turns: pick(["clockwise", "counter-clockwise"]) } }], goals: [{ kind: "gear_speed", item: "g", rpm: 10 }, { kind: "gear_speed", item: "g", part: "gear-b", direction: "clockwise" }, { kind: "gear_speed", item: "g", rpm: 18, tol: 0.2, direction: "counter-clockwise" }] },
	{ items: [{ id: "track", type: "coaster-track", x: -0.3, y: 0, props: { layout: "loop", height: pick([0.35, 0.6]) } }, { id: "ball", type: "steel-ball", x: -0.27, y: 0.6 - 0.03 * tilt + 0.0127 + 0.0006 }], goals: [{ kind: "loops", item: "ball", track: "track" }], fix: (s) => (s.items[2].y = s.items[1].props.height - 0.03 * tilt + 0.0127 + 0.0006) },
	{ items: [{ id: "a", type: "dynamics-cart", x: 1.3 - 0.086, y: 0, props: { plunger: pick([1, 2, 3]) } }, { id: "b", type: "dynamics-cart", x: 1.3 + 0.086, y: 0, props: { load: pick([0, 0.25, 0.5]), ...(rnd() < 0.3 ? { start_speed: 0.2 } : {}) } }], goals: [{ kind: "recoils", a: "a", b: "b", ratio: 2 }, { kind: "recoils", a: "a", b: "b" }, { kind: "accelerates", item: "b", accel: 1 }] },
	{ items: [{ id: "cart", type: "dynamics-cart", x: 0, y: 0, props: { load: pick([0, 0.25, 0.5]) } }, { id: "p", type: "edge-pulley", x: 3.19, y: 0.016, props: { pulls: "cart", hanging_mass: pick([0.02, 0.05, 0.1]) } }], goals: [{ kind: "accelerates", item: "cart", accel: 0.892 }, { kind: "accelerates", item: "cart", accel: 0.5, tol: 0.5 }, { kind: "pulls_with", item: "p", newtons: 0.44 }, { kind: "pulls_with", item: "p", newtons: 0.3, tol: 0.2 }] },
	{ items: [{ id: "j", type: "screw-jack", x: 1.3, y: 0, props: { load: pick([20, 100, 300]), effort: pick([5, 10, 50]), pitch: pick([2, 5, 10]) } }], goals: [{ kind: "rises", item: "j" }, { kind: "rises", item: "j", min_m: 0.005 }, { kind: "balanced", item: "j" }] },
	{ items: [{ id: "c", type: "dynamics-cart", x: 0.6, y: 0, props: { load: pick([0, 0.5]) } }, { id: "w", type: "puller", x: 2.4, y: 0, props: { pulls: "c", mode: pick(["force", "speed"]), force: pick([0.5, 2]), speed: 0.2, height: 0.0355 } }], goals: [{ kind: "pulls_with", item: "w", newtons: 2 }, { kind: "pulls_with", item: "w", newtons: 0.01, tol: 0.05 }, { kind: "pulls_with", item: "c", newtons: 1 }] },
	{ items: [{ id: "bt", type: "block-and-tackle", x: 1.3, y: 1.8, props: { strands: pick([2, 3, 4]), load: 1, effort: pick([0.35, 0.5, 0.6]) } }], goals: [{ kind: "rises", item: "bt" }, { kind: "balanced", item: "bt" }, { kind: "balanced", item: "nobody" }] },
	// force arrows and energy bars (the forces and energy records): a book at rest, a tug of war, a pendulum, a ball rolling to a stop, a board
	{ items: [{ id: "book", type: "hardcover-book", x: 1.3, y: 0.0, props: { arrows: pick(["all", "all+net", "gravity+support"]), ...(rnd() < 0.5 ? { arrow_scale: 0.05 } : {}) } }], goals: [{ kind: "net_force", item: "book" }, { kind: "net_force", item: "book", at_least_n: 1 }, { kind: "net_force", item: "book", at_most_n: 0.5, at_least_n: 0.1 }] },
	{ items: [{ id: "cart", type: "dynamics-cart", x: 1.3, y: 0, props: { load: 0.75, arrows: "net" } }, { id: "l", type: "puller", x: 0.3, y: 0, props: { pulls: "cart", faces: "right", force: 5 } }, { id: "r", type: "puller", x: 2.3, y: 0, props: { pulls: "cart", faces: "left", force: pick([3, 5]) } }], goals: [{ kind: "net_force", item: "cart", at_least_n: 1.5 }, { kind: "net_force", item: "cart" }] },
	{ settings: { air: pick([false, true]) }, items: [{ id: "pend", type: "pendulum", x: 1.3, y: 1.5, props: { show_energy: true, arrows: "all" } }], goals: [{ kind: "energy_kept", item: "pend" }, { kind: "energy_kept", item: "pend", tol: 0.0001 }, { kind: "energy_to_heat", item: "pend", at_least_pct: 1 }, { kind: "net_force", item: "pend", at_most_n: 1 }] },
	{ items: [{ id: "fl", type: "floor", x: 1.3, y: 0, props: { length: 2.5, material: "carpet" } }, { id: "ball", type: "steel-ball", x: 0.4, y: 0.03, props: { start_speed: pick([0.5, 1.0]) } }, { id: "bars", type: "energy-bars", x: 1.3, y: 0.3, props: { watch: "ball", zero: pick(["lowest", "floor"]) } }], goals: [{ kind: "energy_to_heat", item: "ball" }, { kind: "energy_kept", item: "ball" }, { kind: "energy_to_heat", item: "ball", at_least_pct: 99 }] }
]
const summ = []
for (const r of runs) {
	const sc = { version: 2, id: "g", name: "g", seconds: 2.5, release: 0.2, stage: STAGE, items: [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }, ...r.items], goals: r.goals, ...(r.settings ? { settings: r.settings } : {}) }
	r.fix?.(sc)
	const { scene: s, doc, resolved } = sim.prepare(sc)
	const track = simulate(admitDocument(doc).scene, 120)
	const rd = (v, d) => Number(v.toFixed(d))
	const slim = { fps: track.fps, frames: track.frames.map((f) => ({ t: rd(f.t, 6), placements: Object.fromEntries(Object.entries(f.placements).map(([k, p]) => [k, { x: rd(p.x, 5), y: rd(p.y, 5), angle: rd(p.angle, 5) }])) })), impacts: track.impacts, ...slimExtras(track, rd) }
	summ.push({ scene: s, doc, track: slim, js: sim.finish(s, doc, resolved, slim).summary })
}

const P = JSON.parse(execFileSync("python3", [join(PG, "tools/mechanics/py_build.py")], { input: JSON.stringify({ scenes: [...scenes, ...common], types: mine, summarize: summ.map(({ scene, doc, track }) => ({ scene, doc, track })) }), maxBuffer: 1 << 30 }).toString())
const all = [...scenes, ...common]
let errors = 0
const foreign = []
all.forEach((sc, i) => {
	let js
	try {
		js = sim.layout(sc)
	} catch (e) {
		js = { error: e.message }
	}
	const py = P.builds[i]
	if (py.error || js.error) {
		errors++
		if (!(py.error && js.error)) diff(`${sc.id}: error`, py.error ?? null, js.error ?? null)
		return
	}
	for (const k of ["doc", "resolved", "warnings"]) {
		if (same(py[k], js[k])) continue
		// (a type of another physics module that differs with these props too: said, not counted here; that module's own parity owns it)
		const mod = sc.id.startsWith("c-") ? typeOf(sc.id.slice(2))?.module : null
		if (mod && mod !== "mechanics") {
			foreign.push(`${sc.id.slice(2)} (module ${mod}): ${k}`)
			continue
		}
		diff(`${sc.id}: ${k}`, py[k], js[k])
	}
})
if (foreign.length) console.log(`not this module's (another module's port differs from its Python for that type): ${foreign.join("; ")}`)
const jsTypes = mine.map((k) => typeOf(k)).map(({ preview, ...t }) => t)
if (!same(P.types, jsTypes)) diff("catalog entries", P.types, jsTypes)
summ.forEach((s, i) => {
	const py = P.summaries[i]
	if (!same(py.goals, s.js.goals)) diff(`summary ${i}: goals`, py.goals, s.js.goals)
	if (!same(py.happenings, s.js.happenings)) diff(`summary ${i}: happenings`, py.happenings, s.js.happenings)
})
// ---------------------------------------------------------------- regressions: runs that must not break down (both documents the same, the engine's run whole)
// fuzz-454 (2026-10-20): a parachute at its least props pulled by a 0.92 kg hanging mass over an edge pulley into a fixed cup's wall: its 1 g canopy
// was what the string was tied to, 900 times lighter than what hauled it, and the run broke down (NaN), air or vacuum alike; the string is tied
// to the load now (TIE_PART)
const REGRESSIONS = [
	{ version: 2, id: "fuzz-454", name: "fuzz 454", seconds: 2, release: 0.5, items: [{ id: "i2", type: "parachute", x: 1.5789327566977591, y: 0.5536018480081111, angle: 0, props: { canopy: -0.85, load_mass: -0.995, canopy_mass: -0.03377405468351208, lines: -0.9, material: "nylon canopy", bounce: -1000, friction: -1, rolling: -0.09957194479648024, side: -1000, color: "orange", glow: true, start_speed: -25.25979246944189, start_dir: -486.24674691818655, start_spin: "none" }, held: true }, { id: "i15", type: "cup", x: 1.6533645458053798, y: 0.5852492657024413, angle: 80.6, props: { width: -1.1812222137046047, wall: -0.98, thickness: -0.0026326472386717795, depth: 0.019999999, bottom_ratio: 0.07461977459024638, material: "cardboard", bounce: -1000000000, friction: -1000, rolling: -1000, side: -1000000000, color: "green", glow: true } }, { id: "i20", type: "edge-pulley", x: 1.6538329426199199, y: 0.5765766256256029, angle: 0, props: { hanging_mass: 0.916305112738628, drop: 0.16186493785120545, glow: true, pulls: "i2" }, held: true }], goals: [] }
]
const regressions = [...REGRESSIONS, ...REGRESSIONS.map((r) => ({ ...r, id: `${r.id}-vacuum`, settings: { air: false } })), ...REGRESSIONS.map((r) => ({ ...r, id: `${r.id}-puller`, items: [...r.items.filter((i) => i.type !== "edge-pulley"), { id: "w", type: "puller", x: 2.2, y: 0, props: { pulls: "i2", force: 20 } }] }))]
const RP = JSON.parse(execFileSync("python3", [join(PG, "tools/mechanics/py_build.py")], { input: JSON.stringify({ scenes: regressions.map((r) => sim.clean(r)) }), maxBuffer: 1 << 30 }).toString())
regressions.forEach((r, i) => {
	const sc = sim.clean(r)
	const js = sim.layout(sc)
	const py = RP.builds[i]
	if (py.error || js.error || !same(py.doc, js.doc)) diff(`regression ${r.id}: document`, py.doc ?? py.error, js.doc ?? js.error)
	try {
		simulate(admitDocument(js.doc).scene, 120)
	} catch (e) {
		diff(`regression ${r.id}: the run`, "runs whole", String(e.message))
	}
})

const outcomes = summ.flatMap((s) => s.js.goals.map((g) => g.ok))
console.log(`${scenes.length} random scenes (${errors} raise the same error in both), ${common.length} types with the catalog-wide props set, ${mine.length} catalog entries, ${summ.length} runs (${outcomes.filter(Boolean).length} of ${outcomes.length} goals met), ${regressions.length} regression runs: ${bad} mismatches`)
if (process.argv.includes("--show")) for (const s of summ) for (const g of s.js.goals) console.log(`  ${g.ok ? "met" : "NOT"}  ${g.label}  ${JSON.stringify(Object.fromEntries(Object.entries(g).filter(([k]) => !["label", "ok", "kind"].includes(k))))}`)
process.exit(bad ? 1 : 0)
