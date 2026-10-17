// The review of round 6 (V8842 / V8843, 16 Oct; ai/DESIGN.md §16.6): what the person says to keep is kept by every fix ("make it work without
// touching the box"), a "yes" is to the latest reply's own offer, a question never stops the search, a swapped-in container takes its usual
// size (and "What I planned" never contradicts the table), the background's dollars hold with a cold prompt cache or a dear rework, a rework
// with too little time left isn't started, goal labels after a swap, the answers' numbers from the run, "next to" and "pinned", a real-size
// thing's weight, and the card's words. Every scene runs on the real engine; no model is called.
//   node --test web/ai/test/review-r5.test.mjs
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createOrchestrator, keptByWords, keepClauses, applyPatches, humanChangeList, swapPhraseLabels, tidyGoneLabels, plannedOff, lengthsIn, warmUsd, reworkNeedMs, triedWords, propChange, AI_USD, AI_FLOOR_MAX, AI_REWORK_X, REPAIR_MS, PHYS_FIRST_RUNS, REWORK_MIN_MS } from "../orchestrator.js"
import { findFix as searchFix, frozenChanged, keepsCharacter, offRealSize, containerKind, fixWords, outcomeWords } from "../fixer.js"
import { offerWords, statedCounts, contradictsCount, askChips } from "../edit-turns.js"
import { isQuestion, PROPOSES_RE, ALT_RE, lastSentence } from "../panel.js"
import { imperative, changesLabel } from "../words.js"
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
const replays = JSON.parse(readFileSync(new URL("./fixtures/r5/replays.json", import.meta.url)))
const replay = (id) => replays.find((r) => r.id === id)
/** /api/ai/edit answers in turn from `answers` (each {result, usage?, delayMs?} or a bare result, or a function); every other AI step fails. */
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
	return { ok: true, result: { mode: "patch", targets: [], suggestions: [], missing: [], why: "x", ...JSON.parse(JSON.stringify(x.result)) }, model: "mock/edit", ms: x.ms ?? 5, usage: x.usage ?? null }
}
async function built(id, extra = {}) {
	const c = replay(id)
	const scene = c.scene
	const sim = await simulate(scene)
	const log = []
	const r = await createOrchestrator({ api: apiOf([c.answer], log), progress: false }).build({ text: c.text, mode: "edit", scene, sim, history: [], ...extra }).result
	return { r, log, scene, sim }
}
/** The starter after the swap the person asked for: the tennis ball then hits the side of the box (lowering it 5 cm works). */
const SWAP = { kind: "change", reply: "Swapped.", targets: [{ says: "the yellow ball", ids: ["ball2"] }, { says: "the red ball", ids: ["ball1"] }], patches: [{ op: "replace_type", id: "ball2", type: "tennis-ball", props: {} }, { op: "set_item", id: "ball2", name: "Tennis ball" }, { op: "replace_type", id: "ball1", type: "basketball", props: {} }, { op: "set_item", id: "ball1", name: "Basketball" }] }
async function swapped() {
	const s0 = starter()
	const r = await createOrchestrator({ api: apiOf([SWAP]), progress: false }).build({ text: "replace the yellow ball with a tennis ball and the red ball with a basketball", mode: "edit", scene: s0, sim: await simulate(s0) }).result
	return r
}

