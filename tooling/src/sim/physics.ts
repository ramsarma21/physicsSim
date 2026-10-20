import {
	AABB,
	type Body,
	BoxShape,
	CircleShape,
	CollidePolygonCircle,
	CollidePolygons,
	Distance,
	DistanceInput,
	DistanceOutput,
	Fixture,
	Manifold,
	Joint as PlanckJoint,
	PolygonShape,
	RevoluteJoint,
	RopeJoint,
	Contact as Touch,
	Settings,
	SimplexCache,
	Sweep,
	type TimeStep,
	Transform,
	Vec2,
	Vec3,
	WheelJoint,
	World
} from "planck"
import {
	compose,
	type Contact,
	HITBOX_DEPTH,
	hitboxEdgeAt,
	type Joint,
	type Material,
	type Motor,
	mass,
	polygonArea,
	polygonCentroid,
	type Pose,
	type SimScene,
	type SolidPart,
	type Stream,
	streams,
	type Vec,
	volume,
	worldPose
} from "#sim/part.ts"
import { ProcessRunner, resolveSettings, type SolidHandle } from "#sim/plugins.ts"

/**
 * The simulation, with the corrections the Prism mechanics lab
 * (prism-labs/apps/labs/mechanics-lab, src/lib/units.ts and world.ts) found planck 1.5 needs to keep
 * classroom-sized bodies honest. Everything outside this module is meters, kilograms and seconds.
 * Where planck's own pieces fall short of the physics, this module has its own, solved inside planck's
 * step: weld groups as one rigid body each (`simulate`), springs that no setting can blow up
 * (`SpringLink`), a pulley rope that only pulls and jams at its wheels (`RopePulley`), hinges and ropes
 * that keep a swing's energy (`Hinge`, `Cord`), hinge friction, and chains that things land on
 * (`ChainTouch`). research/rw-validate-p3.ts checks each against theory.
 */

/** Standard gravity, m/s². */
const GRAVITY = 9.81
/**
 * This run's gravity, m/s² (doc.settings.gravity: a Moon or Mars preset), GRAVITY unless the document says otherwise; set at the start
 * of every `simulate` (one run at a time in a worker), so a document without settings computes the very same bits as before.
 */
let runGravity = GRAVITY

/**
 * Internal planck length units per meter: Box2D's solver constants (5 mm linear slop, sleep and
 * velocity tolerances) are tuned for shapes 0.1 to 10 units across, so a 6 cm ball is simulated
 * 0.6 units across.
 */
const LENGTH_SCALE = 10

/**
 * The fixed step, s: 480 Hz, twenty steps to each 24 fps frame. The Prism lab steps at 120 Hz; at
 * that rate a ball landing from 1 m overlaps the floor by up to 12 mm, which a drawn contact frame
 * shows as the ball sinking in. At 480 Hz the overlap is a few millimeters at most.
 */
const STEP = 1 / 480

/**
 * Below this normal approach speed (m/s) a bounce is inelastic. planck's 1 m/s would kill a ball's
 * later bounces; resting contacts re-approach at one step of gravity (0.02 m/s at 480 Hz), well
 * under it, so they settle instead of micro-bouncing.
 */
const VELOCITY_THRESHOLD = 0.2

/** Air density at room temperature, kg/m³. */
const AIR_DENSITY = 1.2
/** This run's air density, kg/m³: AIR_DENSITY (or doc.settings.airDensity, a world's own air), or 0 in a vacuum (doc.settings.air false: no buoyancy, no drag, no streams). */
let airDensity = AIR_DENSITY

/** Drag coefficient of a sphere at the speeds of a classroom drop (Reynolds number 10³ to 10⁵). */
const SPHERE_DRAG = 0.47

/** Drag coefficient of a box moving broadside on. */
const BOX_DRAG = 1.05

/** Drag coefficient of a cylinder moving broadside on (its axis across the flow), Reynolds number 10³ to 10⁵. */
const CYLINDER_DRAG = 1.1

/**
 * A round free jet's development, after Rajaratnam (Turbulent Jets, 1976): the outlet's speed holds
 * along the axis for its potential core, about 6.2 diameters, then falls as 1/x; across the axis
 * the speed falls as a Gaussian whose half-speed radius grows about 0.094 per unit of distance.
 * @limitKind derived
 * @owner lesson-art simulated demonstrations
 * @unit outlet diameters; meters per meter
 * @scope every airflow in a simulated demonstration
 * @derivation measured constants of a round turbulent jet; a fan's swirl and hub are not modeled
 */
const JET = { core: 6.2, spread: 0.094 } as const

/** The air's velocity at a point: the sum of every stream there, still air elsewhere. */
export const airAt = (flows: readonly Stream[], p: { readonly x: number; readonly y: number }) => {
	let x = 0
	let y = 0
	for (const f of flows) {
		const ux = Math.cos(f.direction)
		const uy = Math.sin(f.direction)
		const along = (p.x - f.at.x) * ux + (p.y - f.at.y) * uy
		if (along <= 0) continue
		const across = Math.abs(-(p.x - f.at.x) * uy + (p.y - f.at.y) * ux)
		const center = f.speed * Math.min(1, (JET.core * f.diameter) / along)
		const halfSpeed = Math.max(f.diameter / 2, JET.spread * along)
		const speed = center * Math.exp(-Math.LN2 * (across / halfSpeed) ** 2)
		x += speed * ux
		y += speed * uy
	}
	return { x, y }
}

/**
 * Mean contact pressure of a fully plastic dent over the material's yield strength: Tabor's
 * hardness relation, about 3.
 */
const DENT_PRESSURE = 3

/**
 * The fastest anything in a scene may move, m/s: its centre, and any point of it as it turns. Nothing a scene builds comes near
 * it: a run lasts at most 20 s (web/server.py's `clean`), in which gravity alone can give a body at most 196 m/s (a 1 m steel ball let
 * fall from 1000 m reaches 180 m/s in 20 s through the air); the stiffest launcher throws at under 40. It is a guard against a solve
 * that diverges where solids are wedged deep inside one another, which would otherwise feed on itself to infinity (and NaN) within
 * a few steps. A body over it is slowed to it, said once per run (console.warn); planck's own clamp on a step's move
 * (`Settings.maxTranslation`) is set to it as well, so no single solve carries a body farther than it allows.
 */
const SANE_SPEED = 250

/** An error the engine reports itself: one line, saying when and what (the server and the page show its message as it is). */
export class SimulationError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "SimulationError"
	}
}

/**
 * Sub-steps for stiff springs (`simulate`'s `subSteps`): the most a spring group may turn its bodies in one (sub-)step, radians (ω·h),
 * on its own (a period then within 0.9 % of its true one: 1 − ω·h/(2·asin(ω·h/2)) at most), and while something from outside strikes
 * or nears it (a ball's rebound off its plate is then within 1.4 % of a step 10 times finer: research/rw-validate-p3.ts); and the most
 * sub-steps a step is split into.
 */
const SUB_TURN = 0.45
const SUB_TURN_NEAR = 0.15
const SUB_MAX = 16
/**
 * Steps (0.25 s) the finer sub-steps are kept for after a body from outside a spring group last neared it; and the least a group keeps
 * the sub-steps it asked for before it may ask for fewer (a count that followed the swing's phase, more while the spring is stretched
 * and fewer while it is pressed, gave the swing energy every period: an undamped 10 × 10 cm pad at 10000 N/m rang up from 17 to 93 mm
 * in 2.5 s with nothing touching it, and threw a marble dropped 2 m on it 6.5 m high).
 */
const SUB_HOLD = 120
/**
 * The whole world is stepped in the sub-steps, so they are limited to about SUB_WORK body-steps a step: at most SUB_WORK over the moving
 * bodies awake (a pad at 10000 N/m with a ball on it took a crowded Rube Goldberg machine from 0.24 to 2.3 s); a crowded scene's
 * stiff springs are then followed in fewer, steady still (their implicit share), the rebound off them followed less closely.
 */
const SUB_WORK = 64
/**
 * m/s: a body from outside a spring group that moves against it slower than this rests on it or rides with it (a ball sitting on a
 * pad, a mat's passenger); only one that comes at it faster strikes it, and only then are the finer sub-steps needed.
 */
const NEAR_SPEED = 0.1

/**
 * The most impacts the time-of-impact pass solves in one step (`simulate`'s `solveIslandTOI`), and the most it solves for any one body
 * (a body wedged among fixed solids, a ball and a wheel, set off 122,432 impacts in 1.5 s; a scene took 51-329 s for 3).
 */
const TOI_EVENTS = 1024
const BODY_TOI = 32
/**
 * A body that used all its BODY_TOI impacts in a step is wedged (it strikes the same solids over and over): BODY_TOI_WEDGED a step for it from the
 * next step on, until a step leaves it some (four wedged among 390 pegs used 32 each in every step: 216,553 impacts, 44 s of a 3 s run's 47).
 */
const BODY_TOI_WEDGED = 4
/** Each impact the pass solves scans every contact of the world again for the next one: at most TOI_WORK contacts scanned a step. */
const TOI_WORK = 200000

/** Spin below this (rad/s) gets no rolling resistance, so a resting ball is left alone. */
const ROLLING_OMEGA_FLOOR = 0.01

const applySettings = () => {
	// Positions are already multiplied by LENGTH_SCALE, so planck's own unit stays at 1: its 0.005
	// slop is then 0.5 mm and its polygon skin 1 mm. Scaling it by LENGTH_SCALE as well made the slop
	// 5 mm against a 1 mm skin, so a leaning domino froze on its edge and impacts sank in 4.5 mm.
	Settings.lengthUnitsPerMeter = 1
	Settings.velocityThreshold = VELOCITY_THRESHOLD * LENGTH_SCALE
	// Clamps raised out of reach so they never silently change a fast body's motion.
	Settings.maxTranslation = 12 * LENGTH_SCALE
	Settings.maxRotation = 4 * Math.PI
}

/**
 * planck keeps a destroyed contact in a pool shared by every world in the process and hands that same object to the next pair that starts
 * to touch. State kept by contact (a module's set of contacts a striker passes through, its contacts' ages) then passes to an unrelated pair,
 * and which object a pair gets depends on what ran before in the same process: a long-lived engine (the server's workers, the app's engine
 * worker) gave a scene a track it never gives in a fresh one (fuzz-845 after fuzz-3: another top speed, other hit times). A destroyed contact
 * is never handed out again: planck 1.5's own Contact.destroy (unlinked from its bodies, endContact while touching, both bodies woken) without
 * the release into the pool, so a run's track depends on its document alone. Nothing else changes: the 12 scenarios and 10 gallery scenes
 * are byte-identical either way (the engine itself keys nothing by contact across a destroy).
 */
interface PooledContact {
	m_fixtureA: { m_body: Body | null; m_isSensor: boolean } | null
	m_fixtureB: { m_body: Body | null; m_isSensor: boolean } | null
	m_nodeA: ContactLink
	m_nodeB: ContactLink
	m_manifold: { pointCount: number }
	isTouching(): boolean
}
interface ContactLink {
	prev: ContactLink | null
	next: ContactLink | null
}
;(Touch as unknown as { destroy: (contact: PooledContact, listener: { endContact(c: PooledContact): void }) => void }).destroy = (contact, listener) => {
	const fixtureA = contact.m_fixtureA
	const fixtureB = contact.m_fixtureB
	if (fixtureA === null || fixtureB === null) return
	const bodyA = fixtureA.m_body as unknown as { m_contactList: ContactLink | null; setAwake(flag: boolean): void } | null
	const bodyB = fixtureB.m_body as unknown as { m_contactList: ContactLink | null; setAwake(flag: boolean): void } | null
	if (bodyA === null || bodyB === null) return
	if (contact.isTouching()) listener.endContact(contact)
	for (const [node, body] of [
		[contact.m_nodeA, bodyA],
		[contact.m_nodeB, bodyB]
	] as const) {
		if (node.prev) node.prev.next = node.next
		if (node.next) node.next.prev = node.prev
		if (node === body.m_contactList) body.m_contactList = node.next
	}
	if (contact.m_manifold.pointCount > 0 && !fixtureA.m_isSensor && !fixtureB.m_isSensor) {
		bodyA.setAwake(true)
		bodyB.setAwake(true)
	}
}

/** A part's position and angle (radians, counterclockwise) at one moment, in meters. */
export interface Placement {
	readonly x: number
	readonly y: number
	readonly angle: number
	/**
	 * A flat spot a dented body keeps, as the fraction of its height left (1 is undented), measured
	 * from where it touches down.
	 */
	readonly squash?: number
	/** A resized body's size against its document body (plugins.ts `resize`: ice melting, a balloon filling); 1 without it. */
	readonly scale?: number
}

/**
 * The parts' placements at each frame. A frame's `t` is the moment it shows: frames fall every 1/fps
 * seconds, except that the frame nearest each impact shows the impact itself, so every contact is
 * drawn (at 24 fps a fast ball is otherwise caught centimeters short of what it hits).
 */
export interface Track {
	readonly fps: number
	readonly frames: readonly { readonly t: number; readonly placements: Readonly<Record<string, Placement>> }[]
	/** Each impact: when, the two solids' ids, and the speed they met at (m/s). */
	readonly impacts?: readonly { readonly t: number; readonly a: string; readonly b: string; readonly speed: number }[]
	/** Module readings per frame (plugins.ts): {item id: {key: [value at each frame]}}; only when a process set any. */
	readonly state?: Readonly<Record<string, Readonly<Record<string, readonly number[]>>>>
	/** Module events (plugins.ts): what happened, when; only when a process said any. */
	readonly events?: readonly { readonly t: number; readonly items: readonly string[]; readonly text: string; readonly kind?: string }[]
}

interface Tag {
	readonly part: SolidPart
}

const isTag = (value: unknown): value is Tag => typeof value === "object" && value !== null && "part" in value

/** The contact between two materials, matched by name so a scene read back from JSON still finds it. */
const contactOf = (scene: SimScene<string>, a: Material, b: Material): Contact | undefined =>
	scene.contacts.find(
		(c) =>
			(c.between[0].words === a.words && c.between[1].words === b.words) ||
			(c.between[0].words === b.words && c.between[1].words === a.words)
	)

/**
 * Runs the scene: every dynamic part rests where it is specified until the release, then moves under
 * gravity from rest. Nothing about the outcome is specified. Placements are sampled at `fps`.
 */
