// The lesson look's and the release stands' decisions (web/lesson-look.js, web/release-stand.js), which the 3D view follows: which look a run is
// drawn in, its backdrop and table, what holds a held thing (a hanger in or over water, else a pin and post that go), pad or jaws, the holder's
// timing (never below the thing it held, gone 2 m up), and the hidden post's fade. No browser: the pictures themselves are checked by renders.
//   node --test tools/staging/look.test.mjs
import assert from "node:assert/strict"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const PG = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const L = await import(pathToFileURL(join(PG, "web/lesson-look.js")).href)
const R = await import(pathToFileURL(join(PG, "web/release-stand.js")).href)
const sim = await import(pathToFileURL(join(PG, "web/sim/index.js")).href)
const looks = sim.catalog().looks

const ball = (id, color, r = 0.08, look = "plastic") => ({ kind: "dynamic", id: `${id}/ball`, item: id, body: { kind: "ball", radius: r }, look, color, placeholder: { fill: "#cccccc" } })
const docOf = (solids, view) => ({ solids, ...(view ? { view } : {}) })

test("the real look unless the scene or the view says lesson", () => {
	const d = docOf([ball("b", "#d62828")])
	assert.equal(L.styleOf(d, looks).name, "real")
	assert.equal(L.styleOf(d, looks).releaseStand, "post")
	assert.equal(L.styleOf(d, looks).outline, false)
	const v = L.styleOf(docOf(d.solids, { style: "lesson" }), looks)
	assert.equal(v.name, "lesson")
	assert.equal(v.releaseStand, "auto")
	assert.equal(v.outline, true)
	assert.equal(L.styleOf(docOf(d.solids, { style: "lesson" }), looks, { style: "real" }).name, "real") // (the view's own choice wins)
	assert.equal(L.styleOf(d, looks, { style: "lesson", outline: false }).outline, false)
	assert.equal(L.styleOf(docOf(d.solids, { style: "lesson", release_stand: "hidden" }), looks).releaseStand, "hidden")
	assert.equal(L.styleOf(docOf(d.solids, { style: "lesson", release_stand: "hidden" }), looks, { releaseStand: "hanger" }).releaseStand, "hanger")
	assert.equal(L.styleOf(docOf(d.solids, { release_stand: "hidden" }), looks).releaseStand, "hidden") // (the real look takes a release stand too)
	assert.notEqual(L.styleKey(L.styleOf(d, looks)), L.styleKey(L.styleOf(d, looks, { style: "lesson" })))
})

test("the backdrop: pale behind most things, blue-grey behind pale ones; a metal is never pale; glass does not count; a named one wins", () => {
	const pale = L.LESSON_PALETTE.pale.backdrop
	const mid = L.LESSON_PALETTE.mid.backdrop
	assert.equal(L.pickBackdrop(docOf([ball("r", "#d62828")]), looks).backdrop, pale)
	assert.equal(L.pickBackdrop(docOf([ball("w", "#f3f3f0")]), looks).backdrop, mid)
	assert.equal(L.pickBackdrop(docOf([ball("c", null, 0.005, "steel")]), looks).backdrop, pale)
	assert.equal(L.pickBackdrop(docOf([ball("g", null, 0.05, "glass"), ball("r", "#d62828", 0.01)]), looks).backdrop, pale)
	assert.equal(L.pickBackdrop(docOf([]), looks).backdrop, pale)
	const named = L.styleOf(docOf([ball("r", "#d62828")], { style: "lesson", backdrop: "#1D2B3A" }), looks)
	assert.equal(named.backdrop, "#1d2b3a")
	assert.equal(named.table, L.LESSON_PALETTE.mid.table) // (a dark backdrop gets the mid table)
	assert.equal(L.repaintsTable({ itemType: "table", look: "wood" }, looks), true)
	assert.equal(L.repaintsTable({ itemType: "floor", look: "carpet" }, looks), false) // (a lawn, a carpet: what the floor is made of shows)
})

const tankDoc = { processes: [{ kind: "liquid", id: "tank/liquid", item: "tank", x0: 0.13, x1: 0.37, floor: 0.006, rim: 0.24, layers: [{ words: "water", density: 998.2, height: 0.14 }] }], materials: { cork: { density: 200 }, grape: { density: 1060 }, celluloid: { density: 1400 } } }
const at = (x, y) => ({ x, y, angle: 0 })

test("auto: a holder from above in or over a liquid, else the pin and post that go", () => {
	const cork = { id: "cork/cork", item: "cork", body: { kind: "ball", radius: 0.012 }, material: "cork" }
	assert.equal(R.standModeFor("auto", tankDoc, cork, at(0.25, 0.018)), "hanger")
	assert.equal(R.standModeFor("auto", tankDoc, cork, at(0.25, 0.38)), "hanger") // (14 cm over the rim: over the water)
	assert.equal(R.standModeFor("auto", tankDoc, cork, at(0.25, 0.42)), "hidden")
	assert.equal(R.standModeFor("auto", tankDoc, cork, at(0.6, 0.05)), "hidden")
	assert.equal(R.standModeFor("auto", {}, cork, at(0.25, 0.05)), "hidden")
	for (const m of ["post", "hidden", "hanger"]) assert.equal(R.standModeFor(m, tankDoc, cork, at(0.6, 0.05)), m)
})

