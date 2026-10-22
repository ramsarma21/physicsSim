// The magnetism module's AI plug-in (web/sim/modules/magnetism.js `plugin`, registered by web/sim/modules/index.js): its goal kinds (spellings,
// field checks, summaries Python == JavaScript on a real run, the AI's own check), knobs, how-to and prompt lines, every worked example built by the
// solver and met in the engine bundle, every lesson demo's outcome in the bundle (tools/parity/fixtures/magnetism-demos.json, `expect` where a
// goal is meant to fail), the edit digest's lines (magnets, iron, non-magnetic things, a compass, a balloon, an electromagnet), its change words,
// and two make-it-work searches through its knobs (flipped carts, a balloon rubbed too little).
//   node --test web/ai/test/magnetism-plugin.test.mjs
import assert from "node:assert/strict"
import { execFileSync } from "../../../tools/child-sync.mjs" // (node's, with the input given to the child as a file: a macOS hang, tools/child-sync.mjs)
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const PG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const sim = await import(pathToFileURL(join(PG, "web/sim/index.js")).href)
if (sim.ready) await sim.ready
const plugins = await import(pathToFileURL(join(PG, "web/sim/plugins.js")).href)
const { solve } = await import(pathToFileURL(join(PG, "web/ai/solver.js")).href)
const { findFix, fixWords } = await import(pathToFileURL(join(PG, "web/ai/fixer.js")).href)
const { humanChangeList } = await import(pathToFileURL(join(PG, "web/ai/orchestrator.js")).href)
const bundle = await import(pathToFileURL(join(PG, "web/sim/engine-worker.js")).href)
const mod = plugins.modules().find((m) => m.name === "mod_magnetism")
const DEMOS = JSON.parse(readFileSync(join(PG, "tools/parity/fixtures/magnetism-demos.json"), "utf8"))
const demo = (id) => JSON.parse(JSON.stringify(DEMOS.find((d) => d.id === id)))

const run = (scene) => {
	const p = sim.prepare(scene)
	const track = JSON.parse(JSON.stringify(bundle.run(p.doc, 24)))
	const fin = sim.finish(p.scene, p.doc, p.resolved, track)
	return { scene: p.scene, doc: p.doc, track, summary: fin.summary, resolved: p.resolved }
}
const TYPES = ["bar-magnet", "horseshoe-magnet", "disc-magnet", "ring-magnets", "magnet-cart", "battery-electromagnet", "balloon", "paper-bits", "charged-rod", "clip-on-thread", "barrier-sheet", "compass", "can-on-side"]

