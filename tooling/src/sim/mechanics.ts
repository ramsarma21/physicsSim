import { type Body, type CircleShape, type Contact as Touch, Joint as PlanckJoint, PrismaticJoint, Settings, type TimeStep, Vec2, WeldJoint, type World } from "planck"
import type { EngineInternals, ProcessRecord } from "#sim/plugins.ts"

/**
 * The mechanics module's engine physics (engine4 module "mechanics"; its process kind is tooling/src/sim/modules/mechanics.ts): what the
 * force-and-motion lessons of grades 3-8 need beyond physics.ts's rigid bodies, springs, ropes, pins, wheels and pulleys. Everything here
 * acts only for a document's `mechanics` process records (machines/mod_mechanics.py builds them); without one, nothing of this file runs.
 *
 * Records ({kind: "mechanics", id, item, role, ...}; points on a solid in that solid's own frame, m; angles rad; forces N):
 *   start   {solid, vx, vy, w?}                     the solid's body moves so at the release (a kick, a launch, a car already moving)
 *   force   {solid, fx, fy, at?, frame?, from?, until?}  a steady force (frame "solid": turning with it, the default; "world"); from and until are
 *           seconds after the release, as every record's are
 *   gear    {a, b, na, nb, frame?, linear?}          meshed gears: na·Δθa + nb·Δθb = 0 (`GearLink`); `linear`: b is a rack sliding along it
 *   spool   {drum, b, center, radius, sense, anchorB, minLength?, slack?}   a rope wound on a drum (`SpoolRope`): a winch, a wheel and axle
 *   slider  {a, b, anchorA, anchorB, axis, friction?, lower?, upper?, speed?, force?, from?, until?}   b slides along a line (planck's prismatic
 *           joint): a straw on a string, a pusher's rod; Coulomb friction (N); limits (m from its start); a drive (m/s, at most force N)
 *   sticky  {solid, to: "moving" | "all"}            welds to the first solid of another item it touches (velcro, clay)
 *   arc     {solid, center, radius, side, from, to, loop?: {id, p0, p1}}   a track piece whose surface is a true arc for round bodies (`ArcTouch`)
 *   loop    {center (world), radius, entry, sense}   a loop's way round (its arcs' `loop.id` is this record's id)
 *   balloon {solid, diameter, rest, pressure, nozzle, direction, at?, cd?, from?}   a balloon rocket's jet, size and carried air
 *   fragile {solid, stiffness, force, soft}          breaks (and stops, a splat) when a strike's peak force v·√(k_eff·m) passes `force` N: k_eff the
 *           series stiffness of its shell (`stiffness`, N/m) and what it strikes (rigid, or a soft material's E·A/t over a 2 x 2 cm patch,
 *           its E in `soft` by material name) [EGG]; readings broken (0/1) and peak (the hardest strike so far, N)
 *   unbuoy  {solid, volume}                          the air's lift on `volume` m³ taken back (while there is air): physics.ts buoys a solid by its
 *           whole outline's volume, but a basket (a coffee filter) or a canopy is a thin shell whose air moves with it: only its material displaces air
 *   forces  {item, solids}                           force arrows' numbers (the catalog-wide `arrows`): every force on the item's moving bodies from
 *           outside it, by kind (FORCE_KINDS: gravity, support, push, friction, tension, spring, air, buoyancy, magnetic, applied, and their sum
 *           net), each the mean over its last FORCE_WINDOW s, readings f_<kind>_x / f_<kind>_y (N, world), where the contact and joint kinds act
 *           (f_<kind>_px / _py, m) and its centre of mass (f_cx, f_cy); an item held by two or more ropes or springs also has each one's own
 *           (f_tension1_x ... f_tension<n>_py, f_spring1_x ...: a tug of war's two pulls, not only their sum). Display only: nothing here pushes anything
 *   energy  {item, solids}                           energy bars' numbers (`show_energy`, an `energy-bars` board): e_kinetic ½·M·v² + ½·I·ω², e_potential
 *           M·g·y (y of each body's centre of mass above the floor, y = 0), e_spring ½·k·x² of the engine's springs on its bodies (J); e_heat
 *           what has left the motion since the release (friction, impacts, drag, damping: "heat and sound"), e_added what has come into it (a
 *           motor, a push, a falling weight on a string: the net, so at most one of the two is above 0): start + added = kinetic + potential +
 *           spring + heat, exactly, every step. The step's velocities are those of its middle (planck's semi-implicit Euler), so the heights and
 *           stretches are paired with them as the step's mean (½·(y₀ + y₁), ½·k·x₀·x₁): with that the bookkeeping conserves exactly what the
 *           engine does (a free fall to the bit, a pendulum in a vacuum to its hinge's own error), not the step's O(h) swing in ½mv² + mgy
 *   meter   {item, reads, key?, a?, b?, solid?}      a lab sensor's reading of `item` (track.state[item][key]), averaged over its last 0.1 s
 *           (SENSOR_WINDOW): reads "rope" the pull of the rope joining solids a and b (a spool's cord, a doc pulley's string: a force meter in
 *           it, N; key "newtons"); "motion" the solid's speed along its own x axis (m/s, + forward; key "speed") and how fast that changes
 *           (m/s², key "accel"): a smart cart's encoder; "rise" how far the solid has risen since the start (m; key "lift")
 * Readings (track.state[item]): a balloon's volume (m³) and thrust (N); the meters' readings.
 *
 * Determinism: only + − × ÷, Math.sqrt/abs/min/max and the engine's Math.sin/cos/atan2/exp/hypot/pow (tools/fdlibm.ts, tools/crpow.ts);
 * joints are made in the records' order and arc touches in the bodies' and fixtures' order (planck's lists), the same every run.
 */

/** physics.ts's LENGTH_SCALE: planck units per metre (EngineInternals.lengthScale says it; checked at the start). */
const LENGTH_SCALE = 10
/** Air at room temperature, kg/m³ (physics.ts's AIR_DENSITY). */
const AIR = 1.2

type V = { readonly x: number; readonly y: number }

const solving = (body: Body) =>
	body as unknown as { c_velocity: { v: Vec2; w: number }; c_position: { c: Vec2; a: number }; m_invMass: number; m_invI: number }

/** A body's working position of a point fixed in it (planck units), and its arm from the centre of mass (physics.ts's workingPoint). */
const working = (body: Body, local: Vec2) => {
	if (body.isStatic()) {
		const p = body.getWorldPoint(local)
		const c = body.getWorldCenter()
		return { r: new Vec2(p.x - c.x, p.y - c.y), p }
	}
	const at = solving(body).c_position
	const centre = body.getLocalCenter()
	const c = Math.cos(at.a)
	const s = Math.sin(at.a)
	const x = local.x - centre.x
	const y = local.y - centre.y
	const r = new Vec2(c * x - s * y, s * x + c * y)
	return { r, p: new Vec2(at.c.x + r.x, at.c.y + r.y) }
}

// ------------------------------------------------------------------------------------------------------------------------------
/**
 * Meshed gears: two solids hinged to the same frame (the world, or a moving solid) turn together, n_a·ω_a + n_b·ω_b = 0 relative to
 * the frame (an external mesh turns them opposite ways; the speed ratio is n_a/n_b, the torque ratio its inverse). The tooth forces
 * at the mesh are internal: what one gear gives the other, the frame takes back as a couple (its reaction n_a + n_b). Solved as
 * planck's own gear joint is (a velocity constraint with a full position correction of the angle relation), between the bodies'
 * angular velocities only: a gear is hinged at its own centre, where its hinge holds it. A rack (or the nut of a screw) has `linear`:
 * its speed along the axis takes the place of the second gear's turning (n_b metres per radian).
 */
export class GearLink extends PlanckJoint {
	private readonly na: number
	private readonly nb: number
	private readonly frame: Body | undefined
	private readonly axis: Vec2 | undefined
	private readonly c0: number
	private impulse = 0
	private mass = 0
	constructor(A: Body, B: Body, frame: Body | undefined, na: number, nb: number, axis: Vec2 | undefined) {
		super({ collideConnected: false }, A, B)
		;(this as unknown as { m_type: string }).m_type = "gear-link"
		this.na = na
		this.nb = nb
		this.frame = frame !== undefined && frame.isDynamic() ? frame : undefined
		this.axis = axis
		this.c0 = this.position(A.getAngle(), B.getAngle(), B.getWorldCenter(), this.frame?.getAngle() ?? 0)
	}
	private position(aA: number, aB: number, cB: Vec2, aF: number) {
		const second = this.axis === undefined ? this.nb * (aB - aF) : (this.nb * (cB.x * this.axis.x + cB.y * this.axis.y)) / LENGTH_SCALE
		return this.na * (aA - aF) + second
	}
	private effective() {
		const A = solving(this.m_bodyA)
		const B = solving(this.m_bodyB)
		const F = this.frame === undefined ? undefined : solving(this.frame)
		const kB = this.axis === undefined ? this.nb * this.nb * B.m_invI : ((this.nb * this.nb) / (LENGTH_SCALE * LENGTH_SCALE)) * B.m_invMass
		const kF = F === undefined ? 0 : (this.na + (this.axis === undefined ? this.nb : 0)) ** 2 * F.m_invI
		const k = this.na * this.na * A.m_invI + kB + kF
		return k > 0 ? 1 / k : 0
	}
	private apply(j: number) {
		const A = solving(this.m_bodyA)
		const B = solving(this.m_bodyB)
		A.c_velocity.w += A.m_invI * this.na * j
		if (this.axis === undefined) B.c_velocity.w += B.m_invI * this.nb * j
		else {
			B.c_velocity.v.x += (B.m_invMass * this.nb * j * this.axis.x) / LENGTH_SCALE
			B.c_velocity.v.y += (B.m_invMass * this.nb * j * this.axis.y) / LENGTH_SCALE
		}
		if (this.frame !== undefined) {
			const F = solving(this.frame)
			F.c_velocity.w -= F.m_invI * (this.na + (this.axis === undefined ? this.nb : 0)) * j
		}
	}
	initVelocityConstraints(step: TimeStep) {
		this.mass = this.effective()
		if (step.warmStarting) {
			this.impulse *= step.dtRatio
			this.apply(this.impulse)
		} else this.impulse = 0
	}
	private rate() {
		const A = solving(this.m_bodyA)
		const B = solving(this.m_bodyB)
		const wF = this.frame === undefined ? 0 : solving(this.frame).c_velocity.w
		const second = this.axis === undefined ? this.nb * (B.c_velocity.w - wF) : (this.nb * (B.c_velocity.v.x * this.axis.x + B.c_velocity.v.y * this.axis.y)) / LENGTH_SCALE
		return this.na * (A.c_velocity.w - wF) + second
	}
	solveVelocityConstraints(_step: TimeStep) {
		const j = -this.mass * this.rate()
		this.impulse += j
		this.apply(j)
	}
	solvePositionConstraints(_step: TimeStep) {
		const A = solving(this.m_bodyA)
		const B = solving(this.m_bodyB)
		const aF = this.frame === undefined ? 0 : solving(this.frame).c_position.a
		const C = this.position(A.c_position.a, B.c_position.a, B.c_position.c, aF) - this.c0
		const m = this.effective()
		const j = -m * C
		A.c_position.a += A.m_invI * this.na * j
		if (this.axis === undefined) B.c_position.a += B.m_invI * this.nb * j
		else {
			B.c_position.c.x += (B.m_invMass * this.nb * j * this.axis.x) / LENGTH_SCALE
			B.c_position.c.y += (B.m_invMass * this.nb * j * this.axis.y) / LENGTH_SCALE
		}
		if (this.frame !== undefined) {
			const F = solving(this.frame)
			F.c_position.a -= F.m_invI * (this.na + (this.axis === undefined ? this.nb : 0)) * j
		}
		return Math.abs(C) < Settings.linearSlop
	}
	getAnchorA() {
		return this.m_bodyA.getWorldCenter()
	}
	getAnchorB() {
		return this.m_bodyB.getWorldCenter()
	}
	getReactionForce(_inv_dt: number) {
		return new Vec2(0, 0)
	}
	getReactionTorque(inv_dt: number) {
		return this.impulse * this.nb * inv_dt
	}
}

