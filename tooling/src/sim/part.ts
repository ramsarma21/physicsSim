import type { Part } from "#part.ts"

/**
 * A simulated demonstration is specified like a mechanical CAD assembly, not drawn: every object
 * is a part whose specification (shape, real dimensions, material) is the truth. Physics reads only
 * the specification; the vector is its exact geometry; a sprite is fitted to the vector and
 * never decides where anything is. Lengths are meters and angles radians, in a world whose Y axis
 * points up and whose floor surface is y = 0.
 */
export interface Vec {
	readonly x: number
	readonly y: number
}

/** A material: what a prompt calls it and its density. How it meets another material is a `Contact`. */
export interface Material {
	/** How a prompt names it ("solid rubber"). */
	readonly words: string
	/** kg/m³ */
	readonly density: number
	/**
	 * Pa, for a material that dents and stays dented (clay): the stress at which it flows. A body of
	 * it keeps a flat spot where it first lands hard.
	 */
	readonly yieldStrength?: number
	/** Where its values come from; without one they are provisional. */
	readonly source?: string
}

/**
 * How two materials meet: Coulomb friction, restitution (rebound speed over approach speed) and the
 * rolling-resistance coefficient of a round body of one rolling on the other.
 */
export interface Contact {
	readonly between: readonly [Material, Material]
	readonly friction: number
	readonly restitution: number
	readonly rollingResistance: number
	/**
	 * Sideways restitution e_x of an impact: the contact point's sliding speed along the surface comes
	 * back reversed at this fraction (Garwin's rough ball). A superball's grip-and-spring-back gives
	 * 0.5 to 0.76; a rigid ball, which only grips to rolling, 0. Without it, 0.
	 */
	readonly tangentRestitution?: number
	/** The friction that limits that sideways spring-back during an impact; without it, `friction`. */
	readonly grip?: number
	/** Where its values come from; without one they are provisional. */
	readonly source?: string
}

/** What collides, in the part's own frame, centered on its origin. */
export type Body =
	/**
	 * A sphere seen from the side; with `wall`, a hollow shell of that thickness. `inertia` is its
	 * rotational inertia over m·r² when it isn't a sphere's: ½ for a cylinder or a disc (a log, a wheel
	 * seen end-on), 1 for a thin hoop.
	 */
	| { readonly kind: "ball"; readonly radius: number; readonly wall?: number; readonly inertia?: number }
	/**
	 * A box seen from the side; `depth` is its extent toward the viewer, which only its mass uses.
	 * With `taper`, its bottom is that fraction of its width (a pinecone hanging point down), so it
	 * stands on a narrow end as the object does.
	 */
	| {
			readonly kind: "slab"
			readonly width: number
			readonly height: number
			readonly depth: number
			readonly taper?: number
	  }
	/**
	 * A convex prism seen from the side (a cone's slope, a wedge, a car's hood, an egg): its outline,
	 * 3 to 8 points running counterclockwise in its own frame around its origin, and `depth`, its
	 * extent toward the viewer, which only its mass and its drag use. Its mass is spread evenly over
	 * the outline, so its centre of mass is the outline's centroid, wherever its origin is.
	 */
	| { readonly kind: "polygon"; readonly points: readonly Vec[]; readonly depth: number }

/** The most points a polygon body may have: Box2D's own limit. */
export const POLYGON_MAX_POINTS = 8

/** A polygon body's shortest side, m: planck welds points closer than a quarter of a millimeter into one. */
export const POLYGON_MIN_SIDE = 0.0005

/** Terms summed in pairs, so equal ones double exactly: a rectangle's area comes out exactly width × height. */
const pairwise = (terms: readonly number[]): number => {
	if (terms.length <= 2) return (terms[0] ?? 0) + (terms[1] ?? 0)
	const half = Math.ceil(terms.length / 2)
	return pairwise(terms.slice(0, half)) + pairwise(terms.slice(half))
}

/**
 * The area a polygon's outline encloses (the shoelace formula), positive when its points run
 * counterclockwise. A polygon square's is the very same number as the slab it matches.
 */
export const polygonArea = (points: readonly Vec[]): number =>
	pairwise(
		points.map((p, k) => {
			const q = points[(k + 1) % points.length] ?? p
			return p.x * q.y - q.x * p.y
		})
	) / 2

/** The centroid of a polygon's area, in its own frame: where a solid of it has its centre of mass. */
export const polygonCentroid = (points: readonly Vec[]): Vec => {
	let x = 0
	let y = 0
	for (let k = 0; k < points.length; k++) {
		const p = points[k] ?? { x: 0, y: 0 }
		const q = points[(k + 1) % points.length] ?? p
		const cross = p.x * q.y - q.x * p.y
		x += (p.x + q.x) * cross
		y += (p.y + q.y) * cross
	}
	const a = polygonArea(points)
	return { x: x / (6 * a), y: y / (6 * a) }
}

