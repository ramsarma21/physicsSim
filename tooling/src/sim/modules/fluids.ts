/**
 * The liquids module (engine side): containers of water, oil, salt water, syrup ... fixed on the table, and what they do to the bodies in
 * them. The physics is tooling/src/sim/fluids.ts; this file runs it through the plugin framework (tooling/src/sim/plugins.ts). Records
 * (doc.processes, made by machines/mod_fluids.py and its port web/sim/modules/fluids.js):
 *   {kind: "liquid", id, item, x0, x1, floor, rim, area, layers: [{words, density, viscosity, height}]}
 *       a fixed container's liquid in the world: inner walls x0…x1, inner floor and rim (m), horizontal cross-section (m²), layers bottom
 *       first (kg/m³, Pa·s, m of depth with nothing in it).
 *   {kind: "hull", id, item, solid, points: [{x, y}], rim: [i, j], depth, material_ml?}
 *       an open boat's envelope in its solid's own frame (convex, counter-clockwise), the two corners of its opening and its front-to-back
 *       size: it displaces the whole envelope until water rises over its opening; then it floods (and never empties) and displaces only its
 *       material's own volume (material_ml: the real clay's or foil's, not its drawn slabs').
 *   {kind: "sail", id, item, solid, area, push}
 *       a sail (readings only: the engine's air drag on the sail's slab is what pushes it): its area (m²) and push coefficient.
 *   {kind: "displace", id, item, volume_ml}
 *       an item whose outline × depth is not its volume (an egg's overlapping pieces, a mug that fills): what it pushes aside is scaled to this.
 * All of a run's liquids are worked by ONE of these processes (the first in the document), once a (sub-)step: the levels with the bodies
 * where they are, the floods, then each body's push (fluids.ts fluidPushes), with the run's gravity and air.
 * Readings (track.state, per frame):
 *   a container: level_mm (its top surface over its inner floor), volume_ml (what a scale on its wall reads: liquid and whatever is under
 *   the surface), spilled_ml (gone over the rim); with several layers also layer1_mm … (each layer's top over the floor, bottom first);
 *   a moving item that is or has been in a liquid: submerged (0…1 of its displacing volume under the surface), buoyancy_n (the liquid's
 *   push, ρ·g·V), afloat (1 while the liquid holds up at least 97 % of its weight, smoothed over a quarter second, unless it rests wholly
 *   under, held up by less than its weight: 2026-10-20), sunk (1 while it rests on something, rising or falling slower than 2 cm/s (rolling
 *   along the bottom counts), the liquid holding up less than 97 %, or it wholly under and less than its weight), draft_mm (its lowest
 *   point under the surface); a hull also flooded (1
 *   once water has poured in) and freeboard_mm (its opening above the surface);
 *   a sailboat: air_ms (the air's speed at its sail, along x), push_n (the sail's push along x: ½ρ·C·A·|u|·u, u the air past the sail).
 *   {kind: "surface", id, item, solid, contact_m, theta}
 *       a thin thing the surface holds up when laid gently (a paper clip's part): its contact line (m, both sides of its wire) and its contact
 *       angle with water (degrees); the liquid's layers then carry `tension` (N/m) and `wets` (the largest contact angle it allows, degrees).
 *   {kind: "soap", id, item, x, y, at, tension, wets, spread}
 *       a drop of soap let fall at `at` from (x, y) onto the liquid below: from where it lands the surface's tension is `tension` (and its
 *       contact angles at most `wets`) out to spread·t^(3/4) m (Jensen 1995).
 *   {kind: "capillary", id, item, x, bottom, top, r, theta}
 *       a fixed thin tube (inner radius r) standing from `bottom` to `top` at x: the liquid climbs it (Jurin, Washburn).
 *   {kind: "wick", id, item, x, bottom, top, D, hmax}
 *       a strip of paper hanging from `top` to `bottom` at x: the liquid climbs it as h² = D·t for water (D ∝ γ/μ), slowing toward hmax.
 * Readings of these: a held part's item surface_mn (the surface's pull, mN) and on_surface (1 while held); a soap's spread_cm and landed;
 * a tube's rise_mm; a strip's wet_mm. Events: "<item> breaks through the surface" (the surface lets a held part go).
 * Events: "<item> fills with water and sinks" (a hull floods), "<container> overflows".
 */
import {
	capillaryStep,
	type FluidBody,
	type FluidLayer,
	type FluidRegion,
	type FluidShape,
	floodHulls,
	fluidPushes,
	hollowsOf,
	meniscusPull,
	type RegionState,
	surfaceHoldEnergy,
	regionState,
	updateLevels,
	WATER_TENSION
} from "#sim/fluids.ts"
import { type SimScene, type SolidPart, volume } from "#sim/part.ts"
import type { Point, ProcessContext, ProcessKind, ProcessRecord, SolidHandle } from "#sim/plugins.ts"

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)
const isPoint = (p: unknown): p is Point => typeof p === "object" && p !== null && finite((p as Point).x) && finite((p as Point).y)

