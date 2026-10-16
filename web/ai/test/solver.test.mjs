// The placement solver's tests (node --test web/ai/test/solver.test.mjs). Each case checks the exact geometry (contacts at the engine's resting
// distance, gaps, angles, containment), the errors for plans that can't be built, and that solved scenes have no overlap warnings in web/sim and run
// in the engine (web/sim/engine-worker.js, on this thread) with what rests staying at rest.
import test from "node:test"
import assert from "node:assert/strict"
import { solve, planFromScene, inspect, itemGeometry, shapesAt, liftOver, slackRight, penetration, restGap, vspan, SolveError, DEFAULT_STAGE, SKIN, SLOP } from "../solver.js"
import { build, layout, prepare, finish, inside, TYPES } from "../../sim/index.js"
import { _world_poses } from "../../sim/items.js"
import { handle } from "../../sim/engine-worker.js"
import { readFileSync } from "node:fs"

const MM = 0.001
const POLY_REST = 2 * SKIN - SLOP // 1.5 mm: a block on the table
const BALL_REST = SKIN - SLOP // 0.5 mm: a ball on the table
const near = (a, b, tol, what = "") => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} vs ${b} (tol ${tol})`)
const item = (r, id) => r.scene.items.find((i) => i.id === id)
const sq = (x0, y0, x1, y1, st = false) => ({ k: "poly", p: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], x0, y0, x1, y1, st, sk: SKIN })
const circ = (cx, cy, r, st = false) => ({ k: "circle", cx, cy, r, x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r, st, sk: 0 })
const poly = (p, st = false) => ({ k: "poly", p, x0: Math.min(...p.map((q) => q[0])), y0: Math.min(...p.map((q) => q[1])), x1: Math.max(...p.map((q) => q[0])), y1: Math.max(...p.map((q) => q[1])), st, sk: SKIN })

/** Run the scene in the engine (this thread) -> {track, summary, warnings}; throws the engine's error. */
function simulate(scene) {
	const { scene: s, doc, resolved } = prepare(scene)
	const msg = handle({ id: 1, doc, rate: 120 })
	if (msg.error !== undefined) throw new Error(msg.error)
	return { track: msg.track, doc, ...finish(s, doc, resolved, msg.track) }
}
/** The largest distance any dynamic solid of these items moves from its start during the run. */
function maxDrift(sim, ids) {
	const f0 = sim.track.frames[0].placements
	let m = 0
	for (const f of sim.track.frames)
		for (const [sid, p] of Object.entries(f.placements)) {
			if (!ids.some((id) => sid.startsWith(`${id}/`)) || !f0[sid]) continue
			m = Math.max(m, Math.hypot(p.x - f0[sid].x, p.y - f0[sid].y))
		}
	return m
}
/** solve, then check the round trip every solved scene must pass: no overlap warnings from web/sim, and it runs. */
function solved(plan, { run = true } = {}) {
	const r = solve(plan)
	const warnings = layout(r.scene).warnings
	assert.deepEqual(warnings, [], `web/sim overlap warnings: ${JSON.stringify(warnings)}`)
	assert.equal(inspect(r.scene).overlaps.filter((o) => o.depth > 0.0004).length, 0, "the solver's own overlap check")
	if (run) r.sim = simulate({ ...r.scene, seconds: Math.min(r.scene.seconds, 1.5) })
	return r
}

// ================================================================ the geometry kernel
test("liftOver: a box on a box is the difference of their faces", () => {
	near(liftOver(sq(0, 0, 1, 1), sq(0.5, -2, 2, -1)), -1, 1e-12)
	near(liftOver(sq(0, 0, 1, 1), sq(0.5, -0.25, 2, 0.5)), 0.5, 1e-12)
	assert.equal(liftOver(sq(0, 0, 1, 1), sq(2, 0, 3, 1)), -Infinity, "no vertical line meets both")
})

test("liftOver: a ball on a slope rests at r / cos(slope) above the face line", () => {
	const th = (20 * Math.PI) / 180
	const ramp = poly([[-1, -1], [1, -1], [1, Math.tan(th) * 1], [-1, -Math.tan(th) * 1]], true)
	const r = 0.05
	const b = circ(0.2, 0, r)
	const L = liftOver(b, ramp)
	const restY = 0 + L
	const faceY = Math.tan(th) * 0.2
	near(restY - faceY, r / Math.cos(th), 1e-9, "centre above the face")
})

test("slackRight: a ball against a wall and against a slope", () => {
	near(slackRight(circ(0, 0, 0.1), sq(0.3, -1, 0.4, 1)), 0.2, 1e-9)
	// a wedge rising to the right: the ball touches its face, not its corner
	const wedge = poly([[0.5, 0], [1.5, 0], [1.5, 1]])
	const b = circ(0, 0.3, 0.1)
	const s = slackRight(b, wedge)
	const moved = circ(s, 0.3, 0.1)
	near(penetration(moved, wedge), 0, 1e-7, "touching after the slide")
	assert.ok(penetration(circ(s + 1e-4, 0.3, 0.1), wedge) > 0, "and overlapping a hair further")
})

test("penetration: apart is 0, overlaps measure their depth", () => {
	assert.equal(penetration(sq(0, 0, 1, 1), sq(1.1, 0, 2, 1)), 0)
	near(penetration(sq(0, 0, 1, 1), sq(0.9, 0, 2, 1)), 0.1, 1e-12)
	near(penetration(circ(0, 0, 1), circ(1.5, 0, 1)), 0.5, 1e-12)
	near(penetration(circ(0, 1.05, 0.1), sq(-1, -1, 1, 1)), 0.05, 1e-12)
	near(vspan(circ(0, 0, 1), 0.6)[1], 0.8, 1e-12)
})

test("restGap: the engine's resting distances (measured: 1.5 mm between polygons, 0.5 mm ball on polygon, none between fixed things)", () => {
	near(restGap(sq(0, 0, 1, 1), sq(0, 0, 1, 1, true)), 1.5 * MM, 1e-12)
	near(restGap(circ(0, 0, 1), sq(0, 0, 1, 1, true)), 0.5 * MM, 1e-12)
	assert.equal(restGap(circ(0, 0, 1), circ(0, 0, 1)), 0)
	assert.equal(restGap(sq(0, 0, 1, 1, true), sq(0, 0, 1, 1, true)), 0)
})

test("itemGeometry: every catalog type's outline at a pose is where the builder puts it (rigid types turned, the rest built at that angle)", () => {
	const x = 0.73
	const y = 0.41
	let n = 0
	let nonRigid = []
	for (const key of Object.keys(TYPES)) {
		let g
		try {
			g = itemGeometry(key)
		} catch {
			continue // (a type that can't be built at its defaults is the catalog's concern)
		}
		if (!g.rigid) nonRigid.push(key)
		for (const A of [17, -40, 120]) {
			const { doc } = build({ stage: { ...DEFAULT_STAGE }, items: [{ id: "g", type: key, x, y, angle: A, props: {} }] })
			const w = _world_poses(doc)
			const sh = shapesAt(g, x, y, A)
			assert.equal(doc.solids.length, sh.length, `${key} at ${A}°`)
			doc.solids.forEach((s, i) => {
				const [wx, wy, wa] = w.get(s.id)
				const q = sh[i]
				if (q.k === "circle") {
					near(q.cx, wx, 2e-5, `${key} ${s.id} x at ${A}°`)
					near(q.cy, wy, 2e-5, `${key} ${s.id} y at ${A}°`)
				} else if (s.body.kind === "slab" && !s.body.taper) {
					// a slab's corners are its pose's: the middle of its outline is the solid's world position
					const cx = q.p.reduce((a, p) => a + p[0], 0) / 4
					const cy = q.p.reduce((a, p) => a + p[1], 0) / 4
					near(cx, wx, 2e-5, `${key} ${s.id} x at ${A}°`)
					near(cy, wy, 2e-5, `${key} ${s.id} y at ${A}°`)
					near(Math.atan2(q.p[1][1] - q.p[0][1], q.p[1][0] - q.p[0][0]), Math.atan2(Math.sin(wa), Math.cos(wa)), 2e-5, `${key} ${s.id} angle at ${A}°`)
				}
			})
		}
		n++
	}
	assert.ok(n >= 100, `checked ${n} types`)
	assert.ok(nonRigid.includes("pendulum"), `the pendulum's hanger stays level, so it is built at its angle (non-rigid: ${nonRigid.join(", ")})`)
})

