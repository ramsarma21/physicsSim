// ai/steps.mjs: input checks (400s) and each step end to end through the mock gateway with the real catalog, prompts and validators.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { after, before, beforeEach, test } from "node:test"
import { AIError } from "../core.mjs"
import { loadPrompt, runStep } from "../steps.mjs"
import { mockEnv, startMockGateway, testRouting } from "./mock-gateway.mjs"

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
const PG = new URL("../../", import.meta.url)
const scenario = (id) => JSON.parse(readFileSync(new URL(`web/scenarios/${id}.json`, PG), "utf8"))
let gw
before(async () => {
	gw = await startMockGateway()
})
after(async () => {
	await gw.close()
})
beforeEach(() => gw.reset())
const opts = () => ({ env: mockEnv(gw), routing: testRouting(), backoffScale: 0.01 })
const badInput = (re) => (e) => e instanceof AIError && e.code === "bad_input" && e.status === 400 && re.test(e.message)

const PLAN = {
	title: "Ball into the pot",
	seconds: 4,
	items: [
		{ id: "ramp", type: "plank", name: "Ramp", place: { lean: { from: { on: "air", x: 0, y: 0.7 }, to: { on: "air", x: 0.8, y: 0.45 } } }, why: "ramp" },
		{ id: "ball", type: "tennis-ball", name: "Ball", place: { on: "ramp", x: 0.06 }, held: true, why: "rolls" },
		{ id: "pot", type: "bucket", name: "Pot", place: { on: "table", x: 1.25 }, why: "target" }
	],
	missing: [],
	goals: [{ label: "Ball in the pot", item: "ball", container: "pot" }],
	tune: [{ id: "pot", param: "x", min: 1, max: 1.7 }],
	notes: "x"
}
const OBS = {
	objects: [{ label: "ball", count: 1, bbox: [0.1, 0.1, 0.2, 0.2], est_size_m: null, material: "rubber", color: "red", state: "resting", supports: null }],
	relations: [],
	motion_story: [],
	view: { camera: "side", plane: "image right = +x" },
	scale_hint: null,
	uncertain: []
}

test("bad input is a 400 with a plain reason, before any model call", async () => {
	await assert.rejects(runStep("dance", {}, opts()), badInput(/unknown step "dance"/))
	await assert.rejects(runStep("plan", "text", opts()), badInput(/payload must be an object/))
	await assert.rejects(runStep("observe", { text: "x" }, opts()), badInput(/images is missing/))
	await assert.rejects(runStep("observe", { images: ["http://example.com/a.jpg"] }, opts()), badInput(/data URL/))
	await assert.rejects(runStep("observe", { images: [PNG, PNG, PNG, PNG, PNG] }, opts()), badInput(/at most 4/))
	await assert.rejects(runStep("observe", { images: ["data:image/png;base64,!!!!not base64!!!!"] }, opts()), badInput(/not valid base64/))
	await assert.rejects(runStep("plan", {}, opts()), badInput(/text is missing/))
	await assert.rejects(runStep("plan", { text: 5 }, opts()), badInput(/text must be text/))
	await assert.rejects(runStep("plan", { text: "x".repeat(9000) }, opts()), badInput(/too long/))
	await assert.rejects(runStep("plan", { text: "x", observation: { objects: 3 } }, opts()), badInput(/observation is not valid/))
	await assert.rejects(runStep("plan", { text: "x", scene: { items: [{ id: "a/b", type: "superball" }] } }, opts()), badInput(/scene: item 1 \(superball\) needs an id/))
	await assert.rejects(runStep("refine", { text: "x", scene: scenario("empty") }, opts()), badInput(/plan is missing/))
	await assert.rejects(runStep("refine", { plan: PLAN }, opts()), badInput(/scene is missing/))
	await assert.rejects(runStep("refine", { plan: PLAN, scene: scenario("empty"), sim: 3 }, opts()), badInput(/sim must be an object/))
	await assert.rejects(runStep("edit", { text: "move it" }, opts()), badInput(/scene is missing/))
	await assert.rejects(runStep("edit", { scene: scenario("empty") }, opts()), badInput(/text is missing/))
	await assert.rejects(runStep("edit", { text: "x", scene: scenario("empty"), history: [{ role: "system", text: "x" }] }, opts()), badInput(/history\[0\]/))
	assert.equal(gw.requests.length, 0)
})

test("observe: the pictures and the request reach a vision route; the observation comes back validated", async () => {
	gw.script("m1", [{ content: JSON.stringify(OBS) }])
	const out = await runStep("observe", { text: "a ball", images: [PNG, { data: PNG, label: "close-up" }] }, opts())
	assert.equal(out.result.objects[0].label, "ball")
	const msg = gw.requests[0].body.messages
	assert.match(msg[0].content, /You look at reference pictures/)
	const parts = msg[1].content
	assert.equal(parts.filter((p) => p.type === "image_url").length, 2)
	assert.match(parts[0].text, /picture 1 \(close-up\)/)
})

