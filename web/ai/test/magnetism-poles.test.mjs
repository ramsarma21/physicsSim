// bench2 (2026-10-21): a nail held under a flat bar magnet's end (FO-13 screen 11, "the magnet moved just above the nail"), run in the engine
// bundle. An alnico bar's poles spread over its last few cm (machines/mod_magnetism.py ALNICO_HC, _alnico_bar, _bar_faces; its port in
// web/sim/modules/magnetism.js: the same faces, Python == JavaScript); the field's turning taken implicitly only where it lines a body up
// (tooling/src/sim/magnetism.ts pairWrench); a contact's rebound under a module's push (tooling/src/sim/physics.ts compensated). The physics
// against references and real bars: research/rw-validate-magnetism.ts sections alnico, turning, rest.
//   node --test web/ai/test/magnetism-poles.test.mjs
import assert from "node:assert/strict"
import { execFileSync } from "../../../tools/child-sync.mjs"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const PG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const sim = await import(pathToFileURL(join(PG, "web/sim/index.js")).href)
if (sim.ready) await sim.ready
const bundle = await import(pathToFileURL(join(PG, "web/sim/engine-worker.js")).href)
const plugins = await import(pathToFileURL(join(PG, "web/sim/plugins.js")).href)
const MU0 = 1.25663706212e-6
const STAGE = { x0: -0.56, x1: 3.19, y0: -0.16, y1: 2.34 }
const MAG = { x: 1.365, y: 0.1575, L: 0.15, W: 0.019 }
const LEFT = MAG.x - MAG.L / 2
const BOTTOM = MAG.y - MAG.W / 2
const TOP = MAG.y + MAG.W / 2

const facesOf = (props) => {
	const p = sim.prepare({ version: 2, id: "b", name: "b", seconds: 0.1, stage: STAGE, items: [{ id: "magnet", type: "bar-magnet", x: 1, y: 0.3, fixed: true, props }] })
	return p.doc.processes.find((r) => r.role === "magnet").faces
}
const pyFacesOf = (props) =>
	JSON.parse(
		execFileSync(
			"python3",
			[
				"-c",
				`
import json, sys
sys.path.insert(0, ${JSON.stringify(join(PG, "machines"))})
import items
doc, _ = items.build({"version": 2, "id": "b", "name": "b", "seconds": 0.1, "stage": ${JSON.stringify(STAGE)}, "items": [{"id": "magnet", "type": "bar-magnet", "x": 1, "y": 0.3, "fixed": True, "props": json.loads(sys.argv[1])}]})
print(json.dumps(next(r for r in doc["processes"] if r["role"] == "magnet")["faces"]))
`,
				JSON.stringify(props)
			],
			{ encoding: "utf8" }
		)
	)

test("an alnico bar's charges: its end faces and its volume charge's sheets inside it, solved along it; Python == JavaScript", () => {
	for (const props of [{ material: "alnico" }, { material: "alnico", flip: true }, { material: "alnico", length: 0.03 }, { material: "alnico", length: 0.2, width: 0.012, depth: 0.012 }]) {
		const js = facesOf(props)
		assert.deepEqual(js, pyFacesOf(props), JSON.stringify(props))
	}
	const f = facesOf({ material: "alnico" })
	const inner = f.filter((x) => x.inner === true)
	assert.equal(f.length, 24)
	assert.equal(inner.length, 22)
	// inset from its sides (no sheet's edge on the outline a touching thing comes to), inside its length
	for (const s of inner) assert.ok(s.width < MAG.W && s.depth < 0.0095 && Math.abs(s.x) < MAG.L / 2, JSON.stringify(s))
	// the north pole: its charge is the magnetization in the bar's middle times its section (an independent 192-cell solve: 1.2249 T, research
	// /rw-validate-magnetism.ts alnico), a third of it on the end face, the rest behind it; its magnetic length about 0.90 of its length
	let q = 0
	let qx = 0
	for (const x of f) {
		if (x.x <= 0) continue
		q += x.sigma * x.width * x.depth
		qx += x.sigma * x.width * x.depth * x.x
	}
	const mid = (q / (MAG.W * 0.0095)) * MU0
	assert.ok(Math.abs(mid - 1.2249) < 0.006, `middle ${mid} T`)
	const end = f.find((x) => x.angle === 0 && x.inner !== true)
	assert.ok(end.x === MAG.L / 2 && Math.abs((end.sigma * MAG.W * 0.0095) / q - 0.31) < 0.04, `end face share ${(end.sigma * MAG.W * 0.0095) / q}`)
	assert.ok(Math.abs((2 * qx) / q / MAG.L - 0.9) < 0.01, `magnetic length ${(2 * qx) / q / MAG.L}`)
	// flipped: every charge turns over
	const fl = facesOf({ material: "alnico", flip: true })
	assert.deepEqual(fl.map((x) => x.sigma), f.map((x) => -x.sigma))
	// ceramic and neodymium: their two end faces at B_r/µ0, as before
	for (const [material, br] of [["ceramic", 0.39], ["neodymium", 1.3]]) {
		const g = facesOf({ material })
		assert.equal(g.length, 2)
		assert.ok(Math.abs(g[0].sigma - br / MU0) < 0.1 && g.every((x) => x.inner === undefined), material)
	}
})

/** A nail let go under the bar's end: its upper end (from the bar's lower left corner, m), its tilt from straight down (deg, + its lower end
 *  out past the bar's end), whether it is on the bar's top, when it came to rest after the release. */
