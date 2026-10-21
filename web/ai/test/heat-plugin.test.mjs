// The heat module's AI plug-ins (web/sim/modules/heat-ai.js `plugin`, made by heat.js and registered by web/sim/modules/index.js): its goal kinds
// (their spellings, field checks, summaries Python == JavaScript on a real run), knobs, how-to and prompt lines, placement rules (a bowl's, a cup's
// and a pan's inside), the worked example solved and met in the engine bundle, every lesson demo met in the bundle, the edit digest's lines (an
// ice cube, its salt, a lamp and its target, a thermometer, a cup), its change words, and a make-it-work search that re-aims a lamp.
//   node --test web/ai/test/heat-plugin.test.mjs
import assert from "node:assert/strict"
import { execFileSync } from "../../../tools/child-sync.mjs" // (node's, with the input given to the child as a file: a macOS hang, tools/child-sync.mjs)
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const PG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
// (the lesson demos use other modules' items too: flow's pitcher, optics' sunlight, lens and foil panel, mechanics' paper, matter's warms_by goal,
// circuits' brass)
process.env.PLAYGROUND_MODULES = process.env.PLAYGROUND_MODULES ?? "heat,fluids,measure,flow,optics,mechanics,matter,circuits"
const sim = await import(pathToFileURL(join(PG, "web/sim/index.js")).href)
const plugins = await import(pathToFileURL(join(PG, "web/sim/plugins.js")).href)
const { solve } = await import(pathToFileURL(join(PG, "web/ai/solver.js")).href)
const { findFix } = await import(pathToFileURL(join(PG, "web/ai/fixer.js")).href)
const bundle = await import(pathToFileURL(join(PG, "web/sim/engine-worker.js")).href)
const mod = plugins.modules().find((m) => m.name === "mod_heat")
const DEMOS = JSON.parse(readFileSync(join(PG, "tools/parity/fixtures/heat-demos.json"), "utf8"))

const run = (scene) => {
	const p = sim.prepare(scene)
	const track = JSON.parse(JSON.stringify(bundle.run(p.doc, 24)))
	const fin = sim.finish(p.scene, p.doc, p.resolved, track)
	return { scene: p.scene, doc: p.doc, track, summary: fin.summary, resolved: p.resolved }
}
const STAGE = { x0: -0.56, x1: 3.19, y0: -0.16, y1: 2.34 }
const scene = (items, goals = [], seconds = 10, settings = { room_temp: 22, time_lapse: 600 }) => ({ version: 2, id: "t", name: "t", seconds, release: 0.2, stage: STAGE, settings, items: [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }, ...items], goals })
const cube = (id, x, s, on, name) => ({ id, type: "ice-cube", ...(name ? { name } : {}), x, y: on + s / 2 + 0.0005, props: { width: s, height: s, depth: s } })

test("the module is registered with its goal kinds, knobs, how-to, prompt lines and placement rules", () => {
	assert.ok(mod, "mod_heat is in the registry")
	assert.deepEqual(mod.goals.map((g) => g.kind).sort(), ["bends", "boils", "burns_out", "dew", "dries", "freezes", "melt_fraction", "melts", "melts_first", "passes_through", "reaches", "scorches", "warmer"])
	for (const g of mod.goals) assert.ok(g.about && g.fields && typeof g.summarize === "function" && typeof g.sample === "function", g.kind)
	for (const t of ["salt-pile", "ice-cube", "lamp", "plate", "bowl", "hot-plate", "saucepan", "drink-cup", "spoon", "steel-rod", "meltable", "puddle"]) assert.ok(plugins.knobsFor(t).length > 0, `knobs for ${t}`)
	for (const k of mod.knobs) assert.ok(k.why && k.more && k.less, `${k.type}.${k.key}`)
	assert.match(mod.howto, /TIME-LAPSE/)
	assert.match(mod.howto, /salt-pile goes ON the ice cube/)
	assert.match(plugins.promptSnippets("plan"), /time_lapse/)
	assert.match(plugins.promptSnippets("edit"), /Heat:/)
	assert.match(plugins.promptSnippets("refine"), /Heat:/)
	assert.match(plugins.goalKindLines(), /melts_first \{a, b\}/)
	assert.equal(plugins.goalKind("melts_before")?.kind, "melts_first", "an alias")
	assert.equal(plugins.goalKind("hotter")?.kind, "warmer", "an alias")
	assert.equal(plugins.goalKind("evaporates")?.kind, "dries", "an alias")
	for (const t of ["bowl", "drink-cup", "saucepan"]) assert.ok(plugins.placeRules().containers.has(t), t)
	assert.ok(mod.examples.length >= 12, "one worked example per lesson demo")
	for (const ex of mod.examples) assert.ok(ex.ask && ex.how, ex.ask)
})

