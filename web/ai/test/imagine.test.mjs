// Imagine-first helpers (node --test web/ai/test/imagine.test.mjs): which requests get a concept picture and how, the concept read off the
// server's answer, what is left out of the card, and the client's deadline. The orchestrator's use of them is in orchestrator.test.mjs.
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { isChainRequest, conceptPlan, conceptRoute, imagineMode, pickConcept, mentionsPicture, dropPictureLines, dropPictureSentences, withDeadline, CONCEPT_NOTE, CONCEPT_LABEL, IMAGINE_DEADLINE_MS } from "../imagine.js"

const PROMPTS = JSON.parse(readFileSync(new URL("./fixtures/imagine-prompts.json", import.meta.url))).cases

test("the chain classifier picks exactly the experiment's 11 chains out of its 40 prompts", () => {
	assert.equal(PROMPTS.length, 40)
	const picked = PROMPTS.filter((c) => isChainRequest(c.prompt)).map((c) => c.id.split("-")[0])
	assert.deepEqual(picked.sort(), ["c1", "c2", "g2", "m5", "n05", "n08", "n09", "n10", "n12", "n13", "n14"].sort())
	// (common science-class requests are not chains: round 3's acceptance, each about a minute more for nothing)
	for (const t of ["A simple machine: a lever that lifts a heavy box", "Show me a pulley machine lifting a bucket", "A washing machine on a table", "A vending machine next to a ball", "Two steps of stairs with a ball on the top one"]) assert.equal(isChainRequest(t), false, t)
	assert.equal(isChainRequest("a simple machine chain reaction: a ball knocks a lever"), true, "(a real chain still is)")
})

test("conceptPlan: off by default; auto -> observe for a chain, none otherwise; always -> observe / direct; off -> none; a forced route is kept", () => {
	const chain = "build a rube goldberg machine that ends with a ball in a cup"
	const simple = "a ball rolls down a ramp"
	assert.equal(conceptPlan(chain), null, "Off is the default (round3-plan §8 D: Auto failed the ship rule)")
	assert.equal(conceptPlan(chain, "auto"), "observe")
	assert.equal(conceptPlan(simple, "auto"), null)
	assert.equal(conceptPlan(chain, "always"), "observe")
	assert.equal(conceptPlan(simple, "always"), "direct")
	assert.equal(conceptPlan(chain, "off"), null)
	assert.equal(conceptPlan(simple, "observe"), "observe")
	assert.equal(conceptPlan(simple, "direct"), "direct")
	assert.equal(conceptPlan("   ", "always"), null)
	assert.ok(isChainRequest("a ball knocks dominoes that push a car which rolls off the edge"), "three action verbs")
	assert.ok(!isChainRequest("a ball knocks over dominoes"))
	assert.equal(imagineMode("Always"), "off", "(an unknown setting is off)")
	assert.equal(imagineMode(undefined), "off")
	assert.equal(imagineMode("auto"), "auto")
	assert.equal(imagineMode("off"), "off")
})

test("conceptRoute: only a NEW scene from words; an edit, a check, a photo or no words never make one", () => {
	const chain = "a 4 stage chain reaction into a bucket"
	assert.equal(conceptRoute({ mode: "new", text: chain }), null, "nothing passed: Off")
	assert.equal(conceptRoute({ mode: "new", text: chain, imagine: "auto" }), "observe")
	assert.equal(conceptRoute({ mode: "new", text: chain, imagine: "off" }), null)
	assert.equal(conceptRoute({ mode: "new", text: "a ball on a table", imagine: "always" }), "direct")
	assert.equal(conceptRoute({ mode: "edit", text: chain, imagine: "always" }), null)
	assert.equal(conceptRoute({ mode: "check", text: chain, imagine: "always" }), null)
	assert.equal(conceptRoute({ mode: "new", text: chain, images: [{ dataUrl: "data:image/jpeg;base64,AA" }], imagine: "always" }), null, "a user photo always wins")
	assert.equal(conceptRoute({ mode: "new", text: "", imagine: "always" }), null)
})

