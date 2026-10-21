/**
 * Mixtures of real grains and how they are separated: a dish of a mixture (sand and gravel, sand and iron filings, salt and pepper, rice
 * and beans...), a sieve that lets the small grains through its mesh while it is shaken, a magnet that pulls the iron out (matter/particles.ts
 * underneath, at real gravity, real grain densities and frictions).
 *
 * The simulation is a slice through the mixture one grain thick, behind the dish's front glass (a 2-D granular model, Cundall & Strack 1979):
 * the grains of each component are discs of that component's grain size; their numbers follow the components' volume shares (a slice
 * through a well-mixed heap holds each component by its volume fraction), so the masses in grams belong to the whole 3-D mixture while
 * the slice shows how its grains move. A sieve's mesh is a row of round wires with gaps of its aperture; a grain passes if it is smaller.
 */
import { FREE, type Kind, Particles, random } from "./particles.ts"

/** A component of a mixture: its real grain size, density, friction and restitution, colour and magnetism. */
export interface Grain {
	readonly key: string
	readonly name: string
	/** Grain diameter, m (the disc's), and how much it varies (±, a share). */
	readonly size: number
	readonly spread: number
	/** Grain density (not the bulk's), kg/m³. */
	readonly density: number
	readonly friction: number
	readonly restitution: number
	/** χ_eff·V/μ0 per unit volume (1/μ0 × effective susceptibility, A/(m·T)) for a magnetic grain; its magnetisation saturates at `saturation` A/m. */
	readonly susceptibility: number
	readonly saturation: number
	readonly color: string
	readonly source: string
}

/** The most a magnet pulls a grain with, × its weight (see Mixture.magnetForce). */
export const PULL_CAP = 40

/** μ0, T·m/A. */
export const MU0 = 4e-7 * Math.PI

export const GRAINS: Readonly<Record<string, Grain>> = {
	sand: {
		key: "sand",
		name: "sand",
		size: 0.002,
		spread: 0.2,
		density: 2650,
		friction: 0.55,
		restitution: 0.3,
		susceptibility: 0,
		saturation: 0,
		color: "#d9b97c",
		source: "Very coarse quartz sand about 2 mm (Wentworth: 1-2 mm very coarse sand, 2-4 mm granules), 2.65 g/cm³; grain friction 0.5-0.6 (angle of repose 30-35°) (CRC Handbook; Cundall & Strack 1979)."
	},
	gravel: {
		key: "gravel",
		name: "gravel",
		size: 0.007,
		spread: 0.25,
		density: 2650,
		friction: 0.6,
		restitution: 0.4,
		susceptibility: 0,
		saturation: 0,
		color: "#8d8a83",
		source: "Fine gravel / pea gravel 4-10 mm (Wentworth: granules to pebbles), quartz 2.65 g/cm³."
	},
	"iron-filings": {
		key: "iron-filings",
		name: "iron filings",
		size: 0.0015,
		spread: 0.25,
		density: 7870,
		friction: 0.6,
		restitution: 0.2,
		// an elongated iron particle magnetises along its length with χ_eff ≈ 1/N, N the demagnetising factor (needle-like filings ≈ 0.05-0.1)
		susceptibility: 15 / (4e-7 * Math.PI),
		saturation: 1.71e6,
		color: "#3d3f42",
		source: "Iron 7.87 g/cm³, saturation magnetisation 1.71 MA/m; a filing's effective susceptibility ≈ 1/N ≈ 10-20 for its needle shape (Jiles, Introduction to Magnetism and Magnetic Materials, 2nd ed., ch. 2)."
	},
	salt: {
		key: "salt",
		name: "salt",
		size: 0.0015,
		spread: 0.2,
		density: 2165,
		friction: 0.6,
		restitution: 0.2,
		susceptibility: 0,
		saturation: 0,
		color: "#f4f4f2",
		source: "Coarse salt crystals about 1 mm, 2.165 g/cm³ (CRC Handbook)."
	},
	pepper: {
		key: "pepper",
		name: "ground pepper",
		size: 0.0015,
		spread: 0.3,
		density: 1100,
		friction: 0.6,
		restitution: 0.2,
		susceptibility: 0,
		saturation: 0,
		color: "#2b2622",
		source: "Coarse ground black pepper about 1 mm, particle density about 1.1 g/cm³ (bulk 0.5): it floats on water, salt dissolves."
	},
	rice: {
		key: "rice",
		name: "rice",
		size: 0.003,
		spread: 0.1,
		density: 1450,
		friction: 0.45,
		restitution: 0.3,
		susceptibility: 0,
		saturation: 0,
		color: "#f3eee0",
		source: "Long-grain rice about 2 × 7 mm (drawn as its 3 mm cross-section), kernel density 1.45 g/cm³ (USDA)."
	},
	beans: {
		key: "beans",
		name: "dried beans",
		size: 0.011,
		spread: 0.15,
		density: 1300,
		friction: 0.4,
		restitution: 0.4,
		susceptibility: 0,
		saturation: 0,
		color: "#7a2e24",
		source: "Dried kidney beans about 15 × 9 mm (drawn 11 mm), density 1.3 g/cm³ (USDA)."
	},
	"paper-clips": {
		key: "paper-clips",
		name: "steel paper clips",
		size: 0.008,
		spread: 0.05,
		density: 7850,
		friction: 0.4,
		restitution: 0.3,
		// a paper clip is a bent wire: demagnetising factor along it small (χ_eff ≈ 20) but only ~15 % of its outline is steel
		susceptibility: 3 / (4e-7 * Math.PI),
		saturation: 1.6e6 * 0.15,
		color: "#c7ccd1",
		source: "A 33 mm paper clip (0.8 mm steel wire, 0.5 g) drawn as an 8 mm disc whose mass is the clip's: 15 % of its outline is steel."
	}
}

