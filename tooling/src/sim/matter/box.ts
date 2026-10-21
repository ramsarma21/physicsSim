/**
 * The particle model of matter in a box (matter/particles.ts underneath): a sample of a pure substance whose particles move as fast as
 * its temperature says, in the state its heat says (solid, melting, liquid, boiling, gas), pressing on the walls and on a piston; or two
 * gases (or two colours of one liquid) mixing when a divider is lifted.
 *
 * What is real and what is a model (web/CONTRACT.md "Matter"):
 *   - Real: the temperature, the heat (J) the heater puts in, the heating curve (stateAt: melting and boiling points, specific and latent
 *     heats of the substance), the molecules' real speeds (√(3RT/M): air at 20 °C 502 m/s rms), the pressure in kPa and the volume in mL of
 *     the real sample the box stands for (an ideal gas), a piston's load.
 *   - Model: each particle stands for very many molecules; it is drawn about 10⁷ times bigger than a molecule and moves `SPEED_SCALE`
 *     (1/1250) of its real speed, so the motion can be seen (relative speeds are kept: hotter is faster, a light gas faster than a heavy
 *     one, Graham's law). The solid's particles are bonded so their vibration at the melting point is a tenth of their spacing (Lindemann's
 *     melting rule, Phys. Z. 11, 609, 1910); the liquid's are held by a pull 2.5 times the energy of motion at the boiling point (a liquid
 *     boils when its particles' motion matches their binding: Trouton's rule); the liquid and the solid feel a model gravity
 *     (`CONDENSED_GRAVITY`) that settles them at the bottom; gas particles feel none (real molecules fall a few nanometres between hits).
 *   - The pressure READING is the real sample's: its gas's nRT/V in the real volume now (Boyle, Charles, exactly). The particles' hits on
 *     the walls are only the picture (`measured`, kept for the tests: set against what a gas of hard discs makes, Henderson's equation of
 *     state, Mol. Phys. 30, 971, 1975: Z = (1 + η²/8)/(1 − η)², it averages to nRT/V within a few % at low packing but falls behind as the
 *     model's discs pack: pushed to a sixth of its room a syringe's discs read 20 % low, so the gauge never reads them). A loaded piston
 *     slides (damped) to the real volume where the sample's nRT/V holds its load and the outside air (Boyle: V ∝ 1/P; Charles: V ∝ T),
 *     never below the real volume of its solid and liquid; the drawn piston follows it down only as far as the drawn particles leave room
 *     (the picture's limit, not the reading's). The particles do not push it (so few would jostle it by 1/√N, ±15 %, where a real gas's
 *     10²³ molecules hold it still); they bounce off it as it moves.
 */
import { FREE, LIQUID, Particles, random, randomDirection, SOLID } from "./particles.ts"
import { KELVIN, R, rmsSpeed, stateAt, heatAt, type Substance } from "./substances.ts"

/** Model speed ÷ real molecular speed. */
export const SPEED_SCALE = 1 / 1250
/** Model gravity on the liquid and the solid, m/s² (a model choice, see above: strong enough that a liquid of model particles, whose
 *  motion and binding are many times their weight across a particle, pools over the floor as a liquid does rather than staying a drop). */
export const CONDENSED_GRAVITY = 12
/** How fast a loaded piston slides to where the gas holds its load, s (a damped piston: most of the way in three times it). */
export const PISTON_TAU = 0.3
/** Mass of one model particle of the first substance, kg (only ratios matter: a heavier gas's particles are heavier by its molar mass). */
const PARTICLE_MASS = 0.001
/** Lindemann's ratio: rms vibration ÷ spacing at the melting point. */
const LINDEMANN = 0.1
/** Liquid binding ÷ the energy of motion at the boiling point (2.5: liquid up to the boiling point, yet free enough to flow). */
const BINDING = 2.5
/** The pressure gauge's averaging: windows of GAUGE s, the reading the mean of the last GAUGE_WINDOWS of them (a damped needle: 1.5 s; a
 *  gauge on a few dozen particles flickers by about ±10 % over a quarter second). */
