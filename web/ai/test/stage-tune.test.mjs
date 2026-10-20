// The stage tuner keeps its time (node --test web/ai/test/stage-tune.test.mjs). The video pipeline's batch (19 Oct) found every balanced-forces
// Build with AI (an Atwood machine, a lever balancing two weights) stuck in "Tuning stage by stage" for good: a fix worker's job never came back
// (./fix-pool.js sent it before the worker's own listener was there; the engine bundle's answer, without fix: 1, was ignored) and the tuner
// waited for it, its maxMs checked only between runs. Here a lost job is an evalRun (or a joint tuner) that never settles. The physics is the
// real engine (web/sim/engine-worker.js on this thread).
import test from "node:test"
import assert from "node:assert/strict"
import { createStageTuner, judgeRun } from "../stage-tune.js"
import { goalDistance, setKnob } from "../orchestrator.js"
import { solve } from "../solver.js"
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
/** A ball held over a box that misses it (the tuner's case in orchestrator.test.mjs). */
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
/** A candidate judged here, as a fix worker would judge it. */
const judgeHere = async (scene, goals, checks) => judgeRun(await simulate(scene), scene, goals, checks, goalDistance)
const never = () => new Promise(() => {})
const tuner = (evalRun, extra = {}) => createStageTuner({ solve: (p) => solve(p), simulate, evalRun, goalDistance, setKnob, parallel: 4, ...extra })
/** The stage tuner's time, and a little for what the engine is in the middle of when it ends (one run of this scene: a few ms); more on a
 *  slower machine (AI_FIX_TIME_SCALE, as the fix-search tests). */
const SCALE = Math.max(1, Number(globalThis.process?.env?.AI_FIX_TIME_SCALE) || 1)
const SLACK_MS = 600 * SCALE

test("a run that never comes back can't hold the stage tuner past its time (the batch's hang), and the runs still out are stopped", { timeout: 20000 * SCALE }, async () => {
	const signals = []
	const st = tuner((scene, goals, checks, signal) => (signals.push(signal), never()))
	const plan = dropPlan(1.2)
	const ev0 = await st.evaluate(plan, { full: true })
	assert.equal(ev0.f.goalsOk, 0, "the ball misses the box at first")
	const t0 = performance.now()
	const t = await st.stageTune(plan, { from: ev0, maxMs: 500 })
	const ms = performance.now() - t0
	assert.ok(ms < 500 + SLACK_MS, `it ended in ${Math.round(ms)} ms`)
	assert.equal(t.ev, ev0, "nothing came back: the version it started from")
	assert.equal(t.runs, 0, "a run that never came back is not counted")
	assert.equal(t.failStage, 1)
	assert.deepEqual(t.log.map((l) => [l.stage, l.runs, l.passed]), [[1, 0, false]])
	assert.ok(signals.length > 0, "the candidates went to evalRun")
	assert.ok(signals.every((s) => s?.aborted === true), "each run still out was stopped at the deadline (a fix worker busy with one is replaced)")
})

test("some runs come back and one never does: the tuner ends in its time with what came back", { timeout: 20000 * SCALE }, async () => {
	let n = 0
	const st = tuner((scene, goals, checks) => (++n === 2 ? never() : judgeHere(scene, goals, checks)))
	const plan = dropPlan(1.2)
	const ev0 = await st.evaluate(plan, { full: true })
	const progress = []
	const t0 = performance.now()
	// (time enough for the three that come back, even on a busy machine: they run on this thread, one after another)
	const maxMs = 3000 * SCALE
	const t = await st.stageTune(plan, { from: ev0, maxMs, onProgress: (p) => progress.push(p.runs) })
	const ms = performance.now() - t0
	assert.ok(ms < maxMs + SLACK_MS, `it ended in ${Math.round(ms)} ms`)
	// (the first batch is 4 runs side by side: three came back, the second never did, and nothing after it was started)
	assert.equal(t.runs, 3, JSON.stringify(t.log))
	assert.equal(progress.length, 3)
	assert.ok(t.ev.ok && t.ev.f.goalsOk >= ev0.f.goalsOk)
})

test("the caller's own cancel still cancels the stage tuner (AbortError) while a run is out", { timeout: 20000 * SCALE }, async () => {
	const st = tuner(() => never())
	const plan = dropPlan(1.2)
	const ev0 = await st.evaluate(plan, { full: true })
	const ctl = new AbortController()
	setTimeout(() => ctl.abort(), 150)
	const t0 = performance.now()
	await assert.rejects(st.stageTune(plan, { from: ev0, maxMs: 10000, signal: ctl.signal }), (e) => e.name === "AbortError")
	assert.ok(performance.now() - t0 < 150 + SLACK_MS, "at once, not at the end of its time")
})

test("a joint tuner that never returns can't hold it either; the joint tuner gets the stage tuner's signal and only the time that is left", { timeout: 30000 * SCALE }, async () => {
	// (every candidate misses: the stage search fails, and the joint tuner (orchestrator tune) gets the plan's own knob)
	const miss = async (scene, goals, checks) => ({ goals: goals.map((g) => ({ label: g.label, ok: false })), checks: checks.map(() => ({ res: { ok: false, detail: "misses" }, d: 1.9 })), warnings: 0 })
	const asked = []
	const st = tuner(miss, { tune: (o) => (asked.push({ maxMs: o.maxMs, signal: o.signal }), never()) })
	const plan = dropPlan(1.2)
	const ev0 = await st.evaluate(plan, { full: true })
	const maxMs = 3000 * SCALE
	const t0 = performance.now()
	// (a short stage search, so the joint tuner is asked at once)
	const t = await st.stageTune(plan, { from: ev0, maxMs, perStage: 3 })
	const ms = performance.now() - t0
	assert.ok(ms < maxMs + SLACK_MS, `it ended in ${Math.round(ms)} ms`)
	assert.equal(asked.length, 1, "the joint tuner was asked")
	assert.ok(asked[0].maxMs > 0 && asked[0].maxMs <= maxMs - 2000, `it was given ${Math.round(asked[0].maxMs)} ms of the ${maxMs}`)
	assert.equal(asked[0].signal?.aborted, true, "and its runs were stopped at the deadline")
	assert.equal(t.failStage, 1)
	assert.ok(!t.log.some((l) => l.joint), "nothing came back from it")
	assert.equal(t.ev.plan, plan, "the version it started from")
})

test("with every run coming back, the stage tuner's answer is the same run after run, and the same as on the app's own engine", { timeout: 60000 * SCALE }, async () => {
	const plan = dropPlan(1.2)
	const outcome = (t) => JSON.stringify({ runs: t.runs, failStage: t.failStage, log: t.log, plan: t.ev.plan, f: t.ev.f })
	const viaWorkers = tuner((scene, goals, checks) => judgeHere(scene, goals, checks))
	const a = await viaWorkers.stageTune(plan, { from: await viaWorkers.evaluate(plan, { full: true }), maxMs: 30000 })
	const b = await viaWorkers.stageTune(plan, { from: await viaWorkers.evaluate(plan, { full: true }), maxMs: 30000 })
	const here = tuner(null)
	const c = await here.stageTune(plan, { from: await here.evaluate(plan, { full: true }), maxMs: 30000 })
	assert.equal(a.ev.f.goalsOk, 1, "the ball is tuned into the box")
	assert.equal(viaWorkers.verified(a.ev), true)
	assert.equal(outcome(a), outcome(b))
	assert.equal(outcome(a), outcome(c))
	assert.ok(a.runs > 0 && a.ms < 30000)
})
