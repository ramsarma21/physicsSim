// Edit gaps (core-ai, 20 Oct; vfy-sbfr FR3, SB2, SB7) through the app's pipeline with the AI steps mocked and the real engine:
// "What I planned" follows tuning (the critic's rewrite, else each stated setting's value on the table), an edit's own outcome keeps its goal
// (also in a fix), and a drop raised above the stage's top gets the taller stage the server's patch asks for.
//   node --test web/ai/test/edit-gaps.test.mjs
import test from "node:test"
import assert from "node:assert/strict"
import { createOrchestrator, plannedOff, movedHeights, cappedDrop } from "../orchestrator.js"
import { refreshPlanned } from "../planned-words.js"
import { propKeys, propSpec, solve } from "../solver.js"
import { prepare, finish } from "../../sim/index.js"
import { handle } from "../../sim/engine-worker.js"

const simulate = async (scene, signal) => {
	if (signal?.aborted) throw Object.assign(new Error("Cancelled"), { name: "AbortError" })
	const { scene: s, doc, resolved } = prepare(scene)
	const msg = handle({ id: 1, doc, rate: 120 })
	if (msg.error !== undefined) throw new Error(msg.error)
	const meta = finish(s, doc, resolved, msg.track)
	return { key: "k", ms: msg.ms, track: msg.track, doc: meta.doc, summary: meta.summary, warnings: meta.warnings, resolved }
}
function mockApi(answers, log = []) {
	return async (path, body, signal) => {
		if (path === "/api/simulate") return simulate(body.scene, signal)
		const step = path.replace("/api/ai/", "")
		log.push({ step, payload: body.payload })
		let a = answers[step]
		if (typeof a === "function") a = await a(body.payload, log.filter((l) => l.step === step).length)
		if (a instanceof Error) throw a
		return { ok: true, result: a, model: `mock/${step}`, ms: 5, usage: { input_tokens: 10, output_tokens: 5 } }
	}
}
/** A launcher pulled back 6 cm under a ping-pong ball, and a ball held 60 cm up: the planner's words state both. */
const plan = () => ({
	title: "Two things",
	seconds: 2.5,
	release: 0.3,
	reply: "I pull the launcher back 6 cm so it flings the ping-pong ball, and I hold the tennis ball 60 cm above the table.",
	items: [
		{ id: "launcher", type: "band-launcher", props: { draw: 0.06 }, place: { on: "table", x: 0.3 } },
		{ id: "pp", type: "ping-pong-ball", place: { on: "launcher", x: 0.32 } },
		{ id: "ball", type: "tennis-ball", held: true, place: { on: "air", x: 2.4, y_m: 0.6 } }
	],
	missing: [],
	goals: [],
	tune: [],
	notes: ""
})

test("What I planned: the settings it states follow the critic's patches to the version on the table", async () => {
	let n = 0
	const refine = () => (++n === 1 ? { done: false, score_0_10: 6, issues: [{ severity: "medium", text: "pull it back less" }], patches: [{ op: "set_props", id: "launcher", props: { draw: 0.05 } }, { op: "move", id: "ball", dy: 0.2 }] } : { done: true, score_0_10: 9, issues: [], patches: [] })
	const r = await createOrchestrator({ api: mockApi({ plan: plan(), refine }) }).build({ text: "a launcher and a ball" }).result
	assert.equal(r.scene.items.find((i) => i.id === "launcher").props.draw, 0.05)
	assert.equal(r.planned, "I pull the launcher back 5 cm so it flings the ping-pong ball, and I hold the tennis ball 80 cm above the table.")
	// (the planner's own words are kept as the plan said them)
	assert.match(r.initialPlan.reply, /back 6 cm/)
})

