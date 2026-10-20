/**
 * Liquids for the engine: still water (and oil, salt water, syrup ...) standing in fixed containers, in layers by density.
 * Everything here is pure arithmetic on world metres, kilograms and seconds (no planck): the engine's adapter
 * (fluids-engine.ts) hands it each moving body's parts as they stand now and applies the forces it answers.
 *
 * What a liquid does to a body in it, each step:
 * - Buoyancy (Archimedes): ρ·g·V up for the volume V of the body below each layer's top, acting at that volume's centroid
 *   (so a boat rights itself and a log rolls to float flat). The air the engine already lifts the body by is taken off the
 *   share that is in the liquid (ρ − ρ_air). A hollow hull (a clay or foil boat) displaces its whole envelope until water
 *   pours over its rim; then it floods and displaces only its own material (it sinks if that is denser than the liquid).
 * - The level: the liquid's own volume is conserved, so every body that goes in raises the surface by the volume it pushes
 *   aside over the container's cross-section (a measuring cup's reading rises); a level that would pass the rim spills,
 *   from the top layer down, and stays spilled.
 * - Drag: form drag (Newton's flat-plate drag side by side over the wet part of the outline, as the engine's air drag, with
 *   the liquid's density), a sphere's whole drag curve (Clift & Gauvin 1970), and a viscous drag (Stokes, with Schiller &
 *   Naumann's correction) that dominates in syrup; solved implicitly, so any viscosity is steady.
 * - Added mass: a body accelerating through liquid carries some of it along, C_a·ρ·V (½ for a sphere: Lamb, Hydrodynamics
 *   §92; 1 for a cylinder across the flow; ½ for blocks, provisional: DNV-RP-C205 Table A-2 gives 0.67 for a cube), while it
 *   touches nothing and hangs from nothing.
 * - Wave damping: a body that pierces the surface makes waves as it bobs and rocks; that loses energy at a damping ratio of
 *   about 0.1 of its bobbing on the waterplane's stiffness ρ·g·A (provisional, in the range Vugts (1968) measured for 2D
 *   floating sections, 0.05-0.3).
 */
import type { Vec } from "#sim/part.ts"

/** Standard gravity, m/s² (the engine's). */
export const G = 9.81
/** Air at room temperature, kg/m³ (the engine's): the engine lifts every body by it; in liquid that share is replaced. */
export const AIR = 1.2
/** Form-drag coefficient of a block's side facing the flow: the engine's air value, so a body meets air and water alike (Hoerner, Fluid-Dynamic Drag, 1965: a cube 1.05). */
export const BLOCK_DRAG = 1.05
/** Added-mass coefficients (of the displaced liquid): sphere ½ (Lamb §92), circular cylinder across the flow 1 (Lamb §68), block ½ (provisional). */
export const ADDED_MASS = { sphere: 0.5, cylinder: 1.0, prism: 0.5 } as const
/** Damping ratio of a floating body's bobbing and rocking from the waves it makes (provisional; Vugts 1968: 0.05-0.3 for 2D sections). */
export const WAVE_DAMPING = 0.1

// ------------------------------------------------------------------------------------------------ the scene's liquids
/** One liquid in a container: what it is called, its density (kg/m³), viscosity (Pa·s) and how deep it stands with nothing in it (m). */
export interface FluidLayer {
	readonly words: string
	readonly density: number
	readonly viscosity: number
	readonly height: number
	/** its surface tension, N/m, and the largest contact angle it makes on ordinary solids, degrees (only in a scene with surface things) */
	readonly tension?: number
	readonly wets?: number
}

/**
 * A fixed container's liquid, in the world: the inner walls x0…x1, the inner floor, the rim (the highest the surface can stand;
 * more spills), the horizontal cross-section (m²: inner width × inner depth, or π r² for a round one) and its layers bottom first
 * (the denser below; the builder orders them).
 */
export interface FluidRegion {
	readonly id: string
	readonly item: string
	readonly x0: number
	readonly x1: number
	readonly floor: number
	readonly rim: number
	readonly area: number
	readonly layers: readonly FluidLayer[]
}

/** What a part displaces, in the world as it stands now. */
export type FluidShape =
	/** a ball (the outer sphere: a hollow one displaces its air too) */
	| { readonly kind: "sphere"; readonly x: number; readonly y: number; readonly r: number }
	/** a round body lying along the depth axis (a log, a can on its side): a circle × length */
	| { readonly kind: "cylinder"; readonly x: number; readonly y: number; readonly r: number; readonly length: number }
	/** a slab or polygon: its outline (counter-clockwise, convex) × depth; less `minus` (a hull's water inside it: it displaces nothing) */
	| { readonly kind: "prism"; readonly points: readonly Vec[]; readonly depth: number; readonly minus?: readonly Vec[]; readonly scale?: number }
// (a prism's `scale`: its true volume over its outline × depth, a mug's handle drawn deeper than it is; 1 without it)

/**
 * A moving body (a weld group) as the liquid sees it: its mass (kg) and rotational inertia about its centre of mass (kg·m²),
 * where that is, how it moves (m/s, rad/s), whether it is free (touches nothing, hangs from nothing: then it carries added
 * mass), the forces already on it this step besides gravity (N, N·m: the air's, springs' weights), its parts, and a hollow
 * hull's envelope if it has one (world outline, depth, the two points of its opening, and whether it has flooded).
 */
