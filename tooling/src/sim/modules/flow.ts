/**
 * The flow module (engine side): liquids that MOVE — pouring from pitchers and cups, taps, jets from holes in a bottle (faster from lower
 * holes), hoses and siphons, streams splashing and running down ramps, waterwheels turned by a stream, puddles, colours mixing, thick
 * liquids (honey, syrup) creeping where water rushes. The physics is tooling/src/sim/flow.ts (particles for free liquid, basins for still
 * liquid in containers); this file runs it through the plug-in framework. Records (doc.processes, made by machines/mod_flow.py and its
 * port web/sim/modules/flow.js; numbers in metres, seconds, m³, kg/m³, Pa·s):
 *   {kind: "flow-pour", id, item, solid, inside: [4 {x, y}], depth, lip, wall, liquid: {words, density, viscosity}, dye: [3], volume,
 *    tilt, at, turn, back}
 *       a pitcher (jug, cup) held by a hand that tips it: `solid` is its root, whose origin is the pour lip (it turns about it); `inside`
 *       its inside in that frame (bottom-left, bottom-right, top-right, top-left); depth: front to back (horizontal area ÷ width); lip: the
 *       spout's width; tilt (rad, counter-clockwise +) reached from `at` over `turn` s, and back upright from `back` (null: stays).
 *   {kind: "flow-tap", id, item, at: {x, y}, angle, d, q, on, off, liquid, dye}
 *       a tap's nozzle (world), the stream's direction (rad), nozzle diameter, flow (m³/s) from `on` to `off` (null: never off).
 *   {kind: "flow-vessel", id, item, solid, inside, depth, wall, lip, layers: [{liquid, dye, volume}], holes: [{x, y, angle, d}], cap,
 *    full, open, ground}
 *       a container with holes in its wall (a bottle, a dispenser): holes in its frame (outward direction, diameter), `cap` true: sealed
 *       (no air gets in, so nothing comes out), `full` true: kept topped up (a constant head), the holes open at `open`, `ground` the
 *       height of what it stands on (its jets' reach is measured there).
 *   {kind: "flow-basin", id, item, floor, left: [ids], right: [ids], round, depth}
 *       a container of the catalog (a cup, a bucket, a jar, a mug, a bowl, a box) catches liquid: its inside is worked out at the start
 *       from its floor's and walls' outlines (in its floor's frame); round: its horizontal area is π/4 × width², else width × depth.
 *   {kind: "flow-hose", id, item, from, to, out: {x, y}, d, length, inlet, open}
 *       a hose from container `from` (an item: a fluids container or one of these) to container `to` (or none: its free end at `out`),
 *       inner diameter d, its inlet `inlet` m over from's floor; length null: the path's own; flows from `open` while from's surface
 *       stands above the outlet's (a siphon: until the two surfaces are level).
 *   {kind: "flow-wheel", id, item, solid}
 *       a waterwheel's hub (readings only: the particles' push turns it).
 * All of a run's flow records are worked by ONE process (the first in the document), every 480 Hz step from t = 0: the pitchers' tilt,
 * the basins' levels and outflows, the sources' particles, the particles' step against every solid, then what the particles fell into.
 * The fluids module's fixed containers (water tanks, beakers, cylinders, jugs, density columns) take poured liquid and give it to hoses
 * (its exported liquidsIn / pourInto: modules/fluids.ts); a different liquid poured in is a new layer where its density puts it.
 * Readings (track.state): a pitcher left_ml, poured_ml, flow_ml_s, tilt_deg; a tap flowed_ml, flow_ml_s; a vessel left_ml, level_mm,
 * poured_ml, flow_ml_s, jet<k>_ms and reach<k>_m per hole (1 = lowest); a hose moved_ml, flow_ml_s; a container that catches liquid
 * liquid_ml, level_mm, tint_r, tint_g, tint_b (what shows through 5 cm of it, 0…1); a fluids container received_ml (and tint_*); a
 * waterwheel rpm, turns. Keyframes (drawing only): the particles (track.keyframes[first flow item].p: id, x mm, y mm, look per particle,
 * 60 a second), each container's layers (.b: top y, look per layer), its inside (.i), each hose's path (.h).
 * Events: "<pitcher> starts pouring", "<pitcher> is empty", "<container> overflows", "<vessel>'s hole <k> stops spurting",
 * "<wheel> starts turning", "<hose> stops: the two surfaces are level"; "<tap> turns on (100 mL/s)", "<tap> turns off after 400 mL",
 * "<vessel>'s jets start", "<vessel>'s holes open, but its cap is on…", "<hose> starts siphoning", "<hose> runs from <b> to <a>…" (a siphon
 * flows from the higher surface to the lower whatever its ends are called), "<container> fills to N mL" (at the moment it last gained);
 * at the start: "only N mL fits in <pitcher>…" (a fill_ml past its brim: the record's `asked`), "<vessel> has room for only k of its holes…"
 * (`dropped`), "<pitcher> starts inside <solid>…" (a fixed solid: the layout tells only of moving ones), "<solid> is in the way of
 * <wheel>'s paddles…".
 * Floating: a moving thing in a catalog container's liquid (a cork, a toy duck, a ball in a jar a tap fills) is held up and slowed by it
 * exactly as in the fluids module's containers (that module's fluidPushes, on the container's liquid as it stands now), with the same
 * readings submerged, buoyancy_n, afloat, sunk, draft_mm (its goals floats and sinks read them). A container's liquid weighs: its mass is
 * carried by its floor's solid (SolidHandle.carry: a kitchen scale under it reads the cup and what it holds). Liquid that lands on a slope
 * steeper than about 6° runs on down it (a ramp, a slide into a bucket); only on a near-level surface does it come to rest as a puddle.
 * A catalog container's overflow_ml reading: what has gone over its rim.
 */
import { Basin, type BasinLayer, type Collider, type Dye, Emitter, FlowSim, type FlowLiquid, flatCentroid, clipBelowFlat, makeCollider, orificeFlow, pipeSpeed, shapeCollider, tintOf, weirFlow } from "#sim/flow.ts"
import { type FluidBody, type FluidShape, fluidPushes, type RegionState } from "#sim/fluids.ts"
import { liquidsIn } from "#sim/modules/fluids.ts"
import type { SimScene } from "#sim/part.ts"
import type { Point, ProcessContext, ProcessKind, ProcessRecord, SolidHandle } from "#sim/plugins.ts"

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)
const isPoint = (p: unknown): p is Point => typeof p === "object" && p !== null && finite((p as Point).x) && finite((p as Point).y)
const itemOf = (id: string) => (id.includes("/") ? id.slice(0, id.indexOf("/")) : id)
const KINDS = ["flow-pour", "flow-tap", "flow-vessel", "flow-basin", "flow-hose", "flow-wheel"]

/** The particles' rest spacing, m (5 mm: a cup's pour is a few particles thick; finer costs time on a laptop). */
export const SPACING = 0.005
/** Steps between the particles' keyframes (8: 60 a second; the view interpolates between them). */
const KEY_EVERY = 8

// ------------------------------------------------------------------------------------------------ record checks
const liquidProblem = (l: unknown): string | undefined => {
	const L = l as Partial<FlowLiquid> | undefined
	if (typeof L !== "object" || L === null || typeof L.words !== "string") return "liquid must be {words, density, viscosity}"
	if (!finite(L.density) || L.density <= 0 || L.density > 25000) return "liquid.density must be a number from 0 to 25000 kg/m³"
	if (!finite(L.viscosity) || L.viscosity < 0 || L.viscosity > 1e6) return "liquid.viscosity must be a number from 0 to 10⁶ Pa·s"
	return undefined
}
const dyeProblem = (d: unknown): string | undefined =>
	Array.isArray(d) && d.length === 3 && d.every((v) => finite(v) && v >= 0 && v <= 100) ? undefined : "dye must be three absorbances per cm, 0 to 100"
const insideProblem = (p: unknown): string | undefined => {
	if (!Array.isArray(p) || p.length !== 4 || !p.every(isPoint)) return "inside must be 4 {x, y}: bottom-left, bottom-right, top-right, top-left"
	const [bl, br, tr, tl] = p as Point[]
	if (!(br!.x > bl!.x && tr!.x > tl!.x && tl!.y > bl!.y && tr!.y > br!.y)) return "inside must be a box-like outline, wider than 0 and taller than 0"
	return undefined
}
const solidProblem = (id: unknown, solids: ReadonlySet<string>) => (typeof id === "string" && solids.has(id) ? undefined : `its solid (${String(id)}) is not in the document`)

const check = (r: ProcessRecord, solids: ReadonlySet<string>): string | undefined => {
	switch (r.kind) {
		case "flow-pour":
			return (
				solidProblem(r.solid, solids) ??
				insideProblem(r.inside) ??
				liquidProblem(r.liquid) ??
				dyeProblem(r.dye) ??
				(["depth", "lip", "wall", "volume", "tilt", "at", "turn"].find((k) => !finite(r[k])) ? "depth, lip, wall, volume, tilt, at and turn must be numbers" : undefined) ??
				(r.back !== null && r.back !== undefined && !finite(r.back) ? "back must be a number of seconds or null" : undefined)
			)
		case "flow-tap":
			return (
				(isPoint(r.at) ? undefined : "at must be {x, y}") ??
				liquidProblem(r.liquid) ??
				dyeProblem(r.dye) ??
				(["angle", "d", "q", "on"].find((k) => !finite(r[k])) ? "angle, d, q and on must be numbers" : undefined) ??
				((r.d as number) > 0 && (r.q as number) >= 0 ? undefined : "d must be more than 0 and q at least 0")
			)
		case "flow-vessel": {
			const why = solidProblem(r.solid, solids) ?? insideProblem(r.inside)
			if (why) return why
			if (!Array.isArray(r.layers) || r.layers.length > 8) return "layers must list up to 8 liquids, bottom first"
			for (const l of r.layers as { liquid: unknown; dye: unknown; volume: unknown }[]) {
				const w = liquidProblem(l?.liquid) ?? dyeProblem(l?.dye) ?? (finite(l?.volume) && (l.volume as number) >= 0 ? undefined : "a layer's volume must be a number of m³")
				if (w) return w
			}
			if (!Array.isArray(r.holes) || r.holes.length > 8) return "holes must list up to 8 {x, y, angle, d}"
			for (const h of r.holes as { x: unknown; y: unknown; angle: unknown; d: unknown }[])
				if (![h?.x, h?.y, h?.angle, h?.d].every(finite) || !((h.d as number) > 0)) return "each hole needs x, y, angle and d (more than 0)"
			if (!["depth", "wall", "lip", "open", "ground"].every((k) => finite(r[k]))) return "depth, wall, lip, open and ground must be numbers"
			return undefined
		}
		case "flow-basin": {
			const why = solidProblem(r.floor, solids)
			if (why) return why
			for (const k of ["left", "right"]) {
				const list = r[k]
				if (!Array.isArray(list) || list.length < 1 || !list.every((id) => typeof id === "string" && solids.has(id))) return `${k} must list the solids of that wall`
			}
			if (typeof r.round !== "boolean") return "round must be true or false"
			if (!finite(r.depth) || !((r.depth as number) > 0)) return "depth must be a number of metres, more than 0"
			return undefined
		}
		case "flow-hose":
			if (typeof r.from !== "string") return "from must name a container"
			if (r.to !== null && r.to !== undefined && typeof r.to !== "string") return "to must name a container or be null"
			if (!isPoint(r.out)) return "out must be {x, y}"
			if (!finite(r.d) || !((r.d as number) > 0)) return "d must be more than 0"
			if (r.length !== null && r.length !== undefined && !(finite(r.length) && (r.length as number) > 0)) return "length must be a number of metres or null"
			if (!finite(r.inlet) || !finite(r.open)) return "inlet and open must be numbers"
			return undefined
		case "flow-wheel":
			return solidProblem(r.solid, solids)
	}
	return `no flow record "${r.kind}"`
}

