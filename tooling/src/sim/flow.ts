/**
 * Flowing liquids for the engine (the flow module's physics; tooling/src/sim/modules/flow.ts runs it through the plug-in framework). Pure
 * arithmetic on world metres, kilograms and seconds: no planck here.
 *
 * Two kinds of liquid, handed back and forth:
 * - FREE liquid is PARTICLES: what is pouring, spurting, splashing, running down a ramp or over a waterwheel, or lying in a puddle. A
 *   position-based fluid (Macklin & Müller, "Position Based Fluids", ACM TOG 32(4), 2013) in the machine plane: each particle keeps its
 *   neighbours at the rest spacing `s` (a one-sided density constraint: liquid is pushed apart where it is crowded and never pulled into a
 *   clump, so a free surface stays smooth), mass-weighted (Macklin et al., "Unified particle physics", ACM TOG 33(4), 2014) so a heavier
 *   liquid sinks under a lighter one; gravity; solids push particles out of themselves and take the particles' momentum back (a jet turns a
 *   waterwheel, a stream weighs on a cup); viscosity (an implicit, unconditionally stable diffusion of velocity with a no-slip wall, so honey
 *   creeps and water splashes); colours (food dye) carried by the particles and mixed by the flow's own shear (Smagorinsky's eddy
 *   diffusivity, J. Atmos. Sci. 1963, with C_s = 0.17 (Lilly 1967) and a turbulent Schmidt number 0.7; molecular diffusion of dye, about
 *   4·10⁻¹⁰ m²/s, is far too slow to see).
 *   Each particle also carries the VOLUME of liquid it stands for (m³): the side view is a slice, so a particle is s × s in the plane and
 *   (volume / s²) front to back — a thin jet's particles are thin, a pitcher's pour is as deep as its spout is wide. Volumes are what the
 *   containers count, so every millilitre is accounted for whatever the slice looks like.
 * - STILL liquid is a BASIN: the liquid standing in a container (a pitcher, a bottle, a cup, a bucket...), level whatever the container's
 *   tilt, in layers by density (bottom first), with the volume it holds conserved exactly. It drains through holes in its wall (an orifice:
 *   Torricelli's law with the discharge coefficient of a sharp-edged hole, and Sampson's creeping flow for thick liquids), over its lowest
 *   rim when it is tipped or overfilled (a weir; Nusselt's film flow for thick liquids), and through hoses (Bernoulli with an entrance loss
 *   and the pipe's friction: Poiseuille when laminar, Blasius when turbulent). Particles that fall into a basin's liquid, or come to rest in
 *   its empty bottom, join it (their volume and colour are added). The fluids module's fixed containers (water tanks, beakers...) are
 *   basins too, through its own interface (modules/flow.ts).
 *
 * Sources (the numbers below):
 *   [WHITE] F. M. White, Fluid Mechanics, 7th ed. (2011): sharp-edged orifice C_d 0.61, C_v 0.97 (§6.12, Fig. 6.41); sharp entrance loss
 *           K 0.5 (Table 6.5); laminar pipe friction f = 64/Re below Re 2300; Blasius f = 0.3164 Re^−¼ for smooth pipes up to Re 10⁵ (eq. 6.48).
 *   [SAMPSON] R. A. Sampson, Phil. Trans. R. Soc. A 182 (1891) 449: creeping flow through a circular hole of radius r in a thin wall,
 *           Q = r³Δp/(3μ). Here the hole's pressure drop is the inertial and the viscous drops added (provisional between the two limits).
 *   [HENDERSON] F. M. Henderson, Open Channel Flow (1966) §6.6: a sharp-crested weir, q = C_d·⅔·√(2g)·H^{3/2}, C_d ≈ 0.62; critical
 *           depth ⅔ H over the crest.
 *   [NUSSELT] W. Nusselt, Z. VDI 60 (1916) 541: a laminar film of thickness h on a vertical wall carries q = g·h³/(3ν) per metre of width.
 *   [LILLY] D. K. Lilly, IBM Sci. Comput. Symp. on Environmental Sciences (1967): Smagorinsky constant 0.17.
 *   [KUBELKA31] P. Kubelka & F. Munk, Z. Tech. Phys. 12 (1931) 593: a deep scattering layer's diffuse reflectance R∞ = 1 + K/S − √((K/S)² + 2K/S)
 *           (K ≈ 2 × the absorption coefficient for diffuse light). What a scattering liquid (milk, white food colouring) looks like (seenOf).
 *   [MILK-SCAT] whole milk's reduced scattering coefficient about 2-3 mm⁻¹ in the visible (Aernouts et al., J. Dairy Sci. 98 (2015) 6727:
 *           raw milk's bulk optical properties): 25 per cm used for milk (provisional).
 *   [USDA-MILK] USDA FoodData Central, whole milk 3.25 % fat: 88 g of water in 100 g; it mixes with water in any share (WATERY).
 *   [ARRHENIUS87] S. Arrhenius, Z. Phys. Chem. 1 (1887) 285: the viscosity of a mixture of liquids that mix, ln μ = Σ φ_i ln μ_i (volume
 *           shares); used for milk, chocolate milk and water poured together (mixOf; provisional for an emulsion).
 */
import type { Point } from "#sim/plugins.ts"

/** A liquid as the particles and basins know it: its words, density (kg/m³) and dynamic viscosity (Pa·s). */
export interface FlowLiquid {
	readonly words: string
	readonly density: number
	readonly viscosity: number
}

/** Dye as absorbance per centimetre of light path, red, green and blue (Beer–Lambert: what shows through is exp(−a·path)), and, only for a
 *  dye that scatters light (white food colouring; milk's fat droplets and casein: 2026-10-20), a fourth number: its scattering per cm
 *  (seenOf below). Mixed by volume like the absorbances; a liquid without one is clear and keeps three numbers. */
export type Dye = readonly [number, number, number] | readonly [number, number, number, number]

/** A dye's scattering per cm: its fourth number (0 without one). */
export const scatterOf = (a: Dye) => (a.length > 3 ? (a[3] as number) : 0)

/** A liquid's colour with its own added (its own as a liquid: milk's whiteness, honey's amber): three numbers unless either scatters. */
export const dyePlus = (a: Dye, own: Dye): Dye => {
	const r: [number, number, number] = [(a[0] as number) + (own[0] as number), (a[1] as number) + (own[1] as number), (a[2] as number) + (own[2] as number)]
	const s = scatterOf(a) + scatterOf(own)
	return s !== 0 ? [r[0], r[1], r[2], s] : r
}
/** A colour less a liquid's own (what a layer keeps as its dye when its own colour is added back where it is seen): may go below 0. */
export const dyeLess = (a: Dye, own: Dye): Dye => {
	const r: [number, number, number] = [(a[0] as number) - (own[0] as number), (a[1] as number) - (own[1] as number), (a[2] as number) - (own[2] as number)]
	const s = scatterOf(a) - scatterOf(own)
	return s !== 0 || a.length > 3 ? [r[0], r[1], r[2], s] : r
}
/** v0 m³ of colour a and v1 m³ of colour b mixed (absorbances and scattering per cm, by volume). */
export const dyeMix = (a: Dye, v0: number, b: Dye, v1: number): Dye => {
	const t = v0 + v1
	if (!(t > 0)) return a
	const r: [number, number, number] = [((a[0] as number) * v0 + (b[0] as number) * v1) / t, ((a[1] as number) * v0 + (b[1] as number) * v1) / t, ((a[2] as number) * v0 + (b[2] as number) * v1) / t]
	const s0 = scatterOf(a)
	const s1 = scatterOf(b)
	return s0 !== 0 || s1 !== 0 ? [r[0], r[1], r[2], (s0 * v0 + s1 * v1) / t] : r
}

/**
 * Liquids that are mostly water and mix with it, and with one another, as soon as they are poured together (2026-10-21): water, milk (88 %
 * water [USDA-MILK]) and chocolate milk. Milk poured into water (or water into milk) clouds all of it at once: ONE liquid, never milk lying
 * under the water as oil lies on it. Every other pair keeps to its own layer by density as before (oil on water, honey under it, and a
 * density column's salt water, syrup, soap and alcohol, whose layers are the lesson).
 */
export const WATERY: ReadonlySet<string> = new Set(["water", "milk", "chocolate milk"])
export const mixesWith = (a: string, b: string) => WATERY.has(a) && WATERY.has(b)
/** v0 m³ of liquid a and v1 m³ of b mixed into one: its density by volume (they mix with no change of volume), its viscosity by Arrhenius'
 *  rule for liquids that mix, ln μ by volume [ARRHENIUS87] (μa^φa · μb^φb: the engine's pow, the same bits everywhere; no Math.log). */
export const mixOf = (a: { readonly density: number; readonly viscosity: number }, v0: number, b: { readonly density: number; readonly viscosity: number }, v1: number) => {
	const t = v0 + v1
	if (!(t > 0) || !(v1 > 0)) return { density: a.density, viscosity: a.viscosity }
	if (!(v0 > 0)) return { density: b.density, viscosity: b.viscosity }
	return {
		density: (a.density * v0 + b.density * v1) / t,
		viscosity: a.viscosity > 0 && b.viscosity > 0 ? Math.pow(a.viscosity, v0 / t) * Math.pow(b.viscosity, v1 / t) : (a.viscosity * v0 + b.viscosity * v1) / t
	}
}

