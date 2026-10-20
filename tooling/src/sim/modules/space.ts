/**
 * GRAVITY + SPACE: the orbit mode's engine process (machines/mod_space.py and web/sim/modules/space.js build its records).
 *
 *   space-body {solid, mu (m³/s², scene units: G·M at the scene's scale; 0 for a satellite), radius (m: inside it the pull falls off
 *              linearly), radius_km (its real radius), fixed (held still), star (a sun: it lights the moons' phases), launch?: {factor,
 *              direction: "ccw" | "cw"}, primary (a solid id or null: what it is launched round), km_per_m, s_per_s (the scene's scale)}
 *
 * All the records of a run are one system (the first record's process does the work; the others only mark their bodies):
 *  - every (sub-)step after the release, every moving solid of the scene is pulled by every attracting body (mu > 0) but itself,
 *    a = mu·d/|d|³ toward its centre, mu·d/R³ inside its radius R (a uniform sphere: the shell theorem), as a force m·a at the solid's
 *    own middle (tooling/src/sim/space.ts `pull`);
 *  - at the first step after the release, every body with a launch gets its circular-orbit velocity round its primary times its factor,
 *    heaviest first, each pair's barycentre kept (space.ts `launchVelocities`), given as one step's impulse m·v/h (the step then moves
 *    it h·v, exactly as a body that started with v);
 *  - readings, for a body with a primary, every step (they lag the placements by one 1/480 s step): distance (m) and distance_km, speed
 *    round it (m/s) and speed_kms, turns (signed in its own direction: + the way it goes round), fell (1 once it has struck its primary),
 *    escaped (1 while its energy relative to its primary is ≥ 0 and it moves away), altitude_km for a satellite (mu 0), and for a moon of a
 *    planet in a scene with a sun: lit (the fraction of its disc its planet sees lit) and elongation (°, from the sun, 0 new, 180 full);
 *  - a moon's tilted orbit (`tilt`° to its planet's orbit round the sun, its ascending node `node`° on from the sun's direction at the start,
 *    counted the way it goes round: the 2D model is the orbit seen from above, the tilt an out-of-plane height z = (its distance across the
 *    line of nodes)·tan(tilt)): height_km and latitude (° above its planet's orbital plane), and eclipses from the REAL sizes and distances
 *    (km: the cones of space.ts shadowCone): lunar_eclipse (0 none, 1 penumbral, 2 partial, 3 total), solar_eclipse (0, 1 partial, 2 annular,
 *    3 total); a far sun at `sun_km` (the planet's real distance from the Sun);
 *  - a planet's seasons (`seasons` {tilt, date, lat}: its axis tilted `tilt`° and kept pointing one way, leaning for `date` at the start):
 *    sun_lat (where the Sun is overhead), noon_elevation and day_length_h at the town's latitude (space.ts seasonsAt), and night_lon (the
 *    ecliptic longitude of the midnight sky: the Sun's + 180°, the Sun's 0 at the March equinox);
 *  - events: "<item> completed orbit n", "<item> fell onto <primary>", "<item> escaped <primary>'s pull", "a total lunar eclipse ...".
 * Deterministic: + − × ÷, Math.sqrt and the engine's own Math.atan2 (tools/fdlibm.ts in the bundle and on the server).
 */
import type { ProcessContext, ProcessKind, ProcessRecord, SolidHandle } from "#sim/plugins.ts"
import {
	type Attractor,
	asinDeg,
	carriedAt,
	dayLength,
	declination,
	globeAxis,
	globeMeridian,
	globeTown,
	type Launch,
	type LaunchBody,
	type LightAt,
	launchVelocities,
	lunarEclipse,
	moonPhase,
	phase3D,
	primaryOf,
	pull,
	seasonLean,
	seasonsAt,
	shadowLength,
	solarEclipse,
	sunAt,
	towardLight,
	type V3
} from "#sim/space.ts"

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d)
/**
 * The strongest pull a body may have, as the speed of a circle just above its drawn surface, m/s: μ is held at SURFACE_ORBIT²·R (R at least
 * 1 cm). No scene at a scale that fits its bodies comes near it (the Sun of the inner-planets scale: 1.8 m/s at its surface; an Earth of the
 * Earth-Moon scale 4 m/s; Jupiter of its moons' scale 1.5 m/s; the low-orbit Earth 0.47 m/s); a body far too heavy for its scale (the Sun
 * dropped into an Earth-Moon scene, μ 1.5·10⁵ m³/s²) would fling everything at the engine's speed limit and grind the run down in collisions:
 * it is held there and said once (an event).
 */