export interface FluidBody {
	readonly key: number
	readonly mass: number
	readonly inertia: number
	readonly com: Vec
	readonly v: Vec
	readonly w: number
	readonly free: boolean
	readonly force: Vec
	readonly torque: number
	readonly parts: readonly FluidShape[]
	readonly hull?: {
		readonly points: readonly Vec[]
		readonly depth: number
		readonly rim: readonly [Vec, Vec]
		flooded: boolean
		/** m³ of water that has come in over its rim (it fills from the bottom of its envelope, level); with `capacity` (m³: its envelope less its material) */
		water?: number
		readonly capacity?: number
		/**
		 * m³ of liquid another module keeps in it (a mug the flow module's tap fills): its weight is already in the body's mass, so it does not
		 * come off what the envelope displaces; it fills the bottom, the water that comes in over the rim rests on it, and it takes up room.
		 */
		readonly held?: number
		/** parts of it outside its envelope that displace too while it has not flooded (a mug's handle), each with its true volume's scale */
		readonly extra?: readonly FluidShape[]
	}
	/**
	 * Its true outer volume over its parts' (outline × depth, summed): what it pushes aside is scaled by this (an egg of overlapping pieces, a
	 * mug that fills with water); 1 without it.
	 */
	readonly scale?: number
}

/** What the liquids add to a body this step (N, N·m about its centre of mass), and what they found (for the track and the goals). */
export interface FluidPush {
	readonly fx: number
	readonly fy: number
	readonly torque: number
	/** m³ of it below the surface of each region it is in */
	readonly submerged: number
	/** fraction of its displacing volume below the surface (0 dry, 1 under) */
	readonly fraction: number
	/** the liquid's upward push on it, ρ·g·V summed over the layers (N; the textbook buoyancy, the air's share included) */
	readonly lift: number
	/** the region it is in, if any */
	readonly region?: string
}

// ------------------------------------------------------------------------------------------------ geometry
/** The part of a convex polygon where a·x + b·y ≤ c (Sutherland–Hodgman for one edge). */
export const clipHalf = (pts: readonly Vec[], a: number, b: number, c: number): Vec[] => {
	const out: Vec[] = []
	const n = pts.length
	for (let i = 0; i < n; i++) {
		const p = pts[i] as Vec
		const q = pts[(i + 1) % n] as Vec
		const dp = a * p.x + b * p.y - c
		const dq = a * q.x + b * q.y - c
		if (dp <= 0) out.push(p)
		if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) {
			const s = dp / (dp - dq)
			out.push({ x: p.x + s * (q.x - p.x), y: p.y + s * (q.y - p.y) })
		}
	}
	return out
}

/** A convex polygon cut to the box x0…x1, y0…y1. */
export const clipBox = (pts: readonly Vec[], x0: number, x1: number, y0: number, y1: number): Vec[] => {
	let p: Vec[] = clipHalf(pts, -1, 0, -x0)
	if (p.length > 2) p = clipHalf(p, 1, 0, x1)
	if (p.length > 2) p = clipHalf(p, 0, -1, -y0)
	if (p.length > 2) p = clipHalf(p, 0, 1, y1)
	return p.length > 2 ? p : []
}

/** A convex polygon cut to the inside of another convex polygon (counter-clockwise). */
export const clipConvex = (pts: readonly Vec[], by: readonly Vec[]): Vec[] => {
	let p: Vec[] = [...pts]
	const n = by.length
	for (let i = 0; i < n && p.length > 2; i++) {
		const a = by[i] as Vec
		const b = by[(i + 1) % n] as Vec
		// inside = left of a→b: (b − a) × (p − a) ≥ 0, i.e. −ey·x + ex·y ≥ −ey·ax + ex·ay; as a·x + b·y ≤ c:
		const ex = b.x - a.x
		const ey = b.y - a.y
		p = clipHalf(p, ey, -ex, ey * a.x - ex * a.y)
	}
	return p.length > 2 ? p : []
}

/** Area and centroid of a polygon (counter-clockwise; 0 and the first point for a degenerate one). */
export const areaOf = (pts: readonly Vec[]): { area: number; x: number; y: number } => {
	let a = 0
	let cx = 0
	let cy = 0
	const n = pts.length
	if (n < 3) return { area: 0, x: 0, y: 0 }
	// about the first point, so a small polygon far from the origin keeps its digits
	const o = pts[0] as Vec
	for (let i = 1; i < n - 1; i++) {
		const p = pts[i] as Vec
		const q = pts[i + 1] as Vec
		const px = p.x - o.x
		const py = p.y - o.y
		const qx = q.x - o.x
		const qy = q.y - o.y
		const cross = px * qy - qx * py
		a += cross
		cx += cross * (px + qx)
		cy += cross * (py + qy)
	}
	if (a === 0) return { area: 0, x: o.x, y: o.y }
	return { area: a / 2, x: o.x + cx / (3 * a), y: o.y + cy / (3 * a) }
}

/** Whether a point is inside a convex polygon (counter-clockwise), on its edge counting as inside. */
export const insideConvex = (pts: readonly Vec[], x: number, y: number): boolean => {
	const n = pts.length
	for (let i = 0; i < n; i++) {
		const a = pts[i] as Vec
		const b = pts[(i + 1) % n] as Vec
		if ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) < 0) return false
	}
	return n > 2
}

/** asin through atan2 (the engine's deterministic atan2; Math.asin is the platform's). */
const asin = (s: number) => Math.atan2(s, Math.sqrt(Math.max(0, 1 - s * s)))

