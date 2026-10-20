// The matter module's chemistry and particle models in the AI layer (web/sim/modules/matter.js `plugin`): cold and hot packs, a hand warmer,
// steel wool, red cabbage, a precipitate, molecule and crystal models. Their goal kinds (warms_by, cools_by, color_changes: spellings, fields,
// summaries Python == JavaScript on a real run, passing and failing, the AI's own check), the edit digest's lines, the change words, placement (a
// thermometer standing in a beaker reads it), the catalog digest's part, and make-it-work searches that fix a too-warm cold pack and a too-cool
// hand warmer with the module's own knobs, checked in the engine. (The worked requests are run by matter-plugin.test.mjs with the module's others.)
//   node --test web/ai/test/matter-chem.test.mjs
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const PG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const MODS = "matter,measure,heat"
process.env.PLAYGROUND_MODULES = process.env.PLAYGROUND_MODULES ?? MODS
const sim = await import(pathToFileURL(join(PG, "web/sim/index.js")).href)
const plugins = await import(pathToFileURL(join(PG, "web/sim/plugins.js")).href)
const { solve } = await import(pathToFileURL(join(PG, "web/ai/solver.js")).href)
const { findFix } = await import(pathToFileURL(join(PG, "web/ai/fixer.js")).href)
const { checkGoals } = await import(pathToFileURL(join(PG, "ai/goals.mjs")).href)
const { validatePlan } = await import(pathToFileURL(join(PG, "ai/schemas.mjs")).href)
const { digestFromCatalog, promptCatalog } = await import(pathToFileURL(join(PG, "ai/catalog-digest.mjs")).href)
const bundle = await import(pathToFileURL(join(PG, "web/sim/engine-worker.js")).href)
const mod = plugins.modules().find((m) => m.name === "mod_matter")
const NEW = ["cold-pack", "hand-warmer", "steel-wool", "indicator-cup", "reaction-cup", "molecule", "crystal"]

const run = (scene) => {
	const p = sim.prepare(scene)
	const track = JSON.parse(JSON.stringify(bundle.run(p.doc, 24)))
	const fin = sim.finish(p.scene, p.doc, p.resolved, track)
	return { scene: p.scene, doc: p.doc, track, summary: fin.summary, resolved: p.resolved }
}
const STAGE = { x0: -0.56, x1: 3.19, y0: -0.16, y1: 2.34 }
const scene = (items, goals = [], seconds = 3, settings = undefined) => ({ version: 2, id: "t", name: "t", seconds, release: 0.3, stage: STAGE, ...(settings ? { settings } : {}), items: [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }, ...items], goals })
const pySummary = (R) =>
	JSON.parse(execFileSync("python3", ["-c", `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(PG, "machines"))})
import items
d = json.load(sys.stdin)
print(json.dumps(items.summarize(d["scene"], d["doc"], d["track"])))
`], { input: JSON.stringify({ scene: R.scene, doc: R.doc, track: R.track }), env: { ...process.env, PLAYGROUND_MODULES: MODS }, maxBuffer: 1 << 28 }).toString())

test("the chemistry types and goal kinds are registered, with fields, spellings, knobs and words", () => {
	const types = Object.fromEntries(sim.catalog().types.map((t) => [t.key, t]))
	for (const t of NEW) assert.equal(types[t]?.module, "matter", t)
	const kinds = Object.fromEntries(mod.goals.map((g) => [g.kind, g]))
	for (const k of ["warms_by", "cools_by", "color_changes"]) assert.ok(kinds[k]?.about && kinds[k].fields.item === "item", k)
	assert.equal(kinds.warms_by.fields.at_least_c, "number")
	assert.equal(kinds.color_changes.fields.to, "string?")
	for (const [alias, kind] of [["gets_colder", "cools_by"], ["heats_up", "warms_by"], ["turns", "color_changes"], ["goes_cloudy", "color_changes"]]) assert.equal(plugins.goalKind(alias)?.kind, kind, alias)
	for (const t of ["cold-pack", "hand-warmer", "steel-wool", "indicator-cup", "reaction-cup"]) assert.ok(plugins.knobsFor(t).length >= 2, `knobs for ${t}`)
	assert.ok(/cold pack|hand warmer|indicator|precipitate|molecule/.test(mod.title))
	assert.match(mod.howto, /cools_by/)
	assert.match(mod.prompt.plan, /color_changes/)
})

test("a plan's chemistry goals are checked by their fields", () => {
	const cat = digestFromCatalog(sim.catalog()).index
	const base = { title: "t", notes: "", missing: [], tune: [], seconds: 4, items: [{ id: "pack", type: "cold-pack", place: { on: "table", x: 1.2 } }] }
	assert.ok(validatePlan({ ...base, goals: [{ kind: "cools_by", item: "pack", at_least_c: 15 }] }, { catalog: cat }).ok)
	const bad = validatePlan({ ...base, goals: [{ kind: "cools_by", item: "pack" }] }, { catalog: cat })
	assert.ok(!bad.ok || JSON.stringify(bad).includes("at_least_c"), JSON.stringify(bad.errors))
})

