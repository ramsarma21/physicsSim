/**
 * The fracture module's engine processes (machines/mod_fracture.py and web/sim/modules/fracture.js build their records). Things that break
 * when a force passes a real threshold, padding that absorbs an impact, beams that snap under load, glued joints that let go, parachutes.
 * The physics of each check is tooling/src/sim/fracture.ts (pure, tested); this file wires it into the run (plugins.ts).
 *
 *   fracture-soft    {soft: {solid id: law}}   every padding solid of the scene with its compression law (the build hook writes it once,
 *                    only when the scene has a breakable): what a breakable that hits it squashes; and other modules' soft things with their
 *                    own force laws (fracture.ts laws 5-8: the softbody module's inflated, foam and clay balls, a trampoline's sprung mat, any
 *                    solid given a `contact_law`), in series the same way. A sprung mat is a light membrane: what lands on it is slowed by its
 *                    own mass against the mat's springs (it counts as held). No process of its own.
 *   fracture-brittle {solid, mode: "free" | "boxed", name, noun, verb, mass, limit (N), k (N/m), radius | area, smash, scatter, pieces, masses, puddle,
 *                    box?, boxk?, boxarea?, pad?, padt?}
 *        A breakable thing (a raw egg, a drinking glass, a plate). Every 480 Hz (sub-)step after the release it feels (1) each new impact on it
 *        (the contact's normal approach speed v, as the engine measures impacts): the peak force through its own stiffness k and any padding
 *        between (fracture.ts peakForce; the effective mass is its own on a fixed thing, the striker's when something hits it while it is
 *        pressed against a fixed or heavier thing, else the pair's reduced mass); (2) the steady loads on it: each contact's force from its
 *        solved impulses (contacts older than 4 steps, so an impact's own impulse is not counted twice), the largest, smoothed over 30 ms.
 *        A hard brittle thing hit by another (both records carry `edge`: a glass on a glass, a rim on a rim) breaks at edge × limit
 *        (machines/mod_fracture.py [EDGE]); a fixed one (a pane in its frame) meets the striker's own mass, and its pieces fly on with the hit.
 *        When the larger reaches `limit` it breaks: share = force / limit; at share ≥ smash (an egg: 2) or for a thing that shatters (smash 1)
 *        its body is replaced by its pieces (doc solids parked inside it from the start: resized to nothing, following it, colliding with
 *        nothing), each moving as that part of it moved, scattered a little (scatter × the impact speed, outward, deterministically); an egg
 *        hit less hard only cracks (it stays whole; broken = 1) and a later force over half its limit smashes it. The puddle piece (an egg's
 *        insides) is laid flat on the surface it broke against.
 *        "boxed": an egg inside an egg-drop box (the box's weld group). An impact on the box at v: the box's own peak force F_box (its mass M,
 *        its stiffness boxk, the padding of what it lands on over its bottom's area) and the egg's against the box through its padding
 *        F_pad (its law, padt thick, around the egg); the egg feels F = min(F_pad, m_egg/M · F_box) (riding with a box that is slowed gently,
 *        it is pressed only by its share of the box's deceleration). It cracks (stays inside) at share ≥ 1; smashed at ≥ smash.
 *        Readings: broken (0 whole, 1 cracked, 2 in pieces), peak_force (N, the largest so far), share (that over limit), impact_speed (m/s,
 *        the hardest hit). The padding it squashed gets a reading `squash` (m, the most, relaxing back over 0.15 s) on that padding's item.
 *   fracture-beam    {solid, name, noun, pieces: [[id, dx, mass]], length, ei (N·m²), mc (N·m), per_m (kg/m), supports: [s_lo, s_hi], three}
 *        A beam on supports (a spaghetti bridge): the contact forces on it (as above, smoothed over 40 ms) give the bending moment at the five
 *        joints between its six pieces (fracture.ts bendingMoment); a thing dropped on its span adds the dynamic moment of the impact
 *        (fracture.ts beamImpact). At |M| ≥ mc it snaps at that joint: the pieces on each side are welded into one rigid fragment (a spaghetti
 *        beam, `three`, also snaps its longer side in two: dry spaghetti breaks in three or more, Audoly & Neukirch, PRL 95, 095505, 2005).
 *        Readings: broken (0/2), load (N, what presses down on it besides its supports, smoothed), share (the largest |M| / mc), sag (m, the
 *        span's sag under that moment, drawn by the view).
 *   fracture-glue    {name, glue, blocks: [ids], w, d, h (m), sigma, tau (Pa)}   a tower: glued (glue not "none"), each block is welded to the next
 *        (planck WeldJoint at the middle of their shared face, made at the start); after each step a weld's reaction (averaged over two steps)
 *        gives the glue's tension and shear (fracture.ts glueShare); at share ≥ 1 that weld is gone. A block has FALLEN once it is more than
 *        half a block lower than it was stacked, or turned more than 35° (a block that only slides along still stands); the tower comes apart
 *        (broken 1) when a weld lets go or (loose) a block falls; it is knocked down (an event) once half its blocks have fallen or it stands
 *        less than half as tall as it was built (a glued tower tipping over in one piece too: it has not come apart). Readings: broken (0/1), blocks_fallen (how many have fallen now), top_height (m, its
 *        highest block's top over where its bottom block stood), share (the glue's, the largest so far).
 *   fracture-chute   {solid, area (m²), cd, lift (m), jars?}   a parachute on a solid: drag ½·ρ·C_d·A·|u|·u against its velocity u relative to
 *        the air (fans blow it), applied where its lines meet, `lift` above the solid's origin; nothing in a vacuum (settings.air false); inside
 *        one of the air module's vacuum jars (`jars`: their insides, the jar item whose `pressure_kpa` reading it reads) ρ is the room's × the
 *        jar's pressure over 101.325 kPa (the same temperature: ρ ∝ p).
 * Deterministic: + − × ÷, Math.sqrt / abs / min / max / floor and the engine's sin, cos, atan2, hypot.
 */
import { Vec2, WeldJoint } from "planck"
import { type BeamForce, Padding, beamImpact, glueShare, peakForce, sagOf, sequence, seedOf, supportedMoment } from "#sim/fracture.ts"
import type { EngineInternals, Point, ProcessContext, ProcessKind, ProcessRecord, SolidHandle } from "#sim/plugins.ts"

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d)
const str = (v: unknown) => (typeof v === "string" ? v : null)
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [])
/** The air's density at 20 °C, kg/m³ (the engine's own: physics.ts airDensity). */
const RHO_AIR = 1.204
/** The room's air pressure, Pa (the air module's: air.ts ATM). */
const ATM = 101325
/** Steps a contact must have lasted before its force counts as a steady load (an impact's own impulse is the impact check's). */
const SETTLED = 4
const STATIC_TAU = 0.03
const BEAM_TAU = 0.04
const SQUASH_RELAX = 0.15

