/**
 * The magnetism module's engine side, process kind "magnetism": magnets, soft iron, coils, the Earth's field, charges and polarizable
 * things (the math is in tooling/src/sim/magnetism.ts). The catalog (machines/mod_magnetism.py, web/sim/modules/magnetism.js) writes one
 * record per part into doc.processes, {kind: "magnetism", id, item, role, ...}:
 *   {role: "magnet", solid, faces: [{x, y, z?, angle, width, depth, sigma}], round?, level?, center?, needle?}   a permanent magnet; `level`: held
 *       level by what it is threaded on (a ring on a dowel, which takes every turning the field gives it: two rings with like faces together
 *       would otherwise flip over and snap on, as free ones do), its pushes applied at `center` (its middle, in the solid's frame); `needle`:
 *       a compass needle on its pivot (never left balancing exactly against the field: tooling/src/sim/magnetism.ts MagnetSpec)
 *   {role: "soft", solid, x, y, w, h, d, round?, volume, ms, chi, grid?, coil?: {turns, length, current?: [{t, amps}], reading?: {item, key}}}
 *       soft iron; with `coil`, an electromagnet's core: its winding's current from its own schedule, or, with `reading`, whatever another
 *       module's process sets as that item's reading (ctx.set(item, key, amps): a circuit's current through the coil) each step
 *   {role: "earth", x, y}                                                                             the Earth's field in the plane, T
 *   {role: "charge", solid, x, y, q, radius, capacitance, conductor?, grounded?}                     a charge
 *   {role: "polar", solid, x, y, w, h, d, round?, volume, epsr}                                     a neutral thing the field polarizes
 * All the records of a run make one field (the first record's process steps it for all; the rest only register), so every pair of them
 * is reckoned once, the opposite force on the other, whatever their order. Readings (track.state[item]): `pull_mN` (the magnetic and
 * electric force on the item, mN), `magnetized` (a soft item's magnetization, % of saturation), `amps` (a coil's current), `charge_uC`
 * (an item's charge, µC), `heading_deg` (a magnet's north end, degrees counter-clockwise from +x: a compass needle's reading). Events: a
 * coil switched on or off, charge passed by a touch, a spark.
 */
import {
	type ChargeSpec,
	createFields,
	type FaceSpec,
	type Fields,
	type FieldsSpec,
	type MagnetSpec,
	type PolarSpec,
	type SoftSpec
} from "#sim/magnetism.ts"
import type { Point, Process, ProcessContext, ProcessKind, ProcessRecord, SolidHandle } from "#sim/plugins.ts"

/** One run's field: every record of the run, in document order; built at the first start and stepped by the first record's process. */
interface Run {
	readonly records: ProcessRecord[]
	started: boolean
	fields?: Fields
	/** solid -> its item */
	readonly itemOf: Map<string, string>
	/** the solids each charged solid touched last step */
	readonly touched: Map<string, Set<string>>
	/** the force on each item this step (N) */
	readonly pull: Map<string, { x: number; y: number }>
	/** coils' currents last step (for the on/off events) */
	readonly amps: Map<string, number>
	/** a magnet's north direction in its solid's frame (rad), for its heading reading */
	readonly north: Map<string, number>
	/** charges last step, for the transfer events */
	readonly charge: Map<string, number>
	/** how many magnet records each item has */
	readonly magnetsOf: Map<string, number>
	/** the solids held level (a ring on its dowel), and their middles in their own frames */
	readonly level: Map<string, { x: number; y: number }>
}

/** The runs being built or run, by their scene (a new run of the same scene starts a new one: see `runOf`). */
const RUNS = new WeakMap<object, Run>()

const runOf = (ctx: ProcessContext): Run => {
	let run = RUNS.get(ctx.scene)
	if (run === undefined || run.started) {
		run = { records: [], started: false, itemOf: new Map(), touched: new Map(), pull: new Map(), amps: new Map(), north: new Map(), charge: new Map(), magnetsOf: new Map(), level: new Map() }
		RUNS.set(ctx.scene, run)
	}
	return run
}

const num = (v: unknown) => typeof v === "number" && Number.isFinite(v)
const pos = (v: unknown) => num(v) && (v as number) > 0

