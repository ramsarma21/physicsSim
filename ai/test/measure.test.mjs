// The measure module's AI integration (web/sim/modules/measure.js `plugin`): its goal kinds judged on a real run by ai/goals.mjs (the AI's own
// check) exactly as the run's summary judges them, plans that use them validated by their fields, the catalog digest and the prompts carrying
// its how-to, examples and snippets, the edit step's digest lines, the change words, and the make-it-work search finding a fix through its knobs.
//   node --test ai/test/measure.test.mjs
import assert from "node:assert/strict"
import { before, test } from "node:test"
import { checkGoals } from "../goals.mjs"
import { runScene, moduleSnippets } from "../steps.mjs"
import { getCatalog } from "../catalog-digest.mjs"
await import("../../web/sim/index.js") // (fills the modules' registry, as a step's process does)

const plugins = () => globalThis[Symbol.for("sandbox.plugins")]
const measure = () => plugins().modules.get("mod_measure")
const haveStart = () => !!plugins().modules.get("mod_mechanics") // (mechanics' start_speed: the cars start at speed at the release)

/** Two 10 m lanes, a red and a blue motor car with their fronts at 0 m, a stopwatch per car stopping at its lane's finish. */
const race = (red = 10 / 3, blue = 2.5, extra = {}) => ({
	version: 2, id: "race", name: "Race", seconds: haveStart() ? 5 : 6.5, release: 0.5, stage: { x0: -2, x1: 13, y0: -0.3, y1: 2.2 },
	items: [
		{ id: "table", type: "table", x: 1.3, y: 0 },
		{ id: "top", type: "lane", x: 0, y: 0.82, props: { margin: 1.6 }, name: "Top lane" },
		{ id: "bottom", type: "lane", x: 0, y: 0.02, props: { margin: 1.6 }, name: "Bottom lane" },
		// (with the mechanics module the cars start at their speed at the release; without it they start 1 m before 0 m and are timed from it)
		{ id: "red", type: "motor-car", x: haveStart() ? -0.1 : -1.1, y: 0.82, held: true, name: "Red car", props: { speed: +(red * 1.016).toFixed(4), push: 6, ...(haveStart() ? { start_speed: +(red * 1.016).toFixed(4) } : {}) } },
		{ id: "blue", type: "motor-car", x: haveStart() ? -0.1 : -1.1, y: 0.02, held: true, name: "Blue car", props: { speed: +(blue * 1.016).toFixed(4), push: 6, ...(haveStart() ? { start_speed: +(blue * 1.016).toFixed(4) } : {}) } },
		{ id: "sw-red", type: "stopwatch", x: 10, y: 1.4, name: "Red stopwatch", props: { watch: "red", finish_line: "top", ...(haveStart() ? {} : { start: "crosses", start_line: "top" }) } },
		{ id: "sw-blue", type: "stopwatch", x: 10, y: 0.6, name: "Blue stopwatch", props: { watch: "blue", finish_line: "bottom", ...(haveStart() ? {} : { start: "crosses", start_line: "bottom" }) } },
		{ id: "tape", type: "measuring-tape", x: 0, y: 0.02, props: { length: 12, watch: "blue" } }
	],
	goals: [],
	...extra
})
let run
let scene
before(async () => {
	scene = race()
	run = await runScene(scene)
})

test("the module is registered with its goal kinds, knobs, how-to, examples and prompts", () => {
	const m = measure()
	assert.ok(m, "mod_measure is in the registry")
	assert.deepEqual(m.goals.map((g) => g.kind), ["reads", "crosses", "faster", "farther", "stops_between"])
	assert.ok(m.knobs.some((k) => k.type === "motor-car" && k.key === "speed" && k.how === "abs" && /time = distance \/ speed/.test(k.why)))
	assert.ok(m.howto.includes("LINKS") && m.howto.includes("stopwatch.watch"))
	assert.ok(m.examples.length >= 8 && m.examples.every((e) => typeof e.ask === "string" && typeof e.how === "string"))
	for (const step of ["plan", "edit", "refine"]) assert.ok(moduleSnippets(step).includes("Measuring"), `${step} prompt has the module's lines`)
	assert.match(moduleSnippets("plan"), /FRONT at the 0 m mark/)
})

