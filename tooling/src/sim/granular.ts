/**
 * Sand, gravel, pebbles, soil and flour: granular matter as a 2.5-D continuum (the granular module's physics; its process kinds are
 * tooling/src/sim/modules/granular.ts). Pure: no planck, no clocks, no randomness; only + − × ÷, sqrt, abs, min, max, floor, ceil, round,
 * sign and the engine's sin, cos, atan2, exp and pow (the same bits in node and in every browser).
 *
 * THE MODEL
 * - A bed is a grid of square columns over a rectangle of the floor (x along the machine plane, z front to back; z = 0 is the machine plane).
 *   Each column holds a packed thickness of grains (per grain class, well mixed in the column) on a floor (the top of the static solids under
 *   it, scanned at the start, or a vessel's inner shape). Cells whose floor stands above the bed's ceiling are walls; cells with no floor
 *   (off a table's edge) drop what reaches them as falling grains.
 * - Avalanches (depth-averaged granular flow with Coulomb friction, the shallow-flow model of Savage & Hutter 1989 [SH89] written as a
 *   staggered "virtual pipe" scheme [MEI07]): every face between two columns carries a velocity. A face at rest starts moving only where the
 *   surface is steeper than the material's static limit (tan of its angle of repose for dry grains; for damp grains Culmann's cohesive limit,
 *   below); a moving face accelerates by g × slope and is braked by g × μ (Coulomb friction, μ = tan(repose) at rest, rising with the
 *   flow's speed by the μ(I) rheology [JOP06]) until it stops. Only the material above
 *   the stable slope flows (its excess height across the face). So a pile poured from a point grows as a cone at its angle of repose, a dry
 *   tower slumps into a cone in about 3 √(H/g) [LUBE04], damp sand stands in walls (a sandcastle) up to Culmann's critical height.
 * - Cohesion of damp grains (capillary bridges [RUMPF58] [SCHEEL08] [PAKPOUR12]): a face of height H stands at any angle β with
 *   H ≤ H_c(β) = (4c/γ)·sin β·cos φ / (1 − cos(β − φ)) (Culmann's wedge [CULMANN1866], Terzaghi 1943 §61): vertical up to (4c/γ)·tan(45° + φ/2).
 *   The column's own thickness is taken as the face's height; a free column taller than its unconfined strength allows (2c·tan(45° + φ/2)/γ, a
 *   sandcastle's tower) crushes and its grains flow by friction alone.
 * - Outlets (a funnel's spout, an hourglass's neck): sand leaves at Beverloo's rate W = C·ρ_b·√g·(D − k·d)^{5/2}, C 0.58, k 1.4 [BEVERLOO61]
 *   [NEDDERMAN92], the same whatever the height of sand above (why an hourglass keeps time); an outlet narrower than 5 grains jams
 *   [ZURIGUEL05], and cohesive grains (damp sand, flour) arch over an outlet narrower than Jenike's B_c = 2.2·f_c/γ, f_c = 2c·tan(45° + φ/2)
 *   [JENIKE64].
 * - Falling grains are parcels (a few grams each) in free fall (a dense stream of grains falls nearly freely); they land on the first bed
 *   surface they cross and settle there a layer at a time, running down the heap they strike to where its face stands no steeper than a
 *   fresh heap's face can (Bed.rain).
 * - Bodies in sand (a ball dropped into a tray, a car on a beach): what a body's outline pushes below the surface is moved to the ring of
 *   columns around it (a crater's rim; a bulldozed heap in front), and the sand holds it up and brakes it with what it can bear: Terzaghi-
 *   Vesić bearing pressure N_q·γ·z + ½·N_γ·γ·B [VESIC73] (z its depth under the surrounding surface, B its width) plus an inertial drag
 *   ρ_b·v² (Katsuragi & Durian's force law: a friction growing with depth and a drag in v² [KD07]), never pulling it back up; sideways it
 *   meets Coulomb friction tan φ at its contact and Rankine's passive pressure ½·K_p·γ·z² ahead of it. Fast impacts throw a share of the
 *   displaced sand out as ejecta (a crater's splash and its wider rim). Checked against Uehara et al.'s crater laws [UEHARA03] in
 *   research/rw-validate-granular.ts.
 * - Running water on a bed (a stream table): shallow water in the same columns (the virtual pipe scheme [MEI07], Manning friction with
 *   Strickler's n = d^{1/6}/21.1 [CHOW59]); the bed shear stress τ = ρ·g·n²·u²/h^{1/3}, Shields' number θ = τ/((ρ_s − ρ)·g·d) against its
 *   critical value (Soulsby & Whitehouse [SOULSBY97]); the load the flow can carry by Wong & Parker's correction of Meyer-Peter & Müller,
 *   q* = 3.97·(θ − θ_c)^{3/2}·√((s − 1)·g·d³) [WP06]; grains picked up or let fall toward that load over the time they take to settle
 *   through the water (Ferguson & Church's settling velocity [FC04]); carried with the water; the bed rises and falls by what is let fall
 *   and picked up (Exner). Time-lapse (scene settings.time_lapse) speeds the bed's change by that factor while the water runs in real time
 *   (the morphological acceleration factor of coastal and river models [ROELVINK06]). Where water stands on grains they are soaked: no
 *   cohesion, and they stand only up to the soaked angle (banks slump into the channel).
 *
 * SOURCES
 *   [WENTWORTH22] Wentworth C.K., A scale of grade and class terms for clastic sediments, J. Geol. 30, 377-392 (1922).
 *   [ETB-REPOSE] Engineering ToolBox, "Angle of Repose" (2008): sand dry 34°, wet 45°, water filled 15-30°; earth 30-45°; gravel 30-45°;
 *                wheat flour 45°.
 *   [ETB-BULK] Engineering ToolBox, "Dry bulk densities": sand dry ≈ 1600 kg/m³, gravel ≈ 1500-1700, wheat flour 593, topsoil ≈ 1100-1400.
 *   [CRC] CRC Handbook of Chemistry and Physics, 97th ed.: quartz 2650 kg/m³.
 *   [FREEZE79] Freeze R.A. & Cherry J.A., Groundwater (1979), Table 2.4: porosity of sand 0.25-0.50, gravel 0.25-0.40, silt 0.35-0.50.
 *   [AH18] Al-Hashemi H.M.B. & Al-Amoudi O.S.B., A review on the angle of repose of granular materials, Powder Technol. 330, 397-417 (2018).
 *   [SH89] Savage S.B. & Hutter K., The motion of a finite mass of granular material down a rough incline, J. Fluid Mech. 199, 177-215 (1989).
 *   [MEI07] Mei X., Decaudin P., Hu B.-G., Fast hydraulic erosion simulation and visualization on GPU, Pacific Graphics (2007).
 *   [LUBE04] Lube G., Huppert H.E., Sparks R.S.J., Hallworth M.A., Axisymmetric collapses of granular columns, J. Fluid Mech. 508,
 *            175-199 (2004); Lajeunesse E., Mangeney-Castelnau A., Vilotte J.P., Phys. Fluids 16, 2371 (2004).
 *   [CULMANN1866] Culmann K., Die graphische Statik (1866); Terzaghi K., Theoretical Soil Mechanics (1943) §61.
 *   [RUMPF58] Rumpf H., Grundlagen und Methoden des Granulierens, Chem. Ing. Tech. 30, 144-158 (1958).
 *   [SCHEEL08] Scheel M. et al., Morphological clues to wet granular pile stability, Nature Mater. 7, 189-193 (2008).
 *   [PAKPOUR12] Pakpour M., Habibi M., Møller P., Bonn D., How to construct the perfect sandcastle, Sci. Rep. 2, 549 (2012).
 *   [BEVERLOO61] Beverloo W.A., Leniger H.A., van de Velde J., The flow of granular solids through orifices, Chem. Eng. Sci. 15, 260 (1961).
 *   [NEDDERMAN92] Nedderman R.M., Statics and Kinematics of Granular Materials, Cambridge (1992), ch. 10: C ≈ 0.58, k ≈ 1.4.
 *   [ZURIGUEL05] Zuriguel I. et al., Jamming during the discharge of granular matter from a silo, Phys. Rev. E 71, 051303 (2005): the
 *                mean avalanche between jams diverges at an outlet of ≈ 4.94 grain diameters.
 *   [JENIKE64] Jenike A.W., Storage and flow of solids, Bull. 123, Utah Eng. Exp. Station (1964).
 *   [VESIC73] Vesić A.S., Analysis of ultimate loads of shallow foundations, J. Soil Mech. Found. Div. 99, 45-73 (1973):
 *             N_q = e^{π tan φ}·tan²(45° + φ/2), N_γ = 2(N_q + 1)·tan φ.
 *   [KD07] Katsuragi H. & Durian D.J., Unified force law for granular impact cratering, Nature Phys. 3, 420-423 (2007).
 *   [UEHARA03] Uehara J.S., Ambroso M.A., Ojha R.P., Durian D.J., Low-speed impact craters in loose granular media, Phys. Rev. Lett. 90,
 *              194301 (2003): penetration d = (0.14/μ)·(ρ_b/ρ_g)^{1/2}·D_b^{2/3}·H^{1/3}, crater D_c = 0.90·(ρ_b/(ρ_g μ²))^{1/4}·D_b^{3/4}·H^{1/4}.
 *   [CHOW59] Chow V.T., Open-Channel Hydraulics (1959): Manning's n; Strickler's n = d^{1/6}/21.1.
 *   [SOULSBY97] Soulsby R.L. & Whitehouse R.J.S., Threshold of sediment motion in coastal environments, Pacific Coasts and Ports (1997):
 *               θ_c = 0.30/(1 + 1.2 D*) + 0.055·(1 − e^{−0.020 D*}), D* = d·((s − 1)g/ν²)^{1/3}.
 *   [WP06] Wong M. & Parker G., Reanalysis and correction of bed-load relation of Meyer-Peter and Müller, J. Hydraul. Eng. 132, 1159 (2006).
 *   [FC04] Ferguson R.I. & Church M., A simple universal equation for grain settling velocity, J. Sediment. Res. 74, 933-937 (2004).
 *   [ROELVINK06] Roelvink J.A., Coastal morphodynamic evolution techniques, Coastal Eng. 53, 277-287 (2006).
 *   [JNB96] Jaeger H.M., Nagel S.R., Behringer R.P., Granular solids, liquids, and gases, Rev. Mod. Phys. 68, 1259-1273 (1996): a heap's
 *           surface stands up to its angle of maximum stability, a few degrees over the angle of repose it relaxes to after an avalanche.
 *   [JOP06] Jop P., Forterre Y., Pouliquen O., A constitutive law for dense granular flows, Nature 441, 727-730 (2006): μ(I) = μ_s +
 *           (μ_2 − μ_s)/(I₀/I + 1), μ_2 − μ_s ≈ 0.26, I₀ ≈ 0.279; depth-averaged I = 5ud/(2h√(gh)) (GDR MiDi, Eur. Phys. J. E 14, 341 (2004)).
 *   [FISCHENICH01] Fischenich C., Stability thresholds for stream restoration materials, ERDC TN-EMRRP-SR-29 (2001): bare fine soils
 *                  0.1-2.5 Pa; grass-covered banks 15-170 Pa.
 *   [WU79] Wu T.H., McKinnell W.P., Swanston D.N., Soil strength and root reinforcement, Can. Geotech. J. 16, 19-33 (1979): roots add
 *          cohesion to the soil they grow in (a planted bank does not slump when wet).
 *   The kitchen grains (sugar, salt, rice; 2026-10-20):
 *   [SANTOS17] Santos D. et al., J. Food Process Eng. 40 (2017): granulated sugar D50 537 µm. [ETB-BULK] also: granulated sugar 800 kg/m³,
 *              clean rice 770 kg/m³ (Engineering ToolBox, "Foods and materials: bulk density"). [ETB-REPOSE] also: sugar (granulated), salt
 *              (fine and coarse) and rice 30-45°. [SALT-SPEC] a fine table salt's specification: bulk density 1100-1300 kg/m³ (EN 1236).
 *              [SALT-PAT] US patent 8,770,500: cubic common salt's angle of repose 24.8° (a free-flowing grade). [USDA] rice kernel density
 *              about 1.45 g/cm³. [SCIAM-REPOSE] Scientific American, "Slippery slopes, and the angle of repose": rice about 25-30°, salt
 *              steeper, powdered sugar over 40° in classroom piles.
 * CONTAINERS (2026-10-20): a jar, a cup, a beaker or a box that grains are poured into holds them (a `holder` of a sand region: its inside as
 * the floor, its walls a ring of wall columns front and back as well as left and right, so the 2.5-D bed has the round or square walls the
 * side view's solids lack); a cup a hand tips pours its grains over its lip once their surface stands steeper than their angle of repose
 * (TipCup, below).
 */

// ---------------------------------------------------------------- grains

/** A granular material: its grains, its packing and how it stands. Lengths m, densities kg/m³, angles degrees, stresses Pa. */
export interface Grain {
	readonly key: string
	readonly name: string
	/** Median grain diameter, m. */
	readonly d: number
	/** Grain (solid) density, kg/m³. */
	readonly rhoS: number
	/** Porosity of the loose packed bed (the share of its volume that is pores). */
	readonly porosity: number
	/** Angle of repose of the dry material, degrees (its internal friction φ for the cohesive limit too). */
	readonly repose: number
	/** Dry cohesion, Pa (a fine powder's: flour). */
	readonly cohesionDry: number
	/** Damp cohesion, Pa (capillary bridges in moist grains: what makes a sandcastle stand). */
	readonly cohesionDamp: number
	/** Angle of repose soaked (pores full of water), degrees. */
	readonly reposeSoaked: number
	/** Extra critical shear stress a cohesive bed resists erosion with, Pa (soil). */
	readonly tauCohesive: number
	/** The narrowest outlet the dry grains pour through by their own cohesion (a powder's arch, m; 0: none beyond the 5-grain jam). */
	readonly arch: number
	readonly color: string
	readonly source: string
}

export const GRAINS: Readonly<Record<string, Grain>> = {
	"fine sand": {
		key: "fine sand",
		name: "fine sand",
		d: 0.00018,
		rhoS: 2650,
		porosity: 0.42,
		repose: 32,
		cohesionDry: 0,
		cohesionDamp: 1400,
		reposeSoaked: 22,
		tauCohesive: 0,
		arch: 0,
		color: "#e6d3a3",
		source: "Fine quartz sand 0.125-0.25 mm [WENTWORTH22] (0.18 mm), 2650 kg/m³ [CRC], porosity 0.42 [FREEZE79]: about 1540 kg/m³ dry; angle of repose 30-34° dry [AH18], 15-30° water filled [ETB-REPOSE]; damp cohesion about 1.4 kPa (capillary bridges: ∝ 1/d [RUMPF58]; provisional)."
	},
	sand: {
		key: "sand",
		name: "sand",
		d: 0.0004,
		rhoS: 2650,
		porosity: 0.4,
		repose: 34,
		cohesionDry: 0,
		cohesionDamp: 1000,
		reposeSoaked: 25,
		tauCohesive: 0,
		arch: 0,
		color: "#d9b97c",
		source: "Medium quartz sand 0.25-0.5 mm [WENTWORTH22] (0.4 mm), 2650 kg/m³ [CRC], porosity 0.40 [FREEZE79]: 1590 kg/m³ dry (about 1600 [ETB-BULK]); angle of repose 34° dry, 15-30° water filled [ETB-REPOSE]; damp cohesion about 1 kPa (capillary bridges [RUMPF58]; wet granulates' yield stress is of order 1 kPa [SCHEEL08]; a free damp tower stands to about 23 cm: provisional)."
	},
	"coarse sand": {
		key: "coarse sand",
		name: "coarse sand",
		d: 0.001,
		rhoS: 2650,
		porosity: 0.38,
		repose: 35,
		cohesionDry: 0,
		cohesionDamp: 400,
		reposeSoaked: 28,
		tauCohesive: 0,
		arch: 0,
		color: "#c8a26a",
		source: "Coarse quartz sand 0.5-1 mm and very coarse 1-2 mm [WENTWORTH22] (1 mm), 2650 kg/m³, porosity 0.38 [FREEZE79]; repose about 35° [AH18]; damp cohesion about 0.4 kPa (∝ 1/d [RUMPF58], provisional)."
	},
	gravel: {
		key: "gravel",
		name: "gravel",
		d: 0.006,
		rhoS: 2650,
		porosity: 0.38,
		repose: 38,
		cohesionDry: 0,
		cohesionDamp: 30,
		reposeSoaked: 34,
		tauCohesive: 0,
		arch: 0,
		color: "#9b948a",
		source: "Fine (pea) gravel 4-8 mm [WENTWORTH22] (6 mm), 2650 kg/m³, porosity 0.38 [FREEZE79]: about 1640 kg/m³ (1500-1700 [ETB-BULK]); repose 35-40° rounded, up to 45° crushed [ETB-REPOSE] [AH18]; almost no cohesion when damp."
	},
	pebbles: {
		key: "pebbles",
		name: "pebbles",
		d: 0.02,
		rhoS: 2650,
		porosity: 0.38,
		repose: 40,
		cohesionDry: 0,
		cohesionDamp: 0,
		reposeSoaked: 38,
		tauCohesive: 0,
		arch: 0,
		color: "#8a8178",
		source: "Pebbles 4-64 mm [WENTWORTH22] (20 mm), 2650 kg/m³, porosity 0.38 [FREEZE79]; repose about 40° [AH18]."
	},
	soil: {
		key: "soil",
		name: "soil",
		d: 0.00005,
		rhoS: 2600,
		porosity: 0.5,
		repose: 35,
		cohesionDry: 0,
		cohesionDamp: 2000,
		reposeSoaked: 20,
		tauCohesive: 0.8,
		arch: 0.015,
		color: "#6e5136",
		source: "Garden soil (silt loam, median about 0.05 mm) 2600 kg/m³ grains, porosity 0.50 [FREEZE79]: about 1300 kg/m³ (topsoil 1100-1400 [ETB-BULK]); loose earth 30-45° [ETB-REPOSE] (35°); dry it arches over a spout narrower than about 1.5 cm; damp cohesion about 2 kPa, soaked mud about 20° (provisional); resists running water as a cohesive bed, about 0.8 Pa more [FISCHENICH01]."
	},
	flour: {
		key: "flour",
		name: "flour",
		d: 0.00005,
		rhoS: 1450,
		porosity: 0.59,
		repose: 45,
		cohesionDry: 0,
		cohesionDamp: 0,
		reposeSoaked: 45,
		tauCohesive: 0,
		arch: 0.02,
		color: "#f3eee2",
		source: "Wheat flour: particles 10-100 µm (50), about 1450 kg/m³; poured bulk 593 kg/m³ [ETB-BULK] (porosity 0.59); repose 45° [ETB-REPOSE]; a cohesive powder: it arches over a spout narrower than about 2 cm [JENIKE64] (provisional). The classroom crater medium."
	},
	// (the kitchen grains, after the others: the keyframes' grain indices of the first seven stay as they were)
	sugar: {
		key: "sugar",
		name: "sugar",
		d: 0.0005,
		rhoS: 1587,
		porosity: 0.4959,
		repose: 35,
		cohesionDry: 0,
		cohesionDamp: 800,
		reposeSoaked: 25,
		tauCohesive: 0,
		arch: 0,
		color: "#f7f5ee",
		source: "Granulated white sugar: crystals about 0.5 mm (D50 0.54 mm [SANTOS17]), sucrose 1587 kg/m³ [CRC]; poured bulk 800 kg/m³ [ETB-BULK] (porosity 0.50); angle of repose 30-45° [ETB-REPOSE] (35° used, provisional within it); damp it cakes (cohesion as damp sand's, ∝ 1/d [RUMPF58], provisional); soaked it would dissolve (not modelled: it slumps as soaked sand does)."
	},
	salt: {
		key: "salt",
		name: "salt",
		d: 0.0004,
		rhoS: 2165,
		porosity: 0.4457,
		repose: 32,
		cohesionDry: 0,
		cohesionDamp: 1000,
		reposeSoaked: 25,
		tauCohesive: 0,
		arch: 0,
		color: "#f4f4f2",
		source: "Table salt: sodium chloride cubes about 0.3-0.5 mm (0.4 mm), 2165 kg/m³ [CRC]; fine table salt's bulk 1100-1300 kg/m³ [SALT-SPEC] (1200 used: porosity 0.45); angle of repose 30-45° for fine salt [ETB-REPOSE], 25° for free-flowing cubic salt [SALT-PAT] (32° used, provisional); damp it cakes (provisional); soaked it would dissolve (not modelled)."
	},
	rice: {
		key: "rice",
		name: "rice",
		d: 0.0028,
		rhoS: 1450,
		porosity: 0.469,
		repose: 32,
		cohesionDry: 0,
		cohesionDamp: 140,
		reposeSoaked: 28,
		tauCohesive: 0,
		arch: 0,
		color: "#f1ebdc",
		source: "Long-grain white rice: kernels about 6.6 × 2.0 × 1.6 mm (their equal-volume sphere 2.8 mm, the size Beverloo's rate and the 5-grain jam use: provisional for long grains, whose shape changes how they arch [ZURIGUEL05]), kernel density 1450 kg/m³ [USDA]; clean rice's bulk 770 kg/m³ [ETB-BULK] (porosity 0.47); angle of repose 30-45° [ETB-REPOSE], 25-35° in classroom piles [SCIAM-REPOSE] (32° used, provisional)."
	}
}
export const GRAIN_KEYS = Object.keys(GRAINS)

