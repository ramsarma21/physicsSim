/**
 * The optics module's process kind, "optics" (tooling/src/sim/optics.ts traces the light). A scene with light items has ONE record
 * (machines/mod_optics.py's build hook): {kind: "optics", id: "optics", sources: [SourceRecord], bodies: [BodyRecord], names: [[item, name]]}.
 * Nothing here pushes a body: the light is a pure function of where things are, traced again whenever something it can reach has moved
 * (≥ 0.5 mm or 0.05°), changed size (another module resized it) or a source changed (switched, or driven by another module's reading),
 * at most every 4th step (120 Hz, the track's rate).
 *
 * Readings (track.state[item]): a source's `on` (0/1); a light meter's `lux`, `wm2`, `lit` (0/1, from its threshold); a light target's
 * `hit` (0/1) and `mw`; a screen's `shadow_cm` (the unlit length between lit stretches on its face) and `lit_pct`; an eye's `sees` (how many
 * items it sees); and `light_w` on every item once light has fallen on it (W it absorbs: heat for the heat module).
 * Events (track.events): "light" [source, item] the first time a source's light reaches an item; "shadow" [occluder, screen] the first time
 * a thing's shadow falls on a screen; "sees" [eye, item]; "tir" [item] the first total internal reflection inside a body.
 *
 * Other modules ask the light through `opticsOf(scene)` (the same run's world): what a solid absorbs (W) and the light on a solid's face
 * (W/m², for a solar cell). See web/CONTRACT.md "Optics".
 */
import {
	type BodyRecord,
	IR,
	look,
	NB,
	type OpticBody,
	type OpticsRecord,
	type OpticSource,
	type Result,
	type SourceRecord,
	sceneFromRecord,
	type SolidShape,
	switchedOn,
	trace,
	powerOf,
	bandOf,
	atan2,
	withLevels,
	levelReadings
} from "#sim/optics.ts"
import type { ProcessContext, ProcessKind, ProcessRecord, SolidHandle } from "#sim/plugins.ts"
import type { SimScene } from "#sim/part.ts"

const EVERY = 4 // steps between traces (120 Hz)
const MOVED = 0.0005 // m
const TURNED = 0.000873 // rad (0.05°)
/** A source's light "reaches" an item when the item catches at least this much of it (W), or this share of the source's power. */
const REACH_W = 1e-9
const REACH_SHARE = 1e-6

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d)
/** What a mirror's suggested aims point at: things that take light (and other light-bending things on a beam's way). */
const RECEIVERS = new Set(["sensor", "panel", "screen", "mirror", "glass", "filter", "translucent"])
const norm180 = (d: number) => {
	let x = d
	while (x > 180) x -= 360
	while (x <= -180) x += 360
	return Math.round(x * 10) / 10
}

/** What another module may ask of the light of a run. */
export interface OpticsWorld {
	/** W a solid absorbed in the last trace (its faces and, for glass, water or ice, inside it). */
	absorbed(solid: string): number
	/** W/m² falling on the face of a solid that faces `normal` (own frame), averaged over `width` m of it around `at` (own frame), all bands. */
	irradiance(solid: string, at: { x: number; y: number }, normal: { x: number; y: number }, width: number): number
	/** The last trace (undefined before the first). */
	result(): Result | undefined
}
const WORLDS = new WeakMap<SimScene<string>, OpticsWorld>()
/** The optics of a run (undefined when the scene has no light). */
export const opticsOf = (scene: SimScene<string>) => WORLDS.get(scene)

const shapeOf = (h: SolidHandle): SolidShape => {
	const k = h.scale()
	const b = h.part.body
	const base: SolidShape = { id: h.id, item: h.item, body: b as SolidShape["body"], ...(h.part.shape === undefined ? {} : { shape: h.part.shape }), ...(h.part.length === undefined ? {} : { length: h.part.length }) }
	if (k === 1) return base
	const s = (v: number) => v * k
	const body =
		b.kind === "ball"
			? { kind: "ball" as const, radius: s(b.radius) }
			: b.kind === "slab"
				? { kind: "slab" as const, width: s(b.width), height: s(b.height), depth: s(b.depth), ...(b.taper === undefined ? {} : { taper: b.taper }) }
				: { kind: "polygon" as const, points: b.points.map((p) => ({ x: s(p.x), y: s(p.y) })), depth: s(b.depth) }
	return { ...base, body, ...(h.part.length === undefined ? {} : { length: s(h.part.length) }) }
}

