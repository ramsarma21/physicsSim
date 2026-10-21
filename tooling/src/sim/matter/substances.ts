/**
 * Real values for the matter module, each with its source. Temperatures °C, masses kg, energies J, at 1 atm (101.325 kPa) unless said.
 * Tables are interpolated linearly between their rows (`table`).
 */

/** The molar gas constant, J/(mol·K) (CODATA 2018, exact). */
export const R = 8.314462618

/** Standard atmosphere, Pa. */
export const ATM = 101325

/** 0 °C in kelvin. */
export const KELVIN = 273.15

/** Linear interpolation in a table of [x, y] rows sorted by x; clamped at its ends. */
export const table = (rows: readonly (readonly [number, number])[], x: number): number => {
	const first = rows[0] as readonly [number, number]
	const last = rows[rows.length - 1] as readonly [number, number]
	if (!(x > first[0])) return first[1]
	if (!(x < last[0])) return last[1]
	for (let k = 1; k < rows.length; k++) {
		const b = rows[k] as readonly [number, number]
		if (x <= b[0]) {
			const a = rows[k - 1] as readonly [number, number]
			return a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0])
		}
	}
	return last[1]
}

/**
 * A pure substance's states. `melt` and `boil` are its melting and boiling points at 1 atm; a substance that sublimes at 1 atm (dry ice) has
 * `sublime` instead and no liquid. Specific heats J/(kg·K) of the solid, liquid and gas; latent heats J/kg.
 */
export interface Substance {
	readonly key: string
	readonly name: string
	/** Molar mass, kg/mol. */
	readonly molar: number
	readonly melt?: number
	readonly boil?: number
	readonly sublime?: number
	readonly cSolid: number
	readonly cLiquid: number
	readonly cGas: number
	readonly fusion: number
	readonly vaporization: number
	/** Densities, kg/m³, of the solid and the liquid (for a block's size). */
	readonly solidDensity: number
	readonly liquidDensity: number
	/** Colour of its particles in the model (hex). */
	readonly color: string
	readonly source: string
}

