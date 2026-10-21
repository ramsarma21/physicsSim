// The granular module's AI plug-ins (web/sim/modules/granular.js `plugin`, registered by web/sim/modules/index.js): its goal kinds (their
// spellings, field checks, summaries Python == JavaScript on real runs, the AI's own check), knobs, how-to and prompt lines, the sand tray's inside
// for the solver, every worked example solved and met in the engine bundle, the edit digest's lines, its change words, and make-it-work searches
// that find a fix through the module's knobs (a funnel of gravel that clogs, a sand timer that runs too long).
//   node --test web/ai/test/granular-plugin.test.mjs
import assert from "node:assert/strict"
import { execFileSync } from "../../../tools/child-sync.mjs" // (node's, with the input given to the child as a file: a macOS hang, tools/child-sync.mjs)
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const PG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
process.env.PLAYGROUND_MODULES = process.env.PLAYGROUND_MODULES ?? "granular"
const sim = await import(pathToFileURL(join(PG, "web/sim/index.js")).href)
const plugins = await import(pathToFileURL(join(PG, "web/sim/plugins.js")).href)
const { solve } = await import(pathToFileURL(join(PG, "web/ai/solver.js")).href)
const { findFix } = await import(pathToFileURL(join(PG, "web/ai/fixer.js")).href)
const bundle = await import(pathToFileURL(join(PG, "web/sim/engine-worker.js")).href)
const mod = plugins.modules().find((m) => m.name === "mod_granular")

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
const KINDS = ["clogs", "collapses", "crater", "crater_bigger", "delta", "erodes", "erodes_more", "piles", "runs_out_first", "sand_runs_out", "stands", "steeper", "timer"]

test("the module is registered with its goal kinds, knobs, how-to, prompt lines and placement rules", () => {
	assert.ok(mod, "mod_granular is in the registry")
	assert.deepEqual(mod.goals.map((g) => g.kind).sort(), KINDS)
	for (const g of mod.goals) assert.ok(g.about && g.fields && typeof g.summarize === "function" && typeof g.sample === "function" && typeof g.label === "function", g.kind)
	for (const g of mod.goals) for (const a of [g.kind, ...(g.aliases ?? [])]) assert.equal(plugins.goalKind(a)?.module, "mod_granular", `${a} is the granular module's`)
	for (const t of ["sand-pile", "sand-tray", "sand-funnel", "hourglass", "stream-table"]) assert.ok(plugins.knobsFor(t).length > 0, `knobs for ${t}`)
	for (const k of mod.knobs) assert.ok(k.why && k.more && k.less, `${k.type}.${k.key}`)
	assert.match(mod.howto, /angle of repose|Beverloo|time_lapse/)
	assert.match(plugins.promptSnippets("plan"), /Sand and soil/)
	assert.match(plugins.promptSnippets("edit"), /outlet_mm/)
	assert.match(plugins.promptSnippets("refine"), /time_lapse/)
	assert.match(plugins.goalKindLines(), /crater_bigger \{a, b\}/)
	assert.ok(plugins.placeRules().containers.has("sand-tray"))
	assert.deepEqual(plugins.containerInterior("sand-tray", { length: 0.4, wall: 0.08, sand_depth: 0.05 }), { x0: -0.2, x1: 0.2, floor: 0.062, rim: 0.092 })
	assert.equal(plugins.containerInterior("sand-pile", {}), null)
	// the catalog: five types with their readings, in their own category
	const cat = sim.catalog()
	assert.ok(cat.categories.includes("Sand & soil"))
	for (const k of ["sand-pile", "sand-tray", "sand-funnel", "hourglass", "stream-table"]) {
		const t = cat.types.find((x) => x.key === k)
		assert.ok(t && t.module === "granular" && t.readouts?.length, k)
	}
})

