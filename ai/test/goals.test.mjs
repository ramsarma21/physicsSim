// ai/goals.mjs: every goal kind on a real run of the built-in Rube Goldberg scene (web/sim + the engine bundle, as POST /api/simulate),
// and the same goals from the run's summary alone.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { before, test } from "node:test"
import { checkGoals, goalKind, goalLabel, FALL_MIN_DEG, FALL_MAX_DEG } from "../goals.mjs"
import { runScene } from "../steps.mjs"

const PG = new URL("../../", import.meta.url)
const scene = JSON.parse(readFileSync(new URL("web/scenarios/rube-goldberg.json", PG), "utf8"))
let run
before(async () => {
	run = await runScene(scene)
})
const GOALS = [
	{ kind: "in", label: "Ball 2 lands in the box", item: "ball2", container: "box" },
	{ kind: "falls", label: "dominoes down", item: "dominoes" },
	{ kind: "hits", label: "superball reaches the row", item: "ball1", target: "dominoes" },
	{ kind: "hits", label: "too early", item: "ball1", target: "dominoes", before_s: 0.2 },
	{ kind: "moves", label: "ball 1 travels", item: "ball1", min_m: 0.5 },
	{ kind: "moves", label: "box never moves", item: "box", min_m: 0.01 },
	{ kind: "falls", label: "ramp never falls", items: ["ramp2"] }
]

test("kinds read from the fields; labels made from them", () => {
	assert.equal(goalKind({ item: "a", container: "b" }), "in")
	assert.equal(goalKind({ item: "a", target: "b" }), "hits")
	assert.equal(goalKind({ item: "a", min_m: 0.1 }), "moves")
	assert.equal(goalKind({ items: ["a", "b"] }), "falls")
	assert.equal(goalLabel({ kind: "moves", item: "cart", min_m: 0.3 }, { cart: "the cart" }), "the cart moves at least 30 cm")
	assert.deepEqual([FALL_MIN_DEG, FALL_MAX_DEG], [20, 85])
})

test("on the whole run every kind is exact: the row falls, the superball hits it, not by 0.2 s, ball 1 travels, the box and the ramp stay", () => {
	const r = checkGoals(GOALS, run)
	assert.deepEqual(r.map((g) => g.ok), [run.summary.goals[0].ok, true, true, false, true, false, false])
	assert.match(r[1].detail, /^7 of 7 fell/)
	assert.ok(r[2].t > 0.2 && r[2].t < scene.seconds)
	assert.ok(r[4].moved_m > 0.5)
	assert.match(r[5].detail, /nothing of it can move/)
})

test("falls: a block knocked off a tower counts though it lands flat (no quarter turn needed); a block only slid along does not", () => {
	// a synthetic run: the top block of a tower drops 10 cm and lands flat (turned 90°: looks the same), a domino tips over, a long block
	// slides 30 cm along the table without turning or dropping, and a block that drops only 1 cm (settling)
	const slab = (id, item, w, h) => ({ id, item, part: "block", kind: "dynamic", body: { kind: "slab", width: w, height: h } })
	const doc = { solids: [slab("s1", "top", 0.05, 0.05), slab("s2", "dom", 0.008, 0.05), slab("s3", "slid", 0.2, 0.05), slab("s4", "settle", 0.05, 0.05)] }
	const P = (x, y, angle) => ({ x, y, angle })
	const track = {
		frames: [
			{ t: 0, placements: { s1: P(1, 0.125, 0), s2: P(2, 0.025, 0), s3: P(3, 0.025, 0), s4: P(4, 0.035, 0) } },
			{ t: 1, placements: { s1: P(1.2, 0.025, Math.PI / 2), s2: P(2.03, 0.004, -Math.PI / 2), s3: P(3.3, 0.025, 0), s4: P(4, 0.025, 0) } }
		],
		impacts: []
	}
	const r = checkGoals(["top", "dom", "slid", "settle"].map((item) => ({ kind: "falls", label: item, item })), { doc, track })
	assert.deepEqual(r.map((g) => g.ok), [true, true, false, false])
	assert.match(r[0].detail, /^1 of 1 fell/)
	const flat = checkGoals([{ kind: "falls", label: "top, no turn", item: "top" }], { doc, track: { ...track, frames: [track.frames[0], { t: 1, placements: { ...track.frames[1].placements, s1: P(1.2, 0.025, 0) } }] } })
	assert.equal(flat[0].ok, true, "dropped 10 cm without turning: knocked down")
	// past its own tipping angle: a domino leaning 40° on the next one (it tips at 9.5°) has fallen; a cube turned 40° (it tips at 45°) has not
	const lean = { frames: [track.frames[0], { t: 1, placements: { ...track.frames[0].placements, s2: P(2.01, 0.02, -0.7), s4: P(4, 0.035, -0.7) } }], impacts: [] }
	const [dom, cube] = checkGoals([{ kind: "falls", label: "dom", item: "dom" }, { kind: "falls", label: "cube", item: "settle" }], { doc, track: lean })
	assert.equal(dom.ok, true, dom.detail)
	assert.equal(cube.ok, false, cube.detail)
})

