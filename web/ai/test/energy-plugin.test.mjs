// The energy module's AI plug-ins (web/sim/modules/energy.js `plugin`, registered by web/sim/modules/index.js): its goal kinds (spellings, field
// checks, summaries Python == JavaScript on a real run, the AI's own check), knobs, how-to and prompt lines, request words, every worked example
// (a windmill lifting a cup, a turbine lighting an LED, a fair test of blade pitch, a waterwheel lifting a cup and lighting an LED, a battery car)
// solved and met in the engine bundle, the edit digest's lines (no wind, a generator turning backward, a cup too heavy), its change words, and
// make-it-work searches that find a fix with its knobs: a generator's leads on a clockwise waterwheel, a windmill's cup too heavy for it.
//   node --test web/ai/test/energy-plugin.test.mjs
import assert from "node:assert/strict"
import { execFileSync } from "../../../tools/child-sync.mjs" // (node's, with the input given to the child as a file: a macOS hang, tools/child-sync.mjs)
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const PG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const MODS = "energy,circuits,flow,fluids,mechanics"
process.env.PLAYGROUND_MODULES = process.env.PLAYGROUND_MODULES ?? MODS
const sim = await import(pathToFileURL(join(PG, "web/sim/index.js")).href)
const plugins = await import(pathToFileURL(join(PG, "web/sim/plugins.js")).href)
const { solve, inspect, planFromScene } = await import(pathToFileURL(join(PG, "web/ai/solver.js")).href)
const { checkGoals } = await import(pathToFileURL(join(PG, "web/ai/goals.js")).href)
const { findFix } = await import(pathToFileURL(join(PG, "web/ai/fixer.js")).href)
const bundle = await import(pathToFileURL(join(PG, "web/sim/engine-worker.js")).href)
const mod = plugins.modules().find((m) => m.name === "mod_energy")

const run = (scene) => {
	const p = sim.prepare(scene)
	const track = JSON.parse(JSON.stringify(bundle.run(p.doc, 120)))
	const fin = sim.finish(p.scene, p.doc, p.resolved, track)
	return { scene: p.scene, doc: p.doc, track, summary: fin.summary, resolved: p.resolved }
}
const STAGE = { x0: -0.56, x1: 3.19, y0: -0.16, y1: 2.34 }
const scene = (items, goals = [], seconds = 3) => ({ version: 2, id: "t", name: "t", seconds, release: 0.2, stage: STAGE, items: [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }, ...items], goals })
const breeze = (speed) => ({ id: "wind", type: "breeze", x: -0.4, y: 0, props: { speed } })
const wires = (a, b, pre = "w") => [
	{ id: `${pre}1`, type: "wire", x: 0, y: 0, props: { a, a_end: "+", b, b_end: "+" } },
	{ id: `${pre}2`, type: "wire", x: 0, y: 0, props: { a: b, a_end: "-", b: a, b_end: "-" } }
]
const lines = (R, id) => plugins.digestLines(R.scene.items.find((i) => i.id === id), { ...R, resolved: R.resolved }, { nameOf: (x) => x }).join(" | ")

test("the module is registered with its goal kinds, knobs, how-to, prompt lines and request words", () => {
	assert.ok(mod, "mod_energy is in the registry")
	assert.deepEqual(mod.goals.map((g) => g.kind).sort(), ["generates", "generates_more", "lifts_higher"])
	for (const g of mod.goals) assert.ok(g.about && g.fields && typeof g.summarize === "function" && typeof g.sample === "function" && typeof g.label === "function", g.kind)
	for (const t of ["pinwheel", "wind-turbine", "generator", "waterwheel"]) assert.ok(plugins.knobsFor(t).some((k) => k.module === "mod_energy"), `knobs for ${t}`)
	for (const k of mod.knobs) assert.ok(k.why && k.more && k.less, `${k.type}.${k.key}`)
	assert.match(mod.howto, /FACE THE WIND/)
	assert.match(mod.howto, /650-700 rpm/)
	assert.match(plugins.promptSnippets("plan"), /Energy devices/)
	assert.match(plugins.goalKindLines(), /generates \{item, at_least_v\?, at_least_mw\?\}/)
	assert.equal(plugins.goalKind("makes_electricity")?.kind, "generates", "an alias")
	assert.equal(plugins.goalKind("more_power")?.kind, "generates_more", "an alias")
	assert.equal(plugins.goalKind("lifts_more")?.kind, "lifts_higher", "an alias")
	assert.match(plugins.keyWords("generator", "leads"), /swap/)
	assert.match(plugins.keyWords("pinwheel", "load_g"), /pennies/)
	assert.equal(plugins.addedWords({ type: "pinwheel", props: { load_g: 13 } }), "a paper windmill lifting a 13 g cup of pennies")
	assert.equal(plugins.heldByModule("generator", ["generator"]), true)
	assert.ok(mod.examples.length >= 6)
	for (const ex of mod.examples) assert.ok(typeof ex.how === "string" && ex.how.length > 20, `${ex.ask}: the digest lists an example only with its words (how)`)
})