// ------------------------------------------------------------------------------------------------ containers the liquid knows
/** What a source, a hose or a falling particle needs of a container: its surface, its inside, and liquid in and out. */
interface Store {
	readonly item: string
	readonly key: number
	/** world y of its surface (its inside's lowest point when empty) */
	top(): number
	/** its inside's lowest point (world y) */
	low(): number
	/** whether a point is in its inside (under its rim) */
	inside(x: number, y: number): boolean
	/** where its inside meets the side nearer x: a point just inside the wall, at height above its floor (for a hose's inlet) */
	nearWall(x: number, above: number): Point
	/** its rim's highest point (world y) */
	rimTop(): number
	/** the layer at a height, its liquid and dye; −1 when dry there */
	layerAt(y: number): number
	liquidOf(layer: number): number
	dyeOf(layer: number): Dye
	pressure(y: number, g: number): number
	add(vol: number, liq: number, dye: Dye): void
	take(layer: number, vol: number): number
	volume(): number
	received: number
}

/** The world's liquids table: each liquid once, by its words, density and viscosity. */
class Liquids {
	readonly list: FlowLiquid[] = []
	of(l: FlowLiquid): number {
		const i = this.list.findIndex((x) => x.words === l.words && x.density === l.density && x.viscosity === l.viscosity)
		if (i >= 0) return i
		this.list.push({ words: l.words, density: l.density, viscosity: l.viscosity })
		return this.list.length - 1
	}
}

/** Still liquid in one of this module's containers (a pitcher, a vessel, a catalog cup): a Basin in a solid's frame. */
class BasinStore implements Store {
	readonly item: string
	readonly key: number
	readonly basin: Basin
	readonly frame: string
	readonly liquids: Liquids
	received = 0
	poured = 0
	/** what particles falling in gave it this step (N·s), for a moving container */
	jx = 0
	jy = 0
	lip: number
	wall: number
	/** the lip's emitters (top-right corner, top-left corner) */
	readonly lips: [Emitter, Emitter]
	overflowed = false
	/** m³ gone over its rim (a catalog container: its overflow_ml reading) */
	over = 0
	/** the most it has held and when (its "fills to" event) */
	peak = 0
	peakAt = 0
	pose = { x: 0, y: 0, angle: 0 }
	constructor(item: string, key: number, frame: string, inside: readonly Point[], depth: number, liquids: Liquids, lip: number, wall: number, lanes: [number, number]) {
		this.item = item
		this.key = key
		this.frame = frame
		this.basin = new Basin(inside, depth)
		this.liquids = liquids
		this.lip = lip
		this.wall = wall
		this.lips = [new Emitter(lanes[0]), new Emitter(lanes[1])]
	}
	place(pose: { x: number; y: number; angle: number }) {
		this.pose = pose
		this.basin.place(pose)
	}
	top() {
		return this.basin.top()
	}
	low() {
		return this.basin.bottom
	}
	inside(x: number, y: number) {
		return this.basin.inside(x, y)
	}
	rimTop() {
		return Math.max(this.basin.rimA.y, this.basin.rimB.y)
	}
	nearWall(x: number, above: number): Point {
		// in the frame: the inside's bottom corners; the one nearer x (in the world), moved 1 cm in
		const [bl, br] = this.basin.local as [Point, Point]
		const c = Math.cos(this.pose.angle)
		const s = Math.sin(this.pose.angle)
		const w = (p: Point) => ({ x: this.pose.x + p.x * c - p.y * s, y: this.pose.y + p.x * s + p.y * c })
		const right = Math.abs(w(br).x - x) < Math.abs(w(bl).x - x)
		const lx = right ? br.x - Math.min(0.01, (br.x - bl.x) / 3) : bl.x + Math.min(0.01, (br.x - bl.x) / 3)
		return w({ x: lx, y: bl.y + above })
	}
	layerAt(y: number) {
		return this.basin.layerAt(y)
	}
	liquidOf(layer: number) {
		return (this.basin.layers[layer] as BasinLayer).liq
	}
	dyeOf(layer: number): Dye {
		return (this.basin.layers[layer] as BasinLayer).a
	}
	pressure(y: number, g: number) {
		return this.basin.pressure(y, this.liquids.list, g)
	}
	add(vol: number, liq: number, dye: Dye) {
		this.basin.add(vol, liq, dye, this.liquids.list)
		this.received += vol
	}
	take(layer: number, vol: number) {
		const got = this.basin.take(layer, vol)
		this.poured += got
		return got
	}
	volume() {
		return this.basin.volume()
	}
}

/**
 * Liquid in a fluids-module container (modules/fluids.ts's RegionState): its layers are that module's; this module adds to them (the same
 * liquid joins its layer, another one becomes a layer where its density puts it) and takes from them (a hose), and keeps the dye.
 */
class RegionStore implements Store {
	readonly item: string
	readonly key: number
	readonly st: RegionState
	readonly liquids: Liquids
	/** dye per layer, as that module's layers stand */
	dyes: [number, number, number][]
	received = 0
	taken = 0
	lastSpilled = 0
	peak = 0
	peakAt = 0
	readonly spill: [Emitter, Emitter]
	constructor(st: RegionState, key: number, liquids: Liquids, lanes: [number, number]) {
		this.st = st
		this.item = st.region.item
		this.key = key
		this.liquids = liquids
		this.dyes = st.region.layers.map((l) => [...dyeOfWords(l.words)] as [number, number, number])
		this.lastSpilled = st.spilled
		this.spill = [new Emitter(lanes[0]), new Emitter(lanes[1])]
	}
	top() {
		return this.st.tops.length > 0 ? (this.st.tops[this.st.tops.length - 1] as number) : this.st.region.floor
	}
	low() {
		return this.st.region.floor
	}
	inside(x: number, y: number) {
		const r = this.st.region
		return x >= r.x0 && x <= r.x1 && y >= r.floor - 0.002 && y <= r.rim
	}
	rimTop() {
		return this.st.region.rim
	}
	nearWall(x: number, above: number): Point {
		const r = this.st.region
		const right = Math.abs(r.x1 - x) < Math.abs(r.x0 - x)
		const inset = Math.min(0.01, (r.x1 - r.x0) / 3)
		return { x: right ? r.x1 - inset : r.x0 + inset, y: r.floor + above }
	}
	layerAt(y: number) {
		for (let i = 0; i < this.st.tops.length; i++) if (y <= (this.st.tops[i] as number) && (this.st.volumes[i] as number) > 0) return i
		return -1
	}
	liquidOf(layer: number) {
		const l = this.st.region.layers[layer] as { words: string; density: number; viscosity: number }
		return this.liquids.of(l)
	}
	dyeOf(layer: number): Dye {
		return this.dyes[layer] ?? [0, 0, 0]
	}
	pressure(y: number, g: number) {
		let p = 0
		let floor = this.st.region.floor
		for (let i = 0; i < this.st.tops.length; i++) {
			const top = this.st.tops[i] as number
			const from = Math.max(floor, y)
			if (top > from) p += (this.st.region.layers[i] as { density: number }).density * g * (top - from)
			floor = top
		}
		return p
	}
	add(vol: number, liq: number, dye: Dye) {
		if (!(vol > 0)) return
		const L = this.liquids.list[liq] as FlowLiquid
		const layers = this.st.region.layers as unknown as { words: string; density: number; viscosity: number; height: number }[]
		let i = layers.findIndex((l) => l.words === L.words)
		if (i < 0) {
			// a new layer where its density belongs (densest at the bottom), in that module's own arrays
			i = layers.length
			for (let k = 0; k < layers.length; k++)
				if (L.density > (layers[k] as { density: number }).density) {
					i = k
					break
				}
			const below = i === 0 ? this.st.region.floor : (this.st.tops[i - 1] as number)
			layers.splice(i, 0, { words: L.words, density: L.density, viscosity: L.viscosity, height: 0 })
			this.st.volumes.splice(i, 0, 0)
			this.st.tops.splice(i, 0, below)
			this.dyes.splice(i, 0, [0, 0, 0])
		}
		const v0 = this.st.volumes[i] as number
		const t = v0 + vol
		const d = this.dyes[i] as [number, number, number]
		this.dyes[i] = [(d[0] * v0 + dye[0] * vol) / t, (d[1] * v0 + dye[1] * vol) / t, (d[2] * v0 + dye[2] * vol) / t]
		this.st.volumes[i] = t
		// (its level follows at that module's next update; until then, a first guess so a stream lands on it)
		const r = this.st.region
		this.st.tops[this.st.tops.length - 1] = (this.st.tops[this.st.tops.length - 1] ?? r.floor) + vol / r.area
		this.received += vol
	}
	take(layer: number, vol: number) {
		const v = this.st.volumes[layer]
		if (v === undefined || !(vol > 0)) return 0
		const got = Math.min(v, vol)
		this.st.volumes[layer] = v - got
		this.taken += got
		return got
	}
	volume() {
		let v = 0
		for (const x of this.st.volumes) v += x
		return v
	}
}

// ------------------------------------------------------------------------------------------------ the liquids' colours
/** A liquid's own colour as absorbance per cm (what shows through: exp(−a·path)): clear water, amber honey, yellow oil... */
const OWN_DYE: Record<string, Dye> = {
	water: [0.004, 0.0015, 0.0006],
	"sea water": [0.006, 0.0025, 0.0015],
	"vegetable oil": [0.012, 0.03, 0.22],
	honey: [0.06, 0.16, 0.42],
	"corn syrup": [0.006, 0.012, 0.06],
	"dish soap": [0.25, 0.04, 0.22],
	"rubbing alcohol": [0.002, 0.001, 0.001],
	milk: [0.002, 0.003, 0.006]
}
const dyeOfWords = (words: string): Dye => OWN_DYE[words] ?? (words.startsWith("salt water") ? [0.005, 0.002, 0.001] : [0.004, 0.0015, 0.0006])

