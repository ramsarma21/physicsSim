// The review of §16.1 (V8817 / V8818, 16 Oct) and its repairs (ai/DESIGN.md §16.2): a fix that skips the machine is never offered (chainBreak,
// on recorded scenes of every case the review cited), an "Ask the AI to rework it" that works but drops something on a timer is not put on the
// table, the background make-it-work's budget (at most three model calls, a minute in all, the AI only once the physics has looked), an
// outcome the person's change puts out of reach said in the lead, "off the edge" an "off" goal, an outcome edit that tunes only its own
// things, and the card's words (stacked swaps, garbled goal labels, a kind the library has, make-room moves together, goals that follow what
// replaced their things). Every scene runs on the real engine; no model is called.
//   node --test web/ai/test/chain-guard.test.mjs
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createOrchestrator, relabelGoals, humanChangeList, MAKE_IT_WORK_MS, REWORKS, AI_CALLS, SEARCH_MS, AI_AFTER_MS } from "../orchestrator.js"
import { chainBreak, chainOf, fixTargets, claimLabel, pathClaims } from "../fixer.js"
import { offerWords, progressWords, editChips } from "../edit-turns.js"
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
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/chain/${name}.json`, import.meta.url)))
const starter = () => JSON.parse(readFileSync(new URL("../../scenarios/rube-goldberg.json", import.meta.url)))
const gallery = (slug) => JSON.parse(readFileSync(new URL(`../../gallery/${slug}.json`, import.meta.url)))
const replays = JSON.parse(readFileSync(new URL("./fixtures/chain/replays.json", import.meta.url)))
const replay = (id) => replays.find((r) => r.id === id)
/** /api/ai/edit answers `edit` (a value, or a function of the payload and the call's number); every other AI step fails. */
const apiWith = (edit, log = []) => async (path, body, signal) => {
	if (path === "/api/simulate") return simulate(body.scene, signal)
	log.push({ step: path.replace("/api/ai/", ""), payload: body.payload })
	if (path !== "/api/ai/edit") return { ok: false, error: "no AI here", code: "error", retryable: false }
	const n = log.filter((l) => l.step === "edit").length
	const a = typeof edit === "function" ? await edit(body.payload, n) : edit
	return a ? { ok: true, result: JSON.parse(JSON.stringify(a)), model: "mock/edit", ms: 5 } : { ok: false, error: "no AI here", code: "error", retryable: false }
}
/** A recorded case's before / edit / fix scenes, run, and the fix judged through the machine. */
async function judged(name) {
	const f = fixture(name)
	const [sb, se, sk] = [await simulate(f.before), await simulate(f.edit), await simulate(f.fix)]
	const ctx = { scene: f.edit, sim: se, before: { scene: f.before, sim: sb } }
	const tg = fixTargets({ goals: (f.fix.goals ?? []).map((g) => ({ kind: "in", ...g })), scene: f.fix, before: ctx.before, sim: sk })
	assert.ok(sk.summary.goals.every((g) => g.ok), `${name}: the recorded fix meets its goals (that is the trap)`)
	return chainBreak(ctx, f.fix, sk, tg)
}

// ---- 1. a fix must work through the machine
test("chainBreak: the review's four fixes that met the goals while skipping the machine are refused, each for what really happened", async () => {
	assert.match(await judged("h2-no-seesaw"), /^the dominoes would start moving on their own \(at 0\.\d+ s\), with nothing in the machine setting them off$/)
	assert.match(await judged("h3-no-red-ball"), /^the dominoes would start moving on their own/)
	assert.match(await judged("h5-catapult-bowling"), /^the bowling ball would bounce off the invisible wall at the table's end$/)
	assert.match(await judged("c08-orange-lift"), /^the orange would start moving on its own|^the orange would go|^the orange wouldn't stay/)
})

test("chainBreak: the breakfast's checked stand-in goes through the machine (the cans tip the laptop onto the seesaw, which throws the egg)", async () => {
	assert.equal(await judged("c00-breakfast-laptop"), null)
	const f = fixture("c00-breakfast-laptop")
	const c = chainOf(await simulate(f.fix), f.fix)
	assert.equal(c.get("ball1")?.by, null, "the orange is the released driver")
	assert.equal(c.get("ball2")?.by, "seesaw", "the seesaw throws the egg")
	assert.equal(c.get("seesaw")?.by, "standin1", "the laptop strikes the seesaw")
})

test("chainBreak: a container moved behind its launcher, a 'moves' goal that goes the other way, and a path the label claims", async () => {
	const f = fixture("h5-catapult-bowling")
	const sb = await simulate(f.before)
	const se = await simulate(f.edit)
	const ctx = { scene: f.edit, sim: se, before: { scene: f.before, sim: sb } }
	// (the bucket put behind the catapult, the invisible walls taken away so no wall says it first)
	const behind = { ...f.edit, items: f.edit.items.filter((i) => !(i.type === "wall" && i.props?.invisible_in_3d)).map((i) => (i.id === "bucket" ? { ...i, x: -0.24 } : i)) }
	const br = chainBreak(ctx, behind, await simulate(behind), fixTargets({ goals: (f.edit.goals ?? []).map((g) => ({ kind: "in", ...g })), scene: behind, before: ctx.before }))
	assert.equal(br, "the bucket would be moved behind the catapult, away from where it is sent")
	// (path words: claimed only when the scene has that thing)
	assert.deepEqual(pathClaims("The tennis ball sails over the cone into the bucket").map((c) => [c.how, c.what]), [["over", "the cone"]])
	assert.equal(claimLabel("The egg sails over the cone into the basket", f.before), "The egg sails over the cone into the basket")
	assert.equal(claimLabel("The egg sails over the cone into the basket", { items: f.before.items.filter((i) => i.type !== "traffic-cone") }), "The egg sails into the basket")
})

// ---- 2. "Ask the AI to rework it", in the open, judged before it goes on the table
test("an open rework that meets the goal by dropping a new held thing on a timer is not put on the table: said, nothing offered", async () => {
	const f = fixture("c00-breakfast-laptop")
	const scene = f.edit
	const sim = await simulate(scene)
	const drop = { kind: "fix", reply: "I added a steel weight that drops on the seesaw.", patches: [{ op: "add", item: { id: "weight", type: "steel-weight-1kg", name: "Steel weight", held: true, place: { on: "air", x: 2.49, y_m: 0.32 } } }] }
	const r = await createOrchestrator({ api: apiWith(drop), progress: false }).build({ text: "Make it work again so that the egg lands in the box, keeping the orange, the egg, the 5 soda cans and the rubber duck.", mode: "edit", scene, sim, rework: true, maxRounds: 0, reference: f.before, keep: [["ball1", []], ["ball2", []], ["duck", []]], removedTypes: ["domino-row"] }, { aimFirst: false }).result
	assert.equal(r.replyOnly, true, r.lead ?? r.reply)
	assert.equal(r.reworkFailed, true)
	assert.equal(r.scene, undefined, "nothing goes on the table")
	assert.match(r.reply, /^The AI’s rework didn’t work either \(it tried: .*steel weight.*\): .*(on a timer|on its own|still fails|doesn’t happen).*\. Your scene is as it was\.$/, r.reply)
	assert.equal(r.fix?.near, undefined, "and a version refused for how it gets there is no idea to try either")
})

// ---- 3. the budget
test("the background make-it-work's budget: a minute, the search half of it, two reworks and at most two model calls in all", async () => {
	assert.equal(MAKE_IT_WORK_MS, 60000)
	assert.ok(SEARCH_MS <= 30000)
	assert.equal(REWORKS, 2)
	assert.equal(AI_CALLS, 2)
	assert.ok(AI_AFTER_MS >= 15000, "the AI is asked once the physics has looked, never at 8 s")
	// (the AI's part alone, every answer failing and every round asked for: never more than two calls)
	const f = fixture("c00-breakfast-laptop")
	const sim = await simulate(f.before)
	const log = []
	const orch = createOrchestrator({ api: apiWith((payload, n) => (n === 1 ? { kind: "change", reply: "Done.", patches: [{ op: "remove", id: "seesaw" }] } : { kind: "fix", reply: "Moved.", patches: [{ op: "move", id: "box", dx: 0.01 * n }] }), log), progress: false })
	const r = await orch.build({ text: "Remove the seesaw.", mode: "edit", scene: f.before, sim }).result
	assert.equal(r.fixNeeded, true)
	const t0 = Date.now()
	const res = await orch.makeItWork(r.fixCtx, { physics: false, budgetMs: 45000, job: { text: "Remove the seesaw." } })
	const calls = log.filter((l) => l.step === "edit").length - 1
	assert.ok(calls <= 2, `${calls} model calls for one broken edit`)
	assert.ok(res.aiCalls <= 2)
	assert.equal(res.status, "none")
	assert.ok(Date.now() - t0 < 45000)
	// (the card's words: tried for a minute at most)
	assert.equal(offerWords({ state: "none", runs: 300, reworked: true, timedOut: true }).text, "I couldn’t find a change that works (I tried 300 in the physics and the AI’s reworks, for a minute).")
})

test("the 'Looking for a fix…' line is one line for both searches, never one phrasing then the other on every update", () => {
	assert.equal(progressWords({ phase: "search", staging: true, runs: 42 }), " · 42 physics runs, setting each part up again")
	assert.equal(progressWords({ phase: "search", staging: false, runs: 61 }), " · 61 physics runs")
})

// ---- 4. out of reach: the lead says the real reason, nothing is searched, no chip tries the goal another way
test("out of reach: the chips never try to win the goal another way ('Heavier hit on the seesaw'), nor any other unchecked idea", () => {
	const r = { goals: [{ label: "The bowling ball lands in the box", ok: false }], fix: { state: "none", outOfReach: true, why: "the bowling ball (22 cm across) can’t fit the box’s 2.6 cm opening" }, suggestions: [{ label: "Heavier hit on the seesaw", prompt: "Swap the dominoes for heavier ones" }, { label: "Make the box wider", prompt: "Make the box 30 cm wide" }] }
	const chips = editChips(r, { examples: ["Make Ramp 1 steeper", "Swap the bowling ball for a golf ball", "Move the box 10 cm left"] })
	// (while a goal fails, no idea of the AI's at all, a size idea included: it is unchecked (V8832 P7); moving the box changes nothing, and a
	// swap of the person's own bowling ball undoes their choice (V8820 h1: "Swap the bowling ball for a basketball", "Move the box 10 cm left"))
	assert.deepEqual(chips.map((c) => c.label), [])
	assert.deepEqual(offerWords(r.fix), { text: "", button: null }, "the lead already says nothing else can change it")
})

// ---- 5. an outcome edit tunes only its own things; "off the edge" is an "off" goal
test("c01: 'blows a ping-pong ball off the edge' is an off goal; what goes on the table with the edit never changes the rest of the machine", async () => {
	const c = replay("c01-fan-pingpong")
	const scene = gallery("rube-goldberg")
	const sim = await simulate(scene)
	const r = await createOrchestrator({ api: apiWith(c.answer), progress: false }).build({ text: c.text, mode: "edit", scene, sim }).result
	const off = (r.scene?.goals ?? []).find((g) => /ping-pong/i.test(g.label))
	assert.equal(off?.kind, "off", JSON.stringify(r.scene?.goals))
	assert.match(off.label, /off the edge/)
	// (whatever went on the table with it touches only the fan, the ping-pong ball, its shelf and the end wall)
	const original = new Set(scene.items.filter((i) => !(i.type === "wall" && i.props?.invisible_in_3d)).map((i) => i.id))
	for (const id of (r.fixApplied?.changes ?? []).flatMap((x) => (Array.isArray(x.ids) ? x.ids : [x.id]))) assert.ok(!original.has(id), `${id} is part of the original machine: offered, never applied (${r.fixApplied.did})`)
	assert.ok(!/conveyor belt|the box \d/.test(r.lead), r.lead)
	if (!r.fixApplied) assert.equal(r.fixNeeded, true, "nothing of its own works: the panel looks further and offers what works")
})

// ---- 6. the card's words
test("words: a stack swapped for another kind is one line (no 'Brick 4', no re-seat moves), and goal labels the AI wrote for the new thing stay whole", async () => {
	const c = replay("m6-wrecking-kitchen")
	const scene = gallery("wrecking-chain")
	const r = await createOrchestrator({ api: apiWith(c.answer), progress: false }).build({ text: c.text, mode: "edit", scene, sim: await simulate(scene) }).result
	assert.equal(r.human[0], "swapped the 9 bricks for a stack of 9 tissue boxes (2.7 kg → 150 g each)")
	assert.ok(!r.human.some((l) => /Brick \d|tissue box \(with/.test(l)), r.human.join(" | "))
	assert.equal(r.goals[0].label, "The bowling ball hits the top tissue box", "never 'The bowling bowling ball on a rope'")
	const p = replay("c04-pirate-wooden")
	const s4 = gallery("marble-run")
	const r4 = await createOrchestrator({ api: apiWith(p.answer), progress: false }).build({ text: p.text, mode: "edit", scene: s4, sim: await simulate(s4) }).result
	assert.ok(r4.goals.some((g) => g.label === "The cannonball ends in the barrel cup"), JSON.stringify(r4.goals.map((g) => g.label)))
	// (and the relabel rules themselves)
	const plan = { goals: [{ kind: "in", item: "x", container: "c", label: "The bowling ball hits the top tissue box" }, { kind: "hits", item: "ball", target: "pad1", label: "It bounces off pad 1" }] }
	relabelGoals(plan, "x", ["Wrecking ball", "wrecking ball"], "rope pendulum", [], null, "ball")
	relabelGoals(plan, "pad1", ["Pad 1", "Bounce pad", "bounce pad"], "Trampoline 1", [], null, "pad")
	assert.deepEqual(plan.goals.map((g) => g.label), ["The bowling ball hits the top tissue box", "It bounces off Trampoline 1"])
})

test("words: a swap names what it was by its kind before, never by the new kind ('swapped the basket for a basket' was the bucket)", () => {
	const a = { items: [{ id: "table", type: "table", x: 1.3, y: 0 }, { id: "bucket", type: "bucket", name: "Bucket", x: 2, y: 0 }] }
	const b = { items: [{ id: "table", type: "table", x: 1.3, y: 0 }, { id: "bucket", type: "basket", name: "Basket", x: 2, y: 0 }] }
	const lines = humanChangeList(a, b, { says: [{ says: "the basket", ids: ["bucket"] }] }).map((c) => c.text)
	assert.match(lines[0], /^swapped the bucket for a basket/)
})

test("words: a kind the library has is never 'not in the library' (the swap left out is 'Not done'), and an action is no missing thing", async () => {
	const scene = starter()
	const answer = { kind: "change", reply: "Swapped.", patches: [{ op: "replace_type", id: "ball1", type: "golf-ball", props: {} }], missing: [{ asked: "bucket in place of the box", reason: "no bucket in the library" }, { asked: "blowing the ping-pong ball off the table's edge", reason: "not an item" }] }
	const r = await createOrchestrator({ api: apiWith(answer), progress: false }).build({ text: "swap the red ball for a golf ball and the box for a bucket", mode: "edit", scene, sim: await simulate(scene) }).result
	assert.deepEqual(r.missing, [])
	assert.ok((r.edit.skipped ?? []).some((x) => /^bucket in place of the box \(the AI left it out, though the library has a bucket: ask again\)$/.test(x)), JSON.stringify(r.edit.skipped))
})

test("c05: the edit step's make-room move of the ledge and the cup goes together (the golf ball no longer flies 90 cm past an unmoved cup)", async () => {
	const c = replay("c05-cradle-double")
	const scene = gallery("newtons-cradle")
	const r = await createOrchestrator({ api: apiWith(c.answer), progress: false }).build({ text: c.text, mode: "edit", scene, sim: await simulate(scene) }).result
	assert.ok(r.human.includes("moved the cup 89 cm right to make room"), r.human.join(" | "))
	assert.ok(r.human.some((l) => /^moved the ledge \(with the golf ball on it\) 89 cm right to make room$/.test(l)), r.human.join(" | "))
	assert.ok(!(r.edit.leftAlone ?? []).some((x) => /cup/.test(x)))
})

test("c12: goals about the replaced domino run follow the paperback books, and the cup goal is in the scene's goals (the results strip) as the engine's 'walls' kind", async () => {
	const c = replay("c12-paperbacks-cup")
	const scene = gallery("domino-run")
	const r = await createOrchestrator({ api: apiWith(c.answer), progress: false }).build({ text: c.text, mode: "edit", scene, sim: await simulate(scene) }).result
	const labels = r.goals.map((g) => g.label)
	assert.ok(labels.includes("The pendulum starts the run"))
	// (the AI's own goal for the new books is kept when it carried the old one over to them (V8832 m2), else the old one follows them)
	assert.ok(labels.some((l) => /^All (\d+|the) paperback books( of the run)? fall$/.test(l)), labels.join(" | "))
	assert.equal(r.edit.goalsDropped, undefined, "nothing 'No longer checked'")
	const cup = (r.scene.goals ?? []).find((g) => /plastic cup/.test(g.label))
	assert.equal(cup?.kind, "walls")
	const run = await simulate(r.scene)
	assert.ok(run.summary.goals.some((g) => g.kind === "walls" && g.label === cup.label), "the engine's summary has it: the strip shows it")
})

test("words: goals that name what the library doesn't have say its stand-in ('All ten spools fall' for ten cardboard boxes: V8817 m3)", async () => {
	const scene = gallery("bowling-strike")
	const pins = Array.from({ length: 10 }, (_, k) => `pin${k + 1}`)
	const answer = {
		kind: "change",
		reply: "There are no cotton spools, so I used cardboard boxes.",
		patches: [...pins.map((id) => ({ op: "replace_type", id, type: "cardboard-box", props: {} })), { op: "set_goals", goals: [{ kind: "hits", item: "ball", target: "pin1", label: "The bowling ball hits the first spool" }, { kind: "falls", items: pins, label: "All ten spools fall" }] }],
		missing: [{ asked: "cotton spools", reason: "not in the library", substitute_type: "cardboard-box" }]
	}
	const r = await createOrchestrator({ api: apiWith(answer), progress: false }).build({ text: "Replace the ten pins with standing cotton spools.", mode: "edit", scene, sim: await simulate(scene) }).result
	assert.deepEqual(r.goals.map((g) => g.label), ["The bowling ball hits the first cardboard box", "All ten cardboard boxes fall"])
	assert.deepEqual(r.missing.map((m) => m.asked), ["cotton spools"], "a kind the library has none of is still said")
})