test("a plan's heat goals are checked by their fields", () => {
	const ids = new Set(["salted", "plain", "therm"])
	assert.equal(plugins.goalProblem({ kind: "melts_first", a: "salted", b: "plain" }, ids), null)
	assert.match(plugins.goalProblem({ kind: "melts_first", a: "salted" }, ids), /needs b/)
	assert.match(plugins.goalProblem({ kind: "melts", item: "nobody" }, ids), /no item "nobody"/)
	assert.match(plugins.goalProblem({ kind: "reaches", item: "therm", at_least_c: "hot" }, ids), /must be a number/)
	assert.equal(plugins.goalProblem({ kind: "reaches", item: "therm", at_least_c: 99 }, ids), null)
})

test("placement: the inside of a bowl, a cup and a saucepan", () => {
	assert.deepEqual(plugins.containerInterior("bowl", {}), { x0: -0.04125, x1: 0.04125, floor: 0.005, rim: 0.065 })
	const mug = plugins.containerInterior("drink-cup", { style: "mug" })
	assert.ok(mug.x0 < 0 && mug.x1 > 0 && mug.floor > 0 && mug.rim > mug.floor + 0.05, JSON.stringify(mug))
	const pan = plugins.containerInterior("saucepan", {})
	assert.deepEqual([pan.x0, pan.x1, pan.floor, Math.round(pan.rim * 1e9) / 1e9], [-0.09, 0.09, 0.003, 0.103])
	assert.equal(plugins.containerInterior("plate", {}), null, "a plate is not a container: things go ON it")
})

test("the worked example builds through the solver and meets its goal in the engine", () => {
	for (const ex of mod.examples.filter((e) => e.plan)) {
		const r = solve({ missing: [], tune: [], notes: "", ...ex.plan })
		assert.ok(r.ok !== false, JSON.stringify(r.issues))
		const R = run({ ...r.scene, seconds: ex.plan.seconds })
		assert.equal(R.summary.goals.length, ex.plan.goals.length, `${ex.ask}: its goals are in the summary`)
		for (const g of R.summary.goals) assert.ok(g.ok, `${ex.ask}: ${g.label} (${JSON.stringify(g)})`)
		// the salt sits on its cube, the cubes on their plates; the jar stands over its candle
		const salt = R.scene.items.find((i) => i.id === "salt")
		const salted = R.scene.items.find((i) => i.id === "salted")
		if (salt) assert.ok(Math.abs(salt.x - salted.x) < 0.01 && salt.y > salted.y, `the salt is on its cube (${salt.x}, ${salt.y} vs ${salted.x}, ${salted.y})`)
		const jar = R.scene.items.find((i) => i.type === "candle-jar")
		const under = R.scene.items.find((i) => i.id === "c1")
		if (jar) assert.ok(Math.abs(jar.x - under.x) < 0.01 && Math.abs(jar.y - under.y + 0.04) < 0.01, `the jar is over its candle (${jar.x}, ${jar.y} vs ${under.x}, ${under.y})`)
	}
})

test("every lesson demo meets its goals in the engine bundle", () => {
	for (const d of DEMOS) {
		const R = run(d)
		assert.equal(R.summary.goals.length, d.goals.length, d.id)
		for (const g of R.summary.goals) assert.ok(g.ok, `${d.id}: ${g.label} (${JSON.stringify(g)})`)
	}
})