/** A colour as 12 bits (4 per channel) of what shows through 3 cm (particles) or 5 cm (containers). */
const look12 = (a: Dye, path: number) => {
	const t = tintOf(a, path)
	return Math.round(t[0] * 15) * 256 + Math.round(t[1] * 15) * 16 + Math.round(t[2] * 15)
}

// ------------------------------------------------------------------------------------------------ geometry helpers
/** A convex outline's span [x0, x1] at height y (NaN when the line misses it). */
const spanAt = (pts: readonly Point[], y: number): [number, number] => {
	let lo = Number.POSITIVE_INFINITY
	let hi = Number.NEGATIVE_INFINITY
	const n = pts.length
	for (let i = 0; i < n; i++) {
		const a = pts[i] as Point
		const b = pts[(i + 1) % n] as Point
		if ((a.y <= y && b.y >= y) || (a.y >= y && b.y <= y)) {
			const x = a.y === b.y ? Math.min(a.x, b.x) : a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x)
			const x2 = a.y === b.y ? Math.max(a.x, b.x) : x
			lo = Math.min(lo, x)
			hi = Math.max(hi, x2)
		}
	}
	return lo <= hi ? [lo, hi] : [Number.NaN, Number.NaN]
}

/** A handle's outline as points (a circle as a 12-gon). */
const pointsOf = (h: SolidHandle): Point[] => {
	const o = h.outline()
	if (o.circle !== undefined) {
		const { x, y, r } = o.circle
		const out: Point[] = []
		for (let k = 0; k < 12; k++) out.push({ x: x + r * Math.cos((k * Math.PI) / 6), y: y + r * Math.sin((k * Math.PI) / 6) })
		return out
	}
	return [...(o.points ?? [])]
}

/**
 * A catalog container's inside from its floor's and walls' outlines (world), in the floor's frame: the floor's top, between the left
 * wall's inner face and the right wall's, up to the lower wall's top. Undefined when it holds nothing (walls crossed or too short).
 */
export const interiorOf = (floor: { pose: { x: number; y: number; angle: number }; pts: Point[] }, left: Point[][], right: Point[][]): Point[] | undefined => {
	const q = floor.pose
	const c = Math.cos(q.angle)
	const s = Math.sin(q.angle)
	const local = (p: Point) => ({ x: (p.x - q.x) * c + (p.y - q.y) * s, y: -(p.x - q.x) * s + (p.y - q.y) * c })
	const F = floor.pts.map(local)
	const L = (left[0] ?? []).map(local)
	const R = (right[0] ?? []).map(local)
	if (F.length < 3 || L.length < 3 || R.length < 3) return undefined
	const yb = Math.max(...F.map((p) => p.y))
	const lo = Math.max(yb, Math.min(...L.map((p) => p.y)), Math.min(...R.map((p) => p.y)))
	const hi = Math.min(Math.max(...L.map((p) => p.y)), Math.max(...R.map((p) => p.y)))
	if (!(hi - lo > 0.005)) return undefined
	const e = Math.min(1e-6, (hi - lo) / 100)
	const l0 = spanAt(L, lo + e)[1]
	const r0 = spanAt(R, lo + e)[0]
	const l1 = spanAt(L, hi - e)[1]
	const r1 = spanAt(R, hi - e)[0]
	if (![l0, r0, l1, r1].every(Number.isFinite) || !(r0 - l0 > 0.005) || !(r1 - l1 > 0.005)) return undefined
	return [
		{ x: l0, y: lo },
		{ x: r0, y: lo },
		{ x: r1, y: hi },
		{ x: l1, y: hi }
	]
}

/** How far two convex outlines overlap (m: the least push along an edge's normal that parts them; the separating axis test), 0 apart. */
export const overlapDepth = (a: readonly Point[], b: readonly Point[]): number => {
	let best = Number.POSITIVE_INFINITY
	for (const P of [a, b]) {
		const n = P.length
		for (let i = 0; i < n; i++) {
			const p = P[i] as Point
			const q = P[(i + 1) % n] as Point
			let nx = q.y - p.y
			let ny = p.x - q.x
			const L = Math.sqrt(nx * nx + ny * ny)
			if (!(L > 1e-12)) continue
			nx /= L
			ny /= L
			let a0 = Number.POSITIVE_INFINITY
			let a1 = Number.NEGATIVE_INFINITY
			let b0 = Number.POSITIVE_INFINITY
			let b1 = Number.NEGATIVE_INFINITY
			for (const r of a) {
				const d = r.x * nx + r.y * ny
				a0 = Math.min(a0, d)
				a1 = Math.max(a1, d)
			}
			for (const r of b) {
				const d = r.x * nx + r.y * ny
				b0 = Math.min(b0, d)
				b1 = Math.max(b1, d)
			}
			const o = Math.min(a1, b1) - Math.max(a0, b0)
			if (!(o > 0)) return 0
			best = Math.min(best, o)
		}
	}
	return Number.isFinite(best) ? best : 0
}

/** The distance from a point to a convex outline (0 inside it). */
export const distanceTo = (pts: readonly Point[], c: Point): number => {
	const n = pts.length
	if (n === 0) return Number.POSITIVE_INFINITY
	let sign = 0
	let inside = n > 2
	let best = Number.POSITIVE_INFINITY
	for (let i = 0; i < n; i++) {
		const p = pts[i] as Point
		const q = pts[(i + 1) % n] as Point
		const ex = q.x - p.x
		const ey = q.y - p.y
		const L2 = ex * ex + ey * ey
		const u = L2 > 0 ? Math.max(0, Math.min(1, ((c.x - p.x) * ex + (c.y - p.y) * ey) / L2)) : 0
		const dx = p.x + u * ex - c.x
		const dy = p.y + u * ey - c.y
		best = Math.min(best, Math.sqrt(dx * dx + dy * dy))
		const side = Math.sign(ex * (c.y - p.y) - ey * (c.x - p.x))
		if (side !== 0) {
			if (sign === 0) sign = side
			else if (side !== sign) inside = false
		}
	}
	return inside ? 0 : best
}

/** A solid's displacing shape from its handle (as the fluids module's: a ball a sphere, a round body lying along the depth a cylinder). */
const shapeOf = (h: SolidHandle): FluidShape => {
	const o = h.outline()
	const part = h.part
	if (o.circle !== undefined) {
		const { x, y, r } = o.circle
		return part.shape === "cylinder" && part.length !== undefined ? { kind: "cylinder", x, y, r, length: part.length } : { kind: "sphere", x, y, r }
	}
	return { kind: "prism", points: o.points ?? [], depth: part.body.kind === "ball" ? 0 : part.body.depth }
}
const shapeBox = (s: FluidShape) => {
	if (s.kind !== "prism") return { x0: s.x - s.r, x1: s.x + s.r, y0: s.y - s.r, y1: s.y + s.r }
	let x0 = Number.POSITIVE_INFINITY
	let x1 = Number.NEGATIVE_INFINITY
	let y0 = Number.POSITIVE_INFINITY
	let y1 = Number.NEGATIVE_INFINITY
	for (const p of s.points) {
		x0 = Math.min(x0, p.x)
		x1 = Math.max(x1, p.x)
		y0 = Math.min(y0, p.y)
		y1 = Math.max(y1, p.y)
	}
	return { x0, x1, y0, y1 }
}

/** The smoothstep of a tip: 0 → 1 over [0, 1]. */
const ease = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u))

// ------------------------------------------------------------------------------------------------ the sources
interface PlanckBody {
	getAngle(): number
	getPosition(): { x: number; y: number }
	getMass(): number
	getMassData(d: { mass: number; center: { x: number; y: number }; I: number }): void
	setMassData(d: { mass: number; center: { x: number; y: number }; I: number }): void
	setKinematic(): unknown
	setLinearVelocity(v: { x: number; y: number }): void
	setAngularVelocity(w: number): void
	setAwake(a: boolean): void
	isDynamic(): boolean
	getLocalPoint(p: { x: number; y: number }): { x: number; y: number }
}

interface Pour {
	readonly rec: ProcessRecord
	readonly store: BasinStore
	body: PlanckBody | null
	a0: number
	flow: number
	said: boolean
	empty: boolean
	start: number
}
interface Tap {
	readonly rec: ProcessRecord
	readonly em: Emitter
	readonly liq: number
	flowed: number
	flow: number
	/** running now (for its "turns on" and "turns off" events) */
	on: boolean
}
interface Hole {
	readonly x: number
	readonly y: number
	readonly angle: number
	readonly d: number
	readonly em: Emitter
	readonly lane: number
	v: number
	reach: number
	wet: boolean
	said: boolean
	q: number
}
interface Vessel {
	readonly rec: ProcessRecord
	readonly store: BasinStore
	readonly holes: Hole[]
	readonly start: number
	flow: number
	/** what keeping it full has added, m³ */
	topped: number
	/** its jets have started; its sealed holes have been told of */
	jetted: boolean
	capped: boolean
}
interface Hose {
	readonly rec: ProcessRecord
	from: Store | undefined
	to: Store | undefined
	readonly em: Emitter
	moved: number
	flow: number
	path: number[]
	ran: boolean
	said: boolean
	/** it has started; it has been told that it runs the other way (from `to` to `from`: that surface is the higher) */
	started: boolean
	back: boolean
}
interface Wheel {
	readonly rec: ProcessRecord
	turns: number
	said: boolean
}
/** Liquid that came to rest on a fixed surface outside any container: a puddle (spread thin: water about 4 mm deep, thick liquids 8). */
interface Puddle {
	readonly key: number
	readonly item: string
	/** the surface's slope (rad, counter-clockwise; within about 6° of level), so it is drawn along it */
	readonly ang: number
	vol: number
	xv: number
	x0: number
	x1: number
	y: number
	a: [number, number, number]
	liq: number
}
/** m: how deep a puddle stands on a table: water spreads to about 4 mm (its capillary length sets it), thick liquids stay about 8 mm. */
const PUDDLE_DEPTH = 0.004
const PUDDLE_DEPTH_THICK = 0.008
/**
 * A surface is level enough for a puddle when its upward normal is within about 6° of straight up (n_y > 0.995). On anything steeper the
 * liquid runs on down it: a film of water 2 mm thick on a 20° ramp flows at Nusselt's mean speed g·sinθ·h²/(3ν) ≈ 4 m/s [NUSSELT], far too
 * fast to stop, so the particles keep sliding and spill off its low edge (into the bucket below it).
 */
const LEVEL_NY = 0.995
/** As the fluids module (modules/fluids.ts): how quickly the afloat reading follows (bobbing is not sinking), the share of its weight the
 *  liquid must hold up for a thing to float, and how slowly a thing resting on the bottom moves (m/s). */
const SUPPORT_TAU = 0.25
const AFLOAT = 0.97
const RESTING = 0.02
/** m: two solids that overlap by more than this at the start are said to (as web/sim's layout overlaps does). */
const OVERLAP_TOL = 0.003