// ---------------------------------------------------------------- planck access (EngineInternals)
interface PVec {
	x: number
	y: number
}
interface PBody {
	getContactList(): PEdge | null
	getPosition(): PVec
	getAngle(): number
	getMass(): number
	isDynamic(): boolean
	getWorldCenter(): PVec
	getLinearVelocity(): PVec
	getAngularVelocity(): number
	getLinearVelocityFromWorldPoint(p: PVec): PVec
	setTransform(p: PVec, a: number): void
	setLinearVelocity(v: PVec): void
	setAngularVelocity(w: number): void
	setGravityScale(s: number): void
	setAwake(a: boolean): void
}
interface PFixture {
	getUserData(): unknown
	getBody(): PBody
}
interface PContact {
	getFixtureA(): PFixture
	getFixtureB(): PFixture
	isTouching(): boolean
	getManifold(): { pointCount: number; points: { normalImpulse: number }[] }
	getWorldManifold(x: null): { normal: PVec; points: PVec[]; pointCount: number } | undefined
}
interface PEdge {
	contact: PContact
	next: PEdge | null
}
interface PFix {
	getNext(): PFix | null
	getDensity(): number
	setDensity(d: number): void
}
interface PJoint {
	getReactionForce(invDt: number): PVec
	getReactionTorque(invDt: number): number
}

const solidOfFixture = (eng: EngineInternals, f: PFixture) => eng.solidOf(f.getUserData())?.id

/** The normal approach speed of a contact that has just begun (m/s; as physics.ts measures an impact) and its normal, from A to B. */
const approachOf = (eng: EngineInternals, c: PContact) => {
	const wm = c.getWorldManifold(null)
	if (wm === undefined || wm === null) return null
	const A = c.getFixtureA().getBody()
	const B = c.getFixtureB().getBody()
	let speed = 0
	let px = 0
	let py = 0
	let n = 0
	for (let i = 0; i < wm.pointCount; i++) {
		const p = wm.points[i]
		if (p === undefined) continue
		const va = A.getLinearVelocityFromWorldPoint(p)
		const vb = B.getLinearVelocityFromWorldPoint(p)
		speed = Math.max(speed, -((vb.x - va.x) * wm.normal.x + (vb.y - va.y) * wm.normal.y) / eng.lengthScale)
		px += p.x
		py += p.y
		n++
	}
	if (n === 0) return null
	return { speed, nx: wm.normal.x, ny: wm.normal.y, x: px / n / eng.lengthScale, y: py / n / eng.lengthScale }
}

/** The padding laws of this run's soft solids (the fracture-soft record). */
const softOf = (ctx: ProcessContext): Map<string, readonly number[]> => {
	const out = new Map<string, readonly number[]>()
	for (const r of ctx.scene.processes ?? []) {
		if (r.kind !== "fracture-soft") continue
		const soft = r.soft as Record<string, unknown> | undefined
		if (soft === undefined || soft === null || typeof soft !== "object") continue
		for (const [id, law] of Object.entries(soft)) if (Array.isArray(law) && law.every((v) => typeof v === "number")) out.set(id, law as number[])
	}
	return out
}
/** The breakables' own stiffnesses in this run, by solid (one breakable meeting another: both springs in series), and their `edge` (0: none). */
const stiffOf = (ctx: ProcessContext): Map<string, { k: number; edge: number }> => {
	const out = new Map<string, { k: number; edge: number }>()
	for (const r of ctx.scene.processes ?? []) if (r.kind === "fracture-brittle" && typeof r.solid === "string") out.set(r.solid, { k: num(r.k, 0), edge: num(r.edge, 0) })
	return out
}

/** A solid's extent along a unit direction (its thickness that way), m. */
const thicknessAlong = (h: SolidHandle, nx: number, ny: number) => {
	const o = h.outline()
	if (o.circle !== undefined) return 2 * o.circle.r
	let lo = Infinity
	let hi = -Infinity
	for (const p of o.points ?? []) {
		const d = p.x * nx + p.y * ny
		if (d < lo) lo = d
		if (d > hi) hi = d
	}
	return hi > lo ? hi - lo : 0
}

/** Whether a solid is held against a hit from `from`: it touches a fixed solid, or one far heavier than the striker (not `from`, not `skip`). */
const heldBy = (ctx: ProcessContext, id: string, from: string, skip: ReadonlySet<string>, striker: number) => {
	for (const t of ctx.touching(id)) {
		if (t === from || skip.has(t)) continue
		const th = ctx.solid(t)
		if (th === undefined) continue
		if (!th.dynamic || th.body().mass >= 20 * striker) return true
	}
	return false
}

/** Pieces parked inside a whole thing: resized to nothing, weightless, following it; let go when it breaks. */
class Parked {
	readonly ids: readonly string[]
	readonly offsets: readonly Point[]
	parked = true
	constructor(ids: readonly string[], offsets: readonly Point[]) {
		this.ids = ids
		this.offsets = offsets
	}
	park(ctx: ProcessContext) {
		for (const id of this.ids) ctx.solid(id)?.resize(0)
	}
	follow(ctx: ProcessContext, eng: EngineInternals, whole: SolidHandle) {
		if (!this.parked) return
		const q = whole.pose()
		const c = Math.cos(q.angle)
		const s = Math.sin(q.angle)
		this.ids.forEach((id, i) => {
			const b = eng.bodyOf(id) as PBody | undefined
			if (b === undefined || b === null) return
			const o = this.offsets[i] ?? { x: 0, y: 0 }
			const L = eng.lengthScale
			b.setTransform(new Vec2((q.x + o.x * c - o.y * s) * L, (q.y + o.x * s + o.y * c) * L), q.angle)
			b.setLinearVelocity(new Vec2(0, 0))
			b.setAngularVelocity(0)
		})
		void ctx
	}
	has(id: string) {
		return this.ids.includes(id)
	}
}

/** Takes a whole solid out of the run: resized to nothing (it touches nothing), weightless and still. */
const remove = (eng: EngineInternals, h: SolidHandle) => {
	h.resize(0)
	const b = eng.bodyOf(h.id) as PBody | undefined
	if (b === undefined || b === null) return
	b.setGravityScale(0)
	b.setLinearVelocity(new Vec2(0, 0))
	b.setAngularVelocity(0)
}

/**
 * Lets a parked piece go at pose (x, y, angle) with velocity (vx, vy) and spin w, weighing `mass` kg: parked, the document gives it next to no
 * density (so what adds up the document's moving solids counts the whole thing once); here its fixture's density and its part's material are
 * scaled so its mass is its share of the whole's (its inertia with it).
 */
