/**
 * Heat for the engine: every body's temperature, the heat that flows between them, and changes of state (ice melting and water
 * freezing, salt lowering the melting point, water boiling and evaporating, dew condensing on cold things), with lamps, the sun,
 * hot plates, thermometers and enclosures (a freezer, an oven). One shared world per run, made from the document's "heat" process
 * records (tooling/src/sim/modules/heat.ts registers the kind) and every solid of the scene; stepped on the module plugins' slow
 * beat (plugins.ts `slow`), in lesson time (the run's time × the time-lapse), decoupled from the 480 Hz mechanics.
 *
 * The model (numbers in heat-data.ts with their sources):
 * - Bodies: every moving solid's weld group is one lumped body (Biot number ≪ 0.1 for the classroom's small things) with its material's
 *   heat capacity and conductivity; a plate, a rod or a spoon (a record's `cells`, or any long metal body) is a chain of cells along its
 *   long axis joined by conduction (G = k·A/Δx), so the cold spot under an ice cube and a spoon's warm handle are real. Fixed solids
 *   (the table, walls) are the room's: they stay at the air's temperature unless a record makes one a body (a hot plate's top).
 * - Conduction where solids touch (the engine's contacts; the touching length from the outlines, split over cells): G = A / (t_a/2k_a +
 *   t_b/2k_b + R_c), A = length × the shallower depth (a point contact: 2 mm, a round body: a disc of a fifth of its radius), t each side's
 *   thickness across the touch (≤ 2 cm), R_c the contact resistance (5e-4 m²·K/W dry, 5e-5 under a melting cube's film of water).
 * - Air and room: natural convection face by face (sides, tops, bottoms: Holman's simplified laminar equations), forced by a fan's
 *   stream (Churchill-Usagi mixing), and radiation with the room, εσA(T⁴ − T_room⁴); a lumped body's skin (a quarter of its smallest size
 *   over its conductivity) in series.
 * - Light: a lamp's beam (a cone, soft over its last 10°; its power falls as 1/r²) and the sun (parallel), absorbed by each body's
 *   absorptivity (its material's, or its colour's for non-metals) on the area it shows the light, unless something stands in the way.
 * - Water: a container's water mixes (one temperature), takes heat from the vessel through its wetted walls (natural convection in water;
 *   nucleate boiling on a floor hotter than 100 °C) and from what is in it, and gives it to the air from its surface by convection,
 *   radiation and evaporation (Chilton-Colburn, which agrees with Carrier's equation). It boils at 100 °C (raised by salt), freezes at
 *   0 °C (lowered by salt), boils away and spills when its vessel tips past 35°.
 * - Changes of state: an exact enthalpy balance. A melting body holds its solid and the melt water still touching it (a film on its
 *   faces and the puddle within 3 footprints, as deep as what it stands on holds: 2 mm on a plate, 5 mm in a bowl) at one temperature,
 *   the melting point of that water (salt water's freezing point by the CRC table): salt from a salt pile touching it dissolves into
 *   that water (first order, to its solubility), making brine that melts ice below 0 °C; melt water beyond what the cube holds drains to
 *   its puddle, carrying its share of the salt (so a pile's effect fades unless it keeps dissolving). The cube shrinks (ctx resize).
 * - Moist air: dew condenses on anything below the air's dew point (its latent heat warms it), dries above it; steam from open water
 *   condenses on something cold held over it.
 * Each exchange between two bodies is solved exactly for the pair over the sub-step (an exponential approach), so it is steady at any
 * step and conserves energy; pairs are taken in a fixed order (deterministic). `ledger` books every joule that enters or leaves.
 */
import type { Body, Contact, World } from "planck"
import type { SolidPart } from "#sim/part.ts"
import type { Point, ProcessContext, ProcessRecord, SolidHandle } from "#sim/plugins.ts"
import { opticsOf } from "#sim/modules/optics.ts"
import type { RegionState } from "#sim/fluids.ts"
import { changeLiquid, regionOf, SALT_VOLUME, surfaceOf } from "#sim/heat-fluids.ts"
import {
	AIR_CONDUCTIVITY,
	AIR_RHO_CP,
	BOILING_H,
	bimetalCurvature,
	boilingPoint,
	brineFreezing,
	CANDLE,
	colourAbsorptivity,
	CONTACT_RESISTANCE,
	DEW_FILM,
	DEW_RUNOFF,
	EUTECTIC,
	forcedAir,
	HEAT_MATERIALS,
	type HeatMaterial,
	heatLiquidOf,
	heatMaterialOf,
	ICE,
	KELVIN,
	LEWIS_23,
	mixedAir,
	naturalAir,
	naturalWater,
	plumeExcess,
	plumeHalfWidth,
	plumeRise,
	SALT,
	SALT_MATERIAL,
	SALT_SOLUBILITY,
	SALT_SOLUTION,
	SCORCH,
	SIGMA,
	STILL_AIR_MASS,
	SUBLIMATION,
	transmittanceOf,
	vaporDensity,
	vaporization,
	WATER
} from "#sim/heat-data.ts"

/** The longest sub-step of lesson time, s: the fastest thing it follows is a thermometer in water (a few seconds). */
export const SUB_STEP = 2
/** At most this many sub-steps a beat (a time-lapse over 3840: each pair's exchange is exact and stays stable with longer sub-steps). */
export const MAX_SUBS = 64
/** A melting body is rebuilt when its size has changed by 0.5 mm, or by 1 % (a small one); it is gone below 1 mm. */
const RESIZE_MM = 0.0005
const RESIZE_SHARE = 0.01
const RESIZE_BURN = 0.0005
const GONE_SIZE = 0.001
/** Melt water a melting body keeps: a film on its open faces, m (0.3 mm), and the puddle within 3 footprints of its foot (provisional). */
const FILM = 0.0003
const POOL_REACH = 3
/** How deep a puddle spreads on a flat surface, m (1.5 mm: surface-tension-limited spreading of water, typically 1-3 mm), provisional. */
export const SPREAD = 0.0015
/** What is left of a drying puddle when it counts as dry, kg (0.01 g). */
const DRY_LEFT = 1e-5
/** How thin a drying puddle gets before its edge draws in, m (0.2 mm), provisional (puddleArea). */
export const PIN_DEPTH = 0.0002
/** What a surface holds around a melting cube, m, unless its record says (a plate 2 mm, a bowl 5 mm). */
const RETAIN = 0.002
/** Contact resistance under a wet (melting) contact, m²·K/W (a film of water fills the gaps), provisional. */
const WET_CONTACT = 5e-5
/** Steam from open water reaches something held this far above it, m, condensing on it below this temperature (°C); provisional. */
const STEAM_REACH = 0.4
const STEAM_COLD = 90
/** A lamp's beam fades to nothing over its last 10° (0.1745 rad). */
const BEAM_EDGE = 0.1745
/** A thermometer's bulb touches a solid within this distance of its outline, m. */
const BULB_TOUCH = 0.003
/** Cells: about one a centimetre, 4 to 32; a long metal body (longer than 4 × its thickness) is a chain by itself. */
const CELL = 0.01
const CELLS_MAX = 32
/**
 * A plate or tray wider (front to back) than 3 × BAND_Z is two bands of cells: the inner one, |z| ≤ BAND_Z m from the machine plane, where
 * what stands on it touches, and the outer rest; joined across z by conduction (G = 8·k·t·Δx / W between the bands' middles, W its depth).
 * Without it a 1 cm cell of a 27 cm plate would be one strip whose far parts fed a cube on its middle as if they touched it (a ceramic plate
 * then gave a 4 cm cube about 8 W instead of the 2 W a fin analysis gives).
 */
const BAND_Z = 0.025
/** Salt touching ice above the eutectic dissolves into at least this much water (the ice's own surface film starts it), kg. */
const SALT_SEED = 1e-6
/** A heater's thermostat: off at its setpoint + 5 K, on again at − 5 K (±5 °C). */
const BAND = 5
/** Readings along a rod or a spoon: this many points from one end to the other. */
const PROFILE = 8
/**
 * Work into heat: friction's work at a sliding contact (|tangent impulse × slip speed|, the engine's own solved impulses) and the kinetic energy
 * an impact loses (½·m_eff·v_n²·(1 − e²), m_eff the pair's effective mass along the contact normal, e the restitution that applies at that speed),
 * half to each side (a fixed solid's half goes to the room). An approach slower than IMPACT_MIN (m/s) is the engine's contact jitter, not an
 * impact; the engine applies restitution only past its velocity threshold (physics.ts VELOCITY_THRESHOLD, 0.2 m/s).
 */
const IMPACT_MIN = 0.05
const RESTITUTION_FROM = 0.2
/** A spot of concentrated light (a lens's focus): its light summed over this length of the surface (m), on a spot of radius SPOT_R (m). */
const SPOT_BIN = 0.002
const SPOT_R = 0.002
/** The smallest spot: the sun's own image through a 10 cm lens is about 1 mm across (its disc is 0.53°). */
const SPOT_MIN_R = 0.0005
const SPOT_RAYS = 8
/** A spot is reported when it stands at least this much (K) hotter than its body; no spot is hotter than this (°C: it burns). */
const SPOT_SHOWN = 1
const SPOT_MAX = 1000
/** Work a body takes in is a reading from 1 mJ on (the engine's resting contacts creep by far less). */
const WORK_SHOWN = 0.001
/**
 * How far apart the engine keeps solids resting on each other, m: planck's contact skin, a polygon radius of 2 × its linear slop (0.005) each
 * at LENGTH_SCALE 10 (measured: a 4 cm ice cube rests 1.5 mm over its plate). Heat takes held things (before the release) that far apart.
 */
const SKIN = 0.0015

type Outline = { readonly circle?: { x: number; y: number; r: number }; readonly points?: readonly Point[] }

interface Melt {
	readonly at: number
	readonly latent: number
	/** Heat capacity of its solid and its liquid, J/(kg·K); its liquid's density, kg/m³. */
	readonly cs: number
	readonly cl: number
	readonly rho: number
	/** Water (ice): salt lowers its melting point; it evaporates, boils, condenses. */
	readonly water: boolean
	solid: number
	liquid: number
	/** Salt dissolved in its liquid, kg. */
	salt: number
	readonly solid0: number
	readonly liquid0: number
	/** Boiled or evaporated away, kg. */
	vapor: number
	/** Vapour made this sub-step (steam that can condense on something above), kg. */
	fresh: number
	/** Boiled (not evaporated) since the last report, kg: it is boiling while this grows. */
	boiled?: number
}

/** A chain of cells along a body's main slab. */
interface Chain {
	readonly main: string
	readonly n: number
	readonly length: number
	readonly alongX: boolean
	readonly thick: number
	readonly depth: number
	readonly profile: boolean
	/** The inner band's half-width, m (0: one band). */
	readonly band: number
}

interface Node {
	readonly id: string
	readonly item: string
	readonly part: string
	/** What the document calls it ("ice cube"), for the events. */
	readonly words: string
	/** What the run's events call it: its item's name (the record's `name`), else "the <words>". */
	who: string
	readonly kind: "body" | "water" | "sensor" | "puddle"
	/** The solids this node is (a weld group; every cell of a chain has its group's; a water's vessel's; a puddle none). */
	readonly solids: readonly string[]
	readonly mat: HeatMaterial
	/** J/K of what does not melt. */
	C: number
	T: number
	melt: Melt | undefined
	/** m² of surface when whole; the share of it facing up or down (half each); convection length; smallest size; foot's perimeter, m. */
	readonly area: number
	readonly flat: number
	readonly length: number
	readonly thick: number
	readonly foot: number
	readonly depth: number
	/** What it holds of a melting cube's water around its foot, m (a plate 2 mm, a bowl 5 mm). */
	readonly retain: number
	/** A puddle item: water lying on what it rests on, its area its water spread SPREAD deep. */
	readonly pool?: boolean
	/** It stands on a foot ring: under it, an air gap this deep (m) between it and what it rests on (a plate, a bowl). */
	readonly standoff?: number
	readonly alpha: number
	readonly eps: number
	/** Dew standing on it, kg. */
	wet: number
	readonly chain?: Chain
	readonly cell?: number
	/** A banded chain's outer cell (on the inner one), and whether this is one. */
	outerNode?: Node
	readonly outer?: boolean
	/** Per update: W from lamps, sun and heaters; areas touching and wetted, m²; what it rests on. */
	power: number
	contactArea: number
	wetted: number
	/** Per update, m²: a vessel's faces that look into it, dry (its inside above the water; a lid's underside and edges): not open to the room. */
	hidden?: number
	support: { node?: Node; T: number; k: number; half: number; retain: number } | undefined
	/** The water it stands in this update (a cube in a cup: its melt water joins it). */
	inWater: Node | undefined
	envT: number
	airSpeed: number
	/** A melting body's size against its own (cube root of its ice), and the size last built. */
	scale: number
	built: number
	/** A melting body's drained melt water. */
	puddle?: Node
	/** A puddle's: whose it is (it lies under the owner's foot). */
	owner?: Node
	/** A puddle's (or a pool's) wetted area so far, m²: its edge stays pinned while it dries (puddleArea). */
	pinned?: number
	water?: WaterSpec
	sensor?: SensorSpec
	readonly said: Set<string>
	/** J of friction's and impacts' work it has taken in (a reading once there is some). */
	work?: number
	/** kg of its wax burned away by its flame (a candle). */
	burnt?: number
	/** The temperature its hottest spot scorches at (°C: paper 233; heat-data SCORCH), if it does. */
	scorch?: number
	/** Its hottest spot under concentrated light (°C), when one stands out; whether that spot has passed its scorch point. */
	spot?: number
	scorched?: boolean
	/** A bimetal strip: its layers (heat-data bimetalCurvature) and length; the temperature it is straight at. */
	bend?: { readonly a1: number; readonly a2: number; readonly e1: number; readonly e2: number; readonly t1: number; readonly t2: number; readonly length: number; readonly ref: number }
	/** A body that grows with its temperature (a ball-and-ring's ball, its ring): α (1/K), the temperature its size is given at, that size (m). */
	expand?: { readonly alpha: number; readonly ref: number; readonly size: number }
	/** Liquid that follows another module's reading of its volume (mL: a flow pitcher's `left_ml`), or of what it has received (`add`: a fluids
	 *  container's received_ml, on top of what it held at the start, `base` kg); its density, kg/m³. */
	follow?: { readonly item: string; readonly key: string; readonly rho: number; readonly add: boolean; last: number }
	/** A liquid that is not water (oil, honey, alcohol): its words (its readings say liquid_temp, not water_temp). */
	fluid?: string
}

/** A lit candle's flame: its heat rises in a plume and radiates; its wax burns away; in a closed jar it uses up the oxygen and goes out. */
interface Flame {
	readonly item: string
	readonly solid: string
	/** The wick's top in the solid's own frame (as built: it moves down as the candle shrinks). */
	readonly at: Point
	/** What the run's events call it (its item's name, else the candle). */
	readonly who: string
	readonly power: number
	readonly burn: number
	readonly plume: number
	readonly radiant: number
	readonly from: number
	readonly until: number
	readonly node: Node | undefined
	lit: boolean
	/** Why it went out (it stays out), or undefined. */
	out: string | undefined
	burned: number
	jar: Jar | undefined
	/** The flame's middle now (world), and the wick's top. */
	p: Point
	wick: Point
}

/** A jar over things (mouth down on the table): the air it holds and the oxygen in that air, m³. */
interface Jar {
	readonly item: string
	readonly solid: string
	readonly x0: number
	readonly x1: number
	readonly y0: number
	readonly y1: number
	readonly volume: number
	o2: number
}

/** A ball and the ring it must pass: the ball goes through while its size is under the hole's (both grow with their temperatures). */
interface Ring {
	readonly item: string
	readonly ball: string
	readonly jaws: ReadonlySet<string>
	ballNode: Node | undefined
	ringNode: Node | undefined
	fits: boolean
	passed: boolean
	/** It has just come to fit: its ball, resting on the ring, is woken so it can fall through. */
	wake: boolean
}

/** A tap's water: what it has run so far (another module's reading, mL) arrives at its temperature. */
interface Tap {
	readonly item: string
	readonly key: string
	readonly T: number
	last: number
}

interface WaterSpec {
	readonly vessel: string
	/** Its inside is given in world coordinates (a fixed container of the fluids module), else in the vessel part's own frame. */
	readonly world: boolean
	readonly x0: number
	readonly x1: number
	readonly y0: number
	readonly y1: number
	readonly depth: number
	readonly round: boolean
	readonly lid: boolean
	/** m²·K/W through half the vessel's wall. */
	readonly wallR: number
	spilled: boolean
	/** It does not spill when its vessel tips (another module pours it: flow's pitcher). */
	readonly keep: boolean
	/** m³ of other liquids that stand in it besides its water (they raise its level). */
	extra: number
	/** World, this update: the surface's height, the inside's x range, the floor's and the rim's height. */
	level: number
	wx0: number
	wx1: number
	floor: number
	rim: number
	/** A fluids container's (frame world): the liquids module's state of it (null: none; undefined: not looked up yet), and the m³ heat has
	 *  added to (+) or taken from (−) its water since the last beat, for that container's liquid (heat-fluids.ts). */
	region?: RegionState | null
	owed: number
	/** The lid's solids (the record's `cover`): their undersides and edges look into the vessel. */
	readonly cover: readonly string[]
}

interface SensorSpec {
	readonly solid: string
	readonly at: Point
	readonly area: number
	readonly size: number
	/** K/W inside the bulb or probe (glass and liquid): with the outside's 1/(hA), its lag. */
	readonly resistance: number
	p: Point
	/** What its bulb is in this update: 1 water, 2 a solid it touches, 0 the air. */
	medium: number
}

interface Lamp {
	readonly item: string
	readonly solid: string
	readonly at: Point
	readonly direction: number
	readonly cosIn: number
	readonly cosOut: number
	readonly intensity: number
	readonly from: number
	readonly until: number
}

interface Heater {
	readonly item: string
	readonly node: Node
	readonly power: number
	readonly setpoint: number
	readonly from: number
	readonly until: number
	on: boolean
	drawn: number
	/** Whether it is switched on this beat (from ≤ t < until), and the J it gave this beat (its thermostat decides each sub-step). */
	live: boolean
	spent: number
}

interface Salt {
	readonly item: string
	readonly solid: string
	readonly node: Node | undefined
	readonly rate: number
	left: number
	readonly start: number
	built: number
	target: Node | undefined
}

interface Enclosure {
	readonly solid: string
	readonly x0: number
	readonly x1: number
	readonly y0: number
	readonly y1: number
	readonly air: number
}

interface Link {
	readonly a: Node
	readonly b: Node | undefined
	/** A fixed far side's temperature (b undefined). */
	readonly Tb: number
	readonly G: number
}

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d)
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
const partName = (id: string) => (id.includes("/") ? id.slice(id.indexOf("/") + 1) : id)
const words = (w: string) => w.replace(/^(a|an|the)\s+/i, "")
const cap = (w: string) => (w === "" ? w : w.charAt(0).toUpperCase() + w.slice(1))
const baseName = (name: string) => (name.indexOf(" [") > 0 ? name.slice(0, name.indexOf(" [")) : name)

