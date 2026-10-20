// The flow module's AI plug-ins (web/sim/modules/flow.js `plugin`, registered by web/sim/modules/index.js): its goal kinds (spellings, field
// checks, summaries Python == JavaScript on a real run, the AI's own check), knobs, how-to and prompt lines, held items, request words, every
// worked example solved and met in the engine bundle, the edit digest's lines (where a stream lands: into a jar, or missing it by how much),
// its change words, and make-it-work searches that find a fix with its knobs or a move: a pour that misses its jar, a waterwheel too loaded.
//   node --test web/ai/test/flow-plugin.test.mjs
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const PG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
process.env.PLAYGROUND_MODULES = process.env.PLAYGROUND_MODULES ?? "flow,fluids,measure"
const sim = await import(pathToFileURL(join(PG, "web/sim/index.js")).href)
const plugins = await import(pathToFileURL(join(PG, "web/sim/plugins.js")).href)
const { solve } = await import(pathToFileURL(join(PG, "web/ai/solver.js")).href)
const { findFix } = await import(pathToFileURL(join(PG, "web/ai/fixer.js")).href)
const bundle = await import(pathToFileURL(join(PG, "web/sim/engine-worker.js")).href)
const mod = plugins.modules().find((m) => m.name === "mod_flow")

const run = (scene) => {
	const p = sim.prepare(scene)
	const track = JSON.parse(JSON.stringify(bundle.run(p.doc, 120)))
	const fin = sim.finish(p.scene, p.doc, p.resolved, track)
	return { scene: p.scene, doc: p.doc, track, summary: fin.summary, resolved: p.resolved }
}
const STAGE = { x0: -0.56, x1: 3.19, y0: -0.16, y1: 2.34 }
const scene = (items, goals = [], seconds = 3) => ({ version: 2, id: "t", name: "t", seconds, release: 0.2, stage: STAGE, items: [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }, ...items], goals })

test("the module is registered with its goal kinds, knobs, how-to, prompt lines, held items and request words", () => {
	assert.ok(mod, "mod_flow is in the registry")
	assert.deepEqual(mod.goals.map((g) => g.kind).sort(), ["delivers", "empties", "fills", "fills_faster", "jet_farthest", "mixes_to", "overflows", "pours_faster", "reaches_farther", "turns", "turns_faster"])
	for (const g of mod.goals) assert.ok(g.about && g.fields && typeof g.summarize === "function" && typeof g.sample === "function", g.kind)
	for (const t of ["pitcher", "tap", "leaky-bottle", "hose", "waterwheel"]) assert.ok(plugins.knobsFor(t).length > 0, `knobs for ${t}`)
	for (const k of mod.knobs) assert.ok(k.why && k.more && k.less, `${k.type}.${k.key}`)
	assert.match(mod.howto, /POUR LIP/)
	assert.match(mod.howto, /LANDS PAST THE LIP/)
	assert.match(plugins.promptSnippets("plan"), /Flowing liquids/)
	assert.match(plugins.goalKindLines(), /fills \{container, at_least_ml, before_s\?\}/)
	assert.equal(plugins.goalKind("fill")?.kind, "fills", "an alias")
	assert.equal(plugins.goalKind("spins")?.kind, "turns", "an alias")
	assert.equal(plugins.goalKind("siphons")?.kind, "delivers", "an alias")
	assert.equal(plugins.heldByModule("pitcher", ["table", "pitcher"]), true, "a pitcher is held by the hand that tips it")
	assert.equal(plugins.heldByModule("tap", ["table", "tap"]), true)
	assert.match(plugins.keyWords("pitcher", "tilt"), /tip/)
	assert.match(plugins.keyWords("tap", "dye"), /colou\?r/)
	assert.equal(plugins.addedWords({ type: "pitcher", props: { liquid: "honey", fill_ml: 300 } }), "a pitcher of 300 mL of honey")
	assert.ok(mod.examples.length >= 12)
	for (const ex of mod.examples) assert.ok(typeof ex.how === "string" && ex.how.length > 20, `${ex.ask}: the digest lists an example only with its words (how)`)
	assert.equal(plugins.goalKind("squirts_farther")?.kind, "reaches_farther", "an alias")
	assert.equal(plugins.goalKind("overflow")?.kind, "overflows", "an alias")
	assert.equal(plugins.hoversByModule("pitcher"), true, "a pitcher is held over what it fills: the solver raises it clear")
	assert.equal(plugins.hoversByModule("bucket"), false)
})