const release = (eng: EngineInternals, h: SolidHandle, x: number, y: number, angle: number, vx: number, vy: number, w: number, mass: number) => {
	const b = eng.bodyOf(h.id) as (PBody & { getFixtureList(): PFix | null; resetMassData(): void }) | undefined
	if (b === undefined || b === null) return
	const L = eng.lengthScale
	b.setTransform(new Vec2(x * L, y * L), angle)
	h.resize(1)
	const now = h.mass()
	if (mass > 0 && now > 0) {
		const k = mass / now
		for (let f = b.getFixtureList(); f !== null; f = f.getNext()) f.setDensity(f.getDensity() * k)
		b.resetMassData()
		const part = h.part as { material: { density: number } }
		part.material = { ...part.material, density: part.material.density * k }
	}
	b.setGravityScale(1)
	b.setLinearVelocity(new Vec2(vx * L, vy * L))
	b.setAngularVelocity(w)
	b.setAwake(true)
}

/** A solid's outline centroid in its own frame (a polygon's area centroid, a slab's or ball's origin). */
const ownCentroid = (h: SolidHandle): Point => {
	const b = h.part.body
	if (b.kind !== "polygon") return { x: 0, y: 0 }
	let a = 0
	let cx = 0
	let cy = 0
	const n = b.points.length
	for (let i = 0; i < n; i++) {
		const p = b.points[i] as Point
		const q = b.points[(i + 1) % n] as Point
		const k = p.x * q.y - q.x * p.y
		a += k
		cx += (p.x + q.x) * k
		cy += (p.y + q.y) * k
	}
	return Math.abs(a) < 1e-15 ? { x: 0, y: 0 } : { x: cx / (3 * a), y: cy / (3 * a) }
}

const f2 = (v: number) => v.toFixed(2)
const trimN = (v: number) => v.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")
const fN = (v: number) => (v >= 100 ? v.toFixed(0) : v.toFixed(1))
const Cap = (s: string) => (s.length ? s[0]!.toUpperCase() + s.slice(1) : s)

// ---------------------------------------------------------------- the soft table (data only)
const soft: ProcessKind = {
	kind: "fracture-soft",
	check: (r) => (r.soft !== null && typeof r.soft === "object" ? undefined : "it needs a soft table"),
	create: () => ({})
}

// ---------------------------------------------------------------- breakable things
interface Hit {
	other: string
	speed: number
	/** The normal from the other into this one. */
	nx: number
	ny: number
	x: number
	y: number
	/** The other's body's mass, whether it moves and whether it is held, as the contact began (a thing broken by the same hit, and so gone
	 *  by the time this one is worked out, still struck with them). */
	mo?: number
	oMoves?: boolean
	oHeld?: boolean
	/** Worked out as the contact began: a hit that breaks a held breakable into pieces, which the striker then goes on through. */
	pre?: { force: number; squash: [string, number][]; need: number; mEff: number; stored: (F: number) => number }
	pass?: boolean
}

