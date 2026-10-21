// Real materials (web/ai/realism.js): a thing's friction, rolling resistance, bounce and sideways kick stay within what a real one of its
// material has, wherever the sandbox's AI changes a scene: the make-it-work search (web/ai/fixer.js), the AI's reworks (judgeRework), an edit
// answer (adjustEdit step 5: put back unless the words ask for that setting), the critic's patches (guardPatches) and the build's tuners
// (safeKnobs). The person's own values stay theirs, and a change back toward what is real is always allowed.
//   node --test web/ai/test/realism.test.mjs
import assert from "node:assert/strict"
import { test } from "node:test"
import { realRange, unrealStep, unrealIn, unrealWords, realPatches, realKnob, materialSaid } from "../realism.js"
import { createOrchestrator, safeKnobs } from "../orchestrator.js"
import { findFix } from "../fixer.js"
import { solve } from "../solver.js"
import { prepare, finish } from "../../sim/index.js"
import { handle } from "../../sim/engine-worker.js"
import { registerModule } from "../../sim/plugins.js"

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
/** Three soda cans in a row and a bowling ball rolled at them. */
const cansPlan = () => ({
	title: "Bowling the cans",
	seconds: 2,
	release: 0.2,
	items: [
		{ id: "ball", type: "bowling-ball", place: { on: "table", x: 0.4 }, props: { start_speed: 1.2 } },
		{ id: "can1", type: "soda-can", name: "Soda can 1", place: { on: "table", x: 1.2 } },
		{ id: "can2", type: "soda-can", name: "Soda can 2", place: { on: "table", x: 1.35 } },
		{ id: "can3", type: "soda-can", name: "Soda can 3", place: { on: "table", x: 1.5 } }
	],
	goals: []
})

test("a real thing's material values: a soda can grips 0.12–0.6, a carpet rolls 0.0117–0.155, a toy car's tyre at most 1.2", () => {
	assert.deepEqual(pick(realRange("soda-can", "friction")), { lo: 0.12, hi: 0.6, base: 0.3 })
	assert.deepEqual(pick(realRange("carpet-strip", "rolling")), { lo: 0.0117, hi: 0.155, base: 0.05 })
	// (what a thing is made of decides: a floor of carpet rolls like carpet; varnished hardwood barely at all)
	assert.deepEqual(pick(realRange("floor", "rolling", { material: "carpet" })), { lo: 0.0117, hi: 0.155, base: 0.05 })
	assert.deepEqual(pick(realRange("floor", "rolling")), { lo: 0, hi: 0.005, base: 0 })
	assert.deepEqual(pick(realRange("toy-car", "friction")), { lo: 0.32, hi: 1.2, base: 0.8 })
	assert.ok(realRange("tennis-ball", "bounce").hi <= 0.98, "nothing real gives back 98 %")
	assert.equal(realRange("box", "mass"), null, "only the material props")
	assert.equal(realRange("no-such-type", "friction"), null)
})
const pick = (r) => (r ? { lo: r.lo, hi: r.hi, base: r.base } : r)