const SURFACE_ORBIT = 20
const itemOf = (id: string) => (id.includes("/") ? id.slice(0, id.indexOf("/")) : id)
const TAU = 2 * Math.PI
const RAD = Math.PI / 180
/** 1 au, km [IAU 2012 B2]: a far sun's distance when the record does not say. */
const AU_KM = 149597870.7
const SEASON_DATES = ["march equinox", "june solstice", "september equinox", "december solstice"]
const seasonsOf = (r: ProcessRecord) => {
	const q = r.seasons as { tilt?: unknown; date?: unknown; lat?: unknown } | undefined | null
	if (q === undefined || q === null || typeof q !== "object") return undefined
	const date = typeof q.date === "string" && SEASON_DATES.includes(q.date) ? q.date : "march equinox"
	return { seasons: { tilt: Math.max(0, Math.min(180, num(q.tilt, 23.44))), date, lat: Math.max(-90, Math.min(90, num(q.lat, 0))) } }
}

interface Body {
	readonly record: ProcessRecord
	readonly item: string
	readonly solid: string
	/** μ in the scene's units (held at SURFACE_ORBIT² R for a body too heavy for its scale) */
	mu: number
	readonly radius: number
	readonly radiusKm: number
	readonly fixed: boolean
	readonly star: boolean
	/** a moon: its phase is read (with a sun in the scene) */
	readonly phase: boolean
	/** a far-away sun: it only shines, its light parallel */
	readonly far: boolean
	readonly launch?: Launch
	readonly primaryId: string | null
	readonly kmPerM: number
	readonly sPerS: number
	handle?: SolidHandle
	/** index of its primary in the system's bodies, -1 for none */
	primary: number
	/** +1 counter-clockwise, -1 clockwise: the way it goes round its primary */
	sense: number
	sensed: boolean
	turns: number
	angle: number
	fell: boolean
	escaped: boolean
	saidEscape: boolean
	orbitsSaid: number
	/** a moon's orbit's tilt to its planet's orbit (°; 0: in the plane) and its ascending node (° on from the sun at the start) */
	readonly tilt: number
	readonly node: number
	/** the ascending node's direction in the plane (rad), fixed at the start */
	nodeAt: number
	/** a far sun's real distance from the planet (km) */
	readonly sunKm: number
	/** the deepest eclipse of the one going on (lunar, solar), said when it ends */
	lunar: number
	solar: number
	/** a planet's seasons: its axis tilt (°), the date at the start, the town's latitude (°); lean: the in-plane way its pole leans */
	readonly seasons?: { readonly tilt: number; readonly date: string; readonly lat: number }
	lean?: { x: number; y: number }
	/** the Sun's direction from it at the start (unit, in the plane), for the midnight sky's longitude */
	sun0?: { x: number; y: number }
}

/** The middle of a solid now: a ball's or a slab's centre, a polygon's centroid. */
const middleOf = (h: SolidHandle) => {
	const b = h.part.body
	if (b.kind !== "polygon") {
		const p = h.pose()
		return { x: p.x, y: p.y }
	}
	const pts = h.outline().points ?? []
	let a = 0
	let cx = 0
	let cy = 0
	for (let i = 0; i < pts.length; i++) {
		const p = pts[i] as { x: number; y: number }
		const q = pts[(i + 1) % pts.length] as { x: number; y: number }
		const c = p.x * q.y - q.x * p.y
		a += c
		cx += (p.x + q.x) * c
		cy += (p.y + q.y) * c
	}
	if (a === 0) {
		const p = h.pose()
		return { x: p.x, y: p.y }
	}
	return { x: cx / (3 * a), y: cy / (3 * a) }
}

class System {
	readonly bodies: Body[]
	/** the bodies that attract, by index into `bodies` */
	readonly pullers: number[]
	readonly bySolid = new Map<string, number>()
	launched = false
	started = false
	/** the bodies whose pull is held at SURFACE_ORBIT (too heavy for the scene's scale) */
	readonly held: Body[]
	star = -1
	constructor(records: readonly ProcessRecord[]) {
		this.bodies = records.map((r) => {
			const launch = r.launch as { factor?: unknown; direction?: unknown } | undefined
			const factor = num(launch?.factor, 0)
			return {
				record: r,
				item: typeof r.item === "string" ? r.item : itemOf(String(r.solid)),
				solid: String(r.solid),
				mu: Math.max(0, num(r.mu, 0)),
				radius: Math.max(0, num(r.radius, 0)),
				radiusKm: Math.max(0, num(r.radius_km, 0)),
				fixed: r.fixed === true,
				star: r.star === true,
				phase: r.phase === true,
				far: r.far === true,
				...(launch !== undefined && factor > 0 ? { launch: { factor, direction: launch.direction === "cw" ? "cw" : "ccw" } as Launch } : {}),
				primaryId: typeof r.primary === "string" ? r.primary : null,
				kmPerM: num(r.km_per_m, 1),
				sPerS: num(r.s_per_s, 1),
				primary: -1,
				sense: launch?.direction === "cw" ? -1 : 1,
				sensed: false,
				turns: 0,
				angle: 0,
				fell: false,
				escaped: false,
				saidEscape: false,
				orbitsSaid: 0,
				tilt: Math.max(0, Math.min(90, num(r.tilt, 0))),
				node: num(r.node, 0),
				nodeAt: 0,
				sunKm: Math.max(1, num(r.sun_km, AU_KM)),
				lunar: 0,
				solar: 0,
				...(seasonsOf(r) ?? {})
			}
		})
		this.held = this.bodies.filter((b) => b.mu > SURFACE_ORBIT * SURFACE_ORBIT * Math.max(b.radius, 0.01))
		for (const b of this.held) b.mu = SURFACE_ORBIT * SURFACE_ORBIT * Math.max(b.radius, 0.01)
		this.pullers = this.bodies.flatMap((b, i) => (b.mu > 0 ? [i] : []))
		this.bodies.forEach((b, i) => this.bySolid.set(b.solid, i))
	}

