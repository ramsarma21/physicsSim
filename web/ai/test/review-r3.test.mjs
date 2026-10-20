// The review of round 2's creative-edit repairs (V8832 / V8833, 16 Oct; ai/DESIGN.md §16.3): a checked offer keeps every length and the
// weight of the person's things, a fix that works with the machine playing no part is refused, an outcome edit tunes only what its outcome
// clause names, no idea of the AI's while a goal fails, a reply's chips follow its scene's card, a "make it work" that still fails leaves the
// scene as it was, the person's words only are theirs, unasked parts of a change say why, goal labels follow the change, "next to the box" is
// said and kept so, and "Not done: moving X" only for what the verb moves. Every scene runs on the real engine; no model is called.
//   node --test web/ai/test/review-r3.test.mjs
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createOrchestrator, unmovedAsks, humanChangeList, personWords, outcomeClause, anchorsOf, unaskedMoves, editLead, relabelGoals, swapPhraseLabels, placeLabels, propChange } from "../orchestrator.js"
import { keepsCharacter, characterBreak, chainBreak, chainOf, fixTargets, judge, outcomeWords, dimKeys } from "../fixer.js"
import { editChips, offerWords, nameAsShown } from "../edit-turns.js"
import { kindNoun, aKindOf } from "../words.js"
import { prepare, finish } from "../../sim/index.js"
import { handle } from "../../sim/engine-worker.js"