/**
 * The volume of a sphere of radius r (centre at height 0) between heights z1 < z2, and its centroid's height:
 * V = π[r²z − z³/3], ∫z dV = π[r²z²/2 − z⁴/4], with z clamped to ±r.
 */
export const sphereSlice = (r: number, z1: number, z2: number): { volume: number; z: number } => {
	const a = Math.max(-r, Math.min(r, z1))
	const b = Math.max(-r, Math.min(r, z2))
	if (b <= a) return { volume: 0, z: 0 }
	const r2 = r * r
	const v = Math.PI * (r2 * (b - a) - (b * b * b - a * a * a) / 3)
	const m = Math.PI * ((r2 * (b * b - a * a)) / 2 - (b * b * b * b - a * a * a * a) / 4)
	return { volume: v, z: v > 0 ? m / v : 0 }
}

/**
 * The area of a circle of radius r (centre at height 0) between heights z1 < z2, and its centroid's height:
 * A = [z·√(r²−z²) + r²·asin(z/r)], ∫z dA = [−⅔(r²−z²)^{3/2}].
 */
export const circleSlice = (r: number, z1: number, z2: number): { area: number; z: number } => {
	const a = Math.max(-r, Math.min(r, z1))
	const b = Math.max(-r, Math.min(r, z2))
	if (b <= a) return { area: 0, z: 0 }
	const r2 = r * r
	const sa = Math.sqrt(Math.max(0, r2 - a * a))
	const sb = Math.sqrt(Math.max(0, r2 - b * b))
	const area = b * sb - a * sa + r2 * (asin(b / r) - asin(a / r))
	const m = (-2 / 3) * (sb * sb * sb - sa * sa * sa)
	return { area, z: area > 0 ? m / area : 0 }
}

// ------------------------------------------------------------------------------------------------ what a body displaces
/** The displacing shapes of a body now: its hull's envelope while it has not flooded, else its parts. */
const displacing = (b: FluidBody): readonly FluidShape[] => {
	const h = b.hull
	if (h === undefined || h.flooded) return b.parts
	const inner = innerWater(h)
	const env: FluidShape = inner === undefined ? { kind: "prism", points: h.points, depth: h.depth } : { kind: "prism", points: h.points, depth: h.depth, minus: inner }
	return h.extra === undefined || h.extra.length === 0 ? [env] : [env, ...h.extra]
}

/** The level (world y) in a hull's envelope that holds `volume` m³ from its bottom up (bisection, 32 steps). */
const levelHolding = (points: readonly Vec[], depth: number, volume: number): number => {
	let lo = Number.POSITIVE_INFINITY
	let hi = Number.NEGATIVE_INFINITY
	for (const p of points) {
		lo = Math.min(lo, p.y)
		hi = Math.max(hi, p.y)
	}
	for (let k = 0; k < 32; k++) {
		const mid = lo + (hi - lo) / 2
		if (areaOf(clipHalf(points, 0, 1, mid)).area * depth < volume) lo = mid
		else hi = mid
	}
	return lo + (hi - lo) / 2
}

/** The water inside a hull: the part of its envelope under the level that holds `water` (bisection on that level), or undefined (dry). */
const innerWater = (h: NonNullable<FluidBody["hull"]>): Vec[] | undefined => {
	const w = h.water ?? 0
	if (!(w > 0)) return undefined
	const held = h.held ?? 0
	if (held > 0) {
		// (on top of what another module keeps in it: between the level that holds that and the level that holds both)
		const full = areaOf(h.points).area * h.depth
		const y0 = held >= full ? Number.POSITIVE_INFINITY : levelHolding(h.points, h.depth, held)
		if (!Number.isFinite(y0)) return undefined
		const y1 = held + w >= full ? Number.POSITIVE_INFINITY : levelHolding(h.points, h.depth, held + w)
		const below = Number.isFinite(y1) ? clipHalf(h.points, 0, 1, y1) : [...h.points]
		const cut = below.length > 2 ? clipHalf(below, 0, -1, -y0) : []
		return cut.length > 2 ? cut : undefined
	}
	let lo = Number.POSITIVE_INFINITY
	let hi = Number.NEGATIVE_INFINITY
	for (const p of h.points) {
		lo = Math.min(lo, p.y)
		hi = Math.max(hi, p.y)
	}
	const full = areaOf(h.points).area * h.depth
	if (w >= full) return [...h.points]
	for (let k = 0; k < 32; k++) {
		const mid = lo + (hi - lo) / 2
		if (areaOf(clipHalf(h.points, 0, 1, mid)).area * h.depth < w) lo = mid
		else hi = mid
	}
	const cut = clipHalf(h.points, 0, 1, lo + (hi - lo) / 2)
	return cut.length > 2 ? cut : undefined
}

/** The dry hollows of other bodies (unflooded hulls) a part may sit in: inside them it is not in the liquid. */
type Hollow = { readonly key: number; readonly points: readonly Vec[] }

