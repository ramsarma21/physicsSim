/**
 * Engine process plugins: what a physics module (heat, liquids, circuits, light, magnets, sound...) adds to the run without touching
 * physics.ts. A module is one file in tooling/src/sim/modules/ whose default export is a `ProcessKind` (or a list of them); the index
 * there (tooling/src/sim/modules/index.ts, written by `node tools/gen-modules.mjs`) registers them. The document carries the work as
 * `doc.processes[]` records ({kind, id, item?, ...the module's own fields}, made by the catalog builder's `c.process(kind, part, ...)`)
 * and the run's settings as `doc.settings` ({gravity, air, roomTemperature, timeLapse}). A document with neither runs exactly as before
 * (the same bits: nothing here is called).
 *
 * The run calls each record's process, in document order, at these points (see `simulate` in physics.ts):
 *   start(ctx)            once, after every body and joint is made
 *   step(ctx)             every 480 Hz step from t = 0 (ctx.released() says whether the bodies move yet), before the step is solved
 *   slow(ctx, dt)         every `coarse` steps from t = 0 (a decoupled slow process: heat, melting, chemistry), dt = coarse × STEP ×
 *                         timeLapse seconds of the process's own time (time-lapse scaling: the mechanics stay real-time)
 *   force(ctx, h)         every (sub-)step after the release, just before the world is stepped: push and twist bodies (fields, buoyancy)
 *   end(ctx)              once, after the last step
 * Readings (per-item state: a temperature, a melt fraction, a brightness, a stopwatch's reading) are set with ctx.set(item, key, value)
 * and come out per frame in `track.state[item][key]` (rounded to 5 decimals); events with ctx.event(text, items) come out in
 * `track.events` [{t, items, text, kind}]. A body can be resized (ctx.solid(id).resize(scale): an ice cube melting, a balloon filling):
 * its placements then carry `scale`.
 * Everything here is deterministic (no clocks, no randomness). In the bundle and on the server Math.sin, cos, atan2, exp, hypot and pow (and
 * `**`) are the engine's own (tools/fdlibm.ts, tools/crpow.ts): the same bits in every browser. A module uses only those, + − × ÷,
 * Math.sqrt, abs, min, max, floor, ceil, round, sign, trunc: never Math.cbrt, log, acos, asin, tan, sinh... (each browser's own; write
 * x^(1/3) as Math.pow(x, 1 / 3), acos(c) as atan2(√(1 − c²), c), log via a series of pow and exp if it must).
 */
import type { SimScene, SolidPart } from "#sim/part.ts"

export interface ProcessRecord {
	readonly kind: string
	readonly id: string
	readonly item?: string
	readonly [key: string]: unknown
}

/** The run's settings (doc.settings, all optional there): what the scene's settings resolve to. */
export interface RunSettings {
	/** m/s², downwards (Earth 9.81, the engine's standard; Moon 1.62, Mars 3.71). */
	readonly gravity: number
	/** Whether there is air: false = a vacuum (no buoyancy, no drag, no fans' streams acting). */
	readonly air: boolean
	/**
	 * kg/m³: the air's density for the engine's drag and buoyancy while `air` is on (1.2, a room's, the standard; a world's own: Mars's
	 * surface ~0.020, Venus's ~65, Jupiter's at the 1-bar level 0.16: NASA planetary fact sheets). Optional in doc.settings (`airDensity`).
	 */
	readonly airDensity: number
	/** °C: the room's temperature (what a heat module starts things at and cools them toward). */
	readonly roomTemperature: number
	/** How many seconds of slow processes pass in each second of the run (1 = real time; 60: a minute a second). */
	readonly timeLapse: number
}

/** The engine's standard settings: a document without `settings` (or with these values) runs exactly as before plugins. */
export const STANDARD: RunSettings = { gravity: 9.81, air: true, airDensity: 1.2, roomTemperature: 20, timeLapse: 1 }

/** The limits doc.settings must keep (admitDocument refuses anything else, with the reason). */
export const SETTING_LIMITS = { gravity: [0, 30], airDensity: [0.001, 100], roomTemperature: [-60, 60], timeLapse: [1, 100000] } as const

export interface Point {
	readonly x: number
	readonly y: number
}

