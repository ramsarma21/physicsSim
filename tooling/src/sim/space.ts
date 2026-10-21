/**
 * GRAVITY + SPACE: the physics the space module adds to the engine, as pure functions (no planck, no state), so they can be
 * unit-tested alone (tooling/src/sim/space.test.ts) and their every use in physics.ts stays a one-line call.
 *
 *  - Places: the uniform gravity and the air of a surface scene (Earth, the Moon, Mars, Jupiter ... a space station, outer space).
 *  - Attraction: Newton's gravity between space bodies (planets, moons, stars), a 2D N-body mode in the machine plane. A body that
 *    `attracts` pulls every moving solid with a = μ·r̂/r² (μ = G·M in scene units, m³/s²); inside its own radius R the pull falls to
 *    μ·r/R³ (a uniform sphere: the shell theorem), so nothing is ever pulled infinitely hard. Two attracting bodies pull each other
 *    with equal and opposite forces whenever their engine masses are in the ratio of their μ (the catalog builds them so).
 *  - Launch: a body set to orbit gets, at the release, the speed of a circular orbit round its primary (× a factor: 1 a circle,
 *    under 1 it falls in, √2 escapes), the barycentre of the pair kept where it is.
 *  - Phases and shadows: the lit fraction of a moon and the 8 named phases, and whether a body is in another's umbra or penumbra.
 *
 * Only + − × ÷ and Math.sqrt are used in what the engine steps (the forces and the launch), so the bits are the same on every machine
 * without fdlibm; phases and the Sun clock use the engine's Math.sin, cos and atan2 (tools/fdlibm.ts in the bundle and on the server).
 */

/** A point or vector, metres (m/s for a velocity). */
export interface XY {
	readonly x: number
	readonly y: number
}

/**
 * Surface gravity (m/s²) and air density (kg/m³) of each place a scene can stand on. Sources: NASA NSSDCA planetary fact sheets
 * (D. R. Williams, nssdc.gsfc.nasa.gov/planetary/factsheet): Moon "surface gravity 1.62 m/s²", no atmosphere to speak of (10⁻¹⁵ bar);
 * Mars "surface gravity (mean) 3.71", "surface density ~0.020 kg/m³"; Jupiter "equatorial surface gravity 24.79" at the 1-bar level,
 * "density at 1 bar 0.16 kg/m³"; Venus 8.87 and "surface density ~65 kg/m³"; Mercury 3.70 (no air); Saturn 10.44 at 1 bar, 0.19 kg/m³;
 * Pluto 0.62 (its 1 Pa air left out). Earth: the engine's standard 9.81 (standard gravity 9.80665, NIST SP 330) and room air 1.2 kg/m³
 * (1.204 at 20 °C, 1 atm). A space station: no gravity felt (free fall), cabin air at sea-level pressure (ISS ≈ 101 kPa, 22 °C).
 */
export const PLACES = {
	earth: { g: 9.81, air: 1.2 },
	moon: { g: 1.62, air: 0 },
	mars: { g: 3.71, air: 0.02 },
	jupiter: { g: 24.79, air: 0.16 },
	venus: { g: 8.87, air: 65 },
	mercury: { g: 3.7, air: 0 },
	saturn: { g: 10.44, air: 0.19 },
	pluto: { g: 0.62, air: 0 },
	"space-station": { g: 0, air: 1.2 },
	space: { g: 0, air: 0 }
} as const

export type Place = keyof typeof PLACES

/** The engine's standard values (physics.ts GRAVITY and AIR_DENSITY): a scene that sets no world runs exactly as before. */
export const EARTH_G = 9.81
export const EARTH_AIR = 1.2

/** A space body that pulls: μ = G·M in scene units (m³/s²) and the radius inside which its pull falls off linearly (m). */
export interface Attractor {
	readonly at: XY
	readonly mu: number
	readonly radius: number
}

/**
 * The acceleration (m/s²) the attractors give a point `p`, leaving out the attractor `self` (an attractor does not pull itself).
 * Outside an attractor's radius R: μ·d/|d|³ toward it; inside: μ·d/R³ (a uniform sphere's field), 0 at its centre.
 */
