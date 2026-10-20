import { type Body, type Contact as Touch, Joint as PlanckJoint, PrismaticJoint, type TimeStep, Vec2 } from "planck"
import type { EngineInternals, ProcessContext, ProcessRecord, SolidHandle } from "#sim/plugins.ts"

/**
 * The softbody module's engine physics (engine4 module "softbody"; its process kind is tooling/src/sim/modules/softbody.ts): things that
 * change shape. Everything here acts only for a document's `softbody` process records (machines/mod_softbody.py builds them); without one,
 * nothing in this file runs.
 *
 * Records ({kind: "softbody", id, item, role, ...}; lengths m, forces N, angles rad, points in a solid's own frame unless said):
 *   ball   {solid, law, R, gauge?, wall?, E?, nu?, flow?, kc?, e, hard}
 *          A round body whose contacts are SOFT: planck's rigid contact is left out while the squash is under `hard` (m), and this file
 *          pushes instead with the force the squashed material gives (`law`):
 *            "pressure"  an inflated ball (a playground ball, a basketball, an exercise ball): F = (p − p_atm)·A + k_w·δ, A = π(2Rδ − δ²)
 *                        the flat's area (the gas pushes on the flattened patch; Cross, "The bounce of a ball", Am. J. Phys. 67, 222 (1999)),
 *                        p the gas's pressure, `gauge` over the air's at the start and rising as the flattened cap's volume πδ²(R − δ/3) is
 *                        squeezed out of the ball's 4/3·πR³ (adiabatic, γ 1.4: a squash lasts milliseconds), k_w the wall's own stiffness
 *                        (`wall`, N/m): a soft ball dropped hard stiffens smoothly as it flattens instead of bottoming out;
 *            "hertz"     a solid elastic ball (foam, soft rubber): F = (4/3)·E*·√R·δ^1.5, E* = E/(1 − ν²) (Hertz; Johnson, Contact
 *                        Mechanics, 1985, §4.2), against a rigid surface;
 *            "clay"      modelling clay: elastic at first (`kc`, N/m: 50 × its flow resistance: it springs back about 2 % of a dent), then it FLOWS at the pressure `flow` (Pa) over
 *                        the flat (F_y = p·π(2Rδ − δ²): the engine's dent law for clay balls, Tabor's p = 3·σ_y), and the flattening it flowed
 *                        stays: a permanent FLAT in that direction (up to 8; flats within 25° merge), on every hit and under a resting weight.
 *                        A resting contact is kept within CLAY_SKIN of touching (its stiff spring then holds a weight steadily, never on one
 *                        step and off the next).
 *          Damping c = 2ζ√(k·m) gives the material's coefficient of restitution `e` (ζ = −ln e / √(π² + ln² e), a linear contact's).
 *          Friction stops the contact point sliding within each step, held within μ·N (the pair's friction from the document's contacts).
 *          Readings: squash_mm (the deepest flattening now, elastic + permanent), force_n (the contact force), energy_j (elastic energy
 *          stored), and for clay dent_mm (the deepest permanent flat). Series "shape" [angle, depth, ...] in the ball's own frame per frame:
 *          its flats and its contacts' flattening (the 3D view flattens the sphere there).
 *   beam   {solids, joints: [{a, b, k, c, my, mu}], clamp?, base?, axis?, tip, ductile}
 *          A bending beam (a ruler, a plank, a diving board, a card bridge) made of rigid segments joined by the document's pins. Each joint
 *          gets a bending spring k = E·I/ℓ (2·E·I/ℓ at a clamp: the rigid-segment method, whose tip deflection under an end load is
 *          F·L³/(3EI)·(1 + 1/(2N²)) for N segments) and a damper c (Rayleigh: the material's damping ratio at the beam's first mode). It is solved
 *          inside planck's step, all of a beam's pins and bends at once (`BeamChain`: an exact block-tridiagonal solve in each velocity pass):
 *          the Hooke torque explicitly where the step can follow it, and the share θ a light, stiff joint needs implicitly (θ = 1 − 2/a,
 *          a = h²·k·(1/I_A + 1/I_B)·2, as physics.ts's springs): steady at any stiffness; that share damps the beam's ringing a little.
 *          A joint whose bending moment passes `my` (N·m, the moment that first yields a ductile beam, σ_y·b·t²/6: steel, aluminium, card) keeps a permanent bend;
 *          past `mu` (a brittle one: wood, acrylic) it snaps (its spring lets go; the event says so).
 *          Readings: bend_mm (a clamped beam: how far its tip is from the clamp's straight line, + below; a free one: how far its middle sags
 *          below the line through its ends), energy_j (the bending energy), set_deg (the most permanent bend at a joint), broken (1 once it has
 *          snapped or creased 10° or more: the fracture module's `breaks` goal reads it).
 *   band   {pad, anchor (world), spread, l0, area, E, n, resilience, lock, snap?}
 *          A rubber-band launcher: n strands each side run from two posts `spread` apart (front and back) to the pad (the pouch), seen end-on:
 *          each strand is √(r² + (spread/2)²) long, r the pad's distance from the posts' line. Rubber: F = A0·(E/3)·(λ − 1/λ²) per strand
 *          (neo-Hookean, uniaxial; Treloar, The Physics of Rubber Elasticity, 3rd ed., 1975), stiffening toward the chains' full stretch (Gent,
 *          Rubber Chem. Technol. 69, 59 (1996), J_m = `lock`); slack when shorter than l0. Shortening, it gives back `resilience` of the force
 *          (natural rubber's rebound resilience, about 0.8). The pad never turns (its strands hold it square), and at the start it closes up to
 *          a moving thing within 1 cm in front of it (the thing sits in the pouch). Stretched to `snap` × its length (rubber's breaking
 *          stretch) the band SNAPS: an event "…'s rubber band snapped" (kind snap), and it pulls nothing from then on. The band's pull is
 *          followed through each step in pieces (ω·h/N ≤ 0.05) and the pouch is given the step's mean speed (it lands where the pieces put it),
 *          the end speed kept for the next step: steady however stiff the bands are against the 2 g pouch. Readings: stretch_cm, tension_n
 *          (the pull on the pad), energy_j, broken (1 once it has snapped).
 *   motor  {item, wheel, chassis, front?, turns, r, l0, area, E, n, resilience, lock, sense}
 *          A rubber band wound on a car's rear axle (a rubber-band car): `turns` turns of radius r stretch it by turns·2π·r; it turns the wheel
 *          with T·r (and the body the other way) while it unwinds, and hangs slack once unwound. The tyres grip only μ·N·r_wheel (N the drive
 *          wheel's share of the car's weight, by its axles' places about the car's centre of mass): a band that pulls harder spins the wheels,
 *          and the turns above what they hold unwind for nothing at once (an event, kind spin), so more turns never take a car less far.
 *          Readings: band_turns, band_stretch_cm, band_tension_n, band_energy_j.
 *   spring {a, b, anchorA, anchorB, rest, k, tare?}
 *          Readings of a coil spring the document's own spring joint moves: compression_mm (+ shorter than rest, less `tare`: the squash of its
 *          own platform resting on it, so the reading is zero with nothing on it, as a lab zeroes its scale), force_n (k × that), energy_j
 *          (½·k·x² of it).
 *   guide  {solid, axis (world, unit)}
 *          A straight slide: the solid only moves along the axis, never turns (planck's prismatic joint to the ground): a coil spring's platform.
 *
 * Determinism: only + − × ÷, Math.sqrt/abs/min/max/floor/round and the engine's Math.sin/cos/atan2/exp/hypot/pow (tools/fdlibm.ts,
 * tools/crpow.ts); records are handled in document order, contacts in planck's list order: the same every run, in node and in a browser.
 */

/** physics.ts's LENGTH_SCALE: planck units per metre (EngineInternals.lengthScale says it; checked at the start). */
const LENGTH_SCALE = 10
/** m/s: a clay contact closing faster than this is a hit (its energy spent on the flow at once), slower a resting load (its weight held). */
const CLAY_IMPACT = 0.05
/** m: a launcher's pouch closes up to what sits in front of it this near (the thing sits in the pouch), leaving this much between them. */
const SEAT_REACH = 0.01
const SEAT_GAP = 0.0005
/** Pa: the air outside an inflated ball (the standard atmosphere, ISO 2533), and air's adiabatic index (a bounce's squash lasts a few
 *  milliseconds: the gas has no time to exchange heat with the skin). */
const P_ATM = 101325
const GAMMA = 1.4
/** m: a resting clay contact is kept while its gap is within this: its very stiff spring then holds a weight steadily (the step closes the gap
 *  only as far as the load needs) instead of pushing it off one step and dropping it the next. */
const CLAY_SKIN = 0.0005

type V = { readonly x: number; readonly y: number }

const solving = (body: Body) => body as unknown as { c_velocity: { v: Vec2; w: number }; c_position: { c: Vec2; a: number }; m_invMass: number; m_invI: number }

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback)
const str = (v: unknown) => (typeof v === "string" ? v : undefined)
const pt = (v: unknown): V | undefined => {
	const o = v as { x?: unknown; y?: unknown } | undefined
	return o !== undefined && o !== null && typeof o.x === "number" && typeof o.y === "number" ? { x: o.x, y: o.y } : undefined
}
/** An angle brought within (−π, π]. */
const wrap = (a: number) => {
	let x = a
	while (x > Math.PI) x -= 2 * Math.PI
	while (x <= -Math.PI) x += 2 * Math.PI
	return x
}

// ------------------------------------------------------------------------------------------------------------------------------ laws
/** The damping ratio of a linear contact that leaves at e times its approach speed: ζ = −ln e / √(π² + ln² e) (ln e from the engine's atan2-free series). */
export const dampingRatio = (e: number) => {
	const r = Math.min(0.999, Math.max(0.001, e))
	// ln r by Newton on exp (the engine's own exp: the same bits everywhere)
	let y = r - 1
	for (let k = 0; k < 40; k++) y -= 1 - r / Math.exp(y)
	return -y / Math.sqrt(Math.PI * Math.PI + y * y)
}

export interface BallLaw {
	readonly law: "pressure" | "hertz" | "clay"
	readonly R: number
	readonly gauge: number
	readonly wall: number
	readonly Estar: number
	readonly flow: number
	/** Clay's elastic stiffness, N/m (CLAY_STIFF, 50 × its flow resistance 2π·R·p: it springs back about 2 % of a dent). */
	readonly kc: number
	readonly e: number
	readonly hard: number
}

/** The flat's area of a sphere of radius R flattened by δ: π·a², a² = 2Rδ − δ² (0 past the middle's never reached: δ ≤ R). */
export const flatArea = (R: number, d: number) => {
	const x = Math.min(R, Math.max(0, d))
	return Math.PI * (2 * R * x - x * x)
}

/**
 * An inflated ball's gas, the ball flattened by δ: the flat's area A = π(2Rδ − δ²); the cap πδ²(R − δ/3) squeezed out of its volume
 * V0 = 4/3·πR³ (the skin is thin: its outer size is used), the gas compressed adiabatically, p = (p_atm + gauge)·(V0/V)^γ. -> its push
 * (p − p_atm)·A (N), its slope dF/dδ = γ·p·A²/V + (p − p_atm)·π(2R − 2δ) (N/m), and the work the squash took, ∫F dδ
 * = (p_atm + gauge)·V0/(γ − 1)·((V0/V)^(γ−1) − 1) − p_atm·cap (J). For a small squash: gauge·A, gauge·2πR and gauge·cap, Cross's law.
 */
