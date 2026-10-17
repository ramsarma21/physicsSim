// The review of round 5 (V8837 / V8838, 16 Oct; ai/DESIGN.md §16.5): a plain answer keeps the checked offer, a swap into a kind with a real
// size takes that size (and a fix never parks a thing in the goal's container), the background's dollars hold on a big scene, a failed
// rework's "Try:" is offered only when it is closer and names every change, the card pairs a replacement by best overlap, a stand-in is
// claimed only when the edit put it there, a replaced launcher's weak hit is said, a question that drops a stated count is not echoed, a
// typed "make it work" looks with the physics first and keeps to a budget, and the card's words (brackets, growth, "under", "in the way").
// Every scene runs on the real engine; no model is called.
//   node --test web/ai/test/review-r4.test.mjs
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createOrchestrator, humanChangeList, propChange, triedWords, applyPatches, roundBudget, inputUsd, AI_USD, AI_IN_USD, REPAIR_MS, placeWordsOf } from "../orchestrator.js"
import { standardSized, offRealSize, helperSizeBreak, chainBreak, movedInto, fixTargets, fixWords, replacedBy } from "../fixer.js"
import { editChips, offerWords, statedCounts, contradictsCount, askChips } from "../edit-turns.js"
import { changesLabel, clipLabel, tidyBrackets } from "../words.js"
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
const sleep = (ms, signal) =>
	new Promise((res, rej) => {
		const t = setTimeout(res, ms)
		signal?.addEventListener?.("abort", () => (clearTimeout(t), rej(Object.assign(new Error("Cancelled"), { name: "AbortError" }))), { once: true })
	})
const starter = () => JSON.parse(readFileSync(new URL("../../scenarios/rube-goldberg.json", import.meta.url)))
const gallery = (slug) => JSON.parse(readFileSync(new URL(`../../gallery/${slug}.json`, import.meta.url)))
const replays = JSON.parse(readFileSync(new URL("./fixtures/r4/replays.json", import.meta.url)))
const replay = (id) => replays.find((r) => r.id === id)
/** /api/ai/edit answers in turn from `answers` (each {result, usage?, delayMs?} or a bare result); every other AI step fails. */
const apiOf = (answers, log = []) => async (path, body, signal) => {
	if (path === "/api/simulate") return simulate(body.scene, signal)
	if (path !== "/api/ai/edit") return { ok: false, error: "no AI here", code: "error", retryable: false }
	const n = log.push({ step: "edit", payload: body.payload, at: Date.now() })
	const a = typeof answers === "function" ? answers(body.payload, n) : answers[n - 1]
	if (!a) return { ok: false, error: "no AI here", code: "error", retryable: false }
	const x = a.result ? a : { result: a }
	if (x.delayMs)
		try {
			await sleep(x.delayMs, signal)
		} catch (e) {
			log[n - 1].aborted = true
			throw e
		}
	return { ok: true, result: { mode: "patch", targets: [], suggestions: [], missing: [], why: "x", ...JSON.parse(JSON.stringify(x.result)) }, model: "mock/edit", ms: 5, usage: x.usage ?? null }
}
/** A recorded live case built as the panel builds it, its edit step answered as it was live. */
async function built(id, extra = {}) {
	const c = replay(id)
	const scene = c.scene ?? starter()
	const sim = await simulate(scene)
	const log = []
	const r = await createOrchestrator({ api: apiOf(c.answers ?? [c.answer], log), progress: false }).build({ text: c.text, mode: "edit", scene, sim, history: [], ...extra }).result
	return { r, log, scene, sim }
}

// ---- P1: a plain answer to a question keeps the card's checked offer
test("a plain answer said after a card with a checked fix shows that fix, applied from that card (V8838 Q)", () => {
	const fix = { state: "found", sceneJSON: "{}", label: "Lower the box 5 cm", say: "lower the box 5 cm", checked: "the tennis ball lands in the box" }
	const card = { mode: "edit", goals: [{ label: "The tennis ball lands in the box", ok: false }], fix }
	const answer = { replyOnly: true, reply: "The seesaw only got a soft push…", suggestions: [{ label: "Make the box wider", prompt: "Make the box wider" }] }
	const live = editChips(answer, { scene: card, sceneLive: true })
	assert.deepEqual(live.map((c) => [c.label, !!c.go, !!c.sceneFix]), [["Lower the box 5 cm", true, true]], "the checked chip, and no unchecked idea beside it")
	// (when that card isn't the one on the table, or the answer offers something of its own, nothing of the card's)
	assert.deepEqual(editChips(answer, { scene: card, sceneLive: false }).map((c) => c.label), [])
	assert.ok(!editChips({ ...answer, fixNeeded: true }, { scene: card, sceneLive: true }).some((c) => c.sceneFix))
})