/**
 * Why these points cannot be a polygon body's outline, or undefined when they can: it takes 3 to 8
 * points, each side at least half a millimeter, running counterclockwise once around, every corner
 * turning left (convex; a concave object is several convex solids welded together).
 */
export const polygonProblem = (points: readonly Vec[]): string | undefined => {
	const n = points.length
	if (n < 3 || n > POLYGON_MAX_POINTS) return `has ${n} points; a polygon body takes 3 to ${POLYGON_MAX_POINTS}`
	const at = (k: number) => points[((k % n) + n) % n] ?? { x: 0, y: 0 }
	const where = (k: number) => `point ${k} (${at(k).x}, ${at(k).y})`
	for (let k = 0; k < n; k++) {
		if (!Number.isFinite(at(k).x) || !Number.isFinite(at(k).y)) return `has a point that is not a number (${k})`
		const side = Math.hypot(at(k + 1).x - at(k).x, at(k + 1).y - at(k).y)
		if (side < POLYGON_MIN_SIDE) {
			return `has a side ${(side * 1000).toFixed(2)} mm long, from ${where(k)} to ${where((k + 1) % n)}; the shortest a polygon body's side may be is ${POLYGON_MIN_SIDE * 1000} mm`
		}
	}
	if (polygonArea(points) <= 0) return "runs clockwise (or crosses itself): list its points counterclockwise, in the solid's frame (x right, y up)"
	let turning = 0
	for (let k = 0; k < n; k++) {
		const ax = at(k).x - at(k - 1).x
		const ay = at(k).y - at(k - 1).y
		const bx = at(k + 1).x - at(k).x
		const by = at(k + 1).y - at(k).y
		const cross = ax * by - ay * bx
		const sine = cross / (Math.hypot(ax, ay) * Math.hypot(bx, by))
		if (sine < -1e-9) return `is not convex: it turns clockwise at ${where(k)}; make every corner turn left, or build the shape from several convex solids welded together`
		if (sine <= 1e-9) return `has ${where(k)} on the straight line between its neighbors; leave it out`
		turning += Math.atan2(cross, ax * bx + ay * by)
	}
	if (Math.abs(turning - 2 * Math.PI) > 1e-6) return `winds ${Math.round(turning / (2 * Math.PI))} times around; a convex outline goes around once`
	return undefined
}

/** How a placeholder is colored before its sprite replaces it. */
export interface Placeholder {
	readonly fill: string
}

/**
 * How a solid part is drawn in the finished frame, after the Prism mechanics lab's render modes:
 * a `rigid` sprite scaled uniformly onto its vector; a `tiled` sprite, one repeat unit scaled to the
 * slab's height and repeated along its width, for parts whose length is authored; or `procedural`,
 * its vector drawn in the style's flat fill with one darker tone, for plain prisms a generated
 * picture cannot improve.
 */
export type RenderMode =
	| { readonly kind: "rigid" }
	| { readonly kind: "tiled" }
	| { readonly kind: "procedural"; readonly shade: string }

/**
 * The environment a screen's simulation is drawn in, when the environment matters to it (a kitchen
 * counter, a playground): one picture in the style behind every part, laid out from the fixed parts
 * whose render mode is `setting`, so its surfaces meet the physics. A screen without one keeps a
 * plain background.
 */
export interface Setting {
	readonly words: string
}

/** The name a scene's setting picture is made and recorded under. */
export const SETTING = "setting"

/**
 * A clip layer: a transparent clip from the shared clip pipeline (a living thing's own motion, which
 * a video model draws) placed in the scene as a flat layer among the parts. Its frames are files in
 * the folder `frames` names, frame `k` starting `times[k]` seconds into the clip; it plays from the
 * scene's moment `start`, `speed` times as fast as it was made (a video model stretches a quick
 * action over its clip's length), holding its first frame before and its last after. `at` is its
 * lower-left corner and `width` its width, in meters (its height keeps the frames' shape), in its
 * parent's frame when it has one. It touches the physics only through its hitbox, never other layers.
 */
export interface Layer {
	readonly id: string
	readonly words: string
	readonly frames: string
	readonly times: readonly number[]
	readonly pixels: { readonly width: number; readonly height: number }
	readonly at: Vec
	readonly width: number
	readonly depth: number
	readonly start: number
	readonly speed?: number
	readonly parent?: string
	readonly hitbox?: Hitbox
}

/**
 * Where a clip layer's subject pushes the physics (a hand's palm, a dog's nose): its leading edge,
 * tracked from the clip's own transparency frame by frame, drives a body that moves exactly as the
 * clip does and is moved by nothing it touches. What it pushes moves by the engine.
 */
