/**
 * Heat: the numbers. Real values with their sources (every value without one is marked provisional), and the pure functions of
 * water, ice, salt water and moist air the heat module (heat.ts) uses. Nothing here touches the engine.
 *
 * Math: only + − × ÷, Math.sqrt, Math.exp and `**` (the engine's build makes exp and ** the same bits in node and every browser:
 * tools/engine-math-transform.ts); no Math.log, cbrt or tan.
 */

/** Stefan-Boltzmann constant, W/(m²·K⁴) (CODATA 2018). */
export const SIGMA = 5.670374419e-8
/** 0 °C in kelvin. */
export const KELVIN = 273.15
/** Molar gas constant, J/(mol·K) (CODATA 2018), and water's molar mass, kg/mol. */
const R_GAS = 8.314462618
const M_WATER = 0.01801528

/** Liquid water near 20 °C: density 998.2 kg/m³, c_p 4184 J/(kg·K), k 0.598 W/(m·K) (CRC Handbook of Chemistry and Physics, 97th ed., 6-4/6-5 and 6-221); emissivity 0.96 (Incropera & DeWitt, Fundamentals of Heat and Mass Transfer, 6th ed., Table A.11: water 0.95-0.963). */
export const WATER = { density: 998.2, heatCapacity: 4184, conductivity: 0.598, emissivity: 0.96 } as const
/**
 * Ice near 0 °C: 917 kg/m³; c 2050 J/(kg·K) at −5 °C; k 2.22 W/(m·K) at 0 °C (Engineering ToolBox, "Ice - Thermal Properties", after
 * Fukusako 1990, Int. J. Thermophys. 11, 353); latent heat of fusion 333.55 kJ/kg (CRC Handbook 6-6); emissivity 0.97 (Incropera Table A.11).
 */
export const ICE = { density: 917, heatCapacity: 2050, conductivity: 2.22, fusion: 333550, emissivity: 0.97 } as const
/** Latent heat of sublimation of ice at 0 °C, J/kg (CRC Handbook: 2834 kJ/kg). */
export const SUBLIMATION = 2.834e6
/** Latent heat of vaporization of water, J/kg, at t °C: the steam tables' 2501 kJ/kg at 0 °C and 2257 kJ/kg at 100 °C, straight between (within 0.5 % of IAPWS-95 from 0 to 100 °C). */
export const vaporization = (t: number) => 2.501e6 - 2440 * Math.min(100, Math.max(0, t))
/** Sodium chloride: c_p 864 J/(kg·K) (CRC Handbook 5-12), molar mass 58.44 g/mol. */
export const SALT = { heatCapacity: 864, molar: 0.05844 } as const

/**
 * The freezing point of salt water (°C) at NaCl mass fraction w of the liquid (CRC Handbook of Chemistry and Physics, 97th ed., 8-80,
 * "Concentrative Properties of Aqueous Solutions": sodium chloride), straight between the table's rows; the eutectic, −21.1 °C at
 * 23.3 % (Hall, Sherwood & Hall 1988), from there on: brine saltier than that only stands beside undissolved salt.
 */
const BRINE: readonly (readonly [number, number])[] = [
	[0, 0],
	[0.01, -0.59],
	[0.02, -1.19],
	[0.03, -1.79],
	[0.04, -2.41],
	[0.05, -3.05],
	[0.06, -3.69],
	[0.07, -4.38],
	[0.08, -5.08],
	[0.09, -5.81],
	[0.1, -6.56],
	[0.12, -8.18],
	[0.14, -9.94],
	[0.16, -11.89],
	[0.18, -14.04],
	[0.2, -16.46],
	[0.22, -19.18],
	[0.233, -21.1]
]
export const EUTECTIC = -21.1
export const brineFreezing = (w: number): number => {
	if (!(w > 0)) return 0
	if (w >= 0.233) return EUTECTIC
	for (let i = 1; i < BRINE.length; i++) {
		const [w1, t1] = BRINE[i] as readonly [number, number]
		if (w <= w1) {
			const [w0, t0] = BRINE[i - 1] as readonly [number, number]
			return t0 + ((t1 - t0) * (w - w0)) / (w1 - w0)
		}
	}
	return EUTECTIC
}

/**
 * The boiling point of water at sea level, raised by dissolved salt: 100 °C + K_b·i·b (K_b = 0.512 K·kg/mol, i = 2 for NaCl, b its
 * molality; CRC Handbook). 1 g of salt in 100 g of water: +0.18 K.
 */
export const boilingPoint = (salt: number, water: number) => (water > 0 && salt > 0 ? 100 + (0.512 * 2 * (salt / SALT.molar)) / water : 100)

/**
 * Saturation vapour pressure, Pa, at t °C: over water (Alduchov & Eskridge 1996, J. Appl. Meteor. 35, 601, eq. 21: 610.94·exp(17.625t/(t + 243.04))),
 * over ice below 0 °C (their eq. 23: 611.21·exp(22.587t/(t + 273.86))). Within 0.4 % of the steam tables from −40 to 50 °C; 104 kPa at 100 °C (+2.7 %).
 */
export const vaporPressure = (t: number) =>
	t >= 0 ? 610.94 * Math.exp((17.625 * Math.min(t, 150)) / (Math.min(t, 150) + 243.04)) : 611.21 * Math.exp((22.587 * Math.max(t, -80)) / (Math.max(t, -80) + 273.86))
