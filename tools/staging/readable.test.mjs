// bench2 (2026-10-21): the catalog's readable variants, which a lesson chooses for a picture that reads (MA-25 screen 11's card draws a swirl
// marble; the clear glass marble in a tank of water was a few pixels across). A variant keeps the real thing's size: a bigger thing is never
// the fix (the director frames small things close: web/export/shots.js small-size). The swirl marble is the clear glass marble in all but its
// look: the same props (16 mm, 5.4 g, the marble's glass), the same runs byte for byte, in water too; its look milky and opaque where the clear
// one's lets the light through; its own model (web/models/balls.js); Python == JavaScript. No browser: the pictures are checked by renders.
//   node --test tools/staging/readable.test.mjs
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import { execFileSync } from "../child-sync.mjs"

const PG = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const sim = await import(pathToFileURL(join(PG, "web/sim/index.js")).href)
if (sim.ready) await sim.ready
const E = await import(pathToFileURL(join(PG, "web/sim/engine-worker.js")).href)
const cat = sim.catalog()
const typeOf = (key) => cat.types.find((t) => t.key === key)
const sha = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex")
const STAGE = { x0: -0.56, x1: 3.19, y0: -0.16, y1: 2.34 }

/** A marble of `type` let go over the table, or over a tank of water (the fluids module lifts it): its document and its run in the bundle. */
const run = (type, { props = {}, tank = false } = {}) => {
	const items = [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }]
	if (tank) items.push({ id: "tank", type: "water-tank", x: 1.3, y: 0, props: { length: 0.36, height: 0.3, depth: 0.2, fill: 0.18 } })
	items.push({ id: "marble", type, x: 1.3, y: tank ? 0.26 : 0.2, held: true, props })
	const scene = { version: 2, id: "m", name: "m", seconds: 2, release: 0.5, stage: STAGE, items }
	const p = sim.prepare(JSON.parse(JSON.stringify(scene)))
	const r = E.handle({ id: 1, doc: p.doc, rate: 120 })
	assert.equal(r.error, undefined, `${type}: ${r.error}`)
	return { scene, doc: p.doc, track: r.track, summary: sim.finish(p.scene, p.doc, p.resolved, r.track).summary }
}

test("the swirl marble is the clear glass marble's real size and glass: the same props (16 mm, 5.4 g), a Ball, tagged easy to see", () => {
	const clear = typeOf("glass-marble")
	const swirl = typeOf("swirl-marble")
	assert.ok(clear && swirl, "both marbles are in the catalog")
	assert.equal(swirl.category, clear.category)
	// (every prop the same, defaults and ranges: its diameter, its weight that follows the size, its glass, bounce and friction)
	assert.deepEqual(swirl.props, clear.props)
	const def = (key) => swirl.props.find((p) => p.key === key).default
	assert.equal(def("diameter"), 0.016)
	assert.equal(def("mass"), 0.0054)
	assert.equal(def("material"), "glass marble")
	for (const tag of ["swirl", "opaque", "easy to see", "marbles"]) assert.ok(swirl.tags.includes(tag), tag)
	assert.match(swirl.facts, /^16 mm · 5\.4 g/)
})

test("its look is milky and opaque, the clear marble's lets the light through", () => {
	const swirl = typeOf("swirl-marble")
	const clear = typeOf("glass-marble")
	const lookOf = (t) => cat.looks[run(t.key).doc.solids.find((s) => s.item === "marble").look]
	assert.equal(lookOf(swirl), cat.looks["swirl glass"])
	assert.equal(cat.looks["swirl glass"].transmission, undefined)
	assert.equal(lookOf(clear).transmission, 0.8)
	// (its picture: a model of its own, ribbons on milky glass; the 3D view draws it by its pattern)
	assert.equal(run(swirl.key).doc.solids.find((s) => s.item === "marble").pattern, "swirl-marble")
	assert.match(readFileSync(join(PG, "web/models/balls.js"), "utf8"), /addModel\("swirl-marble", "ball"/)
})

test("the same runs byte for byte: on the table at its 16 mm, and a 25 mm 'shooter' let go into a tank of water (the fluids module's lift)", () => {
	for (const opts of [{}, { tank: true, props: { diameter: 0.025, mass: 0.02 } }, { tank: true }]) {
		const a = run("glass-marble", opts)
		const b = run("swirl-marble", opts)
		assert.equal(sha(b.track), sha(a.track), `${JSON.stringify(opts)}: the track`)
		// (the summary the same but for its name: "Swirl marble hits Table top")
		const named = (s) => JSON.stringify(s).replaceAll("Swirl marble", "Glass marble")
		assert.ok(JSON.stringify(b.summary).includes("Swirl marble"))
		assert.equal(named(b.summary), named(a.summary), `${JSON.stringify(opts)}: the summary`)
		// (it sinks in water and comes to rest on the floor, as glass does)
		if (opts.tank) {
			const end = b.track.frames.at(-1).placements["marble/ball"]
			assert.ok(end.y < 0.05, `${JSON.stringify(opts)}: on the tank's floor (${end.y})`)
		}
	}
})

test("Python == JavaScript: its catalog entry and a scene's document", () => {
	const scene = run("swirl-marble", { tank: true, props: { diameter: 0.025, mass: 0.02 } }).scene
	const py = JSON.parse(
		execFileSync(
			"python3",
			[
				"-c",
				`
import json, sys
sys.path.insert(0, ${JSON.stringify(join(PG, "machines"))})
import items
t = next(t for t in items.catalog()["types"] if t["key"] == "swirl-marble")
doc, _ = items.build(json.loads(sys.stdin.read()))
print(json.dumps({"type": t, "doc": doc}))
`
			],
			{ encoding: "utf8", input: JSON.stringify(scene), maxBuffer: 64 * 1024 * 1024 }
		)
	)
	assert.deepEqual(typeOf("swirl-marble"), py.type)
	assert.deepEqual(sim.prepare(JSON.parse(JSON.stringify(scene))).doc, py.doc)
})
