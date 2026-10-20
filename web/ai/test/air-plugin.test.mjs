// The air module's AI plug-ins (web/sim/modules/air.js `plugin`, registered by web/sim/modules/index.js): its goal kinds (their spellings,
// field checks, `expect: false` controls, summaries Python == JavaScript on real runs), knobs, how-to and prompt lines, the vacuum jar's
// inside for the solver, every worked example solved and met in the engine bundle, the edit digest's lines, its change words, and make-it-work
// searches that find a fix through the module's knobs (a suction cup that lets go, a hot-air balloon that will not lift off).
//   node --test web/ai/test/air-plugin.test.mjs
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const PG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
// (the worked examples use other modules' items too: a feather (mechanics), a saucepan (heat), a bell jar and a speaker (waves), lands_together (space))
process.env.PLAYGROUND_MODULES = process.env.PLAYGROUND_MODULES ?? "air,fluids,measure,mechanics,space,heat,waves"
const sim = await import(pathToFileURL(join(PG, "web/sim/index.js")).href)
const plugins = await import(pathToFileURL(join(PG, "web/sim/plugins.js")).href)
const { solve, planFromScene } = await import(pathToFileURL(join(PG, "web/ai/solver.js")).href)
const { goalLabel, checkGoals } = await import(pathToFileURL(join(PG, "web/ai/goals.js")).href)
const { findFix } = await import(pathToFileURL(join(PG, "web/ai/fixer.js")).href)
const { describeDiff } = await import(pathToFileURL(join(PG, "web/ai/orchestrator.js")).href)
const bundle = await import(pathToFileURL(join(PG, "web/sim/engine-worker.js")).href)
const mod = plugins.modules().find((m) => m.name === "mod_air")

const run = (scene) => {
	const p = sim.prepare(scene)
	const track = JSON.parse(JSON.stringify(bundle.run(p.doc, 120)))
	const fin = sim.finish(p.scene, p.doc, p.resolved, track)
	return { scene: p.scene, doc: p.doc, track, summary: fin.summary, resolved: p.resolved }
}
const STAGE = { x0: -0.56, x1: 3.19, y0: -0.16, y1: 2.34 }
const scene = (items, goals = [], seconds = 3, extra = {}) => ({
	version: 2, id: "t", name: "t", seconds, release: 0.5, stage: STAGE, items: [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }, ...items], goals, ...extra
})
const KINDS = ["crushes", "glides", "glides_farther", "jets", "kite_flies", "lets_go", "lifts_off", "pops", "rises_faster", "shrinks", "smoke_drifts", "stays_held", "swells", "wind_reads"]

test("the module is registered with its goal kinds, knobs, how-to, prompt lines and placement rules", () => {
	assert.ok(mod, "mod_air is in the registry")
	assert.deepEqual(mod.goals.map((g) => g.kind).sort(), KINDS)
	for (const g of mod.goals) assert.ok(g.about && g.fields && typeof g.summarize === "function" && typeof g.sample === "function" && typeof g.label === "function", g.kind)
	// (its kinds and spellings are its own: no other module's goal answers to them)
	for (const g of mod.goals) for (const a of [g.kind, ...(g.aliases ?? [])]) assert.equal(plugins.goalKind(a)?.module, "mod_air", `${a} is the air module's`)
	for (const t of ["party-balloon", "hot-air-balloon", "paper-airplane", "kite", "suction-cup", "card-glass", "steam-can", "vacuum-jar", "anemometer", "wind-tunnel"]) assert.ok(plugins.knobsFor(t).length > 0, `knobs for ${t}`)
	for (const k of mod.knobs) assert.ok(k.why && k.more && k.less, `${k.type}.${k.key}`)
	assert.match(mod.howto, /PV = nRT|gas law|101\.3 kPa/)
	assert.match(mod.howto, /place \{inside: <jar id>\}/)
	assert.match(plugins.promptSnippets("plan"), /Air and gases/)
	assert.match(plugins.promptSnippets("edit"), /fill_l/)
	assert.match(plugins.goalKindLines(), /lifts_off \{item, at_least_m\?, expect\?\}/)
	assert.ok(plugins.placeRules().containers.has("vacuum-jar") && plugins.placeRules().containers.has("wind-tunnel") && plugins.placeRules().containers.has("vacuum-tube"))
	assert.deepEqual(plugins.containerInterior("vacuum-tube", {}), { x0: -0.15, x1: 0.15, floor: 0.03, rim: 1.53 })
	assert.deepEqual(plugins.containerInterior("wind-tunnel", {}), { x0: -0.6, x1: 0.6, floor: 0, rim: 0.3 })
	assert.deepEqual(plugins.containerInterior("vacuum-jar", { width: 0.4, height: 0.5 }), { x0: -0.2, x1: 0.2, floor: 0.02, rim: 0.52 })
	assert.equal(plugins.containerInterior("party-balloon", {}), null)
})