/** Water vapour's density at saturation, kg/m³, at t °C (ideal gas: p·M/(R·T)). 17.3 g/m³ at 20 °C. */
export const vaporDensity = (t: number) => (vaporPressure(t) * M_WATER) / (R_GAS * (t + KELVIN))
/**
 * The dew point (°C) of air at t °C and relative humidity rh (0..1): where its water vapour's partial pressure saturates, e_s(T_d) = rh·e_s(t)
 * (bisection on vaporPressure). (Dew forms in the model where the vapour's density at the surface's saturation falls below the room's: Incropera
 * §6.7's ρ_A,sat(T_s) − φ·ρ_A,sat(T_∞), which starts about 0.5 K below this, the gas being denser at the colder surface.)
 */
export const dewPoint = (t: number, rh: number) => {
	const target = vaporPressure(t) * Math.min(1, Math.max(0, rh))
	if (target <= 0) return -80
	let lo = -80
	let hi = t
	for (let i = 0; i < 60; i++) {
		const mid = (lo + hi) / 2
		if (vaporPressure(mid) < target) lo = mid
		else hi = mid
	}
	return (lo + hi) / 2
}

/** Air at 20 °C: ρ·c_p = 1.204 kg/m³ × 1006 J/(kg·K) (Engineering ToolBox, "Air - Thermophysical Properties"). */
export const AIR_RHO_CP = 1.204 * 1006
/**
 * Chilton-Colburn heat and mass transfer analogy: h_m = h / (ρ·c_p·Le^⅔), with the Lewis number of water vapour in air 0.845 (Incropera
 * §6.7.2, eq. 6.92; Le = α/D_AB = 2.22e-5 / 2.6e-5): Le^⅔ = 0.8938. Checked against Carrier's evaporation equation (ASHRAE Handbook,
 * HVAC Applications ch. 6) for still air: a water surface at 80 °C in a room at 22 °C, 50 %: 1.8 g/(m²·s) both ways.
 */
export const LEWIS_23 = 0.8938

/**
 * The least convection coefficient for evaporation and dew, W/(m²·K): Carrier's equation in still air (ASHRAE Handbook, HVAC Applications ch. 6:
 * w = 0.089·Δp/Y kg/(m²·s) with Δp in kPa and Y in kJ/kg), turned into a coefficient by the same analogy: h_m = 4.9 mm/s, h = 5.3 W/(m²·K).
 * Near a wet surface humid air rises by its own lightness (water vapour is lighter than air) and a room is never quite still, so mass
 * transfer does not stop where the temperature difference does.
 */
export const STILL_AIR_MASS = 5.3

const quarter = (x: number) => Math.sqrt(Math.sqrt(x))
/**
 * Natural convection from a surface in air, W/(m²·K), for a temperature difference dt (K) and length L (m): the simplified laminar
 * equations for air (Engineering ToolBox, "Convective Heat Transfer Coefficients", after ASHRAE Fundamentals): vertical 1.42 (ΔT/L)^¼;
 * horizontal facing up when warmer than the air (or facing down when colder) 1.32 (ΔT/L)^¼; facing down when warmer (or up when colder)
 * 0.59 (ΔT/L)^¼.
 */
export const naturalAir = (dt: number, length: number, facing: "side" | "rising" | "sinking") => {
	const c = facing === "side" ? 1.42 : facing === "rising" ? 1.32 : 0.59
	return c * quarter(Math.abs(dt) / Math.max(0.003, length))
}
/** Forced convection by air at speed v (m/s) over a length L (m): a laminar flat plate's average, 0.664·k·Re^½·Pr^⅓/L = 3.97·√(v/L) W/(m²·K) for air at 20 °C (Incropera eq. 7.30). */
export const forcedAir = (speed: number, length: number) => 3.97 * Math.sqrt(Math.abs(speed) / Math.max(0.003, length))
/** Natural and forced together (Churchill & Usagi): (h_n³ + h_f³)^⅓. */
export const mixedAir = (natural: number, forced: number) => (forced <= 0 ? natural : (natural * natural * natural + forced * forced * forced) ** (1 / 3))
/**
 * Natural convection in water, W/(m²·K): Nu = 0.59·Ra^¼ (laminar, Incropera eq. 9.27) with water's properties at 15 °C
 * (k 0.59 W/(m·K), ν 1.14e-6 m²/s, α 1.41e-7 m²/s, β 1.5e-4 /K): h = 120·(ΔT/L)^¼. An ice cube in water at 20 °C: about 850 W/(m²·K).
 */
export const naturalWater = (dt: number, length: number) => 120 * quarter(Math.abs(dt) / Math.max(0.003, length))
/** Nucleate boiling on a pan's floor, W/(m²·K): typical 2,500-35,000 (Incropera Table 1.1, "boiling or condensation"); 5000 here, provisional. */
export const BOILING_H = 5000
/**
 * Thermal contact resistance of two dry flat solids pressed lightly together in air, m²·K/W: 5e-4 (Incropera §3.1.4 and Table 3.1:
 * 1.5-5 × 10⁻⁴ for metal pairs at 100 kN/m² in air; light pressure and rough non-metals more), provisional. A wet contact (a melting ice
 * cube's film of meltwater) has none.
 */
