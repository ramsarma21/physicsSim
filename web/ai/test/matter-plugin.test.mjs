// The matter module's AI plug-ins (web/sim/modules/matter.js `plugin`, registered by web/sim/modules/index.js): its goal kinds (their
// spellings, field checks, summaries Python == JavaScript on a real run, the AI's own goal check), knobs (each turns a real prop), how-to,
// prompt lines, worked requests (every one validated, solved and met in the engine bundle), placement (an ice cube inside a zip bag), the
// catalog digest's part, the edit digest's lines, its change words and request words, every lesson demo met in the bundle, and a make-it-work
// search that finds a fix with the module's own knobs.
//   node --test web/ai/test/matter-plugin.test.mjs
import assert from "node:assert/strict"
import { execFileSync } from "../../../tools/child-sync.mjs" // (node's, with the input given to the child as a file: a macOS hang, tools/child-sync.mjs)
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const PG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const MODS = "matter,measure,heat,fluids,magnetism"
process.env.PLAYGROUND_MODULES = process.env.PLAYGROUND_MODULES ?? MODS
const sim = await import(pathToFileURL(join(PG, "web/sim/index.js")).href)
const plugins = await import(pathToFileURL(join(PG, "web/sim/plugins.js")).href)
const { solve } = await import(pathToFileURL(join(PG, "web/ai/solver.js")).href)
const { findFix } = await import(pathToFileURL(join(PG, "web/ai/fixer.js")).href)
const { checkGoals } = await import(pathToFileURL(join(PG, "ai/goals.mjs")).href)
const { validatePlan } = await import(pathToFileURL(join(PG, "ai/schemas.mjs")).href)
const { digestFromCatalog } = await import(pathToFileURL(join(PG, "ai/catalog-digest.mjs")).href)
const bundle = await import(pathToFileURL(join(PG, "web/sim/engine-worker.js")).href)
const mod = plugins.modules().find((m) => m.name === "mod_matter")
const DEMOS = JSON.parse(readFileSync(join(PG, "tools/parity/fixtures/matter-demos.json"), "utf8"))
const TYPES = ["particle-box", "syringe", "balloon-bath", "dissolving-glass", "zip-bag", "chocolate-bar", "reaction-bottle", "pumped-ball", "mixture-dish", "sieve", "filter-funnel", "evaporating-dish", "density-cube", "equal-mass-block"]

const run = (scene) => {
	const p = sim.prepare(scene)
	const track = JSON.parse(JSON.stringify(bundle.run(p.doc, 24)))
	const fin = sim.finish(p.scene, p.doc, p.resolved, track)
	return { scene: p.scene, doc: p.doc, track, summary: fin.summary, resolved: p.resolved }
}
const STAGE = { x0: -0.56, x1: 3.19, y0: -0.16, y1: 2.34 }
const scene = (items, goals = [], seconds = 3, settings = undefined) => ({ version: 2, id: "t", name: "t", seconds, release: 0.3, stage: STAGE, ...(settings ? { settings } : {}), items: [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }, ...items], goals })
// a kitchen scale's platform top is 2.6 cm above where it stands
const SCALE_TOP = 0.026

