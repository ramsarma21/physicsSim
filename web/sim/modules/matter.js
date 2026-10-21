// The matter module: the particle model of solids, liquids and gases; dissolving and solutions; mixtures and how to separate them; mass
// conserved on a scale through melting, dissolving, breaking and reactions; a gas-making reaction in an open or closed bottle; gases have
// mass; density blocks.
// A port of machines/mod_matter.py, line by line (same names, same order, same numbers); plain ES module. web/sim/modules/index.js registers
// it (register_all, as a catalog file's); its `plugin` export is the AI's view of it (goal kinds, digest, knobs, prompt lines, placement
// rules, change words: web/sim/plugins.js). Sources: see the Python file's docstring ([CRC], [NIST-WB], [CODATA18], [USDA], [VINEGAR], [BD],
// [FIFA], [ISO-AIR], [WHATMAN], [CARMAN], [R&S]). The engine side is tooling/src/sim/modules/matter.ts with the physics in tooling/src/sim/matter/*.ts.
// (x ** (1/3) is web/sim/engine-math.js's pow: correctly rounded, as machines/crmath.py's cr_pow)
import { pow } from "../engine-math.js"

let register, ItemType, Prop, Link, Readout, MATERIALS, add_look, LOOK_FILL, LOOK_SHADE, register_goal_kind, register_warning_hook, TYPES, CATEGORIES, props_of, define_material
let pyRound, pyRoundInt, pymin, pymax, hasOwn, truthy, fmtF, maxOf, minOf, pyStrip, pyLower

export const MODULE = "matter"
const CAT = "Matter"

export function register_all(g) {
	;({ register, ItemType, Prop, Link, Readout, MATERIALS, add_look, LOOK_FILL, LOOK_SHADE, register_goal_kind, register_warning_hook, TYPES, CATEGORIES, props_of, define_material } = g)
	;({ pyRound, pyRoundInt, pymin, pymax, hasOwn, truthy, fmtF, maxOf, minOf, pyStrip, pyLower } = g.py)
	if (!CATEGORIES.includes(CAT)) CATEGORIES.push(CAT)
	_looks()
	_materials()
	_model_types()
	_solution_types()
	_conservation_types()
	_mixture_types()
	_separating_types()
	_density_types()
	_chemistry_types()
	_atom_types()
	_goals()
	register_warning_hook(_matter_warnings)
}

// ---------------------------------------------------------------- looks and materials
function _looks() {
	add_look("box acrylic", { fill: "#dfe9ef", shade: "#a9bccb", roughness: 0.05, metalness: 0.0, clearcoat: 1.0, transmission: 0.9, ior: 1.49, thickness: 0.006 })
	add_look("chocolate bar", { fill: "#5a3422", shade: "#3d2216", roughness: 0.35, metalness: 0.0, clearcoat: 0.3 })
	add_look("bag film", { fill: "#eef4f8", shade: "#c8d4dc", roughness: 0.15, metalness: 0.0, clearcoat: 0.8, transmission: 0.85, ior: 1.5, thickness: 0.0005 })
	add_look("glass water", { fill: "#c4dff0", shade: "#8fbcd8", roughness: 0.05, metalness: 0.0, clearcoat: 1.0, transmission: 0.85, ior: 1.333, thickness: 0.05 })
	add_look("hot plate", { fill: "#e9e7e2", shade: "#b9b6ae", roughness: 0.45, metalness: 0.1, clearcoat: 0.3 })
	add_look("pet bottle", { fill: "#d7ecf2", shade: "#9cc3cf", roughness: 0.08, metalness: 0.0, clearcoat: 1.0, transmission: 0.85, ior: 1.57, thickness: 0.0004 })
	add_look("cube brass", { fill: "#c9a447", shade: "#9a7a2c", roughness: 0.3, metalness: 1.0, clearcoat: 0.0 })
	add_look("cube zinc", { fill: "#b9bfc4", shade: "#8d9399", roughness: 0.4, metalness: 1.0, clearcoat: 0.0 })
	add_look("cube copper", { fill: "#c46a3c", shade: "#8a4423", roughness: 0.3, metalness: 1.0, clearcoat: 0.0 })
	add_look("cube pvc", { fill: "#e9ecef", shade: "#b9bec4", roughness: 0.35, metalness: 0.0, clearcoat: 0.3 })
	add_look("cube hdpe", { fill: "#f4f1e8", shade: "#cfc9b8", roughness: 0.45, metalness: 0.0, clearcoat: 0.1 })
	add_look("cube nylon", { fill: "#efe9dc", shade: "#c8bfac", roughness: 0.4, metalness: 0.0, clearcoat: 0.2 })
}

function _mat(key, kw) {
	const values = { ...kw }
	if (!("rolling" in values)) values.rolling = 0.0
	if (!("side" in values)) values.side = 0.0
	if (!hasOwn(MATERIALS, key)) define_material(key, values, [])
}

function _materials() {
	_mat("box acrylic", { density: 1180.0, bounce: 0.6, friction: 0.5, rolling: 0.01, look: "box acrylic", source: "Acrylic (PMMA) 1180 kg/m³ [CRC]; bounce and friction provisional." })
	_mat("glass", { density: 2500.0, bounce: 0.92, friction: 0.4, rolling: 0.001, side: 0.1, look: "glass",
		source: "Soda-lime glass 2500 kg/m³; glass on glass, kinetic friction about 0.4 (Engineering ToolBox). Hard, so a high bounce: provisional." })
	_mat("chocolate bar", { density: 1300.0, bounce: 0.1, friction: 0.6, rolling: 0.05, look: "chocolate bar",
		source: "Dark chocolate about 1.3 g/cm³ (approximate; a bar's mass is set by its own prop). It snaps rather than bounces." })
	_mat("bag film", { density: 920.0, bounce: 0.2, friction: 0.5, rolling: 0.02, look: "bag film",
		source: "LDPE film 910-940 kg/m³; a sandwich bag 16 × 15 cm weighs about 2 g (its own prop sets the mass)." })
	_mat("liquid water", { density: 998.2, bounce: 0.0, friction: 0.0, rolling: 0.0, look: "glass water",
		source: "Liquid water 998.2 kg/m³ at 20 °C [IAPWS-95]; inside a glass, welded to it: it only adds its weight." })
	_mat("ballast", { density: 1000.0, bounce: 0.0, friction: 0.0, rolling: 0.0, look: "steel",
		source: "A hidden carrier of a mass no solid shows (dissolved salt, gas still in a bottle, air in a ball, melt water in a bag): its density is set per item." })
	_mat("hot plate", { density: 2000.0, bounce: 0.3, friction: 0.5, rolling: 0.01, look: "hot plate", source: "A lab hot plate's enamelled steel case (fixed in place)." })
	// (the density set's materials are the module's own, so another module's "copper" or "pine" never changes a cube's density)
	for (const [key, rho, look, src] of DENSITY_MATERIALS) _mat(`density set ${key}`, { density: rho, bounce: 0.5, friction: 0.45, rolling: 0.005, look, source: src })
}

// the density-cube set: [material key, density kg/m³, look, source]
export const DENSITY_MATERIALS = [
	["aluminium", 2700.0, "aluminium", "Aluminium 2.70 g/cm³ [CRC]."],
	["brass", 8500.0, "cube brass", "Brass (cartridge, 70/30) 8.50 g/cm³ [CRC]."],
	["copper", 8960.0, "cube copper", "Copper 8.96 g/cm³ [CRC]."],
	["steel", 7850.0, "steel", "Carbon steel 7.85 g/cm³ [CRC]."],
	["zinc", 7140.0, "cube zinc", "Zinc 7.14 g/cm³ [CRC]."],
	["oak", 750.0, "wood", "Red oak, dry, about 0.75 g/cm³ (Wood Handbook FPL-GTR-190, Table 5-3a)."],
	["pine", 400.0, "light wood", "Pine 0.35-0.46 g/cm³ at 12 % moisture (Wood Handbook, FPL-GTR-190, 2010, Table 5-3a)."],
	["acrylic", 1180.0, "box acrylic", "Acrylic (PMMA) 1.18 g/cm³ [CRC]."],
	["nylon", 1150.0, "cube nylon", "Nylon 6/6 1.14-1.15 g/cm³ (Engineering ToolBox)."],
	["PVC", 1380.0, "cube pvc", "Rigid PVC 1.38 g/cm³ (Engineering ToolBox)."],
	["polypropylene", 905.0, "plastic", "Polypropylene 0.90-0.91 g/cm³ (Engineering ToolBox)."],
	["polyethylene", 950.0, "cube hdpe", "High-density polyethylene 0.94-0.97 g/cm³ [CRC]."]
]
export const DENSITY_KEYS = DENSITY_MATERIALS.map((m) => m[0])

// ---------------------------------------------------------------- real values the builders use (the engine has the same in substances.ts)
export const SUBSTANCES = {
	water: ["water", 0.018015, "#3a7bd5"],
	wax: ["paraffin wax", 0.352, "#e8d9a8"],
	iron: ["iron", 0.055845, "#8a8f96"],
	gallium: ["gallium", 0.069723, "#b8c2cc"],
	"carbon dioxide": ["carbon dioxide", 0.04401, "#d9e6ee"],
	air: ["air", 0.028965, "#8fb7d9"],
	nitrogen: ["nitrogen", 0.028014, "#7fa6d6"],
	helium: ["helium", 0.0040026, "#f2c84b"],
	bromine: ["bromine", 0.159808, "#a5401c"]
}
export const SUBSTANCE_KEYS = Object.keys(SUBSTANCES)
// the densest each gets (its solid's or its liquid's density, kg/m³, as substances.ts): no box packs its sample tighter [CRC]
const DENSEST = { water: 998.0, wax: 900.0, iron: 7874.0, gallium: 6095.0, "carbon dioxide": 1562.0, air: 1000.0, nitrogen: 1026.0, helium: 190.0, bromine: 4050.0 }
const SYRINGE_AREA = (Math.PI * 0.0267 * 0.0267) / 4 // m²: a 60 mL syringe's plunger [BD]
const PUSH_SAID = 200.0 // N: a plunger held harder than this is said (about what one hand pushes: a modelling choice; matter.ts PUSH_SAID)
const SECOND_KEYS = ["none", "air", "bromine", "helium", "nitrogen", "carbon dioxide"]
const R_GAS = 8.314462618
const R_AIR = 287.05
const ATM = 101325.0
const KELVIN = 273.15

// solutes the glass knows: key -> [crystal density kg/m³, grains: {choice: [grain diameter m, porous factor]}, source]
export const SOLUTES = {
	salt: [2165.0, { table: [0.0003, 1.0], coarse: [0.0025, 1.0], powder: [0.00005, 1.0] },
		"Salt (NaCl): 2.165 g/cm³; dissolves 35.65 g per 100 g of water at 0 °C, 35.89 at 20 °C, 39.07 at 100 °C [CRC]; table grains about 0.3 mm, coarse 2-3 mm [USDA]."],
	sugar: [1587.0, { granulated: [0.0005, 1.0], coarse: [0.001, 1.0], powder: [0.00005, 1.0], cube: [0.0198, 7.0] },
		"Sugar (sucrose): 1.587 g/cm³; dissolves 179 g per 100 g of water at 0 °C, 204 at 20 °C, 487 at 100 °C [CRC]; granulated grains about 0.5 mm; " +
			"a cube 2.2 g, 1.6 cm (drawn as a 1.98 cm sphere of its volume; it is two-thirds air, so water soaks in: its surface counts 7 times, which " +
			"gives the few minutes a cube takes in still room-temperature water: approximate)."],
	sand: [2650.0, { fine: [0.0002, 1.0], coarse: [0.001, 1.0] }, "Quartz sand 2.65 g/cm³: does not dissolve [CRC]."],
	chalk: [2710.0, { powder: [0.000005, 1.0] }, "Chalk (calcium carbonate) 2.71 g/cm³: 0.0013 g per 100 mL, so it does not dissolve; its powder clouds the water and settles slowly [CRC]."]
}
export const SOLUTE_KEYS = Object.keys(SOLUTES)
const GRAIN_KEYS = ["table", "granulated", "coarse", "powder", "cube", "fine"]
// solubility (g per 100 g of water) at 0, 10, ... 100 °C [CRC]
export const SOLUBILITY = {
	salt: [35.65, 35.72, 35.89, 36.09, 36.37, 36.69, 37.04, 37.46, 37.93, 38.47, 39.07],
	sugar: [179.2, 190.5, 203.9, 219.5, 238.1, 260.4, 287.3, 320.5, 362.1, 415.7, 487.2]
}

/** Grams that dissolve in 100 g of water at temp °C (0 for sand and chalk), linear between the 10 °C rows. */
export function solubility(solute, temp) {
	const rows = hasOwn(SOLUBILITY, solute) ? SOLUBILITY[solute] : null
	if (rows === null) return 0.0
	const t = pymin(100.0, pymax(0.0, temp))
	let k = 0
	while (k < 9 && t >= 10 * (k + 1)) k += 1
	const u = (t - 10 * k) / 10
	return rows[k] + (rows[k + 1] - rows[k]) * u
}

/** Liquid water's density at temp °C, kg/m³ (CRC table rows, linear between them). */
export function water_density(temp) {
	const rows = [[0.0, 999.84], [4.0, 999.97], [10.0, 999.7], [20.0, 998.21], [25.0, 997.05], [30.0, 995.65], [40.0, 992.22], [50.0, 988.04],
		[60.0, 983.2], [70.0, 977.76], [80.0, 971.79], [90.0, 965.31], [100.0, 958.35]]
	const t = pymin(100.0, pymax(0.0, temp))
	for (let i = 0; i + 1 < rows.length; i++) {
		const [t0, d0] = rows[i]
		const [t1, d1] = rows[i + 1]
		if (t <= t1) return d0 + ((d1 - d0) * (t - t0)) / (t1 - t0)
	}
	return rows[rows.length - 1][1]
}

/** Air at temp °C and `gauge` Pa above 1 atm, kg/m³ (ideal gas, R_air = 287.05 J/(kg·K)). */
export function air_density(temp, gauge = 0.0) {
	return (ATM + gauge) / (R_AIR * (temp + KELVIN))
}

// ---------------------------------------------------------------- helpers (as the Python, step for step)
/** A fixed setup stands upright whatever the item's angle (its contents are level): its solids are placed unturned. */
function _upright(c) {
	c.ca = 1.0
	c.sa = 0.0
	c.a = 0.0
}

/** A slab welded to another solid of this item: lx, ly in the parent's frame. */
function _weld(c, part, parent, w, h, d, lx, ly, material, look, words, hidden = false, color = null) {
	const body = { kind: "slab", width: pyRound(w, 5), height: pyRound(h, 5), depth: pyRound(d, 5) }
	const s = {
		kind: c.kind, id: `${c.item.id}/${part}`, words, item: c.item.id, look, body, material, at: { x: pyRound(lx, 5), y: pyRound(ly, 5) }, parent,
		placeholder: { fill: truthy(color) ? color : LOOK_FILL[look] }, render: { kind: "procedural", shade: LOOK_SHADE[look] }, depth: 2
	}
	if (hidden) s.hidden_3d = true
	if (truthy(color)) s.color = color
	c.sb.solids.push(s)
	return s.id
}

const BALLAST_R = 0.001
const BAG_FULL = 1.0 // kg: the most melt water a bag's ballast carries (tooling/src/sim/modules/matter.ts BAG_FULL)

/** The hidden carrier of a mass no solid shows (see the Python docstring): a 1 mm ball welded inside `parent`. Returns its solid id. */
function _ballast(c, parent, mass, lx, ly) {
	const v = (4 / 3) * Math.PI * BALLAST_R * BALLAST_R * BALLAST_R
	const m = c.mat({ base: "ballast", density: pyRound(pymax(mass, 1e-9) / v, 6), overrides: {} })
	const s = {
		kind: c.kind, id: `${c.item.id}/ballast`, words: "a hidden mass carrier", item: c.item.id, look: "steel",
		body: { kind: "ball", radius: BALLAST_R }, material: m, at: { x: pyRound(lx, 5), y: pyRound(ly, 5) }, parent,
		placeholder: { fill: LOOK_FILL.steel }, render: { kind: "procedural", shade: LOOK_SHADE.steel }, depth: 4, hidden_3d: true
	}
	c.sb.solids.push(s)
	return s.id
}

const _r = (v, n = 6) => pyRound(v, n)

// ---------------------------------------------------------------- the particle model: particle-box, syringe, balloon-bath
/** The model particles' radius: about a sixth of the room each has, `least` (1.5 mm) to 6 mm. */
function _particle_radius(width, height, count, least = 0.0015) {
	return pyRound(pymin(0.006, pymax(least, 0.17 * Math.sqrt((width * height) / count))), 5)
}

/** A seed from an item's id: a 31-bit FNV-1a of its UTF-16 code units (Python does the same with its own big ints). */
export function _seed(text) {
	let h = 2166136261
	for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0
	return h % 2147483647
}

function build_particle_box(c, P) {
	_upright(c)
	const W = P.width
	const H = P.height
	const t = 0.006
	const base_h = 0.035
	const cell = 0.04
	c.slab("base", W + 0.06, base_h, 0.12, 0.0, base_h / 2, { kind: "static", material: c.mat({ base: "hot plate", overrides: {} }), look: "hot plate", words: "a lab hot plate under the box" })
	const m = c.mat({ base: "box acrylic", overrides: {} })
	const y0 = base_h + t
	c.slab("floor", W + 2 * t, t, cell, 0.0, base_h + t / 2, { kind: "static", material: m, look: "box acrylic", words: "the box's clear floor" })
	c.slab("left", t, H, cell, -W / 2 - t / 2, y0 + H / 2, { kind: "static", material: m, look: "box acrylic", words: "the box's clear wall" })
	c.slab("right", t, H, cell, W / 2 + t / 2, y0 + H / 2, { kind: "static", material: m, look: "box acrylic", words: "the box's clear wall" })
	if (!truthy(P.piston)) c.slab("lid", W + 2 * t, t, cell, 0.0, y0 + H + t / 2, { kind: "static", material: m, look: "box acrylic", words: "the box's clear lid" })
	const count = P.particles
	const radius = _particle_radius(W, H, count)
	const second = truthy(P.divider) && P.second !== "none" ? P.second : null
	const [ox, oy] = c.world(0.0, y0)
	const T0 = P.temp_c
	c.process("matter", "model", {
		role: "box", origin: { x: pyRound(ox, 5), y: pyRound(oy, 5) }, width: pyRound(W, 5), height: pyRound(H, 5),
		substance: P.substance, second, count, radius, mass: _r(_box_sample(P)), volume: _r(P.volume_ml / 1e6, 9),
		start: pyRound(T0, 4), heater: pyRound(P.heater_w, 4), heatFrom: pyRound(P.heat_from_s, 4), piston: truthy(P.piston),
		pistonAt: pyRound(P.piston_start, 4), load: pyRound(P.load_kg, 5), area: _r(P.piston_area_cm2 / 1e4, 8), outside: ATM,
		divider: truthy(P.divider), openAt: pyRound(P.open_at_s, 4), drive: null, seed: _seed(c.item.id)
	})
	P.particle_mm = pyRound(radius * 2000, 2)
}

/** The box's real sample, kg: sample_g, but never packed tighter than the substance's solid or liquid (mod_matter.py _box_sample). */
function _box_sample(P) {
	return pymin(P.sample_g / 1000, (P.volume_ml / 1e6) * (hasOwn(DENSEST, P.substance) ? DENSEST[P.substance] : 1000.0))
}

function _box_readouts() {
	return [new Readout("temp_c", "Temperature", { unit: "°C", digits: 1, help: "The sample's temperature (its heat over its specific and latent heats)" }),
		new Readout("solid_pct", "Solid", { unit: "%", digits: 0 }), new Readout("liquid_pct", "Liquid", { unit: "%", digits: 0 }), new Readout("gas_pct", "Gas", { unit: "%", digits: 0 }),
		new Readout("pressure_kpa", "Pressure", { unit: "kPa", digits: 1, help: "The real sample's gas pressure nRT/V in the real volume (the particles' hits are the picture of it); a piston resting on the solid or liquid: its load" }),
		new Readout("volume_ml", "Volume", { unit: "mL", digits: 0, help: "The real volume the box stands for (it follows a piston)" }),
		new Readout("speed_ms", "Molecules' mean speed", { unit: "m/s", digits: 0, help: "The real mean speed √(8RT/πM); the model's particles move 1/1250 of it" }),
		new Readout("heat_kj", "Heat put in", { unit: "kJ", digits: 3 }), new Readout("mixed_pct", "Mixed", { unit: "%", digits: 0, help: "With a divider: 0 unmixed, 100 evenly mixed. A MODEL clock: " +
			"the particles mix in a few run seconds whatever the time-lapse; real gases take " +
			"about L²/2D (a 20 cm box about 30 minutes, D ≈ 0.1 cm²/s)" })]
}

function _model_types() {
	register(new ItemType("particle-box", "Particle model box", CAT, build_particle_box, {
		dynamic: false, material: "box acrylic", materials: ["box acrylic"],
		props: [new Prop("substance", "Substance", "water", { kind: "choice", choices: SUBSTANCE_KEYS,
			help: "Water melts at 0 °C and boils at 100 °C; wax 58/370; iron 1538/2862; gallium 29.8 (melts in a hand); carbon dioxide (dry ice) turns straight to gas at −78.5 °C" }),
		new Prop("temp_c", "Start temperature", 20.0, -270.0, 3000.0, 1.0, "°C"),
		new Prop("heater_w", "Heater", 0.0, -2000.0, 20000.0, 1.0, "W", "The hot plate's power into the sample (negative: a cooler); it cuts out 250 °C past the boiling point"),
		new Prop("heat_from_s", "Heater on at", 0.5, 0.0, 20.0, 0.1, "s"),
		new Prop("sample_g", "Sample", 1.0, 0.001, 1000.0, 0.01, "g", "The real sample's mass: with the heater's power it sets how fast it warms"),
		new Prop("particles", "Particles", 60, 8, 160, 1, "", "Model particles drawn (each stands for very many molecules)", { kind: "int" }),
		new Prop("width", "Width", 0.2, 0.08, 0.5, 0.01, "m"), new Prop("height", "Height", 0.2, 0.08, 0.5, 0.01, "m"),
		new Prop("volume_ml", "Real volume", 1000.0, 1.0, 100000.0, 1.0, "mL", "The real container the box stands for (gas pressure = nRT/V)"),
		new Prop("piston", "Piston", false, { kind: "bool", help: "A lid free to slide: the gas holds up its load" }),
		new Prop("piston_start", "Piston starts at", 0.6, 0.2, 1.0, 0.05, "× height"),
		new Prop("load_kg", "Load on the piston", 0.0, 0.0, 50.0, 0.1, "kg"),
		new Prop("piston_area_cm2", "Piston area", 7.07, 0.5, 500.0, 0.01, "cm²", "The real piston's area (3 cm across: 7.07 cm²)"),
		new Prop("divider", "Divider", false, { kind: "bool", help: "A wall down the middle, lifted at `open at`: one colour (or gas) each side mixes" }),
		new Prop("second", "Other side", "none", { kind: "choice", choices: SECOND_KEYS, help: "With a divider: another gas on the right (none: the same substance in a second colour)" }),
		new Prop("open_at_s", "Divider lifts at", 1.0, 0.0, 20.0, 0.1, "s")],
		tags: ["particles", "molecules", "atoms", "particle model", "kinetic", "states of matter", "solid", "liquid", "gas", "melting", "boiling",
			"evaporation", "temperature", "pressure", "diffusion", "heating curve", "piston", "Boyle", "Charles"],
		description: "A clear box on a hot plate showing a substance as particles (a MODEL: drawn huge and slowed down). Solid: bonded, vibrating; " +
			"liquid: sliding at the bottom; gas: flying, filling the box, pressing on the walls. Heat it and it melts and boils with the real " +
			"plateaus; real readouts beside it: temperature, pressure, volume, molecular speed.",
		source: "Melting/boiling points, specific and latent heats and molar masses [CRC; NIST-WB]; molecular speeds √(3RT/M) [CODATA18 R]; the " +
			"model's particle sizes and speeds are scaled (web/CONTRACT.md Matter).",
		anchor: "the middle of the hot plate's bottom, where it stands", facts: "1 g of water at 20 °C, 60 particles, 1 L",
		readouts: _box_readouts(), module: MODULE
	}))

	function build_syringe(c, P) {
		_upright(c)
		const d = 0.0267
		const scale = 0.1072 // [BD]: 26.7 mm inside, 60 mL at 107.2 mm
		const t = 0.0015
		const foot = 0.012
		const H = scale * 1.05
		const m = c.mat({ base: "polypropylene", overrides: {} })
		c.slab("foot", 0.06, foot, 0.06, 0.0, foot / 2, { kind: "static", material: m, look: "plastic", words: "the syringe's stand" })
		c.slab("tip", d + 2 * t, 0.006, 0.03, 0.0, foot + 0.003, { kind: "static", material: m, look: "plastic", words: "the sealed tip cap" })
		const y0 = foot + 0.006
		c.slab("left", t, H, 0.03, -d / 2 - t / 2, y0 + H / 2, { kind: "static", material: m, look: "plastic", words: "the syringe's barrel" })
		c.slab("right", t, H, 0.03, d / 2 + t / 2, y0 + H / 2, { kind: "static", material: m, look: "plastic", words: "the syringe's barrel" })
		const h0 = (scale * P.start_ml) / 60.0
		const h1 = (scale * P.push_to_ml) / 60.0
		const count = P.particles
		const radius = _particle_radius(d, h0, count, 0.001)
		const [ox, oy] = c.world(0.0, y0)
		const T0 = P.temp_c
		const vol = P.start_ml / 1e6
		c.process("matter", "model", {
			role: "box", origin: { x: pyRound(ox, 5), y: pyRound(oy, 5) }, width: d, height: pyRound(H, 5), substance: "air",
			second: null, count, radius, mass: _r(air_density(T0) * vol, 9), volume: _r(vol, 9), start: pyRound(T0, 4), heater: 0.0,
			heatFrom: 0.0, piston: true, pistonAt: pyRound(h0 / H, 6), load: 0.0, area: _r((Math.PI * d * d) / 4, 8), outside: ATM, divider: false,
			openAt: 0.0, drive: { from: pyRound(P.push_from_s, 4), until: pyRound(P.push_from_s + P.push_s, 4), to: pyRound(h1 / H, 6) },
			seed: _seed(c.item.id)
		})
	}

	register(new ItemType("syringe", "Sealed syringe (air)", CAT, build_syringe, {
		dynamic: false, material: "polypropylene", materials: ["polypropylene"],
		props: [new Prop("start_ml", "Air at the start", 60.0, 5.0, 60.0, 0.5, "mL"),
			new Prop("push_to_ml", "Plunger pushed to", 30.0, 5.0, 60.0, 0.5, "mL", "Less than at the start: pushed in; more: pulled out"),
			new Prop("push_from_s", "Push starts at", 1.0, 0.0, 20.0, 0.1, "s"), new Prop("push_s", "Push takes", 2.0, 0.1, 15.0, 0.1, "s"),
			new Prop("temp_c", "Temperature", 20.0, -50.0, 150.0, 1.0, "°C"),
			new Prop("particles", "Particles", 60, 8, 100, 1, "", "Model air particles drawn", { kind: "int" })],
		tags: ["syringe", "plunger", "air", "gas", "pressure", "volume", "Boyle", "squeeze", "compress", "particles"],
		description: "A 60 mL plastic syringe with its tip sealed, standing upright, its air drawn as particles (a model). Push the plunger in and the " +
			"same air has less room: the particles hit the walls more often and the gauge's pressure rises (Boyle: 60 → 30 mL doubles it, 101 → 203 kPa; " +
			"the reading is the real air's p = 60 mL × 101.3 kPa ÷ V). Holding it in takes a push: 57 N at 30 mL, 284 N at 10 mL, 624 N at 5 mL " +
			"(more than a hand gives). The air stays at its temperature (a slow push).",
		source: "[BD] 60 mL syringe 26.7 mm inside, 107 mm to the 60 mL mark; air 1.204 kg/m³ at 20 °C [ISO-AIR]; Boyle's law pV = constant at fixed T.",
		anchor: "the middle of its stand's bottom", facts: "60 mL of air pushed to 30 mL",
		readouts: [new Readout("volume_ml", "Volume", { unit: "mL", digits: 1 }), new Readout("pressure_kpa", "Pressure", { unit: "kPa", digits: 1 }), new Readout("temp_c", "Temperature", { unit: "°C", digits: 1 }),
			new Readout("force_n", "Push on the plunger", { unit: "N", digits: 0, help: "What holds the plunger where it is: (inside − outside pressure) × its 5.6 cm²; negative: a pull" })],
		module: MODULE
	}))

	function build_balloon_bath(c, P) {
		_upright(c)
		const D = P.bowl_d
		const H = 0.18
		const t = 0.004
		const m = c.mat({ base: "glass", overrides: {} })
		c.slab("floor", D + 2 * t, t, D + 2 * t, 0.0, t / 2, { kind: "static", material: m, look: "glass", words: "the bowl's glass bottom" })
		c.slab("left", t, H, D, -D / 2 - t / 2, t + H / 2, { kind: "static", material: m, look: "glass", words: "the bowl's glass side" })
		c.slab("right", t, H, D, D / 2 + t / 2, t + H / 2, { kind: "static", material: m, look: "glass", words: "the bowl's glass side" })
		c.process("matter", "balloon", { role: "balloon", start: pyRound(P.air_temp_c, 4), bath: pyRound(P.water_temp_c, 4), volume: _r(P.balloon_l / 1000, 9),
			tau: pyRound(P.settle_s, 4), dipAt: pyRound(P.dip_at_s, 4) })
	}

	register(new ItemType("balloon-bath", "Balloon in a water bath", CAT, build_balloon_bath, {
		dynamic: false, material: "glass", materials: ["glass"],
		props: [new Prop("balloon_l", "Balloon at the start", 1.0, 0.1, 5.0, 0.01, "L"),
			new Prop("air_temp_c", "Air temperature", 20.0, -20.0, 60.0, 0.5, "°C", "The balloon's air before it goes in"),
			new Prop("water_temp_c", "Water temperature", 60.0, 0.0, 100.0, 0.5, "°C", "Ice water 0 °C, hot tap water 60 °C"),
			new Prop("dip_at_s", "Dipped in at", 0.5, 0.0, 20.0, 0.1, "s"),
			new Prop("settle_s", "Warms in about", 20.0, 1.0, 600.0, 1.0, "s", "The time for the air inside to come to the water's temperature (a rubber skin: about 20 s)"),
			new Prop("bowl_d", "Bowl", 0.24, 0.15, 0.4, 0.01, "m")],
		tags: ["balloon", "Charles", "gas", "heat", "cold", "volume", "temperature", "expand", "shrink", "hot water", "ice water"],
		description: "A glass bowl of water at a set temperature with a balloon held down in it by a wire frame: the air inside warms or cools to the " +
			"water and its volume follows its kelvin temperature (Charles: 1.00 L at 20 °C → 1.136 L in 60 °C water, 0.932 L in ice water).",
		source: "Charles's law V ∝ T (kelvin) at constant pressure; the rubber's own pressure is left out (a big soft balloon: approximate).",
		anchor: "the middle of the bowl's bottom", facts: "a 1 L balloon into 60 °C water",
		readouts: [new Readout("temp_c", "Air inside", { unit: "°C", digits: 1 }), new Readout("volume_l", "Balloon", { unit: "L", digits: 3 }), new Readout("diameter_cm", "Across", { unit: "cm", digits: 1 })],
		module: MODULE
	}))
}