const GAUGE = 0.25
const GAUGE_WINDOWS = 6
const GAUGE_LEAST = 6
/** Two particles at the hottest temperature, at three times the rms speed, overlap at most this share of a radius. */
const OVERLAP = 0.2

/** The hottest a box gets, °C: its heater cuts out there (a hot plate's thermostat), 250 °C past its boiling point and at least 300 °C. */
export const hotLimit = (s: Substance, start: number) => Math.max(start, (s.boil ?? s.sublime ?? 0) + 250, 300)
/** The coldest, °C: a cooler stops at −200 °C (or at its start if colder). */
export const coldLimit = (start: number) => Math.min(start, -200)

/**
 * How much nearer than touching the soft particles come, × Barker & Henderson's √(πkT/2k): 2.2, measured (matter.test.ts "ideal gas": the
 * gauge reads nRT/V within 4 % from packing 0.03 to 0.44 and −150 to 300 °C); the contacts of a Maxwell gas's fast tail and the thermostat's
 * kicks press in further than the mean energy's.
 */
const GIVE = 2.2

/** Henderson's compressibility of a gas of hard discs at packing fraction η (the share of the area the discs cover). */
export const hardDiscZ = (eta: number) => (1 + (eta * eta) / 8) / ((1 - eta) * (1 - eta))

export interface BoxSpec {
	/** Inside of the box, m (the model's size). */
	readonly width: number
	readonly height: number
	readonly substance: Substance
	/** A second substance for mixing (its particles start on the right of the divider), or none. */
	readonly second?: Substance
	/** The particles (all of them; mixing: half each side), their radius m. */
	readonly count: number
	readonly radius: number
	/** The real sample: its mass, kg, and the real volume the box stands for, m³ (with a piston: below the piston at its start). */
	readonly mass: number
	readonly volume: number
	/** Start temperature, °C; the heater's power, W (negative: cooling), from when (s, run time). */
	readonly start: number
	readonly heater: number
	readonly heatFrom: number
	/** A piston (a lid free to slide, starting at `pistonAt` × the height): its load, kg, on the real piston's area, m², under the outside air (Pa). */
	readonly piston: boolean
	readonly pistonAt: number
	readonly load: number
	readonly area: number
	readonly outside: number
	/** m/s²: what the load weighs per kg (the run's gravity; 9.81 when not given). */
	readonly gravity?: number
	/** A piston driven by hand instead of a load (a syringe's plunger): from `from` to `until` (s) it moves from its start to `to` × the
	 *  height (smoothly: u²(3 − 2u) of the time share). */
	readonly drive?: { readonly from: number; readonly until: number; readonly to: number } | null
	/** Mixing: a divider down the middle until `openAt` (s): one colour each side (two gases, or one liquid or gas in two colours). */
	readonly divider: boolean
	readonly openAt: number
	/** Seed of the starting directions. */
	readonly seed: number
}

const WALL_FLOOR = 0
const WALL_SIDES = 1
const WALL_LID = 2
const WALL_DIVIDER = 3

export interface BoxReadings {
	/** °C */
	temperature: number
	solid: number
	liquid: number
	gas: number
	/** kPa, mL */
	pressure: number
	volume: number
	/** real mean molecular speed, m/s */
	speed: number
	/** J put in by the heater since the start (negative: taken out) */
	heat: number
	/** 0 (unmixed) to 1 (evenly mixed) */
	mixed: number
	/** the piston's height above the floor, m (model) */
	piston: number
}

export class ParticleBox {
	readonly spec: BoxSpec
	readonly p: Particles
	/** Heat content (stateAt's count), J, and heat added so far. */
	H: number
	added = 0
	readonly readings: BoxReadings
	/** The piston's height (its underside above the floor), velocity, model mass; the divider's state. */
	pistonY: number
	pistonV = 0
	/** A loaded piston's real volume, m³ (it may go lower than the drawn piston can: the picture's particles need room). */
	realV: number
	/** The particles' wall hits as a gauge would read them, kPa (a picture's diagnostic: never a reading). */
	measured = 0
	private readonly pistonMass: number
	private readonly pistonStart: number
	dividerOn: boolean
	/** Substeps per 480 Hz step. */
	readonly subSteps: number
	readonly n0: number
	/** Which particles started left of the middle (mixing: one colour each side). */
	readonly left0: Uint8Array
	private gaugeImpulse = 0
	private gaugeTime = 0
	private gaugeExpected = 0
	private pressureNow = 0
	private readonly gaugeRatios: number[] = []
	private readonly hot: number
	private readonly cold: number
	readonly kT: (T: number, s: Substance) => number
	private readonly rnd: () => number