// ------------------------------------------------------------------------------------------------------------------------------
/**
 * A rope wound on a drum (a winch, the axle and the wheel of a wheel and axle): the rope leaves the drum at the tangent point T on
 * the side its `sense` says and runs straight to its end P on body B. Its length is the free run |P − T| plus what is wound: turning
 * the drum the winding way by Δθ takes r·Δθ in. With ℓ = √(d² − r²) the free run (d = |P − O|, O the axis) and β the angle of T,
 * L = ℓ + σ·r·(θ_drum − β) + const, and dL/dt = u·(v_P − v_O) + σ·r·ω_drum, u the unit vector from T to P (the geometric terms
 * cancel: T slides along the rope). The rope only pulls (L never more than it starts at, plus any slack); its end jams at the drum
 * (ℓ never under `minLength`). Solved like physics.ts's pulley rope: a one-sided velocity constraint on where the step will leave the
 * rope, its impulse kept within the step, then a position correction of what is left over.
 */
export class SpoolRope extends PlanckJoint {
	private readonly center: Vec2
	private readonly radius: number
	private readonly sense: number
	private readonly lb: Vec2
	private readonly total: number
	private readonly least: number
	private rope = 0
	private jam = 0
	private readonly g = { u: new Vec2(0, 1), e: new Vec2(0, 1), rO: new Vec2(0, 0), rB: new Vec2(0, 0), ell: 0, d: 0, beta: 0, L: 0, k: 0, kj: 0 }
	private turns = 0
	private lastBeta = 0
	constructor(drum: Body, B: Body, center: Vec2, radius: number, sense: number, lb: Vec2, least: number, slack: number) {
		super({ collideConnected: false }, drum, B)
		;(this as unknown as { m_type: string }).m_type = "spool-rope"
		this.center = center
		this.radius = radius
		this.sense = sense
		this.lb = lb
		this.least = least
		const g = this.measure(false)
		this.lastBeta = g.beta
		this.total = g.L + slack
	}
	/** The rope as the step has it now (`solving`: the bodies' working positions; else their poses). */
	private measure(inStep: boolean) {
		const A = this.m_bodyA
		const B = this.m_bodyB
		const o = inStep ? working(A, this.center) : { p: A.getWorldPoint(this.center), r: Vec2.sub(A.getWorldPoint(this.center), A.getWorldCenter()) }
		const p = inStep ? working(B, this.lb) : { p: B.getWorldPoint(this.lb), r: Vec2.sub(B.getWorldPoint(this.lb), B.getWorldCenter()) }
		const g = this.g
		const dx = p.p.x - o.p.x
		const dy = p.p.y - o.p.y
		const d = Math.sqrt(dx * dx + dy * dy)
		const r = this.radius
		g.d = d
		g.rO = o.r
		g.rB = p.r
		if (d <= r * 1.000001) {
			g.ell = 0
			g.k = 0
			g.kj = 0
			return g
		}
		const ex = dx / d
		const ey = dy / d
		g.e = new Vec2(ex, ey)
		const ell = Math.sqrt(d * d - r * r)
		g.ell = ell
		// u = (ℓ·ê − σ·r·ê⊥)/d, ê⊥ = (−e_y, e_x)
		g.u = new Vec2((ell * ex + this.sense * r * ey) / d, (ell * ey - this.sense * r * ex) / d)
		// (acos(r/d) as atan2(ℓ, r): the engine's deterministic functions only)
		let beta = Math.atan2(ey, ex) + this.sense * Math.atan2(ell, r)
		// (unwrapped against the last, so the wound length is continuous however the rope swings round)
		while (beta - this.lastBeta > Math.PI) beta -= 2 * Math.PI
		while (beta - this.lastBeta < -Math.PI) beta += 2 * Math.PI
		g.beta = beta
		const theta = inStep ? solving(A).c_position.a : A.getAngle()
		g.L = ell + this.sense * r * (theta - beta)
		const sa = solving(A)
		const sb = solving(B)
		const crB = g.rB.x * g.u.y - g.rB.y * g.u.x
		const turnA = this.sense * r - (g.rO.x * g.u.y - g.rO.y * g.u.x)
		g.k = sb.m_invMass + sb.m_invI * crB * crB + sa.m_invMass + sa.m_invI * turnA * turnA
		// the jam: ℓ along ê (dℓ/dt = (d/ℓ)·ê·(v_P − v_O))
		const s = d / ell
		const cjB = g.rB.x * ey - g.rB.y * ex
		const cjO = g.rO.x * ey - g.rO.y * ex
		g.kj = s * s * (sb.m_invMass + sb.m_invI * cjB * cjB + sa.m_invMass + sa.m_invI * cjO * cjO)
		return g
	}
	/** Its free length, m (for a reading). */
	freeLength() {
		return this.measure(false).ell / LENGTH_SCALE
	}
	initVelocityConstraints(_step: TimeStep) {
		this.measure(true)
		this.rope = 0
		this.jam = 0
	}
	/** dL/dt now, planck units: u·(v_P − v_O) + σ·r·ω_drum. */
	private rate() {
		const g = this.g
		const A = solving(this.m_bodyA)
		const B = solving(this.m_bodyB)
		const vpx = B.c_velocity.v.x - B.c_velocity.w * g.rB.y
		const vpy = B.c_velocity.v.y + B.c_velocity.w * g.rB.x
		const vox = A.c_velocity.v.x - A.c_velocity.w * g.rO.y
		const voy = A.c_velocity.v.y + A.c_velocity.w * g.rO.x
		return g.u.x * (vpx - vox) + g.u.y * (vpy - voy) + this.sense * this.radius * A.c_velocity.w
	}
	/** An impulse j along the rope's gradient: +j lengthens it (B away from T, the drum unwinding). */
	private apply(j: number) {
		const g = this.g
		const A = solving(this.m_bodyA)
		const B = solving(this.m_bodyB)
		B.c_velocity.v.x += B.m_invMass * j * g.u.x
		B.c_velocity.v.y += B.m_invMass * j * g.u.y
		B.c_velocity.w += B.m_invI * j * (g.rB.x * g.u.y - g.rB.y * g.u.x)
		A.c_velocity.v.x -= A.m_invMass * j * g.u.x
		A.c_velocity.v.y -= A.m_invMass * j * g.u.y
		A.c_velocity.w += A.m_invI * j * (this.sense * this.radius - (g.rO.x * g.u.y - g.rO.y * g.u.x))
	}
	private applyJam(j: number) {
		// +j pushes P away from O along ê (and O the other way)
		const g = this.g
		const A = solving(this.m_bodyA)
		const B = solving(this.m_bodyB)
		const s = g.d / g.ell
		B.c_velocity.v.x += B.m_invMass * j * s * g.e.x
		B.c_velocity.v.y += B.m_invMass * j * s * g.e.y
		B.c_velocity.w += B.m_invI * j * s * (g.rB.x * g.e.y - g.rB.y * g.e.x)
		A.c_velocity.v.x -= A.m_invMass * j * s * g.e.x
		A.c_velocity.v.y -= A.m_invMass * j * s * g.e.y
		A.c_velocity.w -= A.m_invI * j * s * (g.rO.x * g.e.y - g.rO.y * g.e.x)
	}
	solveVelocityConstraints(step: TimeStep) {
		const g = this.g
		if (g.k <= 0) return
		const h = step.dt
		if (g.kj > 0 && this.least > 0) {
			const A = solving(this.m_bodyA)
			const B = solving(this.m_bodyB)
			const vpx = B.c_velocity.v.x - B.c_velocity.w * g.rB.y
			const vpy = B.c_velocity.v.y + B.c_velocity.w * g.rB.x
			const vox = A.c_velocity.v.x - A.c_velocity.w * g.rO.y
			const voy = A.c_velocity.v.y + A.c_velocity.w * g.rO.x
			const rate = (g.d / g.ell) * (g.e.x * (vpx - vox) + g.e.y * (vpy - voy))
			// ℓ + h·rate ≥ least: a push only (j ≥ 0)
			const short = this.least * LENGTH_SCALE - g.ell
			const need = (Math.max(0, short) > 0 ? 0 : short / h) - rate
			const jn = Math.max(0, this.jam + need / g.kj) - this.jam
			this.jam += jn
			this.applyJam(jn)
		}
		// L + h·dL/dt ≤ total: a pull only (j ≤ 0); a slack rope may close its slack within the step
		const over = this.rate() + Math.min(0, g.L - this.total) / h
		const j = Math.min(0, this.rope - over / g.k) - this.rope
		this.rope += j
		this.apply(j)
	}
	solvePositionConstraints(_step: TimeStep) {
		const g = this.measure(true)
		if (g.k <= 0) return true
		const A = solving(this.m_bodyA)
		const B = solving(this.m_bodyB)
		const C = g.L - this.total
		if (C > 0) {
			const j = -Math.min(C, Settings.maxLinearCorrection) / g.k
			B.c_position.c.x += B.m_invMass * j * g.u.x
			B.c_position.c.y += B.m_invMass * j * g.u.y
			B.c_position.a += B.m_invI * j * (g.rB.x * g.u.y - g.rB.y * g.u.x)
			A.c_position.c.x -= A.m_invMass * j * g.u.x
			A.c_position.c.y -= A.m_invMass * j * g.u.y
			A.c_position.a += A.m_invI * j * (this.sense * this.radius - (g.rO.x * g.u.y - g.rO.y * g.u.x))
		}
		this.lastBeta = g.beta
		return C < Settings.linearSlop
	}
	getAnchorA() {
		return this.m_bodyA.getWorldPoint(this.center)
	}
	getAnchorB() {
		return this.m_bodyB.getWorldPoint(this.lb)
	}
	getReactionForce(inv_dt: number) {
		return Vec2.mul(-this.rope * inv_dt, this.g.u)
	}
	/** The force its last solve put on its pulled body B or its drum (planck units): the rope's pull and its jam's push. */
	forceOn(body: Body, inv_dt: number) {
		const g = this.g
		const s = g.ell > 0 ? g.d / g.ell : 0
		const fx = (this.rope * g.u.x + this.jam * s * g.e.x) * inv_dt
		const fy = (this.rope * g.u.y + this.jam * s * g.e.y) * inv_dt
		if (body === this.m_bodyB) return new Vec2(fx, fy)
		if (body === this.m_bodyA) return new Vec2(-fx, -fy)
		return undefined
	}
	getReactionTorque(_inv_dt: number) {
		return 0
	}
}

// ------------------------------------------------------------------------------------------------------------------------------
/** Mooney-Rivlin's ratio for a party balloon's latex (the C2/C1 of its strain energy): Merritt & Weinhaus fit about 0.1, i.e. k = 10. */
const MOONEY_K = 10
/**
 * The jet's contraction: air leaving through a short sharp-edged neck narrows to about 0.62 of its bore (a sharp orifice's contraction
 * coefficient, the C_d of ISO 5167-2 orifice plates 0.60-0.62), so the thrust is 2·C_c·Δp·A and the flow C_c·A·v.
 */
const JET_CONTRACTION = 0.62
/**
 * An empty balloon's drag: the slack rubber trails as a sleeve about twice its own diameter long, broadside C_d ≈ 1.2 (a flapping flag's
 * 1.0-1.5 [HOE] on its length × its diameter), the floor under its drag while it shrinks.
 */
const LIMP_DRAG = 1.2

