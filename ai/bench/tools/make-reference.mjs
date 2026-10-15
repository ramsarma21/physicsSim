// Hand-built reference answers for the text cases: a solved scene (placed exactly with tools/place.mjs) and a plan in the DESIGN.md shape
// (derived from the scene, with the case's honest `missing` list). They prove each case can be passed with the catalog and the engine,
// and they are the positive half of tools/selftest.mjs. Some need a small search (a launcher's compression, a ball's start) — done here,
// with the engine, the way the tuner would. Writes ai/bench/reference/<case id>.json = {case, plan, scene, notes}.
//   node ai/bench/tools/make-reference.mjs [case ids...]
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
const HERE = path.dirname(fileURLToPath(import.meta.url))
const BENCH = path.resolve(HERE, "..")
const { geometry, SIM, r5, scene, itemOf, extent, topOver, GAP, put, at, leanRamp, plankTop, check, STAGE } = await import(pathToFileURL(path.join(HERE, "place.mjs")).href)
const { scoreCase, simulate, loadBench, baseSceneOf } = await import(pathToFileURL(path.join(BENCH, "score.mjs")).href)

const bench = loadBench()
const OUT = path.join(BENCH, "reference")
fs.mkdirSync(OUT, { recursive: true })
const clone = (o) => JSON.parse(JSON.stringify(o))

/** A plan (DESIGN.md step 2) that describes a solved scene: each item on what it rests on (or in the air), at its x. */
function planFromScene(sc, { title, missing = [], notes = "", goals = [] } = {}) {
	const G = geometry(sc)
	const items = []
	for (const it of sc.items) {
		const g = G.byId.get(it.id)
		let on = "air"
		if (g) {
			const sup = G.items.filter((o) => o.id !== it.id && o.box.y1 <= g.box.y0 + 0.004 && o.box.y1 >= g.box.y0 - 0.02 && o.box.x0 < g.box.x1 && g.box.x0 < o.box.x1)
			if (sup.length) on = sup.sort((a, b) => b.box.y1 - a.box.y1)[0].id
		}
		if (it.type === "table") continue
		items.push({ id: it.id, type: it.type, name: it.name ?? it.type, props: it.props ?? {}, place: { on, x: it.x, ...(it.angle ? { angle_deg: it.angle } : {}), ...(on === "air" ? { y_m: it.y } : {}) }, ...(it.held ? { held: true } : {}), why: "reference" })
	}
	return { title: title ?? sc.name, items, missing, goals, tune: [], seconds: sc.seconds, notes }
}
const ballOnRamp = (sc, ramp, s, it, r) => { const [px, py] = ramp.along(s); return at(sc, it, px + r * ramp.normal[0], py + r * ramp.normal[1] + GAP) }
const R = { // radii
	golf: 0.0427 / 2, marble: 0.016 / 2, steel: 0.0254 / 2, superball: 0.03, wooden: 0.025, pingpong: 0.02, tennis: 0.0335, orange: 0.0335, basketball: 0.121, bowling: 0.109,
}
/** Every hard check of the case passes on this scene (and the soft ones, when strict). */
async function passes(caseId, sc, plan, strict = false) {
	const r = await scoreCase(bench.cases.get(caseId), { plan, scene: sc })
	const softBad = [...(Array.isArray(r.checks.outcomes) ? r.checks.outcomes : []), ...(Array.isArray(r.checks.relations) ? r.checks.relations : [])].filter((x) => x.soft && !x.ok)
	return { ok: r.pass && (!strict || !softBad.length), r }
}

const REF = {}