/** The volume of a shape inside the box x0…x1 between heights y0…y1, less what of it is in a dry hollow; and its centroid. */
const shapeIn = (s: FluidShape, x0: number, x1: number, y0: number, y1: number, hollows: readonly Hollow[], self: number) => {
	if (s.kind === "prism") {
		const cut = clipBox(s.points, x0, x1, y0, y1)
		if (cut.length === 0) return { volume: 0, x: 0, y: 0 }
		const whole = areaOf(cut)
		let area = whole.area
		let mx = whole.area * whole.x
		let my = whole.area * whole.y
		if (s.minus !== undefined) {
			const wet = areaOf(clipBox(s.minus, x0, x1, y0, y1))
			area -= wet.area
			mx -= wet.area * wet.x
			my -= wet.area * wet.y
		}
		for (const h of hollows) {
			if (h.key === self) continue
			const dry = clipConvex(cut, h.points)
			if (dry.length === 0) continue
			const d = areaOf(dry)
			area -= d.area
			mx -= d.area * d.x
			my -= d.area * d.y
		}
		if (!(area > 1e-15)) return { volume: 0, x: 0, y: 0 }
		return { volume: s.scale === undefined ? area * s.depth : area * s.depth * s.scale, x: mx / area, y: my / area }
	}
	if (s.x < x0 || s.x > x1) return { volume: 0, x: 0, y: 0 }
	for (const h of hollows) if (h.key !== self && insideConvex(h.points, s.x, s.y)) return { volume: 0, x: 0, y: 0 }
	if (s.kind === "sphere") {
		const cut = sphereSlice(s.r, y0 - s.y, y1 - s.y)
		return { volume: cut.volume, x: s.x, y: s.y + cut.z }
	}
	const cut = circleSlice(s.r, y0 - s.y, y1 - s.y)
	return { volume: cut.area * s.length, x: s.x, y: s.y + cut.z }
}

/** A shape's whole displacing volume, m³. */
const shapeVolume = (s: FluidShape) =>
	s.kind === "sphere"
		? (4 / 3) * Math.PI * s.r * s.r * s.r
		: s.kind === "cylinder"
			? Math.PI * s.r * s.r * s.length
			: (areaOf(s.points).area - (s.minus === undefined ? 0 : areaOf(s.minus).area)) * s.depth * (s.scale === undefined ? 1 : s.scale)

/** A shape's vertical extent (world). */
const extentY = (s: FluidShape): [number, number] => {
	if (s.kind !== "prism") return [s.y - s.r, s.y + s.r]
	let lo = Number.POSITIVE_INFINITY
	let hi = Number.NEGATIVE_INFINITY
	for (const p of s.points) {
		lo = Math.min(lo, p.y)
		hi = Math.max(hi, p.y)
	}
	return [lo, hi]
}
const extentX = (s: FluidShape): [number, number] => {
	if (s.kind !== "prism") return [s.x - s.r, s.x + s.r]
	let lo = Number.POSITIVE_INFINITY
	let hi = Number.NEGATIVE_INFINITY
	for (const p of s.points) {
		lo = Math.min(lo, p.x)
		hi = Math.max(hi, p.x)
	}
	return [lo, hi]
}

// ------------------------------------------------------------------------------------------------ the levels
/** A container's state through a run: each layer's liquid volume (m³; it only shrinks, by spilling) and what has spilled. */
export interface RegionState {
	readonly region: FluidRegion
	readonly volumes: number[]
	spilled: number
	/** each layer's top now (world y), bottom first */
	tops: number[]
}

export const regionState = (region: FluidRegion): RegionState => {
	const volumes = region.layers.map((l) => Math.max(0, l.height) * region.area)
	let y = region.floor
	const tops = region.layers.map((l) => (y += Math.max(0, l.height)))
	return { region, volumes, spilled: 0, tops }
}

/** Every displacing shape of these bodies that reaches into the region's walls, with its body's key. */
const shapesIn = (region: FluidRegion, bodies: readonly FluidBody[]) => {
	const out: { key: number; s: FluidShape; k: number }[] = []
	for (const b of bodies)
		for (const s of displacing(b)) {
			const [x0, x1] = extentX(s)
			const [y0] = extentY(s)
			if (x1 < region.x0 || x0 > region.x1 || y0 > region.rim) continue
			out.push({ key: b.key, s, k: b.hull !== undefined && !b.hull.flooded ? 1 : (b.scale ?? 1) })
		}
	return out
}

/** The bodies' volume in the region between heights y0 and y1. */
const displacedIn = (region: FluidRegion, shapes: readonly { key: number; s: FluidShape; k: number }[], hollows: readonly Hollow[], y0: number, y1: number) => {
	let v = 0
	for (const { key, s, k } of shapes) v += k * shapeIn(s, region.x0, region.x1, y0, y1, hollows, key).volume
	return v
}

/** Bisections for a layer's top: 2⁻³² of the rise the bodies could make, far below a micrometre in any container of a scene. */
const LEVEL_STEPS = 32

/**
 * Each layer's top with the bodies where they are now: the height t over the layer's bottom b where the liquid's own
 * volume and the bodies' volume between b and t fill the container's cross-section, area·(t − b) = V + V_bodies(b, t)
 * (bisection: the left side grows faster than the right while the bodies fit inside the walls). More than fits under the
 * rim spills, from the top layer down.
 */