test("goal summaries: Python == JavaScript on a real run, passing and failing; the AI's own check agrees", () => {
	const s = scene(
		[
			{ id: "cold", type: "cold-pack", x: 0.4, y: 0, props: {} },
			{ id: "hot", type: "cold-pack", x: 0.8, y: 0, props: { chemical: "calcium chloride" } },
			{ id: "ind", type: "indicator-cup", x: 1.3, y: 0, props: { add: "vinegar", amount: 10, then_add: "baking soda", then_amount: 3, then_at_s: 3 } },
			{ id: "pc", type: "reaction-cup", x: 1.7, y: 0, props: {} },
			{ id: "wool", type: "steel-wool", x: 2.2, y: 0, props: {} },
			{ id: "mol", type: "molecule", x: 2.6, y: 0, props: { molecule: "methane" } }
		],
		[
			{ kind: "cools_by", item: "cold", at_least_c: 12 }, { kind: "cools_by", item: "cold", at_least_c: 40 }, { kind: "warms_by", item: "hot", at_least_c: 30 },
			{ kind: "warms_by", item: "cold", at_least_c: 2 }, { kind: "color_changes", item: "ind" }, { kind: "color_changes", item: "ind", to: "purple" },
			{ kind: "color_changes", item: "ind", to: "Green" }, { kind: "color_changes", item: "pc", to: "cloudy" }, { kind: "warms_by", item: "pc", at_least_c: 3 },
			{ kind: "color_changes", item: "wool" }
		],
		6,
		{ time_lapse: 30 }
	)
	const R = run(s)
	assert.deepEqual(R.summary.goals.map((g) => g.ok), [true, false, true, false, true, true, false, true, true, false], JSON.stringify(R.summary.goals))
	const py = pySummary(R)
	assert.deepEqual(py.goals, JSON.parse(JSON.stringify(R.summary.goals)))
	assert.deepEqual(py.readings, JSON.parse(JSON.stringify(R.summary.readings)))
	// the AI's check of the run agrees, by kind and by a spelling
	const chk = checkGoals(s.goals, { doc: R.doc, track: R.track, scene: R.scene })
	assert.deepEqual(chk.map((c) => c.ok), R.summary.goals.map((g) => g.ok))
	assert.equal(plugins.checkModuleGoal({ kind: "gets_colder", item: "cold", at_least_c: 10 }, { scene: R.scene, doc: R.doc, track: R.track }).ok, true)
	// the model's fixed readings
	assert.equal(R.summary.readings.mol.atoms, 5)
	assert.equal(R.summary.readings.mol.bond_angle_deg, 109.47)
})

test("a thermometer placed inside a beaker of red cabbage juice stands in it and reads its temperature", () => {
	const plan = { title: "t", notes: "", missing: [], tune: [], seconds: 6, settings: { time_lapse: 5 },
		items: [{ id: "cup", type: "indicator-cup", props: { add: "baking soda", amount: 5 }, place: { on: "table", x: 1.2 } }, { id: "th", type: "thermometer", props: { style: "digital" }, fixed: true, place: { inside: "cup", on: "cup", x: 1.2 } }],
		goals: [{ kind: "cools_by", item: "th", at_least_c: 0.5 }] }
	const cat = digestFromCatalog(sim.catalog()).index
	const v = validatePlan(plan, { catalog: cat })
	assert.ok(v.ok, JSON.stringify(v.errors))
	const r = solve(v.value ?? plan)
	assert.ok(r.ok !== false, JSON.stringify(r.issues))
	const sc = r.scene ?? r
	const th = sc.items.find((i) => i.id === "th")
	const cup = sc.items.find((i) => i.id === "cup")
	assert.ok(Math.abs(th.x - cup.x) < 0.033 && th.y > cup.y && th.y < cup.y + 0.1, `inside: ${th.x}, ${th.y} vs ${cup.x}, ${cup.y}`)
	const R = run({ ...sc, seconds: 6, settings: { time_lapse: 5 }, goals: plan.goals })
	// (5 g of baking soda dissolving takes heat in: the juice and the probe in it cool)
	assert.ok(R.summary.goals[0].ok, JSON.stringify(R.summary.goals[0]))
})