// ------------------------------------------------------------------------------------------------ flow laws (pure)
/** A sharp-edged hole's discharge and velocity coefficients [WHITE]. */
export const ORIFICE_CD = 0.61
export const ORIFICE_CV = 0.97
/** A sharp-crested weir's discharge coefficient [HENDERSON]. */
export const WEIR_CD = 0.62
/** A hose's sharp entrance loss coefficient [WHITE]. */
export const ENTRANCE_K = 0.5

/**
 * The flow out of a round hole of diameter d (m) in a thin wall under a pressure p (Pa) of a liquid of density rho (kg/m³) and
 * viscosity mu (Pa·s): the inertial drop ρQ²/(2(C_d·a)²) [WHITE] and Sampson's viscous drop 3μQ/r³ [SAMPSON] together equal p.
 * Returns the flow q (m³/s) and the jet's speed at its narrowest (v = Q/(C_c·a), C_c = C_d/C_v: C_v·√(2p/ρ) for a thin liquid).
 */
export const orificeFlow = (p: number, d: number, rho: number, mu: number): { q: number; v: number } => {
	if (!(p > 0) || !(d > 0) || !(rho > 0)) return { q: 0, v: 0 }
	const r = d / 2
	const a = Math.PI * r * r
	const A = rho / (2 * ORIFICE_CD * ORIFICE_CD * a * a)
	const B = (3 * Math.max(0, mu)) / (r * r * r)
	// the positive root of A·Q² + B·Q − p = 0, written so it keeps its digits when either term is tiny
	const q = (2 * p) / (B + Math.sqrt(B * B + 4 * A * p))
	return { q, v: q / ((ORIFICE_CD / ORIFICE_CV) * a) }
}

/**
 * The flow per metre of lip over a sharp edge under a head H (m: the liquid's surface above the lip), for a liquid of kinematic viscosity
 * nu (m²/s) under gravity g: the weir's q_w = C_d·⅔·√(2g)·H^{3/2} [HENDERSON] and a viscous film's q_v = g·H³/(3ν) [NUSSELT] in series
 * (1/q = 1/q_w + 1/q_v: water pours as a weir, honey as a film). Returns q (m²/s) and the speed it leaves at, q over the critical depth ⅔H.
 */
export const weirFlow = (H: number, nu: number, g: number): { q: number; v: number } => {
	if (!(H > 0) || !(g > 0)) return { q: 0, v: 0 }
	const qw = WEIR_CD * (2 / 3) * Math.sqrt(2 * g) * H * Math.sqrt(H)
	const qv = nu > 0 ? (g * H * H * H) / (3 * nu) : Number.POSITIVE_INFINITY
	const q = qv === Number.POSITIVE_INFINITY ? qw : (qw * qv) / (qw + qv)
	return { q, v: q / ((2 / 3) * H) }
}

/** The Darcy friction factor of a smooth pipe at Reynolds number Re: 64/Re laminar, Blasius above 2300 [WHITE]. */
export const pipeFriction = (Re: number): number => (Re <= 0 ? 0 : Re < 2300 ? 64 / Re : 0.3164 / Math.sqrt(Math.sqrt(Re)))

/**
 * The speed (m/s) in a full hose of diameter d and length L (m) under a head (m of the liquid) for kinematic viscosity nu: Bernoulli
 * with the entrance loss and the pipe's friction, g·head = ½v²·(1 + K_in + f·L/d) (the 1 is the jet's own speed, or the exit loss into
 * a tank: the same). Bisection (the left side grows with v). 0 for no head.
 */
export const pipeSpeed = (head: number, d: number, L: number, nu: number, g: number): number => {
	if (!(head > 0) || !(d > 0) || !(g > 0)) return 0
	let lo = 0
	let hi = Math.sqrt((2 * g * head) / (1 + ENTRANCE_K))
	const need = g * head
	for (let k = 0; k < 60; k++) {
		const v = (lo + hi) / 2
		const Re = nu > 0 ? (v * d) / nu : 1e12
		const lost = 0.5 * v * v * (1 + ENTRANCE_K + (pipeFriction(Re) * Math.max(0, L)) / d)
		if (lost < need) lo = v
		else hi = v
	}
	return (lo + hi) / 2
}

// ------------------------------------------------------------------------------------------------ the particles' kernel
/**
 * The smoothing kernels in the plane for a rest spacing s: support H = 2s; the "poly6" kernel for density and weights, the "spiky"
 * kernel's gradient for the push (Müller, Charypar & Gross, SCA 2003, in their 2D forms), and the sums a particle meets at rest in a
 * triangular (hexagonal) packing at spacing s, which define "rest": δ0 (number density, itself included), the weights' sum and second
 * moment (for the viscous Laplacian) and a wall's mirrored weight (for no-slip).
 */
export class Kernel {
	readonly s: number
	readonly H: number
	readonly H2: number
	/** poly6: W(r) = c6·(H² − r²)³ */
	readonly c6: number
	/** spiky gradient: ∇W = −cg·(H − r)²·r̂ */
	readonly cg: number
	readonly W0: number
	/** rest number density Σ W (self included), 1/m² */
	readonly delta0: number
	/** Σ f and Σ f·r² over a particle's neighbours at rest, f = W/W0 (dimensionless; m²) */
	readonly F0: number
	readonly M2: number
	/** Σ_j |∇W_ij|²/δ0² at rest: the PBF denominator's scale */
	readonly D0: number
	/** Σ f of a flat wall's mirrored packing seen by a particle touching it (its centre half a spacing from the wall) */
	readonly wallF: number
	constructor(s: number) {
		this.s = s
		this.H = 2 * s
		this.H2 = this.H * this.H
		this.c6 = 4 / (Math.PI * this.H2 * this.H2 * this.H2 * this.H2)
		this.cg = 30 / (Math.PI * this.H2 * this.H2 * this.H)
		this.W0 = this.c6 * this.H2 * this.H2 * this.H2
		let delta = this.W0
		let F = 0
		let M = 0
		let D = 0
		const row = (s * Math.sqrt(3)) / 2
		for (let j = -4; j <= 4; j++)
			for (let i = -4; i <= 4; i++) {
				if (i === 0 && j === 0) continue
				const x = i * s + ((j & 1) !== 0 ? s / 2 : 0)
				const y = j * row
				const r2 = x * x + y * y
				if (r2 >= this.H2) continue
				const w = this.W(r2)
				delta += w
				F += w / this.W0
				M += (w / this.W0) * r2
				const r = Math.sqrt(r2)
				const g = this.cg * (this.H - r) * (this.H - r)
				D += g * g
			}
		this.delta0 = delta
		this.F0 = F
		this.M2 = M
		this.D0 = D / (delta * delta)
		// a wall at distance s/2: the mirror images of the packing, rows at s, s + row, s + 2·row from the particle
		let wf = 0
		for (let j = 0; j < 4; j++)
			for (let i = -4; i <= 4; i++) {
				const x = i * s + ((j & 1) !== 0 ? s / 2 : 0)
				const y = s + j * row
				const r2 = x * x + y * y
				if (r2 < this.H2) wf += this.W(r2) / this.W0
			}
		this.wallF = wf
		this.tabulateWall()
	}
	/** A wall as a half-space of virtual particles at rest packing (Akinci et al., "Versatile rigid-fluid coupling for incompressible SPH",
	 *  ACM TOG 31(4), 2012): its rows half a spacing inside its surface and every row spacing beyond. For a particle whose centre is d from
	 *  the surface: the wall's share of its number density (Σ W) and the normal part of its gradient (Σ ∇W along the normal, negative: the
	 *  wall's density grows as the particle comes nearer), tabulated at WALL_SAMPLES distances from 0 to H and read off linearly. */
	private readonly wallD: Float64Array = new Float64Array(WALL_SAMPLES + 1)
	private readonly wallG: Float64Array = new Float64Array(WALL_SAMPLES + 1)
	private tabulateWall() {
		const s = this.s
		const row = (s * Math.sqrt(3)) / 2
		for (let k = 0; k <= WALL_SAMPLES; k++) {
			const d = (k / WALL_SAMPLES) * this.H
			let dens = 0
			let grad = 0
			for (let j = 0; j < 4; j++) {
				const y = d + s / 2 + j * row
				if (y >= this.H) break
				for (let i = -4; i <= 4; i++) {
					const x = i * s + ((j & 1) !== 0 ? s / 2 : 0)
					const r2 = x * x + y * y
					if (r2 >= this.H2) continue
					dens += this.W(r2)
					grad += this.grad(Math.sqrt(r2)) * y
				}
			}
			this.wallD[k] = dens
			this.wallG[k] = grad
		}
	}
	/** The wall's number density at a particle d from its surface (1/m²). */
	wallDensity(d: number): number {
		return this.wallTable(this.wallD, d)
	}
	/** The normal part of the wall density's gradient at a particle d from its surface (1/m³, negative). */
	wallGradient(d: number): number {
		return this.wallTable(this.wallG, d)
	}
	private wallTable(t: Float64Array, d: number): number {
		if (!(d < this.H)) return 0
		const u = (Math.max(0, d) / this.H) * WALL_SAMPLES
		const k = Math.min(WALL_SAMPLES - 1, Math.floor(u))
		const w = u - k
		return (t[k] as number) * (1 - w) + (t[k + 1] as number) * w
	}
	/** Σ f of a flat wall's mirrored packing seen by a particle whose centre is d from the wall (rows at 2d, 2d + row, ...): the weight of
	 *  the wall in the viscous no-slip term. */
	wallWeight(d: number): number {
		const s = this.s
		const row = (s * Math.sqrt(3)) / 2
		let wf = 0
		for (let j = 0; j < 4; j++) {
			const y = 2 * Math.max(0, d) + j * row
			if (y >= this.H) break
			for (let i = -4; i <= 4; i++) {
				const x = i * s + ((j & 1) !== 0 ? s / 2 : 0)
				const r2 = x * x + y * y
				if (r2 < this.H2) wf += this.W(r2) / this.W0
			}
		}
		return wf
	}
	W(r2: number): number {
		if (r2 >= this.H2) return 0
		const d = this.H2 - r2
		return this.c6 * d * d * d
	}
	/** ∇W's factor for (dx, dy): ∇W = factor·(dx, dy) (0 at r = 0 and beyond H) */
	grad(r: number): number {
		if (r >= this.H || r < 1e-12) return 0
		const d = this.H - r
		return (-this.cg * d * d) / r
	}
}