	constructor(spec: BoxSpec) {
		this.spec = spec
		const s1 = spec.substance
		const s2 = spec.second
		const W = spec.width
		const Hh = spec.height
		const r = spec.radius
		this.hot = hotLimit(s1, spec.start)
		this.cold = coldLimit(spec.start)
		const massOf = (s: Substance) => (PARTICLE_MASS * s.molar) / s1.molar
		this.kT = (T: number, s: Substance) => 0.5 * massOf(s) * (SPEED_SCALE * rmsSpeed(s.molar, T)) ** 2
		const lightest = s2 !== undefined && s2.molar < s1.molar ? s2 : s1
		const mMin = massOf(lightest)
		const vmax = 3 * SPEED_SCALE * rmsSpeed(lightest.molar, this.hot)
		// contacts: at the hottest, at three times the rms speed, two particles overlap OVERLAP of a radius
		const stiffness = ((mMin / 2) * vmax * vmax) / (OVERLAP * r) ** 2
		const melt = s1.melt ?? s1.sublime ?? 0
		const boil = s1.boil ?? s1.sublime ?? 0
		// Lindemann: <u²> = 2kT/K_eff, K_eff = 3 k_bond in a triangular lattice, rms u = LINDEMANN × 2r at the melting point
		const bondStiffness = (2 * this.kT(melt, s1)) / (3 * (LINDEMANN * 2 * r) ** 2)
		const range = 0.5
		const well = BINDING * this.kT(boil, s1)
		const cohesionForce = (well * 3) / (2 * range * 2 * r)
		const omegaContact = Math.sqrt((2 * stiffness) / mMin)
		const omegaBond = Math.sqrt((6 * bondStiffness) / massOf(s1))
		const maxSub = Math.min(Math.PI / omegaContact / 10, (2 * Math.PI) / omegaBond / 20)
		this.subSteps = Math.max(1, Math.min(64, Math.ceil(1 / 480 / maxSub)))
		const kinds = [s1, ...(s2 === undefined ? [] : [s2])].map((s) => ({
			radius: r,
			mass: massOf(s),
			restitution: 1,
			friction: 0,
			magnetic: 0,
			volume: (4 / 3) * Math.PI * r * r * r
		}))
		this.n0 = Math.max(1, Math.round(spec.count))
		this.left0 = new Uint8Array(this.n0)
		this.p = new Particles(
			{
				kinds,
				stiffness,
				gravity: { x: 0, y: -1 },
				// (the solid's weight against the liquid's by their real densities: ice floats in water, solid wax sinks in molten wax)
				gravityByPhase: [0, CONDENSED_GRAVITY, (CONDENSED_GRAVITY * s1.solidDensity) / s1.liquidDensity],
				cohesionRange: range,
				cohesionForce,
				liquidDamping: 0,
				bondStiffness,
				bondDamping: 0.02,
				bounds: { x0: -W / 2 - 0.01, y0: -0.01, x1: W / 2 + 0.01, y1: Hh + 0.01 },
				maxSubStep: maxSub,
				// a gas or liquid particle bounces off the walls without loss (the thermostat is the walls' temperature) and slides along
				// them (a liquid spreads over the floor); the solid settles on them (a block of ice rests on the floor: restitution 0.3, friction 0.5)
				wallByPhase: [null, [1, 0], [0.3, 0.5]]
			},
			this.n0
		)
		const p = this.p
		p.impulseMask = 1 << FREE // (the gauge feels the gas's hits; a liquid or solid resting on the floor is not gas pressure)
		const t = 0.002 // the walls' half-thickness
		const wall = (ax: number, ay: number, bx: number, by: number, group: number) => p.addWall({ ax, ay, bx, by, r: t, group, restitution: 1, friction: 0 })
		wall(-W / 2 - t, -t, W / 2 + t, -t, WALL_FLOOR)
		wall(-W / 2 - t, -t, -W / 2 - t, Hh + t, WALL_SIDES)
		wall(W / 2 + t, -t, W / 2 + t, Hh + t, WALL_SIDES)
		this.pistonStart = spec.piston ? Math.max(8 * r, Math.min(Hh, spec.pistonAt * Hh)) : Hh
		wall(-W / 2, Hh + t, W / 2, Hh + t, WALL_LID)
		p.groupOffset[WALL_LID] = { x: 0, y: this.pistonStart - Hh }
		this.pistonY = this.pistonStart
		this.realV = spec.volume
		this.dividerOn = spec.divider
		wall(0, -t, 0, Hh + t, WALL_DIVIDER)
		if (!spec.divider) p.groupOffset[WALL_DIVIDER] = { x: 0, y: -10 }
		// the sample's starting state and its particles
		this.H = heatAt(s1, spec.mass, spec.start)
		const st = stateAt(s1, spec.mass, this.H)
		const rnd = random(spec.seed)
		this.rnd = random(spec.seed * 7919 + 17)
		const twoGases = s2 !== undefined
		const nSolid = twoGases ? 0 : Math.round(st.solid * this.n0)
		const nGas = twoGases ? this.n0 : Math.round(st.gas * this.n0)
		const nLiquid = this.n0 - nSolid - nGas
		const top0 = this.pistonStart
		const gap = 2 * r * 1.02
		const rowH = gap * 0.8660254037844386
		const speed = (s: Substance) => SPEED_SCALE * rmsSpeed(s.molar, spec.start)
		const put = (kind: number, x: number, y: number, phase: number, v: number) => {
			const d = randomDirection(rnd)
			const i = p.add(kind, Math.max(-W / 2 + r, Math.min(W / 2 - r, x)), Math.max(r, Math.min(top0 - r, y)), d.x * v, d.y * v, phase)
			this.left0[i] = x < 0 ? 1 : 0
		}
		/** count particles in rows (a triangular lattice) across [x0, x1] from height y0 up; returns the height they take. */
		const lattice = (count: number, x0: number, x1: number, phase: number, y0: number) => {
			// rows of `across`, every other row shifted half a gap with one fewer (a triangular lattice that fits between x0 and x1)
			const across = Math.max(2, Math.floor((x1 - x0 - 2 * r) / gap) + 1)
			const used = (across - 1) * gap
			const mid = (x0 + x1) / 2
			let row = 0
			let col = 0
			for (let k = 0; k < count; k++) {
				const inRow = row % 2 === 1 ? across - 1 : across
				if (col >= inRow) {
					row++
					col = 0
				}
				const shift = row % 2 === 1 ? gap / 2 : 0
				put(0, mid - used / 2 + col * gap + shift, y0 + r + row * rowH, phase, phase === SOLID ? speed(s1) * 0.3 : speed(s1) * 0.5)
				col++
			}
			return (row + 1) * rowH
		}
		/** count particles of a kind spread over [x0, x1] × [y0, y1] on a grid. */
		const spread = (count: number, kind: number, x0: number, x1: number, y0: number, y1: number) => {
			if (count <= 0) return
			const w = x1 - x0 - 2 * r
			const hh = Math.max(2 * r, y1 - y0 - 2 * r)
			const cols = Math.max(1, Math.round(Math.sqrt((count * w) / hh)))
			const rows = Math.ceil(count / cols)
			for (let k = 0; k < count; k++) {
				const x = x0 + r + ((k % cols) + 0.5) * (w / cols)
				const y = y0 + r + (Math.floor(k / cols) + 0.5) * (hh / rows)
				put(kind, x, y, FREE, speed(kind === 0 ? s1 : (s2 as Substance)))
			}
		}
		const half = 0.004 // the divider's half-thickness and a gap
		let top = 0
		if (nSolid > 0) {
			const across = Math.max(1, Math.round(Math.sqrt(nSolid * 1.15)))
			top = lattice(nSolid, -((across + 1) * gap) / 2, ((across + 1) * gap) / 2, SOLID, 0)
		}
		if (nLiquid > 0) {
			if (spec.divider) {
				const left = Math.ceil(nLiquid / 2)
				lattice(left, -W / 2, -half, LIQUID, top)
				lattice(nLiquid - left, half, W / 2, LIQUID, top)
			} else lattice(nLiquid, -W / 2, W / 2, LIQUID, top)
		}
		if (nGas > 0) {
			const across = Math.max(1, Math.floor((W - 2 * r) / gap) + 1)
			const floor = nSolid + nLiquid > 0 ? Math.max(top, Math.ceil((nSolid + nLiquid) / across) * rowH) + r : 0
			if (twoGases || spec.divider) {
				const left = Math.ceil(nGas / 2)
				spread(left, 0, -W / 2, -half, floor, top0)
				spread(nGas - left, twoGases ? 1 : 0, half, W / 2, floor, top0)
			} else spread(nGas, 0, -W / 2, W / 2, floor, top0)
		}
		// the solid and the liquid start with no motion as a whole (their particles' mean velocity taken off)
		for (const phase of [SOLID, LIQUID]) {
			let mx = 0
			let my = 0
			let c = 0
			for (let i = 0; i < p.n; i++) if (p.phase[i] === phase) (mx += p.vx[i] as number), (my += p.vy[i] as number), c++
			if (c > 0) for (let i = 0; i < p.n; i++) if (p.phase[i] === phase) (p.vx[i] = (p.vx[i] as number) - mx / c), (p.vy[i] = (p.vy[i] as number) - my / c)
		}
		p.bondSolids(1.1)
		// the piston's model mass: it settles in about a second
		this.pistonMass = spec.piston ? (this.n0 * PARTICLE_MASS) / 2 : 0
		this.readings = { temperature: st.T, solid: st.solid, liquid: st.liquid, gas: st.gas, pressure: 0, volume: 0, speed: 0, heat: 0, mixed: 0, piston: this.pistonStart }
		// (the gauge starts at the sample's ideal pressure: its first reading of the hits comes a quarter second in)
		this.pressureNow = this.pressureReading(st.T, s2 === undefined ? st.gas : 1, s2 === undefined ? st.solid : 0, s2 === undefined ? st.liquid : 0)
		this.measured = this.pressureNow / 1000
		this.update()
	}

