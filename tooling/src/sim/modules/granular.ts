/**
 * The granular module (engine side): sand, gravel, pebbles, soil and flour in piles, trays, funnels, hourglasses and stream tables. The physics
 * is tooling/src/sim/granular.ts; this file runs it through the plugin framework (tooling/src/sim/plugins.ts). Records (doc.processes, made
 * by machines/mod_granular.py and its port web/sim/modules/granular.js):
 *   {kind: "sand-region", id, item, x0, x1, z0, z1, base, top, cell, grain, wet, role, deposit, walls?, exclude?}
 *       grains resting on whatever static solids are under the rectangle x0…x1 × z0…z1 (z: front to back, 0 = the machine plane), between the
 *       heights base and top (m): the floor is scanned from the document's fixed solids (ghosts and `exclude` left out); `walls`: extra
 *       barriers [{x0, x1, z0, z1, top}] (a tray's front and back walls, which the side view has no solids for). Regions that overlap are one bed.
 *       role: "pile" | "tray" | "landing" | "stream" (what its item reads). deposit: {shape: "cone", x, z, mass} (a heap at the angle of repose,
 *       kg, laid on what it stands on: the columns joined to the one under its middle without a drop of more than 1.5 columns (6 mm); exactly
 *       that mass; when it reaches that support's edge it runs off it before the run (settled)), {shape: "castle", x, z, radius, height} (a packed
 *       tower, on that support only), {shape: "layer", depth} (level to depth over its own floor), {shape:
 *       "slope", from, toe, depth} (a stream table's sand, depth thick from x = from to x = toe, then its repose), {shape: "none"}.
 *   {kind: "sand-vessel", id, item, cx, base, shape ("cone" | "bowl"), R, rOut, wall, top, cell, grain, wet, mass, role ("funnel" |
 *       "hourglass-top" | "hourglass-bottom"), outlet: {diameter, delay} | null}
 *       a funnel's or an hourglass bulb's inside (granular.ts vesselBed), filled level with `mass` kg; the outlet opens `delay` s after the
 *       release.
 *   {kind: "sand-water", id, item, region (a sand-region's id), sources: [{x, z, rate (m³/s)}], drainX, lake, plants: [{x0, x1, tau}] | null}
 *       running water on that region's bed from the release (a stream table's hose), standing to `lake` at the low end, out at drainX.
 *   (2026-10-20) a sand-region's `holders: [{item, floor, left: [ids], right: [ids], round, depth}]`: the containers (a jar, a cup, a beaker, a
 *       bucket, a box) its grains may land or lie in (machines/mod_granular.py's build hook names every one in the scene near it); the engine
 *       works out each one's inside from its solids' outlines at the start (granular.ts holderOf) and, where the bed reaches it, makes its inside
 *       the floor and a ring of wall columns round it (front and back too), the bed grown to hold it whole with columns no wider than a tenth of
 *       its inside; a pile or landing region whose middle is over its inside is read inside it (heap_* / height_mm..., and outside_g /
 *       spilled_g: what lies outside it).
 *   {kind: "sand-pour", id, item, solid, inside: [4 {x, y}], depth, wall, grain, wet, volume (m³ packed), asked? (mL)}
 *       a cup of grains a hand tips (the flow module's pitcher with contents "grains": that module's flow-pour record tips its root `solid`
 *       about the lip): granular.ts TipCup in that solid's frame; what leaves over the lip falls as parcels (lands on its landing region).
 * All of a run's records are worked by ONE process (the first in the document), every 480 Hz step: the outlets (Beverloo × the time-lapse),
 * the avalanches, the falling grains, the water (15 times a second; the bed's change × the time-lapse), and, after the release, bodies in
 * the sand (a force each (sub-)step).
 * Readings (track.state, per frame; 30 times a second):
 *   pile:      height_mm (its top over where it lies), width_mm (its footprint as a disc), angle_deg (its slope: atan(height / radius)), mass_g,
 *              spilled_g (a heap laid on a raised support narrower than itself, a shelf, a plank, a tipped board: what ran off its edge before the
 *              run; its other readings are then over the support alone)
 *   tray:      crater_mm (rim to rim, between columns), crater_depth_mm (below where the sand stood), sand_mm (the sand's mean depth)
 *   funnel:    left_g, poured_g, flow_gs, clogged (1 while it jams), heap_mm, heap_deg, heap_g (the heap it has poured, read as a pile's)
 *   hourglass: top_g, bottom_g, flow_gs, run_s (lesson seconds since it opened, frozen when it runs out and while its neck is jammed), empty (0/1),
 *              clogged (1 while its grains jam in the neck)
 *   stream:    eroded_g (the sand gone from where it lay: what the water carried away), delta_cm (how far the deposit reaches past the sand's
 *              toe), channel_mm (the deepest cut), water_lpm
 *   a cup of grains (its item, the pitcher): left_g, poured_g, flow_gs, lands_x (where its stream comes down), and its landing region's heap_mm,
 *              heap_deg, heap_g (+ outside_g in a container: everything it poured that is not in it, on the bed, off its edges, on another bed,
 *              lost below or falling under the bed's floor, so heap_g + outside_g = poured_g but what is still in the air); keyframe "cup" (its
 *              grains' surface in the cup's frame: nx, ny, c (m), area (m²), and the cup's world angle (rad), up to 30 a second while they change)
 *   a bed with containers: keyframe "holders:<bed>" once ([n, (round, x, floor, r0, rb, ylo, rt, yhi, wall, rim, k, ring) ×n])
 * Keyframes (track.keyframes, for the view): each bed under its first item: "grid" once ([x0, z0, dx, nx, nz, K, grain index ×K (GRAIN_KEYS),
 * wetness index ×K (WETNESS), base (m), the floor as N runs [N, (step, count) ×N] of its column-to-column steps in tenths of a mm over the
 * base, the kinds as M runs [M, (kind, count) ×M]]); values below in tenths of a millimetre, a rectangle [i0, j0, ni, nj, 0, ...values], as
 * runs [i0, j0, ni, nj, 1, (value, count)...] or only the changed columns [i0, j0, ni, nj, 2, count, (offset in the rectangle, value)...],
 * whichever is shortest: "h" (the thickness over the rectangle that changed: up to 20 a second while something
 * changes by 1 mm (5 a second under running water), else 4 a second),
 * "mix" (with "h" when K > 1: [−1, k] when the whole bed holds class k only, else [i0, j0, ni, nj, share % of classes 1…K−1 per column]),
 * "water" (its depth, the whole bed, 4 a second when it changed);
 * the run's falling grains under the first record's item: "air" ([x, y, z, vx, vy, vz, grain index] per parcel, 30 a second while any fly).
 * Events: "<funnel> starts pouring: about 25 g a second", "<hourglass> starts running: about 1.1 g a second through its 3 mm neck", "<funnel> clogs", "<funnel> runs empty", "<hourglass> runs out after 60.0 s" ("lesson seconds" under a time-lapse), "<hourglass> jams: its
 *   grains arch over the 3 mm neck", "<heap> does not fit on <plank>: 412 g of its grains spill off the edge" (at the start), "<castle> collapses",
 *   "sand spills off the edge", "<cup> spills sugar outside <jar>" (a cup's or a funnel's, once a gram lies outside its container),
 *   "only 163 g of the 200 g of grains fits in <hourglass>'s top bulb" (at the start: more grains than it holds), "a crater opens in <tray>"
 *   (10 mm across), "the water starts carrying sand down <stream table>" (20 g gone), "the washed-off sand builds a delta in <stream table>'s pool" (1 cm).
 */
import {
	Bed,
	beverlooRate,
	type BodyLink,
	cellsWithin,
	type ClassInfo,
	classInfo,
	craterStats,
	fillLevel,
	GRAIN_KEYS,
	GRAINS,
	heapCone,
	heapIn,
	type Holder,
	holderFloor,
	holderOf,
	holderQ,
	holderRing,
	manningN,
	type Outlet,
	pileStats,
	TipCup,
	vesselBed,
	Water,
	WETNESS,
	type Wetness,
	World
} from "#sim/granular.ts"
import type { SimScene } from "#sim/part.ts"
import type { ProcessContext, ProcessKind, ProcessRecord, SolidHandle } from "#sim/plugins.ts"

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)
const KINDS = ["sand-region", "sand-vessel", "sand-water", "sand-pour"] as const
/** The most columns one bed may have (performance: a bigger region gets coarser columns). */
const MAX_CELLS = 24000
const READ_EVERY = 16
const FLOW_EVERY = 2
const WATER_EVERY = 32

const grainOf = (r: ProcessRecord) => (typeof r.grain === "string" && GRAINS[r.grain] !== undefined ? r.grain : "sand")
const wetOf = (r: ProcessRecord): Wetness => (WETNESS.includes(r.wet as Wetness) ? (r.wet as Wetness) : "dry")

// ---------------------------------------------------------------- admission

