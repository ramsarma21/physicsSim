// The creative edits that ended with no working fix (ai/DESIGN.md §16, "Round 2"; the user's follow-up, 16 Oct: "fix the 3 that still fail
// too"), and the review's repairs: each recorded live edit answer replayed (no model call), the background make-it-work's physics arms run on
// the real engine, and the offered scene checked: every goal met, every thing the person asked for still there and its kind. Plus what the
// person chose is kept (counts, sizes and places their words gave amounts for), goal labels, an "off" goal, a rework that fails in the open
// is never put on the table. node --test web/ai/test/creative-fix.test.mjs
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createOrchestrator, relabelGoals, choicesOf, namedIn, applyPatches } from "../orchestrator.js"
import { checkGoals } from "../goals.js"
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
/** /api/ai/edit answers `edit` (a value, or a function of the payload and the call's number); every other AI step fails. */
const apiWith = (edit, log = []) => async (path, body, signal) => {
	if (path === "/api/simulate") return simulate(body.scene, signal)
	log.push({ step: path.replace("/api/ai/", ""), payload: body.payload })
	if (path !== "/api/ai/edit") return { ok: false, error: "no AI here", code: "error", retryable: false }
	const n = log.filter((l) => l.step === "edit").length
	const a = typeof edit === "function" ? await edit(body.payload, n) : edit
	return a ? { ok: true, result: a, model: "mock/edit", ms: 5 } : { ok: false, error: "no AI here", code: "error", retryable: false }
}
const n = (scene, type) => scene.items.filter((i) => i.type === type).length
/** The edit as the drawer makes it, then the background make-it-work (its physics arms: the AI is not asked). */
async function editThenFix(scene, text, answer) {
	const sim = await simulate(scene)
	const orch = createOrchestrator({ api: apiWith(answer), progress: false })
	const r = await orch.build({ text, mode: "edit", scene, sim }).result
	assert.equal(r.fixNeeded, true, `${text}: the change stops a goal (${r.lead})`)
	const t0 = Date.now()
	const res = await orch.makeItWork(r.fixCtx, { ai: false, job: { text } })
	return { r, res, ms: Date.now() - t0 }
}
/** The offered scene, run: every goal of the edited scene met, nothing starting inside anything, every thing of the edit kept with its kind. */
async function offeredWorks(r, res) {
	assert.equal(res.status, "found", `a checked fix is offered: ${res.info?.why ?? ""}`)
	const scene = JSON.parse(res.info.sceneJSON)
	const run = await simulate(scene)
	const goals = checkGoals(r.scene.goals?.length ? r.scene.goals : r.goals, run)
	assert.ok(goals.length && goals.every((g) => g.ok === true), `every goal: ${goals.map((g) => `${g.label} ${g.ok}`).join("; ")}`)
	assert.equal(run.warnings.length, 0, "nothing starts inside anything")
	for (const it of r.scene.items.filter((i) => i.type !== "table" && i.type !== "wall")) assert.equal(scene.items.find((i) => i.id === it.id)?.type, it.type, `${it.id} kept, its kind too`)
	return scene
}

// ---- the three that had no working fix
test("c03 kitchen bowling (orange, ten standing water bottles): the search offers slimmer bottles, checked; all ten bottles stay water bottles", async () => {
	const answer = { kind: "change", targets: [{ says: "the bowling ball", ids: ["ball"] }, { says: "the ten pins", ids: Array.from({ length: 10 }, (_, k) => `pin${k + 1}`) }], patches: [{ op: "replace_type", id: "ball", type: "orange", props: {} }, { op: "set_item", id: "ball", name: "Orange" }, ...Array.from({ length: 10 }, (_, k) => [{ op: "replace_type", id: `pin${k + 1}`, type: "water-bottle", props: {} }, { op: "set_item", id: `pin${k + 1}`, name: `Bottle ${k + 1}` }]).flat()] }
	const { r, res, ms } = await editThenFix(gallery("bowling-strike"), "Make it a kitchen version: swap the bowling ball for an orange and replace the ten pins with standing water bottles.", answer)
	assert.match(r.lead, /^Done, but now the orange only shoves the first water bottle [\d.]+ cm \(each weighs 512 g\), and none of the 10 fall ✗\.$/)
	const scene = await offeredWorks(r, res)
	assert.equal(n(scene, "water-bottle"), 10)
	assert.match(res.info.say, /^make the 10 water bottles slimmer \([\d.]+ → [\d.]+ cm across each\)$/)
	assert.equal(res.how, "search")
	console.log(`    · ${res.info.say} (${res.info.runs} runs, ${ms} ms)`)
})