export const gasSquash = (R: number, gauge: number, d: number) => {
	const x = Math.min(R, Math.max(0, d))
	const A = Math.PI * (2 * R * x - x * x)
	const V0 = (4 / 3) * Math.PI * R * R * R
	const cap = Math.PI * x * x * (R - x / 3)
	const V = V0 - cap
	const p1 = P_ATM + gauge
	const ratio = V0 / V
	const p = p1 * ratio ** GAMMA
	const F = (p - P_ATM) * A
	const k = (GAMMA * p * A * A) / V + (p - P_ATM) * Math.PI * (2 * R - 2 * x)
	const E = ((p1 * V0) / (GAMMA - 1)) * (ratio ** (GAMMA - 1) - 1) - P_ATM * cap
	return { F, k, E }
}

/** An elastic ball's contact force (N) and its slope (N/m) at a squash δ (m). */
export const elasticForce = (L: BallLaw, d: number): { F: number; k: number } => {
	const x = Math.max(0, d)
	if (L.law === "pressure") {
		const gas = gasSquash(L.R, L.gauge, x)
		return { F: gas.F + L.wall * x, k: Math.max(gas.k + L.wall, L.wall, 1e-6) }
	}
	// Hertz (clay's elastic part uses its own law in `clayForce`)
	const s = Math.sqrt(L.R)
	const F = (4 / 3) * L.Estar * s * x * Math.sqrt(x)
	const k = 2 * L.Estar * s * Math.sqrt(Math.max(x, 1e-6 * L.R))
	return { F, k }
}

/** The elastic energy (J) an elastic ball holds squashed by δ: ∫F dδ. */
export const elasticEnergy = (L: BallLaw, d: number) => {
	const x = Math.max(0, Math.min(L.R, d))
	if (L.law === "pressure") return gasSquash(L.R, L.gauge, x).E + 0.5 * L.wall * x * x
	if (L.law === "hertz") return (8 / 15) * L.Estar * Math.sqrt(L.R) * x * x * Math.sqrt(x)
	return 0
}

/**
 * Clay: the force at a total flattening δ (from the round ball) of which δp has already flowed (a permanent flat), and the new permanent
 * depth: elastic F = k_c·(δ − δp) (k_c far stiffer than the flow: plasticine is nearly rigid-plastic), up to the flow force p·π(2Rδ − δ²);
 * past it the clay flows (δp grows so the elastic part carries exactly the flow force).
 */
export const clayForce = (L: BallLaw, d: number, dp: number): { F: number; k: number; dp: number } => {
	const x = Math.max(0, d)
	const k = L.kc
	const elastic = Math.max(0, x - dp)
	const Fy = L.flow * flatArea(L.R, x)
	if (k * elastic <= Fy) return { F: k * elastic, k, dp }
	return { F: Fy, k, dp: Math.max(dp, Math.min(0.85 * L.R, x - Fy / k)) }
}

// ------------------------------------------------------------------------------------------------------------------------------ geometry
export interface Flat {
	/** The flat's outward normal in the ball's own frame, rad. */
	a: number
	/** How deep it is, m. */
	d: number
}

/** The half-angle (rad) a flat of depth d spans on a circle of radius R: cos α = (R − d)/R. */
const halfAngle = (R: number, d: number) => Math.atan2(Math.sqrt(Math.max(0, R * R - (R - d) * (R - d))), R - d)

/** How far the dented ball reaches from its centre in the direction `a` (its own frame): R, or less where a flat cuts it. */
export const reach = (R: number, flats: readonly Flat[], a: number) => {
	let h = R
	for (const f of flats) {
		const off = Math.abs(wrap(a - f.a))
		const al = halfAngle(R, f.d)
		if (off < al) h = Math.min(h, R * Math.cos(al - off))
	}
	return h
}

/** Adds (or deepens) a permanent flat at `a` (own frame), merging flats within 25°; at most 8 (the shallowest merged into its nearest). */
export const addFlat = (flats: Flat[], a: number, d: number) => {
	const MERGE = (25 * Math.PI) / 180
	for (const f of flats) {
		if (Math.abs(wrap(a - f.a)) < MERGE) {
			if (d > f.d) {
				// (the deeper one's direction, a little toward the other)
				const w = f.d / (f.d + d)
				f.a = wrap(a + w * wrap(f.a - a))
				f.d = d
			}
			return
		}
	}
	flats.push({ a: wrap(a), d })
	if (flats.length > 8) {
		let s = 0
		for (let i = 1; i < flats.length; i++) if ((flats[i] as Flat).d < (flats[s] as Flat).d) s = i
		flats.splice(s, 1)
	}
}

/** The closest point of a convex outline (world points, counter-clockwise) to p, and whether p is inside it (then the nearest side's point). */
export const closestOnOutline = (pts: readonly V[], p: V): { q: V; inside: boolean; nx: number; ny: number } => {
	const n = pts.length
	let best = Number.POSITIVE_INFINITY
	let q: V = pts[0] as V
	let inside = true
	let nearest = Number.POSITIVE_INFINITY
	let face = { x: 0, y: 0, nx: 0, ny: 1 }
	for (let i = 0; i < n; i++) {
		const a = pts[i] as V
		const b = pts[(i + 1) % n] as V
		const ex = b.x - a.x
		const ey = b.y - a.y
		const len2 = ex * ex + ey * ey
		const len = Math.sqrt(len2)
		if (len < 1e-12) continue
		// (outward normal of a counter-clockwise side: its direction turned clockwise)
		const nx = ey / len
		const ny = -ex / len
		const side = (p.x - a.x) * nx + (p.y - a.y) * ny
		if (side > 0) inside = false
		if (-side < nearest) {
			nearest = -side
			face = { x: p.x - side * nx, y: p.y - side * ny, nx, ny }
		}
		const u = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2))
		const cx = a.x + u * ex
		const cy = a.y + u * ey
		const d2 = (p.x - cx) * (p.x - cx) + (p.y - cy) * (p.y - cy)
		if (d2 < best) {
			best = d2
			q = { x: cx, y: cy }
		}
	}
	if (inside) return { q: { x: face.x, y: face.y }, inside: true, nx: face.nx, ny: face.ny }
	const d = Math.sqrt(best)
	return { q, inside: false, nx: d > 1e-12 ? (p.x - q.x) / d : 0, ny: d > 1e-12 ? (p.y - q.y) / d : 1 }
}

/**
 * Where a round body (centre c) meets another solid's outline: `s` the distance from c to the other's surface along the normal n (from the
 * other toward c; negative when c is inside it), and the point on the other's surface.
 */
export const meetOutline = (c: V, other: { circle?: { x: number; y: number; r: number }; points?: readonly V[] }): { s: number; nx: number; ny: number; px: number; py: number } | undefined => {
	if (other.circle !== undefined) {
		const dx = c.x - other.circle.x
		const dy = c.y - other.circle.y
		const d = Math.sqrt(dx * dx + dy * dy)
		const nx = d > 1e-12 ? dx / d : 0
		const ny = d > 1e-12 ? dy / d : 1
		return { s: d - other.circle.r, nx, ny, px: other.circle.x + nx * other.circle.r, py: other.circle.y + ny * other.circle.r }
	}
	const pts = other.points
	if (pts === undefined || pts.length < 2) return undefined
	const m = closestOnOutline(pts, c)
	const d = Math.sqrt((c.x - m.q.x) * (c.x - m.q.x) + (c.y - m.q.y) * (c.y - m.q.y))
	return { s: m.inside ? -d : d, nx: m.nx, ny: m.ny, px: m.q.x, py: m.q.y }
}

// ------------------------------------------------------------------------------------------------------------------------------ bending beams
/**
 * One joint of a beam: the pin where two of its rigid segments meet (a point constraint: they never come apart) and a bending spring across it,
 * torque −k·(φ − φ₀ − φp) − c·φ̇ on B (the opposite on A), φ = θ_B − θ_A. planck's own solver cannot hold a chain of light, stiff segments (a
 * 3.5 mm ruler's 2 g pieces swing at ω·h ≈ 70: its sweeps, even its WeldJoint's, blow up), so every link of a beam belongs to one `BeamChain`,
 * whose first link solves them all at once, exactly: the pins and the bends as one block-tridiagonal system (3 rows a joint: the pin's x, y and
 * the bend), factorised at the step's start and solved again in each of planck's velocity passes (contacts in between), then the pins' drift
 * corrected in its position passes (Box2D's, the same system on their 2 rows). The bend is a soft row (Box2D's soft constraint with this k and
 * c, the share θ of k solved implicitly, 1 − θ explicitly at the step's start, as physics.ts's SpringLink): steady at any stiffness.
 */
export class BeamLink extends PlanckJoint {
	theta = 0
	k: number
	c: number
	/** The rest angle (θ_B − θ_A as built) and the permanent bend added since, rad. */
	readonly rest: number
	set = 0
	broken = false
	readonly chain: BeamChain
	/** Anchors in each body's own frame (planck units, from its origin). */
	readonly la: Vec2
	readonly lb: Vec2
	phi = 0
	rate0 = 0
	// (this step: arms from each centre, inverse masses, the soft row's γ and bias, the explicit impulse, accumulated impulses)
	rA = new Vec2(0, 0)
	rB = new Vec2(0, 0)
	gamma = Number.POSITIVE_INFINITY
	bias = 0
	hooke = 0
	px = 0
	py = 0
	pa = 0
	constructor(A: Body, B: Body, anchor: Vec2, k: number, c: number, chain: BeamChain) {
		super({ collideConnected: false }, A, B)
		;(this as unknown as { m_type: string }).m_type = "beam-link"
		this.k = k
		this.c = c
		this.rest = B.getAngle() - A.getAngle()
		this.la = A.getLocalPoint(anchor)
		this.lb = B.getLocalPoint(anchor)
		this.chain = chain
		chain.links.push(this)
	}
	/** Its bend now (rad, from as built, the permanent bend left out): what the spring pushes back against. */
	bend() {
		return this.m_bodyB.getAngle() - this.m_bodyA.getAngle() - this.rest - this.set
	}
	/** The bend and its rate before the step; returns h²·k·(1/I_A + 1/I_B)·2 (`theta`'s a). */
	prepare(h: number) {
		const A = this.m_bodyA
		const B = this.m_bodyB
		this.phi = this.bend()
		this.rate0 = B.getAngularVelocity() - A.getAngularVelocity()
		const invI = solving(A).m_invI + solving(B).m_invI
		if (A.isDynamic() && !A.isAwake()) A.setAwake(true)
		if (B.isDynamic() && !B.isAwake()) B.setAwake(true)
		if (this.broken || invI === 0) return 0
		return h * h * this.k * invI * LENGTH_SCALE * LENGTH_SCALE * 2
	}
	initVelocityConstraints(step: TimeStep) {
		if (this.chain.links[0] === this) this.chain.init(step)
	}
	solveVelocityConstraints(_step: TimeStep) {
		if (this.chain.links[0] === this) this.chain.solve()
	}
	solvePositionConstraints(_step: TimeStep) {
		return this.chain.links[0] === this ? this.chain.position() : true
	}
	/** The bending moment it carried in the last step (N·m): the explicit share and the implicit one. */
	moment(h: number) {
		return (this.hooke + this.pa) / (h * LENGTH_SCALE * LENGTH_SCALE)
	}
	getAnchorA() {
		return this.m_bodyA.getWorldPoint(this.la)
	}
	getAnchorB() {
		return this.m_bodyB.getWorldPoint(this.lb)
	}
	getReactionForce(inv_dt: number) {
		return new Vec2(this.px * inv_dt, this.py * inv_dt)
	}
	getReactionTorque(inv_dt: number) {
		return (this.hooke + this.pa) * inv_dt
	}
}