test("a step further from real is refused; toward real, or the person's own value, is not", () => {
	assert.ok(unrealStep("soda-can", "friction", 0.3, 1.6), "a soda can with a friction of 1.6")
	assert.equal(unrealStep("soda-can", "friction", 0.3, 0.5), null)
	assert.equal(unrealStep("soda-can", "friction", 1.6, 1.2), null, "back toward what is real")
	assert.ok(unrealStep("soda-can", "friction", 1.2, 1.6), "further away from it")
	assert.ok(unrealStep("carpet-strip", "rolling", 0.05, 0.5), "ten times a carpet's rolling resistance")
	assert.equal(unrealStep("carpet-strip", "rolling", 0.05, 0.12), null, "a draggy carpet is still carpet")
	const a = solve(cansPlan()).scene
	const b = { ...a, items: a.items.map((i) => (/^can/.test(i.id) ? { ...i, props: { ...i.props, friction: 1.6 } } : i)) }
	const u = unrealIn(a, b)
	assert.deepEqual(u.map((x) => [x.id, x.key, x.to]), [["can1", "friction", 1.6], ["can2", "friction", 1.6], ["can3", "friction", 1.6]])
	assert.equal(unrealWords(u[0]), "the soda can 1 a friction of 1.6 (a real one has 0.12–0.6)")
	assert.deepEqual(unrealIn(a, b, { keep: [["can1", ["friction"]], ["can2", ["friction"]], ["can3", ["friction"]]] }), [], "the person's own friction is theirs")
	assert.deepEqual(unrealIn(b, b), [], "nothing new")
	// (a thing added is judged against its own material)
	const added = { ...a, items: [...a.items, { id: "mat", type: "carpet-strip", x: 2, y: 0, props: { rolling: 0.5 } }] }
	assert.deepEqual(unrealIn(a, added).map((x) => [x.id, x.key]), [["mat", "rolling"]])
	assert.equal(materialSaid("friction", "make the cans much grippier"), true)
	assert.equal(materialSaid("friction", "make the ball knock the cans over"), false)
})

test("the critic's patch: an unreal friction is taken out, the rest of it kept", () => {
	const plan = cansPlan()
	const r = realPatches(plan, [{ op: "set_props", id: "can1", props: { friction: 1.6, full: false } }, { op: "set_props", id: "can2", props: { friction: 1.6 } }, { op: "move", id: "can3", dx: 0.05 }, { op: "add", item: { id: "mat", type: "carpet-strip", props: { rolling: 0.5, length: 0.5 } } }])
	assert.deepEqual(r.patches, [{ op: "set_props", id: "can1", props: { full: false } }, { op: "move", id: "can3", dx: 0.05 }, { op: "add", item: { id: "mat", type: "carpet-strip", props: { length: 0.5 } } }])
	assert.deepEqual(r.dropped.map((u) => [u.id, u.key, u.to]), [["can1", "friction", 1.6], ["can2", "friction", 1.6], ["mat", "rolling", 0.5]])
})

test("the tuners turn a material's friction only within what a real one has; a knob with no real value left is left out, and said", () => {
	const it = { id: "can", type: "soda-can", props: {}, place: { on: "table", x: 1 } }
	assert.deepEqual(realKnob({ id: "can", param: "friction", min: 0.1, max: 2 }, it).knob, { id: "can", param: "friction", min: 0.12, max: 0.6 })
	assert.deepEqual(realKnob({ id: "can", param: "x", min: 0.5, max: 1.5 }, it).knob, { id: "can", param: "x", min: 0.5, max: 1.5 }, "a place is no material")
	const s = safeKnobs({ items: [it], tune: [{ id: "can", param: "friction", min: 0.8, max: 2 }, { id: "can", param: "x", min: 0.8, max: 1.2 }] })
	assert.deepEqual(s.knobs, [{ id: "can", param: "x", min: 0.8, max: 1.2 }])
	assert.match(s.notes.join(" | "), /friction was left as planned: every value the tuner might try is one no real soda can has \(0\.12–0\.6\)/)
	// (the planner's own value, the person's perhaps, stays reachable: the range is widened to take it in, never further)
	const mine = { ...it, props: { friction: 1.5 } }
	assert.deepEqual(realKnob({ id: "can", param: "friction", min: 0.1, max: 2 }, mine).knob, { id: "can", param: "friction", min: 0.12, max: 1.5 })
})