export type Wetness = "dry" | "damp" | "soaked"
export const WETNESS: readonly Wetness[] = ["dry", "damp", "soaked"]
/** Water in a damp bed, by its volume (about 5 % by mass: a sandcastle's), and in a soaked one (its pores full). */
export const DAMP_WATER = 0.08

/** kg/m³: water at 20 °C. */
export const RHO_WATER = 998.2
/** Pa·s / (kg/m³): water's kinematic viscosity at 20 °C, m²/s. */
export const NU_WATER = 1.0e-6
const DEG = Math.PI / 180

/** Bulk density of a packed bed of these grains, kg/m³ (with its water: damp or soaked). */
export const bulkDensity = (g: Grain, wet: Wetness = "dry") =>
	g.rhoS * (1 - g.porosity) + (wet === "damp" ? RHO_WATER * Math.min(DAMP_WATER, g.porosity) : wet === "soaked" ? RHO_WATER * g.porosity : 0)

/** Cohesion of a bed of these grains, Pa. */
export const cohesionOf = (g: Grain, wet: Wetness) => (wet === "damp" ? g.cohesionDamp : wet === "soaked" ? 0 : g.cohesionDry)
/** Friction angle (the angle of repose), degrees. */
export const frictionOf = (g: Grain, wet: Wetness) => (wet === "soaked" ? g.reposeSoaked : g.repose)

/**
 * Culmann's critical height of a cohesive face at angle β (rad) (the wedge analysis [CULMANN1866]): H_c = (4c/γ)·sin β·cos φ/(1 − cos(β − φ)).
 * Infinite at β ≤ φ (a slope at the friction angle stands at any height); 0 without cohesion.
 */
export const culmannHeight = (c: number, gamma: number, phi: number, beta: number) => {
	if (beta <= phi + 1e-9) return Number.POSITIVE_INFINITY
	if (c <= 0) return 0
	return ((4 * c) / gamma) * ((Math.sin(beta) * Math.cos(phi)) / (1 - Math.cos(beta - phi)))
}

/** The steepest a face can stand: a table of tan β by the face's height, for one material and wetness (β from 90° down to φ). */
export class StandTable {
	readonly tanPhi: number
	readonly vertical: number
	private readonly heights: Float64Array
	private readonly tans: Float64Array
	/** tan of a vertical face: steep enough that no face between two columns is steeper (89.5°). */
	static readonly STEEP = 114.6
	constructor(c: number, gamma: number, phiDeg: number) {
		const phi = phiDeg * DEG
		this.tanPhi = Math.sin(phi) / Math.cos(phi)
		const n = 90
		this.heights = new Float64Array(n + 1)
		this.tans = new Float64Array(n + 1)
		// (β from 90° down to φ in n steps: H_c grows as β falls)
		for (let k = 0; k <= n; k++) {
			const beta = Math.PI / 2 - ((Math.PI / 2 - phi) * k) / n
			this.heights[k] = culmannHeight(c, gamma, phi, beta)
			this.tans[k] = k === 0 ? StandTable.STEEP : Math.sin(beta) / Math.cos(beta)
		}
		this.tans[n] = this.tanPhi
		this.vertical = this.heights[0] as number
		if (this.vertical > 0) {
			// (the lookup: from the vertical height to 8 times it; the first entry just past vertical is the bisection's)
			this.lutScale = 255 / (7 * this.vertical)
			for (let k = 0; k < 256; k++) this.lut[k] = this.slowTan(this.vertical + k / this.lutScale + (k === 0 ? 1e-12 : 0))
		}
	}
	/** tan of the steepest angle a face of height H stands at (a table of 256 heights up to 8 × the vertical height, linear between; beyond it
	 *  the bisection below). */
	tanFor(H: number): number {
		if (!(this.vertical > 0)) return this.tanPhi
		if (H <= this.vertical) return StandTable.STEEP
		const u = (H - this.vertical) * this.lutScale
		if (u < 255) {
			const k = Math.floor(u)
			const f = u - k
			return (this.lut[k] as number) + ((this.lut[k + 1] as number) - (this.lut[k] as number)) * f
		}
		return this.slowTan(H)
	}
	private readonly lut = new Float64Array(256)
	private lutScale = 0
	private slowTan(H: number): number {
		const n = this.heights.length - 1
		// the first k (β falling) whose H_c(β) ≥ H, by bisection (H_c rises with k)
		let lo = 0
		let hi = n
		while (hi - lo > 1) {
			const mid = (lo + hi) >> 1
			if ((this.heights[mid] as number) >= H) hi = mid
			else lo = mid
		}
		const h0 = this.heights[lo] as number
		const h1 = this.heights[hi] as number
		const t0 = this.tans[lo] as number
		const t1 = this.tans[hi] as number
		if (!Number.isFinite(h1)) return t1
		const u = h1 > h0 ? (H - h0) / (h1 - h0) : 1
		return t0 + (t1 - t0) * Math.min(1, Math.max(0, u))
	}
}

/** Beverloo's discharge through a round outlet of diameter D, m³ of packed bed per second (0 when it jams or arches). */
export const beverlooRate = (g: Grain, wet: Wetness, D: number, gravity: number) => {
	if (!(D > 0) || !(gravity > 0)) return 0
	if (D < jamDiameter(g, wet)) return 0
	const w = D - 1.4 * g.d
	return w > 0 ? 0.58 * Math.sqrt(gravity) * Math.pow(w, 2.5) : 0
}

/** The narrowest outlet these grains pour through, m: 5 grains [ZURIGUEL05], or a cohesive arch's span [JENIKE64]. */
export const jamDiameter = (g: Grain, wet: Wetness) => {
	const c = cohesionOf(g, wet)
	const phi = frictionOf(g, wet) * DEG
	const gamma = bulkDensity(g, wet) * 9.81
	const fc = 2 * c * tan45(phi)
	return Math.max(5 * g.d, (2.2 * fc) / gamma, wet === "dry" ? g.arch : 0)
}

/** tan(45° + φ/2) (φ rad), from the engine's sin and cos. */
export const tan45 = (phi: number) => Math.sin(Math.PI / 4 + phi / 2) / Math.cos(Math.PI / 4 + phi / 2)

/** Vesić's bearing capacity factors for friction angle φ (rad): {nq, ngamma} [VESIC73]. */
export const bearingFactors = (phi: number) => {
	const t = tan45(phi)
	const tp = Math.sin(phi) / Math.cos(phi)
	const nq = Math.exp(Math.PI * tp) * t * t
	return { nq, ngamma: 2 * (nq + 1) * tp }
}

/** Rankine's passive earth pressure coefficient K_p = tan²(45° + φ/2). */
export const passiveK = (phi: number) => {
	const t = tan45(phi)
	return t * t
}

/** Ferguson & Church's settling velocity in water, m/s (natural grains: C1 18, C2 1.0) [FC04]. */
export const settlingVelocity = (g: Grain) => {
	const R = g.rhoS / RHO_WATER - 1
	const d = g.d
	return (R * 9.81 * d * d) / (18 * NU_WATER + Math.sqrt(0.75 * 1.0 * R * 9.81 * d * d * d))
}

/** Soulsby & Whitehouse's critical Shields number for these grains in water [SOULSBY97]. */
export const criticalShields = (g: Grain) => {
	const R = g.rhoS / RHO_WATER - 1
	const dStar = g.d * Math.pow((R * 9.81) / (NU_WATER * NU_WATER), 1 / 3)
	return 0.3 / (1 + 1.2 * dStar) + 0.055 * (1 - Math.exp(-0.02 * dStar))
}

/** Wong & Parker's bed load (MPM corrected): m² of grains (solid) per second per metre of width at Shields number θ [WP06]. */
export const bedLoad = (g: Grain, theta: number, thetaC: number) => {
	const ex = theta - thetaC
	if (!(ex > 0)) return 0
	const R = g.rhoS / RHO_WATER - 1
	return 3.97 * ex * Math.sqrt(ex) * Math.sqrt(R * 9.81 * g.d * g.d * g.d)
}

/** Strickler's Manning n for a bed of these grains (at least 0.012, a smooth sand flume's) [CHOW59]. */
export const manningN = (g: Grain) => Math.max(0.012, Math.pow(g.d, 1 / 6) / 21.1)

// ---------------------------------------------------------------- beds

/** How fast a column may sink, × √(g·h) (calibrated on Lube et al.'s collapse times, research/rw-validate-granular.ts "collapse"). */
const SINK = 1.0

/** A grain class in a bed: its grains, wetness, and what follows from them. */
export interface ClassInfo {
	readonly grain: Grain
	readonly wet: Wetness
	/** Bulk density, kg/m³ (grains and their water). */
	readonly rhoB: number
	readonly tanRepose: number
	readonly tanSoaked: number
	readonly stand: StandTable
	readonly standSoaked: StandTable
	/** Settling velocity in water, m/s; critical Shields number. */
	readonly settle: number
	readonly thetaC: number
	/** m: a free column of damp grains taller than this crushes under its own weight (its unconfined strength 2c·tan(45° + φ/2) over γ): its
	 *  grains then flow by their friction alone. Infinite without cohesion. */
	readonly crush: number
}

export const classInfo = (grain: Grain, wet: Wetness, gravity: number): ClassInfo => {
	const phi = frictionOf(grain, wet)
	const g = Math.max(0.1, gravity)
	const soakedPhi = grain.reposeSoaked
	return {
		grain,
		wet,
		rhoB: bulkDensity(grain, wet),
		tanRepose: Math.sin(phi * DEG) / Math.cos(phi * DEG),
		tanSoaked: Math.sin(soakedPhi * DEG) / Math.cos(soakedPhi * DEG),
		stand: new StandTable(cohesionOf(grain, wet), bulkDensity(grain, wet) * g, phi),
		standSoaked: new StandTable(0, bulkDensity(grain, "soaked") * g, soakedPhi),
		settle: settlingVelocity(grain),
		thetaC: criticalShields(grain),
		crush: cohesionOf(grain, wet) > 0 ? (2 * cohesionOf(grain, wet) * tan45(phi * DEG)) / (bulkDensity(grain, wet) * g) : Number.POSITIVE_INFINITY
	}
}

/** A falling parcel of grains (m, m/s; vol m³ of packed grains of class k of the bed it came from, or of `grain`). */
export interface Parcel {
	x: number
	y: number
	z: number
	vx: number
	vy: number
	vz: number
	vol: number
	/** The grain's key (GRAINS) and wetness. */
	grain: string
	wet: Wetness
	age: number
	/** The bed it must not land in (an outlet's own vessel: it starts below that floor). */
	skip?: string
	/** The item that poured it (a tipped cup's: where its stream comes down is that item's lands_x). */
	src?: string
}

/** Columns that a layer of landing grains runs down at most (Bed.rain): more than a heap's flank has. */
const ROLL = 64
/** tan 3°: a freshly landed heap's face stands up to its angle of maximum stability, a few degrees over its angle of repose, before it
 *  slides [JNB96] (Bed.rain); the bed's avalanches then bring it back to repose. */
const TAN_STABLE = 0.052407779283041196
/** The four steps from a column to its neighbours (Bed.rain goes round them in turn). */
const STEPS4 = [
	[1, 0],
	[0, 1],
	[-1, 0],
	[0, -1]
] as const

/** An outlet in a bed's floor (a spout, a neck): its cells, its diameter, where its grains leave, and when it opens. */
export interface Outlet {
	readonly id: string
	readonly item: string
	readonly cells: readonly number[]
	readonly diameter: number
	readonly x: number
	readonly y: number
	readonly z: number
	readonly opensAt: number
	/** m³ (packed) let out so far, and waiting to leave as one parcel; per class. */
	out: number
	readonly pending: number[]
	/** Mass (kg) let out so far. */
	outMass: number
	/** Whether it jams now (grains too big or too sticky for it), and whether it ever has. */
	jammed: boolean
	everJammed: boolean
	/** Whether the heap under it has reached it (it chokes). */
	choked: boolean
	/** m³/s of packed grains now (over the last 0.1 s). */
	rate: number
	/** kg/s now. */
	massRate: number
}

/**
 * One bed: a grid of columns. Cells c = j·nx + i, centre at (x0 + (i + ½)dx, z0 + (j + ½)dx). x-faces between (i, j) and (i + 1, j): j·(nx − 1) + i;
 * z-faces between (i, j) and (i, j + 1): j·nx + i.
 */