export const updateLevels = (st: RegionState, bodies: readonly FluidBody[], hollows: readonly Hollow[]) => {
	const r = st.region
	const shapes = shapesIn(r, bodies)
	// what fits under the rim, with the bodies as they are: more spills, from the top down
	const total = st.volumes.reduce((a, b) => a + b, 0)
	const fits = r.area * (r.rim - r.floor) - displacedIn(r, shapes, hollows, r.floor, r.rim)
	if (total > fits) {
		let spill = total - Math.max(0, fits)
		for (let i = st.volumes.length - 1; i >= 0 && spill > 0; i--) {
			const take = Math.min(st.volumes[i] as number, spill)
			st.volumes[i] = (st.volumes[i] as number) - take
			spill -= take
			st.spilled += take
		}
	}
	let bottom = r.floor
	const tops: number[] = []
	for (let i = 0; i < st.volumes.length; i++) {
		const v = st.volumes[i] as number
		if (!(v > 0)) {
			tops.push(bottom)
			continue
		}
		// the level lies between the liquid alone (lo) and the liquid with every body below the rim pushed under (hi)
		let lo = bottom + v / r.area
		if (shapes.length === 0) {
			tops.push(lo)
			bottom = lo
			continue
		}
		let hi = Math.min(r.rim, lo + displacedIn(r, shapes, hollows, bottom, r.rim) / r.area)
		if (hi < lo) hi = lo
		for (let k = 0; k < LEVEL_STEPS; k++) {
			const mid = lo + (hi - lo) / 2
			if (r.area * (mid - bottom) - displacedIn(r, shapes, hollows, bottom, mid) < v) lo = mid
			else hi = mid
		}
		const top = lo + (hi - lo) / 2
		tops.push(top)
		bottom = top
	}
	st.tops = tops
}

// ------------------------------------------------------------------------------------------------ drag laws
/**
 * A sphere's drag coefficient at Reynolds number Re (Clift & Gauvin 1970, within about 6 % of measurements up to Re 3·10⁵):
 * C_d = 24/Re·(1 + 0.15·Re^0.687) + 0.42/(1 + 42500·Re^−1.16). Returned as C_d·Re/24 and C_d (the first stays finite as Re → 0).
 */
export const sphereDrag = (re: number): number => {
	if (!(re > 0)) return Number.POSITIVE_INFINITY
	return (24 / re) * (1 + 0.15 * Math.pow(re, 0.687)) + 0.42 / (1 + 42500 * Math.pow(re, -1.16))
}

/**
 * The drag on a sphere of radius r moving at speed u through a liquid (ρ, μ) as a coefficient c: F = −c·v (N·s/m). From the
 * Clift & Gauvin curve, written so it is finite at rest: c = 6πμr·(1 + 0.15·Re^0.687) + ½ρ·πr²·u·0.42/(1 + 42500·Re^−1.16).
 */
export const sphereDragCoefficient = (r: number, u: number, rho: number, mu: number): number => {
	const re = (rho * u * 2 * r) / mu
	const stokes = 6 * Math.PI * mu * r
	if (!(re > 0)) return stokes
	return stokes * (1 + 0.15 * Math.pow(re, 0.687)) + (0.5 * rho * Math.PI * r * r * u * 0.42) / (1 + 42500 * Math.pow(re, -1.16))
}

/**
 * A viscous drag coefficient for a block or a cylinder of submerged volume V: Stokes' 3πμd on the sphere of that volume (d its
 * diameter) with Schiller & Naumann's correction (1 + 0.15·Re^0.687), which carries the skin friction at higher Re; the block's
 * form drag is the Newton flat-plate drag over its outline, added to this.
 */
export const viscousCoefficient = (volume: number, u: number, rho: number, mu: number): number => {
	if (!(volume > 0) || !(mu > 0)) return 0
	const d = Math.pow((6 * volume) / Math.PI, 1 / 3)
	const re = (rho * u * d) / mu
	return 3 * Math.PI * mu * d * (re > 0 ? 1 + 0.15 * Math.pow(re, 0.687) : 1)
}

/**
 * Newton's flat-plate drag on the wet stretch of one side of an outline: the side from P to Q (world), outward normal n, the
 * body's centre of mass c moving at v and turning at w through still liquid; only the stretch s0…s1 of it (0 at P, 1 at Q) is in
 * this layer. Each bit facing into the flow meets −k·(u·n)·u·ds, k = ½·ρ·C_d·depth (the engine's air drag, outlineDrag, the same
 * way). Adds into acc: fx, fy, torque about c.
 */
const sideDrag = (
	px: number,
	py: number,
	qx: number,
	qy: number,
	s0: number,
	s1: number,
	c: Vec,
	v: Vec,
	w: number,
	k: number,
	acc: { fx: number; fy: number; torque: number }
) => {
	const ex = qx - px
	const ey = qy - py
	const length = Math.sqrt(ex * ex + ey * ey)
	if (length === 0 || s1 <= s0) return
	const nx = ey / length
	const ny = -ex / length
	const rx = px - c.x
	const ry = py - c.y
	const u0x = v.x - w * ry
	const u0y = v.y + w * rx
	const u1x = -w * ey
	const u1y = w * ex
	const a = u0x * nx + u0y * ny
	const b = u1x * nx + u1y * ny
	let t0 = s0
	let t1 = s1
	if (b === 0) {
		if (a <= 0) return
	} else {
		const root = -a / b
		if (b > 0) t0 = Math.max(t0, root)
		else t1 = Math.min(t1, root)
		if (t1 <= t0) return
	}
	const d1 = t1 - t0
	const d2 = (t1 * t1 - t0 * t0) / 2
	const d3 = (t1 * t1 * t1 - t0 * t0 * t0) / 3
	const d4 = (t1 * t1 * t1 * t1 - t0 * t0 * t0 * t0) / 4
	const i0 = a * d1 + b * d2
	const i1 = a * d2 + b * d3
	const i2 = a * d3 + b * d4
	const scale = -k * length
	acc.fx += scale * (u0x * i0 + u1x * i1)
	acc.fy += scale * (u0y * i0 + u1y * i1)
	acc.torque += scale * ((rx * u0y - ry * u0x) * i0 + (rx * u1y - ry * u1x + ex * u0y - ey * u0x) * i1 + (ex * u1y - ey * u1x) * i2)
}