test("the catalog digest's tiers give a plain pouring request this module's detail, and leave other lessons alone", () => {
	// (with every module loaded, as the app runs: a child process, since this one loads only a few)
	const asks = [
		"Pour a cup of vegetable oil and a cup of water into the same glass jar and watch the layers",
		"A tap runs into a coffee mug until the mug overflows",
		"Pour the water from one glass into another glass",
		"Pour juice into a cup until it overflows",
		"Pour oil and water into a jar to see the layers",
		"Water runs down a slide into a bucket",
		"Mix red and yellow paint water to make orange",
		"A cup of water is spilled on the floor",
		"Siphon water from a bucket into a jar",
		"Turn the faucet on and fill the sink"
	]
	const others = ["A ball rolls down a ramp into a cup", "A red car goes 10 m in 3 s and a blue car 10 m in 4 s, timed with stopwatches", "Fans push sailboats across a tank"]
	const code = `import { pathToFileURL } from "node:url"
await import(pathToFileURL(${JSON.stringify(join(PG, "tools/engine-math-node.mjs"))}).href)
const sim = await import(pathToFileURL(${JSON.stringify(join(PG, "web/sim/index.js"))}).href)
await (sim.ready ?? Promise.resolve())
const D = await import(pathToFileURL(${JSON.stringify(join(PG, "ai/catalog-digest.mjs"))}).href)
const cat = D.digestFromCatalog(sim.catalog())
const asks = JSON.parse(process.argv[1])
console.log(JSON.stringify({ tiers: !!cat.tiers, picks: asks.map((t) => D.promptCatalog(cat, { text: t }).modules) }))`
	const env = { ...process.env }
	delete env.PLAYGROUND_MODULES
	const out = execFileSync("node", ["--no-warnings", "--input-type=module", "-e", code, JSON.stringify([...asks, ...others])], { env, maxBuffer: 1 << 26 }).toString().trim().split("\n").at(-1)
	const { tiers, picks } = JSON.parse(out)
	assert.ok(tiers, "the whole catalog is tiered")
	asks.forEach((t, i) => assert.ok(picks[i].includes("mod_flow"), `${t}: ${picks[i].join(", ")}`))
	others.forEach((t, i) => assert.ok(!picks[asks.length + i].includes("mod_flow"), `${t}: ${picks[asks.length + i].join(", ")}`))
})

test("the solver raises a pitcher clear of the bowl it would start inside (place.hover), never the bowl pushed aside", () => {
	const r = solve({ title: "pour", seconds: 4, missing: [], tune: [], notes: "", items: [{ id: "bowl", type: "box", place: { on: "table", x: 1.2 } }, { id: "p", type: "pitcher", props: { vessel: "measuring cup", fill_ml: 300 }, place: { on: "air", x: 1.13, y_m: 0.17 } }], goals: [] })
	const bowl = r.scene.items.find((i) => i.id === "bowl")
	const p = r.scene.items.find((i) => i.id === "p")
	assert.ok(Math.abs(bowl.x - 1.2) < 1e-6, `the bowl stays at x 1.2 (${bowl.x})`)
	assert.ok(p.y > 0.17 + 0.01, `the pitcher is raised (${p.y})`)
	assert.equal(sim.layout(sim.clean(r.scene)).warnings.length, 0, "nothing starts inside anything")
})

test("a plan's flow goals are checked by their fields", () => {
	const ids = new Set(["jar", "p", "w", "b"])
	assert.equal(plugins.goalProblem({ kind: "fills", container: "jar", at_least_ml: 200 }, ids), null)
	assert.match(plugins.goalProblem({ kind: "fills", container: "jar" }, ids), /needs at_least_ml/)
	assert.match(plugins.goalProblem({ kind: "turns", item: "nobody" }, ids), /no item "nobody"/)
	assert.match(plugins.goalProblem({ kind: "mixes_to", container: "jar", color: 3 }, ids), /must be text/)
	assert.equal(plugins.goalProblem({ kind: "pours_faster", a: "p", b: "w" }, ids), null)
	assert.equal(plugins.goalProblem({ kind: "jet_farthest", item: "b", hole: 1 }, ids), null)
})