// ================================================================ placements
test("five stacked books: each rests on the one below at the resting distance, straight above it, and stays put when run", () => {
	const plan = { title: "Five books", items: [1, 2, 3, 4, 5].map((i) => ({ id: `b${i}`, type: "hardcover-book", place: i === 1 ? { on: "table", x: 1.0 } : { on: `b${i - 1}` } })) }
	const r = solved(plan)
	assert.ok(r.ok)
	const ins = inspect(r.scene)
	near(ins.gap("b1", "table"), POLY_REST, 1e-6, "b1 on the table")
	for (let i = 2; i <= 5; i++) {
		near(ins.gap(`b${i}`, `b${i - 1}`), POLY_REST, 1e-6, `b${i} on b${i - 1}`)
		near(item(r, `b${i}`).x, 1.0, 1e-9)
	}
	assert.ok(maxDrift(r.sim, ["b1", "b2", "b3", "b4", "b5"]) < 0.3 * MM, `the stack drifted ${maxDrift(r.sim, ["b1", "b2", "b3", "b4", "b5"])} m`)
})

test("a ball on a ramp leaning on a box: the ramp rests on the box's corner and the table, the ball on the ramp", () => {
	const plan = {
		title: "Ramp on a box",
		items: [
			{ id: "box", type: "cardboard-box", place: { on: "table", x: 0.5 } },
			{ id: "ramp", type: "plank", place: { lean: { from: { on: "box", x: 0.5 }, to: { on: "table", x: 1.3 } } } },
			{ id: "ball", type: "tennis-ball", held: true, place: { on: "ramp", x: 0.8 } }
		]
	}
	const r = solved(plan)
	assert.ok(r.ok, JSON.stringify(r.errors))
	const ins = inspect(r.scene)
	const ramp = item(r, "ramp")
	assert.ok(ramp.angle < -5 && ramp.angle > -30, `ramp angle ${ramp.angle}`)
	near(ins.gap("ramp", "box"), POLY_REST, 1e-6, "ramp on the box (static on a moving box: its skin)")
	near(ins.gap("ramp", "table"), 0, 2e-6, "ramp's low end on the table (two fixed things touch)")
	near(ins.gap("ball", "ramp"), BALL_REST, 1e-5, "ball on the ramp")
	assert.equal(ramp.props.legs, false, "a leaning ramp has no legs through its supports")
	// the ball is held, then rolls down the ramp
	const sim = simulate({ ...r.scene, seconds: 1.5 })
	const f0 = sim.track.frames[0].placements["ball/ball"]
	const fl = sim.track.frames.at(-1).placements["ball/ball"]
	assert.ok(fl.x - f0.x > 0.15, `the ball rolled ${fl.x - f0.x} m`)
})

test("a lean without a length spans its supports; a given length is kept (centred over a level span)", () => {
	const plan = (props) => ({ title: "Bridge", items: [
		{ id: "a", type: "wooden-block", place: { on: "table", x: 0.6 } },
		{ id: "b", type: "wooden-block", place: { on: "table", x: 1.4 } },
		{ id: "bridge", type: "plank", props, place: { lean: { from: { on: "a" }, to: { on: "b" } } } }
	] })
	const r = solved(plan({}))
	const p = item(r, "bridge")
	near(p.angle, 0, 1e-9, "level")
	near(p.props.length, 0.8, 1e-6, "spans block centre to block centre")
	const ins = inspect(r.scene)
	near(ins.gap("bridge", "a"), POLY_REST, 1e-6)
	near(ins.gap("bridge", "b"), POLY_REST, 1e-6)
	const long = solved(plan({ length: 1.2 }), { run: false })
	const q = item(long, "bridge")
	assert.equal(q.props.length, 1.2, "kept")
	near(q.x, 1.0, 1e-6, "centred between the blocks")
	const short = solved(plan({ length: 0.3 }), { run: false })
	near(item(short, "bridge").props.length, 0.8, 1e-6, "too short to reach: lengthened")
	assert.ok(short.issues.some((i) => i.code === "lean_length"))
})

test("a lean with one end held in the air: the end is at that height above the table, the other on the table; it keeps its legs", () => {
	const r = solved({ title: "Air ramp", items: [{ id: "ramp", type: "plank", place: { on: "air", lean: { from: { on: "air", x: 0.2, y: 0.4 }, to: { on: "table", x: 1.0 } } } }] }, { run: false })
	const ins = inspect(r.scene)
	const b = ins.box("ramp")
	near(b.y1, 0.4 + 0.022 * Math.cos(Math.atan2(0.4, 0.8)), 2e-3, "the high end's underside at 0.4 m")
	near(ins.gap("ramp", "table"), 0, 2e-6, "the low end on the table")
	assert.equal(item(r, "ramp").props.legs, undefined, "legs stay (the default): they hold the raised end")
	near(item(r, "ramp").props.length, Math.hypot(0.8, 0.4), 1e-6)
})