test("c09 tennis ball and trampolines: stage by stage, the trampolines are set up again where the tennis ball now comes down, checked; the goals are each pad's own", async () => {
	const answer = { kind: "change", targets: [{ says: "the superball", ids: ["ball"] }, { says: "the three bounce pads", ids: ["pad1", "pad2", "pad3"] }], patches: [{ op: "replace_type", id: "ball", type: "tennis-ball", props: {} }, { op: "set_item", id: "ball", name: "Tennis ball" }, ...[1, 2, 3].flatMap((k) => [{ op: "replace_type", id: `pad${k}`, type: "trampoline", props: { width: 0.3, stiffness: 300 } }, { op: "set_item", id: `pad${k}`, name: `Trampoline ${k}` }]), { op: "move", id: "pad3", x: 2.28 }, { op: "move", id: "basket", x: 2.81 }] }
	const { r, res, ms } = await editThenFix(gallery("bounce-chain"), "Swap the superball for a tennis ball and replace the three bounce pads with trampolines.", answer)
	// (the labels follow the swap, each by its place as the lead and the offer say it: never "Trampoline 1 1", nor "Trampoline 3" beside "the
	// last trampoline" (V8832 c09))
	assert.deepEqual(r.scene.goals.map((g) => g.label.toLowerCase()), ["it bounces off the first trampoline", "it bounces off the 2nd trampoline", "it bounces off the last trampoline", "the tennis ball lands in the basket"])
	assert.deepEqual(r.scene.goals.slice(0, 3).map((g) => g.target), ["pad1", "pad2", "pad3"])
	const scene = await offeredWorks(r, res)
	assert.equal(n(scene, "trampoline"), 3)
	assert.equal(res.how, "stage")
	// (each by its place among its kind, never "Trampoline 1": V8820 c09)
	assert.match(res.info.say, /^move the first trampoline [\d.]+ cm (left|right).*the last trampoline [\d.]+ cm (left|right), to where the tennis ball now comes down on each$/)
	console.log(`    · ${res.info.say} (${res.info.runs} runs, ${ms} ms)`)
})

test("c11 the starter twice as long (14 dominoes): a closed laptop stood after the row tips onto the seesaw, the seesaw and the box moved along to make room, checked; 14 dominoes kept", async () => {
	const answer = { kind: "change", targets: [{ says: "the dominoes", ids: ["dominoes"] }, { says: "the seesaw", ids: ["seesaw"] }, { says: "the box", ids: ["box"] }], patches: [{ op: "set_props", id: "dominoes", props: { count: 14, first_height: 0.06, growth: 1.05 } }, { op: "move", id: "seesaw", dx: 0.076 }, { op: "move", id: "box", dx: 0.076 }] }
	const text = "Make it twice as long: double the dominoes and move the seesaw and the box along so the ball still has a path."
	const { r, res, ms } = await editThenFix(starter(), text, answer)
	// (the person's choices: the count is theirs; the seesaw and the box only from going back, their move had no amount)
	assert.deepEqual(r.edit.hard, [["dominoes", ["count"]]])
	const scene = await offeredWorks(r, res)
	assert.equal(scene.items.find((i) => i.id === "dominoes").props.count, 14)
	assert.ok(scene.items.find((i) => i.id === "seesaw").x > r.scene.items.find((i) => i.id === "seesaw").x, "the seesaw goes further along, never back")
	assert.match(res.info.say, /^stand a closed laptop on its edge between the dominoes and the seesaw, so they tip it onto the seesaw, with .*moved [\d.]+ cm right to make room/)
	console.log(`    · ${res.info.say} (${res.info.runs} runs, ${ms} ms)`)
})

// ---- what the person chose stays theirs
test("choices from the words: an amount holds only the setting it is said with, of the things its own clause names", () => {
	const s = starter()
	const all = new Map(s.items.filter((i) => !/table|wall/.test(i.id)).map((i) => [i.id, "all"]))
	const of = (t, targets = null) => {
		const c = choicesOf(t, all, s, namedIn(t, s), null, targets)
		return { hard: Object.fromEntries([...c.hard].map(([i, k]) => [i, [...k].sort()])), forward: Object.fromEntries([...c.forward].map(([i, k]) => [i, [...k].sort()])) }
	}
	const c11 = of("Make it twice as long: double the dominoes and move the seesaw and the box along so the ball still has a path.")
	assert.deepEqual(c11.hard, { dominoes: ["count"] })
	assert.deepEqual(c11.forward.seesaw, ["place"])
	assert.deepEqual(c11.forward.box, ["place"])
	assert.deepEqual(of("Make the box 5 cm wide and swap the yellow ball for a bowling ball.").hard.box, ["width"])
	assert.deepEqual(of("move the box 10 cm left").hard.box, ["place"])
	assert.deepEqual(of("Make the yellow ball five times heavier.", [{ says: "the yellow ball", ids: ["ball2"] }]).hard.ball2, ["mass"])
	assert.deepEqual(of("move the seesaw a bit to the right").forward.seesaw, ["place"])
})