/** A solid as a process sees it. Lengths m, angles rad (counter-clockwise), forces N, torques N·m, at this moment of the run. */
export interface SolidHandle {
	readonly id: string
	readonly item: string
	/** The document's solid (its body as resized, its material, its depth...). */
	readonly part: SolidPart
	/** Moves (a dynamic solid of a dynamic body). */
	readonly dynamic: boolean
	/** Its own pose in the world: its `at` and angle now. */
	pose(): { x: number; y: number; angle: number }
	/** The velocity of its middle (its own mass's centre). */
	velocity(): Point
	/** Its body's turning, rad/s. */
	spin(): number
	/** Its own mass now, kg (density × volume), with what it carries (carry). */
	mass(): number
	/**
	 * The mass it holds besides its own, kg (the flow module: the liquid standing in a cup or a mug), from now on: mass() adds it, so a
	 * kitchen scale under the cup weighs what it holds. Only the reading: the engine's body is the module's to set. Never called, nothing changes.
	 */
	carry?(kg: number): void
	/** The world outline: a ball's circle {x, y, r}, else its corners counter-clockwise. */
	outline(): { readonly circle?: { x: number; y: number; r: number }; readonly points?: readonly Point[] }
	/** A force (N) at a world point (default its middle). Wakes its body. Only after the release, inside `force`. */
	push(fx: number, fy: number, at?: Point): void
	/** A torque (N·m) on its body. */
	twist(torque: number): void
	/** Its scale against its document body (1 = as built). */
	scale(): number
	/** Resizes its body about its own origin to `scale` × its document body (depth too: its volume and mass go as scale³). */
	resize(scale: number): void
	/** Its weld group's body as the engine moves it (the liquids module's buoyancy and added mass read it): see BodyView. */
	body(): BodyView
	/**
	 * Sets its weld group's body moving: the velocity of its centre of mass (m/s) and, if given, its turning (rad/s, counter-clockwise),
	 * as at that moment (a kick, a launch, a car already moving at the release: the mechanics module's start_speed). Wakes it.
	 */
	setVelocity(vx: number, vy: number, spin?: number): void
	/**
	 * The air round it as a share of the room's density (1: the room's; a pumped jar's or tube's inside: its pressure ÷ the room's, 0: none):
	 * the engine's buoyancy and drag on it, and so a fan's stream's push, scale with it from the next (sub-)step (the air module's jars and
	 * tubes set it for what is inside them; never set in a plain run). Optional: physics.ts's handles have it.
	 */
	setAirShare?(share: number): void
}

/**
 * A moving body (a weld group: every part welded to its root) as the engine holds it this step. `key`: the same number for every part of
 * the body (its root's place among the document's solids); `mass` (kg) and `inertia` (kg·m² about its centre of mass) as the engine moves it
 * (its parts, the air a ball carries, springs' shares); `center` (m) and `velocity` (m/s) of its centre of mass; `spin` (rad/s); `force` (N)
 * and `torque` (N·m) applied to it so far this (sub-)step, besides gravity (the air's lift and drag, springs' weights, other processes'
 * pushes before this one); `jointed`: a joint or a pivot holds it (a hinge, rope, spring, pulley, wheel). A static body: mass 0.
 */
export interface BodyView {
	readonly key: number
	readonly mass: number
	readonly inertia: number
	readonly center: Point
	readonly velocity: Point
	readonly spin: number
	readonly force: Point
	readonly torque: number
	readonly jointed: boolean
}

export interface ProcessContext {
	readonly scene: SimScene<string>
	readonly settings: RunSettings
	/** The record this process was made from. */
	readonly record: ProcessRecord
	/** The engine's step, s (1/480). */
	readonly step: number
	/** s since the run began. */
	time(): number
	/** s of slow-process time since the run began (time × timeLapse). */
	slowTime(): number
	/** Whether the held parts have been let go (bodies move from then on). */
	released(): boolean
	solid(id: string): SolidHandle | undefined
	/** An item's solids, in document order. */
	solidsOf(item: string): readonly SolidHandle[]
	all(): readonly SolidHandle[]
	/** The solids touching this one now (a contact with points), in the engine's contact order. */
	touching(id: string): readonly string[]
	/** The air's velocity at a world point (fans' streams; still air elsewhere; none in a vacuum), m/s. */
	air(p: Point): Point
	/** The volume of a solid below the level y (m³: a ball's spherical cap, a slab's or polygon's outline below the line × depth) and its centre. */
	submerged(id: string, level: number): { volume: number; x: number; y: number }
	/** Sets a reading of an item (recorded at every frame from now on; 5 decimals in the track). */
	set(item: string, key: string, value: number): void
	get(item: string, key: string): number | undefined
	/**
	 * Sets a list of numbers an item draws with (a particle model's positions: x0, y0, x1, y1, ...): kept 120 times a second and given per
	 * frame in `track.series[item][key]` (each frame the list as it was then, 5 decimals). Not a reading: the summary and the AI never see it.
	 */
	series(item: string, key: string, values: readonly number[]): void
	/**
	 * Sparse frames of a list an item draws with (a heightfield of sand, a cloud of grains in the air): kept only at the moments it is set
	 * (once a step at most: a second call in one step replaces the first), as `track.keyframes[item][key] = [[t, ...values], ...]` (t to 6
	 * decimals, values to 5). The view interpolates between them. For large lists that change now and then (`series` copies its list into every
	 * frame). Not a reading: the summary and the AI never see it.
	 */
	keyframe(item: string, key: string, values: readonly number[]): void
	/** Something that happened, for the run's summary: "Ice cube 1 melted completely". `at`: when it began (s, not after now; default now:
	 * a module that waits to see a change last, a switch's press, says when it started). Events come out in time order. */
	event(text: string, items: readonly string[], kind?: string, at?: number): void
	/** The engine's internals, for a module whose physics is a constraint (see EngineInternals); undefined outside physics.ts's runs. */
	engine(): EngineInternals | undefined
	/**
	 * Says what a force this process applies is, for force arrows (the mechanics module's `arrows`): `kind` a word ("buoyancy", "magnetic",
	 * "applied"...), the force (N, world) on solid `solid`, at `at` (a world point; default its middle). Display only: it pushes nothing. Only
	 * kept while a process watches forces (Process.watchesForces): otherwise it costs nothing. A process that reports in a (sub-)step stands for
	 * its own pushes of that step: they are left out of `forces()` (without reports, each push is listed under the process's kind).
	 */
	reportForce(solid: string, kind: string, fx: number, fy: number, at?: Point): void
	/**
	 * The forces the processes applied (`push`) or reported (`reportForce`) in this (sub-)step so far, when a process watches forces; [] else.
	 * Read it in `after` (every process has pushed by then). `by`: the process kind that applied it.
	 */
	forces(): readonly ForceRecord[]
}