const brittle: ProcessKind = {
	kind: "fracture-brittle",
	check: (r, solids) => {
		if (typeof r.solid !== "string" || !solids.has(r.solid)) return "its solid is not in the document"
		for (const id of ids(r.pieces)) if (!solids.has(id)) return `its piece ${id} is not in the document`
		if (r.mode === "boxed" && (typeof r.box !== "string" || !solids.has(r.box))) return "its box is not in the document"
		return undefined
	},
	create(r: ProcessRecord) {
		const item = r.item as string
		const solid = r.solid as string
		const boxed = r.mode === "boxed"
		const box = str(r.box)
		const name = str(r.name) ?? item
		const noun = str(r.noun) ?? "it"
		const verb = str(r.verb) ?? "breaks"
		const limit = num(r.limit, 35)
		const k = num(r.k, 21500)
		const radius = num(r.radius, 0)
		const area = num(r.area, 0)
		const smash = num(r.smash, 1)
		const scatter = num(r.scatter, 0.1)
		const foot = area > 0 ? { area } : { radius: radius > 0 ? radius : 0.02 }
		const pieceIds = ids(r.pieces)
		const pieceMass = (Array.isArray(r.masses) ? (r.masses as unknown[]) : []).map((v) => num(v, 0))
		const puddle = str(r.puddle)
		const parked = new Parked(pieceIds, pieceIds.map(() => ({ x: 0, y: 0 })))
		const padLaw = Array.isArray(r.pad) ? (r.pad as number[]) : null
		const padT = num(r.padt, 0)
		const boxK = num(r.boxk, 50000)
		const boxArea = num(r.boxarea, 0.01)
		const edge = num(r.edge, 0)
		let softs = new Map<string, readonly number[]>()
		let stiff = new Map<string, { k: number; edge: number }>()
		let eng: EngineInternals | undefined
		let broken = 0
		let peak = 0
		let hardest = 0
		let shareMax = 0
		let steady = 0
		let steps = 0
		const ages = new Map<unknown, number>()
		const pending: Hit[] = []
		const through = new Set<unknown>()
		/** A striker that went on through: its pieces let it pass for a moment (it punches through; the shards in its path are pushed aside). */
		let ghost: { id: string; until: number } | null = null
		const squashed = new Map<string, { item: string; v: number }>()
		const watched = new Set<string>()
		const mine = new Set<string>([solid, ...pieceIds])
		const rnd = sequence(seedOf(item))

		const set = (ctx: ProcessContext) => {
			ctx.set(item, "broken", broken)
			ctx.set(item, "peak_force", peak)
			ctx.set(item, "share", shareMax)
			ctx.set(item, "impact_speed", hardest)
		}
		/** The peak force of one hit on this thing (and the padding squashed, by solid), and the share of its breaking force such a hit needs. */
		const hitForce = (ctx: ProcessContext, h: Hit): { force: number; squash: [string, number][]; need: number; mEff: number; stored: (F: number) => number } => {
			const other = ctx.solid(h.other)
			const me = ctx.solid(solid)
			if (other === undefined || me === undefined) return { force: 0, squash: [], need: 1, mEff: 0, stored: () => 0 }
			const law = softs.get(h.other)
			// (a trampoline's mat: a light membrane on springs, held by them against this hit: what lands on it is slowed by its own mass)
			const sprung = law !== undefined && law[0] === 8
			const otherBody = other.body()
			// (the other broke in this same hit and is gone: it struck as it was when the contact began)
			const gone = other.scale() < 0.01 && h.mo !== undefined
			const otherMoves = gone ? h.oMoves === true : other.dynamic && otherBody.mass > 0
			const otherMass = gone ? (h.mo as number) : otherBody.mass
			if (boxed && box !== null) {
				const boxH = ctx.solid(box)
				const M = boxH === undefined ? 1 : boxH.body().mass
				const mEgg = me.mass()
				const mBox = otherMoves && !sprung && !(gone ? h.oHeld === true : heldBy(ctx, h.other, solid, watched, M)) ? (M * otherMass) / (M + otherMass) : M
				const groundPads = law === undefined ? [] : [new Padding(law, thicknessAlong(other, h.nx, h.ny), { area: boxArea })]
				const ground = peakForce(mBox, h.speed, boxK, groundPads)
				const padPads = padLaw !== null && padT > 0 ? [new Padding(padLaw, padT, foot)] : []
				const pad = peakForce(mEgg, h.speed, k, padPads)
				const share = M > 0 ? (mEgg / M) * ground.force : ground.force
				return { force: Math.min(pad.force, share), squash: law === undefined ? [] : [[h.other, ground.squash[0] ?? 0]], need: 1, mEff: mEgg, stored: () => 0 }
			}
			const m = me.mass()
			let mEff = m
			if (!me.dynamic) {
				// (a fixed breakable, a pane in its frame: the striker's own mass squeezes it)
				mEff = otherMoves ? otherMass : 0
			} else if (otherMoves) {
				// (who is held by what: a thing resting on something fixed is as good as fixed against this hit, so the moving one's mass is
				// what squeezes the pair; two free things meet with their reduced mass)
				const mo = otherMass
				const meHeld = heldBy(ctx, solid, h.other, mine, mo)
				const otherHeld = sprung || (gone ? h.oHeld === true : heldBy(ctx, h.other, solid, mine, m))
				mEff = otherHeld && !meHeld ? m : meHeld && !otherHeld ? mo : (m * mo) / (m + mo)
			}
			const ko = stiff.get(h.other)
			const kEff = ko !== undefined && ko.k > 0 ? (k * ko.k) / (k + ko.k) : k
			const pads = law === undefined ? [] : [new Padding(law, thicknessAlong(other, h.nx, h.ny), foot)]
			const r2 = peakForce(mEff, h.speed, kEff, pads)
			// (hard on hard, a rim on a rim: it breaks at `edge` of its breaking force)
			const need = edge > 0 && ko !== undefined && ko.edge > 0 ? edge : 1
			// (the energy the hit has put into the springs and padding by the time the force is F: what a striker that goes on through has spent)
			const stored = (F: number) => {
				let e = (F * F) / (2 * kEff)
				for (const p of pads) e += p.at(F).w
				return e
			}
			return { force: r2.force, squash: law === undefined ? [] : [[h.other, r2.squash[0] ?? 0]], need, mEff, stored }
		}
		/** It breaks now: cracked, or in pieces. */
		const breakNow = (ctx: ProcessContext, force: number, hit: Hit | null, need = 1) => {
			if (eng === undefined) return
			const share = limit > 0 ? force / (limit * need) : 0
			const was = broken
			const pieces = !boxed && pieceIds.length > 0 && (share >= smash || was >= 1)
			broken = was >= 1 || share >= smash ? 2 : 1
			const by = hit === null ? undefined : ctx.solid(hit.other)
			const what = by === undefined ? "" : by.part.words
			const when = `at ${f2(ctx.time())} s`
			const how =
				hit === null
					? `under a steady ${fN(force)} N`
					: `hitting ${what || "something"} at ${f2(hit.speed)} m/s (${fN(force)} N)`
			const which = broken === 2 ? (boxed ? "smashes" : verb) : "cracks"
			const again = was >= 1 ? " (already cracked)" : ""
			const edgeWords = need < 1 ? ` (${trimN(limit * need)} N in a hard edge-on-edge hit like this one)` : ""
			ctx.event(`${name} ${which}${again} ${when}, ${how}; ${noun === "it" ? "it" : `the ${noun}`} breaks at ${trimN(limit)} N${edgeWords}`, [item], broken === 2 ? "breaks" : "cracks")
			if (!pieces) return
			const me = ctx.solid(solid)
			if (me === undefined) return
			const q = me.pose()
			const v = me.velocity()
			const w = me.spin()
			const c = Math.cos(q.angle)
			const s = Math.sin(q.angle)
			const mid = ownCentroid(me)
			const cx = q.x + mid.x * c - mid.y * s
			const cy = q.y + mid.x * s + mid.y * c
			const kick = scatter * (hit === null ? 0.3 : Math.max(0.3, hit.speed))
			parked.parked = false
			remove(eng, me)
			for (const id of pieceIds) {
				const p = ctx.solid(id)
				if (p === undefined) continue
				if (id === puddle) {
					// (an egg's insides: laid flat on what it broke against, under where the egg was, sliding as the egg slid along it)
					const nx = hit === null ? 0 : hit.nx
					const ny = hit === null ? 1 : hit.ny
					const ang = Math.atan2(ny, nx) - Math.PI / 2
					const reach = thicknessAlong(me, nx, ny) / 2
					const half = thicknessAlong(p, -Math.sin(q.angle), Math.cos(q.angle)) / 2
					const along = v.x * -ny + v.y * nx
					release(eng, p, cx - nx * (reach - half - 0.0005), cy - ny * (reach - half - 0.0005), ang, -ny * along * 0.5, nx * along * 0.5, 0, pieceMass[pieceIds.indexOf(id)] ?? 0)
					continue
				}
				const pc = ownCentroid(p)
				const rx = pc.x * c - pc.y * s
				const ry = pc.x * s + pc.y * c
				const dx = q.x + rx - cx
				const dy = q.y + ry - cy
				const d = Math.sqrt(dx * dx + dy * dy)
				const ux = d > 1e-9 ? dx / d : rnd() - 0.5
				const uy = d > 1e-9 ? dy / d : rnd() - 0.5
				const turn = (rnd() - 0.5) * 0.6
				const kx = ux * Math.cos(turn) - uy * Math.sin(turn)
				const ky = ux * Math.sin(turn) + uy * Math.cos(turn)
				const sp = kick * (0.6 + 0.8 * rnd())
				// (a fixed thing's pieces, a pane's shards, fly on the way the striker was going)
				const fwd = hit !== null && (!me.dynamic || hit.pass === true) ? sp * (0.8 + 0.6 * rnd()) : 0
				const fx = hit === null ? 0 : hit.nx * fwd
				const fy = hit === null ? 0 : hit.ny * fwd
				release(eng, p, q.x, q.y, q.angle, v.x - w * (q.y + ry - cy) + kx * sp + fx, v.y + w * (q.x + rx - cx) + ky * sp + fy, w + (rnd() - 0.5) * 12 * kick, pieceMass[pieceIds.indexOf(id)] ?? 0)
			}
		}
		return {
			start(ctx) {
				eng = ctx.engine()
				softs = softOf(ctx)
				stiff = stiffOf(ctx)
				if (boxed && box !== null) for (const h of ctx.all()) if (eng !== undefined && eng.bodyOf(h.id) === eng.bodyOf(box)) watched.add(h.id)
				if (!boxed) watched.add(solid)
				parked.park(ctx)
				set(ctx)
			},
			contact(_ctx, touch, phase) {
				if (eng === undefined) return false
				const c = touch as PContact
				const a = solidOfFixture(eng, c.getFixtureA())
				const b = solidOfFixture(eng, c.getFixtureB())
				if (a === undefined || b === undefined) return false
				// (pieces still parked touch nothing; two pieces of this thing never meet)
				if (parked.parked && (parked.has(a) || parked.has(b))) return true
				if (parked.has(a) && parked.has(b)) return true
				// (a striker that breaks it into pieces goes on through: the contact is left out until the whole is gone, and its pieces let
				// it pass for 60 ms)
				if (phase === "pre" && through.has(c)) return true
				if (ghost !== null && _ctx.time() <= ghost.until && ((a === ghost.id && parked.has(b)) || (b === ghost.id && parked.has(a)))) return true
				if (phase !== "begin" || (broken === 2 && !boxed)) return false
				const aMine = watched.has(a)
				const bMine = watched.has(b)
				if (aMine === bMine) return false
				const other = aMine ? b : a
				if (mine.has(other)) return false
				const ap = approachOf(eng, c)
				if (ap === null || ap.speed <= 0) return false
				// (the normal from A to B; from the other into this thing)
				const sgn = aMine ? -1 : 1
				const oh = _ctx.solid(other)
				const ob = oh?.body()
				const oMoves = oh !== undefined && oh.dynamic && (ob?.mass ?? 0) > 0
				const myMass = boxed && box !== null ? (_ctx.solid(box)?.body().mass ?? 0) : (_ctx.solid(solid)?.mass() ?? 0)
				const hit: Hit = { other, speed: ap.speed, nx: sgn * ap.nx, ny: sgn * ap.ny, x: ap.x, y: ap.y, mo: ob?.mass ?? 0, oMoves, oHeld: oMoves ? heldBy(_ctx, other, solid, boxed ? watched : mine, myMass) : true }
				// (a moving thing striking a breakable that is held, or fixed: worked out now, and when it breaks it into pieces the striker is
				// not bounced back by what is no longer there: it goes on through, slowed by what the break took from it)
				if (!boxed && pieceIds.length > 0 && oMoves) {
					const me = _ctx.solid(solid)
					if (me !== undefined && (!me.dynamic || heldBy(_ctx, solid, other, mine, ob?.mass ?? 0))) {
						const r = hitForce(_ctx, hit)
						const share = limit > 0 ? r.force / (limit * r.need) : 0
						if (r.force >= (broken >= 1 ? 0.5 * limit : limit) * r.need && (share >= smash || broken >= 1)) {
							hit.pre = r
							hit.pass = true
							through.add(c)
						}
					}
				}
				pending.push(hit)
				return false
			},
			after(ctx, h) {
				if (eng === undefined) return
				steps++
				const me = ctx.solid(solid)
				if (me !== undefined && parked.parked) parked.follow(ctx, eng, me)
				let changed = false
				// impacts
				const hits = pending.splice(0)
				if (broken < 2 || boxed) {
					for (const hit of hits) {
						const r2 = hit.pre ?? hitForce(ctx, hit)
						for (const [sid, x] of r2.squash) {
							const it = ctx.solid(sid)?.item
							if (it === undefined || !(x > 0)) continue
							const was = squashed.get(sid)
							if (was === undefined || x > was.v) squashed.set(sid, { item: it, v: x })
						}
						if (r2.force > peak) {
							peak = r2.force
							changed = true
						}
						const sh = limit > 0 ? r2.force / (limit * r2.need) : 0
						if (sh > shareMax) {
							shareMax = sh
							changed = true
						}
						if (hit.speed > hardest && r2.force > 0) {
							hardest = hit.speed
							changed = true
						}
						const need = (broken >= 1 ? 0.5 * limit : limit) * r2.need
						if (r2.force >= need && broken < 2) {
							const was = broken
							breakNow(ctx, Math.max(r2.force, broken >= 1 ? limit * r2.need : r2.force), hit, r2.need)
							changed = true
							if (hit.pass && broken === 2) {
								// (the striker goes on through: its speed toward it less what breaking it took, ½·m·Δ(v²) = the energy stored when it gave)
								ghost = { id: hit.other, until: ctx.time() + 0.06 }
								const st = ctx.solid(hit.other)
								if (st !== undefined && st.dynamic && r2.mEff > 0) {
									const v = st.velocity()
									const vn = v.x * hit.nx + v.y * hit.ny
									const Fb = (was >= 1 ? 0.5 : smash) * limit * r2.need
									const after = Math.sqrt(Math.max(0, hit.speed * hit.speed - (2 * r2.stored(Math.min(Fb, r2.force))) / r2.mEff))
									if (vn > 0) {
										const dv = Math.min(after, vn) - vn
										st.setVelocity(v.x + dv * hit.nx, v.y + dv * hit.ny)
									}
								}
							}
							if (broken === 2) break
						}
					}
				}
				// steady loads (not for a boxed egg, whose box holds it, or one in pieces)
				if (!boxed && broken < 2 && me !== undefined) {
					const body = eng.bodyOf(solid) as PBody | undefined
					let most = 0
					const seen = new Set<unknown>()
					for (let e = body?.getContactList() ?? null; e !== null; e = e.next) {
						const c = e.contact
						if (!c.isTouching()) continue
						const a = solidOfFixture(eng, c.getFixtureA())
						const b = solidOfFixture(eng, c.getFixtureB())
						if (a !== solid && b !== solid) continue
						const other = a === solid ? b : a
						if (other === undefined || mine.has(other)) continue
						seen.add(c)
						const first = ages.get(c) ?? steps
						ages.set(c, first)
						if (steps - first < SETTLED) continue
						const mf = c.getManifold()
						let imp = 0
						for (let i = 0; i < mf.pointCount; i++) imp += mf.points[i]?.normalImpulse ?? 0
						const f = imp / (eng.lengthScale * h)
						if (f > most) most = f
					}
					for (const key of [...ages.keys()]) if (!seen.has(key)) ages.delete(key)
					steady += (most - steady) * Math.min(1, h / STATIC_TAU)
					if (steady > peak) {
						peak = steady
						changed = true
					}
					if (limit > 0 && steady / limit > shareMax) {
						shareMax = steady / limit
						changed = true
					}
					const need = broken >= 1 ? 0.5 * limit : limit
					if (steady >= need) {
						breakNow(ctx, broken >= 1 ? Math.max(steady, limit) : steady, null)
						changed = true
					}
				}
				if (changed) set(ctx)
				// padding squashed by its hits springs back
				for (const [sid, s] of squashed) {
					if (s.v <= 0) continue
					ctx.set(s.item, "squash", s.v)
					s.v = s.v * Math.max(0, 1 - h / SQUASH_RELAX)
					if (s.v < 1e-5) {
						s.v = 0
						ctx.set(s.item, "squash", 0)
					}
					void sid
				}
			}
		}
	}
}

