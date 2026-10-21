/**
 * The circuits module's process kind, "circuit": a scene's whole electrical network in one record (machines/mod_circuits.py gathers every
 * circuit item's parts and every wire into it after the items are built), solved every 480 Hz step from t = 0 by tooling/src/sim/circuits.ts
 * (nodal analysis, tooling/src/sim/circuit-solver.ts). What the mechanics does to the circuit and back, each step:
 *   - a motor whose shaft is a body (a paddle, a disc) is twisted by η·k·I along its torque-speed line, implicitly in its rotor's turning
 *     (τ = η·k·(a − b·k·ω)/(1 + η·k²·b·h/J), J its rotor's inertia about the pivot: steady however light the rotor or strong the gearbox);
 *   - a fan motor's rotor is not a body (it turns about the motor's axis, along x): its speed is stepped here, J·dω/dt = τ − c·ω|ω|, and the
 *     fan's jet pushes what is in it (the same round-jet profile and drag the engine gives a fan's stream);
 *   - a generator's crank is turned by hand at its set speed (its EMF k·ω);
 *   - a press switch is closed while what rests on its button weighs at least its force; a tester's probes conduct through the one solid
 *     that touches both (its material's resistivity); a solar panel gets the sun's light on its face (its own `sun`), the light the optics
 *     module traces onto it (lamps, flashlights, the optics sun, by mirrors and lenses: each band as silicon takes it) and the circuit's
 *     own glowing bulbs, less what blocks them; a wire comes off when its two ends are pulled farther apart than its length;
 *   - a coil's turns link the flux of the scene's permanent magnets (the magnetism module's pole faces) and the Earth's field: its EMF is
 *     that linkage's change, Faraday's law (tooling/src/sim/circuits-em.ts); a straight wire's current makes a field round it (Biot–Savart)
 *     that pushes every magnet's poles (Oersted's compass); an electromagnet's nail is the magnetism module's soft iron, its winding's
 *     current this circuit's (its coil reading); a galvanometer's needle swings to its current and settles (a damped needle).
 * Readings (track.state[item]): see READING_KEYS below; events (track.events): "Bulb 1 lights", "Buzzer sounds (2300 Hz)", "Motor starts
 * turning", "Wire 2 pulled off", "Battery is short-circuited (8.8 A)", "Tester conducts" ...
 *
 * The record: {kind: "circuit", id, parts: [CircuitPart + {name, role?}], terminals: {name: {solid, at}}, resistivity: {material: Ω·m},
 * gaps: {probe part id: m}}.
 */
import { CircuitSim, type CircuitPart, type CircuitsDoc, FILAMENT_USABLE, admitCircuits, type Reading, type Vec } from "#sim/circuits.ts"
import { type CoilGeometry, coilSamples, fluxThrough, magnetsOf, type PoleMagnet, polePushes, SI_STC, segmentField, siResponse } from "#sim/circuits-em.ts"
import { NB, type SourceRecord } from "#sim/optics.ts"
import { opticsOf } from "#sim/modules/optics.ts"
import type { Point, ProcessContext, ProcessKind, ProcessRecord, SolidHandle } from "#sim/plugins.ts"

/** Air density (kg/m³) as the engine's (physics.ts AIR_DENSITY). */
const AIR = 1.2
/** A round jet as the engine's fan streams (physics.ts JET: Rajaratnam's free jet, core 6.2 diameters, spread 0.094). */
const JET_CORE = 6.2
const JET_SPREAD = 0.094
const SPHERE_CD = 0.47
const BOX_CD = 1.05

type Part = CircuitPart & { readonly name?: string; readonly role?: string; readonly gap?: number }

/** The reading keys each part kind writes (prefixed "<role>_" for an item's second part). */
export const READING_KEYS: Readonly<Record<string, readonly string[]>> = {
	battery: ["current", "voltage"],
	wire: ["current", "off"],
	bulb: ["light", "current", "voltage", "temp_c", "broken"],
	led: ["light", "current", "voltage", "broken"],
	switch: ["closed", "current"],
	resistor: ["current", "voltage", "ohms"],
	buzzer: ["sound", "pitch", "current", "voltage"],
	motor: ["rpm", "current", "voltage", "air", "angle"],
	generator: ["rpm", "voltage", "current", "angle"],
	probe: ["conducts", "current", "ohms"],
	solar: ["irradiance", "current", "voltage", "power"],
	meter: ["reading", "current", "needle"],
	coil: ["emf_mv", "current", "voltage", "flux_uwb"],
	conductor: ["current", "field_ut"]
}