const nail = ({ head, len = 0.033, gap = 0.015, inset = 0.01, material = "alnico", pin = null, seconds = 2.5 }) => {
	const items = [
		{ id: "table", type: "table", x: 1.3, y: 0, props: {} },
		{ id: "nail", type: "iron-nail", x: LEFT + inset, y: BOTTOM - gap - len / 2 - (head === "up" ? 0.001 : 0), angle: head === "up" ? -90 : 90, props: { length: len }, held: true },
		{ id: "magnet", type: "bar-magnet", x: MAG.x, y: MAG.y, angle: 0, fixed: true, props: { material } }
	]
	const p = sim.prepare({ version: 2, id: "n", name: "n", seconds, release: 0.5, stage: STAGE, items })
	if (pin) p.doc.joints = [...(p.doc.joints ?? []), pin(items[1])]
	const track = JSON.parse(JSON.stringify(bundle.run(p.doc, 60)))
	const fr = track.frames
	const end = fr.at(-1).placements["nail/shank"]
	let restAt = -1
	for (const f of fr) {
		const q = f.placements["nail/shank"]
		const still = Math.hypot(q.x - end.x, q.y - end.y) < 2e-5 && Math.abs(q.angle - end.angle) < 1e-3
		if (restAt < 0 && f.t > 0.5 && still) restAt = f.t
		else if (restAt >= 0 && !still) restAt = -1
	}
	const c = Math.cos(end.angle)
	const s = Math.sin(end.angle)
	const pt = { x: end.x + (len / 2) * c, y: end.y + (len / 2) * s }
	const hd = { x: end.x - (len / 2) * c, y: end.y - (len / 2) * s }
	const [hi, lo] = pt.y > hd.y ? [pt, hd] : [hd, pt]
	return { in: hi.x - LEFT, under: BOTTOM - hi.y, byHead: hi === hd, tilt: (Math.atan2(hi.x - lo.x, hi.y - lo.y) * 180) / Math.PI, onTop: end.y > TOP, rest: restAt > 0 ? restAt - 0.5 : Infinity, angle: (end.angle * 180) / Math.PI }
}

test("FO-13 screen 11: a nail let go head up under an alnico bar's end hangs by its head under the end, straight down (release 2: onto the bar's top)", () => {
	for (const len of [0.033, 0.051])
		for (const [gap, inset] of [[0.01, 0.005], [0.015, 0.01], [0.02, 0.015]]) {
			const r = nail({ head: "up", len, gap, inset })
			assert.ok(r.byHead && r.in > 0 && r.in < 0.01 && r.under > 0 && r.under < 0.004 && Math.abs(r.tilt) <= 10 && !r.onTop && r.rest <= 0.4, `${len * 1000} mm, ${gap * 1000}/${inset * 1000} mm: ${JSON.stringify(r)}`)
		}
})

test("point up it comes to rest at the pole, never swung round onto the bar's top (release 2: it rocked against the corner, or went over)", () => {
	for (const [gap, inset] of [[0.01, 0.005], [0.015, 0.01], [0.02, 0.015]]) {
		const r = nail({ head: "down", gap, inset })
		assert.ok(!r.onTop && r.rest <= 0.7 && r.in < 0.025 && r.under < 0.004, `${gap * 1000}/${inset * 1000} mm: ${JSON.stringify(r)}`)
	}
	// at a neodymium pole (a uniformly magnetized bar, 1.3 T): still within 1 s, no rocking (a rebound under the pole's pull, given e of that
	// pull at every touch it made again, rocked it for the whole run)
	const nd = nail({ head: "down", material: "neodymium", gap: 0.0145, inset: 0.01, seconds: 3.5 })
	assert.ok(nd.rest <= 1, JSON.stringify(nd))
})

test("a nail on a pin 2 mm down from its point, under a bar's end: it rests where the field's turning and its weight balance (release 2: spun round)", () => {
	// the balance about the pin from the static field (research/rw-validate-magnetism.ts turning), 6 mm in from the end and 4 mm under it: at
	// a neodymium bar 126.4° (release 2: it came to rest at -9°, turned right round by a couple the field never made), at an alnico one 101.0°
	for (const [material, balance] of [["neodymium", 126.4], ["alnico", 101.0]]) {
		const r = nail({
			head: "down",
			material,
			gap: 0.004 - 0.002,
			inset: 0.006,
			seconds: 3,
			pin: (it) => ({ kind: "pin", id: "pin", a: null, b: "nail/shank", anchorA: { x: it.x, y: it.y + 0.033 / 2 - 0.002 }, anchorB: { x: 0.033 / 2 - 0.002, y: 0 }, damping: 2e-5 })
		})
		assert.ok(Math.abs(r.angle - balance) < 7, `${material}: ${JSON.stringify(r)}`)
	}
})

test("the AI's words for an alnico bar: its ends partly demagnetized, 2 to 4 times a ceramic bar's pull near its end (its B_r would say 7.6)", () => {
	for (const [a, b] of [["ceramic", "alnico"], ["alnico", "neodymium"]]) {
		for (const type of ["bar-magnet", "magnet-cart"]) assert.match(plugins.changeWords(type, "material", a, b), /an alnico bar's ends are partly demagnetized: near its end it pulls 2 to 4× as hard as a ceramic bar/)
	}
	// (a horseshoe, and bars of other grades, as before)
	assert.equal(plugins.changeWords("horseshoe-magnet", "material", "ceramic", "alnico"), "ceramic → alnico magnet (about 7.6× the pull at contact)")
	assert.equal(plugins.changeWords("bar-magnet", "material", "ceramic", "neodymium"), "ceramic → neodymium magnet (about 11.1× the pull at contact)")
})