test("plans' goals are checked by their fields", () => {
	const ids = new Set(["tray", "hg", "st", "a", "b"])
	assert.equal(plugins.goalProblem({ kind: "crater", item: "tray" }, ids), null)
	assert.equal(plugins.goalProblem({ kind: "timer", item: "hg", seconds: 60 }, ids), null)
	assert.match(plugins.goalProblem({ kind: "timer", item: "hg" }, ids), /needs seconds/)
	assert.match(plugins.goalProblem({ kind: "crater", item: "nobody" }, ids), /no item "nobody"/)
	assert.match(plugins.goalProblem({ kind: "erodes", item: "st", min_g: "lots" }, ids), /must be a number/)
	assert.match(plugins.goalProblem({ kind: "erodes_more", a: "a" }, ids), /needs b/)
	assert.equal(plugins.goalKind("bigger_crater").kind, "crater_bigger")
	assert.equal(plugins.goalKind("timer_runs_out").kind, "sand_runs_out")
	// (the flow module's liquid kinds stay its own)
	assert.equal(plugins.goalKind("empties")?.module, process.env.PLAYGROUND_MODULES?.includes("flow") ? "mod_flow" : undefined)
	assert.equal(plugins.goalKind("erosion").kind, "erodes")
	assert.equal(plugins.goalKind("angle_of_repose").kind, "piles")
})

test("every worked example builds through the solver and meets its goals in the engine", () => {
	for (const ex of mod.examples) {
		assert.ok(ex.ask && ex.how && ex.plan, "an example has its ask, how and plan")
		const r = solve({ title: ex.ask.slice(0, 40), seconds: 4, missing: [], tune: [], notes: "", ...ex.plan })
		assert.ok(r.ok, `${ex.ask}: solved (${JSON.stringify(r.errors)})`)
		const R = run({ ...r.scene, seconds: ex.plan.seconds ?? 4 })
		assert.equal(R.summary.goals.length, ex.plan.goals.length, `${ex.ask}: its goals are in the summary`)
		for (const g of R.summary.goals) assert.ok(g.ok, `${ex.ask}: ${g.label} (${JSON.stringify(g)})`)
	}
})

test("goal summaries: Python == JavaScript on a real run, and the AI's own check by a model's spelling", () => {
	const s = scene(
		[
			{ id: "heap", type: "sand-pile", x: 0.2, y: 0, props: { sand_kg: 0.4 } },
			{ id: "grav", type: "sand-pile", x: 0.55, y: 0, props: { sand_kg: 0.4, grain: "gravel" } },
			{ id: "damp", type: "sand-pile", x: 0.95, y: 0, props: { shape: "castle", wetness: "damp" } },
			{ id: "dry", type: "sand-pile", x: 1.3, y: 0, props: { shape: "castle" } },
			{ id: "tray", type: "sand-tray", x: 1.85, y: 0, props: { length: 0.35, width: 0.3 } },
			{ id: "ball", type: "steel-ball", x: 1.85, y: 0.45, held: true, props: { diameter: 0.025 } },
			{ id: "fun", type: "sand-funnel", x: 2.45, y: 0, props: { sand_kg: 0.04, grain: "gravel", outlet_mm: 12 } },
			{ id: "hg", type: "hourglass", x: 2.85, y: 0, props: { sand_kg: 0.002 } }
		],
		[
			{ kind: "piles", item: "heap", min_deg: 30, max_deg: 38 },
			{ kind: "steeper", a: "grav", b: "heap" },
			{ kind: "stands", item: "damp" },
			{ kind: "collapses", item: "dry" },
			{ kind: "crater", item: "tray", min_mm: 30 },
			{ kind: "clogs", item: "fun" },
			{ kind: "sand_runs_out", item: "hg", before_s: 3 },
			{ kind: "timer", item: "hg", seconds: 1.8, tol_s: 0.3 },
			{ kind: "runs_out_first", a: "hg", b: "fun" },
			{ kind: "stands", item: "dry" }
		],
		3
	)
	const R = run(s)
	assert.deepEqual(R.summary.goals.map((g) => g.ok), [true, true, true, true, true, true, true, true, true, false], JSON.stringify(R.summary.goals))
	const py = JSON.parse(
		execFileSync("python3", ["-c", `
import json, sys, os
sys.path.insert(0, ${JSON.stringify(join(PG, "machines"))})
import items
d = json.load(sys.stdin)
print(json.dumps(items.summarize(d["scene"], d["doc"], d["track"])))
`], { input: JSON.stringify({ scene: R.scene, doc: R.doc, track: R.track }), env: { ...process.env, PLAYGROUND_MODULES: "granular" }, maxBuffer: 1 << 28 }).toString()
	)
	assert.deepEqual(py.goals, JSON.parse(JSON.stringify(R.summary.goals)))
	assert.deepEqual(py.readings, JSON.parse(JSON.stringify(R.summary.readings)))
	assert.deepEqual(py.happenings, JSON.parse(JSON.stringify(R.summary.happenings)))
	const runOf = { scene: R.scene, doc: R.doc, track: R.track }
	assert.equal(plugins.checkModuleGoal({ kind: "bigger_crater", a: "tray", b: "tray" }, runOf).ok, false)
	assert.equal(plugins.checkModuleGoal({ kind: "jams", item: "fun" }, runOf).ok, true)
	assert.equal(plugins.checkModuleGoal({ kind: "collapse", item: "dry" }, runOf).ok, true)
	assert.equal(plugins.checkModuleGoal({ kind: "repose", item: "heap", min_deg: 40 }, runOf).ok, false)
})

