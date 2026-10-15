// Placement helpers for building exact scenes by hand (ground truth, reference solutions): every item is set onto its support with the
// app's own builder geometry (web/sim layout via score.mjs geometry()), 1.5 mm above it (Box2D's resting separation).
import { pathToFileURL } from "node:url"
import path from "node:path"
import { fileURLToPath } from "node:url"
const HERE = path.dirname(fileURLToPath(import.meta.url))
const BENCH = path.resolve(HERE, "..")
const ROOT = path.resolve(BENCH, "../..")
const { geometry } = await import(pathToFileURL(path.join(BENCH, "score.mjs")).href)
const SIM = await import(pathToFileURL(path.join(ROOT, "web/sim/index.js")).href)
export { geometry, SIM }

export const r5 = (v) => Math.round(v * 1e5) / 1e5

// seeded jitter (mulberry32)
export function rng(seed) {
	let a = seed >>> 0
	return () => {
		a = (a + 0x6d2b79f5) >>> 0
		let t = a
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

export function scene(id, name, stage, seconds = 4.5) {
	return { version: 2, id, name, seconds, release: 0.5, stage, items: [{ id: "table", type: "table", name: "Table", x: 1.3, y: 0, angle: 0, props: {} }], goals: [] }
}
export const itemOf = (sc, id) => sc.items.find((i) => i.id === id)
/** Where an item's outline is relative to its anchor: {dx0, dx1, dy0, dy1} (box minus anchor), measured with the builder. */
export function extent(sc, it) {
	const probe = { ...sc, items: [{ ...it, x: 0, y: 5 }] }
	const G = geometry(probe)
	const g = G.byId.get(it.id)
	return { dx0: g.box.x0, dx1: g.box.x1, dy0: g.box.y0 - 5, dy1: g.box.y1 - 5 }
}
/** The highest top surface of `support` (an item id, or "table") between x0 and x1. */
export function topOver(sc, support, x0, x1) {
	const G = geometry(sc)
	if (support === "table") return G.tableTop
	const g = G.byId.get(support)
	let top = -Infinity
	for (let k = 0; k <= 16; k++) {
		const x = x0 + ((x1 - x0) * k) / 16
		for (const s of g.solids) {
			const sh = s.shape
			let y = null
			if (sh.c) y = Math.abs(x - sh.x) <= sh.r ? sh.y + Math.sqrt(sh.r * sh.r - (x - sh.x) ** 2) : null
			else
				for (let i = 0; i < sh.pts.length; i++) {
					const [ax, ay] = sh.pts[i]
					const [bx, by] = sh.pts[(i + 1) % sh.pts.length]
					if (x < Math.min(ax, bx) || x > Math.max(ax, bx)) continue
					const yy = bx === ax ? Math.max(ay, by) : ay + ((x - ax) / (bx - ax)) * (by - ay)
					if (y === null || yy > y) y = yy
				}
			if (y !== null && y > top) top = y
		}
	}
	if (top === -Infinity) throw new Error(`${support} has no surface over ${x0}..${x1}`)
	return top
}
/** Add `it` with its outline's left edge at `left` (or its anchor at x), resting on `on` (table or an item id), `gap` m above it. */
// gap: 1.5 mm, Box2D's resting separation. (Measured: a 0.5 mm gap can make the engine shove the lower of two stacked bodies sideways at the
// release — a book slid 13 cm from under a phone; 0 or ≥ 1 mm does not.)
export const GAP = 0.0015
export function put(sc, it, { x, left, on = "table", gap = GAP }) {
	it = { angle: 0, props: {}, ...it }
	const e = extent(sc, it)
	const ax = left !== undefined ? left - e.dx0 : x
	const top = topOver(sc, on, ax + e.dx0, ax + e.dx1)
	it.x = r5(ax)
	it.y = r5(top + gap - e.dy0)
	sc.items.push(it)
	return { ...it, x0: ax + e.dx0, x1: ax + e.dx1, y1: it.y + e.dy1 }
}
/** Add `it` with its anchor at (x, y) exactly (held things, hanging things, pendulum pivots). */
export function at(sc, it, x, y) {
	const o = { angle: 0, props: {}, ...it, x: r5(x), y: r5(y) }
	sc.items.push(o)
	return o
}
/**
 * A plank ramp leaning from the top-right (or top-left) corner of `support` down to the table: its underside touches that corner and its
 * low end's bottom edge sits on the table. angleDeg < 0 slopes down to the right. Returns the plank and a function that gives the top surface
 * point s metres along the plank from its high end.
 */
export function leanRamp(sc, it, support, angleDeg, overhang = 0.06) {
	const G = geometry(sc)
	const S = G.byId.get(support)
	const T = G.tableTop
	const L = it.props?.length ?? 1
	const t = it.props?.thickness ?? 0.022
	const th = angleDeg * (Math.PI / 180)
	const [ux, uy] = [Math.cos(th), Math.sin(th)] // along the plank, to the right
	const [nx, ny] = [-Math.sin(th), Math.cos(th)] // up from its top face
	const down = angleDeg < 0 // slopes down to the right: the high end is at the support's right corner
	const P = down ? [S.box.x1, S.box.y1 + GAP] : [S.box.x0, S.box.y1 + GAP]
	// the low end's bottom corner on the table: c + s_low*u - (t/2) n has y = T, with s_low = +L/2 (down right) or -L/2 (down left)
	const sLow = down ? L / 2 : -L / 2
	const cy = T + GAP - sLow * uy + (t / 2) * ny
	// P on the underside line: (P - c)·n = -t/2  ->  cx
	const cx = P[0] + ((P[1] - cy) * ny + t / 2) / nx
	const sP = (P[0] - cx) * ux + (P[1] - cy) * uy
	const over = down ? sP + L / 2 : L / 2 - sP // how far the plank reaches past the corner, onto the support's top
	if (over < overhang) throw new Error(`ramp ${it.id}: the high end reaches only ${over.toFixed(3)} m past the support's corner (want ${overhang})`)
	const plank = { angle: r5(angleDeg), ...it, x: r5(cx), y: r5(cy), props: { legs: false, ...(it.props ?? {}) } }
	sc.items.push(plank)
	const along = (s) => { const k = down ? -L / 2 + s : L / 2 - s; return [cx + k * ux + (t / 2) * nx, cy + k * uy + (t / 2) * ny] }
	return { plank, along, normal: [nx, ny], angle: angleDeg }
}

export function check(sc) {
	const L = SIM.layout(sc)
	if (L.warnings.length) throw new Error(`${sc.id}: ${L.warnings.map((w) => w.text).join("; ")}`)
	const G = geometry(sc)
	const st = sc.stage
	for (const i of G.items) if (!i.scenery && (i.box.x0 < st.x0 || i.box.x1 > st.x1 || i.box.y1 > st.y1)) throw new Error(`${sc.id}: ${i.id} is outside the stage`)
	return sc
}
export const STAGE = (x0, x1, y1 = 1.1) => ({ x0, x1, y0: -0.12, y1 })


/** A static plank (on legs, unless props.legs is false) whose top surface runs from (x0, y0) at its left end to (x1, y1) at its right end.
 *  Returns {a (rad), nx, ny (its top's normal), at(s): the top-surface point s metres from the left end}. */
export function plankTop(sc, id, name, x0, y0, x1, y1, props = {}, type = "plank") {
	const t = props.thickness ?? 0.022
	const L = Math.hypot(x1 - x0, y1 - y0)
	const a = Math.atan2(y1 - y0, x1 - x0)
	const nx = -Math.sin(a)
	const ny = Math.cos(a)
	const cx = (x0 + x1) / 2 - (nx * t) / 2
	const cy = (y0 + y1) / 2 - (ny * t) / 2
	sc.items.push({ id, type, name, x: r5(cx), y: r5(cy), angle: r5((a * 180) / Math.PI), props: { length: r5(L), ...props } })
	return { a, nx, ny, at: (s) => [x0 + s * Math.cos(a), y0 + s * Math.sin(a)] }
}