/** A body's sizes for heat: volume, surface, the share facing up/down, its convection length, smallest size and foot, depth. */
export const sizesOf = (part: SolidPart) => {
	const b = part.body
	if (b.kind === "ball") {
		const r = b.radius
		if (part.shape === "cylinder") {
			const l = part.length ?? 2 * r
			return { volume: Math.PI * r * r * l, area: 2 * Math.PI * r * l + 2 * Math.PI * r * r, flat: 0.3, height: 2 * r, thick: Math.min(2 * r, l), foot: 2 * l, depth: l }
		}
		return { volume: (4 / 3) * Math.PI * r * r * r, area: 4 * Math.PI * r * r, flat: 0.3, height: 2 * r, thick: 2 * r, foot: Math.PI * r, depth: 2 * r }
	}
	if (b.kind === "slab") {
		const w = b.width * (1 + (b.taper ?? 1)) * 0.5
		const h = b.height
		const d = b.depth
		const area = 2 * (w * h + w * d + h * d)
		return { volume: w * h * d, area, flat: (2 * w * d) / area, height: h, thick: Math.min(w, h, d), foot: 2 * (w + d), depth: d }
	}
	let a = 0
	let per = 0
	let flatLen = 0
	let x0 = Infinity
	let x1 = -Infinity
	let y0 = Infinity
	let y1 = -Infinity
	const n = b.points.length
	for (let i = 0; i < n; i++) {
		const p = b.points[i] as Point
		const q = b.points[(i + 1) % n] as Point
		a += p.x * q.y - q.x * p.y
		const len = Math.hypot(q.x - p.x, q.y - p.y)
		per += len
		if (Math.abs(q.x - p.x) > 2 * Math.abs(q.y - p.y)) flatLen += len
		x0 = Math.min(x0, p.x)
		x1 = Math.max(x1, p.x)
		y0 = Math.min(y0, p.y)
		y1 = Math.max(y1, p.y)
	}
	a = Math.abs(a) / 2
	const d = b.depth
	const area = per * d + 2 * a
	return { volume: a * d, area, flat: (flatLen * d) / area, height: y1 - y0, thick: Math.min(x1 - x0, y1 - y0, d), foot: 2 * (x1 - x0 + d), depth: d }
}

const middleOf = (o: Outline): Point => {
	if (o.circle !== undefined) return { x: o.circle.x, y: o.circle.y }
	const pts = o.points ?? []
	let x = 0
	let y = 0
	for (const p of pts) {
		x += p.x
		y += p.y
	}
	return { x: x / Math.max(1, pts.length), y: y / Math.max(1, pts.length) }
}

const boxOf = (o: Outline) => {
	if (o.circle !== undefined) return { x0: o.circle.x - o.circle.r, x1: o.circle.x + o.circle.r, y0: o.circle.y - o.circle.r, y1: o.circle.y + o.circle.r }
	let x0 = Infinity
	let x1 = -Infinity
	let y0 = Infinity
	let y1 = -Infinity
	for (const p of o.points ?? []) {
		x0 = Math.min(x0, p.x)
		x1 = Math.max(x1, p.x)
		y0 = Math.min(y0, p.y)
		y1 = Math.max(y1, p.y)
	}
	return { x0, x1, y0, y1 }
}

/** The outline's width as seen along the direction (ux, uy). */
const extentAcross = (o: Outline, ux: number, uy: number) => {
	if (o.circle !== undefined) return 2 * o.circle.r
	let lo = Infinity
	let hi = -Infinity
	for (const p of o.points ?? []) {
		const s = -p.x * uy + p.y * ux
		if (s < lo) lo = s
		if (s > hi) hi = s
	}
	return hi > lo ? hi - lo : 0
}

/** How far the outline reaches from p along ±(ux, uy). */
const reachAlong = (o: Outline, p: Point, ux: number, uy: number) => {
	if (o.circle !== undefined) return Math.abs((o.circle.x - p.x) * ux + (o.circle.y - p.y) * uy) + o.circle.r
	let hi = 0
	for (const q of o.points ?? []) hi = Math.max(hi, Math.abs((q.x - p.x) * ux + (q.y - p.y) * uy))
	return hi
}

/** The gap between outline a and outline b along the unit normal (ux, uy) from a to b, m (negative: they overlap that deep). */
const gapAlong = (a: Outline, b: Outline, ux: number, uy: number) => {
	let aMax = -Infinity
	let bMin = Infinity
	if (a.circle !== undefined) aMax = a.circle.x * ux + a.circle.y * uy + a.circle.r
	else for (const q of a.points ?? []) aMax = Math.max(aMax, q.x * ux + q.y * uy)
	if (b.circle !== undefined) bMin = b.circle.x * ux + b.circle.y * uy - b.circle.r
	else for (const q of b.points ?? []) bMin = Math.min(bMin, q.x * ux + q.y * uy)
	return Number.isFinite(aMax) && Number.isFinite(bMin) ? bMin - aMax : 0
}

/** Whether the segment p→q crosses the outline (a circle, or a convex polygon by Cyrus-Beck clipping). */
export const segmentHits = (o: Outline, p: Point, q: Point): boolean => {
	const dx = q.x - p.x
	const dy = q.y - p.y
	if (o.circle !== undefined) {
		const { x, y, r } = o.circle
		const fx = p.x - x
		const fy = p.y - y
		const a = dx * dx + dy * dy
		if (a === 0) return fx * fx + fy * fy < r * r
		const t = clamp(-(fx * dx + fy * dy) / a, 0, 1)
		const cx = fx + t * dx
		const cy = fy + t * dy
		return cx * cx + cy * cy < r * r
	}
	const pts = o.points ?? []
	const n = pts.length
	if (n < 3) return false
	let t0 = 0
	let t1 = 1
	for (let i = 0; i < n; i++) {
		const a = pts[i] as Point
		const b = pts[(i + 1) % n] as Point
		const nx = b.y - a.y
		const ny = -(b.x - a.x)
		const num0 = nx * (a.x - p.x) + ny * (a.y - p.y)
		const den = nx * dx + ny * dy
		if (den === 0) {
			if (num0 < 0) return false
			continue
		}
		const t = num0 / den
		if (den < 0) {
			if (t > t0) t0 = t
		} else if (t < t1) t1 = t
		if (t0 > t1) return false
	}
	return t1 - t0 > 1e-9
}

/** Whether point p is inside the outline grown by `grow` m. */
export const pointIn = (o: Outline, p: Point, grow: number): boolean => {
	if (o.circle !== undefined) {
		const dx = p.x - o.circle.x
		const dy = p.y - o.circle.y
		const r = o.circle.r + grow
		return dx * dx + dy * dy <= r * r
	}
	const pts = o.points ?? []
	const n = pts.length
	if (n < 3) return false
	for (let i = 0; i < n; i++) {
		const a = pts[i] as Point
		const b = pts[(i + 1) % n] as Point
		const ex = b.x - a.x
		const ey = b.y - a.y
		const len = Math.hypot(ex, ey)
		if (len === 0) continue
		if ((ex * (p.y - a.y) - ey * (p.x - a.x)) / len < -grow) return false
	}
	return true
}

/**
 * Where two touching outlines meet: the normal from a to b, the touching length (0 at a corner or a round body) and the touch's middle.
 * By separating axes: the axis of least overlap (largest gap) is the normal; each one's faces within 2 mm of the touch line overlap for
 * the length.
 */
export const touchOf = (a: Outline, b: Outline): { nx: number; ny: number; length: number; x: number; y: number } | undefined => {
	if (a.circle !== undefined || b.circle !== undefined) {
		const ca = middleOf(a)
		const cb = middleOf(b)
		if (a.circle !== undefined && b.circle !== undefined) {
			const d = Math.hypot(cb.x - ca.x, cb.y - ca.y) || 1
			const nx = (cb.x - ca.x) / d
			const ny = (cb.y - ca.y) / d
			return { nx, ny, length: 0, x: ca.x + nx * a.circle.r, y: ca.y + ny * a.circle.r }
		}
		const circle = (a.circle ?? b.circle) as { x: number; y: number; r: number }
		const poly = (a.circle === undefined ? a.points : b.points) ?? []
		let best = Infinity
		let bx = circle.x
		let by = circle.y
		const n = poly.length
		for (let i = 0; i < n; i++) {
			const p = poly[i] as Point
			const q = poly[(i + 1) % n] as Point
			const ex = q.x - p.x
			const ey = q.y - p.y
			const ll = ex * ex + ey * ey
			const t = ll > 0 ? clamp(((circle.x - p.x) * ex + (circle.y - p.y) * ey) / ll, 0, 1) : 0
			const x = p.x + t * ex
			const y = p.y + t * ey
			const d2 = (x - circle.x) * (x - circle.x) + (y - circle.y) * (y - circle.y)
			if (d2 < best) {
				best = d2
				bx = x
				by = y
			}
		}
		const d = Math.sqrt(best) || 1
		const sign = a.circle === undefined ? -1 : 1
		return { nx: (sign * (bx - circle.x)) / d, ny: (sign * (by - circle.y)) / d, length: 0, x: bx, y: by }
	}
	const A = a.points ?? []
	const B = b.points ?? []
	if (A.length < 3 || B.length < 3) return undefined
	let bestSep = -Infinity
	let nx = 0
	let ny = 1
	for (const [P, Q, sign] of [
		[A, B, 1],
		[B, A, -1]
	] as const) {
		const n = P.length
		for (let i = 0; i < n; i++) {
			const p = P[i] as Point
			const q = P[(i + 1) % n] as Point
			const ex = q.x - p.x
			const ey = q.y - p.y
			const len = Math.hypot(ex, ey)
			if (len === 0) continue
			const ox = ey / len
			const oy = -ex / len
			let minQ = Infinity
			for (const v of Q) minQ = Math.min(minQ, (v.x - p.x) * ox + (v.y - p.y) * oy)
			if (minQ > bestSep) {
				bestSep = minQ
				nx = ox * sign
				ny = oy * sign
			}
		}
	}
	let aMax = -Infinity
	for (const v of A) aMax = Math.max(aMax, v.x * nx + v.y * ny)
	let bMin = Infinity
	for (const v of B) bMin = Math.min(bMin, v.x * nx + v.y * ny)
	const tol = 0.002
	const span = (P: readonly Point[], near: (s: number) => boolean) => {
		let lo = Infinity
		let hi = -Infinity
		const n = P.length
		for (let i = 0; i < n; i++) {
			const p = P[i] as Point
			const q = P[(i + 1) % n] as Point
			if (!near(p.x * nx + p.y * ny) || !near(q.x * nx + q.y * ny)) continue
			for (const v of [p, q]) {
				const s = -v.x * ny + v.y * nx
				if (s < lo) lo = s
				if (s > hi) hi = s
			}
		}
		return { lo, hi }
	}
	const sa = span(A, (s) => s >= aMax - tol)
	const sb = span(B, (s) => s <= bMin + tol)
	const lo = Math.max(sa.lo, sb.lo)
	const hi = Math.min(sa.hi, sb.hi)
	const length = hi > lo ? hi - lo : 0
	const across = (aMax + bMin) / 2
	if (length > 0) {
		const along = (lo + hi) / 2
		return { nx, ny, length, x: across * nx - along * ny, y: across * ny + along * nx }
	}
	let x = 0
	let y = 0
	let best = Infinity
	for (const v of A) {
		const g = Math.abs(v.x * nx + v.y * ny - bMin)
		if (g < best) {
			best = g
			x = v.x
			y = v.y
		}
	}
	return { nx, ny, length: 0, x, y }
}

/** How far apart two outlines are (m; negative: how deep they overlap), by separating axes (a circle by its nearest point). */
export const gapOf = (a: Outline, b: Outline): number => {
	if (a.circle !== undefined && b.circle !== undefined) return Math.hypot(b.circle.x - a.circle.x, b.circle.y - a.circle.y) - a.circle.r - b.circle.r
	if (a.circle !== undefined || b.circle !== undefined) {
		const circle = (a.circle ?? b.circle) as { x: number; y: number; r: number }
		const poly = (a.circle === undefined ? a.points : b.points) ?? []
		const o: Outline = { points: poly }
		if (pointIn(o, circle, 0)) return -circle.r
		let best = Infinity
		const n = poly.length
		for (let i = 0; i < n; i++) {
			const p = poly[i] as Point
			const q = poly[(i + 1) % n] as Point
			const ex = q.x - p.x
			const ey = q.y - p.y
			const ll = ex * ex + ey * ey
			const t = ll > 0 ? clamp(((circle.x - p.x) * ex + (circle.y - p.y) * ey) / ll, 0, 1) : 0
			best = Math.min(best, Math.hypot(p.x + t * ex - circle.x, p.y + t * ey - circle.y))
		}
		return best - circle.r
	}
	let sep = -Infinity
	for (const [P, Q] of [
		[a.points ?? [], b.points ?? []],
		[b.points ?? [], a.points ?? []]
	] as const) {
		const n = P.length
		for (let i = 0; i < n; i++) {
			const p = P[i] as Point
			const q = P[(i + 1) % n] as Point
			const len = Math.hypot(q.x - p.x, q.y - p.y)
			if (len === 0) continue
			const ox = (q.y - p.y) / len
			const oy = -(q.x - p.x) / len
			let minQ = Infinity
			for (const v of Q) minQ = Math.min(minQ, (v.x - p.x) * ox + (v.y - p.y) * oy)
			sep = Math.max(sep, minQ)
		}
	}
	return sep
}

/** The share of the outline's box below the level y and between x0 and x1 (a wetted share, by its box: quick and steady). */
const shareBelow = (o: Outline, level: number, x0: number, x1: number) => {
	const b = boxOf(o)
	if (!(b.y1 > b.y0) || !(b.x1 > b.x0)) return 0
	const across = clamp((Math.min(b.x1, x1) - Math.max(b.x0, x0)) / (b.x1 - b.x0), 0, 1)
	const down = clamp((level - b.y0) / (b.y1 - b.y0), 0, 1)
	return across * down
}

/** The run's heat: built from every "heat" record of the document and every solid of the scene. */
export class HeatWorld {
	readonly records: ProcessRecord[] = []
	readonly nodes: Node[] = []
	private readonly nodesOf = new Map<string, Node[]>()
	private readonly lamps: Lamp[] = []
	private readonly heaters: Heater[] = []
	readonly salts: Salt[] = []
	private readonly enclosures: Enclosure[] = []
	private sun: { irradiance: number; ux: number; uy: number; from: number } | undefined
	private room = 20
	private humidity = 0.5
	private links: Link[] = []
	/** Fixed solids that stand touching (the engine reports no contact between two fixed solids): a beaker on a hot plate. */
	private staticTouches: [string, string][] = []
	/**
	 * Solids that stand touching at the start (within 2 mm) where one is a body here and one can move: before the release the engine steps no
	 * contacts (nothing moves yet), so heat takes these from the start (an ice cube resting on its plate, a salt pile on its cube) and the
	 * engine's own contacts from the release on. So the lesson's clock and the heat start together at t = 0, whatever the release.
	 */
	private heldTouches: [string, string][] = []
	private outlines = new Map<string, Outline>()
	private built = false
	readonly flames: Flame[] = []
	readonly jars: Jar[] = []
	readonly rings: Ring[] = []
	private readonly taps: Tap[] = []
	/** Friction's and impacts' work since the last beat, J, by the node it goes into. */
	private readonly worked = new Map<Node, number>()
	/** The last beat's length, s of lesson time (0 at the start). */
	private beat = 0
	/** Each heat body's contact's slip speeds (m/s, per point) as it was met before the step was solved: friction's work is the impulse times the
	 *  step's mean slip, the slip before and after (a block a hand pushes slows within the step as friction acts). */
	private slipBefore = new Map<unknown, number[]>()
	/** Liquid poured out of one container and not yet in another (flow's particles in the air, a puddle): kg, and its enthalpy (J, as `pour` reckons it). */
	readonly transit = { m: 0, H: 0 }
	/** The salt in that liquid, kg. */
	private transitSalt = 0
	/** The optics module's last trace as heat used it (light per body node, the hottest spots), rebuilt when the trace changes. */
	private optic: { res: unknown; power: Map<Node, number>; spots: Map<Node, { P: number; r: number; x: number; y: number }>; known: Set<string> } | undefined
	/** Every joule that entered (+) or left (−) the bodies: lamps, sun and heaters; the room (air, radiation, fixed solids); vapour; salt; spills;
	 *  work (friction's and impacts'). */
	readonly ledger = { sources: 0, room: 0, vapor: 0, chem: 0, spilled: 0, work: 0 }
	/** The energy held at the run's start (J, as `energy` reckons it). */
	start0 = 0
	/** For checks: when set, every exchange's joules into each node, by what they came from (node id → source → J). */
	trace: Map<string, Map<string, number>> | undefined
	ctx: ProcessContext | undefined
	/** Whether a run has started it (a new run of the same scene object needs a new world). */
	get started() {
		return this.built
	}

	add(record: ProcessRecord) {
		this.records.push(record)
	}