const simulate = async (scene, signal) => {
	if (signal?.aborted) throw Object.assign(new Error("Cancelled"), { name: "AbortError" })
	const { scene: s, doc, resolved } = prepare(JSON.parse(JSON.stringify(scene)))
	const msg = handle({ id: 1, doc, rate: 120 })
	if (msg.error !== undefined) throw new Error(msg.error)
	const meta = finish(s, doc, resolved, msg.track)
	return { key: "k", ms: msg.ms, track: msg.track, doc: meta.doc, summary: meta.summary, warnings: meta.warnings, resolved }
}
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/r3/${name}.json`, import.meta.url)))
const replays = fixture("replays")
const replay = (id) => replays.find((r) => r.id === id)
const starter = () => JSON.parse(readFileSync(new URL("../../scenarios/rube-goldberg.json", import.meta.url)))
/** /api/ai/edit answers `edit`; every other AI step fails (nothing is spent). */
const apiWith = (edit) => async (path, body, signal) => {
	if (path === "/api/simulate") return simulate(body.scene, signal)
	if (path !== "/api/ai/edit") return { ok: false, error: "no AI here", code: "error", retryable: false }
	return edit ? { ok: true, result: JSON.parse(JSON.stringify(typeof edit === "function" ? edit(body.payload) : edit)), model: "mock/edit", ms: 5 } : { ok: false, error: "no AI here", code: "error", retryable: false }
}
/** A recorded case built as the panel builds it, its edit step answered as it was live. */
async function built(id) {
	const c = replay(id)
	const sim = await simulate(c.scene)
	return createOrchestrator({ api: apiWith(c.answer), progress: false }).build({ text: c.text, mode: "edit", scene: c.scene, sim }).result
}

// ---- P2: the character check covers every length and the weight as the engine builds it
test("keepsCharacter: a cardboard box made 1 m deep, or a pendulum's bob made bigger and 4× heavier, is not the person's thing any more", () => {
	const sc = fixture("n5-edit")
	const box = sc.items.find((i) => i.id === "b1")
	const pend = sc.items.find((i) => i.type === "rope-pendulum")
	assert.ok(dimKeys("cardboard-box").len.includes("depth"), "a box's depth is one of its lengths")
	assert.ok(dimKeys("rope-pendulum").kg.includes("bob_mass"), "a bob's weight is one of its weights")
	assert.equal(keepsCharacter(box, { ...box, props: { ...box.props, depth: 1 } }), "it made Box 1 far bigger (depth 10 cm → 1 m)")
	assert.match(keepsCharacter(pend, { ...pend, props: { ...pend.props, bob_diameter: 0.08 } }), /^it made the rope pendulum far heavier \(514 g → 2\.1 kg\)$/)
	assert.match(keepsCharacter(pend, { ...pend, props: { ...pend.props, bob_mass: 3 } }), /far heavier/)
	// (a small change stays the person's thing: 10 % deeper)
	assert.equal(keepsCharacter(box, { ...box, props: { ...box.props, depth: 0.11 } }), null)
	// (and a thing that isn't theirs is free to change: mine false)
	assert.equal(keepsCharacter(box, { ...box, props: { ...box.props, depth: 1 } }, { mine: false }), null)
	const before = JSON.parse(JSON.stringify(sc))
	for (const i of before.items) if (i.id === "b1") i.type = "brick"
	const after = JSON.parse(JSON.stringify(sc))
	after.items.find((i) => i.id === "b1").props.depth = 1
	assert.match(characterBreak(sc, after, before, null) ?? "", /depth 10 cm → 1 m/)
})

test("a change's words give each value in its own unit, and a weight once: 'depth 10.3 cm → 1.5 m', 'bob weight 514 g → 3 kg'", () => {
	assert.equal(propChange("cardboard-box", "depth", 0.1025, 1.5), "depth 10.3 cm → 1.5 m")
	assert.equal(propChange("cardboard-box", "width", 0.215, 0.25), "width 21.5 → 25 cm")
	assert.equal(propChange("rope-pendulum", "bob_mass", 0.514, 3), "bob weight 514 g → 3 kg")
	const a = fixture("n5-edit")
	const b = JSON.parse(JSON.stringify(a))
	b.items.find((i) => i.type === "rope-pendulum").props.bob_mass = 3
	const line = humanChangeList(a, b).map((c) => c.text).find((t) => /pendulum/.test(t))
	assert.equal(line, "made the rope pendulum heavier (bob weight 514 g → 3 kg)", "never '(bob weight 0.514 → 3 kg; 514 g → 3 kg)'")
})

// ---- P3: the machine must set the goal's thing off
test("chainBreak: Ball 2 rolling off the pillow on its own into a box slid under it is refused, whatever the person's version does; the lead says why", async () => {
	const f = fixture("x3-pillow")
	const [sb, se, sk] = [await simulate(f.before), await simulate(f.edit), await simulate(f.fix)]
	const ctx = { scene: f.edit, sim: se, before: { scene: f.before, sim: sb } }
	assert.equal(chainOf(sb, f.before).get("ball2")?.by, "seesaw", "the seesaw threw Ball 2")
	assert.equal(chainOf(sk, f.fix).get("ball2")?.by, null, "in the fix nothing does")
	assert.ok(sk.summary.goals.every((g) => g.ok), "the trap: the recorded fix meets the goal")
	assert.match(chainBreak(ctx, f.fix, sk) ?? "", /^nothing in the machine sets Ball 2 off: it starts moving on its own \(at 0\.\d+ s\)$/)
	// (the edit's own lead: what launched it is gone)
	const tg = fixTargets({ goals: f.edit.goals, scene: f.edit, before: ctx.before, sim: se })
	const res = judge(tg, se)
	const i = res.findIndex((r) => r.ok === false)
	assert.equal(outcomeWords(res[i], tg[i].goal, se, f.edit, ctx.before), "Ball 2 is never launched: nothing launches it now that the seesaw is a pillow")
})

// ---- P4: an outcome edit tunes only what its outcome clause is about
test("outcome edit: 'so the apple lands softly' never moves the seesaw as part of the edit (V8832 m6)", async () => {
	assert.equal(outcomeClause("Swap the tennis ball for an apple and the heavy steel weight for a heavy bowling ball, and put a sponge in the basket so the apple lands softly."), "so the apple lands softly")
	assert.equal(outcomeClause("Move the box to x 1.9 so the ball still lands in it"), "so the ball still lands in it")
	const r = await built("m6")
	const ids = (r.fixApplied?.changes ?? []).flatMap((x) => (Array.isArray(x.ids) ? x.ids : [x.id]))
	assert.ok(!ids.includes("seesaw"), `the seesaw is the card's offer, never applied: ${r.fixApplied?.did}`)
	// (a goal's line names the seesaw it is about, "changed the goal “The steel weight hits the seesaw” (…)": never a move of it)
	assert.ok(!r.human.some((l) => /seesaw/.test(l) && !/^changed the goal “/.test(l)), r.human.join(" | "))
	// (a fix of what the change swapped in, applied with it, is said as the fix: never "everything still works" over a move nobody asked for)
	if (r.fixApplied) assert.match(r.lead, new RegExp(`^Done, and I ${r.fixApplied.did.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} so it works`), r.lead)
})