test("a plan's energy goals are checked by their fields", () => {
	const ids = new Set(["t", "u", "g"])
	assert.equal(plugins.goalProblem({ kind: "generates", item: "t" }, ids), null)
	assert.equal(plugins.goalProblem({ kind: "generates", item: "t", at_least_v: 1.5 }, ids), null)
	assert.match(plugins.goalProblem({ kind: "generates", item: "t", at_least_v: "two" }, ids), /must be a number/)
	assert.match(plugins.goalProblem({ kind: "generates_more", a: "t" }, ids), /needs b/)
	assert.match(plugins.goalProblem({ kind: "lifts_higher", a: "t", b: "nobody" }, ids), /no item "nobody"/)
})

test("every worked example builds through the solver and meets its goals in the engine", () => {
	for (const ex of mod.examples) {
		const r = solve({ title: ex.ask.slice(0, 40), seconds: 4, missing: [], tune: [], notes: "", ...ex.plan })
		assert.ok(r.ok !== false, `${ex.ask}: ${JSON.stringify(r.issues)}`)
		assert.equal(sim.layout(sim.clean(r.scene)).warnings.length, 0, `${ex.ask}: nothing starts inside anything`)
		const R = run({ ...r.scene, seconds: ex.plan.seconds ?? 4 })
		const checked = checkGoals(r.goals, { doc: R.doc, track: R.track, summary: R.summary })
		assert.equal(checked.length, ex.plan.goals.length, `${ex.ask}: its goals are checked`)
		for (const g of checked) assert.ok(g.ok, `${ex.ask}: ${g.label} (${JSON.stringify(g)})`)
	}
})

test("goal summaries: Python == JavaScript on a real run, and the AI's own check", () => {
	// (a fair test of blade pitch, each turbine on its own 50 Ω resistor, and a windmill winch race: a 13 g cup against one far too heavy)
	const s = scene([
		breeze(5),
		{ id: "a", type: "wind-turbine", x: 0.3, y: 0, props: { pitch: 20 } },
		{ id: "ra", type: "resistor", x: 0.6, y: 0.006, props: { ohms: 50 } },
		...wires("a", "ra", "a"),
		{ id: "b", type: "wind-turbine", x: 1.1, y: 0, props: { pitch: 45 } },
		{ id: "rb", type: "resistor", x: 1.4, y: 0.006, props: { ohms: 50 } },
		...wires("b", "rb", "b"),
		{ id: "p", type: "pinwheel", x: 1.9, y: 0, props: { load_g: 13 } },
		{ id: "q", type: "pinwheel", x: 2.5, y: 0, props: { load_g: 150 } }
	], [
		{ kind: "generates", item: "a", at_least_v: 1 }, { kind: "generates_more", a: "a", b: "b" }, { kind: "lifts_higher", a: "p", b: "q" },
		{ kind: "generates", item: "b", at_least_mw: 1000 }, { kind: "generates_more", a: "b", b: "a" }, { kind: "lifts_higher", a: "q", b: "p" }
	], 5)
	const R = run(s)
	assert.deepEqual(R.summary.goals.map((g) => g.ok), [true, true, true, false, false, false], JSON.stringify(R.summary.goals))
	const py = JSON.parse(execFileSync("python3", ["-c", `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(PG, "machines"))})
import items
d = json.load(sys.stdin)
print(json.dumps(items.summarize(d["scene"], d["doc"], d["track"])))
`], { input: JSON.stringify({ scene: R.scene, doc: R.doc, track: R.track }), env: { ...process.env, PLAYGROUND_MODULES: MODS }, maxBuffer: 1 << 28 }).toString())
	assert.deepEqual(py.goals, JSON.parse(JSON.stringify(R.summary.goals)))
	assert.deepEqual(py.readings, JSON.parse(JSON.stringify(R.summary.readings)))
	assert.equal(plugins.checkModuleGoal({ kind: "generates", item: "a", at_least_v: 1 }, { scene: R.scene, doc: R.doc, track: R.track }).ok, true)
	assert.equal(plugins.checkModuleGoal({ kind: "lifts_more", a: "p", b: "q" }, { scene: R.scene, doc: R.doc, track: R.track }).ok, true)
	assert.equal(plugins.checkModuleGoal({ kind: "more_power", a: "b", b: "a" }, { scene: R.scene, doc: R.doc, track: R.track }).ok, false)
})