/** A body record's own outline (prims), scaled with its solid (a lens or mirror resized by another module: never by this catalog). */
const scaledBodies = (bodies: OpticBody[], scale: (id: string) => number): OpticBody[] =>
	bodies.map((b) => {
		const k = scale(b.id)
		if (k === 1) return b
		return {
			...b,
			halfDepth: b.halfDepth * k,
			prims: b.prims.map((p) => (p.k === "half" ? { ...p, d: p.d * k } : { ...p, cx: p.cx * k, cy: p.cy * k, r: p.r * k }))
		}
	})

const check = (r: ProcessRecord, solids: ReadonlySet<string>): string | undefined => {
	if (r.id !== "optics") return `an optics record's id is "optics" (it is ${String(r.id)})`
	if (!Array.isArray(r.sources) || !Array.isArray(r.bodies)) return "an optics record needs sources and bodies (lists)"
	for (const s of r.sources as unknown[]) {
		const o = s as Record<string, unknown>
		if (typeof o?.id !== "string" || typeof o.item !== "string" || typeof o.kind !== "string") return "a light source needs an id, an item and a kind"
		if (!["laser", "flashlight", "lamp", "sun", "object"].includes(o.kind as string)) return `light source ${o.id}: no kind "${String(o.kind)}"`
		if (typeof o.solid !== "string" || (o.solid !== "" && !solids.has(o.solid))) return `light source ${o.id}: its solid "${String(o.solid)}" is not in the document`
		for (const k of ["x", "y", "spread", "out", "size", "blur"]) if (typeof o[k] !== "number" || !Number.isFinite(o[k] as number)) return `light source ${o.id}: ${k} must be a number`
		const d = o.dir as { x?: unknown; y?: unknown } | number
		if (!(typeof d === "number" && Number.isFinite(d)) && !(typeof d === "object" && d !== null && Number.isFinite(d.x as number) && Number.isFinite(d.y as number)))
			return `light source ${o.id}: dir must be an angle (rad) or a direction {x, y}`
		if (typeof o.rays === "number" && (o.rays < 1 || o.rays > 4096)) return `light source ${o.id}: rays must be 1 to 4096`
		if (o.blink !== undefined && (!Array.isArray(o.blink) || o.blink.length > 1024 || !o.blink.every((d) => typeof d === "number" && Number.isFinite(d) && d >= 0 && d <= 3600)))
			return `light source ${o.id}: blink must list up to 1024 on/off durations (s, 0 to 3600)`
		const dv = o.drive as { item?: unknown; key?: unknown } | undefined
		if (dv !== undefined && (typeof dv !== "object" || dv === null || typeof dv.item !== "string" || typeof dv.key !== "string")) return `light source ${o.id}: drive needs an item and a key`
	}
	for (const b of r.bodies as unknown[]) {
		const o = b as Record<string, unknown>
		if (typeof o?.solid !== "string" || typeof o.role !== "string") return "an optics body needs a solid and a role"
		if (!["opaque", "glass", "mirror", "filter", "translucent", "sensor", "panel", "screen"].includes(o.role as string)) return `optics body ${o.solid}: no role "${String(o.role)}"`
	}
	return undefined
}