	/** A driven piston's height at run time t, m. */
	drivenAt(t: number) {
		const d = this.spec.drive
		if (!d) return this.pistonY
		const H = this.spec.height
		const span = d.until - d.from
		const u = span > 0 ? Math.min(1, Math.max(0, (t - d.from) / span)) : t >= d.from ? 1 : 0
		const w = u * u * (3 - 2 * u)
		return Math.max(4 * this.spec.radius, Math.min(H, this.pistonStart + (d.to * H - this.pistonStart) * w))
	}

	/** The box's height to the lid now, m. */
	height() {
		return this.spec.piston ? this.pistonY : this.spec.height
	}

	/** The real volume now, m³ (it follows the piston: a loaded one's own real volume, a hand-driven one's height). */
	realVolume() {
		if (this.spec.piston && !this.spec.drive) return this.realV
		return (this.spec.volume * this.height()) / this.pistonStart
	}

	/** The real volume of the sample's solid and liquid, m³ (no piston squeezes it smaller). */
	condensedVolume(solid: number, liquid: number) {
		const s = this.spec.substance
		return this.spec.second === undefined ? this.spec.mass * (solid / s.solidDensity + liquid / s.liquidDensity) : 0
	}

	/** What the sample's gas presses now, Pa: nRT/V; a loaded piston resting on the solid or liquid presses its own load on them. */
	pressureReading(T: number, gasShare: number, solid: number, liquid: number) {
		const ideal = this.idealPressure(T, gasShare)
		if (!this.spec.piston || this.spec.drive) return ideal
		const P = this.pistonPressure()
		const floor = this.condensedVolume(solid, liquid)
		return floor > 0 && this.realV <= floor * (1 + 1e-9) && ideal < P ? P : ideal
	}

