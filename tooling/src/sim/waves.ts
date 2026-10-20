/**
 * Sound and mechanical waves (the waves module): what a struck tuning fork, a drum, a plucked string or rubber band, a tapped or blown
 * bottle send out, heard by sound level meters through the air (and through a solid they both touch), with echoes off walls; waves on a
 * rope or a Slinky (a line of masses on springs, stepped here), and water waves in a ripple tank (linear wave theory). Pure functions of
 * the document's wave records and the rigid-body run: nothing here pushes a body, so a scene without wave records runs exactly as before.
 *
 * Determinism: only + − × ÷, Math.sqrt (exactly rounded) and the engine's Math.sin/cos/atan2/exp/hypot/pow, which the bundle and node's
 * engine loader both swap for tools/fdlibm.ts (the same bits on the server and in every browser). Math.log, log10 and tanh are not swapped,
 * so this module has its own (`ln`, `log10`, `tanh` below), built from those.
 *
 * Units: metres, seconds, kilograms, hertz, pascals; levels in dB re 20 µPa.
 */

// ------------------------------------------------------------------ deterministic math

const LN2_HI = 6.93147180369123816490e-1
const LN2_LO = 1.90821492927058770002e-10
const SQRT2 = 1.4142135623730951
const INV_LN10 = 0.4342944819032518

/** Natural logarithm from + − × ÷ alone (no platform libm): x = m·2^e with m in [1/√2, √2), ln m = 2·atanh((m − 1)/(m + 1)) by its series. Within 1 ulp or so. */
export const ln = (x: number): number => {
	if (Number.isNaN(x) || x < 0) return NaN
	if (x === 0) return -Infinity
	if (x === Infinity) return Infinity
	let m = x
	let e = 0
	// exact scalings by powers of two
	while (m >= 4294967296) {
		m /= 4294967296
		e += 32
	}
	while (m < 2.3283064365386963e-10) {
		m *= 4294967296
		e -= 32
	}
	while (m >= SQRT2) {
		m /= 2
		e += 1
	}
	while (m < SQRT2 / 2) {
		m *= 2
		e -= 1
	}
	const s = (m - 1) / (m + 1)
	const s2 = s * s
	// 2s·(1 + s²/3 + s⁴/5 + … + s²⁶/27): |s| ≤ 0.1716, s² ≤ 0.0295, the next term is below 1e-20 of the sum
	let sum = 1 / 27
	for (let k = 12; k >= 0; k--) sum = 1 / (2 * k + 1) + s2 * sum
	return e * LN2_HI + (2 * s * sum + e * LN2_LO)
}

/** log₁₀ x (deterministic: `ln`). */
export const log10 = (x: number): number => ln(x) * INV_LN10

/** tanh x from the engine's exp. */
export const tanh = (x: number): number => {
	const a = Math.abs(x)
	if (a > 22) return x > 0 ? 1 : -1
	const t = Math.exp(-2 * a)
	const r = (1 - t) / (1 + t)
	return x < 0 ? -r : r
}

/** A level in dB re 20 µPa from a mean-square pressure (Pa²). */
export const dbOf = (meanSquare: number) => 10 * log10(meanSquare / (P_REF * P_REF))

/** The mean-square pressure (Pa²) of a level in dB. */
export const msOf = (db: number) => P_REF * P_REF * Math.pow(10, db / 10)

// ------------------------------------------------------------------ reference values

/** Pa: 0 dB sound pressure level in air (ISO 1683:2015; ANSI/ASA S1.1). */
export const P_REF = 20e-6

/**
 * Speed of sound in dry air, m/s, at `tempC`: c = c₀·√(T/T₀), c₀ = 331.3 m/s at 0 °C (an ideal gas: Kinsler, Frey, Coppens & Sanders,
 * Fundamentals of Acoustics, 4th ed. (2000), §5.6, eq. 5.6.8 and Appendix A10). 343.2 m/s at 20 °C.
 */
export const airSpeed = (tempC = 20) => 331.3 * Math.sqrt(1 + tempC / 273.15)

/**
 * Sound speeds in other media, m/s (Kinsler et al. 2000, Appendix A10): fresh water at 20 °C 1481; in a bar (a rod, a plank: the
 * longitudinal wave of a thin bar, √(E/ρ)) steel 5050, aluminium 5150, glass (Pyrex) 5170, oak along the grain 4000, hard rubber 1450;
 * concrete (bulk) 3100; ice (bulk) 3200.
 */
export const MEDIUM_SPEED: Readonly<Record<string, number>> = {
	water: 1481,
	steel: 5050,
	aluminium: 5150,
	glass: 5170,
	wood: 4000,
	rubber: 1450,
	concrete: 3100,
	ice: 3200
}

/**
 * Sound absorption coefficients α at 500 Hz (the share of the sound energy a surface takes in; the rest is reflected), typical values
 * from the classic tables (Everest & Pohlmann, Master Handbook of Acoustics, 5th ed. (2009), Appendix: absorption coefficients): unglazed
 * brick 0.03, painted concrete block 0.06, a plywood panel 0.17, heavy velour curtain draped 0.49, heavy carpet on concrete 0.14,
 * 50 mm open-cell acoustic foam about 0.8 (manufacturers' data; provisional), polished steel or glass sheet about 0.03 (provisional).
 */
export const ABSORPTION: Readonly<Record<string, number>> = {
	brick: 0.03,
	concrete: 0.06,
	wood: 0.17,
	curtain: 0.49,
	carpet: 0.14,
	foam: 0.8,
	steel: 0.03,
	glass: 0.03
}

/**
 * A-weighting in dB at frequency f (IEC 61672-1:2013, Annex E): what a sound level meter set to dB(A) takes off a pure tone so the
 * reading follows the ear's sensitivity at moderate levels (−19.1 dB at 100 Hz, 0 at 1 kHz, +1.3 at 2.5 kHz).
 */
export const aWeight = (f: number) => {
	const f2 = f * f
	const ra = (148693636 * f2 * f2) / ((f2 + 424.36) * Math.sqrt((f2 + 11599.29) * (f2 + 544496.41)) * (f2 + 148693636))
	return 20 * log10(ra) + 2.0
}

