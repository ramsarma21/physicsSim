// The AI layer with the space module's plug-ins (web/sim/modules/space.js): goal checks (ai/goals.mjs through the registry), change lines,
// the edit's reading of the person's choices (keyWords), and the make-it-work search after an edit that stops an orbit, with the AI's answer
// mocked and the real engine (node --test web/ai/test/space.test.mjs).
import test from "node:test"
import assert from "node:assert/strict"
import { createOrchestrator, describeDiff, choicesOf } from "../orchestrator.js"
import { prepare, finish } from "../../sim/index.js"
import { handle } from "../../sim/engine-worker.js"
import { checkGoals } from "../../../ai/goals.mjs"
import * as plugins from "../../sim/plugins.js"

const simulate = async (scene, signal) => {
	if (signal?.aborted) throw Object.assign(new Error("Cancelled"), { name: "AbortError" })
	const { scene: s, doc, resolved } = prepare(scene)
	const msg = handle({ id: 1, doc, rate: 120 })
	if (msg.error !== undefined) throw new Error(msg.error)
	const meta = finish(s, doc, resolved, msg.track)
	return { key: "k", ms: msg.ms, track: msg.track, doc: meta.doc, summary: meta.summary, warnings: meta.warnings, resolved }
}
const mockApi = (patches, reply = "Done.") => async (path, body, signal) =>
	path === "/api/simulate" ? simulate(body.scene, signal) : { ok: true, result: { mode: "patch", reply, patches, suggestions: [] }, model: "mock", ms: 1 }
const STAGE = { x0: -0.6, x1: 3.4, y0: -0.2, y1: 3.0 }
const earthMoon = () => ({
	version: 2, id: "em", name: "Earth and Moon", seconds: 14.5, release: 0.5, stage: STAGE,
	items: [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }, { id: "earth", type: "planet", name: "Earth", x: 1.3, y: 1.45, props: {} }, { id: "moon", type: "moon", name: "Moon", x: 2.58133, y: 1.45, props: { primary: "earth" } }],
	goals: [{ kind: "orbits", item: "moon", around: "earth", label: "The Moon circles Earth once" }]
})

test("the AI's goal check of the module's kinds agrees with the run's summary", async () => {
	const scene = earthMoon()
	scene.items.push({ id: "sun", type: "sun", x: -0.35, y: 1.45, props: { pulls: false } })
	const goals = [
		{ kind: "orbits", item: "moon", around: "earth" },
		{ kind: "phase", item: "moon", name: "full moon", any: true },
		{ kind: "escapes", item: "moon" },
		{ kind: "falls_in", item: "moon" }
	]
	const sim = await simulate({ ...scene, goals })
	const mine = checkGoals(goals, { doc: sim.doc, track: sim.track, summary: sim.summary, scene })
	assert.deepEqual(mine.map((g) => g.ok), [true, true, false, false])
	assert.deepEqual(sim.summary.goals.map((g) => g.ok), [true, true, false, false])
})

test("change lines say the module's settings in real terms", () => {
	const a = earthMoon()
	const b = earthMoon()
	b.items[2].props.orbit_factor = 1.2
	b.items[1].props.body = "mars"
	const lines = describeDiff(a, b)
	assert.ok(lines.some((l) => l.includes("launch speed 1 → 1.2× orbit speed (an ellipse that swings out farther)")), lines.join(" | "))
	assert.ok(lines.some((l) => l.includes("Earth → Mars")), lines.join(" | "))
})

test("the person's own choice of a module setting is read from their words (keyWords), decimals included", () => {
	const scene = earthMoon()
	const r1 = choicesOf("Make the Earth half as heavy.", new Map([["earth", new Set(["mass_scale"])]]), scene, new Set(["earth"]))
	assert.deepEqual([...(r1.hard.get("earth") ?? [])], ["mass_scale"])
	const r2 = choicesOf("Launch the Moon at 0.8 times orbit speed.", new Map([["moon", new Set(["orbit_factor"])]]), scene, new Set(["moon"]))
	assert.deepEqual([...(r2.hard.get("moon") ?? [])], ["orbit_factor"])
	assert.equal(plugins.keyWords("planet", "mass_scale")?.includes("heav"), true)
})