	/** Builds the nodes from the scene's solids and the records (once, at the run's start). */
	build(ctx: ProcessContext) {
		if (this.built) return
		this.built = true
		this.ctx = ctx
		this.room = ctx.settings.roomTemperature
		const all = ctx.all()
		const handle = new Map(all.map((h) => [h.id, h] as const))
		const byRole = (role: string) => this.records.filter((r) => r.role === role)
		const solidOf = (r: ProcessRecord) => (typeof r.solid === "string" ? r.solid : r.id)
		for (const r of byRole("room")) this.humidity = clamp(num(r.humidity, this.humidity), 0, 1)
		const parts = new Map(all.map((h) => [h.id, h.part] as const))
		const rootOf = (id: string): string => {
			let at = id
			for (let i = 0; i < 64; i++) {
				const p = parts.get(at)
				if (p === undefined || p.parent === undefined || p.pivot !== undefined || !parts.has(p.parent)) break
				at = p.parent
			}
			return at
		}
		const joined = new Map<string, string>()
		for (const r of byRole("body")) {
			const extra = Array.isArray(r.with) ? (r.with as unknown[]).filter((x): x is string => typeof x === "string" && parts.has(x)) : []
			for (const x of extra) joined.set(rootOf(x), rootOf(solidOf(r)))
		}
		const groups = new Map<string, SolidHandle[]>()
		for (const h of all) {
			const root0 = rootOf(h.id)
			const root = joined.get(root0) ?? root0
			groups.set(root, [...(groups.get(root) ?? []), h])
		}
		const bodyRecords = new Map<string, ProcessRecord>()
		for (const r of byRole("body")) bodyRecords.set(rootOf(solidOf(r)), { ...(bodyRecords.get(rootOf(solidOf(r))) ?? {}), ...r })
		const heaterRoots = new Set(byRole("heater").map((r) => rootOf(solidOf(r))))
		const vessels = new Set(byRole("water").map((r) => rootOf(solidOf(r))))
		const saltSolids = new Set(byRole("salt").map((r) => rootOf(solidOf(r))))
		for (const [root, members] of groups) {
			const record = bodyRecords.get(root)
			if (record?.inert === true) continue
			const moving = members.some((h) => h.part.kind === "dynamic")
			if (!moving && record === undefined && !vessels.has(root) && !heaterRoots.has(root)) continue
			this.addBody(root, members, record, saltSolids.has(root), vessels.has(root))
		}
		for (const r of byRole("water")) this.addWater(r, handle.get(solidOf(r)))
		// a vessel starts at its water's temperature (the water stood in it a while: a cup of 80 °C cocoa reads 80 °C), unless its own record says
		for (const r of byRole("water")) {
			const water = this.nodes.find((n) => n.id === String(r.id))
			const recordStart = bodyRecords.get(rootOf(solidOf(r)))?.start
			if (water === undefined || typeof recordStart === "number") continue
			for (const n of this.nodesOf.get(solidOf(r)) ?? []) if (n.kind === "body") n.T = water.T
		}
		for (const r of byRole("sensor")) this.addSensor(r, handle.get(solidOf(r)))
		for (const r of byRole("lamp")) {
			const spread = clamp(num(r.spread, 0.87), 0.05, 1.5)
			const cosOut = Math.cos(spread)
			const at = r.at as Point | undefined
			const dir = r.dir as Point | undefined
			this.lamps.push({
				item: String(r.item ?? ""),
				solid: solidOf(r),
				at: { x: num(at?.x, 0), y: num(at?.y, 0) },
				direction: dir !== undefined && typeof dir === "object" && dir !== null ? Math.atan2(num(dir.y, -1), num(dir.x, 0)) : num(r.direction, -Math.PI / 2),
				cosIn: Math.cos(Math.max(0, spread - BEAM_EDGE)),
				cosOut,
				intensity: Math.max(0, num(r.power, 0)) / (2 * Math.PI * (1 - cosOut)),
				from: num(r.from, 0),
				until: num(r.until, Infinity)
			})
		}
		for (const r of byRole("heater")) {
			const node = this.nodesOf.get(solidOf(r))?.[0]
			if (node === undefined) continue
			this.heaters.push({ item: String(r.item ?? node.item), node, power: Math.max(0, num(r.power, 0)), setpoint: num(r.setpoint, 300), from: num(r.from, 0), until: num(r.until, Infinity), on: true, drawn: 0, live: false, spent: 0 })
		}
		for (const r of byRole("salt")) {
			const s = solidOf(r)
			const node = this.nodesOf.get(s)?.[0]
			const mass = Math.max(0, num(r.mass, node !== undefined ? node.C / SALT.heatCapacity : 0))
			this.salts.push({ item: String(r.item ?? handle.get(s)?.item ?? ""), solid: s, node, rate: Math.max(0, num(r.rate, 0.1)), left: mass, start: mass, built: 1, target: undefined })
		}
		for (const r of byRole("enclosure")) {
			this.enclosures.push({ solid: solidOf(r), x0: num(r.x0, 0), x1: num(r.x1, 0), y0: num(r.y0, 0), y1: num(r.y1, 0), air: num(r.air, this.room) })
		}
		const sun = byRole("sun")[0]
		if (sun !== undefined) {
			const d = num(sun.direction, -Math.PI / 2)
			this.sun = { irradiance: Math.max(0, num(sun.irradiance, 0)), ux: Math.cos(d), uy: Math.sin(d), from: num(sun.from, 0) }
		}
		// candles' flames, jars over them, balls and rings, taps
		for (const r of byRole("flame")) {
			const s = solidOf(r)
			const at = r.at as Point | undefined
			this.flames.push({
				item: String(r.item ?? handle.get(s)?.item ?? ""),
				solid: s,
				at: { x: num(at?.x, 0), y: num(at?.y, 0) },
				power: Math.max(0, num(r.power, CANDLE.power)),
				burn: Math.max(0, num(r.burn, CANDLE.burn)),
				plume: clamp(num(r.plume, CANDLE.plume), 0, 1),
				radiant: clamp(num(r.radiant, CANDLE.radiant), 0, 1),
				from: num(r.from, 0),
				until: num(r.until, Infinity),
				node: this.nodesOf.get(s)?.find((n) => n.kind === "body"),
				who: typeof r.name === "string" && r.name !== "" ? r.name : "the candle",
				lit: false,
				out: undefined,
				burned: 0,
				jar: undefined,
				p: { x: 0, y: 0 },
				wick: { x: 0, y: 0 }
			})
		}
		for (const r of byRole("jar")) {
			const volume = Math.max(1e-6, num(r.volume, 0.001))
			this.jars.push({ item: String(r.item ?? ""), solid: solidOf(r), x0: num(r.x0, 0), x1: num(r.x1, 0), y0: num(r.y0, 0), y1: num(r.y1, 0), volume, o2: volume * CANDLE.airO2 })
		}
		for (const r of byRole("ring")) {
			const jaws = new Set(Array.isArray(r.jaws) ? (r.jaws as unknown[]).filter((x): x is string => typeof x === "string") : [])
			const ball = String(r.ball ?? "")
			const first = [...jaws][0]
			this.rings.push({
				item: String(r.item ?? ""),
				ball,
				jaws,
				ballNode: this.nodesOf.get(ball)?.find((n) => n.kind === "body"),
				ringNode: first === undefined ? undefined : this.nodesOf.get(first)?.find((n) => n.kind === "body"),
				fits: true,
				passed: false,
				wake: false
			})
		}
		for (const r of byRole("tap")) this.taps.push({ item: String(r.item ?? ""), key: String(r.key ?? "flowed_ml"), T: num(r.start, this.room), last: 0 })
		// fixed solids touching fixed solids (within 2 mm), where one of them is a body here: their contacts, which the engine does not report
		const fixedNodes = all.filter((h) => !h.dynamic && this.nodesOf.has(h.id))
		const fixed = all.filter((h) => !h.dynamic)
		const pairSeen = new Set<string>()
		for (const a of fixedNodes) {
			const oa = a.outline()
			for (const b of fixed) {
				if (a.item === b.item || a.id === b.id) continue
				const key = a.id < b.id ? `${a.id}\u0000${b.id}` : `${b.id}\u0000${a.id}`
				if (pairSeen.has(key)) continue
				pairSeen.add(key)
				if (gapOf(oa, b.outline()) <= 0.002) this.staticTouches.push([a.id, b.id])
			}
		}
		// what stands touching at the start where one side can move (the engine's contacts begin with the release)
		const ghost = (h: SolidHandle) => (h.part as { ghost?: boolean }).ghost === true
		const bodySolids = all.filter((h) => !ghost(h) && (this.nodesOf.get(h.id) ?? []).some((n) => n.kind === "body"))
		const heldSeen = new Set<string>()
		for (const a of bodySolids) {
			const oa = a.outline()
			for (const b of all) {
				if (a.item === b.item || a.id === b.id || ghost(b) || (!a.dynamic && !b.dynamic)) continue
				const key = a.id < b.id ? `${a.id}\u0000${b.id}` : `${b.id}\u0000${a.id}`
				if (heldSeen.has(key)) continue
				heldSeen.add(key)
				if (gapOf(oa, b.outline()) <= 0.002) this.heldTouches.push([a.id, b.id])
			}
		}
		// every melting body has a puddle for the melt water it cannot hold
		for (const n of [...this.nodes]) {
			if (n.kind !== "body" || n.melt === undefined || n.melt.solid0 <= 0) continue
			const m = n.melt
			const p = this.blank(`${n.id}#puddle`, n.item, "puddle", "puddle", `puddle from the ${n.words}`, n.T, { who: `the puddle from ${n.who.startsWith("the ") ? n.who.slice(4) : n.who}` })
			p.melt = { at: m.at, latent: m.latent, cs: m.cs, cl: m.cl, rho: m.rho, water: m.water, solid: 0, liquid: 0, salt: 0, solid0: 0, liquid0: 0, vapor: 0, fresh: 0 }
			p.owner = n
			n.puddle = p
			this.nodes.push(p)
		}
		this.start0 = this.energy()
		this.report(ctx)
	}

	private blank(id: string, item: string, kind: Node["kind"], part: string, w: string, T: number, extra: Partial<Node> = {}): Node {
		return {
			id,
			item,
			part,
			words: w,
			who: `the ${w}`,
			kind,
			solids: [],
			mat: HEAT_MATERIALS.water as HeatMaterial,
			C: 0,
			T,
			melt: undefined,
			area: 0,
			flat: 1,
			length: 0.05,
			thick: 0.003,
			foot: 0,
			depth: 0,
			retain: RETAIN,
			alpha: 0.7,
			eps: WATER.emissivity,
			wet: 0,
			power: 0,
			contactArea: 0,
			wetted: 0,
			support: undefined,
			inWater: undefined,
			envT: this.room,
			airSpeed: 0,
			scale: 1,
			built: 1,
			said: new Set(),
			...extra
		}
	}

	private register(node: Node) {
		this.nodes.push(node)
		for (const s of node.solids) this.nodesOf.set(s, [...(this.nodesOf.get(s) ?? []), node])
	}

	private addBody(root: string, members: readonly SolidHandle[], record: ProcessRecord | undefined, isSalt: boolean, vessel = false) {
		const first = members[0] as SolidHandle
		const override = typeof record?.material === "string" ? HEAT_MATERIALS[record.material] : undefined
		let melt: HeatMaterial["melt"]
		let meltSolid = 0
		const each = members.map((h) => {
			const mat = isSalt ? SALT_MATERIAL : (override ?? heatMaterialOf(h.part.material.words, h.part.material.density))
			const s = sizesOf(h.part)
			return { h, mat, s, mass: h.part.material.density * s.volume }
		})
		const main = each.reduce((a, b) => (b.s.volume > a.s.volume ? b : a))
		const mainMat = each.reduce((a, b) => (b.mass > a.mass ? b : a)).mat
		let C = 0
		for (const e of each) {
			if (e.mat.melt !== undefined && (melt === undefined || e.mat.melt === melt)) {
				melt = e.mat.melt
				meltSolid += e.mass
			} else C += e.mass * e.mat.heatCapacity
		}
		// what it holds that is no solid of its own (a sand tray's sand: [material, kg] pairs)
		let extraC = 0
		if (Array.isArray(record?.extra))
			for (const x of record.extra as unknown[]) {
				if (!Array.isArray(x) || typeof x[0] !== "string" || typeof x[1] !== "number" || !(x[1] >= 0)) continue
				extraC += x[1] * heatMaterialOf(x[0], 1500).heatCapacity
			}
		C += extraC
		const meltAt = each.find((e) => e.mat.melt !== undefined)?.mat.melt?.at
		const T = num(record?.start, meltAt !== undefined && record?.pool !== true ? Math.min(this.room, meltAt) : this.room)
		const fill = main.h.part.placeholder.fill
		const alpha = clamp(num(record?.absorptivity, mainMat.colour === true ? (colourAbsorptivity(fill) ?? mainMat.absorptivity) : mainMat.absorptivity), 0, 1)
		const area = each.reduce((a, e) => a + e.s.area, 0)
		const flat = each.reduce((a, e) => a + e.s.flat * e.s.area, 0) / Math.max(1e-12, area)
		const base = {
			item: first.item,
			part: partName(root),
			words: words(first.part.words),
			who: typeof record?.name === "string" && record.name !== "" ? record.name : `the ${words(first.part.words)}`,
			kind: "body" as const,
			scorch: SCORCH[typeof record?.material === "string" ? record.material : baseName(main.h.part.material.words)],
			mat: mainMat,
			flat,
			length: clamp(Math.max(...each.map((e) => e.s.height)), 0.005, 0.5),
			thick: Math.max(0.0005, Math.min(...each.map((e) => e.s.thick))),
			depth: Math.max(...each.map((e) => e.s.depth)),
			retain: clamp(num(record?.retain, RETAIN), 0, 0.05),
			pool: record?.pool === true,
			standoff: clamp(num(record?.standoff, 0), 0, 0.02),
			alpha,
			eps: mainMat.emissivity,
			wet: Math.max(0, num(record?.wet, 0)),
			power: 0,
			contactArea: 0,
			wetted: 0,
			support: undefined,
			inWater: undefined,
			envT: this.room,
			airSpeed: 0,
			scale: 1,
			built: 1,
			melt: undefined
		}
		const foot = Math.max(...each.map((e) => e.s.foot))
		// a chain of cells: a record's `cells`, or a long metal body
		const mb = main.h.part.body
		let cells = 0
		if (melt === undefined && mb.kind === "slab") {
			const long = Math.max(mb.width, mb.height)
			const short = Math.min(mb.width, mb.height)
			const wanted = record?.cells
			if (typeof wanted === "number") cells = clamp(Math.round(wanted), 1, CELLS_MAX)
			// (never a vessel: its water meets all of it, its floor, walls and lid one body: a steel tumbler's lid made it a chain whose first
			// cell alone took the water's heat)
			else if (!vessel && long > 4 * short && mainMat.conductivity > 1 && first.part.kind === "dynamic") cells = clamp(Math.round(long / CELL), 4, CELLS_MAX)
		}
		if (cells > 1 && mb.kind === "slab") {
			const alongX = mb.width >= mb.height
			const depth = mb.depth
			const band = depth > 3 * BAND_Z ? BAND_Z : 0
			const chain: Chain = { main: main.h.id, n: cells, length: alongX ? mb.width : mb.height, alongX, thick: alongX ? mb.height : mb.width, depth, profile: record?.profile === true, band }
			const q0 = main.h.pose()
			const cellOf = (h: SolidHandle) => {
				// another part of the group belongs to the cell its outline's middle is over (a plate's rims: its end cells)
				const q = middleOf(h.outline())
				const c = Math.cos(q0.angle)
				const sn = Math.sin(q0.angle)
				const lx = (q.x - q0.x) * c + (q.y - q0.y) * sn
				const ly = -(q.x - q0.x) * sn + (q.y - q0.y) * c
				return clamp(Math.floor((((alongX ? lx : ly) + chain.length / 2) / chain.length) * cells), 0, cells - 1)
			}
			const inner = band > 0 ? (2 * band) / depth : 1
			const made: Node[] = []
			for (let k = 0; k < cells; k++) {
				let Ck = (main.mass * main.mat.heatCapacity + extraC) / cells
				let Ak = main.s.area / cells
				for (const e of each) {
					if (e === main || cellOf(e.h) !== k) continue
					Ck += e.mass * e.mat.heatCapacity
					Ak += e.s.area
				}
				const node: Node = { ...base, id: `${root}#${k}`, solids: members.map((h) => h.id), C: Ck * inner, T, area: Ak * inner, depth: band > 0 ? 2 * band : depth, foot: foot / cells, chain, cell: k, said: new Set() }
				this.register(node)
				made.push(node)
			}
			if (band > 0) {
				for (const node of made) {
					const outer: Node = { ...node, id: `${node.id}+`, C: (node.C / inner) * (1 - inner), area: (node.area / inner) * (1 - inner), depth: depth - 2 * band, outer: true, said: new Set() }
					this.register(outer)
					node.outerNode = outer
				}
			}
			return
		}
		let m: Melt | undefined
		if (melt !== undefined) {
			const liquid0 = Math.max(0, num(record?.liquid, 0))
			// a body that starts warmer than its melting point (a puddle of water item) starts melted
			const solid = T > melt.at ? 0 : meltSolid
			const liquid = solid === 0 ? meltSolid + liquid0 : liquid0
			const cs = (Object.values(HEAT_MATERIALS).find((x) => x.melt === melt) ?? mainMat).heatCapacity
			m = { at: melt.at, latent: melt.latent, cs, cl: melt.liquidHeatCapacity, rho: melt.liquidDensity, water: melt.water === true, solid, liquid, salt: 0, solid0: solid, liquid0: liquid, vapor: 0, fresh: 0 }
		}
		const node: Node = { ...base, id: root, solids: members.map((h) => h.id), C, T, melt: m, area, foot, said: new Set() }
		// a body that grows with its temperature (a ball-and-ring's ball and ring): its coefficient, its size at its reference temperature
		if (typeof record?.expand === "number" && record.expand > 0 && typeof record.size === "number" && record.size > 0)
			node.expand = { alpha: record.expand, ref: num(record.ref, 20), size: record.size }
		// a bimetal strip: its two layers' expansion, stiffness and thickness, its length, the temperature it is straight at
		const bend = record?.bend as Record<string, unknown> | undefined
		if (bend !== undefined && typeof bend === "object" && bend !== null) {
			const n = (k: string, d: number) => num(bend[k], d)
			node.bend = { a1: n("a1", 12e-6), a2: n("a2", 19e-6), e1: Math.max(1, n("e1", 200e9)), e2: Math.max(1, n("e2", 100e9)), t1: Math.max(1e-6, n("t1", 5e-4)), t2: Math.max(1e-6, n("t2", 5e-4)), length: Math.max(0, n("length", 0.1)), ref: n("ref", this.room) }
		}
		this.register(node)
	}

