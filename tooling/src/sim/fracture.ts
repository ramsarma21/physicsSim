/**
 * The fracture module's pure physics (no planck, no engine state): how hard a breakable thing is hit, through what padding, and how much a
 * beam bends. tooling/src/sim/modules/fracture.ts runs it inside the engine; fracture.test.ts checks it; research/rw-validate-fracture.ts
 * compares it with real reference values. Deterministic: + − × ÷ and Math.sqrt / abs / min / max only (the engine's rule, plugins.ts).
 *
 * IMPACT (a breakable thing B meets something O at a normal approach speed v): the contact is a chain of springs in series that all carry the
 * same force F: B's own contact stiffness k (calibrated per kind of thing: a hen's egg 21 500 N/m, so that it cracks at 1.0 m/s on a rigid
 * floor, as filmed [EGG-V]) and any padding between them (a cushion under it, the padding of an egg-drop box). The kinetic energy of the
 * effective mass, ½·m·v², is stored in the chain at the moment of the peak force:
 *     ½·m·v² = F²/(2k) + Σ W_i(F),          W_i(F) = ∫₀^{x_i(F)} F_i(x) dx   (the work done squashing padding i to the force F)
 * With no padding F = v·√(k·m) (the classic spring impact). Padding can only lower the peak (it stores energy at every force), so F lies in
 * [0, v·√(k·m)] and is found by bisection. Padding i squashes x_i = ε·t (t its thickness along the hit) under
 *     F_i(x) = σ(ε)·A(x)
 * σ(ε) its compression law (below) and A(x) the area pressed: a flat bottom's own area (a glass, a plate, a box), or a round end's cap,
 * π(2Rx − x²), up to πR² (an egg's side, R = half its width). When padding is squashed to its densification limit it is bottomed out: it
 * squashes no further and the rest of the energy goes into the stiffer springs (the classic failure of thin padding).
 *
 * COMPRESSION LAWS (σ in Pa against the strain ε; ε_max where the law is capped as bottomed out):
 *   1 "cellular foam"  σ = s_ref·(ε_D − ε_ref)/(ε_D − ε) above ε = 0.05 (the plateau rising to densification, the hyperbolic fit of
 *                      Gibson & Ashby's cellular-solid curves), linear to that below 0.05; ε_max = 0.95·ε_D. Params [s_ref, ε_ref, ε_D]:
 *                      flexible polyurethane foam (a foam pad, a pillow block, a sponge): 4 kPa at 40 % (CLD 2-8 kPa, DIN EN ISO 3386-1), ε_D 0.8;
 *                      expanded polystyrene packing foam: 100 kPa at 10 % (EN 13163 class CS(10)100), ε_D 0.75.
 *   2 "trapped air"    σ = q·ε/(1 − ε), q = φ·p₀ (Boyle's law, isothermal, for bubbles covering φ of the film; p₀ = 101.3 kPa); ε_max 0.9.
 *                      Bubble wrap: φ ≈ 0.55, q = 55.7 kPa (bursting left out).
 *   3 "fibres"         σ = s₀·((1 − ε)⁻³ − 1) (van Wyk's law for fibre assemblies, J. Textile Inst. 37 (1946) T285: σ ∝ 1/V³ − 1/V₀³);
 *                      ε_max 0.9. s₀: cotton balls 150 Pa, polyester fiberfill (a pillow) 230 Pa, crumpled paper 1 kPa, a folded towel 3 kPa,
 *                      carpet pile 6.6 kPa (calibrations: a 5 kg head on ≈ 300 cm² sinks about halfway into a fiberfill pillow; a 70 kg
 *                      step on ≈ 150 cm² presses carpet pile about halfway).
 *   4 "solid rubber"   σ = E·ε up to ε_D (a rubber mat: E 3 MPa, ε_D 0.5).
 *
 * SOFT BODIES (another module's soft thing, or a sprung mat: its own force law against the squash x, in series like padding; the force on the
 * contact as that body itself gives it, no thickness): the contact's geometry is the two curved surfaces' (Hertz): R_eff = R·r/(R + r) for a
 * ball of radius R pressed by a round end of radius r (a flat face of area A_f: R_eff = R, the flat's area at most A_f). Bottomed out at `hard`,
 * where the soft body's own law gives way to a rigid contact (its module's), or the mat's travel.
 *   5 "inflated"  [Δp, R, k_w, hard]: F = Δp·π(2·R_eff·x − x²) + k_w·x + F_T (an inflated ball: the gas's over-pressure on the flat, plus its
 *                 wall; Cross, Am. J. Phys. 67, 222 (1999); the softbody module's law "pressure"), and its skin's tension T = Δp·R/2 pulling up
 *                 round the dent: F_T = 2π·T·x/ln(R/a) (a tensioned membrane under a load over radius a, Timoshenko & Woinowsky-Krieger
 *                 §§ on membranes; cut off at the ball's radius, approximate), at most 2π·a·T once the skin wraps the thing (a = R_eff, or a
 *                 flat face's own radius). The flat's area stops growing at π·R_eff²: deeper in, the skin's pull is what holds it.
 *   6 "hertz"     [E*, R, hard]: F = (4/3)·E*·√R_eff·x^1.5 (a solid elastic ball: foam, soft rubber; Johnson, Contact Mechanics (1985) §4.2;
 *                 the softbody module's law "hertz")
 *   7 "clay"      [p, R, k_ratio, hard]: F = min(k_c·x, p·π(2·R_eff·x − x²)), k_c = k_ratio·2π·R_eff·p (modelling clay flows at the pressure
 *                 p = 3·σ_y, Tabor; the softbody module's law "clay": elastic, then it flows and keeps the dent)
 *   8 "sprung"    [k, travel]: F = k·x (a trampoline's mat: a membrane whose springs give k N/m per metre of dip; its own weight is light and
 *                 rides along, so what lands on it is slowed by its own mass against k)
 *
 * BENDING (a beam on supports, loaded by what rests on it): the bending moment at a section s from the forces f_i (perpendicular to the beam,
 * + toward its top) at s_i along it, its own weight and inertia spread evenly (w = Σf/L, so a beam in free fall bends nowhere):
 *     M(s) = ½·[Σ_{s_i<s} f_i·(s − s_i) − w·(s − s₀)²/2 + Σ_{s_i>s} f_i·(s_i − s) − w·(s₁ − s)²/2]   (sagging +)
 * It snaps where |M| reaches its strength M_c = σ_f·Z (σ_f the material's bending strength, Z the section modulus of all its strands).
 * A thing dropped onto a span between supports at a and b from them (L = a + b) meets the beam's stiffness there, k = 3·E·I·L/(a²·b²), with
 * F = v·√(k·m) and the moment under it F·a·b/L (the dynamic load of a falling weight on a simply supported beam). The sag under a central
 * load is δ = M·L²/(12·E·I) (= P·L³/(48·E·I) with M = P·L/4).
 */