/** The stretch s0…s1 (0 at P, 1 at Q) of a segment inside a box (Liang–Barsky), or undefined. */
export const segmentInBox = (px: number, py: number, qx: number, qy: number, x0: number, x1: number, y0: number, y1: number) => {
	let s0 = 0
	let s1 = 1
	const dx = qx - px
	const dy = qy - py
	const edges: [number, number][] = [
		[-dx, px - x0],
		[dx, x1 - px],
		[-dy, py - y0],
		[dy, y1 - py]
	]
	for (const [p, q] of edges) {
		if (p === 0) {
			if (q < 0) return undefined
			continue
		}
		const r = q / p
		if (p < 0) {
			if (r > s1) return undefined
			if (r > s0) s0 = r
		} else {
			if (r < s0) return undefined
			if (r < s1) s1 = r
		}
	}
	return s1 > s0 ? ([s0, s1] as const) : undefined
}

/** The width of a convex outline at height y (its waterline there), m. */
const widthAt = (pts: readonly Vec[], y: number, x0: number, x1: number) => {
	let lo = Number.POSITIVE_INFINITY
	let hi = Number.NEGATIVE_INFINITY
	const n = pts.length
	for (let i = 0; i < n; i++) {
		const p = pts[i] as Vec
		const q = pts[(i + 1) % n] as Vec
		if ((p.y - y) * (q.y - y) > 0 || p.y === q.y) continue
		const x = p.x + ((y - p.y) / (q.y - p.y)) * (q.x - p.x)
		lo = Math.min(lo, x)
		hi = Math.max(hi, x)
	}
	lo = Math.max(lo, x0)
	hi = Math.min(hi, x1)
	return hi > lo ? hi - lo : 0
}

// ------------------------------------------------------------------------------------------------ one step
/** Hulls that have not flooded: dry hollows other bodies may sit in. */
export const hollowsOf = (bodies: readonly FluidBody[]): Hollow[] =>
	bodies.flatMap((b) => (b.hull !== undefined && !b.hull.flooded ? [{ key: b.key, points: b.hull.points }] : []))

/**
 * Water pours into a hull over any corner of its opening that is under a surface, as over a weir: Q = C_d·(2/3)·√(2g)·b·δ^{3/2} for a corner
 * δ under, b its front-to-back width, C_d 0.6 (a sharp-crested weir: White, Fluid Mechanics, §10.7). A momentary dip lets in a few drops; a rim
 * held under fills it in a fraction of a second. Full (its envelope less its material), it has flooded: it displaces only its material from then
 * on, and never empties.
 */
export const floodHulls = (states: readonly RegionState[], bodies: readonly FluidBody[], h = 0, g = G) => {
	for (const b of bodies) {
		const hull = b.hull
		if (hull === undefined || hull.flooded) continue
		let q = 0
		let under = 0
		for (const st of states) {
			const r = st.region
			const top = st.tops.at(-1) ?? r.floor
			for (const p of hull.rim) {
				if (p.x < r.x0 || p.x > r.x1 || p.y <= r.floor - 1e-9 || !(p.y < top)) continue
				const d = top - p.y
				under++
				q += 0.6 * (2 / 3) * Math.sqrt(2 * g) * hull.depth * d * Math.sqrt(d)
			}
		}
		if (!(q > 0)) continue
		hull.water = (hull.water ?? 0) + q * h
		// (its room: the capacity less what another module keeps in it, a mug's tap water)
		const room = (hull.held ?? 0) > 0 ? (hull.capacity ?? Number.POSITIVE_INFINITY) - (hull.held as number) : (hull.capacity ?? Number.POSITIVE_INFINITY)
		// (no step given: an old caller asking whether it floods at all; and a rim held under with no room left)
		if (h === 0 || hull.water >= room || (under === 2 && hull.capacity === undefined)) hull.flooded = true
	}
}

/**
 * The liquids' push on every body this step. `h` is the (sub-)step. Every force but the explicit ones is solved implicitly
 * with the body's mass and, while free, its added mass, so that gravity, the air's pushes (`force`), buoyancy and the liquid's
 * drag together move it as they would move a body of mass m + m_a; the engine applies what is returned with mass m.
 */
/** The run's gravity (m/s²) and air density (kg/m³: the air the engine already lifts every body by; 0 in a vacuum). */
export interface FluidEnv {
	readonly g: number
	readonly air: number
}
export const STANDARD_ENV: FluidEnv = { g: G, air: AIR }

