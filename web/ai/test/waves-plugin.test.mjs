// The sound and waves module's AI plug-ins (web/sim/modules/waves.js `plugin`, registered by web/sim/modules/index.js): its goal kinds (their
// spellings, field checks, the AI's own goal check on real runs), knobs, how-to, prompt lines and worked requests, the catalog digest's part, a plan
// built from a lesson request (validated, solved, run: its goals met), the edit digest's lines, its change words, the tones derived for the audio, and
// a make-it-work search that finds a fix with the module's knobs.
//   node --test web/ai/test/waves-plugin.test.mjs
import assert from "node:assert/strict"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const PG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
process.env.PLAYGROUND_MODULES = process.env.PLAYGROUND_MODULES ?? "waves,circuits"
const sim = await import(pathToFileURL(join(PG, "web/sim/index.js")).href)
const plugins = await import(pathToFileURL(join(PG, "web/sim/plugins.js")).href)
const waves = await import(pathToFileURL(join(PG, "web/sim/modules/waves.js")).href)
const { solve } = await import(pathToFileURL(join(PG, "web/ai/solver.js")).href)
const { findFix } = await import(pathToFileURL(join(PG, "web/ai/fixer.js")).href)
const { checkGoals } = await import(pathToFileURL(join(PG, "ai/goals.mjs")).href)
const { validatePlan } = await import(pathToFileURL(join(PG, "ai/schemas.mjs")).href)
const { digestFromCatalog } = await import(pathToFileURL(join(PG, "ai/catalog-digest.mjs")).href)
const bundle = await import(pathToFileURL(join(PG, "web/sim/engine-worker.js")).href)
const mod = plugins.modules().find((m) => m.name === "mod_waves")

const run = (scene) => {
	const p = sim.prepare(scene)
	const track = JSON.parse(JSON.stringify(bundle.run(p.doc, 120)))
	const fin = sim.finish(p.scene, p.doc, p.resolved, track)
	return { scene: p.scene, doc: p.doc, track, summary: fin.summary, resolved: p.resolved }
}
const STAGE = { x0: -0.56, x1: 3.19, y0: -0.16, y1: 2.34 }
const scene = (items, goals = [], seconds = 3) => ({ version: 2, id: "t", name: "t", seconds, release: 0.2, stage: STAGE, items: [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }, ...items], goals })

