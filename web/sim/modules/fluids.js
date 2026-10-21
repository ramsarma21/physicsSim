// The liquids module: water and other liquids standing in fixed containers, and what floats, sinks and sails in them.
// A port of machines/mod_fluids.py, line by line (same names, same order, same numbers); plain ES module, no dependencies beyond web/sim.
// web/sim/modules/index.js registers it (register_all, as a catalog file's) after the catalog files; its `plugin` export is the AI's view of it
// (goal kinds, digest, knobs, prompt lines, placement rules, change words: web/sim/plugins.js).
// Sources: see the Python file's docstring ([IAPWS-95], [CRC], [SHARQAWY], [NOUREDDINI], [YANNIOTIS], [USMINT], [RGR], [HOE], [ORTIZ]).
// (a module file takes everything from the framework object register_all gets: web/sim/items.js FRAMEWORK, its `py` = pymath.js)
let register, ItemType, Prop, Readout, MATERIALS, add_look, LOOK_FILL, LOOK_SHADE, register_goal_kind, TYPES, polygon_problem, CATEGORIES, define_material
let register_build_hook, props_of
let pyRound, pymin, pymax, hasOwn, ValueError, cube, cos, sin, pySum
let F = null // the whole framework object (the solver's placement rules build an item alone with it)

export const MODULE = "fluids"

export function register_all(g) {
	;({ register, ItemType, Prop, Readout, MATERIALS, add_look, LOOK_FILL, LOOK_SHADE, register_goal_kind, TYPES, polygon_problem, CATEGORIES, define_material } = g)
	;({ register_build_hook, props_of } = g)
	;({ pyRound, pymin, pymax, hasOwn, ValueError, cube, cos, sin, pySum } = g.py)
	F = g
	if (!CATEGORIES.includes("Liquids")) CATEGORIES.push("Liquids")
	_looks()
	_materials()
	_containers()
	_floaters()
	_things()
	_air()
	_surface()
	_goals()
	register_build_hook(_displacement)
}

// ---------------------------------------------------------------- liquids
// name -> [density kg/m³, viscosity Pa·s, look, source]. Salt water's density and viscosity follow its salt (SALT below).
export const LIQUIDS = {
	water: [998.2, 0.001002, "water", "Water at 20 °C: 998.2 kg/m³, 1.002 mPa·s [IAPWS-95]."],
	"salt water": [null, null, "water", "Salt water (sodium chloride) at 20 °C: density and viscosity by its salt [CRC]."],
	"sea water": [1024.8, 0.00108, "sea water", "Sea water, 35 g of salt a kilogram, 20 °C: 1024.8 kg/m³, 1.08 mPa·s [SHARQAWY]."],
	"vegetable oil": [920.0, 0.06, "oil", "Soybean or canola oil at 20 °C: about 920 kg/m³, about 0.06 Pa·s [NOUREDDINI] (approximate)."],
	"corn syrup": [1380.0, 2.5, "syrup", "Light corn syrup: about 1380 kg/m³; about 2.5 Pa·s at 20 °C (approximate: brands differ)."],
	honey: [1420.0, 10.0, "honey", "Honey: about 1420 kg/m³; 2-20 Pa·s at 20 °C by its water, 10 used [YANNIOTIS] (approximate)."],
	"dish soap": [1050.0, 0.5, "soap", "Liquid dish soap: about 1050 kg/m³, about 0.5 Pa·s (manufacturers' data; approximate)."],
	"rubbing alcohol": [880.0, 0.0025, "alcohol", "Rubbing alcohol (70 % isopropyl): about 880 kg/m³, about 2.5 mPa·s (approximate)."],
	milk: [1030.5, 0.0021, "milk", "Whole milk at 20 °C: 1030.5 kg/m³ [MILK-RHO], 2.1 mPa·s [MILK-MU]; white and opaque (its fat droplets and casein scatter light)."],
	"chocolate milk": [1065.0, 0.008, "chocolate milk", "Chocolate milk at 20 °C: about 1065 kg/m³ (provisional); about 8 mPa·s as it pours (it thins " + "as it flows [DRINKS-RHEO]); brown and opaque."]
}
export const LIQUID_NAMES = Object.keys(LIQUIDS)
// NaCl in water at 20 °C [CRC]: mass % -> [density kg/m³, viscosity mPa·s]; between the rows, a straight line
const SALT = [
	[0.0, 998.2, 1.002], [1.0, 1005.3, 1.02], [2.0, 1012.5, 1.036], [4.0, 1026.8, 1.07], [6.0, 1041.3, 1.108], [8.0, 1055.9, 1.149],
	[10.0, 1070.7, 1.193], [12.0, 1085.7, 1.244], [14.0, 1100.9, 1.3], [16.0, 1116.2, 1.361], [20.0, 1147.8, 1.503],
	[24.0, 1180.2, 1.686], [26.0, 1197.2, 1.8]
]
export const SALT_MAX = 26.0

/** [density kg/m³, viscosity Pa·s] of salt water with pct mass % of salt at 20 °C [CRC], linear between the table's rows. */
export function salt_water(pct) {
	const p = pymin(SALT_MAX, pymax(0.0, pct))
	for (let i = 0; i + 1 < SALT.length; i++) {
		const [p0, d0, m0] = SALT[i]
		const [p1, d1, m1] = SALT[i + 1]
		if (p <= p1) {
			const u = (p - p0) / (p1 - p0)
			return [pyRound(d0 + (d1 - d0) * u, 3), pyRound((m0 + (m1 - m0) * u) / 1000, 7)]
		}
	}
	return [SALT[SALT.length - 1][1], SALT[SALT.length - 1][2] / 1000]
}

/** [words, density, viscosity] of a liquid choice. */
export function liquid_of(name, pct = 0.0) {
	if (name === "salt water") {
		const [d, v] = salt_water(pct)
		return [`salt water (${_num_text(pct)} % salt)`, d, v]
	}
	const [d, v] = LIQUIDS[name]
	return [name, d, v]
}

/** A number as a short text: 10, 12.5 (no trailing zeros), as Python's `str(int(r))` or `f"{r:g}"` writes it for these small numbers. */
export function _num_text(v) {
	const r = pyRound(v, 2)
	return r === Math.trunc(r) ? String(Math.trunc(r)) : String(r)
}

function _layer(name, height, pct = 0.0) {
	const [words, d, v] = liquid_of(name, pct)
	return { words, density: d, viscosity: v, height: pyRound(pymax(0.0, height), 6) }
}

// ---------------------------------------------------------------- looks and materials
function _looks() {
	add_look("water", { fill: "#9cc9ea", shade: "#5f9cc9", roughness: 0.05, metalness: 0.0, clearcoat: 1.0, transmission: 0.85, ior: 1.333, thickness: 0.05 })
	add_look("sea water", { fill: "#8cc5c9", shade: "#4f9a9f", roughness: 0.05, metalness: 0.0, clearcoat: 1.0, transmission: 0.8, ior: 1.34, thickness: 0.05 })
	add_look("oil", { fill: "#e3b53b", shade: "#b78a1c", roughness: 0.05, metalness: 0.0, clearcoat: 1.0, transmission: 0.7, ior: 1.47, thickness: 0.05 })
	add_look("syrup", { fill: "#ecd08a", shade: "#c4a35a", roughness: 0.05, metalness: 0.0, clearcoat: 1.0, transmission: 0.75, ior: 1.49, thickness: 0.05 })
	add_look("honey", { fill: "#d08a12", shade: "#9c6208", roughness: 0.08, metalness: 0.0, clearcoat: 1.0, transmission: 0.55, ior: 1.5, thickness: 0.05 })
	add_look("soap", { fill: "#4fb05a", shade: "#2f7f3a", roughness: 0.08, metalness: 0.0, clearcoat: 1.0, transmission: 0.6, ior: 1.4, thickness: 0.05 })
	add_look("alcohol", { fill: "#e8eef2", shade: "#b9c4cc", roughness: 0.05, metalness: 0.0, clearcoat: 1.0, transmission: 0.9, ior: 1.38, thickness: 0.05 })
	add_look("milk", { fill: "#f6f4ee", shade: "#d9d4c8", roughness: 0.25, metalness: 0.0, clearcoat: 0.6 })
	add_look("chocolate milk", { fill: "#7a4e33", shade: "#563622", roughness: 0.25, metalness: 0.0, clearcoat: 0.6 })
	add_look("tub plastic", { fill: "#4f8fd8", shade: "#2f6bb0", roughness: 0.45, metalness: 0.0, clearcoat: 0.2 })
	add_look("vinyl", { fill: "#eef0ec", shade: "#c4c8c0", roughness: 0.4, metalness: 0.0, clearcoat: 0.2 })
	add_look("sail", { fill: "#f6f3ea", shade: "#cfc9b8", roughness: 0.85, metalness: 0.0, clearcoat: 0.0 })
	add_look("hull paint", { fill: "#d2483a", shade: "#a2302a", roughness: 0.35, metalness: 0.0, clearcoat: 0.6 })
	add_look("foil", { fill: "#d6dade", shade: "#9aa1a8", roughness: 0.25, metalness: 1.0, clearcoat: 0.0 })
	add_look("copper", { fill: "#b8693a", shade: "#8a4a26", roughness: 0.35, metalness: 1.0, clearcoat: 0.0 })
	add_look("grape", { fill: "#6a3d7a", shade: "#4a2656", roughness: 0.3, metalness: 0.0, clearcoat: 0.5 })
	add_look("stone", { fill: "#8d8a84", shade: "#66625c", roughness: 0.85, metalness: 0.0, clearcoat: 0.0 })
	add_look("bead", { fill: "#e2445c", shade: "#b02a40", roughness: 0.25, metalness: 0.0, clearcoat: 0.6 })
}

/** MATERIALS[key] = kw (rolling and side 0.0 unless given, appended as dict.setdefault does); only when no module has it yet. Every number a float. */
function _mat(key, kw) {
	const values = { ...kw }
	if (!("rolling" in values)) values.rolling = 0.0
	if (!("side" in values)) values.side = 0.0
	if (!hasOwn(MATERIALS, key)) define_material(key, values, [])
}

function _materials() {
	_mat("pine", { density: 400.0, bounce: 0.6, friction: 0.45, rolling: 0.004, look: "hull paint",
		source: "Pine 350-460 kg/m³ at 12 % moisture (Wood Handbook, FPL-GTR-190, 2010, Table 5-3a); a toy hull is about 400. Bounce and friction as other woods (provisional)." })
	_mat("vinyl", { density: 1400.0, bounce: 0.5, friction: 0.45, rolling: 0.01, look: "vinyl",
		source: "Rigid PVC (vinyl) 1300-1450 kg/m³; a rain gutter's wall is about 2-3 mm. Bounce and friction provisional." })
	_mat("sail cloth", { density: 1000.0, bounce: 0.2, friction: 0.6, rolling: 0.0, look: "sail",
		source: "Paper 80 g/m², polyethylene film 46 g/m² (50 µm), cloth 120 g/m²: a sail's own weight is set by its material." })
	_mat("aluminium foil", { density: 2700.0, bounce: 0.1, friction: 0.4, rolling: 0.0, look: "foil",
		source: "Aluminium 2700 kg/m³; household foil 0.016 mm thick (heavy duty 0.024 mm). Crumples rather than bounces: e 0.1 provisional." })
	_mat("copper-plated zinc", { density: 7140.0, bounce: 0.5, friction: 0.3, rolling: 0.002, look: "copper",
		source: "The U.S. cent since 1982: 97.5 % zinc, 2.5 % copper plating, 2.500 g, 19.05 mm, 1.52 mm thick [USMINT]. Bounce and friction as other coins (provisional)." })
	_mat("grape", { density: 1060.0, bounce: 0.3, friction: 0.6, rolling: 0.05, look: "grape",
		source: "A grape is a little denser than water, about 1.06 g/cm³ (approximate): it sinks in water and floats on syrup." })
	_mat("polyethylene", { density: 950.0, bounce: 0.6, friction: 0.3, rolling: 0.01, look: "bead",
		source: "High-density polyethylene 940-970 kg/m³: a bead of it floats on water and sinks in oil." })
	_mat("granite", { density: 2650.0, bounce: 0.5, friction: 0.6, rolling: 0.02, look: "stone",
		source: "Granite 2630-2750 kg/m³ (Engineering ToolBox); a river pebble. Bounce provisional." })
	_mat("paper strip", { density: 600.0, bounce: 0.1, friction: 0.6, rolling: 0.0, look: "paper",
		source: "Paper towel, filter paper and office paper 300-800 kg/m³ (a strip that hangs in a liquid: its weight does not matter; approximate)." })
}

// ---------------------------------------------------------------- small geometry helpers (as the Python, step for step)
function _area(pts) {
	// (Python's sum() of floats is Neumaier's compensated sum since 3.12: pySum, so the last bit agrees)
	const n = pts.length
	const terms = []
	for (let k = 0; k < n; k++) terms.push(pts[k][0] * pts[(k + 1) % n][1] - pts[(k + 1) % n][0] * pts[k][1])
	return Math.abs(pySum(terms)) / 2
}

const _r5 = (pts) => pts.map(([x, y]) => [pyRound(x, 5), pyRound(y, 5)])

/** A fixed container stands upright whatever the item's angle (its liquid is level): its solids are placed unturned. */
function _upright(c) {
	c.ca = 1.0
	c.sa = 0.0
	c.a = 0.0
}

/** A solid welded to another solid of this item: `at` (and `angle`, rad) in the parent's own frame. */
function _child(c, part, parent, body, at, material, look, words, color = null, angle = 0.0) {
	const s = {
		kind: c.kind, id: `${c.item.id}/${part}`, words, item: c.item.id, look, body, material,
		at: { x: pyRound(at[0], 5), y: pyRound(at[1], 5) }, parent, placeholder: { fill: color || LOOK_FILL[look] },
		render: { kind: "procedural", shade: LOOK_SHADE[look] }, depth: 2
	}
	if (Math.abs(angle) > 1e-12) s.angle = pyRound(angle, 6)
	if (color) s.color = color
	c.sb.solids.push(s)
	return s.id
}

function _poly_body(pts, depth) {
	pts = _r5(pts)
	const problem = polygon_problem(pts)
	if (problem) throw new ValueError(`polygon ${problem}`)
	return { kind: "polygon", points: pts.map(([x, y]) => ({ x, y })), depth: pyRound(depth, 5) }
}

export const COLORS = { blue: "#3f7fd0", white: "#eef0ec", grey: "#9aa0a6", green: "#4fa35a", red: "#c8443a", yellow: "#e8c13a", orange: "#e8823a", black: "#2a2a2a", clear: null }
const COLOR_NAMES = Object.keys(COLORS)
const colorOf = (name) => (hasOwn(COLORS, name) ? COLORS[name] : null)

function _liquid_props(default_liquid = "water") {
	return [
		new Prop("liquid", "Liquid", default_liquid, { kind: "choice", choices: LIQUID_NAMES, help: "What is in it (each at 20 °C)" }),
		new Prop("salt_pct", "Salt", 10.0, 0.0, SALT_MAX, 0.5, "%", "Salt water only: grams of salt in 100 g of the salt water (26 % is as salty as water gets)"),
		new Prop("water_temp_c", "Liquid temperature", 20.0, 0.0, 100.0, 1.0, "°C", "For a heat module; the liquid's density and thickness are taken at 20 °C")
	]
}

function _readouts() {
	return [
		new Readout("level_mm", "Level", { unit: "mm", digits: 1, help: "How high the surface stands above the inside of the floor" }),
		new Readout("volume_ml", "Reads", { unit: "mL", digits: 1, help: "What a scale on the wall reads: the liquid and whatever is under its surface" }),
		new Readout("spilled_ml", "Spilled", { unit: "mL", digits: 1, help: "Liquid that went over the rim" })
	]
}

/** The container's liquid for the engine (doc.processes): world coordinates (the container is fixed and upright). */
function _liquid_record(c, x0, x1, floor, rim, area, layers) {
	c.process("liquid", "liquid", {
		x0: pyRound(c.ox + x0, 6), x1: pyRound(c.ox + x1, 6), floor: pyRound(c.oy + floor, 6), rim: pyRound(c.oy + rim, 6), area: pyRound(area, 8), layers
	})
}

// ---------------------------------------------------------------- containers
export const TANK_STYLES = {
	// inner length, wall height, front-to-back, wall thickness, material, look, how full (of the inside's height), colour
	aquarium: [0.5, 0.3, 0.25, 0.006, "glass", "glass", 0.7, "clear"],
	tub: [0.6, 0.18, 0.4, 0.004, "polypropylene", "tub plastic", 0.7, "blue"],
	trough: [3.05, 0.1, 0.12, 0.003, "vinyl", "vinyl", 0.85, "white"] // (a regatta's gutter is filled near its brim: the boats ride above it)
}

