/**
 * Vapour pressure: the most a substance's gas can press at a temperature before some of it condenses (or deposits as a solid), and its
 * critical point (above it there is no liquid, however hard it is squeezed). The particle box's heating curve is the one a sample has at
 * 1 atm (substances.ts stateAt); in a closed box or under a heavy piston the real sample's gas can be squeezed past this pressure, where a
 * real one would partly turn liquid: matter.ts says so once, as an event (web/CONTRACT.md "Matter", known limits).
 *
 * Deterministic: only + − × ÷ and the engine's Math.exp / Math.pow (no logarithm): between two rows ln P is linear in 1/T (Clausius-
 * Clapeyron between them), P = Pa·(Pb/Pa)^u; past the table's ends the same law with the substance's own latent heat (ΔH = L·M).
 *
 * Sources (pressures in kPa):
 *   [IAPWS95] water: NIST Chemistry WebBook, saturation properties (IAPWS-95, Wagner & Pruss, J. Phys. Chem. Ref. Data 31, 387, 2002):
 *             0.01 °C 0.6117 … 100 °C 101.42 … critical 373.946 °C 22064; ice's sublimation below (Wagner, Riethmann, Feistel & Harvey,
 *             J. Phys. Chem. Ref. Data 40, 043103, 2011): −40 °C 0.01284, −20 °C 0.1032, −10 °C 0.2600.
 *   [SPAN96]  carbon dioxide: Span & Wagner, J. Phys. Chem. Ref. Data 25, 1509 (1996) (NIST WebBook): triple point −56.558 °C 517.95,
 *             0 °C 3485, 20 °C 5729, critical 30.978 °C 7377.3; sublimation 101.325 at −78.464 °C (1 atm).
 *   [SPAN00]  nitrogen: Span, Lemmon, Jacobsen, Wagner & Yokozeki, J. Phys. Chem. Ref. Data 29, 1361 (2000) (NIST WebBook): triple point
 *             63.151 K 12.523, 77.355 K 101.325, 90 K 360.4, 100 K 778.0, 110 K 1467, 120 K 2511, critical 126.192 K 3395.8.
 *   [LEMMON00] air: Lemmon, Jacobsen, Penoncello & Friend, J. Phys. Chem. Ref. Data 29, 331 (2000): critical point 132.5 K, 3786 kPa
 *             (air is a mixture: its dew and bubble points differ by about 3 K; here one curve from its 1-atm boiling point, approximate).
 *   [CRC]     bromine critical 588 K (315 °C), 10.34 MPa; helium critical 5.195 K (−267.955 °C), 227 kPa (CRC Handbook, "Critical constants").
 *   Wax (paraffin, about n-C25H52): critical about 630 °C (n-alkane estimates near 900 K, Ambrose & Tsonopoulos, J. Chem. Eng. Data 40,
 *   531, 1995): approximate. Gallium and iron: critical points thousands of kelvin above the box's hottest (none in its range).
 */
import { KELVIN, R, type Substance } from "./substances.ts"

interface Curve {
	/** [°C, kPa], increasing. */
	readonly rows: readonly (readonly [number, number])[]
	/** °C: no liquid above it (Infinity: none in the box's range). */
	readonly critical: number
}

const CURVES: Readonly<Record<string, Curve>> = {
	water: {
		rows: [
			[-40, 0.01284],
			[-20, 0.1032],
			[-10, 0.26],
			[0.01, 0.6117],
			[20, 2.3393],
			[40, 7.3849],
			[60, 19.946],
			[80, 47.414],
			[100, 101.42],
			[120, 198.67],
			[150, 476.16],
			[200, 1554.9],
			[250, 3976.2],
			[300, 8587.9],
			[350, 16529],
			[373.946, 22064]
		],
		critical: 373.946
	},
	"carbon dioxide": {
		rows: [
			[-78.464, 101.325],
			[-56.558, 517.95],
			[-40, 1004.5],
			[-20, 1969.7],
			[0, 3485.1],
			[20, 5729.1],
			[30.978, 7377.3]
		],
		critical: 30.978
	},
	nitrogen: {
		rows: [
			[-209.999, 12.523],
			[-195.795, 101.325],
			[-183.15, 360.4],
			[-173.15, 778.0],
			[-163.15, 1467],
			[-153.15, 2511],
			[-146.958, 3395.8]
		],
		critical: -146.958
	},
	air: { rows: [[-194.5, 101.325]], critical: -140.65 },
	bromine: { rows: [[58.8, 101.325]], critical: 315 },
	helium: { rows: [[-268.93, 101.325]], critical: -267.955 },
	wax: { rows: [[370, 101.325]], critical: 630 },
	gallium: { rows: [[2400, 101.325]], critical: Infinity },
	iron: { rows: [[2862, 101.325]], critical: Infinity }
}

/** The curve's law past its ends: ln P falls by ΔH/R per unit of 1/T (ΔH = the latent heat per mole: the solid's sublimation below its melting point). */
const beyond = (s: Substance, T: number, at: readonly [number, number]) => {
	const molar = s.molar
	const melt = s.melt ?? s.sublime ?? -Infinity
	const latent = (T < melt && s.sublime === undefined ? s.fusion + s.vaporization : s.vaporization) * molar
	return at[1] * Math.exp((-latent / R) * (1 / (T + KELVIN) - 1 / (at[0] + KELVIN)))
}

/** The substance's vapour pressure at T °C, Pa; Infinity at or above its critical temperature (no liquid can form). */
export const vapourPressure = (s: Substance, T: number): number => {
	const c = CURVES[s.key]
	if (c === undefined || !Number.isFinite(T)) return Infinity
	if (T >= c.critical) return Infinity
	const rows = c.rows
	const first = rows[0] as readonly [number, number]
	const last = rows[rows.length - 1] as readonly [number, number]
	if (T <= first[0]) return 1000 * beyond(s, T, first)
	if (T >= last[0]) return 1000 * beyond(s, T, last)
	for (let k = 1; k < rows.length; k++) {
		const b = rows[k] as readonly [number, number]
		if (T <= b[0]) {
			const a = rows[k - 1] as readonly [number, number]
			const ia = 1 / (a[0] + KELVIN)
			const u = (1 / (T + KELVIN) - ia) / (1 / (b[0] + KELVIN) - ia)
			return 1000 * a[1] * Math.pow(b[1] / a[1], u)
		}
	}
	return 1000 * last[1]
}

/** The substance's critical temperature, °C (Infinity: none in the box's range). */
export const criticalPoint = (s: Substance) => CURVES[s.key]?.critical ?? Infinity

/** The densest the substance gets (its solid's or liquid's density), kg/m³: no sample is packed tighter than this. */
export const condensedDensity = (s: Substance) => Math.max(s.solidDensity, s.liquidDensity)

