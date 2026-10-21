// The placement solver: an AI plan (semantic placements) -> an exact scene (CONTRACT.md v2). Deterministic, pure, no DOM: runs in node and the browser.
//   import { solve } from "./ai/solver.js"
//   const r = solve(plan)          // {ok, scene, issues, errors, placements, order, ms}
//   const p = planFromScene(scene) // the inverse (for follow-up edits): every item with the support it rests on, so re-solving keeps it resting
//
// plan = {title, seconds?, release?, items: [{id, type, name?, props?, place?, held?, fixed?, why?}], goals?: [{label, item, container}], tune?, missing?, notes?}
// place = {on: "table" | <item id> | "air", x?, left_of? | right_of?: {id, gap_m}, align?: "touching" | "gap", angle_deg?, inside?: <container id>,
//          lean?: {from: {on, x, y?}, to: {on, x, y?}} (an end on "air" is held at height y above the table top),
//          y_m? (air: the anchor's height above the table top, m), bottom_m? (air: its lowest point's height above the table top)}
// plan.table = {props?, x?} (the table's own props; it is always there, id "table"); plan.stage = {x0, x1, y0, y1} (a frame to start from).
//
// How it places (every outline comes from web/sim's own builder, so the geometry is the engine's):
// - on: the item's outline is lowered straight down onto its support's outline (the table top, or the item below at that x, sloped or not) until they
//   touch; on a sloped flat support the item is turned to lie along it (unless angle_deg is given). Bodies the engine moves start at its resting
//   distance (Box2D's skin: 1.5 mm between two polygons, 0.5 mm for a ball on a polygon, measured), so nothing jumps or slides at t = 0; two
//   fixed things touch exactly. On an item support the item is kept within the support's width.
// - left_of / right_of: the gap between the two outlines' boxes is gap_m; align "touching" (or a gap under 2 mm) slides the item until the
//   outlines touch at the resting distance (the true contact, a ball against a slope included).
// - inside: dropped into the container (onto its floor or whatever is already in it), kept between its walls; too big for it is an error.
// - lean: a long item resting on two supports: its low end on the lower support at that x, its underside on the highest point of the other
//   support's outline in between (a plank leaning on a box rests on the box's corner); an end "in the air" is held at its height. A plank-like
//   item without its own length gets the length that spans them (with one, the extra overhangs the high end).
// - seats: on a spring launcher, a bounce pad, a spring catapult or a seesaw the item rests on that part (the plate between the guides, the arm
//   against its lip, the plank against its lip), worked out in the part's own tilted frame (seatOf / placeOnSeat).
// - air: y_m (the anchor) or bottom_m (the lowest point) above the table top, x as given, EXACTLY (only a hair's overlap, up to 1.5 cm, is
//   lifted clear; more is a warning); held items wait for the release.
// - Overlaps with anything already placed are cleared by the smallest sideways move along the support (straight up for things in the air with
//   no height given); a plank's legs count where they would show through, and a leg is never "cleared" by raising (it stands on the floor).
//   Items are placed in dependency order (supports first); a cycle is an error.
// - Static (and fixed) things left in mid-air with nothing under them and no legs, cords or stand are warned about (checkHeldUp: "floats").
// - Geometry comes from web/sim's builder at angle 0 and is turned with the item, except for types whose builder does not turn rigidly (a
//   pendulum's hanger stays level): those are built again at the angle they are placed at.
// - Finally the content is kept on the table (shifted, or the table widened), safety walls stand at the table's ends, and web/sim's own overlap
//   check runs on the result (the target: no warnings).
import { TYPES, build, layout, MAX_ITEMS } from "../sim/index.js"
import { _world_poses } from "../sim/items.js"
import { goalKind, goalItems, goalLabel, GOAL_KINDS, moduleGoal } from "./goals.js"
import { containerInterior, floatHeight, heldByModule, hoversByModule, placeRules } from "../sim/plugins.js"

export const DEFAULT_STAGE = Object.freeze({ x0: -0.55908203125, x1: 3.19091796875, y0: -0.15625, y1: 2.34375 })
export const DEFAULT_TABLE = Object.freeze({ x: 1.3, y: 0, width: 3.7, thickness: 0.15 })
/** Box2D's contact skin as this engine runs it (measured: research in web/ai/test): a polygon or slab carries 1 mm, a ball none, and resting contacts
 *  settle 0.5 mm inside the sum. */
export const SKIN = 0.001
export const SLOP = 0.0005
const OVERLAP_TOL = 0.0004 // deeper than this counts as overlapping (the resting distances are all larger than 0, so a solved scene has none)
const ROOM_GAP = 0.006 // the clearance an item moved out of the way keeps
const CONTAINERS_CHECKED = new Set(["box", "cup", "bucket", "basket"]) // the containers web/sim's inside() (the goal check) knows
const CONTAINERS_BY_WALLS = new Set(["plastic-cup", "glass-jar", "coffee-mug"]) // and the ones ./goals.js judges by their walls in the run
const LONG_PROPS = ["length", "width"] // what a leaned item's span sets, in order of preference
const LEGS_MIN = 0.03 // the 3D view draws a plank's legs only where its end is at least this high (view3d.js)
const AIR_NUDGE = 0.015 // an item given its height in the air is lifted at most this much to clear a body it was put a hair inside
const HOLD_GAP = 0.004 // a static thing with nothing this close under it (and no legs, cords or stand) floats
const OPEN_BELOW = new Set(["funnel"]) // things open at the bottom: a stand goes under their outer ends, never under the opening
const EPS = 1e-9

export class SolveError extends Error {
	constructor(message, issues = []) {
		super(message)
		this.name = "SolveError"
		this.issues = issues
	}
}

// ================================================================ geometry kernel (convex shapes in the machine plane)
// shape = {k: "poly", p: [[x, y], ...] counter-clockwise} | {k: "circle", cx, cy, r}; both carry their box (x0, y0, x1, y1), st (a fixed body) and sk (skin)

function polyShape(p, st) {
	let x0 = Infinity
	let y0 = Infinity
	let x1 = -Infinity
	let y1 = -Infinity
	for (const [x, y] of p) {
		if (x < x0) x0 = x
		if (x > x1) x1 = x
		if (y < y0) y0 = y
		if (y > y1) y1 = y
	}
	return { k: "poly", p, x0, y0, x1, y1, st, sk: SKIN }
}
function circleShape(cx, cy, r, st) {
	return { k: "circle", cx, cy, r, x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r, st, sk: 0 }
}
/** The shape turned by angle a (rad) about the origin, then moved by (dx, dy). */
function moveShape(s, dx, dy, a = 0) {
	const c = Math.cos(a)
	const n = Math.sin(a)
	if (s.k === "circle") return circleShape(dx + s.cx * c - s.cy * n, dy + s.cx * n + s.cy * c, s.r, s.st)
	return polyShape(s.p.map(([x, y]) => [dx + x * c - y * n, dy + x * n + y * c]), s.st)
}

/** [lowest, highest] y of the shape on the vertical line at x (x is clamped into the shape's own range), or null. */
export function vspan(s, x) {
	if (x < s.x0 - EPS || x > s.x1 + EPS) return null
	x = Math.min(s.x1, Math.max(s.x0, x))
	if (s.k === "circle") {
		const d = Math.sqrt(Math.max(0, s.r * s.r - (x - s.cx) ** 2))
		return [s.cy - d, s.cy + d]
	}
	let lo = Infinity
	let hi = -Infinity
	const p = s.p
	for (let i = 0; i < p.length; i++) {
		const [ax, ay] = p[i]
		const [bx, by] = p[(i + 1) % p.length]
		if ((ax - x) * (bx - x) > 0) continue
		if (Math.abs(bx - ax) < 1e-15) {
			lo = Math.min(lo, ay, by)
			hi = Math.max(hi, ay, by)
		} else {
			const y = ay + ((x - ax) / (bx - ax)) * (by - ay)
			if (y < lo) lo = y
			if (y > hi) hi = y
		}
	}
	return lo <= hi ? [lo, hi] : null
}
/** [leftmost, rightmost] x of the shape on the horizontal line at y, or null. */
export function hspan(s, y) {
	if (y < s.y0 - EPS || y > s.y1 + EPS) return null
	y = Math.min(s.y1, Math.max(s.y0, y))
	if (s.k === "circle") {
		const d = Math.sqrt(Math.max(0, s.r * s.r - (y - s.cy) ** 2))
		return [s.cx - d, s.cx + d]
	}
	let lo = Infinity
	let hi = -Infinity
	const p = s.p
	for (let i = 0; i < p.length; i++) {
		const [ax, ay] = p[i]
		const [bx, by] = p[(i + 1) % p.length]
		if ((ay - y) * (by - y) > 0) continue
		if (Math.abs(by - ay) < 1e-15) {
			lo = Math.min(lo, ax, bx)
			hi = Math.max(hi, ax, bx)
		} else {
			const x = ax + ((y - ay) / (by - ay)) * (bx - ax)
			if (x < lo) lo = x
			if (x > hi) hi = x
		}
	}
	return lo <= hi ? [lo, hi] : null
}

const GOLD = (Math.sqrt(5) - 1) / 2
/** The largest value of f on [lo, hi]: f is concave there, so a golden-section search finds it (to machine precision), and the ends are tried too.
 *  `knots`: points where a piecewise-linear f may peak (polygon corners), tried as well (for two polygons they are the whole answer). */
function maxConcave(f, lo, hi, knots, smooth) {
	let best = Math.max(f(lo), f(hi))
	for (const k of knots) if (k > lo && k < hi) best = Math.max(best, f(k))
	if (!smooth) return best
	let a = lo
	let b = hi
	let c = b - GOLD * (b - a)
	let d = a + GOLD * (b - a)
	let fc = f(c)
	let fd = f(d)
	for (let i = 0; i < 90 && b - a > 1e-12; i++) {
		if (fc > fd) {
			b = d
			d = c
			fd = fc
			c = b - GOLD * (b - a)
			fc = f(c)
		} else {
			a = c
			c = d
			fc = fd
			d = a + GOLD * (b - a)
			fd = f(d)
		}
	}
	return Math.max(best, fc, fd)
}

/** How far A must move UP to sit on top of B (negative: how far it can come down before touching); -Infinity when no vertical line meets both. */
export function liftOver(a, b) {
	const lo = Math.max(a.x0, b.x0)
	const hi = Math.min(a.x1, b.x1)
	if (lo > hi + EPS) return -Infinity
	const f = (x) => {
		const sb = vspan(b, x)
		const sa = vspan(a, x)
		return sb && sa ? sb[1] - sa[0] : -Infinity
	}
	const knots = []
	if (a.k === "poly") for (const q of a.p) knots.push(q[0])
	if (b.k === "poly") for (const q of b.p) knots.push(q[0])
	return maxConcave(f, lo, Math.max(lo, hi), knots, a.k === "circle" || b.k === "circle")
}
/** How far A (on the left) can move RIGHT before touching B (negative: how far it must go left to clear it); +Infinity when no horizontal line meets both. */
export function slackRight(a, b) {
	const lo = Math.max(a.y0, b.y0)
	const hi = Math.min(a.y1, b.y1)
	if (lo > hi + EPS) return Infinity
	const f = (y) => {
		const sb = hspan(b, y)
		const sa = hspan(a, y)
		return sb && sa ? -(sb[0] - sa[1]) : -Infinity
	}
	const knots = []
	if (a.k === "poly") for (const q of a.p) knots.push(q[1])
	if (b.k === "poly") for (const q of b.p) knots.push(q[1])
	return -maxConcave(f, lo, Math.max(lo, hi), knots, a.k === "circle" || b.k === "circle")
}

/** How deep two shapes interpenetrate (0 when apart): separating axes for polygons, the nearest side for a circle. */
export function penetration(a, b) {
	if (a.x1 < b.x0 || b.x1 < a.x0 || a.y1 < b.y0 || b.y1 < a.y0) return 0
	if (a.k === "circle" && b.k === "circle") return Math.max(0, a.r + b.r - Math.hypot(a.cx - b.cx, a.cy - b.cy))
	if (a.k === "circle" || b.k === "circle") {
		const [c, s] = a.k === "circle" ? [a, b] : [b, a]
		let inside = Infinity
		let near = Infinity
		const P = s.p
		for (let i = 0; i < P.length; i++) {
			const [x1, y1] = P[i]
			const [x2, y2] = P[(i + 1) % P.length]
			const ex = x2 - x1
			const ey = y2 - y1
			const m = Math.hypot(ex, ey) || 1e-15
			inside = Math.min(inside, (ex * (c.cy - y1) - ey * (c.cx - x1)) / m)
			const u = Math.max(0, Math.min(1, ((c.cx - x1) * ex + (c.cy - y1) * ey) / (m * m)))
			near = Math.min(near, Math.hypot(c.cx - x1 - u * ex, c.cy - y1 - u * ey))
		}
		if (inside >= 0) return c.r + inside
		return near < c.r ? c.r - near : 0
	}
	let depth = Infinity
	for (const poly of [a.p, b.p]) {
		for (let i = 0; i < poly.length; i++) {
			const [x1, y1] = poly[i]
			const [x2, y2] = poly[(i + 1) % poly.length]
			let ax = -(y2 - y1)
			let ay = x2 - x1
			const m = Math.hypot(ax, ay) || 1e-15
			ax /= m
			ay /= m
			let a0 = Infinity
			let a1 = -Infinity
			let b0 = Infinity
			let b1 = -Infinity
			for (const [px, py] of a.p) {
				const v = px * ax + py * ay
				if (v < a0) a0 = v
				if (v > a1) a1 = v
			}
			for (const [px, py] of b.p) {
				const v = px * ax + py * ay
				if (v < b0) b0 = v
				if (v > b1) b1 = v
			}
			const o = Math.min(a1, b1) - Math.max(a0, b0)
			if (o <= 0) return 0
			depth = Math.min(depth, o)
		}
	}
	return depth
}