// ------------------------------------------------------------------------------------------------ solids as the particles meet them
/**
 * A solid the particles meet this step, in the world: a circle or a convex polygon (counter-clockwise) with each edge's outward normal
 * and offset; its velocity field (v at a point p = (vx − w·(py − my), vy + w·(px − mx))); and the momentum the particles gave it this step
 * (jx, jy N·s; jt N·m·s about (mx, my)), which the body gets back.
 */
export interface Collider {
	readonly key: number
	/** which item it belongs to (particles from that item's own source pass through it) */
	readonly item: number
	readonly dynamic: boolean
	circle: boolean
	cx: number
	cy: number
	r: number
	pts: number[]
	nrm: number[]
	off: number[]
	x0: number
	y0: number
	x1: number
	y1: number
	vx: number
	vy: number
	w: number
	mx: number
	my: number
	jx: number
	jy: number
	jt: number
}

/** A collider from an outline (a circle {x, y, r} or counter-clockwise points), with zero momentum taken. */
export const makeCollider = (
	key: number,
	item: number,
	dynamic: boolean,
	o: { circle?: { x: number; y: number; r: number }; points?: readonly Point[] }
): Collider => {
	const c: Collider = { key, item, dynamic, circle: false, cx: 0, cy: 0, r: 0, pts: [], nrm: [], off: [], x0: 0, y0: 0, x1: 0, y1: 0, vx: 0, vy: 0, w: 0, mx: 0, my: 0, jx: 0, jy: 0, jt: 0 }
	shapeCollider(c, o)
	return c
}

/** Sets a collider's shape (its outline now). */
export const shapeCollider = (c: Collider, o: { circle?: { x: number; y: number; r: number }; points?: readonly Point[] }) => {
	if (o.circle !== undefined) {
		c.circle = true
		c.cx = o.circle.x
		c.cy = o.circle.y
		c.r = o.circle.r
		c.x0 = c.cx - c.r
		c.x1 = c.cx + c.r
		c.y0 = c.cy - c.r
		c.y1 = c.cy + c.r
		c.mx = c.cx
		c.my = c.cy
		return
	}
	const pts = o.points ?? []
	const n = pts.length
	c.circle = false
	c.pts.length = 2 * n
	c.nrm.length = 2 * n
	c.off.length = n
	let x0 = Number.POSITIVE_INFINITY
	let x1 = Number.NEGATIVE_INFINITY
	let y0 = Number.POSITIVE_INFINITY
	let y1 = Number.NEGATIVE_INFINITY
	for (let i = 0; i < n; i++) {
		const a = pts[i] as Point
		const b = pts[(i + 1) % n] as Point
		c.pts[2 * i] = a.x
		c.pts[2 * i + 1] = a.y
		const ex = b.x - a.x
		const ey = b.y - a.y
		const len = Math.sqrt(ex * ex + ey * ey)
		const nx = len > 0 ? ey / len : 0
		const ny = len > 0 ? -ex / len : 0
		c.nrm[2 * i] = nx
		c.nrm[2 * i + 1] = ny
		c.off[i] = nx * a.x + ny * a.y
		x0 = Math.min(x0, a.x)
		x1 = Math.max(x1, a.x)
		y0 = Math.min(y0, a.y)
		y1 = Math.max(y1, a.y)
	}
	c.x0 = x0
	c.x1 = x1
	c.y0 = y0
	c.y1 = y1
	// (its middle: the outline's centroid, where the engine's velocity() of the solid is taken)
	const m = flatCentroid(c.pts)
	c.mx = m.x
	c.my = m.y
}

// ------------------------------------------------------------------------------------------------ the particles
/** The most particles a run keeps (beyond it, sources wait: a long pour onto the floor is the only way to reach it). */
export const MAX_PARTICLES = 4000
/**
 * The weight of a wall's mirror ghosts in the viscous term. An antisymmetric mirror (ghost velocity 2·v_wall − v) has no curvature at the
 * wall, which at five particles across a channel takes about half the wall's shear off the layer next to it; doubled, the flux of plane
 * Poiseuille flow between two walls 4 cm apart comes out within about 1 % (research/rw-validate-flow.ts "viscous"). A calibration of the
 * boundary at this resolution, not a property of any liquid.
 */
export const GHOST = 2
/** m/s: no particle is faster (a sane bound far above any pour, jet or fall in a scene). */
export const MAX_SPEED = 15
/** Density iterations per (sub-)step. */
export const ITERATIONS = 2
/** The artificial XSPH smoothing of the particles' velocities (Macklin & Müller 2013 use 0.01): steadies the packing, not a liquid's property. */
export const XSPH = 0.005
/** Smagorinsky's constant [LILLY] and the turbulent Schmidt number for the dye's eddy diffusion. */
export const SMAGORINSKY = 0.17
export const SCHMIDT_T = 0.7
/** A particle that has moved slower than this (m/s) for SLEEP_STEPS steps, touching something still, stops being worked (a puddle). */
export const SLEEP_SPEED = 0.01
export const SLEEP_STEPS = 120
/** m/s: an awake neighbour this fast, or a solid moving this fast at it, wakes a sleeping particle. */
export const WAKE_SPEED = 0.04

/** Distances at which the walls' share of a particle's density is tabulated (0 … H). */
const WALL_SAMPLES = 128
/** m: the cells the fixed solids are sorted into for the particles' collisions. */
const GRID = 0.05

/** What became of particles this step (for the containers and the readings): set by FlowSim.step. */
export interface ParticleHit {
	readonly index: number
	readonly collider: number
}

export class FlowSim {
	readonly K: Kernel
	readonly s: number
	/** the collision radius: half a spacing */
	readonly rc: number
	readonly liquids: FlowLiquid[]
	n = 0
	cap = 0
	nextId = 0
	x = new Float64Array(0)
	y = new Float64Array(0)
	vx = new Float64Array(0)
	vy = new Float64Array(0)
	px = new Float64Array(0)
	py = new Float64Array(0)
	vol = new Float64Array(0)
	a0 = new Float64Array(0)
	a1 = new Float64Array(0)
	a2 = new Float64Array(0)
	/** each particle's dye's scattering per cm (white food colouring, milk): 0 for a clear one */
	a3 = new Float64Array(0)
	lam = new Float64Array(0)
	dx = new Float64Array(0)
	dy = new Float64Array(0)
	tx = new Float64Array(0)
	ty = new Float64Array(0)
	tz = new Float64Array(0)
	nx = new Float64Array(0)
	ny = new Float64Array(0)
	liq = new Int32Array(0)
	lane = new Int32Array(0)
	pid = new Int32Array(0)
	src = new Int32Array(0)
	rest = new Int32Array(0)
	/** the collider (index in this step's list) a particle touched last this step, or −1 */
	hit = new Int32Array(0)
	/** steps in a row it has touched a solid */
	touch = new Int32Array(0)
	/** the collider whose surface is nearest within reach of its viscous no-slip (a spacing beyond touching), or −1, and how far its centre is */
	near = new Int32Array(0)
	nearD = new Float64Array(0)
	nearX = new Float64Array(0)
	nearY = new Float64Array(0)
	/** 1 while asleep */
	sleep = new Uint8Array(0)
	/** 1 once it has touched a solid (a stream's particles in flight meet only their own stream's: in the slice two crossing jets
	 *  would collide, in the room they pass each other at different depths) */
	landed = new Uint8Array(0)
	/** 1 once the module has counted where it came down */
	counted = new Uint8Array(0)
	dead = new Uint8Array(0)
	// neighbours (compressed rows over the predicted positions)
	private nStart = new Int32Array(1)
	private nIdx = new Int32Array(0)
	private head = new Int32Array(0)
	private next = new Int32Array(0)
	private cand = new Int32Array(0)
	private candN = new Int32Array(0)
	/** colliders of this step */
	colliders: Collider[] = []
	/** the fixed colliders by 5 cm cell (made once: setStatic), and the others (checked by their boxes) */
	private staticGrid = new Map<number, number[]>()
	private others: number[] = []
	private gridN = 0
	/** the gravity of the run, m/s² */
	g = 9.81
	constructor(s: number, liquids: FlowLiquid[]) {
		this.s = s
		this.K = new Kernel(s)
		this.rc = 0.5 * s
		this.liquids = liquids
		this.grow(64)
	}

