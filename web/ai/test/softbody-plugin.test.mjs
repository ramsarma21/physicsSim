// The softbody module's AI plug-ins (web/sim/modules/softbody.js `plugin`, registered by web/sim/modules/index.js): its goal kinds (a plan's
// fields and spellings, the summary, the AI's own check), knobs, how-to, prompt lines and worked examples, the edit digest's lines (clay's dent,
// a ball's squash, a ruler's E·I and bend, a spring's squash) and its change words; its goal kinds' summaries Python == JavaScript on a real
// run; and the make-it-work search finding a checked fix through the module's knobs (a ruler that does not bend far enough, a flat ball that
// does not bounce high enough); the knobs offered only where they belong (a rubber band only on a car that has one, a material only on a ruler
// not compared with another), never tuned (a ball's pressure, a beam's material); the requests that bring the module's detail into the prompt.
//   node --test web/ai/test/softbody-plugin.test.mjs        (the end-to-end run through plans, the solver and the edit step: tools/softbody/test.mjs)
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const PG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
// measure: the gram masses the rulers carry
process.env.PLAYGROUND_MODULES = process.env.PLAYGROUND_MODULES ?? "measure,softbody"
const sim = await import(pathToFileURL(join(PG, "web/sim/index.js")).href)
const plugins = await import(pathToFileURL(join(PG, "web/sim/plugins.js")).href)
const goals = await import(pathToFileURL(join(PG, "web/ai/goals.js")).href)
const { findFix } = await import(pathToFileURL(join(PG, "web/ai/fixer.js")).href)
const bundle = await import(pathToFileURL(join(PG, "web/sim/engine-worker.js")).href)
const mod = plugins.modules().find((m) => m.name === "mod_softbody")
const TYPES = ["soft-clay", "playground-ball", "exercise-ball", "foam-ball", "flex-ruler", "springboard", "flex-plank", "band-launcher", "coil-spring"]

const STAGE = { x0: -0.56, x1: 3.19, y0: -0.16, y1: 2.34 }
const scene = (items, goals = [], seconds = 2, extra = {}) => ({ version: 2, id: "t", name: "t", seconds, release: 0.2, stage: STAGE, items: [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }, ...items], goals, ...extra })
const run = (s) => {
	const p = sim.prepare(JSON.parse(JSON.stringify(s)))
	const track = JSON.parse(JSON.stringify(bundle.run(p.doc, 120)))
	const fin = sim.finish(p.scene, p.doc, p.resolved, track)
	return { scene: p.scene, doc: p.doc, track, summary: fin.summary, resolved: fin.resolved ?? p.resolved }
}
// a mass on a ruler's end: the ruler's top is its block (5 cm) + its thickness (3 mm) above the table, its end 20 cm past the anchor
const onEnd = (id, x, grams) => ({ id, type: "gram-mass", x: x + 0.185, y: 0.053, props: { grams } })

// clay and a playground ball dropped 1 m, two acrylic rulers with 20 g and 100 g on their ends, a coil spring: every goal kind, met and not
const LESSON = scene(
	[
		{ id: "clay", type: "soft-clay", name: "Clay", x: 0.0, y: 1.0, held: true },
		{ id: "ball", type: "playground-ball", name: "Ball", x: 0.6, y: 1.0, held: true },
		{ id: "r1", type: "flex-ruler", name: "Light ruler", x: 1.2, y: 0, props: { material: "acrylic" } },
		onEnd("m1", 1.2, "20 g"),
		{ id: "r2", type: "flex-ruler", name: "Heavy ruler", x: 2.0, y: 0, props: { material: "acrylic" } },
		onEnd("m2", 2.0, "100 g"),
		{ id: "spring", type: "coil-spring", name: "Spring", x: 2.8, y: 0 }
	],
	[
		{ kind: "squashes", item: "clay", at_least_mm: 3 },
		{ kind: "springs_back", item: "ball" },
		{ kind: "bends", item: "r2", at_least_mm: 5 },
		{ kind: "deforms_more", a: "r2", b: "r1" },
		{ kind: "stores", item: "r2", at_least_j: 0.0001 },
		{ kind: "squashes", item: "ball" },
		{ kind: "springs_back", item: "clay" },
		{ kind: "deforms_more", a: "r1", b: "r2" },
		{ kind: "bends", item: "r1", at_least_mm: 50 },
		{ kind: "stores", item: "clay", at_least_j: 1 }
	],
	3
)
const WANT = [true, true, true, true, true, false, false, false, false, false]
let lessonRun = null
const lesson = () => (lessonRun ??= run(LESSON))

