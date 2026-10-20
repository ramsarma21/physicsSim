// Edit with AI on physics-module scenes (vfy-ai5, 20 Oct): a request for how much or how fast ("make the ball go twice as fast", "make it go fast
// enough to escape Earth") is its own outcome, never a pure "make it work" put back as "It already works … nothing changed"; a request for the
// run's end in lesson words ("stop it at the full moon", "run it for two hours") keeps the answer's run length and its goals as one set; a change
// of the scene's settings alone is a change ("Settings: gravity the Moon → Mars"), and a goal's words inside the lead keep their case. Every scene
// runs on the real engine; the edit step's answers are the model's as the verifier saw them (no model is called).
//   node --test web/ai/test/edit-own-outcome.test.mjs
import test from "node:test"
import assert from "node:assert/strict"
import { createOrchestrator, statesOutcome, ownOutcome, HOW_RE, asksRunLength, editLead, humanChangeList, describeDiff, settingLines } from "../orchestrator.js"
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
const apiOf = (answers, log = []) => async (path, body, signal) => {
	if (path === "/api/simulate") return simulate(body.scene, signal)
	if (path !== "/api/ai/edit") return { ok: false, error: "no AI here", code: "error", retryable: false }
	const n = log.push({ step: "edit", payload: body.payload })
	const a = answers[n - 1]
	if (!a) return { ok: false, error: "no AI here", code: "error", retryable: false }
	return { ok: true, result: { mode: "patch", targets: [], suggestions: [], missing: [], why: "x", ...JSON.parse(JSON.stringify(a)) }, model: "mock/edit", ms: 5, usage: null }
}
async function edit(scene, text, answer) {
	const log = []
	const r = await createOrchestrator({ api: apiOf([answer], log), progress: false }).build({ text, mode: "edit", scene, sim: await simulate(scene), history: [] }).result
	return { r, log }
}
const wall = (id, x) => ({ id, type: "wall", name: id, props: { invisible_in_3d: true }, x, y: 0 })
const scene = (o) => ({ version: 2, name: "probe", release: 0.5, ...o })

// Grade 6 speed (vfy-ai5 M3): a ball at about 1 m/s down a 5 m lane, a speed gate in the middle
const LANE = () =>
	scene({
		seconds: 7,
		items: [
			{ id: "table", type: "table", name: "Table", props: { width: 7 }, x: 1.3, y: 0 },
			{ id: "lane", type: "lane", name: "5 m lane", props: { length: 5, finish_at: 5, margin: 0.3 }, x: -1.2, y: 0.02 },
			{ id: "ball", type: "billiard-ball", name: "Ball", props: { number: 0, rolling: 0.001, start_speed: 1.02 }, x: -1.2286, y: 0.0491 },
			{ id: "gate", type: "speed-gate", name: "Speed gate", props: { beam_height: 0.029, face_cm: 25, watch: "ball" }, x: 1.3, y: 0.02 },
			{ id: "graph", type: "graph-board", name: "Distance-time graph", props: { width: 2, height: 0.9, t_max: 7, watch: "ball" }, x: 1.3, y: 0.5 },
			wall("wall-left", -2.17),
			wall("wall-right", 4.77)
		],
		goals: [
			{ kind: "reads", item: "gate", mps: 1, tol: 0.05, label: "The speed gate reads about 1 m/s" },
			{ kind: "crosses", item: "ball", x: 3.8, before_s: 6.3, label: "The ball reaches the 5 m finish line in about 5 s" }
		]
	})
// (vfy-ai5 R3-S2b) the ISS going round the Earth twice
const ORBIT = () =>
	scene({
		seconds: 19.5,
		items: [
			{ id: "table", type: "table", name: "Table", props: {}, x: 1.3, y: 0 },
			{ id: "earth", type: "planet", name: "Earth", props: { scale: "low-orbit" }, x: 1.3, y: 1.5 },
			{ id: "iss", type: "satellite", name: "International Space Station", props: { kind: "space-station", size: 0.04, primary: "earth" }, x: 1.979, y: 1.5 },
			wall("wall-left", -0.52),
			wall("wall-right", 3.12)
		],
		goals: [{ kind: "orbits", item: "iss", around: "earth", turns: 2, label: "The ISS goes around the Earth two times" }]
	})
// (vfy-ai5 R4-S6) the phases of the Moon over a month
const PHASES = () =>
	scene({
		seconds: 15,
		items: [
			{ id: "table", type: "table", name: "Table", props: {}, x: 1.3, y: 0 },
			{ id: "sun", type: "sun", name: "Sunlight", props: { pulls: false, scale: "earth-moon" }, x: -0.34, y: 1.5 },
			{ id: "earth", type: "planet", name: "Earth", props: { scale: "earth-moon" }, x: 1.61, y: 1.5 },
			{ id: "moon", type: "moon", name: "Moon", props: { scale: "earth-moon", primary: "earth" }, x: 0.33, y: 1.5 },
			wall("wall-left", -0.52),
			wall("wall-right", 3.12)
		],
		goals: [
			{ kind: "phase", item: "moon", name: "new moon", at_s: 0.5, label: "It starts as a new moon" },
			{ kind: "phase", item: "moon", name: "first quarter", any: true, label: "It reaches first quarter" },
			{ kind: "phase", item: "moon", name: "full moon", any: true, label: "It becomes a full moon" },
			{ kind: "phase", item: "moon", name: "last quarter", any: true, label: "It reaches last quarter" },
			{ kind: "orbits", item: "moon", around: "earth", turns: 1, label: "The Moon goes once round the Earth" }
		]
	})