test("a domino row ending at a ramp: the row's last domino is the asked gap from the ramp's foot", () => {
	const r = solved({ title: "Dominoes to a ramp", items: [
		{ id: "ramp", type: "plank", place: { on: "table", x: 1.6, angle_deg: 15 } },
		{ id: "row", type: "domino-row", props: { count: 6, first_height: 0.06 }, place: { on: "table", left_of: { id: "ramp", gap_m: 0.01 } } }
	] })
	const ins = inspect(r.scene)
	near(ins.box("ramp").x0 - ins.box("row").x1, 0.01, 1e-7, "gap")
	near(ins.gap("row", "table"), POLY_REST, 1e-6)
	const story = r.sim.summary.stories.find((s) => s.item === "row")
	assert.equal(story.text, "0 of 6 fall", "the row stands")
})

test("touching: a ball against a block sits at the resting distance, a ball against a slope touches its face", () => {
	const r = solved({ title: "Touching", items: [
		{ id: "blk", type: "wooden-block", place: { on: "table", x: 1.0 } },
		{ id: "ball", type: "superball", place: { on: "table", left_of: { id: "blk" }, align: "touching" } },
		{ id: "wedge", type: "wedge", fixed: true, place: { on: "table", x: 2.0 } },
		{ id: "b2", type: "glass-marble", place: { on: "table", left_of: { id: "wedge", gap_m: 0 } } }
	] })
	const ins = inspect(r.scene)
	near(ins.slack("ball", "blk"), BALL_REST, 1e-6, "ball to block")
	near(ins.slack("b2", "wedge"), BALL_REST, 1e-6, "marble to the wedge's foot")
	assert.ok(maxDrift(r.sim, ["blk"]) < 0.3 * MM, "the block stays")
})

test("right_of with a gap: the boxes' gap is exact", () => {
	const r = solved({ title: "Gap", items: [
		{ id: "a", type: "brick", place: { on: "table", x: 0.8 } },
		{ id: "b", type: "soda-can", place: { on: "table", right_of: { id: "a", gap_m: 0.137 } } }
	] })
	const ins = inspect(r.scene)
	near(ins.box("b").x0 - ins.box("a").x1, 0.137, 1e-8)
})

test("a cup on a table with a ball inside: the ball rests on the cup's floor between its walls, and the goal is met", () => {
	const r = solved({ title: "Marble in a cup", items: [
		{ id: "cup", type: "cup", place: { on: "table", x: 2.0 } },
		{ id: "m", type: "glass-marble", place: { inside: "cup" } }
	], goals: [{ label: "The marble is in the cup", item: "m", container: "cup" }] })
	assert.ok(r.ok, JSON.stringify(r.errors))
	const ins = inspect(r.scene)
	near(ins.gap("m", "cup"), BALL_REST, 1e-5, "marble on the cup's floor")
	near(item(r, "m").x, 2.0, 1e-9, "centred")
	near(ins.gap("cup", "table"), 0, 2e-6, "cup on the table")
	assert.equal(r.scene.goals.length, 1)
	assert.equal(r.sim.summary.goals[0].ok, true, "the engine's goal check")
})

test("three balls in a bucket pile up inside it", () => {
	const r = solved({ title: "Bucket", items: [
		{ id: "bk", type: "bucket", place: { on: "table", x: 1.2 } },
		{ id: "a", type: "tennis-ball", place: { inside: "bk", x: 1.2 } },
		{ id: "b", type: "tennis-ball", place: { inside: "bk", x: 1.2 } },
		{ id: "c", type: "tennis-ball", place: { inside: "bk", x: 1.2 } }
	] })
	const ys = ["a", "b", "c"].map((id) => item(r, id).y)
	assert.ok(ys[0] < ys[1] && ys[1] < ys[2], `piled: ${ys}`)
	const { doc } = layout(r.scene)
	const poses = new Map([..._world_poses(doc)].map(([k, v]) => [k, [v[0], v[1]]]))
	for (const id of ["a", "b", "c"]) assert.ok(inside(r.scene, doc, poses, id, "bk"), `${id} inside`)
})

test("items on a seesaw: a block lies along its tilt, a ball rests on it", () => {
	const r = solved({ title: "Seesaw", items: [
		{ id: "ss", type: "seesaw", place: { on: "table", x: 1.5 } },
		{ id: "blk", type: "wooden-block", props: { width: 0.06 }, place: { on: "ss", x: 1.35 } },
		{ id: "ball", type: "steel-ball", held: true, place: { on: "ss", x: 1.65 } }
	] })
	const ins = inspect(r.scene)
	const tilt = r.scene.items.find((i) => i.id === "ss").props.tilt ?? 12.452
	near(item(r, "blk").angle, -tilt, 1e-4, "block along the plank (the builder keeps its angle to 1e-6 rad)")
	// (resting distances along the plank's normal, as the engine's contacts are: a hair more measured straight down)
	const k = 1 / Math.cos((tilt * Math.PI) / 180)
	near(ins.gap("blk", "ss"), POLY_REST * k, 2e-5, "block on the plank")
	near(ins.gap("ball", "ss"), BALL_REST * k, 2e-5, "ball on the plank")
	near(item(r, "blk").x, 1.35, 1e-6, "the block's anchor x as asked")
	near(item(r, "ball").x, 1.65, 1e-6, "the ball's anchor x as asked")
	near(ins.gap("ss", "table"), POLY_REST, 1e-5, "the seesaw on the table")
})

test("a car at the top of an inclined plank: along the slope, wholly on the plank, wheels at their resting distance; it rolls down", () => {
	const r = solved({ title: "Car on a ramp", items: [
		{ id: "ramp", type: "plank", place: { on: "table", x: 0.66, angle_deg: -12 } },
		{ id: "car", type: "toy-car", place: { on: "ramp", x: 0.2 } }
	] })
	const car = item(r, "car")
	near(car.angle, -12, 1e-6, "along the ramp")
	const ins = inspect(r.scene)
	near(ins.gap("car", "ramp"), BALL_REST, 2e-5, "wheels on the ramp")
	assert.ok(ins.box("car").x0 >= ins.box("ramp").x0 - 1e-6, "not hanging off the top end")
	near(item(r, "ramp").y, 0.11472, 1e-5, "the ramp's foot on the table (the built-in scenario's numbers)")
	const f0 = r.sim.track.frames[0].placements["car/chassis"]
	const fl = r.sim.track.frames.at(-1).placements["car/chassis"]
	assert.ok(fl.x - f0.x > 0.3, `the car rolled ${fl.x - f0.x} m`)
})