	/** The real sample's ideal-gas pressure (its gas share) at T °C in the volume now, Pa. */
	idealPressure(T: number, gasShare = 1) {
		return (((this.spec.mass / this.spec.substance.molar) * gasShare * R * (T + KELVIN)) / this.realVolume()) * (this.spec.second === undefined ? 1 : 1)
	}

	/**
	 * The force per unit length a gas of `count` model particles at T °C makes on the walls of the box as it is now, N/m (2-D): Z(η)·N·kT
	 * over the area their centres can reach, η the share of that area the discs cover.
	 */
	modelPressure(T: number, count: number) {
		const { pair, wall } = this.softSizes(T)
		const area = (this.spec.width - 2 * wall) * (this.height() - 2 * wall)
		if (!(area > 0) || count === 0) return 0
		const eta = Math.min(0.7, (count * Math.PI * pair * pair) / area)
		// (every kind has the same kT at one temperature)
		return (hardDiscZ(eta) * count * this.kT(T, this.spec.substance)) / area
	}

	/**
	 * The hard-disc sizes the soft particles act as at T °C (Barker & Henderson, J. Chem. Phys. 47, 4714, 1967: d = ∫(1 − e^(−u/kT)) dr):
	 * for a linear contact u = ½k·δ² a pair comes nearer by √(πkT/2k) than touching (each radius by half of it), a wall by the same on the
	 * particle's own radius. Returns the effective radius against another particle and the effective distance a centre keeps from a wall.
	 */
	softSizes(T: number) {
		const r = this.spec.radius
		const give = GIVE * Math.sqrt((Math.PI * this.kT(T, this.spec.substance)) / (2 * this.p.spec.stiffness))
		return { pair: r - give / 2, wall: r - give }
	}