// ---- P3 / P2: a typed "make it work" looks with the physics first, held to a budget, and never says the AI's plan under the physics' change
test("a typed 'make it work': the physics' own checked change on the scene as it is is used when the AI's first answer doesn't work, before any more AI rounds (V8838 s-fix-user-swap)", async () => {
	const c = replay("s-fix-user-swap")
	const scene = starter()
	const b1 = scene.items.find((i) => i.id === "ball1")
	Object.assign(b1, { type: "basketball", name: "Basketball", y: Math.round((0.719 + 0.1199) * 1e5) / 1e5 })
	const b2 = scene.items.find((i) => i.id === "ball2")
	Object.assign(b2, { type: "tennis-ball", name: "Tennis ball", y: Math.round((b2.y + 0.0035) * 1e5) / 1e5 })
	const sim = await simulate(scene)
	const log = []
	const t0 = Date.now()
	// (one engine on this thread, shared with the other test files: the page's four fix workers do it in a few seconds)
	const r = await createOrchestrator({ api: apiOf(c.answers.map((a) => ({ result: a, usage: { costInUSD: 0.05 } })), log), progress: false }).build({ text: c.text, mode: "edit", scene, sim, history: [] }, { physFirstMs: 60000 }).result
	assert.equal(log.length, 1, "one AI call: the physics' change, no more rounds")
	assert.ok(Date.now() - t0 < 70000)
	assert.equal(r.edit.fixFlow.physics, true)
	assert.ok(r.goals.every((g) => g.ok === true), JSON.stringify(r.goals))
	assert.match(r.lead, /^Done! I .+ ✓$/, r.lead)
	assert.equal(r.planned, "", "the AI's own plan (which didn't work) is not shown under the physics' change")
	for (const id of ["ball1", "ball2"]) assert.equal(r.scene.items.find((i) => i.id === id).type, scene.items.find((i) => i.id === id).type, "both new balls kept")
})
test("a typed 'make it work' keeps to AI_USD: another round only while one more call like the last one fits, and a minute in all", () => {
	const at = Date.now()
	assert.equal(roundBudget([{ step: "edit", usage: { costInUSD: 0.05 } }], { deadline: at + 60000, now: at }), true)
	assert.equal(roundBudget([{ step: "edit", usage: { costInUSD: 0.08 } }], { deadline: at + 60000, now: at }), false, "0.08 + 0.08 > 0.15")
	assert.equal(roundBudget([{ step: "edit", usage: { costInUSD: 0.05 } }, { step: "edit", usage: { costInUSD: 0.06 } }], { deadline: at + 60000, now: at }), false)
	assert.equal(roundBudget([{ step: "edit", usage: { costInUSD: 0.02 } }], { deadline: at + 20000, now: at }), false, "too little time left for a round and the search after it")
	assert.equal(AI_USD, 0.15)
})

// ---- P4: an unasked added thing in the way
test("a thing the edit added that nobody asked for, and that the machine now runs into, is said as the reason (V8838 s-swap-box-cup)", async () => {
	const { r } = await built("s-swap-box-cup")
	// (round 6: the cup is a real 8 cm cup now, and the dominoes stop at the post: still the reason, said first)
	assert.match(r.lead, /^Done, but now the post I added to hold the cup is in the way: /, r.lead)
})

// ---- P5: "under Ramp 1"
test("where a thing was put under another is said so: in the person's words, and read off the scene when they said nothing (V8838 s-add-cup-under)", async () => {
	const { r } = await built("s-add-cup-under")
	assert.deepEqual(r.human, ["added a cup under Ramp 1"])
	const a = starter()
	const b = JSON.parse(JSON.stringify(a))
	b.items.push({ id: "cup1", type: "cup", x: 0.18, y: 0, props: {} })
	assert.deepEqual(humanChangeList(a, b).map((c) => c.text), ["added a cup under Ramp 1"])
	assert.equal(placeWordsOf("put a cup on the table under ramp 1", a, b).get("cup1")?.words, "under Ramp 1")
})