// ------------------------------------------------------------------------------------------------ the run
export class Flow {
	readonly owner: string
	readonly ownerItem: string
	readonly liquids = new Liquids()
	readonly sim: FlowSim
	readonly records: ProcessRecord[]
	readonly items = new Map<string, number>()
	readonly stores: Store[] = []
	readonly basins: BasinStore[] = []
	readonly regions: RegionStore[] = []
	readonly pours: Pour[] = []
	readonly taps: Tap[] = []
	readonly vessels: Vessel[] = []
	readonly hoses: Hose[] = []
	readonly wheels: Wheel[] = []
	/** the solids the particles meet, with their handles; which move */
	colliders: Collider[] = []
	handles: SolidHandle[] = []
	moving: boolean[] = []
	/** a moving solid's outline left as it was while no particle is near it */
	stale: boolean[] = []
	readonly occupied = new Set<number>()
	/** colours already worked out (absorbance triple → 12-bit look), so keyframes need no exp per particle */
	readonly looks = new Map<string, number>()
	readonly tints = new Map<string, { a: [number, number, number]; t: [number, number, number] }>()
	/** dynamic containers: their planck bodies, own mass data and what was last set */
	readonly carried = new Map<BasinStore, { body: PlanckBody; base: { mass: number; center: { x: number; y: number }; I: number }; last: number }>()
	killY = -10
	spilled = 0
	readonly puddles = new Map<number, Puddle>()
	/** where each source's liquid lands (first touches something or joins a container), by its item's key: a running mean of the last ones */
	readonly lands = new Map<number, number>()
	yBefore = new Float64Array(0)
	/** 1 for a particle that had touched nothing before this step (a jet's reach counts only those: not splashes) */
	flewBefore = new Uint8Array(0)
	boxes: number[][] = []
	lane = 0
	steps = 0
	keyed = false
	ready = false
	/** the moving things that may float in a catalog container's liquid: weld groups (a root and the solids welded to it) */
	readonly floaters: { readonly root: string; readonly parts: string[]; readonly item: string }[] = []
	/** the items that have been in such a liquid, and each one's smoothed share of its weight held up (as the fluids module) */
	readonly wet = new Set<string>()
	readonly support = new Map<string, number>()
	constructor(scene: SimScene<string>) {
		this.records = (scene.processes ?? []).filter((r) => KINDS.includes(r.kind))
		this.owner = (this.records[0] as ProcessRecord).id
		this.ownerItem = (this.records[0] as ProcessRecord).item ?? itemOf(this.owner)
		this.sim = new FlowSim(SPACING, this.liquids.list)
		for (const s of scene.solids) if (!this.items.has(s.item ?? itemOf(s.id))) this.items.set(s.item ?? itemOf(s.id), this.items.size)
		// (weld groups as the fluids module makes them: a solid welded to its parent, not hinged, goes with it)
		const byId = new Map(scene.solids.map((s) => [s.id, s]))
		const rootOf = (id: string): string => {
			let s = byId.get(id)
			for (let k = 0; k < 64 && s !== undefined && s.parent !== undefined && s.pivot === undefined && byId.has(s.parent); k++) s = byId.get(s.parent)
			return s?.id ?? id
		}
		const groups = new Map<string, { root: string; parts: string[]; item: string }>()
		for (const s of scene.solids) {
			if (s.kind !== "dynamic") continue
			const r = rootOf(s.id)
			const g = groups.get(r)
			if (g === undefined) groups.set(r, { root: r, parts: [s.id], item: s.item ?? itemOf(s.id) })
			else g.parts.push(s.id)
		}
		this.floaters.push(...groups.values())
	}
	/** The catalog containers (not a pitcher, not a bottle with holes): what catches liquid, overflows, fills and floats things. */
	catchers(): BasinStore[] {
		return this.basins.filter((st) => !this.pours.some((p) => p.store === st) && !this.vessels.some((v) => v.store === st))
	}
	itemKey(item: string): number {
		let k = this.items.get(item)
		if (k === undefined) {
			k = this.items.size
			this.items.set(item, k)
		}
		return k
	}
	nextLanes(): [number, number] {
		this.lane += 2
		return [this.lane - 2, this.lane - 1]
	}
	storeOf(item: string | null | undefined): Store | undefined {
		if (typeof item !== "string") return undefined
		return this.stores.find((s) => s.item === item)
	}

	/** Everything at the start: the containers (with what they hold), the sources, the solids. */
	start(ctx: ProcessContext) {
		const L = this.liquids
		const eng = ctx.engine()
		// the solids the particles meet (not the ghosts: instruments' faces, painted lines)
		for (const h of ctx.all()) {
			if (h.part.ghost === true) continue
			this.handles.push(h)
			this.colliders.push(makeCollider(this.colliders.length, this.itemKey(h.item), h.dynamic, h.outline()))
			this.moving.push(h.dynamic)
			this.stale.push(false)
		}
		let low = Number.POSITIVE_INFINITY
		for (const c of this.colliders) low = Math.min(low, c.y0)
		this.killY = (Number.isFinite(low) ? low : 0) - 0.5
		for (const r of this.records) {
			const item = r.item ?? itemOf(r.id)
			if (r.kind === "flow-pour" || r.kind === "flow-vessel") {
				const st = new BasinStore(item, this.itemKey(item), r.solid as string, r.inside as Point[], r.depth as number, L, r.lip as number, r.wall as number, this.nextLanes())
				if (r.kind === "flow-pour") {
					if ((r.volume as number) > 0) st.basin.add(r.volume as number, L.of(r.liquid as FlowLiquid), r.dye as Dye, L.list)
				} else for (const l of r.layers as { liquid: FlowLiquid; dye: Dye; volume: number }[]) if (l.volume > 0) st.basin.add(l.volume, L.of(l.liquid), l.dye, L.list)
				this.stores.push(st)
				this.basins.push(st)
				if (r.kind === "flow-pour") {
					// its whole body tips about its root's origin (the lip): a kinematic body the hand turns
					const body = (eng?.bodyOf(r.solid as string) ?? null) as PlanckBody | null
					body?.setKinematic()
					for (let i = 0; i < this.handles.length; i++) if ((this.handles[i] as SolidHandle).item === item) this.moving[i] = true
					this.pours.push({ rec: r, store: st, body, a0: body?.getAngle() ?? 0, flow: 0, said: false, empty: false, start: st.volume() })
				} else {
					const holes = (r.holes as { x: number; y: number; angle: number; d: number }[]).map((h) => {
						const lane = this.lane++
						return { x: h.x, y: h.y, angle: h.angle, d: h.d, em: new Emitter(lane), lane, v: 0, reach: 0, wet: false, said: false, q: 0 }
					})
					this.vessels.push({ rec: r, store: st, holes, start: st.volume(), flow: 0, topped: 0, jetted: false, capped: false })
				}
			} else if (r.kind === "flow-basin") {
				const floor = ctx.solid(r.floor as string)
				const left = (r.left as string[]).map((id) => ctx.solid(id)).filter((h): h is SolidHandle => h !== undefined)
				const right = (r.right as string[]).map((id) => ctx.solid(id)).filter((h): h is SolidHandle => h !== undefined)
				if (floor === undefined || left.length === 0 || right.length === 0) continue
				const inside = interiorOf({ pose: floor.pose(), pts: pointsOf(floor) }, left.map(pointsOf), right.map(pointsOf))
				if (inside === undefined) continue
				const w = ((inside[1] as Point).x - (inside[0] as Point).x + (inside[2] as Point).x - (inside[3] as Point).x) / 2
				const depth = r.round === true ? (Math.PI / 4) * w : (r.depth as number)
				const st = new BasinStore(item, this.itemKey(item), r.floor as string, inside, depth, L, Math.min(0.04, 0.5 * w), 0.004, this.nextLanes())
				this.stores.push(st)
				this.basins.push(st)
				if (floor.dynamic && eng !== undefined) {
					const body = eng.bodyOf(r.floor as string) as PlanckBody | undefined
					if (body?.isDynamic() === true) {
						const base = { mass: 0, center: { x: 0, y: 0 }, I: 0 }
						body.getMassData(base)
						this.carried.set(st, { body, base: { mass: base.mass, center: { x: base.center.x, y: base.center.y }, I: base.I }, last: base.mass })
					}
				}
			} else if (r.kind === "flow-tap") {
				this.taps.push({ rec: r, em: new Emitter(this.lane++), liq: L.of(r.liquid as FlowLiquid), flowed: 0, flow: 0, on: false })
			} else if (r.kind === "flow-wheel") {
				this.wheels.push({ rec: r, turns: 0, said: false })
			}
		}
		// the fluids module's containers (its process made them before any step)
		const fl = liquidsIn(ctx.scene)
		for (const st of fl?.regions ?? []) {
			if (this.storeOf(st.region.item) !== undefined) continue
			const rs = new RegionStore(st, this.itemKey(st.region.item), L, this.nextLanes())
			this.stores.push(rs)
			this.regions.push(rs)
		}
		for (const r of this.records)
			if (r.kind === "flow-hose")
				this.hoses.push({ rec: r, from: undefined, to: undefined, em: new Emitter(this.lane++), moved: 0, flow: 0, path: [], ran: false, said: false, started: false, back: false })
		for (const hz of this.hoses) {
			hz.from = this.storeOf(hz.rec.from as string)
			hz.to = this.storeOf(hz.rec.to as string | null)
		}
		this.placeAll(ctx)
		for (const st of this.basins) st.basin.tidy()
		this.sim.colliders = this.colliders
		this.sim.setStatic(this.moving)
		this.ready = true
		this.told(ctx)
		this.read(ctx, 0)
		this.keyframes(ctx, true)
	}