// ---- 1. what the person says to keep (V8842 ql / qn / qo / qp)
test("keep-words: 'without touching the box', 'leave the box alone', 'with the box where it is', 'besides moving the box' each name the box; 'instead' names nothing", () => {
	const s = starter()
	for (const t of ["is there a way to fix it without touching the box?", "make it work without touching the box", "fix it but leave the box alone", "can you make it work with the box where it is?", "what could I change so the tennis ball lands in the box without moving the box?", "is there another way to fix it besides moving the box?", "make it work, the box stays where it is", "don't move the box", "make it work without touching the box on the seesaw"])
		assert.deepEqual([...keptByWords(t, s)], ["box"], t)
	assert.deepEqual([...keptByWords("don't move the box or the seesaw", s)].sort(), ["box", "seesaw"])
	for (const t of ["could I fix it by tilting the seesaw more instead?", "make it work", "Fix it so this happens in the run: X. Change only what is needed for that, and keep everything else as it is.", "Make it work again so that the tennis ball lands in the box, keeping the tennis ball. Say what you changed."])
		assert.equal(keptByWords(t, s).size, 0, t)
	assert.deepEqual(keepClauses("what could I change so it lands without moving the box?"), ["without moving the box"])
	assert.equal(frozenChanged({ items: [{ id: "box", type: "box", x: 1, y: 0.19, props: {} }] }, { items: [{ id: "box", type: "box", x: 1, y: 0.14, props: {} }] }, ["box"]), true)
	assert.equal(frozenChanged({ items: [{ id: "box", type: "box", x: 1, y: 0.19, props: {} }] }, { items: [{ id: "box", type: "box", x: 1, y: 0.19, props: { width: 0.26 } }] }, ["box"]), false, "a default written out is no change")
})
test("a typed 'make it work without touching the box': no fix, search or answer moves the box (V8842: 'Done! I moved the box 5 cm down' in 4 of 4)", async () => {
	const r0 = await swapped()
	assert.equal(r0.fixNeeded, true, r0.lead)
	// (the physics' own search with the box kept: never the box)
	const fr = await searchFix({ ...r0.fixCtx, frozen: new Set(["box"]) }, { simulate, verify: simulate, budgetMs: 20000 })
	if (fr.status === "found") assert.ok(!frozenChanged(r0.scene, fr.fix.scene, ["box"]), fr.fix.words.say)
	// (the AI's answer lowers the box anyway: not taken; whatever goes on the table leaves the box where it is)
	const LOWER = { kind: "fix", reply: "I lowered the box 5 cm.", targets: [{ says: "the box", ids: ["box"] }], patches: [{ op: "move", id: "box", dy: -0.05 }] }
	const log = []
	const r = await createOrchestrator({ api: apiOf((pl) => (pl.feedback ? null : LOWER), log), progress: false }).build({ text: "make it work without touching the box", mode: "edit", scene: r0.scene, sim: await simulate(r0.scene), history: [] }).result
	const b0 = r0.scene.items.find((i) => i.id === "box")
	const b1 = (r.scene ?? r0.scene).items.find((i) => i.id === "box")
	assert.ok(Math.abs(b1.x - b0.x) < 1e-9 && Math.abs(b1.y - b0.y) < 1e-9, `${r.lead}`)
	assert.ok(!/(moved|lowered) the box/.test(r.lead ?? r.reply ?? ""), r.lead ?? r.reply)
	assert.deepEqual(r.kept, ["box"])
	assert.ok(r.edit.touched.some(([id, k]) => id === "box" && k === "all"), "and a later turn keeps it too")
})

// ---- 2. "yes" to the latest reply's own offer (V8842 qa / qq / qr, V8843 Q3 / Q4); a question as a question
test("a reply's own offer: an answer that proposes a change, or a question that asks for another way; 'and what does…?' is a question", () => {
	assert.ok(PROPOSES_RE.test(lastSentence("Possibly. The tennis ball now hits the box's right wall, so more tilt (about 12° → 20°) would fling it higher.")))
	assert.ok(PROPOSES_RE.test(lastSentence("Yes: I could swap the tennis ball back to a lighter ball. Or I could tilt the seesaw more for a stronger fling.")))
	assert.ok(PROPOSES_RE.test(lastSentence("Without moving the box, try a steeper seesaw tilt (12° → about 18°).")))
	assert.ok(PROPOSES_RE.test(lastSentence("Want me to tilt the seesaw more?")))
	for (const plain of ["The seesaw only flings it at about 0.6 m/s, so it hits the box's side at 2.9 s instead of clearing its 32 cm rim.", "It needs a higher flight or a lower box.", "I can't see a way without a bigger box."]) assert.ok(!PROPOSES_RE.test(lastSentence(plain)), plain)
	for (const q of ["could I fix it by tilting the seesaw more instead?", "is there another way to fix it besides moving the box?", "what could I change without moving the box?"]) assert.ok(ALT_RE.test(q), q)
	assert.ok(!ALT_RE.test("why does the tennis ball miss the box?"))
	assert.equal(isQuestion("and what does the seesaw do?"), true)
	assert.equal(isQuestion("so why does it miss?"), true)
	assert.equal(isQuestion("and move the box 5 cm left"), false)
	assert.equal(isQuestion("why doesn't the egg move?"), true, "a wh-question whatever its verb (V8842 qj: it stopped the search)")
	assert.equal(isQuestion("can you move the box?"), false)
	assert.equal(isQuestion("what if we add a ramp?"), false)
})
test("a search stopped by a new change says so, and 'Look again' stays; one stopped by the person's Stop or an Undo as before", () => {
	assert.deepEqual(offerWords({ state: "stopped", movedOn: "new" }), { text: "I stopped looking for a fix when you sent a new change.", button: "Ask the AI to rework it" })
	assert.equal(offerWords({ state: "stopped" }).text, "I stopped looking for a fix.")
	assert.equal(offerWords({ state: "stopped", movedOn: "undo" }).button, null)
})