test("the edit digest: the wind on a rotor and its speed, no wind at all, a generator turning backward, a cup too heavy or wound to the top, a battery car's motor", () => {
	const still = run(scene([{ id: "t", type: "wind-turbine", x: 1.2, y: 0 }], [], 1))
	assert.match(lines(still, "t"), /NO wind reaches it/)
	const windy = run(scene([breeze(5), { id: "t", type: "wind-turbine", x: 1.2, y: 0, props: { generator: "none" } }], [], 4))
	assert.match(lines(windy, "t"), /wind on it 5 m\/s; turning \d{3} rpm/)
	const back = run(scene([
		{ id: "w", type: "waterwheel", x: 1.2, y: 0.45 }, { id: "tap", type: "tap", x: 1.284, y: 0.75, props: { flow_ml_s: 140, on_at: 0.1 } },
		{ id: "g", type: "generator", x: 0.8, y: 0, props: { shaft: "w", ratio: 5 } }
	], [], 2))
	assert.match(lines(back, "g"), /on the shaft of w through a 5:1 step-up/)
	assert.match(lines(back, "g"), /BACKWARD/)
	const heavy = run(scene([breeze(4), { id: "p", type: "pinwheel", x: 1.2, y: 0, props: { load_g: 200 } }], [], 2))
	assert.match(lines(heavy, "p"), /NOT lifted/)
	assert.match(lines(heavy, "p"), /does not turn: its cup is too heavy/)
	const wound = run(scene([breeze(5), { id: "t", type: "wind-turbine", x: 1.2, y: 0, props: { load_g: 30 } }], [], 5))
	assert.match(lines(wound, "t"), /stopped turning when its cup was wound all the way up to its shaft/, "a winch stops at the top: no fault")
	const sinking = run(scene([{ id: "w", type: "waterwheel", x: 1.2, y: 0.45, props: { load_g: 600 } }, { id: "tap", type: "tap", x: 1.284, y: 0.75, props: { flow_ml_s: 140, on_at: 0.1 } }], [], 3))
	assert.match(lines(sinking, "w"), /its thread on the left: it winds up as the wheel turns clockwise; it FELL \d/, "600 g on a 12 mm spool is too heavy for a 140 mL/s stream")
	const car = run(scene([
		{ id: "c", type: "cart", x: 0.4, y: 0 }, { id: "bat", type: "battery", x: 0.4, y: 0.0735 },
		{ id: "m", type: "motor", x: 0.4, y: 0.2, props: { kind: "geared", drives: "wheels", car: "c" } }, ...wires("bat", "m")
	], [], 2))
	assert.match(lines(car, "m"), /drives the rear wheels of c/)
	const lost = run(scene([{ id: "m", type: "motor", x: 0.4, y: 0.006, props: { kind: "geared", drives: "wheels", car: "nobody" } }], [], 1))
	assert.match(lines(lost, "m"), /names no car/)
})

