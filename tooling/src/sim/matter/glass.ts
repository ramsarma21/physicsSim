/**
 * A glass of water with crystals in it (salt, sugar, sand), in three dimensions: the glass is a round cylinder, so its crystals swirl round
 * it when it is stirred, in front of and behind one another, as in a real glass. Each crystal in the model is a pinch of real grains
 * (`grains` of them, of the real grain size) drawn as one speck; it sinks through the water against its drag (Schiller-Naumann), rests on the
 * floor, is carried round by the stirring and dissolves at the rate dissolve.ts gives for its real grains, in the concentration where it
 * is (the brine layer on the floor, or the water above).
 *
 * Stirring (a spoon going round at `stir` turns a second from `stirFrom`): the water turns as a Rankine vortex (solid-body inside 0.6 of the
 * glass's radius, a free vortex outside) at half the spoon's speed where the spoon is, spun up and down with a time `spinUp` (Greenspan,
 * The Theory of Rotating Fluids, 1968: spin-up in about H/√(νΩ)); next to the floor its inflow sweeps the crystals to the middle (Einstein's
 * tea-leaf effect, Naturwissenschaften 14, 223, 1926). `timeLapse`: the dissolving (and only it) runs that many times faster than the
 * motion beyond MOTION_LAPSE, so a lesson can show minutes in seconds; the readouts give real (lesson) time.
 */
import { rateAt, saturated, water } from "./dissolve.ts"
import { type Solute, solubility } from "./substances.ts"

export interface GlassSpec {
	/** Inner radius and height of the glass, m. */
	readonly radius: number
	readonly height: number
	/** Water's depth, m, and its temperature, °C. */
	readonly depth: number
	readonly temperature: number
	readonly solute: Solute
	/** The solute's mass, kg, its real grain diameter, m, and the specks it is drawn as. */
	readonly mass: number
	readonly grain: number
	readonly specks: number
	/** When the solute goes in (s) and from how high above the floor it is poured, m; before that it is in the spoon (`specks` not in the water).
	 *  startIn "glass": it lies on the floor from the start. */
	readonly pourAt: number
	readonly pourHeight: number
	readonly startIn?: "spoon" | "dish" | "glass"
	/** The dissolving's speed against a solid crystal's (a sugar cube is two-thirds air: water soaks in; 1 for grains). */
	readonly porous?: number
	/** Spoon turns a second (0: not stirred), from when (s) until when (s). */
	readonly stir: number
	readonly stirFrom: number
	readonly stirUntil: number
	readonly timeLapse: number
	readonly seed: number
}

/** The thickness of the brine layer on the floor, m: the crystals there dissolve into it. */
const LAYER = 0.003

/** Turns of the water that mix the glass when it is stirred (about one: the layer is swept up). */
const STIRRED_MIX = 0.6
/** The longest sub-step of the crystals' motion, s of lesson time, and the most the motion is sped up by a time-lapse. */
const SUB = 0.01
export const MOTION_LAPSE = 20
/** A crystal's friction on the glass floor (salt or sugar on glass, wet: about 0.4). */
const FLOOR_FRICTION = 0.4

export class Glass {
	readonly spec: GlassSpec
	readonly n: number
	x: Float64Array
	y: Float64Array
	z: Float64Array
	vx: Float64Array
	vy: Float64Array
	vz: Float64Array
	/** Mass now of each speck, kg, and its mass at the start. */
	m: Float64Array
	readonly m0: number
	/** Real grains per speck, and the radius a whole speck is drawn at, m. */
	readonly grainsPer: number
	readonly drawRadius: number
	poured = false
	/** The solute dissolved, kg, in the layer and in the water above; the water's angular speed, rad/s. */
	inLayer = 0
	inBulk = 0
	omega = 0
	/** Real time passed for the dissolving, s. */
	clock = 0
	private readonly volume: number
	private readonly layerVolume: number