test("an edit that stops the orbit: said honestly, and the fix search finds a checked fix with the module's knob that keeps the change", async () => {
	const scene = earthMoon()
	const ai = createOrchestrator({ api: mockApi([{ op: "set_props", id: "earth", props: { mass_scale: 0.5 } }], "I made the Earth half as heavy.") })
	const r = await ai.build({ text: "Make the Earth half as heavy.", mode: "edit", scene, sim: await simulate(scene) }).result
	assert.equal(r.scene.items.find((i) => i.id === "earth").props.mass_scale, 0.5)
	assert.equal(r.goals?.[0]?.ok, false)
	assert.ok(r.fixNeeded && r.fixCtx, "the panel is asked to look for a fix")
	const fr = await ai.findFix(r.fixCtx, { budgetMs: 30000, minRuns: 60, hardMs: 120000 })
	assert.equal(fr.status, "found")
	assert.ok(fr.fix.changes.every((c) => !(c.id === "earth" && c.key === "mass_scale")), JSON.stringify(fr.fix.changes))
	const again = await simulate(fr.fix.scene)
	assert.ok(again.summary.goals.every((g) => g.ok), JSON.stringify(again.summary.goals))
	assert.equal(fr.fix.scene.items.find((i) => i.id === "earth").props.mass_scale, 0.5)
})

test("the module's plug-ins are registered: goal kinds, knobs, prompt lines, the digest's how-to", () => {
	for (const k of ["orbits", "falls_in", "escapes", "lands_together", "lands_first", "phase", "shadow_length"]) assert.equal(plugins.goalKind(k)?.kind, k)
	assert.ok(plugins.knobsFor("moon").some((k) => k.key === "orbit_factor"))
	assert.ok(plugins.knobsFor("gnomon").some((k) => k.key === "hour"))
	assert.match(plugins.promptSnippets("plan"), /settings\.gravity/)
	assert.match(plugins.howtoText(), /ORBIT MODE/)
	assert.match(plugins.howtoText(), /SHADOWS/)
})

// ---------------------------------------------------------------- (2026-10-20) the classroom models, eclipses and seasons
const TABLE_STAGE = { x0: -0.4, x1: 2.6, y0: -0.2, y1: 1.4 }
const hasLamp = () => plugins.modules().length > 0 && (prepare({ version: 2, id: "t", stage: TABLE_STAGE, items: [{ id: "lamp", type: "lamp", x: 0.2, y: 0 }] }).doc.solids.length > 0)
const classroom = (ball = {}, goals = []) => ({
	version: 2, id: "classroom", name: "Moon phases model", seconds: 12.5, release: 0.5, stage: TABLE_STAGE,
	items: [
		{ id: "table", type: "table", x: 1.3, y: 0, props: {} },
		{ id: "lamp", type: "lamp", name: "Lamp", x: 0.15, y: 0, props: { target: "globe" } },
		{ id: "globe", type: "globe", name: "Globe", x: 1.4, y: 0, props: { spin_rpm: 6, start_hour: 6 } },
		{ id: "ball", type: "moon-ball", name: "Moon ball", x: 1.4, y: 0.4, props: { around: "globe", period_s: 12, ...ball } }
	],
	goals
})

test("the AI's checks of day_night, eclipse and noon_sun agree with the run's summary", { skip: !hasLamp() && "no desk lamp in this catalog" }, async () => {
	const goals = [
		{ kind: "day_night", item: "globe", days: 1 },
		{ kind: "day_night", item: "globe", is: "night", at_s: 8 },
		{ kind: "eclipse", type: "lunar", item: "ball", none: true },
		{ kind: "eclipse", type: "solar", item: "ball" },
		{ kind: "phase", item: "ball", name: "full moon", any: true },
		{ kind: "noon_sun", item: "globe", deg: 59.73, tol: 2 }
	]
	const scene = classroom({}, goals)
	const sim = await simulate(scene)
	const mine = checkGoals(goals, { doc: sim.doc, track: sim.track, summary: sim.summary, scene })
	assert.deepEqual(mine.map((g) => g.ok), sim.summary.goals.map((g) => g.ok))
	assert.deepEqual(sim.summary.goals.map((g) => g.ok), [true, true, true, false, true, true], JSON.stringify(sim.summary.goals))
	// level, the ball is eclipsed at full and shades the globe at new
	const level = await simulate(classroom({ tilt_deg: 0 }, [{ kind: "eclipse", type: "lunar", item: "ball", total: true }, { kind: "solar_eclipse", item: "ball" }]))
	assert.deepEqual(level.summary.goals.map((g) => g.ok), [true, true], JSON.stringify(level.summary.goals))
})