/** Water at 20 °C: density kg/m³, surface tension N/m (CRC Handbook of Chemistry and Physics), kinematic viscosity m²/s. */
export const WATER = { density: 998.2, tension: 0.0728, viscosity: 1.0e-6 } as const

/** Standard gravity, m/s² (the engine's): the default; a run passes its own (settings.gravity) to Line and Ripples. */
export const G = 9.81

// ------------------------------------------------------------------ records

export interface Pt {
	readonly x: number
	readonly y: number
}

/**
 * A line that carries waves: a rope (pulled tight, waves across it at √(T/μ)) or a Slinky (a soft spring: waves along it at L·√(k/m),
 * and across it at √(T/μ) too). It runs straight from `a` (the end a hand or a shaker moves) to `b`; `n` segments of equal mass; the whole
 * line weighs `mass`, is pulled with `tension` (N) and stretches as `stiffness` (N/m for the whole line). `plane`: "vertical" (held up in
 * the air: gravity sags it) or "flat" (lying on a smooth floor: across means sideways, no gravity). `drive`: how end a moves (a pulse:
 * one hump; a wave: a steady shake, `cycles` of it or 0 for on and on); `end`: what holds end b. `damping` (1/s): how fast its motion dies.
 */
export interface LineRec {
	readonly kind: "rope" | "slinky"
	readonly a: Pt
	readonly b: Pt
	readonly n: number
	readonly mass: number
	readonly tension: number
	readonly stiffness: number
	readonly plane: "vertical" | "flat"
	readonly damping: number
	readonly drive: {
		readonly mode: "pulse" | "wave" | "none"
		readonly dir: "across" | "along"
		readonly amp: number
		readonly f: number
		readonly at: number
		readonly cycles: number
	}
	readonly end: "fixed" | "free" | "open"
	/** World y the line can never go below (the table or floor its posts stand on, plus the rope's own radius): a held-up line that would
	 *  swing or sag lower lies on it (an inelastic contact: no bounce). Undefined: nothing under it. */
	readonly floor?: number
	/** The air's drag across the line per unit of its mass, 1/m: ½·ρ_air·C_d·d/μ (a rope of diameter d, a cylinder side-on); 0: none. */
	readonly drag?: number
	/** A Slinky's closed length (m, its coils all touching): along it, no stretch of coils gets shorter than its share of that. 0: no limit. */
	readonly closed?: number
}

/** The most segments a line is made of (the builders give a rope n ≥ 10 segments per wavelength up to this many). */
export const LINE_MAX_SEGMENTS = 800

/**
 * A ripple tank's water: `depth` deep between x0 and x1 (world, along the motion plane) and `width` across (front to back); a dipper at
 * `sx` (a point: circles; a bar: straight waves) bobbing `amp` at `f` Hz from `at`; each end a wall (reflects) or a beach (takes the
 * waves in).
 */
export interface TankRec {
	readonly x0: number
	readonly x1: number
	readonly width: number
	readonly depth: number
	readonly f: number
	readonly amp: number
	readonly at: number
	readonly source: "point" | "bar"
	readonly sx: number
	readonly near: "wall" | "beach"
	readonly far: "wall" | "beach"
}

// ------------------------------------------------------------------ geometry

/** The mirror image of p in the line through a and b. */
export const mirror = (p: Pt, a: Pt, b: Pt): Pt => {
	const dx = b.x - a.x
	const dy = b.y - a.y
	const d2 = dx * dx + dy * dy
	if (d2 === 0) return p
	const u = ((p.x - a.x) * dx + (p.y - a.y) * dy) / d2
	const fx = a.x + u * dx
	const fy = a.y + u * dy
	return { x: 2 * fx - p.x, y: 2 * fy - p.y }
}

/** Which side of the line a→b p is on (+1 left, −1 right, 0 on it). */
const sideOf = (p: Pt, a: Pt, b: Pt) => {
	const c = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
	return c > 1e-12 ? 1 : c < -1e-12 ? -1 : 0
}

/** Where the segment p→q crosses segment a→b, as the fraction along a→b (0…1), or undefined. */
const crossing = (p: Pt, q: Pt, a: Pt, b: Pt): number | undefined => {
	const rx = q.x - p.x
	const ry = q.y - p.y
	const sx = b.x - a.x
	const sy = b.y - a.y
	const den = rx * sy - ry * sx
	if (Math.abs(den) < 1e-15) return undefined
	const t = ((a.x - p.x) * sy - (a.y - p.y) * sx) / den
	const u = ((a.x - p.x) * ry - (a.y - p.y) * rx) / den
	return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? u : undefined
}

/** Distance from p to the segment a–b. */
export const toSegment = (p: Pt, a: Pt, b: Pt) => {
	const dx = b.x - a.x
	const dy = b.y - a.y
	const d2 = dx * dx + dy * dy
	const u = d2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / d2))
	return Math.hypot(p.x - (a.x + u * dx), p.y - (a.y + u * dy))
}

// ------------------------------------------------------------------ sound: paths from a source to a meter

/** One way the sound gets from a source to a meter: its length (m), its speed (m/s), the pressure gain on top of 1/r (reflections take some), how it spreads, and what it bounced off or went through. */
export interface Path {
	readonly length: number
	readonly speed: number
	readonly gain: number
	readonly spread: boolean
	readonly via: readonly string[]
	readonly medium: string
}

/** The nearest a sound is reckoned to come to its source, m: closer than this the 1/r law of a far listener does not hold (the near field). */
const NEAR = 0.05

/**
 * The paths through the air from s to m: straight, and off each reflector (first order: the image source; a reflection counts only where the
 * mirror point falls on the reflector and both ends are on its open side), and off two reflectors in turn (second order: flutter between
 * two walls). A straight path that crosses a reflector is blocked (a wall between them; diffraction round its edges is not modelled).
 * Pressure gain of each reflection √(1 − α).
 */