test("goal summaries: Python == JavaScript on a real run", () => {
	const s = scene([
		{ id: "p1", type: "plate", x: 0.8, y: 0, props: {} },
		{ id: "p2", type: "plate", x: 1.4, y: 0, props: { material: "aluminium" } },
		cube("a", 0.8, 0.02, 0.0045),
		cube("b", 1.4, 0.02, 0.0025),
		{ id: "cup", type: "drink-cup", x: 2.0, y: 0, props: { style: "mug", water_temp_c: 70 } },
		{ id: "t", type: "thermometer", x: 2.0, y: 0.012, fixed: true, props: {} }
	], [
		{ kind: "melts_first", a: "b", b: "a" }, { kind: "melts_first", a: "a", b: "b" }, { kind: "melts", item: "a", before_s: 600 },
		{ kind: "melt_fraction", item: "a", at_least: 0.3, at_s: 1800 }, { kind: "reaches", item: "t", at_least_c: 50 }, { kind: "warmer", a: "cup", b: "a" },
		{ kind: "boils", item: "cup" }, { kind: "dries", item: "cup" }, { kind: "dew", item: "cup" }, { kind: "freezes", item: "cup" },
		{ kind: "melts", item: "b", by_min: 20 }, { kind: "melts", item: "b", by_min: 5 }, { kind: "melt_fraction", item: "a", at_least: 0.3, at_min: 30 }, { kind: "warmer", a: "cup", b: "a", at_min: 1 }
	], 8)
	const R = run(s)
	assert.deepEqual(R.summary.goals.map((g) => g.ok), [true, false, false, true, true, true, false, false, false, false, true, false, true, true])
	// (lesson minutes, as the AI writes them, and lesson seconds agree)
	assert.deepEqual(R.summary.goals[12].melted, R.summary.goals[3].melted)
	const py = JSON.parse(execFileSync("python3", ["-c", `
import json, sys, os
sys.path.insert(0, ${JSON.stringify(join(PG, "machines"))})
import items
d = json.load(sys.stdin)
print(json.dumps(items.summarize(d["scene"], d["doc"], d["track"])))
`], { input: JSON.stringify({ scene: R.scene, doc: R.doc, track: R.track }), env: { ...process.env, PLAYGROUND_MODULES: "heat,fluids,measure" }, maxBuffer: 1 << 28 }).toString())
	assert.deepEqual(py.goals, JSON.parse(JSON.stringify(R.summary.goals)))
	assert.deepEqual(py.readings, JSON.parse(JSON.stringify(R.summary.readings)))
	// the AI's own check of a module goal on the run
	assert.equal(plugins.checkModuleGoal({ kind: "melts_before", a: "b", b: "a" }, { scene: R.scene, doc: R.doc, track: R.track }).ok, true)
	assert.equal(plugins.checkModuleGoal({ kind: "boil", item: "cup" }, { scene: R.scene, doc: R.doc, track: R.track }).ok, false)
})

test("the edit digest's lines: an ice cube, its salt, a lamp and its target, a thermometer, a cup", () => {
	const s = scene([
		{ id: "p1", type: "plate", x: 0.8, y: 0, props: {} },
		cube("ice", 0.8, 0.025, 0.0045),
		{ id: "salt", type: "salt-pile", x: 0.8, y: 0.0045 + 0.025 + 0.0013, props: { mass_g: 3 } },
		{ id: "lamp", type: "lamp", x: 0.6, y: 0, props: { target: "ice", power_w: 60 } },
		{ id: "cup", type: "drink-cup", x: 1.6, y: 0, props: { style: "paper", water_temp_c: 80 } },
		{ id: "t", type: "thermometer", x: 1.6, y: 0.012, fixed: true, props: {} }
	], [], 10, { room_temp: 22, time_lapse: 600 })
	const R = run(s)
	const lines = (id) => plugins.digestLines(R.scene.items.find((i) => i.id === id), R).join(" | ")
	assert.match(lines("ice"), /melted/)
	assert.match(lines("ice"), /its temperature/)
	assert.match(lines("salt"), /undissolved/)
	assert.match(lines("lamp"), /incandescent 60 W/)
	assert.match(lines("lamp"), /aimed at ice: \d+ cm from its bulb/)
	assert.match(lines("t"), /reads/)
	assert.match(lines("cup"), /water (79\.\d|80) → \d+(\.\d)? °C/)
})

