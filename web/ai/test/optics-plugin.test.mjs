// The optics module's AI plug-ins (web/sim/modules/optics.js `plugin`, registered by web/sim/modules/index.js): its goal kinds (a plan's fields,
// the summary, the AI's own check), knobs, how-to, prompt lines and worked examples, the edit digest's light lines (a beam's path, a mirror's aims,
// a meter's lux, what an eye sees) and its change words; its goal kinds' summaries Python == JavaScript on real runs; and the make-it-work search
// finding a checked fix through the module's knobs.   node --test web/ai/test/optics-plugin.test.mjs
import assert from "node:assert/strict"
import { execFileSync } from "../../../tools/child-sync.mjs" // (node's, with the input given to the child as a file: a macOS hang, tools/child-sync.mjs)
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const PG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
process.env.PLAYGROUND_MODULES = process.env.PLAYGROUND_MODULES ?? "heat,optics,fluids,circuits,mechanics"
const sim = await import(pathToFileURL(join(PG, "web/sim/index.js")).href)
const plugins = await import(pathToFileURL(join(PG, "web/sim/plugins.js")).href)
const goals = await import(pathToFileURL(join(PG, "web/ai/goals.js")).href)
const { findFix } = await import(pathToFileURL(join(PG, "web/ai/fixer.js")).href)
const bundle = await import(pathToFileURL(join(PG, "web/sim/engine-worker.js")).href)
const mod = plugins.modules().find((m) => m.name === "mod_optics")
const { TYPES } = await import(pathToFileURL(join(PG, "web/sim/items.js")).href)

const STAGE = { x0: -0.56, x1: 3.19, y0: -0.16, y1: 2.34 }
const scene = (items, goals = [], seconds = 1) => ({ version: 2, id: "t", name: "t", seconds, release: 0.5, stage: STAGE, items: [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }, ...items], goals })
const run = (s) => {
	const p = sim.prepare(JSON.parse(JSON.stringify(s)))
	const track = JSON.parse(JSON.stringify(bundle.run(p.doc, 120)))
	const fin = sim.finish(p.scene, p.doc, p.resolved, track)
	return { scene: p.scene, doc: p.doc, track, summary: fin.summary, resolved: fin.resolved ?? p.resolved }
}
const D = Math.PI / 180
const mirrorScene = (aim = 150, goals = []) =>
	scene(
		[
			{ id: "laser", type: "laser-pointer", name: "Laser", x: 0.2, y: 0.25, props: {} },
			{ id: "mirror", type: "mirror", name: "Mirror", x: 0.8, y: 0.25, props: { aim } },
			{ id: "target", type: "light-sensor", name: "Target", x: 0.8 + 0.5 * Math.cos(120 * D), y: 0.25 + 0.5 * Math.sin(120 * D), props: { size: 0.03 } }
		],
		goals
	)

test("the module is registered with its goal kinds, knobs, how-to, prompt lines and examples", () => {
	assert.ok(mod, "mod_optics is in the registry")
	assert.deepEqual(mod.goals.map((g) => g.kind).sort(), ["brighter", "dark", "focused", "hits_target", "lit", "rainbow", "receives", "sees", "shadow_on"])
	for (const g of mod.goals) assert.ok(g.about && g.fields && typeof g.summarize === "function" && typeof g.sample === "function" && typeof g.label === "function", g.kind)
	for (const t of ["flashlight", "laser-pointer", "mirror", "convex-lens", "prism", "light-meter", "eye", "sunlight"]) assert.ok(plugins.knobsFor(t).length > 0, `knobs for ${t}`)
	for (const t of ["flashlight", "mirror"]) for (const k of plugins.knobsFor(t)) assert.ok(k.why && k.more && k.less, `${t}.${k.key}`)
	assert.match(mod.howto, /aim/)
	assert.match(plugins.promptSnippets("plan"), /Light and optics/)
	assert.match(plugins.promptSnippets("edit"), /turns its reflected beam by 2x°/)
	assert.match(plugins.goalKindLines(), /hits_target \{light, target, before_s\?\}/)
	assert.equal(plugins.goalKind("light_reaches")?.kind, "hits_target", "an alias")
	assert.equal(plugins.goalKind("spectrum")?.kind, "rainbow", "an alias")
	assert.ok(mod.examples.length >= 10 && mod.examples.every((e) => e.ask && e.how))
	// every example names real catalog types
	const keys = new Set(sim.catalog().types.map((t) => t.key))
	for (const e of mod.examples) for (const m of e.how.matchAll(/\b([a-z]+(?:-[a-z]+)+)\b/g)) if (/(meter|sensor|pointer|lens|block|panel|filter|mirror|arrow|book)$/.test(m[1])) assert.ok(keys.has(m[1]), `${m[1]} in "${e.ask}"`)
})