// ---------------------------------------------------------------- solutions: dissolving-glass
const GLASS_D = 0.07
const GLASS_T = 0.0025
const GLASS_B = 0.006
const GLASS_H = 0.1

function build_glass(c, P) {
	const R = GLASS_D / 2
	const t = GLASS_T
	const b = GLASS_B
	const Hg = GLASS_H
	const g = c.mat({ base: "glass", overrides: {} })
	const base = c.slab("base", GLASS_D + 2 * t, b, pyRound((Math.PI * (R + t)) / 2, 5), 0.0, b / 2, { material: g, look: "glass", words: "the glass's thick bottom" })
	// the walls as two slabs whose depth (πR) gives the real cylinder wall's volume (2πR·t·H)
	_weld(c, "wall-left", base, t, Hg, Math.PI * R, -R - t / 2, b / 2 + Hg / 2, g, "glass", "the glass's wall")
	_weld(c, "wall-right", base, t, Hg, Math.PI * R, R + t / 2, b / 2 + Hg / 2, g, "glass", "the glass's wall")
	const temp = P.water_temp_c
	const rho = water_density(temp)
	const depth = pymin(Hg - 0.005, P.water_ml / 1e6 / (Math.PI * R * R))
	const water_ml = depth * Math.PI * R * R * 1e6
	const wm = c.mat({ base: "liquid water", density: pyRound(rho, 4), overrides: {} })
	if (depth > 0.001) {
		// (the water: a slab as wide as the glass whose depth πD/4 gives the cylinder's volume; welded, hidden: the model draws the water)
		_weld(c, "water", base, GLASS_D - 0.0005, depth, (Math.PI * GLASS_D) / 4, 0.0, b / 2 + depth / 2, wm, "glass water", "the water in the glass", true)
	}
	const solute = P.solute
	const [crystal, grains] = SOLUTES[solute]
	const grain_key = hasOwn(grains, P.grain) ? P.grain : Object.keys(grains)[0]
	const [grain, porous] = grains[grain_key]
	const mass = P.solute_g / 1000
	const start_in = P.start_in
	const weighed = start_in !== "spoon" ? mass : 0.0
	const ballast = _ballast(c, base, mass, 0.0, 0.0) // (built carrying all of it; the engine resizes it to what is weighed)
	if (start_in === "dish") {
		const pm = c.mat({ base: "cardboard", overrides: {} })
		_weld(c, "dish", base, 0.04, 0.025, 0.04, R + t + 0.028, -b / 2 + 0.0125, pm, "cardboard", "a little paper cup of it beside the glass")
	}
	const specks = grain_key === "cube" ? 1 : P.specks
	c.process("matter", "glass", {
		role: "glass", solid: base, ballast, weighed: _r(weighed, 9), radius: R, depth: pyRound(depth, 5), height: Hg,
		floor: pyRound(b / 2, 5), temp: pyRound(temp, 4), solute, crystal, mass: _r(mass, 9), grain, porous,
		specks, startIn: start_in, pourAt: pyRound(P.pour_at_s, 4), stir: pyRound(P.stir, 4), stirFrom: pyRound(P.stir_from_s, 4),
		stirUntil: pyRound(P.stir_until_s, 4), solubility: pyRound(solubility(solute, temp), 6), seed: _seed(c.item.id)
	})
	P.water_ml = pyRound(water_ml, 1)
	P.saturates_at_g = pyRound(((solubility(solute, temp) * water_ml * rho) / 1e6) * 10, 2) // (g per 100 g of water × the water's mass / 100 g)
}

function _solution_types() {
	register(new ItemType("dissolving-glass", "Glass of water (dissolving)", CAT, build_glass, {
		material: "glass", materials: ["glass"],
		props: [new Prop("water_ml", "Water", 200.0, 10.0, 360.0, 1.0, "mL"),
			new Prop("water_temp_c", "Water temperature", 20.0, 0.0, 100.0, 0.5, "°C", "Cold tap 10 °C, room 20 °C, hot tap 60 °C, just boiled 100 °C"),
			new Prop("solute", "Put in", "salt", { kind: "choice", choices: SOLUTE_KEYS, help: "Salt and sugar dissolve; sand and chalk do not" }),
			new Prop("grain", "Grains", "table", { kind: "choice", choices: GRAIN_KEYS,
				help: "Salt: table 0.3 mm, coarse 2.5 mm, powder; sugar: granulated 0.5 mm, coarse 1 mm, powder, cube (one 2.2 g cube); sand: fine, coarse; chalk: powder" }),
			new Prop("solute_g", "Amount", 6.0, 0.1, 100.0, 0.1, "g", "1 tsp of salt 6 g, of sugar 4.2 g; a sugar cube 2.2 g [USDA]"),
			new Prop("specks", "Specks drawn", 40, 8, 120, 1, "", "Each speck is a pinch of real grains", { kind: "int" }),
			new Prop("start_in", "Starts", "spoon", { kind: "choice", choices: ["spoon", "dish", "glass"],
				help: "spoon: poured from a spoon held above (weighed once in); dish: in a paper cup beside the glass (weighed all along); glass: already on the bottom" }),
			new Prop("pour_at_s", "Poured at", 0.5, 0.0, 20.0, 0.1, "s"),
			new Prop("stir", "Stirring", 0.0, 0.0, 5.0, 0.1, "turns/s", "A spoon going round (0: still water)"),
			new Prop("stir_from_s", "Stir from", 1.0, 0.0, 20.0, 0.1, "s"), new Prop("stir_until_s", "Stir until", 20.0, 0.0, 20.0, 0.1, "s")],
		tags: ["glass", "water", "dissolve", "dissolving", "solution", "salt", "sugar", "sand", "chalk", "stir", "spoon", "saturated", "solubility",
			"sugar cube", "hot water", "cold water", "mixture"],
		description: "A drinking glass of water (7 cm across) with salt, sugar, sand or chalk poured in. Salt and sugar dissolve, faster in hot water, " +
			"when stirred, and as smaller grains; past saturation the rest stays on the bottom; sand and chalk never dissolve. Moving: stand it " +
			"on a kitchen scale and the reading stays the same as it dissolves.",
		source: SOLUTES.salt[2] + " " + SOLUTES.sugar[2] + " Rates: Noyes-Whitney with the Ranz-Marshall and Churchill mass-transfer " +
			"correlations (tooling/src/sim/matter/dissolve.ts).",
		anchor: "the middle of its base, where it stands", facts: "200 mL of water at 20 °C, 6 g of table salt from a spoon",
		readouts: [new Readout("dissolved_g", "Dissolved", { unit: "g", digits: 2 }), new Readout("left_g", "Not dissolved", { unit: "g", digits: 2 }), new Readout("dissolved_pct", "Dissolved", { unit: "%", digits: 0 }),
			new Readout("strength_pct", "Strength", { unit: "% by mass", digits: 2 }), new Readout("saturated", "Saturated", { unit: "", digits: 0, help: "1 when the water holds all it can" }),
			new Readout("clock_s", "Time since poured", { unit: "s", digits: 0, help: "Lesson seconds (time-lapse included)" }), new Readout("weighed_g", "Weighed with the glass", { unit: "g", digits: 2 })],
		module: MODULE
	}))
}

// ---------------------------------------------------------------- mass conserved: zip-bag, chocolate-bar, reaction-bottle, pumped-ball
function _conservation_types() {
	function build_bag(c, P) {
		const W = 0.16
		const D = 0.15
		const t = 0.002
		const hw = P.puff
		const film = c.mat({ base: "bag film", density: pyRound(P.bag_g / 1000 / (W * t * D + 2 * t * hw * D), 4), overrides: {} })
		const floor = c.slab("floor", W, t, D, 0.0, t / 2, { material: film, look: "bag film", words: "the bag's bottom film" })
		_weld(c, "side-left", floor, t, hw, D, -W / 2 + t / 2, t / 2 + hw / 2, film, "bag film", "the bag's side", true)
		_weld(c, "side-right", floor, t, hw, D, W / 2 - t / 2, t / 2 + hw / 2, film, "bag film", "the bag's side", true)
		const ballast = _ballast(c, floor, BAG_FULL, 0.0, 0.0) // (built carrying the most melt water it holds; the engine resizes it)
		c.process("matter", "bag", { role: "bag", solid: floor, ballast, inside: { x0: pyRound(-W / 2 + t, 5), x1: pyRound(W / 2 - t, 5),
			y0: pyRound(t / 2 - 0.005, 5), y1: pyRound(t / 2 + hw + 0.02, 5) }, sealed: truthy(P.sealed) })
	}

	register(new ItemType("zip-bag", "Zip bag", CAT, build_bag, {
		material: "bag film", materials: ["bag film"],
		props: [new Prop("sealed", "Sealed", true, { kind: "bool", help: "A sealed bag keeps everything: what melts stays in it as water" }),
			new Prop("bag_g", "Bag", 2.0, 0.5, 20.0, 0.1, "g"), new Prop("puff", "Puffed up", 0.04, 0.02, 0.12, 0.005, "m", "How tall it stands round what is in it")],
		tags: ["bag", "zip bag", "sandwich bag", "sealed", "closed", "container", "melt", "conservation", "mass"],
		description: "A clear sealed sandwich bag (16 × 15 cm, 2 g) lying flat: put things in it (an ice cube, salt, water) and stand it on a kitchen " +
			"scale. What melts or dissolves inside stays in the bag, so the scale reads the same before and after.",
		source: "A sandwich bag 16 × 15 cm of LDPE film weighs about 2 g.",
		anchor: "the middle of its bottom", facts: "a sealed 2 g bag",
		readouts: [new Readout("water_g", "Water in the bag", { unit: "g", digits: 2, help: "What melted (or left the things in it) is held as water" }),
			new Readout("contents_g", "Everything in it", { unit: "g", digits: 2 })],
		module: MODULE
	}))

	function build_bar(c, P) {
		const n = P.pieces
		const L = 0.156
		const h = 0.0085
		const D = 0.078
		const w = L / n
		const mass = P.mass_g / 1000
		const m = c.mat({ base: "chocolate bar", density: pyRound(mass / (L * h * D), 4), overrides: {} })
		const sids = []
		for (let k = 0; k < n; k++) {
			const x = -L / 2 + w * (k + 0.5)
			sids.push(c.slab(`piece${k + 1}`, w, h, D, x, h / 2, { material: m, look: "chocolate bar", words: "a square of the chocolate bar", ..._paint(P.color) }))
		}
		c.process("matter", "bar", { role: "bar", pieces: sids, snapAt: pyRound(P.snap_at_s, 4), apart: pyRound(P.apart_ms, 4) })
	}

	register(new ItemType("chocolate-bar", "Chocolate bar", CAT, build_bar, {
		material: "chocolate bar", materials: ["chocolate bar"],
		props: [new Prop("mass_g", "Mass", 100.0, 10.0, 500.0, 1.0, "g"), new Prop("pieces", "Pieces", 5, 2, 10, 1, "", "Squares along it", { kind: "int" }),
			new Prop("snap_at_s", "Snapped at", 1.0, 0.0, 20.0, 0.1, "s", "When it is broken into its pieces"),
			new Prop("apart_ms", "Pieces pushed apart at", 0.15, 0.0, 1.0, 0.01, "m/s"), new Prop("color", "Colour", "#5a3422", { kind: "choice",
				choices: ["#5a3422", "#7b4a2d", "#f1e5c9"], help: "Dark, milk or white chocolate" })],
		tags: ["chocolate", "bar", "break", "snap", "pieces", "conservation", "mass", "scale"],
		description: "A 100 g chocolate bar (15.6 × 7.8 cm) in squares that are snapped apart at a set time: on a kitchen scale it reads the same " +
			"whole or in pieces.",
		source: "A 100 g dark chocolate bar is about 15.6 × 7.8 × 0.85 cm; its density about 1.3 g/cm³ (the mass prop sets it).",
		anchor: "the middle of its bottom", facts: "100 g in 5 squares snapped at 1 s",
		readouts: [new Readout("pieces_apart", "Pieces apart", { unit: "", digits: 0 })],
		module: MODULE
	}))

	function build_bottle(c, P) {
		const D = 0.065
		const t = 0.0004
		const b = 0.004
		const H = 0.2
		const R = D / 2
		const pet = c.mat({ base: "PET", overrides: {} })
		const base = c.slab("base", D, b, pyRound((Math.PI * R) / 2, 5), 0.0, b / 2, { material: pet, look: "pet bottle", words: "the bottle's bottom" })
		_weld(c, "wall-left", base, t, H, Math.PI * R, -R + t / 2, b / 2 + H / 2, pet, "pet bottle", "the bottle's side")
		_weld(c, "wall-right", base, t, H, Math.PI * R, R - t / 2, b / 2 + H / 2, pet, "pet bottle", "the bottle's side")
		const vin_ml = P.vinegar_ml
		const depth = pymin(H * 0.9, vin_ml / 1e6 / (Math.PI * (R - t) * (R - t)))
		const vm = c.mat({ base: "liquid water", density: 1005.0, overrides: {} })
		_weld(c, "vinegar", base, D - 2 * t - 0.0005, depth, (Math.PI * (D - 2 * t)) / 4, 0.0, b / 2 + depth / 2, vm, "glass water", "the vinegar in it", true)
		const soda = P.soda_g / 1000
		const ballast = _ballast(c, base, soda, 0.0, 0.0)
		const acid = (((vin_ml * 1.005 * P.acid_pct) / 100) / 60.052) // mol of acetic acid [VINEGAR, NIST-WB]
		const base_mol = (soda * 1000) / 84.007 // mol of sodium bicarbonate [NIST-WB]
		const co2 = pymin(acid, base_mol)
		const headspace = 0.5e-3 - vin_ml / 1e6
		c.process("matter", "reaction", { role: "reaction", solid: base, ballast, soda: _r(soda, 9), co2: _r(co2 * 0.04401, 9), mixAt: pyRound(P.mix_at_s, 4),
			tau: pyRound(P.react_s, 4), closure: P.closure, headspace: _r(pymax(headspace, 2e-5), 9), temp: 20.0, liquid: _r(vin_ml / 1e6, 9) })
		P.co2_g = pyRound(co2 * 44.01, 3)
		P.co2_l = pyRound(((co2 * R_GAS * (20 + KELVIN)) / ATM) * 1000, 3)
	}

	register(new ItemType("reaction-bottle", "Fizz bottle (baking soda + vinegar)", CAT, build_bottle, {
		material: "PET", materials: ["PET"],
		props: [new Prop("vinegar_ml", "Vinegar", 100.0, 20.0, 400.0, 1.0, "mL"), new Prop("acid_pct", "Vinegar's acid", 5.0, 1.0, 10.0, 0.1, "%",
			"Table vinegar is 4-5 % acetic acid [VINEGAR]"),
		new Prop("soda_g", "Baking soda", 5.0, 0.2, 30.0, 0.1, "g", "Hangs in a paper sachet in the neck until it drops in"),
		new Prop("closure", "Closure", "open", { kind: "choice", choices: ["open", "cap", "balloon"],
			help: "open: the gas escapes (the scale goes down); cap: it stays in (the scale stays; the vinegar dissolves some of it, Henry's law; past 900 kPa the cap pops off and the gas escapes); balloon: the balloon fills (the scale reads a little less: the balloon's air buoys it)" }),
		new Prop("mix_at_s", "Soda drops in at", 1.0, 0.0, 20.0, 0.1, "s"),
		new Prop("react_s", "Fizz lasts about", 6.0, 0.5, 120.0, 0.5, "s", "The reaction's time constant (most of the gas in about three times it)")],
		tags: ["reaction", "chemical change", "baking soda", "vinegar", "fizz", "bubbles", "gas", "carbon dioxide", "CO2", "bottle", "balloon",
			"sealed", "open", "conservation", "mass", "new substance"],
		description: "A 500 mL clear plastic bottle of vinegar with baking soda that drops in: it fizzes and makes carbon dioxide. Open, the gas escapes " +
			"and a kitchen scale under it goes down (5 g of soda: −2.6 g); capped, nothing escapes and the scale stays (the vinegar dissolves part of " +
			"the gas, Henry's law; past 900 kPa the cap pops off and the gas escapes); with a balloon on the neck the balloon fills (1.36 L) " +
			"and the scale reads 1.6 g less because the air the balloon pushes aside buoys it.",
		source: "NaHCO3 + CH3COOH → CH3COONa + H2O + CO2 (84.007 + 60.052 → 44.010 g/mol of CO2) [NIST-WB]; vinegar 5 % acid, 1.005 g/mL [VINEGAR]; " +
			"the gas at 20 °C, 1 atm: 24.06 L/mol; the fizz's time is a modelling choice.",
		anchor: "the middle of its bottom", facts: "100 mL of 5 % vinegar, 5 g of baking soda, open",
		readouts: [new Readout("co2_g", "Gas made", { unit: "g", digits: 3 }), new Readout("escaped_g", "Gas escaped", { unit: "g", digits: 3 }), new Readout("balloon_ml", "Balloon", { unit: "mL", digits: 0 }),
			new Readout("pressure_kpa", "Pressure inside", { unit: "kPa", digits: 1 }), new Readout("fizz", "Fizzing", { unit: "", digits: 2 }),
			new Readout("co2_dissolved_g", "Gas dissolved in the vinegar", { unit: "g", digits: 3, help: "Under a cap or a balloon (Henry's law: 1.69 g per litre per atm at 20 °C)" }),
			new Readout("popped", "Cap popped", { unit: "", digits: 0, help: "1 once the pressure passed 900 kPa and the cap came off" })],
		module: MODULE
	}))

	function build_ball(c, P) {
		const R = P.diameter / 2
		const V = (4 / 3) * Math.PI * R * R * R
		const shell = P.shell_g / 1000
		const sm = c.mat({ base: "synthetic leather (soccer)", density: pyRound(shell / V, 4), overrides: {} })
		const ball = c.ball("ball", R, 0.0, 0.0, { material: sm, words: "a soccer ball", pattern: "soccer" })
		const T = 20.0
		const air0 = air_density(T, P.start_bar * 1e5) * V
		const air1 = air_density(T, P.end_bar * 1e5) * V
		const ballast = _ballast(c, ball, pymax(air0, air1), 0.0, 0.0)
		c.process("matter", "air", { role: "ball", solid: ball, ballast, start: _r(air0, 9), end: _r(air1, 9), startBar: pyRound(P.start_bar, 4),
			endBar: pyRound(P.end_bar, 4), pumpAt: pyRound(P.pump_at_s, 4), pumpFor: pyRound(P.pump_s, 4) })
		P.air_start_g = pyRound(air0 * 1000, 2)
		P.air_end_g = pyRound(air1 * 1000, 2)
	}

	register(new ItemType("pumped-ball", "Ball being pumped up", CAT, build_ball, {
		material: "synthetic leather (soccer)", materials: ["synthetic leather (soccer)"],
		props: [new Prop("diameter", "Diameter", 0.22, 0.1, 0.3, 0.005, "m", "A size-5 soccer ball 22 cm [FIFA]"),
			new Prop("shell_g", "Ball (empty)", 430.0, 50.0, 1000.0, 1.0, "g"),
			new Prop("start_bar", "Pressure at the start", 0.0, 0.0, 2.0, 0.05, "bar", "Above the air outside (gauge): 0 = flat"),
			new Prop("end_bar", "Pumped to", 0.8, 0.0, 2.0, 0.05, "bar", "A match ball 0.6-1.1 bar [FIFA]"),
			new Prop("pump_at_s", "Pumping starts", 1.0, 0.0, 20.0, 0.1, "s"), new Prop("pump_s", "Pumping takes", 3.0, 0.1, 20.0, 0.1, "s")],
		tags: ["ball", "pump", "air", "gas", "mass", "weigh", "soccer", "pressure", "air has mass"],
		description: "A soccer ball pumped up on a kitchen scale: the air pushed into it has mass, so the reading rises (0 → 0.8 bar: +5.4 g); its outside " +
			"size, and so its buoyancy, stay the same.",
		source: "Size-5 ball Ø 22 cm (5.58 L), 410-450 g [FIFA]; air 1.204 kg/m³ at 20 °C, ρ = P/(287.05 T) [ISO-AIR].",
		anchor: "its centre", facts: "430 g ball from 0 to 0.8 bar",
		readouts: [new Readout("air_g", "Air inside", { unit: "g", digits: 2 }), new Readout("gauge_bar", "Pressure (gauge)", { unit: "bar", digits: 2 })],
		module: MODULE
	}))
}

function _paint(color) {
	return truthy(color) ? { color } : {}
}

// ---------------------------------------------------------------- mixtures: mixture-dish, sieve
export const GRAINS = {
	sand: [0.002, 2650.0, "#d9b97c"], gravel: [0.007, 2650.0, "#8d8a83"], "iron-filings": [0.0015, 7870.0, "#3d3f42"],
	salt: [0.0015, 2165.0, "#f4f4f2"], pepper: [0.0015, 1100.0, "#2b2622"], rice: [0.003, 1450.0, "#f3eee0"],
	beans: [0.011, 1300.0, "#7a2e24"], "paper-clips": [0.008, 7850.0, "#c7ccd1"]
}
export const MIXTURES = {
	"sand + iron filings": ["sand", "iron-filings"], "sand + gravel": ["sand", "gravel"], "salt + pepper": ["salt", "pepper"],
	"rice + beans": ["rice", "beans"], "sand + paper clips": ["sand", "paper-clips"], "sand + salt": ["sand", "salt"]
}
const MIXTURE_KEYS = Object.keys(MIXTURES)

/** The linked magnet item's id, with what its field needs: remanence (T) by its material and its size (m), or null (not linked). */
function _magnet_record(c) {
	const mid = c.link("magnet")
	if (mid === null || !hasOwn(TYPES, c.sb.scene_items.get(mid).type)) return null
	const mp = props_of(c.sb.scene_items.get(mid))
	const material = String(hasOwn(mp, "material") ? mp.material : "ceramic")
	const br = material.includes("neodym") ? 1.3 : material.includes("alnico") ? 1.25 : 0.39
	const num = (v, d) => (typeof v === "number" ? v : d)
	const length = num(hasOwn(mp, "length") ? mp.length : 0.15, 0.15)
	const width = num(hasOwn(mp, "width") ? mp.width : 0.019, 0.019)
	const depth = num(hasOwn(mp, "depth") ? mp.depth : 0.0095, 0.0095)
	return { item: mid, br, length: pyRound(length, 5), area: _r(width * depth, 9), inset: pyRound(width / 4, 5) }
}

function _mixture_props(default_mix, default_a, default_b) {
	return [new Prop("mixture", "Mixture", default_mix, { kind: "choice", choices: MIXTURE_KEYS }),
		new Prop("amount_a_g", "First part", default_a, 1.0, 500.0, 1.0, "g", "Of the mixture's first part (sand, salt, rice)"),
		new Prop("amount_b_g", "Second part", default_b, 1.0, 500.0, 1.0, "g", "Of its second part (iron filings, gravel, pepper, beans, paper clips)"),
		new Prop("grains", "Grains drawn", 150, 30, 300, 1, "", "Grains in the slice the model follows (a slice through the whole mixture)", { kind: "int" })]
}

function _mixture_types() {
	function build_dish(c, P) {
		const W = P.width
		const H = 0.035
		const t = 0.004
		const g = c.mat({ base: "glass", overrides: {} })
		const floor = c.slab("floor", W + 2 * t, t, W + 2 * t, 0.0, t / 2, { material: g, look: "glass", words: "the dish's glass bottom" })
		_weld(c, "wall-left", floor, t, H, W, -W / 2 - t / 2, t / 2 + H / 2, g, "glass", "the dish's side")
		_weld(c, "wall-right", floor, t, H, W, W / 2 + t / 2, t / 2 + H / 2, g, "glass", "the dish's side")
		const [a, b] = MIXTURES[P.mixture]
		const total = (P.amount_a_g + P.amount_b_g) / 1000
		const ballast = _ballast(c, floor, total, 0.0, 0.0)
		let wand = null
		if (truthy(P.wand)) {
			// a magnet wand: a 1.6 cm plastic rod with an N42 neodymium magnet (Ø 12.7 × 25 mm) in its tip, swept across the dish with its tip
			// wand_height above the dish's floor, then lifted out (it carries the iron with it)
			wand = { from: pyRound(P.wand_from_s, 4), until: pyRound(P.wand_from_s + P.wand_s, 4), height: pyRound(P.wand_height, 5),
				lift: pyRound(H + 0.03, 5), br: 1.3, length: 0.025, radius: 0.00635, rod: 0.008 }
		}
		c.process("matter", "grains", {
			role: "grains", solid: floor, ballast, origin: { x: 0.0, y: pyRound(t / 2, 5) }, width: pyRound(W, 5),
			wall: H, components: [{ key: a, mass: pyRound(P.amount_a_g, 4) }, { key: b, mass: pyRound(P.amount_b_g, 4) }],
			grains: P.grains, magnet: _magnet_record(c), wand, aperture: 0.0, wire: 0.0, sieveHeight: 0.0, sieveWidth: 0.0, shake: 0.0,
			shakeHz: 0.0, shakeFrom: 0.0, shakeUntil: 0.0, pour: false, seed: _seed(c.item.id)
		})
	}

	register(new ItemType("mixture-dish", "Dish of a mixture", CAT, build_dish, {
		material: "glass", materials: ["glass"],
		props: [..._mixture_props("sand + iron filings", 50.0, 20.0), new Prop("width", "Width", 0.12, 0.06, 0.3, 0.005, "m"),
			new Prop("wand", "Magnet wand", true, { kind: "bool", help: "A neodymium magnet wand swept across just above the mixture, then lifted out" }),
			new Prop("wand_height", "Wand tip height", 0.015, 0.008, 0.08, 0.001, "m", "Its tip above the dish's floor while it sweeps (the mixture is about 1 cm deep)"),
			new Prop("wand_from_s", "Sweep starts", 0.5, 0.0, 20.0, 0.1, "s"), new Prop("wand_s", "Sweep takes", 2.5, 0.5, 15.0, 0.1, "s")],
		links: [new Link("magnet", "Magnet", { types: ["bar-magnet", "horseshoe-magnet", "disc-magnet", "ring-magnet"],
			help: "A magnet held over the dish (magnetism's bar magnet): it pulls the iron out, never the sand" })],
		tags: ["mixture", "separate", "separating", "sand", "iron filings", "magnet", "salt", "pepper", "rice", "beans", "gravel", "dish", "petri dish"],
		description: "A shallow glass dish of a mixture (sand and iron filings, salt and pepper, rice and beans...). Its magnet wand sweeps across just " +
			"above it and lifts out: the iron filings (or steel paper clips) cling to it, the sand stays: separating a mixture by a property. " +
			"(Or link a magnet item held over it.)",
		source: "Grain sizes and densities: matter/grains.ts (sand 2.65, iron 7.87 g/cm³ [CRC]); a soft iron grain is pulled with F = V·M·∇B, M = χ_eff·B/μ0 " +
			"up to its saturation (1.71 MA/m) (Jiles, Introduction to Magnetism and Magnetic Materials).",
		anchor: "the middle of its bottom", facts: "50 g of sand and 20 g of iron filings, a magnet wand",
		readouts: [new Readout("a_left_pct", "First part still in the dish", { unit: "%", digits: 0 }), new Readout("b_left_pct", "Second part still in the dish", { unit: "%", digits: 0 }),
			new Readout("a_out_g", "First part taken out", { unit: "g", digits: 1 }), new Readout("b_out_g", "Second part taken out", { unit: "g", digits: 1 }),
			new Readout("weighed_g", "Weighed in the dish", { unit: "g", digits: 1 })],
		module: MODULE
	}))

	function build_sieve(c, P) {
		_upright(c)
		const W = 0.2
		const H = 0.035
		const t = 0.004
		const g = c.mat({ base: "steel", overrides: {} })
		c.slab("tray", W + 2 * t, t, 0.2, 0.0, t / 2, { kind: "static", material: g, look: "steel", words: "the catch tray's bottom" })
		c.slab("tray-left", t, H, 0.2, -W / 2 - t / 2, t + H / 2, { kind: "static", material: g, look: "steel", words: "the tray's side" })
		c.slab("tray-right", t, H, 0.2, W / 2 + t / 2, t + H / 2, { kind: "static", material: g, look: "steel", words: "the tray's side" })
		const hs = P.sieve_height
		const [a, b] = MIXTURES[P.mixture]
		c.process("matter", "grains", {
			role: "grains", solid: `${c.item.id}/tray`, ballast: null, origin: { x: 0.0, y: pyRound(t, 5) }, width: pyRound(W, 5),
			wall: H, components: [{ key: a, mass: pyRound(P.amount_a_g, 4) }, { key: b, mass: pyRound(P.amount_b_g, 4) }],
			grains: P.grains, magnet: null, aperture: _r(P.aperture_mm / 1000, 7), wire: 0.0008, sieveHeight: pyRound(hs, 5),
			sieveWidth: 0.16, shake: _r(P.shake_mm / 1000, 7), shakeHz: pyRound(P.shake_hz, 4), shakeFrom: pyRound(P.shake_from_s, 4),
			shakeUntil: pyRound(P.shake_until_s, 4), pour: false, seed: _seed(c.item.id)
		})
	}

	register(new ItemType("sieve", "Sieve over a tray", CAT, build_sieve, {
		dynamic: false, material: "steel", materials: ["steel"],
		props: [..._mixture_props("sand + gravel", 60.0, 60.0),
			new Prop("aperture_mm", "Mesh holes", 4.0, 0.5, 12.0, 0.1, "mm", "Grains smaller than this fall through"),
			new Prop("sieve_height", "Sieve height", 0.1, 0.05, 0.3, 0.005, "m", "Above the tray's bottom"),
			new Prop("shake_mm", "Shaking", 10.0, 0.0, 30.0, 0.5, "mm", "How far the sieve is shaken side to side"),
			new Prop("shake_hz", "Shakes a second", 4.0, 0.0, 10.0, 0.1, "Hz"),
			new Prop("shake_from_s", "Shake from", 0.5, 0.0, 20.0, 0.1, "s"), new Prop("shake_until_s", "Shake until", 6.0, 0.0, 20.0, 0.1, "s")],
		tags: ["sieve", "strainer", "mesh", "separate", "separating", "sand", "gravel", "pebbles", "rice", "beans", "mixture", "size"],
		description: "A kitchen sieve held over a catch tray with a mixture in it: shaken, the grains smaller than its mesh holes fall through and the " +
			"bigger ones stay (sand through, gravel kept): separating a mixture by size.",
		source: "A grain passes a mesh only if it is smaller than the holes (2-D slice, matter/grains.ts); kitchen sieves 1-4 mm, garden riddles 6-12 mm.",
		anchor: "the middle of the tray's bottom", facts: "60 g sand + 60 g gravel, 4 mm mesh, shaken 4 times a second",
		readouts: [new Readout("a_passed_pct", "First part through", { unit: "%", digits: 0 }), new Readout("b_passed_pct", "Second part through", { unit: "%", digits: 0 }),
			new Readout("a_passed_g", "First part in the tray", { unit: "g", digits: 1 }), new Readout("b_passed_g", "Second part in the tray", { unit: "g", digits: 1 })],
		module: MODULE
	}))
}