const faceProblem = (f: unknown, k: number): string | undefined => {
	if (typeof f !== "object" || f === null) return `face ${k} is not an object`
	const o = f as Record<string, unknown>
	for (const key of ["x", "y", "angle", "sigma"]) if (!num(o[key])) return `face ${k}.${key} must be a number`
	if (!pos(o.width) || !pos(o.depth)) return `face ${k} needs a width and a depth over 0`
	if (o.z !== undefined && !num(o.z)) return `face ${k}.z must be a number`
	return undefined
}

const solidProblem = (r: ProcessRecord, solids: ReadonlySet<string>) =>
	typeof r.solid !== "string" ? "needs a solid (its id)" : solids.has(r.solid) ? undefined : `names a solid "${r.solid}" the document does not have`

const blockProblem = (r: ProcessRecord) => {
	for (const key of ["x", "y"]) if (!num(r[key])) return `${key} must be a number`
	for (const key of ["w", "h", "d", "volume"]) if (!pos(r[key])) return `${key} must be a number over 0`
	return undefined
}

/** The magnetic and electric forces of a run (all its records), stepped by its first record's process. */
const leaderProcess = (run: Run): Process => ({
	start(ctx) {
		run.started = true
		const spec = specOf(run)
		run.fields = createFields(spec)
		// (a pair pushes no moving solid harder than PULL_CAP times its weight: both get the same share)
		const g = ctx.settings.gravity
		run.fields.setLimit((id) => {
			const hd = ctx.solid(id)
			return hd === undefined || !hd.dynamic || !(g > 0) ? Number.POSITIVE_INFINITY : PULL_CAP * hd.mass() * g
		})
		for (const r of run.records) if (typeof r.solid === "string" && typeof r.item === "string") run.itemOf.set(r.solid, r.item)
		for (const m of spec.magnets ?? []) run.north.set(m.solid, northOf(m))
		for (const r of run.records) if (r.role === "magnet" && typeof r.item === "string") run.magnetsOf.set(r.item, (run.magnetsOf.get(r.item) ?? 0) + 1)
		for (const r of run.records) {
			if (r.role !== "magnet" || r.level !== true) continue
			const c = r.center as { x?: number; y?: number } | undefined
			run.level.set(r.solid as string, { x: c?.x ?? 0, y: c?.y ?? 0 })
		}
		// the readings start at the start (an item's charge before it moves, a coil at rest, a compass's heading)
		readings(run, ctx)
	},
	step(ctx) {
		if (run.fields === undefined) return
		// (before the release nothing moves, but held clips are already magnetized by the magnet waiting over them)
		if (!ctx.released()) run.fields.settle(ctx.time(), (id) => ctx.solid(id)?.pose())
		contacts(run, ctx)
	},
	force(ctx, h) {
		const fields = run.fields
		if (fields === undefined) return
		// a coil a circuit drives: its current is that module's reading now
		for (const r of run.records) {
			const reading = r.role === "soft" ? ((r.coil as { reading?: { item?: unknown; key?: unknown } } | undefined)?.reading ?? undefined) : undefined
			if (reading === undefined || typeof reading.item !== "string" || typeof reading.key !== "string") continue
			fields.setCurrent(r.solid as string, ctx.get(reading.item, reading.key) ?? 0)
		}
		run.pull.clear()
		// every pair's push and turning on each solid, summed (about its own origin) before any is applied
		const sums = new Map<string, { fx: number; fy: number; tq: number; k: number; x: number; y: number; angle: number }>()
		fields.step(
			ctx.time(),
			(id) => ctx.solid(id)?.pose(),
			(id, fx, fy, px, py, torque, stiffness) => {
				let s = sums.get(id)
				if (s === undefined) {
					const q = ctx.solid(id)?.pose()
					if (q === undefined) return
					s = { fx: 0, fy: 0, tq: 0, k: 0, x: q.x, y: q.y, angle: q.angle }
					sums.set(id, s)
				}
				s.fx += fx
				s.fy += fy
				s.tq += torque + (px - s.x) * fy - (py - s.y) * fx
				s.k = Math.max(s.k, stiffness)
			}
		)
		for (const [id, s] of sums) {
			const hd = ctx.solid(id)
			if (hd === undefined) continue
			const item = run.itemOf.get(id) ?? hd.item
			const p = run.pull.get(item) ?? { x: 0, y: 0 }
			p.x += s.fx
			p.y += s.fy
			run.pull.set(item, p)
			if (!hd.dynamic) continue
			const lv = run.level.get(id)
			if (lv !== undefined) {
				// (held level by its dowel: pushed at its middle, every turning taken by the dowel)
				const c = Math.cos(s.angle)
				const sn = Math.sin(s.angle)
				hd.push(s.fx, s.fy, { x: s.x + lv.x * c - lv.y * sn, y: s.y + lv.x * sn + lv.y * c })
				continue
			}
			hd.push(s.fx, s.fy, { x: s.x, y: s.y })
			// the turning taken implicitly where it is stiff for the step (backward Euler on its torsion: τ/(1 + κh²/I))
			const I = inertiaOf(hd)
			const k = I > 0 && s.k > 0 ? 1 / (1 + (s.k * h * h) / I) : 1
			const turn = s.tq * k
			if (turn !== 0) hd.twist(turn)
		}
		readings(run, ctx)
	}
})