export const simulate = (scene: SimScene<string>, fps: number): Track => {
	applySettings()
	// (plugins.ts: the document's settings; without them g and the air are the standard ones, as they always were)
	const settings = resolveSettings(scene.settings)
	runGravity = settings.gravity
	// (doc.settings.airDensity: a world's own air, Mars's thin or Venus's thick; the standard 1.2 is AIR_DENSITY itself, bit for bit)
	airDensity = settings.air ? (settings.airDensity ?? AIR_DENSITY) : 0
	const world = new World({ gravity: new Vec2(0, -runGravity * LENGTH_SCALE) })
	const start = (id: string) => worldPose(scene, id, 0)

	/**
	 * Weld groups. A part with a parent and no pivot is fixed to its parent, so a part, its welded children,
	 * theirs and so on are one rigid object: ONE planck body with a fixture per part (each with its own
	 * material, so its own friction and restitution), whose mass, centre of mass and rotational inertia
	 * are those of all its parts. A weld then never gives, however heavy one part is against another
	 * (a planck weld joint stretched centimetres under a 10 kg bob on a 2 g rod), and the parts of one
	 * group never collide with each other. The group's body stands where its root (the part the welds
	 * lead up to) does; each part's placement is the body's pose composed with the part's own pose in the
	 * root's frame, so the track still has every part's own pose under its own id. A group with a fixed
	 * (static) part is fixed, as a weld to a fixed part was.
	 */
	const solidById = new Map(scene.solids.map((p) => [p.id, p]))
	const welded = (part: SolidPart) => part.parent !== undefined && part.pivot === undefined && solidById.has(part.parent)
	const rootOf = (part: SolidPart): SolidPart => (welded(part) ? rootOf(solidById.get(part.parent as string) as SolidPart) : part)
	/** A part's pose in its group root's frame (meters, radians): its own composed down from the root. */
	const poseInRoot = (part: SolidPart): Pose =>
		welded(part) ? compose(poseInRoot(solidById.get(part.parent as string) as SolidPart), { at: part.at, angle: part.angle ?? 0 }) : IDENTITY
	const groupOf = new Map<string, SolidPart[]>()
	for (const part of scene.solids) {
		const root = rootOf(part)
		groupOf.set(root.id, [...(groupOf.get(root.id) ?? []), part])
	}
	const members: Member[] = []
	const memberOf = new Map<string, Member>()
	const madeBodies = new Map<string, Body>()
	for (const part of scene.solids) {
		const root = rootOf(part)
		const parts = groupOf.get(root.id) ?? [part]
		let body = madeBodies.get(root.id)
		if (body !== undefined) continue
		const kind = parts.some((p) => p.kind === "static") ? "static" : "dynamic"
		body = world.createBody({
			type: kind,
			position: new Vec2(start(root.id).at.x * LENGTH_SCALE, start(root.id).at.y * LENGTH_SCALE),
			angle: start(root.id).angle,
			// Continuous collision on every moving body, so nothing tunnels through a thin surface.
			bullet: kind === "dynamic"
		})
		madeBodies.set(root.id, body)
		const lone = parts.length === 1
		const group: Member[] = []
		for (const p of parts) {
			const local = p === root ? IDENTITY : poseInRoot(p)
			const fixture = addFixture(body, p, local, kind === "dynamic", lone)
			const m: Member = { part: p, body, local, fixture, lone, center: memberCenter(p, local) }
			group.push(m)
			members.push(m)
			memberOf.set(p.id, m)
		}
		// A group of several parts: its mass, centre and inertia summed from its parts' own (a ball's as a
		// lone ball's below, a slab's or a polygon's as planck reckons its fixture's).
		if (kind === "dynamic" && !lone) body.setMassData(groupMass(group))
		// Angular damping (a solid's `angularDamping`, 1/s, the largest of its group's): its turning slows as dω/dt = −c·ω, planck's own
		// implicit damping (ω ÷ (1 + c·h) each step), as a raw egg's liquid slows its rocking. None unless set.
		const spin = Math.max(0, ...parts.map((p) => p.angularDamping ?? 0))
		if (spin > 0) body.setAngularDamping(spin)
	}
	// (`members` is in the order the scene lists its solids.)
	members.sort((a, b) => scene.solids.indexOf(a.part) - scene.solids.indexOf(b.part))
	const bodies = members
	// A clip layer's hitbox is a kinematic body: it moves exactly as the clip's leading edge does,
	// and nothing it touches moves it. It carries a stand-in part so contacts find its material.
	const hitboxes = scene.layers.flatMap((layer) => {
		const hitbox = layer.hitbox
		if (hitbox === undefined) return []
		const height = hitbox.to - hitbox.from
		const side = hitbox.edge === "right" ? -1 : 1
		// Set back by the gap Box2D keeps between two polygons, so the clip's drawn edge meets what it pushes.
		const skin = (2 * Settings.polygonRadius - Settings.linearSlop) / LENGTH_SCALE
		const centerAt = (t: number) => {
			const edge = hitboxEdgeAt(layer, hitbox, t)
			return edge === undefined
				? undefined
				: { x: layer.at.x + edge + side * (HITBOX_DEPTH / 2 + skin), y: layer.at.y + (hitbox.from + hitbox.to) / 2 }
		}
		const start = centerAt(0)
		const part: SolidPart = {
			kind: "static",
			id: `${layer.id}-hitbox`,
			words: layer.words,
			sprite: `${layer.id}-hitbox`,
			body: { kind: "slab", width: HITBOX_DEPTH, height, depth: 0.1 },
			material: hitbox.material,
			at: start ?? { x: 0, y: 0 },
			placeholder: { fill: "#888" },
			render: { kind: "procedural", shade: "#888" },
			depth: layer.depth
		}
		const from = start ?? { x: 0, y: 0 }
		const body = world.createBody({ type: "kinematic", position: new Vec2(from.x * LENGTH_SCALE, from.y * LENGTH_SCALE) })
		body.createFixture(new BoxShape((HITBOX_DEPTH / 2) * LENGTH_SCALE, (height / 2) * LENGTH_SCALE), { userData: { part } })
		body.setActive(start !== undefined)
		return [{ body, centerAt }]
	})
	/**
	 * Each hitbox's velocity for the coming step, so it arrives where the clip's edge will be; off
	 * while the subject is out of its band, and placed where it comes back in.
	 */
	const steerHitboxes = (t: number) => {
		for (const { body, centerAt } of hitboxes) {
			const next = centerAt(t + STEP)
			if (next === undefined) {
				body.setActive(false)
				continue
			}
			if (!body.isActive()) {
				body.setTransform(new Vec2(next.x * LENGTH_SCALE, next.y * LENGTH_SCALE), 0)
				body.setLinearVelocity(new Vec2(0, 0))
				body.setActive(true)
				continue
			}
			const p = body.getPosition()
			body.setLinearVelocity(new Vec2((next.x * LENGTH_SCALE - p.x) / STEP, (next.y * LENGTH_SCALE - p.y) / STEP))
		}
	}

	// A pivoted part turns on a frictionless hinge at its pivot, joined to its parent's body or to the
	// world; a part with a parent and no pivot is part of its parent's body (its weld group, above).
	const world0 = world.createBody()
	// A motor's torque in planck's units: newton-meters times LENGTH_SCALE² (force and arm both scale).
	const driven = (motor: Motor | undefined) =>
		motor === undefined ? {} : { enableMotor: true, motorSpeed: motor.speed, maxMotorTorque: motor.torque * LENGTH_SCALE * LENGTH_SCALE }
	/**
	 * Two solids joined directly by a joint (a hinge, a rope, a pin, a wheel's axle) never collide, as planck
	 * keeps two jointed bodies apart. A joint between two lone parts is left to planck; one that reaches into a
	 * weld group keeps only those two parts apart, not the whole groups (a pinned arm still lands on a stop
	 * welded to the post it turns on): its pair is listed here and filtered fixture by fixture.
	 */
	const apart = new Set<string>()
	const pairKey = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`)
	/** Whether a joint between these two solids (null: the world) keeps them apart in planck's own way, true, or needs `apart`. */
	const lonePair = (a: string | null, b: string | null) => {
		const ma = a === null ? undefined : memberOf.get(a)
		const mb = b === null ? undefined : memberOf.get(b)
		if ((ma === undefined || ma.lone) && (mb === undefined || mb.lone)) return true
		if (a !== null && b !== null) apart.add(pairKey(a, b))
		return false
	}
	for (const { part, body } of bodies) {
		if (part.pivot === undefined) continue
		const to = part.parent === undefined ? world0 : memberOf.get(part.parent)?.body
		if (to === undefined) continue
		// (A pivoted part is the root of its group, so its own frame is its body's.)
		const anchor = body.getWorldPoint(new Vec2(part.pivot.x * LENGTH_SCALE, part.pivot.y * LENGTH_SCALE))
		const lone = lonePair(part.parent ?? null, part.id)
		world.createJoint(new Hinge({ ...driven(part.motor), ...(lone ? {} : { collideConnected: true }) }, to, body, anchor))
	}

	// The document's joints. A solid side is its group's body, the world side `world0`, whose frame is the
	// world's, so a world anchor scales straight into its local frame; a solid's anchor is in its own frame,
	// carried into its group body's by its pose in the group.
	const bodyOf = (id: string | null) => (id === null ? world0 : (memberOf.get(id)?.body ?? world0))
	const local = (p: Vec) => new Vec2(p.x * LENGTH_SCALE, p.y * LENGTH_SCALE)
	/** A point given in a solid's own frame (or, for the world, a world point) in its body's frame, planck units. */
	const anchorOn = (id: string | null, p: Vec) => {
		const m = id === null ? undefined : memberOf.get(id)
		return m === undefined || m.local === IDENTITY ? local(p) : local(compose(m.local, { at: p, angle: 0 }).at)
	}
	/** A direction given in a solid's own frame, in its body's frame. */
	const directionOn = (id: string | null, d: Vec) => {
		const m = id === null ? undefined : memberOf.get(id)
		if (m === undefined || m.local === IDENTITY) return new Vec2(d.x, d.y)
		const c = Math.cos(m.local.angle)
		const s = Math.sin(m.local.angle)
		return new Vec2(d.x * c - d.y * s, d.x * s + d.y * c)
	}
	/** Whether both ends are parts of one rigid body: a joint between them does nothing (and planck cannot join a body to itself). */
	const oneBody = (a: string | null, b: string | null) => a !== null && b !== null && memberOf.get(a) !== undefined && memberOf.get(a)?.body === memberOf.get(b)?.body
	const inverseMass = (body: Body) => (body.isDynamic() ? 1 / body.getMass() : 0)
	const inverseInertia = (body: Body) => {
		if (!body.isDynamic()) return 0
		const c = body.getLocalCenter()
		const spin = body.getInertia() - body.getMass() * Vec2.dot(c, c)
		return spin > 0 ? 1 / spin : 0
	}
	/** The mass a pull along `u` at world point `p` on these bodies meets, kg (lever arms in planck's units cancel). */
	const massAlong = (ends: readonly { body: Body; p: Vec2 }[], u: Vec2) => {
		const inverse = ends.reduce(
			(sum, { body, p }) => sum + inverseMass(body) + inverseInertia(body) * Vec2.cross(Vec2.sub(p, body.getWorldCenter()), u) ** 2,
			0
		)
		return inverse > 0 ? 1 / inverse : Number.POSITIVE_INFINITY
	}
	const joints = scene.joints ?? []
	/**
	 * A spring's own mass (a spring joint's `mass`, kg) moves with what it pushes: its coils move from not at all at a fixed end to all of
	 * the way at a moving one. The engine gives it a uniform spring's inertia and weight where they act:
	 * - One end fixed: the moving end carries the inertia of the spring's fundamental mode, m_e = mₛ/β² − m with β·tan β = mₛ/m (m the
	 *   body's own mass; the exact period of a mass on a uniform spring, 2π√((m + m_e)/k): Rayleigh's mₛ/3 for a light spring, up to
	 *   0.405·mₛ for a heavy one), added to its body at the anchor; and half the spring's weight (the fixed end holds the other half: a
	 *   pad's plate settles (m + mₛ/2)·g/k down, a hanging weight (m + mₛ/2)·g/k), the weight beyond m_e's own applied at the anchor
	 *   (`springWeight`). Springs from fixed points to one body (a plate's two) are reckoned together.
	 * - Both ends moving: a uniform bar's consistent mass, mₛ/6 at each end and 2mₛ/3 at the middle of its anchors moving as they do
	 *   (`SpringMass`): the whole mₛ moves with the pair, its stretching swing carries mₛ/6 at each end (Rayleigh's), and each end holds half
	 *   its weight.
	 * A lumped end mass is true to a real spring only while the spring is light against what it moves: a launcher whose steel outweighs
	 * its plate and ball throws slower than any lumped mass gives (the coil's release wave limits it to x₀·√(k/mₛ)). The catalog keeps
	 * its springs where mₛ/3 is at most 0.3 of the plate and a light ball (machines/catalog_mechanisms.py `_spring_cap`): there a
	 * launcher's throw is within 2.5 % of a 400-node coil (research/rw-validate-p4.ts `mass`).
	 */
	const springWeights: { body: Body; anchor: Vec2; force: number }[] = []
	{
		const addMass = (body: Body, p: Vec2, share: number) => {
			const md = { mass: 0, center: new Vec2(0, 0), I: 0 }
			body.getMassData(md)
			const total = md.mass + share
			body.setMassData({
				mass: total,
				center: new Vec2((md.mass * md.center.x + share * p.x) / total, (md.mass * md.center.y + share * p.y) / total),
				I: md.I + share * (p.x * p.x + p.y * p.y)
			})
		}
		const fixedEnd = new Map<Body, { anchor: Vec2; mass: number }[]>()
		const bothEnds: { a: Body; b: Body; la: Vec2; lb: Vec2; mass: number }[] = []
		for (const joint of joints) {
			if (joint.kind !== "spring" || !((joint.mass ?? 0) > 0) || oneBody(joint.a, joint.b)) continue
			const mass = joint.mass ?? 0
			const a = bodyOf(joint.a)
			const b = bodyOf(joint.b)
			if (a.isDynamic() && b.isDynamic()) bothEnds.push({ a, b, la: anchorOn(joint.a, joint.anchorA), lb: anchorOn(joint.b, joint.anchorB), mass })
			else if (a.isDynamic() || b.isDynamic()) {
				const [body, anchor] = a.isDynamic() ? [a, anchorOn(joint.a, joint.anchorA)] : [b, anchorOn(joint.b, joint.anchorB)]
				fixedEnd.set(body, [...(fixedEnd.get(body) ?? []), { anchor, mass }])
			}
		}
		// (each body's own mass, before any spring's is added)
		const own = new Map<Body, number>([...fixedEnd.keys()].map((body) => [body, body.getMass()]))
		for (const [body, springs] of fixedEnd) {
			const total = springs.reduce((sum, s) => sum + s.mass, 0)
			const m = own.get(body) ?? 0
			const beta = fundamentalMode(total / m)
			// (a light spring's m_e is mₛ/3 to the last digit's noise; m tiny against mₛ: 4mₛ/π² − m)
			const inertia = m > 0 && Number.isFinite(beta) ? total / (beta * beta) - m : total / 3
			for (const s of springs) {
				const share = (inertia * s.mass) / total
				addMass(body, s.anchor, share)
				springWeights.push({ body, anchor: s.anchor, force: (s.mass / 2 - share) * runGravity })
			}
		}
		for (const s of bothEnds) {
			addMass(s.a, s.la, s.mass / 6)
			addMass(s.b, s.lb, s.mass / 6)
			world.createJoint(new SpringMass(s.a, s.b, s.la, s.lb, (2 * s.mass) / 3))
		}
	}
	const parentLinks = scene.solids.flatMap((s) => (s.parent === undefined ? [] : [[s.id, s.parent] as const]))
	const jointLinks = joints.flatMap((j) => {
		const [p, q] = j.kind === "wheel" ? [j.chassis, j.wheel] : [j.a, j.b]
		return p === null || q === null ? [] : [[p, q] as const]
	})
	/** Every dynamic solid linked to a part through these links (the part's own included). */
	const joined = (part: SolidPart, links: readonly (readonly [string, string])[]) => {
		const members = new Set([part.id])
		for (let grew = true; grew; ) {
			grew = false
			for (const [p, q] of links) {
				if (members.has(p) === members.has(q)) continue
				members.add(p)
				members.add(q)
				grew = true
			}
		}
		return scene.solids.filter((s) => members.has(s.id) && s.kind === "dynamic")
	}
	/** The weight of every dynamic solid linked to a part through these links, N. */
	const weightJoined = (part: SolidPart, links: readonly (readonly [string, string])[]) => joined(part, links).reduce((sum, s) => sum + massOf(s), 0) * runGravity
	/**
	 * The static load each wheel of a moving chassis carries on level ground, kg, by its joint's id: the weight of what the chassis
	 * carries (its assembly, wheels apart) shared so that the wheels hold it level, as springs of the same sag would. x is a place
	 * along the chassis, across the wheels' suspension axis (its frame's x for the usual upright axis), so the springs are the
	 * vehicle's own, as a real car's, whatever slope it starts on. The shares are a straight line in x, add up to the whole and
	 * have no moment about the centre of mass: W_i = W·(1/n + (x_i − x̄)(x_cg − x̄)/Σ(x_j − x̄)²); for two wheels the lever
	 * rule, W·(x_cg − x_other)/(x_i − x_other). A centre of mass beyond the wheels would tip the vehicle: no wheel is given less
	 * than 2% of the whole (a spring that holds).
	 */
	const wheelLoads = (() => {
		const loads = new Map<string, number>()
		const byChassis = new Map<string, Extract<Joint, { kind: "wheel" }>[]>()
		for (const j of joints) if (j.kind === "wheel" && j.chassis !== null && !oneBody(j.chassis, j.wheel)) byChassis.set(j.chassis, [...(byChassis.get(j.chassis) ?? []), j])
		for (const [id, wheels] of byChassis) {
			const chassis = solidById.get(id)
			if (chassis === undefined || chassis.kind !== "dynamic") continue
			const carried = joined(chassis, parentLinks)
			const total = carried.reduce((sum, s) => sum + massOf(s), 0)
			// its centre of mass, from each part's own middle where it starts (world, m)
			let mx = 0
			let my = 0
			for (const part of carried) {
				const m = memberOf.get(part.id)
				if (m === undefined) continue
				const p = m.body.getWorldPoint(m.center)
				mx += massOf(part) * (p.x / LENGTH_SCALE)
				my += massOf(part) * (p.y / LENGTH_SCALE)
			}
			// its centre of mass in the chassis's frame, and the direction across the (first) wheel's suspension axis there
			const pose = start(id)
			const cx = (total > 0 ? mx / total : pose.at.x) - pose.at.x
			const cy = (total > 0 ? my / total : pose.at.y) - pose.at.y
			const c = Math.cos(pose.angle)
			const sn = Math.sin(pose.angle)
			const cg = { x: cx * c + cy * sn, y: -cx * sn + cy * c }
			const axis = wheels[0]?.axis ?? { x: 0, y: 1 }
			const norm = Math.hypot(axis.x, axis.y)
			const across = { x: axis.y / norm, y: -axis.x / norm }
			const xcg = cg.x * across.x + cg.y * across.y
			const xs = wheels.map((w) => w.anchor.x * across.x + w.anchor.y * across.y)
			const n = wheels.length
			const mean = xs.reduce((a, b) => a + b, 0) / n
			const spread = xs.reduce((a, x) => a + (x - mean) * (x - mean), 0)
			wheels.forEach((w, i) => {
				const x = xs[i] as number
				const share = n === 1 || spread < 1e-12 ? 1 / n : 1 / n + ((x - mean) * (xcg - mean)) / spread
				loads.set(w.id, total * Math.max(0.02, share))
			})
		}
		return loads
	})()
	/**
	 * The shortest a pulley's run can get by default, m: hauled straight up its run (toward its ground point `g`), its
	 * body (every part of its weld group) first meets its wheel there, a circle of `wheel` radius at the ground point's
	 * height, its rim on the run (it hangs inboard of it, toward the other run's ground point `other`); with no wheel radius,
	 * where its top reaches the ground point's height. The run never gets shorter than 1 mm.
	 */
	const ropeEndClearance = (id: string | null, anchor: Vec2, g: Vec2, other: Vec2, wheel: number | undefined) => {
		const m = id === null ? undefined : memberOf.get(id)
		if (m === undefined) return 0.001
		const body = m.body
		const p = body.getWorldPoint(anchor)
		const run = Vec2.distance(p, g)
		if (run === 0) return 0.001
		// w: up the run, from the anchor toward the ground point; the wheel's centre inboard of the run by its radius
		const w = new Vec2((g.x - p.x) / run, (g.y - p.y) / run)
		const R = (wheel ?? 0) * LENGTH_SCALE
		const side = other.x === g.x ? 1 : Math.sign(other.x - g.x)
		const o = new Vec2(g.x + side * R, g.y)
		let rise = run
		for (const q of members.filter((x) => x.body === body)) {
			const pose = { at: { x: body.getPosition().x / LENGTH_SCALE, y: body.getPosition().y / LENGTH_SCALE }, angle: body.getAngle() }
			const inWorld = compose(pose, q.local)
			const outline =
				q.part.body.kind === "ball"
					? [{ x: 0, y: 0 }]
					: outlineOf(q.part.body).flatMap((a, k, all) => {
							const b = all[(k + 1) % all.length] ?? a
							const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.001))
							return Array.from({ length: n }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }))
						})
			const grow = q.part.body.kind === "ball" ? q.part.body.radius * LENGTH_SCALE : 0
			for (const pt of outline) {
				const at = compose(inWorld, { at: pt, angle: 0 }).at
				const x = at.x * LENGTH_SCALE - o.x
				const y = at.y * LENGTH_SCALE - o.y
				if (R + grow > 0) {
					// the first t ≥ 0 at which |q + t·w − o| = R (+ a ball's radius): t² + 2bt + c = 0
					const b = x * w.x + y * w.y
					const c = x * x + y * y - (R + grow) * (R + grow)
					if (c <= 0) continue
					const disc = b * b - c
					if (disc < 0 || -b - Math.sqrt(disc) < 0) continue
					rise = Math.min(rise, -b - Math.sqrt(disc))
				} else {
					// no wheel: its top meets the ground point's height
					rise = Math.min(rise, Math.max(0, (g.x - at.x * LENGTH_SCALE) * w.x + (g.y - at.y * LENGTH_SCALE) * w.y))
				}
			}
		}
		return Math.max(0.001, (run - rise) / LENGTH_SCALE)
	}
	const springJoints: SpringLink[] = []
	const chains: ChainRope[] = []
	for (const joint of joints) {
		const [sideA, sideB] = joint.kind === "wheel" ? [joint.chassis, joint.wheel] : [joint.a, joint.b]
		// Both ends on one rigid body: its parts cannot move against each other, so the joint has nothing to do.
		if (oneBody(sideA, sideB)) continue
		if (joint.kind === "spring") {
			const a = bodyOf(joint.a)
			const b = bodyOf(joint.b)
			const la = anchorOn(joint.a, joint.anchorA)
			const lb = anchorOn(joint.b, joint.anchorB)
			if (!a.isDynamic() && !b.isDynamic()) continue
			const link = world.createJoint(new SpringLink(a, b, la, lb, joint)) as SpringLink
			springJoints.push(link)
			// A spring too stiff for even SUB_MAX sub-steps to follow (`subSteps`) is said once, so a scene that relies on its period can be
			// softened (or what it moves made heavier): past a sub-step's ω·h of √2 (a = 2, `tuneSprings`) a share of it is solved
			// implicitly, steady at any stiffness, but its bounce is slowed and damped; from 0.35 its period is over 0.5 % short,
			// 1 − ω·h/(2·asin(ω·h/2)), and its swing reaches 1/√(1 − (ω·h/2)²) of its release on the far side.
			const pa = a.getWorldPoint(la)
			const pb = b.getWorldPoint(lb)
			const line = Vec2.sub(pb, pa)
			const u = line.length() > 0 ? Vec2.mul(1 / line.length(), line) : new Vec2(0, 1)
			const m = massAlong([{ body: a, p: pa }, { body: b, p: pb }], u)
			const omegaDt = (Math.sqrt(joint.stiffness / m) * STEP) / SUB_MAX
			if (omegaDt > Math.SQRT2) {
				console.warn(
					`spring ${joint.id}: ${joint.stiffness} N/m on ${m.toPrecision(3)} kg is too stiff for ${SUB_MAX} sub-steps of a ${Math.round(1 / STEP)} Hz step to keep its period ` +
						`(ω·h ${omegaDt.toFixed(2)}, followed up to 1.41): it stays steady (part of it is solved implicitly), but its bounce is slowed and damped. Soften it or make what it moves heavier.`
				)
			} else if (omegaDt > 0.35) {
				const short = 1 - omegaDt / (2 * Math.asin(omegaDt / 2))
				const over = 1 / Math.sqrt(1 - (omegaDt / 2) ** 2) - 1
				console.warn(
					`spring ${joint.id}: ${joint.stiffness} N/m on ${m.toPrecision(3)} kg swings fast even for ${SUB_MAX} sub-steps of a ${Math.round(1 / STEP)} Hz step (ω·h ${omegaDt.toFixed(2)}): ` +
						`its period comes out ${(short * 100).toFixed(1)}% short and its swing up to ${(over * 100).toFixed(1)}% wide. Soften it or make what it moves heavier for a true period.`
				)
			}
		} else if (joint.kind === "rope") {
			const lone = lonePair(joint.a, joint.b)
			const A = bodyOf(joint.a)
			const B = bodyOf(joint.b)
			const la = anchorOn(joint.a, joint.anchorA)
			const lb = anchorOn(joint.b, joint.anchorB)
			world.createJoint(new Cord({ bodyA: A, bodyB: B, localAnchorA: la, localAnchorB: lb, maxLength: joint.length * LENGTH_SCALE, ...(lone ? {} : { collideConnected: true }) }))
			// a chain (or a rope flagged to) collides: a band as wide as the view draws its face-on links (1.775 wire diameters each side
			// of its line, the wire 1.5 × its thickness, 4 to 12 mm), or, for a rope, its thickness
			const chain = joint.render?.style === "chain"
			if (chain || joint.collide === true) {
				const t = joint.thickness ?? 0.004
				const radius = chain ? 1.775 * Math.max(0.004, Math.min(0.012, 1.5 * t)) : t / 2
				chains.push({ A, B, la, lb, length: joint.length * LENGTH_SCALE, radius: radius * LENGTH_SCALE, carrier: B.isDynamic() ? B : A, touches: new Map() })
			}
		} else if (joint.kind === "pin") {
			const lone = lonePair(joint.a, joint.b)
			world.createJoint(
				new Hinge({
					bodyA: bodyOf(joint.a),
					bodyB: bodyOf(joint.b),
					localAnchorA: anchorOn(joint.a, joint.anchorA),
					localAnchorB: anchorOn(joint.b, joint.anchorB),
					...driven(joint.motor),
					...(joint.friction === undefined ? {} : { friction: joint.friction }),
					...(joint.damping === undefined ? {} : { damping: joint.damping }),
					...(joint.limits === undefined ? {} : { enableLimit: true, lowerAngle: joint.limits.lower, upperAngle: joint.limits.upper }),
					...(lone ? {} : { collideConnected: true })
				})
			)
		} else if (joint.kind === "wheel") {
			const chassis = bodyOf(joint.chassis)
			const wheel = bodyOf(joint.wheel)
			const lone = lonePair(joint.chassis, joint.wheel)
			const hub = anchorOn(joint.wheel, { x: 0, y: 0 })
			const at = {
				bodyA: chassis,
				bodyB: wheel,
				localAnchorA: anchorOn(joint.chassis, joint.anchor),
				localAnchorB: hub,
				...driven(joint.motor),
				...(lone ? {} : { collideConnected: true })
			}
			if (joint.frequency <= 0) {
				world.createJoint(new Hinge(at))
				continue
			}
			// planck's suspension frequency is that of the chassis and wheel bouncing on each other along the
			// axis; the document's is that of the load the wheel carries (its share of a moving chassis, or the
			// wheel on a fixed one), so its stiffness is k = load·(2πf)², and it is rescaled to planck's.
			const given = directionOn(joint.chassis, joint.axis)
			const axis = Vec2.mul(1 / Math.hypot(given.x, given.y), given)
			const u = chassis.getWorldVector(axis)
			const centre = wheel.getWorldPoint(hub)
			const inverse = 1 / massAlong([{ body: chassis, p: centre }, { body: wheel, p: centre }], u)
			const load = wheelLoads.get(joint.id) ?? wheel.getMass()
			const scale = inverse > 0 && load > 0 ? Math.sqrt(load * inverse) : 1
			world.createJoint(
				new WheelJoint({ ...at, localAxisA: axis, frequencyHz: joint.frequency * scale, dampingRatio: joint.damping * scale })
			)
		} else {
			const a = bodyOf(joint.a)
			const b = bodyOf(joint.b)
			const la = anchorOn(joint.a, joint.anchorA)
			const lb = anchorOn(joint.b, joint.anchorB)
			const ga = local(joint.groundA)
			const gb = local(joint.groundB)
			// how short each run may get: the document's, else where its body, hauled straight up its run, first meets its wheel
			const minA = joint.minLengthA ?? ropeEndClearance(joint.a, la, ga, gb, joint.wheelRadius)
			const minB = joint.minLengthB ?? ropeEndClearance(joint.b, lb, gb, ga, joint.wheelRadius)
			world.createJoint(new RopePulley(a, b, ga, gb, la, lb, joint.ratio, minA * LENGTH_SCALE, minB * LENGTH_SCALE))
		}
	}
	// Hinges with friction or damping joined to other hinges through moving bodies (an arm's shoulder and elbow): solved together (`HingeGroup`).
	groupHinges(world)
	// The pairs a joint keeps apart inside weld groups: each of their fixtures refuses the other's.
	for (const id of new Set([...apart].flatMap((k) => k.split("\u0000")))) {
		const fixture = memberOf.get(id)?.fixture
		if (fixture === undefined) continue
		fixture.shouldCollide = function (this: Fixture, that: Fixture) {
			const a = this.getUserData()
			const b = that.getUserData()
			if (isTag(a) && isTag(b) && apart.has(pairKey(a.part.id, b.part.id))) return false
			return Fixture.prototype.shouldCollide.call(this, that)
		}
	}

	const pairOf = (touch: Touch) => {
		const a = touch.getFixtureA().getUserData()
		const b = touch.getFixtureB().getUserData()
		return isTag(a) && isTag(b) ? { a: a.part, b: b.part, contact: contactOf(scene, a.part.material, b.part.material) } : undefined
	}

	/**
	 * Whether planck's continuous (time-of-impact) pass is running: a bullet's impact found there is solved after the step's
	 * gravity is already in its velocity, so its sampled approach needs no correction.
	 */
	let continuous = false
	/** The (sub-)step being solved, s: STEP, or a share of it where a stiff spring needs finer steps (`subSteps`). */
	let h = STEP
	const solver = (world as unknown as { m_solver: { solveWorldTOI: (step: unknown) => void; solveIslandTOI: (...args: unknown[]) => void; solveIsland: (step: unknown) => void } }).m_solver
	const solveTOI = solver.solveWorldTOI.bind(solver)
	/**
	 * At most TOI_EVENTS impacts a step for the time-of-impact pass to solve one by one (each scans every contact again), and at most
	 * BODY_TOI for any one body: a scene solves a few at most (the wrecking ball's tumbling bricks 27), but a body wedged among fixed
	 * solids strikes them again and again within the step (a handle wedged against a fixed ball and a wheel set off 122,432 impacts in
	 * 1.5 s, which no global cap of 64 a step stopped: a 3 s run took 51 to 329 s). Past either the body's contacts, or every contact,
	 * sit the pass out, and what is left is the next step's (planck's pass skips a contact that has had its share of events).
	 */
	let toiEvents = 0
	let toiCap = TOI_EVENTS
	const toiOf = new Map<Body, number>()
	/** The bodies that used all their impacts in the step before (wedged). */
	const wedged = new Set<Body>()
	const spent = (c: Touch) => {
		;(c as unknown as { m_toiCount: number }).m_toiCount = Settings.maxSubSteps + 1
	}
	/**
	 * Impacts solved for nothing. The time-of-impact pass counts two solids as striking at the very start of their paths when they are
	 * nearer than its own target (0.5 mm between polygons' outlines, 0.625 with its tolerance): solids placed exactly touching, or 0.5 mm
	 * apart (Box2D's skin rests a pair 1.5 mm apart). For such a strike it moves every body of the island back to where the step began,
	 * losing what the step's solve did to part them, and parts only those two, holding every other moving body where it is: a block
	 * between the table and the block on it cannot get clear, so the same strike comes back up to nine times a step, each time moving
	 * the block sideways (a 10-block stack placed touching fell over within 6 s; the wrecking-ball scenario's bricks, 0.5 mm apart,
	 * walked 3 mm before the ball came). So a strike that gets nowhere on a pair at rest inside the target is undone (`undoable`): the solve
	 * held the contact as the step began (`held`), its two solids were inside the target where the step began (`began`) and are at rest
	 * where they touch (`still`: slower than VELOCITY_THRESHOLD), and the strike leaves them still inside the target. Its island goes back
	 * to where the pass found it (each body's path before the pass moved it back, `before`, and its motion; what its contacts recorded), the
	 * contact sits out the rest of the pass, and from then on, while the pair stays so, the pass leaves it to the solve (`stuck`); the solve
	 * parts them over the next steps, as it parts a pair placed 1 mm apart. A strike that gets its pair clear (a domino set exactly on the
	 * table, lifted out of its skin at once) is kept, and so is every strike on a pair that moves or began the step apart: a real one, which
	 * the pass is there to catch, and those an impact drives through a stack (squeezed, a stack's pairs stay inside the target, as the pass
	 * parts only two bodies at a time, so the strikes of the next steps begin inside as well: undone too, a heavy ball sank deeper into a
	 * struck stack and a phone passed down through another).
	 */
	const held = new Set<Touch>()
	const stuck = new Set<Touch>()
	/** Each body's path before the pass last moved it back along it (planck's `advance`), stamped with the strike it was moved for. */
	const before = new Map<Body, { sweep: Sweep; stamp: number }>()
	/** Where each moving body stood as the step began (before its solve). */
	const began = new Map<Body, Transform>()
	let stamp = 0
	for (let b = world.getBodyList(); b !== null; b = b.getNext()) {
		const body = b
		const was = { sweep: new Sweep(), stamp: -1 }
		before.set(body, was)
		if (!body.isStatic()) began.set(body, Transform.clone(body.getTransform()))
		const advance = body.advance.bind(body)
		body.advance = (alpha: number) => {
			was.sweep.set(sweepOf(body))
			was.stamp = stamp
			advance(alpha)
		}
	}
	const distanceInput = new DistanceInput()
	const distanceOutput = new DistanceOutput()
	const startA = new Transform()
	const startB = new Transform()
	/** Whether a contact's two solids are nearer than the pass's target (TimeOfImpact's own test) where their paths now begin, or where the step began. */
	const inside = (c: Touch, asBegun = false) => {
		const fA = c.getFixtureA()
		const fB = c.getFixtureB()
		distanceInput.proxyA.set(fA.getShape(), c.getChildIndexA())
		distanceInput.proxyB.set(fB.getShape(), c.getChildIndexB())
		if (asBegun) {
			startA.set(began.get(fA.getBody()) ?? fA.getBody().getTransform())
			startB.set(began.get(fB.getBody()) ?? fB.getBody().getTransform())
		} else {
			sweepOf(fA.getBody()).getTransform(startA, 0)
			sweepOf(fB.getBody()).getTransform(startB, 0)
		}
		distanceInput.transformA = startA
		distanceInput.transformB = startB
		distanceInput.useRadii = false
		Distance(distanceOutput, new SimplexCache(), distanceInput)
		const radii = (distanceInput.proxyA as unknown as { m_radius: number }).m_radius + (distanceInput.proxyB as unknown as { m_radius: number }).m_radius
		return distanceOutput.distance < Math.max(Settings.linearSlop, radii - 3 * Settings.linearSlop) + 0.25 * Settings.linearSlop
	}
	/** Whether a contact's two solids are at rest where they touch: both slower than VELOCITY_THRESHOLD (an impact's speed) at each of its points. */
	const still = (c: Touch) => {
		const wm = c.getWorldManifold(null)
		const fast = VELOCITY_THRESHOLD * LENGTH_SCALE
		for (let i = 0; wm !== null && wm !== undefined && i < wm.pointCount; i++) {
			const point = wm.points[i]
			if (point === undefined) continue
			for (const body of [c.getFixtureA().getBody(), c.getFixtureB().getBody()]) {
				const v = body.getLinearVelocityFromWorldPoint(point)
				if (v.x * v.x + v.y * v.y >= fast * fast) return false
			}
		}
		return true
	}
	/** A strike the pass would solve for nothing: on a contact the solve held, its pair at rest inside the target where the step began. */
	const undoable = (c: Touch) => held.has(c) && inside(c, true) && still(c)
	const solveIslandTOI = solver.solveIslandTOI.bind(solver)
	solver.solveIslandTOI = (...args: unknown[]) => {
		const island = solver as unknown as Island
		const contact = island.m_contacts[0]
		// (a strike that may get nowhere: the island as the pass found it, to put back if it does)
		let kept: { body: Body; sweep: Sweep; v: Vec2; w: number }[] | undefined
		if (contact !== undefined && undoable(contact)) {
			kept = []
			for (const body of island.m_bodies) {
				const was = before.get(body)
				if (was === undefined || was.stamp !== stamp) {
					kept = undefined
					break
				}
				kept.push({ body, sweep: was.sweep, v: Vec2.clone(motion(body).m_linearVelocity), w: motion(body).m_angularVelocity })
			}
		}
		// (and what its contacts would record: their pushes, the strikes passed on through them, a Garwin spring's impulses, the impulses
		// kept for warm starting (post-solve drops an over-large one); and the impacts it lists)
		const records =
			kept === undefined
				? []
				: island.m_contacts.map((c) => {
						const spring = springs.get(c)
						const m = c.getManifold()
						return {
							push: pressed.get(c),
							pass: passed.get(c),
							spring: spring === undefined ? undefined : ([spring.normalImpulse, spring.tangentImpulse] as const),
							stored: Array.from({ length: m.pointCount }, (_, k) => [m.points[k]?.normalImpulse ?? 0, m.points[k]?.tangentImpulse ?? 0] as const)
						}
					})
		const listed = hits.length
		const loudest = impacts.get(stepIndex)
		propagate(island)
		solveIslandTOI(...args)
		if (kept !== undefined && contact !== undefined && inside(contact)) {
			for (const { body, sweep, v, w } of kept) {
				sweepOf(body).set(sweep)
				body.synchronizeTransform()
				motion(body).m_linearVelocity.set(v)
				motion(body).m_angularVelocity = w
			}
			island.m_contacts.forEach((c, i) => {
				const was = records[i]
				if (was === undefined) return
				if (was.push === undefined) pressed.delete(c)
				else pressed.set(c, was.push)
				if (was.pass === undefined) passed.delete(c)
				else passed.set(c, was.pass)
				const spring = springs.get(c)
				if (spring !== undefined && was.spring !== undefined) [spring.normalImpulse, spring.tangentImpulse] = was.spring
				const m = c.getManifold()
				was.stored.forEach(([normal, tangent], k) => {
					const p = m.points[k]
					if (p === undefined) return
					p.normalImpulse = normal
					p.tangentImpulse = tangent
				})
			})
			hits.length = listed
			if (loudest === undefined) impacts.delete(stepIndex)
			else impacts.set(stepIndex, loudest)
			contact.setEnabled(false)
			stuck.add(contact)
		}
		stamp++
		for (const body of [args[1], args[2]] as Body[]) {
			if (!body.isDynamic()) continue
			const n = (toiOf.get(body) ?? 0) + 1
			toiOf.set(body, n)
			if (n >= (wedged.has(body) ? BODY_TOI_WEDGED : BODY_TOI)) for (let e = body.getContactList(); e !== null; e = e.next) spent(e.contact)
		}
		if (++toiEvents < toiCap) return
		for (let c = world.getContactList(); c !== null; c = c.getNext()) spent(c)
	}
	/** Modules' calls right after the main solve (EngineInternals.afterSolve: force arrows read the step's contact impulses there); none in a plain run. */
	const solvedHooks: (() => void)[] = []
	solver.solveWorldTOI = (step) => {
		for (const f of solvedHooks) f()
		// The time-of-impact pass ignores joints, so it would solve a hinged part's impacts as if it were
		// loose. Its contacts sit this pass out (each step re-enables them before the main solve, which
		// keeps the hinge); at 480 Hz nothing jointed moves far enough in one step to pass through anything.
		// (A spring, or a chain a body touches, is no hinge: a sprung plate keeps its continuous collision.)
		for (let c = world.getContactList(); c !== null; c = c.getNext()) {
			if (hinged(c.getFixtureA().getBody()) || hinged(c.getFixtureB().getBody())) c.setEnabled(false)
		}
		// (planck's pass cannot take a body whose motion is not a number: it throws deep inside, with nothing to say what)
		unsound("solved")
		toiEvents = 0
		toiCap = Math.min(TOI_EVENTS, Math.max(BODY_TOI, Math.floor(TOI_WORK / Math.max(1, world.getContactCount()))))
		// (a body that used up its impacts last step stays wedged while it goes on using up its fewer ones)
		for (const body of [...wedged]) if ((toiOf.get(body) ?? 0) < BODY_TOI_WEDGED) wedged.delete(body)
		for (const [body, n] of toiOf) if (n >= BODY_TOI) wedged.add(body)
		toiOf.clear()
		continuous = true
		try {
			solveTOI(step)
		} finally {
			continuous = false
		}
	}
	/**
	 * The restitution a contact gets this step (pre-solve): e on an impact, none on a touch. Box2D computes a rebound from the
	 * velocity after this step's gravity, so every bounce off fixed ground would gain a step of gravity and a bouncy ball would never
	 * come to rest: the restitution is rescaled so the rebound is e times the approach speed as the step begins (the Prism lab's
	 * compensation). In the time-of-impact pass the struck bodies have moved through the step: its approach is as sampled there.
	 */
	const compensated = (touch: Touch, e: number, old: Manifold) => {
		const wm = touch.getWorldManifold(null)
		if (e === 0 || (wm === null || wm === undefined) || wm.pointCount === 0) return e
		const manifold = touch.getManifold()
		const bodyA = touch.getFixtureA().getBody()
		const bodyB = touch.getFixtureB().getBody()
		let approach = 0
		for (let i = 0; i < wm.pointCount; i++) {
			const point = wm.points[i]
			const id = manifold.points[i]?.id.key
			if (point === undefined || id === undefined) continue
			// only a point that is new this step strikes: one that was touching at the step before is pushed (a lasting touch the
			// solve could not part, solids wedged into one another, was given e again every step, and drove them ever harder)
			let fresh = true
			for (let k = 0; k < old.pointCount; k++) if (old.points[k]?.id.key === id) fresh = false
			if (!fresh) continue
			const va = bodyA.getLinearVelocityFromWorldPoint(point)
			const vb = bodyB.getLinearVelocityFromWorldPoint(point)
			approach = Math.max(approach, -((vb.x - va.x) * wm.normal.x + (vb.y - va.y) * wm.normal.y))
		}
		// A contact that is not closing (at rest, or parting) has nothing to rebound: Box2D would apply e to
		// the approach left once this step's forces have acted, bouncing a body a spring pushes every step.
		if (approach <= 0) return 0
		if (continuous) {
			// In the time-of-impact pass the bodies already have the speed the whole step gave them, a spring's push in it included; but
			// a spring pushes evenly through the step, and what it gave them after the moment they met (a share 1 − α of it, the pass
			// having moved them back to that moment, α into the step) is no part of the strike. Struck with it, a light plate a stiff
			// spring flung back up into the ball it had just thrown threw the ball again, higher than it fell from. The rebound is e
			// times the approach less that.
			const sprung = springApproach(touch, wm)
			if (approach - sprung < VELOCITY_THRESHOLD * LENGTH_SCALE) return 0
			if (sprung > 0) return Math.max(0, Math.min(1, (e * (approach - sprung)) / approach))
		}
		if (approach < VELOCITY_THRESHOLD * LENGTH_SCALE) return 0
		const injection = continuous
			? 0
			: runGravity * LENGTH_SCALE * h * wm.normal.y * ((bodyB.isDynamic() ? 1 : 0) - (bodyA.isDynamic() ? 1 : 0))
		if (injection < 0 && approach < VELOCITY_THRESHOLD * LENGTH_SCALE - injection) return 0
		if (approach + injection <= 0) return e
		return Math.max(0, Math.min(1, (e * approach) / (approach + injection)))
	}

	/** The springs on each moving body. */
	const springsOn = new Map<Body, SpringLink[]>()
	for (const link of springJoints) for (const body of [link.getBodyA(), link.getBodyB()]) if (body.isDynamic()) springsOn.set(body, [...(springsOn.get(body) ?? []), link])
	/**
	 * How fast (planck units) the springs this step made a contact's bodies close on each other at its points (the most over them), after
	 * the moment they met: the time-of-impact pass has moved them back to it, α into the step (their sweeps' start).
	 */
	const springApproach = (touch: Touch, wm: { normal: Vec2; points: Vec2[]; pointCount: number }) => {
		const bodyA = touch.getFixtureA().getBody()
		const bodyB = touch.getFixtureB().getBody()
		if (!springsOn.has(bodyA) && !springsOn.has(bodyB)) return 0
		const pushOf = (body: Body) => {
			const p = { x: 0, y: 0, w: 0 }
			for (const link of springsOn.get(body) ?? []) {
				const q = link.pushOn(body)
				if (q === undefined) continue
				p.x += q.x
				p.y += q.y
				p.w += q.w
			}
			return p
		}
		const pa = pushOf(bodyA)
		const pb = pushOf(bodyB)
		const ca = bodyA.getWorldCenter()
		const cb = bodyB.getWorldCenter()
		let most = 0
		for (let i = 0; i < wm.pointCount; i++) {
			const point = wm.points[i]
			if (point === undefined) continue
			const ax = pa.x - pa.w * (point.y - ca.y)
			const ay = pa.y + pa.w * (point.x - ca.x)
			const bx = pb.x - pb.w * (point.y - cb.y)
			const by = pb.y + pb.w * (point.x - cb.x)
			most = Math.max(most, -((bx - ax) * wm.normal.x + (by - ay) * wm.normal.y))
		}
		const sweep = (body: Body) => (body as unknown as { m_sweep: { alpha0: number } }).m_sweep.alpha0
		return most * (1 - Math.max(sweep(bodyA), sweep(bodyB)))
	}

	/**
	 * Steps at which a moving part struck another, with the speed it struck at (m/s). A resting contact
	 * that lets go and touches again from one step to the next is no impact.
	 */
	const impacts = new Map<number, number>()
	/** Every impact, with the two solids and the speed they met at: what happened, in order. */
	const hits: { t: number; a: string; b: string; speed: number }[] = []
	/** The placements at the instant of contact, for impacts the time-of-impact pass found. */
	const touching = new Map<number, Record<string, Placement>>()
	let stepIndex = 0
	/**
	 * Flat spots, from a dented body's first hard landing: the landing's kinetic energy does the
	 * plastic work of a dent, E = p·π·R·δ², with p the dent pressure, so δ = √(E / (p·π·R)).
	 */
	const dents = new Map<string, number>()
	world.on("begin-contact", (touch) => {
		// (a module's contact hook first: plugins.ts Process.contact; none without processes)
		if (runner?.contact(touch, "begin") === true) return
		const pair = pairOf(touch)
		if (pair === undefined || (!touch.getFixtureA().getBody().isDynamic() && !touch.getFixtureB().getBody().isDynamic())) return
		const wm = touch.getWorldManifold(null)
		let approach = 0
		for (let i = 0; wm !== null && wm !== undefined && i < wm.pointCount; i++) {
			const point = wm.points[i]
			if (point === undefined) continue
			const va = touch.getFixtureA().getBody().getLinearVelocityFromWorldPoint(point)
			const vb = touch.getFixtureB().getBody().getLinearVelocityFromWorldPoint(point)
			approach = Math.max(approach, -((vb.x - va.x) * wm.normal.x + (vb.y - va.y) * wm.normal.y) / LENGTH_SCALE)
		}
		if (approach >= VELOCITY_THRESHOLD) hits.push({ t: stepIndex * STEP, a: pair.a.id, b: pair.b.id, speed: Math.round(approach * 1000) / 1000 })
		if (approach >= VELOCITY_THRESHOLD && approach > (impacts.get(stepIndex) ?? 0)) {
			impacts.set(stepIndex, approach)
			// Found by the time-of-impact pass, the bodies stand at the moment they meet: kept, as the step's
			// end has the rebound already under way and would show the ball turning back short of what it hit.
			if (continuous) touching.set(stepIndex, placements())
		}
		const soft = [pair.a, pair.b].find(
			(p) => p.kind === "dynamic" && p.body.kind === "ball" && p.material.yieldStrength !== undefined
		)
		if (soft === undefined || soft.body.kind !== "ball" || dents.has(soft.id)) return
		const m = memberOf.get(soft.id)
		if (m === undefined || !m.body.isDynamic()) return
		const v = velocityOf(m)
		const speed = Math.hypot(v.x, v.y) / LENGTH_SCALE
		const energy = 0.5 * massOf(soft) * speed * speed
		const pressure = DENT_PRESSURE * (soft.material.yieldStrength ?? Number.POSITIVE_INFINITY)
		const depth = Math.min(soft.body.radius, Math.sqrt(energy / (pressure * Math.PI * soft.body.radius)))
		dents.set(soft.id, 1 - depth / (2 * soft.body.radius))
	})

	/** The force each contact pressed with in the last step, from its solved impulses, in newtons. */
	const pressed = new Map<Touch, number>()
	world.on("post-solve", (touch, impulse) => {
		// A wedged body's contacts can pile impulse up step after step through warm starting, opposing contacts cancelling while their
		// stored impulses grow (a sneaker's heel wedged among fixed pegs: its stored impulses grew until the warm start alone gave it
		// 11,000 units a step, then NaN). A stored impulse that would change the heavier moving body's speed by more than SANE_SPEED is no
		// real push: it is dropped from the next step's warm start (the step's solve still had it).
		{
			const A = touch.getFixtureA().getBody()
			const B = touch.getFixtureB().getBody()
			const bound = Math.max(A.isDynamic() ? A.getMass() : 0, B.isDynamic() ? B.getMass() : 0) * SANE_SPEED * LENGTH_SCALE
			const manifold = touch.getManifold()
			let over = false
			for (let i = 0; i < manifold.pointCount; i++) {
				const p = manifold.points[i]
				if (p !== undefined && !(Math.abs(p.normalImpulse) <= bound && Math.abs(p.tangentImpulse) <= bound)) over = true
			}
			if (over)
				for (let i = 0; i < manifold.pointCount; i++) {
					const p = manifold.points[i]
					if (p === undefined) continue
					p.normalImpulse = 0
					p.tangentImpulse = 0
				}
		}
		const total = impulse.normalImpulses.reduce((sum, i) => sum + i, 0)
		pressed.set(touch, total / h / LENGTH_SCALE)
		const spring = springs.get(touch)
		if (spring !== undefined) {
			spring.normalImpulse = total + (passed.get(touch) ?? 0)
			// Box2D's tangent is the normal turned clockwise; the spring's is turned counterclockwise.
			spring.tangentImpulse = -impulse.tangentImpulses.reduce((sum, i) => sum + i, 0)
		}
	})
	world.on("end-contact", (touch) => {
		pressed.delete(touch)
		stuck.delete(touch)
	})

	/**
	 * Impacts that began this step on a contact with sideways restitution: where and how fast the
	 * contact point was sliding as it struck, to be sprung back once the step has solved it.
	 */
	const springs = new Map<Touch, { armA: Vec2; armB: Vec2; normal: Vec2; slide: number; e: number; grip: number; normalImpulse: number; tangentImpulse: number }>()
	/**
	 * A conveyor's top carries what touches it: the contact's friction drives their relative sliding
	 * toward the belt's speed along its +x, as Box2D's tangent speed (along its tangent, the normal
	 * from fixture A to B turned clockwise, B's speed relative to A's).
	 */
	const belts = scene.solids.some((s) => s.surfaceSpeed !== undefined)
	const carry = (touch: Touch) => {
		const wm = touch.getWorldManifold(null)
		let speed = 0
		for (const [fixture, side] of [
			[touch.getFixtureA(), 1],
			[touch.getFixtureB(), -1]
		] as const) {
			const tag = fixture.getUserData()
			if (wm === null || wm === undefined || !isTag(tag) || tag.part.surfaceSpeed === undefined) continue
			// (its own angle: its body's, and for a belt welded into a group, turned by its pose in the group)
			const angle = fixture.getBody().getAngle() + (memberOf.get(tag.part.id)?.local.angle ?? 0)
			const along = { x: Math.cos(angle), y: Math.sin(angle) }
			// The normal out of the belt (from A to B is out of A, into B) must leave through its top.
			if (side * (-wm.normal.x * along.y + wm.normal.y * along.x) < 0.5) continue
			speed += side * tag.part.surfaceSpeed * LENGTH_SCALE * (along.x * wm.normal.y - along.y * wm.normal.x)
		}
		touch.setTangentSpeed(speed)
	}
	/**
	 * Impacts carried on through lasting contacts (sequential impacts). planck solves an island's contacts together, and gives
	 * restitution only to a contact that is closing as the step begins: a strike on a body that rests against another (a ball on a
	 * ball, a row of touching balls) reached the others through contacts that were not closing yet, and was shared out as if the
	 * bodies were glued (a tennis ball dropped resting on a basketball rose to 0.82 m of its 1.24 m; a Newton's cradle of touching balls
	 * sent two out). So where a strike lands on a body that also touches another moving body, the island's one-point contacts are
	 * first resolved one strike at a time, each with its own restitution, the hardest closing first, until none closes faster than
	 * VELOCITY_THRESHOLD: the strike runs through the row as a wave does (the basketball rebounds off the floor, then meets the tennis
	 * ball still falling and throws it up at about three times its speed; the cradle sends out one ball). Each strike is a two-body
	 * collision with e ≤ 1, so none adds energy. Then planck solves the island as always (what still closes is a touch, and the
	 * strikes' contacts are parting). A struck contact's restitution is `compensated`'s, applied as planck would (its rebound e times
	 * the approach as the step began); one passed on is its pair's own. Contacts of two points (a slab flat on a slab) are left to
	 * planck's solve, as are the joints (a cradle's strings, perpendicular to its strikes). Both in the main solve (before
	 * `solveIsland`) and in the time-of-impact pass (before `solveIslandTOI`, which takes in what touches the struck bodies).
	 */
	type Island = { m_bodies: Body[]; m_contacts: Touch[] }
	/** Contacts given restitution this (sub-)step (a strike: `compensated` > 0). */
	const struck = new Set<Touch>()
	/** The normal impulse each contact took in the pass this step (planck units), for Garwin's spring-back (`springBack`). */
	const passed = new Map<Touch, number>()
	/** Whether a contact can take part in the pass: touching at one point, enabled, between solids. */
	const single = (c: Touch) => c.isTouching() && c.isEnabled() && c.getManifold().pointCount === 1 && !c.getFixtureA().isSensor() && !c.getFixtureB().isSensor()
	/** Two round solids touching (balls, wheels, rolls): a strike passes on through them. */
	const round = (c: Touch) => c.getFixtureA().getType() === "circle" && c.getFixtureB().getType() === "circle" && single(c)
	/**
	 * How a body moves when struck in the pass: fixed (static); loose (no joint but springs); turning about a fixed pivot (one
	 * hinge to a fixed body, no motor or limit: a cradle's ball, a seesaw's plank, met with its inertia about the pivot, so the hinge
	 * holds as it is struck); or not at all (held by anything else: a rope, a pulley, a wheel's axle, a chain it lies on, a driven or
	 * limited hinge, a hinge to a moving body), its contacts then left to planck's solve.
	 */
	const bearing = (body: Body): { pivot?: Vec2 } | undefined => {
		if (!body.isDynamic()) return {}
		let pivot: Vec2 | undefined
		for (let e = body.getJointList(); e !== null; e = e.next) {
			const j = e.joint
			if (j instanceof SpringLink || j instanceof SpringMass) continue
			if (pivot !== undefined || !(j instanceof Hinge) || !e.other.isStatic() || j.isMotorEnabled() || j.isLimitEnabled()) return undefined
			pivot = j.getBodyA() === body ? j.getAnchorA() : j.getAnchorB()
		}
		return pivot === undefined ? {} : { pivot }
	}
	/** A side of a contact in the pass: its body, its arm to the point (from its centre, or from its pivot), and its inverse mass along the normal. */
	type Side = { body: Body; r: Vec2; pivot: Vec2 | undefined; inverse: number; turn: number }
	const sideOf = (body: Body, point: Vec2, n: Vec2): Side | undefined => {
		const how = bearing(body)
		if (how === undefined) return undefined
		if (!body.isDynamic()) return { body, r: new Vec2(0, 0), pivot: undefined, inverse: 0, turn: 0 }
		const c = body.getWorldCenter()
		if (how.pivot === undefined) {
			const r = Vec2.sub(point, c)
			const turn = inverseInertia(body)
			return { body, r, pivot: undefined, inverse: inverseMass(body) + turn * Vec2.cross(r, n) ** 2, turn }
		}
		// about its pivot O: I_O = I_c + m·|c − O|², and a strike at r from O turns it by (r × J)/I_O, its centre moving with the turn
		const o = how.pivot
		const r = Vec2.sub(point, o)
		const spin = inverseInertia(body)
		const arm = Vec2.sub(c, o)
		const io = (spin > 0 ? 1 / spin : 0) + body.getMass() * Vec2.dot(arm, arm)
		if (!(io > 0)) return undefined
		return { body, r, pivot: o, inverse: Vec2.cross(r, n) ** 2 / io, turn: 1 / io }
	}
	const motion = (body: Body) => body as unknown as { m_linearVelocity: Vec2; m_angularVelocity: number }
	/** The velocity of the side's point now (planck units). */
	const pointVelocity = (s: Side, point: Vec2) => {
		const m = motion(s.body)
		const c = s.body.getWorldCenter()
		return { x: m.m_linearVelocity.x - m.m_angularVelocity * (point.y - c.y), y: m.m_linearVelocity.y + m.m_angularVelocity * (point.x - c.x) }
	}
	/** An impulse J (planck units) on the side at its point. */
	const strike = (s: Side, jx: number, jy: number) => {
		if (!s.body.isDynamic()) return
		const m = motion(s.body)
		const dw = s.turn * (s.r.x * jy - s.r.y * jx)
		m.m_angularVelocity += dw
		if (s.pivot === undefined) {
			const im = inverseMass(s.body)
			m.m_linearVelocity.x += im * jx
			m.m_linearVelocity.y += im * jy
			return
		}
		// (its centre turns about the pivot)
		const c = s.body.getWorldCenter()
		m.m_linearVelocity.x += -dw * (c.y - s.pivot.y)
		m.m_linearVelocity.y += dw * (c.x - s.pivot.x)
	}
	const propagate = (island: Island) => {
		if (struck.size === 0) return
		const contacts = island.m_contacts
		let needed = false
		for (const c of contacts) {
			if (!struck.has(c) || !single(c)) continue
			for (const body of [c.getFixtureA().getBody(), c.getFixtureB().getBody()]) {
				if (!body.isDynamic() || bearing(body) === undefined) continue
				for (let e = body.getContactList(); e !== null && !needed; e = e.next) if (e.contact !== c && e.other.isDynamic() && round(e.contact) && bearing(e.other) !== undefined) needed = true
			}
			if (needed) break
		}
		if (!needed) return
		const points: { c: Touch; a: Side; b: Side; point: Vec2; n: Vec2; k: number; e: number; fresh: boolean; lift: number; hit: boolean }[] = []
		for (const c of contacts) {
			if (!(struck.has(c) ? single(c) : round(c))) continue
			const pair = pairOf(c)
			const wm = c.getWorldManifold(null)
			if (pair?.contact === undefined || wm === null || wm === undefined || wm.pointCount === 0) continue
			const point = Vec2.clone(wm.points[0] as Vec2)
			const n = Vec2.clone(wm.normal)
			const A = c.getFixtureA().getBody()
			const B = c.getFixtureB().getBody()
			const a = sideOf(A, point, n)
			const b = sideOf(B, point, n)
			if (a === undefined || b === undefined || !(a.inverse + b.inverse > 0)) continue
			const fresh = struck.has(c)
			// (in the main solve, the gravity the step is about to add to a struck contact's approach, which `compensated` has reckoned with)
			const lift = fresh && !continuous ? runGravity * LENGTH_SCALE * h * n.y * ((B.isDynamic() ? 1 : 0) - (A.isDynamic() ? 1 : 0)) : 0
			points.push({ c, a, b, point, n, k: a.inverse + b.inverse, e: fresh ? c.getRestitution() : pair.contact.restitution, fresh, lift, hit: false })
		}
		const closing = (q: (typeof points)[number]) => {
			const va = pointVelocity(q.a, q.point)
			const vb = pointVelocity(q.b, q.point)
			return -((vb.x - va.x) * q.n.x + (vb.y - va.y) * q.n.y)
		}
		for (let pass = 0; pass < Math.min(256, 8 * points.length); pass++) {
			let worst: (typeof points)[number] | undefined
			let most = VELOCITY_THRESHOLD * LENGTH_SCALE
			for (const q of points) {
				const approach = closing(q)
				if (approach > most) {
					most = approach
					worst = q
				}
			}
			if (worst === undefined) break
			const q = worst
			// the impulse that leaves them parting at e times the approach (a struck contact: as planck's step with `compensated`'s e would)
			const j = (q.e * (most + q.lift) + q.lift + most) / q.k
			strike(q.a, -j * q.n.x, -j * q.n.y)
			strike(q.b, j * q.n.x, j * q.n.y)
			passed.set(q.c, (passed.get(q.c) ?? 0) + j)
			// a strike passed on is an impact of its own (a struck contact's was counted as it began)
			if (!q.fresh && !q.hit) {
				q.hit = true
				const pair = pairOf(q.c)
				const speed = most / LENGTH_SCALE
				if (pair !== undefined) hits.push({ t: stepIndex * STEP, a: pair.a.id, b: pair.b.id, speed: Math.round(speed * 1000) / 1000 })
				if (speed > (impacts.get(stepIndex) ?? 0)) impacts.set(stepIndex, speed)
			}
		}
	}
	const solveIsland = solver.solveIsland.bind(solver)
	solver.solveIsland = (step: unknown) => {
		propagate(solver as unknown as Island)
		solveIsland(step)
	}
	world.on("pre-solve", (touch, oldManifold) => {
		if (runner?.contact(touch, "pre") === true) {
			touch.setEnabled(false)
			return
		}
		// (touching as the step's solve begins: the solve holds it, `held`)
		if (!continuous) held.add(touch)
		// (the time-of-impact pass re-enables a contact it updates: one of a hinged body's stays out of it)
		if (continuous && (hinged(touch.getFixtureA().getBody()) || hinged(touch.getFixtureB().getBody()))) {
			touch.setEnabled(false)
			return
		}
		// (a strike the pass could not get clear before, on a pair still at rest inside the target: left to the solve, `stuck`; planck then
		// puts its two bodies back. Only as the pass picks it as a strike, before any island is made: neither body is in one yet)
		if (continuous && stuck.has(touch) && !islanded(touch.getFixtureA().getBody()) && !islanded(touch.getFixtureB().getBody()) && undoable(touch)) {
			touch.setEnabled(false)
			return
		}
		if (belts) carry(touch)
		const pair = pairOf(touch)
		if (pair?.contact === undefined) return
		touch.setFriction(pair.contact.friction)
		const restitution = compensated(touch, pair.contact.restitution, oldManifold)
		touch.setRestitution(restitution)
		if (restitution > 0) struck.add(touch)
		const e = pair.contact.tangentRestitution ?? 0
		if (e <= 0 || oldManifold.pointCount > 0) return
		const wm = touch.getWorldManifold(null)
		if (wm === null || wm === undefined || wm.pointCount === 0) return
		const point = wm.pointCount === 1 ? wm.points[0] : Vec2.mid(wm.points[0], wm.points[1])
		if (point === undefined) return
		const normal = Vec2.clone(wm.normal)
		const va = touch.getFixtureA().getBody().getLinearVelocityFromWorldPoint(point)
		const vb = touch.getFixtureB().getBody().getLinearVelocityFromWorldPoint(point)
		const approach = -((vb.x - va.x) * normal.x + (vb.y - va.y) * normal.y)
		if (approach < VELOCITY_THRESHOLD * LENGTH_SCALE) return
		const slide = (vb.x - va.x) * -normal.y + (vb.y - va.y) * normal.x
		// Each body's lever arm to the contact, kept as it was at the strike: the ball moves on within the step.
		const armA = Vec2.sub(point, touch.getFixtureA().getBody().getWorldCenter())
		const armB = Vec2.sub(point, touch.getFixtureB().getBody().getWorldCenter())
		springs.set(touch, { armA, armB, normal, slide, e, grip: pair.contact.grip ?? pair.contact.friction, normalImpulse: 0, tangentImpulse: 0 })
	})

	/**
	 * Garwin's rough-ball bounce. Box2D's friction can only stop the contact point sliding (the ball
	 * leaves rolling); a superball's surface grips, winds up sideways and springs back, so the contact
	 * point leaves sliding the other way at e_x of its striking speed. The extra sideways impulse that
	 * does so is applied to both bodies, and the whole sideways impulse of the impact is held within
	 * grip × its normal impulse.
	 */
	const springBack = () => {
		for (const [touch, s] of springs) {
			const bodyA = touch.getFixtureA().getBody()
			const bodyB = touch.getFixtureB().getBody()
			const t = new Vec2(-s.normal.y, s.normal.x)
			const at = (body: Body, r: Vec2) => Vec2.add(body.getWorldCenter(), r)
			const va = bodyA.getLinearVelocityFromWorldPoint(at(bodyA, s.armA))
			const vb = bodyB.getLinearVelocityFromWorldPoint(at(bodyB, s.armB))
			const slideNow = (vb.x - va.x) * t.x + (vb.y - va.y) * t.y
			const reach = (body: Body, r: Vec2) => {
				if (!body.isDynamic()) return 0
				const arm = Vec2.cross(r, t)
				const m = body.getMass()
				const c = body.getLocalCenter()
				const spin = body.getInertia() - m * Vec2.dot(c, c)
				return 1 / m + (spin > 0 ? (arm * arm) / spin : 0)
			}
			const k = reach(bodyA, s.armA) + reach(bodyB, s.armB)
			if (k === 0) continue
			let extra = (-s.e * s.slide - slideNow) / k
			const limit = s.grip * s.normalImpulse
			const total = Math.max(-limit, Math.min(limit, s.tangentImpulse + extra))
			extra = total - s.tangentImpulse
			const j = Vec2.mul(extra, t)
			bodyB.applyLinearImpulse(j, at(bodyB, s.armB), true)
			bodyA.applyLinearImpulse(Vec2.neg(j), at(bodyA, s.armA), true)
		}
		springs.clear()
	}

	/**
	 * Each damped pivot's torque, τ = −c·ω against its turning relative to what it hangs from, applied
	 * to both, so the whole assembly it carries is slowed, as by a damper at the pivot.
	 */
	const dampPivots = () => {
		for (const { part, body } of bodies) {
			if (part.damping === undefined || part.pivot === undefined) continue
			const parent = part.parent === undefined ? undefined : memberOf.get(part.parent)?.body
			const turning = body.getAngularVelocity() - (parent?.getAngularVelocity() ?? 0)
			const torque = -part.damping * turning * LENGTH_SCALE * LENGTH_SCALE
			body.applyTorque(torque, true)
			parent?.applyTorque(-torque, true)
		}
	}

	/**
	 * Before each step, each spring's share of implicit stiffness (`SpringLink.theta`): none while the springs on a body are slow
	 * enough for the step to follow them steadily (a = h²·Σk/m ≤ 2: four and a half steps or more to a period, solved exactly as an
	 * explicit force is; the explicit step is steady to a = 4), else θ = 1 − 2/a, so the explicit share the step follows is never
	 * more than a = 2 and a swing the step cannot follow dies away (each step keeps at most 1/√(a − 1) of it) instead of rattling
	 * from step to step. (From a = 1, θ = 1 − 1/a took 13 to 42% off a launcher's or a pad's throw at its stiffest setting, where
	 * a ball on the plate makes the swing slow enough to follow.) Springs that share a moving body are reckoned together (a plate
	 * on two springs, a mat on two), each at the mass it meets along its line, so the sum bounds their fastest swing. A spring that
	 * pushes or pulls this step wakes its bodies, as a force would.
	 */
	const springGroups = (() => {
		const groupOf = new Map<Body, number>()
		const parent: number[] = springJoints.map((_, i) => i)
		const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i] as number)))
		springJoints.forEach((link, i) => {
			for (const body of [link.getBodyA(), link.getBodyB()]) {
				if (!body.isDynamic()) continue
				const j = groupOf.get(body)
				if (j === undefined) groupOf.set(body, i)
				else parent[find(i)] = find(j)
			}
		})
		const groups = new Map<number, SpringLink[]>()
		springJoints.forEach((link, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), link]))
		return [...groups.values()]
	})()
	/**
	 * Before each step, who each taut chain may touch: every moving solid but its own two ends whose fixture's box comes within
	 * 5 cm of its band gets a `ChainTouch` (which finds the actual contact points in the step), and one that has gone off loses it.
	 */
	const touchChains = () => {
		for (const chain of chains) {
			const pa = chain.A.getWorldPoint(chain.la)
			const pb = chain.B.getWorldPoint(chain.lb)
			const near = new Set<Body>()
			if (chainTaut(chain, Vec2.distance(pa, pb))) {
				const reach = chain.radius + CHAIN_MARGIN
				const box = new AABB(new Vec2(Math.min(pa.x, pb.x) - reach, Math.min(pa.y, pb.y) - reach), new Vec2(Math.max(pa.x, pb.x) + reach, Math.max(pa.y, pb.y) + reach))
				world.queryAABB(box, (fixture) => {
					const body = fixture.getBody()
					if (body.isDynamic() && body !== chain.A && body !== chain.B && !fixture.isSensor()) near.add(body)
					return true
				})
			}
			for (const [body, touch] of chain.touches) {
				if (near.has(body)) continue
				world.destroyJoint(touch)
				chain.touches.delete(body)
			}
			// (in the order the scene lists its solids, so every run makes the same joints in the same order)
			for (const m of members) {
				if (!near.has(m.body) || chain.touches.has(m.body)) continue
				chain.touches.set(m.body, world.createJoint(new ChainTouch(m.body, chain)) as ChainTouch)
			}
		}
	}
	/**
	 * Pins and ropes meet their constraints where the step leaves their anchors, their paths' bend included, which keeps a swing's
	 * energy; that bend is a target the solve must reach. A body that touches something (a contact, a chain it rests on) may be
	 * wedged where no motion reaches it, and then the target could never be met: the solve drove the impulses on ever harder, and
	 * through the slightest lever into a free spin (a 111 kg ball on a 2 cm rope, wedged frictionless between a slab and a rod,
	 * was spun to planck's limit of 4π a step within three steps). So a joint whose bodies touch anything is met along its
	 * anchors' lines as they are this step (planck's own, which no wedge can drive), and the bend only while both swing free.
	 */
	const curvedJoints: (Hinge | Cord | RopePulley)[] = []
	for (let j = world.getJointList(); j !== null; j = j.getNext()) if (j instanceof Hinge || j instanceof Cord || j instanceof RopePulley) curvedJoints.push(j)
	curvedJoints.reverse()
	const inContact = new Set<Body>()
	const freeJoints = () => {
		inContact.clear()
		for (let c = world.getContactList(); c !== null; c = c.getNext()) {
			if (!c.isTouching() || !c.isEnabled()) continue
			inContact.add(c.getFixtureA().getBody())
			inContact.add(c.getFixtureB().getBody())
		}
		for (const chain of chains) for (const body of chain.touches.keys()) inContact.add(body)
		for (const j of curvedJoints) j.free = !inContact.has(j.getBodyA()) && !inContact.has(j.getBodyB())
	}
	/** The distinct moving bodies, each with its reach: the farthest any of its parts reaches from its centre of mass, planck units. */
	const movers = [...new Set(bodies.filter((m) => m.body.isDynamic()).map((m) => m.body))].map((body) => {
		const c = body.getLocalCenter()
		let reach = 0
		for (const m of bodies) {
			if (m.body !== body) continue
			if (m.part.body.kind === "ball") {
				const p = placeIn(m.local, 0, 0)
				const dx = p.x - c.x
				const dy = p.y - c.y
				reach = Math.max(reach, Math.sqrt(dx * dx + dy * dy) + m.part.body.radius * LENGTH_SCALE)
			} else for (const q of outlineOf(m.part.body)) {
				const p = placeIn(m.local, q.x, q.y)
				const dx = p.x - c.x
				const dy = p.y - c.y
				reach = Math.max(reach, Math.sqrt(dx * dx + dy * dy))
			}
		}
		return { body, reach }
	})
	/** A body whose motion or place is not a number is the end of the run: said, with when and which part. */
	const unsound = (when: string) => {
		for (const { body } of movers) {
			const v = body.getLinearVelocity()
			const p = body.getPosition()
			if (Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(body.getAngularVelocity()) && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(body.getAngle())) continue
			const tag = body.getFixtureList()?.getUserData()
			throw new SimulationError(`the simulation broke down at ${(stepIndex * STEP).toFixed(3)} s: ${isTag(tag) ? tag.part.id : "a part"}'s motion stopped being a number as the step was ${when}`)
		}
	}
	let overSpeed = 0
	/** No body faster than SANE_SPEED, its centre or any point of it as it turns. */
	const keepSane = () => {
		for (const { body, reach } of movers) {
			const v = body.getLinearVelocity()
			const speed = Math.sqrt(v.x * v.x + v.y * v.y) / LENGTH_SCALE
			if (speed > SANE_SPEED) {
				body.setLinearVelocity(Vec2.mul(SANE_SPEED / speed, v))
				overSpeed++
			}
			const w = body.getAngularVelocity()
			const rim = (Math.abs(w) * reach) / LENGTH_SCALE
			if (rim > SANE_SPEED) {
				body.setAngularVelocity((w * SANE_SPEED) / rim)
				overSpeed++
			}
		}
	}
	/** Each spring group's rate this step (`SpringLink.prepare`, from where its bodies stand now): k/m summed over its springs, 1/s². */
	const springRates = () =>
		springGroups.map((group) => {
			let rate = 0
			for (const link of group) rate += link.prepare()
			return rate
		})
	const tuneSprings = (rates: readonly number[]) => {
		springGroups.forEach((group, i) => {
			const a = (rates[i] ?? 0) * h * h
			const theta = a > 2 ? 1 - 2 / a : 0
			for (const link of group) link.theta = theta
		})
	}
	/** Each spring group's moving bodies. */
	const groupBodies = springGroups.map((group) => new Set(group.flatMap((link) => [link.getBodyA(), link.getBodyB()]).filter((b) => b.isDynamic())))
	/**
	 * How many sub-steps the coming step is solved in: enough that every spring group's fastest swing (ω = √rate, its springs' k/m
	 * summed on the bodies they move) turns at most SUB_TURN a sub-step, or SUB_TURN_NEAR while a moving body from outside the group
	 * comes at one of its bodies (planck has a contact for them: their boxes overlap; and it moves against it faster than NEAR_SPEED),
	 * as a ball falling on a sprung plate: the plate and the ball strike, part and strike again within a few thousandths of a second, and
	 * the step must follow that (at 480 Hz a 58 g plate on a 7300 N/m spring threw a bowling ball 12 cm higher than it fell from). A ball
	 * resting on the plate, or riding it, strikes nothing: whole steps follow it. At most SUB_MAX, and at most SUB_WORK over the moving
	 * bodies awake; a spring stiffer than that can follow is steadied by its implicit share (`tuneSprings`). Whole steps (one sub-step)
	 * for every spring in the catalog at its default settings with nothing on it.
	 *
	 * The count may rise at any step but falls only after SUB_HOLD steps of needing fewer: neared, a group keeps the most it has needed
	 * until SUB_HOLD steps after it was last neared; alone, it keeps what it asked for until it has asked for fewer for SUB_HOLD steps;
	 * the work budget the same. A count that changed with the swing's phase (a stretched spring's sideways stiffness T/d comes and goes
	 * each half period) gave the swing a little energy every period, as a swing pumped in step with it gains: the step that changes its
	 * length mid-swing changes what the swing keeps.
	 */
	const nearUntil = springGroups.map(() => -1)
	/** The sub-steps each group has kept since it was neared (the most it has needed). */
	const kept = springGroups.map(() => 0)
	/** The sub-steps each group asks for alone, and the step it last asked for as many or more. */
	const freeKept = springGroups.map(() => 0)
	const freeSince = springGroups.map(() => -1)
	/** The step since which each group's springs' ends have stayed still against each other (infinity: they are moving, or nothing is known yet). */
	const stillSince = springGroups.map(() => Number.POSITIVE_INFINITY)
	/** The work budget's sub-steps, and the step it last allowed as many or more. */
	let budget = 0
	let budgetSince = -1
	const subSteps = (rates: readonly number[]) => {
		let n = 1
		springGroups.forEach((_, i) => {
			const turn = Math.sqrt(rates[i] ?? 0) * STEP
			let near = false
			if (turn > SUB_TURN_NEAR) {
				const own = groupBodies[i] as Set<Body>
				for (const body of own) {
					const v = body.getLinearVelocity()
					for (let f = body.getFixtureList(); f !== null && !near; f = f.getNext())
						world.queryAABB(f.getAABB(0), (other) => {
							const ob = other.getBody()
							if (ob.isDynamic() && !own.has(ob) && !other.isSensor()) {
								const u = ob.getLinearVelocity()
								const dx = u.x - v.x
								const dy = u.y - v.y
								if (dx * dx + dy * dy > NEAR_SPEED * NEAR_SPEED * LENGTH_SCALE * LENGTH_SCALE) near = true
							}
							return !near
						})
					if (near) break
				}
				// (and for SUB_HOLD steps after: the sub-steps stay through a whole exchange of strikes, not only while the bodies' boxes overlap)
				if (near) nearUntil[i] = stepIndex + SUB_HOLD
			}
			if (!near) near = stepIndex <= (nearUntil[i] as number)
			if (near) {
				kept[i] = Math.max(kept[i] as number, Math.ceil(turn / SUB_TURN_NEAR))
				n = Math.max(n, kept[i] as number)
				return
			}
			kept[i] = 0
			// (a group none of whose springs' ends have moved against each other faster than NEAR_SPEED since the step before swings by less than
			// anything can see: a plate at rest, a ball resting on it; whole steps, its implicit share keeping it steady, until something strikes it
			// or it moves. Not at its first step, when nothing is known of it yet: a launcher's plate is still as it is let go)
			let moving = false
			for (const link of springGroups[i] as SpringLink[]) if (link.motion > NEAR_SPEED * LENGTH_SCALE) moving = true
			if (moving) stillSince[i] = Number.POSITIVE_INFINITY
			else if (stillSince[i] === Number.POSITIVE_INFINITY) stillSince[i] = stepIndex
			const need = turn > SUB_TURN_NEAR && !(stepIndex > (stillSince[i] as number)) ? Math.ceil(turn / SUB_TURN) : 1
			if (need >= (freeKept[i] as number) || stepIndex - (freeSince[i] as number) > SUB_HOLD) {
				freeKept[i] = need
				freeSince[i] = stepIndex
			}
			n = Math.max(n, freeKept[i] as number)
		})
		let awake = 0
		for (const { body } of movers) if (body.isAwake()) awake++
		const allowed = Math.max(1, Math.floor(SUB_WORK / Math.max(1, awake)))
		if (allowed >= budget || stepIndex - budgetSince > SUB_HOLD) {
			budget = allowed
			budgetSince = stepIndex
		}
		return Math.min(n, SUB_MAX, budget)
	}

	/** The weight of everything joined to a part: its whole assembly, and what joints join to it (a car's body to its wheels). */
	const everyLink = [...parentLinks, ...jointLinks]
	const assemblyWeight = (part: SolidPart) => weightJoined(part, everyLink)
	/**
	 * Rolling resistance τ = −C_rr·N·r·sign(ω) on a ball supported from below, ω its turning relative to
	 * its support (a fixed part's is 0, a seesaw's or a cart's own turning is taken off), N the load it
	 * presses down with (its own weight, or a car's share on a wheel), never more than its assembly's whole
	 * weight (an impact's instant load is no rolling load), and never more than would stop their relative
	 * turning in one step. A loose support gets the equal and opposite torque, so a ball rolling on a foam
	 * block, a book or a seesaw slows, and what it rolls on is turned a little the other way.
	 */
	const rollingResistance = () => {
		for (const { part, body, fixture } of bodies) {
			if (part.kind !== "dynamic" || part.body.kind !== "ball" || !body.isDynamic()) continue
			for (let edge = body.getContactList(); edge !== null; edge = edge.next) {
				// (A weld group's body touches through all its parts' fixtures: only this ball's own count.)
				if (!edge.contact.isTouching() || (edge.contact.getFixtureA() !== fixture && edge.contact.getFixtureB() !== fixture)) continue
				const pair = pairOf(edge.contact)
				const wm = edge.contact.getWorldManifold(null)
				if (pair?.contact === undefined || (wm === null || wm === undefined) || wm.pointCount === 0) continue
				const ballIsA = pair.a === part
				const upward = ballIsA ? -wm.normal.y : wm.normal.y
				if (upward <= 0.7) continue
				const support = (ballIsA ? edge.contact.getFixtureB() : edge.contact.getFixtureA()).getBody()
				const turning = body.getAngularVelocity() - support.getAngularVelocity()
				if (Math.abs(turning) < ROLLING_OMEGA_FLOOR) continue
				const load = Math.min(pressed.get(edge.contact) ?? massOf(part) * runGravity, assemblyWeight(part))
				const magnitude = pair.contact.rollingResistance * load * part.body.radius
				// The turning each unit of torque removes, per step: the ball's spin and the support's (planck's units).
				const stops = Math.abs(turning) / ((inverseInertia(body) + inverseInertia(support)) * h * LENGTH_SCALE * LENGTH_SCALE)
				const torque = -Math.sign(turning) * Math.min(magnitude, stops)
				body.applyTorque(torque * LENGTH_SCALE * LENGTH_SCALE, true)
				support.applyTorque(-torque * LENGTH_SCALE * LENGTH_SCALE, true)
				break
			}
		}
	}

	/**
	 * Air's buoyancy, ρ·g·V up on every body's solid volume V (a hollow ball's shell: the air inside it weighs
	 * what it displaces). The air a ball carries was added to its mass so it is inertia, but Box2D's gravity
	 * weighs all of its mass, so that weight is lifted off again. Never wakes a body that is asleep.
	 */
	const lifts = bodies.flatMap((m) =>
		m.part.kind === "dynamic" && m.body.isDynamic() ? [{ m, lift: (airCarried(m.part) + airDensity * solidVolume(m.part)) * runGravity * LENGTH_SCALE }] : []
	)
	/** A module's share of the room's air round a part (SolidHandle.setAirShare: inside a pumped jar); none in a plain run, so nothing changes. */
	const airShares = new Map<Member, number>()
	/** The air's density round a part, kg/m³: the run's, times its share where a module set one. */
	const airRound = (m: Member) => {
		const k = airShares.get(m)
		return k === undefined ? airDensity : airDensity * k
	}
	const airLift = () => {
		// (A part of a weld group is lifted where its own volume is, so a group of a dense part and a light one turns as it would.)
		for (const { m, lift } of lifts) {
			const k = airShares.get(m)
			const up = k === undefined ? lift : lift * k
			if (m.lone) m.body.applyForceToCenter(new Vec2(0, up), false)
			else m.body.applyForce(new Vec2(0, up), m.body.getWorldPoint(m.center), false)
		}
	}

	/** The rest of a fixed-ended spring's weight that its moving end holds (`springWeights`): half the spring's, less what its added inertia already weighs. */
	const springWeight = () => {
		for (const { body, anchor, force } of springWeights) body.applyForce(new Vec2(0, -force * LENGTH_SCALE), body.getWorldPoint(anchor), false)
	}

	/**
	 * Quadratic air drag on every moving body, against its velocity through the air where it is (still air, or a fan's stream):
	 * negligible for a heavy ball, a quarter of the weight for a 6 g one at the speed it lands from 1 m. A sphere meets
	 * F = −½·ρ·C_d·A·|v|·v on its disc, a cylinder (a log, a can or a wheel on its side) on its broadside diameter × length, at
	 * its middle. A slab or a polygon meets it on each side that faces into the air, point by point along the side as the body
	 * moves and turns (`outlineDrag`): moving straight, the sides it shows the air add up to its outline's width across the flow,
	 * so it meets −½·ρ·C_d·(width across × depth)·|v|·v, flat or end-on as it is turned now (a plank falls end-first nearly as in
	 * a vacuum, flat like a leaf); turning, each side's far parts meet more air than its near ones, which slows a spinning plank.
	 */
	const outlines = new Map(bodies.flatMap((m) => (m.part.body.kind === "ball" ? [] : [[m, outlineOf(m.part.body)] as const])))
	/** Each moving part's drag this step (before it is applied), and the share of its body's motion the drags on its body take together. */
	const drags: ({ m: Member; fx: number; fy: number; torque: number } | { m: Member; ball: Vec2; at: Vec2 })[] = []
	const takes = new Map<Body, number>()
	/** Which airDrag the drags are of (EngineInternals.airOn's index of them: read only, made only when a module asks). */
	let airStamp = 0
	const airIndex: { stamp: number; drag: Map<Member, { x: number; y: number }>; lift: Map<Member, { m: Member; lift: number }> | undefined } = { stamp: -1, drag: new Map(), lift: undefined }
	const airDrag = () => {
		airStamp++
		const blowing = streams(scene, stepIndex * STEP, placements())
		drags.length = 0
		takes.clear()
		for (const m of bodies) {
			const { part, body } = m
			if (part.kind !== "dynamic" || !body.isDynamic()) continue
			const outline = outlines.get(m)
			if (outline !== undefined && part.body.kind !== "ball") {
				// (the air at the part's middle, its stream taken as even across it)
				const mid = m.lone ? body.getWorldCenter() : body.getWorldPoint(m.center)
				const air = airAt(blowing, { x: mid.x / LENGTH_SCALE, y: mid.y / LENGTH_SCALE })
				const drag = outlineDrag(body, m.local, outline, 0.5 * airRound(m) * BOX_DRAG * part.body.depth, air, h)
				if (drag === undefined) continue
				drags.push({ m, fx: drag.fx, fy: drag.fy, torque: drag.torque })
				takes.set(body, (takes.get(body) ?? 0) + drag.share)
				continue
			}
			// A lone ball: its body's motion and where it stands; a ball of a weld group: the motion of its own middle, where its drag acts.
			const p = m.lone ? body.getPosition() : body.getWorldPoint(m.center)
			const v = m.lone ? body.getLinearVelocity() : body.getLinearVelocityFromWorldPoint(p)
			const air = airAt(blowing, { x: p.x / LENGTH_SCALE, y: p.y / LENGTH_SCALE })
			const vx = v.x / LENGTH_SCALE - air.x
			const vy = v.y / LENGTH_SCALE - air.y
			const speed = Math.hypot(vx, vy)
			if (speed === 0) continue
			const length = cylinderLength(part)
			const facing = length === undefined ? SPHERE_DRAG * Math.PI * part.body.radius ** 2 : CYLINDER_DRAG * 2 * part.body.radius * length
			const k = 0.5 * airRound(m) * facing * speed
			drags.push({ m, ball: new Vec2(-k * vx * LENGTH_SCALE, -k * vy * LENGTH_SCALE), at: p })
			// its share of its body's motion: the work it does on the point it acts at over the step, against the body's motion
			const moving = motionOf(body, air)
			if (moving > 0) takes.set(body, (takes.get(body) ?? 0) + (k * (vx * vx + vy * vy) * h) / moving)
		}
		// A share over half of a body's motion taken by one step's drag would turn the motion back faster than it goes: the drags on its
		// parts together are then scaled by 1/(share + ½), so the share they take stays under 1 and the motion dies away instead of
		// reversing. (Each part was limited on its own before: the nine parts of a 0.5 g foam pillow 2 m deep each took up to all of
		// its motion, together nine times it, and it was flung at the 5760 m/s planck allows within four steps.) A lone part's drag
		// is limited as it always was; a ball's (never limited before) is limited the same way, which only an ultralight ball needs.
		for (const d of drags) {
			const { m } = d
			const share = takes.get(m.body) ?? 0
			const scale = share > 0.5 ? 1 / (share + 0.5) : 1
			if ("ball" in d) {
				const drag = scale === 1 ? d.ball : Vec2.mul(scale, d.ball)
				if (m.lone) m.body.applyForceToCenter(drag, true)
				else m.body.applyForce(drag, d.at, true)
				continue
			}
			const fx = scale === 1 ? d.fx : d.fx * scale
			const fy = scale === 1 ? d.fy : d.fy * scale
			const torque = scale === 1 ? d.torque : d.torque * scale
			m.body.applyForceToCenter(new Vec2(fx * LENGTH_SCALE, fy * LENGTH_SCALE), true)
			m.body.applyTorque(torque * LENGTH_SCALE * LENGTH_SCALE, true)
		}
	}

	/** Resized solids' scale against their document bodies (a module's `resize`); none in a plain run. */
	const scales = new Map<string, number>()
	const placements = (): Record<string, Placement> =>
		Object.fromEntries(
			bodies.map(({ part, body, local: pose }) => {
				// A group's part: its body's pose composed with its own pose in the group (the root's is the body's).
				const p = pose === IDENTITY ? body.getPosition() : body.getWorldPoint(new Vec2(pose.at.x * LENGTH_SCALE, pose.at.y * LENGTH_SCALE))
				const squash = dents.get(part.id)
				const scale = scales.get(part.id)
				return [
					part.id,
					{
						x: p.x / LENGTH_SCALE,
						y: p.y / LENGTH_SCALE,
						angle: pose === IDENTITY ? body.getAngle() : body.getAngle() + pose.angle,
						...(squash === undefined ? {} : { squash }),
						...(scale === undefined ? {} : { scale })
					}
				]
			})
		)

	/**
	 * The processes of a document's modules (plugins.ts), with handles on the solids: their poses, velocities and masses, forces and
	 * torques on their bodies, the solids they touch, the air where they are, and resizing (a body rebuilt at `scale` × its document
	 * body: its fixture made anew, its group's mass, its air's lift and its outline's drag with it; below 1 % it is gone: it touches
	 * nothing and, alone, no longer falls). Made only when the document has processes.
	 */
	const processRunner = () => {
		const itemOf = (id: string) => (id.includes("/") ? id.slice(0, id.indexOf("/")) : id)
		const base = new Map<Member, SolidPart>()
		const middle = (m: Member) => (m.lone ? m.body.getWorldCenter() : m.body.getWorldPoint(m.center))
		const resize = (m: Member, wanted: number) => {
			const scale = Number.isFinite(wanted) ? Math.max(0, wanted) : 1
			const doc = base.get(m) ?? m.part
			base.set(m, doc)
			const k = Math.max(0.01, scale)
			const b = doc.body
			const body: SolidPart["body"] =
				b.kind === "ball"
					? { ...b, radius: b.radius * k, ...(b.wall === undefined ? {} : { wall: b.wall * k }) }
					: b.kind === "slab"
						? { ...b, width: b.width * k, height: b.height * k, depth: b.depth * k }
						: { ...b, points: b.points.map((q) => ({ x: q.x * k, y: q.y * k })), depth: b.depth * k }
			const part: SolidPart = { ...doc, body, ...(doc.length === undefined ? {} : { length: doc.length * k }) }
			const dynamic = m.part.kind === "dynamic" && m.body.isDynamic()
			m.body.destroyFixture(m.fixture)
			m.fixture = addFixture(m.body, part, m.local, dynamic, m.lone)
			m.part = part
			m.center = memberCenter(part, m.local)
			const gone = scale < 0.01
			if (gone) m.fixture.setSensor(true)
			if (dynamic && !m.lone) m.body.setMassData(groupMass(members.filter((x) => x.body === m.body)))
			if (dynamic && m.lone && gone) {
				m.body.setGravityScale(0)
				m.body.setLinearVelocity(new Vec2(0, 0))
				m.body.setAngularVelocity(0)
			}
			const lift = lifts.find((l) => l.m === m)
			if (lift !== undefined) lift.lift = gone && m.lone ? 0 : (airCarried(part) + airDensity * solidVolume(part)) * runGravity * LENGTH_SCALE
			if (part.body.kind !== "ball") outlines.set(m, outlineOf(part.body))
			scales.set(part.id, scale)
		}
		const handles = new Map<string, SolidHandle>()
		const handleOf = (m: Member): SolidHandle => {
			const id = m.part.id
			const made = handles.get(id)
			if (made !== undefined) return made
			const pose = () => {
				const p = m.local === IDENTITY ? m.body.getPosition() : m.body.getWorldPoint(new Vec2(m.local.at.x * LENGTH_SCALE, m.local.at.y * LENGTH_SCALE))
				return { x: p.x / LENGTH_SCALE, y: p.y / LENGTH_SCALE, angle: m.local === IDENTITY ? m.body.getAngle() : m.body.getAngle() + m.local.angle }
			}
			// (the mass it holds besides its own: SolidHandle.carry; 0 unless a module says so)
			let carried = 0
			const h: SolidHandle = {
				id,
				item: itemOf(id),
				get part() {
					return m.part
				},
				get dynamic() {
					return m.part.kind === "dynamic" && m.body.isDynamic()
				},
				pose,
				velocity: () => {
					const v = m.body.getLinearVelocityFromWorldPoint(middle(m))
					return { x: v.x / LENGTH_SCALE, y: v.y / LENGTH_SCALE }
				},
				spin: () => m.body.getAngularVelocity(),
				mass: () => (carried > 0 ? massOf(m.part) + carried : massOf(m.part)),
				carry: (kg) => {
					carried = Number.isFinite(kg) && kg > 0 ? kg : 0
				},
				outline: () => {
					const q = pose()
					if (m.part.body.kind === "ball") return { circle: { x: q.x, y: q.y, r: m.part.body.radius } }
					const c = Math.cos(q.angle)
					const sn = Math.sin(q.angle)
					return { points: outlineOf(m.part.body).map((v) => ({ x: q.x + v.x * c - v.y * sn, y: q.y + v.x * sn + v.y * c })) }
				},
				push: (fx, fy, at) => {
					if (!(m.part.kind === "dynamic" && m.body.isDynamic())) return
					const p = at === undefined ? middle(m) : new Vec2(at.x * LENGTH_SCALE, at.y * LENGTH_SCALE)
					m.body.applyForce(new Vec2(fx * LENGTH_SCALE, fy * LENGTH_SCALE), p, true)
				},
				twist: (torque) => {
					if (m.part.kind === "dynamic" && m.body.isDynamic()) m.body.applyTorque(torque * LENGTH_SCALE * LENGTH_SCALE, true)
				},
				scale: () => scales.get(id) ?? 1,
				resize: (k) => resize(m, k),
				setVelocity: (vx, vy, spin) => {
					if (!(m.part.kind === "dynamic" && m.body.isDynamic())) return
					m.body.setLinearVelocity(new Vec2(vx * LENGTH_SCALE, vy * LENGTH_SCALE))
					if (spin !== undefined) m.body.setAngularVelocity(spin)
					m.body.setAwake(true)
				},
				setAirShare: (share) => {
					// (plugins.ts SolidHandle.setAirShare: its buoyancy and drag scale with it; 1 = the room's again)
					if (!Number.isFinite(share)) return
					const k = Math.max(0, share)
					if (k === 1) airShares.delete(m)
					else airShares.set(m, k)
				},
				body: () => {
					// (plugins.ts BodyView: planck's mass and inertia about its origin, its centre of mass, and what is applied so far this step)
					const b = m.body
					const mass = b.getMass()
					const lc = b.getLocalCenter()
					const c = b.getWorldCenter()
					const v = b.getLinearVelocity()
					const applied = b as unknown as { m_force: Vec2; m_torque: number }
					let key = bodyKeys.get(b)
					if (key === undefined) {
						key = scene.solids.findIndex((s) => memberOf.get(s.id)?.body === b)
						bodyKeys.set(b, key)
					}
					return {
						key,
						mass,
						inertia: Math.max(0, b.getInertia() - mass * (lc.x * lc.x + lc.y * lc.y)) / (LENGTH_SCALE * LENGTH_SCALE),
						center: { x: c.x / LENGTH_SCALE, y: c.y / LENGTH_SCALE },
						velocity: { x: v.x / LENGTH_SCALE, y: v.y / LENGTH_SCALE },
						spin: b.getAngularVelocity(),
						force: { x: applied.m_force.x / LENGTH_SCALE, y: applied.m_force.y / LENGTH_SCALE },
						torque: applied.m_torque / (LENGTH_SCALE * LENGTH_SCALE),
						jointed: b.getJointList() !== null
					}
				}
			}
			handles.set(id, h)
			return h
		}
		const bodyKeys = new Map<Body, number>()
		let blownAt = -1
		let blowing: readonly Stream[] = []
		return new ProcessRunner(scene, settings, scene.processes ?? [], {
			step: STEP,
			solid: (id) => {
				const m = memberOf.get(id)
				return m === undefined ? undefined : handleOf(m)
			},
			solidsOf: (item) => bodies.filter((m) => itemOf(m.part.id) === item).map(handleOf),
			all: () => bodies.map(handleOf),
			touching: (id) => {
				const m = memberOf.get(id)
				if (m === undefined) return []
				const out: string[] = []
				for (let edge = m.body.getContactList(); edge !== null; edge = edge.next) {
					const c = edge.contact
					if (!c.isTouching()) continue
					const a = c.getFixtureA()
					const b = c.getFixtureB()
					if (a !== m.fixture && b !== m.fixture) continue
					const other = (a === m.fixture ? b : a).getUserData()
					if (isTag(other) && !out.includes(other.part.id)) out.push(other.part.id)
				}
				return out
			},
			air: (p) => {
				if (blownAt !== stepIndex) {
					blowing = streams(scene, stepIndex * STEP, placements())
					blownAt = stepIndex
				}
				return airAt(blowing, p)
			},
			time: () => stepIndex * STEP,
			released: () => stepIndex > releaseStep,
			// (plugins.ts EngineInternals: for modules whose physics are constraints planck solves with the rest)
			engine: {
				world,
				lengthScale: LENGTH_SCALE,
				bodyOf: (id) => (id === null ? world0 : memberOf.get(id)?.body),
				anchorOn: (id, p) => anchorOn(id, p),
				directionOn: (id, d) => directionOn(id, d),
				solidOf: (tag) => (isTag(tag) ? { id: tag.part.id, item: itemOf(tag.part.id), kind: tag.part.kind } : undefined),
				startPose: (id) => start(id),
				meeting: (a, b) => {
					const pa = solidById.get(a)
					const pb = solidById.get(b)
					const c = pa === undefined || pb === undefined ? undefined : contactOf(scene, pa.material, pb.material)
					return { friction: c?.friction ?? 0, restitution: c?.restitution ?? 0, rolling: c?.rollingResistance ?? 0 }
				},
				hit: (a, b, speed) => {
					hits.push({ t: stepIndex * STEP, a, b, speed })
					if (speed > (impacts.get(stepIndex) ?? 0)) impacts.set(stepIndex, speed)
				},
				// (read-only views for force arrows and energy bars: nothing here changes the run)
				afterSolve: (fn) => {
					solvedHooks.push(fn)
				},
				airOn: (id) => {
					const m = memberOf.get(id)
					if (m === undefined || m.part.kind !== "dynamic" || !m.body.isDynamic()) return undefined
					// (this (sub-)step's drags by part, indexed once per airDrag: `drags` is refilled each time, the same array)
					if (airIndex.stamp !== airStamp) {
						airIndex.stamp = airStamp
						airIndex.drag.clear()
						for (const d of drags) {
							const share = takes.get(d.m.body) ?? 0
							const scale = share > 0.5 ? 1 / (share + 0.5) : 1
							const o = airIndex.drag.get(d.m) ?? { x: 0, y: 0 }
							if ("ball" in d) {
								o.x += (d.ball.x / LENGTH_SCALE) * scale
								o.y += (d.ball.y / LENGTH_SCALE) * scale
							} else {
								o.x += d.fx * scale
								o.y += d.fy * scale
							}
							airIndex.drag.set(d.m, o)
						}
					}
					const dm = airIndex.drag.get(m)
					const x = dm?.x ?? 0
					const y = dm?.y ?? 0
					if (airIndex.lift === undefined) airIndex.lift = new Map(lifts.map((q) => [q.m, q]))
					const l = airIndex.lift.get(m)
					// (its lift less the carried air's weight it gives back: the buoyancy of the air its volume displaces)
					const lift = l === undefined ? 0 : Math.max(0, l.lift / LENGTH_SCALE - airCarried(m.part) * runGravity)
					return { x, y, lift }
				},
				jointForce: (joint, body, inv_dt) => jointForceOn(joint as PlanckJoint, body as Body, inv_dt),
				spring: (joint) => (joint instanceof SpringLink ? joint.stretchNow() : undefined),
				springWeights: (body) => springWeights.filter((w) => w.body === body).map((w) => {
					const p = w.body.getWorldPoint(w.anchor)
					return { force: w.force, at: { x: p.x / LENGTH_SCALE, y: p.y / LENGTH_SCALE } }
				})
			}
		})
	}

	const stepsPerFrame = Math.round(1 / fps / STEP)
	const releaseStep = Math.round(scene.release.at / STEP)
	const lastStep = Math.round(scene.seconds / STEP)
	const states: Record<string, Placement>[] = []
	// Module processes (tooling/src/sim/plugins.ts): none in a plain document, which then runs exactly as before. (Made inside the try, so a
	// module that cannot start is said like any failure: "the simulation failed at 0.000 s (...)".)
	let runner: ProcessRunner | undefined
	try {
	runner = scene.processes === undefined || scene.processes.length === 0 ? undefined : processRunner()
	runner?.start()
	for (stepIndex = 0; stepIndex <= lastStep; stepIndex++) {
		runner?.step(stepIndex)
		if (stepIndex > releaseStep) {
			steerHitboxes(stepIndex * STEP)
			dampPivots()
			let rates = springRates()
			const n = springGroups.length > 0 ? subSteps(rates) : 1
			h = STEP / n
			for (let k = 0; k < n; k++) {
				if (k > 0) {
					dampPivots()
					rates = springRates()
				}
				tuneSprings(rates)
				if (k === 0 && chains.length > 0) touchChains()
				if (curvedJoints.length > 0) freeJoints()
				rollingResistance()
				airLift()
				if (springWeights.length > 0) springWeight()
				airDrag()
				runner?.force(h)
				Settings.maxTranslation = SANE_SPEED * LENGTH_SCALE * h
				struck.clear()
				passed.clear()
				held.clear()
				for (const [body, at] of began) at.set(body.getTransform())
				world.step(h)
				springBack()
				unsound("ending")
				keepSane()
				runner?.after(h)
			}
		}
		states.push(touching.get(stepIndex) ?? placements())
		runner?.record()
	}
	runner?.end()
	} catch (e) {
		// any other failure inside a step: said in one line, with when (never planck's own words alone, which say nothing of the scene)
		if (e instanceof SimulationError) throw e
		const what = e instanceof Error ? e.message : String(e)
		throw new SimulationError(`the simulation failed at ${(stepIndex * STEP).toFixed(3)} s (${what.trim().split("\n")[0]})`)
	}
	if (overSpeed > 0)
		console.warn(
			`${overSpeed} times in this run a part was moving faster than ${SANE_SPEED} m/s (its centre, or a point of it as it turned) and was slowed to it: solids wedged deep inside one another, which the solver cannot part`
		)
	const shown = new Map<number, number>()
	for (let k = 0; k * stepsPerFrame <= lastStep; k++) shown.set(k, k * stepsPerFrame)
	// The frame nearest each impact shows it; of two in one frame's reach, the harder.
	const strongest = new Map<number, number>()
	for (const [step, speed] of impacts) {
		const k = Math.round(step / stepsPerFrame)
		if (shown.has(k) && speed > (strongest.get(k) ?? 0)) {
			strongest.set(k, speed)
			shown.set(k, step)
		}
	}
	const order = [...shown.entries()].sort(([a], [b]) => a - b)
	const frames = order.map(([, step]) => ({ t: step * STEP, placements: states[step] ?? {} }))
	if (runner === undefined) return { fps, frames, impacts: hits }
	return { fps, frames, impacts: hits, ...runner.extras(order.map(([, step]) => step)) }
}

