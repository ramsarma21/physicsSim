/**
 * The measure module's instruments (machines/mod_measure.py builds their records; web/sim/modules/measure.js the same in the browser).
 * Each reads the run every 480 Hz step and sets its readings (plugins.ts ctx.set → track.state[item][key], 5 decimals); a key that is
 * set only once, when it becomes known (a stopwatch's start_s and stop_s, a gate's speed), reads that value in every frame of the track
 * (plugins.ts Readings.series gives earlier frames a column's first value), so the view draws a frozen time exactly from them.
 *
 *   measure-stopwatch {watch (item id | null), start: "release" | "moves" | "crosses", stop: "crosses" | "stops" | "hits" | "at" | "never",
 *                      start_x?, stop_x? (m), stop_at (s), reaction (s), lesson (bool)}
 *        start: release = the scene's release (doc.release.at); moves = the watched item has moved 1 mm (interpolated between steps);
 *        crosses = its FRONT (its outline's extreme toward the line, by where its middle starts) reaches x = start_x. stop: crosses = the
 *        front reaches stop_x; stops = it has stayed within 1 mm for 0.25 s (stopped where that stillness began); hits = one of its solids
 *        first touches a solid it did not touch when the watch started (timed where the gap between them closes to the 0.5 mm contact skin,
 *        from the last steps' outlines); at = stop_at s after the start; never. reaction (a person's
 *        hand, [HUMAN-RT] 0.2-0.25 s) delays the presses that answer something seen (moves, crosses, stops, hits), not a release.
 *        Readings: seconds (elapsed, frozen at the stop), meters (how far the item's centre of mass moved since the start), running (0/1),
 *        start_s and stop_s (set once each), lesson_s (seconds x the time-lapse, when lesson).
 *        With no watched item (none linked, or its link names nothing) a watch that starts at the release and stops `at` or `never` runs as a
 *        clock; any other reads 0 (the layout's warnings say why: mod_measure.py link_warnings).
 *   measure-tape {watch, zero, dir (+1 / -1), point: "front" | "back" | "centre", length}   meters = (the point's x - zero) x dir, every step,
 *        within the tape (0 … length); past_end 1 while the point is beyond the tape's end.
 *   measure-gate {watch | null, x, y (the beam), pair (item id | null)}   the beam (across the track at (x, y)) is blocked while a solid's
 *        outline covers that point: entered_s, exit_s (interpolated where its front, then its back, passes the point along its motion), blocked_s, length (m:
 *        the thing's chord through the beam's point along the way it moves as it enters: the photogate's "flag"), speed = length /
 *        blocked_s [VERNIER], between_s (since the pair gate's entry). A car passing level or a ball falling through: the same rule.
 *   measure-speed {watch, kmh}   speed (m/s now, of its centre of mass), top, mean (path / time since it began to move).
 *   measure-spring {case, hook, aA, aB (anchors in their solids' frames), stiffness, rest, hook_mass, range?, stop?}   newtons = k (|AB| - rest)
 *        - the hook's weight (a zeroed scale), smoothed over 0.2 s; grams = newtons / 9.81 (a scale shows weight in grams as calibrated on
 *        Earth: 1 kg on the Moon reads 165 g); stretch (m); over (1 past its range). `stop`: the hook's travel ends there (|AB| at most stop,
 *        a planck rope joint made at the start: the hook bottoms out at the end of the tube, about 5 % past full scale).
 *   measure-scale {platform (solid id), tare (bool), capacity (kg)}   what rests on the platform (moving solids touching it, or touching
 *        what touches it, and not touching another fixed solid; whole items): F = sum of m (g + a_y), smoothed over 0.05 s (a load cell's
 *        filter, which starts settled on what rests on it at the release); grams = F / g x 1000 (less, when tare, the weight Σ m·g of what
 *        rests on it at the release: the first step that sees contacts; never what lands on it later), newtons, over (1 past capacity);
 *        g here is 9.81, the Earth's, whatever the run's gravity: a load cell is calibrated on Earth and shows weight (a 1 kg mass on the Moon
 *        reads 165 g; a pan balance, comparing masses, reads the same anywhere);
 *        the frames before that step read that first reading (what was set on it, from the start of the run).
 *   measure-balance {beam, left?, right? (each pan's solids)}   tilt (°, the right pan down positive), heavier (-1 left, 0 level within 0.5°,
 *        1 right), left_g and right_g (the mass resting in each pan: things touching it, or touching what touches it, not leaning on another
 *        fixed solid; whole items). Its beam never sleeps (planck's sleep would freeze it at a stop, or level at low gravity).
 *   measure-mark {zero?, start?, finish? | x}   nothing runs: a lane's or a line's marks in world x, for the goal checks that have only the
 *        document (ai/goals.mjs on a run without its scene).
 *   measure-angle {watch}   degrees (now: a pivoted solid's turn from hanging straight, 0..180; else its slope from level, 0..90), swing
 *        (half its whole swing since the start, °).
 *   measure-ranger {x, y, dx, dy, near, far}   distance (m) to the nearest solid along its ray (not its own item; nothing nearer than
 *        `near`; `far` when nothing within reach), 120 times a second.
 * Deterministic: + − × ÷, Math.sqrt / abs / min / max and the engine's sin, cos, atan2, hypot.
 */
