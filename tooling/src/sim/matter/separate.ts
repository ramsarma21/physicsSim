/**
 * Separating a mixture by what a sieve or a magnet cannot: FILTERING (a funnel lined with filter paper keeps the sand and lets the salt
 * water through) and EVAPORATING (a dish of salt water heated on a hot plate, left in the sun or in a room: the water goes, the salt stays
 * as crystals). Real units throughout (m, kg, s of lesson time, °C); the caller (modules/matter.ts) steps them in lesson time.
 *
 * Filtering (Filter): gravity filtration through a cone of paper. The water passes the paper and the cake of solids on it by Darcy's law,
 * Q = ΔP·A/(μ·(R_paper + R_cake)). In a 60° funnel the liquid above the paper is a cone, V = (π/3)·tan²30°·h³; its wetted paper, the cone's
 * side, A = π·h²·tan30°/cos30°, under a mean head of h/3 (the side's mean depth below the surface): so Q ∝ h³ ∝ V, and a funnel drains
 * exponentially, V(t) = V0·e^(−t/τ), τ = sin30°·μ·R/(share·ρ·g) (share: the part of a quarter-folded paper that works as one layer, 2/3).
 *   R_paper from the paper's Herzberg flow time (Whatman Grade 1: 150 s for 100 mL through 10 cm² under a 10 cm head: R = ρgh·A/(μQ) =
 *   1.47e9 1/m; Cytiva, "Whatman qualitative filter papers" datasheet: particle retention 11 µm). R_cake = L/k, the cake's permeability by
 *   Kozeny-Carman, k = d²·ε³/(180·(1 − ε)²) (Carman, Trans. Inst. Chem. Eng. 15, 150, 1937), its thickness its volume over the paper's area.
 *   Solids bigger than the paper's retention stay on it (sand: 0.1-0.5 mm); smaller ones pass with the water (a coffee filter's 20 µm lets
 *   chalk's flocs through: the filtrate is cloudy). Dissolved salt passes with the water: the water held by the wet paper and in the cake's
 *   pores keeps its share until a rinse of clean water carries most of it through.
 * Evaporating (Dish): one lumped node (the water, its salt and the glass dish) with the heat module's own air laws
 *   (tooling/src/sim/heat-data.ts): natural convection and radiation to the room, evaporation by the Chilton-Colburn analogy
 *   (h_m = max(h, 5.3)/(ρc_p·Le^⅔)) from the surface's vapour density lowered by the dissolved salt (its water activity: NaCl, Robinson &
 *   Stokes, Electrolyte Solutions, 2nd ed., 1959, Appendix 8.10; sucrose, Norrish, J. Food Technol. 1, 25, 1966: a_w = x_w·e^(−6.47·x_s²))
 *   to the room's (its humidity); boiling at the solution's boiling point (100 °C + K_b·i·b, K_b 0.512 K·kg/mol: CRC Handbook) once the
 *   heat keeps coming. The salt stays dissolved up to its solubility at the dish's temperature (substances.ts, CRC); the rest is crystals.
 *
 * Math: only + − × ÷, Math.sqrt, Math.exp, Math.pow (the engine's math: the same bits in node and every browser), no Math.log.
 */
import { AIR_RHO_CP, LEWIS_23, naturalAir, SIGMA, STILL_AIR_MASS, vaporDensity, vaporization } from "../heat-data.ts"
import { KELVIN, type Solute, solubility, table, WATER_DENSITY, WATER_VISCOSITY } from "./substances.ts"

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

// ================================================================ filtering
/** sin, tan and cos of the funnel's half-angle (a 60° funnel). */
const SIN30 = 0.5
const TAN30 = 0.5773502691896257
const COS30 = 0.8660254037844386
/** The part of a quarter-folded paper's wetted area that filters as one layer (one layer on half the cone, three on the other: provisional). */
export const SHARE = 2 / 3
/** The liquid's highest level above the cone's apex, as a share of the funnel's rim diameter: 1 cm below the edge of a 12.5 cm paper in a 7.5 cm funnel. */
export const FULL = 0.615
/** The liquid cone's volume per h³ (h above the apex), m³/m³. */
const CONE = (Math.PI * TAN30 * TAN30) / 3
/** The shortest drain time, s: with no paper the mixture runs through the stem in about this (provisional). */
const STEM = 0.5

