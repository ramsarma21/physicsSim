// The liquids module's AI plug-ins (web/sim/modules/fluids.js `plugin`, registered by web/sim/modules/index.js): its goal kinds (and their spellings,
// field checks, summaries Python == JavaScript on real runs), knobs, how-to and prompt lines, placement rules (a container's inside; a floater started
// at its floating height, a boat lowered to its loaded height with its cargo), every worked example solved and met in the engine bundle (and in the
// AI's prompt with its how line), the edit
// digest's lines (a container, a floater, a sinker, a boat whose fan misses its sail), its change words, and a make-it-work search that finds a sail.
//   node --test web/ai/test/fluids-plugin.test.mjs
import assert from "node:assert/strict"
import { execFileSync } from "../../../tools/child-sync.mjs" // (node's, with the input given to the child as a file: a macOS hang, tools/child-sync.mjs)
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const PG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
// (the worked examples use the flow module's hose, the heat module's bowl and the magnetism module's paper clip)
process.env.PLAYGROUND_MODULES = process.env.PLAYGROUND_MODULES ?? "fluids,measure,flow,heat,magnetism"
const sim = await import(pathToFileURL(join(PG, "web/sim/index.js")).href)
const plugins = await import(pathToFileURL(join(PG, "web/sim/plugins.js")).href)
const { solve } = await import(pathToFileURL(join(PG, "web/ai/solver.js")).href)
const { findFix } = await import(pathToFileURL(join(PG, "web/ai/fixer.js")).href)
const bundle = await import(pathToFileURL(join(PG, "web/sim/engine-worker.js")).href)
const fluids = await import(pathToFileURL(join(PG, "web/sim/modules/fluids.js")).href)
const mod = plugins.modules().find((m) => m.name === "mod_fluids")

const run = (scene) => {
	const p = sim.prepare(scene)
	const track = JSON.parse(JSON.stringify(bundle.run(p.doc, 120)))
	const fin = sim.finish(p.scene, p.doc, p.resolved, track)
	return { scene: p.scene, doc: p.doc, track, summary: fin.summary, resolved: p.resolved }
}
const STAGE = { x0: -0.56, x1: 3.19, y0: -0.16, y1: 2.34 }
const scene = (items, goals = [], seconds = 3) => ({ version: 2, id: "t", name: "t", seconds, release: 0.5, stage: STAGE, items: [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }, ...items], goals })

test("the module is registered with its goal kinds, knobs, how-to, prompt lines and placement rules", () => {
	assert.ok(mod, "mod_fluids is in the registry")
	assert.deepEqual(mod.goals.map((g) => g.kind).sort(), ["climbs", "climbs_higher", "floats", "floats_then_sinks", "level", "sinks"])
	assert.equal(plugins.goalKind("fills_and_sinks")?.kind, "floats_then_sinks", "an alias")
	assert.equal(plugins.goalKind("capillary_rise")?.kind, "climbs", "an alias")
	for (const t of ["capillary-tube", "paper-strip", "soap-drop"]) assert.ok(plugins.knobsFor(t).length > 0, `knobs for ${t}`)
	for (const t of ["capillary-tube", "paper-strip", "soap-drop"]) assert.equal(plugins.heldByModule(t, ["table", t]), true, `${t} is held by the view's stand`)
	for (const g of mod.goals) assert.ok(g.about && g.fields && typeof g.summarize === "function" && typeof g.sample === "function", g.kind)
	for (const t of ["sailboat", "fan", "water-tank", "graduated-cylinder", "foil-boat", "clay-boat", "breeze"]) assert.ok(plugins.knobsFor(t).length > 0, `knobs for ${t}`)
	for (const k of mod.knobs) assert.ok(k.why && k.more && k.less, `${k.type}.${k.key}`)
	assert.match(mod.howto, /average density/)
	assert.match(mod.howto, /5\.6 fan diameters/)
	assert.match(plugins.promptSnippets("plan"), /Liquids/)
	assert.match(plugins.goalKindLines(), /floats \{item\}/)
	assert.equal(plugins.goalKind("float")?.kind, "floats", "an alias")
	assert.equal(plugins.goalKind("water_level")?.kind, "level", "an alias")
	assert.ok(plugins.placeRules().containers.has("water-tank") && plugins.placeRules().containers.has("graduated-cylinder"))
	assert.ok(mod.examples.length >= 10, "one worked example per lesson demo")
})