/**
 * A rubber balloon's over-pressure against its stretch λ = r/r₀ (r₀ its unstretched radius): Δp ∝ (1/λ − 1/λ⁷)(1 + λ²/k), the thin
 * Mooney-Rivlin sphere of Merritt & Weinhaus ("The pressure curve for a rubber balloon", Am. J. Phys. 46, 976 (1978)): it rises to a
 * peak at λ ≈ 1.38, stays within about 15 % of it as the balloon grows to several times its size, and falls to nothing as the
 * rubber goes slack (λ → 1). Scaled so that Δp at the blown-up size is the item's `pressure`.
 */
export const balloonPressure = (lambda: number, lambdaFull: number, pressure: number) => {
	const shape = (l: number) => (l <= 1 ? 0 : (1 / l - 1 / Math.pow(l, 7)) * (1 + (l * l) / MOONEY_K))
	const full = shape(lambdaFull)
	return full > 0 ? (pressure * shape(lambda)) / full : 0
}

/** A balloon rocket's state through the run (`mechanicsFor`): what is left of its air. */
interface Balloon {
	readonly body: Body
	readonly at: Vec2
	readonly direction: Vec2
	readonly rest: number
	readonly full: number
	readonly pressure: number
	readonly area: number
	readonly cd: number
	readonly from: number
	readonly mass: number
	readonly item: string | undefined
	volume: number
}

/**
 * A balloon rocket's jet: the air leaves the nozzle (area A) at v = √(2Δp/ρ) (Bernoulli), so the thrust is ρ·A·v² = 2Δp·A and the
 * balloon empties at Q = A·v, Δp following its rubber's stretch (`balloonPressure`) until the rubber is slack (its own size: what is
 * left is air at the room's pressure). Its air drag ½ρ·C_d·πr²·|v|·v on its size now, and the inertia of the air it carries (inside it
 * ρV and, round it, the added mass ½ρV, White's sphere), which weighs nothing in air (its buoyancy holds it): the body (its rubber, the
 * straw and the tape) is pushed with thrust and drag scaled by m/(m + 1.5ρV) and lifted by (1 − m/(m + 1.5ρV))·m·g, so it moves as a
 * body of m + 1.5ρV under them and its own weight. In a vacuum it would burst: the scene's air off leaves it as it is (no jet).
 */
export const balloonStep = (b: { rest: number; full: number; pressure: number; area: number }, volume: number, h: number) => {
	const r0 = b.rest / 2
	const v0 = (4 / 3) * Math.PI * r0 * r0 * r0
	if (volume <= v0) return { volume: v0, thrust: 0, radius: r0, pressure: 0 }
	// (the drag area while it shrinks never under the slack sleeve's: `LIMP_DRAG`)
	const lambda = Math.pow(volume / v0, 1 / 3)
	const p = balloonPressure(lambda, b.full / b.rest, b.pressure)
	const jet = Math.sqrt((2 * p) / AIR)
	const left = Math.max(v0, volume - JET_CONTRACTION * b.area * jet * h)
	return { volume: left, thrust: 2 * JET_CONTRACTION * p * b.area, radius: r0 * lambda, pressure: p }
}

// ------------------------------------------------------------------------------------------------------------------------------
/** One true circular arc of a track (the pieces that share its circle), in planck units and world angles. */
interface Arc {
	readonly key: string
	/** the item whose track this arc is */
	readonly item: string
	readonly O: Vec2
	readonly R: number
	readonly side: "in" | "out"
	/** each piece's span (world angles, counter-clockwise), its solid and the contact values a round body meets on it */
	readonly spans: { from: number; to: number; solid: string }[]
	loop: { readonly id: string; readonly p0: number; readonly p1: number } | undefined
}

/** The angle φ within [from, from + span] (counter-clockwise), with a margin either side. */
const withinSpan = (phi: number, from: number, to: number, margin: number) => {
	let span = to - from
	while (span < 0) span += 2 * Math.PI
	let d = phi - (from - margin)
	while (d < 0) d += 2 * Math.PI
	while (d >= 2 * Math.PI) d -= 2 * Math.PI
	return d <= span + 2 * margin
}

/** How a round body meets an arc piece: the pair's friction, restitution and rolling resistance (physics.ts's contact of their materials). */
export interface Meeting {
	readonly friction: number
	readonly restitution: number
	readonly rolling: number
}

/** m (planck units ÷ LENGTH_SCALE): the gap Box2D keeps a round body resting on a polygon (its 1 mm skin less its 0.5 mm slop), kept on an arc too so a ball meets a straight piece and an arc at one height. */
const REST_GAP = 0.0005

/**
 * A round body on a true arc (`arcs`): a contact that is the circle's, not its polygon pieces' (whose flat faces would turn a rolling
 * ball by a kink at every joint, an inelastic knock that took 15 % of a loop's energy). The body's centre is kept on the circle of
 * radius ρ = R ∓ (r + REST_GAP) about the arc's centre O: inside for a valley or a loop, outside for a hump. As physics.ts's hinges keep a
 * swing's energy, the push is solved on where the step will LEAVE the centre, its path's bend included: moving straight at the tangential
 * speed v_t for the step h, a centre on the circle ends √(ρ² + (v_t·h)²) − ρ ≈ v_t²·h/(2ρ) off it, so the push asks for that much speed
 * toward the circle (planck's contacts ask for none, and so lose (v_t·h/ρ)² of the speed each step to the turn). A gap closes at most
 * as far as it is within the step (it lands, as a speculative contact does), a strike faster than VELOCITY_THRESHOLD rebounds with the
 * pair's restitution, friction holds the contact point within μ times the push (Coulomb), and the rolling resistance C_rr·N·r slows its
 * spin against the track (physics.ts's rule for a ball on a floor, here all round the arc). One constraint per body and arc, joined to
 * the ground body (it is fixed), colliding with everything else as before.
 */
export class ArcTouch extends PlanckJoint {
	readonly notHinge = true
	private readonly ball: Body
	private readonly radius: number
	private readonly local: Vec2
	readonly arc: Arc
	private meeting: Meeting
	private readonly meet: (solid: string) => Meeting
	private readonly gate: () => boolean
	private readonly onHit: (solid: string, speed: number) => void
	private active = false
	/** Whether the round body rode the arc in the last (sub-)step (its constraint pressed or held it within the slop). */
	touching = false
	private normal = 0
	private rub = 0
	private roll = 0
	private bias = 0
	private readonly s = { u: new Vec2(0, 1), t: new Vec2(1, 0), r: new Vec2(0, 0), kn: 0, kt: 0, ki: 0, rho: 0, solid: "" }
	constructor(ball: Body, ground: Body, radius: number, local: Vec2, arc: Arc, meet: (solid: string) => Meeting, gate: () => boolean, onHit: (solid: string, speed: number) => void) {
		super({ collideConnected: true }, ball, ground)
		;(this as unknown as { m_type: string }).m_type = "arc-touch"
		this.ball = ball
		this.radius = radius
		this.local = local
		this.arc = arc
		this.meet = meet
		this.meeting = { friction: 0, restitution: 0, rolling: 0 }
		this.gate = gate
		this.onHit = onHit
	}
	/** The circle's centre in the world now (planck units): the step's working position, or the body's pose. */
	private centre(inStep: boolean) {
		return inStep ? working(this.ball, this.local) : { p: this.ball.getWorldPoint(this.local), r: Vec2.sub(this.ball.getWorldPoint(this.local), this.ball.getWorldCenter()) }
	}
	/** Where the round body is against the arc: on the arc's span, its distance d from O, ρ, and the gap (≥ 0: clear of the track). */
	private where(inStep: boolean) {
		const c = this.centre(inStep)
		const a = this.arc
		const dx = c.p.x - a.O.x
		const dy = c.p.y - a.O.y
		const d = Math.sqrt(dx * dx + dy * dy)
		const inside = a.side === "in"
		const rho = inside ? a.R - this.radius - REST_GAP * LENGTH_SCALE : a.R + this.radius + REST_GAP * LENGTH_SCALE
		const phi = Math.atan2(dy, dx)
		const piece = a.spans.find((s) => withinSpan(phi, s.from, s.to, a.loop === undefined ? 1e-9 : 0))
		return { c, dx, dy, d, rho, gap: inside ? rho - d : d - rho, piece, inside }
	}
	/** Whether the body is on this arc's span, on its working side, within reach (the step's margin), and its loop lets it touch. */
	reach(margin: number) {
		const w = this.where(false)
		if (w.piece === undefined || !(w.d > 0)) return false
		// the back of a valley is never this arc's (the polygon pieces meet it); a ball inside a hump's circle is not on it
		if (w.inside ? w.d > this.arc.R : w.d < this.arc.R) return false
		return w.gap < margin && this.gate()
	}
	initVelocityConstraints(step: TimeStep) {
		const w = this.where(true)
		const was = this.touching
		this.active = w.piece !== undefined && w.d > 0 && (w.inside ? w.d <= this.arc.R : w.d >= this.arc.R) && this.gate() && w.gap < ARC_REACH
		this.touching = this.active && w.gap <= Settings.linearSlop
		if (!this.active || w.piece === undefined) {
			this.normal = 0
			this.rub = 0
			this.roll = 0
			return
		}
		const s = this.s
		if (s.solid !== w.piece.solid) {
			s.solid = w.piece.solid
			this.meeting = this.meet(w.piece.solid)
		}
		const ex = w.dx / w.d
		const ey = w.dy / w.d
		// u: the push's direction (away from the track: toward O inside a valley, away from it on a hump); t across it
		const u = w.inside ? new Vec2(-ex, -ey) : new Vec2(ex, ey)
		s.u = u
		s.t = new Vec2(-u.y, u.x)
		s.rho = w.rho
		// the contact point on the round body's surface, toward the track, and its arm from the body's centre of mass
		s.r = new Vec2(w.c.r.x - this.radius * u.x, w.c.r.y - this.radius * u.y)
		const B = solving(this.ball)
		const crn = s.r.x * u.y - s.r.y * u.x
		const crt = s.r.x * s.t.y - s.r.y * s.t.x
		s.kn = B.m_invMass + B.m_invI * crn * crn
		s.kt = B.m_invMass + B.m_invI * crt * crt
		s.ki = B.m_invI
		const h = step.dt
		const v = B.c_velocity.v
		// the centre's speed across u (its path's bend over the step is a target held through the solve)
		const vt = v.x * s.t.x + v.y * s.t.y
		const vu = v.x * u.x + v.y * u.y
		const reach = Math.max(0, w.rho * w.rho - vt * h * (vt * h))
		// the push along u that bends its path round the circle over the step (as if it were on it), less the gap it may still close; a body a
		// hair inside the track is put back by the position pass, never by a push (a push there adds energy: a ball rolling up onto a hump's arc
		// from the slope's polygon, 0.5 mm in, was thrown 0.24 m/s outward)
		const bend = w.inside ? (w.rho - Math.sqrt(reach)) / h : (Math.sqrt(reach) - w.rho) / h
		this.bias = bend - Math.max(0, w.gap) / h
		// a strike: a new touch closing faster than physics.ts's VELOCITY_THRESHOLD rebounds with the pair's restitution
		const approach = -(vu - (w.inside ? (w.d - w.rho) / h : (w.rho - w.d) / h))
		if (!was && w.gap <= Settings.linearSlop + Math.max(0, -vu) * h && -vu > VELOCITY_THRESHOLD * LENGTH_SCALE) {
			this.bias = Math.max(this.bias, this.meeting.restitution * -vu)
			this.onHit(w.piece.solid, Math.round((-vu / LENGTH_SCALE) * 1000) / 1000)
			this.touching = true
		}
		void approach
		// warm start: what pressed it last step, carried (planck's contacts carry theirs)
		if (step.warmStarting && was && this.touching) {
			this.normal *= step.dtRatio
			this.rub *= step.dtRatio
			this.roll *= step.dtRatio
			this.push(this.normal, this.rub, this.roll)
		} else {
			this.normal = 0
			this.rub = 0
			this.roll = 0
		}
	}
	/** Impulses on the round body: n along u, f across it (both at the contact point), and a twist q. */
	private push(n: number, f: number, q: number) {
		const B = solving(this.ball)
		const s = this.s
		const px = n * s.u.x + f * s.t.x
		const py = n * s.u.y + f * s.t.y
		B.c_velocity.v.x += B.m_invMass * px
		B.c_velocity.v.y += B.m_invMass * py
		B.c_velocity.w += B.m_invI * (s.r.x * py - s.r.y * px) + B.m_invI * q
	}
	solveVelocityConstraints(_step: TimeStep) {
		if (!this.active) return
		const B = solving(this.ball)
		const s = this.s
		const pointVelocity = () => {
			const v = B.c_velocity.v
			const w = B.c_velocity.w
			return { x: v.x - w * s.r.y, y: v.y + w * s.r.x }
		}
		// rolling resistance, then friction, each within what the push pressed with (as planck's contacts order friction first)
		if (this.meeting.rolling > 0 && s.ki > 0) {
			const most = this.meeting.rolling * this.normal * this.radius
			const roll = Math.max(-most, Math.min(most, this.roll - B.c_velocity.w / s.ki))
			this.push(0, 0, roll - this.roll)
			this.roll = roll
		}
		if (s.kt > 0) {
			const pv = pointVelocity()
			const slip = pv.x * s.t.x + pv.y * s.t.y
			const most = this.meeting.friction * this.normal
			const rub = Math.max(-most, Math.min(most, this.rub - slip / s.kt))
			this.push(0, rub - this.rub, 0)
			this.rub = rub
		}
		if (s.kn > 0) {
			const pv = pointVelocity()
			const vu = pv.x * s.u.x + pv.y * s.u.y
			const normal = Math.max(0, this.normal + (this.bias - vu) / s.kn)
			this.push(normal - this.normal, 0, 0)
			this.normal = normal
		}
	}
	solvePositionConstraints(_step: TimeStep) {
		if (!this.active) return true
		const w = this.where(true)
		const over = -w.gap
		if (over <= Settings.linearSlop || !(w.d > 0)) return true
		const ex = w.dx / w.d
		const ey = w.dy / w.d
		const u = w.inside ? new Vec2(-ex, -ey) : new Vec2(ex, ey)
		const B = solving(this.ball)
		const r = new Vec2(w.c.r.x - this.radius * u.x, w.c.r.y - this.radius * u.y)
		const cr = r.x * u.y - r.y * u.x
		const k = B.m_invMass + B.m_invI * cr * cr
		if (!(k > 0)) return true
		const j = Math.min(Settings.maxLinearCorrection, 0.2 * (over - Settings.linearSlop)) / k
		B.c_position.c.x += B.m_invMass * j * u.x
		B.c_position.c.y += B.m_invMass * j * u.y
		B.c_position.a += B.m_invI * j * cr
		return over < 3 * Settings.linearSlop
	}
	/** The force the track pressed with in the last step (N), for readings and arrows. */
	pressedWith(inv_dt: number) {
		return (this.normal * inv_dt) / LENGTH_SCALE
	}
	/** Its push (along the track's normal) and its friction (across it) on the round body in the last solve (N, world), and where (m), or undefined. */
	parts(inv_dt: number) {
		if (!this.active || (this.normal === 0 && this.rub === 0)) return undefined
		const s = this.s
		const c = this.ball.getWorldCenter()
		const k = inv_dt / LENGTH_SCALE
		return {
			nx: this.normal * s.u.x * k,
			ny: this.normal * s.u.y * k,
			fx: this.rub * s.t.x * k,
			fy: this.rub * s.t.y * k,
			px: (c.x + s.r.x) / LENGTH_SCALE,
			py: (c.y + s.r.y) / LENGTH_SCALE
		}
	}
	getAnchorA() {
		return this.ball.getWorldPoint(this.local)
	}
	getAnchorB() {
		return this.arc.O
	}
	getReactionForce(inv_dt: number) {
		return new Vec2((this.normal * this.s.u.x + this.rub * this.s.t.x) * inv_dt, (this.normal * this.s.u.y + this.rub * this.s.t.y) * inv_dt)
	}
	getReactionTorque(_inv_dt: number) {
		return 0
	}
}