/** A force a process applied or reported this (sub-)step (ProcessContext.forces): N, world; `at` a world point (or undefined: its middle). */
export interface ForceRecord {
	readonly solid: string
	readonly kind: string
	readonly by: string
	readonly fx: number
	readonly fy: number
	readonly at?: Point
}

/**
 * Low-level access for a module whose physics are constraints planck must solve with the rest (the mechanics module's gears, ropes wound
 * on drums, sliders, welds made on contact, round bodies on true arcs): planck's world and how the document's solids map onto its bodies,
 * in planck's units (`lengthScale` units per metre: a position in metres × lengthScale). Prefer the handles where they suffice: what a
 * module does here (the joints it makes, in what order) must be deterministic, and must make nothing at all for documents without its records.
 */
export interface EngineInternals {
	/** planck's World. */
	readonly world: unknown
	readonly lengthScale: number
	/** The planck Body of a solid (its weld group's), or undefined; null: the ground body (the world's frame). */
	bodyOf(id: string | null): unknown
	/** A point given in a solid's own frame (m), in its body's frame (planck units, a planck Vec2); for null, a world point (m) scaled. */
	anchorOn(id: string | null, p: Point): unknown
	/** A direction given in a solid's own frame, in its body's frame (a planck Vec2); for null, as given. */
	directionOn(id: string | null, d: Point): unknown
	/** The solid a fixture's user data names (planck Fixture.getUserData()), or undefined. */
	solidOf(userData: unknown): { readonly id: string; readonly item: string; readonly kind: string } | undefined
	/** A solid's world pose at the start of the run (m, rad). */
	startPose(id: string): { readonly at: Point; readonly angle: number }
	/** How two solids' materials meet: the document's contact for them (friction, restitution, rolling resistance). */
	meeting(a: string, b: string): { readonly friction: number; readonly restitution: number; readonly rolling: number }
	/** An impact for the track's impacts (and the frame nearest it): two solids, the speed they met at (m/s), at this step. */
	hit(a: string, b: string, speed: number): void
	/**
	 * Calls fn once each (sub-)step right after planck's main solve, before its continuous (time-of-impact) pass, which disables some contacts
	 * (a hinged body's) and solves impacts that keep no impulses: there each contact that is enabled and touching was solved this step and holds
	 * its impulses, and each joint its reaction (force arrows read them there). Calling it changes nothing in the run.
	 */
	afterSolve?(fn: () => void): void
	/** The air's push on a solid this (sub-)step, as the engine applied it: its drag (wind or resistance, N, world) and its buoyancy (the air
	 * its volume displaces, N up); undefined for a solid that is not a moving one. Read only. */
	airOn?(id: string): { readonly x: number; readonly y: number; readonly lift: number } | undefined
	/** The force (N, world) a joint of the engine's own (a hinge, a rope, a spring, a pulley's rope, a chain's touch) puts on one of its two
	 * bodies in the last solve (planck's joints and physics.ts's: each knows which way it acts on which body); undefined for other joints. */
	jointForce?(joint: unknown, body: unknown, inv_dt: number): Point | undefined
	/** A spring joint of the engine's: its stiffness k (N/m) and stretch x now (m; its energy ½·k·x²); undefined for any other joint. */
	spring?(joint: unknown): { readonly k: number; readonly x: number } | undefined
	/** The engine's springs' own weight that a body carries at their ends (N, down; physics.ts's springWeights: half a spring's weight less what its
	 * added inertia already weighs), and where (m, world): a constant force, so energy bars count its potential energy and arrows its pull. */
	springWeights?(body: unknown): readonly { readonly force: number; readonly at: Point }[]
}