	/** The real pressure the piston's load makes (Pa): the outside air and its weight on the area. */
	pistonPressure() {
		return this.spec.outside + (this.spec.load * (this.spec.gravity ?? 9.81)) / this.spec.area
	}

	/** The heater's work over dt seconds of process time (time-lapsed), from `heatFrom` (run time t); it cuts out at the box's hot and cold limits. */
	heat(dt: number, t: number) {
		if (t < this.spec.heatFrom || this.spec.heater === 0 || this.spec.second !== undefined) return
		const s = this.spec.substance
		const T = stateAt(s, this.spec.mass, this.H).T
		if ((this.spec.heater > 0 && T >= this.hot) || (this.spec.heater < 0 && T <= this.cold)) return
		let q = this.spec.heater * dt
		const limit = heatAt(s, this.spec.mass, this.spec.heater > 0 ? this.hot : this.cold)
		if (this.spec.heater > 0 && this.H + q > limit) q = Math.max(0, limit - this.H)
		if (this.spec.heater < 0 && this.H + q < limit) q = Math.min(0, limit - this.H)
		this.H += q
		this.added += q
	}

	/** The gas particles now. */
	gasCount() {
		let g = 0
		for (let i = 0; i < this.p.n; i++) if (this.p.phase[i] === FREE) g++
		return g
	}