/** Why a liquid record cannot run, or undefined. */
const liquidProblem = (r: ProcessRecord): string | undefined => {
	for (const k of ["x0", "x1", "floor", "rim", "area"] as const) if (!finite(r[k])) return `${k} must be a number (m)`
	if (!((r.x1 as number) > (r.x0 as number))) return "x1 must be right of x0"
	if (!((r.rim as number) > (r.floor as number))) return "the rim must be above the floor"
	if (!((r.area as number) > 0)) return "the cross-section (area, m²) must be more than 0"
	const layers = r.layers
	if (!Array.isArray(layers) || layers.length > 8) return "layers must list up to 8 liquids, bottom first"
	for (const [i, l] of layers.entries()) {
		const L = l as Partial<FluidLayer>
		if (typeof L.words !== "string") return `layer ${i + 1} needs words (what the liquid is)`
		if (!finite(L.density) || L.density <= 0 || L.density > 25000) return `layer ${i + 1}: density must be a number from 0 to 25000 kg/m³`
		if (!finite(L.viscosity) || L.viscosity < 0 || L.viscosity > 1e6) return `layer ${i + 1}: viscosity must be a number from 0 to 10⁶ Pa·s`
		if (!finite(L.height) || L.height < 0 || L.height > 100) return `layer ${i + 1}: height must be a number of metres from 0 to 100`
	}
	return undefined
}

/** Why a hull record cannot run, or undefined. */
const hullProblem = (r: ProcessRecord, solids: ReadonlySet<string>): string | undefined => {
	if (typeof r.solid !== "string" || !solids.has(r.solid)) return `its solid (${String(r.solid)}) is not in the document`
	const pts = r.points
	if (!Array.isArray(pts) || pts.length < 3 || pts.length > 8 || !pts.every(isPoint)) return "points must be 3 to 8 {x, y} (the envelope, counter-clockwise)"
	let turn = 0
	for (let i = 0; i < pts.length; i++) {
		const a = pts[i] as Point
		const b = pts[(i + 1) % pts.length] as Point
		const c = pts[(i + 2) % pts.length] as Point
		const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
		if (cross <= 0) return "points must run counter-clockwise round a convex outline"
		turn += cross
	}
	void turn
	const rim = r.rim
	if (!Array.isArray(rim) || rim.length !== 2 || !rim.every((i) => Number.isInteger(i) && i >= 0 && i < pts.length)) return "rim must be two indices into points"
	if (!finite(r.depth) || !((r.depth as number) > 0)) return "depth must be a number of metres, more than 0"
	return undefined
}

const between = (v: unknown, lo: number, hi: number) => finite(v) && v >= lo && v <= hi
/** Why a surface, soap, capillary or wick record cannot run, or undefined. */
const surfaceProblem = (r: ProcessRecord, solids: ReadonlySet<string>): string | undefined => {
	if (typeof r.solid !== "string" || !solids.has(r.solid)) return `its solid (${String(r.solid)}) is not in the document`
	if (!between(r.contact_m, 1e-6, 100)) return "contact_m must be a number of metres, more than 0"
	return between(r.theta, 0, 180) ? undefined : "theta must be an angle from 0 to 180°"
}
const soapProblem = (r: ProcessRecord): string | undefined => {
	for (const k of ["x", "y", "at"] as const) if (!finite(r[k])) return `${k} must be a number`
	if (!between(r.tension, 0, 1)) return "tension must be a number of N/m from 0 to 1"
	if (!between(r.wets, 0, 180)) return "wets must be an angle from 0 to 180°"
	return between(r.spread, 0, 100) ? undefined : "spread must be a number of metres, 0 or more"
}
const tubeProblem = (r: ProcessRecord): string | undefined => {
	for (const k of ["x", "bottom", "top"] as const) if (!finite(r[k])) return `${k} must be a number (m)`
	if (!((r.top as number) > (r.bottom as number))) return "its top must be above its bottom"
	if (r.kind === "capillary") return between(r.r, 1e-6, 0.05) && between(r.theta, 0, 180) ? undefined : "r must be a radius from 1 µm to 5 cm and theta an angle"
	return between(r.D, 1e-12, 1) && between(r.hmax, 1e-4, 100) ? undefined : "D must be a number of m²/s and hmax a height in metres"
}

/** Why a sail record cannot run, or undefined. */
const displaceProblem = (r: ProcessRecord): string | undefined =>
	finite(r.volume_ml) && (r.volume_ml as number) > 0 && (r.volume_ml as number) < 1e9 ? undefined : "volume_ml must be a number of mL, more than 0"

const sailProblem = (r: ProcessRecord, solids: ReadonlySet<string>): string | undefined => {
	if (typeof r.solid !== "string" || !solids.has(r.solid)) return `its solid (${String(r.solid)}) is not in the document`
	if (!finite(r.area) || !((r.area as number) > 0)) return "area must be a number of m², more than 0"
	if (!finite(r.push) || !((r.push as number) >= 0)) return "push must be a number, 0 or more"
	return undefined
}

const itemOf = (id: string) => (id.includes("/") ? id.slice(0, id.indexOf("/")) : id)

/** A solid's displacing shape from its handle (fluids.ts FluidShape). */
const shapeOf = (h: SolidHandle): FluidShape => {
	const o = h.outline()
	const part = h.part
	if (o.circle !== undefined) {
		const { x, y, r } = o.circle
		return part.shape === "cylinder" && part.length !== undefined ? { kind: "cylinder", x, y, r, length: part.length } : { kind: "sphere", x, y, r }
	}
	return { kind: "prism", points: o.points ?? [], depth: part.body.kind === "ball" ? 0 : part.body.depth }
}