const optics: ProcessKind = {
	kind: "optics",
	check,
	create(record, ctx0) {
		const rec = record as unknown as OpticsRecord & { names?: [string, string][] }
		const names = new Map<string, string>((rec.names ?? []).filter((p) => Array.isArray(p) && p.length === 2) as [string, string][])
		const nameOf = (id: string) => names.get(id) ?? id
		const bodyRec = (b: OpticBody) => (b.tag === undefined ? undefined : (rec.bodies ?? [])[b.tag])
		let handles = new Map<string, SolidHandle>()
		let base: { bodies: OpticBody[]; sources: OpticSource[] } = { bodies: [], sources: [] }
		const srcRecs = (rec.sources ?? []) as SourceRecord[]
		// what is watched for change: every body's solid and every source's housing
		let watched: string[] = []
		let last: Result | undefined
		let lastPose = new Map<string, { x: number; y: number; a: number; k: number }>()
		let lastLevels: number[] = []
		let lastSurfaces: number[] = []
		let stepNo = 0
		// a blinking source: the sensors count the flashes they see (pulses: the times their light comes on)
		const anyBlink = srcRecs.some((r) => Array.isArray(r.blink) && r.blink.length > 0)
		const wasOn = new Map<string, number>()
		const pulses = new Map<string, number>()
		const reached = new Set<string>()
		const shadowSaid = new Set<string>()
		const seenSaid = new Set<string>()
		const tirSaid = new Set<string>()
		const lightSet = new Set<string>()
		const setup = (ctx: ProcessContext) => {
			handles = new Map()
			for (const h of ctx.all()) handles.set(h.id, h)
			const scene = sceneFromRecord(rec, (id) => {
				const h = handles.get(id)
				return h === undefined ? undefined : shapeOf(h)
			})
			base = { bodies: scene.bodies, sources: scene.sources }
			watched = [...new Set([...base.bodies.map((b) => b.id), ...base.sources.map((s) => s.solid).filter((s) => s !== "")])]
		}
		const levels = (ctx: ProcessContext) =>
			srcRecs.map((r) => {
				let v = switchedOn(r, ctx.time())
				const drive = (r as SourceRecord).drive
				if (v > 0 && drive !== undefined) v *= Math.max(0, num(ctx.get(drive.item, drive.key), 0)) * num(drive.scale, 1)
				return v
			})
		const publish = (ctx: ProcessContext, res: Result, lv: number[]) => {
			const bodies = base.bodies
			const anySplit = res.deposits.some((d) => d.nm > 0 && base.sources[d.src]?.nm === 0)
			// lit objects (a lit arrow's points, bottom to top) and where their points are now
			const objects: { item: string; sources: number[]; points: { x: number; y: number }[] }[] = []
			base.sources.forEach((s, i) => {
				if ((srcRecs[i] as SourceRecord).kind !== "object" || !((lv[i] as number) > 0)) return
				let o = objects.find((x) => x.item === s.item)
				if (o === undefined) objects.push((o = { item: s.item, sources: [], points: [] }))
				const h = handles.get(s.solid)
				const p = h?.pose() ?? { x: 0, y: 0, angle: 0 }
				const c = Math.cos(p.angle)
				const sn = Math.sin(p.angle)
				o.sources.push(i)
				o.points.push({ x: p.x + c * s.x - sn * s.y, y: p.y + sn * s.x + c * s.y })
			})
			// sources on/off (per item: on when any of its sources shines)
			const on = new Map<string, number>()
			srcRecs.forEach((r, i) => on.set(r.item, Math.max(on.get(r.item) ?? 0, (lv[i] as number) > 0 ? 1 : 0)))
			for (const [item, v] of on) ctx.set(item, "on", v)
			// light absorbed per item
			const absorbedItem = new Map<string, number>()
			bodies.forEach((b, i) => {
				const a = res.absorbed[i] as number
				if (a > 0 || lightSet.has(b.item)) absorbedItem.set(b.item, (absorbedItem.get(b.item) ?? 0) + a)
			})
			for (const [item, w] of absorbedItem) {
				lightSet.add(item)
				ctx.set(item, "light_w", w)
			}
			// meters and targets
			for (const s of res.sensors) {
				const br = bodyRec(bodies[s.body] as OpticBody) as (BodyRecord & { threshold?: number; target?: boolean }) | undefined
				let lit: number
				if (br?.target === true) {
					lit = s.watts > REACH_W ? 1 : 0
					ctx.set(s.item, "hit", lit)
					ctx.set(s.item, "mw", s.watts * 1000)
				} else {
					lit = s.lux >= num(br?.threshold, 10) ? 1 : 0
					ctx.set(s.item, "lux", s.lux)
					ctx.set(s.item, "wm2", s.irradiance)
					ctx.set(s.item, "lit", lit)
				}
				if (anyBlink) {
					const n = (pulses.get(s.item) ?? 0) + (lit === 1 && wasOn.get(s.item) !== 1 ? 1 : 0)
					pulses.set(s.item, n)
					wasOn.set(s.item, lit)
					ctx.set(s.item, "pulses", n)
				}
			}
			// screens: shadow length and lit share (an item's faces together)
			const screenItems = new Map<string, { shadow: number; lit: number; len: number }>()
			for (const b of bodies) if (b.role === "screen") screenItems.set(b.item, { shadow: 0, lit: 0, len: 0 })
			for (const sc of res.screens) {
				const e = screenItems.get(sc.item)
				if (e === undefined) continue
				e.shadow = Math.max(e.shadow, sc.shadow)
				e.lit = Math.max(e.lit, sc.litFraction)
			}
			for (const [item, e] of screenItems) {
				ctx.set(item, "shadow_cm", e.shadow * 100)
				ctx.set(item, "lit_pct", e.lit * 100)
			}
			// colours on a screen: the bands of split light (a prism's spectrum) that land on it, and how far violet's middle is from red's
			if (anySplit)
				for (const [item] of screenItems) {
					const at = new Map<number, { w: number; x: number; y: number }>()
					let vis = 0
					res.deposits.forEach((d) => {
						const b = bodies[d.body] as OpticBody
						if (d.volume || b.item !== item) return
						let w = 0
						for (let k = 0; k < IR; k++) w += d.incident[k] as number
						vis += w
						if (!(d.nm > 0) || !(w > 0)) return
						const band = Math.min(IR - 1, bandOf(d.nm))
						const e = at.get(band) ?? { w: 0, x: 0, y: 0 }
						e.w += w
						e.x += w * d.x
						e.y += w * d.y
						at.set(band, e)
					})
					const bands = [...at.entries()].filter(([, e]) => e.w >= 0.01 * vis)
					ctx.set(item, "colors", bands.length)
					const v = at.get(0)
					const r = at.get(IR - 1)
					ctx.set(item, "spread_mm", v && r && v.w > 0 && r.w > 0 ? 1000 * Math.sqrt((v.x / v.w - r.x / r.w) ** 2 + (v.y / v.w - r.y / r.w) ** 2) : 0)
				}
			// an object's image on a screen (a lit arrow through a lens): where each of its points' light lands (the middle) and how spread
			if (objects.length > 0)
				for (const [item] of screenItems) {
					for (const ob of objects) {
						const mid: { x: number; y: number; w: number; s2: number }[] = []
						for (const si of ob.sources) {
							let w = 0
							let x = 0
							let y = 0
							const pts: { x: number; y: number; w: number }[] = []
							for (const d of res.deposits) {
								// (the image is made by light a lens bent or a mirror turned: light straight from the object only washes the screen)
								if (d.src !== si || d.volume || d.key === 1 || (bodies[d.body] as OpticBody).item !== item) continue
								let p = 0
								for (let k = 0; k < IR; k++) p += d.incident[k] as number
								if (!(p > 0)) continue
								w += p
								x += p * d.x
								y += p * d.y
								pts.push({ x: d.x, y: d.y, w: p })
							}
							if (!(w > 0)) {
								mid.push({ x: 0, y: 0, w: 0, s2: 0 })
								continue
							}
							const cx = x / w
							const cy = y / w
							let s2 = 0
							for (const q of pts) s2 += q.w * ((q.x - cx) ** 2 + (q.y - cy) ** 2)
							mid.push({ x: cx, y: cy, w, s2: s2 / w })
						}
						const a0 = mid[0]
						const a1 = mid[mid.length - 1]
						if (!a0 || !a1 || !(a0.w > 0) || !(a1.w > 0)) continue
						// the object's own direction (its bottom point to its top) against the image's
						const o0 = ob.points[0] as { x: number; y: number }
						const o1 = ob.points[ob.points.length - 1] as { x: number; y: number }
						const ix = a1.x - a0.x
						const iy = a1.y - a0.y
						const size = Math.sqrt(ix * ix + iy * iy)
						const sgn = ix * (o1.x - o0.x) + iy * (o1.y - o0.y) < 0 ? -1 : 1
						let blur = 0
						for (const m of mid) if (m.w > 0) blur = Math.max(blur, 2 * Math.sqrt(m.s2))
						ctx.set(item, "image_cm", sgn * size * 100)
						ctx.set(item, "blur_mm", blur * 1000)
						break
					}
				}
			// light reaching items: per source, what each item catches
			const ns = base.sources.length
			bodies.forEach((b, i) => {
				for (let s = 0; s < ns; s++) {
					const w = res.bySource[i * ns + s] as number
					const src = base.sources[s] as OpticSource
					if (src.item === b.item) continue
					let total = 0
					for (let k = 0; k < NB; k++) total += src.power[k] as number
					if (!(w > Math.max(REACH_W, REACH_SHARE * total * (src.kind === "sun" ? 1 : 1)))) continue
					const key = `${src.item}\u0000${b.item}`
					if (reached.has(key)) continue
					reached.add(key)
					ctx.event(`${nameOf(src.item)}'s light reaches ${nameOf(b.item)}`, [src.item, b.item], "light")
				}
			})
			// shadows on screens
			for (const sc of res.screens) {
				for (const c of sc.casters) {
					if (c.to - c.from < 0.001 || c.item === sc.item) continue
					const key = `${c.item}\u0000${sc.item}`
					if (shadowSaid.has(key)) continue
					shadowSaid.add(key)
					ctx.event(`${nameOf(c.item)} casts a shadow on ${nameOf(sc.item)} (${((c.to - c.from) * 100).toFixed(1)} cm)`, [c.item, sc.item], "shadow")
				}
			}
			// eyes
			const srcItems = base.sources.map((s) => s.item)
			bodies.forEach((b, i) => {
				const br = bodyRec(b) as (BodyRecord & { eye?: number; pupil?: number; look?: number }) | undefined
				if (br?.eye === undefined) return
				const seen = look(res, i, { fovHalf: num(br.eye, 1.0472), pupil: num(br.pupil, 0.013), dir: num(br.look, 0), sourceItems: srcItems }).filter((e) => e.item !== b.item)
				ctx.set(b.item, "sees", seen.length)
				for (const e of seen) {
					const key = `${b.item}\u0000${e.item}`
					if (seenSaid.has(key)) continue
					seenSaid.add(key)
					const via = e.via.length ? ` (by ${e.via.map(nameOf).join(", ")})` : ""
					ctx.event(`${nameOf(b.item)} sees ${nameOf(e.item)}${via}`, [b.item, e.item], "sees")
				}
			})
			// total internal reflection
			bodies.forEach((b, i) => {
				if ((res.tir[i] as number) === 0 || tirSaid.has(b.item)) return
				tirSaid.add(b.item)
				ctx.event(`Light is totally reflected inside ${nameOf(b.item)}`, [b.item], "tir")
			})
			// a flat mirror that a beam meets: which way the beam arrives (beam_in_deg) and the aim (its `aim` prop, degrees) that would send
			// it at the middle of each thing that takes light (aim_for:<item>), for the AI's edits: the face's normal halves the angle between
			// back along the beam and toward the target
			bodies.forEach((b, i) => {
				const br = bodyRec(b) as (BodyRecord & { aim?: number }) | undefined
				if (b.role !== "mirror" || br?.aim === undefined) return
				let best: Result["deposits"][number] | undefined
				let bw = 0
				for (const d of res.deposits) {
					// (light on its silvered face only: a beam on its painted back is not steered)
					if (d.body !== i || d.volume || (b.faces !== undefined && !b.faces.includes(d.prim))) continue
					let w = 0
					for (let k = 0; k < NB; k++) w += d.incident[k] as number
					if (w > bw) {
						bw = w
						best = d
					}
				}
				if (best === undefined || !(bw > 0)) return
				const h = handles.get(b.id)
				if (h === undefined) return
				const solidDeg = (h.pose().angle * 180) / Math.PI
				const itemDeg = solidDeg - (br.aim as number)
				const inA = atan2(best.dy, best.dx)
				ctx.set(b.item, "beam_in_deg", norm180((inA * 180) / Math.PI))
				const seen = new Set<string>()
				bodies.forEach((o) => {
					if (o.item === b.item || seen.has(o.item) || !(RECEIVERS.has(o.role) || (bodyRec(o) as { eye?: number } | undefined)?.eye !== undefined)) return
					seen.add(o.item)
					const oh = handles.get(o.id)
					if (oh === undefined) return
					const q = oh.pose()
					const outA = atan2(q.y - best.y, q.x - best.x)
					const back = inA + Math.PI
					const bis = atan2(Math.sin(back) + Math.sin(outA), Math.cos(back) + Math.cos(outA))
					ctx.set(b.item, `aim_for:${o.item}`, norm180((bis * 180) / Math.PI - itemDeg))
				})
			})
		}
		const run = (ctx: ProcessContext, force: boolean) => {
			const read = (item: string, key: string) => ctx.get(item, key)
			const lv = levels(ctx)
			// what moved, turned or changed size since the last trace; a liquid's surface that rose or fell 0.05 mm (the liquids module's level)
			let changed = force || lv.length !== lastLevels.length || lv.some((v, i) => Math.abs(v - (lastLevels[i] as number)) > 1e-3 * Math.max(1, Math.abs(v)))
			const surf = levelReadings(base.bodies, read)
			if (surf.length !== lastSurfaces.length || surf.some((v, i) => !(Math.abs(v - (lastSurfaces[i] as number)) <= 0.05) && !(Number.isNaN(v) && Number.isNaN(lastSurfaces[i] as number))))
				changed = true
			const now = new Map<string, { x: number; y: number; a: number; k: number }>()
			let resized = false
			for (const id of watched) {
				const h = handles.get(id)
				if (h === undefined) continue
				const p = h.pose()
				const q = { x: p.x, y: p.y, a: p.angle, k: h.scale() }
				now.set(id, q)
				const o = lastPose.get(id)
				if (o === undefined) changed = true
				else {
					if (Math.abs(q.x - o.x) >= MOVED || Math.abs(q.y - o.y) >= MOVED || Math.abs(q.a - o.a) >= TURNED) changed = true
					if (Math.abs(q.k - o.k) > 0.005 * Math.max(o.k, 1e-9)) {
						changed = true
						resized = true
					}
				}
			}
			if (!changed && last !== undefined) return
			if (resized) setup(ctx)
			const scaled = withLevels(scaledBodies(base.bodies, (id) => now.get(id)?.k ?? 1), read)
			lastSurfaces = surf
			const res = trace({
				bodies: scaled,
				sources: base.sources,
				pose: (id) => {
					const q = now.get(id)
					return q === undefined ? undefined : { x: q.x, y: q.y, angle: q.a }
				},
				level: (s) => lv[base.sources.indexOf(s)] ?? 0
			})
			last = res
			lastPose = now
			lastLevels = lv
			publish(ctx, res, lv)
		}
		const world: OpticsWorld = {
			absorbed: (solid) => {
				const i = base.bodies.findIndex((b) => b.id === solid)
				return i < 0 || last === undefined ? 0 : (last.absorbed[i] as number)
			},
			irradiance: (solid, at, normal, width) => {
				const i = base.bodies.findIndex((b) => b.id === solid)
				if (i < 0 || last === undefined) return 0
				const h = handles.get(solid)
				if (h === undefined) return 0
				const p = h.pose()
				const c = Math.cos(p.angle)
				const s = Math.sin(p.angle)
				const nx = normal.x * c - normal.y * s
				const ny = normal.x * s + normal.y * c
				const ax = p.x + at.x * c - at.y * s
				const ay = p.y + at.x * s + at.y * c
				let w = 0
				for (const d of last.deposits) {
					if (d.body !== i || d.volume || d.nx * nx + d.ny * ny < 0.9) continue
					const along = Math.abs(-(d.x - ax) * ny + (d.y - ay) * nx)
					if (along > width / 2) continue
					for (let b = 0; b < NB; b++) w += d.incident[b] as number
				}
				const depth = 2 * (base.bodies[i] as OpticBody).halfDepth
				return w / Math.max(1e-8, width * depth)
			},
			result: () => last
		}
		WORLDS.set(ctx0.scene, world)
		void IR
		return {
			start(ctx) {
				setup(ctx)
				run(ctx, true)
			},
			step(ctx) {
				stepNo++
				if (stepNo % EVERY !== 0) return
				run(ctx, false)
			}
		}
	}
}

export default optics