export const airPaths = (s: Pt, m: Pt, walls: readonly { a: Pt; b: Pt; absorption: number; item: string }[], speed: number): Path[] => {
	const out: Path[] = []
	const blocked = (p: Pt, q: Pt, skip: readonly number[]) => walls.some((w, i) => !skip.includes(i) && crossing(p, q, w.a, w.b) !== undefined)
	if (!blocked(s, m, [])) out.push({ length: Math.hypot(m.x - s.x, m.y - s.y), speed, gain: 1, spread: true, via: [], medium: "air" })
	for (let i = 0; i < walls.length; i++) {
		const w = walls[i]
		const si = sideOf(s, w.a, w.b)
		if (si === 0 || si !== sideOf(m, w.a, w.b)) continue
		const img = mirror(s, w.a, w.b)
		const u = crossing(img, m, w.a, w.b)
		if (u === undefined) continue
		const hit = { x: w.a.x + u * (w.b.x - w.a.x), y: w.a.y + u * (w.b.y - w.a.y) }
		if (blocked(s, hit, [i]) || blocked(hit, m, [i])) continue
		out.push({ length: Math.hypot(m.x - img.x, m.y - img.y), speed, gain: Math.sqrt(1 - w.absorption), spread: true, via: [w.item], medium: "air" })
		for (let j = 0; j < walls.length; j++) {
			if (j === i) continue
			const v = walls[j]
			// second order: the image of the image in wall j, seen from m off wall j, then wall i
			const sj = sideOf(img, v.a, v.b)
			if (sj === 0 || sj !== sideOf(m, v.a, v.b)) continue
			const img2 = mirror(img, v.a, v.b)
			const u2 = crossing(img2, m, v.a, v.b)
			if (u2 === undefined) continue
			const hit2 = { x: v.a.x + u2 * (v.b.x - v.a.x), y: v.a.y + u2 * (v.b.y - v.a.y) }
			const u1 = crossing(img, hit2, w.a, w.b)
			if (u1 === undefined) continue
			const hit1 = { x: w.a.x + u1 * (w.b.x - w.a.x), y: w.a.y + u1 * (w.b.y - w.a.y) }
			if (blocked(s, hit1, [i]) || blocked(hit1, hit2, [i, j]) || blocked(hit2, m, [j])) continue
			out.push({
				length: Math.hypot(m.x - img2.x, m.y - img2.y),
				speed,
				gain: Math.sqrt((1 - w.absorption) * (1 - v.absorption)),
				spread: true,
				via: [w.item, v.item],
				medium: "air"
			})
		}
	}
	return out
}

// ------------------------------------------------------------------ sound: the meters' readings, step by step

/**
 * One contribution to a meter: a partial's mean-square pressure `q` (Pa², at its arrival) arriving at `t0`, holding `hold` s, then dying
 * away at `rate` (1/s, of the mean square: 2/τ). A meter reads the exponential average of the mean square with time constant T = 1/w
 * (IEC 61672-1's "fast" 0.125 s, "slow" 1 s). Its average is in closed form (pieceAvg), and from one step to the next it is advanced
 * exactly by constant factors (an exponential input through an exponential average), so the reading is exact at every step.
 */
interface Piece {
	readonly t0: number
	readonly q: number
	readonly hold: number
	readonly rate: number
	readonly source: number
	/** e^(−rate·h), and w/(w − rate)·(e^(−rate·h) − e^(−w·h)): the step's factors. */
	readonly A: number
	readonly C: number
	/** 0 waiting, 1 holding, 2 dying away. */
	phase: number
	/** The mean square arriving now, and the meter's average of it. */
	x: number
	y: number
}

/** Exponential average (rate w = 1/T) at u ≥ 0 after the start of a pure decay Q·e^(−β s). */
const decayAvg = (Q: number, beta: number, w: number, u: number) => {
	const d = w - beta
	if (Math.abs(d) < 1e-9 * w) return Q * w * u * Math.exp(-w * u)
	return ((Q * w) / d) * (Math.exp(-beta * u) - Math.exp(-w * u))
}

/** The meter's time-weighted mean square of one piece u ≥ 0 after it arrives. */
const pieceAvg = (q: number, hold: number, rate: number, w: number, u: number) => {
	if (u <= 0) return 0
	if (hold <= 0) return decayAvg(q, rate, w, u)
	if (u <= hold) return q * (1 - Math.exp(-w * u))
	const v = u - hold
	return q * (1 - Math.exp(-w * hold)) * Math.exp(-w * v) + decayAvg(q, rate, w, v)
}

/** A sounding thing as the field sees it (from its record): its note, its partials, its level 1 m away at strike level 1, its hold. */
export interface FieldSource {
	readonly id: string
	readonly item: string
	readonly f0: number
	readonly partials: readonly (readonly [number, number, number])[]
	readonly lp1: number
	readonly hold: number
}

/** A sound level meter as the field sees it. `listen`: "air" (a microphone), "touch" (pressed to what it touches: it also hears through a
 *  carrier) or "water" (a hydrophone: under water it hears through the water body it is in). */
export interface FieldMeter {
	readonly id: string
	readonly item: string
	readonly weighting: "A" | "Z"
	readonly response: number
	readonly floor: number
	readonly listen: "air" | "touch" | "water"
}

/** A body of water (a liquid in a container, the liquids module's): x0…x1 between its walls, from its floor up to its top (world m), and its sound speed. */
export interface Water {
	readonly x0: number
	readonly x1: number
	readonly floor: number
	readonly top: number
	readonly speed: number
	readonly item: string
}

/** Pressure lost by sound crossing the water's surface from the air (dB): water's acoustic impedance is ≈ 3600 × air's, so ≈ 0.1 % of the
 *  energy crosses (Kinsler et al. 2000 §6.3: T_I = 4Z₁Z₂/(Z₁ + Z₂)²); taken as −30 dB on the pressure a hydrophone reads (provisional). */
const SURFACE_LOSS_DB = 30

export interface Wall {
	readonly a: Pt
	readonly b: Pt
	readonly absorption: number
	readonly item: string
}

export interface Carrier {
	readonly a: Pt
	readonly b: Pt
	readonly half: number
	readonly speed: number
	readonly gain: number
	readonly material: string
	readonly item: string
}

/** Pieces fainter than this share of the meter's room level are dropped once they have arrived and are dying away. */
const NEGLIGIBLE = 1e-7

