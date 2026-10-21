/**
 * Dissolving: how fast a crystal of a solute gives itself up to the water around it, from the mass-transfer correlations for a sphere.
 *
 * A grain of diameter d in water whose concentration of the solute is C (kg/m³) loses mass at dm/dt = −k·πd²·(Cs − C) (Noyes & Whitney,
 * J. Am. Chem. Soc. 19, 930, 1897), Cs the saturated solution's concentration (the surface of a salt or sugar crystal is saturated: the
 * dissolving is limited by the solute's diffusion away from it), k = Sh·D/d. The Sherwood number Sh is taken from
 *   - forced flow past the grain (stirring): Ranz & Marshall, Chem. Eng. Prog. 48, 141 (1952): Sh = 2 + 0.6·Re^½·Sc^⅓,
 *   - the dense solution sinking off it (natural convection): Churchill, Heat Exchanger Design Handbook 2.5.7 (1983), for a sphere:
 *     Sh = 2 + 0.589·Ra^¼ / (1 + (0.469/Sc)^(9/16))^(4/9), Ra = Gr·Sc, Gr = g·(Δρ/ρ)·d³/ν²,
 * combined as Churchill's mixed convection: Sh = 2 + ((Sh_n − 2)³ + (Sh_f − 2)³)^⅓. D at temperature T follows Stokes-Einstein from its
 * 25 °C value, D ∝ T/η(T) (Cussler, Diffusion, 3rd ed., ch. 5).
 *
 * Grains resting on the bottom sit in the brine they make: a layer (`layer`) whose concentration rises as they dissolve and that mixes into
 * the rest of the water only by diffusion when still (a dense layer under lighter water is stable) and in about a turn of the spoon when
 * stirred. So unstirred salt stalls at the bottom while stirred salt is gone in seconds, as anyone who has made salt water has seen.
 */
import { KELVIN, type Solute, solubility, table, WATER_DENSITY, WATER_VISCOSITY } from "./substances.ts"

const G = 9.81

/** Water at T °C: density kg/m³, viscosity Pa·s, kinematic viscosity m²/s. */
export const water = (T: number) => {
	const rho = table(WATER_DENSITY, T)
	const mu = table(WATER_VISCOSITY, T)
	return { rho, mu, nu: mu / rho }
}

/** The solute's diffusion coefficient in water at T °C, m²/s (Stokes-Einstein from 25 °C). */
export const diffusivity = (s: Solute, T: number) => (s.diffusivity * ((T + KELVIN) / (25 + KELVIN)) * table(WATER_VISCOSITY, 25)) / table(WATER_VISCOSITY, T)

/** The saturated solution's solute concentration at T °C, kg of solute per m³ of solution. */
export const saturated = (s: Solute, T: number) => {
	const S = solubility(s, T) // kg per kg water
	if (S === 0) return 0
	// its density: the 20 °C saturated density, scaled with water's own, and with the share of solute (linear in the mass fraction)
	const w = S / (1 + S)
	const S20 = solubility(s, 20)
	const w20 = S20 / (1 + S20)
	const rhoW = table(WATER_DENSITY, T)
	const rho = rhoW + ((s.saturatedDensity - table(WATER_DENSITY, 20)) * w) / w20
	return w * rho
}

/**
 * The Sherwood number of a grain of diameter d (m) in water at T °C moving at `slip` m/s through it, with the solute's concentration
 * at its surface Cs and around it C (kg/m³).
 */
export const sherwood = (s: Solute, T: number, d: number, slip: number, Cs: number, C: number) => {
	const { rho, mu, nu } = water(T)
	const D = diffusivity(s, T)
	const Sc = mu / (rho * D)
	const Re = (slip * d) / nu
	const forced = 0.6 * Math.sqrt(Re) * Math.pow(Sc, 1 / 3)
	// the surface's solution is denser than the water around it by (ρ_sat − ρ_w)·(1 − C/Cs)
	const drop = Cs > 0 ? Math.max(0, ((s.saturatedDensity - rho) * (1 - C / Cs)) / rho) : 0
	const Gr = (G * drop * d * d * d) / (nu * nu)
	const Ra = Gr * Sc
	const natural = Ra > 0 ? (0.589 * Math.pow(Ra, 0.25)) / Math.pow(1 + Math.pow(0.469 / Sc, 9 / 16), 4 / 9) : 0
	const mixed = Math.pow(natural * natural * natural + forced * forced * forced, 1 / 3)
	return 2 + mixed
}

/**
 * The rate one grain of diameter d (m) loses mass, kg/s (positive), in water at T °C at concentration C (kg/m³), slipping through it at
 * `slip` m/s. 0 for an insoluble solid or saturated water.
 */
export const dissolveRate = (s: Solute, T: number, d: number, slip: number, C: number) => {
	const Cs = saturated(s, T)
	if (!(Cs > C) || !(d > 0)) return 0
	const k = (sherwood(s, T, d, slip, Cs, C) * diffusivity(s, T)) / d
	return k * Math.PI * d * d * (Cs - C)
}

/**
 * dissolveRate for one solute at one temperature, with everything that does not change between calls worked out once (the water, the
 * diffusivity, the Schmidt number's powers, the saturated concentration): rate(d, slip, C) gives dissolveRate(s, T, d, slip, C) exactly.
 */
export const rateAt = (s: Solute, T: number) => {
	const { rho, mu, nu } = water(T)
	const D = diffusivity(s, T)
	const Sc = mu / (rho * D)
	const Sc3 = Math.pow(Sc, 1 / 3)
	const natDen = Math.pow(1 + Math.pow(0.469 / Sc, 9 / 16), 4 / 9)
	const Cs = saturated(s, T)
	return (d: number, slip: number, C: number) => {
		if (!(Cs > C) || !(d > 0)) return 0
		const Re = (slip * d) / nu
		const forced = 0.6 * Math.sqrt(Re) * Sc3
		const drop = Cs > 0 ? Math.max(0, ((s.saturatedDensity - rho) * (1 - C / Cs)) / rho) : 0
		const Gr = (G * drop * d * d * d) / (nu * nu)
		const Ra = Gr * Sc
		const natural = Ra > 0 ? (0.589 * Math.pow(Ra, 0.25)) / natDen : 0
		const mixed = Math.pow(natural * natural * natural + forced * forced * forced, 1 / 3)
		const k = ((2 + mixed) * D) / d
		return k * Math.PI * d * d * (Cs - C)
	}
}

/** The time a lone grain of diameter d0 takes to dissolve entirely in a lot of fresh water at T °C at `slip`, s (integrated in its own small steps). */
export const lifetime = (s: Solute, T: number, d0: number, slip: number) => {
	if (saturated(s, T) === 0) return Infinity
	const m0 = (s.density * Math.PI * d0 * d0 * d0) / 6
	let m = m0
	let t = 0
	for (let k = 0; k < 200000 && m > m0 * 1e-6; k++) {
		const d = d0 * Math.pow(m / m0, 1 / 3)
		const rate = dissolveRate(s, T, d, slip, 0)
		const h = Math.min(0.05 * (m / rate), 10)
		m -= rate * h
		t += h
	}
	return t
}