export const fluidPushes = (states: readonly RegionState[], bodies: readonly FluidBody[], h: number, env: FluidEnv = STANDARD_ENV): Map<number, FluidPush> => {
	const out = new Map<number, FluidPush>()
	const g = env.g
	const hollows = hollowsOf(bodies)
	for (const b of bodies) {
		let fbx = 0
		let fby = 0
		let tb = 0
		const form = { fx: 0, fy: 0, torque: 0 }
		let cx = 0 // linear drag coefficients, N·s/m (x, y) and N·m·s (turning)
		let cy = 0
		let cr = 0
		let added = 0
		let submerged = 0
		let liquidLift = 0
		let region: string | undefined
		const shapes = displacing(b)
		const k = b.hull !== undefined && !b.hull.flooded ? 1 : (b.scale ?? 1)
		let whole = 0
		for (const s of shapes) whole += k * shapeVolume(s)
		const speed = Math.sqrt(b.v.x * b.v.x + b.v.y * b.v.y)
		for (const st of states) {
			const r = st.region
			let bottom = r.floor
			for (let i = 0; i < r.layers.length; i++) {
				const layer = r.layers[i] as FluidLayer
				const top = st.tops[i] as number
				if (!(top > bottom)) continue
				const rho = layer.density
				const mu = layer.viscosity
				for (const s of shapes) {
					const cut = shapeIn(s, r.x0, r.x1, bottom, top, hollows, b.key)
					if (!(cut.volume > 0)) continue
					const sub = { volume: k * cut.volume, x: cut.x, y: cut.y }
					region = r.id
					submerged += sub.volume
					// buoyancy (the air's share of it the engine already gave is taken off), at the wet volume's centroid
					const lift = (rho - env.air) * g * sub.volume
					fby += lift
					liquidLift += rho * g * sub.volume
					tb += (sub.x - b.com.x) * lift
					if (s.kind === "sphere") {
						const share = cut.volume / ((4 / 3) * Math.PI * s.r * s.r * s.r)
						const c = sphereDragCoefficient(s.r, speed, rho, mu) * share
						cx += c
						cy += c
						cr += 8 * Math.PI * mu * s.r * s.r * s.r * share
						added += ADDED_MASS.sphere * rho * sub.volume
					} else if (s.kind === "cylinder") {
						const share = cut.volume / (Math.PI * s.r * s.r * s.length)
						// across the flow: C_d about 1.1 (the engine's air value) on 2r·length, and the viscous drag of its volume
						const form = 0.5 * rho * 1.1 * 2 * s.r * s.length * speed * share
						const c = form + viscousCoefficient(sub.volume, speed, rho, mu)
						cx += c
						cy += c
						cr += 4 * Math.PI * mu * s.r * s.r * s.length * share
						added += ADDED_MASS.cylinder * rho * sub.volume
					} else {
						// form drag side by side on the wet part of the outline, at the body's own motion
						const kd = 0.5 * rho * BLOCK_DRAG * s.depth
						const n = s.points.length
						for (let j = 0; j < n; j++) {
							const p = s.points[j] as Vec
							const q = s.points[(j + 1) % n] as Vec
							const span = segmentInBox(p.x, p.y, q.x, q.y, r.x0, r.x1, bottom, top)
							if (span === undefined) continue
							sideDrag(p.x, p.y, q.x, q.y, span[0], span[1], b.com, b.v, b.w, kd, form)
						}
						const c = viscousCoefficient(sub.volume, speed, rho, mu)
						cx += c
						cy += c
						cr += c * (sub.volume / Math.max(1e-12, s.depth)) // a viscous couple of the wet section's own size, provisional
						added += ADDED_MASS.prism * rho * sub.volume
					}
				}
				bottom = top
			}
			// waves: a body piercing a surface (the top one, or an interface between two layers) bobs and rocks against that surface's
			// stiffness, (ρ below − ρ above)·g·A of its waterline, and the waves it makes damp that at WAVE_DAMPING
			if (region === r.id) {
				let kHeave = 0
				let kRoll = 0
				for (let i = 0; i < r.layers.length; i++) {
					const top = st.tops[i] as number
					const below = (r.layers[i] as FluidLayer).density
					const above = i + 1 < r.layers.length ? (r.layers[i + 1] as FluidLayer).density : env.air
					const jump = below - above
					if (!(jump > 0) || !((st.volumes[i] as number) > 0)) continue
					for (const s of shapes) {
						if (s.kind === "prism") {
							const wl = widthAt(s.points, top, r.x0, r.x1)
							kHeave += jump * g * wl * s.depth
							kRoll += (jump * g * s.depth * wl * wl * wl) / 12
						} else if (Math.abs(top - s.y) < s.r && s.x >= r.x0 && s.x <= r.x1) {
							const half = Math.sqrt(s.r * s.r - (top - s.y) * (top - s.y))
							kHeave += jump * g * (s.kind === "sphere" ? Math.PI * half * half : 2 * half * s.length)
						}
					}
				}
				if (kHeave > 0) cy += 2 * WAVE_DAMPING * Math.sqrt(k * kHeave * (b.mass + added))
				if (kRoll > 0 && b.inertia > 0) cr += 2 * WAVE_DAMPING * Math.sqrt(k * kRoll * b.inertia)
			}
		}
		if (!(submerged > 0)) continue
		// the form drag is explicit: a share over half of the body's motion taken in one step is scaled down, as the engine's air drag
		const motion = b.mass * (b.v.x * b.v.x + b.v.y * b.v.y) + b.inertia * b.w * b.w
		const share = motion > 0 ? (-(form.fx * b.v.x + form.fy * b.v.y + form.torque * b.w) * h) / motion : 0
		const scale = share > 0.5 ? 1 / (share + 0.5) : 1
		const ex = fbx + form.fx * scale
		const ey = fby + form.fy * scale
		const et = tb + form.torque * scale
		let fx: number
		let fy: number
		let torque: number
		if (b.free) {
			// (m + m_a)·(v' − v)/h = m·g + force + explicit − c·v'  →  what to add so that a body of mass m moves so (its weight stays m·g)
			const m = b.mass
			const M = m + added
			const vx = (M * b.v.x + h * (b.force.x + ex)) / (M + h * cx)
			const vy = (M * b.v.y + h * (b.force.y - m * g + ey)) / (M + h * cy)
			fx = (m * (vx - b.v.x)) / h - b.force.x
			fy = (m * (vy - b.v.y)) / h - b.force.y + m * g
			// its turning: I·(ω' − ω)/h = torque + explicit − c_r·ω' (no added inertia of turning: provisional)
			torque = b.inertia > 0 ? et - (cr * (b.inertia * b.w + h * (b.torque + et))) / (b.inertia + h * cr) : et
		} else {
			// touching or held: the linear drag on the motion it has now, limited so that one step never reverses it (at rest it is none,
			// so a body lying on the floor presses on it with its whole weight less its buoyancy)
			fx = ex - (cx * b.v.x) / (1 + (h * cx) / b.mass)
			fy = ey - (cy * b.v.y) / (1 + (h * cy) / b.mass)
			torque = b.inertia > 0 ? et - (cr * b.w) / (1 + (h * cr) / b.inertia) : et
		}
		out.set(b.key, { fx, fy, torque, submerged, lift: liquidLift, fraction: whole > 0 ? Math.min(1, submerged / whole) : 0, ...(region === undefined ? {} : { region }) })
	}
	return out
}