const massOf = (part: SolidPart) => mass(part)

/** A part's pose in its own group's root frame, when it is the root itself (or alone). */
const IDENTITY: Pose = { at: { x: 0, y: 0 }, angle: 0 }

/** A solid in the simulation: its part, the body of its weld group, and where it sits on that body. */
interface Member {
	/** (replaced, with `fixture` and `center`, when a module resizes it: plugins.ts) */
	part: SolidPart
	readonly body: Body
	/** Its pose in its group root's frame (meters, radians); `IDENTITY` for the root. */
	readonly local: Pose
	fixture: Fixture
	/** Alone in its group: its body is exactly the part, as every body was before weld groups. */
	readonly lone: boolean
	/** Where its own mass is centred, in its body's frame (planck units). */
	center: Vec2
}

/** A point of a part's own frame in its body's frame (planck units), given its pose in the group. */
const placeIn = (local: Pose, x: number, y: number) => {
	if (local === IDENTITY) return new Vec2(x * LENGTH_SCALE, y * LENGTH_SCALE)
	const c = Math.cos(local.angle)
	const s = Math.sin(local.angle)
	return new Vec2((local.at.x + x * c - y * s) * LENGTH_SCALE, (local.at.y + x * s + y * c) * LENGTH_SCALE)
}

/**
 * A part's collision shape on its body, with its density (its mass over its area, so planck's mass is the
 * specified one; 0 on a fixed body). A lone part is built exactly as it always was (a ball also gets its
 * sphere's or shell's inertia here); a part of a weld group is the same shape carried to its pose in the
 * group, and its group's mass is set from all of them afterwards (`groupMass`).
 */