/** A galvanometer's needle: its free swing's period (s) and damping ratio (a school moving-coil meter swings and settles in about half a
 *  second, a little short of critically damped: provisional); it stops at ±STOP of full scale. */
const NEEDLE_PERIOD = 0.6
const NEEDLE_DAMPING = 0.6
const NEEDLE_STOP = 1.2
/** A straight wire's radius (m: 14 AWG, 1.63 mm across): inside it its field falls to nothing at its middle. */
const WIRE_CORE = 0.000814
/** What is said of a coil's EMF (V) and a wire's field 1 cm away (T) the first time they reach it. */
const SAY_EMF = 0.001
const SAY_FIELD = 5e-6

const rot = (v: Vec, a: number): Vec => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) })
const worldOf = (h: SolidHandle, local: Vec): Vec => {
	const p = h.pose()
	const r = rot(local, p.angle)
	return { x: p.x + r.x, y: p.y + r.y }
}

/** Whether the segment p→q passes through a solid's outline (a circle, or a convex polygon), ignoring the first `skip` metres from p. */
const blocks = (h: SolidHandle, p: Point, q: Point): boolean => {
	const o = h.outline()
	const dx = q.x - p.x
	const dy = q.y - p.y
	if (o.circle !== undefined) {
		const { x, y, r } = o.circle
		const fx = p.x - x
		const fy = p.y - y
		const a = dx * dx + dy * dy
		if (a === 0) return false
		const t = Math.max(0, Math.min(1, -(fx * dx + fy * dy) / a))
		const cx = fx + t * dx
		const cy = fy + t * dy
		return cx * cx + cy * cy < r * r
	}
	const pts = o.points ?? []
	if (pts.length < 3) return false
	// Cyrus–Beck against a convex counter-clockwise outline
	let t0 = 0
	let t1 = 1
	for (let i = 0; i < pts.length; i++) {
		const a = pts[i] as Point
		const b = pts[(i + 1) % pts.length] as Point
		const nx = b.y - a.y
		const ny = -(b.x - a.x)
		const num = nx * (a.x - p.x) + ny * (a.y - p.y)
		const den = nx * dx + ny * dy
		if (den === 0) {
			if (num < 0) return false
			continue
		}
		const t = num / den
		if (den < 0) t0 = Math.max(t0, t)
		else t1 = Math.min(t1, t)
		if (t0 > t1) return false
	}
	return t1 - t0 > 1e-9
}

/** The rotational inertia of a solid about a point of its own frame (kg·m²), from its body and mass. */
const inertiaAbout = (h: SolidHandle, pivot: Vec): number => {
	const part = h.part
	const m = h.mass()
	const b = part.body
	let icm: number
	let cx = 0
	let cy = 0
	if (b.kind === "ball") {
		const k = b.inertia ?? (part.shape === "cylinder" ? 0.5 : 0.4)
		icm = k * m * b.radius * b.radius
	} else if (b.kind === "slab") {
		icm = (m * (b.width * b.width + b.height * b.height)) / 12
	} else {
		// a polygon: its outline's polar moment about its centroid, per unit area, times its mass
		let a2 = 0
		let ix = 0
		let iy = 0
		let sx = 0
		let sy = 0
		const pts = b.points
		for (let i = 0; i < pts.length; i++) {
			const p = pts[i] as Vec
			const q = pts[(i + 1) % pts.length] as Vec
			const c = p.x * q.y - q.x * p.y
			a2 += c
			sx += (p.x + q.x) * c
			sy += (p.y + q.y) * c
			ix += (p.y * p.y + p.y * q.y + q.y * q.y) * c
			iy += (p.x * p.x + p.x * q.x + q.x * q.x) * c
		}
		const area = a2 / 2
		cx = area === 0 ? 0 : sx / (3 * a2)
		cy = area === 0 ? 0 : sy / (3 * a2)
		const jo = (ix + iy) / 12 // about the origin
		icm = area === 0 ? 0 : m * (jo / area - (cx * cx + cy * cy))
	}
	const dx = cx - pivot.x
	const dy = cy - pivot.y
	return Math.max(icm + m * (dx * dx + dy * dy), 1e-12)
}

/** A round jet's air speed at a point (m/s along its axis), exactly as physics.ts airAt gives a fan's stream (Rajaratnam's round jet). */
const jetSpeed = (at: Vec, direction: number, diameter: number, speed: number, p: Point): number => {
	const ux = Math.cos(direction)
	const uy = Math.sin(direction)
	const along = (p.x - at.x) * ux + (p.y - at.y) * uy
	if (along <= 0 || speed <= 0) return 0
	const across = Math.abs(-(p.x - at.x) * uy + (p.y - at.y) * ux)
	const center = speed * Math.min(1, (JET_CORE * diameter) / along)
	const halfSpeed = Math.max(diameter / 2, JET_SPREAD * along)
	return center * Math.exp(-Math.LN2 * (across / halfSpeed) ** 2)
}