export class Bed {
	readonly id: string
	readonly owner: string
	readonly x0: number
	readonly z0: number
	readonly dx: number
	readonly nx: number
	readonly nz: number
	readonly n: number
	readonly floor: Float64Array
	/** 0: holds grains; 1: a wall (holds none, nothing flows into it); 2: an edge (grains reaching it fall off). */
	readonly kind: Uint8Array
	readonly classes: readonly ClassInfo[]
	/** Thickness of each class, m (one array per class). */
	readonly hk: Float64Array[]
	/** Total thickness, m. */
	readonly h: Float64Array
	/** The thickness at the start, m (readings compare with it). */
	readonly h0: Float64Array
	/** 1 where the grains are soaked (water stands or stood on them). */
	readonly soaked: Uint8Array
	readonly ux: Float64Array
	readonly uz: Float64Array
	readonly ceiling: number
	readonly gravity: number
	readonly outlets: Outlet[] = []
	/** Volume (m³ packed) that left by its edges as falling grains; that fell in as parcels. */
	dropped = 0
	landed = 0
	/** The mass (kg) of what left by its edges (each class at its bulk density): a container's readings count it outside the container. */
	droppedMass = 0
	/** Parcels to launch (its edges' spill), collected by the world. */
	readonly spill: Parcel[] = []
	water: Water | undefined
	/** The cells that may change (inclusive), or i0 > i1 when the bed is at rest. */
	i0 = 0
	i1 = -1
	j0 = 0
	j1 = -1
	/** The largest face speed of the last step, m/s. */
	fastest = 0
	/** Whether any cell is an edge. */
	hasEdges = false
	/** tan(repose) when the bed holds one class without cohesion (its limits are the same everywhere dry), else null; its grain size. */
	private plain: number | null = null
	private plainD = 0.0004
	// scratch
	private readonly H: Float64Array
	private readonly fxv: Float64Array
	private readonly fzv: Float64Array
	private readonly outSum: Float64Array
	private readonly moved: Float64Array
	private lStand = 0
	private lMove = 0
	constructor(o: {
		id: string
		owner: string
		x0: number
		z0: number
		dx: number
		nx: number
		nz: number
		floor: Float64Array
		kind: Uint8Array
		classes: readonly ClassInfo[]
		ceiling: number
		gravity: number
	}) {
		this.id = o.id
		this.owner = o.owner
		this.x0 = o.x0
		this.z0 = o.z0
		this.dx = o.dx
		this.nx = o.nx
		this.nz = o.nz
		this.n = o.nx * o.nz
		this.floor = o.floor
		this.kind = o.kind
		this.classes = o.classes
		this.ceiling = o.ceiling
		this.gravity = o.gravity
		this.hk = o.classes.map(() => new Float64Array(this.n))
		this.h = new Float64Array(this.n)
		this.h0 = new Float64Array(this.n)
		this.soaked = new Uint8Array(this.n)
		this.ux = new Float64Array(Math.max(0, (o.nx - 1) * o.nz))
		this.uz = new Float64Array(Math.max(0, o.nx * (o.nz - 1)))
		this.H = new Float64Array(this.n)
		this.fxv = new Float64Array(this.ux.length)
		this.fzv = new Float64Array(this.uz.length)
		this.outSum = new Float64Array(this.n)
		this.moved = new Float64Array(o.classes.length)
		for (let c = 0; c < this.n; c++) if ((o.kind[c] as number) === 2) this.hasEdges = true
		const only = o.classes.length === 1 ? (o.classes[0] as ClassInfo) : null
		if (only !== null && !(only.stand.vertical > 0)) {
			this.plain = only.tanRepose
			this.plainD = only.grain.d
		}
		this.wake(0, this.nx - 1, 0, this.nz - 1)
	}
	cx(i: number) {
		return this.x0 + (i + 0.5) * this.dx
	}
	cz(j: number) {
		return this.z0 + (j + 0.5) * this.dx
	}
	/** The cell holding world (x, z), or -1. */
	cellAt(x: number, z: number) {
		const i = Math.floor((x - this.x0) / this.dx)
		const j = Math.floor((z - this.z0) / this.dx)
		if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return -1
		return j * this.nx + i
	}
	surface(c: number) {
		return (this.floor[c] as number) + (this.h[c] as number)
	}
	/** Marks cells i0..i1, j0..j1 (and two around) as able to change. */
	wake(i0: number, i1: number, j0: number, j1: number) {
		const a = Math.max(0, i0 - 2)
		const b = Math.min(this.nx - 1, i1 + 2)
		const c = Math.max(0, j0 - 2)
		const d = Math.min(this.nz - 1, j1 + 2)
		if (this.i0 > this.i1) {
			this.i0 = a
			this.i1 = b
			this.j0 = c
			this.j1 = d
			return
		}
		this.i0 = Math.min(this.i0, a)
		this.i1 = Math.max(this.i1, b)
		this.j0 = Math.min(this.j0, c)
		this.j1 = Math.max(this.j1, d)
	}
	wakeCell(c: number) {
		const i = c % this.nx
		const j = (c - i) / this.nx
		this.wake(i, i, j, j)
	}
	get resting() {
		return this.i0 > this.i1
	}
	/** Adds a packed volume (m³) of class k to cell c. */
	add(c: number, k: number, vol: number) {
		if (!(vol > 0) || c < 0 || c >= this.n) return
		const dh = vol / (this.dx * this.dx)
		const a = this.hk[k] as Float64Array
		a[c] = (a[c] as number) + dh
		this.h[c] = (this.h[c] as number) + dh
		this.wakeCell(c)
	}
	/** Removes up to dh of thickness from cell c, every class alike; returns the volumes taken of each class (m³). */
	take(c: number, dh: number, out: number[]): number {
		for (let k = 0; k < out.length; k++) out[k] = 0
		const have = this.h[c] as number
		if (!(have > 0) || !(dh > 0)) return 0
		const share = Math.min(1, dh / have)
		const A = this.dx * this.dx
		let left = 0
		let taken = 0
		for (let k = 0; k < this.classes.length; k++) {
			const a = this.hk[k] as Float64Array
			let t = (a[c] as number) * share
			if ((a[c] as number) - t < 1e-14) t = a[c] as number
			a[c] = (a[c] as number) - t
			left += a[c] as number
			out[k] = t * A
			taken += t * A
		}
		this.h[c] = left
		this.wakeCell(c)
		return taken
	}
	/**
	 * Lays `vol` m³ of class k on column c as grains landing there settle: a layer at a time (a quarter of the drop its grains stand at across
	 * one column, or a 64th of what lands, whichever is thicker), each resting where it lands unless that would stand it steeper over a
	 * neighbouring column (not a wall or an edge) than a fresh heap's face stands (its grains' standing slope + 3°, TAN_STABLE): then it runs
	 * on down to the lowest such neighbour, and on, until it rests (ROLL columns at most). Grains landing on a heap run down its faces in a few
	 * hundredths of a second; the bed's own avalanches (a column sinks no faster than √(g·h)) are slower than a fast pour feeds one spot,
	 * which then stood up as a pillar of grains under the stream: a cup of sugar tipped into a jar (whose bed has 4 mm columns) at about 180 g
	 * a second stood a pillar 0.6 m tall in the 11 cm jar, 1.4 m when the cup was tipped past where it empties. Ties go round the four ways in
	 * turn, so a heap fed at a point grows round. A share that rests where it lands in one layer is laid exactly as before; damp grains, whose
	 * faces stand steep, rest where they land.
	 */
	rain(c: number, k: number, vol: number) {
		if (!(vol > 0) || c < 0 || c >= this.n) return
		const A = this.dx * this.dx
		this.limits(c)
		const layer = Math.max(0.25 * Math.min(this.lStand, StandTable.STEEP) * this.dx * A, vol / 64)
		let left = vol
		while (left > 0) {
			const v = left <= layer ? left : layer
			const dh = v / A
			let cur = c
			for (let step = 0; step < ROLL; step++) {
				this.limits(cur)
				// (the steepest the landed layer may stand at over a neighbour: its grains' standing slope + 3°, tan(a + b) = (tan a + tan b) /
				// (1 − tan a tan b); a face that stands vertical, damp grains', is vertical still)
				const L = Math.min(this.lStand, StandTable.STEEP)
				const allow = (L * TAN_STABLE < 1 ? Math.min((L + TAN_STABLE) / (1 - L * TAN_STABLE), StandTable.STEEP) : StandTable.STEEP) * this.dx
				const top = this.surface(cur) + dh
				const i = cur % this.nx
				const j = (cur - i) / this.nx
				let next = -1
				let low = Number.POSITIVE_INFINITY
				this.rainTurn = (this.rainTurn + 1) & 3
				for (let s = 0; s < 4; s++) {
					const st = STEPS4[(this.rainTurn + s) & 3] as readonly [number, number]
					const ii = i + st[0]
					const jj = j + st[1]
					if (ii < 0 || jj < 0 || ii >= this.nx || jj >= this.nz) continue
					const nc = jj * this.nx + ii
					if ((this.kind[nc] as number) !== 0) continue
					const sn = this.surface(nc)
					if (top - sn > allow + 1e-12 && sn < low) {
						low = sn
						next = nc
					}
				}
				if (next < 0) break
				cur = next
			}
			this.add(cur, k, v)
			left = left <= layer ? 0 : left - layer
		}
	}
	private rainTurn = 0
	/** The class index of a grain (and wetness) in this bed, or -1. */
	classOf(grain: string, wet: Wetness) {
		let best = -1
		for (let k = 0; k < this.classes.length; k++) {
			const ci = this.classes[k] as ClassInfo
			if (ci.grain.key !== grain) continue
			if (ci.wet === wet) return k
			if (best < 0) best = k
		}
		return best
	}
	/** The total packed volume (m³), or of class k. */
	volume(k = -1) {
		let s = 0
		if (k < 0) for (let c = 0; c < this.n; c++) s += this.h[c] as number
		else {
			const a = this.hk[k] as Float64Array
			for (let c = 0; c < this.n; c++) s += a[c] as number
		}
		return s * this.dx * this.dx
	}
	/** The mass (kg) of grains in cells where `inside(c)` (all by default), each class at its bulk density. */
	mass(inside?: (c: number) => boolean) {
		let m = 0
		const A = this.dx * this.dx
		for (let k = 0; k < this.classes.length; k++) {
			const a = this.hk[k] as Float64Array
			const rho = (this.classes[k] as ClassInfo).rhoB
			let v = 0
			for (let c = 0; c < this.n; c++) if (inside === undefined || inside(c)) v += a[c] as number
			m += v * A * rho
		}
		return m
	}
	/** Remembers the thickness now as the start. */
	mark() {
		this.h0.set(this.h)
	}

	/** Sets lStand / lMove: tan of the steepest slope cell c's grains stand at (its face height: its thickness), and of their moving friction. */
	private limits(c: number) {
		if ((this.kind[c] as number) === 2) {
			this.lStand = 0
			this.lMove = 0
			return
		}
		// (one dry class with no cohesion: the same limits everywhere it is not soaked)
		if (this.plain !== null && (this.soaked[c] as number) === 0) {
			this.lStand = this.plain
			this.lMove = this.plain
			this.lD = this.plainD
			return
		}
		const h = this.h[c] as number
		const K = this.classes.length
		const soaked = (this.soaked[c] as number) === 1
		if (K === 1) {
			const ci = this.classes[0] as ClassInfo
			this.lStand = soaked ? ci.standSoaked.tanFor(h) : h > ci.crush ? ci.tanRepose : ci.stand.tanFor(h)
			this.lMove = soaked ? ci.tanSoaked : ci.tanRepose
			this.lD = ci.grain.d
			return
		}
		let stand = 0
		let fr = 0
		let d = 0
		for (let k = 0; k < K; k++) {
			const s = h > 0 ? ((this.hk[k] as Float64Array)[c] as number) / h : 1 / K
			const ci = this.classes[k] as ClassInfo
			stand += s * (soaked ? ci.standSoaked.tanFor(h) : h > ci.crush ? ci.tanRepose : ci.stand.tanFor(h))
			fr += s * (soaked ? ci.tanSoaked : ci.tanRepose)
			d += s * ci.grain.d
		}
		this.lStand = stand
		this.lMove = fr
		this.lD = d
	}
	private lD = 0.0004

	/**
	 * One face of the flow: a face between cells a and b (b after a along the face's axis) with velocity u; sAcross = the surface's slope
	 * across the face. Returns [new u, the thickness to move (on the source cell's footprint)].
	 */
	private face(u: number, a: number, b: number, sAcross: number, dt: number, umax: number): number {
		const { h, H, kind, dx } = this
		const ka = kind[a] as number
		const kb = kind[b] as number
		this.faceFlux = 0
		if (ka === 1 || kb === 1 || (ka === 2 && kb === 2)) return 0
		const Ha = H[a] as number
		const Hb = H[b] as number
		const dH = Ha - Hb
		const src = dH > 0 ? a : b
		if (u === 0 && !((h[src] as number) > 1e-10)) return 0
		const s = dH / dx
		const smag = Math.sqrt(s * s + sAcross * sAcross)
		this.limits(src)
		const edge = ka === 2 || kb === 2
		const dir = smag > 0 ? Math.abs(s) / smag : 1
		const g = this.gravity
		if (u === 0) {
			if (smag <= this.lStand && !edge) return 0
			u = g * (s - Math.sign(s) * this.lMove * dir) * dt
			if (Math.sign(u) !== Math.sign(s)) return 0
		} else {
			// Coulomb friction growing with the flow's inertial number I = 5ud/(2δ√(gδ)) (the μ(I) rheology: μ = μ_s + Δμ·I/(I₀ + I), Δμ 0.26, I₀ 0.279
			// [JOP06]); δ, the flowing layer: the excess over the stable slope (at least 10 grains)
			const tanS = Math.min(this.lStand, StandTable.STEEP)
			const drop = Math.abs(dH)
			const ex = smag > tanS ? drop * (1 - tanS / smag) : 0
			const layer = Math.max(Math.min(h[src] as number, ex), 10 * this.lD, 1e-4)
			const I = (5 * Math.abs(u) * this.lD) / (2 * layer * Math.sqrt(g * layer))
			const mu = this.lMove + (0.26 * I) / (0.279 + I)
			const un = u + g * s * dt
			const fr = g * mu * dir * dt
			u = Math.abs(un) <= fr ? 0 : un - Math.sign(un) * fr
		}
		if (u > umax) u = umax
		else if (u < -umax) u = -umax
		if (u === 0) return 0
		const from = u > 0 ? a : b
		const to = u > 0 ? b : a
		if ((kind[to] as number) === 1) return 0
		const hs = h[from] as number
		if (!(hs > 0)) return 0
		let excess: number
		if ((kind[to] as number) === 2) excess = hs
		else {
			const drop = u > 0 ? dH : -dH
			if (!(drop > 0)) return 0
			if (from !== src) this.limits(from)
			const tanS = Math.min(this.lStand, StandTable.STEEP)
			// (the excess over the stable slope, along the surface's steepest direction: round cones on a square grid)
			excess = smag > tanS ? drop * (1 - tanS / smag) : 0
		}
		// (no layer above the stable slope (a few µm): nothing is moving here, so the face stops: an avalanche ends where its slope is back to repose;
		// nor a film thinner than that left on a steep wall, a funnel's or a bulb's: under a tenth of a grain, it stays put, and the bed can rest)
		if (!(excess > 2e-5) || !(hs > 2e-6)) return 0
		// (a layer `excess` deep moving at u through a face dx wide, as a thickness on the source's column dx × dx)
		this.faceFlux = (Math.abs(u) * Math.min(hs, excess) * dt) / dx
		return u
	}
	private faceFlux = 0