// ---------------------------------------------------------------- separating by filtering and evaporating: filter-funnel, evaporating-dish
const FILTER_PAPERS = ["filter paper", "coffee filter", "none"]
const FILTER_SOLIDS = ["sand", "chalk", "none"]
const DISSOLVED_KEYS = ["salt", "sugar", "none"]
const DISH_R = 0.045
const DISH_H = 0.035
const DISH_G = 0.11 // a 90 mm borosilicate glass evaporating dish, 3.5 cm deep (about 130 mL), about 110 g

/** The dish's volume to its rim, mL (a spherical bowl: its sphere's radius from the rim's radius and the depth). */
function _dish_capacity_ml() {
	const rs = (DISH_R * DISH_R + DISH_H * DISH_H) / (2 * DISH_H)
	return Math.PI * DISH_H * DISH_H * (3 * rs - DISH_H) / 3 * 1e6
}

function _separating_types() {
	function build_filter(c, P) {
		_upright(c)
		const D = P.funnel_mm / 1000
		const g = c.mat({ base: "glass", overrides: {} })
		const st = c.mat({ base: "steel", overrides: {} })
		// the catch beaker (250 mL, 7 cm across, 9.5 cm tall) under the funnel, on the table
		const bw = 0.07
		const bh = 0.095
		const bt = 0.002
		c.slab("beaker", bw, bt * 2, pyRound(Math.PI * bw / 4, 5), 0.0, bt, { material: g, look: "glass", words: "the beaker's bottom" })
		c.slab("beaker-left", bt, bh, pyRound(Math.PI * bw / 4, 5), -bw / 2 + bt / 2, bh / 2, { material: g, look: "glass", words: "the beaker's side" })
		c.slab("beaker-right", bt, bh, pyRound(Math.PI * bw / 4, 5), bw / 2 - bt / 2, bh / 2, { material: g, look: "glass", words: "the beaker's side" })
		// the ring stand: a foot beside the beaker, its rod, and the funnel in its ring
		c.slab("foot", 0.16, 0.012, 0.11, -0.12, 0.006, { material: st, look: "steel", words: "the ring stand's foot" })
		const rod_h = 0.3
		c.slab("rod", 0.01, rod_h, 0.01, -0.17, 0.012 + rod_h / 2, { material: st, look: "steel", words: "the ring stand's rod" })
		const apex = 0.135
		const rim = apex + (D / 2) / 0.5773502691896257
		c.poly("funnel", [[0.0, pyRound(apex, 5)], [pyRound(D / 2, 5), pyRound(rim, 5)], [pyRound(-D / 2, 5), pyRound(rim, 5)]], pyRound(D * 0.6, 5), 0.0, 0.0, { material: g, look: "glass",
			words: "the glass funnel lined with filter paper" })
		c.slab("stem", 0.007, 0.06, 0.007, 0.0, apex - 0.03 + 0.002, { material: g, look: "glass", words: "the funnel's stem" })
		const temp = P.water_temp_c
		const water_ml = P.water_ml
		const solid = P.solid
		const solid_g = solid !== "none" ? P.solid_g : 0.0
		const dissolved = P.dissolved
		const want = dissolved !== "none" ? P.dissolved_g : 0.0
		const most = dissolved !== "none" ? solubility(dissolved, temp) * water_ml * water_density(temp) / 1000 / 100 : 0.0
		const dis = pymin(want, most)
		c.process("matter", "filter", { role: "filter", funnel: pyRound(D, 5), paper: P.paper, water: _r(water_ml / 1e6, 9), temp: pyRound(temp, 4), undissolved: solid,
			undissolvedMass: _r(solid_g / 1000, 9), dissolved, dissolvedMass: _r(dis / 1000, 9), crystals: _r((want - dis) / 1000, 9),
			pourAt: pyRound(P.pour_at_s, 4), pourFor: pyRound(P.pour_s, 4), rinse: _r(P.rinse_ml / 1e6, 9) })
		P.dissolves_g = pyRound(dis, 3)
	}

	register(new ItemType("filter-funnel", "Filter funnel", CAT, build_filter, {
		dynamic: false, material: "glass", materials: ["glass"],
		props: [new Prop("water_ml", "Water", 100.0, 10.0, 250.0, 1.0, "mL", "The mixture's water, poured in from a cup"),
			new Prop("water_temp_c", "Water temperature", 20.0, 0.0, 100.0, 0.5, "°C", "Warm water runs through a little faster (it is less viscous)"),
			new Prop("solid", "Undissolved", "sand", { kind: "choice", choices: FILTER_SOLIDS, help: "What does not dissolve: the paper keeps it (sand 0.25 mm; chalk's fine flocs)" }),
			new Prop("solid_g", "Of it", 10.0, 0.0, 60.0, 0.1, "g"),
			new Prop("dissolved", "Dissolved", "salt", { kind: "choice", choices: DISSOLVED_KEYS, help: "What is dissolved in the water: it runs through the paper with the water" }),
			new Prop("dissolved_g", "Of it", 5.0, 0.0, 100.0, 0.1, "g", "Past what the water holds (35.9 g salt per 100 g at 20 °C) the rest stays as crystals on the paper"),
			new Prop("paper", "Paper", "filter paper", { kind: "choice", choices: FILTER_PAPERS,
				help: "filter paper: keeps grains over 11 µm; coffee filter: faster, keeps grains over about 20 µm (chalk gets through); none: everything runs through" }),
			new Prop("funnel_mm", "Funnel", 75.0, 50.0, 150.0, 1.0, "mm", "Across its rim (a lab funnel 75 mm: it holds about 34 mL above the paper)"),
			new Prop("pour_at_s", "Poured at", 0.5, 0.0, 20.0, 0.1, "s"),
			new Prop("pour_s", "Pouring takes", 3.0, 0.2, 20.0, 0.1, "s", "Run seconds to pour the cup (the pourer waits whenever the funnel is full)"),
			new Prop("rinse_ml", "Rinse", 10.0, 0.0, 50.0, 1.0, "mL", "Clean water poured through once it has drained: it carries the salt the wet paper held")],
		tags: ["filter", "filtering", "filtration", "funnel", "filter paper", "coffee filter", "separate", "separating", "mixture", "sand", "salt water",
			"chalk", "muddy water", "dissolve", "solution", "filtrate", "residue"],
		description: "A glass funnel lined with filter paper in a ring stand over a beaker; a cup of a mixture (sand in salt water, chalk in water) is " +
			"poured in. The water and what is dissolved in it run through into the beaker (the filtrate, still salty); the sand stays on the " +
			"paper (the residue): separating a mixture by grain size. It takes minutes: use time_lapse.",
		source: "Darcy flow through the paper and the cake: Whatman Grade 1 R = 1.47e9 1/m from its Herzberg flow time [WHATMAN]; the cake by Kozeny-Carman " +
			"[CARMAN]; a 60° funnel drains exponentially (tooling/src/sim/matter/separate.ts); water's viscosity [CRC].",
		anchor: "the middle of the beaker's bottom", facts: "10 g of sand and 5 g of salt in 100 mL of water through filter paper, a 10 mL rinse",
		readouts: [new Readout("poured_ml", "Poured in", { unit: "mL", digits: 1 }), new Readout("in_funnel_ml", "In the funnel", { unit: "mL", digits: 1 }),
			new Readout("filtrate_ml", "Through (filtrate)", { unit: "mL", digits: 1 }), new Readout("filtrate_pct", "Of the water through", { unit: "%", digits: 0 }),
			new Readout("salt_through_g", "Dissolved through", { unit: "g", digits: 2 }), new Readout("salt_through_pct", "Of the dissolved through", { unit: "%", digits: 0 }),
			new Readout("kept_g", "Kept on the paper", { unit: "g", digits: 2 }), new Readout("kept_pct", "Of the undissolved kept", { unit: "%", digits: 0 }),
			new Readout("through_g", "Undissolved through", { unit: "g", digits: 2 }), new Readout("clear", "Filtrate clear", { unit: "", digits: 0, help: "1 when no solid came through" }),
			new Readout("flow_ml_min", "Dripping", { unit: "mL/min", digits: 1 }), new Readout("held_ml", "Held by the wet paper", { unit: "mL", digits: 1 }),
			new Readout("level_mm", "Liquid in the funnel", { unit: "mm", digits: 0 }), new Readout("clock_s", "Time since poured", { unit: "s", digits: 0, help: "Lesson seconds (time-lapse included)" })],
		module: MODULE
	}))

	function build_dish(c, P) {
		const heat = P.heat
		let parent = null
		let y0 = 0.0
		if (heat === "hot plate") {
			const pw = 0.17
			const ph = 0.06
			const pd = 0.17
			const hp = c.mat({ base: "hot plate", density: pyRound(2.0 / (pw * ph * pd), 4), overrides: {} })
			parent = c.slab("plate", pw, ph, pd, 0.0, ph / 2, { material: hp, look: "hot plate", words: "a lab hot plate under the dish" })
			y0 = ph
		}
		// the glass dish: a foot ring and its sides as slabs (their volume gives its 110 g); the water and salt ride on its ballast
		const fw = 0.05
		const fh = 0.006
		const wt = 0.004
		const vol = fw * fh * fw + 2 * (wt * DISH_H * Math.PI * DISH_R)
		const pm = c.mat({ base: "glass", density: pyRound(DISH_G / vol, 4), overrides: {} })
		// (every welded part hangs on the item's root, the hot plate when there is one: welds one level deep, as the builder's helpers expect)
		let base
		let root
		let by
		const bx = 0.0
		if (parent === null) {
			base = c.slab("base", fw, fh, fw, 0.0, fh / 2, { material: pm, look: "glass", words: "the evaporating dish's foot" })
			root = base
			by = 0.0
		} else {
			by = y0 - 0.03 + fh / 2
			base = _weld(c, "base", parent, fw, fh, fw, 0.0, by, pm, "glass", "the evaporating dish's foot")
			root = parent
		}
		_weld(c, "wall-left", root, wt, DISH_H, Math.PI * DISH_R, -DISH_R + wt / 2, by + fh / 2 + DISH_H / 2, pm, "glass", "the dish's side")
		_weld(c, "wall-right", root, wt, DISH_H, Math.PI * DISH_R, DISH_R - wt / 2, by + fh / 2 + DISH_H / 2, pm, "glass", "the dish's side")
		const temp = P.water_temp_c
		const water_ml = pymin(P.water_ml, pyRound(_dish_capacity_ml() * 0.9, 1))
		const water = water_ml * water_density(temp) / 1e6
		const solute = P.solute
		const mass = P.solute_g / 1000
		const ballast = _ballast(c, root, water + mass, bx, by)
		c.process("matter", "dish", { role: "evaporate", solid: base, ballast, rim: DISH_R, depth: DISH_H, dish: DISH_G, water: _r(water, 9),
			start: pyRound(temp, 4), solute, mass: _r(mass, 9), heat, power: pyRound(P.heater_w, 4), humidity: pyRound(P.humidity_pct / 100, 4),
			heatFrom: pyRound(P.heat_from_s, 4) })
		P.water_ml = pyRound(water_ml, 1)
		P.saturates_at_g = pyRound(solubility(solute, temp) * water * 1000 / 100, 2)
	}

	register(new ItemType("evaporating-dish", "Evaporating dish", CAT, build_dish, {
		material: "glass", materials: ["glass"],
		props: [new Prop("water_ml", "Water", 50.0, 5.0, 120.0, 1.0, "mL", "Salt water in a 9 cm glass dish (it holds about 120 mL)"),
			new Prop("solute", "Dissolved", "salt", { kind: "choice", choices: ["salt", "sugar"] }),
			new Prop("solute_g", "Of it", 5.0, 0.0, 60.0, 0.1, "g", "When the water has gone, it is all left as crystals"),
			new Prop("water_temp_c", "Water at the start", 20.0, 0.0, 100.0, 0.5, "°C"),
			new Prop("heat", "Heated by", "hot plate", { kind: "choice", choices: ["hot plate", "sun", "room"],
				help: "hot plate: boils dry in minutes; sun: a sunny windowsill, about 3 days for 50 mL; room: still indoor air, about 11 days" }),
			new Prop("heater_w", "Hot plate", 300.0, 0.0, 1000.0, 10.0, "W", "Its power (about half of it reaches the dish)"),
			new Prop("heat_from_s", "Heated from", 1.0, 0.0, 20.0, 0.1, "s", "Run seconds: the hot plate is switched on (or the dish set out) then, so a scale has settled first"),
			new Prop("humidity_pct", "Room's humidity", 50.0, 5.0, 95.0, 1.0, "%", "Drier air takes the water faster")],
		tags: ["evaporate", "evaporation", "evaporating dish", "salt water", "crystals", "crystallize", "dry", "boil", "boil dry", "separate",
			"separating", "solution", "get the salt back", "hot plate", "sun", "windowsill", "dissolve", "mixture"],
		description: "A clear borosilicate glass evaporating dish (9 cm) of salt (or sugar) water, on a hot plate, on a sunny windowsill or in a room. The " +
			"water evaporates (boils, on a hot plate) and the salt stays: crystals appear once the water is saturated (26.4 % salt) and at " +
			"the end all of it is left as crystals. On a kitchen scale the reading falls by the water's mass only. Use time_lapse.",
		source: "Heat balance with the heat module's air laws (natural convection, radiation, Chilton-Colburn evaporation; tooling/src/sim/heat-data.ts); " +
			"the salt's water activity [R&S]; boiling point 100 °C + 0.512·i·b [CRC]; solubility [CRC]; about half a hot plate's power reaches " +
			"the dish and a sunny windowsill gives about 700 W/m² (provisional).",
		anchor: "the middle of its bottom (the hot plate's, when heated by one)", facts: "5 g of salt in 50 mL of water on a 300 W hot plate",
		readouts: [new Readout("water_g", "Water", { unit: "g", digits: 2 }), new Readout("temp_c", "Temperature", { unit: "°C", digits: 1 }), new Readout("dissolved_g", "Dissolved", { unit: "g", digits: 2 }),
			new Readout("crystals_g", "Crystals", { unit: "g", digits: 2 }), new Readout("strength_pct", "Strength", { unit: "% by mass", digits: 1 }),
			new Readout("saturated", "Saturated", { unit: "", digits: 0, help: "1 while crystals stand in the water" }), new Readout("dry", "Dry", { unit: "", digits: 0 }),
			new Readout("boiling", "Boiling", { unit: "", digits: 0 }), new Readout("evaporated_g", "Water gone", { unit: "g", digits: 2 }),
			new Readout("loss_g_min", "Losing", { unit: "g/min", digits: 2 }), new Readout("weighed_g", "Water and salt", { unit: "g", digits: 2 }),
			new Readout("level_mm", "Liquid's depth", { unit: "mm", digits: 1 }), new Readout("clock_s", "Time", { unit: "s", digits: 0, help: "Lesson seconds (time-lapse included)" })],
		module: MODULE
	}))
}

// ---------------------------------------------------------------- density blocks
function _cube_look(key) {
	for (const [k, , look] of DENSITY_MATERIALS) if (k === key) return look
	return "steel"
}

function _density_types() {
	function density_of(key) {
		for (const [k, rho] of DENSITY_MATERIALS) if (k === key) return rho
		return 2700.0
	}

	function build_cube(c, P) {
		const s = P.size
		const key = P.made_of
		const rho = density_of(key)
		c.slab("block", s, s, s, 0.0, 0.0, { material: c.mat({ base: `density set ${key}`, overrides: {} }), look: _cube_look(key), words: `a ${key} cube` })
		c.process("matter", "block", { role: "block", mass: _r(rho * s * s * s, 9), volume: _r(s * s * s, 12), density: rho })
		P.mass_g = pyRound(rho * s * s * s * 1000, 2)
	}

	register(new ItemType("density-cube", "Density cube", CAT, build_cube, {
		props: [new Prop("made_of", "Made of", "aluminium", { kind: "choice", choices: DENSITY_KEYS, help: "The density set's twelve materials" }),
			new Prop("size", "Size", 0.0254, 0.005, 0.2, 0.0005, "m", "The classic set's cubes are 1 inch (2.54 cm, 16.39 cm³)")],
		tags: ["cube", "density", "same size", "mass", "heavier", "material", "metal", "wood", "plastic", "float", "sink", "aluminium", "copper",
			"brass", "steel", "zinc", "oak", "pine", "acrylic", "nylon", "PVC", "polypropylene"],
		description: "A 1 inch cube of one material from the classic density set: the same size in aluminium, brass, copper, steel, zinc, oak, pine, " +
			"acrylic, nylon, PVC, polypropylene or polyethylene, so they weigh very differently (pine 6.6 g, copper 147 g); the ones less " +
			"dense than water (wood, polypropylene, polyethylene) float.",
		source: "Densities (g/cm³): aluminium 2.70, brass 8.50, copper 8.96, steel 7.85, zinc 7.14, oak 0.75, pine 0.40, acrylic 1.18, nylon 1.15, " +
			"PVC 1.38, polypropylene 0.905, HDPE 0.95 [CRC; Wood Handbook; Engineering ToolBox].",
		anchor: "its centre", facts: "a 2.54 cm aluminium cube, 44.3 g",
		readouts: [new Readout("mass_g", "Mass", { unit: "g", digits: 1 }), new Readout("volume_cm3", "Volume", { unit: "cm³", digits: 2 }), new Readout("density_gcm3", "Density", { unit: "g/cm³", digits: 2 })],
		module: MODULE
	}))

	function build_equal(c, P) {
		const key = P.made_of
		const rho = density_of(key)
		const m = P.mass_g / 1000
		const s = pow(m / rho, 1 / 3)
		c.slab("block", s, s, s, 0.0, 0.0, { material: c.mat({ base: `density set ${key}`, overrides: {} }), look: _cube_look(key), words: `a ${key} block` })
		c.process("matter", "block", { role: "block", mass: _r(m, 9), volume: _r(m / rho, 12), density: rho })
		P.size = pyRound(s, 5)
	}

	register(new ItemType("equal-mass-block", "Equal-mass block", CAT, build_equal, {
		props: [new Prop("made_of", "Made of", "aluminium", { kind: "choice", choices: DENSITY_KEYS }),
			new Prop("mass_g", "Mass", 100.0, 1.0, 5000.0, 1.0, "g", "Every block of the set has this mass: its size follows its density")],
		tags: ["block", "density", "same mass", "size", "volume", "material", "equal mass"],
		description: "A cube whose MASS is set (100 g) and whose size follows its material's density: 100 g of copper is a 2.2 cm cube, of aluminium " +
			"3.3 cm, of pine 6.3 cm. The equal-mass set shows that density, not size, decides how heavy a thing is for its size.",
		source: "Side = (mass / density)^(1/3); densities as the density cube's [CRC].",
		anchor: "its centre", facts: "100 g of aluminium: a 3.33 cm cube",
		readouts: [new Readout("mass_g", "Mass", { unit: "g", digits: 1 }), new Readout("volume_cm3", "Volume", { unit: "cm³", digits: 2 }), new Readout("density_gcm3", "Density", { unit: "g/cm³", digits: 2 })],
		module: MODULE
	}))
}