/** One component of a mixture as built: its grain, its mass in grams (of the whole 3-D mixture). */
export interface Component {
	readonly grain: Grain
	readonly mass: number
}

/** A field a magnet makes: B (T) at a point of the system's frame, and its gradient (∂|B|/∂x, ∂|B|/∂y, T/m). */
export type FieldAt = (x: number, y: number) => { bx: number; by: number }

export interface MixtureSpec {
	readonly components: readonly Component[]
	/** Discs in the slice (all components together). */
	readonly grains: number
	/** The dish's inside, m: width, wall height; its floor is y = 0 at the dish's anchor. */
	readonly width: number
	readonly wall: number
	/** Where the heap starts: in the dish (false) or poured from above at `pourHeight` m (true: the grains start in a column and fall). */
	readonly pour: boolean
	readonly pourHeight: number
	/** A sieve over the dish (0: none): its aperture, wire diameter, its height above the floor, how wide it is, its rim height. */
	readonly aperture: number
	readonly wire: number
	readonly sieveHeight: number
	readonly sieveWidth: number
	/** Shaking: amplitude m, frequency Hz, from and until (s). */
	readonly shake: number
	readonly shakeHz: number
	readonly shakeFrom: number
	readonly shakeUntil: number
	readonly seed: number
}

const DISH = 0
const SIEVE = 1

/** Groups' indices for the host: 0 the dish, 1 the sieve. */
export const MIXTURE_GROUPS = { dish: DISH, sieve: SIEVE } as const

/** The grains' contact softness: a column of 20 of the smallest grains presses its bottom one in by this share of its radius (a few per
 *  cent: real sand is far stiffer, but its contacts would need sub-steps of microseconds; a few per cent of overlap does not change how
 *  grains of 2 and 7 mm pass a 4 mm mesh, or what a magnet lifts), and the sub-steps a contact between two of them is resolved in. */
const OVERLAP = 0.04
const CONTACT_STEPS = 6

export class Mixture {
	readonly spec: MixtureSpec
	readonly p: Particles
	/** Each disc's component (index into spec.components). */
	readonly component: Uint8Array
	readonly subSteps: number
	/** The magnets' field (set by the host each step), or none. */
	field: FieldAt | undefined
	private sieveX = 0