test("every worked example builds through the solver and meets its goals in the engine", () => {
	for (const ex of mod.examples) {
		const r = solve({ title: ex.ask.slice(0, 40), seconds: 4, missing: [], tune: [], notes: "", ...ex.plan })
		assert.ok(r.ok !== false, `${ex.ask}: ${JSON.stringify(r.issues)}`)
		const R = run({ ...r.scene, seconds: ex.plan.seconds ?? 4 })
		assert.equal(R.summary.goals.length, ex.plan.goals.length, `${ex.ask}: its goals are in the summary`)
		for (const g of R.summary.goals) assert.ok(g.ok, `${ex.ask}: ${g.label} (${JSON.stringify(g)})`)
	}
})

test("goal summaries: Python == JavaScript on a real run, and the AI's own check", () => {
	const s = scene([
		{ id: "jar", type: "glass-jar", x: 1.2, y: 0 },
		{ id: "p", type: "pitcher", x: 1.12, y: 0.32, props: { vessel: "cup", fill_ml: 150, dye: "blue" } },
		{ id: "b", type: "leaky-bottle", x: 0.3, y: 0, props: { kept_full: true, stand_cm: 20 } },
		{ id: "w", type: "waterwheel", x: 2.3, y: 0.5 },
		{ id: "t", type: "tap", x: 2.39, y: 0.8, props: { flow_ml_s: 120 } },
		{ id: "bu", type: "bucket", x: 2.4, y: 0 }
	], [
		{ kind: "fills", container: "jar", at_least_ml: 140, before_s: 3.5 }, { kind: "empties", item: "p" }, { kind: "jet_farthest", item: "b", hole: 1 },
		{ kind: "turns", item: "w", at_least_rpm: 30 }, { kind: "mixes_to", container: "jar", color: "blue" }, { kind: "delivers", item: "t", at_least_ml: 200 },
		{ kind: "pours_faster", a: "p", b: "t" }, { kind: "jet_farthest", item: "b", hole: 3 }, { kind: "mixes_to", container: "jar", color: "green" }
	], 4)
	const R = run(s)
	assert.deepEqual(R.summary.goals.map((g) => g.ok), [true, true, true, true, true, true, true, false, false], JSON.stringify(R.summary.goals))
	const py = JSON.parse(execFileSync("python3", ["-c", `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(PG, "machines"))})
import items
d = json.load(sys.stdin)
print(json.dumps(items.summarize(d["scene"], d["doc"], d["track"])))
`], { input: JSON.stringify({ scene: R.scene, doc: R.doc, track: R.track }), env: { ...process.env, PLAYGROUND_MODULES: "flow,fluids,measure" }, maxBuffer: 1 << 28 }).toString())
	assert.deepEqual(py.goals, JSON.parse(JSON.stringify(R.summary.goals)))
	assert.deepEqual(py.readings, JSON.parse(JSON.stringify(R.summary.readings)))
	assert.equal(plugins.checkModuleGoal({ kind: "spins", item: "w", at_least_rpm: 30 }, { scene: R.scene, doc: R.doc, track: R.track }).ok, true)
	assert.equal(plugins.checkModuleGoal({ kind: "fill", container: "jar", at_least_ml: 400 }, { scene: R.scene, doc: R.doc, track: R.track }).ok, false)
})

test("the edit digest says where a stream lands: into the jar, or missing it by how much and which way to move", () => {
	const into = run(scene([{ id: "jar", type: "glass-jar", x: 1.2, y: 0 }, { id: "p", type: "pitcher", x: 1.12, y: 0.32, props: { vessel: "cup", fill_ml: 150 } }], [], 3))
	const lines = (R, id) => plugins.digestLines(R.scene.items.find((i) => i.id === id), { ...R, resolved: R.resolved }).join(" | ")
	assert.match(lines(into, "p"), /INTO jar/)
	assert.match(lines(into, "p"), /it held 150 mL, poured 1[45]\d mL/)
	assert.match(lines(into, "jar"), /caught 1[45]\d mL/)
	const miss = run(scene([{ id: "jar", type: "glass-jar", x: 1.2, y: 0 }, { id: "p", type: "pitcher", x: 1.2, y: 0.32, props: { vessel: "cup", fill_ml: 150 } }], [], 3))
	assert.match(lines(miss, "p"), /MISSES jar \(opening x 1\.1\d+…1\.2\d+\) by \d+(\.\d)? cm to the right: move the pitcher \d+ cm left/)
	const hose = run(scene([{ id: "h", type: "hose", x: 1, y: 0.2, props: {} }], [], 1))
	assert.match(lines(hose, "h"), /NOT LINKED/)
	const capped = run(scene([{ id: "b", type: "leaky-bottle", x: 0.5, y: 0, props: { cap: true } }], [], 1.5))
	assert.match(lines(capped, "b"), /CAP ON: no water comes out/)
})