// ---- 3. a swapped-in container's size (V8842 k3 / n1, V8843 s-swap-box-cup)
test("a container swapped in takes its usual size where what it carries is more than ±20 % off it, said when the AI sets another; 'What I planned' never contradicts the table", async () => {
	assert.equal(containerKind("basket"), true)
	assert.equal(containerKind("cardboard-box"), false)
	const plan = { items: [{ id: "cup", type: "cup", props: { width: 0.12, wall: 0.1 }, place: { on: "table", x: 2 } }], goals: [] }
	assert.deepEqual(applyPatches(plan, [{ op: "replace_type", id: "cup", type: "basket", props: {} }]).plan.items[0].props, {}, "the cup's 12 cm is not carried onto a basket")
	const near = applyPatches({ items: [{ id: "b", type: "basket", props: { width: 0.3, wall: 0.15 }, place: { on: "table", x: 2 } }], goals: [] }, [{ op: "replace_type", id: "b", type: "bucket", props: {} }]).plan.items[0].props
	assert.equal(near.width, 0.3, "within 20 % of a bucket's 28 cm: kept")
	assert.equal(near.wall, undefined, "15 cm walls on a 27 cm bucket: its own")
	assert.equal(offRealSize("basket", { width: 0.12 })?.words, "12 cm wide (a usual one is 45 cm)")
	const a = { items: [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }, { id: "cup", type: "cup", name: "Cup", x: 2, y: 0, props: {} }] }
	const b = JSON.parse(JSON.stringify(a))
	Object.assign(b.items[1], { type: "basket", name: "Basket", props: { width: 0.12 } })
	assert.match(humanChangeList(a, b).map((c) => c.text)[0], /^swapped the cup for a basket 12 cm wide \(a usual one is 45 cm/)
	const { r } = await built("k3r1")
	assert.ok(r.human.includes("swapped the cup for a basket (12 → 45 cm wide)"), r.human.join(" | "))
	assert.ok(r.planned, "its plan (a 45 cm basket moved 12 cm right) is what the table has: shown")
	assert.equal(r.scene.items.find((i) => i.id === "cup").x, 2.2)
	// (the goal's thing never moves: where its container went is no reason in the lead)
	assert.equal(r.lead, "Done, but now the 10 LEGO bricks (2.3 g each) fall but don't move the orange ✗.")
	assert.deepEqual(lengthsIn("a 45 cm basket, moved 12 cm right; 12 → 45 cm wide"), [0.12, 0.45, 0.45, 0.12])
	assert.equal(plannedOff("I swapped the box for a paper cup (8 cm wide).", ["swapped the box for a cup"]), true)
	assert.equal(plannedOff("The basket is wider, so I moved it 12 cm right.", ["swapped the cup for a basket (12 → 45 cm wide)", "moved the basket 12 cm right, to clear the orange"]), false)
	const n1 = await built("n1")
	assert.ok(n1.r.human.includes("swapped the box for a bucket (14 → 27 cm tall)"), n1.r.human.join(" | "))
})