const regionProblem = (r: ProcessRecord): string | undefined => {
	for (const k of ["x0", "x1", "z0", "z1", "base", "top", "cell"] as const) if (!finite(r[k])) return `${k} must be a number (m)`
	if (!((r.x1 as number) > (r.x0 as number)) || !((r.z1 as number) > (r.z0 as number))) return "x1 and z1 must be beyond x0 and z0"
	if (!((r.top as number) > (r.base as number))) return "top must be above base"
	if (!((r.cell as number) >= 0.001 && (r.cell as number) <= 0.1)) return "cell must be 0.001 to 0.1 m"
	if (typeof r.grain !== "string" || GRAINS[r.grain] === undefined) return `grain must be one of ${GRAIN_KEYS.join(", ")}`
	if (!WETNESS.includes(r.wet as Wetness)) return `wet must be one of ${WETNESS.join(", ")}`
	const d = r.deposit as Record<string, unknown> | undefined
	if (typeof d !== "object" || d === null || typeof d.shape !== "string") return "deposit must be {shape, ...}"
	if (!["cone", "castle", "layer", "slope", "none"].includes(d.shape)) return `deposit.shape ${d.shape} is not cone, castle, layer, slope or none`
	if ((r.x1 as number) - (r.x0 as number) > 20 || (r.z1 as number) - (r.z0 as number) > 5) return "a region is at most 20 m long and 5 m deep"
	if (r.holders !== undefined) {
		if (!Array.isArray(r.holders) || r.holders.length > 32) return "holders must list up to 32 containers"
		for (const h of r.holders as Record<string, unknown>[]) {
			if (typeof h !== "object" || h === null || typeof h.item !== "string" || typeof h.floor !== "string") return "each holder needs its item and its floor's solid id"
			if (!Array.isArray(h.left) || !Array.isArray(h.right) || ![...(h.left as unknown[]), ...(h.right as unknown[])].every((x) => typeof x === "string"))
				return "a holder's left and right must list its walls' solid ids"
			if (typeof h.round !== "boolean" || !finite(h.depth) || !((h.depth as number) > 0)) return "a holder needs round (true or false) and its depth (m)"
		}
	}
	return undefined
}

const pourProblem = (r: ProcessRecord): string | undefined => {
	if (typeof r.solid !== "string") return "solid must name the cup's root solid"
	const p = r.inside as { x: unknown; y: unknown }[] | undefined
	if (!Array.isArray(p) || p.length !== 4 || !p.every((q) => finite(q?.x) && finite(q?.y))) return "inside must be 4 {x, y}: bottom-left, bottom-right, top-right, top-left"
	const [bl, br, tr, tl] = p as { x: number; y: number }[]
	if (!(br!.x > bl!.x && tr!.x > tl!.x && tl!.y > bl!.y && tr!.y > br!.y)) return "inside must be a box-like outline, wider than 0 and taller than 0"
	if (!finite(r.depth) || !((r.depth as number) > 0) || !finite(r.volume) || (r.volume as number) < 0) return "depth (m, more than 0) and volume (m³, at least 0) must be numbers"
	if (typeof r.grain !== "string" || GRAINS[r.grain] === undefined) return `grain must be one of ${GRAIN_KEYS.join(", ")}`
	if (!WETNESS.includes(r.wet as Wetness)) return `wet must be one of ${WETNESS.join(", ")}`
	return undefined
}

const vesselProblem = (r: ProcessRecord): string | undefined => {
	for (const k of ["cx", "base", "R", "top", "cell", "mass"] as const) if (!finite(r[k])) return `${k} must be a number`
	if (r.shape !== "cone" && r.shape !== "bowl") return "shape must be cone or bowl"
	if (!((r.R as number) > 0.002 && (r.R as number) < 1)) return "R must be 2 mm to 1 m"
	if (!((r.top as number) > (r.base as number))) return "top must be above base"
	if (typeof r.grain !== "string" || GRAINS[r.grain] === undefined) return `grain must be one of ${GRAIN_KEYS.join(", ")}`
	if (!WETNESS.includes(r.wet as Wetness)) return `wet must be one of ${WETNESS.join(", ")}`
	return undefined
}

const waterProblem = (r: ProcessRecord, records: readonly ProcessRecord[] | undefined): string | undefined => {
	if (typeof r.region !== "string") return "region must name a sand-region"
	if (records !== undefined && !records.some((q) => q.kind === "sand-region" && q.id === r.region)) return `no sand-region ${String(r.region)}`
	if (!Array.isArray(r.sources)) return "sources must be a list"
	for (const s of r.sources as Record<string, unknown>[]) if (!finite(s?.x) || !finite(s?.z) || !finite(s?.rate) || (s.rate as number) < 0) return "each source needs x, z and a rate ≥ 0"
	if (!finite(r.drainX) || !finite(r.lake)) return "drainX and lake must be numbers (m)"
	return undefined
}

// ---------------------------------------------------------------- keyframes' packing (web/models/mod-granular.js unpacks them)

/** Runs of equal values: [value, count, value, count, ...]. */
const rle = (vals: readonly number[]) => {
	const out: number[] = []
	for (let k = 0; k < vals.length; ) {
		const v = vals[k] as number
		let n = 1
		while (k + n < vals.length && vals[k + n] === v) n++
		out.push(v, n)
		k += n
	}
	return out
}

/** A rectangle of integer values (tenths of a millimetre): [i0, j0, ni, nj, 0, ...values] or, shorter, [i0, j0, ni, nj, 1, ...runs]. */
const packed = (i0: number, j0: number, ni: number, nj: number, vals: readonly number[]) => {
	const r = rle(vals)
	return r.length < vals.length ? [i0, j0, ni, nj, 1, ...r] : [i0, j0, ni, nj, 0, ...vals]
}

// ---------------------------------------------------------------- one run's grains

interface Region {
	readonly record: ProcessRecord
	readonly item: string
	bed: Bed
	/** Its own cells in its bed (the rectangle), and the surface there before its own deposit (m). */
	cells: Int32Array
	baseline: Float64Array
	/** For readings: the start's height (pile/castle), its toe (stream). */
	startTop: number
	collapsed: boolean
	/** A heap laid on a raised support narrower than itself (a shelf, a plank, a tipped board): the bed's cells of that support (1), what its
	 *  readings are taken over; the rest of its grains spilled off it (null: it fits, every cell of the region counts). */
	support: Uint8Array | null
	/** The container its grains land or lie in (its middle is over that container's inside): its readings are taken inside it (null: none). */
	holder: Holder | null
	/** That container's inside columns in the bed; those of its floor (out to where a tapered cup's wall begins to lean), and its floor's
	 *  outermost ring (where a heap's foot meets the wall). */
	holderCells: Int32Array
	holderFloor: Int32Array
	holderEdge: Int32Array
	/** With a container: 1 on the bed's columns whose grains outside it are this region's to read (its own cells, and the bed's margin grown
	 *  round its containers that no region's rectangle covers); and whether its grains landing outside it have been said. */
	mine: Uint8Array | null
	spillTold: boolean
	/** The bed's lowest floor (m; its edges' left out): a cup's grains falling below it have missed it. */
	low: number
}

/** A cup of grains a hand tips (a "sand-pour" record): its grains, what it lets out, what has been said. */
interface Pour {
	readonly record: ProcessRecord
	readonly item: string
	readonly cup: TipCup
	readonly cls: number
	/** its root solid's angle as the run starts (rad): how far it is tipped is from there */
	readonly a0: number
	/** m³ (packed) let out and not yet launched as a parcel; kg poured; kg/s now (smoothed) */
	pending: number
	pouredKg: number
	rate: number
	lastEmit: number
	startTold: boolean
	emptyTold: boolean
	/** when the view's keyframe of its grains was last written, and what it said */
	lastKey: number
	lastRow: string
}

interface Vessel {
	readonly record: ProcessRecord
	readonly item: string
	readonly bed: Bed
	readonly outlet: Outlet | undefined
	readonly startMass: number
	emptied: boolean
	emptyAt: number
	openedAt: number
	clogTold: boolean
	/** Whether its start ("<funnel> starts pouring: about 25 g a second") has been said. */
	startTold: boolean
	/** Seconds of the run its outlet has been jammed since it opened (an hourglass's clock stops while its neck is blocked). */
	jammedFor: number
}

interface Shown {
	bed: Bed
	item: string
	/** The one class the bed's keyframes said it holds (−2: none said yet; −1: several). */
	cls: number
	last: Float64Array
	lastT: number
	lastW: Float64Array | undefined
	lastWT: number
}

