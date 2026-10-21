/**
 * The energy module's engine physics (module "energy", 2026-10-20; machines/mod_energy.py builds its records, web/sim/modules/energy.js is its port):
 * a rotor turned by the moving air (a model wind turbine, a paper windmill), by blade-element momentum theory. Pure: no planck, no imports
 * but the flat plate's normal force (tooling/src/sim/air.ts, the paper planes' and kites' own), so it is tested on its own (energy.test.ts).
 *
 * A rotor is `blades` flat blades from radius r0 to R about a shaft along the wind: each blade is cut into `stations` elements (annuli of equal
 * width). An element at radius r, chord c and pitch β (its chord's angle from the rotor's plane) meets the air at
 *     V_a = U·(1 − a)          along the shaft (U: the wind's component along the shaft there; a: the axial induction, the rotor slowing it)
 *     V_t = ω·r·(1 + a') − u_t  across it, against the way it turns (a': the swirl the rotor puts into its wake; u_t: the wind's own
 *                               component along the blade's path, a yawed rotor's or a jet's spread)
 * at the inflow angle ϕ = atan2(V_a, V_t) and the angle of attack α = ϕ − β, and feels per metre of span ½ρ(V_a² + V_t²)·c times
 *     C_n = C_N(α)·cos β + c_d0·sin ϕ    along the shaft (thrust)
 *     C_t = C_N(α)·sin β − c_d0·cos ϕ    along its turning (torque, × r)
 * with C_N the thin flat plate's normal-force coefficient (air.ts normalCoefficient: Helmbold's lift slope for the blade's aspect ratio, its stall,
 * the crossflow drag broadside) and c_d0 its skin friction. The induction of each annulus follows the momentum balance of the stream tube
 * through it (Glauert; Hansen, Aerodynamics of Wind Turbines, 3rd ed. 2015, ch. 6; Prandtl's tip and hub losses F; Buhl's empirical
 * high-induction branch for a > 0.4, NREL/TP-500-36834, 2005, in Ning's form, Wind Energy 17, 1327 (2014)):
 *     a target:  k = σ·C_n/(4F·sin²ϕ),  a = k/(1 + k) (k ≤ 2/3), else Buhl's;   a' target: k' = σ·C_t/(4F·sinϕ·cosϕ), a' = k'/(1 − k')
 * (σ = B·c/(2πr), the annulus's solidity). The induction is relaxed toward its target by a quarter each step (`RELAX`): a dynamic inflow
 * with a time constant of four steps (8 ms), so a step's solve is one evaluation per annulus, and at a steady ω it is the steady BEM solution
 * exactly (rw-validate-energy.ts checks it against a bracketed root solve of the same equations, and the power against Betz's 16/27).
 * The wind is sampled at each element's own place (the air the engine blows there: a fan's round jet is narrower than a big rotor), the
 * induction per annulus from the mean over its blades.
 *
 * Deterministic: + − × ÷, sqrt, abs, min, max and the engine's sin, cos, atan2, exp (the same bits in the bundle and on the server).
 */
import { normalCoefficient } from "#sim/air.ts"

export interface Rotor {
	/** blades (2-12) */
	readonly blades: number
	/** the blades' inner and outer radius (m) */
	readonly r0: number
	readonly R: number
	/** chord (m) at r0 and at R, straight between */
	readonly chord: readonly [number, number]
	/** pitch (rad from the rotor's plane) at r0 and at R, straight between */
	readonly pitch: readonly [number, number]
	/** a blade's aspect ratio (its span over its mean chord: the flat plate's lift slope and stall) */
	readonly ar: number
	/** skin friction coefficient (both faces) */
	readonly cd0: number
	/** elements per blade */
	readonly stations: number
}

/** One annulus: its middle radius, width, chord, pitch and solidity. */
export interface Annulus {
	readonly r: number
	readonly dr: number
	readonly c: number
	readonly beta: number
	readonly sigma: number
}

/** The relaxation of each annulus's induction toward its momentum target, a share per step (see the header). */
export const RELAX = 0.25
/** The induction kept within: a (the turbulent wake's state past 0.95 is not a windmill's) and a' (the swirl at a crawling rotor's root: k' ≥ 0.8
 *  is held at a' = 4, where the blade's own speed is a fifth of the air's across it). */
const A_MIN = -0.5
const A_MAX = 0.95
const AP_MIN = -0.5
const AP_MAX = 4.0

export const annuliOf = (rot: Rotor): Annulus[] => {
	const n = Math.max(1, Math.round(rot.stations))
	const dr = (rot.R - rot.r0) / n
	const out: Annulus[] = []
	for (let j = 0; j < n; j++) {
		const r = rot.r0 + (j + 0.5) * dr
		const u = (r - rot.r0) / (rot.R - rot.r0)
		const c = rot.chord[0] + (rot.chord[1] - rot.chord[0]) * u
		const beta = rot.pitch[0] + (rot.pitch[1] - rot.pitch[0]) * u
		out.push({ r, dr, c, beta, sigma: (rot.blades * c) / (2 * Math.PI * r) })
	}
	return out
}