test("the module is registered with its goal kinds, knobs, how-to, prompt lines, request words and worked requests", () => {
	assert.ok(mod, "mod_matter is in the registry")
	// (the module's kinds: at least these; the chemistry kinds come with their own tests)
	const kinds = mod.goals.map((g) => g.kind)
	for (const k of ["crystallizes", "dissolves", "dissolves_first", "holds_at", "mass_changes", "mass_same", "mixes", "pressure", "saturates", "separates", "state", "volume"]) assert.ok(kinds.includes(k), k)
	// (closed containers, 20 Oct: an edit that opens or seals one may change its goals; the edit line says what the scale then does)
	for (const t of ["Take the cap off the bottle", "uncap it", "put the cap back on", "seal the bag", "remove the balloon"]) assert.ok(plugins.moduleRegoals(t), t)
	for (const t of ["make the car faster", "use a coffee filter", "stir it more"]) assert.ok(!plugins.moduleRegoals(t), t)
	assert.match(mod.prompt.edit, /Opening a sealed container/)
	assert.match(mod.howto, /holds_at/)
	for (const g of mod.goals) assert.ok(g.about && g.fields && typeof g.summarize === "function" && typeof g.sample === "function" && typeof g.label === "function", g.kind)
	for (const t of ["particle-box", "syringe", "balloon-bath", "dissolving-glass", "reaction-bottle", "pumped-ball", "mixture-dish", "sieve", "chocolate-bar", "filter-funnel", "evaporating-dish"]) assert.ok(plugins.knobsFor(t).length > 0, `knobs for ${t}`)
	for (const k of mod.knobs) assert.ok(k.why && k.more && k.less, `${k.type}.${k.key}`)
	// every knob turns a real prop of its type (a link knob: a link prop)
	const types = Object.fromEntries(sim.catalog().types.map((t) => [t.key, t]))
	for (const t of TYPES) assert.ok(types[t], `${t} is in the catalog`)
	for (const k of mod.knobs) assert.ok(k.how === "link" ? types[k.type]?.links?.some((l) => l.key === k.key) : types[k.type]?.props.some((p) => p.key === k.key), `${k.type} has a ${k.how === "link" ? "link" : "prop"} ${k.key}`)
	// every request word list is a valid regex naming a real prop
	for (const [tk, w] of Object.entries(mod.words.keys)) {
		const [t, key] = tk.split(".")
		assert.ok(types[t]?.props.some((p) => p.key === key) || types[t]?.links?.some((l) => l.key === key), `${tk} is a real prop or link`)
		assert.doesNotThrow(() => new RegExp(w), tk)
	}
	assert.match(new RegExp(plugins.keyWords("dissolving-glass", "water_temp_c")).source, /hot/)
	assert.match(mod.howto, /particle-box/)
	assert.match(mod.howto, /35\.9 g of salt/)
	assert.match(mod.howto, /magnet wand/)
	assert.match(mod.howto, /buoyancy/)
	assert.match(mod.howto, /filter-funnel .* the sand stays on the paper/)
	assert.match(mod.howto, /evaporating-dish .* crystals appear once it is saturated/)
	assert.equal(plugins.goalKind("salt_back")?.kind, "crystallizes", "an alias")
	assert.equal(plugins.goalKind("filters")?.kind, "separates", "an alias")
	assert.match(plugins.promptSnippets("plan"), /Matter: weigh with measure's kitchen-scale/)
	assert.match(plugins.promptSnippets("edit"), /Matter: a glass's dissolving/)
	assert.match(plugins.promptSnippets("refine"), /Matter: conservation goals/)
	assert.match(plugins.goalKindLines(), /dissolves_first \{a, b\}/)
	assert.match(plugins.goalKindLines(), /mass_same \{scale: a kitchen-scale/)
	assert.equal(plugins.goalKind("dissolves_faster")?.kind, "dissolves_first", "an alias")
	assert.equal(plugins.goalKind("mass_conserved")?.kind, "mass_same", "an alias")
	assert.equal(plugins.goalKind("weighs_less")?.kind, "mass_changes", "an alias")
	assert.equal(plugins.goalKind("diffuses")?.kind, "mixes", "an alias")
	assert.equal(plugins.goalKind("pulls_out")?.kind, "separates", "an alias")
	assert.ok(mod.examples.length >= 15, "one worked request per lesson demo (X1-X14), each with how and a plan")
	for (const ex of mod.examples) assert.ok(ex.ask && ex.how && ex.plan, ex.ask)
})

test("a plan's matter goals are checked by their fields", () => {
	const ids = new Set(["hot", "cold", "scale", "box", "sieve"])
	assert.equal(plugins.goalProblem({ kind: "dissolves_first", a: "hot", b: "cold" }, ids), null)
	assert.match(plugins.goalProblem({ kind: "dissolves_first", a: "hot" }, ids), /needs b/)
	assert.match(plugins.goalProblem({ kind: "mass_same", scale: "nobody" }, ids), /no item "nobody"/)
	assert.match(plugins.goalProblem({ kind: "mass_changes", scale: "scale", by_g: "less" }, ids), /must be a number/)
	assert.match(plugins.goalProblem({ kind: "mass_changes", scale: "scale" }, ids), /needs by_g/)
	assert.equal(plugins.goalProblem({ kind: "state", item: "box", is: "gas" }, ids), null)
	assert.equal(plugins.goalProblem({ kind: "pressure", item: "box", kpa: 203, tol_kpa: 15 }, ids), null)
	assert.equal(plugins.goalProblem({ kind: "separates", item: "sieve" }, ids), null)
	assert.equal(plugins.goalProblem({ kind: "crystallizes", item: "box", g: 5 }, ids), null)
	assert.match(plugins.goalProblem({ kind: "crystallizes", item: "box", g: "all" }, ids), /must be a number/)
})

test("placement: an ice cube goes inside a zip bag (its inside, in its own frame)", () => {
	assert.ok(plugins.placeRules().containers.has("zip-bag"))
	const inside = plugins.containerInterior("zip-bag", {})
	assert.ok(inside.x0 < 0 && inside.x1 > 0 && inside.floor >= 0 && inside.rim > inside.floor + 0.03, JSON.stringify(inside))
	assert.equal(plugins.containerInterior("dissolving-glass", {}), null, "a glass's solute is its own prop, not an item put in it")
})

test("the catalog digest describes every matter type, the module's how-to, goal kinds, knobs and worked requests", () => {
	const d = digestFromCatalog(sim.catalog())
	for (const k of TYPES) assert.match(d.text, new RegExp(`### ${k} — `), k)
	assert.match(d.text, /### Matter: particles, states, dissolving, mixtures, conservation of mass[^\n]*\nParticle model:/)
	assert.match(d.text, /holds_at \{item, temp_c, while: melting\|boiling/)
	assert.match(d.text, /knob dissolving-glass\.stir: stirring sweeps the brine off the crystals/)
	assert.match(d.text, /e\.g\. "Snap a 100 g chocolate bar on a kitchen scale: does it still weigh 100 g\? \(X1\)": chocolate-bar/)
	assert.match(d.text, /dissolved_g/)
	assert.match(d.text, /knob filter-funnel\.rinse_ml: the wet paper and the sand hold a few mL/)
	assert.match(d.text, /knob evaporating-dish\.heater_w: about half the hot plate's power reaches the dish/)
	assert.match(d.text, /crystallizes \{item: an evaporating-dish/)
})

test("every worked request is a valid plan that solves and meets its goals in the engine bundle", () => {
	const cat = digestFromCatalog(sim.catalog()).index
	for (const ex of mod.examples) {
		const plan = { title: ex.ask.slice(0, 60), notes: "", missing: [], tune: [], seconds: 4, ...ex.plan }
		const v = validatePlan(plan, { catalog: cat })
		assert.ok(v.ok, `${ex.ask}: ${JSON.stringify(v.errors)}`)
		const r = solve(v.value ?? plan)
		assert.ok(r.ok !== false, `${ex.ask}: ${JSON.stringify(r.issues)}`)
		const sc = r.scene ?? r
		const R = run({ ...sc, seconds: plan.seconds, goals: plan.goals, ...(plan.settings ? { settings: { ...(sc.settings ?? {}), ...plan.settings } } : {}) })
		assert.equal(R.summary.goals.length, plan.goals.length, `${ex.ask}: its goals are in the summary`)
		for (const g of R.summary.goals) assert.ok(g.ok, `${ex.ask}: ${g.label} (${JSON.stringify(g)})`)
		// the AI's own check of the goals on the run agrees with the summary
		const chk = checkGoals(plan.goals, { doc: R.doc, track: R.track, scene: R.scene })
		assert.deepEqual(chk.map((c) => c.ok), plan.goals.map(() => true), `${ex.ask}: ${JSON.stringify(chk)}`)
		// what is weighed rests on its scale's platform
		for (const it of R.scene.items.filter((i) => ["dissolving-glass", "chocolate-bar", "zip-bag", "reaction-bottle", "pumped-ball"].includes(i.type))) {
			const scale = (plan.items.find((p) => p.id === it.id)?.place ?? {}).on
			if (!scale || scale === "table") continue
			const s = R.scene.items.find((i) => i.id === scale)
			// (a pumped ball's anchor is its centre: its radius above its bottom)
			const lift = it.type === "pumped-ball" ? (it.props?.diameter ?? 0.22) / 2 : 0
			assert.ok(Math.abs(it.y - lift - (s.y + SCALE_TOP)) < 0.004 && Math.abs(it.x - s.x) < 0.075, `${ex.ask}: ${it.id} on ${scale} (${it.x}, ${it.y} vs ${s.x}, ${s.y})`)
		}
		// an ice cube put inside a bag is inside it
		const ice = R.scene.items.find((i) => i.type === "ice-cube")
		const bag = R.scene.items.find((i) => i.type === "zip-bag")
		if (ice && bag) assert.ok(Math.abs(ice.x - bag.x) < 0.07 && ice.y > bag.y && ice.y < bag.y + 0.06, `the ice is in the bag (${ice.x}, ${ice.y} vs ${bag.x}, ${bag.y})`)
	}
})

test("every lesson demo (X1-X14) meets its goals in the engine bundle", () => {
	assert.ok(DEMOS.length >= 20)
	for (const d of DEMOS) {
		const R = run(d)
		assert.equal(R.summary.goals.length, d.goals.length, d.id)
		for (const g of R.summary.goals) assert.ok(g.ok, `${d.id}: ${g.label} (${JSON.stringify(g)})`)
	}
})

test("goal summaries: Python == JavaScript on a real run, passing and failing goals alike; the AI's goal check agrees", () => {
	const s = scene(
		[
			{ id: "scale", type: "kitchen-scale", x: 0.5, y: 0, props: {} },
			{ id: "glass", type: "dissolving-glass", x: 0.5, y: SCALE_TOP, props: { solute: "salt", solute_g: 5, start_in: "dish", stir: 2, pour_at_s: 0.6, stir_from_s: 0.8 } },
			{ id: "still", type: "dissolving-glass", x: 1.0, y: 0, props: { solute: "salt", solute_g: 5, start_in: "glass" } },
			{ id: "syr", type: "syringe", x: 1.5, y: 0, props: { start_ml: 60, push_to_ml: 30, push_s: 1 } },
			{ id: "bath", type: "balloon-bath", x: 2.0, y: 0, props: { water_temp_c: 60 } },
			{ id: "box", type: "particle-box", x: 2.6, y: 0, props: { substance: "air", divider: true, second: "bromine", open_at_s: 0.5 } }
		],
		[
			{ kind: "dissolves", item: "glass" }, { kind: "dissolves_first", a: "glass", b: "still" }, { kind: "dissolves_first", a: "still", b: "glass" },
			{ kind: "saturates", item: "glass" }, { kind: "mass_same", scale: "scale" }, { kind: "mass_changes", scale: "scale", by_g: -2 },
			{ kind: "pressure", item: "syr", kpa: 203 }, { kind: "volume", item: "bath", ml: 1136 }, { kind: "state", item: "box", is: "gas" }, { kind: "mixes", item: "box", at_least: 99.9 }
		],
		4,
		{ time_lapse: 20 }
	)
	const R = run(s)
	const oks = R.summary.goals.map((g) => g.ok)
	assert.deepEqual(oks.slice(0, 5), [true, true, false, false, true], JSON.stringify(R.summary.goals))
	assert.equal(oks[5], false, "the scale did not drop 2 g")
	assert.equal(oks[6], true, `the syringe reads twice the pressure: ${JSON.stringify(R.summary.goals[6])}`)
	assert.equal(oks[8], true)
	const py = JSON.parse(execFileSync("python3", ["-c", `
import json, sys, os
sys.path.insert(0, ${JSON.stringify(join(PG, "machines"))})
import items
d = json.load(sys.stdin)
print(json.dumps(items.summarize(d["scene"], d["doc"], d["track"])))
`], { input: JSON.stringify({ scene: R.scene, doc: R.doc, track: R.track }), env: { ...process.env, PLAYGROUND_MODULES: MODS }, maxBuffer: 1 << 28 }).toString())
	assert.deepEqual(py.goals, JSON.parse(JSON.stringify(R.summary.goals)))
	assert.deepEqual(py.readings, JSON.parse(JSON.stringify(R.summary.readings)))
	// the AI's own check of a module goal on the run, by an alias
	assert.equal(plugins.checkModuleGoal({ kind: "dissolves_faster", a: "glass", b: "still" }, { scene: R.scene, doc: R.doc, track: R.track }).ok, true)
	assert.equal(plugins.checkModuleGoal({ kind: "saturated", item: "glass" }, { scene: R.scene, doc: R.doc, track: R.track }).ok, false)
})

test("the edit digest's lines: a glass, a syringe, a particle box, a fizz bottle, a sieve's neighbour dish, a density cube", () => {
	const R = run(
		scene(
			[
				{ id: "glass", type: "dissolving-glass", x: 0.4, y: 0, props: { solute: "sugar", solute_g: 6, start_in: "glass", stir: 2 } },
				{ id: "syr", type: "syringe", x: 0.9, y: 0, props: { start_ml: 60, push_to_ml: 30, push_s: 1 } },
				{ id: "box", type: "particle-box", x: 1.4, y: 0, props: { substance: "water", temp_c: -5, heater_w: 0 } },
				{ id: "fizz", type: "reaction-bottle", x: 1.9, y: 0, props: { closure: "open" } },
				{ id: "dish", type: "mixture-dish", x: 2.4, y: 0, props: {} },
				{ id: "cube", type: "density-cube", x: 2.8, y: 0, props: { made_of: "pine" } }
			],
			[],
			3,
			{ time_lapse: 20 }
		)
	)
	const lines = (id) => plugins.digestLines(R.scene.items.find((i) => i.id === id), R, { nameOf: (x) => x }).join(" | ")
	assert.match(lines("glass"), /6 g of sugar .* the water can hold [\d.]+ g \(20\d(\.\d)? g per 100 g\)/)
	assert.match(lines("glass"), /stirred 2 turns a second/)
	assert.match(lines("glass"), /end: [\d.]+ g dissolved/)
	assert.match(lines("syr"), /60 mL at 10\d(\.\d)? kPa → 30 mL at \d+(\.\d)? kPa \(Boyle/)
	assert.match(lines("box"), /water: [−-]5 °C solid → [−-]5 °C solid/)
	assert.match(lines("box"), /no heater/)
	assert.match(lines("fizz"), /5 g baking soda .* can make 2\.6\d g of CO2; closure open/)
	assert.match(lines("dish"), /sand and iron filings; magnet: a magnet wand swept 1\.5 cm above the floor/)
	assert.match(lines("dish"), /taken out at the end: sand [0-2] %, iron filings (9\d|100) %/)
	assert.match(lines("cube"), /pine: 0\.\d+ g\/cm³ \(floats in water\)/)
})

test("separating by filtering and evaporating: goal summaries Python == JavaScript, passing and failing; the digest's lines; the AI's check", () => {
	const s = scene(
		[
			{ id: "filter", type: "filter-funnel", x: 0.5, y: 0, props: { solid: "sand", solid_g: 10, dissolved: "salt", dissolved_g: 5, water_ml: 100, rinse_ml: 10 } },
			{ id: "slow", type: "filter-funnel", x: 1.0, y: 0, props: { solid: "chalk", solid_g: 5, dissolved: "none", water_ml: 100 } },
			{ id: "coffee", type: "filter-funnel", x: 1.5, y: 0, props: { solid: "chalk", solid_g: 5, dissolved: "none", water_ml: 60, paper: "coffee filter" } },
			{ id: "scale", type: "kitchen-scale", x: 2.0, y: 0, props: {} },
			{ id: "dish", type: "evaporating-dish", x: 2.0, y: SCALE_TOP, props: { solute: "salt", solute_g: 5, water_ml: 50, heat: "sun" } },
			{ id: "plate", type: "evaporating-dish", x: 2.7, y: 0, props: { solute: "salt", solute_g: 5, water_ml: 50, heater_w: 300 } }
		],
		[
			{ kind: "separates", item: "filter" }, { kind: "separates", item: "slow" }, { kind: "separates", item: "coffee" },
			{ kind: "crystallizes", item: "dish" }, { kind: "dries", item: "dish" }, { kind: "mass_changes", scale: "scale", by_g: -49.91, tol_g: 1 },
			{ kind: "crystallizes", item: "plate", g: 5 }, { kind: "crystallizes", item: "plate", g: 2.5 }
		],
		4,
		{ time_lapse: 100000 }
	)
	const R = run(s)
	const oks = R.summary.goals.map((g) => g.ok)
	// (a day and more of lesson time a run second: the sand filter, the sun-dried dish and the boiled-dry one all finish; chalk through filter
	// paper is kept but slow; through a coffee filter it is not kept)
	assert.deepEqual(oks, [true, true, false, true, true, true, true, false], JSON.stringify(R.summary.goals))
	const st = (id, k) => R.track.state[id][k].at(-1)
	assert.ok(st("filter", "salt_through_pct") >= 98, `the rinse carries the salt through: ${st("filter", "salt_through_pct")}`)
	assert.equal(st("coffee", "clear"), 0, "chalk clouds a coffee filter's filtrate")
	assert.ok(Math.abs(st("dish", "crystals_g") - 5) < 1e-6 && st("dish", "dry") === 1)
	const py = JSON.parse(execFileSync("python3", ["-c", `
import json, sys, os
sys.path.insert(0, ${JSON.stringify(join(PG, "machines"))})
import items
d = json.load(sys.stdin)
print(json.dumps(items.summarize(d["scene"], d["doc"], d["track"])))
`], { input: JSON.stringify({ scene: R.scene, doc: R.doc, track: R.track }), env: { ...process.env, PLAYGROUND_MODULES: MODS }, maxBuffer: 1 << 28 }).toString())
	assert.deepEqual(py.goals, JSON.parse(JSON.stringify(R.summary.goals)))
	assert.deepEqual(py.readings, JSON.parse(JSON.stringify(R.summary.readings)))
	assert.equal(plugins.checkModuleGoal({ kind: "salt_back", item: "dish" }, { scene: R.scene, doc: R.doc, track: R.track }).ok, true)
	const lines = (id) => plugins.digestLines(R.scene.items.find((i) => i.id === id), R, { nameOf: (x) => x }).join(" | ")
	assert.match(lines("filter"), /10 g of sand and 5 g of salt dissolved in 100 mL, poured through filter paper in a 75 mm funnel/)
	assert.match(lines("filter"), /end: 10\d(\.\d)? mL through \(9\d % of the water\).* on the paper 10 g \(100 % of the undissolved\).*\(the filtrate is clear\)/)
	assert.match(lines("coffee"), /CLOUDY: the solid came through/)
	assert.match(lines("dish"), /5 g of salt in 50 mL of water at 20 °C, on a sunny windowsill; the water can hold 17\.9 g, so crystals start once about 13\.9 g of water is left/)
	assert.match(lines("dish"), /end: 0 g of water left .* 5 g of crystals/)
	assert.match(lines("plate"), /on a 300 W hot plate/)
	assert.match(lines("plate"), /boiling from [\d.]+ s, crystals from [\d.]+ s, dry at [\d.]+ s/)
	assert.equal(plugins.changeWords("filter-funnel", "paper", "filter paper", "coffee filter"), "paper filter paper → coffee filter (faster; chalk gets through)")
	assert.equal(plugins.changeWords("evaporating-dish", "heat", "room", "hot plate"), "heated by room → hot plate (boils dry in minutes)")
	assert.equal(plugins.changeWords("filter-funnel", "funnel_mm", 75, 100), "funnel 75 → 100 mm across (it holds 34 → 81 mL at a time)")
})

test("change words in real units", () => {
	// (the module's own words; the registry asks the modules in name order, and an earlier module's words for a key of the same name, the heat
	// module's "water 20 → 60 °C", come first: as true)
	const own = (type, key, a, b, nameOf = (id) => id) => mod.words.change(type, key, a, b, nameOf)
	assert.equal(own("dissolving-glass", "water_temp_c", 20, 60), "the water 20 °C → 60 °C (warmer: it dissolves faster)")
	assert.match(plugins.changeWords("dissolving-glass", "water_temp_c", 20, 60), /20 (°C )?→ 60 °C/)
	assert.equal(own("dissolving-glass", "stir", 0, 2), "stirring off → 2 turns a second")
	assert.equal(own("dissolving-glass", "grain", "table", "powder"), "grains table → powder (smaller pieces dissolve faster)")
	assert.equal(plugins.changeWords("reaction-bottle", "closure", "open", "cap"), "the bottle open → cap (no gas escapes: the scale should not change)")
	assert.equal(plugins.changeWords("syringe", "push_to_ml", 40, 30), "plunger pushed to 40 → 30 mL")
	assert.equal(plugins.changeWords("mixture-dish", "wand_height", 0.03, 0.015), "the wand's tip 3 → 1.5 cm above the dish's floor")
	assert.equal(own("mixture-dish", "magnet", null, "m1", (id) => `magnet ${id}`), "magnet none → magnet m1")
	assert.equal(own("ball", "diameter", 0.1, 0.2), null)
})

test("make it work: a balloon dipped in water too cool for its volume goal is fixed by warming the water (the module's knob), checked", async () => {
	const s = scene([{ id: "bath", type: "balloon-bath", x: 1.2, y: 0, props: { water_temp_c: 30, settle_s: 5 } }], [{ kind: "volume", item: "bath", ml: 1136 }], 3, { time_lapse: 20 })
	const R = run(s)
	assert.equal(R.summary.goals[0].ok, false, "30 °C water: about 1034 mL")
	const simulate = async (sc) => run(sc)
	const fr = await findFix({ scene: R.scene, sim: R, goals: R.scene.goals }, { simulate, budgetMs: 120000, maxRuns: 120, parallel: 1 })
	assert.equal(fr.status, "found", JSON.stringify({ status: fr.status, runs: fr.runs }).slice(0, 1500))
	const words = JSON.stringify(fr.fix.words)
	assert.match(words, /warm/, words)
	assert.equal(run(fr.fix.scene).summary.goals[0].ok, true)
})

test("make it work: salt water on too weak a hot plate that does not boil dry in time is fixed by the module's knobs, checked", async () => {
	const s = scene([{ id: "d", type: "evaporating-dish", x: 1.2, y: 0, props: { solute: "salt", solute_g: 5, water_ml: 50, heater_w: 150 } }], [{ kind: "crystallizes", item: "d" }], 10, { time_lapse: 150 })
	const R = run(s)
	assert.equal(R.summary.goals[0].ok, false, "150 W: still wet after 22 lesson minutes")
	const simulate = async (sc) => run(sc)
	const fr = await findFix({ scene: R.scene, sim: R, goals: R.scene.goals }, { simulate, budgetMs: 120000, maxRuns: 80, parallel: 1 })
	assert.equal(fr.status, "found", JSON.stringify({ status: fr.status, runs: fr.runs }).slice(0, 1500))
	assert.match(JSON.stringify(fr.fix), /heater_w|water_ml|humidity_pct/)
	assert.equal(run(fr.fix.scene).summary.goals[0].ok, true)
})

test("make it work: a glass of cold, unstirred sugar that does not dissolve in time is fixed by the module's knobs, checked", async () => {
	const s = scene([{ id: "g", type: "dissolving-glass", x: 1.2, y: 0, props: { solute: "sugar", solute_g: 2.2, grain: "cube", start_in: "glass", water_temp_c: 10 } }], [{ kind: "dissolves", item: "g" }], 3, { time_lapse: 20 })
	const R = run(s)
	assert.equal(R.summary.goals[0].ok, false, "a sugar cube in still cold water takes minutes")
	const simulate = async (sc) => run(sc)
	const fr = await findFix({ scene: R.scene, sim: R, goals: R.scene.goals }, { simulate, budgetMs: 120000, maxRuns: 80, parallel: 1 })
	assert.equal(fr.status, "found", JSON.stringify({ status: fr.status, runs: fr.runs }).slice(0, 1500))
	assert.match(JSON.stringify(fr.fix), /stir|water_temp_c|grain|solute_g|water_ml/)
	assert.equal(run(fr.fix.scene).summary.goals[0].ok, true)
})
