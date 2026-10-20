// The pipeline with the AI endpoints mocked (node --test web/ai/test/orchestrator.test.mjs): plan -> solve -> simulate -> refine (patches) -> tune -> report,
// cancellation, retries and plain errors. The physics is the real engine (web/sim/engine-worker.js on this thread).
import test from "node:test"
import assert from "node:assert/strict"
import { createOrchestrator, applyPatches, tune, goalDistance, digestScene, AiError, safeKnobs, describeDiff, describeRun, runProblems, lostStages, fmtLen, propChange, fixInfo, statesOutcome, editLead } from "../orchestrator.js"
import { solve, itemGeometry as itemGeo, shapesAt as shapesOf } from "../solver.js"
const itemGeometryOf = (t, p = {}) => -Math.min(...shapesOf(itemGeo(t, p), 0, 0, 0).map((q) => q.y0)) // (how far below its anchor it reaches)
const near = (a, b, tol, what = "") => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} vs ${b}`)
import { prepare, finish } from "../../sim/index.js"
import { handle } from "../../sim/engine-worker.js"
import { readFileSync, existsSync } from "node:fs"

const simulate = async (scene, signal) => {
	if (signal?.aborted) throw Object.assign(new Error("Cancelled"), { name: "AbortError" })
	const { scene: s, doc, resolved } = prepare(scene)
	const msg = handle({ id: 1, doc, rate: 120 })
	if (msg.error !== undefined) throw new Error(msg.error)
	const meta = finish(s, doc, resolved, msg.track)
	return { key: "k", ms: msg.ms, track: msg.track, doc: meta.doc, summary: meta.summary, warnings: meta.warnings, resolved }
}
const rube = () => JSON.parse(readFileSync(new URL("./fixtures/rube.plan.json", import.meta.url)))
/** A mock of the app's api(): /api/ai/<step> answers from `answers[step]` (a value or a function of the payload); /api/simulate runs the engine. */
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
/** A ball held over a box that misses it: the tuner's case. */
const dropPlan = (x) => ({
	title: "Drop into the box",
	seconds: 2.5,
	release: 0.3,
	items: [
		{ id: "box", type: "box", props: { hung: false }, place: { on: "table", x: 1.5 } },
		{ id: "ball", type: "clay-ball", held: true, place: { on: "air", x, y_m: 0.6 } }
	],
	goals: [{ label: "The ball lands in the box", item: "ball", container: "box" }],
	tune: [{ id: "ball", param: "x", min: 1.0, max: 2.0 }]
})

test("plan -> solve -> simulate -> refine done -> report", async () => {
	const log = []
	const ai = createOrchestrator({ api: mockApi({ plan: rube(), refine: { done: true, score_0_10: 9, issues: [], patches: [] } }, log) })
	const events = []
	const job = ai.build({ text: "a ball rolls down a ramp into dominoes" }, { onEvent: (e) => events.push(e) })
	const r = await job.result
	assert.equal(r.title, "Ramp, dominoes and a ball")
	assert.ok(r.scene.items.length >= 6)
	assert.ok(r.used.some((u) => u.type === "domino-row"))
	assert.equal(r.score, 9)
	assert.deepEqual(log.map((l) => l.step), ["plan", "refine"])
	const rp = log[1].payload
	assert.equal(rp.text, "a ball rolls down a ramp into dominoes")
	assert.ok(rp.scene.items.length >= 6, "the critic gets the solved scene")
	assert.ok(rp.sim.summary.events.length > 0, "and what happened in the run")
	assert.deepEqual([rp.round, rp.rounds], [1, 3])
	const steps = events.filter((e) => e.type === "step" && e.state === "done").map((e) => e.step)
	assert.deepEqual(steps, ["plan", "solve", "simulate", "refine"])
	assert.ok(r.timings.plan >= 0 && r.timings.simulate >= 0 && r.totalMs >= 0)
	assert.deepEqual(r.models, ["mock/plan", "mock/refine"])
})

test("refine patches change the plan (never raw coordinates), re-solve and re-run; the round's changes are reported", async () => {
	let n = 0
	const ai = createOrchestrator({
		api: mockApi({
			plan: rube(),
			refine: () => (++n === 1 ? { done: false, score_0_10: 5, issues: ["the dominoes are too far from the ramp"], patches: [{ op: "move", id: "row", dx: -0.05 }, { op: "set_props", id: "row", props: { count: 8 } }] } : { done: true, score_0_10: 8, issues: [], patches: [] })
		})
	})
	const r = await ai.build({ text: "x" }).result
	assert.equal(r.refine.length, 2)
	// the changes as the scene shows them (solved before vs after), with units, not the plan's wording
	assert.match(r.refine[0].changes.join(" | "), /Dominoes moved 5 cm left; count 6 → 8/)
	assert.match(r.refine[0].planChanges.join(" | "), /gap to ramp now 10\.0 cm/, "(the plan's own change list is kept beside it)")
	assert.equal(r.scene.items.find((i) => i.id === "row").props.count, 8)
	assert.equal(r.score, 8)
})

test("applyPatches: every op, and what rested on a removed item moves to its support", () => {
	const plan = rube()
	const { plan: p, changes, skipped } = applyPatches(plan, [
		{ op: "remove", id: "stand" },
		{ op: "add", item: { id: "b2", type: "superball", place: { on: "table", x: 2 } } },
		{ op: "replace_type", id: "target", type: "golf-ball" },
		{ op: "set_place", id: "cup", place: { on: "table", x: 2.5 } },
		{ op: "move", id: "b2", dx: 0.1 },
		{ op: "move", id: "nope", dx: 1 },
		{ op: "frobnicate" }
	])
	assert.equal(p.items.find((i) => i.id === "ramp").place.lean.from.on, "table")
	assert.equal(p.items.find((i) => i.id === "b2").place.x, 2.1)
	assert.equal(p.items.find((i) => i.id === "target").type, "golf-ball")
	assert.equal(changes.length, 5)
	assert.equal(skipped.length, 2)
	assert.ok(rube().items.find((i) => i.id === "stand"), "the input plan is not changed")
})

test("tune: a missed drop is moved over the box within the budget, and the middle of the passing range is taken", async () => {
	const plan = dropPlan(1.25)
	const solved = solve(plan)
	const sim = await simulate(solved.scene)
	assert.equal(sim.summary.goals[0].ok, false, "misses at first")
	const d0 = goalDistance(solved.scene, sim)
	const r = await tune({ plan, scene: solved.scene, sim, simulate, maxRuns: 40, maxMs: 20000 })
	assert.equal(r.passed, true, `passed after ${r.runs} runs`)
	assert.ok(r.runs <= 40)
	assert.equal(r.changed.length, 1)
	assert.ok(Math.abs(r.changed[0].to - 1.5) < 0.06, `ball x ${r.changed[0].to} near the box's middle`)
	assert.ok(goalDistance(r.scene, r.sim) < d0)
})

test("the pipeline tunes when goals fail and reports what it changed", async () => {
	// (physics first: a new scene is tuned before the critic looks; the critic then sees the version that works)
	const log = []
	const ai = createOrchestrator({ api: mockApi({ plan: dropPlan(1.2), refine: { done: true, score_0_10: 9, issues: [], patches: [] } }, log) })
	const events = []
	const r = await ai.build({ text: "drop a ball into a box" }, { onEvent: (e) => events.push(e) }).result
	assert.ok(r.stageTune?.kept && r.stageTune.runs > 0, JSON.stringify(r.stageTune))
	assert.deepEqual([r.stageTune.before.goals, r.stageTune.after.goals], ["0/1", "1/1"])
	assert.match(r.stageTune.changes.join(" "), /moved/)
	assert.deepEqual(r.goals.map(({ label, ok }) => ({ label, ok })), [{ label: "The ball lands in the box", ok: true }])
	const critiqued = log.find((l) => l.step === "refine").payload
	assert.equal(critiqued.sim.summary.goals[0].ok, true, "the critic's first look is at the tuned version")
	assert.ok(events.some((e) => e.type === "step" && e.step === "stagetune" && e.state === "done"))
	assert.ok(events.some((e) => e.type === "draft" && e.label === "tuned"))
	assert.ok(events.some((e) => e.type === "progress" && e.step === "stagetune" && e.runs > 0))
	// without physics first (opts.stageTune false) the tuner runs after the critic, as before
	const b = await createOrchestrator({ api: mockApi({ plan: dropPlan(1.2), refine: { done: true, score_0_10: 7, issues: ["the ball misses the box"], patches: [] } }) }).build({ text: "drop a ball into a box" }, { stageTune: false }).result
	assert.ok(b.tune && b.tune.changed.length === 1, JSON.stringify(b.tune))
	assert.equal(b.stageTune, undefined)
	assert.deepEqual(b.goals.map(({ label, ok }) => ({ label, ok })), [{ label: "The ball lands in the box", ok: true }])
})

test("edit mode: patches from the edit step apply to the plan of the scene on screen", async () => {
	const base = solve(rube()).scene
	const log = []
	const ai = createOrchestrator({ api: mockApi({ edit: { patches: [{ op: "set_props", id: "row", props: { count: 10 } }], summary: "ten dominoes" }, refine: { done: true, score_0_10: 8, patches: [] } }, log) })
	const r = await ai.build({ text: "use ten dominoes", mode: "edit", scene: base }).result
	assert.equal(r.mode, "edit")
	assert.equal(r.scene.items.find((i) => i.id === "row").props.count, 10)
	// (ai/DESIGN.md §14.2 (1)) the scene exactly as on the table; no plan for a scene the AI's plan didn't make (the server reads it as made by
	// hand, as measured) and no run (the server runs the scene itself)
	assert.deepEqual(log[0].payload.scene, base)
	assert.equal(log[0].payload.plan, undefined)
	assert.equal(log[0].payload.sim, undefined)
	assert.equal(log[0].payload.intent, "edit")
	// what the scene shows: the longer row, and the ball it now reaches being moved out of its way (the solver's doing, so it is said)
	assert.deepEqual(r.edit.changes, ["Dominoes: count 6 → 10", "Tennis ball moved 36 cm left"])
})

test("cancel stops the build with an AbortError", async () => {
	const ai = createOrchestrator({ api: mockApi({ plan: () => new Promise((res) => setTimeout(() => res(rube()), 300)) }) })
	const job = ai.build({ text: "x" })
	setTimeout(() => job.cancel(), 20)
	await assert.rejects(job.result, (e) => e.name === "AbortError")
})

test("errors are plain: a gateway failure is retried once, then reported; an empty plan is 'nothing buildable'", async () => {
	let calls = 0
	const fail = () => {
		calls++
		return Object.assign(new Error("upstream 503"), { status: 503 })
	}
	const ai = createOrchestrator({ api: mockApi({ plan: fail }) })
	await assert.rejects(ai.build({ text: "x" }).result, (e) => e instanceof AiError && e.kind === "gateway" && e.retryable)
	assert.equal(calls, 2, "one retry")
	const empty = createOrchestrator({ api: mockApi({ plan: { title: "Nothing", items: [{ id: "u", type: "unicorn" }], missing: [{ asked: "a unicorn", reason: "not in the library" }] } }) })
	await assert.rejects(empty.build({ text: "a unicorn" }).result, (e) => e instanceof AiError && e.kind === "nothing")
	await assert.rejects(createOrchestrator({ api: mockApi({}) }).build({ text: "" }).result, (e) => e.kind === "input")
})

test("digestScene says what each item rests on", () => {
	const s = solve(rube()).scene
	const d = digestScene(s)
	assert.equal(d.items.find((i) => i.id === "ball").rests_on, "ramp")
	assert.equal(d.items.find((i) => i.id === "row").rests_on, "table")
	assert.equal(d.items.find((i) => i.id === "ramp").rests_on, "stand")
})

test("refine issues may be objects ({severity, text, ids}); an edit that is only a question answers without rebuilding", async () => {
	const ai = createOrchestrator({ api: mockApi({ plan: rube(), refine: { done: true, score_0_10: 9, issues: [{ severity: "low", text: "the cup is far away", ids: ["cup"] }], patches: [] } }) })
	const r = await ai.build({ text: "x" }).result
	assert.deepEqual(r.refine[0].issues, ["the cup is far away"])
	const base = solve(rube()).scene
	const q = createOrchestrator({ api: mockApi({ edit: { mode: "patch", reply: "The ramp is 0.84 m long.", patches: [], missing: [] } }) })
	const a = await q.build({ text: "how long is the ramp?", mode: "edit", scene: base }).result
	assert.equal(a.replyOnly, true)
	assert.equal(a.reply, "The ramp is 0.84 m long.")
	assert.equal(a.scene, undefined, "nothing to apply")
})