import { RopeJoint, Vec2 } from "planck"
import { type Point, type ProcessContext, type ProcessKind, type ProcessRecord, type SolidHandle, STANDARD } from "#sim/plugins.ts"

const MOVE_M = 0.001
const STILL_S = 0.25
const R2D = 180 / Math.PI
/** The g a scale's grams are worked out with: the engine's Earth (9.81 m/s²). A spring scale or a load cell is calibrated on Earth and shows
 *  weight: on the Moon (1.62 m/s²) 1 kg reads 1000 × 1.62 / 9.81 = 165 g (NASA Moon fact sheet: g = 1.62 m/s²). */
const G_CAL = STANDARD.gravity

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d)
/**
 * The moment the bodies stand at now: a process's step runs before the engine's step at ctx.time() is solved, so what it sees is where the
 * previous step left them, the track's frame of one step earlier (physics.ts records each step's result under its own time).
 */
const observed = (ctx: ProcessContext) => Math.max(0, ctx.time() - ctx.step)
const str = (v: unknown) => (typeof v === "string" ? v : null)

/** The item's moving solids (all of them when none moves). */
const solidsOf = (ctx: ProcessContext, item: string | null): readonly SolidHandle[] => {
	if (item === null) return []
	const all = ctx.solidsOf(item)
	const dyn = all.filter((h) => h.dynamic)
	return dyn.length ? dyn : all
}

/** The x extent [lo, hi] of a solid's outline now. */
const span = (h: SolidHandle): [number, number] => {
	const o = h.outline()
	if (o.circle !== undefined) return [o.circle.x - o.circle.r, o.circle.x + o.circle.r]
	let lo = Infinity
	let hi = -Infinity
	for (const p of o.points ?? []) {
		if (p.x < lo) lo = p.x
		if (p.x > hi) hi = p.x
	}
	return [lo, hi]
}
/** The x extent [lo, hi] of the solids' outlines now. */
const extent = (hs: readonly SolidHandle[]): [number, number] => {
	let lo = Infinity
	let hi = -Infinity
	for (const h of hs) {
		const [a, b] = span(h)
		if (a < lo) lo = a
		if (b > hi) hi = b
	}
	return [lo, hi]
}
/** The solids' centre of mass now (their own origins weighted by their masses; the mean when they weigh nothing). */
const middle = (hs: readonly SolidHandle[]): Point => {
	let m = 0
	let x = 0
	let y = 0
	for (const h of hs) {
		const w = h.mass()
		const p = h.pose()
		m += w
		x += w * p.x
		y += w * p.y
	}
	if (m > 0) return { x: x / m, y: y / m }
	let sx = 0
	let sy = 0
	for (const h of hs) {
		const p = h.pose()
		sx += p.x
		sy += p.y
	}
	return { x: sx / Math.max(1, hs.length), y: sy / Math.max(1, hs.length) }
}
/** The farthest any of the solids is from where it was (poses kept in `from`). */
const movedFrom = (hs: readonly SolidHandle[], from: ReadonlyMap<string, Point>) => {
	let d = 0
	for (const h of hs) {
		const p = h.pose()
		const q = from.get(h.id)
		if (q === undefined) continue
		const e = Math.hypot(p.x - q.x, p.y - q.y)
		if (e > d) d = e
	}
	return d
}
const posesOf = (hs: readonly SolidHandle[]) => new Map(hs.map((h) => [h.id, { x: h.pose().x, y: h.pose().y }] as const))

type Outline = ReturnType<SolidHandle["outline"]>
/** The distance from p to the segment ab. */
const segDist = (p: Point, a: Point, b: Point) => {
	const ex = b.x - a.x
	const ey = b.y - a.y
	const L2 = ex * ex + ey * ey
	const u = L2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / L2)) : 0
	return Math.hypot(p.x - a.x - u * ex, p.y - a.y - u * ey)
}
/** How far p is outside a convex counter-clockwise outline (negative inside: minus its depth). */
const outside = (p: Point, pts: readonly Point[]) => {
	let inside = true
	let near = Infinity
	for (let i = 0; i < pts.length; i++) {
		const a = pts[i] as Point
		const b = pts[(i + 1) % pts.length] as Point
		if ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) < 0) inside = false
		const d = segDist(p, a, b)
		if (d < near) near = d
	}
	return inside ? -near : near
}
/** The gap between two outlines (m; 0 or less when they overlap): circles, a circle and a polygon, two polygons (their nearest corner to side). */
const gapOf = (a: Outline, b: Outline): number => {
	if (a.circle !== undefined && b.circle !== undefined) return Math.hypot(a.circle.x - b.circle.x, a.circle.y - b.circle.y) - a.circle.r - b.circle.r
	if (a.circle !== undefined) return outside(a.circle, b.points ?? []) - a.circle.r
	if (b.circle !== undefined) return outside(b.circle, a.points ?? []) - b.circle.r
	const pa = a.points ?? []
	const pb = b.points ?? []
	let g = Infinity
	for (const p of pa) g = Math.min(g, outside(p, pb))
	for (const p of pb) g = Math.min(g, outside(p, pa))
	return g
}
/** Touching: within the engine's contact skin (the gap a ball resting on a slab keeps, 0.5 mm: planck's slop at LENGTH_SCALE 10). */
const SKIN = 0.0005