/** The distance two bodies settle at when one rests on the other in this engine (two fixed things: none, they never meet in the physics). */
export function restGap(a, b) {
	if (a.st && b.st) return 0
	return Math.max(0, a.sk + b.sk - SLOP)
}

// ---- item level: an item is a list of shapes
const boxOf = (shapes) => {
	let x0 = Infinity
	let y0 = Infinity
	let x1 = -Infinity
	let y1 = -Infinity
	for (const s of shapes) {
		if (s.x0 < x0) x0 = s.x0
		if (s.y0 < y0) y0 = s.y0
		if (s.x1 > x1) x1 = s.x1
		if (s.y1 > y1) y1 = s.y1
	}
	return { x0, y0, x1, y1 }
}
/** How far item A must go up to rest on item B at their resting distance (-Infinity: nothing of B is under A). */
function liftItem(A, B) {
	let L = -Infinity
	for (const a of A) for (const b of B) {
		const v = liftOver(a, b)
		if (v > -Infinity) L = Math.max(L, v + restGap(a, b))
	}
	return L
}
/** How far item A (left) can move right before it is at the resting distance from item B (+Infinity: no horizontal line meets both). */
function slackItem(A, B) {
	let S = Infinity
	for (const a of A) for (const b of B) {
		const v = slackRight(a, b)
		if (v < Infinity) S = Math.min(S, v - restGap(a, b))
	}
	return S
}
function depthItem(A, B) {
	let d = 0
	for (const a of A) for (const b of B) d = Math.max(d, penetration(a, b))
	return d
}
/** The highest point of these shapes on the vertical line x (-Infinity if none). */
/** The lowest point of these shapes at x (Infinity where none of them is). */
function bottomAt(shapes, x) {
	let bottom = Infinity
	for (const q of shapes) {
		const v = vspan(q, x)
		if (v && v[0] < bottom) bottom = v[0]
	}
	return bottom
}
const fmtCm = (m) => (m < 1 ? `${Math.round(m * 100)} cm` : `${m.toFixed(2)} m`)
function topAt(shapes, x) {
	let t = -Infinity
	for (const s of shapes) {
		const v = vspan(s, x)
		if (v && v[1] > t) t = v[1]
	}
	return t
}

// ================================================================ item outlines (from web/sim's builder)
const geoCache = new Map()
/** Angles a geometry is built at once more, to find builders that do not simply turn the whole item (a pendulum's hanger stays level). */
const RIGID_PROBES = [17, -63, 135]
/**
 * An item's solids built alone at the origin (x = y = 0, at angleDeg) as shapes, plus its depth (front to back), its legged slabs, the name of
 * each part (shapes[i] is parts[i]) and whether the 3D view draws something that holds it up by itself (cords, a stand, a post for a hinge).
 * `rigid` (at angle 0): turning the item turns every part with it; when false, shapesAt() builds it again at the angle it is placed at.
 * Cached by type, props, fixed and angle. Throws the builder's error for props it can't build.
 */
export function itemGeometry(type, props = {}, fixed = false, angleDeg = 0) {
	const ang = angleDeg ? Math.round(angleDeg * 1e9) / 1e9 : 0
	const key = `${type}|${JSON.stringify(props)}|${fixed ? 1 : 0}|${ang}`
	let g = geoCache.get(key)
	if (g) return g
	const item = { id: "g", type, x: 0, y: 0, angle: ang, props: { ...props } }
	if (fixed) item.fixed = true
	const { doc } = build({ stage: { ...DEFAULT_STAGE }, items: [item] })
	const world = _world_poses(doc)
	const shapes = []
	const parts = []
	const legged = []
	let depth = 0
	for (const s of doc.solids) {
		const [x, y, a] = world.get(s.id)
		const st = s.kind === "static"
		const b = s.body
		parts.push({ name: s.id.slice(s.id.indexOf("/") + 1), slab: b.kind === "slab", st })
		if (b.kind === "ball") {
			shapes.push(circleShape(x, y, b.radius, st))
			depth = Math.max(depth, Number(s.depth3d ?? 2 * b.radius))
			continue
		}
		let pts
		if (b.kind === "polygon") pts = b.points.map((q) => [q.x, q.y])
		else {
			const hw = b.width / 2
			const hh = b.height / 2
			const hb = hw * (b.taper ?? 1)
			pts = [[-hb, -hh], [hb, -hh], [hw, hh], [-hw, hh]]
		}
		const c = Math.cos(a)
		const n = Math.sin(a)
		shapes.push(polyShape(pts.map(([px, py]) => [x + px * c - py * n, y + px * n + py * c]), st))
		depth = Math.max(depth, Number(b.depth) || 0)
		if (s.legs && b.kind === "slab" && st) legged.push({ x, y, a, hw: b.width / 2, hh: b.height / 2, depth: Number(b.depth) || 0 })
	}
	// what the 3D view holds up by itself when it is in the air (view3d.js "Mounts"): the cords of a hung box, a post or a panel behind a static ball
	// (a peg, a bumper) or a static part with a stand, a post for a hinge or a hanger
	const mounted =
		(doc.animated ?? []).some((m) => m.sprite === "cord") ||
		doc.solids.some((s) => s.kind === "static" && (s.body.kind === "ball" || s.stand)) ||
		(doc.joints ?? []).length > 0 ||
		doc.solids.some((s) => s.pivot && !s.parent)
	// which static parts the 3D view stands on a retort stand of its own when nothing is under them (view3d.js mounts: a peg's post, the block a
	// hinge or a pendulum hangs from): parts[i].mount = "post" | "panel" | "wall" | null, as the view picks it
	const carriers = new Set()
	const hinges = []
	for (const j of doc.joints ?? []) {
		for (const id of [j.a, j.b, j.chassis, j.wheel]) if (id) carriers.add(id)
		if (j.kind === "pulley") hinges.push(j.groundA, j.groundB)
		else if (j.kind !== "wheel") {
			if (j.a === null || j.a === undefined) hinges.push(j.anchorA)
			if (j.b === null || j.b === undefined) hinges.push(j.anchorB)
		}
	}
	for (const d of doc.solids) {
		if (!d.pivot) continue
		if (d.parent) carriers.add(d.parent)
		else {
			const [x, y, a] = world.get(d.id)
			hinges.push({ x: x + d.pivot.x * Math.cos(a) - d.pivot.y * Math.sin(a), y: y + d.pivot.x * Math.sin(a) + d.pivot.y * Math.cos(a) })
		}
	}
	const roundStatics = doc.solids.filter((s) => s.kind === "static" && s.body.kind === "ball").length
	doc.solids.forEach((s, i) => {
		if (s.kind !== "static") return
		const hint = s.stand === "post" || s.stand === "panel" || s.stand === "wall" ? s.stand : null
		const q = shapes[i]
		const carries = carriers.has(s.id) || hinges.some((h) => h && h.x >= q.x0 - 0.04 && h.x <= q.x1 + 0.04 && h.y >= q.y0 - 0.04 && h.y <= q.y1 + 0.04)
		parts[i].mount = s.body.kind === "ball" ? hint ?? (roundStatics > 1 ? "panel" : "post") : hint ?? (carries ? "post" : null)
	})
	g = { shapes, parts, depth, legged, mounted, solids: doc.solids.length, type, props: { ...props }, fixed: !!fixed, angle: ang, rigid: true }
	if (geoCache.size > 800) geoCache.clear()
	geoCache.set(key, g)
	if (ang === 0) g.rigid = rigidUnderTurn(g)
	return g
}
const heldCache = new Map()
/** The parts of a held item the 3D view stands on a post with a pull pin until the release (the release's parts: view3d.js), as indices into
 *  its geometry's parts. */
function heldParts(geo) {
	const key = `${geo.type}|${JSON.stringify(geo.props)}|${geo.fixed ? 1 : 0}|${geo.angle ?? 0}`
	let out = heldCache.get(key)
	if (out) return out
	out = []
	try {
		const item = { id: "g", type: geo.type, x: 0, y: 0, angle: geo.angle ?? 0, props: { ...geo.props }, held: true }
		if (geo.fixed) item.fixed = true
		const ids = new Set((build({ stage: { ...DEFAULT_STAGE }, items: [item] }).doc.release?.parts ?? []).map((id) => String(id).slice(String(id).indexOf("/") + 1)))
		geo.parts.forEach((p, i) => ids.has(p.name) && out.push(i))
	} catch {}
	if (heldCache.size > 400) heldCache.clear()
	heldCache.set(key, out)
	return out
}
/** Does turning the item turn every part of it rigidly about its anchor? (built again at a few angles and compared, to 20 µm) */
function rigidUnderTurn(g) {
	for (const A of RIGID_PROBES) {
		let h
		try {
			h = itemGeometry(g.type, g.props, g.fixed, A)
		} catch {
			continue
		}
		if (h.shapes.length !== g.shapes.length) return false
		const a = (A * Math.PI) / 180
		for (let i = 0; i < g.shapes.length; i++) {
			const p = moveShape(g.shapes[i], 0, 0, a)
			const q = h.shapes[i]
			if (p.k !== q.k) return false
			if (p.k === "circle") {
				if (Math.abs(p.cx - q.cx) > 2e-5 || Math.abs(p.cy - q.cy) > 2e-5) return false
			} else {
				if (p.p.length !== q.p.length) return false
				for (let k = 0; k < p.p.length; k++) if (Math.abs(p.p[k][0] - q.p[k][0]) > 2e-5 || Math.abs(p.p[k][1] - q.p[k][1]) > 2e-5) return false
			}
		}
	}
	return true
}
/** A ball (all of it round: turning it changes nothing). */
const isRound = (geo) => geo.shapes.every((q) => q.k === "circle")
/** The geometry as the builder makes it at this angle (the same one, for an item that turns rigidly). */
const geoAt = (geo, angleDeg) => (geo.rigid === false && Math.abs(angleDeg - (geo.angle ?? 0)) > 1e-9 ? itemGeometry(geo.type, geo.props, geo.fixed, angleDeg) : geo)
/** The item's shapes in the world at (x, y, angle in degrees about its anchor). */
export function shapesAt(geo, x, y, angleDeg) {
	const g = geoAt(geo, angleDeg)
	const a = ((angleDeg - (g.angle ?? 0)) * Math.PI) / 180
	return g.shapes.map((s) => moveShape(s, x, y, a))
}
/** Where the 3D view draws a legged plank's legs (vertical dowels from the floor y = 0 up to its underside, at both ends: view3d.js), as thin boxes. */
function legShapes(geo0, x, y, angleDeg) {
	const out = []
	const geo = geoAt(geo0, angleDeg)
	const A = ((angleDeg - (geo.angle ?? 0)) * Math.PI) / 180
	const c0 = Math.cos(A)
	const n0 = Math.sin(A)
	for (const L of geo.legged) {
		const px = x + L.x * c0 - L.y * n0
		const py = y + L.x * n0 + L.y * c0
		const a = L.a + A
		const c = Math.cos(a)
		const n = Math.sin(a)
		const reach = L.hw - Math.min(0.04, L.hw * 0.5)
		for (const sx of [-1, 1]) {
			const ex = px + sx * reach * c + L.hh * n
			const ey = py + sx * reach * n - L.hh * c
			if (ey < LEGS_MIN) continue
			out.push({ shape: polyShape([[ex - 0.008, 0], [ex + 0.008, 0], [ex + 0.008, ey], [ex - 0.008, ey]], true), depth: L.depth })
		}
	}
	return out
}

/** Supports that carry a load on a part of their own (the catalog: "put a ball on the long end", "flings what sits on it"): that part's top face
 *  is the seat, the stops are the parts that keep the load on it. `centre`: a level seat (or a held load) is used in its middle. */
const SEATS = {
	"spring-launcher": { part: "plate", label: "plate", stops: ["guide1", "guide2"], centre: true },
	"bounce-pad": { part: "plate", label: "plate", stops: ["guide1", "guide2"], centre: true },
	"spring-catapult": { part: "arm", label: "arm", stops: ["lip"] },
	seesaw: { part: "plank", label: "plank", stops: ["lip"] }
}
/** The seat of a placed support (in the world): {phi (its top face's angle, rad), ox, oy (the middle of its top face), half (half its length),
 *  stops: [shapes], centre, part, label}, or null for a type without one (or a seat turned more than 80°). */
function seatOf(S) {
	const def = SEATS[S?.spec?.type]
	if (!def) return null
	const geo = geoAt(S.geo, S.angle)
	const i = geo.parts.findIndex((q) => q.name === def.part)
	const q = S.shapes[i]
	if (i < 0 || !geo.parts[i].slab || q?.k !== "poly" || q.p.length !== 4) return null
	const tl = q.p[3]
	const tr = q.p[2] // (a slab's corners run bottom-left, bottom-right, top-right, top-left in its own frame)
	const phi = Math.atan2(tr[1] - tl[1], tr[0] - tl[0])
	if (Math.abs(phi) > (80 * Math.PI) / 180) return null
	const stops = geo.parts.map((pp, k) => (def.stops.includes(pp.name) ? S.shapes[k] : null)).filter(Boolean)
	return { phi, ox: (tl[0] + tr[0]) / 2, oy: (tl[1] + tr[1]) / 2, half: Math.hypot(tr[0] - tl[0], tr[1] - tl[1]) / 2, stops, centre: !!def.centre, part: def.part, label: def.label }
}