function _containers() {
	function build_tank(c, P) {
		_upright(c)
		const given = c.item.props ?? {}
		const style = P.style
		const [L0, H0, D0, t, mat, look, full, col0] = TANK_STYLES[style]
		for (const [k, v] of [["length", L0], ["height", H0], ["depth", D0], ["color", col0]]) if (!hasOwn(given, k)) P[k] = v
		const L = P.length
		const H = P.height
		const D = P.depth
		if (!hasOwn(given, "fill")) P.fill = pyRound(full * (H - t), 4)
		const fill = pymin(P.fill, H - t)
		const color = style !== "aquarium" ? colorOf(P.color) : null
		const m = c.mat({ base: mat, overrides: {} })
		const kw = { kind: "static", material: m, look }
		if (color) Object.assign(kw, { color, fill: color })
		// (stood in the air, its floor is held by stands the view draws: a raised lane over another)
		c.slab("floor", L + 2 * t, t, D, 0.0, t / 2, { stand: "post", ...kw, words: `the ${style}'s floor` })
		c.slab("wall-left", t, H - t, D, -L / 2 - t / 2, t + (H - t) / 2, { ...kw, words: `the ${style}'s end wall` })
		c.slab("wall-right", t, H - t, D, L / 2 + t / 2, t + (H - t) / 2, { ...kw, words: `the ${style}'s end wall` })
		_liquid_record(c, -L / 2, L / 2, t, H, L * (D - 2 * t), fill > 0 ? [_layer(P.liquid, fill, P.salt_pct)] : [])
		P.wall = t
	}

	register(new ItemType("water-tank", "Water tank", "Liquids", build_tank, {
		dynamic: false, material: "glass", materials: ["glass"],
		props: [
			new Prop("style", "Kind", "aquarium", { kind: "choice", choices: Object.keys(TANK_STYLES),
				help: "aquarium: glass, see-through (how deep things float); tub: a plastic storage tub; trough: a long rain-gutter lane for boat races" }),
			new Prop("length", "Length (inside)", 0.5, 0.15, 3.05, 0.01, "m", "Along the table; follows the kind until you set it", { auto: ["style"] }),
			new Prop("height", "Wall height", 0.3, 0.05, 0.6, 0.005, "m", "Follows the kind until you set it", { auto: ["style"] }),
			new Prop("depth", "Front to back", 0.25, 0.08, 0.6, 0.01, "m", "Follows the kind until you set it", { auto: ["style"] }),
			new Prop("fill", "Liquid depth", 0.2058, 0.0, 0.6, 0.005, "m", "How deep the liquid stands with nothing in it (7/10 of the inside's height, a trough 85/100, until you set it)", { auto: ["style", "height"] }),
			..._liquid_props(),
			new Prop("color", "Colour", "clear", { kind: "choice", choices: COLOR_NAMES, help: "The tub's or trough's plastic (an aquarium is glass); follows the kind until you set it", auto: ["style"] })
		],
		tags: ["water", "aquarium", "tank", "tub", "trough", "rain gutter", "pool", "basin", "sink", "float", "sink or float", "boat race", "lane",
			"liquid", "salt water", "oil", "pond", "bath"],
		description: "A container of liquid fixed on the table: a glass aquarium (see how deep things float), a plastic tub, or a long trough " +
			"(a rain-gutter lane for boat races). Things put in float or sink by their density, and the level rises by what they push under.",
		source: "Aquarium glass 6 mm, tub polypropylene 4 mm, trough vinyl 3 mm [RGR]. Water 998.2 kg/m³ [IAPWS-95]; salt water by its salt [CRC].",
		anchor: "the middle of its base, where it stands", facts: "50 × 30 cm glass aquarium, 25 cm deep, water 20.5 cm",
		edit: [{ kind: "length", prop: "length" }, { kind: "top", prop: "fill" }], readouts: _readouts(), module: MODULE
	}))

	// --- graduated cylinder, beaker, measuring jug: round glass (or plastic) vessels read in mL
	// inner diameter, its top mark's height over its inside bottom, its rim's height over the table, glass, a mark's mL (its glass bottom stands on a 12 mm foot)
	const CYLINDERS = { "100 mL": [0.0285, 0.157, 0.212, 0.0015, 1.0], "250 mL": [0.037, 0.2325, 0.282, 0.0018, 2.0], "1000 mL": [0.065, 0.3014, 0.382, 0.0025, 10.0] }
	const BEAKERS = { "250 mL": [0.067, 0.095, 0.0016], "600 mL": [0.087, 0.125, 0.0018], "1000 mL": [0.102, 0.145, 0.002] }

	function build_round(c, P, inner_d, wall_h, t, foot_w, look, mat, noun, default_ml, foot_h = null) {
		_upright(c)
		const fh = foot_h === null ? t : foot_h // its base: a cylinder's stands on a thick foot, its glass bottom on top of that
		const r = inner_d / 2
		const area = Math.PI * r * r
		const cap = area * (wall_h - fh)
		const given = c.item.props ?? {}
		if (!hasOwn(given, "fill_ml")) P.fill_ml = pyRound(default_ml, 1)
		const fill_ml = pymin(P.fill_ml, cap * 1e6)
		const m = c.mat({ base: mat, overrides: {} })
		const foot = pymax(foot_w, inner_d + 2 * t)
		c.slab("floor", foot, fh, foot, 0.0, fh / 2, { kind: "static", material: m, look, words: `the ${noun}'s foot` })
		c.slab("wall-left", t, wall_h - fh, inner_d + 2 * t, -r - t / 2, fh + (wall_h - fh) / 2, { kind: "static", material: m, look, words: `the ${noun}'s wall` })
		c.slab("wall-right", t, wall_h - fh, inner_d + 2 * t, r + t / 2, fh + (wall_h - fh) / 2, { kind: "static", material: m, look, words: `the ${noun}'s wall` })
		_liquid_record(c, -r, r, fh, wall_h, area, fill_ml > 0 ? [_layer(P.liquid, fill_ml / 1e6 / area, P.salt_pct)] : [])
		P.capacity_ml = pyRound(cap * 1e6, 1)
	}

	function build_cylinder(c, P) {
		const [d, , wall_h, t, mark] = CYLINDERS[P.size]
		build_round(c, P, d, wall_h, t, d * 2.6, "glass", "glass", "cylinder", 0.6 * parseFloat(P.size.split(" ")[0]), 0.012)
		P.mark_ml = mark
		P.scale_ml = parseFloat(P.size.split(" ")[0])
	}

	register(new ItemType("graduated-cylinder", "Graduated cylinder", "Liquids", build_cylinder, {
		dynamic: false, material: "glass", materials: ["glass"],
		props: [
			new Prop("size", "Size", "100 mL", { kind: "choice", choices: Object.keys(CYLINDERS), help: "100 mL (1 mL marks), 250 mL (2 mL), 1000 mL (10 mL)" }),
			new Prop("fill_ml", "Amount", 60.0, 0.0, 1300.0, 0.5, "mL", "How much liquid is in it (6/10 of its scale until you set it)", { auto: ["size"] }),
			..._liquid_props()
		],
		tags: ["measuring cylinder", "graduated cylinder", "volume", "displacement", "mL", "millilitre", "lab", "measure", "water", "glass"],
		description: "A tall glass measuring cylinder with millilitre marks, fixed upright. Drop something in and the reading rises by its volume " +
			"(what is under the surface): measure a stone's volume by displacement.",
		source: "Class B cylinders: 100 mL is 28.5 mm inside with its 100 mL mark 157 mm up; 250 mL 37 mm; 1000 mL 65 mm (ISO 4788 sizes, approximate).",
		anchor: "the middle of its foot, where it stands", facts: "100 mL, 1 mL marks, 60 mL of water", readouts: _readouts(), module: MODULE
	}))

	function build_beaker(c, P) {
		const [d, h, t] = BEAKERS[P.size]
		build_round(c, P, d, h, t, d + 2 * t, "glass", "glass", "beaker", 0.5 * parseFloat(P.size.split(" ")[0]))
		P.mark_ml = P.size !== "250 mL" ? 50.0 : 25.0
	}

	register(new ItemType("beaker", "Beaker", "Liquids", build_beaker, {
		dynamic: false, material: "glass", materials: ["glass"],
		props: [
			new Prop("size", "Size", "600 mL", { kind: "choice", choices: Object.keys(BEAKERS) }),
			new Prop("fill_ml", "Amount", 300.0, 0.0, 1300.0, 1.0, "mL", "How much liquid is in it (half its size until you set it)", { auto: ["size"] }),
			..._liquid_props()
		],
		tags: ["beaker", "glass", "lab", "water", "liquid", "volume", "mL", "jar"],
		description: "A glass lab beaker with a spout and rough mL marks, fixed upright: hold water to float or sink things in.",
		source: "Griffin low-form beakers: 250 mL 70 × 95 mm, 600 mL 90 × 125 mm, 1000 mL 105 × 145 mm (approximate).",
		anchor: "the middle of its base, where it stands", facts: "600 mL beaker, 300 mL of water", readouts: _readouts(), module: MODULE
	}))

	function build_jug(c, P) {
		build_round(c, P, 0.105, 0.155, 0.003, 0.111, "plastic", "polypropylene", "jug", 500.0)
		P.mark_ml = 50.0
	}

	register(new ItemType("measuring-jug", "Measuring jug", "Liquids", build_jug, {
		dynamic: false, material: "polypropylene", materials: ["polypropylene"],
		props: [new Prop("fill_ml", "Amount", 500.0, 0.0, 1300.0, 5.0, "mL", "How much liquid is in it"), ..._liquid_props()],
		tags: ["measuring cup", "measuring jug", "jug", "kitchen", "water", "volume", "mL", "litre", "pitcher"],
		description: "A 1 litre plastic kitchen measuring jug with 50 mL marks, fixed upright: the level rises as things go in.",
		source: "A 1 L kitchen jug is about 105 mm across inside; 1 L stands about 115 mm deep (approximate).",
		anchor: "the middle of its base, where it stands", facts: "1 L jug, 500 mL of water", readouts: _readouts(), module: MODULE
	}))

	// --- density column: a tall glass jar of liquids that do not mix, the densest at the bottom
	const COLUMNS = {
		"6 layers": ["honey", "corn syrup", "dish soap", "water", "vegetable oil", "rubbing alcohol"],
		"3 layers": ["corn syrup", "water", "vegetable oil"],
		"water and oil": ["water", "vegetable oil"],
		"honey, water, oil": ["honey", "water", "vegetable oil"]
	}

	function build_column(c, P) {
		_upright(c)
		const inner = 0.06
		const H = 0.32
		const t = 0.003
		const r = inner / 2
		const area = Math.PI * r * r
		// (Python's sorted(key=-density) is stable: equal densities keep the list's order)
		const names = COLUMNS[P.layers].map((n, i) => [n, i]).sort((a, b) => -LIQUIDS[a[0]][0] - -LIQUIDS[b[0]][0] || a[1] - b[1]).map(([n]) => n)
		let h = P.layer_ml / 1e6 / area
		const room = (H - t) / names.length
		h = pymin(h, room)
		const m = c.mat({ base: "glass", overrides: {} })
		c.slab("floor", inner + 2 * t, t, inner + 2 * t, 0.0, t / 2, { kind: "static", material: m, look: "glass", words: "the jar's base" })
		c.slab("wall-left", t, H - t, inner + 2 * t, -r - t / 2, t + (H - t) / 2, { kind: "static", material: m, look: "glass", words: "the jar's wall" })
		c.slab("wall-right", t, H - t, inner + 2 * t, r + t / 2, t + (H - t) / 2, { kind: "static", material: m, look: "glass", words: "the jar's wall" })
		_liquid_record(c, -r, r, t, H, area, names.map((n) => _layer(n, h)))
		P.order = names.join(", ")
	}

	register(new ItemType("density-column", "Density column", "Liquids", build_column, {
		dynamic: false, material: "glass", materials: ["glass"],
		props: [
			new Prop("layers", "Liquids", "6 layers", { kind: "choice", choices: Object.keys(COLUMNS),
				help: "6 layers: honey, corn syrup, dish soap, water, vegetable oil, rubbing alcohol (densest at the bottom)" }),
			new Prop("layer_ml", "Each layer", 100.0, 10.0, 200.0, 5.0, "mL")
		],
		tags: ["density", "layers", "rainbow", "honey", "syrup", "oil", "sink or float", "jar", "column", "tower"],
		description: "A tall glass jar of liquids stacked by density, the heaviest at the bottom (honey, syrup, soap, water, oil, alcohol). " +
			"Drop things in: each stops at the layer whose density brackets its own.",
		source: "Densities at 20 °C: honey 1420, corn syrup 1380, dish soap 1050, water 998, oil 920, rubbing alcohol 880 kg/m³ " +
			"(approximate except water). The layers are drawn as not mixing (real water and alcohol do mix if poured fast).",
		anchor: "the middle of its base, where it stands", facts: "6 cm × 32 cm jar, 6 layers of 100 mL", readouts: _readouts().slice(0, 2), module: MODULE
	}))
}

// ---------------------------------------------------------------- floating things
export const SAILS = { none: 0.0, tiny: 48.0, small: 120.0, big: 320.0 } // cm² (6 × 8, 10 × 12, 16 × 20 cm: height 1.25 × width)
export const SAIL_STUFF = { paper: 0.08, plastic: 0.046, cloth: 0.12 } // kg/m²
export const SAIL_TRIM = 45.0 // degrees between the sail and the boat's line (let out halfway: the camera sees it, the wind fills it)
export const SAIL_PUSH = 0.8 // push along the wind / (½ρv²·A) for a square plate at 45° [ORTIZ] (a plate square to the wind: 1.17 [HOE])
const AIR_SIDE_DRAG = 1.05 // the engine's flat-side drag coefficient (tooling/src/sim/physics.ts BOX_DRAG)
const SAIL_THICK = 0.001 // the sail's slab in the side view (m)
export const SAIL_SHAPES = ["square", "triangle"] // how the sail is drawn (render only: web/models/mod-fluids.js; its push is its area's either way)

function _boat_readouts(hull = true) {
	const out = [
		new Readout("submerged", "Under water", { unit: "", digits: 3, help: "Fraction of it under the surface (0 to 1)" }),
		new Readout("afloat", "Floats", { unit: "", digits: 0, help: "1 while the liquid holds it up" }),
		new Readout("draft_mm", "Draft", { unit: "mm", digits: 1, help: "How deep its lowest point is under the surface" }),
		new Readout("buoyancy_n", "Buoyancy", { unit: "N", digits: 3, help: "The liquid's upward push" })
	]
	if (hull)
		out.push(
			new Readout("water_ml", "Water inside", { unit: "mL", digits: 1, help: "Water that has come in over its rim" }),
			new Readout("flooded", "Flooded", { unit: "", digits: 0, help: "1 once it has filled with water" }),
			new Readout("freeboard_mm", "Freeboard", { unit: "mm", digits: 1, help: "Its rim above the surface" })
		)
	return out
}