export const pull = (attractors: readonly Attractor[], p: XY, self: number = -1): XY => {
	let ax = 0
	let ay = 0
	for (let k = 0; k < attractors.length; k++) {
		if (k === self) continue
		const a = attractors[k] as Attractor
		const dx = a.at.x - p.x
		const dy = a.at.y - p.y
		const r2 = dx * dx + dy * dy
		if (r2 === 0) continue
		const R = a.radius
		const r = Math.sqrt(r2)
		const s = r >= R ? a.mu / (r2 * r) : a.mu / (R * R * R)
		ax += s * dx
		ay += s * dy
	}
	return { x: ax, y: ay }
}

/** Speed of a circular orbit of radius r round a pair of total μ (m/s): √(μ/r). */
export const circularSpeed = (mu: number, r: number) => (r > 0 && mu > 0 ? Math.sqrt(mu / r) : 0)

/** Escape speed at r (m/s): √(2μ/r). */
export const escapeSpeed = (mu: number, r: number) => (r > 0 && mu > 0 ? Math.sqrt((2 * mu) / r) : 0)

/** Period of a circular orbit of radius r (s): 2π·√(r³/μ) (Kepler's third law). */
export const orbitPeriod = (mu: number, r: number) => (r > 0 && mu > 0 ? 2 * Math.PI * Math.sqrt((r * r * r) / mu) : Infinity)

/**
 * The primary of the body at `p` (index into `attractors`): among the attractors heavier than it (μ above `ownMu`; another body's
 * own index `self` left out), the one whose orbital frequency there, μ/r³, is the highest: the Moon's primary is the Earth although
 * the Sun pulls it twice as hard (Earth 7.0e-12 /s² against the Sun's 4.0e-14 at the Moon). -1 when there is none.
 */
export const primaryOf = (attractors: readonly Attractor[], p: XY, ownMu = 0, self = -1) => {
	let best = -1
	let bestRate = 0
	for (let k = 0; k < attractors.length; k++) {
		if (k === self) continue
		const a = attractors[k] as Attractor
		if (!(a.mu > ownMu)) continue
		const dx = a.at.x - p.x
		const dy = a.at.y - p.y
		const r = Math.sqrt(dx * dx + dy * dy)
		if (r === 0) continue
		const rate = a.mu / (r * r * r)
		if (rate > bestRate) {
			bestRate = rate
			best = k
		}
	}
	return best
}

/** What a body set to orbit asks for: the factor of the circular speed, which way round, and (optionally) the attractor it circles. */
export interface Launch {
	/** × the circular speed (0 = let go at rest, 1 = a circle, √2 = escape). */
	readonly factor: number
	/** "ccw" (counter-clockwise as seen from the front: the default) or "cw". */
	readonly direction: "ccw" | "cw"
}

/**
 * The relative velocity (m/s) a body at `p` (μ `ownMu`, 0 for a satellite) needs to circle the attractor at `c` (μ `mu`) at
 * `factor` × the two-body circular speed √((μ + μ_own)/r), at right angles to the line between them, counter-clockwise or not.
 */
export const orbitVelocity = (c: XY, mu: number, p: XY, ownMu: number, launch: Launch): XY => {
	const dx = p.x - c.x
	const dy = p.y - c.y
	const r = Math.sqrt(dx * dx + dy * dy)
	if (r === 0) return { x: 0, y: 0 }
	const v = launch.factor * Math.sqrt((mu + ownMu) / r)
	const s = launch.direction === "cw" ? -1 : 1
	// (the unit tangent: the radius turned a quarter counter-clockwise)
	return { x: (-s * dy * v) / r, y: (s * dx * v) / r }
}

/** One body of a launch: where it starts, its μ (0 if it does not attract), whether it is held fixed, and its launch (if any). */
export interface LaunchBody {
	readonly at: XY
	readonly mu: number
	readonly fixed: boolean
	readonly launch?: Launch
	/** The index of its primary, when the scene names one; else found by `primaryOf`. */
	readonly around?: number
}