	private grow(cap: number) {
		const f = (a: Float64Array) => {
			const b = new Float64Array(cap)
			b.set(a.subarray(0, Math.min(a.length, cap)))
			return b
		}
		const i = (a: Int32Array) => {
			const b = new Int32Array(cap)
			b.set(a.subarray(0, Math.min(a.length, cap)))
			return b
		}
		const u = (a: Uint8Array) => {
			const b = new Uint8Array(cap)
			b.set(a.subarray(0, Math.min(a.length, cap)))
			return b
		}
		this.x = f(this.x)
		this.y = f(this.y)
		this.vx = f(this.vx)
		this.vy = f(this.vy)
		this.px = f(this.px)
		this.py = f(this.py)
		this.vol = f(this.vol)
		this.a0 = f(this.a0)
		this.a1 = f(this.a1)
		this.a2 = f(this.a2)
		this.a3 = f(this.a3)
		this.lam = f(this.lam)
		this.dx = f(this.dx)
		this.dy = f(this.dy)
		this.tx = f(this.tx)
		this.ty = f(this.ty)
		this.tz = f(this.tz)
		this.nx = f(this.nx)
		this.ny = f(this.ny)
		this.liq = i(this.liq)
		this.lane = i(this.lane)
		this.pid = i(this.pid)
		this.src = i(this.src)
		this.rest = i(this.rest)
		this.hit = i(this.hit)
		this.touch = i(this.touch)
		this.near = i(this.near)
		this.nearD = f(this.nearD)
		this.nearX = f(this.nearX)
		this.nearY = f(this.nearY)
		this.sleep = u(this.sleep)
		this.landed = u(this.landed)
		this.counted = u(this.counted)
		this.dead = u(this.dead)
		this.next = new Int32Array(cap)
		this.cand = new Int32Array(cap * 6)
		this.candN = new Int32Array(cap)
		this.cap = cap
		// (the neighbour grid's chains were in the old `next`: no spot check may walk them now)
		this.gridN = 0
	}

	/** Adds a particle; false when the run already has MAX_PARTICLES. */
	add(x: number, y: number, vx: number, vy: number, vol: number, liq: number, dye: Dye, lane: number, src: number): boolean {
		if (this.n >= MAX_PARTICLES) return false
		if (this.n >= this.cap) this.grow(Math.min(MAX_PARTICLES, this.cap * 2))
		const i = this.n++
		this.x[i] = x
		this.y[i] = y
		this.px[i] = x
		this.py[i] = y
		this.vx[i] = vx
		this.vy[i] = vy
		this.vol[i] = vol
		this.a0[i] = dye[0]
		this.a1[i] = dye[1]
		this.a2[i] = dye[2]
		this.a3[i] = scatterOf(dye)
		this.liq[i] = liq
		this.lane[i] = lane
		this.pid[i] = this.nextId++
		this.src[i] = src
		this.rest[i] = 0
		this.hit[i] = -1
		this.touch[i] = 0
		this.sleep[i] = 0
		this.landed[i] = 0
		this.counted[i] = 0
		this.dead[i] = 0
		this.lam[i] = 0
		return true
	}

	/** A particle's mass, kg (its liquid's density × the volume it stands for). */
	mass(i: number): number {
		return (this.liquids[this.liq[i] as number] as FlowLiquid).density * (this.vol[i] as number)
	}

	/** Whether a spot is free for a new particle (no particle nearer than 0.6 s): the last neighbour grid, and the particles made since. */
	free(x: number, y: number): boolean {
		const lim = 0.36 * this.s * this.s
		const near = (i: number) => {
			if (this.dead[i] === 1) return false
			const ddx = (this.x[i] as number) - x
			const ddy = (this.y[i] as number) - y
			return ddx * ddx + ddy * ddy < lim
		}
		const n0 = Math.min(this.gridN, this.n)
		if (n0 > 0 && this.head.length > 0) {
			const mask = this.head.length - 1
			const cx = this.cell(x)
			const cy = this.cell(y)
			for (let oy = -1; oy <= 1; oy++)
				for (let ox = -1; ox <= 1; ox++)
					for (let j = this.head[this.hash(cx + ox, cy + oy, mask)] as number; j >= 0; j = this.next[j] as number) if (j < n0 && near(j)) return false
		}
		for (let i = n0; i < this.n; i++) if (near(i)) return false
		return true
	}

	/** Removes the dead particles, keeping the others in their order (their ids rise with it). */
	compact() {
		let k = 0
		for (let i = 0; i < this.n; i++) {
			if (this.dead[i] === 1) continue
			if (k !== i) {
				this.x[k] = this.x[i] as number
				this.y[k] = this.y[i] as number
				this.vx[k] = this.vx[i] as number
				this.vy[k] = this.vy[i] as number
				this.px[k] = this.px[i] as number
				this.py[k] = this.py[i] as number
				this.vol[k] = this.vol[i] as number
				this.a0[k] = this.a0[i] as number
				this.a1[k] = this.a1[i] as number
				this.a2[k] = this.a2[i] as number
				this.a3[k] = this.a3[i] as number
				this.liq[k] = this.liq[i] as number
				this.lane[k] = this.lane[i] as number
				this.pid[k] = this.pid[i] as number
				this.src[k] = this.src[i] as number
				this.rest[k] = this.rest[i] as number
				this.hit[k] = this.hit[i] as number
				this.touch[k] = this.touch[i] as number
				this.sleep[k] = this.sleep[i] as number
				this.landed[k] = this.landed[i] as number
				this.counted[k] = this.counted[i] as number
				this.lam[k] = this.lam[i] as number
			}
			this.dead[k] = 0
			k++
		}
		if (k !== this.n) this.gridN = 0
		this.n = k
	}