function _floaters() {
	// --- toy sailboat
	function build_sailboat(c, P) {
		const L = P.hull_length
		const H = pyRound(0.15 * L, 5)
		const B = pyRound(0.3 * L, 5)
		// a long flat bottom (0.78 L at the waterline: a long waterplane keeps the bow up under a big sail), a raked bow, a rounded stern
		let hull = [[-0.45 * L, 0.0], [0.33 * L, 0.0], [0.5 * L, H], [-0.5 * L, H], [-0.5 * L, 0.5 * H], [-0.48 * L, 0.18 * H]]
		hull = _r5(hull)
		const hull_rho = P.hull_mass / (_area(hull) * B)
		const color = colorOf(P.color) || "#c8443a"
		const root = c.poly("hull", hull, B, 0.0, 0.0, { material: c.mat({ base: "pine", density: pyRound(hull_rho, 4) }), look: "hull paint", words: "a toy sailboat's hull", color, fill: color })
		const keel = _r5([[-0.08 * L, -0.07 * L], [0.0, -0.07 * L], [0.06 * L, 0.0], [-0.1 * L, 0.0]])
		_child(c, "keel", root, _poly_body(keel, 0.003), [0.0, 0.0], c.mat({ base: "ABS plastic", overrides: {} }), "plastic", "the boat's keel fin", "#2a2a2a")
		const sail = P.sail
		const given = c.item.props ?? {}
		// its area: the preset's, or the item's own sail_area_cm2 when it sets one (no sail at all with "none")
		let area_cm2
		if (sail === "none") area_cm2 = 0.0
		else if (hasOwn(given, "sail_area_cm2")) area_cm2 = P.sail_area_cm2
		else area_cm2 = SAILS[sail]
		P.sail_area_cm2 = area_cm2
		const mx = pyRound(0.05 * L, 5)
		let mast_h
		if (area_cm2 && area_cm2 > 0) {
			const A = area_cm2 / 1e4
			const w = Math.sqrt(A / 1.25)
			const h = 1.25 * w
			mast_h = h + 0.027
			_child(c, "mast", root, { kind: "slab", width: 0.004, height: pyRound(mast_h, 5), depth: 0.004 }, [mx, H + mast_h / 2],
				c.mat({ base: "varnished hardwood", overrides: {} }), "wood", "the boat's mast")
			// the engine's side drag on the sail slab, ½ρ·1.05·(height × depth)·v², is the push of the real sail set at 45° (0.8·½ρv²·A)
			const depth = (w * SAIL_PUSH) / AIR_SIDE_DRAG
			const mass = SAIL_STUFF[P.sail_material] * A
			const sail_color = colorOf(P.sail_color) || "#f6f3ea"
			_child(c, "sail", root, { kind: "slab", width: SAIL_THICK, height: pyRound(h, 5), depth: pyRound(depth, 5) }, [mx - 0.0025, H + 0.012 + h / 2],
				c.mat({ base: "sail cloth", density: pyRound(mass / (SAIL_THICK * h * depth), 4) }), "sail", "the boat's sail", sail_color)
			P.sail_width = pyRound(w, 4)
			P.sail_height = pyRound(h, 4)
			P.sail_middle = pyRound(H + 0.012 + h / 2, 4) // its middle's height over the boat's anchor: where a fan's axis should be
			c.process("sail", "sail-push", { solid: `${c.item.id}/sail`, area: pyRound(A, 6), push: SAIL_PUSH })
		} else {
			mast_h = 0.0
			P.sail_width = 0.0
			P.sail_height = 0.0
			P.sail_middle = 0.0
		}
		P.mast_height = pyRound(mast_h, 4)
		P.beam = B
	}

	register(new ItemType("sailboat", "Toy sailboat", "Liquids", build_sailboat, {
		material: "pine", materials: ["pine"],
		props: [
			new Prop("hull_length", "Hull length", 0.2, 0.12, 0.4, 0.005, "m"),
			new Prop("hull_mass", "Hull weight", 0.08, 0.02, 0.4, 0.005, "kg", "The hull alone (mast, sail and keel add a few grams)"),
			new Prop("sail", "Sail", "small", { kind: "choice", choices: Object.keys(SAILS),
				help: "tiny 48 cm² (6 × 8 cm), small 120 cm² (10 × 12), big 320 cm² (16 × 20); none: no mast or sail" }),
			new Prop("sail_area_cm2", "Sail area", 120.0, 20.0, 600.0, 5.0, "cm²", "Follows the sail's size until you set it (height 1.25 × width)", { auto: ["sail"] }),
			new Prop("sail_material", "Sail made of", "paper", { kind: "choice", choices: Object.keys(SAIL_STUFF) }),
			new Prop("color", "Hull colour", "red", { kind: "choice", choices: COLOR_NAMES.slice(0, -1) }),
			new Prop("sail_color", "Sail colour", "white", { kind: "choice", choices: COLOR_NAMES.slice(0, -1) }),
			new Prop("sail_shape", "Sail shape", "square", { kind: "choice", choices: SAIL_SHAPES,
				help: "Drawing only: triangle draws a triangular sail of the same area (its luff up the mast 1.5 × the square's height, its foot " +
					"on the boom, its middle where the square's is): the same area, the same push" }),
			new Prop("sail_face_on", "Sail drawn facing you", false, { kind: "bool",
				help: "Drawing only: the sail is drawn square to the camera instead of let out 45° (a sail square to the fan's wind would be " +
					"edge-on to a side camera); its push is the 45° sail's all the same" })
		],
		tags: ["boat", "sailboat", "sail", "toy boat", "regatta", "ship", "yacht", "float", "wind", "fan", "raft"],
		description: "A toy sailboat: a pine hull with a keel fin, a dowel mast and a square sail let out at 45°. Put it in water (a trough or tub) and " +
			"a fan behind it, at the sail's height: the wind on the sail pushes it along; a bigger sail or a nearer, faster fan pushes harder.",
		source: "Rain-gutter regatta hulls are about 18 cm [RGR]. The sail is set 45° to the boat's line: its push along the wind is 0.8 of ½ρv²·A [ORTIZ] " +
			"(1.17 square to the wind [HOE]); its side force is taken by the keel (out of the picture's plane).",
		anchor: "the middle of the hull's flat bottom (its keel hangs below)", facts: "20 cm pine hull, 80 g, 120 cm² paper sail",
		edit: [{ kind: "length", prop: "hull_length" }],
		readouts: [..._boat_readouts(false), new Readout("air_ms", "Wind at the sail", { unit: "m/s", digits: 2 }), new Readout("push_n", "Sail push", { unit: "N", digits: 3 })],
		module: MODULE
	}))

	// --- an open boat of modelling clay (the same clay as the clay ball) and one of aluminium foil
	/** An open tray-shaped boat: a floor and two end walls (sloping out by `flare` per unit of height) welded, the envelope a hull. */
	function open_boat(c, P, L, D, H, flare, t_solid, mass, base, look, noun, color = null) {
		const Lb = L - 2 * flare * H
		const slope = Math.sqrt(1 + flare * flare)
		const tw = t_solid * slope
		const v_floor = Lb * t_solid * D
		const v_wall = tw * H * D
		const rho = mass / (v_floor + 2 * v_wall)
		const m = c.mat({ base, density: pyRound(rho, 4) })
		const root = c.slab("floor", Lb, t_solid, D, 0.0, t_solid / 2, { material: m, look, words: `the ${noun}'s bottom`, ...(color ? { color, fill: color } : {}) })
		const left = [[-Lb / 2, -t_solid / 2], [-Lb / 2 + tw, -t_solid / 2], [-L / 2 + tw, H - t_solid / 2], [-L / 2, H - t_solid / 2]]
		const right = [[Lb / 2 - tw, -t_solid / 2], [Lb / 2, -t_solid / 2], [L / 2, H - t_solid / 2], [L / 2 - tw, H - t_solid / 2]]
		_child(c, "wall-left", root, _poly_body(left, D), [0.0, 0.0], m, look, `the ${noun}'s end`, color)
		_child(c, "wall-right", root, _poly_body(right, D), [0.0, 0.0], m, look, `the ${noun}'s end`, color)
		const env = _r5([[-Lb / 2, -t_solid / 2], [Lb / 2, -t_solid / 2], [L / 2, H - t_solid / 2], [-L / 2, H - t_solid / 2]])
		// (flooded, it displaces only its own material: the real clay's or foil's volume, not its drawn slabs')
		c.process("hull", "hull", { solid: root, points: env.map(([x, y]) => ({ x, y })), rim: [2, 3], depth: pyRound(D, 5), material_ml: pyRound((mass / MATERIALS[base].density) * 1e6, 4) })
		P.inside_ml = pyRound(_area(env) * D * 1e6, 1)
	}

	const CLAY_RHO = 1570.0 // the catalog's modelling clay (machines/items.py "modeling clay")
	const CLAY_WALL = 0.004

	function build_clay_boat(c, P) {
		// proportions L : D : H = 1 : 0.64 : 0.4, ends sloping out 0.5 per unit of height, 4 mm of clay all round (floor, ends, sides):
		// its shell area is 1.5964 L², so L = √(V / (t · 1.5964)) for the clay's volume V = m / ρ
		const V = P.mass / CLAY_RHO
		const k = 0.6 * 0.64 + 2 * 0.4 * Math.sqrt(1.25) * 0.64 + 2 * 0.8 * 0.4
		const L = Math.sqrt(V / (CLAY_WALL * k))
		open_boat(c, P, L, 0.64 * L, 0.4 * L, 0.5, CLAY_WALL, P.mass, "modeling clay", "clay", "clay boat")
		P.length = pyRound(L, 4)
	}

	register(new ItemType("clay-boat", "Clay boat", "Liquids", build_clay_boat, {
		material: "modeling clay", materials: ["modeling clay"],
		props: [new Prop("mass", "Clay", 0.05, 0.02, 0.2, 0.005, "kg", "How much clay; the boat is shaped from it with 4 mm walls (bigger with more clay)")],
		tags: ["clay boat", "plasticine", "boat", "float", "sink", "shape", "hull", "modelling clay", "playdough"],
		description: "Modelling clay shaped into an open boat with 4 mm walls. A ball of the same clay sinks; the boat floats, because its hollow " +
			"hull pushes aside more water than it weighs. If water comes over its rim it floods and sinks.",
		source: "Modelling clay 1570 kg/m³ (the catalog's clay ball). Shell area 1.596 L² for a boat L long, 0.64 L wide, 0.4 L high.",
		anchor: "the middle of its bottom", facts: "50 g of clay: 7 cm long, holds 72 mL", readouts: _boat_readouts(), module: MODULE
	}))

	const FOIL_T = 0.000016 // household aluminium foil, m

	function build_foil_boat(c, P) {
		const L = P.length
		const D = P.width
		const H = P.height
		const sheet = L * D + 2 * H * D + 2 * H * L
		const mass = 2700.0 * FOIL_T * sheet * 1.1 // 10 % more foil in the folded corners
		open_boat(c, P, L, D, H, 0.0, 0.001, mass, "aluminium foil", "foil", "foil boat")
		P.mass = pyRound(mass, 6)
	}

	register(new ItemType("foil-boat", "Foil boat", "Liquids", build_foil_boat, {
		material: "aluminium foil", materials: ["aluminium foil"],
		props: [
			new Prop("length", "Length", 0.07, 0.03, 0.2, 0.005, "m"), new Prop("width", "Front to back", 0.07, 0.03, 0.2, 0.005, "m"),
			new Prop("height", "Side height", 0.015, 0.005, 0.05, 0.001, "m")
		],
		tags: ["foil boat", "aluminium foil", "tin foil", "pennies", "boat", "cargo", "float", "barge", "design challenge"],
		description: "A little tray folded from kitchen foil (about half a gram): it floats, and holds pennies until the water comes over its sides. " +
			"A 7 × 7 × 1.5 cm one can hold about 29 pennies if they are spread evenly.",
		source: "Household foil 0.016 mm of aluminium (2700 kg/m³): a 10 × 10 cm sheet weighs 0.43 g. Capacity (ρV − m)/2.5 g per penny [USMINT].",
		anchor: "the middle of its bottom", facts: "7 × 7 × 1.5 cm, 0.4 g, holds 73.5 mL", readouts: _boat_readouts(), module: MODULE
	}))
}

function _things() {
	function build_penny(c, P) {
		const n = Math.trunc(P.count)
		c.slab("coin", 0.01905, pyRound(0.00152 * n, 5), 0.01905, 0.0, 0.0, {
			material: c.mat({ density: pyRound(0.0025 / (0.01905 * 0.00152 * 0.01905), 4) }), look: "copper", words: n === 1 ? "a penny" : `a stack of ${n} pennies`
		})
		P.mass = pyRound(0.0025 * n, 4)
	}

	register(new ItemType("penny", "Penny", "Liquids", build_penny, {
		material: "copper-plated zinc", materials: ["copper-plated zinc"],
		props: [new Prop("count", "Pennies", 1, 1, 100, 1, "", "How many in the stack (one solid stack: a boat's cargo)", { kind: "int" })],
		tags: ["penny", "cent", "coin", "cargo", "weight", "money", "copper", "stack of pennies"],
		description: "A U.S. penny lying flat, or a neat stack of them (count): 2.5 g each. Load a foil or clay boat with stacks of pennies until it sinks.",
		source: "2.500 g, 19.05 mm across, 1.52 mm thick [USMINT].", anchor: "its centre", facts: "19 mm · 2.5 g each",
		edit: [{ kind: "rotate" }], module: MODULE
	}))

	function build_grape(c, P) {
		const r = P.diameter / 2
		c.ball("grape", r, 0.0, 0.0, { material: c.mat(), look: "grape", words: "a grape" })
	}

	register(new ItemType("grape", "Grape", "Liquids", build_grape, {
		material: "grape", materials: ["grape"],
		props: [new Prop("diameter", "Diameter", 0.02, 0.01, 0.03, 0.001, "m")],
		tags: ["grape", "fruit", "density", "sink", "float", "berry"],
		description: "A grape, a little denser than water: it sinks in water and floats on syrup or very salty water.",
		source: "About 1.06 g/cm³ (approximate); a table grape is about 2 cm.", anchor: "its centre", facts: "2 cm · 4.4 g",
		edit: [{ kind: "radius", prop: "diameter" }], module: MODULE
	}))

	function build_cork(c, P) {
		const r = P.diameter / 2
		const L = P.length
		const rho = MATERIALS.cork.density
		if (P.lying === "across") {
			// its length across the picture (mod_fluids.py): a slab L × D, π/4 × D deep (outline × depth = its true volume), drawn round
			c.slab("cork", L, 2 * r, pyRound((Math.PI / 4) * 2 * r, 5), 0.0, 0.0, { material: c.mat(), look: "cork", words: "a cork" })
			return
		}
		c.ball("cork", r, 0.0, 0.0, { material: c.mat({ density: pyRound((rho * 3 * L) / (4 * r), 4) }), inertia: 0.5, shape: "cylinder", length: L, look: "cork", words: "a wine cork" })
	}

	register(new ItemType("cork", "Cork", "Liquids", build_cork, {
		material: "cork", materials: ["cork"],
		props: [new Prop("diameter", "Diameter", 0.024, 0.015, 0.06, 0.001, "m", "A wine cork is 24 mm; a big jar's or a bobber's up to 6 cm"),
			new Prop("length", "Length", 0.044, 0.02, 0.1, 0.001, "m", "A wine cork is 44 mm"),
			new Prop("lying", "Its length runs", "front to back", { kind: "choice", choices: ["front to back", "across"],
				help: "front to back: the side camera sees its round end (it rolls); across: left to right, the camera sees its side" })],
		tags: ["cork", "stopper", "wine cork", "float", "light", "bobber"],
		description: "A wine cork lying on its side: very light, it floats high on any liquid (a fifth of it under water). Set its size; " +
			"lying across, the side camera sees its side instead of its round end.",
		source: "A wine cork is 24 mm across and 44 mm long; cork is about 200 kg/m³.", anchor: "its centre", facts: "24 × 44 mm · 4 g",
		module: MODULE
	}))

	function build_bead(c, P) {
		c.ball("bead", 0.004, 0.0, 0.0, { material: c.mat(), look: "bead", words: "a plastic bead" })
	}

	register(new ItemType("plastic-bead", "Plastic bead", "Liquids", build_bead, {
		material: "polyethylene", materials: ["polyethylene"],
		props: [], tags: ["bead", "plastic", "pony bead", "density", "float", "sink"],
		description: "A small polyethylene bead (8 mm): it floats on water but sinks in oil, so in a density column it rests where the oil meets the water.",
		source: "High-density polyethylene 950 kg/m³.", anchor: "its centre", facts: "8 mm · 0.25 g", module: MODULE
	}))

	function build_pebble(c, P) {
		const w = P.width
		const h = P.height
		const pts = [[-0.5 * w, -0.18 * h], [-0.34 * w, -0.5 * h], [0.3 * w, -0.5 * h], [0.5 * w, -0.12 * h], [0.42 * w, 0.32 * h], [0.12 * w, 0.5 * h],
			[-0.3 * w, 0.46 * h], [-0.48 * w, 0.2 * h]]
		c.poly("stone", _r5(pts), pyRound(0.8 * w, 5), 0.0, 0.0, { material: c.mat(), look: "stone", words: "a pebble" })
	}

	register(new ItemType("pebble", "Pebble", "Liquids", build_pebble, {
		material: "granite", materials: ["granite", "brick"],
		props: [new Prop("width", "Width", 0.04, 0.01, 0.15, 0.001, "m"), new Prop("height", "Height", 0.026, 0.006, 0.1, 0.001, "m")],
		tags: ["rock", "stone", "pebble", "sink", "displacement", "volume", "heavy"],
		description: "A smooth river pebble of granite: it sinks, and the water it pushes aside measures its volume.",
		source: "Granite 2650 kg/m³; front to back 0.8 × its width.", anchor: "its centre", facts: "4 × 2.6 cm · 68 g",
		edit: [{ kind: "size", w: "width", h: "height" }, { kind: "rotate" }], module: MODULE
	}))
}