	private addWater(r: ProcessRecord, vessel: SolidHandle | undefined) {
		if (vessel === undefined) return
		const liquid = Math.max(0, num(r.liquid, 0))
		const ice = Math.max(0, num(r.ice, 0))
		const salt = Math.max(0, num(r.salt, 0))
		const x0 = num(r.x0, -0.03)
		const x1 = num(r.x1, 0.03)
		// (a given cross-section, m², as the fluids module's containers state theirs; else from the inside's width and depth, round or square)
		const area = num(r.area, 0)
		const depth = Math.max(0.001, area > 0 ? area / Math.max(1e-6, x1 - x0) : num(r.depth, x1 - x0))
		const round = r.round === true && !(area > 0)
		const cross = round ? (Math.PI * (x1 - x0) * depth) / 4 : (x1 - x0) * depth
		const wallMat = typeof r.wallMaterial === "string" ? (HEAT_MATERIALS[r.wallMaterial] ?? heatMaterialOf(r.wallMaterial, 1000)) : heatMaterialOf(vessel.part.material.words, vessel.part.material.density)
		const wall = Math.max(0.0001, num(r.wall, 0.003))
		const n = this.blank(String(r.id), String(r.item ?? vessel.item), "water", "water", `water in the ${words(vessel.part.words)}`, num(r.start, this.room), {
			...(typeof r.name === "string" && r.name !== "" ? { who: `the water in ${r.name}` } : {}),
			solids: [vessel.id],
			area: cross,
			length: Math.sqrt(cross),
			depth,
			alpha: 0.7,
			water: { vessel: vessel.id, world: r.frame === "world", x0, x1, y0: num(r.y0, 0), y1: num(r.y1, 0.08), depth, round, lid: r.lid === true, wallR: wall / 2 / wallMat.conductivity, spilled: false, level: 0, wx0: 0, wx1: 0, floor: 0, rim: 0, keep: r.keep === true, extra: 0, owed: 0,
				cover: Array.isArray(r.cover) ? (r.cover as unknown[]).filter((x): x is string => typeof x === "string") : [] }
		})
		n.melt = { at: 0, latent: ICE.fusion, cs: ICE.heatCapacity, cl: WATER.heatCapacity, rho: WATER.density, water: true, solid: ice, liquid, salt, solid0: ice, liquid0: liquid, vapor: 0, fresh: 0 }
		// other liquids in it (oil, honey, syrup, alcohol: [words, kg] pairs): with less of them than water, they only add their heat capacity (and
		// their volume to the level); with more, the container holds a liquid that is not water (it neither evaporates nor boils at 100 °C here)
		const others: { L: NonNullable<ReturnType<typeof heatLiquidOf>>; kg: number; words: string }[] = []
		if (Array.isArray(r.fluids))
			for (const x of r.fluids as unknown[]) {
				if (!Array.isArray(x) || typeof x[0] !== "string" || typeof x[1] !== "number" || !(x[1] > 0)) continue
				const L = heatLiquidOf(x[0])
				if (L !== undefined && !L.water) others.push({ L, kg: x[1], words: x[0] })
			}
		const otherKg = others.reduce((a, o) => a + o.kg, 0)
		const rho = Math.max(1, num(r.density, WATER.density))
		if (otherKg > 0 && otherKg > liquid + ice) {
			const main = others.reduce((a, o) => (o.kg > a.kg ? o : a))
			const total = liquid + otherKg
			const cl = (liquid * WATER.heatCapacity + others.reduce((a, o) => a + o.kg * o.L.heatCapacity, 0)) / total
			n.melt = { at: main.L.sets, latent: main.L.latent, cs: cl, cl, rho, water: false, solid: 0, liquid: total, salt: 0, solid0: 0, liquid0: total, vapor: 0, fresh: 0 }
			n.fluid = main.words
			n.who = `the ${main.words} in ${typeof r.name === "string" && r.name !== "" ? r.name : `the ${words(vessel.part.words)}`}`
		} else if (otherKg > 0) {
			n.C += others.reduce((a, o) => a + o.kg * o.L.heatCapacity, 0)
			;(n.water as WaterSpec).extra = otherKg / rho
		}
		// a liquid another module moves (flow's pitchers and basins): its mass follows that module's reading of its volume (mL)
		const f = r.follow as { item?: unknown; key?: unknown; add?: unknown } | undefined
		if (f !== undefined && typeof f === "object" && f !== null && typeof f.item === "string" && typeof f.key === "string")
			n.follow = { item: f.item, key: f.key, rho, add: f.add === true, last: 0 }
		this.register(n)
	}

	private addSensor(r: ProcessRecord, solid: SolidHandle | undefined) {
		if (solid === undefined) return
		const at = r.at as Point | undefined
		const area = Math.max(1e-6, num(r.area, 2e-4))
		const size = Math.max(0.001, num(r.size, 0.006))
		this.register(
			this.blank(String(r.id), String(r.item ?? solid.item), "sensor", "bulb", words(solid.part.words), num(r.start, this.room), {
				mat: HEAT_MATERIALS.glass as HeatMaterial,
				C: Math.max(1e-4, num(r.capacity, 0.16)),
				area,
				length: size,
				thick: size,
				depth: size,
				alpha: clamp(num(r.absorptivity, 0.5), 0, 1),
				eps: 0.9,
				sensor: { solid: solid.id, at: { x: num(at?.x, 0), y: num(at?.y, 0) }, area, size, resistance: Math.max(0, num(r.resistance, 40)), p: { x: 0, y: 0 }, medium: 0 }
			})
		)
	}

	// ------------------------------------------------------------------------------------------------------------ state

	/** J/K of a node's sensible heat now. */
	private capacity(n: Node) {
		const m = n.melt
		return m === undefined ? n.C : n.C + m.solid * m.cs + m.liquid * m.cl + m.salt * SALT.heatCapacity
	}

	/** The melting point of a melting node's liquid as it is (salt water's freezing point; the eutectic with salt and no liquid). */
	freezingOf(m: Melt, liquid: number) {
		if (!m.water || m.salt <= 0) return m.at
		return liquid <= 0 ? EUTECTIC : brineFreezing(m.salt / (m.salt + liquid))
	}

	/** 1/(J/K) for an exchange: none (an endless store) while it changes state at a fixed temperature (melting, freezing or boiling). */
	private inverse(n: Node) {
		const m = n.melt
		if (m !== undefined) {
			if (m.solid > 0 && m.liquid > 0) return 0
			if (m.water && m.liquid > 0 && n.T >= boilingPoint(m.salt, m.liquid) - 1e-9) return 0
		}
		return 1 / this.capacity(n)
	}

	/** A node's enthalpy, J: C·T + m_s·c_s·T + m_l·(c_l·T + L′), L′ = L + (c_s − c_l)·T_m (melting at T_m takes exactly L); salt c·T. */
	enthalpy(n: Node) {
		const m = n.melt
		if (m === undefined) return n.C * n.T
		const L1 = m.latent + (m.cs - m.cl) * m.at
		return (n.C + m.salt * SALT.heatCapacity) * n.T + m.solid * m.cs * n.T + m.liquid * (m.cl * n.T + L1)
	}

	/**
	 * Puts q joules into a node (negative: takes them out): its temperature, and for a melting body its ice (or wax ...) melting or
	 * freezing at the melting point of its liquid, by the exact enthalpy balance; water past its boiling point boils away.
	 */
	heat(n: Node, q: number) {
		const m = n.melt
		if (m === undefined) {
			if (n.C > 0) n.T += q / n.C
			return
		}
		const Co = n.C + m.salt * SALT.heatCapacity
		const L1 = m.latent + (m.cs - m.cl) * m.at
		const total = m.solid + m.liquid
		const H = this.enthalpy(n) + q
		const Hmix = (liquid: number) => (Co + (total - liquid) * m.cs + liquid * m.cl) * this.freezingOf(m, liquid) + liquid * L1
		if (total <= 0) {
			if (Co > 0) n.T = H / Co
		} else if (H <= Hmix(0)) {
			m.solid = total
			m.liquid = 0
			n.T = H / (Co + total * m.cs)
		} else if (H >= Hmix(total)) {
			m.solid = 0
			m.liquid = total
			n.T = (H - total * L1) / (Co + total * m.cl)
		} else if (!m.water || m.salt <= 0) {
			const liquid = (H - (Co + total * m.cs) * m.at) / ((m.cl - m.cs) * m.at + L1)
			m.liquid = clamp(liquid, 0, total)
			m.solid = total - m.liquid
			n.T = m.at
		} else {
			// salt water: its melting point rises as the brine thins (Hmix rises with the liquid): bisection
			let lo = 0
			let hi = total
			for (let i = 0; i < 52; i++) {
				const mid = (lo + hi) / 2
				if (Hmix(mid) < H) lo = mid
				else hi = mid
			}
			m.liquid = (lo + hi) / 2
			m.solid = total - m.liquid
			n.T = this.freezingOf(m, m.liquid)
		}
		if (m.water && m.liquid > 0) {
			const tb = boilingPoint(m.salt, m.liquid)
			if (n.T > tb) {
				// boiling: the excess over the boiling point turns water to steam, which leaves with its enthalpy
				const before = this.enthalpy(n)
				const excess = this.capacity(n) * (n.T - tb)
				const lv = vaporization(tb)
				const boiled = Math.min(m.liquid, excess / lv)
				m.liquid -= boiled
				m.vapor += boiled
				if (n.water?.world === true) n.water.owed -= boiled / WATER.density
				m.fresh += boiled
				m.boiled = (m.boiled ?? 0) + boiled
				const C = this.capacity(n)
				n.T = C > 0 ? tb + (excess - boiled * lv) / C : tb
				this.ledger.vapor -= before - this.enthalpy(n)
			}
		}
	}

	/** Adds liquid (and salt) at temperature t to a melting node: mixed in, by enthalpy. */
	private pour(n: Node, liquid: number, salt: number, t: number) {
		const m = n.melt
		if (m === undefined || liquid + salt <= 0) return
		const L1 = m.latent + (m.cs - m.cl) * m.at
		if (m.solid + m.liquid <= 0 && m.salt <= 0 && n.C <= 0) n.T = t
		const H = this.enthalpy(n) + liquid * (m.cl * t + L1) + salt * SALT.heatCapacity * t
		m.liquid += liquid
		m.salt += salt
		this.heat(n, H - this.enthalpy(n))
	}

	/** Whether a node holds nothing that can take heat (an empty puddle, water boiled away). */
	private empty(n: Node) {
		return this.capacity(n) <= 1e-12
	}

	/** Exchanges heat between node a and b (or a fixed temperature Tb) through G W/K for dt s: exact for the pair. J from a to b. */
	/** (the trace's name for a fixed far side this moment: "air", "fixed") */
	private tagNow: string | undefined
	private exchange(a: Node, b: Node | undefined, Tb: number, G: number, dt: number) {
		if (!(G > 0) || this.empty(a) || (b !== undefined && this.empty(b))) return 0
		const ia = this.inverse(a)
		const ib = b === undefined ? 0 : this.inverse(b)
		const T2 = b === undefined ? Tb : b.T
		const s = ia + ib
		const q = s > 0 ? ((a.T - T2) * (1 - Math.exp(-G * dt * s))) / s : G * (a.T - T2) * dt
		this.heat(a, -q)
		if (b !== undefined) this.heat(b, q)
		else this.ledger.room -= q
		if (this.trace !== undefined) {
			const into = (n: Node, from: string, j: number) => {
				const m = this.trace?.get(n.id) ?? new Map<string, number>()
				this.trace?.set(n.id, m)
				m.set(from, (m.get(from) ?? 0) + j)
			}
			into(a, b?.id ?? (this.tagNow ?? "room"), -q)
			if (b !== undefined) into(b, a.id, q)
		}
		return q
	}

	// ------------------------------------------------------------------------------------------------------------ each update

	private outline(id: string): Outline | undefined {
		let o = this.outlines.get(id)
		if (o === undefined) {
			const h = this.ctx?.solid(id)
			if (h === undefined) return undefined
			o = h.outline()
			this.outlines.set(id, o)
		}
		return o
	}

	/** The cell's own outline (its share of the main slab along its axis), or the body's main outline. */
	private outlineOfNode(n: Node): Outline | undefined {
		const ch = n.chain
		if (ch === undefined || n.cell === undefined) return this.outline(n.solids[0] as string)
		const h = this.ctx?.solid(ch.main)
		if (h === undefined) return undefined
		const q = h.pose()
		const s0 = -ch.length / 2 + (ch.length * n.cell) / ch.n
		const s1 = s0 + ch.length / ch.n
		const w = ch.thick
		const c = Math.cos(q.angle)
		const sn = Math.sin(q.angle)
		const local = ch.alongX
			? [
					{ x: s0, y: -w / 2 },
					{ x: s1, y: -w / 2 },
					{ x: s1, y: w / 2 },
					{ x: s0, y: w / 2 }
				]
			: [
					{ x: w / 2, y: s0 },
					{ x: w / 2, y: s1 },
					{ x: -w / 2, y: s1 },
					{ x: -w / 2, y: s0 }
				]
		return { points: local.map((v) => ({ x: q.x + v.x * c - v.y * sn, y: q.y + v.x * sn + v.y * c })) }
	}

	/** Which node of solid id a world point belongs to (a chain's cell by where along it), or undefined (a fixed solid). */
	private nodeAt(id: string, p: Point): Node | undefined {
		const list = this.nodesOf.get(id)
		if (list === undefined) return undefined
		const bodies = list.filter((n) => n.kind === "body" && n.outer !== true)
		const first = bodies[0]
		if (first?.chain === undefined) return first
		const ch = first.chain
		const h = this.ctx?.solid(ch.main)
		if (h === undefined) return first
		const q = h.pose()
		const c = Math.cos(q.angle)
		const sn = Math.sin(q.angle)
		const lx = (p.x - q.x) * c + (p.y - q.y) * sn
		const ly = -(p.x - q.x) * sn + (p.y - q.y) * c
		const k = clamp(Math.floor((((ch.alongX ? lx : ly) + ch.length / 2) / ch.length) * ch.n), 0, ch.n - 1)
		return bodies[k] ?? first
	}

	/** The air at a point: an enclosure's (a freezer's, an oven's) or the room's. */
	private airAt(p: Point) {
		let air = this.room
		for (const e of this.enclosures) {
			const h = this.ctx?.solid(e.solid)
			if (h === undefined) continue
			const q = h.pose()
			const c = Math.cos(q.angle)
			const sn = Math.sin(q.angle)
			const lx = (p.x - q.x) * c + (p.y - q.y) * sn
			const ly = -(p.x - q.x) * sn + (p.y - q.y) * c
			if (lx >= e.x0 && lx <= e.x1 && ly >= e.y0 && ly <= e.y1) {
				air = e.air
				break
			}
		}
		// inside a pot or cup over its water: steam over boiling water; over hot or cold water, still air halfway between it and the room's
		// (provisional: the air in a vessel mixes slowly with the room's)
		for (const n of this.nodes) {
			const w = n.water
			const m = n.melt
			if (w === undefined || m === undefined || w.spilled || m.liquid + m.solid <= 0) continue
			if (p.x < w.wx0 || p.x > w.wx1 || p.y < w.level || p.y > w.rim) continue
			return m.water && m.liquid > 0 && n.T >= boilingPoint(m.salt, m.liquid) - 0.5 ? n.T : (n.T + air) / 2
		}
		return air
	}

	/** Water vapour in the air at temperature t, kg/m³: the room's humidity, never more than t's saturation (a freezer's air is dry). */
	private airVapor(t: number) {
		return Math.min(this.humidity * vaporDensity(this.room), vaporDensity(t))
	}

	/** Where a node is, for light and air: its outline and middle (none for a body melted away, spilled water or an empty puddle). */
	private targetOf(n: Node): { o: Outline; c: Point } | undefined {
		if (n.kind === "sensor") {
			const s = n.sensor as SensorSpec
			return { o: { circle: { x: s.p.x, y: s.p.y, r: s.size / 2 } }, c: s.p }
		}
		if (n.kind === "puddle") {
			const at = this.puddleAt(n)
			if (at === undefined || this.empty(n)) return undefined
			const r = Math.sqrt(this.puddleArea(n) / Math.PI)
			return {
				o: { points: [{ x: at.x - r, y: at.y }, { x: at.x + r, y: at.y }, { x: at.x + r, y: at.y + SPREAD }, { x: at.x - r, y: at.y + SPREAD }] },
				c: { x: at.x, y: at.y + SPREAD / 2 }
			}
		}
		if (n.kind === "water") {
			const w = n.water as WaterSpec
			if (w.spilled) return undefined
			const o: Outline = { points: [{ x: w.wx0, y: w.floor }, { x: w.wx1, y: w.floor }, { x: w.wx1, y: w.level }, { x: w.wx0, y: w.level }] }
			return { o, c: { x: (w.wx0 + w.wx1) / 2, y: (w.floor + w.level) / 2 } }
		}
		if (n.melt !== undefined && n.melt.solid0 > 0 && n.melt.solid <= 0) return undefined
		const o = this.outlineOfNode(n)
		return o === undefined ? undefined : { o, c: middleOf(o) }
	}

	/** Where a melting body's puddle lies: under its foot, on what it rests on. */
	private puddleAt(p: Node): Point | undefined {
		const owner = p.owner
		if (owner === undefined) return undefined
		const o = this.outline(owner.solids[0] as string)
		if (o === undefined) return undefined
		const b = boxOf(o)
		return { x: (b.x0 + b.x1) / 2, y: b.y0 }
	}

	/**
	 * The cells of a plate (a chain) a puddle covers, with the area of each it covers (m²): the puddle as a square of its area centred under
	 * its owner's foot, against each cell's x range and band (inner |z| ≤ band, outer beyond). [] when what it lies on is not a chain.
	 */
	private under(p: Node, support: Node | undefined, A: number): [Node, number][] {
		const ch = support?.chain
		const at = this.puddleAt(p)
		if (ch === undefined || at === undefined || A <= 0) return []
		const half = Math.sqrt(A) / 2
		const out: [Node, number][] = []
		for (const n of this.nodes) {
			if (n.chain !== ch) continue
			const o = this.outlineOfNode(n)
			if (o === undefined) continue
			const b = boxOf(o)
			const ox = Math.min(b.x1, at.x + half) - Math.max(b.x0, at.x - half)
			if (ox <= 0) continue
			const zin = ch.band > 0 ? ch.band : ch.depth / 2
			const oz = n.outer === true ? Math.max(0, Math.min(half, ch.depth / 2) - zin) : Math.min(half, zin)
			if (oz > 0) out.push([n, ox * 2 * oz])
		}
		return out
	}

	/** A puddle's area, m²: its water spread SPREAD deep. */
	/**
	 * A puddle's area, m²: as wide as its water spreads 1.5 mm deep while it grows; drying, its edge stays pinned (the area it reached) and it
	 * thins, until it is 0.2 mm deep, when its edge draws in (a drying puddle or drop evaporates first at a constant wetted area, then shrinks:
	 * Picknett & Bexon 1977, J. Colloid Interface Sci. 61, 336; the depths provisional).
	 */
	private puddleArea(p: Node) {
		const m = p.melt
		if (m === undefined) return 0
		const v = (m.liquid + m.solid) / m.rho
		const a = v / SPREAD
		if (!(a <= (p.pinned ?? 0))) p.pinned = a
		return Math.min(p.pinned as number, v / PIN_DEPTH)
	}

	/** What a melting body holds of its melt water, kg: a film on its open faces and the puddle around its foot, as deep as its support holds. */
	private holds(n: Node) {
		const m = n.melt as Melt
		const s = n.scale
		const faces = n.area * s * s
		const foot = (n.flat * n.area * s * s) / 2
		const retain = n.support?.retain ?? RETAIN
		return m.rho * (FILM * Math.max(0, faces - foot) + retain * POOL_REACH * foot)
	}

	/** The solids touching this one now: the engine's contacts from the release on; before it, what stood touching at the start (heldTouches). */
	private touchingNow(ctx: ProcessContext, id: string): string[] {
		if (ctx.released()) return ctx.touching(id)
		const out: string[] = []
		for (const [a, b] of this.heldTouches) {
			if (a === id && !out.includes(b)) out.push(b)
			else if (b === id && !out.includes(a)) out.push(a)
		}
		return out
	}

	/**
	 * m² of a vessel's lid (its record's `cover` solids) not open to the room: each one's underside and edges, all of it but its top face (a
	 * round vessel's lid is a disc: π/4 of the square slab that stands for it).
	 */
	private coverArea(w: WaterSpec) {
		let A = 0
		for (const id of w.cover) {
			const part = this.ctx?.solid(id)?.part
			if (part === undefined) continue
			const s = sizesOf(part)
			const b = part.body
			A += Math.max(0, s.area - (b.kind === "slab" ? b.width * b.depth * (w.round ? Math.PI / 4 : 1) : 0))
		}
		return A
	}

