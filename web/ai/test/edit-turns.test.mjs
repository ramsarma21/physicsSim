// The n7 edit helpers (node --test web/ai/test/edit-turns.test.mjs): reading an edit answer's kind first, the measured feedback texts, the
// heads-up, and aiming a container at where the thing now comes down (./aim.js, on the real engine).
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { routeKind, cleanTargets, targetWords, overlapFeedback, fixFeedback, hitsInOrder, newOverlaps, headsUpLines, headsUpText, lastUserTurn, namedInTurn, aimReply, stillFailsText, mishapLines, REPLY_KINDS } from "../edit-turns.js"
import { aimContainer, freePath } from "../aim.js"
import { digestScene, editLead } from "../orchestrator.js"
import { isStaticItem } from "../solver.js"
import { prepare, finish, layout } from "../../sim/index.js"
import { handle } from "../../sim/engine-worker.js"

const simulate = async (scene, signal) => {
	if (signal?.aborted) throw Object.assign(new Error("Cancelled"), { name: "AbortError" })
	const { scene: s, doc, resolved } = prepare(scene)
	const msg = handle({ id: 1, doc, rate: 120 })
	if (msg.error !== undefined) throw new Error(msg.error)
	const meta = finish(s, doc, resolved, msg.track)
	return { key: "k", ms: msg.ms, track: msg.track, doc: meta.doc, summary: meta.summary, warnings: meta.warnings, resolved }
}
const starter = () => JSON.parse(readFileSync(new URL("../../scenarios/rube-goldberg.json", import.meta.url)))
const r5 = (v) => Math.round(v * 1e5) / 1e5

test("routeKind: the kind is read first; an answer without one falls back as measured (undo, patches [] -> answer, else change / fix)", () => {
	assert.equal(routeKind({ kind: "ask", patches: [], reply: "Which ball?" }), "ask")
	assert.equal(routeKind({ kind: "answer", patches: [] }), "answer")
	assert.equal(routeKind({ kind: "undo", undo: true, patches: [] }), "undo")
	assert.equal(routeKind({ kind: "change", patches: [{ op: "move", id: "box", dx: 0.1 }] }), "change")
	assert.equal(routeKind({ kind: "fix", patches: [{ op: "move", id: "box", dx: 0.1 }] }, "make it work again"), "fix")
	assert.equal(routeKind({ kind: "new", mode: "new", patches: [] }), "new")
	assert.equal(routeKind({ mode: "new" }), "new")
	assert.equal(routeKind({ kind: "new", patches: [{ op: "move", id: "box", dx: 0.1 }] }), "change", "kind new with patches is a change (the server's rule)")
	// (no kind: an older answer)
	assert.equal(routeKind({ undo: true, patches: [] }), "undo")
	assert.equal(routeKind({ patches: [] }), "answer")
	assert.equal(routeKind({ patches: [{ op: "move", id: "box", dx: 0.1 }] }, "move the box"), "change")
	assert.equal(routeKind({ patches: [{ op: "move", id: "box", dx: 0.1 }] }, "make it work again"), "fix")
	assert.equal(routeKind({ plan: { items: [] } }), "change", "a whole plan is a change (the orchestrator decides whether it is a new scene)")
	// (a question never changes the scene; a change with nothing to change is an answer)
	assert.equal(routeKind({ kind: "ask", patches: [{ op: "move", id: "box", dx: 0.1 }] }), "ask")
	assert.equal(routeKind({ kind: "change", patches: [] }), "answer")
	assert.ok(["ask", "answer", "undo", "new"].every((k) => REPLY_KINDS.has(k)) && !REPLY_KINDS.has("change") && !REPLY_KINDS.has("fix"))
})

test("targets: tidied as the server's rule says, and said with the names on screen for Details", () => {
	const t = cleanTargets([{ says: "the yellow ball", ids: ["ball2"], because: "yellow, on the seesaw" }, { says: "it", id: "box" }, { says: "x", ids: "ball1" }, 7, null])
	assert.deepEqual(t, [{ says: "the yellow ball", ids: ["ball2"], because: "yellow, on the seesaw" }, { says: "it", ids: ["box"] }, { says: "x", ids: ["ball1"] }])
	assert.deepEqual(targetWords([{ says: "the yellow ball", ids: ["ball2"] }, { says: "both ramps", ids: ["ramp1", "ramp2"] }, { says: "the cat", ids: [] }], starter()), ["“the yellow ball” → Ball 2", "“both ramps” → Ramp 1 and Ramp 2", "“the cat” → nothing on the table"])
})

