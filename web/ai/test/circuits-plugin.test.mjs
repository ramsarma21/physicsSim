// The circuits module's AI plug-ins (web/sim/modules/circuits.js `plugin`, registered by web/sim/modules/index.js): its goal kinds, knobs, how-to and
// prompt lines, worked examples (each solved by the AI's solver and run in the engine bundle: every goal met), the edit digest's circuit lines (a
// closed loop, an open one, a short) and its change words; and its goal kinds' summaries Python == JavaScript on a real run.
//   node --test web/ai/test/circuits-plugin.test.mjs
import assert from "node:assert/strict"
import { execFileSync } from "../../../tools/child-sync.mjs" // (node's, with the input given to the child as a file: a macOS hang, tools/child-sync.mjs)
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const PG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
// (with the modules its worked examples use: the heat module's desk lamp and the optics module's light for the solar panel, the magnetism module's
// compass, magnets and paper clips for the electromagnetism)
process.env.PLAYGROUND_MODULES = process.env.PLAYGROUND_MODULES ?? "circuits,heat,optics,magnetism"
const sim = await import(pathToFileURL(join(PG, "web/sim/index.js")).href)
const plugins = await import(pathToFileURL(join(PG, "web/sim/plugins.js")).href)
const { solve } = await import(pathToFileURL(join(PG, "web/ai/solver.js")).href)
const bundle = await import(pathToFileURL(join(PG, "web/sim/engine-worker.js")).href)
const mod = plugins.modules().find((m) => m.name === "mod_circuits")

const run = (scene) => {
	const p = sim.prepare(scene)
	const track = JSON.parse(JSON.stringify(bundle.run(p.doc, 120)))
	const fin = sim.finish(p.scene, p.doc, p.resolved, track)
	return { scene: p.scene, doc: p.doc, track, summary: fin.summary }
}
const STAGE = { x0: -0.56, x1: 3.19, y0: -0.16, y1: 2.34 }
const W = (id, a, ae, b, be) => ({ id, type: "wire", name: id, x: 0, y: 0, props: { ...(a ? { a } : {}), a_end: ae, ...(b ? { b } : {}), b_end: be } })
const loop = (wires, goals = [], extra = []) => ({
	version: 2, id: "t", name: "t", seconds: 1.5, release: 0.5, stage: STAGE,
	items: [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }, { id: "bat", type: "battery", name: "Battery", x: 0.8, y: 0.01025, props: {} }, { id: "bulb", type: "bulb", name: "Bulb", x: 1.0, y: 0.006, props: {} }, ...extra, ...wires],
	goals
})