test("pickConcept: the one concept and its cast and story (≤ 6 lines); no picture, no concept", () => {
	const out = {
		concepts: [{ data: "data:image/jpeg;base64,/9j/AAAA", mime: "image/jpeg", model: "openai-group/gpt-image-2.5-flare", width: 1536, height: 1024 }],
		cast: [{ type: "domino", count: 10, role: "the row", size: "5 cm" }, { type: "steel-ball" }, { nope: 1 }],
		story: ["1", "2", "3", "4", "5", "6", "7", ""],
		layout: "left to right"
	}
	const c = pickConcept(out)
	assert.equal(c.image, out.concepts[0].data)
	assert.deepEqual([c.width, c.height, c.mime, c.model], [1536, 1024, "image/jpeg", "openai-group/gpt-image-2.5-flare"])
	assert.deepEqual(c.cast, [{ type: "domino", count: 10, role: "the row", size: "5 cm" }, { type: "steel-ball", count: 1 }])
	assert.deepEqual(c.story, ["1", "2", "3", "4", "5", "6"])
	assert.equal(pickConcept({ concepts: [] }), null)
	assert.equal(pickConcept({ concepts: [{ data: "https://example.com/x.jpg" }] }), null, "only a picture that came in the answer")
	assert.equal(pickConcept(null), null)
	assert.equal(pickConcept({ concepts: [{ data: "data:image/png;base64,iVBOR" }] }).mime, "image/png", "(the Gemini fallback's square PNG)")
})

test("the concept is never the user's picture: lines about 'the picture / image / photo / concept' are left out of the card", () => {
	assert.ok(mentionsPicture("The picture shows four dominoes; I used six"))
	assert.ok(mentionsPicture("Unlike the concept image, the ramp slopes left"))
	assert.ok(mentionsPicture("the photo's cup is red"))
	assert.ok(mentionsPicture("Books: the library's hardcover is 23 cm long, the pictured ones look about 27 cm"), "(a live plan's own words, 15 Oct)")
	assert.ok(!mentionsPicture("The ramp is 10 cm shorter than asked"))
	assert.deepEqual(dropPictureLines(["The picture has a cat", "Used a tennis ball for the ball", "In the image the cup is on a shelf"]), ["Used a tennis ball for the ball"])
	// (the plan's own reply, sentence by sentence: round 3's acceptance, 4 of 70 concept builds and 2 of 7 UI builds)
	assert.equal(dropPictureSentences("I built a car that rolls into the dominoes. I left out the books, block and cup from the concept picture, because the car's gentle push could not tip them."), "I built a car that rolls into the dominoes.")
	assert.equal(dropPictureSentences("The middle ramp now slopes down instead of uphill as in the sketch."), null)
	assert.equal(dropPictureSentences("I left out the picture's ramp and post, because you asked for a drop. The ball lands in the cup."), "The ball lands in the cup.")
	assert.equal(dropPictureSentences("A ball rolls into a cup."), "A ball rolls into a cup.")
	assert.match(CONCEPT_NOTE, /not the user's own picture/)
	assert.match(CONCEPT_NOTE, /follow the words/)
	assert.equal(CONCEPT_LABEL, "concept image generated by the app from the request")
	assert.equal(IMAGINE_DEADLINE_MS, 75000)
})

test("withDeadline: past the deadline it stops the call (its signal aborts) and says timeout; a cancel is an AbortError; in time it answers", async () => {
	let seen = null
	await assert.rejects(
		withDeadline((sg) => new Promise((resolve, reject) => ((seen = sg), sg.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))))), 30),
		(e) => e.kind === "timeout"
	)
	assert.ok(seen.aborted, "the call itself was stopped")
	const parent = new AbortController()
	const p = withDeadline((sg) => new Promise((_, reject) => sg.addEventListener("abort", () => reject(Object.assign(new Error("Cancelled"), { name: "AbortError" })))), 5000, parent.signal)
	parent.abort()
	await assert.rejects(p, { name: "AbortError" })
	assert.equal(await withDeadline(async () => 42, 1000), 42)
})