// ---------------------------------------------------------------- beams that snap
const beam: ProcessKind = {
	kind: "fracture-beam",
	check: (r, solids) => {
		if (typeof r.solid !== "string" || !solids.has(r.solid)) return "its solid is not in the document"
		const ps = Array.isArray(r.pieces) ? r.pieces : []
		if (ps.length < 2) return "it needs two or more pieces"
		for (const p of ps) if (!Array.isArray(p) || typeof p[0] !== "string" || !solids.has(p[0])) return "a piece is not in the document"
		return undefined
	},
	create(r: ProcessRecord) {
		const item = r.item as string
		const solid = r.solid as string
		const name = str(r.name) ?? item
		const pieces = (r.pieces as unknown[][]).map((p) => ({ id: p[0] as string, dx: num(p[1], 0), mass: num(p[2], 0) }))
		const L = num(r.length, 0.2)
		const EI = num(r.ei, 1)
		const Mc = num(r.mc, 1)
		const three = r.three === true
		const perM = num(r.per_m, 0)
		const sup = Array.isArray(r.supports) ? (r.supports as unknown[]) : []
		const sLo = num(sup[0], -L / 2)
		const sHi = num(sup[1], L / 2)
		const n = pieces.length
		const cuts = pieces.slice(1).map((p, j) => (pieces[j]!.dx + p.dx) / 2)
		const parked = new Parked(
			pieces.map((p) => p.id),
			pieces.map((p) => ({ x: p.dx, y: 0 }))
		)
		const mine = new Set<string>([solid, ...pieces.map((p) => p.id)])
		const smooth = cuts.map(() => 0)
		let load = 0
		let share = 0
		let sag = 0
		let broken = 0
		let steps = 0
		const ages = new Map<unknown, number>()
		let eng: EngineInternals | undefined
		const pending: Hit[] = []
		const set = (ctx: ProcessContext) => {
			ctx.set(item, "broken", broken)
			ctx.set(item, "load", load)
			ctx.set(item, "share", share)
			ctx.set(item, "sag", sag)
		}
		const snap = (ctx: ProcessContext, at: number, moment: number, hit: Hit | null) => {
			if (eng === undefined) return
			const me = ctx.solid(solid)
			if (me === undefined) return
			broken = 2
			const q = me.pose()
			const v = me.velocity()
			const w = me.spin()
			const c = Math.cos(q.angle)
			const s = Math.sin(q.angle)
			parked.parked = false
			remove(eng, me)
			const groups: number[][] = [[], []]
			for (let i = 0; i < n; i++) (i <= at ? groups[0] : groups[1])!.push(i)
			if (three) {
				const longer = groups[0]!.length >= groups[1]!.length ? 0 : 1
				const g = groups[longer]!
				if (g.length >= 2) {
					const half = Math.floor(g.length / 2)
					const a = g.slice(0, half)
					const b = g.slice(half)
					groups.splice(longer, 1, a, b)
				}
			}
			const world = eng.world as { createJoint(j: unknown): unknown }
			for (const g of groups) {
				for (const i of g) {
					const p = ctx.solid(pieces[i]!.id)
					if (p === undefined) continue
					const dx = pieces[i]!.dx
					const x = q.x + dx * c
					const y = q.y + dx * s
					release(eng, p, x, y, q.angle, v.x - w * (dx * s), v.y + w * (dx * c), w, pieces[i]!.mass)
				}
				for (let j = 1; j < g.length; j++) {
					const A = eng.bodyOf(pieces[g[j - 1]!]!.id)
					const B = eng.bodyOf(pieces[g[j]!]!.id)
					if (A === undefined || B === undefined || A === null || B === null) continue
					const mx = (pieces[g[j - 1]!]!.dx + pieces[g[j]!]!.dx) / 2
					world.createJoint(new WeldJoint({ frequencyHz: 0, dampingRatio: 0 }, A as never, B as never, new Vec2((q.x + mx * c) * eng.lengthScale, (q.y + mx * s) * eng.lengthScale)))
				}
			}
			const grams = (load / 9.81) * 1000
			const mass = grams >= 1000 ? `${(grams / 1000).toFixed(2)} kg` : `${grams.toFixed(0)} g`
			const by = hit === null ? undefined : ctx.solid(hit.other)
			const why =
				hit === null || by === undefined
					? `under ${fN(load)} N (${mass}) of load`
					: `as ${by.part.words || "something"} lands on it at ${f2(hit.speed)} m/s`
			ctx.event(`${name} snaps at ${f2(ctx.time())} s ${why} (bending ${moment.toPrecision(3)} N·m; it holds ${Mc.toPrecision(3)} N·m)`, [item], "breaks")
		}
		return {
			start(ctx) {
				eng = ctx.engine()
				parked.park(ctx)
				set(ctx)
			},
			contact(_ctx, touch, phase) {
				if (eng === undefined) return false
				const c = touch as PContact
				const a = solidOfFixture(eng, c.getFixtureA())
				const b = solidOfFixture(eng, c.getFixtureB())
				if (a === undefined || b === undefined) return false
				if (parked.parked && (parked.has(a) || parked.has(b))) return true
				if (parked.has(a) && parked.has(b)) return true
				if (phase !== "begin" || broken === 2) return false
				if ((a === solid) === (b === solid)) return false
				const other = a === solid ? b : a
				if (mine.has(other)) return false
				const ap = approachOf(eng, c)
				if (ap === null || ap.speed <= 0) return false
				const sgn = a === solid ? -1 : 1
				const oh = _ctx.solid(other)
				pending.push({ other, speed: ap.speed, nx: sgn * ap.nx, ny: sgn * ap.ny, x: ap.x, y: ap.y, mo: oh?.body().mass ?? 0, oMoves: oh?.dynamic === true })
				return false
			},
			after(ctx, h) {
				if (eng === undefined || broken === 2) return
				steps++
				const me = ctx.solid(solid)
				if (me === undefined) return
				parked.follow(ctx, eng, me)
				const q = me.pose()
				const ux = Math.cos(q.angle)
				const uy = Math.sin(q.angle)
				const body = eng.bodyOf(solid) as PBody | undefined
				const forces: BeamForce[] = []
				let down = 0
				const seen = new Set<unknown>()
				for (let e = body?.getContactList() ?? null; e !== null; e = e.next) {
					const c = e.contact
					if (!c.isTouching()) continue
					const a = solidOfFixture(eng, c.getFixtureA())
					const b = solidOfFixture(eng, c.getFixtureB())
					if (a !== solid && b !== solid) continue
					const other = a === solid ? b : a
					if (other === undefined || mine.has(other)) continue
					seen.add(c)
					const first = ages.get(c) ?? steps
					ages.set(c, first)
					if (steps - first < SETTLED) continue
					const wm = c.getWorldManifold(null)
					const mf = c.getManifold()
					if (wm === undefined || wm === null) continue
					// (the normal runs from A to B: the force on this beam is along it when the beam is B, against it when A)
					const sgn = a === solid ? -1 : 1
					const perp = sgn * (wm.normal.x * -uy + wm.normal.y * ux)
					for (let i = 0; i < mf.pointCount; i++) {
						const p = wm.points[i]
						const imp = mf.points[i]?.normalImpulse ?? 0
						if (p === undefined) continue
						const f = (imp / (eng.lengthScale * h)) * perp
						const sAt = (p.x / eng.lengthScale - q.x) * ux + (p.y / eng.lengthScale - q.y) * uy
						forces.push({ s: sAt, f })
						down -= f
					}
				}
				for (const key of [...ages.keys()]) if (!seen.has(key)) ages.delete(key)
				const kk = Math.min(1, h / BEAM_TAU)
				// (its own weight, across it: the run's gravity on its real mass per metre)
				const w = perM * ctx.settings.gravity * ux
				cuts.forEach((s, j) => {
					smooth[j] = (smooth[j] ?? 0) + (supportedMoment(forces, L, w, sLo, sHi, s) - (smooth[j] ?? 0)) * kk
				})
				load += (down - load) * kk
				const lo = sLo
				const hi = sHi
				// impacts on its span
				const extra = cuts.map(() => 0)
				const cause: (Hit | null)[] = cuts.map(() => null)
				for (const hit of pending.splice(0)) {
					if (!(hi > lo)) continue
					const other = ctx.solid(hit.other)
					if (other === undefined || !other.dynamic) continue
					const sAt = (hit.x - q.x) * ux + (hit.y - q.y) * uy
					const a = sAt - lo
					const b = hi - sAt
					if (!(a > 0 && b > 0)) continue
					// (a thing that broke in this same hit, an egg dropped on it, struck with its mass as the contact began)
					const im = beamImpact(EI, a, b, other.scale() < 0.01 && hit.mo !== undefined ? hit.mo : other.body().mass, hit.speed)
					cuts.forEach((s, j) => {
						const mm = im.momentAt(s - lo)
						if (mm > (extra[j] ?? 0)) {
							extra[j] = mm
							cause[j] = hit
						}
					})
				}
				let most = 0
				let at = -1
				let worst = 0
				cuts.forEach((_s, j) => {
					const st = smooth[j] ?? 0
					const tot = Math.abs(st) + (extra[j] ?? 0)
					if (tot > most) {
						most = tot
						at = j
					}
					if (Math.abs(st) > worst) worst = Math.abs(st)
				})
				share = Math.max(share, Mc > 0 ? most / Mc : 0)
				sag = sagOf(worst, hi - lo, EI)
				if (Mc > 0 && most >= Mc && at >= 0) snap(ctx, at, most, (extra[at] ?? 0) > Math.abs(smooth[at] ?? 0) ? cause[at] ?? null : null)
				set(ctx)
			}
		}
	}
}