REF["s1-ball-ramp"] = () => {
	const sc = scene("ref-s1", "Ball down a ramp", STAGE(0.45, 2.2, 0.9), 3)
	const b = put(sc, { id: "book1", type: "hardcover-book", name: "Book 1" }, { left: 0.55 })
	put(sc, { id: "book2", type: "hardcover-book", name: "Book 2" }, { x: b.x, on: "book1" })
	put(sc, { id: "book3", type: "hardcover-book", name: "Book 3" }, { x: b.x, on: "book2" })
	const ramp = leanRamp(sc, { id: "ramp", type: "plank", name: "Ramp", props: { length: 0.9 } }, "book3", -9.5)
	ballOnRamp(sc, ramp, 0.08, { id: "ball", type: "golf-ball", name: "Golf ball" }, R.golf)
	return { sc }
}
REF["s2-five-dominoes"] = () => {
	const sc = scene("ref-s2", "Five dominoes", STAGE(0.8, 1.8, 0.6), 3)
	let x = 1.0
	const d1 = put(sc, { id: "d1", type: "domino", name: "Domino 1", angle: -14 }, { left: x })
	x = d1.x1 + 0.024
	for (let k = 2; k <= 5; k++) { const d = put(sc, { id: `d${k}`, type: "domino", name: `Domino ${k}` }, { left: x }); x = d.x1 + 0.03 }
	return { sc }
}
REF["s3-car-ramp"] = () => {
	// a low ramp from two books at the table's left end, so the car is still on the table when the run ends
	const sc = scene("ref-s3", "Toy car down a ramp", { x0: -0.5, x1: 3.1, y0: -0.12, y1: 0.8 }, 3)
	const b = put(sc, { id: "book1", type: "hardcover-book", name: "Book 1" }, { left: -0.45 })
	put(sc, { id: "book2", type: "hardcover-book", name: "Book 2" }, { x: b.x, on: "book1" })
	const ramp = leanRamp(sc, { id: "ramp", type: "plank", name: "Ramp", props: { length: 0.6 } }, "book2", -8)
	const [cx, cy] = ramp.along(0.12)
	at(sc, { id: "car", type: "toy-car", name: "Toy car", angle: ramp.angle }, cx, cy + GAP)
	return { sc }
}
REF["k1-book-stack"] = () => {
	const sc = scene("ref-k1", "Four books", STAGE(0.8, 1.8, 0.6), 3)
	const b = put(sc, { id: "b1", type: "hardcover-book", name: "Book 1" }, { x: 1.3 })
	put(sc, { id: "b2", type: "hardcover-book", name: "Book 2" }, { x: b.x, on: "b1" })
	put(sc, { id: "b3", type: "paperback-book", name: "Book 3" }, { x: b.x, on: "b2" })
	put(sc, { id: "b4", type: "paperback-book", name: "Book 4" }, { x: b.x, on: "b3" })
	return { sc }
}
REF["k2-tower-wrecking"] = () => {
	const sc = scene("ref-k2", "Block tower and wrecking ball", { x0: -0.15, x1: 2.25, y0: -0.15, y1: 1.45 }, 5)
	at(sc, { id: "crane", type: "wrecking-ball", name: "Wrecking ball", props: { start_angle: -60 } }, 0.9, 0.9)
	const b = put(sc, { id: "block1", type: "wooden-block", name: "Block 1" }, { x: 1.0 })
	for (let k = 2; k <= 6; k++) put(sc, { id: `block${k}`, type: "wooden-block", name: `Block ${k}` }, { x: b.x, on: `block${k - 1}` })
	return { sc }
}
REF["e1-phone-board-pillow"] = () => {
	// a shorter cutting board (25 cm) so two flat books make a slope steeper than the phone's friction angle
	const sc = scene("ref-e1", "Phone slides onto a pillow", STAGE(0.5, 2.3, 0.7), 4)
	const b = put(sc, { id: "book1", type: "hardcover-book", name: "Book 1" }, { left: 0.6 })
	put(sc, { id: "book2", type: "hardcover-book", name: "Book 2" }, { x: b.x, on: "book1" })
	const G = geometry(sc)
	const top = G.byId.get("book2").box
	const W = 0.18
	const th = 0.019
	const ang = -Math.asin((top.y1 - G.tableTop - 0.002) / (W - 0.02)) * (180 / Math.PI)
	const a = (ang * Math.PI) / 180
	// the board's underside touches the book's top-right corner 3 cm from its high end; its low end rests on the table
	const P = [top.x1, top.y1 + GAP]
	const u = [Math.cos(a), Math.sin(a)]
	const n = [-Math.sin(a), Math.cos(a)]
	const c = [P[0] + (W / 2 - 0.02) * u[0] + (th / 2) * n[0], P[1] + (W / 2 - 0.02) * u[1] + (th / 2) * n[1]]
	at(sc, { id: "board", type: "cutting-board", name: "Cutting board", angle: r5(ang), props: { width: W } }, c[0], c[1])
	const ph = 0.0078 // the phone (14.8 cm) lying on the board from its high end
	const pc = [c[0] + (-W / 2 + 0.074 + 0.003) * u[0] + (th / 2 + ph / 2 + GAP) * n[0], c[1] + (-W / 2 + 0.074 + 0.003) * u[1] + (th / 2 + ph / 2 + GAP) * n[1]]
	at(sc, { id: "phone", type: "smartphone", name: "Phone", angle: r5(ang) }, pc[0], pc[1])
	const G2 = geometry(sc)
	put(sc, { id: "pillow", type: "pillow", name: "Pillow" }, { left: G2.byId.get("board").box.x1 + 0.01 })
	return { sc }
}
REF["e2-tallest-to-shortest"] = () => {
	const sc = scene("ref-e2", "Tallest to shortest", STAGE(0.8, 1.9, 0.6), 3)
	let x = 1.0
	for (const [id, t] of [["candle", "candle"], ["bottle", "water-bottle"], ["can", "soda-can"], ["mug", "coffee-mug"]]) { const p = put(sc, { id, type: t, name: t }, { left: x }); x = p.x1 + 0.06 }
	return { sc }
}
REF["e3-balance-can-book"] = () => {
	const sc = scene("ref-e3", "Balanced tennis ball", STAGE(0.9, 1.7, 0.6), 3)
	const b = put(sc, { id: "book", type: "hardcover-book", name: "Book" }, { x: 1.3 })
	const can = put(sc, { id: "can", type: "soda-can", name: "Soda can" }, { x: b.x, on: "book" })
	put(sc, { id: "ball", type: "tennis-ball", name: "Tennis ball" }, { x: can.x, on: "can" })
	return { sc }
}
REF["v1-motor-car-cereal"] = () => {
	const sc = scene("ref-v1", "Car into cereal boxes", STAGE(0.3, 2.3, 0.7), 5)
	// the boxes stand edge-on (their 6.3 cm side along the row, like dominoes): seen from the side a box is then 6.3 × 30 cm
	put(sc, { id: "car", type: "motor-car", name: "Motor car" }, { left: 0.45 })
	let x = 1.1
	for (let k = 1; k <= 3; k++) { const p = put(sc, { id: `cereal${k}`, type: "cereal-box", name: `Cereal box ${k}`, props: { width: 0.063, depth: 0.19 } }, { left: x }); x = p.x1 + 0.2 }
	return { sc }
}
REF["v2-skateboard-cone"] = () => {
	const sc = scene("ref-v2", "Skateboard and cone", { x0: -0.5, x1: 3.15, y0: -0.12, y1: 1.2 }, 5)
	put(sc, { id: "box1", type: "cardboard-box", name: "Box" }, { left: -0.4 })
	const ramp = leanRamp(sc, { id: "ramp", type: "plank", name: "Long ramp", props: { length: 1.8, depth: 0.3 } }, "box1", -8)
	const [cx, cy] = ramp.along(0.5)
	at(sc, { id: "board", type: "skateboard", name: "Skateboard", angle: ramp.angle }, cx, cy + GAP)
	const G = geometry(sc)
	put(sc, { id: "cone", type: "traffic-cone", name: "Traffic cone" }, { left: G.byId.get("ramp").box.x1 + 0.4 })
	return { sc }
}
REF["m1-pendulum-golf"] = () => {
	const sc = scene("ref-m1", "Pendulum and golf ball", STAGE(0.6, 2.0, 0.8), 3)
	const blk = put(sc, { id: "block", type: "wooden-block", name: "Wooden block" }, { left: 1.25 })
	const ball = put(sc, { id: "ball", type: "golf-ball", name: "Golf ball" }, { x: blk.x0 + 0.025, on: "block" })
	const bobR = 0.025
	// the bob's lowest point passes just above the block, hitting the ball above its centre
	const pivotY = blk.y1 + 0.004 + bobR + 0.4
	at(sc, { id: "pendulum", type: "pendulum", name: "Pendulum", props: { length: 0.4, start_angle: -45 } }, ball.x - R.golf - bobR - 0.004, pivotY)
	return { sc }
}
REF["m2-seesaw-catapult"] = async () => {
	let best = null
	for (const h of [0.3, 0.45, 0.6]) for (const gapB of [0.0, 0.1, 0.25, 0.4, 0.6]) {
		const sc = scene("ref-m2", "Seesaw catapult", STAGE(0.4, 2.6, 1.4), 4)
		at(sc, { id: "seesaw", type: "seesaw", name: "Seesaw" }, 0.8, 0)
		const S = geometry(sc).byId.get("seesaw")
		const bx = S.box.x1 - 0.05
		const ball = { id: "ball", type: "ping-pong-ball", name: "Ping-pong ball", angle: 0, props: {} }
		ball.x = r5(bx)
		ball.y = r5(topOver(sc, "seesaw", bx - 0.002, bx + 0.002) + R.pingpong + GAP)
		sc.items.push(ball)
		const wx = S.box.x0 + 0.04
		at(sc, { id: "weight", type: "steel-weight-5kg", name: "Steel weight", held: true }, wx, topOver(sc, "seesaw", wx - 0.04, wx + 0.04) + h)
		put(sc, { id: "basket", type: "basket", name: "Basket" }, { left: S.box.x1 + gapB })
		const plan = planFromScene(sc)
		const p = await passes("m2-seesaw-catapult", sc, plan, true)
		if (p.ok) return { sc, notes: `weight dropped from ${h} m, basket ${gapB} m past the seesaw` }
		best ??= { sc, notes: `soft goal not met in the search (weight ${h} m)` }
	}
	return best
}
REF["m3-pulley-lift"] = () => {
	const sc = scene("ref-m3", "Pulley lift", STAGE(0.8, 1.8, 1.2), 3)
	at(sc, { id: "lift", type: "pulley-lift", name: "Pulley lift", props: { weight: 0.6, drop: 0.5 } }, 1.3, 0.95)
	return { sc }
}
REF["m4-conveyor-oranges"] = async () => {
	for (const gapB of [0.0, 0.05, 0.1, 0.15, 0.2, 0.3]) for (const speed of [0.6, 1.0]) {
		const sc = scene("ref-m4", "Oranges on a conveyor", STAGE(0.3, 2.3, 0.8), 6)
		at(sc, { id: "belt", type: "conveyor-belt", name: "Conveyor belt", props: { length: 1.0, speed } }, 0.95, 0.3)
		for (let k = 0; k < 3; k++) put(sc, { id: `orange${k + 1}`, type: "orange", name: `Orange ${k + 1}` }, { x: 0.55 + k * 0.14, on: "belt" })
		const G = geometry(sc)
		put(sc, { id: "basket", type: "basket", name: "Basket" }, { left: G.byId.get("belt").box.x1 + gapB })
		const p = await passes("m4-conveyor-oranges", sc, planFromScene(sc))
		if (p.ok) return { sc, notes: `basket ${gapB} m past the belt's end, belt ${speed} m/s` }
	}
	throw new Error("m4: no basket position worked")
}
REF["m5-trampoline-bucket"] = async () => {
	for (const dx of [0.1, 0.15, 0.2, 0.25, 0.3]) for (const h of [0.9, 1.1]) for (const bx of [0.45, 0.6, 0.75, 0.9]) {
		const sc = scene("ref-m5", "Basketball bounce into a bucket", { x0: 0.1, x1: 2.6, y0: -0.15, y1: 1.6 }, 6)
		at(sc, { id: "trampoline", type: "trampoline", name: "Trampoline", props: { width: 1.0, height: 0.4, stiffness: 400 } }, 1.0, 0)
		at(sc, { id: "ball", type: "basketball", name: "Basketball", held: true }, 1.0 + dx, h)
		put(sc, { id: "bucket", type: "bucket", name: "Bucket", props: { width: 0.4, wall: 0.3 } }, { x: 1.0 + bx + 0.5 })
		const p = await passes("m5-trampoline-bucket", sc, planFromScene(sc), true)
		if (p.ok) return { sc, notes: `ball ${dx} m right of centre at ${h} m; bucket at +${bx + 0.5} m` }
	}
	const sc = scene("ref-m5", "Basketball bounce into a bucket", { x0: 0.1, x1: 2.6, y0: -0.15, y1: 1.6 }, 6)
	at(sc, { id: "trampoline", type: "trampoline", name: "Trampoline", props: { width: 1.0, height: 0.4, stiffness: 400 } }, 1.0, 0)
	at(sc, { id: "ball", type: "basketball", name: "Basketball", held: true }, 1.15, 1.0)
	put(sc, { id: "bucket", type: "bucket", name: "Bucket", props: { width: 0.4, wall: 0.3 } }, { x: 1.8 })
	return { sc, notes: "the soft goal (ball in the bucket) was not met by the small search" }
}
REF["m6-spring-launcher-cup"] = async () => {
	// the spring-launch scenario's launcher on its 45° support, a three-brick wall, and a cup moved until the ball lands in it
	const base = JSON.parse(fs.readFileSync(path.join(BENCH, "../../web/scenarios/spring-launch.json"), "utf8"))
	for (const comp of [0.046, 0.04, 0.035, 0.05, 0.03]) {
		const sc = clone(base)
		sc.id = "ref-m6"
		sc.name = "Launcher over a brick wall"
		sc.stage = { x0: 0.3, x1: 2.6, y0: -0.12, y1: 1.4 }
		sc.items = sc.items.filter((i) => i.id !== "cup")
		itemOf(sc, "launcher").props.compression = comp
		const b = put(sc, { id: "brick1", type: "brick", name: "Brick 1" }, { x: 1.1 })
		put(sc, { id: "brick2", type: "brick", name: "Brick 2" }, { x: b.x, on: "brick1" })
		put(sc, { id: "brick3", type: "brick", name: "Brick 3" }, { x: b.x, on: "brick2" })
		// where does the ball come down? run once without a cup, then put the cup there and refine
		const free = await simulate(sc)
		const ballSolid = free.doc.solids.find((s) => s.item === "ball").id
		let landX = null
		for (const f of free.track.frames) { const p = f.placements[ballSolid]; if (p && f.t > 0.6 && p.y < 0.14 && p.x > 1.25) { landX = p.x; break } }
		if (landX === null) continue
		for (const dx of [0, -0.02, 0.02, -0.04, 0.04, -0.06, 0.06]) {
			const s2 = clone(sc)
			put(s2, { id: "cup", type: "cup", name: "Cup", props: { width: 0.12, wall: 0.12 } }, { x: landX + dx })
			if (SIM.layout(s2).warnings.length) continue
			const p = await passes("m6-spring-launcher-cup", s2, planFromScene(s2))
			if (p.ok) return { sc: s2, notes: `compression ${comp} m; cup at x=${r5(landX + dx)}` }
		}
	}
	throw new Error("m6: no launcher setting and cup place worked")
}
REF["z1-steel-rubber-drop"] = () => {
	const sc = scene("ref-z1", "Steel and rubber balls dropped", STAGE(0.9, 1.7, 1.3), 3)
	at(sc, { id: "steel", type: "steel-ball", name: "Steel ball", held: true }, 1.2, 1.0 + R.steel)
	at(sc, { id: "rubber", type: "superball", name: "Rubber ball", held: true }, 1.4, 1.0 + R.superball)
	return { sc }
}
REF["z2-materials-ice-ramp"] = () => {
	const sc = scene("ref-z2", "Three balls on an ice ramp", STAGE(0.4, 2.4, 0.9), 4)
	const b1 = put(sc, { id: "box", type: "cardboard-box", name: "Box" }, { left: 0.5 })
	const ramp = leanRamp(sc, { id: "ice", type: "ice-sheet", name: "Ice ramp", props: { length: 1.2 } }, "box", -11)
	ballOnRamp(sc, ramp, 0.05, { id: "marble", type: "glass-marble", name: "Glass marble" }, R.marble)
	ballOnRamp(sc, ramp, 0.15, { id: "wood", type: "wooden-ball", name: "Wooden ball" }, R.wooden)
	ballOnRamp(sc, ramp, 0.27, { id: "rubber", type: "superball", name: "Rubber ball" }, R.superball)
	return { sc }
}
REF["g1-fun-balls"] = () => {
	const sc = JSON.parse(fs.readFileSync(path.join(BENCH, "../../web/scenarios/trampoline.json"), "utf8"))
	sc.id = "ref-g1"
	return { sc }
}
REF["g2-chain-reaction"] = () => {
	const sc = JSON.parse(fs.readFileSync(path.join(BENCH, "../../web/scenarios/rube-goldberg.json"), "utf8"))
	sc.id = "ref-g2"
	return { sc }
}

