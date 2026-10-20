// The fracture module (machines/mod_fracture.py, web/sim/modules/fracture.js, tooling/src/sim/modules/fracture.ts) through the AI layer: the
// catalog digest, a plan's goals, the solver's placing, the goal checks on a real run, the edit step's digest, the change and fix words, and the
// make-it-work search turning the module's knobs (node --test web/ai/test/fracture.test.mjs; the engine is the browser bundle).
import test from "node:test"
import assert from "node:assert/strict"
import { prepare, finish, catalog, plugins } from "../../sim/index.js"
import { handle } from "../../sim/engine-worker.js"
import { digestFromCatalog } from "../../../ai/catalog-digest.mjs"
import { validatePlan } from "../../../ai/schemas.mjs"
import * as aiGoals from "../../../ai/goals.mjs"
import * as webGoals from "../goals.js"
import { richDigestFrom } from "../../../ai/rich-digest.mjs"
import { sceneDigest } from "../../../ai/scene-digest.mjs"
import { solve } from "../solver.js"
import { fixWords, judge } from "../fixer.js"
import { createOrchestrator, describeDiff, humanChanges } from "../orchestrator.js"

const simulate = async (scene, signal) => {
	if (signal?.aborted) throw Object.assign(new Error("Cancelled"), { name: "AbortError" })
	const { scene: s, doc, resolved } = prepare(scene)
	const msg = handle({ id: 1, doc, rate: 120 })
	if (msg.error !== undefined) throw new Error(msg.error)
	const meta = finish(s, doc, resolved, msg.track)
	return { key: "k", ms: msg.ms, track: msg.track, doc: meta.doc, summary: meta.summary, warnings: meta.warnings, resolved }
}
const B = (0.044 / 2) * (2 / Math.sqrt(2 + Math.SQRT2)) // a raw egg's half height lying down (its outline round the curve)
const dg = digestFromCatalog(catalog())