// ---- P6 / P15: the card's words
test("the card's words: no brackets inside brackets, a row's growth and a top width said plainly, a two-change chip names the bigger, labels cut before a comma", () => {
	assert.equal(propChange("domino-row", "growth", 1.193, 1.21), "each one 1.19 → 1.21× the one before")
	assert.equal(propChange("basket", "width", 0.45, 0.675), "top width 45 → 67.5 cm")
	const a = starter()
	const b = JSON.parse(JSON.stringify(a))
	b.items.find((i) => i.id === "dominoes").props.growth = 1.21
	assert.deepEqual(humanChangeList(a, b).map((c) => c.text), ["made the dominoes grow faster (each one 1.19 → 1.21× the one before)"])
	assert.equal(triedWords(["tilted the seesaw more (12.5° → 20°)", "moved the box 5 cm left and 12 cm up"]), "tilted the seesaw more, 12.5° → 20°; and moved the box 5 cm left and 12 cm up")
	assert.equal(tidyBrackets("moved Ramp 1 (top) (with the big wooden ball on it) 16 cm up"), "moved Ramp 1 (top), with the big wooden ball on it, 16 cm up")
	assert.equal(tidyBrackets("replaced the 10 dominoes with 10 LEGO bricks (2 × 4) (2.3 g each, 2 cm apart)"), "replaced the 10 dominoes with 10 LEGO bricks (2 × 4; 2.3 g each, 2 cm apart)")
	assert.equal(clipLabel("Try: Add a cutting board 50 cm wide, on its edge, next to the basket", 46), "Try: Add a cutting board 50 cm wide…")
	// (a fix of two changes that don't fit a chip: how many, led by the bigger one: V8837 plainswap2)
	const s = starter()
	const w = fixWords([{ kind: "move", ids: ["dominoes"], dx: 0.04, dy: 0 }, { kind: "move", ids: ["ball1"], dx: 0.25, dy: -0.11 }], s)
	assert.match(w.label, /^Make 2 changes: move Ball 1 /, w.label)
	// (a rework call started is said, a stopped one too: V8837 c02)
	assert.equal(offerWords({ state: "none", runs: 76, timedOut: true, aiCalls: 1 }).text, "I couldn’t find a change that works (I tried 76 in the physics and the AI’s reworks, for a minute).")
})
test("an unasked move says where it went: 'onto the 3 hardcover books' (V8837 c08); a swapped thing slid along unasked is put back (V8837 k3)", async () => {
	const c08 = await built("c08r1")
	assert.ok(c08.r.human.includes("moved the pillow 11 cm up, onto the 3 hardcover books"), c08.r.human.join(" | "))
	// (round 6: the basket is a real 45 cm basket now, so the AI's move to clear the ledge is needed and kept, and said: V8842 k3)
	const k3 = await built("k3r1")
	assert.ok(k3.r.human.includes("swapped the cup for a basket (12 → 45 cm wide)"), k3.r.human.join(" | "))
	assert.ok(k3.r.human.some((h) => /^moved the basket 12 cm right/.test(h)), k3.r.human.join(" | "))
})