export interface Process {
	start?(ctx: ProcessContext): void
	step?(ctx: ProcessContext): void
	/** Steps between slow() calls (default 48: 10 Hz). */
	readonly coarse?: number
	slow?(ctx: ProcessContext, dt: number): void
	force?(ctx: ProcessContext, h: number): void
	/** After each (sub-)step of h s, once the world has been stepped (a weld made where two things stuck). */
	after?(ctx: ProcessContext, h: number): void
	/** True: this process reads the forces the others apply (ProcessContext.forces): only then are pushes listed. */
	readonly watchesForces?: boolean
	/**
	 * A contact (planck's Contact) as the engine meets it, before its own handling: `phase` "begin" (it began this step: return true when it is
	 * no impact for the track) or "pre" (before it is solved: return true and the engine leaves it out of this (sub-)step, disabled).
	 */
	contact?(ctx: ProcessContext, touch: unknown, phase: "begin" | "pre"): boolean
	end?(ctx: ProcessContext): void
}

export interface ProcessKind {
	readonly kind: string
	/** Why a record cannot run (admitDocument refuses the document with it), or undefined. `solids`: the document's solid ids. */
	check?(record: ProcessRecord, solids: ReadonlySet<string>): string | undefined
	create(record: ProcessRecord, ctx: ProcessContext): Process
}

const KINDS = new Map<string, ProcessKind>()

/** Registers a module's process kinds (tooling/src/sim/modules/index.ts does it for every module file). */
export const registerProcess = (...kinds: readonly ProcessKind[]) => {
	for (const k of kinds) {
		if (typeof k?.kind !== "string" || k.kind === "" || typeof k.create !== "function") throw new Error("registerProcess: a kind needs {kind, create}")
		KINDS.set(k.kind, k)
	}
}
export const processKind = (kind: string) => KINDS.get(kind)
export const processKinds = () => [...KINDS.keys()]
/** For tests: forget a kind. */
export const unregisterProcess = (kind: string) => KINDS.delete(kind)

/** The settings a document asks for, checked; undefined where it says nothing (the standard then holds). */
export const settingsProblem = (s: Partial<Record<keyof RunSettings, unknown>> | undefined): string | undefined => {
	if (s === undefined) return undefined
	for (const key of ["gravity", "airDensity", "roomTemperature", "timeLapse"] as const) {
		const v = s[key]
		if (v === undefined) continue
		const [lo, hi] = SETTING_LIMITS[key]
		if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi) return `settings.${key} must be a number from ${lo} to ${hi}, not ${String(v)}`
	}
	if (s.air !== undefined && typeof s.air !== "boolean") return `settings.air must be true or false`
	return undefined
}

export const resolveSettings = (s: Partial<RunSettings> | undefined): RunSettings => (s === undefined ? STANDARD : { ...STANDARD, ...s })

/** Why a document's process records cannot run, or undefined. */
export const processesProblem = (records: readonly ProcessRecord[], solids: ReadonlySet<string>): string | undefined => {
	const ids = new Set<string>()
	for (const r of records) {
		if (typeof r.kind !== "string" || typeof r.id !== "string") return "a process needs a kind and an id (strings)"
		if (ids.has(r.id)) return `two processes are called ${r.id}`
		ids.add(r.id)
		const k = KINDS.get(r.kind)
		if (k === undefined) return `process ${r.id}: no process kind "${r.kind}" in this engine (known: ${processKinds().join(", ") || "none"})`
		const why = k.check?.(r, solids)
		if (why !== undefined) return `process ${r.id}: ${why}`
	}
	return undefined
}

// ---------------------------------------------------------------- geometry helpers a module may use (pure)

/** A convex outline's part below the line y = level (Sutherland-Hodgman against one half-plane): its points, counter-clockwise. */
export const clipBelow = (points: readonly Point[], level: number): Point[] => {
	const out: Point[] = []
	const n = points.length
	for (let i = 0; i < n; i++) {
		const a = points[i] as Point
		const b = points[(i + 1) % n] as Point
		const ain = a.y <= level
		const bin = b.y <= level
		if (ain) out.push(a)
		if (ain !== bin) {
			const u = (level - a.y) / (b.y - a.y)
			out.push({ x: a.x + u * (b.x - a.x), y: level })
		}
	}
	return out
}