// ================================================================ plan normalisation
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null)
const r6 = (v) => Math.round(v * 1e6) / 1e6
const schemaCache = new Map()
function schemaOf(type) {
	let s = schemaCache.get(type)
	if (!s) {
		s = TYPES[type].schema()
		s.byKey = new Map(s.props.map((p) => [p.key, p]))
		for (const l of s.links ?? []) s.byKey.set(l.key, l) // (a module's links to other items: set like props, resolved to ids below)
		schemaCache.set(type, s)
	}
	return s
}
export const typeName = (type) => TYPES[type]?.name ?? type
/** A prop's catalog spec ({key, label, unit, kind, min, max, ...}) and its default, or null. */
export function propSpec(type, key) {
	if (!TYPES[type]) return null
	const sch = schemaOf(type)
	const sp = sch.byKey.get(key)
	return sp ? { ...sp, default: sch.defaults[key] } : null
}
/** Does this item stay where it is in the engine (a static type, or a dynamic one pinned with fixed)? */
export const isStaticItem = (type, fixed = false) => !!TYPES[type] && (!TYPES[type].dynamic || fixed === true)
/** Does the 3D view hold this item up by itself when it is in the air (a hung box's cords, a stand, a post for its hinge; a plank's legs)? */
export function holdsItselfUp(type, props = {}, fixed = false) {
	try {
		const g = itemGeometry(type, props, fixed)
		return g.mounted || g.legged.length > 0
	} catch {
		return false
	}
}
/** The prop keys a type has (its catalog props and its material's), or null for a type the library doesn't have. */
export const propKeys = (type) => (TYPES[type] ? new Set(schemaOf(type).byKey.keys()) : null)
const isContainer = (type) => TYPES[type]?.category === "Containers" || placeRules().containers.has(type) // (and a module's: a beaker, a tank)
const SUPPORT_WORDS = new Map([["table", "table"], ["floor", "table"], ["ground", "table"], ["tabletop", "table"], ["table top", "table"], ["air", "air"], ["held", "air"], ["mid-air", "air"], ["midair", "air"]])

/** Whether v joins an open choice's words with "+" (force arrows' "gravity+support+net"): ai/schemas.mjs joinedChoice. */
function joinedChoice(spec, v) {
	if (spec.open !== true || typeof v !== "string" || !(spec.choices ?? []).some((c) => typeof c === "string" && c.includes("+"))) return false
	const words = new Set(spec.choices.flatMap((c) => String(c).toLowerCase().split("+")))
	const mine = v.trim().toLowerCase().split(/[,+\s]+/).filter(Boolean)
	return mine.length > 0 && v.trim().length <= 64 && mine.every((w) => words.has(w))
}

/** A prop value the catalog accepts: numbers clamped into range (ints rounded), yes/no from words, choices checked. -> {value} or {drop: why} */
function checkProp(spec, v) {
	if (spec.kind === "link") return typeof v === "string" && v.trim() ? { value: v.trim() } : { drop: `“${v}” doesn't name another item` } // (resolved once every item has its id)
	if (spec.kind === "bool") {
		if (typeof v === "boolean") return { value: v }
		if (v === 0 || v === 1) return { value: v === 1 }
		const t = String(v).trim().toLowerCase()
		if (["true", "yes", "on", "1"].includes(t)) return { value: true }
		if (["false", "no", "off", "0"].includes(t)) return { value: false }
		return { drop: `“${v}” isn't yes or no` }
	}
	if (spec.kind === "choice") {
		if (spec.choices?.includes(v)) return { value: v }
		const hit = spec.choices?.find((c) => String(c).toLowerCase() === String(v).toLowerCase())
		if (hit === undefined && spec.open === true && typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v.trim())) return { value: v.trim() } // (an open choice: a colour's "#rrggbb" too, as ai/schemas.mjs takes it)
		if (hit === undefined && joinedChoice(spec, v)) return { value: v.trim().toLowerCase().split(/[,+\s]+/).filter(Boolean).join("+") } // (an open choice of joinable words: force arrows' "gravity+support+net", as ai/schemas.mjs takes it)
		return hit !== undefined ? { value: hit } : { drop: `“${v}” isn't one of ${spec.choices?.join(", ")}${spec.open === true ? " or a #rrggbb colour" : ""}` }
	}
	let x = num(v)
	if (x === null) return { drop: `“${v}” isn't a number` }
	if (spec.kind === "int") x = Math.round(x)
	const lo = spec.min ?? -Infinity
	const hi = spec.max ?? Infinity
	if (x < lo || x > hi) {
		const c = Math.min(hi, Math.max(lo, x))
		return { value: c, clamped: `${spec.label ?? spec.key} ${x} is outside ${lo}…${hi} ${spec.unit ?? ""}`.trim() + `: set to ${c}` }
	}
	return { value: x }
}

/** Props as a scene item stores them: only what differs from the type's defaults (an `auto` prop has no default, so it always stays). */
function trimProps(type, props) {
	const d = schemaOf(type).defaults
	const out = {}
	for (const [k, v] of Object.entries(props)) {
		const dv = d[k]
		if (typeof v === "number" && typeof dv === "number" ? Math.abs(v - dv) > 1e-9 : v !== dv) out[k] = v
	}
	return out
}