/**
 * Launch velocities for every body (m/s), at the release. Bodies are launched heaviest first, each round its primary (the heaviest
 * attractors' velocities are already set): its velocity is its primary's plus its share of the pair's relative orbital velocity
 * (μ_c/(μ_c + μ) of it), and a primary that moves gives up the rest (μ/(μ_c + μ) of it, the other way), so the pair's barycentre goes
 * on as the primary went. A fixed body never moves; a body with no launch keeps what the bodies launched round it gave it.
 * `attractors` are the bodies with μ > 0, in the same order as their `index` in `bodies` (attractorIndex[k] = index in bodies).
 */
export const launchVelocities = (bodies: readonly LaunchBody[]): XY[] => {
	const v: { x: number; y: number }[] = bodies.map(() => ({ x: 0, y: 0 }))
	const pulling = bodies.flatMap((b, i) => (b.mu > 0 ? [i] : []))
	const attractors: Attractor[] = pulling.map((i) => ({ at: (bodies[i] as LaunchBody).at, mu: (bodies[i] as LaunchBody).mu, radius: 0 }))
	// heaviest first (the order of the scene among equals), so a moon is launched after its planet
	const order = bodies.map((_, i) => i).sort((a, b) => (bodies[b] as LaunchBody).mu - (bodies[a] as LaunchBody).mu || a - b)
	for (const i of order) {
		const b = bodies[i] as LaunchBody
		if (b.fixed || b.launch === undefined || b.launch.factor === 0) continue
		const selfK = pulling.indexOf(i)
		const k = b.around !== undefined && b.around !== i && (bodies[b.around]?.mu ?? 0) > 0 ? pulling.indexOf(b.around) : primaryOf(attractors, b.at, b.mu, selfK)
		if (k < 0) continue
		const ci = pulling[k] as number
		const c = bodies[ci] as LaunchBody
		const rel = orbitVelocity(c.at, c.mu, b.at, b.mu, b.launch)
		const total = c.mu + b.mu
		const mine = c.fixed ? 1 : c.mu / total
		const vc = v[ci] as { x: number; y: number }
		;(v[i] as { x: number; y: number }).x = vc.x + mine * rel.x
		;(v[i] as { x: number; y: number }).y = vc.y + mine * rel.y
		if (!c.fixed && b.mu > 0) {
			// the primary recoils (a satellite with no μ moves nothing)
			const theirs = b.mu / total
			vc.x -= theirs * rel.x
			vc.y -= theirs * rel.y
		}
	}
	return v
}

/** The eight phases, from new (the moon between its planet and the sun) round to waning crescent. */
export const PHASES = [
	"new moon",
	"waxing crescent",
	"first quarter",
	"waxing gibbous",
	"full moon",
	"waning gibbous",
	"last quarter",
	"waning crescent"
] as const

/**
 * A moon's phase as its planet sees it, in the machine plane (the 2D model has no orbital tilt): `elongation` = the angle at the
 * planet from the sun round (counter-clockwise) to the moon, 0…360°; `lit` = the lit fraction of the disc seen, (1 + cos i)/2 with
 * i the sun–moon–planet angle at the moon (exact for any distances, Meeus, Astronomical Algorithms ch. 48); `name` its phase, the
 * eight 45° bins centred on 0° (new), 90° (first quarter), 180° (full), 270° (last quarter), for a moon that circles
 * counter-clockwise (a clockwise one waxes the other way: `ccw` false).
 */
export const moonPhase = (sun: XY, planet: XY, moon: XY, ccw = true) => {
	const sx = sun.x - planet.x
	const sy = sun.y - planet.y
	const mx = moon.x - planet.x
	const my = moon.y - planet.y
	let elongation = (Math.atan2(sx * my - sy * mx, sx * mx + sy * my) * 180) / Math.PI
	if (!ccw) elongation = -elongation
	if (elongation < 0) elongation += 360
	// at the moon: toward the sun and toward the planet
	const ax = sun.x - moon.x
	const ay = sun.y - moon.y
	const bx = planet.x - moon.x
	const by = planet.y - moon.y
	const la = Math.sqrt(ax * ax + ay * ay)
	const lb = Math.sqrt(bx * bx + by * by)
	const cosI = la > 0 && lb > 0 ? Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb))) : 1
	const lit = (1 + cosI) / 2
	const name = PHASES[Math.floor(((elongation + 22.5) % 360) / 45)] as (typeof PHASES)[number]
	return { elongation, lit, name }
}