test("plans' goals are checked by their fields", () => {
	const ids = new Set(["b", "can", "k"])
	assert.equal(plugins.goalProblem({ kind: "pops", item: "b" }, ids), null)
	assert.equal(plugins.goalProblem({ kind: "pops", item: "b", expect: false, before_s: 2 }, ids), null)
	assert.match(plugins.goalProblem({ kind: "pops" }, ids), /needs item/)
	assert.match(plugins.goalProblem({ kind: "crushes", item: "nobody" }, ids), /no item "nobody"/)
	assert.match(plugins.goalProblem({ kind: "kite_flies", item: "k", at_least_m: "high" }, ids), /must be a number/)
	assert.match(plugins.goalProblem({ kind: "lifts_off", item: "b", expect: "no" }, ids), /true or false/)
	assert.equal(plugins.goalKind("balloon_rises").kind, "lifts_off")
	assert.equal(plugins.goalKind("card_falls").kind, "lets_go")
	for (const [a, k] of [["grows", "swells"], ["inflates", "swells"], ["expands", "swells"], ["deflates", "shrinks"], ["balloon_rocket", "jets"], ["flies_farther", "glides_farther"], ["smoke_rises_faster", "rises_faster"]]) assert.equal(plugins.goalKind(a).kind, k, a)
	assert.equal(plugins.goalProblem({ kind: "glides_farther", a: "b", b: "k" }, ids), null)
	assert.match(plugins.goalProblem({ kind: "rises_faster", a: "b" }, ids), /needs b/)
	assert.equal(plugins.goalProblem({ kind: "jets", item: "b", toward: "right", at_least_m: 1, expect: false }, ids), null)
	assert.equal(plugins.goalProblem({ kind: "swells", item: "b", at_least_x: 1.5, measure: "volume" }, ids), null)
})