	// -------------------------------------------------------------------------------------------- neighbours
	private cell(v: number) {
		return Math.floor(v / this.K.H)
	}
	private hash(cx: number, cy: number, mask: number) {
		return (Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663)) & mask
	}
	/** The neighbour lists over the predicted positions (every particle within H of each, itself left out). */
	private neighbours() {
		const n = this.n
		let size = 64
		while (size < 2 * n) size *= 2
		if (this.head.length !== size) this.head = new Int32Array(size)
		this.head.fill(-1)
		const mask = size - 1
		for (let i = 0; i < n; i++) {
			const h = this.hash(this.cell(this.px[i] as number), this.cell(this.py[i] as number), mask)
			this.next[i] = this.head[h] as number
			this.head[h] = i
		}
		if (this.nStart.length < n + 1) this.nStart = new Int32Array(n + 1)
		let m = 0
		const H2 = this.K.H2
		for (let i = 0; i < n; i++) {
			this.nStart[i] = m
			const xi = this.px[i] as number
			const yi = this.py[i] as number
			const cx = this.cell(xi)
			const cy = this.cell(yi)
			for (let oy = -1; oy <= 1; oy++)
				for (let ox = -1; ox <= 1; ox++) {
					const ccx = cx + ox
					const ccy = cy + oy
					for (let j = this.head[this.hash(ccx, ccy, mask)] as number; j >= 0; j = this.next[j] as number) {
						if (j === i) continue
						const xj = this.px[j] as number
						const yj = this.py[j] as number
						if (this.cell(xj) !== ccx || this.cell(yj) !== ccy) continue
						if (this.landed[i] === 0 && this.landed[j] === 0 && (this.lane[i] as number) >> 3 !== (this.lane[j] as number) >> 3) continue
						const ddx = xi - xj
						const ddy = yi - yj
						if (ddx * ddx + ddy * ddy >= H2) continue
						if (m >= this.nIdx.length) {
							const b = new Int32Array(Math.max(1024, this.nIdx.length * 2))
							b.set(this.nIdx)
							this.nIdx = b
						}
						this.nIdx[m++] = j
					}
				}
		}
		this.nStart[n] = m
		this.gridN = n
	}

	// -------------------------------------------------------------------------------------------- solids
	/**
	 * Sorts the colliders into the fixed ones, bucketed once by 5 cm cells (a key per cell), and the moving ones (dynamic, or turned by a
	 * module: a pitcher), checked by their boxes every step. Call it once the colliders are made (moving[i]: whether collider i moves).
	 */
	setStatic(moving: readonly boolean[]) {
		this.staticGrid.clear()
		this.others = []
		const G = GRID
		this.colliders.forEach((C, c) => {
			if (moving[c] === true || C.dynamic) {
				this.others.push(c)
				return
			}
			const pad = this.rc + this.s
			for (let gx = Math.floor((C.x0 - pad) / G); gx <= Math.floor((C.x1 + pad) / G); gx++)
				for (let gy = Math.floor((C.y0 - pad) / G); gy <= Math.floor((C.y1 + pad) / G); gy++) {
					const key = gx * 100003 + gy
					const list = this.staticGrid.get(key)
					if (list === undefined) this.staticGrid.set(key, [c])
					else list.push(c)
				}
		})
	}

	/** Each particle's candidate colliders (up to 6) by bounding boxes around its old and predicted places. */
	private candidates() {
		// (within the kernel's reach: a wall's share of the density and its no-slip reach that far; the collisions act only within rc)
		const pad = this.K.H
		const G = GRID
		for (let i = 0; i < this.n; i++) {
			this.candN[i] = 0
			const ax = Math.min(this.x[i] as number, this.px[i] as number) - pad
			const bx = Math.max(this.x[i] as number, this.px[i] as number) + pad
			const ay = Math.min(this.y[i] as number, this.py[i] as number) - pad
			const by = Math.max(this.y[i] as number, this.py[i] as number) + pad
			const src = this.src[i] as number
			const list = this.staticGrid.get(Math.floor((this.px[i] as number) / G) * 100003 + Math.floor((this.py[i] as number) / G))
			if (list !== undefined) for (let q = 0; q < list.length; q++) this.consider(i, list[q] as number, src, ax, bx, ay, by)
			const old = this.staticGrid.get(Math.floor((this.x[i] as number) / G) * 100003 + Math.floor((this.y[i] as number) / G))
			if (old !== undefined && old !== list) for (let q = 0; q < old.length; q++) this.consider(i, old[q] as number, src, ax, bx, ay, by)
			const others = this.others
			for (let q = 0; q < others.length; q++) this.consider(i, others[q] as number, src, ax, bx, ay, by)
		}
	}
	private consider(i: number, c: number, src: number, ax: number, bx: number, ay: number, by: number) {
		const k = this.candN[i] as number
		if (k >= 6) return
		const C = this.colliders[c] as Collider
		if (C.item === src || C.x1 < ax || C.x0 > bx || C.y1 < ay || C.y0 > by) return
		for (let q = 0; q < k; q++) if (this.cand[i * 6 + q] === c) return
		this.cand[i * 6 + k] = c
		this.candN[i] = k + 1
	}

	/** Pushes particle i out of the colliders it is in (h: the sub-step, for the momentum taken). */
	private collide(i: number, h: number) {
		const k = this.candN[i] as number
		if (k === 0) return
		const rc = this.rc
		for (let q = 0; q < k; q++) {
			const C = this.colliders[this.cand[i * 6 + q] as number] as Collider
			const px = this.px[i] as number
			const py = this.py[i] as number
			let mx = 0
			let my = 0
			let depth = 0
			if (C.circle) {
				const ddx = px - C.cx
				const ddy = py - C.cy
				const d = Math.sqrt(ddx * ddx + ddy * ddy)
				const sep = d - C.r
				if (sep >= rc) continue
				const ux = d > 1e-12 ? ddx / d : 0
				const uy = d > 1e-12 ? ddy / d : 1
				depth = rc - sep
				mx = ux
				my = uy
			} else {
				const m = C.off.length
				// the separating edge: the one the particle was outside of before this step (so a thin wall is not crossed), else the
				// shallowest now
				let best = -1
				let bestOld = Number.NEGATIVE_INFINITY
				let bestNow = Number.NEGATIVE_INFINITY
				let nowEdge = -1
				const ox = this.x[i] as number
				const oy = this.y[i] as number
				for (let e = 0; e < m; e++) {
					const nx = C.nrm[2 * e] as number
					const ny = C.nrm[2 * e + 1] as number
					const now = nx * px + ny * py - (C.off[e] as number)
					if (now > bestNow) {
						bestNow = now
						nowEdge = e
					}
					const old = nx * ox + ny * oy - (C.off[e] as number)
					if (old > bestOld) {
						bestOld = old
						best = e
					}
				}
				if (bestNow >= rc) continue
				const e = bestOld >= 0 ? best : nowEdge
				const nx = C.nrm[2 * e] as number
				const ny = C.nrm[2 * e + 1] as number
				const sep = nx * px + ny * py - (C.off[e] as number)
				if (sep >= rc) continue
				depth = rc - sep
				mx = nx
				my = ny
			}
			const ddx = mx * depth
			const ddy = my * depth
			this.px[i] = px + ddx
			this.py[i] = py + ddy
			this.hit[i] = this.cand[i * 6 + q] as number
			this.landed[i] = 1
			this.nx[i] = mx
			this.ny[i] = my
			if (C.dynamic) {
				const m3 = this.mass(i)
				const jx = (m3 * ddx) / h
				const jy = (m3 * ddy) / h
				C.jx += jx
				C.jy += jy
				C.jt += (px - C.mx) * jy - (py - C.my) * jx
			}
		}
	}

	/** Each particle's nearest solid surface within the kernel's reach (its distance from the surface to the particle's centre, and the
	 *  surface's outward normal there), from its candidate colliders: the walls' share of its density and its no-slip. */
	private wallScan() {
		const H = this.K.H
		for (let i = 0; i < this.n; i++) {
			this.near[i] = -1
			this.nearD[i] = Number.POSITIVE_INFINITY
			const k = this.candN[i] as number
			if (k === 0) continue
			const px = this.px[i] as number
			const py = this.py[i] as number
			for (let q = 0; q < k; q++) {
				const c = this.cand[i * 6 + q] as number
				const C = this.colliders[c] as Collider
				let sep: number
				let nx: number
				let ny: number
				if (C.circle) {
					const ddx = px - C.cx
					const ddy = py - C.cy
					const d = Math.sqrt(ddx * ddx + ddy * ddy)
					sep = d - C.r
					nx = d > 1e-12 ? ddx / d : 0
					ny = d > 1e-12 ? ddy / d : 1
				} else {
					sep = Number.NEGATIVE_INFINITY
					nx = 0
					ny = 1
					const m = C.off.length
					for (let e = 0; e < m; e++) {
						const ex = C.nrm[2 * e] as number
						const ey = C.nrm[2 * e + 1] as number
						const d = ex * px + ey * py - (C.off[e] as number)
						if (d > sep) {
							sep = d
							nx = ex
							ny = ey
						}
					}
				}
				if (sep < 0 || sep >= H || sep >= (this.nearD[i] as number)) continue
				this.near[i] = c
				this.nearD[i] = sep
				this.nearX[i] = nx
				this.nearY[i] = ny
			}
		}
	}

	/** A collider's velocity at a point. */
	private solidVel(C: Collider, x: number, y: number): [number, number] {
		return [C.vx - C.w * (y - C.my), C.vy + C.w * (x - C.mx)]
	}

	// -------------------------------------------------------------------------------------------- one (sub-)step
	/**
	 * Advances the particles by h seconds against the colliders set in `this.colliders` (their momentum taken is added to each collider's
	 * jx, jy, jt). Gravity g down.
	 */
	step(h: number, g: number) {
		this.g = g
		const n = this.n
		if (n === 0) return
		const K = this.K
		const s = this.s
		// --- forces and the prediction
		for (let i = 0; i < n; i++) {
			this.hit[i] = -1
			this.near[i] = -1
			this.nearD[i] = Number.POSITIVE_INFINITY
			if (this.sleep[i] === 1) {
				this.px[i] = this.x[i] as number
				this.py[i] = this.y[i] as number
				continue
			}
			let vx = this.vx[i] as number
			let vy = (this.vy[i] as number) - g * h
			const sp = Math.sqrt(vx * vx + vy * vy)
			if (sp > MAX_SPEED) {
				vx *= MAX_SPEED / sp
				vy *= MAX_SPEED / sp
			}
			this.vx[i] = vx
			this.vy[i] = vy
			this.px[i] = (this.x[i] as number) + vx * h
			this.py[i] = (this.y[i] as number) + vy * h
		}
		this.neighbours()
		this.wake()
		this.candidates()
		const st = this.nStart
		const nb = this.nIdx
		const d0 = K.delta0
		// (the constraint's softness: 2× its rest stiffness. A stiffer one lets the packing's own rattle undo a third of a thick liquid's
		// viscous shear; at this one a shear wave in a block decays at ν·k² within a few per cent: research/rw-validate-flow.ts "viscous")
		const eps = 2 * K.D0
		// --- the one-sided density constraint, mass-weighted (w = ρ_ref/ρ; asleep: immovable)
		for (let it = 0; it < ITERATIONS; it++) {
			this.wallScan()
			for (let i = 0; i < n; i++) {
				const xi = this.px[i] as number
				const yi = this.py[i] as number
				let delta = K.W0
				let gx = 0
				let gy = 0
				let sum = 0
				if ((this.near[i] as number) >= 0) {
					// (a wall's virtual particles fill in what the liquid lacks beside it, up to its rest density and never beyond: a thick
					// liquid is not pulled off a wall it wets, and the wall pushes nothing: the collisions keep the liquid out of it)
					const d = this.nearD[i] as number
					delta = Math.max(delta, Math.min(d0, delta + K.wallDensity(d)))
				}
				for (let q = st[i] as number; q < (st[i + 1] as number); q++) {
					const j = nb[q] as number
					const ddx = xi - (this.px[j] as number)
					const ddy = yi - (this.py[j] as number)
					const r2 = ddx * ddx + ddy * ddy
					delta += K.W(r2)
					const f = K.grad(Math.sqrt(r2))
					const ux = (f * ddx) / d0
					const uy = (f * ddy) / d0
					gx += ux
					gy += uy
					sum += this.weight(j) * (ux * ux + uy * uy)
				}
				// (one-sided: crowded liquid is pushed apart, never pulled together, so a free surface stays smooth and a stream can break)
				const C = delta / d0 - 1
				if (C <= 0) {
					this.lam[i] = 0
					continue
				}
				sum += this.weight(i) * (gx * gx + gy * gy)
				this.lam[i] = -C / (sum + eps)
			}
			for (let i = 0; i < n; i++) {
				const wi = this.weight(i)
				if (wi === 0) {
					this.dx[i] = 0
					this.dy[i] = 0
					continue
				}
				const xi = this.px[i] as number
				const yi = this.py[i] as number
				const li = this.lam[i] as number
				let sx = 0
				let sy = 0
				for (let q = st[i] as number; q < (st[i + 1] as number); q++) {
					const j = nb[q] as number
					const lsum = li + (this.lam[j] as number)
					if (lsum === 0) continue
					const ddx = xi - (this.px[j] as number)
					const ddy = yi - (this.py[j] as number)
					const f = K.grad(Math.sqrt(ddx * ddx + ddy * ddy))
					sx += lsum * f * ddx
					sy += lsum * f * ddy
				}
				this.dx[i] = (wi * sx) / d0
				this.dy[i] = (wi * sy) / d0
			}
			for (let i = 0; i < n; i++) {
				if (this.sleep[i] === 1) continue
				this.px[i] = (this.px[i] as number) + (this.dx[i] as number)
				this.py[i] = (this.py[i] as number) + (this.dy[i] as number)
				this.collide(i, h)
			}
		}
		// --- velocities from the moves
		for (let i = 0; i < n; i++) {
			if (this.sleep[i] === 1) {
				this.vx[i] = 0
				this.vy[i] = 0
				continue
			}
			this.vx[i] = ((this.px[i] as number) - (this.x[i] as number)) / h
			this.vy[i] = ((this.py[i] as number) - (this.y[i] as number)) / h
		}
		this.viscosity(h)
		this.mixDye(h)
		for (let i = 0; i < n; i++) {
			this.x[i] = this.px[i] as number
			this.y[i] = this.py[i] as number
			this.touch[i] = (this.hit[i] as number) >= 0 ? (this.touch[i] as number) + 1 : 0
		}
		this.rest_(h)
		void s
	}

	/** The particle's inverse-mass weight in the density constraint: ρ_ref/ρ, 0 asleep. */
	private weight(i: number): number {
		if (this.sleep[i] === 1) return 0
		return 1000 / (this.liquids[this.liq[i] as number] as FlowLiquid).density
	}

	/**
	 * Viscosity: the diffusion of velocity, ∂v/∂t = ν∇²v, discretised as v_i += β_ij·Σ f_ij (v_j − v_i) with β = 4ν·h'/M2 (f_ij = W_ij/W0, M2
	 * the weights' second moment at rest: the discrete Laplacian's scale, so it is ν∇²v exactly for a smooth field), and a solid within reach
	 * as a no-slip wall (its mirrored packing's weight f_w(d) at the wall's velocity: 2β·f_w·(v_wall − v_i)). Explicit, in as many passes per
	 * step as keep it stable (h' = h/passes with β·(Σf + 2f_w) ≤ ½): one for water, about seven for honey. The momentum a moving wall's drag
	 * takes goes to its collider. Then the XSPH smoothing.
	 */
	private viscosity(h: number) {
		const n = this.n
		const K = this.K
		const st = this.nStart
		const nb = this.nIdx
		let numax = 0
		for (let i = 0; i < n; i++) if (this.sleep[i] === 0) numax = Math.max(numax, this.nu(i))
		// (a particle touching a wall meets its neighbours and as many ghosts again)
		const reach = 2 * K.F0 + 1
		const passes = Math.max(1, Math.min(24, Math.ceil((2 * 4 * numax * h * reach) / K.M2)))
		const hp = h / passes
		if ((4 * numax * h) / K.M2 > 1e-6)
			for (let ps = 0; ps < passes; ps++) {
				for (let i = 0; i < n; i++) {
					this.tx[i] = this.vx[i] as number
					this.ty[i] = this.vy[i] as number
				}
				for (let i = 0; i < n; i++) {
					if (this.sleep[i] === 1) continue
					const nui = this.nu(i)
					const xi = this.px[i] as number
					const yi = this.py[i] as number
					const vxi = this.tx[i] as number
					const vyi = this.ty[i] as number
					let dvx = 0
					let dvy = 0
					for (let q = st[i] as number; q < (st[i + 1] as number); q++) {
						const j = nb[q] as number
						const ddx = xi - (this.px[j] as number)
						const ddy = yi - (this.py[j] as number)
						const fij = K.W(ddx * ddx + ddy * ddy) / K.W0
						const b = (4 * 0.5 * (nui + this.nu(j)) * hp * fij) / K.M2
						dvx += b * ((this.tx[j] as number) - vxi)
						dvy += b * ((this.ty[j] as number) - vyi)
					}
					const c = this.near[i] as number
					if (c >= 0 && nui > 0) {
						// a wall as mirror ghosts (no-slip): this particle and each neighbour reflected across the wall's surface, moving at
						// 2·v_wall − their own velocity (Morris, Fox & Zhu, J. Comput. Phys. 136, 1997)
						const C = this.colliders[c] as Collider
						const nx = this.nearX[i] as number
						const ny = this.nearY[i] as number
						const d = this.nearD[i] as number
						const wpx = xi - d * nx
						const wpy = yi - d * ny
						const [wx, wy] = this.solidVel(C, wpx, wpy)
						let wdx = 0
						let wdy = 0
						const ghost = (xj: number, yj: number, vxj: number, vyj: number) => {
							const dj = (xj - wpx) * nx + (yj - wpy) * ny
							if (dj < 0) return
							const gx = xj - 2 * dj * nx - xi
							const gy = yj - 2 * dj * ny - yi
							const fg = K.W(gx * gx + gy * gy) / K.W0
							if (fg === 0) return
							const b = (GHOST * 4 * nui * hp * fg) / K.M2
							wdx += b * (2 * wx - vxj - vxi)
							wdy += b * (2 * wy - vyj - vyi)
						}
						ghost(xi, yi, vxi, vyi)
						for (let q = st[i] as number; q < (st[i + 1] as number); q++) {
							const j = nb[q] as number
							ghost(this.px[j] as number, this.py[j] as number, this.tx[j] as number, this.ty[j] as number)
						}
						dvx += wdx
						dvy += wdy
						if (C.dynamic) {
							// (the drag the wall gave this particle, back on the solid)
							const m3 = this.mass(i)
							C.jx += m3 * wdx
							C.jy += m3 * wdy
							C.jt += (xi - C.mx) * m3 * wdy - (yi - C.my) * m3 * wdx
						}
					}
					this.vx[i] = vxi + dvx
					this.vy[i] = vyi + dvy
				}
			}
		// XSPH (artificial, tiny): v_i += c·Σ f_ij (v_j − v_i)/F0
		for (let i = 0; i < n; i++) {
			this.tx[i] = this.vx[i] as number
			this.ty[i] = this.vy[i] as number
		}
		for (let i = 0; i < n; i++) {
			if (this.sleep[i] === 1) continue
			const xi = this.px[i] as number
			const yi = this.py[i] as number
			let sx = 0
			let sy = 0
			for (let q = st[i] as number; q < (st[i + 1] as number); q++) {
				const j = nb[q] as number
				const ddx = xi - (this.px[j] as number)
				const ddy = yi - (this.py[j] as number)
				const f = K.W(ddx * ddx + ddy * ddy) / K.W0
				sx += f * ((this.tx[j] as number) - (this.tx[i] as number))
				sy += f * ((this.ty[j] as number) - (this.ty[i] as number))
			}
			this.vx[i] = (this.tx[i] as number) + (XSPH * sx) / K.F0
			this.vy[i] = (this.ty[i] as number) + (XSPH * sy) / K.F0
		}
	}

	/** A particle's kinematic viscosity, m²/s. */
	private nu(i: number): number {
		const L = this.liquids[this.liq[i] as number] as FlowLiquid
		return L.viscosity / L.density
	}

	/**
	 * Dye: an eddy diffusivity from the flow's own shear, D_t = (C_s·s)²·|S|/Sc_t, |S| ≈ Σ f_ij|v_i − v_j|/r_ij / Σ f_ij, one implicit
	 * Jacobi sweep of the same Laplacian as the viscosity (dye mixes where the liquid churns: a pour into a cup; not in still water).
	 */
	private mixDye(h: number) {
		const n = this.n
		const K = this.K
		const st = this.nStart
		const nb = this.nIdx
		const cs2 = SMAGORINSKY * SMAGORINSKY * this.s * this.s
		// (nothing to mix when every particle carries the same dye)
		let differ = false
		for (let i = 1; i < n && !differ; i++)
			if (this.a0[i] !== this.a0[0] || this.a1[i] !== this.a1[0] || this.a2[i] !== this.a2[0] || this.a3[i] !== this.a3[0]) differ = true
		if (!differ) return
		// (a scattering dye's fourth number is mixed only when some particle has one: a run of clear dyes is worked as it always was)
		let scatters = false
		for (let i = 0; i < n && !scatters; i++) if ((this.a3[i] as number) !== 0) scatters = true
		// each particle's |S|, kept in lam (free now)
		let any = false
		for (let i = 0; i < n; i++) {
			const xi = this.px[i] as number
			const yi = this.py[i] as number
			let sf = 0
			let ss = 0
			for (let q = st[i] as number; q < (st[i + 1] as number); q++) {
				const j = nb[q] as number
				const ddx = xi - (this.px[j] as number)
				const ddy = yi - (this.py[j] as number)
				const r2 = ddx * ddx + ddy * ddy
				const f = K.W(r2) / K.W0
				const dvx = (this.vx[i] as number) - (this.vx[j] as number)
				const dvy = (this.vy[i] as number) - (this.vy[j] as number)
				sf += f
				ss += (f * Math.sqrt(dvx * dvx + dvy * dvy)) / Math.max(Math.sqrt(r2), 0.25 * this.s)
				if (
					!any &&
					((this.a0[i] as number) !== (this.a0[j] as number) ||
						(this.a1[i] as number) !== (this.a1[j] as number) ||
						(this.a2[i] as number) !== (this.a2[j] as number) ||
						(this.a3[i] as number) !== (this.a3[j] as number))
				)
					any = true
			}
			this.lam[i] = sf > 0 ? ss / sf : 0
		}
		if (!any) return
		for (let i = 0; i < n; i++) {
			this.tx[i] = this.a0[i] as number
			this.ty[i] = this.a1[i] as number
			this.tz[i] = this.a2[i] as number
		}
		const tw = scatters ? this.a3.slice(0, n) : null
		for (let i = 0; i < n; i++) {
			const xi = this.px[i] as number
			const yi = this.py[i] as number
			const Di = (cs2 * (this.lam[i] as number)) / SCHMIDT_T
			let n0 = this.tx[i] as number
			let n1 = this.ty[i] as number
			let n2 = this.tz[i] as number
			let n3 = tw !== null ? (tw[i] as number) : 0
			let den = 1
			for (let q = st[i] as number; q < (st[i + 1] as number); q++) {
				const j = nb[q] as number
				const ddx = xi - (this.px[j] as number)
				const ddy = yi - (this.py[j] as number)
				const f = K.W(ddx * ddx + ddy * ddy) / K.W0
				const Dj = (cs2 * (this.lam[j] as number)) / SCHMIDT_T
				const b = (4 * 0.5 * (Di + Dj) * h * f) / K.M2
				n0 += b * (this.tx[j] as number)
				n1 += b * (this.ty[j] as number)
				n2 += b * (this.tz[j] as number)
				if (tw !== null) n3 += b * (tw[j] as number)
				den += b
			}
			this.a0[i] = n0 / den
			this.a1[i] = n1 / den
			this.a2[i] = n2 / den
			if (tw !== null) this.a3[i] = n3 / den
		}
	}

	/** Sleep: a particle slow for SLEEP_STEPS steps while touching a still solid or a sleeping particle stops being worked. */
	private rest_(h: number) {
		void h
		const n = this.n
		const st = this.nStart
		const nb = this.nIdx
		for (let i = 0; i < n; i++) {
			if (this.sleep[i] === 1) continue
			const vx = this.vx[i] as number
			const vy = this.vy[i] as number
			if (vx * vx + vy * vy >= SLEEP_SPEED * SLEEP_SPEED) {
				this.rest[i] = 0
				continue
			}
			let held = false
			const c = this.hit[i] as number
			if (c >= 0) {
				const C = this.colliders[c] as Collider
				if (!C.dynamic && C.vx === 0 && C.vy === 0 && C.w === 0) held = true
			}
			if (!held)
				for (let q = st[i] as number; q < (st[i + 1] as number); q++)
					if (this.sleep[nb[q] as number] === 1) {
						held = true
						break
					}
			if (!held) {
				this.rest[i] = 0
				continue
			}
			this.rest[i] = (this.rest[i] as number) + 1
			if ((this.rest[i] as number) >= SLEEP_STEPS) {
				this.sleep[i] = 1
				this.vx[i] = 0
				this.vy[i] = 0
			}
		}
	}

	/** Wakes sleeping particles near a moving one or in a moving solid's reach (after the neighbour lists are made). */
	private wake() {
		const n = this.n
		const st = this.nStart
		const nb = this.nIdx
		let changed = true
		let rounds = 0
		while (changed && rounds < 4) {
			changed = false
			rounds++
			for (let i = 0; i < n; i++) {
				if (this.sleep[i] === 0) continue
				let up = false
				for (let q = st[i] as number; q < (st[i + 1] as number) && !up; q++) {
					const j = nb[q] as number
					if (this.sleep[j] === 1) continue
					const vx = this.vx[j] as number
					const vy = this.vy[j] as number
					if (vx * vx + vy * vy > WAKE_SPEED * WAKE_SPEED) up = true
				}
				if (!up) {
					const xi = this.x[i] as number
					const yi = this.y[i] as number
					const pad = this.s
					for (const C of this.colliders) {
						if (C.x1 < xi - pad || C.x0 > xi + pad || C.y1 < yi - pad || C.y0 > yi + pad) continue
						if (C.dynamic || C.vx !== 0 || C.vy !== 0 || C.w !== 0) {
							const [wx, wy] = this.solidVel(C, xi, yi)
							if (C.dynamic || wx * wx + wy * wy > 1e-8) {
								up = true
								break
							}
						}
					}
				}
				if (up) {
					this.sleep[i] = 0
					this.rest[i] = 0
					this.px[i] = this.x[i] as number
					this.py[i] = this.y[i] as number
					changed = true
				}
			}
		}
	}

	/** Total volume of the live particles, m³. */
	volume(): number {
		let v = 0
		for (let i = 0; i < this.n; i++) if (this.dead[i] === 0) v += this.vol[i] as number
		return v
	}
	/** The fastest live particle's speed, m/s. */
	fastest(): number {
		let m = 0
		for (let i = 0; i < this.n; i++) {
			if (this.sleep[i] === 1) continue
			const vx = this.vx[i] as number
			const vy = this.vy[i] as number
			m = Math.max(m, vx * vx + vy * vy)
		}
		return Math.sqrt(m)
	}
}