/** A ghost solid's fixture collides with nothing (its mask is 0); every other fixture keeps planck's defaults (nothing added to its def). */
const ghostFilter = (part: SolidPart) => (part.ghost === true ? { filterMaskBits: 0 } : {})

const addFixture = (body: Body, part: SolidPart, local: Pose, dynamic: boolean, lone: boolean) => {
	const tag: Tag = { part }
	if (part.body.kind === "ball") {
		const r = part.body.radius * LENGTH_SCALE
		const fixture = body.createFixture(local === IDENTITY ? new CircleShape(r) : new CircleShape(placeIn(local, 0, 0), r), {
			density: dynamic ? massOf(part) / (Math.PI * r * r) : 0,
			userData: tag,
			...ghostFilter(part)
		})
		if (dynamic && lone) {
			// Box2D gives a circle a disk's rotational inertia; a ball is a sphere (2/5 m r²) or,
			// hollow, a shell of its wall's thickness (2/3 m r² as the wall thins), which changes how
			// it rolls. The air it carries adds to its inertial mass only (see `airLift`).
			const k = part.body.inertia ?? ballInertia(part.body.radius, part.body.wall)
			body.setMassData({ mass: massOf(part) + airCarried(part), center: new Vec2(0, 0), I: k * massOf(part) * r * r })
		}
		return fixture
	}
	if (part.body.kind === "polygon" || !lone) {
		// Its outline as specified, like a slab's not shrunk by the skin, so it tips over its true corners.
		// Its density makes planck's mass exactly the specified one: the area is planck's, from the same
		// scaled points (a polygon square is then the very fixture its slab is). A slab in a weld group is
		// its outline too, carried to where it sits in the group, as a polygon rectangle would be.
		const points = outlineOf(part.body).map((p) => placeIn(local, p.x, p.y))
		return body.createFixture(new PolygonShape(points), {
			density: dynamic ? massOf(part) / polygonArea(points) : 0,
			userData: tag,
			...ghostFilter(part)
		})
	}
	// Not shrunk by Box2D's 1 mm skin: the skin rounds a slab's corners about its true corners,
	// so a domino still tips at atan(T/H); built smaller, a thin one would tip degrees early.
	const hw = (part.body.width / 2) * LENGTH_SCALE
	const hh = (part.body.height / 2) * LENGTH_SCALE
	const taper = part.body.taper ?? 1
	const shape =
		part.body.taper === undefined
			? new BoxShape(hw, hh)
			: new PolygonShape([new Vec2(-hw * taper, -hh), new Vec2(hw * taper, -hh), new Vec2(hw, hh), new Vec2(-hw, hh)])
	return body.createFixture(shape, {
		density: dynamic ? massOf(part) / (2 * (1 + taper) * hw * hh) : 0,
		userData: tag,
		...ghostFilter(part)
	})
}