class Grains {
	readonly world: World
	readonly owner: string
	readonly records: ProcessRecord[]
	readonly regions: Region[] = []
	readonly vessels: Vessel[] = []
	readonly waters: { record: ProcessRecord; water: Water; region: Region; toe: number }[] = []
	readonly pours: Pour[] = []
	/** Each bed's containers (the holders its regions name that it covers), for the readings and the view. */
	readonly holders = new Map<Bed, Holder[]>()
	readonly shown: Shown[] = []
	readonly classes: ClassInfo[]
	readonly spilledTold = new Set<string>()
	/** What has been said once: "crater:<item>", "erodes:<item>", "delta:<item>". */
	readonly told = new Set<string>()
	/** Each bed's columns' floor: the item of the fixed solid it is the top of ("" where none: an edge, a tray's wall). */
	readonly floorItem = new Map<Bed, string[]>()
	/** The same, the fixed solid's own id (a kitchen scale's platform, not its base); and, per solid asked for, its columns (grainsOn: floors
	 *  never move, so they are found once) */
	readonly floorSolid = new Map<Bed, string[]>()
	readonly cellsOn = new Map<string, { bed: Bed; cells: Int32Array }[]>()
	/** The containers among the holders that stand by their own weight (a bowl or a mug: dynamic, not fixed): what lies in one lies on what
	 *  it stands on (a kitchen scale's platform weighs it, grainsOn); a fixed cup or jar holds its grains itself. */
	readonly loose = new Set<string>()
	private airShown = false
	private lastAir = -1
	private steps = 0
	private released = false
	private releasedAt = 0
	constructor(scene: SimScene<string>, gravity: number) {
		const all = ((scene as unknown as { processes?: ProcessRecord[] }).processes ?? []).filter((r) => (KINDS as readonly string[]).includes(r.kind))
		this.records = all
		this.owner = all[0]?.id ?? ""
		this.world = new World({ gravity })
		// every grain and wetness any record uses: one class list shared by every bed (grains of one fall onto another)
		const seen = new Map<string, ClassInfo>()
		for (const r of all) {
			if (r.kind === "sand-water") continue
			const key = `${grainOf(r)}|${wetOf(r)}`
			if (!seen.has(key)) seen.set(key, classInfo(GRAINS[grainOf(r)]!, wetOf(r), gravity))
		}
		this.classes = [...seen.values()]
		if (this.classes.length === 0) this.classes.push(classInfo(GRAINS.sand!, "dry", gravity))
	}
	classIndex(r: ProcessRecord) {
		const g = grainOf(r)
		const w = wetOf(r)
		const k = this.classes.findIndex((c) => c.grain.key === g && c.wet === w)
		return k < 0 ? 0 : k
	}

	/** Builds the beds: regions merged where they overlap, floors scanned from the fixed solids; vessels; water; the deposits. */
	build(ctx: ProcessContext) {
		const g = ctx.settings.gravity
		const regs = this.records.filter((r) => r.kind === "sand-region")
		// merge overlapping rectangles (and height ranges), in document order
		const groups: ProcessRecord[][] = []
		for (const r of regs) {
			const hit = groups.filter((gr) =>
				gr.some(
					(q) =>
						(r.x0 as number) < (q.x1 as number) &&
						(q.x0 as number) < (r.x1 as number) &&
						(r.z0 as number) < (q.z1 as number) &&
						(q.z0 as number) < (r.z1 as number) &&
						(r.base as number) < (q.top as number) &&
						(q.base as number) < (r.top as number)
				)
			)
			if (hit.length === 0) groups.push([r])
			else {
				const merged = [...hit.flat(), r]
				for (const h of hit) groups.splice(groups.indexOf(h), 1)
				groups.push(merged)
			}
		}
		groups.sort((a, b) => this.records.indexOf(a[0] as ProcessRecord) - this.records.indexOf(b[0] as ProcessRecord))
		// the fixed solids a floor may stand on
		const exclude = new Set<string>()
		for (const r of this.records) for (const e of (r.exclude as string[] | undefined) ?? []) exclude.add(e)
		const statics = ctx.all().filter((h) => !h.dynamic && h.part.ghost !== true && !exclude.has(h.id))
		// the containers the regions name (a jar, a cup, a beaker, a box: their insides from their solids' outlines as the run starts)
		const holderCache = new Map<string, Holder | null>()
		const holderFor = (spec: Record<string, unknown>): Holder | null => {
			const item = spec.item as string
			if (holderCache.has(item)) return holderCache.get(item) ?? null
			const out = (id: unknown) => (typeof id === "string" ? ctx.solid(id)?.outline() : undefined)
			const fl = out(spec.floor)
			const left = ((spec.left as string[]) ?? []).map(out).filter((o) => o !== undefined)
			const right = ((spec.right as string[]) ?? []).map(out).filter((o) => o !== undefined)
			const all = ctx.all().filter((h) => h.item === item && h.part.ghost !== true).map((h) => h.outline())
			const H = fl === undefined ? null : holderOf({ item, round: spec.round === true, floor: fl, left, right, all, depth: spec.depth as number })
			holderCache.set(item, H)
			if (H !== null && ctx.all().some((h) => h.item === item && h.dynamic)) this.loose.add(item)
			return H
		}
		groups.forEach((gr, gi) => {
			let x0 = Number.POSITIVE_INFINITY
			let x1 = Number.NEGATIVE_INFINITY
			let z0 = Number.POSITIVE_INFINITY
			let z1 = Number.NEGATIVE_INFINITY
			let base = Number.POSITIVE_INFINITY
			let top = Number.NEGATIVE_INFINITY
			let cell = Number.POSITIVE_INFINITY
			for (const r of gr) {
				x0 = Math.min(x0, r.x0 as number)
				x1 = Math.max(x1, r.x1 as number)
				z0 = Math.min(z0, r.z0 as number)
				z1 = Math.max(z1, r.z1 as number)
				base = Math.min(base, r.base as number)
				top = Math.max(top, r.top as number)
				cell = Math.min(cell, r.cell as number)
			}
			// the containers its regions name that it reaches (in plan, and its floor between the regions' base and top): the bed grows to hold
			// each whole with its ring of wall, its columns no wider than a tenth of the narrowest's inside
			const hs: Holder[] = []
			for (const r of gr)
				for (const spec of (r.holders as Record<string, unknown>[] | undefined) ?? []) {
					const H = holderFor(spec)
					if (H === null || hs.some((q) => q.item === H.item)) continue
					const rx = H.rt + H.t
					const rz = (H.round ? H.k * (H.rt + H.t) : H.k * H.rt + H.t)
					if (H.x + rx < x0 || H.x - rx > x1 || rz < z0 || -rz > z1 || !(H.floor >= base && H.floor <= top)) continue
					hs.push(H)
				}
			for (const H of hs) cell = Math.min(cell, Math.max(0.002, H.rt / 10))
			const bx0 = x0
			const bx1 = x1
			const bz0 = z0
			const bz1 = z1
			// (no more than MAX_CELLS columns, the containers' rings counted)
			for (;;) {
				x0 = bx0
				x1 = bx1
				z0 = bz0
				z1 = bz1
				for (const H of hs) {
					const ring = holderRing(H, cell)
					x0 = Math.min(x0, H.x - (H.rt + ring) - cell)
					x1 = Math.max(x1, H.x + (H.rt + ring) + cell)
					const ez = H.k * (H.rt + ring) + cell
					z0 = Math.min(z0, -ez)
					z1 = Math.max(z1, ez)
				}
				if (Math.ceil((x1 - x0) / cell) * Math.ceil((z1 - z0) / cell) <= MAX_CELLS) break
				cell *= 1.25
			}
			const nx = Math.max(2, Math.ceil((x1 - x0) / cell))
			const nz = Math.max(2, Math.ceil((z1 - z0) / cell))
			const floor = new Float64Array(nx * nz)
			const kind = new Uint8Array(nx * nz)
			const by: string[] = new Array(nx * nz).fill("")
			const sids: string[] = new Array(nx * nz).fill("")
			this.scanFloor(statics, gr, x0, z0, cell, nx, nz, base, top, floor, kind, by, sids, hs)
			const first = gr[0] as ProcessRecord
			const bed = new Bed({ id: `bed${gi}`, owner: first.item as string, x0, z0, dx: cell, nx, nz, floor, kind, classes: this.classes, ceiling: top, gravity: g })
			this.world.addBed(bed)
			this.floorItem.set(bed, by)
			if (hs.length) this.holders.set(bed, hs)
			this.floorSolid.set(bed, sids)
			this.shown.push({ bed, item: first.item as string, cls: -2, last: new Float64Array(bed.n), lastT: -1, lastW: undefined, lastWT: -1 })
			let low = Number.POSITIVE_INFINITY
			for (let c = 0; c < bed.n; c++) if ((kind[c] as number) !== 2 && (floor[c] as number) < low) low = floor[c] as number
			if (!Number.isFinite(low)) low = base
			for (const r of gr) {
				const cells: number[] = []
				// (a pile's own cells: every column reaching into its rectangle, the grid's ragged last row too, so what spills to its edge is still
				// counted as its; the other roles' by their middles, as they were)
				const e = r.role === "pile" ? 0.5 * cell : 0
				for (let j = 0; j < nz; j++)
					for (let i = 0; i < nx; i++) {
						const x = bed.cx(i)
						const z = bed.cz(j)
						if (x + e >= (r.x0 as number) && x - e <= (r.x1 as number) && z + e >= (r.z0 as number) && z - e <= (r.z1 as number)) cells.push(j * nx + i)
					}
				// (its container: the one whose inside holds its middle, where its grains land or lie)
				const mx = 0.5 * ((r.x0 as number) + (r.x1 as number))
				const mz = 0.5 * ((r.z0 as number) + (r.z1 as number))
				const H = hs.find((q) => holderQ(q, mx, mz) <= q.rt) ?? null
				const inside: number[] = []
				const flat: number[] = []
				const edge: number[] = []
				if (H !== null) {
					// (its floor proper: out to r0, at least a column in; its edge: the floor's last column and a half)
					const r0 = Math.max(H.r0, 1.5 * cell)
					for (let j = 0; j < nz; j++)
						for (let i = 0; i < nx; i++) {
							const c = j * nx + i
							if ((kind[c] as number) !== 0) continue
							const q = holderQ(H, bed.cx(i), bed.cz(j))
							if (q > H.rt) continue
							inside.push(c)
							if (q <= r0) {
								flat.push(c)
								if (q > r0 - 1.5 * cell) edge.push(c)
							}
						}
				}
				this.regions.push({
					record: r, item: r.item as string, bed, cells: Int32Array.from(cells), baseline: new Float64Array(cells.length), startTop: 0, collapsed: false, support: null,
					holder: H, holderCells: Int32Array.from(inside), holderFloor: Int32Array.from(flat), holderEdge: Int32Array.from(edge), mine: null, spillTold: false, low
				})
			}
			// (what a region in a container reads outside it: its own cells and the margin the bed grew round its containers beyond every region's
			// rectangle, where grains glancing off a container's rim or thrown past its wall come down: once only its own cells were read, and
			// what lay in that margin was in neither heap_g nor outside_g)
			const ours = this.regions.filter((q) => q.bed === bed)
			if (ours.some((q) => q.holder !== null)) {
				const claimed = new Uint8Array(nx * nz)
				for (const q of ours) for (const c of q.cells) claimed[c] = 1
				for (const q of ours) {
					if (q.holder === null) continue
					const m = new Uint8Array(nx * nz)
					for (let c = 0; c < m.length; c++) if (claimed[c] === 0) m[c] = 1
					for (const c of q.cells) m[c] = 1
					q.mine = m
				}
			}
		})
		// the deposits, in document order (each region's baseline is the surface before its own)
		for (const reg of [...this.regions].sort((a, b) => this.records.indexOf(a.record) - this.records.indexOf(b.record))) {
			reg.cells.forEach((c, k) => {
				reg.baseline[k] = reg.bed.surface(c)
			})
			this.deposit(reg, ctx)
			if (reg.record.role === "pile") reg.startTop = this.pileOf(reg).top
		}
		// vessels
		for (const r of this.records.filter((q) => q.kind === "sand-vessel")) {
			const bed = vesselBed({
				id: r.id,
				owner: r.item as string,
				cx: r.cx as number,
				base: r.base as number,
				shape: r.shape as "cone" | "bowl",
				R: r.R as number,
				rOut: finite(r.rOut) ? (r.rOut as number) : 0,
				wall: finite(r.wall) ? (r.wall as number) : 60,
				top: r.top as number,
				dx: r.cell as number,
				classes: this.classes,
				gravity: g
			})
			this.world.addBed(bed)
			this.shown.push({ bed, item: r.item as string, cls: -2, last: new Float64Array(bed.n), lastT: -1, lastW: undefined, lastWT: -1 })
			const k = this.classIndex(r)
			const mass = Math.max(0, r.mass as number)
			if (mass > 0) {
				// (more grains than the funnel or the timer's top bulb holds: it is filled to its brim, and the run says so)
				const rhoB = (this.classes[k] as ClassInfo).rhoB
				const fitted = fillLevel(bed, k, mass / rhoB) * rhoB
				if (fitted < 0.99 * mass)
					ctx.event(
						`only ${Math.round(fitted * 1000)} g of the ${Math.round(mass * 1000)} g of grains fits in ${r.item}${r.role === "funnel" ? "" : "'s top bulb"}: it is filled to the brim`,
						[r.item as string],
						"overfilled"
					)
			}
			const o = r.outlet as { diameter?: number; delay?: number } | null | undefined
			let outlet: Outlet | undefined
			if (o && finite(o.diameter) && o.diameter > 0) {
				outlet = {
					id: `${r.id}/outlet`,
					item: r.item as string,
					// (the outlet's own columns: its hole, or the column it is in and the ring round it when it is narrower than a column, so the
					// funnel's bottom drains completely)
					cells: cellsWithin(bed, r.cx as number, Math.max(o.diameter / 2, (r.rOut as number) || 0, 1.5 * (r.cell as number))),
					diameter: o.diameter,
					x: r.cx as number,
					y: r.base as number,
					z: 0,
					opensAt: Number.POSITIVE_INFINITY,
					out: 0,
					pending: this.classes.map(() => 0),
					outMass: 0,
					jammed: false,
					everJammed: false,
					choked: false,
					rate: 0,
					massRate: 0
				}
				bed.outlets.push(outlet)
			}
			this.vessels.push({ record: r, item: r.item as string, bed, outlet, startMass: bed.mass(), emptied: false, emptyAt: -1, openedAt: -1, clogTold: false, startTold: false, jammedFor: 0 })
		}
		// cups of grains a hand tips (a pitcher of sugar: the flow module tips it, these grains pour from it)
		for (const r of this.records.filter((q) => q.kind === "sand-pour")) {
			const k = this.classIndex(r)
			const ci = this.classes[k] as ClassInfo
			const cup = new TipCup(r.inside as { x: number; y: number }[], r.depth as number, Math.max(0, r.volume as number), ci.tanRepose, ci.grain.d)
			const a0 = ctx.solid(r.solid as string)?.pose().angle ?? 0
			this.pours.push({ record: r, item: r.item as string, cup, cls: k, a0, pending: 0, pouredKg: 0, rate: 0, lastEmit: -1, startTold: false, emptyTold: false, lastKey: -1, lastRow: "" })
			// (its landing bed: what of its stream comes down on another bed is counted there, outside its container)
			const home = this.regions.find((q) => q.item === r.item && q.record.role === "landing")
			if (home !== undefined) this.world.homeOf.set(r.item as string, home.bed.id)
			if (finite(r.asked) && (r.asked as number) > cup.volume() * 1e6 + 0.5)
				ctx.event(`only ${Math.round(cup.volume() * 1e6)} mL of ${ci.grain.name} fits in ${r.item} (not ${Math.round(r.asked as number)} mL): it is filled to the brim`, [r.item as string], "brim", 0)
		}
		// water
		for (const r of this.records.filter((q) => q.kind === "sand-water")) {
			const region = this.regions.find((q) => q.record.id === r.region)
			if (region === undefined) continue
			const bed = region.bed
			const plants = new Map<number, number>()
			for (const p of (r.plants as { x0: number; x1: number; tau: number }[] | null) ?? []) {
				for (const c of region.cells) {
					const i = c % bed.nx
					const x = bed.cx(i)
					if (x >= p.x0 && x <= p.x1 && bed.h[c]! > 0) plants.set(c, p.tau)
				}
			}
			const ci = this.classes[this.classIndex(region.record)] as ClassInfo
			const water = new Water(bed, {
				sources: (r.sources as { x: number; z: number; rate: number }[]).map((s) => ({ x: s.x, z: s.z, rate: s.rate, from: 0 })),
				drainX: r.drainX as number,
				lake: r.lake as number,
				plants,
				n: manningN(ci.grain)
			})
			const dep = region.record.deposit as { toe?: number }
			this.waters.push({ record: r, water, region, toe: finite(dep?.toe) ? dep.toe : region.record.x1 as number })
		}
		for (const b of this.world.beds) b.mark()
	}

