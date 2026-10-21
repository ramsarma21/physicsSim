// Unit tests of the energy module's pure physics (tooling/src/sim/energy.ts, blade-element momentum):
//   node --test --no-warnings --import ./tools/engine-math-node.mjs tooling/src/sim/energy.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { annuliOf, axialInduction, bladeInertia, elementForce, lossFactor, type Rotor, relaxInduction, rotorLoads, steadyAnnulus } from "./energy.ts"

const D2R = Math.PI / 180
const near = (a: number, b: number, tol: number, what = "") => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} vs ${b} (±${tol})`)
/** The default model wind turbine's rotor (3 flat blades 15 × 6 cm at 20° from a 3 cm hub) and the default paper windmill's (4 sails). */
const turbine: Rotor = { blades: 3, r0: 0.03, R: 0.18, chord: [0.06, 0.06], pitch: [20 * D2R, 20 * D2R], ar: 2.5, cd0: 0.02, stations: 8 }
const pinwheel: Rotor = {
	blades: 4, r0: 0.012, R: 0.1, chord: [(0.3 * 2 * Math.PI * 0.012) / 4, (0.3 * 2 * Math.PI * 0.1) / 4], pitch: [33 * D2R, 18 * D2R], ar: 3.3333, cd0: 0.02, stations: 8
}
/** The steady loads at a fixed turning in an even wind (the induction relaxed to its fixed point). */
const steady = (rot: Rotor, U: number, omega: number, rho = 1.2, steps = 150) => {
	const ans = annuliOf(rot)
	const ind = { a: ans.map(() => 0), ap: ans.map(() => 0) }
	let L = { torque: 0, thrust: 0, wind: 0 }
	for (let k = 0; k < steps; k++) L = rotorLoads(rot, ans, omega, rho, () => ({ axial: U, across: 0 }), ind)
	return { ...L, ind, ans }
}
const cpOf = (rot: Rotor, U: number, lam: number) => {
	const omega = (lam * U) / rot.R
	const L = steady(rot, U, omega)
	return (L.torque * omega) / (0.5 * 1.2 * Math.PI * rot.R * rot.R * U * U * U)
}

test("annuli: equal widths from r0 to R, chord and pitch straight between their ends, solidity B·c/(2πr)", () => {
	const ans = annuliOf(pinwheel)
	assert.equal(ans.length, 8)
	near(ans.reduce((s, a) => s + a.dr, 0), pinwheel.R - pinwheel.r0, 1e-12, "widths")
	const a0 = ans[0] as (typeof ans)[0]
	near(a0.sigma, (4 * a0.c) / (2 * Math.PI * a0.r), 1e-12, "solidity")
	// the pinwheel's chord grows with r at a fixed solidity of 0.3
	for (const a of ans) near(a.sigma, 0.3, 1e-9, `solidity at ${a.r}`)
})

test("Prandtl's loss: 1 far from the tip and hub, toward 0 at the tip; Glauert below a = 0.4, Buhl above, continuous there", () => {
	near(lossFactor(3, 0.1, 0.18, 0.03, 0.05), 1, 1e-6, "mid-blade, flat inflow")
	assert.ok(lossFactor(3, 0.1799, 0.18, 0.03, 0.9) < 0.1, "at the tip")
	near(axialInduction(0.25, 1), 0.2, 1e-12, "Glauert a = k/(1 + k)")
	near(axialInduction(2 / 3, 1), 0.4, 1e-12, "a = 0.4 where the branches meet")
	near(axialInduction(2 / 3 + 1e-9, 1), 0.4, 1e-6, "Buhl's branch starts at 0.4")
	assert.ok(axialInduction(5, 1) > 0.5 && axialInduction(5, 1) <= 0.95, "turbulent wake state, bounded")
})

test("the relaxed induction is the steady BEM solution (a bracketed root of Ning's residual)", () => {
	for (const rot of [turbine, pinwheel]) {
		for (const lam of [0.5, 1, 2, 3]) {
			const U = 4
			const omega = (lam * U) / rot.R
			const L = steady(rot, U, omega, 1.2, 600)
			L.ans.forEach((an, j) => {
				const s = steadyAnnulus(an, rot, U, omega)
				if (s === undefined || s.ap > 3.9) return
				near(L.ind.a[j] as number, s.a, 1e-7, `a, λ ${lam}, annulus ${j}`)
				near(L.ind.ap[j] as number, s.ap, 1e-6, `a', λ ${lam}, annulus ${j}`)
			})
		}
	}
})