test("change words in real units", () => {
	assert.equal(plugins.changeWords("salt-pile", "mass_g", 2, 6), "salt 2 → 6 g")
	assert.equal(plugins.changeWords("ice-cube", "width", 0.025, 0.05), null) // (the catalog's own words: "width 2.5 → 5 cm")
	assert.equal(plugins.changeWords("lamp", "bulb", "incandescent", "led"), "incandescent → led bulb")
	assert.equal(plugins.changeWords("lamp", "target", "a", "b", (id) => `cube ${id}`), "lamp aimed at cube a → cube b")
	assert.equal(plugins.changeWords("plate", "material", "ceramic", "aluminium"), "ceramic → aluminium")
	assert.equal(plugins.changeWords("drink-cup", "lid", false, true), "lid off → on")
	assert.equal(plugins.changeWords("hot-plate", "setpoint_c", 250, 400), "hot plate set to 250 → 400 °C")
	assert.equal(plugins.changeWords("ball", "diameter", 0.1, 0.2), null)
})

test("make it work: a lamp aimed at the wrong cube is re-aimed (the module's link knob), found and checked", async () => {
	const s = scene([
		{ id: "p1", type: "plate", x: 0.8, y: 0, props: {} },
		{ id: "p2", type: "plate", x: 1.4, y: 0, props: {} },
		cube("lit", 0.8, 0.02, 0.0045, "Lit cube"),
		cube("dark", 1.4, 0.02, 0.0045, "Dark cube"),
		// (the lamp halfway between the cubes, so its aim decides which melts first: at x 0.6, 20 cm from the lit cube and 80 cm from the
		// dark one, the spill outside its 40° beam warmed the near cube more than the beam warmed the far one, whatever it was aimed at)
		{ id: "lamp", type: "lamp", x: 1.1, y: 0, props: { target: "dark", power_w: 100 } }
	], [{ kind: "melts_first", a: "lit", b: "dark" }], 10, { room_temp: 22, time_lapse: 600 })
	const R = run(s)
	assert.equal(R.summary.goals[0].ok, false, "the lamp warms the other cube")
	const simulate = async (sc) => run(sc)
	const fr = await findFix({ scene: R.scene, sim: R, goals: R.scene.goals }, { simulate, budgetMs: 120000, maxRuns: 80, parallel: 1 })
	assert.equal(fr.status, "found", JSON.stringify({ status: fr.status, runs: fr.runs, tried: fr.tried }).slice(0, 2000))
	const words = JSON.stringify(fr.fix ?? fr)
	assert.match(words, /lamp|target|aim|lit|move/i, words.slice(0, 400))
})

test("make it work: a hot ball that must pass its ring gets cooler; a bimetal strip that must bend further starts hotter (the module's knobs)", async () => {
	const simulate = async (sc) => run(sc)
	// a ball heated to 300 °C sits on its ring for minutes: "it passes through" within a 4 s run needs it cooler (under about 125 °C)
	const b = scene([{ id: "br", type: "ball-and-ring", name: "Ball and ring", x: 1.0, y: 0, props: { ball_temp_c: 300 } }], [{ kind: "passes_through", item: "br" }], 4, { room_temp: 20 })
	const B = run(b)
	assert.equal(B.summary.goals[0].ok, false, "the hot ball stays on the ring")
	const fb = await findFix({ scene: B.scene, sim: B, goals: B.scene.goals }, { simulate, budgetMs: 120000, maxRuns: 60, parallel: 1 })
	assert.equal(fb.status, "found", JSON.stringify({ status: fb.status, runs: fb.runs, tried: fb.tried }).slice(0, 2000))
	assert.match(JSON.stringify(fb.fix ?? fb), /ball|ring|°C/i)
	// a strip at 60 °C bends 1.7 mm: "at least 3 mm" needs it hotter (about 90 °C)
	const s2 = scene([{ id: "bm", type: "bimetal-strip", name: "Strip", x: 1.0, y: 0, props: { start_temp_c: 60 } }], [{ kind: "bends", item: "bm", at_least_mm: 3 }], 2, { room_temp: 20 })
	const S2 = run(s2)
	assert.equal(S2.summary.goals[0].ok, false, "the strip bends too little")
	const fs = await findFix({ scene: S2.scene, sim: S2, goals: S2.scene.goals }, { simulate, budgetMs: 120000, maxRuns: 60, parallel: 1 })
	assert.equal(fs.status, "found", JSON.stringify({ status: fs.status, runs: fs.runs, tried: fs.tried }).slice(0, 2000))
	assert.match(JSON.stringify(fs.fix ?? fs), /strip|°C|start|length/i)
})

