// The direct step (ai/director.mjs, ai/shot-plan.mjs, web/export/digest.js): the timeline digest, the shot-plan language's checks, the automatic
// plan, and the step end to end through the mock gateway: the director's plan, the executor's measured checks (web/export/shots.js itself, and
// scripted reports where a test needs a given sequence of verdicts), up to 3 repair turns, then the director's best try or an automatic plan.
// No live calls: the model's answers are recorded ones (fixtures/direct/recorded: the plans Opus 5.5 wrote for six design examples, replayed
// with the verdicts they were measured with) or the design's own plans (web/export/test/plans, with its scenes).
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { after, before, beforeEach, test } from "node:test"
import { AIError } from "../core.mjs"
import { REPAIR_TURNS, SOFT_CHECKS, directSource, executorFrom, failedChecks, loadExecutor, pictureOf, repairTurn, safePlan, worldInput } from "../director.mjs"
import { VALIDATORS } from "../schemas.mjs"
import { checkShotPlanSchema, nearest, validateShotPlan } from "../shot-plan.mjs"
import { runScene, runStep, STEPS } from "../steps.mjs"
import { buildDigest, digestText, momentTime } from "../../web/export/digest.js"
import * as Shots from "../../web/export/shots.js"
import { mockEnv, startMockGateway, testRouting } from "./mock-gateway.mjs"

const PG = new URL("../../", import.meta.url)
const read = (p) => readFileSync(new URL(p, PG), "utf8")
const json = (p) => JSON.parse(read(p))
const FX = "ai/test/fixtures/direct/"
const PLANS = json("web/export/test/plans/index.json").plans
const plan = (name) => {
	const p = json(`web/export/test/plans/${name}.json`)
	delete p.$schema
	return p
}

// the design examples' runs, made once (the same run as /api/simulate)
const RUNS = new Map()
async function runsOf(name) {
	if (!RUNS.has(name)) {
		const list = []
		for (const [lane, f] of Object.entries(PLANS[name])) {
			const scene = json(f)
			list.push({ lane, scene, run: await runScene(scene) })
		}
		RUNS.set(name, list)
	}
	return RUNS.get(name)
}
const digestOf = async (name) => buildDigest({ runs: await runsOf(name) })
const routing = () => {
	const r = testRouting()
	return { ...r, steps: { ...r.steps, direct: { ...r.steps.plan } } }
}
let gw
before(async () => {
	gw = await startMockGateway()
})
after(async () => {
	await gw.close()
})
beforeEach(() => gw.reset())
const opts = (extra = {}) => ({ env: mockEnv(gw), routing: routing(), backoffScale: 0.01, recognize: null, ...extra })
const badInput = (re) => (e) => e instanceof AIError && e.code === "bad_input" && e.status === 400 && re.test(e.message)
const answer = (p, usd = 0.05) => ({ content: JSON.stringify(p), usage: { prompt_tokens: 1000, completion_tokens: 500, costInUSD: usd } })
const LASER = () => json("demos/optics/demo-mirror.json")
const LESSON = { question: "What happens to the light when it hits the mirror?", answer: "It bounces off at the same angle.", grade: 4 }
/** A scripted executor: each measure answers the next report of the list (the last one again when they run out), and records what it measured
 *  (for a test that needs a given sequence of verdicts; the real one is web/export/shots.js, the step's default). */
function stubExecutor(reports) {
	const seen = []
	return {
		seen,
		name: "stub",
		measure: (p, ctx) => {
			seen.push({ plan: p, ctx })
			const r = reports[Math.min(seen.length - 1, reports.length - 1)]
			return typeof r === "function" ? r(p, ctx) : r
		}
	}
}
const PASS = { ok: true, checks: [{ shot: "x", check: "keep-in", ok: true, why: "fine" }], shots: [] }
const FAIL = (why = "too small: laser s 0.05 (floor 0.09)", shot = "tip") => ({ ok: false, checks: [{ shot, check: "subject-size", ok: false, why }], shots: [{ id: shot, move: "hold", heroes: [{ what: '{"item":"laser"}', s: 0.05 }] }] })
/** a failure that breaks the video (something kept is cut off), not only its size */
const HARD = (why = "every kept thing at least 0.02 inside the edges at every frame (closest -0.1 at 1 s)", shot = "tip") => ({ ok: false, checks: [{ shot, check: "keep-in", ok: false, why }], shots: [{ id: shot, move: "hold", minKeep: -0.1 }] })

// ------------------------------------------------------------------------------------------------ the step's place
test("direct is a step everywhere a step is listed: steps, the routing, both servers' queues and the AI gate's reservation", () => {
	assert.ok(STEPS.includes("direct"))
	assert.equal(typeof VALIDATORS.direct, "function")
	const m = json("ai/models.json")
	const r = m.steps.direct
	assert.equal(r.model, "claude-group/claude-opus-5-5")
	assert.deepEqual(r.fallbacks, ["aws-bedrock/global.anthropic.claude-opus-5-5"])
	assert.equal(r.params.reasoning_effort, "high")
	assert.ok(r.budgetMs >= 3 * 120000, "the budget holds the first plan and its repair turns")
	const py = read("web/server.py")
	assert.match(py, /AI_STEPS = \([^)]*"direct"/)
	assert.match(py, /AI_STEP_SLOTS = \{[^}]*"direct": \d/)
	assert.match(py, /AI_TYPICAL_S = \{[^}]*"direct": [\d.]+/)
	const fn = read("api/ai/[step].mjs")
	assert.match(fn, /STEP_SLOTS = \{[^}]*direct: \d/)
	assert.match(fn, /TYPICAL_S = \{[^}]*direct: \d/)
	assert.match(read("api/_lib/ai-gate.mjs"), /STEP_USD = \{[^}]*direct: [\d.]+/)
	assert.match(read("vercel.json"), /web\/export\/\*\.js,web\/export\/\*\.json/, "the direct step loads web/export/digest.js, subjects.js and shots.js and reads shot-plan.schema.json: the AI function must include them")
})

