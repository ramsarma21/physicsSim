// After a change stops a goal (ai/DESIGN.md §16; the user, 16 Oct: "it broke the whole scene … you need to fix all of these", on the starter's
// "breakfast-table disaster"): the card's words (grouped changes, real weights, names as they are now, the goal relabelled, a heads-up that
// never repeats the lead, where the chain stops), the offer (checked in the engine, never applied; when nothing works, a real button, once) and
// the search for it (a stand-in for a lost hit, the AI's rework in the background). node --test web/ai/test/make-it-work.test.mjs
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createOrchestrator, applyPatches, humanChangeList, lostStageList, relabelGoals, statesOutcome } from "../orchestrator.js"
import { findFix, fixTargets, judge, outcomeWords, tippers } from "../fixer.js"
import { headsUpLines, offerWords, editChips, reworkWords, progressWords, inSentence } from "../edit-turns.js"
import { kindNoun, aKindOf, weightOf, imperative } from "../words.js"
import { planFromScene } from "../solver.js"
import { prepare, finish, inside } from "../../sim/index.js"
import { handle } from "../../sim/engine-worker.js"

const simulate = async (scene, signal) => {
	if (signal?.aborted) throw Object.assign(new Error("Cancelled"), { name: "AbortError" })
	const { scene: s, doc, resolved } = prepare(JSON.parse(JSON.stringify(scene)))
	const msg = handle({ id: 1, doc, rate: 120 })
	if (msg.error !== undefined) throw new Error(msg.error)
	const meta = finish(s, doc, resolved, msg.track)
	return { key: "k", ms: msg.ms, track: msg.track, doc: meta.doc, summary: meta.summary, warnings: meta.warnings, resolved }
}
const starter = () => JSON.parse(readFileSync(new URL("../../scenarios/rube-goldberg.json", import.meta.url)))
const gallery = (slug) => JSON.parse(readFileSync(new URL(`../../gallery/${slug}.json`, import.meta.url)))
/** A mock of the app's api(): /api/ai/<step> answers from `answers[step]` (a value or a function of the payload and the call's number). */
function mockApi(answers, log = []) {
	return async (path, body, signal) => {
		if (path === "/api/simulate") return simulate(body.scene, signal)
		const step = path.replace("/api/ai/", "")
		log.push({ step, payload: body.payload })
		let a = answers[step]
		if (typeof a === "function") a = await a(body.payload, log.filter((l) => l.step === step).length)
		if (a instanceof Error) throw a
		if (a === undefined) throw Object.assign(new Error(`no mock answer for ${step}`), { status: 500 })
		return { ok: true, result: a, model: `mock/${step}`, ms: 5, usage: { input_tokens: 10, output_tokens: 5 } }
	}
}
/** The user's request on the starter, as the edit step answered it (out/t1 of the live run, 16 Oct): six standing soda cans 10 cm apart where
 *  the dominoes stood, the red ball an orange, the yellow ball an egg, a rubber duck in the box. full: the cans' fill. */
const breakfast = ({ full = true } = {}) => ({
	kind: "change",
	targets: [{ says: "the red ball", ids: ["ball1"] }, { says: "the yellow ball", ids: ["ball2"] }, { says: "the dominoes", ids: ["dominoes"] }, { says: "the box", ids: ["box"] }],
	reply: "I made it a breakfast-table disaster.",
	patches: [
		{ op: "replace_type", id: "ball1", type: "orange", props: {} },
		{ op: "set_item", id: "ball1", name: "Orange" },
		{ op: "replace_type", id: "ball2", type: "egg", props: {} },
		{ op: "set_item", id: "ball2", name: "Egg" },
		{ op: "remove", id: "dominoes" },
		...Array.from({ length: 6 }, (_, k) => ({ op: "add", item: { id: `can${k + 1}`, type: "soda-can", name: `Soda can ${k + 1}`, props: full ? {} : { full: false }, place: { on: "table", x: Math.round((1.86 + 0.1 * k) * 100) / 100 } } })),
		{ op: "add", item: { id: "duck", type: "rubber-duck", name: "Rubber duck", props: {}, place: { on: "box", inside: "box", x: 2.735 } } }
	],
	suggestions: [{ label: "Use empty cans", prompt: "Make all the soda cans empty so they topple more easily" }, { label: "Make it work again", prompt: "Make it work again so the egg lands in the box with the duck" }, { label: "Add a cereal box finale", prompt: "Add a cereal box at the end for the egg to knock over" }]
})
let edited = null
/** The breakfast edit, as the drawer makes it (one run, no critic): {r (the report), scene (the starter), sim (its run)}. */
async function breakfastEdit() {
	if (edited) return edited
	const scene = starter()
	const sim = await simulate(scene)
	const r = await createOrchestrator({ api: mockApi({ edit: breakfast() }), progress: false }).build({ text: "Turn this into a breakfast-table disaster: swap the red ball for an orange and the yellow ball for an egg, replace the dominoes with a row of standing soda cans, and put a rubber duck in the box waiting for its egg.", mode: "edit", scene, sim }).result
	return (edited = { r, scene, sim })
}