/** A round body seen as a disc in the machine plane. */
export interface Disc {
	readonly at: XY
	readonly radius: number
}

/**
 * Whether `target` is in the shadow `blocker` casts in the light of `source` (all discs in the plane): "umbra" when part of it is in
 * the full shadow (the cone behind the blocker that sees none of the source), "penumbra" when part of it is in the half shadow only,
 * null when it is in full light. `total` when the target lies wholly in the umbra (a total eclipse). Similar triangles: behind the
 * blocker at distance x along the source–blocker line, the umbra's half-width is R_b − x·(R_s − R_b)/D and the penumbra's
 * R_b + x·(R_s + R_b)/D (D the source–blocker distance).
 */
export const shadowOn = (source: Disc, blocker: Disc, target: Disc) => {
	const ux = blocker.at.x - source.at.x
	const uy = blocker.at.y - source.at.y
	const D = Math.sqrt(ux * ux + uy * uy)
	if (D === 0) return { in: null as null | "umbra" | "penumbra", total: false }
	const ex = ux / D
	const ey = uy / D
	const tx = target.at.x - blocker.at.x
	const ty = target.at.y - blocker.at.y
	const x = tx * ex + ty * ey
	if (x <= 0) return { in: null as null | "umbra" | "penumbra", total: false }
	const across = Math.abs(-tx * ey + ty * ex)
	const umbra = blocker.radius - (x * (source.radius - blocker.radius)) / D
	const penumbra = blocker.radius + (x * (source.radius + blocker.radius)) / D
	if (umbra > 0 && across < umbra + target.radius) return { in: "umbra" as const, total: across + target.radius <= umbra }
	if (across < penumbra + target.radius) return { in: "penumbra" as const, total: false }
	return { in: null as null | "umbra" | "penumbra", total: false }
}

/**
 * Terminal speed (m/s) of a body of mass m (kg) falling through air of density ρ under gravity g with drag area Cd·A (m²), its
 * buoyancy (ρ·V·g) taken off its weight: √(2(m − ρV)g / (ρ·Cd·A)) (NASA Glenn, "Terminal Velocity"). Infinity in a vacuum.
 */
export const terminalSpeed = (m: number, g: number, rho: number, cdA: number, volume = 0) => {
	if (!(rho > 0) || !(cdA > 0)) return Infinity
	const weight = (m - rho * volume) * g
	return weight > 0 ? Math.sqrt((2 * weight) / (rho * cdA)) : 0
}

/**
 * Time (s) to fall a height h (m) from rest at gravity g with drag area Cd·A in air of density ρ (quadratic drag, buoyancy left out):
 * the closed form t = (v_t/g)·acosh(e^{h·g/v_t²}) (v_t the terminal speed); √(2h/g) in a vacuum.
 */
export const fallTime = (h: number, m: number, g: number, rho: number, cdA: number) => {
	if (!(g > 0) || !(h > 0)) return 0
	const vt = terminalSpeed(m, g, rho, cdA)
	if (!Number.isFinite(vt)) return Math.sqrt((2 * h) / g)
	return (vt / g) * Math.acosh(Math.exp((h * g) / (vt * vt)))
}

/** Earth's axial tilt (obliquity of the ecliptic), degrees [NASA-PFS]. */
export const TILT_DEG = 23.44
const RAD = Math.PI / 180

/**
 * The Sun's declination (degrees) for a date: 0 at the equinoxes, +23.44 at the June solstice, −23.44 at the December one, else Cooper's
 * approximation for day of the year N (1 = 1 January): 23.44·sin(360°·(284 + N)/365) (Cooper, Solar Energy 12, 333, 1969).
 */
export const declination = (season: string, day: number) =>
	season === "march equinox" || season === "september equinox" ? 0 : season === "june solstice" ? TILT_DEG : season === "december solstice" ? -TILT_DEG : TILT_DEG * Math.sin((360 * (284 + day) * RAD) / 365)

