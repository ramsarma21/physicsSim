// Edit gaps (core-ai, 20 Oct; vfy-sbfr FR3, SB2): a drop higher than the stage, an edit's own outcome and its goal, goals that contradict each
// other, and the critic's rewrite of what the user was told about the plan. ai/schemas.mjs + ai/edit-outcome.mjs against the real catalog.
//   node --test ai/test/edit-outcome.test.mjs
import assert from "node:assert/strict"
import { before, test } from "node:test"
import "../../web/sim/index.js" // (the physics modules' goal kinds: deforms_more, melts_first…)
import { getCatalog } from "../catalog-digest.mjs"
import { goalClash, statesNewOutcome } from "../edit-outcome.mjs"
import { HIGHEST_START_M, validate } from "../schemas.mjs"
import { statesNewOutcome as browserStates } from "../../web/ai/outcome-goals.js"

let catalog
before(async () => {
	catalog = (await getCatalog()).index
})
const STAGE = { x0: -0.56, x1: 3.19, y0: -0.16, y1: 2.34 }
const TABLE = { id: "table", type: "table", name: "Table", x: 1.3, y: 0, angle: 0, props: {} }
const drop = (y, stage = STAGE) => ({
	version: 2,
	name: "Egg drop",
	seconds: 5,
	release: 0.5,
	stage,
	items: [TABLE, { id: "ball", type: "tennis-ball", name: "Tennis ball", x: 0.9, y, angle: 0, held: true, props: {} }, { id: "ball2", type: "tennis-ball", name: "Second ball", x: 2.1, y, angle: 0, held: true, props: {} }],
	goals: []
})
const springs = () => ({
	version: 2,
	name: "Hooke's law",
	seconds: 4,
	release: 0.5,
	stage: STAGE,
	items: [
		TABLE,
		{ id: "spring1", type: "coil-spring", name: "Spring A (100 g)", x: 0.5, y: 0, angle: 0, props: {} },
		{ id: "spring2", type: "coil-spring", name: "Spring B (200 g)", x: 1.3, y: 0, angle: 0, props: { stiffness: 600 } },
		{ id: "spring3", type: "coil-spring", name: "Spring C (300 g)", x: 2.1, y: 0, angle: 0, props: {} }
	],
	goals: [
		{ kind: "deforms_more", a: "spring3", b: "spring2", label: "The spring with 300 g squashes more than the one with 200 g" },
		{ kind: "deforms_more", a: "spring2", b: "spring1", label: "The spring with 200 g squashes more than the one with 100 g" }
	]
})
const edit = (patches, kind = "change") => ({ kind, targets: [], mode: "patch", why: "x", reply: "Done.", patches, missing: [], suggestions: [] })
const run = (answer, scene, text) => validate("edit", answer, { catalog, scene, stage: scene.stage, text })

test("a drop higher than the room shows is refused with the limit and the highest drop, never 'outside the stage'", () => {
	const sc = drop(3, { ...STAGE, y1: 3.9 })
	const r = run(edit([{ op: "move", id: "ball", y_m: 6 }, { op: "move", id: "ball2", y_m: 6 }]), sc, "drop them from 6 m instead")
	assert.equal(r.ok, false)
	assert.equal(r.errors.length, 2)
	for (const e of r.errors) {
		assert.match(e, /= 6 m is higher than the room shows/)
		assert.match(e, new RegExp(`the highest drop it can show`))
		assert.match(e, new RegExp(`at most ${HIGHEST_START_M} m`))
		assert.doesNotMatch(e, /outside the stage/)
	}
	// (a fixed camera frames what it is told: the room's limit is not this scene's; its stage still is)
	const cam = { ...sc, settings: { camera: { x0: -1, x1: 5, y: 3 } } }
	const r2 = run(edit([{ op: "move", id: "ball", y_m: 6 }]), cam, "drop it from 6 m")
	assert.ok(r2.errors.every((e) => !/higher than the room/.test(e)) && r2.errors.some((e) => /outside the stage/.test(e)), r2.errors.join("\n"))
})