test("the module is registered with its goal kinds, knobs, how-to, prompt lines and worked requests", () => {
	assert.ok(mod, "mod_waves is in the registry")
	assert.deepEqual(mod.goals.map((g) => g.kind).sort(), ["echo", "hears", "higher", "jumps", "louder", "period", "reflects", "sounds", "standing", "stays_put", "trace", "wave_reaches", "wave_speed", "wavelength"])
	for (const g of mod.goals) assert.ok(g.about && g.fields && typeof g.summarize === "function" && typeof g.sample === "function", g.kind)
	for (const t of ["plucked-ruler", "monochord", "rubber-band", "xylophone-bar", "drum", "tuning-fork", "speaker", "sound-meter", "wave-rope", "slinky", "ripple-tank", "bell-jar"])
		assert.ok(plugins.knobsFor(t).length > 0, `knobs for ${t}`)
	for (const k of mod.knobs) assert.ok(k.why && k.more && k.less, `${k.type}.${k.key}`)
	// every knob turns a real prop of its type
	const types = Object.fromEntries(sim.catalog().types.map((t) => [t.key, t]))
	for (const k of mod.knobs) assert.ok(types[k.type]?.props.some((p) => p.key === k.key), `${k.type} has a prop ${k.key}`)
	assert.match(mod.howto, /LISTENER/)
	assert.match(mod.howto, /6 dB per doubling/)
	assert.match(plugins.promptSnippets("plan"), /Sound and waves/)
	assert.match(plugins.promptSnippets("edit"), /overhang/)
	assert.match(plugins.goalKindLines(), /sounds \{source, pitch_hz\?/)
	assert.equal(plugins.goalKind("rings")?.kind, "sounds", "an alias")
	assert.equal(plugins.goalKind("swings")?.kind, "period", "an alias")
	assert.equal(plugins.goalKind("wave_arrives")?.kind, "wave_reaches", "an alias")
	assert.ok(mod.examples.length >= 11 && mod.examples.every((e) => e.ask && e.how), "one worked request per lesson demo (W1-W11), each with how")
})

test("a plan's sound goals are checked by their fields", () => {
	const ids = new Set(["fork", "meter", "rope"])
	assert.equal(plugins.goalProblem({ kind: "sounds", source: "fork", pitch_hz: 440 }, ids), null)
	assert.equal(plugins.goalProblem({ kind: "hears", meter: "meter", source: "fork" }, ids), null)
	assert.match(plugins.goalProblem({ kind: "hears", meter: "meter" }, ids), /needs source/)
	assert.match(plugins.goalProblem({ kind: "echo", meter: "nobody" }, ids), /no item "nobody"/)
	assert.match(plugins.goalProblem({ kind: "sounds", source: "fork", pitch_hz: "high" }, ids), /must be a number/)
	assert.equal(plugins.goalProblem({ kind: "reflects", item: "rope", way: "upside down" }, ids), null)
})

test("the catalog digest describes every waves type, its readings and the module's how-to, goals and knobs", () => {
	const d = digestFromCatalog(sim.catalog())
	for (const k of ["tuning-fork", "plucked-ruler", "drum", "monochord", "rubber-band", "xylophone-bar", "glass-bottle", "rice", "speaker", "clapper", "bell-jar", "sound-meter", "hydrophone", "oscilloscope", "sound-panel", "wave-rope", "slinky", "ripple-tank"])
		assert.match(d.text, new RegExp(`### ${k} — `), k)
	assert.match(d.text, /Readings \(the run reports them[^\n]*sounding \(Sound 1 m away, dB\)/)
	assert.match(d.text, /### Sound and waves\nSound comes from something vibrating/)
	assert.match(d.text, /knob plucked-ruler\.overhang: the ruler's pitch goes as 1 ÷ overhang²/)
	assert.match(d.text, /e\.g\. "A shorter ruler makes a higher sound"/)
})

test("a lesson plan (drum, rice, meter) is valid, solves with the rice on the drum's head, and meets its goals in the engine", () => {
	const plan = {
		title: "Harder hit, higher jump", seconds: 3, notes: "", missing: [], tune: [],
		items: [
			{ id: "soft", type: "drum", props: { strength: 0.5, strike_at: 0.6 }, place: { on: "table", x: 0.6 } },
			{ id: "hard", type: "drum", props: { strength: 1.5, strike_at: 1.6 }, place: { on: "table", x: 2.0 } },
			{ id: "r1", type: "rice", props: { count: 6 }, place: { on: "soft" } },
			{ id: "r2", type: "rice", props: { count: 6 }, place: { on: "hard" } },
			{ id: "m", type: "sound-meter", place: { on: "table", x: 1.3 } }
		],
		goals: [
			{ kind: "louder", a: "hard", b: "soft", at: "m", label: "the hard hit is louder" },
			{ kind: "jumps", item: "r2", min_m: 0.01, label: "the rice on the hard drum jumps a centimetre" },
			{ kind: "hears", meter: "m", source: "soft", label: "the meter hears the soft drum" }
		]
	}
	const cat = digestFromCatalog(sim.catalog()).index
	const v = validatePlan(plan, { catalog: cat })
	assert.ok(v.ok, JSON.stringify(v.errors))
	const s = solve(v.value ?? plan)
	const sc = s.scene ?? s
	const r1 = sc.items.find((i) => i.id === "r1")
	const soft = sc.items.find((i) => i.id === "soft")
	assert.ok(Math.abs(r1.x - soft.x) < 0.02 && Math.abs(r1.y - 0.16) < 0.003, `rice on the head: ${JSON.stringify([r1.x, r1.y, soft.x])}`)
	const R = run({ ...sc, goals: plan.goals })
	assert.ok(R.summary.goals.every((g) => g.ok), JSON.stringify(R.summary.goals))
	// the AI's own check of the goals on the run agrees with the summary
	const chk = checkGoals(plan.goals, { doc: R.doc, track: R.track, scene: R.scene })
	assert.deepEqual(chk.map((c) => c.ok), [true, true, true], JSON.stringify(chk))
})

test("a plucked ruler clamps itself to the table's edge, wherever the plan puts it", () => {
	const R = run(scene([{ id: "r", type: "plucked-ruler", x: 1.0, y: 0.2, props: { overhang: 0.1 } }, { id: "l", type: "plucked-ruler", x: 2.0, y: 0, props: { edge: "left" } }]))
	const ruler = R.doc.solids.find((s) => s.id === "r/ruler")
	const left = R.doc.solids.find((s) => s.id === "l/ruler")
	assert.equal(ruler.at.x, 3.15 + 0.1 - 0.15)
	assert.equal(left.at.x, -0.55 - (0.15 - 0.15))
	assert.equal(R.track.state.r.pitch.at(-1), 79.46114)
})

test("the edit digest's lines: a source's pitch and loudness, a meter's readings, a rope's wave, a tank's floater, a pendulum's period", () => {
	const R = run(
		scene(
			[
				{ id: "fork", type: "tuning-fork", x: 0.2, y: 0 },
				{ id: "m", type: "sound-meter", x: 1.2, y: 0 },
				{ id: "wall", type: "wall", x: 2.5, y: 0 },
				{ id: "rope", type: "wave-rope", x: -0.4, y: 0, props: { length: 3 } },
				{ id: "p", type: "pendulum", x: 2.0, y: 1.2 }
			],
			[],
			3
		)
	)
	const lines = (id) => plugins.digestLines(R.scene.items.find((i) => i.id === id), R, { nameOf: (x) => x })
	assert.match(lines("fork").join(" | "), /pitch 440 Hz .* sounded 1 time, first at 0\.5 s, loudest 55 dB 1 m away/)
	assert.match(lines("m").join(" | "), /loudest [\d.]+ dB .* first heard a sound at 0\.50\d s .* an echo arrived [\d.]+ ms after the first sound .* hears fork: arrived at 0\.50\d+ s/)
	assert.match(lines("rope").join(" | "), /wave speed 10 m\/s.* reached the far end at .* came back upside down/)
	assert.match(lines("p").join(" | "), /swings once every 1\.\d+ s/)
})

test("an oscilloscope listens like a meter and its edit-digest line says its screen: waves across from the pitch, height from the pressure", () => {
	// a 440 Hz speaker (70 dB at 1 m) 0.5 m from the scope's microphone: about 76 dB there (−20·log10 0.5 = +6 dB), p = 20 µPa · 10^(76/20) · √2
	// ≈ 0.18 Pa at the peak: about 1.8 squares at 0.1 Pa a square; 1 ms a square → 440 × 10 × 0.001 = 4.4 waves across
	const R = run(
		scene(
			[
				{ id: "sp", type: "speaker", x: 0.5, y: 0, props: { pitch: 440, level: 70, on_at: 0.3, on_for: 1 } },
				{ id: "o", type: "oscilloscope", x: 0.79, y: 0, props: { mic_side: "right", mic_height: 0.2 } }
			],
			[{ kind: "hears", meter: "o", source: "sp" }],
			2
		)
	)
	assert.equal(R.summary.goals[0].ok, true, JSON.stringify(R.summary.goals))
	const line = plugins.digestLines(R.scene.items.find((i) => i.id === "o"), R, { nameOf: (x) => x }).join(" | ")
	assert.match(line, /hears sp: arrived at 0\.30\d+ s/)
	assert.match(line, /its screen shows 4\.4 waves across \(440 Hz at 1 ms a square\), at the loudest 1\.\d+ squares high from the middle line \(0\.1 Pa a square\)/)
	assert.equal(plugins.changeWords("oscilloscope", "x", 0.79, 1.79), "the oscilloscope moved 1 m right")
	assert.equal(plugins.changeWords("oscilloscope", "scale", "0.2 Pa a square", "0.1 Pa a square"), "0.2 → 0.1 Pa a square (the same sound drawn 2 × as tall)")
	assert.equal(plugins.changeWords("oscilloscope", "time_base", "1 ms a square", "2 ms a square"), "1 → 2 ms a square (2 × as many waves across)")
})

test("change words in real units", () => {
	assert.equal(plugins.changeWords("plucked-ruler", "overhang", 0.15, 0.1), "the ruler's overhang 15 → 10 cm (pitch 35 → 79 Hz)")
	assert.equal(plugins.changeWords("monochord", "length", 0.648, 0.324), "length 0.648 → 0.324 m (pitch 330 → 659 Hz)")
	assert.equal(plugins.changeWords("drum", "tension", 1000, 2000), "tension 1000 → 2000 N/m (pitch 157 → 222 Hz)")
	assert.equal(plugins.changeWords("drum", "strength", 0.5, 1), "struck 2 × as hard (+6 dB)")
	assert.equal(plugins.changeWords("wave-rope", "tension", 10, 40), "the rope's tension 10 → 40 N (wave speed +100 %)")
	assert.equal(plugins.changeWords("glass-bottle", "fill", 0.1, 0.7), "water 10 → 70 % full (pitch 1564 → 1406 Hz)")
	assert.equal(plugins.changeWords("ball", "diameter", 0.1, 0.2), null)
})

test("the tones for the video: every strike of every source at its time and pitch, heard at the meter after distance ÷ c", () => {
	const R = run(scene([{ id: "bar", type: "xylophone-bar", x: 0.3, y: 0, props: { hits: 2, every: 0.7 } }, { id: "m", type: "sound-meter", x: 1.3, y: 0 }], [], 2))
	const ev = waves.toneEvents(R.doc, R.track)
	assert.equal(ev.length, 2)
	assert.ok(ev.every((e, i) => Math.abs(e.t - (0.5 + 0.7 * i)) < 1e-9 && Math.abs(e.hz - 779.4454) < 1e-3 && e.delay > 0.0029 && e.delay < 0.0031), JSON.stringify(ev))
	// a vacuum: nothing heard
	const V = run({ ...scene([{ id: "bar", type: "xylophone-bar", x: 0.3, y: 0 }], [], 1), settings: { air: false } })
	assert.equal(waves.toneEvents(V.doc, V.track).length, 0)
})

test("make it work: a meter moved too far from the fork for its goal is fixed by striking the fork harder (the module's knob), checked", async () => {
	const s = scene(
		[
			{ id: "fork", type: "tuning-fork", x: -0.3, y: 0 },
			{ id: "far", type: "sound-meter", x: 2.7, y: 0 }
		],
		[{ kind: "hears", meter: "far", source: "fork", at_least_db: 44 }],
		3
	)
	const R = run(s)
	assert.equal(R.summary.goals[0].ok, false, "3 m away it reads under 44 dB")
	const simulate = async (sc) => run(sc)
	const fr = await findFix({ scene: R.scene, sim: R, goals: R.scene.goals, touched: new Map([["far", "all"]]) }, { simulate, budgetMs: 60000, maxRuns: 120, parallel: 1 })
	assert.equal(fr.status, "found", JSON.stringify({ status: fr.status, runs: fr.runs }))
	const words = JSON.stringify(fr.fix)
	assert.match(words, /strength|pitch|box/, words.slice(0, 600))
	const again = run(fr.fix.scene)
	assert.equal(again.summary.goals[0].ok, true)
})

test("the 20 Oct goal kinds: a standing wave's loops, a wave's length and speed, a duck and a ribbon that stay put, an oscilloscope's trace (summary == the AI's check)", () => {
	const goals = [
		{ kind: "standing", item: "rope", loops: 2 },
		{ kind: "standing", item: "rope", loops: 3, label: "three loops (it has two)" },
		{ kind: "wavelength", item: "rope", m: 4 },
		{ kind: "wave_speed", item: "rope", m_s: 10 },
		{ kind: "stays_put", item: "rope" },
		{ kind: "stays_put", item: "tank" },
		{ kind: "wavelength", item: "tank", m: 0.0643 },
		{ kind: "trace", oscilloscope: "o", waves_across: 4.4, squares_high: 1.8 },
		{ kind: "trace", item: "o", waves_across: 8.8, label: "twice the waves (it shows 4.4)" }
	]
	const R = run({
		version: 2, id: "w20", name: "w20", seconds: 6, release: 0.2, stage: { x0: -0.9, x1: 5.2, y0: -0.16, y1: 2.34 },
		items: [
			{ id: "table", type: "table", x: 2.1, y: 0, props: { width: 6 } },
			{ id: "rope", type: "wave-rope", x: -0.4, y: 0, props: { shake: "keep shaking", frequency: 2.5, amplitude: 0.015, ribbon: 0.3 } },
			{ id: "tank", type: "ripple-tank", x: 4.3, y: 0, angle: 90, props: { depth: 0.02 } },
			{ id: "sp", type: "speaker", x: 3.2, y: 0, props: { pitch: 440, level: 70, on_at: 0.3, on_for: 1 } },
			{ id: "o", type: "oscilloscope", x: 3.49, y: 0 }
		],
		goals
	})
	assert.deepEqual(R.summary.goals.map((g) => g.ok), [true, false, true, true, true, true, true, true, false], JSON.stringify(R.summary.goals))
	const chk = checkGoals(goals, { doc: R.doc, track: R.track, scene: R.scene })
	assert.deepEqual(chk.map((c) => c.ok), R.summary.goals.map((g) => g.ok), JSON.stringify(chk))
	// the run says what happened (the card's run sentence): the wave arrives, the loops form, the ribbon and the duck stay put
	const said = (R.summary.happenings ?? []).map((e) => e.text).join(" | ")
	assert.match(said, /the wave on rope reaches its far end .*2 standing loops form on rope/)
	assert.match(said, /the ribbon on rope bobs \d+ mm up and down and moves 0 mm along/)
	assert.match(said, /the duck on tank bobs [\d.]+ mm up and down but stays put/)
	// the goal kinds' field checks and the make-it-work aim for rice on a drum struck at the release
	assert.equal(plugins.goalProblem({ kind: "standing", item: "rope", loops: "two" }, new Set(["rope"])), "standing.loops must be a number")
	const aim = plugins.goalKind("jumps").aim({ kind: "jumps", item: "r" }, { ok: false }, { release: 0.5, items: [{ id: "d", type: "drum", props: { strike_at: 0.5 } }] })
	assert.deepEqual(aim, [{ changes: [{ kind: "prop", id: "d", key: "strike_at", from: 0.5, to: 0.8 }], cost: 0.5 }])
})

test("the edit digest says what a drum's level means at a meter, a band pulled past what it holds, and a rope's standing-wave tuning", () => {
	const R = run({
		version: 2, id: "w20d", name: "w20d", seconds: 2, release: 0.5, stage: { x0: -0.9, x1: 5.2, y0: -0.16, y1: 2.34 },
		items: [
			{ id: "table", type: "table", x: 2.1, y: 0, props: { width: 6 } },
			{ id: "drum", type: "drum", x: 0.3, y: 0, props: { strike_at: 0.5 } },
			{ id: "rice", type: "rice", x: 0.3, y: 0.16, props: { count: 4 } },
			{ id: "band", type: "rubber-band", x: 1.2, y: 0, props: { width: 1, tension: 30 } },
			{ id: "rope", type: "wave-rope", x: 1.6, y: 0, props: { length: 3, shake: "keep shaking", frequency: 2.5, amplitude: 0.08 } }
		],
		goals: []
	})
	const lines = (id) => plugins.digestLines(R.scene.items.find((i) => i.id === id), R, { nameOf: (x) => x }).join(" | ")
	assert.match(lines("drum"), /loudest [\d.]+ dB 1 m away at the strike's instant \(unweighted\): a sound-meter \(dB\(A\), fast\) 1 m away reads about \d+ dB/)
	assert.match(lines("drum"), /struck at 0\.5 s, when the scene lets things go \(0\.5 s\) or before/)
	// (30 N asked: the prop's own range stops at 20 N)
	assert.match(lines("band"), /pulled 20 N: more than a 1 mm band holds \(it snaps past ≈ 2\.4 N\), so taken as 2\.4 N/)
	assert.match(lines("rope"), /driven at 2\.5 Hz, between standing waves \(n·v\/\(2L\) = 1\.67, 3\.33, 5, 6\.67 Hz\)/)
	assert.match(lines("rope"), /its shake 8 cm with losses 1\.5\/s: a standing wave will not settle into clean loops/)
})

test("an edit that changes only a thing's settings keeps it where it stands on screen, though the build had moved it from its plan's x", async () => {
	const { pinUntouched } = await import(pathToFileURL(join(PG, "web/ai/orchestrator.js")).href)
	// the build moved everything 0.5 m left to stand on the table (the plan still says −0.3); "shake the rope twice as fast" patches its frequency
	const basePlan = { title: "r", items: [{ id: "rope", type: "wave-rope", props: { frequency: 5 }, place: { on: "table", x: -0.3 } }, { id: "m", type: "sound-meter", props: {}, place: { on: "table", x: 1 } }], goals: [] }
	const plan = { ...basePlan, items: [{ ...basePlan.items[0], props: { frequency: 10 } }, basePlan.items[1]] }
	const ref = { items: [{ id: "table", type: "table", x: 1.3, y: 0 }, { id: "rope", type: "wave-rope", x: -0.8, y: 0, props: { frequency: 5 } }, { id: "m", type: "sound-meter", x: 0.5, y: 0, props: {} }] }
	const { plan: out, pinned } = pinUntouched(plan, basePlan, ref)
	assert.equal(out.items[0].place.x, -0.8)
	assert.equal(out.items[0].place.on, "table")
	assert.ok(pinned.has("m") && !pinned.has("rope"))
	// moved by the edit itself (its place changed): the plan's place stands
	const moved = { ...plan, items: [{ ...plan.items[0], place: { on: "table", x: 0.2 } }, basePlan.items[1]] }
	assert.equal(pinUntouched(moved, basePlan, ref).plan.items[0].place.x, 0.2)
})