	/** The floor of a region group's columns: the top of the highest fixed solid reaching into [., top], and the extra walls. */
	private scanFloor(
		statics: readonly SolidHandle[],
		gr: readonly ProcessRecord[],
		x0: number,
		z0: number,
		dx: number,
		nx: number,
		nz: number,
		base: number,
		top: number,
		floor: Float64Array,
		kind: Uint8Array,
		by: string[],
		sids: string[],
		holders: readonly Holder[] = []
	) {
		const NONE = Number.NEGATIVE_INFINITY
		floor.fill(NONE)
		// (a container's own solids are not its floor: its inside is (holders, below); in a side view its walls are slabs as deep as it is,
		// which a round jar's are not, front and back)
		const own = new Set(holders.map((H) => H.item))
		const shapes = statics
			.filter((h) => !own.has(h.item))
			.map((h) => {
				const o = h.outline()
				const depth = h.part.body.kind === "ball" ? 2 * (o.circle?.r ?? 0) : (h.part.body as { depth: number }).depth
				return { o, half: depth / 2, item: h.item, id: h.id }
			})
		for (let i = 0; i < nx; i++) {
			const x = x0 + (i + 0.5) * dx
			// each solid's span at this x: [lo, hi]
			const spans: { lo: number; hi: number; half: number; item: string; id: string }[] = []
			for (const s of shapes) {
				if (s.o.circle !== undefined) {
					const c = s.o.circle
					const ex = x - c.x
					if (Math.abs(ex) >= c.r) continue
					const dy = Math.sqrt(c.r * c.r - ex * ex)
					spans.push({ lo: c.y - dy, hi: c.y + dy, half: s.half, item: s.item, id: s.id })
					continue
				}
				const pts = s.o.points ?? []
				let lo = Number.POSITIVE_INFINITY
				let hi = Number.NEGATIVE_INFINITY
				for (let k = 0; k < pts.length; k++) {
					const a = pts[k] as { x: number; y: number }
					const b = pts[(k + 1) % pts.length] as { x: number; y: number }
					if ((x < a.x && x < b.x) || (x > a.x && x > b.x)) continue
					const y = a.x === b.x ? Math.max(a.y, b.y) : a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y)
					const y2 = a.x === b.x ? Math.min(a.y, b.y) : y
					if (y > hi) hi = y
					if (y2 < lo) lo = y2
				}
				if (hi > lo) spans.push({ lo, hi, half: s.half, item: s.item, id: s.id })
			}
			for (let j = 0; j < nz; j++) {
				const z = z0 + (j + 0.5) * dx
				let f = NONE
				let who = ""
				let sid = ""
				for (const s of spans)
					if (Math.abs(z) <= s.half && s.lo <= top && s.hi > f) {
						f = s.hi
						who = s.item
						sid = s.id
					}
				floor[j * nx + i] = f
				by[j * nx + i] = who
				sids[j * nx + i] = sid
			}
		}
		const barrier = new Set<number>()
		// (a container's inside holds grains up to its rim, even where the region's top (just under a pourer: a cup held low, its bottom below a
		// bowl's rim) is lower: a tapered cup's or a bowl's leaning wall over that top was a wall, and grains landing on it rolled out of it)
		const inner = new Set<number>()
		// the containers: inside one, its floor (and a tapered cup's leaning wall) unless something stands higher in it; its ring of wall, round or
		// square, all the way round (front and back too), as high as its rim
		for (const H of holders) {
			const ring = holderRing(H, dx)
			for (let j = 0; j < nz; j++)
				for (let i = 0; i < nx; i++) {
					const c = j * nx + i
					const q = holderQ(H, x0 + (i + 0.5) * dx, z0 + (j + 0.5) * dx)
					if (q <= H.rt) {
						const f = holderFloor(H, q)
						if (f >= (floor[c] as number)) {
							floor[c] = f
							by[c] = H.item
							inner.add(c)
						}
					} else if (q <= H.rt + ring) {
						floor[c] = Math.max(floor[c] as number, H.rim)
						by[c] = H.item
						barrier.add(c)
					}
				}
		}
		for (const r of gr)
			for (const w of (r.walls as { x0: number; x1: number; z0: number; z1: number; top: number }[] | undefined) ?? []) {
				for (let j = 0; j < nz; j++)
					for (let i = 0; i < nx; i++) {
						const x = x0 + (i + 0.5) * dx
						const z = z0 + (j + 0.5) * dx
						// (a barrier is a wall: it holds no grains and nothing flows into it)
						if (x >= w.x0 && x <= w.x1 && z >= w.z0 && z <= w.z1) {
							floor[j * nx + i] = Math.max(floor[j * nx + i] as number, w.top)
							barrier.add(j * nx + i)
						}
					}
			}
		// walls (taller than the region) and edges (no floor: off a table's edge)
		let low = Number.POSITIVE_INFINITY
		for (let c = 0; c < floor.length; c++) if ((floor[c] as number) > NONE && (floor[c] as number) < low) low = floor[c] as number
		if (!Number.isFinite(low)) low = base
		for (let c = 0; c < floor.length; c++) {
			const f = floor[c] as number
			if (f === NONE) {
				kind[c] = 2
				floor[c] = low - 0.5
			} else if ((f > top && !inner.has(c)) || barrier.has(c)) kind[c] = 1
		}
	}

	/**
	 * What a heap laid at (x, z) stands on: the bed's cells joined to the one under its middle without a drop of more than a column and a half
	 * (or 6 mm) between neighbours (steps up and a ramp's slope are joined; the edge of a shelf or of a plank over the table is not): 1 in the
	 * mask. Null when its middle has no floor of its own (it is laid as before, on whatever is there).
	 */
	private supportOf(b: Bed, x: number, z: number): Uint8Array | null {
		const c0 = b.cellAt(x, z)
		if (c0 < 0 || (b.kind[c0] as number) !== 0) return null
		const drop = Math.max(1.5 * b.dx, 0.006)
		const mask = new Uint8Array(b.n)
		mask[c0] = 1
		const queue = [c0]
		for (let q = 0; q < queue.length; q++) {
			const c = queue[q] as number
			const i = c % b.nx
			const j = (c - i) / b.nx
			const f = b.floor[c] as number
			for (const [ii, jj] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]] as const) {
				if (ii < 0 || jj < 0 || ii >= b.nx || jj >= b.nz) continue
				const n = jj * b.nx + ii
				if (mask[n] === 1 || (b.kind[n] as number) !== 0 || (b.floor[n] as number) < f - drop) continue
				mask[n] = 1
				queue.push(n)
			}
		}
		return mask
	}

	private deposit(reg: Region, ctx: ProcessContext) {
		const r = reg.record
		const d = r.deposit as Record<string, number | string>
		const b = reg.bed
		const k = this.classIndex(r)
		const ci = this.classes[k] as ClassInfo
		const inside = new Set(reg.cells)
		const A = b.dx * b.dx
		const dz = finite(d.z) ? (d.z as number) : 0
		if (d.shape === "cone" && finite(d.mass) && (d.mass as number) > 0) {
			// (laid on what it stands on, all of its mass; a heap wider than a raised shelf or plank then runs off its edge before the run, as it
			// would have while it was poured: what spills lands below it (the table) or falls off the bed's edge, and is said)
			const sup = this.supportOf(b, d.x as number, dz)
			const before = sup !== null ? Float64Array.from(b.h) : null
			heapCone(b, k, (d.mass as number) / ci.rhoB, d.x as number, dz, ci.tanRepose, sup !== null ? (c) => sup[c] === 1 : undefined)
			if (sup !== null && before !== null) {
				// (it reaches its support's edge where a column of it has grains and a neighbour beyond it lies lower than it joins)
				let atEdge = false
				for (let c = 0; c < b.n && !atEdge; c++) {
					if (sup[c] !== 1 || !((b.h[c] as number) > (before[c] as number))) continue
					const i = c % b.nx
					const j = (c - i) / b.nx
					for (const [ii, jj] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]] as const) {
						if (ii < 0 || jj < 0 || ii >= b.nx || jj >= b.nz) continue
						const n = jj * b.nx + ii
						if (sup[n] !== 1 && (b.kind[n] as number) !== 1) {
							atEdge = true
							break
						}
					}
				}
				if (atEdge) {
					this.world.settleBed(b, FLOW_EVERY * ctx.step, 3)
					reg.support = sup
					const p = this.pileOf(reg)
					const spilled = Math.max(0, (d.mass as number) - p.mass)
					if (spilled >= Math.max(0.001, 0.01 * (d.mass as number))) {
						const c0 = b.cellAt(d.x as number, dz)
						const on = (c0 >= 0 ? this.floorItem.get(b)?.[c0] : "") || "what it stands on"
						ctx.event(`${reg.item} does not fit on ${on}: ${Math.round(spilled * 1000)} g of its grains spill off the edge`, [reg.item, ...(on !== "what it stands on" ? [on] : [])], "spilled")
					}
				}
			}
		} else if (d.shape === "castle" && finite(d.radius) && finite(d.height)) {
			// (built on what it stands on: never down to the table under a shelf's edge)
			const sup = this.supportOf(b, d.x as number, dz)
			for (const c of reg.cells) {
				if (sup !== null && sup[c] !== 1) continue
				const i = c % b.nx
				const j = (c - i) / b.nx
				const ex = b.cx(i) - (d.x as number)
				const ez = b.cz(j) - dz
				if (ex * ex + ez * ez <= (d.radius as number) * (d.radius as number) && (b.kind[c] as number) === 0) b.add(c, k, (d.height as number) * A)
			}
		} else if (d.shape === "layer" && finite(d.depth)) {
			for (const c of reg.cells) if ((b.kind[c] as number) === 0) b.add(c, k, Math.max(0, d.depth as number) * A)
		} else if (d.shape === "slope" && finite(d.depth) && finite(d.toe)) {
			const from = finite(d.from) ? (d.from as number) : (r.x0 as number)
			const dir = (d.toe as number) >= from ? 1 : -1
			for (const c of reg.cells) {
				if ((b.kind[c] as number) !== 0) continue
				const i = c % b.nx
				const j = (c - i) / b.nx
				const x = b.cx(i)
				const past = (x - (d.toe as number)) * dir
				const before = (x - from) * dir
				if (before < 0) continue
				let t = past <= 0 ? (d.depth as number) : (d.depth as number) - past * ci.tanRepose
				// (a few tenths of a millimetre of ripple, the same everywhere: where the first rill starts)
				const hsh = ((((i * 73856093) ^ (j * 19349663)) >>> 0) % 1000) / 1000
				t += (hsh - 0.5) * 0.0006
				if (t > 0) b.add(c, k, t * A)
			}
		}
		void inside
	}

	/** A pile's numbers over its own cells, above its baseline (over its support's cells when it spilled off a shelf: `off`, the mass beyond). */
	pileOf(reg: Region) {
		const b = reg.bed
		let top = 0
		let cells = 0
		let vol = 0
		let off = 0
		const A = b.dx * b.dx
		const sup = reg.support
		reg.cells.forEach((c, k) => {
			const d = b.surface(c) - (reg.baseline[k] as number)
			if (sup !== null && sup[c] !== 1) {
				if (d > 0) off += d * A
				return
			}
			if (d > top) top = d
			if (d > 0.001) cells++
			if (d > 0) vol += d * A
		})
		const radius = Math.sqrt((cells * A) / Math.PI)
		const slope = radius > 0 && top > 0.001 ? (Math.atan2(top - 0.001, radius) * 180) / Math.PI : 0
		const ci = this.classes[this.classIndex(reg.record)] as ClassInfo
		return { top, radius, slope, mass: vol * ci.rhoB, off: off * ci.rhoB }
	}

	/** One engine step. */
	step(ctx: ProcessContext) {
		const t = ctx.time()
		const h = ctx.step
		if (!this.released && ctx.released()) {
			this.released = true
			this.releasedAt = t
			for (const v of this.vessels) {
				if (v.outlet === undefined) continue
				const o = v.record.outlet as { delay?: number }
				const at = t + (finite(o?.delay) ? Math.max(0, o.delay) : 0)
				;(v.outlet as { opensAt: number }).opensAt = at
				v.openedAt = at
			}
		}
		// (nothing moves before the release: the scene's first picture is its start, as for every body)
		if (this.released) {
			this.world.pour(t, h, ctx.settings.timeLapse)
			// (an hourglass's clock runs only while its sand can run: not while its neck is jammed)
			for (const v of this.vessels) if (v.outlet !== undefined && v.outlet.jammed && !v.emptied && v.openedAt >= 0 && t >= v.openedAt) v.jammedFor += h
			// (the grains' avalanches 240 times a second, sub-stepped as fast as they flow; falling grains and bodies every step)
			if (this.steps % FLOW_EVERY === 0) this.world.flow(FLOW_EVERY * h)
			this.tipCups(ctx, t, h)
			this.world.fly(h)
			if (this.steps % WATER_EVERY === 0) for (const w of this.waters) w.water.step(WATER_EVERY * h, t, ctx.settings.timeLapse)
		}
		if (this.steps % READ_EVERY === 0) this.read(ctx)
		this.show(ctx)
		this.steps++
	}

	/** The cups of grains: each turns with the hand that tips it (its root solid's pose now) and lets out what is over its lip, launched from
	 *  the lip as parcels (a parcel of up to about 2 g, at least one every 1/60 s while it pours) along the way its grains slide. */
	tipCups(ctx: ProcessContext, t: number, h: number) {
		const g = ctx.settings.gravity
		for (const p of this.pours) {
			const sh = ctx.solid(p.record.solid as string)
			if (sh === undefined) continue
			const pose = sh.pose()
			const ci = this.classes[p.cls] as ClassInfo
			const out = p.cup.step(pose.angle, h, g)
			if (out > 0) {
				p.pending += out
				p.pouredKg += out * ci.rhoB
				if (!p.startTold) {
					p.startTold = true
					const deg = Math.round((Math.abs(pose.angle - p.a0) * 180) / Math.PI)
					ctx.event(`${p.item} starts pouring its ${ci.grain.name}: tipped ${deg}°, past what its grains stand at`, [p.item], "pours")
				}
			}
			const a = Math.min(1, h / 0.1)
			p.rate += ((h > 0 ? (out * ci.rhoB) / h : 0) - p.rate) * a
			if (p.pending > 0 && (p.pending >= 1.2e-6 || t - p.lastEmit >= 1 / 60 || !(p.cup.area > 0))) {
				const c = p.cup.cornerAt(pose.x, pose.y, pose.angle)
				const off = ((p.record.wall as number | undefined) ?? 0.002) + 0.001
				const v = Math.max(p.cup.speed, 0.05)
				this.world.parcels.push({
					x: c.x + p.cup.ux * off, y: c.y + p.cup.uy * off, z: 0, vx: v * p.cup.ux, vy: v * p.cup.uy, vz: 0, vol: p.pending, grain: ci.grain.key, wet: ci.wet, age: 0, src: p.item
				})
				this.world.thrown++
				p.pending = 0
				p.lastEmit = t
			}
			if (p.startTold && !p.emptyTold && p.cup.area <= 0.002 * p.cup.start) {
				p.emptyTold = true
				ctx.event(`${p.item} is empty: all its ${ci.grain.name} has poured out`, [p.item], "emptied")
			}
		}
	}

	/** Bodies in the sand (after the release, every (sub-)step). */
	press(ctx: ProcessContext, h: number) {
		const links: BodyLink[] = []
		for (const s of ctx.all()) {
			if (!s.dynamic || s.part.ghost === true) continue
			const near = this.world.beds.some((b) => {
				const o = s.outline()
				let xa: number
				let xb: number
				let ylo: number
				if (o.circle !== undefined) {
					xa = o.circle.x - o.circle.r
					xb = o.circle.x + o.circle.r
					ylo = o.circle.y - o.circle.r
				} else {
					xa = Number.POSITIVE_INFINITY
					xb = Number.NEGATIVE_INFINITY
					ylo = Number.POSITIVE_INFINITY
					for (const p of o.points ?? []) {
						if (p.x < xa) xa = p.x
						if (p.x > xb) xb = p.x
						if (p.y < ylo) ylo = p.y
					}
				}
				return xb >= b.x0 && xa <= b.x0 + b.nx * b.dx && ylo <= b.ceiling + 0.05
			})
			if (!near) continue
			const depth = s.part.body.kind === "ball" ? 2 * ((s.part.body as { radius: number }).radius ?? 0) : (s.part.body as { depth: number }).depth
			links.push({
				id: s.id,
				item: s.item,
				depth,
				outline: () => s.outline(),
				view: () => s.body(),
				push: (fx, fy, at) => s.push(fx, fy, at),
				twist: (t) => s.twist(t),
				halt: () => s.setVelocity(0, 0, 0)
			})
		}
		if (links.length) this.world.press(links, h)
	}

	/** The readings (and the events they make). */
	read(ctx: ProcessContext) {
		const t = ctx.time()
		const lapse = ctx.settings.timeLapse
		for (const reg of this.regions) {
			const role = reg.record.role
			if ((role === "pile" || role === "landing") && reg.holder !== null) {
				// (in a container: the heap inside it, a cone on the bed that fills it once its foot reaches the wall; what lies outside it, spilled:
				// on its columns of the bed outside the container, gone off the bed's edges, and, of a cup's stream, what came down on another bed,
				// fell past every bed or is falling below this one's floor, so heap_g + outside_g is everything poured that is not still in the air
				// over it (a stream thrown past its landing bed was once in neither: 56 g of a cup's 160 g of sugar))
				const b = reg.bed
				const p = heapIn(b, reg.holderCells, reg.holderEdge, reg.holderFloor)
				let out = 0
				const inside = new Set(reg.holderCells)
				const A = b.dx * b.dx
				const mine = reg.mine
				for (let c = 0; c < b.n; c++) {
					if ((b.kind[c] as number) !== 0 || inside.has(c) || (mine !== null && mine[c] !== 1)) continue
					for (let k = 0; k < b.classes.length; k++) out += ((b.hk[k] as Float64Array)[c] as number) * A * (b.classes[k] as ClassInfo).rhoB
				}
				out += b.droppedMass
				if (role === "landing" && this.pours.some((q) => q.item === reg.item)) {
					const rho = (this.classes[this.classIndex(reg.record)] as ClassInfo).rhoB
					let gone = (this.world.lostOf.get(reg.item) ?? 0) + (this.world.strayOf.get(reg.item) ?? 0)
					for (const q of this.world.parcels) if (q.src === reg.item && q.y < reg.low - 0.01) gone += q.vol
					out += gone * rho
				}
				if (role === "pile") {
					ctx.set(reg.item, "height_mm", p.top * 1000)
					ctx.set(reg.item, "width_mm", 2 * p.radius * 1000)
					ctx.set(reg.item, "angle_deg", p.slope)
					ctx.set(reg.item, "mass_g", p.mass * 1000)
					ctx.set(reg.item, "spilled_g", out * 1000)
				} else {
					ctx.set(reg.item, "heap_mm", p.top * 1000)
					ctx.set(reg.item, "heap_deg", p.slope)
					ctx.set(reg.item, "heap_g", p.mass * 1000)
					ctx.set(reg.item, "outside_g", out * 1000)
					// (a gram outside it is said once, so a card's "in the run" and a director's shots tell the spill, never only the heap inside)
					if (!reg.spillTold && out >= 0.001) {
						reg.spillTold = true
						const name = (this.classes[this.classIndex(reg.record)] as ClassInfo).grain.name
						ctx.event(`${reg.item} spills ${name} outside ${reg.holder.item}`, [reg.item, reg.holder.item], "spilled")
					}
				}
			} else if (role === "pile") {
				const p = this.pileOf(reg)
				ctx.set(reg.item, "height_mm", p.top * 1000)
				ctx.set(reg.item, "width_mm", 2 * p.radius * 1000)
				ctx.set(reg.item, "angle_deg", p.slope)
				ctx.set(reg.item, "mass_g", p.mass * 1000)
				ctx.set(reg.item, "spilled_g", p.off * 1000)
				const d = reg.record.deposit as { shape?: string }
				if (d?.shape === "castle" && !reg.collapsed && reg.startTop > 0 && p.top < 0.7 * reg.startTop) {
					reg.collapsed = true
					ctx.event(`${reg.item} collapses`, [reg.item], "collapsed")
				}
			} else if (role === "landing") {
				// (the heap a funnel pours: its height over where it lies, its slope and its grains, as a pile's)
				const p = this.pileOf(reg)
				ctx.set(reg.item, "heap_mm", p.top * 1000)
				ctx.set(reg.item, "heap_deg", p.slope)
				ctx.set(reg.item, "heap_g", p.mass * 1000)
			} else if (role === "tray") {
				const inside = new Set(reg.cells)
				const cs = craterStats(reg.bed, (c) => inside.has(c))
				let depth = 0
				let n = 0
				for (const c of reg.cells) {
					if ((reg.bed.kind[c] as number) !== 0) continue
					depth += reg.bed.h[c] as number
					n++
				}
				ctx.set(reg.item, "crater_mm", cs.diameter * 1000)
				ctx.set(reg.item, "crater_depth_mm", cs.depth * 1000)
				if (cs.diameter >= 0.01 && !this.told.has(`crater:${reg.item}`)) {
					this.told.add(`crater:${reg.item}`)
					ctx.event(`a crater opens in ${reg.item}`, [reg.item], "crater")
				}
				ctx.set(reg.item, "sand_mm", n > 0 ? (depth / n) * 1000 : 0)
			}
			if (reg.bed.dropped > 0.005 / reg.bed.classes[0]!.rhoB && !this.spilledTold.has(reg.bed.id)) {
				this.spilledTold.add(reg.bed.id)
				ctx.event(`sand spills off the edge by ${reg.item}`, [reg.item], "spilled")
			}
		}
		for (const v of this.vessels) {
			const role = v.record.role
			const m = v.bed.mass()
			const o = v.outlet
			// (its start, once its grains run: a funnel's pour or a timer's stream, at Beverloo's rate, so a card can say what the sand does)
			if (o !== undefined && !v.startTold && v.openedAt >= 0 && t >= v.openedAt && o.outMass > 0 && !o.jammed) {
				v.startTold = true
				const k = this.classIndex(v.record)
				const ci = this.classes[k] as ClassInfo
				const W = beverlooRate(ci.grain, ci.wet, o.diameter, ctx.settings.gravity) * ci.rhoB * 1000
				const rate = W >= 10 ? `${Math.round(W)}` : `${Math.round(W * 10) / 10}`
				const per = ctx.settings.timeLapse > 1 ? "a lesson second" : "a second"
				ctx.event(role === "funnel" ? `${v.item} starts pouring: about ${rate} g ${per}` : `${v.item} starts running: about ${rate} g ${per} through its ${Math.round(o.diameter * 10000) / 10} mm neck`, [v.item], "pours")
			}
			if (role === "funnel") {
				ctx.set(v.item, "left_g", m * 1000)
				ctx.set(v.item, "poured_g", (o?.outMass ?? 0) * 1000)
				ctx.set(v.item, "flow_gs", (o?.massRate ?? 0) * 1000)
				ctx.set(v.item, "clogged", o?.jammed && m > 0.0005 ? 1 : 0)
				if (o?.jammed && m > 0.0005 && !v.clogTold) {
					v.clogTold = true
					ctx.event(`${v.item} clogs: its grains jam in the spout`, [v.item], "clogged")
				}
				if (!v.emptied && v.startMass > 0 && m < 0.005 * v.startMass && t > v.openedAt && v.openedAt >= 0) {
					v.emptied = true
					ctx.event(`${v.item} runs empty`, [v.item], "emptied")
				}
			} else if (role === "hourglass-top") {
				const bottom = this.vessels.find((q) => q.item === v.item && q.record.role === "hourglass-bottom")
				ctx.set(v.item, "top_g", m * 1000)
				ctx.set(v.item, "bottom_g", (bottom ? bottom.bed.mass() : 0) * 1000)
				ctx.set(v.item, "flow_gs", (o?.massRate ?? 0) * 1000 / Math.max(1, lapse))
				// (a neck too narrow for its grains: they arch over it and nothing runs: the timer is stuck, its clock stopped, and the run says so)
				const jam = o?.jammed === true && m > 0.0005
				ctx.set(v.item, "clogged", jam ? 1 : 0)
				if (jam && !v.clogTold && o !== undefined) {
					v.clogTold = true
					ctx.event(`${v.item} jams: its grains arch over the ${Math.round(o.diameter * 10000) / 10} mm neck`, [v.item], "clogged")
				}
				const running = v.openedAt >= 0 && t >= v.openedAt
				if (!v.emptied && running && v.startMass > 0 && m < Math.max(0.003 * v.startMass, 5e-5)) {
					v.emptied = true
					v.emptyAt = t
					// (its own clock: lesson seconds, the time-lapse's, when the scene has one)
					const ran = ((t - v.openedAt) * lapse).toFixed(1)
					ctx.event(lapse > 1 ? `${v.item} runs out after ${ran} lesson seconds` : `${v.item} runs out after ${ran} s`, [v.item], "emptied")
				}
				const end = v.emptied ? v.emptyAt : t
				ctx.set(v.item, "run_s", running ? Math.max(0, end - v.openedAt - v.jammedFor) * lapse : 0)
				ctx.set(v.item, "empty", v.emptied ? 1 : 0)
			}
		}
		for (const p of this.pours) {
			const ci = this.classes[p.cls] as ClassInfo
			ctx.set(p.item, "left_g", p.cup.volume() * ci.rhoB * 1000)
			ctx.set(p.item, "poured_g", p.pouredKg * 1000)
			ctx.set(p.item, "flow_gs", p.rate * 1000)
			const lx = this.world.lands.get(p.item)
			if (lx !== undefined) ctx.set(p.item, "lands_x", lx)
		}
		for (const w of this.waters) {
			const reg = w.region
			const b = reg.bed
			const ci = this.classes[this.classIndex(reg.record)] as ClassInfo
			const A = b.dx * b.dx
			let moved = 0
			let deep = 0
			let front = Number.NEGATIVE_INFINITY
			const dep = reg.record.deposit as { from?: number; toe?: number }
			const dir = finite(dep?.toe) && finite(dep?.from) && (dep.toe as number) < (dep.from as number) ? -1 : 1
			for (const c of reg.cells) {
				if ((b.kind[c] as number) !== 0) continue
				const d = (b.h0[c] as number) - (b.h[c] as number)
				if (d > 0) moved += d
				if (d > deep) deep = d
				if (-d > 0.002) {
					const x = b.cx(c % b.nx) * dir
					if (x > front) front = x
				}
			}
			// (eroded: the sand gone from where it lay, net: what the water carried off the slope and dropped further on, or out)
			ctx.set(reg.item, "eroded_g", moved * A * ci.rhoB * 1000)
			ctx.set(reg.item, "delta_cm", Number.isFinite(front) ? Math.max(0, front - w.toe * dir) * 100 : 0)
			ctx.set(reg.item, "channel_mm", deep * 1000)
			if (moved * A * ci.rhoB >= 0.02 && !this.told.has(`erodes:${reg.item}`)) {
				this.told.add(`erodes:${reg.item}`)
				ctx.event(`the water starts carrying sand down ${reg.item}`, [reg.item], "eroding")
			}
			if (Number.isFinite(front) && front - w.toe * dir >= 0.01 && !this.told.has(`delta:${reg.item}`)) {
				this.told.add(`delta:${reg.item}`)
				ctx.event(`the washed-off sand builds a delta in ${reg.item}'s pool`, [reg.item], "delta")
			}
			const rate = (w.record.sources as { rate: number }[]).reduce((s, x) => s + x.rate, 0)
			ctx.set(reg.item, "water_lpm", this.released ? rate * 60000 : 0)
		}
	}

	/** Keyframes for the view: grids once, heights where they changed (up to 20 a second), water (10 a second), the falling grains (30). */
	show(ctx: ProcessContext) {
		const t = ctx.time()
		// the cups of grains: the surface of what is in each (its normal and offset in the cup's frame), 30 a second while it changes
		for (const p of this.pours) {
			if (p.lastKey >= 0 && t - p.lastKey < 1 / 30 - 1e-9) continue
			const ang = Number.isFinite(p.cup.angle) ? p.cup.angle : p.a0
			const row = [Math.round(p.cup.nx * 1e5) / 1e5, Math.round(p.cup.ny * 1e5) / 1e5, Math.round(p.cup.c * 1e5) / 1e5, Math.round(p.cup.area * 1e7) / 1e7, Math.round(ang * 1e5) / 1e5]
			const key = row.join(",")
			if (key === p.lastRow) continue
			ctx.keyframe(p.item, "cup", row)
			p.lastRow = key
			p.lastKey = t
		}
		for (const s of this.shown) {
			const b = s.bed
			if (s.lastT < 0) {
				// (its containers, once: for each, round 1 or a box 0, its axis x, floor, r0, rb, ylo, rt, yhi, wall, rim, k, ring)
				const hs = this.holders.get(b)
				if (hs !== undefined && hs.length > 0) {
					const row: number[] = [hs.length]
					for (const H of hs) row.push(H.round ? 1 : 0, H.x, H.floor, H.r0, H.rb, H.ylo, H.rt, H.yhi, H.t, H.rim, H.k, holderRing(H, b.dx))
					ctx.keyframe(s.item, `holders:${b.id}`, row)
				}
				const gi = this.classes.map((c) => GRAIN_KEYS.indexOf(c.grain.key))
				const wi = this.classes.map((c) => WETNESS.indexOf(c.wet))
				// (the floor in tenths of a millimetre over its lowest point, as runs of equal steps from column to column; the kinds as runs)
				let base = Number.POSITIVE_INFINITY
				for (let c = 0; c < b.n; c++) if ((b.kind[c] as number) !== 1 && (b.floor[c] as number) < base) base = b.floor[c] as number
				if (!Number.isFinite(base)) base = 0
				const fl: number[] = []
				for (let c = 0; c < b.n; c++) fl.push(Math.round(((b.floor[c] as number) - base) * 1e4))
				const steps: number[] = fl.map((v, c) => (c === 0 ? v : v - (fl[c - 1] as number)))
				const kinds: number[] = Array.from(b.kind)
				const fr = rle(steps)
				const kr = rle(kinds)
				const row: number[] = [b.x0, b.z0, b.dx, b.nx, b.nz, this.classes.length, ...gi, ...wi, Math.round(base * 1e5) / 1e5, fr.length / 2, ...fr, kr.length / 2, ...kr]
				ctx.keyframe(s.item, `grid:${b.id}`, row)
			}
			if (s.lastT < 0 || t - s.lastT >= 0.05) {
				// the changed rectangle; a keyframe when something changed by 1 mm (up to 20 a second) or by 0.1 mm a quarter second on
				let i0 = b.nx
				let i1 = -1
				let j0 = b.nz
				let j1 = -1
				let most = 0
				for (let c = 0; c < b.n; c++) {
					const v = Math.round((b.h[c] as number) * 1e4) / 10
					const d = s.lastT >= 0 ? Math.abs(v - (s.last[c] as number)) : 1
					if (d < 0.1) continue
					if (d > most) most = d
					const i = c % b.nx
					const j = (c - i) / b.nx
					if (i < i0) i0 = i
					if (i > i1) i1 = i
					if (j < j0) j0 = j
					if (j > j1) j1 = j
				}
				// (a bed under running water changes slowly and all over: 5 a second is enough for the view's interpolation)
				const gap = b.water !== undefined ? 0.2 : 0.05
				const due = s.lastT < 0 || (i1 >= i0 && ((most >= 1 && t - s.lastT >= gap - 1e-9) || t - s.lastT >= 0.25))
				if (due && i1 >= i0) {
					const vals: number[] = []
					const changed: number[] = []
					let k = 0
					for (let j = j0; j <= j1; j++)
						for (let i = i0; i <= i1; i++) {
							const c = j * b.nx + i
							const v = Math.round((b.h[c] as number) * 1e4) / 10
							const iv = Math.round(v * 10)
							vals.push(iv)
							if (s.lastT < 0 || Math.abs(v - (s.last[c] as number)) >= 0.1) changed.push(k, iv)
							s.last[c] = v
							k++
						}
					// (only the columns that changed, when they are few: [.., 2, count, (offset, value)...])
					const full = packed(i0, j0, i1 - i0 + 1, j1 - j0 + 1, vals)
					const sparse = [i0, j0, i1 - i0 + 1, j1 - j0 + 1, 2, changed.length / 2, ...changed]
					ctx.keyframe(s.item, `h:${b.id}`, sparse.length < full.length ? sparse : full)
					// (which grains: one class for the whole bed, [−1, k]; or each column's shares of classes 1… in %, when the bed holds several)
					if (this.classes.length > 1) {
						const present: number[] = []
						for (let k = 0; k < this.classes.length; k++) {
							const a = b.hk[k] as Float64Array
							for (let c = 0; c < b.n; c++)
								if ((a[c] as number) > 1e-6) {
									present.push(k)
									break
								}
						}
						if (present.length <= 1) {
							const k = present[0] ?? 0
							if (s.cls !== k) {
								ctx.keyframe(s.item, `mix:${b.id}`, [-1, k])
								s.cls = k
							}
						} else {
							const mix: number[] = [i0, j0, i1 - i0 + 1, j1 - j0 + 1]
							for (let j = j0; j <= j1; j++)
								for (let i = i0; i <= i1; i++) {
									const c = j * b.nx + i
									const hh = b.h[c] as number
									for (let k = 1; k < this.classes.length; k++) mix.push(hh > 0 ? Math.round((((b.hk[k] as Float64Array)[c] as number) / hh) * 100) : 0)
								}
							ctx.keyframe(s.item, `mix:${b.id}`, mix)
							s.cls = -1
						}
					}
					s.lastT = t
				} else if (s.lastT < 0) s.lastT = t
			}
			const w = b.water
			if (w !== undefined && (s.lastWT < 0 || t - s.lastWT >= 0.25)) {
				const vals: number[] = []
				let same = s.lastW !== undefined
				const now = new Float64Array(b.n)
				for (let c = 0; c < b.n; c++) {
					const v = Math.round((w.w[c] as number) * 1e4) / 10
					now[c] = v
					if (same && Math.abs(v - ((s.lastW as Float64Array)[c] as number)) >= 0.05) same = false
					vals.push(Math.round(v * 10))
				}
				if (!same) {
					ctx.keyframe(s.item, `water:${b.id}`, packed(0, 0, b.nx, b.nz, vals))
					s.lastW = now
				}
				s.lastWT = t
			}
		}
		const air = this.world.parcels
		if ((air.length > 0 || this.airShown) && t - this.lastAir >= 1 / 30 - 1e-9) {
			const row: number[] = []
			for (const p of air) {
				row.push(
					Math.round(p.x * 1e4) / 1e4,
					Math.round(p.y * 1e4) / 1e4,
					Math.round(p.z * 1e4) / 1e4,
					Math.round(p.vx * 1e3) / 1e3,
					Math.round(p.vy * 1e3) / 1e3,
					Math.round(p.vz * 1e3) / 1e3,
					GRAIN_KEYS.indexOf(p.grain)
				)
			}
			const item = (this.records[0]?.item as string) ?? ""
			ctx.keyframe(item, "air", row)
			this.airShown = air.length > 0
			this.lastAir = t
		}
	}
}