test("feedback texts are the measured ones (arms.mjs n7): the overlap repair and the make-it-work round", () => {
	const p = [{ op: "set_props", id: "dominoes", props: { count: 10 } }]
	const o = overlapFeedback({ patches: p, diff: ["Dominoes: count 7 → 10"], overlaps: [{ text: "Dominoes overlap Seesaw" }] })
	assert.equal(
		o,
		`# A check of your last answer found problems\nYou sent: ${JSON.stringify(p)}\nWhat it changed in the scene: Dominoes: count 7 → 10\nProblems:\n- Dominoes overlap Seesaw: they must not start inside each other. Make the asked change fit (e.g. its spacing, size or place) or move the neighbour the least that makes room, and say so.\nAnswer again: the WHOLE set of patches against the scene above (the scene before your first answer), doing exactly what the request asks. If the request is a question or truly ambiguous, change nothing.`
	)
	assert.match(overlapFeedback({ patches: p, overlaps: ["A overlaps B"], fix: true }), /What it changed in the scene: nothing\n[\s\S]*doing exactly what the request asks \(and making it work\)\./)
	const sim = { summary: { events: [{ t: 0.61, text: "Ball 1 hits Ramp 2", speed: 1.2 }, { t: 1.5, text: "Ball 2 hits Box" }] } }
	const f = fixFeedback({ patches: p, diff: [], failing: [{ label: "Ball 2 lands in the box", detail: "ends 12 cm right of it" }], overlaps: [{ text: "A overlaps B" }], sim })
	assert.equal(
		f,
		`# Your last answer was applied and run\nYou sent: ${JSON.stringify(p)}\nWhat changed: nothing\nIn its run: FAILED: Ball 2 lands in the box (ends 12 cm right of it). At the start: A overlaps B (not allowed: things must not start inside each other). Hits in order: 0.61 s Ball 1 hits Ramp 2 (1.20 m/s); 1.50 s Ball 2 hits Box.\nIt still does not work. Answer again with the WHOLE set of patches against the scene above (the scene before your first answer), changing what the run shows is wrong, by enough to make it work; keep the things the user chose. Give set_tune knobs (with ranges) on what you change, so a tuner can finish the job.`
	)
	assert.match(fixFeedback({ patches: [], failing: [], sim: null }), /In its run: every goal met\. Hits in order: none\./)
	assert.equal(hitsInOrder({ summary: { events: Array.from({ length: 20 }, (_, i) => ({ t: i, text: `h${i}` })) } }).split("; ").length, 16)
})

test("new start-up overlaps only; the heads-up says what the lead doesn't (stages lost, firm hits gone), at most 3", () => {
	assert.deepEqual(newOverlaps([{ text: "a in b" }], [{ text: "a in b" }, { text: "c in d", items: ["c", "d"] }]), [{ text: "c in d", items: ["c", "d"] }])
	const lines = headsUpLines({
		lost: ["Dominoes: 3 of 7 fall (was 7 of 7)", "Seesaw no longer turns"],
		contacts: ["Ball 1 now hits Box (at 1.20 s)", "Ball 1 no longer hits Ramp 2", "Seesaw no longer hits Ball 2"],
		said: "I swapped Ball 2 for a tennis ball — now the tennis ball hits the side of the box ✗."
	})
	assert.deepEqual(lines, ["Dominoes: 3 of 7 fall (was 7 of 7)", "Seesaw no longer turns", "Ball 1 no longer hits Ramp 2"])
	// (a row the lead already names, as its failing target, is not said twice)
	assert.deepEqual(headsUpLines({ lost: ["Dominoes: 3 of 7 fall (was 7 of 7)"], targets: [{ label: "Dominoes", ok: false, implicit: true }] }), [])
	assert.deepEqual(headsUpLines({ lost: ["Dominoes: 3 of 7 fall (was 7 of 7)"], said: "I moved the dominoes 5 cm left — now dominoes: 3 of 7 fall ✗." }), [])
	assert.equal(headsUpText(["a", "b", "c"]), "Heads-up, in the new run: a, b and c.")
	assert.equal(headsUpText([]), "")
})