export const CONTACT_RESISTANCE = 5e-4
/** Still air's conductivity at 20 °C, W/(m·K) (Incropera Table A.4: 0.0257 at 300 K): the gap under a plate standing on its foot ring. */
export const AIR_CONDUCTIVITY = 0.0257
/** A puddle's thickness on a flat plate or table, m: 3 mm (a sessile puddle of water on a wettable surface is 2-5 mm deep), provisional. */
export const PUDDLE_FILM = 0.003
/** Dew that stands on a surface before it runs off, kg/m²: about 0.15 (drops of 2-4 mm at 20-40 % cover), provisional. */
export const DEW_RUNOFF = 0.15
/** Dew that wets a surface completely, kg/m² (a 50 µm film): less only wets that share of it (its evaporation scales with it). */
export const DEW_FILM = 0.05

/** A material's heat properties. */
export interface HeatMaterial {
	/** W/(m·K) */
	readonly conductivity: number
	/** J/(kg·K) */
	readonly heatCapacity: number
	/** Thermal infrared emissivity (= absorptivity to a room's radiation), 0..1. */
	readonly emissivity: number
	/** The share of a lamp's or the sun's light it absorbs, 0..1. */
	readonly absorptivity: number
	/** Its absorptivity follows its colour (a painted, dyed or plain non-metal surface): `colourAbsorptivity`; else `absorptivity` holds. */
	readonly colour?: boolean
	/** A thin sheet (paper, card): its own density, kg/m³, so a sheet the engine draws as a 1 mm slab is its real thickness for a focused spot. */
	readonly sheet?: number
	/** It melts: at `at` °C, taking `latent` J/kg; its liquid's heat capacity and density; `water`: it is ice (salt lowers its melting point, its liquid evaporates). */
	readonly melt?: { readonly at: number; readonly latent: number; readonly liquidHeatCapacity: number; readonly liquidDensity: number; readonly water?: boolean }
	readonly source: string
}

const m = (conductivity: number, heatCapacity: number, emissivity: number, absorptivity: number, source: string, melt?: HeatMaterial["melt"]): HeatMaterial => ({
	conductivity,
	heatCapacity,
	emissivity,
	absorptivity,
	source,
	...(melt === undefined ? {} : { melt })
})
/** A non-metal whose light absorptivity is its colour's (colourAbsorptivity); `absorptivity` is for its usual colour. */
const c = (conductivity: number, heatCapacity: number, emissivity: number, absorptivity: number, source: string, melt?: HeatMaterial["melt"]): HeatMaterial => ({
	...m(conductivity, heatCapacity, emissivity, absorptivity, source, melt),
	colour: true
})
const INC = "Incropera & DeWitt, Fundamentals of Heat and Mass Transfer, 6th ed."
const SALT_MATERIAL_ROW = (): HeatMaterial => m(0.3, 864, 0.9, 0.2, "Table salt (NaCl): c 864 J/(kg·K) (CRC); a loose pile conducts about 0.3 W/(m·K), provisional.")
const ETB = "Engineering ToolBox"

/**
 * The heat properties of the catalog's materials, by the material's catalog name (a material an item changed is named "<name> [hash]";
 * the name before the bracket counts). Absorptivity is to sunlight or a lamp's light (Incropera Table A.12 where listed; else from the
 * colour, provisional); emissivity from Incropera Table A.11 where listed.
 */