export interface Hitbox {
	/** The side of the subject that pushes. */
	readonly edge: "left" | "right"
	/** The band of heights it pushes with, in meters above the layer's lower edge. */
	readonly from: number
	readonly to: number
	readonly material: Material
	/**
	 * The leading edge's distance from the layer's left side, in meters, per frame (`sim.ts hitbox`);
	 * null where the subject is not in the band, the hitbox then off.
	 */
	readonly track: readonly (number | null)[]
}

/** How thick a hitbox is behind its leading edge, in meters: enough that a push never passes through. */
export const HITBOX_DEPTH = 0.02

/** A layer's leading edge at the scene's moment `t`, between its frames' measures; undefined while off. */
export const hitboxEdgeAt = (layer: Layer, hitbox: Hitbox, t: number) => {
	const local = (t - layer.start) * (layer.speed ?? 1)
	const k = layerFrameAt(layer, t)
	const at = hitbox.track[k]
	if (at === null || at === undefined) return undefined
	const next = hitbox.track[k + 1]
	const t0 = layer.times[k] ?? 0
	const t1 = layer.times[k + 1]
	if (next === null || next === undefined || t1 === undefined || local <= t0) return at
	return at + (next - at) * Math.min(1, (local - t0) / (t1 - t0))
}

/** The file of a layer's frame `k`, relative to the document's folder. */
export const layerFrame = (layer: Pick<Layer, "frames">, k: number) => `${layer.frames}/f${String(k).padStart(4, "0")}.png`

/** Which of a layer's frames shows at the scene's moment `t`. */
export const layerFrameAt = (layer: Layer, t: number) => {
	const local = (t - layer.start) * (layer.speed ?? 1)
	let k = 0
	while (k + 1 < layer.times.length && (layer.times[k + 1] ?? Number.POSITIVE_INFINITY) <= local + 1e-9) k++
	return k
}

/**
 * A part the physics engine moves, or one it holds fixed (a floor). Its vector is derived from its
 * body, so the geometry drawn and the geometry simulated cannot disagree.
 */
export interface SolidPart {
	readonly kind: "dynamic" | "static"
	readonly id: string
	/** How a prompt names the object ("a red rubber ball"). */
	readonly words: string
	/** The name its sprite is made under, shared by identical rigid parts (a cart's two wheels). */
	readonly sprite: string
	readonly body: Body
	readonly material: Material
	readonly at: Vec
	/** The angle it starts at, radians counterclockwise (a tilted plank, a ramp); level without one. */
	readonly angle?: number
	/**
	 * A point in its own frame where it is pinned to the world and turns freely, as a seesaw's
	 * plank turns on its fulcrum; without one it is free (or fixed, when static).
	 */
	readonly pivot?: Vec
	/**
	 * A damper on its pivot, newton-meter-seconds: a torque against its turning on the pivot in
	 * proportion to that speed, as a balance's air damper slows its beam, so it settles exactly where
	 * the weights leave it; an undamped hinge without one.
	 */
	readonly damping?: number
	readonly placeholder: Placeholder
	readonly render: RenderMode
	/** Draw order: higher draws over lower; a child's orders it within its assembly (see `stacking`). */
	readonly depth: number
	/**
	 * The solid part it belongs to, when it is one piece of an assembly: its `at` and `angle` are then
	 * measured in the parent's frame, and it is hinged to the parent at its pivot, or fixed to it
	 * without one.
	 */
	readonly parent?: string
	/**
	 * m/s: it is a conveyor belt; what touches its top is carried along its own +x at this speed
	 * relative to it, as far as friction allows.
	 */
	readonly surfaceSpeed?: number
	/** A drive on its pivot (only with `pivot`): it turns it relative to what it hangs from. */
	readonly motor?: Motor
	/**
	 * 1/s: its turning slows as dω/dt = −c·ω whatever it rests on or hangs from (a raw egg's liquid insides, which slow its
	 * rocking), applied to its whole weld group (the largest of its parts'); none without one.
	 */
	readonly angularDamping?: number
	/**
	 * "cylinder": a round body that is really a cylinder along the depth axis (a log, a wheel or a can
	 * seen end-on), so air meets a cylinder's broadside area and its volume is πr²·`length`, not a sphere's.
	 */
	readonly shape?: string
	/** A cylinder's extent along the depth axis, m. */
	readonly length?: number
}

/** A drive on a hinge: the speed it turns at (rad/s, counterclockwise) and the most torque it gives (N·m). */
export interface Motor {
	readonly speed: number
	readonly torque: number
}

/**
 * A joint between two solids, each named by its id or null for the world. An anchor on a solid is
 * in that solid's own frame; on the world side it is a world point. Meters, newtons, seconds.
 */