test("the new comparison and direction goals on real runs (Python == JavaScript): jets needs an untied balloon, swells in a pumped jar, two planes on one lane", () => {
	const s = scene(
		[
			{ id: "u", type: "party-balloon", x: 0.3, y: 1.0, angle: -90, props: { tied: false, fill_l: 10 } },
			{ id: "t", type: "party-balloon", x: 0.3, y: 1.8, angle: -90, props: { fill_l: 10 } },
			{ id: "jar", type: "vacuum-jar", x: 1.9, y: 0, props: { pump_at: 0.3, pump_s: 0.6, lowest_kpa: 40 } },
			{ id: "b", type: "party-balloon", x: 1.9, y: 0.071, props: { size: 0.12, fill_l: 0.3 } },
			{ id: "s1", type: "incense-stick", x: 2.6, y: 0 }, { id: "s2", type: "incense-stick", x: 3.0, y: 0 }
		],
		[
			{ kind: "jets", item: "u", toward: "right", at_least_m: 1 }, { kind: "jets", item: "t", toward: "right" }, { kind: "jets", item: "t", expect: false },
			{ kind: "swells", item: "b", at_least_x: 2 }, { kind: "shrinks", item: "b" }, { kind: "pops", item: "b", expect: false },
			{ kind: "rises_faster", a: "s1", b: "s2" }, { kind: "lifts_off", item: "b", at_least_m: 0.05, expect: false }
		],
		4
	)
	const R = run(s)
	assert.deepEqual(R.summary.goals.map((g) => g.ok), [true, false, true, true, false, true, false, true], JSON.stringify(R.summary.goals))
	const py = JSON.parse(
		execFileSync("python3", ["-c", `
import json, sys, os
sys.path.insert(0, ${JSON.stringify(join(PG, "machines"))})
import items
d = json.load(sys.stdin)
print(json.dumps(items.summarize(d["scene"], d["doc"], d["track"])))
`], { input: JSON.stringify({ scene: R.scene, doc: R.doc, track: R.track }), env: { ...process.env }, maxBuffer: 1 << 28 }).toString()
	)
	assert.deepEqual(py.goals, JSON.parse(JSON.stringify(R.summary.goals)))
	assert.deepEqual(py.happenings, JSON.parse(JSON.stringify(R.summary.happenings)))
	// the run's story: the smoke, the jar, the swelling (describeRun has something to say)
	const said = R.summary.happenings.map((e) => e.text).join(" | ")
	assert.match(said, /smoke from Incense stick \(smoke\) rises/)
	assert.match(said, /was pumped down to 40\.\d kPa/)
	assert.match(said, /swelled from 8\.2 to/)
})

test("the solver sets a card-glass (stand and all) and a balloon inside a vacuum jar on its floor, under its glass top", () => {
	const r = solve({ title: "card in a jar", seconds: 4, missing: [], tune: [], notes: "", items: [
		{ id: "jar", type: "vacuum-jar", props: { width: 0.34, height: 0.4 }, place: { on: "table", x: 1.2 } },
		{ id: "cg", type: "card-glass", props: { stand_height: 0.1 }, place: { inside: "jar" } }
	], goals: [{ kind: "lets_go", item: "cg" }] })
	const jar = r.scene.items.find((i) => i.id === "jar")
	const cg = r.scene.items.find((i) => i.id === "cg")
	assert.ok(Math.abs(cg.y - (jar.y + 0.02)) < 0.002, `the card-glass's stand stands on the jar's plate (${cg.y} vs ${jar.y + 0.02})`)
	assert.ok(!(r.problems ?? []).some((p) => p.level === "error"), JSON.stringify(r.problems))
	const R = run({ ...r.scene, seconds: 8 })
	assert.equal(R.summary.goals[0].ok, true, `the card falls as the jar is pumped (${JSON.stringify(R.summary.goals[0])})`)
	const r2 = solve({ title: "balloon in a jar", seconds: 4, missing: [], tune: [], notes: "", items: [
		{ id: "jar", type: "vacuum-jar", place: { on: "table", x: 1.2 } }, { id: "b", type: "party-balloon", props: { size: 0.12, fill_l: 0.3 }, place: { inside: "jar" } }
	], goals: [] })
	const b = r2.scene.items.find((i) => i.id === "b")
	const j2 = r2.scene.items.find((i) => i.id === "jar")
	assert.ok(b.y < j2.y + 0.02 + 0.05, `the balloon rests on the jar's floor (its middle ${b.y} m; the floor ${j2.y + 0.02})`)
})

test("every worked example builds through the solver and meets its goals in the engine", () => {
	for (const ex of mod.examples) {
		assert.ok(ex.ask && ex.how && ex.plan, "an example has its ask, how and plan")
		const r = solve({ title: ex.ask.slice(0, 40), seconds: 4, missing: [], tune: [], notes: "", ...ex.plan })
		const R = run({ ...r.scene, seconds: ex.plan.seconds ?? 4 })
		assert.equal(R.summary.goals.length, ex.plan.goals.length, `${ex.ask}: its goals are in the summary`)
		for (const g of R.summary.goals) assert.ok(g.ok, `${ex.ask}: ${g.label} (${JSON.stringify(g)})`)
	}
})