/** m²: the patch of a soft surface a fragile thing presses on as it strikes (a 2 x 2 cm patch: an egg's end) [EGG]. */
const SOFT_PATCH = 4e-4
/** physics.ts's VELOCITY_THRESHOLD, m/s: a slower approach is a touch, not a strike. */
const VELOCITY_THRESHOLD = 0.2
/** planck units: how near an arc a round body is taken into its constraint (a speculative margin, as physics.ts's chains' 5 cm). */
const ARC_REACH = 0.05 * LENGTH_SCALE


/** A number field of a record, or a default. */
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d)
const str = (v: unknown) => (typeof v === "string" ? v : undefined)
const vec = (v: unknown, d: V = { x: 0, y: 0 }): V =>
	typeof v === "object" && v !== null && Number.isFinite((v as V).x) && Number.isFinite((v as V).y) ? { x: (v as V).x, y: (v as V).y } : d

/** The roles a mechanics record may have. */
export const MECHANICS_ROLES = ["start", "force", "gear", "spool", "slider", "sticky", "arc", "loop", "balloon", "unbuoy", "fragile", "meter", "forces", "energy"] as const
/**
 * The kinds of force an item's arrows show, in this order (`net` last: the sum of the others). Contacts: `support` where what it touches pushes it
 * within 60° of straight up (a table under a book, a ramp under a car), `push` any other way (a wall, a paddle, a hand, a collision), `friction`
 * along the surface. Joints: `tension` (ropes, strings, cords on drums, a pulley's string), `spring` (the engine's springs), `support` (a pin, a
 * hinge, a weld, an axle, a slider's rail). The air: `air` (drag: resistance against its motion, or a fan's wind), `buoyancy` (the air's and a
 * liquid's lift: the liquids module's pushes). `magnetic` (the magnetism module's), `gravity` (m·g; a planet's pull, the space module's),
 * `applied` (a module's or this module's own steady forces: a balloon's jet, a force record, a motor's push).
 */
export const FORCE_KINDS = ["gravity", "support", "push", "friction", "tension", "spring", "air", "buoyancy", "magnetic", "applied", "net"] as const
type ForceKind = (typeof FORCE_KINDS)[number]
/** The kinds that act at the contacts or joints (their readings say where: f_<kind>_px, _py); the others act at the centre of mass. */
export const PLACED_KINDS: readonly ForceKind[] = ["support", "push", "friction", "tension", "spring"]
/**
 * What another module's pushes show as (ProcessContext.forces' `by`: its process kind; a report's own kind when it is one of FORCE_KINDS): a
 * liquid's and a hull's push is buoyancy (and the water's drag), a sail's the wind's (air), the magnets' and an electromagnet's coil magnetic,
 * a planet's pull gravity; water poured or jetting, sand, a cushion's give and a press are pushes; anything else applied.
 */
const PUSHES_AS: Record<string, ForceKind> = { liquid: "buoyancy", hull: "buoyancy", sail: "air", air: "air", magnetism: "magnetic", coil: "magnetic", "space-body": "gravity", point: "gravity", heat: "push" }
const pushesAs = (by: string): ForceKind => PUSHES_AS[by] ?? (/^(flow|sand|fracture)/.test(by) ? "push" : "applied")
/** The window force arrows average over, s: one 60 fps frame (8 steps of 480 Hz), so a resting book's contact jitter and a collision's few steps show as the frame's mean force. */
export const FORCE_WINDOW = 1 / 60
/** What a meter record may read (its `reads`). */
export const METER_READS = ["rope", "motion", "rise"] as const
/**
 * A lab sensor's averaging window, s: its reading is the mean over the last 0.1 s (a force sensor or a smart cart sampled at 10-50 Hz and
 * smoothed, as lab software shows it: PASCO force sensors sample up to 1 kHz and their apps average), so it is steady over the solver's
 * step-to-step jitter. A motion meter's acceleration is the change of its speed over the same window.
 */
export const SENSOR_WINDOW = 0.1

/** Why a mechanics record cannot run, or undefined (admitDocument refuses the document with the reason). */
export const mechanicsProblem = (r: ProcessRecord, solids: ReadonlySet<string>): string | undefined => {
	const role = r.role
	if (typeof role !== "string" || !(MECHANICS_ROLES as readonly string[]).includes(role)) return `role must be one of ${MECHANICS_ROLES.join(", ")} (it is ${String(role)})`
	const needs: Record<string, readonly string[]> = {
		start: ["solid"],
		force: ["solid"],
		gear: ["a", "b"],
		spool: ["drum"],
		slider: ["b"],
		sticky: ["solid"],
		arc: ["solid"],
		loop: [],
		balloon: ["solid"],
		unbuoy: ["solid"],
		fragile: ["solid"],
		meter: r.reads === "rope" ? ["a", "b"] : ["solid"],
		forces: [],
		energy: []
	}
	for (const key of needs[role] ?? []) if (typeof r[key] !== "string" || !solids.has(r[key] as string)) return `its ${key} "${String(r[key])}" is not a solid of the document`
	for (const key of ["a", "b"]) if (r[key] !== undefined && r[key] !== null && (role === "spool" || role === "slider") && (typeof r[key] !== "string" || !solids.has(r[key] as string))) return `its ${key} "${String(r[key])}" is not a solid of the document`
	for (const [key, v] of Object.entries(r)) if (typeof v === "number" && !Number.isFinite(v)) return `${key} is not a finite number`
	if (role === "gear" && !(num(r.na, 0) > 0 && num(r.nb, 0) > 0)) return "a gear pair needs na and nb above 0"
	if (role === "spool" && !(num(r.radius, 0) > 0)) return "a spool needs a radius above 0"
	if (role === "arc" && !(num(r.radius, 0) > 0)) return "an arc needs a radius above 0"
	if (role === "loop" && !(num(r.radius, 0) > 0)) return "a loop needs a radius above 0"
	if (role === "balloon" && !(num(r.diameter, 0) > num(r.rest, 0) && num(r.rest, 0) > 0 && num(r.nozzle, 0) > 0)) return "a balloon needs diameter > rest > 0 and a nozzle above 0"
	if (role === "meter" && !(METER_READS as readonly string[]).includes(String(r.reads))) return `a meter reads one of ${METER_READS.join(", ")} (it is ${String(r.reads)})`
	if (role === "meter" && typeof r.item !== "string") return "a meter needs the item whose reading it sets"
	if (role === "forces" || role === "energy") {
		if (typeof r.item !== "string" || r.item === "") return `a ${role} record needs the item whose readings it sets`
		if (!Array.isArray(r.solids) || r.solids.length === 0 || r.solids.length > 64) return `a ${role} record needs its item's solids (1 to 64)`
		for (const id of r.solids) if (typeof id !== "string" || !solids.has(id)) return `its solid "${String(id)}" is not a solid of the document`
	}
	return undefined
}

/** What the runtime needs from its process context: the engine's internals, the run's settings, readings. */
export interface MechanicsContext {
	readonly engine: EngineInternals
	readonly gravity: number
	readonly air: boolean
	readonly release: number
	set(item: string, key: string, value: number): void
	event(text: string, items: readonly string[], kind?: string): void
	/** A solid's material (its base name: "foam", not "foam [1a2b3c]") and its body, or undefined. */
	solidInfo(id: string): { readonly material: string; readonly body: { readonly kind: string; readonly radius?: number; readonly height?: number; readonly points?: readonly V[] } } | undefined
	/** An item's name as the scene gives it (for events). */
	nameOf(item: string): string
	/** A solid's own mass now, kg (density × volume: what it weighs, without the air it carries); 0 for one that is not a solid of the run. */
	massOf?(id: string): number
	/** The forces other processes pushed with (or reported) this (sub-)step (ProcessContext.forces). */
	forces?(): readonly { readonly solid: string; readonly kind: string; readonly by: string; readonly fx: number; readonly fy: number; readonly at?: V }[]
}