/**
 * The Sun as seen from latitude φ (degrees) on a day of declination δ at solar time `hour` (12 = solar noon): its elevation above the horizon
 * and its azimuth from north, clockwise (degrees). sin e = sin φ sin δ + cos φ cos δ cos H with H = 15°·(hour − 12); the azimuth by Meeus
 * (Astronomical Algorithms, eq. 13.5: measured westward from the south, tan A = sin H / (cos H sin φ − tan δ cos φ)) plus 180°. Only
 * sin, cos, atan2 and sqrt (the engine's deterministic math).
 */
export const sunAt = (latDeg: number, decDeg: number, hour: number) => {
	const phi = latDeg * RAD
	const dec = decDeg * RAD
	const H = (hour - 12) * 15 * RAD
	const sp = Math.sin(phi)
	const cp = Math.cos(phi)
	const sd = Math.sin(dec)
	const cd = Math.cos(dec)
	const sinE = Math.max(-1, Math.min(1, sp * sd + cp * cd * Math.cos(H)))
	const elevation = Math.atan2(sinE, Math.sqrt(Math.max(0, 1 - sinE * sinE))) / RAD
	const A = Math.atan2(Math.sin(H), Math.cos(H) * sp - (sd / cd) * cp) / RAD
	let azimuth = A + 180
	if (azimuth >= 360) azimuth -= 360
	if (azimuth < 0) azimuth += 360
	return { elevation, azimuth }
}

/** Hours from sunrise to sunset at latitude φ on a day of declination δ: 2·H0/15 with cos H0 = −tan φ tan δ (24 in polar day, 0 in polar night). */
export const dayLength = (latDeg: number, decDeg: number) => {
	const p = latDeg * RAD
	const d = decDeg * RAD
	const c = -((Math.sin(p) / Math.cos(p)) * (Math.sin(d) / Math.cos(d))) // (tan as sin / cos: the engine's math has no tan)
	if (c <= -1) return 24
	if (c >= 1) return 0
	return (2 * Math.atan2(Math.sqrt(1 - c * c), c)) / RAD / 15
}

/** A stick of height h's shadow on level ground with the Sun at elevation e (degrees): h / tan e; 0 with the Sun down (e ≤ 0), at most 100 m. */
export const shadowLength = (h: number, elevationDeg: number) => {
	if (!(elevationDeg > 0)) return 0
	const e = elevationDeg * RAD
	return Math.min(100, (h * Math.cos(e)) / Math.sin(e))
}

// ---------------------------------------------------------------- classroom models in 3D: a globe under a lamp, a moon ball on a stick, eclipses
// (2026-10-20) The table models are side views (x right, y up, z toward the camera, right-handed as the 3D view's), but a globe's axis, the
// circle a moon ball is carried round and a tilted Moon's orbit leave the machine plane: these take 3D vectors. Only + − × ÷, Math.sqrt and the
// engine's Math.sin, cos and atan2 (the bundle's and the server's own: the same bits everywhere).

/** A point or vector in 3D, metres. */
export interface V3 {
	readonly x: number
	readonly y: number
	readonly z: number
}
const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z })
const dot3 = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z
const sub3 = (a: V3, b: V3) => v3(a.x - b.x, a.y - b.y, a.z - b.z)
const len3 = (a: V3) => Math.sqrt(dot3(a, a))
export const cross3 = (a: V3, b: V3) => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
const unit3 = (a: V3, fallback: V3 = v3(1, 0, 0)) => {
	const l = len3(a)
	return l > 0 ? v3(a.x / l, a.y / l, a.z / l) : fallback
}
const clamp1 = (s: number) => (s > 1 ? 1 : s < -1 ? -1 : s)
/** asin in degrees from atan2 and sqrt (the engine's math has no asin). */
export const asinDeg = (s: number) => {
	const c = clamp1(s)
	return Math.atan2(c, Math.sqrt(Math.max(0, 1 - c * c))) / RAD
}

