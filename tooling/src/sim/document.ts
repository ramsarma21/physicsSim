import { Schema } from "effect"
import type { Part } from "#part.ts"
import { type Contact, type Material, polygonProblem, type SimScene } from "#sim/part.ts"
import { type ProcessRecord, processesProblem, settingsProblem } from "#sim/plugins.ts"
import "#sim/modules/index.ts" // (every module's process kinds, registered before any document is admitted)

/**
 * A simulated demonstration's record: one JSON document that every editor reads and writes and
 * every render starts from. Materials are named once and referred to by name; a value with no
 * `source` is provisional. Each chosen sprite is recorded with its file (beside the document), a
 * content hash and its fit, so a render needs nothing but the document and its folder. An editor's
 * own file (a `.blend`) is a working copy rebuilt from this. This module is pure, so a browser
 * editor can admit and write documents too; reading files and hashing are in `document-files.ts`.
 */

const Finite = Schema.Finite
const Vec = Schema.Struct({ x: Finite, y: Finite })

const PartTag = Schema.Literals(["g", "rect", "ellipse", "circle", "line", "polyline", "polygon", "path", "image", "text"])

const PartSchema: Schema.Codec<Part> = Schema.Struct({
	id: Schema.String,
	tag: PartTag,
	attrs: Schema.optionalKey(Schema.Record(Schema.String, Schema.Union([Schema.String, Finite]))),
	translate: Schema.optionalKey(Schema.Tuple([Finite, Finite])),
	rotate: Schema.optionalKey(Schema.Tuple([Finite, Finite, Finite])),
	text: Schema.optionalKey(Schema.String),
	children: Schema.optionalKey(Schema.Array(Schema.suspend((): Schema.Codec<Part> => PartSchema)))
})

const MaterialRecord = Schema.Struct({
	density: Finite,
	yieldStrength: Schema.optionalKey(Finite),
	source: Schema.optionalKey(Schema.String)
})

const ContactRecord = Schema.Struct({
	between: Schema.Tuple([Schema.String, Schema.String]),
	friction: Finite,
	restitution: Finite,
	rollingResistance: Finite,
	tangentRestitution: Schema.optionalKey(Finite),
	grip: Schema.optionalKey(Finite),
	source: Schema.optionalKey(Schema.String)
})

const Body = Schema.Union([
	Schema.Struct({ kind: Schema.Literal("ball"), radius: Finite, wall: Schema.optionalKey(Finite), inertia: Schema.optionalKey(Finite) }),
	Schema.Struct({ kind: Schema.Literal("slab"), width: Finite, height: Finite, depth: Finite, taper: Schema.optionalKey(Finite) }),
	/** A convex outline, 3 to 8 points counterclockwise in the solid's own frame; checked by `polygonProblem` on admission. */
	Schema.Struct({ kind: Schema.Literal("polygon"), points: Schema.Array(Vec), depth: Finite })
])

const RenderMode = Schema.Union([
	Schema.Struct({ kind: Schema.Literal("rigid") }),
	Schema.Struct({ kind: Schema.Literal("tiled") }),
	Schema.Struct({ kind: Schema.Literal("procedural"), shade: Schema.String })
])

/** A hinge's drive: rad/s counterclockwise, and the most torque it gives, N·m. */
const Motor = Schema.Struct({ speed: Finite, torque: Finite })