// ---- 4. the background's dollars (V8842 y5, V8843 rw-cradle)
test("the background's dollars: a cold prompt cache's write is no measure of a rework; a dear rework never has a second beside it; none is started that would be stopped at once", async () => {
	assert.equal(AI_USD, 0.15)
	assert.ok(Math.abs(warmUsd({ costInUSD: 0.249431, cache_creation_input_tokens: 46187 }) - 0.0287) < 0.002, "a cold call's $0.25 is a warm one's $0.03")
	assert.equal(warmUsd({ costInUSD: 0.0298, cache_creation_input_tokens: 0 }), 0.0298)
	const scene = starter()
	const sim = await simulate(scene)
	const r = await createOrchestrator({ api: apiOf([{ kind: "change", reply: "Moved it.", patches: [{ op: "move", id: "box", dx: 0.6 }] }]), progress: false }).build({ text: "give the seesaw more room", mode: "edit", scene, sim }).result
	assert.equal(r.fixNeeded, true)
	const job = { text: "give the seesaw more room", history: [], plan: r.plan }
	// (y5: the edit's call billed $0.0507, the first rework $0.109: no second one beside it, nor after it)
	{
		const log = []
		const ai = createOrchestrator({ api: apiOf(() => ({ result: { kind: "fix", reply: "x", patches: [{ op: "move", id: "box", dx: -0.6 }] }, usage: { costInUSD: 0.109 }, delayMs: 1500 }), log), progress: false })
		const res = await ai.makeItWork({ ...r.fixCtx, lastUsd: 0.0507 }, { physics: false, job })
		assert.equal(log.length, 1, `one rework: ${log.length}`)
		assert.ok(log.length * 0.109 <= AI_USD)
		assert.equal(res.aiCalls, 1)
	}
	// (a cold cache's floor taken off: the edit billed $0.25 with 46,187 tokens written, a rework is still asked)
	{
		const log = []
		const ai = createOrchestrator({ api: apiOf(() => ({ result: { kind: "fix", reply: "x", patches: [{ op: "move", id: "box", dx: -0.6 }] }, usage: { costInUSD: 0.035 }, delayMs: 800 }), log), progress: false })
		await ai.makeItWork({ ...r.fixCtx, lastUsd: warmUsd({ costInUSD: 0.25, cache_creation_input_tokens: 46187 }) }, { physics: false, job })
		assert.ok(log.length >= 1)
	}
	// (an edit billed $0.25 with no cache to take off: the floor is capped, a rework would not fit, so none is started, and the card claims none)
	{
		const log = []
		const ai = createOrchestrator({ api: apiOf(() => ({ result: { kind: "fix", reply: "x", patches: [] }, usage: { costInUSD: 0.2 } }), log), progress: false })
		const res = await ai.makeItWork({ ...r.fixCtx, lastUsd: 0.25 }, { physics: false, job })
		assert.ok(AI_REWORK_X * AI_FLOOR_MAX > AI_USD)
		assert.equal(log.length, 0, "no rework started")
		assert.ok(!res.aiCalls)
		assert.doesNotMatch(offerWords(res.info).text, /AI’s rework/)
	}
	// (the card says the AI's reworks only for one that answered: one stopped as it started is not "tried")
	assert.equal(offerWords({ state: "none", runs: 170, aiCalls: 1, aiAnswered: 0 }).text, "I couldn’t find a change that works (I tried 170 in the physics).")
	assert.equal(offerWords({ state: "none", runs: 76, timedOut: true, aiCalls: 1, aiAnswered: 0, reworkLate: true }).text, "I couldn’t find a change that works (I tried 76 in the physics, for a minute; the AI’s rework ran out of time).")
	assert.equal(offerWords({ state: "none", runs: 76, aiCalls: 1, aiAnswered: 1 }).text, "I couldn’t find a change that works (I tried 76 in the physics and the AI’s rework).")
})
test("a background rework needs the time its call takes on this scene: with an edit call of 30 s, none is started in a minute's last 40 s (V8842 k3 / n5 / c02)", async () => {
	assert.equal(reworkNeedMs(null), REWORK_MIN_MS)
	assert.equal(reworkNeedMs(30000), 47000)
	const scene = starter()
	const sim = await simulate(scene)
	const r = await createOrchestrator({ api: apiOf([{ kind: "change", reply: "Moved it.", patches: [{ op: "move", id: "box", dx: 0.6 }] }]), progress: false }).build({ text: "give the seesaw more room", mode: "edit", scene, sim }).result
	const log = []
	const ai = createOrchestrator({ api: apiOf(() => ({ kind: "fix", reply: "x", patches: [] }), log), progress: false })
	const res = await ai.makeItWork({ ...r.fixCtx, lastMs: 40000 }, { physics: false, budgetMs: 50000, job: { text: "give the seesaw more room", history: [], plan: r.plan } })
	assert.equal(log.length, 0, "48 s needed, 50 s in all: the gate's own wait leaves too little")
	assert.ok(!res.aiCalls)
})

