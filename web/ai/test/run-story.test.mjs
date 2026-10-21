// The card's "In the run" line for module motion (web/ai/orchestrator.js describeRun with web/ai/run-story.js): an ice cube melting on a hot plate
// or a pan of water warming is told from the run's readings, never "nothing moves"; the modules' happenings are told beside the hits; a module
// may say an item's part in its own words (words.story); a run without modules reads exactly as before.
//   node --test web/ai/test/run-story.test.mjs
import assert from "node:assert/strict"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const PG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
process.env.PLAYGROUND_MODULES = process.env.PLAYGROUND_MODULES ?? "flow,fluids,heat"
const sim = await import(pathToFileURL(join(PG, "web/sim/index.js")).href)
const plugins = await import(pathToFileURL(join(PG, "web/sim/plugins.js")).href)
const { describeRun } = await import(pathToFileURL(join(PG, "web/ai/orchestrator.js")).href)
const { storyLines, lessonSpan } = await import(pathToFileURL(join(PG, "web/ai/run-story.js")).href)
const { solve } = await import(pathToFileURL(join(PG, "web/ai/solver.js")).href)
const bundle = await import(pathToFileURL(join(PG, "web/sim/engine-worker.js")).href)

const run = (scene) => {
	const p = sim.prepare(scene)
	const track = JSON.parse(JSON.stringify(bundle.run(p.doc, 120)))
	const fin = sim.finish(p.scene, p.doc, p.resolved, track)
	return { key: "k", scene: p.scene, doc: p.doc, track, summary: fin.summary, resolved: p.resolved, warnings: fin.warnings ?? [] }
}
const STAGE = { x0: -0.56, x1: 3.19, y0: -0.16, y1: 2.34 }
const scene = (items, goals = [], seconds = 3, settings = undefined) => ({ version: 2, id: "t", name: "t", seconds, release: 0.2, stage: STAGE, ...(settings ? { settings } : {}), items: [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }, ...items], goals })
const hasType = (t) => sim.catalog().types.some((x) => x.key === t)

test("an ice cube melting on a hot plate: the card tells the melt and the warming from the readings, never 'nothing moves'", { skip: !hasType("hot-plate") && "no heat module" }, () => {
	const R = run(scene([{ id: "hp", type: "hot-plate", name: "Hot plate", x: 1.2, y: 0 }, { id: "ice", type: "ice-cube", name: "Ice cube", x: 1.2, y: 0.08 }], [], 4, { time_lapse: 20 }))
	assert.equal((R.summary.happenings ?? []).length, 0, "no module event tells of a cube that only partly melts")
	const words = describeRun(R, R.scene, [])
	assert.doesNotMatch(words, /nothing moves/)
	assert.match(words, /^In the run, over 80 s of lesson time: /)
	assert.match(words, /Ice cube: temperature −\d+\.\d → 0\.0 °C, melted 0 → \d+ %/)
	assert.match(words, /Hot plate: top \d+ → \d+ °C/)
	assert.equal(lessonSpan(R), "80 s of lesson time")
})

test("a pan of water warming on a hot plate: its water's temperature is told, the plate's too", { skip: !hasType("saucepan") && "no heat module" }, () => {
	const s = solve({ title: "t", seconds: 4, release: 0.2, settings: { time_lapse: 50 }, items: [{ id: "hp", type: "hot-plate", name: "Hot plate", place: { on: "table", x: 1.2 } }, { id: "pan", type: "saucepan", name: "Pan", place: { on: "hp" } }], goals: [] }).scene
	const R = run(s)
	const words = describeRun(R, R.scene, [])
	assert.doesNotMatch(words, /nothing moves/)
	assert.match(words, /Pan: water 20\.0 → \d+\.\d °C/, words)
})

test("the modules' happenings are told beside the hits, never left out because something also struck", { skip: !hasType("tap") && "no flow module" }, () => {
	const R = run(scene([{ id: "mug", type: "coffee-mug", name: "Mug", x: 1.2, y: 0.0475 }, { id: "t", type: "tap", name: "Tap", x: 1.2, y: 0.27, props: { flow_ml_s: 60, on_at: 0.5, off_at: 2 } }, { id: "ball", type: "tennis-ball", name: "Ball", x: 2.2, y: 0.4, held: true }, { id: "box", type: "box", name: "Box", x: 2.2, y: 0 }], [], 3))
	const words = describeRun(R, R.scene, [])
	assert.match(words, /^In the run: Ball hits Box \(\d\.\d\d s\)/, words)
	assert.match(words, /Also: Tap turns on \(60 mL\/s\) \(0\.50 s\) → Tap turns off after 90 mL \(2\.00 s\) → Mug fills to \d+ mL \(\d\.\d\d s\)\./, words)
})