// ---- P7 / P17: a kind with a real size
test("a swap into a kind with a real everyday size takes that size, said when it is another (V8837 k5); the AI's helpers keep theirs too (V8837 x5)", async () => {
	assert.equal(standardSized("plastic-cup"), true)
	assert.equal(standardSized("basket"), false)
	const plan = { items: [{ id: "basket", type: "basket", props: { width: 0.35, wall: 0.15 }, place: { on: "table", x: 2.5 } }], goals: [] }
	const p = applyPatches(plan, [{ op: "replace_type", id: "basket", type: "plastic-cup", props: {} }]).plan.items[0]
	assert.deepEqual(p.props, {}, "the basket's 35 cm is not carried onto the plastic cup")
	// (round 6: a container takes its usual size where what it carries is more than ±20 % off it: a 35 cm basket into a 28 cm bucket is)
	const kept = applyPatches(JSON.parse(JSON.stringify(plan)), [{ op: "replace_type", id: "basket", type: "bucket", props: {} }]).plan.items[0]
	assert.equal(kept.props.width, undefined, "a container takes its own size, V8842 n1")
	const near = applyPatches({ items: [{ id: "b", type: "basket", props: { width: 0.3 }, place: { on: "table", x: 2 } }], goals: [] }, [{ op: "replace_type", id: "b", type: "bucket", props: {} }]).plan.items[0]
	assert.equal(near.props.width, 0.3, "within 20 % of its own: kept")
	const { r } = await built("k5r1")
	assert.ok(r.human.includes("swapped the basket for a plastic cup (35 → 9.5 cm wide)"), r.human.join(" | "))
	const a = { items: [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }, { id: "basket", type: "basket", name: "Basket", x: 2.5, y: 0, props: { width: 0.35, wall: 0.15 } }] }
	const b = JSON.parse(JSON.stringify(a))
	Object.assign(b.items[1], { type: "plastic-cup", props: { width: 0.35, wall: 0.15 } })
	delete b.items[1].name
	assert.deepEqual(humanChangeList(a, b).map((x) => x.text), ["swapped the basket for a plastic cup 35 cm wide (a real one is 9.5 cm)"])
	assert.equal(offRealSize("cutting-board", { width: 0.8 }).words, "80 cm wide (a real one is 41 cm)")
	assert.match(helperSizeBreak({ items: [] }, { items: [{ id: "cb", type: "cutting-board", props: { width: 0.8 } }] }), /^it added a cutting board 80 cm wide, far from a real one’s 41 cm$/)
	assert.equal(helperSizeBreak({ items: [] }, { items: [{ id: "cb", type: "cutting-board", props: {} }] }), null)
})
test("a fix never moves another thing into the goal's container (V8837 k5: the last bounce pad parked inside the plastic cup)", async () => {
	const c = replay("k5r1")
	const scene = c.scene
	const moved = JSON.parse(JSON.stringify(scene))
	const cup = moved.items.find((i) => i.id === "basket")
	moved.items.find((i) => i.id === "pad3").x = cup.x
	assert.equal(movedInto(scene, moved, "basket", new Set(["ball", "basket"])), "pad3")
	assert.equal(movedInto(scene, scene, "basket", new Set(["ball", "basket"])), null, "nothing moved")
	const sb = await simulate(scene)
	const sm = await simulate(moved)
	const ctx = { scene, sim: sb, before: { scene, sim: sb }, goals: [{ kind: "in", item: "ball", container: "basket", label: "The superball lands in the basket" }] }
	const why = chainBreak(ctx, moved, sm, fixTargets({ goals: ctx.goals, scene: moved, before: ctx.before, sim: sm }))
	assert.match(why ?? "", /would be moved into the basket/, why)
})

// ---- P8: the background's dollars on a big scene
test("the AI's background reworks hold to AI_USD on a big scene: a running call counted from what it sends and the last billed call, and the second started only when another fits (V8837 k3)", async () => {
	const cradle = gallery("newtons-cradle")
	assert.equal(inputUsd(JSON.stringify(cradle).length), AI_IN_USD, "a scene's own JSON is small beside the prompt: the minimum")
	assert.ok(inputUsd(400000) > AI_IN_USD, "a big request (a long conversation, big reasons) counts more than the flat minimum")
	const scene = starter()
	const sim = await simulate(scene)
	const r = await createOrchestrator({ api: apiOf([{ kind: "change", reply: "Moved it.", patches: [{ op: "move", id: "box", dx: 0.6 }] }]), progress: false }).build({ text: "give the seesaw more room", mode: "edit", scene, sim }).result
	assert.equal(r.fixNeeded, true)
	const log = []
	const ai = createOrchestrator({ api: apiOf(() => ({ result: { kind: "fix", reply: "x", patches: [{ op: "move", id: "box", dx: -0.6 }] }, usage: { costInUSD: 0.083 }, delayMs: 2500 }), log), progress: false })
	// (the edit that made this scene was billed $0.06: a rework is reserved at 2.2 times that (round 6, V8842 y5): one, and no second beside it)
	const res = await ai.makeItWork({ ...r.fixCtx, lastUsd: 0.06 }, { physics: false, job: { text: "give the seesaw more room", history: [], plan: r.plan } })
	assert.equal(log.length, 1, `one rework call on a scene whose calls cost $0.06 or more (${log.length})`)
	assert.ok(log.length * 0.083 <= AI_USD)
	assert.equal(res.aiCalls, 1)
	// (a light scene still gets both, side by side)
	const log2 = []
	const ai2 = createOrchestrator({ api: apiOf(() => ({ result: { kind: "fix", reply: "x", patches: [{ op: "move", id: "box", dx: -0.6 }] }, usage: { costInUSD: 0.04 }, delayMs: 1500 }), log2), progress: false })
	await ai2.makeItWork({ ...r.fixCtx, lastUsd: 0.04 }, { physics: false, job: { text: "give the seesaw more room", history: [], plan: r.plan } })
	assert.equal(log2.length, 2)
})