/** Area (m²) and centroid of a polygon (counter-clockwise; 0 and its first point when degenerate). */
export const areaAndCentroid = (points: readonly Point[]): { area: number; x: number; y: number } => {
	let a = 0
	let cx = 0
	let cy = 0
	const n = points.length
	for (let i = 0; i < n; i++) {
		const p = points[i] as Point
		const q = points[(i + 1) % n] as Point
		const c = p.x * q.y - q.x * p.y
		a += c
		cx += (p.x + q.x) * c
		cy += (p.y + q.y) * c
	}
	if (Math.abs(a) < 1e-15) return { area: 0, x: points[0]?.x ?? 0, y: points[0]?.y ?? 0 }
	return { area: a / 2, x: cx / (3 * a), y: cy / (3 * a) }
}

/**
 * The volume of a sphere of radius r (centre at height cy) below the level: a spherical cap of height h (how deep its lowest point is
 * under the level, 0..2r), V = πh²(3r − h)/3, and the height of the cap's centre of volume, 3(2r − h)²/(4(3r − h)) below the sphere's
 * centre (the standard cap centroid; h = 2r gives the centre itself).
 */
export const sphereBelow = (r: number, cy: number, level: number): { volume: number; y: number } => {
	const h = Math.min(2 * r, Math.max(0, level - (cy - r)))
	if (h <= 0) return { volume: 0, y: cy - r }
	if (h >= 2 * r) return { volume: (4 / 3) * Math.PI * r * r * r, y: cy }
	const volume = (Math.PI * h * h * (3 * r - h)) / 3
	// a cap of height h cut from the bottom: its centroid is 3(2r − h)²/(4(3r − h)) from the sphere's centre, below it
	const below = (3 * (2 * r - h) * (2 * r - h)) / (4 * (3 * r - h))
	return { volume, y: cy - below }
}

/** A circular segment's area below the level for a circle (a cylinder lying along the depth axis), and its centroid's height. */
export const circleBelow = (r: number, cy: number, level: number): { area: number; y: number } => {
	const h = Math.min(2 * r, Math.max(0, level - (cy - r)))
	if (h <= 0) return { area: 0, y: cy - r }
	if (h >= 2 * r) return { area: Math.PI * r * r, y: cy }
	const d = r - h // the chord's distance below the centre (negative: above it)
	const theta = 2 * Math.atan2(Math.sqrt(Math.max(0, r * r - d * d)), d) // (acos(d / r), from the engine's own atan2: the same bits everywhere)
	const area = (r * r * (theta - Math.sin(theta))) / 2
	const s = Math.sin(theta / 2)
	const c = (4 * r * s * s * s) / (3 * (theta - Math.sin(theta))) // the segment's centroid from the centre, toward the segment
	return { area, y: cy - c }
}

// ---------------------------------------------------------------- the run's state and events, as the track carries them

/** Steps between the copies of a series (`ProcessContext.series`): 4, 120 a second. */
const SERIES_EVERY = 4