/** Where the time of a level crossing falls between the step before (value a at time ta) and now (b at tb). */
const between = (ta: number, a: number, tb: number, b: number, level: number) => (b === a ? tb : ta + ((level - a) * (tb - ta)) / (b - a))

/** A line's front edge: the extent's end toward the line, from where the item's middle is when the watch starts looking. */
const frontEdge = (hs: readonly SolidHandle[], dir: number) => {
	const [lo, hi] = extent(hs)
	return dir > 0 ? hi : lo
}

// ---------------------------------------------------------------- stopwatch
const stopwatch: ProcessKind = {
	kind: "measure-stopwatch",
	create(r: ProcessRecord) {
		const item = r.item as string
		const watch = str(r.watch)
		const start = str(r.start) ?? "release"
		const stop = str(r.stop) ?? "crosses"
		const startX = typeof r.start_x === "number" ? r.start_x : null
		const stopX = typeof r.stop_x === "number" ? r.stop_x : null
		const stopAt = num(r.stop_at, 3)
		const reaction = Math.max(0, num(r.reaction, 0))
		const lesson = r.lesson === true
		// (nothing to watch: a watch started by the release and stopped after set seconds, or never, is a plain clock)
		let clock = false
		let hs: readonly SolidHandle[] = []
		let first = true
		let t0: number | null = null // the start press (with any reaction)
		let begun = false // the watch's own start was set up (its references taken)
		let t1: number | null = null // the stop press
		let pending: number | null = null // a stop event seen, its press (reaction) still to come
		let prevT = 0
		let prevMoved = 0
		let prevFront = 0
		let prevMeters = 0
		let startDir = 1
		let stopDir = 1
		let startPast = false // the front is at or past the start line when the run begins: it starts when it moves
		let home = new Map<string, Point>()
		let mid0: Point = { x: 0, y: 0 }
		let restRef = new Map<string, Point>()
		let restT = 0
		let touched0 = new Set<string>()
		// the watched solids' outlines over the last few steps: a hit is timed where the gap to what it struck closed (the engine reports a contact a
		// step or two after the step that made it)
		const history: { t: number; outlines: Map<string, Outline> }[] = []
		const hitTime = (ctx: ProcessContext, other: string, t: number) => {
			const o = ctx.solid(other)?.outline()
			if (o === undefined) return t
			const gaps = history.map((h) => {
				let g = Infinity
				for (const out of h.outlines.values()) g = Math.min(g, gapOf(out, o))
				return { t: h.t, g }
			})
			// the last step that still closed the gap: the surfaces met during it (or meet just after it), at the rate the gap was closing
			// (the engine leaves a struck body where its contact left it at the step's end, maybe already bouncing away)
			const n = gaps.length
			let k = -1
			for (let i = n - 1; i >= 1; i--) {
				if ((gaps[i] as { g: number }).g < (gaps[i - 1] as { g: number }).g) {
					k = i
					break
				}
			}
			if (k < 1) return n && (gaps[n - 1] as { g: number }).g <= SKIN ? (gaps[n - 1] as { t: number }).t : t
			const gk = gaps[k] as { t: number; g: number }
			const gp = gaps[k - 1] as { t: number; g: number }
			// at the rate it closed the step before: where that reaches the skin, if it does so within step k (a body that struck and bounced
			// within the step ends it where its contact left it: this step's own change understates its approach)
			const z = k >= 2 ? (gaps[k - 2] as { t: number; g: number }) : null
			if (z !== null && z.g > gp.g) {
				const t1 = gp.t + (gp.g - SKIN) / ((z.g - gp.g) / (gp.t - z.t))
				if (t1 <= gk.t) return Math.max(gp.t, t1)
			}
			if (gk.g <= SKIN) return between(gp.t, gp.g, gk.t, gk.g, SKIN)
			// still apart at the end of step k: it meets the skin after it, closing at this step's rate
			const rate = (gp.g - gk.g) / (gk.t - gp.t)
			const until = k < n - 1 ? (gaps[k + 1] as { t: number }).t : gk.t + 2 * ctx.step
			return rate > 0 ? Math.min(until, gk.t + (gk.g - SKIN) / rate) : gk.t
		}
		const set = (ctx: ProcessContext, seconds: number, meters: number, running: number) => {
			ctx.set(item, "seconds", seconds)
			ctx.set(item, "meters", meters)
			ctx.set(item, "running", running)
			if (lesson) ctx.set(item, "lesson_s", seconds * ctx.settings.timeLapse)
		}
		const touchedBy = (ctx: ProcessContext) => {
			const out = new Set<string>()
			for (const h of hs) for (const id of ctx.touching(h.id)) if (!id.startsWith(`${watch}/`)) out.add(id)
			return out
		}
		return {
			start(ctx) {
				hs = solidsOf(ctx, watch)
				clock = hs.length === 0 && start === "release" && (stop === "at" || stop === "never")
				set(ctx, 0, 0, 0)
			},
			step(ctx) {
				const t = observed(ctx)
				if ((hs.length === 0 && !clock) || t1 !== null) return
				if (stop === "hits") {
					history.push({ t, outlines: new Map(hs.map((h) => [h.id, h.outline()] as const)) })
					if (history.length > 6) history.shift()
				}
				if (first) {
					first = false
					home = posesOf(hs)
					const m0 = middle(hs)
					if (startX !== null) startDir = m0.x <= startX ? 1 : -1
					if (stopX !== null) stopDir = m0.x <= stopX ? 1 : -1
					if (start === "crosses" && startX !== null) {
						prevFront = frontEdge(hs, startDir)
						startPast = (prevFront - startX) * startDir >= 0
					}
					prevT = t
				}
				// ---- the start
				if (t0 === null) {
					let ev: number | null = null
					if (start === "release") {
						const at = ctx.scene.release.at
						if (t >= at) ev = at
					} else if (start === "crosses" && startX !== null && !startPast) {
						const f = frontEdge(hs, startDir)
						if ((f - startX) * startDir >= 0) ev = between(prevT, prevFront, t, f, startX)
						prevFront = f
					} else {
						const d = movedFrom(hs, home)
						if (d > MOVE_M) ev = between(prevT, prevMoved, t, d, MOVE_M)
						prevMoved = d
					}
					if (ev !== null) t0 = start === "release" ? ev : ev + reaction
				}
				if (t0 === null || t < t0) {
					prevT = t
					return
				}
				if (!begun) {
					// the watch starts now: what it measures from
					begun = true
					ctx.set(item, "start_s", t0)
					mid0 = middle(hs)
					restRef = posesOf(hs)
					restT = t
					touched0 = touchedBy(ctx)
					if (stopX !== null) prevFront = frontEdge(hs, stopDir)
					prevT = t
					prevMeters = 0
				}
				// ---- running: the stop
				const m = middle(hs)
				const meters = Math.hypot(m.x - mid0.x, m.y - mid0.y)
				let ev: number | null = null
				if (pending === null) {
					if (stop === "crosses" && stopX !== null) {
						const f = frontEdge(hs, stopDir)
						if ((f - stopX) * stopDir >= 0) pending = Math.max(t0, between(prevT, prevFront, t, f, stopX)) + reaction
						prevFront = f
					} else if (stop === "stops") {
						if (movedFrom(hs, restRef) > MOVE_M) {
							restRef = posesOf(hs)
							restT = t
						} else if (t - restT >= STILL_S) pending = restT + reaction
					} else if (stop === "hits") {
						for (const id of touchedBy(ctx)) {
							if (!touched0.has(id)) {
								pending = Math.max(t0, hitTime(ctx, id, t)) + reaction
								break
							}
						}
					} else if (stop === "at") pending = t0 + stopAt
				}
				if (pending !== null && t >= pending) ev = pending
				if (ev !== null) {
					t1 = Math.max(ev, t0)
					ctx.set(item, "stop_s", t1)
					// (the distance at the stop: between the step before and now, or now when the stop was in the past: it was still)
					const u = t1 >= prevT && t > prevT ? Math.min(1, (t1 - prevT) / (t - prevT)) : 1
					set(ctx, t1 - t0, prevMeters + (meters - prevMeters) * u, 0)
				} else {
					// (still running: what it shows on the frame this step is recorded under, the engine's time after the step)
					set(ctx, Math.max(0, ctx.time() - t0), meters, 1)
					prevMeters = meters
				}
				prevT = t
			}
		}
	}
}