test("readings in words: a state code or a 0/1 flag as its word, a share as a percent, one that does not change left out", () => {
	const sc = { items: [{ id: "table", type: "table", x: 1.3, y: 0 }, { id: "pan", type: "saucepan", name: "Pan", x: 1, y: 0.05 }, { id: "ice", type: "ice-cube", name: "Ice cube", x: 2, y: 0.02 }] }
	const frames = [{ t: 0, placements: {} }, { t: 1, placements: {} }, { t: 2, placements: {} }]
	const state = { pan: { water_temp: [20, 60, 100], boiling: [0, 0, 1], water_g: [1000, 1000, 999.7], temp: [20, 70, 101] }, ice: { temp: [-18, -5, 0], melted: [0, 0.1, 0.42], puddle_g: [0, 1, 4] } }
	const R = { doc: { solids: [] }, track: { frames, state }, summary: {} }
	if (!hasType("saucepan")) return
	assert.deepEqual(storyLines(R, sc), ["Pan: water 20.0 → 100.0 °C, boiling no → yes, pan 20 → 101 °C", "Ice cube: temperature −18.0 → 0.0 °C, melted 0 → 42 %, puddle 0.0 → 4.0 g"])
	assert.deepEqual(storyLines(R, sc, { skip: new Set(["pan"]) }), ["Ice cube: temperature −18.0 → 0.0 °C, melted 0 → 42 %, puddle 0.0 → 4.0 g"])
	assert.deepEqual(storyLines(R, sc, { max: 1 }), ["Pan: water 20.0 → 100.0 °C, boiling no → yes, pan 20 → 101 °C"])
	assert.equal(describeRun(R, sc, []), "In the run: Pan: water 20.0 → 100.0 °C, boiling no → yes, pan 20 → 101 °C; Ice cube: temperature −18.0 → 0.0 °C, melted 0 → 42 %, puddle 0.0 → 4.0 g.")
	// (a resized solid with no readings: how much of it is left)
	const shrink = { doc: { solids: [{ id: "c/body", item: "c", kind: "dynamic" }] }, track: { frames: [{ t: 0, placements: { "c/body": { x: 0, y: 0, angle: 0, scale: 1 } } }, { t: 1, placements: { "c/body": { x: 0, y: 0, angle: 0, scale: 0.4 } } }] }, summary: {} }
	assert.deepEqual(storyLines(shrink, { items: [{ id: "c", type: "box", name: "Block" }] }), ["Block shrinks to 40 % of its size"])
})

test("a module says an item's part in its own words (words.story), in place of the readings", () => {
	if (!hasType("saucepan")) return
	plugins.registerModule({ name: "mod_zz_story_test", words: { story: (item, run) => (item.type === "saucepan" && run?.track?.state?.[item.id]?.boiling?.at(-1) === 1 ? "boils" : null) } })
	const sc = { items: [{ id: "pan", type: "saucepan", name: "Pan", x: 1, y: 0.05 }] }
	const R = { doc: { solids: [] }, track: { frames: [{ t: 0 }, { t: 1 }], state: { pan: { water_temp: [20, 100], boiling: [0, 1] } } }, summary: {} }
	assert.deepEqual(storyLines(R, sc), ["Pan: boils"])
	assert.equal(describeRun(R, sc, []), "In the run: Pan: boils.")
})

test("a run without modules reads as before: nothing moves, a hit, a fall", () => {
	const still = { doc: { solids: [] }, track: { frames: [{ t: 0, placements: {} }] }, summary: { stories: [], events: [] } }
	assert.equal(describeRun(still, { items: [{ id: "box", type: "box", name: "Box" }] }, []), "In the run nothing moves: everything stays where it was put.")
	const hit = { doc: { solids: [] }, track: { frames: [{ t: 0, placements: {} }] }, summary: { stories: [{ item: "ball", name: "Ball", moved_at: 0.2 }], events: [{ t: 0.61, a: "ball", b: "box", text: "Ball hits Box" }] } }
	assert.equal(describeRun(hit, { items: [{ id: "ball", type: "tennis-ball", name: "Ball" }, { id: "box", type: "box", name: "Box" }] }, []), "In the run: Ball hits Box (0.61 s).")
})