	/** What the run says at its start: a pitcher filled past its brim, a bottle's holes that do not fit, a pitcher put inside a fixed solid,
	 *  something in the way of a waterwheel's paddles. */
	told(ctx: ProcessContext) {
		const ml = (v: number) => Math.round(v * 1e6)
		for (const p of this.pours) {
			const r = p.rec
			if (finite(r.asked) && (r.asked as number) > ml(p.store.volume()) + 0.5)
				ctx.event(`only ${ml(p.store.volume())} mL fits in ${p.store.item} (not ${Math.round(r.asked as number)} mL): it is filled to the brim`, [p.store.item], "brim", 0)
		}
		for (const vs of this.vessels) {
			const d = vs.rec.dropped
			if (finite(d) && (d as number) > 0)
				ctx.event(
					`${vs.store.item} has room for only ${vs.holes.length} of its ${vs.holes.length + (d as number)} holes: the other ${d === 1 ? "one would be" : `${d} would be`} above its body`,
					[vs.store.item],
					"holes",
					0
				)
		}
		// (a pitcher's solids against every fixed solid of another item: the layout's own warning tells of the moving ones only)
		const others = this.handles.filter((h) => !h.dynamic)
		for (const p of this.pours) {
			const item = p.store.item
			const mine = this.handles.filter((h) => h.item === item)
			const inside = new Set<string>()
			for (const h of mine) {
				const a = pointsOf(h)
				for (const o of others) {
					if (o.item === item || inside.has(o.item)) continue
					if (overlapDepth(a, pointsOf(o)) > OVERLAP_TOL) inside.add(o.item)
				}
			}
			for (const o of inside) ctx.event(`${item} starts inside ${o}: move it up or aside, or its liquid pours into it`, [item, o], "inside", 0)
		}
		// (a waterwheel's paddles sweep a circle round its axle: a solid of another item in it jams the wheel)
		for (const w of this.wheels) {
			const item = w.rec.item ?? itemOf(w.rec.id)
			const hub = ctx.solid(w.rec.solid as string)
			if (hub === undefined) continue
			const c = hub.pose()
			let R = 0
			// (its paddles' circle: the parts that turn with its hub; a load the energy module hangs from its axle is the wheel's too, but hangs below)
			const turning = hub.dynamic ? hub.body().key : -1
			for (const h of this.handles) if (h.item === item && (!hub.dynamic || h.body().key === turning)) for (const q of pointsOf(h)) R = Math.max(R, Math.hypot(q.x - c.x, q.y - c.y))
			const inWay = new Set<string>()
			for (const h of this.handles) {
				if (h.item === item || inWay.has(h.item)) continue
				if (distanceTo(pointsOf(h), c) < R - 0.001) inWay.add(h.item)
			}
			for (const o of inWay) ctx.event(`${o} is in the way of ${item}'s paddles: it cannot turn freely`, [o, item], "jam", 0)
		}
	}

	/** The containers where they are now. */
	placeAll(ctx: ProcessContext) {
		for (const st of this.basins) {
			const h = ctx.solid(st.frame)
			st.place(h === undefined ? { x: 0, y: 0, angle: 0 } : h.pose())
		}
	}

	/** The solids' outlines and velocities now (a moving solid only while particles are near it: within 10 cm of its last outline). */
	updateColliders() {
		const sim = this.sim
		const occ = this.occupied
		occ.clear()
		for (let i = 0; i < sim.n; i++) occ.add(Math.floor((sim.x[i] as number) / 0.05) * 100003 + Math.floor((sim.y[i] as number) / 0.05))
		for (let i = 0; i < this.handles.length; i++) {
			const C = this.colliders[i] as Collider
			C.jx = 0
			C.jy = 0
			C.jt = 0
			if (!this.moving[i]) continue
			let near = false
			if (occ.size > 0)
				for (let gx = Math.floor((C.x0 - 0.1) / 0.05); gx <= Math.floor((C.x1 + 0.1) / 0.05) && !near; gx++)
					for (let gy = Math.floor((C.y0 - 0.1) / 0.05); gy <= Math.floor((C.y1 + 0.1) / 0.05); gy++)
						if (occ.has(gx * 100003 + gy)) {
							near = true
							break
						}
			if (!near && this.stale[i] === true) continue
			this.stale[i] = !near
			const h = this.handles[i] as SolidHandle
			shapeCollider(C, h.outline())
			const v = h.velocity()
			C.vx = v.x
			C.vy = v.y
			C.w = h.spin()
		}
	}

	/** The pitchers' hands: each tips its pitcher to the angle it should have at the end of this step. */
	tip(ctx: ProcessContext) {
		if (!ctx.released()) return
		const t = ctx.time() + ctx.step
		for (const p of this.pours) {
			if (p.body === null) continue
			const r = p.rec
			const at = r.at as number
			const turn = Math.max(0.05, r.turn as number)
			let k = ease((t - at) / turn)
			if (finite(r.back)) k *= 1 - ease((t - (r.back as number)) / turn)
			const want = p.a0 + k * (r.tilt as number)
			p.body.setAngularVelocity((want - p.body.getAngle()) / ctx.step)
			p.body.setLinearVelocity({ x: 0, y: 0 })
		}
	}

	/** Liquid over a basin's rim pours out over the lower corner (both, when level): a weir, into particles. */
	overRim(st: BasinStore, ctx: ProcessContext, dt: number, src: number): number {
		const b = st.basin
		if (b.layers.length === 0) return 0
		const g = ctx.settings.gravity
		const top = b.top()
		const corners = [b.rimA, b.rimB]
		const lowY = Math.min(b.rimA.y, b.rimB.y)
		if (!(top > lowY)) return 0
		let out = 0
		const wet = flatCentroid(clipBelowFlat(b.world, Math.min(top, Math.max(b.rimA.y, b.rimB.y, top))))
		const c = Math.cos(st.pose.angle)
		const h = ctx.solid(st.frame)
		const v0 = h?.velocity() ?? { x: 0, y: 0 }
		const w0 = h?.spin() ?? 0
		const mid = h?.pose() ?? st.pose
		for (let k = 0; k < 2; k++) {
			const corner = corners[k] as Point
			if (corner.y - lowY > 0.0005) continue
			const H = top - corner.y
			const li = b.layers.length - 1
			const layer = b.layers[li] as BasinLayer
			const Lq = this.liquids.list[layer.liq] as FlowLiquid
			const { q, v } = weirFlow(H, Lq.viscosity / Lq.density, g)
			const want = q * st.lip * dt
			const got = st.take(li, want)
			if (!(got > 0)) continue
			out += got
			// it leaves the lip level, away from the liquid (over the weir's crest), just past the lip's wall
			const ox = k === 0 ? c : -c
			const ux = corner.x > wet.x + 1e-9 ? 1 : corner.x < wet.x - 1e-9 ? -1 : Math.sign(ox) || 1
			const uy = 0
			const ex = corner.x + ux * (st.wall + this.sim.rc + 0.001)
			const ey = corner.y - 0.5 * this.sim.rc
			const bx = v0.x - w0 * (ey - mid.y)
			const by = v0.y + w0 * (ex - mid.x)
			;(st.lips[k] as Emitter).run(this.sim, dt, ex, ey, ux, uy, Math.max(v, 0.05), got / dt, (2 / 3) * H, layer.liq, layer.a, src, bx, by)
			if (!this.pours.some((p) => p.store === st)) {
				st.over += got
				if (!st.overflowed) {
					st.overflowed = true
					ctx.event(`${st.item} overflows`, [st.item], "overflow")
				}
			}
		}
		return out
	}

	/** One step of everything (dt = the engine's step). */
	step(ctx: ProcessContext) {
		const dt = ctx.step
		const t = ctx.time()
		const g = ctx.settings.gravity
		this.tip(ctx)
		this.updateColliders()
		this.placeAll(ctx)
		// --- pitchers and containers pouring over their rims
		for (const p of this.pours) {
			const out = this.overRim(p.store, ctx, dt, p.store.key)
			p.flow = out / dt
			if (out > 0 && !p.said) {
				p.said = true
				ctx.event(`${p.store.item} starts pouring`, [p.store.item], "pour")
			}
			if (p.said && !p.empty && p.store.volume() <= Math.max(1e-9, 0.002 * p.start)) {
				p.empty = true
				ctx.event(`${p.store.item} is empty`, [p.store.item], "empty")
			}
		}
		for (const st of this.basins) if (!this.pours.some((p) => p.store === st)) this.overRim(st, ctx, dt, st.key)
		// --- taps
		for (const tp of this.taps) {
			const r = tp.rec
			const on = t >= (r.on as number) && (!finite(r.off) || t < (r.off as number))
			const q = on ? (r.q as number) : 0
			const d = r.d as number
			const v = q / ((Math.PI / 4) * d * d)
			const ux = Math.cos(r.angle as number)
			const uy = Math.sin(r.angle as number)
			const at = r.at as Point
			const put = tp.em.run(this.sim, dt, at.x + ux * this.sim.rc, at.y + uy * this.sim.rc, ux, uy, Math.max(v, 0.05), q, d, tp.liq, r.dye as Dye, this.itemKey(r.item ?? itemOf(r.id)))
			void put
			const item = r.item ?? itemOf(r.id)
			if (q > 0 && !tp.on) {
				tp.on = true
				ctx.event(`${item} turns on (${Math.round(q * 1e6)} mL/s)`, [item], "tap")
			} else if (!(q > 0) && tp.on) {
				tp.on = false
				ctx.event(`${item} turns off after ${Math.round(tp.flowed * 1e6)} mL`, [item], "tap")
			}
			tp.flowed += q * dt
			tp.flow = q
		}
		// --- vessels: holes (an orifice each) and a kept head
		for (const vs of this.vessels) {
			const st = vs.store
			const r = vs.rec
			const pose = st.pose
			const c = Math.cos(pose.angle)
			const s = Math.sin(pose.angle)
			let flow = 0
			const open = t >= (r.open as number) && r.cap !== true
			if (r.cap === true && t >= (r.open as number) && !vs.capped && vs.holes.length > 0 && st.volume() > 0) {
				vs.capped = true
				ctx.event(`${st.item}'s holes open, but its cap is on: no air gets in, so no water comes out`, [st.item], "capped")
			}
			for (const h of vs.holes) {
				const hx = pose.x + h.x * c - h.y * s
				const hy = pose.y + h.x * s + h.y * c
				const layer = st.layerAt(hy)
				h.q = 0
				h.v = 0
				if (!open || layer < 0) {
					if (h.wet && !h.said && layer < 0) {
						h.said = true
						ctx.event(`${st.item}'s hole ${vs.holes.indexOf(h) + 1} stops spurting`, [st.item], "dry")
					}
					continue
				}
				const Lq = this.liquids.list[st.liquidOf(layer)] as FlowLiquid
				const p = st.pressure(hy, g)
				const { q, v } = orificeFlow(p, h.d, Lq.density, Lq.viscosity)
				const got = st.take(layer, q * dt)
				if (!(got > 0)) continue
				h.wet = true
				h.q = got / dt
				h.v = v
				flow += got / dt
				const ux = Math.cos(h.angle + pose.angle)
				const uy = Math.sin(h.angle + pose.angle)
				const off = st.wall + this.sim.rc + 0.0005
				h.em.run(this.sim, dt, hx + ux * off, hy + uy * off, ux, uy, Math.max(v, 0.05), got / dt, h.d, st.liquidOf(layer), st.dyeOf(layer), st.key)
			}
			vs.flow = flow
			if (flow > 0 && !vs.jetted) {
				vs.jetted = true
				const n = vs.holes.filter((h) => h.q > 0).length
				ctx.event(`${st.item}'s jets start (${n} ${n === 1 ? "hole" : "holes"})`, [st.item], "jets")
			}
			if (r.full === true && open) {
				const lack = vs.start - st.volume()
				const top = st.basin.layers[st.basin.layers.length - 1]
				if (lack > 0 && top !== undefined) {
					top.vol += lack
					vs.topped += lack
				}
			}
			st.basin.tidy()
		}
		// --- hoses and siphons
		for (const hz of this.hoses) this.siphon(hz, ctx, dt)
		// --- the fluids containers' overflow becomes a pour over their rims
		for (const rs of this.regions) {
			const spilt = rs.st.spilled - rs.lastSpilled
			rs.lastSpilled = rs.st.spilled
			if (!(spilt > 0)) continue
			const r = rs.st.region
			const li = Math.max(0, rs.st.volumes.length - 1)
			const liq = rs.liquidOf(li)
			for (let k = 0; k < 2; k++) {
				const x = k === 0 ? r.x1 + 0.006 + this.sim.rc : r.x0 - 0.006 - this.sim.rc
				;(rs.spill[k] as Emitter).run(this.sim, dt, x, r.rim + this.sim.rc, k === 0 ? 1 : -1, 0, 0.25, spilt / 2 / dt, 0.01, liq, rs.dyeOf(li), rs.key)
			}
		}
		// --- the particles
		this.sim.colliders = this.colliders
		// (where each particle was before this step: a jet's landing is where it crosses the level its bottle stands on)
		if (this.vessels.length > 0) {
			if (this.yBefore.length < this.sim.n) {
				this.yBefore = new Float64Array(Math.max(64, 2 * this.sim.n))
				this.flewBefore = new Uint8Array(this.yBefore.length)
			}
			this.yBefore.set(this.sim.y.subarray(0, this.sim.n))
			for (let i = 0; i < this.sim.n; i++) this.flewBefore[i] = this.sim.landed[i] === 0 ? 1 : 0
		}
		const fast = this.sim.fastest()
		const sub = Math.max(1, Math.min(2, Math.ceil((fast * dt) / this.sim.s)))
		for (let k = 0; k < sub; k++) this.sim.step(dt / sub, g)
		this.land(ctx)
		this.sim.compact()
		for (const st of this.basins) st.basin.tidy()
		this.placeAll(ctx)
		this.carry(ctx)
		for (const st of this.catchers()) {
			const v = st.volume()
			if (v > st.peak + 1e-7) {
				st.peak = v
				st.peakAt = t + dt
			}
		}
		for (const rs of this.regions) {
			const v = rs.volume()
			if (rs.received > 0 && v > rs.peak + 1e-7) {
				rs.peak = v
				rs.peakAt = t + dt
			}
		}
		this.steps++
		this.read(ctx, dt)
		this.keyframes(ctx, false)
	}