	constructor(spec: MixtureSpec) {
		this.spec = spec
		const comps = spec.components.filter((c) => c.mass > 0)
		const kinds: Kind[] = []
		// each component's disc count: its volume share of the slice's area, over one disc's area
		const vol = comps.map((c) => c.mass / 1000 / c.grain.density)
		const total = vol.reduce((a, b) => a + b, 0)
		const shares = vol.map((v, i) => (total > 0 ? v / total / ((comps[i] as Component).grain.size * (comps[i] as Component).grain.size) : 0))
		const shareSum = shares.reduce((a, b) => a + b, 0)
		const counts = shares.map((s) => Math.max(s > 0 ? 1 : 0, Math.round((spec.grains * s) / (shareSum || 1))))
		// three sizes per component (its spread), so a heap does not crystallise
		const sizes = [-1, 0, 1]
		for (const c of comps)
			for (const k of sizes) {
				const d = c.grain.size * (1 + (k * c.grain.spread) / 1.5)
				const r = d / 2
				const volume = (4 / 3) * Math.PI * r * r * r
				kinds.push({ radius: r, mass: c.grain.density * volume, restitution: c.grain.restitution, friction: c.grain.friction, magnetic: c.grain.susceptibility > 0 ? 1 : 0, volume })
			}
		let smallest = Infinity
		let lightest = Infinity
		for (const k of kinds) {
			smallest = Math.min(smallest, k.radius)
			lightest = Math.min(lightest, k.mass)
		}
		// contact stiffness (k ∝ R², particles.ts): a column of 20 of the smallest grains presses its bottom one in by OVERLAP of its radius;
		// the sub-step follows the fastest contact, two of the lightest grains, resolved in CONTACT_STEPS sub-steps
		const smallKind = kinds.reduce((a, b) => (b.radius < a.radius ? b : a))
		const stiffness = (20 * smallKind.mass * 9.81) / (OVERLAP * smallKind.radius)
		const omega = Math.sqrt((2 * stiffness) / smallKind.mass)
		const maxSub = Math.PI / omega / CONTACT_STEPS
		void lightest
		this.subSteps = Math.max(1, Math.min(64, Math.ceil(1 / 480 / maxSub)))
		const W = spec.width
		const top = Math.max(spec.wall, spec.sieveHeight + spec.wall, spec.pour ? spec.pourHeight + 0.15 : 0) + 0.05
		this.p = new Particles(
			{
				kinds,
				stiffness,
				refRadius: smallKind.radius,
				gravity: { x: 0, y: -9.81 },
				gravityByPhase: [1, 1, 1],
				cohesionRange: 0,
				cohesionForce: 0,
				liquidDamping: 0,
				bondStiffness: 0,
				bondDamping: 0,
				bounds: { x0: -W / 2 - 0.05, y0: -0.01, x1: W / 2 + 0.05, y1: top },
				maxSubStep: maxSub
			},
			counts.reduce((a, b) => a + b, 0)
		)
		const p = this.p
		const t = 0.003
		// the dish: a floor and two walls (wood or glass: friction 0.4)
		p.addWall({ ax: -W / 2 - t, ay: -t, bx: W / 2 + t, by: -t, r: t, group: DISH, restitution: 0.3, friction: 0.4 })
		p.addWall({ ax: -W / 2 - t, ay: -t, bx: -W / 2 - t, by: spec.wall, r: t, group: DISH, restitution: 0.3, friction: 0.4 })
		p.addWall({ ax: W / 2 + t, ay: -t, bx: W / 2 + t, by: spec.wall, r: t, group: DISH, restitution: 0.3, friction: 0.4 })
		p.group(SIEVE)
		if (spec.aperture > 0) {
			// the sieve: wires across at sieveHeight, centre to centre aperture + wire, and its rim walls
			const pitch = spec.aperture + spec.wire
			const n = Math.max(2, Math.floor(spec.sieveWidth / pitch))
			const x0 = -((n - 1) * pitch) / 2
			for (let k = 0; k < n; k++) p.addDisc({ x: x0 + k * pitch, y: spec.sieveHeight, r: spec.wire / 2, group: SIEVE, restitution: 0.3, friction: 0.3 })
			const sw = (n - 1) * pitch / 2 + spec.wire / 2 + 0.002
			p.addWall({ ax: -sw, ay: spec.sieveHeight, bx: -sw, by: spec.sieveHeight + Math.max(spec.wall, 0.04), r: 0.002, group: SIEVE, restitution: 0.3, friction: 0.4 })
			p.addWall({ ax: sw, ay: spec.sieveHeight, bx: sw, by: spec.sieveHeight + Math.max(spec.wall, 0.04), r: 0.002, group: SIEVE, restitution: 0.3, friction: 0.4 })
		}
		// the grains: well mixed (a deterministic shuffle), in rows over the place they start
		const rnd = random(spec.seed)
		const order: number[] = []
		counts.forEach((c, ci) => {
			for (let k = 0; k < c; k++) order.push(ci)
		})
		for (let k = order.length - 1; k > 0; k--) {
			const j = Math.floor(rnd() * (k + 1))
			const a = order[k] as number
			order[k] = order[j] as number
			order[j] = a
		}
		this.component = new Uint8Array(order.length)
		let biggest = 0
		for (const k of kinds) biggest = Math.max(biggest, k.radius)
		const width = spec.aperture > 0 ? Math.min(W, spec.sieveWidth) * 0.8 : W * 0.96
		const base = spec.aperture > 0 ? spec.sieveHeight + spec.wire : spec.pour ? spec.pourHeight : 0
		let x = -width / 2
		let y = base + biggest
		let rowTop = 0
		for (let k = 0; k < order.length; k++) {
			const ci = order[k] as number
			const kind = ci * 3 + Math.floor(rnd() * 3)
			const r = (kinds[kind] as Kind).radius
			if (x + 2 * r > width / 2) {
				x = -width / 2
				y += rowTop + 0.0002
				rowTop = 0
			}
			const i = p.add(kind, x + r, y + r, 0, 0, FREE)
			this.component[i] = ci
			x += 2 * r + 0.0002
			rowTop = Math.max(rowTop, 2 * r)
		}
		const comps2 = comps
		this.components = comps2
		const susc = kinds.map((_, kind) => (comps2[Math.floor(kind / 3)] as Component).grain)
		this.grainOf = susc
		p.field = (q, i) => this.magnetForce(q, i)
	}