test("a floater gets a pad, a sinker jaws (by density when the run cannot say)", () => {
	const cork = { body: { kind: "ball", radius: 0.012 }, material: "cork" }
	const grape = { body: { kind: "ball", radius: 0.0125 }, material: "grape" }
	const pingpong = { body: { kind: "ball", radius: 0.02, wall: 0.0004 }, material: "celluloid" } // (hollow: 1400 kg/m3 over a 0.4 mm shell)
	assert.equal(R.floats(tankDoc, cork, at(0.25, 0.02)), true)
	assert.equal(R.floats(tankDoc, grape, at(0.25, 0.02)), false)
	assert.equal(R.floats(tankDoc, pingpong, at(0.25, 0.02)), true)
	assert.equal(R.floats(tankDoc, cork, at(0.6, 0.02)), false) // (over no liquid)
})

test("the top of a thing and its half-width", () => {
	assert.deepEqual(R.topOf({ body: { kind: "ball", radius: 0.02 } }, at(1, 0.5)), { top: 0.52, hw: 0.02, x: 1 })
	const slab = R.topOf({ body: { kind: "slab", width: 0.2, height: 0.04 } }, at(0, 0.1))
	assert.ok(Math.abs(slab.top - 0.12) < 1e-12 && Math.abs(slab.hw - 0.1) < 1e-12 && Math.abs(slab.x) < 1e-12)
	const tilted = R.topOf({ body: { kind: "slab", width: 0.2, height: 0.04 } }, { x: 0, y: 0, angle: Math.PI / 6 })
	assert.ok(tilted.top > 0.06 && tilted.x > 0) // (its raised corner)
})

test("the holder: closed and still until the release, opening, lifting, never below the thing, gone 2 m up", async () => {
	const THREE = await import("three")
	const add = (g, geo, mat) => {
		const m = new THREE.Mesh(geo, mat)
		g.add(m)
		return m
	}
	// a cork rising at 0.4 m/s from the release (a made-up track: the view reads placements only)
	const frames = []
	for (let k = 0; k <= 240; k++) {
		const t = k / 120
		frames.push({ t, placements: { "cork/cork": { x: 0.25, y: 0.018 + Math.max(0, t - 0.5) * 0.4, angle: 0 } } })
	}
	const track = { fps: 120, frames }
	const cork = { id: "cork/cork", item: "cork", body: { kind: "ball", radius: 0.012 }, material: "cork" }
	const h = R.makeHanger({ list: [cork], addMesh: add, doc: tankDoc })
	h.layout(() => at(0.25, 0.018), track, 0.5)
	h.at(0.3, 0.5)
	assert.ok(Math.abs(h.root.position.y - 0.03) < 1e-9 && h.root.visible, "held at the cork's top until the release")
	for (const t of [0.52, 0.55, 0.6, 0.7]) {
		h.at(t, 0.5)
		const top = 0.03 + (t - 0.5) * 0.4
		assert.ok(h.root.position.y >= top - 1e-9, `never below the rising cork at ${t} s`)
	}
	h.at(0.5 + Math.sqrt((2 * R.HANGER.gone) / R.HANGER.accel) + 0.01, 0.5)
	assert.equal(h.root.visible, false, "gone once 2 m up")
	// a sinker: jaws, which open at the release
	const grape = { id: "grape/grape", item: "grape", body: { kind: "ball", radius: 0.0125 }, material: "grape" }
	const g = R.makeHanger({ list: [grape], addMesh: add, doc: tankDoc })
	g.layout(() => at(0.25, 0.1), { fps: 1, frames: [{ t: 0, placements: {} }] }, 0.5)
	g.at(0.4, 0.5)
	const shut = g.root.children.filter((c) => c.isGroup).map((c) => c.rotation.z)
	g.at(0.6, 0.5)
	const open = g.root.children.filter((c) => c.isGroup).map((c) => c.rotation.z)
	assert.ok(shut.every((z) => z === 0), "shut until the release")
	assert.ok(Math.abs(Math.abs(open[0]) - (R.HANGER.openDeg * Math.PI) / 180) < 1e-9 && open[0] === -open[1], "the jaws open 24 degrees, both ways")
})

test("a hidden pin and post fade out after the pin is out", async () => {
	const THREE = await import("three")
	const wood = new THREE.MeshStandardMaterial()
	const pin = new THREE.Mesh(new THREE.BoxGeometry(), wood)
	const post = new THREE.Mesh(new THREE.BoxGeometry(), wood)
	post.position.z = -0.09
	post.userData.z0 = -0.09
	const e = R.makeRetreat(pin, post, null)
	assert.notEqual(post.material, wood) // (its own copy: the shared one is never changed)
	R.retreatAt(e, 0.4, 0.5)
	assert.ok(post.visible && !post.material.transparent && post.position.z === -0.09)
	R.retreatAt(e, 0.5 + R.RETREAT.delay + R.RETREAT.seconds / 2, 0.5)
	assert.ok(post.visible && post.material.transparent && Math.abs(post.material.opacity - 0.5) < 1e-9)
	R.retreatAt(e, 0.5 + R.RETREAT.delay + R.RETREAT.seconds + 0.001, 0.5)
	assert.ok(!post.visible && !pin.visible)
	R.retreatAt(e, 0.2, 0.5) // (scrubbed back before the release: there again, opaque)
	assert.ok(post.visible && !post.material.transparent && post.position.z === -0.09)
})