	constructor(spec: GlassSpec) {
		this.spec = spec
		this.n = Math.max(1, Math.round(spec.specks))
		this.x = new Float64Array(this.n)
		this.y = new Float64Array(this.n)
		this.z = new Float64Array(this.n)
		this.vx = new Float64Array(this.n)
		this.vy = new Float64Array(this.n)
		this.vz = new Float64Array(this.n)
		this.m = new Float64Array(this.n)
		this.m0 = spec.mass / this.n
		const grainMass = (spec.solute.density * Math.PI * spec.grain * spec.grain * spec.grain) / 6
		this.grainsPer = Math.max(1, this.m0 / grainMass)
		// a speck of one grain is drawn at the grain's size; a pinch of many at least 1 mm across... the size its grains would heap to
		this.drawRadius = Math.max(spec.grain / 2, Math.min(0.0015, 0.5 * Math.pow((6 * this.m0) / (Math.PI * spec.solute.density * 0.6), 1 / 3)))
		this.volume = Math.PI * spec.radius * spec.radius * spec.depth
		this.layerVolume = Math.PI * spec.radius * spec.radius * Math.min(LAYER, spec.depth)
		// the specks start in a heap in the spoon over the glass's middle, or (startIn "glass") spread on its floor round the middle
		// (deterministic: a golden-angle spiral)
		const onFloor = spec.startIn === "glass"
		this.landed = new Uint8Array(this.n)
		this.floorList = new Int32Array(this.n)
		this.floorRadius = new Float64Array(this.n)
		this.k = new Float64Array(this.n).fill(1)
		this.slip = new Float64Array(this.n)
		this.w = water(spec.temperature)
		this.Cs = saturated(spec.solute, spec.temperature)
		this.rate = rateAt(spec.solute, spec.temperature)
		for (let i = 0; i < this.n; i++) {
			const a = i * 2.399963229728653
			// (a spoonful leaves the spoon about 1.5 cm across; on the floor the specks lie side by side, about one layer)
			const rr = (onFloor ? Math.min(0.85 * spec.radius, 1.2 * this.drawRadius * Math.sqrt(this.n)) : 0.012) * Math.sqrt((i + 0.5) / this.n)
			this.x[i] = rr * Math.cos(a)
			this.z[i] = rr * Math.sin(a)
			this.y[i] = onFloor ? this.drawRadius : spec.pourHeight + 0.002 * (i % 3)
			this.m[i] = this.m0
			if (onFloor) this.landed[i] = 1
		}
		if (onFloor) this.poured = true
	}

	/** Which specks have gone into the water (weighed with the glass from then on). */
	readonly landed: Uint8Array
	/** (scratch: the specks on the floor and their radii, for spreadOnFloor) */
	private readonly floorList: Int32Array
	private readonly floorRadius: Float64Array
	/** Each speck's size now against its start ((m/m0)^⅓) and its slip through the water at the last step's end, m/s. */
	private readonly k: Float64Array
	private readonly slip: Float64Array
	/** The water at the glass's temperature, the saturated concentration (kg/m³) and dissolveRate for this solute in it. */
	private readonly w: { rho: number; mu: number; nu: number }
	private readonly Cs: number
	private readonly rate: (d: number, slip: number, C: number) => number
	private readonly flowAt = { x: 0, y: 0, z: 0 }

	/** The solute in the water now, kg: dissolved, and the crystals that have gone in (what a scale under the glass weighs of it). */
	inGlass() {
		let m = this.dissolved()
		for (let i = 0; i < this.n; i++) if (this.landed[i] === 1) m += this.m[i] as number
		return m
	}

	/** The concentration (kg/m³) in the brine layer and in the water above. */
	concentration() {
		// C = w·ρ(w): w the solute's share of the solution's mass, ρ the solution's density (linear in w up to the saturated solution's), so
		// the water saturates exactly at the solubility (grams per 100 g of WATER), however much the solution swells
		const rhoW = water(this.spec.temperature).rho
		const Cs = saturated(this.spec.solute, this.spec.temperature)
		const S = solubility(this.spec.solute, this.spec.temperature)
		const wSat = S / (1 + S)
		const rhoSat = wSat > 0 ? Cs / wSat : rhoW
		const of = (dissolved: number, volume: number) => {
			const mw = volume * rhoW
			if (!(mw > 0)) return 0
			const w = dissolved / (mw + dissolved)
			return w * (rhoW + (wSat > 0 ? ((rhoSat - rhoW) * w) / wSat : 0))
		}
		const above = this.volume - this.layerVolume
		const layer = of(this.inLayer, this.layerVolume)
		return { layer, bulk: above > 0 ? of(this.inBulk, above) : layer }
	}