	/**
	 * One step of the grains' own flow (avalanches), dt s: the faces' velocities, then what crosses each face (only the excess over the stable
	 * slope flows; no cell gives more than it has), then the edges' spill. Only the cells that may change are worked. Returns the largest face
	 * speed (m/s).
	 */
	flow(dt: number): number {
		if (this.resting) return 0
		const { nx, nz, dx, floor, kind, h, H, ux, uz, fxv, fzv, outSum } = this
		const K = this.classes.length
		const I0 = this.i0
		const I1 = this.i1
		const J0 = this.j0
		const J1 = this.j1
		for (let j = J0; j <= J1; j++) for (let i = I0; i <= I1; i++) {
			const c = j * nx + i
			H[c] = (floor[c] as number) + (h[c] as number)
		}
		// (a ring around the window: its H is needed for slopes across)
		const ringI0 = Math.max(0, I0 - 1)
		const ringI1 = Math.min(nx - 1, I1 + 1)
		const ringJ0 = Math.max(0, J0 - 1)
		const ringJ1 = Math.min(nz - 1, J1 + 1)
		for (let i = ringI0; i <= ringI1; i++) {
			if (ringJ0 < J0) H[ringJ0 * nx + i] = (floor[ringJ0 * nx + i] as number) + (h[ringJ0 * nx + i] as number)
			if (ringJ1 > J1) H[ringJ1 * nx + i] = (floor[ringJ1 * nx + i] as number) + (h[ringJ1 * nx + i] as number)
		}
		for (let j = ringJ0; j <= ringJ1; j++) {
			if (ringI0 < I0) H[j * nx + ringI0] = (floor[j * nx + ringI0] as number) + (h[j * nx + ringI0] as number)
			if (ringI1 > I1) H[j * nx + ringI1] = (floor[j * nx + ringI1] as number) + (h[j * nx + ringI1] as number)
		}
		const umax = (0.45 * dx) / dt
		let fastest = 0
		let mi0 = nx
		let mi1 = -1
		let mj0 = nz
		let mj1 = -1
		// ---- x-faces in the window (and its edges)
		const fi0 = Math.max(0, I0 - 1)
		const fi1 = Math.min(nx - 2, I1)
		for (let j = J0; j <= J1; j++) {
			for (let i = fi0; i <= fi1; i++) {
				const f = j * (nx - 1) + i
				const a = j * nx + i
				const b = a + 1
				const Ha = H[a] as number
				const Hb = H[b] as number
				const up = j + 1 < nz
				const dn = j > 0
				let sz = 0
				if (up || dn) {
					const t = (up ? ((kind[a + nx] as number) !== 0 ? Ha : (H[a + nx] as number)) + ((kind[b + nx] as number) !== 0 ? Hb : (H[b + nx] as number)) : Ha + Hb) - (dn ? ((kind[a - nx] as number) !== 0 ? Ha : (H[a - nx] as number)) + ((kind[b - nx] as number) !== 0 ? Hb : (H[b - nx] as number)) : Ha + Hb)
					sz = t / (2 * ((up ? 1 : 0) + (dn ? 1 : 0)) * dx)
				}
				const u = this.face(ux[f] as number, a, b, sz, dt, umax)
				ux[f] = u
				fxv[f] = this.faceFlux
				if (u !== 0) {
					if (Math.abs(u) > fastest) fastest = Math.abs(u)
					if (i < mi0) mi0 = i
					if (i + 1 > mi1) mi1 = i + 1
					if (j < mj0) mj0 = j
					if (j > mj1) mj1 = j
				}
			}
		}
		// ---- z-faces
		const fj0 = Math.max(0, J0 - 1)
		const fj1 = Math.min(nz - 2, J1)
		for (let j = fj0; j <= fj1; j++) {
			for (let i = I0; i <= I1; i++) {
				const f = j * nx + i
				const a = f
				const b = a + nx
				const Ha = H[a] as number
				const Hb = H[b] as number
				const rt = i + 1 < nx
				const lf = i > 0
				let sx = 0
				if (rt || lf) {
					const t = (rt ? ((kind[a + 1] as number) !== 0 ? Ha : (H[a + 1] as number)) + ((kind[b + 1] as number) !== 0 ? Hb : (H[b + 1] as number)) : Ha + Hb) - (lf ? ((kind[a - 1] as number) !== 0 ? Ha : (H[a - 1] as number)) + ((kind[b - 1] as number) !== 0 ? Hb : (H[b - 1] as number)) : Ha + Hb)
					sx = t / (2 * ((rt ? 1 : 0) + (lf ? 1 : 0)) * dx)
				}
				const u = this.face(uz[f] as number, a, b, sx, dt, umax)
				uz[f] = u
				fzv[f] = this.faceFlux
				if (u !== 0) {
					if (Math.abs(u) > fastest) fastest = Math.abs(u)
					if (i < mi0) mi0 = i
					if (i > mi1) mi1 = i
					if (j < mj0) mj0 = j
					if (j + 1 > mj1) mj1 = j + 1
				}
			}
		}
		this.fastest = fastest
		// the window shrinks to what moved (it grows again where grains are added or taken)
		this.i0 = 0
		this.i1 = -1
		if (mi1 >= mi0) this.wake(mi0, mi1, mj0, mj1)
		if (fastest === 0) return 0
		// ---- no cell gives more than it has
		const ci0 = Math.max(0, I0 - 1)
		const ci1 = Math.min(nx - 1, I1 + 1)
		const cj0 = Math.max(0, J0 - 1)
		const cj1 = Math.min(nz - 1, J1 + 1)
		for (let j = cj0; j <= cj1; j++) for (let i = ci0; i <= ci1; i++) outSum[j * nx + i] = 0
		for (let j = J0; j <= J1; j++)
			for (let i = fi0; i <= fi1; i++) {
				const f = j * (nx - 1) + i
				const v = fxv[f] as number
				if (v > 0) {
					const s = (ux[f] as number) > 0 ? j * nx + i : j * nx + i + 1
					outSum[s] = (outSum[s] as number) + v
				}
			}
		for (let j = fj0; j <= fj1; j++)
			for (let i = I0; i <= I1; i++) {
				const f = j * nx + i
				const v = fzv[f] as number
				if (v > 0) {
					const s = (uz[f] as number) > 0 ? f : f + nx
					outSum[s] = (outSum[s] as number) + v
				}
			}
		// (and a column sinks no faster than √(g·h): its grains must fall to leave it, so a tall tower slumps over about 3√(H/g) [LUBE04]
		// rather than at once)
		const g = this.gravity
		for (let j = cj0; j <= cj1; j++)
			for (let i = ci0; i <= ci1; i++) {
				const c = j * nx + i
				const o = outSum[c] as number
				const have = h[c] as number
				const most = Math.min(have, SINK * Math.sqrt(g * have) * dt)
				outSum[c] = o > most && o > 0 ? most / o : 1
			}
		// ---- move (each class by its share in the source cell), in face order
		const moved = this.moved
		const transfer = (s: number, t: number, v: number) => {
			const hs = h[s] as number
			if (!(hs > 0) || !(v > 0)) return
			const m = Math.min(v * (outSum[s] as number), hs)
			let total = 0
			for (let k = 0; k < K; k++) {
				const part = (((this.hk[k] as Float64Array)[s] as number) / hs) * m
				moved[k] = part
				total += part
			}
			for (let k = 0; k < K; k++) {
				const a = this.hk[k] as Float64Array
				const nv = (a[s] as number) - (moved[k] as number)
				a[s] = nv > 1e-15 ? nv : 0
				a[t] = (a[t] as number) + (moved[k] as number)
			}
			const left = hs - total
			h[s] = left > 1e-15 ? left : 0
			h[t] = (h[t] as number) + total
		}
		for (let j = J0; j <= J1; j++)
			for (let i = fi0; i <= fi1; i++) {
				const f = j * (nx - 1) + i
				const v = fxv[f] as number
				if (v > 0) {
					if ((ux[f] as number) > 0) transfer(j * nx + i, j * nx + i + 1, v)
					else transfer(j * nx + i + 1, j * nx + i, v)
				}
			}
		for (let j = fj0; j <= fj1; j++)
			for (let i = I0; i <= I1; i++) {
				const f = j * nx + i
				const v = fzv[f] as number
				if (v > 0) {
					if ((uz[f] as number) > 0) transfer(f, f + nx, v)
					else transfer(f + nx, f, v)
				}
			}
		if (this.hasEdges) this.spillEdges(ci0, ci1, cj0, cj1)
		return fastest
	}

	/** Grains that reached an edge cell fall off as parcels (moving outward a little). */
	spillEdges(i0 = 0, i1 = this.nx - 1, j0 = 0, j1 = this.nz - 1) {
		const A = this.dx * this.dx
		for (let j = j0; j <= j1; j++)
			for (let i = i0; i <= i1; i++) {
				const c = j * this.nx + i
				if ((this.kind[c] as number) !== 2 || !((this.h[c] as number) > 0)) continue
				// (outward: away from the bed's middle)
				const ox = i < this.nx / 2 ? -0.2 : 0.2
				for (let k = 0; k < this.classes.length; k++) {
					const a = this.hk[k] as Float64Array
					const v = (a[c] as number) * A
					const ci = this.classes[k] as ClassInfo
					if (v > 0) {
						this.spill.push({ x: this.cx(i), y: this.surface(c), z: this.cz(j), vx: ox, vy: 0, vz: 0, vol: v, grain: ci.grain.key, wet: ci.wet, age: 0 })
						this.droppedMass += v * ci.rhoB
					}
					a[c] = 0
				}
				this.dropped += (this.h[c] as number) * A
				this.h[c] = 0
			}
	}
}

// ---------------------------------------------------------------- water on a bed (a stream table)

export interface WaterSpec {
	/** Where the water comes in (world x, z), at what rate (m³/s), from when (s). */
	readonly sources: readonly { readonly x: number; readonly z: number; readonly rate: number; readonly from: number }[]
	/** Cells beyond this x (the low end) drain: the water and what it still carries leave there. */
	readonly drainX: number
	/** The standing water's level (a lake at the low end, held by the outlet's lip), m. */
	readonly lake: number
	/** Plant cover: cells and the extra shear stress (Pa) their roots and stems take. */
	readonly plants?: ReadonlyMap<number, number>
	/** Manning's n. */
	readonly n: number
}

/** The eight neighbours (di, dj) and their distances in columns. */
const NB: readonly (readonly [number, number, number])[] = [
	[1, 0, 1],
	[-1, 0, 1],
	[0, 1, 1],
	[0, -1, 1],
	[1, 1, Math.SQRT2],
	[1, -1, Math.SQRT2],
	[-1, 1, Math.SQRT2],
	[-1, -1, Math.SQRT2]
]
/** Multiple-flow-direction exponent: the water shares itself among the lower neighbours by slope^p (Freeman 1991, Comput. Geosci. 17, 413:
 *  p 1.1 spreads it; higher concentrates it in channels). */
const MFD_P = 4
/** The least slope a flowing column is given (a flat column still drains). */
const S_MIN = 0.002

/**
 * Running water on a bed and the grains it moves, as a landscape-evolution model does it: each step the water is routed downhill from its
 * sources (shared among the lower neighbours by slope^p), its depth in each column from Manning's law for a stream one column wide
 * (h = (n·Q/(w·√S))^{3/5}), the bed shear stress τ = ρ·g·h·S and the load it can carry by Wong & Parker [WP06] (each grain class by its share of
 * the bed's top); a column takes grains up toward that load, or lets them fall, over the distance they take to settle through the water
 * (u·h/w_s [FC04]); in standing water (below the lake's level, held at the low end) the flow spreads and slows, so what it carries falls there:
 * a delta. The bed changes by morfac × that (time-lapse [ROELVINK06]); the water's own pattern is steady from step to step (quasi-steady).
 */
export class Water {
	readonly bed: Bed
	readonly spec: WaterSpec
	/** Per column: water depth (m: flowing or standing), discharge through it (m³/s), what it carries (m³/s of grains, all classes). */
	readonly w: Float64Array
	readonly q: Float64Array
	readonly load: Float64Array
	readonly sourceCells: number[]
	/** m³ (packed) picked up and let fall (morfac-scaled), m³ of water let in and out, m³ (packed) of grains carried out at the drain. */
	eroded = 0
	deposited = 0
	inflow = 0
	outflow = 0
	lostGrains = 0
	/** The fastest flow of the last step (m/s), and the most grains it carried (m³/s). */
	topSpeed = 0
	private readonly tauExtra: Float64Array
	private readonly order: Int32Array
	private readonly qs: Float64Array[]
	private readonly H: Float64Array
	private readonly wts: Float64Array
	private readonly F: Float64Array
	private readonly parent: Int32Array
	private readonly heapL: Float64Array
	private readonly heapC: Int32Array
	constructor(bed: Bed, spec: WaterSpec) {
		this.bed = bed
		this.spec = spec
		this.w = new Float64Array(bed.n)
		this.q = new Float64Array(bed.n)
		this.load = new Float64Array(bed.n)
		this.qs = bed.classes.map(() => new Float64Array(bed.n))
		this.order = new Int32Array(bed.n)
		this.H = new Float64Array(bed.n)
		this.wts = new Float64Array(8)
		this.F = new Float64Array(bed.n)
		this.parent = new Int32Array(bed.n)
		this.heapL = new Float64Array(bed.n + 1)
		this.heapC = new Int32Array(bed.n + 1)
		this.sourceCells = spec.sources.map((p) => bed.cellAt(p.x, p.z))
		this.tauExtra = new Float64Array(bed.n)
		for (const [c, t] of spec.plants ?? []) if (c >= 0 && c < bed.n) this.tauExtra[c] = t
		bed.water = this
		this.standing()
	}
	/** Standing water: depth up to the lake's level where the surface is lower (and those columns soaked). */
	standing() {
		const bed = this.bed
		for (let c = 0; c < bed.n; c++) {
			if ((bed.kind[c] as number) !== 0) continue
			const top = bed.surface(c)
			if (this.spec.lake > top) {
				this.w[c] = this.spec.lake - top
				if ((bed.soaked[c] as number) === 0) {
					bed.soaked[c] = 1
					bed.wakeCell(c)
				}
			} else if ((this.q[c] as number) === 0) this.w[c] = 0
		}
	}
	/** m³ of water standing in the lake now. */
	volume() {
		let s = 0
		for (let c = 0; c < this.bed.n; c++) if (this.spec.lake > this.bed.surface(c)) s += this.w[c] as number
		return s * this.bed.dx * this.bed.dx
	}

	/**
	 * The surface the water drains over: every column raised to the lowest level from which it can drain to the outlet (Barnes, Lehman & Mulla's
	 * priority-flood, Comput. Geosci. 62, 117 (2014), from the drain's columns at no lower than the pool's level), plus a micro-slope (1 µm a
	 * column) toward the outlet across flats; and each column's next column toward the outlet (its parent in the flood). A hollow fills with
	 * standing water to its spill level, and the water goes on over it.
	 */
	private flood() {
		const bed = this.bed
		const { nx, nz, kind, n } = bed
		const F = this.F
		const parent = this.parent
		const H = this.H
		F.fill(Number.POSITIVE_INFINITY)
		parent.fill(-1)
		// (a binary heap of [level, cell], lowest first, ties by cell: the same order everywhere)
		const heapL = this.heapL
		const heapC = this.heapC
		let size = 0
		const less = (a: number, b: number) => (heapL[a] as number) < (heapL[b] as number) || ((heapL[a] as number) === (heapL[b] as number) && (heapC[a] as number) < (heapC[b] as number))
		const swap = (a: number, b: number) => {
			const l = heapL[a] as number
			const c = heapC[a] as number
			heapL[a] = heapL[b] as number
			heapC[a] = heapC[b] as number
			heapL[b] = l
			heapC[b] = c
		}
		const push = (l: number, c: number) => {
			let k = size++
			heapL[k] = l
			heapC[k] = c
			while (k > 0) {
				const p = (k - 1) >> 1
				if (!less(k, p)) break
				swap(k, p)
				k = p
			}
		}
		const pop = () => {
			const c = heapC[0] as number
			size--
			if (size > 0) {
				heapL[0] = heapL[size] as number
				heapC[0] = heapC[size] as number
				let k = 0
				for (;;) {
					const a = 2 * k + 1
					const b = a + 1
					let m = k
					if (a < size && less(a, m)) m = a
					if (b < size && less(b, m)) m = b
					if (m === k) break
					swap(k, m)
					k = m
				}
			}
			return c
		}
		const lake = this.spec.lake
		for (let c = 0; c < n; c++) {
			if ((kind[c] as number) !== 0) continue
			if (bed.cx(c % nx) >= this.spec.drainX) {
				F[c] = Math.max(H[c] as number, lake)
				push(F[c] as number, c)
			}
		}
		while (size > 0) {
			const c = pop()
			const i = c % nx
			const j = (c - i) / nx
			for (let k = 0; k < 4; k++) {
				const nb = NB[k] as readonly [number, number, number]
				const di = nb[0]
				const dj = nb[1]
				const ii = i + di
				const jj = j + dj
				if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue
				const cc = jj * nx + ii
				if ((kind[cc] as number) !== 0 || (F[cc] as number) !== Number.POSITIVE_INFINITY) continue
				F[cc] = Math.max(H[cc] as number, (F[c] as number) + 1e-6)
				parent[cc] = c
				push(F[cc] as number, cc)
			}
		}
		// (columns no outlet reaches, behind walls: they keep their own surface)
		for (let c = 0; c < n; c++) if ((F[c] as number) === Number.POSITIVE_INFINITY) F[c] = H[c] as number
	}

	/** One step of dt s (real time); the bed changes by morfac × dt's worth. */
	step(dt: number, t: number, morfac: number) {
		const bed = this.bed
		const { nx, nz, dx, kind } = bed
		const g = bed.gravity
		const K = bed.classes.length
		const H = this.H
		const F = this.F
		const parent = this.parent
		const n = bed.n
		for (let c = 0; c < n; c++) H[c] = (kind[c] as number) === 1 ? Number.POSITIVE_INFINITY : bed.surface(c)
		this.flood()
		// highest first over the drained surface (ties by index: the same order everywhere)
		const order = this.order
		for (let c = 0; c < n; c++) order[c] = c
		order.sort((a, b) => (F[b] as number) - (F[a] as number) || a - b)
		this.q.fill(0)
		this.load.fill(0)
		for (const a of this.qs) a.fill(0)
		let inflow = 0
		this.spec.sources.forEach((p, k) => {
			const c = this.sourceCells[k] as number
			if (c < 0 || t < p.from || (kind[c] as number) !== 0) return
			this.q[c] = (this.q[c] as number) + p.rate
			inflow += p.rate
		})
		this.inflow += inflow * dt
		const n2 = this.spec.n
		const tm = dt * morfac
		const A = dx * dx
		const wts = this.wts
		let top = 0
		for (let r = 0; r < n; r++) {
			const c = order[r] as number
			if ((kind[c] as number) !== 0) continue
			const Q = this.q[c] as number
			const still = (F[c] as number) - (H[c] as number)
			if (!(Q > 0)) {
				this.w[c] = still > 2e-4 ? still : 0
				continue
			}
			const i = c % nx
			const j = (c - i) / nx
			const Fc = F[c] as number
			const drained = bed.cx(i) >= this.spec.drainX
			// standing water (a pool, a filled hollow): on toward the outlet along the flood, slowly; running water: shared among the lower
			// neighbours of the drained surface by slope^p
			const standing = still > 1e-3
			let wsum = 0
			let smean = 0
			for (let k = 0; k < 8; k++) {
				wts[k] = 0
				if (standing) continue
				const nb = NB[k] as readonly [number, number, number]
				const di = nb[0]
				const dj = nb[1]
				const dist = nb[2]
				const ii = i + di
				const jj = j + dj
				if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue
				const cc = jj * nx + ii
				if ((kind[cc] as number) !== 0) continue
				const sl = (Fc - (F[cc] as number)) / (dist * dx)
				if (sl > 0) {
					const s2 = sl * sl
					const wgt = s2 * s2 // (slope^MFD_P, MFD_P = 4)
					wts[k] = wgt
					wsum += wgt
					smean += sl * wgt
				}
			}
			let next = -1
			if (standing || !(wsum > 0)) {
				next = parent[c] as number
				wsum = 0
			}
			const S = !standing && wsum > 0 ? smean / wsum : 0
			// depth, speed and shear: a stream one column wide (Manning), or standing water spread three columns wide
			let depth: number
			let u: number
			let tau: number
			if (standing) {
				depth = still
				u = Q / (3 * dx * depth)
				tau = (RHO_WATER * g * n2 * n2 * u * u) / Math.pow(depth, 1 / 3)
			} else {
				const Se = Math.max(S, S_MIN)
				depth = Math.pow((n2 * Q) / (dx * Math.sqrt(Se)), 0.6)
				u = Q / (dx * depth)
				tau = RHO_WATER * g * depth * Se
			}
			this.w[c] = depth
			if (u > top) top = u
			// (soaked where water runs, unless plants' roots hold it: root cohesion keeps a planted bank standing, Wu et al. 1979)
			if ((bed.soaked[c] as number) === 0 && depth > 2e-4 && !((this.tauExtra[c] as number) > 0)) {
				bed.soaked[c] = 1
				bed.wakeCell(c)
			}
			// the grains: toward the load it can carry (each class by its share of the bed's top), over its settling distance
			const hc = bed.h[c] as number
			let carried = 0
			for (let k = 0; k < K; k++) {
				const ci = bed.classes[k] as ClassInfo
				const gr = ci.grain
				const R = gr.rhoS / RHO_WATER - 1
				const a = bed.hk[k] as Float64Array
				const tauEff = tau - (this.tauExtra[c] as number) - gr.tauCohesive
				// (Shields: τ/((ρ_s − ρ)·g·d))
				const theta = tauEff > 0 ? tauEff / (RHO_WATER * R * g * gr.d) : 0
				const share = hc > 0 ? (a[c] as number) / hc : 0
				const cap = bedLoad(gr, theta, ci.thetaC) * dx * share // m³/s of grains (solid)
				const qin = (this.qs[k] as Float64Array)[c] as number
				const La = Math.max(dx, (u * depth) / ci.settle)
				const f = Math.min(1, dx / La)
				let ex = (cap - qin) * f // + picked up, − let fall (m³/s solid)
				const packed = 1 - gr.porosity
				if (ex > 0) {
					// (never more than the column has of it)
					const avail = ((a[c] as number) * A * packed) / tm
					if (ex > avail) ex = avail
					const dh = (ex * tm) / (A * packed)
					a[c] = Math.max(0, (a[c] as number) - dh)
					bed.h[c] = Math.max(0, (bed.h[c] as number) - dh)
					this.eroded += dh * A
				} else if (ex < 0) {
					const dh = (-ex * tm) / (A * packed)
					a[c] = (a[c] as number) + dh
					bed.h[c] = (bed.h[c] as number) + dh
					this.deposited += dh * A
				}
				const out = Math.max(0, qin + ex)
				if (ex !== 0) bed.wakeCell(c)
				carried += out
				// on with the water (out at the drain)
				if (drained || (next < 0 && !(wsum > 0))) {
					this.lostGrains += (out * tm) / packed
					continue
				}
				const t2 = this.qs[k] as Float64Array
				if (next >= 0) {
					t2[next] = (t2[next] as number) + out
					continue
				}
				for (let kk = 0; kk < 8; kk++) {
					const wk = wts[kk] as number
					if (!(wk > 0)) continue
					const nb = NB[kk] as readonly [number, number, number]
					const di = nb[0]
					const dj = nb[1]
					const cc = (j + dj) * nx + (i + di)
					t2[cc] = (t2[cc] as number) + (out * wk) / wsum
				}
			}
			this.load[c] = carried
			if (drained || (next < 0 && !(wsum > 0))) {
				this.outflow += Q * dt
				continue
			}
			if (next >= 0) {
				this.q[next] = (this.q[next] as number) + Q
				continue
			}
			for (let k = 0; k < 8; k++) {
				const wk = wts[k] as number
				if (!(wk > 0)) continue
				const nb = NB[k] as readonly [number, number, number]
				const di = nb[0]
				const dj = nb[1]
				const cc = (j + dj) * nx + (i + di)
				this.q[cc] = (this.q[cc] as number) + (Q * wk) / wsum
			}
		}
		this.topSpeed = top
		// (standing water: to its level where no stream runs, those columns soaked)
		for (let c = 0; c < n; c++) {
			if ((kind[c] as number) !== 0 || (this.q[c] as number) > 0) continue
			const still = (F[c] as number) - bed.surface(c)
			this.w[c] = still > 2e-4 ? still : 0
			if (still > 2e-4 && (bed.soaked[c] as number) === 0 && !((this.tauExtra[c] as number) > 0)) {
				bed.soaked[c] = 1
				bed.wakeCell(c)
			}
		}
	}
}