const SolidRecord = Schema.Struct({
	kind: Schema.Literals(["dynamic", "static"]),
	id: Schema.String,
	words: Schema.String,
	/**
	 * The name its sprite is made under. Without one, a rigid solid shares the sprite of the first
	 * with the same words and body, else is drawn by its own; naming one keeps lookalikes apart.
	 */
	sprite: Schema.optionalKey(Schema.String),
	body: Body,
	material: Schema.String,
	at: Vec,
	angle: Schema.optionalKey(Finite),
	pivot: Schema.optionalKey(Vec),
	damping: Schema.optionalKey(Finite),
	placeholder: Schema.Struct({ fill: Schema.String }),
	render: RenderMode,
	depth: Finite,
	parent: Schema.optionalKey(Schema.String),
	surfaceSpeed: Schema.optionalKey(Finite),
	motor: Schema.optionalKey(Motor),
	/** 1/s: its turning slows as dω/dt = −c·ω (a raw egg's liquid); none without it. */
	angularDamping: Schema.optionalKey(Finite),
	shape: Schema.optionalKey(Schema.String),
	length: Schema.optionalKey(Finite),
	/** A display only (an instrument's face, a painted line, a lane's number boards): it collides with nothing (part.ts `ghost`). */
	ghost: Schema.optionalKey(Schema.Boolean)
})

/** A joint's solid, by id, or null for the world. */
const Side = Schema.NullOr(Schema.String)
const JointRecord = Schema.Union([
	Schema.Struct({
		kind: Schema.Literal("spring"),
		id: Schema.String,
		item: Schema.optionalKey(Schema.String),
		a: Side,
		b: Side,
		anchorA: Vec,
		anchorB: Vec,
		rest: Finite,
		stiffness: Finite,
		damping: Finite,
		compressOnly: Schema.optionalKey(Schema.Boolean),
		coils: Schema.optionalKey(Finite),
		coilRadius: Schema.optionalKey(Finite),
		/** kg, zero or more: the spring's own mass (its coils move with what it pushes: tooling/src/sim/physics.ts); none without it. */
		mass: Schema.optionalKey(Finite.check(Schema.isGreaterThanOrEqualTo(0)))
	}),
	Schema.Struct({
		kind: Schema.Literal("rope"),
		id: Schema.String,
		item: Schema.optionalKey(Schema.String),
		a: Side,
		b: Side,
		anchorA: Vec,
		anchorB: Vec,
		length: Finite,
		thickness: Schema.optionalKey(Finite),
		/** It collides (moving solids land on it while it is taut); a chain (`render.style` "chain") always does. */
		collide: Schema.optionalKey(Schema.Boolean),
		/** How it is drawn: `style` "chain" draws (and makes it collide as) a chain. */
		render: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown))
	}),
	Schema.Struct({
		kind: Schema.Literal("pin"),
		id: Schema.String,
		item: Schema.optionalKey(Schema.String),
		a: Side,
		b: Side,
		anchorA: Vec,
		anchorB: Vec,
		motor: Schema.optionalKey(Motor),
		limits: Schema.optionalKey(Schema.Struct({ lower: Finite, upper: Finite })),
		/** Hinge friction: a Coulomb torque of at most this many N·m against the relative turning. */
		friction: Schema.optionalKey(Finite),
		/** Hinge damping: a viscous torque of this many N·m·s per rad/s of relative turning. */
		damping: Schema.optionalKey(Finite)
	}),
	Schema.Struct({
		kind: Schema.Literal("wheel"),
		id: Schema.String,
		item: Schema.optionalKey(Schema.String),
		chassis: Side,
		wheel: Side,
		anchor: Vec,
		axis: Vec,
		frequency: Finite,
		damping: Finite,
		motor: Schema.optionalKey(Motor)
	}),
	Schema.Struct({
		kind: Schema.Literal("pulley"),
		id: Schema.String,
		item: Schema.optionalKey(Schema.String),
		a: Side,
		b: Side,
		groundA: Vec,
		groundB: Vec,
		anchorA: Vec,
		anchorB: Vec,
		ratio: Finite,
		wheelRadius: Schema.optionalKey(Finite),
		/** The shortest each run gets, m (its rope end jams at its wheel); without one, where its body meets its wheel. */
		minLengthA: Schema.optionalKey(Finite),
		minLengthB: Schema.optionalKey(Finite)
	})
])