/**
 * Where a light is, as a globe or a ball sees it: a point (a lamp's bulb, a flashlight's lens, a Sun in the scene) of radius `radius` (m), or
 * parallel light (sunlight; a far-away Sun) coming FROM direction `p` (a unit vector toward the light) with angular radius `radius` (rad:
 * the real Sun's is 0.2666° = 0.004653 rad seen from the Earth [NASA-PFS: 1,392,700 km across at 1 au]).
 */
export interface LightAt {
	readonly parallel: boolean
	readonly p: V3
	readonly radius: number
}
/** The unit vector from c toward the light, and its distance (Infinity for parallel light). */
export const towardLight = (light: LightAt, c: V3) => {
	if (light.parallel) return { s: unit3(light.p), d: Infinity }
	const d = sub3(light.p, c)
	return { s: unit3(d), d: len3(d) }
}

/** The way a classroom globe's north pole leans (fixed in the room): its tilt from the vertical toward a horizontal unit (h.x, h.z). */
export const globeAxis = (tiltDeg: number, hx: number, hz: number): V3 => {
	const t = tiltDeg * RAD
	const s = Math.sin(t)
	return v3(s * hx, Math.cos(t), s * hz)
}

/** The globe's reference meridian (longitude 0 of its turning, perpendicular to the axis): toward the light's meridian at the start. */
export const globeMeridian = (axis: V3, s: V3) => {
	const k = dot3(axis, s)
	const e = v3(s.x - k * axis.x, s.y - k * axis.y, s.z - k * axis.z)
	if (len3(e) > 1e-9) return unit3(e)
	// (the light straight along the axis: any meridian)
	const o = Math.abs(axis.x) < 0.9 ? v3(1, 0, 0) : v3(0, 0, 1)
	return unit3(cross3(cross3(axis, o), axis))
}

/**
 * A town at latitude `latDeg` on a globe (centre c, radius r, north axis `axis`, reference meridian `e1`) turned `psiDeg` east (counter-
 * clockwise seen from above its north pole, as the Earth turns) from that meridian, under `light`:
 *  - dec: where the light is overhead (the subsolar latitude, the "declination" of the model's Sun), asin(axis·ŝ);
 *  - elevation: the light's height above the town's horizon (for a point light, from the town's own place on the ball: a lamp near a globe
 *    lights less than half of it, the cap where u·(L − c) > r);
 *  - day: the light is above the town's horizon;
 *  - hour: the town's solar time, 12 + H/15° (H the hour angle: the angle round the axis from the light's meridian to the town's, eastward;
 *    afternoon east of it);
 *  - noon: the light's height at the town's noon, 90° − |lat − dec| (Meeus: the noon Sun's altitude);
 *  - dayLength: hours from sunrise to sunset at that latitude for that dec (cos H0 = −tan φ tan δ; dayLength above).
 */
export const globeTown = (axis: V3, e1: V3, latDeg: number, psiDeg: number, c: V3, r: number, light: LightAt) => {
	const { s } = towardLight(light, c)
	const e2 = cross3(axis, e1)
	const phi = latDeg * RAD
	const psi = psiDeg * RAD
	const cp = Math.cos(phi)
	const sp = Math.sin(phi)
	const cq = Math.cos(psi)
	const sq = Math.sin(psi)
	const u = v3(cp * (cq * e1.x + sq * e2.x) + sp * axis.x, cp * (cq * e1.y + sq * e2.y) + sp * axis.y, cp * (cq * e1.z + sq * e2.z) + sp * axis.z)
	let sinE: number
	if (light.parallel) sinE = dot3(u, s)
	else {
		const v = sub3(light.p, v3(c.x + r * u.x, c.y + r * u.y, c.z + r * u.z))
		const lv = len3(v)
		sinE = lv > 0 ? dot3(u, v) / lv : 1
	}
	const elevation = asinDeg(sinE)
	const sinDec = clamp1(dot3(axis, s))
	const dec = asinDeg(sinDec)
	// the hour angle: from the light's meridian to the town's, round the axis, eastward
	const sEq = v3(s.x - sinDec * axis.x, s.y - sinDec * axis.y, s.z - sinDec * axis.z)
	const m = v3(u.x - sp * axis.x, u.y - sp * axis.y, u.z - sp * axis.z)
	const H = Math.atan2(dot3(cross3(sEq, m), axis), dot3(sEq, m)) / RAD
	let hour = 12 + H / 15
	hour -= 24 * Math.floor(hour / 24)
	return { u, dec, elevation, day: elevation > 0, hour, noon: 90 - Math.abs(latDeg - dec), dayLength: dayLength(latDeg, dec) }
}