test("a ball on a wedge's slope rests on the face", () => {
	const r = solved({ title: "Wedge", items: [
		{ id: "w", type: "wedge", fixed: true, place: { on: "table", x: 1 } },
		{ id: "b", type: "superball", held: true, place: { on: "w", x: 1.02 } }
	] })
	near(inspect(r.scene).gap("b", "w"), BALL_REST, 1e-5)
})

test("held in the air: y_m is the anchor's height; bottom_m the lowest point's height above the table", () => {
	const r = solved({ title: "Drop", items: [
		{ id: "a", type: "bowling-ball", held: true, place: { on: "air", x: 0.5, y_m: 1.0 } },
		{ id: "b", type: "bowling-ball", held: true, place: { on: "air", x: 1.0, bottom_m: 0.5 } },
		{ id: "c", type: "tennis-ball", held: true, place: { on: "air", x: 1.5 } }
	] })
	assert.equal(item(r, "a").y, 1.0, "y_m above the table top (which is at 0)")
	near(item(r, "b").y - 0.109, 0.5, 1e-9)
	assert.ok(item(r, "a").held && item(r, "b").held)
	near(item(r, "c").y - 0.0335, 0.25, 1e-9, "no height: 25 cm above what is under it")
	assert.ok(r.issues.some((i) => i.code === "air_height" && i.item === "c"))
})