	/**
	 * A hose: from one container's surface to the other's (or to its free end), Bernoulli with its losses. A filled hose flows from the higher
	 * surface to the lower whatever its ends are called: named the other way round (`from` the lower), it runs from `to` to `from`.
	 */
	siphon(hz: Hose, ctx: ProcessContext, dt: number) {
		const r = hz.rec
		const from = hz.from
		hz.flow = 0
		if (from === undefined) return
		const g = ctx.settings.gravity
		const item = r.item ?? itemOf(r.id)
		const out = r.out as Point
		const inlet = from.nearWall(hz.to !== undefined ? (hz.to.nearWall(out.x, 0).x ?? out.x) : out.x, Math.max(0, r.inlet as number))
		const outlet = hz.to !== undefined ? hz.to.nearWall(inlet.x, 0.015) : out
		// the path: up the wall from the inlet, over the rim, down to the outlet
		const over = Math.max(from.rimTop(), hz.to?.rimTop() ?? Number.NEGATIVE_INFINITY, outlet.y) + 0.02
		const path = [inlet.x, inlet.y, inlet.x, over, outlet.x, over, outlet.x, outlet.y]
		hz.path = path
		let length = 0
		for (let k = 0; k + 3 < path.length; k += 2) length += Math.hypot((path[k + 2] as number) - (path[k] as number), (path[k + 3] as number) - (path[k + 1] as number))
		if (finite(r.length)) length = r.length as number
		if (ctx.time() < (r.open as number)) return
		// (which way: the source is the higher surface, so long as liquid stands over that end of the hose)
		let src: Store = from
		let dst: Store | undefined = hz.to
		let a: Point = inlet
		let b: Point = outlet
		const to = hz.to
		if (to !== undefined && to.top() > from.top() + 0.0005 && to.top() > outlet.y && to.layerAt(outlet.y) >= 0) {
			src = to
			dst = from
			a = outlet
			b = inlet
			if (!hz.back) {
				hz.back = true
				ctx.event(`${item} runs from ${to.item} to ${from.item}: that surface is the higher`, [item, to.item, from.item], "siphon")
			}
		}
		const top = src.top()
		const layer = src.layerAt(a.y)
		if (layer < 0 || !(top > a.y)) return
		const end = dst !== undefined ? Math.max(dst.top(), b.y) : b.y
		const head = top - end
		if (!(head > 0.0005)) {
			if (hz.ran && !hz.said && hz.to !== undefined) {
				hz.said = true
				ctx.event(`${item} stops: the two surfaces are level`, [item], "level")
			}
			return
		}
		const liq = src.liquidOf(layer)
		const Lq = this.liquids.list[liq] as FlowLiquid
		const d = r.d as number
		const v = pipeSpeed(head, d, length, Lq.viscosity / Lq.density, g)
		const q = v * (Math.PI / 4) * d * d
		const dye = src.dyeOf(layer)
		const got = src.take(layer, q * dt)
		if (!(got > 0)) return
		hz.ran = true
		hz.moved += got
		// (once a millilitre has gone through: a thick liquid in a thin hose may creep far too slowly to be called a siphon)
		if (!hz.started && hz.moved >= 1e-6) {
			hz.started = true
			ctx.event(`${item} starts siphoning`, [item], "siphon")
		}
		hz.flow = got / dt
		if (dst !== undefined) dst.add(got, liq, dye)
		else {
			const ux = path.length >= 4 ? b.x - (path[path.length - 4] as number) : 0
			const uy = path.length >= 4 ? b.y - (path[path.length - 3] as number) : -1
			const n = Math.sqrt(ux * ux + uy * uy) || 1
			hz.em.run(this.sim, dt, b.x + (ux / n) * this.sim.rc, b.y + (uy / n) * this.sim.rc, ux / n, uy / n, Math.max(v, 0.05), got / dt, d, liq, dye, this.itemKey(item))
		}
	}

	/** Particles that fell into a container's liquid (or came to rest on its empty floor) join it; those gone below everything are spilt. */
	land(ctx: ProcessContext) {
		const sim = this.sim
		const rc = sim.rc
		this.boxes = this.stores.map((st) => {
			if (st instanceof BasinStore) {
				const w = st.basin.world
				let x0 = Number.POSITIVE_INFINITY
				let x1 = Number.NEGATIVE_INFINITY
				let y0 = Number.POSITIVE_INFINITY
				let y1 = Number.NEGATIVE_INFINITY
				for (let q = 0; q < w.length; q += 2) {
					x0 = Math.min(x0, w[q] as number)
					x1 = Math.max(x1, w[q] as number)
					y0 = Math.min(y0, w[q + 1] as number)
					y1 = Math.max(y1, w[q + 1] as number)
				}
				return [x0, x1, y0, y1]
			}
			const r = (st as RegionStore).st.region
			return [r.x0, r.x1, r.floor - 0.002, r.rim]
		})
		for (let i = 0; i < sim.n; i++) {
			const x = sim.x[i] as number
			const y = sim.y[i] as number
			if (y < this.killY || Math.abs(x) > 200) {
				this.spilled += sim.vol[i] as number
				sim.dead[i] = 1
				continue
			}
			// the reach of a vessel's jets, where they cross what it stands on
			const lane = (sim.lane[i] as number) >> 3
			for (const vs of this.vessels)
				for (const h of vs.holes) {
					if (h.lane !== lane) continue
					const y0 = (vs.rec.ground as number) + rc + 0.001
					const prev = this.yBefore[i] as number
					if (prev > y0 && y <= y0 && this.flewBefore[i] === 1) {
						const pose = vs.store.pose
						const hx = pose.x + h.x * Math.cos(pose.angle) - h.y * Math.sin(pose.angle)
						h.reach = Math.abs(x - hx)
					}
				}
			const src = sim.src[i] as number
			// (where the source's stream comes down: its particles' first touch, as a running mean over about 30 of them)
			if (sim.landed[i] === 1 && sim.counted[i] === 0) {
				sim.counted[i] = 1
				const was = this.lands.get(src)
				this.lands.set(src, was === undefined ? x : was + (x - was) / 30)
			}
			let inside = false
			for (let k = 0; k < this.stores.length; k++) {
				const st = this.stores[k] as Store
				if (st.key === src) continue
				const bb = this.boxes[k] as number[]
				if (x < (bb[0] as number) || x > (bb[1] as number) || y < (bb[2] as number) || y > (bb[3] as number)) continue
				if (!st.inside(x, y)) continue
				inside = true
				if (y > st.top() + 1.2 * rc) continue
				const vol = sim.vol[i] as number
				if (sim.counted[i] === 0) {
					sim.counted[i] = 1
					const was = this.lands.get(src)
					this.lands.set(src, was === undefined ? x : was + (x - was) / 30)
				}
				st.add(vol, sim.liq[i] as number, [sim.a0[i] as number, sim.a1[i] as number, sim.a2[i] as number])
				if (st instanceof BasinStore && this.carried.has(st)) {
					// its momentum (against the container's own motion) goes to the container
					const h = ctx.solid(st.frame)
					const v = h?.velocity() ?? { x: 0, y: 0 }
					const m = sim.mass(i)
					st.jx += m * ((sim.vx[i] as number) - v.x)
					st.jy += m * ((sim.vy[i] as number) - v.y)
				}
				sim.dead[i] = 1
				break
			}
			if (sim.dead[i] === 1 || inside) continue
			// come to rest on a fixed surface that is level (a table, a shelf, the floor), in no container: it joins that surface's puddle (on a
			// slope it runs on down)
			const c = sim.hit[i] as number
			if (c < 0 || (sim.ny[i] as number) < LEVEL_NY) continue
			const C = this.colliders[c] as Collider
			if (C.dynamic || this.moving[c] === true) continue
			// (once slow, or after a tenth of a second of sliding: a stream striking a table spreads into a thin film and stops within a
			// few centimetres, which the slice's particles cannot be thin enough to show)
			const vx = sim.vx[i] as number
			const vy = sim.vy[i] as number
			if (vx * vx + vy * vy > 0.09 && (sim.touch[i] as number) < 48) continue
			const vol = sim.vol[i] as number
			let p = this.puddles.get(c)
			if (p === undefined) {
				p = { key: c, item: (this.handles[c] as SolidHandle).item, ang: Math.atan2(-(sim.nx[i] as number), sim.ny[i] as number), vol: 0, xv: 0, x0: x, x1: x, y: y - rc, a: [0, 0, 0], liq: sim.liq[i] as number }
				this.puddles.set(c, p)
			}
			p.vol += vol
			p.xv += vol * x
			p.x0 = Math.min(p.x0, x)
			p.x1 = Math.max(p.x1, x)
			p.a = [p.a[0] + vol * (sim.a0[i] as number), p.a[1] + vol * (sim.a1[i] as number), p.a[2] + vol * (sim.a2[i] as number)]
			sim.dead[i] = 1
		}
	}