/** 3×3 helpers on flat Float64Arrays (row-major, at an offset): the beam solver runs in every velocity pass, so it allocates nothing there. */
const m3mul = (a: Float64Array, ao: number, b: Float64Array, bo: number, out: Float64Array, oo: number, bT = false) => {
	for (let i = 0; i < 3; i++)
		for (let j = 0; j < 3; j++) {
			let sum = 0
			for (let k = 0; k < 3; k++) sum += (a[ao + i * 3 + k] as number) * (bT ? (b[bo + j * 3 + k] as number) : (b[bo + k * 3 + j] as number))
			out[oo + i * 3 + j] = sum
		}
}
const m3inv = (a: Float64Array, ao: number, out: Float64Array, oo: number) => {
	const a0 = a[ao] as number, a1 = a[ao + 1] as number, a2 = a[ao + 2] as number
	const a3 = a[ao + 3] as number, a4 = a[ao + 4] as number, a5 = a[ao + 5] as number
	const a6 = a[ao + 6] as number, a7 = a[ao + 7] as number, a8 = a[ao + 8] as number
	const c0 = a4 * a8 - a5 * a7
	const c1 = a5 * a6 - a3 * a8
	const c2 = a3 * a7 - a4 * a6
	let det = a0 * c0 + a1 * c1 + a2 * c2
	if (det !== 0) det = 1 / det
	out[oo] = c0 * det
	out[oo + 1] = (a2 * a7 - a1 * a8) * det
	out[oo + 2] = (a1 * a5 - a2 * a4) * det
	out[oo + 3] = c1 * det
	out[oo + 4] = (a0 * a8 - a2 * a6) * det
	out[oo + 5] = (a2 * a3 - a0 * a5) * det
	out[oo + 6] = c2 * det
	out[oo + 7] = (a1 * a6 - a0 * a7) * det
	out[oo + 8] = (a0 * a4 - a1 * a3) * det
}

/** The links of one beam, solved together (see BeamLink). */
export class BeamChain {
	readonly links: BeamLink[] = []
	// the factorised system of this step: each joint's diagonal block (Schur-reduced) inverted, its coupling to the next (K_{j+1,j}), and
	// L_j·D_j⁻¹ (the forward elimination's multiplier); scratch for the right-hand sides and the solution
	private dinv = new Float64Array(0)
	private down = new Float64Array(0)
	private mult = new Float64Array(0)
	private rhs = new Float64Array(0)
	private sol = new Float64Array(0)
	private readonly t9 = new Float64Array(9)
	private readonly u9 = new Float64Array(9)
	private readonly g9 = new Float64Array(9)
	private readonly h9 = new Float64Array(9)
	private size(n: number) {
		if (this.dinv.length === 9 * n) return
		this.dinv = new Float64Array(9 * n)
		this.down = new Float64Array(9 * n)
		this.mult = new Float64Array(9 * n)
		this.rhs = new Float64Array(3 * n)
		this.sol = new Float64Array(3 * n)
	}
	/** A body's rows for a joint into out: G (rows: pin x, pin y, bend; columns: vx, vy, ω), sign +1 for B, −1 for A. */
	private static g(r: Vec2, sign: number, out: Float64Array) {
		out[0] = sign
		out[1] = 0
		out[2] = -sign * r.y
		out[3] = 0
		out[4] = sign
		out[5] = sign * r.x
		out[6] = 0
		out[7] = 0
		out[8] = sign
	}
	/** out += G_j · M⁻¹ · G_kᵀ for one body (inverse mass m, inverse inertia i). */
	private static couple(gj: Float64Array, m: number, i: number, gk: Float64Array, out: Float64Array, oo: number) {
		for (let r = 0; r < 3; r++)
			for (let c = 0; c < 3; c++)
				out[oo + r * 3 + c] = (out[oo + r * 3 + c] as number) + (gj[r * 3] as number) * m * (gk[c * 3] as number) + (gj[r * 3 + 1] as number) * m * (gk[c * 3 + 1] as number) + (gj[r * 3 + 2] as number) * i * (gk[c * 3 + 2] as number)
	}
	private arms() {
		for (const l of this.links) {
			const A = l.m_bodyA
			const B = l.m_bodyB
			const sa = solving(A)
			const sb = solving(B)
			const ca = Math.cos(sa.c_position.a)
			const na = Math.sin(sa.c_position.a)
			const cb = Math.cos(sb.c_position.a)
			const nb = Math.sin(sb.c_position.a)
			const lca = A.getLocalCenter()
			const lcb = B.getLocalCenter()
			l.rA.x = ca * (l.la.x - lca.x) - na * (l.la.y - lca.y)
			l.rA.y = na * (l.la.x - lca.x) + ca * (l.la.y - lca.y)
			l.rB.x = cb * (l.lb.x - lcb.x) - nb * (l.lb.y - lcb.y)
			l.rB.y = nb * (l.lb.x - lcb.x) + cb * (l.lb.y - lcb.y)
		}
	}
	private angular(l: BeamLink, soft: boolean) {
		return soft && !l.broken && l.gamma !== Number.POSITIVE_INFINITY
	}
	/** Factorises the system (the bend rows with their soft γ, or none where `soft` is false). */
	private factor(soft: boolean) {
		const n = this.links.length
		this.size(n)
		const D = this.t9
		for (let j = 0; j < n; j++) {
			const l = this.links[j] as BeamLink
			const sa = solving(l.m_bodyA)
			const sb = solving(l.m_bodyB)
			D.fill(0)
			BeamChain.g(l.rA, -1, this.g9)
			BeamChain.couple(this.g9, sa.m_invMass, sa.m_invI, this.g9, D, 0)
			BeamChain.g(l.rB, 1, this.h9)
			BeamChain.couple(this.h9, sb.m_invMass, sb.m_invI, this.h9, D, 0)
			const ang = this.angular(l, soft)
			if (ang) D[8] = (D[8] as number) + l.gamma
			else {
				// (no bend row: its row and column left out)
				D[2] = D[5] = D[6] = D[7] = 0
				D[8] = 1
			}
			if (j > 0) {
				// D −= L_{j−1}·D_{j−1}⁻¹·L_{j−1}ᵀ (mult_{j−1} = L_{j−1}·D_{j−1}⁻¹)
				m3mul(this.mult, 9 * (j - 1), this.down, 9 * (j - 1), this.u9, 0, true)
				for (let q = 0; q < 9; q++) D[q] = (D[q] as number) - (this.u9[q] as number)
			}
			m3inv(D, 0, this.dinv, 9 * j)
			// the coupling to the next joint through the body they share (this one's B is the next one's A): K_{j+1,j} = G_{j+1,A}·M⁻¹·G_{j,B}ᵀ
			this.down.fill(0, 9 * j, 9 * j + 9)
			const next = this.links[j + 1]
			if (next !== undefined && next.m_bodyA === l.m_bodyB) {
				BeamChain.g(next.rA, -1, this.g9)
				BeamChain.couple(this.g9, sb.m_invMass, sb.m_invI, this.h9, this.down, 9 * j)
				const o = 9 * j
				if (!this.angular(next, soft)) this.down[o + 6] = this.down[o + 7] = this.down[o + 8] = 0
				if (!ang) this.down[o + 2] = this.down[o + 5] = this.down[o + 8] = 0
			}
			m3mul(this.down, 9 * j, this.dinv, 9 * j, this.mult, 9 * j)
		}
	}
	private applyTo(l: BeamLink, x: number, y: number, a: number) {
		const A = solving(l.m_bodyA)
		const B = solving(l.m_bodyB)
		A.c_velocity.v.x -= A.m_invMass * x
		A.c_velocity.v.y -= A.m_invMass * y
		A.c_velocity.w -= A.m_invI * (l.rA.x * y - l.rA.y * x + a)
		B.c_velocity.v.x += B.m_invMass * x
		B.c_velocity.v.y += B.m_invMass * y
		B.c_velocity.w += B.m_invI * (l.rB.x * y - l.rB.y * x + a)
	}
	init(step: TimeStep) {
		const h = step.dt
		const S = LENGTH_SCALE * LENGTH_SCALE
		this.arms()
		for (const l of this.links) {
			l.gamma = Number.POSITIVE_INFINITY
			l.bias = 0
			l.hooke = 0
			if (l.broken) continue
			const beta = l.c * S * h * (solving(l.m_bodyA).m_invI + solving(l.m_bodyB).m_invI)
			const late = beta > 2 ? 1 - 1 / beta : 0.5
			// the explicit share: (1 − θ) of the Hooke torque, and the damping from the step's start (trapezoidal)
			l.hooke = (-(1 - l.theta) * l.k * l.phi * h - (1 - late) * l.c * h * l.rate0) * S
			// the implicit share, a soft row: λ = −h·(θ·k·(φ + h·ω) + c·ω)·S at the step's end
			const soft = (l.theta * h * l.k + late * l.c) * S
			if (soft > 0) {
				l.gamma = 1 / (h * soft)
				l.bias = (l.theta * l.k * l.phi * S) / soft
			}
		}
		this.factor(true)
		for (const l of this.links) {
			this.applyTo(l, 0, 0, l.hooke)
			if (step.warmStarting) {
				l.px *= step.dtRatio
				l.py *= step.dtRatio
				l.pa = l.gamma === Number.POSITIVE_INFINITY ? 0 : l.pa * step.dtRatio
				this.applyTo(l, l.px, l.py, l.pa)
			} else {
				l.px = l.py = l.pa = 0
			}
		}
	}
	/** Block-tridiagonal forward elimination and back-substitution of this.rhs into this.sol with the factorised blocks. */
	private back(n: number) {
		const r = this.rhs
		const x = this.sol
		const M = this.mult
		const Dn = this.down
		const Di = this.dinv
		for (let j = 1; j < n; j++) {
			const o = 9 * (j - 1)
			const p = 3 * (j - 1)
			const q = 3 * j
			for (let i = 0; i < 3; i++) r[q + i] = (r[q + i] as number) - ((M[o + i * 3] as number) * (r[p] as number) + (M[o + i * 3 + 1] as number) * (r[p + 1] as number) + (M[o + i * 3 + 2] as number) * (r[p + 2] as number))
		}
		for (let j = n - 1; j >= 0; j--) {
			const q = 3 * j
			let r0 = r[q] as number
			let r1 = r[q + 1] as number
			let r2 = r[q + 2] as number
			if (j < n - 1) {
				// r −= L_jᵀ · x_{j+1}
				const o = 9 * j
				const p = 3 * (j + 1)
				const x0 = x[p] as number
				const x1 = x[p + 1] as number
				const x2 = x[p + 2] as number
				r0 -= (Dn[o] as number) * x0 + (Dn[o + 3] as number) * x1 + (Dn[o + 6] as number) * x2
				r1 -= (Dn[o + 1] as number) * x0 + (Dn[o + 4] as number) * x1 + (Dn[o + 7] as number) * x2
				r2 -= (Dn[o + 2] as number) * x0 + (Dn[o + 5] as number) * x1 + (Dn[o + 8] as number) * x2
			}
			const o = 9 * j
			x[q] = (Di[o] as number) * r0 + (Di[o + 1] as number) * r1 + (Di[o + 2] as number) * r2
			x[q + 1] = (Di[o + 3] as number) * r0 + (Di[o + 4] as number) * r1 + (Di[o + 5] as number) * r2
			x[q + 2] = (Di[o + 6] as number) * r0 + (Di[o + 7] as number) * r1 + (Di[o + 8] as number) * r2
		}
	}
	/** One exact solve of every pin and bend for the velocities as they are now. */
	solve() {
		const n = this.links.length
		for (let j = 0; j < n; j++) {
			const l = this.links[j] as BeamLink
			const A = solving(l.m_bodyA)
			const B = solving(l.m_bodyB)
			const ang = this.angular(l, true)
			this.rhs[3 * j] = -(B.c_velocity.v.x - B.c_velocity.w * l.rB.y - A.c_velocity.v.x + A.c_velocity.w * l.rA.y)
			this.rhs[3 * j + 1] = -(B.c_velocity.v.y + B.c_velocity.w * l.rB.x - A.c_velocity.v.y - A.c_velocity.w * l.rA.x)
			this.rhs[3 * j + 2] = ang ? -(B.c_velocity.w - A.c_velocity.w + l.bias + l.gamma * l.pa) : 0
		}
		this.back(n)
		for (let j = 0; j < n; j++) {
			const l = this.links[j] as BeamLink
			const x = this.sol[3 * j] as number
			const y = this.sol[3 * j + 1] as number
			const a = this.angular(l, true) ? (this.sol[3 * j + 2] as number) : 0
			l.px += x
			l.py += y
			l.pa += a
			this.applyTo(l, x, y, a)
		}
	}
	/** The pins' drift, corrected as Box2D's revolute joints' position passes do (at most maxLinearCorrection a pass), all at once. */
	position() {
		const n = this.links.length
		this.arms()
		this.factor(false)
		const slop = 0.005
		const most = 0.2
		let worst = 0
		for (let j = 0; j < n; j++) {
			const l = this.links[j] as BeamLink
			const A = solving(l.m_bodyA)
			const B = solving(l.m_bodyB)
			const cx = B.c_position.c.x + l.rB.x - A.c_position.c.x - l.rA.x
			const cy = B.c_position.c.y + l.rB.y - A.c_position.c.y - l.rA.y
			worst = Math.max(worst, Math.sqrt(cx * cx + cy * cy))
			this.rhs[3 * j] = -Math.max(-most, Math.min(most, cx))
			this.rhs[3 * j + 1] = -Math.max(-most, Math.min(most, cy))
			this.rhs[3 * j + 2] = 0
		}
		this.back(n)
		for (let j = 0; j < n; j++) {
			const l = this.links[j] as BeamLink
			const x = this.sol[3 * j] as number
			const y = this.sol[3 * j + 1] as number
			const A = solving(l.m_bodyA)
			const B = solving(l.m_bodyB)
			A.c_position.c.x -= A.m_invMass * x
			A.c_position.c.y -= A.m_invMass * y
			A.c_position.a -= A.m_invI * (l.rA.x * y - l.rA.y * x)
			B.c_position.c.x += B.m_invMass * x
			B.c_position.c.y += B.m_invMass * y
			B.c_position.a += B.m_invI * (l.rB.x * y - l.rB.y * x)
		}
		return worst < 3 * slop
	}
}

