// The parts of machines/rube.py that machines/items.py uses: where each solid starts in the world, and how deep two solids overlap
// at the start (balls and slabs). Plain ES module.
import { ZeroDivisionError, cos, hypot, maxOf, minOf, pymax, pymin, sin } from "./pymath.js"

export const CORD = 2.6 // m, long enough to leave the top of the picture

/** Each solid's world pose [x, y, angle] at the start (a part fixed to a parent is placed in the parent's frame); a Map keyed by solid id. */
export function _world(doc) {
	const by = new Map(doc.solids.map((s) => [s.id, s]))
	const out = new Map()
	for (const s of doc.solids) {
		let x = s.at.x
		let y = s.at.y
		let a = "angle" in s ? s.angle : 0.0
		if ("parent" in s) {
			const q = by.get(s.parent)
			if (q === undefined) throw new Error(`'${s.parent}'`) // Python: KeyError
			const qa = "angle" in q ? q.angle : 0.0
			;[x, y] = [q.at.x + x * cos(qa) - y * sin(qa), q.at.y + x * sin(qa) + y * cos(qa)]
			a += qa
		}
		out.set(s.id, [x, y, a])
	}
	return out
}

/** A slab's four corners in the world (rube.py's: no taper), counter-clockwise from the bottom left. */
function _corners(s, pose) {
	const [x, y, a] = pose
	const hw = s.body.width / 2
	const hh = s.body.height / 2
	const c = cos(a)
	const n = sin(a)
	return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([px, py]) => [x + px * c - py * n, y + px * n + py * c])
}

/** How deep two solids interpenetrate at the start, m (0 if apart). */
export function _overlap_depth(sa, pa, sb, pb) {
	const ka = sa.body.kind
	const kb = sb.body.kind
	if (ka === "ball" && kb === "ball") return pymax(0.0, sa.body.radius + sb.body.radius - hypot(pa[0] - pb[0], pa[1] - pb[1]))
	if (ka === "ball" || kb === "ball") {
		const [[sc, pc], [sr, pr]] = ka === "ball" ? [[sa, pa], [sb, pb]] : [[sb, pb], [sa, pa]]
		const dx = pc[0] - pr[0]
		const dy = pc[1] - pr[1]
		const c = cos(-pr[2])
		const n = sin(-pr[2])
		const lx = dx * c - dy * n
		const ly = dx * n + dy * c
		const hw = sr.body.width / 2
		const hh = sr.body.height / 2
		const qx = pymax(-hw, pymin(hw, lx))
		const qy = pymax(-hh, pymin(hh, ly))
		const inside = Math.abs(lx) <= hw && Math.abs(ly) <= hh
		const d = hypot(lx - qx, ly - qy)
		return inside || d < sc.body.radius ? sc.body.radius + (inside ? pymin(hw - Math.abs(lx), hh - Math.abs(ly)) : -d) : 0.0
	}
	const A = _corners(sa, pa)
	const B = _corners(sb, pb)
	let depth = Infinity
	for (const poly of [A, B]) {
		for (let i = 0; i < 4; i++) {
			const [x1, y1] = poly[i]
			const [x2, y2] = poly[(i + 1) % 4]
			let ax = -(y2 - y1)
			let ay = x2 - x1
			const m = hypot(ax, ay)
			if (m === 0) throw new ZeroDivisionError()
			ax = ax / m
			ay = ay / m
			const pA = A.map(([px, py]) => px * ax + py * ay)
			const pB = B.map(([px, py]) => px * ax + py * ay)
			const o = pymin(maxOf(pA), maxOf(pB)) - pymax(minOf(pA), minOf(pB))
			if (o <= 0) return 0.0
			depth = pymin(depth, o)
		}
	}
	return depth
}