test("the AI's prompt for a sailboat request carries the module's how-to, goal kinds, knobs and every worked example (ask and how)", async () => {
	const { digestFromCatalog, promptCatalog } = await import(pathToFileURL(join(PG, "ai/catalog-digest.mjs")).href)
	const cat = digestFromCatalog(sim.catalog())
	const p = promptCatalog(cat, { text: "Two toy sailboats in rain-gutter troughs, a fan behind each: which goes farther?" })
	const text = `${p.system}\n${p.extra}`
	assert.match(text, /average density/)
	assert.match(text, /goal floats \{item\}/)
	assert.match(text, /knob sailboat\.sail_area_cm2/)
	assert.ok(mod.examples.length >= 10, "a worked example per lesson demo (F1, F2, F4, F5, F6, F7, F8, F9, F10, F12)")
	for (const ex of mod.examples) {
		assert.equal(typeof ex.how, "string", `${ex.ask}: a how line (the digest lists only examples with one)`)
		assert.ok(text.includes(`e.g. "${ex.ask}": ${ex.how}`), `${ex.ask}: in the prompt`)
	}
})

test("the sail's change words read its own area, never NaN; its size choice and area are one choice in a request", () => {
	const before = { id: "b", type: "sailboat", props: {} }
	const tuned = { id: "b", type: "sailboat", props: { sail_area_cm2: 104 } }
	assert.equal(plugins.changeWords("sailboat", "sail_area_cm2", undefined, 104, (i) => i, { before, after: tuned }), "sail 120 → 104 cm²")
	assert.equal(plugins.changeWords("sailboat", "sail_area_cm2", undefined, 104), "sail set to 104 cm²")
	const big = { id: "b", type: "sailboat", props: { sail: "big", sail_area_cm2: 320 } }
	const w = plugins.changeWords("sailboat", "sail", undefined, "big", (i) => i, { before: tuned, after: big })
	assert.equal(w, "sail small → big (104 → 320 cm²)")
	assert.equal(plugins.changeWords("sailboat", "sail_area_cm2", 104, 320, (i) => i, { before: tuned, after: big }), w, "both keys say the same line, once")
	assert.ok(!/NaN/.test(plugins.changeWords("sailboat", "sail_area_cm2", null, null) ?? ""))
	assert.equal(plugins.keyWords("sailboat", "sail_area_cm2"), "sails?")
	assert.equal(plugins.keyWords("sailboat", "sail"), "sails?")
})

test("open vessels float as hollow hulls; a paper clip laid on water floats on its surface tension (the solver's start)", () => {
	const tank = { type: "water-tank", props: { style: "aquarium" }, x: 1.2, y: 0 }
	const bowl = plugins.floatHeight({ type: "bowl", props: { material: "melamine" }, x: 1.2, angle: 0 }, tank)
	assert.ok(Number.isFinite(bowl) && bowl > 0.18 && bowl < 0.21, `a melamine bowl floats (anchor at ${bowl})`)
	const clip = plugins.floatHeight({ type: "paper-clip", props: {}, x: 1.2, angle: 0 }, tank)
	assert.ok(Math.abs(clip - 0.21152) < 0.0002, `a paper clip rests in its dent on the surface (${clip})`)
	assert.equal(plugins.floatHeight({ type: "paper-clip", props: {}, x: 1.2, angle: 0 }, { ...tank, props: { style: "aquarium", liquid: "vegetable oil" } }), null, "oil cannot hold it")
	const R = run(scene([{ id: "tank", type: "water-tank", x: 1.2, y: 0, props: { style: "aquarium" } }, { id: "clip", type: "paper-clip", x: 1.1, y: clip, props: {} }, { id: "tube", type: "capillary-tube", x: 1.3, y: 0.19, props: { bore_mm: 1 } }], [{ kind: "floats", item: "clip" }, { kind: "climbs", item: "tube", at_least_mm: 29 }], 2))
	assert.deepEqual(R.summary.goals.map((g) => g.ok), [true, true], JSON.stringify(R.summary.goals))
	const lines = mod.digest({ id: "clip", type: "paper-clip" }, R).join(" | ")
	assert.match(lines, /surface tension holds it up with \d/)
	assert.match(mod.digest({ id: "tube", type: "capillary-tube" }, R).join(" | "), /climbed it 29\.\d mm/)
})