/** Readings recorded at every step: one row of values per step, a column per (item, key), in the order they were first set. */
export class Readings {
	readonly columns: { item: string; key: string }[] = []
	readonly index = new Map<string, number>()
	now: number[] = []
	readonly rows: number[][] = []
	readonly events: { t: number; items: readonly string[]; text: string; kind?: string }[] = []
	set(item: string, key: string, value: number) {
		const k = `${item}\u0000${key}`
		let i = this.index.get(k)
		if (i === undefined) {
			i = this.columns.length
			this.columns.push({ item, key })
			this.index.set(k, i)
		}
		this.now[i] = value
	}
	get(item: string, key: string) {
		const i = this.index.get(`${item}\u0000${key}`)
		return i === undefined ? undefined : this.now[i]
	}
	record() {
		this.rows.push(this.now.slice())
		// (series: a copy every SERIES_EVERY steps, from step 0)
		if (this.lists.size > 0 && this.rows.length % SERIES_EVERY === 1) {
			const snap = new Map<string, number[]>()
			for (const [k, v] of this.lists) snap.set(k, v.slice())
			this.listRows[(this.rows.length - 1) / SERIES_EVERY] = snap
		}
	}
	/** Keyframes set with `keyframe`, by "item\u0000key": rows [t, ...values] in time order. */
	readonly keyframes = new Map<string, number[][]>()
	setKeyframe(item: string, key: string, t: number, values: readonly number[]) {
		const k = `${item}\u0000${key}`
		let rows = this.keyframes.get(k)
		if (rows === undefined) {
			rows = []
			this.keyframes.set(k, rows)
		}
		const row = [t, ...values]
		if (rows.length > 0 && (rows[rows.length - 1] as number[])[0] === t) rows[rows.length - 1] = row
		else rows.push(row)
	}
	/** The keyframes: {item: {key: [[t, ...values]]}}. */
	keyframeRows(): Record<string, Record<string, number[][]>> {
		const out: Record<string, Record<string, number[][]>> = {}
		for (const [k, rows] of this.keyframes) {
			const [item, key] = k.split("\u0000") as [string, string]
			;(out[item] ??= {})[key] = rows
		}
		return out
	}
	/** Lists set with `series` (current values), by "item\u0000key", and their copies every SERIES_EVERY steps. */
	readonly lists = new Map<string, number[]>()
	readonly listRows: Map<string, number[]>[] = []
	setList(item: string, key: string, values: readonly number[]) {
		this.lists.set(`${item}\u0000${key}`, values.slice())
	}
	/** The lists for the frames shown at these steps: {item: {key: [list per frame]}} (each frame the copy nearest its step). */
	listSeries(steps: readonly number[]): Record<string, Record<string, number[][]>> {
		const out: Record<string, Record<string, number[][]>> = {}
		const n = this.listRows.length
		for (const k of this.lists.keys()) {
			const [item, key] = k.split("\u0000") as [string, string]
			let first: number[] = []
			for (const row of this.listRows) {
				const v = row?.get(k)
				if (v !== undefined) {
					first = v
					break
				}
			}
			;(out[item] ??= {})[key] = steps.map((s) => this.listRows[Math.min(n - 1, Math.max(0, Math.round(s / SERIES_EVERY)))]?.get(k) ?? first)
		}
		return out
	}
	/** The per-frame series for the frames shown at these steps: {item: {key: [value per frame]}} (a column set later starts at its first value). */
	series(steps: readonly number[]): Record<string, Record<string, number[]>> {
		const out: Record<string, Record<string, number[]>> = {}
		this.columns.forEach(({ item, key }, i) => {
			let first = 0
			for (const row of this.rows) {
				const v = row[i]
				if (v !== undefined) {
					first = v
					break
				}
			}
			const values = steps.map((s) => this.rows[s]?.[i] ?? first)
			;(out[item] ??= {})[key] = values
		})
		return out
	}
}

/**
 * What the workers add to the slimmed track (research/poc/worker.ts and tools/engine-worker-entry.ts call this alike): `state` and
 * `events` when the run made any, numbers rounded as the placements are (`round(v, 5)`; t to 6). Nothing at all when it made none, so a
 * plain scene's track is byte for byte what it was.
 */
export const slimExtras = (
	track: {
		readonly state?: Record<string, Record<string, readonly number[]>>
		readonly events?: readonly { t: number; items: readonly string[]; text: string; kind?: string }[]
		readonly series?: Record<string, Record<string, readonly (readonly number[])[]>>
		readonly keyframes?: Record<string, Record<string, readonly (readonly number[])[]>>
	},
	round: (v: number, d: number) => number
): {
	state?: Record<string, Record<string, number[]>>
	events?: { t: number; items: string[]; text: string; kind?: string }[]
	series?: Record<string, Record<string, number[][]>>
	keyframes?: Record<string, Record<string, number[][]>>
} => {
	const out: {
		state?: Record<string, Record<string, number[]>>
		events?: { t: number; items: string[]; text: string; kind?: string }[]
		series?: Record<string, Record<string, number[][]>>
		keyframes?: Record<string, Record<string, number[][]>>
	} = {}
	if (track.state !== undefined && Object.keys(track.state).length > 0) {
		const state: Record<string, Record<string, number[]>> = {}
		for (const item of Object.keys(track.state)) {
			const keys = track.state[item] as Record<string, readonly number[]>
			const o: Record<string, number[]> = {}
			for (const key of Object.keys(keys)) o[key] = (keys[key] as readonly number[]).map((v) => round(v, 5))
			state[item] = o
		}
		out.state = state
	}
	if (track.events !== undefined && track.events.length > 0)
		out.events = track.events.map((e) => ({ t: round(e.t, 6), items: [...e.items], text: e.text, ...(e.kind === undefined ? {} : { kind: e.kind }) }))
	if (track.series !== undefined && Object.keys(track.series).length > 0) {
		const series: Record<string, Record<string, number[][]>> = {}
		for (const item of Object.keys(track.series)) {
			const keys = track.series[item] as Record<string, readonly (readonly number[])[]>
			const o: Record<string, number[][]> = {}
			for (const key of Object.keys(keys)) o[key] = (keys[key] as readonly (readonly number[])[]).map((list) => list.map((v) => round(v, 5)))
			series[item] = o
		}
		out.series = series
	}
	if (track.keyframes !== undefined && Object.keys(track.keyframes).length > 0) {
		const keyframes: Record<string, Record<string, number[][]>> = {}
		for (const item of Object.keys(track.keyframes)) {
			const keys = track.keyframes[item] as Record<string, readonly (readonly number[])[]>
			const o: Record<string, number[][]> = {}
			for (const key of Object.keys(keys)) o[key] = (keys[key] as readonly (readonly number[])[]).map((row) => row.map((v, i) => round(v, i === 0 ? 6 : 5)))
			keyframes[item] = o
		}
		out.keyframes = keyframes
	}
	return out
}