const circuit: ProcessKind = {
	kind: "circuit",
	check(record: ProcessRecord, solids: ReadonlySet<string>) {
		try {
			admitCircuits(record, solids)
		} catch (e) {
			return e instanceof Error ? e.message.replace(/^circuits: /, "") : String(e)
		}
		return undefined
	},
	create(record, ctx) {
		const doc = record as unknown as CircuitsDoc & { readonly parts: readonly Part[]; readonly gaps?: Readonly<Record<string, number>> }
		const sim = new CircuitSim(doc)
		const g = ctx.settings.gravity
		const parts = doc.parts
		/** Each body-shaft motor's rotor inertia about its pivot (J; relative, when its stator moves too). */
		const inertia = new Map<string, number>()
		/** A fan motor's rotor speed (rad/s) and a generator's crank angle (rad). */
		const fanOmega = new Map<string, number>()
		const crank = new Map<string, number>()
		const fanSpeed = new Map<string, number>()
		/** A fan rotor's angle (rad, turned so far): the view turns its propeller by it. */
		const fanAngle = new Map<string, number>()
		let reported = 0
		let lastT = -1
		const key = (p: Part, k: string) => (p.role ? `${p.role}_${k}` : k)
		const set = (p: Part, k: string, v: number) => {
			if (p.item !== undefined && Number.isFinite(v)) ctx.set(p.item, key(p, k), v)
		}
		const shaftOmega = (p: Part): number => {
			if (p.kind === "generator") {
				const t = ctx.time()
				return t >= p.from && (p.to === undefined || t < p.to) ? p.speed : 0
			}
			if (p.kind !== "motor") return 0
			if (p.fan !== undefined) return fanOmega.get(p.id) ?? 0
			if (p.rotor === undefined) return 0
			const r = ctx.solid(p.rotor)
			const s = p.stator === undefined ? undefined : ctx.solid(p.stator)
			return (r?.spin() ?? 0) - (s?.spin() ?? 0)
		}
		/** What rests on a button: the weight (N) of the moving solids touching it whose middle is above its top. */
		const load = (solid: string): number => {
			const button = ctx.solid(solid)
			if (button === undefined) return 0
			const top = button.pose().y
			let w = 0
			for (const id of ctx.touching(solid)) {
				const h = ctx.solid(id)
				if (h === undefined || !h.dynamic || h.item === button.item) continue
				if (h.pose().y > top) w += h.mass() * g
			}
			return w
		}
		const bridge = (contacts: readonly [string, string]) => {
			const [c0, c1] = contacts
			const own = ctx.solid(c0)?.item
			const b = ctx.touching(c1)
			const via = ctx.touching(c0).find((id) => b.includes(id) && ctx.solid(id)?.item !== own)
			if (via === undefined) return undefined
			const h = ctx.solid(via) as SolidHandle
			const body = h.part.body
			const thick = body.kind === "ball" ? 2 * body.radius : body.kind === "slab" ? body.height : Math.max(...body.points.map((q) => q.y)) - Math.min(...body.points.map((q) => q.y))
			const depth = body.kind === "ball" ? 2 * body.radius : body.depth
			const probe = parts.find((p) => p.kind === "probe" && p.contacts[0] === c0)
			const length = probe?.gap ?? doc.gaps?.[probe?.id ?? ""] ?? 0.02
			return { item: h.item, material: h.part.material.words, length, area: depth * Math.min(thick, 0.01) }
		}
		const terminal = (name: string) => {
			const t = doc.terminals?.[name]
			if (t === undefined) return undefined
			const h = ctx.solid(t.solid)
			return h === undefined ? undefined : worldOf(h, t.at)
		}
		/** The optics module's record (its sources: what light each deposit came from), once. */
		let opticsRec: { readonly sources?: readonly SourceRecord[] } | undefined | null = null
		const opticsRecord = () => {
			if (opticsRec === null) opticsRec = (ctx.scene.processes ?? []).find((r) => r.kind === "optics") as { readonly sources?: readonly SourceRecord[] } | undefined
			return opticsRec
		}
		/**
		 * The light the optics module traced onto a panel's face, as the W/m² of standard sunlight that would make the same current: each
		 * deposit on the face (its normal within 25° of the face's) band by band, as silicon takes that band of that source's light
		 * (circuits-em.ts siResponse), over the face's area, against sunlight's 0.347 A/W (SI_STC). Undefined when the scene has no optics.
		 */
		const tracedLight = (p: CircuitPart & { kind: "solar" }, face: SolidHandle, n: Vec): number | undefined => {
			const world = opticsOf(ctx.scene)
			if (world === undefined) return undefined
			const res = world.result()
			if (res === undefined) return 0
			const entry = res.panels.find((q) => q.id === face.id)
			if (entry === undefined) {
				// (the panel's face is not a light-taking body of the trace: what lands on it, all bands taken as sunlight)
				return world.irradiance(face.id, p.face.at, p.face.normal, p.face.width)
			}
			if (!(entry.light > 0) || !(entry.irradiance > 0)) return 0
			const area = entry.light / entry.irradiance
			const srcs = opticsRecord()?.sources ?? []
			let amps = 0
			for (const d of res.deposits) {
				if (d.body !== entry.body || d.volume || d.nx * n.x + d.ny * n.y < 0.9) continue
				const src = srcs[d.src]
				for (let b = 0; b < NB; b++) amps += (d.incident[b] as number) * siResponse(src, b)
			}
			return amps / (area * SI_STC)
		}
		/** Light on a panel's face (W/m², as sunlight): the sun from its side, the light the optics module traces (or, without it, the heat
		 *  module's lamps), and glowing bulbs; less what is in the way (never the light's own item: a lamp's shade, a bulb's holder). */
		const irradiance = (p: CircuitPart & { kind: "solar" }, lights: readonly { readonly at: Vec; readonly power: number; readonly usable: number; readonly item?: string }[]) => {
			const face = ctx.solid(p.face.solid)
			if (face === undefined) return 0
			const pose = face.pose()
			const n = rot(p.face.normal, pose.angle)
			const mid = worldOf(face, p.face.at)
			const along = rot({ x: 1, y: 0 }, pose.angle)
			const samples = [-0.4, -0.2, 0, 0.2, 0.4].map((f) => ({ x: mid.x + along.x * f * p.face.width + n.x * 0.002, y: mid.y + along.y * f * p.face.width + n.y * 0.002 }))
			const others = ctx.all().filter((h) => h.item !== face.item && !/glass|PET/.test(h.part.material.words))
			const open = (from: Point, to: Point, own?: string) => !others.some((h) => h.item !== own && blocks(h, from, to))
			let e = 0
			const sun = p.sun
			if (sun !== undefined && sun.irradiance > 0) {
				const d = { x: Math.sin(sun.angle), y: Math.cos(sun.angle) }
				const c = n.x * d.x + n.y * d.y
				if (c > 0) {
					let lit = 0
					for (const s of samples) if (open(s, { x: s.x + d.x * 20, y: s.y + d.y * 20 })) lit++
					e += sun.irradiance * c * (lit / samples.length)
				}
			}
			const all: { at: Vec; power: number; usable: number; item?: string }[] = [...lights]
			const traced = tracedLight(p, face, n)
			if (traced !== undefined) e += traced
			else
				// (no optics module: the heat module's lamps, {role: "lamp", solid, at, dir {x, y} (or direction, rad), spread, power}: a cone of
				// light, its power spread over the cone's solid angle; an incandescent lamp's light, watt for watt FILAMENT_USABLE of sunlight's)
				for (const r of ctx.scene.processes ?? []) {
					if (r.kind !== "heat" || r.role !== "lamp") continue
					const h = ctx.solid(String(r.solid ?? r.id))
					const at = r.at as Vec | undefined
					if (h === undefined || at === undefined || typeof r.power !== "number") continue
					const t = ctx.time()
					if ((typeof r.from === "number" && t < r.from) || (typeof r.until === "number" && t >= r.until)) continue
					const src = worldOf(h, at)
					const dv = r.dir as Vec | undefined
					const own = typeof dv === "object" && dv !== null && Number.isFinite(dv.x) && Number.isFinite(dv.y) ? Math.atan2(dv.y, dv.x) : typeof r.direction === "number" ? r.direction : -Math.PI / 2
					const dir = own + h.pose().angle
					const spread = typeof r.spread === "number" ? r.spread : 0.6
					const to = { x: mid.x - src.x, y: mid.y - src.y }
					const dist = Math.hypot(to.x, to.y)
					if (dist === 0) continue
					const off = Math.abs(Math.atan2(Math.sin(Math.atan2(to.y, to.x) - dir), Math.cos(Math.atan2(to.y, to.x) - dir)))
					if (off > spread) continue
					const cone = 2 * Math.PI * (1 - Math.cos(spread))
					all.push({ at: src, power: (r.power * 4 * Math.PI) / cone, usable: FILAMENT_USABLE, ...(typeof r.item === "string" ? { item: r.item } : {}) })
				}
			for (const l of all) {
				const to = { x: l.at.x - mid.x, y: l.at.y - mid.y }
				const d2 = to.x * to.x + to.y * to.y
				if (d2 < 1e-6) continue
				const d = Math.sqrt(d2)
				const c = (n.x * to.x + n.y * to.y) / d
				if (c <= 0) continue
				let lit = 0
				for (const s of samples) if (open(s, l.at, l.item)) lit++
				e += ((l.power * l.usable) / (4 * Math.PI * d2)) * c * (lit / samples.length)
			}
			return e
		}
		const lightAt = (p: CircuitPart) => {
			const t = doc.terminals?.[`${p.id}#glow`]
			if (t === undefined) return undefined
			const h = ctx.solid(t.solid)
			return h === undefined ? undefined : worldOf(h, t.at)
		}
		// ---- electromagnetism: the scene's permanent magnets (the magnetism module's records) and the Earth's field
		let magnets: PoleMagnet[] = []
		let earth = { x: 0, y: 0 }
		/** each induction coil's flux linkage (Wb-turns) at the last step, and its EMF for this one (V, + at a) */
		const linkage = new Map<string, number>()
		const emfNow = new Map<string, number>()
		/** a coil's sample points while it stands where it was (its pose's key) */
		const coilPts = new Map<string, { key: string; geo: CoilGeometry; pts: { x: number; y: number; z: number; w: number }[]; ux: number; uy: number }>()
		/** each magnet's share of each coil's flux while neither moves (key: coil part \u0000 magnet solid) */
		const fluxPart = new Map<string, { key: string; phi: number }>()
		const poseKey = (q: { x: number; y: number; angle: number } | undefined) => (q === undefined ? "-" : `${q.x},${q.y},${q.angle}`)
		const poseOf = (id: string) => ctx.solid(id)?.pose()
		/** A coil's linkage now: n × the mean flux through one turn. */
		const linkageOf = (p: CircuitPart & { kind: "coil" }): number => {
			const ind = p.induce
			if (ind === undefined) return 0
			const h = ctx.solid(ind.solid)
			if (h === undefined) return 0
			const q = h.pose()
			const key = poseKey(q)
			let g = coilPts.get(p.id)
			if (g === undefined || g.key !== key) {
				const c = worldOf(h, ind.at)
				const a = ind.axis + q.angle
				const ux = Math.cos(a)
				const uy = Math.sin(a)
				const geo = { x: c.x, y: c.y, ux, uy, radius: ind.radius, length: ind.length }
				g = { key, geo, pts: coilSamples(geo), ux, uy }
				coilPts.set(p.id, g)
			}
			let phi = (earth.x * g.ux + earth.y * g.uy) * Math.PI * ind.radius * ind.radius
			for (const m of magnets) {
				const k = `${p.id}\u0000${m.solid}`
				const mk = `${key}|${poseKey(poseOf(m.solid))}`
				let part = fluxPart.get(k)
				if (part === undefined || part.key !== mk) {
					part = { key: mk, phi: fluxThrough(g.geo, g.pts, [m], poseOf, { x: 0, y: 0 }) }
					fluxPart.set(k, part)
				}
				phi += part.phi
			}
			return p.turns * phi
		}
		/** a galvanometer's needle: its deflection (× full scale) and its swing's speed */
		const needle = new Map<string, { x: number; v: number }>()
		const said = new Set<string>()
		const input = { omega: shaftOmega, press: load, bridge, terminal, irradiance, lightAt, emf: (p: CircuitPart & { kind: "coil" }) => emfNow.get(p.id) ?? 0 }
		const write = (readings: Map<string, Reading>) => {
			for (const p of parts) {
				const r = readings.get(p.id)
				if (r === undefined) continue
				switch (p.kind) {
					case "battery":
						set(p, "current", -r.i)
						set(p, "voltage", r.v)
						break
					case "wire":
						set(p, "current", Math.abs(r.i))
						set(p, "off", r.broken ? 1 : 0)
						break
					case "bulb":
						set(p, "light", r.light ?? 0)
						set(p, "current", Math.abs(r.i))
						set(p, "voltage", Math.abs(r.v))
						set(p, "temp_c", (r.temp ?? 293.15) - 273.15)
						set(p, "broken", r.broken ? 1 : 0)
						break
					case "led":
						set(p, "light", r.light ?? 0)
						set(p, "current", r.i)
						set(p, "voltage", r.v)
						set(p, "broken", r.broken ? 1 : 0)
						break
					case "switch":
						set(p, "closed", r.closed ? 1 : 0)
						set(p, "current", Math.abs(r.i))
						break
					case "resistor":
						set(p, "current", Math.abs(r.i))
						set(p, "voltage", Math.abs(r.v))
						set(p, "ohms", Math.abs(r.i) > 0 ? Math.abs(r.v / r.i) : p.turn === undefined ? p.r : NaN)
						break
					case "buzzer":
						set(p, "sound", r.sound ?? 0)
						set(p, "pitch", (r.sound ?? 0) > 0 ? p.pitch : 0)
						set(p, "current", Math.abs(r.i))
						set(p, "voltage", Math.abs(r.v))
						break
					case "motor":
						set(p, "rpm", ((r.omega ?? 0) * 60) / (2 * Math.PI))
						set(p, "current", r.i)
						set(p, "voltage", r.v)
						break
					case "generator":
						set(p, "rpm", ((r.omega ?? 0) * 60) / (2 * Math.PI))
						set(p, "voltage", r.v)
						set(p, "current", -r.i)
						set(p, "angle", crank.get(p.id) ?? 0)
						break
					case "probe":
						set(p, "conducts", r.closed && Math.abs(r.i) > 1e-4 ? 1 : 0)
						set(p, "current", Math.abs(r.i))
						break
					case "solar":
						// (r.i: its cell's current out through its + terminal, positive while it powers the loop)
						set(p, "irradiance", r.irradiance ?? 0)
						set(p, "current", r.i)
						set(p, "voltage", r.v)
						set(p, "power", r.i * r.v)
						break
					case "meter":
						set(p, "reading", r.reads ?? 0)
						set(p, "current", Math.abs(r.i))
						if (p.mode === "galvanometer") set(p, "needle", needle.get(p.id)?.x ?? 0)
						break
					case "coil":
						// (an open loop's leftover rounding, under a picoamp, is no current: the magnetism module's coil reads it)
						set(p, "current", Math.abs(r.i) < 1e-12 ? 0 : r.i)
						set(p, "voltage", r.v)
						if (p.induce !== undefined) {
							set(p, "emf_mv", (r.emf ?? 0) * 1000)
							set(p, "flux_uwb", ((linkage.get(p.id) ?? 0) / p.turns) * 1e6)
						}
						break
					case "conductor":
						set(p, "current", r.i)
						set(p, "field_ut", (Math.abs(r.i) * 2e-7 * 1e6) / 0.01)
						break
				}
			}
		}
		const say = () => {
			for (; reported < sim.events.length; reported++) {
				const e = sim.events[reported]
				if (e === undefined) continue
				const p = parts.find((q) => q.id === e.part)
				const who = p?.name ?? e.item ?? e.part
				ctx.event(`${who} ${e.text}`, e.item === undefined ? [] : [e.item], e.kind, e.t)
			}
		}
		return {
			start() {
				for (const p of parts) {
					if (p.kind === "motor" && p.rotor !== undefined) {
						const r = ctx.solid(p.rotor)
						if (r === undefined) continue
						const jr = inertiaAbout(r, p.pivot ?? { x: 0, y: 0 })
						const s = p.stator === undefined ? undefined : ctx.solid(p.stator)
						const js = s !== undefined && s.dynamic ? inertiaAbout(s, { x: 0, y: 0 }) : Number.POSITIVE_INFINITY
						inertia.set(p.id, js === Number.POSITIVE_INFINITY ? jr : (jr * js) / (jr + js))
					}
					if (p.kind === "motor" && p.fan !== undefined) fanOmega.set(p.id, 0)
					if (p.kind === "generator") crank.set(p.id, 0)
					if (p.kind === "meter" && p.mode === "galvanometer") needle.set(p.id, { x: 0, v: 0 })
				}
				if (parts.some((p) => (p.kind === "coil" && p.induce !== undefined) || (p.kind === "conductor" && p.field !== undefined))) {
					const m = magnetsOf((ctx.scene.processes ?? []) as readonly { readonly kind: string; readonly [k: string]: unknown }[])
					magnets = m.magnets
					earth = m.earth
				}
			},
			step() {
				const t = ctx.time()
				const h = lastT < 0 ? 0 : t - lastT
				lastT = t
				// (a fan's rotor and a crank move on over the step before it, along the line the circuit gave them then)
				for (const p of parts) {
					if (p.kind === "motor" && p.fan !== undefined && h > 0) {
						const line = sim.line(p.id) ?? { a: 0, b: 0 }
						const w = fanOmega.get(p.id) ?? 0
						const eta = p.efficiency ?? 1
						const J = p.fan.inertia
						// implicit in ω: J(ω' − ω)/h = η·k·(a − b·k·ω') − c·|ω|·ω' − friction
						const fr = p.friction ?? 0
						const drive = eta * p.k * line.a
						const fric = Math.abs(w) > 1e-9 ? fr * Math.sign(w) : Math.abs(drive) > fr ? fr * Math.sign(drive) : drive
						let next = (w + (h * (drive - fric)) / J) / (1 + (h * (eta * p.k * p.k * line.b + p.fan.drag * Math.abs(w))) / J)
						if (w !== 0 && Math.sign(next) !== Math.sign(w) && Math.abs(drive) <= fr) next = 0
						fanOmega.set(p.id, Number.isFinite(next) ? next : 0)
						fanAngle.set(p.id, (fanAngle.get(p.id) ?? 0) + h * (Number.isFinite(next) ? next : 0))
						fanSpeed.set(p.id, Math.abs(next) * p.fan.pitch / (2 * Math.PI))
					}
					if (p.kind === "generator") crank.set(p.id, (crank.get(p.id) ?? 0) + h * shaftOmega(p))
					// (a coil's EMF over the step: the change of the flux its turns link, EMF = dλ/dt with + at a, so the current it drives makes a
					// field against the change: Lenz's law)
					if (p.kind === "coil" && p.induce !== undefined) {
						const lam = linkageOf(p)
						const before = linkage.get(p.id)
						emfNow.set(p.id, before === undefined || !(h > 0) ? 0 : (lam - before) / h)
						linkage.set(p.id, lam)
					}
				}
				sim.step(t, h, input)
				const now = sim.sample()
				// (a galvanometer's needle: a damped swing toward its current's share of full scale, implicit over the step; stopped at ±NEEDLE_STOP)
				for (const p of parts) {
					if (p.kind !== "meter" || p.mode !== "galvanometer") continue
					const nd = needle.get(p.id) ?? { x: 0, v: 0 }
					const target = (now.get(p.id)?.i ?? 0) / (p.fs ?? 0.0005)
					if (h > 0 && Number.isFinite(target)) {
						const w0 = (2 * Math.PI) / NEEDLE_PERIOD
						const v = (nd.v + h * w0 * w0 * (target - nd.x)) / (1 + 2 * NEEDLE_DAMPING * w0 * h + w0 * w0 * h * h)
						let x = nd.x + h * v
						let v2 = v
						if (x > NEEDLE_STOP || x < -NEEDLE_STOP) {
							x = x > 0 ? NEEDLE_STOP : -NEEDLE_STOP
							v2 = 0
						}
						needle.set(p.id, { x, v: v2 })
					}
				}
				write(now)
				for (const p of parts) {
					if (p.item === undefined || said.has(p.id)) continue
					const r = now.get(p.id)
					if (p.kind === "coil" && p.induce !== undefined && Math.abs(r?.emf ?? 0) >= SAY_EMF) {
						said.add(p.id)
						ctx.event(`${p.name ?? p.item} has a voltage induced in it (${(Math.abs(r?.emf ?? 0) * 1000).toFixed(1)} mV): the magnetic field through it is changing`, [p.item], "induces")
					}
					if (p.kind === "conductor" && p.field !== undefined && Math.abs(r?.i ?? 0) * 2e-5 >= SAY_FIELD) {
						said.add(p.id)
						ctx.event(`${p.name ?? p.item} carries ${Math.abs(r?.i ?? 0).toFixed(2)} A: its magnetic field 1 cm away is ${(Math.abs(r?.i ?? 0) * 20).toFixed(0)} µT`, [p.item], "field")
					}
				}
				for (const p of parts)
					if (p.kind === "motor" && p.fan !== undefined && p.item !== undefined) {
						ctx.set(p.item, key(p, "air"), fanSpeed.get(p.id) ?? 0)
						ctx.set(p.item, key(p, "angle"), fanAngle.get(p.id) ?? 0)
					}
				say()
			},
			force(_c: ProcessContext, h: number) {
				// a straight wire's field on every magnet's poles (Oersted): q·B on each face's charge, at the face
				for (const p of parts) {
					if (p.kind !== "conductor" || p.field === undefined || magnets.length === 0) continue
					const amps = sim.sample().get(p.id)?.i ?? 0
					if (!(Math.abs(amps) > 1e-9) || !Number.isFinite(amps)) continue
					const hw = ctx.solid(p.field.solid)
					if (hw === undefined) continue
					const A = worldOf(hw, p.field.from)
					const B = worldOf(hw, p.field.to)
					const az = p.field.from.z
					const bz = p.field.to.z
					const field = (x: number, y: number, z: number) => segmentField(A.x, A.y, az, B.x, B.y, bz, amps, x, y, z, WIRE_CORE)
					for (const m of magnets) {
						const hm = ctx.solid(m.solid)
						if (hm === undefined || !hm.dynamic) continue
						for (const f of polePushes(m, hm.pose(), field)) if (Number.isFinite(f.fx) && Number.isFinite(f.fy) && (f.fx !== 0 || f.fy !== 0)) hm.push(f.fx, f.fy, { x: f.x, y: f.y })
					}
				}
				for (const p of parts) {
					if (p.kind !== "motor") continue
					const line = sim.line(p.id)
					if (line === undefined) continue
					const eta = p.efficiency ?? 1
					if (p.rotor !== undefined && p.fan === undefined) {
						const r = ctx.solid(p.rotor)
						if (r === undefined) continue
						const s = p.stator === undefined ? undefined : ctx.solid(p.stator)
						const w = r.spin() - (s?.spin() ?? 0)
						const J = inertia.get(p.id) ?? 1e-6
						const tau = (eta * p.k * (line.a - line.b * p.k * w)) / (1 + (eta * p.k * p.k * line.b * h) / J)
						if (!Number.isFinite(tau)) continue
						r.twist(tau)
						if (s !== undefined && s.dynamic) s.twist(-tau)
					}
					if (p.fan !== undefined) {
						// the fan's jet on what is in it: the drag of the moving air against what the engine already gives it in still air
						const u = fanSpeed.get(p.id) ?? 0
						if (u <= 0) continue
						const f = p.fan
						const src = ctx.solid(f.solid)
						if (src === undefined) continue
						const pose = src.pose()
						const at = worldOf(src, f.at)
						const dir = f.direction + pose.angle
						const ux = Math.cos(dir)
						const uy = Math.sin(dir)
						for (const h2 of ctx.all()) {
							if (!h2.dynamic || h2.item === src.item) continue
							const o = h2.outline()
							const c = o.circle ?? (() => {
								const pts = o.points ?? []
								let x = 0
								let y = 0
								for (const q of pts) {
									x += q.x
									y += q.y
								}
								return { x: x / Math.max(1, pts.length), y: y / Math.max(1, pts.length), r: 0 }
							})()
							const air = jetSpeed(at, dir, f.diameter, u, c)
							if (air <= 0) continue
							const v = h2.velocity()
							const body = h2.part.body
							// its face across the jet: a ball's disc, a slab's or polygon's width across the flow × its depth (as the engine's drag)
							let area: number
							let cd: number
							if (body.kind === "ball") {
								area = h2.part.shape === "cylinder" && h2.part.length !== undefined ? 2 * body.radius * h2.part.length : Math.PI * body.radius * body.radius
								cd = h2.part.shape === "cylinder" ? 1.1 : SPHERE_CD
							} else {
								const pts = o.points ?? []
								let lo = Number.POSITIVE_INFINITY
								let hi = Number.NEGATIVE_INFINITY
								for (const q of pts) {
									const s2 = -q.x * uy + q.y * ux
									lo = Math.min(lo, s2)
									hi = Math.max(hi, s2)
								}
								area = (hi - lo) * body.depth
								cd = BOX_CD
							}
							const rx = air * ux - v.x
							const ry = air * uy - v.y
							const k = 0.5 * AIR * cd * area
							const sp = Math.hypot(rx, ry)
							const still = Math.hypot(v.x, v.y)
							// (with the air moving at `air` along the jet: k|u − v|(u − v), less what the engine already applies, −k|v|v)
							let fx = k * (sp * rx + still * v.x)
							let fy = k * (sp * ry + still * v.y)
							// (never more than half the gap between the air and the body closed in one step: a light, broad thing is carried, not flung)
							const m = h2.mass()
							const most = (0.5 * m * sp) / h
							const fm = Math.hypot(fx, fy)
							if (fm > most && fm > 0) {
								fx *= most / fm
								fy *= most / fm
							}
							if (Number.isFinite(fx) && Number.isFinite(fy)) h2.push(fx, fy)
						}
					}
				}
			}
		}
	}
}

export default [circuit]