/** The marble zig-zag machine (c2, and c1 with a cup): an upper ramp down to the left, a lower one down to the right with a backstop at its
 *  high end, a growing domino row, a low box ledge with a golf ball at its left edge, and the catcher just past the ledge. Found by a search
 *  over the domino size, the ball's place and the gaps (scratch search, 48 runs). */
function zigzag(id, name, catcher) {
	const sc = scene(id, name, { x0: -0.5, x1: 3.1, y0: -0.12, y1: 1.0 }, 7)
	const up = plankTop(sc, "ramp1", "Upper ramp", 0.25, 0.5, 0.8, 0.6)
	plankTop(sc, "ramp2", "Lower ramp", -0.05, 0.36, 1.2, GAP)
	const [mx, my] = up.at(0.5)
	at(sc, { id: "marble", type: "glass-marble", name: "Glass marble" }, mx + R.marble * up.nx, my + R.marble * up.ny + GAP)
	at(sc, { id: "stop", type: "wall", name: "Backstop", props: { height: 0.6 } }, -0.1, 0)
	at(sc, { id: "dominoes", type: "domino-row", name: "Dominoes", props: { count: 7, first_height: 0.044, growth: 1.193, spacing: 0.568 } }, 1.32, 0)
	const row = geometry(sc).byId.get("dominoes").box
	const ledge = put(sc, { id: "ledge", type: "cardboard-box", name: "Ledge (box)", props: { width: 0.12, height: 0.09 } }, { left: row.x1 + 0.02 })
	put(sc, { id: "ball", type: "golf-ball", name: "Golf ball" }, { x: ledge.x0 + 0.006, on: "ledge" })
	put(sc, { ...catcher }, { left: ledge.x1 })
	return sc
}
REF["c2-marble-zigzag"] = () => ({ sc: zigzag("ref-c2", "Marble zig-zag", { id: "bucket", type: "bucket", name: "Bucket", props: { width: 0.24, wall: 0.07 } }) })
REF["c1-rube-cup"] = async () => {
	for (const [w, h] of [[0.12, 0.07], [0.14, 0.07], [0.12, 0.06], [0.16, 0.07]]) {
		const sc = zigzag("ref-c1", "Five-stage machine into a cup", { id: "cup", type: "cup", name: "Cup", props: { width: w, wall: h } })
		const p = await passes("c1-rube-cup", sc, planFromScene(sc))
		if (p.ok) return { sc, notes: `marble → zig-zag ramps → dominoes → golf ball off the ledge → cup (${w} × ${h} m)` }
	}
	throw new Error("c1: no cup size worked")
}