test("the edit digest's lines: a heap, a castle, a crater, a clogged funnel, an hourglass", () => {
	const s = scene(
		[
			{ id: "heap", type: "sand-pile", x: 0.2, y: 0, props: { sand_kg: 0.4 } },
			{ id: "dry", type: "sand-pile", x: 0.7, y: 0, props: { shape: "castle" } },
			{ id: "tray", type: "sand-tray", x: 1.3, y: 0, props: { length: 0.35, width: 0.3 } },
			{ id: "ball", type: "steel-ball", x: 1.3, y: 0.45, held: true, props: { diameter: 0.025 } },
			{ id: "fun", type: "sand-funnel", x: 2.0, y: 0, props: { sand_kg: 0.04, grain: "gravel", outlet_mm: 12 } },
			{ id: "hg", type: "hourglass", x: 2.6, y: 0, props: { sand_kg: 0.002 } }
		],
		[],
		3
	)
	const R = run(s)
	const lines = (id) => plugins.digestLines(R.scene.items.find((i) => i.id === id), { ...R, resolved: R.resolved }).join(" ")
	assert.match(lines("heap"), /a heap of 400 g of dry sand .* slope 3\d(\.\d)?°/)
	assert.match(lines("dry"), /castle .* height 120 → \d\d mm/)
	assert.match(lines("tray"), /crater \d+ mm rim to rim, \d+ mm deep/)
	assert.match(lines("fun"), /CLOGGED/)
	assert.match(lines("hg"), /ran out after \d\.\d lesson s/)
})

test("change words in real units", () => {
	assert.equal(plugins.changeWords("stream-table", "tilt_deg", 6, 10), "slope 6 → 10°")
	assert.equal(plugins.changeWords("stream-table", "flow_lpm", 1, 2.5), "water 1 → 2.5 L/min")
	assert.equal(plugins.changeWords("hourglass", "neck_mm", 3, 4), "neck 3 → 4 mm")
	assert.equal(plugins.changeWords("hourglass", "sand_kg", 0.066, 0.08), "sand 66 → 80 g")
	assert.equal(plugins.changeWords("sand-funnel", "outlet_mm", 10, 30), "spout 10 → 30 mm")
	assert.equal(plugins.changeWords("sand-tray", "sand_depth", 0.05, 0.08), "sand 5 → 8 cm deep")
	assert.equal(plugins.changeWords("sand-pile", "wetness", "dry", "damp"), "wetness dry → damp")
	assert.equal(plugins.changeWords("ball", "diameter", 0.1, 0.2), null)
})

const simulate = async (sc) => run(sc)

test("make it work: a funnel of gravel that clogs pours once a module knob is turned (found and checked)", async () => {
	const s = scene([{ id: "fun", type: "sand-funnel", name: "Funnel", x: 1.2, y: 0, props: { sand_kg: 0.05, grain: "gravel", outlet_mm: 12 } }], [{ kind: "sand_runs_out", item: "fun" }], 3)
	const R = run(s)
	assert.equal(R.summary.goals[0].ok, false, "6 mm gravel jams in a 12 mm spout")
	const fr = await findFix({ scene: R.scene, sim: R, goals: R.scene.goals }, { simulate, budgetMs: 120000, maxRuns: 120, parallel: 1 })
	assert.equal(fr.status, "found", JSON.stringify({ status: fr.status, runs: fr.runs, tried: fr.tried }))
	assert.match(JSON.stringify(fr.fix ?? fr), /outlet_mm|grain|sand_kg/)
})