	start(ctx: ProcessContext) {
		if (this.started) return
		this.started = true
		for (const b of this.held) ctx.event(`${b.item} is too heavy to show at this scale: its pull is held to a ${SURFACE_ORBIT} m/s orbit at its surface`, [b.item], "held")
		for (const b of this.bodies) b.handle = ctx.solid(b.solid)
		const at = (i: number) => {
			const h = this.bodies[i]?.handle
			if (h === undefined) return { x: 0, y: 0 }
			const p = h.pose()
			return { x: p.x, y: p.y }
		}
		const attractors: Attractor[] = this.pullers.map((i) => ({ at: at(i), mu: (this.bodies[i] as Body).mu, radius: 0 }))
		// the sun of the system: its heaviest star
		let best = -1
		for (let i = 0; i < this.bodies.length; i++) {
			const b = this.bodies[i] as Body
			if (b.star && b.handle !== undefined && (best < 0 || b.mu > (this.bodies[best] as Body).mu)) best = i
		}
		this.star = best
		this.bodies.forEach((b, i) => {
			// (a sun circles nothing: a pulling one is the heaviest, a far one only shines)
			if (b.handle === undefined || b.star) return
			let p = -1
			if (b.primaryId !== null) {
				const j = this.bySolid.get(b.primaryId)
				if (j !== undefined && j !== i && (this.bodies[j] as Body).mu > 0 && (this.bodies[j] as Body).handle !== undefined) p = j
			}
			if (p < 0) {
				const k = primaryOf(attractors, at(i), b.mu, this.pullers.indexOf(i))
				p = k < 0 ? -1 : (this.pullers[k] as number)
			}
			b.primary = p
			if (p >= 0) {
				const c = at(p)
				const q = at(i)
				b.angle = Math.atan2(q.y - c.y, q.x - c.x)
			}
		})
		// a tilted moon's line of nodes and a planet's leaning pole: fixed in space, from the sun's direction at the start
		const sun0 = this.star >= 0 ? at(this.star) : null
		if (sun0 !== null)
			this.bodies.forEach((b, i) => {
				if (b.handle === undefined || b.star) return
				if (b.phase && b.primary >= 0 && b.primary !== this.star) {
					const P = at(b.primary)
					b.nodeAt = Math.atan2(sun0.y - P.y, sun0.x - P.x) + b.sense * b.node * RAD
				}
				if (b.seasons !== undefined) {
					const q = at(i)
					const dx = sun0.x - q.x
					const dy = sun0.y - q.y
					const l = Math.sqrt(dx * dx + dy * dy)
					if (l > 0) {
						b.lean = seasonLean(b.seasons.date, dx / l, dy / l, b.sense)
						b.sun0 = { x: dx / l, y: dy / l }
					}
				}
			})
		this.read(ctx)
	}

	/** The eclipses still going on at the end of the run, said. */
	finish(ctx: ProcessContext) {
		for (const b of this.bodies) this.sayEclipses(ctx, b, 0, 0)
	}

	/** An eclipse is said when it ends, by the deepest it got (lunar: penumbral, partial, total; solar: partial, annular, total). */
	sayEclipses(ctx: ProcessContext, b: Body, lunar: number, solar: number) {
		const c = b.primary >= 0 ? (this.bodies[b.primary] as Body) : undefined
		const who = c?.item ?? "its planet"
		if (lunar > 0) b.lunar = Math.max(b.lunar, lunar)
		else if (b.lunar > 0) {
			ctx.event(`a ${["", "penumbral", "partial", "total"][b.lunar]} lunar eclipse: ${who}'s shadow on ${b.item}`, [b.item, who], "lunar eclipse")
			b.lunar = 0
		}
		if (solar > 0) b.solar = Math.max(b.solar, solar)
		else if (b.solar > 0) {
			ctx.event(`a ${["", "partial", "annular", "total"][b.solar]} solar eclipse: ${b.item}'s shadow on ${who}`, [b.item, who], "solar eclipse")
			b.solar = 0
		}
	}