// ---- P5 / P6: chips
test("chips: no idea of the AI's while a goal fails or a fix is offered; a reply's chips follow its scene's card (V8832 P7, y2, y19)", () => {
	const ideas = [{ label: "Use more soda cans", prompt: "Make the soda can row longer by adding two more cans before the seesaw" }, { label: "Let dominoes grow slightly", prompt: "Make the dominoes grow a little in size" }, { label: "Switch the fan on later", prompt: "Turn the fan on one second later" }, { label: "Add a cereal box", prompt: "Add a cereal box on the table" }]
	const found = { state: "found", say: "stand a closed laptop by the seesaw", label: "Stand a closed laptop by the seesaw", checked: "The egg lands in the box", sceneJSON: "{}" }
	assert.deepEqual(editChips({ mode: "edit", goals: [{ label: "The egg lands in the box", ok: false }], fix: found, suggestions: ideas }).map((c) => c.label), ["Stand a closed laptop by the seesaw"])
	assert.deepEqual(editChips({ mode: "edit", goals: [{ label: "x", ok: false }], fix: { state: "searching" }, suggestions: ideas }).map((c) => c.label), [])
	assert.deepEqual(editChips({ mode: "edit", goals: [{ label: "x", ok: false }], fix: { state: "none", runs: 100 }, suggestions: ideas }).map((c) => c.label), [])
	// (it works: ideas and examples as before; but right after the edit went on with its fix, none: V8832 m6, "Drop the bowling ball higher")
	assert.ok(editChips({ mode: "edit", goals: [{ label: "x", ok: true }], suggestions: ideas.slice(3) }).some((c) => c.label === "Add a cereal box"))
	assert.deepEqual(editChips({ mode: "edit", fixApplied: { did: "moved the bowling ball 1 cm left" }, goals: [{ label: "x", ok: true }], suggestions: ideas.slice(3) }, { examples: ["Make Ramp 1 steeper"] }).map((c) => c.label), [])
	// (a reply after a fix that just worked: no example that changes the machine again)
	const fixCard = { mode: "fix", goals: [{ label: "The egg lands in the box", ok: true }] }
	const reply = { replyOnly: true, reply: "There’s nothing to say yes to yet — what would you like to change?", suggestions: [] }
	const ex = ["Move the box 10 cm left", "Make Ramp 1 steeper", "Add a tennis ball that rolls into it"]
	assert.deepEqual(editChips(reply, { examples: ex, scene: fixCard }).map((c) => c.label), [])
	// (a reply on a broken scene: none either, the failing goal's own container included)
	assert.deepEqual(editChips(reply, { examples: ["Swap the tennis ball for a basketball", "Move the basket 10 cm left"], scene: { mode: "edit", goals: [{ label: "The tennis ball lands in the basket", ok: false }], fix: { state: "none" } } }).map((c) => c.label), [])
	// (no card put the scene there: no example)
	assert.deepEqual(editChips(reply, { examples: ex, scene: null }).map((c) => c.label), [])
	// (a reply about a scene that works, after a plain change: examples as before)
	assert.ok(editChips(reply, { examples: ex, scene: { mode: "edit", goals: [{ label: "Ball 2 lands in the box", ok: true }] } }).length > 0)
	// (a stopped search whose scene came back: said so, with the button)
	assert.deepEqual(offerWords({ state: "stopped", back: true }), { text: "I stopped looking for a fix when the scene changed.", button: "Ask the AI to rework it" })
	// (an idea that names a group by its name: by its kind)
	assert.deepEqual(nameAsShown({ label: "Add more dominoes", prompt: "Add 3 more dominoes to Dominoes before the seesaw" }, [{ id: "dominoes", type: "domino-row", name: "Dominoes" }], () => "Domino row").prompt, "Add 3 more dominoes to the dominoes before the seesaw")
})