test("the run tells what happened: taps on and off, jets, a siphon named backwards, a bottle's holes that do not fit, a jammed wheel", () => {
	const ev = (R) => (R.track.events ?? []).map((e) => e.text)
	const tap = run(scene([{ id: "mug", type: "coffee-mug", x: 1.2, y: 0.0475 }, { id: "t", type: "tap", x: 1.2, y: 0.27, props: { flow_ml_s: 60, on_at: 0.5, off_at: 2 } }], [], 3))
	assert.ok(ev(tap).includes("t turns on (60 mL/s)") && ev(tap).includes("t turns off after 90 mL") && ev(tap).some((t) => /^mug fills to \d+ mL$/.test(t)), ev(tap).join("; "))
	const holes = run(scene([{ id: "b", type: "leaky-bottle", x: 0.5, y: 0, props: { holes: 4, lowest_cm: 15, spacing_cm: 5 } }], [], 1.5))
	assert.ok(ev(holes).some((t) => /^b has room for only 2 of its 4 holes/.test(t)), ev(holes).join("; "))
	const lines = (R, id) => plugins.digestLines(R.scene.items.find((i) => i.id === id), { ...R, resolved: R.resolved }).join(" | ")
	assert.match(lines(holes, "b"), /2 of its 4 holes would be above its 23 cm body/)
	const jam = run(scene([{ id: "w", type: "waterwheel", x: 1.2, y: 0.25 }, { id: "t", type: "tap", x: 1.11, y: 0.55, props: { flow_ml_s: 140 } }, { id: "tub", type: "bucket", x: 0.95, y: 0.004 }], [], 1))
	assert.ok(ev(jam).includes("tub is in the way of w's paddles: it cannot turn freely"), ev(jam).join("; "))
	assert.match(lines(jam, "w"), /IN THE WAY of its paddles/)
	const edge = run(scene([{ id: "b", type: "leaky-bottle", x: 3.0, y: 0, props: { kept_full: true } }], [], 2))
	assert.match(lines(edge, "b"), /PAST THE EDGE of what the bottle stands on/)
})

test("change words in real units", () => {
	assert.equal(plugins.changeWords("pitcher", "tilt", 60, 110), "tips to 60° → 110°")
	assert.equal(plugins.changeWords("pitcher", "liquid", "water", "honey"), "water → honey (1 → 7042 mm²/s: thicker, flows slower)")
	assert.equal(plugins.changeWords("leaky-bottle", "hole_mm", 4, 6), "holes 4 → 6 mm (flow × 2.25)")
	assert.equal(plugins.changeWords("leaky-bottle", "fill_cm", 10, 20), "water 10 → 20 cm deep (lowest jet 1.14 → 1.77 m/s)")
	assert.equal(plugins.changeWords("hose", "to", "a", "b", (id) => `the ${id}`), "to the a → the b")
	assert.equal(plugins.changeWords("tap", "flow_ml_s", 50, 140), "flow 50 → 140 mL/s")
	assert.equal(plugins.changeWords("ball", "diameter", 0.1, 0.2), null)
})

test("make it work: a pour that misses its jar is fixed and checked (the pitcher moved, or its tilt)", async () => {
	const s = scene([{ id: "jar", type: "glass-jar", x: 1.2, y: 0 }, { id: "p", type: "pitcher", name: "Pitcher", x: 1.22, y: 0.32, props: { vessel: "cup", fill_ml: 150 } }], [{ kind: "fills", container: "jar", at_least_ml: 120 }], 3)
	const R = run(s)
	assert.equal(R.summary.goals[0].ok, false, "the stream lands past the jar")
	const fr = await findFix({ scene: R.scene, sim: R, goals: R.scene.goals }, { simulate: async (sc) => run(sc), budgetMs: 90000, maxRuns: 80, parallel: 1 })
	assert.equal(fr.status, "found", JSON.stringify({ status: fr.status, runs: fr.runs, tried: fr.tried }))
	const words = JSON.stringify(fr.fix ?? fr)
	assert.match(words, /Pitcher|pitcher/, words.slice(0, 400))
})