const box = (s: FluidShape) => {
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

/** A quarter second: how quickly the afloat reading's smoothed support follows (bobbing is not sinking). */
const SUPPORT_TAU = 0.25
/** The share of its weight the liquid must hold up for a body to float (the rest is bobbing and settling). */
const AFLOAT = 0.97
/** m/s: a body resting on the bottom moves up or down slower than this (it may roll along it). */
const RESTING = 0.02

interface Group {
	readonly root: string
	readonly parts: string[]
	readonly item: string
	key: number
}

/** One run's liquids, made by its first liquid, hull or sail process. */
class Liquids {
	readonly regions: RegionState[]
	readonly hulls: { readonly record: ProcessRecord; readonly root: string; flooded: boolean; told: boolean; water: number; capacity?: number; readonly vessel: boolean }[]
	readonly sails: ProcessRecord[]
	/** the parts the surface holds up when laid gently (a paper clip's), the soaps, the tubes and the paper strips */
	readonly held: { readonly record: ProcessRecord; readonly item: string; broken: boolean; told: boolean; touched: boolean }[]
	readonly soaps: { readonly record: ProcessRecord; landed: number | undefined; region: RegionState | undefined }[]
	readonly tubes: { readonly record: ProcessRecord; z: number; wet: boolean }[]
	readonly owner: string
	readonly groups: Group[]
	readonly wet = new Set<string>()
	readonly overflowed = new Set<string>()
	/** Each item's smoothed share of its weight held up by the liquid. */
	readonly support = new Map<string, number>()
	constructor(scene: SimScene<string>) {
		const records = scene.processes ?? []
		const mine = records.filter((r) => r.kind === "liquid" || r.kind === "hull" || r.kind === "sail" || r.kind === "displace" || SURFACE_KINDS.has(r.kind))
		this.owner = (mine[0] as ProcessRecord).id
		this.regions = mine
			.filter((r) => r.kind === "liquid")
			.map((r) =>
				regionState({
					id: r.id,
					item: r.item ?? itemOf(r.id),
					x0: r.x0 as number,
					x1: r.x1 as number,
					floor: r.floor as number,
					rim: r.rim as number,
					area: r.area as number,
					layers: (r.layers as FluidLayer[]).map((l) => ({
						words: l.words,
						density: l.density,
						viscosity: l.viscosity,
						height: l.height,
						...(finite(l.tension) ? { tension: l.tension } : {}),
						...(finite(l.wets) ? { wets: l.wets } : {})
					}))
				} satisfies FluidRegion)
			)
		const byId = new Map(scene.solids.map((s) => [s.id, s]))
		const welded = (s: SolidPart) => s.parent !== undefined && s.pivot === undefined && byId.has(s.parent)
		const root = (s: SolidPart): string => (welded(s) ? root(byId.get(s.parent as string) as SolidPart) : s.id)
		const groups = new Map<string, Group>()
		for (const s of scene.solids) {
			if (s.kind !== "dynamic") continue
			const r = root(s)
			const g = groups.get(r)
			if (g === undefined) groups.set(r, { root: r, parts: [s.id], item: itemOf(s.id), key: -1 })
			else g.parts.push(s.id)
		}
		this.groups = [...groups.values()]
		this.hulls = mine
			.filter((r) => r.kind === "hull")
			.map((r) => {
				// its room for water: its envelope less its own material (record.material_ml), or the envelope less its drawn parts
				const pts = r.points as Point[]
				let a = 0
				for (let i = 0; i < pts.length; i++) a += (pts[i] as Point).x * (pts[(i + 1) % pts.length] as Point).y - (pts[(i + 1) % pts.length] as Point).x * (pts[i] as Point).y
				const envelope = (Math.abs(a) / 2) * (r.depth as number)
				const own = finite(r.material_ml) ? (r.material_ml as number) / 1e6 : 0
				return { record: r, root: root(byId.get(r.solid as string) as SolidPart), flooded: false, told: false, water: 0, capacity: Math.max(0, envelope - own), vessel: r.vessel === true }
			})
		this.sails = mine.filter((r) => r.kind === "sail")
		this.held = mine.filter((r) => r.kind === "surface").map((r) => ({ record: r, item: r.item ?? itemOf(r.id), broken: false, told: false, touched: false }))
		this.soaps = mine.filter((r) => r.kind === "soap").map((r) => ({ record: r, landed: undefined, region: undefined }))
		this.tubes = mine.filter((r) => r.kind === "capillary" || r.kind === "wick").map((r) => ({ record: r, z: 0, wet: false }))
		// an item's true volume over its parts' (outline × depth): scales what each of its bodies pushes aside
		for (const r of mine) {
			if (r.kind !== "displace" || typeof r.item !== "string") continue
			let parts = 0
			for (const s of scene.solids) if (itemOf(s.id) === r.item && s.kind === "dynamic") parts += volume(s.body)
			if (parts > 0) this.scales.set(r.item, (r.volume_ml as number) / 1e6 / parts)
		}
	}
	readonly scales = new Map<string, number>()

	/** The moving bodies that reach into a container now, as the liquids see them; with the groups they came from. */
	bodies(ctx: ProcessContext): { body: FluidBody; group: Group; touching: boolean }[] {
		const out: { body: FluidBody; group: Group; touching: boolean }[] = []
		for (const g of this.groups) {
			const handles: SolidHandle[] = []
			for (const id of g.parts) {
				const h = ctx.solid(id)
				if (h !== undefined && h.dynamic && h.scale() >= 0.01) handles.push(h)
			}
			const first = handles[0]
			if (first === undefined) continue
			const parts = handles.map(shapeOf)
			const hull = this.hulls.find((x) => x.root === g.root)
			let hullView: FluidBody["hull"]
			let floodScale: number | undefined
			let shapes = parts
			if (hull !== undefined) {
				const h = ctx.solid(hull.record.solid as string)
				if (h !== undefined) {
					const q = h.pose()
					const c = Math.cos(q.angle)
					const s = Math.sin(q.angle)
					const pts = (hull.record.points as Point[]).map((p) => ({ x: q.x + p.x * c - p.y * s, y: q.y + p.x * s + p.y * c }))
					const [i, j] = hull.record.rim as [number, number]
					// an open vessel of the catalog (a mug, a bowl): the liquid another module keeps in it (the flow module's tap water) is what its body
					// weighs over its own parts; it takes up the room water over the rim would fill, and once flooded it displaces as much as it is
					const held = hull.vessel ? this.heldIn(ctx, handles, first.body().mass, pts) : 0
					// (and its parts outside the envelope, a mug's handle, displace their true volume: record.extra, extra_ml)
					let extra: FluidShape[] | undefined
					if (hull.vessel && Array.isArray(hull.record.extra) && finite(hull.record.extra_ml) && (hull.record.extra_ml as number) > 0) {
						const ids = new Set(hull.record.extra as string[])
						let drawn = 0
						const xs: SolidHandle[] = []
						for (const h of handles)
							if (ids.has(h.id) && h.part.body.kind !== "ball") {
								drawn += volume(h.part.body)
								xs.push(h)
							}
						if (drawn > 0) {
							const k = (hull.record.extra_ml as number) / 1e6 / drawn
							extra = xs.map((h) => ({ ...(shapeOf(h) as Extract<FluidShape, { kind: "prism" }>), scale: k }))
						}
					}
					hullView = {
						points: pts,
						depth: hull.record.depth as number,
						rim: [pts[i] as Point, pts[j] as Point],
						flooded: hull.flooded,
						water: hull.water,
						...(hull.capacity === undefined ? {} : { capacity: hull.capacity }),
						...(held > 0 ? { held } : {}),
						...(extra === undefined ? {} : { extra })
					}
					// flooded, it displaces only its own material (the real clay's or foil's volume, record.material_ml), not its drawn slabs'
					if (hull.flooded && finite(hull.record.material_ml)) {
						let solid = 0
						for (const id of g.parts) {
							const s = ctx.solid(id)
							if (s !== undefined) solid += volume(s.part.body)
						}
						if (solid > 0) floodScale = held > 0 ? ((hull.record.material_ml as number) / 1e6 + held) / solid : (hull.record.material_ml as number) / 1e6 / solid
					}
					shapes = [...parts, { kind: "prism", points: pts, depth: hull.record.depth as number }]
				}
			}
			// only a body that reaches into a container's walls, below its rim, can be in its liquid (the others are left alone)
			let near = false
			for (const s of shapes) {
				const b = box(s)
				for (const st of this.regions) {
					const r = st.region
					if (b.x1 >= r.x0 && b.x0 <= r.x1 && b.y0 <= r.rim && b.y1 >= r.floor) near = true
				}
				if (near) break
			}
			if (!near) continue
			const view = first.body()
			g.key = view.key
			let touching = false
			for (const h of handles) if (ctx.touching(h.id).length > 0) touching = true
			out.push({
				group: g,
				touching,
				body: {
					key: view.key,
					mass: view.mass,
					inertia: view.inertia,
					com: view.center,
					v: view.velocity,
					w: view.spin,
					free: !touching && !view.jointed,
					force: view.force,
					torque: view.torque,
					parts,
					...(hullView === undefined ? {} : { hull: hullView }),
					...(floodScale !== undefined ? { scale: floodScale } : this.scales.has(g.item) ? { scale: this.scales.get(g.item) as number } : {})
				}
			})
		}
		return out
	}

	/**
	 * m³ of liquid another module keeps in an open vessel (its body's mass over its own parts': the flow module's basin water, which it adds to the
	 * body), taken at the density of the liquid it floats in (or water's); 0 under a milligram.
	 */
	heldIn(ctx: ProcessContext, handles: readonly SolidHandle[], mass: number, pts: readonly Point[]): number {
		let own = 0
		for (const h of handles) own += h.mass()
		const extra = mass - own
		if (!(extra > 1e-6)) return 0
		let x0 = Number.POSITIVE_INFINITY
		let x1 = Number.NEGATIVE_INFINITY
		for (const p of pts) {
			x0 = Math.min(x0, p.x)
			x1 = Math.max(x1, p.x)
		}
		let rho = 998.2
		for (const st of this.regions) {
			const r = st.region
			const top = r.layers.at(-1)
			if (top !== undefined && x1 >= r.x0 && x0 <= r.x1) {
				rho = top.density
				break
			}
		}
		void ctx
		return extra / rho
	}

	/** One (sub-)step: levels, floods, pushes (when `push`), readings and events. */
	run(ctx: ProcessContext, h: number, push: boolean) {
		// (the air's density: a world's own, settings.airDensity (Mars 0.020 kg/m³: a fan's wind pushes a sail 60 times less), the standard 1.2 bit for bit)
		const env = { g: ctx.settings.gravity, air: ctx.settings.air ? (ctx.settings.airDensity ?? 1.2) : 0 }
		const found = this.bodies(ctx)
		const bodies = found.map((f) => f.body)
		const hollows = hollowsOf(bodies)
		for (const st of this.regions) updateLevels(st, bodies, hollows)
		floodHulls(this.regions, bodies, h, env.g)
		for (const f of found) {
			const hull = this.hulls.find((x) => x.root === f.group.root)
			if (hull === undefined || f.body.hull === undefined) continue
			hull.water = f.body.hull.water ?? 0
			if (f.body.hull.flooded) hull.flooded = true
		}
		// the surface (a held paper clip's pull, soap's pull across its edge): its forces are known before the liquid's own pushes, which are solved
		// with them (so a held body with added mass rests where its pull, its buoyancy and its weight balance)
		const surf = this.held.length || this.soaps.length || this.tubes.length ? this.surfaceStep(ctx, h, found, env) : undefined
		const pushes = fluidPushes(
			this.regions,
			surf === undefined
				? bodies
				: bodies.map((b) => {
						const e = surf.forces.get(b.key)
						return e === undefined ? b : { ...b, force: { x: b.force.x + e.fx, y: b.force.y + e.fy }, torque: b.torque + e.torque }
					}),
			h,
			env
		)
		// per item: what the liquid holds up of its weight, how much is under, how deep, whether it rests
		const byItem = new Map<string, { lift: number; weight: number; under: number; whole: number; slow: boolean; touching: boolean; low: number; top: number }>()
		for (const f of found) {
			const b = f.body
			const p = pushes.get(b.key)
			if (p !== undefined && push) {
				const root = ctx.solid(f.group.parts[0] as string)
				root?.push(p.fx, p.fy, b.com)
				root?.twist(p.torque)
			}
			if (push && surf !== undefined) for (const q of surf.forces.get(b.key)?.list ?? []) q.on.push(q.fx, q.fy, { x: q.x, y: q.y })
			if (p === undefined && !this.wet.has(f.group.item)) continue
			this.wet.add(f.group.item)
			const e = byItem.get(f.group.item) ?? { lift: 0, weight: 0, under: 0, whole: 0, slow: true, touching: false, low: Number.POSITIVE_INFINITY, top: Number.NEGATIVE_INFINITY }
			e.lift += p?.lift ?? 0
			e.weight += b.mass * env.g
			e.under += p?.submerged ?? 0
			e.whole += p !== undefined && p.fraction > 0 ? p.submerged / p.fraction : 0
			// (on the bottom: it may roll along it, but it no longer falls or bounces)
			if (Math.abs(b.v.y) >= RESTING) e.slow = false
			if (f.touching) e.touching = true
			const st = this.regions.find((r) => r.region.id === p?.region)
			if (st !== undefined) {
				for (const s of b.hull !== undefined && !b.hull.flooded ? [{ kind: "prism" as const, points: b.hull.points, depth: b.hull.depth }] : b.parts) e.low = Math.min(e.low, box(s).y0)
				e.top = Math.max(e.top, st.tops.at(-1) ?? st.region.floor)
			}
			byItem.set(f.group.item, e)
		}
		const held = surf?.pulls
		for (const item of this.wet) {
			const e = byItem.get(item)
			const pull = held?.get(item) ?? 0
			const ratio = e === undefined || !(e.weight > 0) || !(e.under > 0) ? 0 : pull > 0 ? (e.lift + pull) / e.weight : e.lift / e.weight
			const before = this.support.get(item)
			const smooth = before === undefined ? ratio : before + (ratio - before) * Math.min(1, h / SUPPORT_TAU)
			this.support.set(item, smooth)
			const fraction = e !== undefined && e.whole > 0 ? Math.min(1, e.under / e.whole) : 0
			ctx.set(item, "submerged", fraction)
			ctx.set(item, "buoyancy_n", e?.lift ?? 0)
			// (wholly under, resting on something and held up by less than its weight: it has sunk, however near its density is the liquid's,
			// a grape in milk at 97 %: 2026-10-20)
			const down = e !== undefined && e.slow && e.touching && fraction >= 0.999 && smooth < 1
			ctx.set(item, "afloat", fraction > 0 && smooth >= AFLOAT && !down ? 1 : 0)
			ctx.set(item, "sunk", e !== undefined && fraction > 0 && (smooth < AFLOAT || down) && e.slow && e.touching ? 1 : 0)
			ctx.set(item, "draft_mm", e !== undefined && Number.isFinite(e.low) && e.top > e.low ? (e.top - e.low) * 1000 : 0)
		}
		for (const hull of this.hulls) {
			const item = hull.record.item ?? itemOf(hull.record.id)
			const f = found.find((x) => x.group.root === hull.root)
			if (f === undefined && !this.wet.has(item)) continue
			ctx.set(item, "flooded", hull.flooded ? 1 : 0)
			ctx.set(item, "water_ml", hull.water * 1e6)
			const rim = f?.body.hull?.rim
			const st = rim === undefined ? undefined : this.regions.find((r) => rim.some((q) => q.x >= r.region.x0 && q.x <= r.region.x1))
			if (rim !== undefined && st !== undefined) ctx.set(item, "freeboard_mm", (Math.min(rim[0].y, rim[1].y) - (st.tops.at(-1) ?? st.region.floor)) * 1000)
			if (hull.flooded && !hull.told) {
				hull.told = true
				ctx.event(`${item} fills with water and sinks`, [item], "flooded")
			}
		}
		this.readSails(ctx, env.air)
		for (const st of this.regions) {
			const r = st.region
			const top = st.tops.at(-1) ?? r.floor
			ctx.set(r.item, "level_mm", (top - r.floor) * 1000)
			ctx.set(r.item, "volume_ml", r.area * (top - r.floor) * 1e6)
			ctx.set(r.item, "spilled_ml", st.spilled * 1e6)
			// (a column of several liquids: each layer's top over the floor, bottom first, for the view's interfaces)
			if (r.layers.length > 1) for (let i = 0; i < r.layers.length; i++) ctx.set(r.item, `layer${i + 1}_mm`, ((st.tops[i] ?? r.floor) - r.floor) * 1000)
			if (st.spilled > 1e-9 && !this.overflowed.has(r.id)) {
				this.overflowed.add(r.id)
				ctx.event(`${r.item} overflows`, [r.item], "overflow")
			}
		}
	}

	/** The surface's level over x in a region now, its top liquid (the topmost layer that has any), or undefined. */
	surfaceOf(st: RegionState): { level: number; layer: FluidLayer } | undefined {
		for (let i = st.volumes.length - 1; i >= 0; i--)
			if ((st.volumes[i] as number) > 0) return { level: st.tops[i] as number, layer: st.region.layers[i] as FluidLayer }
		return undefined
	}
	/** The region a point is over (inside its walls, below its rim), or undefined. */
	regionAt(x: number, y: number): RegionState | undefined {
		return this.regions.find((st) => x >= st.region.x0 && x <= st.region.x1 && y <= st.region.rim + 0.5 && y >= st.region.floor - 0.01)
	}
	/** The surface's tension (N/m) and the largest contact angle it allows (degrees) at x in a region now: its own, or soap's where soap has spread. */
	tensionAt(st: RegionState, layer: FluidLayer, x: number, t: number): [number, number] {
		const L = layer as FluidLayer & { tension?: number; wets?: number }
		let gamma = finite(L.tension) ? L.tension : WATER_TENSION
		let wets = finite(L.wets) ? L.wets : 180
		for (const s of this.soaps) {
			if (s.landed === undefined || s.region !== st) continue
			const reach = (s.record.spread as number) * Math.pow(Math.max(0, t - s.landed), 0.75)
			if (Math.abs(x - (s.record.x as number)) <= reach) {
				gamma = Math.min(gamma, s.record.tension as number)
				wets = Math.min(wets, s.record.wets as number)
			}
		}
		return [gamma, wets]
	}

	/**
	 * The surface this (sub-)step: soap landing and spreading; each held part's pull (its contact line split in four along its lowest side, each
	 * quarter pulled up as the meniscus there is pushed down, damped at half the critical rate of that stiffness; the surface lets go for good
	 * where it is pushed down past what its contact angle allows); a body across the soap's edge pulled toward the clean surface (the difference
	 * in tension times its width at the water line: a soap boat); the liquid in tubes and paper strips. -> each held item's pull (N).
	 */
	surfaceStep(ctx: ProcessContext, h: number, found: { body: FluidBody; group: Group; touching: boolean }[], env: { g: number; air: number }) {
		const t = ctx.time()
		const g = env.g
		// (each body's surface forces, by its key: their sum, its torque about the body's centre of mass, and each push to apply)
		const forces = new Map<number, { fx: number; fy: number; torque: number; list: { on: SolidHandle; fx: number; fy: number; x: number; y: number }[] }>()
		const add = (on: SolidHandle, key: number, com: Point, fx: number, fy: number, x: number, y: number) => {
			const e = forces.get(key) ?? { fx: 0, fy: 0, torque: 0, list: [] }
			e.fx += fx
			e.fy += fy
			e.torque += (x - com.x) * fy - (y - com.y) * fx
			e.list.push({ on, fx, fy, x, y })
			forces.set(key, e)
		}
		// --- soap: lands when its drop has fallen to the surface below it
		for (const s of this.soaps) {
			if (s.landed !== undefined || t < (s.record.at as number)) continue
			const st = this.regionAt(s.record.x as number, s.record.y as number)
			const sf = st === undefined ? undefined : this.surfaceOf(st)
			if (st === undefined || sf === undefined) continue
			const drop = Math.max(0, (s.record.y as number) - sf.level)
			const fall = g > 0 ? Math.sqrt((2 * drop) / g) : 0
			if (t >= (s.record.at as number) + fall) {
				s.landed = (s.record.at as number) + fall
				s.region = st
				ctx.event(`${s.record.item ?? itemOf(s.record.id)}'s soap lands on the water`, [s.record.item ?? itemOf(s.record.id)], "soap")
			}
		}
		for (const s of this.soaps) {
			const item = s.record.item ?? itemOf(s.record.id)
			const reach = s.landed === undefined ? 0 : (s.record.spread as number) * Math.pow(Math.max(0, t - s.landed), 0.75)
			const wide = s.region === undefined ? 0 : s.region.region.x1 - s.region.region.x0
			ctx.set(item, "landed", s.landed === undefined ? 0 : 1)
			ctx.set(item, "spread_cm", Math.min(reach, wide) * 100)
			// (for the view: the surface it landed on, world y)
			const sf = s.region === undefined ? undefined : this.surfaceOf(s.region)
			if (sf !== undefined) ctx.set(item, "surface_y", sf.level)
		}
		// --- held parts
		const pulls = new Map<string, number>()
		for (const hp of this.held) {
			const sh = ctx.solid(hp.record.solid as string)
			if (sh === undefined || !sh.dynamic) continue
			const pts = sh.outline().points ?? []
			if (pts.length < 2) continue
			let cx = 0
			let cy = 0
			for (const p of pts) {
				cx += p.x / pts.length
				cy += p.y / pts.length
			}
			const st = this.regionAt(cx, cy)
			const sf = st === undefined ? undefined : this.surfaceOf(st)
			let total = 0
			if (!hp.broken && st !== undefined && sf !== undefined && g > 0) {
				// its lowest side: the two lowest corners
				const order = pts.map((p, i) => i).sort((a, b) => (pts[a] as Point).y - (pts[b] as Point).y || a - b)
				const pa = pts[order[0] as number] as Point
				const pb = pts[order[1] as number] as Point
				const drho = sf.layer.density - env.air
				const view = sh.body()
				const share = (hp.record.contact_m as number) / 4
				const pullsAt: { x: number; y: number; f: number }[] = []
				let lc = 0
				for (let k = 0; k < 4; k++) {
					const u = (k + 0.5) / 4
					const x = pa.x + (pb.x - pa.x) * u
					const y = pa.y + (pb.y - pa.y) * u
					const [gamma, wets] = this.tensionAt(st, sf.layer, x, t)
					const m = meniscusPull(sf.level - y, gamma, drho, g, Math.min(hp.record.theta as number, wets))
					lc = m.lc
					if (m.broken) {
						hp.broken = true
						break
					}
					if (m.pull > 0) pullsAt.push({ x, y, f: m.pull * share })
				}
				// (arriving at the surface, not laid on it: it breaks through when it brings more energy than the surface can take)
				if (!hp.broken && pullsAt.length && !hp.touched && ctx.released()) {
					const [gamma, wets] = this.tensionAt(st, sf.layer, cx, t)
					const vy = Math.min(0, view.velocity.y)
					if (0.5 * view.mass * vy * vy > surfaceHoldEnergy(gamma, drho, g, Math.min(hp.record.theta as number, wets), hp.record.contact_m as number, view.mass)) hp.broken = true
				}
				if (pullsAt.length || hp.broken) hp.touched = true
				if (!hp.broken && pullsAt.length) {
					// (damped at half the critical rate of the meniscus's stiffness γ·contact/l_c for the part's body)
					const [gamma] = this.tensionAt(st, sf.layer, cx, t)
					const c = lc > 0 ? Math.sqrt(((gamma * (hp.record.contact_m as number)) / lc) * view.mass) / 4 : 0
					for (const q of pullsAt) {
						total += q.f
						const vy = view.velocity.y + view.spin * (q.x - view.center.x)
						add(sh, view.key, view.center, 0, q.f - c * vy, q.x, q.y)
					}
				}
				if (hp.broken && !hp.told) {
					hp.told = true
					ctx.event(`${hp.item} breaks through the surface and sinks`, [hp.item], "surface")
				}
			}
			pulls.set(hp.item, (pulls.get(hp.item) ?? 0) + total)
		}
		for (const hp of this.held) {
			if (!pulls.has(hp.item)) continue
			ctx.set(hp.item, "surface_mn", (pulls.get(hp.item) as number) * 1000)
			ctx.set(hp.item, "on_surface", (pulls.get(hp.item) as number) > 0 ? 1 : 0)
		}
		// --- soap's edge: a body across it is pulled toward the clean surface, (γ ahead − γ behind) × its width at the water line
		if (this.soaps.some((s) => s.landed !== undefined))
			for (const f of found) {
				const b = f.body
				for (const st of this.regions) {
					if (!this.soaps.some((s) => s.landed !== undefined && s.region === st)) continue
					const sf = this.surfaceOf(st)
					if (sf === undefined) continue
					let lo = Number.POSITIVE_INFINITY
					let hi = Number.NEGATIVE_INFINITY
					let width = 0
					const shapes: readonly FluidShape[] = b.hull !== undefined && !b.hull.flooded ? [{ kind: "prism", points: b.hull.points, depth: b.hull.depth }] : b.parts
					for (const sh of shapes) {
						const span = waterline(sh, sf.level)
						if (span === undefined) continue
						lo = Math.min(lo, span[0])
						hi = Math.max(hi, span[1])
						width = Math.max(width, span[2])
					}
					if (!(hi > lo) || !(width > 0) || hi < st.region.x0 || lo > st.region.x1) continue
					const fx = width * (this.tensionAt(st, sf.layer, hi, t)[0] - this.tensionAt(st, sf.layer, lo, t)[0])
					const on = fx !== 0 ? ctx.solid(f.group.parts[0] as string) : undefined
					if (on !== undefined) add(on, b.key, b.com, fx, 0, (lo + hi) / 2, sf.level)
				}
			}
		// --- tubes and paper strips: the liquid climbs while their lower end is in it
		for (const tb of this.tubes) {
			const r = tb.record
			const item = r.item ?? itemOf(r.id)
			const st = this.regionAt(r.x as number, r.bottom as number)
			const sf = st === undefined ? undefined : this.surfaceOf(st)
			const inIt = st !== undefined && sf !== undefined && (r.bottom as number) < sf.level
			if (inIt && st !== undefined && sf !== undefined) {
				const [gamma, wets] = this.tensionAt(st, sf.layer, r.x as number, t)
				const room = Math.max(0, (r.top as number) - sf.level)
				if (r.kind === "capillary") {
					tb.z = Math.min(room, Math.max(0, capillaryStep(tb.z, sf.level - (r.bottom as number), h, gamma, Math.min(r.theta as number, wets), sf.layer.density, sf.layer.viscosity, g, r.r as number)))
				} else {
					// paper: Washburn h² = D·t for water, D ∝ γ/μ (paper's fibres wet: cos θ = 1), slowing toward its highest (∝ γ/ρ)
					const k = (gamma / WATER_TENSION) * (0.001002 / Math.max(1e-6, sf.layer.viscosity))
					const top = (r.hmax as number) * (gamma / WATER_TENSION) * (998.2 / Math.max(1, sf.layer.density))
					if (!tb.wet) {
						tb.wet = true
						tb.z = 0.001
					}
					const w = Math.max(0.001, tb.z)
					tb.z = Math.min(room, Math.max(0, w + (h * (r.D as number) * k * Math.max(0, 1 - w / top)) / (2 * w)))
				}
			} else if (r.kind === "capillary") tb.z = 0
			ctx.set(item, r.kind === "capillary" ? "rise_mm" : "wet_mm", tb.z * 1000)
			// (for the view: how high the liquid stands in it over its bottom end)
			ctx.set(item, "column_mm", inIt && sf !== undefined ? Math.max(0, sf.level + tb.z - (r.bottom as number)) * 1000 : r.kind === "wick" && tb.wet ? tb.z * 1000 : 0)
		}
		return { pulls, forces }
	}

	/** Each sail's air and push (readings only: the engine's air drag on its slab is what pushes it). */
	readSails(ctx: ProcessContext, air: number) {
		for (const r of this.sails) {
			const h = ctx.solid(r.solid as string)
			if (h === undefined) continue
			const o = h.outline()
			let x = 0
			let y = 0
			const pts = o.points ?? []
			for (const p of pts) {
				x += p.x / pts.length
				y += p.y / pts.length
			}
			const a = ctx.air({ x, y })
			const v = h.velocity()
			const u = a.x - v.x
			const item = r.item ?? itemOf(r.id)
			ctx.set(item, "air_ms", a.x)
			ctx.set(item, "push_n", 0.5 * air * (r.push as number) * (r.area as number) * Math.abs(u) * u)
		}
	}
}

/** Where a shape meets a surface at height y: [x left, x right, its width front to back there], or undefined. */
const waterline = (s: FluidShape, y: number): [number, number, number] | undefined => {
	if (s.kind !== "prism") {
		if (!(Math.abs(y - s.y) < s.r)) return undefined
		const half = Math.sqrt(s.r * s.r - (y - s.y) * (y - s.y))
		return [s.x - half, s.x + half, s.kind === "sphere" ? 2 * half : s.length]
	}
	let lo = Number.POSITIVE_INFINITY
	let hi = Number.NEGATIVE_INFINITY
	const n = s.points.length
	for (let i = 0; i < n; i++) {
		const p = s.points[i] as Point
		const q = s.points[(i + 1) % n] as Point
		if ((p.y - y) * (q.y - y) > 0 || p.y === q.y) continue
		const x = p.x + ((y - p.y) / (q.y - p.y)) * (q.x - p.x)
		lo = Math.min(lo, x)
		hi = Math.max(hi, x)
	}
	return hi > lo ? [lo, hi, s.depth] : undefined
}

const SURFACE_KINDS = new Set(["surface", "soap", "capillary", "wick"])

const runs = new WeakMap<SimScene<string>, Liquids>()
const liquidsOf = (scene: SimScene<string>) => {
	let l = runs.get(scene)
	if (l === undefined) {
		l = new Liquids(scene)
		runs.set(scene, l)
	}
	return l
}

/** The run's liquids, for another module (a heat module pouring melt water in, or reading a level): undefined in a scene without any. */
export const liquidsIn = (scene: SimScene<string>) => runs.get(scene)

/**
 * Pours `volume` m³ of a liquid into a container's top layer (another module's melt water): the container's id, or the item's. Returns
 * false when the scene has no such container.
 */
export const pourInto = (scene: SimScene<string>, container: string, volume: number) => {
	const st = runs.get(scene)?.regions.find((r) => r.region.id === container || r.region.item === container)
	if (st === undefined || !(volume > 0) || st.volumes.length === 0) return false
	const i = st.volumes.length - 1
	st.volumes[i] = (st.volumes[i] as number) + volume
	return true
}

const create = (record: ProcessRecord, ctx: ProcessContext) => {
	const l = liquidsOf(ctx.scene)
	const mine = l.owner === record.id
	if (!mine) return {}
	return {
		start(c: ProcessContext) {
			// the levels and readings where everything starts (held items included), for the first frame
			l.run(c, c.step, false)
		},
		step(c: ProcessContext) {
			// before the release nothing moves: the levels and readings follow what is put in (after it, `force` does this every sub-step)
			if (!c.released()) l.run(c, c.step, false)
		},
		force(c: ProcessContext, h: number) {
			l.run(c, h, true)
		}
	}
}

const liquid: ProcessKind = { kind: "liquid", check: (r) => liquidProblem(r), create }
const hull: ProcessKind = { kind: "hull", check: (r, solids) => hullProblem(r, solids), create }
const sail: ProcessKind = { kind: "sail", check: (r, solids) => sailProblem(r, solids), create }
const displace: ProcessKind = { kind: "displace", check: (r) => displaceProblem(r), create }
const surface: ProcessKind = { kind: "surface", check: (r, solids) => surfaceProblem(r, solids), create }
const soap: ProcessKind = { kind: "soap", check: (r) => soapProblem(r), create }
const capillary: ProcessKind = { kind: "capillary", check: (r) => tubeProblem(r), create }
const wick: ProcessKind = { kind: "wick", check: (r) => tubeProblem(r), create }

export default [liquid, hull, sail, displace, surface, soap, capillary, wick]