// (vfy-ai5 S1) a bowling ball and a tennis ball dropped 2 m on the Moon, a stopwatch on each
const DROP = () =>
	scene({
		seconds: 3.5,
		settings: { gravity: "moon", air: false },
		items: [
			{ id: "table", type: "table", name: "Table", props: {}, x: 1.3, y: 0 },
			{ id: "bowling", type: "bowling-ball", name: "Bowling ball", props: {}, x: 1, y: 2.109 },
			{ id: "tennis", type: "tennis-ball", name: "Tennis ball", props: {}, x: 1.6, y: 2.0335 },
			{ id: "watch-bowling", type: "stopwatch", name: "Stopwatch (bowling ball)", props: { watch: "bowling", stop: "hits", face_cm: 30 }, x: 0.45, y: 1 },
			{ id: "watch-tennis", type: "stopwatch", name: "Stopwatch (tennis ball)", props: { watch: "tennis", stop: "hits", face_cm: 30 }, x: 2.15, y: 1 },
			wall("wall-left", -0.52),
			wall("wall-right", 3.12)
		],
		goals: [
			{ kind: "lands_together", a: "bowling", b: "tennis", tol_s: 0.02, label: "Both balls hit the ground at the same time" },
			{ kind: "reads", item: "watch-bowling", seconds: 1.57, tol: 0.05, label: "The bowling ball falls for about 1.57 s" },
			{ kind: "reads", item: "watch-tennis", seconds: 1.57, tol: 0.05, label: "The tennis ball also falls for about 1.57 s" }
		]
	})

test("words: how much or how fast is an outcome of its own; 'make it work' and plain changes are not; the run's end in lesson words asks for its length", () => {
	for (const t of ["Make the ball go twice as fast.", "Now make it go fast enough to escape Earth completely.", "Make it go too slow so it falls down to Earth.", "make the car roll three times as far", "Make the small gear turn at 120 rpm.", "make the ball go half as fast", "make the boat go faster"])
		assert.equal(ownOutcome(t), true, t)
	for (const t of ["make it work", "Make it work again so that ball 2 lands in the box", "fix it", "move the box 10 cm left", "swap the yellow ball for a tennis ball", "make the dominoes taller", "Make the room colder, 10 degrees."]) assert.equal(ownOutcome(t), false, t)
	// ("make the ball go …" still states an outcome: the edit may change the goals)
	assert.equal(statesOutcome("Make the ball go twice as fast."), true)
	assert.equal(HOW_RE.test("Move it twice"), false, "a move said twice is a place, not a speed")
	for (const t of ["Stop it at the full moon.", "Run it for two hours", "Watch for 40 minutes", "Make the run 30 minutes long", "Show it for a whole month", "Let it run until the ice melts", "make it run 8 s", "run it longer", "end it when the ball lands", "show it for one orbit"])
		assert.equal(asksRunLength(t), true, t)
	for (const t of ["swap it for a tennis ball", "move the box 10 cm left", "make the ball heavier", "Do the same drop on Mars instead."]) assert.equal(asksRunLength(t), false, t)
})

test("'Make the ball go twice as fast': the answer's 2 m/s and its goals are taken and judged (never 'It already works … nothing changed', never put back)", async () => {
	const { r } = await edit(LANE(), "Make the ball go twice as fast.", {
		kind: "change",
		reply: "Doubled the ball's start speed to about 2 m/s.",
		targets: [{ says: "the ball", ids: ["ball"] }],
		patches: [
			{ op: "set_props", id: "ball", props: { start_speed: 2.06 } },
			{ op: "set_goals", goals: [{ kind: "reads", item: "gate", mps: 2, tol: 0.1, label: "The speed gate reads about 2 m/s" }, { kind: "crosses", item: "ball", x: 3.8, before_s: 3.6, label: "The ball reaches the 5 m finish line in about 2.5 s" }] }
		]
	})
	assert.notEqual(r.replyOnly, true, r.reply)
	assert.doesNotMatch(String(r.lead ?? r.reply), /already works|nothing changed|couldn.t make it work/i)
	assert.equal(r.scene.items.find((i) => i.id === "ball").props.start_speed, 2.06)
	assert.deepEqual(r.scene.goals.map((g) => g.label), ["The speed gate reads about 2 m/s", "The ball reaches the 5 m finish line in about 2.5 s"])
	assert.deepEqual(r.targets.map((t) => t.ok), [true, true])
	assert.match(r.lead, /^Done — both goals happen ✓/)
})