test("mishaps (V2 release): what the change added that ran into the table's end or that a module says went wrong is said in the lead, never 'everything still works'", async () => {
	// the AI's edit "Add a second battery car next to it with a hobby motor instead, so the two race" (the scene it made, on the real engine): the
	// hobby-motor car runs into the table's right end at 3.85 s with its battery, and both its leads pull off
	const before = JSON.parse(readFileSync(new URL("./fixtures/race/batterycar-build.scene.json", import.meta.url), "utf8"))
	const after = JSON.parse(readFileSync(new URL("./fixtures/race/batterycar-edit1.scene.json", import.meta.url), "utf8"))
	const sim = await simulate(after)
	const lines = mishapLines({ after: sim, beforeScene: before, afterScene: after, skip: ["car", "motor"] })
	assert.deepEqual(lines.map((l) => l.text), ["Battery 2 (2 AA) and Hobby-motor car run into the end of the table", "Black lead 2 pulled off", "Red lead 2 pulled off"])
	assert.ok(Math.abs(lines[0].t - 3.84) < 0.05 && Math.abs(lines[1].t - 3.9) < 0.05, JSON.stringify(lines))
	// (named as a sentence names them, as the card does: web/ai/fixer.js placeName)
	const { placeName } = await import("../fixer.js")
	const say = (id) => placeName(after.items.find((i) => i.id === id), after)
	assert.equal(mishapLines({ after: sim, beforeScene: before, afterScene: after, skip: ["car", "motor"], say })[0].text, "Battery 2 (2 AA) and the hobby-motor car run into the end of the table")
	// (the things the scene had before are never this change's mishaps; a goal that names a thing may want it so; a goal on the wall, a hit)
	assert.deepEqual(mishapLines({ after: sim, beforeScene: after, afterScene: after }), [])
	assert.deepEqual(mishapLines({ after: sim, beforeScene: before, afterScene: after, skip: ["wire3", "wire4", "wall-right"] }), [])
	const both = [{ label: "The battery car drives forward along the table", ok: true, was: true }, { label: "The motor turns", ok: true, was: true }]
	const said = lines.map((l) => `${l.text} (${l.t.toFixed(2)} s)`)
	const lead = editLead({ changes: ["added a toy car next to the battery (2 AA)"], targets: both, mishaps: said })
	assert.doesNotMatch(lead, /everything still works/)
	assert.match(lead, /^Done — both goals still happen, but Battery 2 \(2 AA\) and Hobby-motor car run into the end of the table \(3\.8\d s\), Black lead 2 pulled off \(3\.9\d s\) and 1 more thing goes wrong ✗$/)
	assert.equal(editLead({ changes: ["x"], targets: both }), "Done — everything still works ✓", "(without mishaps, as before)")
	assert.equal(editLead({ changes: ["x"], targets: [{ label: "The car moves", ok: true }], mishaps: ["Wire 3 pulled off (2.00 s)"] }), "Done — the car moves, but Wire 3 pulled off (2.00 s) ✗")
	assert.equal(editLead({ changes: ["x"], targets: [], mishaps: ["Wire 3 pulled off (2.00 s)"] }), "Done — Wire 3 pulled off (2.00 s) ✗")
})

test("aim helpers: the user's last turn, whether it named the container, and the replies", () => {
	const h = [{ role: "user", text: "move the box 10 cm left" }, { role: "assistant", text: "Moved it." }]
	assert.equal(lastUserTurn(h), "move the box 10 cm left")
	assert.equal(lastUserTurn([]), "")
	assert.ok(namedInTurn({ id: "box", name: "Box" }, "move the box 10 cm left"))
	assert.ok(!namedInTurn({ id: "box", name: "Box" }, "replace the yellow ball with a tennis ball"))
	assert.ok(!namedInTurn({ id: "cup", name: "Cup" }, "make the cupboard taller"))
	assert.equal(aimReply("Box", { dx: 0.123, dy: -0.1 }, "Ball 2 lands in the box."), "I moved the box 12 cm right and 10 cm down, to where the ball now comes down, so “Ball 2 lands in the box” works again. Nothing else changed.")
	assert.equal(aimReply("the red cup", { dx: -0.05 }, "x"), "I moved the red cup 5 cm left, to where the ball now comes down, so “x” works again. Nothing else changed.")
	assert.equal(stillFailsText(["Ball 2 lands in the box"]), "It still doesn't fully work: Ball 2 lands in the box fails in the run.")
	assert.equal(stillFailsText(["A", "B"]), "It still doesn't fully work: A and B fail in the run.")
})