// ------------------------------------------------------------------------------------------------ sources of particles
/**
 * A stream leaving an opening: it carries a flow Q (m³/s) out at speed v along a direction, as rows of particles across the stream's
 * thickness in the plane (one row per spacing travelled; the row takes all the volume owed since the last one, so every m³ that left
 * the source is in some particle). A row waits while the spot is taken (a stream into a crowd).
 */
export class Emitter {
	owed = 0
	travel = 0
	readonly lane: number
	constructor(lane: number) {
		this.lane = lane
	}
	/**
	 * dt seconds of flow: q m³/s at speed v (m/s) along (ux, uy) (unit) from (x, y), `thick` m across, liquid liq with dye, from item
	 * src (its particles pass its own solids), plus the opening's own velocity (bx, by). Returns the volume put into particles.
	 */
	run(sim: FlowSim, dt: number, x: number, y: number, ux: number, uy: number, v: number, q: number, thick: number, liq: number, dye: Dye, src: number, bx = 0, by = 0): number {
		if (q > 0) this.owed += q * dt
		if (!(this.owed > 0)) return 0
		// (a stream thinner than a particle goes single file, a row every two spacings: half the particles for a thin jet, which is
		// drawn as one continuous stream all the same)
		const s = thick < sim.s ? 2 * sim.s : sim.s
		this.travel += Math.max(v, 0.05) * dt
		if (this.travel < s) return 0
		const rows = Math.min(4, Math.floor(this.travel / s))
		const across = Math.max(1, Math.min(8, Math.round(thick / sim.s)))
		const each = this.owed / (rows * across)
		let put = 0
		let made = 0
		for (let r = 0; r < rows; r++) {
			const ahead = this.travel - (r + 1) * s
			const cx = x + ux * Math.max(0, ahead)
			const cy = y + uy * Math.max(0, ahead)
			let room = true
			for (let k = 0; k < across && room; k++) {
				const off = (k - (across - 1) / 2) * sim.s
				if (!sim.free(cx - uy * off, cy + ux * off)) room = false
			}
			if (!room) break
			let any = false
			for (let k = 0; k < across; k++) {
				const off = (k - (across - 1) / 2) * sim.s
				if (sim.add(cx - uy * off, cy + ux * off, ux * v + bx, uy * v + by, each, liq, dye, this.lane * 8 + Math.min(7, k), src)) {
					put += each
					any = true
				}
			}
			if (!any) break
			made++
		}
		if (made > 0) {
			this.owed -= put
			if (this.owed < 1e-15) this.owed = 0
			this.travel -= made * s
			if (this.travel < 0) this.travel = 0
		} else this.travel = s
		return put
	}
}