// ---------------------------------------------------------------- bodies in sand

/** What the world needs of a moving solid (the module wraps the engine's SolidHandle). */
export interface BodyLink {
	readonly id: string
	readonly item: string
	/** Front-to-back size of a prism (m); a ball is a sphere. */
	readonly depth: number
	outline(): { readonly circle?: { x: number; y: number; r: number }; readonly points?: readonly { x: number; y: number }[] }
	view(): {
		readonly key: number
		readonly mass: number
		readonly inertia: number
		readonly center: { x: number; y: number }
		readonly velocity: { x: number; y: number }
		readonly spin: number
		readonly force: { x: number; y: number }
	}
	push(fx: number, fy: number, at: { x: number; y: number }): void
	/** A torque on its body (N·m). */
	twist(torque: number): void
	/** Stops its body (a strike the sand ends within one step: its energy is spent in its crater). */
	halt?(): void
}

/** One solid's touch of one bed this step. */
interface Touch {
	bed: Bed
	link: BodyLink
	/** contact area (m²), its centroid (x, y), the deepest point under the surrounding surface (m), widths across and along x (m), the frontal area (m²). */
	area: number
	px: number
	py: number
	depth: number
	width: number
	length: number
	front: number
	rhoB: number
	tanPhi: number
	/** Downward speed when it first met the sand (m/s), for ejecta. */
	vy: number
}

/** The lowest point of a convex outline at x (m), or NaN when x is outside it. */
export const bottomAt = (pts: readonly { x: number; y: number }[], x: number) => {
	let lo = Number.NaN
	const n = pts.length
	for (let k = 0; k < n; k++) {
		const a = pts[k] as { x: number; y: number }
		const b = pts[(k + 1) % n] as { x: number; y: number }
		const xa = a.x
		const xb = b.x
		if ((x < xa && x < xb) || (x > xa && x > xb)) continue
		let y: number
		if (xa === xb) y = Math.min(a.y, b.y)
		else y = a.y + ((x - xa) / (xb - xa)) * (b.y - a.y)
		if (Number.isNaN(lo) || y < lo) lo = y
	}
	return lo
}

// ---------------------------------------------------------------- the world: beds, outlets, falling grains, bodies

/** m/s: a body meeting sand faster than this strikes it (throws grains out and opens a crater); slower, it pushes it aside. */
const STRIKE = 0.3
/** m/s: a body's point slower than this into the sand does not push it (a body at rest is buried by what slides onto it). */
const MOVING = 0.01
/** Grains let out per parcel at most (m³ packed): about 2 g of sand. */
const PARCEL_VOL = 1.2e-6
/** The bowl a strike opens, as a share of the crater's rim to rim width: its throw builds the rim about a third of its radius further out. */
const BOWL = 0.7
/** Press ticks (about 480 a second) a strike's bowl is remembered: a body falling into its own bowl does not open another. */
const BOWL_TICKS = 240
/** s between two parcels from one outlet at most. */
const PARCEL_EVERY = 1 / 60

export interface WorldOptions {
	readonly gravity: number
	/** kg/m³ of the air (no drag on falling grains: a dense stream falls nearly freely). */
	readonly air?: boolean
}

export class World {
	readonly beds: Bed[] = []
	readonly parcels: Parcel[] = []
	readonly gravity: number
	/** m³ of grains fallen off everything (lost below), and parcels that ever flew. */
	lost = 0
	thrown = 0
	/** m³ of each pourer's grains (by its item, a parcel's `src`: a tipped cup's) that fell past every bed and were lost below, and that came
	 *  down on a bed other than its landing bed (`homeOf`: its bed's id, set by whoever made the beds): a container's readings count them
	 *  outside it (a stream thrown beyond its landing bed). */
	readonly lostOf = new Map<string, number>()
	readonly strayOf = new Map<string, number>()
	readonly homeOf = new Map<string, string>()
	private readonly lastEmit = new Map<string, number>()
	/** Each body on each bed: the surface where it struck, and its steps in the sand. */
	private readonly strikes = new Map<string, { level: number; steps: number; seen?: number; bowl?: number }>()
	/** Each body on each bed: when (press tick) it last opened a crater's bowl, and the surface it struck. */
	private readonly bowls = new Map<string, { tick: number; level: number }>()
	private tick = 0
	private readonly scratch: number[] = []
	constructor(o: WorldOptions) {
		this.gravity = o.gravity
	}
	addBed(b: Bed) {
		this.beds.push(b)
		// (beds are searched highest first when a grain lands)
		this.beds.sort((p, q) => q.ceiling - p.ceiling || (p.id < q.id ? -1 : p.id > q.id ? 1 : 0))
		while (this.scratch.length < b.classes.length) this.scratch.push(0)
	}

	/** The surface under a falling point: {bed, cell, y} of the highest surface at (x, z) below `y` (walls and edges skipped), or null. */
	surfaceBelow(x: number, z: number, y: number) {
		let best: { bed: Bed; cell: number; y: number } | null = null
		for (const b of this.beds) {
			const c = b.cellAt(x, z)
			if (c < 0 || (b.kind[c] as number) !== 0) continue
			const s = b.surface(c)
			if (s <= y + 1e-9 && (best === null || s > best.y)) best = { bed: b, cell: c, y: s }
		}
		return best
	}

	/**
	 * The outlets: each open one lets out its grains at Beverloo's rate × `lapse` (time-lapse: an hourglass's minute in seconds), unless they
	 * jam or the heap under it has reached it; what leaves falls as parcels.
	 */
	pour(t: number, dt: number, lapse: number) {
		for (const b of this.beds) {
			for (const o of b.outlets) {
				if (t < o.opensAt) {
					o.rate = 0
					o.massRate = 0
					continue
				}
				// what is at the outlet: its grains (the class with the most there)
				let have = 0
				let main = -1
				let mainV = 0
				for (let k = 0; k < b.classes.length; k++) {
					let v = 0
					for (const c of o.cells) v += (b.hk[k] as Float64Array)[c] as number
					have += v
					if (v > mainV) {
						mainV = v
						main = k
					}
				}
				if (main < 0 || !(have > 0)) {
					o.rate *= 0.8
					o.massRate *= 0.8
					// (what it let out last and still holds falls now: an outlet run dry keeps nothing back)
					for (let k = 0; k < b.classes.length; k++) {
						const v = o.pending[k] as number
						if (!(v > 0)) continue
						const cl = b.classes[k] as ClassInfo
						this.parcels.push({ x: o.x, y: o.y - 0.002, z: o.z, vx: 0, vy: -Math.sqrt(this.gravity * o.diameter), vz: 0, vol: v, grain: cl.grain.key, wet: cl.wet, age: 0, skip: b.id })
						this.thrown++
						o.pending[k] = 0
					}
					continue
				}
				const ci = b.classes[main] as ClassInfo
				// the biggest grains there (more than a tenth) decide a jam
				let jam = false
				for (let k = 0; k < b.classes.length; k++) {
					let v = 0
					for (const c of o.cells) v += (b.hk[k] as Float64Array)[c] as number
					const cl = b.classes[k] as ClassInfo
					if (v > 0.1 * have && o.diameter < jamDiameter(cl.grain, cl.wet)) jam = true
				}
				if (jam && !o.jammed) o.everJammed = true
				o.jammed = jam
				const under = this.surfaceBelow(o.x, o.z, o.y - 1e-4)
				o.choked = under !== null && under.y >= o.y - 0.002
				const rate = jam || o.choked ? 0 : beverlooRate(ci.grain, ci.wet, o.diameter, this.gravity)
				const want = rate * dt * lapse
				const A = b.dx * b.dx
				// take it from the outlet's cells (each class by its share there)
				let got = 0
				let mass = 0
				if (want > 0) {
					const share = Math.min(1, want / (have * A))
					for (const c of o.cells) {
						const cellH = b.h[c] as number
						if (!(cellH > 0)) continue
						b.take(c, cellH * share, this.scratch)
						for (let k = 0; k < b.classes.length; k++) {
							const v = this.scratch[k] as number
							if (!(v > 0)) continue
							o.pending[k] = (o.pending[k] as number) + v
							got += v
							mass += v * (b.classes[k] as ClassInfo).rhoB
						}
					}
				}
				o.out += got
				o.outMass += mass
				const r = dt > 0 ? got / dt : 0
				const rm = dt > 0 ? mass / dt : 0
				// (smoothed over about 0.1 s)
				const a = Math.min(1, dt / 0.1)
				o.rate += (r - o.rate) * a
				o.massRate += (rm - o.massRate) * a
				const last = this.lastEmit.get(o.id) ?? -1
				for (let k = 0; k < b.classes.length; k++) {
					const v = o.pending[k] as number
					if (!(v > 0)) continue
					if (v < PARCEL_VOL && t - last < PARCEL_EVERY) continue
					const cl = b.classes[k] as ClassInfo
					// (leaving the spout at about √(g·D): the speed of a free-fall arch over the outlet)
					this.parcels.push({ x: o.x, y: o.y - 0.002, z: o.z, vx: 0, vy: -Math.sqrt(this.gravity * o.diameter), vz: 0, vol: v, grain: cl.grain.key, wet: cl.wet, age: 0, skip: b.id })
					this.thrown++
					o.pending[k] = 0
					this.lastEmit.set(o.id, t)
				}
			}
		}
	}

	/**
	 * Lets one bed's grains come to rest before the run (a heap laid wider than the shelf it stands on runs off its edge, as it did while it was
	 * poured there): its avalanches, `dt` s a step, for up to `seconds`; grains falling off its edges are gone (the bed's `dropped` counts them).
	 * Returns the seconds it took (or `seconds` when it is still creeping then).
	 */
	settleBed(b: Bed, dt: number, seconds: number) {
		let t = 0
		while (t < seconds && !b.resting) {
			const n = Math.min(4, Math.max(1, Math.ceil((b.fastest * dt) / (0.3 * b.dx))))
			for (let k = 0; k < n; k++) {
				b.flow(dt / n)
				if (b.resting) break
			}
			b.spill.length = 0
			t += dt
		}
		return t
	}

	/** Every bed's avalanches (sub-stepped so a face never moves more than about a third of a column a step). */
	flow(dt: number) {
		for (const b of this.beds) {
			if (b.resting) continue
			const n = Math.min(4, Math.max(1, Math.ceil((b.fastest * dt) / (0.3 * b.dx))))
			for (let k = 0; k < n; k++) {
				b.flow(dt / n)
				if (b.resting) break
			}
			for (const p of b.spill) this.parcels.push(p)
			if (b.spill.length) this.thrown += b.spill.length
			b.spill.length = 0
		}
	}

	/** The falling grains: free fall; each lands on the first surface it crosses (or is lost below). */
	fly(dt: number) {
		const g = this.gravity
		let w = 0
		for (let r = 0; r < this.parcels.length; r++) {
			const p = this.parcels[r] as Parcel
			p.vy -= g * dt
			p.x += p.vx * dt
			p.y += p.vy * dt
			p.z += p.vz * dt
			p.age += dt
			let landed = false
			for (const b of this.beds) {
				const c = b.cellAt(p.x, p.z)
				if (c < 0) continue
				const kc = b.kind[c] as number
				if (kc === 2) continue
				const s = kc === 1 ? (b.floor[c] as number) : b.surface(c)
				// (it lands where it is at or under a surface: from above, or against the side of a heap or a crater's wall)
				if (p.y > s || b.id === p.skip) continue
				if (kc === 1) {
					// (on a wall's top: it rolls off to the nearest column that holds grains; past 3 columns only on a wall thicker than that, a
					// thick-walled box's or a container's ring along its long side, where it once fell on through the wall and was lost)
					const i = c % b.nx
					const j = (c - i) / b.nx
					let near = -1
					const reach = Math.max(b.nx, b.nz)
					for (let d = 1; d <= reach && near < 0; d++)
						for (const [di, dj] of [[-d, 0], [d, 0], [0, -d], [0, d]] as const) {
							const ii = i + di
							const jj = j + dj
							if (ii < 0 || jj < 0 || ii >= b.nx || jj >= b.nz) continue
							const cc = jj * b.nx + ii
							if ((b.kind[cc] as number) === 0) {
								near = cc
								break
							}
						}
					if (near < 0) continue
					this.land(b, near, p)
				} else this.land(b, c, p)
				landed = true
				break
			}
			if (landed) continue
			if (p.age > 6 || p.y < -20) {
				this.lost += p.vol
				if (p.src !== undefined) this.lostOf.set(p.src, (this.lostOf.get(p.src) ?? 0) + p.vol)
				continue
			}
			this.parcels[w++] = p
		}
		this.parcels.length = w
	}