// ------------------------------------------------------------------------------------------------------------------------------ rubber
/** A rubber strand's force (N) at stretch λ = l/l0: A0·(E/3)·(λ − 1/λ²), Gent-stiffened toward J_m (0 when slack). */
export const rubberForce = (A0: number, E: number, lock: number, lam: number) => {
	if (!(lam > 1)) return 0
	const I1 = lam * lam + 2 / lam - 3
	const g = lock > 0 ? lock / Math.max(lock * 0.05, lock - Math.min(I1, lock * 0.95)) : 1
	return A0 * (E / 3) * (lam - 1 / (lam * lam)) * g
}
/** The energy (J) a strand of rest length l0 holds at stretch λ: ∫F dl (Simpson's rule over 24 pieces: the Gent factor has no short form here). */
export const rubberEnergy = (A0: number, E: number, lock: number, l0: number, lam: number) => {
	if (!(lam > 1)) return 0
	const n = 24
	const hstep = (lam - 1) / n
	let s = rubberForce(A0, E, lock, 1) + rubberForce(A0, E, lock, lam)
	for (let i = 1; i < n; i++) s += (i % 2 === 1 ? 4 : 2) * rubberForce(A0, E, lock, 1 + i * hstep)
	return ((s * hstep) / 3) * l0
}

// ------------------------------------------------------------------------------------------------------------------------------ the run
interface BallState {
	readonly rec: ProcessRecord
	readonly item: string
	readonly solid: string
	readonly law: BallLaw
	readonly flats: Flat[]
	/** This step's contacts: the squash at each (own frame angle, depth). */
	shape: number[]
	squash: number
	force: number
	energy: number
}
interface BeamState {
	readonly item: string
	readonly links: { link: BeamLink; my: number; mu: number; a: string; b: string; mf: number }[]
	readonly solids: readonly string[]
	readonly clamp: string | undefined
	readonly base: V | undefined
	readonly axis: V | undefined
	readonly tip: V
	readonly ductile: boolean
	readonly segment: number
	bend: number
	energy: number
	set: number
}
interface BandState {
	readonly item: string
	readonly pad: string
	readonly anchor: V
	readonly spread: number
	readonly l0: number
	readonly area: number
	readonly E: number
	readonly n: number
	readonly resilience: number
	readonly lock: number
	/** The stretch λ it snaps at (0: never). */
	readonly snap: number
	broken: boolean
	/** Last step: the pouch's speed toward the posts at the step's end, the mean speed it was given, and the line it was along. */
	vEnd: number | undefined
	vBar: number
	ux: number
	uy: number
	last: number
	stretch: number
	tension: number
	energy: number
}
interface MotorState {
	readonly item: string
	readonly wheel: string
	readonly chassis: string
	readonly front: string | undefined
	readonly r: number
	readonly l0: number
	readonly area: number
	readonly E: number
	readonly n: number
	readonly resilience: number
	readonly lock: number
	readonly sense: number
	wound: number
	tension: number
	unwound: boolean
	spun: boolean
	/** It has had its first step after the release (the engine finds what touches what in its first step). */
	began: boolean
}
interface SpringState {
	readonly item: string
	readonly a: string | null
	readonly b: string | null
	readonly anchorA: V
	readonly anchorB: V
	readonly rest: number
	readonly k: number
	readonly tare: number
}

/** Why a softbody record cannot run (admitDocument refuses the document with it), or undefined. */
export const softbodyProblem = (r: ProcessRecord, solids: ReadonlySet<string>): string | undefined => {
	const role = r.role
	const need = (key: string) => {
		const v = str(r[key])
		return v !== undefined && solids.has(v) ? undefined : `its ${key} must name a solid of the document`
	}
	if (role === "ball") {
		const why = need("solid")
		if (why !== undefined) return why
		if (!["pressure", "hertz", "clay"].includes(String(r.law))) return `law must be pressure, hertz or clay, not ${String(r.law)}`
		if (!(num(r.R, 0) > 0)) return "R must be a positive number"
		return undefined
	}
	if (role === "beam") {
		const list = r.solids
		if (!Array.isArray(list) || list.length < 1 || list.some((s) => typeof s !== "string" || !solids.has(s))) return "solids must list the beam's solids"
		if (!Array.isArray(r.joints)) return "joints must be a list"
		for (const j of r.joints as unknown[]) {
			const o = j as Record<string, unknown>
			if (typeof o?.a !== "string" || typeof o?.b !== "string" || !solids.has(o.a) || !solids.has(o.b)) return "each joint joins two of its solids"
			if (!(num(o.k, -1) >= 0) || !(num(o.c, -1) >= 0)) return "each joint needs k and c (zero or more)"
		}
		return undefined
	}
	if (role === "band") {
		const why = need("pad")
		if (why !== undefined) return why
		if (pt(r.anchor) === undefined) return "anchor must be a world point"
		if (!(num(r.l0, 0) > 0) || !(num(r.area, 0) > 0) || !(num(r.E, 0) > 0)) return "l0, area and E must be positive"
		return undefined
	}
	if (role === "motor") {
		const why = need("wheel") ?? need("chassis")
		if (why !== undefined) return why
		if (!(num(r.r, 0) > 0) || !(num(r.l0, 0) > 0)) return "r and l0 must be positive"
		return undefined
	}
	if (role === "guide") {
		const why = need("solid")
		if (why !== undefined) return why
		if (pt(r.axis) === undefined) return "axis must be a direction {x, y}"
		return undefined
	}
	if (role === "spring") {
		for (const side of ["a", "b"]) {
			const v = r[side]
			if (v !== null && (typeof v !== "string" || !solids.has(v))) return `its ${side} must be a solid of the document or null`
		}
		return undefined
	}
	return `no softbody role "${String(role)}"`
}