const runs = new WeakMap<SimScene<string>, Grains>()
const grainsOf = (ctx: ProcessContext) => {
	let g = runs.get(ctx.scene)
	if (g === undefined) {
		g = new Grains(ctx.scene, ctx.settings.gravity)
		runs.set(ctx.scene, g)
	}
	return g
}

/** The run's grains, for another module (a flow module's water onto a stream table): undefined in a scene without any. */
export const grainsIn = (scene: SimScene<string>) => runs.get(scene)

/**
 * The grains (kg) resting on an item's fixed solids now: every column whose floor is one of its solids' tops (a kitchen scale's platform: what a
 * measuring module adds to its reading, ×g, for sand poured or heaped on it); with `solid`, only that solid's (the platform, not the scale's
 * base). 0 in a scene without grains. Falling grains are not counted.
 */
export const grainsOn = (scene: SimScene<string>, item: string, solid?: string) => {
	const g = runs.get(scene)
	if (g === undefined) return 0
	let m = 0
	if (solid !== undefined) {
		// (the solid's columns, found once: a floor never moves)
		let list = g.cellsOn.get(solid)
		if (list === undefined) {
			list = []
			for (const [b, ids] of g.floorSolid) {
				const cells: number[] = []
				for (let c = 0; c < b.n; c++) {
					// (on the solid itself, or in a container standing on it by its own weight)
					const on = g.floorItem.get(b)?.[c] ?? ""
					if (ids[c] === solid && (on === item || g.loose.has(on))) cells.push(c)
				}
				if (cells.length > 0) list.push({ bed: b, cells: Int32Array.from(cells) })
			}
			g.cellsOn.set(solid, list)
		}
		for (const { bed: b, cells } of list) {
			const A = b.dx * b.dx
			for (const c of cells) {
				if ((b.kind[c] as number) !== 0) continue
				for (let k = 0; k < b.classes.length; k++) m += ((b.hk[k] as Float64Array)[c] as number) * A * (b.classes[k] as ClassInfo).rhoB
			}
		}
		return m
	}
	for (const [b, by] of g.floorItem) {
		const A = b.dx * b.dx
		for (let c = 0; c < b.n; c++) {
			if (by[c] !== item || (b.kind[c] as number) !== 0) continue
			for (let k = 0; k < b.classes.length; k++) m += ((b.hk[k] as Float64Array)[c] as number) * A * (b.classes[k] as ClassInfo).rhoB
		}
	}
	return m
}

const create = (record: ProcessRecord, ctx: ProcessContext) => {
	const g = grainsOf(ctx)
	if (g.owner !== record.id) return {}
	return {
		start(c: ProcessContext) {
			g.build(c)
			g.read(c)
			g.show(c)
		},
		step(c: ProcessContext) {
			g.step(c)
		},
		force(c: ProcessContext, h: number) {
			g.press(c, h)
		},
		end(c: ProcessContext) {
			g.read(c)
		}
	}
}

const kinds: ProcessKind[] = [
	{ kind: "sand-region", check: (r) => regionProblem(r), create },
	{ kind: "sand-vessel", check: (r) => vesselProblem(r), create },
	{ kind: "sand-water", check: (r) => waterProblem(r, undefined), create },
	{ kind: "sand-pour", check: (r) => pourProblem(r), create }
]

export default kinds