// ---------------------------------------------------------------- the runner physics.ts drives

/** What physics.ts gives the processes of one run (its bodies through handles, its contacts, its air, its clock). */
export interface EngineAccess {
	readonly step: number
	solid(id: string): SolidHandle | undefined
	solidsOf(item: string): readonly SolidHandle[]
	all(): readonly SolidHandle[]
	touching(id: string): readonly string[]
	air(p: Point): Point
	time(): number
	released(): boolean
	/** The engine's internals (EngineInternals), when the engine offers them. */
	engine?: EngineInternals
}

/** The volume of a solid below a level, from its outline (see ProcessContext.submerged). */
export const submergedOf = (h: SolidHandle, level: number): { volume: number; x: number; y: number } => {
	const o = h.outline()
	const part = h.part
	if (o.circle !== undefined) {
		const { x, y, r } = o.circle
		if (part.shape === "cylinder" && part.length !== undefined) {
			const c = circleBelow(r, y, level)
			return { volume: c.area * part.length, x, y: c.y }
		}
		const s = sphereBelow(r, y, level)
		return { volume: s.volume, x, y: s.y }
	}
	const pts = clipBelow(o.points ?? [], level)
	if (pts.length < 3) return { volume: 0, x: 0, y: level }
	const a = areaAndCentroid(pts)
	const depth = part.body.kind === "ball" ? 0 : part.body.depth
	return { volume: Math.abs(a.area) * depth, x: a.x, y: a.y }
}