	/** The solute dissolved per gram of water, g/g, over the whole glass (solubility(...) when saturated). */
	strength() {
		const mw = this.volume * water(this.spec.temperature).rho
		return mw > 0 ? this.dissolved() / mw : 0
	}

	/** The water's velocity at (x, y, z), m/s (Rankine vortex about the glass's axis, the tea-leaf inflow at the floor). */
	flow(x: number, y: number, z: number, out: { x: number; y: number; z: number }) {
		const R = this.spec.radius
		const rc = 0.6 * R
		const r = Math.sqrt(x * x + z * z)
		out.x = 0
		out.y = 0
		out.z = 0
		if (r === 0 || this.omega === 0) return
		const ut = r < rc ? this.omega * r : (this.omega * rc * rc) / r
		// tangential (counter-clockwise seen from above): (−z, x)/r
		out.x = (-z / r) * ut
		out.z = (x / r) * ut
		if (y < LAYER) {
			const inflow = 0.3 * ut * (1 - y / LAYER)
			out.x -= (x / r) * inflow
			out.z -= (z / r) * inflow
		}
	}

	/**
	 * One engine step of h seconds of the run at run time t. The glass lives on the lesson clock (h × timeLapse seconds pass in it): its
	 * crystals' motion is followed in sub-steps of at most SUB s, but at most MOTION_LAPSE times faster than real (a faster time-lapse speeds
	 * only the dissolving beyond that), so a sinking crystal reaches the floor in a time-lapse as it would in a time-lapse film. The pour and
	 * the spoon follow the run's clock (`pourAt`, `stirFrom`, `stirUntil` are run seconds); the spoon turns `stir` times a lesson second.
	 */
	step(t: number, h: number) {
		const s = this.spec
		if (!this.poured && t >= s.pourAt && s.startIn !== "glass") this.poured = true
		if (!this.poured) return
		const lapse = Math.max(1, s.timeLapse)
		const motion = Math.min(lapse, MOTION_LAPSE)
		const extra = lapse / motion // the dissolving's own speed-up beyond the motion's
		const lesson = h * motion
		const n = Math.max(1, Math.ceil(lesson / SUB - 1e-9))
		const dt = lesson / n
		const stirring = s.stir > 0 && t >= s.stirFrom && t < s.stirUntil
		const rest = !stirring && this.omega === 0 && this.resting()
		if (rest) {
			// (lying still on the floor: they only dissolve, and sink onto the floor as they shrink)
			for (let i = 0; i < this.n; i++) {
				if (!((this.m[i] as number) > 0)) continue
				this.y[i] = this.drawRadius * (this.k[i] as number)
				this.vy[i] = 0
				this.slip[i] = 0
			}
		} else {
			for (let k = 0; k < n; k++) this.move(dt, stirring)
			this.spreadOnFloor()
		}
		this.dissolve(lesson, extra)
		this.clock += h * lapse
	}

	/** Crystals lying on the floor do not overlap: each pair that does is pushed apart along the floor, half the overlap each (one pass per
	 *  engine step, in index order: a heap spreads into a layer as poured grains do). */
	private spreadOnFloor() {
		const floor = this.floorList
		const rad = this.floorRadius
		let k = 0
		for (let i = 0; i < this.n; i++) {
			if (!((this.m[i] as number) > 0)) continue
			const ri = this.drawRadius * (this.k[i] as number)
			if ((this.y[i] as number) > ri + 1e-6) continue
			floor[k] = i
			rad[k] = ri
			k++
		}
		for (let a = 0; a < k; a++) {
			const i = floor[a] as number
			const ri = rad[a] as number
			for (let b = a + 1; b < k; b++) {
				const j = floor[b] as number
				const rj = rad[b] as number
				const dx = (this.x[j] as number) - (this.x[i] as number)
				const dz = (this.z[j] as number) - (this.z[i] as number)
				const d2 = dx * dx + dz * dz
				const want = 0.9 * (ri + rj)
				if (d2 >= want * want) continue
				const d = Math.sqrt(d2)
				// (two at one spot: apart along a direction set by their indices)
				const nx = d > 1e-9 ? dx / d : Math.cos(i * 2.39996 + j)
				const nz = d > 1e-9 ? dz / d : Math.sin(i * 2.39996 + j)
				const push = (want - d) / 2
				this.x[i] = (this.x[i] as number) - nx * push
				this.z[i] = (this.z[i] as number) - nz * push
				this.x[j] = (this.x[j] as number) + nx * push
				this.z[j] = (this.z[j] as number) + nz * push
			}
		}
	}