test("What I planned: the critic's own rewrite for the version on the table wins; it sees what the user was told", async () => {
	const log = []
	const planned = "I pull the launcher back 6 cm so it flings the ping-pong ball off the board, and the tennis ball drops from 60 cm."
	const r = await createOrchestrator({ api: mockApi({ plan: plan(), refine: { done: true, score_0_10: 9, issues: [], patches: [], planned } }, log) }).build({ text: "a launcher and a ball" }).result
	assert.equal(r.planned, planned)
	assert.equal(log.find((l) => l.step === "refine").payload.plan.reply, plan().reply, "the critic is sent the plan's reply")
	assert.equal(r.refine[0].planned, planned)
})

test("refreshPlanned: only the numbers of what changed, in the text's own units; a number another thing still has is left alone", () => {
	const springs = (k) => ({ items: [{ id: "s1", type: "coil-spring", props: k ? { stiffness: k } : {} }, { id: "s2", type: "coil-spring", props: {} }] })
	assert.equal(refreshPlanned("Two identical 200 N/m springs.", springs(), springs(600), { propSpec, propKeys }).text, "Two identical 200 N/m springs.")
	const one = (k) => ({ items: [{ id: "s1", type: "coil-spring", props: k ? { stiffness: k } : {} }] })
	assert.equal(refreshPlanned("A 200 N/m spring, 20 cm tall.", one(), one(600), { propSpec, propKeys }).text, "A 600 N/m spring, 20 cm tall.")
	const held = (y) => ({ items: [{ id: "b", type: "tennis-ball", place: { on: "air", x: 1, y_m: y } }] })
	assert.equal(refreshPlanned("Dropped from 1.2 m (120 cm).", held(1.2), held(1.35), { propSpec, propKeys }).text, "Dropped from 1.35 m (135 cm).")
	assert.equal(refreshPlanned("Dropped from 1.2 m.", held(1.2), held(1.2), { propSpec, propKeys }).text, "Dropped from 1.2 m.")
	// (16 cm is not 6 cm)
	const l = (d) => ({ items: [{ id: "L", type: "band-launcher", props: { draw: d } }] })
	assert.equal(refreshPlanned("Pulled back 6 cm on a 16 cm board.", l(0.06), l(0.05), { propSpec, propKeys }).text, "Pulled back 5 cm on a 16 cm board.")
})

/** Three springs (the middle one stiff) with masses: SB2's scene after its second turn. */
const springScene = () => {
	const p = {
		title: "Hooke's law",
		seconds: 3,
		release: 0.3,
		items: [
			{ id: "spring1", type: "coil-spring", name: "Spring A (100 g)", place: { on: "table", x: 0.5 } },
			{ id: "spring2", type: "coil-spring", name: "Spring B (200 g)", props: { stiffness: 600 }, place: { on: "table", x: 1.3 } },
			{ id: "spring3", type: "coil-spring", name: "Spring C (300 g)", place: { on: "table", x: 2.1 } },
			{ id: "m100", type: "gram-mass", name: "100 g mass", place: { on: "spring1" } },
			{ id: "m200", type: "gram-mass", name: "200 g mass", props: { grams: "200 g" }, place: { on: "spring2" } },
			{ id: "m300", type: "gram-mass", name: "200 g mass", props: { grams: "200 g" }, place: { on: "spring3" } },
			{ id: "m300b", type: "gram-mass", name: "100 g mass", place: { on: "m300" } }
		],
		missing: [],
		goals: [],
		tune: [],
		notes: ""
	}
	const sc = solve(p).scene
	sc.goals = [
		{ kind: "deforms_more", a: "spring3", b: "spring2", label: "The spring with 300 g squashes more than the one with 200 g" },
		{ kind: "deforms_more", a: "spring2", b: "spring1", label: "The spring with 200 g squashes more than the one with 100 g" }
	]
	return sc
}