test("never more than Betz's 16/27 of the wind's power, for any pitch, blades and speed", () => {
	let most = 0
	for (const B of [2, 3, 6])
		for (const p of [0, 10, 20, 35])
			for (const lam of [1, 2, 3, 5]) {
				const rot = { ...turbine, blades: B, pitch: [p * D2R, p * D2R] as [number, number] }
				most = Math.max(most, cpOf(rot, 5, lam))
			}
	assert.ok(most > 0.1 && most < 16 / 27, `best Cp ${most}`)
})

test("the default paper windmill peaks near Cp 0.17 at a tip speed ratio about 2 (wind-tunnel pinwheels, Wind Engineering 27, 2003)", () => {
	let best = { lam: 0, cp: -1 }
	for (let lam = 1; lam <= 3; lam += 0.1) {
		const cp = cpOf(pinwheel, 4, lam)
		if (cp > best.cp) best = { lam, cp }
	}
	assert.ok(best.cp > 0.15 && best.cp < 0.2, `Cp max ${best.cp}`)
	assert.ok(best.lam > 1.7 && best.lam < 2.3, `at λ ${best.lam}`)
})

test("still air: a turning rotor is only slowed (its blades' drag); a wind from behind turns it backwards", () => {
	const still = steady(turbine, 0, 50)
	assert.ok(still.torque < 0, `torque ${still.torque}`)
	const back = steady(turbine, -4, 0)
	assert.ok(back.torque < 0, `wind from behind: torque ${back.torque}`)
	const ahead = steady(turbine, 4, 0)
	assert.ok(ahead.torque > 0, `wind from ahead: torque ${ahead.torque}`)
	// (from behind it takes no induction: a turbine is not built to face away from the wind, and the run says so; so a little more torque)
	assert.ok(-back.torque >= ahead.torque && -back.torque < 1.5 * ahead.torque, `${-back.torque} vs ${ahead.torque}`)
})

test("an element's force: along its turning a pitched plate is driven by an axial wind; a plate in the rotor's face (pitch 90°) is not", () => {
	const an = { r: 0.1, dr: 0.01, c: 0.05, beta: 20 * D2R, sigma: 0.24 }
	const f = elementForce(an, turbine, 1.2, 5, 0)
	assert.ok(f.ft > 0 && f.fn > 0, `${f.ft}, ${f.fn}`)
	const flat = elementForce({ ...an, beta: 90 * D2R }, turbine, 1.2, 5, 0)
	near(flat.ft, 0, 1e-12, "edge-on to the wind's push")
})

test("a quarter step toward the target each step (dynamic inflow); no wind, no induction", () => {
	const an = annuliOf(turbine)[3] as ReturnType<typeof annuliOf>[0]
	const one = relaxInduction(an, turbine, 5, 60, 0, 0)
	const target = relaxInduction(an, turbine, 5, 60, 0, 0, 1)
	near(one.a, 0.25 * target.a, 1e-12, "a quarter")
	const none = relaxInduction(an, turbine, 0, 60, 0.3, 0.1)
	near(none.a, 0.3 * 0.75, 1e-12, "decays without wind")
})

test("blade inertia: B flat blades as the integral of sheet·c(r)·r² dr", () => {
	// a rectangle 15 × 6 cm from r 3 to 18 cm, 0.65 kg/m²: per blade m·(r_mid² + L²/12) with m = 0.65·0.15·0.06
	const m = 0.65 * 0.15 * 0.06
	const one = m * (0.105 * 0.105 + (0.15 * 0.15) / 12)
	near(bladeInertia(turbine, 0.65), 3 * one, 3 * one * 1e-3, "three blades")
})