/** A slab's or a polygon's outline in its own frame, meters, counterclockwise (a slab's from its bottom left corner). */
const outlineOf = (body: Exclude<SolidPart["body"], { kind: "ball" }>): readonly Vec[] => {
	if (body.kind === "polygon") return body.points
	const w = body.width / 2
	const h = body.height / 2
	const t = body.taper ?? 1
	return [
		{ x: -w * t, y: -h },
		{ x: w * t, y: -h },
		{ x: w, y: h },
		{ x: -w, y: h }
	]
}

/** Where a part's own mass is centred, in its body's frame (planck units): a ball's or a slab's middle, a polygon's centroid. */
const memberCenter = (part: SolidPart, local: Pose) => {
	if (part.body.kind === "ball") return placeIn(local, 0, 0)
	const c = polygonCentroid(outlineOf(part.body))
	return placeIn(local, c.x, c.y)
}

/**
 * A weld group's mass, centre of mass and rotational inertia about its body's origin (planck units): each
 * ball as a lone ball (its sphere's or shell's inertia, and the air it carries as inertial mass), each slab
 * or polygon as planck reckons its fixture, each moved to where it sits by the parallel-axis rule.
 */
const groupMass = (group: readonly Member[]) => {
	let total = 0
	let mx = 0
	let my = 0
	let inertia = 0
	const own = { mass: 0, center: new Vec2(0, 0), I: 0 }
	for (const m of group) {
		const part = m.part
		if (part.body.kind === "ball") {
			const r = part.body.radius * LENGTH_SCALE
			const k = part.body.inertia ?? ballInertia(part.body.radius, part.body.wall)
			const c = m.center
			const mass = massOf(part) + airCarried(part)
			total += mass
			mx += mass * c.x
			my += mass * c.y
			inertia += k * massOf(part) * r * r + mass * (c.x * c.x + c.y * c.y)
		} else {
			m.fixture.getMassData(own)
			total += own.mass
			mx += own.mass * own.center.x
			my += own.mass * own.center.y
			inertia += own.I
		}
	}
	return { mass: total, center: new Vec2(total > 0 ? mx / total : 0, total > 0 ? my / total : 0), I: inertia }
}

