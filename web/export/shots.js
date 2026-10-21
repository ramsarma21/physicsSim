// The filming module (DIRECTOR.md sections 2 to 4 and 7): a shot plan, written for one video's lesson by a director (the AI step `direct`, a
// person, or autoPlan below when there is none), and the run it films become a camera for every frame of the video, exactly, before a single
// frame is drawn. The physics has already happened: every body's path, every contact, every start and stop, every light ray's path and every
// reading over time are in the run, so every target a plan names (a thing, a part, a contact point, a beam's bounce, an instrument's face, a
// lane's metre mark) is resolved from the scene and its track, and the camera is planned non-causally over the whole video.
//
//   makeWorld({run | runs, scene, catalog, registry, hints, boxes, recog, environment})   what a plan can name (the runs, their moments, things)
//   compile(plan, world, {width, height, fps})  -> a film: per frame its shot, its run time and one camera per band (JSON; frameAt() reads it)
//   measure(film)                               -> the report: each shot's measured facts and the safety net's checks (DIRECTOR.md 7.2)
//   autoPlan(world, {width, height, fps})       -> the plan with no director: what the recognizer says the run is about, big, cut by moment
//   resolvePlan(plan, world) / checkPlan(plan, world, opts)   -> every id resolved (7.1), then compiled and measured (7.2), with messages
//   frameAt(film, tau), cameraOf(pose), specOf(pose), runTimeAt(film, tau), videoTimesOf(film, t), retime(film, impacts), filmFromJSON(json)
//
// Pure: it reads only its arguments (a run is the /api/simulate answer {doc, track, summary}), imports only the track helpers, the optics tracer
// (the very trace the view draws) and the subject recognizer, and gives the same film for the same plan, run and picture, byte for byte, in
// node and in the page. Coordinates are the machine plane's (metres, x right, y up, z toward the default camera); run times (t) are seconds of
// the run, video times (tau) seconds of the video. A camera pose is {L: look point, d: distance, yaw, pitch (radians), hfov (radians)}: the
// camera stands at L + d (sin yaw cos pitch, sin pitch, cos yaw cos pitch) looking at L, +y up, no roll. web/view3d.js films a film (export
// cameras "director-plan" and "focus"); the contract is web/CONTRACT.md "Filming module: directed cameras".
import { completeTrack, frameIndex } from "../track.js"
import * as O from "../sim/optics.js"
import { recognize, registryOf, sceneFromSim } from "./subjects.js"

export const VERSION = 1

// ------------------------------------------------------------------------------------------------ the numbers
/** The safety net (DIRECTOR.md 7.2), from the video-gen originals' measurements (lesson-regen/compositor/FRAMING_RULE.md) and the export's limits. */
export const NET = Object.freeze({
	keepMargin: 0.02, // every kept thing whole, at least 2 % inside every edge, at every frame
	heroS: 0.09, // a hero at its key moment: sqrt(w h) at least 0.09 of the picture ...
	heroH: 0.1, // ... and at least 0.10 of its height, unless it is flat or thin (the originals: 33 of 34 holds)
	detailS: 0.045, // a detail (a part, one block, a clip, a salt pile, a mark), and a hero in a setup or reveal shot that shows a whole
	panWps: 0.5, // a camera move: the picture's fastest point at most 0.5 picture widths a second
	followWps: 1.25, // a follow or a travel: the background may slide up to 1.25 widths a second ...
	trackWps: 1.5, // ... a follow 1.5 while its subject stays steady in the picture (moves at most steadySubjectWps): the eye rides it
	steadySubjectWps: 0.15,
	zoomPerS: 0.7, // log-distance a second at its fastest (about 2x in 1.5 s)
	yawDegS: 15,
	holdStill: 0.002, // widths a second: a hold, and the last 0.5 s before a pause
	jumpWps: 3, // faster than this inside a shot (or across a join that is not a cut) is a jump
	beamCorePx: 1.5, // the laser's core and glow at the output width (the optics drawing: core 1.6 mm, glow 7 mm)
	beamHaloPx: 6,
	minHold: 0.8, // video seconds: the shortest still a child can read
	minShot: 0.8,
	faceH: 0.18, // an instrument face whose reading carries the answer: at least this share of the picture's height (gate 5)
	parity: 1.1, // the same role in two lanes: sizes within 10 %
	backdrop: 0.82, // a held moment's picture: at most this share of it shows nothing of the scene (FRAMING_RULE gate 4; the originals 0.57 to 0.80) ...
	fillLong: 0.5, // ... unless what it names already spans this share of the picture on its longer side (a thin, flat or lone thing framed close) ...
	spread: 0.6, // ... and covers this share of the box round it (things far apart with backdrop between belong in their own bands)
	absentS: 0.5, // video seconds a playing shot may show none of its subject once it has been seen (it left the picture) ...
	waitS: 1.5, // ... and before it first comes in (a cut ahead that waits for a fast thing to arrive)
	stopBackdrop: 0.65, // a lesson's stop (a pause beat's last shot): at most this share of each band shows nothing of the scene, a table top counted as backdrop (a low setup under one floor line with a tall one leaves its band about half empty, as the drawn originals do)
	cutScale: 2.5, // a cut out to a wider picture while things move widens it at most this much (the movers shrink to specks in a bigger jump)
	pathFill: 0.7, // a still whose subject is a path (an orbit, a trip): its drawn path (the mover's centre) spans at least this share of the picture's longer side, the mover kept whole
})
/** The named views: yaw and pitch in degrees, and the lens a view takes when the shot names none (mm on a full-frame camera). */
export const VIEWS = Object.freeze({
	side: { yaw: 0, pitch: 8, lens: 50 },
	eye: { yaw: 0, pitch: 3, lens: 50 },
	low: { yaw: 0, pitch: -3, lens: 40 },
	high: { yaw: 0, pitch: 28, lens: 40 },
	"top-down": { yaw: 0, pitch: 80, lens: 40 },
	"three-quarter-left": { yaw: -32, pitch: 14, lens: 40 },
	"three-quarter-right": { yaw: 32, pitch: 14, lens: 40 },
	macro: { yaw: 0, pitch: 10, lens: 90 },
})
/** The studio's backdrop per tone, and its floor (the floor is lit by the key light, so its paint is darker than the backdrop it fades into). */
export const TONES = Object.freeze({ dark: "#1b1e23", mid: "#3b4048", light: "#8d929b" })
export const FLOORS = Object.freeze({ dark: "#15171b", mid: "#2c3036", light: "#6f747c" })
/** The look a plan gets where it says nothing (section 3.9): the room hidden behind a plain backdrop, the table drawn as a seamless studio floor. */
export const DEFAULT_LOOK = Object.freeze({ backdrop: "studio", tone: "mid", ground: "sweep", light: "subject", depth: "none", vignette: 0, labels: "scene" })
const MARGINS = { tight: 0.06, snug: 0.1, loose: 0.18 }
const KEEP_PAD = 0.05 // a framing by width or size: what it keeps stays at least this share of the picture inside every edge
const PLACES = { centre: [0, 0], "left-third": [-1 / 3, 0], "right-third": [1 / 3, 0], "upper-third": [0, 1 / 3], "lower-third": [0, -1 / 3] }
const MARK = { yellow: "#ffd84a", white: "#ffffff", blue: "#9fd0ff", faint: "rgba(255,255,255,0.55)" }

// ------------------------------------------------------------------------------------------------ small maths
const D2R = Math.PI / 180
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k]
const len3 = (a) => Math.hypot(a[0], a[1], a[2])
const lerp3 = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]
const r3 = (v) => Math.round(v * 1000) / 1000
const r4 = (v) => Math.round(v * 10000) / 10000
const smoother = (x) => {
	const s = clamp(x, 0, 1)
	return s * s * s * (s * (s * 6 - 15) + 10)
}
const gentle = (x) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(x, 0, 1))
const easeOf = (k) => (k === "linear" ? (x) => clamp(x, 0, 1) : k === "gentle" ? gentle : smoother)
/** The horizontal field of a lens (mm, full frame: 36 mm across). */
export const hfovOf = (lens) => 2 * Math.atan(18 / lens)

/** The camera's frame for a view: u from the look point toward the camera, f forward, r right, up (three.js lookAt with +y up, no roll). */
function basis(yaw, pitch) {
	const cp = Math.cos(pitch)
	const u = [Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp]
	const f = [-u[0], -u[1], -u[2]]
	const rl = Math.hypot(f[2], f[0]) || 1
	const r = [-f[2] / rl, 0, f[0] / rl]
	const up = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]]
	return { u, f, r, up }
}
/** A projector for one pose and picture aspect: X -> {x, y} (-1..1 across and up the picture) and z (depth along the view). */
function projector(p, asp) {
	const B = basis(p.yaw, p.pitch)
	const C = add(p.L, mul(B.u, p.d))
	const tanH = Math.tan(p.hfov / 2)
	const { f, r, up } = B
	return (X) => {
		const vx = X[0] - C[0]
		const vy = X[1] - C[1]
		const vz = X[2] - C[2]
		const z = vx * f[0] + vy * f[1] + vz * f[2]
		return { x: (vx * r[0] + vy * r[1] + vz * r[2]) / (z * tanH), y: ((vx * up[0] + vy * up[1] + vz * up[2]) / (z * tanH)) * asp, z }
	}
}
function projBox(p, asp, pts) {
	const pr = projector(p, asp)
	let x0 = Infinity
	let x1 = -Infinity
	let y0 = Infinity
	let y1 = -Infinity
	let behind = false
	for (const X of pts) {
		const q = pr(X)
		if (q.z < 0.02) behind = true
		if (q.x < x0) x0 = q.x
		if (q.x > x1) x1 = q.x
		if (q.y < y0) y0 = q.y
		if (q.y > y1) y1 = q.y
	}
	return { x0, x1, y0, y1, behind }
}
/** The share of the picture a projected box covers (w across, h up: the part inside the picture), its size s = sqrt(w h), its smallest distance to
 *  an edge (picture fractions; negative: cut off), and its centre. */
function boxStats(b) {
	const w = Math.max(0, (Math.min(1, b.x1) - Math.max(-1, b.x0)) / 2)
	const h = Math.max(0, (Math.min(1, b.y1) - Math.max(-1, b.y0)) / 2)
	const margin = Math.min((b.x0 + 1) / 2, (1 - b.x1) / 2, (b.y0 + 1) / 2, (1 - b.y1) / 2)
	return { w, h, s: Math.sqrt(w * h), margin: b.behind ? -1 : margin, cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2 }
}
function insideAll(p, asp, pts, m) {
	const b = projBox(p, asp, pts)
	return !b.behind && b.x0 >= -1 + 2 * m && b.x1 <= 1 - 2 * m && b.y0 >= -1 + 2 * m && b.y1 <= 1 - 2 * m
}
/** The smallest distance in dMin..dMax for which ok(d) holds (log bisection; ok is monotone in d). */
function bisectD(ok, dMin, dMax) {
	if (ok(dMin)) return dMin
	if (!ok(dMax)) return dMax
	let lo = Math.log(dMin)
	let hi = Math.log(dMax)
	for (let i = 0; i < 40; i++) {
		const mid = (lo + hi) / 2
		if (ok(Math.exp(mid))) hi = mid
		else lo = mid
	}
	return Math.exp(hi)
}
const boundsOf = (pts) => {
	const a = [Infinity, Infinity, Infinity]
	const b = [-Infinity, -Infinity, -Infinity]
	for (const X of pts)
		for (let i = 0; i < 3; i++) {
			if (X[i] < a[i]) a[i] = X[i]
			if (X[i] > b[i]) b[i] = X[i]
		}
	return [a, b]
}
const centre3 = (pts) => {
	const [a, b] = boundsOf(pts)
	return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
}
const placeOf = (pl) => (typeof pl === "string" ? (PLACES[pl] ?? [0, 0]) : pl && typeof pl === "object" ? [Number(pl.x) || 0, Number(pl.y) || 0] : [0, 0])
function viewOf(v, lens) {
	const b = typeof v === "string" ? (VIEWS[v] ?? VIEWS.side) : v && typeof v === "object" ? { yaw: Number(v.yaw) || 0, pitch: Number(v.pitch) || 0, lens: 50 } : VIEWS.side
	return { yaw: b.yaw * D2R, pitch: b.pitch * D2R, lens: Number(lens ?? b.lens) || 50 }
}
/** Solve a framing (section 4.3): the subject's points (and what must stay in) -> a pose. frame: {fit} centres subject and keep together inside a
 *  margin; {size} gives the subject's larger side that share of the picture (backing off until every kept thing is 3 % inside); {width} sets the
 *  metres across the picture at the look point. place shifts where the subject sits in the picture. */
function solveFraming({ subj, keep = [], frame, place, view, asp }) {
	const { yaw, pitch, lens } = view
	const hfov = hfovOf(lens)
	const B = basis(yaw, pitch)
	const tanH = Math.tan(hfov / 2)
	const tanV = tanH / asp
	const [px, py] = placeOf(place)
	const all = keep.length ? [...subj, ...keep] : subj
	const fr = frame ?? { fit: "snug" }
	const at = (anchor, d) => ({ L: sub(sub(anchor, mul(B.r, px * d * tanH)), mul(B.up, py * d * tanV)), d, yaw, pitch, hfov })
	if (fr.fit) {
		const m = MARGINS[fr.fit] ?? MARGINS.snug
		let anchor = centre3(all)
		let d = 1
		for (let it = 0; it < 16; it++) {
			d = bisectD((dd) => insideAll(at(anchor, dd), asp, all, m), 0.01, 600)
			const b = boxStats(projBox(at(anchor, d), asp, all))
			const ox = b.cx - px
			const oy = b.cy - py
			if (Math.abs(ox) < 1e-5 && Math.abs(oy) < 1e-5) break
			anchor = add(anchor, add(mul(B.r, ox * d * tanH), mul(B.up, oy * d * tanV)))
		}
		return at(anchor, d)
	}
	let anchor = centre3(subj)
	let d
	if (fr.width) d = fr.width / 2 / tanH
	else {
		const big = (dd) => {
			const b = boxStats(projBox(at(anchor, dd), asp, subj))
			return Math.max(b.w, b.h) <= fr.size
		}
		d = bisectD(big, 0.01, 600)
	}
	// what must stay whole keeps room round it (KEEP_PAD of the picture), never pressed against an edge: first the look point slides (the subject's
	// place gives way, its scale stays), and only when the kept things cannot fit at this scale does the camera back off, from their middle
	if (keep.length && !insideAll(at(anchor, d), asp, all, KEEP_PAD)) {
		const lim = 1 - 2 * KEEP_PAD
		for (let it = 0; it < 8; it++) {
			const b = projBox(at(anchor, d), asp, all)
			if (b.behind || b.x1 - b.x0 > 2 * lim || b.y1 - b.y0 > 2 * lim) break
			const ox = b.x0 < -lim ? b.x0 + lim : b.x1 > lim ? b.x1 - lim : 0
			const oy = b.y0 < -lim ? b.y0 + lim : b.y1 > lim ? b.y1 - lim : 0
			if (Math.abs(ox) < 1e-6 && Math.abs(oy) < 1e-6) break
			anchor = add(anchor, add(mul(B.r, ox * d * tanH), mul(B.up, oy * d * tanV)))
		}
		if (!insideAll(at(anchor, d), asp, all, KEEP_PAD)) {
			anchor = centre3(all)
			d = bisectD((dd) => insideAll(at(anchor, dd), asp, all, KEEP_PAD), d, 600)
		}
	}
	return at(anchor, d)
}
const lerpPose = (a, b, u) => ({ L: lerp3(a.L, b.L, u), d: Math.exp(Math.log(a.d) + (Math.log(b.d) - Math.log(a.d)) * u), yaw: a.yaw + (b.yaw - a.yaw) * u, pitch: a.pitch + (b.pitch - a.pitch) * u, hfov: a.hfov + (b.hfov - a.hfov) * u })
/** The director's straight dolly line: the distance eased on a log scale, the look point in step with the distance, so a point both framings
 *  hold stays in the picture all the way (web/view3d.js directorShot's `at`). */
function dollyPose(a, b, u) {
	const d = Math.exp(Math.log(a.d) + (Math.log(b.d) - Math.log(a.d)) * u)
	const g = Math.abs(a.d - b.d) > 1e-9 ? (a.d - d) / (a.d - b.d) : u
	return { L: lerp3(a.L, b.L, g), d, yaw: a.yaw + (b.yaw - a.yaw) * u, pitch: a.pitch + (b.pitch - a.pitch) * u, hfov: a.hfov + (b.hfov - a.hfov) * u }
}
const poseArr = (p) => [p.L[0], p.L[1], p.L[2], p.d, p.yaw, p.pitch, p.hfov]
const arrPose = (a) => ({ L: [a[0], a[1], a[2]], d: a[3], yaw: a[4], pitch: a[5], hfov: a[6] })
const differs = (a, b) => len3(sub(a.L, b.L)) > 1e-6 || Math.abs(Math.log(a.d / b.d)) > 1e-5 || Math.abs(a.yaw - b.yaw) > 1e-6 || Math.abs(a.pitch - b.pitch) > 1e-6 || Math.abs(a.hfov - b.hfov) > 1e-6
/** Zero-phase critically damped smoothing (web/view3d.js dampSeries): no lag, no overshoot, no jerk. */
function dampSeries(src, omega, hz) {
	const out = Float64Array.from(src)
	const n = out.length
	if (n < 3) return out
	const dt = 1 / hz
	const e = Math.exp(-omega * dt)
	const pass = (from, to, step) => {
		let x = out[from]
		let v = 0
		for (let i = from + step; i !== to + step; i += step) {
			const y0 = x - out[i]
			const c = v + omega * y0
			x = out[i] + (y0 + c * dt) * e
			v = (v - omega * c * dt) * e
			out[i] = x
		}
	}
	pass(0, n - 1, 1)
	pass(n - 1, 0, -1)
	return out
}
/** The largest value within w samples either side, then a Hann average over the same window: an envelope that never undercuts the original. */
function envelope(src, w) {
	const n = src.length
	const ext = new Float64Array(n)
	for (let i = 0; i < n; i++) {
		let v = src[i]
		for (let j = Math.max(0, i - w); j <= Math.min(n - 1, i + w); j++) if (src[j] > v) v = src[j]
		ext[i] = v
	}
	const out = new Float64Array(n)
	for (let i = 0; i < n; i++) {
		let s = 0
		let ws = 0
		for (let j = -w; j <= w; j++) {
			const k = i + j
			if (k < 0 || k >= n) continue
			const h = 0.5 * (1 + Math.cos((Math.PI * j) / (w + 1)))
			s += ext[k] * h
			ws += h
		}
		out[i] = s / ws
	}
	return out
}
/** Catmull-Rom through samples a[0..n-1] at fractional index u (web/view3d.js curveAt). */
function curveAt(a, u) {
	const n = a.length
	if (n === 1) return a[0]
	u = clamp(u, 0, n - 1)
	const i = Math.min(n - 2, Math.floor(u))
	const f = u - i
	const p0 = a[Math.max(0, i - 1)]
	const p1 = a[i]
	const p2 = a[i + 1]
	const p3 = a[Math.min(n - 1, i + 2)]
	return p1 + 0.5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0)))
}

// ------------------------------------------------------------------------------------------------ errors and suggestions
/** A plan that names what the run does not have (an item, a moment, a bounce), or asks what the engine cannot do. `nearest`: the digest's ids
 *  closest to what was asked, for the director's repair. */
export class PlanError extends Error {
	constructor(message, info = {}) {
		super(message)
		this.name = "PlanError"
		Object.assign(this, info)
	}
}
function editDistance(a, b) {
	const m = a.length
	const n = b.length
	if (!m || !n) return m + n
	let prev = Array.from({ length: n + 1 }, (_, j) => j)
	for (let i = 1; i <= m; i++) {
		const cur = [i]
		for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
		prev = cur
	}
	return prev[n]
}
function nearestIds(want, ids, n = 5) {
	const w = String(want)
	const head = w.split(":")[0]
	return [...new Set(ids)]
		.map((id) => [id, editDistance(w, id) - (id.split(":")[0] === head ? 2 : 0)])
		.sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1))
		.slice(0, n)
		.map((x) => x[0])
}

// ------------------------------------------------------------------------------------------------ the world: what a plan can name
/** What a plan can name, from one run or one run per lane (the lesson compositor films each lane apart).
 *    run      {doc, track, summary?, resolved?} (an /api/simulate answer, or the view's run.sim)
 *    runs     {lane id: {sim | run | doc+track, scene?, boxes?, recog?, hints?}} instead, one per lane
 *    scene    the scene JSON (better words and goals for the recognizer; sceneFromSim(run) without it)
 *    catalog, registry, hints   the recognizer's (web/export/subjects.js); registry defaults to the page's or node's physics modules
 *    boxes    (solid id) -> the drawn model's box: {x0, x1, y0, y1, z0, z1} in the solid's own frame (a mover), {round: R, z0, z1}, or {world:
 *             [x0, x1, y0, y1, z0, z1]} (a still thing); or an object of them. The view hands its models' boxes in; without one a solid's
 *             physics outline times its depth stands in.
 *    environment  a module's world for the run (space: {room: false, table: false}); autoPlan then keeps the scene's own look
 *  -> {runs: Map(lane -> run), single, main}. */