/** A compression law: [law, p1, p2, p3] (see the header). */
export type Law = readonly number[]

/** σ (Pa) of a law at strain ε (0 ≤ ε ≤ its cap). */
export const stress = (law: Law, eps: number): number => {
	const kind = law[0] ?? 0
	const e = Math.max(0, eps)
	if (kind === 1) {
		const sref = law[1] ?? 0
		const eref = law[2] ?? 0.4
		const ed = law[3] ?? 0.8
		const at = (x: number) => (sref * (ed - eref)) / (ed - x)
		if (e < 0.05) return (at(0.05) * e) / 0.05
		return at(e)
	}
	if (kind === 2) return ((law[1] ?? 0) * e) / (1 - e)
	if (kind === 3) {
		const r = 1 - e
		return (law[1] ?? 0) * (1 / (r * r * r) - 1)
	}
	if (kind === 4) return (law[1] ?? 0) * e
	return 0
}

/** The strain at which a law is bottomed out (it squashes no further). */
export const strainCap = (law: Law): number => {
	const kind = law[0] ?? 0
	if (kind === 1) return 0.95 * (law[3] ?? 0.8)
	if (kind === 4) return law[2] ?? 0.5
	return 0.9
}

/** ln x (x > 0) from + − × ÷ and square roots only (the engine's rule; machines/mod_fracture.py _ln is the same). */
export const lnOf = (x0: number): number => {
	let x = x0
	if (!(x > 0)) return 0
	let k = 0
	while ((x > 1.1 || x < 0.9) && k < 64) {
		x = Math.sqrt(x)
		k++
	}
	const z = (x - 1) / (x + 1)
	const z2 = z * z
	let total = 0
	let term = z
	for (let n = 1; n < 26; n += 2) {
		total += term / n
		term *= z2
	}
	let out = 2 * total
	for (let i = 0; i < k; i++) out *= 2
	return out
}