test("the make-it-work search never tries a value no real thing has, even one a module's knob would offer", async () => {
	// (a stand-in module knob that would grip a soda can like glue: friction 0.3 → 1.6, and a real step to 0.5)
	registerModule({ name: "mod_zz_realism_test", knobs: [{ type: "soda-can", key: "friction", how: "abs", steps: [0.2, 1.3], more: "make {it} grip more", less: "make {it} grip less", why: "test" }] })
	const sc = solve({ ...cansPlan(), items: cansPlan().items.slice(1, 2), goals: [{ kind: "moves", item: "can1", at_least_m: 0.1, label: "The can moves 10 cm" }] })
	const run = await simulate(sc.scene)
	const tried = []
	const evaluate = async (scene, tg) => {
		tried.push(scene.items.find((i) => i.id === "can1")?.props?.friction ?? 0.3)
		return { ok: false, results: tg.map((t) => ({ label: t.label, ok: false })), f: 1, warn: 0 }
	}
	await findFix({ scene: sc.scene, sim: run, goals: sc.goals }, { evaluate, budgetMs: 20000, maxRuns: 300, parallel: 1 })
	assert.ok(tried.includes(0.5), `a real grip is tried: ${JSON.stringify([...new Set(tried)])}`)
	assert.ok(!tried.some((f) => f > 0.6 + 1e-9), `never a grip no real can has: ${JSON.stringify([...new Set(tried)])}`)
})

test("the AI's rework that makes the cans grip like glue is no fix (judgeRework), whatever it makes happen", async () => {
	const ai = createOrchestrator({ api: mockApi({}) })
	const a = solve(cansPlan()).scene
	const b = { ...a, items: a.items.map((i) => (i.id === "can2" ? { ...i, props: { ...i.props, friction: 1.6 } } : i)) }
	const v = await ai.judgeRework({ scene: a, sim: null, before: null, goals: [] }, { scene: b }, { mine: [], removedTypes: [], hard: [] })
	assert.equal(v.ok, false)
	assert.match(v.why, /^it gave Soda can 2 a friction of 1\.6 \(a real one has 0\.12–0\.6\)$/)
})

test("an edit answer that grips the cans like glue: put back as it was and said; asked for in the words, it stays", async () => {
	const base = solve(cansPlan()).scene
	const edit = { kind: "change", patches: [{ op: "set_props", id: "can1", props: { friction: 1.6 } }, { op: "set_props", id: "ball", props: { start_speed: 1.5 } }], targets: [{ says: "the bowling ball", ids: ["ball"] }, { says: "the first soda can", ids: ["can1"] }], reply: "Faster ball, grippier can." }
	const r = await createOrchestrator({ api: mockApi({ edit }) }).build({ text: "roll the bowling ball faster at the first soda can", mode: "edit", scene: base }).result
	const can = r.scene.items.find((i) => i.id === "can1")
	assert.equal(can.props?.friction, undefined, `the can's friction is a real can's: ${JSON.stringify(can.props)}`)
	assert.equal(r.scene.items.find((i) => i.id === "ball").props.start_speed, 1.5, "the asked change is made")
	assert.ok((r.edit?.leftAlone ?? []).some((l) => /friction \(a real one has 0\.12–0\.6, not 1\.6\)/.test(l)), JSON.stringify(r.edit?.leftAlone))
	const asked = await createOrchestrator({ api: mockApi({ edit }) }).build({ text: "make the first soda can much grippier and roll the bowling ball faster", mode: "edit", scene: base }).result
	assert.equal(asked.scene.items.find((i) => i.id === "can1").props.friction, 1.6, "the person asked for a grippier can")
})

test("the critic's patch that gives a soda can a friction of 1.6 is not applied, and the round says so", async () => {
	let n = 0
	const refine = () => (++n === 1 ? { done: false, score_0_10: 5, issues: ["the cans slide instead of falling"], patches: [{ op: "set_props", id: "can1", props: { friction: 1.6 } }, { op: "move", id: "can3", dx: 0.02 }] } : { done: true, score_0_10: 8, issues: [], patches: [] })
	const r = await createOrchestrator({ api: mockApi({ plan: cansPlan(), refine }) }).build({ text: "a bowling ball knocks three soda cans over" }, { stageTune: false }).result
	assert.equal(r.scene.items.find((i) => i.id === "can1").props?.friction, undefined)
	assert.ok(r.refine[0].skipped.some((s) => /Soda can 1: its friction was not set to 1\.6, which no real one has \(0\.12–0\.6\)/.test(s)), JSON.stringify(r.refine[0].skipped))
})