	/** Whether every crystal left lies still on the floor (still water: nothing moves them, only the dissolving goes on). */
	private resting() {
		for (let i = 0; i < this.n; i++) {
			if (!((this.m[i] as number) > 0)) continue
			const rd = this.drawRadius * (this.k[i] as number)
			if ((this.y[i] as number) > rd + 0.0005 || this.vx[i] !== 0 || this.vz[i] !== 0 || Math.abs(this.vy[i] as number) > 0.01) return false
		}
		return true
	}

	/** One sub-step of dt lesson seconds of the crystals' motion (and the water's turning). Each speck's slip through the water at its end is
	 *  kept for the dissolving. */
	private move(dt: number, stirring: boolean) {
		const s = this.spec
		const { rho, mu, nu } = this.w
		// the water's turning: spun toward half the spoon's speed while it stirs (in about 0.8 s), and down after with a spin-down time H/√(νΩ)
		const target = stirring ? Math.PI * s.stir : 0
		const scale = Math.max(Math.abs(target), Math.abs(this.omega), 0.5)
		const spin = stirring ? 0.8 : s.depth / Math.sqrt(nu * scale)
		this.omega += (target - this.omega) * (1 - Math.exp(-dt / spin))
		if (Math.abs(this.omega) < 1e-4 && !stirring) this.omega = 0
		const grav = 9.81
		const flowAt = this.flowAt
		const R = s.radius
		const sink = 1 - rho / s.solute.density
		for (let i = 0; i < this.n; i++) {
			if (!((this.m[i] as number) > 0)) continue
			const k = this.k[i] as number
			const rd = this.drawRadius * k
			const d = s.grain * k
			let ux = this.vx[i] as number
			let uy = this.vy[i] as number
			let uz = this.vz[i] as number
			const inWater = (this.y[i] as number) < s.depth
			if (inWater) this.landed[i] = 1
			// gravity less buoyancy, and drag toward the water (implicit; its coefficient at the slip before this sub-step's kick, so a grain
			// settles at exactly its terminal speed), on one real grain (the speck moves as its grains do)
			let rel = 0
			if (inWater) {
				this.flow(this.x[i] as number, this.y[i] as number, this.z[i] as number, flowAt)
				rel = Math.sqrt((ux - flowAt.x) * (ux - flowAt.x) + (uy - flowAt.y) * (uy - flowAt.y) + (uz - flowAt.z) * (uz - flowAt.z))
			}
			uy -= (inWater ? grav * sink : grav) * dt
			if (inWater) {
				const re = (rel * d) / nu
				const grainMass = (s.solute.density * Math.PI * d * d * d) / 6
				const beta = (3 * Math.PI * mu * d * (1 + 0.15 * Math.pow(re, 0.687))) / grainMass
				const f = 1 / (1 + dt * beta)
				ux = (ux + dt * beta * flowAt.x) * f
				uy = (uy + dt * beta * flowAt.y) * f
				uz = (uz + dt * beta * flowAt.z) * f
			}
			let px = (this.x[i] as number) + dt * ux
			let py = (this.y[i] as number) + dt * uy
			let pz = (this.z[i] as number) + dt * uz
			// the floor: rests on it, and slides along it only as fast as the water drags it against its friction
			if (py < rd) {
				py = rd
				if (uy < 0) uy = 0
				const slow = Math.max(0, 1 - (FLOOR_FRICTION * grav * sink * dt) / Math.max(1e-9, Math.sqrt(ux * ux + uz * uz)))
				ux *= slow
				uz *= slow
				// (in still water a crystal on the floor comes to rest: exactly, so the glass can skip its motion)
				if (this.omega === 0 && Math.sqrt(ux * ux + uz * uz) < 1e-5) {
					ux = 0
					uz = 0
				}
			}
			// the glass's side
			const rr = Math.sqrt(px * px + pz * pz)
			const lim = R - rd
			if (rr > lim && rr > 0) {
				const nx = px / rr
				const nz = pz / rr
				px = nx * lim
				pz = nz * lim
				const vn = ux * nx + uz * nz
				if (vn > 0) {
					ux -= vn * nx
					uz -= vn * nz
				}
			}
			this.x[i] = px
			this.y[i] = py
			this.z[i] = pz
			this.vx[i] = ux
			this.vy[i] = uy
			this.vz[i] = uz
			if (inWater) {
				this.flow(px, py, pz, flowAt)
				this.slip[i] = Math.sqrt((ux - flowAt.x) * (ux - flowAt.x) + (uy - flowAt.y) * (uy - flowAt.y) + (uz - flowAt.z) * (uz - flowAt.z))
			} else this.slip[i] = 0
		}
	}