export interface Paper {
	/** Resistance to flow, 1/m (Darcy: ΔP = μ·R·Q/A). */
	readonly resistance: number
	/** The smallest grains it keeps, m. */
	readonly retention: number
	/** Water a wet paper for a 7.5 cm funnel holds, m³ (scaled by the paper's area). */
	readonly holds: number
	readonly source: string
}

export const PAPERS: Readonly<Record<string, Paper>> = {
	"filter paper": {
		resistance: 1.466e9,
		retention: 11e-6,
		holds: 2.0e-6,
		source:
			"Whatman Grade 1 qualitative filter paper (Cytiva datasheet): particle retention 11 µm, Herzberg flow 150 s (100 mL through 10 cm² under a 10 cm head: R = ρgh·A/(μ·Q) = 1.47e9 1/m), 87 g/m²; a 12.5 cm circle (1.07 g) holds about 2 g of water when wet (provisional)."
	},
	"coffee filter": {
		resistance: 4.9e8,
		retention: 20e-6,
		holds: 3.0e-6,
		source: "A paper coffee filter: about three times as fast as lab filter paper and keeps grains over about 20 µm (provisional)."
	},
	none: { resistance: 0, retention: Infinity, holds: 0, source: "No paper: everything runs through the funnel's stem." }
}

export interface FilterSolid {
	readonly density: number
	/** Grain size, m: the cake's permeability (Kozeny-Carman) and what a paper keeps. */
	readonly grain: number
	/** The size a paper must stop to keep it (chalk's grains clump into flocs), m. */
	readonly kept: number
	/** The cake's porosity. */
	readonly porosity: number
	readonly color: string
	readonly source: string
}

export const FILTER_SOLIDS: Readonly<Record<string, FilterSolid>> = {
	sand: {
		density: 2650,
		grain: 2.5e-4,
		kept: 2.5e-4,
		porosity: 0.4,
		color: "#d8b77a",
		source: "Fine quartz sand: 2.65 g/cm³ [CRC], grains 0.1-0.5 mm (median 0.25 mm); a settled bed's porosity about 0.4."
	},
	chalk: {
		density: 2710,
		grain: 5e-6,
		kept: 15e-6,
		porosity: 0.5,
		color: "#f2f1ea",
		source:
			"Chalk (calcium carbonate) 2.71 g/cm³ [CRC]: grains of about 2-10 µm, which clump into flocs of about 10-20 µm in tap water (provisional): filter paper keeps them, a coffee filter does not; its cake is tight (Kozeny-Carman with 5 µm grains): it filters slowly."
	}
}

/** Kozeny-Carman permeability of a bed of grains d m across at porosity e, m². */
export const kozenyCarman = (d: number, e: number) => (d * d * e * e * e) / (180 * (1 - e) * (1 - e))

export interface FilterSpec {
	/** The funnel's rim diameter, m (a lab funnel 7.5 cm). */
	readonly funnel: number
	readonly paper: Paper
	/** The mixture's water, m³, its temperature, °C. */
	readonly water: number
	readonly temperature: number
	readonly solid?: FilterSolid
	/** The undissolved solid in it, kg. */
	readonly solidMass: number
	/** What is dissolved in its water, kg (its own crystals beyond its solubility are kept on the paper with the solid: `crystals`, kg). */
	readonly dissolvedMass: number
	readonly crystals: number
	/** Poured from a cup at pourAt (run s) over pourFor (run s), pausing whenever the funnel is full. */
	readonly pourAt: number
	readonly pourFor: number
	/** Clean water poured through after the mixture has drained, m³ (it carries the dissolved salt the wet paper held). */
	readonly rinse: number
	readonly gravity: number
}

export class Filter {
	readonly spec: FilterSpec
	/** The funnel's capacity above the paper, m³, and its paper's resistance, 1/m. */
	readonly capacity: number
	readonly areaFull: number
	/** Liquid in the cup still to pour (the mixture's, then the rinse's), m³. */
	cup: number
	rinseLeft: number
	/** Free liquid above the paper, the liquid the paper and cake hold, what has run into the beaker, m³. */
	free = 0
	held = 0
	filtrate = 0
	/** Dissolved solute in the funnel's liquid (free + held) and in the beaker, kg; solids on the paper, in suspension, in the beaker, kg. */
	dissolvedIn = 0
	dissolvedOut = 0
	cake = 0
	suspended = 0
	through = 0
	/** Lesson seconds since the pour began, and the last step's flow into the beaker, m³/s. */
	clock = 0
	flow = 0
	private pouring = false
	private rinsing = false