export type Joint =
	/** A spring along the line between its anchors: F = −k(d − rest) − c·ḋ; `compressOnly` only pushes. */
	| {
			readonly kind: "spring"
			readonly id: string
			readonly item?: string
			readonly a: string | null
			readonly b: string | null
			readonly anchorA: Vec
			readonly anchorB: Vec
			readonly rest: number
			readonly stiffness: number
			readonly damping: number
			readonly compressOnly?: boolean
			readonly coils?: number
			readonly coilRadius?: number
			/** The spring's own mass, kg, zero or more: from a fixed end, its fundamental mode's share (Rayleigh's third, light) moves with the body it pushes, which holds half its weight; between two moving ones, a uniform bar's consistent mass (physics.ts). */
			readonly mass?: number
	  }
	/**
	 * A rope: slack until taut, never longer than `length`. One drawn as a chain (`render.style: "chain"`) or flagged `collide`
	 * collides while taut: moving solids (not its own ends) land on and rest on the band along its line, a chain's as wide as
	 * its drawn face-on links (1.775 × its wire, 1.5 × `thickness`), a rope's `thickness`.
	 */
	| {
			readonly kind: "rope"
			readonly id: string
			readonly item?: string
			readonly a: string | null
			readonly b: string | null
			readonly anchorA: Vec
			readonly anchorB: Vec
			readonly length: number
			readonly thickness?: number
			readonly collide?: boolean
			readonly render?: { readonly [key: string]: unknown }
	  }
	/**
	 * A hinge at the anchors, optionally driven and limited (radians, relative to how they start), with friction: a Coulomb
	 * torque of at most `friction` N·m against the two parts' relative turning (holding them while less turns them), and a
	 * viscous one of `damping` N·m·s per rad/s; frictionless without them.
	 */
	| {
			readonly kind: "pin"
			readonly id: string
			readonly item?: string
			readonly a: string | null
			readonly b: string | null
			readonly anchorA: Vec
			readonly anchorB: Vec
			readonly motor?: Motor
			readonly limits?: { readonly lower: number; readonly upper: number }
			readonly friction?: number
			readonly damping?: number
	  }
	/**
	 * A wheel on an axle sprung along `axis` (chassis frame) about `anchor` (its centre, chassis frame).
	 * `frequency` (Hz) and `damping` (ratio) are those of the load it carries bouncing on it; 0 Hz is a
	 * rigid axle.
	 */
	| {
			readonly kind: "wheel"
			readonly id: string
			readonly item?: string
			readonly chassis: string | null
			readonly wheel: string | null
			readonly anchor: Vec
			readonly axis: Vec
			readonly frequency: number
			readonly damping: number
			readonly motor?: Motor
	  }
	/**
	 * A rope over two fixed wheels at world points `groundA`/`groundB`: lengthA + ratio·lengthB never more than it starts
	 * at (the rope pulls, never pushes). Run A is never shorter than `minLengthA` (its end jams at its wheel), run B never
	 * shorter than `minLengthB`; without them, where the body hauled straight up its run first meets its wheel (`wheelRadius`
	 * round, at its ground point's height, its rim on the run), or, with no wheel radius, where its top reaches that height.
	 */
	| {
			readonly kind: "pulley"
			readonly id: string
			readonly item?: string
			readonly a: string | null
			readonly b: string | null
			readonly groundA: Vec
			readonly groundB: Vec
			readonly anchorA: Vec
			readonly anchorB: Vec
			readonly ratio: number
			readonly wheelRadius?: number
			readonly minLengthA?: number
			readonly minLengthB?: number
	  }

/**
 * A living part (a hand, an animal), moved by the scene rather than by physics. Its specification
 * says only where it goes: `at` is its grip, the point it holds things by, and `reach` the direction
 * from the grip toward where it enters the frame. How it poses is left to its sprites, one whole
 * drawing per pose, each registered by a feature it contains rather than fitted to an outline.
 */
export interface OrganicPart<L extends string> {
	readonly kind: "organic"
	readonly id: string
	readonly words: string
	readonly at: Vec
	readonly reach: Vec
	readonly poses: readonly L[]
	readonly depth: number
	/** The part it moves with: its `at` is then measured in that part's frame. */
	readonly parent?: string
}

/**
 * A mechanism part moved by the scene rather than by physics (a claw's jaw, a lever being pulled):
 * rigid, drawn by a sprite redrawn literally from its vector, colliding with nothing. Its vector is
 * authored in its own frame, whose origin is its pivot; `keys` turn it about the pivot over time,
 * holding the first angle before the first key and the last after the last.
 */