/** An arrival at a meter: when, from which source, which way (what it bounced off or went through), how loud it arrived (dB, the meter's weighting). */
export interface Arrival {
	readonly t: number
	readonly source: number
	readonly via: readonly string[]
	readonly medium: string
	readonly db: number
}

/**
 * The sound in a scene: what each source sends out when struck, along every path to every meter (straight, off walls, through a solid
 * that carries it), arriving after path/speed with its pressure falling as 1/r (spherical spreading; a carrier guides it without
 * spreading), each partial dying away at its own rate. `speed` is the speed of sound in the room's air (0: a vacuum, nothing goes through
 * the air). Step it with advance(t) at every engine step; strike(...) when a source sounds.
 */
export class SoundField {
	readonly sources: readonly FieldSource[]
	readonly meters: readonly FieldMeter[]
	readonly walls: readonly Wall[]
	readonly carriers: readonly Carrier[]
	readonly speed: number
	readonly step: number
	/** The bodies of water a hydrophone may be in. */
	waters: readonly Water[] = []
	private readonly pieces: Piece[][]
	private readonly w: number[]
	private readonly B: number[]
	private readonly floorMs: number[]
	/** Each source's own sound 1 m away, per partial: its mean square now, the step's decay factor, and the end of its latest hold (s). */
	private readonly own: { ms: Float64Array; A: Float64Array; holdTo: number; holdMs: Float64Array }[]
	/** What reached each meter, in order (the first MAX_ARRIVALS). */
	readonly arrivals: Arrival[][]
	private readonly p1: number[]
	private readonly norm: number[]
	t = 0

	constructor(sources: readonly FieldSource[], meters: readonly FieldMeter[], walls: readonly Wall[], carriers: readonly Carrier[], speed: number, step: number) {
		this.sources = sources
		this.meters = meters
		this.walls = walls
		this.carriers = carriers
		this.speed = speed
		this.step = step
		this.pieces = meters.map(() => [])
		this.arrivals = meters.map(() => [])
		this.w = meters.map((m) => 1 / Math.max(0.01, m.response))
		this.B = this.w.map((w) => Math.exp(-w * step))
		this.floorMs = meters.map((m) => msOf(m.floor))
		this.p1 = sources.map((s) => Math.sqrt(msOf(s.lp1)))
		this.norm = sources.map((s) => {
			let n = 0
			for (const [, a] of s.partials) n += a * a
			return n > 0 ? Math.sqrt(n) : 1
		})
		this.own = sources.map((s) => ({
			ms: new Float64Array(s.partials.length),
			A: Float64Array.from(s.partials.map(([, , tau]) => (tau > 0 ? Math.exp((-2 * step) / tau) : 0))),
			holdTo: -1,
			holdMs: new Float64Array(s.partials.length)
		}))
	}