	constructor(spec: FilterSpec) {
		this.spec = spec
		const hMax = FULL * spec.funnel
		this.capacity = CONE * hMax * hMax * hMax
		this.areaFull = ((Math.PI * hMax * hMax * TAN30) / COS30) * SHARE
		this.cup = spec.water
		this.rinseLeft = spec.rinse
	}

	/** Water the wet paper and its cake hold, m³. */
	holdCapacity() {
		const s = this.spec
		const k = s.funnel / 0.075
		const sol = s.solid
		const pores = sol !== undefined ? ((this.cake / sol.density) * sol.porosity) / (1 - sol.porosity) : 0
		return s.paper.holds * k * k + pores
	}

	/** The paper's and its cake's resistance to flow, 1/m. */
	resistance() {
		const s = this.spec
		const sol = s.solid
		let R = s.paper.resistance
		if (sol !== undefined && this.cake > 0 && s.paper.resistance > 0) {
			const thick = this.cake / sol.density / (1 - sol.porosity) / this.areaFull
			R += thick / kozenyCarman(sol.grain, sol.porosity)
		}
		return R
	}

	/** The drain's time constant, s of lesson time (V = V0·e^(−t/τ)). */
	tau() {
		const T = this.spec.temperature
		const mu = table(WATER_VISCOSITY, T)
		const rho = table(WATER_DENSITY, T)
		return Math.max(STEM, (SIN30 * mu * this.resistance()) / (SHARE * rho * Math.max(1e-3, this.spec.gravity)))
	}

	/** Whether the paper keeps the solid. */
	keeps() {
		const sol = this.spec.solid
		return sol !== undefined && sol.kept >= this.spec.paper.retention
	}

	/** The liquid's height above the cone's apex now, m. */
	level() {
		return this.free > 0 ? Math.pow(this.free / CONE, 1 / 3) : 0
	}

	/** One step: dt s of lesson time, the run's time now and its step (run s): the pour (paced by the cup and the room left), the drain. */
	step(dt: number, runTime: number, runStep: number) {
		const s = this.spec
		if (runTime >= s.pourAt) this.pouring = true
		if (this.pouring) this.clock += dt
		// the cup: the mixture, then (once it has drained) the rinse, poured at the same pace while there is room above the paper
		const rate = (s.water + s.rinse) / Math.max(0.05, s.pourFor)
		if (this.pouring && this.cup > 0) this.pour(Math.min(this.cup, rate * runStep), false)
		else if (this.pouring && this.cup <= 0 && this.rinseLeft > 0 && (this.rinsing || this.free < 2e-7)) {
			this.rinsing = true
			this.pour(Math.min(this.rinseLeft, rate * runStep), true)
		}
		// the paper and the cake take their water first
		const room = this.holdCapacity() - this.held
		if (room > 0 && this.free > 0) {
			const t = Math.min(room, this.free)
			this.free -= t
			this.held += t
		}
		// the drain: exact for the cone's exponential law over the step
		const before = this.free
		let after = before * Math.exp(-dt / this.tau())
		if (after < 1e-9 && this.cup <= 0) after = 0
		const out = before - after
		const liquid = this.free + this.held
		if (out > 0 && liquid > 0) {
			const share = out / liquid
			const d = this.dissolvedIn * share
			const sus = this.suspended * share
			this.dissolvedIn -= d
			this.dissolvedOut += d
			this.suspended -= sus
			this.through += sus
		}
		this.free = after
		this.filtrate += out
		this.flow = dt > 0 ? out / dt : 0
	}

	private pour(v: number, rinse: boolean) {
		const s = this.spec
		const add = Math.max(0, Math.min(v, this.capacity - this.free))
		if (add <= 0) return
		if (rinse) this.rinseLeft -= add
		else {
			this.cup -= add
			const share = s.water > 0 ? add / s.water : 0
			this.dissolvedIn += s.dissolvedMass * share
			const solids = s.solidMass * share
			// what the paper keeps settles onto it (the cake); a solid it does not keep stays in suspension and runs through with the water
			if (this.keeps()) this.cake += solids
			else this.suspended += solids
			this.cake += s.crystals * share
		}
		this.free += add
	}

	/** The solids on the paper, kg (the cake: the solid kept and any crystals the water could not dissolve). */
	kept() {
		return this.cake
	}
}

// ================================================================ evaporating
/** Ebullioscopic constant of water, K·kg/mol (CRC Handbook). */
const KB = 0.512
/** Molar mass of water, kg/mol. */
const M_WATER = 0.01801528
/** The dish's borosilicate glass: c 830 J/(kg·K) (Schott Borofloat 33 datasheet); emissivity 0.92 (Engineering ToolBox, emissivity of
 *  materials: smooth glass 0.92-0.94; the water's surface 0.96). */