	/**
	 * The launch, once, at the first step after the release: one step's impulse on each launched body that gives it velocity v less half a
	 * step of the pull on it, m·(v/h − a/2), so with the pull of that step (m·a, pushed by `pullAll`) its velocity after the step is
	 * v + h·a/2: the half-step velocity of leapfrog (velocity Verlet). planck's step (v += h·a, then x += h·v) is then exactly leapfrog,
	 * second-order: a circular orbit stays circular to (ω·h)² (started at v itself it would be an ellipse of eccentricity ω·h/2).
	 * `accel`: the pull on each body's middle now (by solid id).
	 */
	launch(h: number, accel: ReadonlyMap<string, { x: number; y: number }>) {
		this.launched = true
		const list: LaunchBody[] = this.bodies.map((b) => {
			const p = b.handle?.pose()
			return {
				at: { x: p?.x ?? 0, y: p?.y ?? 0 },
				mu: b.mu,
				fixed: b.fixed || b.handle === undefined || !b.handle.dynamic,
				...(b.launch === undefined ? {} : { launch: b.launch }),
				...(b.primary >= 0 ? { around: b.primary } : {})
			}
		})
		const v = launchVelocities(list)
		this.bodies.forEach((b, i) => {
			const w = v[i]
			const hd = b.handle
			if (w === undefined || hd === undefined || !hd.dynamic || (w.x === 0 && w.y === 0)) return
			const m = hd.mass()
			const a = accel.get(b.solid) ?? { x: 0, y: 0 }
			hd.push(m * (w.x / h - a.x / 2), m * (w.y / h - a.y / 2))
		})
	}

	/** Newton's gravity of the attracting bodies on every moving solid: the accelerations it gave (by solid id). */
	pullAll(ctx: ProcessContext) {
		const given = new Map<string, { x: number; y: number }>()
		if (this.pullers.length === 0) return given
		const attractors: Attractor[] = []
		const index = new Map<string, number>()
		for (const i of this.pullers) {
			const b = this.bodies[i] as Body
			if (b.handle === undefined) continue
			const p = b.handle.pose()
			index.set(b.solid, attractors.length)
			attractors.push({ at: { x: p.x, y: p.y }, mu: b.mu, radius: b.radius })
		}
		for (const h of ctx.all()) {
			if (!h.dynamic) continue
			const a = pull(attractors, middleOf(h), index.get(h.id) ?? -1)
			if (a.x === 0 && a.y === 0) continue
			const m = h.mass()
			h.push(m * a.x, m * a.y)
			given.set(h.id, a)
		}
		return given
	}