test("images go to the server as data URLs, to observe and to plan", async () => {
	const log = []
	const img = { name: "photo.jpg", dataUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD", width: 10, height: 10, thumb: "" }
	const ai = createOrchestrator({ api: mockApi({ observe: { objects: [], relations: [], motion_story: [], view: "side", scale_hint: null, uncertain: ["the ball's size"] }, plan: rube(), refine: { done: true, score_0_10: 8, patches: [] } }, log) })
	const r = await ai.build({ text: "like this", images: [img] }).result
	assert.equal(log[0].step, "observe")
	assert.match(log[0].payload.images[0].data, /^data:image\/jpeg;base64,/)
	assert.ok(log[1].payload.observation && log[1].payload.images.length === 1, "the planner sees the observation and the picture")
	assert.deepEqual(r.unsure, ["A low-resolution picture: counts and sizes may be off", "the ball's size"], "what the picture left unsure is reported apart from the assumptions (a 10 px picture is said to be one)")
})

test("a refine change that loses the goal: the tuner gets to win it back; without knobs the earlier version is kept", async () => {
	const critic = () => ({ done: false, score_0_10: 5, issues: ["it only works by luck"], patches: [{ op: "move", id: "ball", x: 1.25 }] })
	// physics first: a change that stops a goal that worked is never taken (the loop guard), and the critic hears why
	const guarded = await createOrchestrator({ api: mockApi({ plan: dropPlan(1.5), refine: critic }) }).build({ text: "drop a ball into a box" }, { refineRounds: 1 }).result
	assert.match(guarded.refine[0].rejected ?? "", /“The ball lands in the box” no longer happens/)
	assert.deepEqual(guarded.goals.map(({ label, ok }) => ({ label, ok })), [{ label: "The ball lands in the box", ok: true }])
	assert.equal(guarded.scene.items.find((i) => i.id === "ball").x, 1.5)
	// without it (stageTune: false), as before: the tuner gets to win it back; without knobs the earlier version is kept
	const withKnob = createOrchestrator({ api: mockApi({ plan: dropPlan(1.5), refine: critic }) })
	const a = await withKnob.build({ text: "drop a ball into a box" }, { refineRounds: 1, stageTune: false }).result
	assert.ok(a.tune && a.tune.runs > 0, "the tuner ran on the changed version")
	assert.deepEqual(a.goals.map(({ label, ok }) => ({ label, ok })), [{ label: "The ball lands in the box", ok: true }])
	assert.ok(Math.abs(a.scene.items.find((i) => i.id === "ball").x - 1.25) > 0.05, "the changed version, re-aimed")
	const noKnob = { ...dropPlan(1.5), tune: [] }
	const b = await createOrchestrator({ api: mockApi({ plan: noKnob, refine: critic }) }).build({ text: "x" }, { refineRounds: 1, stageTune: false }).result
	assert.deepEqual(b.goals.map(({ label, ok }) => ({ label, ok })), [{ label: "The ball lands in the box", ok: true }], "the earlier version, which met the goal")
	assert.match(b.refine[0].rejected, /earlier version was kept/)
})

// ================================================================ the repairs (busy waits, honest scores, final check, undone rounds, floating guard, safe knobs, wording)
const busyErr = (retryAfter = 0.05) => Object.assign(new Error("too many AI steps are running; try again in a moment"), { status: 429, body: { ok: false, code: "busy", retryable: true, retryAfter } })

test("busy (429): the build waits for a free AI slot (telling the timeline), then goes on; cancel stops the wait", async () => {
	let n = 0
	const events = []
	const ai = createOrchestrator({ api: mockApi({ plan: () => (++n <= 2 ? busyErr() : rube()), refine: { done: true, score_0_10: 9, patches: [] } }) })
	const r = await ai.build({ text: "x" }, { onEvent: (e) => events.push(e) }).result
	assert.equal(n, 3, "tried again after each busy answer")
	assert.equal(r.score, 9)
	const waits = events.filter((e) => e.type === "wait")
	assert.deepEqual(waits.map((e) => [e.step, e.state]), [["plan", "start"], ["plan", "end"], ["plan", "start"], ["plan", "end"]])
	// a long wait is cancellable
	const slow = createOrchestrator({ api: mockApi({ plan: () => busyErr(20) }) })
	const job = slow.build({ text: "x" })
	setTimeout(() => job.cancel(), 50)
	const t0 = Date.now()
	await assert.rejects(job.result, (e) => e.name === "AbortError")
	assert.ok(Date.now() - t0 < 2000, "stopped at once")
})

test("scores belong to the version they judged: patches after the last check get a final check; if it can't run, no number is claimed", async () => {
	// round 1 scores 4 and patches; the final check of the patched version answers 8: that is the score shown
	let n = 0
	const critic = () => (++n === 1 ? { done: false, score_0_10: 4, issues: [{ severity: "high", text: "the dominoes are too far" }], patches: [{ op: "move", id: "cup", dx: 0.1 }] } : { done: true, score_0_10: 8, issues: [], patches: [] })
	const a = await createOrchestrator({ api: mockApi({ plan: rube(), refine: critic }) }).build({ text: "x" }, { refineRounds: 1 }).result
	assert.equal(a.refine.length, 2)
	assert.equal(a.refine[1].final, true)
	assert.equal(a.score, 8, "the final check's score, for the version on the table")
	assert.equal(a.scoreState, "checked")
	// the same, but the final check fails (J06: a 429 after round 1): the round-1 score is NOT shown as this scene's; the user is told
	let m = 0
	const failing = () => (++m === 1 ? { done: false, score_0_10: 4, issues: ["far"], patches: [{ op: "move", id: "cup", dx: 0.1 }] } : Object.assign(new Error("upstream 503"), { status: 503 }))
	const b = await createOrchestrator({ api: mockApi({ plan: rube(), refine: failing }) }).build({ text: "x" }, { refineRounds: 1 }).result
	assert.equal(b.score, null, "no score claimed for an unchecked version")
	assert.equal(b.scoreState, "stale")
	assert.equal(b.staleScore, 4)
	assert.match(b.scoreNote, /not checked again/)
	assert.ok(b.issues.some((i) => i.level === "warn" && i.code === "final_check_failed"), JSON.stringify(b.issues))
	// a first check that can't run: the scene is applied, said to be unchecked
	const c = await createOrchestrator({ api: mockApi({ plan: rube(), refine: () => Object.assign(new Error("upstream 503"), { status: 503 }) }) }).build({ text: "x" }).result
	assert.equal(c.score, null)
	assert.ok(c.issues.some((i) => i.code === "refine_failed" && /not checked by the AI/.test(i.text)))
})

test("a round that stops a stage that worked is undone, and the critic is told why in its next round", async () => {
	const log = []
	let n = 0
	// round 1: move the dominoes 1.6 m away (the ball no longer reaches them; at 1.2 m it still does, late, and they end leaning past 45°); round 2: happy
	const critic = () => (++n === 1 ? { done: false, score_0_10: 6, issues: ["x"], patches: [{ op: "move", id: "row", dx: 1.6 }] } : { done: true, score_0_10: 8, issues: [], patches: [] })
	const r = await createOrchestrator({ api: mockApi({ plan: rube(), refine: critic }, log) }).build({ text: "x" }).result
	assert.match(r.refine[0].rejected ?? "", /stopped what worked before \(Dominoes: 0 of 6 fall \(was [1-6] of 6 fall\)/)
	const second = log.filter((l) => l.step === "refine")[1].payload
	assert.ok(second.sim.warnings.some((w) => /were tried and undone/.test(w.text)), "the critic hears it")
	assert.equal(r.scene.items.find((i) => i.id === "row").x < 1.5, true, "the dominoes stayed where they worked")
	assert.equal(r.score, 8)
})

test("refine patches that would leave something floating are not applied (legs off a ramp in the air); the rest are", async () => {
	const plan = { title: "Air ramp", seconds: 2, items: [
		{ id: "ramp", type: "plank", name: "Feed ramp", place: { lean: { from: { on: "air", x: 0.6, y: 0.5 }, to: { on: "air", x: 1.1, y: 0.3 } } } },
		{ id: "ball", type: "golf-ball", held: true, place: { on: "ramp", x: 0.65 } }
	], goals: [], tune: [] }
	let n = 0
	const critic = () => (++n === 1 ? { done: false, score_0_10: 5, issues: ["legs"], patches: [{ op: "set_props", id: "ramp", props: { legs: false } }, { op: "replace_type", id: "ball", type: "tennis-ball" }] } : { done: true, score_0_10: 8, patches: [] })
	const r = await createOrchestrator({ api: mockApi({ plan, refine: critic }) }).build({ text: "x" }).result
	assert.notEqual(r.scene.items.find((i) => i.id === "ramp").props.legs, false, "the ramp keeps its legs")
	assert.equal(r.scene.items.find((i) => i.id === "ball").type, "tennis-ball", "the other change is made")
	assert.match(r.refine[0].skipped.join(" | "), /Feed ramp: not changed, the change would have left it floating/)
})

test("safeKnobs: a height knob on a cup in mid-air stays (the solver stands it on a stand at any height); on a cup standing on a shelf it moves the shelf", () => {
	const air = { title: "t", items: [{ id: "cup", type: "cup", place: { on: "air", x: 1, y_m: 0.3 } }], tune: [{ id: "cup", param: "y", min: 0.1, max: 0.4 }, { id: "cup", param: "x", min: 0.8, max: 1.2 }] }
	const a = safeKnobs(air, solve(air).scene)
	assert.deepEqual(a.knobs.map((k) => k.param), ["y", "x"])
	assert.deepEqual(a.notes, [])
	// on a box on the table (not in the air on its own): lifting it off the box would leave it floating, so the knob is left out
	const onBox = { title: "t", items: [{ id: "bx", type: "cardboard-box", place: { on: "table", x: 1 } }, { id: "cup", type: "cup", place: { on: "bx" } }], tune: [{ id: "cup", param: "y", min: 0.3, max: 0.5 }] }
	const c = safeKnobs(onBox, solve(onBox).scene)
	assert.equal(c.knobs.length, 0)
	assert.match(c.notes[0], /height was left alone/)
	const shelf = { title: "t", items: [{ id: "shelf", type: "plank", props: { length: 0.4 }, place: { on: "air", x: 1.5, y_m: 0.3 } }, { id: "cup", type: "cup", place: { on: "shelf" } }], tune: [{ id: "cup", param: "y", min: 0.2, max: 0.5 }] }
	const sc = solve(shelf).scene
	const b = safeKnobs(shelf, sc)
	assert.equal(b.knobs.length, 1)
	assert.equal(b.knobs[0].id, "shelf")
	const d = sc.items.find((i) => i.id === "shelf").y - sc.items.find((i) => i.id === "cup").y
	assert.ok(Math.abs(b.knobs[0].min - (0.2 + d)) < 1e-9 && Math.abs(b.knobs[0].max - (0.5 + d)) < 1e-9)
	// a hung box holds itself up: its height knob stays
	const hung = { title: "t", items: [{ id: "bx", type: "box", place: { on: "air", x: 1, y_m: 0.5 } }], tune: [{ id: "bx", param: "y", min: 0.3, max: 0.6 }] }
	assert.equal(safeKnobs(hung, solve(hung).scene).knobs[0].id, "bx")
})

test("check mode: the scene on screen is checked again without planning; an edit's inherited notes are not shown as its own", async () => {
	const base = solve(rube()).scene
	const log = []
	const r = await createOrchestrator({ api: mockApi({ refine: { done: true, score_0_10: 9, patches: [] } }, log) }).build({ mode: "check", text: "a ball rolls into dominoes", scene: base }).result
	assert.equal(r.mode, "check")
	assert.deepEqual(log.map((l) => l.step), ["refine"])
	assert.deepEqual([log[0].payload.round, log[0].payload.rounds], [1, 1])
	assert.equal(r.score, 9)
	const withNotes = { ...rube(), notes: "The ball rolls 2 m and drops into the cup.", assumptions: ["a 1 m ramp"] }
	const e = await createOrchestrator({ api: mockApi({ edit: { mode: "patch", reply: "Done.", patches: [{ op: "set_props", id: "row", props: { count: 8 } }] }, refine: { done: true, score_0_10: 8, patches: [] } }) })
		.build({ text: "eight dominoes", mode: "edit", scene: solve(withNotes).scene, plan: withNotes, planScene: solve(withNotes).scene }).result
	assert.equal(e.howItWorks, null, "the old plan's account is not this edit's")
	assert.deepEqual(e.assumptions, [])
	assert.match(e.happened, /^In the run: /)
})

test("wording: lengths and props with their units, moves as directions, the run told from its own events", () => {
	assert.equal(fmtLen(0.0042), "4.2 mm")
	assert.equal(fmtLen(-0.045), "4.5 cm")
	assert.equal(fmtLen(0.3548), "35 cm")
	assert.equal(fmtLen(1.254), "1.25 m")
	assert.equal(propChange("steel-ball", "diameter", 0.1, 0.2), "diameter 10 → 20 cm")
	assert.equal(propChange("plank", "legs", true, false), "legs under it: off")
	const a = solve(rube()).scene
	const b = JSON.parse(JSON.stringify(a))
	const cup = b.items.find((i) => i.id === "cup")
	cup.x += 0.3548
	cup.y -= 0.15
	b.items.find((i) => i.id === "ball").x += 0.0004 // under 1 mm: not a change
	assert.deepEqual(describeDiff(a, b), ["Cup moved 35 cm right and 15 cm down"])
	// the whole layout shifted to stay on the table: said once; what moved differently is said on its own
	const c = JSON.parse(JSON.stringify(a))
	for (const it of c.items) if (it.type !== "table" && !(it.type === "wall" && it.props?.invisible_in_3d)) it.x -= 0.09
	c.items.find((i) => i.id === "cup").x += 0.1
	c.items.find((i) => i.id === "row").props = { ...c.items.find((i) => i.id === "row").props, count: 8 }
	assert.deepEqual(describeDiff(a, c), ["Dominoes: count 6 → 8", "Cup moved 1 cm right", "Everything else moved 9 cm left (the layout was shifted to stay on the table)"])
	const sim = { summary: { goals: [{ label: "Ball in the cup", ok: false }], stories: [{ item: "row", name: "Dominoes", text: "4 of 40 fall", ok: false, moved_at: 1 }], events: [{ t: 0.61, a: "ball", b: "ramp", text: "Ball hits Ramp" }, { t: 1.2, a: "ball", b: "table", text: "Ball hits Table" }, { t: 1.94, a: "ball", b: "row", text: "Ball hits Dominoes" }] } }
	assert.equal(describeRun(sim, a), "In the run: Ball hits Ramp (0.61 s) → Ball hits Dominoes (1.94 s). Dominoes: 4 of 40 fall.")
	assert.deepEqual(runProblems(sim), ["Not met: Ball in the cup", "Dominoes: only 4 of 40 fall"])
	assert.deepEqual(lostStages({ summary: { stories: [{ item: "row", name: "Dominoes", text: "12 of 12 fall", ok: true }] } }, { summary: { stories: [{ item: "row", name: "Dominoes", text: "3 of 12 fall", ok: false }] } }), ["Dominoes: 3 of 12 fall (was 12 of 12 fall)"])
})

test("a 'done' verdict with something still floating gets one more round (the critic is told); the report says what floats", async () => {
	// (a loose box under the whole funnel: the solver can't stand posts under its rim, so it still floats)
	const plan = { title: "Funnel", seconds: 2, items: [
		{ id: "funnel", type: "funnel", name: "Funnel", place: { on: "air", x: 1.2, y_m: 0.45 } },
		{ id: "cup", type: "cardboard-box", name: "Box", props: { width: 0.55, height: 0.1 }, place: { on: "table", x: 1.2 } },
		{ id: "m", type: "glass-marble", held: true, place: { on: "air", x: 1.2, y_m: 0.7 } }
	], goals: [], tune: [] }
	const log = []
	const r = await createOrchestrator({ api: mockApi({ plan, refine: { done: true, score_0_10: 8, issues: [], patches: [] } }, log) }).build({ text: "a marble through a funnel into a cup" }).result
	const calls = log.filter((l) => l.step === "refine")
	assert.equal(calls.length, 2, "asked once more")
	assert.ok(calls[1].payload.sim.warnings.some((w) => /Not done yet: Nothing holds Funnel up/.test(w.text)), "told what floats")
	assert.ok(calls[0].payload.sim.warnings.some((w) => /placing: Nothing holds Funnel up/.test(w.text)), "the first look already had the solver's warning")
	assert.equal(r.refine[0].continued?.length > 0, true)
	assert.ok(r.problems.some((p) => /^Nothing holds Funnel up: it floats/.test(p)), JSON.stringify(r.problems))
})

// ================================================================ round 2 (ai2-client): goal kinds, quick edits, picture coverage, live preview, busy queue
test("goal kinds: a 'falls' goal is checked on the run itself (every domino of the row), with what the run shows", async () => {
	const plan = { ...rube(), goals: [{ kind: "falls", items: ["row"], label: "all the dominoes fall" }, { kind: "hits", item: "ball", target: "row", label: "the ball hits the dominoes" }] }
	const r = await createOrchestrator({ api: mockApi({ plan, refine: { done: true, score_0_10: 9, patches: [] } }) }).build({ text: "x" }).result
	const falls = r.goals.find((g) => g.kind === "falls")
	assert.ok(falls && typeof falls.ok === "boolean", JSON.stringify(r.goals))
	assert.match(falls.detail, /of \d+ (tipped over|fell)/)
	const hits = r.goals.find((g) => g.kind === "hits")
	assert.equal(hits.ok, true, JSON.stringify(hits))
	assert.equal(r.scene.goals.length, 0, "the scene itself carries only 'in' goals")
})

test("edits do exactly what was asked and run the physics once: no critic and no tuner, even when a goal breaks (the reply says what happens instead and a fix is looked for)", async () => {
	const base = solve(rube()).scene
	const log = []
	const edit = { mode: "patch", reply: "Done.", patches: [{ op: "set_props", id: "row", props: { count: 8 } }] }
	const q = await createOrchestrator({ api: mockApi({ edit, refine: { done: true, score_0_10: 8, patches: [] } }, log) }).build({ text: "eight dominoes", mode: "edit", scene: base }).result
	assert.deepEqual(log.map((l) => l.step), ["edit"], "no critic")
	assert.equal(q.quick, true)
	assert.equal(q.scoreState, "quick")
	assert.equal(q.score, null)
	assert.equal(q.edit.changes[0], "Dominoes: count 6 → 8")
	assert.equal(q.tune, null, "no tuner")
	const log2 = []
	const c = await createOrchestrator({ api: mockApi({ edit, refine: { done: true, score_0_10: 8, patches: [] } }, log2) }).build({ text: "eight dominoes, and check it", mode: "edit", scene: base }).result
	assert.deepEqual(log2.map((l) => l.step), ["edit"], "the critic is the card's own “Check it”, never automatic")
	assert.equal(c.quick, true)
	// a goal that worked before the edit and fails after it: still one run, and the reply says what happens instead
	const dp = dropPlan(1.5)
	const s0 = solve(dp)
	const sim0 = await simulate(s0.scene)
	assert.equal(sim0.summary.goals[0].ok, true)
	const log3 = []
	const events = []
	const g = await createOrchestrator({ api: mockApi({ edit: { mode: "patch", reply: "Moved.", patches: [{ op: "move", id: "box", x: 2.6 }] }, refine: { done: true, score_0_10: 6, patches: [] } }, log3) })
		.build({ text: "move the box to the far right", mode: "edit", scene: s0.scene, plan: dp, planScene: s0.scene, sim: sim0 }, { onEvent: (e) => events.push(e) }).result
	assert.deepEqual(log3.map((l) => l.step), ["edit"], "no critic for a broken goal either")
	assert.equal(events.filter((e) => e.type === "step" && e.step === "simulate" && e.state === "done").length, 1, "the physics ran once")
	assert.equal(g.fixNeeded, true)
	assert.ok(g.fixCtx, "the panel gets what it needs to look for a fix")
	assert.equal(g.targets[0].was, true)
	assert.equal(g.lead, "Done, but now the modelling clay ball comes down 1.01 m left of the open box ✗.")
	assert.deepEqual(g.human, ["moved the open box 1.1 m right"], "(the change is the card's list, right under the lead)")
	assert.equal(log3[0].payload.sim, undefined, "no run is sent: the server runs the scene itself (§14.1)")
	assert.deepEqual(log3[0].payload.plan, dp, "the plan, while the scene on screen is still its result")
})

test("an edit that answers undo is a reply, nothing rebuilt; an edit with no visible effect says so", async () => {
	const base = solve(rube()).scene
	const u = await createOrchestrator({ api: mockApi({ edit: { mode: "patch", reply: "Press Undo to go back.", patches: [], undo: true } }) }).build({ text: "put it back", mode: "edit", scene: base }).result
	assert.equal(u.replyOnly, true)
	assert.equal(u.undo, true)
	const same = await createOrchestrator({ api: mockApi({ edit: { mode: "patch", reply: "Done.", patches: [{ op: "set_props", id: "row", props: { count: 6 } }] } }) }).build({ text: "six dominoes", mode: "edit", scene: base }).result
	assert.equal(same.edit.noChange, true)
	assert.deepEqual(same.edit.changes, [])
})

test("pictures: objects the observation saw but the plan left out (or built too few of) get ONE targeted fix before the critic, and the report says what was matched", async () => {
	const img = { name: "photo.jpg", dataUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD", width: 1200, height: 900, thumb: "" }
	const observation = { objects: [{ label: "bricks", count: 4 }, { label: "steel ball", count: 1 }], relations: [], motion_story: [], view: { camera: "side" }, scale_hint: null, uncertain: [] }
	const plan = { title: "Bricks", seconds: 2, items: [
		{ id: "b1", type: "brick", place: { on: "table", x: 1 } },
		{ id: "b2", type: "brick", place: { on: "b1" } },
		{ id: "ball", type: "steel-ball", place: { on: "table", x: 0.5 } }
	], covers: [{ label: "bricks", ids: ["b1", "b2"] }, { label: "steel ball", ids: ["ball"] }], missing: [], goals: [], tune: [] }
	const log = []
	const r = await createOrchestrator({ api: mockApi({ observe: observation, plan, edit: { mode: "patch", reply: "Added two bricks.", patches: [{ op: "add", item: { id: "b3", type: "brick", place: { on: "b2" } } }, { op: "add", item: { id: "b4", type: "brick", place: { on: "b3" } } }] }, refine: { done: true, score_0_10: 9, patches: [] } }, log) })
		.build({ text: "like this", images: [img] }).result
	assert.deepEqual(log.map((l) => l.step), ["observe", "plan", "edit", "refine"])
	assert.match(log[2].payload.text, /shows 4 "bricks" but the scene builds 2 \(b1, b2\)/)
	assert.equal(r.scene.items.filter((i) => i.type === "brick").length, 4)
	assert.deepEqual(r.coverage.fixed, ["2 of the 4 “bricks” were built"])
	assert.deepEqual(r.coverage.remaining, [])
	assert.match(r.coverage.changes.join(" | "), /Added/)
	assert.ok(log[3].payload.observation, "the critic gets the observation as its checklist")
	assert.ok(Array.isArray(log[3].payload.sim.final), "and where things ended")
	// all accounted for: no fix call
	const log2 = []
	await createOrchestrator({ api: mockApi({ observe: { ...observation, objects: [{ label: "steel ball", count: 1 }] }, plan, refine: { done: true, score_0_10: 9, patches: [] } }, log2) }).build({ text: "like this", images: [img] }).result
	assert.deepEqual(log2.map((l) => l.step), ["observe", "plan", "refine"])
})

test("live preview: the first version is shown placed (before its run), then running; differences are reported up front", async () => {
	const events = []
	const plan = { ...rube(), differences: ["The ramp is shorter than asked so it fits"], assumptions: ["The whole machine is mirrored left to right: the seesaw only tilts one way", "Dominoes are 6 cm"] }
	const r = await createOrchestrator({ api: mockApi({ plan, refine: { done: true, score_0_10: 9, patches: [] } }) }).build({ text: "x" }, { onEvent: (e) => events.push(e) }).result
	const kinds = events.filter((e) => e.type === "draft" || (e.type === "step" && e.step === "simulate" && e.state === "active")).map((e) => (e.type === "draft" ? `draft:${e.stage ?? "run"}` : "simulate"))
	assert.deepEqual(kinds.slice(0, 3), ["draft:layout", "simulate", "draft:run"])
	assert.ok(events.find((e) => e.stage === "layout").scene.items.length > 3)
	assert.deepEqual(r.differences, ["The ramp is shorter than asked so it fits", "The whole machine is mirrored left to right: the seesaw only tilts one way"])
	assert.deepEqual(r.assumptions, ["Dominoes are 6 cm"], "the mirrored note is not buried in the assumptions")
	// a stand the solver added is a difference too
	const air = { title: "Cup", seconds: 1, items: [{ id: "cup", type: "cup", place: { on: "air", x: 1, y_m: 0.2 } }, { id: "b", type: "golf-ball", place: { on: "table", x: 0.4 } }], goals: [], tune: [] }
	const a = await createOrchestrator({ api: mockApi({ plan: air, refine: { done: true, score_0_10: 9, patches: [] } }) }).build({ text: "x" }).result
	assert.match(a.differences.join(" | "), /Nothing held Cup up in mid-air, so a wooden stand 20 cm tall was put under it/)
})

test("busy: Retry-After from the server's header is used, and a build waits for as long as the queue takes (it never fails for being busy)", async () => {
	let n = 0
	const events = []
	const busy = () => Object.assign(new Error("the AI is busy"), { status: 429, retryAfter: "0.01", body: { ok: false, code: "busy", retryable: true } })
	const r = await createOrchestrator({ api: mockApi({ plan: () => (++n <= 4 ? busy() : rube()), refine: { done: true, score_0_10: 9, patches: [] } }) }).build({ text: "x" }, { onEvent: (e) => events.push(e) }).result
	assert.equal(n, 5)
	assert.equal(r.score, 9)
	const waits = events.filter((e) => e.type === "wait" && e.state === "start")
	assert.equal(waits.length, 4)
	assert.ok(waits.slice(0, 3).every((w) => w.ms >= 400 && w.ms <= 700), `waits follow Retry-After (0.5 s at least): ${waits.map((w) => w.ms)}`)
	assert.ok(waits[3].ms >= 800 && waits[3].ms <= 1300, "and back off once it keeps being busy")
})

test("edit pictures go to the edit step itself (no observe)", async () => {
	const img = { name: "photo.jpg", dataUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD", width: 800, height: 600, thumb: "" }
	const log = []
	const base = solve(rube()).scene
	await createOrchestrator({ api: mockApi({ edit: { mode: "patch", reply: "ok", patches: [{ op: "set_props", id: "row", props: { count: 9 } }] } }, log) }).build({ text: "more dominoes like in this photo", mode: "edit", scene: base, images: [img] }).result
	assert.deepEqual(log.map((l) => l.step), ["edit"])
	assert.equal(log[0].payload.images.length, 1)
})

test("an edit that breaks a goal: a checked fix is found that keeps what was asked (the moved box stays put); a request that states the outcome gets the fix in the same edit", async () => {
	const dp = dropPlan(1.5)
	const s0 = solve(dp)
	const sim0 = await simulate(s0.scene)
	const ai = createOrchestrator({ api: mockApi({ edit: { mode: "patch", reply: "Moved.", patches: [{ op: "move", id: "box", x: 1.9 }] }, refine: { done: true, score_0_10: 8, patches: [] } }) })
	const r = await ai.build({ text: "move the box to x 1.9", mode: "edit", scene: s0.scene, plan: dp, planScene: s0.scene, sim: sim0 }).result
	assert.ok(Math.abs(r.scene.items.find((i) => i.id === "box").x - 1.9) < 1e-6)
	assert.equal(r.goals[0].ok, false, "exactly what was asked: the ball now misses")
	assert.equal(r.fixNeeded, true)
	const fr = await ai.findFix(r.fixCtx)
	assert.equal(fr.status, "found", JSON.stringify({ runs: fr.runs, near: fr.near?.words }))
	assert.ok(Math.abs(fr.fix.scene.items.find((i) => i.id === "box").x - 1.9) < 1e-6, "the box stays where it was put")
	assert.ok(fr.fix.results.every((x) => x.ok === true))
	assert.match(fr.fix.words.say, /^move the modelling clay ball \d+ cm right/, fr.fix.words.say)
	const info = fixInfo(fr, r.scene, fr.targets)
	assert.equal(info.state, "found")
	assert.equal(info.checked, "The ball lands in the box")
	assert.ok(JSON.parse(info.sceneJSON).items.length === r.scene.items.length)
	// the same change asked with its outcome ("…so it still lands in it"): the fix goes on the table with it, and the reply says both
	const log = []
	const o = await createOrchestrator({ api: mockApi({ edit: { mode: "patch", reply: "Moved.", patches: [{ op: "move", id: "box", x: 1.9 }] }, refine: { done: true, score_0_10: 8, patches: [] } }, log) })
		.build({ text: "move the box to x 1.9 so the ball still lands in it", mode: "edit", scene: s0.scene, plan: dp, planScene: s0.scene, sim: sim0 }).result
	assert.deepEqual(log.map((l) => l.step), ["edit"])
	assert.ok(o.fixApplied, "fixed as part of the edit")
	assert.ok(Math.abs(o.scene.items.find((i) => i.id === "box").x - 1.9) < 1e-6)
	assert.ok(o.goals.every((g) => g.ok === true), JSON.stringify(o.goals))
	assert.match(o.lead, /^Done, and I moved the modelling clay ball \d+ cm right( to line up with the open box| so it works) — the ball lands in the box ✓$/, o.lead)
	assert.equal(o.human[0], "moved the open box 40 cm right")
	assert.ok(o.timings.fix >= 0)
})

test("progress: while a model step runs, the server's word on it (queue place, then tokens) comes as ai-progress events; a server without the endpoint is asked no more", async () => {
	const base = mockApi({ plan: () => new Promise((res) => setTimeout(() => res(rube()), 2600)), refine: { done: true, score_0_10: 9, patches: [] } })
	let polls = 0
	const api = async (path, body, signal) => {
		if (String(path).startsWith("/api/ai/progress")) {
			polls++
			if (polls === 1) throw Object.assign(new Error("no such AI request (or it finished long ago)"), { status: 404, body: { ok: false, error: "no such AI request (or it finished long ago)" } })
			return polls === 2 ? { ok: true, state: "waiting", position: 2 } : { ok: true, state: "running", model: "m", attempt: 1, phase: "thinking", tokens: 120 * polls }
		}
		return base(path, body, signal)
	}
	const events = []
	await createOrchestrator({ api, progress: true }).build({ text: "x" }, { onEvent: (e) => events.push(e) }).result
	const pr = events.filter((e) => e.type === "ai-progress" && e.step === "plan")
	assert.ok(pr.length >= 1 && pr[0].state === "waiting" && pr[0].position === 2, JSON.stringify(pr))
	// a static host: 404 pages, never JSON: three misses and it stops for good
	let staticPolls = 0
	const api2 = async (path, body, signal) => {
		if (String(path).startsWith("/api/ai/progress")) {
			staticPolls++
			throw Object.assign(new Error("Not Found"), { status: 404 })
		}
		return base(path, body, signal)
	}
	const ai2 = createOrchestrator({ api: api2, progress: true })
	await ai2.build({ text: "x" }).result
	await ai2.build({ text: "x" }).result
	assert.equal(staticPolls, 3, "three misses in a row, then never again")
	await ai2.build({ text: "x" }).result
	assert.equal(staticPolls, 3)
})

test("a score beside a failing goal is at most 7 (and says why); 'done' while a goal fails gets one more round, the critic told which goal", async () => {
	const miss = { ...dropPlan(2.4), tune: [] } // the ball falls far from the box: the goal fails, no knobs
	const log = []
	const r = await createOrchestrator({ api: mockApi({ plan: miss, refine: { done: true, score_0_10: 9, issues: [], patches: [] } }, log) }).build({ text: "drop the ball into the box" }).result
	assert.equal(r.goals[0].ok, false)
	assert.equal(r.score, 7, "capped")
	assert.match(r.refine[0].capped, /scored it 9\/10, but a goal fails/)
	assert.equal(r.refine[0].rawScore, 9)
	const calls = log.filter((l) => l.step === "refine")
	assert.equal(calls.length, 2, "asked once more")
	assert.ok(calls[1].payload.sim.warnings.some((w) => /the goal “The ball lands in the box” FAILS/.test(w.text)))
	assert.match(r.refine[0].continued, /goal still fails/)
	// a met goal is not capped
	const ok = await createOrchestrator({ api: mockApi({ plan: dropPlan(1.5), refine: { done: true, score_0_10: 9, patches: [] } }) }).build({ text: "x" }).result
	assert.equal(ok.score, 9)
	assert.equal(ok.refine[0].capped, undefined)
})

test("an edit's 'What changed' is what went on the table: the asked change, and the fix when the request stated the outcome", async () => {
	const dp = dropPlan(1.5)
	const s0 = solve(dp)
	const sim0 = await simulate(s0.scene)
	const r = await createOrchestrator({ api: mockApi({ edit: { mode: "patch", reply: "Moved.", patches: [{ op: "move", id: "box", x: 1.9 }] } }) })
		.build({ text: "move the box to x 1.9 and make it work", mode: "edit", scene: s0.scene, plan: dp, planScene: s0.scene, sim: sim0 }).result
	const all = r.edit.changes.join(" | ")
	assert.match(all, /Open box (and Modelling clay ball )?moved 40 cm right/, all)
	assert.match(all, /Modelling clay ball moved \d+ cm right|Open box and Modelling clay ball moved/, all)
	assert.equal(r.edit.firstScene, undefined)
	assert.equal(r.edit.unchanged.of, 2)
})

// ================================================================ repair (ai2-client, after the verifier): quick edits that change the run, whole-plan edits,
// the knobs an edit set, one item's own hits, grown goals, renamed goals, things passing through each other, which version each check judged
import { runChanges, innerHits } from "../orchestrator.js"
const blocksPlan = () => ({
	...dropPlan(1.5),
	items: [
		...dropPlan(1.5).items,
		{ id: "base", type: "wooden-block", name: "Base block", place: { on: "table", x: 0.5 } },
		{ id: "top", type: "wooden-block", name: "Top block", place: { on: "base" } },
		{ id: "g", type: "golf-ball", name: "Golf ball", held: true, place: { on: "air", x: 0.5, y_m: 0.6 } }
	],
	tune: []
})

test("repair: an edit that changes hits between things it left alone is still one run (no critic); the reply's facts come from the run", async () => {
	const p = blocksPlan()
	const s0 = solve(p)
	const sim0 = await simulate(s0.scene)
	assert.equal(sim0.summary.goals[0].ok, true)
	const log = []
	const r = await createOrchestrator({ api: mockApi({ edit: { mode: "patch", reply: "Removed it.", patches: [{ op: "remove", id: "top" }] }, refine: { done: true, score_0_10: 8, patches: [] } }, log) })
		.build({ text: "take the top block away", mode: "edit", scene: s0.scene, plan: p, planScene: s0.scene, sim: sim0 }).result
	assert.deepEqual(log.map((l) => l.step), ["edit"])
	assert.equal(r.quick, true)
	assert.match(r.happened, /Golf ball hits Base block/, r.happened)
	// the same scene with nothing changed in its run (only the goal's box made wider): the goal still happens, as before
	const log2 = []
	const q = await createOrchestrator({ api: mockApi({ edit: { mode: "patch", reply: "Wider.", patches: [{ op: "set_props", id: "box", props: { width: 0.3 } }] } }, log2) })
		.build({ text: "make the box a little wider", mode: "edit", scene: s0.scene, plan: p, planScene: s0.scene, sim: sim0 }).result
	assert.deepEqual(log2.map((l) => l.step), ["edit"])
	assert.equal(q.lead, "Done — the ball lands in the box, as before ✓")
	assert.deepEqual(q.human, ["made the open box wider (width 26 → 30 cm)"])
	assert.equal(q.fixNeeded, undefined)
})

test("repair: runChanges sees a falls goal's count drop (a goal that failed before and fails after is still worse), and new or lost hits", async () => {
	const p = { ...rube(), items: [...rube().items, { id: "far", type: "domino-row", name: "Far dominoes", props: { count: 6, first_height: 0.06 }, place: { on: "table", x: 2.3 } }], goals: [{ kind: "falls", items: ["row", "far"], label: "All twelve dominoes fall" }] }
	const a = solve(p)
	const simA = await simulate(a.scene)
	const pb = applyPatches(p, [{ op: "remove", id: "ball" }]).plan
	const b = solve(pb)
	const simB = await simulate(b.scene)
	const rc = runChanges(simA, simB, a.scene, b.scene, b.goals)
	assert.ok(rc.worse.some((w) => /All twelve dominoes fall: \d+ → 0 of 12 fell/.test(w)), JSON.stringify(rc))
	assert.deepEqual(runChanges(simA, simA, a.scene, a.scene, a.goals), { contacts: [], worse: [], better: [] }, "a run against itself: nothing")
})

test("an edit never replaces the scene on screen: a 'new scene' answer (or a whole plan of other things) changes nothing and says to use New; a whole plan that keeps the scene gets the critic's full rounds", async () => {
	const base = solve(rube()).scene
	for (const edit of [{ mode: "new", reply: "Building a new scene: a ball dropped into a box.", why: "a different setup" }, { mode: "plan", reply: "A new scene.", plan: dropPlan(1.5) }]) {
		const log = []
		const r = await createOrchestrator({ api: mockApi({ edit, refine: { done: true, score_0_10: 8, patches: [] } }, log) }).build({ text: "how about a ball dropped into a box?", mode: "edit", scene: base }).result
		assert.equal(r.replyOnly, true)
		assert.equal(r.suggestNew, true)
		assert.match(r.reply, /a whole new scene, so I left this one as it is: Edit with AI only changes the scene on screen/)
		assert.deepEqual(log.map((l) => l.step), ["edit"])
		assert.equal(log[0].payload.intent, "edit", "the edit step is told it is an edit")
	}
	// a whole plan that keeps the scene's things (a big change of this scene): built, and run once like any edit
	const keep = { ...rube(), items: rube().items.map((i) => (i.id === "row" ? { ...i, props: { ...i.props, count: 9 } } : i)) }
	const log = []
	const r = await createOrchestrator({ api: mockApi({ edit: { mode: "plan", reply: "Rebuilt.", plan: keep }, refine: { done: true, score_0_10: 8, patches: [] } }, log) }).build({ text: "rebuild it with nine dominoes", mode: "edit", scene: base, plan: rube(), planScene: base }).result
	assert.equal(r.replyOnly, undefined)
	assert.equal(r.scene.items.find((i) => i.id === "row").props.count, 9)
	assert.deepEqual(log.map((l) => l.step), ["edit"])
	// and a new scene asks the planner with intent "new" (the scene on screen is not sent)
	const log2 = []
	await createOrchestrator({ api: mockApi({ plan: rube(), refine: { done: true, score_0_10: 9, patches: [] } }, log2) }).build({ text: "a ramp and dominoes", scene: base }).result
	assert.equal(log2[0].payload.intent, "new")
	assert.equal(log2[0].payload.scene, undefined)
})

test("repair: the tuner keeps only what an edit set: a cup made bigger may still be moved; a moved one stays put (and the notes say which)", async () => {
	const p = { ...dropPlan(1.9), tune: [{ id: "box", param: "x", min: 1.0, max: 2.4 }] }
	const s = solve(p)
	const sim = await simulate(s.scene)
	assert.equal(sim.summary.goals[0].ok, false)
	const propsOnly = await tune({ plan: p, scene: s.scene, sim, exclude: new Map([["box", new Set(["width"])]]), simulate })
	assert.ok(propsOnly.knobs.some((k) => k.id === "box" && k.param === "x"), "its place may still be tuned")
	assert.ok(propsOnly.runs > 0)
	assert.doesNotMatch(propsOnly.skipped.join(" "), /kept where you put it/)
	const placed = await tune({ plan: p, scene: s.scene, sim, exclude: new Map([["box", new Set(["place"])]]), simulate })
	assert.equal(placed.knobs.length, 0)
	assert.equal(placed.runs, 0)
	assert.match(placed.skipped.join(" "), /Open box kept where you put it/)
	// (a Set of ids, as before: every knob of those items)
	const all = await tune({ plan: p, scene: s.scene, sim, exclude: new Set(["box"]), simulate })
	assert.equal(all.knobs.length, 0)
})

test("repair: one item's own parts striking each other (a Newton's cradle) are told, never 'moves but hits nothing'", async () => {
	const sc = JSON.parse(readFileSync(new URL("../../scenarios/newtons-cradle.json", import.meta.url)))
	const sim = await simulate(sc)
	const inner = innerHits(sim)
	assert.ok((inner.get("cradle")?.n ?? 0) >= 2, JSON.stringify([...inner]))
	const words = describeRun(sim, sc)
	assert.match(words, /Newton's cradle: its balls strike each other \d+ times \(first at [\d.]+ s\)/, words)
	assert.doesNotMatch(words, /hits nothing/)
})

test("repair: a goal that grows (6 blocks to 10) is one goal changed, not a 'New goal' and a 'Goal dropped' with one name", async () => {
	const blocks = (n) => Array.from({ length: n }, (_, i) => ({ id: `b${i + 1}`, type: "wooden-block", place: i ? { on: `b${i}` } : { on: "table", x: 1.5 } }))
	const p = { title: "Tower", seconds: 2, items: blocks(6), goals: [{ kind: "falls", items: ["b1", "b2", "b3", "b4", "b5", "b6"], label: "The whole tower falls" }], tune: [] }
	const s0 = solve(p)
	const patches = [...blocks(10).slice(6).map((item) => ({ op: "add", item })), { op: "set_goals", goals: [{ kind: "falls", items: blocks(10).map((b) => b.id), label: "The whole tower falls" }] }]
	const r = await createOrchestrator({ api: mockApi({ edit: { mode: "patch", reply: "Taller.", patches }, refine: { done: true, score_0_10: 8, patches: [] } }) })
		.build({ text: "make the tower 10 blocks tall", mode: "edit", scene: s0.scene, plan: p, planScene: s0.scene }).result
	const all = r.edit.changes.join(" | ")
	assert.match(all, /Goal “The whole tower falls” now covers 10 wooden blocks \(was 6\)/, all)
	assert.doesNotMatch(all, /New goal|Goal dropped/)
})

test("repair: a swapped type renames the goals about it ('the bowling ball hits…' -> 'the tennis ball hits…')", () => {
	const plan = { title: "x", items: [{ id: "ball", type: "bowling-ball", name: "Bowling ball", place: { on: "table", x: 0.5 } }, { id: "box", type: "box", place: { on: "table", x: 2 } }], goals: [{ kind: "hits", item: "ball", target: "box", label: "The bowling ball hits the box" }], tune: [] }
	const r = applyPatches(plan, [{ op: "replace_type", id: "ball", type: "tennis-ball" }])
	assert.equal(r.plan.goals[0].label, "The tennis ball hits the box")
})

test("repair: things passing through each other (the critic says so, however small it calls it) cap the score at 6 and are not 'done' while rounds are left", async () => {
	const log = []
	let n = 0
	const critic = () => (++n === 1 ? { done: true, score_0_10: 8, issues: [{ severity: "low", text: "The top ramp's legs go down through the bottom ramp (a cosmetic flaw)." }], patches: [] } : { done: true, score_0_10: 9, issues: [], patches: [] })
	const r = await createOrchestrator({ api: mockApi({ plan: dropPlan(1.5), refine: critic }, log) }).build({ text: "a ball into a box" }).result
	assert.equal(r.refine[0].score, 6)
	assert.match(r.refine[0].capped, /through each other/)
	assert.match(r.refine[0].continued, /passes through/)
	const calls = log.filter((l) => l.step === "refine")
	assert.equal(calls.length, 2, "asked once more")
	assert.ok(calls[1].payload.sim.warnings.some((w) => /Not done yet: The top ramp's legs go down through the bottom ramp/.test(w.text)))
	assert.equal(r.score, 9, "the next check found nothing: its own score")
	// motion through things is no pass-through
	const r2 = await createOrchestrator({ api: mockApi({ plan: dropPlan(1.5), refine: { done: true, score_0_10: 9, issues: ["The marble passes through the funnel into the cup as planned"], patches: [] } }) }).build({ text: "x" }).result
	assert.equal(r2.score, 9)
})

test("repair: each check says which version it judged and the report which one is on the table (a check of an undone version is told apart)", async () => {
	let n = 0
	const critic = () =>
		++n === 1
			? { done: false, score_0_10: 7, issues: ["move the ball"], patches: [{ op: "move", id: "ball", x: 2.6 }] }
			: { done: false, score_0_10: 4, issues: ["the ball misses the box now"], patches: [{ op: "move", id: "ball", x: 2.7 }] }
	// (physics first would undo both changes, each loses the goal: this is about the bookkeeping, so it runs without it)
	const r = await createOrchestrator({ api: mockApi({ plan: { ...dropPlan(1.5), tune: [] }, refine: critic }) }).build({ text: "drop the ball in the box" }, { stageTune: false }).result
	assert.ok(Number.isInteger(r.version))
	assert.equal(r.refine[0].version, r.version, "the first check judged the version on the table")
	assert.ok(r.refine.slice(1).some((x) => x.version !== r.version), JSON.stringify(r.refine.map((x) => [x.round, x.version, x.score])))
})

// ================================================================ the user's regression set (2026-10-15): edits of the starter machine change what was asked, and
// nothing else (every untouched item byte for byte as it was); what had to move to make room is said
const starter = () => JSON.parse(readFileSync(new URL("../../scenarios/rube-goldberg.json", import.meta.url)))
async function editStarter(patches, text) {
	const scene = starter()
	const sim = await simulate(scene)
	const log = []
	const r = await createOrchestrator({ api: mockApi({ edit: { mode: "patch", reply: "Done.", patches }, refine: { done: true, score_0_10: 8, issues: [], patches: [] } }, log) })
		.build({ text, mode: "edit", scene, sim }).result
	const before = new Map(scene.items.map((i) => [i.id, JSON.stringify(i)]))
	// (the invisible safety walls stand at the table's ends: they follow a widened table, which the card says)
	const changed = r.scene.items.filter((i) => before.get(i.id) !== JSON.stringify(i) && !(i.type === "wall" && i.props?.invisible_in_3d)).map((i) => i.id)
	const gone = [...before.keys()].filter((id) => !r.scene.items.some((i) => i.id === id))
	return { r, scene, changed, gone, log }
}
const named = (r, id) => {
	const it = r.scene.items.find((i) => i.id === id)
	return it?.name ?? id
}

test("starter: 'replace the yellow ball with a tennis ball and the red ball with a basketball' changes those two balls only (the basketball keeps the red ball's place: its bottom where the red ball's was)", async () => {
	const { r, scene, changed, gone, log } = await editStarter([{ op: "replace_type", id: "ball2", type: "tennis-ball" }, { op: "replace_type", id: "ball1", type: "basketball" }], "replace the yellow ball with a tennis ball and the red ball with a basketball")
	assert.equal(log[0].payload.intent, "edit")
	assert.deepEqual(gone, [])
	assert.deepEqual(changed.sort(), ["ball1", "ball2"], `only the two balls changed: ${changed}`)
	const b1 = r.scene.items.find((i) => i.id === "ball1")
	const was = scene.items.find((i) => i.id === "ball1")
	assert.equal(b1.type, "basketball")
	assert.equal(b1.x, was.x, "same place along the table")
	assert.equal(b1.held, true, "still held until the release (same role)")
	const rad = (t, p = {}) => itemGeometryOf(t, p)
	near(b1.y - rad("basketball"), was.y - rad("superball"), 1e-6, "its lowest point stays where the red ball's was")
	assert.equal(r.scene.items.find((i) => i.id === "ball2").type, "tennis-ball")
	assert.ok(r.edit.changes.some((c) => /Ball 1|Basketball/.test(c)) && r.edit.changes.some((c) => /tennis/i.test(c)), r.edit.changes.join(" | "))
	assert.equal(r.edit.unchanged.same, 5, JSON.stringify(r.edit.unchanged))
	assert.equal(r.edit.unchanged.of, 7)
})

test("starter: 'make the dominoes taller' changes the dominoes (and only what they now run into, said)", async () => {
	const { r, changed } = await editStarter([{ op: "set_props", id: "dominoes", props: { first_height: 0.13 } }], "make the dominoes taller")
	assert.ok(changed.includes("dominoes"))
	for (const id of changed.filter((x) => x !== "dominoes")) assert.ok(r.edit.changes.some((c) => c.includes(named(r, id))), `${id} changed but the card doesn't say so: ${r.edit.changes.join(" | ")}`)
	assert.equal(r.scene.items.find((i) => i.id === "dominoes").props.first_height, 0.13)
})

test("starter: 'move the box 10 cm left' moves the box only", async () => {
	const { r, scene, changed } = await editStarter([{ op: "move", id: "box", dx: -0.1 }], "move the box 10 cm left")
	assert.deepEqual(changed, ["box"])
	near(r.scene.items.find((i) => i.id === "box").x, scene.items.find((i) => i.id === "box").x - 0.1, 1e-6, "box x")
	assert.deepEqual(r.edit.changes, ["Box moved 10 cm left"])
})

test("starter: 'add 5 more dominoes' lengthens the row (and moves only what it runs into, said)", async () => {
	const { r, changed } = await editStarter([{ op: "set_props", id: "dominoes", props: { count: 12 } }], "add 5 more dominoes")
	assert.ok(changed.includes("dominoes"))
	assert.equal(r.scene.items.find((i) => i.id === "dominoes").props.count, 12)
	for (const id of changed.filter((x) => x !== "dominoes")) assert.ok(r.edit.changes.some((c) => c.includes(named(r, id))), `${id} changed but the card doesn't say so: ${r.edit.changes.join(" | ")}`)
})

test("starter: a check (or an edit with no effect) gives back the scene byte for byte", async () => {
	const scene = starter()
	const r = await createOrchestrator({ api: mockApi({ refine: { done: true, score_0_10: 8, patches: [] } }) }).build({ text: "check it", mode: "check", scene }).result
	assert.equal(JSON.stringify(r.scene.items), JSON.stringify(scene.items))
	const { changed } = await editStarter([{ op: "set_props", id: "dominoes", props: { count: 7 } }], "seven dominoes")
	assert.deepEqual(changed, [])
})

test("Edit with AI: patches that take most of the scene away and add other things are a new scene: nothing applied, New offered", async () => {
	const scene = starter()
	const patches = [...["ramp1", "ramp2", "dominoes", "seesaw", "ball2", "box", "ball1"].map((id) => ({ op: "remove", id })), { op: "add", item: { id: "cat", type: "spring-catapult", place: { on: "table", x: 0.5 } } }]
	const r = await createOrchestrator({ api: mockApi({ edit: { mode: "patch", reply: "Cleared it and built a catapult.", patches } }) }).build({ text: "start over: a catapult", mode: "edit", scene }).result
	assert.equal(r.replyOnly, true)
	assert.equal(r.suggestNew, true)
	// removing things alone is an edit
	const r2 = await createOrchestrator({ api: mockApi({ edit: { mode: "patch", reply: "Removed them.", patches: patches.slice(0, 5) }, refine: { done: true, score_0_10: 8, patches: [] } }) }).build({ text: "take most of it away", mode: "edit", scene }).result
	assert.notEqual(r2.replyOnly, true)
})

test("the reply: one sentence in a person's words with the run's real outcome; next edits from the AI kept", async () => {
	const { r } = await editStarter([{ op: "move", id: "box", dx: -0.1 }], "move the box 10 cm left")
	assert.equal(r.lead, "Done, but now the dominoes hit the box, so Ball 2 never moves ✗.")
	assert.deepEqual(r.human, ["moved the box 10 cm left"])
	const scene = starter()
	const sug = [{ label: "Make the box catch it", prompt: "Move the box so Ball 2 lands in it" }, { bad: 1 }]
	const q = await createOrchestrator({ api: mockApi({ edit: { mode: "patch", reply: "Lighter.", patches: [{ op: "replace_type", id: "ball2", type: "tennis-ball" }, { op: "set_props", id: "ball2", props: { wall: 0.0015 } }], suggestions: sug }, refine: { done: true, score_0_10: 8, patches: [] } }) })
		.build({ text: "make the yellow ball a light tennis ball", mode: "edit", scene, sim: await simulate(scene) }).result
	assert.deepEqual(q.suggestions, [{ label: "Make the box catch it", prompt: "Move the box so Ball 2 lands in it" }])
	// (a swap says before → after in real units: what each weighs as built, the thinner wall included)
	assert.match(q.human[0], /^swapped Ball 2 \(the hollow plastic ball\) for a tennis ball \(6\.3 g → \d+(\.\d)? g\)$/, q.human[0])
	assert.equal(q.planned, "Lighter.")
})

// ================================================================ edits after the fix search (2026-10-15): "make it work" never undoes what the person changed before
test("a follow-up 'make it work' keeps the change of the turn before (request.keep): the box moved there stays; without keep the box itself is moved under the ball", async () => {
	const dp = dropPlan(1.5)
	const s0 = solve(dp)
	const first = await createOrchestrator({ api: mockApi({ edit: { mode: "patch", reply: "Moved.", patches: [{ op: "move", id: "box", x: 1.9 }] } }) })
		.build({ text: "move the box to x 1.9", mode: "edit", scene: s0.scene, plan: dp, planScene: s0.scene, sim: await simulate(s0.scene) }).result
	assert.deepEqual(first.edit.touched.map((t) => t.slice(0, 2)), [["box", ["place-x"]]], "what the edit set is kept with the turn (moved along the table only: a fix may still raise it)")
	assert.equal(first.edit.touched[0][2].x, 1.5, "and where it stood before")
	const scene = first.scene
	const sim = await simulate(scene)
	const ask = (keep) =>
		createOrchestrator({ api: mockApi({ edit: { mode: "patch", reply: "Looking at it.", patches: [{ op: "set_props", id: "ball", props: {} }] } }) })
			.build({ text: "make it work", mode: "edit", scene, plan: first.plan, planScene: scene, sim, ...(keep ? { keep } : {}) }).result
	const kept = await ask(first.edit.touched)
	assert.ok(kept.fixApplied, kept.lead)
	assert.ok(Math.abs(kept.scene.items.find((i) => i.id === "box").x - 1.9) < 1e-6, "the box stays where the person put it")
	assert.ok(kept.goals.every((g) => g.ok === true))
	assert.equal(kept.edit.fixFlow.aimed, null, "a container the person placed is never aimed")
	// with nothing to keep, the box (the plain fix) may move: aimed alone at where the ball now comes down (§14.2 (6a))
	const free = await ask(null)
	assert.equal(free.edit.fixFlow.aimed?.id, "box", free.lead)
	assert.ok(Math.abs(free.scene.items.find((i) => i.id === "box").x - 1.9) > 0.05, "the box moved")
	assert.ok(free.goals.every((g) => g.ok === true))
	for (const it of scene.items) if (it.id !== "box") assert.deepEqual(free.scene.items.find((i) => i.id === it.id), it, `${it.id} untouched`)
})

// ================================================================ "the edit isn't automatically supposed to have it work" (the user, 2026-10-15): a plain change
// does what it names; what the edit step re-tuned beyond that is put back (a thing in the way is moved, the least that makes room, and said)
import { humanChanges, namedIn, editScope, leadSentence } from "../orchestrator.js"
const sceneOf = (id) => JSON.parse(readFileSync(new URL(`../../scenarios/${id}.json`, import.meta.url)))
async function editOf(id, patches, text, extra = {}) {
	const scene = sceneOf(id)
	const sim = await simulate(scene)
	const r = await createOrchestrator({ api: mockApi({ edit: { mode: "patch", reply: "Done.", patches, ...extra } }) }).build({ text, mode: "edit", scene, sim }).result
	const was = (i) => scene.items.find((x) => x.id === i)
	const now = (i) => r.scene.items.find((x) => x.id === i)
	return { r, scene, was, now }
}

test("a plain edit changes only what it names: the AI's extra changes are put back; a thing in the way is moved the least that makes room, and said", async () => {
	// (the live answer to "move the seesaw 10 cm left": it also moved the hanging box 10 cm and the dominoes 3 cm "so the ball can still land")
	const { r, was, now } = await editOf("rube-goldberg", [{ op: "move", id: "seesaw", dx: -0.1 }, { op: "move", id: "ball2", dx: -0.1 }, { op: "move", id: "box", dx: -0.1 }, { op: "set_props", id: "dominoes", props: { spacing: 0.54 } }], "move the seesaw 10 cm left")
	assert.equal(JSON.stringify(now("box")), JSON.stringify(was("box")), "the box is exactly where it was")
	assert.equal(now("dominoes").props.spacing ?? 0.568, 0.568, "the dominoes keep their spacing (the default, as it was)")
	near(now("seesaw").x, was("seesaw").x - 0.1, 1e-4, "the seesaw moved as asked")
	assert.deepEqual(r.edit.leftAlone, ["the box"])
	assert.match(r.lead, /^Done, but now .+ ✗\.$/, r.lead)
	assert.match(r.human.join(" | "), /^moved the seesaw \(with Ball 2 on it\) 10 cm left \| moved the dominoes \d(\.\d)? cm left to make room$/, r.human.join(" | "))
	assert.deepEqual(r.edit.touched.map(([id]) => id).sort(), ["ball2", "seesaw"], "only the asked change is protected from the fix search")
	// a request that states the outcome may change more (the edit step's way of making it work stays)
	const o = await editOf("rube-goldberg", [{ op: "move", id: "box", dx: 0.15 }, { op: "set_props", id: "seesaw", props: { tilt: 14 } }], "move the box 15 cm right so Ball 2 still lands in it")
	assert.equal(o.now("seesaw").props.tilt, 14)
	assert.equal(o.r.edit.leftAlone, undefined)
})

test("a plain edit: a named thing's own extra move is put back when nothing is in the way; the run's length too, unless asked", async () => {
	const b = await editOf("rube-goldberg", [{ op: "set_props", id: "box", props: { width: 0.16 } }, { op: "move", id: "box", dx: -0.06 }], "make the box 16 cm wide")
	near(b.now("box").x, b.was("box").x, 1e-6, "the box stays where it was")
	assert.equal(b.now("box").props.width, 0.16)
	assert.deepEqual(b.r.edit.leftAlone, ["the box’s place"])
	const c = await editOf("conveyor-delivery", [{ op: "set_props", id: "belt", props: { speed: 0.5 } }, { op: "set_scene", seconds: 8 }], "make the conveyor belt run half as fast")
	assert.equal(c.r.scene.seconds, 6)
	assert.deepEqual(c.r.edit.leftAlone, ["the run’s length (6 s)"])
	assert.match(c.r.lead, /^Done — /, c.r.lead)
	assert.deepEqual(c.r.human, ["made the conveyor belt slower (belt speed 1 → 0.5 m/s)"])
	const t = await editOf("conveyor-delivery", [{ op: "set_scene", seconds: 8 }, { op: "set_props", id: "belt", props: { speed: 0.9 } }], "make the conveyor belt a bit slower and run it for 8 seconds")
	assert.equal(t.r.scene.seconds, 8)
	// a scene with no safety walls gets none from an edit
	const s = await editOf("spring-launch", [{ op: "move", id: "cup", dx: -0.2 }], "move the cup 20 cm left")
	assert.ok(!s.r.scene.items.some((i) => i.type === "wall"), "no walls added")
	assert.match(s.r.lead, /^Done, but now the golf ball flies \d+ cm past the cup ✗\.$/, s.r.lead)
	assert.deepEqual(s.r.human, ["moved the cup 20 cm left"])
})

test("what a request names: by name, kind, id or a head word; colour or order words, outcomes and behaviours leave the request unscoped", () => {
	const r = sceneOf("rube-goldberg")
	assert.deepEqual([...namedIn("make ramp 1 steeper", r)], ["ramp1"])
	assert.deepEqual([...namedIn("make the ramps steeper", r)].sort(), ["ramp1", "ramp2"])
	assert.deepEqual([...namedIn("space the dominoes further apart", r)], ["dominoes"])
	assert.deepEqual([...namedIn("pull the launcher back only 3 cm", sceneOf("spring-launch"))], ["launcher"])
	assert.deepEqual([...editScope("move the seesaw 10 cm left", r).asked].sort(), ["ball2", "seesaw"], "what rides on it goes with it")
	for (const t of ["swap the yellow ball for a tennis ball", "make ball 2 fly higher", "move the box so Ball 2 still lands in it", "make the first domino taller", "make the ball heavier"]) assert.equal(editScope(t, r), null, t)
})

test("a rename is a change; an edit answered with a whole plan protects what it changed", async () => {
	const n = await editOf("rube-goldberg", [{ op: "set_item", id: "ball1", name: "Marble" }], "rename Ball 1 to Marble")
	assert.match(n.r.lead, /^Done — /, n.r.lead)
	assert.deepEqual(n.r.human, ["renamed Ball 1 to Marble"])
	const scene = sceneOf("rube-goldberg")
	const { planFromScene } = await import("../solver.js")
	const whole = planFromScene(scene)
	whole.items.find((i) => i.id === "box").place.x += 0.06
	const w = await createOrchestrator({ api: mockApi({ edit: { mode: "plan", reply: "Moved.", plan: whole } }) }).build({ text: "move the box 6 cm right", mode: "edit", scene, sim: await simulate(scene) }).result
	assert.deepEqual(w.edit.touched.map((t) => t.slice(0, 2)), [["box", ["place-x"]]])
})

test("wording: a pendulum pulled back less, a seesaw tilted, a deeper box, dominoes spaced in cm, riders said with what carries them, lengths by the figure shown", () => {
	const pd = sceneOf("pendulum-dominoes")
	const p2 = JSON.parse(JSON.stringify(pd))
	p2.items.find((i) => i.id === "pendulum").props.start_angle = -20
	assert.deepEqual(humanChanges(pd, p2), ["pulled the pendulum back less (55° → 20°)"])
	const r = sceneOf("rube-goldberg")
	const t = JSON.parse(JSON.stringify(r))
	t.items.find((i) => i.id === "seesaw").props.tilt = 15
	t.items.find((i) => i.id === "box").props.depth = 0.17
	t.items.find((i) => i.id === "dominoes").props.spacing = 0.65
	assert.deepEqual(humanChanges(r, t), ["spaced the dominoes further apart (first gap 5.6 → 6.4 cm)", "tilted the seesaw more (12.5° → 15°)", "made the box deeper (depth 12 → 17 cm)"])
	const cv = sceneOf("conveyor-delivery")
	const c2 = JSON.parse(JSON.stringify(cv))
	for (const id of ["belt", "ball1", "ball2", "ball3"]) c2.items.find((i) => i.id === id).x -= 0.2
	assert.deepEqual(humanChanges(cv, c2), ["moved the conveyor belt (with the golf balls on it) 20 cm left"])
	assert.equal(fmtLen(0.00999), "1 cm")
	assert.equal(fmtLen(0.9999), "1 m")
	// (an edit's lead is the outcome: the card lists the changes right under it, never twice)
	assert.equal(editLead({ changes: ["made the conveyor belt slower (belt speed 1 → 0.5 m/s)", "made it run 8 s instead of 6 s"], targets: [] }), "Done.")
	assert.equal(editLead({ changes: ["moved the seesaw 10 cm left", "moved the dominoes 3 cm left", "moved Ramp 2 1 cm left", "moved the box 10 cm left"], targets: [{ label: "Ball 2 lands in the box", ok: false, was: true, happened: "Ball 2 misses" }] }), "Done, but now Ball 2 misses ✗.")
	// (a check's own changes are said in one breath: past three, the rest are named, never "and 1 more change")
	assert.equal(leadSentence({ mode: "check", changes: ["moved the seesaw 10 cm left", "moved the dominoes 3 cm left", "moved Ramp 2 1 cm left", "moved the box 10 cm left"], who: ["the seesaw", "the dominoes", "Ramp 2", "the box"], goals: [{ label: "Ball 2 lands in the box", ok: false, was: true }] }), "I moved the seesaw 10 cm left, the dominoes 3 cm left and changed Ramp 2 and the box too — but now “Ball 2 lands in the box” fails ✗ Want me to fix it?")
})

test("a later edit keeps the person's earlier change, and its fix may still line the rest up with it ('move the box 10 cm left', then 'make the box 2 cm wider')", async () => {
	const scene = starter()
	const first = await createOrchestrator({ api: mockApi({ edit: { mode: "patch", reply: "Moved.", patches: [{ op: "move", id: "box", dx: -0.1 }] } }) }).build({ text: "move the box 10 cm left", mode: "edit", scene, sim: await simulate(scene) }).result
	const s1 = first.scene
	const second = await createOrchestrator({ api: mockApi({ edit: { mode: "patch", reply: "Wider.", patches: [{ op: "set_props", id: "box", props: { width: 0.28 } }] } }) }).build({ text: "make the box 2 cm wider", mode: "edit", scene: s1, plan: first.plan, planScene: s1, sim: await simulate(s1), keep: first.edit.touched }).result
	assert.equal(second.fixNeeded, true, second.lead)
	// (a number of runs as well as the time: never a result that depends on the load, V8843)
	const fr = await createOrchestrator({ api: mockApi({}) }).findFix(second.fixCtx, { budgetMs: 30000, minRuns: 400, hardMs: 150000 })
	assert.equal(fr.status, "found", JSON.stringify(fr.near?.words))
	near(fr.fix.scene.items.find((i) => i.id === "box").x, s1.items.find((i) => i.id === "box").x, 1e-9, "the box stays where the person moved it")
	assert.match(fr.fix.words.say, /to line up with the box/, fr.fix.words.say)
})

// ================================================================ round 3 (2026-10-15 night): physics first, the rate-only check, stages, refusals
import { plainError, refusalOf, quotaWords, resetWords, STAGE_MS } from "../orchestrator.js"
import { createStageTuner } from "../stage-tune.js"
import { atWhen } from "../access.js"

test("refusals the person must act on: sign in, today's allowance (with when it resets), no AI on this deployment; asked once, never 'Try again'", async () => {
	const err = (status, body) => Object.assign(new Error(body.error ?? `HTTP ${status}`), { status, body })
	const answering = (e) => {
		let n = 0
		return { api: async () => (n++, Promise.reject(e)), calls: () => n }
	}
	const a = answering(err(401, { ok: false, code: "sign_in", error: "Sign in with Google to use Build with AI", retryable: false, signIn: true }))
	await assert.rejects(createOrchestrator({ api: a.api }).build({ text: "x" }).result, (e) => e.kind === "sign_in" && e.message === "Sign in with Google to use AI" && e.retryable === false)
	assert.equal(a.calls(), 1, "a sign-in refusal is not asked again")
	const resetsAt = new Date(Date.now() + 3 * 3600e3).toISOString()
	const q = answering(err(403, { ok: false, code: "quota", error: "You've used today's Build with AI allowance. It resets at 00:00 UTC.", resetsAt, retryable: false }))
	await assert.rejects(createOrchestrator({ api: q.api }).build({ text: "x" }).result, (e) => e.kind === "quota" && e.resetsAt === resetsAt && e.scope === "user" && e.message === `You've used today's AI allowance — resets ${atWhen(resetWords(resetsAt))}`)
	assert.equal(q.calls(), 1)
	const site = refusalOf(err(403, { code: "site_quota", error: "Build with AI has reached today's limit for this site. It resets at 00:00 UTC.", resetsAt }))
	assert.equal(site.kind, "quota")
	assert.match(site.message, /^Today's AI allowance for this site is used up — resets (at|tomorrow at) /)
	assert.match(refusalOf(err(403, { code: "quota", error: "You've used this hour's Build with AI allowance. Try again after the hour.", resetsAt })).message, /^You've used this hour's AI allowance — resets (at|tomorrow at) /)
	// no AI on this deployment: the hosted function's not_configured, a static preview's 503, no function at all
	for (const e of [err(503, { ok: false, code: "not_configured", error: "the AI is not switched on for this deployment (no access configured)", retryable: false }), err(503, { ok: false, code: "unavailable", retryable: false, error: "this static preview has none" }), err(404, {})]) {
		const o = answering(e)
		await assert.rejects(createOrchestrator({ api: o.api }).build({ text: "x" }).result, (x) => x.kind === "off" && x.message === "AI isn't available on this deployment")
		assert.equal(o.calls(), 1)
	}
	assert.equal(refusalOf(err(403, { code: "not_allowed", error: "Build with AI is invite-only for now" })).kind, "access")
	assert.equal(refusalOf(err(401, { code: "unauthorized", error: "this page has no access to the AI (open the invite link again)" })).kind, "access")
	// a database or Clerk that can't be reached is not "no AI": it is retried once, as any failure worth retrying
	const down = answering(err(503, { ok: false, code: "unavailable", retryable: true, error: "Your account can't be reached right now. Try again." }))
	await assert.rejects(createOrchestrator({ api: down.api }).build({ text: "x" }).result, (e) => e.kind === "gateway")
	assert.equal(down.calls(), 2)
	// plainError reads the server's code first
	assert.equal(plainError("Sign in with Google to use Build with AI", "plan", { code: "sign_in" }), "Sign in with Google to use AI")
	assert.match(plainError("x", "plan", { code: "quota", resetsAt }), /^You've used today's AI allowance — resets (at|tomorrow at) /)
	assert.equal(plainError("x", "plan", { code: "not_configured" }), "AI isn't available on this deployment")
	assert.match(quotaWords({ code: "quota" }), /resets at midnight UTC$/)
	assert.equal(resetWords("2026-10-16T00:00:00Z", Date.parse("2026-10-15T23:00:00Z")).length > 0, true)
	// a reset on another day of the person's clock: "resets tomorrow at 1:00 AM", never "resets at tomorrow at"
	const far = new Date(Date.now() + 30 * 3600e3).toISOString()
	assert.match(quotaWords({ code: "quota", resetsAt: far }), /— resets (tomorrow|[A-Z][a-z]+\.?) at \d/)
	assert.doesNotMatch(quotaWords({ code: "quota", resetsAt: far }), /resets at tomorrow/)
})

test("rate-only (§13.3): the final check of a version changed after the critic last saw it is rate_only; a round whose patches made every goal pass is rated first and ends the loop at 8+", async () => {
	const log = []
	let n = 0
	// round 1 moves the ball over the box (the goal passes); round 2 is a rating, 9 -> done without a full critique
	const plan = { ...dropPlan(1.5), tune: [] }
	const critic = (p) => (p.rate_only ? { score_0_10: 9, issues: [], rate_only: true } : ++n === 1 ? { done: false, score_0_10: 6, issues: ["make the box a little wider"], patches: [{ op: "set_props", id: "box", props: { width: 0.34 } }] } : { done: true, score_0_10: 8, issues: [], patches: [] })
	const r = await createOrchestrator({ api: mockApi({ plan, refine: critic }, log) }).build({ text: "drop the ball in the box" }).result
	const refines = log.filter((l) => l.step === "refine").map((l) => !!l.payload.rate_only)
	assert.deepEqual(refines, [false, true], "a full critique, then a rating of the patched version")
	assert.equal(r.score, 9)
	assert.equal(r.refine.length, 2)
	assert.equal(r.refine[1].done, true)
	// with one round only, the version its patches made gets a rate-only final check
	const log2 = []
	let m = 0
	const critic2 = (p) => (p.rate_only ? { score_0_10: 7, issues: [{ severity: "low", text: "the box is plain" }], rate_only: true } : ++m === 1 ? { done: false, score_0_10: 5, issues: ["wider box"], patches: [{ op: "set_props", id: "box", props: { width: 0.34 } }] } : { done: true, score_0_10: 9, issues: [], patches: [] })
	const r2 = await createOrchestrator({ api: mockApi({ plan, refine: critic2 }, log2) }).build({ text: "drop the ball in the box" }, { refineRounds: 1 }).result
	assert.deepEqual(log2.filter((l) => l.step === "refine").map((l) => !!l.payload.rate_only), [false, true])
	assert.equal(r2.refine.at(-1).final, true)
	assert.equal(r2.refine.at(-1).done, false, "a rating below 8 is not done")
	assert.equal(r2.score, 7)
})

test("stages (§13.2): a plan's stages are tuned with their own knobs before the critic, and the card gets each stage checked on the final run", async () => {
	const plan = { ...dropPlan(1.25), tune: [], stages: [{ label: "The ball drops into the box", does: "falls straight into the open box", items: ["ball", "box"], check: { kind: "in", item: "ball", container: "box" }, tune: [{ id: "ball", param: "x", min: 1.0, max: 2.0 }] }] }
	const log = []
	const r = await createOrchestrator({ api: mockApi({ plan, refine: { done: true, score_0_10: 9, issues: [], patches: [] } }, log) }).build({ text: "x" }).result
	assert.ok(r.stageTune.kept, JSON.stringify(r.stageTune))
	assert.equal(r.stageTune.stages[0].passed, true)
	assert.equal(r.stageTune.after.checks.split("/")[0], r.stageTune.after.checks.split("/")[1])
	assert.deepEqual(r.stages.map((s) => [s.stage, s.label, s.ok]), [[1, "The ball drops into the box", true]])
	// the stage's own knob turned the ball (no plan.tune at all)
	assert.ok(Math.abs(r.scene.items.find((i) => i.id === "ball").x - 1.25) > 0.02)
})

test("the critic is told the first stage that still fails after the stage tuner, with what the run shows and what was tried; a change that loses a passing check is undone", async () => {
	// a ball 1.3 m from the box: nothing the tuner may turn reaches it
	const plan = { ...dropPlan(0.2), tune: [] }
	const log = []
	const r = await createOrchestrator({ api: mockApi({ plan, refine: { done: true, score_0_10: 6, issues: ["the ball misses the box"], patches: [] } }, log) }).build({ text: "drop the ball into the box" }, { refineRounds: 1 }).result
	// (the closest version it found, the ball and the box each 25 cm nearer, still misses: it is not adopted, the critic gets the plan as placed)
	assert.equal(r.stageTune.after.goals, "0/1")
	assert.ok(r.stageTune.runs > 0)
	assert.equal(r.stageTune.kept, false)
	assert.equal(r.stageTune.partial?.goals, "0/1")
	assert.match(r.stageTune.note, /not all, so the AI started from the plan as it was/)
	const sent = log.find((l) => l.step === "refine").payload.scene
	const planned = solve(plan).scene
	for (const id of ["ball", "box"]) assert.deepEqual(sent.items.find((i) => i.id === id), planned.items.find((i) => i.id === id), `${id} is where the plan put it`)
	const warn = log.find((l) => l.step === "refine").payload.sim.warnings.map((w) => w.text).join("\n")
	assert.match(warn, /A physics check of this version before your look/)
	assert.match(warn, /“The ball lands in the box”: FAILS/)
	assert.match(warn, /comes closest to/)
	assert.match(warn, /The tuner already tried \d+ runs turning/)
	assert.match(warn, /Fix “The ball lands in the box” first/)
})

test("the stage tuner judges candidates through evalRun (the fix workers) when given one, and the kept version is run again on the app's engine", async () => {
	let worker = 0
	const st = createStageTuner({
		solve: (p) => solve(p),
		simulate,
		evalRun: async (scene, goals, checks) => {
			worker++
			const { judgeRun } = await import("../stage-tune.js")
			return judgeRun(await simulate(scene), scene, goals, checks, goalDistance)
		},
		goalDistance,
		setKnob: (await import("../orchestrator.js")).setKnob,
		parallel: 4
	})
	const plan = dropPlan(1.2)
	const ev0 = await st.evaluate(plan, { full: true })
	assert.equal(ev0.f.goalsOk, 0)
	assert.ok(ev0.sim?.track, "a full evaluation keeps the whole run")
	const t = await st.stageTune(plan, { from: ev0, maxMs: STAGE_MS })
	assert.ok(worker > 0, "candidates went to evalRun")
	assert.equal(t.ev.f.goalsOk, 1)
	assert.equal(t.ev.sim, null, "a candidate judged in a worker carries no track")
	assert.equal(st.verified(t.ev), true)
	assert.deepEqual(st.lostChecks(t.ev, ev0), ["The ball lands in the box"])
})

// ================================================================ round 3 (round3-plan §4.2 (3)): what the replay of the stored n7 edit answers found the live application
// failing, against ai/experiments/edit/integrate/apply-edit.js v3 (ai/bench/tools/edit-apply-replay.mjs; partB/B/replay-verdict.md)
async function editWith(scene, patches, text, extra = {}) {
	const sim = await simulate(scene)
	const r = await createOrchestrator({ api: mockApi({ edit: { kind: "change", reply: "Done.", patches } }), progress: false }).build({ text, mode: "edit", scene, sim, ...extra }).result
	const changed = scene.items.filter((i) => JSON.stringify(r.scene.items.find((x) => x.id === i.id) ?? null) !== JSON.stringify(i)).map((i) => i.id)
	return { r, changed }
}

test("replay: an AI-built scene keeps the posts the solver stood a thing on (the funnel's stands), byte for byte, through an edit of something else", async () => {
	const plan = JSON.parse(readFileSync(new URL("./fixtures/c1-rube-cup.plan.json", import.meta.url)))
	const scene = solve(plan).scene
	assert.ok(scene.items.some((i) => i.id === "funnel-stand-left") && !plan.items.some((i) => i.id === "funnel-stand-left"), "(the solver's own posts)")
	const { r, changed } = await editWith(scene, [{ op: "move", id: "cup", dx: 0.1 }], "move the cup 10 cm right", { plan, planScene: scene })
	assert.deepEqual(changed, ["cup"])
	assert.deepEqual(r.human, ["moved the cup 10 cm right"])
	assert.equal(r.edit.unchanged.same, r.edit.unchanged.of - 1)
})

test("replay: what is held just above (≤ 6 cm) or rests on a moved thing goes with it by exactly that much (Ball 1 over Ramp 1; Ball 2 on the seesaw)", async () => {
	const scene = starter()
	const up = await editWith(scene, [{ op: "move", id: "ramp1", dy: 0.1 }], "raise ramp 1 by 10 cm")
	assert.deepEqual(up.changed.sort(), ["ball1", "ramp1"])
	const b1 = up.r.scene.items.find((i) => i.id === "ball1")
	const was = scene.items.find((i) => i.id === "ball1")
	near(b1.x, was.x, 1e-6, "ball 1 x")
	near(b1.y, was.y + 0.1, 1e-6, "ball 1 y")
	assert.equal(b1.held, true)
	assert.ok(!up.r.edit.madeRoom, "it went with the ramp: not moved to make room")
	const right = await editWith(scene, [{ op: "move", id: "seesaw", dx: 0.03 }], "move the seesaw 3 cm to the right")
	assert.deepEqual(right.changed.sort(), ["ball2", "seesaw"])
	const b2 = right.r.scene.items.find((i) => i.id === "ball2")
	const w2 = scene.items.find((i) => i.id === "ball2")
	near(b2.x, w2.x + 0.03, 1e-6, "ball 2 x: exactly the seesaw's 3 cm")
	near(b2.y, w2.y, 1e-6, "ball 2 y")
})

test("replay: the table, the stage and the safety walls stay as they were; a new thing put inside a safety wall is slid off it (the wider table only when holding them would make things start inside each other)", async () => {
	const scene = starter()
	const { r, changed } = await editWith(scene, [{ op: "add", item: { id: "box2", type: "box", name: "Box 2", props: { hung: false }, place: { on: "table", x: -0.38 } } }], "add a second box like the first one, on the table near the left wall")
	assert.deepEqual(changed, [], "every item on screen, the table and the walls included, byte for byte")
	assert.deepEqual(r.scene.stage, scene.stage)
	const box2 = r.scene.items.find((i) => i.id === "box2")
	assert.ok(box2.x > -0.38 + 0.01, `slid right, off the left wall: ${box2.x}`)
	assert.match(r.edit.slid?.[0] ?? "", /^Box 2 slid \d+(\.\d)? cm right, off the left safety wall$/)
	const { layout } = await import("../../sim/index.js")
	assert.deepEqual(layout(r.scene).warnings ?? [], [])
	// (two more dominoes push the seesaw (with Ball 2) to the table's end: held to the old table it would be shoved back into the row, so the
	// wider table stays, and the card says so)
	const more = await editWith(scene, [{ op: "set_props", id: "dominoes", props: { count: 8 } }], "add a domino")
	assert.ok(more.r.human.some((h) => /^widened the table to [\d.]+ m so everything fits$/.test(h)), more.r.human.join(" | "))
	assert.deepEqual(layout(more.r.scene).warnings ?? [], [])
})

// ================================================================ round 3's repair (15 Oct, late): what the acceptance runs found
import { lostGroups, humanChangeList } from "../orchestrator.js"
test("an AI-built scene: a swap keeps its seat (pend3: the tennis ball stays where the golf ball was, never put 33 cm left in the pendulum's path); where it doesn't fit, the overlap is said and the one repair turn is told", async () => {
	const { plan, scene } = JSON.parse(readFileSync(new URL("./fixtures/pend3-swap.json", import.meta.url)))
	const ans = { kind: "change", mode: "patch", targets: [{ says: "the golf ball", ids: ["golf"] }], why: "swap", reply: "Swapped.", suggestions: [], patches: [{ op: "replace_type", id: "golf", type: "tennis-ball" }], missing: [] }
	const log = []
	const r = await createOrchestrator({ api: mockApi({ edit: ans }, log), progress: false }).build({ text: "replace the golf ball with a tennis ball", mode: "edit", scene, plan, planScene: scene, sim: await simulate(scene), history: [] }).result
	const g0 = scene.items.find((i) => i.id === "golf")
	const g1 = r.scene.items.find((i) => i.id === "golf")
	assert.equal(g1.type, "tennis-ball")
	near(g1.x, g0.x, 1e-6, "the same x on the shelf")
	near(g1.y - itemGeometryOf("tennis-ball"), g0.y - itemGeometryOf("golf-ball"), 1e-5, "its bottom where the golf ball's was")
	assert.deepEqual(r.human, ["swapped the golf ball for a tennis ball (46 g → 58 g)"], "one line, real units; no move hidden in it")
	// (it starts touching the last domino: said first, and the one repair turn was asked; its answer was no better, so not kept)
	assert.deepEqual(log.map((l) => l.step), ["edit", "edit"])
	assert.match(log[1].payload.feedback, /^# A check of your last answer found problems\n[\s\S]*Ten dominoes start inside Tennis ball/)
	assert.deepEqual(r.edit.repair, { before: 1, after: 1, kept: false })
	assert.equal(r.issues[0].level, "warn")
	assert.match(r.issues[0].text, /Ten dominoes start inside Tennis ball/)
	assert.ok(r.solverIssues.some((i) => i.code === "seated" && i.item === "golf" && /would have moved it 33 cm left/.test(i.text)), "the solver's re-placement is never taken silently")
	// a move beyond the seat is always said, with why (the card's numbers are the scene's)
	const moved = JSON.parse(JSON.stringify(r.scene))
	moved.items.find((i) => i.id === "golf").x = 0.565835
	assert.deepEqual(humanChangeList(scene, moved, { why: new Map([["golf", "to clear Ten dominoes"]]) }).map((c) => c.text), ["swapped the golf ball for a tennis ball (46 g → 58 g)", "moved the tennis ball 33 cm left: it didn't fit where it was (to clear Ten dominoes)"])
})

test("swap lines: the person's own words with the name on screen, and before → after in real units", () => {
	const a = starter()
	const b = JSON.parse(JSON.stringify(a))
	Object.assign(b.items.find((i) => i.id === "ball2"), { type: "tennis-ball", name: "Tennis ball" })
	Object.assign(b.items.find((i) => i.id === "ball1"), { type: "basketball", name: "Basketball" })
	const says = [{ says: "the yellow ball", ids: ["ball2"] }, { says: "the red ball", ids: ["ball1"] }]
	assert.deepEqual(humanChangeList(a, b, { says }).map((c) => c.text).sort(), ["swapped the red ball for a basketball (102 g → 620 g)", "swapped the yellow ball for a tennis ball (6.3 g → 58 g)"])
	// (without words of their own, the name on screen and what it was)
	assert.deepEqual(humanChangeList(a, b).map((c) => c.text).sort(), ["swapped Ball 1 (the superball) for a basketball (102 g → 620 g)", "swapped Ball 2 (the hollow plastic ball) for a tennis ball (6.3 g → 58 g)"])
})

test("a built-in scene has no plan stages: a stack of bricks knocked down less is said in the heads-up (w-add-brick-top)", async () => {
	const scene = sceneOf("wrecking-ball")
	// (three more: since the engine repair of 19 Oct (web/CONTRACT.md) the scenario's bricks no longer walk before the ball comes, and with one
	// more on top 4 of 5 still fall, as without it)
	const more = [6, 7, 8].map((n) => ({ op: "add", item: { id: `brick${n}`, type: "brick", name: `Brick ${n}`, props: {}, place: { on: `brick${n - 1}` } } }))
	const { r } = await editWith(scene, more, "add three more bricks on top of the stack")
	assert.ok(r.edit.headsUp.includes("Bricks: 3 of 5 fall (was 4 of 5)"), JSON.stringify(r.edit.headsUp))
	const before = await simulate(scene)
	assert.deepEqual(lostGroups(before, before, scene, scene), [], "nothing lost against itself")
})

test("make it work never leaves the scene worse than it was: a working scene stays as it is, and the reply says it already works", async () => {
	const scene = starter()
	const log = []
	// (an answer that takes the very thing the goal is about away)
	const r = await createOrchestrator({ api: mockApi({ edit: { kind: "fix", reply: "Done.", patches: [{ op: "remove", id: "ball2" }] } }, log), progress: false }).build({ text: "make it work", mode: "edit", scene, sim: await simulate(scene), history: [{ role: "user", text: "make the dominoes twice as far apart" }, { role: "assistant", text: "Double the gaps with 4 dominoes, or keep 7 and widen the table?" }] }).result
	assert.equal(r.replyOnly, true, "nothing applied")
	assert.equal(r.scene, undefined)
	assert.equal(r.edit.kind, "fix")
	assert.equal(r.reply, "It already works: Ball 2 lands in the box ✓ — nothing changed.")
	assert.deepEqual(r.edit.reverted.lost, ["Ball 2 lands in the box"])
	assert.match(r.edit.reverted.tried.join(" | "), /removed Ball 2/)
})

test("a new scene whose things start inside each other says so first (the card's heads-up), never only in the view's ⚠", async () => {
	const plan = {
		title: "Two posts",
		seconds: 1,
		items: [
			{ id: "a", type: "wooden-block", name: "Left post", fixed: true, place: { on: "air", x: 1.0, y_m: 0, keep: true } },
			{ id: "b", type: "wooden-block", name: "Right post", fixed: true, place: { on: "air", x: 1.01, y_m: 0, keep: true } },
			{ id: "ball", type: "golf-ball", place: { on: "table", x: 1.6 } }
		],
		goals: []
	}
	const r = await createOrchestrator({ api: mockApi({ plan, refine: { done: true, score_0_10: 9, issues: [], patches: [] } }), progress: false }).build({ text: "two posts and a ball" }, { stageTune: false }).result
	assert.ok(r.sim.warnings.length > 0, "(the engine sees them)")
	assert.equal(r.issues[0].level, "warn")
	assert.equal(r.issues[0].code, "start_overlap")
	assert.match(r.issues[0].text, /^(Left post and Right post|Right post and Left post) start inside each other$/)
})