test("make it work in few runs: a missed heat goal tries its own aim first (a colder room: the plate made aluminium)", async () => {
	const s = scene([
		{ id: "p1", type: "plate", x: 0.8, y: 0, props: {} },
		cube("plain", 0.8, 0.04, 0.0045, "Plain cube")
	], [{ kind: "melts", item: "plain", by_min: 90 }], 12, { room_temp: 12, time_lapse: 600 })
	const R = run(s)
	assert.equal(R.summary.goals[0].ok, false, "at 12 °C the cube takes longer than 90 min")
	const simulate = async (sc) => run(sc)
	const fr = await findFix({ scene: R.scene, sim: R, goals: R.scene.goals }, { simulate, budgetMs: 120000, maxRuns: 8, parallel: 1 })
	assert.equal(fr.status, "found", JSON.stringify({ status: fr.status, runs: fr.runs, tried: fr.tried }).slice(0, 2000))
	assert.match(JSON.stringify(fr.fix.changes), /aluminium/, JSON.stringify(fr.fix.changes))
	// (and the aims themselves: more salt on the cube that should win, the lamp turned onto it, the dishes)
	const race = scene([
		{ id: "p1", type: "plate", x: 0.8, y: 0, props: {} },
		{ id: "p2", type: "plate", x: 1.4, y: 0, props: {} },
		cube("a", 0.8, 0.04, 0.0045),
		cube("b", 1.4, 0.04, 0.0045),
		{ id: "s", type: "salt-pile", x: 0.8, y: 0.0455, props: { mass_g: 3 } },
		{ id: "lamp", type: "lamp", x: 1.1, y: 0, props: { target: "b" } }
	])
	const kind = plugins.goalKind("melts_first")
	const tries = kind.aim({ kind: "melts_first", a: "a", b: "b" }, { ok: false }, race)
	const said = tries.map((t) => t.changes.map((c) => `${c.id}.${c.key}=${c.to}`).join("+"))
	for (const want of ["s.mass_g=6", "s.mass_g=9", "lamp.target=a", "p1.material=aluminium", "p2.material=foam"]) assert.ok(said.includes(want), `${want} in ${said.join(", ")}`)
})

test("the card's words for heat settings: how they changed, what was added, the words a request names them by", async () => {
	assert.equal(plugins.howWords("lamp", "power_w", 150, 5), "dimmer")
	assert.equal(plugins.howWords("lamp", "beam_angle", 140, 60), "its beam narrower")
	assert.equal(plugins.howWords("hot-plate", "power_w", 600, 1000), "more powerful")
	assert.equal(plugins.addedWords({ type: "salt-pile", props: { mass_g: 3 } }), "a 3 g salt pile")
	assert.equal(plugins.addedWords({ type: "drink-cup", props: { style: "foam", lid: true, water_ml: 200, water_temp_c: 80 } }), "a foam cup of 200 mL of water at 80 °C with a lid")
	for (const [type, key, text] of [["lamp", "bulb", "use a 4 watt LED instead"], ["lamp", "power_w", "a 4 watt bulb"], ["salt-pile", "mass_g", "twice as much salt"], ["drink-cup", "water_temp_c", "warm water instead of ice water"], ["drink-cup", "lid", "put a lid on it"]])
		assert.ok(new RegExp(`\\b(?:${plugins.keyWords(type, key)})\\b`, "i").test(text), `${type}.${key}: "${text}"`)
	const O = await import(pathToFileURL(join(PG, "web/ai/orchestrator.js")).href)
	const a = scene([cube("x", 0.8, 0.04, 0.0045, "Salted cube"), cube("y", 1.4, 0.04, 0.0045, "Plain cube"), { id: "lamp", type: "lamp", name: "Desk lamp", x: 1.1, y: 0, props: { target: "x", bulb: "incandescent", power_w: 150, beam_angle: 140 } }])
	const b = structuredClone(a)
	b.items.find((i) => i.id === "lamp").props = { target: "y", bulb: "led", power_w: 5, beam_angle: 60 }
	const line = O.humanChanges(a, b).join(" | ")
	for (const w of ["dimmer", "its beam narrower", "bulb 150 → 5 W", "beam 140° → 60° wide", "lamp aimed at the salted cube → the plain cube", "incandescent → led bulb"]) assert.ok(line.includes(w), `${w} in: ${line}`)
	assert.doesNotMatch(line, /slower|faster|tilted/)
})