test("a rework that undoes what the person set is never offered: a count back (c02), a width back (e5), a thing they added moved off (c02's books)", async () => {
	const s = starter()
	const sim = await simulate(s)
	const orch = createOrchestrator({ api: apiWith({ kind: "change", targets: [{ says: "the box", ids: ["box"] }], patches: [{ op: "set_props", id: "box", props: { width: 0.05 } }, { op: "add", item: { id: "board", type: "cutting-board", name: "Cutting board", props: {}, place: { on: "table", x: 0.9 } } }] }), progress: false })
	const r = await orch.build({ text: "Make the box 5 cm wide and add a cutting board on the table.", mode: "edit", scene: s, sim }).result
	assert.ok(r.fixCtx, "a goal stopped")
	assert.deepEqual(r.edit.hard.find((h) => h[0] === "box")?.[1], ["width"])
	const q = orch.reworkRequest(r.fixCtx, { lines: [] })
	assert.deepEqual(q.keep.find((k) => k[0] === "box")?.[1], ["width"], "the button's request keeps the width")
	assert.match(q.feedback, /keep the box's width at 5 cm: the person set those/)
	const as = (patch) => ({ replyOnly: false, scene: { ...r.scene, items: r.scene.items.map((i) => (i.id === patch.id ? { ...i, ...patch.set, props: { ...(i.props ?? {}), ...(patch.props ?? {}) } } : i)) } })
	const judge = (rep) => orch.judgeRework(r.fixCtx, rep, { mine: q.mine, removedTypes: q.removedTypes, targets: r.fixCtx.targets, hard: q.hard })
	assert.match((await judge(as({ id: "box", props: { width: 0.3 } }))).why, /changed the box's width back/)
	assert.match((await judge(as({ id: "board", set: { x: 2.4 } }))).why, /moved the cutting board 1\.5 m from where you put it/)
})

test("a ball wider than the opening of a box the person sized, the ball theirs too (e5): out of reach, said, nothing offered and no AI asked; the box alone sized (s6): the ball may be made smaller", async () => {
	const s = starter()
	const sim = await simulate(s)
	const log = []
	const orch = createOrchestrator({ api: apiWith({ kind: "change", targets: [{ says: "the box", ids: ["box"] }, { says: "the yellow ball", ids: ["ball2"] }], patches: [{ op: "set_props", id: "box", props: { width: 0.05 } }, { op: "replace_type", id: "ball2", type: "bowling-ball", props: {} }] }, log), progress: false })
	const r = await orch.build({ text: "Make the box 5 cm wide and swap the yellow ball for a bowling ball.", mode: "edit", scene: s, sim }).result
	// (said by the edit's own card, its real reason in the lead, and nothing searched: V8817 h1, the lead blamed the seesaw and the chips offered a
	// heavier hit)
	assert.match(r.lead, /^Done, but now the bowling ball \([\d.]+ cm across\) can’t fit the box’s [\d.]+ cm opening, and nothing else can change that ✗\.$/, r.lead)
	assert.equal(r.fix?.state, "none")
	assert.equal(r.fix?.outOfReach, true)
	assert.ok(!r.fixNeeded, "no search after it")
	assert.equal(r.fix.rework, undefined, "no button")
	assert.equal(log.filter((l) => l.step === "edit").length, 1, "the AI was not asked again")
	// (any loose thing, by its narrowest width: a 5 kg steel cube 8.6 cm across for an 8 cm box: V8817 h4)
	const orch3 = createOrchestrator({ api: apiWith({ kind: "change", targets: [{ says: "the box", ids: ["box"] }, { says: "the yellow ball", ids: ["ball2"] }], patches: [{ op: "set_props", id: "box", props: { width: 0.08 } }, { op: "replace_type", id: "ball2", type: "steel-weight-5kg", props: {} }] }), progress: false })
	const r3 = await orch3.build({ text: "Swap the yellow ball for a steel weight (5 kg) and make the box 8 cm wide.", mode: "edit", scene: starter(), sim }).result
	assert.match(r3.lead, /the steel weight \([\d.]+ cm across\) can’t fit the box’s 5\.6 cm opening, and nothing else can change that ✗/, r3.lead)
	assert.equal(r3.fix?.outOfReach, true)
	const orch2 = createOrchestrator({ api: apiWith({ kind: "change", targets: [{ says: "the box", ids: ["box"] }], patches: [{ op: "set_props", id: "box", props: { width: 0.05 } }] }), progress: false })
	const r2 = await orch2.build({ text: "Make the box 5 cm wide.", mode: "edit", scene: starter(), sim }).result
	assert.equal(orch2.outOfReach(r2.fixCtx), null, "the ball is not the person's: it may be made smaller")
})

test("a rework asked in the open that still fails is never put on the table: said with what it tried, the closest offered as an unchecked 'Try:'", async () => {
	const s = starter()
	s.items.find((i) => i.id === "box").x = 2.335
	const sim = await simulate(s)
	const miss = { kind: "fix", reply: "I moved the seesaw.", patches: [{ op: "move", id: "seesaw", dx: 0.05 }] }
	const r = await createOrchestrator({ api: apiWith(miss), progress: false }).build({ text: "Make it work again so that Ball 2 lands in the box.", mode: "edit", scene: s, sim, rework: true, maxRounds: 0, keep: [["box", ["place"]]], hard: [["box", ["place"]]] }, { aimFirst: false }).result
	if (r.replyOnly) {
		assert.match(r.reply, /^The AI’s rework didn’t work either \(it tried: .+\): .+\. Your scene is as it was\.$/)
		assert.equal(r.fix?.state, "none")
		assert.ok(r.fix?.near?.sceneJSON, "the closest it got, as a 'Try:'")
		assert.equal(r.scene, undefined, "nothing to put on the table")
	} else assert.ok((r.targets ?? []).every((t) => t.ok !== false), "or it works (the fix search inside found one)")
})

// ---- goals
test("goal labels follow a swap with their own number ('pad 1' -> 'Trampoline 1'), through a later set_goals, and through a thing taken away and replaced", () => {
	const p = { goals: [{ kind: "hits", item: "ball", target: "pad1", label: "It bounces off pad 1" }] }
	relabelGoals(p, "pad1", ["Bounce pad 1", "Bounce pad", "bounce pad"], "Trampoline 1", [], null, "pad")
	assert.equal(p.goals[0].label, "It bounces off Trampoline 1")
	const p2 = { goals: [{ kind: "hits", item: "ball", target: "pad2", label: "It bounces off pad 2" }] }
	relabelGoals(p2, "pad2", ["Bounce pad 2", "Bounce pad", "bounce pad"], "trampoline", [], null, "pad")
	assert.equal(p2.goals[0].label, "It bounces off trampoline 2")
	const plan = { items: [{ id: "ball", type: "tennis-ball", name: "Tennis ball", place: { on: "table", x: 0 } }, { id: "cone", type: "traffic-cone", name: "Traffic cone", place: { on: "table", x: 1 } }, { id: "bucket", type: "bucket", place: { on: "table", x: 2 } }], goals: [{ kind: "in", item: "ball", container: "bucket", label: "The tennis ball sails over the cone into the bucket" }] }
	const out = applyPatches(plan, [{ op: "replace_type", id: "ball", type: "apple", props: {} }, { op: "remove", id: "cone" }, ...[1, 2, 3].map((k) => ({ op: "add", item: { id: `can${k}`, type: "soda-can", place: { on: "table", x: 1 + 0.08 * k } } })), { op: "replace_type", id: "bucket", type: "plastic-cup" }, { op: "set_goals", goals: plan.goals }])
	assert.equal(out.plan.goals[0].label, "The apple sails over the soda cans into the plastic cup")
})

test("an 'off' goal: a thing past the table's end, or fallen below its top, has left the table; one still over it has not", async () => {
	const s = starter()
	s.items = s.items.filter((i) => i.id !== "wall-right")
	s.items.push({ id: "pp", type: "ping-pong-ball", name: "Ping-pong ball", x: 3.3, y: 0.5 })
	s.items.push({ id: "pp2", type: "ping-pong-ball", name: "Ping-pong ball 2", x: 2.0, y: 0.03 })
	const run = await simulate(s)
	const [a, b] = checkGoals([{ kind: "off", item: "pp", label: "off" }, { kind: "off", item: "pp2", label: "stays" }], run)
	assert.equal(a.ok, true, a.detail)
	assert.equal(b.ok, false)
	assert.match(b.detail, /^it stays over the table, [\d.]+ (cm|m) in from its (left|right) end$/)
})