test("an edit that asks for an outcome of its own keeps its goal, also as a fix; the goal it makes untrue goes, said on the card", async () => {
	const base = springScene()
	const sim0 = await simulate(base)
	const fresh = { kind: "deforms_more", a: "spring1", b: "spring3", label: "The 100 g spring squashes more than the 300 g spring" }
	const edit = { kind: "fix", targets: [{ says: "the 100 g spring", ids: ["spring1"], because: "it carries 100 g" }], mode: "patch", why: "A new outcome.", reply: "I made the 100 g spring softer (200 → 50 N/m) and dropped the goal it now contradicts.", patches: [{ op: "set_props", id: "spring1", props: { stiffness: 50 } }, { op: "set_goals", goals: [base.goals[0], fresh] }], missing: [], suggestions: [] }
	const r = await createOrchestrator({ api: mockApi({ edit, refine: { done: true, score_0_10: 9, issues: [], patches: [] } }) }).build({ text: "now make the 100 g spring squash more than the 300 g spring, but don't change any of the masses", mode: "edit", scene: base, sim: sim0 }).result
	assert.ok(r.plan.goals.some((g) => g.a === "spring1" && g.b === "spring3"), JSON.stringify(r.plan.goals))
	assert.ok(!r.plan.goals.some((g) => g.a === "spring2" && g.b === "spring1"))
	assert.ok(r.goals.every((g) => g.ok === true), JSON.stringify(r.goals))
	assert.deepEqual(r.edit.goalsDropped, ["“The spring with 200 g squashes more than the one with 100 g” (the new outcome makes it untrue)"])
	// (a make-it-work keeps the scene's goals whatever the answer sets, as before)
	const r2 = await createOrchestrator({ api: mockApi({ edit: { ...edit, reply: "Done." }, refine: { done: true, score_0_10: 9, issues: [], patches: [] } }) }).build({ text: "make it work", mode: "edit", scene: base, sim: sim0 }).result
	// (it may come back as the scene, or as a reply that changes nothing: either way the scene's goals are its own)
	const g2 = r2.plan?.goals ?? r2.scene?.goals ?? base.goals
	assert.ok(!g2.some((g) => g.a === "spring1" && g.b === "spring3"), JSON.stringify(g2))
})

test("an outcome of its own that makes a goal that worked untrue is what was asked: never put back as 'It already works'", async () => {
	// (all three springs 200 N/m: 300 g > 200 g > 100 g both work; the request turns the order round, H1's shape: "make the plain ice cube melt first")
	const base = springScene()
	base.items.find((i) => i.id === "spring2").props = {}
	const sim0 = await simulate(base)
	const fresh = { kind: "deforms_more", a: "spring1", b: "spring3", label: "The 100 g spring squashes more than the 300 g spring" }
	const edit = { kind: "fix", targets: [{ says: "the 100 g spring", ids: ["spring1"], because: "it carries 100 g" }], mode: "patch", why: "A new outcome.", reply: "I made the 100 g spring softer (200 → 50 N/m) and dropped the goal it now contradicts.", patches: [{ op: "set_props", id: "spring1", props: { stiffness: 50 } }, { op: "set_goals", goals: [base.goals[0], fresh] }], missing: [], suggestions: [] }
	const r = await createOrchestrator({ api: mockApi({ edit, refine: { done: true, score_0_10: 9, issues: [], patches: [] } }) }).build({ text: "now make the 100 g spring squash more than the 300 g spring", mode: "edit", scene: base, sim: sim0 }).result
	assert.equal(r.edit.reverted, undefined, JSON.stringify(r.edit.reverted))
	assert.equal(r.scene.items.find((i) => i.id === "spring1").props.stiffness, 50)
	assert.ok(r.goals.length === 2 && r.goals.every((g) => g.ok === true), JSON.stringify(r.goals))
	assert.doesNotMatch(String(r.lead ?? ""), /already works/)
	assert.deepEqual(r.edit.goalsDropped, ["“The spring with 200 g squashes more than the one with 100 g” (the new outcome makes it untrue)"])
	// (a goal turned round is no longer the same goal: the old one is said as dropped)
	const swap = { ...edit, patches: [{ op: "set_props", id: "spring1", props: { stiffness: 50 } }, { op: "set_goals", goals: [base.goals[0], { kind: "deforms_more", a: "spring1", b: "spring2", label: "The 100 g spring squashes more than the 200 g one" }] }] }
	const r3 = await createOrchestrator({ api: mockApi({ edit: swap, refine: { done: true, score_0_10: 9, issues: [], patches: [] } }) }).build({ text: "now make the 100 g spring squash more than the 200 g spring", mode: "edit", scene: base, sim: sim0 }).result
	assert.deepEqual(r3.edit.goalsDropped, ["“The spring with 200 g squashes more than the one with 100 g” (the new outcome makes it untrue)"])
})