export const HEAT_MATERIALS: Readonly<Record<string, HeatMaterial>> = {
	"varnished hardwood": c(0.16, 1255, 0.9, 0.6, `Hardwood (oak, maple): k 0.16 W/(m·K), c 1255 J/(kg·K) (${INC}, Table A.3); varnish ε 0.9.`),
	"domino wood": c(0.16, 1255, 0.9, 0.55, `Hardwood: k 0.16 W/(m·K), c 1255 J/(kg·K) (${INC}, Table A.3).`),
	"dark wood": c(0.16, 1255, 0.9, 0.8, `Hardwood: k 0.16 W/(m·K), c 1255 J/(kg·K) (${INC}, Table A.3); dark stain absorbs more light (provisional).`),
	"solid rubber": c(0.16, 2010, 0.92, 0.8, `Rubber, vulcanized: k 0.13-0.16 W/(m·K), c 2010 J/(kg·K) (${INC}, Table A.3).`),
	"hollow plastic": c(0.33, 2300, 0.9, 0.5, `Polyethylene: k 0.33 W/(m·K), c 2300 J/(kg·K) (${ETB}, "Plastics - Thermal Conductivity", "Specific Heat of Solids").`),
	"modeling clay": c(0.4, 1800, 0.9, 0.6, "Plasticine (clay, oil and wax): k 0.4 W/(m·K), c 1800 J/(kg·K), provisional."),
	steel: m(60.5, 434, 0.3, 0.5, `Plain carbon steel: k 60.5 W/(m·K), c 434 J/(kg·K) (${INC}, Table A.1); lightly oxidized ε 0.3 (Table A.11, provisional).`),
	"steel weight": m(52, 450, 0.8, 0.7, `Cast iron: k 52 W/(m·K), c 450 J/(kg·K) (${ETB}); painted ε 0.8.`),
	glass: m(1.4, 750, 0.94, 0.15, `Plate glass: k 1.4 W/(m·K), c 750 J/(kg·K) (${INC}, Table A.3); ε 0.94 (Table A.11); clear, it absorbs little light.`),
	"glass marble": m(1.4, 750, 0.94, 0.2, `Glass: k 1.4 W/(m·K), c 750 J/(kg·K) (${INC}, Table A.3).`),
	"glass & aluminium": m(1.4, 750, 0.94, 0.15, `Glass: k 1.4 W/(m·K), c 750 J/(kg·K) (${INC}, Table A.3).`),
	ice: m(
		ICE.conductivity,
		ICE.heatCapacity,
		ICE.emissivity,
		0.6,
		"Ice: k 2.22 W/(m·K), c 2050 J/(kg·K), melts at 0 °C taking 333.55 kJ/kg (CRC; Engineering ToolBox). Absorbs about 0.6 of a warm lamp's light (water and ice absorb most of the infrared past 1.4 µm), provisional.",
		{ at: 0, latent: ICE.fusion, liquidHeatCapacity: WATER.heatCapacity, liquidDensity: WATER.density, water: true }
	),
	water: m(WATER.conductivity, WATER.heatCapacity, WATER.emissivity, 0.7, "Water at 20 °C: k 0.598 W/(m·K), c 4184 J/(kg·K) (CRC).", {
		at: 0,
		latent: ICE.fusion,
		liquidHeatCapacity: WATER.heatCapacity,
		liquidDensity: WATER.density,
		water: true
	}),
	"puddle water": m(WATER.conductivity, WATER.heatCapacity, WATER.emissivity, 0.7, "A puddle: water at 20 °C, k 0.598 W/(m·K), c 4184 J/(kg·K) (CRC).", {
		at: 0,
		latent: ICE.fusion,
		liquidHeatCapacity: WATER.heatCapacity,
		liquidDensity: WATER.density,
		water: true
	}),
	foam: c(0.033, 1300, 0.9, 0.2, `Expanded polystyrene foam: k 0.033 W/(m·K) (${INC}, Table A.3: 0.027-0.040), c 1300 J/(kg·K) (${ETB}).`),
	brick: c(0.72, 835, 0.93, 0.63, `Common brick: k 0.72 W/(m·K), c 835 J/(kg·K) (${INC}, Table A.3); red brick: solar absorptivity 0.63, ε 0.93 (Table A.12).`),
	carpet: c(0.06, 1360, 0.9, 0.7, `Carpet with fibrous pad: k 0.06 W/(m·K) (${INC}, Table A.3: 0.048); c provisional.`),
	cork: c(0.039, 1800, 0.9, 0.6, `Cork board: k 0.039 W/(m·K), c 1800 J/(kg·K) (${INC}, Table A.3).`),
	cardboard: c(0.064, 1400, 0.9, 0.7, `Corrugated cardboard: k 0.064 W/(m·K), c 1400 J/(kg·K) (${ETB}), provisional.`),
	aluminium: m(237, 903, 0.09, 0.15, `Aluminium: k 237 W/(m·K), c 903 J/(kg·K) (${INC}, Table A.1); commercial sheet ε 0.09 (Table A.11).`),
	"aluminium can": m(237, 903, 0.8, 0.5, `Aluminium: k 237 W/(m·K), c 903 J/(kg·K) (${INC}, Table A.1); painted ε 0.8.`),
	concrete: c(1.4, 880, 0.9, 0.6, `Concrete (stone mix): k 1.4 W/(m·K), c 880 J/(kg·K) (${INC}, Table A.3).`),
	"rubber mat": c(0.16, 2010, 0.92, 0.9, `Rubber: k 0.16 W/(m·K), c 2010 J/(kg·K) (${INC}, Table A.3); black, absorbs most light.`),
	celluloid: c(0.21, 1500, 0.9, 0.3, "Celluloid: k 0.21 W/(m·K) (CRC), c 1500 J/(kg·K) provisional."),
	"felt (tennis)": c(0.04, 1300, 0.9, 0.4, "Felt: k 0.04 W/(m·K), provisional."),
	"golf ionomer": c(0.25, 1900, 0.9, 0.2, "Ionomer resin: k 0.25 W/(m·K), c 1900 J/(kg·K), provisional."),
	"baseball (leather/cork)": c(0.15, 1500, 0.9, 0.3, "Leather and cork: k 0.15 W/(m·K), provisional."),
	"leather (basketball)": c(0.16, 1500, 0.9, 0.7, "Leather: k 0.16 W/(m·K), provisional."),
	"synthetic leather (soccer)": c(0.16, 1500, 0.9, 0.3, "Synthetic leather: k 0.16 W/(m·K), provisional."),
	"bowling resin": c(0.2, 1200, 0.9, 0.7, "Polyester resin: k 0.2 W/(m·K), c 1200 J/(kg·K), provisional."),
	"PVC (beach ball)": c(0.19, 1000, 0.9, 0.4, `PVC: k 0.19 W/(m·K), c 1000 J/(kg·K) (${ETB}).`),
	"phenolic resin": c(0.25, 1500, 0.9, 0.4, "Phenolic resin: k 0.25 W/(m·K), provisional."),
	"ABS plastic": c(0.17, 1400, 0.9, 0.5, `ABS: k 0.17 W/(m·K), c 1400 J/(kg·K) (${ETB}).`),
	polypropylene: c(0.22, 1920, 0.9, 0.4, `Polypropylene: k 0.22 W/(m·K), c 1920 J/(kg·K) (${ETB}).`),
	PET: m(0.15, 1170, 0.9, 0.15, `PET: k 0.15 W/(m·K), c 1170 J/(kg·K) (${ETB}); clear.`),
	ceramic: c(1.5, 1085, 0.92, 0.25, `Porcelain: k 1.5 W/(m·K), c 1085 J/(kg·K) (${ETB}); glazed ε 0.92; white glaze reflects most light (absorptivity 0.25, provisional).`),
	fruit: c(0.5, 3600, 0.95, 0.7, "Apple flesh: k 0.4-0.5 W/(m·K), c 3600 J/(kg·K) (ASHRAE Refrigeration Handbook, thermal properties of foods)."),
	eggshell: c(0.5, 3200, 0.95, 0.4, "Whole egg: k 0.5 W/(m·K), c 3200 J/(kg·K) (ASHRAE Refrigeration Handbook, foods), provisional."),
	"tissue paper": c(0.05, 1340, 0.9, 0.2, `Paper: k 0.05 W/(m·K) (loose), c 1340 J/(kg·K) (${INC}, Table A.3).`),
	wax: c(0.24, 2500, 0.9, 0.3, "Paraffin wax: k 0.24 W/(m·K), c 2500 J/(kg·K); melts at 58 °C taking 200 kJ/kg (Engineering ToolBox; paraffin 46-68 °C, 200-220 kJ/kg).", {
		at: 58,
		latent: 200000,
		liquidHeatCapacity: 2900,
		liquidDensity: 780
	}),
	"vinyl rubber": c(0.16, 1500, 0.9, 0.6, "Vinyl: k 0.16 W/(m·K), provisional."),
	cupronickel: m(29, 380, 0.3, 0.4, "Cupronickel 75/25 (coins): k 29 W/(m·K), c 380 J/(kg·K) (Copper Development Association, C71300 data)."),
	"rubber & fabric": c(0.1, 1500, 0.9, 0.6, "Rubber and fabric: k 0.1 W/(m·K), provisional."),
	"tyre rubber": c(0.25, 1900, 0.95, 0.9, "Tyre rubber: k 0.25 W/(m·K), c 1900 J/(kg·K), provisional."),
	"bicycle tyre": c(0.25, 1900, 0.95, 0.9, "Tyre rubber: k 0.25 W/(m·K), c 1900 J/(kg·K), provisional."),
	urethane: c(0.2, 1800, 0.9, 0.5, "Polyurethane (solid): k 0.2 W/(m·K), c 1800 J/(kg·K), provisional."),
	"trampoline mat": c(0.1, 1900, 0.9, 0.9, "Woven polypropylene: k 0.1 W/(m·K), provisional."),
	"conveyor belt": c(0.2, 1800, 0.9, 0.9, "Rubber belt: k 0.2 W/(m·K), provisional."),
	// ---- the heat module's own materials (machines/mod_heat.py)
	"table salt": SALT_MATERIAL_ROW(),
	"stainless steel": m(16.2, 477, 0.2, 0.4, `Stainless steel AISI 304: k 16.2 W/(m·K) at 400 K (14.9 at 300 K), c 477 J/(kg·K) (${INC}, Table A.1); polished ε 0.2 (Table A.11: 0.17).`),
	copper: m(401, 385, 0.1, 0.35, `Copper: k 401 W/(m·K), c 385 J/(kg·K) (${INC}, Table A.1); lightly tarnished ε 0.1.`),
	"cast iron": m(52, 460, 0.85, 0.8, `Cast iron: k 52 W/(m·K), c 460 J/(kg·K) (${ETB}); a hot plate's black enamel ε 0.85.`),
	"paper cup": c(0.08, 1340, 0.9, 0.3, `Paperboard with a plastic lining: k 0.08 W/(m·K) (${ETB}: paperboard 0.05-0.1), c 1340 J/(kg·K) (${INC}, Table A.3).`),
	"vacuum flask": m(0.004, 500, 0.1, 0.4, "A vacuum flask's double wall, as one wall: effective k 0.004 W/(m·K) over 1 cm (a 0.5 L flask keeping 95 °C water above 75 °C for 6 h, its stopper included), provisional."),
	chocolate: m(0.2, 1600, 0.9, 0.85, "Milk chocolate: k 0.2 W/(m·K), c 1600 J/(kg·K); its cocoa butter (form V) melts at 34 °C, about 45 kJ/kg for the bar (Beckett, Industrial Chocolate Manufacture and Use, 4th ed.), provisional.", {
		at: 34,
		latent: 45000,
		liquidHeatCapacity: 2000,
		liquidDensity: 1250
	}),
	butter: c(0.2, 2100, 0.9, 0.4, "Butter: k 0.2 W/(m·K), c 2100 J/(kg·K) (ASHRAE Refrigeration Handbook, foods); melts by 35 °C, about 70 kJ/kg (its 80 % milk fat at about 85 kJ/kg), provisional.", {
		at: 33,
		latent: 70000,
		liquidHeatCapacity: 2200,
		liquidDensity: 911
	}),
	// ---- other modules' materials the heat module meets (sand trays, paper, optical glass and card panels, brass, pine boats)
	sand: c(0.27, 830, 0.9, 0.6, `Dry sand: k 0.27 W/(m·K) (${INC}, Table A.3: sand 0.27), c 830 J/(kg·K) (CRC Handbook: quartz sand 0.83 kJ/(kg·K)); sand-coloured, absorbs about 0.6 of sunlight.`),
	"dry sand": c(0.27, 830, 0.9, 0.6, `Dry sand: k 0.27 W/(m·K) (${INC}, Table A.3), c 830 J/(kg·K) (CRC Handbook).`),
	"office paper": { ...c(0.18, 1340, 0.93, 0.25, `Paper: k 0.18 W/(m·K), c 1340 J/(kg·K) (${INC}, Table A.3); white paper reflects most light; 80 g/m² office paper about 800 kg/m³ (0.1 mm).`), sheet: 800 },
	card: { ...c(0.08, 1340, 0.9, 0.3, `Card and paperboard: k 0.05-0.1 W/(m·K) (${ETB}), c 1340 J/(kg·K) (${INC}, Table A.3: paper), about 700 kg/m³, provisional.`), sheet: 700 },
	"optical glass": m(1.11, 858, 0.92, 0.1, "Crown glass N-BK7: k 1.114 W/(m·K), c 858 J/(kg·K) (SCHOTT N-BK7 data sheet); clear, it absorbs little light."),
	acrylic: m(0.19, 1470, 0.9, 0.1, `PMMA (acrylic): k 0.19 W/(m·K), c 1470 J/(kg·K) (${ETB}, polymer handbooks); clear.`),
	brass: m(110, 380, 0.1, 0.4, `Cartridge brass (70 Cu-30 Zn): k 110 W/(m·K), c 380 J/(kg·K) (${INC}, Table A.1); polished ε about 0.1.`),
	pine: c(0.12, 1380, 0.9, 0.5, `Softwood (pine, fir): k 0.12 W/(m·K), c 1380 J/(kg·K) (${INC}, Table A.3).`),
	"modelling clay": c(0.4, 1800, 0.9, 0.6, "Plasticine (clay, oil and wax): k 0.4 W/(m·K), c 1800 J/(kg·K), provisional."),
	sandpaper: c(0.18, 1100, 0.93, 0.8, `Sandpaper (paper backing and aluminium oxide grit): k about 0.2 W/(m·K), c about 1100 J/(kg·K) (paper 1340, alumina 765: ${INC}, Tables A.1, A.3), provisional.`)
}