function _air() {
	function build_breeze(c, P) {
		_upright(c)
		const right = P.direction === "to the right"
		const steel = c.mat({ base: "steel", overrides: {} })
		c.slab("base", 0.12, 0.012, 0.12, 0.0, 0.006, { kind: "static", material: steel, look: "steel", words: "the wind sock's stand" })
		c.slab("pole", 0.01, 0.5, 0.01, 0.0, 0.262, { kind: "static", material: steel, look: "steel", words: "the wind sock's pole" })
		const [x, y] = c.world(0.0, 0.0)
		c.sb.animated.push({
			kind: "animated", id: `${c.item.id}/wind`, words: "a steady breeze", sprite: "breeze", item: c.item.id,
			vector: [{ id: "wind", tag: "rect", attrs: { x: 0, y: 0, width: 0.01, height: 0.01, fill: "none" } }],
			at: { x: pyRound(x, 5), y: pyRound(y, 5) }, keys: [{ t: 0.0, angle: 0.0 }],
			// a stream 20 m across: within ±2 m of its axis its speed is within 3 % of the setting, for 124 m downwind (the engine's jet model)
			airflow: { from: P.on_at, at: { x: 0.0, y: 0.8 }, direction: right ? 0.0 : pyRound(Math.PI, 6), diameter: 20.0, speed: P.speed,
				source: "A steady wind: the engine's round jet made 20 m across, so it is even over the whole table." },
			depth: 3
		})
	}

	register(new ItemType("breeze", "Breeze", "Air", build_breeze, {
		dynamic: false, material: "steel", materials: ["steel"],
		props: [
			new Prop("speed", "Wind speed", 3.0, 0.0, 15.0, 0.5, "m/s", "A light breeze is 2-3 m/s, a strong one 10 m/s"),
			new Prop("direction", "Blows", "to the right", { kind: "choice", choices: ["to the right", "to the left"] }),
			new Prop("on_at", "Starts at", 0.0, 0.0, 10.0, 0.1, "s")
		],
		tags: ["wind", "breeze", "weather", "outdoor", "gust", "wind sock", "air"],
		description: "A steady wind across the whole scene, from where its wind sock stands: it pushes sails, light balls and anything light " +
			"downwind (nothing behind the sock). Put it at the scene's upwind edge.",
		source: "Beaufort scale: a light breeze 1.6-3.3 m/s, a gentle breeze 3.4-5.4 m/s.", anchor: "the middle of its stand's foot",
		facts: "3 m/s to the right", module: MODULE
	}))
}

// ---------------------------------------------------------------- surface tension (machines/mod_fluids.py: the same table and items)
// liquid -> [surface tension N/m, the largest contact angle it makes on ordinary solids (degrees)], at 20 °C [IAPWS-ST] (the others approximate)
export const TENSION = {
	water: [0.0728, 180.0], "sea water": [0.0738, 180.0], "vegetable oil": [0.032, 15.0], "corn syrup": [0.075, 180.0], honey: [0.055, 90.0],
	"dish soap": [0.03, 25.0], "rubbing alcohol": [0.025, 10.0], milk: [0.047, 90.0], "chocolate milk": [0.046, 90.0]
}
export const SOAPY = [0.03, 25.0] // water with dish soap on it: 25-35 mN/m; it wets steel (provisional)
export const SOAP_SPREAD = 0.12 // m at 1 s: the soap film's edge runs out as SOAP_SPREAD·t^(3/4) [JENSEN] (the magnitude provisional)
export const CLIP_WIRE = 0.097 // m of 0.9 mm wire in a Gem No. 1 paper clip (the magnetism module's paper-clip, 0.45 g)
export const CLIP_THETA = 80.0 // degrees: water on a paper clip's lightly oiled steel wire, 70-90° (provisional)
// types whose parts the surface holds up when laid gently -> [the parts' names start with, contact line per part (m), contact angle with water]
export const SURFACE_TYPES = { "paper-clip": ["clip", 0.194, CLIP_THETA] } // (0.194: round(2 × CLIP_WIRE, 5), as the Python)
const GLASS_THETA = 0.0 // clean glass and water [ADAMSON]
// paper -> [Washburn coefficient D for water (m²/s: h² = D·t), the highest it climbs (m), its thickness (m)] [WASHBURN] (approximate)
export const PAPERS = { "filter paper": [1.1e-5, 0.25, 0.00018], "paper towel": [4.0e-5, 0.15, 0.0003], "printer paper": [3.0e-7, 0.04, 0.0001] }

/** [surface tension N/m, the largest contact angle it allows] of a liquid layer by its words (salt water by its salt [WEISSENBORN]). */
export function tension_of(words) {
	if (words.startsWith("salt water (")) {
		const pct = parseFloat(words.slice("salt water (".length, words.indexOf(" %")))
		const p = pymin(SALT_MAX, pymax(0.0, pct))
		const molal = ((p / (100.0 - p)) * 1000.0) / 58.44
		return [pyRound(0.0728 + 0.00164 * molal, 5), 180.0]
	}
	return hasOwn(TENSION, words) ? TENSION[words] : TENSION.water
}

function _surface() {
	function build_soap(c, P) {
		_upright(c)
		const glass = c.mat({ base: "glass", overrides: {} })
		c.slab("dropper", 0.008, 0.08, 0.008, 0.0, 0.04, { kind: "static", material: glass, look: "glass", words: "a dropper of dish soap", ghost: true })
		const [x, y] = c.world(0.0, 0.0)
		c.process("soap", "soap", { x: pyRound(x, 5), y: pyRound(y, 5), at: P.at_s, tension: SOAPY[0], wets: SOAPY[1], spread: SOAP_SPREAD })
	}

	register(new ItemType("soap-drop", "Drop of soap", "Liquids", build_soap, {
		dynamic: false, material: "glass", materials: ["glass"],
		props: [new Prop("at_s", "Drops at", 1.0, 0.0, 20.0, 0.1, "s", "When the drop of dish soap falls from the dropper")],
		tags: ["soap", "dish soap", "detergent", "surface tension", "soap boat", "pepper and soap", "dropper", "surfactant", "marangoni"],
		description: "A dropper held over the water lets fall one drop of dish soap: where it lands the surface tension drops from 73 to about " +
			"30 mN/m and the soap spreads out fast. A paper clip the surface held sinks; a light boat with the soap behind it is pulled " +
			"forward by the clean water's stronger surface (a soap-powered boat).",
		source: "Soapy water 25-35 mN/m (approximate); it spreads as 0.12·t^(3/4) m [JENSEN] (provisional). The pull on a boat is the " +
			"difference in surface tension times its width at the water line.",
		anchor: "the dropper's tip (the drop falls straight down from it)", facts: "one drop at 1 s",
		readouts: [new Readout("spread_cm", "Soap spread", { unit: "cm", digits: 1, help: "How far the soap film has run out from where it landed" }),
			new Readout("landed", "Landed", { unit: "", digits: 0, help: "1 once the drop is on the water" })],
		module: MODULE
	}))

	function build_capillary(c, P) {
		_upright(c)
		const r = P.bore_mm / 2000
		const L = P.length
		const out = pyRound(2 * r + 0.002, 5)
		c.slab("tube", out, L, out, 0.0, L / 2, { kind: "static", material: c.mat({ base: "glass", overrides: {} }), look: "glass", words: "a thin glass tube", ghost: true })
		const [x, y] = c.world(0.0, 0.0)
		c.process("capillary", "rise", { x: pyRound(x, 5), bottom: pyRound(y, 5), top: pyRound(y + L, 5), r: pyRound(r, 7), theta: GLASS_THETA })
		P.jurin_mm = pyRound(((2 * 0.0728) / (998.2 * 9.81 * r)) * 1000, 1)
	}

	register(new ItemType("capillary-tube", "Capillary tube", "Liquids", build_capillary, {
		dynamic: false, material: "glass", materials: ["glass"],
		props: [new Prop("bore_mm", "Inside width", 1.0, 0.3, 4.0, 0.1, "mm", "The thinner the tube, the higher water climbs it"),
			new Prop("length", "Length", 0.15, 0.05, 0.4, 0.005, "m")],
		tags: ["capillary", "capillary action", "thin tube", "straw", "adhesion", "cohesion", "surface tension", "meniscus", "glass tube"],
		description: "A thin glass tube held upright with its lower end in a liquid: water climbs inside it above the outside surface, " +
			"higher the thinner the tube (Jurin's law: about 30 mm in a 1 mm tube, 7 mm in a 4 mm one). Hold it in the air (a stand " +
			"holds it) with its bottom end 1-3 cm under the surface.",
		source: "Jurin's law h = 2γ·cosθ/(ρ·g·r) [ADAMSON]: water in clean glass (θ 0) climbs 29.7 mm in a 1 mm bore; it climbs at the " +
			"Washburn rate, viscosity against the pull, never faster than √(2γ/(ρr)).",
		anchor: "its bottom end", facts: "1 mm bore, 15 cm long", readouts: [new Readout("rise_mm", "Rise", { unit: "mm", digits: 1, help: "How far the liquid inside stands above the outside surface" })],
		module: MODULE
	}))

	function build_strip(c, P) {
		_upright(c)
		const L = P.length
		const w = P.width
		const [D, hmax, thick] = PAPERS[P.paper]
		c.slab("strip", w, L, thick, 0.0, L / 2, { kind: "static", material: c.mat({ base: "paper strip", overrides: {} }), look: "paper", words: `a strip of ${P.paper}`, ghost: true })
		const [x, y] = c.world(0.0, 0.0)
		c.process("wick", "wick", { x: pyRound(x, 5), bottom: pyRound(y, 5), top: pyRound(y + L, 5), D, hmax })
	}

	register(new ItemType("paper-strip", "Paper strip", "Liquids", build_strip, {
		dynamic: false, material: "paper strip", materials: ["paper strip"],
		props: [new Prop("paper", "Paper", "paper towel", { kind: "choice", choices: Object.keys(PAPERS),
			help: "paper towel climbs fastest; filter paper (chromatography) steadily; printer paper is sized and barely wicks" }),
		new Prop("length", "Length", 0.15, 0.05, 0.3, 0.005, "m"), new Prop("width", "Width", 0.02, 0.005, 0.06, 0.001, "m")],
		tags: ["paper towel", "filter paper", "wick", "capillary action", "chromatography", "walking water", "paper strip", "absorb"],
		description: "A strip of paper hung with its lower end in a liquid: the liquid climbs up it through the paper's fibres (capillary " +
			"action), fast at first and slower as it rises. Hold it in the air (a clip holds it) with its bottom end under the surface.",
		source: "Lucas-Washburn h² = D·t [WASHBURN]: paper towel about 4 × 10⁻⁵, filter paper 1.1 × 10⁻⁵, printer paper 3 × 10⁻⁷ m²/s for " +
			"water (approximate), D going as γ·cosθ/μ for other liquids (syrup and honey creep).",
		anchor: "its bottom end", facts: "paper towel, 2 × 15 cm", readouts: [new Readout("wet_mm", "Wet to", { unit: "mm", digits: 1, help: "How far above the surface the liquid has climbed" })],
		module: MODULE
	}))
}

// ---------------------------------------------------------------- goals (machines/mod_fluids.py reports the same, number for number)
const last = (ctx, iid, key) => {
	const v = ctx.state(iid, key)
	return v && v.length ? v[v.length - 1] : null
}

export function floats(ctx, g) {
	if (!ctx.known(g.item)) return null
	const a = last(ctx, g.item, "afloat")
	const sub = last(ctx, g.item, "submerged")
	return { label: g.label || `${ctx.name(g.item)} floats`, ok: a === 1, kind: "floats", item: g.item, submerged: sub === null ? null : pyRound(sub, 3) }
}

export function sinks(ctx, g) {
	if (!ctx.known(g.item)) return null
	const s = last(ctx, g.item, "sunk")
	const sub = last(ctx, g.item, "submerged")
	return { label: g.label || `${ctx.name(g.item)} sinks to the bottom`, ok: s === 1, kind: "sinks", item: g.item, submerged: sub === null ? null : pyRound(sub, 3) }
}

export function level(ctx, g) {
	if (!ctx.known(g.container)) return null
	const lo = ctx.num(g.at_least_ml)
	const hi = ctx.num(g.at_most_ml)
	const v = last(ctx, g.container, "volume_ml")
	const ok = v !== null && (lo === null || v >= lo - 1e-9) && (hi === null || v <= hi + 1e-9)
	const bounds = (lo !== null ? ` at least ${_num_text(lo)} mL` : "") + (hi !== null ? ` at most ${_num_text(hi)} mL` : "")
	return { label: g.label || `${ctx.name(g.container)} reads${bounds || " a level"}`, ok, kind: "level", container: g.container, ml: v === null ? null : pyRound(v, 1) }
}

/** It floats first and only then sinks, resting on the bottom at the end (by by_s when given): a cup a tap fills until it goes under, a boat loaded
 *  until it floods; never met by a thing that sank from the start. */
export function floats_then_sinks(ctx, g) {
	if (!ctx.known(g.item)) return null
	const by = ctx.num(g.by_s)
	const a = ctx.state(g.item, "afloat") ?? []
	const s = ctx.state(g.item, "sunk") ?? []
	let t_float = null
	let t_sink = null
	const n = Math.min(ctx.times.length, a.length, s.length)
	for (let k = 0; k < n; k++) {
		if (t_float === null) {
			if (a[k] === 1) t_float = ctx.times[k]
		} else if (t_sink === null && s[k] === 1) t_sink = ctx.times[k]
	}
	const ok = t_float !== null && t_sink !== null && s.length > 0 && s[s.length - 1] === 1 && (by === null || t_sink <= by + 1e-9)
	const fl = last(ctx, g.item, "flooded")
	const name = ctx.name(g.item)
	return {
		label: g.label || `${name} floats, then fills and sinks${by !== null ? ` by ${_num_text(by)} s` : ""}`, ok,
		kind: "floats_then_sinks", item: g.item, floated_s: t_float === null ? null : pyRound(t_float, 3),
		sank_s: t_sink === null ? null : pyRound(t_sink, 3), flooded: fl === null ? null : fl === 1
	}
}

const rise_of = (ctx, iid) => {
	const v = last(ctx, iid, "rise_mm")
	return v !== null ? v : last(ctx, iid, "wet_mm")
}

export function climbs(ctx, g) {
	if (!ctx.known(g.item)) return null
	const lo = ctx.num(g.at_least_mm)
	const hi = ctx.num(g.at_most_mm)
	const v = rise_of(ctx, g.item)
	const ok = v !== null && v > 0.05 && (lo === null || v >= lo - 1e-9) && (hi === null || v <= hi + 1e-9)
	const bounds = (lo !== null ? ` at least ${_num_text(lo)} mm` : "") + (hi !== null ? ` at most ${_num_text(hi)} mm` : "")
	return { label: g.label || `the liquid climbs ${ctx.name(g.item)}${bounds}`, ok, kind: "climbs", item: g.item, mm: v === null ? null : pyRound(v, 1) }
}

export function climbs_higher(ctx, g) {
	if (!ctx.known(g.a) || !ctx.known(g.b)) return null
	const a = rise_of(ctx, g.a)
	const b = rise_of(ctx, g.b)
	const ok = a !== null && b !== null && a > b + 0.05
	return {
		label: g.label || `the liquid climbs ${ctx.name(g.a)} higher than ${ctx.name(g.b)}`, ok, kind: "climbs_higher", a: g.a, b: g.b,
		a_mm: a === null ? null : pyRound(a, 1), b_mm: b === null ? null : pyRound(b, 1)
	}
}

function _goals() {
	register_goal_kind("floats", floats)
	register_goal_kind("sinks", sinks)
	register_goal_kind("level", level)
	register_goal_kind("floats_then_sinks", floats_then_sinks)
	register_goal_kind("climbs", climbs)
	register_goal_kind("climbs_higher", climbs_higher)
}