// ---------------------------------------------------------------- measuring tape
const tape: ProcessKind = {
	kind: "measure-tape",
	create(r) {
		const item = r.item as string
		const watch = str(r.watch)
		const zero = num(r.zero, 0)
		const dir = num(r.dir, 1) < 0 ? -1 : 1
		const point = str(r.point) ?? "front"
		const length = num(r.length, Infinity)
		let hs: readonly SolidHandle[] = []
		const read = (ctx: ProcessContext) => {
			if (!hs.length) return
			const [lo, hi] = extent(hs)
			const x = point === "centre" ? middle(hs).x : point === "back" ? (dir > 0 ? lo : hi) : dir > 0 ? hi : lo
			// (a tape reads only along itself: 0 at its zero end, its length at its far end; past the end it says so)
			const along = (x - zero) * dir
			ctx.set(item, "meters", Math.min(length, Math.max(0, along)))
			ctx.set(item, "past_end", along > length ? 1 : 0)
		}
		return {
			start(ctx) {
				hs = solidsOf(ctx, watch)
				read(ctx)
			},
			step: read
		}
	}
}

// ---------------------------------------------------------------- speed gate
/** How far inside a solid's outline the point p is (negative) or how far outside it (positive): the beam is blocked at 0 or less. */
const depthAt = (h: SolidHandle, p: Point) => {
	const o = h.outline()
	if (o.circle !== undefined) return Math.hypot(p.x - o.circle.x, p.y - o.circle.y) - o.circle.r
	return outside(p, o.points ?? [])
}
/** Where the line through p along the unit direction u enters and leaves a solid's outline: [s0, s1] (distances along u from p), or null. */
const chordAlong = (h: SolidHandle, p: Point, u: Point): [number, number] | null => {
	const o = h.outline()
	if (o.circle !== undefined) {
		const cx = o.circle.x - p.x
		const cy = o.circle.y - p.y
		const along = cx * u.x + cy * u.y
		const q = o.circle.r * o.circle.r - (cx * cx + cy * cy - along * along)
		if (q < 0) return null
		const w = Math.sqrt(q)
		return [along - w, along + w]
	}
	// Cyrus-Beck against a convex counter-clockwise outline
	const pts = o.points ?? []
	let s0 = -Infinity
	let s1 = Infinity
	for (let i = 0; i < pts.length; i++) {
		const a = pts[i] as Point
		const b = pts[(i + 1) % pts.length] as Point
		const nx = b.y - a.y // (the outward normal of a counter-clockwise side)
		const ny = -(b.x - a.x)
		const num = nx * (a.x - p.x) + ny * (a.y - p.y)
		const den = nx * u.x + ny * u.y
		if (Math.abs(den) < 1e-15) {
			if (num < 0) return null
			continue
		}
		const t = num / den
		if (den > 0) s1 = Math.min(s1, t)
		else s0 = Math.max(s0, t)
		if (s0 > s1) return null
	}
	return s0 <= s1 ? [s0, s1] : null
}
const gate: ProcessKind = {
	kind: "measure-gate",
	create(r) {
		const item = r.item as string
		const watch = str(r.watch)
		const beam: Point = { x: num(r.x, 0), y: num(r.y, 0) }
		const pair = str(r.pair)
		let hs: readonly SolidHandle[] = []
		let anyone = false
		let state: "clear" | "blocked" | "done" = "clear"
		let prevT = 0
		let prev: [number, number] | null = null // the thing's chord through the beam's point along its motion, the step before
		let u: Point = { x: 1, y: 0 }
		let entered = 0
		let length = 0
		/** The direction the thing moves now (its centre of mass's), kept when it is at rest. */
		const heading = () => {
			let vx = 0
			let vy = 0
			for (const h of hs) {
				const w = h.mass()
				const v = h.velocity()
				vx += w * v.x
				vy += w * v.y
			}
			const sp = Math.hypot(vx, vy)
			if (sp > 1e-6) u = { x: vx / sp, y: vy / sp }
			return u
		}
		/** The thing's chord through the beam's point along u: [s0, s1] (signed distances along u from the point: its back and its front), or null. */
		const chord = (dir: Point): [number, number] | null => {
			let s0 = Infinity
			let s1 = -Infinity
			for (const h of hs) {
				const c = chordAlong(h, beam, dir)
				if (c === null) continue
				s0 = Math.min(s0, c[0])
				s1 = Math.max(s1, c[1])
			}
			return s1 >= s0 ? [s0, s1] : null
		}
		return {
			start(ctx) {
				hs = solidsOf(ctx, watch)
				if (!hs.length) {
					anyone = true
					hs = ctx.all().filter((h) => h.dynamic && h.item !== item)
				}
			},
			step(ctx) {
				const t = observed(ctx)
				if (state === "done" || !hs.length) return
				if (anyone && state === "clear") {
					// (no linked item: the first thing whose outline covers the beam is the one it times)
					const by = hs.find((h) => depthAt(h, beam) <= 0)
					if (by === undefined) {
						prevT = t
						return
					}
					anyone = false
					hs = solidsOf(ctx, by.item)
					prev = null
				}
				const dir = heading()
				const c = chord(dir)
				// blocked while the point is inside its outline: its back behind the point and its front past it (s0 ≤ 0 ≤ s1)
				const covers = c !== null && c[0] <= 0 && c[1] >= 0
				if (state === "clear" && covers) {
					// it entered between the step before and now: where its front (s1) passed the point (its chord moves with it)
					entered = prev !== null && prev[1] < 0 ? between(prevT, prev[1], t, (c as [number, number])[1], 0) : t
					length = (c as [number, number])[1] - (c as [number, number])[0] // its length through the beam along its motion: a photogate's "flag"
					state = "blocked"
					ctx.set(item, "entered_s", entered)
					if (pair !== null) {
						const e = ctx.get(pair, "entered_s")
						if (e !== undefined) ctx.set(item, "between_s", entered - e)
					}
				} else if (state === "blocked" && !covers) {
					// it left where its back (s0) passed the point
					const left = Math.max(entered, prev !== null && c !== null && prev[0] <= 0 ? between(prevT, prev[0], t, c[0], 0) : t)
					const blocked = left - entered
					ctx.set(item, "exit_s", left)
					ctx.set(item, "blocked_s", blocked)
					ctx.set(item, "length", length)
					if (blocked > 0) ctx.set(item, "speed", length / blocked)
					state = "done"
				}
				prev = c
				prevT = t
			}
		}
	}
}