// ================================================================ the orchestrator's imagine-first (round3-plan §4.1), with the AI mocked
import { createOrchestrator, STEP_LABELS } from "../orchestrator.js"
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
const rube = () => JSON.parse(readFileSync(new URL("./fixtures/rube.plan.json", import.meta.url)))
const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ"
const IMAGINED = { concepts: [{ data: JPEG, mime: "image/jpeg", model: "openai-group/gpt-image-2.5-flare", width: 1536, height: 1024 }], cast: [{ type: "domino", count: 6, role: "the row", size: "5 cm" }, { type: "tennis-ball", count: 1 }], missing: [], layout: "left to right", story: ["The ball rolls down the ramp", "It knocks the dominoes over"], prompt: "a photo of…" }
const OBSERVED = { summary: "a ramp, six dominoes and a ball", objects: [{ label: "domino", count: 6 }, { label: "ramp" }, { label: "ball" }], uncertain: ["the ball might be a golf ball"] }
const CHAIN = "a rube goldberg machine: a ball rolls down a ramp and knocks over dominoes"
const SIMPLE = "a ball rolls down a ramp"
const planWith = (extra = {}) => ({ ...rube(), covers: [{ label: "domino", ids: ["row"] }], differences: ["The picture shows 8 dominoes; I used 6", "The ramp is a little steeper than asked"], ...extra })
/** A mock of the app's api(): answers from `answers[step]` (a value, an Error, or a function of the payload and the call's number). */
function mockApi(answers, log = []) {
	return async (path, body, signal) => {
		if (path === "/api/simulate") return simulate(body.scene, signal)
		const step = path.replace("/api/ai/", "")
		log.push({ step, payload: body.payload })
		let a = answers[step]
		if (typeof a === "function") a = await a(body.payload, log.filter((l) => l.step === step).length, signal)
		if (a instanceof Error) throw a
		return { ok: true, result: a, model: `mock/${step}`, ms: 5, usage: { input_tokens: 10, output_tokens: 5 } }
	}
}
const REFINE = { done: true, score_0_10: 9, issues: [], patches: [] }
const build = async (request, answers, opts = {}, deps = {}) => {
	const log = []
	const events = []
	const ai = createOrchestrator({ api: mockApi(answers, log), progress: false, ...deps })
	const r = await ai.build(request, { onEvent: (e) => events.push(e), stageTune: false, ...opts }).result
	return { r, log, events, steps: log.map((l) => l.step) }
}
const infoLines = (r) => r.issues.filter((i) => i.code === "imagine_failed")
const AUTO = { imagine: "auto" }

test("a chain: imagine -> observe -> plan, the concept sent with CONCEPT_NOTE; it is never the user's picture (no observation, picture, covers, unsure or 'the picture' lines after the plan)", async () => {
	const { r, log, events, steps } = await build({ text: CHAIN }, { imagine: IMAGINED, observe: OBSERVED, plan: planWith({ reply: "I built the ramp and six dominoes. I left out the concept picture's cup, because nothing tips it." }), refine: REFINE }, { imagine: "auto" })
	assert.deepEqual(steps, ["imagine", "observe", "plan", "refine"])
	assert.deepEqual(log[0].payload, { text: CHAIN }, "the imagine step gets the words only")
	const withNote = `${CHAIN}\n\n${CONCEPT_NOTE}`
	assert.equal(log[1].payload.text, withNote)
	assert.deepEqual(log[1].payload.images, [{ data: JPEG, name: CONCEPT_LABEL, label: CONCEPT_LABEL }])
	assert.equal(log[2].payload.text, withNote)
	assert.deepEqual(log[2].payload.observation, OBSERVED)
	assert.deepEqual(log[2].payload.images, [{ data: JPEG, name: CONCEPT_LABEL, label: CONCEPT_LABEL }])
	assert.equal(log[2].payload.intent, "new")
	// the critic never sees it
	const rp = log[3].payload
	assert.equal(rp.text, CHAIN, "the critic gets the words alone")
	assert.equal(rp.observation, undefined)
	assert.deepEqual(rp.images, [])
	assert.ok(!JSON.stringify(rp).includes(JPEG), "no concept anywhere in the critic's payload")
	assert.equal(rp.plan.covers, undefined)
	// the report
	assert.deepEqual(r.concept, { image: JPEG, cast: IMAGINED.cast, story: IMAGINED.story, how: "observe" })
	assert.equal(r.plan.covers, undefined)
	assert.equal(r.coverage, undefined, "no reconcile or coverage")
	assert.deepEqual(r.unsure, [])
	assert.deepEqual(r.differences, [], "the plan's differences are from the concept, not from anything the person gave: none shown")
	assert.equal(r.planned, "I built the ramp and six dominoes.", "the plan's own reply never compares the scene with the concept")
	assert.equal(r.observation, undefined)
	assert.ok(r.timings.imagine >= 0)
	// the concept event as soon as the picture arrives (before the plan step ends), and the step row
	const ci = events.findIndex((e) => e.type === "concept")
	assert.deepEqual(events[ci], { type: "concept", image: JPEG, cast: IMAGINED.cast, story: IMAGINED.story })
	assert.ok(ci < events.findIndex((e) => e.type === "step" && e.step === "plan" && e.state === "done"))
	assert.ok(events.some((e) => e.type === "step" && e.step === "imagine" && e.state === "done" && e.label === "Picturing the scene"))
	assert.equal(STEP_LABELS.imagine, "Picturing the scene")
	assert.deepEqual(infoLines(r), [])
})