/** The app's way to try a container somewhere else, for the test: the box moved by dx / dy, and the start-up overlaps that are new. */
const moveApply = (scene) => {
	const before = new Set((layout(scene).warnings ?? []).map((w) => w.text))
	return (patches) => {
		const s = JSON.parse(JSON.stringify(scene))
		for (const p of patches) {
			const it = s.items.find((i) => i.id === p.id)
			it.x = r5(it.x + (p.dx ?? 0))
			it.y = r5(it.y + (p.dy ?? 0))
		}
		return { scene: s, overlaps: (layout(s).warnings ?? []).filter((w) => !before.has(w.text)) }
	}
}
const deps = (scene) => ({ simulate, apply: moveApply(scene), isStaticItem, digestScene })

test("aim (real engine): the starter's box moved 12 cm right is aimed back under where Ball 2 now comes down, moving only the box, in ≤ 16 runs", async () => {
	const s = starter()
	s.items.find((i) => i.id === "box").x = r5(2.735 + 0.12)
	const goal = s.goals[0]
	assert.equal((await simulate(s)).summary.goals[0].ok, false, "broken at first")
	const r = await aimContainer({ scene: s }, goal, deps(s))
	assert.ok(r?.patches, `aimed (${r?.runs} runs)`)
	assert.equal(r.patches.length, 1)
	assert.equal(r.patches[0].id, "box")
	assert.ok(r.runs <= 16)
	assert.ok(r.patches[0].dx < 0, "back to the left")
	assert.equal(r.sim.summary.goals.find((g) => g.container === "box").ok, true)
	for (const it of s.items) if (it.id !== "box") assert.deepEqual(r.scene.items.find((i) => i.id === it.id), it)
})

test("aim (real engine): the box raised 30 cm (a box in the air) is aimed at a height where the ball comes down", async () => {
	const s = starter()
	const b = s.items.find((i) => i.id === "box")
	b.y = r5(b.y + 0.3)
	assert.equal((await simulate(s)).summary.goals[0].ok, false, "broken at first")
	const r = await aimContainer({ scene: s }, s.goals[0], deps(s))
	assert.ok(r?.patches, `aimed (${r?.runs} runs)`)
	assert.equal(r.patches[0].id, "box")
	assert.equal(r.sim.summary.goals.find((g) => g.container === "box").ok, true)
})

test("aim: not for a dynamic container or a missing thing; a free path is the thing's own solid; cancel stops it", async () => {
	const s = starter()
	assert.equal(await aimContainer({ scene: s }, { item: "ball2", container: "ball1", label: "x" }, deps(s)), null, "a ball is no container to aim")
	assert.equal(await aimContainer({ scene: s }, { item: "nope", container: "box", label: "x" }, deps(s)), null)
	const sim = await simulate(s)
	const path = freePath(sim, "ball2")
	assert.ok(path.length > 10 && path.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)))
	const ctl = new AbortController()
	ctl.abort()
	await assert.rejects(aimContainer({ scene: s }, s.goals[0], { ...deps(s), signal: ctl.signal }), { name: "AbortError" })
})

// ================================================================ the orchestrator's edit turns (§14.2 (1), (2), (4), (5), (6)), the AI mocked, the real engine
import { createOrchestrator } from "../orchestrator.js"
import { solve } from "../solver.js"