test("goal summaries: Python == JavaScript on a real run, controls with expect false", () => {
	const s = scene(
		[
			{ id: "he", type: "party-balloon", x: 0.3, y: 0.9, props: { gas: "helium" } },
			{ id: "air", type: "party-balloon", x: 0.7, y: 0.9, props: {} },
			{ id: "pin", type: "party-balloon", x: 1.1, y: 0.2, props: { prick_at: 1.0 } },
			{ id: "hot", type: "steam-can", x: 1.4, y: 0, props: { dip_at: 0.6 } },
			{ id: "cup", type: "suction-cup", x: 2.6, y: 0, props: { load_kg: 9 } },
			{ id: "glass", type: "card-glass", x: 2.2, y: 0, props: {} },
			{ id: "smoke", type: "incense-stick", x: -0.3, y: 0, props: {} }
		],
		[
			{ kind: "lifts_off", item: "he", at_least_m: 0.5 },
			{ kind: "lifts_off", item: "air", expect: false },
			{ kind: "pops", item: "pin", before_s: 1.2 },
			{ kind: "pops", item: "he", expect: false },
			{ kind: "crushes", item: "hot" },
			{ kind: "lets_go", item: "cup", before_s: 1 },
			{ kind: "stays_held", item: "glass" },
			{ kind: "smoke_drifts", item: "smoke", toward: "up" },
			{ kind: "stays_held", item: "cup" }
		],
		3
	)
	const R = run(s)
	assert.deepEqual(R.summary.goals.map((g) => g.ok), [true, true, true, true, true, true, true, true, false], JSON.stringify(R.summary.goals))
	const py = JSON.parse(
		execFileSync("python3", ["-c", `
import json, sys, os
sys.path.insert(0, ${JSON.stringify(join(PG, "machines"))})
import items
d = json.load(sys.stdin)
print(json.dumps(items.summarize(d["scene"], d["doc"], d["track"])))
`], { input: JSON.stringify({ scene: R.scene, doc: R.doc, track: R.track }), env: { ...process.env, PLAYGROUND_MODULES: "air,fluids,measure" }, maxBuffer: 1 << 28 }).toString()
	)
	assert.deepEqual(py.goals, JSON.parse(JSON.stringify(R.summary.goals)))
	assert.deepEqual(py.readings, JSON.parse(JSON.stringify(R.summary.readings)))
	assert.deepEqual(py.happenings, JSON.parse(JSON.stringify(R.summary.happenings)))
	// the AI's own check of a module goal on the run (by a spelling a model may use)
	assert.equal(plugins.checkModuleGoal({ kind: "balloon_rises", item: "he" }, { scene: R.scene, doc: R.doc, track: R.track }).ok, true)
	assert.equal(plugins.checkModuleGoal({ kind: "can_crushes", item: "hot" }, { scene: R.scene, doc: R.doc, track: R.track }).ok, true)
	assert.equal(plugins.checkModuleGoal({ kind: "card_holds", item: "cup" }, { scene: R.scene, doc: R.doc, track: R.track }).ok, false)
})