test("a height in an edit's missing list is no missing thing: it goes, with a warning; a thing stays", () => {
	const sc = drop(3, { ...STAGE, y1: 3.9 })
	const a = { kind: "answer", targets: [], mode: "patch", why: "x", reply: "The room only shows drops up to 3 m, and they already start there.", patches: [], missing: [{ asked: "a 6 m drop", reason: "the room is too low", substitute_type: null }, { asked: "a 6-m fall", reason: "x" }, { asked: "a 6 m ladder", reason: "not in the library", substitute_type: null }], suggestions: [] }
	const r = run(a, sc, "drop them from 6 m instead")
	assert.equal(r.ok, true, r.errors.join("\n"))
	assert.deepEqual(r.value.missing.map((m) => m.asked), ["a 6 m ladder"])
	assert.equal(r.warnings.filter((w) => /is a height, not a thing/.test(w)).length, 2)
})

test("a drop up to the room's limit above the stage's top grows the stage with a set_scene patch; a lower one leaves it as it was", () => {
	const r = run(edit([{ op: "move", id: "ball", y_m: 3 }, { op: "move", id: "ball2", y_m: 3 }]), drop(1), "drop them from 3 m")
	assert.equal(r.ok, true, r.errors.join("\n"))
	const st = r.value.patches.filter((p) => p.op === "set_scene")
	assert.equal(st.length, 1)
	assert.deepEqual(st[0].stage, { ...STAGE, y1: 3.6 })
	// (within the stage and its slack, as before: no patch, nothing else changes)
	const r2 = run(edit([{ op: "move", id: "ball", y_m: 2.5 }]), drop(1), "drop it from 2.5 m")
	assert.equal(r2.ok, true)
	assert.equal(r2.value.patches.filter((p) => p.op === "set_scene").length, 0)
	// (a tall stage already holds it: no patch)
	const r3 = run(edit([{ op: "move", id: "ball", y_m: 3 }]), drop(1, { ...STAGE, y1: 3.9 }), "drop it from 3 m")
	assert.equal(r3.ok, true)
	assert.equal(r3.value.patches.filter((p) => p.op === "set_scene").length, 0)
	// (a model's own set_scene stage is a valid patch)
	const r4 = run(edit([{ op: "set_scene", stage: { ...STAGE, y1: 3.5 } }, { op: "move", id: "ball", y_m: 2.9 }]), drop(1), "drop it from 2.9 m")
	assert.equal(r4.ok, true, r4.errors.join("\n"))
})

test("a plan may put a thing up to the room's limit above its stage (the solver grows the stage); higher is the room's limit", () => {
	const plan = (y) => ({ title: "Drop", seconds: 3, items: [{ id: "ball", type: "tennis-ball", held: true, place: { on: "air", x: 1, y_m: y } }], missing: [], goals: [], tune: [], notes: "" })
	assert.deepEqual(validate("plan", plan(3), { catalog }).errors, [])
	const e = validate("plan", plan(5), { catalog }).errors
	assert.ok(e.some((x) => /= 5 m is higher than the room shows/.test(x)), e.join("\n"))
	// (a plan that makes its stage tall still cannot start a thing above what the room shows)
	const e2 = validate("plan", { ...plan(5), stage: { ...STAGE, y1: 6 } }, { catalog }).errors
	assert.ok(e2.some((x) => /higher than the room shows/.test(x)), e2.join("\n"))
})

test("an edit that asks for an outcome of its own but sets no goal gets the soft repair; a plain change or a make-it-work does not", () => {
	const T = "now make the 100 g spring squash more than the 300 g spring, but don't change any of the masses"
	const r = run(edit([{ op: "set_props", id: "spring1", props: { stiffness: 50 } }], "fix"), springs(), T)
	assert.equal(r.ok, true)
	assert.equal(r.soft.length, 1)
	assert.match(r.soft[0], /asks for an outcome of its own/)
	assert.match(r.soft[0], /set_goals/)
	for (const [text, kind] of [
		["swap the middle spring for a stiffer one, 600 N/m", "change"],
		["make it work", "fix"],
		["Make it work again so that the spring with 300 g squashes more than the one with 200 g, keeping Spring B.", "fix"]
	])
		assert.deepEqual(run(edit([{ op: "set_props", id: "spring1", props: { stiffness: 150 } }], kind), springs(), text).soft, [], text)
	// (an answer that sets the goal is left as it is)
	const ok = run(edit([{ op: "set_props", id: "spring1", props: { stiffness: 50 } }, { op: "set_goals", goals: [springs().goals[0], { kind: "deforms_more", a: "spring1", b: "spring3", label: "The 100 g spring squashes more than the 300 g one" }] }], "fix"), springs(), T)
	assert.equal(ok.ok, true, ok.errors.join("\n"))
	assert.deepEqual(ok.soft, [])
})