	/**
	 * Throws v m³ of class k out of cell c, away from x = px (and z = 0), far enough to land about half of `size` beyond where it starts (at 50°).
	 * Gathered by direction (eight ways round) and launched as one parcel each when the step's bodies are done (flushEjecta).
	 */
	private eject(b: Bed, c: number, k: number, v: number, px: number, size: number, from?: number) {
		const i = c % b.nx
		const j = (c - i) / b.nx
		const ex = b.cx(i) - px
		const ez = b.cz(j)
		const el = Math.sqrt(ex * ex + ez * ez) || 1
		// (range R = v² sin 100°/g: v = √(g·R/0.985) for R = size/2)
		const sp = Math.sqrt((this.gravity * 0.5 * Math.max(size, 2 * b.dx)) / 0.985)
		const cl = b.classes[k] as ClassInfo
		const oct = (Math.floor(((Math.atan2(ez, ex) + Math.PI) / (2 * Math.PI)) * 8) % 8 + 8) % 8
		const key = `${b.id}|${k}|${oct}`
		let bin = this.bins.get(key)
		if (bin === undefined) {
			bin = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, vol: 0, grain: cl.grain.key, wet: cl.wet, age: 0 }
			this.bins.set(key, bin)
		}
		// (volume-weighted: where and how fast the parcel goes)
		bin.x += b.cx(i) * v
		bin.y += ((from ?? b.surface(c)) + 0.002) * v
		bin.z += ez * v
		bin.vx += (ex / el) * sp * 0.643 * v
		bin.vy += sp * 0.766 * v
		bin.vz += (ez / el) * sp * 0.643 * v
		bin.vol += v
	}
	private readonly bins = new Map<string, Parcel>()
	private flushEjecta() {
		for (const p of this.bins.values()) {
			if (!(p.vol > 0)) continue
			const v = p.vol
			this.parcels.push({ x: p.x / v, y: p.y / v, z: p.z / v, vx: p.vx / v, vy: p.vy / v, vz: p.vz / v, vol: v, grain: p.grain, wet: p.wet, age: 0 })
			this.thrown++
		}
		this.bins.clear()
	}

	/** Where each pourer's stream comes down (x, m: a running mean over its last parcels, as the flow module's lands_x), by its item. */
	readonly lands = new Map<string, number>()
	/** A parcel's grains land round where it struck: half in its column, the rest in the eight round it that hold grains (a stream's spot); each
	 *  share settles there as landing grains do, running down the heap it struck to where its slope holds it (Bed.rain). */
	private land(b: Bed, c: number, p: Parcel) {
		if (p.src !== undefined) {
			const was = this.lands.get(p.src)
			this.lands.set(p.src, was === undefined ? p.x : was + (p.x - was) / 30)
			const home = this.homeOf.get(p.src)
			if (home !== undefined && home !== b.id) this.strayOf.set(p.src, (this.strayOf.get(p.src) ?? 0) + p.vol)
		}
		let k = b.classOf(p.grain, p.wet)
		if (k < 0) k = 0
		const i = c % b.nx
		const j = (c - i) / b.nx
		let wsum = 0
		for (let dj = -1; dj <= 1; dj++)
			for (let di = -1; di <= 1; di++) {
				const ii = i + di
				const jj = j + dj
				if (ii < 0 || jj < 0 || ii >= b.nx || jj >= b.nz || (b.kind[jj * b.nx + ii] as number) !== 0) continue
				wsum += di === 0 && dj === 0 ? 4 : di === 0 || dj === 0 ? 1 : 0.5
			}
		for (let dj = -1; dj <= 1; dj++)
			for (let di = -1; di <= 1; di++) {
				const ii = i + di
				const jj = j + dj
				if (ii < 0 || jj < 0 || ii >= b.nx || jj >= b.nz || (b.kind[jj * b.nx + ii] as number) !== 0) continue
				const wgt = di === 0 && dj === 0 ? 4 : di === 0 || dj === 0 ? 1 : 0.5
				b.rain(jj * b.nx + ii, k, (p.vol * wgt) / wsum)
			}
		b.landed += p.vol
	}

	/**
	 * Bodies in sand, every (sub-)step of h s after the release: what a body pushes below a surface goes to the ring of columns around it (a share
	 * thrown out when it strikes fast); the sand holds it up and brakes it with what it can bear (see the file's header). Applied once per moving
	 * body (its solids' touches together) at their contact's centroid.
	 */
	press(links: readonly BodyLink[], h: number) {
		this.tick++
		const touches: Touch[] = []
		for (const link of links) {
			const o = link.outline()
			let xa: number
			let xb: number
			let ylo: number
			let zr: number
			if (o.circle !== undefined) {
				xa = o.circle.x - o.circle.r
				xb = o.circle.x + o.circle.r
				ylo = o.circle.y - o.circle.r
				zr = o.circle.r
			} else {
				const pts = o.points ?? []
				if (pts.length < 3) continue
				xa = Number.POSITIVE_INFINITY
				xb = Number.NEGATIVE_INFINITY
				ylo = Number.POSITIVE_INFINITY
				for (const q of pts) {
					if (q.x < xa) xa = q.x
					if (q.x > xb) xb = q.x
					if (q.y < ylo) ylo = q.y
				}
				zr = link.depth / 2
			}
			for (const b of this.beds) {
				if (xb < b.x0 || xa > b.x0 + b.nx * b.dx || zr < -(b.z0 + b.nz * b.dx) || -zr > b.z0 + b.nz * b.dx) continue
				if (!(b.z0 < zr && b.z0 + b.nz * b.dx > -zr)) continue
				if (ylo > b.ceiling + 0.05) continue
				const t = this.touch(b, link, o, xa, xb, zr, h)
				if (t !== null) touches.push(t)
			}
		}
		// (a body that left a bed strikes it anew next time)
		for (const [k, st] of this.strikes) if (st.seen !== this.tick) this.strikes.delete(k)
		if (touches.length === 0) {
			this.flushEjecta()
			return
		}
		// one push per moving body
		const byKey = new Map<number, Touch[]>()
		for (const t of touches) {
			const key = t.link.view().key
			const list = byKey.get(key)
			if (list === undefined) byKey.set(key, [t])
			else list.push(t)
		}
		const g = this.gravity
		for (const list of byKey.values()) {
			const first = list[0] as Touch
			const v = first.link.view()
			let area = 0
			let px = 0
			let py = 0
			let depth = 0
			let width = 0
			let length = 0
			let front = 0
			let rho = 0
			let tanPhi = 0
			for (const t of list) {
				area += t.area
				px += t.px * t.area
				py += t.py * t.area
				depth = Math.max(depth, t.depth)
				width = Math.max(width, t.width)
				length = Math.max(length, t.length)
				front += t.front
				rho += t.rhoB * t.area
				tanPhi += t.tanPhi * t.area
			}
			if (!(area > 0)) continue
			px /= area
			py /= area
			rho /= area
			tanPhi /= area
			const phi = Math.atan2(tanPhi, 1)
			const { nq, ngamma } = bearingFactors(phi)
			const gamma = rho * g
			const m = v.mass
			if (!(m > 0)) continue
			const vy = v.velocity.y
			const vx = v.velocity.x
			// vertical: what stops its fall this step, up to what the sand bears (never pulling it down)
			const bear = area * (nq * gamma * depth + 0.5 * ngamma * gamma * Math.min(width, length)) + rho * area * (vy < 0 ? vy * vy : 0)
			const needY = (m * -vy) / h - (v.force.y - m * g)
			const fy = Math.min(Math.max(0, needY), bear)
			// along x: Coulomb friction at its contact (tan φ of the support), a rolling (compaction) resistance √(z/L) of the support, Rankine's passive
			// push ahead of the buried part and the sand's inertia: what stops it this step, up to all of those, through its centre; its turning is
			// braked by the contact's friction at its lever (each a capped implicit stop: no overshoot, so a body at rest in sand stays at rest)
			const lever = Math.abs(py - v.center.y)
			const roll = fy * Math.sqrt(Math.min(1, depth / Math.max(length, 1e-3)))
			const plow = 0.5 * passiveK(phi) * gamma * depth * depth * width + rho * front * vx * vx
			const capX = tanPhi * fy + roll + plow
			const fx = Math.max(-capX, Math.min(capX, (-m * vx) / h))
			const capT = (tanPhi * fy + roll) * Math.max(lever, 1e-3)
			const tq = v.inertia > 0 ? Math.max(-capT, Math.min(capT, (-v.inertia * v.spin) / h)) : 0
			if (fx !== 0 || fy !== 0) first.link.push(fx, fy, { x: v.center.x, y: v.center.y })
			if (tq !== 0) first.link.twist(tq)
		}
		this.flushEjecta()
	}

	/**
	 * The bowl a body striking a bed at `speed` (m/s) opens round x = px under the surface `level` (m), by Uehara et al.'s laws [UEHARA03]: the
	 * drop height H = v²/2g + d, penetration d = (0.14/μ)·(ρ_b/ρ_g)^½·D^⅔·H^⅓, crater D_c = 0.90·(ρ_b/(ρ_g·μ²))^¼·D^¾·H^¼ (D the body's
	 * diameter, a block's: of the sphere of its volume; ρ_b its density; ρ_g the bed's bulk density, μ tan of its repose). In sand thinner than d
	 * the body reaches the floor: the grains take the share t/d of its energy, and the crater is (t/d)^¼ as wide. What the bowl opens is thrown
	 * beyond its edge (the crater's rim). Under the body the sand is left to it (it goes in by its own bearing and drag, step by step), unless it
	 * would go in less than a step's travel (a light ball: v·h > d): then its own dent is dug to d and it is stopped there, its energy spent.
	 * Returns the crater's width (m) it aimed at.
	 */
	private bowl(b: Bed, link: BodyLink, o: ReturnType<BodyLink["outline"]>, xa: number, xb: number, zr: number, mass: number, speed: number, px: number, level: number, h: number) {
		const depthZ = link.depth
		let D: number
		let V: number
		if (o.circle !== undefined) {
			D = 2 * o.circle.r
			V = (Math.PI / 6) * D * D * D
		} else {
			const pts = o.points ?? []
			let a2 = 0
			for (let k = 0; k < pts.length; k++) {
				const p = pts[k] as { x: number; y: number }
				const q = pts[(k + 1) % pts.length] as { x: number; y: number }
				a2 += p.x * q.y - q.x * p.y
			}
			V = (Math.abs(a2) / 2) * depthZ
			D = Math.pow((6 * V) / Math.PI, 1 / 3)
		}
		if (!(D > 0) || !(V > 0) || !(mass > 0)) return 0
		const c0 = b.cellAt(px, 0)
		if (c0 < 0 || (b.kind[c0] as number) !== 0) return 0
		const ci = b.classes[0] as ClassInfo
		const ratio = mass / V / ci.rhoB
		const mu = ci.tanRepose
		const g = this.gravity
		const H0 = (speed * speed) / (2 * g)
		const pen = (H: number) => (0.14 / mu) * Math.sqrt(ratio) * Math.pow(D, 2 / 3) * Math.pow(H, 1 / 3)
		const d0 = pen(H0)
		const H = H0 + d0
		let d = pen(H)
		let Dc = 0.9 * Math.pow(ratio / (mu * mu), 0.25) * Math.pow(D, 0.75) * Math.pow(H, 0.25)
		// (sand thinner than its penetration: it strikes the floor; the sand took that share of its energy)
		const t = b.h[c0] as number
		if (d > t) {
			Dc *= t > 0 ? Math.pow(t / d, 0.25) : 0
			d = t
		}
		// (the bowl's radius: the rim its throw builds stands about a third of it further out, so the rim to rim width is Uehara's)
		const Rt = BOWL * 0.5 * Dc
		if (!(Rt > b.dx) || !(d > 0)) return Dc
		const yb = level - d
		const dx = b.dx
		// (a stop within one step's travel: the grid cannot follow it, so its dent and its stop are laid down here)
		const quick = speed * h > d
		const reach = Math.max(Rt, o.circle !== undefined ? o.circle.r : 0.5 * (xb - xa))
		const i0 = Math.max(0, Math.floor((px - reach - b.x0) / dx))
		const i1 = Math.min(b.nx - 1, Math.floor((px + reach - b.x0) / dx))
		const j0 = Math.max(0, Math.floor((-reach - b.z0) / dx))
		const j1 = Math.min(b.nz - 1, Math.floor((reach - b.z0) / dx))
		for (let j = j0; j <= j1; j++)
			for (let i = i0; i <= i1; i++) {
				const c = j * b.nx + i
				if ((b.kind[c] as number) !== 0 || !((b.h[c] as number) > 0)) continue
				const ex = b.cx(i) - px
				const ez = b.cz(j)
				const r = Math.sqrt(ex * ex + ez * ez)
				// (under the body: its own, or its dent at d below the struck surface when it stops within a step)
				const x = b.cx(i)
				const under = o.circle !== undefined ? (x - o.circle.x) * (x - o.circle.x) + ez * ez < o.circle.r * o.circle.r : x >= xa && x <= xb && Math.abs(ez) < zr
				let floorY: number
				if (under) {
					if (!quick) continue
					floorY = o.circle !== undefined ? yb + o.circle.r - Math.sqrt(Math.max(0, o.circle.r * o.circle.r - (x - o.circle.x) * (x - o.circle.x) - ez * ez)) : yb
				} else {
					if (r >= Rt) continue
					const u = r / Rt
					floorY = yb + d * u * u
				}
				const over = b.surface(c) - floorY
				if (!(over > 0)) continue
				b.take(c, over, this.scratch)
				// (thrown to land a third of the bowl's radius beyond its edge)
				for (let k = 0; k < b.classes.length; k++) {
					const v = this.scratch[k] as number
					// (from the surface it struck: the grains leave along the bowl's opening, not from its bottom into its wall)
					if (v > 0) this.eject(b, c, k, v, px, 2 * Math.max(0, Rt - r) + 0.66 * Rt, level)
				}
			}
		if (quick) link.halt?.()
		return Dc
	}

	/** One solid on one bed: displaces what it overlaps, and says how it touches (or null). */
	private touch(
		b: Bed,
		link: BodyLink,
		o: ReturnType<BodyLink["outline"]>,
		xa: number,
		xb: number,
		zr: number,
		h: number
	): Touch | null {
		const dx = b.dx
		const i0 = Math.max(0, Math.floor((xa - b.x0) / dx))
		const i1 = Math.min(b.nx - 1, Math.floor((xb - b.x0) / dx))
		const j0 = Math.max(0, Math.floor((-zr - b.z0) / dx))
		const j1 = Math.min(b.nz - 1, Math.floor((zr - b.z0) / dx))
		if (i1 < i0 || j1 < j0) return null
		const skin = 0.001
		const circle = o.circle
		const pts = o.points
		// the body's bottom in each column it covers (NaN: not under it)
		const ni = i1 - i0 + 1
		const nj = j1 - j0 + 1
		const bottom = new Float64Array(ni * nj).fill(Number.NaN)
		let any = false
		for (let i = i0; i <= i1; i++) {
			const x = b.cx(i)
			let colBottom = Number.NaN
			if (pts !== undefined && circle === undefined) colBottom = bottomAt(pts, x)
			for (let j = j0; j <= j1; j++) {
				const z = b.cz(j)
				let yb = Number.NaN
				if (circle !== undefined) {
					const d2 = (x - circle.x) * (x - circle.x) + z * z
					if (d2 < circle.r * circle.r) yb = circle.y - Math.sqrt(circle.r * circle.r - d2)
				} else if (Math.abs(z) < zr) yb = colBottom
				if (Number.isNaN(yb)) continue
				const c = j * b.nx + i
				if ((b.kind[c] as number) !== 0) continue
				if (yb > b.surface(c) + skin) continue
				bottom[(j - j0) * ni + (i - i0)] = yb
				any = true
			}
		}
		if (!any) return null
		// the ring around the footprint: its mean surface is the level the body is buried under
		let ringSum = 0
		let ringN = 0
		const ring: number[] = []
		const inFoot = (i: number, j: number) => i >= i0 && i <= i1 && j >= j0 && j <= j1 && !Number.isNaN(bottom[(j - j0) * ni + (i - i0)] as number)
		for (let j = Math.max(0, j0 - 1); j <= Math.min(b.nz - 1, j1 + 1); j++)
			for (let i = Math.max(0, i0 - 1); i <= Math.min(b.nx - 1, i1 + 1); i++) {
				if (inFoot(i, j)) continue
				const c = j * b.nx + i
				if ((b.kind[c] as number) !== 0) continue
				if (inFoot(i - 1, j) || inFoot(i + 1, j) || inFoot(i, j - 1) || inFoot(i, j + 1)) {
					ring.push(c)
					ringSum += b.surface(c)
					ringN++
				}
			}
		// displace what is above the bottom, to the ring (weighted ahead of the motion); a fast strike throws a share out
		const view = link.view()
		const vx = view.velocity.x
		const vy = view.velocity.y
		let moved = 0
		let area = 0
		let px = 0
		let py = 0
		let low = Number.POSITIVE_INFINITY
		const takenK = b.classes.map(() => 0)
		// (only where the body moves into the sand: its point there going down, or sideways toward that side of it; a body at rest lets grains
		// slide over it: it is buried)
		const ccx = view.center.x
		for (let j = j0; j <= j1; j++)
			for (let i = i0; i <= i1; i++) {
				const yb = bottom[(j - j0) * ni + (i - i0)] as number
				if (Number.isNaN(yb)) continue
				const c = j * b.nx + i
				const s = b.surface(c)
				const over = s - yb
				// (by its centre's motion: a ball turning in its hole does not dig it deeper)
				const into = vy < -MOVING || (Math.abs(vx) > MOVING && (b.cx(i) - ccx) * vx > 0)
				if (over > 0 && into && (b.h[c] as number) > 0) {
					b.take(c, over, this.scratch)
					for (let k = 0; k < takenK.length; k++) {
						takenK[k] = (takenK[k] as number) + (this.scratch[k] as number)
						moved += this.scratch[k] as number
					}
				}
				area += dx * dx
				px += b.cx(i) * dx * dx
				py += yb * dx * dx
				if (yb < low) low = yb
			}
		if (!(area > 0)) return null
		px /= area
		py /= area
		// the level the body is buried under: the surrounding surface, or, while it strikes (down faster than STRIKE, and its first half second in
		// the sand), the surface where it struck (its own crater's opening does not unbury it)
		const key = `${link.id}|${b.id}`
		const ringLevel = ringN > 0 ? ringSum / ringN : low
		let st = this.strikes.get(key)
		if (st === undefined) {
			// (back in the sand within half a second of its bowl: the same strike, falling into the bowl it opened)
			const bw = this.bowls.get(key)
			const again = bw !== undefined && this.tick - bw.tick < BOWL_TICKS
			st = again ? { level: Math.max(ringLevel, bw.level), steps: 0, bowl: 2 } : { level: ringLevel, steps: 0 }
			this.strikes.set(key, st)
		}
		st.steps++
		st.seen = this.tick
		const striking = st.steps < 240 && (vy < -0.05 || st.steps < 4)
		const level = striking ? Math.max(ringLevel, st.level) : ringLevel
		if (!striking) st.level = ringLevel
		if (moved > 0 && ring.length > 0) {
			const speed = Math.sqrt(vx * vx + vy * vy)
			// a fast strike throws it out (ejecta, about half the hole's size beyond its edge); a slow push heaps it around (weighted ahead of the motion)
			const fast = vy < -STRIKE
			const footR = Math.sqrt(area / Math.PI)
			const holeDepth = Math.max(0, level - low)
			const ux = speed > 0.02 ? vx / speed : 0
			let wsum = 0
			const wts = ring.map((c) => {
				const i = c % b.nx
				const j = (c - i) / b.nx
				const ex = b.cx(i) - px
				const ez = b.cz(j)
				const el = Math.sqrt(ex * ex + ez * ez) || 1
				const wgt = Math.max(0.1, 1 + 1.5 * ((ex / el) * ux))
				wsum += wgt
				return wgt
			})
			for (let r = 0; r < ring.length; r++) {
				const c = ring[r] as number
				const share = (wts[r] as number) / wsum
				for (let k = 0; k < takenK.length; k++) {
					const v = (takenK[k] as number) * share
					if (!(v > 0)) continue
					if (fast) this.eject(b, c, k, v, px, footR + holeDepth)
					else b.add(c, k, v)
				}
			}
		}
		// the crater a strike opens, by Uehara et al.'s laws for low-speed impacts [UEHARA03] (the grid's own penetration is a step's travel at
		// best: a light ball's few millimetres are lost in it): once, as the body first strikes, a bowl as deep as their penetration and wide enough
		// that its rim, built by what it throws out, stands their crater's width across; the walls then slump to repose. The body then falls into
		// it: still the same strike (no second bowl) for half a second
		if (vy < -STRIKE && ringN > 0 && st.bowl === undefined) {
			st.bowl = this.bowl(b, link, o, xa, xb, zr, view.mass, Math.sqrt(vx * vx + vy * vy), px, level, h) > 0 ? 1 : 0
			if (st.bowl === 1) this.bowls.set(key, { tick: this.tick, level })
		}
		// (no bowl for it, a body too small for the grid's columns: a fast strike opens a cone round itself, its walls rising at 45° from its lowest
		// point to the surface, D_c ≈ D_b + 2·d; what it opens is thrown out)
		if (vy < -STRIKE && ringN > 0 && !((st.bowl ?? 0) > 0)) {
			const footR = Math.sqrt(area / Math.PI)
			const reach = footR + Math.max(0, level - low)
			const ri0 = Math.max(0, Math.floor((px - reach - b.x0) / dx))
			const ri1 = Math.min(b.nx - 1, Math.floor((px + reach - b.x0) / dx))
			const rj0 = Math.max(0, Math.floor((-reach - b.z0) / dx))
			const rj1 = Math.min(b.nz - 1, Math.floor((reach - b.z0) / dx))
			for (let j = rj0; j <= rj1; j++)
				for (let i = ri0; i <= ri1; i++) {
					if (inFoot(i, j)) continue
					const c = j * b.nx + i
					if ((b.kind[c] as number) !== 0) continue
					const ex = b.cx(i) - px
					const ez = b.cz(j)
					const r = Math.sqrt(ex * ex + ez * ez)
					if (r >= reach || r <= footR) continue
					const wall = low + (r - footR)
					const over = b.surface(c) - wall
					if (!(over > 0) || !((b.h[c] as number) > 0)) continue
					b.take(c, over, this.scratch)
					for (let k = 0; k < takenK.length; k++) {
						const v = this.scratch[k] as number
						if (v > 0) this.eject(b, c, k, v, px, reach)
					}
				}
		}
		const k0 = b.classes.length === 1 ? 0 : 0
		const ci = b.classes[k0] as ClassInfo
		const width = Math.min((j1 - j0 + 1) * dx, 2 * zr)
		const length = Math.max(dx, Math.min(xb - xa, (i1 - i0 + 1) * dx))
		const depth = Math.max(0, level - low)
		return {
			bed: b,
			link,
			area,
			px,
			py,
			depth,
			width,
			length,
			front: depth * width,
			rhoB: ci.rhoB,
			tanPhi: ci.tanRepose,
			vy
		}
	}
}