test("make it work: a sand timer meant to run 4 s that runs too long is fixed by its neck or its sand (found and checked)", async () => {
	const s = scene([{ id: "hg", type: "hourglass", name: "Sand timer", x: 1.2, y: 0, props: { sand_kg: 0.008 } }], [{ kind: "timer", item: "hg", seconds: 4, tol_s: 0.4 }], 6)
	const R = run(s)
	assert.equal(R.summary.goals[0].ok, false, "8 g through 3 mm runs about 7 s")
	const fr = await findFix({ scene: R.scene, sim: R, goals: R.scene.goals }, { simulate, budgetMs: 120000, maxRuns: 120, parallel: 1 })
	assert.equal(fr.status, "found", JSON.stringify({ status: fr.status, runs: fr.runs, tried: fr.tried }))
	assert.match(JSON.stringify(fr.fix ?? fr), /neck_mm|sand_kg/)
})

test("request words: an amount said for a setting holds it as the person's own choice, and so does a grain the words name", async () => {
	const { choicesOf, namedIn } = await import(pathToFileURL(join(PG, "web/ai/orchestrator.js")).href)
	assert.match("neck", new RegExp(`^(?:${plugins.keyWords("hourglass", "neck_mm")})$`))
	assert.ok(plugins.keyWords("stream-table", "tilt_deg") && plugins.keyWords("sand-funnel", "grain") && plugins.keyWords("stream-table", "plants"))
	const said = (text, sc, id, keys) => {
		const c = choicesOf(text, new Map([[id, new Set(keys)]]), sc, namedIn(text, sc))
		return { hard: [...(c.hard.get(id) ?? [])], forward: [...(c.forward.get(id) ?? [])] }
	}
	const timer = { items: [{ id: "table", type: "table", x: 1.3, y: 0 }, { id: "timer", type: "hourglass", name: "Sand timer", x: 1.3, y: 0, props: { neck_mm: 4 } }] }
	assert.deepEqual(said("Make the sand timer's neck 4 mm wide.", timer, "timer", ["neck_mm"]).hard, ["neck_mm"])
	const funnel = { items: [{ id: "table", type: "table", x: 1.3, y: 0 }, { id: "funnel", type: "sand-funnel", name: "Funnel", x: 1.3, y: 0, props: { grain: "gravel" } }] }
	// (the grain they name is their exact choice: no fix offers it back (verify-fga G6: "fill the funnel with fine sand instead" was offered gravel))
	assert.deepEqual(said("Fill the funnel with gravel instead of sand.", funnel, "funnel", ["grain"]), { hard: ["grain"], forward: [] })
	const coarse = { items: [{ id: "table", type: "table", x: 1.3, y: 0 }, { id: "timer", type: "hourglass", name: "Sand timer", x: 1.3, y: 0, props: { grain: "coarse sand" } }] }
	assert.deepEqual(said("Fill the sand timer with coarse sand.", coarse, "timer", ["grain"]).hard, ["grain"])
	// (a choice knob's chip names the grain it would use: "fill the funnel with sand instead (gravel → sand)", never "other grains")
	assert.match(plugins.knobOf("sand-funnel", "grain").more, /\{to\}/)
	// (the grain knobs are tried after the physical ones: a wider spout comes before undoing the person's gravel)
	assert.ok(plugins.knobOf("sand-funnel", "grain").cost > 10 * plugins.knobOf("sand-funnel", "outlet_mm").cost)
})