	/** Gathers what this moment's world says: contacts, water levels and what is in them, light, air. */
	private gather(ctx: ProcessContext) {
		this.outlines = new Map()
		const t = ctx.time()
		const links: Link[] = []
		for (const n of this.nodes) {
			n.power = 0
			n.contactArea = 0
			n.wetted = 0
			n.hidden = 0
			n.inWater = undefined
		}
		// water: its vessel's pose, its level, spills
		for (const n of this.nodes) {
			const w = n.water
			const m = n.melt
			if (w === undefined || m === undefined) continue
			const h = ctx.solid(w.vessel)
			if (h === undefined) continue
			const q = w.world ? { x: 0, y: 0, angle: 0 } : h.pose()
			const c = Math.cos(q.angle)
			if (!w.spilled && !w.keep && c < 0.82 && m.liquid + m.solid > 0) {
				w.spilled = true
				this.ledger.spilled -= this.enthalpy(n)
				m.liquid = 0
				m.solid = 0
				m.salt = 0
				this.say(ctx, n, "spilled", `${n.who} spilled`)
			}
			const cross = w.round ? (Math.PI * (w.x1 - w.x0) * w.depth) / 4 : (w.x1 - w.x0) * w.depth
			const volume = m.liquid / m.rho + m.solid / ICE.density + w.extra
			const local = w.y0 + Math.min(w.y1 - w.y0, volume / cross)
			w.floor = q.y + w.y0 * c
			w.rim = q.y + w.y1 * c
			w.level = q.y + local * c
			w.wx0 = q.x + w.x0 * c
			w.wx1 = q.x + w.x1 * c
			// (a fluids container's water: its surface is the liquids module's, raised by what floats or stands in it; heat-fluids.ts)
			if (w.world) {
				if (w.region === undefined) w.region = regionOf(ctx.scene, n.item) ?? null
				if (w.region !== null) w.level = clamp(surfaceOf(w.region), w.floor, w.rim)
			}
		}
		// contacts between solids (each pair once)
		const seen = new Set<string>()
		const solids = new Set<string>()
		for (const n of this.nodes) if (n.kind === "body") for (const s of n.solids) solids.add(s)
		if (ctx.released()) {
			for (const s of solids) {
				for (const other of ctx.touching(s)) {
					const key = s < other ? `${s}\u0000${other}` : `${other}\u0000${s}`
					if (seen.has(key)) continue
					seen.add(key)
					this.contact(ctx, s, other, links)
				}
			}
		} else for (const [a, b] of this.heldTouches) this.contact(ctx, a, b, links, true)
		for (const [a, b] of this.staticTouches) this.contact(ctx, a, b, links)
		// water: the vessel's wetted walls, and what is in it
		for (const wn of this.nodes) {
			const w = wn.water
			const wm = wn.melt
			if (w === undefined || wm === undefined || w.spilled || wm.liquid + wm.solid <= 0) continue
			const cross = w.round ? (Math.PI * (w.x1 - w.x0) * w.depth) / 4 : (w.x1 - w.x0) * w.depth
			const round = w.round ? Math.PI * (w.x1 - w.x0) : 2 * (w.x1 - w.x0 + w.depth)
			const wall = round * Math.max(0, w.level - w.floor) + cross
			// (a vessel that is a chain of cells, a bowl's base: the water meets each cell by its share of the surface)
			const cells = (this.nodesOf.get(w.vessel) ?? []).filter((x) => x.kind === "body" && x.outer !== true)
			const vessel = cells[0]
			let cellArea = 0
			let vT = vessel?.T ?? this.room
			if (cells.length > 1) {
				let sum = 0
				for (const cell of cells) {
					cellArea += cell.area
					sum += cell.area * cell.T
				}
				if (cellArea > 0) vT = sum / cellArea
			}
			const hot = vessel !== undefined && wm.water && wm.liquid > 0 && vT > boilingPoint(wm.salt, wm.liquid) + 1
			const hIn = hot ? BOILING_H : naturalWater(vT - wn.T, Math.max(0.01, w.level - w.floor))
			const G = wall / (1 / hIn + w.wallR)
			// (its inside above the water and its lid's underside look into it, not the room: an open vessel's dry inside half, the inside air
			// standing between the water's and the room's temperature; under a lid all of it, the lid's own path takes the surface's heat)
			const dry = Math.max(0, round * Math.max(0, w.rim - w.floor) + cross - wall)
			const hid = (w.lid ? dry : dry / 2) + this.coverArea(w)
			if (vessel !== undefined && cells.length === 1) {
				links.push({ a: wn, b: vessel, Tb: 0, G })
				vessel.wetted += wall
				vessel.hidden = (vessel.hidden ?? 0) + hid
			} else if (vessel !== undefined) {
				for (const cell of cells) {
					const f = cellArea > 0 ? cell.area / cellArea : 1 / cells.length
					links.push({ a: wn, b: cell, Tb: 0, G: G * f })
					cell.wetted += wall * f
					cell.hidden = (cell.hidden ?? 0) + hid * f
				}
			} else links.push({ a: wn, b: undefined, Tb: this.room, G })
			const vesselSolids = new Set(vessel?.solids ?? [w.vessel])
			for (const n of this.nodes) {
				if (n.kind !== "body" || n.solids.some((s) => vesselSolids.has(s))) continue
				const o = this.outlineOfNode(n)
				if (o === undefined || (n.melt !== undefined && n.melt.solid0 > 0 && n.melt.solid <= 0)) continue
				const share = shareBelow(o, w.level, w.wx0, w.wx1)
				if (share <= 0) continue
				const s = n.melt !== undefined && n.melt.solid0 > 0 ? n.scale : 1
				const A = share * n.area * s * s
				n.wetted += A
				if (share > 0.5) n.inWater = wn
				const plateau = n.melt !== undefined && n.melt.solid > 0
				const skin = plateau ? 0 : n.thick / 4 / n.mat.conductivity
				const h = naturalWater(n.T - wn.T, Math.max(0.005, n.thick * s))
				links.push({ a: n, b: wn, Tb: 0, G: A / (1 / h + skin) })
			}
		}
		// sensors: in water, touching a solid, or in the air
		for (const n of this.nodes) {
			const s = n.sensor
			if (s === undefined) continue
			const h = ctx.solid(s.solid)
			if (h === undefined) continue
			const q = h.pose()
			const c = Math.cos(q.angle)
			const sn = Math.sin(q.angle)
			s.p = { x: q.x + s.at.x * c - s.at.y * sn, y: q.y + s.at.x * sn + s.at.y * c }
			let G = 0
			let to: Node | undefined
			const Tfix = this.airAt(s.p)
			for (const wn of this.nodes) {
				const w = wn.water
				if (w === undefined || w.spilled || this.empty(wn)) continue
				if (s.p.x >= w.wx0 && s.p.x <= w.wx1 && s.p.y >= w.floor - 0.002 && s.p.y <= w.level) {
					to = wn
					G = s.area * naturalWater(n.T - wn.T, s.size)
				}
			}
			s.medium = to !== undefined ? 1 : 0
			if (to === undefined) {
				for (const other of ctx.all()) {
					if (other.item === n.item) continue
					const o = this.outline(other.id)
					if (o === undefined || !pointIn(o, s.p, BULB_TOUCH)) continue
					const node = this.nodeAt(other.id, s.p)
					const k = node?.mat.conductivity ?? heatMaterialOf(other.part.material.words, other.part.material.density).conductivity
					G = (s.area * 0.5) / (CONTACT_RESISTANCE + (node?.thick ?? 0.02) / 4 / k)
					to = node
					s.medium = 2
					break
				}
			}
			if (G > 0) {
				n.wetted = 1
				links.push({ a: n, b: to, Tb: Tfix, G: 1 / (1 / G + s.resistance) })
			}
		}
		// chains: conduction along them
		for (let i = 1; i < this.nodes.length; i++) {
			const a = this.nodes[i - 1] as Node
			const b = this.nodes[i] as Node
			const ch = a.chain
			if (ch === undefined || b.chain !== ch || a.outer !== b.outer) continue
			links.push({ a, b, Tb: 0, G: (a.mat.conductivity * ch.thick * a.depth) / (ch.length / ch.n) })
		}
		for (const a of this.nodes) {
			const o = a.outerNode
			const ch = a.chain
			if (o === undefined || ch === undefined) continue
			links.push({ a, b: o, Tb: 0, G: (8 * a.mat.conductivity * ch.thick * (ch.length / ch.n)) / ch.depth })
		}
		// salt piles: what each touches that has water (ice, a puddle, a container's water)
		for (const salt of this.salts) {
			salt.target = undefined
			if (salt.left <= 0) continue
			for (const other of this.touchingNow(ctx, salt.solid)) {
				const node = this.nodesOf.get(other)?.find((x) => x.kind === "body" && x.melt?.water === true && x.melt.solid + x.melt.liquid > 0)
				if (node !== undefined) {
					salt.target = node
					break
				}
				const under = this.nodes.find((p) => p.kind === "puddle" && !this.empty(p) && p.owner?.support?.node?.solids.includes(other))
				if (under !== undefined) salt.target = under
			}
			if (salt.target === undefined) {
				const o = this.outline(salt.solid)
				const c = o === undefined ? undefined : middleOf(o)
				const water = c === undefined ? undefined : this.nodes.find((x) => x.water !== undefined && !x.water.spilled && !this.empty(x) && c.x >= x.water.wx0 && c.x <= x.water.wx1 && c.y <= x.water.level && c.y >= x.water.floor - 0.01)
				if (water !== undefined) salt.target = water
			}
		}
		// light: the optics module's traced light for every body it traces (lamps, the sun, flashlights, flames, through lenses, off mirrors,
		// through clear glass); heat's own estimate (lamps, the sun, flames: the inverse square and a look along three rays) for the rest
		// (water, puddles, thermometers' bulbs) and for every node in a scene without optics
		const traced = this.traced(ctx)
		if (traced !== undefined) for (const [n, w] of traced.power) n.power += w
		const own = (n: Node) => traced === undefined || n.kind !== "body" || !n.solids.some((s) => traced.known.has(s))
		for (const lamp of this.lamps) {
			if (t < lamp.from || t >= lamp.until) continue
			const h = ctx.solid(lamp.solid)
			if (h === undefined) continue
			const q = h.pose()
			const c = Math.cos(q.angle)
			const sn = Math.sin(q.angle)
			const p = { x: q.x + lamp.at.x * c - lamp.at.y * sn, y: q.y + lamp.at.x * sn + lamp.at.y * c }
			const dir = lamp.direction + q.angle
			const ux = Math.cos(dir)
			const uy = Math.sin(dir)
			for (const n of this.nodes) {
				if (!own(n)) continue
				const target = this.targetOf(n)
				if (target === undefined) continue
				const dx = target.c.x - p.x
				const dy = target.c.y - p.y
				const r = Math.hypot(dx, dy)
				if (r < 1e-4) continue
				const cos = (dx * ux + dy * uy) / r
				if (cos <= lamp.cosOut) continue
				const f = cos >= lamp.cosIn ? 1 : (cos - lamp.cosOut) / (lamp.cosIn - lamp.cosOut)
				const E = (lamp.intensity * f * f * (3 - 2 * f)) / (r * r)
				const shown = this.shownArea(n, target.o, -dx / r, -dy / r)
				n.power += n.alpha * E * shown * this.clearShare(n, lamp.item, p, target.c, target.o, dx / r, dy / r)
			}
		}
		const sun = this.sun
		if (sun !== undefined && sun.irradiance > 0 && t >= sun.from) {
			for (const n of this.nodes) {
				if (!own(n)) continue
				const target = this.targetOf(n)
				if (target === undefined) continue
				const shown = this.shownArea(n, target.o, -sun.ux, -sun.uy)
				const from = { x: target.c.x - sun.ux * 5, y: target.c.y - sun.uy * 5 }
				n.power += n.alpha * sun.irradiance * shown * this.clearShare(n, "", from, target.c, target.o, sun.ux, sun.uy)
			}
		}
		// flames: their radiation every way from the flame's middle (1/r²), and their plume over them
		for (const fl of this.flames) {
			if (!fl.lit) continue
			const I = (fl.power * fl.radiant) / (4 * Math.PI)
			for (const n of this.nodes) {
				if (!own(n) || n === fl.node) continue
				const target = this.targetOf(n)
				if (target === undefined) continue
				const dx = target.c.x - fl.p.x
				const dy = target.c.y - fl.p.y
				const r = Math.max(0.01, Math.hypot(dx, dy))
				const shown = this.shownArea(n, target.o, -dx / r, -dy / r)
				n.power += (n.alpha * I * shown * this.clearShare(n, fl.item, fl.p, target.c, target.o, dx / r, dy / r)) / (r * r)
			}
			this.plumeLinks(ctx, fl, links)
		}
		// heaters: switched on from `from` to `until`; their thermostat acts each sub-step (sub)
		for (const heater of this.heaters) heater.live = t >= heater.from && t < heater.until
		// the air around each body (a thermometer's bulb held over a flame is in its plume's hot gas, rising past it)
		for (const n of this.nodes) {
			const w = n.water
			const c = w !== undefined ? { x: (w.wx0 + w.wx1) / 2, y: w.level } : (this.targetOf(n)?.c ?? this.puddleAt(n) ?? { x: 0, y: 0 })
			n.envT = this.airAt(c)
			const a = ctx.air(c)
			n.airSpeed = Math.hypot(a.x, a.y)
			if (n.kind === "sensor" && this.flames.length > 0) {
				const g = this.plumeAt(ctx, c)
				if (g !== undefined) {
					n.envT = Math.max(n.envT, g.T)
					n.airSpeed = Math.max(n.airSpeed, g.u)
				}
			}
		}
		this.links = links
	}

	/** The area a node shows light coming from (ux, uy) (toward the light), m². */
	private shownArea(n: Node, o: Outline, ux: number, uy: number) {
		if (n.kind === "sensor") return (n.sensor as SensorSpec).area / 3
		if (n.kind === "water") {
			const w = n.water as WaterSpec
			return Math.max(0, uy) * (w.round ? (Math.PI * (w.x1 - w.x0) * w.depth) / 4 : (w.x1 - w.x0) * w.depth)
		}
		if (n.kind === "puddle" || n.pool === true) return Math.max(0, uy) * this.puddleArea(n)
		const m = n.melt
		const s = m !== undefined && m.solid0 > 0 ? n.built : 1
		const r = o.circle?.r ?? 0
		const ball = o.circle !== undefined && this.ctx?.solid(n.solids[0] as string)?.part.shape !== "cylinder"
		return ball ? Math.PI * r * r : extentAcross(o, ux, uy) * n.depth * s
	}

	/** The share of three rays from a light to a target (its middle and either side) that nothing else stops (clear glass passes its share). */
	private clearShare(n: Node, lampItem: string, from: Point, to: Point, o: Outline, ux: number, uy: number) {
		const half = 0.3 * extentAcross(o, ux, uy)
		const ends = [to, { x: to.x - uy * half, y: to.y + ux * half }, { x: to.x + uy * half, y: to.y - ux * half }]
		const ctx = this.ctx as ProcessContext
		const own = new Set(n.owner?.solids ?? n.solids)
		let clear = 0
		for (const end of ends) {
			const r = Math.hypot(end.x - from.x, end.y - from.y)
			const back = Math.min(r, reachAlong(o, end, ux, uy) + 0.002)
			const stop = { x: end.x - ux * back, y: end.y - uy * back }
			// (a clear solid in the way, glass or clear plastic, passes its share of the light: heat-data TRANSMITTANCE)
			let pass = 1
			for (const other of ctx.all()) {
				if (other.item === lampItem || own.has(other.id) || (n.kind === "sensor" && other.item === n.item)) continue
				const h = this.outline(other.id)
				if (h !== undefined && segmentHits(h, from, stop)) {
					pass *= transmittanceOf(other.part.material.words)
					if (pass <= 0) break
				}
			}
			clear += pass
		}
		return clear / 3
	}

	/** Conduction where two solids touch, split over the cells of a chain on either side. */
	private contact(ctx: ProcessContext, s: string, other: string, links: Link[], held = false) {
		const oa = this.outline(s)
		const ob = this.outline(other)
		if (oa === undefined || ob === undefined) return
		const touch = touchOf(oa, ob)
		if (touch === undefined) return
		const ha = ctx.solid(s)
		const hb = ctx.solid(other)
		if (ha === undefined || hb === undefined) return
		const depth = Math.min(sizesOf(ha.part).depth, sizesOf(hb.part).depth)
		const r = Math.min(oa.circle?.r ?? Infinity, ob.circle?.r ?? Infinity)
		const p = { x: touch.x, y: touch.y }
		// pieces of the touching length, half a cell each, to the cells under them
		const pieces: { p: Point; A: number }[] = []
		if (touch.length > 0) {
			const k = Math.max(1, Math.ceil(touch.length / (CELL / 2)))
			for (let i = 0; i < k; i++) {
				const u = ((i + 0.5) / k - 0.5) * touch.length
				pieces.push({ p: { x: p.x - touch.ny * u, y: p.y + touch.nx * u }, A: (touch.length / k) * depth })
			}
		} else pieces.push({ p, A: Number.isFinite(r) ? 0.04 * Math.PI * r * r : 0.002 * depth })
		// (each side's half thickness across the touch, from the touch's middle: what stands touching before the release (held) is taken as the
		// engine's resting contacts are, SKIN apart, whatever the gap a cube shrinking as it melts opens under it before it can settle)
		const gap = held ? Math.max(0, gapAlong(oa, ob, touch.nx, touch.ny)) - SKIN : 0
		const half = (o: Outline) => clamp((reachAlong(o, p, touch.nx, touch.ny) - gap / 2) / 2, 0.0005, 0.01)
		const Tfixed = this.airAt(p)
		const kOf = (h: SolidHandle) => heatMaterialOf(h.part.material.words, h.part.material.density).conductivity
		const pairs = new Map<string, { a: Node | undefined; b: Node | undefined; A: number }>()
		const add = (a: Node | undefined, b: Node | undefined, A: number) => {
			if (a === b || (a === undefined && b === undefined) || !(A > 0)) return
			const key = `${a?.id ?? ""}\u0000${b?.id ?? ""}`
			const got = pairs.get(key)
			if (got === undefined) pairs.set(key, { a, b, A })
			else got.A += A
		}
		for (const piece of pieces) {
			const a = this.nodeAt(s, piece.p)
			const b = this.nodeAt(other, piece.p)
			// a banded chain's inner cell takes the touch as deep as its band, its outer cell the rest
			const inA = a?.outerNode !== undefined && a.chain !== undefined ? Math.min(1, (2 * a.chain.band) / Math.max(1e-9, depth)) : 1
			const inB = b?.outerNode !== undefined && b.chain !== undefined ? Math.min(1, (2 * b.chain.band) / Math.max(1e-9, depth)) : 1
			const inner = Math.min(inA, inB)
			add(a, b, piece.A * inner)
			if (inner < 1) add(inA < 1 ? a?.outerNode : a, inB < 1 ? b?.outerNode : b, piece.A * (1 - inner))
		}
		const wetOf = (n: Node | undefined) => n?.melt !== undefined && n.melt.solid > 0 && (n.melt.liquid > 0 || n.T >= this.freezingOf(n.melt, n.melt.liquid) - 1e-9)
		for (const { a, b, A } of pairs.values()) {
			// (one side may be fixed: the node goes first)
			const flip = a === undefined
			const na = (flip ? b : a) as Node
			const nb = flip ? undefined : b
			const oA = flip ? ob : oa
			const oB = flip ? oa : ob
			const kA = na.mat.conductivity
			const kB = nb?.mat.conductivity ?? kOf(flip ? ha : hb)
			const wet = wetOf(na) || wetOf(nb)
			const Ra = wetOf(na) ? 0 : half(oA) / kA
			const Rb = wetOf(nb) ? 0 : half(oB) / kB
			// a dish on its foot ring: what it rests on meets it across the air gap under it
			const ny0 = flip ? -touch.ny : touch.ny
			const gapA = (na.standoff ?? 0) > 0 && ny0 < -0.5 ? (na.standoff as number) / AIR_CONDUCTIVITY : 0
			const gapB = nb !== undefined && (nb.standoff ?? 0) > 0 && ny0 > 0.5 ? (nb.standoff as number) / AIR_CONDUCTIVITY : 0
			const G = A / (Ra + Rb + gapA + gapB + (wet ? WET_CONTACT : CONTACT_RESISTANCE))
			na.contactArea += A
			if (nb !== undefined) nb.contactArea += A
			links.push({ a: na, b: nb, Tb: Tfixed, G })
			// what a melting body rests on (a touch whose normal points up into it): its melt water lies there
			const ny = flip ? -touch.ny : touch.ny
			if (na.melt !== undefined && ny < -0.5) na.support = { ...(nb === undefined ? {} : { node: nb }), T: Tfixed, k: kB, half: half(oB), retain: nb?.retain ?? RETAIN }
			if (nb?.melt !== undefined && ny > 0.5) nb.support = { node: na, T: Tfixed, k: kA, half: half(oA), retain: na.retain }
		}
	}