test("an unlabelled expect:false control carried through an edit stays unlabelled, and is said as it is checked (the hot-air balloon demo)", () => {
	// (the app's Edit with AI, "Turn the heater on the hot-air balloon down to half its power", stored "Unheated balloon rises" on the control
	// {lifts_off, at_least_m 0.05, expect false} and the card said "Unheated balloon rises · yes" while it sat on its stand)
	const demo = JSON.parse(readFileSync(join(PG, "demos", "air", "hot-air-balloon.json"), "utf8"))
	const control = demo.goals.find((g) => g.expect === false)
	assert.deepEqual(control, { kind: "lifts_off", item: "cold", at_least_m: 0.05, expect: false }, "the demo's control, without a label")
	const plan = planFromScene(demo)
	const hab = plan.items.find((i) => i.id === "hab")
	const full = sim.catalog().types.find((t) => t.key === "hot-air-balloon").props.find((p) => p.key === "heater_w").default
	hab.props = { ...(hab.props ?? {}), heater_w: full / 2 }
	const r = solve(plan)
	assert.ok(r.ok, JSON.stringify(r.errors))
	assert.deepEqual(r.scene.goals.find((g) => g.item === "cold"), control, "the goal the edit did not touch is as it was: no label of the AI's")
	assert.deepEqual(r.scene.goals.find((g) => g.item === "hab"), demo.goals.find((g) => g.item === "hab"))
	const words = "Unheated balloon does not rise 5 cm"
	assert.equal(r.goals.find((g) => g.item === "cold").label, words, "the AI's own list says it with its not and its number")
	assert.equal(goalLabel(control, { cold: "Unheated balloon" }), words)
	assert.equal(goalLabel({ kind: "lifts_off", item: "hab", at_least_m: 0.5 }, { hab: "Hot-air balloon" }), "Hot-air balloon rises at least 50 cm")
	const R = run(r.scene)
	const entry = R.summary.goals.find((g) => g.item === "cold")
	assert.equal(entry.label, words, "the run's summary")
	assert.equal(entry.ok, true, "the unheated balloon stays on its stand")
	const card = checkGoals(r.goals, { scene: R.scene, doc: R.doc, track: R.track, summary: R.summary }).find((g) => g.item === "cold")
	assert.equal(card.label, words, "the card")
	assert.equal(card.ok, true)
	// every kind that takes expect: a label made for expect false says its not, as its summary does, and keeps its numbers
	for (const k of mod.goals.filter((g) => g.fields?.expect)) {
		for (const extra of [{}, { at_least_m: 1.25 }, { before_s: 2 }]) {
			const g = { kind: k.kind, item: "b", expect: false, ...extra }
			const said = goalLabel(g, { b: "Balloon" })
			assert.match(said, /\bnot\b/, `${k.kind} ${JSON.stringify(extra)}: ${said}`)
			assert.equal(k.label(g, (id) => ({ b: "Balloon" })[id] ?? id), said, `${k.kind}: its own label() says the same`)
			if (extra.at_least_m && k.fields.at_least_m) assert.match(said, /1\.25 m/, said)
			if (extra.before_s && k.fields.before_s) assert.match(said, /by 2 s/, said)
		}
	}
	// the card's list of what an edit changed says such a goal in the same words (it said "Goal “lifts_off”: …", "Goal dropped: lifts_off")
	const edited = (f) => {
		const s2 = JSON.parse(JSON.stringify(demo))
		f(s2)
		return describeDiff(demo, s2)
	}
	assert.deepEqual(edited((s2) => (s2.goals.find((g) => g.item === "cold").at_least_m = 0.1)), [`Goal “${words}”: at least 5 cm → 10 cm`])
	assert.deepEqual(edited((s2) => (s2.goals.find((g) => g.item === "cold").expect = true)), [`Goal “${words}”: now it must happen`])
	assert.deepEqual(edited((s2) => (s2.goals = s2.goals.filter((g) => g.item !== "cold"))), [`Goal dropped: ${words}`])
	assert.deepEqual(edited((s2) => s2.goals.push({ kind: "lifts_off", item: "cold", at_least_m: 0.5 })), ["New goal: Unheated balloon rises at least 50 cm"])
})