test("the digest knows the module: its types, how they work together, its goal kinds and knobs", () => {
	for (const t of ["raw-egg", "drinking-glass", "ceramic-plate", "cushion", "egg-drop-box", "snap-bridge", "block-tower", "window-pane"]) assert.match(dg.text, new RegExp(`### ${t} — `), t)
	assert.match(dg.text, /### Breaking things and padding/)
	assert.match(dg.text, /For any egg that should crack or break use raw-egg/)
	assert.match(dg.text, /egg \{fragile: true\} is a simpler egg/)
	assert.match(dg.text, /never a plank hanging in the air/)
	assert.match(dg.text, /strands 1 is one chocolate bar/)
	assert.match(dg.text, /a wide load spreads its bending/)
	assert.match(dg.text, /WATER: a breakable dropped into a water-tank's water/)
	assert.match(dg.text, /goal knocked_down \{item, at_least_blocks\?\}/)
	// (the module's worked examples are listed: an egg-pad comparison, strands, the egg-drop challenge, glass, towers, a window, water)
	assert.ok((dg.text.match(/- e\.g\. "/g) ?? []).length >= 7 && /e\.g\. "How many strands of spaghetti hold 300 g/.test(dg.text), "the examples")
	assert.match(dg.text, /goal breaks \{item, before_s\?\}/)
	assert.match(dg.text, /goal survives \{item\}/)
	assert.match(dg.text, /goal breaks_first \{item, other\}/)
	assert.match(dg.text, /knob egg-drop-box\.parachute/)
	assert.match(dg.text, /Readings \(the run reports them; goals and edits can use them\): broken \(Broken[^)]*\), peak_force \(Biggest force, N\)/)
})

test("plans: the module's goals by their own names and a model's other spellings, with their fields checked", () => {
	const plan = {
		title: "Egg drop", seconds: 1.5, missing: [], tune: [], notes: "",
		items: [
			{ id: "pad", type: "cushion", name: "Pillow", props: { material: "pillow stuffing", thickness: 0.12 }, place: { on: "table", x: 1.2 } },
			{ id: "egg1", type: "raw-egg", name: "Bare egg", place: { on: "air", x: 0.8, y_m: 0.3 }, held: true },
			{ id: "egg2", type: "raw-egg", name: "Padded egg", place: { on: "air", x: 1.2, y_m: 0.42 }, held: true }
		],
		goals: [{ kind: "cracks", label: "the bare egg cracks", item: "egg1" }, { kind: "stays_whole", label: "the padded egg survives", item: "egg2" }, { kind: "breaks_before", item: "egg1", other: "egg2" }]
	}
	const v = validatePlan(plan, { catalog: dg.index })
	assert.ok(v.ok, v.errors.join("; "))
	assert.deepEqual(v.value.goals.map((g) => g.kind), ["breaks", "survives", "breaks_first"])
	const bad = validatePlan({ ...plan, goals: [{ kind: "breaks_first", label: "x", item: "egg1" }] }, { catalog: dg.index })
	assert.ok(!bad.ok && bad.errors.some((e) => /needs other/.test(e)), bad.errors.join("; "))
})

test("solver: loads sit on a snap-bridge's beam, a dropped egg starts in the air, a cushion lies on the table", () => {
	const plan = {
		title: "Bridge", seconds: 1.5, missing: [], tune: [], notes: "",
		items: [
			{ id: "br", type: "snap-bridge", name: "Spaghetti bridge", props: { strands: 5, span: 0.2 }, place: { on: "table", x: 1 } },
			{ id: "m", type: "gram-mass", name: "200 g mass", props: { grams: "200 g" }, place: { on: "br", x: 1 } },
			{ id: "pad", type: "cushion", name: "Foam pad", place: { on: "table", x: 1.6 } },
			{ id: "egg", type: "raw-egg", name: "Egg", place: { on: "air", x: 1.6, y_m: 0.5 }, held: true }
		],
		goals: [{ kind: "breaks", item: "br", label: "the bridge snaps" }]
	}
	const v = validatePlan(plan, { catalog: dg.index })
	assert.ok(v.ok, v.errors.join("; "))
	const { scene } = solve(v.value)
	const at = (id) => scene.items.find((i) => i.id === id)
	const p = prepare(scene)
	const beam = p.doc.solids.find((s) => s.id === "br/beam")
	const mass = p.doc.solids.find((s) => s.id === "m/mass")
	const top = beam.at.y + beam.body.height / 2
	const under = mass.at.y - mass.body.height / 2
	assert.ok(Math.abs(under - top) < 0.003, `the mass rests on the beam (${under} vs ${top})`)
	assert.ok(at("egg").y > 0.3, "the egg starts in the air")
	assert.ok(Math.abs(at("pad").y) < 0.003, `the pad lies on the table (${at("pad").y})`)
})

test("a run: the goals checked alike by the summary, ai/goals.mjs and web/ai/goals.js", async () => {
	const scene = {
		version: 2, name: "eggs", seconds: 1.2, release: 0.1, stage: { x0: 0, x1: 2, y0: -0.05, y1: 1 },
		items: [
			{ id: "table", type: "table", x: 1, y: 0, props: { width: 3 } },
			{ id: "pad", type: "cushion", x: 1.3, y: 0, props: { material: "pillow stuffing", thickness: 0.12 } },
			{ id: "bare", type: "raw-egg", name: "Bare egg", x: 0.7, y: 0.3 + B, held: true },
			{ id: "soft", type: "raw-egg", name: "Padded egg", x: 1.3, y: 0.12 + 0.3 + B, held: true }
		],
		goals: [{ kind: "breaks", item: "bare" }, { kind: "survives", item: "soft" }, { kind: "breaks_first", item: "bare", other: "soft" }, { kind: "breaks", item: "soft", before_s: 1 }]
	}
	const sim = await simulate(scene)
	const g = sim.summary.goals
	assert.deepEqual(g.map((x) => [x.kind, x.ok]), [["breaks", true], ["survives", true], ["breaks_first", true], ["breaks", false]])
	assert.ok(sim.summary.happenings.some((h) => /Bare egg smashes at 0\.\d\d s, hitting a varnished hardwood table top at 2\.\d\d m\/s/.test(h.text)), JSON.stringify(sim.summary.happenings))
	const run = { doc: sim.doc, track: sim.track, summary: sim.summary }
	const a = aiGoals.checkGoals(scene.goals, run)
	const b = webGoals.checkGoals(scene.goals, run)
	assert.deepEqual(a.map((x) => x.ok), [true, true, true, false])
	assert.equal(JSON.stringify(a), JSON.stringify(b))
	// from the summary alone
	assert.deepEqual(aiGoals.checkGoals(scene.goals, { summary: sim.summary }).map((x) => x.ok), [true, true, true, false])
	assert.equal(aiGoals.goalLabel({ kind: "survives", item: "soft" }, { soft: "the padded egg" }), "the padded egg survives")
	// the edit step's digest: readings and the module's own lines
	const rd = richDigestFrom(scene, await sceneDigest(scene, dg.index), { sim: { ...sim }, cat: dg })
	assert.match(rd.text, /breaks at 35 N \(cracks from about a 5 cm drop onto a hard floor/)
	assert.match(rd.text, /last run: BROKE \(in pieces\), biggest force \d+\.\d N \(\d+ % of what breaks it\)/)
	assert.match(rd.text, /last run: did not break/)
	assert.match(rd.text, /squashed up to \d/)
})

test("the edit digest: a bridge's capacity with its load's width and from the last run; a tower says what fell", async () => {
	const scene = {
		version: 2, name: "bridge and tower", seconds: 1.0, release: 0.1, stage: { x0: 0, x1: 3, y0: -0.05, y1: 1 },
		items: [
			{ id: "table", type: "table", x: 1.5, y: 0, props: { width: 3.5 } },
			{ id: "br", type: "snap-bridge", name: "Spaghetti bridge", x: 0.6, y: 0, props: { strands: 10, span: 0.25 } },
			{ id: "w", type: "steel-weight-1kg", name: "300 g weight", x: 0.6, y: 0.121235, props: { mass: 0.3 } },
			{ id: "tw", type: "block-tower", name: "Tower", x: 2.0, y: 0 },
			{ id: "tb", type: "tennis-ball", name: "Ball", x: 2.0 - 0.088, y: 0.077 + 0.25, held: true, props: { start_speed: 1, start_dir: 0 } }
		],
		goals: [{ kind: "survives", item: "br" }, { kind: "knocked_down", item: "tw" }]
	}
	const sim = await simulate(scene)
	const rd = richDigestFrom(scene, await sceneDigest(scene, dg.index), { sim: { ...sim }, cat: dg })
	assert.match(rd.text, /10 strands of spaghetti side by side across a 25 cm gap \(strands counts pieces of what it is made of\): holds about 286 g pressed at one point in its middle, about 329 g of a 3\.5 cm steel weight/)
	const m = /with the last run's load where it is \((\d+) g on it, (\d+) % of its strength\), it snaps at about (\d+) g/.exec(rd.text)
	assert.ok(m, rd.text)
	assert.ok(Number(m[3]) >= 310 && Number(m[3]) <= 335, `the engine snaps it at 320-330 g: ${m[0]}`)
	assert.match(rd.text, /last run: (stood: no block fell|came apart: \d of 6 blocks fell); its top \d+(\.\d+)? cm up at the end \(built \d+(\.\d+)? cm\)/)
	assert.doesNotMatch(rd.text, /BROKE \(cracked\) \(0 %/)
	const kd = sim.summary.goals.find((g) => g.kind === "knocked_down")
	assert.equal(kd.ok, false, "a ball tossed at the top block does not knock the tower down")
	assert.equal(JSON.stringify(aiGoals.checkGoals(scene.goals, { doc: sim.doc, track: sim.track, summary: sim.summary })), JSON.stringify(webGoals.checkGoals(scene.goals, { doc: sim.doc, track: sim.track, summary: sim.summary })))
})

test("change lines and fix words in the module's own terms", () => {
	const scene = {
		version: 2, items: [
			{ id: "box", type: "egg-drop-box", name: "Egg box", x: 1, y: 1, props: { padding: "cotton balls", parachute: 0.4 } },
			{ id: "br", type: "snap-bridge", name: "Spaghetti bridge", x: 0.5, y: 0, props: { strands: 5 } },
			{ id: "pad", type: "cushion", name: "Foam pad", x: 0.2, y: 0, props: { thickness: 0.05 } }
		]
	}
	const after = structuredClone(scene)
	after.items[0].props.parachute = 0.6
	after.items[0].props.padding = "foam"
	after.items[1].props.strands = 8
	const d = describeDiff(scene, after)
	assert.ok(d.some((l) => /parachute 40 cm → 60 cm/.test(l)), JSON.stringify(d))
	assert.ok(d.some((l) => /padding cotton balls → foam/.test(l)), JSON.stringify(d))
	assert.ok(d.some((l) => /5 → 8 strands/.test(l)), JSON.stringify(d))
	const w = fixWords([{ kind: "prop", id: "pad", key: "thickness", from: 0.05, to: 0.07 }], scene)
	assert.match(w.say, /^make the foam pad thicker \(5 cm → 7 cm\)$/i)
	assert.match(w.did, /^made the foam pad thicker/i)
	const w2 = fixWords([{ kind: "prop", id: "br", key: "strands", from: 5, to: 7 }], scene)
	assert.match(w2.say, /^add strands to the spaghetti bridge \(5 → 7\)$/i)
	const w3 = fixWords([{ kind: "prop", id: "box", key: "parachute", from: 0.4, to: 0.6 }], scene)
	assert.match(w3.say, /^give the egg box a bigger parachute \(40 cm → 60 cm\)$/i)
	assert.equal(plugins.knobOf("snap-bridge", "span")?.how, "rel")
	// (the parachute from none: said whole, never "(0 mm → 20 cm)")
	const w4 = fixWords([{ kind: "prop", id: "box", key: "parachute", from: 0, to: 0.2 }], scene)
	assert.equal(w4.say, "give the egg box a 20 cm parachute")
	assert.equal(w4.did, "gave the egg box a 20 cm parachute")
})

test("the cards word fracture changes honestly: no 'faster' for a strength, no 'thicker wall' for padding, no '0 g → 0 g'", () => {
	const base = { version: 2, items: [
		{ id: "glass", type: "drinking-glass", name: "Glass that falls on the floor", x: 0.5, y: 0.6, props: {} },
		{ id: "pad", type: "cushion", name: "Thick foam", x: 1, y: 0, props: { thickness: 0.05 } },
		{ id: "box", type: "egg-drop-box", name: "Egg box", x: 1.5, y: 1, props: {} },
		{ id: "br", type: "snap-bridge", name: "Craft stick bridge", x: 2, y: 0, props: { made_of: "craft sticks", strands: 2, span: 0.25 } },
		{ id: "br2", type: "snap-bridge", name: "Spaghetti bridge", x: 2.6, y: 0, props: { strands: 10, span: 0.25 } },
		{ id: "egg", type: "raw-egg", name: "Egg", x: 3, y: 0.2, props: {} },
		{ id: "plate", type: "ceramic-plate", name: "Plate", x: 3.4, y: 0.2, props: {} },
		{ id: "pane", type: "window-pane", name: "Window", x: 3.8, y: 0, props: {} }
	] }
	const card = (id, key, v) => {
		const after = structuredClone(base)
		after.items.find((i) => i.id === id).props[key] = v
		return humanChanges(base, after).join(" | ")
	}
	const cases = [
		["glass", "strength", 7360, /breaks at 1840 → 7360 N/], ["egg", "strength", 38, /breaks at 35 → 38 N/], ["plate", "strength", 3000, /breaks at 2470 → 3000 N/],
		["box", "strength", 45, /breaks at 35 → 45 N/], ["pad", "thickness", 0.08, /padding 5 cm → 8 cm thick/], ["box", "padding_thickness", 0.05, /padding round the egg 3 cm → 5 cm/],
		["br", "span", 0.5, /made the craft stick bridge longer \(gap 25 cm → 50 cm/], ["br2", "made_of", "chocolate bar", /made of spaghetti → chocolate bar; 10 g → 1 kg/],
		["pane", "thickness", 0.004, /glass 3 mm → 4 mm thick; 2\.7 kg → 3\.6 kg/]
	]
	for (const [id, key, v, want] of cases) {
		const said = card(id, key, v)
		assert.match(said, want, `${id}.${key}: ${said}`)
		assert.doesNotMatch(said, /faster|slower|thicker wall|thinner wall|further apart|closer together|heavier|lighter|\b0 g → 0 g/, `${id}.${key}: ${said}`)
	}
})

test("knobs: a raw egg's strength is turned within a real egg's 30-40 N, in whole newtons", () => {
	const kb = plugins.knobOf("raw-egg", "strength")
	assert.equal(kb.how, "abs")
	assert.equal(kb.min, 30)
	assert.equal(kb.max, 40)
	assert.ok(kb.steps.every((d) => 35 + d <= 40 && 35 - d >= 30))
})

test("make it work: an edit that raises an egg over its pillow breaks it; the search finds a checked fix with the module's knobs", { timeout: 300000 }, async () => {
	const scene = {
		version: 2, name: "padded egg", seconds: 1.2, release: 0.1, stage: { x0: 0.6, x1: 1.8, y0: -0.05, y1: 0.9 },
		items: [
			{ id: "table", type: "table", x: 1, y: 0, props: { width: 3 } },
			{ id: "pad", type: "cushion", name: "Pillow pad", x: 1.2, y: 0, props: { material: "pillow stuffing", thickness: 0.12 } },
			{ id: "egg", type: "raw-egg", name: "Egg", x: 1.2, y: 0.12 + 0.45 + B, held: true }
		],
		goals: [{ kind: "survives", item: "egg", label: "the egg survives" }]
	}
	const sim = await simulate(scene)
	assert.equal(sim.summary.goals[0].ok, true, "it survives on 12 cm of pillow from 45 cm")
	const api = async (path, body, signal) =>
		path === "/api/simulate"
			? simulate(body.scene, signal)
			: { ok: true, result: { mode: "patch", reply: "I raised the egg to 1.1 m.", patches: [{ op: "move", id: "egg", y_m: 1.1 }], suggestions: [] }, model: "mock", ms: 1 }
	const ai = createOrchestrator({ api })
	const r = await ai.build({ text: "drop the egg from 1.1 m", mode: "edit", scene, sim }).result
	assert.ok(r.fixNeeded, "from 1.1 m the pillow pad no longer saves it")
	const fr = await ai.findFix(r.fixCtx, { budgetMs: 60000, minRuns: 40, hardMs: 200000 })
	assert.equal(fr.status, "found", JSON.stringify({ status: fr.status, runs: fr.runs }))
	const s2 = await simulate(fr.fix.scene)
	assert.ok(judge(fr.targets, s2).every((x) => x.ok === true), "the fix works when run again")
	const said = fixWords(fr.fix.changes, r.fixCtx.scene).say
	console.log("  · fix:", said, `(${fr.runs} runs)`)
	assert.ok(fr.fix.changes.some((c) => c.kind === "prop" && c.id === "pad"), `the fix turns the pad's knobs: ${said}`)
})