/**
 * planck's working state of a body during a step (its centre of mass and angle, its velocity, its inverse mass and
 * rotational inertia), which a joint reads and writes while the step solves it.
 */
interface Solving {
	readonly c_velocity: { v: Vec2; w: number }
	readonly c_position: { c: Vec2; a: number }
	readonly m_invMass: number
	readonly m_invI: number
}
const solving = (body: Body) => body as unknown as Solving

/** An impulse (planck units) along unit `u`, +j on B at arm rB and −j on A at arm rA, into their working velocities. */
const impulseAlong = (A: Solving, B: Solving, rA: Vec2, rB: Vec2, u: Vec2, j: number) => {
	const px = j * u.x
	const py = j * u.y
	A.c_velocity.v.x -= A.m_invMass * px
	A.c_velocity.v.y -= A.m_invMass * py
	A.c_velocity.w -= A.m_invI * (rA.x * py - rA.y * px)
	B.c_velocity.v.x += B.m_invMass * px
	B.c_velocity.v.y += B.m_invMass * py
	B.c_velocity.w += B.m_invI * (rB.x * py - rB.y * px)
}

/**
 * The force (N, world) a joint's last solve put on one of its bodies, or undefined (not one of its bodies, or a joint whose way of acting is
 * not known here: a module's own). planck's joints (and the hinge and cord made from them) give their reaction on body B; on A it is the
 * opposite. A pulley's rope pulls each end along its own run, a chain's touch its touching body and its two ends (`forceOn`). Read only.
 */
const jointForceOn = (joint: PlanckJoint, body: Body, inv_dt: number): { x: number; y: number } | undefined => {
	if (joint instanceof RopePulley || joint instanceof ChainTouch) {
		const f = joint.forceOn(body, inv_dt)
		return f === undefined ? undefined : { x: f.x / LENGTH_SCALE, y: f.y / LENGTH_SCALE }
	}
	const builtIn = joint instanceof SpringLink || ["revolute-joint", "rope-joint", "weld-joint", "wheel-joint", "prismatic-joint", "distance-joint", "pulley-joint", "friction-joint", "motor-joint", "mouse-joint"].includes(joint.getType())
	if (!builtIn) return undefined
	const sign = body === joint.getBodyB() ? 1 : body === joint.getBodyA() ? -1 : 0
	if (sign === 0) return undefined
	const f = joint.getReactionForce(inv_dt)
	return { x: (sign * f.x) / LENGTH_SCALE, y: (sign * f.y) / LENGTH_SCALE }
}

/**
 * A spring between two bodies, F = −k(d − rest) − c·ḋ along the line between its anchors (a compress-only one only
 * pushes), solved inside planck's step as a joint, so that no stiffness, damping or mass can make it gain energy.
 * Its Hooke force is the step's impulse from the stretch at the step's start, exactly as a force applied before the
 * step was. Its damping is the trapezoidal rule, half from the relative speed along it at the step's start and half
 * from that at its end, solved as a soft velocity constraint (after Box2D's soft springs): second-order accurate, and
 * when a step's damping would take more than the whole relative speed (c·h/m > 2: an explicit c·ḋ threw a 14 g plate
 * off at 344 m/s) more of it is taken at the end, so it brings that speed to rest in the step and never reverses it.
 * A spring too stiff for the step to follow takes a share `theta` of its stiffness implicitly as well, as damping of
 * θ·h·k, which keeps it steady at any stiffness (see `tuneSprings`); so does the sideways stiffness T/d a stretched spring
 * has (a taut string's: a 14 g plate between two 10⁷ N/m springs rings sideways faster than the step can follow), across
 * its line. A pushed spring's sideways instability (a plate standing on two springs buckles sideways like a column, as a
 * real one without guides would) is left as it is. With θ = 0 the stiffness is the symplectic step it always was: the
 * same period, no energy drift. Its two bodies still collide, as without it.
 */
class SpringLink extends PlanckJoint {
	/** The share of its stiffness solved implicitly this step (0 to 1), set before each step. */
	theta = 0
	private readonly k: number
	private readonly c: number
	private readonly rest: number
	private readonly pushOnly: boolean
	private readonly la: Vec2
	private readonly lb: Vec2
	private readonly u = new Vec2(0, 1)
	private readonly rA = new Vec2(0, 0)
	private readonly rB = new Vec2(0, 0)
	private active = false
	private stretch = 0
	/** Its stretching speed along its line at the step's start, planck units. */
	private rate0 = 0
	/** How fast its two anchors move against each other at the step's start (any way), planck units: whether it is swinging at all (`subSteps`). */
	motion = 0
	private invMass = 0
	private gamma = 0
	private hooke = 0
	private damper = 0
	/** Across its line (its line turned a quarter counterclockwise): the taut spring's sideways stiffness T/d (N/m), its mass, damper and impulse. */
	private side = 0
	private invSide = 0
	private gammaSide = 0
	private across = 0
	constructor(a: Body, b: Body, la: Vec2, lb: Vec2, spec: Extract<Joint, { kind: "spring" }>) {
		super({ collideConnected: true }, a, b)
		;(this as unknown as { m_type: string }).m_type = "spring-link"
		this.k = spec.stiffness
		this.c = spec.damping
		this.rest = spec.rest
		this.pushOnly = spec.compressOnly === true
		this.la = la
		this.lb = lb
	}
	/**
	 * Its line, stretch and the mass along it, from where its bodies stand now (before the step); wakes its bodies when
	 * it acts. Returns k / (that mass), 1/s², its share of how fast the springs on its bodies can swing them.
	 */
	prepare() {
		const A = this.m_bodyA
		const B = this.m_bodyB
		const pa = A.getWorldPoint(this.la)
		const pb = B.getWorldPoint(this.lb)
		const dx = pb.x - pa.x
		const dy = pb.y - pa.y
		const d = Math.sqrt(dx * dx + dy * dy)
		this.stretch = d / LENGTH_SCALE - this.rest
		this.active = d / LENGTH_SCALE >= 1e-9 && !(this.pushOnly && this.stretch >= 0)
		this.motion = 0
		if (!this.active) return 0
		this.u.x = dx / d
		this.u.y = dy / d
		const ca = A.getWorldCenter()
		const cb = B.getWorldCenter()
		this.rA.x = pa.x - ca.x
		this.rA.y = pa.y - ca.y
		this.rB.x = pb.x - cb.x
		this.rB.y = pb.y - cb.y
		const sa = solving(A)
		const sb = solving(B)
		const crA = this.rA.x * this.u.y - this.rA.y * this.u.x
		const crB = this.rB.x * this.u.y - this.rB.y * this.u.x
		this.invMass = sa.m_invMass + sa.m_invI * crA * crA + sb.m_invMass + sb.m_invI * crB * crB
		// (its line turned counterclockwise: r × n = r · u)
		const dnA = this.rA.x * this.u.x + this.rA.y * this.u.y
		const dnB = this.rB.x * this.u.x + this.rB.y * this.u.y
		this.invSide = sa.m_invMass + sa.m_invI * dnA * dnA + sb.m_invMass + sb.m_invI * dnB * dnB
		this.side = this.stretch > 0 ? (this.k * this.stretch) / (d / LENGTH_SCALE) : 0
		const va = A.getLinearVelocityFromWorldPoint(pa)
		const vb = B.getLinearVelocityFromWorldPoint(pb)
		this.rate0 = (vb.x - va.x) * this.u.x + (vb.y - va.y) * this.u.y
		this.motion = Math.sqrt((vb.x - va.x) * (vb.x - va.x) + (vb.y - va.y) * (vb.y - va.y))
		if (A.isDynamic() && !A.isAwake()) A.setAwake(true)
		if (B.isDynamic() && !B.isAwake()) B.setAwake(true)
		return this.k * this.invMass + this.side * this.invSide
	}
	initVelocityConstraints(step: TimeStep) {
		this.damper = 0
		if (!this.active || this.invMass === 0) return
		const h = step.dt
		// the share of the damping taken from the speed at the step's end: half (the trapezoidal rule), or more where half from the
		// start would take more than that whole speed (β = c·h/m > 2)
		const beta = this.c * h * this.invMass
		const late = beta > 2 ? 1 - 1 / beta : 0.5
		// the step's Hooke impulse (planck's force is newtons × LENGTH_SCALE) and the damping from the start's speed, +: pushes B away from A
		this.hooke = -this.k * this.stretch * LENGTH_SCALE * h - (1 - late) * this.c * h * this.rate0
		const soft = late * this.c + this.theta * h * this.k
		this.gamma = soft > 0 ? 1 / (h * soft) : Number.POSITIVE_INFINITY
		const softSide = this.theta * h * this.side
		this.gammaSide = softSide > 0 ? 1 / (h * softSide) : Number.POSITIVE_INFINITY
		this.across = 0
		impulseAlong(solving(this.m_bodyA), solving(this.m_bodyB), this.rA, this.rB, this.u, this.hooke)
	}
	solveVelocityConstraints(_step: TimeStep) {
		if (!this.active || this.invMass === 0) return
		const A = solving(this.m_bodyA)
		const B = solving(this.m_bodyB)
		if (this.gamma !== Number.POSITIVE_INFINITY) {
			const vA = A.c_velocity.v
			const vB = B.c_velocity.v
			const wA = A.c_velocity.w
			const wB = B.c_velocity.w
			const rate = this.u.x * (vB.x - wB * this.rB.y - vA.x + wA * this.rA.y) + this.u.y * (vB.y + wB * this.rB.x - vA.y - wA * this.rA.x)
			let j = -(rate + this.gamma * this.damper) / (this.invMass + this.gamma)
			// a compress-only spring's whole impulse only ever pushes
			if (this.pushOnly) j = Math.max(this.damper + j, -this.hooke) - this.damper
			this.damper += j
			impulseAlong(A, B, this.rA, this.rB, this.u, j)
		}
		if (this.gammaSide !== Number.POSITIVE_INFINITY) {
			const n = new Vec2(-this.u.y, this.u.x)
			const vA = A.c_velocity.v
			const vB = B.c_velocity.v
			const wA = A.c_velocity.w
			const wB = B.c_velocity.w
			const rate = n.x * (vB.x - wB * this.rB.y - vA.x + wA * this.rA.y) + n.y * (vB.y + wB * this.rB.x - vA.y - wA * this.rA.x)
			const j = -(rate + this.gammaSide * this.across) / (this.invSide + this.gammaSide)
			this.across += j
			impulseAlong(A, B, this.rA, this.rB, n, j)
		}
	}
	solvePositionConstraints(_step: TimeStep) {
		return true
	}
	getAnchorA() {
		return this.m_bodyA.getWorldPoint(this.la)
	}
	getAnchorB() {
		return this.m_bodyB.getWorldPoint(this.lb)
	}
	getReactionForce(inv_dt: number) {
		return Vec2.mul((this.hooke + this.damper) * inv_dt, this.u)
	}
	/** Its stiffness (N/m) and its stretch now (m: d − rest; − squeezed; 0 for a compress-only spring stretched past its rest, which pulls nothing). Read only. */
	stretchNow() {
		const pa = this.m_bodyA.getWorldPoint(this.la)
		const pb = this.m_bodyB.getWorldPoint(this.lb)
		const d = Math.sqrt((pb.x - pa.x) * (pb.x - pa.x) + (pb.y - pa.y) * (pb.y - pa.y)) / LENGTH_SCALE
		const x = d - this.rest
		return { k: this.k, x: this.pushOnly && x >= 0 ? 0 : x }
	}
	/** How much this step's impulses of this spring changed a body's velocity (planck units: linear and angular), once the step's solve is done. */
	pushOn(body: Body) {
		if (!this.active || this.invMass === 0 || (body !== this.m_bodyA && body !== this.m_bodyB)) return undefined
		const sign = body === this.m_bodyB ? 1 : -1
		const along = this.hooke + this.damper
		const px = sign * (along * this.u.x - this.across * this.u.y)
		const py = sign * (along * this.u.y + this.across * this.u.x)
		const r = body === this.m_bodyB ? this.rB : this.rA
		const s = solving(body)
		return { x: s.m_invMass * px, y: s.m_invMass * py, w: s.m_invI * (r.x * py - r.y * px) }
	}
	getReactionTorque(_inv_dt: number) {
		return 0
	}
}

/**
 * β in (0, π/2) with β·tan β = x: the fundamental mode of a uniform spring with one end fixed and a mass m on the other, x = mₛ/m
 * (its period 2π·√(mₛ/k)/β). Found by bisection on β·sin β − x·cos β, which rises from −x to π/2 over the interval: the same steps,
 * and so the same bits, wherever it runs.
 */
const fundamentalMode = (x: number) => {
	if (!(x > 0)) return Number.NaN
	let lo = 0
	let hi = Math.PI / 2
	for (let i = 0; i < 64; i++) {
		const mid = (lo + hi) / 2
		if (mid * Math.sin(mid) - x * Math.cos(mid) < 0) lo = mid
		else hi = mid
	}
	return (lo + hi) / 2
}

/**
 * The middle of a spring between two moving bodies (`simulate`'s spring masses): a mass `mass` (2mₛ/3) that moves as the middle of its
 * two anchors does, its velocity their mean, and has its own weight. With mₛ/6 at each end it is a uniform bar's consistent mass matrix,
 * mₛ/6·[[2, 1], [1, 2]]: the pair carries the whole mₛ as it moves, the stretching swing mₛ/6 at each end (Rayleigh's), each end half
 * its weight. It is a velocity constraint between the bodies and this mass alone (it has no place of its own: the middle of the
 * anchors is where it is), solved with planck's other constraints; nothing collides with it.
 */
class SpringMass extends PlanckJoint {
	private readonly la: Vec2
	private readonly lb: Vec2
	private readonly mass: number
	private rA = new Vec2(0, 0)
	private rB = new Vec2(0, 0)
	/** The middle's velocity (planck units). */
	private readonly w = new Vec2(0, 0)
	/** The 2 × 2 effective mass's inverse: (¼(K_A + K_B) + 1/mass)⁻¹, symmetric. */
	private m11 = 0
	private m12 = 0
	private m22 = 0
	constructor(a: Body, b: Body, la: Vec2, lb: Vec2, mass: number) {
		super({ collideConnected: true }, a, b)
		;(this as unknown as { m_type: string }).m_type = "spring-mass"
		this.la = la
		this.lb = lb
		this.mass = mass
	}
	initVelocityConstraints(step: TimeStep) {
		const A = this.m_bodyA
		const B = this.m_bodyB
		const ca = A.getWorldCenter()
		const cb = B.getWorldCenter()
		const pa = A.getWorldPoint(this.la)
		const pb = B.getWorldPoint(this.lb)
		this.rA = new Vec2(pa.x - ca.x, pa.y - ca.y)
		this.rB = new Vec2(pb.x - cb.x, pb.y - cb.y)
		// the middle's velocity as the step began (the bodies' own, before this step's forces), and this step's gravity on it
		const va = A.getLinearVelocityFromWorldPoint(pa)
		const vb = B.getLinearVelocityFromWorldPoint(pb)
		this.w.x = (va.x + vb.x) / 2
		this.w.y = (vb.y + va.y) / 2 - runGravity * LENGTH_SCALE * step.dt
		const sa = solving(A)
		const sb = solving(B)
		const k11 = (sa.m_invMass + sa.m_invI * this.rA.y * this.rA.y + sb.m_invMass + sb.m_invI * this.rB.y * this.rB.y) / 4 + 1 / this.mass
		const k12 = (-sa.m_invI * this.rA.x * this.rA.y - sb.m_invI * this.rB.x * this.rB.y) / 4
		const k22 = (sa.m_invMass + sa.m_invI * this.rA.x * this.rA.x + sb.m_invMass + sb.m_invI * this.rB.x * this.rB.x) / 4 + 1 / this.mass
		const det = k11 * k22 - k12 * k12
		this.m11 = k22 / det
		this.m12 = -k12 / det
		this.m22 = k11 / det
	}
	solveVelocityConstraints(_step: TimeStep) {
		const A = solving(this.m_bodyA)
		const B = solving(this.m_bodyB)
		const vA = A.c_velocity.v
		const vB = B.c_velocity.v
		const wA = A.c_velocity.w
		const wB = B.c_velocity.w
		// how far the anchors' mean velocity is from the middle's
		const cx = (vA.x - wA * this.rA.y + vB.x - wB * this.rB.y) / 2 - this.w.x
		const cy = (vA.y + wA * this.rA.x + vB.y + wB * this.rB.x) / 2 - this.w.y
		const px = -(this.m11 * cx + this.m12 * cy)
		const py = -(this.m12 * cx + this.m22 * cy)
		// half of it at each anchor, all of it (the other way) on the middle
		const hx = px / 2
		const hy = py / 2
		vA.x += A.m_invMass * hx
		vA.y += A.m_invMass * hy
		A.c_velocity.w += A.m_invI * (this.rA.x * hy - this.rA.y * hx)
		vB.x += B.m_invMass * hx
		vB.y += B.m_invMass * hy
		B.c_velocity.w += B.m_invI * (this.rB.x * hy - this.rB.y * hx)
		this.w.x -= px / this.mass
		this.w.y -= py / this.mass
	}
	solvePositionConstraints(_step: TimeStep) {
		return true
	}
	getAnchorA() {
		return this.m_bodyA.getWorldPoint(this.la)
	}
	getAnchorB() {
		return this.m_bodyB.getWorldPoint(this.lb)
	}
	getReactionForce(_inv_dt: number) {
		return new Vec2(0, 0)
	}
	getReactionTorque(_inv_dt: number) {
		return 0
	}
}

/**
 * How far a point of a body moves in a step at its working velocity: its arm r from the centre of mass turns by φ = h·ω
 * as the centre moves h·v, so d = h·(v + ω × r) + h·bend, the bend of its path away from its velocity over the step
 * (`bendOf`) taken from `w0`, the body's turning as the step began. The bend is a target the solve holds constant through
 * the step: read from the working ω, which every pass of the solve changes, it fed back on itself (a body the step turned fast,
 * or one a jam's warm-started impulses set spinning for a pass, was given ever more speed: a pinned rod jammed in a table
 * reached planck's limit of 4π a step, then NaN, which made the time-of-impact pass throw). Taken from the step's start it is
 * the bend of the path the body is on, and the constraint is linear in the velocities, as planck's own are.
 */
const stepDrift = (body: Solving, r: Vec2, h: number, w0: number) => {
	const v = body.c_velocity.v
	const w = body.c_velocity.w
	const b = bendOf(w0, r, h)
	return { x: h * (v.x - w * r.y + b.x), y: h * (v.y + w * r.x + b.y) }
}

/**
 * A body's working position of a point fixed in it (planck units): its centre and angle as the step has them now. A fixed body
 * is where it always is (planck keeps no working position for one that no moving body's island reaches: a chain's post).
 */