// ------------------------------------------------------------------------------------------------ surface tension
/** Water's surface tension at 20 °C, N/m (IAPWS 2014: 72.74 mN/m): a layer without its own `tension` (one another module poured in) takes it. */
export const WATER_TENSION = 0.0728

/**
 * What a liquid's surface does to a thin thing laid on it, at one point of its contact line: the surface is pushed down `d` (m) under its level
 * there (0 or less: the thing is above it, no pull). A 2D meniscus pushed down d meets the thing at a slope φ with d = 2·l_c·sin(φ/2),
 * l_c = √(γ/(Δρ·g)) the capillary length (2.7 mm for water), and pulls it up γ·sin φ per metre of contact line (Adamson & Gast, Physical
 * Chemistry of Surfaces, 1997); the slope can reach the contact angle θ at most: deeper than d_max = 2·l_c·sin(θ/2), the meniscus lets go
 * and the liquid closes over it (`broken`). -> {pull (N per metre of contact line), broken, lc (m)}.
 */
export const meniscusPull = (d: number, gamma: number, drho: number, g: number, thetaDeg: number): { pull: number; broken: boolean; lc: number } => {
	if (!(gamma > 0) || !(drho > 0) || !(g > 0)) return { pull: 0, broken: d > 0, lc: 0 }
	const lc = Math.sqrt(gamma / (drho * g))
	const u = d / (2 * lc)
	const umax = Math.sin(((Math.min(180, Math.max(0, thetaDeg)) / 2) * Math.PI) / 180)
	if (u > umax) return { pull: 0, broken: true, lc }
	if (!(u > 0)) return { pull: 0, broken: false, lc }
	// sin φ = 2·sin(φ/2)·cos(φ/2) = 2u·√(1 − u²)
	return { pull: gamma * 2 * u * Math.sqrt(Math.max(0, 1 - u * u)), broken: false, lc }
}

/**
 * The energy (J) a surface can take from a thin thing hitting it before it lets go: the pull's work down to the deepest dent,
 * ∫ γ·C·sin φ dd = γ·C·2·l_c·(2/3)·(1 − (1 − u²)^{3/2}) with u = sin(θ/2), less the thing's own weight's work over that depth (C its contact
 * line, m its mass): a thing that arrives with more kinetic energy breaks through (a paper clip dropped from more than a few millimetres sinks;
 * laid gently it floats).
 */
export const surfaceHoldEnergy = (gamma: number, drho: number, g: number, thetaDeg: number, contact: number, mass: number) => {
	if (!(gamma > 0) || !(drho > 0) || !(g > 0)) return 0
	const lc = Math.sqrt(gamma / (drho * g))
	const u = Math.sin(((Math.min(180, Math.max(0, thetaDeg)) / 2) * Math.PI) / 180)
	const c = Math.max(0, 1 - u * u)
	return gamma * contact * 2 * lc * (2 / 3) * (1 - c * Math.sqrt(c)) - mass * g * 2 * lc * u
}

/** Jurin's law: how high a liquid stands in a tube of inner radius r over the surface outside, h = 2γ·cosθ/(ρ·g·r) (m). */
export const jurinRise = (gamma: number, thetaDeg: number, rho: number, g: number, r: number) =>
	(2 * gamma * Math.cos((thetaDeg * Math.PI) / 180)) / (rho * g * r)

/**
 * One step of a liquid column climbing a tube of radius r (Washburn's balance: Poiseuille flow along the wetted length L, driven by the pull
 * 2γ·cosθ/r against the column's weight ρ·g·z), implicit in the weight so any step is stable, and never faster than the inertial capillary speed
 * √(2γ·cosθ/(ρ·r)) (Quéré, Europhys. Lett. 39, 533, 1997). z: the column's height over the outside surface now (m); L: the tube's length under it.
 */
export const capillaryStep = (z: number, L: number, h: number, gamma: number, thetaDeg: number, rho: number, mu: number, g: number, r: number) => {
	const drive = (2 * gamma * Math.cos((thetaDeg * Math.PI) / 180)) / r
	const a = (r * r) / (8 * Math.max(1e-9, mu) * Math.max(1e-4, z + L))
	const next = (z + h * a * drive) / (1 + h * a * rho * g)
	const vmax = Math.sqrt(Math.max(0, drive) / Math.max(1e-9, rho)) * h
	return Math.min(z + vmax, Math.max(z - vmax, next))
}