// ---------------------------------------------------------------- chemical changes: cold-pack, hand-warmer, indicator-cup, reaction-cup, steel-wool
// (the Python's comments say what each is and cite the values: [CRC-H], [IUPAC13], [PENNISTON], [NIST-WB])
export const PACK_CHEMICALS = {
	// key: [words, molar mass kg/mol, ΔsolH J/mol (+: it takes heat in, the pack cools), solid's heat capacity J/(kg·K)]
	"ammonium nitrate": ["ammonium nitrate (NH4NO3)", 0.080043, 25690.0, 1740.0],
	urea: ["urea (CO(NH2)2)", 0.060056, 15100.0, 1550.0],
	"ammonium chloride": ["ammonium chloride (NH4Cl)", 0.053491, 14780.0, 1572.0],
	"calcium chloride": ["calcium chloride (CaCl2): a hot pack", 0.110984, -81300.0, 657.0]
}
const PACK_KEYS = Object.keys(PACK_CHEMICALS)
const C_WATER = 4184.0
const C_IRON = 449.0
const C_FILM = 2300.0 // polyethylene film J/(kg·K) [Engineering ToolBox]
const FE_M = 0.055845
const FE_HEAT = 412100.0 // J per mol of iron rusting: 4Fe + 3O2 → 2Fe2O3, ΔH = 2 × −824.2 kJ [CRC-H]
const O2_PER_FE = 0.75 * 0.031998 // kg of oxygen taken from the air per mol of iron
const WARMER_MAX_W = 20.0 // the most a hand warmer's breathable film lets oxygen in for, W (real warmers peak about 60-70 °C: a modelling bound)
export const SOAKS = { vinegar: [0.5, 0.5], "salt water": [1.0, 0.5], water: [3.0, 0.5], dry: [60.0, 0.0] } // [days for 63 % of what can rust, g of liquid held per g]
const SOAK_KEYS = Object.keys(SOAKS)
const RUST_SHARE = 0.5 // the share of fine steel wool's iron that rusts before its coat of rust slows it right down (a modelling choice)
export const ADDITIONS = {
	// key: [words, unit, density g/mL (a liquid) or 0 (a powder), acetic mol, citric mol, bicarbonate mol, carbonate mol, sodium mol: per mL or g]
	vinegar: ["vinegar", "mL", 1.005, (0.05 * 1.005) / 60.052, 0.0, 0.0, 0.0, 0.0],
	"lemon juice": ["lemon juice", "mL", 1.03, 0.0, 0.048 / 192.12, 0.0, 0.0, 0.0],
	"baking soda": ["baking soda (NaHCO3)", "g", 0.0, 0.0, 0.0, 1 / 84.007, 0.0, 1 / 84.007],
	"washing soda": ["washing soda (Na2CO3)", "g", 0.0, 0.0, 0.0, 0.0, 1 / 105.988, 2 / 105.988],
	none: ["nothing", "", 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
}
const ADDITION_KEYS = Object.keys(ADDITIONS)
export const BAND_NAMES = ["red", "pink", "purple", "blue", "blue-green", "green", "yellow"] // red cabbage's colours by pH (matter/chem.ts BAND_NAMES)
const BEAKER_R = 0.033
const BEAKER_T = 0.002
const BEAKER_B = 0.004
const BEAKER_H = 0.095
const BEAKER_G = 0.1 // a 250 mL glass beaker: 6.6 cm inside, 9.5 cm, about 100 g

/** Whether the heat module is loaded (its thermometer is in the catalog): then these items join its world. */
function _heat_on() {
	return hasOwn(TYPES, "thermometer") && TYPES.thermometer.module === "heat"
}

/** A pouch lying flat (L long, D front to back, t thick) of `mass` kg: its one solid, and its heat body when heat is on (or null). */
function _pack(c, P, L, D, t, mass, words) {
	const m = c.mat({ base: "pouch", density: pyRound(mass / (L * t * D), 4), overrides: {} })
	const sid = c.slab("pouch", L, t, D, 0.0, t / 2, { material: m, look: "pouch", words })
	const hid = _heat_on() ? c.process("heat", "body", { role: "body", solid: sid, cells: 1 }) : null
	return [sid, hid]
}

/** A 250 mL glass beaker with water_ml of water (on a hidden welded slab) and `extra_kg` on its ballast; its water joins the heat module's world. */
function _beaker(c, P, water_ml, extra_kg, words) {
	const R = BEAKER_R
	const t = BEAKER_T
	const b = BEAKER_B
	const H = BEAKER_H
	const vol = (2 * R + 2 * t) * b * ((Math.PI * (R + t)) / 2) + 2 * t * H * Math.PI * R
	const g = c.mat({ base: "glass", density: pyRound(BEAKER_G / vol, 4), overrides: {} })
	const base = c.slab("base", 2 * R + 2 * t, b, pyRound((Math.PI * (R + t)) / 2, 5), 0.0, b / 2, { material: g, look: "glass", words })
	_weld(c, "wall-left", base, t, H, Math.PI * R, -R - t / 2, b / 2 + H / 2, g, "glass", "the beaker's wall")
	_weld(c, "wall-right", base, t, H, Math.PI * R, R + t / 2, b / 2 + H / 2, g, "glass", "the beaker's wall")
	const temp = P.water_temp_c
	const rho = water_density(temp)
	const depth = pymin(H - 0.01, water_ml / 1e6 / (Math.PI * R * R))
	const water = depth * Math.PI * R * R * rho
	const wm = c.mat({ base: "liquid water", density: pyRound(rho, 4), overrides: {} })
	_weld(c, "water", base, 2 * R - 0.0005, depth, (Math.PI * 2 * R) / 4, 0.0, b / 2 + depth / 2, wm, "glass water", "the liquid in the beaker", true)
	const ballast = _ballast(c, base, pymax(extra_kg, 1e-6), 0.0, 0.0)
	let hid = null
	if (_heat_on())
		hid = c.process("heat", "liquid", { role: "water", solid: base, x0: pyRound(-R, 6), x1: pyRound(R, 6), y0: pyRound(b / 2, 6), y1: pyRound(b / 2 + H, 6),
			depth: pyRound(2 * R, 6), round: true, liquid: pyRound(water, 7), start: Number(temp), lid: false, wall: t, wallMaterial: "glass" })
	return [base, ballast, hid, depth, water]
}

function _chem_looks() {
	add_look("pouch", { fill: "#f3f6f8", shade: "#c7d0d6", roughness: 0.4, metalness: 0.0, clearcoat: 0.3 })
	add_look("steel wool", { fill: "#a7abb0", shade: "#7d8287", roughness: 0.55, metalness: 0.8, clearcoat: 0.0 })
	add_look("atom plastic", { fill: "#f2f2f2", shade: "#bdbdbd", roughness: 0.3, metalness: 0.0, clearcoat: 0.6 })
	_mat("pouch", { density: 1000.0, bounce: 0.05, friction: 0.6, rolling: 0.05, look: "pouch",
		source: "A filled plastic pouch (a cold pack, a hand warmer): soft, it hardly bounces; its density is set by what is in it." })
	_mat("steel wool", { density: 80.0, bounce: 0.05, friction: 0.7, rolling: 0.05, look: "steel wool",
		source: "A pad of fine steel wool: about 5 g in 90 cm³ (its density is set by its mass and what it soaked up); springy, it hardly bounces." })
	_mat("model plastic", { density: 1050.0, bounce: 0.5, friction: 0.4, rolling: 0.01, look: "atom plastic",
		source: "A molecular model kit's polystyrene balls, 1.05 g/cm³ (approximate: kit balls vary)." })
}

function _chemistry_types() {
	_chem_looks()

	function build_cold(c, P) {
		const key = P.chemical
		const [, M, dh, cp] = PACK_CHEMICALS[key]
		const L = 0.15
		const D = 0.12
		const salt = P.salt_g / 1000
		const water = (P.water_ml / 1000) * 0.9982
		const film = 2 * L * D * 0.09 + 0.001 // two faces of 90 g/m² polyethylene film and the 1 g inner water bag
		const t = pymax(0.008, ((water / 998.2 + salt / 1700) / (L * D)) * 1.5)
		const [sid, hid] = _pack(c, P, L, D, pyRound(t, 5), water + salt + film, dh > 0 ? "an instant cold pack" : "an instant hot pack")
		const C = water * C_WATER + salt * cp + film * C_FILM
		c.process("matter", "pack", { role: "pack", solid: sid, heat: hid, chemical: key, molar: M, dh, salt: _r(salt, 9), water: _r(water, 9),
			capacity: _r(C, 6), at: pyRound(P.squeeze_at_s, 4), tau: pyRound(P.dissolve_s, 4), area: _r(2 * (L * D + L * t + t * D), 8) })
		P.change_c = pyRound((((-salt / M) * dh) / C), 1)
		P.thickness = pyRound(t, 4)
	}

	register(new ItemType("cold-pack", "Instant cold pack", CAT, build_cold, {
		material: "pouch", materials: ["pouch"],
		props: [new Prop("chemical", "Chemical", "ammonium nitrate", { kind: "choice", choices: PACK_KEYS,
			help: "Ammonium nitrate (most cold packs), urea or ammonium chloride take heat in as they dissolve; calcium chloride gives heat out (a hot pack)" }),
		new Prop("salt_g", "Chemical", 30.0, 1.0, 150.0, 1.0, "g", "How much of it is in the pack"),
		new Prop("water_ml", "Water bag", 100.0, 20.0, 300.0, 1.0, "mL", "The inner bag of water it dissolves in"),
		new Prop("squeeze_at_s", "Squeezed at", 1.2, 0.0, 20.0, 0.1, "s", "When the inner water bag is burst and the pack shaken (run seconds)"),
		new Prop("dissolve_s", "Dissolves in about", 30.0, 2.0, 600.0, 1.0, "s", "Lesson seconds for most of it to dissolve once shaken (about 30 s shaken, minutes left still)")],
		tags: ["cold pack", "ice pack", "instant cold pack", "hot pack", "endothermic", "exothermic", "chemical reaction", "dissolve",
			"ammonium nitrate", "urea", "calcium chloride", "temperature", "heat", "energy", "first aid", "MS-PS1-6"],
		description: "A 15 × 12 cm instant cold pack lying flat: squeezed at a set time, its inner bag of water bursts and the ammonium nitrate dissolves, " +
			"taking heat in, so the pack goes cold (30 g in 100 mL: from 20 °C to about 2 °C) and slowly warms back to the room. " +
			"Calcium chloride instead gives heat out (a hot pack: 30 g in 100 mL to about 65 °C). A thermometer lying on it reads it; on a " +
			"kitchen scale its mass never changes.",
		source: "ΔsolH: NH4NO3 +25.69, NH4Cl +14.78, CaCl2 −81.3 kJ/mol [CRC-H]; urea +15.1 kJ/mol [NIST-WB]; solubilities [CRC]; heat capacities " +
			"[NIST-WB]; its heat goes into the heat module's world (convection, radiation, what it touches).",
		anchor: "the middle of its bottom", facts: "30 g of ammonium nitrate, a 100 mL water bag, squeezed at 1.2 s",
		readouts: [new Readout("temp_c", "Temperature", { unit: "°C", digits: 1 }), new Readout("dissolved_pct", "Dissolved", { unit: "%", digits: 0 }), new Readout("dissolved_g", "Dissolved", { unit: "g", digits: 1 }),
			new Readout("heat_kj", "Heat given out", { unit: "kJ", digits: 2, help: "+: given out to its surroundings (a hot pack); −: taken in (a cold pack)" }),
			new Readout("burst", "Water bag burst", { unit: "", digits: 0 })],
		module: MODULE
	}))

	function build_warmer(c, P) {
		const L = 0.13
		const D = 0.095
		const iron = P.iron_g / 1000
		const fill = iron / 0.55
		const water = fill * 0.2
		const rest = fill * 0.25
		const fabric = 2 * L * D * 0.12
		const t = pymax(0.004, pymin(0.012, fill / 600 / (L * D)))
		const [sid, hid] = _pack(c, P, L, D, pyRound(t, 5), fill + fabric, "a hand warmer")
		if (hid !== null) c.process("heat", "warmth", { role: "heater", solid: sid, power: 0.0, setpoint: 1500.0 }) // (its rusting's steady heat: matter/chem.ts sets its power)
		const n = iron / FE_M
		const full = n * O2_PER_FE
		const ballast = _ballast(c, sid, full, 0.0, 0.0)
		const C = iron * C_IRON + water * C_WATER + rest * 800.0 + fabric * 1920.0
		const lasts = P.lasts_h * 3600
		c.process("matter", "warmer", { role: "warmer", solid: sid, heat: hid, ballast, iron: _r(iron, 9), full: _r(full, 9), capacity: _r(C, 6),
			at: pyRound(P.open_at_s, 4), lasts: pyRound(lasts, 4), area: _r(2 * (L * D + L * t + t * D), 8) })
		P.power_w = pyRound(pymin(WARMER_MAX_W, (n * FE_HEAT) / lasts), 2)
		P.oxygen_g = pyRound(full * 1000, 2)
	}

	register(new ItemType("hand-warmer", "Hand warmer", CAT, build_warmer, {
		material: "pouch", materials: ["pouch"],
		props: [new Prop("iron_g", "Iron powder", 20.0, 2.0, 60.0, 0.5, "g", "About 55 % of the fill; the rest is water, salt, carbon and vermiculite"),
			new Prop("lasts_h", "Lasts", 5.0, 0.5, 24.0, 0.5, "h", "How long its iron lasts (its air holes let oxygen in this fast): shorter is hotter"),
			new Prop("open_at_s", "Opened at", 1.2, 0.0, 20.0, 0.1, "s", "When its wrapper is torn open and air gets in (run seconds)")],
		tags: ["hand warmer", "heat pack", "exothermic", "chemical reaction", "rust", "iron", "oxidation", "oxygen", "temperature", "heat",
			"energy", "winter", "MS-PS1-6"],
		description: "A 13 × 9.5 cm disposable hand warmer lying flat: opened, air gets in and its iron powder rusts (4Fe + 3O2 → 2Fe2O3), giving out heat " +
			"for hours: on a table it warms from 20 °C to about 40 °C over 10-15 minutes. Its rust is made of the air's oxygen, so on a " +
			"kitchen scale it slowly gets heavier (20 g of iron: +8.6 g over its life). Use time_lapse (60 for minutes, 3600 for hours).",
		source: "ΔfH Fe2O3 −824.2 kJ/mol: 412 kJ per mol of iron [CRC-H]; hand warmer fill and lifetime from makers' safety data sheets; its heat goes " +
			"into the heat module's world.",
		anchor: "the middle of its bottom", facts: "20 g of iron powder, lasts 5 h, opened at 1.2 s",
		readouts: [new Readout("temp_c", "Temperature", { unit: "°C", digits: 1 }), new Readout("iron_left_pct", "Iron left", { unit: "%", digits: 0 }),
			new Readout("oxygen_g", "Oxygen taken in", { unit: "g", digits: 2, help: "From the air: what the scale gains" }), new Readout("power_w", "Heating", { unit: "W", digits: 2 }),
			new Readout("heat_kj", "Heat given out", { unit: "kJ", digits: 1 })],
		module: MODULE
	}))

	function build_wool(c, P) {
		const L = 0.07
		const t = 0.025
		const D = 0.05
		const wool = P.wool_g / 1000
		const [days, held] = SOAKS[P.soaked]
		const liquid = wool * held
		const m = c.mat({ base: "steel wool", density: pyRound((wool + liquid) / (L * t * D), 4), overrides: {} })
		const sid = c.slab("pad", L, t, D, 0.0, t / 2, { material: m, look: "steel wool", words: "a pad of steel wool" })
		const hid = _heat_on() ? c.process("heat", "body", { role: "body", solid: sid, cells: 1 }) : null
		if (hid !== null) c.process("heat", "warmth", { role: "heater", solid: sid, power: 0.0, setpoint: 1500.0 })
		const n = wool / FE_M
		const full = RUST_SHARE * n * O2_PER_FE
		const ballast = _ballast(c, sid, full, 0.0, 0.0)
		c.process("matter", "rust", { role: "rust", solid: sid, heat: hid, ballast, iron: _r(wool, 9), full: _r(full, 9), share: RUST_SHARE,
			capacity: _r(wool * C_IRON + liquid * C_WATER, 6), rustTau: pyRound(days * 86400, 4), at: pyRound(P.from_s, 4),
			area: _r(2 * (L * D + L * t + t * D), 8) })
		P.gain_g = pyRound(full * 1000, 3)
	}

	register(new ItemType("steel-wool", "Steel wool pad", CAT, build_wool, {
		material: "steel wool", materials: ["steel wool"],
		props: [new Prop("wool_g", "Steel wool", 5.0, 0.5, 50.0, 0.5, "g"),
			new Prop("soaked", "Soaked in", "vinegar", { kind: "choice", choices: SOAK_KEYS,
				help: "Vinegar strips its oil and it rusts within a day; salt water about a day; water a few days; dry, weeks (approximate: a modelling choice)" }),
			new Prop("from_s", "Set out at", 1.2, 0.0, 20.0, 0.1, "s", "When it starts to rust (run seconds: after a scale has settled)")],
		tags: ["steel wool", "rust", "rusting", "iron", "oxidation", "oxygen", "chemical change", "chemical reaction", "mass", "heavier",
			"conservation", "new substance", "colour change"],
		description: "A 5 g pad of fine steel wool soaked in vinegar: over days it rusts, turning orange-brown, and because its rust is made of the " +
			"air's oxygen a kitchen scale under it reads more (half of 5 g rusting: +1.07 g). Rusting gives out a little heat (it starts a few " +
			"°C warm). Use time_lapse (86400: a run second is a day).",
		source: "4Fe + 3O2 → 2Fe2O3 (0.43 g of oxygen per g of iron; 412 kJ per mol of iron [CRC-H]); how fast it rusts and how much can rust are " +
			"modelling choices (fine wool soaked in vinegar rusts visibly in hours).",
		anchor: "the middle of its bottom", facts: "5 g of steel wool soaked in vinegar",
		readouts: [new Readout("rust_pct", "Rusted", { unit: "%", digits: 1, help: "Of its iron" }), new Readout("gained_g", "Mass gained", { unit: "g", digits: 3, help: "The oxygen its rust took from the air" }),
			new Readout("oxygen_ml", "Oxygen used", { unit: "mL", digits: 0, help: "From the air, at 20 °C and 1 atm" }), new Readout("temp_c", "Temperature", { unit: "°C", digits: 1 })],
		module: MODULE
	}))

	function addition_record(key, amount, at) {
		const [, , rho, acetic, citric, hco3, co3, na] = ADDITIONS[key]
		const kg = (rho > 0 ? amount * rho : amount) / 1000
		return { what: key, at: pyRound(at, 4), acetic: _r(acetic * amount, 10), citric: _r(citric * amount, 10), hco3: _r(hco3 * amount, 10),
			co3: _r(co3 * amount, 10), na: _r(na * amount, 10), ml: pyRound(rho > 0 ? amount : 0.0, 4), kg: _r(kg, 9) }
	}

	function build_indicator(c, P) {
		const steps = []
		if (P.add !== "none") steps.push(addition_record(P.add, P.amount, P.add_at_s))
		if (P.then_add !== "none") steps.push(addition_record(P.then_add, P.then_amount, P.then_at_s))
		let extra = 0.0
		for (const s of steps) extra += s.kg
		const [base, ballast, hid, , water] = _beaker(c, P, P.water_ml, extra, "a beaker of red cabbage juice")
		steps.forEach((s, k) => {
			_weld(c, `cup${k + 1}`, base, 0.03, 0.03, 0.03, BEAKER_R + BEAKER_T + 0.02 + 0.035 * k, 0.015 - BEAKER_B / 2, c.mat({ base: "cardboard", overrides: {} }),
				"cardboard", `a little cup of ${ADDITIONS[s.what][0]}`)
		})
		c.process("matter", "indicator", { role: "indicator", solid: base, heat: hid, ballast, water: _r(water, 9), start: pyRound(P.water_temp_c, 4), extra: _r(extra, 9), steps,
			fizz: pyRound(P.fizz_s, 4), capacity: _r(BEAKER_G * 750.0, 6), area: _r(2 * Math.PI * BEAKER_R * BEAKER_H, 8) })
	}

	register(new ItemType("indicator-cup", "Red cabbage indicator", CAT, build_indicator, {
		material: "glass", materials: ["glass"],
		props: [new Prop("water_ml", "Red cabbage juice", 100.0, 20.0, 200.0, 1.0, "mL", "Purple: neutral (pH 7)"),
			new Prop("water_temp_c", "Juice temperature", 20.0, 0.0, 80.0, 0.5, "°C"),
			new Prop("add", "Add", "vinegar", { kind: "choice", choices: ADDITION_KEYS, help: "Vinegar and lemon juice are acids (red, pink); baking soda and washing soda are bases (blue, green)" }),
			new Prop("amount", "Of it", 10.0, 0.1, 100.0, 0.1, "mL or g", "mL of a liquid, g of a powder"),
			new Prop("add_at_s", "Added at", 1.2, 0.0, 20.0, 0.1, "s"),
			new Prop("then_add", "Then add", "none", { kind: "choice", choices: ADDITION_KEYS, help: "A second addition: baking soda after vinegar fizzes and turns it back" }),
			new Prop("then_amount", "Of it", 5.0, 0.1, 100.0, 0.1, "mL or g"),
			new Prop("then_at_s", "Then at", 4.0, 0.0, 20.0, 0.1, "s"),
			new Prop("fizz_s", "Fizz lasts about", 3.0, 0.5, 60.0, 0.5, "s", "Lesson seconds for the carbon dioxide made to bubble out")],
		tags: ["indicator", "red cabbage", "acid", "base", "pH", "vinegar", "lemon juice", "baking soda", "washing soda", "colour change",
			"color change", "chemical change", "chemical reaction", "neutralize", "fizz", "beaker"],
		description: "A 250 mL glass beaker of purple red cabbage juice; a little cup of vinegar, lemon juice, baking soda or washing soda is poured in at a " +
			"set time and the juice changes colour with its pH: red and pink for acids, purple neutral, blue and green for bases (10 mL of " +
			"vinegar: pH 2.9, red; 2 g of baking soda: pH 8.3, blue). Baking soda after vinegar fizzes (carbon dioxide) and turns it back.",
		source: "pH from the charge balance with Ka (acetic 1.75e-5; carbonic 4.45e-7, 4.69e-11; citric 7.44e-4, 1.73e-5, 4.02e-7) [CRC]; vinegar 5 % " +
			"[VINEGAR]; lemon juice 48 g/L citric acid [PENNISTON]; red cabbage's colours by pH (approximate, as widely published); heat by ΔfH " +
			"[CRC-H]; ideal solution (no activities: within about 0.2 pH).",
		anchor: "the middle of its base, where it stands", facts: "100 mL of red cabbage juice, 10 mL of vinegar at 1.2 s",
		readouts: [new Readout("ph", "pH", { unit: "", digits: 2 }), new Readout("color_band", "Colour", { unit: "", digits: 0, help: "0 red, 1 pink, 2 purple, 3 blue, 4 blue-green, 5 green, 6 yellow" }),
			new Readout("co2_g", "Gas made", { unit: "g", digits: 3 }), new Readout("escaped_g", "Gas escaped", { unit: "g", digits: 3 }), new Readout("fizz", "Fizzing", { unit: "", digits: 2 }),
			new Readout("temp_c", "Temperature", { unit: "°C", digits: 1 }),
			new Readout("left_g", "Powder not dissolved", { unit: "g", digits: 2, help: "Past what the juice holds (baking soda 9.6 g, washing soda 21.5 g per 100 g at 20 °C) it stays on the bottom" })],
		module: MODULE
	}))

	function build_precip(c, P) {
		const cacl2 = P.cacl2_g / 1000
		const soda = P.soda_g / 1000
		const [base, ballast, hid, depth, water] = _beaker(c, P, P.water_ml, cacl2 + soda, "a beaker of baking soda solution")
		_weld(c, "cup1", base, 0.03, 0.03, 0.03, BEAKER_R + BEAKER_T + 0.02, 0.015 - BEAKER_B / 2, c.mat({ base: "cardboard", overrides: {} }), "cardboard",
			"a little cup of calcium chloride")
		c.process("matter", "precip", { role: "precip", solid: base, heat: hid, ballast, water: _r(water, 9), start: pyRound(P.water_temp_c, 4), cacl2: _r(cacl2 / 0.110984, 10),
			hco3: _r(soda / 0.084007, 10), extra: _r(cacl2 + soda, 9), depth: pyRound(depth, 5), at: pyRound(P.mix_at_s, 4), react: pyRound(P.react_s, 4),
			fizz: pyRound(P.fizz_s, 4), capacity: _r(BEAKER_G * 750.0, 6), area: _r(2 * Math.PI * BEAKER_R * BEAKER_H, 8) })
		const p = pymin(cacl2 / 0.110984, soda / 0.084007 / 2)
		P.chalk_g = pyRound(p * 100.087, 2)
		P.co2_g = pyRound(p * 44.01, 2)
	}

	register(new ItemType("reaction-cup", "Precipitate beaker (calcium chloride + baking soda)", CAT, build_precip, {
		material: "glass", materials: ["glass"],
		props: [new Prop("water_ml", "Water", 100.0, 20.0, 200.0, 1.0, "mL"), new Prop("water_temp_c", "Water temperature", 20.0, 0.0, 80.0, 0.5, "°C"),
			new Prop("soda_g", "Baking soda in it", 5.0, 0.1, 20.0, 0.1, "g", "Dissolved in the water from the start"),
			new Prop("cacl2_g", "Calcium chloride", 5.0, 0.1, 30.0, 0.1, "g", "Road salt: poured in from a little cup"),
			new Prop("mix_at_s", "Poured in at", 1.2, 0.0, 20.0, 0.1, "s"),
			new Prop("react_s", "Reacts in about", 2.0, 0.2, 60.0, 0.1, "s", "Lesson seconds for most of the white solid to form"),
			new Prop("fizz_s", "Fizz lasts about", 3.0, 0.5, 60.0, 0.5, "s", "Lesson seconds for the carbon dioxide made to bubble out")],
		tags: ["precipitate", "chemical change", "chemical reaction", "new substance", "calcium chloride", "baking soda", "cloudy", "chalk",
			"calcium carbonate", "fizz", "bubbles", "gas", "warm", "exothermic", "beaker", "signs of a reaction"],
		description: "A 250 mL glass beaker of clear baking soda solution; calcium chloride poured in at a set time warms it as it dissolves and reacts: " +
			"a cloudy white solid forms (calcium carbonate, chalk) and carbon dioxide bubbles off, so a kitchen scale under it reads less " +
			"(5 g + 5 g: 2.98 g of chalk, 1.31 g of gas). The white solid slowly settles to the bottom. Three signs of a chemical change at once.",
		source: "CaCl2 + 2NaHCO3 → CaCO3 + 2NaCl + H2O + CO2 [CRC-H for the heats]; CO2 dissolves to 1.69 g/L before it bubbles [CRC]; the chalk's " +
			"fine grains (about 10 µm) settle by Stokes' law; how cloudy is a modelling choice (about 1 g/L is milky).",
		anchor: "the middle of its base, where it stands", facts: "5 g of baking soda in 100 mL, 5 g of calcium chloride at 1.2 s",
		readouts: [new Readout("solid_g", "White solid made", { unit: "g", digits: 2 }), new Readout("cloudy", "Cloudy", { unit: "", digits: 2, help: "0 clear, 1 milky" }),
			new Readout("settled_g", "Settled on the bottom", { unit: "g", digits: 2 }), new Readout("co2_g", "Gas made", { unit: "g", digits: 3 }), new Readout("escaped_g", "Gas escaped", { unit: "g", digits: 3 }),
			new Readout("fizz", "Fizzing", { unit: "", digits: 2 }), new Readout("temp_c", "Temperature", { unit: "°C", digits: 1 })],
		module: MODULE
	}))
}

// ---------------------------------------------------------------- models of molecules and crystals: molecule, crystal
// element: [CPK colour, covalent radius Å [CORDERO], van der Waals radius Å [BONDI], ionic radius Å [SHANNON] or 0, atomic weight [IUPAC13], name]
export const ELEMENTS = {
	H: ["#f2f2f2", 0.31, 1.2, 0.0, 1.008, "hydrogen"],
	C: ["#2d2d2d", 0.76, 1.7, 0.0, 12.011, "carbon"],
	N: ["#3a5fd9", 0.71, 1.55, 0.0, 14.007, "nitrogen"],
	O: ["#e0312b", 0.66, 1.52, 0.0, 15.999, "oxygen"],
	Na: ["#9b5fd4", 1.66, 2.27, 1.02, 22.99, "sodium"],
	Cl: ["#3fbf4f", 1.02, 1.75, 1.81, 35.45, "chlorine"]
}
// molecule: [formula, name, atoms [[element, x, y, z] Å], bonds [[i, j, order]], bond angle ° or null, bond length Å] [CCCBDB]
export const MOLECULES = {
	water: ["H₂O", "water", [["O", 0.0, 0.0, 0.0], ["H", -0.75695, -0.58588, 0.0], ["H", 0.75695, -0.58588, 0.0]], [[0, 1, 1], [0, 2, 1]], 104.52, 0.9572],
	"carbon dioxide": ["CO₂", "carbon dioxide", [["C", 0.0, 0.0, 0.0], ["O", -1.16, 0.0, 0.0], ["O", 1.16, 0.0, 0.0]], [[0, 1, 2], [0, 2, 2]], 180.0, 1.16],
	methane: ["CH₄", "methane", [["C", 0.0, 0.0, 0.0], ["H", 0.0, 1.087, 0.0], ["H", 1.02483, -0.36233, 0.0], ["H", -0.51242, -0.36233, 0.88753],
		["H", -0.51242, -0.36233, -0.88753]], [[0, 1, 1], [0, 2, 1], [0, 3, 1], [0, 4, 1]], 109.47, 1.087],
	ammonia: ["NH₃", "ammonia", [["N", 0.0, 0.0, 0.0], ["H", 0.93735, -0.38148, 0.0], ["H", -0.46867, -0.38148, 0.81177], ["H", -0.46867, -0.38148, -0.81177]],
		[[0, 1, 1], [0, 2, 1], [0, 3, 1]], 106.67, 1.012],
	oxygen: ["O₂", "oxygen", [["O", -0.60375, 0.0, 0.0], ["O", 0.60375, 0.0, 0.0]], [[0, 1, 2]], null, 1.2075],
	nitrogen: ["N₂", "nitrogen", [["N", -0.54885, 0.0, 0.0], ["N", 0.54885, 0.0, 0.0]], [[0, 1, 3]], null, 1.0977],
	hydrogen: ["H₂", "hydrogen", [["H", -0.3707, 0.0, 0.0], ["H", 0.3707, 0.0, 0.0]], [[0, 1, 1]], null, 0.7414]
}
const MOLECULE_KEYS = Object.keys(MOLECULES)
export const LATTICES = { salt: ["NaCl", "a salt (sodium chloride) crystal"], diamond: ["C", "a diamond crystal (carbon)"], ice: ["H₂O", "ice (frozen water)"] }
const LATTICE_KEYS = Object.keys(LATTICES)
const STYLES = ["ball-and-stick", "space-filling"]
const SQRT3 = 1.7320508075688772

/** A ball's radius, Å (as the Python's _atom_radius). */
function _atom_radius(el, style, crystal) {
	const [, cov, vdw, ion] = ELEMENTS[el]
	if (style === "space-filling") return crystal ? (ion > 0 ? ion : cov) : vdw
	return ion > 0 ? 0.5 * ion : 0.6 * cov
}

/** A crystal's atoms [[element, x, y, z] Å], bonds [[i, j, order]] (order 0: a hydrogen bond) and each atom's column key (as the Python's). */
export function _crystal_atoms(lattice, n) {
	const atoms = []
	const bonds = []
	const keys = []
	if (lattice === "salt") {
		const s = 2.82
		const m = 2 * n + 1
		const index = new Map()
		for (let i = 0; i < m; i++)
			for (let j = 0; j < m; j++)
				for (let k = 0; k < m; k++) {
					index.set(`${i},${j},${k}`, atoms.length)
					atoms.push([(i + j + k) % 2 === 0 ? "Na" : "Cl", (i - n) * s, (j - n) * s, (k - n) * s])
					keys.push(i * m + j)
				}
		for (const [key, a] of index) {
			const [i, j, k] = key.split(",").map(Number)
			for (const [di, dj, dk] of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
				const b = index.get(`${i + di},${j + dj},${k + dk}`)
				if (b !== undefined) bonds.push([a, b, 1])
			}
		}
	} else if (lattice === "diamond") {
		const q4 = 3.5668 / 4
		const basis = [[0, 0, 0], [0, 2, 2], [2, 0, 2], [2, 2, 0], [1, 1, 1], [1, 3, 3], [3, 1, 3], [3, 3, 1]]
		const index = new Map()
		for (let cx = 0; cx < n; cx++)
			for (let cy = 0; cy < n; cy++)
				for (let cz = 0; cz < n; cz++)
					for (const [bx, by, bz] of basis) {
						const q = [4 * cx + bx, 4 * cy + by, 4 * cz + bz]
						index.set(q.join(","), atoms.length)
						atoms.push(["C", (q[0] - 2 * n) * q4, (q[1] - 2 * n) * q4, (q[2] - 2 * n) * q4])
						keys.push(q[0] * (4 * n + 4) + q[1])
					}
		for (const [key, a] of index) {
			const [x, y, z] = key.split(",").map(Number)
			if ((x + y + z) % 4 === 0)
				for (const [dx, dy, dz] of [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]]) {
					const b = index.get(`${x + dx},${y + dy},${z + dz}`)
					if (b !== undefined) bonds.push([a, b, 1])
				}
		}
	} else {
		const d = Math.sqrt(2.76 * 2.76 - 0.92 * 0.92)
		const oh = 1.0
		const rows = 2 * n
		const cols = n
		const site = new Map()
		for (let j = 0; j < rows; j++)
			for (let i = 0; i < cols; i++) {
				const x = SQRT3 * d * (i + 0.5 * (j % 2))
				site.set(`A,${i},${j}`, [x, 1.5 * d * j, 0.46])
				site.set(`B,${i},${j}`, [x, 1.5 * d * j + d, -0.46])
			}
		const cx = (SQRT3 * d * (cols - 0.5)) / 2
		const cy = (1.5 * d * (rows - 1) + d) / 2
		const index = new Map()
		for (const [key, [x, y, z]] of site) {
			index.set(key, atoms.length)
			atoms.push(["O", x - cx, y - cy, z])
			keys.push(keys.length)
		}
		const h_toward = (a, p, q) => {
			const dx = q[0] - p[0]
			const dy = q[1] - p[1]
			const dz = q[2] - p[2]
			const ln = Math.sqrt(dx * dx + dy * dy + dz * dz)
			const h = atoms.length
			atoms.push(["H", p[0] + (dx * oh) / ln - cx, p[1] + (dy * oh) / ln - cy, p[2] + (dz * oh) / ln])
			keys.push(keys.length)
			bonds.push([a, h, 1])
			return h
		}
		for (let j = 0; j < rows; j++)
			for (let i = 0; i < cols; i++) {
				const A = `A,${i},${j}`
				const B = `B,${i},${j}`
				const pa = site.get(A)
				const pb = site.get(B)
				const h = h_toward(index.get(A), pa, pb)
				bonds.push([h, index.get(B), 0])
				// (the A site's other H points up, out of the layer, to the layer above: it stands right in front of its O)
				atoms.push(["H", pa[0] - cx, pa[1] - cy, pa[2] + oh])
				keys.push(keys[index.get(A)])
				bonds.push([index.get(A), atoms.length - 1, 1])
				for (const di of j % 2 === 0 ? [0, -1] : [0, 1]) {
					const up = [SQRT3 * d * (i + di + 0.5 * ((j + 1) % 2)), 1.5 * d * (j + 1), 0.46]
					const h2 = h_toward(index.get(B), pb, up)
					const other = index.get(`A,${i + di},${j + 1}`)
					if (other !== undefined) bonds.push([h2, other, 0])
				}
			}
	}
	return [atoms, bonds, keys]
}

/** Every atom of a model in the item's frame (m): [[element, x, y, z, radius]], resting on its anchor and centred across (as the Python's). */
export function _model_layout(atoms, style, crystal, scale) {
	const rad = atoms.map((a) => _atom_radius(a[0], style, crystal) * scale)
	let lo = Infinity
	let x0 = Infinity
	let x1 = -Infinity
	atoms.forEach((a, k) => {
		lo = Math.min(lo, a[2] * scale - rad[k])
		x0 = Math.min(x0, a[1] * scale - rad[k])
		x1 = Math.max(x1, a[1] * scale + rad[k])
	})
	const xm = (x0 + x1) / 2
	return atoms.map((a, k) => [a[0], a[1] * scale - xm, a[2] * scale - lo, a[3] * scale, rad[k]])
}

/**
 * The whole model a molecule or crystal item shows, for the view (web/models/mod-matter.js): its atoms [[element, x, y, z, radius]] in the
 * item's frame (m), its bonds [[i, j, order]], and which atom is its root ball (the view draws the model on it). Null for another type.
 */
export function atomModel(type, props) {
	const P = props ?? {}
	const style = STYLES.includes(P.style) ? P.style : "ball-and-stick"
	if (type === "molecule") {
		const [, , atoms, bonds] = MOLECULES[P.molecule] ?? MOLECULES.water
		return { atoms: _model_layout(atoms, style, false, (Number.isFinite(P.scale_cm) ? P.scale_cm : 2.5) / 100), bonds, root: 0 }
	}
	if (type === "crystal") {
		const lattice = Object.prototype.hasOwnProperty.call(LATTICES, P.lattice) ? P.lattice : "salt"
		const [atoms, bonds, keys] = _crystal_atoms(lattice, Number.isInteger(P.cells) ? Math.max(1, Math.min(4, P.cells)) : 2)
		return { atoms: _model_layout(atoms, style, true, (Number.isFinite(P.scale_cm) ? P.scale_cm : 1.2) / 100), bonds, root: 0, keys }
	}
	return null
}