/**
 * Where a ball carried round a centre c is (a moon ball on a stick, round a globe or a viewer's head): a circle of radius R in the horizontal
 * plane, tilted `tiltDeg` about its line of nodes, which lies `nodeDeg` round from `h` (the horizontal unit toward the light at the start),
 * the ball `uDeg` round from h, both counted counter-clockwise seen from above (the way the Moon goes round the Earth seen from the north).
 * Also the circle's normal n (the way it goes round: counter-clockwise about n).
 */
export const carriedAt = (c: V3, h: V3, R: number, uDeg: number, tiltDeg: number, nodeDeg: number) => {
	// k: h turned a quarter counter-clockwise seen from above (about +y)
	const k = v3(h.z, 0, -h.x)
	const O = nodeDeg * RAD
	const co = Math.cos(O)
	const so = Math.sin(O)
	const node = v3(co * h.x + so * k.x, 0, co * h.z + so * k.z)
	const w = v3(-so * h.x + co * k.x, 0, -so * h.z + co * k.z)
	const t = tiltDeg * RAD
	const ct = Math.cos(t)
	const st = Math.sin(t)
	const up = v3(ct * w.x, st, ct * w.z) // w tilted up toward +y about the line of nodes
	const a = (uDeg - nodeDeg) * RAD
	const ca = Math.cos(a)
	const sa = Math.sin(a)
	const p = v3(c.x + R * (ca * node.x + sa * up.x), c.y + R * (ca * node.y + sa * up.y), c.z + R * (ca * node.z + sa * up.z))
	return { p, n: cross3(node, up) }
}

/**
 * A moon's (or a moon ball's) phase as an observer at o sees it, in 3D: elongation = the difference of the moon's and the light's longitudes
 * round the axis n (both directions projected on the plane square to n, the angle measured the way the moon goes round, 0…360°: 0 new,
 * 90 first quarter, 180 full, 270 last quarter: the astronomers' phases, by ecliptic longitude, n the ecliptic's pole; a moon above or below
 * the plane is full at 180° though it shows a little less than its whole disc); lit = (1 + cos i)/2, i the light–moon–observer angle at the
 * moon (Meeus ch. 48).
 */
export const phase3D = (light: LightAt, o: V3, moon: V3, n: V3) => {
	const { s } = towardLight(light, o)
	const q = unit3(sub3(moon, o))
	const N = unit3(n, v3(0, 1, 0))
	const ks = dot3(s, N)
	const kq = dot3(q, N)
	const sp = v3(s.x - ks * N.x, s.y - ks * N.y, s.z - ks * N.z)
	const qp = v3(q.x - kq * N.x, q.y - kq * N.y, q.z - kq * N.z)
	let elongation = Math.atan2(dot3(cross3(sp, qp), N), dot3(sp, qp)) / RAD
	if (elongation < 0) elongation += 360
	const toLight = light.parallel ? s : unit3(sub3(light.p, moon))
	const toObs = unit3(sub3(o, moon))
	const lit = (1 + clamp1(dot3(toLight, toObs))) / 2
	return { elongation, lit }
}

/** A sphere: its centre and radius. */
export interface Ball3 {
	readonly at: V3
	readonly r: number
}
/**
 * The shadow `blocker` casts in `light` where `target` is (3D cones): x = how far the target's centre is behind the blocker along the light's
 * line through it (≤ 0: in front, no shadow), across = its distance from that line, and the half-widths there of the umbra (the full shadow:
 * none of the light seen; below 0 past the umbra's tip: the antumbra, where the blocker looks smaller than the light, |umbra| wide) and the
 * penumbra (part of the light hidden). Similar triangles: umbra r_b − x·(R_s − r_b)/D, penumbra r_b + x·(R_s + r_b)/D for a light of radius
 * R_s at distance D; parallel light of angular radius α: r_b ∓ x·tan α.
 */