// ---- 5. goal labels after a swap or a replacement (V8842 n2 / n3 / n5, V8843 n5t)
test("goal labels: a stand-in's own name kept, a swap phrase never eats another thing's name, a gone giant never named, a row swapped into one thing falls as all of them", async () => {
	const plan = { goals: [{ label: "The glass marble ends in the glass jar" }], items: [{ id: "jar", type: "glass-jar", name: "Glass jar" }] }
	swapPhraseLabels(plan, "Swap the glass marble for a steel ball, swap the cup for a glass jar, and put a pencil on the table under Ramp 3.")
	assert.equal(plan.goals[0].label, "The steel ball ends in the glass jar")
	const n2 = await built("n2")
	assert.ok(n2.r.goals.some((g) => g.label === "The tennis ball knocks the first toilet roll"), n2.r.goals.map((g) => g.label).join(" | "))
	assert.ok(!n2.r.goals.some((g) => /toilet toilet/.test(g.label)))
	const n5 = await built("n5")
	assert.deepEqual(n5.r.goals.map((g) => g.label), ["The pendulum starts the run", "All 24 dominoes of the run fall", "The tennis ball lands in the bucket", "All the cereal boxes fall"])
	// (n5t: the row turned into one cereal box, four more added)
	const a = { items: [{ id: "row2", type: "domino-row", x: 0.66, y: 0, props: { count: 9, growth: 1.35 } }, { id: "ball", type: "tennis-ball", x: 1.9, y: 0.3 }, { id: "bucket", type: "bucket", x: 2.2, y: 0 }] }
	const b = { items: [{ id: "row2", type: "cereal-box", name: "Cereal box 1", x: 0.76, y: 0.15 }, ...[2, 3, 4, 5].map((k) => ({ id: `cereal${k}`, type: "cereal-box", name: `Cereal box ${k}`, x: 0.76 + 0.22 * (k - 1), y: 0.15 })), a.items[1], a.items[2]] }
	const goals = [{ kind: "falls", item: "row2", label: "The cereal box fall, up to the giant" }, { kind: "in", item: "ball", container: "bucket", label: "The giant knocks the tennis ball into the bucket" }]
	assert.equal(tidyGoneLabels(goals, a, b), true)
	assert.deepEqual(goals.map((g) => g.label), ["All the cereal boxes fall", "The tennis ball lands in the bucket"])
	assert.deepEqual(goals[0].items, ["row2", "cereal2", "cereal3", "cereal4", "cereal5"])
})