test("a plan's liquid goals are checked by their fields", () => {
	const ids = new Set(["boat", "tank"])
	assert.equal(plugins.goalProblem({ kind: "floats", item: "boat" }, ids), null)
	assert.match(plugins.goalProblem({ kind: "sinks" }, ids), /needs item/)
	assert.match(plugins.goalProblem({ kind: "floats", item: "nobody" }, ids), /no item "nobody"/)
	assert.match(plugins.goalProblem({ kind: "level", container: "tank", at_least_ml: "lots" }, ids), /must be a number/)
	assert.equal(plugins.goalProblem({ kind: "level", container: "tank", at_least_ml: 70 }, ids), null)
})

test("placement: a container's inside, a floater at its floating height, a sinker on the floor, a loaded boat lower", () => {
	const inner = plugins.containerInterior("water-tank", { style: "trough" })
	assert.deepEqual(inner, { x0: -1.525, x1: 1.525, floor: 0.003, rim: 0.1 })
	assert.equal(plugins.containerInterior("ball", {}), null)
	const tank = { type: "water-tank", props: { style: "aquarium" }, x: 1.2, y: 0 }
	// a 10 × 5 × 5 cm block of 700 kg/m³: its middle (the anchor) sits 35.05 mm − 25 mm under the surface (the level raised by what it pushes under)
	const y = plugins.floatHeight({ type: "wooden-block", props: { width: 0.1, height: 0.05, depth: 0.05 }, x: 1.2, angle: 0 }, tank)
	const surface = 0.006 + 0.2058 + (0.1 * 0.05 * 0.05 * ((700 - 1.2) / (998.2 - 1.2))) / (0.5 * (0.25 - 0.012))
	assert.ok(Math.abs(y - (surface - 0.03505 + 0.025)) < 2e-5, `block at ${y}`)
	assert.equal(plugins.floatHeight({ type: "clay-ball", props: {}, x: 1.2, angle: 0 }, tank), null, "a sinker stays on the floor")
	const empty = plugins.floatHeight({ type: "foil-boat", props: {}, x: 1.2, angle: 0 }, tank)
	const loaded = plugins.floatHeight({ type: "foil-boat", props: {}, x: 1.2, angle: 0 }, tank, [{ type: "penny", props: { count: 10 } }])
	assert.ok(loaded < empty - 0.004, `10 pennies lower the boat (${(empty - loaded) * 1000} mm)`)
	assert.equal(plugins.floatHeight({ type: "foil-boat", props: {}, x: 1.2, angle: 0 }, tank, [{ type: "penny", props: { count: 40 } }]), null, "too much cargo: it would sink")
	// a sinker's start on the inner floor (for scene makers): a 39.3 mm clay ball's middle half a millimetre above the 6 mm glass floor
	const rest = fluids.restingY({ type: "clay-ball", props: { diameter: 0.0393 }, x: 1.2, angle: 0 }, tank)
	assert.ok(Math.abs(rest - (0.006 + 0.01965 + 0.0005)) < 1e-6, `clay ball rests at ${rest}`)
	// a fan beside a liquid container stands on the view's lab stand: the solver does not call it floating
	assert.equal(plugins.heldByModule("fan", ["table", "water-tank", "sailboat", "fan"]), true)
	assert.equal(plugins.heldByModule("fan", ["table", "fan"]), false)
})