/** The model's balls (as the Python's _build_atoms): one per column of atoms, the first the root and the rest welded to it. */
function _build_atoms(c, P, layout, keys, bonds, readings, words) {
	const first = new Map()
	keys.forEach((key, k) => {
		if (!first.has(key)) first.set(key, k)
	})
	const big = new Map()
	keys.forEach((key, k) => big.set(key, pymax(big.has(key) ? big.get(key) : 0.0, layout[k][4])))
	let whole = 0.0
	for (const a of layout) whole += a[4] * a[4] * a[4]
	let shown = 0.0
	for (const key of first.keys()) shown += big.get(key) * big.get(key) * big.get(key)
	const m = c.mat({ base: "model plastic", density: pyRound((1050.0 * whole) / shown, 4), overrides: {} })
	let root = null
	let rx = 0.0
	let ry = 0.0
	for (const [key, k] of first) {
		const [el, x, y, , ] = layout[k]
		const color = ELEMENTS[el][0]
		const name = `a${k + 1}`
		if (root === null) {
			root = c.ball(name, pyRound(big.get(key), 5), pyRound(x, 5), pyRound(y, 5), { material: m, look: "atom plastic", words: `${words}: a ${ELEMENTS[el][5]} atom`,
				fill: color, color })
			rx = pyRound(x, 5)
			ry = pyRound(y, 5)
		} else {
			c.sb.solids.push({
				kind: c.kind, id: `${c.item.id}/${name}`, words: `${words}: a ${ELEMENTS[el][5]} atom`, item: c.item.id, look: "atom plastic",
				body: { kind: "ball", radius: pyRound(big.get(key), 5) }, material: m, at: { x: pyRound(pyRound(x, 5) - rx, 5), y: pyRound(pyRound(y, 5) - ry, 5) },
				parent: root, placeholder: { fill: color }, render: { kind: "procedural", shade: LOOK_SHADE["atom plastic"] }, depth: 4, color
			})
		}
	}
	c.process("matter", "atoms", { role: "atoms", readings, atoms: layout.length, bonds: bonds.filter((b) => b[2] > 0).length })
	return root
}

function _atom_types() {
	function build_molecule(c, P) {
		const [formula, name, atoms, bonds, angle, length] = MOLECULES[P.molecule]
		const layout = _model_layout(atoms, P.style, false, P.scale_cm / 100)
		let mass = 0.0
		for (const a of atoms) mass += ELEMENTS[a[0]][4]
		const readings = { atoms: atoms.length, bonds: bonds.length, mass_u: pyRound(mass, 3), bond_length_pm: pyRound(length * 100, 2) }
		if (angle !== null) readings.bond_angle_deg = angle
		_build_atoms(c, P, layout, atoms.map((_, k) => k), bonds, readings, `a model of a ${name} molecule`)
		P.formula = formula
	}

	register(new ItemType("molecule", "Molecule model", CAT, build_molecule, {
		material: "model plastic", materials: ["model plastic"],
		props: [new Prop("molecule", "Molecule", "water", { kind: "choice", choices: MOLECULE_KEYS,
			help: "Water (bent, 104.5°), carbon dioxide (straight), methane (a tetrahedron), ammonia (a pyramid), oxygen, nitrogen, hydrogen" }),
		new Prop("style", "Style", "ball-and-stick", { kind: "choice", choices: STYLES, help: "Balls and sticks, or space-filling (each atom as big as it really reaches)" }),
		new Prop("scale_cm", "Model scale", 2.5, 0.5, 10.0, 0.1, "cm per Å", "How big the model is drawn: an ångström is 10⁻¹⁰ m"),
		new Prop("labels", "Label", true, { kind: "bool", help: "Its formula and name over it" })],
		tags: ["molecule", "atom", "atoms", "model", "ball and stick", "space filling", "water", "H2O", "carbon dioxide", "CO2", "methane", "CH4",
			"ammonia", "NH3", "oxygen", "O2", "nitrogen", "N2", "hydrogen", "bond", "particle", "MS-PS1-1"],
		description: "A ball-and-stick (or space-filling) model of one molecule in the model kit's colours (hydrogen white, carbon black, nitrogen blue, " +
			"oxygen red), its atoms as far apart and at the angles the real molecule's are (water bent at 104.5°, carbon dioxide straight, " +
			"methane a tetrahedron), scaled up: 2.5 cm for every ångström (10⁻¹⁰ m). A model: it rests on a table like a model kit's.",
		source: "Bond lengths and angles [CCCBDB]; ball sizes from covalent radii [CORDERO] and van der Waals radii [BONDI]; colours CPK; atomic " +
			"weights [IUPAC13].",
		anchor: "the bottom of its lowest atom, where it rests", facts: "a ball-and-stick water molecule, 2.5 cm per Å",
		readouts: [new Readout("atoms", "Atoms", { unit: "", digits: 0 }), new Readout("bonds", "Bonds", { unit: "", digits: 0 }), new Readout("mass_u", "Molecular mass", { unit: "u", digits: 2 }),
			new Readout("bond_length_pm", "Bond length", { unit: "pm", digits: 1 }), new Readout("bond_angle_deg", "Bond angle", { unit: "°", digits: 1 })],
		module: MODULE
	}))

	function build_crystal(c, P) {
		const lattice = P.lattice
		const [formula, words] = LATTICES[lattice]
		const n = P.cells
		const [atoms, bonds, keys] = _crystal_atoms(lattice, n)
		const layout = _model_layout(atoms, P.style, true, P.scale_cm / 100)
		const counts = new Map()
		for (const a of atoms) counts.set(a[0], (counts.has(a[0]) ? counts.get(a[0]) : 0) + 1)
		const readings = { atoms: atoms.length, cells: n }
		for (const [el, key] of [["Na", "sodium"], ["Cl", "chloride"], ["C", "carbon"], ["O", "oxygen"], ["H", "hydrogen"]]) if (counts.has(el)) readings[key] = counts.get(el)
		_build_atoms(c, P, layout, keys, bonds, readings, `a model of ${words}`)
		P.formula = formula
	}

	register(new ItemType("crystal", "Crystal model", CAT, build_crystal, {
		material: "model plastic", materials: ["model plastic"],
		props: [new Prop("lattice", "Crystal", "salt", { kind: "choice", choices: LATTICE_KEYS,
			help: "Salt: sodium and chloride ions in a cube pattern; diamond: every carbon bonded to four; ice: water molecules in open hexagons" }),
		new Prop("cells", "Size", 2, 1, 4, 1, "cells", "How many repeats of the pattern along each side", { kind: "int" }),
		new Prop("style", "Style", "ball-and-stick", { kind: "choice", choices: STYLES }),
		new Prop("scale_cm", "Model scale", 1.2, 0.3, 5.0, 0.1, "cm per Å"),
		new Prop("labels", "Label", true, { kind: "bool", help: "Its formula and name over it" })],
		tags: ["crystal", "lattice", "salt", "sodium chloride", "NaCl", "ions", "diamond", "carbon", "ice", "hexagonal", "atoms", "model",
			"structure", "repeating pattern", "MS-PS1-1"],
		description: "A model of a crystal: a salt crystal's sodium (purple) and chloride (green) ions in a repeating cube pattern, a diamond's carbon " +
			"atoms each bonded to four, or ice's water molecules held in open hexagons by hydrogen bonds (why ice floats). Scaled up 1.2 cm per " +
			"ångström; the cells prop sets how many repeats.",
		source: "NaCl a = 5.640 Å, ionic radii Na+ 1.02, Cl− 1.81 Å [CRC; SHANNON]; diamond a = 3.5668 Å [CRC]; ice Ih O–O 2.76 Å, O–H 1.00 Å " +
			"(Petrenko & Whitworth, Physics of Ice, 1999).",
		anchor: "the bottom of its lowest atom, where it rests", facts: "a salt crystal 5 ions along each edge (125 ions)",
		readouts: [new Readout("atoms", "Atoms", { unit: "", digits: 0 }), new Readout("cells", "Repeats", { unit: "", digits: 0 }), new Readout("sodium", "Sodium ions", { unit: "", digits: 0 }),
			new Readout("chloride", "Chloride ions", { unit: "", digits: 0 }), new Readout("carbon", "Carbon atoms", { unit: "", digits: 0 }), new Readout("oxygen", "Oxygen atoms", { unit: "", digits: 0 }),
			new Readout("hydrogen", "Hydrogen atoms", { unit: "", digits: 0 })],
		module: MODULE
	}))
}

// ---------------------------------------------------------------- goal kinds (machines/mod_matter.py reports the same, number for number)
const _trim = (v) => fmtF(v, 2).replace(/0+$/, "").replace(/\.$/, "")

/** The mean of a reading over the frames from t0 to t1 (s), or null when none falls there. */
function _settled(times, values, t0, t1) {
	let total = 0.0
	let n = 0
	const len = pymin(times.length, values.length)
	for (let i = 0; i < len; i++) {
		const t = times[i]
		const v = values[i]
		if (t0 <= t && t <= t1 && v !== null && v !== undefined) {
			total += v
			n += 1
		}
	}
	return n ? total / n : null
}

/** A kitchen scale's reading at rest after the release and at the end, g: [start, end] or null. */
function _scale_change(ctx, g) {
	const v = ctx.state(g.scale, "grams")
	if (v === null || !ctx.times.length) return null
	const rel = typeof ctx.scene.release === "number" ? ctx.scene.release : 0.5
	const end = ctx.times[ctx.times.length - 1]
	const a = _settled(ctx.times, v, rel + 0.5, rel + 0.6)
	const b = _settled(ctx.times, v, end - 0.3, end)
	if (a === null || b === null) return null
	return [a, b]
}

export function goal_mass_same(ctx, g) {
	if (!ctx.known(g.scale)) return null
	let tol = ctx.num(g.tol_g)
	tol = tol === null ? 1.0 : tol
	const ab = _scale_change(ctx, g)
	const ok = ab !== null && Math.abs(ab[1] - ab[0]) <= tol
	const out = { label: truthy(g.label) ? g.label : `${ctx.name(g.scale)} reads the same before and after`, ok, kind: "mass_same", scale: g.scale }
	if (ab !== null) {
		out.start_g = pyRound(ab[0], 2)
		out.end_g = pyRound(ab[1], 2)
	}
	return out
}

export function goal_mass_changes(ctx, g) {
	if (!ctx.known(g.scale)) return null
	const by = ctx.num(g.by_g)
	if (by === null) return null
	let tol = ctx.num(g.tol_g)
	tol = tol === null ? pymax(0.2, Math.abs(by) / 10) : tol
	const ab = _scale_change(ctx, g)
	const ok = ab !== null && Math.abs(ab[1] - ab[0] - by) <= tol
	const sign = by >= 0 ? "+" : "−"
	const out = { label: truthy(g.label) ? g.label : `${ctx.name(g.scale)} changes by ${sign}${_trim(Math.abs(by))} g`, ok, kind: "mass_changes", scale: g.scale }
	if (ab !== null) out.change_g = pyRound(ab[1] - ab[0], 2)
	return out
}

/** When item iid's crystals were all dissolved (left under 1 % of what was put in, or under 5 mg), s, or null. */
function _dissolved_at(ctx, iid) {
	const left = ctx.state(iid, "left_g")
	const gone = ctx.state(iid, "dissolved_g")
	if (left === null || gone === null) return null
	const len = pymin(ctx.times.length, pymin(left.length, gone.length))
	for (let i = 0; i < len; i++) {
		const a = left[i]
		const b = gone[i]
		if (a !== null && a !== undefined && b !== null && b !== undefined && b > 0 && a <= pymax(0.005, 0.01 * (a + b))) return ctx.times[i]
	}
	return null
}

export function goal_dissolves(ctx, g) {
	const iid = g.item
	if (!ctx.known(iid) || ctx.state(iid, "left_g") === null) return null
	const by = ctx.num(g.before_s)
	const t = _dissolved_at(ctx, iid)
	const when = by === null ? "" : ` by ${_trim(by)} s`
	return { label: truthy(g.label) ? g.label : `what is in ${ctx.name(iid)} dissolves${when}`, ok: t !== null && (by === null || t <= by), kind: "dissolves",
		item: iid, t: t === null ? null : pyRound(t, 3) }
}

export function goal_dissolves_first(ctx, g) {
	const a = g.a
	const b = g.b
	if (!ctx.known(a) || !ctx.known(b) || ctx.state(a, "dissolved_pct") === null || ctx.state(b, "dissolved_pct") === null) return null
	const ta = _dissolved_at(ctx, a)
	const tb = _dissolved_at(ctx, b)
	let ok
	if (ta !== null) ok = tb === null || ta < tb
	else if (tb !== null) ok = false
	else {
		const va = ctx.state(a, "dissolved_pct")
		const vb = ctx.state(b, "dissolved_pct")
		ok = va[va.length - 1] > vb[vb.length - 1]
	}
	return { label: truthy(g.label) ? g.label : `${ctx.name(a)} dissolves before ${ctx.name(b)}`, ok, kind: "dissolves_first", a, b,
		ta: ta === null ? null : pyRound(ta, 3), tb: tb === null ? null : pyRound(tb, 3) }
}

const STATES = ["solid", "liquid", "gas", "melting", "boiling"]
const last = (v) => v[v.length - 1]

export function goal_state(ctx, g) {
	const iid = g.item
	const want = g.is
	if (!ctx.known(iid) || !STATES.includes(want) || ctx.state(iid, "solid_pct") === null) return null
	const s = last(ctx.state(iid, "solid_pct"))
	const l = last(ctx.state(iid, "liquid_pct"))
	const v = last(ctx.state(iid, "gas_pct"))
	const now = s >= 99.5 ? "solid" : l >= 99.5 ? "liquid" : v >= 99.5 ? "gas" : s > 0 && l > 0 ? "melting" : l > 0 && v > 0 ? "boiling" : "mixed"
	return { label: truthy(g.label) ? g.label : `${ctx.name(iid)} ends ${want}`, ok: now === want, kind: "state", item: iid, now }
}

export function goal_separates(ctx, g) {
	const iid = g.item
	if (!ctx.known(iid)) return null
	const kp = ctx.state(iid, "kept_pct")
	const fp = ctx.state(iid, "filtrate_pct")
	if (kp !== null && fp !== null) {
		const ok = last(kp) >= 95 && last(fp) >= 80
		return { label: truthy(g.label) ? g.label : `${ctx.name(iid)} separates its mixture`, ok, kind: "separates", item: iid,
			a_pct: pyRound(last(kp), 1), b_pct: pyRound(last(fp), 1) }
	}
	const ap = ctx.state(iid, "a_passed_pct")
	const bp = ctx.state(iid, "b_passed_pct")
	if (ap !== null && bp !== null) {
		const ok = last(ap) >= 95 && last(bp) <= 5
		return { label: truthy(g.label) ? g.label : `${ctx.name(iid)} separates its mixture`, ok, kind: "separates", item: iid,
			a_pct: pyRound(last(ap), 1), b_pct: pyRound(last(bp), 1) }
	}
	const al = ctx.state(iid, "a_left_pct")
	const bl = ctx.state(iid, "b_left_pct")
	if (al === null || bl === null) return null
	const ok = 100 - last(bl) >= 90 && 100 - last(al) <= 5
	return { label: truthy(g.label) ? g.label : `${ctx.name(iid)} separates its mixture`, ok, kind: "separates", item: iid,
		a_pct: pyRound(100 - last(al), 1), b_pct: pyRound(100 - last(bl), 1) }
}

export function goal_mixes(ctx, g) {
	const iid = g.item
	if (!ctx.known(iid) || ctx.state(iid, "mixed_pct") === null) return null
	let least = ctx.num(g.at_least)
	least = least === null ? 80.0 : least
	const v = last(ctx.state(iid, "mixed_pct"))
	return { label: truthy(g.label) ? g.label : `${ctx.name(iid)} mixes`, ok: v >= least, kind: "mixes", item: iid, mixed_pct: pyRound(v, 1) }
}

export function goal_saturates(ctx, g) {
	const iid = g.item
	if (!ctx.known(iid) || ctx.state(iid, "saturated") === null) return null
	const v = last(ctx.state(iid, "saturated"))
	const left = last(ctx.state(iid, "left_g"))
	return { label: truthy(g.label) ? g.label : `${ctx.name(iid)} ends saturated with some left over`, ok: v >= 0.5, kind: "saturates", item: iid,
		left_g: pyRound(left, 2) }
}

/** A reading's mean over the run's last `span` seconds (a gauge on a few particles flickers), or null. */
function _end_mean(ctx, iid, key, span = 0.5) {
	const v = ctx.state(iid, key)
	if (v === null || !ctx.times.length) return null
	const end = ctx.times[ctx.times.length - 1]
	return _settled(ctx.times, v, end - span, end)
}

export function goal_pressure(ctx, g) {
	const iid = g.item
	const want = ctx.num(g.kpa)
	if (!ctx.known(iid) || want === null || ctx.state(iid, "pressure_kpa") === null) return null
	let tol = ctx.num(g.tol_kpa)
	tol = tol === null ? Math.abs(want) * 0.1 : tol
	const v = _end_mean(ctx, iid, "pressure_kpa", 1.0)
	return { label: truthy(g.label) ? g.label : `${ctx.name(iid)} reads ${_trim(want)} kPa`, ok: v !== null && Math.abs(v - want) <= tol, kind: "pressure",
		item: iid, kpa: v === null ? null : pyRound(v, 1) }
}

export function goal_volume(ctx, g) {
	const iid = g.item
	const want = ctx.num(g.ml)
	if (!ctx.known(iid) || want === null) return null
	let v
	if (ctx.state(iid, "volume_ml") !== null) v = _end_mean(ctx, iid, "volume_ml")
	else if (ctx.state(iid, "volume_l") !== null) v = last(ctx.state(iid, "volume_l")) * 1000
	else return null
	let tol = ctx.num(g.tol_ml)
	tol = tol === null ? Math.abs(want) * 0.05 : tol
	return { label: truthy(g.label) ? g.label : `${ctx.name(iid)} ends at ${_trim(want)} mL`, ok: v !== null && Math.abs(v - want) <= tol, kind: "volume",
		item: iid, ml: v === null ? null : pyRound(v, 1) }
}

export function goal_crystallizes(ctx, g) {
	const iid = g.item
	if (!ctx.known(iid)) return null
	const cr = ctx.state(iid, "crystals_g")
	const dis = ctx.state(iid, "dissolved_g")
	if (cr === null || dis === null) return null
	let want = ctx.num(g.g)
	want = want === null ? last(cr) + last(dis) : want
	let tol = ctx.num(g.tol_g)
	tol = tol === null ? pymax(0.05, Math.abs(want) * 0.02) : tol
	return { label: truthy(g.label) ? g.label : `${ctx.name(iid)} leaves ${_trim(want)} g of crystals`, ok: Math.abs(last(cr) - want) <= tol, kind: "crystallizes",
		item: iid, crystals_g: pyRound(last(cr), 2) }
}

const TEMP_KEYS = ["temp_c", "reading", "water_temp", "temp"] // an item's temperature: this module's, a thermometer's, a cup's water, a heat body's
const COLOR_WORDS = { violet: "purple", magenta: "pink", teal: "blue-green", turquoise: "blue-green", cloudy: "white", milky: "white",
	rust: "brown", rusty: "brown", orange: "brown", "orange-brown": "brown" }
const present = (v) => v.filter((x) => x !== null && x !== undefined)

/** An item's temperature readings (°C, the frames that have one), by the first of TEMP_KEYS it has, or null. */
function _temps(ctx, iid) {
	for (const key of TEMP_KEYS) {
		const v = ctx.state(iid, key)
		if (v !== null) {
			const vals = present(v)
			if (vals.length) return vals
		}
	}
	return null
}

export function goal_warms_by(ctx, g) {
	const iid = g.item
	const least = ctx.num(g.at_least_c)
	if (!ctx.known(iid) || least === null) return null
	const v = _temps(ctx, iid)
	if (v === null) return null
	const rise = maxOf(v) - v[0]
	return { label: truthy(g.label) ? g.label : `${ctx.name(iid)} warms by at least ${_trim(least)} °C`, ok: rise >= least, kind: "warms_by", item: iid,
		change_c: pyRound(rise, 2) }
}

export function goal_cools_by(ctx, g) {
	const iid = g.item
	const least = ctx.num(g.at_least_c)
	if (!ctx.known(iid) || least === null) return null
	const v = _temps(ctx, iid)
	if (v === null) return null
	const drop = v[0] - minOf(v)
	return { label: truthy(g.label) ? g.label : `${ctx.name(iid)} cools by at least ${_trim(least)} °C`, ok: drop >= least, kind: "cools_by", item: iid,
		change_c: pyRound(drop, 2) }
}

export function goal_color_changes(ctx, g) {
	const iid = g.item
	if (!ctx.known(iid)) return null
	const to = g.to
	let want = null
	if (typeof to === "string" && pyStrip(to)) {
		const w = pyLower(pyStrip(to))
		want = hasOwn(COLOR_WORDS, w) ? COLOR_WORDS[w] : w
	}
	const band = ctx.state(iid, "color_band")
	const cloudy = ctx.state(iid, "cloudy")
	const rust = ctx.state(iid, "rust_pct")
	const label = truthy(g.label) ? g.label : `${ctx.name(iid)} changes colour` + (want ? ` to ${want}` : "")
	if (band !== null) {
		const v = present(band)
		if (!v.length) return null
		const a = pymin(6, pymax(0, Math.trunc(v[0])))
		const b = pymin(6, pymax(0, Math.trunc(last(v))))
		const changed = v.some((x) => Math.trunc(x) !== Math.trunc(v[0]))
		const now = BAND_NAMES[b]
		return { label, ok: changed && (want === null || want === now), kind: "color_changes", item: iid, was: BAND_NAMES[a], now }
	}
	if (cloudy !== null) {
		const v = present(cloudy)
		if (!v.length) return null
		const turned = v[0] < 0.1 && maxOf(v) >= 0.5
		return { label, ok: turned && (want === null || want === "white"), kind: "color_changes", item: iid, was: v[0] < 0.1 ? "clear" : "cloudy",
			now: maxOf(v) >= 0.5 ? "cloudy white" : "clear" }
	}
	if (rust !== null) {
		const v = present(rust)
		if (!v.length) return null
		return { label, ok: last(v) >= 5 && (want === null || want === "brown"), kind: "color_changes", item: iid, was: "grey",
			now: last(v) >= 5 ? "orange-brown" : "grey" }
	}
	return null
}

// (the goal kinds reach the summary through the plugin's `goals` (web/sim/modules/index.js registers them); register_goal_kind is not called here
// a second time)
const HOLD_PHASES = { melting: "melting", melts: "melting", melt: "melting", boiling: "boiling", boils: "boiling", boil: "boiling" }

/** [per frame: whether item iid is `phase`, per frame: its temperature °C] or null (mod_matter.py _phase_frames). */
function _phase_frames(ctx, iid, phase) {
	const s = ctx.state(iid, "solid_pct")
	const l = ctx.state(iid, "liquid_pct")
	const v = ctx.state(iid, "gas_pct")
	if (s !== null && l !== null && v !== null) {
		const [a, b] = phase === "melting" ? [s, l] : [l, v]
		const n = Math.min(a.length, b.length)
		const on = []
		for (let i = 0; i < n; i++) on.push(a[i] !== null && a[i] !== undefined && b[i] !== null && b[i] !== undefined && a[i] > 0 && b[i] > 0)
		return [on, ctx.state(iid, "temp_c")]
	}
	if (phase === "melting" && ctx.state(iid, "melted") !== null) return [ctx.state(iid, "melted").map((x) => x !== null && x !== undefined && 0 < x && x < 1), ctx.state(iid, "temp")]
	if (phase === "boiling" && ctx.state(iid, "boiling") !== null) {
		const temps = ctx.state(iid, "water_temp") !== null ? ctx.state(iid, "water_temp") : ctx.state(iid, "temp_c")
		return [ctx.state(iid, "boiling").map((x) => x !== null && x !== undefined && x >= 0.5), temps]
	}
	return null
}

/** {kind: "holds_at", item, temp_c, while: melting | boiling, tol_c?}: a heating curve's plateau (mod_matter.py goal_holds_at). */
function goal_holds_at(ctx, g) {
	const iid = g.item
	const w = typeof g.while === "string" ? g.while : g.while === null || g.while === undefined || g.while === false || g.while === 0 || g.while === "" ? "" : String(g.while)
	const key = pyLower(pyStrip(w))
	const phase = hasOwn(HOLD_PHASES, key) ? HOLD_PHASES[key] : null
	const want = ctx.num(g.temp_c)
	if (!ctx.known(iid) || phase === null || want === null) return null
	const pf = _phase_frames(ctx, iid, phase)
	if (pf === null || pf[1] === null) return null
	let tol = ctx.num(g.tol_c)
	tol = tol === null ? 0.5 : Math.abs(tol)
	const ts = []
	const n = Math.min(ctx.times.length, pf[0].length, pf[1].length)
	for (let i = 0; i < n; i++) if (pf[0][i] && pf[1][i] !== null && pf[1][i] !== undefined) ts.push([ctx.times[i], pf[1][i]])
	const verb = phase === "melting" ? "melts" : "boils"
	const out = { label: truthy(g.label) ? g.label : `${ctx.name(iid)} stays at ${_trim(want)} °C while it ${verb}`, ok: false, kind: "holds_at", item: iid, while: phase }
	if (ts.length) {
		let lo = ts[0][1]
		let hi = ts[0][1]
		for (const [, x] of ts) {
			if (x < lo) lo = x
			if (x > hi) hi = x
		}
		out.ok = ts.length >= 2 && Math.abs(lo - want) <= tol && Math.abs(hi - want) <= tol
		out.from_s = pyRound(ts[0][0], 3)
		out.until_s = pyRound(ts[ts.length - 1][0], 3)
		out.low_c = pyRound(lo, 2)
		out.high_c = pyRound(hi, 2)
	}
	return out
}

/** Before the run (items.js WARNING_HOOKS): mod_matter.py _matter_warnings, word for word. */
function _matter_warnings(scene, doc) {
	const air = (doc.settings ?? {}).air !== false
	const out = []
	for (const it of scene.items ?? []) {
		if (it === null || typeof it !== "object" || Array.isArray(it) || !["particle-box", "syringe", "evaporating-dish"].includes(it.type) || !(it.type in TYPES)) continue
		const P = props_of(it)
		const name = truthy(it.name) ? it.name : it.id
		if (it.type === "particle-box" && P.sample_g / 1000 > _box_sample(P))
			out.push({ items: [it.id], text: `${name}: ${_trim(P.sample_g)} g of ${P.substance} cannot fit in ${_trim(P.volume_ml)} mL (no ` +
				`tighter than its solid or liquid): it holds ${_trim(_box_sample(P) * 1000)} g` })
		if (it.type === "syringe" && P.push_to_ml > 0) {
			const force = ((ATM * P.start_ml) / P.push_to_ml - (air ? ATM : 0.0)) * SYRINGE_AREA
			if (Math.abs(force) > PUSH_SAID)
				out.push({ items: [it.id], text: `${name}: holding its plunger at ${_trim(P.push_to_ml)} mL takes about ${_trim(pyRoundInt(Math.abs(force)))} N ` +
					`(the weight of ${_trim(pyRoundInt(Math.abs(force) / 9.81))} kg): more than one hand pushes` })
		}
		if (it.type === "evaporating-dish" && !air)
			out.push({ items: [it.id], text: `${name} needs air: in a vacuum its water would boil at room temperature and freeze, which this model ` +
				`does not show, so nothing evaporates (turn the air on)` })
	}
	return out
}

function _goals() {}

// ================================================================ the AI's view of the module (web/sim/plugins.js)
const MATTER_TYPES = ["particle-box", "syringe", "balloon-bath", "dissolving-glass", "zip-bag", "chocolate-bar", "reaction-bottle", "pumped-ball",
	"mixture-dish", "sieve", "filter-funnel", "evaporating-dish", "density-cube", "equal-mass-block", "cold-pack", "hand-warmer", "steel-wool", "indicator-cup",
	"reaction-cup", "molecule", "crystal"]