const workingPoint = (body: Body, local: Vec2) => {
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

/**
 * A rope over two pulley wheels: run A from ground point gA down to its body's anchor, run B from gB to its, with
 * lengthA + ratio·lengthB at most what it starts at. Unlike planck's pulley (an equality) the rope only ever pulls: a
 * pail that lands lets the weight it hauls fly on, its rope going slack, instead of the rope stopping it. And a rope's
 * end jams at its wheel: run A is never shorter than `minA` (its body meets the wheel), and so, the rope being no longer
 * than it is, run B never longer than (total − minA)/ratio; the same the other way. That cap holds the side that hauls
 * directly (a 3 kg weight hauling a 50 g one up into its wheel is held by the axle, not through the light one, which
 * the solver could not hold it by: it ran 26 mm on past its stop). Each is a one-sided constraint solved on where the
 * step will leave the rope (its ends' paths over the step, turning included), so a swinging pail keeps its energy, and a
 * rope end arriving at its stop stops there, dead, as a jammed rope end does. Its two bodies collide, as planck's do.
 */
class RopePulley extends PlanckJoint {
	private readonly ga: Vec2
	private readonly gb: Vec2
	private readonly la: Vec2
	private readonly lb: Vec2
	private readonly ratio: number
	private readonly total: number
	private readonly minA: number
	private readonly minB: number
	/** Accumulated impulses this step (planck units, each ≥ 0): the rope's tension, the two stops and the two caps. */
	private rope = 0
	private stopA = 0
	private stopB = 0
	private capA = 0
	private capB = 0
	private readonly arms = { rA: new Vec2(0, 0), rB: new Vec2(0, 0), uA: new Vec2(0, 1), uB: new Vec2(0, 1), lenA: 0, lenB: 0, invA: 0, invB: 0 }
	private w0A = 0
	private w0B = 0
	/** Whether neither of its bodies touches anything this step (`curvedJoints`). */
	free = true
	constructor(a: Body, b: Body, ga: Vec2, gb: Vec2, la: Vec2, lb: Vec2, ratio: number, minA: number, minB: number) {
		super({ collideConnected: true }, a, b)
		;(this as unknown as { m_type: string }).m_type = "rope-pulley"
		this.ga = ga
		this.gb = gb
		this.la = la
		this.lb = lb
		this.ratio = ratio
		const lenA = Vec2.distance(a.getWorldPoint(la), ga)
		const lenB = Vec2.distance(b.getWorldPoint(lb), gb)
		this.total = lenA + ratio * lenB
		// (a body that starts nearer its wheel than its stop stops where it starts)
		this.minA = Math.min(minA, lenA)
		this.minB = Math.min(minB, lenB)
	}
	/** Both runs where the step has them now: arms, directions (from the ground point to the anchor), lengths and the masses along them. */
	private measure() {
		const A = this.m_bodyA
		const B = this.m_bodyB
		const a = workingPoint(A, this.la)
		const b = workingPoint(B, this.lb)
		const g = this.arms
		g.rA = a.r
		g.rB = b.r
		const dax = a.p.x - this.ga.x
		const day = a.p.y - this.ga.y
		const dbx = b.p.x - this.gb.x
		const dby = b.p.y - this.gb.y
		g.lenA = Math.sqrt(dax * dax + day * day)
		g.lenB = Math.sqrt(dbx * dbx + dby * dby)
		g.uA = g.lenA > 0 ? new Vec2(dax / g.lenA, day / g.lenA) : new Vec2(0, 0)
		g.uB = g.lenB > 0 ? new Vec2(dbx / g.lenB, dby / g.lenB) : new Vec2(0, 0)
		const sa = solving(A)
		const sb = solving(B)
		const crA = g.rA.x * g.uA.y - g.rA.y * g.uA.x
		const crB = g.rB.x * g.uB.y - g.rB.y * g.uB.x
		g.invA = sa.m_invMass + sa.m_invI * crA * crA
		g.invB = sb.m_invMass + sb.m_invI * crB * crB
		return g
	}
	initVelocityConstraints(_step: TimeStep) {
		this.measure()
		// (each body's turning as the step began: the bend of its anchor's path, `stepDrift`)
		this.w0A = this.m_bodyA.getAngularVelocity()
		this.w0B = this.m_bodyB.getAngularVelocity()
		this.rope = 0
		this.stopA = 0
		this.stopB = 0
		this.capA = 0
		this.capB = 0
	}
	/** An impulse along run A on its body (+: away from the ground point) and along run B on its (+: away from its ground point). */
	private apply(ja: number, jb: number) {
		const g = this.arms
		const A = solving(this.m_bodyA)
		const B = solving(this.m_bodyB)
		if (ja !== 0) {
			A.c_velocity.v.x += A.m_invMass * ja * g.uA.x
			A.c_velocity.v.y += A.m_invMass * ja * g.uA.y
			A.c_velocity.w += A.m_invI * ja * (g.rA.x * g.uA.y - g.rA.y * g.uA.x)
		}
		if (jb !== 0) {
			B.c_velocity.v.x += B.m_invMass * jb * g.uB.x
			B.c_velocity.v.y += B.m_invMass * jb * g.uB.y
			B.c_velocity.w += B.m_invI * jb * (g.rB.x * g.uB.y - g.rB.y * g.uB.x)
		}
	}
	solveVelocityConstraints(step: TimeStep) {
		const g = this.arms
		const h = step.dt
		/**
		 * The run lengths the step will leave if nothing more is done (each body's anchor moved by its path over the step), and
		 * each run's length along its direction at the step's start (sa, sb): an end that would pass its ground point within the
		 * step has a short or negative one there, where its length at the step's end may be long again, out the other side.
		 */
		const ends = () => {
			const da = stepDrift(solving(this.m_bodyA), g.rA, h, this.free ? this.w0A : 0)
			const db = stepDrift(solving(this.m_bodyB), g.rB, h, this.free ? this.w0B : 0)
			const sa = g.lenA + g.uA.x * da.x + g.uA.y * da.y
			const sb = g.lenB + g.uB.x * db.x + g.uB.y * db.y
			// (one of its bodies touching something: its runs along their lines as they are)
			if (!this.free) return { a: sa, b: sb, sa, sb }
			const ax = g.uA.x * g.lenA + da.x
			const ay = g.uA.y * g.lenA + da.y
			const bx = g.uB.x * g.lenB + db.x
			const by = g.uB.y * g.lenB + db.y
			return { a: Math.sqrt(ax * ax + ay * ay), b: Math.sqrt(bx * bx + by * by), sa, sb }
		}
		const r = this.ratio
		// each one-sided limit: how far past it the step would end (beyond what it is past now, which the position pass removes)
		// over h, times the mass along it, is the impulse it needs; its total stays ≥ 0. A stop reads its run by the run's length
		// along its direction at the step's start (`ends`: never more than its length at the step's end), so a rope end hauled fast
		// at its ground point stops there instead of passing through it within a step (a 45 g cube tied at its top, no wheel radius:
		// it passed at 1.5 m/s, then both bodies were flung 8 m up on the pulley's turned-over runs).
		if (g.invA > 0) {
			const e = ends()
			const over = (this.minA - Math.min(e.a, e.sa) - Math.max(0, this.minA - g.lenA)) / h
			const j = Math.max(0, this.stopA + over / g.invA) - this.stopA
			this.stopA += j
			this.apply(j, 0)
		}
		if (g.invB > 0) {
			const e = ends()
			const over = (this.minB - Math.min(e.b, e.sb) - Math.max(0, this.minB - g.lenB)) / h
			const j = Math.max(0, this.stopB + over / g.invB) - this.stopB
			this.stopB += j
			this.apply(0, j)
		}
		if (g.invB > 0 && r > 0) {
			const cap = (this.total - this.minA) / r
			const e = ends()
			const over = (e.b - cap - Math.max(0, g.lenB - cap)) / h
			const j = Math.max(0, this.capB + over / g.invB) - this.capB
			this.capB += j
			this.apply(0, -j)
		}
		if (g.invA > 0) {
			const cap = this.total - r * this.minB
			const e = ends()
			const over = (e.a - cap - Math.max(0, g.lenA - cap)) / h
			const j = Math.max(0, this.capA + over / g.invA) - this.capA
			this.capA += j
			this.apply(-j, 0)
		}
		const inv = g.invA + r * r * g.invB
		if (inv > 0) {
			const e = ends()
			const over = (e.a + r * e.b - this.total - Math.max(0, g.lenA + r * g.lenB - this.total)) / h
			const j = Math.max(0, this.rope + over / inv) - this.rope
			this.rope += j
			this.apply(-j, -r * j)
		}
	}
	solvePositionConstraints(_step: TimeStep) {
		const slop = Settings.linearSlop
		const most = Settings.maxLinearCorrection
		let worst = 0
		/** Moves the bodies (their working positions) along the runs by position impulses ja and jb (+: away from the ground points). */
		const shift = (ja: number, jb: number) => {
			const g = this.arms
			for (const [body, j, u, rr] of [
				[this.m_bodyA, ja, g.uA, g.rA],
				[this.m_bodyB, jb, g.uB, g.rB]
			] as const) {
				if (j === 0) continue
				const sb = solving(body)
				sb.c_position.c.x += sb.m_invMass * j * u.x
				sb.c_position.c.y += sb.m_invMass * j * u.y
				sb.c_position.a += sb.m_invI * j * (rr.x * u.y - rr.y * u.x)
			}
		}
		let g = this.measure()
		const r = this.ratio
		// (each: how far past its limit it is, corrected up to `most` at a time, as planck's rope does)
		const stopA = this.minA - g.lenA
		if (stopA > 0 && g.invA > 0) shift(Math.min(stopA, most) / g.invA, 0)
		g = this.measure()
		const stopB = this.minB - g.lenB
		if (stopB > 0 && g.invB > 0) shift(0, Math.min(stopB, most) / g.invB)
		g = this.measure()
		const capB = g.lenB - (this.total - this.minA) / r
		if (capB > 0 && g.invB > 0) shift(0, -Math.min(capB, most) / g.invB)
		g = this.measure()
		const capA = g.lenA - (this.total - r * this.minB)
		if (capA > 0 && g.invA > 0) shift(-Math.min(capA, most) / g.invA, 0)
		g = this.measure()
		const rope = g.lenA + r * g.lenB - this.total
		const inv = g.invA + r * r * g.invB
		if (rope > 0 && inv > 0) shift(-Math.min(rope, most) / inv, (-r * Math.min(rope, most)) / inv)
		g = this.measure()
		worst = Math.max(this.minA - g.lenA, this.minB - g.lenB, g.lenB - (this.total - this.minA) / r, g.lenA - (this.total - r * this.minB), g.lenA + r * g.lenB - this.total)
		return worst < slop
	}
	getAnchorA() {
		return this.m_bodyA.getWorldPoint(this.la)
	}
	getAnchorB() {
		return this.m_bodyB.getWorldPoint(this.lb)
	}
	getReactionForce(inv_dt: number) {
		return Vec2.mul(this.rope * inv_dt, this.arms.uB)
	}
	/** The force its last solve put on one of its bodies (planck units: N × LENGTH_SCALE), along its run: the rope's pull, its stop's and cap's. */
	forceOn(body: Body, inv_dt: number) {
		const g = this.arms
		if (body === this.m_bodyA) return Vec2.mul((this.stopA - this.capA - this.rope) * inv_dt, g.uA)
		if (body === this.m_bodyB) return Vec2.mul((this.stopB - this.capB - this.ratio * this.rope) * inv_dt, g.uB)
		return undefined
	}
	getReactionTorque(_inv_dt: number) {
		return 0
	}
}

/**
 * How far a point's path bends away from its velocity over a step, over h (planck units): where the step will really
 * leave the anchor of a turning body, against where its velocity points. A velocity constraint that leaves this out
 * (planck's revolute and rope joints) puts the anchor on the tangent each step and pulls it back onto the circle by
 * position correction, losing a little of the speed every step: a pendulum lost 9° of a 150° swing in its first half
 * swing, a gate 150° → 137.6° in 3 s, a wrecking ball a quarter degree a swing.
 */
const bendOf = (w: number, r: Vec2, h: number) => {
	const f = h * w
	const f2 = f * f
	// (the series under a radian a step, as `stepDrift`; the exact cos and sin past it, where the series would run away)
	const big = f2 > 1
	const cosm1 = big ? Math.cos(f) - 1 : f2 * (-1 / 2 + f2 * (1 / 24 + f2 * (-1 / 720 + f2 / 40320)))
	const sinm = big ? Math.sin(f) - f : f * f2 * (-1 / 6 + f2 * (1 / 120 + f2 * (-1 / 5040)))
	return { x: (cosm1 * r.x - sinm * r.y) / h, y: (cosm1 * r.y + sinm * r.x) / h }
}

/** planck's revolute joint's solver state (private in its typings). */
interface RevoluteState {
	m_bodyA: Body
	m_bodyB: Body
	m_invMassA: number
	m_invMassB: number
	m_invIA: number
	m_invIB: number
	m_rA: Vec2
	m_rB: Vec2
	m_mass: { ez: { x: number; y: number }; solve22: (v: Vec2) => Vec2; solve33: (v: Vec3) => Vec3 }
	m_motorMass: number
	m_motorImpulse: number
	m_motorSpeed: number
	m_maxMotorTorque: number
	m_enableMotor: boolean
	m_enableLimit: boolean
	m_limitState: number
	m_impulse: Vec3
}

/**
 * A hinge: planck's revolute joint (its motor, limits and position pass unchanged) whose point constraint asks that the
 * two anchors END the step together, their paths over the step turning included (`bendOf`), instead of that their
 * velocities agree at its start. That is the constrained step that keeps a swing's energy (SHAKE's): an undamped
 * pendulum keeps a 150° swing to a thousandth of a degree, where planck's loses 9° in half a swing.
 * It may also have friction (a pin joint's `friction` and `damping`): a Coulomb torque of at most `friction` N·m against
 * the two bodies' relative turning (it holds them still while what turns them is less), and a viscous one, −c·Δω,
 * implicit (a soft velocity constraint), so it never reverses the turning however light the parts. Each is solved with
 * the point constraint as one 3×3 block (planck's K, as its limit is), its impulse kept and carried from step to step:
 * so it meets the inertia the two bodies turn with while their anchors stay together (a bob far below its pin turns with
 * all of m·L², not its own small spin), and a pin in a chain of joints (a double pendulum's elbow) is held, or slowed,
 * as a lone one is. (Solved apart from the point constraint, the friction crept and fell where it should hold, and
 * damping on a chain blew up to NaN within 0.05 s.) While a limit is at its stop, the friction and damping are solved
 * ahead of it, each with the point impulse that keeps the anchors as they were.
 */
class Hinge extends RevoluteJoint {
	/** Its Coulomb friction torque and viscous damping, in planck's units (N·m and N·m·s, × LENGTH_SCALE²). */
	private readonly rub: number
	private readonly viscous: number
	/** This step's friction and damping angular impulses while a limit is at its stop (solved ahead of the limit). */
	private rubbed = 0
	private damped = 0
	/** Their angular impulses solved with the point constraint (no limit at its stop), carried over from step to step. */
	private rubImpulse = 0
	private dampImpulse = 0
	/** Whether this step solves its friction and damping with the point constraint (`rubImpulse`, `dampImpulse`). */
	private block = false
	/** The hinges it is solved together with, when it is one of a chain (`groupHinges`). */
	group: HingeGroup | undefined = undefined
	/** Its two bodies' turning as the step began: the bend of their anchors' paths over the step (`bendOf`), held through the solve. */
	private w0A = 0
	private w0B = 0
	/** Whether it has friction or damping. */
	get rubs() {
		return this.rub > 0 || this.viscous > 0
	}
	constructor(def: ConstructorParameters<typeof RevoluteJoint>[0] & { friction?: number; damping?: number }, a?: Body, b?: Body, anchor?: Vec2) {
		super(def, a as Body, b as Body, anchor as Vec2)
		this.rub = (def.friction ?? 0) * LENGTH_SCALE * LENGTH_SCALE
		this.viscous = (def.damping ?? 0) * LENGTH_SCALE * LENGTH_SCALE
	}
	/** Whether neither of its bodies touches anything this step: only then is its constraint met along its anchors' bent paths (`curvedJoints`). */
	free = true
	initVelocityConstraints(step: TimeStep) {
		super.initVelocityConstraints(step)
		this.w0A = this.free ? this.m_bodyA.getAngularVelocity() : 0
		this.w0B = this.free ? this.m_bodyB.getAngularVelocity() : 0
		this.rubbed = 0
		this.damped = 0
		if (this.group !== undefined) this.group.calls = 0
		const j = this as unknown as RevoluteState
		const iA = j.m_invIA
		const iB = j.m_invIB
		const stopped = j.m_enableLimit && j.m_limitState !== LIMIT_INACTIVE
		this.block = (this.rub > 0 || this.viscous > 0) && iA + iB > 0 && !stopped
		if (!this.block || !step.warmStarting) {
			this.rubImpulse = 0
			this.dampImpulse = 0
			return
		}
		// last step's friction and damping impulses as this one's first guess (as planck carries its own), ...
		this.rubImpulse *= step.dtRatio
		this.dampImpulse *= step.dtRatio
		const turn = this.rubImpulse + this.dampImpulse
		if (turn === 0) return
		// ... applied as planck applies its own: −on A, +on B
		const A = solving(j.m_bodyA)
		const B = solving(j.m_bodyB)
		A.c_velocity.w -= iA * turn
		B.c_velocity.w += iB * turn
	}
	solveVelocityConstraints(step: TimeStep) {
		const group = this.group
		if (group === undefined) {
			this.solveRows(step)
			return
		}
		// one of a chain: the first of its hinges planck comes to in each of its passes over the joints solves them all, HINGE_SWEEPS times over
		if (group.calls++ % group.members.length !== 0) return
		for (let k = 0; k < HINGE_SWEEPS; k++) for (const hinge of group.members) hinge.solveRows(step)
	}
	/** One pass over its constraints: its friction and damping, its motor, and its point constraint (with its limit). */
	solveRows(step: TimeStep) {
		const j = this as unknown as RevoluteState
		const A = solving(j.m_bodyA)
		const B = solving(j.m_bodyB)
		const vA = A.c_velocity.v
		let wA = A.c_velocity.w
		const vB = B.c_velocity.v
		let wB = B.c_velocity.w
		const mA = j.m_invMassA
		const mB = j.m_invMassB
		const iA = j.m_invIA
		const iB = j.m_invIB
		const fixedRotation = iA + iB === 0
		if (!this.block && !fixedRotation && (this.viscous > 0 || this.rub > 0)) {
			// (a limit at its stop) The friction's torque turns the two bodies about the hinge, so it meets the inertia they turn with
			// while their anchors stay together: S, the relative turning one unit of angular impulse gives once the point impulse q that
			// keeps the anchors together goes with it.
			const k = j.m_mass as unknown as { ex: { x: number; y: number }; ey: { x: number; y: number }; ez: { x: number; y: number; z: number } }
			const q = j.m_mass.solve22(new Vec2(k.ez.x, k.ez.y))
			const S = k.ez.z - (k.ez.x * q.x + k.ez.y * q.y)
			const turn = (impulse: number) => {
				// the angular impulse with the point impulse −q·impulse that keeps the anchors' relative velocity as it was
				const px = -q.x * impulse
				const py = -q.y * impulse
				vA.x -= mA * px
				vA.y -= mA * py
				wA -= iA * (j.m_rA.x * py - j.m_rA.y * px + impulse)
				vB.x += mB * px
				vB.y += mB * py
				wB += iB * (j.m_rB.x * py - j.m_rB.y * px + impulse)
			}
			if (S > 0 && this.viscous > 0) {
				// −c·Δω at the step's end: Δω + γ·(its impulse) = 0, γ = 1/(h·c)
				const gamma = 1 / (step.dt * this.viscous)
				const impulse = -(wB - wA + gamma * this.damped) / (S + gamma)
				this.damped += impulse
				turn(impulse)
			}
			if (S > 0 && this.rub > 0) {
				// as far toward no relative turning as `friction` × h of angular impulse goes
				const most = step.dt * this.rub
				const old = this.rubbed
				this.rubbed = Math.max(-most, Math.min(most, old - (wB - wA) / S))
				turn(this.rubbed - old)
			}
		}
		if (j.m_enableMotor && j.m_limitState !== LIMIT_EQUAL && !fixedRotation) {
			const Cdot = wB - wA - j.m_motorSpeed
			let impulse = -j.m_motorMass * Cdot
			const old = j.m_motorImpulse
			const most = step.dt * j.m_maxMotorTorque
			j.m_motorImpulse = Math.max(-most, Math.min(most, old + impulse))
			impulse = j.m_motorImpulse - old
			wA -= iA * impulse
			wB += iB * impulse
		}
		/** A point impulse (px, py) and an angular one, az, on the two bodies: −on A, +on B. */
		const apply = (px: number, py: number, az: number) => {
			vA.x -= mA * px
			vA.y -= mA * py
			wA -= iA * (j.m_rA.x * py - j.m_rA.y * px + az)
			vB.x += mB * px
			vB.y += mB * py
			wB += iB * (j.m_rB.x * py - j.m_rB.y * px + az)
		}
		/** The anchors' relative velocity, and how far their paths bend from it over the step (from the turning they had as it began). */
		const pointRate = () => {
			const bA = bendOf(this.w0A, j.m_rA, step.dt)
			const bB = bendOf(this.w0B, j.m_rB, step.dt)
			return { cx: vB.x - wB * j.m_rB.y - vA.x + wA * j.m_rA.y + bB.x - bA.x, cy: vB.y + wB * j.m_rB.x - vA.y - wA * j.m_rA.x + bB.y - bA.y }
		}
		if (this.block) {
			const k = j.m_mass as unknown as Mat33
			if (this.viscous > 0) {
				// the damping: Δω at the step's end + γ·(its impulse) = 0, γ = 1/(h·c), with the anchors kept together, one 3×3 solve
				const gamma = 1 / (step.dt * this.viscous)
				const { cx, cy } = pointRate()
				const imp = solveSoft33(k, gamma, -cx, -cy, -(wB - wA + gamma * this.dampImpulse))
				this.dampImpulse += imp.z
				j.m_impulse.x += imp.x
				j.m_impulse.y += imp.y
				apply(imp.x, imp.y, imp.z)
			}
			if (this.rub > 0) {
				// the friction: toward no relative turning with the anchors kept together, its whole impulse within `friction` × h; where
				// that cuts it, the point impulse is solved again for the angular one it has (as Box2D's limit does at its stop)
				const { cx, cy } = pointRate()
				const imp = j.m_mass.solve33(new Vec3(-cx, -cy, -(wB - wA)))
				const most = step.dt * this.rub
				const total = Math.max(-most, Math.min(most, this.rubImpulse + imp.z))
				const dz = total - this.rubImpulse
				this.rubImpulse = total
				let px = imp.x
				let py = imp.y
				if (dz !== imp.z) {
					const reduced = j.m_mass.solve22(new Vec2(-cx - k.ez.x * dz, -cy - k.ez.y * dz))
					px = reduced.x
					py = reduced.y
				}
				j.m_impulse.x += px
				j.m_impulse.y += py
				apply(px, py, dz)
			}
			A.c_velocity.w = wA
			B.c_velocity.w = wB
			return
		}
		const { cx, cy } = pointRate()
		if (j.m_enableLimit && j.m_limitState !== LIMIT_INACTIVE && !fixedRotation) {
			const Cdot2 = wB - wA
			const impulse = Vec3.neg(j.m_mass.solve33(new Vec3(cx, cy, Cdot2)))
			if (j.m_limitState === LIMIT_EQUAL) {
				j.m_impulse.add(impulse)
			} else if ((j.m_limitState === LIMIT_LOWER && j.m_impulse.z + impulse.z < 0) || (j.m_limitState === LIMIT_UPPER && j.m_impulse.z + impulse.z > 0)) {
				const reduced = j.m_mass.solve22(new Vec2(-cx + j.m_impulse.z * j.m_mass.ez.x, -cy + j.m_impulse.z * j.m_mass.ez.y))
				impulse.x = reduced.x
				impulse.y = reduced.y
				impulse.z = -j.m_impulse.z
				j.m_impulse.x += reduced.x
				j.m_impulse.y += reduced.y
				j.m_impulse.z = 0
			} else {
				j.m_impulse.add(impulse)
			}
			apply(impulse.x, impulse.y, impulse.z)
		} else {
			const impulse = j.m_mass.solve22(new Vec2(-cx, -cy))
			j.m_impulse.x += impulse.x
			j.m_impulse.y += impulse.y
			apply(impulse.x, impulse.y, 0)
		}
		A.c_velocity.w = wA
		B.c_velocity.w = wB
	}
}

/**
 * Hinges solved as one: a hinge with friction or damping and every hinge joined to it through moving bodies (a double pendulum's shoulder
 * and elbow, an arm's joints). planck solves its joints one after another, a few passes a step; through a chain, a friction torque at one
 * hinge reaches the other bodies only pass by pass, so a held elbow slipped 4.8° as its arm swung, and a chain held by friction gave 0.4°
 * before it held. Its hinges are solved HINGE_SWEEPS times over in each of planck's passes (contacts and other joints as before).
 */
interface HingeGroup {
	readonly members: readonly Hinge[]
	/** How many of its hinges planck has come to this step: each pass comes to all of them once. */
	calls: number
}
/** How many times over a chain of hinges is solved in each of planck's passes (`HingeGroup`): with planck's 8 passes, 192 in all. */
const HINGE_SWEEPS = 24

/** Finds the chains of hinges (`HingeGroup`) among a world's joints: hinges joined through moving bodies, one of them with friction or damping. */
const groupHinges = (world: World) => {
	const hinges: Hinge[] = []
	for (let j = world.getJointList(); j !== null; j = j.getNext()) if (j instanceof Hinge) hinges.push(j)
	// (in the order they were made, so every run solves them in the same order)
	hinges.reverse()
	const parent = hinges.map((_, i) => i)
	const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i] as number)))
	const byBody = new Map<Body, number>()
	hinges.forEach((hinge, i) => {
		for (const body of [hinge.getBodyA(), hinge.getBodyB()]) {
			if (!body.isDynamic()) continue
			const k = byBody.get(body)
			if (k === undefined) byBody.set(body, i)
			else parent[find(i)] = find(k)
		}
	})
	const chains = new Map<number, Hinge[]>()
	hinges.forEach((hinge, i) => chains.set(find(i), [...(chains.get(find(i)) ?? []), hinge]))
	for (const members of chains.values()) {
		if (members.length < 2 || !members.some((h) => h.rubs)) continue
		const group: HingeGroup = { members, calls: 0 }
		for (const h of members) h.group = group
	}
}