test("the module is registered with its goal kinds, knobs, how-to and prompt lines", () => {
	assert.ok(mod, "mod_magnetism is in the registry")
	assert.deepEqual(mod.goals.map((g) => g.kind).sort(), ["attracts", "holds", "levitates", "lifts", "not_attracted", "points", "repels", "sticks"])
	for (const g of mod.goals) assert.ok(g.about && g.fields && typeof g.summarize === "function" && typeof g.sample === "function" && typeof g.label === "function", g.kind)
	for (const t of TYPES) assert.ok(plugins.knobsFor(t).length > 0, `knobs for ${t}`)
	for (const k of mod.knobs) {
		assert.ok(k.why && k.more && k.less, `${k.type}.${k.key}`)
		// ({it} is "the bar magnet": a knob's words read "make the bar magnet longer", never "use a longer the bar magnet")
		assert.doesNotMatch(`${k.more} ${k.less}`, /\b(a|an|the) \{it\}/, `${k.type}.${k.key}: ${k.more}`)
		// (the fix card says what was done in the past tense from the first word: web/ai/fixer.js pastOf: "gave", "switched", never "rubed")
		for (const w of [k.more, k.less]) assert.ok(["make", "turn", "move", "use", "give", "add", "switch", "lengthen", "shorten"].includes(w.split(" ")[0]), `${k.type}.${k.key}: "${w}"`)
	}
	assert.match(mod.howto, /nothing else is magnetic/)
	assert.match(mod.howto, /Like poles facing push apart, unlike pull together/)
	assert.match(mod.howto, /balloon `rubbed` N strokes/)
	assert.match(plugins.promptSnippets("plan"), /Magnets: only iron and steel things/)
	assert.match(plugins.promptSnippets("edit"), /Magnets: a magnet's poles swap with `flip`/)
	assert.match(plugins.promptSnippets("refine"), /Magnets: a clip or can that must be pulled/)
	assert.match(plugins.goalKindLines(), /attracts \{source, item\}/)
	assert.match(plugins.goalKindLines(), /holds \{magnet, count, items\?\}/)
	for (const [alias, kind] of [["attract", "attracts"], ["pulls", "attracts"], ["repel", "repels"], ["push_apart", "repels"], ["stick", "sticks"], ["lift", "lifts"], ["jumps_to", "lifts"], ["compass_points", "points"], ["pick_up", "holds"], ["hover", "levitates"]])
		assert.equal(plugins.goalKind(alias)?.kind, kind, `${alias} is an alias of ${kind}`)
	assert.ok(mod.examples.length >= 11, "one worked example per lesson demo")
	// (each with its one-line `how`: the digest lists an example by it, ai/catalog-digest.mjs moduleExamples; VAI5, 20 Oct: none reached the AI)
	for (const ex of mod.examples) assert.ok(ex.ask && typeof ex.how === "string" && ex.how.length > 20 && ex.plan?.items?.length && ex.plan.goals?.length, ex.ask)
	for (const [alias, kind] of [["not_pulled", "not_attracted"], ["not_moved_toward", "not_attracted"], ["not_picked_up", "not_attracted"]]) assert.equal(plugins.goalKind(alias)?.kind, kind, alias)
	assert.match(plugins.promptSnippets("plan"), /not_attracted \{source, item\}/)
	assert.match(plugins.promptSnippets("edit"), /rewrite that pair's attracts goal as repels/)
})

test("a plan's magnetism goals are checked by their fields", () => {
	const ids = new Set(["m", "c", "k"])
	assert.equal(plugins.goalProblem({ kind: "attracts", source: "m", item: "c" }, ids), null)
	assert.match(plugins.goalProblem({ kind: "attracts", source: "m" }, ids), /needs item/)
	assert.match(plugins.goalProblem({ kind: "holds", magnet: "m", count: "lots" }, ids), /count must be a number/)
	assert.equal(plugins.goalProblem({ kind: "holds", magnet: "m", count: 2, items: ["c"] }, ids), null)
	assert.match(plugins.goalProblem({ kind: "points", compass: "nobody" }, ids), /no item "nobody"/)
	assert.equal(plugins.goalProblem({ kind: "points", compass: "k", angle_deg: 180 }, ids), null)
	assert.equal(plugins.goalProblem({ kind: "repels", a: "m", b: "c", min_m: 0.02 }, ids), null)
})

test("every worked example builds through the solver and meets its goals in the engine", () => {
	for (const ex of mod.examples) {
		const r = solve({ missing: [], tune: [], notes: "", ...ex.plan })
		assert.ok(r.ok !== false, `${ex.ask}: ${JSON.stringify(r.issues)}`)
		const R = run({ ...r.scene, ...(ex.plan.seconds ? { seconds: ex.plan.seconds } : {}) })
		assert.equal(R.summary.goals.length, ex.plan.goals.length, `${ex.ask}: its goals are in the summary`)
		for (const g of R.summary.goals) assert.ok(g.ok, `${ex.ask}: ${g.label} (${JSON.stringify(g)})`)
	}
})

test("every lesson demo has its outcome in the engine bundle", () => {
	assert.equal(DEMOS.length, 20)
	for (const d of DEMOS) {
		const R = run(d)
		assert.equal(R.summary.goals.length, d.goals.length, d.id)
		R.summary.goals.forEach((g, k) => assert.equal(g.ok, d.expect?.[k] ?? true, `${d.id}: ${g.label} (${JSON.stringify(g)})`))
	}
})

test("goal summaries: Python == JavaScript on real runs, and the AI's own check", () => {
	const g3 = demo("g3-what-it-attracts")
	g3.goals.push({ kind: "sticks", item: "nail", to: "m3" }, { kind: "repels", a: "m0", b: "steel-clip" }, { kind: "lifts", source: "m0", item: "steel-clip" }, { kind: "holds", magnet: "m3", count: 1 })
	const g7 = demo("g7-compass")
	g7.goals.push({ kind: "points", compass: "above", toward: "magnet", tol_deg: 90 }, { kind: "levitates", item: "above" })
	const runs = [run(g3), run(g7), run(demo("g6-levitating-rings")), run(demo("em1-turns")), run(demo("g12-balloons-repel"))]
	// (the clip on the table slides up against the neodymium bar's pole face, 1 cm high, and is held there, its middle 7 mm over where it lay
	// and its low end off the table: a lift by the goal's 5 mm. On release 2 it chattered against the face, given e of the pole's pull at every
	// touch it made again (physics.ts `compensated`) and turned by that pull's moment taken implicitly (tooling/src/sim/magnetism.ts
	// `pairWrench`), and came to rest 4.9 mm up, just under; every non-magnetic thing's own not_attracted goal is met)
	assert.deepEqual(runs[0].summary.goals.map((g) => g.ok), [true, false, false, true, false, true, false, false, true, true, true, true, true, true, false, true, true])
	for (const R of runs) {
		const py = JSON.parse(execFileSync("python3", ["-c", `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(PG, "machines"))})
import items
d = json.load(sys.stdin)
fr = d["track"]["frames"]
last = dict(fr[-1], placements={**fr[0]["placements"], **fr[-1]["placements"]})
print(json.dumps(items.summarize(d["scene"], d["doc"], dict(d["track"], frames=fr[:-1] + [last]))))
`], { input: JSON.stringify({ scene: R.scene, doc: R.doc, track: R.track }), maxBuffer: 1 << 28 }).toString())
		assert.deepEqual(py.goals, JSON.parse(JSON.stringify(R.summary.goals)), R.scene.id)
		assert.deepEqual(py.readings, JSON.parse(JSON.stringify(R.summary.readings)), R.scene.id)
	}
	// the AI's own check of a module goal on a run, by an alias too
	const R = runs[0]
	assert.equal(plugins.checkModuleGoal({ kind: "pulls", source: "m3", item: "nail" }, { scene: R.scene, doc: R.doc, track: R.track }).ok, true)
	assert.equal(plugins.checkModuleGoal({ kind: "attract", source: "m1", item: "plastic-clip" }, { scene: R.scene, doc: R.doc, track: R.track }).ok, false)
})

test("the edit digest's lines: magnets, iron, non-magnetic things, a compass, a balloon, an electromagnet", () => {
	const lines = (R, id) => plugins.digestLines(R.scene.items.find((i) => i.id === id), R).join(" | ")
	const g3 = run(demo("g3-what-it-attracts"))
	assert.match(lines(g3, "m0"), /neodymium \(NdFeB\) magnet \(B_r 1\.3 T\)/)
	assert.match(lines(g3, "m0"), /its north pole points right \(0°\)/)
	assert.match(lines(g3, "m0"), /at the end: steel-clip touching/)
	assert.match(lines(g3, "steel-clip"), /magnetic \(iron\/steel\): any magnet's pole pulls it/)
	assert.match(lines(g3, "steel-clip"), /magnetized \d+ % at the end/)
	assert.match(lines(g3, "plastic-clip"), /NOT magnetic/)
	assert.match(lines(g3, "copper"), /NOT magnetic/)
	const g7 = run(demo("g7-compass"))
	assert.match(lines(g7, "above"), /needle's red end ends pointing left \(1(79|80)°; north is right\)/)
	assert.match(lines(g7, "far"), /pointing right \(0°/)
	const g2 = run(demo("g2-carts-repel"))
	assert.match(lines(g2, "a"), /its north pole points right \(0°\)/, "a heading of 359.9° reads 0°, never 360°")
	assert.match(lines(g2, "b"), /points left \(180°\) \(flipped\)/)
	const g11 = run(demo("g11-balloon-paper"))
	assert.match(lines(g11, "balloon"), /charge -100 nC on its bottom side/)
	const em = run(demo("em1-turns"))
	assert.match(lines(em, "em200"), /electromagnet: 200 turns on 2 AA cell\(s\), on, \d\.\d A; its point is a north pole/)
	assert.match(lines(em, "em200"), /at the end: clips200 touching/)
	const rings = run(demo("g6-levitating-rings"))
	assert.match(lines(rings, "rings"), /3 rings, like faces together \(they float\)/)
})

test("on/off knobs: the fix card says which way in the knob's own words (no \"(true → false)\"), in the past tense once done", () => {
	const scene = {
		items: [
			{ id: "em", type: "battery-electromagnet", name: "Electromagnet", x: 0, y: 0, props: { on: true } },
			{ id: "cart", type: "magnet-cart", name: "Cart A", x: 0.3, y: 0, props: { flip: false } },
			{ id: "rings", type: "ring-magnets", name: "Ring magnets", x: 0.6, y: 0, props: { alternate: true } }
		]
	}
	const words = (c) => fixWords([{ kind: "prop", ...c }], scene)
	const off = words({ id: "em", key: "on", from: true, to: false })
	assert.equal(off.say, "switch the electromagnet off")
	assert.equal(off.did, "switched the electromagnet off")
	assert.equal(words({ id: "em", key: "on", from: false, to: true }).say, "switch the electromagnet on")
	const flip = words({ id: "cart", key: "flip", from: false, to: true })
	assert.equal(flip.say, "turn Cart A around, swapping its poles")
	assert.equal(flip.did, "turned Cart A around, swapping its poles")
	assert.equal(words({ id: "rings", key: "alternate", from: true, to: false }).say, "turn every other ring over, so unlike faces meet")
	assert.equal(words({ id: "rings", key: "alternate", from: false, to: true }).did, "turned every other ring over, so like faces meet")
	for (const k of mod.knobs.filter((k) => k.how === "bool")) for (const w of [k.more, k.less]) assert.doesNotMatch(w, /\((swap|turn|make)\b/, `${k.type}.${k.key}: "${w}" (a bracket in the imperative reads wrong once done)`)
})

test("change words in real units", () => {
	assert.equal(plugins.changeWords("bar-magnet", "material", "ceramic", "neodymium"), "ceramic → neodymium magnet (about 11.1× the pull at contact)")
	assert.equal(plugins.changeWords("bar-magnet", "flip", false, true), "north and south poles swapped")
	assert.equal(plugins.changeWords("magnet-cart", "flip", true, false), "poles back the usual way round")
	assert.equal(plugins.changeWords("balloon", "rubbed", 10, 2), "rubbed 10 → 2 times (−100 → −20 nC)")
	assert.equal(plugins.changeWords("ring-magnets", "alternate", true, false), "rings turned so unlike faces meet: they snap together")
	assert.equal(plugins.changeWords("battery-electromagnet", "turns", 50, 200), "50 → 200 turns of wire (3.1× the coil's field with 2 cells)")
	assert.equal(plugins.changeWords("barrier-sheet", "material", "cardboard", "steel"), "cardboard → steel sheet (steel blocks most of the pull)")
	assert.equal(plugins.changeWords("battery-electromagnet", "on", true, false), "switched off: it pulls nothing")
	assert.equal(plugins.changeWords("paper-bits", "size", 0.006, 0.003), "paper scraps 6 → 3 mm (lighter, but pulled less for their weight: they need a stronger or closer charge)")
	assert.equal(plugins.changeWords("paper-bits", "size", 0.006, 0.01), "paper scraps 6 → 10 mm (heavier, but pulled more for their weight: a weaker charge lifts them)")
	assert.equal(plugins.changeWords("compass", "north", "right", "left"), "north set to the left (the Earth's field turns its needle left)")
	assert.equal(plugins.changeWords("ball", "diameter", 0.1, 0.2), null)
	// (the edit card's change line for an on/off prop uses these words: "changed Cart B (poles back the usual way round)", never "turned off “…”")
	const two = { items: [{ id: "a", type: "magnet-cart", name: "Cart A", x: 0.9, y: 0, props: {} }, { id: "b", type: "magnet-cart", name: "Cart B", x: 1.2, y: 0, props: { magnet_end: "back", flip: true } }] }
	const flipped = JSON.parse(JSON.stringify(two))
	flipped.items[1].props.flip = false
	assert.deepEqual(humanChangeList(two, flipped).map((c) => c.text), ["changed Cart B (poles back the usual way round)"])
})

test("make it work: carts flipped to unlike poles are made to push apart again by turning the other cart's magnet (the flip knob)", async () => {
	const s = demo("g2-carts-repel")
	s.items.find((i) => i.id === "b").props.flip = false
	const R = run(s)
	assert.equal(R.summary.goals[0].ok, false, "unlike poles facing: the carts pull together")
	const fr = await findFix({ scene: R.scene, sim: R, goals: R.scene.goals }, { simulate: async (sc) => run(sc), budgetMs: 240000, maxRuns: 60, parallel: 1 })
	assert.equal(fr.status, "found", JSON.stringify({ status: fr.status, runs: fr.runs, tried: fr.tried }).slice(0, 2000))
	assert.match(JSON.stringify(fr.fix ?? fr), /flip|turn|around|poles|magnet_end/i)
})

test("make it work after the person cut the rubbing to 2 strokes: their 2 strokes are kept; the balloon's height knob (y, mm steps) lowers it 4 mm, checked", async () => {
	const B = run(demo("g11-balloon-paper"))
	const s = demo("g11-balloon-paper")
	s.items.find((i) => i.id === "balloon").props.rubbed = 2
	const R = run(s)
	assert.equal(R.summary.goals[0].ok, false)
	const fr = await findFix({ scene: R.scene, sim: R, goals: R.scene.goals, before: { scene: B.scene, sim: B }, touched: new Map([["balloon", new Set(["rubbed"])]]), swapped: new Set() },
		{ simulate: async (sc) => run(sc), budgetMs: 600000, hardMs: 600000, maxRuns: 80, parallel: 1 })
	assert.equal(fr.status, "found", JSON.stringify({ status: fr.status, runs: fr.runs, tried: fr.tried }))
	const ch = fr.fix.changes
	assert.ok(!ch.some((c) => c.kind === "prop" && c.id === "balloon" && c.key === "rubbed"), "the person's 2 strokes are never undone")
	assert.ok(ch.some((c) => c.kind === "move" && c.ids?.includes("balloon") && c.dy < 0 && c.dy > -0.006), JSON.stringify(ch))
	assert.equal(fr.fix.words.say, "lower the balloon 4 mm")
	// (and starting it on the scraps is no fix: a thing that starts touching was not pulled to it)
	const t = demo("g11-balloon-paper")
	const b = t.items.find((i) => i.id === "balloon")
	b.props.rubbed = 2
	b.y = Math.round((b.y - 0.008) * 1e5) / 1e5
	assert.equal(run(t).summary.goals[0].ok, false, "a balloon let down onto the scraps does not count as pulling them")
})

test("make it work: a balloon rubbed too little to lift the paper is fixed through the module's knobs (nearer, more rubbing or lighter scraps)", async () => {
	const s = demo("g11-balloon-paper")
	s.items.find((i) => i.id === "balloon").props.rubbed = 2
	const R = run(s)
	assert.equal(R.summary.goals[0].ok, false, "2 strokes (−20 nC) from 8 mm do not lift the scraps")
	const fr = await findFix({ scene: R.scene, sim: R, goals: R.scene.goals }, { simulate: async (sc) => run(sc), budgetMs: 240000, maxRuns: 80, parallel: 1 })
	assert.equal(fr.status, "found", JSON.stringify({ status: fr.status, runs: fr.runs, tried: fr.tried }).slice(0, 2000))
})

test("not_attracted: a non-magnetic thing beside a magnet, the unrubbed balloon's scraps; Python == JavaScript; the AI's own check", () => {
	const ids = new Set(["m", "k"])
	assert.equal(plugins.goalProblem({ kind: "not_attracted", source: "m", item: "k" }, ids), null)
	assert.match(plugins.goalProblem({ kind: "not_attracted", source: "m" }, ids), /needs item/)
	const R = run(demo("g11b-balloon-control"))
	const g = R.summary.goals.find((x) => x.kind === "not_attracted")
	assert.ok(g?.ok, JSON.stringify(g))
	assert.equal(g.nearer_cm <= 0.3, true)
	// the rubbed balloon's scraps are pulled: their not_attracted is not met
	assert.equal(plugins.checkModuleGoal({ kind: "not_pulled", source: "rubbed", item: "bits1" }, { scene: R.scene, doc: R.doc, track: R.track }).ok, false)
	const py = JSON.parse(execFileSync("python3", ["-c", `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(PG, "machines"))})
import items
d = json.load(sys.stdin)
fr = d["track"]["frames"]
last = dict(fr[-1], placements={**fr[0]["placements"], **fr[-1]["placements"]})
print(json.dumps(items.summarize(d["scene"], d["doc"], dict(d["track"], frames=fr[:-1] + [last]))))
`], { input: JSON.stringify({ scene: R.scene, doc: R.doc, track: R.track }), maxBuffer: 1 << 28 }).toString())
	assert.deepEqual(py.goals, JSON.parse(JSON.stringify(R.summary.goals)))
})

test("a plan's holds goal with its one chain in `items` stays a list (VAI5 M2: every electromagnet plan was refused)", async () => {
	const { validatePlan } = await import(pathToFileURL(join(PG, "ai/schemas.mjs")).href)
	const { digestFromCatalog } = await import(pathToFileURL(join(PG, "ai/catalog-digest.mjs")).href)
	const d = digestFromCatalog(sim.catalog(), { source: "web/sim", fingerprint: "magnetism-test" })
	const ex = mod.examples.find((e) => /electromagnet hold more/.test(e.ask))
	const plan = { title: "Electromagnet", missing: [], tune: [], notes: "", ...JSON.parse(JSON.stringify(ex.plan)) }
	plan.goals = [{ kind: "holds", label: "The strong electromagnet holds 2 clips", magnet: "strong", count: 2, items: ["chainB"] }]
	plan.items.forEach((it) => (it.why = "for the lesson"))
	const r = validatePlan(plan, { catalog: d.index })
	assert.deepEqual(r.errors.filter((e) => /goal/.test(e)), [], JSON.stringify(r.errors))
	assert.deepEqual(r.plan?.goals?.[0]?.items ?? plan.goals[0].items, ["chainB"])
	assert.equal(plugins.goalProblem(r.plan?.goals?.[0] ?? plan.goals[0], new Set(plan.items.map((i) => i.id))), null)
})

test("outcome words: a pole flip or a swap said with \"so\" or \"should\" lets the edit change its goals; a flip said any way is the person's own", async () => {
	const { statesModuleOutcome } = await import(pathToFileURL(join(PG, "web/ai/orchestrator.js")).href)
	for (const t of ["Flip the magnet on the boat so the boat gets pushed away instead", "Turn the magnet at the end of the tank around so the same poles face each other.", "swap the key for an iron nail, and the nail should be pulled too", "Flip the bar magnet so its south pole faces the compass. The needle should turn around."]) assert.ok(statesModuleOutcome(t), t)
	for (const t of ["make the magnet stronger", "move the magnet 2 cm closer", "make the balloon blue"]) assert.ok(!statesModuleOutcome(t), t)
	const re = new RegExp(`\\b(?:${plugins.keyWords("bar-magnet", "flip")})\\b`, "i")
	for (const t of ["Turn the magnet at the end of the tank around so the same poles face each other", "Flip the bar magnet so its south pole faces the compass", "rotate the magnet half a turn"]) assert.match(t, re)
	assert.doesNotMatch("make the magnet stronger", re)
})

test("the edit digest's words: a hung balloon hangs (never stands on the scraps under it), paper scraps are a set of scraps, a ping-pong ball near a charge is a dielectric", async () => {
	const { richDigestFrom } = await import(pathToFileURL(join(PG, "ai/rich-digest.mjs")).href)
	const { sceneDigest } = await import(pathToFileURL(join(PG, "ai/scene-digest.mjs")).href)
	const { digestFromCatalog } = await import(pathToFileURL(join(PG, "ai/catalog-digest.mjs")).href)
	const cat = digestFromCatalog(sim.catalog(), { source: "web/sim", fingerprint: "magnetism-test" })
	const R = run(demo("g11b-balloon-control"))
	const d = await sceneDigest(R.scene, cat.index)
	const text = richDigestFrom(R.scene, d, { sim: { ...R, summary: R.summary }, cat }).text
	const line = (id) => text.split("\n").filter((l, k, all) => k > 0 && all[k - 1].startsWith(`- ${id} `) && l.startsWith("  where:"))[0] ?? ""
	assert.match(line("rubbed"), /hanging on a thread/, line("rubbed"))
	assert.doesNotMatch(line("rubbed"), /standing on/)
	assert.match(text, /- bits1 · “[^”]+” · a set of scraps: paper-bits/)
	assert.match(text, /- 2 sets of scraps: /)
	assert.doesNotMatch(text, /scrapses|a scraps/)
	const P = run(demo("g13b-ping-pong"))
	assert.match(plugins.digestLines(P.scene.items.find((i) => i.id === "ball"), P).join(" | "), /a dielectric, ε_r 6\.2/)
})