/** Whether a law is a soft body's own (5-8: a force against the squash, no thickness) rather than a padding material's (1-4). */
export const isBodyLaw = (law: Law): boolean => (law[0] ?? 0) >= 5 && (law[0] ?? 0) <= 8

/** A soft body's squash (m) at which it bottoms out (its `hard` or travel). */
export const bodyCap = (law: Law): number => {
	const kind = law[0] ?? 0
	if (kind === 5) return Math.max(0, law[4] ?? 0)
	if (kind === 6) return Math.max(0, law[3] ?? 0)
	if (kind === 7) return Math.max(0, law[4] ?? 0)
	if (kind === 8) return Math.max(0, law[2] ?? 0)
	return 0
}

/**
 * A soft body's contact force (N) at squash x (m), pressed by a footprint (a round end of radius r: the contact's R_eff = R·r/(R + r); a flat
 * face of area A_f: R_eff = R, the flat's area at most A_f). See the header (laws 5-8).
 */
export const bodyForce = (law: Law, x: number, foot: Footprint): number => {
	const kind = law[0] ?? 0
	const d = Math.max(0, x)
	if (kind === 8) return Math.max(0, law[1] ?? 0) * d
	const R = Math.max(1e-6, law[2] ?? 0.05)
	const flat = foot.area !== undefined && foot.area > 0
	const r = flat ? 0 : Math.max(1e-6, foot.radius ?? 0.02)
	const Re = flat ? R : (R * r) / (R + r)
	const cap = Math.min(d, Re)
	let A = Math.PI * (2 * Re * cap - cap * cap)
	if (flat && A > (foot.area as number)) A = foot.area as number
	if (kind === 5) {
		const dp = Math.max(0, law[1] ?? 0)
		// (the skin's pull round the dent: a = the contact's radius, the log cut off at the ball's radius, at least 1)
		const a = flat ? Math.sqrt((foot.area as number) / Math.PI) : Re
		const T = (dp * R) / 2
		const tension = Math.min((2 * Math.PI * T * d) / Math.max(1, lnOf(R / a)), 2 * Math.PI * a * T)
		return dp * A + Math.max(0, law[3] ?? 0) * d + tension
	}
	if (kind === 6) return (4 / 3) * Math.max(0, law[1] ?? 0) * Math.sqrt(Re) * d * Math.sqrt(d)
	if (kind === 7) {
		const p = Math.max(0, law[1] ?? 0)
		const kc = Math.max(0, law[3] ?? 50) * 2 * Math.PI * Re * p
		return Math.min(kc * d, p * A)
	}
	return 0
}

/** How a breakable thing presses into padding: a flat face of `area` m², or a round end of radius `radius` m (cap π(2Rx − x²) up to πR²). */
export interface Footprint {
	readonly area?: number
	readonly radius?: number
}

const SAMPLES = 256

/**
 * One layer of padding squashed by a thing: F(x) = σ(x/t)·A(x), tabulated at SAMPLES steps up to its bottoming-out squash, with the work
 * done W(x) (trapezoids). `force(F)`: how far it is squashed at force F and the work done by then (bottomed out: its last values).
 */