const DISH_C = 830
const EMISSIVITY = 0.92
/** The share of a hot plate's power that reaches a small round dish on it (provisional: a flat pan on an electric coil takes about 70 %). */
export const PLATE_SHARE = 0.5
/** A hot plate's hottest surface, °C (a lab hot plate's top setting: about 350 °C). */
const PLATE_MAX = 350
/** Sunlight on a sunny windowsill, W/m² (clear-sky noon about 1000 W/m², a window passes about 75 %: provisional), and the share the water and a
 *  white dish absorb (provisional). */
export const SUN = 700
const SUN_ABSORBED = 0.35
/** The longest sub-step, s of lesson time, and the most sub-steps a step takes (a long step is cut into this many). */
const SUB = 2
const MOST_SUBS = 400

/**
 * Water activity of a salt (NaCl) solution of molality b (mol/kg): Robinson & Stokes (1959), Appendix 8.10, at 25 °C (a_w = e^(−2·b·M_w·φ)
 * from their osmotic coefficients; 0.753 when saturated, 6.15 mol/kg: the 75.3 % RH of Greenspan, J. Res. NBS 81A, 89, 1977).
 */
const SALT_ACTIVITY: readonly (readonly [number, number])[] = [
	[0, 1],
	[1, 0.9669],
	[2, 0.9316],
	[3, 0.8932],
	[4, 0.8515],
	[5, 0.8068],
	[6, 0.7598],
	[6.15, 0.7529]
]

export interface DishSpec {
	/** The dish's rim radius and depth, m (a spherical bowl), its mass, kg. */
	readonly rim: number
	readonly depth: number
	readonly dish: number
	/** Water, kg, at start °C; the solute (salt or sugar) and its mass, kg. */
	readonly water: number
	readonly start: number
	readonly solute: Solute
	readonly soluteMass: number
	/** "hot plate" (power W, PLATE_SHARE of it into the dish), "sun" (a sunny windowsill), "room" (the air only). */
	readonly heat: "hot plate" | "sun" | "room"
	readonly power: number
	/** The room's temperature, °C, and relative humidity, 0-1. */
	readonly room: number
	readonly humidity: number
}

export class Dish {
	readonly spec: DishSpec
	/** The bowl's sphere's radius, m. */
	readonly sphere: number
	water: number
	T: number
	dissolved: number
	crystals: number
	evaporated = 0
	boiled = 0
	/** Boiling now (the last step boiled water away), and the last step's water lost per s, kg/s. */
	boiling = false
	rate = 0
	clock = 0
	private h: number

	constructor(spec: DishSpec) {
		this.spec = spec
		this.sphere = (spec.rim * spec.rim + spec.depth * spec.depth) / (2 * spec.depth)
		this.water = Math.max(0, spec.water)
		this.T = spec.start
		this.dissolved = 0
		this.crystals = Math.max(0, spec.soluteMass)
		this.h = spec.depth / 2
		this.settle()
	}

	/** The liquid's volume, m³ (the water's and the dissolved salt's own volumes added: approximate). */
	volume() {
		return this.water / table(WATER_DENSITY, clamp(this.T, 0, 100)) + this.dissolved / this.spec.solute.density
	}

	/** The liquid's depth at the dish's middle, m (the spherical cap of its volume: Newton's method from the last depth). */
	level() {
		const V = this.volume()
		if (V <= 0) return 0
		const Rs = this.sphere
		const H = this.spec.depth
		let h = clamp(this.h, 1e-5, H)
		for (let i = 0; i < 8; i++) {
			const f = (Math.PI * h * h * (3 * Rs - h)) / 3 - V
			const d = Math.PI * (2 * Rs * h - h * h)
			if (!(d > 0)) break
			h = clamp(h - f / d, 1e-6, H)
		}
		this.h = h
		return h
	}

	/** The liquid's surface area, m² (the cap's circle). */
	surface() {
		const h = this.level()
		return h > 0 ? Math.PI * (2 * this.sphere * h - h * h) : 0
	}