test("'Make it go fast enough to escape Earth completely': the faster launch and its escapes goal stay", async () => {
	const { r } = await edit(ORBIT(), "Make it go fast enough to escape Earth completely.", {
		kind: "change",
		reply: "Launched it at 1.5 times orbit speed, past escape speed.",
		targets: [{ says: "it", ids: ["iss"] }],
		patches: [{ op: "set_props", id: "iss", props: { orbit_factor: 1.5 } }, { op: "set_goals", goals: [{ kind: "escapes", item: "iss", label: "The ISS escapes Earth's gravity" }] }]
	})
	assert.notEqual(r.replyOnly, true, r.reply)
	assert.equal(r.scene.items.find((i) => i.id === "iss").props.orbit_factor, 1.5)
	assert.deepEqual(r.scene.goals.map((g) => g.kind), ["escapes"])
	assert.match(r.lead, /^Done — the ISS escapes Earth's gravity ✓/)
})

test("'Stop it at the full moon': the answer's 7.5 s run and its three goals as one set; the change lines say each goal it dropped", async () => {
	const { r } = await edit(PHASES(), "Stop it at the full moon.", {
		kind: "change",
		reply: "It now stops at the full moon.",
		targets: [{ says: "it", ids: ["moon"] }],
		patches: [
			{ op: "set_scene", seconds: 7.5 },
			{ op: "set_goals", goals: [{ kind: "phase", item: "moon", name: "new moon", at_s: 0.5, label: "It starts as a new moon" }, { kind: "phase", item: "moon", name: "first quarter", any: true, label: "It reaches first quarter" }, { kind: "phase", item: "moon", name: "full moon", label: "It ends as a full moon" }] }
		]
	})
	assert.equal(r.scene.seconds, 7.5)
	assert.deepEqual(r.scene.goals.map((g) => g.label), ["It starts as a new moon", "It reaches first quarter", "It ends as a full moon"])
	assert.deepEqual(r.targets.map((t) => t.ok), [true, true, true])
	const lines = describeDiff(PHASES(), r.scene)
	assert.ok(lines.includes("Goal dropped: It reaches last quarter"), lines.join(" | "))
	assert.ok(lines.includes("Goal dropped: The Moon goes once round the Earth"), lines.join(" | "))
})

test("a change of the scene's settings alone is a change ('Do the same drop on Mars instead'), and a goal's words keep their case inside the lead", async () => {
	const { r } = await edit(DROP(), "Do the same drop on Mars instead.", {
		kind: "change",
		reply: "Moved it to Mars.",
		patches: [
			{ op: "set_scene", settings: { gravity: "mars" } },
			{ op: "set_goals", goals: [{ kind: "lands_together", a: "bowling", b: "tennis", tol_s: 0.02, label: "Both balls hit the ground at the same time" }, { kind: "reads", item: "watch-bowling", seconds: 1.04, tol: 0.05, label: "The bowling ball falls for about 1.04 s" }, { kind: "reads", item: "watch-tennis", seconds: 1.04, tol: 0.05, label: "The tennis ball also falls for about 1.04 s" }] }
		]
	})
	assert.equal(r.scene.settings.gravity, "mars")
	assert.doesNotMatch(r.lead, /already how it is|nothing needed changing/i)
	assert.match(r.lead, /^Done — all 3 goals happen ✓/)
	const said = humanChangeList(DROP(), r.scene).map((c) => c.text)
	assert.ok(said.some((t) => /gravity/i.test(t) && /Mars/.test(t)), said.join(" | "))
	// (a settings change that breaks a goal: "Done, but now the hammer …", never "Nothing needed changing" nor "now The …")
	const lead = editLead({ changes: ["changed gravity the Moon → Earth"], targets: [{ label: "The hammer and the feather hit the ground together", ok: false, was: true, happened: "The hammer and the feather hit the ground together: no" }] })
	assert.equal(lead, "Done, but now the hammer and the feather hit the ground together: no ✗.")
	assert.equal(editLead({ changes: [], targets: [{ label: "The small cube is all melted within an hour", ok: false, was: true, happened: "The small cube is all melted within an hour: no (melted at 1 h 38 min of lesson time)" }] }), "Nothing needed changing for that — now the small cube is all melted within an hour: no (melted at 1 h 38 min of lesson time) ✗.")
	assert.match(editLead({ changes: ["x"], targets: [{ label: "Ball 2 lands in the box", ok: false, was: true, happened: "Ball 2 hits the side of the box" }] }), /now Ball 2 hits the side/, "a name keeps its capital")
	// (a setting written out as its standard is no change: "Do it on Mars instead" answered with air: true said "the air (standard → on)")
	assert.deepEqual(settingLines({ settings: {} }, { settings: { gravity: "mars", air: true, air_density: 0.02 } }).filter((t) => /^changed the air\b/.test(t)), [])
	assert.deepEqual(settingLines({ settings: { room_temp: 20, gravity: "earth" } }, { settings: {} }), [])
})