test("comparisons need a clear difference: equal set-ups never pass on a grid cell's difference; both items are the goal's subject", () => {
	const ctxOf = (state) => ({ known: (id) => id in state, name: (id) => id, num: (v) => (typeof v === "number" ? v : null), state: (id, k) => state[id]?.[k] ?? null, first_time: (id, k, f) => { const v = state[id]?.[k]; const i = v ? v.findIndex(f) : -1; return i < 0 ? null : i * 0.1 } })
	const kind = (k) => plugins.goalKind(k)
	const crater = (a, b) => kind("crater_bigger").summarize(ctxOf({ A: { crater_mm: [0, a] }, B: { crater_mm: [0, b] } }), { kind: "crater_bigger", a: "A", b: "B" }).ok
	assert.equal(crater(60.4, 60.0), false)
	assert.equal(crater(66, 60), true)
	const erodes = (a, b) => kind("erodes_more").summarize(ctxOf({ A: { eroded_g: [0, a] }, B: { eroded_g: [0, b] } }), { kind: "erodes_more", a: "A", b: "B" }).ok
	assert.equal(erodes(795, 790), false)
	assert.equal(erodes(900, 790), true)
	const first = (ta, tb) => kind("runs_out_first").summarize(ctxOf({ A: { empty: Array.from({ length: 200 }, (_, i) => (i * 0.1 >= ta ? 1 : 0)) }, B: { empty: Array.from({ length: 200 }, (_, i) => (i * 0.1 >= tb ? 1 : 0)) } }), { kind: "runs_out_first", a: "A", b: "B" }).ok
	assert.equal(first(10, 10), false)
	assert.equal(first(8, 10), true)
	for (const k of ["steeper", "crater_bigger", "runs_out_first", "erodes_more"]) assert.deepEqual(kind(k).subject, ["a", "b"], k)
})