/**
 * The liquids of the fluids and flow modules as heat sees them (by their words: "salt water (10 % salt)" counts as salt water): c (J/(kg·K)),
 * k (W/(m·K)), long-wave emissivity, where it sets (°C) and its latent heat (J/kg), and whether it is water (it then evaporates, boils at 100 °C,
 * freezes at 0 °C as heat's water does). Mixed liquids in one container take the mass-weighted c.
 */
export interface HeatLiquid {
	readonly heatCapacity: number
	readonly conductivity: number
	readonly emissivity: number
	readonly sets: number
	readonly latent: number
	readonly water: boolean
	readonly source: string
}
const liq = (heatCapacity: number, conductivity: number, sets: number, latent: number, water: boolean, source: string): HeatLiquid => ({ heatCapacity, conductivity, emissivity: 0.95, sets, latent, water, source })
export const HEAT_LIQUIDS: Readonly<Record<string, HeatLiquid>> = {
	water: liq(WATER.heatCapacity, WATER.conductivity, 0, ICE.fusion, true, "Water: c 4184 J/(kg·K), k 0.598 W/(m·K) (CRC)."),
	"salt water": liq(WATER.heatCapacity, WATER.conductivity, 0, ICE.fusion, true, "Salt water: heat's water with its salt (its freezing and boiling points move with the salt; CRC)."),
	"sea water": liq(WATER.heatCapacity, WATER.conductivity, 0, ICE.fusion, true, "Sea water: water with 3.5 % salt (c 3993 J/(kg·K) at 20 °C, Sharqawy et al. 2010; heat's water used)."),
	"vegetable oil": liq(1970, 0.17, -10, 100000, false, `Vegetable (olive, soybean) oil: c 1970 J/(kg·K), k 0.17 W/(m·K) (${ETB}, "Specific Heat of Liquids": olive oil 1.97 kJ/(kg·K)); clouds and sets below about −10 °C (provisional; latent heat provisional).`),
	honey: liq(2300, 0.5, -40, 100000, false, "Honey (about 17 % water): c about 2.3 kJ/(kg·K) (sugars 1.55 and water 4.18 mass-averaged, Choi & Okos 1986: 2.0-2.4), k about 0.5 W/(m·K), provisional; it does not freeze at classroom temperatures."),
	"corn syrup": liq(2400, 0.45, -40, 100000, false, "Light corn syrup (about 23 % water): c about 2.4 kJ/(kg·K) (Choi & Okos 1986 mass average), k about 0.45 W/(m·K), provisional."),
	"dish soap": liq(3800, 0.5, -5, 300000, false, "Liquid dish soap (mostly water and surfactant): c about 3.8 kJ/(kg·K), k about 0.5 W/(m·K), provisional."),
	"rubbing alcohol": liq(3130, 0.25, -60, 90000, false, "Rubbing alcohol (70 % isopropanol, 30 % water by mass): c 0.7 × 2.68 + 0.3 × 4.18 = 3.13 kJ/(kg·K) (CRC: isopropanol 2.68 kJ/(kg·K) at 25 °C), k about 0.25 W/(m·K), provisional.")
}
/** The heat liquid of a fluids or flow liquid's words ("salt water (10 % salt)" is salt water); undefined: not one heat knows. */
export const heatLiquidOf = (words: string): HeatLiquid | undefined => {
	const base = words.indexOf(" (") > 0 ? words.slice(0, words.indexOf(" (")) : words
	return HEAT_LIQUIDS[base]
}