	/**
	 * Where every m³ of the run's liquid is now (for the validators' conservation check): in this module's containers, in the fluids module's
	 * (as its layers stand, without what it spilled: that became particles here), in particles, in puddles, gone off the table, owed by a
	 * source to particles it has not made yet; and what came in from outside (taps, a kept-full bottle's top-ups).
	 */
	budget(): { basins: number; regions: number; particles: number; puddles: number; spilled: number; owed: number; inflow: number } {
		let basins = 0
		for (const st of this.basins) basins += st.volume()
		let regions = 0
		for (const rs of this.regions) regions += rs.volume()
		let owed = 0
		const ems: Emitter[] = []
		for (const st of this.basins) ems.push(...st.lips)
		for (const rs of this.regions) ems.push(...rs.spill)
		for (const v of this.vessels) for (const h of v.holes) ems.push(h.em)
		for (const t of this.taps) ems.push(t.em)
		for (const h of this.hoses) ems.push(h.em)
		for (const e of ems) owed += e.owed
		let inflow = 0
		for (const t of this.taps) inflow += t.flowed
		for (const v of this.vessels) inflow += v.topped
		return { basins, regions, particles: this.sim.volume(), puddles: this.puddled(), spilled: this.spilled, owed, inflow }
	}

	/** Liquid in puddles, m³. */
	puddled(): number {
		let v = 0
		for (const p of this.puddles.values()) v += p.vol
		return v
	}

	/** A moving container carries its liquid: its body's mass, centre and inertia with the liquid's added (rigidly: no sloshing). */
	carry(ctx: ProcessContext) {
		const eng = ctx.engine()
		if (eng === undefined) return
		const S = eng.lengthScale
		for (const [st, c] of this.carried) {
			const body = c.body
			// (something else reset the body's mass, a resize: take its new one as the container's own)
			if (Math.abs(body.getMass() - c.last) > 1e-12) {
				const base = { mass: 0, center: { x: 0, y: 0 }, I: 0 }
				body.getMassData(base)
				c.base = { mass: base.mass, center: { x: base.center.x, y: base.center.y }, I: base.I }
			}
			let m = 0
			for (const l of st.basin.layers) m += (this.liquids.list[l.liq] as FlowLiquid).density * l.vol
			// (what it holds weighs: a kitchen scale under it reads its mass with it)
			ctx.solid(st.frame)?.carry?.(m)
			const b = c.base
			if (!(m > 0)) {
				if (c.last !== b.mass) {
					body.setMassData({ mass: b.mass, center: { x: b.center.x, y: b.center.y }, I: b.I })
					c.last = body.getMass()
				}
				continue
			}
			const wet = clipBelowFlat(st.basin.world, st.basin.top())
			const cen = flatCentroid(wet)
			const lp = body.getLocalPoint({ x: cen.x * S, y: cen.y * S })
			const M = b.mass + m
			const cx = (b.mass * b.center.x + m * lp.x) / M
			const cy = (b.mass * b.center.y + m * lp.y) / M
			// the liquid's own inertia about its centroid: a slab of the inside's width and the liquid's height
			const wdt = st.basin.width() * S
			const hgt = (Math.abs(cen.area) / Math.max(1e-9, st.basin.width())) * S
			const I = b.I + m * (lp.x * lp.x + lp.y * lp.y) + (m * (wdt * wdt + hgt * hgt)) / 12
			body.setMassData({ mass: M, center: { x: cx, y: cy }, I })
			body.setAwake(true)
			c.last = body.getMass()
		}
	}

	/** Pushes back on the solids what the particles took from them this step (each (sub-)step of h s gets the step's average force). */
	force(ctx: ProcessContext) {
		const dt = ctx.step
		for (let i = 0; i < this.handles.length; i++) {
			const C = this.colliders[i] as Collider
			if (!C.dynamic || (C.jx === 0 && C.jy === 0 && C.jt === 0)) continue
			const h = this.handles[i] as SolidHandle
			h.push(-C.jx / dt, -C.jy / dt, { x: C.mx, y: C.my })
			h.twist(-C.jt / dt)
		}
		for (const st of this.carried.keys()) {
			if (st.jx === 0 && st.jy === 0) continue
			const h = ctx.solid(st.frame)
			const cen = flatCentroid(clipBelowFlat(st.basin.world, st.basin.top()))
			h?.push(st.jx / dt, st.jy / dt, { x: cen.x, y: cen.y })
		}
	}

	/**
	 * Floating in a catalog container's liquid (each (sub-)step of h s): the liquid as it stands now, as a fluids-module container (its inner
	 * walls, floor, rim and layers), and the moving things that reach into it (not the container itself) get that module's push (fluidPushes:
	 * buoyancy ρ·g·V at the wet volume's centre, drag, added mass); the readings as that module's (submerged, buoyancy_n, afloat, sunk,
	 * draft_mm). A container tipped more than about 10° floats nothing (its liquid is pouring out). Not yet: the level is not raised by what
	 * floats in it, and the liquid's push back on the container is left out (a few grams for a cork in a jar).
	 */
	floats(ctx: ProcessContext, h: number) {
		if (this.floaters.length === 0) return
		// (the air's density: a world's own, settings.airDensity; the standard 1.2 bit for bit)
		const env = { g: ctx.settings.gravity, air: ctx.settings.air ? (ctx.settings.airDensity ?? 1.2) : 0 }
		const byItem = new Map<string, { lift: number; weight: number; under: number; whole: number; slow: boolean; touching: boolean; low: number; top: number }>()
		for (const st of this.catchers()) {
			const b = st.basin
			if (b.layers.length === 0 || !(st.volume() > 0)) continue
			if (!(Math.cos(st.pose.angle) > 0.985)) continue
			let x0 = Number.POSITIVE_INFINITY
			let x1 = Number.NEGATIVE_INFINITY
			for (let q = 0; q < b.world.length; q += 2) {
				x0 = Math.min(x0, b.world[q] as number)
				x1 = Math.max(x1, b.world[q] as number)
			}
			const floor = b.bottom
			const rim = st.rimTop()
			const layers = b.layers.map((l) => {
				const L = this.liquids.list[l.liq] as FlowLiquid
				return { words: L.words, density: L.density, viscosity: L.viscosity, height: 0 }
			})
			const rs: RegionState = {
				region: { id: `${st.item}/basin`, item: st.item, x0, x1, floor, rim, area: Math.max(1e-9, b.width() * b.depth), layers },
				volumes: b.layers.map((l) => l.vol),
				spilled: 0,
				tops: [...b.tops]
			}
			const found: { body: FluidBody; root: SolidHandle; item: string; touching: boolean; parts: FluidShape[] }[] = []
			for (const g of this.floaters) {
				if (g.item === st.item) continue
				const hs: SolidHandle[] = []
				for (const id of g.parts) {
					const q = ctx.solid(id)
					if (q !== undefined && q.dynamic && q.scale() >= 0.01) hs.push(q)
				}
				const first = hs[0]
				if (first === undefined) continue
				const parts = hs.map(shapeOf)
				let near = false
				for (const q of parts) {
					const bb = shapeBox(q)
					if (bb.x1 >= x0 && bb.x0 <= x1 && bb.y0 <= rim && bb.y1 >= floor) near = true
				}
				if (!near) continue
				const view = first.body()
				let touching = false
				for (const q of hs) if (ctx.touching(q.id).length > 0) touching = true
				const root = ctx.solid(g.root) ?? first
				found.push({
					root,
					item: g.item,
					touching,
					parts,
					body: { key: view.key, mass: view.mass, inertia: view.inertia, com: view.center, v: view.velocity, w: view.spin, free: !touching && !view.jointed, force: view.force, torque: view.torque, parts }
				})
			}
			if (found.length === 0) continue
			const pushes = fluidPushes([rs], found.map((f) => f.body), h, env)
			const surface = rs.tops.at(-1) ?? floor
			for (const f of found) {
				const p = pushes.get(f.body.key)
				if (p !== undefined && ctx.released()) {
					f.root.push(p.fx, p.fy, f.body.com)
					f.root.twist(p.torque)
				}
				if (p === undefined && !this.wet.has(f.item)) continue
				this.wet.add(f.item)
				const e = byItem.get(f.item) ?? { lift: 0, weight: 0, under: 0, whole: 0, slow: true, touching: false, low: Number.POSITIVE_INFINITY, top: Number.NEGATIVE_INFINITY }
				e.lift += p?.lift ?? 0
				e.weight += f.body.mass * env.g
				e.under += p?.submerged ?? 0
				e.whole += p !== undefined && p.fraction > 0 ? p.submerged / p.fraction : 0
				if (Math.abs(f.body.v.y) >= RESTING) e.slow = false
				if (f.touching) e.touching = true
				if (p !== undefined) {
					for (const q of f.parts) e.low = Math.min(e.low, shapeBox(q).y0)
					e.top = Math.max(e.top, surface)
				}
				byItem.set(f.item, e)
			}
		}
		for (const item of this.wet) {
			const e = byItem.get(item)
			const ratio = e === undefined || !(e.weight > 0) || !(e.under > 0) ? 0 : e.lift / e.weight
			const before = this.support.get(item)
			const smooth = before === undefined ? ratio : before + (ratio - before) * Math.min(1, h / SUPPORT_TAU)
			this.support.set(item, smooth)
			const fraction = e !== undefined && e.whole > 0 ? Math.min(1, e.under / e.whole) : 0
			ctx.set(item, "submerged", fraction)
			ctx.set(item, "buoyancy_n", e?.lift ?? 0)
			ctx.set(item, "afloat", fraction > 0 && smooth >= AFLOAT ? 1 : 0)
			ctx.set(item, "sunk", e !== undefined && fraction > 0 && smooth < AFLOAT && e.slow && e.touching ? 1 : 0)
			ctx.set(item, "draft_mm", e !== undefined && Number.isFinite(e.low) && e.top > e.low ? (e.top - e.low) * 1000 : 0)
		}
	}

	/** At the end: how full each container that was filled got, at the moment it last gained ("<cup> fills to 200 mL"). */
	finish(ctx: ProcessContext) {
		for (const st of this.catchers())
			if (st.received > 5e-7 && st.peak > 5e-7) ctx.event(`${st.item} fills to ${Math.round(st.peak * 1e6)} mL`, [st.item], "fill", st.peakAt)
		for (const rs of this.regions) if (rs.received > 5e-7 && rs.peak > 0) ctx.event(`${rs.item} fills to ${Math.round(rs.peak * 1e6)} mL`, [rs.item], "fill", rs.peakAt)
	}
	/** The impulses of a step are forces only through it. */
	clearPushes() {
		for (const st of this.carried.keys()) {
			st.jx = 0
			st.jy = 0
		}
	}