	/** The readings and events of every body that circles something. */
	read(ctx: ProcessContext) {
		const released = ctx.released()
		const star = this.star >= 0 ? (this.bodies[this.star] as Body) : undefined
		const sun = star?.handle?.pose()
		for (const b of this.bodies) {
			// a planet's seasons: where its Sun is overhead and the town's noon Sun and day, its pole leaning one way all round its orbit
			if (b.seasons !== undefined && b.lean !== undefined && b.handle !== undefined && sun !== undefined) {
				const Q = b.handle.pose()
				const dx = sun.x - Q.x
				const dy = sun.y - Q.y
				const l = Math.sqrt(dx * dx + dy * dy)
				if (l > 0) {
					const q = seasonsAt(b.seasons.tilt, b.lean.x, b.lean.y, dx / l, dy / l, b.seasons.lat)
					ctx.set(b.item, "sun_lat", q.dec)
					ctx.set(b.item, "noon_elevation", q.noon)
					ctx.set(b.item, "day_length_h", q.dayLength)
					// the midnight sky: the ecliptic longitude opposite the Sun (the Sun's own longitude: 0 at the March equinox, 90 June's, ... growing
					// the way the planet goes round), where the constellations on the ecliptic stand highest at midnight
					if (b.sun0 !== undefined) {
						const sx = dx / l
						const sy = dy / l
						const turned = Math.atan2(b.sun0.x * sy - b.sun0.y * sx, b.sun0.x * sx + b.sun0.y * sy) / RAD
						let lon = (SEASON_DATES.indexOf(b.seasons.date) * 90 + b.sense * turned + 180) % 360
						if (lon < 0) lon += 360
						ctx.set(b.item, "night_lon", lon)
					}
				}
			}
			if (b.primary < 0 || b.handle === undefined) continue
			const c = this.bodies[b.primary] as Body
			if (c.handle === undefined) continue
			const P = c.handle.pose()
			const Q = b.handle.pose()
			const dx = Q.x - P.x
			const dy = Q.y - P.y
			const r = Math.sqrt(dx * dx + dy * dy)
			const vb = b.handle.velocity()
			const vc = c.handle.velocity()
			const vx = vb.x - vc.x
			const vy = vb.y - vc.y
			const v = Math.sqrt(vx * vx + vy * vy)
			const item = b.item
			if (released) {
				if (b.launch === undefined && !b.sensed) {
					// (a body nobody launched goes round the way it is moving when it is first seen moving)
					const L0 = dx * vy - dy * vx
					if (L0 !== 0) {
						b.sense = L0 > 0 ? 1 : -1
						b.sensed = true
					}
				}
				const angle = Math.atan2(dy, dx)
				let d = angle - b.angle
				if (d > Math.PI) d -= TAU
				else if (d <= -Math.PI) d += TAU
				b.angle = angle
				if (!b.fell) b.turns += (b.sense * d) / TAU
				if (!b.fell && ctx.touching(b.solid).includes(c.solid)) {
					b.fell = true
					ctx.event(`${item} fell onto ${c.item}`, [item, c.item], "fell")
				}
				const energy = (v * v) / 2 - (c.mu + b.mu) / Math.max(r, 1e-9)
				b.escaped = !b.fell && energy >= 0 && dx * vx + dy * vy > 0
				if (b.escaped && !b.saidEscape) {
					b.saidEscape = true
					ctx.event(`${item} escaped ${c.item}'s pull`, [item, c.item], "escaped")
				}
				while (!b.fell && b.turns >= b.orbitsSaid + 1) {
					b.orbitsSaid += 1
					ctx.event(`${item} completed orbit ${b.orbitsSaid} round ${c.item}`, [item, c.item], "orbit")
				}
			}
			ctx.set(item, "distance", r)
			ctx.set(item, "distance_km", r * b.kmPerM)
			ctx.set(item, "speed", v)
			ctx.set(item, "speed_kms", (v * b.kmPerM) / b.sPerS)
			ctx.set(item, "turns", b.turns)
			ctx.set(item, "fell", b.fell ? 1 : 0)
			ctx.set(item, "escaped", b.escaped ? 1 : 0)
			if (b.mu === 0) ctx.set(item, "altitude_km", r * b.kmPerM - c.radiusKm)
			// a moon of a planet that is lit by the system's sun: its phase as the planet sees it
			if (b.phase && sun !== undefined && b.primary !== this.star) {
				const L = dx * vy - dy * vx
				const ccw = L === 0 ? b.sense > 0 : L > 0
				// (a far-away Sun's light is parallel: its direction from the planet, the Sun taken a million times as far along it)
				const S = star?.far === true ? { x: P.x + (sun.x - P.x) * 1e6, y: P.y + (sun.y - P.y) * 1e6 } : { x: sun.x, y: sun.y }
				const ph = moonPhase(S, { x: P.x, y: P.y }, { x: Q.x, y: Q.y }, ccw)
				ctx.set(item, "lit", ph.lit)
				ctx.set(item, "elongation", ph.elongation)
				// its tilted orbit: its height above the planet's orbital plane (its distance across the line of nodes · tan tilt), and eclipses
				// at the real sizes and distances, km (the drawn bodies are larger than true; the shadows' cones are the real ones)
				const tanI = b.tilt > 0 ? Math.sin(b.tilt * RAD) / Math.cos(b.tilt * RAD) : 0
				const z = b.sense * (Math.cos(b.nodeAt) * dy - Math.sin(b.nodeAt) * dx) * tanI
				const k = b.kmPerM
				ctx.set(item, "height_km", z * k)
				ctx.set(item, "latitude", Math.atan2(z, r) / RAD)
				const sx = sun.x - P.x
				const sy = sun.y - P.y
				const sl = Math.sqrt(sx * sx + sy * sy)
				if (star !== undefined && sl > 0) {
					const Sk: V3 = star.far === true ? { x: P.x * k + (sx / sl) * b.sunKm, y: P.y * k + (sy / sl) * b.sunKm, z: 0 } : { x: sun.x * k, y: sun.y * k, z: 0 }
					const light: LightAt = { parallel: false, p: Sk, radius: star.radiusKm }
					const planet = { at: { x: P.x * k, y: P.y * k, z: 0 }, r: c.radiusKm }
					const moon = { at: { x: Q.x * k, y: Q.y * k, z: z * k }, r: b.radiusKm }
					const lunar = lunarEclipse(light, planet, moon)
					const solar = solarEclipse(light, moon, planet)
					ctx.set(item, "lunar_eclipse", lunar)
					ctx.set(item, "solar_eclipse", solar)
					if (released) this.sayEclipses(ctx, b, lunar, solar)
				}
			}
		}
	}
}

const body: ProcessKind = {
	kind: "space-body",
	check: (r, solids) => {
		if (typeof r.solid !== "string" || !solids.has(r.solid)) return "its solid is not in the document"
		if (typeof r.mu !== "number" || !Number.isFinite(r.mu) || r.mu < 0) return "mu must be a number of m³/s², 0 or more"
		if (r.primary !== undefined && r.primary !== null && typeof r.primary !== "string") return "primary must be a solid id or null"
		const l = r.launch as { factor?: unknown; direction?: unknown } | undefined
		if (l !== undefined && (typeof l !== "object" || l === null || typeof l.factor !== "number" || !Number.isFinite(l.factor) || l.factor < 0 || l.factor > 10))
			return "launch.factor must be a number from 0 to 10"
		return undefined
	},
	create(record: ProcessRecord, ctx: ProcessContext) {
		const records = (ctx.scene.processes ?? []).filter((p) => p.kind === "space-body")
		const leader = records[0]?.id === record.id
		if (!leader) return {}
		const sys = new System(records)
		return {
			start: (c) => sys.start(c),
			step: (c) => {
				if (c.released()) sys.read(c)
			},
			end: (c) => sys.finish(c),
			force: (c, h) => {
				const a = sys.pullAll(c)
				if (!sys.launched) sys.launch(h, a)
			}
		}
	}
}