	/** One sub-step of dt s of lesson time. */
	private sub(dt: number) {
		for (const n of this.nodes) {
			if (n.melt !== undefined) n.melt.fresh = 0
			if (n.power > 0 && !this.empty(n)) {
				this.heat(n, n.power * dt)
				this.ledger.sources += n.power * dt
			}
		}
		// heaters: the thermostat switches off at the setpoint + 5 K and on again at − 5 K, every sub-step; within one it gives no more heat than
		// lifts the top to the setpoint + 5 K (so its overshoot keeps to the band at any time-lapse)
		for (const heater of this.heaters) {
			const node = heater.node
			if (!heater.live || this.empty(node)) continue
			if (node.T >= heater.setpoint + BAND) heater.on = false
			else if (node.T <= heater.setpoint - BAND) heater.on = true
			if (!heater.on) continue
			let q = heater.power * dt
			const room = this.capacity(node) * (heater.setpoint + BAND - node.T)
			if (q >= room) {
				q = Math.max(0, room)
				heater.on = false
			}
			if (!(q > 0)) continue
			this.heat(node, q)
			this.ledger.sources += q
			heater.spent += q
		}
		for (const l of this.links) this.exchange(l.a, l.b, l.Tb, l.G, dt)
		// salt dissolving into the water it touches (first order toward its solubility), taking its heat of solution
		for (const salt of this.salts) {
			const target = salt.target
			const m = target?.melt
			if (target === undefined || m === undefined || salt.left <= 0) continue
			const water = target.kind === "body" && m.liquid <= 0 && m.solid > 0 && target.T > EUTECTIC ? SALT_SEED : m.liquid
			const room = Math.max(0, SALT_SOLUBILITY * water - m.salt)
			const dm = Math.min(salt.left, room * (1 - Math.exp(-salt.rate * dt)))
			if (dm <= 0) continue
			const from = salt.node
			const before = this.enthalpy(target) + (from === undefined ? 0 : this.enthalpy(from))
			salt.left -= dm
			if (from !== undefined) from.C = Math.max(0, from.C - dm * SALT.heatCapacity)
			this.pour(target, 0, dm, from?.T ?? target.T)
			if (target.water?.world === true) target.water.owed += dm * SALT_VOLUME
			this.heat(target, -dm * SALT_SOLUTION)
			this.ledger.chem += this.enthalpy(target) + (from === undefined ? 0 : this.enthalpy(from)) - before
		}
		for (const n of this.nodes) this.air(n, dt)
		// steam from open water condenses on something cold held over it
		for (const wn of this.nodes) {
			const w = wn.water
			const m = wn.melt
			if (w === undefined || m === undefined || w.lid || m.fresh <= 0) continue
			let best: { n: Node; gap: number; overlap: number } | undefined
			for (const n of this.nodes) {
				if (n.kind !== "body" || n.solids.includes(w.vessel) || this.empty(n)) continue
				const o = this.targetOf(n)
				if (o === undefined) continue
				const b = boxOf(o.o)
				const gap = b.y0 - w.level
				const overlap = Math.min(b.x1, w.wx1) - Math.max(b.x0, w.wx0)
				if (gap < 0 || gap > STEAM_REACH || overlap <= 0) continue
				if (best === undefined || gap < best.gap) best = { n, gap, overlap }
			}
			if (best === undefined || best.n.T >= STEAM_COLD) continue
			const caught = m.fresh * clamp(best.overlap / (w.wx1 - w.wx0), 0, 1) * (1 - best.gap / STEAM_REACH)
			best.n.wet += caught
			const L = vaporization(best.n.T)
			this.heat(best.n, caught * L)
			this.ledger.vapor += caught * L
		}
		// dew running off: into water below it, else away
		for (const n of this.nodes) {
			if (n.kind !== "body" || n.wet <= 0) continue
			const s = n.melt !== undefined && n.melt.solid0 > 0 ? n.scale : 1
			const most = DEW_RUNOFF * Math.max(1e-6, n.area * s * s)
			if (n.wet <= most) continue
			const extra = n.wet - most
			n.wet = most
			const c = this.targetOf(n)?.c
			const below = c === undefined ? undefined : this.nodes.find((x) => x.water !== undefined && !x.water.spilled && c.x >= x.water.wx0 && c.x <= x.water.wx1 && c.y > x.water.level)
			if (below !== undefined) {
				const before = this.enthalpy(below)
				this.pour(below, extra, 0, n.T)
				if (below.water?.world === true) below.water.owed += extra / WATER.density
				this.ledger.vapor += this.enthalpy(below) - before
			}
		}
	}

	/** A node's exchange with the air and the room: convection, radiation, evaporation and dew. */
	private air(n: Node, dt: number) {
		if (this.empty(n)) return
		const m = n.melt
		const Te = n.envT
		const dT = n.T - Te
		const Tk = n.T + KELVIN
		const Ek = Te + KELVIN
		const rad = SIGMA * (Tk * Tk + Ek * Ek) * (Tk + Ek)
		// (no air, settings.air false: a vacuum, no convection, evaporation or dew; radiation and contact go on)
		const airy = this.ctx?.settings.air !== false
		if (n.kind === "water" || n.kind === "puddle" || (n.pool === true && m !== undefined)) {
			if (m === undefined) return
			const w = n.water
			if (w !== undefined && w.spilled) return
			const A = w !== undefined ? (w.round ? (Math.PI * (w.x1 - w.x0) * w.depth) / 4 : (w.x1 - w.x0) * w.depth) : this.puddleArea(n)
			const L = Math.max(0.005, Math.sqrt(A))
			const hs = airy ? mixedAir(naturalAir(dT, L, dT > 0 ? "rising" : "sinking"), forcedAir(n.airSpeed, L)) : 0
			if (w !== undefined && w.lid) {
				// under a lid the surface gives its heat to the vessel (steam condenses on the lid and runs back): no water lost; through the lid as
				// through the vessel's own wall (a pot's thin steel lid passes it at once, a foam cup's lid or a flask's stopper hardly)
				const vessel = this.nodesOf.get(w.vessel)?.find((x) => x.kind === "body")
				this.exchange(n, vessel, Te, A / (1 / (hs + 20) + 2 * w.wallR), dt)
				if (m.fresh > 0 && vessel !== undefined) {
					const back = m.fresh
					const before = this.enthalpy(n) + this.enthalpy(vessel)
					m.vapor -= back
					m.fresh = 0
					this.heat(vessel, back * vaporization(n.T))
					this.pour(n, back, 0, n.T)
					this.ledger.vapor += this.enthalpy(n) + this.enthalpy(vessel) - before
				}
				return
			}
			this.tagNow = "air+room"
			this.exchange(n, undefined, Te, (hs + WATER.emissivity * rad) * A, dt)
			this.tagNow = undefined
			if (n.kind === "puddle" && n.owner !== undefined) {
				// a puddle lies on what its body rested on: conduction through half its depth, to the cells of a plate it covers
				const sup = n.owner?.support
				if (sup !== undefined) {
					const R = SPREAD / 2 / WATER.conductivity + sup.half / sup.k
					const under = this.under(n, sup.node, A)
					if (under.length === 0) this.exchange(n, sup.node, sup.T, A / R, dt)
					for (const [cell, a] of under) this.exchange(n, cell, sup.T, a / R, dt)
				}
			}
			if (m.water && airy) this.vapor(n, m, A, hs, dt)
			return
		}
		if (n.kind === "sensor" && n.wetted > 0) return
		if (m !== undefined && m.solid0 > 0 && m.solid <= 0) return
		const s = m !== undefined && m.solid0 > 0 ? n.scale : 1
		const whole = n.kind === "sensor" ? n.area : n.area * s * s
		const A = n.kind === "sensor" ? n.area : Math.max(0, whole - n.contactArea - n.wetted - (n.hidden ?? 0))
		if (A <= 0) return
		const L = Math.max(0.003, n.length * s)
		const hf = forcedAir(n.airSpeed, Math.max(0.01, L))
		const top = Math.min(A, (n.flat * whole) / 2)
		const bottom = Math.max(0, Math.min(A - top, (n.flat * whole) / 2 - n.contactArea))
		const sides = Math.max(0, A - top - bottom)
		const hSide = mixedAir(naturalAir(dT, L, "side"), hf)
		const hA = airy ? hSide * sides + mixedAir(naturalAir(dT, L, dT > 0 ? "rising" : "sinking"), hf) * top + mixedAir(naturalAir(dT, L, dT > 0 ? "sinking" : "rising"), hf) * bottom : 0
		const plateau = m !== undefined && m.solid > 0 && (m.liquid > 0 || n.T >= this.freezingOf(m, 0) - 1e-9)
		const skin = n.kind === "sensor" ? (n.sensor as SensorSpec).resistance : plateau ? 0 : n.thick / 4 / n.mat.conductivity / A
		const Gout = hA + n.eps * rad * A
		this.tagNow = "air+room"
		this.exchange(n, undefined, Te, Gout > 0 ? 1 / (1 / Gout + skin) : 0, dt)
		this.tagNow = undefined
		if (n.kind === "sensor" || !airy) return
		if (m !== undefined && m.water && m.liquid > 0) this.vapor(n, m, A, hSide, dt)
		else this.dew(n, A, hSide, dt)
	}

	/** Evaporation from (or condensation onto) a water surface of A m², h W/(m²·K) of convection there. */
	private vapor(n: Node, m: Melt, A: number, h: number, dt: number) {
		if (A <= 0) return
		const hm = Math.max(h, STILL_AIR_MASS) / (AIR_RHO_CP * LEWIS_23)
		let dm = hm * A * (vaporDensity(n.T) - this.airVapor(n.envT)) * dt
		if (dm > 0) dm = Math.min(dm, m.liquid)
		if (dm === 0) return
		const before = this.enthalpy(n)
		m.liquid -= dm
		m.vapor += dm
		if (dm > 0) m.fresh += dm
		if (n.water?.world === true) n.water.owed -= dm / WATER.density
		this.heat(n, -dm * vaporization(n.T))
		// a puddle's last 0.01 g goes at once (its edge has drawn in to nothing: it is dry), its latent heat from the air
		if ((n.kind === "puddle" || n.pool === true) && dm > 0 && m.solid <= 0 && m.liquid > 0 && m.liquid < DRY_LEFT) {
			m.vapor += m.liquid
			m.liquid = 0
		}
		this.ledger.vapor += this.enthalpy(n) - before
		if (this.trace !== undefined) {
			const m2 = this.trace.get(n.id) ?? new Map<string, number>()
			this.trace.set(n.id, m2)
			m2.set("vapour", (m2.get("vapour") ?? 0) - dm * vaporization(n.T))
		}
	}

	/** Dew on a body below the air's dew point (and drying above it), on its A m² of open surface. */
	private dew(n: Node, A: number, h: number, dt: number) {
		const hm = Math.max(h, STILL_AIR_MASS) / (AIR_RHO_CP * LEWIS_23)
		let dm = hm * A * (this.airVapor(n.envT) - vaporDensity(n.T)) * dt
		if (dm < 0) {
			if (n.wet <= 0) return
			dm = Math.max(dm * Math.min(1, n.wet / (A * DEW_FILM)), -n.wet)
		}
		if (dm === 0) return
		n.wet += dm
		const L = n.T < 0 ? SUBLIMATION : vaporization(n.T)
		this.heat(n, dm * L)
		this.ledger.vapor += dm * L
		if (this.trace !== undefined) {
			const m2 = this.trace.get(n.id) ?? new Map<string, number>()
			this.trace.set(n.id, m2)
			m2.set("dew", (m2.get("dew") ?? 0) + dm * L)
		}
	}

	// ------------------------------------------------------------------------------------------------------------ work into heat

	/** Books J of work done where solids a and b meet (world point `at`): half to each one's node; a fixed solid's half goes to the room. */
	private book(a: string | undefined, b: string | undefined, at: Point, J: number) {
		for (const id of [a, b]) {
			if (id === undefined) continue
			const n = this.nodeAt(id, at)
			if (n === undefined || n.kind !== "body") continue
			this.worked.set(n, (this.worked.get(n) ?? 0) + J / 2)
		}
	}

	/**
	 * After each (sub-)step: friction's work at every sliding contact a heat body takes part in, from the impulses the engine has just solved:
	 * |tangent impulse| × |slip speed| at each contact point (a rolling ball, a resting block: no slip, no heat), half to each side.
	 */
	rub(ctx: ProcessContext) {
		if (!this.built) return
		const eng = ctx.engine()
		if (eng === undefined) return
		const L = eng.lengthScale
		for (let c = (eng.world as World).getContactList(); c !== null; c = c.getNext()) {
			if (!c.isTouching() || !c.isEnabled()) continue
			const fa = c.getFixtureA()
			const fb = c.getFixtureB()
			if (fa.isSensor() || fb.isSensor()) continue
			const ba = fa.getBody()
			const bb = fb.getBody()
			if (!ba.isDynamic() && !bb.isDynamic()) continue
			const sa = eng.solidOf(fa.getUserData())?.id
			const sb = eng.solidOf(fb.getUserData())?.id
			if (!(sa !== undefined && this.nodesOf.has(sa)) && !(sb !== undefined && this.nodesOf.has(sb))) continue
			const man = c.getManifold()
			if (man.pointCount === 0) continue
			const wm = c.getWorldManifold(null)
			if (wm === undefined || wm === null) continue
			const tx = wm.normal.y
			const ty = -wm.normal.x
			for (let i = 0; i < man.pointCount; i++) {
				const mp = man.points[i]
				const p = wm.points[i]
				if (mp === undefined || p === undefined) continue
				const jt = Math.abs(mp.tangentImpulse)
				if (!(jt > 0)) continue
				const va = ba.getLinearVelocityFromWorldPoint(p)
				const vb = bb.getLinearVelocityFromWorldPoint(p)
				const after = Math.abs((vb.x - va.x) * tx + (vb.y - va.y) * ty)
				const before = this.slipBefore.get(c)?.[i]
				const slip = before === undefined ? after : (before + after) / 2
				const J = (jt * slip) / (L * L)
				if (J > 0) this.book(sa, sb, { x: p.x / L, y: p.y / L }, J)
			}
		}
		this.slipBefore.clear()
	}

	/** A heat body's contact before the step is solved: its slip speed at each point (planck units/s), for rub's mean slip. */
	private slipOf(c: Contact, eng: NonNullable<ReturnType<ProcessContext["engine"]>>) {
		const fa = c.getFixtureA()
		const fb = c.getFixtureB()
		if (fa.isSensor() || fb.isSensor()) return
		const ba = fa.getBody()
		const bb = fb.getBody()
		if (!ba.isDynamic() && !bb.isDynamic()) return
		const sa = eng.solidOf(fa.getUserData())?.id
		const sb = eng.solidOf(fb.getUserData())?.id
		if (!(sa !== undefined && this.nodesOf.has(sa)) && !(sb !== undefined && this.nodesOf.has(sb))) return
		const wm = c.getWorldManifold(null)
		if (wm === undefined || wm === null || wm.pointCount === 0) return
		const tx = wm.normal.y
		const ty = -wm.normal.x
		const out: number[] = []
		for (let i = 0; i < wm.pointCount; i++) {
			const p = wm.points[i]
			if (p === undefined) {
				out.push(0)
				continue
			}
			const va = ba.getLinearVelocityFromWorldPoint(p)
			const vb = bb.getLinearVelocityFromWorldPoint(p)
			out.push(Math.abs((vb.x - va.x) * tx + (vb.y - va.y) * ty))
		}
		this.slipBefore.set(c, out)
	}

	/** 1/kg: how a body's motion at a point along a direction answers an impulse there (its mass and its turning about its centre of mass). */
	private inverseMass(b: Body, p: { x: number; y: number }, n: { x: number; y: number }) {
		if (!b.isDynamic()) return 0
		const c = b.getWorldCenter()
		const rn = (p.x - c.x) * n.y - (p.y - c.y) * n.x
		const inner = b as unknown as { m_invMass: number; m_invI: number }
		return inner.m_invMass + inner.m_invI * rn * rn
	}