/** (2/π)·acos(e^(−f)) with the engine's own functions (acos x = atan2(√(1 − x²), x)). */
const lossOf = (f: number) => {
	const e = Math.exp(-f)
	return (2 / Math.PI) * Math.atan2(Math.sqrt(Math.max(0, 1 - e * e)), e)
}

/** Prandtl's tip and hub loss factor at radius r for inflow angle ϕ (sin ϕ given), at least 1e-4. */
export const lossFactor = (B: number, r: number, R: number, r0: number, sinPhi: number) => {
	const s = Math.max(Math.abs(sinPhi), 1e-6)
	const tip = lossOf((B * (R - r)) / (2 * r * s))
	const hub = r0 > 0 ? lossOf((B * (r - r0)) / (2 * r0 * s)) : 1
	return Math.max(1e-4, tip * hub)
}

/** The axial induction for a momentum-balance k (Glauert's a = k/(1 + k), Buhl's branch past a = 0.4: Ning 2014's form), within its bounds. */
export const axialInduction = (k: number, F: number) => {
	let a: number
	if (k <= 2 / 3) a = k > -0.95 ? k / (1 + k) : A_MIN
	else {
		const g1 = 2 * F * k - (10 / 9 - F)
		const g2 = 2 * F * k - F * (4 / 3 - F)
		const g3 = 2 * F * k - (25 / 9 - 2 * F)
		a = Math.abs(g3) < 1e-6 ? 1 - 1 / (2 * Math.sqrt(Math.max(1e-12, g2))) : (g1 - Math.sqrt(Math.max(0, g2))) / g3
	}
	return Math.min(A_MAX, Math.max(A_MIN, a))
}

/** A flat blade element's force coefficients at inflow angle ϕ: along the shaft (C_n) and along its turning (C_t), and its angle of attack. */
export const coefficients = (phi: number, beta: number, ar: number, cd0: number) => {
	const alpha = phi - beta
	const cn = normalCoefficient(alpha, ar)
	return { alpha, Cn: cn * Math.cos(beta) + cd0 * Math.sin(phi), Ct: cn * Math.sin(beta) - cd0 * Math.cos(phi) }
}

/**
 * One relaxation step of an annulus's induction: its targets from the momentum balance at the inflow the current (a, a') give, for the annulus's
 * mean axial wind U (m/s) and the rotor's turning ω (rad/s). No wind along the shaft (U ≤ 1 cm/s) or a rotor turned backwards: no induction.
 */
export const relaxInduction = (an: Annulus, rot: Rotor, U: number, omega: number, a: number, ap: number, share = RELAX) => {
	if (!(U > 0.01) || omega < 0) return { a: a * (1 - share), ap: ap * (1 - share) }
	const Va = U * (1 - a)
	const Vt = omega * an.r * (1 + ap)
	const phi = Math.atan2(Va, Vt)
	const s = Math.sin(phi)
	const c = Math.cos(phi)
	const { Cn, Ct } = coefficients(phi, an.beta, rot.ar, rot.cd0)
	const F = lossFactor(rot.blades, an.r, rot.R, rot.r0, s)
	const k = (an.sigma * Cn) / (4 * F * s * s)
	const aT = axialInduction(k, F)
	// (a' from k' = σ·C_t/(4F·sinϕ·cosϕ); near ϕ = 90°, a standing or crawling rotor, its swirl is bounded: V_t is ω·r·(1 + a') ≈ 0 there anyway)
	const kp = c > 1e-6 ? (an.sigma * Ct) / (4 * F * s * c) : 0
	const apT = kp < 0.8 ? Math.min(AP_MAX, Math.max(AP_MIN, kp / (1 - kp))) : AP_MAX
	return { a: a + share * (aT - a), ap: ap + share * (apT - ap) }
}

/**
 * The air's push on one blade element (per its width dr): its force along its turning (N, + driving it) and along the shaft (N, + downwind),
 * for the air meeting it at V_a along the shaft and V_t against its turning (m/s), air of density ρ.
 */
export const elementForce = (an: Annulus, rot: Rotor, rho: number, Va: number, Vt: number) => {
	const w2 = Va * Va + Vt * Vt
	if (!(w2 > 0) || !(rho > 0)) return { ft: 0, fn: 0, alpha: 0 }
	const w = Math.sqrt(w2)
	const phi = Math.atan2(Va, Vt)
	const alpha = phi - an.beta
	const cn = normalCoefficient(alpha, rot.ar)
	const q = 0.5 * rho * w2 * an.c * an.dr
	return { ft: q * (cn * Math.sin(an.beta) - (rot.cd0 * Vt) / w), fn: q * (cn * Math.cos(an.beta) + (rot.cd0 * Va) / w), alpha }
}

