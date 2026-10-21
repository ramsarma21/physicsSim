// Unit tests of the space module's pure physics (tooling/src/sim/space.ts): node --test tooling/src/sim/space.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import {
	circularSpeed,
	escapeSpeed,
	fallTime,
	launchVelocities,
	moonPhase,
	orbitPeriod,
	orbitVelocity,
	PLACES,
	primaryOf,
	pull,
	shadowOn,
	terminalSpeed
} from "./space.ts"

const near = (a: number, b: number, tol: number, what = "") => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} vs ${b} (±${tol})`)

test("places: NSSDCA surface gravity and air", () => {
	assert.equal(PLACES.earth.g, 9.81)
	assert.equal(PLACES.moon.g, 1.62)
	assert.equal(PLACES.mars.g, 3.71)
	assert.equal(PLACES.jupiter.g, 24.79)
	assert.equal(PLACES.space.g, 0)
	assert.equal(PLACES.moon.air, 0)
	assert.equal(PLACES.space.air, 0)
	assert.equal(PLACES["space-station"].air, 1.2)
})

test("pull: inverse square outside, linear inside, none from itself", () => {
	const A = [{ at: { x: 0, y: 0 }, mu: 2, radius: 0.5 }]
	const a1 = pull(A, { x: 1, y: 0 })
	near(a1.x, -2, 1e-15, "at r=1")
	near(a1.y, 0, 0)
	const a2 = pull(A, { x: 2, y: 0 })
	near(a2.x, -0.5, 1e-15, "at r=2 (a quarter)")
	// inside: μ r / R³ = 2 * 0.25 / 0.125 = 4 at r = 0.25; at the surface both forms agree (8)
	near(pull(A, { x: 0.25, y: 0 }).x, -4, 1e-12, "inside")
	near(pull(A, { x: 0.5, y: 0 }).x, -8, 1e-12, "surface")
	near(pull(A, { x: 0.4999999, y: 0 }).x, -8, 1e-5, "just inside")
	assert.deepEqual(pull(A, { x: 0, y: 0 }), { x: 0, y: 0 })
	assert.deepEqual(pull(A, { x: 1, y: 0 }, 0), { x: 0, y: 0 })
})

test("orbits: circular, escape, Kepler", () => {
	// low Earth orbit in real units: μ = 3.986004418e14, r = 6771 km: 7.67 km/s, 92.4 min
	const mu = 3.986004418e14
	near(circularSpeed(mu, 6.771e6), 7672.6, 1, "LEO speed")
	near(orbitPeriod(mu, 6.771e6) / 60, 92.4, 0.1, "LEO period")
	near(escapeSpeed(mu, 6.371e6), 11186, 1, "escape at the surface")
	// the Moon: a = 384,400 km, μ_E + μ_M -> sidereal month 27.3 days (27.32 d observed; the two-body period with the Moon's mass)
	near(orbitPeriod(mu + 4.9048695e12, 3.844e8) / 86400, 27.28, 0.05, "month")
})

test("primary: the Moon circles the Earth though the Sun pulls it harder", () => {
	const AU = 1.495978707e11
	const A = [
		{ at: { x: 0, y: 0 }, mu: 1.32712440018e20, radius: 0 },
		{ at: { x: AU, y: 0 }, mu: 3.986004418e14, radius: 0 }
	]
	const moon = { x: AU + 3.844e8, y: 0 }
	const fromSun = 1.32712440018e20 / (AU + 3.844e8) ** 2
	const fromEarth = 3.986004418e14 / 3.844e8 ** 2
	assert.ok(fromSun > 2 * fromEarth)
	assert.equal(primaryOf(A, moon, 4.9e12), 1)
	assert.equal(primaryOf(A, { x: AU, y: 0 }, 3.986e14, 1), 0)
	assert.equal(primaryOf(A, { x: 0, y: 0 }, 1.33e20, 0), -1)
})

test("launch: velocities, direction, barycentre kept", () => {
	const v = orbitVelocity({ x: 0, y: 0 }, 4, { x: 1, y: 0 }, 0, { factor: 1, direction: "ccw" })
	near(v.x, 0, 1e-15)
	near(v.y, 2, 1e-15)
	const w = orbitVelocity({ x: 0, y: 0 }, 4, { x: 1, y: 0 }, 0, { factor: 1, direction: "cw" })
	near(w.y, -2, 1e-15)
	// a planet (dynamic) and a moon of a hundredth its μ: momentum (∝ μ) stays zero
	const bodies = [
		{ at: { x: 0, y: 0 }, mu: 100, fixed: false },
		{ at: { x: 2, y: 0 }, mu: 1, fixed: false, launch: { factor: 1, direction: "ccw" as const } }
	]
	const L = launchVelocities(bodies)
	const px = 100 * (L[0]?.x ?? 0) + 1 * (L[1]?.x ?? 0)
	const py = 100 * (L[0]?.y ?? 0) + 1 * (L[1]?.y ?? 0)
	near(px, 0, 1e-12, "momentum x")
	near(py, 0, 1e-12, "momentum y")
	// relative speed is the two-body circular speed √(101/2)
	near((L[1]?.y ?? 0) - (L[0]?.y ?? 0), Math.sqrt(101 / 2), 1e-12, "relative")
	// a fixed sun, a planet and its moon: the moon rides on the planet's orbital velocity
	const sys = [
		{ at: { x: 0, y: 0 }, mu: 1000, fixed: true },
		{ at: { x: 1, y: 0 }, mu: 10, fixed: false, launch: { factor: 1, direction: "ccw" as const } },
		{ at: { x: 1.1, y: 0 }, mu: 0, fixed: false, launch: { factor: 1, direction: "ccw" as const } }
	]
	const V = launchVelocities(sys)
	near(V[0]?.y ?? 1, 0, 0, "sun")
	near(V[1]?.y ?? 0, Math.sqrt(1010), 1e-9, "planet")
	near((V[2]?.y ?? 0) - (V[1]?.y ?? 0), Math.sqrt(10 / 0.1), 1e-9, "satellite about the planet")
	// factor 0: at rest
	const R = launchVelocities([sys[0] as (typeof sys)[0], { at: { x: 1, y: 0 }, mu: 0, fixed: false, launch: { factor: 0, direction: "ccw" } }])
	assert.deepEqual(R[1], { x: 0, y: 0 })
})

test("phases: new, first quarter, full, last quarter; lit fraction", () => {
	const sun = { x: 100, y: 0 }
	const earth = { x: 0, y: 0 }
	const at = (deg: number) => ({ x: Math.cos((deg * Math.PI) / 180), y: Math.sin((deg * Math.PI) / 180) })
	assert.equal(moonPhase(sun, earth, at(0)).name, "new moon")
	near(moonPhase(sun, earth, at(0)).lit, 0, 1e-12)
	assert.equal(moonPhase(sun, earth, at(90)).name, "first quarter")
	near(moonPhase(sun, earth, at(90)).lit, 0.5, 0.006, "first quarter about half lit")
	assert.equal(moonPhase(sun, earth, at(180)).name, "full moon")
	near(moonPhase(sun, earth, at(180)).lit, 1, 1e-12)
	assert.equal(moonPhase(sun, earth, at(270)).name, "last quarter")
	assert.equal(moonPhase(sun, earth, at(45)).name, "waxing crescent")
	assert.equal(moonPhase(sun, earth, at(135)).name, "waxing gibbous")
	assert.equal(moonPhase(sun, earth, at(225)).name, "waning gibbous")
	assert.equal(moonPhase(sun, earth, at(315)).name, "waning crescent")
	assert.equal(moonPhase(sun, earth, at(350)).name, "new moon")
	assert.equal(moonPhase(sun, earth, at(90), false).name, "last quarter")
})

test("shadows: umbra, penumbra, light", () => {
	const sun = { at: { x: 0, y: 0 }, radius: 0.15 }
	const earth = { at: { x: 1.2, y: 0 }, radius: 0.1 }
	// umbra length behind Earth: 1.2 * 0.1 / 0.05 = 2.4 m
	assert.equal(shadowOn(sun, earth, { at: { x: 1.5, y: 0 }, radius: 0.02 }).in, "umbra")
	assert.equal(shadowOn(sun, earth, { at: { x: 1.5, y: 0 }, radius: 0.02 }).total, true)
	assert.equal(shadowOn(sun, earth, { at: { x: 1.5, y: 0.11 }, radius: 0.02 }).in, "penumbra")
	assert.equal(shadowOn(sun, earth, { at: { x: 1.5, y: 0.3 }, radius: 0.02 }).in, null)
	assert.equal(shadowOn(sun, earth, { at: { x: 0.9, y: 0 }, radius: 0.02 }).in, null)
})

test("terminal speed and fall time (NASA Glenn's formula; a vacuum)", () => {
	// a 2.7 g, 40 mm ping-pong ball, Cd 0.47: about 8.6 m/s
	near(terminalSpeed(0.0027, 9.81, 1.2, 0.47 * Math.PI * 0.02 * 0.02), 8.65, 0.02, "ping-pong")
	assert.equal(terminalSpeed(1, 9.81, 0, 1), Infinity)
	near(fallTime(1.6, 1.32, 1.62, 0, 0), Math.sqrt((2 * 1.6) / 1.62), 1e-12, "Apollo 15 drop in vacuum")
	near(fallTime(1, 1, 9.81, 1.2, 1e-9), Math.sqrt(2 / 9.81), 1e-6, "negligible drag")
	near(fallTime(1, 0.001, 9.81, 1.2, 0.0126), 0.958, 0.002, "a 1 g feather, 1 m")
})

test("the Sun's position, the day's length and the shadow (Meeus; Cooper's declination)", async () => {
	const { sunAt, dayLength, declination, shadowLength, TILT_DEG } = await import("./space.ts")
	assert.equal(declination("march equinox", 1), 0)
	assert.equal(declination("june solstice", 1), TILT_DEG)
	assert.equal(declination("december solstice", 1), -TILT_DEG)
	near(declination("day of year", 172), 23.44, 0.01, "Cooper on 21 June")
	const noon = sunAt(30.27, 0, 12)
	near(noon.elevation, 59.73, 1e-9, "noon at the equinox: 90 − latitude")
	near(noon.azimuth, 180, 1e-9, "due south")
	const nine = sunAt(30.27, 0, 9)
	near(nine.elevation, 37.6401, 1e-4, "9:00")
	assert.ok(nine.azimuth > 90 && nine.azimuth < 180, "the morning Sun is in the south-east")
	near(sunAt(30.27, 0, 15).azimuth, 360 - nine.azimuth, 1e-9, "15:00 mirrors 9:00")
	near(shadowLength(1, noon.elevation), 0.5837, 1e-4, "noon shadow")
	assert.equal(shadowLength(1, -3), 0)
	near(dayLength(30.27, 23.44), 13.954, 0.001, "June day in Austin")
	near(dayLength(30.27, -23.44), 10.046, 0.001, "December day")
	assert.equal(dayLength(80, 23.44), 24)
	assert.equal(dayLength(80, -23.44), 0)
})

// ---------------------------------------------------------------- (2026-10-20) the classroom models and the Moon's tilted orbit, in 3D
test("a globe: its axis, its town's day and night, its solar time, the light overhead (Meeus)", async () => {
	const { globeAxis, globeMeridian, globeTown, towardLight } = await import("./space.ts")
	const c = { x: 1, y: 0.4, z: 0 }
	const sun = { parallel: true, p: { x: -1, y: 0, z: 0 }, radius: 0.004653 }
	// leaning toward the camera with the light to one side: an equinox, the light over the equator
	const a = globeAxis(23.44, 0, 1)
	near(Math.hypot(a.x, a.y, a.z), 1, 1e-15, "a unit axis")
	const e1 = globeMeridian(a, towardLight(sun, c).s)
	for (const hour of [0, 6, 9, 12, 15, 18]) {
		const q = globeTown(a, e1, 30.27, (hour - 12) * 15, c, 0.15, sun)
		near(q.hour, hour, 1e-9, `its solar time at ${hour}:00`)
		near(q.dec, 0, 1e-12, "the light over the equator")
		const H = (hour - 12) * 15 * (Math.PI / 180)
		near(q.elevation, (Math.asin(Math.cos(30.27 * (Math.PI / 180)) * Math.cos(H)) * 180) / Math.PI, 1e-9, `parallel light: Meeus at ${hour}:00`)
		assert.equal(q.day, q.elevation > 0)
	}
	// leaning toward the light: the June solstice; away: December's
	const june = globeTown(globeAxis(23.44, -1, 0), globeMeridian(globeAxis(23.44, -1, 0), sun.p), 30.27, 0, c, 0.15, sun)
	near(june.dec, 23.44, 1e-9, "June: overhead at 23.44° N")
	near(june.noon, 83.17, 1e-9, "Austin's noon light")
	near(june.dayLength, 13.954, 0.001, "June day")
	const dec = globeTown(globeAxis(23.44, 1, 0), globeMeridian(globeAxis(23.44, 1, 0), sun.p), 30.27, 0, c, 0.15, sun)
	near(dec.dec, -23.44, 1e-9, "December: overhead at 23.44° S")
	near(dec.noon, 36.29, 1e-9, "Austin's December noon")
	// a near lamp: the lit cap is smaller than half (u·(L − c) > r): at the equator and an equinox the day ends at cos H = r/D
	const lamp = { parallel: false, p: { x: 0, y: 0.4, z: 0 }, radius: 0.03 }
	const up = globeAxis(0, 0, 1)
	const m = globeMeridian(up, towardLight(lamp, c).s)
	const H0 = (Math.acos(0.15 / 1) * 180) / Math.PI
	assert.equal(globeTown(up, m, 0, H0 - 0.01, c, 0.15, lamp).day, true)
	assert.equal(globeTown(up, m, 0, H0 + 0.01, c, 0.15, lamp).day, false)
	assert.ok(H0 < 90, "a near lamp lights less than half")
})

test("a carried ball: its circle, its phase by longitude, the lit fraction (Meeus ch. 48)", async () => {
	const { carriedAt, phase3D } = await import("./space.ts")
	const c = { x: 1, y: 0.4, z: 0 }
	const h = { x: -1, y: 0, z: 0 } // (toward a light on the left)
	const far = { parallel: true, p: { x: -1, y: 0, z: 0 }, radius: 0.004653 }
	for (const u of [0, 45, 90, 135, 180, 225, 270, 315]) {
		const { p } = carriedAt(c, h, 0.5, u, 0, 90)
		near(Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z), 0.5, 1e-12, `on its circle at ${u}°`)
		const ph = phase3D(far, c, p, { x: 0, y: 1, z: 0 })
		near(((ph.elongation - u) % 360 + 540) % 360 - 180, 0, 1e-9, `elongation ${u}°`)
		near(ph.lit, (1 - Math.cos((u * Math.PI) / 180)) / 2, 1e-12, `lit (1 − cos E)/2 at ${u}°`)
	}
	// counter-clockwise from above: the first quarter comes toward the camera (+z) with the light on the left
	near(carriedAt(c, h, 0.5, 90, 0, 90).p.z, 0.5, 1e-12, "first quarter in front")
	// tilted 30° about nodes square to the light: highest at full, lowest at new
	near(carriedAt(c, h, 0.5, 180, 30, 90).p.y - c.y, 0.25, 1e-12, "high at full")
	near(carriedAt(c, h, 0.5, 0, 30, 90).p.y - c.y, -0.25, 1e-12, "low at new")
	near(carriedAt(c, h, 0.5, 90, 30, 90).p.y - c.y, 0, 1e-12, "level at the nodes")
})

test("eclipses: the cones at the real sizes (lunar and solar kinds, the limits)", async () => {
	const { lunarEclipse, solarEclipse, shadowCone } = await import("./space.ts")
	const AU = 149597870.7
	const sun = { parallel: false, p: { x: -AU, y: 0, z: 0 }, radius: 695700 }
	const earth = { at: { x: 0, y: 0, z: 0 }, r: 6371 }
	const moonAt = (x: number, z: number) => ({ at: { x, y: 0, z }, r: 1737.4 })
	const c = shadowCone(sun, earth, moonAt(384400, 0))
	near(c.umbra, 4599.7, 0.2, "the Earth's umbra at the Moon: 4,600 km")
	near(c.penumbra, 8175.0, 0.2, "and its penumbra: 8,175 km")
	assert.equal(lunarEclipse(sun, earth, moonAt(384400, 0)), 3)
	assert.equal(lunarEclipse(sun, earth, moonAt(384400, 4000)), 2)
	assert.equal(lunarEclipse(sun, earth, moonAt(384400, 9000)), 1)
	assert.equal(lunarEclipse(sun, earth, moonAt(384400, 12000)), 0)
	assert.equal(lunarEclipse(sun, earth, moonAt(-384400, 0)), 0, "a new moon is not in the Earth's shadow")
	// solar: at the mean distance the Moon's umbra ends 50 km short of the Earth's middle (annular); at perigee it reaches (total)
	assert.equal(solarEclipse(sun, moonAt(-384400, 0), earth), 2)
	assert.equal(solarEclipse(sun, moonAt(-356500, 0), earth), 3)
	assert.equal(solarEclipse(sun, moonAt(-384400, 8000), earth), 1)
	assert.equal(solarEclipse(sun, moonAt(-384400, 12000), earth), 0)
	assert.equal(solarEclipse(sun, moonAt(384400, 0), earth), 0, "a full moon casts no shadow on the Earth")
})

test("seasons: the pole kept leaning one way round the orbit (Meeus)", async () => {
	const { seasonLean, seasonsAt } = await import("./space.ts")
	// the Earth to the right of the Sun at the March equinox, going round counter-clockwise
	const b = seasonLean("march equinox", -1, 0, 1)
	for (const deg of [0, 90, 180, 270]) {
		const th = (deg * Math.PI) / 180
		const q = seasonsAt(23.44, b.x, b.y, -Math.cos(th), -Math.sin(th), 30.27)
		near(q.dec, (Math.asin(Math.sin((23.44 * Math.PI) / 180) * Math.sin(th)) * 180) / Math.PI, 1e-9, `${deg}° round the Sun`)
	}
	near(seasonsAt(23.44, b.x, b.y, 0, -1, 30.27).noon, 83.17, 1e-9, "a quarter year on: the June solstice")
	near(seasonsAt(23.44, b.x, b.y, 0, 1, 30.27).noon, 36.29, 1e-9, "three quarters on: December's")
	const j = seasonLean("june solstice", -1, 0, 1)
	near(seasonsAt(23.44, j.x, j.y, -1, 0, 0).dec, 23.44, 1e-12, "June: the pole toward the Sun")
	const s = seasonLean("september equinox", -1, 0, -1)
	near(seasonsAt(23.44, s.x, s.y, -1, 0, 0).dec, 0, 1e-12, "an equinox either way round")
})