	/**
	 * A contact as the engine meets it (plugins.ts Process.contact). "begin": an impact's lost kinetic energy, ½·m_eff·v_n²·(1 − e²), half to each
	 * side; "pre": a ball-and-ring's ball and ring do not touch while the ball fits through the hole (the engine's contact skin, about 1 mm, is far
	 * coarser than the tenth of a millimetre a hot ball grows: the fit is decided by their true sizes). Leaves out no other contact.
	 */
	touch(ctx: ProcessContext, touch: unknown, phase: "begin" | "pre"): boolean {
		if (!this.built) return false
		const eng = ctx.engine()
		if (eng === undefined) return false
		const c = touch as Contact
		if (phase === "pre") {
			this.slipOf(c, eng)
			if (this.rings.length === 0) return false
			const sa = eng.solidOf(c.getFixtureA().getUserData())?.id
			const sb = eng.solidOf(c.getFixtureB().getUserData())?.id
			if (sa === undefined || sb === undefined) return false
			for (const r of this.rings) if ((sa === r.ball && r.jaws.has(sb)) || (sb === r.ball && r.jaws.has(sa))) return r.fits
			return false
		}
		const fa = c.getFixtureA()
		const fb = c.getFixtureB()
		if (fa.isSensor() || fb.isSensor()) return false
		const ba = fa.getBody()
		const bb = fb.getBody()
		if (!ba.isDynamic() && !bb.isDynamic()) return false
		const sa = eng.solidOf(fa.getUserData())?.id
		const sb = eng.solidOf(fb.getUserData())?.id
		if (!(sa !== undefined && this.nodesOf.has(sa)) && !(sb !== undefined && this.nodesOf.has(sb))) return false
		const wm = c.getWorldManifold(null)
		if (wm === undefined || wm === null || wm.pointCount === 0) return false
		const L = eng.lengthScale
		const n = wm.normal
		// (the approach at each contact point; a face landing flat meets at both its points at once: the impact is at their middle, where the
		// pair's effective mass is the whole body's, not a corner's)
		const vns: number[] = []
		let best = 0
		for (let i = 0; i < wm.pointCount; i++) {
			const p = wm.points[i]
			if (p === undefined) {
				vns.push(0)
				continue
			}
			const va = ba.getLinearVelocityFromWorldPoint(p)
			const vb = bb.getLinearVelocityFromWorldPoint(p)
			const vn = -((vb.x - va.x) * n.x + (vb.y - va.y) * n.y) / L
			vns.push(vn)
			if (vn > best) best = vn
		}
		if (!(best > IMPACT_MIN)) return false
		let ax = 0
		let ay = 0
		let k0 = 0
		for (let i = 0; i < wm.pointCount; i++) {
			const p = wm.points[i]
			if (p === undefined || !((vns[i] as number) >= 0.5 * best)) continue
			ax += p.x
			ay += p.y
			k0++
		}
		const at = { x: ax / k0, y: ay / k0 }
		const k = this.inverseMass(ba, at, n) + this.inverseMass(bb, at, n)
		if (!(k > 0)) return false
		const e = best >= RESTITUTION_FROM ? clamp(c.getRestitution(), 0, 1) : 0
		const J = (0.5 * best * best * (1 - e * e)) / k
		if (J > 0) this.book(sa, sb, { x: at.x / L, y: at.y / L }, J)
		return false
	}

	/** Before each (sub-)step after the release: a ball that has just come to fit its ring is woken (a resting body sleeps). */
	wake(ctx: ProcessContext) {
		for (const r of this.rings) {
			if (!r.wake) continue
			r.wake = false
			const h = ctx.solid(r.ball)
			if (h === undefined) continue
			const v = h.velocity()
			h.setVelocity(v.x, v.y)
		}
	}

	/** The work booked since the last beat goes into its nodes (melting ice, if it is ice). */
	private takeWork() {
		for (const [n, q] of this.worked) {
			if (!(q > 0) || this.empty(n)) continue
			this.heat(n, q)
			this.ledger.work += q
			n.work = (n.work ?? 0) + q
		}
		this.worked.clear()
	}

	// ------------------------------------------------------------------------------------------------------------ candles

	/** Where each flame stands now; lighting, burning its wax, using a jar's oxygen and going out (dt s of lesson time). */
	private burn(ctx: ProcessContext, dt: number) {
		const t = ctx.time()
		for (const f of this.flames) {
			const h = ctx.solid(f.solid)
			if (h === undefined) {
				f.lit = false
				continue
			}
			const q = h.pose()
			const k = h.scale()
			const c = Math.cos(q.angle)
			const sn = Math.sin(q.angle)
			f.wick = { x: q.x + f.at.x * k * c - f.at.y * k * sn, y: q.y + f.at.x * k * sn + f.at.y * k * c }
			// (hot gas rises: the flame stands up from the wick whatever the candle's tilt)
			f.p = { x: f.wick.x, y: f.wick.y + CANDLE.flame / 2 }
			const m = f.node?.melt
			const wax = m === undefined ? Infinity : m.solid
			const was = f.lit
			if (f.out === undefined && t >= f.from && c < 0.34) f.out = "tipped"
			if (f.out === undefined && t >= f.from && !ctx.settings.air) f.out = "air"
			if (f.out === undefined && t >= f.from && wax <= 0) f.out = "wax"
			f.lit = f.out === undefined && t >= f.from && t < f.until
			f.jar = undefined
			for (const j of this.jars) {
				const jh = ctx.solid(j.solid)
				if (jh === undefined) continue
				const jq = jh.pose()
				const jc = Math.cos(jq.angle)
				const js = Math.sin(jq.angle)
				const lx = (f.p.x - jq.x) * jc + (f.p.y - jq.y) * js
				const ly = -(f.p.x - jq.x) * js + (f.p.y - jq.y) * jc
				if (lx >= j.x0 && lx <= j.x1 && ly >= j.y0 && ly <= j.y1) {
					f.jar = j
					break
				}
			}
			const who = f.who
			if (f.lit && !was) ctx.event(`${cap(who)} is lit`, [f.item], "heat:lit")
			if (!f.lit) {
				if (was && f.out !== undefined) {
					const why =
						f.out === "oxygen"
							? `the oxygen in the jar's air fell to ${(((f.jar?.o2 ?? 0) / (f.jar?.volume ?? 1)) * 100).toFixed(1)} % (air is 20.9 %; a candle flame needs about 16 %)`
							: f.out === "wax"
								? "its wax is used up"
								: f.out === "tipped"
									? "it fell over"
									: "there is no air"
					ctx.event(`${cap(who)} went out: ${why}`, f.jar === undefined ? [f.item] : [f.item, f.jar.item], "heat:out")
				}
				continue
			}
			// its wax burns: 0.1 g a minute takes 3.45 g of oxygen a gram from the jar's air (if it is in one)
			const dm = Math.min(wax, f.burn * dt)
			if (f.jar !== undefined) {
				f.jar.o2 = Math.max(0, f.jar.o2 - (dm * CANDLE.o2PerWax) / CANDLE.o2Density)
				if (f.jar.o2 / f.jar.volume < CANDLE.outO2) f.out = "oxygen"
			}
			f.burned += dm
			const node = f.node
			if (node !== undefined && m !== undefined && dm > 0) {
				const before = this.enthalpy(node)
				m.solid -= dm
				node.burnt = (node.burnt ?? 0) + dm
				this.ledger.chem += this.enthalpy(node) - before
			}
		}
	}

	/**
	 * A lit flame's plume (heat-data plumeExcess: Heskestad's plume): what stands over it, lowest first, meets its hot rising gas (forced
	 * convection at the plume's speed over the part of its underside inside the plume) until the plume's convected heat is used up or something
	 * wide enough stops it. As links to a fixed far side (the plume's gas), each exact for its pair.
	 */
	private plumeLinks(ctx: ProcessContext, f: Flame, links: Link[]) {
		const g = ctx.settings.gravity
		const Tk = this.room + KELVIN
		const qc = f.power * f.plume
		if (!(qc > 0) || !(g > 0)) return
		const hits: { h: SolidHandle; y0: number; z: number; dT: number; half: number; ox: number }[] = []
		for (const h of ctx.all()) {
			if (h.item === f.item) continue
			const o = this.outline(h.id)
			if (o === undefined) continue
			const b = boxOf(o)
			if (!(b.y0 > f.wick.y) || b.x0 > f.wick.x + 1 || b.x1 < f.wick.x - 1) continue
			const z = b.y0 - f.wick.y
			const dT = plumeExcess(qc, z, Tk, g)
			const half = plumeHalfWidth(z, dT, Tk)
			const ox = Math.min(b.x1, f.wick.x + half) - Math.max(b.x0, f.wick.x - half)
			if (ox > 0) hits.push({ h, y0: b.y0, z, dT, half, ox })
		}
		hits.sort((a, b) => a.z - b.z || (a.h.id < b.h.id ? -1 : a.h.id > b.h.id ? 1 : 0))
		let open = 1
		let budget = qc
		for (const x of hits) {
			if (open <= 1e-6 || budget <= 0) break
			const share = Math.min(1, x.ox / (2 * x.half))
			const bx = boxOf(this.outline(x.h.id) as Outline)
			const node = this.nodeAt(x.h.id, { x: clamp(f.wick.x, bx.x0, bx.x1), y: x.y0 })
			if (node !== undefined && !this.empty(node)) {
				const depth = Math.min(sizesOf(x.h.part).depth * (x.h.scale() || 1), 2 * x.half)
				const A = x.ox * depth * Math.min(1, open / Math.max(1e-9, share))
				const hc = forcedAir(plumeRise(qc, x.z, Tk, g), Math.max(0.005, Math.min(x.ox, depth)))
				const Tgas = this.room + 0.5 * x.dT
				const G0 = hc * A
				const pull = G0 * Math.max(0, Tgas - node.T)
				const G = pull > budget ? (G0 * budget) / pull : G0
				if (G > 0) links.push({ a: node, b: undefined, Tb: Tgas, G })
				budget -= Math.min(pull, budget)
			}
			open -= share
		}
	}

	/** The plumes' gas at a point (lit flames below it, the Gaussian across each plume): its temperature (°C) and rising speed (m/s), or undefined. */
	private plumeAt(ctx: ProcessContext, p: Point) {
		const g = ctx.settings.gravity
		const Tk = this.room + KELVIN
		let best: { T: number; u: number } | undefined
		for (const f of this.flames) {
			if (!f.lit || !(g > 0)) continue
			const z = p.y - f.wick.y
			if (!(z > 0)) continue
			const qc = f.power * f.plume
			const dT = plumeExcess(qc, z, Tk, g)
			const b = plumeHalfWidth(z, dT, Tk)
			const off = (p.x - f.wick.x) / b
			if (off * off > 9) continue
			const e = Math.exp(-off * off)
			const T = this.room + dT * e
			if (best === undefined || T > best.T) best = { T, u: plumeRise(qc, z, Tk, g) * e }
		}
		return best
	}

	// ------------------------------------------------------------------------------------------------------------ liquid that other modules move

	/** Liquid that left its container (flow's pitchers pouring) and liquid that arrived (flow's basins filling), heat for heat through `transit`. */
	private follow(ctx: ProcessContext) {
		const arriving: [Node, number][] = []
		for (const n of this.nodes) {
			const f = n.follow
			const m = n.melt
			if (f === undefined || m === undefined) continue
			const v = ctx.get(f.item, f.key)
			if (v === undefined || !Number.isFinite(v)) continue
			if (f.add) {
				// (what it has received so far: only what arrived since the last beat counts, so its own evaporation stays its own)
				const got = Math.max(0, v - f.last) * 1e-6 * f.rho
				f.last = Math.max(f.last, v)
				if (got > 1e-9) arriving.push([n, got])
				continue
			}
			// (what is left in it: only what left since counts; heat's own evaporation from it is not flow's to undo)
			const d = Math.max(0, v) * 1e-6 * f.rho - (m.liquid + m.solid)
			if (d < -1e-7) {
				// (poured empty: the last milligram goes too, so nothing is left to boil away in an empty pitcher)
				const out = m.liquid + d < 1e-6 ? m.liquid : Math.min(m.liquid, -d)
				if (!(out > 0)) continue
				const before = this.enthalpy(n)
				const salt = m.liquid > 0 ? (m.salt * out) / m.liquid : 0
				m.liquid -= out
				m.salt -= salt
				this.transit.m += out
				this.transit.H += before - this.enthalpy(n)
				this.transitSalt += salt
			}
		}
		for (const tap of this.taps) {
			const v = ctx.get(tap.item, tap.key)
			if (v === undefined || !Number.isFinite(v)) continue
			const add = Math.max(0, v - tap.last) * 1e-6 * WATER.density
			tap.last = Math.max(tap.last, v)
			if (!(add > 0)) continue
			const H = add * (WATER.heatCapacity * tap.T + ICE.fusion)
			this.transit.m += add
			this.transit.H += H
			this.ledger.spilled += H
		}
		for (const [n, d] of arriving) {
			const m = n.melt as Melt
			const take = Math.min(d, this.transit.m)
			if (take > 1e-9) {
				const H = (this.transit.H * take) / this.transit.m
				const salt = (this.transitSalt * take) / this.transit.m
				this.transit.m -= take
				this.transit.H -= H
				this.transitSalt -= salt
				if (this.transit.m <= 1e-12) {
					this.transit.m = 0
					this.transit.H = 0
					this.transitSalt = 0
				}
				const before = this.enthalpy(n)
				if (m.solid + m.liquid <= 0 && n.C <= 0) n.T = this.room
				m.liquid += take
				m.salt += salt
				this.heat(n, before + H - this.enthalpy(n))
			}
			const rest = d - take
			if (rest > 1e-9) {
				// (more arrived than any container gave: liquid from outside heat's world, at the room's temperature)
				const before = this.enthalpy(n)
				this.pour(n, rest, 0, this.room)
				this.ledger.spilled += this.enthalpy(n) - before
			}
		}
	}

	// ------------------------------------------------------------------------------------------------------------ the optics module's light

	/**
	 * The light the optics module traced (modules/optics.ts opticsOf: lamps, the sun, flashlights, a candle's flame, through lenses, off
	 * mirrors, through clear glass), as heat: the W each body node absorbs, the solids optics knows, and each node's brightest 4 mm of surface
	 * (W: a lens's focus) for its hottest spot. Built again whenever optics traces again; undefined in a scene without optics or before its
	 * first trace (heat's own estimate holds then).
	 */
	private traced(ctx: ProcessContext) {
		const res = opticsOf(ctx.scene)?.result()
		if (res === undefined) return undefined
		if (this.optic !== undefined && this.optic.res === res) return this.optic
		const placed = res.placed as readonly { readonly src?: { readonly id?: string; readonly role?: string } }[]
		// (a clear body, ice, water or glass, is left to heat's own estimate: the tracer gives it the whole height of the beam out of the plane,
		// not the share its depth catches as it does for an opaque body, so a 4 cm ice cube 34 cm from a lamp would take 12 times its light)
		const known = new Set<string>()
		for (const p of placed) if (typeof p?.src?.id === "string" && p.src.role !== "glass") known.add(p.src.id)
		const power = new Map<Node, number>()
		// (per node and face, SPOT_BIN along it: W, W·s, W·s² of what lands there: the brightest spot's power and its spread)
		const bins = new Map<Node, Map<string, [number, number, number, number, number, number]>>()
		const waters = this.nodes.filter((n) => n.water !== undefined && !n.water.spilled && !this.empty(n))
		for (const d of res.deposits) {
			const id = placed[d.body]?.src?.id
			if (id === undefined || !known.has(id) || !this.nodesOf.has(id)) continue
			// (the light that lands on it, times its own absorptivity: heat's, from its material or colour, Incropera Table A.12's white paint 0.2 to
			// black 0.97; the tracer's own split, 1 − its colour's reflectance in each band, makes a white glaze take only a tenth of a lamp's infrared)
			let inc = 0
			for (let k = 0; k < d.incident.length; k++) inc += d.incident[k] as number
			if (!(inc > 0)) continue
			// light landing under a vessel's water: the water's own share of the light (heat's estimate) has it
			if (waters.some((wn) => wn.solids.includes(id) && d.x >= (wn.water as WaterSpec).wx0 && d.x <= (wn.water as WaterSpec).wx1 && d.y <= (wn.water as WaterSpec).level)) continue
			const n = this.nodeAt(id, { x: d.x, y: d.y })
			if (n === undefined) continue
			const a = inc * n.alpha
			const outer = n.outerNode
			const inner = outer !== undefined && n.chain !== undefined ? Math.min(1, (2 * n.chain.band) / n.chain.depth) : 1
			power.set(n, (power.get(n) ?? 0) + a * inner)
			if (outer !== undefined && inner < 1) power.set(outer, (power.get(outer) ?? 0) + a * (1 - inner))
			// (light a lens bent or a mirror turned: key 1 is light straight from its source)
			if (!d.volume && d.key !== 1) {
				const s = -d.x * d.ny + d.y * d.nx
				const m = bins.get(n) ?? new Map<string, [number, number, number, number, number, number]>()
				bins.set(n, m)
				const key = `${d.prim}:${Math.floor(s / SPOT_BIN)}`
				const b = m.get(key) ?? [0, 0, 0, 0, 0, 0]
				b[0] += a
				b[1] += a * s
				b[2] += a * s * s
				b[3] += 1
				b[4] += a * d.x
				b[5] += a * d.y
				m.set(key, b)
			}
		}
		// a spot is light a lens or a curved mirror brought together (a focus): many of the tracer's bent or turned rays in one 4 mm of a face (a
		// wide even beam's rays, straight or off a flat mirror, are a few millimetres apart: one or two there); a round element focuses out of the
		// plane as in it, so the spot is as small across the plane as along it
		const spots = new Map<Node, { P: number; r: number; x: number; y: number }>()
		for (const [n, m] of bins) {
			let best: { P: number; r: number; x: number; y: number } | undefined
			for (const [key, v] of m) {
				const cut = key.lastIndexOf(":")
				const next = m.get(`${key.slice(0, cut)}:${Number(key.slice(cut + 1)) + 1}`) ?? [0, 0, 0, 0, 0, 0]
				const W = v[0] + next[0]
				const P = W
				if (v[3] + next[3] < SPOT_RAYS || (best !== undefined && !(P > best.P))) continue
				const mean = (v[1] + next[1]) / W
				const spread = Math.sqrt(Math.max(0, (v[2] + next[2]) / W - mean * mean))
				best = { P, r: clamp(2 * spread, SPOT_MIN_R, SPOT_R), x: (v[4] + next[4]) / W, y: (v[5] + next[5]) / W }
			}
			if (best !== undefined) spots.set(n, best)
		}
		this.optic = { res, power, spots, known }
		return this.optic
	}

	/**
	 * A body's hottest spot under concentrated light: P W absorbed on a spot of radius a (the light's own spread on it, SPOT_MIN_R to SPOT_R)
	 * spreads into the body by conduction (a thin sheet: 2π·k·t / ln 10 ≈ 2.73·k·t; a thick body: a disc on a half-space, 4·k·a) and leaves
	 * both its faces by convection and radiation (εσ(T⁴ − T∞⁴) linearised at the spot's temperature, found by fixed-point steps). A sheet of
	 * paper is its real thickness here (heat-data `sheet`: its mass over its paper's density), not the engine's 1 mm slab. °C, at most SPOT_MAX.
	 */
	private spotOf(n: Node, P: number, a: number, was: number, dt: number) {
		const sheet = n.mat.sheet
		const t = sheet !== undefined && n.area > 0 ? Math.min(n.thick, n.C / n.mat.heatCapacity / (sheet * (n.area / 2))) : n.thick
		const cond = n.mat.conductivity * Math.min(4 * a, 2.73 * t)
		const face = (t < 0.004 ? 2 : 1) * Math.PI * a * a
		let T = n.T
		let G = cond
		for (let i = 0; i < 12; i++) {
			const Tk = Math.max(T, n.T) + KELVIN
			const Ek = n.envT + KELVIN
			const hr = n.eps * SIGMA * (Tk * Tk + Ek * Ek) * (Tk + Ek)
			const hc = naturalAir(Math.max(1, T - n.envT), 2 * a, "rising")
			G = Math.max(1e-9, cond + face * (hc + hr))
			T = n.T + P / G
			if (T > SPOT_MAX) break
		}
		const steady = Math.min(SPOT_MAX, T)
		// it gets there over the spot's own time constant: its heat capacity (a sheet's spot, π·a²·t of it; a thick body's, a half-ball of radius a
		// at 1000 kg/m³, provisional) over its conductance
		const Cs = (sheet !== undefined ? sheet * Math.PI * a * a * t : (1000 * 2 * Math.PI * a * a * a) / 3) * n.mat.heatCapacity
		const from = Math.max(was, n.T)
		return dt > 0 ? steady + (from - steady) * Math.exp((-dt * G) / Cs) : from
	}