/**
 * sun-clock {solid, height, latitude, season, day, hour, lapse}: a shadow stick's Sun. Solar time runs from `hour` at the scene's time-lapse
 * (hour + t·lapse/3600, round the clock); every step its readings: hour, sun_elevation and sun_azimuth (from north, clockwise), shadow_m (the
 * stick's shadow on level ground, 0 with the Sun down) and shadow_dir (its bearing: away from the Sun), day_length_h (space.ts sunAt, dayLength).
 */
const sunClock: ProcessKind = {
	kind: "sun-clock",
	check: (r) => {
		for (const k of ["height", "latitude", "hour", "lapse"]) if (typeof r[k] !== "number" || !Number.isFinite(r[k] as number)) return `${k} must be a number`
		if (Math.abs(r.latitude as number) > 90) return "latitude must be within ±90°"
		return undefined
	},
	create(r) {
		const item = typeof r.item === "string" ? r.item : itemOf(String(r.solid))
		const h = num(r.height, 1)
		const lat = num(r.latitude, 0)
		const dec = declination(typeof r.season === "string" ? r.season : "march equinox", num(r.day, 80))
		const hour0 = num(r.hour, 12)
		const lapse = num(r.lapse, 1)
		const len = dayLength(lat, dec)
		const read = (ctx: ProcessContext) => {
			let hour = hour0 + (ctx.time() * lapse) / 3600
			hour -= 24 * Math.floor(hour / 24)
			const sun = sunAt(lat, dec, hour)
			const dir = sun.azimuth + 180
			ctx.set(item, "hour", hour)
			ctx.set(item, "sun_elevation", sun.elevation)
			ctx.set(item, "sun_azimuth", sun.azimuth)
			ctx.set(item, "shadow_m", shadowLength(h, sun.elevation))
			ctx.set(item, "shadow_dir", dir >= 360 ? dir - 360 : dir)
			ctx.set(item, "day_length_h", len)
		}
		return { start: read, step: read }
	}
}

// ---------------------------------------------------------------- the classroom Sun-Earth-Moon models (a globe under a lamp, a moon ball on a stick)
/** The real Sun's angular radius seen from the Earth (rad): 695,700 km at 1 au [NASA-PFS, IAU 2015 B3]. */
const SUN_ANGULAR = 695700 / AU_KM

/**
 * What lights a globe or a moon ball (the catalog's build hook finds it: mod_space.py _lights): a point light on a solid (a lamp's bulb:
 * `frame` "world", the offset from the solid's place as the heat module's lamp gives it; a flashlight's lens: `frame` "solid", turned with
 * it; a Sun in the scene), parallel light travelling along `dir` (rad: sunlight), or a far Sun (parallel, from where it is drawn). `from`: the
 * run time it comes on (a lamp switched on later; 1e9 = off).
 */