test("the edit digest's lines: a helium balloon, a crushed can, a cup that let go, a kite with no wind, a plane in flight", () => {
	const s = scene(
		[
			{ id: "he", type: "party-balloon", x: 0.3, y: 0.9, props: { gas: "helium", fill_l: 10 } },
			{ id: "hot", type: "steam-can", x: 1.4, y: 0, props: { dip_at: 0.6 } },
			{ id: "cup", type: "suction-cup", x: 2.6, y: 0, props: { load_kg: 9 } },
			{ id: "k", type: "kite", x: 0.5, y: 0, props: {} },
			{ id: "pl", type: "paper-airplane", x: -0.3, y: 1.5, props: {} }
		],
		[],
		3
	)
	const R = run(s)
	const lines = (id) => plugins.digestLines(R.scene.items.find((i) => i.id === id), { ...R, resolved: R.resolved }).join(" ")
	assert.match(lines("he"), /helium, 10 L put in: .* cm across .*it rises/)
	assert.match(lines("hot"), /crushed at \d\.\d+ s, \d+ % of its volume pushed in/)
	assert.match(lines("cup"), /it LET GO at .* the air could hold 68\.7 N/)
	assert.match(lines("k"), /NO wind reaches it/)
	assert.match(lines("pl"), /flew \d+(\.\d+)? m before it landed|still flying/)
})

test("an airless world named by its gravity alone, and bursting in view", () => {
	const R = run(scene([{ id: "he", type: "party-balloon", x: 1.0, y: 1.0, props: { gas: "helium" } }], [{ kind: "lifts_off", item: "he", at_least_m: 0.05, expect: false }, { kind: "pops", item: "he" }], 2, { settings: { gravity: "moon" } }))
	assert.equal(R.doc.settings.air, false)
	assert.deepEqual(R.summary.goals.map((g) => g.ok), [true, true])
	assert.ok(R.track.state.he.diameter_cm[10] > 20, "shown as filled while held")
	assert.ok(R.summary.happenings.some((e) => /popped \(no air pressed on it from outside\)/.test(e.text) && e.t >= 0.5))
})

test("change words in real units", () => {
	assert.equal(plugins.changeWords("party-balloon", "fill_l", 8, 12), "gas in it 8 → 12 L")
	assert.equal(plugins.changeWords("hot-air-balloon", "start_c", 65, 80), "air inside at the start 65 → 80 °C")
	assert.equal(plugins.changeWords("paper-airplane", "launch_speed", 5, 7.5), "thrown at 5 → 7.5 m/s")
	assert.equal(plugins.changeWords("kite", "bridle", 0.45, 0.3), "line tied 45 → 30 % down from its nose")
	assert.equal(plugins.changeWords("suction-cup", "diameter", 0.05, 0.08), "cup 5 cm → 8 cm across (holds 69 → 176 N on glass)")
	assert.equal(plugins.changeWords("card-glass", "water", 0, 0.8), "water 0 → 80 % full")
	assert.equal(plugins.changeWords("steam-can", "boil_s", 0, 30), "boiled 0 → 30 s")
	assert.equal(plugins.changeWords("ball", "diameter", 0.1, 0.2), null)
	assert.equal(plugins.keyWords("party-balloon", "gas"), "helium|air")
})

const simulate = async (sc) => run(sc)

test("make it work: a suction cup that lets go of 9 kg holds once a module knob is turned (found and checked)", async () => {
	const s = scene([{ id: "cup", type: "suction-cup", name: "Suction cup", x: 1.2, y: 0, props: { load_kg: 9 } }], [{ kind: "stays_held", item: "cup" }], 2)
	const R = run(s)
	assert.equal(R.summary.goals[0].ok, false, "9 kg pulls it off")
	const fr = await findFix({ scene: R.scene, sim: R, goals: R.scene.goals }, { simulate, budgetMs: 180000, maxRuns: 120, parallel: 1 })
	assert.equal(fr.status, "found", JSON.stringify({ status: fr.status, runs: fr.runs, tried: fr.tried }))
	assert.match(JSON.stringify(fr.fix ?? fr), /load_kg|diameter|surface/)
})

