// Unit tests of the fracture module's pure physics (tooling/src/sim/fracture.ts): node --test tooling/src/sim/fracture.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { Padding, beamImpact, bendingMoment, bodyCap, bodyForce, isBodyLaw, lnOf, supportedMoment, glueShare, peakForce, sagOf, seedOf, sequence, strainCap, stress } from "./fracture.ts"

const near = (a: number, b: number, tol: number, what = "") => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} vs ${b} (±${tol})`)
const G = 9.81
const drop = (h: number) => Math.sqrt(2 * G * h)
const EGG = { m: 0.057, k: 21500, R: 0.022, limit: 35 }
const FOAM = [1, 4000, 0.4, 0.8]
const PILLOW = [3, 230]
const AIR = [2, 55700]

test("a spring impact with no padding: F = v·√(k·m)", () => {
	near(peakForce(EGG.m, 1.0, EGG.k).force, Math.sqrt(EGG.k * EGG.m), 1e-9, "1 m/s")
	near(peakForce(2, 3, 1000).force, 3 * Math.sqrt(2000), 1e-9, "general")
	assert.equal(peakForce(0, 3, 1000).force, 0)
	assert.equal(peakForce(1, 0, 1000).force, 0)
})

test("the egg calibration: it cracks (35 N) from a 1.0 m/s impact on a rigid floor (Trnka et al.), a 5.1 cm drop", () => {
	near(peakForce(EGG.m, 1.0, EGG.k).force, 35.0, 0.05)
	assert.ok(peakForce(EGG.m, drop(0.045), EGG.k).force < EGG.limit, "4.5 cm survives")
	assert.ok(peakForce(EGG.m, drop(0.055), EGG.k).force > EGG.limit, "5.5 cm cracks")
})

test("compression laws: the values the sources give", () => {
	near(stress(FOAM, 0.4), 4000, 1e-9, "PU foam CLD 40 % = 4 kPa")
	near(stress([1, 100000, 0.1, 0.75], 0.1), 100000, 1e-6, "EPS 100 kPa at 10 %")
	near(stress(AIR, 0.5), 55700, 1e-9, "Boyle: q·ε/(1−ε) at ε = 0.5 is q")
	near(stress(PILLOW, 0.5), 230 * 7, 1e-9, "van Wyk: s0·(1/(1−ε)³ − 1) at 0.5 = 7 s0")
	near(stress([4, 3e6, 0.5], 0.1), 3e5, 1e-6, "rubber E·ε")
	assert.ok(stress(FOAM, 0.03) < stress(FOAM, 0.05) && stress(FOAM, 0) === 0, "foam: linear from 0 below 5 %")
	near(strainCap(FOAM), 0.76, 1e-12)
	near(strainCap(PILLOW), 0.9, 1e-12)
	// monotone
	for (const law of [FOAM, AIR, PILLOW, [1, 100000, 0.1, 0.75], [4, 3e6, 0.5]]) {
		let last = -1
		for (let e = 0; e <= strainCap(law); e += 0.01) {
			const s = stress(law, e)
			assert.ok(s >= last, `monotone ${law} at ${e}`)
			last = s
		}
	}
})

test("padding: the work done is the integral of F dx, and F(x) inverts", () => {
	const p = new Padding(FOAM, 0.05, { area: 0.01 })
	// flat face: F = σ(ε)·A; check a sample against the law
	const x = 0.02
	near(p.at(stress(FOAM, x / 0.05) * 0.01).x, x, 2e-4, "inverse")
	// work at bottoming vs a fine numerical integral
	let w = 0
	const n = 100000
	const xmax = strainCap(FOAM) * 0.05
	for (let i = 0; i < n; i++) {
		const a = (xmax * i) / n
		const b = (xmax * (i + 1)) / n
		w += ((stress(FOAM, a / 0.05) + stress(FOAM, b / 0.05)) / 2) * 0.01 * (b - a)
	}
	near(p.at(1e9).w, w, w * 0.01, "work to bottoming")
	assert.equal(p.at(1e9).x, xmax)
	// round end: the cap's area π(2Rx − x²)
	const r = new Padding(PILLOW, 0.15, { radius: EGG.R })
	const xx = 0.01
	near(r.at(stress(PILLOW, xx / 0.15) * Math.PI * (2 * EGG.R * xx - xx * xx)).x, xx, 2e-4, "round end inverse")
})

test("padding lowers the peak force and stores the energy", () => {
	const v = drop(1.0)
	const bare = peakForce(EGG.m, v, EGG.k).force
	const foam = new Padding(FOAM, 0.05, { radius: EGG.R })
	const r = peakForce(EGG.m, v, EGG.k, [foam])
	assert.ok(r.force < bare, "foam helps")
	// energy balance at the peak
	near(r.force ** 2 / (2 * EGG.k) + foam.at(r.force).w, 0.5 * EGG.m * v * v, 1e-6, "energy")
	// thicker / softer is gentler
	const thick = peakForce(EGG.m, v, EGG.k, [new Padding(FOAM, 0.1, { radius: EGG.R })]).force
	const pillow = peakForce(EGG.m, v, EGG.k, [new Padding(PILLOW, 0.15, { radius: EGG.R })]).force
	assert.ok(thick < r.force && pillow < r.force, `thick ${thick}, pillow ${pillow} < 5 cm foam ${r.force}`)
	// thin padding bottoms out: almost the bare force from high up
	const thin = peakForce(EGG.m, drop(2), EGG.k, [new Padding(FOAM, 0.005, { radius: EGG.R })]).force
	assert.ok(thin > 0.9 * peakForce(EGG.m, drop(2), EGG.k).force, `a 5 mm pad from 2 m bottoms out (${thin})`)
})

test("egg crack heights on padding (the module's claims)", () => {
	const crack = (law: number[], t: number) => {
		let lo = 0
		let hi = 10
		for (let i = 0; i < 60; i++) {
			const mid = (lo + hi) / 2
			if (peakForce(EGG.m, drop(mid), EGG.k, [new Padding(law, t, { radius: EGG.R })]).force < EGG.limit) lo = mid
			else hi = mid
		}
		return lo
	}
	const foam = crack(FOAM, 0.05)
	const pillow = crack(PILLOW, 0.15)
	assert.ok(foam > 0.45 && foam < 0.65, `5 cm soft foam: about 50 cm (${foam})`)
	assert.ok(pillow > 0.85 && pillow < 1.05, `a 15 cm fiberfill pillow: about 95 cm (${pillow})`)
	assert.ok(crack([1, 100000, 0.1, 0.75], 0.05) < 0.2, "stiff packing foam protects an egg little")
})

test("beam bending: a centre load P on a simple span L gives P·L/4 under it", () => {
	const L = 0.24
	const P = 2
	// supports at ±0.1 (span 0.2), load at 0, beam weight left out (forces balance)
	const f = [{ s: -0.1, f: P / 2 }, { s: 0.1, f: P / 2 }, { s: 0, f: -P }]
	near(bendingMoment(f, L, 0), (P * 0.2) / 4, 1e-12, "middle")
	near(bendingMoment(f, L, 0.05), (P / 2) * 0.05, 1e-12, "quarter")
	near(bendingMoment(f, L, 0.11), 0, 1e-12, "over the support's end")
	// a beam in free fall (no forces) bends nowhere
	assert.ok(Math.abs(bendingMoment([], L, 0)) === 0)
	// its own weight (uniform) on two end supports: w·L²/8 in the middle when the supports are at the ends
	const W = 1
	near(bendingMoment([{ s: -L / 2, f: W / 2 }, { s: L / 2, f: W / 2 }], L, 0), (W * L) / 8, 1e-12, "uniform load")
})

test("a beam on two supports: reactions from its balance", () => {
	const L = 0.24
	// a centre load P on supports at ±0.1: P·L/4
	near(supportedMoment([{ s: 0, f: -2 }], L, 0, -0.1, 0.1, 0), (2 * 0.2) / 4, 1e-12, "centre load")
	// off-centre load at a from the left support: P·a·b/L under it
	near(supportedMoment([{ s: -0.05, f: -2 }], L, 0, -0.1, 0.1, -0.05), (2 * 0.05 * 0.15) / 0.2, 1e-12, "P·a·b/L")
	// its own weight w over supports at its ends: w·L²/8
	near(supportedMoment([], L, 3, -L / 2, L / 2, 0), (3 * L * L) / 8, 1e-12, "w·L²/8")
	// a load on an overhang bends it the other way over the support (hogging): −P·c
	near(supportedMoment([{ s: 0.12, f: -1 }], L, 0, -0.1, 0.1, 0.1), -1 * 0.02, 1e-12, "overhang")
	// nothing beyond the supports' span outside them but the overhang's own
	near(supportedMoment([{ s: 0, f: -2 }], L, 0, -0.1, 0.1, 0.11), 0, 1e-12)
})

test("a dropped load on a span: k = 48EI/L³ in the middle, F = v√(km)", () => {
	const EI = 0.00943791
	const im = beamImpact(EI, 0.1, 0.1, 0.1, 1)
	near(im.k, (48 * EI) / 0.2 ** 3, 1e-9, "48EI/L³")
	near(im.force, Math.sqrt(im.k * 0.1), 1e-12)
	near(im.momentAt(0.1), (im.force * 0.2) / 4, 1e-12, "F·L/4 under it")
	assert.equal(im.momentAt(0), 0)
	near(sagOf((2 * 0.2) / 4, 0.2, EI), (2 * 0.2 ** 3) / (48 * EI), 1e-12, "sag P·L³/48EI")
})

test("glue: tension from a moment and a pull, the block's weight holding it", () => {
	const w = 0.1
	const d = 0.05
	near(glueShare(0, 0, 0, w, d, 1e4, 1e4), 0, 1e-12)
	near(glueShare(-50, 0, 0, w, d, 1e4, 1e4), 50 / (w * d) / 1e4, 1e-12, "a pull")
	near(glueShare(0, 0, 1, w, d, 1e4, 1e4), 6 / (d * w * w) / 1e4, 1e-12, "a moment")
	near(glueShare(10, 0, 0, w, d, 1e4, 1e4), 0, 1e-12, "pressed together: no glue stress")
	near(glueShare(0, 20, 0, w, d, 1e4, 1e4), 20 / (w * d) / 1e4, 1e-12, "shear")
})

test("deterministic scatter", () => {
	const a = sequence(seedOf("egg"))
	const b = sequence(seedOf("egg"))
	for (let i = 0; i < 10; i++) assert.equal(a(), b())
	const c = sequence(42)
	for (let i = 0; i < 1000; i++) {
		const v = c()
		assert.ok(v >= 0 && v < 1)
	}
})

test("lnOf: ln from square roots and arithmetic only, to 1e-12 over 1e-6 … 1e6", () => {
	for (const x of [1e-6, 0.003, 0.5, 0.9, 1, 1.05, 2, Math.E, 10, 60, 1234.5, 1e6]) near(lnOf(x), Math.log(x), 1e-12 * Math.max(1, Math.abs(Math.log(x))), `ln ${x}`)
	assert.equal(lnOf(0), 0)
	assert.equal(lnOf(-1), 0)
})

test("soft bodies (laws 5-8): their forces, caps, and in series with the egg", () => {
	const egg = { radius: 0.022 }
	// an inflated ball (65 cm, 4 kPa): the gas on the flat π(2·R_eff·x − x²) plus the skin's pull 2πTx/ln(R/a), T = Δp·R/2
	const ex = [5, 4000, 0.325, 0, 0.1625]
	assert.ok(isBodyLaw(ex) && !isBodyLaw(FOAM))
	near(bodyCap(ex), 0.1625, 0)
	const Re = (0.325 * 0.022) / (0.325 + 0.022)
	const x = 0.005
	const want = 4000 * Math.PI * (2 * Re * x - x * x) + (2 * Math.PI * ((4000 * 0.325) / 2) * x) / Math.log(0.325 / Re)
	near(bodyForce(ex, x, egg), want, 1e-9, "inflated at 5 mm")
	// past R_eff the flat stops growing; the skin's pull at most 2π·a·T
	near(bodyForce(ex, 0.5, egg), 4000 * Math.PI * Re * Re + 2 * Math.PI * Re * 650, 1e-9, "deep: capped")
	// Hertz: (4/3)·E*·√R_eff·x^1.5
	const foam = [6, 1e5 / 0.91, 0.035, 0.021]
	const Rf = (0.035 * 0.022) / 0.057
	near(bodyForce(foam, 0.004, egg), (4 / 3) * (1e5 / 0.91) * Math.sqrt(Rf) * 0.004 * Math.sqrt(0.004), 1e-9, "hertz")
	// clay flows at p over the flat, elastic k_c below it
	const clay = [7, 360000, 0.1, 50, 0.03]
	const Rc = (0.1 * 0.022) / 0.122
	near(bodyForce(clay, 0.002, egg), Math.min(50 * 2 * Math.PI * Rc * 360000 * 0.002, 360000 * Math.PI * (2 * Rc * 0.002 - 0.002 * 0.002)), 1e-9, "clay")
	// a sprung mat: k·x, its travel
	near(bodyForce([8, 300, 0.315], 0.1, egg), 30, 1e-12, "sprung")
	near(bodyCap([8, 300, 0.315]), 0.315, 0)
	// in series with an egg: the trampoline's k and the egg's together, the energy balance with no padding thickness
	const v = 4.43
	near(peakForce(EGG.m, v, EGG.k, [new Padding([8, 300, 0.315], 0, egg)]).force, v * Math.sqrt(((EGG.k * 300) / (EGG.k + 300)) * EGG.m), 0.02, "trampoline: springs in series")
	// a soft ball always gives less force than a rigid floor; a stiffer (more pumped) ball more than a softer one
	const rigid = peakForce(EGG.m, 3.13, EGG.k).force
	const soft = peakForce(EGG.m, 3.13, EGG.k, [new Padding([5, 500, 0.325, 0, 0.1625], 0, egg)]).force
	const firm = peakForce(EGG.m, 3.13, EGG.k, [new Padding(ex, 0, egg)]).force
	assert.ok(soft < firm && firm < rigid, `${soft} < ${firm} < ${rigid}`)
	// a flat face (a box's bottom) on a ball: R_eff = R, the flat at most the face's area
	near(bodyForce([5, 4000, 0.325, 0, 0.16], 0.3, { area: 0.0225 }), 4000 * 0.0225 + 2 * Math.PI * Math.sqrt(0.0225 / Math.PI) * 650, 1e-6, "flat face, deep")
})