test("in the air with a height: exact. A hair inside a plank is lifted clear; deep inside it stays (and is said); legs never raise it", () => {
	// a ball 6 mm into a plank's top: lifted just clear (a nudge)
	const r = solved({ title: "Nudge", items: [
		{ id: "p", type: "plank", place: { on: "air", x: 1, y_m: 0.4 } },
		{ id: "b", type: "superball", held: true, place: { on: "air", x: 1, y_m: 0.4 + 0.011 + 0.03 - 0.006 } }
	] })
	const ins = inspect(r.scene)
	assert.ok(ins.gap("b", "p") > 0 && ins.gap("b", "p") < 0.003, `clear by ${ins.gap("b", "p")}`)
	assert.ok(r.issues.some((i) => i.code === "moved" && i.item === "b"))
	// asked to be right inside it: kept exactly where asked, and said
	const deep = solve({ title: "Deep", items: [
		{ id: "p", type: "plank", place: { on: "air", x: 1, y_m: 0.4 } },
		{ id: "b", type: "superball", held: true, place: { on: "air", x: 1, y_m: 0.4 } }
	] })
	assert.equal(item(deep, "b").y, 0.4, "exactly at its y_m")
	assert.ok(deep.issues.some((i) => i.level === "warn" && i.code === "overlap" && i.item === "b"), "the overlap is a warning")
	// J18: a funnel given its height where a feed ramp's leg stands: the funnel stays at its height; the leg is named
	const j18 = solve({ title: "Funnel", items: [
		{ id: "ramp", type: "plank", name: "Feed ramp", place: { lean: { from: { on: "air", x: 0.6, y: 0.72 }, to: { on: "air", x: 1.1, y: 0.5 } } } },
		{ id: "funnel", type: "funnel", name: "Funnel", place: { on: "air", x: 1.12, y_m: 0.45 } }
	] })
	near(item(j18, "funnel").y, 0.45, 1e-9, "the funnel is exactly where it was asked to be")
	assert.ok(!j18.issues.some((i) => i.code === "moved" && i.item === "funnel"), "not raised")
	assert.ok(j18.issues.some((i) => i.code === "leg_through" && i.item === "funnel" && /Feed ramp's leg goes through Funnel/.test(i.text)), JSON.stringify(j18.issues))
})

test("held up: a static cup, funnel or legless ramp in mid-air floats (a warning, with supports off); on a support, on legs or hung it does not", () => {
	const floats = (plan) => solve(plan, { supports: false }).issues.filter((i) => i.code === "floats" || i.code === "floats_end").map((i) => i.item)
	assert.deepEqual(floats({ title: "Cup", items: [{ id: "cup", type: "cup", place: { on: "air", x: 1, y_m: 0.15 } }] }), ["cup"])
	assert.deepEqual(floats({ title: "Funnel", items: [{ id: "f", type: "funnel", place: { on: "air", x: 1, y_m: 0.45 } }] }), ["f"])
	assert.deepEqual(floats({ title: "Legless", items: [{ id: "r", type: "plank", props: { legs: false }, place: { lean: { from: { on: "air", x: 0.6, y: 0.74 }, to: { on: "air", x: 1.1, y: 0.52 } } } }] }), ["r"])
	assert.deepEqual(floats({ title: "Half", items: [{ id: "r", type: "plank", props: { legs: false }, place: { lean: { from: { on: "air", x: 0.2, y: 0.4 }, to: { on: "table", x: 1.0 } } } }] }), ["r"], "a ramp held only at its foot")
	assert.deepEqual(floats({ title: "Legs", items: [{ id: "r", type: "plank", place: { lean: { from: { on: "air", x: 0.6, y: 0.74 }, to: { on: "air", x: 1.1, y: 0.52 } } } }] }), [], "legs hold it up")
	assert.deepEqual(floats({ title: "Hung", items: [{ id: "bx", type: "box", place: { on: "air", x: 1, y_m: 0.5 } }] }), [], "a box hangs from its cords")
	assert.deepEqual(floats({ title: "On a stack", items: [
		{ id: "b1", type: "brick", fixed: true, place: { on: "table", x: 1 } },
		{ id: "b2", type: "brick", fixed: true, place: { on: "b1" } },
		{ id: "cup", type: "cup", place: { on: "b2" } }
	] }), [], "a cup on a fixed brick stack stands")
	assert.deepEqual(floats({ title: "Shelf", items: [
		{ id: "shelf", type: "plank", props: { length: 0.4 }, place: { on: "air", x: 1.5, y_m: 0.3 } },
		{ id: "cup", type: "cup", place: { on: "shelf" } }
	] }), [], "a cup on a legged shelf stands")
	assert.deepEqual(floats({ title: "Leaning", items: [
		{ id: "bx", type: "cardboard-box", place: { on: "table", x: 0.3 } },
		{ id: "r", type: "plank", place: { lean: { from: { on: "bx", x: 0.3 }, to: { on: "table", x: 1.2 } } } }
	] }), [], "a ramp leaning on a box rests at both ends")
	assert.deepEqual(floats({ title: "Pegs", items: [{ id: "pg", type: "peg-board", place: { on: "air", x: 1, y_m: 0.4 } }] }), [], "pegs are held by their board")
})

test("supports: nothing static is left floating: legs back on, cords, or a fixed wooden stand from the table up to its underside (a funnel's outlet stays clear)", () => {
	const sup = (plan) => {
		const r = solve(plan)
		assert.ok(!r.issues.some((i) => i.code === "floats" || i.code === "floats_end"), `nothing floats: ${r.issues.map((i) => i.text).join("; ")}`)
		assert.deepEqual(inspect(r.scene).overlaps.filter((o) => o.depth > 0.0005), [], "the stand goes through nothing")
		return r
	}
	// a cup asked for at 15 cm: exactly there, on a stand whose top is its bottom and whose foot is on the table
	const c = sup({ title: "Cup", items: [{ id: "cup", type: "cup", place: { on: "air", x: 1, y_m: 0.15 } }] })
	near(item(c, "cup").y, 0.15, 1e-9, "the cup stays where it was asked")
	const st = item(c, "cup-stand")
	assert.ok(st && st.type === "wooden-block" && st.fixed === true, "a fixed wooden block")
	const ins = inspect(c.scene)
	near(ins.box("cup-stand").y0, 0, 1e-6, "on the table")
	near(ins.box("cup-stand").y1, ins.box("cup").y0, 1e-6, "up to the cup's bottom")
	assert.deepEqual(c.supports, [{ id: "cup-stand", for: "cup" }])
	assert.ok(c.issues.some((i) => i.code === "support_added" && i.item === "cup"), "and said")
	// a funnel: two posts under its rim, the outlet clear
	const f = sup({ title: "Funnel", items: [{ id: "f", type: "funnel", place: { on: "air", x: 1, y_m: 0.45 } }] })
	const fi = inspect(f.scene)
	const posts = f.scene.items.filter((i) => i.id.startsWith("f-stand"))
	assert.equal(posts.length, 2)
	for (const p of posts) assert.ok(Math.abs(p.x - 1) > 0.1, "away from the outlet")
	near(fi.box(posts[0].id).y0, 0, 1e-6)
	// a ramp in the air with its legs off: they go back on (no stand); a box with its cords off: hung again
	const r = sup({ title: "Legless", items: [{ id: "r", type: "plank", props: { legs: false }, place: { lean: { from: { on: "air", x: 0.6, y: 0.74 }, to: { on: "air", x: 1.1, y: 0.52 } } } }] })
	assert.equal(item(r, "r").props.legs, undefined, "legs back to the default (on)")
	assert.equal(r.scene.items.filter((i) => /stand/.test(i.id)).length, 0)
	const b = sup({ title: "Box", items: [{ id: "bx", type: "box", props: { hung: false }, place: { on: "air", x: 1, y_m: 0.5 } }] })
	assert.equal(item(b, "bx").props.hung, undefined, "hung again")
	// a stand would go through the ball under the cup: none is added, and the warning stays for the critic
	const blocked = solve({ title: "Blocked", items: [{ id: "ball", type: "bowling-ball", place: { on: "table", x: 1 } }, { id: "cup", type: "cup", place: { on: "air", x: 1, y_m: 0.4 } }] })
	assert.ok(blocked.issues.some((i) => i.code === "floats" && i.item === "cup"))
	assert.equal(blocked.scene.items.filter((i) => /stand/.test(i.id)).length, 0)
	// on a fixed brick that is itself on a stand: one stand, under the brick; the cup rests on the brick
	const s2 = sup({ title: "Stack", items: [{ id: "br", type: "brick", fixed: true, place: { on: "air", x: 1.5, y_m: 0.3 } }, { id: "cup", type: "cup", place: { on: "br" } }] })
	assert.deepEqual(s2.supports, [{ id: "br-stand", for: "br" }])
	// the scene runs with everything at rest
	const sim = simulate(c.scene)
	assert.ok(maxDrift(sim, ["cup", "cup-stand"]) < 0.002)
})

test("goals of every kind are kept (ids as solved); the scene's own goals are only the 'in' ones the engine checks", () => {
	const r = solve({ title: "Goals", items: [
		{ id: "row", type: "domino-row", place: { on: "table", x: 1 } },
		{ id: "ball", type: "golf-ball", place: { on: "table", x: 0.5 } },
		{ id: "cup", type: "cup", place: { on: "table", x: 2.2 } }
	], goals: [{ kind: "falls", items: ["row"], label: "all the dominoes fall" }, { kind: "hits", item: "ball", target: "row", before_s: 2 }, { kind: "moves", item: "ball", min_m: 0.3 }, { label: "in", item: "ball", container: "cup" }, { kind: "falls", item: "ghost" }] })
	assert.deepEqual(r.scene.goals, [{ kind: "in", item: "ball", container: "cup", label: "in" }])
	assert.deepEqual(r.goals.map((g) => g.kind), ["falls", "hits", "moves", "in"])
	assert.deepEqual(r.goals[0], { kind: "falls", items: ["row"], label: "all the dominoes fall" })
	assert.equal(r.goals[1].target, "row")
	assert.equal(r.goals[1].before_s, 2)
	assert.match(r.goals[1].label, /hits/)
	assert.equal(r.issues.filter((i) => i.code === "goal_ref").length, 1, "only the goal naming a missing item is left out")
})

test("seats: a ball on a spring launcher tilted -53° rests on its plate between the guides, at the low guide; level, in the plate's middle", () => {
	const plate = (r, id) => {
		const ins = inspect(r.scene)
		const L = r.scene.items.find((i) => i.id === id)
		const g = itemGeometry("spring-launcher", L.props ?? {})
		const sh = shapesAt(g, L.x, L.y, L.angle)
		const k = g.parts.findIndex((p) => p.name === "plate")
		const gi = g.parts.map((p, i) => (p.name.startsWith("guide") ? i : -1)).filter((i) => i >= 0)
		return { ins, P: sh[k].p, guides: gi.map((i) => sh[i]) }
	}
	const along = (P, x, y) => {
		// the ball's centre in the plate's frame: u along its top face from its middle, v up from it
		const [tl, tr] = [P[3], P[2]]
		const ux = (tr[0] - tl[0]) / Math.hypot(tr[0] - tl[0], tr[1] - tl[1])
		const uy = (tr[1] - tl[1]) / Math.hypot(tr[0] - tl[0], tr[1] - tl[1])
		const mx = (tl[0] + tr[0]) / 2
		const my = (tl[1] + tr[1]) / 2
		return { u: (x - mx) * ux + (y - my) * uy, v: -(x - mx) * uy + (y - my) * ux, half: Math.hypot(tr[0] - tl[0], tr[1] - tl[1]) / 2 }
	}
	const R = 0.02 // a ping-pong ball's radius
	for (const [angle, held] of [[-53, false], [-53, true], [0, false], [30, false]]) {
		const r = solved({ title: "Launch", items: [
			{ id: "L", type: "spring-launcher", place: { on: "table", x: 0.5, angle_deg: angle } },
			{ id: "ball", type: "ping-pong-ball", held, place: { on: "L" } }
		] }, { run: false })
		const b = item(r, "ball")
		const { ins, P, guides } = plate(r, "L")
		const a = along(P, b.x, b.y)
		near(a.v - R, BALL_REST, 1e-6, `${angle}°${held ? " held" : ""}: on the plate's face at the resting distance (along its normal)`)
		assert.ok(Math.abs(a.u) <= a.half - R + 1e-6, `${angle}°: between the guides (u ${a.u}, half ${a.half})`)
		for (const gq of guides) assert.ok(penetration({ k: "circle", cx: b.x, cy: b.y, r: R, x0: b.x - R, y0: b.y - R, x1: b.x + R, y1: b.y + R, st: false, sk: 0 }, gq) === 0, `${angle}°: clear of the guides`)
		assert.equal(ins.overlaps.filter((o) => o.depth > 0.0004).length, 0)
		if (angle === 0 || held) near(a.u, 0, 1e-6, `${angle}°${held ? " held" : ""}: in the plate's middle`)
		else assert.ok(Math.abs(a.u) > a.half - R - 0.01, `${angle}°: at the low end (u ${a.u})`)
		if (angle === -53 && !held) assert.ok(a.u > 0, "a plate turned clockwise is lower at its right end")
	}
	// it runs: the unheld ball stays on the tilted plate until the release, then flies off it (forward, not backwards off the launcher)
	const r = solved({ title: "Launch", seconds: 1.5, items: [
		{ id: "L", type: "spring-launcher", place: { on: "table", x: 0.5, angle_deg: -53 } },
		{ id: "ball", type: "ping-pong-ball", place: { on: "L" } }
	] })
	const f = r.sim.track.frames
	const at = (t) => f.find((fr) => fr.t >= t)?.placements["ball/ball"] ?? f.at(-1).placements["ball/ball"]
	const b0 = at(0)
	const bRel = at(0.45)
	assert.ok(Math.hypot(bRel.x - b0.x, bRel.y - b0.y) < 0.005, `waits on the plate until the release (moved ${Math.hypot(bRel.x - b0.x, bRel.y - b0.y)} m)`)
	assert.ok(at(0.75).x > b0.x + 0.05, "flung to the right, the way the launcher points")
})

test("seats: a ball on a spring catapult rests on its long arm against the lip; on a seesaw without x, against the lip at its low end", () => {
	const r = solved({ title: "Cat", items: [
		{ id: "cat", type: "spring-catapult", place: { on: "table", x: 0.8 } },
		{ id: "ball", type: "tennis-ball", place: { on: "cat" } },
		{ id: "ss", type: "seesaw", place: { on: "table", x: 2.0 } },
		{ id: "ball2", type: "golf-ball", place: { on: "ss" } }
	] }, { run: false })
	const ins = inspect(r.scene)
	const cat = item(r, "cat")
	assert.ok(item(r, "ball").x < cat.x - 0.15, "on the long (left) end")
	const ss = item(r, "ss")
	assert.ok(item(r, "ball2").x > ss.x + 0.15, "at the seesaw's low (right) end")
	assert.ok(ins.gap("ball", "cat") < 0.002 && ins.gap("ball2", "ss") < 0.002, "resting on them")
	assert.equal(ins.overlaps.filter((o) => o.depth > 0.0004).length, 0)
	// and they stay put until something happens
	const sim = simulate({ ...r.scene, seconds: 0.4, release: 5 })
	assert.ok(maxDrift(sim, ["ball", "ball2"]) < 0.004, `they rest (drift ${maxDrift(sim, ["ball", "ball2"])} m)`)
})

test("two things asked for the same spot: the second moves the least way along the table, still resting on it", () => {
	const r = solved({ title: "Crowded", items: [
		{ id: "a", type: "brick", place: { on: "table", x: 1.0 } },
		{ id: "b", type: "brick", place: { on: "table", x: 1.05 } }
	] })
	const ins = inspect(r.scene)
	assert.ok(item(r, "b").x > 1.05, "moved right (the shorter way)")
	assert.ok(ins.slack("a", "b") > 0, "apart")
	near(ins.gap("b", "table"), POLY_REST, 1e-6)
	assert.ok(r.issues.some((i) => i.code === "moved" && i.item === "b"))
})

test("a plank's legs: a deep book under the ramp's high end is moved off them, a thin domino between them stays", () => {
	const plan = (type) => ({ title: "Legs", items: [
		{ id: "ramp", type: "plank", place: { on: "table", x: 1.0, angle_deg: -15 } },
		{ id: "thing", type, place: { on: "table", x: 0.555 } }
	] })
	const book = solved(plan("hardcover-book"), { run: false })
	assert.ok(Math.abs(item(book, "thing").x - 0.555) > 0.01, "the book moved")
	const dom = solved(plan("domino"), { run: false })
	near(item(dom, "thing").x, 0.555, 1e-9, "the domino passes between the legs")
})

test("dependency order: items listed before their supports are still placed on them", () => {
	const r = solved({ title: "Order", items: [
		{ id: "top", type: "superball", place: { on: "mid" } },
		{ id: "mid", type: "wooden-block", place: { on: "base" } },
		{ id: "base", type: "brick", place: { on: "table", x: 1.7 } }
	] })
	assert.deepEqual(r.order.filter((id) => ["top", "mid", "base"].includes(id)), ["base", "mid", "top"])
	near(inspect(r.scene).gap("top", "mid"), BALL_REST, 1e-5)
})

test("content off the table is shifted onto it; content wider than the table widens it", () => {
	const off = solved({ title: "Off", items: [{ id: "a", type: "brick", place: { on: "table", x: 5 } }] }, { run: false })
	const t = item(off, "table")
	const ins = inspect(off.scene)
	assert.ok(ins.box("a").x1 <= t.x + 1.85, "on the table")
	assert.ok(off.issues.some((i) => i.code === "shifted"))
	const wide = solved({ title: "Wide", items: [
		{ id: "a", type: "brick", place: { on: "table", x: -1.5 } },
		{ id: "b", type: "brick", place: { on: "table", x: 3.5 } }
	] }, { run: false })
	const T = item(wide, "table")
	assert.ok(T.props.width > 3.7)
	const W = inspect(wide.scene)
	assert.ok(W.box("a").x0 >= T.x - T.props.width / 2 && W.box("b").x1 <= T.x + T.props.width / 2)
	assert.ok(wide.scene.stage.x0 <= W.box("a").x0 && wide.scene.stage.x1 >= W.box("b").x1, "the stage holds it all")
})

test("safety walls stand at the table's ends unless the plan has walls there", () => {
	const r = solved({ title: "Walls", items: [{ id: "a", type: "brick", place: { on: "table", x: 1 } }] }, { run: false })
	const walls = r.scene.items.filter((i) => i.type === "wall")
	assert.deepEqual(walls.map((w) => w.x), [-0.52, 3.12])
	assert.ok(walls.every((w) => w.props.invisible_in_3d === true))
	assert.deepEqual(r.scene.stage, { ...DEFAULT_STAGE }, "the default table keeps the default stage")
	const own = solve({ title: "Own wall", items: [{ id: "w", type: "wall", place: { on: "table", x: 3.1 } }] })
	assert.equal(own.scene.items.filter((i) => i.type === "wall").length, 2, "its own wall on the right, a safety wall on the left")
	assert.equal(solve({ title: "None", items: [] }, { safetyWalls: false }).scene.items.length, 1, "just the table")
})

test("goals: kept for the containers the engine checks, a glass jar's by its walls (the engine's \"walls\" kind), left out (with a warning) for unknown ids", () => {
	const r = solve({ title: "Goals", items: [
		{ id: "box", type: "box", place: { on: "table", x: 2 } },
		{ id: "jar", type: "glass-jar", place: { on: "table", x: 1 } },
		{ id: "b", type: "superball", place: { on: "air", x: 2, y_m: 0.6 } }
	], goals: [{ label: "in the box", item: "b", container: "box" }, { label: "in the jar", item: "b", container: "jar" }, { label: "?", item: "zz", container: "box" }] })
	assert.deepEqual(r.scene.goals, [{ kind: "in", item: "b", container: "box", label: "in the box" }, { kind: "walls", item: "b", container: "jar", label: "in the jar" }])
	assert.ok(r.issues.some((i) => i.code === "goal_unchecked"))
	assert.ok(r.issues.some((i) => i.code === "goal_ref"))
})

test("props: out-of-range numbers are clamped, unknown keys and bad values dropped, all reported; defaults are not stored", () => {
	const r = solve({ title: "Props", items: [{ id: "b", type: "superball", props: { diameter: 5, colour: "red", hollow: "maybe" }, place: { on: "table", x: 1 } },
		{ id: "d", type: "domino", props: { height: 0.05 }, place: { on: "table", x: 2 } }] })
	assert.equal(item(r, "b").props.diameter, 1)
	assert.ok(r.issues.some((i) => i.code === "clamped_prop"))
	assert.ok(r.issues.some((i) => i.code === "unknown_prop"))
	assert.deepEqual(item(r, "d").props, {}, "the default height is not stored")
})

test("ids: a '/' is replaced, a repeated id gets a new one and references go to the first", () => {
	const r = solve({ title: "Ids", items: [
		{ id: "a/b", type: "brick", place: { on: "table", x: 1 } },
		{ id: "x", type: "brick", place: { on: "table", x: 2 } },
		{ id: "x", type: "superball", place: { on: "x" } }
	] })
	assert.ok(item(r, "a-b"))
	assert.ok(item(r, "x-2"))
	near(item(r, "x-2").x, 2, 1e-9, "on the first x")
})

test("determinism: the same plan solves to the same scene", () => {
	const plan = JSON.parse(readFileSync(new URL("./fixtures/rube.plan.json", import.meta.url)))
	assert.equal(JSON.stringify(solve(plan).scene), JSON.stringify(solve(plan).scene))
})

test("a whole Rube Goldberg plan solves cleanly, runs, and its goal is met", () => {
	const plan = JSON.parse(readFileSync(new URL("./fixtures/rube.plan.json", import.meta.url)))
	const r = solved(plan, { run: false })
	assert.ok(r.ok, JSON.stringify(r.errors))
	const sim = simulate(r.scene)
	assert.ok(sim.summary.events.length >= 3, `events: ${sim.summary.events.map((e) => e.text).join("; ")}`)
})

// ================================================================ impossible plans: clear errors
test("an unknown type is an error; the item is left out and what rests on it goes on the table", () => {
	const r = solve({ title: "Unknown", items: [{ id: "cat", type: "cat", place: { on: "table", x: 1 } }, { id: "b", type: "superball", place: { on: "cat" } }] })
	assert.equal(r.ok, false)
	assert.ok(r.errors.some((e) => e.code === "unknown_type"))
	assert.ok(!item(r, "cat"))
	assert.ok(r.issues.some((i) => i.code === "dropped_ref" && i.item === "b"))
	near(inspect(r.scene).gap("b", "table"), BALL_REST, 1e-5)
})

test("a cycle of supports is an error naming the loop; the rest is still placed", () => {
	const r = solve({ title: "Cycle", items: [
		{ id: "a", type: "brick", place: { on: "b" } },
		{ id: "b", type: "brick", place: { on: "c" } },
		{ id: "c", type: "brick", place: { on: "a" } }
	] })
	assert.equal(r.ok, false)
	const e = r.errors.find((x) => x.code === "cycle")
	assert.ok(e && /→/.test(e.text), e?.text)
	assert.equal(layout(r.scene).warnings.length, 0)
	const ins = inspect(r.scene)
	assert.ok(["a", "b", "c"].every((id) => item(r, id)))
	assert.ok(ins.gap("b", "c") !== null || ins.gap("c", "a") !== null)
})

test("unknown references and self references are errors", () => {
	const r = solve({ title: "Refs", items: [{ id: "a", type: "brick", place: { on: "nothing" } }, { id: "b", type: "brick", place: { on: "b" } }, { id: "c", type: "brick", place: { on: "table", right_of: { id: "ghost", gap_m: 0.1 } } }] })
	assert.equal(r.ok, false)
	assert.ok(r.errors.some((e) => e.code === "unknown_ref" && e.item === "a"))
	assert.ok(r.errors.some((e) => e.code === "self_reference" && e.item === "b"))
	assert.ok(r.errors.some((e) => e.code === "unknown_ref" && e.item === "c"))
	assert.equal(layout(r.scene).warnings.length, 0)
})

test("something too big for its container is an error", () => {
	const r = solve({ title: "Too big", items: [{ id: "cup", type: "cup", place: { on: "table", x: 1 } }, { id: "bb", type: "bowling-ball", place: { inside: "cup" } }] })
	assert.equal(r.ok, false)
	assert.ok(r.errors.some((e) => e.code === "too_big" && e.item === "bb"))
})

test("a lean onto the table without saying where is an error", () => {
	const r = solve({ title: "Lean", items: [{ id: "box", type: "cardboard-box", place: { on: "table", x: 1 } }, { id: "p", type: "plank", place: { lean: { from: { on: "box" }, to: { on: "table" } } } }] })
	assert.equal(r.ok, false)
	assert.ok(r.errors.some((e) => e.code === "lean_x"))
})

test("plans that aren't plans are refused outright", () => {
	assert.throws(() => solve(null), SolveError)
	assert.throws(() => solve({ title: "x" }), SolveError)
	assert.throws(() => solve({ items: Array.from({ length: 201 }, (_, i) => ({ id: `b${i}`, type: "brick" })) }), SolveError)
})

// ================================================================ the inverse (follow-up edits)
test("planFromScene: a solved scene's plan solves back to the same scene", () => {
	const plan = JSON.parse(readFileSync(new URL("./fixtures/rube.plan.json", import.meta.url)))
	const a = solve(plan).scene
	const b = solve(planFromScene(a)).scene
	for (const it of a.items) {
		const o = b.items.find((i) => i.id === it.id)
		assert.ok(o, it.id)
		near(o.x, it.x, 2e-6, `${it.id} x`)
		near(o.y, it.y, 2e-6, `${it.id} y`)
		near(o.angle, it.angle, 1e-6, `${it.id} angle`)
	}
})

test("planFromScene: what rests on something follows it when it changes (a taller box lifts the ball on it)", () => {
	const s = solve({ title: "Box and ball", items: [{ id: "box", type: "cardboard-box", place: { on: "table", x: 1 } }, { id: "ball", type: "tennis-ball", place: { on: "box" } }] }).scene
	const plan = planFromScene(s)
	assert.equal(plan.items.find((i) => i.id === "ball").place.on, "box")
	plan.items.find((i) => i.id === "box").props.height = 0.35
	const t = solve(plan)
	near(inspect(t.scene).gap("ball", "box"), BALL_REST, 1e-5)
	near(item(t, "ball").y - item({ scene: s }, "ball").y, 0.15, 1e-6)
})

test("built-in scenarios: their resting items are recognised (planFromScene) and re-solve within a few mm", () => {
	for (const name of ["car-ramp-dominoes", "rube-goldberg", "ball-drop"]) {
		const scene = JSON.parse(readFileSync(new URL(`../../scenarios/${name}.json`, import.meta.url)))
		const r = solve(planFromScene(scene)) // (its safety walls are left out of the plan and put back by the solver)
		for (const it of scene.items) {
			const o = item(r, it.id)
			assert.ok(o, `${name}: ${it.id}`)
			near(o.x, it.x, 0.005, `${name} ${it.id} x`)
			near(o.y, it.y, 0.005, `${name} ${it.id} y`)
		}
	}
})

// ================================================================ real plans (written by the planner model through the gateway, saved from live runs)
test("real plans from the live planner solve cleanly (no overlap warnings) and run", () => {
	for (const name of ["rube", "golf", "bowl", "car", "books"]) {
		const plan = JSON.parse(readFileSync(new URL(`./fixtures/live/${name}.plan.json`, import.meta.url)))
		const r = solve(plan)
		assert.deepEqual(layout(r.scene).warnings, [], `${name}: overlap warnings`)
		assert.deepEqual(r.errors, [], `${name}: errors`)
		const sim = simulate({ ...r.scene, seconds: Math.min(r.scene.seconds, 3) })
		assert.ok(sim.track.frames.length > 100, `${name} ran`)
	}
	// and what they promise: the stack stays put, the goals of the two goal scenes are met
	const books = solve(JSON.parse(readFileSync(new URL("./fixtures/live/books.plan.json", import.meta.url))))
	const sb = simulate(books.scene)
	assert.equal(sb.summary.events.length, 0, "nothing in the book stack moves")
	for (const name of ["rube", "golf"]) {
		const r = solve(JSON.parse(readFileSync(new URL(`./fixtures/live/${name}.plan.json`, import.meta.url))))
		assert.ok(simulate(r.scene).summary.goals.every((g) => g.ok), `${name}: goal met`)
	}
})

test("the view's own stands: a peg's pole (from the table) up through a raised shelf, or a held thing's post far up through a counter, is said (stand_through); a held ball waiting just over its ramp is not", () => {
	const shelf = { id: "shelf", type: "plank", name: "Shelf", props: { length: 0.8, legs: true }, place: { on: "air", x: 1.2, y_m: 0.5 } }
	const r = solve({ title: "Peg", items: [shelf, { id: "peg", type: "peg", name: "Car stop", place: { on: "air", x: 1.2, y_m: 0.6 } }] })
	const w = r.issues.filter((i) => i.code === "stand_through")
	assert.equal(w.length, 1, JSON.stringify(r.issues))
	assert.match(w[0].text, /The pole of the stand that holds Car stop up goes up through Shelf/)
	assert.equal(w[0].level, "warn")
	// a held ball 30 cm over the shelf: its post comes far out of the shelf's top
	const r2 = solve({ title: "Held", items: [shelf, { id: "b", type: "golf-ball", name: "Ball", held: true, place: { on: "air", x: 1.2, y_m: 0.85 } }] })
	assert.match(r2.issues.filter((i) => i.code === "stand_through").map((i) => i.text).join(" "), /The post that holds Ball until the release goes up through Shelf/)
	// the built-in machine (a held ball a few cm over its first ramp) says nothing
	const rube = JSON.parse(readFileSync(new URL("../../scenarios/rube-goldberg.json", import.meta.url)))
	assert.deepEqual(solve(planFromScene(rube)).issues.filter((i) => i.code === "stand_through"), [])
	// nor does a peg standing clear of everything
	const r3 = solve({ title: "Peg", items: [{ ...shelf, place: { on: "air", x: 0.6, y_m: 0.5 } }, { id: "peg", type: "peg", place: { on: "air", x: 1.6, y_m: 0.6 } }] })
	assert.deepEqual(r3.issues.filter((i) => i.code === "stand_through"), [])
})