test("a plan's light goals are checked by their fields", () => {
	const ids = new Set(["laser", "target", "screen", "eye", "card"])
	assert.equal(plugins.goalProblem({ kind: "hits_target", light: "laser", target: "target" }, ids), null)
	assert.match(plugins.goalProblem({ kind: "hits_target", light: "laser" }, ids), /needs target/)
	assert.match(plugins.goalProblem({ kind: "hits_target", light: "laser", target: "nobody" }, ids), /no item "nobody"/)
	assert.match(plugins.goalProblem({ kind: "lit", item: "target", at_least_lux: "bright" }, ids), /must be a number/)
	assert.equal(plugins.goalProblem({ kind: "shadow_on", occluder: "card", screen: "screen" }, ids), null)
	assert.equal(plugins.goalProblem({ kind: "sees", eye: "eye", item: "card" }, ids), null)
	assert.equal(plugins.goalProblem({ kind: "focused", screen: "screen" }, ids), null)
})

test("the summary and the AI's own check agree on every light goal (a mirror, a shadow, an eye, meters)", () => {
	const r = run(
		scene(
			[
				{ id: "laser", type: "laser-pointer", x: 0.2, y: 0.25, props: {} },
				{ id: "mirror", type: "mirror", x: 0.8, y: 0.25, props: { aim: 150 } },
				{ id: "target", type: "light-sensor", x: 0.8 + 0.5 * Math.cos(120 * D), y: 0.25 + 0.5 * Math.sin(120 * D), props: { size: 0.03 } },
				{ id: "torch", type: "flashlight", x: 1.4, y: 0.3, props: { beam_angle: 30 } },
				{ id: "card", type: "material-panel", x: 1.676, y: 0.3, props: { sample: "white card", size: 0.05 } },
				{ id: "screen", type: "screen", x: 2.08, y: 0.3, props: { height: 0.6 } },
				{ id: "meter", type: "light-meter", x: 2.0, y: 0.42, props: {} },
				{ id: "eye", type: "eye", x: 2.6, y: 0.3, props: { aim: 180 } }
			],
			[
				{ kind: "hits_target", light: "laser", target: "target" },
				{ kind: "hits_target", light: "laser", target: "screen" },
				{ kind: "shadow_on", occluder: "card", screen: "screen" },
				{ kind: "lit", item: "meter", at_least_lux: 1 },
				{ kind: "dark", item: "target", at_most_lux: 1 },
				{ kind: "sees", eye: "eye", item: "screen" },
				{ kind: "brighter", a: "meter", b: "meter" }
			]
		)
	)
	const want = [true, false, true, true, false, true, false]
	assert.deepEqual(r.summary.goals.map((g) => g.ok), want, JSON.stringify(r.summary.goals))
	for (const [i, g] of r.scene.goals.entries()) {
		const c = plugins.checkModuleGoal(g, { doc: r.doc, track: r.track, scene: r.scene })
		assert.equal(c.ok, want[i], `checkModuleGoal ${g.kind}`)
	}
	// ai/goals (web/ai/goals.js) checks them through the same registry
	const res = goals.checkGoals(r.scene.goals, { doc: r.doc, track: r.track, summary: r.summary })
	assert.deepEqual(res.map((x) => x.ok), want)
})