test("from the summary alone: in, a domino row's falls and the first hits are known; distances are not", () => {
	const r = checkGoals(GOALS, { summary: run.summary })
	assert.deepEqual(r.map((g) => g.ok), [run.summary.goals[0].ok, true, true, false, null, null, null])
})

test("falls counts rigid bodies on real runs: ten bowling pins (six welded parts each) are 10, not 60; a car that drives down a ramp has not fallen", async () => {
	const sim = await import("../../web/sim/index.js")
	const table = { id: "table", type: "table", x: 1.3, y: 0, angle: 0, props: {} }
	const walls = [{ id: "wall-left", type: "wall", x: -0.52, y: 0, angle: 0, props: { invisible_in_3d: true } }, { id: "wall-right", type: "wall", x: 3.12, y: 0, angle: 0, props: { invisible_in_3d: true } }]
	const pins = Array.from({ length: 10 }, (_, i) => ({ id: `pin${i}`, type: "bowling-pin", x: 1.0 + i * 0.2, y: 0.1905, angle: 0, props: {} }))
	const bowling = { version: 2, seconds: 5, release: 0.3, goals: [], items: [table, ...walls, ...pins, { id: "ramp", type: "plank", x: 0.05, y: 0.215, angle: -24, props: { length: 0.985, legs: false } }, { id: "ball", type: "bowling-ball", x: -0.3, y: 0.5, angle: 0, props: {}, held: true }] }
	const [all] = checkGoals([{ kind: "falls", label: "all ten pins", items: pins.map((p) => p.id) }], await runScene(sim.clean(bowling)))
	assert.equal(all.of, 10, all.detail)
	assert.ok(all.fallen >= 3, all.detail)
	assert.match(all.detail, new RegExp(`^${all.fallen} of 10 fell`))
	const car = { version: 2, seconds: 4, release: 0.3, goals: [], items: [table, ...walls, { id: "ramp", type: "plank", x: 2.2, y: 0.08, angle: -10, props: { length: 0.6, legs: false } }, { id: "car", type: "toy-car", x: 2.05, y: 0.125, angle: -10, props: {} }] }
	const [falls, moves] = checkGoals([{ kind: "falls", label: "car", item: "car" }, { kind: "moves", label: "car rolls", item: "car", min_m: 0.3 }], await runScene(sim.clean(car)))
	assert.equal(moves.ok, true, moves.detail)
	assert.deepEqual([falls.ok, falls.of], [false, 1], falls.detail)
})

test("off: a thing past the table's end, or fallen below its top, has left the table; one still over it has not, said where; from the summary alone only the engine's own check of it or 'never moves'", async () => {
	const s = JSON.parse(JSON.stringify(scene))
	s.items = s.items.filter((i) => i.id !== "wall-right")
	s.items.push({ id: "pp", type: "ping-pong-ball", name: "Ping-pong ball", x: 3.3, y: 0.5 }, { id: "pp2", type: "ping-pong-ball", name: "Ping-pong ball 2", x: 2.0, y: 0.03 })
	const goals = [{ kind: "off", item: "pp", label: "blown off" }, { kind: "off", item: "pp2", label: "stays" }]
	const r = await runScene({ ...s, goals: [...(s.goals ?? []), ...goals] })
	const [a, b] = checkGoals(goals, r)
	assert.equal(a.ok, true, a.detail)
	assert.match(a.detail, /^it ends (past the table's right end|below the table top)$/)
	assert.equal(b.ok, false)
	assert.match(b.detail, /^it stays over the table, [\d.]+ (cm|m) in from its (left|right) end$/)
	assert.equal(goalLabel({ kind: "off", item: "pp" }, { pp: "the ping-pong ball" }), "the ping-pong ball ends off the table")
	// (the engine's own summary checks it too, machines/items.py = web/sim/items.js: the results strip shows it)
	const own = (r.summary?.goals ?? []).filter((g) => g.kind === "off").map((g) => [g.label, g.ok])
	assert.deepEqual(own, [["blown off", true], ["stays", false]])
	assert.deepEqual(checkGoals(goals, { summary: r.summary }).map((g) => g.ok), [true, false])
})

test("moves: an Atwood machine's two weights go opposite ways: the weight that moved most is measured (the mean of all its parts stayed put); a pulley lift's pail and weight alike; the engine's own summary agrees", async () => {
	const atwood = JSON.parse(readFileSync(new URL("web/scenarios/atwood.json", PG), "utf8"))
	const goals = [{ kind: "moves", label: "the weights move", item: "atwood", min_m: 0.1 }]
	const r = await runScene({ ...atwood, goals })
	const [g] = checkGoals(goals, r)
	assert.equal(g.ok, true, g.detail)
	assert.ok(g.moved_m > 0.25 && g.moved_m < 0.4, g.detail)
	// (machines/items.py = web/sim/items.js summarize reports the same distance)
	const own = r.summary.goals.find((x) => x.kind === "moves")
	assert.deepEqual([own.ok, own.moved_m], [true, g.moved_m])
	const lift = JSON.parse(readFileSync(new URL("web/gallery/pulley-lift.json", PG), "utf8"))
	const lg = [{ kind: "moves", label: "the lift moves", item: "lift", min_m: 0.3 }]
	const [l] = checkGoals(lg, await runScene({ ...lift, goals: lg }))
	assert.equal(l.ok, true, l.detail)
})