// ---------------------------------------------------------------- what a region of a bed shows (readings)

/** A pile's numbers in cells where `inside(c)`: its top over the floor (m), the radius of a disc of its footprint (m), its slope (deg), its mass (kg). */
export const pileStats = (b: Bed, inside: (c: number) => boolean, min = 0.001) => {
	let top = 0
	let cells = 0
	let mass = 0
	const A = b.dx * b.dx
	for (let c = 0; c < b.n; c++) {
		if (!inside(c)) continue
		const h = b.h[c] as number
		if (h > top) top = h
		if (h > min) cells++
		for (let k = 0; k < b.classes.length; k++) mass += ((b.hk[k] as Float64Array)[c] as number) * A * (b.classes[k] as ClassInfo).rhoB
	}
	const radius = Math.sqrt((cells * A) / Math.PI)
	// (a cone of height H on a disc of radius R: its slope atan(H/R); the slope's own last millimetre is left out of the footprint)
	const slope = radius > 0 && top > min ? (Math.atan2(top - min, radius) * 180) / Math.PI : 0
	return { top, radius, slope, mass }
}

/**
 * A crater's numbers in cells where `inside(c)`, against the bed as it started: its deepest point below the start (m), where (x, z), the hole's
 * diameter (where the surface is below the start, as a disc) and the crater's diameter (m: to its rim's crest, the ring around the deepest point
 * standing highest over the start, within 1.5 holes' widths; the hole's when no rim stands up), 0 when no crater.
 */
export const craterStats = (b: Bed, inside: (c: number) => boolean, min = 0.001) => {
	let deep = 0
	for (let c = 0; c < b.n; c++) {
		if (!inside(c) || (b.kind[c] as number) !== 0) continue
		const d = (b.h0[c] as number) - (b.h[c] as number)
		if (d > deep) deep = d
	}
	if (!(deep > min)) return { depth: 0, diameter: 0, x: 0, z: 0, hole: 0 }
	// the hole: where the surface stands below the start, as a disc's diameter; its middle, the hole's centroid weighted by how deep each column
	// is (between columns: a ball dropped anywhere is measured from where it struck)
	let below = 0
	let wx = 0
	let wz = 0
	let w = 0
	for (let c = 0; c < b.n; c++) {
		if (!inside(c) || (b.kind[c] as number) !== 0) continue
		const d = (b.h0[c] as number) - (b.h[c] as number)
		if (!(d > min)) continue
		below++
		const i = c % b.nx
		wx += b.cx(i) * d
		wz += b.cz((c - i) / b.nx) * d
		w += d
	}
	const hole = 2 * Math.sqrt((below * b.dx * b.dx) / Math.PI)
	const cx = wx / w
	const cz = wz / w
	// the rim's crest: the ring (half a column wide) round the middle standing highest over the start, within 1.5 holes' widths, its radius found
	// between rings by the parabola through the highest and its two neighbours (a ruler's reading, not a column's step)
	const bin = 0.5 * b.dx
	const reach = Math.max(4, Math.ceil((1.5 * hole) / bin))
	const sum = new Float64Array(reach + 2)
	const cnt = new Float64Array(reach + 2)
	for (let c = 0; c < b.n; c++) {
		if (!inside(c) || (b.kind[c] as number) !== 0) continue
		const i = c % b.nx
		const j = (c - i) / b.nx
		const ex = b.cx(i) - cx
		const ez = b.cz(j) - cz
		const r = Math.floor(Math.sqrt(ex * ex + ez * ez) / bin + 0.5)
		if (r > reach + 1) continue
		sum[r] = (sum[r] as number) + ((b.h[c] as number) - (b.h0[c] as number))
		cnt[r] = (cnt[r] as number) + 1
	}
	const mean = (r: number) => ((cnt[r] as number) > 0 ? (sum[r] as number) / (cnt[r] as number) : Number.NaN)
	let best = 0
	let bestR = 0
	for (let r = 1; r <= reach; r++) {
		const m = mean(r)
		if (m > best) {
			best = m
			bestR = r
		}
	}
	let rim = hole
	if (best > min / 2) {
		const a = mean(bestR - 1)
		const c = mean(bestR + 1)
		let off = 0
		if (Number.isFinite(a) && Number.isFinite(c)) {
			const den = a - 2 * best + c
			if (den < 0) off = Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den))
		}
		rim = 2 * (bestR + off) * bin
	}
	return { depth: deep, diameter: Math.max(rim, hole), x: cx, z: cz, hole }
}

// ---------------------------------------------------------------- vessels (a funnel, an hourglass's bulbs) and fills

export interface VesselSpec {
	readonly id: string
	readonly owner: string
	/** The vessel's axis (world x; z = 0) and the height of its lowest inside point (m). */
	readonly cx: number
	readonly base: number
	/** "cone": a funnel (and an hourglass's upper bulb), its wall `wall` degrees from level; "bowl": a round bottom (an hourglass's lower bulb). */
	readonly shape: "cone" | "bowl"
	/** Inner radius at its widest (m), the outlet's radius (m, cone only), the wall's slope (deg, cone only), its rim's height (m). */
	readonly R: number
	readonly rOut: number
	readonly wall: number
	readonly top: number
	readonly dx: number
	readonly classes: readonly ClassInfo[]
	readonly gravity: number
}

/** A vessel's bed: its inside as a floor (an odd grid, its axis on a column's middle), walls beyond its widest radius. */
export const vesselBed = (v: VesselSpec) => {
	const half = Math.ceil(v.R / v.dx)
	const nx = 2 * half + 1
	const x0 = v.cx - (nx * v.dx) / 2
	const z0 = -(nx * v.dx) / 2
	const n = nx * nx
	const floor = new Float64Array(n)
	const kind = new Uint8Array(n)
	const tw = Math.sin((v.wall * Math.PI) / 180) / Math.cos((v.wall * Math.PI) / 180)
	for (let j = 0; j < nx; j++)
		for (let i = 0; i < nx; i++) {
			const c = j * nx + i
			const ex = x0 + (i + 0.5) * v.dx - v.cx
			const ez = z0 + (j + 0.5) * v.dx
			const r = Math.sqrt(ex * ex + ez * ez)
			if (r > v.R) {
				kind[c] = 1
				floor[c] = v.top + 1
				continue
			}
			if (v.shape === "cone") floor[c] = v.base + Math.max(0, r - v.rOut) * tw
			else floor[c] = v.base + v.R - Math.sqrt(Math.max(0, v.R * v.R - r * r))
			if (floor[c] > v.top) {
				kind[c] = 1
				floor[c] = v.top + 1
			}
		}
	return new Bed({ id: v.id, owner: v.owner, x0, z0, dx: v.dx, nx, nz: nx, floor, kind, classes: v.classes, ceiling: v.top, gravity: v.gravity })
}

/** The cells of a bed within radius r of (x, 0) (at least the one holding it). */
export const cellsWithin = (b: Bed, x: number, r: number) => {
	const out: number[] = []
	for (let j = 0; j < b.nz; j++)
		for (let i = 0; i < b.nx; i++) {
			const ex = b.cx(i) - x
			const ez = b.cz(j)
			if (ex * ex + ez * ez <= r * r && (b.kind[j * b.nx + i] as number) === 0) out.push(j * b.nx + i)
		}
	if (out.length === 0) {
		const c = b.cellAt(x, 0)
		if (c >= 0) out.push(c)
	}
	return out
}

/** Fills a bed with `vol` m³ of class k to a level surface (no higher than its ceiling): returns the volume that fitted. */
export const fillLevel = (b: Bed, k: number, vol: number, inside: (c: number) => boolean = () => true) => {
	if (!(vol > 0)) return 0
	const A = b.dx * b.dx
	const below = (L: number) => {
		let s = 0
		for (let c = 0; c < b.n; c++) if ((b.kind[c] as number) === 0 && inside(c)) s += Math.max(0, L - b.surface(c))
		return s * A
	}
	let lo = Number.POSITIVE_INFINITY
	for (let c = 0; c < b.n; c++) if ((b.kind[c] as number) === 0 && inside(c)) lo = Math.min(lo, b.surface(c))
	if (!Number.isFinite(lo)) return 0
	let hi = b.ceiling
	if (below(hi) <= vol) {
		const all = below(hi)
		for (let c = 0; c < b.n; c++) if ((b.kind[c] as number) === 0 && inside(c)) b.add(c, k, Math.max(0, hi - b.surface(c)) * A)
		return all
	}
	for (let it = 0; it < 60; it++) {
		const mid = 0.5 * (lo + hi)
		if (below(mid) < vol) lo = mid
		else hi = mid
	}
	const L = 0.5 * (lo + hi)
	const add: number[] = []
	for (let c = 0; c < b.n; c++) add.push((b.kind[c] as number) === 0 && inside(c) ? Math.max(0, L - b.surface(c)) * A : 0)
	let total = 0
	for (const v of add) total += v
	const scale = total > 0 ? vol / total : 0
	for (let c = 0; c < b.n; c++) if ((add[c] as number) > 0) b.add(c, k, (add[c] as number) * scale)
	return vol
}

/**
 * Adds a cone of `vol` m³ of class k centred at (x, z) at the slope tan θ (a heap poured there), on whatever the bed's surface is, only in cells
 * where `inside(c)` (what the heap stands on: a shelf's top, not the table 40 cm under it). Exactly `vol` m³ is laid down: when even the lowest
 * cone holds more (columns far below its middle, a slope steeper than θ), every column's share is scaled down to it. Returns the volume laid.
 */
export const heapCone = (b: Bed, k: number, vol: number, x: number, z: number, tanT: number, inside?: (c: number) => boolean) => {
	if (!(vol > 0)) return 0
	const A = b.dx * b.dx
	// the cone's height H over the surface at its middle: its volume on the actual surface, found by bisection
	const c0 = b.cellAt(x, z)
	const base = c0 >= 0 ? b.surface(c0) : 0
	let scale = 1
	const shape = (H: number, apply: boolean) => {
		let s = 0
		for (let c = 0; c < b.n; c++) {
			if ((b.kind[c] as number) !== 0 || (inside !== undefined && !inside(c))) continue
			const i = c % b.nx
			const j = (c - i) / b.nx
			const ex = b.cx(i) - x
			const ez = b.cz(j) - z
			const top = base + H - Math.sqrt(ex * ex + ez * ez) * tanT
			const d = top - b.surface(c)
			if (d > 0) {
				s += d * A
				if (apply) b.add(c, k, d * A * scale)
			}
		}
		return s
	}
	let lo = 0
	let hi = 0.05
	while (shape(hi, false) < vol && hi < 20) hi *= 2
	for (let it = 0; it < 60; it++) {
		const mid = 0.5 * (lo + hi)
		if (shape(mid, false) < vol) lo = mid
		else hi = mid
	}
	const H = 0.5 * (lo + hi)
	// (the cone found holds vol to a part in 10¹⁸; one that cannot shrink to it (it holds more at H → 0) is scaled: grains are never made)
	const s = shape(H, false)
	if (s > vol * (1 + 1e-9)) scale = vol / s
	return shape(H, true) * scale
}

// ---------------------------------------------------------------- containers that hold grains: a jar, a cup, a beaker, a bucket, a box (2026-10-20)

type Pt = { readonly x: number; readonly y: number }
/** A solid's outline as the engine gives it (world m): a circle, or a convex polygon. */
export type Outline = { readonly circle?: { readonly x: number; readonly y: number; readonly r: number }; readonly points?: readonly Pt[] }

/**
 * A container's inside as a bed sees it (world m). In plan its inside is round (a circle, or an ellipse when it is deeper or shallower front to
 * back than it is wide: `k`, its inner half-depth over its inner half-width) or a box, about its axis at (x, z = 0). Its floor stands at
 * `floor`; its walls' inner faces run straight from half-width `r0` at the floor through (rb, ylo) to (rt, yhi), so a tapered cup's lean out;
 * `t` its wall's thickness, `rim` the height of its highest solid (a jar's neck), what a bed's wall columns stand to.
 */
export interface Holder {
	readonly item: string
	readonly round: boolean
	readonly x: number
	readonly floor: number
	readonly r0: number
	readonly rb: number
	readonly ylo: number
	readonly rt: number
	readonly yhi: number
	readonly t: number
	readonly rim: number
	readonly k: number
}

/** A point's plan distance from a holder's axis, measured as along its width (x): round, the ellipse's; a box, the larger of x and z. */
export const holderQ = (H: Holder, x: number, z: number) => {
	const ex = Math.abs(x - H.x)
	const ez = Math.abs(z) / H.k
	return H.round ? Math.sqrt(ex * ex + ez * ez) : Math.max(ex, ez)
}

/** The height of a holder's inside at plan distance q (≤ rt): its floor out to r0, then its leaning wall's inner face (a tapered cup's). */
export const holderFloor = (H: Holder, q: number) => {
	if (q <= H.r0 || !(H.rt > H.rb + 1e-9)) return H.floor
	return H.ylo + ((Math.min(q, H.rt) - H.rb) * (H.yhi - H.ylo)) / (H.rt - H.rb)
}

/** The width of the ring of wall columns round a holder's inside, in plan units along x: its wall, but never thinner than a column (or the
 *  grains of an inside column could reach an outside one through a face): along z a column is dx/k of those units. */
export const holderRing = (H: Holder, dx: number) => Math.max(H.t, 1.01 * dx * Math.max(1, 1 / H.k))

/** A convex outline's span along x at height y: [lo, hi], or [NaN, NaN] when the line misses it. */
export const spanAtY = (o: Outline, y: number): [number, number] => {
	if (o.circle !== undefined) {
		const dy = y - o.circle.y
		if (Math.abs(dy) >= o.circle.r) return [Number.NaN, Number.NaN]
		const dx = Math.sqrt(o.circle.r * o.circle.r - dy * dy)
		return [o.circle.x - dx, o.circle.x + dx]
	}
	const pts = o.points ?? []
	let lo = Number.POSITIVE_INFINITY
	let hi = Number.NEGATIVE_INFINITY
	for (let k = 0; k < pts.length; k++) {
		const a = pts[k] as Pt
		const b = pts[(k + 1) % pts.length] as Pt
		if ((y < a.y && y < b.y) || (y > a.y && y > b.y)) continue
		if (a.y === b.y) {
			lo = Math.min(lo, a.x, b.x)
			hi = Math.max(hi, a.x, b.x)
			continue
		}
		const x = a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x)
		if (x < lo) lo = x
		if (x > hi) hi = x
	}
	return lo <= hi ? [lo, hi] : [Number.NaN, Number.NaN]
}