const AirflowRecord = Schema.Struct({
	from: Finite,
	at: Vec,
	direction: Finite,
	diameter: Finite,
	speed: Finite,
	source: Schema.optionalKey(Schema.String)
})

const AnimatedRecord = Schema.Struct({
	kind: Schema.Literal("animated"),
	id: Schema.String,
	words: Schema.String,
	sprite: Schema.String,
	vector: Schema.Array(PartSchema),
	at: Vec,
	keys: Schema.Array(Schema.Struct({ t: Finite, angle: Finite })),
	cycle: Schema.optionalKey(
		Schema.Struct({
			off: Schema.String,
			frames: Schema.Int,
			perSecond: Finite,
			change: Schema.String,
			changes: Schema.Struct({ x: Finite, y: Finite, w: Finite, h: Finite })
		})
	),
	airflow: Schema.optionalKey(AirflowRecord),
	anchor: Schema.optionalKey(Schema.Literals(["bottom", "top"])),
	fill: Schema.optionalKey(Schema.Boolean),
	depth: Finite,
	parent: Schema.optionalKey(Schema.String)
})

const OrganicRecord = Schema.Struct({
	kind: Schema.Literal("organic"),
	id: Schema.String,
	words: Schema.String,
	at: Vec,
	reach: Vec,
	poses: Schema.Array(Schema.String),
	depth: Finite,
	parent: Schema.optionalKey(Schema.String)
})

const HitboxRecord = Schema.Struct({
	edge: Schema.Literals(["left", "right"]),
	from: Finite,
	to: Finite,
	material: Schema.String,
	track: Schema.Array(Schema.NullOr(Finite))
})

const LayerRecord = Schema.Struct({
	id: Schema.String,
	words: Schema.String,
	frames: Schema.String,
	times: Schema.Array(Finite),
	pixels: Schema.Struct({ width: Finite, height: Finite }),
	at: Vec,
	width: Finite,
	depth: Finite,
	start: Finite,
	speed: Schema.optionalKey(Finite),
	parent: Schema.optionalKey(Schema.String),
	hitbox: Schema.optionalKey(HitboxRecord)
})

const Release = Schema.Struct({
	parts: Schema.Array(Schema.String),
	at: Finite,
	holder: Schema.optionalKey(
		Schema.Struct({
			id: Schema.String,
			from: Schema.String,
			via: Schema.Array(Schema.Struct({ pose: Schema.String, seconds: Finite })),
			to: Schema.String
		})
	)
})

const Camera = Schema.Struct({
	canvas: Schema.Struct({ width: Finite, height: Finite }),
	origin: Vec,
	pixel: Vec,
	pixelsPerMeter: Finite
})

/** A chosen sprite: its file relative to the document's folder, its SHA-256 and its fit. */
export const SpriteRecord = Schema.Struct({
	file: Schema.String,
	sha256: Schema.String,
	width: Finite,
	height: Finite,
	kx: Finite,
	ky: Finite,
	ox: Finite,
	oy: Finite
})
export type SpriteRecord = typeof SpriteRecord.Type

const MarkRecord = Schema.Struct({ of: Schema.String, from: Finite })

export const SceneDocument = Schema.Struct({
	version: Schema.Literal(1),
	id: Schema.String,
	camera: Camera,
	materials: Schema.Record(Schema.String, MaterialRecord),
	contacts: Schema.Array(ContactRecord),
	solids: Schema.Array(SolidRecord),
	animated: Schema.Array(AnimatedRecord),
	organic: Schema.Array(OrganicRecord),
	release: Release,
	seconds: Finite,
	setting: Schema.optionalKey(Schema.Struct({ words: Schema.String })),
	layers: Schema.optionalKey(Schema.Array(LayerRecord)),
	marks: Schema.optionalKey(Schema.Array(MarkRecord)),
	joints: Schema.optionalKey(Schema.Array(JointRecord)),
	sprites: Schema.Record(Schema.String, SpriteRecord),
	// (plugins.ts: the run's settings and the modules' process records; a document without them runs as before)
	settings: Schema.optionalKey(
		Schema.Struct({
			gravity: Schema.optionalKey(Finite),
			air: Schema.optionalKey(Schema.Boolean),
			airDensity: Schema.optionalKey(Finite),
			roomTemperature: Schema.optionalKey(Finite),
			timeLapse: Schema.optionalKey(Finite)
		})
	),
	processes: Schema.optionalKey(Schema.Array(Schema.Record(Schema.String, Schema.Unknown)))
})
export type SceneDocument = typeof SceneDocument.Type