// ---------------------------------------------------------------- speedometer
const speed: ProcessKind = {
	kind: "measure-speed",
	create(r) {
		const item = r.item as string
		const watch = str(r.watch)
		let hs: readonly SolidHandle[] = []
		let top = 0
		let path = 0
		let last: Point | null = null
		let moving: number | null = null
		return {
			start(ctx) {
				hs = solidsOf(ctx, watch).filter((h) => h.dynamic)
				ctx.set(item, "speed", 0)
				ctx.set(item, "top", 0)
				ctx.set(item, "mean", 0)
			},
			step(ctx) {
				if (!hs.length) return
				let m = 0
				let vx = 0
				let vy = 0
				for (const h of hs) {
					const w = h.mass()
					const v = h.velocity()
					m += w
					vx += w * v.x
					vy += w * v.y
				}
				const v = m > 0 ? Math.hypot(vx / m, vy / m) : 0
				const p = middle(hs)
				if (last !== null) path += Math.hypot(p.x - last.x, p.y - last.y)
				last = p
				const t = observed(ctx)
				if (moving === null && path > MOVE_M) moving = t
				if (v > top) top = v
				ctx.set(item, "speed", v)
				ctx.set(item, "top", top)
				ctx.set(item, "mean", moving !== null && t > moving ? path / (t - moving) : 0)
			}
		}
	}
}

