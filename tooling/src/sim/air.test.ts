// Unit tests of the air module's pure physics (tooling/src/sim/air.ts): node --test tooling/src/sim/air.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import {
	ATM,
	GAS_R,
	KELVIN,
	MOLAR,
	RUBBER,
	balloonRadius,
	bucklingPressure,
	buoyancyFlux,
	bursts,
	liftSlope,
	normalCoefficient,
	plumeSpeed,
	pressureCentre,
	randomOf,
	rubberShape,
	skinPressure,
	sphereVolume,
	stallAngle,
	steamPressure,
	surfaceForce
} from "./air.ts"

const near = (a: number, b: number, tol: number, what = "") => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} vs ${b} (±${tol})`)

test("gas constants: air at 20 °C, 1 atm weighs 1.204 kg/m³ (the engine uses 1.2); helium 0.166", () => {
	near((ATM * MOLAR.air) / (GAS_R * 293.15), 1.2041, 0.0005, "air")
	near((ATM * MOLAR.helium) / (GAS_R * 293.15), 0.1664, 0.0005, "helium")
})

test("balloon rubber: Merritt & Weinhaus curve (peak near λ 1.38, slack below 1, rated 3 kPa at λ 6)", () => {
	assert.equal(rubberShape(1), 0)
	assert.equal(rubberShape(0.7), 0)
	near(skinPressure(RUBBER.full), 3000, 1e-9, "rated")
	// the first peak: between λ 1.3 and 1.5, and a dip after it (the "hardest first breath")
	let peak = 0
	let at = 0
	for (let l = 1.01; l < 2.5; l += 0.01) if (skinPressure(l) > peak) ((peak = skinPressure(l)), (at = l))
	assert.ok(at > 1.3 && at < 1.5, `peak at ${at}`)
	assert.ok(skinPressure(3) < peak, "dips after the peak")
	assert.ok(skinPressure(7.5) > skinPressure(6), "stiffens toward bursting")
})

test("balloon size: 8 L of air at 20 °C in an 11-inch (28 cm) balloon is about 25 cm across, pressure ~3 kPa", () => {
	const r0 = 0.14 / RUBBER.full
	const n = (ATM * 0.008) / (GAS_R * 293.15)
	const r = balloonRadius(n, 293.15, ATM, r0, r0 * RUBBER.burst)
	near(2 * r, 0.247, 0.004, "diameter")
	const dp = skinPressure(r / r0)
	assert.ok(dp > 2000 && dp < 3500, `dp ${dp}`)
	// the gas law holds at the answer
	near((ATM + dp) * sphereVolume(r), n * GAS_R * 293.15, 1e-6, "PV = nRT")
	// a colder room makes it smaller (Charles): at -18 °C the same air takes 13 % less room
	const cold = balloonRadius(n, 255.15, ATM, r0, r0 * RUBBER.burst)
	near(sphereVolume(cold) / sphereVolume(r), 255.15 / 293.15, 0.01, "V ∝ T")
	// in a vacuum it bursts; overfilled it bursts
	assert.equal(bursts(n, 293.15, 0, r0), true)
	assert.equal(bursts(n * 2, 293.15, ATM, r0), false)
	assert.equal(bursts(n * 4, 293.15, ATM, r0), true)
	assert.equal(bursts(n, 293.15, ATM, r0), false)
	// almost empty: limp at half its slack size or more
	assert.equal(balloonRadius(0, 293.15, ATM, r0, r0 * RUBBER.burst), 0.5 * r0)
})

test("a helium balloon lifts; an air one does not", () => {
	const r0 = 0.14 / RUBBER.full
	const n = (ATM * 0.01) / (GAS_R * 293.15)
	const r = balloonRadius(n, 293.15, ATM, r0, r0 * RUBBER.burst)
	const V = sphereVolume(r)
	const rubber = 0.003
	near(1.2 * V - rubber - n * MOLAR.helium, 0.0070, 0.0003, "helium net lift kg (10 L: 11.6 g of air pushed aside, 3 g rubber, 1.7 g helium)")
	assert.ok(1.2 * V - rubber - n * MOLAR.air < 0, "air sinks")
})

test("water vapour (Buck): 2.34 kPa at 20 °C, 101.3 kPa at 100 °C, 0.61 kPa at 0 °C", () => {
	near(steamPressure(20), 2339, 5, "20 °C")
	near(steamPressure(100), 101325, 400, "100 °C")
	near(steamPressure(0), 611.2, 0.1, "0 °C")
})

test("a soda can buckles at about 8.7 kPa below the room (Windenburg & Trilling)", () => {
	const p = bucklingPressure(69e9, 0.33, 0.000097, 0.066, 0.115)
	near(p, 8740, 120, "buckling Pa")
	// cooled from 100 °C steam with 3 % air left to 2 °C water: the inside falls to about 3.6 kPa, far below the room minus it
	const inside = 0.03 * ATM * (275.15 / 373.15) + Math.min(0.97 * ATM, steamPressure(2))
	assert.ok(ATM - inside > p * 10, `inside ${inside}`)
})

test("flat plates: Helmbold slope, symmetric normal force, crossflow at 90°, stall", () => {
	near(liftSlope(1e6), 2 * Math.PI, 1e-4, "infinite wing")
	near(liftSlope(1), 1.4829, 1e-3, "AR 1")
	near(normalCoefficient(Math.PI / 2, 1), 1.2, 1e-9, "broadside")
	near(normalCoefficient(-0.3, 2), -normalCoefficient(0.3, 2), 1e-12, "odd")
	near(normalCoefficient(Math.PI - 0.3, 2), normalCoefficient(0.3, 2), 1e-12, "met back-first")
	// a high aspect ratio wing stalls by 15°: past it its normal force falls below what its lift slope would give
	assert.ok(normalCoefficient(0.5, 6) < liftSlope(6) * Math.sin(0.5) * Math.cos(0.5), "stalled")
	assert.ok(stallAngle(1) > stallAngle(6))
	near(pressureCentre(0), 0.25, 1e-12)
	near(pressureCentre(Math.PI / 2), 0.5, 1e-12)
})

test("a flat plate in a 5 m/s wind: lift up, drag downwind, as ½ρv²S·C_N", () => {
	// a 0.5 × 0.5 m plate held at 20° to a wind blowing +x, its leading edge upwind (to the left) and high
	const s = { lx: 0.25, ly: 0, ang: 0, c: 0.5, S: 0.25, AR: 1, cd0: 0 }
	const pose = { x: 0, y: 1, angle: Math.PI - 0.349 }
	const f = surfaceForce(s, pose, { x: 0, y: 0 }, 0, 1.2, () => ({ x: 5, y: 0 }))
	const cn = normalCoefficient(0.349, 1)
	near(Math.hypot(f.fx, f.fy), 0.5 * 1.2 * 25 * 0.25 * cn, 1e-9, "magnitude")
	assert.ok(f.fy > 0 && f.fx > 0, `lift and drag ${f.fx} ${f.fy}`)
	near(Math.abs(f.alpha), 0.349, 1e-9, "angle of attack")
})

test("plumes: an incense stick's 1.5 W rises at about 0.2 m/s 10 cm up; a cold thing's sinks", () => {
	const F = buoyancyFlux(1.5, 9.81, 293.15)
	near(F, 4.15e-5, 2e-6, "F")
	const w = plumeSpeed(F, 0.1)
	assert.ok(w > 0.15 && w < 0.35, `w ${w}`)
	assert.ok(plumeSpeed(-F, 0.1) < 0)
	assert.ok(plumeSpeed(F, 0.5) < w, "slows as it climbs")
})

test("the jitter generator repeats for the same seed", () => {
	const a = randomOf("smoke:x")
	const b = randomOf("smoke:x")
	for (let i = 0; i < 100; i++) assert.equal(a(), b())
	const c = randomOf("smoke:y")
	let same = 0
	for (let i = 0; i < 100; i++) if (a() === c()) same++
	assert.ok(same < 3)
	void KELVIN
})