test("bad payloads are a 400 with a plain reason, before any run or model call", async () => {
	const s = LASER()
	await assert.rejects(runStep("direct", { text: "show it" }, opts()), badInput(/scene is missing/))
	await assert.rejects(runStep("direct", { scene: s }, opts()), badInput(/text is missing/))
	await assert.rejects(runStep("direct", { text: "x", scene: s, runs: { a: s, b: s } }, opts()), badInput(/not both/))
	await assert.rejects(runStep("direct", { text: "x", runs: { a: s } }, opts()), badInput(/2 to 4 lanes/))
	await assert.rejects(runStep("direct", { text: "x", runs: { "a b": s, c: s } }, opts()), badInput(/not a lane id/))
	await assert.rejects(runStep("direct", { lesson: "why", scene: s }, opts()), badInput(/lesson must be an object/))
	await assert.rejects(runStep("direct", { lesson: { question: "q", grade: 9 }, scene: s }, opts()), badInput(/grade/))
	await assert.rejects(runStep("direct", { lesson: { question: "q", pauses: [{ where: "middle" }] }, scene: s }, opts()), badInput(/pauses/))
	await assert.rejects(runStep("direct", { text: "x", scene: s, aspect: "2:1" }, opts()), badInput(/aspect/))
	await assert.rejects(runStep("direct", { text: "x", scene: s, max_seconds: 100 }, opts()), badInput(/max_seconds/))
	await assert.rejects(runStep("direct", { text: "x", scene: s, kind: "film" }, opts()), badInput(/kind/))
	await assert.rejects(runStep("direct", { text: "x", scene: s, hints: [1] }, opts()), badInput(/hints/))
	await assert.rejects(runStep("direct", { text: "x", scene: { items: [{ id: "a/b", type: "superball" }] } }, opts()), badInput(/scene: item 1/))
	assert.equal(gw.requests.length, 0)
	const src = await directSource({ lesson: { question: "Is it fair?", words: [" a "], grade: 3 }, runs: { top: s, bottom: s }, concept: "fair test" }, { clean: async (v) => v })
	assert.equal(src.kind, "lesson")
	assert.deepEqual(src.scenes.map((x) => x.lane), ["top", "bottom"])
	assert.deepEqual(src.lesson.words, ["a"])
	assert.equal(src.aspect, "16:9")
})

// ------------------------------------------------------------------------------------------------ the digest
test("the digest of the laser: the traced beam with its bounce, its measured angles and where it ends, and the moment ids", async () => {
	const d = await digestOf("01-laser-mirror")
	const r = d.runs[""]
	assert.equal(r.beams.length, 1)
	const tr = r.beams[0].traces[0]
	assert.equal(r.beams[0].source, "laser")
	assert.equal(tr.bounces.length, 1)
	assert.equal(tr.bounces[0].item, "mirror")
	assert.equal(Math.round(tr.bounces[0].in), 30)
	assert.equal(Math.round(tr.bounces[0].out), 30)
	assert.equal(tr.ends.at(-1), "target")
	assert.equal(momentTime(d, "release"), 0.5)
	assert.equal(momentTime(d, "beam:laser:on"), 0)
	assert.equal(momentTime(d, { at: "release", plus: 0.25 }), 0.75)
	assert.equal(momentTime(d, "t=0.3"), 0.3)
	assert.equal(momentTime(d, "contact:laser+mirror"), undefined)
	const t = digestText(d)
	assert.match(t, /^SCENE demo-mirror "Angle in equals angle out": 1 s, release 0\.5/)
	assert.match(t, /bounce:1 on mirror at \(0\.797, 0\.25\): normal \(-0\.866, 0\.5\), in 30 deg, out 30 deg/)
	assert.match(t, /hit:target at/)
	assert.match(t, /its core reads in a window up to 2\.05 m wide/)
	// the same runs give the same digest, byte for byte
	const again = buildDigest({ runs: await runsOf("01-laser-mirror") })
	assert.equal(again.hash, d.hash)
	assert.equal(digestText(again), t)
})

test("the digest of the chain: every contact by its id in either order with its touches numbered, each mover's start and rest", async () => {
	const d = await digestOf("06-chain-reaction")
	const r = d.runs[""]
	const c = r.contacts.find((x) => x.id === "contact:ramp1+ball1")
	assert.ok(c && c.n >= 2 && c.speed > 1, "ball 1 meets ramp 1 at about 1 m/s")
	assert.equal(momentTime(d, "contact:ramp1+ball1"), momentTime(d, "contact:ball1+ramp1"))
	assert.ok(momentTime(d, "contact:ramp1+ball1#2") > momentTime(d, "contact:ramp1+ball1"))
	assert.ok(momentTime(d, "start:ball1") > 0.5 && momentTime(d, "start:ball1") < 0.7)
	assert.ok(momentTime(d, "stop:ball2") > momentTime(d, "contact:box+ball2"))
	assert.ok(Math.abs(c.at[0] - 0) < 0.1 && Math.abs(c.at[1] - 0.66) < 0.1, "the contact point is where the two touch, not a body's centre")
	const ball1 = r.cast.find((x) => x.id === "ball1")
	assert.ok(ball1.held && ball1.swept[1] > 1.8 && ball1.top > 2)
	assert.deepEqual(r.scenery.sort(), ["table", "wall-left", "wall-right"])
})