/** The wind at one element: along the shaft (m/s, + downwind) and across its path (m/s, + the way it turns: it adds to the blade's own speed through the air when negative). */
export interface ElementWind {
	readonly axial: number
	readonly across: number
}

/**
 * The rotor's torque (N·m, + turning it the way its blades drive it), thrust (N, + downwind) and the mean axial wind over its disc (m/s, by
 * annulus area) now, at its turning ω, from the wind at each element (wind(b, j): blade b, annulus j) and each annulus's induction (relaxed
 * one step here, in place).
 */
export const rotorLoads = (
	rot: Rotor,
	ans: readonly Annulus[],
	omega: number,
	rho: number,
	wind: (b: number, j: number) => ElementWind,
	ind: { a: number[]; ap: number[] }
) => {
	const B = Math.max(1, Math.round(rot.blades))
	let torque = 0
	let thrust = 0
	let mean = 0
	let area = 0
	for (let j = 0; j < ans.length; j++) {
		const an = ans[j] as Annulus
		const winds: ElementWind[] = []
		let U = 0
		for (let b = 0; b < B; b++) {
			const w = wind(b, j)
			winds.push(w)
			U += w.axial
		}
		U /= B
		const ringArea = 2 * Math.PI * an.r * an.dr
		mean += U * ringArea
		area += ringArea
		const next = relaxInduction(an, rot, U, omega, ind.a[j] ?? 0, ind.ap[j] ?? 0)
		ind.a[j] = next.a
		ind.ap[j] = next.ap
		for (let b = 0; b < B; b++) {
			const w = winds[b] as ElementWind
			const Va = w.axial * (1 - next.a)
			const Vt = omega * an.r * (1 + next.ap) - w.across
			const f = elementForce(an, rot, rho, Va, Vt)
			torque += f.ft * an.r
			thrust += f.fn
		}
	}
	return { torque, thrust, wind: area > 0 ? mean / area : 0 }
}

/** The rotor's moment of inertia about its shaft (kg·m²) from B flat blades of areal density `sheet` (kg/m²), chord tapering from c0 to c1 over r0…R,
 *  plus what turns with them (a hub, a spool: `extra`). */
export const bladeInertia = (rot: Rotor, sheet: number, extra = 0) => {
	let J = 0
	for (const an of annuliOf({ ...rot, stations: 40 })) J += sheet * an.c * an.dr * an.r * an.r
	return J * Math.max(1, Math.round(rot.blades)) + extra
}

/**
 * The steady BEM solution of one annulus in a uniform axial wind U at turning ω by a bracketed root solve of Ning's residual
 * (Wind Energy 17, 1327, 2014): R(ϕ) = sinϕ/(1 − a(ϕ)) − (cosϕ − σC_t/(4F sinϕ))/λ_r, λ_r = ωr/U. Independent of `relaxInduction` (the
 * validator compares the two); undefined when no root lies in (0, π/2).
 */
export const steadyAnnulus = (an: Annulus, rot: Rotor, U: number, omega: number) => {
	if (!(U > 0) || !(omega > 0)) return undefined
	const lr = (omega * an.r) / U
	const res = (phi: number) => {
		const s = Math.sin(phi)
		const c = Math.cos(phi)
		const { Cn, Ct } = coefficients(phi, an.beta, rot.ar, rot.cd0)
		const F = lossFactor(rot.blades, an.r, rot.R, rot.r0, s)
		const a = axialInduction((an.sigma * Cn) / (4 * F * s * s), F)
		return { r: s / (1 - a) - (c - (an.sigma * Ct) / (4 * F * s)) / lr, a }
	}
	const hi0 = Math.PI / 2 - 1e-9
	let hi = hi0
	let rh = res(hi).r
	// (from 90° down: the first change of sign is the windmill's root)
	const n = 64
	for (let k = 1; k <= n; k++) {
		const lo = hi0 * (1 - k / n) + 1e-6 * (k / n)
		const rl = res(lo).r
		if (Number.isFinite(rl) && Number.isFinite(rh) && Math.sign(rl) !== Math.sign(rh)) {
			let a = lo
			let b = hi
			let ra = rl
			for (let it = 0; it < 80; it++) {
				const m = (a + b) / 2
				const rm = res(m).r
				if (Math.sign(rm) === Math.sign(ra)) {
					a = m
					ra = rm
				} else b = m
			}
			const phi = (a + b) / 2
			const out = res(phi)
			const Va = U * (1 - out.a)
			const Vt = (Va * Math.cos(phi)) / Math.sin(phi)
			return { phi, a: out.a, ap: Vt / (omega * an.r) - 1, Va, Vt }
		}
		hi = lo
		rh = rl
	}
	return undefined
}