// ================================================================ the AI's view of the module (web/sim/plugins.js)
const CONTAINER_TYPES = ["water-tank", "graduated-cylinder", "beaker", "measuring-jug", "density-column"]
const FLOATERS = ["sailboat", "clay-boat", "foil-boat", "penny", "grape", "cork", "plastic-bead", "pebble"]
const trimNum = (v, d = 2) => {
	const s = Number(v).toFixed(d)
	return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s
}
/** The density (kg/m³) of a container's liquid choice (salt water by its salt %). */
export function liquidDensity(name, pct = 10.0) {
	if (name === "salt water") return salt_water(pct)[0]
	return Object.prototype.hasOwnProperty.call(LIQUIDS, name) ? LIQUIDS[name][0] : null
}
const liquidWords = (name, pct) => (name === "salt water" ? `salt water (${trimNum(pct, 1)} % salt)` : name)
/** A whole run's per-item reading at its end, or null. */
const endOf = (run, id, key) => {
	const v = run?.track?.state?.[id]?.[key]
	return Array.isArray(v) && v.length ? v[v.length - 1] : null
}
const startOf = (run, id, key) => {
	const v = run?.track?.state?.[id]?.[key]
	return Array.isArray(v) && v.length ? v[0] : null
}
/** An item's mass and outer volume from the run's document (its solids: density × volume; a hull's envelope counts as its outer volume). */
function massAndVolume(doc, id) {
	let m = 0
	let v = 0
	for (const s of doc?.solids ?? []) {
		if (s.item !== id || s.kind !== "dynamic") continue
		const b = s.body
		const vol =
			b.kind === "ball"
				? s.shape === "cylinder" && typeof s.length === "number"
					? Math.PI * b.radius * b.radius * s.length
					: (4 / 3) * Math.PI * b.radius ** 3
				: b.kind === "slab"
					? b.width * b.height * b.depth * ((1 + (b.taper ?? 1)) / 2)
					: _shoelace(b.points) * b.depth
		const own = b.kind === "ball" ? (4 / 3) * Math.PI * (b.radius ** 3 - Math.max(0, b.radius - (b.wall ?? b.radius)) ** 3) : vol
		const rho = doc.materials?.[s.material]?.density ?? 0
		m += rho * own
		v += vol
	}
	const hull = (doc?.processes ?? []).find((p) => p.kind === "hull" && p.item === id)
	if (hull) v = _shoelace(hull.points) * hull.depth
	return { mass: m, volume: v }
}
function _shoelace(pts) {
	let s = 0
	for (let i = 0; i < pts.length; i++) {
		const p = pts[i]
		const q = pts[(i + 1) % pts.length]
		s += p.x * q.y - q.x * p.y
	}
	return Math.abs(s) / 2
}
const cm = (m) => `${trimNum(m * 100, 1)} cm`