test("make it work: a waterwheel too loaded to turn is fixed with the module's knobs (its axle freed, the tap opened)", async () => {
	const s = scene([
		{ id: "w", type: "waterwheel", name: "Wheel", x: 1.2, y: 0.5, props: { axle_friction: 0.05 } },
		{ id: "t", type: "tap", name: "Tap", x: 1.29, y: 0.8, props: { flow_ml_s: 60 } },
		{ id: "bu", type: "bucket", x: 1.3, y: 0 }
	], [{ kind: "turns", item: "w", at_least_rpm: 20 }], 3)
	const R = run(s)
	assert.equal(R.summary.goals[0].ok, false, "the loaded wheel hardly turns")
	const fr = await findFix({ scene: R.scene, sim: R, goals: R.scene.goals }, { simulate: async (sc) => run(sc), budgetMs: 90000, maxRuns: 80, parallel: 1 })
	assert.equal(fr.status, "found", JSON.stringify({ status: fr.status, runs: fr.runs, tried: fr.tried }))
	assert.match(JSON.stringify(fr.fix ?? fr), /axle|tap|flow|Wheel|Tap/)
})

test("make it work after the person moved the box it pours into: the pitcher is re-aimed (moved with it), checked in the engine", async () => {
	const before = scene([{ id: "bowl", type: "box", name: "Box", x: 1.2, y: 0 }, { id: "p", type: "pitcher", name: "Pitcher", x: 1.13, y: 0.3, props: { vessel: "measuring cup", fill_ml: 300 } }], [{ kind: "fills", container: "bowl", at_least_ml: 250 }], 5)
	const B = run(before)
	assert.equal(B.summary.goals[0].ok, true, `the pour fills the bowl at first (${JSON.stringify(B.summary.goals[0])})`)
	const moved = { ...before, items: before.items.map((i) => (i.id === "bowl" ? { ...i, x: 1.5 } : i)) }
	const R = run(moved)
	assert.equal(R.summary.goals[0].ok, false, "the stream now misses the moved bowl")
	const touched = new Map([["bowl", new Set(["place"])]])
	const fr = await findFix({ scene: R.scene, sim: R, goals: R.scene.goals, touched, before: { scene: B.scene, sim: B }, hard: touched, relaxed: true }, { simulate: async (sc) => run(sc), budgetMs: 90000, maxRuns: 60, parallel: 1 })
	assert.equal(fr.status, "found", JSON.stringify({ status: fr.status, runs: fr.runs, tried: fr.tried }))
	const ch = fr.fix.changes
	assert.ok(ch.some((c) => c.kind === "move" && c.ids.includes("p") && c.dx > 0.1), JSON.stringify(ch))
	assert.ok(!ch.some((c) => (c.ids ?? [c.id]).includes("bowl")), "the box the person moved stays where they put it")
})

test("make it work never takes back an on/off setting the person named (put the cap on): it says only undoing it would work", async () => {
	const before = scene([{ id: "b", type: "leaky-bottle", name: "Bottle", x: 0.5, y: 0, props: { kept_full: true } }], [{ kind: "jet_farthest", item: "b", hole: 1 }], 2)
	const B = run(before)
	assert.equal(B.summary.goals[0].ok, true)
	const capped = { ...before, items: before.items.map((i) => (i.id === "b" ? { ...i, props: { ...i.props, cap: true } } : i)) }
	const R = run(capped)
	assert.equal(R.summary.goals[0].ok, false, "with the cap on nothing comes out")
	const hard = new Map()
	const forward = new Map([["b", new Set(["cap"])]])
	const fr = await findFix({ scene: R.scene, sim: R, goals: R.scene.goals, touched: new Map([["b", new Set(["cap"])]]), before: { scene: B.scene, sim: B }, hard, forward, relaxed: true }, { simulate: async (sc) => run(sc), budgetMs: 60000, maxRuns: 40, parallel: 1 })
	assert.notEqual(fr.status, "found", `no fix takes the cap off: ${JSON.stringify(fr.fix?.changes)}`)
	assert.ok(fr.undoOnly && /cap/.test(JSON.stringify(fr.undoOnly)), `only undoing it would: ${JSON.stringify(fr.undoOnly)}`)
	const { offerWords } = await import(pathToFileURL(join(PG, "web/ai/edit-turns.js")).href)
	const w = offerWords({ state: "none", runs: fr.runs, undoOnly: { say: fr.undoOnly.words?.say, why: fr.undoOnly.why } })
	assert.match(w.text, /Only undoing your change would make it work/)
	assert.match(w.text, /no air gets in/)
})
