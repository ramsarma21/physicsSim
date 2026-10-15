// The fix search after an edit (./fixer.js) on recorded runs, and with the real engine on the starter and three other scenarios
// (node --test web/ai/test/fixer.test.mjs). The recorded runs are web/ai/test/fixtures/fix/*.run.json.gz (the engine's own answers).
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { findFix, fixTargets, judge, outcomeWords, fixWords, containerGeo, newHit, applyChanges, _intercept } from "../fixer.js"
import { createOrchestrator, fixInfo, statesOutcome, editLead } from "../orchestrator.js"
import { prepare, finish } from "../../sim/index.js"
import { handle } from "../../sim/engine-worker.js"

const simulate = async (scene, signal) => {
	if (signal?.aborted) throw Object.assign(new Error("Cancelled"), { name: "AbortError" })
	const { scene: s, doc, resolved } = prepare(scene)
	const msg = handle({ id: 1, doc, rate: 120 })
	if (msg.error !== undefined) throw new Error(msg.error)
	const meta = finish(s, doc, resolved, msg.track)
	return { key: "k", ms: msg.ms, track: msg.track, doc: meta.doc, summary: meta.summary, warnings: meta.warnings, resolved }
}
const rec = (name) => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/fix/${name}.run.json.gz`, import.meta.url))))
const scenario = (id) => JSON.parse(readFileSync(new URL(`../../scenarios/${id}.json`, import.meta.url)))
const mockApi = (patches) => async (path, body, signal) => (path === "/api/simulate" ? simulate(body.scene, signal) : { ok: true, result: { mode: "patch", reply: "Done.", patches, suggestions: [] }, model: "mock", ms: 1 })
/** An edit of a scene through the pipeline (the AI's answer mocked), then the fix search the panel runs after it. */
async function editThenFix(scene, text, patches) {
	const sim = await simulate(scene)
	const ai = createOrchestrator({ api: mockApi(patches) })
	const t0 = performance.now()
	const r = await ai.build({ text, mode: "edit", scene, sim }).result
	const editMs = Math.round(performance.now() - t0)
	if (!r.fixNeeded) return { r, editMs, fr: null }
	const t1 = performance.now()
	// (one engine on this thread: the page runs four at once, so the same number of runs gets the time it would take here)
	const fr = await ai.findFix(r.fixCtx, { budgetMs: 30000 })
	return { r, editMs, fr, fixMs: Math.round(performance.now() - t1) }
}
/** A found fix, checked again: its scene re-run in the engine makes every target happen, and adds no start-up warnings. */
async function verifyFix(r, fr) {
	const s = await simulate(fr.fix.scene)
	const res = judge(fr.targets, s)
	assert.ok(res.every((x) => x.ok === true), `the fix works when run again: ${JSON.stringify(res.map((x) => [x.label, x.ok]))}`)
	assert.ok((s.warnings?.length ?? 0) <= (r.fixCtx.sim.warnings?.length ?? 0), "no new start-up warnings")
	// only what the fix changed differs from the edited scene
	const moved = new Set(fr.fix.changes.flatMap((c) => (c.kind === "move" ? c.ids : [c.id])))
	const A = new Map(r.scene.items.map((i) => [i.id, JSON.stringify(i)]))
	for (const it of fr.fix.scene.items) if (A.get(it.id) !== JSON.stringify(it)) assert.ok(moved.has(it.id) || r.fixCtx.scene.items.some((o) => moved.has(o.id)), `${it.id} changed`)
	return s
}
const log = (...a) => console.log("  ·", ...a)

// ================================================================ recorded runs
test("recorded swap run: the targets (the goal and the row that all fell before), what the tennis ball does instead, and where the box could catch it", () => {
	const before = rec("starter")
	const { scene, sim } = rec("swap")
	const targets = fixTargets({ scene, before, sim })
	assert.deepEqual(targets.map((t) => [t.label, t.implicit]), [["Tennis ball lands in the box", false], ["All 7 dominoes fall", true]])
	const res = judge(targets, sim)
	assert.deepEqual(res.map((r) => r.ok), [false, true])
	assert.equal(outcomeWords(res[0], targets[0].goal, sim, scene, before), "the tennis ball hits the side of the box and drops outside")
	const C = containerGeo(scene, sim, "box")
	assert.ok(Math.abs(C.inL - 2.617) < 1e-9 && Math.abs(C.inR - 2.853) < 1e-9 && Math.abs(C.rim - 0.32) < 1e-9, JSON.stringify(C))
	// the flight crosses the rim's height on its way down just right of the box: lower it a little (and nudge it right)
	const cands = _intercept({ scene, sim, goal: targets[0].goal, air: true })
	assert.ok(cands.length >= 3, JSON.stringify(cands))
	for (const c of cands) assert.deepEqual(c.changes[0].ids, ["box"])
	assert.ok(cands.some((c) => c.changes[0].dy < 0 && Math.abs(c.changes[0].dx) <= 0.01), "a lowered box under the flight")
	assert.ok(cands.every((c) => c.changes[0].dy <= 0), "never raised: the tennis ball tops out below the rim")
	// a standing box would only move along the table
	assert.ok(_intercept({ scene, sim, goal: targets[0].goal, air: false }).every((c) => c.changes[0].dy === 0))
})

test("recorded box-left run: the new hit that broke the chain is said, and riders go with what they rest on", () => {
	const before = rec("starter")
	const { scene, sim } = rec("box-left")
	assert.equal(newHit(before, sim, scene), "the dominoes hit the box")
	const targets = fixTargets({ scene, before, sim })
	const res = judge(targets, sim)
	assert.equal(outcomeWords(res[0], targets[0].goal, sim, scene, before), "the dominoes hit the box, so Ball 2 never moves")
	// moving the seesaw carries Ball 2, which rests on it
	const moved = applyChanges(scene, [{ kind: "move", ids: ["seesaw"], dx: -0.05, dy: 0 }])
	const was = (id) => scene.items.find((i) => i.id === id)
	const now = (id) => moved.items.find((i) => i.id === id)
	assert.ok(Math.abs(now("seesaw").x - (was("seesaw").x - 0.05)) < 1e-4)
	assert.ok(Math.abs(now("ball2").x - (was("ball2").x - 0.05)) < 1e-4, "Ball 2 rides along")
	assert.equal(JSON.stringify(now("box")), JSON.stringify(was("box")))
})

test("a fix in words: an instruction, what was done, and a short chip label (real units, plain verbs)", () => {
	const { scene } = rec("swap")
	const w = (changes) => fixWords(changes, scene)
	assert.deepEqual(w([{ kind: "move", ids: ["box"], dx: 0.09, dy: 0 }]), { say: "move the box 9 cm right", did: "moved the box 9 cm right", label: "Move the box 9 cm right" })
	assert.deepEqual(w([{ kind: "move", ids: ["box"], dx: 0, dy: -0.04 }]), { say: "lower the box 4 cm", did: "lowered the box 4 cm", label: "Lower the box 4 cm" })
	assert.equal(w([{ kind: "move", ids: ["box"], dx: 0.01, dy: -0.02 }]).say, "move the box 1 cm right and 2 cm down")
	assert.equal(w([{ kind: "move", ids: ["seesaw"], dx: -0.02, dy: 0 }]).say, "move the seesaw (with the tennis ball on it) 2 cm left")
	assert.deepEqual(w([{ kind: "move", ids: ["dominoes", "seesaw"], dx: -0.08, dy: 0, follows: "box" }]), { say: "shift the dominoes, the seesaw and the tennis ball 8 cm left to line up with the box", did: "shifted the dominoes, the seesaw and the tennis ball 8 cm left to line up with the box", label: "Shift 3 things 8 cm left" })
	assert.equal(w([{ kind: "turn", id: "ramp2", d: 1 }]).say, "tilt Ramp 2 1° flatter (19.8° → 18.8°)")
	assert.equal(w([{ kind: "prop", id: "seesaw", key: "tilt", from: 12.452, to: 11.5 }]).say, "tilt the seesaw less (12.5° → 11.5°)")
	assert.equal(w([{ kind: "prop", id: "dominoes", key: "spacing", from: 0.568, to: 0.48 }]).label, "Space the dominoes closer together")
	assert.equal(w([{ kind: "prop", id: "ball2", key: "mass", from: 0.0577, to: 0.04 }]).say, "make the tennis ball lighter (58 g → 40 g)")
})

test("which requests state an outcome (their edit is made to work too)", () => {
	for (const t of ["make it work", "move the box 10 cm left so the ball still lands in it", "Fix it so Ball 2 lands in the box", "Make the golf ball land in cup 3", "add a tennis ball that rolls into the cup", "Make it work again so that ball 2 lands in the box"]) assert.equal(statesOutcome(t), true, t)
	for (const t of ["move the box 10 cm left", "make the dominoes taller", "add 5 more dominoes", "swap the yellow ball for a tennis ball", "make the tennis ball heavier", "rotate ramp 2 by 5°"]) assert.equal(statesOutcome(t), false, t)
})

test("the reply's first sentence: what changed, then what happens instead (now / still), or that it works", () => {
	const t = (o) => editLead({ changes: ["moved the box 10 cm left"], ...o })
	assert.equal(t({ targets: [{ label: "Ball 2 lands in the box", ok: false, was: true, happened: "Ball 2 flies 6 cm past the box" }] }), "I moved the box 10 cm left — now Ball 2 flies 6 cm past the box ✗.")
	assert.equal(t({ targets: [{ label: "Ball 2 lands in the box", ok: false, was: false, happened: "Ball 2 flies 6 cm past the box" }] }), "I moved the box 10 cm left — it still doesn’t work: Ball 2 flies 6 cm past the box ✗.")
	assert.equal(t({ targets: [{ label: "Ball 2 lands in the box", ok: true, was: true }, { label: "All 7 dominoes fall", ok: true, implicit: true }] }), "Done! I moved the box 10 cm left — Ball 2 lands in the box, as before ✓")
	assert.equal(t({ targets: [{ label: "Ball 2 lands in the box", ok: true, was: true }], fixApplied: { did: "lowered the seesaw 2 cm" } }), "Done! I moved the box 10 cm left, and lowered the seesaw 2 cm so it works — Ball 2 lands in the box ✓")
	assert.equal(t({ targets: [{ label: "All 7 dominoes fall", ok: false, was: true, implicit: true, happened: "only 3 of 7 dominoes fall" }] }), "I moved the box 10 cm left — now only 3 of 7 dominoes fall ✗.")
})

test("cancel stops the search at once (AbortError)", async () => {
	const { scene, sim } = rec("swap")
	const ctl = new AbortController()
	const p = findFix({ scene, sim, before: rec("starter"), touched: new Map([["ball2", "all"], ["ball1", "all"]]), swapped: new Set(["ball2", "ball1"]) }, { simulate, signal: ctl.signal, onProgress: (pr) => pr.runs >= 2 && ctl.abort() })
	await assert.rejects(p, (e) => e.name === "AbortError")
})

// ================================================================ the real engine: the user's starter edits
const starterCases = [
	["swap", "replace the yellow ball with a tennis ball and the red ball with a basketball", [{ op: "replace_type", id: "ball2", type: "tennis-ball" }, { op: "replace_type", id: "ball1", type: "basketball" }], (s) => s.items.find((i) => i.id === "ball2").type === "tennis-ball" && s.items.find((i) => i.id === "ball1").type === "basketball", true],
	["taller", "make the dominoes taller", [{ op: "set_props", id: "dominoes", props: { first_height: 0.13 } }], (s) => s.items.find((i) => i.id === "dominoes").props.first_height === 0.13, null],
	["box", "move the box 10 cm left", [{ op: "move", id: "box", dx: -0.1 }], (s) => Math.abs(s.items.find((i) => i.id === "box").x - 2.635) < 1e-6, true],
	["more", "add 5 more dominoes", [{ op: "set_props", id: "dominoes", props: { count: 12 } }], (s) => s.items.find((i) => i.id === "dominoes").props.count === 12, null],
	["ramp2", "rotate ramp 2 by 5°", [{ op: "move", id: "ramp2", angle_deg: -24.757 }], (s) => Math.abs(s.items.find((i) => i.id === "ramp2").angle + 24.757) < 1e-3, true]
]
for (const [name, text, patches, kept, mustFind] of starterCases)
	test(`starter (real engine): "${text}" — one run, the reply says what happens instead, and the fix offered (if any) keeps the change and works`, async () => {
		const { r, fr, editMs, fixMs } = await editThenFix(scenario("rube-goldberg"), text, patches)
		assert.ok(kept(r.scene), "the edit is exactly what was asked")
		assert.equal(r.fixNeeded, true, r.lead)
		assert.match(r.lead, / — now .+ ✗\.$/, r.lead)
		log(`${name}: edit ${editMs} ms · "${r.lead}" · search ${fixMs} ms, ${fr.runs} runs → ${fr.status}${fr.fix ? `: ${fr.fix.words.say}` : fr.near ? ` (closest: ${fr.near.words.say}: ${fr.near.happened})` : ""}`)
		if (mustFind) assert.equal(fr.status, "found")
		if (fr.status === "found") {
			assert.ok(kept(fr.fix.scene), "the fix never undoes the change")
			await verifyFix(r, fr)
			const info = fixInfo(fr, r.scene, fr.targets)
			assert.ok(info.label.length <= 46, info.label)
			assert.match(info.checked, /lands in the box/)
		} else assert.equal(fr.status, "none")
	})

test("starter (real engine): the tennis ball made heavier after the swap was fixed — a checked fix again (never undoing the weight)", async () => {
	const s0 = scenario("rube-goldberg")
	const first = await editThenFix(s0, "swap the yellow ball for a tennis ball", [{ op: "replace_type", id: "ball2", type: "tennis-ball" }])
	assert.equal(first.fr.status, "found")
	const fixed = first.fr.fix.scene
	const { r, fr, fixMs } = await editThenFix(fixed, "make the tennis ball heavier", [{ op: "set_props", id: "ball2", props: { mass: 0.09 } }])
	assert.equal(r.scene.items.find((i) => i.id === "ball2").props.mass, 0.09)
	log(`heavier: "${r.lead}" · ${fr ? `search ${fixMs} ms, ${fr.runs} runs → ${fr.status}${fr.fix ? `: ${fr.fix.words.say}` : ""}` : "nothing broke"}`)
	if (fr?.status === "found") {
		assert.equal(fr.fix.scene.items.find((i) => i.id === "ball2").props.mass, 0.09, "the weight the person set stays")
		await verifyFix(r, fr)
	} else if (fr) {
		assert.equal(fr.status, "none")
		// (nothing found in the budget: said plainly; a closest miss, when there is one, keeps the weight too)
		if (fr.near) assert.equal(fr.near.scene.items.find((i) => i.id === "ball2").props.mass, 0.09)
	}
})

// ================================================================ the real engine: three other scenarios
test("spring launcher (real engine): the cup moved away — the launcher is pulled back further (the cup stays where it was put)", async () => {
	const { r, fr } = await editThenFix(scenario("spring-launch"), "move the cup 10 cm right", [{ op: "move", id: "cup", dx: 0.1 }])
	assert.match(r.lead, /^I moved the cup 10 cm right — now the golf ball .+ ✗\.$/, r.lead)
	assert.equal(fr.status, "found")
	assert.ok(Math.abs(fr.fix.scene.items.find((i) => i.id === "cup").x - 2.09) < 1e-6, "the cup stays")
	await verifyFix(r, fr)
	log(`spring: "${r.lead}" → ${fr.fix.words.say} (${fr.runs} runs)`)
	// and a weaker launch: the cup (untouched) moves under the flight
	const w = await editThenFix(scenario("spring-launch"), "pull the launcher back less", [{ op: "set_props", id: "launcher", props: { compression: 0.035 } }])
	assert.match(w.r.lead, /^I pulled the spring launcher back less \(4\.6 → 3\.5 cm\) — now /, w.r.lead)
	assert.equal(w.fr.status, "found")
	assert.match(w.fr.fix.words.say, /^move the cup \d+ cm (left|right)$/, w.fr.fix.words.say)
	await verifyFix(w.r, w.fr)
})

test("car, ramp and dominoes (real engine, no stated goals): a flatter ramp stops the row that all fell — the row itself is the goal won back", async () => {
	const { r, fr } = await editThenFix(scenario("car-ramp-dominoes"), "make the ramp less steep", [{ op: "move", id: "ramp", angle_deg: -6 }])
	assert.deepEqual(r.targets.map((t) => [t.label, t.ok, t.implicit]), [["All 7 dominoes fall", false, true]])
	assert.match(r.lead, / — now (none|only \d+) of (the dominoes|7 dominoes) fall ✗\.$/, r.lead)
	assert.equal(fr.status, "found")
	await verifyFix(r, fr)
	assert.equal(fixInfo(fr, r.scene, fr.targets).checked, "All 7 dominoes fall")
	log(`car: "${r.lead}" → ${fr.fix.words.say} (${fr.runs} runs)`)
})

test("plinko (real engine): a request that states the outcome ('land in cup 3') gets the fix as part of the edit", async () => {
	const s0 = scenario("plinko")
	const sim = await simulate(s0)
	const r = await createOrchestrator({ api: mockApi([{ op: "set_goals", goals: [{ kind: "in", item: "ball", container: "cup3", label: "The golf ball lands in cup 3" }] }]) }).build({ text: "make the golf ball land in cup 3", mode: "edit", scene: s0, sim }).result
	assert.ok(r.fixApplied, r.lead)
	assert.ok(r.goals.every((g) => g.ok === true), JSON.stringify(r.goals))
	assert.match(r.lead, /^Done! I .+ — the golf ball lands in cup 3 ✓$/, r.lead)
	const again = await simulate(r.scene)
	assert.equal(again.summary.goals.find((g) => g.container === "cup3")?.ok, true, "the scene put on the table does it")
	log(`plinko: "${r.lead}"`)
})