// ---------------------------------------------------------------- glued blocks
const glue: ProcessKind = {
	kind: "fracture-glue",
	check: (r, solids) => {
		const bs = ids(r.blocks)
		if (bs.length < 2) return "it needs two or more blocks"
		for (const id of bs) if (!solids.has(id)) return `its block ${id} is not in the document`
		return undefined
	},
	create(r: ProcessRecord) {
		const item = r.item as string
		const name = str(r.name) ?? item
		const what = str(r.glue) ?? "none"
		const blocks = ids(r.blocks)
		const w = num(r.w, 0.1)
		const d = num(r.d, 0.05)
		const bh = num(r.h, 0.05)
		const sigma = num(r.sigma, 0)
		const tau = num(r.tau, 0)
		const glued = what !== "none" && sigma > 0
		let eng: EngineInternals | undefined
		const pairs: { joint: PJoint | null; lower: string; upper: string; was: { fn: number; ft: number; m: number } | null; k: number; rel: { x: number; y: number; a: number } }[] = []
		let broken = 0
		let share = 0
		// (each block's start pose; whether it has fallen; where the tower's bottom stood)
		const starts = new Map<string, { y: number; a: number }>()
		const fell = new Set<string>()
		let base = 0
		let fallen = 0
		let top = 0
		let top0 = 0
		let knocked = false
		/** A block has fallen: more than half a block lower than it was stacked, or turned more than 35° (0.61 rad). */
		const fallenNow = (ctx: ProcessContext, id: string) => {
			const s0 = starts.get(id)
			const q = ctx.solid(id)?.pose()
			if (s0 === undefined || q === undefined) return false
			let da = q.angle - s0.a
			while (da > Math.PI) da -= 2 * Math.PI
			while (da <= -Math.PI) da += 2 * Math.PI
			return s0.y - q.y > 0.5 * bh || Math.abs(da) > 0.61
		}
		/** The highest block's top over the tower's base, m. */
		const topOf = (ctx: ProcessContext) => {
			let most = -Infinity
			for (const id of blocks) for (const p of ctx.solid(id)?.outline().points ?? []) if (p.y > most) most = p.y
			return Number.isFinite(most) ? most - base : 0
		}
		/** The upper block's pose in the lower one's frame. */
		const relOf = (ctx: ProcessContext, lower: string, upper: string) => {
			const a = ctx.solid(lower)?.pose()
			const b = ctx.solid(upper)?.pose()
			if (a === undefined || b === undefined) return null
			const c = Math.cos(a.angle)
			const s = Math.sin(a.angle)
			const dx = b.x - a.x
			const dy = b.y - a.y
			return { x: dx * c + dy * s, y: -dx * s + dy * c, a: b.angle - a.angle }
		}
		return {
			start(ctx) {
				eng = ctx.engine()
				if (eng === undefined) return
				const world = eng.world as { createJoint(j: unknown): unknown }
				for (const id of blocks) {
					const q = ctx.solid(id)?.pose()
					if (q !== undefined) starts.set(id, { y: q.y, a: q.angle })
				}
				{
					let low = Infinity
					for (const p of ctx.solid(blocks[0]!)?.outline().points ?? []) if (p.y < low) low = p.y
					base = Number.isFinite(low) ? low : 0
				}
				top = topOf(ctx)
				top0 = top
				for (let i = 1; i < blocks.length; i++) {
					const rel = relOf(ctx, blocks[i - 1]!, blocks[i]!)
					if (rel === null) continue
					let joint: PJoint | null = null
					if (glued) {
						const lo = ctx.solid(blocks[i - 1]!)!.pose()
						const up = ctx.solid(blocks[i]!)!.pose()
						const A = eng.bodyOf(blocks[i - 1]!)
						const B = eng.bodyOf(blocks[i]!)
						// (the middle of their shared face: halfway between their origins)
						if (A && B) joint = world.createJoint(new WeldJoint({ frequencyHz: 0, dampingRatio: 0 }, A as never, B as never, new Vec2(((lo.x + up.x) / 2) * eng.lengthScale, ((lo.y + up.y) / 2) * eng.lengthScale))) as PJoint
					}
					pairs.push({ joint, lower: blocks[i - 1]!, upper: blocks[i]!, was: null, k: i, rel })
				}
				ctx.set(item, "broken", 0)
				ctx.set(item, "blocks_fallen", 0)
				ctx.set(item, "top_height", top)
				ctx.set(item, "share", 0)
			},
			after(ctx, h) {
				if (eng === undefined || !ctx.released()) return
				const world = eng.world as { destroyJoint(j: unknown): void }
				let changed = false
				for (const p of pairs) {
					if (p.joint !== null) {
						const lo = ctx.solid(p.lower)
						if (lo === undefined) continue
						const F = p.joint.getReactionForce(1 / h)
						const T = p.joint.getReactionTorque(1 / h)
						const L = eng.lengthScale
						const a = lo.pose().angle
						const nx = -Math.sin(a)
						const ny = Math.cos(a)
						// (the force on the upper block: along n it holds it up, compression; against n it pulls it down, tension)
						const fn = (F.x * nx + F.y * ny) / L
						const ft = (F.x * ny - F.y * nx) / L
						const m = T / (L * L)
						const now = { fn, ft, m }
						const avg = p.was === null ? now : { fn: (fn + p.was.fn) / 2, ft: (ft + p.was.ft) / 2, m: (m + p.was.m) / 2 }
						p.was = now
						const s = glueShare(avg.fn, avg.ft, avg.m, w, d, sigma, tau)
						if (s > share) {
							share = s
							changed = true
						}
						if (s >= 1) {
							world.destroyJoint(p.joint)
							p.joint = null
							const first = broken === 0
							broken = 1
							changed = true
							ctx.event(`The ${what} between block ${p.k} and block ${p.k + 1} of ${name} lets go at ${f2(ctx.time())} s`, [item], first ? "breaks" : "lets go")
						}
						continue
					}
				}
				// (blocks that have fallen: dropped half a block or turned past 35°; a block that only slides along still stands)
				let now = 0
				for (const [k, id] of blocks.entries()) {
					if (fallenNow(ctx, id)) {
						now++
						if (!fell.has(id)) {
							fell.add(id)
							// (a glued tower that tips over in one piece has not come apart: only its glue letting go says so)
							if (broken === 0 && !glued) {
								broken = 1
								changed = true
								ctx.event(`${name} comes apart at ${f2(ctx.time())} s: block ${k + 1} of ${blocks.length} falls${k > 0 ? ` off block ${k}` : ""}`, [item], "breaks")
							}
						}
					}
				}
				const tp = topOf(ctx)
				// (knocked down: half its blocks or more have fallen, or it stands less than half as tall as it was built)
				const many = now >= Math.floor((blocks.length + 1) / 2)
				if (!knocked && (many || tp < 0.5 * top0)) {
					knocked = true
					const why = many ? `${now} of ${blocks.length} blocks have fallen` : `its top is ${(tp * 100).toFixed(0)} cm up (built ${(top0 * 100).toFixed(0)} cm)`
					ctx.event(`${name} is knocked down at ${f2(ctx.time())} s: ${why}`, [item], "falls")
				}
				if (now !== fallen) {
					fallen = now
					changed = true
				}
				if (Math.abs(tp - top) > 1e-5) {
					top = tp
					changed = true
				}
				if (changed) {
					ctx.set(item, "broken", broken)
					ctx.set(item, "blocks_fallen", fallen)
					ctx.set(item, "top_height", top)
					ctx.set(item, "share", share)
				}
			}
		}
	}
}