test("goals an edit leaves that go round in a circle are refused, naming the scene's goals the new outcome overrides", () => {
	const T = "now make the 100 g spring squash more than the 300 g spring"
	const goals = [...springs().goals, { kind: "deforms_more", a: "spring1", b: "spring3", label: "The 100 g spring squashes more than the 300 g one" }]
	const r = run(edit([{ op: "set_props", id: "spring1", props: { stiffness: 50 } }, { op: "set_goals", goals }], "fix"), springs(), T)
	assert.equal(r.ok, false)
	assert.equal(r.errors.length, 1)
	assert.match(r.errors[0], /cannot all happen, they go round in a circle/)
	assert.match(r.errors[0], /overrides the scene's “The spring with 300 g squashes more than the one with 200 g” or “The spring with 200 g squashes more than the one with 100 g”/)
	// (kinds about both together are no order; a circle the scene had already is not this change's)
	assert.equal(goalClash([{ kind: "repels", a: "m1", b: "m2" }, { kind: "repels", a: "m2", b: "m1" }], []), null)
	const old = [{ kind: "melts_first", a: "i1", b: "i2" }, { kind: "melts_first", a: "i2", b: "i1" }]
	assert.equal(goalClash(old, old), null)
	assert.ok(goalClash(old, [old[0]]))
	// (the same kind at another time is another quantity: warmer at 5 min and warmer at the end can differ)
	assert.equal(goalClash([{ kind: "warmer", a: "c1", b: "c2", at_min: 5 }, { kind: "warmer", a: "c2", b: "c1" }], []), null)
})

test("what asks for an outcome of its own: the server's and the browser's words agree", () => {
	const yes = [
		"now make the 100 g spring squash more than the 300 g spring, but don't change any of the masses",
		"make the boat float",
		"make the bulb light up",
		"move the lamp so the ice melts first",
		"make the red car go farther than the blue car",
		"make the stopwatch read 3 s",
		"put salt on it so that it melts faster",
		"the plain cube should melt first"
	]
	const no = ["make it work", "fix it", "Make it work again so that the ball lands in the box, keeping the red ball.", "make the ball bigger", "make the ramp steeper", "drop them from 6 m instead", "make the light bulb brighter", "replace the dominoes with soda cans", "make the lighter load 3 kg", "make it work without moving the box"]
	for (const t of yes) assert.ok(statesNewOutcome(t) && browserStates(t), t)
	for (const t of no) assert.ok(!statesNewOutcome(t) && !browserStates(t), t)
})

test("the critic's `planned` (rate and refine): kept as a trimmed string, cut to 1200 characters; an empty or a non-string one is dropped", () => {
	const plan = { title: "x", seconds: 3, items: [{ id: "ball", type: "tennis-ball", place: { on: "table", x: 1 } }], missing: [], goals: [], tune: [], notes: "" }
	const r = validate("refine", { done: true, score_0_10: 9, issues: [], patches: [], planned: "  I built a 150 cm parachute.  " }, { catalog, plan })
	assert.equal(r.ok, true)
	assert.equal(r.value.planned, "I built a 150 cm parachute.")
	const long = validate("rate", { score_0_10: 8, issues: [], planned: "a".repeat(1500) }, { plan })
	assert.equal(long.ok, true)
	assert.equal(long.value.planned.length, 1200)
	for (const p of ["", "   ", 7, null]) assert.equal(validate("rate", { score_0_10: 8, issues: [], planned: p }, { plan }).value.planned, undefined)
})