	readonly components: readonly Component[]
	private readonly grainOf: readonly Grain[]

	/**
	 * The pull on a magnetic grain: F = V·M·∇|B| with M = min(χ_eff·|B|/μ0, M_s) (a soft grain magnetised along the field, saturating),
	 * the gradient by central differences 0.5 mm apart.
	 */
	private magnetForce(q: Particles, i: number) {
		const f = this.field
		if (f === undefined) return
		const g = this.grainOf[q.kind[i] as number] as Grain
		const x = q.x[i] as number
		const y = q.y[i] as number
		const e = 0.0005
		const mag = (bx: number, by: number) => Math.sqrt(bx * bx + by * by)
		const c = f(x, y)
		const B = mag(c.bx, c.by)
		if (!(B > 1e-7)) return
		const a = f(x + e, y)
		const b = f(x - e, y)
		const u = f(x, y + e)
		const d = f(x, y - e)
		const gx = (mag(a.bx, a.by) - mag(b.bx, b.by)) / (2 * e)
		const gy = (mag(u.bx, u.by) - mag(d.bx, d.by)) / (2 * e)
		const M = Math.min(g.susceptibility * B, g.saturation)
		const r = q.r[i] as number
		const V = (4 / 3) * Math.PI * r * r * r
		let fx = V * M * gx
		let fy = V * M * gy
		// a grain-sized contact cannot hold the thousands of g a strong magnet's face pulls with: the pull is capped at PULL_CAP × the grain's
		// weight (far more than holds it; the filings still jump the same gaps, which only need a little over 1 g)
		const cap = PULL_CAP * (q.m[i] as number) * 9.81
		const pull = Math.sqrt(fx * fx + fy * fy)
		if (pull > cap) {
			fx = (fx * cap) / pull
			fy = (fy * cap) / pull
		}
		q.fx[i] = (q.fx[i] as number) + fx
		q.fy[i] = (q.fy[i] as number) + fy
	}

	/** One engine step of h seconds at run time t (moving = after the release: the grains are held in place before it). */
	advance(h: number, t: number, moving: boolean) {
		const s = this.spec
		const p = this.p
		const sub = h / this.subSteps
		for (let k = 0; k < this.subSteps; k++) {
			const tk = t + k * sub
			if (s.aperture > 0 && s.shake > 0 && tk >= s.shakeFrom && tk < s.shakeUntil) {
				const w = 2 * Math.PI * s.shakeHz
				const ph = w * (tk - s.shakeFrom)
				this.sieveX = s.shake * Math.sin(ph)
				p.groupOffset[SIEVE] = { x: this.sieveX, y: 0 }
				p.groupVelocity[SIEVE] = { x: s.shake * w * Math.cos(ph), y: 0 }
			} else {
				p.groupVelocity[SIEVE] = { x: 0, y: 0 }
			}
			if (moving) {
				p.step(sub)
				if (s.aperture > 0) this.holdOnMesh()
			}
		}
	}