	/** The readings (track.state). */
	read(ctx: ProcessContext, dt: number) {
		void dt
		const ml = (v: number) => v * 1e6
		for (const p of this.pours) {
			const item = p.store.item
			const lx = this.lands.get(p.store.key)
			if (lx !== undefined) ctx.set(item, "lands_x", lx)
			ctx.set(item, "left_ml", ml(p.store.volume()))
			ctx.set(item, "poured_ml", ml(p.store.poured))
			ctx.set(item, "flow_ml_s", ml(p.flow))
			const pose = p.store.pose
			ctx.set(item, "tilt_deg", (Math.abs(pose.angle - p.a0) * 180) / Math.PI)
		}
		for (const tp of this.taps) {
			const item = tp.rec.item ?? itemOf(tp.rec.id)
			const lx = this.lands.get(this.itemKey(item))
			if (lx !== undefined) ctx.set(item, "lands_x", lx)
			ctx.set(item, "flowed_ml", ml(tp.flowed))
			ctx.set(item, "flow_ml_s", ml(tp.flow))
		}
		for (const vs of this.vessels) {
			const st = vs.store
			ctx.set(st.item, "left_ml", ml(st.volume()))
			ctx.set(st.item, "level_mm", (st.top() - st.low()) * 1000)
			ctx.set(st.item, "poured_ml", ml(st.poured))
			ctx.set(st.item, "flow_ml_s", ml(vs.flow))
			vs.holes.forEach((h, k) => {
				ctx.set(st.item, `jet${k + 1}_ms`, h.v)
				ctx.set(st.item, `reach${k + 1}_m`, h.reach)
			})
		}
		for (const hz of this.hoses) {
			const item = hz.rec.item ?? itemOf(hz.rec.id)
			const lx = this.lands.get(this.itemKey(item))
			if (lx !== undefined) ctx.set(item, "lands_x", lx)
			ctx.set(item, "moved_ml", ml(hz.moved))
			ctx.set(item, "flow_ml_s", ml(hz.flow))
		}
		for (const st of this.basins) {
			if (this.pours.some((p) => p.store === st) || this.vessels.some((v) => v.store === st)) continue
			ctx.set(st.item, "liquid_ml", ml(st.volume()))
			ctx.set(st.item, "level_mm", (st.top() - st.low()) * 1000)
			ctx.set(st.item, "overflow_ml", ml(st.over))
			const tint = this.tint(st.item, this.mixed(st.basin.layers))
			ctx.set(st.item, "tint_r", tint[0])
			ctx.set(st.item, "tint_g", tint[1])
			ctx.set(st.item, "tint_b", tint[2])
		}
		for (const rs of this.regions) {
			if (!(rs.received > 0) && !(rs.taken > 0)) continue
			ctx.set(rs.item, "received_ml", ml(rs.received))
			const tint = this.tint(rs.item, this.mixedRegion(rs))
			ctx.set(rs.item, "tint_r", tint[0])
			ctx.set(rs.item, "tint_g", tint[1])
			ctx.set(rs.item, "tint_b", tint[2])
		}
		if (this.puddles.size > 0) {
			const by = new Map<string, number>()
			for (const p of this.puddles.values()) by.set(p.item, (by.get(p.item) ?? 0) + p.vol)
			for (const [item, v] of by) ctx.set(item, "puddle_ml", ml(v))
		}
		for (const w of this.wheels) {
			const h = ctx.solid(w.rec.solid as string)
			const spin = h?.spin() ?? 0
			w.turns += (Math.abs(spin) * ctx.step) / (2 * Math.PI)
			const rpm = (Math.abs(spin) * 60) / (2 * Math.PI)
			const item = w.rec.item ?? itemOf(w.rec.id)
			ctx.set(item, "rpm", rpm)
			ctx.set(item, "turns", w.turns)
			if (!w.said && rpm >= 10) {
				w.said = true
				ctx.event(`${item} starts turning`, [item], "turns")
			}
		}
	}

	/** What shows through 5 cm of a container's liquid, worked out again only when its mix has changed. */
	tint(item: string, a: Dye): [number, number, number] {
		const was = this.tints.get(item)
		if (was !== undefined && was.a[0] === a[0] && was.a[1] === a[1] && was.a[2] === a[2]) return was.t
		const t = tintOf(a, 5)
		this.tints.set(item, { a: [a[0], a[1], a[2]], t })
		return t
	}

	/**
	 * The colour of a container's liquid: its biggest layer's (its dye and its own colour). Liquids that do not mix stay apart (blue water
	 * under yellow oil is blue below and yellow above, never green): only what pours into the same liquid mixes, by volume (blue + yellow
	 * water is green).
	 */
	mixed(layers: readonly BasinLayer[]): Dye {
		let big: BasinLayer | undefined
		for (const l of layers) if (big === undefined || l.vol > big.vol) big = l
		if (big === undefined || !(big.vol > 0)) return [0, 0, 0]
		const own = dyeOfWords((this.liquids.list[big.liq] as FlowLiquid).words)
		return [(big.a[0] as number) + (own[0] as number), (big.a[1] as number) + (own[1] as number), (big.a[2] as number) + (own[2] as number)]
	}
	/** The same for a fluids-module container: its biggest layer's colour. */
	mixedRegion(rs: RegionStore): Dye {
		let at = -1
		rs.st.volumes.forEach((vol, i) => {
			if (at < 0 || vol > (rs.st.volumes[at] as number)) at = i
		})
		if (at < 0 || !((rs.st.volumes[at] as number) > 0)) return [0, 0, 0]
		const own = dyeOfWords((rs.st.region.layers[at] as { words: string }).words)
		const d = rs.dyes[at] ?? [0, 0, 0]
		const added = d[0] === own[0] && d[1] === own[1] && d[2] === own[2]
		return [(d[0] as number) + (added ? 0 : (own[0] as number)), (d[1] as number) + (added ? 0 : (own[1] as number)), (d[2] as number) + (added ? 0 : (own[2] as number))]
	}

	/** What the view draws: the particles, each container's layers and inside, each hose's path. */
	keyframes(ctx: ProcessContext, first: boolean) {
		if (!first && this.steps % KEY_EVERY !== 0) return
		const sim = this.sim
		if (sim.n > 0 || this.keyed || first) {
			const list: number[] = []
			let la = Number.NaN
			let lb = Number.NaN
			let lc = Number.NaN
			let ll = -1
			let col = 0
			for (let i = 0; i < sim.n; i++) {
				const a0 = sim.a0[i] as number
				const a1 = sim.a1[i] as number
				const a2 = sim.a2[i] as number
				const li = sim.liq[i] as number
				if (a0 !== la || a1 !== lb || a2 !== lc || li !== ll) {
					// (dye to three digits is all a 4-bit colour can show)
					const key = `${li}|${Math.round(a0 * 1000)}|${Math.round(a1 * 1000)}|${Math.round(a2 * 1000)}`
					let c = this.looks.get(key)
					if (c === undefined) {
						const own = dyeOfWords((this.liquids.list[li] as FlowLiquid).words)
						c = look12([Math.round(a0 * 1000) / 1000 + (own[0] as number), Math.round(a1 * 1000) / 1000 + (own[1] as number), Math.round(a2 * 1000) / 1000 + (own[2] as number)], 3)
						this.looks.set(key, c)
					}
					col = c
					la = a0
					lb = a1
					lc = a2
					ll = li
				}
				const dmm = Math.max(1, Math.min(999, Math.round(((sim.vol[i] as number) / (sim.s * sim.s)) * 1000)))
				const touch = (sim.hit[i] as number) >= 0 || sim.sleep[i] === 1 ? 1 : 0
				const lane = (sim.lane[i] as number) % 1048576
				list.push(sim.pid[i] as number, Math.round((sim.x[i] as number) * 1000), Math.round((sim.y[i] as number) * 1000), col + 4096 * (dmm + 1000 * (lane + 1048576 * touch)))
			}
			ctx.keyframe(this.ownerItem, "p", list)
			this.keyed = sim.n > 0
		}
		for (const st of this.basins) {
			const b = st.basin
			const list: number[] = []
			b.layers.forEach((l, i) => {
				const own = dyeOfWords((this.liquids.list[l.liq] as FlowLiquid).words)
				list.push(b.tops[i] ?? b.bottom, look12([l.a[0] + (own[0] as number), l.a[1] + (own[1] as number), l.a[2] + (own[2] as number)], 5))
			})
			ctx.keyframe(st.item, "b", list)
			if (first) ctx.keyframe(st.item, "i", [...b.local.flatMap((p) => [p.x, p.y]), b.depth])
		}
		for (const rs of this.regions) {
			if (!(rs.received > 0) && !first) continue
			const a = this.mixedRegion(rs)
			ctx.keyframe(rs.item, "b", [rs.top(), look12(a, 5)])
		}
		for (const hz of this.hoses) if (hz.path.length > 0) ctx.keyframe(hz.rec.item ?? itemOf(hz.rec.id), "h", hz.path)
		if (this.puddles.size > 0) {
			// each puddle: its middle x, its surface y, mL, the span its liquid landed over, its look, its depth (mm), its surface's slope (rad)
			const list: number[] = []
			for (const p of this.puddles.values()) {
				const L = this.liquids.list[p.liq] as FlowLiquid
				const own = dyeOfWords(L.words)
				const a: Dye = [p.a[0] / p.vol + (own[0] as number), p.a[1] / p.vol + (own[1] as number), p.a[2] / p.vol + (own[2] as number)]
				const deep = L.viscosity / L.density > 1e-4 ? PUDDLE_DEPTH_THICK : PUDDLE_DEPTH
				list.push(p.xv / p.vol, p.y, p.vol * 1e6, p.x0, p.x1, look12(a, 0.4), deep * 1000, p.ang)
			}
			ctx.keyframe(this.ownerItem, "d", list)
		}
	}
}

const runs = new WeakMap<SimScene<string>, Flow>()
const flowOf = (scene: SimScene<string>) => {
	let f = runs.get(scene)
	if (f === undefined) {
		f = new Flow(scene)
		runs.set(scene, f)
	}
	return f
}

/** The run's flow (for a test or another module), or undefined in a scene without any. */
export const flowIn = (scene: SimScene<string>) => runs.get(scene)

const create = (record: ProcessRecord, ctx: ProcessContext) => {
	const f = flowOf(ctx.scene)
	if (f.owner !== record.id) return {}
	return {
		start(c: ProcessContext) {
			f.start(c)
		},
		step(c: ProcessContext) {
			f.clearPushes()
			f.step(c)
		},
		force(c: ProcessContext, h: number) {
			f.force(c)
			f.floats(c, h)
		},
		end(c: ProcessContext) {
			f.finish(c)
		}
	}
}

const kinds: ProcessKind[] = KINDS.map((kind) => ({ kind, check, create }))
export default kinds