// ---------------------------------------------------------------- parachutes
const chute: ProcessKind = {
	kind: "fracture-chute",
	check: (r, solids) => (typeof r.solid === "string" && solids.has(r.solid) ? undefined : "its solid is not in the document"),
	create(r: ProcessRecord) {
		const solid = r.solid as string
		const area = num(r.area, 0)
		const cd = num(r.cd, 0.8)
		const lift = num(r.lift, 0.3)
		// (the air module's vacuum jars it may fall in: their insides and the item whose pressure reading says how much air is left)
		const jars = (Array.isArray(r.jars) ? (r.jars as unknown[]) : []).flatMap((j) => {
			const o = j as Record<string, unknown>
			return o !== null && typeof o === "object" && typeof o.item === "string" ? [{ item: o.item, x0: num(o.x0, 0), x1: num(o.x1, 0), y0: num(o.y0, 0), y1: num(o.y1, 0) }] : []
		})
		/** The air's density round a point, kg/m³: the room's, or a pumped jar's (ρ ∝ its pressure at the same temperature). */
		const rhoAt = (ctx: ProcessContext, p: Point) => {
			for (const j of jars) {
				if (p.x >= j.x0 && p.x <= j.x1 && p.y >= j.y0 && p.y <= j.y1) {
					const kpa = ctx.get(j.item, "pressure_kpa")
					return typeof kpa === "number" && Number.isFinite(kpa) ? RHO_AIR * Math.max(0, kpa * 1000) / ATM : RHO_AIR
				}
			}
			return RHO_AIR
		}
		return {
			force(ctx) {
				if (!ctx.settings.air || !(area > 0)) return
				const hd = ctx.solid(solid)
				if (hd === undefined || !hd.dynamic) return
				const q = hd.pose()
				const at = { x: q.x - Math.sin(q.angle) * lift, y: q.y + Math.cos(q.angle) * lift }
				const v = hd.velocity()
				const air = ctx.air(at)
				const ux = v.x - air.x
				const uy = v.y - air.y
				const u = Math.sqrt(ux * ux + uy * uy)
				if (!(u > 0)) return
				const k = 0.5 * (jars.length ? rhoAt(ctx, q) : RHO_AIR) * cd * area * u
				hd.push(-k * ux, -k * uy, at)
			}
		}
	}
}

export default [soft, brittle, beam, glue, chute]
void Cap