	/**
	 * The mesh is steel: a grain wider than its holes can never sink between two wires further than where it touches both (its centre
	 * √((r + wire/2)² − (pitch/2)²) above theirs); the contacts' softness, a few per cent of a grain, would let a grain of 1.7 mm through a
	 * 1.5 mm hole when shaken. Such a grain is set back on that seat and its speed down into the mesh taken away.
	 */
	private holdOnMesh() {
		const s = this.spec
		const p = this.p
		const pitch = s.aperture + s.wire
		const n = Math.max(2, Math.floor(s.sieveWidth / pitch))
		const half = ((n - 1) * pitch) / 2
		const off = p.groupOffset[SIEVE] as { x: number; y: number }
		const vy0 = (p.groupVelocity[SIEVE] as { x: number; y: number }).y
		for (let i = 0; i < p.n; i++) {
			if (p.alive[i] === 0) continue
			const r = p.r[i] as number
			if (2 * r <= s.aperture) continue
			const x = (p.x[i] as number) - off.x
			if (x < -half || x > half) continue
			const reach = r + s.wire / 2
			const seat = s.sieveHeight + off.y + Math.sqrt(reach * reach - (pitch / 2) * (pitch / 2))
			const y = p.y[i] as number
			if (y < seat && y > s.sieveHeight + off.y - r) {
				p.y[i] = seat
				if ((p.vy[i] as number) < vy0) p.vy[i] = vy0
			}
		}
	}

	/** The sieve's sideways offset now, m. */
	sieveOffset() {
		return this.sieveX
	}

	/** For each component: its share of grains below the sieve (passed through), and its share within `region` (x0..x1, y0..y1). */
	shares(region?: { x0: number; x1: number; y0: number; y1: number }) {
		const n = this.components.length
		const count = new Array(n).fill(0) as number[]
		const below = new Array(n).fill(0) as number[]
		const inside = new Array(n).fill(0) as number[]
		const p = this.p
		for (let i = 0; i < p.n; i++) {
			const c = this.component[i] as number
			count[c] = (count[c] as number) + 1
			const y = p.y[i] as number
			const x = p.x[i] as number
			if (this.spec.aperture > 0 && y < this.spec.sieveHeight) below[c] = (below[c] as number) + 1
			if (region !== undefined && x >= region.x0 && x <= region.x1 && y >= region.y0 && y <= region.y1) inside[c] = (inside[c] as number) + 1
		}
		return count.map((c, k) => ({ passed: c > 0 ? (below[k] as number) / c : 0, inside: c > 0 ? (inside[k] as number) / c : 0, count: c }))
	}
}

/**
 * A bar magnet's field in its own plane (the Gilbert model: a north and a south pole of strength q_m = Br·A/μ0 at its ends, each giving
 * B = μ0·q_m/(4π r²) along r: Jackson, Classical Electrodynamics, 3rd ed., §5.9), m and T. `length` between the poles, `area` its
 * cross-section, Br its remanence (ceramic ferrite 0.39 T, alnico 1.25 T, neodymium N42 1.3 T), its north pole at angle `angle` (rad).
 * Each pole is softened over `soft` (m²: r² + soft in its 1/r²): a pole face is a disc, not a point. A cylinder magnet of radius R with its
 * poles at its faces and soft = R²/3 gives the exact on-axis field B(z) = (Br/2)·[(z+L)/√((z+L)²+R²) − z/√(z²+R²)] (e.g. Furlani, Permanent
 * Magnet and Electromechanical Devices, 2001, §2.7) within 12 % from 3 mm to 4 cm off its face (research/rw-validate-matter.ts).
 */
export const barMagnet = (cx: number, cy: number, angle: number, length: number, area: number, br: number, soft = 0.002 * 0.002): FieldAt => {
	const k = (br * area) / (4 * Math.PI)
	const ux = Math.cos(angle)
	const uy = Math.sin(angle)
	const nx = cx + (ux * length) / 2
	const ny = cy + (uy * length) / 2
	const sx = cx - (ux * length) / 2
	const sy = cy - (uy * length) / 2
	return (x, y) => {
		const ax = x - nx
		const ay = y - ny
		const bx = x - sx
		const by = y - sy
		const ra = ax * ax + ay * ay + soft
		const rb = bx * bx + by * by + soft
		const fa = k / (ra * Math.sqrt(ra))
		const fb = k / (rb * Math.sqrt(rb))
		return { bx: fa * ax - fb * bx, by: fa * ay - fb * by }
	}
}