	/** The solution's water activity (the dissolved solute lowers its vapour pressure). */
	activity() {
		if (this.water <= 0 || this.dissolved <= 0) return 1
		const s = this.spec.solute
		if (s.key === "salt") return table(SALT_ACTIVITY, this.dissolved / 0.05844 / this.water)
		// (sucrose, Norrish: a_w = x_w·e^(−6.47·x_s²), x the mole fractions)
		const ns = this.dissolved / 0.34230
		const nw = this.water / M_WATER
		const xs = ns / (ns + nw)
		return (1 - xs) * Math.exp(-6.47 * xs * xs)
	}

	/** The solution's boiling point, °C (100 + K_b·i·b; i = 2 for salt, 1 for sugar). */
	boilingPoint() {
		if (this.water <= 0 || this.dissolved <= 0) return 100
		const s = this.spec.solute
		const molar = s.key === "salt" ? 0.05844 : 0.3423
		const i = s.key === "salt" ? 2 : 1
		return 100 + (KB * i * (this.dissolved / molar)) / this.water
	}

	/** The solute dissolved up to its solubility at the dish's temperature; the rest is crystals (all of it once the water is gone). */
	private settle() {
		const all = this.dissolved + this.crystals
		const most = this.water > 0 ? solubility(this.spec.solute, clamp(this.T, 0, 100)) * this.water : 0
		this.dissolved = Math.min(all, most)
		this.crystals = all - this.dissolved
	}

	/** dt s of lesson time. */
	step(dt: number) {
		if (!(dt > 0)) return
		const n = Math.min(MOST_SUBS, Math.max(1, Math.ceil(dt / SUB)))
		const h = dt / n
		const lost0 = this.evaporated + this.boiled
		let boiled = false
		for (let k = 0; k < n; k++) boiled = this.sub(h) || boiled
		this.boiling = boiled
		this.rate = (this.evaporated + this.boiled - lost0) / dt
		this.clock += dt
	}

	private sub(h: number): boolean {
		const s = this.spec
		const Tr = s.room
		const A = this.water > 0 ? this.surface() : 0
		const Aout = 2 * Math.PI * this.sphere * s.depth * (s.heat === "hot plate" ? 0.5 : 1)
		const dT = this.T - Tr
		const L = Math.max(0.005, 2 * s.rim)
		const hc = naturalAir(dT, L, dT > 0 ? "rising" : "sinking")
		const Tk = this.T + KELVIN
		const Ek = Tr + KELVIN
		const hr = EMISSIVITY * SIGMA * (Tk * Tk + Ek * Ek) * (Tk + Ek)
		const loss = (hc + hr) * (A + Aout) * dT
		let gain = 0
		// (a hot plate's thermostat eases its power off over its last 10 K below its hottest)
		if (s.heat === "hot plate") gain = PLATE_SHARE * Math.max(0, s.power) * clamp((PLATE_MAX - this.T) / 10, 0, 1)
		else if (s.heat === "sun") gain = SUN * SUN_ABSORBED * Math.PI * s.rim * s.rim
		// evaporation from the surface (Chilton-Colburn, as the heat module's), never below zero
		let evap = 0
		if (this.water > 0 && A > 0) {
			const hm = Math.max(hc, STILL_AIR_MASS) / (AIR_RHO_CP * LEWIS_23)
			evap = Math.max(0, hm * A * (this.activity() * vaporDensity(Math.min(this.T, 150)) - s.humidity * vaporDensity(Tr)))
			evap = Math.min(evap, this.water / h)
		}
		const Lv = vaporization(this.T)
		// (the parts' heat capacities added: water 4184, salt 864 [CRC], sucrose 1250 J/(kg·K) (Engineering ToolBox), the glass)
		const C = this.water * 4184 + (this.dissolved + this.crystals) * (s.solute.key === "salt" ? 864 : 1250) + s.dish * DISH_C
		const net = gain - loss - evap * Lv
		const Tb = this.boilingPoint()
		let boiled = false
		this.water -= evap * h
		this.evaporated += evap * h
		// the heat warms the dish; past the solution's boiling point the heat left over boils water away and the temperature holds there
		let T1 = this.T + (net * h) / C
		if (this.water > 0 && T1 > Tb) {
			const m = Math.min(this.water, ((T1 - Tb) * C) / vaporization(Tb))
			this.water -= m
			this.boiled += m
			boiled = m > 0
			T1 = Tb
		}
		this.T = T1
		if (this.water < 1e-7) {
			this.evaporated += this.water
			this.water = 0
		}
		this.settle()
		return boiled
	}

	/** The solution's strength, % by mass. */
	strength() {
		return this.water + this.dissolved > 0 ? (100 * this.dissolved) / (this.water + this.dissolved) : 0
	}
}