	/** Assigns phases to match the heat's fractions: the surface first (melting from the fewest-bonded, boiling from the top). */
	private phases() {
		const s = this.spec.substance
		const st = stateAt(s, this.spec.mass, this.H)
		if (this.spec.second !== undefined) return st
		const p = this.p
		const N = this.n0
		const wantSolid = Math.round(st.solid * N)
		const wantGas = Math.round(st.gas * N)
		let solid = 0
		let gas = 0
		for (let i = 0; i < p.n; i++) {
			if (p.phase[i] === SOLID) solid++
			else if (p.phase[i] === FREE) gas++
		}
		const sublimes = s.sublime !== undefined
		const bonds = new Int32Array(p.n)
		for (let b = 0; b < p.bondA.length; b++) {
			bonds[p.bondA[b] as number]++
			bonds[p.bondB[b] as number]++
		}
		const pick = (from: number, score: (i: number) => number) => {
			let best = -1
			let bestScore = -Infinity
			for (let i = 0; i < p.n; i++) {
				if (p.phase[i] !== from) continue
				const sc = score(i)
				if (sc > bestScore) {
					bestScore = sc
					best = i
				}
			}
			return best
		}
		const surface = (j: number) => -10 * (bonds[j] as number) + (p.y[j] as number)
		let changed = false
		while (solid > wantSolid) {
			// melts (or sublimes): the fewest bonds first, then the highest
			const i = pick(SOLID, surface)
			if (i < 0) break
			p.phase[i] = sublimes ? FREE : LIQUID
			if (sublimes) gas++
			solid--
			changed = true
		}
		while (gas > wantGas) {
			// condenses (or deposits as frost): the lowest gas particle
			const i = pick(FREE, (j) => -(p.y[j] as number))
			if (i < 0) break
			p.phase[i] = sublimes ? SOLID : LIQUID
			if (sublimes) solid++
			gas--
			changed = true
		}
		while (gas < wantGas) {
			// boils: the highest liquid particle (a subliming solid: its surface)
			const i = sublimes ? pick(SOLID, surface) : pick(LIQUID, (j) => p.y[j] as number)
			if (i < 0) break
			if (sublimes) solid--
			p.phase[i] = FREE
			gas++
			changed = true
		}
		let froze = false
		while (solid < wantSolid) {
			// freezes: the lowest liquid particle
			const i = pick(LIQUID, (j) => -(p.y[j] as number))
			if (i < 0) break
			p.phase[i] = SOLID
			solid++
			froze = true
		}
		if (changed || froze) p.pruneBonds()
		if (froze) p.bondSolids(1.1)
		return st
	}

	/** One engine step of h seconds (the 480 Hz step) at run time t: the particles in sub-steps, the piston, the divider, the gauge. */
	advance(h: number, t: number) {
		const p = this.p
		const s = this.spec
		const st = this.phases()
		if (this.dividerOn && t >= s.openAt) {
			this.dividerOn = false
			p.groupOffset[WALL_DIVIDER] = { x: 0, y: -10 }
		}
		const sub = h / this.subSteps
		const gas = this.gasCount()
		const expected = this.modelPressure(st.T, gas)
		const soft = this.softSizes(st.T)
		const ideal = this.idealPressure(st.T, s.second === undefined ? st.gas : 1)
		const r = s.radius
		for (let k = 0; k < this.subSteps; k++) {
			p.clearImpulses()
			p.step(sub)
			// the heat bath: every particle's motion drawn to the temperature's (one kT for every kind at one temperature: a heavier
			// gas's particles move slower, Graham), the gas loosely (τ 0.2 s: its free flights stay straight), the liquid and solid closer (0.05 s)
			p.langevin(this.kT(st.T, s.substance), [0.2, 0.05, 0.05], sub, this.rnd, 1 << SOLID)
			// the solid's sideways motion as a whole dies away in about 0.05 s (friction on the floor, the liquid's drag): a block of ice sits still
			this.holdSolid(sub)
			// the gas's hits on the walls (the gauge; the divider is left out)
			let impulse = 0
			for (let g = 0; g < p.impulse.length; g++) if (g !== WALL_DIVIDER) impulse += (p.impulse[g] as { normal: number }).normal
			this.gaugeImpulse += impulse
			this.gaugeTime += sub
			this.gaugeExpected += expected * sub
			if (s.piston && s.drive) {
				// a hand on the plunger: it goes where the hand puts it, whatever the gas pushes
				const y = this.drivenAt(t + (k + 1) * sub)
				this.pistonV = (y - this.pistonY) / sub
				this.pistonY = y
				p.groupOffset[WALL_LID] = { x: 0, y: this.pistonY - s.height }
				p.groupVelocity[WALL_LID] = { x: 0, y: this.pistonV }
			} else if (s.piston) {
				// the piston follows the real gas: it slides (damped, in about PISTON_TAU) toward the height where the sample's gas pressure
				// nRT/V equals the outside air and its load (Boyle, Charles), never down into the solid or liquid under it; the particles, a
				// picture of the gas, bounce off it as it moves (so few particles would push it about by 1/√N: a real gas's 10²³ do not)
				// (in real volume: V → nRT/P, never below the solid's and liquid's own volume nor past the box's top; the drawn piston follows
				// as far as the drawn particles leave room)
				const P = this.pistonPressure()
				const gasMol = (s.mass / s.substance.molar) * (s.second === undefined ? st.gas : 1)
				const most = (s.volume * s.height) / this.pistonStart
				const condensed = this.condensedVolume(st.solid, st.liquid)
				const want = Math.min(most, Math.max(condensed, P > 0 ? (gasMol * R * (st.T + KELVIN)) / P : most))
				this.realV = this.realV + (want - this.realV) * (1 - Math.exp(-sub / PISTON_TAU))
				let floor = 4 * r
				for (let i = 0; i < p.n; i++) if (p.alive[i] === 1 && p.phase[i] !== FREE) floor = Math.max(floor, (p.y[i] as number) + 2 * r)
				const y = Math.min(s.height, Math.max(floor, (this.pistonStart * this.realV) / s.volume))
				this.pistonV = (y - this.pistonY) / sub
				this.pistonY = y
				p.groupOffset[WALL_LID] = { x: 0, y: this.pistonY - s.height }
				p.groupVelocity[WALL_LID] = { x: 0, y: this.pistonV }
			}
		}
		if (this.gaugeTime >= GAUGE) {
			const length = 2 * (s.width - 2 * soft.wall) + 2 * (this.height() - 2 * soft.wall)
			const measured = this.gaugeImpulse / this.gaugeTime / length
			const want = this.gaugeExpected / this.gaugeTime
			// the gauge's needle is damped: it shows the mean of its last GAUGE_WINDOWS windows (a second) of hits against what they should be
			// (a window with fewer than GAUGE_LEAST gas particles says too little: it counts as the ideal value)
			if (want > 0) {
				this.gaugeRatios.push(gas >= GAUGE_LEAST ? measured / want : 1)
				if (this.gaugeRatios.length > GAUGE_WINDOWS) this.gaugeRatios.shift()
			}
			let mean = 0
			for (const v of this.gaugeRatios) mean += v
			this.measured = this.gaugeRatios.length > 0 ? (ideal * mean) / this.gaugeRatios.length / 1000 : 0
			this.gaugeImpulse = 0
			this.gaugeTime = 0
			this.gaugeExpected = 0
		}
		// (the reading: the real sample's, in the volume the step ended at)
		this.pressureNow = this.pressureReading(st.T, s.second === undefined ? st.gas : 1, s.second === undefined ? st.solid : 0, s.second === undefined ? st.liquid : 0)
		this.update()
	}