/** The processes of one run, in document order, with their contexts and the readings they set. */
export class ProcessRunner {
	readonly readings = new Readings()
	private readonly running: { ctx: ProcessContext; proc: Process; coarse: number }[] = []
	readonly scene: SimScene<string>
	readonly settings: RunSettings
	readonly access: EngineAccess
	constructor(scene: SimScene<string>, settings: RunSettings, records: readonly ProcessRecord[], access: EngineAccess) {
		this.scene = scene
		this.settings = settings
		this.access = access
		for (const record of records) {
			const kind = processKind(record.kind)
			if (kind === undefined) throw new Error(`process ${record.id}: no process kind "${record.kind}"`)
			const ctx = this.contextFor(record)
			const proc = kind.create(record, ctx)
			const coarse = Math.max(1, Math.round(proc.coarse ?? 48))
			this.running.push({ ctx, proc, coarse })
			if (proc.watchesForces === true) this.forceLog ??= { pushes: [], reports: [], wrapped: new Map(), lists: new Map() }
		}
	}
	/** This (sub-)step's pushes and reports, while a process watches forces (Process.watchesForces); undefined in a run where none does. */
	private forceLog: { pushes: ForceRecord[]; reports: ForceRecord[]; wrapped: Map<string, Map<string, SolidHandle>>; lists: Map<string, readonly SolidHandle[]> } | undefined
	/** A handle whose pushes are listed (under the process kind `by`), while a process watches forces; the handle itself otherwise. */
	private logged(h: SolidHandle | undefined, by: string): SolidHandle | undefined {
		const log = this.forceLog
		if (h === undefined || log === undefined) return h
		let mine = log.wrapped.get(by)
		if (mine === undefined) {
			mine = new Map()
			log.wrapped.set(by, mine)
		}
		let w = mine.get(h.id)
		if (w === undefined) {
			const handle = h
			const pushes = log.pushes
			w = Object.create(handle) as SolidHandle
			;(w as { push: SolidHandle["push"] }).push = (fx, fy, at) => {
				pushes.push({ solid: handle.id, kind: by, by, fx, fy, ...(at === undefined ? {} : { at: { x: at.x, y: at.y } }) })
				handle.push(fx, fy, at)
			}
			mine.set(h.id, w)
		}
		return w
	}
	/**
	 * An item's handles (or every solid's, item null) with their pushes listed, made once for each process kind: a run's solids are the same
	 * all through it (a resized one keeps its handle), so the list is too.
	 */
	private loggedList(item: string | null, by: string): readonly SolidHandle[] {
		const log = this.forceLog
		const list = () => (item === null ? this.access.all() : this.access.solidsOf(item))
		if (log === undefined) return list()
		const key = `${by}\u0000${item ?? "\u0001"}`
		let out = log.lists.get(key)
		if (out === undefined) {
			out = list().map((h) => this.logged(h, by) as SolidHandle)
			log.lists.set(key, out)
		}
		// (a copy, as the engine's own lists are: a module may sort or cut what it is given)
		return out.slice()
	}
	private contextFor(record: ProcessRecord): ProcessContext {
		const { access, settings, readings } = this
		return {
			scene: this.scene,
			settings,
			record,
			step: access.step,
			time: () => access.time(),
			slowTime: () => access.time() * settings.timeLapse,
			released: () => access.released(),
			solid: (id) => (this.forceLog === undefined ? access.solid(id) : this.logged(access.solid(id), record.kind)),
			solidsOf: (item) => (this.forceLog === undefined ? access.solidsOf(item) : this.loggedList(item, record.kind)),
			all: () => (this.forceLog === undefined ? access.all() : this.loggedList(null, record.kind)),
			touching: (id) => access.touching(id),
			air: (p) => (settings.air ? access.air(p) : { x: 0, y: 0 }),
			submerged: (id, level) => {
				const h = access.solid(id)
				return h === undefined ? { volume: 0, x: 0, y: level } : submergedOf(h, level)
			},
			set: (item, key, value) => readings.set(item, key, value),
			series: (item, key, values) => readings.setList(item, key, values),
			keyframe: (item, key, values) => readings.setKeyframe(item, key, access.time(), values),
			get: (item, key) => readings.get(item, key),
			event: (text, items, kind, at) =>
				readings.events.push({ t: at !== undefined && Number.isFinite(at) && at < access.time() ? at : access.time(), items: [...items], text, ...(kind === undefined ? {} : { kind }) }),
			engine: () => access.engine,
			reportForce: (solid, kind, fx, fy, at) => {
				if (this.forceLog === undefined || !Number.isFinite(fx) || !Number.isFinite(fy)) return
				this.forceLog.reports.push({ solid, kind, by: record.kind, fx, fy, ...(at === undefined ? {} : { at: { x: at.x, y: at.y } }) })
			},
			forces: () => {
				const log = this.forceLog
				if (log === undefined) return []
				if (log.reports.length === 0) return log.pushes
				// (a process that reported stands for its own pushes)
				const reporting = new Set(log.reports.map((r) => r.by))
				return [...log.pushes.filter((p) => !reporting.has(p.by)), ...log.reports]
			}
		}
	}
	start() {
		for (const { ctx, proc } of this.running) proc.start?.(ctx)
	}
	/** Every step from t = 0 (stepIndex counts them): each process's `step`, and its `slow` on its coarse beat. */
	step(stepIndex: number) {
		for (const { ctx, proc, coarse } of this.running) {
			proc.step?.(ctx)
			if (proc.slow !== undefined && stepIndex % coarse === 0) proc.slow(ctx, coarse * this.access.step * this.settings.timeLapse)
		}
	}
	/** Every (sub-)step after the release, before the world is stepped. */
	force(h: number) {
		if (this.forceLog !== undefined) {
			this.forceLog.pushes.length = 0
			this.forceLog.reports.length = 0
		}
		for (const { ctx, proc } of this.running) proc.force?.(ctx, h)
	}
	/** After every (sub-)step, once the world has been stepped. */
	after(h: number) {
		for (const { ctx, proc } of this.running) proc.after?.(ctx, h)
	}
	/** A contact as the engine meets it (Process.contact): true when any process asks the engine to leave it (see there). */
	contact(touch: unknown, phase: "begin" | "pre") {
		let leave = false
		for (const { ctx, proc } of this.running) if (proc.contact !== undefined && proc.contact(ctx, touch, phase)) leave = true
		return leave
	}
	record() {
		this.readings.record()
	}
	end() {
		for (const { ctx, proc } of this.running) proc.end?.(ctx)
	}
	/** The track's additions for the frames shown at these steps: {state?, events?}. */
	extras(steps: readonly number[]) {
		const out: {
			state?: Record<string, Record<string, number[]>>
			events?: { t: number; items: readonly string[]; text: string; kind?: string }[]
			series?: Record<string, Record<string, number[][]>>
			keyframes?: Record<string, Record<string, number[][]>>
		} = {}
		if (this.readings.columns.length > 0) out.state = this.readings.series(steps)
		// (in time order: a back-dated event goes before later ones; stable, so events said at one moment keep their order)
		if (this.readings.events.length > 0) out.events = this.readings.events.map((e, i) => [e, i] as const).sort((a, b) => a[0].t - b[0].t || a[1] - b[1]).map(([e]) => e)
		if (this.readings.lists.size > 0) out.series = this.readings.listSeries(steps)
		if (this.readings.keyframes.size > 0) out.keyframes = this.readings.keyframeRows()
		return out
	}
}