export const SUBSTANCES: Readonly<Record<string, Substance>> = {
	water: {
		key: "water",
		name: "water",
		molar: 0.018015,
		melt: 0,
		boil: 100,
		cSolid: 2090,
		cLiquid: 4184,
		cGas: 2010,
		fusion: 333550,
		vaporization: 2257000,
		solidDensity: 917,
		liquidDensity: 998,
		color: "#3a7bd5",
		source:
			"Melts 0 °C, boils 100 °C at 1 atm; ice 2.09 kJ/(kg·K) near −10 °C, water 4.184, steam 2.01; fusion 333.55 kJ/kg, vaporization 2257 kJ/kg at 100 °C; ice 917, water 998 kg/m³ at 20 °C (CRC Handbook of Chemistry and Physics, 97th ed.; Engineering ToolBox)."
	},
	wax: {
		key: "wax",
		name: "paraffin wax",
		molar: 0.352,
		melt: 58,
		boil: 370,
		cSolid: 2140,
		cLiquid: 2900,
		cGas: 2200,
		fusion: 210000,
		vaporization: 300000,
		solidDensity: 900,
		liquidDensity: 780,
		color: "#e8d9a8",
		source:
			"Paraffin wax (about C25H52, 352 g/mol): melts 46-68 °C (58 °C typical), boils about 370 °C; solid 2.14-2.9 kJ/(kg·K), fusion 200-220 kJ/kg, density 880-920 kg/m³ solid (Engineering ToolBox; Sharma et al., Renew. Sustain. Energy Rev. 13, 318, 2009)."
	},
	gallium: {
		key: "gallium",
		name: "gallium",
		molar: 0.069723,
		melt: 29.76,
		boil: 2400,
		cSolid: 371,
		cLiquid: 410,
		cGas: 300,
		fusion: 80100,
		vaporization: 3700000,
		solidDensity: 5910,
		liquidDensity: 6095,
		color: "#b8c2cc",
		source: "Gallium melts at 29.76 °C (it melts in a hand), boils 2400 °C; 0.371 kJ/(kg·K) solid, fusion 80.1 kJ/kg, 5.91 g/cm³ solid, 6.095 liquid (CRC Handbook)."
	},
	"carbon dioxide": {
		key: "carbon dioxide",
		name: "carbon dioxide",
		molar: 0.04401,
		sublime: -78.46,
		cSolid: 1250,
		cLiquid: 2000,
		cGas: 840,
		fusion: 0,
		vaporization: 571000,
		solidDensity: 1562,
		liquidDensity: 1101,
		color: "#d9e6ee",
		source: "Dry ice (solid CO2) turns straight to gas at −78.46 °C at 1 atm, sublimation 571 kJ/kg; solid about 1.25 kJ/(kg·K), gas 0.84; 1.562 g/cm³ (CRC Handbook)."
	},
	iron: {
		key: "iron",
		name: "iron",
		molar: 0.055845,
		melt: 1538,
		boil: 2862,
		cSolid: 449,
		cLiquid: 820,
		cGas: 450,
		fusion: 247000,
		vaporization: 6090000,
		solidDensity: 7874,
		liquidDensity: 6980,
		color: "#8a8f96",
		source: "Iron melts 1538 °C, boils 2862 °C; 0.449 kJ/(kg·K) solid, 0.82 liquid; fusion 247 kJ/kg, vaporization 6.09 MJ/kg; 7.874 g/cm³, 6.98 liquid (CRC Handbook)."
	},
	nitrogen: {
		key: "nitrogen",
		name: "nitrogen",
		molar: 0.028014,
		melt: -210.0,
		boil: -195.8,
		cSolid: 1500,
		cLiquid: 2040,
		cGas: 1040,
		fusion: 25700,
		vaporization: 199000,
		solidDensity: 1026,
		liquidDensity: 808,
		color: "#7fa6d6",
		source: "Nitrogen (N2) melts −210.0 °C, boils −195.8 °C; liquid 2.04, gas 1.04 kJ/(kg·K); fusion 25.7, vaporization 199 kJ/kg; liquid 0.808 g/cm³ (CRC Handbook)."
	},
	helium: {
		key: "helium",
		name: "helium",
		molar: 0.0040026,
		melt: -272.2,
		boil: -268.93,
		cSolid: 2000,
		cLiquid: 4500,
		cGas: 5193,
		fusion: 3500,
		vaporization: 20900,
		solidDensity: 190,
		liquidDensity: 125,
		color: "#f2c84b",
		source: "Helium boils −268.93 °C (4.2 K), vaporization 20.9 kJ/kg; gas 5.193 kJ/(kg·K); it freezes only under pressure (−272.2 °C at 25 atm, shown here as its melting point) (CRC Handbook)."
	},
	air: {
		key: "air",
		name: "air",
		molar: 0.028965,
		melt: -213,
		boil: -194.5,
		cSolid: 1500,
		cLiquid: 1970,
		cGas: 1005,
		fusion: 25000,
		vaporization: 205000,
		solidDensity: 1000,
		liquidDensity: 875,
		color: "#8fb7d9",
		source:
			"Dry air, 28.965 g/mol; liquid air boils about −194.5 °C and freezes about −213 °C at 1 atm; cp 1.005 kJ/(kg·K) at 20 °C; 1.204 kg/m³ at 20 °C (Engineering ToolBox; CRC Handbook)."
	},
	bromine: {
		key: "bromine",
		name: "bromine",
		molar: 0.159808,
		melt: -7.2,
		boil: 58.8,
		cSolid: 300,
		cLiquid: 474,
		cGas: 226,
		fusion: 66200,
		vaporization: 187000,
		solidDensity: 4050,
		liquidDensity: 3103,
		color: "#a5401c",
		source: "Bromine (Br2) melts −7.2 °C, boils 58.8 °C; its brown vapour is the classic diffusion demonstration (CRC Handbook)."
	}
}