test("the edit digest: a laser's reach, a mirror's beam and the aims that steer it, a meter's lux, what an eye sees", () => {
	const r = run(mirrorScene(150))
	const it = (id) => r.scene.items.find((i) => i.id === id)
	// as the edit step sees the run: only its summary (readings and happenings), no document
	const lean = { summary: r.summary, resolved: r.resolved, track: { frames: [r.track.frames[0], r.track.frames.at(-1)] } }
	const ml = mod.digest(it("mirror"), lean, {})
	assert.ok(ml.some((l) => /arrives at its face travelling at 0°/.test(l)), ml.join(" | "))
	const aim = Number(/aim (-?[\d.]+)° sends it to target/.exec(ml.join(" | "))?.[1])
	assert.ok(Math.abs(aim - 150) < 0.5, `suggested aim ${aim}`)
	const ll = mod.digest(it("laser"), lean, {})
	assert.ok(ll.some((l) => /its light reaches: .*mirror.*target|its light reaches: .*Mirror.*Target/i.test(l)), ll.join(" | "))
	// the whole run at hand: the beam's path in words
	const full = mod.digest(it("laser"), r, {})
	assert.ok(full.some((l) => /its beam: Mirror at x 0\.\d+ m, y 0\.25 m \(arriving at 0°\) → Target/.test(l) || /its beam: .*mirror.*target/i.test(l)), full.join(" | "))
	// a mirror turned the wrong way: no beam on its face, said so
	const off = run(mirrorScene(0))
	const ol = mod.digest(off.scene.items.find((i) => i.id === "mirror"), { summary: off.summary }, {})
	assert.ok(ol.some((l) => /no beam meets its shiny face/.test(l)), ol.join(" | "))
	// a meter, and an eye
	const m = run(scene([{ id: "torch", type: "flashlight", x: 0, y: 0.3, props: {} }, { id: "m", type: "light-meter", x: 1.091, y: 0.3, props: {} }, { id: "eye", type: "eye", x: 0.6, y: 0.6, props: { aim: -60 } }]))
	const mm = mod.digest(m.scene.items.find((i) => i.id === "m"), { summary: m.summary }, {})
	assert.ok(mm.some((l) => /^reads \d+ lx/.test(l)), mm.join(" | "))
	const ee = mod.digest(m.scene.items.find((i) => i.id === "eye"), { summary: m.summary }, {})
	assert.ok(ee.length > 0, ee.join(" | "))
	// an item of no optics type with no light: nothing
	assert.equal(mod.digest({ id: "x", type: "superball" }, { summary: m.summary }, {}), null)
})

test("change words in real units", () => {
	assert.equal(plugins.changeWords("mirror", "aim", 150, 160), "turned 10° anticlockwise (aim 150° → 160°): the reflected beam turns 20°")
	assert.equal(plugins.changeWords("flashlight", "lumens", 150, 500), "brightness 150 → 500 lm")
	assert.equal(plugins.changeWords("flashlight", "beam_angle", 20, 40), "beam 20° → 40° wide")
	assert.equal(plugins.changeWords("convex-lens", "focal_length", 0.1, 0.15), "focal length 10 cm → 15 cm")
	assert.equal(plugins.changeWords("sunlight", "elevation", 45, 60), "the sun 45° → 60° high")
	assert.equal(plugins.changeWords("material-panel", "sample", "clear glass", "wax paper"), "clear glass → wax paper")
	assert.equal(plugins.changeWords("superball", "diameter", 0.06, 0.08), null)
})

test("every goal kind: Python's summary (machines/mod_optics.py) == web/sim's on a real run", () => {
	const s = scene(
		[
			{ id: "laser", type: "laser-pointer", x: 0.2, y: 0.25, props: {} },
			{ id: "mirror", type: "mirror", x: 0.8, y: 0.25, props: { aim: 150 } },
			{ id: "target", type: "light-sensor", x: 0.55, y: 0.683, props: { size: 0.03 } },
			{ id: "sun", type: "sunlight", x: 2.0, y: 1.5, props: { elevation: 60 } },
			{ id: "prism", type: "prism", x: 2.2, y: 0.4, props: { aim: 180 } },
			{ id: "screen", type: "screen", x: 2.7, y: 0.4, props: {} },
			{ id: "meter", type: "light-meter", x: 1.6, y: 0.1, props: { aim: 90 } },
			{ id: "eye", type: "eye", x: 1.2, y: 0.5, props: { aim: -45 } },
			{ id: "black", type: "material-panel", x: 1.3, y: 0.002, props: { sample: "black cloth", aim: 90 } }
		],
		[
			{ kind: "hits_target", light: "laser", target: "target" }, { kind: "hits_target", light: "laser", target: "target", before_s: 0.5, label: "fast" },
			{ kind: "lit", item: "meter" }, { kind: "lit", item: "meter", at_least_lux: 500000 }, { kind: "lit", item: "black" }, { kind: "lit", item: "target" },
			{ kind: "dark", item: "meter" }, { kind: "dark", item: "eye" }, { kind: "shadow_on", occluder: "prism", screen: "screen" }, { kind: "sees", eye: "eye", item: "black" },
			{ kind: "brighter", a: "black", b: "eye" }, { kind: "brighter", a: "meter", b: "target" }, { kind: "focused", screen: "screen" }, { kind: "rainbow", screen: "screen" },
			{ kind: "lit", item: "nobody" }
		]
	)
	const js = run(s)
	const py = JSON.parse(
		execFileSync("python3", ["-c", "import sys, json; sys.path.insert(0, 'machines'); import items; r = json.load(sys.stdin); print(json.dumps(items.summarize(r['scene'], r['doc'], r['track'])))"], {
			cwd: PG,
			input: JSON.stringify({ scene: js.scene, doc: js.doc, track: js.track }),
			env: { ...process.env, PLAYGROUND_MODULES: process.env.PLAYGROUND_MODULES },
			maxBuffer: 1 << 28
		}).toString()
	)
	assert.deepEqual(py.goals, js.summary.goals)
	assert.deepEqual(py.happenings, js.summary.happenings)
	assert.deepEqual(py.readings, js.summary.readings)
	assert.equal(js.summary.goals.length, 14, "the goal on a missing item is left out")
})

