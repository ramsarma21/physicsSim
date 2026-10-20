// A goal's numbers are the person's (./goal-targets.js; V8956 F5, 20 Oct: "make it work" after "use a narrower hose, only 4 mm inside" lowered
// both goals from 4 L to 200 mL and the card said "Made it work: nothing needed"): an answer to a "make it work" that makes a goal easier is
// held back, said on the card and offered as a chip; words that ask for it let it through, and every goal change is in the change list. And
// the change lines name a thing by its name, never by words that say what it should become ("Made a narrower hose narrower").
//   node --test web/ai/test/goal-targets.test.mjs
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createOrchestrator, humanChangeList, nameLike, settingLines, describeDiff } from "../orchestrator.js"
import { targetLines, holdTargets, heldOffer, heldWords, numberSaid, targetChanges } from "../goal-targets.js"
import { editChips } from "../edit-turns.js"
import { prepare, finish, Readout } from "../../sim/index.js"
import { handle } from "../../sim/engine-worker.js"

const simulate = async (scene, signal) => {
	if (signal?.aborted) throw Object.assign(new Error("Cancelled"), { name: "AbortError" })
	const { scene: s, doc, resolved } = prepare(JSON.parse(JSON.stringify(scene)))
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
		if (a === undefined) throw Object.assign(new Error(`no mock answer for ${step}`), { status: 500 })
		return { ok: true, result: a, model: `mock/${step}`, ms: 5, usage: { input_tokens: 10, output_tokens: 5 } }
	}
}
const f5 = () => JSON.parse(readFileSync(new URL("./fixtures/goal-hold/f5-narrow-hose.json", import.meta.url)))
const LOW = [
	{ kind: "fills", container: "bucket", at_least_ml: 200, before_s: 20, label: "The siphon moves the tank's water into the bucket" },
	{ kind: "delivers", item: "hose", at_least_ml: 200, label: "The hose carries at least 200 mL" }
]

