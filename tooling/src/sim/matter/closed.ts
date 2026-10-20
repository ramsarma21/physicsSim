/**
 * The fizz bottle's gas when it cannot all escape (matter.ts reactionProcess): Henry's law shares the carbon dioxide between the gas over
 * the vinegar and the vinegar itself, and a capped bottle's cap pops when the pressure gets too high.
 *
 *   [SANDER15] R. Sander, Atmos. Chem. Phys. 15, 4399 (2015), "Compilation of Henry's law constants": CO2 in water H^cp = 3.3e-4
 *              mol/(m³·Pa) at 25 °C, −d ln H^cp / d(1/T) = 2400 K (at 20 °C: 3.79e-4, 1.69 g per litre per atm). Vinegar is taken as
 *              water (its 5 % acetic acid and the sodium acetate made change it by a few %).
 *   [ISBT]     International Society of Beverage Technologists, voluntary standards for PET carbonated soft-drink bottles and closures:
 *              a closure must hold 100 psi (690 kPa gauge) in the secure-seal test; PET soda bottles burst at about 1-1.5 MPa. A cap
 *              here pops at 900 kPa (absolute, 800 kPa over the air outside): a modelling choice between the two.
 * The vinegar shares out the gas at once (the fizz's own bubbles stir it: a modelling choice); after the cap pops, what is dissolved comes
 * out over DEGAS_S lesson seconds (an opened fizzy drink goes flat over minutes to hours: provisional).
 */
import { ATM, KELVIN, R } from "./substances.ts"

/** Henry's law for CO2 in water at T °C, mol/(m³·Pa) [SANDER15]. */
export const henryCO2 = (T: number) => 3.3e-4 * Math.exp(2400 * (1 / (T + KELVIN) - 1 / 298.15))

/** The pressure inside a capped bottle at which its cap pops off, Pa (absolute) [ISBT]. */
export const CAP_POPS = 900e3

/** How long the dissolved gas takes to come out once the cap is off, lesson s (e-folding: provisional). */
export const DEGAS_S = 300

/** Whether a capped bottle at `pressure` Pa pops its cap. */
export const capPops = (pressure: number) => pressure > CAP_POPS

/**
 * `made` mol of CO2 shared between the gas and `liquid` m³ of vinegar at T °C (Henry: dissolved = H·V·p): returns the mol in the gas.
 * cap: the gas fills the `headspace` m³ (its partial pressure n·R·T/V over the air sealed in); balloon: it fills the headspace and the
 * balloon at the outside air's pressure, mixed with the headspace's air (its partial pressure ATM·n/(n + n_air)).
 */
export const co2Split = (closure: "cap" | "balloon", made: number, liquid: number, headspace: number, T: number): number => {
	if (!(made > 0)) return 0
	if (!(liquid > 0)) return made
	const H = henryCO2(T)
	const RT = R * (T + KELVIN)
	if (closure === "cap") return made / (1 + (H * liquid * RT) / headspace)
	// n² + n(n_air + k − made) − made·n_air = 0 (k = H·V·ATM: what the vinegar takes under pure CO2 at 1 atm), its positive root (the
	// form without a difference of near-equal numbers)
	const nAir = (ATM * headspace) / RT
	const k = H * liquid * ATM
	const b = nAir + k - made
	const c = made * nAir
	const root = Math.sqrt(b * b + 4 * c)
	return b > 0 ? (2 * c) / (b + root) : (root - b) / 2
}

/** What stays dissolved after dt lesson s with the cap off. */
export const degas = (dissolved: number, dt: number) => dissolved * Math.exp(-dt / DEGAS_S)