/**
 * Clear things a lamp's or the sun's light passes through, for heat's own estimate of the light (scenes the optics module does not trace): the
 * share of the light one pane passes. Soda-lime and crown glass 3 mm: about 0.92 (two faces' Fresnel reflection at n 1.5, 4 % each, and little
 * absorption: Hecht, Optics, 5th ed., §4.6); PET and acrylic about 0.90-0.92 (polymer handbooks, approximate). Ice and water are not on the list:
 * they drink the infrared (they are what the light warms).
 */
export const TRANSMITTANCE: Readonly<Record<string, number>> = {
	glass: 0.92,
	"optical glass": 0.92,
	PET: 0.9,
	acrylic: 0.92,
	"box acrylic": 0.92,
	"bag film": 0.9,
	"thermometer glass": 0.92
}
/** The share of a lamp's or the sun's light a solid of this material lets through (0: opaque). */
export const transmittanceOf = (name: string): number => {
	const bracket = name.indexOf(" [")
	const base = bracket > 0 ? name.slice(0, bracket) : name
	return TRANSMITTANCE[base] ?? 0
}

/**
 * Linear thermal expansion coefficients, 1/K, near 20 °C (CRC Handbook of Chemistry and Physics, 97th ed., "Thermal Expansion of Solids";
 * Engineering ToolBox "Coefficients of Linear Thermal Expansion"): a solid's length grows by 1 + α·ΔT. Young's moduli (Pa) for the bimetal
 * strip's bend (CRC / ASM handbooks).
 */