test("the solver starts a floater at rest at its height, a boat at its loaded height with its pennies on it", () => {
	const plan = {
		title: "t", seconds: 2, items: [
			{ id: "tank", type: "water-tank", props: { style: "aquarium" }, place: { on: "table", x: 1.2 } },
			{ id: "block", type: "wooden-block", props: { width: 0.1, height: 0.05, depth: 0.05 }, place: { inside: "tank", on: "tank", x: 1.05 } },
			{ id: "boat", type: "foil-boat", place: { inside: "tank", on: "tank", x: 1.3 } },
			{ id: "coins", type: "penny", props: { count: 12 }, place: { on: "boat", x: 1.3 } }
		], goals: [{ kind: "floats", item: "block" }, { kind: "floats", item: "boat" }], missing: [], tune: [], notes: ""
	}
	const r = solve(plan)
	assert.ok(r.ok !== false, JSON.stringify(r.issues))
	const sc = r.scene
	const R = run({ ...sc, seconds: 2 })
	const moved = (id, part) => Math.abs(R.track.frames.at(-1).placements[`${id}/${part}`].y - R.track.frames[0].placements[`${id}/${part}`].y)
	assert.ok(moved("block", "block") < 0.001, `the block starts at rest (${moved("block", "block")} m)`)
	assert.ok(moved("boat", "floor") < 0.003, `the loaded boat starts near rest (${moved("boat", "floor")} m)`)
	for (const g of R.summary.goals) assert.ok(g.ok, g.label)
	assert.ok(r.placements.find((p) => p.id === "boat")?.cargo?.includes("coins"), "the report names its cargo")
})

test("every worked example builds through the solver and meets its goals in the engine", async () => {
	// (a core goal kind, moves for a soap boat, is judged on each run by the AI's checker, ./goals.js, as the app does: not in the scene's goals)
	const { checkGoals } = await import(pathToFileURL(join(PG, "web/ai/goals.js")).href)
	for (const ex of mod.examples) {
		const r = solve({ title: ex.ask.slice(0, 40), seconds: 4, missing: [], tune: [], notes: "", ...ex.plan })
		const sc = r.scene
		const R = run({ ...sc, seconds: ex.plan.seconds ?? 4 })
		const res = checkGoals(r.goals, { doc: R.doc, track: R.track, summary: R.summary, scene: R.scene })
		assert.equal(res.length, ex.plan.goals.length, `${ex.ask}: every goal judged`)
		for (const g of res) assert.ok(g.ok === true, `${ex.ask}: ${g.label} (${JSON.stringify(g)})`)
	}
})

test("goal summaries: Python == JavaScript on a real run", () => {
	const s = scene([
		{ id: "tank", type: "water-tank", x: 1.2, y: 0, props: { style: "aquarium" } },
		{ id: "ball", type: "steel-ball", x: 1.1, y: 0.25, props: {} },
		{ id: "cork", type: "cork", x: 1.3, y: 0.3, props: {} },
		{ id: "cyl", type: "graduated-cylinder", x: 0.4, y: 0, props: { fill_ml: 50 } },
		{ id: "m", type: "glass-marble", x: 0.4, y: 0.25, props: {} }
	], [{ kind: "sinks", item: "ball" }, { kind: "floats", item: "cork" }, { kind: "floats", item: "ball" }, { kind: "level", container: "cyl", at_least_ml: 51, at_most_ml: 53 }, { kind: "level", container: "tank" }], 3)
	const R = run(s)
	assert.deepEqual(R.summary.goals.map((g) => g.ok), [true, true, false, true, true])
	const py = JSON.parse(execFileSync("python3", ["-c", `
import json, sys, os
sys.path.insert(0, ${JSON.stringify(join(PG, "machines"))})
import items
d = json.load(sys.stdin)
print(json.dumps(items.summarize(d["scene"], d["doc"], d["track"])))
`], { input: JSON.stringify({ scene: R.scene, doc: R.doc, track: R.track }), env: { ...process.env, PLAYGROUND_MODULES: "fluids,measure" }, maxBuffer: 1 << 28 }).toString())
	assert.deepEqual(py.goals, JSON.parse(JSON.stringify(R.summary.goals)))
	assert.deepEqual(py.readings, JSON.parse(JSON.stringify(R.summary.readings)))
	// the AI's own check of a module goal on the run
	assert.equal(plugins.checkModuleGoal({ kind: "sinks", item: "ball" }, { scene: R.scene, doc: R.doc, track: R.track }).ok, true)
	assert.equal(plugins.checkModuleGoal({ kind: "float", item: "ball" }, { scene: R.scene, doc: R.doc, track: R.track }).ok, false)
})