interface LightSpec {
	readonly kind: "point" | "parallel" | "far"
	readonly solid: string
	readonly x: number
	readonly y: number
	readonly frame: "world" | "solid"
	readonly radius: number
	readonly dir: number
	readonly from: number
}
const lightSpec = (v: unknown): LightSpec | null => {
	if (v === null || typeof v !== "object") return null
	const o = v as Record<string, unknown>
	const kind = o.kind === "parallel" || o.kind === "far" ? o.kind : o.kind === "point" ? "point" : null
	if (kind === null) return null
	if (kind !== "parallel" && typeof o.solid !== "string") return null
	return {
		kind,
		solid: typeof o.solid === "string" ? o.solid : "",
		x: num(o.x, 0),
		y: num(o.y, 0),
		frame: o.frame === "solid" ? "solid" : "world",
		radius: Math.max(0, num(o.radius, 0.03)),
		dir: num(o.dir, 0),
		from: num(o.from, 0)
	}
}
/** The light where it is now (a point light follows its solid; a far Sun's direction is fixed at its first look from c), or null if gone. */
const lightNow = (ctx: ProcessContext, spec: LightSpec, c: V3, far: { v?: V3 }): LightAt | null => {
	if (spec.kind === "parallel") return { parallel: true, p: { x: -Math.cos(spec.dir), y: -Math.sin(spec.dir), z: 0 }, radius: SUN_ANGULAR }
	const h = ctx.solid(spec.solid)
	if (h === undefined) return null
	const p = h.pose()
	if (spec.kind === "far") {
		if (far.v === undefined) {
			const dx = p.x - c.x
			const dy = p.y - c.y
			const l = Math.sqrt(dx * dx + dy * dy + c.z * c.z)
			far.v = l > 0 ? { x: dx / l, y: dy / l, z: -c.z / l } : { x: -1, y: 0, z: 0 }
		}
		return { parallel: true, p: far.v, radius: SUN_ANGULAR }
	}
	if (spec.frame === "solid") {
		const ca = Math.cos(p.angle)
		const sa = Math.sin(p.angle)
		return { parallel: false, p: { x: p.x + spec.x * ca - spec.y * sa, y: p.y + spec.x * sa + spec.y * ca, z: 0 }, radius: spec.radius }
	}
	return { parallel: false, p: { x: p.x + spec.x, y: p.y + spec.y, z: 0 }, radius: spec.radius }
}
const LEANS: Record<string, readonly [number, number]> = { right: [1, 0], left: [-1, 0], "toward the camera": [0, 1], "away from the camera": [0, -1] }
const fmtHour = (h: number) => {
	const m = Math.round(h * 60) % 1440
	return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`
}

/**
 * globe {solid (its ball), radius, tilt (°), lean, rpm, hour, lat, light}: a classroom globe on its stand, turning west to east `rpm` times a
 * minute (one turn = one day of the model), its axis tilted `tilt`° from the vertical toward `lean` (right, left, toward or away from the
 * camera, or toward or away from the light at the start) and kept so; a town at latitude `lat` whose solar time is `hour` at the start. Every
 * step (space.ts globeTown): turns, day (1 while the light is above the town's horizon and on), local_time (h), sun_elevation (°),
 * noon_elevation (°), sun_lat (° where the light is overhead), day_length_h. Events: sunrise and sunset at the town.
 */
const globe: ProcessKind = {
	kind: "globe",
	check: (r, solids) => {
		if (typeof r.solid !== "string" || !solids.has(r.solid)) return "its solid is not in the document"
		for (const k of ["radius", "tilt", "rpm", "hour", "lat"]) if (typeof r[k] !== "number" || !Number.isFinite(r[k] as number)) return `${k} must be a number`
		return undefined
	},
	create(r) {
		const item = typeof r.item === "string" ? r.item : itemOf(String(r.solid))
		const R = Math.max(0.001, num(r.radius, 0.15))
		const tilt = Math.max(0, Math.min(90, num(r.tilt, 23.44)))
		const rpm = num(r.rpm, 0)
		const lat = Math.max(-90, Math.min(90, num(r.lat, 0)))
		const spec = lightSpec(r.light)
		const far: { v?: V3 } = {}
		let C: V3 = { x: 0, y: 0, z: 0 }
		let axis: V3 = { x: 0, y: 1, z: 0 }
		let e1: V3 = { x: 1, y: 0, z: 0 }
		let psi0 = 0
		let wasDay: boolean | null = null
		const read = (ctx: ProcessContext) => {
			const t = ctx.time()
			const turns = (rpm * t) / 60
			ctx.set(item, "turns", turns)
			const L = spec === null ? null : lightNow(ctx, spec, C, far)
			if (L === null) {
				ctx.set(item, "day", 0)
				return
			}
			const q = globeTown(axis, e1, lat, psi0 + 360 * turns, C, R, L)
			const day = q.day && t >= (spec as LightSpec).from
			ctx.set(item, "day", day ? 1 : 0)
			ctx.set(item, "local_time", q.hour)
			ctx.set(item, "sun_elevation", q.elevation)
			ctx.set(item, "noon_elevation", q.noon)
			ctx.set(item, "sun_lat", q.dec)
			ctx.set(item, "day_length_h", q.dayLength)
			if (wasDay !== null && day !== wasDay) ctx.event(`${day ? "sunrise" : "sunset"} at ${item}'s town (${fmtHour(q.hour)} there)`, [item], day ? "sunrise" : "sunset")
			wasDay = day
		}
		return {
			start(ctx) {
				const h = ctx.solid(String(r.solid))
				if (h !== undefined) {
					const p = h.pose()
					C = { x: p.x, y: p.y, z: 0 }
				}
				// (the light where it is at the start, on or not, sets the lean "toward the light" and the meridian the town's time counts from)
				const L0 = spec === null ? null : lightNow(ctx, spec, C, far)
				const s0 = L0 === null ? { x: -1, y: 0, z: 0 } : towardLight(L0, C).s
				let hx = 0
				let hz = 1
				const lean = typeof r.lean === "string" ? r.lean : "toward the camera"
				if (lean === "toward the light" || lean === "away from the light") {
					const l = Math.sqrt(s0.x * s0.x + s0.z * s0.z)
					const sg = lean === "toward the light" ? 1 : -1
					if (l > 1e-9) {
						hx = (sg * s0.x) / l
						hz = (sg * s0.z) / l
					}
				} else {
					const d = LEANS[lean] ?? [0, 1]
					hx = d[0]
					hz = d[1]
				}
				axis = globeAxis(tilt, hx, hz)
				e1 = globeMeridian(axis, s0)
				psi0 = (num(r.hour, 12) - 12) * 15
				read(ctx)
			},
			step: read
		}
	}
}