// ---------------------------------------------------------------- spring scale
const spring: ProcessKind = {
	kind: "measure-spring",
	check: (r, solids) => (typeof r.case === "string" && solids.has(r.case) && typeof r.hook === "string" && solids.has(r.hook) ? undefined : "its case or hook is not in the document"),
	create(r) {
		const item = r.item as string
		const k = num(r.stiffness, 100)
		const rest = num(r.rest, 0.02)
		const hookMass = num(r.hook_mass, 0.012)
		const aA = (r.aA as Point | undefined) ?? { x: 0, y: 0 }
		const aB = (r.aB as Point | undefined) ?? { x: 0, y: 0 }
		const range = num(r.range, Infinity)
		const stopAt = typeof r.stop === "number" && r.stop > rest ? r.stop : null
		let smooth: number | null = null
		const world = (h: SolidHandle, a: Point): Point => {
			const p = h.pose()
			const c = Math.cos(p.angle)
			const s = Math.sin(p.angle)
			return { x: p.x + a.x * c - a.y * s, y: p.y + a.x * s + a.y * c }
		}
		return {
			start(ctx) {
				// the end of the hook's travel: the hook bottoms out at the end of the tube (a rope joint between the spring's two ends, slack
				// until then: it adds nothing to a reading on the scale); planck's own joint, so the view draws no rope for it
				const E = ctx.engine()
				if (stopAt === null || E === undefined) return
				const A = E.bodyOf(r.case as string) as ConstructorParameters<typeof RopeJoint>[1] | undefined
				const B = E.bodyOf(r.hook as string) as ConstructorParameters<typeof RopeJoint>[2] | undefined
				if (!A || !B) return
				const la = E.anchorOn(r.case as string, aA) as Vec2
				const lb = E.anchorOn(r.hook as string, aB) as Vec2
				;(E.world as { createJoint(j: RopeJoint): unknown }).createJoint(
					new RopeJoint({ maxLength: stopAt * E.lengthScale, localAnchorA: new Vec2(la.x, la.y), localAnchorB: new Vec2(lb.x, lb.y), collideConnected: true }, A, B)
				)
			},
			step(ctx) {
				const A = ctx.solid(r.case as string)
				const B = ctx.solid(r.hook as string)
				if (A === undefined || B === undefined) return
				const pa = world(A, aA)
				const pb = world(B, aB)
				const stretch = Math.hypot(pb.x - pa.x, pb.y - pa.y) - rest
				const F = k * stretch - hookMass * ctx.settings.gravity
				smooth = smooth === null ? F : smooth + (F - smooth) * Math.min(1, ctx.step / 0.2)
				ctx.set(item, "newtons", smooth)
				ctx.set(item, "grams", (smooth / G_CAL) * 1000)
				ctx.set(item, "stretch", stretch)
				if (range !== Infinity) ctx.set(item, "over", smooth > range * 1.01 ? 1 : 0)
			}
		}
	}
}