/**
 * The module's runtime for one run, built from every mechanics record of the document once its bodies and joints are made: the joints
 * it makes (gears, spools, sliders), and its hooks, which the first mechanics process calls at physics.ts's fixed places (plugins.ts).
 */
export const mechanicsRun = (records: readonly ProcessRecord[], ctx: MechanicsContext) => {
	const E = ctx.engine
	if (E.lengthScale !== LENGTH_SCALE) throw new Error(`mechanics: the engine's length scale is ${E.lengthScale}, this module's ${LENGTH_SCALE}`)
	const world = E.world as World
	const ground = E.bodyOf(null) as Body
	const bodyOf = (id: string | null) => E.bodyOf(id) as Body | undefined
	const anchorOn = (id: string | null, p: V) => E.anchorOn(id, p) as Vec2
	const directionOn = (id: string | null, d: V) => E.directionOn(id, d) as Vec2
	const of = (role: string) => records.filter((r) => r.role === role)

	// gears
	for (const g of of("gear")) {
		const A = bodyOf(g.a as string)
		const B = bodyOf(g.b as string)
		if (A === undefined || B === undefined || A === B) continue
		const frameId = str(g.frame)
		const F = frameId === undefined ? undefined : bodyOf(frameId)
		const lin = g.linear === undefined ? undefined : vec(g.linear)
		const n = lin === undefined ? 0 : Math.sqrt(lin.x * lin.x + lin.y * lin.y)
		world.createJoint(new GearLink(A, B, F, num(g.na, 1), num(g.nb, 1), lin === undefined || !(n > 0) ? undefined : new Vec2(lin.x / n, lin.y / n)))
	}
	// spools
	const spools: { id: string; item: string | undefined; joint: SpoolRope }[] = []
	for (const s of of("spool")) {
		const drumId = s.drum as string
		const drum = bodyOf(drumId)
		const bId = str(s.b) ?? null
		const B = bId === null ? ground : bodyOf(bId)
		if (drum === undefined || B === undefined || drum === B) continue
		const joint = world.createJoint(
			new SpoolRope(drum, B, anchorOn(drumId, vec(s.center)), num(s.radius, 0.01) * LENGTH_SCALE, num(s.sense, 1) < 0 ? -1 : 1, anchorOn(bId, vec(s.anchorB)), num(s.minLength, 0), num(s.slack, 0) * LENGTH_SCALE)
		) as SpoolRope
		spools.push({ id: s.id, item: str(s.item), joint })
	}
	// sliders (planck's prismatic joint: a line, limits, and a drive, or Coulomb friction as a drive held at rest)
	const drives: { joint: PrismaticJoint; speed: number; force: number; friction: number; from: number; until: number }[] = []
	for (const s of of("slider")) {
		const aId = str(s.a) ?? null
		const A = aId === null ? ground : bodyOf(aId)
		const B = bodyOf(s.b as string)
		if (A === undefined || B === undefined || A === B) continue
		const anchor = A.getWorldPoint(anchorOn(aId, vec(s.anchorA)))
		const axis = A.getWorldVector(directionOn(aId, vec(s.axis, { x: 1, y: 0 })))
		const n = Math.sqrt(axis.x * axis.x + axis.y * axis.y)
		if (!(n > 0)) continue
		const lower = s.lower === undefined ? undefined : num(s.lower, 0)
		const upper = s.upper === undefined ? undefined : num(s.upper, 0)
		const friction = Math.max(0, num(s.friction, 0)) * LENGTH_SCALE
		const joint = world.createJoint(
			new PrismaticJoint(
				{
					enableLimit: lower !== undefined || upper !== undefined,
					lowerTranslation: (lower ?? -1000) * LENGTH_SCALE,
					upperTranslation: (upper ?? 1000) * LENGTH_SCALE,
					enableMotor: friction > 0,
					maxMotorForce: friction,
					motorSpeed: 0
				},
				A,
				B,
				anchor,
				new Vec2(axis.x / n, axis.y / n)
			)
		) as PrismaticJoint
		if (s.speed !== undefined && s.force !== undefined)
			drives.push({ joint, speed: num(s.speed, 0) * LENGTH_SCALE, force: Math.max(0, num(s.force, 0)) * LENGTH_SCALE, friction, from: ctx.release + num(s.from, 0), until: ctx.release + num(s.until, Number.POSITIVE_INFINITY) })
	}
	// starts, forces, balloons
	const starts = of("start").flatMap((s) => {
		const body = bodyOf(s.solid as string)
		return body === undefined || !body.isDynamic() ? [] : [{ body, v: new Vec2(num(s.vx, 0) * LENGTH_SCALE, num(s.vy, 0) * LENGTH_SCALE), w: s.w === undefined ? undefined : num(s.w, 0) }]
	})
	const forces = of("force").flatMap((f) => {
		const id = f.solid as string
		const body = bodyOf(id)
		if (body === undefined || !body.isDynamic()) return []
		const F = { x: num(f.fx, 0), y: num(f.fy, 0) }
		return [{ body, at: anchorOn(id, vec(f.at)), local: f.frame === "world" ? undefined : directionOn(id, F), world: new Vec2(F.x, F.y), from: ctx.release + num(f.from, 0), until: ctx.release + num(f.until, Number.POSITIVE_INFINITY) }]
	})
	const balloons: Balloon[] = of("balloon").flatMap((b) => {
		const id = b.solid as string
		const body = bodyOf(id)
		if (body === undefined || !body.isDynamic()) return []
		const r = num(b.diameter, 0.25) / 2
		const dir = num(b.direction, Math.PI)
		return [
			{
				body,
				at: anchorOn(id, vec(b.at)),
				direction: directionOn(id, { x: Math.cos(dir), y: Math.sin(dir) }),
				rest: num(b.rest, 0.06),
				full: num(b.diameter, 0.25),
				pressure: num(b.pressure, 3000),
				area: (Math.PI * num(b.nozzle, 0.01) * num(b.nozzle, 0.01)) / 4,
				cd: num(b.cd, 0.47),
				from: ctx.release + num(b.from, 0),
				mass: body.getMass(),
				item: str(b.item),
				volume: (4 / 3) * Math.PI * r * r * r
			}
		]
	})
	const unbuoys = of("unbuoy").flatMap((u) => {
		const id = u.solid as string
		const body = bodyOf(id)
		return body === undefined || !body.isDynamic() || !(num(u.volume, 0) > 0) ? [] : [{ body, at: anchorOn(id, { x: 0, y: 0 }), lift: AIR * ctx.gravity * num(u.volume, 0) }]
	})
	// fragile solids (an egg): the hardest strike so far, and whether it broke (then it stops where it is: `after`)
	const fragile = new Map(
		of("fragile").flatMap((f) => {
			const id = f.solid as string
			const body = bodyOf(id)
			if (body === undefined || !body.isDynamic()) return []
			const soft = typeof f.soft === "object" && f.soft !== null ? (f.soft as Record<string, unknown>) : {}
			return [[id, { body, item: str(f.item) ?? id, k: num(f.stiffness, 1.2e5), force: num(f.force, 35), soft, peak: 0, broken: false, frozen: false }] as const]
		})
	)
	const thickness = (b: { kind: string; radius?: number; height?: number; points?: readonly V[] }) => {
		if (b.kind === "ball") return 2 * (b.radius ?? 0)
		if (b.kind === "slab") return b.height ?? 0
		const ys = (b.points ?? []).map((p) => p.y)
		return ys.length ? Math.max(...ys) - Math.min(...ys) : 0
	}
	/** A strike on a fragile solid: its peak force v·√(k_eff·m) (k_eff its shell's and the other's stiffness in series). */
	const strikeFragile = (touch: Touch, mine: string, other: string, body: Body) => {
		const f = fragile.get(mine)
		if (f === undefined || f.broken) return
		const wm = touch.getWorldManifold(null)
		if (wm === null || wm === undefined || wm.pointCount === 0) return
		let v = 0
		for (let i = 0; i < wm.pointCount; i++) {
			const p = wm.points[i] as Vec2
			const va = touch.getFixtureA().getBody().getLinearVelocityFromWorldPoint(p)
			const vb = touch.getFixtureB().getBody().getLinearVelocityFromWorldPoint(p)
			v = Math.max(v, -((vb.x - va.x) * wm.normal.x + (vb.y - va.y) * wm.normal.y) / LENGTH_SCALE)
		}
		if (!(v > 0)) return
		const info = ctx.solidInfo(other)
		const E = info === undefined ? undefined : f.soft[info.material]
		const t = info === undefined ? 0 : thickness(info.body)
		const ks = typeof E === "number" && E > 0 && t > 0 ? (E * SOFT_PATCH) / t : Number.POSITIVE_INFINITY
		const k = ks === Number.POSITIVE_INFINITY ? f.k : 1 / (1 / f.k + 1 / ks)
		const force = v * Math.sqrt(k * body.getMass())
		if (force > f.peak) {
			f.peak = force
			ctx.set(f.item, "peak", force)
		}
		if (force > f.force) {
			f.broken = true
			ctx.set(f.item, "broken", 1)
			ctx.event(`${ctx.nameOf(f.item)} breaks (a ${force.toFixed(0)} N hit)`, [f.item], "breaks")
		}
	}
	// sticky solids: each welds once, to the first solid of another item it touches (moving ones only, or anything)
	const stickyOf = new Map<string, "moving" | "all">(of("sticky").map((s) => [s.solid as string, s.to === "all" ? "all" : "moving"]))
	const stuck = new Set<string>()
	const welds: { a: Body; b: Body; at: Vec2 }[] = []

	// arcs (grouped by their circle) and loops
	const arcOf = new Map<string, Arc>()
	const arcList: Arc[] = []
	for (const a of of("arc")) {
		const solid = a.solid as string
		const pose = E.startPose(solid)
		const c = Math.cos(pose.angle)
		const s = Math.sin(pose.angle)
		const ctr = vec(a.center)
		const O = new Vec2((pose.at.x + ctr.x * c - ctr.y * s) * LENGTH_SCALE, (pose.at.y + ctr.x * s + ctr.y * c) * LENGTH_SCALE)
		const radius = num(a.radius, 0.1)
		const side = a.side === "out" ? "out" : "in"
		const loop = typeof a.loop === "object" && a.loop !== null ? (a.loop as { id: unknown; p0: unknown; p1: unknown }) : undefined
		const loopId = loop === undefined ? "" : String(loop.id)
		const key = `${O.x.toFixed(6)}|${O.y.toFixed(6)}|${radius}|${side}|${loopId}`
		let arc = arcList.find((x) => x.key === key)
		if (arc === undefined) {
			arc = { key, item: solid.slice(0, Math.max(0, solid.indexOf("/"))), O, R: radius * LENGTH_SCALE, side, spans: [], loop: loop === undefined ? undefined : { id: loopId, p0: num(loop.p0, 0), p1: num(loop.p1, 2 * Math.PI) } }
			arcList.push(arc)
		} else if (loop !== undefined && arc.loop !== undefined) {
			arc.loop = { id: arc.loop.id, p0: Math.min(arc.loop.p0, num(loop.p0, 0)), p1: Math.max(arc.loop.p1, num(loop.p1, 2 * Math.PI)) }
		}
		arc.spans.push({ from: num(a.from, 0) + pose.angle, to: num(a.to, 0) + pose.angle, solid })
		arcOf.set(solid, arc)
	}
	const loops = of("loop").map((l) => {
		const c = vec(l.center)
		return { id: l.id, O: new Vec2(c.x * LENGTH_SCALE, c.y * LENGTH_SCALE), R: num(l.radius, 0.2) * LENGTH_SCALE, entry: num(l.entry, -Math.PI / 2), sense: num(l.sense, 1) < 0 ? -1 : 1, progress: new Map<Body, { p: number; last: number }>() }
	})
	const loopById = new Map(loops.map((l) => [l.id, l]))
	/** Where a body is on its way round a loop now, radians from the entry (−: not in yet; over 2π: through). */
	const progressOf = (loopId: string, body: Body) => loopById.get(loopId)?.progress.get(body)?.p
	const trackLoops = () => {
		for (const loop of loops) {
			for (let b = world.getBodyList(); b !== null; b = b.getNext()) {
				if (!b.isDynamic()) continue
				const c = b.getWorldCenter()
				const dx = c.x - loop.O.x
				const dy = c.y - loop.O.y
				const dist = Math.sqrt(dx * dx + dy * dy)
				const had = loop.progress.get(b)
				if (had === undefined && dist > loop.R * 1.6 + 2 * LENGTH_SCALE) continue
				// the angle from the entry direction, the loop's way round
				let a = loop.sense * (Math.atan2(dy, dx) - loop.entry)
				while (a > Math.PI) a -= 2 * Math.PI
				while (a <= -Math.PI) a += 2 * Math.PI
				if (had === undefined) {
					// first seen: behind the entry it is coming in; ahead of it outside the circle it has been round (it leaves); inside, it is on its way
					loop.progress.set(b, { p: a <= 0 ? (dist <= loop.R ? a + 2 * Math.PI : a) : dist <= loop.R ? a : a + 2 * Math.PI, last: a })
					continue
				}
				let d = a - had.last
				while (d > Math.PI) d -= 2 * Math.PI
				while (d <= -Math.PI) d += 2 * Math.PI
				had.p += d
				had.last = a
			}
		}
	}
	/** Whether a loop's arc may touch this body now (its way round within the arc's own range), or any arc not on a loop. */
	const loopLets = (arc: Arc, body: Body) => {
		if (arc.loop === undefined) return true
		const p = progressOf(arc.loop.id, body)
		return p !== undefined && p >= arc.loop.p0 && p <= arc.loop.p1
	}
	/** Each round fixture's touch of each arc it is near (made and dropped before each (sub-)step, as physics.ts's chain touches are). */
	const touches = new Map<string, ArcTouch>()
	const fixtureKey = new Map<unknown, number>()
	const keyOf = (f: unknown) => {
		let k = fixtureKey.get(f)
		if (k === undefined) {
			k = fixtureKey.size
			fixtureKey.set(f, k)
		}
		return k
	}
	const arcTouches = () => {
		if (arcList.length === 0) return
		for (let b = world.getBodyList(); b !== null; b = b.getNext()) {
			if (!b.isDynamic()) continue
			for (let f = b.getFixtureList(); f !== null; f = f.getNext()) {
				if (f.getType() !== "circle" || f.isSensor()) continue
				const circle = f.getShape() as CircleShape
				const ball = E.solidOf(f.getUserData())
				if (ball === undefined) continue
				for (const arc of arcList) {
					const k = `${keyOf(f)}|${arc.key}`
					let t = touches.get(k)
					if (t === undefined) {
						const c = b.getWorldPoint(circle.getCenter())
						const d = Math.sqrt((c.x - arc.O.x) * (c.x - arc.O.x) + (c.y - arc.O.y) * (c.y - arc.O.y))
						const gap = arc.side === "in" ? arc.R - circle.getRadius() - d : d - arc.R - circle.getRadius()
						if (gap > 3 * ARC_REACH || gap < -arc.R) continue
						const body = b
						t = new ArcTouch(
							b,
							ground,
							circle.getRadius(),
							circle.getCenter(),
							arc,
							(solid) => E.meeting(ball.id, solid),
							() => loopLets(arc, body),
							(solid, speed) => E.hit(ball.id, solid, speed)
						)
						if (!t.reach(ARC_REACH)) continue
						world.createJoint(t)
						touches.set(k, t)
					} else if (!t.reach(ARC_REACH * 2)) {
						world.destroyJoint(t)
						touches.delete(k)
					}
				}
			}
		}
	}
	/** The items whose track a body rides now (one of their arcs holds it). */
	const ridingOf = (body: Body) => {
		let out: Set<string> | undefined
		for (const t of touches.values()) if (t.touching && t.getBodyA() === body) (out ??= new Set()).add(t.arc.item)
		return out
	}
	/**
	 * Whether a planck contact is an arc's: a round body on an arc piece's working side is the arc's (`ArcTouch`); a loop's piece passes what is not on
	 * it; and a round body riding one of a track's arcs meets the track's other pieces (the straight run an arc hands it to) without a strike: the
	 * contact sits out while the arc holds it, and takes the body over, already touching, when the arc ends (a strike there would be the polygon's skin
	 * met a step early, a ball bounced off a joint the track does not have).
	 */
	const passes = (touch: Touch) => {
		if (arcOf.size === 0) return false
		if (touches.size > 0) {
			const fa = touch.getFixtureA()
			const fb = touch.getFixtureB()
			for (const [round, other] of [
				[fa, fb],
				[fb, fa]
			] as const) {
				if (round.getType() !== "circle" || !round.getBody().isDynamic()) continue
				const so = E.solidOf(other.getUserData())
				if (so === undefined || so.kind !== "static") continue
				if (ridingOf(round.getBody())?.has(so.item)) return true
			}
		}
		const fa = touch.getFixtureA()
		const fb = touch.getFixtureB()
		const sa = E.solidOf(fa.getUserData())
		const sb = E.solidOf(fb.getUserData())
		const arcA = sa === undefined ? undefined : arcOf.get(sa.id)
		const arc = arcA ?? (sb === undefined ? undefined : arcOf.get(sb.id))
		if (arc === undefined) return false
		const other = arcA !== undefined ? fb : fa
		const body = other.getBody()
		if (arc.loop !== undefined && body.isDynamic() && !loopLets(arc, body)) return true
		if (other.getType() !== "circle") return false
		const circle = other.getShape() as CircleShape
		const C = body.getWorldPoint(circle.getCenter())
		const dx = C.x - arc.O.x
		const dy = C.y - arc.O.y
		const d = Math.sqrt(dx * dx + dy * dy)
		const phi = Math.atan2(dy, dx)
		// (and a round body still on the straight track leading in, its centre not yet on the arc's span but its rim over the arc's first piece: that
		// piece's flat face would be met a little turned, a knock; the straight piece carries it until the arc does)
		const margin = arc.loop === undefined ? Math.min(0.5, (circle.getRadius() + 2 * Settings.polygonRadius) / arc.R) : 0
		const on = arc.spans.some((s) => withinSpan(phi, s.from, s.to, margin))
		if (!on) return false
		if (arc.side === "in" ? d <= arc.R : d >= arc.R) return true
		return arc.loop !== undefined
	}

	// meters: a lab sensor's readings, each the mean over its last SENSOR_WINDOW s (samples after every (sub-)step: `after`)
	type RopeMeter = { item: string; key: string; joint: PlanckJoint; samples: { fh: number; h: number }[] }
	type MotionMeter = { item: string; speedKey: string; accelKey: string; body: Body; samples: { t: number; v: number }[] }
	type RiseMeter = { item: string; key: string; body: Body; at: Vec2; y0: number }
	const ropeMeters: RopeMeter[] = []
	const motionMeters: MotionMeter[] = []
	const riseMeters: RiseMeter[] = []
	/** The rope joining two bodies (either way round): one of this run's spools, or a doc pulley's (physics.ts's rope-pulley). */
	const ropeBetween = (A: Body, B: Body): PlanckJoint | undefined => {
		for (const s of spools) {
			const a = s.joint.getBodyA()
			const b = s.joint.getBodyB()
			if ((a === A && b === B) || (a === B && b === A)) return s.joint
		}
		for (let j = world.getJointList(); j !== null; j = j.getNext()) {
			if (j.getType() !== "rope-pulley") continue
			const a = j.getBodyA()
			const b = j.getBodyB()
			if ((a === A && b === B) || (a === B && b === A)) return j
		}
		return undefined
	}
	for (const m of of("meter")) {
		const item = str(m.item)
		if (item === undefined) continue
		if (m.reads === "rope") {
			const A = bodyOf(str(m.a) ?? null)
			const B = bodyOf(str(m.b) ?? null)
			const joint = A === undefined || B === undefined ? undefined : ropeBetween(A, B)
			if (joint !== undefined) ropeMeters.push({ item, key: str(m.key) ?? "newtons", joint, samples: [] })
			continue
		}
		const id = str(m.solid)
		const body = id === undefined ? undefined : bodyOf(id)
		if (id === undefined || body === undefined) continue
		if (m.reads === "motion") motionMeters.push({ item, speedKey: str(m.key) ?? "speed", accelKey: "accel", body, samples: [] })
		else {
			const at = anchorOn(id, { x: 0, y: 0 })
			riseMeters.push({ item, key: str(m.key) ?? "lift", body, at, y0: body.getWorldPoint(at).y })
		}
	}
	const hasMeters = ropeMeters.length + motionMeters.length + riseMeters.length > 0
	let clock = 0
	/** A motion meter's speed now: its body's velocity along the body's own x axis, m/s. */
	const speedOf = (m: MotionMeter) => {
		const v = m.body.getLinearVelocity()
		const ax = m.body.getWorldVector(new Vec2(1, 0))
		return (v.x * ax.x + v.y * ax.y) / LENGTH_SCALE
	}
	/** Every meter's reading now (the window's mean; a motion meter's acceleration over the window). */
	const setMeters = () => {
		for (const m of ropeMeters) {
			let fh = 0
			let h = 0
			for (const s of m.samples) {
				fh += s.fh
				h += s.h
			}
			ctx.set(m.item, m.key, h > 0 ? fh / h : 0)
		}
		for (const m of motionMeters) {
			const last = m.samples[m.samples.length - 1]
			const first = m.samples[0]
			const v = last === undefined ? 0 : last.v
			ctx.set(m.item, m.speedKey, v)
			ctx.set(m.item, m.accelKey, last === undefined || first === undefined || !(last.t > first.t) ? 0 : (last.v - first.v) / (last.t - first.t))
		}
		for (const m of riseMeters) ctx.set(m.item, m.key, (m.body.getWorldPoint(m.at).y - m.y0) / LENGTH_SCALE)
	}
	/** After a (sub-)step of h s: each meter's sample, the window kept to SENSOR_WINDOW (a motion meter keeps the newest sample at least that old). */
	const sampleMeters = (h: number) => {
		clock += h
		for (const m of ropeMeters) {
			const F = m.joint.getReactionForce(1 / h)
			m.samples.push({ fh: (Math.sqrt(F.x * F.x + F.y * F.y) / LENGTH_SCALE) * h, h })
			let span = 0
			for (const s of m.samples) span += s.h
			while (m.samples.length > 1 && span - (m.samples[0] as { h: number }).h >= SENSOR_WINDOW - 1e-12) span -= (m.samples.shift() as { h: number }).h
		}
		for (const m of motionMeters) {
			m.samples.push({ t: clock, v: speedOf(m) })
			while (m.samples.length > 2 && clock - (m.samples[1] as { t: number }).t >= SENSOR_WINDOW - 1e-12) m.samples.shift()
		}
		setMeters()
	}

	// force arrows' numbers (`forces` records): every outside force on each item's moving bodies, by kind, the mean over FORCE_WINDOW
	const NK = FORCE_KINDS.length
	const KIND = new Map<string, number>(FORCE_KINDS.map((k, i) => [k, i]))
	type Watch = {
		item: string
		solids: string[]
		bodies: Body[]
		/** Its ropes and springs, each its own arrow too, when it has two or more of a kind (a tug of war's two cords): [joint, kind, key]. */
		slots: { joint: PlanckJoint; kind: number; key: string }[]
		/** This (sub-)step's forces: per kind x, y, and for the placed kinds Σ|F|·px, Σ|F|·py, Σ|F| (5 numbers a kind). */
		now: Float64Array
		/** The window's samples: h and each kind's 5 numbers × h, and their running sum (a sample added when it comes, taken off when it leaves). */
		samples: { h: number; v: Float64Array }[]
		sum: Float64Array
		span: number
		/** Its bodies and solids as sets, and its readings' names (made once). */
		mine: Set<Body>
		ids: Set<string>
		names: { x: string; y: string; px: string | undefined; py: string | undefined }[]
	}
	const watches: Watch[] = of("forces").flatMap((r) => {
		const item = str(r.item)
		const ids = Array.isArray(r.solids) ? (r.solids as unknown[]).filter((x): x is string => typeof x === "string") : []
		const bodies = [...new Set(ids.map((id) => bodyOf(id)).filter((b): b is Body => b !== undefined && b.isDynamic()))]
		if (item === undefined || bodies.length === 0) return []
		// its ropes and springs to what is not it, as they are at the start (a winch's cord, a pulley's string, the catalog's springs)
		const ropes: PlanckJoint[] = []
		const springs: PlanckJoint[] = []
		for (const b of bodies)
			for (let e = b.getJointList(); e !== null; e = e.next) {
				const j = e.joint as PlanckJoint
				if ((e.other !== null && e.other !== undefined && bodies.includes(e.other)) || ropes.includes(j) || springs.includes(j)) continue
				const k = jointKind(j)
				if (k === 4) ropes.push(j)
				else if (k === 5) springs.push(j)
			}
		const slots = [
			...(ropes.length > 1 ? ropes.slice(0, 6).map((joint, i) => ({ joint, kind: 4, key: `tension${i + 1}` })) : []),
			...(springs.length > 1 ? springs.slice(0, 6).map((joint, i) => ({ joint, kind: 5, key: `spring${i + 1}` })) : [])
		]
		const n = (NK + slots.length) * 5
		const names = [
			...FORCE_KINDS.map((kind) => ({ x: `f_${kind}_x`, y: `f_${kind}_y`, px: PLACED_KINDS.includes(kind) ? `f_${kind}_px` : undefined, py: PLACED_KINDS.includes(kind) ? `f_${kind}_py` : undefined })),
			...slots.map((q) => ({ x: `f_${q.key}_x`, y: `f_${q.key}_y`, px: `f_${q.key}_px`, py: `f_${q.key}_py` }))
		]
		return [{ item, solids: ids, bodies, slots, now: new Float64Array(n), samples: [], sum: new Float64Array(n), span: 0, mine: new Set(bodies), ids: new Set(ids), names }]
	})
	/** A joint's kind of force (FORCE_KINDS' index): tension for ropes, cords and strings, spring for springs, support for the rest. */
	function jointKind(j: PlanckJoint) {
		const type = j.getType()
		return type === "rope-joint" || type === "rope-pulley" || type === "spool-rope" || type === "pulley-joint" ? 4 : type === "spring-link" || type === "distance-joint" ? 5 : 1
	}
	/** The kind of a contact's or a pin's push on a body: support when it points within 60° of straight up, push otherwise. */
	const upOrPush = (x: number, y: number) => (y >= 0.5 * Math.sqrt(x * x + y * y) ? 1 : 2)
	const addForce = (w: Watch, k: number, x: number, y: number, at?: V) => {
		if (!(Number.isFinite(x) && Number.isFinite(y))) return
		// (k ≥ NK: a slot, one rope's or spring's own; its kind's sum is added as well by the caller)
		const o = k * 5
		w.now[o] += x
		w.now[o + 1] += y
		if (at !== undefined && Number.isFinite(at.x) && Number.isFinite(at.y)) {
			const m = Math.sqrt(x * x + y * y)
			w.now[o + 2] += m * at.x
			w.now[o + 3] += m * at.y
			w.now[o + 4] += m
		}
	}
	/** Right after planck's main solve (EngineInternals.afterSolve): each watched item's contacts with what is not it, from their impulses. */
	let solveH = 0
	const readContacts = () => {
		if (!(solveH > 0)) return
		const k = 1 / (solveH * LENGTH_SCALE)
		for (const w of watches) {
			const mine = w.mine
			for (const body of w.bodies) {
				// (a sleeping body's contacts are not updated: the continuous pass left them disabled, their impulses those of its last solve, which hold it still)
				const awake = body.isAwake()
				for (let e = body.getContactList(); e !== null; e = e.next) {
					const c = e.contact
					if (!c.isTouching() || (awake && !c.isEnabled()) || c.getFixtureA().isSensor() || c.getFixtureB().isSensor()) continue
					const other = e.other
					if (other === null || other === undefined || mine.has(other)) continue
					const man = c.getManifold()
					if (man.pointCount === 0) continue
					const wm = c.getWorldManifold(null)
					if (wm === null || wm === undefined) continue
					// the normal points from A to B; the impulse P = Pn·n + Pt·t (t = (n.y, −n.x)) acts on B, −P on A
					const sign = c.getFixtureB().getBody() === body ? 1 : -1
					const nx = wm.normal.x
					const ny = wm.normal.y
					for (let i = 0; i < man.pointCount; i++) {
						const mp = man.points[i] as { normalImpulse: number; tangentImpulse: number }
						const at = wm.points[i] as Vec2 | undefined
						const p = at === undefined ? undefined : { x: at.x / LENGTH_SCALE, y: at.y / LENGTH_SCALE }
						const fnx = sign * mp.normalImpulse * nx * k
						const fny = sign * mp.normalImpulse * ny * k
						if (mp.normalImpulse !== 0) addForce(w, upOrPush(fnx, fny), fnx, fny, p)
						if (mp.tangentImpulse !== 0) addForce(w, 3, sign * mp.tangentImpulse * ny * k, -sign * mp.tangentImpulse * nx * k, p)
					}
				}
			}
		}
	}
	if (watches.length > 0) E.afterSolve?.(readContacts)
	/** After a (sub-)step of h s: the rest of each watched item's forces (gravity, joints, the air, pushes), then the window's mean as readings. */
	const ownPushes: { body: Body; k: number; x: number; y: number }[] = []
	const readForces = (h: number) => {
		const inv = 1 / h
		// (the other processes' pushes by solid, once a (sub-)step: sand or water may push hundreds of solids)
		const pushed = new Map<string, { readonly solid: string; readonly kind: string; readonly by: string; readonly fx: number; readonly fy: number; readonly at?: V }[]>()
		for (const q of ctx.forces?.() ?? []) {
			const list = pushed.get(q.solid)
			if (list === undefined) pushed.set(q.solid, [q])
			else list.push(q)
		}
		for (const w of watches) {
			const mine = w.mine
			// gravity: the item's own mass (what it weighs, without the air it carries) × g, at its centre of mass
			let m = 0
			for (const id of w.solids) m += ctx.massOf?.(id) ?? 0
			addForce(w, 0, 0, -m * ctx.gravity)
			// joints with what is not it: their reaction on each of its bodies
			for (const body of w.bodies) {
				for (let e = body.getJointList(); e !== null; e = e.next) {
					const j = e.joint as PlanckJoint
					if (e.other !== null && e.other !== undefined && mine.has(e.other)) continue
					const type = j.getType()
					if (j instanceof ArcTouch) {
						const p = j.parts(inv)
						if (p === undefined) continue
						addForce(w, upOrPush(p.nx, p.ny), p.nx, p.ny, { x: p.px, y: p.py })
						addForce(w, 3, p.fx, p.fy, { x: p.px, y: p.py })
						continue
					}
					let f: V | undefined
					if (j instanceof SpoolRope) {
						const g = j.forceOn(body, inv)
						f = g === undefined ? undefined : { x: g.x / LENGTH_SCALE, y: g.y / LENGTH_SCALE }
					} else if (j instanceof GearLink) continue
					else f = E.jointForce?.(j, body, inv)
					if (f === undefined || (f.x === 0 && f.y === 0)) continue
					const anchor = j.getBodyA() === body ? j.getAnchorA() : j.getAnchorB()
					const at = { x: anchor.x / LENGTH_SCALE, y: anchor.y / LENGTH_SCALE }
					const kind = type === "chain-touch" ? upOrPush(f.x, f.y) : jointKind(j)
					addForce(w, kind, f.x, f.y, at)
					const slot = w.slots.findIndex((q) => q.joint === j)
					if (slot >= 0) addForce(w, NK + slot, f.x, f.y, at)
				}
			}
			// a spring's own weight its end carries (the engine's springs with mass): the spring's pull
			for (const body of w.bodies) for (const q of E.springWeights?.(body) ?? []) addForce(w, 5, 0, -q.force, q.at)
			// the air: drag (resistance, or a fan's wind) and buoyancy, as the engine pushed
			for (const id of w.solids) {
				const a = E.airOn?.(id)
				if (a === undefined) continue
				addForce(w, 6, a.x, a.y)
				addForce(w, 7, 0, a.lift)
			}
			// this module's own pushes (forces, balloons, the lift taken back from thin shells) and the other processes'
			for (const q of ownPushes) if (mine.has(q.body)) addForce(w, q.k, q.x, q.y)
			if (pushed.size > 0)
				for (const id of w.solids)
					for (const q of pushed.get(id) ?? []) {
						const k = KIND.get(q.kind) ?? KIND.get(pushesAs(q.by)) ?? 9
						addForce(w, k === NK - 1 ? 9 : k, q.fx, q.fy, PLACED_KINDS.includes(FORCE_KINDS[k] as ForceKind) ? q.at : undefined)
					}
			// net: the sum of the others
			let nx = 0
			let ny = 0
			for (let k = 0; k < NK - 1; k++) {
				nx += w.now[k * 5] as number
				ny += w.now[k * 5 + 1] as number
			}
			w.now[(NK - 1) * 5] = nx
			w.now[(NK - 1) * 5 + 1] = ny
			// the window: this (sub-)step's sample × h, the oldest dropped past FORCE_WINDOW
			const v = new Float64Array(w.now.length)
			for (let i = 0; i < w.now.length; i++) {
				v[i] = (w.now[i] as number) * h
				w.sum[i] += v[i] as number
			}
			w.samples.push({ h, v })
			w.span += h
			while (w.samples.length > 1 && w.span - (w.samples[0] as { h: number }).h >= FORCE_WINDOW - 1e-12) {
				const old = w.samples.shift() as { h: number; v: Float64Array }
				w.span -= old.h
				for (let i = 0; i < old.v.length; i++) w.sum[i] -= old.v[i] as number
			}
			w.now.fill(0)
			setForces(w)
		}
		ownPushes.length = 0
	}
	/** A watched item's readings: each kind's window mean, where the placed ones act, and its centre of mass now. */
	const setForces = (w: Watch) => {
		const sum = w.sum
		const span = w.span
		let mx = 0
		let my = 0
		let mm = 0
		for (const b of w.bodies) {
			const c = b.getWorldCenter()
			const bm = b.getMass()
			mx += c.x * bm
			my += c.y * bm
			mm += bm
		}
		const cx = mm > 0 ? mx / mm / LENGTH_SCALE : 0
		const cy = mm > 0 ? my / mm / LENGTH_SCALE : 0
		ctx.set(w.item, "f_cx", cx)
		ctx.set(w.item, "f_cy", cy)
		// (each kind's, then each rope's or spring's own: their names made once, `names`)
		w.names.forEach((nm, k) => {
			const o = k * 5
			ctx.set(w.item, nm.x, span > 0 ? (sum[o] as number) / span : 0)
			ctx.set(w.item, nm.y, span > 0 ? (sum[o + 1] as number) / span : 0)
			if (nm.px !== undefined && nm.py !== undefined) {
				const wt = sum[o + 4] as number
				// (a force-weighted mean of points: a running sum's last bits are no point, under 1e-9 N it is the centre's)
				ctx.set(w.item, nm.px, wt > 1e-9 ? (sum[o + 2] as number) / wt : cx)
				ctx.set(w.item, nm.py, wt > 1e-9 ? (sum[o + 3] as number) / wt : cy)
			}
		})
	}

	// energy bars' numbers (`energy` records): kinetic, potential, spring energy, and the bookkeeping of what left (heat) or came into the motion
	type Energy = { item: string; bodies: Body[]; springs: PlanckJoint[]; start: number; heat: number; added: number; y0: number[]; x0: number[]; w0: number[] }
	const energies: Energy[] = of("energy").flatMap((r) => {
		const item = str(r.item)
		const ids = Array.isArray(r.solids) ? (r.solids as unknown[]).filter((x): x is string => typeof x === "string") : []
		const bodies = [...new Set(ids.map((id) => bodyOf(id)).filter((b): b is Body => b !== undefined && b.isDynamic()))]
		if (item === undefined || bodies.length === 0) return []
		const springs: PlanckJoint[] = []
		for (let j = world.getJointList(); j !== null; j = j.getNext()) if (E.spring?.(j) !== undefined && (bodies.includes(j.getBodyA()) || bodies.includes(j.getBodyB()))) springs.push(j)
		return [{ item, bodies, springs, start: 0, heat: 0, added: 0, y0: [], x0: [], w0: [] }]
	})
	/** Each body's height and each spring's stretch now: the step's start, kept before it is solved (`force`). */
	const heightsOf = (e: Energy) => {
		e.y0 = e.bodies.map((b) => b.getWorldCenter().y / LENGTH_SCALE)
		e.x0 = e.springs.map((j) => E.spring?.(j)?.x ?? 0)
		e.w0 = e.bodies.flatMap((b) => (E.springWeights?.(b) ?? []).map((q) => q.at.y))
	}
	/**
	 * An item's kinetic (½·M·v² + ½·I·ω² of each body, as the engine moves it), potential (M·g·y of its centre of mass) and spring energy
	 * (½·k·x²), J; `mid`: the heights and stretches paired as the step's mean with its start's (½·(y₀ + y₁), ½·k·x₀·x₁).
	 */
	const energyOf = (e: Energy, mid: boolean) => {
		let ke = 0
		let pe = 0
		e.bodies.forEach((b, i) => {
			const v = b.getLinearVelocity()
			const w = b.getAngularVelocity()
			const m = b.getMass()
			const lc = b.getLocalCenter()
			const I = (b.getInertia() - m * (lc.x * lc.x + lc.y * lc.y)) / (LENGTH_SCALE * LENGTH_SCALE)
			ke += 0.5 * m * ((v.x * v.x + v.y * v.y) / (LENGTH_SCALE * LENGTH_SCALE)) + 0.5 * I * w * w
			const y = b.getWorldCenter().y / LENGTH_SCALE
			pe += m * ctx.gravity * (mid ? 0.5 * ((e.y0[i] ?? y) + y) : y)
		})
		// (a spring's own weight its end carries, a steady force the engine adds: its potential energy too, F·y at its anchor)
		let wi = 0
		for (const b of e.bodies)
			for (const q of E.springWeights?.(b) ?? []) {
				pe += q.force * (mid ? 0.5 * ((e.w0[wi] ?? q.at.y) + q.at.y) : q.at.y)
				wi++
			}
		let se = 0
		e.springs.forEach((j, i) => {
			const s = E.spring?.(j)
			if (s !== undefined) se += 0.5 * s.k * s.x * (mid ? (e.x0[i] ?? s.x) : s.x)
		})
		return { ke, pe, se }
	}
	const setEnergy = (e: Energy, n: { ke: number; pe: number; se: number }) => {
		ctx.set(e.item, "e_kinetic", n.ke)
		ctx.set(e.item, "e_potential", n.pe)
		ctx.set(e.item, "e_spring", n.se)
		ctx.set(e.item, "e_heat", e.heat)
		ctx.set(e.item, "e_added", e.added)
	}
	/** After a (sub-)step: what has left the motion since the release (heat and sound) or come into it (added), so that start + added = the energies + heat. */
	const bookEnergy = () => {
		for (const e of energies) {
			const n = energyOf(e, true)
			const d = e.start - (n.ke + n.pe + n.se)
			e.heat = d > 0 ? d : 0
			e.added = d < 0 ? -d : 0
			setEnergy(e, n)
		}
	}

	let released = false
	return {
		/** A contact as the engine meets it (plugins.ts Process.contact): true when the engine should leave it (an arc's, a loop's piece passed through). */
		contact(touch: Touch, phase: "begin" | "pre"): boolean {
			if (passes(touch)) return true
			if (phase === "begin" && fragile.size > 0) {
				const sa = E.solidOf(touch.getFixtureA().getUserData())
				const sb = E.solidOf(touch.getFixtureB().getUserData())
				if (sa !== undefined && sb !== undefined && sa.item !== sb.item) {
					if (fragile.has(sa.id)) strikeFragile(touch, sa.id, sb.id, touch.getFixtureA().getBody())
					if (fragile.has(sb.id)) strikeFragile(touch, sb.id, sa.id, touch.getFixtureB().getBody())
				}
			}
			if (phase !== "begin" || stickyOf.size === 0) return false
			// sticky: welds to the first solid of another item it touches (after this step: `after`)
			const sa = E.solidOf(touch.getFixtureA().getUserData())
			const sb = E.solidOf(touch.getFixtureB().getUserData())
			for (const [me, it, mine, theirs] of [
				[sa, sb, touch.getFixtureA().getBody(), touch.getFixtureB().getBody()],
				[sb, sa, touch.getFixtureB().getBody(), touch.getFixtureA().getBody()]
			] as const) {
				if (me === undefined || it === undefined || stuck.has(me.id) || me.item === it.item) continue
				const how = stickyOf.get(me.id)
				if (how === undefined) continue
				if (mine === theirs || (!theirs.isDynamic() && how === "moving") || (!mine.isDynamic() && !theirs.isDynamic())) continue
				const wm = touch.getWorldManifold(null)
				const at = wm !== null && wm !== undefined && wm.pointCount > 0 ? Vec2.clone(wm.points[0] as Vec2) : Vec2.mid(mine.getWorldCenter(), theirs.getWorldCenter())
				stuck.add(me.id)
				welds.push({ a: mine, b: theirs, at })
			}
			return false
		},
		/** Before each (sub-)step of h s ending at time t: the release's velocities, forces, drives, balloons, loops and arc touches. */
		force(t: number, h: number) {
			if (!released) {
				released = true
				for (const s of starts) {
					s.body.setLinearVelocity(s.v)
					if (s.w !== undefined) s.body.setAngularVelocity(s.w)
					s.body.setAwake(true)
				}
				// (each energy record's start: as the release lets go, start speeds given)
				for (const e of energies) {
					const n = energyOf(e, false)
					e.start = n.ke + n.pe + n.se
				}
			}
			for (const e of energies) heightsOf(e)
			solveH = h
			const watching = watches.length > 0
			for (const f of forces) {
				if (t <= f.from || t > f.until) continue
				const F = f.local === undefined ? f.world : f.body.getWorldVector(f.local)
				f.body.applyForce(new Vec2(F.x * LENGTH_SCALE, F.y * LENGTH_SCALE), f.body.getWorldPoint(f.at), true)
				if (watching) ownPushes.push({ body: f.body, k: 9, x: F.x, y: F.y })
			}
			for (const d of drives) {
				const on = t > d.from && t <= d.until
				d.joint.enableMotor(on || d.friction > 0)
				d.joint.setMotorSpeed(on ? d.speed : 0)
				d.joint.setMaxMotorForce(on ? d.force : d.friction)
			}
			if (ctx.air)
				for (const u of unbuoys) {
					u.body.applyForce(new Vec2(0, -u.lift * LENGTH_SCALE), u.body.getWorldPoint(u.at), true)
					if (watching) ownPushes.push({ body: u.body, k: 7, x: 0, y: -u.lift })
				}
			for (const b of balloons) {
				if (t <= b.from || !ctx.air) continue
				const now = balloonStep(b, b.volume, h)
				b.volume = now.volume
				const carried = 1.5 * AIR * b.volume
				const k = b.mass / (b.mass + carried)
				const v = b.body.getLinearVelocityFromWorldPoint(b.body.getWorldPoint(b.at))
				const vx = v.x / LENGTH_SCALE
				const vy = v.y / LENGTH_SCALE
				const speed = Math.sqrt(vx * vx + vy * vy)
				const drag = 0.5 * AIR * Math.max(b.cd * Math.PI * now.radius * now.radius, LIMP_DRAG * 2 * b.rest * b.rest) * speed
				const dir = b.body.getWorldVector(b.direction)
				// the jet pushes the balloon the other way from where its air leaves
				const fx = k * (-now.thrust * dir.x - drag * vx)
				const fy = k * (-now.thrust * dir.y - drag * vy) + (1 - k) * b.mass * ctx.gravity
				b.body.applyForce(new Vec2(fx * LENGTH_SCALE, fy * LENGTH_SCALE), b.body.getWorldPoint(b.at), true)
				if (watching) {
					// (its jet's push is applied; its drag and the carried air's weight given back are the air's)
					ownPushes.push({ body: b.body, k: 9, x: -k * now.thrust * dir.x, y: -k * now.thrust * dir.y })
					ownPushes.push({ body: b.body, k: 6, x: fx + k * now.thrust * dir.x, y: fy + k * now.thrust * dir.y })
				}
				if (b.item !== undefined) {
					ctx.set(b.item, "volume", b.volume)
					ctx.set(b.item, "thrust", now.thrust)
				}
			}
			if (loops.length > 0) trackLoops()
			arcTouches()
		},
		/** After each (sub-)step of h s: the welds of solids that stuck, broken fragile things stopped (a splat: fixed where it broke), the meters. */
		after(h?: number) {
			for (const w of welds.splice(0)) world.createJoint(new WeldJoint({ frequencyHz: 0, dampingRatio: 0 }, w.a, w.b, w.at))
			if (hasMeters && h !== undefined && h > 0) sampleMeters(h)
			if (watches.length > 0 && h !== undefined && h > 0) readForces(h)
			if (energies.length > 0) bookEnergy()
			for (const f of fragile.values()) {
				if (!f.broken || f.frozen) continue
				f.frozen = true
				f.body.setLinearVelocity(new Vec2(0, 0))
				f.body.setAngularVelocity(0)
				f.body.setType("static")
			}
		},
		/** Readings at every step (before the bodies move, too): a balloon's state from t = 0, a spool's free rope. */
		readings() {
			for (const f of fragile.values()) {
				if (!released) {
					ctx.set(f.item, "broken", 0)
					ctx.set(f.item, "peak", 0)
				}
			}
			for (const b of balloons) {
				if (b.item === undefined) continue
				ctx.set(b.item, "volume", b.volume)
				if (!released) ctx.set(b.item, "thrust", 0)
			}
			for (const s of spools) if (s.item !== undefined) ctx.set(s.item, "rope", s.joint.freeLength())
			// (the meters read from t = 0: at rest until the release; after it, `after` sets them once each (sub-)step)
			if (hasMeters && !released) setMeters()
			// (force arrows and energy bars from t = 0 too: no forces are solved before the release, and nothing has moved)
			if (!released) {
				for (const w of watches) setForces(w)
				for (const e of energies) setEnergy(e, energyOf(e, false))
			}
		}
	}
}