	/** The paths from a source at s to meter mi at m; `shared`: the carriers both touch (a meter that listens by touch hears through them). */
	paths(s: Pt, m: Pt, mi: number, shared: readonly number[] = []): Path[] {
		const listen = this.meters[mi]?.listen
		if (listen === "water") {
			// a hydrophone in a body of water hears a source in the same water straight through it (spreading as in air); a sound from the
			// air only what crosses the surface; out of the water it is a microphone in the air
			const inside = (p: Pt, w: Water) => p.x >= w.x0 && p.x <= w.x1 && p.y >= w.floor - 1e-9 && p.y <= w.top + 1e-9
			const w = this.waters.find((q) => inside(m, q))
			if (w !== undefined) {
				if (inside(s, w)) return [{ length: Math.hypot(m.x - s.x, m.y - s.y), speed: w.speed, gain: 1, spread: true, via: [w.item], medium: "water" }]
				const loss = Math.pow(10, -SURFACE_LOSS_DB / 20)
				return (this.speed > 0 ? airPaths(s, m, this.walls, this.speed) : []).map((p) => ({ ...p, gain: p.gain * loss, via: [...p.via, w.item] }))
			}
		}
		const out: Path[] = this.speed > 0 ? airPaths(s, m, this.walls, this.speed) : []
		if (listen !== "touch") return out
		for (const ci of shared) {
			const cr = this.carriers[ci]
			if (cr === undefined) continue
			const dx = cr.b.x - cr.a.x
			const dy = cr.b.y - cr.a.y
			const d2 = dx * dx + dy * dy
			const along = (p: Pt) => (d2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - cr.a.x) * dx + (p.y - cr.a.y) * dy) / d2)) * Math.sqrt(d2))
			out.push({ length: Math.abs(along(s) - along(m)), speed: cr.speed, gain: Math.pow(10, cr.gain / 20), spread: false, via: [cr.item], medium: cr.material })
		}
		return out
	}

	/** Source si sounds at time t at level (× its strike level 1), from the world point at; meterAt(mi): where each meter is now; shared(mi): the
	 *  carriers the source and meter mi both touch. */
	strike(si: number, t: number, level: number, at: Pt, meterAt: (mi: number) => Pt, shared: (mi: number) => readonly number[] = () => []) {
		const s = this.sources[si]
		if (s === undefined || !(level > 0)) return
		const hold = s.hold
		// its own sound 1 m away
		const own = this.own[si]
		s.partials.forEach(([, amp], j) => {
			const p = (this.p1[si] * level * amp) / this.norm[si]
			if (hold > 0) {
				own.holdMs[j] = Math.max(own.holdMs[j], p * p)
				own.ms[j] = Math.max(own.ms[j], p * p)
			} else own.ms[j] += p * p
		})
		if (hold > 0) own.holdTo = Math.max(own.holdTo, t + hold)
		this.meters.forEach((m, mi) => {
			const mAt = meterAt(mi)
			const w = this.w[mi]
			const B = this.B[mi]
			for (const path of this.paths(at, mAt, mi, shared(mi))) {
				const r = path.spread ? Math.max(NEAR, path.length) : 1
				const t0 = t + path.length / path.speed
				let total = 0
				for (const [ratio, amp, tau] of s.partials) {
					const f = ratio * s.f0
					if (!(f > 0) || f > 20000 || !(tau > 0)) continue
					const wgt = m.weighting === "A" ? Math.pow(10, aWeight(f) / 20) : 1
					const p = (this.p1[si] * level * (amp / this.norm[si]) * path.gain * wgt) / r
					const q = p * p
					total += q
					const rate = 2 / tau
					const A = Math.exp(-rate * this.step)
					const d = w - rate
					const C = Math.abs(d) < 1e-9 * w ? w * this.step * B : ((w / d) * (A - B))
					this.pieces[mi].push({ t0, q, hold, rate, source: si, A, C, phase: 0, x: 0, y: 0 })
				}
				const list = this.arrivals[mi]
				if (total > 0 && list.length < MAX_ARRIVALS) {
					list.push({ t: t0, source: si, via: path.via, medium: path.medium, db: dbOf(total) })
					list.sort((p, q) => p.t - q.t)
				}
			}
		})
	}

	/** Advances every meter's average to time t (call it at every step, in order). */
	advance(t: number) {
		this.t = t
		for (let mi = 0; mi < this.meters.length; mi++) {
			const w = this.w[mi]
			const B = this.B[mi]
			const list = this.pieces[mi]
			const tiny = this.floorMs[mi] * NEGLIGIBLE
			let keep = 0
			for (let k = 0; k < list.length; k++) {
				const p = list[k] as Piece
				const u = t - p.t0
				if (u < 0) {
					list[keep++] = p
					continue
				}
				if (p.phase === 0) {
					// it arrives within this step: its average in closed form from its arrival
					p.y = pieceAvg(p.q, p.hold, p.rate, w, u)
					p.x = u <= p.hold ? p.q : p.q * Math.exp(-p.rate * (u - p.hold))
					p.phase = u <= p.hold ? 1 : 2
				} else if (p.phase === 1) {
					if (u <= p.hold) {
						// a steady input over the whole step
						p.y = p.y * B + p.q * (1 - B)
					} else {
						// its hold ended within this step: closed form again, then dying away
						p.y = pieceAvg(p.q, p.hold, p.rate, w, u)
						p.x = p.q * Math.exp(-p.rate * (u - p.hold))
						p.phase = 2
					}
				} else {
					p.y = p.y * B + p.x * p.C
					p.x *= p.A
				}
				if (p.phase === 2 && p.x < tiny && p.y < tiny) continue
				list[keep++] = p
			}
			list.length = keep
		}
		for (const own of this.own) {
			const holding = t <= own.holdTo
			for (let j = 0; j < own.ms.length; j++) own.ms[j] = holding ? Math.max(own.ms[j] * own.A[j], own.holdMs[j]) : own.ms[j] * own.A[j]
			if (!holding) own.holdMs.fill(0)
		}
	}

	/** Meter mi's reading now, dB (its weighting, its time average, never below its room level). */
	level(mi: number): number {
		let ms = this.floorMs[mi]
		for (const p of this.pieces[mi]) if (p.phase > 0) ms += p.y
		return dbOf(ms)
	}

	/** The note meter mi hears most now: the loudest source's fundamental (Hz), 0 when nothing stands 1 dB over the room. */
	pitch(mi: number): number {
		const by = new Float64Array(this.sources.length)
		for (const p of this.pieces[mi]) if (p.phase > 0) by[p.source] += p.x
		let best = -1
		let most = 0
		for (let si = 0; si < by.length; si++)
			if (by[si] > most) {
				most = by[si]
				best = si
			}
		// 1 dB over the room: the source's own share at least (10^0.1 − 1) of the room's
		return best >= 0 && most >= this.floorMs[mi] * 0.2589254117941673 ? (this.sources[best] as FieldSource).f0 : 0
	}

	/** Source si's share of meter mi's reading now, dB (0 when none of it has arrived). */
	levelOf(mi: number, si: number): number {
		let ms = 0
		for (const p of this.pieces[mi] ?? []) if (p.phase > 0 && p.source === si) ms += p.y
		return ms > 0 ? Math.max(0, dbOf(ms)) : 0
	}

	/** Source si's own sound 1 m away now, dB (0 when it is silent). */
	sounding(si: number): number {
		const own = this.own[si]
		if (own === undefined) return 0
		let ms = 0
		for (const v of own.ms) ms += v
		const db = ms > 0 ? dbOf(ms) : 0
		return db > 0 ? db : 0
	}
}

/** Arrivals kept per meter. */
const MAX_ARRIVALS = 24

// ------------------------------------------------------------------ waves on a line (rope, Slinky)

/**
 * A line of n + 1 equal masses, stepped with symplectic Euler in sub-steps short enough for its stiffest motion (ω·h ≤ 0.5): the discrete
 * wave equation (a taut line's linear theory for small motions). Across it, the masses are pulled by the tension T, held constant (as a hanging
 * weight or a spring scale holds it: a wave at √(T/μ): a rope, or a Slinky shaken sideways); each link pulls along its own slant, T·Δw/√(dx² + Δw²)
 * (w the offset from the rest shape), so a large shake is a little softer than the linear T·Δw/dx (under 0.3 % at slopes under 0.08: the
 * pulses of the lessons run at √(T/μ)). Along it, by its springs (a wave at L·√(k/m): a Slinky pushed and pulled); a Slinky's coils never come
 * closer than they are closed (`closed`: an inelastic clash of coils). A vertical-plane line hangs in its sag, the parabola μ·g⊥·u·(L − u)/(2T),
 * and starts still there; it never goes below its `floor` (it lies on the table or floor there). The air drags it across (`drag`); `damping`
 * (1/s) takes the rest of its losses (a rope's internal friction: Q ≈ 10 at a few hertz). The lattice's own dispersion is under 1 % for
 * waves longer than 10 segments (the builders give a rope that many); waves shorter than ≈ 3 segments do not travel (its cutoff, f = v/(π·dx)).
 * End a follows the drive; end b is fixed (a post: a pulse comes back upside down), free (a ring on a smooth pole, or a Slinky's end on a
 * light ring pulled by a steady force: it comes back the same way up) or open (a matched damper, as if the line went on: nothing comes back).
 */