test("off by default; a simple request makes no imagine call (auto); always -> direct (the plan reads the picture itself); off -> none; a photo always wins", async () => {
	// (nothing passed: Off, round3-plan §8 D; a chain makes no concept)
	const none = await build({ text: CHAIN }, { imagine: IMAGINED, plan: planWith(), refine: REFINE })
	assert.deepEqual(none.steps, ["plan", "refine"])
	assert.equal(none.r.concept, null)
	const a = await build({ text: SIMPLE }, { imagine: IMAGINED, plan: planWith(), refine: REFINE }, { imagine: "auto" })
	assert.deepEqual(a.steps, ["plan", "refine"])
	assert.equal(a.r.concept, null)
	assert.ok(a.events.some((e) => e.type === "step" && e.step === "imagine" && e.state === "skipped"))
	assert.equal(a.log[0].payload.text, SIMPLE)
	assert.deepEqual(a.r.differences, ["The picture shows 8 dominoes; I used 6", "The ramp is a little steeper than asked"], "(words-only builds keep their differences as they are)")
	const d = await build({ text: SIMPLE }, { imagine: IMAGINED, plan: planWith(), refine: REFINE }, { imagine: "always" })
	assert.deepEqual(d.steps, ["imagine", "plan", "refine"])
	assert.equal(d.log[1].payload.observation, null)
	assert.deepEqual(d.log[1].payload.images.map((i) => i.data), [JPEG])
	assert.equal(d.r.concept.how, "direct")
	assert.ok(d.events.some((e) => e.type === "step" && e.step === "observe" && e.state === "skipped" && /concept picture itself/.test(e.label)))
	const o = await build({ text: CHAIN }, { imagine: IMAGINED, plan: planWith(), refine: REFINE }, { imagine: "off" })
	assert.deepEqual(o.steps, ["plan", "refine"])
	assert.equal(o.r.concept, null)
	const photo = { dataUrl: "data:image/jpeg;base64,/9j/PHOTO", name: "my.jpg", width: 1200, height: 900 }
	const p = await build({ text: CHAIN, images: [photo] }, { imagine: IMAGINED, observe: OBSERVED, plan: planWith(), refine: REFINE }, { imagine: "always" })
	assert.deepEqual(p.steps.slice(0, 2), ["observe", "plan"], "the photo route, no concept")
	assert.ok(!p.steps.includes("imagine"))
	assert.equal(p.log[0].payload.images[0].data, photo.dataUrl)
	assert.equal(p.r.concept, null)
	assert.deepEqual(p.r.unsure, ["the ball might be a golf ball"], "(the user's own picture keeps its doubts)")
})