test("the edit digest's lines: a container, a floater, a sinker, a boat whose fan misses its sail", () => {
	const s = scene([
		{ id: "tank", type: "water-tank", x: 1.2, y: 0, props: { style: "aquarium", liquid: "salt water", salt_pct: 12 } },
		{ id: "egg", type: "egg", x: 1.1, y: 0.1, props: {} },
		{ id: "ball", type: "steel-ball", x: 1.3, y: 0.2, props: {} },
		{ id: "lane", type: "water-tank", x: 1.55, y: 0.4, props: { style: "trough" } },
		{ id: "boat", type: "sailboat", x: 0.5, y: 0.48, props: {} },
		{ id: "fan", type: "fan", x: 0.2, y: 0.9, props: { diameter: 0.12 } }
	], [], 4) // (a steel ball bounces on glass under water almost as in air, e ≈ 0.9 at its Stokes number of ~3·10⁴: it settles in about 3 s)
	const R = run(s)
	const lines = (id) => plugins.digestLines(R.scene.items.find((i) => i.id === id), { ...R, resolved: R.resolved })
	assert.match(lines("tank").join(" "), /salt water \(12 % salt\) \(1085\.7 kg\/m³\)/)
	assert.match(lines("tank").join(" "), /its scale reads/)
	assert.match(lines("egg").join(" "), /floats/)
	assert.match(lines("ball").join(" "), /rests on the bottom/)
	assert.match(lines("boat").join(" "), /NO wind reaches its sail/)
})

test("change words in real units", () => {
	assert.equal(plugins.changeWords("sailboat", "sail", "small", "big"), "sail small (120 cm²) → big (320 cm²)")
	assert.equal(plugins.changeWords("water-tank", "salt_pct", 4, 12), "salt 4 → 12 % (1026.8 → 1085.7 kg/m³)")
	assert.equal(plugins.changeWords("water-tank", "liquid", "water", "honey"), "water → honey (998.2 → 1420 kg/m³)")
	assert.equal(plugins.changeWords("graduated-cylinder", "fill_ml", 60, 75), "liquid 60 → 75 mL")
	assert.match(plugins.changeWords("fan", "diameter", 0.3, 0.12), /full-speed jet to 1\.67 → 0\.67 m/)
	assert.equal(plugins.changeWords("ball", "diameter", 0.1, 0.2), null)
	// an added penny item is a stack of its count (the change card: "Added a stack of 20 pennies on the clay boat")
	assert.equal(plugins.addedWords({ type: "penny", props: { count: 20 } }), "a stack of 20 pennies")
	assert.equal(plugins.addedWords({ type: "penny", props: {} }), null)
	assert.equal(plugins.addedWords({ type: "ball", props: { count: 3 } }), null)
})

test("make it work: a boat race that the tiny sail loses is won by changing a sail (the module's knob), found and checked", async () => {
	const lane = (id, y, sail) => {
		const T = { id: `${id}-lane`, type: "water-tank", x: 1.55, y, props: { style: "trough" } }
		const by = plugins.floatHeight({ type: "sailboat", props: { sail }, x: 0.45, angle: 0 }, T)
		const mid = sim.layout(sim.clean(scene([{ id: "b", type: "sailboat", x: 0.45, y: by, props: { sail } }]))).resolved.b.sail_middle
		return [T, { id: `${id}-boat`, type: "sailboat", name: `${id} boat`, x: 0.45, y: by, props: { sail } }, { id: `${id}-fan`, type: "fan", x: 0.15, y: by + mid, props: { diameter: 0.12 } }]
	}
	const s = scene([...lane("a", 0, "tiny"), ...lane("b", 0.35, "small")], [{ kind: "farther", a: "a-boat", b: "b-boat" }], 3)
	const R = run(s)
	assert.equal(R.summary.goals[0].ok, false, "the tiny sail loses")
	const simulate = async (sc) => run(sc)
	const fr = await findFix({ scene: R.scene, sim: R, goals: R.scene.goals }, { simulate, budgetMs: 60000, maxRuns: 120, parallel: 1 })
	assert.equal(fr.status, "found", JSON.stringify({ status: fr.status, runs: fr.runs, tried: fr.tried }))
	const words = JSON.stringify(fr.fix ?? fr)
	assert.match(words, /sail|fan|speed|diameter/, words.slice(0, 400))
})