/** The field's spec from a run's records, in document order. */
const specOf = (run: Run): FieldsSpec => {
	const magnets: MagnetSpec[] = []
	const soft: SoftSpec[] = []
	const charges: ChargeSpec[] = []
	const polar: PolarSpec[] = []
	let earth: { x: number; y: number } | undefined
	for (const r of run.records) {
		const o = r as Record<string, unknown>
		if (r.role === "magnet") magnets.push({ solid: o.solid as string, faces: o.faces as FaceSpec[], round: o.round === true, ...(o.needle === true ? { needle: true } : {}) })
		else if (r.role === "soft") soft.push(o as unknown as SoftSpec)
		else if (r.role === "charge") charges.push(o as unknown as ChargeSpec)
		else if (r.role === "polar") polar.push(o as unknown as PolarSpec)
		// (one Earth: every compass may ask for it; the first one's says which way north is)
		else if (r.role === "earth" && earth === undefined) earth = { x: o.x as number, y: o.y as number }
	}
	return { magnets, soft, charges, polar, ...(earth === undefined ? {} : { earth }) }
}

/** A magnet's north direction in its own frame: from the centre of its south faces' charge to its north faces'. */
const northOf = (m: MagnetSpec) => {
	let nx = 0
	let ny = 0
	for (const f of m.faces) {
		const q = f.sigma * f.width * f.depth
		nx += q * f.x
		ny += q * f.y
	}
	return Math.atan2(ny, nx)
}

/** Each item's readings now. */
const readings = (run: Run, ctx: ProcessContext) => {
	const fields = run.fields
	if (fields === undefined) return
	const state = fields.state()
	const most = new Map<string, number>()
	for (const r of run.records) {
		const item = r.item
		if (typeof item !== "string") continue
		if (r.role === "soft") {
			// (an item of several pieces of iron, a row of clips: its most magnetized one)
			const m = state.soft[r.solid as string] ?? [0, 0, 0]
			const pct = (100 * Math.sqrt(m[0] * m[0] + m[1] * m[1] + m[2] * m[2])) / (r.ms as number)
			const seen = most.get(item)
			if (seen === undefined || pct > seen) most.set(item, pct)
			const amps = state.coils[r.solid as string]
			if (amps !== undefined) {
				const before = run.amps.get(item)
				if (before !== undefined && before === 0 && amps !== 0) ctx.event(`${item} switched on: ${amps.toFixed(1)} A through its coil`, [item], "switch")
				if (before !== undefined && before !== 0 && amps === 0) ctx.event(`${item} switched off`, [item], "switch")
				run.amps.set(item, amps)
				ctx.set(item, "amps", amps)
			}
		} else if (r.role === "magnet" && (run.magnetsOf.get(item) ?? 0) === 1) {
			// (a heading for an item with one magnet: a bar, a compass's needle; a stack of rings has none)
			const h = ctx.solid(r.solid as string)
			if (h !== undefined) {
				let deg = (((h.pose().angle + (run.north.get(r.solid as string) ?? 0)) * 180) / Math.PI) % 360
				if (deg < 0) deg += 360
				ctx.set(item, "heading_deg", deg)
			}
		}
	}
	for (const [item, pct] of most) ctx.set(item, "magnetized", pct)
	// (an item's charge: the sum over its solids' charge records)
	const byItem = new Map<string, number>()
	for (const [solid, q] of Object.entries(state.charges)) {
		const item = run.itemOf.get(solid) ?? solid
		byItem.set(item, (byItem.get(item) ?? 0) + q)
	}
	for (const [item, q] of byItem) {
		ctx.set(item, "charge_uC", q * 1e6)
		run.charge.set(item, q)
	}
	for (const [item, p] of run.pull) ctx.set(item, "pull_mN", 1000 * Math.sqrt(p.x * p.x + p.y * p.y))
}