REF["i1-cat-water"] = () => {
	const sc = scene("ref-i1", "Stand-in: a pendulum knocks a mug", STAGE(0.8, 1.9, 0.9), 3)
	const mug = put(sc, { id: "mug", type: "coffee-mug", name: "Mug (stand-in for the glass)" }, { x: 1.35 })
	at(sc, { id: "pendulum", type: "pendulum", name: "Pendulum (stand-in for the cat's paw)", props: { length: 0.4, start_angle: -50 } }, 1.35 - 0.041 - 0.025 - 0.004, 0.0 + 0.4 + 0.07)
	void mug
	return {
		sc,
		missing: [
			{ asked: "a live cat", reason: "The library has no animals; a pendulum stands in for the cat's paw.", substitute_type: "pendulum" },
			{ asked: "water", reason: "There are no liquids in the simulation; the mug is empty.", substitute_type: null },
			{ asked: "a glass that can be knocked over", reason: "Glasses and cups are fixed containers; a coffee mug is used because it can move.", substitute_type: "coffee-mug" },
		],
	}
}
REF["i2-waterfall-wheel"] = async () => {
	// stand-in for the falls: four marbles run down a short chute onto the top of a staircase (it rises to the right) and tumble down its
	// steps into a low, wide bucket at its foot; no water wheel (reported). Found by a small search (all four marbles end in the bucket).
	const missing = [
		{ asked: "a waterfall", reason: "No fluids: water cannot flow. Marbles tumble down a staircase instead.", substitute_type: "glass-marble" },
		{ asked: "a water wheel", reason: "No water wheel; nothing would turn it without water.", substitute_type: null },
	]
	const probe = { id: "probe", expect: { outcomes: [{ kind: "in", item: "glass-marble", container: "bucket", all: true }] } }
	for (const lift of [0.009, 0.012, 0.016, 0.02]) for (const [w, gap] of [[0.3, 0], [0.45, 0], [0.45, 0.12], [0.3, 0.05]]) for (const rh of [0.1, 0.12, 0.08]) {
		const sc = scene("ref-i2", "Stand-in: marbles down stairs into a bucket", STAGE(0.2, 2.4, 1.0), 6)
		put(sc, { id: "bucket", type: "bucket", name: "Bucket", props: { width: w, wall: 0.045 } }, { left: 0.42 - gap })
		const st = put(sc, { id: "stairs", type: "staircase", name: "Staircase (stand-in for the falls)" }, { left: 0.95 })
		const rp = plankTop(sc, "chute", "Chute", st.x1 - 0.02, st.y1 + lift, st.x1 + 0.38, st.y1 + lift + rh, { thickness: 0.006 }) // (a thin chute: its underside clears the top step)
		for (let k = 0; k < 4; k++) { const [x, y] = rp.at(0.37 - k * 0.03); at(sc, { id: `m${k + 1}`, type: "glass-marble", name: `Marble ${k + 1}` }, x + R.marble * rp.nx, y + R.marble * rp.ny + GAP) }
		if (SIM.layout(sc).warnings.length) continue
		const r = await scoreCase(probe, { scene: sc }, { groups: {} })
		if (r.checks.outcomes[0].ok) return { sc, missing, notes: `all four marbles end in the bucket (chute lift ${lift} m, rise ${rh} m, bucket ${w} m wide)` }
	}
	throw new Error("i2: no stand-in worked")
}
REF["i3-747"] = () => {
	const sc = scene("ref-i3", "Stand-in: toy truck into a box", STAGE(0.3, 2.6, 0.8), 4)
	put(sc, { id: "box", type: "cardboard-box", name: "Box" }, { left: 0.4 })
	const ramp = leanRamp(sc, { id: "runway", type: "plank", name: "Runway (plank)", props: { length: 1.0 } }, "box", -13.5)
	const [cx, cy] = ramp.along(0.2)
	at(sc, { id: "truck", type: "toy-car", name: "Toy car (stand-in for the jet)", angle: ramp.angle }, cx, cy + GAP)
	return {
		sc,
		missing: [
			{ asked: "a 747 jumbo jet", reason: "There are no aircraft, and nothing that size fits on the 3.7 m table; a toy car stands in.", substitute_type: "toy-car" },
			{ asked: "a hangar", reason: "No buildings.", substitute_type: null },
		],
	}
}
REF["d2-wrecking-cardboard"] = () => {
	const sc = baseSceneOf(bench.cases.get("d2-wrecking-cardboard"))
	sc.items = sc.items.filter((i) => i.type !== "brick")
	const b = put(sc, { id: "box1", type: "cardboard-box", name: "Box 1" }, { x: 1.07 + 0.08 })
	for (let k = 2; k <= 5; k++) put(sc, { id: `box${k}`, type: "cardboard-box", name: `Box ${k}` }, { x: b.x, on: `box${k - 1}` })
	sc.stage = { ...sc.stage, y1: 1.6 }
	return { sc }
}
REF["d3-trampoline-bowling"] = () => {
	const sc = baseSceneOf(bench.cases.get("d3-trampoline-bowling"))
	sc.items = sc.items.filter((i) => i.type !== "tennis-ball")
	at(sc, { id: "bowling", type: "bowling-ball", name: "Bowling ball", held: true }, 1.3, 1.3)
	return { sc }
}
REF["d4-car-dog"] = () => {
	const sc = baseSceneOf(bench.cases.get("d4-car-dog"))
	return { sc, missing: [{ asked: "a dog", reason: "The library has no animals, so nothing was added.", substitute_type: null }] }
}
REF["d5-plinko-leftmost"] = async () => {
	const base = baseSceneOf(bench.cases.get("d5-plinko-leftmost"))
	const x0 = itemOf(base, "ball").x
	for (let k = 0; k <= 80; k++) {
		const sc = clone(base)
		itemOf(sc, "ball").x = r5(0.92 + k * 0.005)
		const p = await passes("d5-plinko-leftmost", sc, planFromScene(sc))
		if (p.ok) return { sc, notes: `ball moved from x=${x0} to x=${itemOf(sc, "ball").x}` }
	}
	throw new Error("d5: no start lands in cup 1")
}
REF["d1-rube-more-dominoes"] = () => {
	// 14 dominoes in the room the 7 had: smaller and growing slower (0.07 m × 1.06ⁿ), a little closer (0.35 heights). The chain runs through
	// all 14; the seesaw is not reached any more (a 54-run search moving the seesaw, ball 2 and the box together found no setting that lands
	// ball 2 in the box again: the soft goal is left to the AI's tuner).
	const sc = baseSceneOf(bench.cases.get("d1-rube-more-dominoes"))
	const b1 = itemOf(sc, "ball1")
	b1.type = "steel-ball"
	b1.name = "Ball 1 (steel)"
	b1.y = r5(b1.y - 0.03 + R.steel) // on the same pin, a smaller ball
	const d = itemOf(sc, "dominoes")
	d.x = 1.8
	d.props = { count: 14, first_height: 0.07, growth: 1.06, spacing: 0.35 }
	return { sc, notes: "14 dominoes: first 0.07 m, growth 1.06, spacing 0.35; the ball-in-box goal (soft) is not met" }
}