export const EXPANSION: Readonly<Record<string, { readonly alpha: number; readonly modulus: number }>> = {
	steel: { alpha: 12e-6, modulus: 200e9 },
	"stainless steel": { alpha: 17.3e-6, modulus: 193e9 },
	brass: { alpha: 19e-6, modulus: 100e9 },
	aluminium: { alpha: 23.1e-6, modulus: 69e9 },
	copper: { alpha: 16.5e-6, modulus: 117e9 },
	invar: { alpha: 1.2e-6, modulus: 141e9 },
	glass: { alpha: 9e-6, modulus: 70e9 }
}
/**
 * A bimetal strip's curvature (1/m) when heated ΔT above the temperature it is straight at (Timoshenko, "Analysis of bi-metal thermostats",
 * J. Opt. Soc. Am. 11, 233 (1925)): κ = 6 (α2 − α1) ΔT (1 + m)² / (h (3 (1 + m)² + (1 + m n)(m² + 1/(m n)))), h the whole thickness,
 * m = t1/t2, n = E1/E2. It bends toward the layer that expands less.
 */
export const bimetalCurvature = (alpha1: number, alpha2: number, E1: number, E2: number, t1: number, t2: number, dT: number) => {
	const m1 = t1 / t2
	const n1 = E1 / E2
	const h = t1 + t2
	return (6 * (alpha2 - alpha1) * dT * (1 + m1) * (1 + m1)) / (h * (3 * (1 + m1) * (1 + m1) + (1 + m1 * n1) * (m1 * m1 + 1 / (m1 * n1))))
}

/**
 * A candle's flame (Hamins, Bundy & Dillon, "Characterization of candle flames", J. Fire Prot. Eng. 15, 265 (2005)): about 80 W of heat, burning
 * about 0.1 g of paraffin a minute (its heat of combustion about 46 kJ/g: 0.1 g/min gives 77 W). Of the 80 W, about 75 % rises in its plume (the
 * thermal spec's figure) and about 20 % leaves as radiation (small sooty flames radiate 15-30 %: provisional); its light about 1 candela, 12.6 lm
 * (the candela's own definition). The flame stands about 2.5 cm tall over its wick. Paraffin (C25H52, 352.7 g/mol) takes 38 O2 a molecule:
 * 3.45 g of oxygen a gram of wax; oxygen 1.331 kg/m³ at 20 °C and 1 atm; air is 20.95 % oxygen by volume (NOAA); a candle goes out near
 * 16 % (the limiting oxygen concentration of paraffin candles, about 15-17 %: provisional).
 */
export const CANDLE = {
	power: 80,
	burn: 0.1 / 60 / 1000,
	combustion: 46e6,
	plume: 0.75,
	radiant: 0.2,
	lumens: 12.6,
	flame: 0.025,
	o2PerWax: 3.45,
	o2Density: 1.331,
	airO2: 0.2095,
	outO2: 0.16
} as const

/** Air for the plume laws: c_p 1007 J/(kg·K), ρ 1.2 kg/m³ near 20 °C (Incropera Table A.4). */
const PLUME_CP = 1007
const PLUME_RHO = 1.2
/**
 * A fire's plume (Heskestad, "Fire plumes, flame height and air entrainment", SFPE Handbook of Fire Protection Engineering, 5th ed., ch. 13):
 * on its axis z m above its origin, the gas is ΔT0 = 9.1·(T∞/(g·c_p²·ρ²))^⅓·Qc^⅔·z^(−5/3) K hotter than the room and rises at u0 =
 * 3.4·(g/(c_p·ρ·T∞))^⅓·Qc^⅓·z^(−⅓) m/s, Qc W its convected heat; its half-width b = 0.12·(T0/T∞)^½·z. Capped at 900 K (the flame's own tip).
 */