export interface AnimatedPart {
	readonly kind: "animated"
	readonly id: string
	readonly words: string
	/** The name its sprite is made under, shared by identical parts (three claws, one jaw sprite). */
	readonly sprite: string
	readonly vector: readonly Part[]
	readonly at: Vec
	readonly keys: readonly { readonly t: number; readonly angle: number }[]
	readonly cycle?: Cycle
	readonly airflow?: Airflow
	/**
	 * The edge of its vector the sprite's fit keeps when the sprite's proportions miss: the base a
	 * part stands on, or the top it hangs from. Without one the miss is split around the center.
	 */
	readonly anchor?: "bottom" | "top"
	/**
	 * Its drawing stretched to fill its vector exactly, for a thin piece whose ends must meet what
	 * it spans (a balance pan's hanger, from the beam's end to the pan's rim).
	 */
	readonly fill?: boolean
	readonly depth: number
	/** The part it moves with (a claw's jaw on its mount): its `at` and keys are then in that part's frame. */
	readonly parent?: string
}

/**
 * A looping sprite animation played while its part's airflow blows, as a running fan's blades and
 * ribbons: `frames` drawings, each an edit of the part's sprite that makes `change`,
 * shown `perSecond` of them a second; before the airflow starts, one drawing that makes `off` (the
 * ribbons hanging still). `changes` is the region of the part's frame (meters, lower-left corner)
 * the edits may alter; everything outside it is what each drawing is aligned on, so it holds still.
 */
export interface Cycle {
	readonly off: string
	readonly frames: number
	readonly perSecond: number
	readonly change: string
	readonly changes: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
}

/** The name a cycle's drawing `k` is made and recorded under. */
export const cycleFrame = (sprite: string, k: number) => `${sprite}-frame${k}`

/** The name a cycle's drawing before its airflow starts is made and recorded under. */
export const cycleOff = (sprite: string) => `${sprite}-off`

/** Every drawing a cycle needs, as a function from the part's or sprite's name to its own. */
export const cycleNames = (cycle: Cycle): readonly ((name: string) => string)[] => [
	cycleOff,
	...Array.from({ length: cycle.frames }, (_, k) => (name: string) => cycleFrame(name, k))
]

/** Which of a cycling part's drawings shows at time `t`: its off drawing until its airflow starts. */
export const cycleDrawing = (sprite: string, cycle: Cycle, part: AnimatedPart, t: number) => {
	const from = part.airflow?.from ?? 0
	return t < from ? cycleOff(sprite) : cycleFrame(sprite, Math.floor((t - from) * cycle.perSecond + 1e-9) % cycle.frames)
}

/** A stream of air in the world: where its outlet is and which way it blows. */
export interface Stream {
	readonly at: Vec
	readonly direction: number
	readonly diameter: number
	readonly speed: number
}

/** Where a part is and how it is turned, in world meters and radians. */
export interface Pose {
	readonly at: Vec
	readonly angle: number
}

/** A pose carried into the frame of the pose it is measured in. */
export const compose = (parent: Pose, local: Pose): Pose => {
	const c = Math.cos(parent.angle)
	const s = Math.sin(parent.angle)
	return {
		at: { x: parent.at.x + local.at.x * c - local.at.y * s, y: parent.at.y + local.at.x * s + local.at.y * c },
		angle: parent.angle + local.angle
	}
}

/** Any part of a scene, by its id. */
export const partOf = <L extends string>(scene: SimScene<L>, id: string) =>
	scene.solids.find((p) => p.id === id) ?? scene.animated.find((p) => p.id === id) ?? scene.organic.find((p) => p.id === id)

/**
 * A part's pose in the world at time `t`: its own composed with its parents'. A moving solid's pose
 * is the engine's, from `placements`, when they are given; without them it is where it starts.
 */
export const worldPose = <L extends string>(
	scene: SimScene<L>,
	id: string,
	t: number,
	placements?: Readonly<Record<string, { readonly x: number; readonly y: number; readonly angle: number }>>
): Pose => {
	const part = partOf(scene, id)
	if (part === undefined) throw new Error(`${scene.id}: no part named "${id}"`)
	const placed = part.kind === "dynamic" ? placements?.[id] : undefined
	if (placed !== undefined) return { at: { x: placed.x, y: placed.y }, angle: placed.angle }
	const local: Pose = {
		at: part.at,
		angle: part.kind === "animated" ? angleAt(part, t) : part.kind === "organic" ? 0 : (part.angle ?? 0)
	}
	return part.parent === undefined ? local : compose(worldPose(scene, part.parent, t, placements), local)
}

/** An edge of a slab in its own frame. */
export type Edge = "top" | "bottom" | "left" | "right"

/** How near another part must come to touch, in meters. */
const TOUCH = 0.002