/** An id the server takes (1 to 80 characters, no "/", not used before). */
function cleanId(raw, used, type) {
	let id = typeof raw === "string" ? raw.trim().replace(/\//g, "-").slice(0, 80) : ""
	if (!id) id = String(type || "item").replace(/[^a-z0-9]+/gi, "-")
	let out = id
	let n = 2
	while (used.has(out)) out = `${id.slice(0, 76)}-${n++}`
	used.add(out)
	return out
}

/** The plan's place, read loosely (the model's wording varies a little): {on, x, side, rel, gap, touching, angle, inside, lean, y, bottom, keep} */
function readPlace(p, idMap) {
	const P = isObj(p) ? p : {}
	const ref = (v) => {
		if (v === undefined || v === null || v === "") return undefined
		const s = String(isObj(v) ? v.id ?? v.on ?? "" : v)
		const w = SUPPORT_WORDS.get(s.trim().toLowerCase())
		if (w) return w
		return idMap.get(s) ?? s
	}
	const out = { raw: P }
	out.on = ref(P.on)
	out.x = num(P.x)
	out.angle = num(P.angle_deg ?? P.angle)
	out.inside = ref(P.inside ?? P.in)
	out.y = num(P.y_m ?? P.y)
	out.bottom = num(P.bottom_m)
	out.keep = P.keep === true
	out.touching = P.align === "touching" || P.touching === true
	for (const side of ["left_of", "right_of"]) {
		const r = P[side]
		if (r === undefined || r === null) continue
		out.side = side === "left_of" ? "left" : "right"
		out.rel = ref(isObj(r) ? r.id : r)
		out.gap = isObj(r) ? num(r.gap_m ?? r.gap) : null
	}
	if (isObj(P.lean)) {
		const end = (e) => (isObj(e) ? { on: ref(e.on) ?? (num(e.y ?? e.y_m) !== null ? "air" : "table"), x: num(e.x), y: num(e.y ?? e.y_m) } : null)
		out.lean = { from: end(P.lean.from), to: end(P.lean.to) }
	}
	return out
}

// ================================================================ the solver
/**
 * plan -> {ok, scene, issues, errors, placements, order, ms}
 * opts: {safetyWalls (default true), table: {x, width} override, keepStage (use the plan's stage as is)}
 * issues: [{level: "error" | "warn" | "info", code, item?, text}] in plain words (the report shows them; refine reads them).
 * ok is false when an error-level issue was found (an unknown type, a cycle, something that can't fit): the scene is still the best that could be made.
 */
export function solve(plan, opts = {}) {
	const t0 = typeof performance !== "undefined" ? performance.now() : Date.now()
	if (!isObj(plan)) throw new SolveError("the plan must be an object")
	if (!Array.isArray(plan.items)) throw new SolveError("the plan has no items list")
	const issues = []
	const say = (level, code, text, item) => issues.push(item ? { level, code, item, text } : { level, code, text })

	// ---- 1. the items: known types, clean ids, real props
	const used = new Set()
	const idMap = new Map() // an id as the plan wrote it -> the id it got (only where they differ; the first item with a repeated id keeps it)
	const rawSeen = new Set()
	const dropped = new Set() // ids of items left out (an unknown type): what refers to them is told so, without a second error
	const specs = []
	for (const raw of plan.items) {
		if (!isObj(raw)) continue
		const type = typeof raw.type === "string" ? raw.type.trim() : ""
		if (!TYPES[type]) {
			say("error", "unknown_type", `“${raw.name ?? raw.id ?? type}” asks for a type the library doesn't have (${type || "none"}), so it was left out`, raw.id)
			if (raw.id !== undefined) dropped.add(String(raw.id))
			continue
		}
		const id = cleanId(raw.id, used, type)
		const rid = raw.id === undefined ? null : String(raw.id)
		if (rid !== null && rid !== id && !rawSeen.has(rid)) idMap.set(rid, id)
		if (rid !== null) rawSeen.add(rid)
		specs.push({ raw, id, type })
	}
	if (specs.length > MAX_ITEMS) throw new SolveError(`the plan has ${specs.length} items; a scene holds at most ${MAX_ITEMS}`)
	const byId = new Map()
	for (const s of specs) {
		const sch = schemaOf(s.type)
		const props = {}
		for (const [k, v] of Object.entries(isObj(s.raw.props) ? s.raw.props : {})) {
			const spec = sch.byKey.get(k)
			if (!spec) {
				say("info", "unknown_prop", `${typeName(s.type)} has no setting “${k}”: ignored`, s.id)
				continue
			}
			const c = checkProp(spec, v)
			if (c.drop) say("warn", "bad_prop", `${typeName(s.type)} ${spec.label ?? k}: ${c.drop}; the default is used`, s.id)
			else {
				props[k] = c.value
				if (c.clamped) say("warn", "clamped_prop", c.clamped, s.id)
			}
		}
		s.props = props
		s.name = typeof s.raw.name === "string" && s.raw.name.trim() ? s.raw.name.trim().slice(0, 80) : typeName(s.type)
		s.held = s.raw.held === true
		s.fixed = s.raw.fixed === true
		s.place = readPlace(s.raw.place, idMap)
		byId.set(s.id, s)
	}

	// ---- 1b. links to other items (a module's: a stopwatch's watched car, a wire's ends): the plan may name the other item by its id as the plan
	// wrote it, by the id it got, or by its name; anything else is dropped with a note
	for (const s of specs) {
		for (const l of schemaOf(s.type).links ?? []) {
			const v = s.props?.[l.key]
			if (typeof v !== "string") continue
			const low = v.trim().toLowerCase()
			const hit = byId.has(v) ? v : idMap.has(v) ? idMap.get(v) : [...byId.values()].find((o) => o !== s && (o.name.toLowerCase() === low || o.id.toLowerCase() === low))?.id
			const ok = hit && hit !== s.id && (!l.types?.length || l.types.includes(byId.get(hit)?.type))
			if (ok) s.props[l.key] = hit
			else {
				delete s.props[l.key]
				say("warn", "bad_link", `${s.name}'s ${String(l.label ?? l.key).toLowerCase()} “${v}” isn't ${l.types?.length ? `a ${l.types.map(typeName).join(" or ")}` : "an item"} of the scene: left unlinked`, s.id)
			}
		}
	}

	// ---- 2. the table (always: "on the table" needs one) and what each item depends on
	let table = specs.find((s) => s.type === "table")
	if (!table) {
		const id = cleanId("table", used, "table")
		table = { raw: {}, id, type: "table", props: {}, name: "Table", place: readPlace({ on: "air" }, idMap), held: false, fixed: false, auto: true }
		specs.unshift(table)
		byId.set(id, table)
	}
	const planTable = isObj(plan.table) ? plan.table : {}
	const tableX = num(opts.table?.x) ?? num(planTable.x) ?? num(table.raw.place?.x) ?? num(table.raw.x) ?? DEFAULT_TABLE.x
	if (isObj(planTable.props)) {
		const sch = schemaOf("table")
		for (const [k, v] of Object.entries(planTable.props)) {
			const spec = sch.byKey.get(k)
			if (!spec) continue
			const c = checkProp(spec, v)
			if (!c.drop && table.props[k] === undefined) table.props[k] = c.value
		}
	}
	table.props = { width: DEFAULT_TABLE.width, thickness: DEFAULT_TABLE.thickness, ...table.props }
	if (num(opts.table?.width)) table.props.width = num(opts.table.width)
	const known = (ref) => ref === "table" || ref === "air" || byId.has(ref)

	const deps = new Map()
	for (const s of specs) {
		const d = new Set()
		const p = s.place
		if (s === table) {
			deps.set(s.id, d)
			continue
		}
		const need = (ref, what) => {
			if (ref === undefined || ref === "table" || ref === "air") return
			if (ref === s.id) {
				say("error", "self_reference", `${s.name} can't be placed ${what} itself`, s.id)
				return "bad"
			}
			if (!byId.has(ref)) {
				if (dropped.has(ref)) say("warn", "dropped_ref", `${s.name} was meant to be ${what} “${ref}”, which was left out: it went on the table instead`, s.id)
				else say("error", "unknown_ref", `${s.name} is placed ${what} “${ref}”, which isn't in the plan`, s.id)
				return "bad"
			}
			d.add(ref)
		}
		if (need(p.on, "on") === "bad") p.on = "table"
		if (need(p.inside, "inside") === "bad") p.inside = undefined
		if (p.rel !== undefined && need(p.rel, p.side === "left" ? "left of" : "right of") === "bad") p.rel = undefined
		if (p.lean) {
			for (const end of ["from", "to"]) {
				if (!p.lean[end]) {
					say("error", "lean_end", `${s.name} leans, but its “${end}” end isn't given`, s.id)
					p.lean = null
					break
				}
				if (need(p.lean[end].on, "leaning on") === "bad") p.lean[end].on = "table"
			}
		}
		deps.set(s.id, d)
	}

	// ---- 3. order: supports before what rests on them; explicit positions before defaulted ones; else the plan's order. Cycles are errors.
	const order = []
	{
		const indeg = new Map(specs.map((s) => [s.id, 0]))
		const users = new Map(specs.map((s) => [s.id, []]))
		for (const [id, d] of deps) for (const r of d) {
			indeg.set(id, indeg.get(id) + 1)
			users.get(r).push(id)
		}
		// (a thing a module says a hand holds over the others, a pitcher, after them: it is raised clear of a bowl, never the bowl pushed aside)
		const rank = new Map(specs.map((s, i) => [s.id, (s === table ? -1e6 : 0) + (s.place.x === null && s.place.rel === undefined && !s.place.lean && s.place.inside === undefined && !byId.has(s.place.on) ? 1e4 : 0) + (s.place.on === "air" && hoversByModule(s.type) ? 5e3 : 0) + i]))
		const ready = specs.filter((s) => indeg.get(s.id) === 0).map((s) => s.id)
		const done = new Set()
		const pop = () => {
			ready.sort((a, b) => rank.get(a) - rank.get(b))
			return ready.shift()
		}
		while (order.length < specs.length) {
			if (!ready.length) {
				// a cycle: name it, then place its first item on the table so the rest can be solved
				const left = specs.filter((s) => !done.has(s.id))
				const start = left[0].id
				const path = [start]
				const seen = new Set([start])
				let cur = start
				for (;;) {
					const next = [...deps.get(cur)].find((r) => !done.has(r))
					if (next === undefined) break
					path.push(next)
					if (seen.has(next)) break
					seen.add(next)
					cur = next
				}
				const loopAt = path.indexOf(path[path.length - 1])
				const loop = path.slice(loopAt)
				say("error", "cycle", `These placements depend on each other in a circle: ${loop.map((id) => byId.get(id).name).join(" → ")}. ${byId.get(loop[0]).name} was put on the table instead`, loop[0])
				const s = byId.get(loop[0])
				s.place = readPlace({ on: "table", x: s.place.x }, idMap)
				for (const r of deps.get(s.id)) {
					indeg.set(s.id, indeg.get(s.id) - 1)
					users.set(r, users.get(r).filter((u) => u !== s.id))
				}
				deps.set(s.id, new Set())
				if (indeg.get(s.id) === 0) ready.push(s.id)
				continue
			}
			const id = pop()
			done.add(id)
			order.push(id)
			for (const u of users.get(id)) {
				indeg.set(u, indeg.get(u) - 1)
				if (indeg.get(u) === 0) ready.push(u)
			}
		}
	}

	// ---- 4. place them, one by one
	const placed = new Map() // id -> {spec, geo, x, y, angle, shapes, box, legs}
	const placements = []
	const geometryOf = (s) => {
		try {
			return itemGeometry(s.type, s.props, s.fixed)
		} catch (e) {
			say("error", "cant_build", `${s.name} can't be built with these settings: ${e.message}`, s.id)
			s.props = {}
			return itemGeometry(s.type, {}, s.fixed)
		}
	}
	const put = (s, geo, x, y, angle) => {
		const shapes = shapesAt(geo, x, y, angle)
		const P = { spec: s, geo, x, y, angle, shapes, box: boxOf(shapes), legs: legShapes(geo, x, y, angle) }
		placed.set(s.id, P)
		return P
	}
	const tableTop = () => placed.get(table.id).y
	/** the shapes of a support ("table" = the table item) */
	const supportShapes = (ref) => placed.get(ref === "table" ? table.id : ref)?.shapes ?? []

	for (const id of order) {
		const s = byId.get(id)
		const p = s.place
		const report = { id, type: s.type, name: s.name }
		placements.push(report)
		if (s === table) {
			const geo = geometryOf(s)
			put(s, geo, tableX, num(planTable.y) ?? num(table.raw.y) ?? 0, 0)
			report.support = "floor"
			continue
		}
		let geo = geometryOf(s)
		// a lean sets the span of a plank-like item: its length prop is decided before its outline
		if (p.lean) {
			const r = solveLean(s, geo)
			if (r) {
				geo = r.geo
				put(s, geo, r.x, r.y, r.angle)
				Object.assign(report, { support: "lean", on: [p.lean.from.on, p.lean.to.on], angle: r.angle, contacts: r.contacts })
				clearOverlaps(s, "lean", report)
				continue
			}
		}
		const sup = p.inside ?? (p.on === undefined ? (p.y !== null || p.bottom !== null ? "air" : "table") : p.on)
		if (p.inside !== undefined && !isContainer(byId.get(p.inside)?.type)) say("warn", "not_container", `${s.name} is meant to go inside ${byId.get(p.inside).name}, which isn't a container: it was put on top of it`, s.id)
		if (sup === "air") placeAir(s, geo, report)
		else placeOn(s, geo, sup, p.inside !== undefined && isContainer(byId.get(p.inside)?.type), report)
	}

	// ---- 4b. a thing floating in a container starts at its LOADED floating height: what rests on it (a boat's cargo, and what rests on that)
	// weighs it down, so it and its riders go down together by that much (web/sim/plugins.js place.float); one that would sink loaded is left
	for (const rep of placements) {
		if (rep.floats === undefined) continue
		const s = byId.get(rep.id)
		const riders = []
		const seen = new Set([rep.id])
		for (let grew = true; grew; ) {
			grew = false
			for (const q of specs) {
				if (seen.has(q.id) || !placed.has(q.id) || q.place?.inside !== undefined) continue
				if (q.place?.on !== undefined && seen.has(q.place.on)) {
					seen.add(q.id)
					riders.push(q)
					grew = true
				}
			}
		}
		if (!riders.length || !s?.place?.inside) continue
		const C = byId.get(s.place.inside)
		const CP = placed.get(C.id)
		const P = placed.get(s.id)
		const fy = floatHeight({ type: s.type, props: s.props, x: P.x, angle: P.angle }, { type: C.type, props: C.props, x: CP.x, y: CP.y }, riders.map((q) => ({ type: q.type, props: q.props })))
		if (fy === null || Math.abs(fy - P.y) < 1e-5) continue
		const dy = fy - P.y
		for (const q of [s, ...riders]) {
			const Q = placed.get(q.id)
			put(q, Q.geo, Q.x, Q.y + dy, Q.angle)
		}
		rep.floats = r6(fy)
		rep.cargo = riders.map((q) => q.id)
	}

	// ---- 5. the table: everything on it, safety walls at its ends; the stage around it all
	const content = [...placed.values()].filter((P) => P.spec !== table && !P.spec.safety)
	const T = placed.get(table.id)
	if (content.length) {
		const box = boxOf(content.flatMap((P) => P.shapes))
		const half = table.props.width / 2
		const margin = 0.06
		let tx0 = T.x - half
		let tx1 = T.x + half
		let shift = 0
		// (opts.noShift, for an edit of the scene on the table: nothing the edit did not touch may move, so a table too short for the edited
		// content is widened about its own middle instead of the content being shifted along it)
		const needW = 2 * Math.max(T.x - (box.x0 - margin), box.x1 + margin - T.x)
		if (opts.noShift && (box.x0 < tx0 + margin - 1e-9 || box.x1 > tx1 - margin + 1e-9) && needW <= 8) {
			const was = table.props.width
			table.props.width = r6(Math.ceil(needW * 100) / 100)
			put(table, itemGeometry("table", table.props), T.x, T.y, 0)
			say("info", "table_widened", `The table was widened from ${was} m to ${table.props.width} m so everything stands on it`)
		} else if (box.x1 - box.x0 + 2 * margin <= tx1 - tx0) {
			if (box.x0 < tx0 + margin) shift = tx0 + margin - box.x0
			else if (box.x1 > tx1 - margin) shift = tx1 - margin - box.x1
		} else {
			const w = Math.min(8, box.x1 - box.x0 + 2 * margin)
			if (w > table.props.width + 1e-9) {
				const was = table.props.width
				table.props.width = r6(w)
				const tgeo = itemGeometry("table", table.props)
				put(table, tgeo, r6((box.x0 + box.x1) / 2), T.y, 0)
				say("info", "table_widened", `The table was widened from ${was} m to ${table.props.width} m so everything stands on it`)
			}
			if (box.x1 - box.x0 + 2 * margin > 8) say("warn", "too_wide", `The machine is ${(box.x1 - box.x0).toFixed(2)} m wide, more than the largest table (8 m): its ends hang over`)
		}
		if (Math.abs(shift) > 1e-9) {
			for (const P of content) put(P.spec, P.geo, P.x + shift, P.y, P.angle)
			say("info", "shifted", `Everything was moved ${Math.abs(shift).toFixed(2)} m ${shift > 0 ? "right" : "left"} to stand on the table`)
		}
	}
	// static things left in mid-air get something to stand on (their own legs or cords, else a fixed wooden stand under them)
	const supportSpecs = opts.supports === false ? [] : addSupports()
	const T2 = placed.get(table.id)
	const wallSpecs = []
	if (opts.safetyWalls !== false) {
		const half = table.props.width / 2
		const walls = specs.filter((s) => s.type === "wall")
		for (const [side, sx] of [["left", -1], ["right", 1]]) {
			const wx = r6(T2.x + sx * (half - 0.03))
			if (walls.some((w) => Math.abs(placed.get(w.id).x - wx) < 0.15)) continue
			const wid = cleanId(`wall-${side}`, used, "wall")
			const w = { raw: {}, id: wid, type: "wall", props: { invisible_in_3d: true }, name: side === "left" ? "Left wall" : "Right wall", place: readPlace({ on: "table" }, idMap), held: false, fixed: false, safety: true }
			const geo = itemGeometry("wall", w.props)
			const hit = [...placed.values()].some((P) => P.spec !== table && !P.spec.safety && depthItem(shapesAt(geo, wx, T2.y, 0), P.shapes) > 0)
			if (hit) continue // (something stands at the very end of the table: no wall through it)
			put(w, geo, wx, T2.y, 0)
			specs.push(w)
			byId.set(wid, w)
			wallSpecs.push(w)
		}
	}
	checkHeldUp()
	checkMounts()
	const box = boxOf([...placed.values()].filter((P) => !P.spec.safety && P.spec !== table).flatMap((P) => P.shapes)) // (empty: ±Infinity, which leaves the stage as it is)
	let stage
	if (isObj(plan.stage) && ["x0", "x1", "y0", "y1"].every((k) => num(plan.stage[k]) !== null) && plan.stage.x1 > plan.stage.x0 && plan.stage.y1 > plan.stage.y0) {
		stage = Object.fromEntries(["x0", "x1", "y0", "y1"].map((k) => [k, num(plan.stage[k])]))
		if (!opts.keepStage) {
			stage.x0 = Math.min(stage.x0, r6(box.x0 - 0.02))
			stage.x1 = Math.max(stage.x1, r6(box.x1 + 0.02))
			stage.y0 = Math.min(stage.y0, r6(box.y0 - 0.02))
			stage.y1 = Math.max(stage.y1, r6(box.y1 + 0.3))
		}
	} else {
		const tx0 = T2.x - table.props.width / 2
		const tx1 = T2.x + table.props.width / 2
		const isDefault = Math.abs(T2.x - DEFAULT_TABLE.x) < 1e-9 && Math.abs(table.props.width - DEFAULT_TABLE.width) < 1e-9 && Math.abs(T2.y) < 1e-9
		stage = isDefault ? { ...DEFAULT_STAGE } : { x0: r6(tx0 - 0.00908), x1: r6(tx1 + 0.04092), y0: r6(T2.y - 0.15625), y1: r6(T2.y + 2.34375) }
		stage.x0 = Math.min(stage.x0, r6(box.x0 - 0.02))
		stage.x1 = Math.max(stage.x1, r6(box.x1 + 0.02))
		stage.y0 = Math.min(stage.y0, r6(box.y0 - 0.02))
		stage.y1 = Math.max(stage.y1, r6(box.y1 + 0.3))
	}

	// ---- 6. the scene, the goals, and web/sim's own check
	const items = []
	for (const s of specs) {
		const P = placed.get(s.id)
		if (!P) continue
		const it = { id: s.id, type: s.type, name: s.name, x: r6(P.x), y: r6(P.y), angle: Math.abs(P.angle) < 1e-9 ? 0 : P.angle, props: trimProps(s.type, s.props) }
		if (s.held) it.held = true
		if (s.fixed) it.fixed = true
		items.push(it)
	}
	const goals = [] // the scene's own goals: "in" goals with a container the engine checks
	const allGoals = [] // every usable goal of the plan, ids as solved: the other kinds (falls, hits, moves) are checked on each run by ./goals.js
	const names = Object.fromEntries([...byId.values()].map((s) => [s.id, s.name]))
	for (const g of Array.isArray(plan.goals) ? plan.goals : []) {
		if (!isObj(g)) continue
		const label = typeof g.label === "string" && g.label.trim() ? g.label.trim() : null
		const kind = goalKind(g)
		const mod = GOAL_KINDS.includes(kind) ? undefined : moduleGoal(kind)
		if (mod) {
			// (a physics module's goal: every field that names items mapped to the ids they got; in the scene's own goals too, so the summary under
			// the view reports it, and checked on each run by ./goals.js)
			const mapId = (v) => idMap.get(String(v)) ?? String(v)
			const out = { kind: mod.kind }
			let missing = false
			for (const [f, t0] of Object.entries(mod.fields ?? {})) {
				const t = String(t0).replace(/\?$/, "")
				const v = g[f]
				if (v === undefined || v === null) continue
				if (t === "item") out[f] = mapId(v)
				else if (t === "items" && Array.isArray(v)) out[f] = v.map(mapId)
				else out[f] = v
				for (const id of t === "item" ? [out[f]] : t === "items" ? out[f] ?? [] : []) if (!byId.has(id)) missing = true
			}
			if (missing || !goalItems(out).length) {
				say("warn", "goal_ref", `The goal “${label ?? kind}” names something that isn't in the scene: left out`)
				continue
			}
			// (the scene keeps the plan's own label or none: an unlabelled goal, as an edit carries one through, stays unlabelled, so the run's
			// summary says it in its own words from its fields, "does not rise 5 cm"; the AI's own list gets a label to say on the card)
			goals.push(label ? { ...out, label } : { ...out })
			out.label = label ?? goalLabel(out, names)
			allGoals.push(out)
			continue
		}
		if (kind !== "in") {
			const mapId = (v) => idMap.get(String(v)) ?? String(v)
			const its = goalItems(g).map(mapId)
			const target = g.target !== undefined && g.target !== null ? mapId(g.target) : null
			if (!its.length || its.some((id) => !byId.has(id)) || (kind === "hits" && (!target || !byId.has(target)))) {
				say("warn", "goal_ref", `The goal “${label ?? kind}” names something that isn't in the scene: left out`)
				continue
			}
			const out = { kind, ...(Array.isArray(g.items) && g.items.length ? { items: its } : { item: its[0] }) }
			if (kind === "hits") {
				out.target = target
				if (num(g.before_s) !== null) out.before_s = num(g.before_s)
			}
			if (kind === "moves") out.min_m = num(g.min_m) ?? 0.05
			out.label = label ?? goalLabel(out, names)
			allGoals.push(out)
			continue
		}
		const item = idMap.get(String(g.item)) ?? g.item
		const cont = idMap.get(String(g.container)) ?? g.container
		if (!byId.has(item) || !byId.has(cont)) {
			say("warn", "goal_ref", `The goal “${label ?? `${g.item} in ${g.container}`}” names something that isn't in the scene: left out`)
			continue
		}
		if (!CONTAINERS_CHECKED.has(byId.get(cont).type)) {
			// (a plastic cup or a glass jar: judged by its walls in each run (./goals.js wallsInside), never left out; the engine's own check
			// is for the four it knows, so it is kept out of the scene's goals)
			if (CONTAINERS_BY_WALLS.has(byId.get(cont).type)) {
				say("info", "goal_unchecked", `The goal “${label ?? ""}” is judged by ${byId.get(cont).name}'s own walls in the run (the engine's "in" check is for a box, cup, bucket or basket)`)
				const gw = { kind: "in", item, container: cont, label: label ?? `${byId.get(item).name} ends in the ${byId.get(cont).name.toLowerCase()}` }
				allGoals.push(gw)
				// (and in the scene's goals as the engine's "walls" kind, so the results under the view show it too: V8817 c12)
				goals.push({ ...gw, kind: "walls" })
				continue
			}
			say("warn", "goal_unchecked", `The goal “${label ?? ""}” needs ${byId.get(cont).name} to be a box, cup, bucket or basket (the ones the engine checks): left out`)
			continue
		}
		const gin = { kind: "in", item, container: cont, label: label ?? `${byId.get(item).name} ends in the ${byId.get(cont).name.toLowerCase()}` }
		goals.push(gin)
		allGoals.push({ ...gin })
	}
	const seconds = Math.min(20, Math.max(0.5, num(plan.seconds) ?? 4.5))
	const release = Math.min(20, Math.max(0, num(plan.release) ?? 0.5))
	const title = (typeof plan.title === "string" && plan.title.trim() ? plan.title.trim() : "AI scene").slice(0, 80)
	const scene = { version: 2, id: slug(title), name: title, seconds, release, stage, items, goals }
	// (the plan's settings, gravity, air, room temperature, time-lapse: the builder checks them; left out, the standard ones)
	if (isObj(plan.settings) && Object.keys(plan.settings).length) scene.settings = { ...plan.settings }

	let warnings = []
	try {
		warnings = layout(scene).warnings
	} catch (e) {
		say("error", "layout", `The scene couldn't be laid out: ${e.message}`)
	}
	for (const w of warnings) say("warn", "overlap", w.text, w.items?.[0])
	const errors = issues.filter((i) => i.level === "error")
	const ms = (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0
	return { ok: errors.length === 0, scene, issues, errors, warnings, placements, order, goals: allGoals, supports: supportSpecs.map((w) => ({ id: w.id, for: w.supports })), added: wallSpecs.map((w) => w.id).concat(supportSpecs.map((w) => w.id), table.auto ? [table.id] : []), ms: Math.round(ms * 10) / 10 }

	// ================================================================ placement helpers (closures over the solver's state)
	/** The x range an item may take on a support so all of it stays over the support (its middle when it is the wider of the two). */
	function keepOver(geo, angle, x, supportBox, spec, supName) {
		const b = boxOf(shapesAt(geo, 0, 0, angle))
		const lo = supportBox.x0 - b.x0
		const hi = supportBox.x1 - b.x1
		const nx = lo <= hi ? Math.min(hi, Math.max(lo, x)) : (supportBox.x0 + supportBox.x1) / 2 - (b.x0 + b.x1) / 2
		if (Math.abs(nx - x) > 0.0005) say("info", "kept_on", `${spec.name} was moved ${Math.abs(nx - x).toFixed(3)} m to stand fully on ${supName}`, spec.id)
		return nx
	}
	/** The slope of a support's top across [x0, x1] when it is one flat face there (degrees), else null. */
	function flatSlope(sshapes, x0, x1) {
		const n = 9
		const pts = []
		for (let i = 0; i < n; i++) {
			const x = x0 + ((x1 - x0) * i) / (n - 1)
			const y = topAt(sshapes, x)
			if (y === -Infinity) return null
			pts.push([x, y])
		}
		const mx = pts.reduce((a, q) => a + q[0], 0) / n
		const my = pts.reduce((a, q) => a + q[1], 0) / n
		let sxx = 0
		let sxy = 0
		for (const [x, y] of pts) {
			sxx += (x - mx) ** 2
			sxy += (x - mx) * (y - my)
		}
		if (sxx < 1e-12) return null
		const k = sxy / sxx
		for (const [x, y] of pts) if (Math.abs(my + k * (x - mx) - y) > 0.0005) return null
		return (Math.atan(k) * 180) / Math.PI
	}

	/** on (a support, or inside a container): x first, then the angle along the support, then down onto it. */
	function placeOn(s, geo, sup, inside, report) {
		const p = s.place
		// a launcher-like support carries it on its own part (its plate, its arm, its low end), in that part's tilted frame
		if (!inside && p.rel === undefined && sup !== "table") {
			const seat = seatOf(placed.get(sup))
			if (seat && placeOnSeat(s, geo, sup, seat, report)) return
		}
		const supItem = sup === "table" ? table.id : sup
		const S = placed.get(supItem)
		// the table's top counts as unbounded here: a layout that runs past its ends is shifted (or the table widened) as a whole afterwards
		// (a module's closed container, a vacuum jar or a wind tunnel, has a lid at its rim: what goes inside is set down under it, on its floor,
		// never on its lid)
		const lidAt = inside && supItem !== table.id ? containerInterior(byId.get(sup)?.type, byId.get(sup)?.props)?.rim : undefined
		const sshapes =
			supItem === table.id
				? [polyShape([[-1e3, S.box.y1 - 1], [1e3, S.box.y1 - 1], [1e3, S.box.y1], [-1e3, S.box.y1]], true)]
				: Number.isFinite(lidAt)
					? S.shapes.filter((q) => q.y0 < S.y + lidAt - 1e-6)
					: S.shapes
		let angle = p.angle ?? 0
		let x
		const pile = () => (inside ? [...placed.values()].filter((Q) => Q.spec.place?.inside === sup && Q.spec !== s).flatMap((Q) => Q.shapes) : [])
		const drop = (xx, aa) => {
			const sh = shapesAt(geo, xx, 0, aa)
			const L = liftItem(sh, [...sshapes, ...pile()])
			return L === -Infinity ? null : L
		}
		// the range it may stand in: on an item, all of it over the item (inside a container: between its walls)
		let range = null
		if (supItem !== table.id) {
			range = { ...S.box }
			if (inside) {
				const C = byId.get(sup)
				const w = num(C.props.width) ?? schemaOf(C.type).defaults.width ?? 0.2
				const t = num(C.props.thickness) ?? schemaOf(C.type).defaults.thickness ?? 0.012
				// (a module's container says where its inside is: a tank's walls, a beaker's; web/sim/plugins.js place.interior)
				const inner = containerInterior(C.type, C.props)
				range = inner ? { x0: S.x + inner.x0, x1: S.x + inner.x1 } : { x0: S.x - w / 2 + t, x1: S.x + w / 2 - t }
				const b = boxOf(shapesAt(geo, 0, 0, angle))
				if (b.x1 - b.x0 > range.x1 - range.x0 + 1e-9) say("error", "too_big", `${s.name} (${((b.x1 - b.x0) * 100).toFixed(1)} cm wide) is too big to go inside ${C.name} (${((range.x1 - range.x0) * 100).toFixed(1)} cm between its walls)`, s.id)
			}
		}
		const where = inside ? `the inside of ${byId.get(sup).name}` : sup === "table" ? "the table" : byId.get(sup).name
		if (p.rel !== undefined) x = null // (set below by the relation)
		else if (p.x !== null) x = p.x
		else if (range) x = (range.x0 + range.x1) / 2
		else x = freeSpot(s, geo, angle)
		const align = () => {
			if (p.angle !== null || isRound(geo)) return
			// the support's face under the middle 70 % of the item (its ends may hang over an edge): one flat face there sets the angle
			const b = boxOf(shapesAt(geo, x, 0, angle))
			const m = (b.x1 - b.x0) * 0.15
			const k = flatSlope(sshapes, b.x0 + m, b.x1 - m)
			if (k !== null && Math.abs(k - angle) > 1e-9) {
				angle = k
				report.alignedTo = r6(k)
			}
		}
		if (x !== null) {
			align()
			if (range) {
				const kx = keepOver(geo, angle, x, range, s, where)
				if (kx !== x) {
					x = kx
					align()
				}
			}
		} else {
			x = relateX(s, geo, () => angle, (xx) => drop(xx, angle), p, report)
			const a0 = angle
			align()
			if (angle !== a0) x = relateX(s, geo, () => angle, (xx) => drop(xx, angle), p, report) // (turned to lie along its support: the relation again)
			if (range) x = keepOver(geo, angle, x, range, s, where)
		}
		let y = drop(x, angle)
		if (y === null) {
			// nothing of the support under it there: stand it over the middle of the support
			x = (S.box.x0 + S.box.x1) / 2
			say("warn", "off_support", `${s.name} wasn't over ${sup === "table" ? "the table" : byId.get(sup).name}: it was put on its middle`, s.id)
			y = drop(x, angle) ?? S.box.y1
		}
		put(s, geo, x, y, angle)
		report.support = sup
		report.angle = r6(angle)
		if (inside) {
			report.inside = sup
			const C = placed.get(sup)
			const inner = containerInterior(byId.get(sup).type, byId.get(sup).props)
			const rim = C.y + (inner ? inner.rim : (num(byId.get(sup).props.wall) ?? schemaOf(byId.get(sup).type).defaults.wall ?? 0.1))
			const bottom = placed.get(s.id).box.y0
			if (bottom > rim - 0.002) say("error", "too_big", `${s.name} doesn't fit inside ${byId.get(sup).name}: it rests on the rim`, s.id)
			// (a thing that floats on the container's liquid starts at its own floating height, not on the floor: web/sim/plugins.js place.float)
			const fy = floatHeight({ type: s.type, props: s.props, x, angle }, { type: byId.get(sup).type, props: byId.get(sup).props, x: C.x, y: C.y })
			if (fy !== null && fy > y + 1e-4) {
				y = fy
				put(s, geo, x, y, angle)
				report.floats = r6(y)
			}
		}
		clearOverlaps(s, "support", report, { drop: (xx) => drop(xx, angle), range, angle })
	}

	/**
	 * On a seat (a launcher's plate, a catapult's arm, a seesaw's plank): worked out in the seat's own frame (its top face along x', its normal
	 * up), so a tilted launcher carries the thing on its plate between its guides, not on the highest corner of its outline. Without x: a level
	 * plate (or one whose load is held until the release) carries it in its middle; a tilted seat at its lower end, resting against the stop
	 * there (a guide, a lip), where it would roll to anyway. With x: the anchor's x is kept, the item set down along the seat's normal.
	 * -> true when placed (false: no part of the seat under it; then it is placed as on any support).
	 */
	function placeOnSeat(s, geo, sup, seat, report) {
		const p = s.place
		const S = placed.get(sup)
		const { phi, ox, oy, half } = seat
		const c = Math.cos(phi)
		const n = Math.sin(phi)
		const toSeat = (q) => moveShape(moveShape(q, -ox, -oy, 0), 0, 0, -phi)
		const angle = p.angle ?? (isRound(geo) ? 0 : r6((phi * 180) / Math.PI))
		const local = shapesAt(geo, 0, 0, angle).map((q) => moveShape(q, 0, 0, -phi)) // its shapes in the seat's frame, anchor at the origin
		const supS = S.shapes.map(toSeat)
		const stops = seat.stops.map(toSeat)
		const b = boxOf(local)
		const lo = -half - b.x0
		const hi = half - b.x1
		const clampU = (u) => (lo <= hi ? Math.min(hi, Math.max(lo, u)) : -(b.x0 + b.x1) / 2)
		const at = (u, v) => local.map((q) => moveShape(q, u, v, 0))
		const drop = (u) => {
			const L = liftItem(at(u, 0), supS)
			return L === -Infinity ? null : L
		}
		const world = (u, v) => [ox + u * c - v * n, oy + u * n + v * c]
		let u
		if (p.x !== null) {
			// the anchor's x as asked: set down along the seat's normal (a few steps: the height on the seat can change along it)
			u = clampU((p.x - ox) / c)
			for (let k = 0; k < 12; k++) {
				const v = drop(u)
				if (v === null) break
				const err = p.x - world(u, v)[0]
				if (Math.abs(err) < 1e-10) break
				const nu = clampU(u + err / c)
				if (Math.abs(nu - u) < 1e-12) break
				u = nu
			}
		} else {
			const level = Math.abs(phi) < (3 * Math.PI) / 180
			const lowSide = n < 0 ? 1 : -1 // the seat's lower end: +1 its right end
			const side = (q) => Math.sign((q.x0 + q.x1) / 2) || 1
			let stop = null
			let endSide = 0
			if (seat.centre && (level || s.held)) u = -(b.x0 + b.x1) / 2
			else if (level) {
				if (stops.length === 1) stop = stops[0]
				else u = -(b.x0 + b.x1) / 2
			} else {
				stop = stops.find((q) => side(q) === lowSide) ?? null
				if (!stop) endSide = lowSide
			}
			if (stop) {
				// against the stop at the resting distance (it slides until the outlines touch: a ball against a lip touches its top corner)
				const sd = side(stop)
				u = sd > 0 ? stop.x0 - b.x1 - 0.001 : stop.x1 - b.x0 + 0.001
				for (let k = 0; k < 40; k++) {
					const v = drop(u)
					if (v === null) break
					const sh = at(u, v)
					const g = sd > 0 ? slackItem(sh, [stop]) : slackItem([stop], sh)
					if (!Number.isFinite(g) || Math.abs(g) < 1e-9) break
					u += sd * g
				}
				u = clampU(u)
			} else if (endSide) u = clampU(endSide > 0 ? hi - 0.01 : lo + 0.01)
		}
		const v = drop(u)
		if (v === null) return false
		const [X, Y] = world(u, v)
		if (p.x !== null && Math.abs(X - p.x) > 0.0005) say("info", "kept_on", `${s.name} was moved ${Math.abs(X - p.x).toFixed(3)} m to stay on ${S.spec.name}'s ${seat.label}`, s.id)
		put(s, geo, X, Y, angle)
		report.support = sup
		report.seat = seat.part
		report.angle = r6(angle)
		clearOverlaps(s, "seat", report)
		return true
	}

	/** In the air: at y_m (its anchor) or bottom_m (its lowest point above the table top); x as given or by a relation. */
	function placeAir(s, geo, report) {
		const p = s.place
		const angle = p.angle ?? 0
		const b0 = boxOf(shapesAt(geo, 0, 0, angle))
		const yOf = (xx) => {
			if (p.y !== null) return tableTop() + p.y
			if (p.bottom !== null) return tableTop() + p.bottom - b0.y0
			// not given: 25 cm above whatever is under it
			const b = boxOf(shapesAt(geo, xx, 0, angle))
			let top = tableTop()
			for (const Q of placed.values()) for (const q of Q.shapes) {
				if (q.x1 < b.x0 || q.x0 > b.x1) continue
				top = Math.max(top, q.y1)
			}
			return top + 0.25 - b0.y0
		}
		if (p.y === null && p.bottom === null) say("info", "air_height", `${s.name} is in the air with no height given: it was put 25 cm above what is under it`, s.id)
		let x = p.x ?? (p.rel === undefined ? freeSpot(s, geo, angle) : 0)
		if (p.rel !== undefined) x = relateX(s, geo, () => angle, (xx) => yOf(xx), p, report)
		put(s, geo, x, yOf(x), angle)
		report.support = "air"
		report.angle = r6(angle)
		if (!p.keep) clearOverlaps(s, "air", report)
	}

	/** x from left_of / right_of: the boxes' gap is gap_m; "touching" (or a gap under 2 mm) slides until the outlines touch at the resting distance. */
	function relateX(s, geo, angleOf, yAt, p, report) {
		const R = placed.get(p.rel)
		const gap = p.gap ?? (p.touching ? 0 : 0.02)
		const touching = p.touching || gap < 0.002
		if (p.gap === null && !p.touching) say("info", "default_gap", `${s.name}: no gap given to ${R.spec.name}, 2 cm used`, s.id)
		const left = p.side === "left"
		const b0 = boxOf(shapesAt(geo, 0, 0, angleOf()))
		let x = left ? R.box.x0 - gap - b0.x1 : R.box.x1 + gap - b0.x0
		let err = Infinity
		for (let i = 0; i < 40; i++) {
			const y = yAt(x) ?? 0
			const sh = shapesAt(geo, x, y, angleOf())
			const b = boxOf(sh)
			let g
			if (touching) {
				g = left ? slackItem(sh, R.shapes) : slackItem(R.shapes, sh)
				if (g === Infinity) g = left ? R.box.x0 - b.x1 : b.x0 - R.box.x1 // (no height in common: by their boxes)
			} else g = left ? R.box.x0 - b.x1 : b.x0 - R.box.x1
			err = g - (touching ? 0 : gap)
			if (Math.abs(err) < 1e-8) break
			x += left ? err : -err
		}
		if (Math.abs(err) > 1e-5) say("warn", "relation", `${s.name} couldn't be put exactly ${touching ? "against" : `${gap} m from`} ${R.spec.name} (off by ${(Math.abs(err) * 1000).toFixed(1)} mm)`, s.id)
		report.relation = { side: p.side, of: p.rel, gap: touching ? "touching" : gap }
		return x
	}

	/** A free spot on the table for an item with no x: right of everything already on the table (or its middle when it is empty). */
	function freeSpot(s, geo, angle) {
		const b = boxOf(shapesAt(geo, 0, 0, angle))
		const others = [...placed.values()].filter((Q) => Q.spec !== table && !Q.spec.safety)
		if (!others.length) {
			say("info", "default_x", `${s.name} had no position: it was put in the middle of the table`, s.id)
			return placed.get(table.id).x
		}
		const right = Math.max(...others.map((Q) => Q.box.x1))
		say("info", "default_x", `${s.name} had no position: it was put to the right of the rest`, s.id)
		return right + 0.08 - b.x0
	}

	/** A long item resting on two supports. -> {geo, x, y, angle, contacts} or null (then it is placed as an ordinary item) */
	function solveLean(s, geo) {
		const L = s.place.lean
		const ends = []
		for (const e of [L.from, L.to]) {
			if (e.on === "air") {
				if (e.x === null || e.y === null) {
					say("error", "lean_air", `${s.name} has an end held in the air, but its x and height (y) aren't both given`, s.id)
					return null
				}
				ends.push({ air: true, ref: "air", S: null, x: e.x, top: tableTop() + e.y })
				continue
			}
			const ref = e.on === "table" ? table.id : e.on
			const S = placed.get(ref)
			let x = e.x
			if (x === null) {
				if (ref === table.id) {
					say("error", "lean_x", `${s.name} leans on the table, but where on the table (x) isn't given`, s.id)
					return null
				}
				x = S.x
			}
			const top = topAt(ref === table.id ? [polyShape([[-1e3, S.box.y1 - 1], [1e3, S.box.y1 - 1], [1e3, S.box.y1], [-1e3, S.box.y1]], true)] : S.shapes, x)
			if (top === -Infinity) {
				say("error", "lean_off", `${s.name} is meant to rest on ${S.spec.name} at x = ${x}, but nothing of it is there`, s.id)
				return null
			}
			ends.push({ air: false, ref, S, x, top })
		}
		if (Math.abs(ends[0].x - ends[1].x) < 0.01) {
			say("error", "lean_span", `${s.name}'s two ends are at the same x: it can't lean between them`, s.id)
			return null
		}
		// the low end is anchored; the item's underside then rests on the highest point of the supports between (a box's corner, say)
		const [lo, hi] = ends[0].top <= ends[1].top ? [ends[0], ends[1]] : [ends[1], ends[0]]
		const dir = Math.sign(hi.x - lo.x) // +1: rises to the right
		const fixedItem = s.fixed || !TYPES[s.type].dynamic
		const g = (q) => (fixedItem && q.st ? 0 : Math.max(0, SKIN + q.sk - SLOP)) // (the item's own skin: a slab or polygon)
		const gapAt = (end) => {
			if (end.air) return 0
			const under = end.S.shapes.reduce((m, q) => {
				const v = vspan(q, end.x)
				return v && (!m || v[1] > m.v[1]) ? { q, v } : m
			}, null)
			return under ? g(under.q) : g({ st: true, sk: SKIN })
		}
		const ax = lo.x
		const ay = lo.top + gapAt(lo)
		let slope = (hi.top + gapAt(hi) - ay) / (hi.x - ax)
		const asked = slope
		const xa = Math.min(ax, hi.x)
		const xb = Math.max(ax, hi.x)
		for (const S of new Set([lo.S, hi.S].filter(Boolean))) {
			if (S.spec === table) continue // (the table top is flat: the anchor is on it)
			for (const q of S.shapes) {
				const gap = g(q)
				if (q.x1 < xa - EPS || q.x0 > xb + EPS) continue
				const cand = []
				if (q.k === "poly") for (const [px, py] of q.p) cand.push([px, py])
				else for (let k = 0; k <= 32; k++) cand.push([q.cx + q.r * Math.cos((Math.PI * k) / 32), q.cy + q.r * Math.sin((Math.PI * k) / 32)])
				for (const [px, py] of cand) {
					if (px < xa - EPS || px > xb + EPS || Math.abs(px - ax) < 1e-6) continue
					if ((px - ax) * dir <= 0) continue
					const k = (py + gap - ay) / (px - ax)
					if (dir > 0 ? k > slope : k < slope) slope = k
				}
			}
		}
		if (hi.air && Math.abs(slope - asked) > 1e-9) say("info", "lean_raised", `${s.name}'s raised end had to go higher than asked to clear what it rests on`, s.id)
		const angle = (Math.atan(slope) * 180) / Math.PI
		// the span sets a plank-like item's length (its underside from the low end's corner to the high end's x), unless the plan gave one
		const span = Math.abs(hi.x - ax) / Math.cos(Math.atan(slope))
		const sch = schemaOf(s.type)
		const lp = LONG_PROPS.find((k) => sch.byKey.has(k) && sch.byKey.get(k).kind === "number")
		let g2 = geo
		let along = 0 // how far the low end sits back from the anchor along the item (a given length longer than a level span is centred)
		if (lp) {
			const spec = sch.byKey.get(lp)
			const b = boxOf(shapesAt(geo, 0, 0, 0))
			const extra = Math.max(0, b.x1 - b.x0 - (num(s.props[lp]) ?? sch.defaults[lp])) // (parts beyond the prop's length: rollers, lips)
			const need = r6(span - extra)
			const had = num(s.raw.props?.[lp])
			let want = had !== null && had >= need - 0.002 ? had : need
			if (had !== null && had < need - 0.002) say("info", "lean_length", `${s.name} was lengthened from ${had} to ${need.toFixed(3)} m to reach both of its supports`, s.id)
			if (want < spec.min || want > spec.max) {
				say("warn", "lean_length", `${s.name} would need to be ${want.toFixed(3)} m long to span both supports (it can be ${spec.min} to ${spec.max} m)`, s.id)
				want = Math.min(spec.max, Math.max(spec.min, want))
			}
			if (had !== null && want > need + 0.002 && Math.abs(angle) < 1) along = (want - need) / 2
			s.props = { ...s.props, [lp]: want }
			// resting on its supports, legs would stand through them; with an end held in the air they are what holds it up
			if (sch.byKey.has("legs") && s.raw.props?.legs === undefined && !ends.some((e) => e.air)) s.props.legs = false
			g2 = geometryOf(s)
		}
		// put the item's underside on the line through the anchor, its low end at the anchor
		const th = (angle * Math.PI) / 180
		const u = [Math.cos(th) * dir, Math.sin(th) * dir] // along the item, from the low end up
		const nrm = [-Math.sin(th), Math.cos(th)] // its up side
		const sh = shapesAt(g2, 0, 0, angle)
		let m = Infinity
		let k = Infinity
		for (const q of sh) {
			if (q.k === "circle") {
				m = Math.min(m, q.cx * nrm[0] + q.cy * nrm[1] - q.r)
				k = Math.min(k, q.cx * u[0] + q.cy * u[1] - q.r)
			} else
				for (const [px, py] of q.p) {
					m = Math.min(m, px * nrm[0] + py * nrm[1])
					k = Math.min(k, px * u[0] + py * u[1])
				}
		}
		const a = ax * nrm[0] + ay * nrm[1] - m
		const c = ax * u[0] + ay * u[1] - k - along
		const x = a * nrm[0] + c * u[0]
		const y = a * nrm[1] + c * u[1]
		return { geo: g2, x, y, angle, contacts: { low: { on: lo.ref, x: r6(ax) }, high: { on: hi.ref, x: r6(hi.x) } } }
	}

	/**
	 * Static things (and fixed ones) never fall in the engine, so nothing stops a plan from leaving a cup, a funnel or a legless ramp in mid-air,
	 * and the picture then shows it floating. Each must stand on something (within HOLD_GAP under it), on its own legs, or be a thing the 3D view
	 * holds up by itself (a hung box's cords, a stand, a post for its hinge). A long one (a plank, a beam) held up only to one side of its middle
	 * has an end in the air.
	 */
	/** Is this placed thing one that must be held up (static or fixed, not the table or a safety wall, not held up by the view itself)? */
	function mustBeHeld(P) {
		const s = P.spec
		// (a module's view may hold it up itself in this scene: a fan raised to a sailboat's sail on a lab stand, web/sim/plugins.js place.held)
		return !(s === table || s.safety || (TYPES[s.type].dynamic && !s.fixed) || P.geo.mounted || heldByModule(s.type, specs.map((q) => q.type)))
	}
	/** Where along its underside something holds P up (its own legs, or the top of another thing within HOLD_GAP): the x positions, or [] when it floats. */
	function heldXs(P) {
		const all = [...placed.values()]
		const b = P.box
		const others = all.filter((Q) => Q !== P && !Q.spec.safety && Q.box.x1 > b.x0 - 1e-6 && Q.box.x0 < b.x1 + 1e-6 && Q.box.y1 >= b.y0 - HOLD_GAP && Q.box.y0 < b.y1)
		// look under it at evenly spaced x and at every corner (a corner is where a sloped thing rests on another)
		const xs = new Set()
		for (let i = 0; i <= 40; i++) xs.add(b.x0 + ((b.x1 - b.x0) * i) / 40)
		for (const Q of [P, ...others])
			for (const q of Q.shapes) {
				if (q.k === "circle") xs.add(q.cx)
				else for (const [x] of q.p) if (x > b.x0 && x < b.x1) xs.add(x)
			}
		const held = []
		for (const x of xs) {
			const bottom = bottomAt(P.shapes, x)
			if (bottom === Infinity) continue
			let ok = P.legs.some((L) => x >= L.shape.x0 - 0.002 && x <= L.shape.x1 + 0.002)
			for (const Q of others) {
				if (ok) break
				for (const q of Q.shapes) {
					const v = vspan(q, x)
					// (under it: its top within HOLD_GAP below the item's bottom, or at most 1 cm into it; something that passes through the item, a
					// ramp's end through a funnel's wall, does not hold it up)
					if (v && v[1] >= bottom - HOLD_GAP && v[1] <= bottom + 0.01 && v[0] < bottom) {
						ok = true
						break
					}
				}
			}
			if (ok) held.push(x)
		}
		return held
	}
	/** Held only to one side of its middle (a long thing: an end in the air)? -> "left" | "right" | null */
	function hangingEnd(P, held) {
		if (!held.length || !schemaOf(P.spec.type).byKey.has("legs")) return null
		const mid = (P.box.x0 + P.box.x1) / 2
		const h0 = Math.min(...held)
		const h1 = Math.max(...held)
		return mid < h0 - 0.01 ? "left" : mid > h1 + 0.01 ? "right" : null
	}
	/** These are warnings: the critic reads them (as placing notes) and the report shows them. */
	function checkHeldUp() {
		const top = tableTop()
		for (const P of [...placed.values()]) {
			if (!mustBeHeld(P)) continue
			// (no outline to hold up: a thing drawn only by its module, a wire between two terminals, has no finite box; "floats Infinity cm" was wrong)
			if (!P.shapes?.length || !Number.isFinite(P.box?.y0) || !Number.isFinite(P.box?.y1)) continue
			const s = P.spec
			const held = heldXs(P)
			const hint = schemaOf(s.type).byKey.has("legs")
				? "give it legs, or rest its ends on something"
				: schemaOf(s.type).byKey.has("hung")
					? "hang it from cords (hung), or stand it on something"
					: "stand it on something: a fixed block or brick stack, a box, books, or a shelf plank with legs"
			if (!held.length) say("warn", "floats", `Nothing holds ${s.name} up: it floats ${((P.box.y0 - top) * 100).toFixed(0)} cm above the table with nothing under it (${hint})`, s.id)
			else {
				const end = hangingEnd(P, held)
				if (end) say("warn", "floats_end", `${s.name}'s ${end} end hangs in the air with nothing under it (${hint})`, s.id)
			}
		}
	}
	/**
	 * The 3D view's own supports that stand up from the tabletop: a retort stand's pole under a static part it mounts on a post (a peg, the block a
	 * pendulum or a hinge hangs from) when nothing stands under that part, and a post with a pull pin under each held part until the release.
	 * One that comes up through something raised off the table and out above it is drawn going through it (a pole through a counter top, a
	 * peg's pole through a shelf): said, for the critic, which moves one clear (warn "stand_through").
	 */
	function checkMounts() {
		const top = tableTop()
		const T = placed.get(table.id)
		const statics = [] // the static parts of the items (not the table, not the safety walls)
		const all = [...placed.values()].filter((Q) => Q.spec !== table && !Q.spec.safety)
		for (const Q of all) {
			const parts = geoAt(Q.geo, Q.angle).parts
			Q.shapes.forEach((q, j) => parts[j]?.st && statics.push({ Q, j, q }))
		}
		const said = new Set()
		/** A pole at x from the table up to y1 (r: its radius): what raised static thing does it come up through, and out more than `out` above? (a
		 *  held ball's post that ends a few cm over the ramp end it waits above reads as its stand behind the ramp; one coming 15 cm and more out
		 *  of a counter top, or a stand's steel pole out of a shelf, reads as going through it) */
		const pole = (P, x, y1, r, what, why, out = 0.03) => {
			if (x - 0.055 < T.box.x0 + 0.005 || x + 0.055 > T.box.x1 - 0.005) return // (off the tabletop's end the view holds it from the wall instead)
			for (const { Q, q } of statics) {
				if (Q === P || x + r < q.x0 || x - r > q.x1) continue
				const xs = [x - r, x, x + r].filter((v) => v >= q.x0 && v <= q.x1)
				const lo = Math.min(...xs.map((v) => bottomAt([q], v)))
				const hi = Math.max(...xs.map((v) => topAt([q], v)))
				// standing on the table, the pole only shows behind it; ending at it (a post just under a held ball resting there), it holds it up
				if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo < top + 0.03 || hi > y1 - out) continue
				const key = `${what}|${Q.spec.id}`
				if (said.has(key)) continue
				said.add(key)
				say("warn", "stand_through", `${what} goes up through ${Q.spec.name} (${why})`, P.spec.id)
			}
		}
		/** Is anything static (not the table) under this part, within 3 cm of its underside: then the view stands no pole under it. */
		const restsOn = (P, i, b) => {
			for (const { Q, j, q } of statics) {
				if (Q === P && (j === i || (P.shapes[i].k === "circle" && P.shapes[j]?.k === "circle"))) continue
				if (q.x1 < b.x0 - 0.005 || q.x0 > b.x1 + 0.005) continue
				if (q.y1 >= b.y0 - 0.03 && q.y0 <= b.y1) return true
			}
			return false
		}
		for (const P of all) {
			const geo = geoAt(P.geo, P.angle)
			geo.parts.forEach((pt, i) => {
				if (pt.mount !== "post") return
				const b = P.shapes[i]
				if (b.y0 <= top + 0.03 || b.y0 - top > 1.3 || restsOn(P, i, b)) return // (on the table; held from the wall when this high up)
				const xs = b.x1 - b.x0 > 0.26 ? [b.x0 + 0.05, b.x1 - 0.05] : [(b.x0 + b.x1) / 2]
				for (const x of xs) pole(P, x, b.y1 + 0.012, 0.0065, `The pole of the stand that holds ${P.spec.name} up`, "the view stands it on the table; stand the thing on what is under it instead, or move one of them clear")
			})
			if (!P.spec.held) continue
			for (const i of heldParts(geo)) {
				const b = P.shapes[i]
				if (!b) continue
				const cx = b.k === "circle" ? b.cx : b.p.reduce((s, q) => s + q[0], 0) / b.p.length
				pole(P, cx, b.y0 + 0.026, 0.012, `The post that holds ${P.spec.name} until the release`, "the view stands it on the table; move one of them clear, or let it go free from the start", 0.15)
			}
		}
	}
	/**
	 * Give each static thing left floating something to stand on, so nothing hangs in mid-air in the picture: first its own means (a plank's
	 * legs switched back on, a box's cords), else a fixed wooden stand from what is under it (the table, or a static thing) up to its underside:
	 * one block under the flat of its bottom, or two posts under the outer ends of a thing that is open below (a funnel's outlet stays clear).
	 * A stand that would go through something (a ball resting below, a ramp's leg) is not added: the "floats" warning stays for the critic.
	 * Things pinned to an exact pose of an existing scene (keep: a hand-made scene being edited) are left as they are. -> the stands' specs
	 */
	function addSupports() {
		const out = []
		for (const P0 of [...placed.values()]) {
			if (!mustBeHeld(P0) || P0.spec.place?.keep || P0.spec.supports) continue
			let P = P0
			const s = P.spec
			let held = heldXs(P)
			if (held.length && !hangingEnd(P, held)) continue
			const sch = schemaOf(s.type)
			// its own legs (a plank, a beam, a conveyor in the air) or cords (a box): what the catalog gives it to hold itself up
			for (const [k, v, words] of [["legs", true, "its legs were put back on"], ["hung", true, "it was hung from its cords"]]) {
				if (!sch.byKey.has(k) || s.props[k] === v) continue
				const was = s.props[k]
				s.props = { ...s.props, [k]: v }
				let geo
				try {
					geo = itemGeometry(s.type, s.props, s.fixed)
				} catch {
					s.props = { ...s.props, [k]: was }
					continue
				}
				const Q = put(s, geo, P.x, P.y, P.angle)
				const h2 = heldXs(Q)
				if (Q.geo.mounted || (h2.length > held.length && !hangingEnd(Q, h2))) {
					say("info", "support_added", `Nothing held ${s.name} up in mid-air, so ${words}`, s.id)
					P = Q
					held = h2
					break
				}
				s.props = { ...s.props, [k]: was }
				P = put(s, P0.geo, P0.x, P0.y, P0.angle)
			}
			if (held.length || P.geo.mounted) continue
			const stands = standsUnder(P)
			if (!stands) continue
			for (const st of stands) {
				put(st.spec, st.geo, st.x, st.y, 0)
				specs.push(st.spec)
				byId.set(st.spec.id, st.spec)
				out.push(st.spec)
			}
			const h = Math.max(...stands.map((st) => st.h))
			say("info", "support_added", `Nothing held ${s.name} up in mid-air, so ${stands.length === 1 ? "a wooden stand" : `${stands.length} wooden posts`} ${fmtCm(h)} tall ${stands.length === 1 ? "was" : "were"} put under it`, s.id)
		}
		return out
	}
	/** Fixed wooden blocks from what is under P up to its underside (see addSupports), or null when one would go through something. */
	function standsUnder(P) {
		const s = P.spec
		const b = P.box
		const N = 60
		const xs = Array.from({ length: N + 1 }, (_, i) => b.x0 + ((b.x1 - b.x0) * i) / N)
		const bottoms = xs.map((x) => bottomAt(P.shapes, x))
		const low = Math.min(...bottoms)
		if (low === Infinity) return null
		const depth = Math.min(0.3, Math.max(0.03, P.geo.depth || 0.1))
		// the spans to stand posts in: open below (a funnel) at its outer ends; otherwise under the flat of its bottom (within 3 mm of its lowest point)
		const spans = []
		if (OPEN_BELOW.has(s.type)) {
			const w = Math.min(0.03, Math.max(0.012, (b.x1 - b.x0) * 0.08))
			spans.push([b.x0 + 0.004, b.x0 + 0.004 + w], [b.x1 - 0.004 - w, b.x1 - 0.004])
		} else {
			let i0 = bottoms.findIndex((v) => v <= low + 0.003)
			let i1 = bottoms.length - 1 - [...bottoms].reverse().findIndex((v) => v <= low + 0.003)
			let a = xs[i0]
			let c = xs[i1]
			if (c - a > 0.6) ((a = (a + c) / 2 - 0.3), (c = a + 0.6))
			if (c - a < 0.02) ((a = (a + c) / 2 - 0.01), (c = a + 0.02))
			spans.push([a, c])
		}
		const others = [...placed.values()].filter((Q) => Q !== P && !Q.spec.safety)
		const made = []
		let k = 0
		for (const [a0, c0] of spans) {
			let done = null
			// as wide as the span, else narrower, centred
			for (const shrink of [1, 0.6, 0.35]) {
				const w = Math.max(0.012, (c0 - a0) * shrink)
				const a = (a0 + c0) / 2 - w / 2
				const c = a + w
				let underside = Infinity
				for (let i = 0; i <= 12; i++) underside = Math.min(underside, bottomAt(P.shapes, a + ((c - a) * i) / 12))
				if (underside === Infinity) continue
				// what it would stand on: the table, or the top of a static thing under it
				let floor = tableTop()
				for (const Q of others) {
					if (Q.spec !== table && TYPES[Q.spec.type].dynamic && !Q.spec.fixed) continue
					for (const q of Q.shapes) for (let i = 0; i <= 6; i++) {
						const v = vspan(q, a + ((c - a) * i) / 6)
						if (v && v[1] <= underside + 1e-6) floor = Math.max(floor, v[1])
					}
				}
				const h = underside - floor
				if (h < HOLD_GAP) break
				if (h > 1.5) return null
				const props = { width: r6(w), height: r6(h), depth: r6(depth) }
				let geo
				try {
					geo = itemGeometry("wooden-block", props, true)
				} catch {
					return null
				}
				const gb = boxOf(shapesAt(geo, 0, 0, 0))
				const x = (a + c) / 2 - (gb.x0 + gb.x1) / 2
				const y = floor - gb.y0
				const sh = shapesAt(geo, x, y, 0)
				const blocked = others.some((Q) => depthItem(sh, Q.shapes) > OVERLAP_TOL || Q.legs.some((L) => depthItem(sh, [L.shape]) > OVERLAP_TOL)) || depthItem(sh, P.shapes) > OVERLAP_TOL
				if (blocked) continue
				const side = spans.length > 1 ? (k === 0 ? "left" : "right") : ""
				const spec = { raw: {}, id: cleanId(`${s.id}-stand${side ? `-${side}` : ""}`, used, "wooden-block"), type: "wooden-block", props, name: `Stand under ${s.name}${side ? ` (${side})` : ""}`, place: readPlace({ on: "table", x }, idMap), held: false, fixed: true, supports: s.id }
				done = { spec, geo, x, y, h }
				break
			}
			if (!done) return null
			made.push(done)
			k++
		}
		return made
	}

	/** Clear overlaps with what is already placed by the smallest move: sideways along the support (re-resting it), up for things in the air. */
	function clearOverlaps(s, mode, report, ctx = {}) {
		const P0 = placed.get(s.id)
		const own = new Set([s.id])
		const p = s.place
		const exempt = new Set()
		if (p.on && p.on !== "air") exempt.add(p.on === "table" ? table.id : p.on)
		if (p.inside) exempt.add(p.inside)
		if (p.lean) for (const e of [p.lean.from, p.lean.to]) exempt.add(e.on === "table" ? table.id : e.on)
		if (p.rel !== undefined && (p.touching || (p.gap ?? 1) < 0.002)) exempt.add(p.rel)
		const blockersAt = (shapes, depthOk) => {
			const out = []
			for (const Q of placed.values()) {
				if (own.has(Q.spec.id)) continue
				const d = exempt.has(Q.spec.id) ? 0 : depthItem(shapes, Q.shapes)
				if (d > OVERLAP_TOL) out.push({ Q, shapes: Q.shapes })
				// a plank's legs, where this item is deep enough (front to back) to meet them
				if (Q.legs.length && P0.geo.depth > 0) for (const L of Q.legs) if (P0.geo.depth >= 0.75 * L.depth - 0.016 && depthItem(shapes, [L.shape]) > OVERLAP_TOL) out.push({ Q, shapes: [L.shape], leg: true })
				// and this item's own legs through what is there
				if (depthOk && P0.legs.length) for (const L of P0.legs) if (Q.geo.depth >= 0.75 * L.depth - 0.016 && !exempt.has(Q.spec.id) && depthItem([L.shape], Q.shapes) > OVERLAP_TOL) out.push({ Q, shapes: Q.shapes, mine: true })
			}
			return out
		}
		const first = blockersAt(P0.shapes, true)
		if (!first.length) return
		const names = [...new Set(first.map((b) => b.Q.spec.name))].join(", ")
		if (mode === "lean" || mode === "seat" || first.every((b) => b.mine)) {
			say("warn", "overlap", `${s.name} goes through ${names} where it was asked to be`, s.id)
			return
		}
		if (mode === "air") {
			// A leg stands on the floor: going up never clears it, so a leg in the way is said, never "fixed" by raising (a funnel raised 19 cm
			// over a ramp's leg lands in the ramp's end). An item given its height (y_m / bottom_m) stays exactly there: only a hair's overlap
			// with a body (up to AIR_NUDGE) is cleared by lifting it; more is said and left for the critic.
			const exact = p.y !== null || p.bottom !== null
			const legNames = [...new Set(first.filter((b) => b.leg).map((b) => b.Q.spec.name))]
			for (const nm of legNames) say("warn", "leg_through", `${nm}'s leg goes through ${s.name}`, s.id)
			if (!first.some((b) => !b.leg && !b.mine)) return
			const bodies = (sh) => blockersAt(sh).filter((b) => !b.leg && !b.mine)
			let y = P0.y
			for (let i = 0; i < 12; i++) {
				const sh = shapesAt(P0.geo, P0.x, y, P0.angle)
				const bl = bodies(sh)
				if (!bl.length) break
				let up = 0
				for (const b of bl) up = Math.max(up, liftItem(sh, b.shapes))
				y += Math.max(up, 0.001) + (exact ? 0.001 : ROOM_GAP)
			}
			const bodyNames = [...new Set(first.filter((b) => !b.leg && !b.mine).map((b) => b.Q.spec.name))].join(", ")
			// (a pitcher a hand holds over a bowl is raised however far it takes: module place.hover)
			if (exact && y - P0.y > AIR_NUDGE && !hoversByModule(s.type)) {
				say("warn", "overlap", `${s.name} starts inside ${bodyNames} at the height it was asked to be (clearing it would take ${((y - P0.y) * 100).toFixed(1)} cm more height)`, s.id)
				return
			}
			put(s, P0.geo, P0.x, y, P0.angle)
			report.moved = { dy: r6(y - P0.y), why: bodyNames }
			say("info", "moved", `${s.name} was raised ${((y - P0.y) * 100).toFixed(1)} cm to clear ${bodyNames}`, s.id)
			return
		}
		// sideways along the support: both ways, the shorter wins
		const tryWay = (dir) => {
			let x = P0.x
			for (let i = 0; i < 16; i++) {
				const y = ctx.drop(x)
				if (y === null) return null
				const sh = shapesAt(P0.geo, x, y, ctx.angle)
				const bl = blockersAt(sh)
				if (!bl.length) {
					if (ctx.range) {
						const b = boxOf(sh)
						if (b.x0 < ctx.range.x0 - 1e-6 || b.x1 > ctx.range.x1 + 1e-6) return null
					}
					return { x, y }
				}
				let need = 0
				for (const b of bl) need = Math.max(need, dir > 0 ? -slackItem(b.shapes, sh) : -slackItem(sh, b.shapes))
				x += dir * (Math.max(need, 0.0005) + ROOM_GAP)
			}
			return null
		}
		const r = tryWay(1)
		const l = tryWay(-1)
		const best = r && l ? (Math.abs(r.x - P0.x) <= Math.abs(l.x - P0.x) ? r : l) : r ?? l
		if (!best) {
			say("warn", "overlap", `There's no room for ${s.name} where it was asked to be: it goes through ${names}`, s.id)
			return
		}
		put(s, P0.geo, best.x, best.y, P0.angle)
		report.moved = { dx: r6(best.x - P0.x), why: names }
		say("info", "moved", `${s.name} was moved ${(Math.abs(best.x - P0.x) * 100).toFixed(1)} cm ${best.x > P0.x ? "right" : "left"} to clear ${names}`, s.id)
	}
}

export const slug = (t) => String(t).toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "ai-scene"

// ================================================================ the inverse: a scene as a plan (for follow-up edits)
/**
 * scene -> plan whose solve() gives the same scene back (to within the resting distances): each item keeps its x and says what it rests on
 * (so when its support changes, it follows), what it is inside, or, in the air and for fixed things leaning or tilted, its exact pose (keep).
 */
export function planFromScene(scene) {
	const items = (scene?.items ?? []).filter((i) => isObj(i) && TYPES[i.type])
	const geo = new Map()
	const sh = new Map()
	for (const it of items) {
		let g
		try {
			g = itemGeometry(it.type, it.props ?? {}, it.fixed === true)
		} catch {
			continue
		}
		geo.set(it.id, g)
		sh.set(it.id, shapesAt(g, Number(it.x) || 0, Number(it.y) || 0, Number(it.angle) || 0))
	}
	const table = items.find((i) => i.type === "table")
	const top = Number(table?.y) || 0
	const tw = Number(table?.props?.width ?? DEFAULT_TABLE.width)
	// the safety walls at the table's ends are the solver's own (it puts them back): they are not part of the plan
	const safety = (it) => it.type === "wall" && it.props?.invisible_in_3d === true && table && [-1, 1].some((sx) => Math.abs(it.x - (table.x + sx * (tw / 2 - 0.03))) < 0.02)
	const out = []
	for (const it of items) {
		if (!sh.has(it.id) || it === table || safety(it)) continue
		const base = { id: it.id, type: it.type, name: it.name ?? typeName(it.type), props: { ...(it.props ?? {}) } }
		if (it.held) base.held = true
		if (it.fixed) base.fixed = true
		const mine = sh.get(it.id)
		// what it rests on: the thing whose top is within 4 mm under it (the highest such)
		let support = null
		let best = -Infinity
		for (const o of items) {
			if (o === it || !sh.has(o.id)) continue
			const L = liftItem(mine, sh.get(o.id))
			if (L > -0.004 && L < 0.0015) {
				const top = boxOf(sh.get(o.id)).y1
				if (top > best) {
					best = top
					support = o
				}
			}
		}
		const dynamic = TYPES[it.type].dynamic && !it.fixed
		const tilted = Math.abs(Number(it.angle) || 0) > 0.05
		if (support && (dynamic || !tilted)) {
			const place = support.type === "table" ? { on: "table", x: it.x } : isContainer(support.type) && boxOf(mine).y0 < boxOf(sh.get(support.id)).y1 - 0.003 ? { inside: support.id, x: it.x } : { on: support.id, x: it.x }
			if (tilted) {
				// a tilt that is just the support's slope there is re-made by the solver (so it follows the support); any other is kept
				const b = boxOf(mine)
				const S = sh.get(support.id)
				const k = flatSlopeOf(S, b.x0, b.x1)
				if (k === null || Math.abs(k - it.angle) > 0.05) place.angle_deg = it.angle
			} else if (!geo.get(it.id).shapes.every((q) => q.k === "circle")) place.angle_deg = 0
			out.push({ ...base, place })
		} else out.push({ ...base, place: { on: "air", x: it.x, y_m: r6(it.y - top), angle_deg: Number(it.angle) || 0, keep: true } })
	}
	const plan = { title: scene?.name ?? "Scene", seconds: scene?.seconds, release: scene?.release, items: out, goals: (scene?.goals ?? []).filter((g) => g && typeof g === "object").map((g) => ({ ...g })), stage: scene?.stage }
	if (isObj(scene?.settings) && Object.keys(scene.settings).length) plan.settings = { ...scene.settings } // (re-solving keeps the scene's settings)
	if (table) plan.table = { x: table.x, ...(Number(table.y) ? { y: table.y } : {}), props: { ...(table.props ?? {}) } }
	return pinDrifters(plan, items)
}
/** The round trip must hold (an edit must not move what it does not touch): solve the plan, and every item the solver would put somewhere else
 *  than the scene has it (a launcher on a short tilted plank "kept on" it, a book deliberately overhanging the one below) is pinned to its exact
 *  pose instead (on "air", keep), a few times over, since a pinned support can change what rests on it. The resting distance (a few mm up for a
 *  stack the scene made touching exactly) is not a drift. */
function pinDrifters(plan, items) {
	const was = new Map(items.map((i) => [i.id, i]))
	const top = Number(items.find((i) => i.type === "table")?.y) || 0
	for (let round = 0; round < 4; round++) {
		let solved
		try {
			solved = solve(plan)
		} catch {
			return plan
		}
		const now = new Map(solved.scene.items.map((i) => [i.id, i]))
		let pinned = 0
		for (const p of plan.items) {
			if (p.place?.keep) continue
			const a = was.get(p.id)
			const b = now.get(p.id)
			if (!a || !b) continue
			const dx = Math.abs((Number(b.x) || 0) - (Number(a.x) || 0))
			const dy = Math.abs((Number(b.y) || 0) - (Number(a.y) || 0))
			const da = Math.abs((Number(b.angle) || 0) - (Number(a.angle) || 0))
			if (dx > 0.0015 || dy > 0.005 || da > 0.1) {
				p.place = { on: "air", x: Number(a.x) || 0, y_m: r6((Number(a.y) || 0) - top), angle_deg: Number(a.angle) || 0, keep: true }
				pinned++
			}
		}
		if (!pinned) return plan
	}
	return plan
}
function flatSlopeOf(shapes, x0, x1) {
	const n = 9
	const pts = []
	for (let i = 0; i < n; i++) {
		const x = x0 + ((x1 - x0) * i) / (n - 1)
		const y = topAt(shapes, x)
		if (y === -Infinity) return null
		pts.push([x, y])
	}
	const mx = pts.reduce((a, q) => a + q[0], 0) / n
	const my = pts.reduce((a, q) => a + q[1], 0) / n
	let sxx = 0
	let sxy = 0
	for (const [x, y] of pts) {
		sxx += (x - mx) ** 2
		sxy += (x - mx) * (y - my)
	}
	if (sxx < 1e-12) return null
	const k = sxy / sxx
	for (const [x, y] of pts) if (Math.abs(my + k * (x - mx) - y) > 0.0005) return null
	return (Math.atan(k) * 180) / Math.PI
}

// ================================================================ checks the tests and the orchestrator use
/** For each item resting on something: the gap between it and that support (m; the resting distance when exact), and for every pair the
 *  deepest overlap. -> {contacts: [{id, on, gap}], overlaps: [{a, b, depth}]} */
export function inspect(scene) {
	const items = scene.items.filter((i) => TYPES[i.type])
	const sh = new Map(items.map((i) => [i.id, shapesAt(itemGeometry(i.type, i.props ?? {}, i.fixed === true), i.x, i.y, i.angle ?? 0)]))
	const overlaps = []
	for (let i = 0; i < items.length; i++)
		for (let j = i + 1; j < items.length; j++) {
			const d = depthItem(sh.get(items[i].id), sh.get(items[j].id))
			if (d > 1e-6) overlaps.push({ a: items[i].id, b: items[j].id, depth: d })
		}
	return {
		overlaps,
		/** gap between item id and support id: how far it could come down before touching (raw, no resting distance) */
		gap(id, sup) {
			const L = -Infinity
			let best = L
			for (const a of sh.get(id)) for (const b of sh.get(sup)) {
				const v = liftOver(a, b)
				if (v > best) best = v
			}
			return best === -Infinity ? null : -best
		},
		/** horizontal clearance between a (left) and b (right), raw */
		slack(a, b) {
			let best = Infinity
			for (const p of sh.get(a)) for (const q of sh.get(b)) best = Math.min(best, slackRight(p, q))
			return best
		},
		shapes: (id) => sh.get(id),
		box: (id) => boxOf(sh.get(id))
	}
}