// ------------------------------------------------------------------------------------------------ basins: still liquid in a container
/** A layer of a basin: its liquid, volume (m³) and dye. */
export interface BasinLayer {
	liq: number
	vol: number
	/** its dye (three absorbances; a fourth number, its scattering, only once a scattering dye has been poured into it) */
	a: [number, number, number] | [number, number, number, number]
}

/** The area of a convex polygon (flat x, y list, counter-clockwise) below the line y = Y, without making a new polygon. */
export const areaBelow = (p: readonly number[], Y: number): number => {
	const n = p.length / 2
	let a = 0
	let fx = 0
	let fy = 0
	let lx = 0
	let ly = 0
	let first = true
	const put = (x: number, y: number) => {
		if (first) {
			fx = x
			fy = y
			first = false
		} else a += lx * y - x * ly
		lx = x
		ly = y
	}
	for (let i = 0; i < n; i++) {
		const ax = p[2 * i] as number
		const ay = p[2 * i + 1] as number
		const j = (i + 1) % n
		const bx = p[2 * j] as number
		const by = p[2 * j + 1] as number
		const ain = ay <= Y
		const bin = by <= Y
		if (ain) put(ax, ay)
		if (ain !== bin) {
			const u = (Y - ay) / (by - ay)
			put(ax + u * (bx - ax), Y)
		}
	}
	if (first) return 0
	a += lx * fy - fx * ly
	return a / 2
}

/** The part of a convex polygon (flat list) below y = Y, as a flat list (for drawing and for its centroid). */
export const clipBelowFlat = (p: readonly number[], Y: number): number[] => {
	const out: number[] = []
	const n = p.length / 2
	for (let i = 0; i < n; i++) {
		const ax = p[2 * i] as number
		const ay = p[2 * i + 1] as number
		const j = (i + 1) % n
		const bx = p[2 * j] as number
		const by = p[2 * j + 1] as number
		const ain = ay <= Y
		const bin = by <= Y
		if (ain) out.push(ax, ay)
		if (ain !== bin) {
			const u = (Y - ay) / (by - ay)
			out.push(ax + u * (bx - ax), Y)
		}
	}
	return out
}

/** Area and centroid of a flat polygon list. */
export const flatCentroid = (p: readonly number[]): { area: number; x: number; y: number } => {
	const n = p.length / 2
	if (n < 3) return { area: 0, x: p[0] ?? 0, y: p[1] ?? 0 }
	const ox = p[0] as number
	const oy = p[1] as number
	let a = 0
	let cx = 0
	let cy = 0
	for (let i = 1; i < n - 1; i++) {
		const ax = (p[2 * i] as number) - ox
		const ay = (p[2 * i + 1] as number) - oy
		const bx = (p[2 * i + 2] as number) - ox
		const by = (p[2 * i + 3] as number) - oy
		const c = ax * by - bx * ay
		a += c
		cx += c * (ax + bx)
		cy += c * (ay + by)
	}
	if (a === 0) return { area: 0, x: ox, y: oy }
	return { area: a / 2, x: ox + cx / (3 * a), y: oy + cy / (3 * a) }
}