test("the module is registered with its goal kinds, knobs, how-to, prompt lines and examples, and replaces no other module's goal", () => {
	assert.ok(mod, "mod_softbody is in the registry")
	assert.deepEqual(sim.MODULE_ERRORS, {}, "every module loads")
	assert.deepEqual(mod.goals.map((g) => g.kind).sort(), ["bends", "bounces", "bounces_more", "deforms_more", "springs_back", "squashes", "stores"])
	for (const g of mod.goals) assert.ok(g.about && g.fields && typeof g.summarize === "function" && typeof g.sample === "function" && typeof g.label === "function", g.kind)
	const cat = sim.catalog()
	for (const t of TYPES) {
		const type = cat.types.find((x) => x.key === t)
		assert.ok(type, `${t} is in the catalog`)
		assert.equal(type.module, "softbody", t)
		assert.ok(type.readouts?.length > 0, `${t} has readings`)
	}
	// every type a teacher tunes has knobs, each with its words both ways and the physics why
	for (const t of ["flex-ruler", "springboard", "flex-plank", "soft-clay", "playground-ball", "exercise-ball", "foam-ball", "band-launcher", "coil-spring", "toy-car"]) {
		assert.ok(plugins.knobsFor(t).length > 0, `knobs for ${t}`)
		for (const k of plugins.knobsFor(t).filter((k) => mod.knobs.includes(k))) assert.ok(k.why && k.more && k.less, `${t}.${k.key}`)
	}
	assert.equal(plugins.knobOf("flex-ruler", "overhang")?.how, "rel")
	assert.equal(plugins.knobOf("band-launcher", "draw")?.how, "m")
	assert.equal(plugins.knobOf("toy-car", "band_turns")?.how, "abs")
	// a teacher's spellings
	for (const [spelling, kind] of [["dents", "squashes"], ["flattens", "squashes"], ["plastic", "squashes"], ["elastic", "springs_back"], ["sags", "bends"], ["deflects", "bends"], ["bends_more", "deforms_more"], ["squashes_more", "deforms_more"], ["stores_energy", "stores"], ["bounce_height", "bounces"], ["rebounds", "bounces"], ["bounces_higher", "bounces_more"], ["bounce_higher", "bounces_more"]]) {
		assert.equal(plugins.goalKind(spelling)?.kind, kind, spelling)
		assert.equal(plugins.goalKind(spelling)?.module, "mod_softbody", spelling)
	}
	assert.match(mod.howto, /ELASTIC things squash, bend or stretch/)
	assert.match(mod.howto, /PLASTIC things \(soft-clay\)/)
	for (const t of TYPES) assert.match(mod.howto, new RegExp(t), t)
	assert.match(plugins.promptSnippets("plan"), /Elastic vs plastic: drop a soft-clay ball/)
	assert.match(plugins.promptSnippets("edit"), /Soft & bendy: a beam bends more when longer/)
	assert.match(plugins.promptSnippets("refine"), /a load meant for a ruler's end must rest ON the ruler/)
	const lines = plugins.goalKindLines()
	for (const l of ["squashes {item, at_least_mm?}", "springs_back {item}", "bends {item, at_least_mm?, at_most_mm?}", "deforms_more {a, b}", "stores {item, at_least_j?}", "bounces {item, at_least_m?, at_most_m?}", "bounces_more {a, b}"]) assert.ok(lines.includes(l), l)
	assert.ok(mod.examples.length >= 3 && mod.examples.every((e) => e.ask && e.how))
	const keys = new Set(cat.types.map((t) => t.key))
	for (const e of mod.examples) for (const m of e.how.matchAll(/\b([a-z]+(?:-[a-z]+)+)\b/g)) if (/(ruler|clay|ball|launcher|car|spring|board|plank)$/.test(m[1])) assert.ok(keys.has(m[1]), `${m[1]} in "${e.ask}"`)
})

test("a plan's softbody goals are checked by their fields", () => {
	const ids = new Set(["clay", "r1", "r2"])
	assert.equal(plugins.goalProblem({ kind: "bends", item: "r1" }, ids), null)
	assert.equal(plugins.goalProblem({ kind: "squashes", item: "clay", at_least_mm: 2 }, ids), null)
	assert.equal(plugins.goalProblem({ kind: "bends" }, ids), "bends needs item")
	assert.match(plugins.goalProblem({ kind: "deforms_more", a: "r1", b: "nobody" }, ids), /no item "nobody"/)
	assert.match(plugins.goalProblem({ kind: "bends", item: "r1", at_least_mm: "lots" }, ids), /must be a number/)
})

test("the summary and the AI's own checks agree: clay keeps its dent, the ball springs back, the heavier load bends its ruler more", () => {
	const r = lesson()
	assert.deepEqual(r.summary.goals.map((g) => g.ok), WANT, JSON.stringify(r.summary.goals))
	for (const [i, g] of r.scene.goals.entries()) assert.equal(plugins.checkModuleGoal(g, { doc: r.doc, track: r.track, scene: r.scene }).ok, WANT[i], `checkModuleGoal ${g.kind}`)
	assert.deepEqual(goals.checkGoals(r.scene.goals, { doc: r.doc, track: r.track, summary: r.summary }).map((x) => x.ok), WANT)
	const g = Object.fromEntries(r.summary.goals.slice(0, 5).map((x) => [x.kind, x]))
	// clay dropped 1 m: ½·m·v² = 3σ·π·R·δ² (σ 0.04 MPa, normal clay) gives a flat of about 7 mm; the ball squashes about 3 cm and keeps nothing
	assert.ok(g.squashes.dent_mm > 5 && g.squashes.dent_mm < 10, `clay's dent ${g.squashes.dent_mm} mm`)
	assert.ok(g.springs_back.peak_mm > 15 && g.springs_back.peak_mm < 45, `the ball's squash ${g.springs_back.peak_mm} mm`)
	// 100 g on a 20 cm acrylic ruler: F·L³/(3EI) = 12.1 mm (E·I 0.216 N·m²); 20 g: about a fifth, plus the ruler's own weight
	assert.ok(Math.abs(g.bends.bend_mm - 12.1) < 1.5, `the heavy ruler's bend ${g.bends.bend_mm} mm`)
	assert.ok(g.deforms_more.b_mm > 2 && g.deforms_more.b_mm < 4.5, `the light ruler's bend ${g.deforms_more.b_mm} mm`)
	assert.equal(r.summary.readings.r2.broken, 0)
})

test("the edit digest: clay's flow and dent, a ball's pressure and squash, a ruler's E·I and bend per 100 g, a spring's squash per 100 g", () => {
	const r = lesson()
	const it = (id) => r.scene.items.find((i) => i.id === id)
	const clay = mod.digest(it("clay"), r, {}).join(" | ")
	assert.match(clay, /modelling clay flowing at 0\.12 MPa: it keeps every dent/)
	assert.match(clay, /in the last run its deepest dent \d+(\.\d)? mm/)
	const ball = mod.digest(it("ball"), r, {}).join(" | ")
	assert.match(ball, /inflated to 14 kPa: it flattens where it presses \(force = pressure × the flat's area\) and springs back/)
	assert.match(ball, /in the last run it squashed \d+(\.\d)? mm at most \(0 mm at the end\)/)
	const ruler = mod.digest(it("r2"), r, {}).join(" | ")
	assert.match(ruler, /an acrylic \(plastic\) ruler 3 mm thick, 3 cm wide, 20 cm sticking out past its block: E·I 0\.216 N·m²; 100 g on its very end bends it about 12\.11 mm \(F·L³\/3EI\); bent too far it snaps/)
	assert.match(ruler, /in the last run it ended bent 1[12]\.\d mm/)
	assert.match(mod.digest(it("spring"), r, {}).join(" | "), /200 N\/m, 12 cm long: each 100 g squashes it 4\.91 mm \(its readings are zeroed with its own platform resting on it\); what is on it ended squashing it 0 mm/)
	// the loads where they rest: the 100 g mass's centre 1.5 cm in from the end bends the end by F·a²(3L − a)/6EI
	assert.match(ruler, /what rests on it at the end of the last run: m2 \(100 g\) centred 1[89]\.\d cm from the block's edge, [01]\.\d cm in from the end: Euler-Bernoulli F·a²\(3L − a\)\/6EI gives its end a bend of about 1[01]\.\d mm for loads there/)
	assert.match(ball, /its first bounce \(landing at 0\.\d+ s\) rose 0\.\d+ m above what it landed on/)
	assert.equal(mod.digest({ id: "x", type: "superball", props: {} }, r, {}), null, "nothing for another module's type")
	assert.equal(mod.digest({ id: "x", type: "toy-car", props: {} }, r, {}), null, "nothing for a car without a rubber band")
})

test("change words in real units", () => {
	// (never a parenthesis inside a change line: the card puts the line in one)
	assert.equal(plugins.changeWords("flex-ruler", "overhang", 0.2, 0.3), "overhang 20 cm → 30 cm: it bends 3.37× as much (L³)")
	assert.equal(plugins.changeWords("flex-ruler", "material", "acrylic", "steel"), "acrylic (plastic) → steel, E 3.2 → 200 GPa")
	assert.equal(plugins.changeWords("springboard", "thickness_mm", 10, 20), "thickness 10 → 20 mm: it bends 0.13× as much (1/t³)")
	assert.equal(plugins.changeWords("soft-clay", "softness", "normal", "soft"), "clay normal → soft, flowing at 0.12 → 0.08 MPa")
	assert.equal(plugins.changeWords("playground-ball", "pressure", 14, 7), "pumped 14 → 7 kPa: it bounces lower (leaving the floor at 0.75 → 0.68 of its landing speed)")
	assert.equal(plugins.changeWords("band-launcher", "draw", 0.1, 0.15), "pulled back 10 cm → 15 cm")
	assert.equal(plugins.changeWords("band-launcher", "bands", 1, 2), "1 → 2 bands each side")
	assert.equal(plugins.changeWords("band-launcher", "band", "thin", "thick"), "band thin → thick, 1.6 mm → 12.7 mm wide")
	assert.equal(plugins.changeWords("coil-spring", "stiffness", 200, 400), "stiffness 200 → 400 N/m: it squashes 0.5× as much")
	assert.equal(plugins.changeWords("toy-car", "band_turns", 0, 1), "rubber band wound 0 turns → 1 turn")
	assert.equal(plugins.changeWords("toy-car", "band_turns", 5, 10), "rubber band wound 5 turns → 10 turns")
	assert.equal(plugins.changeWords("toy-car", "band_size", "medium", "thick"), "rubber band medium → thick, 6.35 mm → 12.7 mm wide")
	assert.equal(plugins.changeWords("superball", "diameter", 0.06, 0.08), null)
})

test("every goal kind: Python's summary (machines/mod_softbody.py) == web/sim's on a real run", () => {
	const js = lesson()
	const py = JSON.parse(
		execFileSync("python3", ["-c", "import sys, json; sys.path.insert(0, 'machines'); import items; r = json.load(sys.stdin); print(json.dumps(items.summarize(r['scene'], r['doc'], r['track'])))"], {
			cwd: PG,
			input: JSON.stringify({ scene: js.scene, doc: js.doc, track: js.track }),
			env: { ...process.env, PLAYGROUND_MODULES: "measure,softbody" },
			maxBuffer: 1 << 28
		}).toString()
	)
	assert.equal(JSON.stringify(py.goals), JSON.stringify(js.summary.goals))
	assert.deepEqual(py.happenings, js.summary.happenings)
	assert.deepEqual(py.readings, js.summary.readings)
})

test("make it work: a ruler that does not bend 20 mm under its 100 g is fixed through the module's knobs, found and checked", async () => {
	const s = scene([{ id: "r", type: "flex-ruler", name: "Ruler", x: 1.2, y: 0, props: { material: "acrylic" } }, onEnd("m", 1.2, "100 g")], [{ kind: "bends", item: "r", at_least_mm: 20, label: "The ruler bends at least 2 cm" }], 2)
	const R = run(s)
	assert.equal(R.summary.goals[0].ok, false, `100 g bends a 20 cm acrylic ruler about 12 mm (${R.summary.goals[0].bend_mm})`)
	const simulate = async (sc) => run(sc)
	const fr = await findFix({ scene: R.scene, sim: R, goals: R.scene.goals }, { simulate, budgetMs: 120000, maxRuns: 120, parallel: 1 })
	assert.equal(fr.status, "found", JSON.stringify({ status: fr.status, runs: fr.runs, tried: fr.tried }).slice(0, 600))
	const words = JSON.stringify(fr.fix ?? fr)
	assert.match(words, /out farther|overhang|narrow|material|width|grams|mass/i, words.slice(0, 400))
	const again = run(fr.fix.scene)
	assert.ok(again.summary.goals.every((g) => g.ok), JSON.stringify(again.summary.goals))
})

// ---- the second round (October 20): bounces, fair knobs, honest words
const BOUNCE = scene(
	[
		{ id: "hi", type: "playground-ball", name: "Pumped ball", x: 0.5, y: 1.108, held: true, props: { pressure: 20 } },
		{ id: "lo", type: "playground-ball", name: "Flat ball", x: 1.3, y: 1.108, held: true, props: { pressure: 3 } },
		{ id: "clay", type: "soft-clay", name: "Clay", x: 2.1, y: 1.03, held: true }
	],
	[
		{ kind: "bounces_more", a: "hi", b: "lo" },
		{ kind: "bounces", item: "hi", at_least_m: 0.5 },
		{ kind: "bounces", item: "lo", at_most_m: 0.4 },
		{ kind: "bounces", item: "lo" },
		{ kind: "bounces_more", a: "lo", b: "hi" },
		{ kind: "bounces", item: "clay" },
		{ kind: "bounces", item: "lo", at_least_m: 0.5 }
	],
	2.4
)
let bounceRun = null
const bouncy = () => (bounceRun ??= run(BOUNCE))

test("more air bounces higher: the bounce goals on a real run, summary == the AI's own check == Python's", () => {
	const r = bouncy()
	const want = [true, true, true, true, false, false, false]
	assert.deepEqual(r.summary.goals.map((g) => g.ok), want, JSON.stringify(r.summary.goals))
	for (const [i, g] of r.scene.goals.entries()) assert.equal(plugins.checkModuleGoal(g, { doc: r.doc, track: r.track, scene: r.scene }).ok, want[i], `checkModuleGoal ${g.kind}`)
	const [more] = r.summary.goals
	// dropped 1 m: e(20 kPa) = 0.79, e(3 kPa) = 0.57 ([BOUNCE]): their first bounces about e² of the drop
	assert.ok(more.a_m > 0.55 && more.a_m < 0.65, `the 20 kPa ball's bounce ${more.a_m} m`)
	assert.ok(more.b_m > 0.28 && more.b_m < 0.38, `the 3 kPa ball's bounce ${more.b_m} m`)
	assert.ok(r.summary.goals[5].bounce_m < 0.01, `clay does not bounce (${r.summary.goals[5].bounce_m} m)`)
	assert.equal(r.summary.goals[1].label, "Pumped ball bounces at least 0.5 m high")
	assert.equal(r.summary.goals[3].label, "Flat ball bounces")
	const py = JSON.parse(
		execFileSync("python3", ["-c", "import sys, json; sys.path.insert(0, 'machines'); import items; r = json.load(sys.stdin); print(json.dumps(items.summarize(r['scene'], r['doc'], r['track'])))"], {
			cwd: PG,
			input: JSON.stringify({ scene: r.scene, doc: r.doc, track: r.track }),
			env: { ...process.env, PLAYGROUND_MODULES: "measure,softbody" },
			maxBuffer: 1 << 28
		}).toString()
	)
	assert.equal(JSON.stringify(py.goals), JSON.stringify(r.summary.goals))
	assert.deepEqual(goals.checkGoals(r.scene.goals, { doc: r.doc, track: r.track, summary: r.summary }).map((x) => x.ok), want)
})

test("make it work: a flat ball that must bounce 0.4 m is pumped up, found and checked", async () => {
	const s = { ...BOUNCE, goals: [{ kind: "bounces", item: "lo", at_least_m: 0.4, label: "The flat ball bounces at least 0.4 m" }] }
	const R = run(s)
	assert.equal(R.summary.goals[0].ok, false)
	const fr = await findFix({ scene: R.scene, sim: R, goals: R.scene.goals }, { simulate: async (sc) => run(sc), budgetMs: 120000, maxRuns: 80, parallel: 1 })
	assert.equal(fr.status, "found", JSON.stringify({ status: fr.status, runs: fr.runs }).slice(0, 400))
	assert.match(JSON.stringify(fr.fix), /pressure|pump|air/i)
	assert.ok(run(fr.fix.scene).summary.goals.every((g) => g.ok))
})

test("knobs where they belong: a rubber band only on a car that has one, a material only on a ruler not compared, no tuning of what a lesson compares", () => {
	const kb = plugins.knobOf("toy-car", "band_turns")
	assert.equal(plugins.knobApplies(kb, { id: "c", type: "toy-car", props: {} }, { items: [] }), false, "a plain car gets no hidden band")
	assert.equal(plugins.knobApplies(kb, { id: "c", type: "toy-car", props: { band_turns: 5 } }, { items: [] }), true)
	const mat = plugins.knobOf("flex-ruler", "material")
	const r1 = { id: "r1", type: "flex-ruler", props: {} }
	assert.equal(plugins.knobApplies(mat, r1, { items: [r1] }), true, "one ruler: its material may change")
	assert.equal(plugins.knobApplies(mat, r1, { items: [r1, { id: "r2", type: "flex-ruler" }] }), false, "two compared rulers: never only one's material")
	for (const [t, k] of [["foam-ball", "stiffness"], ["playground-ball", "pressure"], ["exercise-ball", "pressure"], ["flex-ruler", "material"], ["springboard", "material"], ["flex-plank", "material"], ["soft-clay", "softness"], ["coil-spring", "stiffness"]]) assert.equal(plugins.knobTunable(t, k), false, `${t}.${k}`)
	assert.equal(plugins.knobTunable("flex-ruler", "overhang"), true)
	assert.equal(plugins.knobTunable("table", "width"), true, "a type without module knobs")
})

test("honest card words: a bending board still moves, a ruler weighs its whole length, a launcher's own parts are no news", () => {
	const r = lesson()
	assert.equal(plugins.moduleMoves(r.scene.items.find((i) => i.id === "r2"), r), true, "a ruler bent 12 mm still does its thing")
	assert.equal(plugins.moduleMoves({ id: "x", type: "toy-car" }, r), null)
	const w = (props) => plugins.moduleMass("flex-ruler", props)
	assert.ok(Math.abs(w({ overhang: 0.25 }) - w({ overhang: 0.12 })) < 1e-12, "the overhang does not change its weight")
	assert.ok(Math.abs(w({}) - 0.3 * 0.0035 * 0.03 * 700) < 1e-6, `a 30 cm wooden ruler weighs about 22 g (${w({})})`)
	assert.equal(plugins.ownHitsTold("band-launcher"), false)
	assert.equal(plugins.ownHitsTold("newtons-cradle"), true)
})

test("the prompt carries the module for band cars, modelling clay and bounces, and not for plain car races", async () => {
	const { digestFromCatalog, promptCatalog } = await import(pathToFileURL(join(PG, "ai/catalog-digest.mjs")).href)
	const cat = digestFromCatalog(sim.catalog())
	const picks = (t) => promptCatalog(cat, { text: t }).modules
	if (!cat.tiers) return // (a small catalog goes whole into every prompt)
	for (const t of ["Wind-up rubber band cars: two toy cars side by side, one wound 5 turns and one wound 20 turns", "Warm a ball of modelling clay and drop it", "A ball pumped up with more air bounces higher", "A flat ball does not bounce as high"])
		assert.ok(picks(t).includes("mod_softbody"), t)
	assert.ok(!picks("Red car and blue car: which goes farther in 3 seconds?").includes("mod_softbody"))
})

test("deforms_more between two stiff rulers that bend under a millimetre: by a quarter, and it says the bends are small", () => {
	const ctx = (a, b) => ({ known: () => true, name: (x) => x, num: (v) => (typeof v === "number" ? v : null), state: (id, k) => (k === "bend_mm" ? [id === "a" ? a : b] : null) })
	const softbody = mod.goals.find((g) => g.kind === "deforms_more")
	assert.equal(softbody.summarize(ctx(0.5, 0.3), { a: "a", b: "b" }).ok, true)
	assert.equal(softbody.summarize(ctx(0.5, 0.3), { a: "a", b: "b" }).small, true)
	assert.equal(softbody.summarize(ctx(0.33, 0.3), { a: "a", b: "b" }).ok, false)
	assert.equal(softbody.summarize(ctx(12, 11.6), { a: "a", b: "b" }).ok, false, "big bends: 5 % and 0.2 mm")
	assert.equal(softbody.summarize(ctx(12, 11), { a: "a", b: "b" }).small, undefined)
})