// ---- 6. "next to" and "pinned"; "in the way" only when it is (V8842 k1)
test("a thing pinned in the air beside what it was put by says so; a thing in the chain's path is the reason only when the run without it gets further; a group's place words are said", async () => {
	const k1 = await built("k1r1")
	assert.ok(k1.r.human.includes("added a sneaker pinned in the air beside the box"), k1.r.human.join(" | "))
	const k1b = await built("k1r2")
	assert.doesNotMatch(k1b.r.lead, /sneaker is in the way/, "without the sneaker the books reach nothing either")
	const n5 = await built("n5")
	assert.ok(n5.r.human.some((h) => /^added 2 rubber ducks either side of the pedestal \(/.test(h)), n5.r.human.join(" | "))
})

// ---- 7. a real-size thing's weight; a "Try:" that misses the same way (V8842 k5)
test("a kind with a real everyday size keeps a real one's weight within 20 %: a ping-pong ball made 3.9 g is refused", () => {
	assert.equal(keepsCharacter({ id: "b", type: "ping-pong-ball", props: {} }, { id: "b", type: "ping-pong-ball", props: { mass: 0.0039 } }), "it made the ping-pong ball 3.9 g, far from a real one’s 2.7 g")
	assert.equal(keepsCharacter({ id: "b", type: "ping-pong-ball", props: {} }, { id: "b", type: "ping-pong-ball", props: { mass: 0.003 } }), null)
})

// ---- 8. the repair: what the change moved goes on its own way, with its neighbour if need be, before any call (V8843 c09 r3)
test("a swapped thing the AI moved too little to clear a goal's container is moved further, the container the least the other way, with no call; REPAIR_MS ≥ 18 s", async () => {
	assert.ok(REPAIR_MS >= 18000)
	const { r, log } = await built("c09r3")
	assert.equal(log.length, 1, "no repair call")
	assert.equal((r.sim?.warnings ?? []).filter((w) => /overlap|inside/i.test(w.text ?? "")).length, 0, JSON.stringify(r.sim?.warnings))
	assert.equal(r.edit.repair?.by, "room")
})

// ---- 9. the card's words
test("the card's words: 'the 5 kg steel weight', a participle after 'and', every setting's number, a noun before 'fall', the first words for a thing", async () => {
	const s = starter()
	const named = JSON.parse(JSON.stringify(s))
	named.items.find((i) => i.id === "box").name = "5 kg steel weight"
	assert.match(fixWords([{ kind: "move", ids: ["box"], dx: -0.05, dy: 0 }], named).say, /^move the 5 kg steel weight 5 cm left$/)
	assert.equal(imperative("made the rope pendulum shorter and tilted more"), "make the rope pendulum shorter and tilted more")
	assert.equal(imperative("moved the box and added a cutting board"), "move the box and add a cutting board")
	assert.equal(changesLabel(["made the rope pendulum shorter and tilted more (rope length 80 → 50 cm)", "moved the rope pendulum 12 cm right"]), "2 changes: make the rope pendulum shorter and tilted more, and move the rope pendulum")
	const t = (a, b) => humanChangeList({ items: [a] }, { items: [b] }).map((c) => c.text)
	assert.deepEqual(t({ id: "k", type: "basket", x: 1, y: 0, props: { width: 0.45, depth: 0.3 } }, { id: "k", type: "basket", x: 1, y: 0, props: { width: 0.675, depth: 0.45 } }), ["made the basket wider and deeper (top width 45 → 67.5 cm; depth 30 → 45 cm)"])
	assert.deepEqual(t({ id: "p", type: "rope-pendulum", x: 1, y: 0.8, props: { length: 0.8, start_angle: 40 } }, { id: "p", type: "rope-pendulum", x: 1, y: 0.8, props: { length: 0.5, start_angle: 30 } }), ["made the rope pendulum shorter and pulled back less (rope length 80 → 50 cm; start angle 40° → 30°)"])
	assert.deepEqual(t({ id: "s", type: "seesaw", x: 1, y: 0, props: { pivot_offset: -0.046 } }, { id: "s", type: "seesaw", x: 1, y: 0, props: { pivot_offset: -0.12 } }), ["changed the seesaw (pivot off centre -4.6 → -12 cm)"])
	assert.equal(outcomeWords({ ok: false, fallen: 0, of: 1 }, { kind: "falls", item: "c" }, null, { items: [{ id: "c", type: "cereal-box", name: "Cereal box" }] }), "the cereal box doesn’t fall")
	const k2 = await built("k2r1")
	assert.ok(k2.r.human.includes("swapped the cup for a coffee mug (8 → 12 cm wide)"), k2.r.human.join(" | "))
	// (a long group of moves: the first and how many more, with the distance (V8843 s-box-left10: "Shift Ramp 2…"))
	assert.equal(fixWords([{ kind: "move", ids: ["ramp2", "dominoes", "seesaw"], dx: -0.08, dy: 0 }], s).label, "Shift Ramp 2 and 2 more 8 cm left")
	// (the failed rework's tried list: one thing's changes together, a bracket in the middle closed with a comma (V8843 rw-cupbox / rw-books))
	assert.equal(triedWords(["made the cup post taller (height 17.8 → 40 cm; 187 g → 420 g)", "moved the cup post 63 cm right"]), "made the cup post taller, height 17.8 → 40 cm and 187 g → 420 g; and moved the cup post 63 cm right")
	assert.equal(triedWords(["swapped the box for a stack of books", "moved the pedestal (with the bowling ball on it) 11 cm left"]), "swapped the box for a stack of books; and moved the pedestal, with the bowling ball on it, 11 cm left")
	assert.equal(propChange("domino-row", "growth", 1.19, 1.21), "each one 1.19 → 1.21× the one before")
})
test("chips that give another count: singular kind words, 'N more' and 'a second row of N'; a question for want of room ('run into…') offers the longer table (V8843 counts.mjs)", () => {
	const counts = new Map([["dominoes", 7]])
	const add3 = statedCounts("add 3 more dominoes", counts)
	assert.equal(add3.get("dominoes"), 10)
	assert.equal(contradictsCount("Add 1 more domino", add3, counts), true)
	assert.equal(contradictsCount("Add 3 more dominoes", add3, counts), false)
	const dbl = statedCounts("double the dominoes", counts)
	assert.equal(contradictsCount("Add a second row of 7 dominoes", dbl, counts), false)
	assert.equal(contradictsCount("Add 3 more dominoes", dbl, counts), true)
	const chips = askChips({ reply: "Three more would run into the seesaw. Should I move it?", suggestions: [{ label: "Add 1 more domino", prompt: "Add 1 more domino" }] }, { asked: "add 3 more dominoes", counts })
	assert.deepEqual(chips.map((c) => c.label), ["Make the table longer"])
})
test("a typed 'make it work' waits for the physics' own search by its runs on a busy machine (PHYS_FIRST_RUNS)", () => {
	assert.ok(PHYS_FIRST_RUNS >= 40)
})