export class Line {
	readonly rec: LineRec
	readonly n: number
	readonly L: number
	readonly ux: number
	readonly uy: number
	readonly mu: number
	readonly m: number
	readonly dx: number
	/** Each link's spring (N/m) along the line, and the tension's pull per unit offset across (T/dx, N/m). */
	readonly ks: number
	readonly kt: number
	/** Gravity across the line (m/s², a vertical-plane line; none on a flat one). */
	readonly gv: number
	readonly h: number
	readonly subs: number
	/** Whether waves along it are stepped (a Slinky); a rope is taken as not stretching. */
	readonly along: boolean
	/** Offsets from the straight rest places: along (u) and across (v, left of a→b), m; their speeds. */
	readonly u: Float64Array
	readonly v: Float64Array
	readonly pu: Float64Array
	readonly pv: Float64Array
	/** The sag the line starts in (across), m. */
	readonly sag: Float64Array
	/** Where each point starts across (its sag, or lying on the floor where the sag would take it below it), m. */
	readonly v0: Float64Array
	/** Whether the floor holds part of it up at the start (it then settles there a little: not a wave). */
	readonly rests: boolean
	/** Each point's lowest offset across (the floor under it), with `floorSign` the way that is down (+1: v ≥ it; −1: v ≤ it); undefined: no floor. */
	private readonly floorV: Float64Array | undefined
	private readonly floorSign: number
	/** Each link's across pull beyond its linear part (N), this sub-step. */
	private readonly nl: Float64Array
	/** How much a link may shorten before its coils touch (m; Infinity: no limit). */
	private readonly gap: number
	private lastDrive = 0
	t = 0

	/** `step`: the engine's step (s); the line is stepped in sub-steps of it, so its samples fall on the engine's own moments. `g`: the run's
	 *  gravity (m/s², settings.gravity). */
	constructor(rec: LineRec, step: number, g: number = G) {
		this.rec = rec
		const n = Math.max(2, Math.round(rec.n))
		this.n = n
		const L = Math.hypot(rec.b.x - rec.a.x, rec.b.y - rec.a.y)
		this.L = L
		this.ux = L > 0 ? (rec.b.x - rec.a.x) / L : 1
		this.uy = L > 0 ? (rec.b.y - rec.a.y) / L : 0
		this.mu = rec.mass / L
		this.m = rec.mass / n
		this.dx = L / n
		// the whole line's stiffness k is n links of n·k in series
		this.ks = rec.stiffness * n
		this.kt = Math.max(0, rec.tension) / this.dx
		this.along = rec.kind === "slinky"
		// gravity (0, −g) across the line: (−uy, ux)·(0, −g)
		this.gv = rec.plane === "vertical" ? -Math.max(0, g) * this.ux : 0
		const omega = 2 * Math.sqrt(Math.max(this.kt, this.along ? this.ks : 0) / this.m)
		this.subs = Math.max(1, Math.ceil((omega * step) / 0.5))
		this.h = step / this.subs
		this.u = new Float64Array(n + 1)
		this.v = new Float64Array(n + 1)
		this.pu = new Float64Array(n + 1)
		this.pv = new Float64Array(n + 1)
		this.sag = new Float64Array(n + 1)
		this.nl = new Float64Array(n)
		// the discrete line under a steady load hangs exactly on the continuous parabola at its points
		if (this.gv !== 0 && rec.tension > 0)
			for (let i = 1; i < n; i++) {
				const x = i * this.dx
				this.sag[i] = rec.end === "fixed" ? (this.mu * this.gv * x * (L - x)) / (2 * rec.tension) : (this.mu * this.gv * x * (2 * L - x)) / (2 * rec.tension)
			}
		if (this.gv !== 0 && rec.tension > 0 && rec.end !== "fixed") this.sag[n] = (this.mu * this.gv * L * L) / (2 * rec.tension)
		this.v.set(this.sag)
		// the floor under a held-up line: point i's world y is a.y + uy·i·dx + ux·v (the line's own along motion left out: a few cm at most)
		this.floorSign = this.ux >= 0 ? 1 : -1
		if (rec.plane === "vertical" && typeof rec.floor === "number" && Number.isFinite(rec.floor) && Math.abs(this.ux) > 0.01) {
			const f = new Float64Array(n + 1)
			for (let i = 0; i <= n; i++) f[i] = (rec.floor - rec.a.y - this.uy * i * this.dx) / this.ux
			this.floorV = f
			const last = rec.end === "fixed" ? n - 1 : n
			let rests = false
			for (let i = 1; i <= last; i++)
				if (this.floorSign * (this.v[i] - (f[i] as number)) < 0) {
					this.v[i] = f[i] as number
					rests = true
				}
			this.rests = rests
		} else {
			this.floorV = undefined
			this.rests = false
		}
		this.v0 = Float64Array.from(this.v)
		const closed = typeof rec.closed === "number" && Number.isFinite(rec.closed) && rec.closed > 0 ? rec.closed : 0
		this.gap = this.along && closed > 0 ? Math.max(0, this.dx - closed / n) : Infinity
	}

	/** End a's offset from its rest point at time t: along and across (m). */
	driveAt(t: number): { du: number; dv: number } {
		const d = this.rec.drive
		if (d.mode === "none" || t <= d.at || d.f <= 0) return { du: 0, dv: 0 }
		const s = (t - d.at) * d.f
		const cycles = d.mode === "pulse" ? 1 : d.cycles > 0 ? d.cycles : Infinity
		if (s >= cycles) return { du: 0, dv: 0 }
		// a pulse: one hump, ½(1 − cos 2πs) (a hand flicked up and back once); a wave: sin 2πs
		const shape = d.mode === "pulse" ? 0.5 * (1 - Math.cos(2 * Math.PI * s)) : Math.sin(2 * Math.PI * s)
		const off = d.amp * shape
		return d.dir === "along" && this.along ? { du: off, dv: 0 } : { du: 0, dv: off }
	}