test("the change list: same-kind adds counted, a replacement said as one, every swap with its weights, an added thing where it sits", async () => {
	const { r } = await breakfastEdit()
	assert.deepEqual(r.human, ["replaced the 7 dominoes with 6 standing soda cans (370 g each, 10 cm apart)", "added a rubber duck in the box", "swapped the yellow ball for an egg (6.3 g → 57 g)", "swapped the red ball for an orange (102 g → 131 g)"])
	assert.ok(!r.human.some((l) => /soda can, standing|Soda can \d|removed/.test(l)), "never the catalog's name with its comma, one line per can, or a separate 'removed'")
	// (the words for kinds, and what things weigh as the engine builds them: the egg's own weight, a full and an empty can)
	assert.equal(kindNoun("soda-can", 6), "standing soda cans")
	assert.equal(kindNoun("soda-can-side", 2), "soda cans on their side")
	assert.equal(kindNoun("soda-can", 6, { short: true }), "soda cans")
	assert.equal(aKindOf("egg"), "an egg")
	assert.equal(Math.round(weightOf("egg") * 1000), 57)
	assert.equal(Math.round(weightOf("soda-can", { full: false }) * 1000), 15)
	assert.equal(Math.round(weightOf("soda-can") * 1000), 370)
	assert.equal(imperative("emptied the 6 soda cans and moved the box 3 cm left"), "empty the 6 soda cans and move the box 3 cm left")
})

test("the change list: one change made to many things of a kind is one line, counted, its weight 'each'; a row spaced closer is one line", async () => {
	const { r } = await breakfastEdit()
	const a = r.scene
	const emptied = JSON.parse(JSON.stringify(a))
	for (const it of emptied.items) if (it.type === "soda-can") it.props = { ...(it.props ?? {}), full: false }
	assert.deepEqual(humanChangeList(a, emptied).map((c) => c.text), ["emptied the 6 soda cans (370 g → 15 g each)"])
	// (closer together, each moved along by its own amount)
	const closer = JSON.parse(JSON.stringify(a))
	const cans = closer.items.filter((i) => i.type === "soda-can").sort((p, q) => p.x - q.x)
	cans.forEach((c, k) => (c.x = Math.round((cans[0].x + 0.07 * k) * 1e5) / 1e5))
	assert.deepEqual(humanChangeList(a, closer).map((c) => c.text), ["spaced the 6 soda cans closer together (10 → 7 cm apart)"])
	// (all emptied, five of them also moved: two lines, never one per can)
	const both = JSON.parse(JSON.stringify(emptied))
	for (const it of both.items) if (it.type === "soda-can" && it.id !== "can1") it.x = Math.round((it.x - 0.02) * 1e5) / 1e5
	assert.deepEqual(humanChangeList(a, both).map((c) => c.text), ["emptied the 6 soda cans (370 g → 15 g each)", "moved 5 of the soda cans 2 cm left"])
	// (ten pins swapped for bottles: one line, the weights each; the person's words for the group)
	const bowl = gallery("bowling-strike")
	const bottles = JSON.parse(JSON.stringify(bowl))
	for (const it of bottles.items) if (it.type === "bowling-pin") it.type = "water-bottle"
	const lines = humanChangeList(bowl, bottles).map((c) => c.text)
	assert.deepEqual(lines, ["swapped the 10 bowling pins for standing water bottles (1.6 kg → 512 g each, 38 → 21 cm tall)"])
	const pins = bowl.items.filter((i) => i.type === "bowling-pin").map((i) => i.id)
	assert.deepEqual(humanChangeList(bowl, bottles, { says: [{ says: "the ten pins", ids: pins }] }).map((c) => c.text), ["swapped the ten pins for standing water bottles (1.6 kg → 512 g each, 38 → 21 cm tall)"])
})