/** The heat a sample of `mass` kg holds above itself as a solid at `from` °C, at temperature T (all solid, nothing melted yet), J. */
export const heatOfSolid = (s: Substance, mass: number, from: number, T: number) => mass * s.cSolid * (T - from)

/**
 * Where a sample stands at heat content H (J), counted from all solid at its melting point (or its sublimation point): its temperature,
 * and the fractions that are solid, liquid and gas. A heating curve (Zemansky & Dittman, Heat and Thermodynamics, ch. 9): the temperature
 * holds at a melting or boiling point while the latent heat goes in.
 */
export const stateAt = (s: Substance, mass: number, H: number): { T: number; solid: number; liquid: number; gas: number } => {
	if (s.sublime !== undefined) {
		const Ls = mass * s.vaporization
		if (H < 0) return { T: s.sublime + H / (mass * s.cSolid), solid: 1, liquid: 0, gas: 0 }
		if (H < Ls) {
			const g = H / Ls
			return { T: s.sublime, solid: 1 - g, liquid: 0, gas: g }
		}
		return { T: s.sublime + (H - Ls) / (mass * s.cGas), solid: 0, liquid: 0, gas: 1 }
	}
	const melt = s.melt as number
	const boil = s.boil as number
	const Lf = mass * s.fusion
	const Lv = mass * s.vaporization
	if (H < 0) return { T: melt + H / (mass * s.cSolid), solid: 1, liquid: 0, gas: 0 }
	if (H < Lf) {
		const l = H / Lf
		return { T: melt, solid: 1 - l, liquid: l, gas: 0 }
	}
	const warm = mass * s.cLiquid * (boil - melt)
	if (H < Lf + warm) return { T: melt + (H - Lf) / (mass * s.cLiquid), solid: 0, liquid: 1, gas: 0 }
	if (H < Lf + warm + Lv) {
		const g = (H - Lf - warm) / Lv
		return { T: boil, solid: 0, liquid: 1 - g, gas: g }
	}
	return { T: boil + (H - Lf - warm - Lv) / (mass * s.cGas), solid: 0, liquid: 0, gas: 1 }
}

/** The heat content (as `stateAt` counts it) of a sample at temperature T °C in the state it has there (solid at its melting point). */
export const heatAt = (s: Substance, mass: number, T: number): number => {
	if (s.sublime !== undefined) {
		if (T <= s.sublime) return mass * s.cSolid * (T - s.sublime)
		return mass * s.vaporization + mass * s.cGas * (T - s.sublime)
	}
	const melt = s.melt as number
	const boil = s.boil as number
	if (T <= melt) return mass * s.cSolid * (T - melt)
	if (T <= boil) return mass * s.fusion + mass * s.cLiquid * (T - melt)
	return mass * s.fusion + mass * s.cLiquid * (boil - melt) + mass * s.vaporization + mass * s.cGas * (T - boil)
}

/** Root-mean-square speed of a gas's molecules, √(3RT/M), m/s (Maxwell; T in °C). Nitrogen at 20 °C: 511 m/s. */
export const rmsSpeed = (molar: number, T: number) => Math.sqrt((3 * R * (T + KELVIN)) / molar)

/** Mean speed of a gas's molecules, √(8RT/(πM)), m/s (Maxwell; T in °C). Air at 20 °C: 463 m/s. */
export const meanSpeed = (molar: number, T: number) => Math.sqrt((8 * R * (T + KELVIN)) / (Math.PI * molar))

/**
 * Liquid water's dynamic viscosity, Pa·s, 0-100 °C (CRC Handbook, "Viscosity of liquid water"; IAPWS 2008): 1.792 mPa·s at 0 °C, 1.002 at
 * 20 °C, 0.282 at 100 °C.
 */
export const WATER_VISCOSITY: readonly (readonly [number, number])[] = [
	[0, 1.792e-3],
	[5, 1.519e-3],
	[10, 1.306e-3],
	[20, 1.002e-3],
	[25, 0.89e-3],
	[30, 0.797e-3],
	[40, 0.653e-3],
	[50, 0.547e-3],
	[60, 0.466e-3],
	[70, 0.404e-3],
	[80, 0.355e-3],
	[90, 0.315e-3],
	[100, 0.282e-3]
]