test("make it work: a hot-air balloon that will not lift off is fixed by its heat (found and checked)", async () => {
	const s = scene([{ id: "hab", type: "hot-air-balloon", name: "Hot-air balloon", x: 1.2, y: 0, props: { start_c: 45, heater_w: 400 } }], [{ kind: "lifts_off", item: "hab", at_least_m: 0.3 }], 5)
	const R = run(s)
	assert.equal(R.summary.goals[0].ok, false, "45 °C and a weak heat gun do not lift it")
	const fr = await findFix({ scene: R.scene, sim: R, goals: R.scene.goals }, { simulate, budgetMs: 240000, maxRuns: 160, parallel: 1 }) // (a long budget: the runs are slow on a busy machine)
	assert.equal(fr.status, "found", JSON.stringify({ status: fr.status, runs: fr.runs, tried: fr.tried }))
	assert.match(JSON.stringify(fr.fix ?? fr), /start_c|heater_w/) // (its heat: the cheapest change that works, before a new envelope)
})

test("make it work keeps a fair test fair: never tunes what a comparison or a control holds equal on just one of the two (A8)", async () => {
	// a boiled can in an ice bath and in an 80 °C bath, the warm one wrongly expected to stay whole: both are crushed (47 kPa of vapour inside)
	const s = scene([
		{ id: "ice", type: "steam-can", name: "Can in ice water", x: 0.2, y: 0, props: { boil_s: 12, bath_c: 2 } },
		{ id: "warm", type: "steam-can", name: "Can in warm water", x: 1.6, y: 0, props: { boil_s: 12, bath_c: 80 } }
	], [{ kind: "crushes", item: "ice" }, { kind: "crushes", item: "warm", expect: false }], 4)
	const R = run(s)
	assert.deepEqual(R.summary.goals.map((g) => g.ok), [true, false], "the warm bath crushes it too")
	const fr = await findFix({ scene: R.scene, sim: R, goals: R.scene.goals }, { simulate, budgetMs: 120000, maxRuns: 60, parallel: 1 })
	const text = JSON.stringify(fr.fix ?? fr.tried ?? fr)
	assert.ok(!/"key":"boil_s"/.test(text), `boil_s (held equal by the comparison) was tuned on one can: ${text.slice(0, 600)}`)
})

test("make it work: a balloon in a jar pumped only to 60 kPa pops once it holds the gas that bursts it there (the pops goal's aim, found first)", async () => {
	const s = scene([
		{ id: "jar", type: "vacuum-jar", name: "Vacuum jar", x: 1.3, y: 0, props: { pump_at: 0.5, pump_s: 2, lowest_kpa: 60 } },
		{ id: "b", type: "party-balloon", name: "Small balloon", x: 1.3, y: 0.071, props: { size: 0.12, fill_l: 0.3 } }
	], [{ kind: "pops", item: "b" }], 10)
	const R = run(s)
	assert.equal(R.summary.goals[0].ok, false, "0.3 L does not burst it at 60 kPa")
	const fr = await findFix({ scene: R.scene, sim: R, goals: R.scene.goals }, { simulate, budgetMs: 120000, maxRuns: 20, parallel: 1 })
	assert.equal(fr.status, "found", JSON.stringify({ status: fr.status, runs: fr.runs }))
	assert.ok(fr.runs <= 6, `found at once (${fr.runs} runs)`)
	const b = fr.fix.scene.items.find((i) => i.id === "b")
	assert.ok(b.props.fill_l >= 1.3 && b.props.fill_l <= 1.7, `the gas that bursts it near 60 kPa: ${b.props.fill_l} L`)
	assert.ok(Math.abs(b.y - 0.071 - 0.0275) < 0.003, `set up by as much as it grew, resting where it rested (${b.y})`)
})