export const shadowCone = (light: LightAt, blocker: Ball3, target: Ball3) => {
	let e: V3
	let umbraRate: number
	let penRate: number
	if (light.parallel) {
		e = unit3(v3(-light.p.x, -light.p.y, -light.p.z))
		const ta = Math.sin(light.radius) / Math.cos(light.radius)
		umbraRate = ta
		penRate = ta
	} else {
		const d = sub3(blocker.at, light.p)
		const D = len3(d)
		if (!(D > 0)) return { x: 0, across: 0, umbra: 0, penumbra: 0 }
		e = v3(d.x / D, d.y / D, d.z / D)
		umbraRate = (light.radius - blocker.r) / D
		penRate = (light.radius + blocker.r) / D
	}
	const t = sub3(target.at, blocker.at)
	const x = dot3(t, e)
	const px = t.x - x * e.x
	const py = t.y - x * e.y
	const pz = t.z - x * e.z
	const across = Math.sqrt(px * px + py * py + pz * pz)
	return { x, across, umbra: blocker.r - x * umbraRate, penumbra: blocker.r + x * penRate }
}
/** A lunar eclipse's kind: the moon (target) in its planet's shadow: 0 none, 1 penumbral, 2 partial (part of it in the umbra), 3 total. */
export const lunarEclipse = (light: LightAt, planet: Ball3, moon: Ball3) => {
	const c = shadowCone(light, planet, moon)
	if (c.x <= 0) return 0
	if (c.umbra > 0 && c.across + moon.r <= c.umbra) return 3
	if (c.umbra > 0 && c.across < c.umbra + moon.r) return 2
	if (c.across < c.penumbra + moon.r) return 1
	return 0
}
/**
 * A solar eclipse's kind somewhere on the planet: the moon's shadow on it: 0 none, 1 partial (its penumbra touches the planet), 2 annular (the
 * antumbra touches it: the moon looks smaller than the Sun there), 3 total (the umbra touches it).
 */
export const solarEclipse = (light: LightAt, moon: Ball3, planet: Ball3) => {
	const c = shadowCone(light, moon, planet)
	if (c.x <= 0) return 0
	if (c.umbra > 0 && c.across < c.umbra + planet.r) return 3
	if (c.umbra <= 0 && c.across < -c.umbra + planet.r) return 2
	if (c.across < c.penumbra + planet.r) return 1
	return 0
}

/**
 * A planet's seasons as it goes round its Sun, its axis tilted `tiltDeg` from its orbit's pole and kept pointing one way in space: the
 * subsolar latitude δ = asin(sin ε · (b·ŝ)), b the in-plane direction its north pole leans toward, ŝ the in-plane direction to the Sun (both
 * unit 2D vectors); the town's noon Sun height 90° − |φ − δ| and its day length. At the June solstice the pole leans toward the Sun (b = ŝ),
 * at the December one away, at the equinoxes square to it.
 */
export const seasonsAt = (tiltDeg: number, bx: number, by: number, sx: number, sy: number, latDeg: number) => {
	const dec = asinDeg(Math.sin(tiltDeg * RAD) * (bx * sx + by * sy))
	return { dec, noon: 90 - Math.abs(latDeg - dec), dayLength: dayLength(latDeg, dec) }
}
/**
 * The in-plane direction a planet's north pole leans toward, for the date at the start: ŝ0 (the unit 2D vector to its Sun then) itself for the
 * June solstice, −ŝ0 for December's, and ŝ0 turned a quarter in its direction of travel for the March equinox (so the June solstice comes a
 * quarter of an orbit later), the other way for September's. `sense` +1 counter-clockwise, −1 clockwise.
 */
export const seasonLean = (date: string, sx: number, sy: number, sense: number) => {
	if (date === "june solstice") return { x: sx, y: sy }
	if (date === "december solstice") return { x: -sx, y: -sy }
	const q = { x: -sy * sense, y: sx * sense }
	return date === "september equinox" ? { x: -q.x, y: -q.y } : q
}