const topOf = (o: Outline) => (o.circle !== undefined ? o.circle.y + o.circle.r : Math.max(...(o.points ?? []).map((p) => p.y)))

/**
 * A container's inside from its solids' outlines as the run starts: its floor's top (it must stand level: a tipped container holds nothing
 * of a bed), its left walls' inner (right) faces and its right walls' inner (left) faces just above the floor and just below their tops, the
 * left wall's thickness, the highest of all its solids (`all`), and its front-to-back size (`depth`, its walls' depth). Null when they do not
 * make an inside (walls missing, crossed, or the floor tipped more than 2°).
 */
export const holderOf = (spec: {
	readonly item: string
	readonly round: boolean
	readonly floor: Outline
	readonly left: readonly Outline[]
	readonly right: readonly Outline[]
	readonly all: readonly Outline[]
	readonly depth: number
}): Holder | null => {
	const f = spec.floor
	if (f.points === undefined || f.points.length < 3 || spec.left.length === 0 || spec.right.length === 0) return null
	// its top edge: the edge whose middle stands highest; level within 2° (tan 2° = 0.0349)
	let best = -1
	let bestY = Number.NEGATIVE_INFINITY
	const n = f.points.length
	for (let k = 0; k < n; k++) {
		const a = f.points[k] as Pt
		const b = f.points[(k + 1) % n] as Pt
		const my = 0.5 * (a.y + b.y)
		if (my > bestY) {
			bestY = my
			best = k
		}
	}
	const a = f.points[best] as Pt
	const b = f.points[(best + 1) % n] as Pt
	if (!(Math.abs(b.x - a.x) > 1e-6) || Math.abs(b.y - a.y) > 0.0349 * Math.abs(b.x - a.x)) return null
	const floor = Math.max(a.y, b.y)
	const wallTop = Math.min(Math.max(...spec.left.map(topOf)), Math.max(...spec.right.map(topOf)))
	const H = wallTop - floor
	if (!(H > 0.004)) return null
	const e = Math.min(0.002, 0.1 * H)
	const ylo = floor + e
	const yhi = wallTop - e
	// a left wall's inner face is its right side, a right wall's its left side (the highest/lowest of the walls that reach that height)
	const innerL = (y: number) => {
		let v = Number.NaN
		for (const o of spec.left) {
			const s = spanAtY(o, y)
			if (Number.isFinite(s[1]) && !(v >= s[1])) v = s[1]
		}
		return v
	}
	const innerR = (y: number) => {
		let v = Number.NaN
		for (const o of spec.right) {
			const s = spanAtY(o, y)
			if (Number.isFinite(s[0]) && !(v <= s[0])) v = s[0]
		}
		return v
	}
	const aL = innerL(ylo)
	const aR = innerR(ylo)
	const bL = innerL(yhi)
	const bR = innerR(yhi)
	if (![aL, aR, bL, bR].every(Number.isFinite) || !(aR - aL > 0.004) || !(bR - bL > 0.004)) return null
	const rb = 0.5 * (aR - aL)
	const rt = 0.5 * (bR - bL)
	// (the floor's edge, where the wall's inner face meets the floor: back down the face's line from (rb, ylo))
	const r0 = rt > rb + 1e-9 ? Math.max(0, rb - ((ylo - floor) * (rt - rb)) / (yhi - ylo)) : rb
	const mid = 0.5 * (floor + wallTop)
	let t = Number.NaN
	for (const o of spec.left) {
		const s = spanAtY(o, mid)
		if (Number.isFinite(s[0]) && Number.isFinite(s[1])) t = Number.isFinite(t) ? Math.max(t, s[1] - s[0]) : s[1] - s[0]
	}
	if (!(t > 0)) t = 0.003
	let rim = wallTop
	for (const o of spec.all) rim = Math.max(rim, topOf(o))
	const depth = spec.depth > 0 ? spec.depth : 2 * (rt + t)
	const k = spec.round ? depth / (2 * (rt + t)) : Math.max(0.05, (0.5 * depth - t) / rt)
	return { item: spec.item, round: spec.round, x: 0.5 * (aL + aR), floor, r0, rb, ylo, rt, yhi, t, rim, k: Math.max(0.05, k) }
}

/**
 * The heap in a holder: its top over the holder's floor (m), its slope (deg) and its mass (kg), over the bed's cells `inside`. Its slope is its
 * surface's own steepness, the upper quartile of the slope of the surface over the columns of the floor (`floorCells`: out to where a tapered
 * cup's wall leans) that hold grains (central differences between those columns: a cone's or a slope's faces, not its top or a flat), not
 * atan(height ÷ footprint radius) as for a free heap: in a jar the footprint is the whole floor (the lesson's "the grains pile up in the
 * glass"), in a box it is cut by its walls; fewer than 8 such columns, that free heap's formula. `confined`: its foot reaches the floor's
 * edge (half or more of the columns `edge`, the floor's outermost ring, hold grains).
 */
export const heapIn = (b: Bed, inside: readonly number[], edge: readonly number[], floorCells: readonly number[], min = 0.001) => {
	let top = 0
	let peak = -1
	let cells = 0
	let mass = 0
	const A = b.dx * b.dx
	for (const c of inside) {
		const h = b.h[c] as number
		if (h > top) {
			top = h
			peak = c
		}
		if (h > min) cells++
		for (let k = 0; k < b.classes.length; k++) mass += ((b.hk[k] as Float64Array)[c] as number) * A * (b.classes[k] as ClassInfo).rhoB
	}
	const radius = Math.sqrt((cells * A) / Math.PI)
	const free = radius > 0 && top > min ? (Math.atan2(top - min, radius) * 180) / Math.PI : 0
	if (peak < 0) return { top, radius, slope: 0, mass, confined: false }
	// the columns of its floor's edge that hold grains: is its foot there?
	const nx = b.nx
	const nz = b.nz
	const held = new Uint8Array(b.n)
	for (const c of floorCells) if ((b.h[c] as number) > min) held[c] = 1
	let wetEdge = 0
	for (const c of edge) if (held[c] === 1) wetEdge++
	const confined = edge.length > 0 && wetEdge >= 0.5 * edge.length
	// the surface's slope at each column of the floor that holds grains (central differences; one-sided beside a column that does not)
	const slopes: number[] = []
	for (const c of floorCells) {
		if (held[c] !== 1) continue
		const i = c % nx
		const j = (c - i) / nx
		const s0 = b.surface(c)
		const at = (cc: number, ok: boolean) => (ok && held[cc] === 1 ? b.surface(cc) : Number.NaN)
		const e = at(c + 1, i < nx - 1)
		const w = at(c - 1, i > 0)
		const n = at(c + nx, j < nz - 1)
		const sth = at(c - nx, j > 0)
		const gx = Number.isFinite(e) && Number.isFinite(w) ? (e - w) / (2 * b.dx) : Number.isFinite(e) ? (e - s0) / b.dx : Number.isFinite(w) ? (s0 - w) / b.dx : Number.NaN
		const gz = Number.isFinite(n) && Number.isFinite(sth) ? (n - sth) / (2 * b.dx) : Number.isFinite(n) ? (n - s0) / b.dx : Number.isFinite(sth) ? (s0 - sth) / b.dx : Number.NaN
		if (!Number.isFinite(gx) || !Number.isFinite(gz)) continue
		slopes.push(Math.sqrt(gx * gx + gz * gz))
	}
	if (slopes.length < 8) return { top, radius, slope: free, mass, confined }
	slopes.sort((p, q) => p - q)
	const q3 = slopes[Math.min(slopes.length - 1, Math.floor(0.75 * slopes.length))] as number
	return { top, radius, slope: (Math.atan2(q3, 1) * 180) / Math.PI, mass, confined }
}

// ---------------------------------------------------------------- a cup of grains a hand tips (a pitcher, a jug, a measuring cup)

/** The area of a convex polygon (counter-clockwise or not) on the side n·p ≤ c of a line (Sutherland-Hodgman's one clip). */
export const clipArea = (poly: readonly Pt[], nx: number, ny: number, c: number) => {
	const out: Pt[] = []
	const n = poly.length
	for (let k = 0; k < n; k++) {
		const p = poly[k] as Pt
		const q = poly[(k + 1) % n] as Pt
		const dp = nx * p.x + ny * p.y - c
		const dq = nx * q.x + ny * q.y - c
		if (dp <= 0) out.push(p)
		if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) {
			const u = dp / (dp - dq)
			out.push({ x: p.x + u * (q.x - p.x), y: p.y + u * (q.y - p.y) })
		}
	}
	let a2 = 0
	for (let k = 0; k < out.length; k++) {
		const p = out[k] as Pt
		const q = out[(k + 1) % out.length] as Pt
		a2 += p.x * q.y - q.x * p.y
	}
	return Math.abs(a2) / 2
}

/** The length of the line n·p = c inside a convex polygon (0 when it misses it). */
export const chordLength = (poly: readonly Pt[], nx: number, ny: number, c: number) => {
	const hits: Pt[] = []
	const n = poly.length
	for (let k = 0; k < n; k++) {
		const p = poly[k] as Pt
		const q = poly[(k + 1) % n] as Pt
		const dp = nx * p.x + ny * p.y - c
		const dq = nx * q.x + ny * q.y - c
		if ((dp <= 0 && dq > 0) || (dp > 0 && dq <= 0)) {
			const u = dp / (dp - dq)
			hits.push({ x: p.x + u * (q.x - p.x), y: p.y + u * (q.y - p.y) })
		}
	}
	if (hits.length < 2) return 0
	const a = hits[0] as Pt
	const b = hits[1] as Pt
	return Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y))
}

/** The offset c of the line with normal n that leaves `area` of the polygon on its side n·p ≤ c (bisection, 60 halvings). */
export const levelFor = (poly: readonly Pt[], nx: number, ny: number, area: number) => {
	let lo = Number.POSITIVE_INFINITY
	let hi = Number.NEGATIVE_INFINITY
	for (const p of poly) {
		const d = nx * p.x + ny * p.y
		if (d < lo) lo = d
		if (d > hi) hi = d
	}
	if (!(area > 0)) return lo
	for (let it = 0; it < 60; it++) {
		const mid = 0.5 * (lo + hi)
		if (clipArea(poly, nx, ny, mid) < area) lo = mid
		else hi = mid
	}
	return 0.5 * (lo + hi)
}

/**
 * A cup of grains that a hand tips (TipCup): its grains are one section of its inside (a box in the cup's own frame, its opening from the top
 * left corner to the top right) times its depth (the horizontal area over its width), under a flat surface.
 *  - While the cup turns, its grains turn with it (a heap at rest in a cup is a solid), until their surface stands steeper than their angle of
 *    repose: then it slumps to that angle (an avalanche inside the cup), keeping its area.
 *  - They hold up to the line at that slope through the lowest corner of the opening (the lip, once the cup is tipped toward it); what lies above
 *    it slides out over that corner as a surface avalanche: its flowing layer, the excess spread along the surface (δ = excess ÷ the surface's
 *    length), leaves at the speed of a granular slump, √(g·δ) [LUBE04] (provisional), as δ·√(g·δ) of section a second; it starts as soon as
 *    anything lies over that line, and stops once the layer is thinner than two grains (an avalanche stops where its slope is back to repose, as
 *    a bed's face does: a static angle a little over the moving one, the hysteresis of a real heap). So a full cup starts to pour as its
 *    tilt passes the angle of repose, a cup filled to a share f of its height h and w wide at φ + atan(2h(1 − f)/w) (while that line leaves by
 *    the cup's back wall), and the grains go out as fast as the hand tips it, no faster than they can slide. Tipped past 90° + φ its spout
 *    wall is steeper than repose too and it empties; short of that, what rests on that wall stays (a cup of sugar tipped to 115° keeps a
 *    little in its corner).
 * Lengths m, areas m², angles rad; poses are the cup's root solid's (its origin the lip, as the flow module's pitcher).
 */
export class TipCup {
	readonly inside: readonly Pt[]
	readonly depth: number
	readonly tanPhi: number
	/** the grains' size (m): a flowing layer thinner than two of them stops */
	readonly grain: number
	/** m² of the section holding grains now, and at the start (what fitted) */
	area: number
	readonly start: number
	/** the surface: its unit normal in the cup's frame (out of the grains) and its offset (n·p = c on it) */
	nx = 0
	ny = 1
	c = 0
	/** m² poured so far; m² that left this step; the flowing layer's speed (m/s) and the world direction it leaves the corner (unit) */
	poured = 0
	out = 0
	speed = 0
	ux = 0
	uy = -1
	/** the corner of the opening it pours over (0: the top left, 1: the top right), in the cup's frame */
	corner = 1
	/** whether its grains are sliding out (from when anything lies over the repose line through the lip until the layer is under two grains),
	 *  and the excess (m²) left lying when they last stopped: they start again only once the hand tips them past it */
	flowing = false
	private rest = 0
	private lastAngle = Number.NaN
	constructor(inside: readonly Pt[], depth: number, volume: number, tanPhi: number, grain = 0.0005) {
		this.inside = inside
		this.depth = depth
		this.tanPhi = tanPhi
		this.grain = grain
		const full = clipArea(inside, 0, 1, Number.POSITIVE_INFINITY)
		this.area = Math.min(Math.max(0, volume / depth), full)
		this.start = this.area
		this.c = levelFor(inside, 0, 1, this.area)
	}
	/** The volume (m³ packed) in it now. */
	volume() {
		return this.area * this.depth
	}
	/**
	 * One step of dt s with the cup at world angle `angle` (rad): its grains turn with it or slump; what is over the opening's lowest corner
	 * slides out. Returns the volume (m³ packed) that left; `speed`, `ux`, `uy` and `corner` say how it leaves.
	 */
	step(angle: number, dt: number, gravity: number) {
		this.out = 0
		this.speed = 0
		this.lastAngle = angle
		if (!(this.area > 0)) return 0
		const ca = Math.cos(angle)
		const sa = Math.sin(angle)
		// the surface's normal in the world (it turned with the cup: the same in the cup's frame)
		let wx = ca * this.nx - sa * this.ny
		let wy = sa * this.nx + ca * this.ny
		// steeper than repose (or past vertical): it slumps to the angle of repose, downhill the way it leans
		if (!(wy > 0) || Math.abs(wx) > this.tanPhi * wy) {
			const s = wx >= 0 ? 1 : -1
			const L = Math.sqrt(1 + this.tanPhi * this.tanPhi)
			wx = (s * this.tanPhi) / L
			wy = 1 / L
			this.nx = ca * wx + sa * wy
			this.ny = -sa * wx + ca * wy
			this.c = levelFor(this.inside, this.nx, this.ny, this.area)
		}
		// what it can hold: up to the line through the opening's lowest corner (relative to the surface)
		const tl = this.inside[3] as Pt
		const tr = this.inside[2] as Pt
		const dl = this.nx * tl.x + this.ny * tl.y
		const dr = this.nx * tr.x + this.ny * tr.y
		this.corner = dr <= dl ? 1 : 0
		const cMax = Math.min(dl, dr)
		const hold = clipArea(this.inside, this.nx, this.ny, cMax)
		const excess = this.area - hold
		const len = Math.max(chordLength(this.inside, this.nx, this.ny, cMax), 0.005)
		// (the flowing layer: the excess spread along that line, but never thicker than the grains standing over it, from the line (or their
		// deepest point, when the line is under them all) to their surface: where the line only clips the opening's corner, its chord is short and
		// excess ÷ chord was a layer as thick as the cup is long, at once: a cup of sugar tipped past 90° + φ threw 69 mL in one step at 1.8 m/s)
		let lo = Number.POSITIVE_INFINITY
		for (const p of this.inside) lo = Math.min(lo, this.nx * p.x + this.ny * p.y)
		const delta = Math.min(excess / len, Math.max(0, this.c - Math.max(cMax, lo)))
		if (!(excess > 1e-12)) {
			this.flowing = false
			this.rest = 0
		} else if (!this.flowing) {
			if (excess > this.rest + 1e-12 || hold <= 0) this.flowing = true
			else this.rest = Math.min(this.rest, excess)
		} else if (delta < 2 * this.grain && hold > 0) {
			this.flowing = false
			this.rest = excess
		}
		if (this.flowing) {
			const v = Math.sqrt(gravity * Math.max(delta, 2 * this.grain))
			const out = Math.min(excess, Math.max(delta, 2 * this.grain) * v * dt)
			this.area -= out
			if (this.area < 1e-12) this.area = 0
			this.poured += out
			this.out = out * this.depth
			this.speed = v
			// (downhill along the surface, in the world: perpendicular to its normal, pointing down)
			let tx = wy
			let ty = -wx
			if (ty > 0) {
				tx = -tx
				ty = -ty
			}
			this.ux = tx
			this.uy = ty
			this.c = levelFor(this.inside, this.nx, this.ny, this.area)
		}
		return this.out
	}
	/** The world position of the corner it pours over, for a cup whose root is at (x, y) turned `angle`. */
	cornerAt(x: number, y: number, angle: number) {
		const p = this.inside[this.corner === 1 ? 2 : 3] as Pt
		const ca = Math.cos(angle)
		const sa = Math.sin(angle)
		return { x: x + p.x * ca - p.y * sa, y: y + p.x * sa + p.y * ca }
	}
	/** The angle it was last stepped at (NaN before its first step). */
	get angle() {
		return this.lastAngle
	}
}