test("every failure point falls back to the words alone with ONE info line: the imagine step failing, no picture, the 75 s deadline, observe failing, the plan from the concept failing", async () => {
	const words = (log) => log.find((l) => l.step === "plan" && l.payload.text === CHAIN && !l.payload.images?.length && !l.payload.observation)
	// the imagine step fails (not tried again by the client: the server already tried every route twice), then the words
	const e1 = await build({ text: CHAIN }, { imagine: Object.assign(new Error("gateway down"), { status: 502, body: { error: "no concept picture: every route failed", retryable: true } }), plan: planWith(), refine: REFINE }, AUTO)
	assert.ok(words(e1.log), "planned from the words")
	assert.equal(e1.log.filter((l) => l.step === "imagine").length, 1, "one imagine request, never a second (a second pre-pass and image chain: ~$0.02–0.03, 11–20 s)")
	assert.equal(e1.r.concept, null)
	assert.equal(infoLines(e1.r).length, 1)
	assert.equal(infoLines(e1.r)[0].level, "info")
	assert.match(infoLines(e1.r)[0].text, /^No concept picture \(the AI service failed\): planned from your words alone$/)
	assert.ok(!e1.events.some((e) => e.type === "concept"))
	// an answer with no picture in it
	const e2 = await build({ text: CHAIN }, { imagine: { concepts: [], cast: [], story: [] }, plan: planWith(), refine: REFINE }, AUTO)
	assert.ok(words(e2.log))
	assert.match(infoLines(e2.r)[0].text, /^No concept picture \(none came back\)/)
	// past the client's deadline (75 s; 60 ms here): the call is stopped and the plan made from the words
	const slow = (p, n, signal) => new Promise((resolve) => setTimeout(() => resolve(IMAGINED), 2000))
	const t0 = Date.now()
	const e3 = await build({ text: CHAIN }, { imagine: slow, plan: planWith(), refine: REFINE }, AUTO, { imagineDeadlineMs: 60 })
	assert.ok(Date.now() - t0 < 1500, "it didn't wait for the picture")
	assert.ok(words(e3.log))
	assert.match(infoLines(e3.r)[0].text, /^No concept picture \(it took too long\)/)
	assert.equal(e3.r.concept, null)
	// observe fails: the concept shown is taken down again
	const e4 = await build({ text: CHAIN }, { imagine: IMAGINED, observe: Object.assign(new Error("bad"), { status: 400, body: { code: "bad_input", error: "bad" } }), plan: planWith(), refine: REFINE }, AUTO)
	assert.ok(words(e4.log))
	assert.equal(e4.r.concept, null)
	assert.equal(infoLines(e4.r).length, 1)
	assert.match(infoLines(e4.r)[0].text, /^The concept picture couldn't be read/)
	const shown = e4.events.findIndex((e) => e.type === "concept")
	const dropped = e4.events.findIndex((e) => e.type === "concept-dropped")
	assert.ok(shown >= 0 && dropped > shown, "shown, then taken down")
	assert.equal(e4.events[dropped].text, infoLines(e4.r)[0].text)
	// the plan from the concept fails (an empty plan): planned again from the words alone
	const plan = (p) => (p.images?.length ? { title: "x", items: [] } : planWith())
	const e5 = await build({ text: CHAIN }, { imagine: IMAGINED, observe: OBSERVED, plan, refine: REFINE }, AUTO)
	assert.deepEqual(e5.steps, ["imagine", "observe", "plan", "plan", "refine"])
	assert.ok(words(e5.log))
	assert.equal(e5.r.concept, null)
	assert.match(infoLines(e5.r)[0].text, /^The plan from the concept picture failed/)
	assert.deepEqual(e5.r.differences, ["The picture shows 8 dominoes; I used 6", "The ramp is a little steeper than asked"], "a words build after all: its lines are its own")
	// a refusal the person has to act on (today's allowance, sign in, no AI here) ends the build as such: no plan request after it (it would
	// be refused the same way: one more metered request for nothing)
	for (const [code, status, kind] of [["quota", 403, "quota"], ["sign_in", 401, "sign_in"], ["not_configured", 503, "off"]]) {
		const log = []
		const ai = createOrchestrator({ api: mockApi({ imagine: Object.assign(new Error("refused"), { status, body: { code, error: "refused", signIn: true, retryable: false } }), plan: planWith(), refine: REFINE }, log), progress: false })
		await assert.rejects(ai.build({ text: CHAIN }, { stageTune: false, imagine: "auto" }).result, (e) => e.kind === kind, code)
		assert.deepEqual(log.map((l) => l.step), ["imagine"], code)
	}
	// a cancel during the imagine step is a cancel, not a fallback
	const ctl = { aborted: false }
	const ai = createOrchestrator({ api: mockApi({ imagine: slow, plan: planWith(), refine: REFINE }), progress: false })
	const job = ai.build({ text: CHAIN }, { stageTune: false, imagine: "auto" })
	setTimeout(() => job.cancel(), 30)
	await assert.rejects(job.result, { name: "AbortError" })
})

test("edits and checks never make a concept, whatever the setting", async () => {
	const { solve } = await import("../solver.js")
	const base = solve(rube()).scene
	const e = await build({ text: CHAIN, mode: "edit", scene: base }, { imagine: IMAGINED, edit: { kind: "answer", patches: [], reply: "It's a chain of six dominoes." } }, { imagine: "always" })
	assert.deepEqual(e.steps, ["edit"])
	assert.equal(e.r.concept, null)
	const c = await build({ text: CHAIN, mode: "check", scene: base }, { imagine: IMAGINED, refine: REFINE }, { imagine: "always" })
	assert.ok(!c.steps.includes("imagine"))
	assert.equal(c.r.concept, null)
})