// ---------------------------------------------------------------- kitchen scale
const scale: ProcessKind = {
	kind: "measure-scale",
	check: (r, solids) => (typeof r.platform === "string" && solids.has(r.platform) ? undefined : "its platform is not in the document"),
	create(r) {
		const item = r.item as string
		const platform = r.platform as string
		const tare = r.tare === true
		const capacity = num(r.capacity, 5)
		let smooth = 0
		let zero: number | null = null
		let solved = 0 // the steps seen since the release (the 2nd is the first to see contacts: the world is first solved after the 1st)
		let prevVy = new Map<string, number>()
		return {
			step(ctx) {
				// No contact is known before the world is first stepped (nothing moves before the release), so the first step that sees contacts
				// is the 2nd after the release: until then it reads nothing, and the frames before read its first reading (plugins.ts
				// Readings.series), the load it carries at the release: the scale shows what was set on it from the start of the run.
				if (ctx.released()) solved++
				if (solved < 2) return
				const g = ctx.settings.gravity
				// what rests on the platform: moving solids touching it, or touching what touches it, not leaning on another fixed solid; whole items
				const fixed = (id: string) => {
					const h = ctx.solid(id)
					return h !== undefined && !h.dynamic
				}
				const items = new Set<string>()
				const seen = new Set<string>([platform])
				let wave = [...ctx.touching(platform)]
				while (wave.length) {
					const next: string[] = []
					for (const id of wave) {
						if (seen.has(id)) continue
						seen.add(id)
						const h = ctx.solid(id)
						// (a solid resized to nothing (a piece parked inside an egg until it smashes, a broken thing's gone body) is a sensor that
						// rests on nothing and carries nothing: its overlaps are not contacts)
						if (h === undefined || !h.dynamic || h.scale() < 0.01) continue
						const others = ctx.touching(id)
						if (others.some((o) => o !== platform && fixed(o))) continue
						items.add(h.item)
						for (const o of others) if (!seen.has(o)) next.push(o)
					}
					wave = next
				}
				let F = 0
				let W = 0 // the weight of what rests on it (Σ m·g, without its motion)
				const vy = new Map<string, number>()
				for (const it of items) {
					for (const h of ctx.solidsOf(it)) {
						if (!h.dynamic || h.scale() < 0.01) continue
						const v = h.velocity().y
						vy.set(h.id, v)
						const before = prevVy.get(h.id)
						const a = before === undefined ? 0 : (v - before) / ctx.step
						F += h.mass() * (g + a)
						W += h.mass() * g
					}
				}
				prevVy = vy
				// At the first step that sees contacts, what was SET on the platform (a bowl, a plate, masses stacked on it) rests on it. The load
				// cell has carried that load since before the run began: its filter starts settled on its weight, and taring takes off exactly that
				// weight (a person presses TARE with the bowl on it, then drops the egg), never anything that lands or bounces on it later.
				if (solved === 2) {
					smooth = W
					if (tare) zero = W
				} else smooth += (F - smooth) * Math.min(1, ctx.step / 0.05)
				const net = smooth - (zero ?? 0)
				ctx.set(item, "newtons", net)
				ctx.set(item, "grams", (net / G_CAL) * 1000)
				ctx.set(item, "over", smooth / G_CAL > capacity ? 1 : 0)
			},
			end(ctx) {
				// (a run that ends before its release: nothing weighed)
				if (solved >= 2) return
				ctx.set(item, "grams", 0)
				ctx.set(item, "newtons", 0)
				ctx.set(item, "over", 0)
			}
		}
	}
}

// ---------------------------------------------------------------- pan balance
/** What rests on these solids (a platform, a pan): the items of the moving solids touching them, or touching what touches them, not leaning on
 *  another fixed solid, and not of `own` (the instrument itself); a solid resized to nothing (a broken thing's gone body) carries nothing. */