test("plan: the system prompt carries the catalog; a broken plan is repaired with its errors shown", async () => {
	const broken = structuredClone(PLAN)
	broken.items[1].type = "tenis-ball"
	broken.items[2].props = { width: 9 }
	gw.script("m1", [{ content: JSON.stringify(broken) }, { content: JSON.stringify(PLAN) }])
	// (a scene on screen is never planned over: a picture build plans a new scene; a change goes to the edit step, §13.8)
	const out = await runStep("plan", { text: "A tennis ball rolls down a ramp into a pot", observation: OBS, scene: scenario("rube-goldberg") }, opts())
	assert.equal(out.result.items.length, 3)
	assert.equal(out.repaired, true)
	assert.ok(out.catalog.fingerprint)
	const [first, second] = gw.requests
	const sys = first.body.messages[0].content
	assert.match(sys, /### tennis-ball — Tennis ball/)
	assert.match(sys, /All motion happens in one vertical plane/)
	assert.doesNotMatch(sys, /\{\{(include|CATALOG)/)
	const user = first.body.messages[1].content
	assert.match(user, /The table top is y = 0 and runs from x -0\.55 to 3\.15/)
	assert.doesNotMatch(user, /# The current scene/)
	const repair = second.body.messages.at(-1).content
	assert.match(repair, /type "tenis-ball" is not in the catalog \(did you mean "tennis-ball"\?\)/)
	assert.match(repair, /props\.width is 9 m, above its maximum 1\.5/)
})

test("refine: the solved scene, the run, the types in use and the renders are all in the request", async () => {
	gw.script("m1", [{ content: JSON.stringify({ done: false, score_0_10: 6, issues: [{ severity: "high", text: "misses", ids: ["pot"] }], patches: [{ op: "move", id: "pot", dx: -0.1 }] }) }])
	const solved = { ...scenario("empty"), items: [...scenario("empty").items, { id: "ramp", type: "plank", x: 0.4, y: 0.575, angle: -17.4, props: { length: 0.84 } }, { id: "ball", type: "tennis-ball", x: 0.07, y: 0.72, held: true }, { id: "pot", type: "bucket", x: 1.25, y: 0 }] }
	const sim = { summary: { goals: [{ label: "Ball in the pot", ok: false, item: "ball", container: "pot" }], stories: [], events: [{ t: 1.1, text: "Ball hits Table top", speed: 3 }] }, warnings: [] }
	const out = await runStep("refine", { text: "ball into pot", plan: PLAN, scene: solved, sim, renders: [{ data: PNG, label: "wide" }], images: [PNG], round: 3, rounds: 3 }, opts())
	assert.equal(out.result.patches[0].dx, -0.1)
	const user = gw.requests[0].body.messages[1].content
	assert.match(user[0].text, /Round 3 of at most 3 \(the last/)
	assert.match(user[0].text, /FAILED: Ball in the pot/)
	assert.match(user[0].text, /### bucket — Bucket/)
	assert.match(user[0].text, /picture 1 \(wide\): a render of the solved scene/)
	assert.equal(user.filter((p) => p.type === "image_url").length, 2)
	assert.match(gw.requests[0].body.messages[0].content, /- bucket \(Bucket; static/)
})

test("edit: patches against a hand-made scene; a bad id is repaired", async () => {
	gw.script("m1", [
		{ content: JSON.stringify({ kind: "change", targets: [{ says: "the box", ids: ["box"] }], mode: "patch", reply: "Moved it.", patches: [{ op: "move", id: "boxx", dx: 0.1 }] }) },
		{ content: JSON.stringify({ kind: "change", targets: [{ says: "the box", ids: ["box"] }], mode: "patch", reply: "Moved the box 10 cm right.", patches: [{ op: "move", id: "box", dx: 0.1 }] }) }
	])
	const out = await runStep("edit", { text: "move the box a bit right", scene: scenario("rube-goldberg"), history: [{ role: "user", text: "build it" }, { role: "assistant", text: "done" }] }, opts())
	assert.equal(out.result.patches[0].id, "box")
	const user = gw.requests[0].body.messages[1].content
	assert.match(user, /made by hand and has no plan/)
	assert.match(user, /User: build it\nYou: done/)
	assert.match(gw.requests[1].body.messages.at(-1).content, /"boxx" is not an item of the scene \(did you mean "box"\?\)/)
})

test("every prompt file loads with its includes expanded", () => {
	for (const f of ["observe.md", "plan.md", "refine.md", "edit.md"]) {
		const t = loadPrompt(f)
		assert.doesNotMatch(t, /\{\{include:/, f)
		assert.ok(t.length > 1000, f)
	}
})

// ---------------------------------------------------------------- goals of every kind, the reference checklist, faithfulness (2026-10-15 repair)
import { planFromScene } from "../schemas.mjs"
const RG = () => {
	const sc = scenario("rube-goldberg")
	const plan = planFromScene(sc)
	plan.goals = [
		{ kind: "in", label: "Ball 2 lands in the box", item: "ball2", container: "box" },
		{ kind: "falls", label: "All seven dominoes fall", item: "dominoes" },
		{ kind: "hits", label: "The superball hits the dominoes", item: "ball1", target: "dominoes" },
		{ kind: "moves", label: "The seesaw's ball flies 3 m", item: "ball2", min_m: 3 }
	]
	return { sc, plan }
}

test("refine: goals of every kind are checked on a run made here and shown MET / FAILED with numbers; the solver's 'left out' note about them is dropped", async () => {
	const { sc, plan } = RG()
	gw.script("m1", [{ content: JSON.stringify({ done: false, score_0_10: 7, issues: [{ severity: "medium", text: "the ball flies short" }], patches: [] }) }])
	const sim = { summary: { goals: [{ label: "Ball 2 lands in the box", ok: true, item: "ball2", container: "box" }], stories: [], events: [] }, warnings: [{ text: "placing: The goal “All seven dominoes fall” names something that isn't in the scene: left out" }, { text: "placing: something else" }] }
	const out = await runStep("refine", { text: "a chain reaction that knocks the dominoes over", plan, scene: sc, sim }, opts())
	const user = gw.requests[0].body.messages[1].content
	assert.match(user, /MET: Ball 2 lands in the box/)
	assert.match(user, /MET: All seven dominoes fall \[falls\] \(7 of 7 fell/)
	assert.match(user, /MET: The superball hits the dominoes \[hits\] \(first touch at [\d.]+ s/)
	assert.match(user, /FAILED: The seesaw's ball flies 3 m \[moves\] \(ends [\d.]+ cm from where it started \(needs 3 m\)\)/)
	assert.doesNotMatch(user, /All seven dominoes fall” names something/)
	assert.match(user, /placing: something else/)
	assert.match(user, /pair friction = measured × √\(fa\/fa₀ × fb\/fb₀\)/)
	assert.deepEqual(out.goals.map((g) => g.ok), [true, true, true, false])
})

test("refine: done with a stated goal failing gets the one repair; the score is capped at 7 when it stays", async () => {
	const { sc, plan } = RG()
	gw.script("m1", [
		{ content: JSON.stringify({ done: true, score_0_10: 9, issues: [], patches: [] }) },
		{ content: JSON.stringify({ done: true, score_0_10: 9, issues: [], patches: [] }) }
	])
	const out = await runStep("refine", { text: "make the ball fly 3 m", plan, scene: sc, sim: { summary: { goals: [], stories: [], events: [] }, warnings: [] } }, { ...opts(), routing: testRouting({ budgetMs: 200000 }) })
	assert.match(gw.requests[1].body.messages.at(-1).content, /done is true, but the run fails "The seesaw's ball flies 3 m"/)
	assert.equal(out.result.score_0_10, 7)
	assert.ok(out.warnings.some((w) => /not fixed: done is true/.test(w)))
})

test("refine: with reference pictures the critic gets the checklist: counts and sizes seen against what was built", async () => {
	const { sc, plan } = RG()
	plan.covers = [
		{ label: "dominoes", count: 9, ids: ["dominoes"] },
		{ label: "red ball", count: 1, size_m: { w: 0.03, h: 0.03 }, ids: ["ball1"] },
		{ label: "hand", count: 1, ids: [], note: "no people in the library" }
	]
	gw.script("m1", [{ content: JSON.stringify({ done: false, score_0_10: 6, issues: [], patches: [] }) }])
	await runStep("refine", { text: "Rebuild this scene exactly as it is in the picture.", plan, scene: sc, images: [PNG] }, opts())
	const text = gw.requests[0].body.messages[1].content[0].text
	assert.match(text, /# The reference checklist/)
	assert.match(text, /"dominoes" ×9 → dominoes \(domino-row of 7\): built [\d.]+ cm × [\d.]+ cm[^\n]* — COUNT DIFFERS: 9 seen, 7 built/)
	assert.match(text, /"red ball" ×1, seen ≈3 cm × 3 cm → ball1 \(superball\): built [\d.]+ cm × [\d.]+ cm — SIZE DIFFERS/)
	assert.match(text, /"hand" ×1 → nothing built \(no people in the library\)/)
})

test("refine checklist: parts of one item, a row seen domino by domino and a hung bob raise no false alarms; real differences still do", async () => {
	const { sc, plan } = RG()
	plan.items.push({ id: "wb", type: "wrecking-ball", name: "Wrecking ball", place: { on: "table", x: 1.4 }, why: "x" })
	const sc2 = { ...sc, items: [...sc.items, { id: "wb", type: "wrecking-ball", x: 1.4, y: 0, angle: 0, props: {} }] }
	plan.covers = [
		// a ramp and its pair of legs: one plank
		{ label: "ramp", count: 1, size_m: { w: 1.3, h: 0.03 }, ids: ["ramp2"] },
		{ label: "ramp legs", count: 2, size_m: { w: 0.015, h: 0.2 }, ids: ["ramp2"] },
		// seven dominoes seen one by one, built as one row of seven: the 1st matches, the 7th is twice the size seen
		...[2, 3, 4, 5, 6].map((n) => ({ label: `domino ${n}`, count: 1, ids: ["dominoes"] })),
		{ label: "domino 1", count: 1, size_m: { w: 0.016, h: 0.098 }, ids: ["dominoes"] },
		{ label: "domino 7", count: 1, size_m: { w: 0.024, h: 0.14 }, ids: ["dominoes"] },
		// a wrecking ball sized without its stand (its outline also spans the stand and the swing)
		{ label: "wrecking ball", count: 1, size_m: { w: 0.09, h: 0.09 }, ids: ["wb"] }
	]
	gw.script("m1", [{ content: JSON.stringify({ done: false, score_0_10: 6, issues: [], patches: [] }) }])
	await runStep("refine", { text: "Rebuild this scene exactly as it is in the picture.", plan, scene: sc2, images: [PNG] }, opts())
	const text = gw.requests[0].body.messages[1].content[0].text
	const line = (label) => text.split("\n").find((l) => l.startsWith(`- "${label}"`)) ?? ""
	assert.doesNotMatch(line("ramp"), /DIFFERS/)
	assert.match(line("ramp legs"), /a part of ramp2: its size is not compared/)
	assert.doesNotMatch(text, /COUNT DIFFERS/)
	assert.match(line("domino 7"), /closest: its domino7, [\d.]+ cm × 28.3 cm\) — SIZE DIFFERS: \+\d+ %/)
	assert.match(line("domino 1"), /closest: its domino1, [\d.]+ cm × 9.8 cm\)$/)
	assert.match(line("wrecking ball"), /closest: its bob \(without its stand\), 9 cm × 9 cm\)$/)
})

test("refine checklist: a sketch is not to scale, so counts are compared but sizes are not", async () => {
	const { sc, plan } = RG()
	plan.covers = [
		{ label: "dominoes", count: 9, ids: ["dominoes"] },
		{ label: "red ball", count: 1, size_m: { w: 0.03, h: 0.03 }, ids: ["ball1"] }
	]
	gw.script("m1", [{ content: JSON.stringify({ done: false, score_0_10: 6, issues: [], patches: [] }) }])
	await runStep("refine", { text: "Build what this sketch shows, and make it work.", plan, scene: sc, images: [PNG] }, opts())
	const text = gw.requests[0].body.messages[1].content[0].text
	assert.match(text, /the reference is a sketch, not drawn to scale/)
	assert.match(text, /COUNT DIFFERS: 9 seen, 7 built/)
	assert.doesNotMatch(text, /SIZE DIFFERS/)
})

test("refine: changing the material of a thing the request names gets the repair (friction instead)", async () => {
	const { sc, plan } = RG()
	gw.script("m1", [
		{ content: JSON.stringify({ done: false, score_0_10: 6, issues: [], patches: [{ op: "set_props", id: "box", props: { material: "steel" } }] }) },
		{ content: JSON.stringify({ done: false, score_0_10: 6, issues: [], patches: [{ op: "set_props", id: "box", props: { friction: 0.8 } }] }) }
	])
	const out = await runStep("refine", { text: "the ball must land in the box", plan, scene: sc, sim: { summary: { goals: [{ label: "Ball 2 lands in the box", ok: true, item: "ball2", container: "box" }], stories: [], events: [] } } }, { ...opts(), routing: testRouting({ budgetMs: 200000 }) })
	assert.match(gw.requests[1].body.messages.at(-1).content, /is a thing the request asks for: keep its material/)
	assert.deepEqual(out.result.patches[0].props, { friction: 0.8 })
})

test("plan with an observation: an object left unaccounted for gets the repair; the kept covers carry the counts and sizes seen", async () => {
	const obs = structuredClone(OBS)
	obs.objects.push({ label: "flower pot", count: 1, bbox: [0.5, 0.5, 0.7, 0.8], est_size_m: { w: 0.25, h: 0.27 }, material: "metal", color: "grey", state: "resting", supports: "table" })
	const fixed = { ...structuredClone(PLAN), covers: [{ label: "ball", ids: ["ball"] }, { label: "flower pot", ids: ["pot"] }] }
	gw.script("m1", [{ content: JSON.stringify(PLAN) }, { content: JSON.stringify(fixed) }])
	const out = await runStep("plan", { text: "A tennis ball rolls down a ramp into a pot", observation: obs }, { ...opts(), routing: testRouting({ budgetMs: 200000 }) })
	assert.match(gw.requests[0].body.messages[1].content, /# Account for every observed object/)
	assert.match(gw.requests[1].body.messages.at(-1).content, /not accounted for: "ball", "flower pot"/)
	assert.deepEqual(out.result.covers.find((c) => c.label === "flower pot"), { label: "flower pot", ids: ["pot"], count: 1, size_m: { w: 0.25, h: 0.27 } })
})

test("plan: 'make it work' pictures whose story ends in a container need that goal (one repair)", async () => {
	const obs = structuredClone(OBS)
	obs.objects.push({ label: "pot", count: 1, bbox: [0.5, 0.5, 0.7, 0.8], est_size_m: null, material: "", color: "", state: "resting", supports: "table" })
	obs.motion_story = ["the ball rolls down the ramp", "it drops into the pot"]
	const noGoal = { ...structuredClone(PLAN), goals: [], tune: [], covers: [{ label: "ball", ids: ["ball"] }, { label: "pot", ids: ["pot"] }] }
	const withGoal = { ...noGoal, goals: PLAN.goals, tune: PLAN.tune }
	gw.script("m1", [{ content: JSON.stringify(noGoal) }, { content: JSON.stringify(withGoal) }])
	const out = await runStep("plan", { text: "Build this setup from the photo, and make it work the way it is meant to.", observation: obs, images: [PNG] }, { ...opts(), routing: testRouting({ budgetMs: 200000 }) })
	assert.match(gw.requests[1].body.messages.at(-1).content, /the request says to make it work, and the pictures end with/)
	assert.equal(out.result.goals[0].kind, "in")
})

// ---------------------------------------------------------------- round 2 (2026-10-15): stage checks, the rate-only final check, sketches observed at lower effort
test("refine: each stage's check is run with the goals and shown in order, the first failing stage named; the answer carries them as stages", async () => {
	const { sc, plan } = RG()
	plan.goals = [plan.goals[0]]
	plan.stages = [
		{ label: "Superball hits the dominoes", check: { kind: "hits", item: "ball1", target: "dominoes", label: "Stage 1: Superball hits the dominoes" } },
		{ label: "Ball 2 flies far", check: { kind: "moves", item: "ball2", min_m: 3, label: "Stage 2: Ball 2 flies far" } },
		{ label: "No check" }
	]
	gw.script("m1", [{ content: JSON.stringify({ done: false, score_0_10: 6, issues: [], patches: [] }) }])
	const out = await runStep("refine", { text: "a chain", plan, scene: sc, sim: { summary: { goals: [], stories: [], events: [] }, warnings: [] } }, opts())
	const user = gw.requests[0].body.messages[1].content
	assert.match(user, /Stage checks \(the plan's stages, in order\): 1 MET: Stage 1: Superball hits the dominoes \[hits\]/)
	assert.match(user, /2 FAILED: Stage 2: Ball 2 flies far \[moves\]/)
	assert.match(user, /The first stage that fails is stage 2/)
	assert.deepEqual(out.stages.map((s) => [s.stage, s.ok]), [[1, true], [2, false]])
	assert.equal(out.goals.length, 1)
})

test("refine rate_only: the same look at the scene, answered {score_0_10, issues} at low effort on the refine route when the routing has no 'rate'", async () => {
	const { sc, plan } = RG()
	gw.script("m1", [{ content: JSON.stringify({ score_0_10: 9, issues: [{ severity: "low", text: "fine" }], done: true, patches: [{ op: "remove", id: "ball2" }] }) }])
	const out = await runStep("refine", { text: "a chain", plan, scene: sc, rate_only: true }, opts())
	assert.equal(out.result.rate_only, true)
	assert.equal(out.result.patches, undefined)
	assert.equal(out.result.score_0_10, 7) // a goal of RG() fails in the run (the 3 m flight): capped
	const req = gw.requests[0].body
	assert.equal(req.reasoning_effort, "low")
	assert.match(req.messages[1].content, /The final check/)
	assert.match(req.messages[1].content, /Rate it only/)
	gw.script("m1", [{ content: JSON.stringify({ done: true, score_0_10: 7, issues: [], patches: [] }) }])
	await runStep("refine", { text: "a chain", plan, scene: sc }, opts())
	assert.equal(req.messages[0].content, gw.requests.at(-1).body.messages[0].content, "the same system prompt as a critique (the prompt cache)")
	await assert.rejects(runStep("refine", { text: "x", plan, scene: sc, rate_only: "yes" }, opts()), badInput(/rate_only must be true or false/))
	// a routing with a "rate" step uses it
	const routing = testRouting()
	routing.steps.rate = { ...routing.steps.refine, model: "m2", params: { max_tokens: 50, reasoning_effort: "minimal" } }
	gw.script("m2", [{ content: JSON.stringify({ score_0_10: 6, issues: [] }) }])
	const out2 = await runStep("refine", { text: "a chain", plan, scene: sc, rate_only: true }, { ...opts(), routing })
	assert.equal(out2.model, "m2")
	assert.equal(gw.forModel("m2")[0].body.reasoning_effort, "minimal")
})

test("observe: a request that calls the picture a sketch is observed with observe.simpleParams (lower effort); a photo is not", async () => {
	const routing = testRouting()
	routing.steps.observe = { ...routing.steps.observe, params: { max_tokens: 100, reasoning_effort: "medium" }, simpleParams: { reasoning_effort: "low" } }
	const obs = JSON.stringify(OBS)
	gw.script("m1", [{ content: obs }, { content: obs }])
	await runStep("observe", { text: "Build what this sketch shows", images: [PNG] }, { ...opts(), routing })
	await runStep("observe", { text: "Build this setup from the photo", images: [PNG] }, { ...opts(), routing })
	assert.deepEqual(gw.requests.map((r) => r.body.reasoning_effort), ["low", "medium"])
})

// ---------------------------------------------------------------- §13.8 (2026-10-15): a change to the scene on screen is an edit, never a new scene
const isEdit = (req) => /^You edit scenes/.test(String(req.body?.messages?.[0]?.content ?? ""))
const STARTER = () => scenario("rube-goldberg")
test("plan with a scene on screen: a request that changes it comes back as an edit (patches applied to the scene's plan, untouched items exact); the fresh plan is dropped", async () => {
	const swap = { kind: "change", targets: [{ says: "the yellow ball", ids: ["ball2"] }, { says: "the red ball", ids: ["ball1"] }], mode: "patch", why: "They name two balls in this scene.", reply: "Swapped both balls.", suggestions: [{ label: "Lower the box", prompt: "Lower the box so the tennis ball lands in it" }], patches: [{ op: "replace_type", id: "ball2", type: "tennis-ball" }, { op: "replace_type", id: "ball1", type: "basketball" }, { op: "set_place", id: "ball1", place: { on: "ramp1", x: 0 } }] }
	let planSeen = 0
	gw.fallback = (req) => (isEdit(req) ? { content: JSON.stringify(swap), delayMs: 50 } : (planSeen++, { content: JSON.stringify(PLAN), delayMs: 400 }))
	try {
		const out = await runStep("plan", { text: "Change the yellow ball to a tennis ball and the red ball to a basketball.", scene: STARTER() }, opts())
		assert.equal(out.intent, "edit")
		assert.equal(out.edit.reply, "Swapped both balls.")
		assert.equal(out.result.reply, "Swapped both balls.", "the client reads a plan's reply and chips from the result")
		assert.deepEqual(out.result.suggestions, [{ label: "Lower the box", prompt: "Lower the box so the tennis ball lands in it" }])
		assert.equal(out.why, "They name two balls in this scene.")
		const items = new Map(out.result.items.map((i) => [i.id, i]))
		assert.equal(items.get("ball2").type, "tennis-ball")
		assert.equal(items.get("ball1").type, "basketball")
		assert.deepEqual(items.get("ball1").place, { on: "ramp1", x: 0 })
		const sc = STARTER()
		for (const id of ["ramp1", "ramp2", "dominoes", "seesaw", "box"]) {
			const a = sc.items.find((i) => i.id === id)
			assert.deepEqual([items.get(id).type, items.get(id).place.x, items.get(id).place.y_m, items.get(id).place.angle_deg], [a.type, a.x, a.y, a.angle ?? 0], id)
		}
		assert.equal(planSeen, 1, "the fresh plan started at the same time (no extra wait when it is needed)")
		assert.deepEqual(out.result.goals.map((g) => g.item), ["ball2"], "the scene's goal is kept")
	} finally {
		gw.fallback = () => ({ status: 500, body: { error: { message: "no scripted answer" } } })
	}
})

test("plan with a scene on screen: a different scene gets the fresh plan (intent new); intent 'new' or a picture's observation skips the check; a failed check never falls back to a new scene", async () => {
	gw.fallback = (req) => (isEdit(req) ? { content: JSON.stringify({ kind: "new", targets: [], mode: "new", why: "A different setup.", reply: "Building a new scene." }) } : { content: JSON.stringify(PLAN) })
	try {
		let out = await runStep("plan", { text: "A ball rolls down a ramp into a pot.", scene: STARTER() }, opts())
		assert.equal(out.intent, "new")
		assert.equal(out.result.title, "Ball into the pot")
		gw.reset()
		out = await runStep("plan", { text: "A ball rolls down a ramp into a pot.", scene: STARTER(), intent: "new" }, opts())
		assert.equal(gw.requests.filter(isEdit).length, 0)
		assert.equal(out.result.title, "Ball into the pot")
		gw.reset()
		await runStep("plan", { text: "", observation: OBS, scene: STARTER() }, opts())
		assert.equal(gw.requests.filter(isEdit).length, 0, "a picture build plans at once")
		await assert.rejects(runStep("plan", { text: "x", scene: STARTER(), intent: "maybe" }, opts()), badInput(/intent must be/))
		gw.fallback = (req) => (isEdit(req) ? { status: 400, message: "bad request" } : { content: JSON.stringify(PLAN) })
		await assert.rejects(runStep("plan", { text: "Make the box bigger.", scene: STARTER() }, opts()), (e) => e.code === "gateway")
	} finally {
		gw.fallback = () => ({ status: 500, body: { error: { message: "no scripted answer" } } })
	}
})

test("edit: mode 'new' goes on to the plan step (its own prompt and effort) and comes back as mode 'plan' with intent 'new'", async () => {
	gw.fallback = (req) => (isEdit(req) ? { content: JSON.stringify({ kind: "new", targets: [], mode: "new", why: "Start over.", reply: "Starting over." }) } : { content: JSON.stringify(PLAN) })
	try {
		const out = await runStep("edit", { text: "Start over: a ball rolls into a pot.", scene: STARTER() }, opts())
		assert.equal(out.intent, "new")
		assert.deepEqual([out.result.mode, out.result.reply, out.result.plan.title], ["plan", "Starting over.", "Ball into the pot"])
		assert.ok(/You are the scene planner/.test(gw.requests.at(-1).body.messages[0].content[0]?.text ?? gw.requests.at(-1).body.messages[0].content))
	} finally {
		gw.fallback = () => ({ status: 500, body: { error: { message: "no scripted answer" } } })
	}
})

test("edit intent \"edit\": the request says the user pressed Edit; a \"new\" answer gets one repair turn toward a patch, and when it stays it comes back as it is (no planner call); a bad intent is a 400", async () => {
	const NEW = { content: JSON.stringify({ kind: "new", targets: [], mode: "new", reply: "That is a different scene: build it as a new one?", why: "They describe a new setup." }) }
	gw.script("m1", [NEW, { content: JSON.stringify({ kind: "change", targets: [{ says: "the ball", ids: ["ball1"] }], mode: "patch", why: "They pressed Edit.", reply: "Swapped the ball.", patches: [{ op: "replace_type", id: "ball1", type: "tennis-ball" }] }) }])
	let out = await runStep("edit", { text: "new scene: the same machine with a tennis ball", scene: scenario("rube-goldberg"), intent: "edit" }, opts())
	assert.equal(out.result.mode, "patch")
	assert.match(gw.requests[0].body.messages[1].content, /The user pressed "Edit"/)
	assert.match(gw.requests[1].body.messages.at(-1).content, /the user pressed Edit: change the scene on screen with mode "patch"/)
	gw.reset()
	gw.script("m1", [NEW, NEW])
	out = await runStep("edit", { text: "a car race on a long track", scene: scenario("rube-goldberg"), intent: "edit" }, opts())
	assert.equal(out.result.mode, "new")
	assert.equal(gw.requests.length, 2, "the one repair, and no planner call")
	assert.ok(out.warnings.some((w) => /not fixed: mode is "new"/.test(w)))
	gw.reset()
	gw.script("m1", [NEW])
	out = await runStep("edit", { text: "a car race", scene: scenario("rube-goldberg") }, { ...opts(), noEscalate: true })
	assert.doesNotMatch(gw.requests[0].body.messages[1].content, /The user pressed "Edit"/)
	await assert.rejects(runStep("edit", { text: "x", scene: scenario("rube-goldberg"), intent: "new" }, opts()), badInput(/intent must be "auto" or "edit"/))
	// a real start-over under Edit: kind "new" at once (no repair turn toward a patch, no planner call: the client offers to build it new)
	gw.reset()
	gw.script("m1", [NEW])
	out = await runStep("edit", { text: "start over: just a tennis ball rolling down a ramp into a cup", scene: scenario("rube-goldberg"), intent: "edit" }, opts())
	assert.deepEqual([out.result.mode, out.result.kind, gw.requests.length], ["new", "new", 1])
	assert.match(gw.requests[0].body.messages[1].content, /Only a request to throw this scene away and build a different one \("start over: …"/)
})

test("edit (repair 2026-10-15 night): the plan JSON in the request leaves out the build's missing list; the answer's missing is this request's, the scene keeps its list as plan_missing", async () => {
	const { planFromScene } = await import("../schemas.mjs")
	const { getCatalog } = await import("../catalog-digest.mjs")
	const cat = await getCatalog()
	const pl = planFromScene(STARTER(), cat.index)
	pl.missing = [{ asked: "a crumpled paper cup", reason: "things do not crumple", substitute_type: "box", substitute_id: "box" }]
	gw.script("m1", [{ content: JSON.stringify({ kind: "change", targets: [{ says: "the box", ids: ["box"] }], mode: "patch", why: "A move.", reply: "I moved the box 10 cm left.", patches: [{ op: "move", id: "box", dx: -0.1 }], missing: [] }) }])
	const out = await runStep("edit", { text: "move the box 10 cm left", scene: STARTER(), plan: pl, intent: "edit" }, opts())
	const user = gw.requests[0].body.messages[1].content
	assert.match(user, /# Its plan \(patches change this plan/)
	assert.doesNotMatch(user, /crumpled/)
	assert.deepEqual(out.result.missing, [])
	assert.deepEqual(out.result.plan_missing.map((m) => m.asked), ["a crumpled paper cup"])
})

test("edit (§14): the request carries the rich digest from a run made here (looks, places in words, each item's part in the run, look-alikes, the goals MET / FAILED), the client's feedback just before the request; kind and targets come back; a bad sim or feedback is a 400", async () => {
	gw.script("m1", [{ content: JSON.stringify({ kind: "fix", targets: [], mode: "patch", reply: "I lowered the box 30 cm so Ball 2 lands in it.", patches: [{ op: "move", id: "box", dy: -0.3 }] }) }])
	const fb = "# Your last answer was applied and run\nIn its run: FAILED: Ball 2 lands in the box."
	const out = await runStep("edit", { text: "Make it work again.", scene: STARTER(), feedback: fb }, opts())
	assert.deepEqual([out.result.kind, out.result.targets, out.intent], ["fix", [], "edit"])
	const user = gw.requests[0].body.messages[1].content
	assert.match(user, /^# The current scene\n/)
	assert.match(user, /- ball2 · “Ball 2” · a yellow ball: plastic-ball .* · 6 cm across, 6\.32 g\n  where: right third of the table, resting on seesaw/)
	assert.match(user, /- ball1 · “Ball 1” · a red ball: superball[^\n]*\n  where: left third of the table, in the air; 3\.1 cm above ramp1; dynamic, held/)
	assert.match(user, /in the last run: starts moving at 2\.8\d s; is hit by seesaw/)
	assert.match(user, /## Look-alikes [^\n]*\n- 2 ramps: [^\n]*\n- 2 balls: ball2 \(yellow, [^\n]*ball1 \(red,/)
	assert.match(user, /## The last run \(before this request\)\nGoals: MET: Ball 2 lands in the box\nWhat happened, in order: 0\.61 s Ball 1 hits Ramp 1/)
	assert.ok(user.indexOf(fb) > user.indexOf("# Its plan") && user.indexOf(fb) < user.indexOf("# The user's request now"), "the feedback goes just before the request")
	assert.match(String(gw.requests[0].body.messages[0].content[0]?.text ?? gw.requests[0].body.messages[0].content), /"kind": "ask"/)
	await assert.rejects(runStep("edit", { text: "x", scene: STARTER(), sim: 3 }, opts()), badInput(/sim must be an object/))
	await assert.rejects(runStep("edit", { text: "x", scene: STARTER(), feedback: 5 }, opts()), badInput(/feedback must be text/))
	await assert.rejects(runStep("edit", { text: "x", scene: STARTER(), feedback: "x".repeat(9000) }, opts()), badInput(/feedback is too long/))
})

test("edit: a hung thing's \"where\" gap is the real one when its outline box shows less (the box over the sloped seesaw plank: 6.8 cm, not 3.7)", async () => {
	const { roomUnder } = await import("../room.mjs")
	const { sceneDigest } = await import("../scene-digest.mjs")
	const { getCatalog } = await import("../catalog-digest.mjs")
	const cat = await getCatalog()
	const sc = STARTER()
	const r = await roomUnder(sc, await sceneDigest(sc, cat.index))
	assert.deepEqual(r.items.map((x) => [x.id, x.best, x.below, Math.round(x.boxGap * 1000), Math.round(x.room * 1000)]), [["box", "seesaw", "seesaw", 37, 68]], "only the box: ball1 is held (it rides with ramp 1 by the boxes' gap)")
	gw.script("m1", [{ content: JSON.stringify({ kind: "change", targets: [{ says: "the box", ids: ["box"], because: "the only box" }], mode: "patch", reply: "Lowered it 5 cm.", patches: [{ op: "move", id: "box", dy: -0.05 }] }) }])
	await runStep("edit", { text: "lower the box by 5 cm", scene: sc }, opts())
	const user = gw.requests[0].body.messages[1].content
	assert.match(user, /- box · [^\n]*\n  where: right third of the table, in the air; 6\.8 cm above seesaw; static \(never moves\)\n/)
	assert.equal(user.includes("3.7 cm above seesaw"), false)
	assert.match(user, /where: left third of the table, in the air; 3\.1 cm above ramp1; dynamic, held/, "a held thing keeps the boxes' gap")
	assert.equal(user.includes("## Free room"), false)
	// a scene where nothing hangs over a sloped or round thing is as before
	gw.script("m1", [{ content: JSON.stringify({ kind: "answer", targets: [], mode: "patch", reply: "ok", patches: [] }) }])
	await runStep("edit", { text: "what is this?", scene: scenario("trampoline") }, opts())
	assert.match(gw.requests[1].body.messages[1].content, /^# The current scene\n/)
})

test("edit (§14): a scene is run once: the same scene again (a repair turn, Undo) gets the same digest from the cache, said in prompt.digest", async () => {
	const { mkdtempSync, readdirSync, rmSync } = await import("node:fs")
	const { tmpdir } = await import("node:os")
	const { join } = await import("node:path")
	const dir = mkdtempSync(join(tmpdir(), "ai-edit-runs-"))
	const before = process.env.AI_CACHE_DIR
	process.env.AI_CACHE_DIR = dir
	try {
		const NOTHING = { content: JSON.stringify({ kind: "answer", targets: [], mode: "patch", reply: "Nothing to change.", patches: [] }) }
		gw.script("m1", [NOTHING, NOTHING])
		const sc = STARTER()
		sc.items.find((i) => i.id === "box").x += 0.0001 * Math.random() // (a scene this process has not run yet)
		const a = await runStep("edit", { text: "what does the box do?", scene: sc }, opts())
		const b = await runStep("edit", { text: "what does the box do?", scene: structuredClone(sc) }, opts())
		assert.equal(a.prompt.digest.cached, false)
		assert.ok(a.prompt.digest.runMs > 0 && a.prompt.digest.ms >= a.prompt.digest.runMs)
		assert.equal(b.prompt.digest.cached, true)
		assert.equal(gw.requests[1].body.messages[1].content, gw.requests[0].body.messages[1].content, "the same digest, word for word")
		assert.equal(readdirSync(join(dir, "edit-runs")).filter((n) => n.endsWith(".json")).length, 1, "kept on disk too (the local server runs each step in its own process)")
	} finally {
		if (before === undefined) delete process.env.AI_CACHE_DIR
		else process.env.AI_CACHE_DIR = before
		rmSync(dir, { recursive: true, force: true })
	}
})

test("edit (§14): the plan's goals of other kinds are checked on the same run (MET / FAILED); a kind that changes nothing with patches gets the repair turn; ask comes back with no patches", async () => {
	const { planFromScene } = await import("../schemas.mjs")
	const { getCatalog } = await import("../catalog-digest.mjs")
	const cat = await getCatalog()
	const pl = planFromScene(STARTER(), cat.index)
	pl.goals = [...(pl.goals ?? []), { kind: "falls", label: "The dominoes fall", item: "dominoes" }, { kind: "moves", label: "The box flies off", item: "ball1", min_m: 50 }]
	const BAD = { content: JSON.stringify({ kind: "ask", targets: [{ says: "the ball", ids: ["ball1", "ball2"] }], mode: "patch", reply: "Which ball?", patches: [{ op: "move", id: "ball1", dx: 0.1 }] }) }
	const ASK = { content: JSON.stringify({ kind: "ask", targets: [{ says: "the ball", ids: ["ball1", "ball2"], because: "two balls" }], mode: "patch", why: "Two balls fit.", reply: "Which ball: the red one at the top, or the yellow one on the seesaw?", patches: [], suggestions: [{ label: "The red ball", prompt: "Make the red ball at the top bigger" }] }) }
	gw.script("m1", [BAD, ASK])
	const out = await runStep("edit", { text: "make the ball bigger", scene: STARTER(), plan: pl }, opts())
	assert.deepEqual([out.result.kind, out.result.patches, out.result.targets[0].ids], ["ask", [], ["ball1", "ball2"]])
	assert.match(gw.requests[1].body.messages.at(-1).content, /kind "ask" changes nothing: "patches": \[\]/)
	const user = gw.requests[0].body.messages[1].content
	assert.match(user, /Goals: MET: Ball 2 lands in the box; MET: The dominoes fall; FAILED: The box flies off \(/)
})