test("make it work: a mirror turned off its target is put right through the module's knobs, found and checked", async () => {
	const s = mirrorScene(147, [{ kind: "hits_target", light: "laser", target: "target", label: "The laser's beam reaches the target" }])
	const R = run(s)
	assert.equal(R.summary.goals[0].ok, false, "the beam misses with the mirror 3° off")
	const simulate = async (sc) => run(sc)
	const fr = await findFix({ scene: R.scene, sim: R, goals: R.scene.goals }, { simulate, budgetMs: 60000, maxRuns: 120, parallel: 1 })
	assert.equal(fr.status, "found", JSON.stringify({ status: fr.status, runs: fr.runs, tried: fr.tried }).slice(0, 600))
	const words = JSON.stringify(fr.fix ?? fr)
	assert.match(words, /aim|turn|move|laser|target|mirror/i, words.slice(0, 400))
})

// ---------------------------------------------------------------- liquids, circuit lamps, coloured and blinking torches
const coinScene = (ml, goals = [{ kind: "sees", eye: "eye", item: "coin" }]) =>
	scene(
		[
			{ id: "jug", type: "measuring-jug", name: "Jug", x: 1.0, y: 0, props: { fill_ml: ml } },
			{ id: "coin", type: "penny", name: "Coin", x: 1.0, y: 0.006, props: {} },
			{ id: "torch", type: "flashlight", name: "Torch", x: 1.0, y: 0.45, props: { aim: -90, beam_angle: 20 } },
			{ id: "eye", type: "eye", name: "Eye", x: 0.8875, y: 0.29, props: { aim: -66.1 } }
		],
		goals
	)
const sosScene = (seconds, props = {}) =>
	scene([{ id: "torch", type: "flashlight", name: "Torch", x: 0.2, y: 0.3, props: { pattern: "SOS", beam_angle: 10, ...props } }, { id: "rx", type: "light-sensor", name: "Receiver", x: 1.2, y: 0.3, props: {} }], [{ kind: "receives", sensor: "rx", light: "torch" }], seconds)
const bulbs = (goals = []) =>
	scene(
		[1, 2].flatMap((cells) => {
			const x = cells === 1 ? 0.3 : 1.3
			return [
				{ id: `bat${cells}`, type: "battery", x, y: 0, props: { cells } },
				{ id: `bulb${cells}`, type: "bulb", name: `Bulb ${cells}`, x: x + 0.2, y: 0, props: {} },
				{ id: `wa${cells}`, type: "wire", x: x + 0.1, y: 0, props: { a: `bat${cells}`, a_end: "+", b: `bulb${cells}`, b_end: "+" } },
				{ id: `wb${cells}`, type: "wire", x: x + 0.1, y: 0, props: { a: `bulb${cells}`, a_end: "-", b: `bat${cells}`, b_end: "-" } },
				{ id: `m${cells}`, type: "light-meter", name: `Meter ${cells}`, x: x + 0.2, y: 0.15, props: { aim: -90 } }
			]
		}),
		goals
	)