/** A mock of the app's api(): `answers[step]` is a value, an Error, or a function of (payload, n: the call's number). */
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
async function edit(text, answers, { scene = starter(), history = [], keep = null, opts = {} } = {}) {
	const log = []
	const events = []
	const sim = await simulate(scene)
	const r = await createOrchestrator({ api: mockApi(answers, log), progress: false }).build({ text, mode: "edit", scene, sim, history, ...(keep ? { keep } : {}) }, { onEvent: (e) => events.push(e), ...opts }).result
	return { r, log, events, steps: log.map((l) => l.step), scene }
}
const untouchedBut = (r, scene, ids) => {
	for (const it of scene.items) if (!ids.includes(it.id)) assert.deepEqual(r.scene.items.find((i) => i.id === it.id), it, `${it.id} byte for byte`)
}

test("edit (§14.2 (1), (2)): no run is sent; the answer's kind and targets are kept for Details, said with the names on screen", async () => {
	const ans = { kind: "change", targets: [{ says: "the box", ids: ["box"], because: "the only box" }], why: "the user asked to move the box", reply: "I moved the box 10 cm left.", patches: [{ op: "move", id: "box", dx: -0.1 }], suggestions: [{ label: "Move it back", prompt: "move the box 10 cm right" }] }
	const { r, log, steps, scene } = await edit("move the box 10 cm left", { edit: ans })
	assert.deepEqual(steps, ["edit"])
	assert.equal(log[0].payload.sim, undefined)
	assert.equal(log[0].payload.plan, undefined, "the starter was made by hand: no plan")
	assert.equal(log[0].payload.feedback, undefined)
	assert.equal(r.edit.kind, "change")
	assert.deepEqual(r.edit.targets, [{ says: "the box", ids: ["box"], because: "the only box" }])
	assert.deepEqual(r.edit.targetWords, ["“the box” → Box"])
	assert.equal(r.edit.why, "the user asked to move the box")
	assert.deepEqual(r.edit.skipped, [])
	assert.ok(Array.isArray(r.edit.headsUp))
	assert.equal(r.edit.repair, undefined)
	assert.equal(r.concept, null)
	untouchedBut(r, scene, ["box"])
})

test("ask: one question naming the candidates, a chip per reading (each a whole request), nothing placed or run; answer, undo and new change nothing either", async () => {
	const ask = { kind: "ask", targets: [{ says: "the ball", ids: ["ball1", "ball2"] }], reply: "Which ball: the red ball on Ramp 1 or the yellow one on the seesaw?", patches: [], suggestions: [{ label: "The red ball", prompt: "make the red ball (Ball 1) 1.5 times bigger" }, { label: "The yellow ball", prompt: "make the yellow ball (Ball 2) 1.5 times bigger" }] }
	const { r, events, steps } = await edit("make the ball bigger", { edit: ask })
	assert.deepEqual(steps, ["edit"])
	assert.equal(r.replyOnly, true)
	assert.equal(r.reply, ask.reply)
	assert.deepEqual(r.suggestions, ask.suggestions)
	assert.equal(r.edit.kind, "ask")
	assert.deepEqual(r.edit.targetWords, ["“the ball” → Ball 1 and Ball 2"])
	assert.equal(r.scene, undefined, "nothing to put on the table")
	assert.ok(!events.some((e) => e.type === "step" && (e.step === "solve" || e.step === "simulate")), "nothing placed or run")
	const a = await edit("what does the seesaw do?", { edit: { kind: "answer", patches: [], reply: "It flings Ball 2 into the box." } })
	assert.deepEqual([a.r.replyOnly, a.r.edit.kind, a.r.reply], [true, "answer", "It flings Ball 2 into the box."])
	const u = await edit("put it back", { edit: { kind: "undo", undo: true, patches: [], reply: "Use Undo to go back." } })
	assert.deepEqual([u.r.replyOnly, u.r.undo, u.r.edit.kind], [true, true, "undo"])
	const n = await edit("start over with a catapult that flings a ball into a bucket", { edit: { kind: "new", mode: "new", patches: [], reply: "That's a new scene." } })
	assert.deepEqual([n.r.replyOnly, n.r.suggestNew, n.r.edit.kind], [true, true, "new"])
})