test("a battery car's motor rides on its car: wherever the plan puts its item, it has no outline there, so nothing is moved or warned about for it (V2 release round 3: 'There's no room for Geared motor where it was asked to be: it goes through Battery' capped a working battery car at 6/10)", () => {
	const typeOf = (id) => ({ c: "cart", car: "toy-car", bat: "battery" })[id]
	assert.equal(plugins.ridesOn({ type: "motor", props: { kind: "geared", drives: "wheels", car: "c" } }, typeOf), "c")
	assert.equal(plugins.ridesOn({ type: "motor", props: { kind: "geared", drives: "wheels", car: "bat" } }, typeOf), null, "a link to no car: a motor on its stand")
	assert.equal(plugins.ridesOn({ type: "motor", props: { kind: "geared", drives: "propeller", car: "c" } }, typeOf), null)
	assert.equal(plugins.ridesOn({ type: "motor", props: { kind: "geared", drives: "wheels" } }, typeOf), null)
	const wired = [
		{ id: "w1", type: "wire", props: { a: "battery", a_end: "+", b: "motor", b_end: "+" }, place: { on: "air", x: 0, y_m: 0 } },
		{ id: "w2", type: "wire", props: { a: "motor", a_end: "-", b: "battery", b_end: "-" }, place: { on: "air", x: 0, y_m: 0 } }
	]
	const plan = (motorPlace, batteryPlace, { motorFirst = false, extra = [] } = {}) => {
		const car = { id: "car", type: "toy-car", name: "Toy car", place: { on: "table", x: 1.0 } }
		const battery = { id: "battery", type: "battery", name: "Battery (2 AA)", place: batteryPlace }
		const motor = { id: "motor", type: "motor", name: "Geared motor", props: { kind: "geared", drives: "wheels", car: "car" }, place: motorPlace }
		return { title: "Battery car", seconds: 4, release: 0.5, missing: [], tune: [], notes: "", items: [car, ...(motorFirst ? [motor, battery] : [battery, motor]), ...extra, ...wired], goals: [{ kind: "moves", item: "car", min_m: 0.3 }] }
	}
	const block = { id: "block", type: "wooden-block", name: "Block", fixed: true, place: { on: "table", x: 0.4 } }
	const cases = [
		["on the car beside its battery (the release's own build)", { on: "car" }, { on: "car" }, {}],
		["on the car, put there before its battery", { on: "car" }, { on: "car" }, { motorFirst: true }],
		["on the table where a block stands (a lane's floor over a motor left on the table)", { on: "table", x: 0.4 }, { on: "car" }, { extra: [block] }],
		["past the table's end", { on: "table", x: 3.3 }, { on: "car" }, {}],
		["with the battery set on the motor", { on: "car" }, { on: "motor" }, { motorFirst: true }]
	]
	let first = null
	for (const [what, mp, bp, o] of cases) {
		const r = solve(plan(mp, bp, o))
		assert.deepEqual(r.issues.filter((i) => i.level !== "info").map((i) => i.text), [], `${what}: no warning`)
		assert.ok(!r.issues.some((i) => /moved|raised|shifted/.test(i.code)), `${what}: nothing moved: ${r.issues.map((i) => i.text).join(" | ")}`)
		const at = Object.fromEntries(r.scene.items.map((i) => [i.id, i]))
		assert.equal(at.car.x, 1.0, `${what}: the car where it was asked to be (no shift)`)
		assert.equal(at.battery.x, 1.0, `${what}: the battery on the car`)
		assert.ok(Math.abs(at.battery.y - 0.08455) < 0.002, `${what}: the battery on the car's top (y ${at.battery.y})`)
		if (Number.isFinite(mp.x)) assert.equal(at.motor.x, mp.x, `${what}: the motor's item where the plan put it`)
		if (o.extra) assert.equal(at.block.x, 0.4, `${what}: the block where it was asked to be`)
		assert.equal(sim.layout(sim.clean(r.scene)).warnings.length, 0, `${what}: nothing starts inside anything`)
		assert.deepEqual(inspect(r.scene).overlaps.filter((v) => v.depth > 0.0005), [], `${what}: inspect() finds no overlap`)
		// (an edit's plan of the scene solves back to it: the motor kept where its item is, the battery on the car)
		const back = solve(planFromScene(r.scene)).scene.items
		for (const it of r.scene.items) {
			const b = back.find((q) => q.id === it.id)
			assert.ok(b && Math.abs(b.x - it.x) < 1e-6 && Math.abs(b.y - it.y) < 1e-6, `${what}: ${it.id} round trip`)
		}
		first ??= r
	}
	// (and the car still drives: the engine mounts the motor on it, wherever its item stands)
	const R = run({ ...first.scene, seconds: 4 })
	const checked = checkGoals(first.goals, { doc: R.doc, track: R.track, summary: R.summary })
	assert.ok(checked.length === 1 && checked[0].ok, JSON.stringify(checked))
})