/** The corners of a polygon, or of a slab's box, counterclockwise in its own frame. */
const cornersOf = (body: Exclude<Body, { kind: "ball" }>): readonly Vec[] => {
	if (body.kind === "polygon") return body.points
	const w = body.width / 2
	const h = body.height / 2
	return [{ x: -w, y: -h }, { x: w, y: -h }, { x: w, y: h }, { x: -w, y: h }]
}

/**
 * How far a point in a convex outline's frame lies inside it, from its nearest side (negative
 * outside: then the most it lies beyond any one side's line).
 */
const depthIn = (corners: readonly Vec[], p: Vec) => {
	let depth = Number.POSITIVE_INFINITY
	for (let k = 0; k < corners.length; k++) {
		const a = corners[k] ?? p
		const b = corners[(k + 1) % corners.length] ?? a
		const len = Math.hypot(b.x - a.x, b.y - a.y)
		if (len > 0) depth = Math.min(depth, ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / len)
	}
	return depth
}

/** How far a point lies from a convex outline's nearest side, m; 0 on or inside it. */
const beyond = (corners: readonly Vec[], p: Vec) => {
	if (depthIn(corners, p) >= 0) return 0
	let nearest = Number.POSITIVE_INFINITY
	for (let k = 0; k < corners.length; k++) {
		const a = corners[k] ?? p
		const b = corners[(k + 1) % corners.length] ?? a
		const ex = b.x - a.x
		const ey = b.y - a.y
		const u = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / (ex * ex + ey * ey || 1)))
		nearest = Math.min(nearest, Math.hypot(p.x - a.x - u * ex, p.y - a.y - u * ey))
	}
	return nearest
}

/** Points around a body's outline in its own frame, every two millimeters or so. */
const outline = (body: Body): readonly Vec[] => {
	if (body.kind === "ball") {
		const n = Math.max(32, Math.ceil((2 * Math.PI * body.radius) / 0.002))
		return Array.from({ length: n }, (_, k) => ({
			x: body.radius * Math.cos((2 * Math.PI * k) / n),
			y: body.radius * Math.sin((2 * Math.PI * k) / n)
		}))
	}
	const corners = cornersOf(body)
	return corners.flatMap((a, k) => {
		const b = corners[(k + 1) % corners.length] ?? a
		const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.002))
		return Array.from({ length: n }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }))
	})
}

/** How far a point in a body's own frame lies outside it; 0 on or inside it. */
const outside = (body: Body, p: Vec) =>
	body.kind === "ball"
		? Math.max(0, Math.hypot(p.x, p.y) - body.radius)
		: body.kind === "polygon"
			? beyond(body.points, p)
			: Math.hypot(Math.max(0, Math.abs(p.x) - body.width / 2), Math.max(0, Math.abs(p.y) - body.height / 2))

/** A world point in the frame of a pose. */
const within = (pose: Pose, p: Vec): Vec => {
	const c = Math.cos(pose.angle)
	const s = Math.sin(pose.angle)
	const dx = p.x - pose.at.x
	const dy = p.y - pose.at.y
	return { x: dx * c + dy * s, y: -dx * s + dy * c }
}

/** A solid's outline in the world where it starts. */
const outlineAtStart = <L extends string>(scene: SimScene<L>, part: SolidPart) => {
	const pose = worldPose(scene, part.id, 0)
	return outline(part.body).map((p) => compose(pose, { at: p, angle: 0 }).at)
}

/** Whether two solids touch where they start. */
export const touches = <L extends string>(scene: SimScene<L>, a: SolidPart, b: SolidPart) => {
	const near = (from: SolidPart, to: SolidPart) => {
		const pose = worldPose(scene, to.id, 0)
		return outlineAtStart(scene, from).some((p) => outside(to.body, within(pose, p)) <= TOUCH)
	}
	return near(a, b) || near(b, a)
}

/**
 * Which solids touch each edge of a slab solid where they start (a crate's bottom the floor, its top
 * a ramp), each edge tested along its length away from its corners, so a block resting on a deck
 * touches the deck's top and not its sides. A child hinged at a pivot hangs on its axle, not on an
 * edge, so it is not counted.
 */