	// ------------------------------------------------------------------------------------------------------------ sizes that follow temperatures

	/** A ball-and-ring's fit (its ball's size against its hole's, each grown by 1 + α·(T − T_ref)), and whether the ball has gone through. */
	private fit(ctx: ProcessContext) {
		for (const r of this.rings) {
			const b = r.ballNode
			const g = r.ringNode
			const ball = b?.expand === undefined ? 0 : b.expand.size * (1 + b.expand.alpha * (b.T - b.expand.ref))
			const hole = g?.expand === undefined ? Infinity : g.expand.size * (1 + g.expand.alpha * (g.T - g.expand.ref))
			const fits = ball < hole
			if (fits && !r.fits) r.wake = true
			r.fits = fits
			if (r.passed) continue
			const hb = ctx.solid(r.ball)
			const jaws = [...r.jaws].map((id) => ctx.solid(id)).filter((h): h is SolidHandle => h !== undefined)
			if (hb === undefined || jaws.length === 0) continue
			let bottom = Infinity
			for (const j of jaws) bottom = Math.min(bottom, boxOf(j.outline()).y0)
			const o = hb.outline()
			if (boxOf(o).y1 < bottom) {
				r.passed = true
				ctx.event(`${cap(b?.who ?? "the ball")} passes through the ring (${(ball * 1000).toFixed(3)} mm through a ${(hole * 1000).toFixed(3)} mm hole)`, [r.item], "heat:through")
			}
		}
	}

	/** Advances the heat by dt s of lesson time (the run's slow beat). */
	advance(ctx: ProcessContext, dt: number) {
		if (!this.built) this.build(ctx)
		this.ctx = ctx
		this.beat = dt
		this.takeWork()
		this.follow(ctx)
		this.burn(ctx, dt)
		this.gather(ctx)
		const n = Math.min(MAX_SUBS, Math.max(1, Math.ceil(dt / SUB_STEP - 1e-9)))
		const h = dt / n
		for (const heater of this.heaters) heater.spent = 0
		for (let k = 0; k < n; k++) this.sub(h)
		// (a heater's power this beat: what its thermostat let through, on average)
		for (const heater of this.heaters) heater.drawn = dt > 0 ? heater.spent / dt : 0
		this.drain()
		this.resize(ctx)
		this.settle()
		this.fit(ctx)
		this.report(ctx)
	}

	/** What heat added to or took from a fluids container's water this beat goes to the container's liquid (heat-fluids.ts): one water, one level. */
	private settle() {
		for (const n of this.nodes) {
			const w = n.water
			if (w === undefined || !w.world || w.owed === 0) continue
			if (w.region !== undefined && w.region !== null) changeLiquid(w.region, w.owed)
			w.owed = 0
		}
	}

	/** Melt water beyond what a melting body holds drains to its puddle (or the water it stands in), with its share of the salt. */
	private drain() {
		for (const n of this.nodes) {
			const m = n.melt
			if (n.kind !== "body" || m === undefined || m.solid0 <= 0) continue
			const into = n.inWater ?? n.puddle
			if (into === undefined) continue
			const keep = m.solid > 0 && n.inWater === undefined ? this.holds(n) : 0
			const extra = m.liquid - keep
			if (extra <= 1e-12) continue
			// (the salt goes with the water in proportion, so the brine left behind is as strong as before)
			const salt = m.liquid > 0 ? (m.salt * extra) / m.liquid : 0
			const before = this.enthalpy(n) + this.enthalpy(into)
			const T = n.T
			m.liquid -= extra
			m.salt -= salt
			if (m.solid <= 0 && m.liquid <= 1e-12) {
				m.liquid = 0
				m.salt = 0
			}
			this.pour(into, extra, salt, T)
			this.ledger.chem += this.enthalpy(n) + this.enthalpy(into) - before
		}
	}

	/** Melting bodies and dissolving salt piles shrink: their size as the cube root of what is left (rebuilt on 0.5 mm or 1 %). */
	private resize(ctx: ProcessContext) {
		const rebuild = (solids: readonly string[], s: number, last: number, size: number, fine = false) => {
			const gone = s * size < GONE_SIZE
			// (a candle burning on a scale is rebuilt every 0.15 % of its mass: a kitchen scale shows its 0.1 g a minute)
			if (gone ? last === 0 : fine ? Math.abs(s - last) < RESIZE_BURN * last : Math.abs(s - last) * size < RESIZE_MM && Math.abs(s - last) < RESIZE_SHARE * last) return last
			const k = gone ? 0 : s
			for (const id of solids) ctx.solid(id)?.resize(k)
			return k
		}
		for (const n of this.nodes) {
			const m = n.melt
			if (n.kind !== "body" || m === undefined || m.solid0 <= 0) continue
			const left = m.solid / m.solid0
			n.scale = left <= 0 ? 0 : left ** (1 / 3)
			const was = n.built
			n.built = rebuild(n.solids, n.scale, n.built, n.length, (n.burnt ?? 0) > 0 && m.solid > 0)
			// (ice in a fluids container's water: the melt water joins its liquid as the body that displaced it shrinks, kg for kg, so floating
			// ice that melts leaves the level where it was: heat-fluids.ts)
			const pool = n.inWater?.water
			if (m.water && n.built !== was && pool?.world === true) pool.owed += (m.solid0 * (was * was * was - n.built * n.built * n.built)) / WATER.density
			// gone (under 1 mm): what is left of it, a crumb of ice and its film, joins its puddle (or the water it is in), heat for heat
			const into = n.inWater ?? n.puddle
			if (n.built === 0 && m.solid + m.liquid > 0 && into !== undefined) {
				const before = this.enthalpy(n) + this.enthalpy(into)
				const water = m.solid + m.liquid
				const salt = m.salt
				m.solid = 0
				m.liquid = 0
				m.salt = 0
				this.pour(into, water, salt, n.T)
				this.heat(into, before - this.enthalpy(n) - this.enthalpy(into))
			}
		}
		for (const n of this.nodes) {
			const m = n.melt
			if (n.pool !== true || m === undefined || m.liquid0 <= 0) continue
			// (its radius as the root of its area: pinned while it dries, puddleArea)
			const left = (this.puddleArea(n) * m.rho * SPREAD) / m.liquid0
			n.scale = left <= 0 ? 0 : Math.sqrt(left)
			n.built = rebuild(n.solids, n.scale, n.built, n.length * 20)
		}
		for (const salt of this.salts) {
			if (salt.start <= 0) continue
			const s = salt.left < 2e-5 ? 0 : (salt.left / salt.start) ** (1 / 3)
			salt.built = rebuild([salt.solid], s, salt.built, salt.node?.length ?? 0.01)
		}
	}

	private say(ctx: ProcessContext, n: Node, key: string, text: string) {
		if (n.said.has(key)) return
		n.said.add(key)
		ctx.event(text, [n.item], `heat:${key}`)
	}

	/** Sets each item's readings (track.state) and says what happened (track.events). */
	private report(ctx: ProcessContext) {
		const used = new Set<string>()
		const chains = new Map<string, Node[]>()
		const key = (n: Node, k: string) => {
			const plain = `${n.item}\u0000${k}`
			if (!used.has(plain)) {
				used.add(plain)
				return k
			}
			return `${n.part}:${k}`
		}
		for (const n of this.nodes) {
			if (n.chain !== undefined) {
				const id = n.id.slice(0, n.id.lastIndexOf("#"))
				chains.set(id, [...(chains.get(id) ?? []), n])
				continue
			}
			const m = n.melt
			if (n.kind === "sensor") {
				ctx.set(n.item, key(n, "reading"), n.T)
				// (whether its bulb is in water: a reading of hot water that leaves it is said, not passed silently: mod_heat.py goal_reaches)
				ctx.set(n.item, key(n, "in_water"), n.sensor?.medium === 1 ? 1 : 0)
				continue
			}
			if (n.kind === "puddle") {
				const g = m === undefined ? 0 : (m.liquid + m.solid) * 1000
				ctx.set(n.item, "puddle_g", g)
				ctx.set(n.item, "puddle_temp", n.T)
				if (m !== undefined && m.vapor > 0 && g <= 0 && n.owner?.melt?.solid === 0) this.say(ctx, n, "dried", `${n.who} dried up`)
				continue
			}
			if (n.kind === "water" && m !== undefined && n.fluid !== undefined) {
				// a liquid that is not water (oil, honey, alcohol): its temperature, how much there is and its level
				const w = n.water as WaterSpec
				ctx.set(n.item, key(n, "liquid_temp"), n.T)
				ctx.set(n.item, key(n, "liquid_g"), (m.liquid + m.solid) * 1000)
				// (a fluids container's level is the liquids module's level_mm: one level)
				if (w.world && w.region === undefined) w.region = regionOf(ctx.scene, n.item) ?? null
				if (!w.world || w.region === null) ctx.set(n.item, key(n, "level"), Math.max(0, w.level - w.floor))
				continue
			}
			if (n.kind === "water" && m !== undefined) {
				const w = n.water as WaterSpec
				ctx.set(n.item, key(n, "water_temp"), n.T)
				ctx.set(n.item, key(n, "water_g"), m.liquid * 1000)
				ctx.set(n.item, key(n, "ice_g"), m.solid * 1000)
				// (a fluids container's level is the liquids module's level_mm: one level)
				if (w.world && w.region === undefined) w.region = regionOf(ctx.scene, n.item) ?? null
				if (!w.world || w.region === null) ctx.set(n.item, key(n, "level"), Math.max(0, w.level - w.floor))
				ctx.set(n.item, key(n, "boiled_g"), m.vapor * 1000)
				// boiling: water turned to steam at its boiling point since the last report (evaporation from the surface keeps it a little under it)
				const boiling = m.liquid > 0 && (m.boiled ?? 0) > 0 ? 1 : 0
				m.boiled = 0
				ctx.set(n.item, key(n, "boiling"), boiling)
				if (boiling) this.say(ctx, n, "boil", `${n.who} boils`)
				if (m.liquid0 > 0 && m.liquid <= 0 && m.solid <= 0 && !w.spilled && n.follow === undefined) this.say(ctx, n, "dry", `${n.who} boiled away`)
				if (m.liquid0 > 0 && m.solid > 0 && m.liquid <= 0) this.say(ctx, n, "frozen", `${n.who} froze solid`)
				continue
			}
			ctx.set(n.item, key(n, "temp"), n.T)
			this.reportExtras(ctx, n, key, this.optic?.spots.get(n))
			if (m !== undefined) {
				// (wax a flame burned is gone, not melted)
				const melted = m.solid0 > 0 ? Math.max(0, 1 - (m.solid + (n.burnt ?? 0)) / m.solid0) : m.liquid > 0 ? 1 : 0
				ctx.set(n.item, key(n, "melted"), melted)
				ctx.set(n.item, key(n, "liquid_g"), m.liquid * 1000)
				if (m.water) ctx.set(n.item, key(n, "brine_g"), m.salt * 1000)
				if (m.solid0 <= 0) ctx.set(n.item, key(n, "ice_g"), m.solid * 1000)
				if (m.solid0 > 0) ctx.set(n.item, key(n, "scale"), n.scale)
				if (m.solid0 > 0 && m.solid <= 0 && melted > 0.5) this.say(ctx, n, "melted", `${n.who} melted completely`)
				if (m.solid0 <= 0 && m.liquid0 > 0 && m.liquid <= 0 && m.solid <= 0) this.say(ctx, n, "dried", `${n.who} dried up`)
				if (m.solid0 <= 0 && m.liquid0 > 0 && m.solid > 0 && m.liquid <= 0) this.say(ctx, n, "frozen", `${n.who} froze`)
			}
			if (n.wet > 0 || n.said.has("dew")) {
				ctx.set(n.item, key(n, "wet_g"), n.wet * 1000)
				// (said for what sweats, a cold glass or can; frost on ice from the freezer is no news)
				if (n.wet > 5e-5 && !(m !== undefined && m.solid0 > 0)) this.say(ctx, n, "dew", `water condenses on ${n.who}`)
			}
		}
		for (const all of chains.values()) {
			const list = all.filter((n) => n.outer !== true)
			const n0 = list[0] as Node
			let sum = 0
			let cap = 0
			let lo = Infinity
			let hi = -Infinity
			for (const n of all) {
				sum += n.T * n.C
				cap += n.C
				lo = Math.min(lo, n.T)
				hi = Math.max(hi, n.T)
			}
			ctx.set(n0.item, key(n0, "temp"), cap > 0 ? sum / cap : n0.T)
			ctx.set(n0.item, key(n0, "temp_min"), lo)
			ctx.set(n0.item, key(n0, "temp_max"), hi)
			// (its work and its hottest spot: the chain's, over its cells)
			let work = 0
			let hot: Node | undefined
			let hotSpot: { P: number; r: number; x: number; y: number } | undefined
			for (const n of all) {
				work += n.work ?? 0
				const sp = this.optic?.spots.get(n)
				if (sp !== undefined && sp.P > (hotSpot?.P ?? 0)) {
					hotSpot = sp
					hot = n
				}
			}
			this.reportExtras(ctx, n0, key, hotSpot, hot, work)
			if (n0.chain?.profile === true) {
				for (let k = 0; k < PROFILE; k++) {
					// evenly from the first cell to the last
					const at = (k * (list.length - 1)) / (PROFILE - 1)
					const i = Math.floor(at)
					const a = (list[i] as Node).T
					const b = (list[Math.min(list.length - 1, i + 1)] as Node).T
					ctx.set(n0.item, `temp${k}`, a + (b - a) * (at - i))
				}
			}
		}
		for (const salt of this.salts) {
			ctx.set(salt.item, "salt_g", salt.left * 1000)
			if (salt.start > 0 && salt.left <= 0 && salt.node !== undefined) this.say(ctx, salt.node, "dissolved", `${salt.node.who.startsWith("the ") ? "the salt pile" : salt.node.who} dissolved`)
		}
		for (const heater of this.heaters) ctx.set(heater.item, "power", heater.drawn)
		const t = ctx.time()
		for (const lamp of this.lamps) ctx.set(lamp.item, "on", t >= lamp.from && t < lamp.until ? 1 : 0)
		for (const f of this.flames) {
			ctx.set(f.item, "flame", f.lit ? 1 : 0)
			ctx.set(f.item, "flame_w", f.lit ? f.power : 0)
			ctx.set(f.item, "burned_g", f.burned * 1000)
		}
		for (const j of this.jars) ctx.set(j.item, "o2_pct", (j.o2 / j.volume) * 100)
		for (const r of this.rings) {
			const b = r.ballNode
			const g = r.ringNode
			if (b?.expand !== undefined) ctx.set(r.item, "ball_mm", b.expand.size * (1 + b.expand.alpha * (b.T - b.expand.ref)) * 1000)
			if (g?.expand !== undefined) ctx.set(r.item, "hole_mm", g.expand.size * (1 + g.expand.alpha * (g.T - g.expand.ref)) * 1000)
			ctx.set(r.item, "fits", r.fits ? 1 : 0)
			ctx.set(r.item, "through", r.passed ? 1 : 0)
		}
	}

	/** A body's extra readings: the work it took in (J), its hottest spot under concentrated light (°C) and whether it scorched, a bimetal's bend. */
	private reportExtras(ctx: ProcessContext, n: Node, key: (n: Node, k: string) => string, sp: { P: number; r: number; x: number; y: number } | undefined, at: Node = n, work = n.work ?? 0) {
		if (work >= WORK_SHOWN) ctx.set(n.item, key(n, "work_j"), work)
		if ((sp !== undefined && sp.P > 0) || n.spot !== undefined) {
			const T = sp !== undefined && sp.P > 0 ? this.spotOf(at, sp.P, sp.r, n.spot ?? at.T, this.beat) : at.T
			if (n.spot !== undefined || T - at.T >= SPOT_SHOWN) {
				n.spot = T
				ctx.set(n.item, key(n, "spot_temp"), T)
				// (where it is, for the view's scorch mark: world m)
				if (sp !== undefined && sp.P > 0) {
					ctx.set(n.item, key(n, "spot_x"), sp.x)
					ctx.set(n.item, key(n, "spot_y"), sp.y)
				}
				if (n.scorch !== undefined) {
					if (!n.scorched && T >= n.scorch) {
						n.scorched = true
						this.say(ctx, n, "scorch", `${n.who} scorches where the light is focused (its hottest spot passes ${n.scorch} °C)`)
					}
					ctx.set(n.item, key(n, "scorched"), n.scorched === true ? 1 : 0)
				}
			}
		}
		const b = n.bend
		if (b !== undefined) {
			const k = bimetalCurvature(b.a1, b.a2, b.e1, b.e2, b.t1, b.t2, n.T - b.ref)
			ctx.set(n.item, key(n, "bend_mm"), (k * b.length * b.length * 1000) / 2)
			ctx.set(n.item, key(n, "bend_deg"), (k * b.length * 180) / Math.PI)
		}
	}

	/** For checks: a node by id. */
	node(id: string) {
		return this.nodes.find((n) => n.id === id)
	}
	/** The energy held now (J, enthalpy as `heat` reckons it, every node). */
	energy() {
		let e = this.transit.H
		for (const n of this.nodes) e += this.enthalpy(n)
		return e
	}
	/** Energy now − at the start − what the ledger booked: 0 to rounding (the bookkeeping closes). */
	imbalance() {
		const l = this.ledger
		return this.energy() - this.start0 - (l.sources + l.room + l.vapor + l.chem + l.spilled + l.work)
	}
}

/**
 * The one heat world of each run, which every heat record's process shares: keyed by the run's scene object. Every record's process
 * is made before any starts (plugins.ts ProcessRunner), so a world that has started belongs to an earlier run of the same scene object
 * and the first record of a new run makes a new one.
 */
const WORLDS = new WeakMap<object, HeatWorld>()
export const heatWorldFor = (scene: object) => {
	let w = WORLDS.get(scene)
	if (w === undefined || w.started) {
		w = new HeatWorld()
		WORLDS.set(scene, w)
	}
	return w
}
/** The heat world of a scene's latest run (for checks). */
export const heatWorldOf = (scene: object) => WORLDS.get(scene)