test("one overlap repair (§14.2 (4)): new start-up overlaps get ONE more edit call with the measured feedback; its answer is kept only when it has fewer", async () => {
	const twelve = { kind: "change", reply: "I made it 12 dominoes.", patches: [{ op: "set_props", id: "dominoes", props: { count: 12 } }] }
	const eight = { kind: "change", reply: "I made it 8 dominoes, as many as fit before the box.", patches: [{ op: "set_props", id: "dominoes", props: { count: 8 } }] }
	const { r, log, steps } = await edit("make it 12 dominoes", { edit: (p, n) => (n === 1 ? twelve : eight) })
	assert.deepEqual(steps, ["edit", "edit"])
	const fb = log[1].payload.feedback
	assert.match(fb, /^# A check of your last answer found problems\nYou sent: \[\{"op":"set_props","id":"dominoes","props":\{"count":12\}\}\]\nWhat it changed in the scene: .*count 7 → 12.*\nProblems:\n- Dominoes start inside Box[^\n]*: they must not start inside each other\. Make the asked change fit/)
	assert.match(fb, /doing exactly what the request asks\. If the request is a question or truly ambiguous, change nothing\.$/)
	for (const k of ["text", "scene", "history", "intent"]) assert.deepEqual(log[1].payload[k], log[0].payload[k], `${k} as in the first call`)
	assert.deepEqual(r.edit.repair, { before: 1, after: 0, kept: true })
	assert.equal(r.scene.items.find((i) => i.id === "dominoes").props.count, 8)
	assert.equal(r.planned, eight.reply)
	// an answer that is no better is not kept; a question coming back is shown as one (nothing changed)
	const same = await edit("make it 12 dominoes", { edit: twelve })
	assert.deepEqual(same.r.edit.repair, { before: 1, after: 1, kept: false })
	assert.equal(same.r.scene.items.find((i) => i.id === "dominoes").props.count, 12)
	const q = await edit("make it 12 dominoes", { edit: (p, n) => (n === 1 ? twelve : { kind: "ask", patches: [], reply: "Twelve won't fit before the box: shorter spacing, or fewer?", suggestions: [{ label: "Fewer", prompt: "make it 9 dominoes" }] }) })
	assert.equal(q.r.replyOnly, true)
	assert.equal(q.r.edit.kind, "ask")
	assert.equal(q.r.suggestions[0].prompt, "make it 9 dominoes")
})

test("make it work (§14.2 (6a)): the box moved 12 cm right is aimed back under where Ball 2 comes down, alone (the model's own change is not used); every other item byte for byte", async () => {
	const scene = starter()
	scene.items.find((i) => i.id === "box").x = r5(2.735 + 0.12)
	const ans = { kind: "fix", reply: "I moved the box back.", patches: [{ op: "move", id: "box", dx: -0.05 }, { op: "set_props", id: "seesaw", props: { tilt: 14 } }] }
	const { r, steps } = await edit("make it work again", { edit: ans }, { scene })
	assert.deepEqual(steps, ["edit"], "no more model calls")
	assert.equal(r.edit.kind, "fix")
	assert.equal(r.edit.fixFlow.aimed.id, "box")
	assert.ok(r.edit.fixFlow.aimed.runs <= 16)
	assert.equal(r.edit.fixFlow.rounds, 0)
	assert.ok(r.goals.every((g) => g.ok === true), JSON.stringify(r.goals))
	assert.deepEqual(r.edit.stillFails, [])
	untouchedBut(r, scene, ["box"])
	assert.match(r.planned, /^I moved the box \d+ cm left, to where the ball now comes down, so “Ball 2 lands in the box” works again\. Nothing else changed\.$/)
	// (the lead is the outcome: the card lists the change right under it)
	assert.equal(r.lead, "Done — Ball 2 lands in the box ✓")
	assert.equal(r.human.length, 1)
	assert.match(r.human[0], /^moved the box \d+ cm left$/)
	// a box the person's last turn moved is never aimed (that would undo it): the model's answer goes on, then its rounds and the fix search
	const h = await edit("make it work again", { edit: ans }, { scene, history: [{ role: "user", text: "move the box 12 cm right" }, { role: "assistant", text: "I moved the box 12 cm right." }] })
	assert.equal(h.r.edit.fixFlow.aimed, null)
})

test("make it work (§14.2 (6b)): without an aim, ≤ 2 more edit calls told how the run went (the measured text); the best version is kept, and one that undoes a kind the person chose never is", async () => {
	const scene = starter()
	scene.items.find((i) => i.id === "box").x = r5(2.735 + 0.12)
	const miss = { kind: "fix", reply: "I moved the box.", patches: [{ op: "move", id: "box", dx: 0.05 }] }
	const hit = { kind: "fix", reply: "I moved the box back under the ball.", patches: [{ op: "move", id: "box", dx: -0.1177 }] }
	// (the physics' own search on the scene as it is, which would find this before any round (§16.5), is left out: these are the AI's rounds)
	const { r, log, steps } = await edit("make it work again", { edit: (p, n) => (n === 1 ? miss : hit) }, { scene, opts: { aimFirst: false, physFirst: false } })
	assert.deepEqual(steps, ["edit", "edit"])
	assert.match(log[1].payload.feedback, /^# Your last answer was applied and run\nYou sent: \[\{"op":"move","id":"box","dx":0\.05\}\]\nWhat changed: .*\nIn its run: FAILED: Ball 2 lands in the box[^\n]*\. Hits in order: .*\nIt still does not work\. Answer again with the WHOLE set of patches/)
	assert.equal(r.edit.fixFlow.rounds, 1)
	assert.ok(r.goals.every((g) => g.ok === true), JSON.stringify(r.goals))
	assert.equal(r.planned, hit.reply)
	untouchedBut(r, scene, ["box"])
	// an answer that swaps the person's tennis ball back is never taken (the scene as it is goes on instead)
	const swapped = starter()
	const b2 = swapped.items.find((i) => i.id === "ball2")
	Object.assign(b2, { type: "tennis-ball", name: "Tennis ball", y: r5(b2.y + 0.0035) })
	const back = { kind: "fix", reply: "I swapped the tennis ball back.", patches: [{ op: "replace_type", id: "ball2", type: "plastic-ball" }] }
	const s = await edit("make it work again", { edit: back }, { scene: swapped, opts: { aimFirst: false } })
	assert.equal(s.r.scene.items.find((i) => i.id === "ball2").type, "tennis-ball")
	assert.equal(s.r.edit.fixFlow.dropped, "the answer undid what you chose (turning the tennis ball into a hollow plastic ball)")
	assert.equal(s.r.edit.fixFlow.rounds, 0, "an answer that undid the person's choice skips the rounds (asked again, it did so again)")
	// (and the reply never says "nothing needed changing" for it: round 3's acceptance, "remove the seesaw" then "make it work again")
	assert.doesNotMatch(s.r.lead ?? s.r.reply, /Nothing needed changing/)
})

test("a plain change is never made to work: one run, the heads-up for what the lead doesn't say, the checked fix offered (the user's rule)", async () => {
	const { r, steps, events } = await edit("make the first domino 5 cm tall", { edit: { kind: "change", reply: "I made the first domino 5 cm tall.", patches: [{ op: "set_props", id: "dominoes", props: { first_height: 0.05 } }] } })
	assert.deepEqual(steps, ["edit"])
	assert.equal(events.filter((e) => e.type === "step" && e.step === "simulate" && e.state === "done").length, 1, "the physics ran once")
	assert.equal(r.fixNeeded, true, "the panel's checked fix chip")
	assert.equal(r.fixApplied, undefined)
	assert.ok(r.goals.some((g) => g.ok === false))
	assert.match(r.lead, /^Done, but now .* ✗\.$/)
	assert.deepEqual(r.human, ["made the dominoes shorter (first domino height 9.8 → 5 cm)"], "(the change itself is the card's list, in real units)")
	// (the lead says where the chain stops, the seesaw: the heads-up never repeats it)
	console.log("    · lead:", r.lead, "· heads-up:", JSON.stringify(r.edit.headsUp))
	assert.ok(/\bseesaw\b/i.test(r.lead) ? r.edit.headsUp.length === 0 : JSON.stringify(r.edit.headsUp) === JSON.stringify(["Seesaw no longer turns"]), `${r.lead} / ${JSON.stringify(r.edit.headsUp)}`)
	assert.equal(r.edit.fixFlow, undefined)
	assert.equal(r.edit.stillFails, undefined)
})