export const touchingEdges = <L extends string>(scene: SimScene<L>, id: string): ReadonlyMap<Edge, ReadonlySet<string>> => {
	const part = scene.solids.find((s) => s.id === id)
	const touched = new Map<Edge, Set<string>>()
	if (part === undefined || part.body.kind !== "slab") return touched
	const own = worldPose(scene, id, 0)
	const hw = part.body.width / 2
	const hh = part.body.height / 2
	const mark = (edge: Edge, by: string) => touched.set(edge, new Set([...(touched.get(edge) ?? []), by]))
	const near = (p: Vec, by: string) => {
		if (Math.abs(p.x) < hw - TOUCH && Math.abs(p.y - hh) <= TOUCH) mark("top", by)
		if (Math.abs(p.x) < hw - TOUCH && Math.abs(p.y + hh) <= TOUCH) mark("bottom", by)
		if (Math.abs(p.y) < hh - TOUCH && Math.abs(p.x - hw) <= TOUCH) mark("right", by)
		if (Math.abs(p.y) < hh - TOUCH && Math.abs(p.x + hw) <= TOUCH) mark("left", by)
	}
	for (const other of scene.solids) {
		if (other.id === id || (other.parent === id && other.pivot !== undefined)) continue
		for (const p of outlineAtStart(scene, other)) near(within(own, p), other.id)
		// Its own edges inside the other's body, for a long side another's corner presses into.
		const pose = worldPose(scene, other.id, 0)
		for (const p of outlineAtStart(scene, part)) {
			const q = within(pose, p)
			const inside =
				other.body.kind === "ball"
					? Math.hypot(q.x, q.y) < other.body.radius - TOUCH
					: other.body.kind === "polygon"
						? depthIn(other.body.points, q) > TOUCH
						: Math.abs(q.x) < other.body.width / 2 - TOUCH && Math.abs(q.y) < other.body.height / 2 - TOUCH
			if (inside) near(within(own, p), other.id)
		}
	}
	return touched
}

/** How far an assembly's members spread from their root's place toward the next place in the stacking. */
export const STACK_SPREAD = 0.6

/**
 * Where each part and layer stands in the composition, back to front. Each top-level part or layer
 * takes the next whole number in order of depth; an assembly (a part with everything parented to
 * it) is one of them, its members ordered among themselves by their depths in their parents'
 * frames (the parent itself at 0) and spread over the first `STACK_SPREAD` of the way to the next
 * place, so no member passes a neighbor outside its assembly. Equal depths keep the document's order.
 */
export const stacking = <L extends string>(scene: SimScene<L>): ReadonlyMap<string, number> => {
	const items: readonly { readonly id: string; readonly depth: number; readonly parent?: string }[] = [
		...scene.solids,
		...scene.animated,
		...scene.layers,
		...scene.organic
	]
	const byId = new Map(items.map((item) => [item.id, item]))
	const path = (id: string): readonly number[] => {
		const item = byId.get(id)
		if (item === undefined) return []
		return item.parent === undefined ? [item.depth] : [...path(item.parent), item.depth]
	}
	const root = (id: string): string => {
		const parent = byId.get(id)?.parent
		return parent === undefined ? id : root(parent)
	}
	const compare = (a: readonly number[], b: readonly number[]) => {
		for (let i = 0; i < Math.max(a.length, b.length); i++) {
			const d = (a[i] ?? 0) - (b[i] ?? 0)
			if (d !== 0) return d
		}
		return 0
	}
	const order = items.map((item, index) => ({ id: item.id, path: path(item.id), index }))
	const ordered = (list: typeof order) => [...list].sort((a, b) => compare(a.path, b.path) || a.index - b.index)
	const roots = ordered(order.filter((item) => byId.get(item.id)?.parent === undefined))
	const places = new Map<string, number>()
	roots.forEach((r, place) => {
		const members = ordered(order.filter((item) => root(item.id) === r.id))
		members.forEach((m, j) => places.set(m.id, place + (members.length < 2 ? 0 : (STACK_SPREAD * j) / (members.length - 1))))
	})
	return places
}

/** Every stream blowing at time `t`, carried to the world by the part it belongs to. */
export const streams = <L extends string>(
	scene: SimScene<L>,
	t: number,
	placements?: Parameters<typeof worldPose>[3]
): readonly Stream[] =>
	scene.animated.flatMap((a) => {
		const f = a.airflow
		if (f === undefined || t < f.from) return []
		const outlet = compose(worldPose(scene, a.id, t, placements), { at: f.at, angle: f.direction })
		return [{ at: outlet.at, direction: outlet.angle, diameter: f.diameter, speed: f.speed }]
	})

/** An animated part's angle at time `t`, between its keys. */
export const angleAt = (part: AnimatedPart, t: number): number => {
	const keys = part.keys
	const first = keys[0]
	const last = keys.at(-1)
	if (first === undefined || last === undefined) return 0
	if (t <= first.t) return first.angle
	if (t >= last.t) return last.angle
	const i = keys.findIndex((k) => k.t > t)
	const a = keys[i - 1] ?? first
	const b = keys[i] ?? last
	return a.angle + ((b.angle - a.angle) * (t - a.t)) / (b.t - a.t)
}

/**
 * The view: an orthographic projection that puts world point `origin` at canvas pixel `pixel`,
 * `pixelsPerMeter` across and up, with the canvas's Y axis pointing down.
 */
