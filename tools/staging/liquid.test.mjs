// A liquid standing in a round container is drawn with a flat level that is lit as one (web/models/liquid-geo.js, web/models/mod-flow.js): the
// level's normals straight up, the floor's straight down, the wall's square to the wall, each with its own vertices. The lathe it replaces
// shared each outline point between the wall and the level, so the level's normals tipped out to 45° at the rim and a narrow glass's flat water
// was lit as a dome (the five-lesson benchmark, MA-50 screens 6, 8 and 10). No browser: the pictures are checked by renders.
//   node --test tools/staging/liquid.test.mjs
import assert from "node:assert/strict"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import * as THREE from "three"

const PG = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const { liquidColumn, liquidCut } = await import(pathToFileURL(join(PG, "web/models/liquid-geo.js")).href)

/** Each vertex's position and normal. */
const verts = (g) => {
	const p = g.getAttribute("position")
	const n = g.getAttribute("normal")
	const out = []
	for (let i = 0; i < p.count; i++) out.push({ x: p.getX(i), y: p.getY(i), z: p.getZ(i), nx: n.getX(i), ny: n.getY(i), nz: n.getZ(i) })
	return out
}
/** Every triangle's facing (its winding's normal) and its middle. */
const faces = (g) => {
	const p = g.getAttribute("position")
	const ix = g.getIndex().array
	const out = []
	for (let k = 0; k < ix.length; k += 3) {
		const v = [0, 1, 2].map((q) => new THREE.Vector3(p.getX(ix[k + q]), p.getY(ix[k + q]), p.getZ(ix[k + q])))
		const n = new THREE.Vector3().subVectors(v[1], v[0]).cross(new THREE.Vector3().subVectors(v[2], v[0]))
		const area = n.length() / 2
		if (area < 1e-14) continue
		out.push({ n: n.normalize(), mid: new THREE.Vector3().add(v[0]).add(v[1]).add(v[2]).multiplyScalar(1 / 3), area })
	}
	return out
}

test("a narrow glass's water: its level lit flat (normals straight up to the rim), its floor down, its wall square to the wall", () => {
	// (MA-50's 6 cm glass with 36 mm of water; a jar's slightly flaring wall too)
	for (const [r0, r1, h] of [[0.03, 0.03, 0.036], [0.064, 0.066, 0.05], [0.0105, 0.0105, 0.07]]) {
		const g = liquidColumn(THREE, r0, r1, h, 48)
		const vs = verts(g)
		const level = vs.filter((v) => v.ny > 0.999)
		const floor = vs.filter((v) => v.ny < -0.999)
		const wall = vs.filter((v) => Math.abs(v.ny) < 0.2)
		assert.equal(level.length + floor.length + wall.length, vs.length, "every vertex is the level's, the floor's or the wall's")
		assert.ok(level.every((v) => Math.abs(v.y - h) < 1e-6 && v.nx === 0 && v.nz === 0), "the level: flat at its height, normals straight up")
		assert.ok(Math.max(...level.map((v) => Math.hypot(v.x, v.z))) > r1 - 1e-6, "…all the way to the rim")
		assert.ok(floor.every((v) => Math.abs(v.y) < 1e-6), "the floor flat at 0")
		// (the wall's normals square to the wall: (h, r0 − r1) in (radial, y))
		const want = Math.atan2(r0 - r1, h)
		for (const v of wall) {
			const radial = Math.hypot(v.nx, v.nz)
			assert.ok(Math.abs(Math.atan2(v.ny, radial) - want) < 1e-6, "the wall's normal square to it")
			assert.ok(v.nx * v.x + v.nz * v.z > 0, "…pointing out")
		}
		// every face is wound to face out: the level's up, the floor's down, the wall's away from the axis
		for (const f of faces(g)) {
			if (Math.abs(f.mid.y - h) < 1e-6) assert.ok(f.n.y > 0.999, "a level face faces up")
			else if (Math.abs(f.mid.y) < 1e-6) assert.ok(f.n.y < -0.999, "a floor face faces down")
			else assert.ok(f.n.x * f.mid.x + f.n.z * f.mid.z > 0, "a wall face faces out")
		}
		// the same solid as the lathe it replaces: its volume
		let vol = 0
		const p = g.getAttribute("position")
		const ix = g.getIndex().array
		for (let k = 0; k < ix.length; k += 3) {
			const a = new THREE.Vector3(p.getX(ix[k]), p.getY(ix[k]), p.getZ(ix[k]))
			const b = new THREE.Vector3(p.getX(ix[k + 1]), p.getY(ix[k + 1]), p.getZ(ix[k + 1]))
			const c = new THREE.Vector3(p.getX(ix[k + 2]), p.getY(ix[k + 2]), p.getZ(ix[k + 2]))
			vol += a.dot(b.clone().cross(c)) / 6
		}
		const frustum = ((Math.PI * h) / 3) * (r0 * r0 + r0 * r1 + r1 * r1)
		assert.ok(Math.abs(vol / frustum - 1) < 0.01, `its volume the frustum's (a 48-gon's): ${vol} vs ${frustum}`)
	}
})

test("the lathe it replaces lit the flat level as a dome (why): its level's normals tipped out toward the rim", () => {
	const r = 0.03
	const h = 0.036
	const lathe = new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(r, 0), new THREE.Vector2(r, h), new THREE.Vector2(0, h)], 48)
	const rim = verts(lathe).filter((v) => Math.abs(v.y - h) < 1e-6 && Math.hypot(v.x, v.z) > r - 1e-6)
	assert.ok(rim.length > 0 && rim.every((v) => v.ny < 0.8), `the lathe's rim normals tip out (up ${rim[0]?.ny.toFixed(3)})`)
	const g = liquidColumn(THREE, r, r, h, 48)
	const rim2 = verts(g).filter((v) => Math.abs(v.y - h) < 1e-6 && Math.hypot(v.x, v.z) > r - 1e-6 && v.ny > 0.5)
	assert.ok(rim2.length > 0 && rim2.every((v) => v.ny === 1), "the column's level is up to its rim")
})

test("a tipped cup's milk: its level a flat surface lit up, never rounded into its sides; the floor and the sides each on their own", () => {
	// (a 7 cm cup's inside, 9 cm tall, tipped 25° about its lip; milk to a level 4 cm over its floor's lowest point)
	const local = [[-0.035, 0], [0.035, 0], [0.035, 0.09], [-0.035, 0.09]]
	const pl = { x: 1.3, y: 0.2, angle: (25 * Math.PI) / 180 }
	const level = 0.24
	const g = liquidCut(THREE, local, pl, -Infinity, level)
	assert.ok(g, "there is milk under the level")
	const vs = verts(g)
	const atLevel = vs.filter((v) => Math.abs(v.y - level) < 1e-6)
	assert.ok(atLevel.length > 40, `the level's vertices (${atLevel.length})`)
	// (the level's own vertices: up; the sides' copies of the same places: square to the cup's round wall, never up)
	const up = atLevel.filter((v) => v.ny > 0.999)
	assert.ok(up.length >= (22 + 1) * (12 + 1) * 0.9, `the level's grid lit straight up (${up.length} of ${atLevel.length} at its height)`)
	assert.ok(vs.every((v) => Number.isFinite(v.nx) && Number.isFinite(v.ny) && Number.isFinite(v.nz)), "every normal a number")
	// nothing above the level
	assert.ok(vs.every((v) => v.y <= level + 1e-6), "nothing over the level")
	assert.equal(liquidCut(THREE, local, pl, -Infinity, pl.y - 0.2), null, "a level under the cup: no liquid")
})