test("an edit that raises a held thing above the stage's top gets the taller stage the server's patch asks for; others keep theirs", async () => {
	const p = { title: "Drop", seconds: 2, release: 0.3, items: [{ id: "ball", type: "tennis-ball", held: true, place: { on: "air", x: 1.3, y_m: 1 } }], missing: [], goals: [], tune: [], notes: "" }
	const base = solve(p).scene
	assert.ok(base.stage.y1 < 2.5)
	const up = { kind: "change", targets: [{ says: "the ball", ids: ["ball"], because: "the only ball" }], mode: "patch", why: "A move.", reply: "I raised the ball to 3 m.", patches: [{ op: "move", id: "ball", y_m: 3 }, { op: "set_scene", stage: { ...base.stage, y1: 3.6 }, why: "the frame made taller to show what now starts higher" }], missing: [], suggestions: [] }
	const r = await createOrchestrator({ api: mockApi({ edit: up }) }).build({ text: "drop it from 3 m", mode: "edit", scene: base, sim: await simulate(base) }).result
	assert.equal(r.scene.stage.y1, 3.6)
	assert.deepEqual({ ...r.scene.stage, y1: 0 }, { ...base.stage, y1: 0 })
	assert.ok(Math.abs(r.scene.items.find((i) => i.id === "ball").y - 3) < 0.05, JSON.stringify(r.scene.items))
	const lower = { ...up, reply: "I raised the ball to 1.5 m.", patches: [{ op: "move", id: "ball", y_m: 1.5 }] }
	const r2 = await createOrchestrator({ api: mockApi({ edit: lower }) }).build({ text: "drop it from 1.5 m", mode: "edit", scene: base, sim: await simulate(base) }).result
	assert.deepEqual(r2.scene.stage, base.stage)
})

test("an edit's honest limit stays on the card: a limit or a contrast is no claim, and the heights a move left things at are facts", () => {
	const lines = ["Moved the 2 egg-drop boxes 1.5 m up", ...movedHeights({ items: [{ id: "a", y: 1.5 }, { id: "t", y: 0 }] }, { items: [{ id: "a", y: 3 }, { id: "t", y: 0 }] })]
	assert.deepEqual(lines.slice(1), ["1.5 m", "3 m"])
	assert.equal(plannedOff("The room only shows drops up to 3 m, so I raised both boxes from 1.5 m to 3 m instead of 6 m.", lines), false)
	assert.equal(plannedOff("I dropped them from 6 m.", lines), true)
})

test("a drop asked above what the room shows is said on the card with where the things start now; other requests say nothing", () => {
	const at = (y) => ({ items: [{ id: "a", y, held: true }, { id: "b", y, held: true }] })
	assert.equal(cappedDrop("drop them from 6 m instead", at(1.5), at(3)), "a 6 m drop (the room only shows drops up to 3 m, so they start at 3 m)")
	assert.equal(cappedDrop("drop them from 6 m instead", at(3), at(3)), "a 6 m drop (the room only shows drops up to 3 m, so they start at 3 m)")
	assert.equal(cappedDrop("drop them from 2 m instead", at(1.5), at(2)), null)
	assert.equal(cappedDrop("move it 4 m to the right", at(1.5), at(1.5)), null)
})