test("change lines say the classroom models' settings in real terms", () => {
	const a = classroom()
	const b = classroom({ start_deg: 180, tilt_deg: 0 })
	b.items[2].props.lean = "toward the light"
	b.items[2].props.start_hour = 12
	const lines = describeDiff(a, b)
	for (const want of ["starts 0° → 180° round from the light (new moon → full moon)", "circle tilt 30° → 0° (level: eclipses at full and new)", "north pole leans toward the camera → toward the light", "town's clock at the start 6:00 → 12:00 (solar time)"])
		assert.ok(lines.some((l) => l.includes(want)), `${want} | ${lines.join(" | ")}`)
})

test("the person's own choice of a classroom setting is read from their words", () => {
	const scene = classroom()
	// ("faster" with no amount: a way the person chose, which no fix turns back; with an amount, the setting itself)
	const r1 = choicesOf("Spin the globe faster.", new Map([["globe", new Set(["spin_rpm"])]]), scene, new Set(["globe"]))
	assert.deepEqual([...(r1.forward?.get("globe") ?? [])], ["spin_rpm"], JSON.stringify({ hard: [...(r1.hard.get("globe") ?? [])], forward: [...(r1.forward?.get("globe") ?? [])] }))
	const r0 = choicesOf("Spin the globe twice as fast.", new Map([["globe", new Set(["spin_rpm"])]]), scene, new Set(["globe"]))
	assert.deepEqual([...(r0.hard.get("globe") ?? [])], ["spin_rpm"])
	// ("20 seconds a month": the words name the trip (the module's words for period_s); seconds are no amount the edit's reader counts, so it is
	// a way chosen, kept from going back)
	const r2 = choicesOf("Carry the moon ball round in 20 seconds a month.", new Map([["ball", new Set(["period_s"])]]), scene, new Set(["ball"]))
	assert.deepEqual([...(r2.hard.get("ball") ?? []), ...(r2.forward?.get("ball") ?? [])], ["period_s"])
})

test("an edit that moves the full moon: said honestly, and the fix search turns the ball's start (a module knob), keeping the change", { skip: !hasLamp() && "no desk lamp in this catalog" }, async () => {
	const scene = classroom({}, [{ kind: "phase", item: "ball", name: "full moon", at_s: 6, label: "Full moon at 6 s" }])
	scene.seconds = 7
	const before = await simulate(scene)
	assert.equal(before.summary.goals[0].ok, true, JSON.stringify(before.summary.goals))
	const ai = createOrchestrator({ api: mockApi([{ op: "set_props", id: "ball", props: { period_s: 20 } }], "The ball now takes 20 seconds to go round.") })
	const r = await ai.build({ text: "Carry the moon ball round in 20 seconds a month.", mode: "edit", scene, sim: before }).result
	assert.equal(r.scene.items.find((i) => i.id === "ball").props.period_s, 20)
	assert.equal(r.goals?.[0]?.ok, false)
	assert.ok(r.fixNeeded && r.fixCtx, "the panel is asked to look for a fix")
	const fr = await ai.findFix(r.fixCtx, { budgetMs: 30000, minRuns: 40, hardMs: 120000 })
	assert.equal(fr.status, "found", JSON.stringify(fr).slice(0, 400))
	assert.equal(fr.fix.scene.items.find((i) => i.id === "ball").props.period_s, 20)
	assert.ok(fr.fix.changes.some((c) => c.id === "ball" && c.key === "start_deg"), JSON.stringify(fr.fix.changes))
	const again = await simulate(fr.fix.scene)
	assert.ok(again.summary.goals.every((g) => g.ok), JSON.stringify(again.summary.goals))
})

test("the real Moon's eclipses: the line of nodes, and the digest says what happened", async () => {
	const scene = {
		version: 2, id: "ecl", name: "Eclipse", seconds: 3, release: 0.5, stage: STAGE,
		items: [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }, { id: "sun", type: "sun", x: -0.45, y: 1.45, props: { pulls: false } },
			{ id: "earth", type: "planet", x: 1.6, y: 1.45, props: {} }, { id: "moon", type: "moon", x: 2.88133, y: 1.45, props: { primary: "earth", node_deg: 0 } }],
		goals: [{ kind: "eclipse", type: "lunar", item: "moon", total: true }]
	}
	const sim = await simulate(scene)
	assert.equal(sim.summary.goals[0].ok, true)
	const lines = plugins.digestLines({ id: "moon", type: "moon" }, { doc: sim.doc, track: sim.track })
	assert.ok(lines.some((l) => /a total lunar eclipse/.test(l) && /orbit tilted 5\.145°/.test(l)), lines.join(" | "))
	scene.items[3].props.node_deg = 90
	const none = await simulate(scene)
	assert.equal(none.summary.goals[0].ok, false)
	assert.ok(plugins.knobsFor("moon").some((k) => k.key === "node_deg"))
})