	private holdSolid(h: number) {
		const p = this.p
		let mv = 0
		let m = 0
		for (let i = 0; i < p.n; i++) {
			if (p.phase[i] !== SOLID || p.alive[i] === 0) continue
			mv += (p.m[i] as number) * (p.vx[i] as number)
			m += p.m[i] as number
		}
		if (m === 0) return
		const dv = (mv / m) * (1 - Math.exp(-h / 0.05))
		for (let i = 0; i < p.n; i++) if (p.phase[i] === SOLID && p.alive[i] === 1) p.vx[i] = (p.vx[i] as number) - dv
	}

	private update() {
		const s = this.spec
		const st = stateAt(s.substance, s.mass, this.H)
		const r = this.readings
		r.temperature = st.T
		r.solid = s.second === undefined ? st.solid : 0
		r.liquid = s.second === undefined ? st.liquid : 0
		r.gas = s.second === undefined ? st.gas : 1
		r.heat = this.added
		r.speed = rmsSpeed(s.substance.molar, st.T) * Math.sqrt(8 / (3 * Math.PI))
		r.volume = this.realVolume() * 1e6
		r.pressure = this.pressureNow / 1000
		r.piston = this.height()
		if (!s.divider) {
			r.mixed = 0
			return
		}
		// mixing: the left particles' share on the right plus the right particles' share on the left (1: evenly mixed)
		const p = this.p
		let a = 0
		let aRight = 0
		let b = 0
		let bLeft = 0
		for (let i = 0; i < p.n; i++) {
			const left = (p.x[i] as number) < 0
			if (this.left0[i] === 1) {
				a++
				if (!left) aRight++
			} else {
				b++
				if (left) bLeft++
			}
		}
		r.mixed = a > 0 && b > 0 ? Math.min(1, aRight / a + bLeft / b) : 0
	}
}