/**
 * Validates a document once and resolves its material names into the scene the engine and the
 * drawing use. An unknown material name is refused here rather than discovered mid-simulation.
 */
export const admitDocument = (input: unknown): { readonly document: SceneDocument; readonly scene: SimScene<string> } => {
	// (a document that does not fit is refused in one line, its place in the document included: a worker passes on an error's last line only)
	let document: SceneDocument
	try {
		document = Schema.decodeUnknownSync(SceneDocument)(input)
	} catch (e) {
		const lines = (e instanceof Error ? e.message : String(e)).split("\n").map((l) => l.trim()).filter((l) => l !== "")
		const id = typeof input === "object" && input !== null && typeof (input as { id?: unknown }).id === "string" ? `${(input as { id: string }).id}: ` : ""
		throw new Error(`${id}the document does not fit the format: ${lines.join(" ")}`)
	}
	const material = (name: string): Material => {
		const record = document.materials[name]
		if (record === undefined) {
			throw new Error(`${document.id}: no material named "${name}"`)
		}
		return { words: name, ...record }
	}
	// Every parent names a part, a solid's parent is a solid (it is joined to its body), and no part
	// is its own ancestor.
	const kinds = new Map<string, string>([
		...document.solids.map((p) => [p.id, "solid"] as const),
		...document.animated.map((p) => [p.id, "animated"] as const),
		...document.organic.map((p) => [p.id, "organic"] as const)
	])
	const parents = new Map<string, string>()
	for (const p of [...document.solids, ...document.animated, ...document.organic]) {
		if (p.parent === undefined) continue
		const kind = kinds.get(p.parent)
		if (kind === undefined) throw new Error(`${document.id}: ${p.id}'s parent "${p.parent}" is not a part`)
		if (kinds.get(p.id) === "solid" && kind !== "solid") {
			throw new Error(`${document.id}: ${p.id} is a solid part, so its parent must be one; "${p.parent}" is ${kind}`)
		}
		parents.set(p.id, p.parent)
	}
	for (const mark of document.marks ?? []) {
		if (!document.solids.some((s) => s.id === mark.of)) throw new Error(`${document.id}: a mark's part "${mark.of}" is not a solid part`)
	}
	for (const layer of document.layers ?? []) {
		if (layer.parent !== undefined && !kinds.has(layer.parent)) {
			throw new Error(`${document.id}: layer ${layer.id}'s parent "${layer.parent}" is not a part`)
		}
		if (layer.parent !== undefined && layer.hitbox !== undefined) {
			throw new Error(`${document.id}: layer ${layer.id} has a hitbox, so it stands in the world, not on a parent`)
		}
	}
	// A joint joins solids (or the world, null); a motor drives a pivot.
	for (const joint of document.joints ?? []) {
		const sides = joint.kind === "wheel" ? [joint.chassis, joint.wheel] : [joint.a, joint.b]
		for (const side of sides) {
			if (side !== null && kinds.get(side) !== "solid") throw new Error(`${document.id}: joint ${joint.id}'s "${side}" is not a solid part`)
		}
	}
	for (const s of document.solids) {
		if (s.motor !== undefined && s.pivot === undefined) throw new Error(`${document.id}: ${s.id} has a motor but no pivot for it to drive`)
		// A polygon body is convex and counterclockwise, as Box2D needs; planck would silently wrap any
		// other list in its convex hull, a different object from the one specified.
		const problem = s.body.kind === "polygon" ? polygonProblem(s.body.points) : undefined
		if (problem !== undefined) throw new Error(`${document.id}: ${s.id}'s polygon body ${problem}`)
	}
	// the run's settings within their limits, and every process of a kind this engine knows, as its module checks it (plugins.ts)
	const badSettings = settingsProblem(document.settings)
	if (badSettings !== undefined) throw new Error(`${document.id}: ${badSettings}`)
	const records = (document.processes ?? []) as unknown as readonly ProcessRecord[]
	if (records.length > 0) {
		const badProcess = processesProblem(records, new Set(document.solids.map((s) => s.id)))
		if (badProcess !== undefined) throw new Error(`${document.id}: ${badProcess}`)
	}
	for (const id of parents.keys()) {
		const seen = new Set([id])
		for (let up = parents.get(id); up !== undefined; up = parents.get(up)) {
			if (seen.has(up)) throw new Error(`${document.id}: ${id} is its own ancestor`)
			seen.add(up)
		}
	}
	// Rigid solids with the same words and body are one object drawn once (a cart's two wheels): each
	// without a sprite of its own shares the first one's. Solids sharing a sprite are the same rigid
	// object, so one fit serves them all.
	const lookalike = (s: (typeof document.solids)[number]) => `${s.words}\u0000${JSON.stringify(s.body)}`
	const firstOf = new Map<string, string>()
	for (const s of document.solids) {
		if (s.render.kind === "rigid" && !firstOf.has(lookalike(s))) firstOf.set(lookalike(s), s.sprite ?? s.id)
	}
	const spriteOf = (s: (typeof document.solids)[number]) =>
		s.sprite ?? (s.render.kind === "rigid" ? (firstOf.get(lookalike(s)) ?? s.id) : s.id)
	const shared = new Map<string, (typeof document.solids)[number]>()
	for (const s of document.solids) {
		if (s.sprite === undefined) continue
		const first = shared.get(s.sprite)
		if (s.render.kind !== "rigid") throw new Error(`${document.id}: ${s.id} shares sprite "${s.sprite}", so it must be drawn rigid`)
		if (first === undefined) shared.set(s.sprite, s)
		else if (JSON.stringify(first.body) !== JSON.stringify(s.body) || first.words !== s.words) {
			throw new Error(`${document.id}: ${s.id} shares sprite "${s.sprite}" with ${first.id} but differs in its body or words`)
		}
	}
	const contacts: Contact[] = document.contacts.map((c) => ({
		...c,
		between: [material(c.between[0]), material(c.between[1])]
	}))
	const scene: SimScene<string> = {
		id: document.id,
		camera: document.camera,
		solids: document.solids.map((s) => ({ ...s, sprite: spriteOf(s), material: material(s.material) })),
		animated: document.animated,
		organic: document.organic,
		release: document.release,
		contacts,
		seconds: document.seconds,
		...(document.setting === undefined ? {} : { setting: document.setting }),
		marks: document.marks ?? [],
		...(document.joints === undefined ? {} : { joints: document.joints }),
		...(document.processes === undefined || document.processes.length === 0 ? {} : { processes: records }),
		...(document.settings === undefined ? {} : { settings: document.settings }),
		layers: (document.layers ?? []).map(({ hitbox, ...layer }) =>
			hitbox === undefined ? layer : { ...layer, hitbox: { ...hitbox, material: material(hitbox.material) } }
		)
	}
	return { document, scene }
}

/** The document as written to disk: tab-indented, ending in a newline, so its diffs read cleanly. */
export const documentText = (document: SceneDocument): string =>
	`${JSON.stringify(Schema.encodeSync(SceneDocument)(document), null, "\t")}\n`