test("the module is registered with its goal kinds, knobs, how-to and prompt lines", () => {
	assert.ok(mod, "mod_circuits is in the registry")
	assert.deepEqual(mod.goals.map((g) => g.kind).sort(), ["buzzes", "conducts", "current", "deflects", "glows_brighter", "induces", "lights", "spins", "stays_dark"])
	for (const g of mod.goals) assert.ok(g.about && g.fields && typeof g.summarize === "function" && typeof g.sample === "function", g.kind)
	for (const t of ["wire", "battery", "bulb", "led", "resistor", "dimmer", "switch", "buzzer", "motor", "tester", "solar-panel", "hand-generator", "coil", "electromagnet", "straight-wire"]) assert.ok(plugins.knobsFor(t).length > 0, `knobs for ${t}`)
	for (const k of plugins.knobsFor("wire")) assert.ok(k.why && k.more && k.less)
	assert.match(mod.howto, /closed LOOP/)
	assert.match(plugins.promptSnippets("plan"), /Circuits and electricity/)
	assert.match(plugins.promptSnippets("edit"), /Never change a tested object's material/)
	assert.match(plugins.goalKindLines(), /lights \{item: a bulb or LED/)
	assert.equal(plugins.goalKind("glows")?.kind, "lights", "an alias")
	assert.equal(plugins.goalKind("needle_swings")?.kind, "deflects", "an alias")
	assert.equal(plugins.goalKind("induced_voltage")?.kind, "induces", "an alias")
	assert.match(mod.howto, /straight-wire/)
	assert.match(mod.howto, /galvanometer/)
	assert.match(plugins.goalKindLines(), /deflects \{compass/)
	assert.match(plugins.goalKindLines(), /induces \{coil/)
	// (a wire and a circuit board have no body: the solver never calls them floating)
	assert.equal(plugins.heldByModule("wire", ["wire", "battery"]), true)
	assert.equal(plugins.heldByModule("circuit-board", ["circuit-board"]), true)
	assert.equal(plugins.heldByModule("battery", ["battery"]), false)
})

test("the new goal kinds are checked by their fields", () => {
	const ids = new Set(["c", "k"])
	assert.equal(plugins.goalProblem({ kind: "deflects", compass: "c" }, ids), null)
	assert.match(plugins.goalProblem({ kind: "deflects" }, ids), /needs compass/)
	assert.equal(plugins.goalProblem({ kind: "induces", coil: "k", at_least_mv: 5 }, ids), null)
	assert.match(plugins.goalProblem({ kind: "induces", coil: "k", at_least_mv: "a lot" }, ids), /must be a number/)
})

test("the solver does not call a wire floating; wires named by item only close the loop", () => {
	const plan = {
		title: "t", seconds: 1, items: [
			{ id: "bat", type: "battery", name: "Battery", place: { on: "table", x: 0.8 } }, { id: "bulb", type: "bulb", name: "Bulb", place: { on: "table", x: 1.0 } },
			{ id: "w1", type: "wire", name: "Red wire", props: { a: "bat", b: "bulb" }, place: { on: "air", x: 0, y_m: 0 } },
			{ id: "w2", type: "wire", name: "Black wire", props: { a: "bat", b: "bulb" }, place: { on: "air", x: 0, y_m: 0 } }
		], goals: [{ kind: "lights", item: "bulb" }]
	}
	const solved = solve(plan)
	for (const o of [{}, { supports: false }]) {
		const warns = [...(solve(plan, o).issues ?? []), ...(solve(plan, o).warnings ?? [])].map((w) => w.text ?? String(w))
		assert.ok(!warns.some((t) => /Red wire|Black wire|Infinity/.test(t)), warns.join("; "))
	}
	const r = run({ ...(solved.scene ?? solved), seconds: 1 })
	assert.equal(r.summary.goals[0]?.ok, true, "two wires from the battery to the bulb, their ends unset, make a loop")
})

test("a plan's circuit goals are checked by their fields", () => {
	const ids = new Set(["bulb", "bat"])
	assert.equal(plugins.goalProblem({ kind: "lights", item: "bulb" }, ids), null)
	assert.match(plugins.goalProblem({ kind: "lights" }, ids), /needs item/)
	assert.match(plugins.goalProblem({ kind: "lights", item: "nobody" }, ids), /no item "nobody"/)
	assert.match(plugins.goalProblem({ kind: "current", item: "bulb", at_least_a: "lots" }, ids), /must be a number/)
	assert.equal(plugins.goalProblem({ kind: "glows_brighter", a: "bulb", b: "bat" }, ids), null)
})

test("every worked example builds through the solver and meets its goals in the engine", () => {
	assert.ok(mod.examples.length >= 9)
	// (the digest lists an example by its ask and how: one without a how never reaches the prompt)
	for (const ex of mod.examples) assert.ok(typeof ex.ask === "string" && typeof ex.how === "string" && ex.how.length > 40, `${ex.ask}: its how`)
	for (const ex of mod.examples) {
		const solved = solve(ex.plan)
		const scene = solved.scene ?? solved
		const r = run({ ...scene, seconds: ex.plan.seconds ?? 3 })
		const goals = r.summary.goals
		assert.ok(goals.length > 0, ex.ask)
		for (const g of goals) assert.equal(g.ok, true, `${ex.ask}: ${g.label}`)
		// (and the AI's own check of each module goal on the run says the same)
		for (const g of scene.goals ?? []) {
			const c = plugins.checkModuleGoal(g, { doc: r.doc, track: r.track, scene: r.scene })
			if (plugins.goalKind(g.kind)) assert.equal(c.ok, true, `checkModuleGoal ${ex.ask}: ${g.kind}`)
		}
	}
})

test("the edit digest tells a closed loop, an open one and a short", () => {
	const closed = run(loop([W("w1", "bat", "+", "bulb", "+"), W("w2", "bulb", "-", "bat", "-")]))
	const bat = closed.scene.items.find((i) => i.id === "bat")
	const lines = mod.digest(bat, closed, {})
	assert.ok(lines.some((l) => /^loop: \+ → .* → −: closed$/.test(l)), lines.join(" | "))
	assert.ok(lines.some((l) => /terminal \+: w1 to bulb \(“Bulb”\) \+/.test(l)), lines.join(" | "))
	const open = run(loop([W("w1", "bat", "+", "bulb", "+"), W("w2", "bulb", "-", null, "-")]))
	const ol = mod.digest(open.scene.items.find((i) => i.id === "bat"), open, {})
	assert.ok(ol.some((l) => /OPEN/.test(l)), ol.join(" | "))
	const wl = mod.digest(open.scene.items.find((i) => i.id === "w2"), open, {})
	assert.ok(wl.some((l) => /end b on nothing \(a free end: the loop is open here\)/.test(l)), wl.join(" | "))
	const short = run(loop([W("w1", "bat", "+", "bat", "-")]))
	const sl = mod.digest(short.scene.items.find((i) => i.id === "bat"), short, {})
	assert.ok(sl.some((l) => /SHORT CIRCUIT/.test(l)), sl.join(" | "))
	// (an item of no circuit type: nothing)
	assert.equal(mod.digest({ id: "x", type: "superball" }, closed, {}), null)
})

test("change words in real units", () => {
	const n = (id) => ({ bat: "Battery", bulb2: "Bulb 2" })[id] ?? id
	assert.equal(plugins.changeWords("battery", "kind", "AA", "9V", n), "AA cells (1.58 V each) → a 9 V battery (9.5 V fresh)")
	assert.equal(plugins.changeWords("battery", "cells", 2, 3, n), "AA/D cells in the holder 2 → 3 (1.58 V each, fresh)")
	assert.equal(plugins.changeWords("wire", "b", "bat", "bulb2", n), "wire end b moved from Battery to Bulb 2")
	assert.equal(plugins.changeWords("tester", "gap", 0.015, 0.012, n), "probes 15 → 12 mm apart")
	assert.equal(plugins.changeWords("led", "color", "red", "blue", n), "LED red → blue")
	assert.equal(plugins.changeWords("superball", "diameter", 0.06, 0.08, n), null)
})

test("every goal kind: Python's summary (machines/mod_circuits.py) == web/sim's on a real run", () => {
	const scene = loop(
		[W("w1", "bat", "+", "sw", "+"), W("w2", "sw", "-", "bulb", "+"), W("w3", "bulb", "-", "bat", "-")],
		[
			{ kind: "lights", item: "bulb" }, { kind: "lights", item: "bulb", before_s: 0.5 }, { kind: "lights", item: "bulb", at_least: 1.5, label: "very bright" },
			{ kind: "stays_dark", item: "bulb" }, { kind: "glows_brighter", a: "bulb", b: "bat" }, { kind: "current", item: "bulb", at_least_a: 0.2, at_most_a: 0.4 },
			{ kind: "current", item: "w1" }, { kind: "spins", item: "bulb" }, { kind: "buzzes", item: "bulb" }, { kind: "conducts", item: "bulb" }, { kind: "lights", item: "nobody" }
		],
		[{ id: "sw", type: "switch", name: "Switch", x: 0.9, y: 0.006, props: { flip_at: 0.4 } }]
	)
	const js = run(scene)
	const py = JSON.parse(
		execFileSync("python3", ["-c", "import sys, json; sys.path.insert(0, 'machines'); import items; r = json.load(sys.stdin); print(json.dumps(items.summarize(r['scene'], r['doc'], r['track'])))"], {
			cwd: PG,
			input: JSON.stringify({ scene: js.scene, doc: js.doc, track: js.track }),
			env: { ...process.env, PLAYGROUND_MODULES: "circuits" },
			maxBuffer: 1 << 28
		}).toString()
	)
	assert.deepEqual(py.goals, js.summary.goals)
	assert.deepEqual(py.happenings, js.summary.happenings)
	assert.equal(js.summary.goals.length, 10, "the goal on a missing item is left out")
	// (lit at 0.42 s, after the switch closes at 0.4 s, so before 0.5 s; about 1.8 x its full light; a battery has no light to compare)
	assert.deepEqual(js.summary.goals.map((g) => g.ok), [true, true, true, false, false, true, true, false, false, false])
})

// ---------------------------------------------------------------- make it work with the module's knobs and aims (web/ai/fixer.js)
const { findFix } = await import(pathToFileURL(join(PG, "web/ai/fixer.js")).href)
const { readFileSync } = await import("node:fs")
const DEMOS = JSON.parse(readFileSync(join(PG, "tools/parity/fixtures/circuits-demos.json"), "utf8"))
const demo = (id) => {
	const { expect, ...s } = DEMOS.find((d) => d.id === id)
	return JSON.parse(JSON.stringify(s))
}
const simulate = async (sc) => run(sc)

test("make it work: a compass that hardly swings by a weak current is fixed (the wire nearer, or more current), found and checked", async () => {
	const s = demo("oersted")
	s.items.find((i) => i.id === "res").props.ohms = 10
	s.goals = [{ kind: "deflects", compass: "compass", at_least_deg: 30 }]
	const R = run(s)
	assert.equal(R.summary.goals[0].ok, false, "10 Ω: about 0.3 A, a few degrees")
	const fr = await findFix({ scene: R.scene, sim: R, goals: R.scene.goals }, { simulate, budgetMs: 180000, maxRuns: 120, parallel: 1 })
	assert.equal(fr.status, "found", JSON.stringify({ status: fr.status, runs: fr.runs, tried: fr.tried }).slice(0, 800))
	assert.match(JSON.stringify(fr.fix ?? fr), /in_front|ohms|cells/)
})

test("make it work: a coil of too few turns for the voltage asked is fixed by its turns (the aim: EMF ∝ turns), found and checked", async () => {
	const s = demo("induction")
	s.items.find((i) => i.id === "coil").props.turns = 20
	s.goals = [{ kind: "induces", coil: "coil", at_least_mv: 400 }]
	const R = run(s)
	assert.equal(R.summary.goals[0].ok, false, "20 turns: about a tenth of 200's 1.3 V")
	const fr = await findFix({ scene: R.scene, sim: R, goals: R.scene.goals }, { simulate, budgetMs: 180000, maxRuns: 80, parallel: 1 })
	assert.equal(fr.status, "found", JSON.stringify({ status: fr.status, runs: fr.runs, tried: fr.tried }).slice(0, 800))
	assert.match(JSON.stringify(fr.fix ?? fr), /turns|material|length|y/)
})