export class Padding {
	readonly law: Law
	readonly thickness: number
	readonly xs: number[] = []
	readonly fs: number[] = []
	readonly ws: number[] = []
	/** A padding layer `thickness` thick of a padding law (1-4); or a soft body's own law (5-8: `thickness` is left out, its cap is its own). */
	constructor(law: Law, thickness: number, foot: Footprint) {
		this.law = law
		const body = isBodyLaw(law)
		// (a soft body: its "thickness" is how far it can squash, so the checks below read the same)
		this.thickness = body ? bodyCap(law) : Math.max(0, thickness)
		const xmax = body ? this.thickness : strainCap(law) * this.thickness
		const area = (x: number) => {
			if (foot.area !== undefined && foot.area > 0) return foot.area
			const R = foot.radius ?? 0.02
			return x < R ? Math.PI * (2 * R * x - x * x) : Math.PI * R * R
		}
		let w = 0
		for (let i = 0; i <= SAMPLES; i++) {
			const x = (xmax * i) / SAMPLES
			const f = !(this.thickness > 0) ? 0 : body ? bodyForce(law, x, foot) : stress(law, x / this.thickness) * area(x)
			if (i > 0) w += ((f + (this.fs[i - 1] ?? 0)) * (x - (this.xs[i - 1] ?? 0))) / 2
			this.xs.push(x)
			this.fs.push(f)
			this.ws.push(w)
		}
	}
	/** The force at which it bottoms out, N. */
	get bottom(): number {
		return this.fs[SAMPLES] ?? 0
	}
	/** {x, w} at force F: its squash (m) and the work done on it (J). */
	at(F: number): { x: number; w: number } {
		const fs = this.fs
		if (!(this.thickness > 0)) return { x: 0, w: 0 }
		if (F >= (fs[SAMPLES] ?? 0)) return { x: this.xs[SAMPLES] ?? 0, w: this.ws[SAMPLES] ?? 0 }
		if (F <= 0) return { x: 0, w: 0 }
		let lo = 0
		let hi = SAMPLES
		while (hi - lo > 1) {
			const mid = (lo + hi) >> 1
			if ((fs[mid] ?? 0) <= F) lo = mid
			else hi = mid
		}
		const f0 = fs[lo] ?? 0
		const f1 = fs[hi] ?? f0
		const x0 = this.xs[lo] ?? 0
		const x1 = this.xs[hi] ?? x0
		const u = f1 > f0 ? (F - f0) / (f1 - f0) : 0
		const x = x0 + u * (x1 - x0)
		return { x, w: (this.ws[lo] ?? 0) + ((f0 + F) * (x - x0)) / 2 }
	}
}

/**
 * The peak force of an impact: effective mass m (kg) meeting at v (m/s) through the thing's own stiffness k (N/m) and any padding in series.
 * Returns the force (N) and each padding's squash at that moment (m).
 */
export const peakForce = (m: number, v: number, k: number, pads: readonly Padding[] = []): { force: number; squash: number[] } => {
	if (!(m > 0) || !(v > 0) || !(k > 0)) return { force: 0, squash: pads.map(() => 0) }
	const rigid = v * Math.sqrt(k * m)
	if (pads.length === 0) return { force: rigid, squash: [] }
	const energy = 0.5 * m * v * v
	const stored = (F: number) => {
		let e = (F * F) / (2 * k)
		for (const p of pads) e += p.at(F).w
		return e
	}
	let lo = 0
	let hi = rigid
	for (let i = 0; i < 64; i++) {
		const mid = (lo + hi) / 2
		if (stored(mid) < energy) lo = mid
		else hi = mid
	}
	const F = (lo + hi) / 2
	return { force: F, squash: pads.map((p) => p.at(F).x) }
}

/** A force on a beam: s along it from its middle (m), f perpendicular to it (N, + toward its top side). */
export interface BeamForce {
	readonly s: number
	readonly f: number
}