/** planck's 3×3 joint mass (its Mat33: columns ex, ey, ez), symmetric. */
interface Mat33 {
	readonly ex: { readonly x: number; readonly y: number; readonly z: number }
	readonly ey: { readonly x: number; readonly y: number; readonly z: number }
	readonly ez: { readonly x: number; readonly y: number; readonly z: number }
}
/** Solves (K + γ·e₃e₃ᵀ)·x = b (a soft angular row on planck's 3×3 K) by Cramer's rule, as planck's own solve33 does. */
const solveSoft33 = (k: Mat33, gamma: number, bx: number, by: number, bz: number) => {
	// K's columns, its last diagonal entry softened by γ
	const e1 = k.ex
	const e2 = k.ey
	const e3 = { x: k.ez.x, y: k.ez.y, z: k.ez.z + gamma }
	// e2 × e3, and the determinant e1 · (e2 × e3)
	const crossX = e2.y * e3.z - e2.z * e3.y
	const crossY = e2.z * e3.x - e2.x * e3.z
	const crossZ = e2.x * e3.y - e2.y * e3.x
	let det = e1.x * crossX + e1.y * crossY + e1.z * crossZ
	if (det !== 0) det = 1 / det
	return {
		// b · (e2 × e3), e1 · (b × e3), e1 · (e2 × b)
		x: det * (bx * crossX + by * crossY + bz * crossZ),
		y: det * (e1.x * (by * e3.z - bz * e3.y) + e1.y * (bz * e3.x - bx * e3.z) + e1.z * (bx * e3.y - by * e3.x)),
		z: det * (e1.x * (e2.y * bz - e2.z * by) + e1.y * (e2.z * bx - e2.x * bz) + e1.z * (e2.x * by - e2.y * bx))
	}
}
/** planck's limit states (its LimitState). */
const LIMIT_INACTIVE = 0
const LIMIT_LOWER = 1
const LIMIT_UPPER = 2
const LIMIT_EQUAL = 3

/** planck's rope joint's solver state (private in its typings). */
interface RopeState {
	m_bodyA: Body
	m_bodyB: Body
	m_invMassA: number
	m_invMassB: number
	m_invIA: number
	m_invIB: number
	m_rA: Vec2
	m_rB: Vec2
	m_u: Vec2
	m_length: number
	m_maxLength: number
	m_mass: number
	m_impulse: number
}

/**
 * A rope: planck's rope joint (slack until taut, never longer than its length), its velocity pass asking that the rope
 * be no longer than its length where the step will LEAVE its ends (their paths over the step, turning included), so a
 * bob swinging on a taut rope keeps its energy as a hinged one does (`Hinge`), and a slack rope still pulls only once
 * it would end the step past its length.
 */
class Cord extends RopeJoint {
	/** Its two bodies' turning as the step began (the bend of their anchors' paths, `stepDrift`). */
	private w0A = 0
	private w0B = 0
	/** Whether neither of its bodies touches anything this step (`curvedJoints`). */
	free = true
	initVelocityConstraints(step: TimeStep) {
		super.initVelocityConstraints(step)
		this.w0A = this.m_bodyA.getAngularVelocity()
		this.w0B = this.m_bodyB.getAngularVelocity()
	}
	solveVelocityConstraints(step: TimeStep) {
		// (one of its bodies touching something: planck's own rope, along its line as it is)
		if (!this.free) {
			super.solveVelocityConstraints(step)
			return
		}
		const j = this as unknown as RopeState
		if (j.m_mass === 0) return
		const A = solving(j.m_bodyA)
		const B = solving(j.m_bodyB)
		const h = step.dt
		const dA = stepDrift(A, j.m_rA, h, this.w0A)
		const dB = stepDrift(B, j.m_rB, h, this.w0B)
		const x = j.m_u.x * j.m_length + dB.x - dA.x
		const y = j.m_u.y * j.m_length + dB.y - dA.y
		const d = Math.sqrt(x * x + y * y)
		// how far past its length it would end, beyond how far past it is now (the position pass takes that), per step
		const over = (d - Math.max(j.m_length, j.m_maxLength)) / h
		// the impulse (along its line as the step began) that takes that out: per unit of it, the end length changes by k·h, k measured
		// along the line where the step leaves the rope (n), so a short rope whose end swings far within the step is not overshot
		const nx = d > 0 ? x / d : j.m_u.x
		const ny = d > 0 ? y / d : j.m_u.y
		const un = j.m_u.x * nx + j.m_u.y * ny
		const crA = j.m_rA.x * j.m_u.y - j.m_rA.y * j.m_u.x
		const crB = j.m_rB.x * j.m_u.y - j.m_rB.y * j.m_u.x
		const k = (j.m_invMassA + j.m_invMassB) * un + j.m_invIA * crA * (j.m_rA.x * ny - j.m_rA.y * nx) + j.m_invIB * crB * (j.m_rB.x * ny - j.m_rB.y * nx)
		if (!(k > 0)) return
		const old = j.m_impulse
		j.m_impulse = Math.min(0, old - over / k)
		const impulse = j.m_impulse - old
		const px = impulse * j.m_u.x
		const py = impulse * j.m_u.y
		A.c_velocity.v.x -= j.m_invMassA * px
		A.c_velocity.v.y -= j.m_invMassA * py
		A.c_velocity.w -= j.m_invIA * (j.m_rA.x * py - j.m_rA.y * px)
		B.c_velocity.v.x += j.m_invMassB * px
		B.c_velocity.v.y += j.m_invMassB * py
		B.c_velocity.w += j.m_invIB * (j.m_rB.x * py - j.m_rB.y * px)
	}
}

/**
 * A rope that collides (a rope joint drawn as a chain, `render.style: "chain"`, or one with `collide: true`): while it is taut,
 * a band `radius` wide each side of the straight line between its anchors, which moving solids (not its own two ends, not
 * fixed parts) land on, rest on and are pushed by. `carrier` is the end a touching body's constraint is joined to.
 */
interface ChainRope {
	readonly A: Body
	readonly B: Body
	readonly la: Vec2
	readonly lb: Vec2
	/** Its length and the band's half-width, planck units. */
	readonly length: number
	readonly radius: number
	readonly carrier: Body
	readonly touches: Map<Body, ChainTouch>
}
/** A friction of steel links on what lands on them (wood, brick, steel: 0.4 to 0.6), and no bounce: provisional. */
const CHAIN_FRICTION = 0.5

/** How far beyond a chain's band its touches are looked for, planck units: 5 cm, as far as `touchChains` reaches. */
const CHAIN_MARGIN = 0.05 * LENGTH_SCALE

/** Whether a chain is taut: no shorter than its length less what would sag it by its own half-width (a parabola's 8f²/3L), or 1 mm. */
const chainTaut = (chain: ChainRope, d: number) => chain.length - d <= Math.max((8 * chain.radius * chain.radius) / (3 * chain.length), 0.001 * LENGTH_SCALE)

/**
 * What a body touching a chain meets: for each point where it touches the chain's band (planck's own polygon test, the band a
 * thin box along the line), a contact that keeps it out of the band and rubs along it (Coulomb, `CHAIN_FRICTION`), solved
 * against the line's motion at that point, which moves as the line between its two ends does: a fraction t along it moves as
 * (1 − t) of end A's anchor and t of end B's, and takes the same shares of the push, as a light rigid line between them
 * would (a brick resting on a wrecking ball's chain bears on the ball and on the hook in the ratio of the distances). One
 * constraint over the three bodies, so a heavy brick on a light chain end is held in one solve, not through a light middle body.
 */
class ChainTouch extends PlanckJoint {
	private readonly x: Body
	private readonly chain: ChainRope
	private points: {
		readonly n: Vec2
		readonly tangent: Vec2
		readonly rX: Vec2
		readonly rA: Vec2
		readonly rB: Vec2
		readonly t: number
		readonly sep: number
		readonly localX: Vec2
		readonly mass: number
		readonly tmass: number
		normal: number
		rub: number
	}[] = []
	constructor(x: Body, chain: ChainRope) {
		super({ collideConnected: true }, x, chain.carrier)
		;(this as unknown as { m_type: string }).m_type = "chain-touch"
		this.x = x
		this.chain = chain
	}
	/** Each body's inverse mass along direction n at arm r. */
	private static along(body: Body, r: Vec2, n: Vec2) {
		const sb = solving(body)
		const cr = r.x * n.y - r.y * n.x
		return sb.m_invMass + sb.m_invI * cr * cr
	}
	initVelocityConstraints(_step: TimeStep) {
		this.points = []
		const c = this.chain
		const a = workingPoint(c.A, c.la)
		const b = workingPoint(c.B, c.lb)
		const dx = b.p.x - a.p.x
		const dy = b.p.y - a.p.y
		const d = Math.sqrt(dx * dx + dy * dy)
		if (d < 1e-6 || !chainTaut(c, d)) return
		// The band grown all round by a speculative margin (the reach `touchChains` looks within): a body that will reach the band within
		// the step is met where it is now, its approach cut to its real gap (sep, below), instead of being found only once it is inside
		// the band's 1 mm skin, or past its middle, and pushed out the far side (a 5 mm ball fell through a 4 mm rope from 0.5 m).
		const margin = CHAIN_MARGIN
		const band = new BoxShape(d / 2 + margin, c.radius + margin)
		const xf = new Transform(new Vec2((a.p.x + b.p.x) / 2, (a.p.y + b.p.y) / 2), Math.atan2(dy, dx))
		const xfX = this.x.getTransform()
		const centre = this.x.getWorldCenter()
		for (let f = this.x.getFixtureList(); f !== null; f = f.getNext()) {
			if (f.isSensor()) continue
			const shape = f.getShape()
			const manifold = new Manifold()
			if (shape.getType() === "circle") CollidePolygonCircle(manifold, band, xf, shape as CircleShape, xfX)
			else if (shape.getType() === "polygon") CollidePolygons(manifold, band, xf, shape as PolygonShape, xfX)
			if (manifold.pointCount === 0) continue
			const wm = manifold.getWorldManifold(null, xf, band.getRadius(), xfX, shape.getRadius())
			if (wm === undefined) continue
			const n = new Vec2(wm.normal.x, wm.normal.y)
			const tangent = new Vec2(-n.y, n.x)
			for (let i = 0; i < wm.pointCount; i++) {
				const mid = wm.points[i] as Vec2
				const grown = wm.separations[i] as number
				// the point on the body's own surface (the manifold's point is midway between the two surfaces), and its gap to the band
				// itself, less the slop Box2D's contacts rest within (so it rests on the band as a body rests on a floor)
				const px = new Vec2(mid.x + 0.5 * grown * n.x, mid.y + 0.5 * grown * n.y)
				const sep = grown + margin + Settings.linearSlop
				const t = Math.max(0, Math.min(1, ((px.x - a.p.x) * dx + (px.y - a.p.y) * dy) / (d * d)))
				const rX = new Vec2(px.x - centre.x, px.y - centre.y)
				const k = (dir: Vec2) => ChainTouch.along(this.x, rX, dir) + (1 - t) * (1 - t) * ChainTouch.along(c.A, a.r, dir) + t * t * ChainTouch.along(c.B, b.r, dir)
				const kn = k(n)
				const kt = k(tangent)
				this.points.push({ n, tangent, rX, rA: a.r, rB: b.r, t, sep, localX: this.x.getLocalPoint(px), mass: kn > 0 ? 1 / kn : 0, tmass: kt > 0 ? 1 / kt : 0, normal: 0, rub: 0 })
			}
		}
	}
	/** An impulse j along u on the touching body at its point, and its shares, −(1 − t)·j and −t·j, on the chain's two ends. */
	private push(p: (typeof this.points)[number], u: Vec2, j: number) {
		const X = solving(this.x)
		const A = solving(this.chain.A)
		const B = solving(this.chain.B)
		for (const [body, r, share] of [
			[X, p.rX, j],
			[A, p.rA, -(1 - p.t) * j],
			[B, p.rB, -p.t * j]
		] as const) {
			if (share === 0) continue
			body.c_velocity.v.x += body.m_invMass * share * u.x
			body.c_velocity.v.y += body.m_invMass * share * u.y
			body.c_velocity.w += body.m_invI * share * (r.x * u.y - r.y * u.x)
		}
	}
	/** The touching point's velocity relative to the chain's line at its point, along u. */
	private slip(p: (typeof this.points)[number], u: Vec2) {
		const at = (body: Body, r: Vec2) => {
			const v = solving(body).c_velocity
			return { x: v.v.x - v.w * r.y, y: v.v.y + v.w * r.x }
		}
		const x = at(this.x, p.rX)
		const a = at(this.chain.A, p.rA)
		const b = at(this.chain.B, p.rB)
		return (x.x - (1 - p.t) * a.x - p.t * b.x) * u.x + (x.y - (1 - p.t) * a.y - p.t * b.y) * u.y
	}
	solveVelocityConstraints(step: TimeStep) {
		for (const p of this.points) {
			if (p.mass === 0) continue
			// friction first, within what the last pass pressed with (as planck's contacts do)
			const most = CHAIN_FRICTION * p.normal
			const rub = Math.max(-most, Math.min(most, p.rub - this.slip(p, p.tangent) * p.tmass))
			this.push(p, p.tangent, rub - p.rub)
			p.rub = rub
			// no closing on the band: a gap may close only as far as it is (so it lands on it, dead), an overlap not at all
			const closing = this.slip(p, p.n) + Math.max(p.sep, 0) * step.inv_dt
			const normal = Math.max(0, p.normal - closing * p.mass)
			this.push(p, p.n, normal - p.normal)
			p.normal = normal
		}
	}
	solvePositionConstraints(_step: TimeStep) {
		let worst = 0
		const c = this.chain
		for (const p of this.points) {
			if (p.mass === 0) continue
			const x = workingPoint(this.x, p.localX)
			const a = workingPoint(c.A, c.la)
			const b = workingPoint(c.B, c.lb)
			const dx = b.p.x - a.p.x
			const dy = b.p.y - a.p.y
			const d = Math.sqrt(dx * dx + dy * dy)
			if (d < 1e-6) continue
			// the band's side the body is on now, and how far into it the body's surface point is
			let nx = -dy / d
			let ny = dx / d
			if (nx * p.n.x + ny * p.n.y < 0) {
				nx = -nx
				ny = -ny
			}
			const sep = (x.p.x - a.p.x - p.t * dx) * nx + (x.p.y - a.p.y - p.t * dy) * ny - c.radius - Settings.polygonRadius
			worst = Math.min(worst, sep)
			const C = Math.max(-Settings.maxLinearCorrection, Math.min(0, 0.2 * (sep + Settings.linearSlop)))
			if (C === 0) continue
			const n = new Vec2(nx, ny)
			const k =
				ChainTouch.along(this.x, x.r, n) + (1 - p.t) * (1 - p.t) * ChainTouch.along(c.A, a.r, n) + p.t * p.t * ChainTouch.along(c.B, b.r, n)
			if (k === 0) continue
			const j = -C / k
			for (const [body, r, share] of [
				[this.x, x.r, j],
				[c.A, a.r, -(1 - p.t) * j],
				[c.B, b.r, -p.t * j]
			] as const) {
				const sb = solving(body)
				sb.c_position.c.x += sb.m_invMass * share * n.x
				sb.c_position.c.y += sb.m_invMass * share * n.y
				sb.c_position.a += sb.m_invI * share * (r.x * n.y - r.y * n.x)
			}
		}
		return worst >= -3 * Settings.linearSlop
	}
	getAnchorA() {
		return this.x.getWorldCenter()
	}
	getAnchorB() {
		return this.chain.carrier.getWorldCenter()
	}
	getReactionForce(inv_dt: number) {
		let x = 0
		let y = 0
		for (const p of this.points) {
			x += (p.normal * p.n.x + p.rub * p.tangent.x) * inv_dt
			y += (p.normal * p.n.y + p.rub * p.tangent.y) * inv_dt
		}
		return new Vec2(x, y)
	}
	/** The force its last solve put on one of its three bodies (planck units): the touching body's push, and the chain's ends' shares of it. */
	forceOn(body: Body, inv_dt: number) {
		if (body !== this.x && body !== this.chain.A && body !== this.chain.B) return undefined
		let x = 0
		let y = 0
		for (const p of this.points) {
			const k = (body === this.x ? 1 : 0) - (body === this.chain.A ? 1 - p.t : 0) - (body === this.chain.B ? p.t : 0)
			x += k * (p.normal * p.n.x + p.rub * p.tangent.x) * inv_dt
			y += k * (p.normal * p.n.y + p.rub * p.tangent.y) * inv_dt
		}
		return new Vec2(x, y)
	}
	getReactionTorque(_inv_dt: number) {
		return 0
	}
}

/** planck's path of a body through the step: where it was as the step began (or as the time-of-impact pass last moved it) and where it ends. */
const sweepOf = (body: Body) => (body as unknown as { m_sweep: Sweep }).m_sweep

/** Whether the time-of-impact pass has put a body into the island it is building. */
const islanded = (body: Body) => (body as unknown as { m_islandFlag: boolean }).m_islandFlag

/** Whether a body hangs on a joint other than a spring: the time-of-impact pass would solve its impacts as if it were loose. */
const hinged = (body: Body) => {
	for (let edge = body.getJointList(); edge !== null; edge = edge.next)
		if (!(edge.joint instanceof SpringLink) && !(edge.joint instanceof ChainTouch) && !(edge.joint instanceof SpringMass) && (edge.joint as unknown as { notHinge?: boolean }).notHinge !== true) return true
	return false
}

/** The velocity of a part's own middle (planck units): its body's, for a lone part. */
const velocityOf = (m: Member) => (m.lone ? m.body.getLinearVelocity() : m.body.getLinearVelocityFromWorldPoint(m.body.getWorldPoint(m.center)))

/**
 * A ball's rotational inertia over m·r²: 2/5 solid; a shell of thickness `wall` has (2/5)(1−q⁵)/(1−q³),
 * q the inner over the outer radius, written as the equal (2/5)(1+q+q²+q³+q⁴)/(1+q+q²) so a thin wall
 * loses no digits: 2/3 as the wall thins, 2/5 as it fills the ball.
 */
const ballInertia = (radius: number, wall: number | undefined) => {
	if (wall === undefined) return 2 / 5
	const q = Math.max(0, radius - wall) / radius
	return (2 / 5) * ((1 + q + q ** 2 + q ** 3 + q ** 4) / (1 + q + q ** 2))
}

/** A round body that is a cylinder along the depth axis, with its length known. */
const cylinderLength = (part: SolidPart) => (part.body.kind === "ball" && part.shape === "cylinder" ? part.length : undefined)

/** The volume of solid the air flows around, m³: a cylinder's πr²·length, else what its mass is made of. */
const solidVolume = (part: SolidPart) => {
	const length = cylinderLength(part)
	return length !== undefined && part.body.kind === "ball" ? Math.PI * part.body.radius ** 2 * length : volume(part.body)
}

/**
 * The air a ball carries in its motion, kg: what a hollow one encloses (ρ·4/3·π·r³ inside its wall) and
 * the half-displaced-volume of air a sphere drags along when it accelerates (½·ρ·V). It is inertia
 * only: the enclosed air's weight cancels the buoyancy on the volume it fills, and added mass has no weight.
 */
const airCarried = (part: SolidPart) => {
	if (part.body.kind !== "ball" || part.shape === "cylinder") return 0
	const r = part.body.radius
	const inner = Math.max(0, r - (part.body.wall ?? r))
	return airDensity * (4 / 3) * Math.PI * (inner ** 3 + 0.5 * r ** 3)
}

/**
 * The air's drag on a slab's or a polygon's outline (meters, its own frame, counterclockwise), set at `local` in its body, as the
 * body moves and turns now through air moving at `air` (m/s): on each side facing into the air, each bit ds of it at velocity u
 * through the air meets −k·(u·n)·u·ds, n the side's outward normal and k = ½·ρ·C_d·depth (Newton's flat-plate drag, side by
 * side: for a body moving straight it is −k·(its width across the flow)·|u|·u). u varies linearly along a side as the body
 * turns, so the force and its torque about the body's centre of mass are integrated exactly over the stretch where u·n > 0.
 * Returns the force (N), the torque (N·m) and the share of the body's motion they take in a step, or nothing when the body is still in
 * still air.
 */
const outlineDrag = (body: Body, local: Pose, outline: readonly Vec[], k: number, air: { readonly x: number; readonly y: number }, h: number) => {
	const v = body.getLinearVelocity()
	const w = body.getAngularVelocity()
	const vx = v.x / LENGTH_SCALE - air.x
	const vy = v.y / LENGTH_SCALE - air.y
	if (vx === 0 && vy === 0 && w === 0) return undefined
	const centre = body.getWorldCenter()
	const cx = centre.x / LENGTH_SCALE
	const cy = centre.y / LENGTH_SCALE
	// the part's frame in the world: its origin and its angle (its body's, turned by its pose in the group)
	const origin = local === IDENTITY ? body.getPosition() : body.getWorldPoint(new Vec2(local.at.x * LENGTH_SCALE, local.at.y * LENGTH_SCALE))
	const ox = origin.x / LENGTH_SCALE
	const oy = origin.y / LENGTH_SCALE
	const angle = body.getAngle() + (local === IDENTITY ? 0 : local.angle)
	const c = Math.cos(angle)
	const s = Math.sin(angle)
	let fx = 0
	let fy = 0
	let torque = 0
	const n = outline.length
	for (let i = 0; i < n; i++) {
		const p = outline[i] as Vec
		const q = outline[(i + 1) % n] as Vec
		// the side from P to Q in the world: P's arm from the centre of mass, the side's vector e, its outward normal (e turned clockwise)
		const rx = ox + p.x * c - p.y * s - cx
		const ry = oy + p.x * s + p.y * c - cy
		const ex = (q.x - p.x) * c - (q.y - p.y) * s
		const ey = (q.x - p.x) * s + (q.y - p.y) * c
		const length = Math.sqrt(ex * ex + ey * ey)
		if (length === 0) continue
		const nx = ey / length
		const ny = -ex / length
		// u(t) = u0 + t·u1 along the side (t from 0 at P to 1 at Q): the body's velocity there, turning included, through the air
		const u0x = vx - w * ry
		const u0y = vy + w * rx
		const u1x = -w * ey
		const u1y = w * ex
		// u·n = a + b·t: the stretch [t0, t1] of the side facing into the air
		const a = u0x * nx + u0y * ny
		const b = u1x * nx + u1y * ny
		let t0 = 0
		let t1 = 1
		if (b === 0) {
			if (a <= 0) continue
		} else {
			const root = -a / b
			if (b > 0) t0 = Math.max(0, root)
			else t1 = Math.min(1, root)
			if (t1 <= t0) continue
		}
		// ∫ (a + b·t)·tʲ dt over [t0, t1], j = 0, 1, 2
		const d1 = t1 - t0
		const d2 = (t1 * t1 - t0 * t0) / 2
		const d3 = (t1 * t1 * t1 - t0 * t0 * t0) / 3
		const d4 = (t1 * t1 * t1 * t1 - t0 * t0 * t0 * t0) / 4
		const i0 = a * d1 + b * d2
		const i1 = a * d2 + b * d3
		const i2 = a * d3 + b * d4
		// dF = −k·(u·n)·u·length·dt; its torque about the centre of mass, (r + t·e) × dF
		const scale = -k * length
		fx += scale * (u0x * i0 + u1x * i1)
		fy += scale * (u0y * i0 + u1y * i1)
		torque += scale * ((rx * u0y - ry * u0x) * i0 + (rx * u1y - ry * u1x + ex * u0y - ey * u0x) * i1 + (ex * u1y - ey * u1x) * i2)
	}
	// Over a step, the drag is the one of the motion at the step's start (exact, its steady speeds too) while it takes a small share ρ of
	// that motion (velocity and spin, weighed by mass and inertia): ρ is thousandths for anything in a scene so far. Its share is
	// returned: past ½, for the drags on all of a body's parts together, they are scaled down (`airDrag`), as a 0.3 g foam plate spun
	// at a few hundred turns a second would otherwise be turned back faster than it goes.
	const moving = motionOf(body, air)
	const share = moving > 0 ? (-(fx * vx + fy * vy + torque * w) * h) / moving : 0
	return { fx, fy, torque, share }
}

/**
 * A body's motion through the air at `air` (m/s), as m·v² + I·ω² (twice its kinetic energy, its spin about its centre of mass included):
 * what a step's drag takes a share of.
 */
const motionOf = (body: Body, air: { readonly x: number; readonly y: number }) => {
	const v = body.getLinearVelocity()
	const w = body.getAngularVelocity()
	const vx = v.x / LENGTH_SCALE - air.x
	const vy = v.y / LENGTH_SCALE - air.y
	const m = body.getMass()
	const local0 = body.getLocalCenter()
	const I = (body.getInertia() - m * (local0.x * local0.x + local0.y * local0.y)) / (LENGTH_SCALE * LENGTH_SCALE)
	return m * (vx * vx + vy * vy) + I * w * w
}