test("the catalog digest lists the instruments with their links and readouts and the module's how-to and examples", async () => {
	const c = await getCatalog({ rebuild: true })
	assert.match(c.text, /### stopwatch — Stopwatch/)
	assert.match(c.text, /### lane — Lane/)
	assert.match(c.text, /Measuring: lanes, stopwatches, tapes, scales and gauges/)
	assert.match(c.text, /goal reads \{item: an instrument/)
	assert.match(c.text, /e\.g\. "Red car goes 10 m in 3 s/)
})

test("on the run, the stopwatches read 3.00 s and 4.00 s and every measure goal is judged as the summary judges it", () => {
	const st = run.track.state
	assert.ok(Math.abs(st["sw-red"].seconds.at(-1) - 3) < 0.03, `red ${st["sw-red"].seconds.at(-1)}`)
	assert.ok(Math.abs(st["sw-blue"].seconds.at(-1) - 4) < 0.03, `blue ${st["sw-blue"].seconds.at(-1)}`)
	const goals = [
		{ kind: "reads", label: "red 3 s", item: "sw-red", seconds: 3, tol: 0.05 },
		{ kind: "reads", label: "blue 3 s", item: "sw-blue", seconds: 3, tol: 0.05 },
		{ kind: "crosses", label: "red finishes", item: "red", line: "top", before_s: haveStart() ? 3.6 : 4.2 },
		{ kind: "faster", label: "red beats blue", a: "red", b: "blue", line: "top" },
		{ kind: "faster", label: "blue beats red", a: "blue", b: "red" },
		{ kind: "farther", label: "red farther", a: "red", b: "blue" },
		{ kind: "stops_between", label: "blue ends past 9 m", item: "blue", x0: 9, x1: 14 },
		// (a 12 m tape reads at most 12 m; without the mechanics module the blue car runs on to the lane's bumper, 11.5 m)
		{ kind: "reads", label: "tape about the blue car", item: "tape", meters: haveStart() ? 10.5 : 11.4, tol: 1 }
	]
	const r = checkGoals(goals, { doc: run.doc, track: run.track, summary: run.summary, scene })
	assert.deepEqual(r.map((g) => g.ok), [true, false, true, true, false, true, true, true])
	// the run's own summary (web/sim summarize: the same rule as machines/items.py) agrees goal for goal
	const s2 = race(10 / 3, 2.5, { goals })
	return runScene(s2).then((r2) => assert.deepEqual(r2.summary.goals.map((g) => g.ok), r.map((g) => g.ok)))
})

test("the edit step's digest tells what each stopwatch timed and where each racer crossed its lane's marks", () => {
	const sim = { doc: run.doc, track: run.track, summary: run.summary, resolved: run.resolved }
	const sw = measure().digest(scene.items.find((i) => i.id === "sw-red"), sim)
	assert.match(sw[0], /^times Red car: started (at the release|when it reaches top) at [\d.]+ s, stopped when its front reaches top at [\d.]+ s: shows (2\.99|3\.00|3\.01) s; it moved 10 m/)
	const car = measure().digest(scene.items.find((i) => i.id === "blue"), sim)
	assert.match(car[0], haveStart() ? /^on bottom \(0 m at x = 0\): its front crossed 2\/4\/6\/8\/10 m at 1\.30\/2\.10\/2\.90\/3\.70\/4\.50 s/ : /^on bottom \(0 m at x = 0\): its front crossed 2\/4\/6\/8\/10 m at /)
})

test("change lines in real units", () => {
	const n = (id) => ({ "sw-red": "Red stopwatch", top: "Top lane" })[id] ?? id
	const w = measure().words.change
	assert.equal(w("stopwatch", "stop", "crosses", "at", n), "stops after set seconds (was at its finish line)")
	assert.equal(w("stopwatch", "stop_at", 3, 4, n), "stops after 4 s instead of 3 s")
	assert.equal(w("lane", "length", 10, 20, n), "the lane 10 m → 20 m")
	assert.equal(w("stopwatch", "finish_line", "top", null, n), "stops at its own stop_x instead of Top lane")
	assert.equal(w("plank", "length", 1, 2, n), null)
})

test("plans with measure goals are validated by the goal kinds' fields", async () => {
	const { validatePlan } = await import("../schemas.mjs").catch(() => ({}))
	const ai = await import("../goals.mjs")
	assert.equal(ai.moduleGoalProblem({ kind: "reads", item: "sw" }, (id) => id === "sw"), null)
	assert.match(String(ai.moduleGoalProblem({ kind: "reads" }, () => true)), /"reads" goal needs item/)
	assert.match(String(ai.moduleGoalProblem({ kind: "faster", a: "red", b: "ghost" }, (id) => id === "red")), /b: "ghost" is not an item/)
	assert.match(String(ai.moduleGoalProblem({ kind: "stops_between", item: "x", x0: "near" }, () => true)), /x0 must be a number/)
	void validatePlan
})

test("the make-it-work search turns the red car's speed to put its stopwatch back on 3 s after the car was moved back 50 cm", { skip: !haveStart() && "needs the mechanics module's start_speed (the cars start at speed at the release)" }, async () => {
	const { findFix } = await import("../../web/ai/fixer.js")
	const { prepare, finish } = await import("../../web/sim/index.js")
	const { handle } = await import("../../web/sim/engine-worker.js")
	const simulate = async (sc) => {
		const { scene: s, doc, resolved } = prepare(sc)
		const msg = handle({ id: 1, doc, rate: 120 })
		if (msg.error !== undefined) throw new Error(msg.error)
		const meta = finish(s, doc, resolved, msg.track)
		return { key: "k", ms: msg.ms, track: msg.track, doc: meta.doc, summary: meta.summary, warnings: meta.warnings, resolved }
	}
	const goals = [{ kind: "reads", item: "sw-red", seconds: 3, tol: 0.03, label: "Red stopwatch reads 3 s" }]
	const base = race(10 / 3, 2.5, { goals })
	const was = { scene: base, sim: await simulate(base) }
	const moved = JSON.parse(JSON.stringify(base))
	moved.items.find((i) => i.id === "red").x = -0.6
	const sim = await simulate(moved)
	assert.equal(checkGoals(goals, { ...sim, scene: moved })[0].ok, false, "moved back 50 cm it is late")
	const r = await findFix({ scene: moved, sim, goals, before: was, touched: new Map([["red", new Set(["x"])]]) }, { simulate, budgetMs: 40000, minRuns: 60, hardMs: 90000 })
	assert.equal(r.status, "found", JSON.stringify(r.near ?? r.status))
	const again = await simulate(r.fix.scene)
	assert.equal(checkGoals(goals, { ...again, scene: r.fix.scene })[0].ok, true)
	const red = r.fix.scene.items.find((i) => i.id === "red")
	assert.equal(red.x, -0.6, "the car stays where it was put")
	assert.ok(r.fix.changes.some((c) => c.id === "red" && c.key === "speed"), `fixed by the car's speed: ${JSON.stringify(r.fix.changes)}`)
})

test("the reads goal's aim works the speed out from the reading: a stopwatch at 3.15 s for 3 s puts the car's speed × 3.15 / 3 first in the search, found in a handful of runs, the table left as it is", { skip: !haveStart() && "needs the mechanics module's start_speed" }, async () => {
	const { findFix } = await import("../../web/ai/fixer.js")
	const { prepare, finish } = await import("../../web/sim/index.js")
	const { handle } = await import("../../web/sim/engine-worker.js")
	const simulate = async (sc) => {
		const { scene: s, doc, resolved } = prepare(sc)
		const msg = handle({ id: 1, doc, rate: 120 })
		if (msg.error !== undefined) throw new Error(msg.error)
		const meta = finish(s, doc, resolved, msg.track)
		return { key: "k", ms: msg.ms, track: msg.track, doc: meta.doc, summary: meta.summary, warnings: meta.warnings, resolved }
	}
	const goals = [{ kind: "reads", item: "sw-red", seconds: 3, tol: 0.02, label: "Red: 10 m in 3.00 s" }]
	const base = race(10 / 3, 2.5, { goals })
	const was = { scene: base, sim: await simulate(base) }
	const moved = JSON.parse(JSON.stringify(base))
	moved.items.find((i) => i.id === "red").x = -0.6
	const sim = await simulate(moved)
	const spec = plugins().goals.get("reads")
	const { entry } = (await import("../../web/sim/plugins.js")).checkModuleGoal(goals[0], { ...sim, scene: moved })
	const aims = spec.aim(goals[0], entry, moved)
	assert.ok(aims.length >= 1, "an aim for the missed time")
	const ch = aims[0].changes
	assert.deepEqual(ch.map((c) => c.key), ["speed", "start_speed"], "the top speed and the start speed with it (they were the same)")
	assert.ok(Math.abs(ch[0].to - ch[0].from * (entry.got / 3)) < 0.006, `speed × got / want: ${JSON.stringify(ch)} (got ${entry.got})`)
	// (a stopwatch stopped after set seconds reads its seconds whatever the speed: no aim; nor a goal the run meets)
	assert.deepEqual(spec.aim({ ...goals[0] }, { ...entry, got: 3, want: 3 }, moved), [])
	const r = await findFix({ scene: moved, sim, goals, before: was, touched: new Map([["red", new Set(["x"])]]) }, { simulate, budgetMs: 60000, maxRuns: 8 })
	assert.equal(r.status, "found", JSON.stringify({ status: r.status, runs: r.runs }))
	// (the edited scene once, the aim, its two nudges either side, the check on the app's engine, and the cheaper ones still tried: a dozen at most)
	assert.ok(r.runs <= 12, `found in ${r.runs} runs`)
	assert.ok(r.fix.changes.every((c) => c.id === "red"), JSON.stringify(r.fix.changes))
	assert.doesNotMatch(r.fix.words.say, /table/, "a car on a lane past the table's end does not widen the table")
	const again = await simulate(r.fix.scene)
	assert.equal(checkGoals(goals, { ...again, scene: r.fix.scene })[0].ok, true)
	assert.equal(r.fix.scene.items.find((i) => i.id === "table").props?.width, moved.items.find((i) => i.id === "table").props?.width)
})

test("every measure goal is judged the same from the document alone as with the scene (ai/goals.mjs on a run without its scene: the card, the build tuner, the fixer)", () => {
	const goals = [
		{ kind: "reads", label: "red 3 s", item: "sw-red", seconds: 3, tol: 0.05 },
		{ kind: "crosses", label: "red finishes", item: "red", line: "top", before_s: haveStart() ? 3.6 : 4.2 },
		{ kind: "crosses", label: "blue finishes late", item: "blue", line: "bottom", before_s: 3.6 },
		{ kind: "crosses", label: "blue reaches 5 m", item: "blue", x: 5 },
		{ kind: "faster", label: "red beats blue to the top lane's finish", a: "red", b: "blue", line: "top" },
		{ kind: "faster", label: "blue beats red", a: "blue", b: "red" },
		{ kind: "farther", label: "red farther", a: "red", b: "blue" },
		{ kind: "stops_between", label: "blue ends past 9 m", item: "blue", x0: 9, x1: 14 }
	]
	const withScene = checkGoals(goals, { doc: run.doc, track: run.track, summary: run.summary, scene })
	const docOnly = checkGoals(goals, { doc: run.doc, track: run.track, summary: run.summary })
	assert.deepEqual(docOnly.map((g) => [g.ok, g.t ?? null]), withScene.map((g) => [g.ok, g.t ?? null]))
	assert.deepEqual(withScene.map((g) => g.ok), [true, true, false, true, true, false, true, true])
	// (the lane's and the lines' marks are in the document: measure-mark records)
	assert.ok(run.doc.processes.some((p) => p.kind === "measure-mark" && p.item === "top" && p.finish === 10))
})

/** The browser's engine (web/sim + the bundle), as the app runs a scene. */
const simulateBrowser = async (sc) => {
	const { prepare, finish } = await import("../../web/sim/index.js")
	const { handle } = await import("../../web/sim/engine-worker.js")
	const { scene: s, doc, resolved } = prepare(sc)
	const msg = handle({ id: 1, doc, rate: 120 })
	if (msg.error !== undefined) throw new Error(msg.error)
	const meta = finish(s, doc, resolved, msg.track)
	return { key: "k", ms: msg.ms, track: msg.track, doc: meta.doc, summary: meta.summary, warnings: meta.warnings, resolved }
}

test("a scale shows weight: 1 kg on a kitchen scale and a spring scale on the Moon reads 165 g (1.62 N); a pan balance still balances 1 kg against 1 kg", async () => {
	const moon = {
		version: 2, id: "moon", name: "Moon", seconds: 6, release: 0.5, stage: { x0: 0, x1: 2.6, y0: -0.2, y1: 1.9 }, settings: { gravity: "moon", air: false },
		items: [
			{ id: "table", type: "table", x: 1.3, y: 0 },
			{ id: "ks", type: "kitchen-scale", x: 0.5, y: 0, name: "Kitchen scale" }, { id: "m1", type: "gram-mass", x: 0.5, y: 0.026, props: { grams: "1 kg" } },
			{ id: "nm", type: "spring-scale", x: 2.2, y: 1.55, props: { range: "20 N", hook: "kg" }, name: "Newton meter" }, { id: "kg", type: "steel-weight-1kg", x: 2.2, y: 0.98 },
			{ id: "bal", type: "pan-balance", x: 1.3, y: 0, name: "Balance" }, { id: "a", type: "gram-mass", x: 1.16, y: 0.13, props: { grams: "1 kg" } }, { id: "b", type: "gram-mass", x: 1.44, y: 0.13, props: { grams: "1 kg" } }
		],
		goals: [{ kind: "reads", item: "ks", grams: 165, tol: 1 }, { kind: "reads", item: "nm", newtons: 1.62, tol: 0.03 }, { kind: "reads", item: "nm", grams: 165, tol: 2 }, { kind: "reads", item: "bal", value: 0, key: "tilt", tol: 0.5 }]
	}
	const r = await simulateBrowser(moon)
	assert.deepEqual(r.summary.goals.map((g) => g.ok), [true, true, true, true], JSON.stringify(r.summary.goals.map((g) => [g.label, g.got])))
	const d = measure().digest(moon.items.find((i) => i.id === "ks"), { ...r, scene: moon })
	assert.match(d[0], /it shows weight: gravity here is 1\.62 m\/s²/)
})

test("a link that names nothing is a layout warning; a stopwatch with nothing to watch but a clock's rules runs as a clock", async () => {
	const { layout } = await import("../../web/sim/index.js")
	const sc = {
		version: 2, id: "links", name: "Links", seconds: 3, release: 0.5, stage: { x0: -1, x1: 4, y0: -0.2, y1: 2 },
		items: [{ id: "table", type: "table", x: 1.3, y: 0 }, { id: "car", type: "motor-car", x: 0.4, y: 0 },
			{ id: "sw", type: "stopwatch", x: 1, y: 1, name: "Red stopwatch", props: { watch: "no-such-car" } },
			{ id: "clock", type: "stopwatch", x: 2, y: 1, name: "Clock", props: { stop: "at", stop_at: 2 } }],
		goals: []
	}
	const w = layout(sc).warnings
	assert.ok(w.some((x) => x.items[0] === "sw" && /watch link names "no-such-car", which is no item of this scene/.test(x.text)), JSON.stringify(w))
	assert.ok(!w.some((x) => x.items[0] === "clock"))
	const r = await simulateBrowser(sc)
	assert.equal(r.track.state.clock.seconds.at(-1), 2, "the clock stopped after 2 s")
	assert.ok(r.warnings.some((x) => x.items[0] === "sw"), "the run's warnings say it too")
})

test("a pan balance: things dropped into its pans land there (its beam is a ghost), equal masses settle level, and after a swap the fix search resizes a gram mass so it balances again", async () => {
	const base = {
		version: 2, id: "bal", name: "Balance", seconds: 10, release: 0.5, stage: { x0: 0.6, x1: 2.0, y0: -0.1, y1: 0.7 },
		items: [{ id: "table", type: "table", x: 1.3, y: 0 }, { id: "bal", type: "pan-balance", x: 1.3, y: 0, name: "Pan balance" },
			{ id: "L", type: "gram-mass", x: 1.16, y: 0.3, props: { grams: "100 g" }, name: "Left mass" },
			{ id: "m50", type: "gram-mass", x: 1.44, y: 0.13, props: { grams: "50 g" }, name: "50 g mass" },
			{ id: "m20", type: "gram-mass", x: 1.44, y: 0.155, props: { grams: "20 g" }, name: "20 g mass" },
			{ id: "m30", type: "gram-mass", x: 1.44, y: 0.175, props: { grams: "20 g" }, name: "Another 20 g" },
			{ id: "m10", type: "gram-mass", x: 1.44, y: 0.195, props: { grams: "10 g" }, name: "10 g mass" }],
		goals: [{ kind: "reads", item: "bal", value: 0, key: "tilt", tol: 1, label: "It balances" }]
	}
	const r = await simulateBrowser(base)
	const st = r.track.state.bal
	assert.ok(Math.abs(st.left_g.at(-1) - 100) < 0.01, `the 100 g mass dropped from 30 cm is in the left pan (${st.left_g.at(-1)})`)
	assert.ok(Math.abs(st.right_g.at(-1) - 100) < 0.01, `the right pan holds 50 + 20 + 20 + 10 g (${st.right_g.at(-1)})`)
	assert.ok(Math.abs(st.tilt.at(-1)) < 0.5, `level: ${st.tilt.at(-1)}`)
	// the left mass swapped for a 50 g one: it tips right; the aim resizes masses in the right pan (the 50 g one to 1 g... the fewest changes)
	const swapped = JSON.parse(JSON.stringify(base))
	swapped.items.find((i) => i.id === "L").props.grams = "50 g"
	const sim = await simulateBrowser(swapped)
	assert.equal(checkGoals(base.goals, { ...sim, scene: swapped })[0].ok, false)
	const spec = plugins().goals.get("reads")
	const { entry } = (await import("../../web/sim/plugins.js")).checkModuleGoal(base.goals[0], { ...sim, scene: swapped })
	const aims = spec.aim(base.goals[0], entry, swapped, { ...sim, scene: swapped })
	assert.ok(aims.length >= 2 && aims.some((a) => a.changes.every((c) => c.id !== "L" && c.key === "grams")), JSON.stringify(aims))
	const { findFix } = await import("../../web/ai/fixer.js")
	const f = await findFix({ scene: swapped, sim, goals: base.goals, before: { scene: base, sim: r }, touched: new Map([["L", new Set(["grams"])]]) }, { simulate: simulateBrowser, budgetMs: 40000, maxRuns: 10 })
	assert.equal(f.status, "found", JSON.stringify({ status: f.status, runs: f.runs }))
	assert.ok(f.fix.changes.every((c) => c.id !== "L"), "the swapped mass stays as the person set it")
	const again = await simulateBrowser(f.fix.scene)
	assert.equal(checkGoals(base.goals, { ...again, scene: f.fix.scene })[0].ok, true)
})