const restingOn = (ctx: ProcessContext, base: readonly string[], own: string) => {
	const fixed = (id: string) => {
		const h = ctx.solid(id)
		return h !== undefined && !h.dynamic
	}
	const items = new Set<string>()
	const seen = new Set<string>(base)
	let wave = base.flatMap((b) => [...ctx.touching(b)])
	while (wave.length) {
		const next: string[] = []
		for (const id of wave) {
			if (seen.has(id)) continue
			seen.add(id)
			const h = ctx.solid(id)
			if (h === undefined || !h.dynamic || h.item === own || h.scale() < 0.01) continue
			const others = ctx.touching(id)
			if (others.some((o) => !base.includes(o) && fixed(o))) continue
			items.add(h.item)
			for (const o of others) if (!seen.has(o)) next.push(o)
		}
		wave = next
	}
	return items
}
/** The mass (g) of whole items (every moving solid of each, with what it carries). */
const gramsOf = (ctx: ProcessContext, items: ReadonlySet<string>) => {
	let m = 0
	for (const it of items) for (const h of ctx.solidsOf(it)) if (h.dynamic && h.scale() >= 0.01) m += h.mass()
	return m * 1000
}
const balance: ProcessKind = {
	kind: "measure-balance",
	check: (r, solids) => (typeof r.beam === "string" && solids.has(r.beam) ? undefined : "its beam is not in the document"),
	create(r) {
		const item = r.item as string
		const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [])
		const left = ids(r.left)
		const right = ids(r.right)
		let a0: number | null = null
		let solved = 0
		return {
			start(ctx) {
				// (a beam that came to rest against its stop, or that starts turning slower than planck's sleep speed, 2°/s, on the Moon, would
				// sleep there: a real beam always answers a difference in the pans)
				const B = ctx.engine()?.bodyOf(r.beam as string) as { setSleepingAllowed?(on: boolean): void } | undefined
				B?.setSleepingAllowed?.(false)
			},
			step(ctx) {
				const b = ctx.solid(r.beam as string)
				if (b === undefined) return
				const a = b.pose().angle
				if (a0 === null) a0 = a
				const tilt = -(a - a0) * R2D // (the beam turned clockwise: its right end, and pan, went down)
				ctx.set(item, "tilt", tilt)
				ctx.set(item, "heavier", tilt > 0.5 ? 1 : tilt < -0.5 ? -1 : 0)
				// what each pan holds (no contact is known before the world's first solve after the release: the 2nd step after it)
				if (ctx.released()) solved++
				if ((left.length || right.length) && solved >= 2 && (solved - 2) % 12 === 0) {
					ctx.set(item, "left_g", gramsOf(ctx, restingOn(ctx, left, item)))
					ctx.set(item, "right_g", gramsOf(ctx, restingOn(ctx, right, item)))
				}
			}
		}
	}
}

// ---------------------------------------------------------------- marks (no run: the goal checks' world x of a lane's or a line's marks)
const mark: ProcessKind = { kind: "measure-mark", create: () => ({}) }


// ---------------------------------------------------------------- protractor
const angle: ProcessKind = {
	kind: "measure-angle",
	create(r) {
		const item = r.item as string
		const watch = str(r.watch)
		let main: SolidHandle | undefined
		let lo = Infinity
		let hi = -Infinity
		let pivoted = false
		return {
			start(ctx) {
				const all = watch === null ? [] : ctx.solidsOf(watch)
				main = all.find((h) => h.dynamic && h.part.pivot !== undefined) ?? all.find((h) => h.dynamic) ?? all[0]
				pivoted = main?.part.pivot !== undefined
			},
			step(ctx) {
				if (main === undefined) return
				const a = main.pose().angle
				if (a < lo) lo = a
				if (a > hi) hi = a
				let d = Math.abs(a) * R2D
				d = d - 360 * Math.floor(d / 360)
				if (d > 180) d = 360 - d
				if (!pivoted && d > 90) d = 180 - d
				ctx.set(item, "degrees", d)
				ctx.set(item, "swing", ((hi - lo) * R2D) / 2)
			}
		}
	}
}

// ---------------------------------------------------------------- motion sensor
const ranger: ProcessKind = {
	kind: "measure-ranger",
	coarse: 4,
	create(r) {
		const item = r.item as string
		const ox = num(r.x, 0)
		const oy = num(r.y, 0)
		const dx = num(r.dx, 1)
		const dy = num(r.dy, 0)
		const near = num(r.near, 0.15)
		const far = num(r.far, 6)
		let n = 0
		/** The nearest distance along the ray to a solid's outline, or Infinity. */
		const hit = (h: SolidHandle) => {
			const o = h.outline()
			if (o.circle !== undefined) {
				const cx = o.circle.x - ox
				const cy = o.circle.y - oy
				const along = cx * dx + cy * dy
				const q = o.circle.r * o.circle.r - (cx * cx + cy * cy - along * along)
				if (q < 0) return Infinity
				const s = along - Math.sqrt(q)
				return s >= 0 ? s : along + Math.sqrt(q) >= 0 ? 0 : Infinity
			}
			const pts = o.points ?? []
			let best = Infinity
			for (let i = 0; i < pts.length; i++) {
				const a = pts[i] as Point
				const b = pts[(i + 1) % pts.length] as Point
				const ex = b.x - a.x
				const ey = b.y - a.y
				const den = dx * ey - dy * ex
				if (Math.abs(den) < 1e-12) continue
				const ax = a.x - ox
				const ay = a.y - oy
				const s = (ax * ey - ay * ex) / den
				const u = (ax * dy - ay * dx) / den
				if (s >= 0 && u >= 0 && u <= 1 && s < best) best = s
			}
			return best
		}
		const read = (ctx: ProcessContext) => {
			let best = Infinity
			for (const h of ctx.all()) {
				if (h.item === item || h.part.ghost === true) continue
				const s = hit(h)
				if (s >= near && s < best) best = s
			}
			ctx.set(item, "distance", best <= far ? best : far)
		}
		return {
			start: read,
			step(ctx) {
				if (n++ % 4 === 0) read(ctx)
			}
		}
	}
}

export default [stopwatch, tape, gate, speed, spring, scale, balance, angle, ranger, mark]