// ---- P9: a failed rework's "Try:"
test("a 'Try:' names every change it makes, never the first alone (V8837 y4)", () => {
	assert.equal(changesLabel(["moved the seesaw 20 cm right"]), "Move the seesaw 20 cm right")
	assert.equal(changesLabel(["moved the seesaw 20 cm right", "added a cutting board, on its edge, next to the basket"]), "2 changes: move the seesaw and add a cutting board")
	assert.equal(changesLabel(["moved the box 2 cm up", "moved the seesaw 5 mm"]), "2 changes: move the box 2 cm up and move the seesaw 5 mm")
	assert.equal(changesLabel(["moved the box 2 cm up", "moved the seesaw 5 mm right"]), "2 changes: move the box and move the seesaw")
	assert.match(changesLabel(["moved the seesaw (with the tennis ball on it) 20 cm right", "added a closed laptop, on its edge, between the dominoes and the seesaw", "made the dominoes grow faster (each one 1.19 → 1.21× the one before)"]), /^3 changes: move the seesaw/)
	// (two are always both named: V8841 z7, "Try 2 changes: pull the rope pendulum back and 1 more")
	assert.equal(changesLabel(["pulled the rope pendulum back further (40.6° → 50°)", "added a steel weight on the top box"]), "2 changes: pull the rope pendulum back and add a steel weight")
	const chips = editChips({ replyOnly: true, fix: { state: "none", near: { sceneJSON: "{}", label: "2 changes: move the seesaw and add a cutting board", say: "x" } } }, { rework: true })
	assert.equal(chips[0].label, "Try 2 changes: move the seesaw and add a cutting board")
})

// ---- P10: a replacement paired by the best overlap
test("what was added where something was taken away is paired by the best overlap and the kind named after 'replace … with' (V8837 k1)", async () => {
	const { r } = await built("k1r2")
	assert.ok(r.human.some((h) => /^replaced the 7 dominoes with 6 paperback books/.test(h)), r.human.join(" | "))
	assert.ok(r.human.some((h) => /^added a sneaker next to the box/.test(h)), r.human.join(" | "))
	assert.ok(!r.human.some((h) => /with a sneaker/.test(h)))
})

// ---- P11: a stand-in only when the edit put it there
test("'so I used a wooden plank' only when the edit put a plank there (V8837 c04)", async () => {
	const scene = gallery("marble-run")
	const sim = await simulate(scene)
	const ans = { kind: "change", reply: "x", patches: [{ op: "set_props", id: "cup", props: { material: "varnished hardwood" } }], missing: [{ asked: "pirate ship", reason: "not in the library", substitute_type: "plank" }] }
	const r = await createOrchestrator({ api: apiOf([ans]), progress: false }).build({ text: "Make it a pirate-ship version using only wooden things.", mode: "edit", scene, sim }).result
	assert.equal(r.missing[0].substitute_type, null)
	assert.equal(r.missing[0].noSub, true)
	const added = { ...ans, patches: [...ans.patches, { op: "add", item: { id: "deck", type: "plank", props: {}, place: { on: "table", x: 0.3 } } }] }
	const r2 = await createOrchestrator({ api: apiOf([added]), progress: false }).build({ text: "Make it a pirate-ship version using only wooden things.", mode: "edit", scene, sim }).result
	assert.equal(r2.missing[0].substitute_type, "plank")
})