// ---------------------------------------------------------------- image cases (photos and sketches): proof that their checks can pass
REF["photo-ramp-dominoes"] = () => {
	const sc = scene("ref-photo-ramp-dominoes", "Book ramp and dominoes", STAGE(0.45, 2.3, 0.9), 4)
	const b = put(sc, { id: "book1", type: "hardcover-book", name: "Book 1" }, { left: 0.55 })
	put(sc, { id: "book2", type: "hardcover-book", name: "Book 2" }, { x: b.x, on: "book1" })
	put(sc, { id: "book3", type: "hardcover-book", name: "Book 3" }, { x: b.x, on: "book2" })
	const ramp = leanRamp(sc, { id: "ramp", type: "plank", name: "Ramp", props: { length: 0.9 } }, "book3", -9.5)
	ballOnRamp(sc, ramp, 0.06, { id: "ball", type: "superball", name: "Red ball" }, R.superball)
	const G = geometry(sc)
	at(sc, { id: "dominoes", type: "domino-row", name: "Dominoes", props: { count: 5, first_height: 0.05, growth: 1.0, spacing: 0.6 } }, G.byId.get("ramp").box.x1 + 0.03, 0)
	return { sc }
}
REF["photo-cradle-desk"] = () => {
	const sc = scene("ref-photo-cradle-desk", "Cradle, phone and mug", STAGE(0.5, 2.0, 0.9), 3)
	const c = put(sc, { id: "cradle", type: "newtons-cradle", name: "Newton's cradle", props: { count: 6 } }, { left: 0.6 })
	const ph = put(sc, { id: "phone", type: "smartphone", name: "Smartphone" }, { left: c.x1 + 0.04 })
	put(sc, { id: "mug", type: "coffee-mug", name: "Coffee mug" }, { left: ph.x1 + 0.05 })
	return { sc }
}
REF["photo-books-can-ball"] = () => {
	const sc = scene("ref-photo-books-can-ball", "Mug, books, can, ball", STAGE(0.6, 2.0, 0.8), 3)
	const mug = put(sc, { id: "mug", type: "coffee-mug", name: "Mug" }, { left: 0.7 })
	const b = put(sc, { id: "b1", type: "hardcover-book", name: "Book 1" }, { left: mug.x1 + 0.06 })
	for (let k = 2; k <= 4; k++) put(sc, { id: `b${k}`, type: "hardcover-book", name: `Book ${k}` }, { x: b.x, on: `b${k - 1}` })
	put(sc, { id: "can", type: "soda-can", name: "Soda can" }, { x: b.x + 0.06, on: "b4" })
	put(sc, { id: "ball", type: "tennis-ball", name: "Tennis ball" }, { left: b.x1 + 0.06 })
	return { sc }
}
REF["photo-board-bucket-34"] = () => {
	const sc = scene("ref-photo-board-bucket-34", "Cutting board ramp", STAGE(0.5, 2.1, 0.8), 4)
	const book = put(sc, { id: "book", type: "paperback-book", name: "Paperback" }, { left: 0.6 })
	const G = geometry(sc)
	const top = G.byId.get("book").box
	const W = 0.406
	const th = 0.019
	const ang = -Math.asin((top.y1 - G.tableTop) / (W - 0.03)) * (180 / Math.PI)
	const a = (ang * Math.PI) / 180
	const u = [Math.cos(a), Math.sin(a)]
	const n = [-Math.sin(a), Math.cos(a)]
	const P = [top.x1 - 0.02, top.y1 + GAP]
	const c = [P[0] + (W / 2 - 0.03) * u[0] + (th / 2) * n[0], P[1] + (W / 2 - 0.03) * u[1] + (th / 2) * n[1]]
	at(sc, { id: "board", type: "cutting-board", name: "Cutting board", angle: r5(ang) }, c[0], c[1])
	const onBoard = (s, r) => [c[0] + (-W / 2 + s) * u[0] + (th / 2 + r + GAP) * n[0], c[1] + (-W / 2 + s) * u[1] + (th / 2 + r + GAP) * n[1]]
	const [x1, y1] = onBoard(0.05, 0.0572 / 2)
	at(sc, { id: "cue", type: "billiard-ball", name: "Cue ball", props: { number: 0 } }, x1, y1)
	const [x2, y2] = onBoard(0.12, R.golf)
	at(sc, { id: "golf", type: "golf-ball", name: "Golf ball" }, x2, y2)
	const G2 = geometry(sc)
	put(sc, { id: "bucket", type: "bucket", name: "Bucket", props: { width: 0.14, wall: 0.12 } }, { left: G2.byId.get("board").box.x1 + 0.02 })
	return { sc }
}
REF["sketch-seesaw-catapult"] = () => {
	// the catalog's seesaw always rests on its right end (a lever tilts either way, but has no lip to hold a ball), so the sketch is mirrored:
	// ball on the low right end, the weight held over the raised left end, the basket (for the hoop) on the right
	const sc = scene("ref-sketch-seesaw", "Seesaw catapult (hoop → basket), mirrored", STAGE(0.4, 2.4, 1.4), 4)
	at(sc, { id: "seesaw", type: "seesaw", name: "Seesaw" }, 0.9, 0)
	const S = geometry(sc).byId.get("seesaw")
	const bx = S.box.x1 - 0.05
	sc.items.push({ id: "ball", type: "ping-pong-ball", name: "Ball", angle: 0, props: {}, x: r5(bx), y: r5(topOver(sc, "seesaw", bx - 0.002, bx + 0.002) + R.pingpong + GAP) })
	const wx = S.box.x0 + 0.04
	at(sc, { id: "weight", type: "steel-weight-5kg", name: "Weight", held: true }, wx, topOver(sc, "seesaw", wx - 0.04, wx + 0.04) + 0.4)
	put(sc, { id: "basket", type: "basket", name: "Basket (for the hoop)" }, { left: S.box.x1 + 0.1 })
	return { sc, missing: [{ asked: "a basketball hoop", reason: "There is no hoop or backboard in the library; a basket on the table is the target.", substitute_type: "basket" }], notes: "mirrored: the seesaw only rests on its right end" }
}
REF["sketch-pendulum-dominoes"] = () => {
	const sc = scene("ref-sketch-pendulum", "Pendulum and six dominoes", STAGE(0.6, 2.0, 0.9), 4)
	at(sc, { id: "pendulum", type: "pendulum", name: "Pendulum", props: { length: 0.45, start_angle: -45 } }, 1.0, 0.45 + 0.025 + 0.03)
	let x = 1.04
	for (let k = 1; k <= 6; k++) { const d = put(sc, { id: `d${k}`, type: "domino", name: `Domino ${k}`, props: { height: 0.08, thickness: 0.013 } }, { left: x }); x = d.x1 + 0.04 }
	return { sc }
}
REF["sketch-rube-labelled"] = () => {
	// a 30° ramp (top 0.3 m up) down to the right, a golf ball at its top, five dominoes, a toy car, an open box on the table
	const sc = scene("ref-sketch-rube", "Labelled chain", STAGE(0.2, 2.9, 0.9), 5)
	const h = 0.3
	const foot = 0.3 + h / Math.tan(Math.PI / 6)
	const rp = plankTop(sc, "ramp", "Ramp 30°", 0.3, h, foot, GAP)
	const [bx, by] = rp.at(0.04)
	at(sc, { id: "ball", type: "golf-ball", name: "Ball" }, bx + R.golf * rp.nx, by + R.golf * rp.ny + GAP)
	let x = foot + 0.08
	for (let k = 1; k <= 5; k++) { const d = put(sc, { id: `d${k}`, type: "domino", name: `Domino ${k}` }, { left: x }); x = d.x1 + 0.03 }
	const car = put(sc, { id: "car", type: "toy-car", name: "Toy car" }, { left: x + 0.005 })
	put(sc, { id: "box", type: "box", name: "Box", props: { hung: false } }, { left: car.x1 + 0.3 })
	return { sc }
}