/** Bisections for a level: 2⁻³⁶ of the search span (a few nanometres in a 30 cm container). */
const LEVEL_STEPS = 36

/**
 * Still liquid standing in a container: its inside (a convex outline in the container's own frame: bottom-left, bottom-right, top-right,
 * top-left, counter-clockwise; the two top corners are its rim), how deep it is front to back (m: horizontal area = width × depth; π/4 ×
 * the width for a round one) and its layers, bottom first. `place(pose)` works out, in the world, the inside's outline and each layer's
 * top (horizontal, whatever the tilt); more than fits under the rim stands over it (a pour's head over the lip).
 */
export class Basin {
	readonly local: readonly Point[]
	readonly depth: number
	layers: BasinLayer[] = []
	/** world, after place(): the inside, each layer's top, the lowest point, the rim's two corners */
	world: number[] = []
	tops: number[] = []
	bottom = 0
	rimA: Point = { x: 0, y: 0 }
	rimB: Point = { x: 0, y: 0 }
	private kx = Number.NaN
	private ky = Number.NaN
	private ka = Number.NaN
	private kv: number[] = []
	private kc = 1
	private ks = 0
	constructor(local: readonly Point[], depth: number) {
		this.local = local
		this.depth = depth
	}
	/** Inner width at its middle height (m). */
	width(): number {
		const [bl, br, tr, tl] = this.local as [Point, Point, Point, Point]
		return ((br.x - bl.x) + (tr.x - tl.x)) / 2
	}
	/** m³ it holds under the rim (upright). */
	capacity(): number {
		const [bl, br, tr, tl] = this.local as [Point, Point, Point, Point]
		const flat = [bl.x, bl.y, br.x, br.y, tr.x, tr.y, tl.x, tl.y]
		return Math.abs(flatCentroid(flat).area) * this.depth
	}
	volume(): number {
		let v = 0
		for (const l of this.layers) v += l.vol
		return v
	}
	/**
	 * Works out the world outline and each layer's top for the container at pose (its frame's origin and angle): the height where the
	 * inside's part below it holds the layers' volume (bisection). More than the whole inside holds (a container tipped far over, or
	 * filled faster than it pours) stands over its highest point, spread over the rim's width: the head that drives the pour.
	 */
	place(pose: { x: number; y: number; angle: number }) {
		let same = pose.x === this.kx && pose.y === this.ky && pose.angle === this.ka && this.kv.length === this.layers.length
		for (let i = 0; same && i < this.layers.length; i++) if ((this.layers[i] as BasinLayer).vol !== this.kv[i]) same = false
		if (same) return
		this.kx = pose.x
		this.ky = pose.y
		if (pose.angle !== this.ka) {
			this.kc = Math.cos(pose.angle)
			this.ks = Math.sin(pose.angle)
		}
		this.ka = pose.angle
		this.kv = this.layers.map((l) => l.vol)
		const c = this.kc
		const s = this.ks
		const w = (p: Point) => [pose.x + p.x * c - p.y * s, pose.y + p.x * s + p.y * c] as const
		this.world = this.local.flatMap((p) => [...w(p)])
		const [ax, ay] = w(this.local[2] as Point)
		const [bx, by] = w(this.local[3] as Point)
		this.rimA = { x: ax, y: ay }
		this.rimB = { x: bx, y: by }
		let lo = Number.POSITIVE_INFINITY
		let hi = Number.NEGATIVE_INFINITY
		for (let i = 1; i < this.world.length; i += 2) {
			lo = Math.min(lo, this.world[i] as number)
			hi = Math.max(hi, this.world[i] as number)
		}
		this.bottom = lo
		const full = areaBelow(this.world, hi)
		const over = Math.max(0.01, Math.abs(ax - bx))
		const tops: number[] = []
		let below = 0
		let lastTop = lo
		for (const l of this.layers) {
			below += l.vol
			if (!(below > 0)) {
				tops.push(lastTop)
				continue
			}
			const want = below / this.depth
			if (want >= full) {
				lastTop = hi + (want - full) / over
				tops.push(lastTop)
				continue
			}
			let a = Math.min(lastTop, hi)
			let b = hi
			for (let k = 0; k < LEVEL_STEPS; k++) {
				const m = (a + b) / 2
				if (areaBelow(this.world, m) < want) a = m
				else b = m
			}
			lastTop = (a + b) / 2
			tops.push(lastTop)
		}
		this.tops = tops
	}
	/** The surface's height (world y) after place(), or the bottom when empty. */
	top(): number {
		return this.tops.length > 0 ? (this.tops[this.tops.length - 1] as number) : this.bottom
	}
	/** Whether a world point is inside the container's inside (under its rim line). */
	inside(x: number, y: number): boolean {
		const p = this.world
		const n = p.length / 2
		for (let i = 0; i < n; i++) {
			const ax = p[2 * i] as number
			const ay = p[2 * i + 1] as number
			const j = (i + 1) % n
			const bx = p[2 * j] as number
			const by = p[2 * j + 1] as number
			if ((bx - ax) * (y - ay) - (by - ay) * (x - ax) < 0) return false
		}
		return n > 2
	}
	/** The layer at a world height (the one whose top is the first above it), or −1 above the surface. */
	layerAt(y: number): number {
		for (let i = 0; i < this.tops.length; i++) if (y <= (this.tops[i] as number) && (this.layers[i] as BasinLayer).vol > 0) return i
		return -1
	}
	/** The hydrostatic pressure at a world height (Pa), each layer's ρ·g·(its thickness above y). */
	pressure(y: number, liquids: readonly FlowLiquid[], g: number): number {
		let p = 0
		let floor = this.bottom
		for (let i = 0; i < this.tops.length; i++) {
			const top = this.tops[i] as number
			const l = this.layers[i] as BasinLayer
			const from = Math.max(floor, y)
			if (top > from) p += (liquids[l.liq] as FlowLiquid).density * g * (top - from)
			floor = top
		}
		return p
	}
	/** Adds liquid: to its own layer (same words), else as a new layer put where its density belongs; dye mixed by volume. */
	add(vol: number, liq: number, dye: Dye, liquids: readonly FlowLiquid[]) {
		if (!(vol > 0)) return
		const L = liquids[liq] as FlowLiquid
		let layer = this.layers.find((l) => (liquids[l.liq] as FlowLiquid).words === L.words)
		if (layer === undefined) {
			layer = { liq, vol: 0, a: [0, 0, 0] }
			let at = this.layers.length
			for (let i = 0; i < this.layers.length; i++)
				if (L.density > (liquids[(this.layers[i] as BasinLayer).liq] as FlowLiquid).density) {
					at = i
					break
				}
			this.layers.splice(at, 0, layer)
		}
		const t = layer.vol + vol
		const s0 = scatterOf(layer.a)
		const s1 = scatterOf(dye)
		const a: [number, number, number] = [(layer.a[0] * layer.vol + dye[0] * vol) / t, (layer.a[1] * layer.vol + dye[1] * vol) / t, (layer.a[2] * layer.vol + dye[2] * vol) / t]
		layer.a = s0 !== 0 || s1 !== 0 ? [a[0], a[1], a[2], (s0 * layer.vol + s1 * vol) / t] : a
		layer.vol = t
	}
	/** Takes up to vol m³ from layer i; returns what it took. */
	take(i: number, vol: number): number {
		const l = this.layers[i]
		if (l === undefined || !(vol > 0)) return 0
		const got = Math.min(l.vol, vol)
		l.vol -= got
		if (l.vol < 1e-15) l.vol = 0
		return got
	}
	/** Drops empty layers. */
	tidy() {
		if (this.layers.some((l) => !(l.vol > 0))) this.layers = this.layers.filter((l) => l.vol > 0)
	}
}

/** The transmitted colour (0…1 per channel) of a dye seen through `path` cm of the liquid: exp(−a·path). */
export const tintOf = (a: Dye, path = 5): [number, number, number] => [Math.exp(-a[0] * path), Math.exp(-a[1] * path), Math.exp(-a[2] * path)]

/**
 * What one sees of `path` cm of a liquid (0…1 per channel) and how much of it the liquid scattered back (ρ): the light straight through,
 * e^(−(a + s)·path) (a its absorbances, s its scattering per cm: the dye's fourth number), and the share ρ = 1 − e^(−s·path) scattered on
 * the way, seen as a deep layer's diffuse reflectance (Kubelka-Munk: R∞ = 1 + K/S − √((K/S)² + 2K/S), K = 2a, S = s [KUBELKA31]). A clear
 * liquid (s = 0) is exactly tintOf's e^(−a·path), ρ 0; milk (s about 25 per cm) is its white R∞, ρ 1. Returns [r, g, b, ρ].
 */
export const seenOf = (a: Dye, path = 5): [number, number, number, number] => {
	const s = scatterOf(a)
	if (!(s > 0)) {
		const t = tintOf(a, path)
		return [t[0], t[1], t[2], 0]
	}
	const rho = 1 - Math.exp(-s * path)
	const ch = (k: number) => {
		const x = (2 * Math.max(0, k)) / s
		const rInf = 1 + x - Math.sqrt(x * x + 2 * x)
		return Math.min(1, Math.exp(-(k + s) * path) + rho * rInf)
	}
	return [ch(a[0] as number), ch(a[1] as number), ch(a[2] as number), rho]
}