test("the card says what the sand did when no solid moves: the run's happenings, with the names on screen", async () => {
	const { describeRun } = await import(pathToFileURL(join(PG, "web/ai/orchestrator.js")).href)
	const sc = scene([{ id: "funnel", type: "sand-funnel", name: "Funnel", x: 1.3, y: 0, props: { grain: "gravel", sand_kg: 0.1 } }], [], 2)
	const R = run(sc)
	const words = describeRun({ ...R, summary: R.summary }, sc)
	assert.match(words, /^In the run: Funnel clogs: its grains jam in the spout \(\d\.\d\d s\)\.$/, words)
	// (more grains than it holds: filled to its brim, and the run says so)
	const big = run(scene([{ id: "timer", type: "hourglass", name: "Sand timer", x: 1.3, y: 0, props: { bulb_cm: 4, sand_kg: 0.2 } }], [], 1))
	assert.ok(big.summary.happenings.some((h) => /^only 4\d g of the 200 g of grains fits in timer's top bulb/.test(h.text)), JSON.stringify(big.summary.happenings))
})

test("a timer goal's tolerance: tol_s in seconds, an old tol under 1 a share of the time (0.1 = 10 %), 5 % by default", () => {
	const ctxOf = (s, empty = 1) => ({ known: () => true, name: (id) => id, num: (v) => (typeof v === "number" ? v : null), state: (id, k) => ({ run_s: [0, s], empty: [0, empty], clogged: [0, 0] })[k] ?? null, first_time: () => null })
	const T = plugins.goalKind("timer")
	const at = (s, g) => T.summarize(ctxOf(s), { kind: "timer", item: "hg", seconds: 30, ...g })
	assert.equal(at(29.8, { tol: 0.1 }).ok, true, "29.8 s against 30 s ± 10 % (verify-fga G2)")
	assert.equal(at(29.8, { tol: 0.1 }).tol, 3)
	assert.equal(at(59.59, { seconds: 60, tol: 0.1 }).ok, true, "59.6 s against 60 s ± 10 %")
	assert.equal(at(28, { tol_s: 1.5 }).ok, false)
	assert.equal(at(29, { tol_s: 1.5 }).ok, true)
	assert.equal(at(28.6, {}).ok, true, "5 % by default: 1.5 s")
	assert.equal(at(28.4, {}).ok, false)
	assert.equal(at(31, { tol: 2 }).ok, true, "a tol of 1 or more is seconds")
	assert.match(T.about, /tol_s/)
	assert.match(T.detail(at(29.8, { tol: 0.1 })), /^yes \(it ran out after 29\.8 lesson s; the goal 30 ± 3 s\)$/)
})

test("a sand timer whose neck is too narrow for its grains jams: clogged, the run says so, its clock stops, clogs passes and the card says why", () => {
	const s = scene(
		[
			{ id: "hg", type: "hourglass", name: "Sand timer", x: 0.9, y: 0, props: { grain: "coarse sand" } },
			{ id: "ok", type: "hourglass", name: "Wide timer", x: 1.6, y: 0, props: { grain: "coarse sand", neck_mm: 6 } }
		],
		[{ kind: "clogs", item: "hg" }, { kind: "timer", item: "hg", seconds: 60 }, { kind: "clogs", item: "ok" }, { kind: "sand_runs_out", item: "ok" }],
		6,
		{ settings: { time_lapse: 4 } }
	)
	const R = run(s)
	const st = R.track.state.hg
	assert.equal(st.clogged.at(-1), 1)
	assert.equal(st.run_s.at(-1), 0, "its clock stopped: nothing ran")
	assert.equal(st.top_g.at(-1), 66)
	assert.ok(R.summary.happenings.some((h) => /^hg jams: its grains arch over the 3 mm neck/.test(h.text)), JSON.stringify(R.summary.happenings))
	assert.deepEqual(R.summary.goals.map((g) => g.ok), [true, false, false, true], JSON.stringify(R.summary.goals))
	const T = plugins.goalKind("timer")
	assert.match(T.detail(R.summary.goals[1]), /^no \(its grains jam in the neck, so it never runs; the goal 60 ± 3 s\)$/)
	const lines = plugins.digestLines(R.scene.items.find((i) => i.id === "hg"), R).join(" ")
	assert.match(lines, /it JAMS: its coarse sand arches over the 3 mm neck .* over 5 mm/)
	// (the fix search turns the neck past 5 grains: its steps reach that far)
	assert.ok(Math.max(...plugins.knobOf("hourglass", "neck_mm").steps) >= 0.75)
})

test("a funnel's poured heap: the funnel reads it, piles and steeper judge it (never a ready-made cone)", () => {
	const s = scene(
		[
			{ id: "sandF", type: "sand-funnel", name: "Sand funnel", x: 0.9, y: 0, props: { sand_kg: 0.2, outlet_mm: 15 } },
			{ id: "gravelF", type: "sand-funnel", name: "Gravel funnel", x: 1.6, y: 0, props: { sand_kg: 0.2, grain: "gravel", outlet_mm: 40 } }
		],
		[{ kind: "piles", item: "sandF", min_deg: 31, max_deg: 39 }, { kind: "steeper", a: "gravelF", b: "sandF" }, { kind: "steeper", a: "sandF", b: "gravelF" }],
		6
	)
	const R = run(s)
	for (const id of ["sandF", "gravelF"]) {
		assert.ok(R.track.state[id].heap_g.at(-1) > 190, `${id}: its heap holds what it poured`)
		assert.ok(R.track.state[id].heap_mm.at(-1) > 20, `${id}: a heap tall enough to see`)
	}
	assert.deepEqual(R.summary.goals.map((g) => g.ok), [true, true, false], JSON.stringify(R.summary.goals))
	assert.match(plugins.goalKind("piles").about, /sand-funnel/)
	assert.match(plugins.modules().find((m) => m.name === "mod_granular").howto, /never put a sand-pile under a funnel/)
	assert.equal(sim.catalog().types.find((t) => t.key === "sand-funnel").anchor.startsWith("under its spout"), true)
	assert.match(plugins.digestLines(R.scene.items.find((i) => i.id === "gravelF"), R).join(" "), /its poured heap: \d+ mm tall, sides at 3\d\.\d°/)
})

test("piles {in}: the heap must end inside that container (90 % of what it poured, the container's grains_g); a stream beside a jar is read against it, outside and said (V2 release round 2)", () => {
	const s = scene(
		[
			{ id: "jar", type: "glass-jar", name: "Glass jar", x: 0.8, y: 0 },
			{ id: "over", type: "sand-funnel", name: "Funnel over the jar", x: 0.8, y: 0, props: { grain: "sugar", sand_kg: 0.1, height: 0.25, outlet_mm: 12 } },
			{ id: "jar2", type: "glass-jar", name: "Second jar", x: 1.9, y: 0 },
			{ id: "beside", type: "sand-funnel", name: "Funnel beside it", x: 2.0, y: 0, props: { grain: "sugar", sand_kg: 0.1, height: 0.25, outlet_mm: 12 } }
		],
		[
			{ kind: "piles", item: "over", in: "jar" },
			{ kind: "piles", item: "beside", in: "jar2", label: "The sugar piles up inside the second jar" },
			{ kind: "piles", item: "beside" },
			{ kind: "piles", item: "over", in: "jar2" }
		],
		8
	)
	const R = run(s)
	const end = (id, k) => R.track.state[id]?.[k]?.at(-1)
	assert.ok(Math.abs(end("over", "heap_g") - 100) < 0.5 && end("over", "outside_g") < 0.5, "over the jar: every grain in it")
	assert.ok(Math.abs(end("jar", "grains_g") - end("over", "heap_g")) < 1e-9, "the jar's grains_g is the heap in it")
	// (10 cm beside the second jar: its stream comes down on the table, read against that jar: nothing in it, all of it outside, and said)
	assert.ok(end("beside", "heap_g") < 0.5 && Math.abs(end("beside", "outside_g") - 100) < 0.5, `beside: ${end("beside", "heap_g")} in, ${end("beside", "outside_g")} out`)
	assert.ok(end("jar2", "grains_g") < 0.5)
	assert.ok(R.summary.happenings.some((h) => h.text === "beside spills sugar outside jar2" && h.kind === "spilled"), JSON.stringify(R.summary.happenings))
	assert.deepEqual(R.summary.goals.map((g) => g.ok), [true, false, false, false], JSON.stringify(R.summary.goals))
	const g = R.summary.goals[1]
	assert.deepEqual([g.in, g.in_g, g.of_g], ["jar2", 0, 100])
	const detail = plugins.modules().find((m) => m.name === "mod_granular").goals.find((k) => k.kind === "piles").detail
	assert.equal(detail(g), "no (0 of 100 g inside it; no heap inside it)")
	assert.match(detail(R.summary.goals[0]), /^yes \(100 of 100 g inside it; \d+ mm tall, its sides at 3\d\.\d°\)$/)
	assert.equal(R.summary.goals[3].label, "Funnel over the jar stands as a heap inside Second jar")
	assert.match(plugins.digestLines(R.scene.items.find((i) => i.id === "beside"), R).join(" "), /none of its grains is in the container beside it: all 100 g landed OUTSIDE it/)
	assert.match(plugins.digestLines(R.scene.items.find((i) => i.id === "jar2"), R).join(" "), /^0 g of grains inside it at the end/)
	assert.match(plugins.digestLines(R.scene.items.find((i) => i.id === "jar"), R).join(" "), /^100 g of grains inside it at the end/)
	// the same summaries in Python
	const py = JSON.parse(
		execFileSync("python3", ["-c", `
import json, sys, os
sys.path.insert(0, ${JSON.stringify(join(PG, "machines"))})
import items
d = json.load(sys.stdin)
print(json.dumps(items.summarize(d["scene"], d["doc"], d["track"])))
`], { input: JSON.stringify({ scene: R.scene, doc: R.doc, track: R.track }), env: { ...process.env, PLAYGROUND_MODULES: "granular" }, maxBuffer: 1 << 28 }).toString()
	)
	assert.deepEqual(py.goals, JSON.parse(JSON.stringify(R.summary.goals)))
	assert.deepEqual(py.readings, JSON.parse(JSON.stringify(R.summary.readings)))
	// (in names an item the scene has: one it lacks is no goal of the run; a plan's field check says so)
	assert.match(plugins.goalProblem({ kind: "piles", item: "over", in: "nojar" }, new Set(["over"])), /no item "nojar"/)
})

test("a heap wider than the shelf it stands on: exactly its grains, some spilled off the edge and said; never sand from nothing", () => {
	const s = scene(
		[
			{ id: "shelf", type: "plank", x: 1.0, y: 0.4, props: { length: 0.6, legs: false } },
			{ id: "heap", type: "sand-pile", name: "Sand heap", x: 1.0, y: 0.422, props: { sand_kg: 0.5 } },
			{ id: "ramp", type: "plank", x: 2.1, y: 0.1, angle: 20, props: { length: 0.8, legs: false } }
		],
		[{ kind: "piles", item: "heap" }],
		2
	)
	const R = run(s)
	const st = R.track.state.heap
	const total = st.mass_g[0] + st.spilled_g[0]
	assert.ok(Math.abs(total - 500) < 2, `mass ${st.mass_g[0]} + spilled ${st.spilled_g[0]} is its 500 g`)
	assert.ok(st.spilled_g[0] > 50 && st.mass_g[0] < 450, "a 500 g heap does not fit a 12 cm plank")
	assert.ok(st.angle_deg.at(-1) < 40 && st.height_mm.at(-1) < 60, `a heap at repose on the shelf (${st.angle_deg.at(-1)}°, ${st.height_mm.at(-1)} mm), not a block of sand under it`)
	assert.ok(R.summary.happenings.some((h) => /^heap does not fit on shelf: \d+ g of its grains spill off the edge/.test(h.text)), JSON.stringify(R.summary.happenings))
	assert.match(plugins.digestLines(R.scene.items.find((i) => i.id === "heap"), R).join(" "), /does NOT fit/)
	// (a heap that fits keeps every gram on what it stands on)
	const T = run(scene([{ id: "heap", type: "sand-pile", x: 1.2, y: 0, props: { sand_kg: 1 } }], [], 1))
	assert.equal(T.track.state.heap.mass_g[0], 1000)
	assert.equal(T.track.state.heap.spilled_g[0], 0)
})

test("routing: the module's generic goal-kind words (runs, out, first, steeper, collapses, stands) never pick it alone; its nouns do", () => {
	// (with every module loaded, as the app has them: a child process, since this file loads only this module)
	const code = `
const { pathToFileURL } = await import("node:url")
const sim = await import(pathToFileURL(${JSON.stringify(join(PG, "web/sim/index.js"))}).href)
const dg = await import(pathToFileURL(${JSON.stringify(join(PG, "ai/catalog-digest.mjs"))}).href)
const d = dg.digestFromCatalog(sim.catalog())
const asks = JSON.parse(process.argv[1])
console.log(JSON.stringify({ tiered: !!d.tiers, stop: [...dg.wordsOf("runs rolls starts gets")], picks: asks.map((t) => dg.promptCatalog(d, { text: t }).modules) }))`
	const no = ["A tap runs into a coffee mug until it overflows", "Water runs down a slide into a bucket", "Which runs out first, the big tank or the small one?", "A steeper ramp makes the car go faster", "The block tower collapses when the ball hits it", "A red car and a blue car race 10 m: which runs faster?"]
	const yes = ["Make a sand timer that runs out in about 30 seconds", "Pour dry sand from one funnel and gravel from another: which makes the steeper pile?", "Drop a steel ball into a tray of flour", "Which hourglass empties first?", "Build a sandcastle from damp sand"]
	const out = JSON.parse(execFileSync("node", ["--no-warnings", "--input-type=module", "-e", code, JSON.stringify([...no, ...yes])], { env: { ...process.env, PLAYGROUND_MODULES: "" }, maxBuffer: 1 << 26 }).toString().trim().split("\n").at(-1))
	assert.deepEqual(out.stop, [], "STOP applies after stemming: runs, rolls, starts, gets")
	if (!out.tiered) return // (a catalog small enough to go whole into every prompt: nothing is picked)
	no.forEach((t, i) => assert.ok(!out.picks[i].includes("mod_granular"), `${t}: ${out.picks[i]}`))
	yes.forEach((t, i) => assert.ok(out.picks[no.length + i].includes("mod_granular"), `${t}: ${out.picks[no.length + i]}`))
})

test("make it work: coarse sand the person chose jams a 30 s timer: the fix widens the neck past 5 grains with the sand that keeps 30 s, never the grain back", async () => {
	const s = scene([{ id: "timer", type: "hourglass", name: "Sand timer", x: 1.3, y: 0, props: { sand_kg: 0.033, grain: "coarse sand" } }], [{ kind: "timer", item: "timer", seconds: 30 }], 12, { settings: { time_lapse: 4 } })
	const R = run(s)
	assert.equal(R.summary.goals[0].ok, false, "coarse sand jams the 3 mm neck")
	const hard = new Map([["timer", new Set(["grain"])]])
	const fr = await findFix({ scene: R.scene, sim: R, goals: R.scene.goals, relaxed: true, hard, touched: hard }, { simulate, budgetMs: 240000, maxRuns: 200, parallel: 1 })
	assert.equal(fr.status, "found", JSON.stringify({ status: fr.status, runs: fr.runs, tried: fr.tried }))
	const words = JSON.stringify(fr.fix?.words ?? fr.fix)
	assert.match(words, /widen the sand timer's neck \(3 mm → [5-9]/, words)
	assert.match(words, /more sand/, words)
	assert.doesNotMatch(words, /fine sand|grain/, words)
})