export const plumeExcess = (qc: number, z: number, tRoomK: number, g: number) =>
	Math.min(900, 9.1 * (tRoomK / (g * PLUME_CP * PLUME_CP * PLUME_RHO * PLUME_RHO)) ** (1 / 3) * qc ** (2 / 3) * Math.max(0.01, z) ** (-5 / 3))
export const plumeRise = (qc: number, z: number, tRoomK: number, g: number) => 3.4 * (g / (PLUME_CP * PLUME_RHO * tRoomK)) ** (1 / 3) * qc ** (1 / 3) * Math.max(0.01, z) ** (-1 / 3)
export const plumeHalfWidth = (z: number, excess: number, tRoomK: number) => 0.12 * Math.sqrt((tRoomK + excess) / tRoomK) * Math.max(0.01, z)

/**
 * The temperature (°C) at which a material's hottest spot scorches and starts to smoke or char: paper about 233 °C (its autoignition, 218-246 °C:
 * "Fahrenheit 451"; Graf, NFPA Fire Protection Handbook), card 260 °C, wood about 300 °C (piloted ignition 250-300 °C, Babrauskas, Ignition
 * Handbook 2003), cloth about 255 °C, provisional where not cited.
 */
export const SCORCH: Readonly<Record<string, number>> = {
	"office paper": 233,
	"tissue paper": 233,
	paperboard: 233,
	"paper cup": 233,
	card: 260,
	cardboard: 260,
	"varnished hardwood": 300,
	"domino wood": 300,
	"dark wood": 300,
	pine: 300,
	"felt (tennis)": 255,
	"rubber & fabric": 255
}

/**
 * The share of a lamp's or the sun's light a non-metal surface of this colour absorbs: between Incropera's measured white paint (solar
 * absorptivity 0.2: zinc-oxide white, Table A.12) and black paint (0.97, Parsons black), by the colour's relative luminance Y (linear sRGB,
 * 0.2126 R + 0.7152 G + 0.0722 B): α = 0.2 + 0.77·(1 − Y). White 0.20, mid grey 0.79, black 0.97. Long-wave emissivity does not follow
 * the colour (painted surfaces are about 0.9 either way: Table A.11).
 */
export const colourAbsorptivity = (hex: string): number | undefined => {
	const m6 = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
	const m3 = m6 === null ? /^#?([0-9a-fA-F]{3})$/.exec(hex.trim()) : null
	const h = m6 !== null ? (m6[1] as string) : m3 !== null ? (m3[1] as string).split("").map((ch) => ch + ch).join("") : undefined
	if (h === undefined) return undefined
	const lin = (i: number) => {
		const v = Number.parseInt(h.slice(i, i + 2), 16) / 255
		return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
	}
	const Y = 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4)
	return 0.2 + 0.77 * (1 - Math.min(1, Math.max(0, Y)))
}

/** Table salt (NaCl): c_p 864 J/(kg·K) (CRC), a loose pile's conductivity about 0.3 W/(m·K) (provisional); white crystals reflect most light. */
export const SALT_MATERIAL: HeatMaterial = m(0.3, 864, 0.9, 0.2, "Table salt (NaCl): c 864 J/(kg·K) (CRC); a loose pile conducts about 0.3 W/(m·K), provisional.")
/** NaCl dissolving: +3.88 kJ/mol taken from its surroundings (CRC Handbook, "Enthalpy of solution of electrolytes"): 66.4 kJ/kg. */
export const SALT_SOLUTION = 3880 / 0.05844
/** Solubility of NaCl: 35.9 g in 100 g of water at 25 °C (35.7 at 0 °C) (CRC). */
export const SALT_SOLUBILITY = 0.359

/** Heat properties for a material the table does not name, from its density (a metal, stone or glass, a plastic, wood, a foam), provisional. */
export const heatMaterialOf = (name: string, density: number): HeatMaterial => {
	const bracket = name.indexOf(" [")
	const base = bracket > 0 ? name.slice(0, bracket) : name
	const known = HEAT_MATERIALS[base]
	if (known !== undefined) return known
	if (density > 5000) return HEAT_MATERIALS.steel as HeatMaterial
	if (density > 2000) return HEAT_MATERIALS.concrete as HeatMaterial
	if (density > 800) return HEAT_MATERIALS["ABS plastic"] as HeatMaterial
	if (density > 100) return HEAT_MATERIALS["varnished hardwood"] as HeatMaterial
	return HEAT_MATERIALS.foam as HeatMaterial
}

/**
 * Lamps (W of light and heat into the beam, per W drawn): a general-service incandescent lamp gives about 83 % of its power as radiation
 * (IES Lighting Handbook: 60 W: 7.5 % light, 73.3 % infrared, 19.2 % conducted and convected); a halogen about 85 %; an LED lamp
 * about 35 % (its light; its heat leaves by its heat sink, not the beam: US DOE, "LED Basics"). A desk lamp's reflector sends about
 * 65 % of that into its beam (provisional).
 */
export const LAMP_RADIANT = { incandescent: 0.81, halogen: 0.85, led: 0.35 } as const
export const REFLECTOR_SHARE = 0.65