export const plugin = {
	title: "Liquids: floating, sinking, displacement, boats and sails, surface tension and capillary action",
	howto: [
		"Liquid containers are FIXED in place (static): water-tank (style aquarium: glass, 50 cm long inside, 30 cm walls, 20.6 cm of water; tub: plastic, 60 × 18 cm; trough: a 3.05 m white rain-gutter lane 12 cm front to back, 10 cm walls, 8.2 cm of water, for boat races), graduated-cylinder (100/250/1000 mL, read in mL), beaker, measuring-jug (1 L) and density-column (liquids stacked by density). Their anchor is the middle of the base where they stand; they hold `fill` m (tank) or `fill_ml` mL of `liquid` from the start.",
		"Liquids at 20 °C: water 998 kg/m³; salt water by salt_pct (4 % 1027, 10 % 1071, 12 % 1086, 20 % 1148, 26 % 1197); sea water 1025; vegetable oil 920; corn syrup 1380; honey 1420; dish soap 1050; rubbing alcohol 880.",
		"Put things INTO a container with place {inside: <container id>} (they start floating at their own depth if they float, on the bottom if they sink). ANY moving item floats when its average density (mass ÷ outer volume) is below the liquid's and sinks otherwise: wooden block (700) floats 70 % under; ice (917) 92 % under; apple, cork, foam, ping-pong and tennis balls, plastic ball float; steel ball, marble, coin, penny, pebble, brick, clay ball, golf ball sink; an egg (1030 in this catalog) sinks in water and floats in salt water of 6 % or more; a grape (1060) sinks in water, floats in 10 % salt water. A clay-boat floats on its hollow hull (a clay-ball of the same clay sinks); a foil-boat carries pennies (2.5 g each; a 7 × 7 × 1.5 cm one about 29) until water comes over its rim, then floods and sinks. The level rises by the volume pushed under: a graduated cylinder's reading measures an object's volume (60 mL + a 16 mm marble = 62.1 mL).",
		"Open vessels (coffee-mug, bowl) put in a liquid float as hollow hulls on their outer volume up to the rim: a bowl (wide and shallow) floats upright; a mug floats tipped toward its handle (a light one on its side, as a real light cup does). What fills them adds to their weight: a tap or a pitcher (flow module) over a floating bowl, or a hose run from a raised beaker into it, fills it (the stream lands in the bowl, never in the tank's water round it) until its rim reaches the water, then it floods and sinks (melamine, ceramic, glass, aluminium, paperboard sink; foam stays up): goal floats_then_sinks {item}; put the tap's mouth straight over the bowl's middle, 10-25 cm above its rim. The catalog's cup, plastic-cup, glass-jar, bucket and box are FIXED in place: they never float.",
		"Boats and sails: a sailboat floats in a tank (trough or tub) and is pushed by a fan BEHIND it (the fan faces +x, angle 0, its front face 5-90 cm behind the stern; nothing in between) or by a breeze (a steady wind over the whole scene from its wind sock: put it at the upwind edge). The fan's anchor is the middle of its FRONT face; put that at the height of the sail's middle (a default boat in a default trough standing on the table: y ≈ 0.18 for a small sail, 0.16 tiny, 0.22 big; add the trough's own y if it is raised; a sailboat's resolved sail_middle is that height over its anchor): a fan lower or higher than the sail misses it. Sails: tiny 48 cm², small 120, big 320 (or set sail_area_cm2, 20-600 cm²); push = 0.8 × ½·1.2·A·(air speed − boat speed)²: bigger sail, faster or nearer fan → more push. A fan's jet keeps its full speed for 5.6 fan diameters (6.2 diameters of its 0.9-wide stream), then weakens as 1/distance: with the default 0.30 m fan any distance under 1.67 m gives the SAME push, so to compare a near and a far fan use small fans (diameter 0.12 m: full speed to 0.67 m) and put the far one 0.9 m or more behind its sail. To compare two boats side by side, give each its own lane: two troughs (each with its boat and fan), one on the table (y 0) and one fixed above it (y 0.35), identical but for the one thing compared.",
		"Surface tension (water 72.8 mN/m; soapy water about 30): a paper-clip (the magnetism module's, 0.45 g of steel) put INSIDE a water container with place {inside: <container>} is laid gently on the surface and floats, held in a little dent (the surface pulls up to γ·sinθ per metre of its wire's contact line: 13.9 mN for water, its weight is 4.4 mN); dropped from above (on: air) it breaks through and sinks. A soap-drop (a dropper held over the water, its anchor the dropper's tip: place on: air 5-10 cm over the surface; at_s: when the drop falls; a stand behind the container holds it) lowers the surface tension where it lands, and the soap film spreads out (about 12 cm in the first second, 0.12·t^0.75 m): a clip the surface held sinks once the soap reaches it; a light boat (foil-boat) with the drop 2-4 cm behind its stern is pulled forward by the clean surface ahead (a soap-powered boat: about 8 cm/s, 30-40 cm in 5 s); goals sinks/floats {clip}, moves {boat, min_m}. Capillary action: a capillary-tube (bore_mm 0.3-4) or a paper-strip (paper towel, filter paper, printer paper), each a FIXED item held by a stand the view draws: place it on: air with its anchor (its BOTTOM end) 1-3 cm under the liquid's surface (y_m = the surface's y − 0.02); the liquid climbs a 1 mm tube 29.7 mm above the outside surface in about half a second, a 4 mm tube 7.4 mm (Jurin: h = 2γ/(ρgr), thinner climbs higher; soapy water half as high); paper towel wicks about 1 cm in 3 s and 1.5 cm in 6 s (h² = D·t, D 4e-5 m²/s; filter paper 1.1e-5, printer paper hardly at all). Goals climbs {item, at_least_mm?} (rise_mm or wet_mm at the end) and climbs_higher {a, b}.",
		"Readings each run: a container's level_mm, volume_ml (its scale's reading) and spilled_ml; an item in a liquid: submerged (0-1), afloat (1/0), sunk (1/0), draft_mm, buoyancy_n; a boat's freeboard_mm and flooded; a sailboat's air_ms (wind at its sail) and push_n.",
		"For a lesson picture: a sailboat's sail_shape triangle (a triangular sail of the same area) and sail_face_on (the sail drawn square to the camera) are drawing only, the push the same; a cork's diameter and length are its size (a wine cork 24 × 44 mm; a bigger one floats as deep, a fifth under) and lying across shows the camera its side instead of its round end."
	].join(" "),
	prompt: {
		plan: [
			"Liquids: containers (water-tank, graduated-cylinder, beaker, measuring-jug, density-column) are fixed; set their `liquid` and `fill` / `fill_ml` / `salt_pct` props and put floating or sinking things in with place {inside: <container id>} (the solver starts a floater at its own floating depth and a sinker on the bottom). Never put a fixed item in a liquid to make it float.",
			"Sailboat lessons: each boat in its own trough (style \"trough\"), a fan behind it facing +x with its front-face anchor at the sail's middle height (trough on the table: y 0.18 small sail, 0.16 tiny, 0.22 big). To compare fan distances use fan diameter 0.12 and distances 0.15 m vs 0.9 m (the jet is full strength for 5.6 fan diameters). Compare things in separate identical lanes (a second trough fixed above the first at y 0.35, its fan's y + 0.35). Goals: floats {item}, sinks {item}, level {container, at_least_ml?, at_most_ml?}, floats_then_sinks {item} (it floats first, then fills or is loaded and sinks: never met by a thing that sank at once), and to compare boats measure's farther {a, b} or moves {item, min_m}.",
			"Surface tension and capillary action: a paper-clip put INSIDE a water container (place {inside: <container id>}) is laid gently and floats on the surface; a soap-drop held over the water (on: air, its anchor the dropper's tip 5-10 cm over the surface, at_s the time) sinks it once its film spreads to it, or pushes a foil-boat it lands 2-4 cm behind; capillary-tube and paper-strip are fixed, held by stands: put each on: air with its bottom end 1-3 cm under the surface. Goals climbs {item, at_least_mm?}, climbs_higher {a, b}.",
			"A floating cup that fills until it sinks: a bowl (material melamine) put inside a water-tank, filled by a tap (flow module: on: air, its mouth straight over the bowl's middle, 10-25 cm above its rim) or by a hose from a beaker raised on a shelf (a plank with legs, on: air at y_m 0.3); the catalog's cup and plastic-cup are fixed and cannot float. A sailboat's sail_area_cm2, once set, is its sail's size whatever `sail` says."
		].join("\n"),
		edit: "Liquids: change what is in a container with its props (liquid, salt_pct, fill / fill_ml); a sailboat's push with its sail (tiny/small/big, or sail_area_cm2: once sail_area_cm2 is set it is the size whatever `sail` says, so to change a sail's size set both: sail_area_cm2 48 tiny, 120 small, 320 big) or the fan's speed, diameter or distance (inside 5.6 fan diameters the jet is equally strong: moving a big fan nearer changes nothing). Things float or sink by density: to make a sinker float, raise the liquid's density (salt) or shape it as a boat; to sink a boat, load it (pennies) until it floods.",
		refine: "Liquids: a floater should end floating (afloat 1, partly above the surface) and a sinker on the bottom (sunk 1); a sailboat's fan must face its sail at the sail's height (reading air_ms well above 0 at the start). Fix a failing float/sink goal with the liquid's density (salt_pct, liquid) or the item, never by fixing the item in place."
	},
	examples: [
		{ ask: "Show how deep a wooden block floats in an aquarium of water (F1).", how: "a water-tank style aquarium ON the table, a 10 × 5 × 5 cm wooden-block (700 kg/m³) placed inside it (the solver starts it at its floating height: 70 % under, 35 mm); goal floats {block}; the edit digest reads its draft and % under", plan: { items: [{ id: "tank", type: "water-tank", props: { style: "aquarium" }, place: { on: "table", x: 1.2 } }, { id: "block", type: "wooden-block", props: { width: 0.1, height: 0.05, depth: 0.05 }, place: { inside: "tank", on: "tank" } }], goals: [{ kind: "floats", item: "block" }] } },
		{ ask: "Does ice float the same in fresh water and in sea water? (F2)", how: "two small aquariums side by side (length 0.25): one {liquid water}, one {liquid sea water} (1024.8 kg/m³); a 4 cm ice-cube placed inside each (91.9 % under in fresh water, 89.5 % in sea water); goals floats {each ice cube}; the edit digest reads each one's % under", plan: { items: [{ id: "fresh", type: "water-tank", name: "Fresh water", props: { style: "aquarium", length: 0.25, liquid: "water" }, place: { on: "table", x: 0.8 } }, { id: "sea", type: "water-tank", name: "Sea water", props: { style: "aquarium", length: 0.25, liquid: "sea water" }, place: { on: "table", x: 1.5 } }, { id: "ice1", type: "ice-cube", name: "Ice in fresh water", place: { inside: "fresh", on: "fresh" } }, { id: "ice2", type: "ice-cube", name: "Ice in sea water", place: { inside: "sea", on: "sea" } }], goals: [{ kind: "floats", item: "ice1" }, { kind: "floats", item: "ice2" }] } },
		{ ask: "Sink or float: a steel ball, a rubber duck, an apple and a coin in a tank of water (F4).", how: "one aquarium ON the table; a 1 in steel-ball, a rubber-duck, an apple and a coin-flat each placed inside it, apart (floaters start at their floating height, sinkers on the floor); goals sinks {ball}, floats {duck}, floats {apple}, sinks {coin}: denser than water sinks, lighter floats", plan: { items: [{ id: "tank", type: "water-tank", name: "Aquarium", props: { style: "aquarium" }, place: { on: "table", x: 1.2 } }, { id: "ball", type: "steel-ball", name: "Steel ball", props: { diameter: 0.0254 }, place: { inside: "tank", on: "tank", x: 1.1 } }, { id: "duck", type: "rubber-duck", name: "Rubber duck", place: { inside: "tank", on: "tank", x: 1.3 } }, { id: "apple", type: "apple", name: "Apple", place: { inside: "tank", on: "tank", x: 1.0 } }, { id: "coin", type: "coin-flat", name: "Coin", place: { inside: "tank", on: "tank", x: 1.38 } }], goals: [{ kind: "sinks", item: "ball" }, { kind: "floats", item: "duck" }, { kind: "floats", item: "apple" }, { kind: "sinks", item: "coin" }] } },
		{ ask: "Measure a pebble's volume: drop it into a 100 mL graduated cylinder with 60 mL of water (F5).", how: "a graduated-cylinder {size 100 mL, fill_ml 60} ON the table, a pebble (2 × 1.5 cm) dropped from the air above its mouth; goals sinks {stone} and level {container: cyl, at_least_ml: 62}: the reading rises by exactly the pebble's volume", plan: { items: [{ id: "cyl", type: "graduated-cylinder", props: { size: "100 mL", fill_ml: 60 }, place: { on: "table", x: 1.2 } }, { id: "stone", type: "pebble", props: { width: 0.02, height: 0.015 }, place: { on: "air", x: 1.2, y_m: 0.25 } }], goals: [{ kind: "sinks", item: "stone" }, { kind: "level", container: "cyl", at_least_ml: 62 }] } },
		{ ask: "A clay ball sinks but the same clay shaped as a boat floats (F6).", how: "one aquarium; a clay-ball of 3.93 cm (50 g of clay) and a clay-boat {mass 0.05} (the same 50 g as an open hull) each placed inside it apart; goals sinks {ball}, floats {boat}", plan: { items: [{ id: "tub", type: "water-tank", props: { style: "aquarium", length: 0.6 }, place: { on: "table", x: 1.2 } }, { id: "ball", type: "clay-ball", props: { diameter: 0.0393 }, place: { inside: "tub", on: "tub", x: 1.05 } }, { id: "boat", type: "clay-boat", props: { mass: 0.05 }, place: { inside: "tub", on: "tub", x: 1.35 } }], goals: [{ kind: "sinks", item: "ball" }, { kind: "floats", item: "boat" }] } },
		{ ask: "An egg sinks in tap water but floats in salt water (F7).", how: "two small aquariums side by side (length 0.25): one {liquid water}, one {liquid salt water, salt_pct 12} (1085.7 kg/m³ > the egg's 1080); an egg placed inside each; goals sinks {egg in tap water}, floats {egg in salt water}", plan: { items: [{ id: "fresh", type: "water-tank", props: { style: "aquarium", length: 0.25, liquid: "water" }, place: { on: "table", x: 0.7 } }, { id: "salty", type: "water-tank", props: { style: "aquarium", length: 0.25, liquid: "salt water", salt_pct: 12 }, place: { on: "table", x: 1.5 } }, { id: "egg1", type: "egg", place: { inside: "fresh", on: "fresh" } }, { id: "egg2", type: "egg", place: { inside: "salty", on: "salty" } }], goals: [{ kind: "sinks", item: "egg1" }, { kind: "floats", item: "egg2" }] } },
		{ ask: "How many pennies can a foil boat hold before it sinks? (F8)", how: "an aquarium {length 0.3}, a foil-boat (7 × 7 × 1.5 cm) inside it, pennies ON the boat (one penny item with count N is a stack of N: about 29 fit before its rim reaches the water); goal floats {boat} (or sinks {boat} for an overloaded one)", plan: { items: [{ id: "tank", type: "water-tank", props: { style: "aquarium", length: 0.3 }, place: { on: "table", x: 1.2 } }, { id: "boat", type: "foil-boat", place: { inside: "tank", on: "tank" } }, { id: "p1", type: "penny", place: { on: "boat", x: 1.19 } }, { id: "p2", type: "penny", place: { on: "boat", x: 1.21 } }], goals: [{ kind: "floats", item: "boat" }] } },
		{ ask: "Does a sailboat go farther with the fan near it or far from it? (F9)", how: "two troughs (style trough, 3.05 m) one above the other (the second ON the air 0.35 m up), a sailboat inside each and a SMALL fan {diameter 0.12} behind each at its sail's height: one 0.25 m behind its boat, one 1.0 m (beyond 5.6 fan diameters, so its air is weaker); goal farther {a: near boat, b: far boat}", plan: { items: [{ id: "lane1", type: "water-tank", props: { style: "trough" }, place: { on: "table", x: 1.55 } }, { id: "boat1", type: "sailboat", place: { inside: "lane1", on: "lane1", x: 0.4 } }, { id: "fan1", type: "fan", props: { diameter: 0.12 }, place: { on: "air", x: 0.15, y_m: 0.18 } }, { id: "lane2", type: "water-tank", props: { style: "trough" }, place: { on: "air", x: 1.55, y_m: 0.35 } }, { id: "boat2", type: "sailboat", place: { inside: "lane2", on: "lane2", x: 1.15 } }, { id: "fan2", type: "fan", props: { diameter: 0.12 }, place: { on: "air", x: 0.15, y_m: 0.53 } }], goals: [{ kind: "farther", a: "boat1", b: "boat2" }] } },
		{ ask: "Big sail or small sail: which boat goes farther with the same fan? (F10)", how: "two stacked trough lanes as in F9, the same small fans {diameter 0.12} the same distance behind each boat; one sailboat {sail big} (320 cm²), one {sail small} (120 cm²); goal farther {a: big, b: small}", plan: { items: [{ id: "lane1", type: "water-tank", props: { style: "trough" }, place: { on: "table", x: 1.55 } }, { id: "big", type: "sailboat", props: { sail: "big" }, place: { inside: "lane1", on: "lane1", x: 0.45 } }, { id: "fan1", type: "fan", props: { diameter: 0.12 }, place: { on: "air", x: 0.2, y_m: 0.22 } }, { id: "lane2", type: "water-tank", props: { style: "trough" }, place: { on: "air", x: 1.55, y_m: 0.35 } }, { id: "small", type: "sailboat", props: { sail: "small" }, place: { inside: "lane2", on: "lane2", x: 0.45 } }, { id: "fan2", type: "fan", props: { diameter: 0.12 }, place: { on: "air", x: 0.2, y_m: 0.53 } }], goals: [{ kind: "farther", a: "big", b: "small" }] } },
		{ ask: "A bowl floats in a tank; a hose fills it with water until it sinks (F13).", how: "an aquarium ON the table, a bowl {material melamine} placed inside it (it floats upright, 17 mm deep); a shelf (plank {length 0.3, legs true} on: air at y_m 0.3) beside the tank with a 1000 mL beaker {fill_ml 900} on it; a hose {from: beaker, to: bowl, diameter_mm 10}: the bowl fills (its freeboard falls) until water comes over its rim at about 10 s, then it floods and sinks; goal floats_then_sinks {bowl}, seconds 14", plan: { seconds: 14, items: [{ id: "tank", type: "water-tank", props: { style: "aquarium" }, place: { on: "table", x: 1.45 } }, { id: "bowl", type: "bowl", name: "Bowl", props: { material: "melamine" }, place: { inside: "tank", on: "tank" } }, { id: "shelf", type: "plank", name: "Shelf", props: { length: 0.3, legs: true }, place: { on: "air", x: 0.8, y_m: 0.3 } }, { id: "src", type: "beaker", name: "Beaker of water", props: { size: "1000 mL", fill_ml: 900 }, place: { on: "shelf" } }, { id: "hose", type: "hose", props: { from: "src", to: "bowl", diameter_mm: 10 }, place: { on: "air", x: 1.45, y_m: 0.32 } }], goals: [{ kind: "floats_then_sinks", item: "bowl" }] } },
		{ ask: "A steel paper clip floats on water, until a drop of soap makes it sink (S1).", how: "an aquarium ON the table (water surface at y 0.212), a paper-clip placed inside it (laid on the surface: held by surface tension), a soap-drop on: air 6 cm over the water near the other end with at_s 2; goal sinks {clip} (it floats until about 3.5 s, when the soap's film reaches it); for 'it floats' alone leave the soap out and use floats {clip}", plan: { seconds: 6, items: [{ id: "tank", type: "water-tank", props: { style: "aquarium" }, place: { on: "table", x: 1.2 } }, { id: "clip", type: "paper-clip", name: "Paper clip", place: { inside: "tank", on: "tank", x: 1.1 } }, { id: "soap", type: "soap-drop", props: { at_s: 2 }, place: { on: "air", x: 1.3, y_m: 0.27 } }], goals: [{ kind: "sinks", item: "clip" }] } },
		{ ask: "Make a soap-powered boat (S2).", how: "a glass aquarium ON the table (so the boat shows; surface at y 0.212), a foil-boat placed inside it near the left end, a soap-drop on: air 4-5 cm behind (left of) the boat's middle and 7 cm over the water, at_s 0.5; goal moves {boat, min_m: 0.15}: the clean water ahead pulls it along at about 8 cm/s", plan: { seconds: 5, items: [{ id: "tank", type: "water-tank", props: { style: "aquarium" }, place: { on: "table", x: 1.2 } }, { id: "boat", type: "foil-boat", name: "Foil boat", place: { inside: "tank", on: "tank", x: 1.02 } }, { id: "soap", type: "soap-drop", props: { at_s: 0.5 }, place: { on: "air", x: 0.975, y_m: 0.28 } }], goals: [{ kind: "moves", item: "boat", min_m: 0.15 }] } },
		{ ask: "Water climbs higher in a thinner tube (S3).", how: "an aquarium ON the table (surface at y 0.212); two capillary-tubes on: air with their bottom ends 2 cm under the surface (y_m 0.19), one bore_mm 1 (29.7 mm), one bore_mm 4 (7.4 mm); goal climbs_higher {a: thin, b: wide}", plan: { seconds: 2, items: [{ id: "tank", type: "water-tank", props: { style: "aquarium" }, place: { on: "table", x: 1.2 } }, { id: "thin", type: "capillary-tube", name: "Thin tube", props: { bore_mm: 1 }, place: { on: "air", x: 1.1, y_m: 0.19 } }, { id: "wide", type: "capillary-tube", name: "Wide tube", props: { bore_mm: 4 }, place: { on: "air", x: 1.3, y_m: 0.19 } }], goals: [{ kind: "climbs_higher", a: "thin", b: "wide" }] } },
		{ ask: "Make a density column and drop in a grape, a cork and a plastic bead (F12).", how: "a density-column (6 layers: honey, corn syrup, dish soap, water, vegetable oil, rubbing alcohol) ON the table, a grape, a plastic-bead and a cork dropped from the air above its mouth; goals floats {cork} (on top), floats {grape} (on the syrup); the bead rests where the oil meets the water", plan: { items: [{ id: "jar", type: "density-column", place: { on: "table", x: 1.2 } }, { id: "grape", type: "grape", place: { on: "air", x: 1.2, y_m: 0.36 } }, { id: "bead", type: "plastic-bead", place: { on: "air", x: 1.19, y_m: 0.4 } }, { id: "cork", type: "cork", place: { on: "air", x: 1.21, y_m: 0.44 } }], goals: [{ kind: "floats", item: "cork" }, { kind: "floats", item: "grape" }] } }
	],
	goals: [
		{
			kind: "floats", aliases: ["float", "floating", "stays_afloat", "afloat"], fields: { item: "item" },
			about: "floats {item}: at the end it floats in a liquid (the liquid holds up its weight, part of it above the surface or hanging in it), not resting on the bottom",
			label: (g, nameOf) => `${nameOf(g.item)} floats`,
			summarize: (ctx, g) => floats(ctx, g),
			sample: (scene, pick) => {
				const xs = scene.items.filter((i) => i.type !== "table" && !CONTAINER_TYPES.includes(i.type))
				return xs.length ? { kind: "floats", item: pick(xs).id } : null
			}
		},
		{
			kind: "sinks", aliases: ["sink", "sinking", "sunk", "goes_to_bottom"], fields: { item: "item" },
			about: "sinks {item}: at the end it rests on the bottom of a liquid (the liquid holds up less than its weight)",
			label: (g, nameOf) => `${nameOf(g.item)} sinks to the bottom`,
			summarize: (ctx, g) => sinks(ctx, g),
			sample: (scene, pick) => {
				const xs = scene.items.filter((i) => i.type !== "table" && !CONTAINER_TYPES.includes(i.type))
				return xs.length ? { kind: "sinks", item: pick(xs).id } : null
			}
		},
		{
			kind: "floats_then_sinks", aliases: ["fills_then_sinks", "fills_and_sinks", "floats_until_full", "sinks_when_full", "fills_up_and_sinks", "floats_then_fills"], fields: { item: "item", by_s: "number?" },
			about: "floats_then_sinks {item, by_s?}: it floats first, then fills with water (or is loaded) and sinks, resting on the bottom at the end (by by_s s): a bowl a hose fills until it goes under; never met by a thing that sank from the start",
			label: (g, nameOf) => `${nameOf(g.item)} floats, then fills and sinks${Number.isFinite(g.by_s) ? ` by ${g.by_s} s` : ""}`,
			summarize: (ctx, g) => floats_then_sinks(ctx, g),
			detail: (e) => (e?.ok ? `yes (floated from ${trimNum(e.floated_s ?? 0, 1)} s, sank at ${trimNum(e.sank_s ?? 0, 1)} s)` : e?.floated_s == null ? "no (it never floated)" : e?.sank_s == null ? `no (it floated from ${trimNum(e.floated_s, 1)} s and never sank)` : "no (it did not stay on the bottom)"),
			sample: (scene, pick) => {
				const xs = scene.items.filter((i) => i.type !== "table" && !CONTAINER_TYPES.includes(i.type))
				return xs.length ? { kind: "floats_then_sinks", item: pick(xs).id, ...(pick([true, false]) ? { by_s: pick([1, 1.5]) } : {}) } : null
			}
		},
		{
			kind: "climbs", aliases: ["capillary_rise", "wicks", "wicks_up", "liquid_climbs", "climbs_up"], fields: { item: "item", at_least_mm: "number?", at_most_mm: "number?" },
			about: "climbs {item, at_least_mm?, at_most_mm?}: at the end the liquid stands that high in a capillary-tube above the outside surface (rise_mm), or has climbed a paper-strip that far (wet_mm)",
			label: (g, nameOf) => `the liquid climbs ${nameOf(g.item)}${Number.isFinite(g.at_least_mm) ? ` at least ${g.at_least_mm} mm` : ""}${Number.isFinite(g.at_most_mm) ? ` at most ${g.at_most_mm} mm` : ""}`,
			summarize: (ctx, g) => climbs(ctx, g),
			detail: (e) => (e?.mm == null ? "no (nothing climbed it)" : `${e.ok ? "yes" : "no"} (${trimNum(e.mm, 1)} mm)`),
			sample: (scene, pick) => {
				const xs = scene.items.filter((i) => i.type === "capillary-tube" || i.type === "paper-strip")
				return xs.length ? { kind: "climbs", item: pick(xs).id, ...(pick([true, false]) ? { at_least_mm: pick([5, 20, 29]) } : {}) } : null
			}
		},
		{
			kind: "climbs_higher", aliases: ["climbs_higher_than", "capillary_higher", "wicks_higher"], fields: { a: "item", b: "item" }, subject: ["a"],
			about: "climbs_higher {a, b}: at the end the liquid stands higher in a than in b (capillary tubes or paper strips: a thinner tube climbs higher)",
			label: (g, nameOf) => `the liquid climbs ${nameOf(g.a)} higher than ${nameOf(g.b)}`,
			summarize: (ctx, g) => climbs_higher(ctx, g),
			detail: (e) => `${e?.ok ? "yes" : "no"} (${trimNum(e?.a_mm ?? 0, 1)} mm against ${trimNum(e?.b_mm ?? 0, 1)} mm)`,
			sample: (scene, pick) => {
				const xs = scene.items.filter((i) => i.type === "capillary-tube" || i.type === "paper-strip")
				return xs.length >= 2 ? { kind: "climbs_higher", a: xs[0].id, b: xs[1].id } : null
			}
		},
		{
			kind: "level", aliases: ["reads_ml", "volume", "water_level", "level_reads"], fields: { container: "item", at_least_ml: "number?", at_most_ml: "number?" },
			subject: ["container"],
			about: "level {container, at_least_ml?, at_most_ml?}: at the end the container's scale reads (liquid + what is under its surface) within those mL",
			label: (g, nameOf) => `${nameOf(g.container)} reads${Number.isFinite(g.at_least_ml) ? ` at least ${g.at_least_ml} mL` : ""}${Number.isFinite(g.at_most_ml) ? ` at most ${g.at_most_ml} mL` : ""}`,
			summarize: (ctx, g) => level(ctx, g),
			sample: (scene, pick) => {
				const xs = scene.items.filter((i) => CONTAINER_TYPES.includes(i.type))
				return xs.length ? { kind: "level", container: pick(xs).id, ...(pick([true, false]) ? { at_least_ml: pick([50, 61.5, 500, 24000]) } : { at_most_ml: pick([70, 300, 30000]) }) } : null
			}
		}
	],
	knobs: [
		{ type: "sailboat", key: "sail_area_cm2", how: "rel", steps: [0.1, 0.2, 0.4, 0.7, 1.0, 1.7], more: "give {it} a bigger sail", less: "give {it} a smaller sail", why: "a bigger sail catches more of the fan's air: its push grows with its area (tiny 48, small 120, big 320 cm²)" },
		{ type: "sailboat", key: "hull_mass", how: "rel", cost: 3, more: "make {it}'s hull heavier", less: "make {it}'s hull lighter", why: "a lighter boat speeds up faster under the same push and floats higher (less hull in the water to drag); a hidden change, so tried after what a lesson shows (sail, fan, distance)" },
		{ type: "fan", key: "speed", how: "rel", more: "turn {it} up", less: "turn {it} down", why: "the push on a sail grows as the square of the air's speed at it" },
		{ type: "fan", key: "diameter", how: "rel", more: "make {it} bigger", less: "make {it} smaller", why: "a bigger fan's jet stays at full speed farther (5.6 fan diameters) and is wider; a smaller one fades sooner (so near and far fans differ)" },
		{ type: "breeze", key: "speed", how: "rel", more: "make the wind stronger", less: "make the wind lighter", why: "the push on a sail grows as the square of the wind's speed" },
		{ type: "water-tank", key: "salt_pct", how: "abs", steps: [2, 4, 6, 8, 12], cost: 2, more: "add salt to {it}", less: "take salt out of {it}", why: "salt makes the water denser (10 % → 1071, 12 % → 1086 kg/m³), so things float higher and an egg or a grape floats" },
		{ type: "water-tank", key: "liquid", how: "choice", cost: 8, more: "fill {it} with another liquid", less: "fill {it} with another liquid", why: "a denser liquid (syrup, honey, salt water) floats more things; oil and alcohol are lighter than water" },
		{ type: "water-tank", key: "fill", how: "m", cost: 2, more: "add liquid to {it}", less: "take liquid out of {it}", why: "deeper liquid lets a boat clear the bottom and covers more of a sinking thing" },
		{ type: "graduated-cylinder", key: "fill_ml", how: "rel", more: "pour more into {it}", less: "pour some out of {it}", why: "more liquid in the cylinder raises its starting reading" },
		{ type: "foil-boat", key: "height", how: "rel", more: "make {it}'s sides higher", less: "make {it}'s sides lower", why: "higher sides hold more water out, so it carries more before it floods" },
		{ type: "clay-boat", key: "mass", how: "rel", steps: [0.25, 0.5, 1.0, 1.5, 2.0], more: "use more clay for {it}", less: "use less clay for {it}", why: "with 4 mm walls more clay makes a bigger hull: its room grows faster than its weight (as the clay's mass to the 1.5), so it carries more" },
		{ type: "penny", key: "count", how: "abs", steps: [1, 2, 3, 5, 8], cost: 2, more: "add pennies to {it}", less: "take pennies off {it}", why: "each penny is 2.5 g of cargo: fewer keep a boat's rim above the water" },
		{ type: "capillary-tube", key: "bore_mm", how: "rel", steps: [0.1, 0.25, 0.5, 1.0], more: "use a wider tube for {it}", less: "use a thinner tube for {it}", why: "the liquid climbs a tube as 1 / its width (Jurin): a thinner tube climbs higher" },
		{ type: "paper-strip", key: "paper", how: "choice", cost: 3, more: "make {it} of another paper", less: "make {it} of another paper", why: "paper towel wicks fastest, filter paper steadily, printer paper hardly at all" },
		{ type: "soap-drop", key: "at_s", how: "abs", steps: [0.5, 1, 2], more: "let {it} fall later", less: "let {it} fall sooner", why: "the soap lowers the surface tension from when it lands: a clip it reaches sinks then, a boat it is behind starts then" },
		{ type: "soap-drop", key: "x", how: "m", steps: [0.01, 0.02, 0.04, 0.08], more: "move {it}", less: "move {it}", why: "the soap spreads from where it lands (0.12·t^0.75 m): nearer a clip it sinks it sooner; just behind a boat's stern it pushes the boat" }
	],
	place: {
		containers: CONTAINER_TYPES,
		/** A fan in a scene with a liquid container stands on a lab stand the view draws (web/models/mod-fluids.js "fluids:fan-stands"). */
		held: (type, types) => (type === "fan" && types.some((t) => CONTAINER_TYPES.includes(t))) || ["capillary-tube", "paper-strip", "soap-drop"].includes(type),
		/** The inside of a liquid container in its own frame: between its walls, from its inner floor to its rim (from its liquid record). */
		interior(type, props) {
			if (!CONTAINER_TYPES.includes(type)) return null
			const rec = alone({ id: "c", type, x: 0.0, y: 0.0, props: props ?? {} }).sb.processes.find((p) => p.kind === "liquid")
			return rec ? { x0: rec.x0, x1: rec.x1, floor: rec.floor, rim: rec.rim } : null
		},
		/** Where a thing put into a liquid container starts: at its own floating depth when it floats (the engine's balance of its weight, the air's
		 *  lift on its whole volume and the liquid's on the part under the surface), so it starts at rest instead of rising from the floor. */
		float(thing, container, riders = []) {
			if (!CONTAINER_TYPES.includes(container.type) || !F?.TYPES?.[thing.type]) return null
			const rec = alone({ id: "c", type: container.type, x: container.x, y: container.y, props: container.props ?? {} }).sb.processes.find((p) => p.kind === "liquid")
			if (!rec || !rec.layers.length) return null
			// (what rests on it weighs it down: a boat's cargo, its weight in air)
			let cargo = 0
			for (const r of riders ?? []) {
				if (!F.TYPES[r.type]) continue
				const { sb } = alone({ id: "r", type: r.type, x: 0.0, y: 0.0, props: r.props ?? {} })
				for (const s of sb.solids) if (s.kind === "dynamic") cargo += (sb.materials[s.material]?.density ?? 0) * _body_volume(s.body) - 1.2 * _body_volume(s.body)
			}
			return floatY(thing, rec, cargo)
		}
	},
	digest(item, run, h) {
		const out = []
		const P = run?.resolved?.[item.id] ?? item.props ?? {}
		const doc = run?.doc
		if (CONTAINER_TYPES.includes(item.type)) {
			const rec = (doc?.processes ?? []).find((p) => p.kind === "liquid" && p.item === item.id)
			if (item.type === "density-column") out.push(`holds ${P.order ?? "its layers"} (densest at the bottom)`)
			else if (rec) {
				const d = liquidDensity(P.liquid, P.salt_pct)
				const depth = rec.layers?.[0]?.height ?? 0
				out.push(`holds ${liquidWords(P.liquid, P.salt_pct)} (${d} kg/m³), ${cm(depth)} deep with nothing in it (${trimNum(depth * rec.area * 1e6, 0)} mL); inside it is ${cm(rec.x1 - rec.x0)} long, its surface at y ${trimNum(rec.floor + depth, 3)} m, its rim at y ${trimNum(rec.rim, 3)} m`)
			}
			const l0 = startOf(run, item.id, "volume_ml")
			const l1 = endOf(run, item.id, "volume_ml")
			if (l0 !== null && l1 !== null) out.push(`its scale reads ${trimNum(l0, 1)} → ${trimNum(l1, 1)} mL (level ${trimNum(startOf(run, item.id, "level_mm") / 10, 2)} → ${trimNum(endOf(run, item.id, "level_mm") / 10, 2)} cm)${endOf(run, item.id, "spilled_ml") > 0 ? `; ${trimNum(endOf(run, item.id, "spilled_ml"), 1)} mL spilled over the rim` : ""}`)
			return out
		}
		const sub = endOf(run, item.id, "submerged")
		if (sub !== null && doc) {
			const { mass, volume } = massAndVolume(doc, item.id)
			const avg = volume > 0 ? mass / volume : null
			const lift = endOf(run, item.id, "buoyancy_n")
			const weight = mass * 9.81
			const state = endOf(run, item.id, "afloat") === 1 ? "floats" : endOf(run, item.id, "sunk") === 1 ? "rests on the bottom (sank)" : sub > 0 ? "is in the liquid, sinking or still settling" : "is out of the liquid"
			out.push(`at the end it ${state}: ${trimNum(sub * 100, 1)} % of it under the surface, draft ${trimNum(endOf(run, item.id, "draft_mm") ?? 0, 1)} mm; its average density ${avg === null ? "?" : trimNum(avg, 0)} kg/m³; buoyancy ${trimNum(lift ?? 0, 3)} N against its weight ${trimNum(weight, 3)} N`)
			const fb = endOf(run, item.id, "freeboard_mm")
			if (fb !== null) out.push(`its rim is ${trimNum(fb, 1)} mm above the surface${endOf(run, item.id, "flooded") === 1 ? "; it FLOODED (water came over its rim) and sank" : ""}`)
			// an open vessel (a mug, a bowl): what was poured into it, and whether a stream could reach it at all
			const vessel = (doc.processes ?? []).find((p) => p.kind === "hull" && p.item === item.id && p.vessel === true)
			if (vessel) {
				const held = endOf(run, item.id, "liquid_ml")
				const pours = (doc.processes ?? []).filter((p) => p.kind === "flow-tap" || p.kind === "flow-pour")
				out.push(`it floats as a hollow vessel (${trimNum(_shoelace(vessel.points) * vessel.depth * 1e6, 0)} mL to its rim)${held !== null ? `; ${trimNum(held, 0)} mL poured into it` : ""}`)
				if (pours.length && !(held > 1)) out.push("NO water from the tap or pitcher landed in it: put the stream's mouth straight over its opening (a stream lands where it falls), or fill it with a hose (flow module) from a raised beaker, to: this vessel")
			}
		}
		if (item.type === "capillary-tube" || item.type === "paper-strip") {
			const v = endOf(run, item.id, item.type === "capillary-tube" ? "rise_mm" : "wet_mm")
			const jurin = item.type === "capillary-tube" ? ` (Jurin's height for water ${trimNum(P.jurin_mm ?? 29.7, 1)} mm)` : ""
			out.push(v === null ? "it never reaches a liquid: its bottom end (its anchor) must be 1-3 cm under a container's surface" : `the liquid climbed it ${trimNum(v, 1)} mm above the outside surface${jurin}${v < 0.05 ? ": NOTHING climbed it (is its bottom end under the surface?)" : ""}`)
		}
		if (item.type === "soap-drop") {
			const landed = endOf(run, item.id, "landed")
			out.push(landed === 1 ? `its drop landed on the water and the soap spread ${trimNum(endOf(run, item.id, "spread_cm") ?? 0, 1)} cm from there by the end (0.12·t^0.75 m)` : "its drop never landed on a liquid: put it over a container's water (its x between the container's walls)")
		}
		if (SURFACE_TYPES[item.type] && endOf(run, item.id, "surface_mn") !== null) {
			const on = endOf(run, item.id, "on_surface") === 1
			out.push(on ? `the surface tension holds it up with ${trimNum(endOf(run, item.id, "surface_mn"), 2)} mN at the end` : `the surface no longer holds it (it broke through${(doc?.processes ?? []).some((p) => p.kind === "soap") ? " or soap reached it" : ": dropped from above, it pushes the surface down too far; put it INSIDE the container to lay it gently"})`)
		}
		if (item.type === "sailboat") {
			const a0 = startOf(run, item.id, "air_ms")
			const a1 = endOf(run, item.id, "air_ms")
			const p0 = startOf(run, item.id, "push_n")
			out.push(`sail ${P.sail ?? "small"} ${trimNum(P.sail_area_cm2 ?? 120, 0)} cm² (${cm(P.sail_width ?? 0)} wide × ${cm(P.sail_height ?? 0)} tall)${a0 !== null ? `; wind at the sail ${trimNum(a0, 2)} → ${trimNum(a1, 2)} m/s, push at the start ${trimNum(p0 ?? 0, 3)} N` : ""}`)
			if (a0 !== null && Math.abs(a0) < 0.3) out.push("NO wind reaches its sail: put a fan behind it facing +x with its front-face anchor at the sail's middle height, or a breeze")
		}
		void h
		return out.length ? out : null
	},
	words: {
		change(type, key, a, b, nameOf, items) {
			if (type === "sailboat" && (key === "sail" || key === "sail_area_cm2")) {
				// (a sail's area follows its size choice until sail_area_cm2 is set: with the items as they were and are, its own area each side,
				// and the same words for both keys, so an edit of both is said once: "sail small → big (104 → 320 cm²)")
				const areaOf = (it) => {
					const P = it?.props ?? {}
					if ((P.sail ?? "small") === "none") return 0
					const v = P.sail_area_cm2
					return typeof v === "number" && Number.isFinite(v) ? v : (SAILS[P.sail ?? "small"] ?? null)
				}
				if (items?.before && items?.after) {
					const sa = items.before.props?.sail ?? "small"
					const sb = items.after.props?.sail ?? "small"
					const A = areaOf(items.before)
					const B = areaOf(items.after)
					const nums = A !== null && B !== null ? `${trimNum(A, 0)} → ${trimNum(B, 0)} cm²` : null
					if (sa !== sb) return `sail ${sa} → ${sb}${nums ? ` (${nums})` : ""}`
					return nums ? `sail ${nums}` : null
				}
				if (key === "sail") return `sail ${a} (${trimNum(SAILS[a] ?? 0, 0)} cm²) → ${b} (${trimNum(SAILS[b] ?? 0, 0)} cm²)`
				const fa = typeof a === "number" && Number.isFinite(a) ? `${trimNum(a, 0)} → ` : "set to "
				return typeof b === "number" && Number.isFinite(b) ? `sail ${fa}${trimNum(b, 0)} cm²` : "sail back to its size choice's own area"
			}
			if (CONTAINER_TYPES.includes(type) && key === "liquid") return `${a} → ${b} (${liquidDensity(a)} → ${liquidDensity(b)} kg/m³)`
			if (CONTAINER_TYPES.includes(type) && key === "salt_pct") return `salt ${trimNum(a, 1)} → ${trimNum(b, 1)} % (${salt_water(a)[0]} → ${salt_water(b)[0]} kg/m³)`
			if (CONTAINER_TYPES.includes(type) && key === "fill") return `liquid depth ${cm(a)} → ${cm(b)}`
			if (CONTAINER_TYPES.includes(type) && key === "fill_ml") return `liquid ${trimNum(a, 1)} → ${trimNum(b, 1)} mL`
			if (type === "capillary-tube" && key === "bore_mm") return `tube ${trimNum(a, 1)} → ${trimNum(b, 1)} mm wide inside (water climbs ${trimNum(29.7 / a, 1)} → ${trimNum(29.7 / b, 1)} mm)`
			if (type === "fan" && key === "diameter") return `fan ${cm(a)} → ${cm(b)} across (full-speed jet to ${trimNum(6.2 * a * 0.9, 2)} → ${trimNum(6.2 * b * 0.9, 2)} m)`
			return null
		},
		/** the words that name a setting in a request: the sail's size choice and its area are one choice (said of either, both are held) */
		keys: { "sailboat.sail": "sails?", "sailboat.sail_area_cm2": "sails?" },
		/** one added penny item is a stack of `count` */
		added(item) {
			if (item?.type !== "penny") return null
			const n = Math.round(Number(item.props?.count ?? 1))
			return Number.isFinite(n) && n > 1 ? `a stack of ${n} pennies` : null
		}
	}
}