	/**
	 * The dissolving over dt lesson seconds of motion (dt × extra of dissolving): each speck in the water loses dissolveRate for its real grains
	 * at its slip through the water, where it is (the brine layer on the floor or the water above); then the layer and the water above even
	 * out: by diffusion across the layer when still (its time LAYER²/2D: a dense layer under lighter water is stable), and in about a turn of
	 * the water when it turns, exactly over the step: share = 1 − e^(−dt/τ).
	 */
	private dissolve(dt: number, extra: number) {
		const s = this.spec
		const conc = this.concentration()
		let toLayer = 0
		let toBulk = 0
		if (this.Cs > 0) {
			const rate = this.rate
			const per = (s.porous ?? 1) * this.grainsPer * dt * extra
			for (let i = 0; i < this.n; i++) {
				const mi = this.m[i] as number
				if (!(mi > 0) || (this.y[i] as number) >= s.depth) continue
				// (on the floor: in the brine layer, or lying on the floor however big: a sugar cube sits in the brine it makes)
				const onFloor = (this.y[i] as number) < LAYER || (this.y[i] as number) <= this.drawRadius * (this.k[i] as number) + 1e-6
				const d = s.grain * (this.k[i] as number)
				let loss = Math.min(mi, rate(d, this.slip[i] as number, onFloor ? conc.layer : conc.bulk) * per)
				if (mi - loss < this.m0 * 1e-4) loss = mi
				if (!(loss > 0)) continue
				this.m[i] = mi - loss
				this.k[i] = mi - loss > 0 ? Math.pow((mi - loss) / this.m0, 1 / 3) : 0
				if (onFloor) toLayer += loss
				else toBulk += loss
			}
		}
		this.inLayer += toLayer
		this.inBulk += toBulk
		const D = s.solute.diffusivity > 0 ? s.solute.diffusivity : 1e-9
		const still = (LAYER * LAYER) / (2 * D)
		const turn = Math.abs(this.omega) > 1e-6 ? (STIRRED_MIX * 2 * Math.PI) / Math.abs(this.omega) : Infinity
		const share = 1 - Math.exp(-(dt * extra) / still) * (turn === Infinity ? 1 : Math.exp(-dt / turn))
		const total = this.inLayer + this.inBulk
		const layerEq = (total * this.layerVolume) / this.volume // (the same strength, grams per gram of water, everywhere)
		if (this.volume > this.layerVolume) {
			this.inLayer += (layerEq - this.inLayer) * share
			this.inBulk = total - this.inLayer
		}
	}

	/** Solute dissolved, kg, and left as crystals, kg. */
	dissolved() {
		return this.inLayer + this.inBulk
	}

	undissolved() {
		let u = 0
		for (let i = 0; i < this.n; i++) u += this.m[i] as number
		return u
	}
}