test("the edit digest's lines and the change words, in real units", () => {
	const R = run(scene([
		{ id: "cold", type: "cold-pack", x: 0.4, y: 0, props: {} },
		{ id: "hw", type: "hand-warmer", x: 0.9, y: 0, props: {} },
		{ id: "ind", type: "indicator-cup", x: 1.4, y: 0, props: { add: "vinegar", amount: 10 } },
		{ id: "pc", type: "reaction-cup", x: 1.8, y: 0, props: {} },
		{ id: "wool", type: "steel-wool", x: 2.3, y: 0, props: {} },
		{ id: "salt", type: "crystal", x: 2.7, y: 0, props: {} }
	], [], 5, { time_lapse: 30 }))
	const lines = (id) => plugins.digestLines(R.scene.items.find((i) => i.id === id), R, { nameOf: (x) => x }).join(" | ")
	assert.match(lines("cold"), /ammonium nitrate.*takes heat in.*−20\.1 °C/)
	assert.match(lines("cold"), /coldest/)
	assert.match(lines("hw"), /iron powder.*W/)
	assert.match(lines("ind"), /purple → red/)
	assert.match(lines("pc"), /white solid/)
	assert.match(lines("wool"), /rusted/)
	assert.match(lines("salt"), /125 atoms.*MODEL/)
	assert.match(plugins.changeWords("cold-pack", "chemical", "ammonium nitrate", "calcium chloride"), /hot pack/)
	assert.match(plugins.changeWords("hand-warmer", "lasts_h", 5, 2.5), /5 → 2\.5 h \(oxygen comes in faster: hotter\)/)
	assert.match(plugins.changeWords("indicator-cup", "add", "vinegar", "washing soda"), /a base/)
	assert.match(plugins.changeWords("steel-wool", "soaked", "vinegar", "dry"), /hardly rusts/)
	assert.match(plugins.changeWords("molecule", "molecule", "water", "methane"), /water → methane molecule/)
})

test("the catalog digest carries the chemistry section for a chemistry request, not for a ramp", async () => {
	const cat = digestFromCatalog(sim.catalog())
	const a = promptCatalog(cat, { text: "Squeeze an instant cold pack and measure how cold it gets" })
	const b = promptCatalog(cat, { text: "A ball rolls down a ramp into a cup" })
	const s = (x) => (typeof x === "string" ? x : JSON.stringify(x))
	assert.ok(s(a).includes("cold-pack") && s(a).includes("cools_by"))
	for (const t of NEW) assert.ok(cat.text.includes(t), t)
	assert.ok(s(b).length <= s(a).length)
})

test("make it work: a cold pack that must cool 25 °C is fixed by the module's knobs, checked", async () => {
	const R = run(scene([{ id: "pack", type: "cold-pack", x: 1.2, y: 0, props: {} }], [{ kind: "cools_by", item: "pack", at_least_c: 25 }], 8, { time_lapse: 30 }))
	assert.equal(R.summary.goals[0].ok, false, "30 g in 100 mL cools about 18 °C")
	const simulate = async (sc) => run(sc)
	const fr = await findFix({ scene: R.scene, sim: R, goals: R.scene.goals }, { simulate, budgetMs: 120000, maxRuns: 80, parallel: 1 })
	assert.equal(fr.status, "found", JSON.stringify({ status: fr.status, runs: fr.runs }).slice(0, 800))
	const fixed = run(fr.fix.scene)
	assert.ok(fixed.summary.goals[0].ok, JSON.stringify(fixed.summary.goals))
	const p = fr.fix.scene.items.find((i) => i.id === "pack").props ?? {}
	assert.ok((p.salt_g ?? 30) > 30 || (p.water_ml ?? 100) < 100 || (p.dissolve_s ?? 30) < 30, JSON.stringify(p))
	// (its words say what changed, in the module's words: "give the instant cold pack a smaller water bag (100 mL → 60 mL)")
	assert.match(JSON.stringify(fr.fix.words), /cold pack/)
})

test("make it work: a hand warmer that must warm 25 °C in 15 minutes is fixed by the module's knobs, checked", async () => {
	const R = run(scene([{ id: "hw", type: "hand-warmer", x: 1.2, y: 0, props: {} }], [{ kind: "warms_by", item: "hw", at_least_c: 25 }], 8, { time_lapse: 120 }))
	assert.equal(R.summary.goals[0].ok, false)
	const simulate = async (sc) => run(sc)
	const fr = await findFix({ scene: R.scene, sim: R, goals: R.scene.goals }, { simulate, budgetMs: 120000, maxRuns: 80, parallel: 1 })
	assert.equal(fr.status, "found", JSON.stringify({ status: fr.status, runs: fr.runs }).slice(0, 800))
	const fixed = run(fr.fix.scene)
	assert.ok(fixed.summary.goals[0].ok, JSON.stringify(fixed.summary.goals))
	assert.match(JSON.stringify(fr.fix.words), /hand warmer/)
})