/** Charge passing at touches, and sparks across gaps. */
const contacts = (run: Run, ctx: ProcessContext) => {
	const fields = run.fields
	if (fields === undefined) return
	const charged = run.records.filter((r) => r.role === "charge").map((r) => r.solid as string)
	if (charged.length === 0) return
	const t = ctx.time()
	const before = fields.state().charges
	const seen = new Set<string>()
	for (const id of charged) {
		const now = new Set(ctx.touching(id))
		const last = run.touched.get(id) ?? new Set<string>()
		for (const other of now) {
			if (last.has(other)) continue
			const key = id < other ? `${id}\u0000${other}` : `${other}\u0000${id}`
			if (seen.has(key)) continue
			seen.add(key)
			fields.touch(t, id, other)
		}
		run.touched.set(id, now)
	}
	// sparks between conductors near each other (not touching)
	const conductors = [...fields.conductors]
	for (let i = 0; i < conductors.length; i++)
		for (let j = i + 1; j < conductors.length; j++) {
			const a = conductors[i] as string
			const b = conductors[j] as string
			if (run.touched.get(a)?.has(b) === true || run.touched.get(b)?.has(a) === true) continue
			const ha = ctx.solid(a)
			const hb = ctx.solid(b)
			if (ha === undefined || hb === undefined) continue
			const g = gapBetween(ha, hb)
			if (g === undefined || g.gap > SPARK_REACH) continue
			const s = fields.spark(t, a, b, g.gap, g.x, g.y)
			if (s !== undefined) {
				const ia = run.itemOf.get(a) ?? ha.item
				const ib = run.itemOf.get(b) ?? hb.item
				ctx.event(`spark between ${ia} and ${ib}: ${(s.volts / 1000).toFixed(1)} kV across ${(g.gap * 1000).toFixed(1)} mm`, [ia, ib], "spark")
			}
		}
	// what moved, said once per solid that took or gave over 1 nC
	const after = fields.state().charges
	for (const [solid, q] of Object.entries(after)) {
		const q0 = before[solid] ?? 0
		const item = run.itemOf.get(solid) ?? solid
		if (Math.abs(q - q0) > 1e-9) ctx.event(`${item}'s charge went from ${(q0 * 1e9).toFixed(1)} to ${(q * 1e9).toFixed(1)} nC`, [item], "charge")
	}
}

/**
 * The most a field pushes a moving thing, in its own weights: a light piece of iron at a strong pole is pulled tens or hundreds of times its
 * weight (a 1.8 g washer at a neodymium bar's pole, 5 N: 280 times), and reaches the pole within a step or two of the 480 Hz clock, which
 * then meets the field's steep rise and its own contact at once and can throw it off. Fifty times its weight still holds anything up against
 * gravity and friction (a fridge magnet needs about 3), snaps a clip to a pole in a few hundredths of a second, and keeps every step's
 * change of speed under 1 m/s.
 */
const PULL_CAP = 50

