// The review of §16.2 (r2-problems: VERIFY regress-r2 and V8820 ux-r2, 16 Oct): an edit makes exactly the asked change, says honestly what
// stopped working, and OFFERS only a change checked in the engine that keeps what the person chose: kinds, counts, and the character of their
// words ("heavy", "big"); no idea chip is an unchecked fix or a swap that undoes their choice; the card's words name things as they are.
//   node --test web/ai/test/review-r2.test.mjs   (the panel's own steps: web/ai/test/make-it-work.e2e.mjs)
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createOrchestrator, choicesOf, wordChoices, editLead, clauseName, humanChangeList, unmovedAsks, AI_USD, AI_IN_USD, AI_OUT_USD } from "../orchestrator.js"
import { keepsCharacter, characterBreak, waysOf, placeName, fixWords, findFix, applyChanges, standardSized, STD_SIZE } from "../fixer.js"
import { editChips, undoesKinds, FIX_IDEA, nameAsShown, offerWords, progressWords } from "../edit-turns.js"
import { weightOf } from "../words.js"
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
const starter = () => JSON.parse(readFileSync(new URL("../../scenarios/rube-goldberg.json", import.meta.url)))
const gallery = (slug) => JSON.parse(readFileSync(new URL(`../../gallery/${slug}.json`, import.meta.url)))
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/review-r2/${name}.json`, import.meta.url)))
const sleep = (ms, signal) =>
	new Promise((resolve, reject) => {
		const t = setTimeout(resolve, ms)
		signal?.addEventListener?.("abort", () => (clearTimeout(t), reject(Object.assign(new Error("Cancelled"), { name: "AbortError" }))), { once: true })
	})
/** A mock of the app's api(): /api/ai/<step> answers from `answers[step]` (a value, or a function of the payload, the call's number and its signal). */
function mockApi(answers, log = []) {
	return async (path, body, signal) => {
		if (path === "/api/simulate") return simulate(body.scene, signal)
		if (path.startsWith("/api/ai/progress")) {
			const a = answers.progress
			return typeof a === "function" ? a(path) : { ok: false, error: "no such AI request" }
		}
		const step = path.replace("/api/ai/", "")
		const rec = { step, payload: body.payload, aborted: false }
		log.push(rec)
		signal?.addEventListener?.("abort", () => (rec.aborted = true), { once: true })
		let a = answers[step]
		if (typeof a === "function") a = await a(body.payload, log.filter((l) => l.step === step).length, signal)
		if (a instanceof Error) throw a
		if (a === undefined) throw Object.assign(new Error(`no mock answer for ${step}`), { status: 500 })
		return { ok: true, result: a.result ?? a, model: `mock/${step}`, ms: 5, usage: a.usage ?? { costInUSD: 0.01 } }
	}
}
/** An edit of a scene as the drawer makes it (one run, no critic), the edit step's answers given in order. -> {r, scene, sim} */
async function edit(scene, text, answers) {
	const sim = await simulate(scene)
	let n = 0
	const api = mockApi({ edit: () => JSON.parse(JSON.stringify(answers[Math.min(n++, answers.length - 1)])) })
	const r = await createOrchestrator({ api, progress: false }).build({ text, mode: "edit", scene, sim }).result
	return { r, scene, sim }
}

// ---- 1. (major) "heavy", "big"… without an amount: never the other way (V8820 x5: "a heavy steel weight" offered at 100 g)
test("a word without an amount is the person's choice of a way: 'a heavy steel weight' is never made lighter by a fix or a rework", async () => {
	const T = "Swap the yellow ball for an egg and put a heavy steel weight on top of it."
	assert.deepEqual(wordChoices(T, { type: "steel-weight-1kg", name: "Steel weight" }), [["mass:up", "heavy"]])
	assert.deepEqual(wordChoices("Add a big beach ball next to the box", { type: "beach-ball", name: "Beach ball" }), [["diameter:up", "big"]])
	assert.deepEqual(wordChoices("swap the yellow ball for a light ping-pong ball", { type: "ping-pong-ball", name: "Ping-pong ball" }), [["mass:down", "light"]])
	// (a verb is no word for a way, nor is one with an amount: that is a hard choice already)
	assert.deepEqual(wordChoices("lower the box 5 cm", { type: "box", name: "Box" }), [])
	assert.deepEqual(wordChoices("make the box 5 cm wider", { type: "box", name: "Box" }), [])
	assert.deepEqual(wordChoices("put a tall stack of books under it", { type: "hardcover-book", name: "Book 1" }), [], "the stack is tall, not each book")
	const scene = starter()
	const { r } = await edit(scene, T, [
		{ kind: "change", reply: "Done.", targets: [{ says: "the yellow ball", ids: ["ball2"] }], patches: [{ op: "replace_type", id: "ball2", type: "egg", props: {} }, { op: "set_item", id: "ball2", name: "Egg" }, { op: "add", item: { id: "weight", type: "steel-weight-1kg", name: "Steel weight", props: {}, place: { on: "ball2" } } }] }
	])
	assert.ok(r.edit.hard.some(([id, keys]) => id === "weight" && keys.includes("mass:up:heavy")), JSON.stringify(r.edit.hard))
	const ctx = r.fixCtx ?? { scene: r.scene, sim: null, before: { scene }, hard: new Map(r.edit.hard.map(([id, ks]) => [id, new Set(ks)])) }
	assert.ok(ctx.hard.get("weight").has("mass:up:heavy"))
	// (the AI's rework that made it 100 g, as V8820 x5 offered it: refused, with why)
	const light = JSON.parse(JSON.stringify(r.scene))
	light.items.find((i) => i.id === "weight").props = { mass: 0.1 }
	const ai = createOrchestrator({ api: mockApi({}), progress: false })
	const v = await ai.judgeRework(ctx, { scene: light, plan: r.plan }, { mine: [], removedTypes: [], targets: null, hard: r.edit.hard })
	assert.equal(v.ok, false)
	assert.match(v.why, /^it made the steel weight lighter \(1 kg → 100 g\), and you asked for a heavy one$/)
	// (and the search never tries it: a heavier one is fine)
	assert.match(characterBreak(r.scene, light, scene, ctx.hard), /heavy one/)
	const heavier = JSON.parse(JSON.stringify(r.scene))
	heavier.items.find((i) => i.id === "weight").props = { mass: 1.4 }
	assert.equal(characterBreak(r.scene, heavier, scene, ctx.hard), null)
	// (the rework's own request says it, so the AI keeps it)
	const q = ai.reworkRequest(ctx, { lines: [] })
	assert.match(q.feedback, /the steel weight heavy \(at least its 1 kg\)/)
})

// ---- 2. a thing of the person's keeps its kind's real size and its weight (VERIFY plainswap2, V8820 c01 / c06 / n6)
test("a thing the person swapped in or added keeps its character: never a 151 g bowling ball, a 10 cm ping-pong ball or a 53 g apple", () => {
	assert.equal(standardSized("bowling-ball"), true)
	assert.equal(standardSized("apple"), true)
	assert.equal(standardSized("clay-ball"), false)
	assert.equal(STD_SIZE, 0.2)
	const bowl = { id: "ball1", type: "bowling-ball", name: "Bowling ball", props: {} }
	assert.match(keepsCharacter(bowl, { ...bowl, props: { diameter: 0.06 } }), /^it made the bowling ball 6 cm across, far from a real one’s 22 cm$/)
	const pp = { id: "pp", type: "ping-pong-ball", name: "Ping-pong ball", props: {} }
	assert.match(keepsCharacter(pp, { ...pp, props: { diameter: 0.1 } }), /10 cm across/)
	assert.equal(keepsCharacter(pp, { ...pp, props: { diameter: 0.044 } }), null, "a little bigger is still a ping-pong ball")
	const apple = { id: "a", type: "apple", name: "Apple", props: {} }
	assert.match(keepsCharacter(apple, { ...apple, props: { diameter: 0.057 } }), /5\.7 cm across, far from a real one’s/, "0.75× across")
	assert.match(keepsCharacter(apple, { ...apple, props: { diameter: 0.0623 } }), /far lighter/, "0.82× across is within a real apple's size, but 0.55× its weight")
	// (c03's fix stays: water bottles 0.8× slimmer; and a fill flipped is the AI's own way of doing it, never "far lighter")
	const bottle = { id: "b", type: "water-bottle", name: "Water bottle 1", props: {} }
	assert.equal(keepsCharacter(bottle, { ...bottle, props: { diameter: 0.052 } }), null)
	const can = { id: "c", type: "soda-can", name: "Soda can 1", props: {} }
	assert.equal(keepsCharacter(can, { ...can, props: { full: false } }), null)
	// (a thing that isn't the person's is not held to it: the search may still make a ball small enough for a box they narrowed)
	const before = { items: [{ id: "ball1", type: "superball" }] }
	assert.equal(characterBreak({ items: [{ ...bowl, type: "superball" }] }, { items: [{ ...bowl, type: "superball", props: { diameter: 0.02 } }] }, before, null), null)
	assert.match(characterBreak({ items: [bowl] }, { items: [{ ...bowl, props: { diameter: 0.06 } }] }, before, null), /bowling ball/)
})
test("the fix search never offers to shrink the person's swapped-in thing: a scale of it is not even tried", async () => {
	// (the starter, "make the red ball a bowling ball": every candidate that scales the bowling ball past its character is dropped before a run)
	const scene = starter()
	const { r } = await edit(scene, "make the red ball a bowling ball", [{ kind: "change", reply: "Done.", targets: [{ says: "the red ball", ids: ["ball1"] }], patches: [{ op: "replace_type", id: "ball1", type: "bowling-ball", props: {} }, { op: "set_item", id: "ball1", name: "Bowling ball" }] }])
	assert.ok(r.fixNeeded && r.fixCtx, "the goal stopped")
	const tried = []
	await findFix({ ...r.fixCtx, relaxed: true }, { simulate, parallel: 2, budgetMs: 3000, maxRuns: 30, debug: (c) => tried.push(c) })
	for (const c of tried) for (const x of c.changes) if (x.kind === "scale" && x.ids.includes("ball1")) assert.ok(x.k >= 0.84 && x.k <= 1.2, `a scale of the bowling ball tried: ${x.k}`)
})

// ---- 3. (major) idea chips: never an unchecked fix, never a swap that undoes the person's choice (V8820, 24 of 44 broken cards)
test("idea chips: no fix in other words beside a goal that fails, no swap of what the person put in, nothing after a fix that works", () => {
	// (the reviewer's own list, each as the AI wrote it)
	const failing = { mode: "edit", goals: [{ label: "The orange knocks the bottles", ok: false }], fix: { state: "none", runs: 100, rework: { text: "x" } } }
	const ideas = [
		{ label: "Swap orange for apple", prompt: "Swap the orange for a heavier apple" },
		{ label: "Stiffer trampolines", prompt: "Make the trampolines stiffer so the tennis ball bounces higher" },
		{ label: "Swap in a basketball", prompt: "Swap the bowling ball for a basketball" },
		{ label: "Use empty soda cans", prompt: "Use empty soda cans so they topple easily" },
		{ label: "Lift a heavier load", prompt: "Replace the orange in the pail with a baseball" },
		{ label: "Use hardcover books instead", prompt: "Use hardcover books instead of the paperbacks" },
		{ label: "Make the cans full", prompt: "Fill the soda cans" },
		{ label: "Add a cereal box topple", prompt: "Add a cereal box after the cans that topples onto the seesaw" },
		{ label: "Add a beach ball too", prompt: "Add a beach ball on the table next to the bucket" }
	]
	const chips = editChips({ ...failing, suggestions: ideas }, { mine: ["orange", "bowling ball", "trampoline", "soda can", "paperback book"] })
	// (while a goal fails, no idea at all: word lists kept letting tunings through, "Use more soda cans", "Let dominoes grow slightly" (V8832 P7))
	assert.deepEqual(chips.map((c) => c.label), [])
	// (an idea that changes what the failing goal is about is a fix too, unchecked: VERIFY rebutton, "Lower the box a bit" beside "Ball 2 never
	// lands in the box"; a new thing beside it is no fix)
	const box = editChips({ mode: "edit", goals: [{ label: "Ball 2 lands in the box", ok: false }], fix: { state: "none", runs: 50 }, suggestions: [{ label: "Lower the box a bit", prompt: "Move the box 3 cm lower" }, { label: "Bigger box to catch", prompt: "Make the box above the seesaw 1.5 times wider" }, { label: "Swap Ball 2 for a superball", prompt: "Swap Ball 2 on the seesaw for a superball" }, { label: "Drop it from higher", prompt: "Raise the red ball 20 cm higher" }, { label: "Add more dominoes", prompt: "Add 3 more dominoes to the domino row" }] })
	assert.deepEqual(box.map((c) => c.label), [])
	assert.equal(undoesKinds("Swap the orange for an apple", ["orange"]), true)
	assert.equal(undoesKinds("Put the orange into the bucket", ["orange"]), false)
	assert.equal(undoesKinds("Turn the duck into a frog", ["rubber duck", "duck"]), true)
	assert.ok(FIX_IDEA.test("Make the trampolines stiffer"))
	// (a swap of what the person put in is never offered, even when everything works)
	const works = editChips({ mode: "edit", goals: [{ label: "x", ok: true }], suggestions: [{ label: "Swap orange for apple", prompt: "Swap the orange for an apple" }, { label: "Add a duck", prompt: "Add a rubber duck" }], mineKinds: ["orange"] })
	assert.deepEqual(works.map((c) => c.label), ["Add a duck"])
	// (a fix card whose fix works: no idea at all, carried or not; V8820: "Add more dominoes" after "the tennis ball lands in the box ✓")
	assert.deepEqual(editChips({ mode: "fix", goals: [{ label: "x", ok: true }], suggestions: [{ label: "Add more dominoes", prompt: "Add 3 more dominoes" }] }).map((c) => c.label), [])
	// (the edit prompt's own chip line is left as it was: rewording it cost "make it work" answers, 13–14/20 against 16/20 with the old line
	// on the same client (r5f/r5g vs o5g, 16 Oct), so the chips are held here, on every answer, whatever the AI writes)
})
test("an idea that names a thing by its kind says it as the screen does ('Ball 2'), or is dropped when it can't be told which", () => {
	const items = [{ id: "ball2", type: "plastic-ball", name: "Ball 2" }, { id: "ball1", type: "superball", name: "Ball 1" }]
	const kind = (t) => ({ "plastic-ball": "Hollow plastic ball", superball: "Superball" })[t]
	assert.deepEqual(nameAsShown({ label: "Swap the hollow plastic ball for a basketball", prompt: "Swap the hollow plastic ball on the seesaw for a basketball" }, items, kind), { label: "Swap Ball 2 for a basketball", prompt: "Swap Ball 2 on the seesaw for a basketball" })
	assert.equal(nameAsShown({ label: "Swap the hollow plastic ball", prompt: "" }, [...items, { id: "b3", type: "plastic-ball", name: "Ball 3" }], kind), null)
})
test("out of reach: no idea at all, a size one included (V8820 h1; V8832 P7: no unchecked idea while a goal fails)", () => {
	const r = { goals: [{ label: "The bowling ball lands in the box", ok: false }], fix: { state: "none", outOfReach: true, why: "the bowling ball (22 cm across) can’t fit the box’s 2.6 cm opening" }, suggestions: [{ label: "Swap the bowling ball for a basketball", prompt: "Swap the bowling ball for a basketball" }, { label: "Make the box wider", prompt: "Make the box 30 cm wide" }] }
	assert.deepEqual(editChips(r, { examples: ["Move the box 10 cm left"], mine: ["bowling ball"] }).map((c) => c.label), [])
})

// ---- 4. the card's words
test("the card's words: no two colons in a lead, names keep their capitals, a heads-up clause says 'the seesaw', the closest miss keeps 'Ball 2'", () => {
	assert.equal(editLead({ changes: ["x"], targets: [{ label: "Ball 2 lands in the box", ok: false, was: false, happened: "Ball 2 never moves: only 6 of 7 dominoes fall" }] }), "Done, but it still doesn’t work — Ball 2 never moves: only 6 of 7 dominoes fall ✗.")
	assert.equal(editLead({ changes: ["x"], targets: [{ label: "Ball 2 lands in the box", ok: false, was: false, happened: "Ball 2 never moves" }] }), "Done, but it still doesn’t work: Ball 2 never moves ✗.")
	const scene = { items: [{ id: "s", type: "seesaw", name: "Seesaw" }, { id: "b", type: "superball", name: "Ball 1" }] }
	assert.equal(clauseName("Seesaw no longer turns", scene), "the seesaw no longer turns")
	assert.equal(clauseName("Ball 1 no longer hits Ramp 2", scene), "Ball 1 no longer hits Ramp 2")
	const near = editChips({ mode: "edit", goals: [{ label: "x", ok: false }], fix: { state: "none", near: { label: "Move the box 9.7 cm right", say: "move the box 9.7 cm right", happened: "Ball 2 hits the box", sceneJSON: "{}" } } })
	assert.match(near[0].prompt, /, but Ball 2 hits the box$/)
	// (to make room, said as the reason when a goal that worked stops: VERIFY plainmove)
	assert.equal(editLead({ changes: ["moved the box 30 cm left"], targets: [{ label: "All the dominoes fall", ok: false, was: true, happened: "only 5 of the 7 dominoes fall" }], room: ["spaced the dominoes closer together (first gap 5.6 → 4.5 cm)"] }), "Done, but to make room I spaced the dominoes closer together (first gap 5.6 → 4.5 cm), and now only 5 of the 7 dominoes fall ✗.")
})
test("one of a row is named by its place everywhere: 'the first paperback book', 'the 6th soda can', 'the last trampoline', never 'Book 1'", () => {
	const rowScene = { items: Array.from({ length: 7 }, (_, k) => ({ id: `can${k + 1}`, type: "soda-can", name: `Soda can ${k + 1}`, x: 1 + 0.1 * k, y: 0.06 })) }
	assert.equal(placeName(rowScene.items[0], rowScene), "the first soda can")
	assert.equal(placeName(rowScene.items[5], rowScene), "the 6th soda can")
	assert.equal(placeName(rowScene.items[6], rowScene), "the last soda can")
	const stack = { items: Array.from({ length: 3 }, (_, k) => ({ id: `t${k}`, type: "tissue-box", name: `Tissue box ${k + 1}`, x: 1, y: 0.05 + 0.1 * k })) }
	assert.equal(placeName(stack.items[1], stack), "the 2nd tissue box from the bottom")
	assert.equal(placeName({ id: "ball2", type: "plastic-ball", name: "Ball 2", x: 3 }, { items: [{ id: "ball2", type: "plastic-ball", name: "Ball 2" }, { id: "ball1", type: "superball", name: "Ball 1" }] }), "Ball 2", "the only one of its kind keeps its name")
	const books = { items: [{ id: "table", type: "table", x: 1.3, y: 0, props: { width: 3.7 } }, ...Array.from({ length: 4 }, (_, k) => ({ id: `book${k + 1}`, type: "paperback-book", name: `Book ${k + 1}`, x: 1 + 0.2 * k, y: 0.09, angle: 0, props: {} }))] }
	assert.equal(fixWords([{ kind: "move", ids: ["book1"], dx: 0.02, dy: 0 }], books).say, "move the first paperback book 2 cm right")
	// (a long move's chip names the things, never "Shift 5 things")
	assert.doesNotMatch(fixWords([{ kind: "move", ids: ["book1", "book2", "book3"], dx: -0.3, dy: 0 }], books).label, /\bthings\b/)
	// (three changes or more: the chip says how many)
	assert.match(fixWords([{ kind: "move", ids: ["book1"], dx: 0.02, dy: 0 }, { kind: "move", ids: ["book3"], dx: 0.05, dy: 0 }, { kind: "move", ids: ["book4"], dx: 0.05, dy: 0.01 }], books).label, /^Make 3 changes: move the first paperback book/)
})
test("the offer leaves nothing of the fix out: a size's weight, an added thing's own size, a box taken off its cords", () => {
	const apple = { id: "a", type: "apple", name: "Apple", x: 1, y: 0.04, props: {} }
	const sc = { items: [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }, apple] }
	assert.match(fixWords([{ kind: "scale", ids: ["a"], keys: ["diameter"], k: 0.9 }], sc).say, /^make the apple smaller \(7\.6 → 6\.8 cm across; 182 g → 133 g\)$/)
	const s0 = starter()
	const s1 = JSON.parse(JSON.stringify(s0))
	s1.items.push({ id: "standin1", type: "laptop-closed", name: "Laptop, closed", x: 2.43, y: 0.1525, angle: 90, props: { height: 0.006 } })
	assert.match(humanChangeList(s0, s1).map((c) => c.text).join(" | "), /added a closed laptop 6 mm thick, on its edge/)
	const s2 = JSON.parse(JSON.stringify(s0))
	s2.items.find((i) => i.id === "box").props = { ...(s2.items.find((i) => i.id === "box").props ?? {}), hung: false }
	assert.match(humanChangeList(s0, s2).map((c) => c.text).join(" | "), /took the box off its cords/)
	// (a swap of a thing whose name says more than its kind: never nested brackets, V8820 n3)
	const s3 = JSON.parse(JSON.stringify(s0))
	const s4 = JSON.parse(JSON.stringify(s0))
	s3.items.push({ id: "w", type: "steel-weight-1kg", name: "Heavy steel weight", x: 0.5, y: 0.05, props: {} })
	s4.items.push({ id: "w", type: "bowling-ball", name: "Bowling ball", x: 0.5, y: 0.11, props: {} })
	const line = humanChangeList(s3, s4).map((c) => c.text).find((t) => /^swapped/.test(t))
	assert.ok(line && !/\([^)]*\(/.test(line), line)
})
test("a thing the words ask to move that the answer left where it was is said: 'Not done: moving the seesaw and the box along' (V8820 c11 r2)", () => {
	const a = { items: [{ id: "seesaw", type: "seesaw", name: "Seesaw", x: 2, y: 0.1 }, { id: "box", type: "box", name: "Box", x: 2.5, y: 0.5 }, { id: "dominoes", type: "domino-row", name: "Dominoes", x: 1, y: 0 }] }
	const T = "Make it twice as long: double the dominoes and move the seesaw and the box along so the ball still has a path."
	assert.deepEqual(unmovedAsks(T, a, a), ["moving the seesaw and the box along (the AI left it out: ask again)"])
	const b = JSON.parse(JSON.stringify(a))
	b.items[0].x += 0.3
	b.items[1].x += 0.3
	assert.deepEqual(unmovedAsks(T, a, b), [])
	assert.deepEqual(unmovedAsks("make the ramp lower and the box wider", a, a), [], "an adjective is no move")
})
test("a goal about a row replaced by separate things follows them through the repair turn, or is said gone (V8820 n2)", async () => {
	const fx = fixture("n2-domino-office")
	const { r } = await edit(gallery("domino-run"), fx.text, fx.answers)
	const labels = (r.goals ?? []).map((g) => g.label)
	assert.ok(labels.some((l) => /smartphones/.test(l)) || (r.edit.goalsDropped ?? []).some((l) => /24 dominoes/.test(l)), `the goal about the 24 dominoes is followed or said gone: ${JSON.stringify(labels)} / ${JSON.stringify(r.edit.goalsDropped)}`)
	assert.equal(r.edit.repair?.kept, true, "the repair turn's answer was the one kept")
})

// ---- 5. the search: c08's obvious knob
test("c08: an original thing the change stood higher (the pillow on the new books) may be made shorter: the physics finds it, no AI", async () => {
	const fx = fixture("c08-orange-books")
	const { r } = await edit(gallery("pulley-lift"), fx.text, [fx.answers[0]])
	assert.ok(r.fixNeeded && r.fixCtx)
	const ai = createOrchestrator({ api: mockApi({}), progress: false })
	const res = await ai.makeItWork(r.fixCtx, { ai: false, budgetMs: 30000, job: { text: fx.text } })
	assert.equal(res.status, "found", JSON.stringify(res.info).slice(0, 300))
	assert.match(res.info.say, /shorter/)
})

// ---- 6. the background's budget: dollars, and "asking the AI" only once a call has started
test("the AI's reworks: 'asking the AI' is said only when a call starts, and their dollars are held to AI_USD (the youngest running call is stopped)", async () => {
	assert.equal(AI_USD, 0.15)
	const scene = starter()
	const sim = await simulate(scene)
	const r = await createOrchestrator({ api: mockApi({ edit: { kind: "change", reply: "Moved it.", patches: [{ op: "move", id: "box", dx: 0.6 }] } }), progress: false }).build({ text: "give the seesaw more room", mode: "edit", scene, sim }).result
	assert.equal(r.fixNeeded, true)
	// (a: too little time for a rework: no call, and the line never says the AI is asked)
	{
		const log = []
		const phases = []
		const ai = createOrchestrator({ api: mockApi({ edit: { kind: "fix", reply: "x", patches: [] } }, log), progress: false })
		const res = await ai.makeItWork(r.fixCtx, { physics: false, budgetMs: 20000, job: { text: "give the seesaw more room" }, onProgress: (p) => phases.push(p.phase) })
		assert.equal(log.filter((l) => l.step === "edit").length, 0)
		assert.ok(!phases.includes("ai"), phases.join(","))
		assert.equal(res.info.reworked, false)
		// (the button's request keeps the name as it is: "so that Ball 2 lands in the box", never "ball 2")
		assert.match(res.info.rework?.text ?? "", /so that Ball 2 lands in the box/)
		assert.equal(progressWords({ phase: "search", runs: 5 }), " · 5 physics runs")
	}
	// (b: two calls that write long answers: the estimate passes AI_USD and the youngest is stopped; the other is counted at its billed cost)
	{
		const log = []
		const phases = []
		const tokens = 0.06 / AI_OUT_USD // (each call's estimate: AI_IN_USD + 0.06 = 0.09; two of them pass AI_USD, one alone does not)
		const api = mockApi(
			{
				progress: () => ({ ok: true, state: "running", tokens, model: "mock" }),
				edit: async (payload, n, signal) => {
					await sleep(3500, signal)
					return { result: { kind: "fix", reply: "I moved the box back.", patches: [{ op: "move", id: "box", dx: -0.6 }] }, usage: { costInUSD: 0.07 } }
				}
			},
			log
		)
		const ai = createOrchestrator({ api, progress: true })
		const res = await ai.makeItWork(r.fixCtx, { physics: false, job: { text: "give the seesaw more room", history: [], plan: r.plan }, onProgress: (p) => phases.push(p.phase) })
		const edits = log.filter((l) => l.step === "edit")
		assert.equal(edits.length, 2, "both reworks started")
		assert.equal(edits.filter((e) => e.aborted).length, 1, "one stopped for the budget")
		assert.ok(phases.includes("ai"), "said once a call started")
		assert.equal(res.status, "found", "the other still answers")
		assert.ok(AI_IN_USD > 0)
	}
})

// ---- 7. offers: the stopped search's "Look again" is the panel's (e2e); the words for it
test("after the search's Stop the card says so and keeps the button; a fix found is offered with its checked goal", () => {
	assert.deepEqual(offerWords({ state: "stopped" }), { text: "I stopped looking for a fix.", button: "Ask the AI to rework it" })
	assert.equal(offerWords({ state: "stopped", movedOn: "undo" }).button, null)
	assert.ok(weightOf("apple", {}) > 0.17)
	assert.deepEqual([...waysOf(new Map([["w", new Set(["mass:up:heavy", "place"])]])).get("w")], [["mass", { way: 1, word: "heavy" }]])
	assert.ok(applyChanges)
	assert.ok(choicesOf)
})