test("an added thing says how it stands and between what: 'a closed laptop, on its edge, between the soda cans and the seesaw'", async () => {
	const { r } = await breakfastEdit()
	const b = JSON.parse(JSON.stringify(r.scene))
	b.items.push({ id: "standin1", type: "laptop-closed", name: "Laptop, closed", x: 2.43, y: 0.1525, angle: 90, props: {} })
	assert.deepEqual(humanChangeList(r.scene, b).map((c) => c.text), ["added a closed laptop, on its edge, between the soda cans and the seesaw"])
})

test("goal labels follow a swap or a rename: 'Ball 2 lands in the box' -> 'The egg lands in the box'; a mid-sentence name stays lower case; a group by its kind", async () => {
	const { r } = await breakfastEdit()
	assert.deepEqual(r.scene.goals.map((g) => g.label), ["The egg lands in the box"])
	assert.deepEqual(r.goals.map((g) => g.label), ["The egg lands in the box"], "the card's goals and the results strip (the scene's goals) say it")
	const p = { title: "x", items: [{ id: "b8", type: "billiard-ball", name: "8-ball", place: { on: "table", x: 0.5 } }, { id: "bucket", type: "bucket", place: { on: "table", x: 2 } }], goals: [{ kind: "in", item: "b8", container: "bucket", label: "The giant knocks the 8-ball into the bucket" }] }
	assert.equal(applyPatches(p, [{ op: "replace_type", id: "b8", type: "bowling-ball" }, { op: "set_item", id: "b8", name: "Bowling ball" }]).plan.goals[0].label, "The giant knocks the bowling ball into the bucket")
	const egg = applyPatches({ title: "x", items: [{ id: "e", type: "egg", name: "Egg", place: { on: "table", x: 1 } }, { id: "box", type: "box", place: { on: "table", x: 2 } }], goals: [{ kind: "in", item: "e", container: "box", label: "The egg lands in the box" }] }, [{ op: "set_item", id: "e", name: "Breakfast egg" }])
	assert.equal(egg.plan.goals[0].label, "The breakfast egg lands in the box")
	const plan = { goals: [{ kind: "falls", items: ["p1", "p2"], label: "All ten pins fall: a strike" }] }
	relabelGoals(plan, "p1", ["Pin 1", "Bowling pin"], "standing water bottle", ["bowling pins", "pins"], "water bottles")
	assert.equal(plan.goals[0].label, "All ten water bottles fall: a strike")
})

test("the lead says where the chain stops now, with the weight that explains it; the heads-up uses the names on screen and never repeats the lead", async () => {
	const { r, scene, sim } = await breakfastEdit()
	assert.equal(r.lead, "Done, but now the orange only shoves the first soda can 4.4 cm (each weighs 370 g), so the egg never moves ✗.")
	assert.ok(!r.edit.headsUp.some((l) => /Ball 2|egg/i.test(l)), `never the old name, never the lead again: ${r.edit.headsUp}`)
	// (a thing's name starting the line is said as a clause says it: "the seesaw no longer turns", V8820)
	assert.deepEqual(r.edit.headsUp, ["the seesaw no longer turns"])
	// (a lost stage is named as the thing is called now; a line about the failing goal's own thing is left out by its id)
	const lost = lostStageList(sim, (await simulate(r.scene)), r.scene)
	assert.ok(lost.some((l) => l.text === "Egg no longer moves" && l.ids[0] === "ball2"), JSON.stringify(lost))
	assert.deepEqual(headsUpLines({ lost, said: r.lead, skip: ["ball2", "box"] }), ["Seesaw no longer turns"])
	// (empty cans: shoved along to the seesaw, which they strike far too softly)
	const empty = await createOrchestrator({ api: mockApi({ edit: breakfast({ full: false }) }), progress: false }).build({ text: "the same, with empty cans", mode: "edit", scene, sim }).result
	assert.match(empty.lead, /^Done, but now the last soda can hits the seesaw at \d(\.\d)? m\/s and it only turns \d+° \(27° before\), so the egg never moves ✗\.$/)
})