/** A solid's own moment of inertia about its origin (kg·m²): a slab's, a polygon's box's, a ball's sphere (½·m·r² a cylinder on its side). */
const inertiaOf = (h: SolidHandle) => {
	const b = h.part.body
	const m = h.mass()
	if (b.kind === "ball") return (h.part.shape === "cylinder" ? 0.5 : 0.4) * m * b.radius * b.radius
	if (b.kind === "slab") return (m * (b.width * b.width + b.height * b.height)) / 12
	let x0 = Number.POSITIVE_INFINITY
	let x1 = Number.NEGATIVE_INFINITY
	let y0 = Number.POSITIVE_INFINITY
	let y1 = Number.NEGATIVE_INFINITY
	for (const p of b.points) {
		x0 = Math.min(x0, p.x)
		x1 = Math.max(x1, p.x)
		y0 = Math.min(y0, p.y)
		y1 = Math.max(y1, p.y)
	}
	return (m * ((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0))) / 12
}

/** Sparks are looked for across gaps up to this, m (a 10 cm spark takes about 300 kV: the largest school Van de Graaff makes 400 kV). */
const SPARK_REACH = 0.1

/** The nearest distance between two solids' outlines (0 when they overlap) and its middle point; undefined for a solid without one. */
export const gapBetween = (a: SolidHandle, b: SolidHandle): { gap: number; x: number; y: number } | undefined => {
	const oa = a.outline()
	const ob = b.outline()
	return outlineGap(oa, ob)
}

type Outline = { readonly circle?: { x: number; y: number; r: number }; readonly points?: readonly Point[] }

/** The nearest distance between two convex outlines (circles or polygons, counter-clockwise), 0 when they overlap, and the gap's middle. */
export const outlineGap = (oa: Outline, ob: Outline): { gap: number; x: number; y: number } | undefined => {
	if (oa.circle !== undefined && ob.circle !== undefined) {
		const dx = ob.circle.x - oa.circle.x
		const dy = ob.circle.y - oa.circle.y
		const d = Math.sqrt(dx * dx + dy * dy)
		const gap = Math.max(0, d - oa.circle.r - ob.circle.r)
		const u = d > 0 ? (oa.circle.r + gap / 2) / d : 0
		return { gap, x: oa.circle.x + u * dx, y: oa.circle.y + u * dy }
	}
	if (oa.circle !== undefined || ob.circle !== undefined) {
		const [c, poly] = oa.circle !== undefined ? [oa.circle, ob.points] : [(ob.circle as { x: number; y: number; r: number }), oa.points]
		if (poly === undefined || poly.length < 3) return undefined
		const n = nearestOnPolygon(poly, c.x, c.y)
		const gap = n.inside ? 0 : Math.max(0, n.d - c.r)
		const ux = n.d > 0 ? (c.x - n.x) / n.d : 0
		const uy = n.d > 0 ? (c.y - n.y) / n.d : 0
		return { gap, x: n.x + (ux * gap) / 2, y: n.y + (uy * gap) / 2 }
	}
	const pa = oa.points
	const pb = ob.points
	if (pa === undefined || pb === undefined || pa.length < 3 || pb.length < 3) return undefined
	let best = { d: Number.POSITIVE_INFINITY, x: 0, y: 0 }
	let inside = false
	for (const [from, to] of [
		[pa, pb],
		[pb, pa]
	] as const)
		for (const p of from) {
			const n = nearestOnPolygon(to, p.x, p.y)
			if (n.inside) inside = true
			if (n.d < best.d) best = { d: n.d, x: (p.x + n.x) / 2, y: (p.y + n.y) / 2 }
		}
	return { gap: inside ? 0 : best.d, x: best.x, y: best.y }
}

/** The nearest point of a convex polygon's boundary to (x, y), its distance, and whether (x, y) is inside it. */
const nearestOnPolygon = (poly: readonly Point[], x: number, y: number) => {
	let d = Number.POSITIVE_INFINITY
	let nx = 0
	let ny = 0
	let inside = true
	for (let i = 0; i < poly.length; i++) {
		const p = poly[i] as Point
		const q = poly[(i + 1) % poly.length] as Point
		const ex = q.x - p.x
		const ey = q.y - p.y
		if (ex * (y - p.y) - ey * (x - p.x) < 0) inside = false
		const l2 = ex * ex + ey * ey
		const u = l2 > 0 ? Math.max(0, Math.min(1, ((x - p.x) * ex + (y - p.y) * ey) / l2)) : 0
		const cx = p.x + u * ex
		const cy = p.y + u * ey
		const dd = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy))
		if (dd < d) {
			d = dd
			nx = cx
			ny = cy
		}
	}
	return { d, x: nx, y: ny, inside }
}