// ---- P7: a "make it work" typed in the open that still fails leaves the scene as it was
test("a typed 'make it work' that still doesn't work is said, nothing goes on the table, and only the closest miss is offered as 'Try:' (V8832 y20)", async () => {
	const scene = starter()
	scene.items.find((i) => i.id === "box").x = Math.round((2.735 + 0.3) * 1e5) / 1e5
	const sim = await simulate(scene)
	const miss = { kind: "fix", mode: "patch", reply: "I moved the seesaw 15 cm right.", patches: [{ op: "move", id: "seesaw", dx: 0.15 }], missing: [], suggestions: [{ label: "Ask again", prompt: "Make it work" }] }
	const r = await createOrchestrator({ api: apiWith(miss), progress: false }).build({ text: "make it work again", mode: "edit", scene, sim }).result
	if (r.replyOnly) {
		assert.match(r.reply, /^I couldn’t (make it work \(I tried: .+\)|find anything to change that makes it work): .+\. Your scene is as it was\.$/, r.reply)
		assert.equal(r.scene, undefined, "nothing of it goes on the table")
		assert.equal(r.reworkFailed, true, "no new paid button on it")
		const chips = editChips(r, { rework: true })
		assert.ok(chips.every((c) => /^Try: /.test(c.label)), JSON.stringify(chips))
	} else assert.ok(r.goals.every((g) => g.ok), "it works (the fix search found one): fine as well")
	// (the lead of one that works says every line of the change list, never the fix's words alone: V8832 y8)
	assert.equal(editLead({ targets: [{ label: "The egg lands in the box", ok: true }], fixApplied: { did: "stood a closed laptop …" }, said: [{ text: "added a closed laptop, on its edge, between the soda cans and the seesaw", name: "the laptop" }, { text: "spaced the 6 soda cans closer together (9 → 7 cm apart)", name: "the soda cans" }, { text: "emptied the 6 soda cans (370 g → 15 g each)", name: "the soda cans" }], changes: ["x"] }), "Done! I added a closed laptop, on its edge, between the soda cans and the seesaw, spaced the 6 soda cans closer together (9 → 7 cm apart) and emptied the 6 soda cans (370 g → 15 g each) — the egg lands in the box ✓")
})

// ---- P8: only the person's words are theirs
test("a target's words are said as the person's only when they are: in the request, letters, a count that is the group's (V8832 c09, y15)", () => {
	assert.equal(personWords("(neighbour moved to make room)", "Swap the superball for a tennis ball"), null)
	assert.equal(personWords("the yellow ball", "swap the yellow ball for a tennis ball"), "the yellow ball")
	assert.equal(personWords("the yellow ball", "swap Ball 2 for a tennis ball"), null)
	assert.equal(personWords("the 9 cardboard boxes", "a stack of 9 cardboard boxes", { n: 2, all: 9 }), null)
	assert.equal(personWords("the cardboard boxes", "a stack of cardboard boxes", { n: 2, all: 9 }), null, "two of nine are never 'the cardboard boxes'")
	assert.equal(personWords("the top two boxes", "make the top two boxes deeper", { n: 2, all: 9 }), "the top two boxes")
	const c = replay("c09")
	const a = c.scene
	const b = JSON.parse(JSON.stringify(a))
	b.items.find((i) => i.id === "basket").x += 0.26
	const lines = humanChangeList(a, b, { says: [{ says: "(neighbour moved to make room)", ids: ["basket"] }], text: c.text }).map((x) => x.text)
	assert.deepEqual(lines, ["moved the basket 26 cm right"])
})