test("the search finds a stand-in for the lost hit (a closed laptop on its edge), checked in the engine: the egg ends in the box with the duck, every can and kind kept", async () => {
	const { r } = await breakfastEdit()
	assert.equal(r.fixNeeded, true, "the panel searches")
	assert.deepEqual(tippers().filter((t) => !t.thin).map((t) => t.type), ["laptop-closed", "cutting-board"])
	// (and the laptop made thinner, its thickness its foot on its edge: V8817 m2)
	assert.deepEqual(tippers().filter((t) => t.thin).map((t) => [t.type, t.props.height]), [["laptop-closed", 0.006]])
	const fr = await findFix(r.fixCtx, { simulate, parallel: 2, budgetMs: 60000 })
	assert.equal(fr.status, "found")
	// (and where the row now starts, as the fix card says it: the offer leaves nothing of the fix out, V8820. Since the engine repair of 19 Oct
	// (web/CONTRACT.md) a full-thickness laptop there tips only at its exact place, so the sturdy fix found is the thinner one, said so)
	assert.match(fr.fix.words.say, /^stand a closed laptop (6 mm thick )?on its edge between the soda cans and the seesaw, so they tip it onto the seesaw, with the 6 soda cans emptied \(370 g → 15 g each\) and 7 cm apart, starting [\d.]+ cm further (left|right)$/)
	const start = /starting ([\d.]+ cm further (left|right))$/.exec(fr.fix.words.say)[1]
	assert.ok(humanChangeList(r.scene, fr.fix.scene).some((c) => c.text.includes(`starting ${start}`)), "the card's line says the same start")
	assert.equal(fr.fix.words.label, "Stand a closed laptop by the seesaw")
	const run = await simulate(fr.fix.scene)
	const poses = new Map(Object.entries(run.track.frames.at(-1).placements).map(([k, p]) => [k, [p.x, p.y]]))
	assert.ok(inside(fr.fix.scene, run.doc, poses, "ball2", "box"), "the egg ends in the box")
	assert.ok(inside(fr.fix.scene, run.doc, poses, "duck", "box"), "with the duck")
	assert.equal(run.warnings.length, 0)
	for (const id of ["ball1", "ball2", "duck", "can1", "can2", "can3", "can4", "can5", "can6"]) assert.equal(fr.fix.scene.items.find((i) => i.id === id)?.type, r.scene.items.find((i) => i.id === id).type, `${id} kept, its kind too`)
	assert.ok(!fr.fix.scene.items.some((i) => i.type === "domino-row"), "the dominoes never come back")
})

test("make it work in the background: the search's fix wins over the AI's; offered, never applied", async () => {
	const { r } = await breakfastEdit()
	const log = []
	const ai = createOrchestrator({ api: mockApi({}, log), progress: false })
	const phases = []
	const res = await ai.makeItWork(r.fixCtx, { job: { text: "breakfast", history: [], plan: r.plan }, onProgress: (p) => phases.push(p.phase) })
	assert.equal(res.status, "found")
	assert.equal(res.how, "search")
	assert.equal(res.info.state, "found")
	assert.ok(res.info.sceneJSON && res.info.say && res.info.checked === "The egg lands in the box")
	assert.ok(phases.includes("search"))
	// (the scene on the table was not touched: the report's scene is the edited one)
	assert.ok(!r.scene.items.some((i) => i.id.startsWith("standin")))
})