/** A record's process: the run's first record steps the field; the others only belong to it. */
const make = (record: ProcessRecord, ctx: ProcessContext): Process => {
	const run = runOf(ctx)
	run.records.push(record)
	return run.records.length === 1 ? leaderProcess(run) : {}
}

/** Why a record of each role cannot run, or undefined. */
const PROBLEMS: Readonly<Record<string, (r: ProcessRecord, solids: ReadonlySet<string>) => string | undefined>> = {
	magnet(r, solids) {
		const why = solidProblem(r, solids)
		if (why !== undefined) return why
		if (r.level !== undefined && typeof r.level !== "boolean") return "level must be true or false"
		if (r.needle !== undefined && typeof r.needle !== "boolean") return "needle must be true or false"
		if (r.center !== undefined) {
			const c = r.center as Record<string, unknown>
			if (typeof c !== "object" || c === null || !num(c.x) || !num(c.y)) return "center must be a point {x, y}"
		}
		if (!Array.isArray(r.faces) || r.faces.length === 0) return "needs its faces"
		for (let k = 0; k < r.faces.length; k++) {
			const p = faceProblem(r.faces[k], k)
			if (p !== undefined) return p
		}
		return undefined
	},
	soft(r, solids) {
		const why = solidProblem(r, solids) ?? blockProblem(r)
		if (why !== undefined) return why
		if (!pos(r.ms) || !pos(r.chi)) return "needs ms (saturation, A/m) and chi (susceptibility) over 0"
		if (r.grid !== undefined && typeof r.grid !== "boolean") return "grid must be true or false"
		if (r.coil !== undefined) {
			const c = r.coil as Record<string, unknown>
			if (typeof c !== "object" || c === null || !pos(c.turns) || !pos(c.length)) return "coil needs turns and length (over 0)"
			if (c.current === undefined && c.reading === undefined) return "coil needs its current [{t, amps}] or a reading {item, key} to take it from"
			if (c.reading !== undefined) {
				const rd = c.reading as Record<string, unknown>
				if (typeof rd !== "object" || rd === null || typeof rd.item !== "string" || typeof rd.key !== "string") return "coil.reading must be {item, key}"
			}
			if (c.current !== undefined && !Array.isArray(c.current)) return "coil.current must be a list [{t, amps}]"
			for (const s of (c.current ?? []) as unknown[]) {
				const o = s as Record<string, unknown>
				if (typeof s !== "object" || s === null || !num(o.t) || !num(o.amps) || Math.abs(o.amps as number) > 1e4) return "coil current steps need t and amps (under 10 kA)"
			}
		}
		return undefined
	},
	earth: (r) => (num(r.x) && num(r.y) && Math.abs(r.x as number) < 0.01 && Math.abs(r.y as number) < 0.01 ? undefined : "x and y must be numbers of tesla (under 0.01)"),
	charge(r, solids) {
		const why = solidProblem(r, solids)
		if (why !== undefined) return why
		for (const key of ["x", "y", "q"]) if (!num(r[key])) return `${key} must be a number`
		if (!pos(r.radius) || !pos(r.capacitance)) return "needs a radius and a capacitance over 0"
		if (Math.abs(r.q as number) > 1e-3) return "q must be under a millicoulomb"
		return undefined
	},
	polar(r, solids) {
		const why = solidProblem(r, solids) ?? blockProblem(r)
		if (why !== undefined) return why
		if (!num(r.epsr) || (r.epsr as number) < 0 || ((r.epsr as number) > 0 && (r.epsr as number) < 1)) return "epsr must be 0 (a conductor) or 1 and more"
		return undefined
	}
}

const magnetism: ProcessKind = {
	kind: "magnetism",
	check(r, solids) {
		const role = r.role
		const problem = typeof role === "string" ? PROBLEMS[role] : undefined
		if (problem === undefined) return `role must be one of ${Object.keys(PROBLEMS).join(", ")} (it is ${String(role)})`
		return problem(r, solids)
	},
	create: make
}

export default magnetism