test("the new items are known to the AI: liquids, coloured and blinking torches, circuit lamps, the receives goal", () => {
	assert.equal(plugins.goalKind("morse")?.kind, "receives", "an alias")
	assert.match(plugins.goalKindLines(), /receives \{sensor, light, message\?\}/)
	assert.match(mod.howto, /Liquids bend light too/)
	assert.match(mod.howto, /bulbs and LEDs/)
	assert.match(mod.howto, /`color` \(white, red, green, blue\)/)
	assert.match(plugins.promptSnippets("plan"), /receives \{sensor, light, message\?\}/)
	for (const t of ["measuring-jug", "beaker"]) assert.ok(plugins.knobsFor(t).some((k) => k.key === "fill_ml" && k.module === "mod_optics"), `a fill knob for ${t}`)
	assert.ok(plugins.knobsFor("flashlight").some((k) => k.key === "dot_s"))
	const flash = TYPES.flashlight
	for (const k of ["color", "pattern", "dot_s", "repeat"]) assert.ok(flash.props.some((p) => p.key === k), `flashlight.${k}`)
	assert.ok(flash.props.find((p) => p.key === "pattern").open, "any pattern text")
	assert.ok(TYPES["glass-block"].props.find((p) => p.key === "glass").choices.includes("water"))
	assert.ok(TYPES["light-sensor"].readouts.some((r) => r.key === "pulses"))
	for (const ask of ["aquarium", "coin", "pencil", "coloured shadows", "Morse", "2 batteries"]) assert.ok(mod.examples.some((e) => e.ask.includes(ask)), ask)
	assert.equal(plugins.goalProblem({ kind: "receives", sensor: "rx", light: "torch" }, new Set(["rx", "torch"])), null)
	assert.match(plugins.goalProblem({ kind: "receives", sensor: "rx", light: "torch", message: 5 }, new Set(["rx", "torch"])), /must be text/)
})

test("light in water: the coin appears when the jug fills; summary, the AI's check and ai/goals agree", () => {
	for (const [ml, want] of [[0, false], [500, true]]) {
		const r = run(coinScene(ml))
		assert.equal(r.summary.goals[0].ok, want, `${ml} mL: ${JSON.stringify(r.summary.goals)}`)
		assert.equal(plugins.checkModuleGoal(r.scene.goals[0], { doc: r.doc, track: r.track, scene: r.scene }).ok, want)
		assert.equal(goals.checkGoals(r.scene.goals, { doc: r.doc, track: r.track, summary: r.summary })[0].ok, want)
		if (want) {
			// the edit digest says the jug's water bends light
			const jl = mod.digest(r.scene.items.find((i) => i.id === "jug"), r, {})
			assert.ok(jl.some((l) => /its liquid bends light: water n 1\.33/.test(l)), jl.join(" | "))
		}
	}
})

test("a laser into an aquarium bends toward the vertical: the digest's beam path shows the bend", () => {
	const r = run(scene([{ id: "tank", type: "water-tank", name: "Aquarium", x: 1.0, y: 0, props: {} }, { id: "laser", type: "laser-pointer", name: "Laser", x: 0.85, y: 0.5, props: { aim: -45 } }]))
	const ll = mod.digest(r.scene.items.find((i) => i.id === "laser"), r, {})
	const path = ll.find((l) => l.startsWith("its beam:")) ?? ""
	assert.match(path, /Aquarium at x 1\.14 m, y 0\.21 m \(arriving at -45°\)/, ll.join(" | "))
	// the next step arrives at -57.9° (32.1° from the vertical, in the water)
	assert.match(path, /arriving at -57\.9°/, path)
})

test("a blinking torch's message: receives in the summary and the AI's check, the sensor's digest reads it back, too short a run fails", () => {
	const r = run(sosScene(6))
	assert.equal(r.summary.goals[0].ok, true, JSON.stringify(r.summary.goals))
	assert.equal(r.summary.goals[0].got, "SOS")
	assert.equal(plugins.checkModuleGoal(r.scene.goals[0], { doc: r.doc, track: r.track, scene: r.scene }).ok, true)
	assert.equal(goals.checkGoals(r.scene.goals, { doc: r.doc, track: r.track, summary: r.summary })[0].ok, true)
	const dl = mod.digest(r.scene.items.find((i) => i.id === "rx"), r, {})
	assert.ok(dl.some((l) => /it saw 9 flashes from Torch: read back as Morse "SOS"/.test(l)), dl.join(" | "))
	const short = run(sosScene(3))
	assert.equal(short.summary.goals[0].ok, false)
})