test("a comparison filmed one run per lane: a run section per lane, the lanes' ids, and what differs between the runs", async () => {
	const d = await digestOf("02-fairtest-ramps")
	assert.deepEqual(Object.keys(d.runs), ["top", "bottom"])
	assert.deepEqual(d.lanes, [{ id: "top", run: "ft_1b_car_red_clay" }, { id: "bottom", run: "ft_3b_car_red_clay" }])
	const what = d.differs.map((x) => `${x.item} ${x.what}`)
	assert.ok(what.includes("ramp angle"))
	assert.ok(what.includes("block2 only in some lanes") && what.includes("block3 only in some lanes"))
	assert.ok(!what.includes("block1 x"), "a centimetre's difference is the same place")
	assert.ok(momentTime(d, "stop:toy@bottom") > 0)
	assert.equal(momentTime(d, "stop:toy"), Math.max(momentTime(d, "stop:toy@top"), momentTime(d, "stop:toy@bottom")))
	const t = digestText(d)
	assert.match(t, /=== RUN for lane top: ft_1b_car_red_clay/)
	assert.match(t, /LANES \(each lane is its own run; a plan's lanes\.list must use exactly these ids\): top = ft_1b_car_red_clay \| bottom = ft_3b_car_red_clay/)
	assert.match(t, /ramp angle: top -5\.122 \| bottom -15\.537/)
})

test("a lanes role in a moment id is each lane's own item, the latest of them (as the executor resolves it)", async () => {
	const d = await digestOf("10-egg-drop")
	const lanes = { list: [{ id: "bare", cast: { egg: "bare", under: "table" } }, { id: "padded", cast: { egg: "padded", under: "foam" } }] }
	const tb = momentTime(d, "contact:table+bare"), fp = momentTime(d, "contact:foam+padded")
	assert.ok(tb > 0.5 && fp > 0.5)
	assert.equal(momentTime(d, "contact:under+egg", null, lanes), Math.max(tb, fp))
	assert.equal(momentTime(d, "contact:under+egg@padded", null, lanes), fp)
	assert.equal(momentTime(d, "start:egg@bare", null, lanes), momentTime(d, "start:bare"))
	assert.equal(momentTime(d, "event:breaks:egg", null, lanes), momentTime(d, "event:breaks:bare"))
	assert.equal(momentTime(d, "contact:under+egg"), undefined, "without the plan's lanes a role is no name")
})

test("an executor's moments take the place of the digest's own, so the ids the director reads are the ones it resolves", async () => {
	const runs = await runsOf("07-pendulum")
	const d = buildDigest({ runs: runs.map((r) => ({ ...r, moments: { index: { start: 0, release: 0.2, end: 8, result: 7.9, "pause:setup": 0, "pause:result": 7.9, "start:p": 0.4, "turn:p": 1.2, "turn:p#2": 2.2, "turn:p#3": 3.2, "turn:p#4": 4.2 }, what: { "turn:p": "back" } } })) })
	const r = d.runs[""]
	assert.equal(momentTime(d, "turn:p#4"), 4.2)
	assert.equal(momentTime(d, "turn:p#6"), undefined)
	assert.equal(r.turns.p.n, 4)
	assert.ok(r.turns.p.regular)
	assert.match(digestText(d), /TURNS \(a regular swing[^)]*\): p x4: turn:p 1\.2, #2 2\.2, #3 3\.2, #4 4\.2/)
})

// ------------------------------------------------------------------------------------------------ the shot-plan language
test("the twelve design plans are valid and resolve against their own runs, at the design's lengths", async () => {
	const lengths = { "01-laser-mirror": 17.9, "02-fairtest-ramps": 10.6, "03-salt-ice": 15.6, "04-fan-boats": 13.0, "05-mo37-race": 10.7, "06-chain-reaction": 13.7, "07-pendulum": 17.0, "08-switch-bulb": 18.3, "09-magnet-clip": 16.6, "10-egg-drop": 11.4, "11-siphon": 14.3, "12-earth-orbit": 15.5 }
	for (const name of Object.keys(PLANS)) {
		assert.deepEqual(checkShotPlanSchema(plan(name)), [], name)
		const r = validateShotPlan(plan(name), { digest: await digestOf(name) })
		assert.deepEqual(r.errors, [], name)
		assert.ok(Math.abs(r.timing.seconds - lengths[name]) < 0.4, `${name}: ${r.timing.seconds} s`)
	}
})

test("structure errors are plain sentences with a path: one kind of target, a travel's path, a slow motion's label, a moment's form", () => {
	const p = plan("01-laser-mirror")
	const check = (f) => {
		const q = JSON.parse(JSON.stringify(p))
		f(q)
		return checkShotPlanSchema(q).join("\n")
	}
	assert.match(check((q) => (q.shots[0].subject = { item: "laser", items: ["mirror"] })), /shots\[0\] \(tip\)\.subject names 2 kinds of target at once \(item, items\)/)
	assert.match(check((q) => delete q.shots[1].travel), /shots\[1\] \(to-mirror\)\.travel is missing: a travel shot needs travel/)
	assert.match(check((q) => (q.shots[0].run = { from: "start", to: "end", rate: 0.5 })), /label is missing: a rate other than 1/)
	assert.match(check((q) => (q.shots[0].run = { freeze: "after the release" })), /"after the release" is not a moment id/)
	assert.match(check((q) => (q.shots[0].frame = { size: 0.5, fit: "snug" })), /frame gives size and fit: a frame is one of/)
	assert.match(check((q) => (q.shots[0].camera = "wide")), /shots\[0\] \(tip\)\.camera is not a field here/)
	assert.match(check((q) => (q.shots[0].in = "fade")), /in must be one of "cut", "continue", not "fade" \(in is "cut", "continue" or \{ease/)
	assert.match(check((q) => (q.story[0].kind = "intro")), /story\[0\] \(laser\)\.kind must be one of "setup"/)
	assert.match(check((q) => (q.shots[0].subject = { trail: "laser" })), /is a trail: it needs from and to/)
	assert.match(check((q) => (q.version = 2)), /plan\.version must be 1/)
})

test("names the run lacks come back with the digest's nearest ids; timing and marks are checked against the run", async () => {
	const d = await digestOf("01-laser-mirror")
	const p = plan("01-laser-mirror")
	const errs = (f) => {
		const q = JSON.parse(JSON.stringify(p))
		f(q)
		return validateShotPlan(q, { digest: d }).errors.join("\n")
	}
	assert.match(errs((q) => (q.shots[0].subject = { item: "lazer" })), /subject\.item "lazer" is not in the scene: the nearest are laser/)
	assert.match(errs((q) => (q.shots[0].run = { freeze: "relase", seconds: 2 })), /run\.freeze "relase" is not a moment of this run: the nearest are release/)
	assert.match(errs((q) => (q.shots[2].subject = { beam: "laser", bounce: 2 })), /bounce 2: the light from laser turns 1 time \(bounce 1\)/)
	assert.match(errs((q) => (q.shots[1].travel.path.to = "hit:laser")), /"hit:laser": the light from laser ends on mirror, target/)
	assert.match(errs((q) => (q.shots[0].subject = { beam: "torch" })), /beam "torch" is not a light source/)
	assert.match(errs((q) => (q.shots[0].subject = { contact: ["laser", "mirror"] })), /they never touch/)
	assert.match(errs((q) => (q.shots[0].subject = { role: "car" })), /role "car" needs the plan's lanes/)
	assert.match(errs((q) => (q.shots[0].run = { freeze: "release", seconds: 0.5 })), /lasts 0\.5 s of video: a shot must last at least 0\.8 s/)
	assert.match(errs((q) => (q.shots[0].run = { from: "end", to: "start" })), /plays backwards/)
	assert.match(errs((q) => (q.shots[0].subject = { path: "hose" })), /no module publishes its drawn routes yet/)
	assert.match(errs((q) => (q.shots[0].annotate = [{ kind: "angle", on: { item: "mirror" } }])), /an angle is drawn at a bounce: on must be \{beam, bounce\}/)
	assert.match(errs((q) => (q.shots[0].annotate = [{ kind: "label", on: { item: "laser" }, text: "{dt} s" }])), /uses \{dt\}: give since and from/)
	assert.match(errs((q) => (q.shots[0].subject = { item: "target", reading: "lux" })), /reading "lux": target reads light_w, hit, mw/)
	assert.match(errs((q) => (q.shots[0].run = { freeze: "reading:target.hit:starts" })), /target\.hit never changes \(it stays 1\), so it has no starts/)
	assert.match(errs((q) => (q.shots[0].run = { freeze: "reading:target.hit:crosses=5" })), /target\.hit never changes \(it stays 1\), so it has no crosses=5/)
	assert.match(errs((q) => (q.shots[0].beat = "intro")), /beat "intro" is not a story beat/)
	assert.match(errs((q) => (q.output.max_seconds = 10)), /the plan lasts 17\.9\d* s of video; output\.max_seconds is 10/)
	// a comparison filmed one run per lane must use exactly its lanes
	const d2 = await digestOf("02-fairtest-ramps")
	const p2 = plan("02-fairtest-ramps")
	p2.lanes.list[1].id = "low"
	assert.match(validateShotPlan(p2, { digest: d2 }).errors.join("\n"), /plan\.lanes\.list must have exactly the lanes top, bottom \(one per run\); missing bottom; low has no run/)
	assert.deepEqual(nearest("contact:ramp+ball1", ["contact:ramp1+ball1", "contact:ramp2+ball1", "start:ball1", "end"], 2), ["contact:ramp1+ball1", "contact:ramp2+ball1"])
	// lanes the caller fixed are kept as they are
	const given = { list: plan("02-fairtest-ramps").lanes.list.map((l) => ({ id: l.id, cast: l.cast })) }
	assert.deepEqual(validateShotPlan(plan("02-fairtest-ramps"), { digest: d2, lanes: given }).errors, [])
	const p3 = plan("02-fairtest-ramps")
	p3.lanes.list[1].cast.blocks = ["block1"]
	assert.match(validateShotPlan(p3, { digest: d2, lanes: given }).errors.join("\n"), /plan\.lanes must keep the caller's lanes as they are/)
})

test("the automatic plan is valid for every design scene, split at one scale for a comparison filmed one run per lane", async () => {
	for (const name of Object.keys(PLANS)) {
		const d = await digestOf(name)
		const p = safePlan(d, { kind: "demo" })
		const r = validateShotPlan(p, { digest: d })
		assert.deepEqual(r.errors, [], name)
		assert.ok(p.shots.length >= 1 && p.shots.every((s) => s.move === "hold"), name)
		if (d.lanes) assert.deepEqual(p.lanes.list.map((l) => l.id), d.lanes.map((l) => l.id))
		if (name === "01-laser-mirror") assert.ok(p.shots.some((s) => s.subject.beam === "laser"), "a still run with light looks at the light")
	}
})

// ------------------------------------------------------------------------------------------------ the step: direct, measure, repair, fall back
test("a plan that passes the engine's checks is the answer: one model call, the digest in the user turn, a why per shot", async () => {
	gw.script("m1", [answer(plan("01-laser-mirror"), 0.16)])
	const ex = stubExecutor([PASS])
	const out = await runStep("direct", { scene: LASER(), lesson: LESSON, kind: "demo", return_digest: true }, opts({ executor: ex }))
	assert.equal(out.result.source, "director")
	assert.equal(out.result.measured, true)
	assert.deepEqual(out.result.rounds.map((r) => [r.round, r.ok]), [[0, true]])
	assert.deepEqual(out.result.shots.map((s) => s.id), ["tip", "to-mirror", "bounce", "to-target", "back-up", "angles"])
	assert.ok(out.result.shots.every((s) => typeof s.why === "string" && s.why.length > 8 && s.seconds > 0.8))
	assert.equal(out.result.digest_hash, out.result.digest.hash)
	assert.equal(gw.requests.length, 1)
	const msgs = gw.requests[0].body.messages
	assert.match(JSON.stringify(msgs[0].content), /You are directing a short science video/)
	const user = msgs[1].content
	assert.match(user, /The question at this video's pause: "What happens to the light when it hits the mirror\?"/)
	assert.match(user, /# The timeline digest\nSCENE demo-mirror/)
	assert.match(user, /Write the shot plan as one JSON object\.$/)
	assert.equal(ex.seen.length, 1)
	assert.deepEqual(Object.keys(ex.seen[0].ctx.runs), [""])
	assert.equal(out.usage.costInUSD, 0.16)
	assert.equal(out.prompt.digest.executor, "stub")
})

test("measured failures go back to the director as a repair turn; the repaired plan is measured again", async () => {
	const good = plan("01-laser-mirror")
	const first = JSON.parse(JSON.stringify(good))
	first.shots[0].frame = { width: 1.2 }
	gw.script("m1", [answer(first, 0.2), answer(good, 0.1)])
	const ex = stubExecutor([FAIL("too small: {\"item\":\"laser\"} s 0.05 h 0.02 (floor s 0.09)"), PASS])
	const out = await runStep("direct", { scene: LASER(), lesson: LESSON }, opts({ executor: ex }))
	assert.equal(out.result.source, "director")
	assert.deepEqual(out.result.rounds.map((r) => [r.round, r.ok]), [[0, false], [1, true]])
	assert.equal(out.result.plan.shots[0].frame.width, 0.28)
	assert.equal(gw.requests.length, 2)
	const msgs = gw.requests[1].body.messages
	assert.deepEqual(msgs.map((m) => m.role), ["system", "user", "assistant", "user"])
	assert.equal(JSON.parse(msgs[2].content).shots[0].frame.width, 1.2)
	assert.match(msgs[3].content, new RegExp(`1 check failed \\(repair 1 of at most ${REPAIR_TURNS}\\):\\n- tip subject-size: too small`))
	assert.match(msgs[3].content, /Ways to repair them:\n- subject-size: a hero under its floor: frame closer/)
	assert.match(msgs[3].content, /Return the complete corrected plan as one JSON object/)
	assert.ok(Math.abs(out.usage.costInUSD - 0.3) < 1e-9)
	assert.deepEqual([...new Set(out.attempts.map((a) => a.turn))], [0, 1])
})

test("a plan still breaking a hard check after the repair turns is replaced by the automatic plan; the director's best try and its failures are kept", async () => {
	const p = plan("01-laser-mirror")
	gw.script("m1", Array.from({ length: REPAIR_TURNS + 1 }, () => answer(p)))
	const ex = stubExecutor([(q) => (q.notes?.startsWith("Made without a director") ? PASS : HARD())])
	const out = await runStep("direct", { scene: LASER(), lesson: LESSON }, opts({ executor: ex }))
	assert.equal(gw.requests.length, REPAIR_TURNS + 1)
	assert.equal(out.result.source, "automatic")
	assert.equal(out.result.rounds.length, REPAIR_TURNS + 1)
	assert.ok(out.result.rounds.every((r) => !r.ok))
	assert.equal(out.result.fallback.reason, "the director's plan still breaks the engine's checks")
	assert.equal(out.result.fallback.plan_by, "director.mjs")
	assert.deepEqual(out.result.fallback.director_failed, ["tip keep-in: every kept thing at least 0.02 inside the edges at every frame (closest -0.1 at 1 s)"])
	assert.equal(out.result.fallback.director_plan.title, p.title)
	assert.equal(out.result.report.ok, true)
	assert.deepEqual(validateShotPlan(out.result.plan, { digest: buildDigest({ runs: await runsOf("01-laser-mirror") }) }).errors, [])
})

test("soft failures (size, fill) after the repair turns keep the director's best try, said in the warnings", async () => {
	const p = plan("01-laser-mirror")
	const closer = JSON.parse(JSON.stringify(p))
	closer.shots[0].frame = { width: 0.2 }
	gw.script("m1", [answer(p), answer(closer), answer(p), answer(p)])
	const fill = { ok: false, checks: [{ shot: "tip", check: "fill", ok: false, why: "0.9 of the picture is backdrop" }], shots: [] }
	const two = { ok: false, checks: [FAIL().checks[0], fill.checks[0]], shots: [] }
	const ex = stubExecutor([two, fill, two, two])
	const out = await runStep("direct", { scene: LASER(), lesson: LESSON }, opts({ executor: ex }))
	assert.equal(gw.requests.length, REPAIR_TURNS + 1)
	assert.equal(out.result.source, "director")
	assert.equal(out.result.plan.shots[0].frame.width, 0.2, "the try with the fewest failures (the later one on a tie)")
	assert.deepEqual(out.result.soft, ["tip fill: 0.9 of the picture is backdrop"])
	assert.equal(out.result.report.ok, false)
	assert.match(out.warnings.join("\n"), /the director's plan is filmed with 1 size or fill check\(s\) under the net after 3 repair\(s\)/)
	assert.ok(["subject-size", "must-see", "fill", "face", "beam-visible"].every((c) => SOFT_CHECKS.has(c)) && !SOFT_CHECKS.has("keep-in"))
})

test("an executor's own automatic plan is used when it passes; when none passes, the one that breaks the fewest hard checks, the director's on a tie", async () => {
	gw.script("m1", Array.from({ length: REPAIR_TURNS + 1 }, () => answer(plan("01-laser-mirror"))))
	const theirs = { ...plan("01-laser-mirror"), title: "Their automatic camera" }
	const ex = { ...stubExecutor([(q) => (q.title === "Their automatic camera" ? PASS : HARD())]), safePlan: () => theirs }
	const out = await runStep("direct", { scene: LASER(), lesson: LESSON }, opts({ executor: ex }))
	assert.equal(out.result.source, "automatic")
	assert.equal(out.result.fallback.plan_by, "executor")
	assert.equal(out.result.plan.title, "Their automatic camera")
	gw.reset()
	gw.script("m1", Array.from({ length: REPAIR_TURNS + 1 }, () => answer(plan("01-laser-mirror"))))
	const two = { ok: false, checks: [HARD().checks[0], { shot: "y", check: "cut", ok: false, why: "a jump cut" }], shots: [] }
	const ex2 = { ...stubExecutor([(q) => (q.title === "Their automatic camera" ? two : q.notes?.startsWith("Made without a director") ? FAIL() : HARD())]), safePlan: () => theirs }
	const out2 = await runStep("direct", { scene: LASER(), lesson: LESSON }, opts({ executor: ex2 }))
	assert.equal(out2.result.fallback.plan_by, "director.mjs", "this file's automatic plan breaks no hard check")
	assert.match(out2.warnings.join("\n"), /the automatic plan fails the engine's checks too \(framing-infeasible/)
	gw.reset()
	gw.script("m1", Array.from({ length: REPAIR_TURNS + 1 }, () => answer(plan("01-laser-mirror"))))
	const ex3 = { ...stubExecutor([(q) => (q.title === "Their automatic camera" || q.notes?.startsWith("Made without a director") ? two : HARD())]), safePlan: () => theirs }
	const out3 = await runStep("direct", { scene: LASER(), lesson: LESSON }, opts({ executor: ex3 }))
	assert.equal(out3.result.source, "director", "no automatic plan breaks fewer hard checks than the director's")
	assert.equal(out3.result.fallback.plan_by, "director")
})

test("a plan that does not validate gets the core's repair turn with the errors and nearest ids, before anything is measured", async () => {
	const bad = plan("01-laser-mirror")
	bad.shots[0].subject = { item: "lazer" }
	gw.script("m1", [answer(bad), answer(plan("01-laser-mirror"))])
	const ex = stubExecutor([PASS])
	const out = await runStep("direct", { scene: LASER(), lesson: LESSON }, opts({ executor: ex }))
	assert.equal(out.result.source, "director")
	assert.equal(gw.requests.length, 2)
	const repair = gw.requests[1].body.messages.at(-1).content
	assert.match(repair, /shots\[0\] \(tip\)\.subject\.item "lazer" is not in the scene: the nearest are laser/)
	assert.equal(ex.seen.length, 1, "only the valid plan is measured")
	assert.equal(out.repaired, true)
})

test("no usable plan from any route falls back to the automatic plan; a gateway that is down is an error", async () => {
	gw.fallback = () => ({ content: '{"version": 1, "about": "x"}' })
	const out = await runStep("direct", { scene: LASER(), lesson: LESSON }, opts({ executor: stubExecutor([PASS]) }))
	assert.equal(out.result.source, "automatic")
	assert.match(out.result.fallback.reason, /^director: invalid_output/)
	assert.ok(out.attempts.length >= 2)
	gw.reset()
	gw.fallback = () => ({ status: 500, body: { error: { message: "down" } } })
	await assert.rejects(runStep("direct", { scene: LASER(), lesson: LESSON }, opts({ executor: stubExecutor([PASS]) })), (e) => e instanceof AIError && e.code === "gateway")
	gw.fallback = () => ({ status: 500, body: { error: { message: "no scripted answer" } } })
})

test("a repair turn starts only with time left for a whole answer: else the automatic plan", async () => {
	gw.script("m1", [answer(plan("01-laser-mirror"))])
	const r = routing()
	r.steps.direct = { ...r.steps.direct, timeoutMs: 60000, budgetMs: 15000 }
	const out = await runStep("direct", { scene: LASER(), lesson: LESSON }, { ...opts({ executor: stubExecutor([HARD(), PASS]) }), routing: r })
	assert.equal(gw.requests.length, 1)
	assert.equal(out.result.source, "automatic")
	assert.match(out.warnings.join("\n"), /no time left for repair 1/)
})

test("a comparison filmed one run per lane reaches the executor as one run per lane, with its hints", async () => {
	gw.script("m1", [answer(plan("02-fairtest-ramps"))])
	const ex = stubExecutor([PASS])
	const [top, bottom] = (await runsOf("02-fairtest-ramps")).map((r) => r.scene)
	const out = await runStep("direct", { runs: { top, bottom }, lesson: { question: "Is this a valid experiment to test ramp height?", pauses: [{ where: "result" }], grade: 3 } }, opts({ executor: ex }))
	assert.equal(out.result.source, "director")
	const ctx = ex.seen[0].ctx
	assert.deepEqual(Object.keys(ctx.runs), ["top", "bottom"])
	assert.deepEqual(ctx.runs.top.hints.text, ["Is this a valid experiment to test ramp height?"])
	assert.equal(ctx.runs.top.hints.pairs[0].scene.id, "ft_3b_car_red_clay")
	assert.match(gw.requests[0].body.messages[1].content, /A comparison filmed one run per lane: top = ft_1b_car_red_clay, bottom = ft_3b_car_red_clay\. Your lanes\.list must have exactly these lane ids\./)
	const wi = worldInput(ctx)
	assert.deepEqual(Object.keys(wi.runs), ["top", "bottom"])
	assert.deepEqual([ctx.W, ctx.H], [1920, 1080], "no aspect: a 16:9 picture")
})

test("a plan is measured at the video's own aspect: a 3:2 lesson's split bands are 3:1, as the compositor films them", async () => {
	assert.deepEqual(pictureOf("3:2"), { W: 1620, H: 1080 })
	assert.deepEqual(pictureOf("16:9"), { W: 1920, H: 1080 })
	assert.deepEqual(pictureOf(undefined), { W: 1920, H: 1080 })
	gw.script("m1", [answer(plan("02-fairtest-ramps"))])
	const ex = stubExecutor([PASS])
	const [top, bottom] = (await runsOf("02-fairtest-ramps")).map((r) => r.scene)
	await runStep("direct", { runs: { top, bottom }, aspect: "3:2", lesson: { question: "Is this a valid experiment to test ramp height?", pauses: [{ where: "result" }], grade: 3 } }, opts({ executor: ex }))
	assert.deepEqual([ex.seen[0].ctx.W, ex.seen[0].ctx.H], [1620, 1080])
	// the real executor films the same plan at the two pictures differently: each band's aspect decides its framing
	const world = Shots.makeWorld(worldInput({ runs: Object.fromEntries((await runsOf("02-fairtest-ramps")).map((r) => [r.lane, { scene: r.scene, run: r.run }])) }))
	const wide = Shots.compile(plan("02-fairtest-ramps"), world, { width: 1920, height: 1080, fps: 30 })
	const lesson = Shots.compile(plan("02-fairtest-ramps"), world, { width: 1620, height: 1080, fps: 30 })
	assert.deepEqual(lesson.shots[0].bands.map((b) => b.rect[2] / b.rect[3]), [3, 3])
	assert.notDeepEqual(lesson.frames[0].b, wide.frames[0].b)
})

test("the step measures with web/export/shots.js itself: one world of the step's runs, its moments the digest's, its measured failures sent back", async () => {
	const ex = loadExecutor({})
	assert.equal(ex.name, "web/export/shots.js")
	let worlds = 0
	const counted = { ...ex, world: (input) => (worlds++, ex.world(input)) }
	const far = plan("01-laser-mirror")
	far.shots[0].frame = { width: 2.5 }
	gw.script("m1", [answer(far), answer(plan("01-laser-mirror"))])
	const out = await runStep("direct", { scene: LASER(), lesson: LESSON, return_digest: true }, { ...opts(), executor: counted })
	assert.equal(worlds, 1, "the world is built once for every plan of the step")
	assert.equal(out.result.source, "director")
	assert.equal(out.result.measured, true)
	assert.equal(out.result.report.ok, true)
	assert.deepEqual(out.result.rounds.map((r) => r.ok), [false, true])
	assert.ok(out.result.rounds[0].failed.some((f) => /^tip (subject-size|fill|beam-visible|must-see)/.test(f)), out.result.rounds[0].failed.join("; "))
	const sent = gw.requests[1].body.messages.at(-1).content
	assert.match(sent, /^The engine compiled your plan and measured every frame/)
	assert.ok(out.result.rounds[0].failed.every((f) => sent.includes(f)))
	assert.match(out.result.digest.text, /^SCENE demo-mirror/)
	assert.equal(out.prompt.digest.executor, "web/export/shots.js")
	// the digest's moments are the executor's own
	const w = ex.world(worldInput({ runs: { "": { scene: LASER(), run: await runScene(LASER()) } } }))
	assert.deepEqual(ex.momentsOf(w, "").index, Object.fromEntries(w.runs.get("").M))
})

test("the page's model boxes reach the executor's world: a box drawn bigger than the outline is what the plan is measured on", async () => {
	const scene = LASER()
	const run = await runScene(scene)
	const plain = Shots.makeWorld(worldInput({ runs: { "": { scene, run } } }))
	const solid = run.doc.solids.find((x) => x.item === "laser" || x.id?.startsWith("laser"))
	const big = { [solid.id]: { world: [0, 1.2, 0, 0.6, -0.1, 0.1] } }
	const src = await directSource({ scene, lesson: LESSON, boxes: big }, { clean: async (v) => v })
	assert.deepEqual(src.boxes, { "": big })
	const boxed = Shots.makeWorld(worldInput({ runs: { "": { scene, run, boxes: src.boxes[""] } } }))
	const span = (w) => {
		const P = w.main.itemPts("laser", null, 0)
		return Math.max(...P.map((p) => p[0])) - Math.min(...P.map((p) => p[0]))
	}
	assert.ok(span(boxed) > span(plain) + 0.5, `${span(boxed)} vs ${span(plain)}`)
	await assert.rejects(directSource({ scene, lesson: LESSON, boxes: { x: { y: 1 } } }, { clean: async (v) => v }), badInput(/boxes\["x"\] must be/))
	await assert.rejects(directSource({ runs: { top: scene, bottom: scene }, lesson: LESSON, boxes: { left: {} } }, { clean: async (v) => v }), badInput(/boxes\.left: no such lane/))
})

test("the repair turn names every failed check and what the failing shots measured", () => {
	const report = { ok: false, checks: [{ shot: "roll", check: "speed", ok: false, why: "the picture's fastest point 0.639 widths/s (limit 0.5 for a pull)" }, { shot: "roll", check: "zoom-rate", ok: true, why: "fine" }], shots: [{ id: "roll", move: "pull", video: [3, 5.8], heroes: [{ what: '{"role":"toy"}', lane: "top", s: 0.1 }], minKeep: 0.04, peakPanWps: 0.639, peakZoomPerS: 0.75, peakYawDegS: 0 }] }
	assert.deepEqual(failedChecks(report), ["roll speed: the picture's fastest point 0.639 widths/s (limit 0.5 for a pull)"])
	const t = repairTurn(report, 1)
	assert.match(t, new RegExp(`1 check failed \\(repair 1 of at most ${REPAIR_TURNS}\\):\\n- roll speed: the picture's fastest point 0\\.639 widths\\/s \\(limit 0\\.5 for a pull\\)`))
	assert.match(t, /Ways to repair them:\n- speed: the camera moves too fast/)
	assert.match(t, /- roll \(pull\); video 3-5\.8 s; heroes \{"role":"toy"\}@top s 0\.1; closest margin 0\.04; fastest point 0\.639 widths\/s, zoom 0\.75\/s/)
})

// ------------------------------------------------------------------------------------------------ the recorded live answers
const RECORDED = readdirSync(new URL(`${FX}recorded/`, PG)).filter((f) => f.endsWith(".json"))
test("the recorded answers of the live runs replay with the verdicts they were measured with: each round's plan valid, the failures sent back, the last plan passing", async () => {
	assert.ok(RECORDED.length >= 6, `${RECORDED.length} recorded runs`)
	for (const f of RECORDED) {
		gw.reset()
		const rec = json(`${FX}recorded/${f}`)
		const payload = { ...rec.payload }
		if (typeof payload.scene === "string") payload.scene = json(payload.scene)
		if (payload.runs) payload.runs = Object.fromEntries(Object.entries(payload.runs).map(([l, p]) => [l, json(p)]))
		gw.script("m1", rec.rounds.map((r) => answer(r.plan, r.usd ?? 0.1)))
		// (each failed check as the executor wrote it: "<shot> <check>: <why>", or "<check>: <why>" for one about the whole plan)
		const check = (line) => {
			const m = /^(\S+) (\S+): ([\s\S]*)$/.exec(line) ?? []
			return m.length ? { shot: m[1], check: m[2], ok: false, why: m[3] } : { shot: null, check: line.split(":")[0], ok: false, why: line.slice(line.indexOf(":") + 2) }
		}
		const ex = stubExecutor(rec.rounds.map((r) => (r.ok ? PASS : { ok: false, checks: r.failed.map(check), shots: [] })))
		const out = await runStep("direct", payload, opts({ executor: ex }))
		assert.equal(out.result.source, "director", f)
		assert.equal(out.result.rounds.length, rec.rounds.length, f)
		assert.deepEqual(out.result.plan, rec.rounds.at(-1).plan, f)
		assert.deepEqual(out.warnings, [], f)
		rec.rounds.slice(0, -1).forEach((r, i) => {
			const sent = gw.requests[i + 1].body.messages.at(-1).content
			for (const why of r.failed) assert.ok(sent.includes(why), `${f}: round ${i} sends back "${why}"`)
		})
	}
})