/**
 * moon-ball {solid, ball (its radius), radius (of the circle it is carried round), period (s a turn; 0 held still), start, tilt, node (°),
 * around (a globe's ball solid, or null: round the item's own place, a viewer's eye), light}: a white ball on a stick carried round a globe
 * (or a head) counter-clockwise seen from above, as the Moon goes round the Earth: `start`° round from the light's side at the start (0 new
 * moon: between the light and the globe; 180 full), its circle tilted `tilt`° about a line of nodes `node`° round from the light (90: high
 * at full, low at new: no eclipses). Every step (space.ts carriedAt, phase3D): elongation (° from the light as the centre sees it), lit
 * (the fraction of its disc lit, seen from the centre), height (m above the centre); with a globe, lunar_eclipse (the globe's shadow on the
 * ball: 0 none, 1 penumbral, 2 partial, 3 total) and solar_eclipse (the ball's shadow on the globe: 0, 1 partial, 2 annular, 3 total).
 */
const moonBall: ProcessKind = {
	kind: "moon-ball",
	check: (r, solids) => {
		if (typeof r.solid !== "string" || !solids.has(r.solid)) return "its solid is not in the document"
		for (const k of ["ball", "radius", "period", "start", "tilt", "node"]) if (typeof r[k] !== "number" || !Number.isFinite(r[k] as number)) return `${k} must be a number`
		if (r.around !== undefined && r.around !== null && typeof r.around !== "string") return "around must be a solid id or null"
		return undefined
	},
	create(r) {
		const item = typeof r.item === "string" ? r.item : itemOf(String(r.solid))
		const rb = Math.max(0.001, num(r.ball, 0.0375))
		const R = Math.max(0, num(r.radius, 0.5))
		const period = Math.max(0, num(r.period, 0))
		const start = num(r.start, 0)
		const tilt = Math.max(0, Math.min(89, num(r.tilt, 0)))
		const node = num(r.node, 90)
		const around = typeof r.around === "string" ? r.around : null
		const spec = lightSpec(r.light)
		const far: { v?: V3 } = {}
		let C: V3 = { x: 0, y: 0, z: 0 }
		let h: V3 = { x: -1, y: 0, z: 0 }
		let rg = 0
		let deepest = { lunar: 0, solar: 0 }
		const say = (ctx: ProcessContext, lunar: number, solar: number) => {
			if (lunar > 0) deepest.lunar = Math.max(deepest.lunar, lunar)
			else if (deepest.lunar > 0) {
				ctx.event(`a ${["", "penumbral", "partial", "total"][deepest.lunar]} lunar eclipse: the globe's shadow on ${item}`, [item], "lunar eclipse")
				deepest = { ...deepest, lunar: 0 }
			}
			if (solar > 0) deepest.solar = Math.max(deepest.solar, solar)
			else if (deepest.solar > 0) {
				ctx.event(`a ${["", "partial", "annular", "total"][deepest.solar]} solar eclipse: ${item}'s shadow on the globe`, [item], "solar eclipse")
				deepest = { ...deepest, solar: 0 }
			}
		}
		const read = (ctx: ProcessContext) => {
			const t = ctx.time()
			const u = start + (period > 0 ? (360 * t) / period : 0)
			const at = carriedAt(C, h, R, u, tilt, node)
			ctx.set(item, "height", at.p.y - C.y)
			const L = spec === null ? null : lightNow(ctx, spec, C, far)
			if (L === null) return
			// (its phase by longitude round the vertical, as the astronomers' by ecliptic longitude: the table's level is the model's ecliptic)
			const ph = phase3D(L, C, at.p, { x: 0, y: 1, z: 0 })
			ctx.set(item, "elongation", ph.elongation)
			ctx.set(item, "lit", ph.lit)
			if (rg > 0) {
				const lunar = lunarEclipse(L, { at: C, r: rg }, { at: at.p, r: rb })
				const solar = solarEclipse(L, { at: at.p, r: rb }, { at: C, r: rg })
				ctx.set(item, "lunar_eclipse", lunar)
				ctx.set(item, "solar_eclipse", solar)
				say(ctx, lunar, solar)
			}
		}
		return {
			start(ctx) {
				const g = around === null ? undefined : ctx.solid(around)
				const own = ctx.solid(String(r.solid))
				// (the circle's centre: the globe's middle, else the record's `centre`, the item's place: its ghost solid stands where the ball starts)
				const rc = r.centre as { x?: unknown; y?: unknown } | undefined
				const base = g ?? own
				if (g === undefined && rc !== undefined && rc !== null && typeof rc.x === "number" && typeof rc.y === "number") C = { x: rc.x, y: rc.y, z: 0 }
				else if (base !== undefined) {
					const p = base.pose()
					C = { x: p.x, y: p.y, z: 0 }
				}
				if (g !== undefined) rg = g.outline().circle?.r ?? 0
				const L0 = spec === null ? null : lightNow(ctx, spec, C, far)
				if (L0 !== null) {
					const s0 = towardLight(L0, C).s
					const l = Math.sqrt(s0.x * s0.x + s0.z * s0.z)
					if (l > 1e-9) h = { x: s0.x / l, y: 0, z: s0.z / l }
				}
				read(ctx)
			},
			step: read,
			end: (ctx) => say(ctx, 0, 0)
		}
	}
}

export default [body, sunClock, globe, moonBall]