// ---- P12: a replaced launcher
test("a launcher replaced by things too light to launch: what they do instead, with a plural verb (V8837 k3)", async () => {
	const { r } = await built("k3r1")
	assert.match(r.lead, /^Done, but now the 10 LEGO bricks \(2\.3 g each\) fall but don't move the orange ✗\.$/, r.lead)
	assert.ok(!/dominoes is gone/.test(r.lead))
	const c = replay("k3r1")
	const after = r.scene
	assert.equal(replacedBy(c.scene, after, "dominoes")?.length, 10)
})

// ---- P13: a question that drops a stated count
test("a question about a request that states a count: no idea with another count, and the longer table offered when it is for want of room (V8837 c11 r1)", () => {
	const counts = new Map([["dominoes", 7]])
	const asked = "Make it twice as long: double the dominoes and move the seesaw and the box along so the ball still has a path."
	const w = statedCounts(asked, counts)
	assert.equal(w.get("dominoes"), 14)
	assert.equal(contradictsCount("Add 3 more dominoes", w, counts), true)
	assert.equal(contradictsCount("Pack 14 equal dominoes", w, counts), false)
	assert.equal(contradictsCount("Add seven more dominoes", w, counts), false)
	// ("add 3 more" is 10 of them: an idea that adds 3 more agrees with it)
	const more = statedCounts("add 3 more dominoes", counts)
	assert.equal(more.get("dominoes"), 10)
	assert.equal(contradictsCount("Add 3 more dominoes", more, counts), false)
	assert.equal(contradictsCount("Use 12 dominoes", more, counts), true)
	const r = { replyOnly: true, edit: { kind: "ask" }, reply: "Fourteen growing dominoes would stretch about 2.6 m and run past the table's end… Should I pack 14 same-size dominoes into the current space, or shift the ramps left to make room?", suggestions: [{ label: "Pack 14 equal dominoes", prompt: "Pack 14 equal dominoes" }, { label: "Shift ramps left for room", prompt: "Shift the ramps left" }, { label: "Add 3 more dominoes", prompt: "Add 3 more dominoes" }] }
	const chips = editChips(r, { asked, counts })
	assert.deepEqual(chips.map((c) => c.label), ["Make the table longer", "Pack 14 equal dominoes", "Shift ramps left for room"])
	assert.match(chips[0].prompt, /double the dominoes .*, and make the table longer so everything fits\.$/)
	// (a question's own chips, a reading each, the same: V8841 c11 r2, "Space out the 7 dominoes")
	const asks = askChips({ reply: "14 growing dominoes would stretch about 2.6 m and run off the table. Should I make all 14 the same size and pack them tighter, or keep 7 and space them out more?", suggestions: [{ label: "14 equal dominoes, packed tighter", prompt: "Make the row 14 dominoes all the same size, packed closer" }, { label: "Space out the 7 dominoes", prompt: "Keep 7 dominoes but space them further apart" }] }, { asked, counts })
	assert.deepEqual(asks.map((c) => c.label), ["Make the table longer", "14 equal dominoes, packed tighter"])
	assert.deepEqual(askChips({ reply: "the ball flies over the box", suggestions: [] }, { asked, counts }), [])
})

test("a thing the edit added that the AI set down inside another is moved aside, with no repair call; 'next to the mug' found by what the cup became (V8841 k2)", async () => {
	const { r, log } = await built("k2r1")
	assert.equal(log.length, 1, "no repair call")
	assert.deepEqual(r.edit.repair, { before: 1, after: 0, kept: true, by: "room" })
	assert.ok(r.human.includes("added a rubber duck on the table next to the coffee mug"), r.human.join(" | "))
	assert.ok(!/starts? inside/.test(r.lead), r.lead)
})

// ---- P18: a plain move that starts things inside each other
test("a move that starts things inside each other: the repair turn is held to REPAIR_MS, and what still starts inside what is said (V8837 plainmove)", async () => {
	assert.ok(REPAIR_MS >= 18000 && REPAIR_MS <= 20000, "round 6: long enough for a repair call (10–16 s), V8843 c09 r3")
	const scene = starter()
	const sim = await simulate(scene)
	const log = []
	const move = { kind: "change", reply: "Moved it.", targets: [{ says: "the box", ids: ["box"] }], patches: [{ op: "move", id: "box", dx: -0.3 }] }
	const slow = { result: { kind: "change", reply: "x", patches: [{ op: "move", id: "box", dx: -0.3 }, { op: "set_props", id: "dominoes", props: { spacing: 0.45 } }] }, delayMs: REPAIR_MS + 2500 }
	const t0 = Date.now()
	const r = await createOrchestrator({ api: apiOf([move, slow], log), progress: false }).build({ text: "move the box 30 cm left", mode: "edit", scene, sim }).result
	assert.ok(Date.now() - t0 < REPAIR_MS + 8000, `${Date.now() - t0} ms`)
	assert.equal(log.length, 2)
	assert.equal(log[1].aborted, true, "the slow repair call was stopped")
	assert.deepEqual(r.human, ["moved the box 30 cm left"], "nothing the repair would have re-spaced")
	assert.match(r.lead, /^Done, but now the dominoes start inside the box: /, r.lead)
	assert.ok(r.issues.some((i) => /took too long/.test(i.text)))
})