/** Liquid water's density, kg/m³, 0-100 °C (CRC Handbook, "Properties of water in the range 0-100 °C"). */
export const WATER_DENSITY: readonly (readonly [number, number])[] = [
	[0, 999.84],
	[4, 999.97],
	[10, 999.7],
	[20, 998.21],
	[25, 997.05],
	[30, 995.65],
	[40, 992.22],
	[50, 988.04],
	[60, 983.2],
	[70, 977.76],
	[80, 971.79],
	[90, 965.31],
	[100, 958.35]
]

/** A solid that dissolves in water (or does not: sand). */
export interface Solute {
	readonly key: string
	readonly name: string
	/** Density of the solid crystal, kg/m³. */
	readonly density: number
	/** Solubility in grams per 100 g of water against °C (none: insoluble). */
	readonly solubility?: readonly (readonly [number, number])[]
	/** Diffusion coefficient in water at 25 °C, m²/s (scaled to other temperatures by Stokes-Einstein, D ∝ T/η). */
	readonly diffusivity: number
	/** Density of its saturated solution at 20 °C, kg/m³ (the density difference that drives the brine down). */
	readonly saturatedDensity: number
	readonly color: string
	readonly source: string
}

export const SOLUTES: Readonly<Record<string, Solute>> = {
	salt: {
		key: "salt",
		name: "table salt",
		density: 2165,
		solubility: [
			[0, 35.65],
			[10, 35.72],
			[20, 35.89],
			[30, 36.09],
			[40, 36.37],
			[50, 36.69],
			[60, 37.04],
			[70, 37.46],
			[80, 37.93],
			[90, 38.47],
			[100, 39.07]
		],
		diffusivity: 1.484e-9,
		saturatedDensity: 1197,
		color: "#f4f4f2",
		source:
			"Sodium chloride: 2.165 g/cm³; solubility 35.65 g/100 g water at 0 °C to 39.07 at 100 °C (CRC Handbook, aqueous solubility of inorganic compounds); D = 1.484e-9 m²/s at 25 °C (CRC Handbook, diffusion in liquids); saturated brine 26.4 % by mass, 1.197 g/cm³ at 20 °C."
	},
	sugar: {
		key: "sugar",
		name: "sugar",
		density: 1587,
		solubility: [
			[0, 179.2],
			[10, 190.5],
			[20, 203.9],
			[30, 219.5],
			[40, 238.1],
			[50, 260.4],
			[60, 287.3],
			[70, 320.5],
			[80, 362.1],
			[90, 415.7],
			[100, 487.2]
		],
		diffusivity: 5.228e-10,
		saturatedDensity: 1330,
		color: "#fbfbf8",
		source:
			"Sucrose: 1.587 g/cm³; solubility 179.2 g/100 g water at 0 °C, 203.9 at 20 °C, 487.2 at 100 °C (CRC Handbook; Bubník et al., Sugar Technologists Manual, 1995); D = 5.228e-10 m²/s at 25 °C (CRC Handbook); saturated syrup 67 % by mass, 1.33 g/cm³ at 20 °C."
	},
	chalk: {
		key: "chalk",
		name: "chalk",
		density: 2710,
		diffusivity: 0,
		saturatedDensity: 998,
		color: "#f7f7f2",
		source: "Chalk (calcium carbonate) 2.71 g/cm³; 0.0013 g per 100 mL: it does not dissolve (CRC Handbook)."
	},
	sand: {
		key: "sand",
		name: "sand",
		density: 2650,
		diffusivity: 0,
		saturatedDensity: 998,
		color: "#d8b77a",
		source: "Quartz sand: 2.65 g/cm³, does not dissolve in water (CRC Handbook)."
	}
}

/** Grams of a solute that 1 kg of water at T °C holds when saturated, as kg per kg of water. */
export const solubility = (s: Solute, T: number) => (s.solubility === undefined ? 0 : table(s.solubility, T) / 100)