export function makeWorld(input = {}) {
	const catalog = input.catalog ?? { types: [] }
	const registry = input.registry ?? registryOf(globalThis[Symbol.for("sandbox.plugins")] ?? null)
	const list = []
	if (input.runs && typeof input.runs === "object") for (const [lane, v] of Object.entries(input.runs)) list.push([lane, v ?? {}])
	else list.push(["", { sim: input.run ?? input.sim, scene: input.scene, boxes: input.boxes, recog: input.recog, hints: input.hints, environment: input.environment }])
	const runs = new Map()
	for (const [lane, v] of list) {
		const sim = v.sim ?? v.run ?? (v.doc && v.track ? v : null)
		if (!sim || !sim.doc || !sim.track || !Array.isArray(sim.track.frames) || !sim.track.frames.length) throw new PlanError(`makeWorld: ${lane ? `lane ${lane}'s run` : "the run"} has no doc and track`)
		runs.set(lane, makeRun(lane, { sim, scene: v.scene, boxes: v.boxes, recog: v.recog, hints: v.hints ?? input.hints ?? {}, catalog, registry, environment: v.environment ?? input.environment ?? null }))
	}
	const single = runs.size === 1 && runs.has("")
	return { version: VERSION, runs, single, main: single ? runs.get("") : [...runs.values()][0] }
}

/** A solid's outline in its own frame when the view hands no model box in: a polygon's own corners, a ball's circle (12 points), a slab's
 *  rectangle (wider by its taper), at its front and back faces. */
const CIRCLE = Array.from({ length: 12 }, (_, i) => [Math.cos((i * Math.PI) / 6), Math.sin((i * Math.PI) / 6)])
function outlineBox(s) {
	const b = s.body ?? {}
	if (b.kind === "ball") {
		const hz = (s.depth3d ?? 2 * b.radius) / 2
		return { kind: "poly", pts: CIRCLE.map(([c, n]) => [b.radius * c, b.radius * n]), z0: -hz, z1: hz }
	}
	const hz = (b.depth ?? s.depth3d ?? 0.05) / 2
	if (b.kind === "polygon" && Array.isArray(b.points) && b.points.length) return { kind: "poly", pts: b.points.map((q) => [q.x, q.y]), z0: -hz, z1: hz }
	const hw = ((b.width ?? 0.05) / 2) * Math.max(1, b.taper ?? 1)
	const hh = (b.height ?? 0.05) / 2
	return { kind: "poly", pts: [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]], z0: -hz, z1: hz }
}
/** A model box the view measured: {x0, x1, y0, y1, z0, z1} in the solid's own frame, {round: R, z0, z1}, or {world: [x0, x1, y0, y1, z0, z1]}. */
function normBox(m) {
	if (!m || typeof m !== "object") return null
	const fin = (...v) => v.every((x) => Number.isFinite(x))
	if (Array.isArray(m.world) && m.world.length === 6 && fin(...m.world)) return { kind: "world", w: m.world.slice() }
	if (fin(m.round, m.z0, m.z1)) return { kind: "poly", pts: CIRCLE.map(([c, n]) => [m.round * c, m.round * n]), z0: m.z0, z1: m.z1 }
	if (fin(m.x0, m.x1, m.y0, m.y1, m.z0, m.z1)) return { kind: "poly", pts: [[m.x0, m.y0], [m.x1, m.y0], [m.x1, m.y1], [m.x0, m.y1]], z0: m.z0, z1: m.z1 }
	return null
}
const stateAt = (track, item, key, t) => {
	const v = track?.state?.[item]?.[key]
	if (!Array.isArray(v) || !v.length) return null
	const f = track.frames
	const i = frameIndex(track, t)
	const j = Math.min(i + 1, f.length - 1)
	const a = v[i] ?? v[v.length - 1]
	const b = v[j] ?? a
	const span = f[j].t - f[i].t
	const u = span > 0 ? clamp((t - f[i].t) / span, 0, 1) : 0
	return typeof a === "number" && typeof b === "number" ? a + (b - a) * u : a
}

/** One run as a plan reads it: its things (posed at any moment, as boxes), its moments by id, its readings, contacts, events and beams. */
function makeRun(key, o) {
	const sim = o.sim
	const doc = sim.doc
	const track = completeTrack(sim.track)
	const frames = track.frames
	const dur = Math.max(0, Number(doc.seconds ?? frames[frames.length - 1].t) || 0)
	const scene = o.scene ?? sceneFromSim(sim)
	const recog = o.recog ?? recognize({ scene, run: sim, catalog: o.catalog, registry: o.registry, hints: o.hints ?? {} })
	const solidById = new Map(doc.solids.map((s) => [s.id, s]))
	const solidsOf = new Map() // item -> its drawn solids
	for (const s of doc.solids) {
		if (typeof s.item !== "string" || s.hidden_3d) continue
		if (!solidsOf.has(s.item)) solidsOf.set(s.item, [])
		solidsOf.get(s.item).push(s)
	}
	const itemOfSolid = (sid) => solidById.get(sid)?.item ?? null
	const itemIds = () => [...solidsOf.keys()]
	// a solid's placement at t (linear between the engine's samples, its scale with it: track.js placementsAt, for one solid)
	const poseOf = (sid, t) => {
		const i = frameIndex(track, t)
		const a = frames[i].placements[sid]
		if (!a) {
			const s = solidById.get(sid)
			return s ? { x: s.at.x, y: s.at.y, angle: s.angle ?? 0, scale: 1 } : null
		}
		const j = Math.min(i + 1, frames.length - 1)
		const b = frames[j].placements[sid] ?? a
		const span = frames[j].t - frames[i].t
		const u = span > 0 ? clamp((t - frames[i].t) / span, 0, 1) : 0
		const s0 = a.scale ?? 1
		const s1 = b.scale ?? s0
		return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, angle: a.angle + (b.angle - a.angle) * u, scale: s0 + (s1 - s0) * u }
	}
	const boxCache = new Map()
	const outlineCache = new Map()
	const outlineOf = (s) => {
		let b = outlineCache.get(s.id)
		if (!b) outlineCache.set(s.id, (b = outlineBox(s)))
		return b
	}
	const boxOf = (s) => {
		let b = boxCache.get(s.id)
		if (b) return b
		const m = typeof o.boxes === "function" ? o.boxes(s.id) : o.boxes && typeof o.boxes === "object" ? o.boxes[s.id] : null
		b = normBox(m) ?? outlineBox(s)
		boxCache.set(s.id, b)
		return b
	}
	/** a solid's box corners at t, pushed onto out ([x, y, z] each); nothing for a body a module has shrunk away (scale 0). outline: its physics
	 *  outline, whatever the drawn model (a lane's metre cards stand above the floor its marks lie on) */
	const solidPts = (s, t, out, outline = false) => {
		const b = outline ? outlineOf(s) : boxOf(s)
		if (b.kind === "world") {
			const w = b.w
			for (let k = 0; k < 8; k++) out.push([k & 1 ? w[1] : w[0], k & 2 ? w[3] : w[2], k & 4 ? w[5] : w[4]])
			return out
		}
		const q = poseOf(s.id, t)
		if (!q) return out
		const k = q.scale
		if (!(k > 0.001)) return out
		const cs = Math.cos(q.angle)
		const sn = Math.sin(q.angle)
		for (const [x, y] of b.pts) {
			const lx = x * k
			const ly = y * k
			const X = q.x + lx * cs - ly * sn
			const Y = q.y + lx * sn + ly * cs
			out.push([X, Y, b.z0 * k], [X, Y, b.z1 * k])
		}
		return out
	}
	const partOf = (s) => s.part ?? (s.id.includes("/") ? s.id.slice(s.id.indexOf("/") + 1) : null)
	/** an item's (or one part's) box corners at t: [] when it has no drawn body then */
	const itemPts = (id, part, t, outline = false) => {
		const out = []
		for (const s of solidsOf.get(id) ?? []) if (!part || s.id === `${id}/${part}` || partOf(s) === part) solidPts(s, t, out, outline)
		return out
	}
	const partsOf = (id) => [...new Set((solidsOf.get(id) ?? []).map(partOf).filter(Boolean))]
	const dynamicOf = (id) => (solidsOf.get(id) ?? []).filter((s) => s.kind === "dynamic")
	const centreAt = (id, t, sols) => {
		const out = []
		for (const s of sols ?? solidsOf.get(id) ?? []) solidPts(s, t, out)
		return out.length ? centre3(out) : null
	}

	// ---- moments by id (section 3.4)
	const M = new Map()
	const WHAT = new Map()
	const put = (id, t, what) => {
		if (M.has(id) || !Number.isFinite(t)) return
		M.set(id, t)
		if (what) WHAT.set(id, what)
	}
	const counts = new Map()
	const putN = (base, t, what) => {
		const n = (counts.get(base) ?? 0) + 1
		counts.set(base, n)
		put(n === 1 ? base : `${base}#${n}`, t, what)
	}
	const tRel = Number(doc.release?.at ?? scene?.release ?? 0) || 0
	put("start", 0, "the run begins")
	put("release", tRel, "held things are let go")
	put("pause:setup", 0, "where the lesson asks about the setup")
	const cues = []
	for (const m of recog.moments ?? []) {
		if (m.kind === "result") put("result", m.t, "what the video shows is decided")
		else if (m.kind === "pause" && (m.where === "setup" || m.where === "result")) put(`pause:${m.where}`, m.t, "where the lesson pauses")
		else if ((m.kind === "start" || m.kind === "stop" || m.kind === "exit") && m.item) put(`${m.kind}:${m.item}`, m.t, m.kind === "start" ? m.what ?? "it begins to move" : m.kind === "stop" ? "it comes to rest" : "it is gone for good")
		else if (m.kind === "event") {
			if (m.landing) put(`landing:${m.landing}`, m.t, `${m.landing} lands`)
			if (m.apex && m.items?.[0]) putN(`apex:${m.items[0]}`, m.t, `the top of ${m.items[0]}'s bounce`)
		} else if (m.kind === "cue") cues.push(m)
	}
	cues.sort((a, b) => a.t - b.t)
	cues.forEach((c, i) => {
		put(`cue:${i + 1}`, c.t, "a caption cue")
		if (c.step !== undefined) put(`step:${c.step}`, c.t, `chain step ${c.step}`)
	})
	put("result", dur, "what the video shows is decided (the run's end: nothing settles before it)")
	put("pause:result", M.get("result"), "where the lesson asks about the result")
	put("end", dur, "the run ends")
	// every moving thing's own start and rest (the recognizer names only the primaries'): its centre leaves min(2 cm, a quarter of its size), and
	// from its rest on stays within min(5 mm, a tenth of its size) of where it ends
	const HZ = 120
	const nS = Math.floor(dur * HZ) + 1
	const series = new Map()
	const seriesOf = (id) => {
		if (series.has(id)) return series.get(id)
		const dyn = dynamicOf(id)
		let out = null
		if (dyn.length) {
			const cs = []
			for (let k = 0; k < nS; k++) cs.push(centreAt(id, Math.min(dur, k / HZ), dyn) ?? [0, 0, 0])
			out = cs
		}
		series.set(id, out)
		return out
	}
	const sizeOf = (id, t = 0) => {
		const P = itemPts(id, null, t)
		if (!P.length) return 0
		const [a, b] = boundsOf(P)
		return Math.max(b[0] - a[0], b[1] - a[1])
	}
	for (const id of itemIds()) {
		const cs = seriesOf(id)
		if (!cs) continue
		const size = sizeOf(id) || 0.05
		const go = Math.min(0.02, 0.25 * size)
		const rest = Math.min(0.005, 0.1 * size)
		const c0 = cs[0]
		let k0 = -1
		for (let k = 1; k < cs.length; k++)
			if (Math.hypot(cs[k][0] - c0[0], cs[k][1] - c0[1]) > go) {
				k0 = k
				break
			}
		if (k0 < 0) continue
		put(`start:${id}`, k0 / HZ, "it begins to move")
		const cf = cs[cs.length - 1]
		let k1 = cs.length - 1
		for (let k = cs.length - 1; k >= k0; k--) {
			if (Math.hypot(cs[k][0] - cf[0], cs[k][1] - cf[1]) > rest) break
			k1 = k
		}
		if (k1 < cs.length - 1 || Math.hypot(cs[cs.length - 2][0] - cf[0], cs[cs.length - 2][1] - cf[1]) < 1e-6) put(`stop:${id}`, k1 / HZ, "it comes to rest")
	}
	// contacts: every impact between two things, in time order, both ways round (#n: the nth between the same two)
	const contacts = []
	for (const im of track.impacts ?? []) {
		const a = itemOfSolid(im.a)
		const b = itemOfSolid(im.b)
		if (!a || !b || a === b || !(im.t >= 0)) continue
		contacts.push({ t: im.t, a, b, sa: im.a, sb: im.b, speed: im.speed ?? 0 })
	}
	contacts.sort((x, y) => x.t - y.t)
	for (const c of contacts) {
		putN(`contact:${c.a}+${c.b}`, c.t, `${c.a} meets ${c.b} at ${r3(c.speed)} m/s`)
		putN(`contact:${c.b}+${c.a}`, c.t, `${c.b} meets ${c.a}`)
	}
	// module happenings: event:<kind>:<item>
	const events = (track.events ?? []).filter((e) => e && Number.isFinite(e.t)).slice().sort((x, y) => x.t - y.t)
	for (const e of events) for (const it of e.items ?? []) putN(`event:${e.kind}:${it}`, e.t, e.text ?? e.kind)
	// a swinging or rocking thing turns back: turn:<item>#n (odd n on the far side, even n back where it started)
	for (const id of itemIds()) {
		const cs = seriesOf(id)
		if (!cs) continue
		const xs = cs.map((c) => c[0])
		const ys = cs.map((c) => c[1])
		const span = (a) => Math.max(...a) - Math.min(...a)
		const ax = span(xs) >= span(ys) ? xs : ys
		const sp = span(ax)
		if (!(sp > 0.01)) continue
		const dead = Math.max(0.001, 0.02 * sp)
		let dir = 0
		let ext = ax[0]
		let extK = 0
		let count = 0
		for (let k = 1; k < ax.length; k++) {
			const v = ax[k]
			if (dir >= 0 && v > ext) {
				ext = v
				extK = k
			}
			if (dir <= 0 && v < ext) {
				ext = v
				extK = k
			}
			if (dir === 0 && Math.abs(v - ax[0]) > dead) dir = Math.sign(v - ax[0])
			else if (dir !== 0 && (ext - v) * dir > dead) {
				count++
				put(count === 1 ? `turn:${id}` : `turn:${id}#${count}`, extK / HZ, count % 2 ? "it turns back on the far side" : "it turns back where it started")
				dir = -dir
				ext = v
				extK = k
			}
		}
	}
	// readings: an item's reading edges, on demand (reading:<item>.<key>:<edge>)
	const readingKeys = (item) => Object.keys(track.state?.[item] ?? {}).filter((k) => Array.isArray(track.state[item][k]) && track.state[item][k].some((v) => typeof v === "number"))
	const readT = (item, key, edge) => {
		const raw = track.state?.[item]?.[key]
		if (!Array.isArray(raw)) return undefined
		const vs = []
		for (let i = 0; i < raw.length; i++) if (typeof raw[i] === "number") vs.push({ t: frames[i]?.t ?? i / (track.fps || 120), v: raw[i] })
		if (!vs.length) return undefined
		const v0 = vs[0].v
		const vf = vs[vs.length - 1].v
		let lo = Infinity
		let hi = -Infinity
		for (const p of vs) {
			lo = Math.min(lo, p.v)
			hi = Math.max(hi, p.v)
		}
		const span = hi - lo || 1
		if (edge === "starts") return vs.find((p) => Math.abs(p.v - v0) > 0.05 * span)?.t
		if (edge === "settles") {
			for (let i = vs.length - 1; i >= 0; i--) if (Math.abs(vs[i].v - vf) > 0.02 * span) return vs[Math.min(vs.length - 1, i + 1)].t
			return 0
		}
		if (edge === "peak" || edge === "max") return vs.reduce((a, b) => (b.v > a.v ? b : a)).t
		if (edge === "min") return vs.reduce((a, b) => (b.v < a.v ? b : a)).t
		const m = /^crosses=(-?[0-9]+(?:\.[0-9]+)?)$/.exec(edge)
		if (m) {
			const x = Number(m[1])
			for (let i = 1; i < vs.length; i++) if ((vs[i - 1].v - x) * (vs[i].v - x) <= 0 && vs[i - 1].v !== vs[i].v) return vs[i].t
		}
		return undefined
	}
	// ---- beams: the optics tracer's own trace at a moment (web/models/mod-optics.js draws the same one)
	const rec = (doc.processes ?? []).find((p) => p && p.kind === "optics") ?? null
	let optics = null
	if (rec) {
		try {
			const sc = O.sceneFromRecord(rec, (id) => solidById.get(id))
			const watched = [...new Set([...sc.bodies.map((b) => b.id), ...sc.sources.map((s) => s.solid).filter((s) => s !== "")])]
			const hasLevels = sc.bodies.some((b) => b.level !== undefined)
			const levelAt = (i, t) => {
				const r = rec.sources[i]
				const s = sc.sources[i]
				const on = stateAt(track, s.item, "on", t)
				let v = on === null || on === undefined ? O.switchedOn(r, t) : on > 0.5 ? 1 : 0
				if (v > 0 && r.drive && typeof r.drive.item === "string") {
					const d = stateAt(track, r.drive.item, r.drive.key, t)
					v *= Math.max(0, typeof d === "number" ? d : 0) * (typeof r.drive.scale === "number" ? r.drive.scale : 1)
				}
				return v
			}
			optics = { sc, watched, hasLevels, levelAt, cache: new Map() }
			sc.sources.forEach((s, i) => {
				const id = s.item ?? rec.sources[i]?.item ?? rec.sources[i]?.id
				for (let k = 0; k <= Math.ceil(dur * HZ); k++) {
					const t = Math.min(dur, k / HZ)
					if (levelAt(i, t) > 0) {
						put(`beam:${id}:on`, t, `${id}'s light comes on`)
						break
					}
				}
			})
		} catch {
			optics = null
		}
	}
	const sourceIds = () => (optics ? optics.sc.sources.map((s, i) => s.item ?? rec.sources[i]?.item ?? rec.sources[i]?.id) : [])
	/** A light source's traced path at t: {pts (the start and each turn, then the end), ends (what each straight piece ends on), segments, bounces
	 *  [{p, item, n (the face normal, on the side the light comes from), din, dout, in, out (degrees from the normal)}]}, or null. */
	const beamAt = (src, t) => {
		if (!optics) return null
		const ck = `${src}|${t}`
		if (optics.cache.has(ck)) return optics.cache.get(ck)
		const { sc, watched, hasLevels, levelAt } = optics
		const si = sourceIds().indexOf(src)
		if (si < 0) return null
		const poses = new Map()
		for (const id of watched) {
			const q = poseOf(id, t)
			if (q) poses.set(id, { x: q.x, y: q.y, angle: q.angle })
		}
		const levels = sc.sources.map((s, i) => levelAt(i, t))
		let res
		try {
			const read = hasLevels ? (item, k) => {
				const v = stateAt(track, item, k, t)
				return typeof v === "number" ? v : undefined
			} : null
			const bodies = read ? O.withLevels(sc.bodies, read) : sc.bodies
			res = O.trace({ bodies, sources: sc.sources, pose: (id) => poses.get(id), level: (s) => levels[sc.sources.indexOf(s)] ?? 0, segments: true })
		} catch {
			res = null
		}
		let out = null
		const segs = (res?.segments ?? []).filter((s) => s.src === si)
		if (segs.length) {
			const w = (sg) => (sg.p ?? []).reduce((a, b) => a + b, 0)
			const roots = [...new Set(segs.map((s) => s.root))].sort((a, b) => a - b)
			const list = segs.filter((s) => s.root === roots[Math.floor(roots.length / 2)])
			const kmin = Math.min(...list.map((x) => x.key))
			let cur = list.filter((s) => s.key === kmin).sort((a, b) => w(b) - w(a))[0]
			const chain = []
			const used = new Set()
			while (cur && chain.length < 13) {
				chain.push(cur)
				used.add(cur)
				const c = cur
				cur = list.filter((s) => !used.has(s) && Math.hypot(s.x0 - c.x1, s.y0 - c.y1) < 1e-6).sort((a, b) => w(b) - w(a))[0]
			}
			const itemOfBody = (i) => (i >= 0 ? (sc.bodies[i]?.item ?? null) : null)
			const clip = (s) => {
				const L = Math.hypot(s.x1 - s.x0, s.y1 - s.y0)
				const k = L > 3 ? 3 / L : 1
				return [s.x0 + (s.x1 - s.x0) * k, s.y0 + (s.y1 - s.y0) * k, 0]
			}
			const pts = [[chain[0].x0, chain[0].y0, 0], ...chain.map(clip)]
			const bounces = []
			for (let i = 0; i + 1 < chain.length; i++) {
				const a = chain[i]
				const b = chain[i + 1]
				const dep = (res.deposits ?? []).find((d) => d.src === si && Math.hypot(d.x - a.x1, d.y - a.y1) < 1e-6)
				const ain = [a.x1 - a.x0, a.y1 - a.y0]
				const aout = [b.x1 - b.x0, b.y1 - b.y0]
				const la = Math.hypot(ain[0], ain[1]) || 1
				const lb = Math.hypot(aout[0], aout[1]) || 1
				let n = dep && Number.isFinite(dep.nx) ? [dep.nx, dep.ny] : null
				if (n && n[0] * -ain[0] + n[1] * -ain[1] < 0) n = [-n[0], -n[1]] // (on the side the light comes from)
				const ang = (v, l) => (n ? Math.acos(Math.min(1, Math.abs((v[0] * n[0] + v[1] * n[1]) / l))) / D2R : null)
				bounces.push({ p: [a.x1, a.y1, 0], item: itemOfBody(a.end), n, din: [ain[0] / la, ain[1] / la], dout: [aout[0] / lb, aout[1] / lb], in: ang(ain, la), out: ang(aout, lb) })
			}
			out = { pts, ends: chain.map((s) => itemOfBody(s.end)), segments: chain.map((s, i) => ({ n: i + 1, length: Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]), end: itemOfBody(s.end) })), bounces, level: levels[si] }
		}
		if (optics.cache.size > 4000) optics.cache.clear()
		optics.cache.set(ck, out)
		return out
	}
	const marks = new Map((doc.processes ?? []).filter((p) => p && p.kind === "measure-mark").map((p) => [p.item, p]))
	const tableTop = (() => {
		const t = doc.solids.find((s) => s.itemType === "table" && s.kind === "static")
		return t ? t.at.y + (t.body?.height ?? 0) / 2 : 0
	})()
	/** A moment's run time, by digest id (section 3.4): undefined when the run has none. Reading edges are computed on demand. */
	const momentOf = (id) => {
		if (M.has(id)) return M.get(id)
		const rm = /^reading:([^.]+)\.([A-Za-z0-9_]+):(.+)$/.exec(id)
		if (rm) return readT(rm[1], rm[2], rm[3])
		return undefined
	}
	return { key, sim, doc, track, scene, recog, dur, tRel, tableTop, environment: o.environment, solidById, solidsOf, itemIds, itemOfSolid, poseOf, itemPts, partsOf, dynamicOf, centreAt, seriesOf, sizeOf, M, WHAT, momentOf, contacts, events, readingKeys, readT, beamAt, sourceIds, marks, stateAt: (item, k, t) => stateAt(track, item, k, t), HZ }
}

// ------------------------------------------------------------------------------------------------ a plan's view of the world: lanes, moments, targets
/** The plan's lanes bound to the world: each lane's run, the shift from lane 0 (one run: the median shift of the paired start boxes), which lane an
 *  item belongs to, and the resolvers every part of the compiler uses (moments, target points, paths). */