test("change words in real units", () => {
	assert.equal(plugins.changeWords("wind-turbine", "pitch", 20, 45), "blades at 20° → 45°")
	assert.equal(plugins.changeWords("pinwheel", "blades", 4, 8), "4 → 8 sails")
	assert.equal(plugins.changeWords("pinwheel", "load_g", 13, 33), "cup of pennies 13 → 33 g")
	assert.equal(plugins.changeWords("generator", "ratio", 1, 5), "step-up 1:1 → 5:1 (a 140 → 700 rpm generator on a 140 rpm wheel: 0.413 → 2.07 V)")
	assert.equal(plugins.changeWords("generator", "leads", "normal", "swapped"), "leads normal → swapped")
	assert.equal(mod.words.change("ball", "diameter", 0.1, 0.2), null, "only its own items' keys")
})

test("make it work: an LED on a generator that a clockwise waterwheel turns backward is lit by swapping the generator's leads", async () => {
	const s = scene([
		{ id: "w", type: "waterwheel", name: "Wheel", x: 1.2, y: 0.45 },
		{ id: "tap", type: "tap", name: "Tap", x: 1.284, y: 0.75, props: { flow_ml_s: 140, on_at: 0.1 } },
		{ id: "tub", type: "bucket", x: 1.25, y: 0 },
		{ id: "g", type: "generator", name: "Generator", x: 0.8, y: 0, props: { shaft: "w", ratio: 5 } },
		{ id: "led", type: "led", name: "LED", x: 0.55, y: 0.006 },
		...wires("g", "led")
	], [{ kind: "lights", item: "led" }], 3)
	const R = run(s)
	assert.equal(R.summary.goals[0].ok, false, "the LED is wired + to + on a generator turning backward: dark")
	const fr = await findFix({ scene: R.scene, sim: R, goals: R.scene.goals }, { simulate: async (sc) => run(sc), budgetMs: 120000, maxRuns: 60, parallel: 1 })
	assert.equal(fr.status, "found", JSON.stringify({ status: fr.status, runs: fr.runs, tried: fr.tried }))
	assert.ok(fr.fix.changes.some((c) => c.kind === "prop" && c.id === "g" && c.key === "leads" && c.to === "swapped"), JSON.stringify(fr.fix.changes))
})

test("make it work: a windmill whose cup is too heavy to lift gets a lighter cup or a thinner axle (checked in the engine)", async () => {
	const s = scene([breeze(4), { id: "p", type: "pinwheel", name: "Windmill", x: 1.2, y: 0, props: { load_g: 70 } }], [{ kind: "rises", item: "p" }], 3)
	const R = run(s)
	assert.equal(R.summary.goals[0].ok, false, "70 g is more than its sails lift on a 6 mm straw")
	const fr = await findFix({ scene: R.scene, sim: R, goals: R.scene.goals }, { simulate: async (sc) => run(sc), budgetMs: 120000, maxRuns: 60, parallel: 1 })
	assert.equal(fr.status, "found", JSON.stringify({ status: fr.status, runs: fr.runs, tried: fr.tried }))
	assert.match(JSON.stringify(fr.fix ?? fr), /pennies|axle|wind|bigger|sails/i)
})