	/** One sub-step of length h, from drive time t. */
	private sub(t: number) {
		const { n, u, v, pu, pv, h, m, ks, kt, gv, sag, nl, dx } = this
		const decay = 1 / (1 + this.rec.damping * h)
		const end = this.rec.end
		const last = end === "fixed" ? n - 1 : n
		const T = Math.max(0, this.rec.tension)
		const drag = typeof this.rec.drag === "number" && this.rec.drag > 0 ? this.rec.drag : 0
		// each link's across pull beyond its linear part T·Δw/dx: T·Δw·(1/√(dx² + Δw²) − 1/dx), w = v − sag (none at rest)
		for (let j = 0; j < n; j++) {
			const dw = v[j + 1] - sag[j + 1] - (v[j] - sag[j])
			nl[j] = dw === 0 ? 0 : T * dw * (1 / Math.sqrt(dx * dx + dw * dw) - 1 / dx)
		}
		// speeds first (the forces from this sub-step's positions), then positions: symplectic Euler
		for (let i = 1; i <= last; i++) {
			let av: number
			let au: number
			if (i < n) {
				av = (kt * (v[i + 1] - 2 * v[i] + v[i - 1]) + nl[i] - nl[i - 1]) / m + gv
				au = this.along ? (ks * (u[i + 1] - 2 * u[i] + u[i - 1])) / m : 0
			} else if (end === "free") {
				// the end mass is half a link's: free across (a ring on a smooth pole), along held by a steady pull
				av = (2 * (kt * (v[n - 1] - v[n]) - nl[n - 1])) / m + gv
				au = this.along ? (2 * ks * (u[n - 1] - u[n])) / m : 0
			} else {
				// open: a matched damper, the line's own impedance √(T·μ) across and √(k·L·μ) along: what reaches it goes on, as into more line
				const zv = Math.sqrt(T * this.mu)
				const zu = Math.sqrt(this.rec.stiffness * this.L * this.mu)
				av = (2 * (kt * (v[n - 1] - v[n]) - nl[n - 1] - zv * pv[n])) / m + gv
				au = this.along ? (2 * (ks * (u[n - 1] - u[n]) - zu * pu[n])) / m : 0
			}
			// (the air's drag −drag·|v|·v, taken implicitly: it slows the point, never turns it back)
			pv[i] = drag > 0 ? ((pv[i] + av * h) * decay) / (1 + drag * Math.abs(pv[i]) * h) : (pv[i] + av * h) * decay
			pu[i] = (pu[i] + au * h) * decay
		}
		for (let i = 1; i <= last; i++) {
			v[i] += pv[i] * h
			u[i] += pu[i] * h
		}
		const d = this.driveAt(t + h)
		const driveSpeed = (d.du - this.lastDrive) / h
		this.lastDrive = d.du
		u[0] = d.du
		v[0] = d.dv
		// the floor: a point that would go below it lies on it (its speed into the floor is lost)
		const fl = this.floorV
		if (fl !== undefined) {
			const sgn = this.floorSign
			for (let i = 1; i <= last; i++)
				if (sgn * (v[i] - fl[i]) < 0) {
					v[i] = fl[i]
					if (sgn * pv[i] < 0) pv[i] = 0
				}
		}
		// a Slinky's coils: a stretch of them pushed shorter than closed clashes (both ends of it moved apart to the limit, their speeds made one:
		// the driven end pushes the next coil along with it, the post holds the last)
		const gap = this.gap
		if (gap !== Infinity) {
			// a sweep from end a (the driver pushes the coils ahead of it along: each pushed one is moved to touch, and the two meet as one:
			// their speeds made their mean, or at least the driver's), then, against a fixed end b, a sweep back from it (the post holds the last
			// coil: what is pushed into it stops there)
			for (let i = 0; i < n; i++) {
				if (i + 1 > last || u[i + 1] - u[i] >= -gap) continue
				u[i + 1] = u[i] - gap
				if (i === 0) {
					if (pu[1] < driveSpeed) pu[1] = driveSpeed
				} else if (pu[i] > pu[i + 1]) {
					const mean = (pu[i] + pu[i + 1]) / 2
					pu[i] = mean
					pu[i + 1] = mean
				}
			}
			if (last === n - 1)
				for (let i = n - 1; i >= 1; i--) {
					if (u[i + 1] - u[i] >= -gap) continue
					u[i] = u[i + 1] + gap
					if (i + 1 === n) {
						if (pu[i] > 0) pu[i] = 0
					} else if (pu[i] > pu[i + 1]) {
						const mean = (pu[i] + pu[i + 1]) / 2
						pu[i] = mean
						pu[i + 1] = mean
					}
				}
		}
	}

	/** Steps the line on to time t (in its own sub-steps). */
	advanceTo(t: number) {
		while (this.t + this.h / 2 < t) {
			this.sub(this.t)
			this.t += this.h
		}
	}

	/** Point i's world position (a flat line's across offset is depth, toward the viewer: its world point stays on the line). */
	world(i: number): Pt {
		const { rec, ux, uy } = this
		const along = i * this.dx + this.u[i]
		if (rec.plane === "flat") return { x: rec.a.x + ux * along, y: rec.a.y + uy * along }
		return { x: rec.a.x + ux * along - uy * this.v[i], y: rec.a.y + uy * along + ux * this.v[i] }
	}

	/** The kept points' offsets from their straight rest places, along and across (m), flat: [du0, dv0, du1, dv1, …]. */
	offsets(keep: number): number[] {
		const out: number[] = []
		const stride = Math.max(1, Math.round(this.n / Math.max(1, keep)))
		for (let i = 0; i <= this.n; i += stride) out.push(this.u[i], this.v[i])
		if (this.n % stride !== 0) out.push(this.u[this.n], this.v[this.n])
		return out
	}
}

/** The speed of a wave on a line: across a rope √(T/μ); along a Slinky L·√(k/m) (its springs' wave), m/s. */
export const lineSpeed = (rec: LineRec) => {
	const L = Math.hypot(rec.b.x - rec.a.x, rec.b.y - rec.a.y)
	return rec.kind === "slinky" && rec.drive.dir === "along" ? L * Math.sqrt(rec.stiffness / rec.mass) : Math.sqrt((rec.tension * L) / rec.mass)
}

// ------------------------------------------------------------------ water waves (ripple tank)