// ---------------------------------------------------------------- run
const want = process.argv.slice(2)
const ids = Object.keys(REF).filter((id) => !want.length || want.includes(id))
const summary = []
for (const id of ids) {
	const c = bench.cases.get(id)
	if (!c) { console.log("no case", id); continue }
	try {
		const out = await REF[id]()
		const sc = out.sc
		check({ ...sc, stage: sc.stage ?? STAGE(-0.5, 3.1, 2.3) })
		const plan = planFromScene(sc, { missing: out.missing ?? [], notes: out.notes ?? "" })
		const r = await scoreCase(c, { plan, scene: sc })
		fs.writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify({ case: id, notes: out.notes ?? "", plan, scene: sc }, null, 1) + "\n")
		summary.push(`${r.pass ? "PASS" : "FAIL"} ${id} score ${r.score}${r.failed.length ? " failed: " + r.failed.join(",") : ""}${out.notes ? " — " + out.notes : ""}`)
		if (!r.pass) summary.push("   " + JSON.stringify({ outcomes: r.checks.outcomes, relations: r.checks.relations, counts: r.checks.counts, edit: r.checks.edit, missing: r.checks.missing, overlaps: r.checks.overlaps }).slice(0, 1500))
	} catch (e) {
		summary.push(`ERROR ${id}: ${e.message}`)
	}
}
console.log(summary.join("\n"))