function scopeOf(world, lanesSpec) {
	const lanes = lanesSpec?.list?.length ? lanesSpec.list.map((l) => ({ ...l, cast: l.cast ?? {} })) : null
	const one = world.single ? world.main : null
	if (!one && !lanes) throw new PlanError("a plan of one run per lane needs its lanes (plan.lanes.list, each lane's id the run's)")
	if (!one) for (const l of lanes) if (!world.runs.has(l.id)) throw new PlanError(`lane ${l.id} has no run (the runs are ${[...world.runs.keys()].join(", ")})`)
	const runOf = (lane) => (one ? one : world.runs.get(lane ?? lanes[0].id) ?? world.main)
	const laneOf = new Map()
	if (lanes) for (const ln of lanes) for (const v of Object.values(ln.cast)) for (const id of [].concat(v)) if (!laneOf.has(id)) laneOf.set(id, ln.id)
	const isRole = (name) => !!lanes && lanes.some((l) => l.cast[name] !== undefined)
	const roleIds = (role, lane) => {
		const ln = lanes?.find((l) => l.id === lane) ?? lanes?.[0]
		return [].concat(ln?.cast[role] ?? [])
	}
	const ptsOfIds = (R, ids, t) => ids.flatMap((id) => R.itemPts(id, null, t))
	// a thing no lane's cast names that stands on or in one lane's things, far from the others' (the salt on the salted cube), is that lane's
	// too: drawn, framed, marked and measured in its own band only, never copied into the other bands at their offset (where it is not)
	if (lanes && one) {
		const scenery = new Set((one.recog?.scenery ?? []).map((x) => x.item))
		const boxes = lanes
			.map((ln) => {
				const P = ptsOfIds(one, Object.values(ln.cast).flatMap((v) => [].concat(v)), 0)
				return P.length ? { id: ln.id, x0: Math.min(...P.map((X) => X[0])), x1: Math.max(...P.map((X) => X[0])), y0: Math.min(...P.map((X) => X[1])), y1: Math.max(...P.map((X) => X[1])) } : null
			})
			.filter(Boolean)
		for (const id of one.itemIds()) {
			if (laneOf.has(id) || scenery.has(id) || boxes.length < 2) continue
			const P = one.itemPts(id, null, 0)
			if (!P.length) continue
			const c = centre3(P)
			const ds = boxes.map((b) => ({ id: b.id, d: Math.hypot(Math.max(b.x0 - c[0], 0, c[0] - b.x1), Math.max(b.y0 - c[1], 0, c[1] - b.y1)) })).sort((a, b) => a.d - b.d)
			if (ds[0].d <= 0.05 && ds[1].d > 0.15) laneOf.set(id, ds[0].id)
		}
	}
	const offsets = new Map()
	if (lanes) {
		const L0 = lanes[0]
		for (const ln of lanes) {
			if (Array.isArray(ln.offset)) offsets.set(ln.id, [Number(ln.offset[0]) || 0, Number(ln.offset[1]) || 0, 0])
			else if (!one || ln === L0) offsets.set(ln.id, [0, 0, 0])
			else {
				const shifts = []
				for (const role of Object.keys(L0.cast)) {
					const pa = ptsOfIds(one, [].concat(L0.cast[role]), 0)
					const pb = ptsOfIds(one, [].concat(ln.cast[role] ?? []), 0)
					if (!pa.length || !pb.length) continue
					shifts.push(sub(centre3(pb), centre3(pa)))
				}
				shifts.sort((p, q) => p[0] + p[1] - (q[0] + q[1]))
				const m = shifts[Math.floor(shifts.length / 2)] ?? [0, 0, 0]
				offsets.set(ln.id, [m[0], m[1], 0])
			}
		}
	}
	/** a lane's shift for one shot: lined up on one role's copies (`align`), or the plan's. One run: the shift between the role's two copies in the
	 *  scene. One run per lane: the shift between the role's copies in their own runs at the start, so each band pans to its own copy at one scale
	 *  (a fan 10 cm from its boat and one 80 cm from its boat, each at the left of its band; the clay on a low car and on a high one, each centred) */
	const offsetFor = (laneId, role) => {
		if (!lanes) return [0, 0, 0]
		if (!role) return offsets.get(laneId) ?? [0, 0, 0]
		const Ra = one ?? runOf(lanes[0].id)
		const Rb = one ?? runOf(laneId)
		const pa = ptsOfIds(Ra, roleIds(role, lanes[0].id), 0)
		const pb = ptsOfIds(Rb, roleIds(role, laneId), 0)
		if (!pa.length || !pb.length) return offsets.get(laneId) ?? [0, 0, 0]
		const d = sub(centre3(pb), centre3(pa))
		return [d[0], d[1], 0]
	}
	const allRuns = () => (one ? [one] : lanes.map((l) => runOf(l.id)))
	const momentIds = () => [...new Set(allRuns().flatMap((R) => [...R.M.keys()]))]
	/** a moment's run time (DIRECTOR.md 4.1): with plus; `@lane` for one lane's run; a role's start/stop with no lane: the latest of the lanes */
	const momentT = (m, lane = null) => {
		if (m === undefined || m === null) return undefined
		const id = typeof m === "string" ? m : m.at
		const plus = typeof m === "object" ? Number(m.plus ?? 0) : 0
		if (typeof id !== "string") throw new PlanError(`a moment must be an id or {at, plus} (got ${JSON.stringify(m)})`)
		let base = id
		let ln = lane
		const at = /^(.*)@([A-Za-z0-9_-]+)$/.exec(id)
		if (at && lanes?.some((l) => l.id === at[2])) {
			base = at[1]
			ln = at[2]
		}
		if (/^t=/.test(base)) {
			const v = Number(base.slice(2))
			if (!Number.isFinite(v)) throw new PlanError(`moment ${id} is not a time`)
			return v + plus
		}
		const rs = ln !== null && ln !== undefined && lanes ? [runOf(ln)] : allRuns()
		const lanesFor = ln !== null && ln !== undefined && lanes ? [ln] : (lanes ?? []).map((l) => l.id)
		const vals = []
		for (const R of rs) {
			let t = R.momentOf(base)
			// a role in a moment id: each lane's own item (start:car, stop:car, contact:pad+egg)
			if (t === undefined && lanes) {
				const parts = /^(start|stop|exit|landing|apex|turn):([^#]+)(#[0-9]+)?$/.exec(base) ?? /^(contact):([^+]+)\+([^#]+)(#[0-9]+)?$/.exec(base) ?? /^(event:[A-Za-z0-9_:-]+?):([^:#]+)(#[0-9]+)?$/.exec(base)
				if (parts) {
					const ts = []
					for (const lid of lanesFor) {
						const swap = (name) => (isRole(name) ? roleIds(name, lid) : [name])
						if (parts[1] === "contact") {
							for (const a of swap(parts[2])) for (const b of swap(parts[3])) {
								const v = R.momentOf(`contact:${a}+${b}${parts[4] ?? ""}`)
								if (v !== undefined) ts.push(v)
							}
						} else for (const a of swap(parts[2])) {
							const v = R.momentOf(`${parts[1]}:${a}${parts[3] ?? ""}`)
							if (v !== undefined) ts.push(v)
						}
					}
					if (ts.length) t = Math.max(...ts)
				}
			}
			if (t !== undefined) vals.push(t)
		}
		if (!vals.length) throw new PlanError(`moment ${id} is not in the run`, { id, nearest: nearestIds(base, momentIds()) })
		return Math.max(...vals) + plus
	}
	const hasPart = (R, id, part) => R.partsOf(id).includes(part)
	const itemsOf = (R) => R.itemIds()
	const needItem = (R, id, what = "item") => {
		if (!R.solidsOf.has(id)) throw new PlanError(`${what} ${id} is not in the scene (or has no drawn body)`, { id, nearest: nearestIds(id, itemsOf(R)) })
	}
	/** The bounce's region: the turn and both rays 12 cm either way (plus the pad), and the normal. */
	const bounceRegion = (B, pad) => {
		const L = 0.12 + (pad ?? 0)
		const P = [B.p, sub(B.p, [B.din[0] * L, B.din[1] * L, 0]), add(B.p, [B.dout[0] * L, B.dout[1] * L, 0])]
		if (B.n) P.push(add(B.p, [B.n[0] * L * 0.8, B.n[1] * L * 0.8, 0]))
		return P
	}
	const beamIndex = (b, s, def) => {
		if (s === undefined) return def
		if (s === "source") return 0
		if (s === "end") return b.pts.length - 1
		const mb = /^bounce:([0-9]+)$/.exec(s)
		if (mb) {
			const n = Number(mb[1])
			if (n < 1 || n > b.bounces.length) throw new PlanError(`the beam makes ${b.bounces.length} bounce(s), not bounce ${n}`)
			return n
		}
		const mh = /^hit:(.+)$/.exec(s)
		if (mh) {
			const k = b.ends.indexOf(mh[1])
			if (k < 0) throw new PlanError(`the beam never lands on ${mh[1]} (its pieces end on ${b.ends.map((e) => e ?? "nothing").join(", ")})`)
			return k + 1
		}
		return def
	}
	const beamOf = (R, tg, t) => {
		const ids = R.sourceIds()
		if (!ids.includes(tg.beam)) throw new PlanError(`${tg.beam} is not a light source of the run`, { id: tg.beam, nearest: nearestIds(tg.beam, ids) })
		const b = R.beamAt(tg.beam, t)
		if (!b || !b.pts.length) throw new PlanError(`${tg.beam} draws no light at ${r3(t)} s`)
		return b
	}
	/** A target's points at run time t, for one lane (or the plan's one run): [x, y, z] box corners (section 3.5). */
	const pts = (tg, lane, t) => {
		if (!tg || typeof tg !== "object") throw new PlanError(`a target must be an object (got ${JSON.stringify(tg)})`)
		const R = runOf(lane)
		if (tg.when !== undefined) t = momentT(tg.when, lane)
		const pad = (P) => {
			if (!tg.pad || tg.beam !== undefined || !P.length) return P
			const k = tg.pad
			return P.flatMap((X) => [[X[0] + k, X[1] + k, X[2]], [X[0] - k, X[1] - k, X[2]], [X[0] + k, X[1] - k, X[2]], [X[0] - k, X[1] + k, X[2]]])
		}
		const idsOfRole = (role) => {
			const ids = roleIds(role, tg.lane ?? lane)
			if (!ids.length && !isRole(role)) throw new PlanError(`role ${role} is not in the plan's lanes`, { id: role, nearest: nearestIds(role, (lanes ?? []).flatMap((l) => Object.keys(l.cast))) })
			return ids
		}
		const nameIds = (g) => (isRole(g) ? idsOfRole(g) : [g])
		if (tg.item !== undefined) {
			needItem(R, tg.item)
			let part = tg.part
			if (tg.reading && !part && hasPart(R, tg.item, "face")) part = "face"
			if (part && !hasPart(R, tg.item, part)) throw new PlanError(`${tg.item} has no part ${part}`, { id: part, nearest: R.partsOf(tg.item) })
			if (tg.event) t = momentT(`event:${tg.event}:${tg.item}`, lane)
			if (tg.reading && !R.readingKeys(tg.item).includes(tg.reading)) throw new PlanError(`${tg.item} has no reading ${tg.reading}`, { id: tg.reading, nearest: R.readingKeys(tg.item) })
			return pad(R.itemPts(tg.item, part, t))
		}
		if (tg.items) {
			for (const id of tg.items) needItem(R, id)
			return pad(tg.items.flatMap((id) => R.itemPts(id, null, t)))
		}
		if (tg.role) return pad(idsOfRole(tg.role).flatMap((id) => R.itemPts(id, null, t)))
		if (tg.point) return pad([[tg.point[0], tg.point[1], tg.point[2] ?? 0]])
		if (tg.region) {
			const [x0, x1, y0, y1] = tg.region
			return [[x0, y0, 0], [x1, y0, 0], [x0, y1, 0], [x1, y1, 0]]
		}
		if (tg.contact) {
			const [a, b] = tg.contact
			const A = nameIds(a)
			const B = nameIds(b)
			const list = R.contacts.filter((c) => (A.includes(c.a) && B.includes(c.b)) || (A.includes(c.b) && B.includes(c.a)))
			const c = list[(tg.nth ?? 1) - 1]
			if (!c) throw new PlanError(`${a} and ${b} touch ${list.length} time(s) in the run, not ${tg.nth ?? 1}`, { nearest: nearestIds(`contact:${a}+${b}`, momentIds().filter((m) => m.startsWith("contact:"))) })
			const p = contactPoint(R, c)
			const k = 0.03 + (tg.pad ?? 0)
			return [[p[0] - k, p[1] - k, 0], [p[0] + k, p[1] + k, 0]]
		}
		if (tg.beam !== undefined) {
			const b = beamOf(R, tg, t)
			if (tg.bounce) {
				const B = b.bounces[tg.bounce - 1]
				if (!B) throw new PlanError(`${tg.beam}'s light makes ${b.bounces.length} bounce(s), not bounce ${tg.bounce}`)
				return bounceRegion(B, tg.pad)
			}
			if (tg.segment) {
				if (tg.segment > b.pts.length - 1) throw new PlanError(`${tg.beam}'s light has ${b.pts.length - 1} straight piece(s), not ${tg.segment}`)
				return b.pts.slice(tg.segment - 1, tg.segment + 1)
			}
			if (tg.from !== undefined || tg.to !== undefined) {
				const i0 = beamIndex(b, typeof tg.from === "string" ? tg.from : undefined, 0)
				const i1 = beamIndex(b, typeof tg.to === "string" ? tg.to : undefined, b.pts.length - 1)
				return b.pts.slice(Math.min(i0, i1), Math.max(i0, i1) + 1)
			}
			return b.pts
		}
		if (tg.trail !== undefined) {
			needItem(R, tg.trail)
			const a = momentT(tg.from, lane)
			const z = momentT(tg.to, lane)
			const out = []
			for (let k = 0; k <= 40; k++) out.push(...R.itemPts(tg.trail, tg.part, a + ((z - a) * k) / 40))
			return out
		}
		if (tg.through) return tg.through.flatMap((x) => pts(x, lane, t) ?? [])
		if (tg.gap) return tg.gap.flatMap((g) => nameIds(g).flatMap((id) => (needItem(R, id), R.itemPts(id, null, t))))
		if (tg.mark !== undefined) {
			const id = isRole(tg.mark) ? idsOfRole(tg.mark)[0] : tg.mark
			const mk = R.marks.get(id)
			if (!mk) throw new PlanError(`${tg.mark} has no metre marks (a lane or a ruler's: measure-mark)`, { id: tg.mark, nearest: [...R.marks.keys()] })
			// (on the lane's floor, as its physics has it: its drawn metre cards stand above)
			const base = R.itemPts(id, R.partsOf(id).includes("floor") ? "floor" : null, t, true)
			if (!base.length) throw new PlanError(`${tg.mark} has no body to put its marks on`)
			const [, b] = boundsOf(base)
			const x = mk.zero !== undefined ? mk.zero + (tg.m ?? 0) : (mk.x ?? 0)
			const top = b[1]
			const k = tg.pad ?? 0 // (a mark is a place along its lane: its pad widens that stretch of the lane)
			return [[x - 0.05 - k, top, 0], [x + 0.05 + k, top + 0.05, 0]]
		}
		if (tg.path !== undefined) throw new PlanError(`no module publishes the route it draws for ${tg.path} yet (a hose's, a wire's): travel through its parts instead ({through: [...]})`)
		throw new PlanError(`target ${JSON.stringify(tg)} is not one the engine knows (item, items, role, point, region, contact, beam, trail, through, gap, mark)`)
	}
	/** A path's polyline (a travel's route) at run time t. */
	const path = (tg, lane, t) => {
		const R = runOf(lane)
		if (tg.beam !== undefined) {
			const b = beamOf(R, tg, t)
			const i0 = beamIndex(b, typeof tg.from === "string" ? tg.from : undefined, 0)
			const i1 = beamIndex(b, typeof tg.to === "string" ? tg.to : undefined, b.pts.length - 1)
			const P = b.pts.slice(Math.min(i0, i1), Math.max(i0, i1) + 1)
			return i0 <= i1 ? P : P.reverse()
		}
		if (tg.through) return tg.through.map((x) => centre3(pts(x, lane, t)))
		if (tg.trail !== undefined) {
			const a = momentT(tg.from, lane)
			const z = momentT(tg.to, lane)
			const out = []
			for (let k = 0; k <= 40; k++) {
				const P = R.itemPts(tg.trail, tg.part, a + ((z - a) * k) / 40)
				if (P.length) out.push(centre3(P))
			}
			return out
		}
		if (tg.path !== undefined) return pts(tg, lane, t)
		throw new PlanError(`a travel's path must be a beam stretch, a trail or a through list (got ${JSON.stringify(tg)})`)
	}
	return { world, lanes, one, runOf, laneOf, isRole, roleIds, offsets, offsetFor, momentT, momentIds, pts, path, allRuns }
}
/** Where two things touch at an impact: each one's box point nearest the other's centre, halfway between. */
function contactPoint(R, c) {
	const boxOfSolid = (sid) => {
		const s = R.solidById.get(sid)
		if (!s || s.hidden_3d || typeof s.item !== "string") return null
		const part = s.part ?? (s.id.includes("/") ? s.id.slice(s.id.indexOf("/") + 1) : null)
		const P = R.itemPts(s.item, part, c.t)
		return P.length ? boundsOf(P) : null
	}
	const qa = R.poseOf(c.sa, c.t)
	const qb = R.poseOf(c.sb, c.t)
	const ca = qa ? [qa.x, qa.y] : [0, 0]
	const cb = qb ? [qb.x, qb.y] : ca
	const near = (box, toward, own) => (box ? [clamp(toward[0], box[0][0], box[1][0]), clamp(toward[1], box[0][1], box[1][1])] : own)
	const pa = near(boxOfSolid(c.sa), cb, ca)
	const pb = near(boxOfSolid(c.sb), ca, cb)
	return [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, 0]
}

// ------------------------------------------------------------------------------------------------ the picture: layouts and bands
/** The bands of a picture: one, or one per lane (rows: one above the other; columns: side by side), as whole-pixel rectangles [x, y, w, h]
 *  from the picture's top left. */
function bandsOf(layout, arrange, lanes, W, H) {
	if (layout !== "split" || !lanes) return [{ lane: null, rect: [0, 0, W, H] }]
	const n = lanes.length
	return lanes.map((l, i) => {
		if (arrange === "columns") {
			const x0 = Math.round((i * W) / n)
			const x1 = Math.round(((i + 1) * W) / n)
			return { lane: l.id, rect: [x0, 0, x1 - x0, H] }
		}
		const y0 = Math.round((i * H) / n)
		const y1 = Math.round(((i + 1) * H) / n)
		return { lane: l.id, rect: [0, y0, W, y1 - y0] }
	})
}
const lookOf = (plan, sh) => {
	const L = { ...(plan.look ?? {}), ...(sh?.look ?? {}) }
	const backdrop = L.backdrop ?? DEFAULT_LOOK.backdrop
	const ground = L.ground ?? (backdrop === "studio" ? "sweep" : "table")
	return { backdrop, tone: L.tone ?? DEFAULT_LOOK.tone, ground, light: L.light ?? (backdrop === "studio" ? "subject" : "room"), depth: L.depth ?? "none", vignette: Number(L.vignette ?? 0) || 0, labels: L.labels ?? "scene" }
}

// ------------------------------------------------------------------------------------------------ compile
/** Compile a shot plan into a film (DIRECTOR.md section 4): the shots' clocks, one camera pose per frame per band, the look, and the marks.
 *  opts: {width = 1920, height = 1080, fps (the plan's output.fps, else 60), kind ("director-plan")}. Throws a PlanError for what the run
 *  does not have. The film is plain data (JSON.stringify keeps all of it); measure(film) reads what compile kept beside it. */
export function compile(plan, world, opts = {}) {
	if (!plan || typeof plan !== "object" || !Array.isArray(plan.shots) || !plan.shots.length) throw new PlanError("a plan needs shots")
	const W = Math.round(Number(opts.width ?? 1920))
	const H = Math.round(Number(opts.height ?? 1080))
	const fps = Number(opts.fps ?? plan.output?.fps ?? 60)
	if (!(W >= 2 && H >= 2 && fps > 0)) throw new PlanError(`compile: a picture of ${W} x ${H} at ${fps} fps`)
	const S = scopeOf(world, plan.lanes)
	const lanes = S.lanes
	const dur = Math.max(...S.allRuns().map((R) => R.dur))
	const shots = []
	const frames = []
	const meta = []
	const notes = []
	let prev = null
	for (let k = 0; k < plan.shots.length; k++) {
		const sh = plan.shots[k]
		const where = `shot ${sh.id ?? k + 1}`
		const ctx = (fn) => {
			try {
				return fn()
			} catch (e) {
				if (e instanceof PlanError) {
					e.message = `${where}: ${e.message}`
					e.shot = sh.id
				}
				throw e
			}
		}
		const layout = sh.layout ?? (lanes ? "split" : "single")
		if (layout !== "single" && !lanes) throw new PlanError(`${where}: layout ${layout} needs the plan's lanes`)
		const arrange = sh.arrange ?? plan.lanes?.arrange ?? "rows"
		const bands = bandsOf(layout, arrange, lanes, W, H)
		const asp = bands[0].rect[2] / bands[0].rect[3]
		const shNotes = []
		// the clock: run time t = min(to, from + rate u) for u video seconds into the shot, then held; a freeze holds one moment
		let t0
		let t1
		let rate
		const run = sh.run ?? {}
		const holdAfter = Number(run.hold_after ?? 0) || 0
		if (run.freeze !== undefined) {
			t0 = t1 = ctx(() => S.momentT(run.freeze, null))
			rate = 0
		} else {
			t0 = ctx(() => S.momentT(run.from, null))
			t1 = ctx(() => S.momentT(run.to, null))
			rate = Number(run.rate ?? 1)
			if (!(rate > 0)) throw new PlanError(`${where}: a run's rate must be above 0`)
		}
		if (t1 < t0 - 1e-9) throw new PlanError(`${where}: the run plays from ${r3(t0)} s to ${r3(t1)} s, backwards`)
		// (a window that reaches past the run's ends plays its whole length on the video clock, the run held at its first or last moment)
		if (t0 < -1e-9 || t1 > dur + 1e-6) shNotes.push(`the run window ${r3(t0)}..${r3(t1)} s reaches past the run (0..${r3(dur)} s): the run is held at its end there`)
		const runAt = (u) => clamp(rate === 0 ? t0 : Math.min(t1, t0 + rate * u), 0, dur)
		// points of a target over the shot, in lane 0's frame when split (every lane's copy of a role shifted back by its lane's offset; a thing
		// one lane's cast names, shifted back by its own lane's; any other target is in lane 0's frame already)
		const lanePts = (tg, t) => {
			if (layout === "split") {
				const own = tg.item !== undefined ? S.laneOf.get(tg.item) : undefined
				if (own !== undefined && S.one) return (S.pts(tg, null, t) ?? []).map((X) => sub(X, S.offsetFor(own, sh.align)))
				const perLane = tg.role !== undefined || tg.gap !== undefined || tg.mark !== undefined || tg.contact !== undefined
				const out = []
				for (const ln of lanes) {
					if (tg.lane && tg.lane !== ln.id) continue
					// (one run: a role's copies shifted back by their lane's offset; one run per lane aligned on a role: every lane's points shifted back by
					// its lane's pan, so lane 0's frame holds them all)
					const off = S.one || sh.align ? S.offsetFor(ln.id, sh.align) : [0, 0, 0]
					const P = perLane ? S.pts(tg, ln.id, t) : S.one ? (ln === lanes[0] ? S.pts(tg, null, t) : null) : S.pts(tg, ln.id, t)
					if (P) for (const X of P) out.push(perLane || !S.one ? sub(X, off) : X)
				}
				return out
			}
			if (layout === "together" && lanes) {
				if (tg.role !== undefined && !tg.lane) return lanes.flatMap((ln) => S.pts({ ...tg, lane: ln.id }, S.one ? null : ln.id, t) ?? [])
				return S.pts(tg, S.one ? null : lanes[0].id, t) ?? []
			}
			return S.pts(tg, S.one ? null : (lanes?.[0]?.id ?? null), t) ?? []
		}
		const need = (tg, P, what) => {
			if (!P.length) throw new PlanError(`${where}: ${what} ${JSON.stringify(tg)} shows nothing then (nothing drawn, or every lane's copy left out)`)
			return P
		}
		const tA = clamp(t0, 0, dur)
		const tB = clamp(t1, 0, dur)
		const windowPts = (tg) => {
			if (rate === 0 || tg.when !== undefined) return lanePts(tg, tA)
			const out = []
			for (let j = 0; j <= 24; j++) out.push(...lanePts(tg, tA + ((tB - tA) * j) / 24))
			return out
		}
		const view = viewOf(sh.view, sh.lens)
		// a travel's route (in lane 0's frame), and its length
		let travelPath = null
		let travelLen = 0
		if (sh.move === "travel") {
			if (!sh.travel?.path) throw new PlanError(`${where}: a travel needs travel.path`)
			travelPath = ctx(() => S.path(sh.travel.path, S.one ? null : (lanes?.[0]?.id ?? null), tA))
			if (layout === "split" && S.one && lanes) {
				const tp = sh.travel.path
				const own = tp.item !== undefined ? S.laneOf.get(tp.item) : undefined
				if (own !== undefined) travelPath = travelPath.map((X) => sub(X, S.offsetFor(own, sh.align)))
			}
			if (travelPath.length < 2) throw new PlanError(`${where}: the travel's path has ${travelPath.length} point(s)`)
			for (let j = 1; j < travelPath.length; j++) travelLen += len3(sub(travelPath[j], travelPath[j - 1]))
		}
		// the shot's video length, snapped to whole frames
		const dwell = Number(sh.travel?.dwell ?? 0) || 0
		let T
		if (rate === 0) {
			const pace = sh.travel?.pace
			const travelT = travelPath ? (pace?.seconds ?? (pace?.speed ? travelLen / (pace.speed * 0.8) : 2)) + (run.seconds === undefined ? dwell * (travelPath.length - 1) : 0) : 2
			T = (run.seconds ?? travelT) + holdAfter
		} else T = (t1 - t0) / rate + holdAfter
		const n = Math.max(1, Math.round(T * fps))
		const Tn = n / fps
		const playT = rate === 0 ? 0 : (t1 - t0) / rate
		const moveT = Math.max(1 / fps, Tn - holdAfter) // (the moving part of a shot: its run's play, or a freeze's seconds; the camera rests after)
		const sameFrame = !!prev && prev.layout === layout && (layout !== "split" || prev.arrange === arrange)
		const startFrom = sh.in === "continue" && sameFrame ? prev.pose : null
		let poseAt
		let perLane = null
		const dwellAt = []
		if (sh.move === "hold") {
			poseAt = ctx(() => {
				const sameView = (p) => Math.abs(p.yaw - view.yaw) < 1e-9 && Math.abs(p.pitch - view.pitch) < 1e-9 && Math.abs(p.hfov - hfovOf(view.lens)) < 1e-9
				const keepLast = startFrom && !sh.frame && !sh.place && ((!sh.view && !sh.lens) || sameView(startFrom))
				const p = keepLast ? startFrom : solveFraming({ subj: need(sh.subject, windowPts(sh.subject), "the subject"), keep: (sh.keep ?? []).flatMap(windowPts), frame: sh.frame, place: sh.place, view, asp })
				return () => p
			})
		} else if (sh.move === "push" || sh.move === "pull" || sh.move === "arc") {
			if (!sh.end) throw new PlanError(`${where}: a ${sh.move} needs end (the framing it ends on)`)
			poseAt = ctx(() => {
				const at0 = (tg) => (tg.when !== undefined ? windowPts(tg) : lanePts(tg, tA))
				const at1 = (tg) => (tg.when !== undefined ? windowPts(tg) : lanePts(tg, tB))
				const a = startFrom ?? solveFraming({ subj: need(sh.subject, at0(sh.subject), "the subject"), keep: (sh.keep ?? []).flatMap(at0), frame: sh.frame, place: sh.place, view, asp })
				const e = sh.end
				const eSubj = need(e.subject ?? sh.subject, at1(e.subject ?? sh.subject), "the end's subject")
				const eKeep = (e.keep ?? sh.keep ?? []).flatMap(at1)
				const b = solveFraming({ subj: eSubj, keep: eKeep, frame: e.frame ?? sh.frame, place: e.place ?? sh.place, view: viewOf(e.view ?? sh.view, e.lens ?? sh.lens), asp })
				const ease = easeOf(sh.ease)
				const span = clamp(Number(sh.move_seconds ?? moveT), 1 / fps, Tn)
				return sh.move === "arc" ? (u) => lerpPose(a, b, ease(u / span)) : (u) => dollyPose(a, b, ease(u / span))
			})
		} else if (sh.move === "follow") {
			const r = ctx(() => followPoses({ sh, S, lanes, layout, asp, view, t0: tA, t1: Math.max(tA, tB), rate, holdAfter, playT, Tn, dur, lanePts, need }))
			poseAt = r.poseAt
			perLane = r.perLane
		} else if (sh.move === "travel") {
			const fr = sh.frame?.width ? sh.frame : { width: 0.4 }
			const first = solveFraming({ subj: [travelPath[0]], frame: fr, place: "centre", view, asp })
			const cum = [0]
			for (let j = 1; j < travelPath.length; j++) cum.push(cum[j - 1] + len3(sub(travelPath[j], travelPath[j - 1])))
			const along = (s) => {
				s = clamp(s, 0, travelLen)
				for (let j = travelPath.length - 2; j >= 0; j--)
					if (s >= cum[j]) {
						const l = cum[j + 1] - cum[j] || 1
						return lerp3(travelPath[j], travelPath[j + 1], (s - cum[j]) / l)
					}
				return travelPath[0]
			}
			const A = 0.2 // trapezoid pace: 20 % to speed up, 20 % to slow down
			const prof = (x) => {
				x = clamp(x, 0, 1)
				if (x < A) return (x * x) / (2 * A * (1 - A))
				if (x > 1 - A) return 1 - ((1 - x) * (1 - x)) / (2 * A * (1 - A))
				return (x - A / 2) / (1 - A)
			}
			if (dwell > 0 && travelPath.length > 2) {
				// leg by leg: each leg eased from rest to rest, its time in proportion to its length, then a still dwell where it arrives
				const legs = travelPath.length - 1
				const legsT = Math.max(1 / fps, moveT - dwell * legs)
				const lens = []
				for (let j = 0; j < legs; j++) lens.push(len3(sub(travelPath[j + 1], travelPath[j])) || 1e-6)
				const tot = lens.reduce((x, y) => x + y, 0)
				let acc = 0
				for (let j = 0; j < legs; j++) {
					acc += (legsT * lens[j]) / tot
					dwellAt.push(acc + dwell / 2)
					acc += dwell
				}
				poseAt = (u) => {
					let rest = clamp(u, 0, moveT)
					for (let j = 0; j < legs; j++) {
						const lt = (legsT * lens[j]) / tot
						if (rest <= lt) return { ...first, L: lerp3(travelPath[j], travelPath[j + 1], smoother(rest / lt)) }
						rest -= lt
						if (rest <= dwell) return { ...first, L: travelPath[j + 1] }
						rest -= dwell
					}
					return { ...first, L: travelPath[legs] }
				}
			} else poseAt = (u) => ({ ...first, L: along(travelLen * prof(u / moveT)) })
			if (sh.travel?.reveal) shNotes.push("travel.reveal: the view draws the whole beam (a beam drawn only as far as the camera has gone is not built yet)")
		} else throw new PlanError(`${where}: move ${sh.move} is not one of hold, follow, travel, push, pull, arc`)
		// the join (section 3.7): a cut at once; continue from exactly where the last shot ended (a 0.5 s glide when this shot's own start differs);
		// {ease: s}: a glide of s seconds from the last shot's end into this shot's moving framing
		let inJ = sh.in ?? "cut"
		if (inJ !== "cut" && prev && !sameFrame) {
			shNotes.push(`${typeof inJ === "string" ? inJ : "a glide"} across a change of layout (${prev.layout}${prev.layout === "split" ? ` ${prev.arrange}` : ""} -> ${layout}${layout === "split" ? ` ${arrange}` : ""}): filmed as a cut`)
			inJ = "cut"
		}
		const join = inJ === "cut" || !prev ? null : inJ === "continue" ? 0.5 : Number(inJ.ease) || 0.5
		const from = prev?.pose
		const p0 = poseAt(0)
		const glide = join && differs(p0, from)
		if (glide && inJ === "continue" && sh.move !== "push" && sh.move !== "pull" && sh.move !== "arc") shNotes.push(`continue: the shot's own start differs from where the last one ended; it glides in over ${join} s`)
		const final = glide ? (u) => lerpPose(from, poseAt(u), smoother(u / join)) : poseAt
		// bands: each lane's camera is the shot's pose shifted by its lane's offset (one run), the very pose (one run per lane), or its own (per_lane)
		const offs = bands.map((b) => (layout === "split" && (S.one || sh.align) ? S.offsetFor(b.lane, sh.align) : [0, 0, 0]))
		const bandPose = (p, bi, u) => {
			if (perLane) return perLane(bi, u, p)
			const o = offs[bi]
			return o[0] || o[1] ? { ...p, L: add(p.L, o) } : p
		}
		// insets (section 4.9): a corner picture with its own still camera, one per band when the subject is a role of a split shot, else one
		const insets = []
		if (sh.inset) {
			ctx(() => {
				const iv = viewOf(sh.inset.view ?? "eye", undefined)
				const share = clamp(Number(sh.inset.size ?? 0.28), 0.15, 0.4)
				const corner = sh.inset.corner ?? "top-right"
				const per = layout === "split" && sh.inset.subject.role !== undefined ? bands.map((_, i) => i) : [-1]
				for (const bi of per) {
					const host = bi >= 0 ? bands[bi].rect : [0, 0, W, H]
					const ih = Math.max(8, Math.round(share * host[3]))
					const iw = Math.max(8, Math.round((ih * W) / H))
					const m = Math.round(0.03 * Math.min(host[2], host[3]))
					const x = corner.endsWith("left") ? host[0] + m : host[0] + host[2] - iw - m
					const y = corner.startsWith("top") ? host[1] + m : host[1] + host[3] - ih - m
					const lane = bi >= 0 ? bands[bi].lane : null
					const tg = lane ? { ...sh.inset.subject, lane } : sh.inset.subject
					const P = []
					if (rate === 0 || tg.when !== undefined) P.push(...S.pts(tg, S.one ? lane : (lane ?? lanes?.[0]?.id ?? null), tA))
					else for (let j = 0; j <= 12; j++) P.push(...(S.pts(tg, S.one ? lane : (lane ?? lanes?.[0]?.id ?? null), tA + ((tB - tA) * j) / 12) ?? []))
					need(tg, P, "the inset's subject")
					insets.push({ lane, rect: [x, y, iw, ih], inset: true, pose: solveFraming({ subj: P, frame: { fit: "snug" }, view: iv, asp: iw / ih }) })
				}
			})
		}
		const allBands = [...bands.map((b) => ({ lane: b.lane, rect: b.rect })), ...insets.map((b) => ({ lane: b.lane, rect: b.rect, inset: true }))]
		// the other lanes' things are left out of each band (one run: a band shows only its own lane's copies)
		const hide = allBands.map((b) => (layout === "split" && S.one && b.lane ? [...S.laneOf].filter(([, l]) => l !== b.lane).map(([id]) => id) : []))
		const i0 = frames.length
		for (let i = 0; i < n; i++) {
			const u = i / fps
			const p = final(u)
			const t = runAt(u)
			const b = bands.map((_, bi) => poseArr(bandPose(p, bi, u)))
			for (const ins of insets) b.push(poseArr(ins.pose))
			frames.push({ s: k, t, b })
		}
		const endPose = final(Tn)
		const look = lookOf(plan, sh)
		shots.push({ id: sh.id, beat: sh.beat ?? null, move: sh.move, layout, arrange, i0, n, tau0: i0 / fps, T: Tn, t0, t1, tMax: dur, rate, holdAfter: Math.max(0, Tn - playT), playT, label: sh.label ?? null, look, bands: allBands, hide, in: typeof inJ === "string" ? inJ : { ease: join }, notes: shNotes })
		meta.push({ sh, layout, arrange, asp, bands: allBands, nBands: bands.length, offs, view, travelLen, dwellAt, lanePts, windowPts, runAt, perLaneFollow: !!perLane })
		if (shNotes.length) notes.push(...shNotes.map((s) => `${sh.id}: ${s}`))
		prev = { pose: endPose, layout, arrange }
	}
	const film = {
		version: VERSION,
		kind: opts.kind ?? "director-plan",
		W,
		H,
		fps,
		duration: frames.length / fps,
		frameCount: frames.length,
		runSeconds: dur,
		lanes: lanes ? lanes.map((l) => ({ id: l.id, label: l.label ?? l.id })) : null,
		perLaneRuns: !S.one,
		shots,
		frames,
		marks: {},
		notes,
	}
	Object.defineProperty(film, "_ctx", { value: { S, plan, world, meta }, enumerable: false })
	film.marks = marksOf(film)
	return film
}

/** A follow (section 4.4): the subject's box centre per 60 Hz sample over the shot and a second of the run beyond each end (the run is known, so
 *  the damping has no edge), clamped at stop_at before damping, damped with no lag (omega 3), the horizon steady for axis x, room ahead faded
 *  in and out with the speed; the distance the frame's, backed off where a kept thing would leave (held 0.6 s either side and eased). */
function followPoses({ sh, S, lanes, layout, asp, view, t0, t1, rate, holdAfter, playT, Tn, dur, lanePts, need }) {
	const HZ = 60
	const n = Math.max(2, Math.ceil(Tn * HZ) + 1)
	const P = HZ
	const N = n + 2 * P
	const padAt = (u) => (u < 0 ? clamp(t0 + Math.max(rate, 0.0) * u, 0, dur) : u <= playT ? (rate === 0 ? t0 : Math.min(t1, t0 + rate * u)) : holdAfter > 1e-9 ? t1 : clamp(t1 + rate * (u - playT), 0, dur))
	const axis = sh.follow?.axis ?? "x"
	const lead = Number(sh.follow?.lead ?? 0.2)
	const series = (subjOf) => {
		const px = new Float64Array(N)
		const py = new Float64Array(N)
		const pz = new Float64Array(N)
		const cs = []
		for (let k = 0; k < N; k++) {
			const Pk = subjOf(padAt((k - P) / HZ))
			cs.push(Pk.length ? centre3(Pk) : null)
		}
		// (a sample where the subject has no drawn body, shrunk away or not there yet, takes the nearest one that has)
		const firstK = cs.findIndex(Boolean)
		if (firstK < 0) throw new PlanError(`the follow's subject ${JSON.stringify(sh.subject)} shows nothing during the shot`)
		let last = cs[firstK]
		for (let k = 0; k < N; k++) {
			const c = cs[k] ?? last
			last = c
			px[k] = c[0]
			py[k] = c[1]
			pz[k] = c[2]
		}
		if (sh.follow?.stop_at) {
			const c = centre3(need(sh.follow.stop_at, lanePts(sh.follow.stop_at, t1), "follow.stop_at"))
			const dx = Math.sign(px[N - 1] - px[0]) || 1
			const dy = Math.sign(py[N - 1] - py[0]) || 1
			for (let k = 0; k < N; k++) {
				if (axis !== "y") px[k] = dx > 0 ? Math.min(px[k], c[0]) : Math.max(px[k], c[0])
				if (axis !== "x") py[k] = dy > 0 ? Math.min(py[k], c[1]) : Math.max(py[k], c[1])
			}
		}
		return { sx: dampSeries(px, 3, HZ).slice(P, P + n), sy: dampSeries(py, 3, HZ).slice(P, P + n), sz: pz.slice(P, P + n) }
	}
	const main = series((t) => lanePts(sh.subject, t))
	const perLaneOn = !!sh.follow?.per_lane && layout === "split" && !!lanes
	const firstSubj = perLaneOn && sh.subject.role !== undefined ? S.pts({ ...sh.subject, lane: lanes[0].id }, S.one ? null : lanes[0].id, t0) ?? [] : lanePts(sh.subject, t0)
	need(sh.subject, firstSubj, "the follow's subject")
	const first = solveFraming({ subj: firstSubj, frame: sh.frame ?? { size: 0.3 }, place: "centre", view, asp })
	const d0 = first.d
	const hfov = first.hfov
	const tanH = Math.tan(hfov / 2)
	const tanV = tanH / asp
	const B = basis(view.yaw, view.pitch)
	const [px, py] = placeOf(sh.place)
	const lookAt = (s, k, d) => {
		// (the speed over the samples either side, one-sided at the shot's ends: a centred estimate there read half the speed, and the room ahead
		// jumped in the shot's first frames)
		const ka = Math.max(0, k - 3)
		const kb = Math.min(n - 1, k + 3)
		const vx = kb > ka ? ((s.sx[kb] - s.sx[ka]) * HZ) / (kb - ka) : 0
		const vy = kb > ka ? ((s.sy[kb] - s.sy[ka]) * HZ) / (kb - ka) : 0
		const dirx = axis === "y" ? 0 : clamp(vx / 0.3, -1, 1)
		const diry = axis === "x" ? 0 : clamp(vy / 0.3, -1, 1)
		const c = [axis === "y" ? s.sx[0] : s.sx[k], axis === "x" ? s.sy[0] : s.sy[k], s.sz[k]]
		return add(c, add(mul(B.r, (dirx * lead - px) * d * tanH), mul(B.up, (diry * lead - py) * d * tanV)))
	}
	// keep: per sample the distance that holds every kept thing (never closer than the frame asks), as an envelope 0.6 s wide
	const ld = new Float64Array(n)
	const kept = sh.keep ?? []
	for (let k = 0; k < n; k++) {
		if (!kept.length) {
			ld[k] = Math.log(d0)
			continue
		}
		const t = padAt(k / HZ)
		const kp = kept.flatMap((tg) => lanePts(tg, t))
		ld[k] = Math.log(kp.length ? bisectD((dd) => insideAll({ L: lookAt(main, k, dd), d: dd, yaw: view.yaw, pitch: view.pitch, hfov }, asp, kp, 0.05), d0, 600) : d0)
	}
	const lds = kept.length ? envelope(ld, 36) : ld
	const at = (s, u) => {
		const f = clamp(u * HZ, 0, n - 1)
		const d = Math.exp(curveAt(lds, f))
		const k = Math.round(f)
		const c = lookAt(s, k, d)
		// (the centre between samples: Catmull-Rom on the damped series, with the lead of the nearest sample)
		const cx = axis === "y" ? s.sx[0] : curveAt(s.sx, f)
		const cy = axis === "x" ? s.sy[0] : curveAt(s.sy, f)
		const base = [axis === "y" ? s.sx[0] : s.sx[k], axis === "x" ? s.sy[0] : s.sy[k], s.sz[k]]
		return { L: [c[0] + cx - base[0], c[1] + cy - base[1], c[2] + curveAt(s.sz, f) - base[2]], d, yaw: view.yaw, pitch: view.pitch, hfov }
	}
	let perLane = null
	if (perLaneOn) {
		const own = lanes.map((ln) => series((t) => S.pts(sh.subject.role !== undefined ? { ...sh.subject, lane: ln.id } : sh.subject, S.one ? null : ln.id, t) ?? []))
		perLane = (bi, u) => at(own[bi] ?? own[0], u)
	}
	return { poseAt: (u) => at(main, u), perLane }
}

// ------------------------------------------------------------------------------------------------ reading a film
/** The film at video time tau: its frame (fractional between two frames of the same shot), shot, run time, and each band's rectangle and pose
 *  (interpolated within the shot, never across a cut). */
export function frameAt(film, tau) {
	const N = film.frameCount
	const f = clamp((Number.isFinite(tau) ? tau : 0) * film.fps, 0, N - 1)
	const i = Math.min(N - 1, Math.floor(f + 1e-9))
	const s = film.frames[i].s
	const sh = film.shots[s]
	const last = sh.i0 + sh.n - 1
	const frac = Math.max(0, f - i)
	const j = Math.min(i + 1, last)
	const a = film.frames[i]
	const b = film.frames[j]
	const w = j > i ? frac : 0
	const u = (i - sh.i0 + frac) / film.fps
	const bands = sh.bands.map((bd, k) => {
		const pa = arrPose(a.b[k])
		return { lane: bd.lane, rect: bd.rect, inset: !!bd.inset, pose: w ? lerpPose(pa, arrPose(b.b[k]), w) : pa }
	})
	return { f, frame: i, shot: s, u, t: clockAt(sh, u), bands, look: sh.look, label: sh.label, hide: sh.hide }
}
const clockAt = (sh, u) => clamp(sh.rate === 0 ? sh.t0 : Math.min(sh.t1, sh.t0 + sh.rate * u), 0, sh.tMax ?? Infinity)
/** The run time the film shows at video time tau. */
export const runTimeAt = (film, tau) => frameAt(film, tau).t
/** The video times at which run time t plays at its own pace (inside a play stretch; never in a freeze or a hold after it): an impact's sound
 *  goes there (a slowed one too; a stretch played twice sounds twice). */
export function videoTimesOf(film, t) {
	const out = []
	for (const sh of film.shots) {
		if (sh.rate === 0 || t < sh.t0 - 1e-9 || t > sh.t1 + 1e-9) continue
		const u = (t - sh.t0) / sh.rate
		if (u <= sh.playT + 1e-9 && u < sh.T) out.push(sh.tau0 + u)
	}
	return out
}
/** Impacts ({t, ...} at run times) at the video times they are seen (videoTimesOf), each with the rate its stretch plays at. */
export function retime(film, impacts) {
	const out = []
	for (const im of impacts ?? []) for (const tau of videoTimesOf(film, im.t)) out.push({ ...im, t: tau, runT: im.t, rate: film.shots[shotIndexAt(film, tau)].rate })
	return out.sort((a, b) => a.t - b.t)
}
const shotIndexAt = (film, tau) => film.frames[Math.min(film.frameCount - 1, Math.max(0, Math.floor(tau * film.fps + 1e-9)))].s
/** A pose as a camera: position, look point, up, horizontal field (radians) and distance. */
export function cameraOf(p) {
	const B = basis(p.yaw, p.pitch)
	return { position: add(p.L, mul(B.u, p.d)), target: p.L.slice(), up: [0, 1, 0], hfov: p.hfov, d: p.d, yaw: p.yaw, pitch: p.pitch }
}
/** A square-on pose (yaw 0) as the scene's fixed-camera spec {x0, x1, y, pitch, hfov} (degrees: machines/mod_staging.py settings.camera; the
 *  compositor's camera.py camera_pose projects it exactly); null for a turned pose. */
export function specOf(p) {
	if (Math.abs(p.yaw) > 1e-9) return null
	const B = basis(0, p.pitch)
	const C = add(p.L, mul(B.u, p.d))
	if (!(B.u[2] > 1e-9)) return null
	const k = C[2] / B.u[2] // (the same camera, its look point slid along the view to the machine plane z = 0)
	const L = sub(C, mul(B.u, k))
	const half = k * Math.cos(p.pitch) * Math.tan(p.hfov / 2)
	return { x0: L[0] - half, x1: L[0] + half, y: L[1], pitch: p.pitch / D2R, hfov: p.hfov / D2R }
}
/** A film from its JSON (a film made elsewhere: the compositor plans once and films each lane's run with it). Checked for shape. */
export function filmFromJSON(j) {
	const f = typeof j === "string" ? JSON.parse(j) : j
	if (!f || f.version !== VERSION || !Array.isArray(f.shots) || !Array.isArray(f.frames) || f.frames.length !== f.frameCount || !(f.fps > 0)) throw new PlanError("not a film (filming module version 1)")
	for (const fr of f.frames) if (!fr || !Number.isInteger(fr.s) || !f.shots[fr.s] || !Array.isArray(fr.b) || fr.b.length !== f.shots[fr.s].bands.length) throw new PlanError("a film frame does not match its shot's bands")
	return f
}

// ------------------------------------------------------------------------------------------------ the safety net (section 7.2)
/** Measure a compiled film: per shot the measured facts a director checks (each kept thing's closest margin, each hero's and must-see's size at
 *  the key moment, the beam's width in pixels, the picture's speeds, the cut's change) and the safety net's checks, each with its numbers. */
export function measure(film) {
	const ctx = film._ctx
	if (!ctx) throw new PlanError("measure(film): a film from compile() (its plan and world are kept beside it)")
	const { S, plan, meta } = ctx
	const { W, H, fps } = film
	const report = { ok: true, duration: r3(film.duration), frames: film.frameCount, shots: [], checks: [] }
	const fail = (shot, check, why) => report.checks.push({ shot, check, ok: false, why })
	const pass = (shot, check, why) => report.checks.push({ shot, check, ok: true, why })
	const isRole = (g) => S.isRole(g)
	const heroesOf = (tg) => {
		if (!tg) return []
		const w = tg.when !== undefined ? { when: tg.when } : {}
		if (tg.item !== undefined) return tg.reading ? [] : [tg]
		if (tg.items) return tg.items.map((id) => ({ item: id, ...w }))
		if (tg.role !== undefined) return [tg]
		if (tg.gap) return tg.gap.map((g) => (isRole(g) ? { role: g, ...w } : { item: g, ...w }))
		return []
	}
	let lastFrame = null
	let prevPose = null
	let prevLayout = null
	for (let k = 0; k < film.shots.length; k++) {
		const fs = film.shots[k]
		const m = meta[k]
		const sh = m.sh
		const nb = m.nBands
		/** a target's points in one band's world: a thing one lane names, in its own band only; a role, that lane's copy; anything else, the
		 *  place in this band that matches lane 0's (shifted by this band's offset) */
		const tgPts = (tg, bi, t) => {
			const lane = fs.bands[bi].lane
			if (fs.layout === "split" && S.lanes) {
				const own = tg.item !== undefined ? S.laneOf.get(tg.item) : undefined
				if (own !== undefined && S.one) return own === lane ? (S.pts(tg, null, t) ?? []) : []
				if (tg.role !== undefined || tg.gap !== undefined || tg.mark !== undefined || tg.contact !== undefined) return S.pts(tg.role !== undefined && !tg.lane ? { ...tg, lane } : tg, S.one ? lane : lane, t) ?? []
				if (S.one) return (S.pts(tg, null, t) ?? []).map((X) => add(X, m.offs[bi] ?? [0, 0, 0]))
				return S.pts(tg, lane, t) ?? []
			}
			if (fs.layout === "together" && S.lanes && tg.role !== undefined && !tg.lane) return S.lanes.flatMap((ln) => S.pts({ ...tg, lane: ln.id }, S.one ? null : ln.id, t) ?? [])
			return S.pts(tg, S.one ? null : (S.lanes?.[0]?.id ?? null), t) ?? []
		}
		const aspOf = (bi) => fs.bands[bi].rect[2] / fs.bands[bi].rect[3]
		const F = film.frames.slice(fs.i0, fs.i0 + fs.n)
		const thing = (tg) => tg && (tg.item !== undefined || tg.items || tg.role !== undefined)
		const kept = [...(sh.keep ?? []), ...((sh.move === "hold" || sh.move === "follow") && thing(sh.subject) ? [sh.subject] : [])]
		// (a push, pull or arc keeps its own keep at its start and its end's keep at its end, and in between what both keep: a push from a whole
		// setup in to a detail of it lets the rest leave the picture as it goes, as the compiler frames it)
		const endKeep = sh.end?.keep ?? sh.keep ?? []
		const sameTg = (a, b) => JSON.stringify(a) === JSON.stringify(b)
		const travelling = sh.move === "push" || sh.move === "pull" || sh.move === "arc"
		const keptAt = (i, n) => (!travelling ? kept : i === 0 ? (sh.keep ?? []) : i === n - 1 ? endKeep : (sh.keep ?? []).filter((a) => endKeep.some((b) => sameTg(a, b))))
		let minKeep = Infinity
		let minKeepAt = null
		let peakPan = 0
		let peakSubj = 0
		let peakZoom = 0
		let peakYaw = 0
		let jump = 0
		let peakPanUnsteady = 0
		for (let i = 0; i < F.length; i++) {
			const fr = F[i]
			for (let bi = 0; bi < nb; bi++) {
				const pose = arrPose(fr.b[bi])
				for (const tg of keptAt(i, F.length)) {
					if (tg.lane && fs.bands[bi].lane && tg.lane !== fs.bands[bi].lane) continue
					const P = tgPts(tg, bi, fr.t)
					if (!P.length) continue
					const st = boxStats(projBox(pose, aspOf(bi), P))
					if (st.margin < minKeep) {
						minKeep = st.margin
						minKeepAt = r3(fs.tau0 + i / fps)
					}
				}
			}
			// motion: five probe points of the look plane, between this frame and the one before (inside the shot, or across a join that is not a cut)
			const prevFr = i > 0 ? F[i - 1] : fs.in !== "cut" ? lastFrame : null
			if (prevFr) {
				const a = arrPose(prevFr.b[0])
				const c = arrPose(fr.b[0])
				const asp = aspOf(0)
				const tanH = Math.tan(c.hfov / 2)
				const hw = 0.8 * c.d * tanH
				const hh = hw / asp
				const B = basis(c.yaw, c.pitch)
				const pa = projector(a, asp)
				const pc = projector(c, asp)
				let v = 0
				for (const [ox, oy] of [[0, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
					const X = add(c.L, add(mul(B.r, ox * hw), mul(B.up, oy * hh)))
					const qa = pa(X)
					const qc = pc(X)
					v = Math.max(v, Math.hypot(qc.x - qa.x, (qc.y - qa.y) / asp) / 2)
				}
				const wps = v * fps
				peakPan = Math.max(peakPan, wps)
				peakZoom = Math.max(peakZoom, Math.abs(Math.log(c.d / a.d)) * fps)
				peakYaw = Math.max(peakYaw, (Math.abs(c.yaw - a.yaw) / D2R) * fps)
				if (wps > NET.jumpWps) jump = Math.max(jump, wps)
				let sw = 0
				if (thing(sh.subject) || sh.subject?.beam !== undefined) {
					const P0 = tgPts(sh.subject, 0, prevFr.t)
					const P1 = tgPts(sh.subject, 0, fr.t)
					if (P0.length && P1.length) {
						const s0 = boxStats(projBox(a, asp, P0))
						const s1 = boxStats(projBox(c, asp, P1))
						sw = (Math.hypot(s1.cx - s0.cx, (s1.cy - s0.cy) / asp) / 2) * fps
						peakSubj = Math.max(peakSubj, sw)
					}
				}
				if (sw > NET.steadySubjectWps) peakPanUnsteady = Math.max(peakPanUnsteady, wps)
			}
		}
		lastFrame = F[F.length - 1]
		// the key moment
		const key = sh.audit?.key ?? "end"
		let kf = F.length - 1
		if (key === "start") kf = 0
		else if (key === "middle") kf = Math.floor(F.length / 2)
		else if (key !== "end") {
			const tk = S.momentT(key, null)
			let best = Infinity
			F.forEach((fr, i) => {
				if (Math.abs(fr.t - tk) < best) {
					best = Math.abs(fr.t - tk)
					kf = i
				}
			})
		}
		const KF = F[kf]
		const row = { id: sh.id, move: sh.move, layout: fs.layout, video: [r3(fs.tau0), r3(fs.tau0 + fs.T)], run: [r3(fs.t0), r3(fs.t1)], rate: fs.rate, key: r3(fs.tau0 + kf / fps), notes: fs.notes }
		const subjAtKey = key === "end" && sh.end?.subject ? sh.end.subject : sh.subject
		const sizes = []
		for (let bi = 0; bi < nb; bi++) {
			const P = tgPts(subjAtKey, bi, KF.t)
			if (!P.length) continue
			const s = boxStats(projBox(arrPose(KF.b[bi]), aspOf(bi), P))
			sizes.push({ lane: fs.bands[bi].lane, w: r3(s.w), h: r3(s.h), s: r3(s.s), margin: r3(s.margin), cx: r3(s.cx), cy: r3(s.cy) })
		}
		const beatKind = plan.story?.find((bt) => bt.id === sh.beat)?.kind ?? "action"
		const wholeShot = beatKind === "setup" || beatKind === "reveal"
		const heroFloor = wholeShot ? NET.detailS : NET.heroS
		/** a hero the recognizer ranks context (a plate, a tank, a board: what holds the subject), standing for the primaries on or in it at run time
		 *  t in band bi: a container is never the hero, what it holds is (a 4 cm ice cube on a 27 cm plate is measured as the cube) */
		const standIns = (tg, bi, t) => {
			const lane = fs.bands[bi].lane
			const R = S.one ? S.one : S.runOf(lane)
			const ids = tg.item !== undefined && !tg.part && !tg.reading ? [tg.item] : tg.role !== undefined ? S.roleIds(tg.role, tg.lane ?? lane) : null
			const prim = new Set(R?.recog?.primary ?? [])
			const ctxs = new Set(R?.recog?.context ?? [])
			if (!ids?.length || !ids.every((id) => ctxs.has(id) && !prim.has(id))) return [tg]
			const C = ids.flatMap((id) => R.itemPts(id, null, t))
			if (!C.length) return [tg]
			const [clo, chi] = boundsOf(C)
			const out = []
			for (const pid of prim) {
				if (ids.includes(pid) || !R.solidsOf.has(pid)) continue
				if (S.one && S.lanes && lane && S.laneOf.has(pid) && S.laneOf.get(pid) !== lane) continue
				const P = R.itemPts(pid, null, t)
				if (!P.length) continue
				const [lo, hi] = boundsOf(P)
				const ox = Math.min(hi[0], chi[0]) - Math.max(lo[0], clo[0])
				if (ox < 0.5 * (hi[0] - lo[0]) || lo[1] < clo[1] - 0.01 || lo[1] > chi[1] + 0.03) continue
				out.push({ item: pid })
			}
			return out.length ? out : [tg]
		}
		const heroRows = []
		for (const tg0 of heroesOf(subjAtKey))
			for (let bi = 0; bi < nb; bi++) {
				if (tg0.lane && fs.bands[bi].lane && tg0.lane !== fs.bands[bi].lane) continue
				for (const tg of standIns(tg0, bi, KF.t)) {
					const P = tgPts(tg, bi, KF.t)
					if (!P.length) continue
					const asp = aspOf(bi)
					const s = boxStats(projBox(arrPose(KF.b[bi]), asp, P))
					heroRows.push({ what: JSON.stringify(tg), ...(tg !== tg0 ? { for: JSON.stringify(tg0) } : {}), lane: fs.bands[bi].lane, s: r3(s.s), w: r3(s.w), h: r3(s.h), margin: r3(s.margin), flat: s.h < 0.3 * s.w * asp || s.w * asp < 0.3 * s.h })
				}
			}
		const must = []
		const small = typeof sh.audit?.small_because === "string" && sh.audit.small_because.length >= 12
		const look = (list, isDetail) => {
			for (const tg0 of list ?? [])
				for (let bi = 0; bi < nb; bi++) {
					if (tg0.lane && fs.bands[bi].lane && tg0.lane !== fs.bands[bi].lane) continue
					for (const tg of isDetail ? [tg0] : standIns(tg0, bi, KF.t)) {
					const P = tgPts(tg, bi, KF.t)
					if (!P.length) continue
					const s = boxStats(projBox(arrPose(KF.b[bi]), aspOf(bi), P))
					const kindFloor = isDetail || tg.part || tg.reading || !thing(tg) ? NET.detailS : heroFloor
					// min_size raises a must-see thing's floor; with small_because it sets the floor of must-see things and details alike (never under the
					// schema's 0.03); small_because alone lowers a must-see hero to the detail floor
					const floor = sh.audit?.min_size !== undefined ? (small ? sh.audit.min_size : isDetail ? kindFloor : Math.max(sh.audit.min_size, kindFloor)) : small && !isDetail ? Math.min(kindFloor, NET.detailS) : kindFloor
					must.push({ what: JSON.stringify(tg), lane: fs.bands[bi].lane, s: r3(s.s), h: r3(s.h), margin: r3(s.margin), floor, detail: !!isDetail })
					}
				}
		}
		look(sh.audit?.must_see, false)
		look(sh.audit?.details, true)
		// an instrument's face whose reading the shot is about: its height in the picture (FRAMING_RULE gate 5)
		const faces = []
		for (const tg of [sh.subject, ...(sh.keep ?? [])].filter((x) => x?.reading))
			for (let bi = 0; bi < nb; bi++) {
				const P = tgPts(tg, bi, KF.t)
				if (P.length) faces.push({ what: JSON.stringify(tg), lane: fs.bands[bi].lane, h: r3(boxStats(projBox(arrPose(KF.b[bi]), aspOf(bi), P)).h) })
			}
		// the beam, when the shot is about one: the core's and the glow's width in pixels at its nearest drawn point inside the picture
		let beam = null
		const beamTg = [subjAtKey, sh.subject, ...(sh.keep ?? [])].find((tg) => tg?.beam !== undefined)
		if (beamTg) {
			const pose = arrPose(KF.b[0])
			const asp = aspOf(0)
			const bandW = fs.bands[0].rect[2]
			let P = []
			try {
				P = S.pts({ beam: beamTg.beam }, S.one ? null : (S.lanes?.[0]?.id ?? null), KF.t) ?? []
			} catch {}
			const pr = projector(pose, asp)
			const tanH = Math.tan(pose.hfov / 2)
			let ppm = 0
			for (let j = 0; j + 1 < P.length; j++)
				for (let q = 0; q <= 20; q++) {
					const X = lerp3(P[j], P[j + 1], q / 20)
					const p = pr(X)
					if (p.z > 0.02 && Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1) ppm = Math.max(ppm, bandW / 2 / (p.z * tanH))
				}
			beam = { corePx: r3(0.0016 * ppm), haloPx: r3(0.007 * ppm) }
		}
		// the same role in every band at one scale (lane parity): each band's picture-widths per metre at its own copy of the subject, within 10 %
		// (things whose real sizes differ, 1 block against 3, then differ in the picture by exactly that, never by the camera)
		let parity = null
		if (fs.layout === "split" && subjAtKey?.role !== undefined && !subjAtKey.lane && nb > 1) {
			const ks = []
			for (let bi = 0; bi < nb; bi++) {
				const P = tgPts(subjAtKey, bi, KF.t)
				if (!P.length) continue
				const pose = arrPose(KF.b[bi])
				const z = projector(pose, aspOf(bi))(centre3(P)).z
				if (z > 1e-6) ks.push(1 / (2 * z * Math.tan(pose.hfov / 2)))
			}
			if (ks.length > 1) parity = r3(Math.max(...ks) / Math.min(...ks))
		}
		Object.assign(row, { size: sizes, heroes: heroRows, wholeShot, beatKind, must, faces, minKeep: minKeep === Infinity ? null : r3(minKeep), minKeepAt, peakPanWps: r3(peakPan), peakSubjectWps: r3(peakSubj), peakZoomPerS: r3(peakZoom), peakYawDegS: r3(peakYaw), beam, parity, travelM: m.travelLen ? r3(m.travelLen) : undefined })
		report.shots.push(row)
		// checks
		if (row.minKeep !== null) (row.minKeep >= NET.keepMargin ? pass : fail)(sh.id, "keep-in", `every kept thing at least ${NET.keepMargin} inside the edges at every frame (closest ${row.minKeep} at ${row.minKeepAt} s)`)
		if (sh.move === "follow") {
			const ok = row.peakPanWps <= NET.trackWps * 1.05 && peakPanUnsteady <= NET.followWps * 1.05
			;(ok ? pass : fail)(sh.id, "speed", `the background slides at most ${row.peakPanWps} widths/s (limit ${NET.trackWps} while the subject is steady in the picture), ${r3(peakPanUnsteady)} while the subject moves in it (limit ${NET.followWps})`)
		} else {
			const limit = sh.move === "travel" ? NET.followWps : NET.panWps
			;(row.peakPanWps <= limit * 1.05 ? pass : fail)(sh.id, "speed", `the picture's fastest point ${row.peakPanWps} widths/s (limit ${limit} for a ${sh.move})`)
		}
		;(row.peakZoomPerS <= NET.zoomPerS * 1.05 ? pass : fail)(sh.id, "zoom-rate", `zoom ${row.peakZoomPerS}/s (limit ${NET.zoomPerS})`)
		;(row.peakYawDegS <= NET.yawDegS * 1.05 ? pass : fail)(sh.id, "turn-rate", `${row.peakYawDegS} deg/s (limit ${NET.yawDegS})`)
		if (jump) fail(sh.id, "no-jump", `the picture jumps ${r3(jump)} widths/s inside the shot or across a join that is not a cut`)
		if (sh.move === "hold" && fs.T < NET.minHold - 1e-9) fail(sh.id, "hold-length", `a still of ${r3(fs.T)} s (at least ${NET.minHold})`)
		if (sh.move === "hold" && row.peakPanWps > NET.holdStill && fs.in === "cut") fail(sh.id, "still", `a hold moves ${row.peakPanWps} widths/s`)
		if (sh.move !== "travel") {
			const bad = heroRows.filter((h) => h.s < heroFloor * 0.999 || (!wholeShot && !h.flat && h.h < NET.heroH * 0.999))
			if (heroRows.length) (bad.length ? fail : pass)(sh.id, "subject-size", `${bad.length ? "too small: " : ""}${(bad.length ? bad : heroRows).map((h) => `${h.what}${h.lane ? "@" + h.lane : ""} s ${h.s} h ${h.h}`).join("; ")} (floor s ${heroFloor}${wholeShot ? ", a whole/setup shot" : `, h ${NET.heroH} unless flat or thin`}; group ${sizes.map((z) => z.s).join("/")})`)
		}
		const badMust = must.filter((x) => x.s < x.floor * 0.999 || x.margin < 0)
		if (must.length) (badMust.length ? fail : pass)(sh.id, "must-see", badMust.length ? badMust.map((x) => `${x.what}${x.lane ? "@" + x.lane : ""}${x.detail ? " (a detail)" : ""} s ${x.s} (floor ${x.floor}) margin ${x.margin}`).join("; ") : `${must.length} things whole, each at least its floor${small ? ` (small, because: ${sh.audit.small_because})` : ""}`)
		for (const fc of faces) (fc.h >= NET.faceH * 0.999 ? pass : fail)(sh.id, "face", `${fc.what}${fc.lane ? "@" + fc.lane : ""}: the face ${fc.h} of the picture's height (at least ${NET.faceH} to read it)`)
		if (parity !== null) (parity <= NET.parity + 1e-9 ? pass : fail)(sh.id, "parity", `the lanes' scale (picture widths per metre at each lane's own subject) differs x${parity} (at most x${NET.parity})`)
		// a pause, and the video's last shot: still for its last 0.5 s
		const lastOfBeat = meta.filter((x) => x.sh.beat === sh.beat).at(-1) === m
		if ((beatKind === "pause" && lastOfBeat) || k === film.shots.length - 1) {
			const q = Math.min(F.length - 1, Math.round(0.5 * fps))
			let mv = 0
			for (let i = F.length - q; i < F.length; i++) {
				const a = arrPose(F[i - 1].b[0])
				const c = arrPose(F[i].b[0])
				mv = Math.max(mv, (len3(sub(c.L, a.L)) / (c.d * Math.tan(c.hfov / 2) * 2)) * fps, Math.abs(Math.log(c.d / a.d)) * fps)
			}
			;(mv <= 0.003 ? pass : fail)(sh.id, "settled", `the last 0.5 s ${mv <= 0.003 ? "still" : `moves ${r3(mv)} widths/s`}`)
		}
		if (fs.T < NET.minShot - 1e-9) fail(sh.id, "shot-length", `${r3(fs.T)} s (a shot under ${NET.minShot} s cannot be read)`)
		// present: a shot whose run plays keeps its subject in the picture (a hold framed where a thing starts, while it leaves, shows an empty
		// picture); a cut ahead may wait a little for it to arrive
		if (fs.rate !== 0 && sh.move !== "travel" && sh.move !== "follow" && thing(sh.subject)) {
			const heroes = heroesOf(sh.subject).map(({ when, ...h }) => h)
			let gone = 0
			let goneAt = null
			let wait = 0
			for (let bi = 0; bi < nb; bi++) {
				let run = 0
				let seenYet = false
				for (let i = 0; i < F.length; i++) {
					const pose = arrPose(F[i].b[bi])
					let seen = false
					for (const h of heroes) {
						if (h.lane && fs.bands[bi].lane && h.lane !== fs.bands[bi].lane) continue
						const P = tgPts(h, bi, F[i].t)
						if (!P.length) continue
						const b = projBox(pose, aspOf(bi), P)
						if (b.behind) continue
						const inW = Math.max(0, Math.min(1, b.x1) - Math.max(-1, b.x0))
						const inH = Math.max(0, Math.min(1, b.y1) - Math.max(-1, b.y0))
						const all = Math.max(1e-9, (b.x1 - b.x0) * (b.y1 - b.y0))
						if ((inW * inH) / all >= 0.25) seen = true
					}
					if (seen) {
						seenYet = true
						run = 0
						continue
					}
					run++
					if (!seenYet) wait = Math.max(wait, run / fps)
					else if (run / fps > gone) {
						gone = run / fps
						goneAt = r3(fs.tau0 + i / fps)
					}
				}
			}
			const bad = gone > NET.absentS + 1e-9 || wait > NET.waitS + 1e-9
			const who = heroes.map((h) => JSON.stringify(h)).join(", ")
			;(bad ? fail : pass)(sh.id, "present", gone > NET.absentS + 1e-9 ? `the subject (${who}) leaves the picture and is gone for ${r3(gone)} s, until ${goneAt} s of video (at most ${NET.absentS} s): follow it, end the shot as it leaves, or frame where it goes` : wait > NET.waitS + 1e-9 ? `the picture waits ${r3(wait)} s for the subject (${who}) to come in (at most ${NET.waitS} s): start the shot later, or frame where it is` : `the subject stays in the picture${wait > 0 ? ` (it comes in after ${r3(wait)} s)` : ""}`)
		}
		// every lane's copy of what the shot is about stays in its own band while a split shot plays, whichever lane the shot names: a band whose
		// lane's mover has gone shows an empty lane, and the comparison loses the very thing it compares (a race filmed beside its leader drops the
		// slower car). What the shot is about: the roles its subject, keep and end name (an item a lane's cast names counts as its role)
		const namedRoles = () => {
			const out = new Set()
			const castRole = (id) => {
				for (const l of S.lanes) for (const [role, v] of Object.entries(l.cast)) if ([].concat(v).includes(id)) return role
				return null
			}
			const add = (tg) => {
				if (!tg || typeof tg !== "object") return
				if (tg.role !== undefined) out.add(tg.role)
				if (tg.item !== undefined && !tg.part) {
					const r = castRole(tg.item)
					if (r) out.add(r)
				}
				for (const id of tg.items ?? []) {
					const r = castRole(id)
					if (r) out.add(r)
				}
				for (const g of tg.gap ?? []) (S.isRole(g) ? out.add(g) : add({ item: g }))
				for (const x of tg.through ?? []) add(x)
			}
			for (const tg of [sh.subject, ...(sh.keep ?? []), sh.end?.subject, ...(sh.end?.keep ?? [])]) add(tg)
			return [...out]
		}
		if (fs.layout === "split" && S.lanes && fs.rate !== 0 && sh.move !== "travel" && nb > 1) {
			const roles = namedRoles()
			const rows = []
			for (let bi = 0; bi < nb; bi++) {
				const lane = fs.bands[bi].lane
				if (!lane) continue
				for (const role of roles) {
					const tg = { role, lane }
					let P0 = null
					let moved = 0
					let size = 0
					for (let j = 0; j <= 8; j++) {
						let P = []
						try {
							P = tgPts(tg, bi, fs.t0 + ((fs.t1 - fs.t0) * j) / 8)
						} catch {
							P = []
						}
						if (!P.length) continue
						const [lo, hi] = boundsOf(P)
						size = Math.max(size, hi[0] - lo[0], hi[1] - lo[1])
						if (!P0) P0 = centre3(P)
						else moved = Math.max(moved, len3(sub(centre3(P), P0)))
					}
					if (!(moved > Math.max(0.03, 0.5 * size))) continue
					let run = 0
					let seenYet = false
					let gone = 0
					let goneAt = null
					let wait = 0
					for (let i = 0; i < F.length; i++) {
						const P = tgPts(tg, bi, F[i].t)
						let seen = false
						if (P.length) {
							const b = projBox(arrPose(F[i].b[bi]), aspOf(bi), P)
							if (!b.behind) {
								const inW = Math.max(0, Math.min(1, b.x1) - Math.max(-1, b.x0))
								const inH = Math.max(0, Math.min(1, b.y1) - Math.max(-1, b.y0))
								seen = (inW * inH) / Math.max(1e-9, (b.x1 - b.x0) * (b.y1 - b.y0)) >= 0.25
							}
						}
						if (seen) {
							seenYet = true
							run = 0
							continue
						}
						run++
						if (!seenYet) wait = Math.max(wait, run / fps)
						else if (run / fps > gone) {
							gone = run / fps
							goneAt = r3(fs.tau0 + i / fps)
						}
					}
					rows.push({ role, lane, gone: r3(gone), goneAt, wait: r3(wait) })
				}
			}
			if (rows.length) {
				const bad = rows.filter((x) => x.gone > NET.absentS + 1e-9 || x.wait > NET.waitS + 1e-9)
				;(bad.length ? fail : pass)(sh.id, "lanes-present", bad.length ? `${bad.map((x) => (x.gone > NET.absentS + 1e-9 ? `${x.role}@${x.lane} leaves its band and is gone for ${x.gone} s, until ${x.goneAt} s of video (at most ${NET.absentS} s)` : `${x.role}@${x.lane}'s band waits ${x.wait} s for it to come in (at most ${NET.waitS} s)`)).join("; ")}: every band shows its own lane's mover while the run plays (ride the pair: subject and keep the role; or follow.per_lane; or cut ahead to where they arrive; or end the shot as one leaves)` : `every lane's mover stays in its own band (${rows.map((x) => `${x.role}@${x.lane}`).join(", ")})`)
			}
		}
		// fill (FRAMING_RULE gate 4): a still picture shows the scene, not backdrop. Most of it may be backdrop only when what the shot names already
		// spans the picture and fills the box round it (a thin or flat thing framed tight); otherwise the camera is too far, or the things it names
		// stand apart with empty backdrop between them
		// (a held moment's picture: not a run playing, which a hold frames over the room its things move through, nor a moving shot, a reveal of
		// a whole after its parts, a picture of light, or space, where the scene's own sky is the picture)
		const fillExempt = fs.rate !== 0 || sh.move === "travel" || sh.move === "follow" || beatKind === "reveal" || fs.look?.backdrop === "scene" || [subjAtKey, sh.subject, ...(sh.keep ?? []), ...(sh.context ?? [])].some((tg) => tg?.beam !== undefined)
		if (!fillExempt) {
			const named = [subjAtKey, ...(sh.keep ?? []), ...(sh.context ?? []), ...(sh.audit?.must_see ?? []), ...(sh.audit?.details ?? [])].filter(Boolean)
			const fills = []
			for (let bi = 0; bi < nb; bi++) {
				const pose = arrPose(KF.b[bi])
				const asp = aspOf(bi)
				const lane = fs.bands[bi].lane
				const pr = projector(pose, asp)
				/** a thing's box as the picture shows it, clipped to the picture; a box reaching behind the camera (a table top under a close camera)
				 *  by the part in front of it (its points sampled through the box) */
				const shownBox = (P) => {
					let b = projBox(pose, asp, P)
					if (b.behind) {
						const lo = [0, 1, 2].map((k) => Math.min(...P.map((X) => X[k])))
						const hi = [0, 1, 2].map((k) => Math.max(...P.map((X) => X[k])))
						b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity }
						for (let a = 0; a <= 6; a++)
							for (let c = 0; c <= 6; c++)
								for (let e = 0; e <= 6; e++) {
									const q = pr([lo[0] + ((hi[0] - lo[0]) * a) / 6, lo[1] + ((hi[1] - lo[1]) * c) / 6, lo[2] + ((hi[2] - lo[2]) * e) / 6])
									if (q.z < 0.02) continue
									b.x0 = Math.min(b.x0, q.x)
									b.x1 = Math.max(b.x1, q.x)
									b.y0 = Math.min(b.y0, q.y)
									b.y1 = Math.max(b.y1, q.y)
								}
					}
					const c = { x0: Math.max(-1, b.x0), x1: Math.min(1, b.x1), y0: Math.max(-1, b.y0), y1: Math.min(1, b.y1) }
					return c.x1 > c.x0 && c.y1 > c.y0 ? c : null
				}
				const mine = []
				for (const tg of named) {
					if (tg.lane && lane && tg.lane !== lane) continue
					// (a group's things one by one, so things far apart are measured apart; a place, a mark, a trail, a gap or a face as its own box)
					const ones = thing(tg) ? heroesOf(tg) : []
					for (const one of ones.length ? ones : [tg]) {
						const P = tgPts(one, bi, KF.t)
						const c = P.length ? shownBox(P) : null
						if (c) mine.push(c)
					}
				}
				if (!mine.length) continue
				// everything else the band draws of the scene: not what the look turns into backdrop (the table top under a studio sweep, walls, things
				// drawn invisible) and not the other lanes' things
				const R = S.one ? S.one : S.runOf(lane)
				const hidden = new Set(fs.hide?.[bi] ?? [])
				const backdropItem = (id) => {
					const it = R.scene?.items?.find((x) => x.id === id)
					const type = R.solidsOf.get(id)?.[0]?.itemType ?? it?.type
					return (type === "table" && fs.look?.ground !== "table") || type === "wall" || it?.props?.invisible_in_3d === true
				}
				const drawn = []
				const tableTops = [] // (a table top the look draws as a table: scene for the fill, backdrop at a lesson's stop, which a table never fills)
				for (const id of R.itemIds()) {
					if (hidden.has(id) || backdropItem(id)) continue
					const P = R.itemPts(id, null, KF.t)
					const c = P.length ? shownBox(P) : null
					if (!c) continue
					const type = R.solidsOf.get(id)?.[0]?.itemType ?? R.scene?.items?.find((x) => x.id === id)?.type
					;(type === "table" ? tableTops : drawn).push(c)
				}
				// (and what a module draws that has no body of its own: a circuit's board)
				for (const pr of R.doc?.processes ?? [])
					for (const b of pr.boards ?? []) {
						if (!(b.width > 0 && b.height > 0)) continue
						const P = []
						for (const dx of [-0.5, 0.5]) for (const dy of [-0.5, 0.5]) for (const z of [-0.01, 0.01]) P.push([b.x + dx * b.width, b.y + dy * b.height, z])
						const c = shownBox(P)
						if (c) drawn.push(c)
					}
				const U = { x0: Math.min(...mine.map((b) => b.x0)), x1: Math.max(...mine.map((b) => b.x1)), y0: Math.min(...mine.map((b) => b.y0)), y1: Math.max(...mine.map((b) => b.y1)) }
				const longer = Math.max((U.x1 - U.x0) / 2, (U.y1 - U.y0) / 2)
				// a 48-column grid of the picture: the share the scene covers, and the share of the box round the named things they cover
				const GX = 48
				const GY = Math.max(8, Math.round(GX / asp))
				let all = 0
				let shown = 0
				let shownStop = 0
				let inU = 0
				let hitU = 0
				const inside = (b, x, y) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1
				for (let gy = 0; gy < GY; gy++) {
					const y = -1 + (2 * (gy + 0.5)) / GY
					for (let gx = 0; gx < GX; gx++) {
						const x = -1 + (2 * (gx + 0.5)) / GX
						all++
						const own = mine.some((b) => inside(b, x, y))
						const scene = own || drawn.some((b) => inside(b, x, y))
						if (scene) shownStop++
						if (scene || tableTops.some((b) => inside(b, x, y))) shown++
						if (inside(U, x, y)) {
							inU++
							if (own) hitU++
						}
					}
				}
				fills.push({ lane, backdrop: r3(1 - shown / all), stopBackdrop: r3(1 - shownStop / all), longer: r3(longer), cover: r3(inU ? hitU / inU : 1) })
			}
			row.fill = fills
			// a lesson's stop: the child reads this picture while the video waits, so each band is mostly the scene (the original drawn lessons fill
			// each band with its things, edge to edge): a lane's things pushed into a corner of a band sized for the other lane's leave it empty
			if (plan.source?.kind === "lesson" && beatKind === "pause" && meta.filter((x) => x.sh.beat === sh.beat).at(-1) === m && fills.length) {
				const emptyBands = fills.filter((f) => f.stopBackdrop > NET.stopBackdrop + 1e-9)
				;(emptyBands.length ? fail : pass)(sh.id, "stop-fill", emptyBands.length ? `${emptyBands.map((f) => `${f.lane ? `${f.lane}: ` : ""}${f.stopBackdrop}`).join("; ")} of the band is backdrop at the stop (at most ${NET.stopBackdrop}; a table top counts as backdrop here): frame closer on the things the question names, or pan each band to its own lane's things at the same scale (align on the role)` : `the stop's bands are mostly the scene (${fills.map((f) => `${f.lane ? f.lane + " " : ""}backdrop ${f.stopBackdrop}`).join(", ")})`)
			}
			const bad = fills.filter((f) => f.backdrop > NET.backdrop + 1e-9 && (f.longer < NET.fillLong - 1e-9 || f.cover < NET.spread - 1e-9))
			const say = (f) => `${f.lane ? `${f.lane}: ` : ""}${f.backdrop} of the picture is backdrop (at most ${NET.backdrop}); what the shot names ${f.longer < NET.fillLong ? `spans ${f.longer} of the picture's longer side (${NET.fillLong} would fill it)` : ""}${f.longer < NET.fillLong && f.cover < NET.spread ? " and " : ""}${f.cover < NET.spread ? `covers ${f.cover} of the box round it (${NET.spread} would fill it): things apart with backdrop between` : ""}`
			if (fills.length) (bad.length ? fail : pass)(sh.id, "fill", bad.length ? `${bad.map(say).join("; ")}: frame closer or with a longer lens, give far-apart things their own bands (layout split, one scale) or show them one at a time, or name what belongs in the room around them (keep, context)` : `the scene fills the picture (${fills.map((f) => `${f.lane ? f.lane + " " : ""}backdrop ${f.backdrop}`).join(", ")})`)
		}
		// the same still picture twice: a cut to the very picture the shot before ended on, the run held at the same moment, the same marks and
		// badge (nothing changes on screen: marks that appear or change make it a new beat, not a repeat)
		if (k > 0 && fs.rate === 0 && row.peakPanWps <= NET.holdStill && row.peakZoomPerS <= 0.01 && JSON.stringify(sh.annotate ?? []) === JSON.stringify(meta[k - 1].sh.annotate ?? []) && (sh.label ?? null) === (meta[k - 1].sh.label ?? null)) {
			const pf = film.shots[k - 1]
			const a = film.frames[pf.i0 + pf.n - 1]
			const c = F[0]
			const samePose = (p, q) => {
				const P = arrPose(p)
				const Q = arrPose(q)
				return Math.abs(Math.log(P.d / Q.d)) < 0.01 && len3(sub(P.L, Q.L)) < 0.005 * P.d && Math.abs(P.yaw - Q.yaw) < 0.01 && Math.abs(P.pitch - Q.pitch) < 0.01 && Math.abs(P.hfov - Q.hfov) < 1e-3
			}
			if (pf.rate === 0 && Math.abs(pf.t0 - fs.t0) < 1e-6 && pf.layout === fs.layout && a.b.length === c.b.length && a.b.every((p, bi) => samePose(p, c.b[bi])))
				fail(sh.id, "repeat", `the same still picture as ${pf.id} (the run held at the same moment, the camera where it was, the same marks)${fs.layout === "split" ? `: in a split every band shows its own lane's copy of the subject at one scale, so another lane's thing frames the very same picture (to show one lane's thing alone, use layout single)` : ""}: make them one shot, or change the picture`)
		}
		// a cut that changes the picture only a little is a jump cut
		if (fs.in === "cut" && prevPose) {
			const a = prevPose
			const c = arrPose(F[0].b[0])
			const asp = aspOf(0)
			const q = projector(a, asp)(c.L)
			const shift = Math.hypot(q.x, q.y / asp) / 2
			const scale = Math.abs(Math.log((c.d * Math.tan(c.hfov / 2)) / (a.d * Math.tan(a.hfov / 2))))
			const turn = Math.max(Math.abs(c.yaw - a.yaw), Math.abs(c.pitch - a.pitch)) / D2R
			const jumpCut = (shift > 0.03 || scale > Math.log(1.08)) && shift < 0.25 && scale < Math.log(1.6) && turn < 20 && fs.layout === prevLayout
			;(jumpCut ? fail : pass)(sh.id, "cut", `a cut: the picture moves ${r3(shift)} widths, scale x${r3(Math.exp(scale))}, turns ${r3(turn)} deg${jumpCut ? ": a jump cut (change more, or glide)" : ""}`)
			// a cut into moving action that jumps far in scale (a close setup to an extreme wide of the whole path, the movers specks): the child loses
			// what moves; a still after the cut (a reveal of a whole, a stop) gives the eye time to find it again
			// (the movers: things the shot names that move while its run plays, each with its size in the picture at the cut, every band; a held
			// moment, or things at rest with only the camera moving over them, is a picture the eye can search)
			const moversAtCut = () => {
				if (fs.rate === 0) return []
				const out = []
				for (const tg of [sh.subject, ...(sh.keep ?? [])].filter((x) => thing(x))) {
					for (const h of heroesOf(tg).map(({ when, ...x }) => x)) {
						for (let bi = 0; bi < nb; bi++) {
							if (h.lane && fs.bands[bi].lane && h.lane !== fs.bands[bi].lane) continue
							let c0 = null
							let moves = false
							for (let j = 0; j <= 8 && !moves; j++) {
								const P = tgPts(h, bi, fs.t0 + ((fs.t1 - fs.t0) * j) / 8)
								if (!P.length) continue
								const [lo, hi] = boundsOf(P)
								const c = centre3(P)
								if (!c0) c0 = { c, size: Math.max(hi[0] - lo[0], hi[1] - lo[1]) }
								else if (len3(sub(c, c0.c)) > Math.max(0.02, 0.25 * c0.size)) moves = true
							}
							if (!moves) continue
							const P0 = tgPts(h, bi, F[0].t)
							if (!P0.length) continue
							out.push({ what: `${JSON.stringify(h)}${fs.bands[bi].lane ? "@" + fs.bands[bi].lane : ""}`, s: r3(boxStats(projBox(arrPose(F[0].b[bi]), aspOf(bi), P0)).s) })
						}
					}
				}
				return out
			}
			// a cut out to a much wider picture that leaves the movers small (a close setup to an extreme wide of the whole path, the toys specks): the
			// child loses what moves. A cut in, or a wider picture where the movers stay big, the eye follows
			const wider = c.d * Math.tan(c.hfov / 2) > a.d * Math.tan(a.hfov / 2)
			const k2 = Math.exp(scale)
			if (wider && k2 > NET.cutScale + 1e-9) {
				const small = moversAtCut().filter((x) => x.s < NET.heroS - 1e-9)
				;(small.length ? fail : pass)(sh.id, "cut-scale", small.length ? `a cut out to a picture x${r3(k2)} wider (at most x${NET.cutScale} into moving action) leaves the movers small: ${small.map((x) => `${x.what} s ${x.s}`).join("; ")} (floor ${NET.heroS}): the child loses them. Ride with them at a scale near the last picture's, widen in two steps, or glide over at least 1 s (in: {ease})` : `the cut widens the picture x${r3(k2)}, the movers big in it`)
			}
		}
		prevPose = arrPose(F[F.length - 1].b[0])
		prevLayout = fs.layout
		if (beam) (beam.corePx >= NET.beamCorePx && beam.haloPx >= NET.beamHaloPx ? pass : fail)(sh.id, "beam-visible", `beam core ${beam.corePx} px, glow ${beam.haloPx} px`)
		// a path that is the shot's subject (an orbit, a whole trip) fills the picture: the loop a child must see whole is the picture, not a ring in
		// the middle of it
		// (the path the shot is about: its subject, or a trail it keeps whole while something else is the subject: a whole loop held in the picture)
		// (a kept trail counts when it is a closed loop, an orbit or a round trip: the loop is then what the picture holds; an open flight kept whole beside
		// the things it links is not the shot's subject)
		const closedLoop = (tg) => {
			try {
				const R = S.runOf(fs.bands[0].lane)
				const a = S.momentT(tg.from, fs.bands[0].lane)
				const b = S.momentT(tg.to, fs.bands[0].lane)
				const C = []
				for (let j = 0; j <= 24; j++) {
					const Q = R.itemPts(tg.trail, tg.part ?? null, a + ((b - a) * j) / 24)
					if (Q.length) C.push(centre3(Q))
				}
				if (C.length < 3) return false
				const [lo, hi] = boundsOf(C)
				return len3(sub(C.at(-1), C[0])) < 0.15 * Math.max(hi[0] - lo[0], hi[1] - lo[1])
			} catch {
				return false
			}
		}
		const pathTg = subjAtKey?.trail !== undefined ? subjAtKey : (sh.keep ?? []).find((x) => x?.trail !== undefined && closedLoop(x))
		if (sh.move === "hold" && pathTg) {
			const fr = []
			// (the path as the child sees it drawn: the mover's centre over the trail's window, not the boxes it sweeps)
			for (let bi = 0; bi < nb; bi++) {
				let ta
				let tb
				try {
					ta = S.momentT(pathTg.from, fs.bands[bi].lane)
					tb = S.momentT(pathTg.to, fs.bands[bi].lane)
				} catch {
					continue
				}
				const P = []
				for (let j = 0; j <= 40; j++) {
					const Q = tgPts({ item: pathTg.trail, ...(pathTg.part ? { part: pathTg.part } : {}), ...(pathTg.lane ? { lane: pathTg.lane } : {}) }, bi, ta + ((tb - ta) * j) / 40)
					if (Q.length) P.push(centre3(Q))
				}
				if (P.length < 2) continue
				const b = projBox(arrPose(KF.b[bi]), aspOf(bi), P)
				fr.push({ lane: fs.bands[bi].lane, span: r3(Math.max((Math.min(1, b.x1) - Math.max(-1, b.x0)) / 2, (Math.min(1, b.y1) - Math.max(-1, b.y0)) / 2)) })
			}
			const low = fr.filter((x) => x.span < NET.pathFill - 1e-9)
			if (fr.length) (low.length ? fail : pass)(sh.id, "path-fill", low.length ? `the path spans ${low.map((x) => `${x.lane ? x.lane + " " : ""}${x.span}`).join(", ")} of the picture's longer side (at least ${NET.pathFill}): frame the path itself, tight (fit tight on the trail, or a width just over its reach), the mover kept whole` : `the path fills the picture (${fr.map((x) => x.span).join(", ")})`)
		}
		if (fs.rate !== 0 && fs.rate !== 1 && !sh.label) fail(sh.id, "label", "slow motion or a speed-up without its label")
	}
	report.ok = report.checks.every((c) => c.ok)
	report.failed = report.checks.filter((c) => !c.ok).map((c) => `${c.shot} ${c.check}: ${c.why}`)
	return report
}

// ------------------------------------------------------------------------------------------------ marks (section 3.10, 4.8)
/** The plan's marks, frame by frame and band by band, as world-anchored primitives drawn through the same projection as the picture, so they
 *  move with the camera like the things they mark: {type: "line", a, b, dash?, color, width} | {type: "poly", pts, dash?, color, width} |
 *  {type: "text", at, text, anchor: "above"|"below"|"right"|"center", key?} | {type: "screen", corner, text}. Measured numbers only. */
function marksOf(film) {
	const { S, meta } = film._ctx
	const lanes = S.lanes
	const labelOf = (lane) => lanes?.find((l) => l.id === lane)?.label ?? ""
	const out = {}
	const fill = (s, v) => String(s ?? "").replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined && v[k] !== null ? v[k] : m))
	const metres = (x) => String(Math.round(x * 100) / 100)
	const box2 = (P) => {
		let x0 = Infinity
		let x1 = -Infinity
		let y0 = Infinity
		let y1 = -Infinity
		for (const X of P) {
			x0 = Math.min(x0, X[0])
			x1 = Math.max(x1, X[0])
			y0 = Math.min(y0, X[1])
			y1 = Math.max(y1, X[1])
		}
		return { x0, x1, y0, y1 }
	}
	const R3 = (q) => ({ ...q, ...(q.a ? { a: q.a.map(r4) } : {}), ...(q.b ? { b: q.b.map(r4) } : {}), ...(q.at ? { at: q.at.map(r4) } : {}), ...(q.pts ? { pts: q.pts.map((X) => X.map(r4)) } : {}) })
	for (let k = 0; k < film.shots.length; k++) {
		const fs = film.shots[k]
		const m = meta[k]
		const sh = m.sh
		const anns = sh.annotate ?? []
		if (!anns.length) continue
		const span = sh.move === "push" || sh.move === "pull" || sh.move === "arc" ? clamp(Number(sh.move_seconds ?? Math.max(1 / film.fps, fs.T - fs.holdAfter)), 1 / film.fps, fs.T) : 0
		/** a target's points in a band's own world (as measure's tgPts, except that a mark on a place or on a thing no lane owns stays where it is
		 *  in the scene: words written for one lane's place never show over the other lanes' things at their offset) */
		const bandPts = (tg, bi, t) => {
			const lane = fs.bands[bi].lane
			if (fs.layout === "split" && lanes) {
				const own = tg.item !== undefined ? S.laneOf.get(tg.item) : undefined
				if (own !== undefined && S.one) return own === lane ? (S.pts(tg, null, t) ?? []) : []
				if (tg.role !== undefined || tg.gap !== undefined || tg.mark !== undefined || tg.contact !== undefined) return S.pts(tg.role !== undefined && !tg.lane ? { ...tg, lane } : tg, lane, t) ?? []
				if (S.one) return S.pts(tg, null, t) ?? []
				return S.pts(tg, lane, t) ?? []
			}
			if (fs.layout === "together" && lanes && tg.role !== undefined && !tg.lane) return lanes.flatMap((ln) => S.pts({ ...tg, lane: ln.id }, S.one ? null : ln.id, t) ?? [])
			return S.pts(tg, S.one ? null : (lanes?.[0]?.id ?? null), t) ?? []
		}
		for (let i = 0; i < fs.n; i++) {
			const fr = film.frames[fs.i0 + i]
			const u = i / film.fps
			const perBand = []
			let any = false
			for (let bi = 0; bi < fs.bands.length; bi++) {
				const band = fs.bands[bi]
				if (band.inset) {
					perBand.push([])
					continue
				}
				const lane = band.lane
				const R = S.runOf(lane)
				const prims = []
				for (const a of anns) {
					if ((a.appear ?? "shot") === "settled" && u < span - 1e-6) continue
					if (a.from !== undefined && fr.t < S.momentT(a.from, null) - 1e-6) continue
					if (a.to !== undefined && fr.t > S.momentT(a.to, null) + 1e-6) continue
					const tg = a.on
					const tAt = tg.when !== undefined ? S.momentT(tg.when, lane) : fr.t
					const dt = a.since !== undefined && a.from !== undefined ? (S.momentT(a.from, lane) - S.momentT(a.since, lane)).toFixed(1) : undefined
					if ((a.kind === "normal" || a.kind === "angle") && tg.beam !== undefined && tg.bounce) {
						const B = R.beamAt(tg.beam, tAt)?.bounces?.[tg.bounce - 1]
						if (!B || !B.n) continue
						const n = B.n
						const p = B.p
						if (a.kind === "normal") {
							const L = 0.22 + (tg.pad ?? 0) * 0.5
							prims.push({ type: "line", a: p, b: [p[0] + n[0] * L, p[1] + n[1] * L, 0], dash: true, color: MARK.white, width: 3 })
						} else {
							const r = 0.12 + (tg.pad ?? 0) * 0.25
							const arc = (v) => {
								const a0 = Math.atan2(n[1], n[0])
								let da = Math.atan2(v[1], v[0]) - a0
								while (da > Math.PI) da -= 2 * Math.PI
								while (da < -Math.PI) da += 2 * Math.PI
								const P = []
								for (let q = 0; q <= 20; q++) {
									const ang = a0 + (da * q) / 20
									P.push([p[0] + r * Math.cos(ang), p[1] + r * Math.sin(ang), 0])
								}
								const mid = a0 + da / 2
								return { pts: P, mid: [p[0] + (r + 0.06) * Math.cos(mid), p[1] + (r + 0.06) * Math.sin(mid), 0] }
							}
							const ai = arc([-B.din[0], -B.din[1]])
							const ao = arc(B.dout)
							prims.push({ type: "poly", pts: ai.pts, color: MARK.yellow, width: 4 }, { type: "poly", pts: ao.pts, color: MARK.yellow, width: 4 })
							const vin = Math.round(B.in)
							const vout = Math.round(B.out)
							if (/\{in\}/.test(a.text ?? "") && /\{out\}/.test(a.text ?? "")) prims.push({ type: "text", at: ai.mid, text: `${vin}°`, anchor: "center", key: true }, { type: "text", at: ao.mid, text: `${vout}°`, anchor: "center", key: true })
							else prims.push({ type: "text", at: ai.mid, text: fill(a.text ?? "{in}°", { in: vin, out: vout }), anchor: "center", key: true })
						}
						continue
					}
					if (a.kind === "clock") {
						const ts = a.from !== undefined ? S.momentT(a.from, null) : fs.t0
						prims.push({ type: "screen", corner: "top-left", text: fill(a.text ?? "{s} s", { s: Math.max(0, fr.t - ts).toFixed(1) }), big: true })
						continue
					}
					if (a.kind === "count") {
						// (a readout: words in the corner, with a measured number when it names one: "one swing: {dt} s" from each turn, big)
						if (a.text) prims.push({ type: "screen", corner: "top-left", text: fill(a.text, { label: labelOf(lane), dt }), ...(/\{(dt|s)\}/.test(a.text) ? { big: true } : {}) })
						continue
					}
					if (a.kind === "trail" && tg.trail !== undefined) {
						const ta = S.momentT(tg.from, lane)
						const tb = Math.min(fr.t, S.momentT(tg.to, lane))
						const P = []
						for (let q = 0; q <= 60; q++) {
							const tq = ta + ((tb - ta) * q) / 60
							if (tq > tb + 1e-9) break
							const Q = bandPts({ item: tg.trail, ...(tg.part ? { part: tg.part } : {}) }, bi, tq)
							if (Q.length) P.push(centre3(Q))
						}
						if (P.length > 1) prims.push({ type: "poly", pts: P, color: MARK.blue, width: 2, dash: true })
						continue
					}
					if (a.kind === "distance" && tg.gap) {
						const [A, Bq] = tg.gap.map((g) => box2(bandPts(S.isRole(g) ? { role: g, when: tg.when } : { item: g, when: tg.when }, bi, tAt)))
						if (!Number.isFinite(A.x0) || !Number.isFinite(Bq.x0)) continue
						const left = (A.x0 + A.x1) / 2 < (Bq.x0 + Bq.x1) / 2
						const x0 = left ? A.x1 : Bq.x1
						const x1 = left ? Bq.x0 : A.x0
						// (between the two at the height they share; at: above or below, clear of both, so the bar and its number never sit on a thing)
						const y = a.at === "above" ? Math.max(A.y1, Bq.y1) + 0.03 : a.at === "below" ? Math.min(A.y0, Bq.y0) - 0.03 : (Math.max(A.y0, Bq.y0) + Math.min(A.y1, Bq.y1)) / 2
						const tick = 0.02
						prims.push({ type: "line", a: [x0, y, 0], b: [x1, y, 0], color: MARK.yellow, width: 4 }, { type: "line", a: [x0, y - tick, 0], b: [x0, y + tick, 0], color: MARK.yellow, width: 4 }, { type: "line", a: [x1, y - tick, 0], b: [x1, y + tick, 0], color: MARK.yellow, width: 4 })
						prims.push({ type: "text", at: [(x0 + x1) / 2, y + 0.03, 0], text: fill(a.text ?? "{value} cm", { value: Math.round(Math.abs(x1 - x0) * 100), label: labelOf(lane) }), anchor: "above", key: true })
						continue
					}
					if (a.kind === "label" && tg.role !== undefined && !tg.lane && fs.layout === "together" && lanes) {
						for (const ln of lanes) {
							const Q = S.pts({ ...tg, lane: ln.id }, S.one ? null : ln.id, tAt) ?? []
							if (!Q.length) continue
							const q = box2(Q)
							prims.push({ type: "text", at: [(q.x0 + q.x1) / 2, q.y1 + 0.02, 0], text: fill(a.text ?? "{label}", { label: ln.label ?? "" }), anchor: "above" })
						}
						continue
					}
					let P
					try {
						P = bandPts(tg, bi, tAt)
					} catch {
						P = []
					}
					if (!P.length) continue
					const bx = box2(P)
					const where = a.at ?? (bx.y1 - bx.y0 > 3 * (bx.x1 - bx.x0) ? "beside" : "above")
					const wordsAt = where === "below" ? { at: [(bx.x0 + bx.x1) / 2, bx.y0 - 0.02, 0], anchor: "below" } : where === "beside" ? { at: [bx.x1 + 0.04, (bx.y0 + bx.y1) / 2, 0], anchor: "right" } : { at: [(bx.x0 + bx.x1) / 2, bx.y1 + 0.02, 0], anchor: "above" }
					const vars = { label: labelOf(lane), dt, value: Math.round(Math.max(bx.x1 - bx.x0, bx.y1 - bx.y0) * 100), m: metres(Math.max(bx.x1 - bx.x0, bx.y1 - bx.y0)) }
					const keyText = /\{(dt|value|m|s)\}/.test(a.text ?? "")
					if (a.kind === "label") prims.push({ type: "text", ...wordsAt, text: fill(a.text ?? "{label}", vars), key: keyText })
					else if (a.kind === "distance") {
						const tall = bx.y1 - bx.y0 > bx.x1 - bx.x0
						const off = 0.03
						const tick = 0.015
						if (tall) {
							const x = bx.x1 + off
							prims.push({ type: "line", a: [x, bx.y0, 0], b: [x, bx.y1, 0], color: MARK.yellow, width: 3 }, { type: "line", a: [x - tick, bx.y0, 0], b: [x + tick, bx.y0, 0], color: MARK.yellow, width: 3 }, { type: "line", a: [x - tick, bx.y1, 0], b: [x + tick, bx.y1, 0], color: MARK.yellow, width: 3 }, { type: "text", at: [x + 0.03, (bx.y0 + bx.y1) / 2, 0], text: fill(a.text ?? "{value} cm", vars), anchor: "right", key: true })
						} else {
							const y = bx.y0 - off
							prims.push({ type: "line", a: [bx.x0, y, 0], b: [bx.x1, y, 0], color: MARK.yellow, width: 3 }, { type: "line", a: [bx.x0, y - tick, 0], b: [bx.x0, y + tick, 0], color: MARK.yellow, width: 3 }, { type: "line", a: [bx.x1, y - tick, 0], b: [bx.x1, y + tick, 0], color: MARK.yellow, width: 3 }, { type: "text", at: [(bx.x0 + bx.x1) / 2, y - 0.02, 0], text: fill(a.text ?? "{value} cm", vars), anchor: "below", key: true })
						}
					} else if (a.kind === "level") prims.push({ type: "line", a: [bx.x0 - 1.5, (bx.y0 + bx.y1) / 2, 0], b: [bx.x1 + 1.5, (bx.y0 + bx.y1) / 2, 0], dash: true, color: MARK.yellow, width: 3 }, ...(a.text ? [{ type: "text", at: [bx.x1 + 0.03, bx.y1 + 0.02, 0], text: fill(a.text, { label: labelOf(lane) }), anchor: "above" }] : []))
					// (a start mark is a reminder, not a thing: a faint dashed outline, so what is there now stays the subject)
					else if (a.kind === "start-mark") prims.push({ type: "poly", pts: [[bx.x0, bx.y0, 0], [bx.x1, bx.y0, 0], [bx.x1, bx.y1, 0], [bx.x0, bx.y1, 0], [bx.x0, bx.y0, 0]], dash: true, color: MARK.faint, width: 1.5 }, ...(a.text ? [{ type: "text", ...wordsAt, text: fill(a.text, vars), key: keyText }] : []))
					else if (a.kind === "finish-mark") prims.push({ type: "line", a: [(bx.x0 + bx.x1) / 2, bx.y0, 0], b: [(bx.x0 + bx.x1) / 2, bx.y1 + 0.25, 0], color: MARK.white, width: 3 }, ...(a.text ? [{ type: "text", at: [(bx.x0 + bx.x1) / 2, bx.y1 + 0.27, 0], text: a.text, anchor: "above" }] : []))
				}
				if (prims.length) any = true
				perBand.push(prims.map(R3))
			}
			if (any) out[fs.i0 + i] = perBand
		}
	}
	return out
}

// ------------------------------------------------------------------------------------------------ checking a plan (section 7.1, 7.2)
const forEachTarget = (plan, fn) => {
	const T = (tg, at, shot) => tg && typeof tg === "object" && fn(tg, at, shot)
	;(plan.story ?? []).forEach((b, i) => (b.evidence ?? []).forEach((tg, j) => T(tg, `story[${i}].evidence[${j}]`, null)))
	plan.shots.forEach((sh, i) => {
		const at = `shots[${i}] (${sh.id})`
		T(sh.subject, `${at}.subject`, sh)
		;(sh.keep ?? []).forEach((tg, j) => T(tg, `${at}.keep[${j}]`, sh))
		;(sh.context ?? []).forEach((tg, j) => T(tg, `${at}.context[${j}]`, sh))
		if (sh.end) {
			T(sh.end.subject, `${at}.end.subject`, sh)
			;(sh.end.keep ?? []).forEach((tg, j) => T(tg, `${at}.end.keep[${j}]`, sh))
		}
		if (sh.follow?.stop_at) T(sh.follow.stop_at, `${at}.follow.stop_at`, sh)
		if (sh.inset) T(sh.inset.subject, `${at}.inset.subject`, sh)
		;(sh.annotate ?? []).forEach((a, j) => T(a.on, `${at}.annotate[${j}].on`, sh))
		;(sh.audit?.must_see ?? []).forEach((tg, j) => T(tg, `${at}.audit.must_see[${j}]`, sh))
		;(sh.audit?.details ?? []).forEach((tg, j) => T(tg, `${at}.audit.details[${j}]`, sh))
	})
}
/** Resolve a plan against the run (DIRECTOR.md 7.1, after the schema): every item, part, role, moment, beam stretch and bounce exists, every
 *  play window lies inside its run, every beat a shot names exists, every target shows something at its moment. -> {ok, errors: [{at,
 *  message, nearest?}], warnings: [{at, message}]}: exact messages with the digest's nearest ids, for the director's one repair (a warning
 *  films as asked: a window reaching past the run's end holds its last moment). */
export function resolvePlan(plan, world) {
	const errors = []
	const warnings = []
	const err = (at, e) => errors.push({ at, message: e?.message ?? String(e), ...(e?.nearest?.length ? { nearest: e.nearest } : {}) })
	const warn = (at, message) => warnings.push({ at, message })
	if (!plan || typeof plan !== "object") return { ok: false, errors: [{ at: "plan", message: "a plan is an object" }] }
	if (plan.version !== 1) err("version", new Error("version must be 1"))
	if (!Array.isArray(plan.shots) || !plan.shots.length) return { ok: false, errors: [...errors, { at: "shots", message: "a plan needs at least one shot" }] }
	let S
	try {
		S = scopeOf(world, plan.lanes)
	} catch (e) {
		return { ok: false, errors: [...errors, { at: "lanes", message: e.message }] }
	}
	if (S.lanes)
		S.lanes.forEach((l, i) => {
			const R = S.runOf(l.id)
			for (const [role, v] of Object.entries(l.cast)) for (const id of [].concat(v)) if (!R.solidsOf.has(id)) err(`lanes.list[${i}].cast.${role}`, new PlanError(`${id} is not in ${S.one ? "the scene" : `lane ${l.id}'s run`}`, { nearest: nearestIds(id, R.itemIds()) }))
		})
	const beats = new Set((plan.story ?? []).map((b) => b.id))
	const dur = Math.max(...S.allRuns().map((R) => R.dur))
	const tryT = (m, at) => {
		try {
			return S.momentT(m, null)
		} catch (e) {
			err(at, e)
			return undefined
		}
	}
	plan.shots.forEach((sh, i) => {
		const at = `shots[${i}] (${sh.id})`
		if (plan.story && sh.beat !== undefined && !beats.has(sh.beat)) err(`${at}.beat`, new PlanError(`beat ${sh.beat} is not in the story`, { nearest: [...beats] }))
		const r = sh.run ?? {}
		if (r.freeze !== undefined) {
			const t = tryT(r.freeze, `${at}.run.freeze`)
			if (t !== undefined && (t < -1e-9 || t > dur + 1e-6)) warn(`${at}.run.freeze`, `the freeze at ${r3(t)} s is outside the run (0..${r3(dur)} s): the run is held at its end`)
		} else {
			const a = tryT(r.from, `${at}.run.from`)
			const b = tryT(r.to, `${at}.run.to`)
			if (a !== undefined && b !== undefined) {
				if (b < a - 1e-9) err(`${at}.run`, new Error(`it plays from ${r3(a)} s to ${r3(b)} s, backwards`))
				if (a < -1e-9 || b > dur + 1e-6) warn(`${at}.run`, `the window ${r3(a)}..${r3(b)} s reaches outside the run (0..${r3(dur)} s): the run is held at its end there`)
			}
			if ((r.rate ?? 1) !== 1 && !sh.label) err(`${at}.label`, new Error("a rate other than 1 needs its label (\"Slow motion: 8 times slower\")"))
		}
		if (sh.move === "travel" && !sh.travel?.path) err(`${at}.travel`, new Error("a travel needs travel.path"))
		if ((sh.move === "push" || sh.move === "pull" || sh.move === "arc") && !sh.end) err(`${at}.end`, new Error(`a ${sh.move} needs end`))
		if ((sh.layout === "split" || sh.layout === "together") && !S.lanes) err(`${at}.layout`, new Error(`layout ${sh.layout} needs the plan's lanes`))
		;(sh.annotate ?? []).forEach((a, j) => {
			for (const k of ["from", "to", "since"]) if (a[k] !== undefined) tryT(a[k], `${at}.annotate[${j}].${k}`)
		})
		const key = sh.audit?.key
		if (key !== undefined && key !== "start" && key !== "middle" && key !== "end") tryT(key, `${at}.audit.key`)
		if (sh.move === "travel" && sh.travel?.path) {
			try {
				const t = r.freeze !== undefined ? S.momentT(r.freeze, null) : S.momentT(r.from, null)
				const P = S.path(sh.travel.path, S.one ? null : S.lanes[0].id, clamp(t, 0, dur))
				if (P.length < 2) err(`${at}.travel.path`, new Error(`the path has ${P.length} point(s)`))
			} catch (e) {
				err(`${at}.travel.path`, e)
			}
		}
	})
	// every target shows something at its moment, or at some moment of its shot (its run window's start, middle and end), or of the run
	const windowOf = (sh) => {
		if (!sh) return [0, 0.25, 0.5, 0.75, 1].map((k) => k * dur)
		try {
			const r = sh.run ?? {}
			if (r.freeze !== undefined) return [S.momentT(r.freeze, null)]
			const a = S.momentT(r.from, null)
			const b = S.momentT(r.to, null)
			return [a, (a + b) / 2, b]
		} catch {
			return [0]
		}
	}
	forEachTarget(plan, (tg, at, sh) => {
		try {
			const lanesTo = S.lanes ? (tg.lane ? [tg.lane] : tg.role !== undefined ? S.lanes.map((l) => l.id) : [S.one ? null : S.lanes[0].id]) : [null]
			let any = false
			for (const ln of lanesTo) {
				const ts = tg.when !== undefined ? [S.momentT(tg.when, ln)] : windowOf(sh)
				for (const t of ts) {
					const P = S.pts(tg, ln, clamp(t, 0, dur))
					if (P && P.length) any = true
				}
			}
			if (!any && tg.point === undefined && tg.region === undefined) err(at, new Error(`${JSON.stringify(tg)} shows nothing during its shot (no drawn body)`))
		} catch (e) {
			err(at, e)
		}
	})
	return { ok: !errors.length, errors, warnings }
}
/** Everything the engine checks before filming: resolution, then compile and the safety net. -> {ok, errors, report, film, messages}: messages
 *  are the sentences that go back to the director (failed resolution, failed checks). */
export function checkPlan(plan, world, opts = {}) {
	const r = resolvePlan(plan, world)
	if (!r.ok) return { ok: false, errors: r.errors, report: null, film: null, messages: r.errors.map((e) => `${e.at}: ${e.message}${e.nearest?.length ? ` (nearest: ${e.nearest.join(", ")})` : ""}`) }
	let film
	try {
		film = compile(plan, world, opts)
	} catch (e) {
		const x = { at: e.shot ? `shot ${e.shot}` : "plan", message: e.message, ...(e.nearest?.length ? { nearest: e.nearest } : {}) }
		return { ok: false, errors: [x], report: null, film: null, messages: [`${x.at}: ${x.message}`] }
	}
	const report = measure(film)
	return { ok: report.ok, errors: [], report, film, messages: report.failed }
}

// ------------------------------------------------------------------------------------------------ the plan with no director (section 7.4)
const idSafe = (s, used) => {
	let b = String(s ?? "x").replace(/[^A-Za-z0-9_.@-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "").slice(0, 48) || "x"
	let id = b
	for (let k = 2; used?.has(id); k++) id = `${b}-${k}`
	used?.add(id)
	return id
}
const words = (s, max) => {
	const t = String(s ?? "").replace(/\s+/g, " ").trim()
	return t.length <= max ? t : `${t.slice(0, max - 1).replace(/\s+\S*$/, "")}…`
}
/** The plan when there is no director (the export's "focus" camera, and the safe plan a failed plan falls back to): what the recognizer says the
 *  run is about (web/export/subjects.js: the primaries, the lanes, the setup, each start, the chain's links, the result), each moment held still
 *  and big on its own subjects (FRAMING_RULE: heroes at least 0.09 of the picture, a snug fit, never the table or the wall: the studio look),
 *  a traveller too far-going for a still followed at a calm pace, cut from moment to moment. The run plays at its own pace from 0 to its end, so
 *  video time is run time: any caller that films t = i / fps films it. opts: {width, height, fps, moves (false: holds and cuts only, the safe
 *  plan), environment (a module's world: space keeps its own look)}. -> a valid shot plan (shot-plan.schema.json), with `auto` notes. */
export function autoPlan(world, opts = {}) {
	const W = Math.round(Number(opts.width ?? 1920))
	const H = Math.round(Number(opts.height ?? 1080))
	const fps = Number(opts.fps ?? 60)
	const moves = opts.moves !== false
	const R = world.main
	const rec = R.recog
	const dur = R.dur
	const env = opts.environment ?? R.environment ?? null
	const look = env && env.room === false ? { backdrop: "scene", ground: env.table === false ? "hidden" : "table", light: "room", labels: "scene" } : { backdrop: "studio", tone: "mid", ground: "sweep", light: "subject" }
	const snap = (t) => Math.round(clamp(t, 0, dur) * fps) / fps
	const has = (id) => R.solidsOf.has(id) && R.itemPts(id, null, 0).length > 0
	const subjOf = new Map((rec.subjects ?? []).map((s) => [s.item, s]))
	const primary = (rec.primary ?? []).filter(has)
	const context = (rec.context ?? []).filter(has)
	// (a thing held only by its part near the action, a long ramp or a lane, is never framed whole: it is context)
	const framable = (ids) => {
		const f = ids.filter((id) => subjOf.get(id)?.extent !== "local")
		return f.length ? f : ids
	}
	const nameOf = (id) => R.scene?.items?.find((i) => i.id === id)?.name || id
	// (one run per lane: each run is a lane, its things cast by their own ids, the ones every run has; rows for things that travel across,
	// columns for things that fall or stay put)
	const perRunLanes = () => {
		const runs = [...world.runs.entries()]
		const shared = primary.filter((id) => runs.every(([, Rk]) => Rk.solidsOf.has(id)))
		if (!shared.length) return null
		const across = shared.some((id) => {
			const P0 = R.itemPts(id, null, 0)
			const P1 = R.itemPts(id, null, dur)
			return P0.length && P1.length && Math.abs(centre3(P1)[0] - centre3(P0)[0]) > Math.abs(centre3(P1)[1] - centre3(P0)[1]) + 0.05
		})
		return { arrange: across ? "rows" : "columns", list: runs.map(([lane, Rk]) => ({ id: lane, label: words(Rk.scene?.name || lane, 40), cast: Object.fromEntries(shared.map((id) => [id, id])) })) }
	}
	const lanes = world.single ? autoLanes(R, rec, primary) : perRunLanes()
	const asp = W / H
	const startOf = (id) => R.M.get(`start:${id}`)
	const stopOf = (id) => R.M.get(`stop:${id}`)
	const movers = primary.filter((id) => startOf(id) !== undefined)
	const tFirst = movers.length ? Math.min(...movers.map(startOf)) : null
	const result = (rec.moments ?? []).find((m) => m.kind === "result")
	const tRes = result ? clamp(result.t, 0, dur) : dur
	// ---- a moment's cast as subjects: the lanes' roles (a split picture at one scale), else the things themselves
	const roleOfItem = new Map()
	if (lanes) for (const ln of lanes.list) for (const [role, id] of Object.entries(ln.cast)) roleOfItem.set(id, role)
	const castOf = (ids) => {
		ids = framable([...new Set(ids)].filter(has))
		if (!lanes) return ids.map((id) => ({ item: id }))
		return [...new Set(ids.map((id) => roleOfItem.get(id)).filter(Boolean))].map((r) => ({ role: r }))
	}
	const story = []
	const beat = (id, kind, says) => {
		if (!story.some((b) => b.id === id)) story.push({ id, kind, says: words(says, 200) })
		return id
	}
	const inView = (ids) => (rec.readables ?? []).some((r) => r.kind === "state" && /in or on/.test(r.what ?? "") && r.items?.some((i) => ids.includes(i)))
	/** one shot of the plan (its id is given at the end) */
	const shot = (o) => {
		const c = o.subject ? [o.subject] : castOf(o.ids)
		if (!c.length) return null
		const subject = o.subject ?? (lanes || c.length === 1 ? c[0] : { items: c.map((x) => x.item) })
		const keep = o.keep ?? (lanes ? c.slice(1) : [])
		const names = [...new Set(o.ids)].map(nameOf).slice(0, 4).join(", ")
		// a picture of four things or more shows a whole: the reveal's floor (DIRECTOR.md 7.2: 0.045 in a setup or reveal shot)
		const heroes = lanes ? c.length * lanes.list.length : c.length
		const bt = o.move === "hold" || !o.move ? (heroes >= 4 && o.kind !== "setup" ? beat(`${o.beatId}-all`, "reveal", "all of them together, as one picture") : beat(o.beatId, o.kind, o.says)) : beat(o.beatId, o.kind, o.says)
		const s = {
			id: o.id,
			beat: bt,
			intent: words(o.intent.replace("{names}", names), 240),
			run: { from: `t=${o.from}`, to: `t=${o.to}` },
			in: o.in ?? "cut",
			move: o.move ?? "hold",
			subject,
			...(keep.length ? { keep } : {}),
			frame: o.frame ?? { fit: "snug" },
			view: o.view ?? "side",
			lens: 50,
			...(lanes ? { layout: "split" } : {}),
			...(o.follow ? { follow: o.follow } : {}),
			audit: { question: words(o.question.replace("{names}", names), 200), key: o.key ?? "middle", must_see: c.slice(0, 8) },
		}
		if (o.small) s.audit.small_because = words(o.small, 200)
		return s
	}
	// ---- trial: one shot alone, compiled and measured on this world (its heroes' sizes, its speeds)
	const trial = (s) => {
		const p = { version: 1, about: "a trial of one shot", story: story.filter((b) => b.id === s.beat), look, ...(lanes ? { lanes } : {}), shots: [{ ...s, in: "cut" }] }
		try {
			const r = measure(compile(p, world, { width: W, height: H, fps }))
			const row = r.shots[0]
			const sizes = (row.heroes.length ? row.heroes : row.must).map((h) => h.s)
			const floor = row.wholeShot ? NET.detailS : NET.heroS
			const sizeOk = r.checks.filter((c) => c.check === "subject-size" || c.check === "must-see").every((c) => c.ok)
			const motionOk = r.checks.filter((c) => ["speed", "zoom-rate", "turn-rate", "no-jump", "keep-in"].includes(c.check)).every((c) => c.ok)
			return { ok: true, minHero: sizes.length ? Math.min(...sizes) : 0, floor, sizeOk, motionOk, row }
		} catch (e) {
			return { ok: false, minHero: 0, floor: NET.heroS, sizeOk: false, motionOk: false, error: e.message }
		}
	}
	const actingIds = (a, b) =>
		primary.filter((id) => {
			const s = startOf(id)
			if (s !== undefined) return s < b && (stopOf(id) ?? dur) > a
			const w = subjOf.get(id)?.when
			return Array.isArray(w) && w[0] < b && w[1] > a && (subjOf.get(id)?.roles ?? []).some((r) => r !== "support")
		})
	const notes = []
	const holdFor = (o) => {
		let best = null
		for (const fit of ["snug", "tight"]) {
			const s = shot({ ...o, frame: { fit } })
			if (!s) return null
			const tr = trial(s)
			if (!best || (tr.ok && tr.minHero > best.tr.minHero)) best = { s, tr }
			if (tr.ok && tr.sizeOk) break
		}
		return best
	}
	/** a traveller followed at the closest width a calm follow allows (the background slides at most 1.5 widths a second while it is steady) */
	const followFor = (o, tv, a, b) => {
		const laneOfItem = lanes?.list.find((l) => Object.values(l.cast).includes(tv))?.id
		const subj = lanes ? { role: roleOfItem.get(tv), lane: laneOfItem } : { item: tv }
		const P0 = R.itemPts(tv, null, clamp(startOf(tv) ?? a, a, b))
		const [lo, hi] = boundsOf(P0)
		const Lx = hi[0] - lo[0] || 0.05
		const Hy = hi[1] - lo[1] || 0.05
		let vmax = 0
		const cs = R.seriesOf(tv)
		if (cs) for (let k = Math.max(1, Math.floor(a * R.HZ)); k <= Math.min(cs.length - 1, Math.ceil(b * R.HZ)); k++) vmax = Math.max(vmax, Math.hypot(cs[k][0] - cs[k - 1][0], cs[k][1] - cs[k - 1][1]) * R.HZ)
		const P = []
		for (let j = 0; j <= 20; j++) P.push(...R.itemPts(tv, null, a + ((b - a) * j) / 20))
		const [plo, phi] = boundsOf(P)
		const axis = phi[0] - plo[0] >= (phi[1] - plo[1]) * 0.6 ? (phi[1] - plo[1] > 3 * Hy ? "xy" : "x") : "y"
		const wSize = Math.sqrt(Lx * Hy * asp) / 0.24
		let width = Math.max(wSize, vmax / 1.42, 2.2 * Math.max(Lx, Hy * asp))
		let best = null
		for (let tries = 0; tries < 8; tries++) {
			const s = shot({ ...o, ids: [tv], subject: subj, keep: [], move: "follow", frame: { width: r3(width) }, follow: { axis, lead: 0.15 }, small: width > wSize * 1.6 ? "it moves faster than a calm camera can follow it any closer" : undefined })
			const tr = trial(s)
			if (!tr.ok) break
			if (tr.motionOk) {
				best = { s, tr }
				break
			}
			width *= 1.12
		}
		return best
	}
	/** the action between a and b: one still picture if its heroes come out big; else a chain cut link by link; else its lead traveller followed */
	const planAction = (a, b, depth) => {
		const ids = actingIds(a, b)
		const cast = ids.length ? ids : primary
		const kind = depth ? "chain-step" : "action"
		const base = { id: depth ? "step" : "action", beatId: depth ? `step-${a.toFixed(2)}` : "action", kind, says: depth ? "the next link of the chain" : "what moves, how far, how fast", from: a, to: b, ids: cast, intent: "A still picture of {names} while they move: everything that happens stays in.", question: "Can a child see {names} move?", key: "middle" }
		const hold = holdFor(base)
		if (!hold) return []
		if (hold.tr.ok && hold.tr.sizeOk) return [hold.s]
		// a chain: cut where each other acting thing starts (links at least 1.2 s long), each link framed on its own actors
		if (depth < 3 && b - a >= 2.4) {
			const cuts = [...new Set(ids.map(startOf).filter((t) => t !== undefined).map((t) => snap(t - 0.35)))].filter((t) => t > a + 1.2 && t < b - 1.2).sort((p, q) => p - q)
			const edges = [a]
			for (const t of cuts) if (t - edges[edges.length - 1] >= 1.2) edges.push(t)
			if (b - edges[edges.length - 1] < 1.2 && edges.length > 1) edges.pop()
			edges.push(b)
			if (edges.length > 2) {
				const out = []
				for (let j = 0; j + 1 < edges.length; j++) out.push(...planAction(edges[j], edges[j + 1], depth + 1))
				if (out.length > 1) return out
			}
		}
		// a traveller: an acting mover that sweeps at least 3 times its own size here
		if (moves) {
			const tvs = ids
				.filter((x) => movers.includes(x) && (!lanes || roleOfItem.has(x)))
				.map((x) => {
					const sz = R.sizeOf(x, clamp(startOf(x) ?? a, a, b)) || 0.05
					const P = []
					for (let j = 0; j <= 20; j++) P.push(...R.itemPts(x, null, a + ((b - a) * j) / 20))
					const [lo, hi] = boundsOf(P)
					return { x, sweep: Math.max(hi[0] - lo[0], hi[1] - lo[1]), sz }
				})
				.sort((p, q) => q.sweep - p.sweep)
			// (only a lone traveller is followed: with others on the move too, a follow of one would drop the rest. With lanes a traveller is a
			// role, every lane's copy of it, and the follow rides with the copy that goes farthest: the others ride in their own bands at one scale)
			let going = tvs.filter((v) => v.sweep >= 1.5 * v.sz)
			if (lanes) {
				const first = new Map()
				for (const v of going) if (!first.has(roleOfItem.get(v.x))) first.set(roleOfItem.get(v.x), v) // (the copy that goes farthest)
				going = [...first.values()]
			}
			if (going.length === 1 && going[0].sweep >= 3 * going[0].sz) {
				const f = followFor({ ...base, intent: "Go with {names}: it stays big while the world slides past.", question: "Can a child see {names} all the way?" }, going[0].x, a, b)
				if (f && (f.tr.sizeOk || f.tr.minHero > hold.tr.minHero * 1.15)) {
					if (!f.tr.sizeOk) notes.push(`${base.id} ${r3(a)}-${r3(b)} s: ${going[0].x} at ${r3(f.tr.minHero)} of the picture while it is followed (floor ${NET.heroS}): it moves faster than a calm follow can keep it bigger`)
					f.s.__traveller = going[0].x
					return [f.s]
				}
			}
		}
		if (hold.tr.ok && !hold.tr.sizeOk) notes.push(`${base.id} ${r3(a)}-${r3(b)} s: its smallest hero is ${r3(hold.tr.minHero)} of the picture (floor ${r3(hold.tr.floor)}): framing-infeasible here without a bigger thing or a shorter stretch`)
		return [hold.s]
	}
	const shots = []
	// ---- the setup: until shortly before the first thing moves
	let tA = tFirst !== null ? snap(Math.max(0, tFirst - 0.35)) : snap(dur)
	if (tA >= 0.8 && primary.length) {
		const setupCtx = ((rec.moments ?? []).find((m) => m.kind === "setup")?.context ?? []).filter((id) => context.includes(id))
		const h = holdFor({ id: "setup", beatId: "setup", kind: "setup", says: "what is there, ready, before anything moves", from: 0, to: tA, ids: [...primary, ...setupCtx], intent: "Everything the video is about, still, before it starts: {names}.", question: "Can a child see {names} before anything moves?", key: "middle" })
		if (h) shots.push(h.s)
	} else tA = 0
	// ---- the result: from when it is decided to the end, if that is long enough to read
	let tB = tFirst !== null ? snap(Math.max(tA + 0.8, tRes)) : snap(dur)
	if (dur - tB < 1.2) tB = snap(dur)
	if (tB - tA >= 0.8 - 1e-9 && (tFirst !== null || !shots.length)) shots.push(...planAction(tA, tB, 0))
	if (tB < dur - 1e-9) {
		const ids = (result?.hold ?? []).filter(has)
		const rids = ids.length ? ids : primary
		const h = holdFor({ id: "result", beatId: "result", kind: "result", says: "what is left: how it ended", from: tB, to: snap(dur), ids: rids, view: inView(rids) ? "high" : "side", intent: "Where {names} ended up, still and big.", question: "Can a child see where {names} ended up?", key: "end" })
		if (h) shots.push(h.s)
	}
	// ---- a video ends on a still: a follow that runs to the end hands over to a hold of what the traveller comes to rest on (its last 0.9 to
	// 1.2 s, glided into); a follow too short for that becomes a hold
	const lastShot = shots[shots.length - 1]
	if (lastShot && lastShot.move === "follow") {
		const a = Number(lastShot.run.from.slice(2))
		const b = snap(dur)
		const tv = lastShot.__traveller
		if (b - a >= 1.8 && tv) {
			const restT = Math.min(1.2, (b - a) / 2)
			const cut = snap(b - restT)
			lastShot.run.to = `t=${cut}`
			const P = R.itemPts(tv, null, b)
			const c = P.length ? centre3(P) : null
			const near = (result?.hold ?? []).filter((id) => has(id) && id !== tv && c && (() => {
				const Q = R.itemPts(id, null, b)
				if (!Q.length) return false
				const [lo, hi] = boundsOf(Q)
				const w = Number(lastShot.frame?.width ?? 1)
				return c[0] > lo[0] - w && c[0] < hi[0] + w && c[1] > lo[1] - w && c[1] < hi[1] + w
			})())
			const h = holdFor({ id: "rest", beatId: "result", kind: "result", says: "what is left: how it ended", from: cut, to: b, ids: [tv, ...near], intent: "The follow comes to rest on {names}.", question: "Can a child see where {names} ended up?", key: "end" })
			if (h) shots.push({ ...h.s, in: { ease: r3(Math.max(0.3, restT - 0.6)) } })
		} else if (b - a < 1.8) {
			const h = holdFor({ id: lastShot.id, beatId: lastShot.beat, kind: "action", says: "what moves, how far, how fast", from: a, to: b, ids: tv ? [tv] : [], intent: "A still picture of {names} while they move: everything that happens stays in.", question: "Can a child see {names} move?", key: "middle" })
			if (h) shots[shots.length - 1] = { ...h.s, in: lastShot.in }
		}
	}
	for (const x of shots) delete x.__traveller
	if (!shots.length) {
		const ids = primary.length ? primary : R.itemIds().filter((id) => has(id) && !(rec.scenery ?? []).some((x) => x.item === id))
		const h = holdFor({ id: "whole", beatId: "whole", kind: "reveal", says: "the whole of it", from: 0, to: snap(dur), ids: ids.length ? ids : R.itemIds().filter(has), intent: "The whole scene, still.", question: "Can a child see the whole scene?", key: "middle" })
		if (h) shots.push(h.s)
	}
	// ---- contiguous run windows (video time is run time), the last to the end; unique ids
	const used = new Set()
	for (let j = 0; j < shots.length; j++) {
		shots[j].id = idSafe(shots[j].id, used)
		shots[j].run.from = j === 0 ? "t=0" : shots[j - 1].run.to
		if (j === shots.length - 1) shots[j].run.to = `t=${snap(dur)}`
	}
	const usedBeats = new Set(shots.map((s) => s.beat))
	const plan = {
		version: 1,
		title: words(`${R.scene?.name || R.doc.id || "The run"}`, 80),
		about: words(`What happens in ${R.scene?.name || R.doc.id || "this scene"}${(R.sim.summary?.goals ?? []).length ? `: ${R.sim.summary.goals.map((g) => g.label).filter(Boolean).join("; ")}` : ""}`, 240),
		source: { kind: "demo", ...(R.scene?.name ? { scene: words(R.scene.name, 120) } : {}) },
		story: story.filter((b) => usedBeats.has(b.id)),
		output: { fps: fps === 30 ? 30 : 60 },
		...(lanes ? { lanes } : {}),
		look,
		shots,
		notes: "",
	}
	if (!plan.story.length) plan.story = [{ id: "whole", kind: "reveal", says: "the whole of it" }]
	// ---- joins: no jump cuts (a cut to almost the same picture glides instead), glides slow enough, and the last shot still at its end
	const scaleGlided = new Set()
	for (let pass = 0; pass < 4; pass++) {
		let rep
		try {
			rep = measure(compile(plan, world, { width: W, height: H, fps, kind: "focus" }))
		} catch (e) {
			notes.push(`compile: ${e.message}`)
			break
		}
		let changed = false
		for (const c of rep.checks) {
			if (c.ok) continue
			const k = plan.shots.findIndex((x) => x.id === c.shot)
			const s = plan.shots[k]
			if (!s || k === 0) continue
			const T = Number(s.run.to.slice(2)) - Number(s.run.from.slice(2))
			const cap = k === plan.shots.length - 1 ? Math.max(0.3, T - 0.6) : Math.max(0.3, T - 0.2)
			if (c.check === "cut" && s.in === "cut") {
				s.in = { ease: r3(Math.min(0.8, cap)) }
				changed = true
			} else if (c.check === "cut-scale" && s.in === "cut" && !scaleGlided.has(s.id)) {
				// (a big jump in scale into moving action glides as long as the shot allows; a glide too fast for that stays a cut)
				scaleGlided.add(s.id)
				s.in = { ease: r3(cap) }
				changed = true
			} else if ((c.check === "speed" || c.check === "zoom-rate" || c.check === "no-jump") && s.in && typeof s.in === "object") {
				if (s.in.ease < cap - 1e-6) s.in = { ease: r3(Math.min(cap, s.in.ease * 1.6)) }
				else s.in = "cut"
				changed = true
			} else if (c.check === "settled" && s.in && typeof s.in === "object" && s.in.ease > cap + 1e-6) {
				s.in = { ease: r3(cap) }
				changed = true
			}
		}
		if (!changed) break
	}
	plan.notes = words(["Automatic plan (no director): the recognizer's subjects and moments, held still and big, cut by moment.", ...notes].join(" "), 1200)
	return plan
}
/** The lanes of a comparison filmed in one scene (the recognizer's lanes and pairs) as a plan's lanes: each pair a role named by its type, the
 *  higher lane first (stacked lanes), else left to right; rows for horizontal action, columns for falls and compact pairs. */
function autoLanes(R, rec, primary) {
	const L = rec.lanes
	if (!Array.isArray(L) || L.length < 2 || !Array.isArray(rec.pairs) || !rec.pairs.length) return null
	const centreOf = (ids) => {
		const P = ids.flatMap((id) => R.itemPts(id, null, 0))
		return P.length ? centre3(P) : null
	}
	const lanes = L.map((l) => ({ ...l, c: centreOf(l.items) })).filter((l) => l.c)
	if (lanes.length < 2) return null
	const xs = lanes.map((l) => l.c[0])
	const ys = lanes.map((l) => l.c[1])
	const stacked = Math.max(...ys) - Math.min(...ys) > Math.max(...xs) - Math.min(...xs)
	lanes.sort((a, b) => (stacked ? b.c[1] - a.c[1] : a.c[0] - b.c[0]))
	const typeOf = (id) => R.solidsOf.get(id)?.[0]?.itemType ?? id
	const used = new Set()
	const roles = []
	for (const pair of rec.pairs) {
		const per = lanes.map((l) => pair.find((id) => l.items.includes(id)) ?? null)
		if (per.filter(Boolean).length < 2) continue
		roles.push({ name: idSafe(typeOf(per.find(Boolean)), used), per })
	}
	if (!roles.length) return null
	for (let i = 0; i < lanes.length; i++)
		for (const id of lanes[i].items) if (!roles.some((r) => r.per[i] === id) && primary.includes(id)) roles.push({ name: idSafe(typeOf(id), used), per: lanes.map((_, j) => (j === i ? id : null)) })
	// every other thing of a type that comes once in each lane (a lane's floor and bumper, a ramp's blocks) joins its nearest lane as a role
	// too: a band then leaves the other lanes' copies out
	const taken = new Set(roles.flatMap((r) => r.per.filter(Boolean)))
	const scen = new Set((rec.scenery ?? []).map((x) => x.item))
	const byType = new Map()
	for (const id of R.itemIds()) {
		if (taken.has(id) || scen.has(id) || !R.itemPts(id, null, 0).length) continue
		const ty = typeOf(id)
		if (!byType.has(ty)) byType.set(ty, [])
		byType.get(ty).push(id)
	}
	for (const [ty, ids] of byType) {
		if (ids.length !== lanes.length) continue
		const per = lanes.map(() => null)
		const left = ids.map((id) => ({ id, c: centreOf([id]) }))
		for (let i = 0; i < lanes.length; i++) {
			let best = -1
			for (let j = 0; j < left.length; j++) if (left[j] && (best < 0 || Math.hypot(left[j].c[0] - lanes[i].c[0], left[j].c[1] - lanes[i].c[1]) < Math.hypot(left[best].c[0] - lanes[i].c[0], left[best].c[1] - lanes[i].c[1]))) best = j
			if (best >= 0) {
				per[i] = left[best].id
				left[best] = null
			}
		}
		if (per.every(Boolean)) roles.push({ name: idSafe(ty, used), per })
	}
	// rows for horizontal action (a lane's things sweep wider than tall over the run: cars, boats), columns otherwise (falls, compact pairs):
	// measured within each lane, never across them (lanes side by side would look wide)
	let wide = 0
	for (let i = 0; i < lanes.length; i++) {
		const P = []
		for (const r of roles) if (r.per[i]) for (let k = 0; k <= 10; k++) P.push(...R.itemPts(r.per[i], null, (R.dur * k) / 10))
		if (!P.length) continue
		const [lo, hi] = boundsOf(P)
		wide += hi[0] - lo[0] >= (hi[1] - lo[1]) * 1.2 ? 1 : -1
	}
	const arrange = wide > 0 ? "rows" : "columns"
	const nameOf = (id) => R.scene?.items?.find((i) => i.id === id)?.name || id
	const usedL = new Set()
	return {
		arrange,
		list: lanes.map((l, i) => ({
			id: idSafe(l.id, usedL),
			label: words(nameOf(roles[0].per[i] ?? l.items[0]), 40),
			cast: Object.fromEntries(roles.filter((r) => r.per[i]).map((r) => [r.name, r.per[i]])),
		})),
	}
}