// ---------------------------------------------------------------- the solver's floating start (plugin.place.float)
/** An item built alone with the framework (its solids, processes and materials), at its own x, y and angle. */
function alone(item) {
	const sb = new F.SceneBuilder()
	sb.scene_items = new Map([[item.id, item]])
	const P = F.props_of(item)
	F.TYPES[item.type].build_fn(new F.Ctx(sb, item, P), P)
	return { sb, P }
}
/** A solid's world pose from the built solids (a welded child's `at` is in its parent's frame). */
function worldPose(byId, s) {
	if (!s.parent || !byId.has(s.parent)) return { x: s.at.x, y: s.at.y, a: s.angle ?? 0 }
	const q = worldPose(byId, byId.get(s.parent))
	const c = Math.cos(q.a)
	const n = Math.sin(q.a)
	return { x: q.x + s.at.x * c - s.at.y * n, y: q.y + s.at.x * n + s.at.y * c, a: q.a + (s.angle ?? 0) }
}
const rot = (q, p) => ({ x: q.x + p.x * Math.cos(q.a) - p.y * Math.sin(q.a), y: q.y + p.x * Math.sin(q.a) + p.y * Math.cos(q.a) })
/** A convex outline cut to the band y0…y1 and x0…x1. */
function band(pts, x0, x1, y0, y1) {
	const half = (P, a, b, c) => {
		const out = []
		for (let i = 0; i < P.length; i++) {
			const p = P[i]
			const q = P[(i + 1) % P.length]
			const dp = a * p.x + b * p.y - c
			const dq = a * q.x + b * q.y - c
			if (dp <= 0) out.push(p)
			if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) {
				const u = dp / (dp - dq)
				out.push({ x: p.x + u * (q.x - p.x), y: p.y + u * (q.y - p.y) })
			}
		}
		return out
	}
	let P = half(pts, -1, 0, -x0)
	if (P.length > 2) P = half(P, 1, 0, x1)
	if (P.length > 2) P = half(P, 0, -1, -y0)
	if (P.length > 2) P = half(P, 0, 1, y1)
	return P.length > 2 ? _shoelace(P) : 0
}
const sphereBetween = (r, z1, z2) => {
	const a = Math.max(-r, Math.min(r, z1))
	const b = Math.max(-r, Math.min(r, z2))
	return b > a ? Math.PI * (r * r * (b - a) - (b ** 3 - a ** 3) / 3) : 0
}
const circleBetween = (r, z1, z2) => {
	const a = Math.max(-r, Math.min(r, z1))
	const b = Math.max(-r, Math.min(r, z2))
	if (!(b > a)) return 0
	const F2 = (z) => z * Math.sqrt(Math.max(0, r * r - z * z)) + r * r * Math.atan2(z / r, Math.sqrt(Math.max(0, 1 - (z / r) ** 2)))
	return F2(b) - F2(a)
}
/** The anchor's y at which a thing floats in a liquid record's layers (none: it sinks to the floor, or the water is too shallow). */
function floatY(thing, rec, cargo = 0, floor = false) {
	const { sb, P: TP } = alone({ id: "t", type: thing.type, x: thing.x ?? 0, y: 0.0, angle: thing.angle ?? 0, props: thing.props ?? {} })
	const byId = new Map(sb.solids.map((s) => [s.id, s]))
	const shapes = []
	let mass = 0
	let whole = 0
	for (const s of sb.solids) {
		if (s.kind !== "dynamic") continue
		const q = worldPose(byId, s)
		const b = s.body
		const rho = sb.materials[s.material]?.density ?? 0
		if (b.kind === "ball") {
			const cyl = s.shape === "cylinder" && typeof s.length === "number"
			const own = (4 / 3) * Math.PI * (b.radius ** 3 - Math.max(0, b.radius - (b.wall ?? b.radius)) ** 3)
			mass += rho * own
			const vol = cyl ? Math.PI * b.radius * b.radius * s.length : (4 / 3) * Math.PI * b.radius ** 3
			whole += vol
			shapes.push(cyl ? { kind: "cylinder", x: q.x, y: q.y, r: b.radius, length: s.length } : { kind: "sphere", x: q.x, y: q.y, r: b.radius })
		} else {
			const pts =
				b.kind === "polygon"
					? b.points
					: [{ x: (-b.width / 2) * (b.taper ?? 1), y: -b.height / 2 }, { x: (b.width / 2) * (b.taper ?? 1), y: -b.height / 2 }, { x: b.width / 2, y: b.height / 2 }, { x: -b.width / 2, y: b.height / 2 }]
			const vol = _shoelace(pts) * b.depth
			mass += rho * vol
			whole += vol
			shapes.push({ kind: "prism", points: pts.map((p) => rot(q, p)), depth: b.depth })
		}
	}
	if (!(mass > 0) || !shapes.length) return null
	let rim = null
	// (an open vessel of the catalog, a mug or a bowl, floats as a hull: the record the build hook gives it in a scene with a liquid)
	const hull = sb.processes.find((p) => p.kind === "hull") ?? (hasOwn(VESSELS, thing.type) ? vessel_hull(sb, "t", thing.type, TP.material || F.TYPES[thing.type].material) : null)
	if (hull && byId.has(hull.solid)) {
		const q = worldPose(byId, byId.get(hull.solid))
		const pts = hull.points.map((p) => rot(q, p))
		shapes.length = 0
		shapes.push({ kind: "prism", points: pts, depth: hull.depth })
		whole = _shoelace(pts) * hull.depth
		rim = Math.min(pts[hull.rim[0]].y, pts[hull.rim[1]].y)
		// (a vessel's parts outside its envelope, a mug's handle, at their true volume: the engine's `extra`)
		if (Array.isArray(hull.extra) && hull.extra_ml > 0) {
			const xs = hull.extra.map((id) => byId.get(id)).filter((s) => s && s.body.kind !== "ball")
			let drawn = 0
			for (const s of xs) drawn += _body_volume(s.body)
			if (drawn > 0) {
				const f = hull.extra_ml / 1e6 / drawn
				for (const s of xs) {
					const q = worldPose(byId, s)
					const b = s.body
					const p0 = b.kind === "polygon" ? b.points : _body_points(b).map(([x, y]) => ({ x, y }))
					shapes.push({ kind: "prism", points: p0.map((p) => rot(q, p)), depth: b.depth, f })
				}
				whole += hull.extra_ml / 1e6
			}
		}
	}
	// (an item whose outline × depth is not its volume pushes aside its true volume: TRUE_DENSITY, as the engine's displace record)
	let k = 1
	const td = hasOwn(TRUE_DENSITY, thing.type) ? TRUE_DENSITY[thing.type] : null
	if (td && rim === null && (td[1] === null || F.py.truthy(F.props_of({ type: thing.type, props: thing.props ?? {} })[td[1]]))) {
		k = mass / td[0] / whole
		whole = mass / td[0]
	}
	const low = Math.min(...shapes.map((s) => (s.kind === "prism" ? Math.min(...s.points.map((p) => p.y)) : s.y - s.r)))
	if (floor) return Math.round((rec.floor - low + 0.0005) * 1e6) / 1e6 // (resting on the inner floor, half a millimetre above it)
	const between = (dy, y0, y1) => {
		let v = 0
		for (const s of shapes) {
			if (s.kind === "prism") v += band(s.points.map((p) => ({ x: p.x, y: p.y + dy })), rec.x0, rec.x1, y0, y1) * s.depth * (s.f ?? 1)
			else if (s.x >= rec.x0 && s.x <= rec.x1) v += s.kind === "sphere" ? sphereBetween(s.r, y0 - s.y - dy, y1 - s.y - dy) : circleBetween(s.r, y0 - s.y - dy, y1 - s.y - dy) * s.length
		}
		return k * v
	}
	// the liquid's lift (the air's share of it already the air's) at the anchor height dy, the layers' tops raised by what the thing pushes under
	const lift = (dy) => {
		// each layer's top rises by what is pushed under below it: t = rest + V(floor…t)/area, a few rounds of it
		const rest = []
		let y = rec.floor
		for (const l of rec.layers) rest.push((y += l.height))
		let tops = rest.slice()
		for (let k = 0; k < 4; k++) tops = rest.map((r0, i) => r0 + between(dy, rec.floor, tops[i]) / rec.area)
		let b = rec.floor
		let up = 0
		rec.layers.forEach((l, i) => {
			const t = Math.min(tops[i], rec.rim)
			if (t > b) up += (l.density - 1.2) * between(dy, b, t)
			b = Math.max(b, t)
		})
		return up
	}
	const need = mass - 1.2 * whole + cargo
	let lo = rec.floor - low // resting on the floor
	if (lift(lo) < need) return surfaceY(thing, rec, lift, need, low) // the liquid cannot hold it up even with all of it under: it sinks, unless its surface holds it
	let hi = rec.rim - low + 1.0
	for (let k = 0; k < 50; k++) {
		const mid = (lo + hi) / 2
		if (lift(mid) >= need) lo = mid
		else hi = mid
	}
	const dy = Math.round(lo * 1e6) / 1e6
	if (rim !== null) {
		const level = rec.floor + rec.layers.reduce((a, l) => a + l.height, 0)
		if (rim + dy < level) return null // its rim would be under the surface: it floods
	}
	return dy
}