/** One document's softbody records, run together (tooling/src/sim/modules/softbody.ts drives it from the first record's process). */
export const softbodyRun = (records: readonly ProcessRecord[], ctx: ProcessContext, engine: EngineInternals | undefined) => {
	if (engine !== undefined && engine.lengthScale !== LENGTH_SCALE) throw new Error(`softbody: the engine's length scale is ${engine.lengthScale}, not ${LENGTH_SCALE}`)
	const g = ctx.settings.gravity
	const balls: BallState[] = []
	const beams: BeamState[] = []
	const bands: BandState[] = []
	const motors: MotorState[] = []
	const springs: SpringState[] = []
	/** A launcher's pouch at the start: moved toward the posts until it meets the moving thing in front of it, when that is within SEAT_REACH
	 * (rays from each corner of its parts along the launch line; the nearest hit on another moving body), so what it launches starts in it:
	 * no gap for the 2 g pouch to cross at 20 m/s and strike. Beyond that reach it stays where it was put. */
	const seatPouch = (pouch: Body, anchor: V) => {
		type Ray = { rayCast(a: Vec2, b: Vec2, f: (fx: { getBody(): Body; isSensor(): boolean }, p: Vec2, n: Vec2, frac: number) => number): void }
		const w = engine?.world as Ray | undefined
		if (w === undefined) return
		const p = pouch.getPosition()
		const dx = anchor.x * LENGTH_SCALE - p.x
		const dy = anchor.y * LENGTH_SCALE - p.y
		const d = Math.sqrt(dx * dx + dy * dy)
		if (!(d > 1e-9)) return
		const ux = dx / d
		const uy = dy / d
		const reach = Math.min(SEAT_REACH * LENGTH_SCALE, d)
		let best = reach
		for (let f = pouch.getFixtureList(); f !== null; f = f.getNext()) {
			const shape = f.getShape() as unknown as { getType(): string; m_vertices?: Vec2[] }
			if (shape.getType() !== "polygon" || shape.m_vertices === undefined) continue
			for (const v of shape.m_vertices) {
				const o = pouch.getWorldPoint(v)
				w.rayCast(o, new Vec2(o.x + ux * reach, o.y + uy * reach), (fx, _q, _n, frac) => {
					const b = fx.getBody()
					if (b === pouch || !b.isDynamic() || fx.isSensor()) return -1
					best = Math.min(best, frac * reach)
					return frac
				})
			}
		}
		const move = best - SEAT_GAP * LENGTH_SCALE
		if (best < reach && move > 0) pouch.setTransform(new Vec2(p.x + ux * move, p.y + uy * move), pouch.getAngle())
	}
	for (const r of records) {
		const item = str(r.item) ?? ""
		if (r.role === "ball") {
			const R = num(r.R, 0.05)
			const E = num(r.E, 0)
			const nu = num(r.nu, 0.5)
			balls.push({
				rec: r,
				item,
				solid: str(r.solid) as string,
				law: {
					law: r.law as BallLaw["law"],
					R,
					gauge: num(r.gauge, 0),
					wall: num(r.wall, 0),
					Estar: E / (1 - nu * nu),
					flow: num(r.flow, 0),
					kc: num(r.kc, 0),
					e: num(r.e, 0.5),
					hard: num(r.hard, 0.5 * R)
				},
				flats: [],
				shape: [],
				squash: 0,
				force: 0,
				energy: 0
			})
		} else if (r.role === "beam") {
			beams.push({
				item,
				links: [],
				solids: r.solids as string[],
				clamp: str(r.clamp),
				base: pt(r.base),
				axis: pt(r.axis),
				tip: pt(r.tip) ?? { x: 0, y: 0 },
				ductile: r.ductile === true,
				segment: num(r.segment, 0.05),
				bend: 0,
				energy: 0,
				set: 0
			})
			const beam = beams[beams.length - 1] as BeamState
			const world = engine?.world as { createJoint(j: PlanckJoint): PlanckJoint } | undefined
			const chain = new BeamChain()
			for (const j of r.joints as Record<string, unknown>[]) {
				const A = engine?.bodyOf(j.a as string) as Body | undefined
				const B = engine?.bodyOf(j.b as string) as Body | undefined
				if (world === undefined || A === undefined || B === undefined || A === B) continue
				// (the pin: where B begins, half a segment back from its middle)
				const at = B.getWorldPoint(new Vec2(-beam.tip.x * LENGTH_SCALE, -beam.tip.y * LENGTH_SCALE))
				const link = world.createJoint(new BeamLink(A, B, at, num(j.k, 0), num(j.c, 0), chain)) as BeamLink
				beam.links.push({ link, my: num(j.my, Number.POSITIVE_INFINITY), mu: num(j.mu, Number.POSITIVE_INFINITY), a: j.a as string, b: j.b as string, mf: 0 })
			}
		} else if (r.role === "band") {
			// The pouch does not turn: its two strands hold it square to the launch line (a light pouch that could tumble would flip over what it
			// pushes the moment it meets it). Its mass and centre stay what the engine gave its parts.
			const pouch = engine?.bodyOf(str(r.pad) as string) as Body | undefined
			if (pouch !== undefined) {
				const md = { mass: 0, center: Vec2.zero(), I: 0 }
				pouch.getMassData(md)
				pouch.setFixedRotation(true)
				pouch.setMassData(md)
				seatPouch(pouch, pt(r.anchor) as V)
			}
			bands.push({
				item,
				pad: str(r.pad) as string,
				anchor: pt(r.anchor) as V,
				spread: num(r.spread, 0.08),
				l0: num(r.l0, 0.05),
				area: num(r.area, 1e-6),
				E: num(r.E, 1.5e6),
				n: Math.max(1, Math.round(num(r.n, 1))),
				resilience: Math.min(1, Math.max(0, num(r.resilience, 0.8))),
				lock: num(r.lock, 0),
				snap: Math.max(0, num(r.snap, 0)),
				broken: false,
				vEnd: undefined,
				vBar: 0,
				ux: 1,
				uy: 0,
				last: 0,
				stretch: 0,
				tension: 0,
				energy: 0
			})
		} else if (r.role === "motor") {
			motors.push({
				item,
				wheel: str(r.wheel) as string,
				chassis: str(r.chassis) as string,
				front: str(r.front),
				r: num(r.r, 0.002),
				l0: num(r.l0, 0.1),
				area: num(r.area, 1e-6),
				E: num(r.E, 1.5e6),
				n: Math.max(1, Math.round(num(r.n, 2))),
				resilience: Math.min(1, Math.max(0, num(r.resilience, 0.8))),
				lock: num(r.lock, 0),
				sense: num(r.sense, -1) < 0 ? -1 : 1,
				wound: Math.max(0, num(r.turns, 0)) * 2 * Math.PI,
				tension: 0,
				unwound: false,
				spun: false,
				began: false
			})
		} else if (r.role === "guide") {
			const body = engine?.bodyOf(str(r.solid) as string) as Body | undefined
			const ground = engine?.bodyOf(null) as Body | undefined
			const ax = pt(r.axis) as V
			const len = Math.sqrt(ax.x * ax.x + ax.y * ax.y)
			const world = engine?.world as { createJoint(j: PlanckJoint): PlanckJoint } | undefined
			if (world !== undefined && body !== undefined && ground !== undefined && len > 0 && body.isDynamic())
				world.createJoint(new PrismaticJoint({ collideConnected: true }, ground, body, body.getWorldCenter(), new Vec2(ax.x / len, ax.y / len)))
		} else if (r.role === "spring") {
			springs.push({
				item,
				a: (r.a as string | null) ?? null,
				b: (r.b as string | null) ?? null,
				anchorA: pt(r.anchorA) ?? { x: 0, y: 0 },
				anchorB: pt(r.anchorB) ?? { x: 0, y: 0 },
				rest: num(r.rest, 0.1),
				k: num(r.k, 100),
				tare: num(r.tare, 0)
			})
		}
	}
	const ballOf = new Map<string, BallState>(balls.map((b) => [b.solid, b]))

	// ---------------------------------------------------------------- helpers on handles
	const world = (h: SolidHandle | undefined, p: V): V => {
		if (h === undefined) return p
		const q = h.pose()
		const c = Math.cos(q.angle)
		const s = Math.sin(q.angle)
		return { x: q.x + p.x * c - p.y * s, y: q.y + p.x * s + p.y * c }
	}
	/** A body's velocity at a world point, predicted to the step's end under gravity and what is applied to it so far (m/s). */
	const predicted = (h: SolidHandle | undefined, p: V, dt: number) => {
		if (h === undefined || !h.dynamic) return { vx: 0, vy: 0, im: 0, iI: 0, cx: p.x, cy: p.y }
		const b = h.body()
		if (!(b.mass > 0)) return { vx: 0, vy: 0, im: 0, iI: 0, cx: p.x, cy: p.y }
		const w = b.spin + (b.inertia > 0 ? (dt * b.torque) / b.inertia : 0)
		const vx = b.velocity.x + (dt * b.force.x) / b.mass
		const vy = b.velocity.y + dt * (b.force.y / b.mass - g)
		const rx = p.x - b.center.x
		const ry = p.y - b.center.y
		return { vx: vx - w * ry, vy: vy + w * rx, im: 1 / b.mass, iI: b.inertia > 0 ? 1 / b.inertia : 0, cx: b.center.x, cy: b.center.y }
	}

	// ---------------------------------------------------------------- soft contacts
	/** Pairs whose planck contact this step leaves out (the soft force does the work), by "a\u0000b" of solid ids. */
	const soft = new Set<string>()
	const pairKey = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`)
	/** The solids each soft ball may touch now: planck's contacts on its body (its broad phase and filters). */
	const neighbours = (ball: BallState): string[] => {
		const body = engine?.bodyOf(ball.solid) as Body | undefined
		if (body === undefined) return []
		const out: string[] = []
		for (let e = body.getContactList(); e !== null; e = e.next) {
			const c = e.contact
			const a = engine?.solidOf(c.getFixtureA().getUserData())
			const b = engine?.solidOf(c.getFixtureB().getUserData())
			if (a === undefined || b === undefined) continue
			const other = a.id === ball.solid ? b.id : b.id === ball.solid ? a.id : undefined
			if (other !== undefined && !out.includes(other)) out.push(other)
		}
		return out
	}
	/**
	 * A body as this step's soft contacts see it: its velocity now, predicted to the step's end (gravity and what is applied to it so far), and
	 * what the soft contacts' impulses add (they are solved together, a few passes, as planck solves its own contacts).
	 */
	interface Mover {
		readonly h: SolidHandle | undefined
		readonly im: number
		readonly iI: number
		readonly cx: number
		readonly cy: number
		readonly vx: number
		readonly vy: number
		readonly w: number
		readonly vx0: number
		readonly vy0: number
		readonly w0: number
		dvx: number
		dvy: number
		dw: number
	}
	const STILL: Mover = { h: undefined, im: 0, iI: 0, cx: 0, cy: 0, vx: 0, vy: 0, w: 0, vx0: 0, vy0: 0, w0: 0, dvx: 0, dvy: 0, dw: 0 }
	const movers = new Map<string, Mover>()
	const moverOf = (id: string, h: SolidHandle | undefined, dt: number): Mover => {
		const have = movers.get(id)
		if (have !== undefined) return have
		let m: Mover = { ...STILL, h }
		if (h !== undefined && h.dynamic) {
			const b = h.body()
			if (b.mass > 0) {
				m = {
					h, im: 1 / b.mass, iI: b.inertia > 0 ? 1 / b.inertia : 0, cx: b.center.x, cy: b.center.y,
					vx: b.velocity.x + (dt * b.force.x) / b.mass, vy: b.velocity.y + dt * (b.force.y / b.mass - g), w: b.spin + (b.inertia > 0 ? (dt * b.torque) / b.inertia : 0),
					vx0: b.velocity.x, vy0: b.velocity.y, w0: b.spin, dvx: 0, dvy: 0, dw: 0
				}
			}
		}
		movers.set(id, m)
		return m
	}
	/** A mover's velocity at p: predicted (now: without what this step adds) along (ux, uy). */
	const along = (m: Mover, p: V, ux: number, uy: number, now = false) => {
		const rx = p.x - m.cx
		const ry = p.y - m.cy
		const w = now ? m.w0 : m.w + m.dw
		const vx = now ? m.vx0 : m.vx + m.dvx
		const vy = now ? m.vy0 : m.vy + m.dvy
		return (vx - w * ry) * ux + (vy + w * rx) * uy
	}
	/** 1/m along a direction at a point for a body (its mass and its turning about its centre). */
	const inverseAlong = (m: { im: number; iI: number; cx: number; cy: number }, p: V, ux: number, uy: number) => {
		const cr = (p.x - m.cx) * uy - (p.y - m.cy) * ux
		return m.im + m.iI * cr * cr
	}
	const kick = (m: Mover, p: V, jx: number, jy: number) => {
		m.dvx += m.im * jx
		m.dvy += m.im * jy
		m.dw += m.iI * ((p.x - m.cx) * jy - (p.y - m.cy) * jx)
	}
	/** One soft contact this step. */
	interface Touch {
		readonly ball: BallState
		readonly other: BallState | undefined
		readonly S: Mover
		readonly O: Mover
		readonly otherId: string
		readonly p: V
		readonly nx: number
		readonly ny: number
		readonly invN: number
		readonly invT: number
		readonly own: number
		readonly otherOwn: number
		/** This ball's permanent flat toward the contact, its squash share now, the other's share. */
		readonly dp: number
		readonly mine: number
		readonly otherShare: number
		readonly mu: number
		/** Closing speed now (before this step's forces), m/s. */
		readonly vc0: number
		/** A clay hit's stop (the depth its flat grows to), when this step is one. */
		stop: number | undefined
		/** The ball touches nothing else this step. */
		lone: boolean
		/** How long this contact has lasted (s): a resting one is damped. */
		age: number
		/** Its closing speed when it began (m/s). */
		vin: number
		J: number
		Jt: number
		F: number
	}
	/** Last step's impulses of each contact (a ball, what it touched, its direction in tenths of a radian), for the warm start. */
	const carried = new Map<string, { J: number; Jt: number; dt: number; age: number; vin: number; lone: boolean; elastic: number | undefined; a: string; b: string; p: V; nx: number; ny: number }>()
	const touchKey = (t: { ball: BallState; otherId: string; own: number }) => `${t.ball.solid}\u0000${t.otherId}\u0000${Math.round(t.own * 5)}`
	/** Clay hits planned last step, by ball: the direction (own frame) and the depth each was to come to rest at. */
	const planned = new Map<BallState, { own: number; stop: number }[]>()
	const gather = (ball: BallState, h: SolidHandle, otherId: string, dt: number, done: Set<string>, out: Touch[]) => {
		const o = ctx.solid(otherId)
		if (o === undefined) return
		const key = pairKey(ball.solid, otherId)
		if (done.has(key)) return
		done.add(key)
		const L = ball.law
		const c = h.pose()
		const other = ballOf.get(otherId)
		const m = meetOutline({ x: c.x, y: c.y }, o.outline())
		if (m === undefined) return
		// the direction from this ball's centre toward the contact, in its own frame, and how far the dented ball reaches there
		const own = wrap(Math.atan2(-m.ny, -m.nx) - c.angle)
		const reachHere = reach(L.R, ball.flats, own)
		const dTotal = L.R - m.s
		let dPlastic = L.R - reachHere
		// another soft ball: its own reach toward this one counts too (its flats), and the squash is shared by the two stiffnesses
		let otherOwn = 0
		let otherPl = 0
		if (other !== undefined) {
			otherOwn = wrap(Math.atan2(m.ny, m.nx) - o.pose().angle)
			otherPl = other.law.R - reach(other.law.R, other.flats, otherOwn)
			dPlastic += otherPl
		}
		const dElastic = dTotal - dPlastic
		const p = { x: m.px, y: m.py }
		const S = moverOf(ball.solid, h, dt)
		const O = moverOf(otherId, o, dt)
		const vc0 = -(along(S, p, m.nx, m.ny, true) - along(O, p, m.nx, m.ny, true))
		// (clay that something rests on: kept a hair's breadth apart too, so its stiff spring holds the weight steadily: CLAY_SKIN)
		if (!(dElastic > 0) && !(L.law === "clay" && other === undefined && dElastic > -CLAY_SKIN && vc0 <= CLAY_IMPACT)) return
		let mine = dElastic
		if (other !== undefined) {
			const k1 = L.law === "clay" ? L.kc : elasticForce(L, dElastic / 2).k
			const k2 = other.law.law === "clay" ? other.law.kc : elasticForce(other.law, dElastic / 2).k
			mine = (dElastic * k2) / (k1 + k2)
		}
		const invN = inverseAlong(S, p, m.nx, m.ny) + inverseAlong(O, p, m.nx, m.ny)
		if (!(invN > 0)) return
		const invT = inverseAlong(S, p, -m.ny, m.nx) + inverseAlong(O, p, -m.ny, m.nx)
		// planck's own rigid contact stays out while the squash is soft (past `hard` it holds as a stop)
		if (dElastic < L.hard) soft.add(key)
		out.push({
			ball, other, S, O, otherId, p, nx: m.nx, ny: m.ny, invN, invT, own, otherOwn, dp: L.R - reachHere, mine, otherShare: dElastic - mine,
			mu: engine?.meeting(ball.solid, otherId).friction ?? 0.5,
			vc0,
			stop: undefined, lone: true, age: 0, vin: 0, J: 0, Jt: 0, F: 0
		})
	}
	/** The normal impulse this contact alone would give this step, its own impulse left out of the velocities (u: separating, + apart). */
	const lawImpulse = (t: Touch, u: number, dt: number) => {
		const L = t.ball.law
		const meff = 1 / t.invN
		if (L.law === "clay" || t.other?.law.law === "clay") {
			const C = L.law === "clay" ? L : (t.other?.law as BallLaw)
			const dp = L.law === "clay" ? t.dp : 0
			const d = L.law === "clay" ? t.mine : t.otherShare
			const vc = -u
			const arrived = (planned.get(t.ball) ?? []).some((q) => Math.abs(wrap(q.own - t.own)) < 0.35 && dp + d >= q.stop - 0.0002)
			// (only a lone hit: a clay ball that touches nothing else. Pressed between two things, a weight landing on clay that rests on the table,
			// the elastic part and the flow cap below take it: the force, never more than the flow's, decides how far it flows)
			if (t.vc0 > CLAY_IMPACT && !arrived && t.other === undefined && t.lone) {
				// A hit: the clay stops it within a few thousandths of a second, faster than the step can follow, so the step spends the closing
				// energy ½·m·v² (v as it hit) on the flow exactly. Counted from where it flows (its flat, dp): it comes to rest at the depth δ* where
				// the flow's work p·π·[R·δ² − δ³/3] from dp equals that energy (Tabor's dent: the engine's law for clay balls). The step began d0 deep
				// already (it closed in between steps without the flow's work): past δ* it stops here; short of it by more than this step's travel it
				// goes on, slowed to the speed its energy left over allows; else the closing speed left carries it to δ* by the step's end (and the
				// next step it has arrived: it is held there, not hit again).
				const d0 = dp + d
				const travel = Math.max(0, vc) * dt
				const KE = 0.5 * meff * t.vc0 * t.vc0
				const work = (a: number, b: number) => C.flow * Math.PI * (C.R * (b * b - a * a) - (b * b * b - a * a * a) / 3)
				let stop: number
				let v1: number
				if (work(dp, d0) >= KE) {
					stop = d0
					v1 = 0
				} else if (work(dp, d0 + travel) < KE) {
					stop = d0 + travel
					v1 = Math.min(vc, Math.sqrt(Math.max(0, (2 * (KE - work(dp, stop))) / meff)))
				} else {
					let lo = d0
					let hi = d0 + travel
					for (let i = 0; i < 40; i++) {
						const mid = (lo + hi) / 2
						if (work(dp, mid) < KE) lo = mid
						else hi = mid
					}
					stop = (lo + hi) / 2
					v1 = (stop - d0) / dt
				}
				t.stop = Math.min(stop, 0.85 * C.R)
				t.F = C.flow * flatArea(C.R, t.stop)
				return Math.max(0, meff * (vc - v1))
			}
			t.stop = undefined
			// resting (or arrived): the elastic part, stiff and so solved implicitly, holds it, never pushing harder than the clay flows (the flow
			// force over the flat it has halfway through the step)
			const r = clayForce(C, dp + d, dp)
			t.F = r.F
			// (within the skin, d < 0: the spring's signed push, so the step closes the gap only as far as the load needs)
			const F0 = d < 0 ? r.k * d : r.F
			// (damped as clay is, heavily, for the heavier of the two: a 5 kg weight resting on a 177 g ball sits still on it, not ringing)
			const heavy = Math.max(meff, t.S.im > 0 ? 1 / t.S.im : 0, t.O.im > 0 ? 1 / t.O.im : 0)
			const D = dt * r.k + 2 * Math.sqrt(r.k * heavy) * dampingRatio(C.e)
			const J = (dt * (F0 - D * u)) / (1 + (dt * D) / meff)
			const cap = dt * C.flow * flatArea(C.R, dp + d - (dt / 2) * Math.min(0, u))
			return Math.max(0, Math.min(J, cap))
		}
		// Elastic: the law's force while it squashes (closing now), given back at e² of it as the squash eases (a hysteresis loop whose area is
		// the energy the bounce loses: it leaves at about e times the speed it came at, whatever the law); the share θ of its stiffness the step
		// cannot follow (ω·h past 1.2) solved implicitly; a contact that has rested a while (0.15 s) damped, so the ball settles. (A light ball's
		// touch can last only a few steps: what the step's integration then gains or loses is set right as it parts, `parting`.)
		const r = elasticForce(L, t.mine)
		const e = t.other !== undefined ? Math.min(L.e, t.other.law.e) : L.e
		const back = t.vc0 >= 0 ? 1 : e * e
		t.F = r.F * back
		const k = r.k * back
		const wh = Math.sqrt(k / meff) * dt
		const theta = wh <= 1.2 ? 0 : wh >= 2 ? 1 : (wh - 1.2) / 0.8
		const D = theta * dt * k + (t.age > 0.15 ? 2 * 0.5 * Math.sqrt(k * meff) : 0)
		return Math.max(0, (dt * (t.F - D * u)) / (1 + (dt * D) / meff))
	}
	/**
	 * A lone elastic bounce that has just parted (its contact gone this step, the two moving apart): it leaves at e times the speed it came in
	 * at, the material's measured restitution, whatever a few steps' integration of a short, stiff touch made of it (a 22 g foam ball's lasts
	 * four or five): the difference is given back (or taken) along the contact's line now.
	 */
	const parting = (dt: number, seen: Set<string>) => {
		for (const [key, c] of carried) {
			if (seen.has(key) || !c.lone || c.elastic === undefined || !(c.vin > CLAY_IMPACT)) continue
			const hA = ctx.solid(c.a)
			const hB = ctx.solid(c.b)
			if (hA === undefined || hB === undefined) continue
			const S = moverOf(c.a, hA, dt)
			const O = moverOf(c.b, hB, dt)
			const u = along(S, c.p, c.nx, c.ny, true) - along(O, c.p, c.nx, c.ny, true)
			if (!(u > 0)) continue
			const want = c.elastic * c.vin
			const dv = want - u
			if (Math.abs(dv) > 0.5 * c.vin) continue
			const inv = inverseAlong(S, c.p, c.nx, c.ny) + inverseAlong(O, c.p, c.nx, c.ny)
			if (!(inv > 0)) continue
			const J = dv / inv
			hA.push((J * c.nx) / dt, (J * c.ny) / dt, c.p)
			hB.push((-J * c.nx) / dt, (-J * c.ny) / dt, c.p)
		}
	}
	/** The soft contacts of this step: gathered, solved together (PASSES sweeps), pushed, and their flats and readings kept. */
	const softContacts = (dt: number) => {
		movers.clear()
		const touches: Touch[] = []
		const done = new Set<string>()
		for (const b of balls) {
			const h = ctx.solid(b.solid)
			if (h === undefined) continue
			for (const id of neighbours(b)) gather(b, h, id, dt, done, touches)
		}
		for (const t of touches) t.lone = !touches.some((q) => q !== t && (q.ball === t.ball || q.other === t.ball))
		// warm start: each contact begins with the impulses it took last step (scaled to this step), as planck's contacts do, so a stack (a weight
		// on clay on the table) holds at once instead of being worked out again every step
		for (const t of touches) {
			const prev = carried.get(touchKey(t))
			if (prev === undefined) {
				t.vin = Math.max(0, t.vc0)
				continue
			}
			t.age = prev.age + dt
			t.vin = prev.vin
			t.J = prev.J * (dt / prev.dt)
			t.Jt = prev.Jt * (dt / prev.dt)
			kick(t.S, t.p, t.J * t.nx - t.Jt * t.ny, t.J * t.ny + t.Jt * t.nx)
			kick(t.O, t.p, -(t.J * t.nx - t.Jt * t.ny), -(t.J * t.ny + t.Jt * t.nx))
		}
		// (one contact: 10 passes; several, solved together until they agree, at most 200 passes: a 177 g clay ball squeezed between a 5 kg
		// weight and the table couples its two stiff contacts so tightly that 10 passes leave the weight ringing on it)
		const PASSES = touches.length > 1 ? 200 : 10
		for (let pass = 0; pass < PASSES; pass++) {
			let change = 0
			let size = 0
			for (const t of touches) {
				const tx = -t.ny
				const ty = t.nx
				// normal: this contact's impulse given the others' (its own taken out of the velocities)
				const u = along(t.S, t.p, t.nx, t.ny) - along(t.O, t.p, t.nx, t.ny) - t.J * t.invN
				const J = lawImpulse(t, u, dt)
				const dJ = J - t.J
				t.J = J
				kick(t.S, t.p, dJ * t.nx, dJ * t.ny)
				kick(t.O, t.p, -dJ * t.nx, -dJ * t.ny)
				// friction: stop the contact point sliding, within μ·N
				if (t.invT > 0) {
					const vt = along(t.S, t.p, tx, ty) - along(t.O, t.p, tx, ty) - t.Jt * t.invT
					const cap = t.mu * t.J
					const Jt = Math.max(-cap, Math.min(cap, -vt / t.invT))
					const dJt = Jt - t.Jt
					t.Jt = Jt
					kick(t.S, t.p, dJt * tx, dJt * ty)
					kick(t.O, t.p, -dJt * tx, -dJt * ty)
					change = Math.max(change, Math.abs(dJt))
				}
				change = Math.max(change, Math.abs(dJ))
				size = Math.max(size, Math.abs(t.J), Math.abs(t.Jt))
			}
			if (touches.length > 1 && pass >= 9 && change <= 1e-7 * size) break
		}
		const plans = new Map<BallState, { own: number; stop: number }[]>()
		for (const t of touches) {
			const fx = (t.J * t.nx - t.Jt * t.ny) / dt
			const fy = (t.J * t.ny + t.Jt * t.nx) / dt
			if (Number.isFinite(fx) && Number.isFinite(fy)) {
				t.S.h?.push(fx, fy, t.p)
				t.O.h?.push(-fx, -fy, t.p)
			}
			const L = t.ball.law
			// clay's flats: a hit's stop (less its elastic part), or the flow of a resting load (the return mapping at its depth now)
			if (L.law === "clay") {
				if (t.stop !== undefined) {
					const flat = t.stop - (L.flow * flatArea(L.R, t.stop)) / L.kc
					if (flat > t.dp + 1e-9) addFlat(t.ball.flats, t.own, flat)
					plans.set(t.ball, [...(plans.get(t.ball) ?? []), { own: t.own, stop: t.stop }])
				} else {
					const r = clayForce(L, t.dp + t.mine, t.dp)
					if (r.dp > t.dp + 1e-9) addFlat(t.ball.flats, t.own, r.dp)
				}
			}
			const O = t.other
			if (O !== undefined && O.law.law === "clay" && t.otherShare > 0) {
				const odp = O.law.R - reach(O.law.R, O.flats, t.otherOwn)
				const r = clayForce(O.law, odp + t.otherShare, odp)
				if (r.dp > odp + 1e-9) addFlat(O.flats, t.otherOwn, r.dp)
			}
			// the readings and the picture: each ball's squash where it touches (its flat there and its share now)
			const squash = Math.max(0, t.mine) + t.dp
			t.ball.shape.push(t.own, squash)
			t.ball.squash = Math.max(t.ball.squash, squash)
			t.ball.force += t.J / dt
			t.ball.energy += L.law === "clay" ? 0 : elasticEnergy(L, Math.max(0, t.mine))
			if (O !== undefined) {
				const odp = O.law.R - reach(O.law.R, O.flats, t.otherOwn)
				O.shape.push(t.otherOwn, t.otherShare + odp)
				O.squash = Math.max(O.squash, t.otherShare + odp)
				O.force += t.J / dt
				O.energy += O.law.law === "clay" ? 0 : elasticEnergy(O.law, t.otherShare)
			}
		}
		planned.clear()
		for (const [k, v] of plans) planned.set(k, v)
		const seen = new Set(touches.map((t) => touchKey(t)))
		parting(dt, seen)
		carried.clear()
		for (const t of touches) {
			if (t.stop !== undefined) continue
			const L = t.ball.law
			const elastic = L.law !== "clay" && t.other?.law.law !== "clay" ? (t.other !== undefined ? Math.min(L.e, t.other.law.e) : L.e) : undefined
			carried.set(touchKey(t), { J: t.J, Jt: t.Jt, dt, age: t.age, vin: t.vin, lone: t.lone, elastic, a: t.ball.solid, b: t.otherId, p: t.p, nx: t.nx, ny: t.ny })
		}
	}

	// ---------------------------------------------------------------- bands (launchers) and motors (rubber-band cars)
	/** A launcher's band now: the pad's offset from the posts' line (dx, dy, r), each strand's length l and stretch λ. */
	const bandGeometry = (b: BandState) => {
		const pad = ctx.solid(b.pad)
		const p = pad?.pose() ?? { x: b.anchor.x, y: b.anchor.y, angle: 0 }
		const dx = p.x - b.anchor.x
		const dy = p.y - b.anchor.y
		const r = Math.sqrt(dx * dx + dy * dy)
		const half = b.spread / 2
		const l = Math.sqrt(r * r + half * half)
		return { pad, p, dx, dy, r, l, lam: l / b.l0 }
	}
	/** A band stretched to its breaking stretch snaps (natural rubber: about 6 × its length, machines/mod_softbody.py BAND_SNAP): an event,
	 *  and from then on it pulls nothing. -> whether it has snapped. */
	const snapCheck = (b: BandState, lam: number) => {
		if (b.broken || !(b.snap > 1) || !(lam >= b.snap)) return b.broken
		b.broken = true
		b.tension = 0
		ctx.event(`${b.item}'s rubber band snapped`, [b.item], "snap")
		return true
	}
	const bandStep = (b: BandState, dt: number) => {
		const { pad, dx, dy, r, l, lam } = bandGeometry(b)
		if (pad === undefined) return
		if (snapCheck(b, lam)) {
			b.tension = 0
			return
		}
		const shortening = l < b.last
		b.last = l
		const half = b.spread / 2
		/** The pull toward the posts (N) with the pad r from their line, as the band shortens or stretches. */
		const pullAt = (rr: number, easing: boolean) => {
			const ll = Math.sqrt(rr * rr + half * half)
			const F = rubberForce(b.area, b.E, b.lock, ll / b.l0) * (easing ? b.resilience : 1)
			return rr > 1e-9 ? (2 * b.n * F * rr) / ll : 0
		}
		b.tension = pullAt(r, shortening)
		if (!(b.tension > 0) || !pad.dynamic || !(r > 1e-9)) {
			b.vEnd = undefined
			return
		}
		const ux = -dx / r
		const uy = -dy / r
		// The band is stiff against a 2 g pouch (and what rides in it): four thick bands swing an empty pouch at ω·h ≈ 3, and the engine, which
		// moves a body by its speed at the step's end (x += v·h), would run away with it. So its pull is followed through the step in pieces
		// (ω·h/N ≤ 0.05), the pouch and its load moving together toward the posts (the band gives back `resilience` of its pull as it shortens;
		// past the posts' line it pulls back the other way), and the pouch is given the step's MEAN speed: it lands where the pieces put it. Its
		// speed at the step's end is kept for the next step, with whatever else changed its speed since (what it pushes, gravity) added on.
		let mass = pad.body().mass
		for (const id of ctx.touching(b.pad)) {
			const t = ctx.solid(id)
			if (t?.dynamic === true) mass += t.mass()
		}
		if (!(mass > 0)) return
		const v0 = pad.velocity()
		const vb = v0.x * ux + v0.y * uy
		let v = b.vEnd !== undefined ? vb + (b.vEnd - b.vBar) * (b.ux * ux + b.uy * uy) : vb
		// (the band's stiffness where it is stiffest this step: at this stretch, or at the posts' line)
		const stiff = (rr: number) => {
			const e = 1e-4
			const lo = Math.max(0, rr - e)
			return Math.abs(pullAt(rr + e, false) - pullAt(lo, false)) / (rr + e - lo)
		}
		const wh = Math.sqrt(Math.max(stiff(r), stiff(0)) / mass) * dt
		const N = Math.min(1024, Math.max(16, Math.ceil(wh / 0.05)))
		let rr = r
		const hs = dt / N
		for (let i = 0; i < N; i++) {
			// (along the line through the posts: rr > 0 is behind them; the pull always points back toward the line)
			const F = rr >= 0 ? pullAt(rr, v > 0) : -pullAt(-rr, v < 0)
			v += (F / mass) * hs
			rr -= v * hs
		}
		const mean = (r - rr) / dt
		const J = mass * (mean - vb)
		b.vEnd = v
		b.vBar = mean
		b.ux = ux
		b.uy = uy
		pad.push((J * ux) / dt, (J * uy) / dt)
	}
	/**
	 * The most torque a car's tyres pass to the ground before its drive wheel spins (N·m): μ·N·r, μ the friction of the wheel on what it
	 * touches, N its share of the car's weight (by the lever rule: the axles' places along the car about its centre of mass, the slope's
	 * cosine), r its radius. undefined while the wheel touches nothing (it spins free in the air: the engine shows that itself).
	 */
	const gripTorque = (m: MotorState, w: SolidHandle, c: SolidHandle) => {
		let mu = -1
		for (const id of ctx.touching(m.wheel)) {
			const o = ctx.solid(id)
			if (o === undefined || o.item === m.item) continue
			mu = Math.max(mu, engine?.meeting(m.wheel, id).friction ?? 0.5)
		}
		if (!(mu >= 0)) return undefined
		let M = 0
		let cx = 0
		let cy = 0
		for (const s of ctx.solidsOf(m.item)) {
			if (!s.dynamic) continue
			const q = s.pose()
			const ms = s.mass()
			M += ms
			cx += ms * q.x
			cy += ms * q.y
		}
		if (!(M > 0)) return undefined
		cx /= M
		cy /= M
		const a = c.pose().angle
		const ca = Math.cos(a)
		const sa = Math.sin(a)
		const along = (q: { x: number; y: number }) => (q.x - cx) * ca + (q.y - cy) * sa
		const f = m.front === undefined ? undefined : ctx.solid(m.front)
		const sr = along(w.pose())
		const sf = f === undefined ? -sr : along(f.pose())
		const share = Math.min(0.85, Math.max(0.15, Math.abs(sf - sr) > 1e-6 ? sf / (sf - sr) : 0.5))
		const r = w.outline().circle?.r ?? 0.017
		return mu * M * Math.max(0, g) * Math.max(0, ca) * share * r
	}
	const motorStep = (m: MotorState, dt: number) => {
		const w = ctx.solid(m.wheel)
		const c = ctx.solid(m.chassis)
		if (w === undefined || c === undefined || !(m.wound > 0)) {
			m.tension = 0
			return
		}
		// unwinding: the wheel turning the drive way against the body
		const turn = m.sense * (w.spin() - c.spin()) * dt
		m.wound = Math.max(0, m.wound - turn)
		const x = m.wound * m.r
		const lam = (m.l0 + x) / m.l0
		const ease = turn > 0 ? m.resilience : 1
		let T = m.n * rubberForce(m.area, m.E, m.lock, lam) * ease
		// a band that pulls harder than the tyres grip spins the wheels: the turns above what they hold unwind for nothing, at once (a real
		// spin-out lasts a few hundredths of a second), and the car drives on with the rest
		const grip = m.wound > 0 ? gripTorque(m, w, c) : undefined
		// (the engine finds what the wheels stand on in its first step: until then, nothing they could grip with, the band waits)
		const first = !m.began
		m.began = true
		if (first && grip === undefined) {
			m.tension = T
			return
		}
		if (grip !== undefined && T * m.r > grip) {
			const pull = (wd: number) => m.n * rubberForce(m.area, m.E, m.lock, (m.l0 + wd * m.r) / m.l0) * ease * m.r
			let lo = 0
			let hi = m.wound
			for (let i = 0; i < 48; i++) {
				const mid = (lo + hi) / 2
				if (pull(mid) > grip) hi = mid
				else lo = mid
			}
			const lost = (m.wound - lo) / (2 * Math.PI)
			m.wound = lo
			T = pull(lo) / m.r
			if (!m.spun) {
				m.spun = true
				ctx.event(`${m.item}'s wheels spin: its rubber band pulls harder than the tyres grip, and ${Math.round(lost * 10) / 10} turns unwind for nothing`, [m.item], "spin")
			}
		}
		m.tension = T
		if (!(m.wound > 0)) {
			m.tension = 0
			if (!m.unwound) {
				m.unwound = true
				ctx.event(`${m.item}'s rubber band unwound`, [m.item], "unwound")
			}
			return
		}
		const torque = m.sense * T * m.r
		w.twist(torque)
		c.twist(-torque)
	}

	// ---------------------------------------------------------------- beams
	const beamReadings = (b: BeamState) => {
		let energy = 0
		let set = 0
		for (const l of b.links) {
			const phi = l.link.broken ? 0 : l.link.bend()
			energy += 0.5 * l.link.k * phi * phi
			set = Math.max(set, Math.abs(l.link.set))
		}
		b.energy = energy
		b.set = set
		const last = ctx.solid(b.solids[b.solids.length - 1] as string)
		if (last === undefined) return
		const tip = world(last, b.tip)
		if (b.clamp !== undefined && b.base !== undefined && b.axis !== undefined) {
			const cl = ctx.solid(b.clamp)
			const base = world(cl, b.base)
			const q = cl?.pose()
			const ca = Math.cos(q?.angle ?? 0)
			const sa = Math.sin(q?.angle ?? 0)
			const ax = b.axis.x * ca - b.axis.y * sa
			const ay = b.axis.x * sa + b.axis.y * ca
			// (the clamp's line's normal, turned counter-clockwise from its axis when the beam runs right, clockwise when it runs left)
			const side = b.axis.x >= 0 ? 1 : -1
			const nx = -ay * side
			const ny = ax * side
			b.bend = -((tip.x - base.x) * nx + (tip.y - base.y) * ny)
			return
		}
		// a free beam: its middle's sag below the line through its two ends
		const first = ctx.solid(b.solids[0] as string)
		if (first === undefined) return
		const start = world(first, { x: -b.tip.x, y: b.tip.y })
		const ex = tip.x - start.x
		const ey = tip.y - start.y
		const len = Math.sqrt(ex * ex + ey * ey)
		if (!(len > 1e-9)) return
		// (the chord's normal, the one pointing up)
		const up = ex >= 0 ? 1 : -1
		const nx = (-ey / len) * up
		const ny = (ex / len) * up
		let sag = 0
		for (const id of b.solids) {
			const s = ctx.solid(id)
			if (s === undefined) continue
			const q = s.pose()
			const d = -((q.x - start.x) * nx + (q.y - start.y) * ny)
			if (Math.abs(d) > Math.abs(sag)) sag = d
		}
		b.bend = sag
	}
	const beamYield = (b: BeamState, dt: number) => {
		for (const l of b.links) {
			const L = l.link
			if (L.broken || !(L.k > 0)) continue
			// (the bending moment smoothed over 5 ms: a load's real moment, not one step's jolt as a body set down a little inside it is shoved out)
			l.mf += (L.k * L.bend() - l.mf) * Math.min(1, dt / 0.005)
			const M = l.mf
			if (b.ductile && Math.abs(M) > l.my) {
				// a plastic hinge: the bend past the plastic moment stays
				const d = (Math.sign(M) * (Math.abs(M) - l.my)) / L.k
				L.set += d
				l.mf -= L.k * d
			} else if (!b.ductile && Math.abs(M) > l.mu) {
				L.broken = true
				ctx.event(`${b.item} snapped`, [b.item], "snap")
			}
			void dt
		}
	}

	// ---------------------------------------------------------------- the process hooks
	const readings = () => {
		for (const b of balls) {
			ctx.set(b.item, "squash_mm", b.squash * 1000)
			ctx.set(b.item, "force_n", b.force)
			ctx.set(b.item, "energy_j", b.energy)
			if (b.law.law === "clay") {
				let deepest = 0
				for (const f of b.flats) deepest = Math.max(deepest, f.d)
				ctx.set(b.item, "dent_mm", deepest * 1000)
			}
			const shape: number[] = []
			for (const f of b.flats) shape.push(f.a, f.d)
			for (let i = 0; i + 1 < b.shape.length; i += 2) shape.push(b.shape[i] as number, b.shape[i + 1] as number)
			ctx.series(b.item, "shape", shape)
		}
		for (const b of beams) {
			beamReadings(b)
			ctx.set(b.item, "bend_mm", b.bend * 1000)
			ctx.set(b.item, "energy_j", b.energy)
			if (b.ductile) ctx.set(b.item, "set_deg", (b.set * 180) / Math.PI)
			// (broken: 1 once it has snapped, or creased 10° or more: the fracture module's `breaks` goal reads it)
			ctx.set(b.item, "broken", b.links.some((l) => l.link.broken) || b.set >= (10 * Math.PI) / 180 ? 1 : 0)
		}
		for (const b of bands) {
			const { r, l, lam } = bandGeometry(b)
			// (a band pulled past its breaking stretch snaps, the scene's start included: then it holds nothing)
			const gone = snapCheck(b, lam)
			b.stretch = gone ? 0 : Math.max(0, l - b.l0)
			// (before the release, and whenever the pad is still: the band's full pull; moving, what the last step gave)
			const still = !ctx.released()
			b.energy = gone ? 0 : 2 * b.n * rubberEnergy(b.area, b.E, b.lock, b.l0, lam)
			ctx.set(b.item, "stretch_cm", b.stretch * 100)
			ctx.set(b.item, "tension_n", gone ? 0 : still ? (r > 1e-9 ? (2 * b.n * rubberForce(b.area, b.E, b.lock, lam) * r) / l : 0) : b.tension)
			ctx.set(b.item, "energy_j", b.energy)
			ctx.set(b.item, "broken", gone ? 1 : 0)
		}
		for (const m of motors) {
			const x = m.wound * m.r
			ctx.set(m.item, "band_turns", m.wound / (2 * Math.PI))
			ctx.set(m.item, "band_stretch_cm", x * 100)
			ctx.set(m.item, "band_tension_n", m.tension)
			ctx.set(m.item, "band_energy_j", m.n * rubberEnergy(m.area, m.E, m.lock, m.l0, (m.l0 + x) / m.l0))
		}
		for (const s of springs) {
			const A = s.a === null ? undefined : ctx.solid(s.a)
			const B = s.b === null ? undefined : ctx.solid(s.b)
			const pa = world(A, s.anchorA)
			const pb = world(B, s.anchorB)
			const d = Math.sqrt((pb.x - pa.x) * (pb.x - pa.x) + (pb.y - pa.y) * (pb.y - pa.y))
			// (zeroed with its own platform resting on it: `tare`)
			const x = s.rest - d - s.tare
			ctx.set(s.item, "compression_mm", x * 1000)
			ctx.set(s.item, "force_n", s.k * x)
			ctx.set(s.item, "energy_j", 0.5 * s.k * x * x)
		}
	}
	return {
		/** Before each (sub-)step after the release: the soft contacts' and the rubber's forces, the bending links' shares. */
		force(dt: number) {
			soft.clear()
			for (const b of balls) {
				b.shape = []
				b.squash = 0
				b.force = 0
				b.energy = 0
			}
			if (balls.length > 0) softContacts(dt)
			for (const b of bands) bandStep(b, dt)
			for (const m of motors) motorStep(m, dt)
			for (const b of beams) {
				for (const l of b.links) {
					const a = l.link.prepare(dt)
					l.link.theta = a > 2 ? 1 - 2 / a : 0
				}
			}
		},
		after(dt: number) {
			for (const b of beams) beamYield(b, dt)
		},
		/** Planck's contact between a soft ball and what it squashes against is left out while the squash is soft. */
		contact(touch: Touch, phase: "begin" | "pre") {
			if (phase !== "pre" || balls.length === 0) return false
			const a = engine?.solidOf(touch.getFixtureA().getUserData())
			const b = engine?.solidOf(touch.getFixtureB().getUserData())
			if (a === undefined || b === undefined) return false
			if (!ballOf.has(a.id) && !ballOf.has(b.id)) return false
			if (soft.has(pairKey(a.id, b.id))) return true
			// a pair met this very step (its contact is new): soft unless it is already squashed past `hard`
			const ball = ballOf.get(a.id) ?? (ballOf.get(b.id) as BallState)
			const otherId = ball.solid === a.id ? b.id : a.id
			const h = ctx.solid(ball.solid)
			const o = ctx.solid(otherId)
			if (h === undefined || o === undefined) return false
			const c = h.pose()
			const m = meetOutline({ x: c.x, y: c.y }, o.outline())
			if (m === undefined) return false
			const own = wrap(Math.atan2(-m.ny, -m.nx) - c.angle)
			const dElastic = reach(ball.law.R, ball.flats, own) - m.s
			return dElastic < ball.law.hard
		},
		readings,
		/** For tests: the state. */
		state: () => ({ balls, beams, bands, motors, springs })
	}
}