const n1 = (v, d = 1) => (Number.isFinite(v) ? fmtF(v, d).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1") : "?")
const lastOf = (v) => (Array.isArray(v) && v.length ? v[v.length - 1] : null)
const firstOf = (v) => (Array.isArray(v) && v.length ? v[0] : null)

/** When a reading first passes a test (s), from a run's track (null if never). */
function firstTime(track, item, key, test) {
	const v = track?.state?.[item]?.[key]
	const f = track?.frames
	if (!Array.isArray(v) || !Array.isArray(f)) return null
	for (let i = 0; i < Math.min(v.length, f.length); i++) if (Number.isFinite(v[i]) && test(v[i])) return f[i].t
	return null
}

function stateWord(s, l, g) {
	return s >= 99.5 ? "solid" : l >= 99.5 ? "liquid" : g >= 99.5 ? "gas" : s > 0 && l > 0 ? `melting (${n1(l, 0)} % melted)` : l > 0 && g > 0 ? `boiling (${n1(g, 0)} % boiled off)` : "mixed"
}

/** The edit step's extra lines for an item of this module (its readings are listed besides, by the readouts). */
function digestLines(item, sim) {
	if (!MATTER_TYPES.includes(item?.type)) return null
	const st = sim?.track?.state?.[item.id] ?? null
	const p = item.props ?? {}
	const rec = (sim?.doc?.processes ?? []).find((r) => r.item === item.id && r.kind === "matter") ?? null
	const out = []
	const L = (key) => lastOf(st?.[key])
	const F0 = (key) => firstOf(st?.[key])
	switch (item.type) {
		case "particle-box": {
			if (st) {
				const s0 = stateWord(F0("solid_pct"), F0("liquid_pct"), F0("gas_pct"))
				const s1 = stateWord(L("solid_pct"), L("liquid_pct"), L("gas_pct"))
				out.push(`${rec?.substance ?? p.substance ?? "water"}: ${n1(F0("temp_c"))} °C ${s0} → ${n1(L("temp_c"))} °C ${s1}; heat put in ${n1(L("heat_kj"), 2)} kJ`)
				const melt = firstTime(sim.track, item.id, "liquid_pct", (v) => v > 0)
				const boil = firstTime(sim.track, item.id, "gas_pct", (v) => v > 0)
				if (melt !== null || boil !== null) out.push(`began melting at ${melt === null ? "—" : `${n1(melt, 2)} s`}, boiling at ${boil === null ? "—" : `${n1(boil, 2)} s`} (run time)`)
				if (Number.isFinite(L("pressure_kpa")) && L("gas_pct") > 0) out.push(`gas: ${n1(L("pressure_kpa"))} kPa in ${n1(L("volume_ml"), 0)} mL; molecules' mean speed ${n1(L("speed_ms"), 0)} m/s (the model's particles move 1/1250 of it)`)
				if (rec?.divider) out.push(`divider lifted at ${n1(rec.openAt, 1)} s: ${n1(L("mixed_pct"), 0)} % mixed at the end (a MODEL clock: real gases take about L²/2D, minutes to hours, whatever the time-lapse)`)
			}
			if (rec && rec.heater === 0) out.push("no heater: its temperature stays where it starts")
			out.push("the particles are a MODEL (drawn about 10⁷× bigger than molecules, moving 1/1250 as fast); the readings are the real sample's")
			break
		}
		case "syringe":
			if (st) out.push(`${n1(F0("volume_ml"))} mL at ${n1(F0("pressure_kpa"))} kPa → ${n1(L("volume_ml"))} mL at ${n1(L("pressure_kpa"))} kPa (Boyle: p·V stays ${n1((F0("pressure_kpa") * F0("volume_ml")) / 1000, 2)} → ${n1((L("pressure_kpa") * L("volume_ml")) / 1000, 2)} kPa·L)`)
			if (st && Number.isFinite(L("force_n"))) out.push(`holding the plunger there takes ${n1(Math.abs(L("force_n")), 0)} N (${L("force_n") >= 0 ? "a push" : "a pull"}; the weight of ${n1(Math.abs(L("force_n")) / 9.81, 0)} kg)`)
			break
		case "balloon-bath":
			if (st) out.push(`air ${n1(F0("temp_c"))} → ${n1(L("temp_c"))} °C (water ${n1(p.water_temp_c ?? 60)} °C): balloon ${n1(F0("volume_l"), 3)} → ${n1(L("volume_l"), 3)} L (V ∝ T in kelvin)`)
			break
		case "dissolving-glass": {
			const sol = rec?.solute ?? p.solute ?? "salt"
			const S = Number.isFinite(rec?.solubility) ? rec.solubility : solubility(sol, p.water_temp_c ?? 20)
			const water = rec ? Math.PI * rec.radius * rec.radius * rec.depth * 1e6 : (p.water_ml ?? 200)
			out.push(`${n1(rec ? rec.mass * 1000 : p.solute_g ?? 6, 1)} g of ${sol} (${p.grain ?? "default"} grains) into ${n1(water, 0)} mL at ${n1(rec?.temp ?? p.water_temp_c ?? 20)} °C; ` +
				(S > 0 ? `the water can hold ${n1((S * water) / 100, 1)} g (${n1(S, 1)} g per 100 g)` : "it does not dissolve"))
			out.push(rec && rec.stir > 0 ? `stirred ${n1(rec.stir, 1)} turns a second from ${n1(rec.stirFrom, 1)} to ${n1(rec.stirUntil, 1)} s` : "not stirred (still water)")
			if (st) {
				const done = firstTime(sim.track, item.id, "left_g", (v) => v <= 0.005)
				out.push(`end: ${n1(L("dissolved_g"), 2)} g dissolved, ${n1(L("left_g"), 2)} g left${L("saturated") >= 0.5 ? " (SATURATED)" : ""}; ${n1(L("clock_s"), 0)} s of lesson time since poured; ` +
					(done === null ? "not all dissolved in the run" : `all dissolved at ${n1(done, 2)} s`))
			}
			break
		}
		case "zip-bag":
			if (st) out.push(`holds ${n1(L("contents_g"), 1)} g; ${n1(L("water_g"), 2)} g has melted or left its contents as water (kept in the bag${p.sealed === false ? "; the bag is OPEN" : ""})`)
			break
		case "chocolate-bar":
			if (st) out.push(`${L("pieces_apart") > 0 ? `snapped: ${n1(L("pieces_apart"), 0)} pieces apart` : "still whole"} (snaps at ${n1(rec?.snapAt ?? p.snap_at_s ?? 1, 1)} s)`)
			break
		case "reaction-bottle":
			out.push(`${n1(p.soda_g ?? 5, 1)} g baking soda into ${n1(p.vinegar_ml ?? 100, 0)} mL of ${n1(p.acid_pct ?? 5, 1)} % vinegar at ${n1(rec?.mixAt ?? 1, 1)} s; can make ${n1((rec?.co2 ?? 0) * 1000, 2)} g of CO2; closure ${rec?.closure ?? p.closure ?? "open"}`)
			if (st) out.push(`made ${n1(L("co2_g"), 2)} g, escaped ${n1(L("escaped_g"), 2)} g, balloon ${n1(L("balloon_ml"), 0)} mL, pressure ${n1(L("pressure_kpa"), 0)} kPa` +
				(Number.isFinite(L("co2_dissolved_g")) && L("co2_dissolved_g") > 0 ? `, ${n1(L("co2_dissolved_g"), 2)} g dissolved in the vinegar` : "") +
				(L("popped") >= 0.5 ? `; the CAP POPPED at ${n1(firstTime(sim.track, item.id, "popped", (v) => v >= 0.5), 2)} s (past 900 kPa) and the gas escaped` : ""))
			break
		case "pumped-ball":
			if (st) out.push(`air inside ${n1(F0("air_g"), 2)} → ${n1(L("air_g"), 2)} g (${n1(F0("gauge_bar"), 2)} → ${n1(L("gauge_bar"), 2)} bar gauge)`)
			break
		case "mixture-dish":
		case "sieve": {
			const [ka, kb] = MIXTURES[p.mixture ?? (item.type === "sieve" ? "sand + gravel" : "sand + iron filings")] ?? ["first", "second"]
			const [a, b] = [ka.replace(/-/g, " "), kb.replace(/-/g, " ")]
			if (item.type === "sieve") {
				out.push(`${a} (${n1(GRAINS[ka]?.[0] * 1000, 1)} mm) and ${b} (${n1(GRAINS[kb]?.[0] * 1000, 1)} mm); mesh ${n1(p.aperture_mm ?? 4, 1)} mm; shaken ${n1(p.shake_mm ?? 10, 1)} mm × ${n1(p.shake_hz ?? 4, 1)} Hz`)
				if (st) out.push(`through the mesh at the end: ${a} ${n1(L("a_passed_pct"), 0)} %, ${b} ${n1(L("b_passed_pct"), 0)} %`)
			} else {
				const wand = rec?.wand ? `a magnet wand swept ${n1(rec.wand.height * 100, 1)} cm above the floor from ${n1(rec.wand.from, 1)} to ${n1(rec.wand.until, 1)} s, then lifted out` : null
				const linked = rec?.magnet ? `${rec.magnet.item} (${n1(rec.magnet.br, 2)} T)` : null
				out.push(`${a} and ${b}; magnet: ${[wand, linked].filter(Boolean).join(" and ") || "none (wand off and no magnet linked)"}`)
				if (st) out.push(`taken out at the end: ${a} ${n1(100 - L("a_left_pct"), 0)} %, ${b} ${n1(100 - L("b_left_pct"), 0)} %`)
			}
			break
		}
		case "filter-funnel": {
			const sol = p.solid ?? "sand"
			const dis = p.dissolved ?? "salt"
			const T0 = p.water_temp_c ?? 20
			const holds = dis === "none" ? 0 : (solubility(dis, T0) * (p.water_ml ?? 100) * water_density(T0)) / 1000 / 100
			const disG = pymin(p.dissolved_g ?? 5, holds)
			out.push(`${sol === "none" ? "no undissolved solid" : `${n1(p.solid_g ?? 10, 1)} g of ${sol}`} and ${dis === "none" ? "nothing dissolved" : `${n1(disG, 2)} g of ${dis} dissolved${(p.dissolved_g ?? 5) > disG + 0.005 ? ` (${n1((p.dissolved_g ?? 5) - disG, 2)} g more than it holds stays as crystals on the paper)` : ""}`} in ${n1(p.water_ml ?? 100, 0)} mL, poured through ${p.paper ?? "filter paper"} in a ${n1(p.funnel_mm ?? 75, 0)} mm funnel at ${n1(p.pour_at_s ?? 0.5, 1)} s (over ${n1(p.pour_s ?? 3, 1)} s), then a ${n1(p.rinse_ml ?? 10, 0)} mL rinse`)
			if (st) {
				out.push(`end: ${n1(L("filtrate_ml"), 1)} mL through (${n1(L("filtrate_pct"), 0)} % of the water), ${n1(L("in_funnel_ml"), 1)} mL still in the funnel, ${n1(L("held_ml"), 1)} mL held by the wet paper; on the paper ${n1(L("kept_g"), 2)} g (${n1(L("kept_pct"), 0)} % of the undissolved); through: ${n1(L("through_g"), 2)} g undissolved${L("clear") >= 0.5 ? " (the filtrate is clear)" : " (CLOUDY: the solid came through)"}, ${n1(L("salt_through_g"), 2)} g dissolved (${n1(L("salt_through_pct"), 0)} %); ${n1(L("clock_s"), 0)} s of lesson time since poured`)
				const done = firstTime(sim.track, item.id, "filtrate_pct", (v) => v >= 80)
				out.push(done === null ? "the water was not 80 % through by the end of the run (it takes minutes: time_lapse, a bigger funnel or a faster paper)" : `80 % of the water through at ${n1(done, 2)} s (run time)`)
			}
			break
		}
		case "evaporating-dish": {
			const how = p.heat ?? "hot plate"
			const sol = p.solute ?? "salt"
			const T0 = p.water_temp_c ?? 20
			const hold = (solubility(sol, T0) * pymin(p.water_ml ?? 50, 120) * water_density(T0)) / 1000 / 100
			out.push(`${n1(p.solute_g ?? 5, 1)} g of ${sol} in ${n1(p.water_ml ?? 50, 0)} mL of water at ${n1(T0)} °C, ${how === "hot plate" ? `on a ${n1(p.heater_w ?? 300, 0)} W hot plate (about half reaches the dish) from ${n1(p.heat_from_s ?? 1, 1)} s` : how === "sun" ? "on a sunny windowsill" : "in the room's air"}; the water can hold ${n1(hold, 1)} g, so crystals start once about ${n1(((p.solute_g ?? 5) / (sol === "salt" ? 0.359 : 2.04)), 1)} g of water is left`)
			if (st) {
				const boil = firstTime(sim.track, item.id, "boiling", (v) => v >= 0.5)
				const sat = firstTime(sim.track, item.id, "crystals_g", (v) => v > 0.005)
				const dry = firstTime(sim.track, item.id, "dry", (v) => v >= 0.5)
				out.push(`end: ${n1(L("water_g"), 2)} g of water left at ${n1(L("temp_c"))} °C, ${n1(L("crystals_g"), 2)} g of crystals, ${n1(L("dissolved_g"), 2)} g still dissolved; ${n1(L("evaporated_g"), 2)} g of water gone; ${n1(L("clock_s"), 0)} s of lesson time`)
				out.push(`boiling from ${boil === null ? "—" : `${n1(boil, 2)} s`}, crystals from ${sat === null ? "—" : `${n1(sat, 2)} s`}, dry at ${dry === null ? "— (not dry by the end: more time_lapse or heat)" : `${n1(dry, 2)} s`} (run time)`)
			}
			break
		}
		case "density-cube":
		case "equal-mass-block": {
			const rho = (DENSITY_MATERIALS.find((m) => m[0] === (p.made_of ?? "aluminium")) ?? DENSITY_MATERIALS[0])[1]
			out.push(`${p.made_of ?? "aluminium"}: ${n1(rho / 1000, 2)} g/cm³ (${rho < 998 ? "floats" : "sinks"} in water)${st ? `, ${n1(L("mass_g"), 1)} g, ${n1(L("volume_cm3"), 2)} cm³` : ""}`)
			break
		}
		case "cold-pack": {
			const key = rec?.chemical ?? p.chemical ?? "ammonium nitrate"
			const C = rec?.capacity ?? 480
			const most = rec ? ((-rec.salt / rec.molar) * rec.dh) / C : null
			out.push(`${n1(p.salt_g ?? 30, 0)} g of ${key} and a ${n1(p.water_ml ?? 100, 0)} mL water bag, squeezed at ${n1(rec?.at ?? p.squeeze_at_s ?? 1.2, 1)} s; ${rec && rec.dh < 0 ? "gives heat out (a HOT pack)" : "takes heat in (a cold pack)"}${most === null ? "" : `: ${most >= 0 ? "+" : "−"}${n1(Math.abs(most), 1)} °C if it all dissolved with no heat in or out`}; dissolves over about ${n1(rec?.tau ?? p.dissolve_s ?? 30, 0)} lesson s`)
			if (st) {
				const T = st.temp_c ?? []
				const lo = T.length ? Math.min(...T.filter(Number.isFinite)) : null
				const hi = T.length ? Math.max(...T.filter(Number.isFinite)) : null
				out.push(`temperature ${n1(F0("temp_c"))} → coldest ${n1(lo)} / hottest ${n1(hi)} → ${n1(L("temp_c"))} °C at the end; ${n1(L("dissolved_pct"), 0)} % dissolved; heat ${n1(L("heat_kj"), 2)} kJ (− taken in)`)
			}
			break
		}
		case "hand-warmer":
			out.push(`${n1(p.iron_g ?? 20, 1)} g of iron powder, lasting ${n1(p.lasts_h ?? 5, 1)} h (about ${n1(p.power_w ?? 8.2, 1)} W), opened at ${n1(p.open_at_s ?? 1.2, 1)} s; it warms over minutes (time_lapse 60-120) and gains up to ${n1(p.oxygen_g ?? 8.6, 2)} g of oxygen over hours (time_lapse 3600)`)
			if (st) out.push(`temperature ${n1(F0("temp_c"))} → ${n1(Math.max(...(st.temp_c ?? [NaN]).filter(Number.isFinite)))} °C at most, ${n1(L("temp_c"))} °C at the end; iron left ${n1(L("iron_left_pct"), 0)} %; oxygen taken in ${n1(L("oxygen_g"), 2)} g`)
			break
		case "steel-wool":
			out.push(`${n1(p.wool_g ?? 5, 1)} g of steel wool soaked in ${p.soaked ?? "vinegar"} (63 % of what can rust in about ${n1((rec?.rustTau ?? 43200) / 86400, 1)} days; half of it can), set out at ${n1(p.from_s ?? 1.2, 1)} s; it can gain ${n1(p.gain_g ?? 1.07, 3)} g`)
			if (st) out.push(`end: ${n1(L("rust_pct"), 1)} % rusted, +${n1(L("gained_g"), 3)} g, ${n1(L("oxygen_ml"), 0)} mL of oxygen used; ${n1(L("temp_c"))} °C`)
			break
		case "indicator-cup": {
			const steps = rec?.steps ?? []
			out.push(`${n1(p.water_ml ?? 100, 0)} mL of red cabbage juice (purple, pH 7); ${steps.length ? steps.map((x) => `${x.what} (${n1(x.ml > 0 ? x.ml : x.kg * 1000, 1)} ${x.ml > 0 ? "mL" : "g"}) at ${n1(x.at, 1)} s`).join(", then ") : "nothing added"}`)
			if (st) {
				const bands = (st.color_band ?? []).filter(Number.isFinite)
				const seen = []
				for (const b of bands) if (seen[seen.length - 1] !== b) seen.push(b)
				out.push(`colour: ${seen.map((b) => BAND_NAMES[b]).join(" → ") || "—"}; pH ${n1(F0("ph"), 2)} → ${n1(L("ph"), 2)}; gas made ${n1(L("co2_g"), 3)} g (${n1(L("escaped_g"), 3)} g escaped); ${n1(F0("temp_c"))} → ${n1(L("temp_c"))} °C`)
			}
			break
		}
		case "reaction-cup":
			out.push(`${n1(p.soda_g ?? 5, 1)} g of baking soda dissolved in ${n1(p.water_ml ?? 100, 0)} mL; ${n1(p.cacl2_g ?? 5, 1)} g of calcium chloride poured in at ${n1(p.mix_at_s ?? 1.2, 1)} s: it can make ${n1(p.chalk_g ?? 2.98, 2)} g of white solid (calcium carbonate) and ${n1(p.co2_g ?? 1.31, 2)} g of carbon dioxide`)
			if (st) out.push(`end: ${n1(L("solid_g"), 2)} g of white solid (${n1(L("settled_g"), 2)} g settled), cloudy ${n1(L("cloudy"), 2)}; gas made ${n1(L("co2_g"), 3)} g, escaped ${n1(L("escaped_g"), 3)} g; ${n1(F0("temp_c"))} → ${n1(Math.max(...(st.temp_c ?? [NaN]).filter(Number.isFinite)))} °C at most → ${n1(L("temp_c"))} °C`)
			break
		case "molecule":
		case "crystal": {
			const what = item.type === "molecule" ? `${p.formula ?? ""} ${p.molecule ?? "water"} molecule` : `${p.lattice ?? "salt"} crystal (${p.formula ?? ""}, ${p.cells ?? 2} repeats a side)`
			out.push(`a ${p.style ?? "ball-and-stick"} model of a ${what}, ${n1(p.scale_cm ?? (item.type === "molecule" ? 2.5 : 1.2), 1)} cm per Å${st ? `: ${n1(L("atoms"), 0)} atoms${Number.isFinite(L("bond_angle_deg")) ? `, bond angle ${n1(L("bond_angle_deg"), 1)}°` : ""}` : ""}; a MODEL (scaled up about 10⁸ times)`)
			break
		}
	}
	return out
}

/** A change of one of this module's props in real words (the card's change lines). */
function changeWords(type, key, a, b, nameOf) {
	if (!MATTER_TYPES.includes(type)) return null
	const deg = (v) => `${n1(v)} °C`
	if (type === "filter-funnel" || type === "evaporating-dish") {
		if (key === "paper") return `paper ${a ?? "filter paper"} → ${b ?? "filter paper"}${b === "none" ? " (nothing is kept: the solid runs through)" : b === "coffee filter" ? " (faster; chalk gets through)" : " (keeps grains over 11 µm)"}`
		if (key === "rinse_ml") return `rinse ${n1(a ?? 10, 0)} → ${n1(b ?? 10, 0)} mL of clean water`
		if (key === "solid") return `undissolved ${a ?? "sand"} → ${b ?? "sand"}`
		if (key === "solid_g") return `${n1(a ?? 10)} → ${n1(b ?? 10)} g undissolved`
		if (key === "dissolved") return `dissolved ${a ?? "salt"} → ${b ?? "salt"}`
		if (key === "dissolved_g") return `${n1(a ?? 5)} → ${n1(b ?? 5)} g dissolved`
		if (key === "funnel_mm") return `funnel ${n1(a ?? 75, 0)} → ${n1(b ?? 75, 0)} mm across (it holds ${n1(0.349 * Math.pow((0.615 * (a ?? 75)) / 1000, 3) * 1e6, 0)} → ${n1(0.349 * Math.pow((0.615 * (b ?? 75)) / 1000, 3) * 1e6, 0)} mL at a time)`
		if (key === "pour_s") return `pouring takes ${n1(a ?? 3, 1)} → ${n1(b ?? 3, 1)} s`
		if (key === "water_ml") return `water ${n1(a ?? 50, 0)} → ${n1(b ?? 50, 0)} mL`
		if (key === "solute_g") return `${n1(a ?? 5)} → ${n1(b ?? 5)} g dissolved in it`
		if (key === "heat") return `heated by ${a ?? "hot plate"} → ${b ?? "hot plate"}${b === "hot plate" ? " (boils dry in minutes)" : b === "sun" ? " (days)" : " (about 11 days for 50 mL)"}`
		if (key === "humidity_pct") return `the room's humidity ${n1(a ?? 50, 0)} → ${n1(b ?? 50, 0)} %${b < a ? " (drier: it evaporates faster)" : " (damper: slower)"}`
		if (key === "water_temp_c") return `the water ${deg(a ?? 20)} → ${deg(b ?? 20)}${type === "filter-funnel" ? (b > a ? " (warmer: it runs through faster)" : " (colder: slower)") : ""}`
		if (key === "heater_w") return `the hot plate ${n1(a ?? 300, 0)} → ${n1(b ?? 300, 0)} W${b > a ? " (it boils dry sooner)" : " (slower)"}`
	}
	if (type === "cold-pack") {
		if (key === "chemical") return `${a ?? "ammonium nitrate"} → ${b ?? "ammonium nitrate"} in the pack${b === "calcium chloride" ? " (it gives heat out: a hot pack)" : ""}`
		if (key === "salt_g") return `${n1(a ?? 30, 0)} → ${n1(b ?? 30, 0)} g of it in the pack${b > a ? " (colder, or hotter for calcium chloride)" : " (a smaller change of temperature)"}`
		if (key === "water_ml") return `water bag ${n1(a ?? 100, 0)} → ${n1(b ?? 100, 0)} mL${b < a ? " (less water: a bigger change of temperature, while it all still dissolves)" : " (more water: a smaller change)"}`
		if (key === "squeeze_at_s") return `squeezed at ${n1(a ?? 1.2, 1)} → ${n1(b ?? 1.2, 1)} s`
		if (key === "dissolve_s") return `dissolves in about ${n1(a ?? 30, 0)} → ${n1(b ?? 30, 0)} s${b < a ? " (shaken harder: colder at its coldest)" : ""}`
	}
	if (type === "hand-warmer") {
		if (key === "iron_g") return `iron powder ${n1(a ?? 20, 1)} → ${n1(b ?? 20, 1)} g`
		if (key === "lasts_h") return `lasts ${n1(a ?? 5, 1)} → ${n1(b ?? 5, 1)} h${b < a ? " (oxygen comes in faster: hotter)" : " (slower: cooler)"}`
		if (key === "open_at_s") return `opened at ${n1(a ?? 1.2, 1)} → ${n1(b ?? 1.2, 1)} s`
	}
	if (type === "steel-wool") {
		if (key === "soaked") return `soaked in ${a ?? "vinegar"} → ${b ?? "vinegar"}${b === "dry" ? " (it hardly rusts)" : b === "vinegar" ? " (it rusts fastest)" : ""}`
		if (key === "wool_g") return `steel wool ${n1(a ?? 5, 1)} → ${n1(b ?? 5, 1)} g`
		if (key === "from_s") return `set out at ${n1(a ?? 1.2, 1)} → ${n1(b ?? 1.2, 1)} s`
	}
	if (type === "indicator-cup") {
		if (key === "add" || key === "then_add") return `${key === "add" ? "adds" : "then adds"} ${a ?? "vinegar"} → ${b ?? "vinegar"}${b === "vinegar" || b === "lemon juice" ? " (an acid: red, pink)" : b === "none" ? "" : " (a base: blue, green)"}`
		if (key === "amount" || key === "then_amount") return `${key === "amount" ? "" : "then "}${n1(a ?? 10, 1)} → ${n1(b ?? 10, 1)} mL or g of it`
		if (key === "add_at_s" || key === "then_at_s") return `${key === "add_at_s" ? "added" : "then added"} at ${n1(a ?? 1.2, 1)} → ${n1(b ?? 1.2, 1)} s`
		if (key === "water_ml") return `red cabbage juice ${n1(a ?? 100, 0)} → ${n1(b ?? 100, 0)} mL`
		if (key === "water_temp_c") return `the juice ${deg(a ?? 20)} → ${deg(b ?? 20)}`
	}
	if (type === "reaction-cup") {
		if (key === "cacl2_g") return `calcium chloride ${n1(a ?? 5, 1)} → ${n1(b ?? 5, 1)} g`
		if (key === "soda_g") return `baking soda ${n1(a ?? 5, 1)} → ${n1(b ?? 5, 1)} g in the water`
		if (key === "mix_at_s") return `poured in at ${n1(a ?? 1.2, 1)} → ${n1(b ?? 1.2, 1)} s`
		if (key === "react_s") return `reacts in about ${n1(a ?? 2, 1)} → ${n1(b ?? 2, 1)} s`
		if (key === "water_temp_c") return `the water ${deg(a ?? 20)} → ${deg(b ?? 20)}`
		if (key === "water_ml") return `water ${n1(a ?? 100, 0)} → ${n1(b ?? 100, 0)} mL`
	}
	if (type === "molecule" || type === "crystal") {
		if (key === "molecule") return `a ${a ?? "water"} → ${b ?? "water"} molecule`
		if (key === "lattice") return `a ${a ?? "salt"} → ${b ?? "salt"} crystal`
		if (key === "style") return `${a ?? "ball-and-stick"} → ${b ?? "ball-and-stick"} model`
		if (key === "cells") return `${n1(a ?? 2, 0)} → ${n1(b ?? 2, 0)} repeats along each side`
		if (key === "scale_cm") return `drawn ${n1(a ?? 2.5, 1)} → ${n1(b ?? 2.5, 1)} cm per ångström`
	}
	if (key === "water_temp_c") return `the water ${deg(a ?? 20)} → ${deg(b ?? 20)}${b > a ? " (warmer: it dissolves faster)" : b < a ? " (colder: it dissolves slower)" : ""}`
	if (key === "stir") return `stirring ${!a ? "off" : `${n1(a)} turns a second`} → ${!b ? "off" : `${n1(b)} turns a second`}`
	if (key === "solute") return `${a ?? "salt"} → ${b ?? "salt"} in the water`
	if (key === "solute_g") return `${n1(a ?? 6)} → ${n1(b ?? 6)} g put in`
	if (key === "grain") return `grains ${a ?? "default"} → ${b ?? "default"}${b === "powder" ? " (smaller pieces dissolve faster)" : b === "cube" ? " (one lump: slower)" : ""}`
	if (key === "closure") return `the bottle ${a ?? "open"} → ${b ?? "open"}${b === "cap" ? " (no gas escapes: the scale should not change)" : b === "open" ? " (the gas escapes: the scale goes down)" : " (the balloon fills: the scale reads a little less, buoyed by the air it pushes aside)"}`
	if (key === "heater_w") return `heater ${n1(a ?? 0)} → ${n1(b ?? 0)} W`
	if (key === "temp_c") return `start temperature ${deg(a ?? 20)} → ${deg(b ?? 20)}`
	if (key === "load_kg") return `load on the piston ${n1(a ?? 0)} → ${n1(b ?? 0)} kg`
	if (key === "push_to_ml") return `plunger pushed to ${n1(a ?? 30)} → ${n1(b ?? 30)} mL`
	if (key === "aperture_mm") return `mesh holes ${n1(a ?? 4)} → ${n1(b ?? 4)} mm`
	if (key === "wand_height") return `the wand's tip ${n1((a ?? 0.015) * 100, 1)} → ${n1((b ?? 0.015) * 100, 1)} cm above the dish's floor`
	if (key === "wand") return b === false ? "the magnet wand taken away" : "a magnet wand swept across"
	if (key === "magnet") return `magnet ${a ? nameOf(a) : "none"} → ${b ? nameOf(b) : "none"}`
	if (key === "substance") return `${a ?? "water"} → ${b ?? "water"} in the box`
	if (key === "mixture") return `mixture ${a} → ${b}`
	if (key === "sealed") return b === false ? "the bag opened" : "the bag sealed"
	if (key === "soda_g") return `baking soda ${n1(a ?? 5)} → ${n1(b ?? 5)} g`
	if (key === "end_bar") return `pumped to ${n1(a ?? 0.8, 2)} → ${n1(b ?? 0.8, 2)} bar`
	return null
}

const pickOf = (scene, types) => scene.items.filter((i) => types.includes(i.type))

export const plugin = {
	title: "Matter: particles, states, dissolving, mixtures, conservation of mass, chemical reactions (cold packs, hand warmers, indicators, precipitates, rusting), molecules and crystals",
	howto: [
		"Particle model: particle-box (a clear box on a hot plate) shows a substance (water, wax, iron, gallium, carbon dioxide, air, nitrogen, helium, bromine) as particles: solid (bonded, vibrating), liquid (sliding at the bottom), gas (filling the box). They are a MODEL (drawn huge, moving 1/1250 of the real speed); the readings are real: temp_c, solid/liquid/gas %, pressure_kpa, volume_ml, speed_ms (mean molecular speed √(8RT/πM): air at 20 °C 463 m/s). temp_c sets the start; heater_w heats it (W into a sample of sample_g grams: 1 g of ice at −20 °C needs 42 J to 0 °C, 334 J to melt, 418 J to 100 °C, 2257 J to boil; a 20 W heater with time_lapse 60 does it all in about 2.5 s of run). piston (with load_kg on piston_area_cm2) holds the gas up: more load → smaller volume (Boyle), hotter → bigger (Charles). divider + second (another gas, or 'none' for the same one in two colours) lifted at open_at_s: the gases mix (mixed_pct).",
		"The box's readings are the real sample's: pressure_kpa is its gas's nRT/V (exact Boyle and Charles); a loaded piston's volume_ml goes to nRT/P (the drawn piston stops where the drawn particles fill it). A sample can be no denser than its solid or liquid (more is cut, with a warning); a gas squeezed past its vapour pressure gets an event (a real one would partly condense). Mixing (mixed_pct) runs on a MODEL clock: a few run seconds whatever the time-lapse (real gases take about L²/2D: a 20 cm box half an hour): say so. Heating curve plateau: goal holds_at {item: box, temp_c: 0, while: melting} (or 100, boiling). syringe: 60 mL sealed syringe of air whose plunger is pushed from start_ml to push_to_ml (60 → 30 mL: 101 → 203 kPa, exactly 6080 ÷ V; force_n: the push to hold it, 57 N at 30 mL, 284 N at 10 mL, 624 N at 5 mL: past 200 N more than a hand gives, warned). In a vacuum (settings.air false) nothing presses from outside: a balloon closure is not buoyed, a loaded piston carries its load only; an evaporating-dish refuses to run (water boils and freezes there: not modelled). balloon-bath: a 1 L balloon dipped into water at water_temp_c: its volume follows the kelvin temperature (60 °C: 1.136 L; 0 °C: 0.932 L), settling over settle_s lesson seconds.",
		"Dissolving: dissolving-glass is a 7 cm glass of water_ml at water_temp_c with solute (salt, sugar dissolve; sand, chalk do not) of solute_g and grain (salt: table/coarse/powder; sugar: granulated/coarse/powder/cube), poured at pour_at_s from a spoon (start_in 'spoon'), from a paper cup beside it ('dish': weighed all along) or already on the bottom ('glass'); stir turns/s from stir_from_s. Faster when hotter, stirred, finer. Saturation: at 20 °C 100 g of water holds 35.9 g of salt or 204 g of sugar; more stays on the bottom. Real times: table salt stirred about 10-30 s; unstirred salt and a sugar cube take minutes: use the scene setting time_lapse (e.g. 30-60) so the run shows them; readings dissolved_g, left_g, saturated, clock_s (lesson seconds).",
		"Conservation of mass: stand things on measure's kitchen-scale (its platform's top is 2.6 cm above where the scale stands; it weighs every MOVING item resting on it, stacked included) and compare its grams reading before and after (goal mass_same {scale} / mass_changes {scale, by_g}). Items: dissolving-glass (start_in 'dish' or 'glass': 'spoon' adds the solute's mass when it pours), chocolate-bar (snapped into pieces at snap_at_s), zip-bag (put an ice cube INSIDE it with place {inside: bag}: what melts stays in the bag; ice melts with heat on: a warm room_temp and time_lapse 600), reaction-bottle (baking soda + vinegar; closure open: the CO2 escapes, the scale goes down by co2_g (5 g soda → 2.62 g); cap: no change (the vinegar dissolves part of the gas, co2_dissolved_g, Henry's law; past 900 kPa, e.g. 30 g of soda in 400 mL of 10 % vinegar, the cap POPS (popped, an event) and the gas escapes: the scale goes down); balloon: the balloon fills and the scale reads 1.6 g LESS (buoyancy)), pumped-ball (air has mass: 0 → 0.8 bar adds 5.4 g). Kitchen scale and fixed items: static items are not weighed, so weighed things must be moving items.",
		"Mixtures: mixture-dish (sand + iron filings, salt + pepper, rice + beans, sand + paper clips, sand + gravel, sand + salt) has its own magnet wand (wand: true, the default): from wand_from_s it sweeps across with its tip wand_height (1.5 cm) above the dish's floor and lifts out with the iron stuck to it; the sand stays (readings a_out_g/a_left_pct: the iron taken out). Or set wand false and its magnet link to a magnet item held (fixed) just above the dish's rim (a ceramic magnet must come within about 1-2 cm, a neodymium one 3-5 cm). sieve: a mixture in a shaken sieve over a tray: grains smaller than aperture_mm fall through (sand 2 mm through a 4 mm mesh; gravel 7 mm kept). Filtering: filter-funnel (a ring stand, a 75 mm glass funnel lined with filter paper, a beaker under it; a fixed setup standing on the table): a cup of water_ml with solid_g of an undissolved solid (sand; chalk) and dissolved_g of salt or sugar dissolved is poured in at pour_at_s; the water and the dissolved salt run through into the beaker (filtrate_ml, salt_through_g), the sand stays on the paper (kept_g, kept_pct); the paper choice decides what is kept (filter paper 11 µm; coffee filter 20 µm: faster but chalk gets through; none: nothing kept); rinse_ml of clean water after it carries the salt the wet paper held. It takes minutes (100 mL through filter paper: about 20 lesson minutes): time_lapse 100-200 and 10-14 s of run. Evaporating: evaporating-dish (a 9 cm glass dish of water_ml of water with solute_g of salt or sugar; heat 'hot plate' (its own hot plate under it, heater_w: 50 mL boils dry in about 17 min at 300 W), 'sun' (a sunny windowsill: about 3 days) or 'room' (about 11 days)): the water evaporates or boils away and the salt stays: crystals appear once it is saturated and at the end all of it is left (crystals_g); a moving item: on a kitchen-scale the reading falls by the water's mass only. Use time_lapse (hot plate 150; sun or room 100000). Density: density-cube (1 inch cubes of a material: same size, different mass) and equal-mass-block (same mass, size from density); with fluids' water-tank they float or sink by density (below 0.998 g/cm³ floats).",
		"Chemical changes (each a moving item a kitchen-scale weighs; with the heat module its temperature is a heat body (a pouch, a pad) or its beaker's water, so a thermometer whose tip touches it (a fixed, upright digital probe placed on it) or stands in the beaker (place inside: it, fixed) reads it; temp_c is its own reading): cold-pack (an instant cold pack lying flat: chemical ammonium nitrate, urea, ammonium chloride (cold) or calcium chloride (a HOT pack); salt_g in a water_ml bag burst at squeeze_at_s, dissolving over dissolve_s lesson s: 30 g of ammonium nitrate in 100 mL goes from 20 °C to about 2 °C (change_c −20 if no heat came in), 30 g of calcium chloride to about 64 °C; time_lapse 30, 8 s; its mass never changes); hand-warmer (iron_g of iron powder rusting from open_at_s, lasting lasts_h: about 8 W, on a table 20 → about 40 °C over 10-15 minutes (time_lapse 120); it GAINS the oxygen's mass, +8.6 g over its life (time_lapse 3600)); steel-wool (wool_g soaked in vinegar/salt water/water/dry rusts over days: rust_pct, gained_g (half of 5 g: +1.07 g), oxygen_ml; time_lapse 86400 = a day per run second; it turns orange-brown); indicator-cup (a beaker of purple red cabbage juice; add vinegar/lemon juice (mL) or baking soda/washing soda (g) at add_at_s, then_add a second at then_at_s: pH by real chemistry, colour band red < 3, pink < 5, purple < 7.5, blue < 9, blue-green < 10.5, green < 12.5, yellow; 10 mL vinegar → pH 2.9 red; 2 g baking soda → 8.3 blue; washing soda → green; soda after vinegar fizzes CO2 (escaped_g) and turns it back; it cools a little); reaction-cup (calcium chloride poured into baking soda solution at mix_at_s: it warms (+6 °C for 5 g + 5 g), turns cloudy white (a precipitate: chalk, solid_g 2.98 g, settling over minutes) and fizzes off carbon dioxide (the scale goes down by escaped_g, 1.15 g): three signs of a chemical change). Goals: warms_by {item, at_least_c} / cools_by {item, at_least_c} (its peak against its start; item a pack, a beaker or a thermometer), color_changes {item, to?} (an indicator's colour band; a precipitate's clear → cloudy white; steel wool's grey → orange-brown), mass_changes / mass_same {scale} for the mass.",
		"Models of particles: molecule (molecule water (bent 104.5°), carbon dioxide (straight), methane (tetrahedral), ammonia (pyramid), oxygen, nitrogen, hydrogen; style ball-and-stick or space-filling; scale_cm cm per ångström, 2.5; labels: its formula and name over it) and crystal (lattice salt: Na+ and Cl− ions in a cube pattern, (2·cells+1)³ ions; diamond: carbon bonded to four; ice: water in open hexagons held by hydrogen bonds; cells 1-4 repeats a side; scale_cm 1.2). Both rest on the table (place on: table); CPK colours (H white, C black, N blue, O red, Na purple, Cl green); readings atoms, bonds, mass_u, bond_angle_deg / sodium, chloride, carbon, oxygen, hydrogen counts. They are MODELS: say so."
	].join(" "),
	prompt: {
		plan: [
			"Matter: weigh with measure's kitchen-scale (a weighed thing must be a moving item resting on its platform: x within its 15 cm, standing on it). Conservation demos: put the glass/bag/bottle/bar/ball on the scale and give goal mass_same {scale} (or mass_changes {scale, by_g} for an open fizz bottle −co2_g, a balloon closure −1.6 g, a pumped ball +5.4 g). Slow things (unstirred dissolving, a sugar cube, ice melting, heating a particle box) need settings.time_lapse (lesson seconds per run second, e.g. 30-600) and a run long enough.",
			"Chemical changes: a cold-pack or hand-warmer lying on the table (a digital thermometer held upright, fixed, its tip on the pack (place on: the pack), to read it; or temp_c) with goal cools_by / warms_by {item: the pack, at_least_c}; an indicator-cup (add/amount/add_at_s, then_add...) with color_changes {item, to?: red|pink|purple|blue|blue-green|green|yellow}; a reaction-cup (precipitate) with color_changes {item} (cloudy white), warms_by and, on a kitchen-scale, mass_changes {scale, by_g: −escaped CO2}; steel-wool on a kitchen-scale with time_lapse 86400 and mass_changes {scale, by_g: +gain}. Molecule and crystal models: molecule {molecule, style}, crystal {lattice, cells}: they rest on the table; no goal needed (a still model).",
			"Dissolving comparisons: one dissolving-glass per condition side by side (identical but for the one change), goal dissolves_first {a, b} or dissolves {item, before_s}; saturation: saturates {item}. Particle model: particle-box goals state {item, is: solid|liquid|gas|melting|boiling}, holds_at {item, temp_c, while: melting|boiling} (the plateau: 'the temperature stays at 0 °C while the ice melts'), mixes {item}, pressure {item, kpa}, volume {item, ml}. Separation: mixture-dish with props.magnet = the magnet's id (a magnet item held/fixed just above its rim), or a sieve; goal separates {item}. Filtering: filter-funnel (sand stays on the paper, the salt water runs through), goal separates {item}; evaporating: evaporating-dish, goals dries {item} (the water is all gone) and crystallizes {item} (the salt is all left as crystals); a salt + sand + water separation is a filter-funnel beside an evaporating-dish holding the filtrate's water and salt."
		].join("\n"),
		edit: "Matter: a glass's dissolving speeds up with water_temp_c, stir, a finer grain; past saturation (35.9 g salt per 100 mL at 20 °C) the rest stays. A fizz bottle's scale change is set by its closure (open escapes, cap stays, balloon buoys). A particle box's state follows its heat: heater_w × time × time_lapse over sample_g. A piston's volume ∝ T / (outside + load pressure). When the asked change alters what a goal's number expects, update that number with it: a mass_changes goal's by_g is −0.524 g per g of baking soda (open), about −0.33 g per g (balloon), 0 (cap, until it pops past 900 kPa), while the vinegar's acid lasts (100 mL of 5 % vinegar takes at most 7.0 g of soda: 3.68 g of CO2; its co2_g reading says what was made); a syringe's pressure goal 6080 ÷ push_to_ml kPa; a balloon-bath's volume goal 1000 × (water_temp_c + 273.15) ÷ 293.15 mL; an evaporating-dish's crystallizes goal is its solute_g (all of it comes back), a kitchen scale under it changes by −(its water's mass). A change that slows a process (a weaker hot plate, more water, a smaller funnel, chalk for sand) needs more lesson time: raise the time-lapse with set_scene {settings: {time_lapse}} (or seconds, at most 20) so (seconds − heat_from_s) × time_lapse covers it: on a hot plate the water is gone about (water_g × 2.6 kJ + 20 kJ) ÷ (heater_w ÷ 2 − 10 W) lesson seconds after it is switched on (50 mL: 300 W 17 min, 100 W 57 min); a funnel passes about its capacity every 2-3 lesson minutes. A cold pack's coldest is about change_c (−0.67 °C per g of ammonium nitrate in 100 mL) less what leaks in while it dissolves (faster dissolve_s: colder); a hand warmer's warmth grows with iron_g ÷ lasts_h (its power) and needs minutes of lesson time; an indicator's colour follows the pH of what is in it (an acid's mL against a base's g: 10 mL of vinegar takes about 0.7 g of baking soda to neutralize). Opening a sealed container (take the cap or the balloon off a fizz bottle: closure open; unseal a zip-bag) lets its gas escape, as it really would: that is the expected result of the person's change, not something to fix: replace its scale's mass_same goal with mass_changes {scale, by_g: −(what escapes: −0.524 g per g of soda, while the vinegar lasts)} and say why in your reply; keep every other goal exactly as it is (its label, tol_g and numbers).",
		refine: "Matter: conservation goals need everything weighed resting on the scale (moving items on its platform, nothing fixed) and readings at rest; dissolving goals fail when the run (× time_lapse) is shorter than the dissolving: raise time_lapse or stir/warm the water rather than shortening what is compared."
	},
	examples: [
		{ ask: "An instant cold pack: squeeze it and measure how cold it gets.", how: "cold-pack (30 g ammonium nitrate, 100 mL) on the table, a digital thermometer held upright (fixed) with its tip on the pack; time_lapse 30, 8 s; goal cools_by {pack, at_least_c: 15}", plan: { settings: { time_lapse: 30 }, seconds: 8, items: [{ id: "pack", type: "cold-pack", place: { on: "table", x: 1.2 } }, { id: "therm", type: "thermometer", props: { style: "digital" }, fixed: true, place: { on: "pack", x: 1.2 } }], goals: [{ kind: "cools_by", item: "pack", at_least_c: 15, label: "The pack gets at least 15 °C colder" }] } },
		{ ask: "Which makes a colder pack: ammonium nitrate or calcium chloride? (MS-PS1-6)", how: "two cold-packs side by side, chemical ammonium nitrate vs calcium chloride, same 30 g and 100 mL; time_lapse 30; goals cools_by {a, 15} and warms_by {b, 30}", plan: { settings: { time_lapse: 30 }, seconds: 8, items: [{ id: "cold", type: "cold-pack", name: "Ammonium nitrate", place: { on: "table", x: 0.9 } }, { id: "hot", type: "cold-pack", name: "Calcium chloride", props: { chemical: "calcium chloride" }, place: { on: "table", x: 1.5 } }], goals: [{ kind: "cools_by", item: "cold", at_least_c: 15 }, { kind: "warms_by", item: "hot", at_least_c: 30 }] } },
		{ ask: "Open a hand warmer and watch it warm up over a few minutes.", how: "hand-warmer on the table; time_lapse 120, 8 s (about 14 minutes); goal warms_by {hw, at_least_c: 15}", plan: { settings: { time_lapse: 120 }, seconds: 8, items: [{ id: "hw", type: "hand-warmer", place: { on: "table", x: 1.2 } }], goals: [{ kind: "warms_by", item: "hw", at_least_c: 15, label: "The hand warmer warms by at least 15 °C" }] } },
		{ ask: "Red cabbage juice: add vinegar, then baking soda.", how: "indicator-cup add vinegar 10 mL at 1.2 s, then_add baking soda 3 g at 4 s; time_lapse 5, 7 s; goal color_changes {cup}", plan: { settings: { time_lapse: 5 }, seconds: 7, items: [{ id: "cup", type: "indicator-cup", props: { add: "vinegar", amount: 10, then_add: "baking soda", then_amount: 3, then_at_s: 4 }, place: { on: "table", x: 1.2 } }], goals: [{ kind: "color_changes", item: "cup", label: "The juice changes colour" }] } },
		{ ask: "Is it an acid or a base? Three cups of red cabbage juice: vinegar, water only, washing soda.", how: "three indicator-cups: add vinegar 10 mL / none / washing soda 2 g; goals color_changes {a, to: red}, color_changes {c, to: green}", plan: { seconds: 4, items: [{ id: "a", type: "indicator-cup", name: "Vinegar", place: { on: "table", x: 0.8 } }, { id: "b", type: "indicator-cup", name: "Water", props: { add: "none" }, place: { on: "table", x: 1.2 } }, { id: "c", type: "indicator-cup", name: "Washing soda", props: { add: "washing soda", amount: 2 }, place: { on: "table", x: 1.6 } }], goals: [{ kind: "color_changes", item: "a", to: "red" }, { kind: "color_changes", item: "c", to: "green" }] } },
		{ ask: "Mix calcium chloride and baking soda solution: what signs of a chemical reaction do you see? (MS-PS1-2)", how: "reaction-cup on a kitchen-scale; time_lapse 20, 6 s; goals color_changes {cup} (cloudy white), warms_by {cup, 3}, mass_changes {scale, by_g: −1.15}", plan: { settings: { time_lapse: 20 }, seconds: 6, items: [{ id: "scale", type: "kitchen-scale", place: { on: "table", x: 1.2 } }, { id: "cup", type: "reaction-cup", place: { on: "scale", x: 1.2 } }], goals: [{ kind: "color_changes", item: "cup", label: "A cloudy white solid forms" }, { kind: "warms_by", item: "cup", at_least_c: 3 }, { kind: "mass_changes", scale: "scale", by_g: -1.15, label: "The gas escapes: the scale goes down" }] } },
		{ ask: "Steel wool rusts on a scale over a few days: does it get heavier?", how: "steel-wool (5 g, vinegar) on a kitchen-scale; time_lapse 86400 (a run second is a day), 6 s; goals mass_changes {scale, by_g: 1.07} and color_changes {wool}", plan: { settings: { time_lapse: 86400 }, seconds: 6, items: [{ id: "scale", type: "kitchen-scale", place: { on: "table", x: 1.2 } }, { id: "wool", type: "steel-wool", place: { on: "scale", x: 1.2 } }], goals: [{ kind: "mass_changes", scale: "scale", by_g: 1.07, label: "The rusting wool gets heavier" }, { kind: "color_changes", item: "wool", to: "brown" }] } },
		{ ask: "Show models of a water molecule and a carbon dioxide molecule.", how: "two molecule models on the table: molecule water and carbon dioxide (ball-and-stick); no goal", plan: { seconds: 2, items: [{ id: "w", type: "molecule", props: { molecule: "water" }, place: { on: "table", x: 1.0 } }, { id: "co2", type: "molecule", props: { molecule: "carbon dioxide" }, place: { on: "table", x: 1.4 } }], goals: [] } },
		{ ask: "A model of a salt crystal and of ice.", how: "crystal lattice salt (cells 2) and crystal lattice ice on the table", plan: { seconds: 2, items: [{ id: "salt", type: "crystal", props: { lattice: "salt" }, place: { on: "table", x: 0.9 } }, { id: "ice", type: "crystal", props: { lattice: "ice" }, place: { on: "table", x: 1.5 } }], goals: [] } },
		{ ask: "Show that mass stays the same when salt dissolves in water on a scale (X3).", how: "kitchen-scale on the table; dissolving-glass (salt 10 g, start_in dish, stir 2) on it; time_lapse 10; goals dissolves {glass} + mass_same {scale}", plan: { settings: { time_lapse: 10 }, seconds: 8, items: [{ id: "scale", type: "kitchen-scale", place: { on: "table", x: 1.2 } }, { id: "glass", type: "dissolving-glass", props: { solute: "salt", solute_g: 10, water_ml: 100, start_in: "dish", stir: 2 }, place: { on: "scale", x: 1.19 } }], goals: [{ kind: "dissolves", item: "glass", label: "All the salt dissolves" }, { kind: "mass_same", scale: "scale", label: "The scale reads the same before and after" }] } },
		{ ask: "Does sugar dissolve faster in hot or cold water? Use sugar cubes (X5).", how: "two dissolving-glass side by side, sugar grain cube, start_in glass, water_temp_c 60 vs 10; time_lapse 60; goal dissolves_first {a: hot, b: cold}", plan: { settings: { time_lapse: 60 }, seconds: 10, items: [{ id: "hot", type: "dissolving-glass", name: "Hot water", props: { solute: "sugar", grain: "cube", solute_g: 2.2, water_temp_c: 60, start_in: "glass" }, place: { on: "table", x: 0.9 } }, { id: "cold", type: "dissolving-glass", name: "Cold water", props: { solute: "sugar", grain: "cube", solute_g: 2.2, water_temp_c: 10, start_in: "glass" }, place: { on: "table", x: 1.5 } }], goals: [{ kind: "dissolves_first", a: "hot", b: "cold", label: "The sugar cube in hot water dissolves first" }] } },
		{ ask: "Put 50 g of salt in 100 mL of water: not all of it dissolves (X4).", how: "dissolving-glass solute_g 50, water_ml 100, stir 2; time_lapse 30; goal saturates {glass} (35.9 g dissolve at 20 °C)", plan: { settings: { time_lapse: 30 }, seconds: 8, items: [{ id: "glass", type: "dissolving-glass", props: { solute: "salt", solute_g: 50, water_ml: 100, stir: 2, start_in: "glass" }, place: { on: "table", x: 1.2 } }], goals: [{ kind: "saturates", item: "glass", label: "Some salt is left: the water is saturated" }] } },
		{ ask: "Snap a 100 g chocolate bar on a kitchen scale: does it still weigh 100 g? (X1)", how: "chocolate-bar (snap_at_s 1.2) on a kitchen-scale; goal mass_same {scale}", plan: { seconds: 3, items: [{ id: "scale", type: "kitchen-scale", place: { on: "table", x: 1.2 } }, { id: "bar", type: "chocolate-bar", props: { snap_at_s: 1.2 }, place: { on: "scale", x: 1.2 } }], goals: [{ kind: "mass_same", scale: "scale", label: "The scale reads the same before and after" }] } },
		{ ask: "An ice cube melts in a sealed bag on a scale: the mass stays the same (X2).", how: "zip-bag on a kitchen-scale, ice-cube place {inside: bag}; room_temp 25, time_lapse 900; goal mass_same {scale}", plan: { settings: { time_lapse: 900, room_temp: 25 }, seconds: 8, items: [{ id: "scale", type: "kitchen-scale", place: { on: "table", x: 1.2 } }, { id: "bag", type: "zip-bag", place: { on: "scale", x: 1.2 } }, { id: "ice", type: "ice-cube", props: { width: 0.03, height: 0.03, depth: 0.03 }, place: { inside: "bag", on: "bag", x: 1.2 } }], goals: [{ kind: "mass_same", scale: "scale", label: "The scale reads the same before and after" }] } },
		{ ask: "Baking soda and vinegar in an open bottle and a capped bottle on two scales (X7).", how: "a reaction-bottle (closure open) and one (closure cap), each on its own kitchen-scale, react_s 2 so the fizz is over by the end (most gas in 3 × react_s after mix_at_s); goals mass_changes {s1, by_g: −2.62} and mass_same {s2}", plan: { seconds: 8, items: [{ id: "s1", type: "kitchen-scale", place: { on: "table", x: 0.8 } }, { id: "open", type: "reaction-bottle", props: { closure: "open", react_s: 2 }, place: { on: "s1", x: 0.8 } }, { id: "s2", type: "kitchen-scale", place: { on: "table", x: 1.6 } }, { id: "capped", type: "reaction-bottle", props: { closure: "cap", react_s: 2 }, place: { on: "s2", x: 1.6 } }], goals: [{ kind: "mass_changes", scale: "s1", by_g: -2.62, label: "The open bottle's scale goes down 2.6 g" }, { kind: "mass_same", scale: "s2", label: "The capped bottle's scale stays the same" }] } },
		{ ask: "Heat ice in the particle model until it boils away (X8).", how: "particle-box water, temp_c −20, sample_g 1, heater_w 10, time_lapse 60, 10 s; goal state {box, is: gas}", plan: { settings: { time_lapse: 60 }, seconds: 10, items: [{ id: "box", type: "particle-box", props: { substance: "water", temp_c: -20, sample_g: 1, heater_w: 10 }, place: { on: "table", x: 1.2 } }], goals: [{ kind: "state", item: "box", is: "gas", label: "The water ends as a gas" }] } },
		{ ask: "Heat ice in the particle model: show that the temperature stays at 0 °C while it melts and at 100 °C while it boils (the heating curve's plateaus).", how: "particle-box water, temp_c −20, sample_g 1, heater_w 10, time_lapse 50, 10 s; goals holds_at {box, temp_c: 0, while: melting} and holds_at {box, temp_c: 100, while: boiling}", plan: { settings: { time_lapse: 50 }, seconds: 10, items: [{ id: "box", type: "particle-box", props: { substance: "water", temp_c: -20, sample_g: 1, heater_w: 10 }, place: { on: "table", x: 1.2 } }], goals: [{ kind: "holds_at", item: "box", temp_c: 0, while: "melting", label: "The temperature stays at 0 °C while the ice melts" }, { kind: "holds_at", item: "box", temp_c: 100, while: "boiling", label: "The temperature stays at 100 °C while the water boils" }] } },
		{ ask: "Lift the divider between brown bromine gas and air and watch it spread (X9).", how: "particle-box air with divider, second bromine, open_at_s 1; goal mixes {box}", plan: { seconds: 6, items: [{ id: "box", type: "particle-box", props: { substance: "air", divider: true, second: "bromine", open_at_s: 1 }, place: { on: "table", x: 1.2 } }], goals: [{ kind: "mixes", item: "box", label: "The two gases mix" }] } },
		{ ask: "Push a sealed syringe from 60 mL to 30 mL: what happens to the pressure? (X12)", how: "syringe start_ml 60, push_to_ml 30; goal pressure {syr, kpa: 203}", plan: { seconds: 5, items: [{ id: "syr", type: "syringe", props: { start_ml: 60, push_to_ml: 30 }, place: { on: "table", x: 1.2 } }], goals: [{ kind: "pressure", item: "syr", kpa: 203, label: "The pressure doubles to about 203 kPa" }] } },
		{ ask: "A balloon dipped in hot water grows (Charles).", how: "balloon-bath water_temp_c 60, time_lapse 20; goal volume {bath, ml: 1136}", plan: { settings: { time_lapse: 20 }, seconds: 6, items: [{ id: "bath", type: "balloon-bath", props: { water_temp_c: 60 }, place: { on: "table", x: 1.2 } }], goals: [{ kind: "volume", item: "bath", ml: 1136, label: "The balloon grows to about 1.14 L" }] } },
		{ ask: "Separate gravel from sand with a sieve (X10).", how: "sieve mixture sand + gravel, aperture_mm 4; goal separates {sieve}", plan: { seconds: 7, items: [{ id: "sieve", type: "sieve", props: { mixture: "sand + gravel", aperture_mm: 4 }, place: { on: "table", x: 1.2 } }], goals: [{ kind: "separates", item: "sieve", label: "The sand falls through, the gravel stays" }] } },
		{ ask: "Pull the iron filings out of sand with a magnet (X10).", how: "mixture-dish sand + iron filings (its magnet wand sweeps by itself); goal separates {dish}", plan: { seconds: 4, items: [{ id: "dish", type: "mixture-dish", props: { mixture: "sand + iron filings" }, place: { on: "table", x: 1.2 } }], goals: [{ kind: "separates", item: "dish", label: "The magnet takes the iron out of the sand" }] } },
		{ ask: "A bar magnet held over a dish of sand and paper clips picks out the clips.", how: "an 8 cm mixture-dish of sand + paper clips, wand false, magnet: the bar-magnet's id; a neodymium bar-magnet (15 cm) stood upright (angle_deg 90), fixed in the air over the dish's middle with its lower end 3 cm above the table (y_m 0.105: its centre); goal separates {dish}", plan: { seconds: 3, items: [{ id: "dish", type: "mixture-dish", props: { mixture: "sand + paper clips", wand: false, magnet: "magnet", width: 0.08 }, place: { on: "table", x: 1.2 } }, { id: "magnet", type: "bar-magnet", props: { material: "neodymium" }, fixed: true, place: { on: "air", x: 1.2, y_m: 0.105, angle_deg: 90 } }], goals: [{ kind: "separates", item: "dish", label: "The magnet takes the iron out of the sand" }] } },
		{ ask: "Separate sand from salt water with a filter funnel: the sand stays on the paper and the salt water runs through (X10).", how: "filter-funnel (sand 10 g, salt 5 g dissolved in 100 mL, filter paper, a 10 mL rinse); time_lapse 150, 12 s; goal separates {filter}", plan: { settings: { time_lapse: 150 }, seconds: 12, items: [{ id: "filter", type: "filter-funnel", props: { solid: "sand", solid_g: 10, dissolved: "salt", dissolved_g: 5, water_ml: 100, paper: "filter paper", rinse_ml: 10 }, place: { on: "table", x: 1.2 } }], goals: [{ kind: "separates", item: "filter", label: "The sand stays on the paper and the salt water runs through" }] } },
		{ ask: "Get the salt back from salt water by evaporating it on a hot plate (X10).", how: "evaporating-dish (5 g salt in 50 mL, hot plate 300 W); time_lapse 150, 10 s; goals dries {dish} + crystallizes {dish}", plan: { settings: { time_lapse: 150 }, seconds: 10, items: [{ id: "dish", type: "evaporating-dish", props: { solute: "salt", solute_g: 5, water_ml: 50, heat: "hot plate", heater_w: 300 }, place: { on: "table", x: 1.2 } }], goals: [{ kind: "dries", item: "dish", label: "All the water evaporates" }, { kind: "crystallizes", item: "dish", label: "All 5 g of salt are left as crystals" }] } },
		{ ask: "Leave a dish of salt water on a sunny windowsill for a few days: the water goes and the salt stays.", how: "evaporating-dish (5 g salt in 50 mL) heat sun; time_lapse 100000 (a run second is about a day), 4 s; goals dries {dish} + crystallizes {dish}", plan: { settings: { time_lapse: 100000 }, seconds: 4, items: [{ id: "dish", type: "evaporating-dish", props: { solute: "salt", solute_g: 5, water_ml: 50, heat: "sun" }, place: { on: "table", x: 1.2 } }], goals: [{ kind: "dries", item: "dish", label: "The water evaporates in a few days" }, { kind: "crystallizes", item: "dish", label: "The salt is left as crystals" }] } },
		{ ask: "Pump up a ball on a scale: does air have mass? (X11)", how: "pumped-ball (0 → 0.8 bar) on a kitchen-scale; goal mass_changes {scale, by_g: 5.4}", plan: { seconds: 6, items: [{ id: "scale", type: "kitchen-scale", place: { on: "table", x: 1.2 } }, { id: "ball", type: "pumped-ball", place: { on: "scale", x: 1.2 } }], goals: [{ kind: "mass_changes", scale: "scale", by_g: 5.4, label: "The scale goes up by the air's mass, about 5.4 g" }] } },
		{ ask: "Same-size cubes of different materials: which float in water? (density)", how: "water-tank aquarium; density-cube made_of pine and made_of copper inside it; goals floats {pine}, sinks {copper}", plan: { seconds: 4, items: [{ id: "tank", type: "water-tank", props: { style: "aquarium", length: 0.5 }, place: { on: "table", x: 1.2 } }, { id: "pine", type: "density-cube", props: { made_of: "pine" }, place: { inside: "tank", on: "tank", x: 1.05 } }, { id: "copper", type: "density-cube", props: { made_of: "copper" }, place: { inside: "tank", on: "tank", x: 1.35 } }], goals: [{ kind: "floats", item: "pine", label: "The pine cube floats" }, { kind: "sinks", item: "copper", label: "The copper cube sinks" }] } }
	],
	goals: [
		{
			kind: "dissolves", aliases: ["dissolve", "dissolved", "disappears", "all_dissolves"], fields: { item: "item", before_s: "number?" },
			about: "dissolves {item: a dissolving-glass, before_s?}: everything put into it dissolves (by before_s run seconds if given)",
			label: (g, n) => `What is in ${n(g.item)} dissolves${Number.isFinite(g.before_s) ? ` by ${g.before_s} s` : ""}`,
			summarize: (ctx, g) => goal_dissolves(ctx, g),
			sample: (scene, pick) => {
				const xs = pickOf(scene, ["dissolving-glass"])
				return xs.length ? { kind: "dissolves", item: pick(xs).id, ...(pick([true, false]) ? { before_s: pick([1, 3.5, 8]) } : {}) } : null
			}
		},
		{
			kind: "dissolves_first", aliases: ["dissolves_faster", "dissolves_before", "faster_dissolving"], fields: { a: "item", b: "item" }, subject: ["a"],
			about: "dissolves_first {a, b}: glass a's crystals are all dissolved before glass b's (if neither finishes: a has dissolved the larger share at the end)",
			label: (g, n) => `${n(g.a)} dissolves before ${n(g.b)}`,
			summarize: (ctx, g) => goal_dissolves_first(ctx, g),
			sample: (scene, pick) => {
				const xs = pickOf(scene, ["dissolving-glass"])
				return xs.length > 1 ? { kind: "dissolves_first", a: xs[0].id, b: pick(xs.slice(1)).id } : null
			}
		},
		{
			kind: "saturates", aliases: ["saturated", "not_all_dissolves", "some_left"], fields: { item: "item" },
			about: "saturates {item: a dissolving-glass}: at the end its water holds all it can and crystals are left on the bottom",
			label: (g, n) => `${n(g.item)} ends saturated with some left over`,
			summarize: (ctx, g) => goal_saturates(ctx, g),
			sample: (scene, pick) => {
				const xs = pickOf(scene, ["dissolving-glass"])
				return xs.length ? { kind: "saturates", item: pick(xs).id } : null
			}
		},
		{
			kind: "mass_same", aliases: ["mass_conserved", "same_mass", "weighs_the_same", "conserved", "reads_same"], fields: { scale: "item", tol_g: "number?" }, subject: ["scale"],
			about: "mass_same {scale: a kitchen-scale, tol_g?}: the scale reads the same (within tol_g, default 1 g) at rest just after the release and at the end",
			label: (g, n) => `${n(g.scale)} reads the same before and after`,
			summarize: (ctx, g) => goal_mass_same(ctx, g),
			sample: (scene, pick) => {
				const xs = pickOf(scene, ["kitchen-scale"])
				return xs.length ? { kind: "mass_same", scale: pick(xs).id, ...(pick([true, false]) ? { tol_g: pick([0.5, 1, 3]) } : {}) } : null
			}
		},
		{
			kind: "mass_changes", aliases: ["mass_change", "weighs_less", "weighs_more", "loses_mass", "gains_mass"], fields: { scale: "item", by_g: "number", tol_g: "number?" }, subject: ["scale"],
			about: "mass_changes {scale, by_g, tol_g?}: the scale's reading at the end differs from its reading at rest after the release by by_g (negative: down) within tol_g (default 0.2 g or a tenth of by_g)",
			label: (g, n) => `${n(g.scale)} changes by ${g.by_g >= 0 ? "+" : "−"}${Math.abs(g.by_g)} g`,
			summarize: (ctx, g) => goal_mass_changes(ctx, g),
			sample: (scene, pick) => {
				const xs = pickOf(scene, ["kitchen-scale"])
				return xs.length ? { kind: "mass_changes", scale: pick(xs).id, by_g: pick([-2.62, -1.7, 5.4, 0]), ...(pick([true, false]) ? { tol_g: 0.3 } : {}) } : null
			}
		},
		{
			kind: "state", aliases: ["ends_as", "phase_is", "becomes"], fields: { item: "item", is: "string" },
			about: "state {item: a particle-box, is: solid|liquid|gas|melting|boiling}: the sample's state at the end",
			label: (g, n) => `${n(g.item)} ends ${g.is}`,
			summarize: (ctx, g) => goal_state(ctx, g),
			sample: (scene, pick) => {
				const xs = pickOf(scene, ["particle-box"])
				return xs.length ? { kind: "state", item: pick(xs).id, is: pick([...STATES, "plasma"]) } : null
			}
		},
		{
			kind: "holds_at", aliases: ["plateau", "stays_at", "temperature_holds", "holds_temperature", "constant_while"], fields: { item: "item", temp_c: "number", while: "string", tol_c: "number?" },
			about: "holds_at {item, temp_c, while: melting|boiling, tol_c?}: a heating curve's plateau: while the item melts (boils) its temperature stays at temp_c within tol_c (default 0.5 °C), and it does melt (boil) for at least two frames: a particle-box's sample (water 0 °C melting, 100 °C boiling), heat's ice-cube or meltable (melting), a saucepan's, kettle's or evaporating-dish's water (boiling)",
			label: (g, n) => `${n(g.item)} stays at ${g.temp_c} °C while it ${String(g.while ?? "").startsWith("boil") ? "boils" : "melts"}`,
			detail: (e) => (e && Number.isFinite(e.from_s) ? `${e.ok ? "yes" : "no"} (${e.low_c === e.high_c ? `${e.low_c} °C` : `${e.low_c}-${e.high_c} °C`} from ${e.from_s} s to ${e.until_s} s)` : "no (it never did)"),
			summarize: (ctx, g) => goal_holds_at(ctx, g),
			sample: (scene, pick) => {
				const xs = pickOf(scene, ["particle-box", "ice-cube", "meltable", "saucepan", "evaporating-dish"])
				return xs.length ? { kind: "holds_at", item: pick(xs).id, temp_c: pick([0, 100, 58, -78.46]), while: pick(["melting", "boiling", "Boils", "freezing"]), ...(pick([true, false]) ? { tol_c: pick([0.1, 0.5, 2]) } : {}) } : null
			}
		},
		{
			kind: "mixes", aliases: ["mix", "spreads", "diffuses", "mixed"], fields: { item: "item", at_least: "number?" },
			about: "mixes {item: a particle-box with a divider, at_least?}: its two sides end mixed at least at_least % (default 80); the box mixes on a MODEL clock (a few run seconds whatever the time-lapse): never claim real minutes from it",
			label: (g, n) => `${n(g.item)} mixes`,
			summarize: (ctx, g) => goal_mixes(ctx, g),
			sample: (scene, pick) => {
				const xs = pickOf(scene, ["particle-box"])
				return xs.length ? { kind: "mixes", item: pick(xs).id, ...(pick([true, false]) ? { at_least: pick([50, 80, 95]) } : {}) } : null
			}
		},
		{
			kind: "pressure", aliases: ["reads_kpa", "gas_pressure"], fields: { item: "item", kpa: "number", tol_kpa: "number?" },
			about: "pressure {item: a particle-box or syringe, kpa, tol_kpa?}: its gauge reads kpa (within tol_kpa, default 10 %) at the end (mean of the last 1 s); the reading is the real gas's nRT/V (a syringe: exactly 6080 ÷ V mL)",
			label: (g, n) => `${n(g.item)} reads ${g.kpa} kPa`,
			summarize: (ctx, g) => goal_pressure(ctx, g),
			sample: (scene, pick) => {
				const xs = pickOf(scene, ["particle-box", "syringe"])
				return xs.length ? { kind: "pressure", item: pick(xs).id, kpa: pick([101, 203, 50]) } : null
			}
		},
		{
			kind: "volume", aliases: ["ends_at_ml", "gas_volume"], fields: { item: "item", ml: "number", tol_ml: "number?" },
			about: "volume {item: a particle-box, syringe or balloon-bath, ml, tol_ml?}: the gas's volume at the end is ml (within tol_ml, default 5 %)",
			label: (g, n) => `${n(g.item)} ends at ${g.ml} mL`,
			summarize: (ctx, g) => goal_volume(ctx, g),
			sample: (scene, pick) => {
				const xs = pickOf(scene, ["particle-box", "syringe", "balloon-bath"])
				return xs.length ? { kind: "volume", item: pick(xs).id, ml: pick([30, 1136, 876]) } : null
			}
		},
		{
			kind: "separates", aliases: ["separate", "separated", "sorts", "pulls_out", "filters", "filtered"], fields: { item: "item" },
			about: "separates {item: a sieve, mixture-dish or filter-funnel}: the mixture is separated: through a sieve ≥ 95 % of the small part and ≤ 5 % of the big; out of a dish by its magnet ≥ 90 % of the iron and ≤ 5 % of the rest; in a filter funnel ≥ 95 % of the undissolved solid kept on the paper and ≥ 80 % of the water through",
			label: (g, n) => `${n(g.item)} separates its mixture`,
			summarize: (ctx, g) => goal_separates(ctx, g),
			sample: (scene, pick) => {
				const xs = pickOf(scene, ["sieve", "mixture-dish", "filter-funnel"])
				return xs.length ? { kind: "separates", item: pick(xs).id } : null
			}
		},
		{
			kind: "crystallizes", aliases: ["crystals_left", "salt_left", "salt_back", "recovers", "crystallises"], fields: { item: "item", g: "number?", tol_g: "number?" },
			about: "crystallizes {item: an evaporating-dish, g?, tol_g?}: at the end it holds g grams of crystals (default: all that was dissolved in it) within tol_g (default 2 %, at least 0.05 g)",
			label: (g, n) => `${n(g.item)} leaves ${Number.isFinite(g.g) ? `${g.g} g of ` : ""}crystals`,
			summarize: (ctx, g) => goal_crystallizes(ctx, g),
			sample: (scene, pick) => {
				const xs = pickOf(scene, ["evaporating-dish"])
				return xs.length ? { kind: "crystallizes", item: pick(xs).id, ...(pick([true, false]) ? { g: pick([5, 2.5, 0]) } : {}) } : null
			}
		},
		{
			kind: "warms_by", aliases: ["warms", "gets_warmer", "heats_up", "temperature_rises", "rises_by", "exothermic"], fields: { item: "item", at_least_c: "number" },
			about: "warms_by {item: a hand-warmer, a hot pack, a reaction-cup, a thermometer or anything with a temperature, at_least_c}: its temperature rises at least at_least_c above where it starts (its highest against its first)",
			label: (g, n) => `${n(g.item)} warms by at least ${g.at_least_c} °C`,
			summarize: (ctx, g) => goal_warms_by(ctx, g),
			sample: (scene, pick) => {
				const xs = pickOf(scene, ["cold-pack", "hand-warmer", "reaction-cup", "indicator-cup", "steel-wool", "thermometer", "particle-box", "evaporating-dish"])
				return xs.length ? { kind: "warms_by", item: pick(xs).id, at_least_c: pick([1, 5, 15, 40]) } : null
			}
		},
		{
			kind: "cools_by", aliases: ["cools", "gets_colder", "goes_cold", "temperature_falls", "drops_by", "endothermic"], fields: { item: "item", at_least_c: "number" },
			about: "cools_by {item: a cold-pack, an indicator-cup, a thermometer or anything with a temperature, at_least_c}: its temperature falls at least at_least_c below where it starts (its lowest against its first)",
			label: (g, n) => `${n(g.item)} cools by at least ${g.at_least_c} °C`,
			summarize: (ctx, g) => goal_cools_by(ctx, g),
			sample: (scene, pick) => {
				const xs = pickOf(scene, ["cold-pack", "indicator-cup", "reaction-cup", "hand-warmer", "thermometer", "dissolving-glass"])
				return xs.length ? { kind: "cools_by", item: pick(xs).id, at_least_c: pick([0.5, 2, 15, 30]) } : null
			}
		},
		{
			kind: "color_changes", aliases: ["colour_changes", "changes_color", "changes_colour", "turns", "turns_color", "goes_cloudy", "rusts"], fields: { item: "item", to: "string?" },
			about: "color_changes {item, to?}: its colour changes: an indicator-cup's colour is at some moment another than at the start (to: and it ends red, pink, purple, blue, blue-green, green or yellow); a reaction-cup goes from clear to cloudy white (to: white); steel-wool rusts orange-brown, 5 % or more (to: brown)",
			label: (g, n) => `${n(g.item)} changes colour${typeof g.to === "string" && g.to ? ` to ${g.to}` : ""}`,
			summarize: (ctx, g) => goal_color_changes(ctx, g),
			sample: (scene, pick) => {
				const xs = pickOf(scene, ["indicator-cup", "reaction-cup", "steel-wool"])
				return xs.length ? { kind: "color_changes", item: pick(xs).id, ...(pick([true, false]) ? { to: pick(["red", "pink", "green", "blue", "white", "brown", "Violet", " cloudy "]) } : {}) } : null
			}
		}
	],
	knobs: [
		{ type: "dissolving-glass", key: "water_temp_c", how: "abs", steps: [10, 20, 40], cost: 1, more: "warm {it}'s water", less: "cool {it}'s water",
			why: "warmer water dissolves faster (sugar about 3× from 20 to 60 °C) and holds a little more" },
		{ type: "dissolving-glass", key: "stir", how: "abs", steps: [1, 2, 3], cost: 1, more: "turn the spoon in {it} faster", less: "turn the spoon in {it} slower",
			why: "stirring sweeps the brine off the crystals: unstirred salt stalls in its own brine on the bottom" },
		{ type: "dissolving-glass", key: "grain", how: "choice", cost: 2, more: "use finer grains in {it}", less: "use bigger grains in {it}",
			why: "smaller pieces have more surface for their mass: powder fastest, a cube slowest" },
		{ type: "dissolving-glass", key: "solute_g", how: "rel", cost: 2, more: "put more into {it}", less: "put less into {it}",
			why: "more than the water can hold (35.9 g salt per 100 g at 20 °C) stays undissolved" },
		{ type: "dissolving-glass", key: "water_ml", how: "rel", cost: 2, more: "use more water in {it}", less: "use less water in {it}",
			why: "more water holds more before it saturates" },
		{ type: "particle-box", key: "heater_w", how: "rel", cost: 1, more: "turn {it}'s heater up", less: "turn {it}'s heater down",
			why: "the heat put in (power × time × time_lapse) over the sample's mass decides how far it gets along the heating curve" },
		{ type: "particle-box", key: "temp_c", how: "abs", steps: [10, 50, 100], cost: 2, more: "start {it} warmer", less: "start {it} colder",
			why: "the start temperature: hotter particles move faster; past the melting or boiling point it starts liquid or gas" },
		{ type: "particle-box", key: "sample_g", how: "rel", cost: 2, more: "use a bigger sample in {it}", less: "use a smaller sample in {it}",
			why: "a smaller sample warms, melts and boils sooner with the same heater" },
		{ type: "particle-box", key: "load_kg", how: "abs", steps: [0.5, 1, 2], cost: 1, more: "load {it}'s piston more", less: "load {it}'s piston less",
			why: "more load on the piston squeezes the gas smaller (Boyle)" },
		{ type: "particle-box", key: "open_at_s", how: "abs", steps: [0.5, 1], cost: 1, more: "lift {it}'s divider later", less: "lift {it}'s divider sooner",
			why: "the gases only mix once the divider is up" },
		{ type: "syringe", key: "push_to_ml", how: "abs", steps: [5, 10, 15], cost: 1, more: "push {it} in less", less: "push {it} in further",
			why: "half the volume doubles the pressure (Boyle); holding it further in takes more push (284 N at 10 mL, 624 N at 5 mL)" },
		{ type: "balloon-bath", key: "water_temp_c", how: "abs", steps: [10, 20, 40], cost: 1, more: "warm {it}'s water", less: "cool {it}'s water",
			why: "the balloon's volume follows its air's kelvin temperature" },
		{ type: "reaction-bottle", key: "soda_g", how: "rel", cost: 1, more: "put more baking soda in {it}", less: "put less baking soda in {it}",
			why: "the gas made is the soda's 44/84 of its mass while the vinegar's acid lasts; capped, the pressure rises with it and past 900 kPa the cap pops off (the gas then escapes): less soda keeps it on" },
		{ type: "reaction-bottle", key: "react_s", how: "rel", cost: 2, more: "make {it} fizz more slowly", less: "make {it} fizz faster",
			why: "the fizz's time: most of the gas comes off in three times it" },
		{ type: "reaction-bottle", key: "closure", how: "choice", cost: 6, more: "close {it} another way", less: "close {it} another way",
			why: "open: the gas escapes (scale down); cap: stays (no change); balloon: buoyed (scale a little down). Never change it when it is what the lesson compares" },
		{ type: "sieve", key: "aperture_mm", how: "rel", cost: 1, more: "use a coarser mesh in {it}", less: "use a finer mesh in {it}",
			why: "only grains smaller than the holes pass: the holes must be between the two sizes" },
		{ type: "sieve", key: "shake_until_s", how: "abs", steps: [1, 2, 4], cost: 1, more: "make {it} shake longer", less: "make {it} shake for less time",
			why: "shaking longer lets the last small grains through" },
		{ type: "sieve", key: "shake_mm", how: "rel", cost: 1, more: "make {it} shake harder", less: "make {it} shake more gently",
			why: "a stronger shake stirs the heap so small grains reach the mesh" },
		{ type: "mixture-dish", key: "wand_height", how: "m", steps: [0.003, 0.005, 0.01], cost: 1, more: "raise {it}'s wand", less: "lower {it}'s wand",
			why: "a magnet's pull falls off steeply with distance: the wand's tip must pass within about 1 cm of the iron" },
		{ type: "mixture-dish", key: "wand_s", how: "rel", cost: 1, more: "make {it}'s wand sweep slower", less: "make {it}'s wand sweep faster",
			why: "a slower sweep gives the filings time to jump up to the tip" },
		{ type: "mixture-dish", key: "magnet", how: "link", cost: 3, more: "use another magnet over {it}", less: "use another magnet over {it}",
			why: "only the linked magnet pulls: a stronger one (neodymium) or a nearer one takes more iron" },
		{ type: "filter-funnel", key: "funnel_mm", how: "rel", cost: 1, more: "use a bigger funnel for {it}", less: "use a smaller funnel for {it}",
			why: "a bigger funnel holds more of the mixture at a time above the paper, so it is all poured and through sooner" },
		{ type: "filter-funnel", key: "rinse_ml", how: "abs", steps: [5, 10, 20], cost: 1, more: "rinse {it} with more clean water", less: "rinse {it} with less water",
			why: "the wet paper and the sand hold a few mL of the salty water: a rinse of clean water carries its salt through" },
		{ type: "filter-funnel", key: "paper", how: "choice", cost: 3, more: "use another paper in {it}", less: "use another paper in {it}",
			why: "filter paper keeps grains over 11 µm; a coffee filter runs about 3 times faster but lets chalk through; no paper keeps nothing. Never change it when it is what the lesson compares" },
		{ type: "filter-funnel", key: "water_temp_c", how: "abs", steps: [10, 20, 40], cost: 2, more: "use warmer water in {it}", less: "use colder water in {it}",
			why: "warm water is less viscous: it runs through the paper faster (twice as fast at 50 °C as at 20 °C)" },
		{ type: "filter-funnel", key: "pour_s", how: "rel", cost: 1, more: "pour {it} more slowly", less: "pour {it} faster",
			why: "the pourer waits whenever the funnel is full, so pouring faster only helps while there is room above the paper" },
		{ type: "evaporating-dish", key: "heater_w", how: "rel", cost: 1, more: "turn {it}'s hot plate up", less: "turn {it}'s hot plate down",
			why: "about half the hot plate's power reaches the dish: 300 W boils 50 mL dry in about 17 minutes" },
		{ type: "evaporating-dish", key: "water_ml", how: "rel", cost: 2, more: "use more water in {it}", less: "use less water in {it}",
			why: "less water is gone sooner (the salt left is the same)" },
		{ type: "evaporating-dish", key: "humidity_pct", how: "abs", steps: [10, 20], cost: 1, more: "make the air round {it} damper", less: "make the air round {it} drier",
			why: "drier air takes the water faster (in a room or the sun; a boiling dish does not care)" },
		{ type: "evaporating-dish", key: "heat", how: "choice", cost: 4, more: "heat {it} another way", less: "heat {it} another way",
			why: "a hot plate boils it dry in minutes, the sun takes days, a room about 11 days. Never change it when it is what the lesson compares" },
		{ type: "pumped-ball", key: "end_bar", how: "abs", steps: [0.2, 0.4], cost: 1, more: "pump {it} harder", less: "pump {it} less",
			why: "the air added is about 6.7 g per bar in a size-5 ball" },
		{ type: "chocolate-bar", key: "snap_at_s", how: "abs", steps: [0.5, 1], cost: 1, more: "make {it} snap later", less: "make {it} snap sooner",
			why: "the scale must have settled before and after the snap" },
		{ type: "cold-pack", key: "salt_g", how: "rel", cost: 1, more: "put more of the chemical in {it}", less: "put less of the chemical in {it}",
			why: "the heat taken in (or given out) grows with the chemical: 30 g of ammonium nitrate in 100 mL cools it about 20 °C if no heat comes in" },
		{ type: "cold-pack", key: "water_ml", how: "rel", cost: 2, more: "give {it} a bigger water bag", less: "give {it} a smaller water bag",
			why: "less water to cool (or warm) makes a bigger change, as long as the water still dissolves it all" },
		{ type: "cold-pack", key: "dissolve_s", how: "rel", cost: 1, more: "shake {it} less", less: "shake {it} harder",
			why: "dissolving faster gives the room less time to warm it back: its coldest is colder" },
		{ type: "cold-pack", key: "chemical", how: "choice", cost: 5, more: "use another chemical in {it}", less: "use another chemical in {it}",
			why: "ammonium nitrate cools most (25.7 kJ/mol), urea and ammonium chloride less; calcium chloride heats instead. Never change it when it is what the lesson compares" },
		{ type: "cold-pack", key: "squeeze_at_s", how: "abs", steps: [0.5, 1], cost: 1, more: "squeeze {it} later", less: "squeeze {it} sooner",
			why: "it changes temperature only from the squeeze on: earlier leaves the run more time" },
		{ type: "hand-warmer", key: "lasts_h", how: "rel", cost: 1, more: "make {it} last longer (cooler)", less: "make {it} burn faster (hotter)",
			why: "its power is its iron's heat over how long it lasts: half the time, twice the warmth" },
		{ type: "hand-warmer", key: "iron_g", how: "rel", cost: 1, more: "put more iron in {it}", less: "put less iron in {it}",
			why: "more iron gives out more heat for as long, and takes in more of the air's oxygen" },
		{ type: "hand-warmer", key: "open_at_s", how: "abs", steps: [0.5, 1], cost: 1, more: "open {it} later", less: "open {it} sooner",
			why: "it warms only once air gets in" },
		{ type: "steel-wool", key: "soaked", how: "choice", cost: 3, more: "soak {it} in something else", less: "soak {it} in something else",
			why: "vinegar rusts it within a day, salt water about a day, plain water days, dry weeks. Never change it when it is what the lesson compares" },
		{ type: "steel-wool", key: "wool_g", how: "rel", cost: 1, more: "use more steel wool in {it}", less: "use less steel wool in {it}",
			why: "more iron rusting takes more oxygen: the scale gains more" },
		{ type: "indicator-cup", key: "amount", how: "rel", cost: 1, more: "pour more into {it}", less: "pour less into {it}",
			why: "more acid lowers the pH further (redder), more base raises it (bluer, greener)" },
		{ type: "indicator-cup", key: "then_amount", how: "rel", cost: 1, more: "pour more of the second into {it}", less: "pour less of the second into {it}",
			why: "the second addition must outweigh the first to turn the colour back: about 0.07 g of baking soda per mL of vinegar" },
		{ type: "indicator-cup", key: "add", how: "choice", cost: 4, more: "add something else to {it}", less: "add something else to {it}",
			why: "an acid (vinegar, lemon juice) turns red cabbage red or pink, a base (baking soda, washing soda) blue or green. Never change it when it is what the lesson compares" },
		{ type: "reaction-cup", key: "cacl2_g", how: "rel", cost: 1, more: "pour more calcium chloride into {it}", less: "pour less calcium chloride into {it}",
			why: "more calcium chloride warms it more as it dissolves and makes more white solid (while the baking soda lasts)" },
		{ type: "reaction-cup", key: "soda_g", how: "rel", cost: 1, more: "dissolve more baking soda in {it}", less: "dissolve less baking soda in {it}",
			why: "more baking soda makes more solid and gas (while the calcium chloride lasts)" },
		{ type: "reaction-cup", key: "react_s", how: "rel", cost: 1, more: "make {it} react more slowly", less: "make {it} react faster",
			why: "the white solid forms over about this many lesson seconds" }
	],
	digest: (item, sim) => digestLines(item, sim),
	place: {
		containers: ["zip-bag", "indicator-cup", "reaction-cup"],
		inside: { "ice-cube": ["zip-bag"], "salt-pile": ["zip-bag"], thermometer: ["indicator-cup", "reaction-cup"] },
		interior: (type, props) =>
			type === "zip-bag"
				? { x0: -0.078, x1: 0.078, floor: 0.002, rim: 0.002 + (Number.isFinite(props?.puff) ? props.puff : 0.06) }
				: type === "indicator-cup" || type === "reaction-cup"
					? { x0: -BEAKER_R, x1: BEAKER_R, floor: BEAKER_B, rim: BEAKER_B + BEAKER_H }
					: null
	},
	words: {
		change: (type, key, a, b, nameOf) => changeWords(type, key, a, b, nameOf),
		// (opening or sealing a container changes what its scale must read: the gas escapes or stays: such an edit may change its goals)
		regoals: "(?:take|took|taking|pull|pulled|remove|removed|removing|unscrew\\w*|twist\\w*|pop|popped|leave|left)\\s+(?:off\\s+)?(?:the\\s+|its\\s+|a\\s+)?(?:bottle'?s?\\s+)?(?:cap|lid|balloon|top|seal)\\b|(?:uncap|unseal|open)\\w*\\s+(?:up\\s+)?(?:the\\s+|its\\s+)?(?:fizz\\s+)?(?:bottle|bag|zip|jar|container)|without\\s+(?:the\\s+|a\\s+|its\\s+)?(?:cap|lid|balloon)|(?:put|screw|twist|stretch)\\w*\\s+(?:the\\s+|a\\s+)?(?:cap|lid|balloon)\\s+(?:back\\s+)?on|(?:seal|cap|close)\\w*\\s+(?:up\\s+)?(?:the\\s+|its\\s+)?(?:fizz\\s+)?(?:bottle|bag|jar|container)|uncap\\w*|unseal\\w*|(?:bottle|bag|jar)\\s+(?:open|unsealed|uncapped)\\b|(?:swap|replace|change|switch)\\w*\\s+(?:the\\s+|its\\s+)?(?:cap|lid|balloon)|closure",
		keys: {
			"dissolving-glass.water_temp_c": "hot\\w*|warm\\w*|cold\\w*|cool\\w*|temperature|°C|degrees",
			"dissolving-glass.stir": "stir\\w*|spoon|swirl\\w*",
			"dissolving-glass.grain": "grain\\w*|powder\\w*|cube\\w*|coarse|fine\\w*|crush\\w*|lump\\w*",
			"dissolving-glass.solute": "salt|sugar|sand|chalk",
			"dissolving-glass.solute_g": "more salt|less salt|more sugar|less sugar|grams?|spoonful\\w*|amount",
			"dissolving-glass.water_ml": "more water|less water|millilit\\w*|mL",
			"particle-box.substance": "water|ice|wax|iron|gallium|dry ice|carbon dioxide|air|nitrogen|helium|bromine",
			"particle-box.heater_w": "heat\\w*|hotter|watt\\w*|power",
			"particle-box.temp_c": "temperature|°C|degrees|start\\w* (hot|cold|warm)",
			"particle-box.load_kg": "load|weight|heav\\w*|press\\w*|squeez\\w*",
			"syringe.push_to_ml": "push\\w*|plunger|squeez\\w*|compress\\w*",
			"balloon-bath.water_temp_c": "hot\\w*|warm\\w*|cold\\w*|ice|temperature",
			"reaction-bottle.closure": "cap\\w*|lid|balloon|open|seal\\w*|clos\\w*",
			"reaction-bottle.soda_g": "baking soda|soda|more|less",
			"sieve.aperture_mm": "mesh|hole\\w*|aperture|finer|coarser",
			"mixture-dish.mixture": "sand|iron|filings|pepper|rice|beans|clips|gravel",
			"mixture-dish.magnet": "magnet\\w*",
			"pumped-ball.end_bar": "pump\\w*|bar|pressure|inflat\\w*",
			"filter-funnel.paper": "paper|filter\\w*|coffee",
			"filter-funnel.rinse_ml": "rins\\w*|wash\\w*",
			"filter-funnel.solid": "sand|chalk",
			"filter-funnel.dissolved": "salt|sugar",
			"filter-funnel.funnel_mm": "funnel|bigger|smaller|wider",
			"evaporating-dish.heat": "hot plate|sun\\w*|window\\w*|room|heat\\w*",
			"evaporating-dish.heater_w": "watt\\w*|power|hotter|turn\\w* up|turn\\w* down",
			"evaporating-dish.water_ml": "more water|less water|millilit\\w*|mL",
			"evaporating-dish.solute": "salt|sugar",
			"density-cube.made_of": "made of|material|wood|pine|oak|metal|copper|steel|aluminium|aluminum|plastic|brass",
			"equal-mass-block.made_of": "made of|material|wood|pine|oak|metal|copper|steel|aluminium|aluminum|plastic|brass",
			"cold-pack.chemical": "ammonium nitrate|urea|ammonium chloride|calcium chloride|chemical|hot pack|salt",
			"cold-pack.salt_g": "more|less|grams?|amount",
			"cold-pack.water_ml": "water|bag|millilit\\w*|mL",
			"cold-pack.dissolve_s": "shak\\w*|faster|slower|dissolv\\w*",
			"hand-warmer.lasts_h": "hours?|last\\w*|hotter|faster|slower",
			"hand-warmer.iron_g": "iron|powder|more|less",
			"steel-wool.soaked": "vinegar|salt water|water|dry|soak\\w*|wet",
			"steel-wool.wool_g": "more|less|grams?|steel wool",
			"indicator-cup.add": "vinegar|lemon|baking soda|washing soda|acid|base|add\\w*",
			"indicator-cup.amount": "more|less|mL|grams?|drops?|amount",
			"indicator-cup.then_add": "then|after|second|baking soda|vinegar",
			"reaction-cup.cacl2_g": "calcium chloride|road salt|more|less",
			"reaction-cup.soda_g": "baking soda|soda",
			"molecule.molecule": "water|H2O|carbon dioxide|CO2|methane|CH4|ammonia|NH3|oxygen|O2|nitrogen|N2|hydrogen|H2",
			"molecule.style": "ball|stick|space|filling",
			"crystal.lattice": "salt|NaCl|diamond|carbon|ice",
			"crystal.cells": "bigger|smaller|repeats?|cells?|size"
		}
	}
}