test("goal numbers in words, which way is easier, and what the words ask for", () => {
	const was = f5().goals
	assert.deepEqual(targetLines(was, LOW), ["changed the goal “The siphon moves the tank's water into the bucket” (at least 4 L → 200 mL)", "changed the goal “The hose carries at least 4 L” (at least 4 L → 200 mL)"])
	assert.equal(targetChanges(was, LOW)[0].changes[0].easier, true)
	assert.equal(targetChanges(LOW, was)[0].changes[0].easier, false, "a goal raised is harder")
	assert.equal(targetChanges([{ kind: "hits", item: "a", target: "b", before_s: 2 }], [{ kind: "hits", item: "a", target: "b", before_s: 5 }])[0].changes[0].easier, true, "a later deadline is easier")
	assert.deepEqual(targetLines([{ kind: "reaches", item: "t", at_least_c: 60, by_min: 5 }], [{ kind: "reaches", item: "t", at_least_c: 70, by_min: 10 }]), ["changed the goal “reaches” (at least 60 °C → 70 °C; within 5 min → 10 min)"])
	assert.ok(numberSaid("only 200 mL is fine", "at_least_ml", 200) && numberSaid("make it 0.2 L", "at_least_ml", 200) && numberSaid("Make it run for a full minute instead.", "seconds", 60))
	assert.ok(!numberSaid("make it work", "at_least_ml", 200))
	// (held back unless the words ask for it)
	const h = holdTargets(was, LOW, { text: "make it work" })
	assert.deepEqual(h.goals.map((g) => g.at_least_ml), [4000, 4000])
	assert.deepEqual(h.goals.map((g) => g.label), was.map((g) => g.label), "the person's labels too")
	assert.equal(holdTargets(was, LOW, { text: "Lower the goals to 200 mL" }).held.length, 0)
	assert.equal(holdTargets(was, LOW, { text: "only ask for 200 mL" }).held.length, 0)
	assert.equal(holdTargets(LOW, was, { text: "make it work" }).held.length, 0, "a harder goal is never held back")
	const offer = heldOffer(h.held)
	assert.equal(offer.label, "Lower the goals to 200 mL")
	assert.match(offer.prompt, /^Change the goals “The siphon moves the tank's water into the bucket” to at least 200 mL, and “The hose carries at least 4 L” to at least 200 mL\./)
	assert.match(heldWords({ ...h.held[1], why: "A 4 mm hose moves only a few hundred mL in a 20 s run" }), /^Kept your goal “The hose carries at least 4 L” as it was \(the AI wanted at least 4 L → 200 mL: a 4 mm hose moves only a few hundred mL in a 20 s run\); lowering a goal is yours to choose$/)
	// (and the long diff, for the AI's own feedback, says the same goal changed)
	const a = { items: [], goals: was }
	const b = { items: [], goals: LOW }
	assert.ok(describeDiff(a, b).includes("Goal “The hose carries at least 4 L”: at least 4 L → 200 mL"))
})

test("a 'make it work' that lowers the goals keeps the person's 4 L, says what the AI wanted, and offers it as a chip (V8956 F5)", { timeout: 300000 }, async () => {
	const scene = f5()
	const sim = await simulate(scene)
	assert.equal(sim.summary.goals.every((g) => g.ok === false), true, "the narrow hose misses both goals")
	const answer = {
		kind: "fix",
		targets: [{ says: "the siphon", ids: ["hose"] }, { says: "the tank's water", ids: ["tank"] }, { says: "the bucket", ids: ["bucket"] }],
		reply: "I raised the tank and asked for 200 mL, which a 4 mm hose can move in 20 s.",
		why: "They asked to make the siphon goal work again.",
		patches: [
			{ op: "move", id: "shelf", place: { on: "air", x: 0.6, y_m: 0.8 } },
			{ op: "move", id: "tank", place: { on: "shelf", x: 0.6 } },
			{ op: "set_goals", goals: LOW }
		],
		assumptions: ["A 4 mm hose moves only a few hundred mL in a 20 s run, so the goals ask for 200 mL instead of 4 L"],
		suggestions: []
	}
	const r = await createOrchestrator({ api: mockApi({ edit: answer }), progress: false }).build({ text: "make it work", mode: "edit", scene, sim }, { aimFirst: false, physFirst: false }).result
	// (with the person's 4 L the raised tank still misses: a typed "make it work" that doesn't work leaves the scene as it was and says so)
	if (r.scene) {
		const goals = r.scene.goals ?? []
		assert.deepEqual(goals.filter((g) => g.at_least_ml !== undefined).map((g) => g.at_least_ml), [4000, 4000], `the version keeps 4 L: ${JSON.stringify(goals)}`)
	} else assert.match(r.reply, /Your scene is as it was\. The AI wanted to lower the goals \(at least 4 L → 200 mL\): that is yours to choose\.$/, r.reply)
	assert.ok(!(r.human ?? []).some((l) => /200 mL/.test(l) && /^changed the goal/.test(l)), `no lowered goal on the card's list: ${JSON.stringify(r.human)}`)
	assert.equal(r.edit.goalsHeld?.length, 2, JSON.stringify(r.edit))
	assert.match(r.edit.goalsHeld[1], /Kept your goal “The hose carries at least 4 L” as it was \(the AI wanted at least 4 L → 200 mL: a 4 mm hose moves only a few hundred mL/)
	assert.ok(!(r.assumptions ?? []).some((a) => /200 mL instead of 4 L/.test(a)), "the AI's note that no longer holds is not an assumption")
	assert.equal(r.edit.goalOffer?.label, "Lower the goals to 200 mL")
	const chips = editChips(r, {})
	assert.ok(chips.some((c) => c.label === "Lower the goals to 200 mL" && /^Change the goals/.test(c.prompt)), JSON.stringify(chips))
})

test("words that ask for the lower goal let it through, and the change list says it", { timeout: 300000 }, async () => {
	const scene = f5()
	const sim = await simulate(scene)
	const answer = { kind: "change", targets: [], reply: "Done: the goals ask for 200 mL now.", patches: [{ op: "set_goals", goals: LOW }], suggestions: [] }
	const r = await createOrchestrator({ api: mockApi({ edit: answer }), progress: false }).build({ text: "Change the goals “The siphon moves the tank's water into the bucket” to at least 200 mL, and “The hose carries at least 4 L” to at least 200 mL. Keep everything else as it is.", mode: "edit", scene, sim }, { aimFirst: false, physFirst: false }).result
	assert.deepEqual((r.scene.goals ?? []).map((g) => g.at_least_ml), [200, 200])
	assert.ok((r.human ?? []).includes("changed the goal “The hose carries at least 4 L” (at least 4 L → 200 mL)"), JSON.stringify(r.human))
	assert.ok(!r.edit.goalsHeld)
})

test("the change lines: a thing by its name, never by the words for what it should become; settings and goal numbers said", () => {
	const a = f5()
	const b = JSON.parse(JSON.stringify(a))
	b.items.find((i) => i.id === "hose").props.diameter_mm = 2
	const lines = humanChangeList(a, b, { says: [{ says: "a narrower hose", ids: ["hose"] }], text: "Use a narrower hose, only 2 mm inside." }).map((c) => c.text)
	assert.ok(lines.length === 1 && /siphon hose/i.test(lines[0]) && !/narrower hose/.test(lines[0]), JSON.stringify(lines))
	for (const w of ["a narrower hose", "the pump the air out", "the honey instead of water", "a bigger sail"]) assert.equal(nameLike(w, { type: "hose", name: "Siphon hose" }), false, w)
	assert.equal(nameLike("the yellow ball", { type: "plastic-ball", name: "Ball 2" }), true)
	assert.equal(nameLike("the ramp", { type: "plank", name: "Ramp 1" }), true)
	assert.deepEqual(settingLines({ settings: { time_lapse: 2 } }, { settings: { time_lapse: 4 } }), ["changed the time-lapse (2× → 4×)"])
	// (G2: "make it run for a full minute": the timer's goal follows the change, said on the list)
	const g2a = { items: [{ id: "table", type: "table", x: 1.3, y: 0 }, { id: "timer", type: "hourglass", x: 1.2, y: 0, props: { sand_kg: 0.033 } }], goals: [{ kind: "timer", item: "timer", seconds: 30, tol: 0.1, label: "The sand timer runs out in about 30 seconds" }], settings: { time_lapse: 2 } }
	const g2b = { ...JSON.parse(JSON.stringify(g2a)), goals: [{ kind: "timer", item: "timer", seconds: 60, tol: 0.1, label: "The sand timer runs out in about a minute" }], settings: { time_lapse: 4 } }
	g2b.items[1].props = {}
	const g2 = humanChangeList(g2a, g2b, { text: "Make it run for a full minute instead." }).map((c) => c.text)
	assert.ok(g2.includes("changed the time-lapse (2× → 4×)") && g2.includes("changed the goal “The sand timer runs out in about 30 seconds” (30 s → 60 s)"), JSON.stringify(g2))
})

test("a reading's words: listed in the catalog in number order, Python's shape", () => {
	const r = new Readout("broken", "Broken", { digits: 0, words: { 2: "in pieces", 0: "whole", 1: "cracked" } })
	assert.deepEqual(r.json().words, { 0: "whole", 1: "cracked", 2: "in pieces" })
	assert.deepEqual(Object.keys(r.json().words), ["0", "1", "2"])
	assert.equal(new Readout("t", "T", { unit: "°C" }).json().words, undefined, "a reading without words is listed as before")
	assert.throws(() => new Readout("x", "X", { words: { 0.5: "half" } }), /whole-number codes/)
})