// ---- P9: what was moved beyond what was asked says why
test("unasked parts of a change: the line says why, and the lead when it is what broke the goal (V8832 p3, m3, c02)", async () => {
	const p3 = await built("p3")
	assert.deepEqual(p3.human, ["moved the box 30 cm left and 12 cm up, to clear the dominoes"])
	assert.match(p3.lead, /^Done, but to clear the dominoes I also raised the box 12 cm, and now Ball 2 doesn't fly high enough to get into the box/)
	const m3 = await built("m3")
	assert.ok(m3.human.includes("moved the basket 12 cm right, to clear the last bounce pad"), m3.human.join(" | "))
	assert.doesNotMatch(m3.lead, /I also/, "the basket's move is not why the golf ball misses the last pad")
	const c02 = await built("c02")
	assert.ok(c02.human.includes("moved the bowling ball 2.6 cm right, to sit on the middle of the pedestal"), c02.human.join(" | "))
})

// ---- P10: labels and words
test("goal labels follow the change: the head pin is the first water bottle, the giant the stack of books, trampoline 3 the last trampoline (V8832 c03, c02, c09)", async () => {
	const c03 = await built("c03")
	assert.ok(c03.goals.some((g) => g.label === "The orange hits the first water bottle"), c03.goals.map((g) => g.label).join(" | "))
	const c02 = await built("c02")
	assert.deepEqual(c02.goals.slice(2).map((g) => g.label), ["The growing dominoes fall, up to the stack of hardcover books", "The stack of hardcover books knocks the bowling ball into the bucket"])
	const c09 = await built("c09")
	assert.deepEqual(c09.goals.map((g) => g.label).slice(0, 3), ["It bounces off the first trampoline", "It bounces off the 2nd trampoline", "It bounces off the last trampoline"])
	// (the rules themselves: a place word kept, any other word before it the AI's own name and left; a name the person said stays)
	const plan = { items: [{ id: "ball", type: "orange" }, { id: "pin1", type: "water-bottle" }], goals: [{ kind: "hits", item: "ball", target: "pin1", label: "The orange hits the head pin" }, { kind: "hits", item: "ball", target: "pin1", label: "The orange hits the bowling pin" }] }
	relabelGoals(plan, "pin1", ["Pin 1", "Bowling pin", "bowling pin"], "standing water bottle", [], null, "pin", { short: "water bottle" })
	assert.equal(plan.goals[0].label, "The orange hits the first water bottle")
	const p2 = { goals: [{ kind: "in", label: "The giant knocks the 8-ball into the bucket" }] }
	swapPhraseLabels(p2, "Swap the giant domino for a stack of hardcover books and the 8-ball for a bowling ball.")
	assert.equal(p2.goals[0].label, "The stack of hardcover books knocks the 8-ball into the bucket")
	const g3 = [{ label: "The golf ball lands in cup 3" }]
	placeLabels(g3, [1, 2, 3, 4].map((k) => ({ id: `cup${k}`, type: "plastic-cup", name: `Cup ${k}`, x: k * 0.3 })), "make the golf ball land in cup 3")
	assert.equal(g3[0].label, "The golf ball lands in cup 3", "the person's own 'cup 3' stays")
})

test("words: no kind in brackets when the name says it, 'were' for a row, the AI's carried goal kept, Rubik's capitalised (V8832 m2, c13, m1)", async () => {
	const m2 = await built("m2")
	assert.ok(m2.human.includes("swapped the plastic ball for a tennis ball (6.3 g → 58 g)"), m2.human.join(" | "))
	assert.equal(m2.edit.goalsDropped, undefined, "the AI carried 'The big domino slams the seesaw' over as 'The last remote slams the seesaw'")
	assert.ok(m2.goals.some((g) => g.label === "The last remote slams the seesaw"))
	assert.equal(new Set(m2.goals.map((g) => g.label)).size, m2.goals.length, "no goal twice")
	const c13 = await built("c13")
	assert.ok(c13.human.includes("swapped the cue ball for a golf ball (170 g → 46 g)") && c13.human.some((l) => /^swapped the swing gate for a spring gate/.test(l)), c13.human.join(" | "))
	assert.equal(kindNoun("rubiks-cube", 4), "Rubik's cubes")
	assert.equal(aKindOf("rubiks-cube"), "a Rubik's cube")
	// (a numbered name says little: its kind goes with it)
	const a = { items: [{ id: "table", type: "table", x: 1.3, y: 0 }, { id: "b", type: "plastic-ball", name: "Ball 2", x: 1, y: 0.3, props: {} }] }
	const b = { items: [{ id: "table", type: "table", x: 1.3, y: 0 }, { id: "b", type: "tennis-ball", x: 1, y: 0.3, props: {} }] }
	assert.match(humanChangeList(a, b)[0].text, /^swapped Ball 2 \(the hollow plastic ball\) for a tennis ball/)
})

// ---- P12: "next to the box"
test("'put a sneaker next to the box': the line says the person's anchor, and the lead says it is in the way (V8832 m1, m2, c13)", async () => {
	const s = starter()
	const after = { ...s, items: [...s.items, { id: "sneaker", type: "sneaker", name: "Sneaker", x: 2.3, y: 0 }] }
	assert.deepEqual([...anchorsOf("…and put a sneaker next to the box.", s, after)], [["sneaker", { anchor: "box", words: "next to the box" }]])
	const m1 = await built("m1")
	assert.ok(m1.human.includes("added a sneaker next to the box"), m1.human.join(" | "))
	assert.ok(m1.human.some((l) => /Rubik's cubes/.test(l)), m1.human.join(" | "))
	// (round 7, V8842 k1: "in the way" only when the run without it gets further; here the Rubik's cubes reach nothing without the sneaker
	// either, so the lead says what happens and never blames the sneaker)
	if (m1.goals.some((g) => g.ok === false)) assert.doesNotMatch(m1.lead, /the sneaker is in the way/, m1.lead)
	const c13 = await built("c13")
	assert.ok(c13.human.includes("added a rubber duck on the table next to the box"), c13.human.join(" | "))
	// (the search may slide it along: only its height is held)
	const keep = new Map((m1.edit?.touched ?? []).map(([id, keys]) => [id, keys]))
	if (keep.has("sneaker")) assert.ok(!keep.get("sneaker").includes("place") && keep.get("sneaker").includes("place-y"), JSON.stringify(keep.get("sneaker")))
})

// ---- P16: "Not done: moving X" only for what the verb moves
test("unmovedAsks: the place a thing is to go is never a thing to move, and a change of its settings answers it (V8833 AB)", () => {
	const a = starter()
	const clone = (o) => JSON.parse(JSON.stringify(o))
	const mv = (b, id, dx, dy = 0) => {
		const it = b.items.find((i) => i.id === id)
		it.x = (Number(it.x) || 0) + dx
		if (dy) it.y = (Number(it.y) || 0) + dy
		return b
	}
	assert.deepEqual(unmovedAsks("Move the dominoes closer to the seesaw.", a, mv(clone(a), "dominoes", 0.06)), [])
	assert.deepEqual(unmovedAsks("move the box closer to the seesaw", a, mv(clone(a), "box", -0.1)), [])
	assert.deepEqual(unmovedAsks("move Ball 1 to the top of Ramp 1", a, mv(clone(a), "ball1", -0.05, 0.03)), [])
	assert.deepEqual(unmovedAsks("slide the box under the end of Ramp 2", a, mv(clone(a), "box", -0.4)), [])
	const spaced = clone(a)
	spaced.items.find((i) => i.id === "dominoes").props = { spacing: 0.45 }
	assert.deepEqual(unmovedAsks("move the dominoes closer together", a, spaced), [], "a setting changed is the move")
	const tilt = clone(a)
	tilt.items.find((i) => i.id === "seesaw").props = { ...(tilt.items.find((i) => i.id === "seesaw").props ?? {}), tilt: 5 }
	assert.deepEqual(unmovedAsks("lower the seesaw's tilt to 5°", a, tilt), [])
	assert.deepEqual(unmovedAsks("raise the top ramp 5 cm", a, mv(clone(a), "ramp1", 0, 0.05)), [], "one of two ramps named by a shared word, and it moved")
	// (and what was really left out is still said)
	assert.deepEqual(unmovedAsks("make it twice as long: double the dominoes and move the seesaw and the box along", a, a), ["moving the seesaw and the box along (the AI left it out: ask again)"])
	assert.deepEqual(unmovedAsks("move the box 30 cm left", a, a), ["moving the box (the AI left it out: ask again)"])
})