test("make it work in the background: when the search finds nothing, the AI's rework (told why, keeping the person's things) is checked in the engine and offered", async () => {
	// (the box moved 60 cm by the edit step's own choice, "to give the seesaw room": not the person's, so a rework may move it back. The physics
	// arms are left out (physics: false): this is the AI's part alone)
	const scene = starter()
	const sim = await simulate(scene)
	const r = await createOrchestrator({ api: mockApi({ edit: { kind: "change", reply: "Moved it.", patches: [{ op: "move", id: "box", dx: 0.6 }] } }), progress: false }).build({ text: "give the seesaw more room", mode: "edit", scene, sim }).result
	assert.equal(r.fixNeeded, true)
	const ctx = r.fixCtx
	assert.ok(!(ctx.hard?.get?.("box")?.size), "the box's place is not the person's choice")
	// the AI's answer: the box moved back under the flight
	const log = []
	const back = { kind: "fix", reply: "I moved the box back.", patches: [{ op: "move", id: "box", dx: -0.6 }] }
	const ai = createOrchestrator({ api: mockApi({ edit: () => back }, log), progress: false })
	const res = await ai.makeItWork(ctx, { physics: false, job: { text: "give the seesaw more room", history: [{ role: "user", text: "give the seesaw more room" }], plan: r.plan } })
	const edits = log.filter((l) => l.step === "edit")
	assert.ok(edits.length >= 1, "the AI was asked")
	assert.match(edits[0].payload.feedback, /^# Why it doesn't work now \(the app ran these in the physics engine\)\n- In the run now: “Ball 2 lands in the box” FAILS/)
	assert.match(edits[0].payload.feedback, /# What a fix must do\nMake “Ball 2 lands in the box” happen again(, with every other goal still met)?\./)
	assert.match(edits[0].payload.feedback, /the dominoes \(the part that hits weighs 1\.3 kg\) struck the seesaw at 0\.65 m\/s/, "what drove the thing that throws the goal's thing, before")
	assert.doesNotMatch(edits[0].payload.text, /\bchange\b/i, "the rework's words never carry the trigger word")
	assert.equal(res.status, "found")
	assert.equal(res.how, "ai")
	assert.equal(res.info.checked, "Ball 2 lands in the box")
	assert.deepEqual(res.info.changes, ["moved the box 60 cm left"])
	assert.equal(res.info.say, "move the box 60 cm left")
	assert.ok(JSON.parse(res.info.sceneJSON).items.find((i) => i.id === "box").x < 2.8)
})

test("make it work: nothing works -> said plainly, with the rework's own request for the button (a pure 'make it work', what it keeps, what never comes back)", async () => {
	const { r } = await breakfastEdit()
	// (no stand-in, no AI here: the search alone, short)
	const ai = createOrchestrator({ api: mockApi({}), progress: false })
	const ctx = { ...r.fixCtx, before: { ...r.fixCtx.before, sim: { ...r.fixCtx.before.sim, track: { ...r.fixCtx.before.sim.track, impacts: [] } } } }
	const res = await ai.makeItWork(ctx, { ai: false, budgetMs: 8000, job: { text: "breakfast" } })
	assert.equal(res.status, "none")
	assert.equal(res.info.state, "none")
	assert.ok(res.info.rework?.text, "the button's request")
	assert.match(res.info.rework.text, /^Make it work again so that the egg lands in the box, keeping the egg, the orange, the 6 standing soda cans and the rubber duck\. Say what you changed\.$/)
	assert.deepEqual(res.info.rework.removedTypes, ["domino-row"])
	assert.deepEqual(res.info.rework.keep.map((k) => k[0]).sort(), ["ball1", "ball2", "can1", "can2", "can3", "can4", "can5", "can6", "duck"])
	const w = offerWords(res.info)
	assert.match(w.text, /^I couldn’t find a change that works \(I tried \d+ in the physics\)\.$/)
	assert.equal(w.button, "Ask the AI to rework it")
	// (after a rework that still doesn't work: said, and no button again)
	assert.equal(offerWords(res.info, { rework: true }).button, null)
	assert.match(offerWords(res.info, { rework: true }).text, /^It still doesn’t work, and I couldn’t find a change that does/)
})

test("the offer's words and the chips: a found fix first; nothing works -> the button, never a duplicate chip; never a 'make it work' idea beside it; a fix card never offers to move back what it moved", () => {
	const found = { state: "found", say: "lower the box 4 cm", label: "Lower the box 4 cm", checked: "The egg lands in the box", sceneJSON: "{}" }
	assert.deepEqual(offerWords(found), { before: "Want me to ", say: "lower the box 4 cm", checked: "the egg lands in the box" })
	assert.equal(inSentence("Ball 2 lands in the box"), "Ball 2 lands in the box")
	const sugg = [{ label: "Use empty cans", prompt: "Make all the soda cans empty so they topple more easily" }, { label: "Make it work again", prompt: "Make it work again so the egg lands in the box" }, { label: "Add a cereal box finale", prompt: "Add a cereal box at the end" }]
	const c1 = editChips({ mode: "edit", fix: found, goals: [{ label: "x", ok: false }], suggestions: sugg }, { isOutcome: statesOutcome })
	// (no idea of the AI's at all beside the checked fix, an addition included: each is an unchecked change of the machine (V8820; V8832 P7))
	assert.deepEqual(c1.map((c) => c.label), ["Lower the box 4 cm"])
	assert.equal(c1[0].go, true)
	const none = { state: "none", runs: 120, rework: { text: "Make it work again so that the egg lands in the box." } }
	const c2 = editChips({ mode: "edit", fix: none, goals: [{ label: "x", ok: false }], suggestions: sugg }, { isOutcome: statesOutcome })
	assert.ok(!c2.some((c) => /rework|make it work/i.test(c.label)), "the button beside the words says it: no chip twice, no unchecked 'make it work'")
	// (a reply that changed nothing but owes it: the chip)
	assert.ok(editChips({ replyOnly: true, fix: { ...none, quiet: true }, fixNeeded: true }).some((c) => c.rework))
	// (it works: no idea to make it work)
	const ok = editChips({ mode: "edit", goals: [{ label: "x", ok: true }], suggestions: [{ label: "Make the egg land in it", prompt: "Make the egg land in the box" }, { label: "Add a duck", prompt: "Add a duck" }] }, { examples: ["Make it work", "Move the box 10 cm left"], isOutcome: statesOutcome })
	assert.deepEqual(ok.map((c) => c.label), ["Add a duck", "Move the box 10 cm left"])
	// (while "the egg lands in the box" works, never an example that moves the box)
	// (right after a fix that works, no example that changes the machine again: "Make Ramp 1 steeper" beside "the egg lands in the box ✓", c00)
	const ok2 = editChips({ mode: "fix", human: ["stood a closed laptop on its edge"], goals: [{ label: "The egg lands in the box", ok: true }], suggestions: [] }, { examples: ["Move the box 10 cm left", "Make Ramp 1 steeper"], isOutcome: statesOutcome })
	assert.deepEqual(ok2.map((c) => c.label), [])
	// (after a fix that works: no idea at all, the AI's carried ones included: each would change the machine again (V8820: "Add more dominoes"
	// right after "the tennis ball lands in the box ✓"))
	const fixCard = editChips({ mode: "fix", human: ["moved the cup 92 cm right"], goals: [{ label: "x", ok: true }], suggestions: [{ label: "Swap the golf ball for a basketball", prompt: "Swap the golf ball for a basketball" }, { label: "Move the cup 10 cm left", prompt: "Move the cup 10 cm left" }] })
	assert.deepEqual(fixCard.map((c) => c.label), [])
	// (a fix card that still misses: never "move the cup 10 cm left" (what it moved), nor any other idea while the goal fails (V8832 P7))
	const nearCard = editChips({ mode: "fix", human: ["moved the cup 92 cm right"], goals: [{ label: "x", ok: false }], fix: { state: "none" }, suggestions: [{ label: "Add a duck to watch", prompt: "Add a rubber duck on the table" }, { label: "Move the cup 10 cm left", prompt: "Move the cup 10 cm left" }, { label: "Heavier ball", prompt: "Swap the golf ball for a heavier one" }] })
	assert.deepEqual(nearCard.map((c) => c.label), [])
	assert.equal(progressWords({ phase: "search", runs: 42 }), " · 42 physics runs")
	assert.equal(progressWords({ phase: "ai" }), " · asking the AI to rework it")
	assert.doesNotMatch(reworkWords("The egg lands in the box", ["replaced the 7 dominoes with 6 standing soda cans (370 g each)"]), /\bchange\b/i)
})

test("the rework button's request is a pure 'make it work' whatever its words (the aim and the rounds run), and never brings back what was taken away", async () => {
	const scene = starter()
	scene.items.find((i) => i.id === "box").x = Math.round((2.735 + 0.12) * 1e5) / 1e5
	const sim = await simulate(scene)
	const log = []
	const miss = { kind: "fix", reply: "I moved the box.", patches: [{ op: "move", id: "box", dx: 0.05 }] }
	const r = await createOrchestrator({ api: mockApi({ edit: miss }, log), progress: false }).build({ text: "Make it work again so that Ball 2 lands in the box. Change whatever else is needed.", mode: "edit", scene, sim, rework: true }).result
	assert.ok(r.edit.fixFlow, "a make-it-work")
	assert.ok(r.edit.fixFlow.aimed || r.edit.fixFlow.rounds > 0, `the aim or the rounds ran: ${JSON.stringify(r.edit.fixFlow)}`)
	// (an answer that brings back a kind the person's change took away is not taken)
	const scene2 = starter()
	scene2.items = scene2.items.filter((i) => i.id !== "dominoes")
	const sim2 = await simulate(scene2)
	const putBack = { kind: "fix", reply: "I put the dominoes back.", patches: [{ op: "add", item: { id: "dom2", type: "domino-row", name: "Dominoes", props: {}, place: { on: "table", x: 1.82 } } }] }
	const r2 = await createOrchestrator({ api: mockApi({ edit: putBack }), progress: false }).build({ text: "Make it work again so that Ball 2 lands in the box.", mode: "edit", scene: scene2, sim: sim2, rework: true, removedTypes: ["domino-row"] }, { aimFirst: false }).result
	assert.ok(!(r2.scene?.items ?? []).some((i) => i.type === "domino-row"), "the dominoes never come back")
})

test("an edit of a built-in scene keeps every kind of goal it had (the strike, the bounces): judged on the card, kept in the scene for the next edit", async () => {
	const scene = gallery("bowling-strike")
	assert.deepEqual(planFromScene(scene).goals.map((g) => g.kind), ["hits", "falls"], "planFromScene keeps each goal whole")
	const sim = await simulate(scene)
	const r = await createOrchestrator({ api: mockApi({ edit: { kind: "change", reply: "Swapped it.", patches: [{ op: "replace_type", id: "ball", type: "orange" }] } }), progress: false }).build({ text: "swap the bowling ball for an orange", mode: "edit", scene, sim }).result
	assert.deepEqual(r.goals.map((g) => g.kind), ["hits", "falls"])
	assert.deepEqual(r.scene.goals.map((g) => g.kind), ["hits", "falls"], "the scene on the table still has them")
	assert.ok(r.goals.some((g) => g.ok === false), "a strike that no longer happens is said, never a bare 'Done.'")
	assert.doesNotMatch(r.lead, /^Done\.$/)
})

test("an edit never makes up goals the words don't ask for (16 Oct: 'All the soda cans fall' left nothing to offer); a goal it carries on, or renames, is kept", async () => {
	const scene = starter()
	const sim = await simulate(scene)
	const ans = breakfast()
	ans.patches.push({ op: "set_goals", goals: [{ kind: "in", item: "ball2", container: "box", label: "The egg lands in the box with the duck" }, { kind: "falls", items: ["can1", "can2", "can3", "can4", "can5", "can6"], label: "All the soda cans fall" }] })
	const r = await createOrchestrator({ api: mockApi({ edit: ans }), progress: false }).build({ text: "Turn this into a breakfast-table disaster: swap the red ball for an orange and the yellow ball for an egg, replace the dominoes with a row of standing soda cans, and put a rubber duck in the box waiting for its egg.", mode: "edit", scene, sim }).result
	assert.deepEqual(r.goals.map((g) => g.label), ["The egg lands in the box with the duck"])
	assert.equal(r.edit.goalsKept, true)
	// (words that ask for an outcome may set goals)
	const asked = await createOrchestrator({ api: mockApi({ edit: { kind: "change", reply: "Added.", patches: [{ op: "set_goals", goals: [{ kind: "in", item: "ball2", container: "box", label: "Ball 2 lands in the box" }, { kind: "moves", item: "ball1", label: "Ball 1 moves" }] }] } }), progress: false }).build({ text: "add a goal: Ball 1 moves at least 5 cm", mode: "edit", scene, sim }).result
	assert.deepEqual(asked.goals.map((g) => g.label), ["Ball 2 lands in the box", "Ball 1 moves"])
})

test("a goal into a plastic cup or a glass jar is judged by its walls (the engine checks only boxes, cups, buckets and baskets), never dropped", async () => {
	const { checkGoals } = await import("../goals.js")
	const { solve } = await import("../solver.js")
	const at = (x) => ({ version: 2, name: "x", seconds: 1.5, release: 0.2, stage: { x0: -0.6, x1: 3.2, y0: -0.2, y1: 2.4 }, items: [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }, { id: "c", type: "plastic-cup", x: 1, y: 0, angle: 0, props: {} }, { id: "b", type: "golf-ball", x, y: 0.3, props: {} }], goals: [] })
	assert.equal(checkGoals([{ kind: "in", item: "b", container: "c", label: "in" }], await simulate(at(1)))[0].ok, true)
	assert.equal(checkGoals([{ kind: "in", item: "b", container: "c", label: "in" }], await simulate(at(1.06)))[0].ok, false)
	const r = solve({ title: "x", items: [{ id: "c", type: "plastic-cup", place: { on: "table", x: 1 } }, { id: "b", type: "golf-ball", held: true, place: { on: "air", x: 1, y_m: 0.3 } }], goals: [{ kind: "in", item: "b", container: "c", label: "The golf ball drops into the cup" }] })
	assert.deepEqual(r.goals.map((g) => g.label), ["The golf ball drops into the cup"], "kept with the plan's goals")
	// (handed to the engine as its "walls" kind, judged by the cup's own walls, so the results under the view show it too: V8817 c12)
	assert.deepEqual(r.scene.goals, [{ kind: "walls", item: "b", container: "c", label: "The golf ball drops into the cup" }])
	const run = await simulate({ ...at(1), goals: r.scene.goals })
	assert.equal(run.summary.goals[0].ok, true, "the engine's own summary: in")
	assert.equal((await simulate({ ...at(1.06), goals: r.scene.goals })).summary.goals[0].ok, false, "the engine's own summary: out")
	assert.ok(!r.issues.some((i) => i.code === "goal_unchecked" && i.level !== "info"), "said, never as a warning")
})

test("a swap with about the same weight says so; a material change is said as what it is made of", async () => {
	const gal = gallery("seesaw-launch")
	const ball = gal.items.find((i) => i.type === "tennis-ball")
	const b = JSON.parse(JSON.stringify(gal))
	Object.assign(b.items.find((i) => i.id === ball.id), { type: "egg", name: "Egg", props: {} })
	assert.match(humanChangeList(gal, b).find((c) => /egg/.test(c.text)).text, /for an egg \(57 g, about the same weight\)$/)
	const cup = starter()
	const c2 = JSON.parse(JSON.stringify(cup))
	c2.items.find((i) => i.id === "box").props = { ...(c2.items.find((i) => i.id === "box").props ?? {}), material: "cardboard" }
	assert.match(humanChangeList(cup, c2)[0].text, /^made the box of cardboard \(was varnished hardwood/)
})