/**
 * Linear water waves of angular frequency ω on depth h: the dispersion relation ω² = (g·k + (σ/ρ)·k³)·tanh(k·h) (gravity and surface
 * tension; Lamb, Hydrodynamics, 6th ed. (1932), §267), solved for the wavenumber k by Newton's method from the deep-water guess (g = 0, no
 * gravity: from the deep capillary wave's, k = (ω²ρ/σ)^(1/3)). `g`: the run's gravity (m/s², settings.gravity).
 * Returns k (rad/m), the phase speed c = ω/k and the group speed c_g = dω/dk (the speed the waves' front and energy move at).
 */
export const waterWave = (f: number, h: number, g: number = G) => {
	const w = 2 * Math.PI * f
	const s = WATER.tension / WATER.density
	const gg = Math.max(0, g)
	let k = gg > 0 ? (w * w) / gg : Math.pow((w * w) / s, 1 / 3)
	for (let i = 0; i < 60; i++) {
		const th = tanh(k * h)
		const F = (gg * k + s * k * k * k) * th - w * w
		const sech2 = 1 - th * th
		const dF = (gg + 3 * s * k * k) * th + (gg * k + s * k * k * k) * h * sech2
		const next = k - F / dF
		if (!(next > 0)) k = k / 2
		else if (Math.abs(next - k) <= 1e-13 * k) {
			k = next
			break
		} else k = next
	}
	const th = tanh(k * h)
	const sech2 = 1 - th * th
	const cg = ((gg + 3 * s * k * k) * th + (gg * k + s * k * k * k) * h * sech2) / (2 * w)
	return { k, c: w / k, cg, lambda: (2 * Math.PI) / k, w }
}

/**
 * A ripple tank's water: the sum of the dipper's waves and their reflections (the image method: a wall at an end mirrors the dipper;
 * multiple reflections down to 1 % of the first), each spreading as 1/√r from a point dipper (circles: the energy spreads round a growing
 * ring) or not at all from a bar (straight waves), dying away with the water's viscosity at δ = 2νk²/c_g per metre (Lamb §348), starting
 * at the dipper when it starts and running out at the group speed (the front eased in over a wavelength).
 */
export class Ripples {
	readonly rec: TankRec
	readonly k: number
	readonly w: number
	readonly cg: number
	readonly lambda: number
	readonly decay: number
	readonly coth: number
	/** The images: x (along) and z (across, from the centre line), with the gain of their reflections. */
	readonly images: { x: number; z: number; gain: number }[]

	/** `g`: the run's gravity (m/s², settings.gravity). */
	constructor(rec: TankRec, g: number = G) {
		this.rec = rec
		const ww = waterWave(rec.f, rec.depth, g)
		this.k = ww.k
		this.w = ww.w
		this.cg = ww.cg
		this.lambda = ww.lambda
		this.decay = (2 * WATER.viscosity * ww.k * ww.k) / ww.cg
		this.coth = 1 / tanh(ww.k * rec.depth)
		const L = rec.x1 - rec.x0
		const W = rec.width
		const out: { x: number; z: number; gain: number }[] = []
		// along: images of the dipper in the two end walls, repeated (period 2L); a beach end reflects nothing, which ends the chain on its side
		const along: { x: number; gain: number }[] = [{ x: rec.sx, gain: 1 }]
		const farWall = rec.far === "wall"
		const nearWall = rec.near === "wall"
		const reach = Math.min(40, Math.ceil(4.6 / Math.max(1e-6, this.decay * L)) + 1)
		let a = rec.sx
		let b = rec.sx
		for (let r = 1; r <= reach; r++) {
			// a: reflected last at the far wall (odd r) / near wall; b: the other way round
			const ra = r % 2 === 1 ? farWall : nearWall
			const rb = r % 2 === 1 ? nearWall : farWall
			const wallA = r % 2 === 1 ? rec.x1 : rec.x0
			const wallB = r % 2 === 1 ? rec.x0 : rec.x1
			a = 2 * wallA - a
			b = 2 * wallB - b
			if (ra) along.push({ x: a, gain: 1 })
			if (rb) along.push({ x: b, gain: 1 })
			if (!ra && !rb) break
		}
		// across (point dipper only): the side walls at ±W/2 mirror the images too
		const acrossN = rec.source === "point" ? Math.min(6, Math.ceil(4.6 / Math.max(1e-6, this.decay * W)) + 1) : 0
		for (const p of along) {
			out.push({ x: p.x, z: 0, gain: p.gain })
			for (let r = 1; r <= acrossN; r++) {
				out.push({ x: p.x, z: r * W, gain: p.gain })
				out.push({ x: p.x, z: -r * W, gain: p.gain })
			}
		}
		this.images = out
	}

	/** The front: how far the waves have run from where they start, eased over a wavelength (0 ahead of it, 1 well behind). */
	private front(r: number, t: number) {
		const run = this.cg * (t - this.rec.at)
		if (run <= 0) return 0
		const e = (run - r) / this.lambda
		return e >= 1 ? 1 : e <= 0 ? 0 : 0.5 - 0.5 * Math.cos(Math.PI * e)
	}

	/** The surface's height above still water (m) and the water's sideways (along x) displacement there, at (x, z) at time t. */
	at(x: number, z: number, t: number): { eta: number; xi: number } {
		const { rec, k, w } = this
		if (t <= rec.at) return { eta: 0, xi: 0 }
		let eta = 0
		let xi = 0
		const r0 = this.lambda / 4
		for (const im of this.images) {
			const dx = x - im.x
			const dz = z - im.z
			const r = rec.source === "point" ? Math.hypot(dx, dz) : Math.abs(dx)
			const ease = this.front(r, t)
			if (ease === 0) continue
			const spread = rec.source === "point" ? Math.sqrt(r0 / Math.max(r, r0)) : 1
			const A = rec.amp * im.gain * spread * Math.exp(-this.decay * r) * ease
			const ph = k * r - w * (t - rec.at)
			eta += A * Math.cos(ph)
			// the water's own back-and-forth along the wave's way (linear theory: a surface particle moves on an ellipse, A·coth(kh) along it)
			const along = r > 0 ? dx / r : 0
			xi += -A * this.coth * Math.sin(ph) * along
		}
		return { eta, xi }
	}
}