/** The bending moment (N·m, sagging +) at section s of a beam of length L whose middle is s = 0 (see the header). */
export const bendingMoment = (forces: readonly BeamForce[], L: number, s: number): number => {
	let total = 0
	for (const q of forces) total += q.f
	const w = L > 0 ? total / L : 0
	const s0 = -L / 2
	const s1 = L / 2
	let left = (-w * (s - s0) * (s - s0)) / 2
	let right = (-w * (s1 - s) * (s1 - s)) / 2
	for (const q of forces) {
		if (q.s < s) left += q.f * (s - q.s)
		else if (q.s > s) right += q.f * (q.s - s)
	}
	return (left + right) / 2
}

/**
 * The bending moment (N·m, sagging +) at section s of a beam of length L (middle s = 0) resting on two supports at s_lo < s_hi (simply
 * supported: the supports push, wherever the loads are), loaded by forces f_i at s_i (+ toward its top; its loads are −) and its own weight w
 * (N/m, toward its bottom) along all of it. The supports' reactions come from its balance (forces and moments about s_lo).
 */
export const supportedMoment = (forces: readonly BeamForce[], L: number, w: number, sLo: number, sHi: number, s: number): number => {
	const span = sHi - sLo
	if (!(span > 0)) return 0
	// down: what the loads and the weight press with; about s_lo
	let down = w * L
	let turn = w * L * (0 - sLo)
	for (const q of forces) {
		down -= q.f
		turn -= q.f * (q.s - sLo)
	}
	const rHi = turn / span
	const rLo = down - rHi
	let m = -(w * (s + L / 2) * (s + L / 2)) / 2
	if (s > sLo) m += rLo * (s - sLo)
	if (s > sHi) m += rHi * (s - sHi)
	for (const q of forces) if (q.s < s) m += q.f * (s - q.s)
	return m
}

/**
 * A thing of mass m dropped at v onto a simply supported span, a from one support and b from the other: the beam's stiffness there
 * k = 3EIL/(a²b²) (L = a + b), the peak force F = v√(km), and the moment it makes at section s (s0 the first support, s1 the second).
 */
export const beamImpact = (EI: number, a: number, b: number, m: number, v: number) => {
	if (!(a > 0) || !(b > 0) || !(EI > 0) || !(m > 0) || !(v > 0)) return { k: 0, force: 0, momentAt: (_s: number) => 0 }
	const L = a + b
	const k = (3 * EI * L) / (a * a * b * b)
	const force = v * Math.sqrt(k * m)
	return {
		k,
		force,
		/** The moment at a section `d` from the first support (0..L), N·m. */
		momentAt: (d: number) => (d <= 0 || d >= L ? 0 : d <= a ? (force * d * b) / L : (force * a * (L - d)) / L)
	}
}

/** The sag of a span L under a central load whose moment there is M: δ = M·L²/(12·E·I), m. */
export const sagOf = (M: number, L: number, EI: number) => (EI > 0 ? (Math.abs(M) * L * L) / (12 * EI) : 0)

/**
 * A glued joint between two blocks, face w wide (in the plane) and d deep: what share of its strength a load uses. fn: the force pressing
 * the faces together (N, + compression), ft: along the faces (N), M: the moment about the face's middle (N·m). Tension at the worse edge
 * σ = −fn/(w·d) + 6|M|/(d·w²) (a block's own weight holds it down until the moment tips it), shear τ = |ft|/(w·d).
 */
export const glueShare = (fn: number, ft: number, M: number, w: number, d: number, sigma: number, tau: number): number => {
	if (!(w > 0) || !(d > 0)) return 0
	const s = -fn / (w * d) + (6 * Math.abs(M)) / (d * w * w)
	const t = Math.abs(ft) / (w * d)
	return Math.max(sigma > 0 ? s / sigma : 0, tau > 0 ? t / tau : 0, 0)
}

/** A deterministic sequence of numbers in [0, 1) from a seed (a 31-bit linear congruential generator: the same everywhere). */
export const sequence = (seed: number) => {
	let a = Math.floor(Math.abs(seed)) % 2147483648
	return () => {
		a = (a * 1103515245 + 12345) % 2147483648
		return a / 2147483648
	}
}

/** A string's seed (its char codes, folded). */
export const seedOf = (text: string) => {
	let h = 7
	for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 2147483647
	return h
}