/**
 * A thin thing the surface holds up when laid gently (SURFACE_TYPES: a paper clip): the anchor's y where its buoyancy and the surface's pull,
 * γ·contact·sin φ with the meniscus pushed down d = 2·l_c·sin(φ/2) (as the engine's meniscusPull), hold up its weight; null when even the
 * deepest dent the surface allows cannot (it sinks).
 */
function surfaceY(thing, rec, lift, need, low) {
	if (!hasOwn(SURFACE_TYPES, thing.type) || !rec.layers.length) return null
	const { sb } = alone({ id: "t", type: thing.type, x: thing.x ?? 0, y: 0.0, angle: thing.angle ?? 0, props: thing.props ?? {} })
	const [head, contact, theta] = SURFACE_TYPES[thing.type]
	const parts = sb.solids.filter((s) => s.kind === "dynamic" && s.id.startsWith(`t/${head}`)).length
	if (!parts) return null
	const top = rec.layers[rec.layers.length - 1]
	const [gamma, wets] = tension_of(top.words)
	const drho = top.density - 1.2
	const lc = Math.sqrt(gamma / (drho * 9.81))
	// (its pull grows as it is pushed down to a slope of 90° at most, or its contact angle: beyond that the surface lets go)
	const umax = Math.min(Math.sin(((Math.min(theta, wets) / 2) * Math.PI) / 180), Math.SQRT1_2)
	let level = rec.floor
	for (const l of rec.layers) level += l.height
	const pull = (dy) => {
		const u = (level - (low + dy)) / (2 * lc)
		return u > 0 ? (gamma * contact * parts * 2 * u * Math.sqrt(Math.max(0, 1 - u * u))) / 9.81 : 0
	}
	let hi = level - low // touching the surface
	let lo = hi - 2 * lc * umax // the deepest dent
	if (lift(lo) + pull(lo) < need) return null
	for (let k = 0; k < 50; k++) {
		const mid = (lo + hi) / 2
		if (lift(mid) + pull(mid) >= need) lo = mid
		else hi = mid
	}
	return Math.round(lo * 1e6) / 1e6
}

/** Where a thing put into a liquid container rests on its inner floor (a sinker's start; for scene makers and tests), or null. */
export function restingY(thing, container) {
	if (!CONTAINER_TYPES.includes(container.type) || !F?.TYPES?.[thing.type]) return null
	const rec = alone({ id: "c", type: container.type, x: container.x, y: container.y, props: container.props ?? {} }).sb.processes.find((p) => p.kind === "liquid")
	return rec ? floatY(thing, rec, 0, true) : null
}


// ---------------------------------------------------------------- true volumes of catalog items whose outline × depth is not their volume
// (machines/mod_fluids.py TRUE_DENSITY: only in a scene with a liquid, the build adds {kind: "displace", item, volume_ml})
export const TRUE_DENSITY = {
	egg: [1080.0, null], "coffee-mug": [2400.0, null], "soda-can": [1040.0, "full"], "soda-can-side": [1040.0, "full"],
	"water-bottle": [1005.0, "full"], "water-bottle-side": [1005.0, "full"], "traffic-cone": [1400.0, null], "lego-brick": [1050.0, null],
	"paper-clip": [7850.0, null]
}
const SURFACE_KINDS = ["surface", "soap", "capillary", "wick"]

/** A doc body's volume as the engine reckons its mass (part.ts volume). */
export function _body_volume(b) {
	if (b.kind === "ball") {
		const r = b.radius
		const w = b.wall ?? null
		return (4 / 3) * Math.PI * (cube(r) - cube(pymax(0.0, r - (w !== null ? w : r))))
	}
	if (b.kind === "slab") {
		const t = b.taper ?? 1
		return ((1 + t) / 2) * b.width * b.height * b.depth
	}
	return _area(b.points.map((p) => [p.x, p.y])) * b.depth
}

// ---------------------------------------------------------------- open vessels of the catalog float as hollow hulls (machines/mod_fluids.py VESSELS)
// type -> [its floor's part, its walls' parts, round]
export const VESSELS = {
	"coffee-mug": ["body", ["wall-left", "wall-right"], true],
	bowl: ["base", ["wall-left", "wall-right"], true]
}

/** A doc body's outline in its own frame: a polygon's points, a slab's corners (a tapered slab narrower at its bottom). */
function _body_points(b) {
	if (b.kind === "polygon") return b.points.map((p) => [p.x, p.y])
	const t = b.taper ?? 1
	const w = b.width
	const h = b.height
	return [[(-w / 2) * t, -h / 2], [(w / 2) * t, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]
}

/** The convex hull of points, counter-clockwise from the lowest-leftmost, without points on its edges (Andrew's monotone chain), as the Python. */
function _convex(pts) {
	const seen = new Set()
	const P = []
	for (const p of pts) {
		const k = `${p[0]},${p[1]}`
		if (seen.has(k)) continue
		seen.add(k)
		P.push(p)
	}
	P.sort((a, b) => (a[0] !== b[0] ? (a[0] < b[0] ? -1 : 1) : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
	if (P.length < 3) return P
	const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
	const lower = []
	const upper = []
	for (const q of P) {
		while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop()
		lower.push(q)
	}
	for (const q of [...P].reverse()) {
		while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop()
		upper.push(q)
	}
	return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

function _strictly_convex(pts) {
	const n = pts.length
	for (let i = 0; i < n; i++) {
		const a = pts[i]
		const b = pts[(i + 1) % n]
		const c = pts[(i + 2) % n]
		if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) <= 0) return false
	}
	return n >= 3
}

/** The hull record of an open vessel of the catalog (VESSELS) built in sb, or null (machines/mod_fluids.py vessel_hull, step for step). */
export function vessel_hull(sb, iid, itype, material) {
	if (!hasOwn(VESSELS, itype)) return null
	const [root_part, walls, rnd] = VESSELS[itype]
	const have = new Map(sb.solids.filter((s) => s.item === iid).map((s) => [s.id, s]))
	const root = have.get(`${iid}/${root_part}`)
	if (!root || root.kind !== "dynamic") return null
	const pts = [..._body_points(root.body)]
	for (const w of walls) {
		const s = have.get(`${iid}/${w}`)
		if (!s || s.kind !== "dynamic" || s.parent !== root.id) return null
		const a = s.angle ?? 0.0
		const ca = cos(a)
		const sa = sin(a)
		const ax = s.at.x
		const ay = s.at.y
		for (const [x, y] of _body_points(s.body)) pts.push([ax + x * ca - y * sa, ay + x * sa + y * ca])
	}
	let env = _convex(pts.map(([x, y]) => [pyRound(x, 5) + 0.0, pyRound(y, 5) + 0.0]))
	while (env.length >= 3 && !_strictly_convex(env)) {
		// (rounding left a point on an edge: drop the first one that does not turn)
		const n = env.length
		for (let i = 0; i < n; i++) {
			const a = env[i]
			const b = env[(i + 1) % n]
			const c = env[(i + 2) % n]
			if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) <= 0) {
				const k = (i + 1) % n
				env = [...env.slice(0, k), ...env.slice(k + 1)]
				break
			}
		}
	}
	if (env.length < 3 || env.length > 8) return null
	let top = -Infinity
	for (const [, y] of env) top = pymax(top, y)
	let rim = []
	env.forEach(([, y], i) => {
		if (y >= top - 1e-6) rim.push(i)
	})
	if (rim.length < 2)
		rim = env
			.map((p, i) => i)
			.sort((p, q) => (env[q][1] !== env[p][1] ? (env[q][1] < env[p][1] ? -1 : 1) : p - q))
			.slice(0, 2)
	rim = [...rim].sort((p, q) => (env[p][0] < env[q][0] ? -1 : env[p][0] > env[q][0] ? 1 : 0))
	const i = rim[rim.length - 1]
	const j = rim[0]
	let low = Infinity
	for (const [, y] of env) low = pymin(low, y)
	const bottom = env.filter(([, y]) => y <= low + 1e-6).map(([x]) => x)
	const D = Math.abs(env[i][0] - env[j][0])
	let bmax = -Infinity
	let bmin = Infinity
	for (const x of bottom) {
		bmax = pymax(bmax, x)
		bmin = pymin(bmin, x)
	}
	const b = bottom.length > 1 ? bmax - bmin : 0.0
	const depth = rnd ? (Math.PI * (D * D + D * b + b * b)) / (6 * (D + b)) : root.body.depth
	let mass = 0.0
	let out_mass = 0.0
	const out = []
	const shell = new Set([root.id, ...walls.map((w) => `${iid}/${w}`)])
	for (const s of sb.solids) {
		if (s.item !== iid || s.kind !== "dynamic") continue
		const m = sb.materials[s.material].density * _body_volume(s.body)
		mass += m
		if (!shell.has(s.id) && s.body.kind !== "ball") {
			// (a part outside the envelope, a mug's handle: it displaces its own material's volume too while the vessel floats)
			out.push(s.id)
			out_mass += m
		}
	}
	const rho = hasOwn(MATERIALS, material) ? MATERIALS[material].density : null
	if (!(depth > 0) || !(mass > 0) || !rho) return null
	const rec = {
		kind: "hull", id: `${iid}/hull`, item: iid, solid: root.id, points: env.map(([x, y]) => ({ x, y })), rim: [i, j],
		depth: pyRound(depth, 5), material_ml: pyRound((mass / rho) * 1e6, 4)
	}
	if (out.length && out_mass > 0) Object.assign(rec, { extra: out, extra_ml: pyRound((out_mass / rho) * 1e6, 4) })
	rec.vessel = true
	return rec
}

function _displacement(sb, scene) {
	if (!sb.processes.some((p) => p.kind === "liquid")) return
	// (the parts the surface can hold up when laid gently: a paper clip's)
	for (const item of scene.items ?? []) {
		const spec = item !== null && typeof item === "object" && hasOwn(SURFACE_TYPES, item.type) ? SURFACE_TYPES[item.type] : null
		if (spec === null) continue
		const [head, contact, theta] = spec
		for (const s of sb.solids) {
			if (s.item === item.id && s.kind === "dynamic" && s.id.startsWith(`${item.id}/${head}`)) {
				const part = s.id.slice(item.id.length + 1)
				sb.processes.push({ kind: "surface", id: `${item.id}/surface-${part}`, item: item.id, solid: s.id, contact_m: contact, theta })
			}
		}
	}
	// (something the surface holds or that climbs: every liquid's surface tension, for the engine)
	if (sb.processes.some((p) => SURFACE_KINDS.includes(p.kind))) {
		for (const p of sb.processes) {
			if (p.kind !== "liquid") continue
			for (const layer of p.layers) {
				const [g, wets] = tension_of(layer.words)
				layer.tension = g
				layer.wets = wets
			}
		}
	}
	// a fan raised to a sail's height (a boat lane's) stands on a post the view draws when nothing holds it up (render only: `stand`)
	for (const s of sb.solids) {
		if (s.id.endsWith("/base") && sb.scene_items.get(s.item)?.type === "fan" && !("stand" in s)) s.stand = "post"
	}
	for (const item of scene.items ?? []) {
		if (item === null || typeof item !== "object") continue
		if (hasOwn(VESSELS, item.type)) {
			// (an open vessel floats as a hollow hull: its record replaces the displace one)
			const P = props_of(item)
			const rec = vessel_hull(sb, item.id, item.type, P.material || F.TYPES[item.type].material)
			if (rec !== null) {
				sb.processes.push(rec)
				continue
			}
		}
		if (!hasOwn(TRUE_DENSITY, item.type)) continue
		const [rho, need] = TRUE_DENSITY[item.type]
		if (need !== null && !F.py.truthy(props_of(item)[need])) continue
		let mass = 0.0
		for (const s of sb.solids) if (s.item === item.id && s.kind === "dynamic") mass += sb.materials[s.material].density * _body_volume(s.body)
		if (mass > 0) sb.processes.push({ kind: "displace", id: `${item.id}/displace`, item: item.id, volume_ml: pyRound((mass / rho) * 1e6, 4) })
	}
}