export interface Camera {
	readonly canvas: { readonly width: number; readonly height: number }
	readonly origin: Vec
	readonly pixel: Vec
	readonly pixelsPerMeter: number
}

/**
 * Dynamic parts held at rest until `at` seconds, when physics takes them over from rest. Nothing
 * about what happens next is specified. An organic holder switches from pose `from` (drawn holding
 * the part) through `via` to `to` at the release; a mechanism's own keys open it.
 */
export interface Release<L extends string> {
	readonly parts: readonly string[]
	readonly at: number
	readonly holder?: {
		readonly id: string
		readonly from: L
		/** Poses passed through at the release, each for its seconds, before `to`. */
		readonly via: readonly { readonly pose: L; readonly seconds: number }[]
		readonly to: L
	}
}

/** The organic holder's pose at time `t`: `from` before the release, then each `via` pose, then `to`. */
export const poseAt = <L extends string>(release: Release<L>, t: number): L | undefined => {
	const holder = release.holder
	if (holder === undefined) return undefined
	if (t < release.at) return holder.from
	let start = release.at
	for (const v of holder.via) {
		if (t < start + v.seconds) return v.pose
		start += v.seconds
	}
	return holder.to
}

/**
 * A steady stream of air leaving a round outlet in a part, as an electric fan blows it, from the
 * moment `from` (seconds) when it is switched on, at full strength at once. It belongs to its part:
 * `at` is the outlet's center and `direction` the way the air leaves (radians, 0 along +x), both in
 * the part's frame, so the stream moves and turns with the part. `speed` is the air's speed across
 * the outlet in meters per second.
 */
export interface Airflow {
	readonly from: number
	readonly at: Vec
	readonly direction: number
	readonly diameter: number
	readonly speed: number
	readonly source?: string
}

export interface SimScene<L extends string> {
	readonly id: string
	readonly camera: Camera
	readonly solids: readonly SolidPart[]
	readonly organic: readonly OrganicPart<L>[]
	readonly animated: readonly AnimatedPart[]
	readonly release: Release<L>
	readonly contacts: readonly Contact[]
	readonly seconds: number
	readonly setting?: Setting
	readonly layers: readonly Layer[]
	readonly marks: readonly Mark[]
	readonly joints?: readonly Joint[]
}

/**
 * A mark a scene leaves, drawn behind its parts: a faint dashed outline where a solid stood at the
 * start, shown from the moment `from` (where a pinecone hung, once it has fallen).
 */
export interface Mark {
	readonly of: string
	readonly from: number
}

/** The volume of material in the solid a body stands for: a sphere or its shell, a box, or a prism of its outline. */
export const volume = (body: Body): number =>
	body.kind === "ball"
		? (4 / 3) * Math.PI * (body.radius ** 3 - Math.max(0, body.radius - (body.wall ?? body.radius)) ** 3)
		: body.kind === "polygon"
			? polygonArea(body.points) * body.depth
			: ((1 + (body.taper ?? 1)) / 2) * body.width * body.height * body.depth

export const mass = (part: SolidPart): number => part.material.density * volume(part.body)

/** A placeholder's outline, drawn in canvas pixels whatever the scale. */
export const OUTLINE = "#333"
export const OUTLINE_PX = 3

/** The vector of a solid part, derived from its body, in the part's own frame. */
export const bodyVector = (part: SolidPart): readonly Part[] => {
	const attrs = {
		fill: part.placeholder.fill,
		stroke: OUTLINE,
		"stroke-width": OUTLINE_PX,
		"vector-effect": "non-scaling-stroke"
	}
	if (part.body.kind === "slab" && part.body.taper !== undefined) {
		const { width: w, height: h, taper } = part.body
		const points = [
			[(-w * taper) / 2, -h / 2],
			[(w * taper) / 2, -h / 2],
			[w / 2, h / 2],
			[-w / 2, h / 2]
		]
		return [{ id: part.id, tag: "polygon", attrs: { points: points.map((p) => p.join(",")).join(" "), ...attrs } }]
	}
	if (part.body.kind === "polygon") {
		const points = part.body.points.map((p) => `${p.x},${p.y}`).join(" ")
		return [{ id: part.id, tag: "polygon", attrs: { points, ...attrs } }]
	}
	return part.body.kind === "ball"
		? [{ id: part.id, tag: "circle", attrs: { cx: 0, cy: 0, r: part.body.radius, ...attrs } }]
		: [
				{
					id: part.id,
					tag: "rect",
					attrs: {
						x: -part.body.width / 2,
						y: -part.body.height / 2,
						width: part.body.width,
						height: part.body.height,
						...attrs
					}
				}
			]
}