test("the new goal kinds, knobs and prompt lines are registered", () => {
	for (const k of ["day_night", "eclipse", "solar_eclipse", "lunar_eclipse", "noon_sun", "night_sky"]) assert.equal(plugins.goalKind(k)?.kind, k)
	for (const [type, key] of [["globe", "start_hour"], ["globe", "lean"], ["moon-ball", "start_deg"], ["moon-ball", "tilt_deg"], ["moon", "node_deg"], ["planet", "start_date"]])
		assert.ok(plugins.knobsFor(type).some((k) => k.key === key), `${type}.${key}`)
	assert.match(plugins.promptSnippets("plan"), /day_night/)
	assert.match(plugins.howtoText(), /CLASSROOM SUN-EARTH-MOON/)
	assert.notEqual(plugins.goalProblem({ kind: "eclipse", type: "lunar" }, new Set(["moon"])), null, "an eclipse goal names its moon")
	assert.equal(plugins.goalProblem({ kind: "eclipse", type: "lunar", item: "moon" }, new Set(["moon"])), null)
	assert.equal(plugins.heldByModule("moon-ball", ["globe", "lamp"]), true)
})

test("the classroom goals' aims: the fix search's first tries, worked out from the run", { skip: !hasLamp() && "no desk lamp in this catalog" }, async () => {
	// a day at the town at 4 s, broken by spinning it twice as fast (at 4 s it is 1:12 there): the aim puts its noon at 4 s (start_hour
	// 12 − 24·12·4/60 = −7.2 → 16.75)
	const scene = {
		version: 2, id: "gd", name: "Globe", seconds: 6, release: 0.5, stage: TABLE_STAGE,
		items: [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }, { id: "lamp", type: "lamp", x: 0.25, y: 0, props: { target: "globe" } },
			{ id: "globe", type: "globe", name: "Globe", x: 1.3, y: 0, props: { spin_rpm: 6, start_hour: 6 } }],
		goals: [{ kind: "day_night", item: "globe", is: "day", at_s: 4, label: "Day at the town at 4 s" }]
	}
	const before = await simulate(scene)
	assert.equal(before.summary.goals[0].ok, true)
	const ai = createOrchestrator({ api: mockApi([{ op: "set_props", id: "globe", props: { spin_rpm: 12 } }], "The globe now turns 12 times a minute.") })
	const r = await ai.build({ text: "Spin the globe at 12 turns a minute.", mode: "edit", scene, sim: before }).result
	assert.equal(r.goals?.[0]?.ok, false, JSON.stringify(r.goals))
	const fr = await ai.findFix(r.fixCtx, { budgetMs: 20000, minRuns: 10, hardMs: 60000 })
	assert.equal(fr.status, "found", JSON.stringify(fr).slice(0, 300))
	assert.equal(fr.fix.scene.items.find((i) => i.id === "globe").props.spin_rpm, 12)
	assert.ok(fr.fix.changes.some((c) => c.id === "globe" && c.key === "start_hour"), JSON.stringify(fr.fix.changes))
	const again = await simulate(fr.fix.scene)
	assert.ok(again.summary.goals.every((g) => g.ok), JSON.stringify(again.summary.goals))
	// noon_sun: the latitude where the noon light is that high
	const spec = plugins.goalKind("noon_sun")
	const sim = await simulate({ ...scene, goals: [{ kind: "noon_sun", item: "globe", deg: 80 }] })
	const aim = spec.aim({ kind: "noon_sun", item: "globe", deg: 80 }, sim.summary.goals[0], scene, sim)
	const dec = sim.track.state.globe.sun_lat.at(-1)
	assert.ok(aim.length === 1 && Math.abs(90 - Math.abs(aim[0].changes[0].to - dec) - 80) < 0.01, JSON.stringify(aim))
})