test("circuit bulbs shine: 2 cells brighter than 1 on a meter; the bulb's digest says what its light reaches", () => {
	const r = run(bulbs([{ kind: "brighter", a: "m2", b: "m1" }]))
	assert.equal(r.summary.goals[0].ok, true, JSON.stringify(r.summary.goals))
	const bl = mod.digest(r.scene.items.find((i) => i.id === "bulb2"), r, {})
	assert.ok(bl.some((l) => /its light reaches: .*Meter 2/.test(l)), bl.join(" | "))
	// a circuit scene without any optics item gets no optics record (its document as before)
	const plain = run(scene(bulbs().items.filter((i) => i.type !== "light-meter" && i.id !== "table")))
	assert.ok(!plain.doc.processes.some((p) => p.kind === "optics"))
})

test("coloured torches mix on a screen: red + green look yellow", () => {
	const r = run(
		scene([
			{ id: "red", type: "flashlight", x: 0.2, y: 0.25, props: { color: "red", beam_angle: 30 } },
			{ id: "green", type: "flashlight", x: 0.2, y: 0.35, props: { color: "green", beam_angle: 30, aim: -5 } },
			{ id: "screen", type: "screen", name: "Screen", x: 1.0, y: 0.3, props: { height: 0.5 } }
		])
	)
	const sl = mod.digest(r.scene.items.find((i) => i.id === "screen"), r, {})
	assert.ok(sl.includes("the light on it looks yellow"), sl.join(" | "))
	assert.equal(r.resolved.red?.lumens ?? r.resolved?.find?.((x) => x.id === "red")?.props?.lumens ?? 40, 40)
})

test("change words for the new props", () => {
	assert.equal(plugins.changeWords("flashlight", "pattern", "steady", "SOS"), "blinks steady → SOS")
	assert.equal(plugins.changeWords("flashlight", "dot_s", 0.2, 0.1), "Morse dot 0.2 s → 0.1 s")
	assert.match(plugins.changeWords("flashlight", "color", "white", "red"), /white → red/)
	assert.equal(plugins.changeWords("glass-block", "glass", "crown glass", "water"), "crown glass → water")
})

test("the new goal and lamps: Python's summary (machines/mod_optics.py) == web/sim's on real runs", () => {
	for (const s of [sosScene(6), coinScene(500, [{ kind: "sees", eye: "eye", item: "coin" }, { kind: "lit", item: "coin" }]), bulbs([{ kind: "brighter", a: "m2", b: "m1" }, { kind: "lit", item: "m1", at_least_lux: 5 }])]) {
		const js = run(s)
		const py = JSON.parse(
			execFileSync("python3", ["-c", "import sys, json; sys.path.insert(0, 'machines'); import items; r = json.load(sys.stdin); print(json.dumps(items.summarize(r['scene'], r['doc'], r['track'])))"], {
				cwd: PG,
				input: JSON.stringify({ scene: js.scene, doc: js.doc, track: js.track }),
				env: { ...process.env, PLAYGROUND_MODULES: process.env.PLAYGROUND_MODULES },
				maxBuffer: 1 << 28
			}).toString()
		)
		assert.deepEqual(py.goals, js.summary.goals)
		assert.deepEqual(py.readings, js.summary.readings)
	}
})

test("make it work: a message too long for the run is sent faster (the torch's dot_s knob), found and checked", async () => {
	const R = run(sosScene(4))
	assert.equal(R.summary.goals[0].ok, false, "SOS at 0.2 s dots takes 5.4 s")
	const simulate = async (sc) => run(sc)
	const fr = await findFix({ scene: R.scene, sim: R, goals: R.scene.goals }, { simulate, budgetMs: 90000, maxRuns: 80, parallel: 1 })
	assert.equal(fr.status, "found", JSON.stringify({ status: fr.status, runs: fr.runs, tried: fr.tried }).slice(0, 600))
	assert.match(JSON.stringify(fr.fix ?? fr), /blink|dot|faster|Morse/i)
})

test("make it work: a coin hidden in a jug with too little water shows once the jug is filled more (its fill knob)", async () => {
	const R = run(coinScene(300))
	assert.equal(R.summary.goals[0].ok, false, "300 mL is not enough")
	const simulate = async (sc) => run(sc)
	const fr = await findFix({ scene: R.scene, sim: R, goals: R.scene.goals }, { simulate, budgetMs: 90000, maxRuns: 80, parallel: 1 })
	assert.equal(fr.status, "found", JSON.stringify({ status: fr.status, runs: fr.runs, tried: fr.tried }).slice(0, 600))
})
